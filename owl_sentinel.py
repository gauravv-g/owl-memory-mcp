"""
OWL Sentinel Production Monitor Daemon
========================================
Hermes v7.0 24/7 background tester.
Reads monitor schedules from SQLite, executes web/android test flows,
and fires Windows notifications on failure.
"""

import argparse
import asyncio
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# -- Constants and Paths ──────────────────────────────────────────────────────
_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)
PID_FILE = os.path.join(os.path.dirname(_OWL_DB_PATH), "sentinel.pid")

# -- Windows Toast Notification Helper ────────────────────────────────────────
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
        print(f"[Sentinel] Notification failed: {e}", file=sys.stderr)


# -- Test Execution Engines ───────────────────────────────────────────────────
async def execute_web_flow(url: str, steps: list) -> tuple[bool, str]:
    """Execute a web monitor flow via Playwright context."""
    import owl_qa_visual
    origin = url
    try:
        parsed = urllib.parse.urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        pass

    ctx = await owl_qa_visual.get_browser_context(origin)
    if not ctx:
        return False, "Playwright launch failed"

    try:
        pages = ctx.pages
        page = pages[0] if pages else await ctx.new_page()
        await page.goto(url, wait_until="load", timeout=20000)

        for step in steps:
            act_type = step["action_type"]
            target = step.get("target")
            val = step.get("value")

            if act_type == "navigate":
                await page.goto(target, wait_until="load", timeout=20000)
            elif act_type == "click":
                await page.click(target, timeout=5000)
            elif act_type == "type":
                await page.fill(target, val, timeout=5000)
            elif act_type == "wait":
                await page.wait_for_timeout(int(val or 1000))
        
        return True, "Passed"
    except Exception as e:
        return False, str(e)


async def execute_android_flow(package: str, steps: list) -> tuple[bool, str]:
    """Execute an Android monitor flow via uiautomator2."""
    import owl_qa_android
    device = owl_qa_android.connect_device()
    if not device:
        return False, "No Android device connected"

    try:
        owl_qa_android.start_app(device, package)
        await asyncio.sleep(2.0)

        serial = device.serial if hasattr(device, "serial") else "default"
        monitor = owl_qa_android.AndroidCrashMonitor(serial, package)
        monitor.start()

        for step in steps:
            act_type = step["action_type"]
            x = step.get("x")
            y = step.get("y")
            res_id = step.get("resource_id")
            text = step.get("text")
            val = step.get("value")

            if act_type == "tap":
                owl_qa_android.tap(device, x, y)
            elif act_type == "tap_by_element":
                success = owl_qa_android.tap_by_element(device, res_id, text)
                if not success:
                    raise ValueError(f"Element {res_id or text} not found")
            elif act_type == "wait":
                await asyncio.sleep(float(val or 1.0))
        
        crashes = monitor.stop()
        if crashes:
            return False, f"App crashed during monitor run: {crashes[0]['trigger_line']}"
        
        return True, "Passed"
    except Exception as e:
        return False, str(e)


# -- Core Monitor Logic ────────────────────────────────────────────────────────
async def run_monitor_cycle():
    """Scan and execute active monitors whose interval matches current time."""
    if not os.path.exists(_OWL_DB_PATH):
        return

    try:
        conn = sqlite3.connect(_OWL_DB_PATH, timeout=5)
        conn.row_factory = sqlite3.Row
        monitors = conn.execute("SELECT * FROM qa_sentinel_monitors WHERE active = 1").fetchall()
    except Exception as db_err:
        print(f"[Sentinel] DB connection failed: {db_err}", file=sys.stderr)
        return

    now = datetime.now(timezone.utc)
    for m in monitors:
        last_check_str = m["last_checked_at"]
        interval_min = m["check_interval_minutes"] or 60

        should_run = False
        if not last_check_str:
            should_run = True
        else:
            try:
                last_check = datetime.fromisoformat(last_check_str)
                elapsed = (now - last_check).total_seconds() / 60
                if elapsed >= interval_min:
                    should_run = True
            except Exception:
                should_run = True

        if not should_run:
            continue

        print(f"[Sentinel] Running monitor: {m['flow_name']} for {m['target_url'] or m['target_app']}", file=sys.stderr)
        steps = []
        try:
            steps = json.loads(m["flow_steps_json"] or "[]")
        except Exception:
            pass

        passed = False
        error_msg = ""
        if m["target_url"]:
            try:
                passed, error_msg = await execute_web_flow(m["target_url"], steps)
            except Exception as e:
                passed, error_msg = False, str(e)
        else:
            try:
                passed, error_msg = await execute_android_flow(m["target_app"], steps)
            except Exception as e:
                passed, error_msg = False, str(e)

        new_status = "passed" if passed else "failed"
        old_status = m["last_status"]
        failures = m["consecutive_failures"] or 0

        if passed:
            failures = 0
            uptime_pct = min(100.0, (m["uptime_pct"] or 100.0) * 0.99 + 1.0)
        else:
            failures += 1
            uptime_pct = max(0.0, (m["uptime_pct"] or 100.0) * 0.95)

        if new_status == "failed" and old_status != "failed":
            notify_windows(
                "QA Monitor Broken!",
                f"Sentinel monitor '{m['flow_name']}' has failed: {error_msg[:120]}"
            )
            try:
                bug_id = f"bug_sentinel_{int(time.time())}"
                conn.execute("""
                    INSERT INTO qa_bugs (id, title, description, severity, bug_type, target_url, target_app, status, project, created_at)
                    VALUES (?, ?, ?, 'high', 'production_failure', ?, ?, 'open', ?, ?)
                """, (bug_id, f"Sentinel monitor broken: {m['flow_name']}", f"Monitor failed. Details: {error_msg}", m["target_url"], m["target_app"], m["project"], now.isoformat()))
                
                conn.execute("""
                    INSERT INTO daemon_signals (signal_type, payload, consumed, created_at)
                    VALUES ('qa_sentinel_failure', ?, 0, ?)
                """, (json.dumps({"monitor": m["flow_name"], "error": error_msg}), now.isoformat()))
                
                # Pillar 12: Trigger Neural Mesh cascade
                try:
                    import owl_qa_orchestrator
                    orch = owl_qa_orchestrator.NeuralMeshOrchestrator(m["project"])
                    await orch.trigger_event_cascade("test_run_completed", {
                        "discovered_bug_ids": [bug_id],
                        "run_id": m["id"]
                    })
                except Exception as orch_err:
                    print(f"[Sentinel] Orchestrator cascade failed: {orch_err}", file=sys.stderr)
                    
            except Exception as db_err:
                print(f"[Sentinel] Failed to write bug: {db_err}", file=sys.stderr)

        elif new_status == "passed" and old_status == "failed":
            notify_windows(
                "QA Monitor Recovered",
                f"Sentinel monitor '{m['flow_name']}' is now passing again."
            )

        try:
            conn.execute("""
                UPDATE qa_sentinel_monitors
                SET last_checked_at = ?, last_status = ?, consecutive_failures = ?, uptime_pct = ?
                WHERE id = ?
            """, (now.isoformat(), new_status, failures, uptime_pct, m["id"]))
            conn.commit()
        except Exception as db_err:
            print(f"[Sentinel] Update failed: {db_err}", file=sys.stderr)

    conn.close()


async def check_daily_summary():
    """Trigger daily monitor health log at 9:00 AM local time."""
    now = datetime.now()
    if now.hour == 9 and now.minute == 0:
        try:
            conn = sqlite3.connect(_OWL_DB_PATH, timeout=5)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT flow_name, uptime_pct FROM qa_sentinel_monitors WHERE active = 1").fetchall()
            if rows:
                summary_lines = ["[SENTINEL DAILY REPORT] Uptime status:"]
                for r in rows:
                    summary_lines.append(f"- {r['flow_name']}: {r['uptime_pct']:.1f}%")
                
                mem_id = f"sentinel_daily_{now.strftime('%Y%m%d')}"
                conn.execute("""
                    INSERT OR IGNORE INTO episodic_memories
                      (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, source, created_at, updated_at, is_active)
                    VALUES (?, ?, 'sentinel_daily_summary', 'default', 0.1, 0.2, 0.7, 1.0, 'sentinel', ?, ?, 1)
                """, (mem_id, "\n".join(summary_lines), now.isoformat(), now.isoformat()))
                conn.commit()
            conn.close()
            
            # Daily maintenance orchestrator cascade (Pillars 8, 9, etc.)
            try:
                import owl_qa_orchestrator
                orch = owl_qa_orchestrator.NeuralMeshOrchestrator("default")
                await orch.trigger_event_cascade("daily_maintenance", {})
            except Exception as e:
                pass
                
            await asyncio.sleep(60)
        except Exception as summary_err:
            print(f"[Sentinel] Daily summary check failed: {summary_err}", file=sys.stderr)


def handle_args():
    parser = argparse.ArgumentParser(description="OWL Sentinel QA Monitor Daemon.")
    parser.add_argument("--daemon", action="store_true", help="Launch in background")
    parser.add_argument("--stop", action="store_true", help="Stop background Sentinel process")
    return parser.parse_args()


def main():
    args = handle_args()

    if args.stop:
        if os.path.exists(PID_FILE):
            try:
                with open(PID_FILE, "r") as f:
                    pid = int(f.read().strip())
                os.kill(pid, signal.SIGTERM)
                print(f"[Sentinel] Stopped process with PID {pid}", file=sys.stderr)
            except ProcessLookupError:
                print("[Sentinel] Process not running, cleaning up PID file.", file=sys.stderr)
            except Exception as stop_err:
                print(f"[Sentinel] Stop failed: {stop_err}", file=sys.stderr)
            
            try:
                os.remove(PID_FILE)
            except Exception:
                pass
        else:
            print("[Sentinel] PID file not found. Daemon is not running.", file=sys.stderr)
        return

    if args.daemon:
        print("[Sentinel] Launching Sentinel background daemon...", file=sys.stderr)
        subprocess.Popen(
            [sys.executable, __file__],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        )
        return

    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                old_pid = int(f.read().strip())
            is_running = False
            if sys.platform == "win32":
                res = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {old_pid}"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                is_running = str(old_pid) in res.stdout
            else:
                try:
                    os.kill(old_pid, 0)
                    is_running = True
                except OSError:
                    is_running = False
            
            if is_running:
                print(f"[Sentinel] Already running (PID: {old_pid}). Exiting.", file=sys.stderr)
                sys.exit(0)
            else:
                print(f"[Sentinel] Cleaning up stale PID file for dead process (PID: {old_pid}).", file=sys.stderr)
                try:
                    os.remove(PID_FILE)
                except Exception:
                    pass
        except Exception:
            pass

    my_pid = os.getpid()
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(my_pid))
        print(f"[Sentinel] Sentinel daemon started with PID {my_pid}", file=sys.stderr)
    except Exception as pid_err:
        print(f"[Sentinel] Failed to write PID file: {pid_err}", file=sys.stderr)

    # Start Orchestrator Status HTTP Server
    try:
        import owl_qa_orchestrator
        owl_qa_orchestrator.start_status_server()
    except Exception as server_err:
        print(f"[Sentinel] Orchestrator status server failed to start: {server_err}", file=sys.stderr)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def shutdown_handler(signum, frame):
        print("[Sentinel] Shutting down sentinel daemon...", file=sys.stderr)
        try:
            os.remove(PID_FILE)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    try:
        while True:
            loop.run_until_complete(run_monitor_cycle())
            loop.run_until_complete(check_daily_summary())
            time.sleep(30)
    except SystemExit:
        pass
    except Exception as run_err:
        print(f"[Sentinel] Daemon loop crashed: {run_err}", file=sys.stderr)
        try:
            os.remove(PID_FILE)
        except Exception:
            pass


if __name__ == "__main__":
    main()

