# c:\Users\shiva\hermes-custom-mcps\owl_unified_daemon.py
"""
OWL Unified Background Daemon (Python)
======================================
Monitors file saves, validates syntax, writes context decks, and triggers idle dream cycles.
Replaces owl_daemon.js.
"""

import os
import sys
import json
import time
import sqlite3
import subprocess
import hashlib
from datetime import datetime, timezone
from typing import Tuple

# Add workspace directory to path
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)

from owl_shared_intelligence import OWL_DB_PATH

# State variables
LAST_SAVED_FILE = None
LAST_SAVE_TIME = 0.0
IDLE_STATE = True
LAST_IDLE_TRIGGER = 0.0

def get_db_connection():
    conn = sqlite3.connect(OWL_DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

# Trigger Windows balloon notification via PowerShell
def trigger_notification(title: str, text: str):
    clean_title = title.replace("'", "''").replace('"', '`"')
    clean_text = text.replace("'", "''").replace('"', '`"')
    ps_cmd = f"[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $obj = New-Object System.Windows.Forms.NotifyIcon; $obj.Icon = [System.Drawing.SystemIcons]::Warning; $obj.BalloonTipText = '{clean_text}'; $obj.BalloonTipTitle = '{clean_title}'; $obj.Visible = $true; $obj.ShowBalloonTip(10000)"
    try:
        subprocess.run(["powershell", "-Command", ps_cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def get_code_path_distance(from_node: str, to_node: str) -> int:
    if from_node == to_node:
        return 0
    try:
        with get_db_connection() as conn:
            visited = set()
            queue = [(from_node, 0)]
            while queue:
                curr, dist = queue.pop(0)
                if curr == to_node:
                    return dist
                if dist >= 4:
                    continue
                if curr in visited:
                    continue
                visited.add(curr)
                
                rows = conn.execute("SELECT target_id FROM code_edges WHERE source_id = ?", (curr,)).fetchall()
                for r in rows:
                    if r[0] not in visited:
                        queue.append((r[0], dist + 1))
    except Exception:
        pass
    return 4

def generate_analogy(node_id: str, node_type: str) -> str:
    path_lower = node_id.lower()
    if "test" in path_lower:
        return "🧪 The Inspector Badge: Test suite containing validation assertions."
    if "db" in path_lower or "database" in path_lower or "schema" in path_lower:
        return "🗄️ The Digital Filing Cabinet: Database schemas and connection configurations."
    if "server" in path_lower or "mcp" in path_lower or "handler" in path_lower:
        return "🔌 The Post Office: Service API routers and communications logic."
    if "vector" in path_lower or "embedding" in path_lower:
        return "🗺️ The GPS Map of Meanings: Converts text strings into spatial coordinate lists."
    return f"📄 The Code Recipe: Python or Javascript file containing logic for {os.path.basename(node_id)}."

def get_refractory_dilation(active_node_id: str) -> list:
    if not active_node_id:
        return []
    dilated = []
    try:
        with get_db_connection() as conn:
            nodes = conn.execute("SELECT id, node_type, filepath, content FROM code_nodes").fetchall()
            for node_id, node_type, filepath, db_content in nodes:
                state = "gas"
                gravity = 0.0
                
                if node_id == active_node_id:
                    state = "solid"
                    gravity = 1.0
                else:
                    dist = get_code_path_distance(active_node_id, node_id)
                    # Get Hebbian Attention weights
                    hebb = conn.execute("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?", (active_node_id, node_id)).fetchone()
                    weight = hebb[0] if hebb else 0.0
                    
                    gravity_val = (weight * 0.5) + (1.0 / (dist + 1) * 0.5)
                    gravity = round(gravity_val, 2)
                    
                    if dist <= 1 or weight > 0.4:
                        state = "liquid"
                        
                representation = ""
                full_path = os.path.join(WORKSPACE_DIR, filepath)
                if state == "solid":
                    try:
                        with open(full_path, "r", encoding="utf-8") as f:
                            representation = f.read()
                    except Exception:
                        representation = db_content or f"// Content of {node_id} is active context."
                elif state == "liquid":
                    content = ""
                    try:
                        with open(full_path, "r", encoding="utf-8") as f:
                            content = f.read()
                    except Exception:
                        content = db_content or ""
                    # Filter lines for outline
                    lines = content.splitlines()
                    outline_lines = []
                    for line in lines[:100]:
                        l = line.strip()
                        if l.startswith(("import ", "from ", "const ", "require", "def ", "class ", "export ")):
                            outline_lines.append(line)
                    representation = f"// File Outline: {node_id}\n" + ("\n".join(outline_lines[:15]) or "(Outline empty)")
                else:
                    representation = f"// Concept: {node_id} ({node_type})"
                    
                dilated.append({
                    "node_id": node_id,
                    "state": state,
                    "gravity": gravity,
                    "representation": representation,
                    "node_type": node_type
                })
    except Exception as e:
        print(f"[DAEMON] Refractory dilation error: {e}", file=sys.stderr)
    return sorted(dilated, key=lambda x: x["gravity"], reverse=True)[:15]

def write_context_deck(active_node_id: str):
    try:
        dilated = get_refractory_dilation(active_node_id)
        now = datetime.now(timezone.utc).isoformat() + "Z"
        md = f"# OWL Memory Substrate Context Deck\n\n"
        md += f"*Narrative Chapter: Unified Substrate*\n"
        md += f"*Last Updated: {now}*\n"
        md += f"*Active Focus: `{active_node_id}`*\n\n"
        md += f"> [!NOTE]\n"
        md += f"> This is a self-updating dilated prompt context deck generated in real-time by the OWL background daemon.\n\n"
        
        # 1. Solid Nodes
        md += f"## 🔴 Solid Context (Active Files & Functions)\n\n"
        solids = [n for n in dilated if n["state"] == "solid"]
        for s in solids:
            md += f"### File: `{s['node_id']}`\n"
            ext = os.path.splitext(s['node_id'])[1].lstrip('.') or "javascript"
            md += f"```{ext}\n{s['representation']}\n```\n\n"
            
        # 2. Liquid Nodes
        md += f"## 🟡 Liquid Context (Import and Call path outlines)\n\n"
        liquids = [n for n in dilated if n["state"] == "liquid"]
        if liquids:
            md += f"```python\n"
            for l in liquids:
                md += f"{l['representation']}\n\n"
            md += f"```\n\n"
        else:
            md += f"*No liquid call path outlines loaded.*\n\n"
            
        # 3. Gas Nodes
        md += f"## 🔵 Gas Context (General Codebase Directory)\n\n"
        gases = [n for n in dilated if n["state"] == "gas"]
        for g in gases:
            analogy = generate_analogy(g["node_id"], g["node_type"])
            md += f"- **`{g['node_id']}`** ({g['node_type']}) — Gravity: {g['gravity']}\n"
            md += f"  *Analogy*: {analogy}\n"
            
        deck_path = os.path.join(WORKSPACE_DIR, ".owl_context.md")
        with open(deck_path, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"[OWL DAEMON] Context deck updated: {deck_path}")
    except Exception as e:
        print(f"[DAEMON] Failed to write context deck: {e}", file=sys.stderr)

def check_syntax(file_path: str) -> Tuple[bool, str]:
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".py":
        try:
            res = subprocess.run([sys.executable, "-m", "py_compile", file_path], capture_output=True, text=True)
            if res.returncode != 0:
                return False, res.stderr or "Python compile error"
        except Exception as e:
            return False, str(e)
    elif ext == ".js":
        try:
            res = subprocess.run(["node", "-c", file_path], capture_output=True, text=True)
            if res.returncode != 0:
                return False, res.stderr or "Node syntax error"
        except Exception as e:
            return False, str(e)
    return True, ""

def update_hebbian_transition(from_node: str, to_node: str):
    if not from_node or not to_node or from_node == to_node:
        return
    now = datetime.now(timezone.utc).isoformat() + "Z"
    try:
        with get_db_connection() as conn:
            row = conn.execute("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?", (from_node, to_node)).fetchone()
            if row:
                w = row[0]
                next_w = w + 0.15 * (1.0 - w)
                conn.execute("UPDATE synaptic_weights SET attention_weight = ?, co_occurrences = co_occurrences + 1, last_transition = ? WHERE source_id = ? AND target_id = ?", (next_w, now, from_node, to_node))
            else:
                conn.execute("INSERT INTO synaptic_weights (source_id, target_id, attention_weight, co_occurrences, last_transition) VALUES (?, ?, 0.15, 1, ?)", (from_node, to_node, now))
            conn.commit()
    except Exception as e:
        print(f"[DAEMON] Synapse weight update error: {e}", file=sys.stderr)

def handle_file_change(file_path: str):
    global LAST_SAVED_FILE, LAST_SAVE_TIME, IDLE_STATE
    rel_path = os.path.relpath(file_path, WORKSPACE_DIR).replace("\\", "/")
    now_iso = datetime.now(timezone.utc).isoformat() + "Z"
    
    # 1. Register Code Node
    try:
        with get_db_connection() as conn:
            conn.execute("""
                INSERT INTO code_nodes (id, name, node_type, filepath, created_at, updated_at)
                VALUES (?, ?, 'file', ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
            """, (rel_path, os.path.basename(rel_path), rel_path, now_iso, now_iso))
            conn.execute("UPDATE code_nodes SET edit_count = edit_count + 1 WHERE id = ?", (rel_path,))
            conn.commit()
    except Exception as e:
        print(f"[DAEMON] Node registration failed: {e}", file=sys.stderr)
        
    # Hebbian sequence updates
    current_time = time.time()
    if LAST_SAVED_FILE and (current_time - LAST_SAVE_TIME < 15.0):
        update_hebbian_transition(LAST_SAVED_FILE, rel_path)
        try:
            with get_db_connection() as conn:
                conn.execute("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)",
                             ("hebbian_spike", json.dumps({"from": LAST_SAVED_FILE, "to": rel_path, "gap_ms": int((current_time - LAST_SAVE_TIME)*1000)}), now_iso))
                conn.commit()
        except Exception:
            pass
            
    LAST_SAVED_FILE = rel_path
    LAST_SAVE_TIME = current_time
    IDLE_STATE = False
    
    # 2. Syntax Validation
    is_valid, err_msg = check_syntax(file_path)
    if not is_valid:
        print(f"[OWL DAEMON] Syntax failure in {rel_path}: {err_msg}")
        bug_id = "bug_" + hashlib.md5((err_msg + rel_path).encode()).hexdigest()[:12]
        try:
            with get_db_connection() as conn:
                conn.execute("""
                    INSERT OR IGNORE INTO code_bugs (id, bug_type, description, file_path, line_number, project, created_at, is_active)
                    VALUES (?, 'syntax_error', ?, ?, 0, 'default', ?, 1)
                """, (bug_id, err_msg[:300], rel_path, now_iso))
                conn.execute("UPDATE code_nodes SET bug_count = bug_count + 1 WHERE id = ?", (rel_path,))
                conn.execute("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)",
                             ("syntax_error_detected", json.dumps({"file": rel_path, "error": err_msg[:200]}), now_iso))
                conn.commit()
        except Exception as e:
            print(f"[DAEMON] Bug registration failed: {e}", file=sys.stderr)
            
        trigger_notification("OWL Alert: Code Broken!", f"Syntax issue in {os.path.basename(rel_path)}. Fix immediately.")
    else:
        # Resolve bug if it was active
        try:
            with get_db_connection() as conn:
                conn.execute("UPDATE code_bugs SET is_active = 0, resolution = 'Resolved by save validation' WHERE file_path = ? AND is_active = 1", (rel_path,))
                conn.execute("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)",
                             ("syntax_resolved", json.dumps({"file": rel_path}), now_iso))
                conn.commit()
        except Exception:
            pass
            
    # Write context deck
    write_context_deck(rel_path)

def check_idle_dream():
    global IDLE_STATE, LAST_IDLE_TRIGGER
    current_time = time.time()
    
    # 3-minute idle threshold (180 seconds)
    if not IDLE_STATE and (current_time - LAST_SAVE_TIME > 180.0):
        print("[OWL DAEMON] Workspace idle for 3 minutes. Running Delta Introspection...")
        IDLE_STATE = True
        LAST_IDLE_TRIGGER = current_time
        
        # Zero-Prompt Delta Introspection: check git diff
        try:
            diff = subprocess.check_output(["git", "diff", "HEAD", "--stat"], cwd=WORKSPACE_DIR, text=True).strip()
            if diff:
                now_iso = datetime.now(timezone.utc).isoformat() + "Z"
                mem_id = "checkpoint_" + hashlib.md5((diff + now_iso).encode()).hexdigest()[:12]
                content = f"AUTO-CHECKPOINT: Paused work. Uncommitted diff:\n{diff}"
                
                with get_db_connection() as conn:
                    conn.execute("""
                        INSERT OR IGNORE INTO episodic_memories 
                        (id, content, event_type, project, salience, strength, created_at, updated_at, is_active)
                        VALUES (?, ?, 'auto_checkpoint', 'default', 0.6, 1.0, ?, ?, 1)
                    """, (mem_id, content, now_iso, now_iso))
                    conn.commit()
                    
                trigger_notification("OWL Auto-Checkpoint", "silently captured recent changes into memory.")
        except Exception as e:
            print(f"[DAEMON] Introspection failed: {e}", file=sys.stderr)

def monitor_loop():
    print(f"[OWL DAEMON] Watching workspace files in: {WORKSPACE_DIR}")
    mtimes = {}
    
    # Initial scan
    for root, dirs, files in os.walk(WORKSPACE_DIR):
        # Exclude common large folders
        dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv", "__pycache__"]]
        for f in files:
            if f == ".owl_context.md":
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in [".js", ".py", ".ts", ".md", ".json", ".yaml", ".sql"]:
                full_path = os.path.join(root, f)
                try:
                    mtimes[full_path] = os.path.getmtime(full_path)
                except Exception:
                    pass
                    
    while True:
        try:
            # Sleep 1 second to throttle CPU usage
            time.sleep(1.0)
            check_idle_dream()
            
            # Scan files for mtime updates
            for root, dirs, files in os.walk(WORKSPACE_DIR):
                dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv", "__pycache__"]]
                for f in files:
                    if f == ".owl_context.md":
                        continue
                    ext = os.path.splitext(f)[1].lower()
                    if ext in [".js", ".py", ".ts", ".md", ".json", ".yaml", ".sql"]:
                        full_path = os.path.join(root, f)
                        try:
                            mtime = os.path.getmtime(full_path)
                            if full_path not in mtimes:
                                mtimes[full_path] = mtime
                                # New file detected
                                handle_file_change(full_path)
                            elif mtimes[full_path] != mtime:
                                mtimes[full_path] = mtime
                                # Modified file detected
                                handle_file_change(full_path)
                        except Exception:
                            pass
        except KeyboardInterrupt:
            print("[OWL DAEMON] Exiting background loop.")
            break
        except Exception as e:
            print(f"[DAEMON] Watcher error: {e}", file=sys.stderr)

if __name__ == "__main__":
    # Ensure database pid write
    pid_file = os.path.join(os.path.dirname(OWL_DB_PATH), "daemon.pid")
    os.makedirs(os.path.dirname(pid_file), exist_ok=True)
    
    # Check if already running
    if os.path.exists(pid_file):
        try:
            with open(pid_file, "r") as f:
                old_pid = int(f.read().strip())
            os.kill(old_pid, 0)
            print(f"[OWL DAEMON] Already running (PID: {old_pid}). Exiting.")
            sys.exit(0)
        except Exception:
            pass
            
    with open(pid_file, "w") as f:
        f.write(str(os.getpid()))
        
    try:
        monitor_loop()
    finally:
        try:
            if os.path.exists(pid_file):
                os.remove(pid_file)
        except Exception:
            pass
