const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v5-nexus-test.db");
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
  console.log("Starting OWL Memory v5.0 Server process...");
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  
  proc.stderr.on("data", (d) => {
    // console.log("STDERR:", d.toString());
  });

  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-v5", version: "1" } });
  // Give embedder/NER time to initialize in background
  await new Promise(r => setTimeout(r, 2000));

  // Initialize DB connection directly to inject call graph mocks for deep tests
  const db = new Database(DB_PATH);
  
  // Set up mock call edges (Tesla and Da Vinci)
  const now = new Date().toISOString();
  db.exec(`
    INSERT INTO code_nodes (id, name, node_type, filepath, project, edit_count, bug_count, created_at, updated_at)
    VALUES 
      ('src/db.js', 'db.js', 'file', 'src/db.js', 'v5_test', 10, 3, '${now}', '${now}'),
      ('src/db.js::function::connect', 'connect', 'function', 'src/db.js', 'v5_test', 5, 2, '${now}', '${now}'),
      ('src/app.js', 'app.js', 'file', 'src/app.js', 'v5_test', 12, 1, '${now}', '${now}'),
      ('src/config.js', 'config.js', 'file', 'src/config.js', 'v5_test', 2, 0, '${now}', '${now}');

    INSERT INTO code_edges (source_id, target_id, edge_type, weight, created_at)
    VALUES
      ('src/app.js', 'src/db.js', 'calls', 1.0, '${now}'),
      ('src/db.js', 'src/db.js::function::connect', 'calls', 1.0, '${now}'),
      ('src/db.js', 'src/config.js', 'imports', 1.0, '${now}');

    INSERT INTO dependency_stewardship (package_name, error_count, use_count, status, last_seen)
    VALUES
      ('src/config.js', 5, 10, 'unstable', '${now}');

    INSERT INTO code_bugs (id, bug_type, description, file_path, line_number, project, created_at, is_active)
    VALUES
      ('bug123', 'runtime_error', 'Database connection has leak in src/db.js::function::connect when pool size exceeds 50', 'src/db.js::function::connect', 15, 'v5_test', '${now}', 1);
  `);

  // 1. Test RECORD memory
  const recRes = PT(await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: {
      action: "record",
      memory_data: {
        content: "Database connection has leak in src/db.js::function::connect when pool size exceeds 50",
        event_type: "error",
        linked_code_nodes: ["src/db.js::function::connect"]
      },
      project: "v5_test"
    }
  }));

  T("nexus record: success", recRes.status === "success");
  T("nexus record: generates id", recRes.memory_id?.length === 16);
  console.log("recRes:", JSON.stringify(recRes, null, 2));

  // Map the recorded memory to main branch to ensure contradiction check finds it
  if (recRes.memory_id) {
    db.prepare("INSERT OR REPLACE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, 'main', 'initial')")
      .run(recRes.memory_id);
  }

  // 2. Test PERCEIVE context (Einstein Gravity, Tesla Resonance, Thiel secrets, Tata alerts, Da Vinci healing, Naval hotspots)
  const percRPCResult = await sendRPC(proc, 3, "tools/call", {
    name: "nexus",
    arguments: {
      action: "perceive",
      workspace_state: {
        active_file: "src/db.js",
        code_snippet: "// This pool is fully thread-safe and never throws errors\nconst pool = new Pool();",
        git_diff: "const pool = new Pool();"
      },
      project: "v5_test"
    }
  });
  console.log("percRPCResult:", JSON.stringify(percRPCResult, null, 2));
  const percRes = PT(percRPCResult);
  console.log("percRes:", JSON.stringify(percRes, null, 2));

  T("nexus perceive: active node resolved", percRes.active_node_id === "src/db.js");
  T("nexus perceive: context_memories (Einstein Gravity) calculated", percRes.context_memories?.length > 0);
  T("nexus perceive: gravity value is present", percRes.context_memories?.[0]?.gravity !== undefined);
  T("nexus perceive: resonance_memories (Tesla Spreading Activation) active", percRes.resonance_memories?.length > 0);
  T("nexus perceive: secret (Thiel Contradiction) detected", percRes.threat_warnings?.some(w => w.message.includes("SECRET")));
  T("nexus perceive: stewardship warning (Tata Alert) surfaced", percRes.threat_warnings?.some(w => w.message && w.message.includes("Stewardship alert")));
  T("nexus perceive: refactoring hotspots (Naval ROI) calculated", percRes.refactoring_hotspots?.length > 0);
  T("nexus perceive: self healing suggestions (Da Vinci Anatomical Path) populated", percRes.self_healing_suggestions?.length > 0);

  // 3. Test ACT (Musk closed-loop command execution with error harvesting)
  const actRPCResult = await sendRPC(proc, 4, "tools/call", {
    name: "nexus",
    arguments: {
      action: "act",
      operational_cmd: {
        command: "node -e \"throw new Error('Test crash at src/db.js:12:4\\n    at connect (src/db.js:12:4)')\""
      },
      project: "v5_test"
    }
  });
  console.log("actRPCResult:", JSON.stringify(actRPCResult, null, 2));
  const actRes = PT(actRPCResult);
  console.log("actRes:", JSON.stringify(actRes, null, 2));

  T("nexus act: exit code captured", actRes.exit_code !== 0);
  T("nexus act: surprise harvest succeeded", actRes.surprise_harvest?.status === "success");
  T("nexus act: surprise code node mapped to function", actRes.surprise_harvest?.codeNodeId === "src/db.js::function::connect");
  T("nexus act: surprise score calculated", actRes.surprise_harvest?.surpriseScore === 1.0 || actRes.surprise_harvest?.surpriseScore === 0.5);

  // 4. Test COGITATE Decide
  const cogDecRes = PT(await sendRPC(proc, 5, "tools/call", {
    name: "nexus",
    arguments: {
      action: "cogitate",
      reasoning_query: {
        type: "decide",
        context: "Should we increase connection pool size to 100?",
        options: ["Yes", "No"],
        chosen_option: "Yes"
      },
      project: "v5_test"
    }
  }));

  T("nexus cogitate decide: pre-mortem generated", cogDecRes.pre_mortem?.length > 0);
  T("nexus cogitate decide: status recommendation returned", cogDecRes.recommendation === "PROCEED_WITH_WARNINGS");

  // 5. Test COGITATE Merge branches (Torvalds semantic merge check)
  // Inject a contradictory memory on a feature branch
  db.exec(`
    INSERT INTO episodic_memories (id, content, project, emotional_valence, emotional_arousal, salience, created_at, updated_at, is_active)
    VALUES ('feat123', 'Database connection has no leak in src/db.js::function::connect', 'v5_test', 0.5, 0.2, 0.4, '${now}', '${now}', 1);

    INSERT INTO memory_git_branches (memory_id, branch_name, commit_sha)
    VALUES ('feat123', 'feature-branch', 'commit123');
  `);

  const mergeRes = PT(await sendRPC(proc, 6, "tools/call", {
    name: "nexus",
    arguments: {
      action: "cogitate",
      reasoning_query: {
        type: "merge_branches",
        source_branch: "feature-branch",
        target_branch: "main"
      },
      project: "v5_test"
    }
  }));

  T("nexus cogitate merge: runs merge check", mergeRes.status === "merged");
  T("nexus cogitate merge: flags contradictions", mergeRes.report?.contradictionCount > 0);

  // 6. Test DREAM consolidation
  const dreamRes = PT(await sendRPC(proc, 7, "tools/call", {
    name: "nexus",
    arguments: {
      action: "dream",
      project: "v5_test"
    }
  }));

  T("nexus dream: completed", dreamRes.status === "dream_cycle_completed");

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v5.0 (UNS) — TEST RESULTS");
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
