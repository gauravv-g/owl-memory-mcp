const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v4-code-intel.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const SERVER = path.join(__dirname, "owl_memory_v4.js");
let passed = 0, failed = 0, total = 0;
const results = [];

function sendRPC(proc, id, method, params) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 30000);
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
  
  // Initialize connection
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  
  // Wait for model warmup
  await new Promise(r => setTimeout(r, 4000));

  console.log("Starting Code Intelligence Layer Verification tests...\n");

  // Test 1: Indexing codebase
  const idx = PT(await sendRPC(proc, 2, "tools/call", {
    name: "index_codebase",
    arguments: { scan_path: ".", project: "code_intel_test" }
  }));
  
  T("index_codebase: returns successful status", idx.indexed === true);
  T("index_codebase: scanned files", idx.files_scanned > 0);
  T("index_codebase: extracted nodes", idx.total_nodes > 0);
  T("index_codebase: extracted edges", idx.total_edges > 0);

  // Test 2: Querying codebase
  const qry = PT(await sendRPC(proc, 3, "tools/call", {
    name: "query_codebase",
    arguments: { query: "remember", node_type: "function", project: "code_intel_test" }
  }));
  T("query_codebase: found remember function", qry.length > 0 && qry.some(n => n.name === "remember"));

  // Test 3: Pathfinder (BFS Call Path)
  const fileNode = "owl_memory_v4.js";
  const funcNode = "owl_memory_v4.js::function::generateEmbedding";
  const pathData = PT(await sendRPC(proc, 4, "tools/call", {
    name: "code_path",
    arguments: { from_node: fileNode, to_node: funcNode, project: "code_intel_test" }
  }));
  T("code_path: found relationship path", pathData.found === true && pathData.path.length > 0);

  // Test 4: Modular Clustering (Label Propagation)
  const cl = PT(await sendRPC(proc, 5, "tools/call", {
    name: "cluster_codebase",
    arguments: { project: "code_intel_test" }
  }));
  T("cluster_codebase: grouped into communities", cl.total_communities > 0 && Object.keys(cl.communities).length > 0);

  // Test 5: AST-linked memories in code review
  // Setup: Insert error memory and link to generateEmbedding function in SQLite directly
  const db = new Database(DB_PATH);
  const memId = "abc123xyz7890def";
  const now = new Date().toISOString();
  
  // Insert episodic memory of a bug
  db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, created_at, updated_at, next_review)
              VALUES (?, 'Bug found in generateEmbedding: embedding race condition occurs on startup', 'error', 'code_intel_test', ?, ?, ?)`).run(memId, now, now, now);
  
  // Link it to 'owl_memory_v4.js::function::generateEmbedding' node
  db.prepare(`INSERT INTO memory_code_links (memory_id, code_node_id, link_type)
              VALUES (?, ?, 'caused_bug')`).run(memId, funcNode);
  db.close();

  // Run code_review and check if linked memory is retrieved
  const rev = PT(await sendRPC(proc, 6, "tools/call", {
    name: "code_review",
    arguments: { file_path: "owl_memory_v4.js", change_description: "Refactoring the generateEmbedding pipeline to improve loading speed", project: "code_intel_test" }
  }));

  T("code_review: linked memories retrieved", rev.linked_memories?.length > 0);
  T("code_review: linked memory contains correct bug", rev.linked_memories?.some(m => m.function_name === "generateEmbedding" && m.memory.includes("embedding race condition")));
  T("code_review: risk score is computed", !!rev.risk_score);

  // Print Results
  console.log("═══════════════════════════════════════════════════");
  console.log("  OWL CODE INTELLIGENCE — TEST RESULTS");
  console.log("═══════════════════════════════════════════════════");
  results.forEach(r => console.log(r));
  console.log("");
  console.log(`  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Score: ${Math.round(passed/total*100)}%`);
  console.log("═══════════════════════════════════════════════════");

  proc.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
