const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v6-cognitive-test.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
}

const SERVER = path.join(__dirname, "owl_memory_v5.js");
let passed = 0, failed = 0, total = 0;
const results = [];

function sendRPC(proc, id, method, params) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 15000);
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
  console.log("Starting OWL Memory v5.0 Server process for Cognitive Core v6.0 test...");
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-v6", version: "1" } });
  await new Promise(r => setTimeout(r, 2000));

  // Initialize DB connection directly to inject mock graph structure
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();

  // 1. Setup mock codebase nodes and call graph
  db.exec(`
    INSERT INTO code_nodes (id, name, node_type, filepath, project, edit_count, bug_count, created_at, updated_at)
    VALUES 
      ('src/db.js', 'db.js', 'file', 'src/db.js', 'v6_test', 10, 3, '${now}', '${now}'),
      ('src/db.js::function::connect', 'connect', 'function', 'src/db.js', 'v6_test', 5, 2, '${now}', '${now}'),
      ('src/app.js', 'app.js', 'file', 'src/app.js', 'v6_test', 12, 1, '${now}', '${now}'),
      ('src/config.js', 'config.js', 'file', 'src/config.js', 'v6_test', 2, 0, '${now}', '${now}'),
      ('src/dead_file.js', 'dead_file.js', 'file', 'src/dead_file.js', 'v6_test', 0, 0, '${now}', '${now}');
  `);

  // Setup mock call edges (src/db.js connected to config.js and app.js)
  db.exec(`
    INSERT INTO code_edges (source_id, target_id, edge_type, weight, created_at)
    VALUES 
      ('src/db.js', 'src/config.js', 'imports', 1.0, '${now}'),
      ('src/app.js', 'src/db.js', 'imports', 1.0, '${now}');
  `);

  // Setup unstable dependency (src/config.js has high error count)
  db.exec(`
    INSERT INTO dependency_stewardship (package_name, error_count, use_count, status, last_seen)
    VALUES ('src/config.js', 7, 10, 'critical', '${now}');
  `);

  // Inject a mock episodic memory indicating a leak/error in connect
  db.exec(`
    INSERT INTO episodic_memories (id, content, event_type, project, created_at, updated_at, is_active)
    VALUES ('mem_leak_1', 'Database connection has leak in src/db.js::function::connect when pool size exceeds 50', 'error', 'v6_test', '${now}', '${now}', 1);
  `);

  // Link that memory to connect function node
  db.exec(`
    INSERT INTO memory_code_links (memory_id, code_node_id, link_type)
    VALUES ('mem_leak_1', 'src/db.js::function::connect', 'associated');
  `);

  console.log("Triggering perceive with contradiction comment and active node focus...");
  const percRPCResult = await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: {
      action: "perceive",
      workspace_state: {
        active_file: "src/db.js",
        code_snippet: "// This pool is fully thread-safe and never throws errors\nconst pool = new Pool();",
      },
      project: "v6_test"
    }
  });

  const percRes = PT(percRPCResult);
  console.log("Perceive Response:", JSON.stringify(percRes, null, 2));

  // 1. Verify Tesla Wave propagation
  T("Tesla Wave: active node is activated", percRes.active_node_id === "src/db.js");
  const configActivation = db.prepare("SELECT activation FROM code_node_activation WHERE node_id = 'src/config.js'").get()?.activation || 0;
  const appActivation = db.prepare("SELECT activation FROM code_node_activation WHERE node_id = 'src/app.js'").get()?.activation || 0;
  T("Tesla Wave: wave propagated to imports neighbor config.js", configActivation > 0.05);
  T("Tesla Wave: wave propagated to parent app.js", appActivation > 0.05);

  // 2. Verify Thiel Contradiction detection
  const thielWarning = percRes.threat_warnings?.find(w => w.assertion_type === "stability" && w.message.includes("SECRET"));
  T("Thiel Contradiction: detected stability contradiction", thielWarning !== undefined);
  if (thielWarning) {
    T("Thiel Contradiction: references contradictory memory content", thielWarning.contradictory_evidence.includes("leak"));
  }

  // 3. Verify Tata Stewardship Ledger wrapper suggestion
  const tataAlert = percRes.threat_warnings?.find(w => w.package === "src/config.js");
  T("Tata Stewardship: alert generated for critical dependency", tataAlert !== undefined);
  if (tataAlert) {
    T("Tata Stewardship: contains trust coefficient", tataAlert.trust_coefficient === 0.3);
    T("Tata Stewardship: contains try-catch circuit breaker suggestion", tataAlert.circuit_breaker && tataAlert.circuit_breaker.includes("try-catch"));
  }

  // 4. Verify Torvalds Chrono-Pruner via dream cycle
  console.log("Triggering dream cycle for Torvalds pruner verification...");
  const dreamRes = PT(await sendRPC(proc, 3, "tools/call", {
    name: "nexus",
    arguments: {
      action: "dream",
      project: "v6_test"
    }
  }));

  console.log("Dream Response:", JSON.stringify(dreamRes, null, 2));
  const prunerProposals = dreamRes.torvalds_chrono_pruner?.proposals || [];
  const deadFileProposal = prunerProposals.find(p => p.node_id === "src/dead_file.js");
  T("Torvalds Chrono-Pruner: dead code node detected", deadFileProposal !== undefined);
  if (deadFileProposal) {
    T("Torvalds Chrono-Pruner: recommendation correct", deadFileProposal.recommendation.includes("DELETE") && deadFileProposal.recommendation.includes("dead weight"));
  }

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v6.0 (UNS) — COGNITIVE CORE TESTS");
  console.log("═══════════════════════════════════════════════════\n");
  results.forEach(r => console.log(r));
  const pct = Math.round((passed / total) * 100);
  const grade = pct >= 95 ? "EXCELLENT ✅" : pct >= 85 ? "GOOD ✅" : pct >= 70 ? "FAIR ⚠️" : "POOR ❌";
  console.log(`\n  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Score: ${pct}% — ${grade}`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  db.close();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
