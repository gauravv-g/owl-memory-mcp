"""Final audit script for Hermes v8.0 OWL QA system."""
import asyncio
import json
import sqlite3
import py_compile
import os

# 1. Syntax check all modules
print("=== SYNTAX AUDIT ===")
files = [
    "owl_qa_mcp.py", "owl_sentinel.py", "owl_qa_orchestrator.py",
    "owl_qa_genome.py", "owl_qa_causal.py", "owl_qa_oracle.py",
    "owl_qa_sensory.py", "owl_qa_device_cloud.py", "owl_qa_healer.py",
    "owl_qa_economics.py", "owl_qa_graph.py", "owl_qa_selftest.py",
    "owl_qa_temporal.py", "owl_qa_protocol.py", "owl_qa_visual.py",
    "owl_qa_android.py", "owl_shared_intelligence.py",
]
ok, fail = 0, 0
for f in files:
    try:
        py_compile.compile(f, doraise=True)
        print("  PASS  " + f + "  (" + str(os.path.getsize(f)) + " bytes)")
        ok += 1
    except py_compile.PyCompileError as e:
        print("  FAIL  " + f + ": " + str(e))
        fail += 1
print("Syntax result: " + str(ok) + " passed, " + str(fail) + " failed\n")

# 2. Import and tool count
print("=== TOOL REGISTRY ===")
import owl_qa_mcp
tools = asyncio.run(owl_qa_mcp.list_tools())
print("Total tools registered: " + str(len(tools)))
for t in tools:
    print("  - " + t.name)

# 3. Check pillar imports
print("\n=== PILLAR WIRING ===")
with open("owl_qa_mcp.py", "r", encoding="utf-8") as f:
    src = f.read()
pillars = [
    "owl_qa_genome", "owl_qa_causal", "owl_qa_oracle", "owl_qa_sensory",
    "owl_qa_device_cloud", "owl_qa_healer", "owl_qa_economics", "owl_qa_graph",
    "owl_qa_selftest", "owl_qa_temporal", "owl_qa_protocol", "owl_qa_orchestrator",
    "owl_qa_visual", "owl_qa_android", "owl_shared_intelligence",
]
for p in pillars:
    status = "WIRED" if p in src else "MISSING"
    print("  " + status + "  " + p)

# 4. Sentinel check
print("\n=== SENTINEL WIRING ===")
with open("owl_sentinel.py", "r", encoding="utf-8") as f:
    sentinel = f.read()
checks = [
    ("owl_qa_orchestrator", "NeuralMeshOrchestrator import"),
    ("start_status_server", "Status server call"),
    ("trigger_event_cascade", "Event cascade trigger"),
    ("while True", "Watchdog loop"),
]
for token, label in checks:
    status = "FOUND" if token in sentinel else "MISSING"
    print("  " + status + "  " + label)

# 5. Self-test health
print("\n=== SYSTEM HEALTH ===")
import owl_qa_selftest
results = asyncio.run(owl_qa_selftest.run_selftest_suite())
health_score = results.get("health_score", 0)
for k, v in results.items():
    if isinstance(v, dict):
        status = "PASS" if v.get("passed") else "FAIL"
        print("  [" + status + "] " + k + ": " + str(v.get("details", "")))
print("\n  FINAL HEALTH SCORE: " + str(health_score) + " / 100")

# 6. Status server
print("\n=== STATUS SERVER ===")
import urllib.request
try:
    resp = urllib.request.urlopen("http://localhost:7700/status", timeout=3)
    data = resp.read().decode()
    print("  LIVE  http://localhost:7700/status  (" + str(len(data)) + " bytes)")
except Exception as e:
    print("  DOWN  http://localhost:7700/status  (" + str(e) + ")")

print("\n=== AUDIT COMPLETE ===")
