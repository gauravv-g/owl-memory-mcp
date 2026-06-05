const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v4-nexus.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { if (fs.existsSync(f)) fs.unlinkSync(f); }

const SERVER = path.join(__dirname, "owl_memory_v4.js");
let passed = 0, failed = 0, total = 0;
const results = [];

function sendRPC(proc, id, method, params) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 60000);
    function handler(data) {
      for (const line of data.toString().split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const r = JSON.parse(line.trim());
          if (r.id === id) {
            clearTimeout(timeout);
            proc.stdout.off("data", handler);
            resolve(r);
            return;
          }
        } catch (e) {}
      }
    }
    proc.stdout.on("data", handler);
  });
}

function T(testName, ok, det) {
  total++;
  if (ok) {
    passed++;
    results.push("  ✓ " + testName);
  } else {
    failed++;
    results.push("  ✗ " + testName + " — " + (det || "FAIL"));
  }
}

function PT(r) {
  try {
    return JSON.parse(r.result?.content?.[0]?.text || "{}");
  } catch (e) {
    return {};
  }
}

async function main() {
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-nexus", version: "1" } });
  await new Promise(r => setTimeout(r, 4000));

  // 1. Test RECORD memory
  const recRes = PT(await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: {
      action: "record",
      memory_data: {
        content: "Thread-safe connection pool implementation had a memory leak in src/db.js",
        event_type: "error",
        linked_code_nodes: ["src/db.js"]
      },
      project: "nexus_test"
    }
  }));

  T("nexus record: success", recRes.status === "success");
  T("nexus record: generates id", recRes.memory_id?.length === 16);
  T("nexus record: correct type", recRes.event_type === "error");

  // Run index_codebase to populate some code graph nodes
  await sendRPC(proc, 3, "tools/call", {
    name: "index_codebase",
    arguments: {
      scan_path: path.join(__dirname),
      project: "nexus_test"
    }
  });

  // 2. Test PERCEIVE context (gravity, spreading activation, contradiction, dependencies)
  const percRes = PT(await sendRPC(proc, 4, "tools/call", {
    name: "nexus",
    arguments: {
      action: "perceive",
      workspace_state: {
        active_file: "src/db.js",
        code_snippet: "// This pool is fully thread-safe and optimized\nconst pool = new Pool();",
        git_diff: "const pool = new Pool();"
      },
      project: "nexus_test"
    }
  }));

  T("nexus perceive: active node resolved", percRes.active_node_id !== undefined);
  T("nexus perceive: memories retrieved", percRes.context_memories?.length > 0);
  T("nexus perceive: gravity calculated", percRes.context_memories?.[0]?.gravity !== undefined);
  
  // Peter Thiel contradiction detection verify
  T("nexus perceive: contradiction found", percRes.code_insights?.contradictions?.length > 0);
  T("nexus perceive: contradiction type correct", percRes.code_insights?.contradictions?.[0]?.assertion_type === "thread_safety");

  // 3. Test surprise-gated error harvesting in perceive
  const errorOutput = "Error: Connection timeout at src/db.js:15:10\n    at Pool.connect (src/db.js:15:10)";
  const harvestRes = PT(await sendRPC(proc, 5, "tools/call", {
    name: "nexus",
    arguments: {
      action: "perceive",
      workspace_state: {
        active_file: "src/db.js",
        terminal_output: errorOutput
      },
      project: "nexus_test"
    }
  }));

  T("nexus perceive: error harvested", harvestRes.threat_warnings?.some(w => w.type === "new_exception_harvested"));

  // 4. Test COGITATE (decide, self_analyze)
  const cogDecRes = PT(await sendRPC(proc, 6, "tools/call", {
    name: "nexus",
    arguments: {
      action: "cogitate",
      reasoning_query: {
        type: "decide",
        context: "Choose connection pool limits",
        options: ["Max 10", "Max 100"],
        chosen_option: "Max 100"
      },
      project: "nexus_test"
    }
  }));

  T("nexus cogitate decide: pre-mortem generated", cogDecRes.pre_mortem?.length > 0);
  T("nexus cogitate decide: counterfactual generated", cogDecRes.counterfactuals?.length === 1);

  const cogAnalyzeRes = PT(await sendRPC(proc, 7, "tools/call", {
    name: "nexus",
    arguments: {
      action: "cogitate",
      reasoning_query: {
        type: "self_analyze"
      },
      project: "nexus_test"
    }
  }));

  T("nexus cogitate analyze: counts total", cogAnalyzeRes.total_memories > 0);
  T("nexus cogitate analyze: mood distribution", cogAnalyzeRes.mood_distribution !== undefined);

  // 5. Test DREAM consolidation
  const dreamRes = PT(await sendRPC(proc, 8, "tools/call", {
    name: "nexus",
    arguments: {
      action: "dream",
      project: "nexus_test"
    }
  }));

  T("nexus dream: success", dreamRes.status === "dream_cycle_completed");
  T("nexus dream: processing done", dreamRes.report?.processed !== undefined);

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP NEXUS — TEST RESULTS");
  console.log("═══════════════════════════════════════════════════\n");
  results.forEach(r => console.log(r));
  const pct = Math.round((passed / total) * 100);
  const grade = pct >= 95 ? "EXCELLENT ✅" : pct >= 85 ? "GOOD ✅" : pct >= 70 ? "FAIR ⚠️" : "POOR ❌";
  console.log(`\n  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Score: ${pct}% — ${grade}`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
