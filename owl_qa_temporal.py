"""
OWL QA Temporal Module (Pillar 10)
==================================
Analyzes quality regression trajectories over time.
Detects quality inflection points (regression events) and reports flaky tests.
"""

import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from owl_shared_intelligence import _OWL_DB_PATH

def compute_quality_velocity(project: str = "default", window_days: int = 7) -> Dict[str, Any]:
    """Calculates the speed and direction of quality changes in a given time window."""
    now = datetime.now(timezone.utc)
    boundary_date = (now - timedelta(days=window_days)).isoformat()
    midpoint_date = (now - timedelta(days=window_days / 2)).isoformat()
    
    velocity = 0.0
    status = "stable"
    score_recent = 100.0
    score_older = 100.0

    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            
            # 1. Fetch recent window metrics (midpoint -> now)
            cursor = conn.execute(
                """
                SELECT AVG(regression_score) as avg_score, COUNT(*) as run_count
                FROM qa_test_runs
                WHERE project = ? AND created_at >= ?
                """,
                (project, midpoint_date)
            )
            r = cursor.fetchone()
            if r and r["avg_score"] is not None:
                score_recent = r["avg_score"]

            # 2. Fetch older window metrics (boundary -> midpoint)
            cursor = conn.execute(
                """
                SELECT AVG(regression_score) as avg_score, COUNT(*) as run_count
                FROM qa_test_runs
                WHERE project = ? AND created_at >= ? AND created_at < ?
                """,
                (project, boundary_date, midpoint_date)
            )
            r = cursor.fetchone()
            if r and r["avg_score"] is not None:
                score_older = r["avg_score"]

            # Velocity is change per day
            score_diff = score_recent - score_older
            velocity = round(score_diff / max(1.0, window_days / 2), 2)
            
            if velocity > 1.0:
                status = "improving"
            elif velocity < -1.0:
                status = "degrading"
            else:
                status = "stable"
                
    except Exception as e:
        print(f"[Temporal] Error computing quality velocity: {e}", file=sys.stderr)

    return {
        "project": project,
        "window_days": window_days,
        "current_quality_score": round(score_recent, 1),
        "previous_quality_score": round(score_older, 1),
        "quality_velocity_per_day": velocity,
        "trajectory_status": status
    }

def detect_quality_inflection_points(project: str = "default") -> List[Dict[str, Any]]:
    """Identifies specific timestamps/test runs where regression score dropped significantly."""
    inflections = []
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            # Fetch last 30 runs ordered by date
            rows = conn.execute(
                """
                SELECT id, flow_name, regression_score, bug_count, created_at
                FROM qa_test_runs
                WHERE project = ?
                ORDER BY created_at ASC
                LIMIT 50
                """,
                (project,)
            ).fetchall()
            
            # Scan for drops > 10 points between successive runs of the same flow
            flow_last_scores = {}
            for r in rows:
                flow = r["flow_name"]
                score = r["regression_score"]
                created = r["created_at"]
                
                if flow in flow_last_scores:
                    prev_score = flow_last_scores[flow]
                    drop = prev_score - score
                    if drop >= 10.0:
                        inflections.append({
                            "flow_name": flow,
                            "timestamp": created,
                            "run_id": r["id"],
                            "regression_drop": round(drop, 1),
                            "current_score": score,
                            "previous_score": prev_score,
                            "bugs_detected": r["bug_count"]
                        })
                flow_last_scores[flow] = score
    except Exception as e:
        print(f"[Temporal] Error detecting inflection points: {e}", file=sys.stderr)
        
    # Sort with newest drops first
    inflections.sort(key=lambda x: x["timestamp"], reverse=True)
    return inflections

def project_quality_forward(project: str = "default", days_ahead: int = 7) -> float:
    """Uses current quality velocity to project the regression score after N days."""
    stats = compute_quality_velocity(project, window_days=7)
    current = stats["current_quality_score"]
    velocity = stats["quality_velocity_per_day"]
    
    projected = current + (velocity * days_ahead)
    return max(0.0, min(100.0, round(projected, 1)))

def find_flaky_tests(project: str = "default") -> List[Dict[str, Any]]:
    """Identifies test flows that exhibit high pass/fail variance (flakiness)."""
    flaky = []
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            # Get list of unique flows
            flows = conn.execute(
                "SELECT DISTINCT flow_name FROM qa_test_runs WHERE project = ?",
                (project,)
            ).fetchall()
            
            for f in flows:
                flow_name = f["flow_name"]
                
                # Fetch recent run history of this flow
                runs = conn.execute(
                    """
                    SELECT status FROM qa_test_runs
                    WHERE flow_name = ? AND project = ?
                    ORDER BY created_at DESC LIMIT 10
                    """,
                    (flow_name, project)
                ).fetchall()
                
                if len(runs) < 3:
                    continue
                    
                statuses = [r["status"] for r in runs]
                passed_count = statuses.count("passed")
                failed_count = len(runs) - passed_count
                
                # If there's a mix of pass and fail in the same window, it's flaky
                if passed_count > 0 and failed_count > 0:
                    flaky_pct = (min(passed_count, failed_count) / len(runs)) * 200.0 # 0% to 100% flakiness
                    flaky.append({
                        "flow_name": flow_name,
                        "runs_analyzed": len(runs),
                        "passed_runs": passed_count,
                        "failed_runs": failed_count,
                        "flakiness_percentage": round(flaky_pct, 1)
                    })
    except Exception as e:
        print(f"[Temporal] Error identifying flaky tests: {e}", file=sys.stderr)
        
    flaky.sort(key=lambda x: x["flakiness_percentage"], reverse=True)
    return flaky
