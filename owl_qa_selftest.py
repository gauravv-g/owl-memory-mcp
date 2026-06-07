"""
OWL QA Self-Test (Pillar 9)
===========================
System diagnostic engine (Mirror Test). Tests database, browser context,
ADB status, sentinel process, and disk writing health.
"""

import os
import sys
import sqlite3
import subprocess
import json
import time
from datetime import datetime, timezone
from typing import Dict, Any
from owl_shared_intelligence import _OWL_DB_PATH

PID_FILE = os.path.join(os.path.dirname(_OWL_DB_PATH), "sentinel.pid")
QA_SCREENSHOT_DIR = os.path.join(os.path.dirname(_OWL_DB_PATH), "qa-screenshots")

def notify_windows(title: str, message: str):
    """Deliver a native Windows tray balloon notification without external dependencies."""
    escaped_title = title.replace("'", "''")
    escaped_message = message.replace("'", "''")
    ps_command = (
        "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); "
        "$notification = New-Object System.Windows.Forms.NotifyIcon; "
        "$notification.Icon = [System.Drawing.SystemIcons]::Warning; "
        f"$notification.BalloonTipTitle = '{escaped_title}'; "
        f"$notification.BalloonTipText = '{escaped_message}'; "
        "$notification.Visible = $true; "
        "$notification.ShowBalloonTip(7000); "
        "Start-Sleep -Seconds 2; "
        "$notification.Dispose()"
    )
    try:
        subprocess.Popen(
            ["powershell", "-WindowStyle", "Hidden", "-Command", ps_command],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print(f"[Self-Test] Notification failed: {e}", file=sys.stderr)

async def run_selftest_suite() -> Dict[str, Any]:
    """Runs all system diagnostic checks and generates a health report."""
    results = {}
    total_score = 0
    max_score = 60 # 6 checks, 10 points each

    # 1. Check SQLite DB Integrity
    db_ok = False
    db_reason = "Unknown"
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=2) as conn:
            cursor = conn.execute("PRAGMA integrity_check")
            row = cursor.fetchone()
            if row and row[0] == "ok":
                db_ok = True
                db_reason = "PRAGMA check passed"
            else:
                db_reason = f"PRAGMA check returned: {row}"
    except Exception as e:
        db_reason = str(e)
    results["db_integrity"] = {"passed": db_ok, "details": db_reason}
    if db_ok: total_score += 10

    # 2. Check Database Schema Tables Existence
    schema_ok = False
    schema_details = ""
    required_tables = [
        "qa_test_runs", "qa_test_steps", "qa_bugs", "qa_visual_baselines",
        "qa_performance_baselines", "qa_knowledge_crystals", "qa_sentinel_monitors",
        "qa_test_genome", "qa_bug_resonance", "qa_bug_pattern_ledger",
        "qa_behavior_oracle", "qa_api_contracts"
    ]
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            existing_tables = [r[0] for r in cursor.fetchall()]
            missing = [t for t in required_tables if t not in existing_tables]
            if not missing:
                schema_ok = True
                schema_details = f"All {len(required_tables)} QA tables verified."
            else:
                schema_details = f"Missing tables: {', '.join(missing)}"
    except Exception as e:
        schema_details = str(e)
    results["db_schema"] = {"passed": schema_ok, "details": schema_details}
    if schema_ok: total_score += 10

    # 3. Check Screenshot Directory Write Permissions
    write_ok = False
    write_details = ""
    try:
        os.makedirs(QA_SCREENSHOT_DIR, exist_ok=True)
        test_file = os.path.join(QA_SCREENSHOT_DIR, "self_test_temp.txt")
        with open(test_file, "w") as f:
            f.write("test")
        os.remove(test_file)
        write_ok = True
        write_details = "Write permissions verified."
    except Exception as e:
        write_details = f"Failed to write/delete test file: {e}"
    results["screenshot_directory"] = {"passed": write_ok, "details": write_details}
    if write_ok: total_score += 10

    # 4. Check Browser Pool / Playwright Context Health
    browser_ok = False
    browser_details = ""
    try:
        import owl_qa_visual
        if owl_qa_visual._playwright_available:
            # Quick test: check if we can get a browser context for about:blank
            ctx = await owl_qa_visual.get_browser_context("about:blank")
            if ctx:
                browser_ok = True
                browser_details = "Playwright context is running."
            else:
                browser_details = "Browser pool context returned None."
        else:
            browser_details = "Playwright is not available in environment."
    except Exception as e:
        browser_details = str(e)
    results["browser_pool"] = {"passed": browser_ok, "details": browser_details}
    if browser_ok: total_score += 10

    # 5. Check ADB connection status
    adb_ok = False
    adb_details = ""
    try:
        # Run adb version
        res = subprocess.run(["adb", "version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode == 0:
            adb_ok = True
            adb_details = f"ADB available. Version: {res.stdout.splitlines()[0]}"
        else:
            adb_details = "ADB returned non-zero exit code."
    except FileNotFoundError:
        adb_details = "ADB executable not found in system PATH."
    except Exception as e:
        adb_details = str(e)
    results["adb_bridge"] = {"passed": adb_ok, "details": adb_details}
    if adb_ok: total_score += 10

    # 6. Check if Sentinel Daemon process is running
    sentinel_ok = False
    sentinel_details = ""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            
            # Check process status in Windows via tasklist
            res = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"], 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE, 
                text=True
            )
            if str(pid) in res.stdout:
                sentinel_ok = True
                sentinel_details = f"Sentinel process is running with PID {pid}."
            else:
                sentinel_details = f"PID file exists ({pid}) but process not found in active tasks."
        except Exception as e:
            sentinel_details = f"PID file read error: {e}"
    else:
        sentinel_details = "Sentinel PID file not found. Daemon is likely stopped."
    results["sentinel_daemon"] = {"passed": sentinel_ok, "details": sentinel_details}
    if sentinel_ok: total_score += 10

    # Calculate overall health score
    pct_score = int((total_score / max_score) * 100)
    results["health_score"] = pct_score
    results["timestamp"] = datetime.now(timezone.utc).isoformat()

    # Save to qa_system_health_log table
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS qa_system_health_log (
                  id TEXT PRIMARY KEY,
                  health_score INTEGER,
                  details_json TEXT,
                  created_at TEXT
                );
                """
            )
            log_id = f"health_{int(time.time())}"
            conn.execute(
                """
                INSERT INTO qa_system_health_log (id, health_score, details_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (log_id, pct_score, json.dumps(results), datetime.now(timezone.utc).isoformat())
            )
            conn.commit()
    except Exception as e:
        print(f"[Self-Test] Error saving health log: {e}", file=sys.stderr)

    # Fire Windows notification if health drops
    if pct_score < 80:
        notify_windows(
            "OWL QA System Alert",
            f"QA System Health dropped to {pct_score}%. Critical checks failed! Check the health log."
        )

    return results
