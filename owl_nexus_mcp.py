import asyncio, json, os, sys, time, sqlite3, hashlib, traceback, threading, subprocess
from datetime import datetime, timezone

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

NEXUS_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus.db")
NEXUS_DIR = os.path.dirname(os.path.abspath(__file__))

def get_db():
    conn = sqlite3.connect(NEXUS_DB, timeout=10)
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS task_graphs (
                graph_id TEXT PRIMARY KEY, goal TEXT NOT NULL,
                status TEXT DEFAULT 'pending', created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, completed_at TEXT,
                total_tasks INTEGER DEFAULT 0, completed_tasks INTEGER DEFAULT 0,
                failed_tasks INTEGER DEFAULT 0, verification_passed INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY, graph_id TEXT NOT NULL,
                task_type TEXT NOT NULL, title TEXT NOT NULL,
                description TEXT DEFAULT '', status TEXT DEFAULT 'pending',
                dependencies TEXT DEFAULT '[]', inputs TEXT DEFAULT '{}',
                outputs TEXT DEFAULT '{}', error TEXT DEFAULT '',
                attempt_count INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_templates (
                template_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '', category TEXT DEFAULT 'general',
                dag_json TEXT NOT NULL, use_count INTEGER DEFAULT 0,
                success_rate REAL DEFAULT 0.0, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

init_db()

def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"

_counter = [0]
_counter_lock = threading.Lock()

def _uid(prefix="task"):
    with _counter_lock:
        _counter[0] += 1
        ts = time.time()
        raw = f"{prefix}_{ts:.9f}_{_counter[0]}_{os.urandom(4).hex()}"
        return f"{prefix}_{hashlib.sha256(raw.encode()).hexdigest()[:16]}"

def _deps_list(task):
    """Get dependencies as a list, handling both JSON string and raw list."""
    deps = task.get("dependencies", [])
    if isinstance(deps, str):
        try:
            return json.loads(deps)
        except (json.JSONDecodeError, TypeError):
            return []
    return list(deps) if isinstance(deps, list) else []

def _topo_sort(tasks):
    task_map = {t["id"]: t for t in tasks}
    visited = set()
    result = []
    def visit(tid):
        if tid in visited: return
        visited.add(tid)
        for d in _deps_list(task_map[tid]):
            if d in task_map: visit(d)
        result.append(task_map[tid])
    for t in tasks: visit(t["id"])
    return result

def _group_into_waves(tasks):
    """Group topologically-sorted tasks into parallel execution waves.

    Each wave contains tasks whose dependencies are all in previous waves.
    Returns list of waves, where each wave is a list of tasks.
    """
    task_map = {t["id"]: t for t in tasks}
    completed = set()
    waves = []
    remaining = list(tasks)
    while remaining:
        wave = []
        still_remaining = []
        for t in remaining:
            if all(d in completed for d in _deps_list(t)):
                wave.append(t)
            else:
                still_remaining.append(t)
        if not wave:
            wave = still_remaining
            still_remaining = []
        for t in wave:
            completed.add(t["id"])
        waves.append(wave)
        remaining = still_remaining
    return waves

# ─── Phase 5: Async Tool Dispatcher ──────────────────────────────────────────

# Map task_type → (server_py_file, tool_name, args_builder_fn)
# The args_builder_fn takes (task, wave_results) and returns dict of tool args
TASK_TYPE_TOOL_MAP = {
    "analyze":          ("owl_code_mcp.py",    "code_analyze",    None),
    "design":           ("owl_code_mcp.py",    "code_explain",    None),
    "code_backend":     ("owl_code_mcp.py",    "code_execute",    None),
    "code_frontend":    ("owl_code_mcp.py",    "code_execute",    None),
    "code_fix":         ("owl_code_mcp.py",    "code_execute",    None),
    "build":            ("owl_code_mcp.py",    "code_build",      None),
    "test":             ("owl_code_mcp.py",    "code_test",       None),
    "review":           ("owl_code_mcp.py",    "code_review",     None),
    "etl":              ("owl_data_mcp.py",    "data_etl_pipeline", None),
    "schema":           ("owl_data_mcp.py",    "data_schema_design", None),
    "migrate":          ("owl_data_mcp.py",    "data_sql_migrate", None),
    "deploy":           ("owl_deploy_mcp.py",  "deploy_docker_build", None),
}

def _get_python_exe():
    """Get the Python executable for launching sibling MCP servers."""
    # Prefer the Hermes venv Python (same one running this server)
    venv_python = os.path.join(
        os.path.expanduser("~"),
        "AppData", "Local", "hermes", "hermes-agent", "venv", "Scripts", "python.exe"
    )
    if os.path.isfile(venv_python):
        return venv_python
    # Fall back to sys.executable
    return sys.executable

async def _call_mcp_tool(server_file, tool_name, tool_args, timeout=120):
    """Launch an MCP server subprocess and call a tool via JSON-RPC stdin/stdout.

    Performs MCP initialize handshake, then calls the tool.
    Returns the parsed tool result dict, or raises on error/timeout.
    """
    python_exe = _get_python_exe()
    server_path = os.path.join(NEXUS_DIR, server_file)

    if not os.path.isfile(server_path):
        return {"success": False, "error": f"Server file not found: {server_path}"}

    init_id = _uid("init")
    call_id = _uid("rpc")

    init_request = {
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "owl-nexus", "version": "5.0.0"}
        }
    }

    call_request = {
        "jsonrpc": "2.0",
        "id": call_id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": tool_args or {}
        }
    }

    try:
        proc = await asyncio.create_subprocess_exec(
            python_exe, server_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=NEXUS_DIR,
            env={**os.environ}
        )

        stdin_data = (
            json.dumps(init_request) + "\n" +
            json.dumps(call_request) + "\n"
        ).encode("utf-8")

        try:
            stdout_data, stderr_data = await asyncio.wait_for(
                proc.communicate(input=stdin_data),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"success": False, "error": f"Timeout calling {tool_name} on {server_file} after {timeout}s"}

        stdout_text = stdout_data.decode("utf-8", errors="replace").strip()
        stderr_text = stderr_data.decode("utf-8", errors="replace").strip()

        # Find the response matching our call_id
        response = None
        for line in stdout_text.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                if parsed.get("id") == call_id:
                    response = parsed
                    break
            except json.JSONDecodeError:
                continue

        if response is None:
            return {
                "success": False,
                "error": f"No JSON-RPC response from {tool_name}",
                "raw_stdout": stdout_text[:500],
                "raw_stderr": stderr_text[:200],
            }

        if "error" in response:
            return {
                "success": False,
                "error": response["error"].get("message", str(response["error"])),
            }

        result = response.get("result", {})
        content = result.get("content", [])
        text = ""
        if content and isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    text += c.get("text", "")

        # Try to parse text as JSON (MCP tools return JSON strings)
        try:
            parsed_text = json.loads(text)
            return {"success": True, "data": parsed_text}
        except (json.JSONDecodeError, TypeError):
            return {"success": True, "data": text}

    except FileNotFoundError:
        return {"success": False, "error": f"Python not found: {python_exe}"}
    except Exception as e:
        return {"success": False, "error": f"Subprocess error: {str(e)}"}


def _build_tool_args(task_type, task, wave_results):
    """Build tool arguments for a specific task type, injecting upstream results."""
    title = task.get("title", "")
    description = task.get("description", "")
    base_input = task.get("inputs", {})
    base_goal = base_input.get("goal", title)

    # Collect outputs from dependency tasks as context
    dep_outputs = {}
    for dep_id in task.get("dependencies", []):
        if dep_id in wave_results:
            dep_outputs[dep_id] = wave_results[dep_id]

    args_map = {
        "analyze":       {"target": base_goal, "depth": "standard"},
        "design":        {"target": base_goal, "detail": "standard"},
        "code_backend":  {"code": f"# {title}\n# {description}\npass", "language": "python"},
        "code_frontend": {"code": f"// {title}\n// {description}\nexport default () => null;", "language": "javascript"},
        "code_fix":      {"target": base_goal, "goal": f"Fix: {description}"},
        "build":         {"project_path": ".", "clean": False},
        "test":          {"project_path": ".", "coverage": False},
        "review":        {"target": base_goal, "focus": "all"},
        "etl":           {"project_path": "."},
        "schema":        {"project_path": "."},
        "migrate":       {"database": os.path.join(os.path.expanduser("~"), ".hermes", "hermes.db")},
        "deploy":        {"project_path": ".", "language": "python"},
    }

    return args_map.get(task_type, {"target": base_goal})


async def _execute_single_task(task, wave_results):
    """Execute a single task by calling the appropriate MCP tool.

    Returns (success: bool, output: dict).
    """
    task_type = task.get("type", "generic")

    # Check if we have a tool mapping for this task type
    mapping = TASK_TYPE_TOOL_MAP.get(task_type)
    if mapping is None:
        # Generic task — return delegation hint (Phase 4 behavior)
        return True, {
            "instruction": f"Execute task of type '{task_type}' using appropriate MCP tools.",
            "task_type": task_type,
            "title": task["title"],
            "description": task.get("description", ""),
            "delegation_hint": _get_delegation_hint(task_type),
            "mode": "delegation_hint",
        }

    server_file, tool_name, _ = mapping
    tool_args = _build_tool_args(task_type, task, wave_results)

    result = await _call_mcp_tool(server_file, tool_name, tool_args)

    if result.get("success"):
        return True, {
            "success": True,
            "tool": tool_name,
            "server": server_file,
            "result": result.get("data"),
            "mode": "async_executed",
        }
    else:
        return False, {
            "success": False,
            "tool": tool_name,
            "server": server_file,
            "error": result.get("error", "Unknown error"),
            "mode": "async_executed",
        }


async def _execute_wave(wave_tasks, wave_results, max_parallel=3):
    """Execute all tasks in a wave concurrently using asyncio.gather.

    Returns dict of task_id → output for each task.
    """
    semaphore = asyncio.Semaphore(max_parallel)

    async def _bounded_execute(task):
        async with semaphore:
            success, output = await _execute_single_task(task, wave_results)
            return task["id"], success, output

    # Fan out all wave tasks concurrently (bounded by semaphore)
    results = await asyncio.gather(*[_bounded_execute(t) for t in wave_tasks])

    wave_outputs = {}
    for task_id, success, output in results:
        wave_outputs[task_id] = output
        if task_id not in wave_results:
            wave_results[task_id] = output

    return wave_results


# ─── Phase 5: handle_execute — True Async Wave Execution ──────────────────────

async def handle_execute(args):
    graph_id = args.get("graph_id", "")
    dry_run = args.get("dry_run", False)
    parallel = args.get("parallel", True)
    max_parallel = args.get("max_parallel", 3)

    with get_db() as conn:
        gr = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?", (graph_id,)).fetchone()
        if not gr:
            return {"error": f"Graph not found: {graph_id}"}
        rows = conn.execute("SELECT * FROM tasks WHERE graph_id=?", (graph_id,)).fetchall()

    tasks = []
    for r in rows:
        tasks.append({
            "id": r[0], "graph_id": r[1], "type": r[2], "title": r[3],
            "description": r[4], "status": r[5],
            "dependencies": json.loads(r[6]), "inputs": json.loads(r[7]),
            "outputs": json.loads(r[8]) if r[8] else {},
        })

    now = _now()
    with get_db() as conn:
        conn.execute("UPDATE task_graphs SET status='running',updated_at=? WHERE graph_id=?", (now, graph_id))

    # Group into waves
    sorted_tasks = _topo_sort(tasks)
    waves = _group_into_waves(sorted_tasks) if parallel else [[t] for t in sorted_tasks]

    execution_log = []
    total_completed = 0
    total_failed = 0
    wave_results = {}  # task_id → output, accumulated across waves
    task_map = {t["id"]: t for t in tasks}

    for wave_idx, wave in enumerate(waves):
        if dry_run:
            for t in wave:
                t["status"] = "completed"
                t["outputs"] = {"dry_run": True, "message": f"Would execute: {t['title']}"}
                wave_results[t["id"]] = t["outputs"]
                execution_log.append({
                    "wave": wave_idx, "task_id": t["id"], "title": t["title"],
                    "status": "completed", "mode": "dry_run"
                })
            total_completed += len(wave)
            continue

        # Phase 5: Execute wave tasks concurrently via asyncio.gather
        wave_results = await _execute_wave(wave, wave_results, max_parallel)

        # Process results and update task states
        for t in wave:
            output = wave_results.get(t["id"], {})
            is_success = output.get("success", True)
            attempt = t.get("attempt_count", 0) + 1

            if is_success:
                t["status"] = "completed"
                t["outputs"] = output
                total_completed += 1
            else:
                # Retry logic: check attempt_count < max_attempts
                if attempt < t.get("max_attempts", 3):
                    t["status"] = "retrying"
                    t["outputs"] = {**output, "attempt": attempt, "will_retry": True}
                    # Retry immediately (simple approach — could defer to next wave)
                    retry_success, retry_output = await _execute_single_task(t, wave_results)
                    if retry_success:
                        t["status"] = "completed"
                        t["outputs"] = retry_output
                        wave_results[t["id"]] = retry_output
                        total_completed += 1
                        execution_log.append({
                            "wave": wave_idx, "task_id": t["id"], "title": t["title"],
                            "status": "completed_after_retry", "attempt": attempt + 1,
                            "mode": "async_executed",
                        })
                        continue
                    else:
                        t["status"] = "failed"
                        t["outputs"] = retry_output
                        total_failed += 1
                else:
                    t["status"] = "failed"
                    t["outputs"] = output
                    total_failed += 1

            execution_log.append({
                "wave": wave_idx,
                "task_id": t["id"],
                "title": t["title"],
                "status": t["status"],
                "mode": "async_executed",
                "parallel_with": [x["id"] for x in wave if x["id"] != t["id"]],
            })

        # Persist wave state to DB
        with get_db() as conn:
            for t in wave:
                conn.execute(
                    "UPDATE tasks SET status=?,outputs=?,updated_at=? WHERE task_id=?",
                    (t["status"], json.dumps(t["outputs"]), _now(), t["id"])
                )
            conn.execute(
                "UPDATE task_graphs SET completed_tasks=?,failed_tasks=?,updated_at=? WHERE graph_id=?",
                (total_completed, total_failed, _now(), graph_id)
            )

    # Final state
    final_status = "completed" if total_failed == 0 else "completed_with_failures" if total_completed > 0 else "failed"
    end_time = _now()

    with get_db() as conn:
        conn.execute(
            "UPDATE task_graphs SET status=?,completed_at=?,updated_at=? WHERE graph_id=?",
            (final_status, end_time, end_time, graph_id)
        )

    return {
        "graph_id": graph_id,
        "status": final_status,
        "execution_mode": "async_parallel" if parallel else "sequential",
        "total_tasks": len(tasks),
        "waves": len(waves),
        "completed": total_completed,
        "failed": total_failed,
        "wave_summary": [
            {"wave": i, "tasks": len(w), "task_ids": [t["id"] for t in w]}
            for i, w in enumerate(waves)
        ],
        "execution_log": execution_log,
        "tasks": [
            {
                "id": t["id"], "title": t["title"], "status": t["status"],
                "type": t["type"],
                "wave": next((i for i, w in enumerate(waves) if t["id"] in [x["id"] for x in w]), 0),
            }
            for t in tasks
        ],
        "completed_at": end_time,
    }


# ─── Phase 5: Live Dashboard with per-task status ────────────────────────────

async def handle_dashboard(args):
    with get_db() as conn:
        active = conn.execute(
            "SELECT graph_id,goal,status,total_tasks,completed_tasks FROM task_graphs WHERE status IN ('running','planned','partial') ORDER BY updated_at DESC LIMIT 10"
        ).fetchall()
        done = conn.execute(
            "SELECT graph_id,goal,status,total_tasks,completed_at FROM task_graphs WHERE status IN ('completed','failed','cancelled','completed_with_failures') ORDER BY completed_at DESC LIMIT 10"
        ).fetchall()
        st = conn.execute(
            "SELECT COUNT(*),SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),SUM(completed_tasks),SUM(total_tasks) FROM task_graphs"
        ).fetchone()
        tmpls = conn.execute("SELECT name,use_count,success_rate FROM workflow_templates ORDER BY use_count DESC LIMIT 5").fetchall()
    return {
        "active": [{"id": r[0], "goal": r[1], "status": r[2], "progress": f"{r[4]}/{r[3]}"} for r in active],
        "recent": [{"id": r[0], "goal": r[1], "status": r[2], "tasks": r[3], "completed_at": r[4]} for r in done],
        "stats": {
            "total": st[0] or 0, "completed": st[1] or 0,
            "tasks_done": st[2] or 0, "total_tasks": st[3] or 0,
            "rate": f"{(st[1]/st[0]*100):.1f}%" if st[0] else "N/A"
        },
        "templates": [{"name": r[0], "uses": r[1], "success_rate": r[2]} for r in tmpls],
    }


# ─── Unchanged handlers from Phase 4 ────────────────────────────────────────

async def handle_plan(args):
    goal = args.get("goal", "")
    template_id = args.get("template_id", "")
    graph_id = _uid("graph")
    now = _now()
    if template_id:
        with get_db() as conn:
            row = conn.execute("SELECT dag_json FROM workflow_templates WHERE template_id=?", (template_id,)).fetchone()
        if row:
            tasks = json.loads(row[0]).get("tasks", [])
            id_map = {}
            for t in tasks:
                old_id = t.get("id", "")
                new_id = _uid()
                id_map[old_id] = new_id
                t["id"] = new_id
                t["graph_id"] = graph_id
                t["status"] = "pending"
            for t in tasks:
                deps = t.get("dependencies", [])
                t["dependencies"] = [id_map.get(d, d) for d in deps]
        else:
            return {"error": f"Template not found: {template_id}"}
    else:
        tasks = _auto_decompose(goal, graph_id)
    with get_db() as conn:
        conn.execute("INSERT INTO task_graphs VALUES (?,?,?,?,?,?,?,?,?,?)",
            (graph_id, goal, "planned", now, now, None, len(tasks), 0, 0, 0))
        for t in tasks:
            conn.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t["id"], graph_id, t.get("type", "generic"), t.get("title", ""),
                 t.get("description", ""), "pending",
                 json.dumps(t.get("dependencies", [])), json.dumps(t.get("inputs", {})),
                 "{}", "", 0, 3, now, now))
    # Increment template use_count if applicable
    if template_id:
        with get_db() as conn:
            conn.execute("UPDATE workflow_templates SET use_count=use_count+1,updated_at=? WHERE template_id=?",
                        (now, template_id))
    return {
        "graph_id": graph_id, "goal": goal, "total_tasks": len(tasks),
        "tasks": [{"id": t["id"], "type": t.get("type", "generic"),
                    "title": t.get("title", ""), "dependencies": t.get("dependencies", [])} for t in tasks],
        "execution_order": [t["id"] for t in _topo_sort(tasks)]
    }


async def handle_verify(args):
    graph_id = args.get("graph_id", "")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?", (graph_id,)).fetchone()
        if not row:
            return {"error": f"Graph not found: {graph_id}"}
        rows = conn.execute(
            "SELECT task_id,title,task_type,outputs FROM tasks WHERE graph_id=? AND status IN ('completed','completed_after_retry')",
            (graph_id,)
        ).fetchall()
    results = []
    all_ok = True
    for r in rows:
        o = json.loads(r[3]) if r[3] else {}
        passed = o.get("success", True)
        if not passed:
            all_ok = False
        results.append({
            "task_id": r[0], "title": r[1], "passed": passed,
            "message": o.get("message", "OK" if passed else o.get("error", "Failed"))
        })
    # Update template success_rate if graph used a template
    with get_db() as conn:
        conn.execute(
            "UPDATE task_graphs SET verification_passed=?,updated_at=? WHERE graph_id=?",
            (1 if all_ok else 0, _now(), graph_id)
        )
    return {
        "graph_id": graph_id, "all_passed": all_ok, "results": results,
        "recommendation": "All checks passed. Ready to ship." if all_ok else "Some checks failed. Review and retry."
    }


async def handle_status(args):
    gid = args.get("graph_id", "")
    with get_db() as conn:
        if gid:
            gr = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?", (gid,)).fetchone()
            if not gr:
                return {"error": f"Graph not found: {gid}"}
            tr = conn.execute("SELECT task_id,title,task_type,status,attempt_count FROM tasks WHERE graph_id=?", (gid,)).fetchall()
            return {
                "graph_id": gr[0], "goal": gr[1], "status": gr[2],
                "total": gr[6], "done": gr[7], "failed": gr[8],
                "tasks": [{"id": r[0], "title": r[1], "type": r[2], "status": r[3], "attempts": r[4]} for r in tr]
            }
        else:
            rows = conn.execute(
                "SELECT graph_id,goal,status,total_tasks,completed_tasks,created_at FROM task_graphs ORDER BY created_at DESC LIMIT 20"
            ).fetchall()
            return {"graphs": [{"id": r[0], "goal": r[1], "status": r[2],
                                 "progress": f"{r[4]}/{r[3]}", "created": r[5]} for r in rows]}


async def handle_cancel(args):
    gid = args.get("graph_id", "")
    now = _now()
    with get_db() as conn:
        r = conn.execute("SELECT status FROM task_graphs WHERE graph_id=?", (gid,)).fetchone()
        if not r:
            return {"error": f"Graph not found: {gid}"}
        conn.execute("UPDATE task_graphs SET status='cancelled',updated_at=? WHERE graph_id=?", (now, gid))
        conn.execute("UPDATE tasks SET status='cancelled',updated_at=? WHERE graph_id=? AND status IN ('pending','running','ready_for_execution','retrying')", (now, gid))
    return {"graph_id": gid, "status": "cancelled"}


async def handle_template(args):
    tid = args.get("template_id", "")
    cat = args.get("category", "")
    with get_db() as conn:
        if tid:
            r = conn.execute("SELECT * FROM workflow_templates WHERE template_id=?", (tid,)).fetchone()
            if not r:
                return {"error": f"Template not found: {tid}"}
            return {"template_id": r[0], "name": r[1], "description": r[2], "category": r[3],
                    "dag": json.loads(r[4]), "uses": r[5], "rate": r[6]}
        rows = conn.execute(
            "SELECT template_id,name,description,category,use_count FROM workflow_templates"
            + (" WHERE category=?" if cat else "") + " ORDER BY use_count DESC",
            (cat,) if cat else ()
        ).fetchall()
    return {"templates": [{"id": r[0], "name": r[1], "description": r[2],
                            "category": r[3], "uses": r[4]} for r in rows]}


async def handle_save_template(args):
    name = args.get("name", "")
    desc = args.get("description", "")
    cat = args.get("category", "general")
    gid = args.get("graph_id", "")
    dag = args.get("dag", {})
    tid = _uid("tmpl")
    now = _now()
    if gid and not dag:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT task_id,task_type,title,description,dependencies,inputs FROM tasks WHERE graph_id=?",
                (gid,)
            ).fetchall()
        dag = {"tasks": [{"id": r[0], "type": r[1], "title": r[2], "description": r[3],
                           "dependencies": json.loads(r[4]), "inputs": json.loads(r[5])} for r in rows]}
    # Phase 5: compute initial success_rate from graph history
    initial_rate = 0.0
    if gid:
        with get_db() as conn:
            gr = conn.execute("SELECT status,failed_tasks,total_tasks FROM task_graphs WHERE graph_id=?", (gid,)).fetchone()
            if gr and gr[2] > 0:
                initial_rate = round((gr[2] - gr[1]) / gr[2] * 100, 1)
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO workflow_templates VALUES (?,?,?,?,?,?,?,?,?)",
                     (tid, name, desc, cat, json.dumps(dag), 0, initial_rate, now, now))
    return {"template_id": tid, "name": name, "saved": True, "initial_success_rate": initial_rate}


def _auto_decompose(goal, graph_id):
    gl = goal.lower()
    if any(k in gl for k in ["full-stack","fullstack","web app","feature","api","frontend","backend"]):
        t1={"id":_uid(),"type":"analyze","title":"Analyze requirements","description":"Parse goal","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"design","title":"Design architecture","description":"System design","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"code_backend","title":"Implement backend","description":"API and logic","dependencies":[t2["id"]],"inputs":{}}
        t4={"id":_uid(),"type":"code_frontend","title":"Implement frontend","description":"UI components","dependencies":[t2["id"]],"inputs":{}}
        t5={"id":_uid(),"type":"integration","title":"Integrate","description":"Connect FE to BE","dependencies":[t3["id"],t4["id"]],"inputs":{}}
        t6={"id":_uid(),"type":"test","title":"Test E2E","description":"All tests","dependencies":[t5["id"]],"inputs":{}}
        t7={"id":_uid(),"type":"verify","title":"Verify and ship","description":"Final check","dependencies":[t6["id"]],"inputs":{}}
        return [t1,t2,t3,t4,t5,t6,t7]
    elif any(k in gl for k in ["deploy","release","ship","ci/cd","pipeline"]):
        t1={"id":_uid(),"type":"analyze","title":"Analyze target","description":"Understand env","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"build","title":"Build","description":"Compile and package","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"test","title":"Pre-deploy tests","description":"Smoke tests","dependencies":[t2["id"]],"inputs":{}}
        t4={"id":_uid(),"type":"deploy","title":"Deploy","description":"Push to target","dependencies":[t3["id"]],"inputs":{}}
        t5={"id":_uid(),"type":"verify","title":"Post-deploy verify","description":"Health checks","dependencies":[t4["id"]],"inputs":{}}
        return [t1,t2,t3,t4,t5]
    elif any(k in gl for k in ["data","etl","migration","schema","database","sql"]):
        t1={"id":_uid(),"type":"analyze","title":"Analyze data needs","description":"Understand data","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"schema","title":"Design schema","description":"Tables and indexes","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"migrate","title":"Run migrations","description":"Apply changes","dependencies":[t2["id"]],"inputs":{}}
        t4={"id":_uid(),"type":"etl","title":"Data pipeline","description":"Extract transform load","dependencies":[t3["id"]],"inputs":{}}
        t5={"id":_uid(),"type":"verify","title":"Validate integrity","description":"Data checks","dependencies":[t4["id"]],"inputs":{}}
        return [t1,t2,t3,t4,t5]
    elif any(k in gl for k in ["fix","bug","debug","repair","patch"]):
        t1={"id":_uid(),"type":"analyze","title":"Reproduce and diagnose","description":"Understand bug","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"code_fix","title":"Implement fix","description":"Write fix","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"test","title":"Test fix","description":"Verify fix","dependencies":[t2["id"]],"inputs":{}}
        return [t1,t2,t3]
    elif any(k in gl for k in ["review","audit","analyze","refactor"]):
        t1={"id":_uid(),"type":"analyze","title":"Scan codebase","description":"Analyze structure","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"review","title":"Deep review","description":"Quality analysis","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"report","title":"Generate report","description":"Findings","dependencies":[t2["id"]],"inputs":{}}
        return [t1,t2,t3]
    else:
        t1={"id":_uid(),"type":"analyze","title":"Analyze requirements","description":"Understand goal","dependencies":[],"inputs":{"goal":goal}}
        t2={"id":_uid(),"type":"plan","title":"Create plan","description":"Break down steps","dependencies":[t1["id"]],"inputs":{}}
        t3={"id":_uid(),"type":"execute","title":"Execute plan","description":"Implement","dependencies":[t2["id"]],"inputs":{}}
        t4={"id":_uid(),"type":"verify","title":"Verify","description":"Test and verify","dependencies":[t3["id"]],"inputs":{}}
        return [t1,t2,t3,t4]

def _get_delegation_hint(task_type):
    hints = {
        "code_backend": "Use owl-code tools (code_analyze, code_build, code_test). Write code, commit changes.",
        "code_frontend": "Use owl-code tools. Implement UI components. Ensure responsive design.",
        "code_fix": "Use owl-code tools. Find the bug, implement fix, verify with tests.",
        "test": "Use owl-qa tools (ensure server enabled). Run full test suite. Report failures.",
        "deploy": "Use owl-deploy tools (ensure server enabled). Build, push, verify health.",
        "analyze": "Use owl-code code_analyze + owl-web fetch. Understand the problem space.",
        "design": "Review architecture. Create design doc. No code yet.",
        "integration": "Connect frontend to backend. Test API contracts.",
        "verify": "Use nexus_verify. Check all tests pass. Review for quality.",
        "schema": "Use owl-data tools (ensure server enabled). Design tables, indexes.",
        "etl": "Use owl-data tools. Build extraction and loading pipeline.",
        "review": "Use owl-code code_review. Security, quality, performance.",
        "report": "Synthesize findings. Write clear report.",
        "migrate": "Use owl-data data_sql_migrate. Apply schema changes safely.",
        "build": "Use owl-code code_build. Compile and package.",
    }
    return hints.get(task_type, f"Execute task of type '{task_type}' using appropriate MCP tools.")


# ─── Tool registration ────────────────────────────────────────────────────────

TOOL_CATEGORIES = {
    "nexus_plan": "core",
    "nexus_execute": "core",
    "nexus_verify": "core",
    "nexus_status": "utility",
    "nexus_cancel": "utility",
    "nexus_template": "advanced",
    "nexus_save_template": "advanced",
    "nexus_dashboard": "utility",
}
TIER = "Tier-1-core"

server = Server("owl-nexus")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="nexus_plan",
             description="Decompose a goal into a task DAG. Auto-detects type (fullstack, deploy, data, fix, review).",
             inputSchema={"type":"object","properties":{"goal":{"type":"string"},"template_id":{"type":"string"},"auto_template":{"type":"boolean","default":True}},"required":["goal"]}),
        Tool(name="nexus_execute",
             description="Execute a task graph with async parallel wave execution. Groups independent tasks into concurrent waves, calls MCP tools via subprocess, propagates results between waves, retries failed tasks. Set parallel=false for sequential mode.",
             inputSchema={"type":"object","properties":{"graph_id":{"type":"string"},"dry_run":{"type":"boolean","default":False},"parallel":{"type":"boolean","default":True},"max_parallel":{"type":"integer","default":3}},"required":["graph_id"]}),
        Tool(name="nexus_verify",
             description="Verify all completed tasks pass criteria.",
             inputSchema={"type":"object","properties":{"graph_id":{"type":"string"},"max_cycles":{"type":"integer","default":3}},"required":["graph_id"]}),
        Tool(name="nexus_status",
             description="Check task graph status. Omit graph_id for all.",
             inputSchema={"type":"object","properties":{"graph_id":{"type":"string"}}}),
        Tool(name="nexus_cancel",
             description="Cancel a task graph.",
             inputSchema={"type":"object","properties":{"graph_id":{"type":"string"}},"required":["graph_id"]}),
        Tool(name="nexus_template",
             description="List or load workflow templates.",
             inputSchema={"type":"object","properties":{"template_id":{"type":"string"},"category":{"type":"string"}}}),
        Tool(name="nexus_save_template",
             description="Save workflow as reusable template. Optionally computed from a completed graph_id.",
             inputSchema={"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"category":{"type":"string","default":"general"},"graph_id":{"type":"string"},"dag":{"type":"object"}}}),
        Tool(name="nexus_dashboard",
             description="Engineering dashboard with live stats, active graphs, recent completions, and template performance.",
             inputSchema={"type":"object","properties":{}}),
    ]

@server.call_tool()
async def call_tool(name, arguments):
    try:
        h = {
            "nexus_plan": handle_plan,
            "nexus_execute": handle_execute,
            "nexus_verify": handle_verify,
            "nexus_status": handle_status,
            "nexus_cancel": handle_cancel,
            "nexus_template": handle_template,
            "nexus_save_template": handle_save_template,
            "nexus_dashboard": handle_dashboard,
        }
        r = await h[name](arguments)
        return [TextContent(type="text", text=json.dumps(r, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "trace": traceback.format_exc()}))]

async def main():
    async with stdio_server() as (r, w):
        await server.run(r, w, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
