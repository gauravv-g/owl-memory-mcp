import asyncio, json, os, sys, subprocess, traceback, shutil
from datetime import datetime, timezone

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"

def _run_cmd(cmd, cwd=".", timeout=120):
    try:
        r = subprocess.run(cmd, shell=True, cwd=cwd, timeout=timeout, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return {"success": r.returncode == 0, "stdout": r.stdout[:5000], "stderr": r.stderr[:2000], "cmd": cmd}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def _detect(path):
    r = {"has_docker": False, "has_compose": False, "has_k8s": False, "ci": "unknown"}
    if not os.path.isdir(path): return r
    f = set(os.listdir(path))
    if "Dockerfile" in f: r["has_docker"] = True
    if "docker-compose.yml" in f: r["has_compose"] = True
    if os.path.isdir(os.path.join(path, "k8s")): r["has_k8s"] = True
    if os.path.isdir(os.path.join(path, ".github")): r["ci"] = "github_actions"
    return r

async def handle_dockerfile_generate(args):
    path = os.path.abspath(args.get("project_path","."))
    lang = args.get("language","python")
    templates = {
        "python": "FROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install -r requirements.txt\nCOPY . .\nCMD [\"python\", \"main.py\"]",
        "node": "FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"index.js\"]",
        "go": "FROM golang:1.22-alpine AS build\nWORKDIR /app\nCOPY . .\nRUN go build -o server\nFROM alpine:latest\nCOPY --from=build /app/server /server\nEXPOSE 8080\nCMD [\"/server\"]",
    }
    df = templates.get(lang, templates["python"])
    target = os.path.join(path, "Dockerfile")
    with open(target, "w") as f: f.write(df + "\n")
    return {"created": target, "language": lang}

async def handle_docker_build(args):
    path = os.path.abspath(args.get("project_path","."))
    tag = args.get("tag","app:latest")
    cmd = "docker build -t " + tag + " ."
    r = _run_cmd(cmd, cwd=path, timeout=600)
    return {"success": r["success"], "tag": tag, "output": r.get("stdout","")}

async def handle_compose_generate(args):
    path = os.path.abspath(args.get("project_path","."))
    services = args.get("services",["app","db"])
    svc = []
    for s in services:
        if s == "db":
            svc.append("  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: app\n      POSTGRES_PASSWORD: secret\n    ports:\n      - \"5432:5432\"")
        elif s == "redis":
            svc.append("  redis:\n    image: redis:7-alpine\n    ports:\n      - \"6379:6379\"")
        else:
            svc.append("  app:\n    build: .\n    ports:\n      - \"3000:3000\"\n    depends_on:\n      - db")
    out = "version: \"3.8\"\nservices:\n" + "\n".join(svc)
    if "db" in services: out += "\n\nvolumes:\n  db_data:"
    target = os.path.join(path, "docker-compose.yml")
    with open(target, "w") as f: f.write(out + "\n")
    return {"created": target, "services": services}

async def handle_compose_up(args):
    path = os.path.abspath(args.get("project_path","."))
    cmd = "docker-compose up -d" + (" --build" if args.get("build",False) else "")
    r = _run_cmd(cmd, cwd=path, timeout=120)
    return {"success": r["success"], "output": r.get("stdout","")}

async def handle_compose_down(args):
    path = os.path.abspath(args.get("project_path","."))
    r = _run_cmd("docker-compose down", cwd=path, timeout=60)
    return {"success": r["success"]}

async def handle_k8s_generate(args):
    path = os.path.abspath(args.get("project_path","."))
    app = args.get("app_name","app")
    image = args.get("image","app:latest")
    port = args.get("port",3000)
    replicas = args.get("replicas",2)
    ns = args.get("namespace","default")
    k8s_path = os.path.join(path, "k8s")
    os.makedirs(k8s_path, exist_ok=True)
    yaml_path = os.path.join(k8s_path, "deployment.yaml")
    with open(yaml_path, "w") as f:
        f.write("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: " + app + "\n")
        f.write("  namespace: " + ns + "\nspec:\n  replicas: " + str(replicas) + "\n")
        f.write("  selector:\n    matchLabels:\n      app: " + app + "\n")
        f.write("  template:\n    metadata:\n      labels:\n        app: " + app + "\n")
        f.write("    spec:\n      containers:\n      - name: " + app + "\n")
        f.write("        image: " + image + "\n        ports:\n        - containerPort: " + str(port) + "\n")
        f.write("---\napiVersion: v1\nkind: Service\nmetadata:\n  name: " + app + "\n  namespace: " + ns + "\n")
        f.write("spec:\n  selector:\n    app: " + app + "\n  ports:\n  - port: 80\n    targetPort: " + str(port) + "\n")
    return {"created": yaml_path, "app": app}

async def handle_ci_generate(args):
    path = os.path.abspath(args.get("project_path","."))
    ci = args.get("system","github_actions")
    lang = args.get("language","python")
    wf_dir = os.path.join(path, ".github", "workflows")
    os.makedirs(wf_dir, exist_ok=True)
    if lang == "python":
        content = "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - uses: actions/setup-python@v5\n      with:\n        python-version: '3.11'\n    - run: pip install -r requirements.txt\n    - run: pytest tests/ -v --cov=.\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - run: pip install ruff mypy\n    - run: ruff check .\n    - run: mypy ."
    elif lang in ("javascript","typescript"):
        content = "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - uses: actions/setup-node@v4\n      with:\n        node-version: '20'\n    - run: npm ci\n    - run: npm run lint\n    - run: npm test -- --coverage"
    else:
        content = "# CI for " + lang + "\nname: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4"
    target = os.path.join(wf_dir, "ci.yml")
    with open(target, "w") as f: f.write(content)
    return {"created": target, "ci": ci}

async def handle_infra_scan(args):
    path = os.path.abspath(args.get("project_path","."))
    info = _detect(path)
    issues = []
    if not info["has_docker"]: issues.append({"severity":"info","msg":"No Dockerfile found"})
    if not info["has_compose"] and info["has_docker"]: issues.append({"severity":"info","msg":"No docker-compose.yml"})
    if info["ci"] == "unknown": issues.append({"severity":"warn","msg":"No CI/CD configured"})
    score = max(0, 100 - len(issues) * 15)
    return {"project":path,"infra":info,"issues":issues,"score":score}

async def handle_deploy_status(args):
    r = _run_cmd("docker ps --format '{{.Names}}\t{{.Status}}'", timeout=10)
    lines = r.get("stdout","").strip().split("\n") if r["success"] else []
    containers = []
    for l in lines:
        parts = l.split("\t")
        if len(parts) >= 2: containers.append({"name":parts[0],"status":parts[1]})
    return {"containers": containers, "count": len(containers)}


TOOL_CATEGORIES = {
    "deploy_dockerfile_generate": "core",
    "deploy_docker_build": "core",
    "deploy_compose_generate": "core",
    "deploy_compose_up": "core",
    "deploy_compose_down": "core",
    "deploy_k8s_generate": "advanced",
    "deploy_ci_generate": "advanced",
    "deploy_infra_scan": "utility",
    "deploy_status": "utility"
}
TIER = "Tier-2-domain"

server = Server("owl-deploy")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="deploy_dockerfile_generate",description="Generate a Dockerfile. Supports python, node, go.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"language":{"type":"string","default":"python"}}}),
        Tool(name="deploy_docker_build",description="Build a Docker image.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"tag":{"type":"string","default":"app:latest"},"no_cache":{"type":"boolean","default":False}}}),
        Tool(name="deploy_compose_generate",description="Generate docker-compose.yml with app, db, redis services.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"services":{"type":"array","items":{"type":"string"}}}}),
        Tool(name="deploy_compose_up",description="Start docker-compose services.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"detach":{"type":"boolean","default":True},"build":{"type":"boolean","default":False}}}),
        Tool(name="deploy_compose_down",description="Stop docker-compose services.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."}}}),
        Tool(name="deploy_k8s_generate",description="Generate K8s deployment and service YAML.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"app_name":{"type":"string","default":"app"},"image":{"type":"string","default":"app:latest"},"port":{"type":"integer","default":3000},"replicas":{"type":"integer","default":2}}}),
        Tool(name="deploy_ci_generate",description="Generate CI/CD config (github_actions).",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."},"system":{"type":"string","default":"github_actions"},"language":{"type":"string","default":"python"}}}),
        Tool(name="deploy_infra_scan",description="Scan project infrastructure: Docker, CI/CD, K8s.",
            inputSchema={"type":"object","properties":{"project_path":{"type":"string","default":"."}}}),
        Tool(name="deploy_status",description="Check running Docker containers.",
            inputSchema={"type":"object","properties":{}}),
    ]

@server.call_tool()
async def call_tool(name, arguments):
    try:
        h = {"deploy_dockerfile_generate":handle_dockerfile_generate,"deploy_docker_build":handle_docker_build,
             "deploy_compose_generate":handle_compose_generate,"deploy_compose_up":handle_compose_up,
             "deploy_compose_down":handle_compose_down,"deploy_k8s_generate":handle_k8s_generate,
             "deploy_ci_generate":handle_ci_generate,"deploy_infra_scan":handle_infra_scan,
             "deploy_status":handle_deploy_status}
        r = await h[name](arguments)
        return [TextContent(type="text",text=json.dumps(r, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text",text=json.dumps({"error":str(e),"trace":traceback.format_exc()}))]

async def main():
    async with stdio_server() as (r,w):
        await server.run(r,w,server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
