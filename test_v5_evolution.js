const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v5-evolution-test.db");
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
  console.log("Starting OWL Memory v5.0 Server process for Schema Evolution test...");
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-v5-evo", version: "1" } });
  await new Promise(r => setTimeout(r, 1000));

  // Initialize DB connection directly to inject test data
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();

  // Insert 6 episodic memories, 5 of which contain {"performance_ms": "120"} and {"user_role": "editor"}
  // This satisfies the minimum size (5 memories) and threshold (>40% frequency)
  // Insert 6 episodic memories, 5 of which contain {"performance_ms": "120"} and {"user_role": "editor"}
  // We use completely distinct text content to prevent consolidateMemories from merging them as duplicates.
  db.exec(`
    INSERT INTO episodic_memories (id, content, event_type, project, created_at, updated_at, metadata)
    VALUES 
      ('mem1', 'Completed the integration of payment gateway service', 'observation', 'evo_test', '${now}', '${now}', '{"performance_ms": "120", "user_role": "editor"}'),
      ('mem2', 'Fixed visual overlap of input textbox on android client', 'observation', 'evo_test', '${now}', '${now}', '{"performance_ms": "250", "user_role": "editor"}'),
      ('mem3', 'Configured security headers to prevent clickjacking attacks', 'observation', 'evo_test', '${now}', '${now}', '{"performance_ms": "80", "user_role": "editor"}'),
      ('mem4', 'Refactored call graph edges inside dependency scanner code', 'observation', 'evo_test', '${now}', '${now}', '{"performance_ms": "110", "user_role": "editor"}'),
      ('mem5', 'Added mock linter compiler check scripts inside test sandbox', 'observation', 'evo_test', '${now}', '${now}', '{"performance_ms": "95", "user_role": "editor"}'),
      ('mem6', 'Verified benchmarks and logged the metrics report', 'observation', 'evo_test', '${now}', '${now}', '{}');
  `);

  console.log("Triggering dream cycle for schema evolution...");
  const dreamRes = PT(await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: {
      action: "dream",
      project: "evo_test"
    }
  }));

  console.log("Dream response:", JSON.stringify(dreamRes, null, 2));

  // 1. Verify response keys
  T("dream completed successfully", dreamRes.status === "dream_cycle_completed");
  T("schema_evolution ran", dreamRes.schema_evolution !== undefined);
  T("schema_evolution status is completed", dreamRes.schema_evolution?.status === "completed");
  T("evolutions_count is 2", dreamRes.schema_evolution?.evolutions_count === 2);

  // 2. Query DB to check if columns were added
  const tableInfo = db.prepare("PRAGMA table_info(episodic_memories)").all();
  const columns = tableInfo.map(col => col.name);
  T("performance_ms column exists in database", columns.includes("performance_ms"));
  T("user_role column exists in database", columns.includes("user_role"));

  // 3. Check if values were migrated correctly
  const migrated = db.prepare("SELECT id, performance_ms, user_role FROM episodic_memories WHERE id = 'mem1'").get();
  T("migrated value for performance_ms is correct", migrated.performance_ms === "120");
  T("migrated value for user_role is correct", migrated.user_role === "editor");

  // 4. Verify log table has entries
  const logs = db.prepare("SELECT * FROM schema_evolution_log").all();
  T("schema_evolution_log has 2 entries", logs.length === 2);
  if (logs.length >= 2) {
    T("log entry 1 column name is correct", logs[0].evolved_column === "performance_ms");
    T("log entry 2 column name is correct", logs[1].evolved_column === "user_role");
  }

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v5.0 (UNS) — SCHEMA EVOLUTION TESTS");
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
