const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v5-glymphatic-test.db");
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
  console.log("Starting OWL Memory v5.0 Server process for Glymphatic Cleanup test...");
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-v5-glymphatic", version: "1" } });
  await new Promise(r => setTimeout(r, 1000));

  // Initialize DB connection directly to inject test data
  const db = new Database(DB_PATH);
  
  // Calculate specific ISO timestamps
  const now = new Date();
  const time25HoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const time2HoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const time49HoursAgo = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString();
  const time12HoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

  // Insert test cases for Synaptic Weights
  // Synapse A: weak, old -> SHOULD be pruned
  // Synapse B: weak, recent -> SHOULD NOT be pruned
  // Synapse C: strong, old -> SHOULD NOT be pruned
  db.exec(`
    INSERT INTO synaptic_weights (source_id, target_id, attention_weight, co_occurrences, last_transition)
    VALUES 
      ('node_A', 'node_B', 0.05, 1, '${time25HoursAgo}'),
      ('node_A', 'node_C', 0.05, 1, '${time2HoursAgo}'),
      ('node_B', 'node_C', 0.25, 2, '${time25HoursAgo}');
  `);

  // Insert test cases for Code Bugs
  // Bug A: resolved, old -> SHOULD be pruned
  // Bug B: resolved, recent -> SHOULD NOT be pruned
  // Bug C: active, old -> SHOULD NOT be pruned
  db.exec(`
    INSERT INTO code_bugs (id, bug_type, description, file_path, line_number, resolution, project, created_at, is_active)
    VALUES
      ('bug_A', 'syntax', 'Unused variable', 'file.js', 10, 'Removed var', 'glymph_test', '${time49HoursAgo}', 0),
      ('bug_B', 'syntax', 'Null pointer', 'file.js', 20, 'Added null check', 'glymph_test', '${time12HoursAgo}', 0),
      ('bug_C', 'runtime', 'Out of memory', 'file.js', 30, NULL, 'glymph_test', '${time49HoursAgo}', 1);
  `);

  console.log("Triggering dream cycle for glymphatic cleanup...");
  const dreamRes = PT(await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: {
      action: "dream",
      project: "glymph_test"
    }
  }));

  console.log("Dream response:", JSON.stringify(dreamRes, null, 2));

  // 1. Verify response keys
  T("dream completed successfully", dreamRes.status === "dream_cycle_completed");
  T("glymphatic_cleanup ran", dreamRes.glymphatic_cleanup !== undefined);
  T("glymphatic_cleanup status is completed", dreamRes.glymphatic_cleanup?.status === "completed");
  T("pruned_synapses is 1", dreamRes.glymphatic_cleanup?.pruned_synapses === 1);
  T("pruned_bugs is 1", dreamRes.glymphatic_cleanup?.pruned_bugs === 1);

  // 2. Query DB to check Synaptic Weights
  const synapses = db.prepare("SELECT * FROM synaptic_weights").all();
  T("Total synapses remaining in DB is 2", synapses.length === 2);
  
  const hasA_B = synapses.some(s => s.source_id === 'node_A' && s.target_id === 'node_B');
  const hasA_C = synapses.some(s => s.source_id === 'node_A' && s.target_id === 'node_C');
  const hasB_C = synapses.some(s => s.source_id === 'node_B' && s.target_id === 'node_C');
  
  T("Synapse A (weak, old) was deleted", !hasA_B);
  T("Synapse B (weak, recent) was retained", hasA_C);
  T("Synapse C (strong, old) was retained", hasB_C);

  // 3. Query DB to check Code Bugs
  const bugs = db.prepare("SELECT * FROM code_bugs").all();
  T("Total bugs remaining in DB is 2", bugs.length === 2);

  const hasBugA = bugs.some(b => b.id === 'bug_A');
  const hasBugB = bugs.some(b => b.id === 'bug_B');
  const hasBugC = bugs.some(b => b.id === 'bug_C');

  T("Bug A (resolved, old) was deleted", !hasBugA);
  T("Bug B (resolved, recent) was retained", hasBugB);
  T("Bug C (active, old) was retained", hasBugC);

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v5.0 (UNS) — GLYMPHATIC PRUNING TESTS");
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
