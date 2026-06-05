const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v4-proof.db");
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
        try { const r = JSON.parse(line.trim()); if (r.id === id) { clearTimeout(timeout); proc.stdout.off("data", handler); resolve(r); return; } } catch (e) {}
      }
    }
    proc.stdout.on("data", handler);
  });
}
function T(testName, ok, det) { total++; if (ok) { passed++; results.push("  ✓ " + testName); } else { failed++; results.push("  ✗ " + testName + " — " + (det || "FAIL")); } }
function PT(r) { try { return JSON.parse(r.result?.content?.[0]?.text || "{}"); } catch (e) { return {}; } }
function PR(r) { try { return JSON.parse(r.result?.contents?.[0]?.text || r.result?.content?.[0]?.text || "{}"); } catch (e) { return {}; } }

async function main() {
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  await new Promise(r => setTimeout(r, 4000));

  // Seed with data designed to trigger all features
  await sendRPC(proc, 2, "tools/call", { name: "remember", arguments: { content: "Sundar Pichai is the CEO of Google Alphabet Inc", project: "t" } });
  await sendRPC(proc, 3, "tools/call", { name: "remember", arguments: { content: "Tim Cook is the chief executive officer of Apple Inc", project: "t" } });
  await sendRPC(proc, 4, "tools/call", { name: "remember", arguments: { content: "Elon Musk founded SpaceX and Tesla Motors in California", project: "t" } });
  await sendRPC(proc, 5, "tools/call", { name: "remember", arguments: { content: "ISRO launched Aditya L1 mission to study the Sun", project: "t" } });
  // Failures that will match decision/anticipate/warn contexts
  await sendRPC(proc, 6, "tools/call", { name: "remember", arguments: { content: "Failed to migrate database to new cloud provider — data loss occurred due to insufficient testing and no rollback plan", project: "t", event_type: "error" } });
  await sendRPC(proc, 7, "tools/call", { name: "remember", arguments: { content: "Production outage caused by rushing a database migration to cloud without proper testing", project: "t", event_type: "error" } });
  await sendRPC(proc, 8, "tools/call", { name: "remember", arguments: { content: "Lost customer data during a hasty cloud migration because we skipped backup verification", project: "t", event_type: "error" } });
  // Insights
  await sendRPC(proc, 9, "tools/call", { name: "remember", arguments: { content: "Gradual database migration with proper testing saved us from data loss", project: "t", event_type: "insight" } });
  await sendRPC(proc, 10, "tools/call", { name: "remember", arguments: { content: "Investing in automated testing before migration prevented production issues", project: "t", event_type: "insight" } });

  // ═══ CORE MEMORY ═══
  const m1 = PT(await sendRPC(proc, 20, "tools/call", { name: "remember", arguments: { content: "React was created by Jordan Walke at Facebook Meta Platforms Inc", project: "t" } }));
  T("remember: stores memory", m1.memory_id?.length === 16);
  T("remember: NER entities", m1.entities_extracted >= 2, "got " + m1.entities_extracted);
  T("remember: NER model active", m1.ner_model === true);
  T("remember: vector embedding", m1.vector_embedding === true);

  const rec = PT(await sendRPC(proc, 21, "tools/call", { name: "recall", arguments: { query: "Who is the CEO of Google Alphabet?", project: "t", limit: 3 } }));
  T("recall: returns results", rec.length > 0);
  T("recall: top result is Sundar Pichai", rec[0]?.content?.includes("Sundar Pichai"));
  T("recall: has relevance scores", rec[0]?.relevance_score > 0);

  const sem = PT(await sendRPC(proc, 22, "tools/call", { name: "recall", arguments: { query: "chief executive officer of Apple", project: "t", limit: 3 } }));
  T("recall: semantic search finds Tim Cook", sem[0]?.content?.includes("Tim Cook"));

  // ═══ REASONING ═══
  const dec = PT(await sendRPC(proc, 30, "tools/call", { name: "decide", arguments: {
    title: "Database migration strategy",
    context: "Planning to migrate our production database to a new cloud provider. This is critical infrastructure.",
    options: ["Migrate all at once this weekend", "Gradual migration with testing", "Hybrid keep-old-and-new"],
    chosen_option: "Gradual migration with testing",
    project: "t"
  }}));
  T("decide: returns decision_id", dec.decision_id?.length === 16);
  T("decide: pre-mortem has warnings", dec.pre_mortem?.length > 0, "pre-mortem: " + JSON.stringify(dec.pre_mortem));
  T("decide: counterfactuals for other options", dec.counterfactuals?.length === 2);
  T("decide: has recommendation", !!dec.recommendation);

  const why = PT(await sendRPC(proc, 31, "tools/call", { name: "why", arguments: { situation: "Production outage after rushing a database migration to cloud without proper testing", max_depth: 3, project: "t" } }));
  T("why: returns causal chain", why.causal_chain !== undefined);
  T("why: has analysis text", !!why.analysis);

  const tr = PT(await sendRPC(proc, 32, "tools/call", { name: "transfer", arguments: { skill_description: "Systematic debugging: reproduce the bug, isolate variables, form hypothesis, test fix, verify", target_domain: "Business strategy analysis and planning", project: "t" } }));
  T("transfer: returns result", !!tr.skill);
  T("transfer: has recommendation", !!tr.recommendation);

  const sk = PT(await sendRPC(proc, 33, "tools/call", { name: "self_knowledge", arguments: { project: "t", analysis_type: "full" } }));
  T("self_knowledge: total memories", sk.total_memories >= 10);
  T("self_knowledge: mood distribution", !!sk.mood_distribution);
  T("self_knowledge: negative triggers", sk.negative_triggers?.length > 0);
  T("self_knowledge: energy patterns", !!sk.energy_patterns);
  T("self_knowledge: decision patterns", !!sk.decision_patterns);

  // ═══ ANTICIPATORY ═══
  const ant = PT(await sendRPC(proc, 40, "tools/call", { name: "anticipate", arguments: { context: "Planning to migrate our production database to a new cloud provider this weekend", project: "t", limit: 5 } }));
  T("anticipate: returns suggestions", ant.suggestions?.length > 0, "got " + ant.suggestions?.length);
  T("anticipate: has message", !!ant.message);

  const warn = PT(await sendRPC(proc, 41, "tools/call", { name: "warn", arguments: { planned_action: "Migrate our entire production database to a new cloud provider in one weekend without testing or rollback plan", project: "t" } }));
  T("warn: returns warnings", warn.warnings?.length > 0, "got " + warn.warnings?.length);
  T("warn: risk level is HIGH", warn.risk_level === "HIGH", "got " + warn.risk_level);
  T("warn: has recommendation", !!warn.recommendation);

  // ═══ MULTI-AGENT ═══
  const sha = PT(await sendRPC(proc, 50, "tools/call", { name: "share", arguments: { memory_ids: [m1.memory_id], to_agent: "codex", trust_level: 0.8 } }));
  T("share: shares memory", sha.memories_shared === 1);
  T("share: tracks target agent", sha.shared_to === "codex");

  const tru = PT(await sendRPC(proc, 51, "tools/call", { name: "trust", arguments: { agent_name: "codex", domain: "coding", trust_score: 0.9 } }));
  T("trust: sets score", tru.trust_score === 0.9);
  T("trust: status TRUSTED", tru.status === "TRUSTED");

  // ═══ CODE INTELLIGENCE ═══
  const cp = PT(await sendRPC(proc, 60, "tools/call", { name: "code_pattern", arguments: { action: "store", pattern_type: "architecture", description: "Repository pattern for database access in Python", code_snippet: "class UserRepository:\n    def get(self, id): ...", language: "python", file_path: "src/repositories/user.py", project: "t" } }));
  T("code_pattern: stores", cp.stored === true);

  const cpr = PT(await sendRPC(proc, 61, "tools/call", { name: "code_pattern", arguments: { action: "retrieve", project: "t" } }));
  T("code_pattern: retrieves", cpr.patterns?.length > 0);

  const cr = PT(await sendRPC(proc, 62, "tools/call", { name: "code_review", arguments: { file_path: "src/auth/login.py", change_description: "Refactoring authentication module to use JWT tokens", project: "t" } }));
  T("code_review: returns file_path", !!cr.file_path);
  T("code_review: returns risk_score", !!cr.risk_score);

  // ═══ RESOURCES ═══
  const g = PR(await sendRPC(proc, 70, "resources/read", { uri: "owl-memory://graph" }));
  T("resource: graph has nodes", g.nodes?.length > 0);
  T("resource: graph has entities", g.entities?.length > 0);
  T("resource: graph stats show vector enabled", g.stats?.vector_enabled === true);

  const ui = (await sendRPC(proc, 71, "resources/read", { uri: "owl-memory://graph-ui" })).result?.contents?.[0]?.text || "";
  T("resource: graph-ui is HTML", ui.includes("<!DOCTYPE html>"));
  T("resource: graph-ui has D3.js", ui.includes("d3.v7"));
  T("resource: graph-ui has force simulation", ui.includes("forceSimulation"));

  const kg = PR(await sendRPC(proc, 72, "resources/read", { uri: "owl-memory://knowledge-graph" }));
  T("resource: knowledge-graph defined", kg.nodes !== undefined);

  const decR = PR(await sendRPC(proc, 73, "resources/read", { uri: "owl-memory://decisions" }));
  T("resource: decisions defined", decR.decisions !== undefined);
  T("resource: decisions has data", decR.decisions?.length > 0);

  const ep = PR(await sendRPC(proc, 74, "resources/read", { uri: "owl-memory://emotional-patterns" }));
  T("resource: emotional-patterns defined", ep.patterns !== undefined);

  // ═══ CORE EXTRA ═══
  const room = PT(await sendRPC(proc, 80, "tools/call", { name: "create_room", arguments: { name: "Engineering", description: "Software engineering knowledge" } }));
  T("create_room", room.room_id?.length === 16);

  const nar = PT(await sendRPC(proc, 81, "tools/call", { name: "create_narrative", arguments: { title: "Cloud Migration Decision", project: "t" } }));
  T("create_narrative", nar.chain_id?.length === 16);

  const lp = PT(await sendRPC(proc, 82, "tools/call", { name: "learn_path", arguments: { goal: "Become a machine learning engineer", project: "t" } }));
  T("learn_path: returns path", lp.path?.length > 0);

  const pn = PT(await sendRPC(proc, 83, "tools/call", { name: "predict_needs", arguments: { context: "Starting a new Python project", project: "t" } }));
  T("predict_needs", !!pn.detected_mood);

  const hc = PT(await sendRPC(proc, 84, "tools/call", { name: "health_check", arguments: { project: "t" } }));
  T("health_check: score > 0", hc.health_score > 0);
  T("health_check: vector enabled", hc.vector_search === true);

  const st = PT(await sendRPC(proc, 85, "tools/call", { name: "get_stats", arguments: { project: "t" } }));
  T("get_stats: episodic count", st.episodic >= 10);

  // ═══ FINAL RESULTS ═══
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v4.0 — FINAL PROOF");
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
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
