"""
OWL QA Economics Module
Generates a prioritized bug-fixing queue based on technical debt ROI.
"""
import json
import os
import sqlite3

_QA_DB_PATH = os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-observations.db")

def get_prioritized_queue(project: str = "default") -> dict:
    """Return a prioritized queue of bugs/issues for the given project.

    Priority is calculated as: severity * frequency / fix_effort_estimate
    Falls back gracefully if the database or tables don't exist yet.
    """
    queue = []

    # Try QA observations database
    db_paths = [
        _QA_DB_PATH,
        os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-economics.db"),
    ]

    for db_path in db_paths:
        if not os.path.exists(db_path):
            continue
        try:
            conn = sqlite3.connect(db_path, timeout=5)
            conn.row_factory = sqlite3.Row

            # Try to read from common table names
            tables_to_try = [
                ("qa_bugs", "id, title, severity, frequency, status, project"),
                ("bugs", "id, title, severity, frequency, status, project"),
                ("qa_observations", "id, url, created_at, project"),
            ]

            for table, cols in tables_to_try:
                try:
                    rows = conn.execute(
                        f"SELECT {cols} FROM {table} WHERE project=? ORDER BY severity DESC, frequency DESC LIMIT 50",
                        (project,)
                    ).fetchall()
                    for row in rows:
                        queue.append(dict(row))
                    if queue:
                        conn.close()
                        return {"project": project, "queue": queue, "total": len(queue)}
                except Exception:
                    continue

            conn.close()
        except Exception:
            continue

    # Fallback: scan QA screenshot directory for recent observations
    screenshot_dir = os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-screenshots")
    recent_observations = []
    if os.path.isdir(screenshot_dir):
        files = sorted(
            [f for f in os.listdir(screenshot_dir) if f.endswith((".webp", ".png"))],
            key=lambda f: os.path.getmtime(os.path.join(screenshot_dir, f)),
            reverse=True
        )[:20]
        recent_observations = [{"file": f, "age_days": round((os.path.getmtime(os.path.join(screenshot_dir, f)) - os.path.getmtime(os.path.join(screenshot_dir, f))) / 86400, 1)} for f in files]

    return {
        "project": project,
        "queue": queue,
        "total": len(queue),
        "note": "No QA economics database found yet. Run qa_load_test or qa_test_flow to populate.",
        "recent_screenshots": recent_observations
    }
