"""
OWL QA Economics Engine (Pillar 7)
==================================
Calculates the business impact and fix-cost ROI of bugs.
Prioritizes technical debt based on user flow importance and complexity.
"""

import sqlite3
import sys
from typing import Any, Dict, List
from owl_shared_intelligence import _OWL_DB_PATH

# Business assumptions
DEVELOPER_HOURLY_RATE = 75.0  # USD

def estimate_fix_hours(bug_type: str, severity: str) -> float:
    """Estimates the developer hours needed to resolve a bug based on metadata."""
    sev = severity.lower()
    b_type = bug_type.lower()
    
    # Base hours by type
    if b_type == "crash":
        base = 8.0
    elif b_type == "security":
        base = 12.0
    elif b_type in ["functional", "api"]:
        base = 4.0
    elif b_type in ["performance", "network"]:
        base = 3.0
    elif b_type in ["visual", "harmony"]:
        base = 1.0
    else:
        base = 2.0
        
    # Multiplier by severity
    if sev == "critical":
        mult = 2.0
    elif sev == "high":
        mult = 1.5
    elif sev == "medium":
        mult = 1.0
    elif sev == "low":
        mult = 0.5
    else:
        mult = 1.0
        
    return base * mult

def get_path_importance(url_or_app: str) -> float:
    """Weights the importance of a path or package on user conversion flow (1.0 to 10.0)."""
    if not url_or_app:
        return 1.0
        
    path = url_or_app.lower()
    
    # High conversion surfaces
    if any(k in path for k in ["checkout", "cart", "payment", "purchase", "subscribe"]):
        return 10.0
    if any(k in path for k in ["login", "signup", "auth", "register", "onboard"]):
        return 8.0
    if any(k in path for k in ["product", "item", "search", "billing"]):
        return 6.0
    if any(k in path for k in ["dashboard", "home", "index"]):
        return 5.0
    
    # Low conversion surfaces
    if any(k in path for k in ["about", "contact", "privacy", "terms", "settings"]):
        return 2.0
        
    return 3.0

def calculate_roi(severity: str, importance: float, fix_hours: float) -> float:
    """Calculates ROI score = (severity_weight * path_importance) / fix_hours."""
    sev = severity.lower()
    if sev == "critical":
        sev_weight = 10.0
    elif sev == "high":
        sev_weight = 5.0
    elif sev == "medium":
        sev_weight = 2.0
    elif sev == "low":
        sev_weight = 1.0
    else:
        sev_weight = 2.0
        
    # Ensure fix_hours has a floor of 0.5 to prevent division by zero
    hours = max(0.5, fix_hours)
    
    return round((sev_weight * importance) / hours, 2)

def update_db_columns():
    """Ensures necessary economics columns exist in qa_bugs."""
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            cursor = conn.execute("PRAGMA table_info(qa_bugs)")
            columns = [row["name"] for row in cursor.fetchall()]
            
            new_cols = {
                "roi_score": "REAL DEFAULT 0.0",
                "estimated_fix_hours": "REAL DEFAULT 1.0",
                "user_path_importance": "REAL DEFAULT 1.0",
                "economic_impact_score": "REAL DEFAULT 0.0"
            }
            
            for col, col_type in new_cols.items():
                if col not in columns:
                    conn.execute(f"ALTER TABLE qa_bugs ADD COLUMN {col} {col_type}")
            conn.commit()
    except Exception as e:
        print(f"[Economics] Schema update failed: {e}", file=sys.stderr)

def sync_bug_economics(project: str = "default"):
    """Recalculates economic scores for all open bugs in a project."""
    update_db_columns()
    
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            bugs = conn.execute(
                "SELECT * FROM qa_bugs WHERE status = ? AND project = ?",
                ("open", project)
            ).fetchall()
            
            for bug in bugs:
                target = bug["target_url"] or bug["target_app"] or ""
                severity = bug["severity"] or "medium"
                bug_type = bug["bug_type"] or "functional"
                
                importance = get_path_importance(target)
                fix_hours = estimate_fix_hours(bug_type, severity)
                roi = calculate_roi(severity, importance, fix_hours)
                
                # Impact score in simple rating points (1-100)
                impact_score = round(importance * (10.0 if severity == "critical" else 5.0 if severity == "high" else 2.0), 1)
                
                conn.execute(
                    """
                    UPDATE qa_bugs 
                    SET roi_score = ?, estimated_fix_hours = ?, 
                        user_path_importance = ?, economic_impact_score = ?
                    WHERE id = ?
                    """,
                    (roi, fix_hours, importance, impact_score, bug["id"])
                )
            conn.commit()
    except Exception as e:
        print(f"[Economics] Error syncing bug economics: {e}", file=sys.stderr)

def get_prioritized_queue(project: str = "default") -> Dict[str, Any]:
    """Generates the prioritized bug fixing queue and technical debt calculations."""
    sync_bug_economics(project)
    
    report = {
        "project": project,
        "total_bugs": 0,
        "total_fix_hours": 0.0,
        "total_debt_usd": 0.0,
        "queue": []
    }
    
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, title, severity, bug_type, target_url, target_app, 
                       roi_score, estimated_fix_hours, economic_impact_score
                FROM qa_bugs 
                WHERE status = 'open' AND project = ?
                ORDER BY roi_score DESC
                """,
                (project,)
            ).fetchall()
            
            total_hours = 0.0
            queue_list = []
            for r in rows:
                total_hours += r["estimated_fix_hours"]
                queue_list.append({
                    "id": r["id"],
                    "title": r["title"],
                    "severity": r["severity"],
                    "type": r["bug_type"],
                    "target": r["target_url"] or r["target_app"],
                    "roi_score": r["roi_score"],
                    "hours_to_fix": r["estimated_fix_hours"],
                    "financial_cost": round(r["estimated_fix_hours"] * DEVELOPER_HOURLY_RATE, 2),
                    "impact_points": r["economic_impact_score"]
                })
                
            report["total_bugs"] = len(queue_list)
            report["total_fix_hours"] = round(total_hours, 1)
            report["total_debt_usd"] = round(total_hours * DEVELOPER_HOURLY_RATE, 2)
            report["queue"] = queue_list
    except Exception as e:
        print(f"[Economics] Error loading priority queue: {e}", file=sys.stderr)
        
    return report
