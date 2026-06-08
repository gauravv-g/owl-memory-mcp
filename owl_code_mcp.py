import asyncio, json, os, sys, subprocess, traceback, shutil
from datetime import datetime, timezone

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

WORKSPACE = os.path.expanduser("~")
def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"
def _run_cmd(cmd, cwd=".", timeout=120):
    try:
        r = subprocess.run(cmd, shell=True, cwd=cwd, timeout=timeout, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return {"success": r.returncode == 0, "stdout": r.stdout[:5000], "stderr": r.stderr[:2000], "cmd": cmd}
    except subprocess.TimeoutExpired: return {"success": False, "error": f"Timeout {timeout}s"}
    except Exception as e: return {"success": False, "error": str(e)}
def _detect(path):
    r = {"language": "unknown", "build": "unknown", "test": "unknown"}
    if not os.path.isdir(path): return r
    f = set(os.listdir(path))
    if "package.json" in f:
        r["language"] = "javascript"
        r["pm"] = "npm"
        try:
            with open(os.path.join(path,"package.json")) as fh: p = json.load(fh)
            d = {**p.get("dependencies",{}), **p.get("devDependencies",{})}
            if "typescript" in d: r["language"] = "typescript"
            if "react" in d: r["framework"] = "react"
            if "jest" in d: r["test"] = "jest"
            elif "vitest" in d: r["test"] = "vitest"
        except: pass
    elif "requirements.txt" in f or "pyproject.toml" in f:
        r["language"] = "python"; r["pm"] = "pip"
    elif "Cargo.toml" in f: r["language"] = "rust"
    elif "go.mod" in f: r["language"] = "go"
    return r

async def handle_analyze(args):
    t = os.path.abspath(args.get("target","."))
    d = args.get("depth","standard")
    if os.path.isfile(t):
        try:
            with open(t, encoding="utf-8", errors="replace") as fh: c = fh.read()
        except Exception as e: return {"error": str(e)}
        l = c.splitlines()
        r = {"file": t, "lines": len(l), "size": os.path.getsize(t), "lang": os.path.splitext(t)[1]}
        if d != "quick":
            r["imports"] = [x for x in l if x.strip().startswith(("import ","from ","require(","#include"))][:20]
            r["funcs"] = [x for x in l if any(k in x for k in ["def ","function ","fn ","func "])][:20]
            r["classes"] = [x for x in l if "class " in x][:20]
        return r
    p = _detect(t)
    fc = {}; tl = 0
    for root, dirs, files in os.walk(t):
        dirs[:] = [x for x in dirs if x not in {"node_modules",".git","__pycache__",".venv","venv","dist","build"}]
        for f in files:
            e = os.path.splitext(f)[1] or "(none)"
            fc[e] = fc.get(e,0)+1
            try:
                with open(os.path.join(root,f),encoding="utf-8",errors="replace") as fh: tl += len(fh.readlines())
            except: pass
    return {"project": t, "type": p, "files": sum(fc.values()), "lines": tl, "by_ext": dict(sorted(fc.items(),key=lambda x:-x[1])[:15])}

async def handle_build(args):
    path = os.path.abspath(args.get("project_path","."))
    p = _detect(path)
    lang = p.get("language","")
    cmds = []
    if lang in ("javascript","typescript"):
        if args.get("clean"): cmds.append("rm -rf dist .next node_modules/.cache")
        cmds.append("npm run build")
    elif lang == "python":
        if os.path.isfile(os.path.join(path,"pyproject.toml")): cmds.append("pip install -e .")
    elif lang == "rust": cmds.append("cargo build")
    elif lang == "go": cmds.append("go build ./...")
    if not cmds: return {"warning": "No build detected", "type": p}
    rs = [_run_cmd(c, cwd=path, timeout=300) for c in cmds]
    return {"success": all(r["success"] for r in rs), "type": p, "results": rs}

async def handle_test(args):
    path = os.path.abspath(args.get("project_path","."))
    p = _detect(path)
    lang = p.get("language","")
    fw = p.get("test","")
    t = args.get("target","")
    cov = args.get("coverage",False)
    cmds = []
    if lang in ("javascript","typescript"):
        if fw == "jest": cmds.append(f"npx jest {t} " + ("--coverage" if cov else ""))
        elif fw == "vitest": cmds.append(f"npx vitest run {t}")
        else: cmds.append("npm test")
    elif lang == "python":
        if fw == "pytest": cmds.append(("python -m pytest " + (t or "tests/") + " -v" + (" --cov=." if cov else "")))
    elif lang == "rust": cmds.append("cargo test")
    elif lang == "go": cmds.append(("go test " + (t or "./...") + (" -cover" if cov else "")))
    if not cmds: return {"warning": "No test framework", "type": p}
    rs = [_run_cmd(c, cwd=path, timeout=300) for c in cmds]
    return {"success": all(r["success"] for r in rs), "type": p, "results": rs}

async def handle_lint(args):
    path = os.path.abspath(args.get("project_path","."))
    p = _detect(path)
    lang = p.get("language","")
    fix = args.get("fix",False)
    rs = []
    if lang in ("javascript","typescript"):
        rs.append(("eslint", _run_cmd(f"npx eslint {'--fix' if fix else ''} . 2>&1", cwd=path)))
        if lang == "typescript": rs.append(("tsc", _run_cmd("npx tsc --noEmit", cwd=path)))
    elif lang == "python":
        if shutil.which("ruff"): rs.append(("ruff", _run_cmd("ruff check " + ("--fix " if fix else "") + ". 2>&1", cwd=path)))
        if shutil.which("mypy"): rs.append(("mypy", _run_cmd("mypy . 2>&1", cwd=path)))
    elif lang == "rust":
        rs.append(("clippy", _run_cmd("cargo clippy 2>&1", cwd=path)))
    elif lang == "go":
        if shutil.which("golangci-lint"): rs.append(("lint", _run_cmd("golangci-lint run 2>&1", cwd=path)))
        else: rs.append(("vet", _run_cmd("go vet ./... 2>&1", cwd=path)))
    if not rs: return {"warning": "No linter configured"}
    return {"success": all(r[1]["success"] for r in rs), "results": [{"name":n,"ok":r["success"]} for n,r in rs]}

async def handle_execute(args):
    code = args.get("code",""); lang = args.get("language","python"); fp = args.get("file_path",""); timeout = args.get("timeout",30)
    if fp:
        fp = os.path.abspath(fp)
        if not os.path.exists(fp): return {"error": f"Not found: {fp}"}
        ext = os.path.splitext(fp)[1]
        runner = {".py":"python",".js":"node",".sh":"bash",".rb":"ruby",".go":"go run"}.get(ext, lang)
        r = _run_cmd(f"{runner} {fp}", timeout=timeout); r["type"]="file"; return r
    elif code:
        import tempfile
        ext_map = {"python":".py","node":".js","javascript":".js","bash":".sh","shell":".sh",".rb":"ruby"}
        ext = ext_map.get(lang,".py")
        runner = {"node":"node","javascript":"node","bash":"bash","shell":"bash","ruby":"ruby"}.get(lang,lang)
        with tempfile.NamedTemporaryFile(mode="w",suffix=ext,delete=False) as f: f.write(code); tmp=f.name
        try:
            r = _run_cmd(f"{runner} {tmp}", timeout=timeout)
        finally: os.unlink(tmp)
        r["type"] = "snippet"; return r
    return {"error": "Provide code or file_path"}

async def handle_review(args):
    t = os.path.abspath(args.get("target","."))
    focus = args.get("focus","all")
    if os.path.isfile(t):
        try:
            with open(t,encoding="utf-8",errors="replace") as f: c = f.read()
        except Exception as e: return {"error": str(e)}
        l = c.splitlines(); issues = []
        import re
        Q = "'"
        checks = [(r"eval\(","CRITICAL","Code injection"),(r"exec\(","CRITICAL","Code injection"),("password\\s*=\\s*["+Q+'"]',"HARDCODED","Hardcoded password"),("api[_-]?key\\s*=\\s*["+Q+'"]',"HARDCODED","Hardcoded API key"),(r"DEBUG\s*=\s*True","CONFIG","DEBUG=True in prod"),(r"verify\s*=\s*False","SECURITY","SSL verify disabled")]
        for pat,sev,msg in checks:
            for i,line in enumerate(l,1):
                if re.search(pat,line,re.IGNORECASE): issues.append({"line":i,"sev":sev,"msg":msg,"code":line.strip()[:80]})
        return {"file":t,"lines":len(l),"issues":issues,"count":len(issues)}
    fc=0; ti=0; fi=[]
    import re
    for root,dirs,files in os.walk(t):
        dirs[:] = [d for d in dirs if d not in {"node_modules",".git","__pycache__",".venv","venv","dist","build"}]
        for f in files:
            if f.endswith((".py",".js",".ts",".go",".rs")):
                try:
                    with open(os.path.join(root,f),encoding="utf-8",errors="replace") as fh: c=fh.read()
                    n = sum(1 for p in [r"eval\(","password\s*=\s*['\"]","api[_-]?key\s*=\s*['\"]","DEBUG\s*=\s*True"] if re.search(p,c,re.IGNORECASE))
                    if n>0: fi.append({"file":os.path.relpath(os.path.join(root,f),t),"issues":n}); ti+=n
                    fc+=1
                except: pass
    return {"project":t,"scanned":fc,"issues":ti,"files":fi[:20]}

async def handle_refactor(args):
    t = os.path.abspath(args.get("target","")); g = args.get("goal","")
    plans = {"extract_function":["Identify block","Create function","Replace call","Add types","Test"],"rename":["Find occurrences","Rename","Update imports","Test"],"simplify":["Find complexity","Early returns","Extract vars","Test"],"optimize":["Profile","Fix algorithms","Add cache","Benchmark"],"add_types":["Add signatures","Run type fixer","Verify"]}
    return {"target":t,"goal":g,"steps":plans.get(g,["Analyze",f"Apply: {g}","Verify"])}

async def handle_explain(args):
    t = os.path.abspath(args.get("target",".")); d = args.get("detail","standard")
    if os.path.isfile(t):
        try:
            with open(t,encoding="utf-8",errors="replace") as f: c=f.read()
        except Exception as e: return {"error":str(e)}
        l = c.splitlines(); ext = os.path.splitext(t)[1]
        r = {"file":t,"lang":ext,"lines":len(l)}
        if d!="quick":
            r["imports"] = [x.strip() for x in l if x.strip().startswith(("import ","from ","require("))][:10]
            r["funcs"] = [x.strip() for x in l if any(k in x for k in ["def ","function ","fn "])][:10]
            r["classes"] = [x.strip() for x in l if "class " in x][:10]
        if d=="detailed": r["start"]="\n".join(l[:20]); r["end"]="\n".join(l[-20:])
        return r
    s=[]
    for root,dirs,files in os.walk(t):
        dirs[:]=[d for d in dirs if d not in {"node_modules",".git","__pycache__",".venv","venv","dist","build"}]
        lv=root.replace(t,"").count(os.sep)
        if lv>3: continue
        s.append("  "*lv+os.path.basename(root)+"/")
        for f in files[:10]: s.append("  "*(lv+1)+f)
    return {"dir":t,"structure":s[:100]}

server = Server("owl-code")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="code_analyze",description="Analyze file or project. Detects language, build system, test framework.",
            inputSchema={"type":"object","properties":{"target":{"type":"string"},"depth":{"type":"string","enum":["quick","standard","deep"],"default":"standard"}},"required":["target"]}),
        Tool(name="code_build",description="Build project. Auto-detects build system.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"clean":{"type":"boolean","default":False}}}),
        Tool(name="code_test",description="Run tests. Auto-detects framework.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"target":{"type":"string"},"coverage":{"type":"boolean","default":False}}}),
        Tool(name="code_lint",description="Lint and type-check. Auto-detects linters.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"fix":{"type":"boolean","default":False}}}),
        Tool(name="code_execute",description="Execute script or snippet. Python, JS, Bash, Ruby, Go.",
            inputSchema={"type":"object","properties":{"code":{"type":"string"},"file_path":{"type":"string"},"language":{"type":"string","default":"python"},"timeout":{"type":"integer","default":30}}}),
        Tool(name="code_review",description="Review code for security, quality, performance.",
            inputSchema={"type":"object","properties":{"target":{"type":"string"},"focus":{"type":"string","enum":["all","security","performance","style"],"default":"all"}},"required":["target"]}),
        Tool(name="code_refactor",description="Refactoring plan: extract_function, rename, simplify, optimize, add_types.",
            inputSchema={"type":"object","properties":{"target":{"type":"string"},"goal":{"type":"string"}},"required":["target","goal"]}),
        Tool(name="code_explain",description="Explain what code does.",
            inputSchema={"type":"object","properties":{"target":{"type":"string"},"detail":{"type":"string","enum":["brief","standard","detailed"],"default":"standard"}},"required":["target"]}),
    ]

@server.call_tool()
async def call_tool(name, arguments):
    try:
        h = {"code_analyze":handle_analyze,"code_build":handle_build,"code_test":handle_test,"code_lint":handle_lint,
             "code_execute":handle_execute,"code_review":handle_review,"code_refactor":handle_refactor,"code_explain":handle_explain}
        r = await h[name](arguments)
        return [TextContent(type="text",text=json.dumps(r, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text",text=json.dumps({"error":str(e),"trace":traceback.format_exc()}))]

async def main():
    async with stdio_server() as (r,w):
        await server.run(r,w,server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
