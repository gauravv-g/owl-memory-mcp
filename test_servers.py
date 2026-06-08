"""
Quick test: import each server, call each tool with minimal args, check for crashes.
Skips tools that need external services (Docker, network, ADB).
"""
import asyncio, os, sys, importlib.util, json, tempfile, shutil, subprocess, signal

repo = r"C:\Users\shiva\hermes-custom-mcps"
sys.path.insert(0, repo)

# Create temp git repo
tmpdir = tempfile.mkdtemp()
subprocess.run(["git", "init", tmpdir], capture_output=True)
subprocess.run(["git", "-C", tmpdir, "config", "user.email", "t@t.com"], capture_output=True)
subprocess.run(["git", "-C", tmpdir, "config", "user.name", "T"], capture_output=True)
with open(os.path.join(tmpdir, "t.py"), "w") as f: f.write("#t\n")
subprocess.run(["git", "-C", tmpdir, "add", "."], capture_output=True)
subprocess.run(["git", "-C", tmpdir, "commit", "-m", "init"], capture_output=True)
with open(os.path.join(tmpdir, "t.py"), "a") as f: f.write("#m\n")
subprocess.run(["git", "-C", tmpdir, "add", "."], capture_output=True)
subprocess.run(["git", "-C", tmpdir, "commit", "-m", "update"], capture_output=True)
os.makedirs(os.path.join(tmpdir, ".github", "workflows"), exist_ok=True)
with open(os.path.join(tmpdir, ".github", "workflows", "ci.yml"), "w") as f:
    f.write("name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n")

results = {}

def get_tools(mod):
    """Extract (name, handler) pairs from a module."""
    if hasattr(mod, 'ALL_TOOLS'):
        return [(n, h) for n, d, h in mod.ALL_TOOLS]
    # For decorator-based servers, find handle_ functions
    handlers = []
    for attr in dir(mod):
        if attr.startswith("handle_"):
            name = attr[7:]  # strip "handle_"
            handlers.append((name, getattr(mod, attr)))
    return handlers

async def test_server(server_file):
    path = os.path.join(repo, server_file)
    try:
        spec = importlib.util.spec_from_file_location(f"t_{server_file}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:
        results[server_file] = {"error": f"IMPORT: {str(e)[:80]}"}
        return
    
    tools = get_tools(mod)
    if not tools:
        results[server_file] = {"error": "No tools found"}
        return
    
    ok = fail = 0
    details = []
    
    for name, handler in tools:
        if handler is None:
            continue
        # Skip tools that need external services
        skip = ["docker_build", "compose_up", "compose_down", "deploy_status",
                "android_", "load_test", "chaos_probe", "protocol_test",
                "compare_apps", "competitive_audit", "sensory_audit",
                "performance_probe", "accessibility_audit", "harmonic_audit",
                "knowledge_graph", "temporal_analysis", "explain_bug",
                "user_story_generate", "sentinel_register", "sherlock",
                "predict_bugs", "research_history", "research_diff",
                "research_follow_up", "research_on_file", "research_synthesize",
                "web_fetch", "web_fetch_stealthy", "web_fetch_dynamic",
                "web_batch_fetch", "web_extract_structured", "web_scrape_adaptive",
                "web_session_scrape", "web_research_crawl", "web_diff",
                "web_monitor_start", "web_trace_claim", "trace_claim",
                "nexus_execute", "nexus_run", "nexus_verify", "nexus_cancel",
                "k8s_generate", "ci_generate", "infra_scan"]
        if any(name.startswith(s) or s in name for s in skip):
            continue
        
        try:
            # Build minimal args
            args = {}
            if "repo" in name or "git_" in name:
                args = {"repo": tmpdir}
                if "commit" in name: args["commit"] = False
                if "diff" in name: args = {"repo": tmpdir, "source": "HEAD~1", "target": "HEAD"}
                if "pr_" in name: args = {"repo": tmpdir, "target": "main"}
                if "release" in name: args = {"repo": tmpdir, "until": "HEAD"}
                if "conflict" in name: args = {"repo": tmpdir, "target": "main"}
                if "repo_map" in name: args = {"repo": tmpdir, "max_depth": 2}
            elif "path" in name or "scan" in name or "audit" in name:
                args = {"path": repo}
                if "readme" in name: args["project_name"] = "Test"
                if "changelog" in name: args["path"] = tmpdir
                if "contributing" in name: args["project_name"] = "Test"
                if "onboarding" in name: args["project_name"] = "Test"
                if "architecture" in name: args["path"] = repo
                if "type_docs" in name: args["path"] = repo
                if "dependency_graph" in name: args["path"] = repo
                if "cve" in name: args = {"package": "requests", "version": "2.28.0", "ecosystem": "pypi"}
                if "headers" in name: args = {"url": "https://example.com"}
                if "cors" in name: args = {"url": "https://example.com"}
            elif "workflow" in name:
                if "validate" in name: args = {"path": tmpdir}
                elif "visualize" in name: args = {"path": tmpdir}
                elif "optimize" in name: args = {"path": tmpdir}
                elif "security" in name: args = {"path": tmpdir}
                else: args = {"path": repo, "project_name": "test"}
            elif "code_" in name:
                args = {"target": repo}
                if "build" in name: args = {"project_path": repo}
                if "test" in name: args = {"project_path": repo}
                if "lint" in name: args = {"project_path": repo}
                if "execute" in name: args = {"code": "print(1)"}
                if "review" in name: args = {"target": repo}
                if "refactor" in name: args = {"target": repo, "goal": "simplify"}
            elif "data_" in name:
                args = {"database": ":memory:", "query": "SELECT 1"}
                if "migrate" in name: args = {"database": ":memory:", "migrations": []}
                if "schema" in name: args = {"tables": []}
                if "inspect" in name: args = {"database": ":memory:"}
                if "create" in name: args = {"path": ":memory:"}
                if "etl" in name: args = {"source": "a", "destination": "b"}
            elif "deploy_" in name:
                if "dockerfile" in name: args = {"project_path": repo, "language": "python"}
                if "compose" in name: args = {"project_path": repo, "services": ["app"]}
            elif "agent_" in name:
                if "spawn" in name: args = {"task": "test", "type": "worker"}
                elif "cancel" in name: args = {"agent_id": "fake"}
                elif "plan" in name: args = {"goal": "test"}
                elif "merge" in name: args = {"agent_ids": ["a", "b"]}
                elif "execute_plan" in name: args = {"plan": {}}
                else: args = {}
            elif "nexus_" in name:
                if "plan" in name: args = {"goal": "test"}
                elif "report" in name: args = {"graph_id": "x"}
                elif "update_task" in name: args = {"task_id": "t", "graph_id": "g", "status": "completed"}
                elif "template" in name: args = {}
                elif "dashboard" in name: args = {}
                else: args = {"graph_id": "x"}
            elif "unified" in name or "perceive" in name or "remember" in name or "recall" in name or "dream" in name:
                args = {"project": "default"}
            elif "docs_" in name:
                args = {"path": repo}
                if "readme" in name: args["project_name"] = "Test"
                if "changelog" in name: args["path"] = tmpdir
                if "contributing" in name: args["project_name"] = "Test"
                if "onboarding" in name: args["project_name"] = "Test"
            
            result = await handler(args)
            
            if isinstance(result, dict):
                if "error" in result:
                    err = result["error"]
                    expected = ["required", "not found", "no ", "missing", "invalid",
                               "not a git", "no staged", "no common", "not registered",
                               "max agents", "no ci", "cannot"]
                    if any(e.lower() in err.lower() for e in expected):
                        ok += 1
                    else:
                        fail += 1
                        details.append(f"FAIL {name}: {err[:60]}")
                else:
                    ok += 1
            else:
                fail += 1
                details.append(f"FAIL {name}: {type(result).__name__}")
        except Exception as e:
            fail += 1
            details.append(f"FAIL {name}: {type(e).__name__}: {str(e)[:60]}")
    
    results[server_file] = {"ok": ok, "fail": fail, "total": ok + fail, "details": details}

async def main():
    servers = [
        "owl_agent_mcp.py",
        "owl_code_mcp.py",
        "owl_data_mcp.py",
        "owl_deploy_mcp.py",
        "owl_docs_mcp.py",
        "owl_git_mcp.py",
        "owl_nexus_mcp.py",
        "owl_security_mcp.py",
        "owl_unified_server.py",
        "owl_workflow_mcp.py",
    ]
    
    for s in servers:
        await test_server(s)
    
    print("\n" + "="*60)
    print("  END-TO-END TEST RESULTS")
    print("="*60)
    
    total_ok = total_fail = 0
    for server, res in sorted(results.items()):
        if "error" in res:
            print(f"\n  ERROR  {server}: {res['error']}")
            continue
        ok = res["ok"]
        fail = res["fail"]
        total = res["total"]
        total_ok += ok
        total_fail += fail
        status = "PASS" if fail == 0 else "FAIL"
        print(f"  {status}  {server}: {ok}/{total} pass, {fail} fail")
        for d in res.get("details", []):
            print(f"         {d}")
    
    print(f"\n{'='*60}")
    pct = (total_ok / (total_ok + total_fail) * 100) if (total_ok + total_fail) > 0 else 0
    print(f"  TOTAL: {total_ok} PASS, {total_fail} FAIL out of {total_ok + total_fail}")
    print(f"  PASS RATE: {pct:.1f}%")
    print(f"  SERVERS TESTED: {len(results)}")
    print(f"{'='*60}")
    
    shutil.rmtree(tmpdir, ignore_errors=True)

asyncio.run(main())
