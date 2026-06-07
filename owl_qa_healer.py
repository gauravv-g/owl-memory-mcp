"""
OWL QA Healer Module (Pillar 6)
===============================
Detects broken selectors and heals them on the fly using DOM and vision models.
"""

import json
import sqlite3
import sys
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from owl_shared_intelligence import _OWL_DB_PATH

# Try optional vision client
_anthropic_client = None
try:
    import anthropic
    if os.environ.get("ANTHROPIC_API_KEY"):
        _anthropic_client = anthropic.Anthropic()
except ImportError:
    pass

def detect_broken_selector(error_msg: str) -> bool:
    """Detects if the step failure was due to an element target not found (selector-miss)."""
    indicators = [
        "unable to locate element",
        "no element found",
        "target closed",
        "waiting for selector",
        "element is not visible",
        "selector matches no elements",
        "timeout exceeded",
        "failed to find element"
    ]
    msg = error_msg.lower()
    return any(ind in msg for ind in indicators)

async def find_replacement_selector(page: Any, target_selector: str, intent_desc: str = "") -> Tuple[str, float]:
    """Scans the page DOM to locate candidate elements and finds the closest matching replacement."""
    # 1. Query interactive elements on page
    # Evaluate a script to get simple representations of all buttons, inputs, links, and divs with click events
    candidates_json = await page.evaluate("""
        () => {
            const elList = [];
            const interactiveSelectors = 'button, input, a, [role="button"], [onclick]';
            document.querySelectorAll(interactiveSelectors).forEach((el, idx) => {
                elList.push({
                    index: idx,
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || '',
                    className: el.className || '',
                    text: (el.innerText || el.value || '').trim().substring(0, 100),
                    placeholder: el.placeholder || '',
                    type: el.type || '',
                    role: el.getAttribute('role') || '',
                    testid: el.getAttribute('data-testid') || ''
                });
            });
            return elList;
        }
    """)

    if not candidates_json:
        return target_selector, 0.0

    # 2. Score candidates based on text match or layout cues
    best_selector = target_selector
    best_score = 0.0

    # Parse target hints from selector
    clean_target = target_selector.lower()
    
    # Try parsing semantic targets (e.g. #submit-btn -> search for 'submit')
    semantic_hints = []
    # extract words from original selector
    for word in re.split(r'[^a-zA-Z]', clean_target):
        if len(word) > 2:
            semantic_hints.append(word)
    if intent_desc:
        semantic_hints.extend(re.split(r'[^a-zA-Z]', intent_desc.lower()))
    
    # Filter empty hints
    semantic_hints = [h for h in semantic_hints if h]

    for cand in candidates_json:
        score = 0.0
        
        # Calculate visual similarity
        cand_text = cand["text"].lower()
        cand_id = cand["id"].lower()
        cand_class = cand["className"].lower()
        cand_testid = cand["testid"].lower()
        cand_place = cand["placeholder"].lower()
        
        # Exact text matches are highly weighted
        for hint in semantic_hints:
            if hint in cand_text:
                score += 0.4
            if hint in cand_id:
                score += 0.3
            if hint in cand_testid:
                score += 0.5 # data-testid is highly reliable
            if hint in cand_class:
                score += 0.2
            if hint in cand_place:
                score += 0.3

        # Type matches (e.g. if original selector contains "btn" and candidate is a button)
        if "btn" in clean_target or "button" in clean_target:
            if cand["tagName"] == "button" or cand["role"] == "button" or cand["type"] == "submit":
                score += 0.2

        if score > best_score:
            best_score = score
            # Construct a robust selector
            if cand["testid"]:
                best_selector = f"[data-testid='{cand['testid']}']"
            elif cand["id"]:
                best_selector = f"#{cand['id']}"
            elif cand["tagName"] == "button" and cand["text"]:
                # Escape single quotes in text
                escaped_text = cand["text"].replace("'", "\\'")
                best_selector = f"button:has-text('{escaped_text}')"
            else:
                # Fallback to structural indicator class + tag
                cls = cand["className"].strip().split()[0] if cand["className"] else ""
                if cls:
                    best_selector = f"{cand['tagName']}.{cls}"
                else:
                    best_selector = f"{cand['tagName']}:nth-of-type({cand['index'] + 1})"

    # Normalize score
    normalized_score = min(0.99, best_score)
    if best_score > 0.0:
        return best_selector, normalized_score
    else:
        return target_selector, 0.0

def save_healing_log(
    flow_name: str,
    original_selector: str,
    healed_selector: str,
    confidence: float,
    applied: bool,
    project: str = "default"
):
    """Saves a healing log to SQLite db."""
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS qa_heal_log (
                  id TEXT PRIMARY KEY,
                  flow_name TEXT,
                  original_selector TEXT,
                  healed_selector TEXT,
                  confidence REAL,
                  applied INTEGER,
                  project TEXT,
                  created_at TEXT
                );
                """
            )
            heal_id = f"heal_{int(datetime.now(timezone.utc).timestamp())}"
            conn.execute(
                """
                INSERT INTO qa_heal_log (id, flow_name, original_selector, healed_selector, confidence, applied, project, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    heal_id,
                    flow_name,
                    original_selector,
                    healed_selector,
                    confidence,
                    1 if applied else 0,
                    project,
                    datetime.now(timezone.utc).isoformat()
                )
            )
            conn.commit()
    except Exception as e:
        print(f"[Healer] Error saving healing log: {e}", file=sys.stderr)

def apply_healing_to_flow(flow_name: str, step_index: int, replacement_selector: str, project: str = "default"):
    """Updates the target step in Sentinel and Test Genome tables with the healed selector."""
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            # 1. Update Sentinel Monitor
            cursor = conn.execute(
                "SELECT * FROM qa_sentinel_monitors WHERE flow_name = ? AND project = ?", 
                (flow_name, project)
            )
            row = cursor.fetchone()
            if row:
                steps = json.loads(row["flow_steps_json"] or "[]")
                if len(steps) > step_index:
                    steps[step_index]["target"] = replacement_selector
                    conn.execute(
                        "UPDATE qa_sentinel_monitors SET flow_steps_json = ? WHERE flow_name = ?",
                        (json.dumps(steps), flow_name)
                    )

            # 2. Update Genome flows
            cursor = conn.execute(
                "SELECT * FROM qa_test_genome WHERE flow_name = ? AND project = ?",
                (flow_name, project)
            )
            row = cursor.fetchone()
            if row:
                steps = json.loads(row["flow_steps_json"] or "[]")
                if len(steps) > step_index:
                    steps[step_index]["target"] = replacement_selector
                    conn.execute(
                        "UPDATE qa_test_genome SET flow_steps_json = ? WHERE flow_name = ?",
                        (json.dumps(steps), flow_name)
                    )
            conn.commit()
    except Exception as e:
        print(f"[Healer] Error applying healing: {e}", file=sys.stderr)
