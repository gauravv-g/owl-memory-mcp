"""
OWL QA Oracle Module (Pillar 3)
===============================
Predicts potential failure points in the application based on code diffs
and registers validation monitors automatically.
"""

import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from owl_shared_intelligence import _OWL_DB_PATH

# Try optional git dependency
_git_available = False
try:
    import git
    _git_available = True
except ImportError:
    pass

# Try Anthropic client
_anthropic_client = None
try:
    import anthropic
    if os.environ.get("ANTHROPIC_API_KEY"):
        _anthropic_client = anthropic.Anthropic()
except ImportError:
    pass

def read_git_diff(repo_path: str = ".") -> str:
    """Reads the active git diff (unstaged + staged changes) for analysis."""
    if not _git_available:
        return "ERROR: gitpython is not installed."
    try:
        repo = git.Repo(repo_path)
        # Check diff of active changes
        diff = repo.git.diff("HEAD")
        if not diff:
            # Check diff of last commit if index is clean
            diff = repo.git.diff("HEAD~1", "HEAD")
        return diff
    except Exception as e:
        return f"ERROR: Failed to read git diff: {e}"

def analyze_diff_heuristics(diff_text: str) -> List[Dict[str, Any]]:
    """Fallback rule-based heuristic prediction when Claude is not configured."""
    predictions = []
    
    # 1. Look for selector changes (HTML class/id renames)
    selector_matches = re.findall(r'-.*class=["\']([^"\']+)["\'].*\n\+.*class=["\']([^"\']+)["\']', diff_text)
    for m in selector_matches:
        old_cls, new_cls = m
        predictions.append({
            "description": f"Broken UI selector: CSS class '{old_cls}' changed to '{new_cls}'. Active test steps using old class selector will fail.",
            "confidence": 0.85,
            "suggested_steps": [
                {"action_type": "wait", "value": "1000"},
                {"action_type": "hover", "target": f".{new_cls}"}
            ]
        })

    # 2. Look for API endpoint updates (e.g. routes)
    endpoint_matches = re.findall(r'\+\s*(?:router|app)\.(?:get|post|put|delete)\([\'"]([^\'"]+)[\'"]', diff_text)
    for endpoint in endpoint_matches:
        predictions.append({
            "description": f"New API route added: '{endpoint}'. Needs schema validity checks and contract boundary verification.",
            "confidence": 0.8,
            "suggested_steps": [
                {"action_type": "navigate", "target": endpoint}
            ]
        })

    # 3. Look for database field drops or edits
    db_matches = re.findall(r'-\s*(?:ALTER TABLE|DROP COLUMN|delete)\s+(\w+)', diff_text, re.IGNORECASE)
    for col in db_matches:
        predictions.append({
            "description": f"Database mutation: Dropped column/element '{col}'. Risk of downstream reference errors.",
            "confidence": 0.9,
            "suggested_steps": [
                {"action_type": "wait", "value": "500"}
            ]
        })

    # If no pattern detected, provide general analysis
    if not predictions:
        predictions.append({
            "description": "General code changes detected. Risk level normal. Run regression check to confirm integrity.",
            "confidence": 0.5,
            "suggested_steps": []
        })

    return predictions

def predict_bugs_from_diff(diff_text: str, project: str = "default") -> List[Dict[str, Any]]:
    """Analyzes git diff text to predict potential bugs and returns predicted items."""
    predictions = []
    
    if _anthropic_client:
        try:
            prompt_content = f"""
            Analyze this code diff. Identify 3 potential failure points, visual bugs, 
            or API integration breakages that might result from these edits.
            For each predicted bug, suggest a high-level test sequence (JSON array of steps) 
            to verify if the bug exists.
            
            Code Diff:
            {diff_text[:8000]}
            
            Output a valid JSON array of objects, containing:
            - "description": Description of predicted bug and which file/line it originates from.
            - "confidence": Float between 0.0 and 1.0.
            - "suggested_steps": JSON list of test steps, e.g. [{"action_type": "click", "target": "#submit"}]
            
            Do not output any introductory or concluding text, only the raw JSON.
            """
            
            response = _anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt_content}],
                temperature=0.2
            )
            
            res_text = response.content[0].text.strip()
            if res_text.startswith("```json"):
                res_text = res_text.split("```json")[1].split("```")[0].strip()
            elif res_text.startswith("```"):
                res_text = res_text.split("```")[1].split("```")[0].strip()
                
            predictions = json.loads(res_text)
        except Exception as e:
            print(f"[Oracle] Claude prediction failed: {e}. Falling back to heuristics.", file=sys.stderr)
            predictions = analyze_diff_heuristics(diff_text)
    else:
        predictions = analyze_diff_heuristics(diff_text)

    # Save predictions to SQLite
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            # Ensure table exists (will double-check in main config)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS qa_predictions (
                  id TEXT PRIMARY KEY,
                  trigger_type TEXT,
                  trigger_payload TEXT,
                  predicted_bug_description TEXT,
                  confidence REAL,
                  suggested_test_steps_json TEXT,
                  verification_run_id TEXT,
                  outcome TEXT DEFAULT 'pending',
                  created_at TEXT, resolved_at TEXT
                );
                """
            )
            
            for idx, p in enumerate(predictions):
                pred_id = f"pred_{int(datetime.now(timezone.utc).timestamp())}_{idx}"
                conn.execute(
                    """
                    INSERT INTO qa_predictions 
                      (id, trigger_type, trigger_payload, predicted_bug_description, 
                       confidence, suggested_test_steps_json, outcome, created_at)
                    VALUES (?, 'git_commit', ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        pred_id,
                        diff_text[:1000], # Keep a snippet
                        p["description"],
                        p["confidence"],
                        json.dumps(p.get("suggested_steps", [])),
                        datetime.now(timezone.utc).isoformat()
                    )
                )
                
                # Proactive Register: If confidence is very high (> 0.8), register in Sentinel automatically
                if p["confidence"] >= 0.8 and p.get("suggested_steps"):
                    # Extract target URL or fallback
                    target_url = "http://localhost:3000" # default local fallback
                    # Check if steps have any target URL navigation
                    for step in p["suggested_steps"]:
                        if step.get("action_type") == "navigate" and step.get("target", "").startswith("http"):
                            target_url = step["target"]
                            break
                            
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO qa_sentinel_monitors
                          (id, target_url, target_app, flow_name, flow_steps_json, 
                           check_interval_minutes, last_status, consecutive_failures, uptime_pct, project, active, created_at)
                        VALUES (?, ?, NULL, ?, ?, 60, 'pending', 0, 100.0, ?, 1, ?)
                        """,
                        (
                            f"sentinel_{pred_id}",
                            target_url,
                            f"AutoVerify_{pred_id}",
                            json.dumps(p["suggested_steps"]),
                            project,
                            datetime.now(timezone.utc).isoformat()
                        )
                    )
            conn.commit()
    except Exception as e:
        print(f"[Oracle] Database write failed: {e}", file=sys.stderr)
        
    return predictions
