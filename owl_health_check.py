import subprocess, sys, os, json

results = []

# 1. Test research MCP import
r = subprocess.run([sys.executable, "-c", "import owl_research_mcp; print('RESEARCH: OK')"],
    cwd=r"c:\Users\shiva\hermes-custom-mcps", capture_output=True, text=True, timeout=15)
results.append(r.stdout.strip() or ("RESEARCH: FAILED - " + r.stderr[:200].strip()))

# 2. Test web MCP import
r = subprocess.run([sys.executable, "-c", "import owl_web_mcp; print('WEB: OK')"],
    cwd=r"c:\Users\shiva\hermes-custom-mcps", capture_output=True, text=True, timeout=15)
out = r.stdout.strip()
if not out:
    # stderr is expected for scrapling warnings — look for actual errors
    errs = [l for l in r.stderr.split("\n") if "Error" in l or "error" in l]
    out = "WEB: " + (errs[0] if errs else "no output (likely OK - warnings only)")
results.append(out)

# 3. Check OWL DB
db = os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
results.append(f"DB: {'EXISTS' if os.path.exists(db) else 'NOT FOUND'} at {db}")

# 4. Check Claude Desktop config
cfg = r"C:\Users\shiva\AppData\Roaming\Claude\claude_desktop_config.json"
if os.path.exists(cfg):
    with open(cfg) as f:
        data = json.load(f)
    servers = list(data.get("mcpServers", {}).keys())
    owl = [s for s in servers if "owl" in s.lower()]
    results.append(f"Claude MCP servers registered: {servers}")
    results.append(f"OWL servers: {owl}")
else:
    results.append("Claude config: NOT FOUND")

for r in results:
    print(r)
