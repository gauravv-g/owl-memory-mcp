const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v4-quick.db");
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
function PR(r) { try { return JSON.parse(r.result?.contents?.[0].text || r.result?.content?.[0]?.text || "{}"); } catch (e) { return {}; } }

async function main() {
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  await new Promise(r => setTimeout(r, 4000));

  // Seed
  await sendRPC(proc, 2, "tools/call", { name: "remember", arguments: { content: "Sundar Pichai is CEO of Google", project: "t" } });
  await sendRPC(proc, 3, "tools/call", { name: "remember", arguments: { content: "Failed DB migration to AWS — data loss", project: "t", event_type: "error" } });
  await sendRPC(proc, 4, "tools/call", { name: "remember", arguments: { content: "Google Cloud choice was great — Python skills transferred", project: "t", event_type: "insight" } });
  await sendRPC(proc, 5, "tools/call", { name: "remember", arguments: { content: "Tim Cook leads Apple Inc", project: "t" } });
  await sendRPC(proc, 6, "tools/call", { name: "remember", arguments: { content: "Elon Musk founded SpaceX and Tesla", project: "t" } });
  await sendRPC(proc, 7, "tools/call", { name: "remember", arguments: { content: "ISRO Chandrayaan 3 landed on Moon", project: "t" } });

  // CORE
  const m1 = PT(await sendRPC(proc, 10, "tools/call", { name: "remember", arguments: { content: "React was created by Jordan Walke at Meta", project: "t" } }));
  T("remember: stores", m1.memory_id?.length === 16);
  T("remember: NER entities >= 2", m1.entities_extracted >= 2);
  T("remember: NER person", m1.entity_summary?.person >= 1);
  T("remember: NER org", m1.entity_summary?.organization >= 1);
  T("remember: vector", m1.vector_embedding === true);
  T("remember: NER model", m1.ner_model === true);

  const rec = PT(await sendRPC(proc, 11, "tools/call", { name: "recall", arguments: { query: "CEO of Google", project: "t", limit: 3 } }));
  T("recall: results", rec.length > 0);
  T("recall: relevant top", rec[0]?.content?.includes("Sundar Pichai"));
  T("recall: reranked", rec[0]?.reranked === true);

  const sem = PT(await sendRPC(proc, 12, "tools/call", { name: "recall", arguments: { query: "leads Apple", project: "t", limit: 3 } }));
  T("recall: semantic", sem[0]?.content?.includes("Tim Cook"));

  // REASONING
  const dec = PT(await sendRPC(proc, 20, "tools/call", { name: "decide", arguments: { title: "DB migration", context: "Planning database migration to new cloud", options: ["All at once", "Gradual"], chosen_option: "Gradual", project: "t" } }));
  T("decide: id", dec.decision_id?.length === 16);
  T("decide: pre-mortem", dec.pre_mortem?.length > 0);
  T("decide: counterfactuals", dec.counterfactuals?.length === 1);
  T("decide: recommendation", !!dec.recommendation);

  const why = PT(await sendRPC(proc, 21, "tools/call", { name: "why", arguments: { situation: "Production outage after rushed deployment", max_depth: 3, project: "t" } }));
  T("why: chain", why.causal_chain !== undefined);
  T("why: analysis", !!why.analysis);

  const tr = PT(await sendRPC(proc, 22, "tools/call", { name: "transfer", arguments: { skill_description: "Debugging: reproduce, isolate, fix", target_domain: "Business analysis", project: "t" } }));
  T("transfer: result", !!tr.skill);
  T("transfer: recommendation", !!tr.recommendation);

  const sk = PT(await sendRPC(proc, 23, "tools/call", { name: "self_knowledge", arguments: { project: "t", analysis_type: "full" } }));
  T("self_knowledge: memories", sk.total_memories > 0);
  T("self_knowledge: mood", !!sk.mood_distribution);
  T("self_knowledge: triggers", !!sk.negative_triggers);
  T("self_knowledge: energy", !!sk.energy_patterns);

  // ANTICIPATORY
  const ant = PT(await sendRPC(proc, 30, "tools/call", { name: "anticipate", arguments: { context: "About to migrate database to new cloud", project: "t", limit: 3 } }));
  T("anticipate: suggestions", ant.suggestions?.length > 0);
  T("anticipate: message", !!ant.message);

  const warn = PT(await sendRPC(proc, 31, "tools/call", { name: "warn", arguments: { planned_action: "Migrate entire database in one weekend without testing", project: "t" } }));
  T("warn: warnings", warn.warnings?.length > 0);
  T("warn: risk HIGH", warn.risk_level === "HIGH");
  T("warn: recommendation", !!warn.recommendation);

  // MULTI-AGENT
  const sha = PT(await sendRPC(proc, 40, "tools/call", { name: "share", arguments: { memory_ids: [m1.memory_id], to_agent: "codex", trust_level: 0.8 } }));
  T("share: shares", sha.memories_shared === 1);
  T("share: agent", sha.shared_to === "codex");

  const tru = PT(await sendRPC(proc, 41, "tools/call", { name: "trust", arguments: { agent_name: "codex", domain: "coding", trust_score: 0.9 } }));
  T("trust: score", tru.trust_score === 0.9);
  T("trust: status", tru.status === "TRUSTED");

  // CODE
  const cp = PT(await sendRPC(proc, 50, "tools/call", { name: "code_pattern", arguments: { action: "store", pattern_type: "architecture", description: "Repository pattern", code_snippet: "class Repo: pass", language: "python", project: "t" } }));
  T("code_pattern store", cp.stored === true);

  const cpr = PT(await sendRPC(proc, 51, "tools/call", { name: "code_pattern", arguments: { action: "retrieve", project: "t" } }));
  T("code_pattern retrieve", cpr.patterns?.length > 0);

  const cr = PT(await sendRPC(proc, 52, "tools/call", { name: "code_review", arguments: { file_path: "src/auth.py", change_description: "JWT auth refactor", project: "t" } }));
  T("code_review: file", !!cr.file_path);
  T("code_review: risk", !!cr.risk_score);

  // RESOURCES
  const g = PR(await sendRPC(proc, 60, "resources/read", { uri: "owl-memory://graph" }));
  T("graph: nodes", g.nodes?.length > 0);
  T("graph: entities", g.entities?.length > 0);
  T("graph: vector", g.stats?.vector_enabled === true);

  const ui = (await sendRPC(proc, 61, "resources/read", { uri: "owl-memory://graph-ui" })).result?.contents?.[0]?.text || "";
  T("graph-ui: HTML", ui.includes("<!DOCTYPE html>"));
  T("graph-ui: D3", ui.includes("d3.v7"));

  const kg = PR(await sendRPC(proc, 62, "resources/read", { uri: "owl-memory://knowledge-graph" }));
  T("kg: defined", kg.nodes !== undefined);

  const decR = PR(await sendRPC(proc, 63, "resources/read", { uri: "owl-memory://decisions" }));
  T("decisions: defined", decR.decisions !== undefined);
  T("decisions: has data", decR.decisions?.length > 0);

  const ep = PR(await sendRPC(proc, 64, "resources/read", { uri: "owl-memory://emotional-patterns" }));
  T("emotional: defined", ep.patterns !== undefined);

  // CORE EXTRA
  const room = PT(await sendRPC(proc, 70, "tools/call", { name: "create_room", arguments: { name: "Eng" } }));
  T("create_room", room.room_id?.length === 16);

  const nar = PT(await sendRPC(proc, 71, "tools/call", { name: "create_narrative", arguments: { title: "Test", project: "t" } }));
  T("create_narrative", nar.chain_id?.length === 16);

  const lp = PT(await sendRPC(proc, 72, "tools/call", { name: "learn_path", arguments: { goal: "ML engineer", project: "t" } }));
  T("learn_path: path", lp.path?.length > 0);

  const pn = PT(await sendRPC(proc, 73, "tools/call", { name: "predict_needs", arguments: { context: "New Python project", project: "t" } }));
  T("predict_needs", !!pn.detected_mood);

  const hc = PT(await sendRPC(proc, 74, "tools/call", { name: "health_check", arguments: { project: "t" } }));
  T("health_check: score", hc.health_score > 0);
  T("health_check: vector", hc.vector_search === true);

  // RESULTS
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v4.0 — TEST RESULTS");
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
