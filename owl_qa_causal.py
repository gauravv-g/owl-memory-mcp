"""
OWL QA Causal AI Module (Pillar 2)
==================================
Performs causal reasoning on bugs and test step failures.
Traces observations (symptoms) to root causes and generates Feynman explanations.
"""

import json
import sqlite3
import sys
import os
from typing import Any, Dict, List, Optional
from owl_shared_intelligence import _OWL_DB_PATH

# Try to load Anthropic client
_anthropic_client = None
try:
    import anthropic
    # Anthropic client handles ANTHROPIC_API_KEY env variable automatically
    if os.environ.get("ANTHROPIC_API_KEY"):
        _anthropic_client = anthropic.Anthropic()
except ImportError:
    pass

class CausalGraph:
    """Represents a directed causal graph of observations and hypotheses."""
    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, Any]] = []

    def add_node(self, node_id: str, label: str, node_type: str, metadata: Optional[Dict[str, Any]] = None):
        """Types: 'symptom', 'intermediate_cause', 'root_cause'"""
        self.nodes[node_id] = {
            "label": label,
            "type": node_type,
            "metadata": metadata or {}
        }

    def add_edge(self, source_id: str, target_id: str, relationship: str, probability: float = 1.0):
        self.edges.append({
            "source": source_id,
            "target": target_id,
            "relationship": relationship,
            "probability": probability
        })

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": self.nodes,
            "edges": self.edges
        }

def get_bug_evidence(bug_id: str) -> Dict[str, Any]:
    """Retrieves all evidence associated with a bug from the database."""
    evidence = {
        "bug_details": {},
        "failed_steps": [],
        "network_errors": [],
        "console_errors": []
    }
    
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            
            # Fetch bug details
            cursor = conn.execute("SELECT * FROM qa_bugs WHERE id = ?", (bug_id,))
            bug_row = cursor.fetchone()
            if not bug_row:
                return evidence
            
            evidence["bug_details"] = dict(bug_row)
            run_id = bug_row["discovered_in_run"]
            
            if run_id:
                # Fetch failed steps for this run
                step_cursor = conn.execute(
                    "SELECT * FROM qa_test_steps WHERE run_id = ? ORDER BY step_index ASC", 
                    (run_id,)
                )
                for step in step_cursor.fetchall():
                    step_dict = dict(step)
                    evidence["failed_steps"].append(step_dict)
                    
                    # Accumulate network and console errors
                    if step_dict.get("network_requests_json"):
                        try:
                            reqs = json.loads(step_dict["network_requests_json"])
                            for r in reqs:
                                if r.get("status", 200) >= 400 or r.get("error"):
                                    evidence["network_errors"].append(r)
                        except Exception:
                            pass
                    
                    if step_dict.get("console_errors_json"):
                        try:
                            errs = json.loads(step_dict["console_errors_json"])
                            for err in errs:
                                evidence["console_errors"].append(err)
                        except Exception:
                            pass
    except Exception as e:
        print(f"[Causal] Error retrieving bug evidence: {e}", file=sys.stderr)
        
    return evidence

def analyze_causal_heuristics(evidence: Dict[str, Any]) -> Dict[str, Any]:
    """Fallback rule-based causal reasoning when Claude is not configured."""
    bug = evidence["bug_details"]
    title = bug.get("title", "").lower()
    description = bug.get("description", "").lower()
    console_errors = evidence["console_errors"]
    network_errors = evidence["network_errors"]
    
    # Defaults
    root_cause = "Unknown behavior anomaly"
    confidence = 0.5
    causal_type = "functional"
    
    graph = CausalGraph()
    graph.add_node("symptom", bug.get("title", "Test Failed"), "symptom")
    
    # 1. Analyze network errors
    if network_errors:
        failed_apis = [f"{req.get('method', 'GET')} {req.get('url', '')} -> {req.get('status', 'failed')}" for req in network_errors[:3]]
        graph.add_node("network_fail", f"API Request Failed: {failed_apis[0]}", "intermediate_cause")
        graph.add_edge("network_fail", "symptom", "prevented_page_load", 0.9)
        
        statuses = [req.get("status") for req in network_errors]
        if 401 in statuses or 403 in statuses:
            root_cause = "Authentication failure or authorization token expired."
            confidence = 0.85
            graph.add_node("root", "Expired or missing user JWT credential token", "root_cause")
            graph.add_edge("root", "network_fail", "unauthorized_error", 0.95)
        elif any(s and s >= 500 for s in statuses):
            root_cause = "Internal server endpoint error (5xx) on upstream API."
            confidence = 0.8
            graph.add_node("root", "Backend service crash or database timeout", "root_cause")
            graph.add_edge("root", "network_fail", "server_error", 0.9)
        else:
            root_cause = f"Network connection or URL path not found: {failed_apis[0]}"
            confidence = 0.7
            graph.add_node("root", "Incorrect routing configuration or service down", "root_cause")
            graph.add_edge("root", "network_fail", "connectivity_issue", 0.8)

    # 2. Analyze console script errors
    elif console_errors:
        err_msg = console_errors[0]
        if isinstance(err_msg, dict):
            err_msg = err_msg.get("text", "")
        graph.add_node("js_error", f"Console JavaScript Exception: {err_msg[:60]}", "intermediate_cause")
        graph.add_edge("js_error", "symptom", "crashed_execution_flow", 0.95)
        
        if "null" in err_msg.lower() or "undefined" in err_msg.lower():
            root_cause = f"NullPointer or Undefined reference exception: {err_msg}"
            confidence = 0.9
            graph.add_node("root", "Attempted reading property of undefined variable in client script", "root_cause")
            graph.add_edge("root", "js_error", "reference_error", 0.95)
        else:
            root_cause = f"Client-side runtime script exception: {err_msg}"
            confidence = 0.75
            graph.add_node("root", "JavaScript logical bug in runtime application scripts", "root_cause")
            graph.add_edge("root", "js_error", "script_crash", 0.9)

    # 3. Analyze step failure messages
    else:
        failed_steps = [s for s in evidence["failed_steps"] if not s.get("passed", 1)]
        if failed_steps:
            f_step = failed_steps[0]
            actual = str(f_step.get("actual_state", "")).lower()
            target = f_step.get("target_selector", "element")
            
            if "timeout" in actual or "waiting" in actual:
                root_cause = f"Element {target} not rendered within timeout period."
                confidence = 0.7
                graph.add_node("layout_miss", f"Element {target} did not appear", "intermediate_cause")
                graph.add_edge("layout_miss", "symptom", "timeout_waiting_for_element", 0.8)
                graph.add_node("root", "UI layout changed or network lag delayed rendering", "root_cause")
                graph.add_edge("root", "layout_miss", "structural_or_timing_shift", 0.75)
            elif "not visible" in actual or "hidden" in actual:
                root_cause = f"Element {target} is hidden or blocked from click."
                confidence = 0.75
                graph.add_node("layout_block", f"Element {target} is overlayed or hidden", "intermediate_cause")
                graph.add_edge("layout_block", "symptom", "click_intercepted", 0.8)
                graph.add_node("root", "CSS overlay layout issue or viewport sizing mismatch", "root_cause")
                graph.add_edge("root", "layout_block", "overlap_bug", 0.85)

    # Compile Feynman simplified explanations
    feynman = {
        "founder": f"Plain English: The test failed because the application encountered a problem. {root_cause}",
        "designer": f"UI/UX Context: Visual mismatch or element loading delay detected. {root_cause}",
        "junior_dev": f"Logical Summary: Step failed during action execution. Resolve by verifying: {root_cause}",
        "senior_dev": f"Technical Breakdown: Causal analysis highlights the following root event chain: {root_cause} Trace context: {json.dumps(graph.to_dict())}"
    }

    return {
        "root_cause": root_cause,
        "confidence": confidence,
        "causal_graph": graph.to_dict(),
        "feynman_explanations": feynman,
        "related_bug_predictions": [
            {
                "description": f"Similar failures on other pages that share this target resource.",
                "estimated_impact": "medium"
            }
        ]
    }

def rank_hypotheses(evidence: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Ranks competing hypotheses based on matching indicators."""
    hypotheses = []
    
    # Check if network indicators present
    network_errors = evidence["network_errors"]
    if network_errors:
        hypotheses.append({
            "name": "Backend API Failure",
            "type": "network",
            "evidence_match_score": 0.9,
            "reasoning": f"Found {len(network_errors)} failed network API calls."
        })
        
    # Check if console indicators present
    console_errors = evidence["console_errors"]
    if console_errors:
        hypotheses.append({
            "name": "Client JavaScript Exception",
            "type": "js_crash",
            "evidence_match_score": 0.85,
            "reasoning": f"Found {len(console_errors)} Javascript exception logs in client console."
        })
        
    # Check for selector/timing shifts
    failed_steps = [s for s in evidence["failed_steps"] if not s.get("passed", 1)]
    if failed_steps:
        hypotheses.append({
            "name": "UI Selector Mismatch or Element Delay",
            "type": "selector_timeout",
            "evidence_match_score": 0.7,
            "reasoning": "Test step failed trying to interact with layout element."
        })
        
    # Add default general hypothesis
    hypotheses.append({
        "name": "Flaky Environmental Delay",
        "type": "flakiness",
        "evidence_match_score": 0.3,
        "reasoning": "Could be caused by temporary machine resources or network latency spikes."
    })
    
    # Sort by score
    hypotheses.sort(key=lambda x: x["evidence_match_score"], reverse=True)
    return hypotheses

def build_causal_chain(bug_id: str) -> Dict[str, Any]:
    """Generates the full causal chain and updates the database records."""
    evidence = get_bug_evidence(bug_id)
    if not evidence["bug_details"]:
        return {"error": "Bug ID not found."}
        
    # Use Anthropic if available, otherwise heuristics
    result = None
    if _anthropic_client:
        try:
            # Construct a clear, structured prompt for Claude
            prompt_content = f"""
            Analyze the following QA bug details, failed test steps, console logs, and network logs.
            Establish the exact chain of cause-and-effect that led to this bug.
            
            Bug Details: {json.dumps(evidence["bug_details"])}
            Failed Test Steps: {json.dumps(evidence["failed_steps"])}
            Console Logs: {json.dumps(evidence["console_errors"])}
            Network Requests: {json.dumps(evidence["network_errors"])}
            
            Please output a valid JSON document containing:
            1. "root_cause": Clear explanation of the ultimate technical root cause.
            2. "confidence": Value between 0.0 and 1.0.
            3. "causal_graph": A dictionary with list of "nodes" and "edges" connecting observations.
            4. "feynman_explanations": A dictionary containing simplified translations for:
               - "founder": Plain English, strictly no jargon, business-impact focused.
               - "designer": UI/UX focused explanation.
               - "junior_dev": Code-focused, easy to understand.
               - "senior_dev": Advanced technical root cause with traceback context.
            5. "related_bug_predictions": A list of other screens/flows that might have the same issue.
            
            Do not output any introductory or concluding text, only the raw JSON.
            """
            
            response = _anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt_content}],
                temperature=0.1
            )
            
            # Parse the response text
            res_text = response.content[0].text.strip()
            # Handle potential markdown formatting blocks
            if res_text.startswith("```json"):
                res_text = res_text.split("```json")[1].split("```")[0].strip()
            elif res_text.startswith("```"):
                res_text = res_text.split("```")[1].split("```")[0].strip()
                
            result = json.loads(res_text)
        except Exception as e:
            print(f"[Causal] Anthropic API failed, falling back to heuristics: {e}", file=sys.stderr)
            result = analyze_causal_heuristics(evidence)
    else:
        result = analyze_causal_heuristics(evidence)

    # Save details back to the DB
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.execute(
                """
                UPDATE qa_bugs 
                SET root_cause = ?, feynman_explanations_json = ? 
                WHERE id = ?
                """,
                (
                    result.get("root_cause"),
                    json.dumps(result.get("feynman_explanations")),
                    bug_id
                )
            )
            conn.commit()
    except Exception as e:
        print(f"[Causal] Error updating database for bug {bug_id}: {e}", file=sys.stderr)
        
    return result
