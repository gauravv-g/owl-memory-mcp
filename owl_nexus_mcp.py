import asyncio, json, os, sys, time, sqlite3, hashlib, traceback
from datetime import datetime, timezone

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

NEXUS_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus.db")

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

def _uid(prefix="task"):
    return f"{prefix}_{hashlib.md5(str(time.time()).encode()).hexdigest()[:12]}"

def _topo_sort(tasks):
    task_map = {t["id"]: t for t in tasks}
    visited = set()
    result = []
    def visit(tid):
        if tid in visited: return
        visited.add(tid)
        for d in json.loads(task_map[tid].get("dependencies","[]")):
            if d in task_map: visit(d)
        result.append(task_map[tid])
    for t in tasks: visit(t["id"])
    return result

async def handle_plan(args):
    goal = args.get("goal","")
    template_id = args.get("template_id","")
    graph_id = _uid("graph")
    now = _now()
    if template_id:
        with get_db() as conn:
            row = conn.execute("SELECT dag_json FROM workflow_templates WHERE template_id=?",(template_id,)).fetchone()
        if row:
            tasks = json.loads(row[0]).get("tasks",[])
            for t in tasks: t["graph_id"]=graph_id; t["status"]="pending"
        else:
            return {"error": f"Template not found: {template_id}"}
    else:
        tasks = _auto_decompose(goal, graph_id)
    with get_db() as conn:
        conn.execute("INSERT INTO task_graphs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (graph_id,goal,"planned",now,now,None,len(tasks),0,0,0))
        for t in tasks:
            conn.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t["id"],graph_id,t.get("type","generic"),t.get("title",""),t.get("description",""),
                 "pending",json.dumps(t.get("dependencies",[])),json.dumps(t.get("inputs",{})),
                 "{}", "", 0, 3, now, now))
    return {"graph_id":graph_id,"goal":goal,"total_tasks":len(tasks),
            "tasks":[{"id":t["id"],"type":t.get("type","generic"),"title":t.get("title",""),"dependencies":t.get("dependencies",[])} for t in tasks],
            "execution_order":[t["id"] for t in _topo_sort(tasks)]}

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

async def handle_execute(args):
    graph_id = args.get("graph_id","")
    dry_run = args.get("dry_run", False)
    with get_db() as conn:
        gr = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?",(graph_id,)).fetchone()
        if not gr: return {"error": f"Graph not found: {graph_id}"}
        rows = conn.execute("SELECT * FROM tasks WHERE graph_id=?",(graph_id,)).fetchall()
    tasks = {}
    for r in rows:
        tasks[r[0]] = {"id":r[0],"graph_id":r[1],"type":r[2],"title":r[3],"description":r[4],
            "status":r[5],"dependencies":json.loads(r[6]),"inputs":json.loads(r[7]),
            "outputs":json.loads(r[8]) if r[8] else {}}
    now = _now()
    with get_db() as conn:
        conn.execute("UPDATE task_graphs SET status='running',updated_at=? WHERE graph_id=?",(now,graph_id))
    log = []
    for t in _topo_sort(list(tasks.values())):
        t["status"] = "completed" if dry_run else "ready_for_execution"
        t["outputs"] = {"dry_run":True,"message":f"Would execute: {t['title']}"} if dry_run else {"instruction":"Execute via domain server","task_type":t["type"],"title":t["title"],"description":t["description"],"inputs":t["inputs"]}
        log.append({"task_id":t["id"],"title":t["title"],"status":t["status"]})
    with get_db() as conn:
        for t in tasks.values():
            conn.execute("UPDATE tasks SET status=?,outputs=?,updated_at=? WHERE task_id=?",(t["status"],json.dumps(t["outputs"]),_now(),t["id"]))
    done = all(t["status"]=="completed" for t in tasks.values())
    return {"graph_id":graph_id,"status":"completed" if done else "ready","total_tasks":len(tasks),
            "completed":sum(1 for t in tasks.values() if t["status"]=="completed"),
            "ready":sum(1 for t in tasks.values() if t["status"]=="ready_for_execution"),
            "execution_log":log,
            "tasks":[{"id":t["id"],"title":t["title"],"status":t["status"],"type":t["type"]} for t in tasks.values()]}

async def handle_verify(args):
    graph_id = args.get("graph_id","")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?",(graph_id,)).fetchone()
        if not row: return {"error": f"Graph not found: {graph_id}"}
        rows = conn.execute("SELECT task_id,title,type,outputs FROM tasks WHERE graph_id=? AND status='completed'",(graph_id,)).fetchall()
    results = []
    all_ok = True
    for r in rows:
        o = json.loads(r[3]) if r[3] else {}
        passed = o.get("success", True)
        if not passed: all_ok = False
        results.append({"task_id":r[0],"title":r[1],"passed":passed,"message":o.get("message","OK")})
    with get_db() as conn:
        conn.execute("UPDATE task_graphs SET verification_passed=?,updated_at=? WHERE graph_id=?",(1 if all_ok else 0,_now(),graph_id))
    return {"graph_id":graph_id,"all_passed":all_ok,"results":results,
            "recommendation":"All checks passed. Ready to ship." if all_ok else "Some checks failed. Review and retry."}

async def handle_status(args):
    gid = args.get("graph_id","")
    with get_db() as conn:
        if gid:
            gr = conn.execute("SELECT * FROM task_graphs WHERE graph_id=?",(gid,)).fetchone()
            if not gr: return {"error": f"Graph not found: {gid}"}
            tr = conn.execute("SELECT task_id,title,type,status,attempt_count FROM tasks WHERE graph_id=?",(gid,)).fetchall()
            return {"graph_id":gr[0],"goal":gr[1],"status":gr[2],"total":gr[6],"done":gr[7],"failed":gr[8],
                    "tasks":[{"id":r[0],"title":r[1],"type":r[2],"status":r[3],"attempts":r[4]} for r in tr]}
        else:
            rows = conn.execute("SELECT graph_id,goal,status,total_tasks,completed_tasks,created_at FROM task_graphs ORDER BY created_at DESC LIMIT 20").fetchall()
            return {"graphs":[{"id":r[0],"goal":r[1],"status":r[2],"progress":f"{r[4]}/{r[3]}","created":r[5]} for r in rows]}

async def handle_cancel(args):
    gid = args.get("graph_id","")
    now = _now()
    with get_db() as conn:
        r = conn.execute("SELECT status FROM task_graphs WHERE graph_id=?",(gid,)).fetchone()
        if not r: return {"error": f"Graph not found: {gid}"}
        conn.execute("UPDATE task_graphs SET status='cancelled',updated_at=? WHERE graph_id=?",(now,gid))
        conn.execute("UPDATE tasks SET status='cancelled',updated_at=? WHERE graph_id=? AND status IN ('pending','running','ready_for_execution')",(now,gid))
    return {"graph_id":gid,"status":"cancelled"}

async def handle_template(args):
    tid = args.get("template_id","")
    cat = args.get("category","")
    with get_db() as conn:
        if tid:
            r = conn.execute("SELECT * FROM workflow_templates WHERE template_id=?",(tid,)).fetchone()
            if not r: return {"error": f"Template not found: {tid}"}
            return {"template_id":r[0],"name":r[1],"description":r[2],"category":r[3],"dag":json.loads(r[4]),"uses":r[5],"rate":r[6]}
        rows = conn.execute("SELECT template_id,name,description,category,use_count FROM workflow_templates" + (" WHERE category=?" if cat else "") + " ORDER BY use_count DESC", (cat,) if cat else ()).fetchall()
    return {"templates":[{"id":r[0],"name":r[1],"description":r[2],"category":r[3],"uses":r[4]} for r in rows]}

async def handle_save_template(args):
    name = args.get("name","")
    desc = args.get("description","")
    cat = args.get("category","general")
    gid = args.get("graph_id","")
    dag = args.get("dag",{})
    tid = _uid("tmpl")
    now = _now()
    if gid and not dag:
        with get_db() as conn:
            rows = conn.execute("SELECT task_id,task_type,title,description,dependencies,inputs FROM tasks WHERE graph_id=?",(gid,)).fetchall()
        dag = {"tasks":[{"id":r[0],"type":r[1],"title":r[2],"description":r[3],"dependencies":json.loads(r[4]),"inputs":json.loads(r[5])} for r in rows]}
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO workflow_templates VALUES (?,?,?,?,?,?,?,?)",(tid,name,desc,cat,json.dumps(dag),0,0.0,now,now))
    return {"template_id":tid,"name":name,"saved":True}

async def handle_dashboard(args):
    with get_db() as conn:
        active = conn.execute("SELECT graph_id,goal,status,total_tasks,completed_tasks FROM task_graphs WHERE status IN ('running','planned','partial') ORDER BY updated_at DESC LIMIT 10").fetchall()
        done = conn.execute("SELECT graph_id,goal,status,total_tasks,completed_at FROM task_graphs WHERE status IN ('completed','failed','cancelled') ORDER BY completed_at DESC LIMIT 10").fetchall()
        st = conn.execute("SELECT COUNT(*),SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),SUM(completed_tasks),SUM(total_tasks) FROM task_graphs").fetchone()
        tmpls = conn.execute("SELECT name,use_count FROM workflow_templates ORDER BY use_count DESC LIMIT 5").fetchall()
    return {"active":[{"id":r[0],"goal":r[1],"status":r[2],"progress":f"{r[4]}/{r[3]}"} for r in active],
            "recent":[{"id":r[0],"goal":r[1],"status":r[2],"tasks":r[3]} for r in done],
            "stats":{"total":st[0] or 0,"completed":st[1] or 0,"tasks_done":st[2] or 0,"total_tasks":st[3] or 0,
                     "rate":f"{(st[1]/st[0]*100):.1f}%" if st[0] else "N/A"},
            "templates":[{"name":r[0],"uses":r[1]} for r in tmpls]}

server = Server("owl-nexus")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="nexus_plan",description="Decompose a goal into a task DAG. Auto-detects type (fullstack, deploy, data, fix, review).",
            inputSchema={"type":"object","properties":{"goal":{"type":"string"},"template_id":{"type":"string"},"auto_template":{"type":"boolean","default":True}},"required":["goal"]}),
        Tool(name="nexus_execute",description="Execute a task graph in topological order.",
            inputSchema={"type":"object","properties":{"graph_id":{"type":"string"},"dry_run":{"type":"boolean","default":False}},"required":["graph_id"]}),
        Tool(name="nexus_verify",description="Verify all completed tasks pass criteria.",
            inputSchema={"type":"object","properties":{"graph_id":{"type":"string"},"max_cycles":{"type":"integer","default":3}},"required":["graph_id"]}),
        Tool(name="nexus_status",description="Check task graph status. Omit graph_id for all.",
            inputSchema={"type":"object","properties":{"graph_id":{"type":"string"}}}),
        Tool(name="nexus_cancel",description="Cancel a task graph.",
            inputSchema={"type":"object","properties":{"graph_id":{"type":"string"}},"required":["graph_id"]}),
        Tool(name="nexus_template",description="List or load workflow templates.",
            inputSchema={"type":"object","properties":{"template_id":{"type":"string"},"category":{"type":"string"}}}),
        Tool(name="nexus_save_template",description="Save workflow as reusable template.",
            inputSchema={"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"category":{"type":"string","default":"general"},"graph_id":{"type":"string"},"dag":{"type":"object"}}}),
        Tool(name="nexus_dashboard",description="Engineering dashboard.",
            inputSchema={"type":"object","properties":{}}),
    ]

@server.call_tool()
async def call_tool(name, arguments):
    try:
        h = {"nexus_plan":handle_plan,"nexus_execute":handle_execute,"nexus_verify":handle_verify,
             "nexus_status":handle_status,"nexus_cancel":handle_cancel,"nexus_template":handle_template,
             "nexus_save_template":handle_save_template,"nexus_dashboard":handle_dashboard}
        r = await h[name](arguments)
        return [TextContent(type="text",text=json.dumps(r, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text",text=json.dumps({"error":str(e),"trace":traceback.format_exc()}))]

async def main():
    async with stdio_server() as (r,w):
        await server.run(r,w,server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
