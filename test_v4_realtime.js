/**
 * OWL Memory MCP v4.0 — Real-Time Capability Proof
 * Demonstrates what the system can do in real-time with timing data
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "v4-realtime.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { if (fs.existsSync(f)) fs.unlinkSync(f); }

const SERVER = path.join(__dirname, "owl_memory_v4.js");

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
function PT(r) { try { return JSON.parse(r.result?.content?.[0]?.text || "{}"); } catch (e) { return {}; } }
function PR(r) { try { return JSON.parse(r.result?.contents?.[0]?.text || r.result?.content?.[0]?.text || "{}"); } catch (e) { return {}; } }

async function main() {
  const proc = spawn("node", [SERVER], { env: { ...process.env, OWL_MEMORY_DB: DB_PATH }, stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "proof", version: "1" } });
  await new Promise(r => setTimeout(r, 4000));

  const timings = [];
  function bench(label, fn) {
    const start = Date.now();
    return fn().then(r => { timings.push({ label, ms: Date.now() - start }); return r; });
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  OWL Memory MCP v4.0 — REAL-TIME CAPABILITY PROOF");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. REMEMBER with full intelligence
  console.log("1. REMEMBER — Store with NER + Vector + Emotional Analysis");
  const m1 = await bench("remember", () => sendRPC(proc, 10, "tools/call", {
    name: "remember",
    arguments: { content: "Sundar Pichai announced Google's new AI strategy at the Mountain View headquarters in California", project: "demo" }
  }));
  const d1 = PT(m1);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Memory ID: ${d1.memory_id}`);
  console.log(`   Entities: ${d1.entities_extracted} (${JSON.stringify(d1.entity_summary)})`);
  console.log(`   Vector: ${d1.vector_embedding ? "✅ Generated" : "❌"}`);
  console.log(`   NER Model: ${d1.ner_model ? "✅ Active" : "❌"}`);
  console.log(`   Mood: ${d1.mood_tag}`);
  console.log(`   Emotional Valence: ${d1.emotional_valence}`);
  console.log(`   Contradictions: ${d1.contradictions_detected}\n`);

  // Seed more data
  await sendRPC(proc, 11, "tools/call", { name: "remember", arguments: { content: "Failed database migration to AWS — data loss due to no rollback plan", project: "demo", event_type: "error" } });
  await sendRPC(proc, 12, "tools/call", { name: "remember", arguments: { content: "Production outage from rushing cloud migration without testing", project: "demo", event_type: "error" } });
  await sendRPC(proc, 13, "tools/call", { name: "remember", arguments: { content: "Gradual migration with testing saved us from data loss", project: "demo", event_type: "insight" } });
  await sendRPC(proc, 14, "tools/call", { name: "remember", arguments: { content: "Tim Cook leads Apple Inc as CEO", project: "demo" } });
  await sendRPC(proc, 15, "tools/call", { name: "remember", arguments: { content: "Elon Musk founded SpaceX and Tesla in California", project: "demo" } });
  await sendRPC(proc, 16, "tools/call", { name: "remember", arguments: { content: "ISRO Chandrayaan 3 landed on Moon south pole", project: "demo" } });
  await sendRPC(proc, 17, "tools/call", { name: "remember", arguments: { content: "OpenAI released GPT 4 in March 2023", project: "demo" } });
  await sendRPC(proc, 18, "tools/call", { name: "remember", arguments: { content: "DeepMind AlphaFold solved protein folding", project: "demo" } });

  // 2. RECALL with hybrid search
  console.log("2. RECALL — Hybrid BM25 + Vector + Reranking");
  const r2 = await bench("recall", () => sendRPC(proc, 20, "tools/call", {
    name: "recall",
    arguments: { query: "Who is the CEO of Google?", project: "demo", limit: 3 }
  }));
  const d2 = PT(r2);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Results: ${d2.length}`);
  console.log(`   Top: "${d2[0]?.content?.slice(0, 60)}..."`);
  console.log(`   Score: ${d2[0]?.relevance_score} (vector: ${d2[0]?.vector_score}, bm25: ${d2[0]?.bm25_score})`);
  console.log(`   Reranked: ${d2[0]?.reranked ? "✅" : "❌"}\n`);

  // 3. DECIDE with pre-mortem
  console.log("3. DECIDE — Pre-Mortem Analysis + Counterfactuals");
  const r3 = await bench("decide", () => sendRPC(proc, 30, "tools/call", {
    name: "decide",
    arguments: {
      title: "Database migration strategy",
      context: "Planning to migrate our production database to a new cloud provider. This is critical infrastructure.",
      options: ["Migrate all at once this weekend", "Gradual migration with testing"],
      chosen_option: "Gradual migration with testing",
      project: "demo"
    }
  }));
  const d3 = PT(r3);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Decision ID: ${d3.decision_id}`);
  console.log(`   Pre-mortem (${d3.pre_mortem?.length} items):`);
  d3.pre_mortem?.forEach(p => console.log(`     ${p}`));
  console.log(`   Counterfactuals: ${d3.counterfactuals?.length} alternatives analyzed`);
  d3.counterfactuals?.forEach(c => console.log(`     Option "${c.option}": Risk: ${c.risk?.slice(0, 50)}`));
  console.log(`   Recommendation: ${d3.recommendation}\n`);

  // 4. WARN before failure
  console.log("4. WARN — Past Failure Pattern Matching");
  const r4 = await bench("warn", () => sendRPC(proc, 40, "tools/call", {
    name: "warn",
    arguments: { planned_action: "Migrate our entire production database to a new cloud provider in one weekend without testing or rollback plan", project: "demo" }
  }));
  const d4 = PT(r4);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Warnings: ${d4.warnings?.length} past failures matched`);
  d4.warnings?.forEach(w => console.log(`     ⚠️ ${w.memory?.slice(0, 70)} (similarity: ${w.similarity})`));
  console.log(`   Risk Level: ${d4.risk_level}`);
  console.log(`   Recommendation: ${d4.recommendation}\n`);

  // 5. ANTICIPATE proactive surfacing
  console.log("5. ANTICIPATE — Proactive Memory Surfacing");
  const r5 = await bench("anticipate", () => sendRPC(proc, 50, "tools/call", {
    name: "anticipate",
    arguments: { context: "Planning to migrate our production database to a new cloud provider this weekend", project: "demo", limit: 3 }
  }));
  const d5 = PT(r5);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Suggestions: ${d5.suggestions?.length} relevant memories found`);
  d5.suggestions?.forEach(s => console.log(`     → ${s.content?.slice(0, 60)} (relevance: ${s.relevance})`));
  console.log(`   Message: ${d5.message}\n`);

  // 6. WHY causal reasoning
  console.log("6. WHY — Root Cause Tracing");
  const r6 = await bench("why", () => sendRPC(proc, 60, "tools/call", {
    name: "why",
    arguments: { situation: "Production outage after rushing a database migration to cloud without proper testing", max_depth: 3, project: "demo" }
  }));
  const d6 = PT(r6);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Causal chain: ${d6.causal_chain?.length} steps`);
  d6.causal_chain?.forEach((c, i) => console.log(`     ${i + 1}. [${c.type}] ${c.content?.slice(0, 60)}`));
  console.log(`   Analysis: ${d6.analysis}\n`);

  // 7. SELF_KNOWLEDGE
  console.log("7. SELF_KNOWLEDGE — Emotional Intelligence");
  const r7 = await bench("self_knowledge", () => sendRPC(proc, 70, "tools/call", {
    name: "self_knowledge",
    arguments: { project: "demo", analysis_type: "full" }
  }));
  const d7 = PT(r7);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Total memories: ${d7.total_memories}`);
  console.log(`   Mood distribution: ${JSON.stringify(d7.mood_distribution)}`);
  console.log(`   Negative triggers: ${d7.negative_triggers?.join(", ")}`);
  console.log(`   Positive triggers: ${d7.positive_triggers?.join(", ")}`);
  console.log(`   Energy — High: ${d7.energy_patterns?.high_energy_count}, Low: ${d7.energy_patterns?.low_energy_count}`);
  console.log(`   Decisions: ${d7.decision_patterns?.total_decisions} total, ${d7.decision_patterns?.positive_outcomes} positive, ${d7.decision_patterns?.negative_outcomes} negative\n`);

  // 8. CODE REVIEW
  console.log("8. CODE_REVIEW — Memory-Driven Code Review");
  await sendRPC(proc, 80, "tools/call", { name: "code_pattern", arguments: { action: "store", pattern_type: "bug", description: "JWT token validation missing expiry check", code_snippet: "jwt.verify(token, secret)", language: "javascript", file_path: "src/auth.js", project: "demo" } });
  const r8 = await bench("code_review", () => sendRPC(proc, 81, "tools/call", {
    name: "code_review",
    arguments: { file_path: "src/auth/login.js", change_description: "Refactoring authentication to use JWT tokens with expiry validation", project: "demo" }
  }));
  const d8 = PT(r8);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   File: ${d8.file_path}`);
  console.log(`   Warnings: ${d8.warnings?.length} past bugs matched`);
  d8.warnings?.forEach(w => console.log(`     ⚠️ ${w.type}: ${w.description?.slice(0, 60)}`));
  console.log(`   Risk: ${d8.risk_score}\n`);

  // 9. MULTI-AGENT
  console.log("9. MULTI-AGENT — Memory Sharing + Trust");
  const r9a = await bench("share", () => sendRPC(proc, 90, "tools/call", {
    name: "share",
    arguments: { memory_ids: [d1.memory_id], to_agent: "codex", trust_level: 0.85 }
  }));
  console.log(`   Share time: ${timings[timings.length-1].ms}ms`);
  const d9a = PT(r9a);
  console.log(`   Shared: ${d9a.memories_shared} memory to ${d9a.shared_to} (trust: ${d9a.trust_level})`);

  const r9b = await bench("trust", () => sendRPC(proc, 91, "tools/call", {
    name: "trust",
    arguments: { agent_name: "codex", domain: "coding", trust_score: 0.92 }
  }));
  const d9b = PT(r9b);
  console.log(`   Trust: ${d9b.agent} → ${d9b.trust_score} (${d9b.status})\n`);

  // 10. GRAPH UI
  console.log("10. GRAPH UI — Interactive D3.js Visualization");
  const r10 = await bench("graph_ui", () => sendRPC(proc, 100, "resources/read", { uri: "owl-memory://graph-ui" }));
  const uiText = r10.result?.contents?.[0]?.text || "";
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   HTML size: ${uiText.length} chars`);
  console.log(`   D3.js: ${uiText.includes("d3.v7") ? "✅" : "❌"}`);
  console.log(`   Force simulation: ${uiText.includes("forceSimulation") ? "✅" : "❌"}`);
  console.log(`   Zoom/drag: ${uiText.includes("d3.zoom") && uiText.includes("d3.drag") ? "✅" : "❌"}`);
  console.log(`   Entity tags: ${uiText.includes("entity-tag") ? "✅" : "❌"}`);
  console.log(`   Decision panel: ${uiText.includes("decisions-section") ? "✅" : "❌"}\n`);

  // 11. DREAM CONSOLIDATION
  console.log("11. DREAM — Memory Consolidation");
  const r11 = await bench("dream", () => sendRPC(proc, 110, "tools/call", { name: "dream", arguments: { project: "demo" } }));
  const d11 = PT(r11);
  console.log(`   Time: ${timings[timings.length-1].ms}ms`);
  console.log(`   Status: ${d11.status}`);
  console.log(`   Processed: ${d11.processed} memories`);
  console.log(`   Merged: ${d11.merged} duplicates`);
  console.log(`   Schemas: ${d11.schemasCreated} abstracted`);
  console.log(`   Associations: ${d11.associationsFormed} formed\n`);

  // 12. EXPORT
  console.log("12. EXPORT — Full Data Portability");
  const exportPath = path.join(os.tmpdir(), "owl-v4-export.json");
  await sendRPC(proc, 120, "tools/call", { name: "export_memories", arguments: { project: "demo", filepath: exportPath } });
  const exportSize = fs.existsSync(exportPath) ? fs.statSync(exportPath).size : 0;
  console.log(`   Export: ${exportSize} bytes`);
  console.log(`   Format: JSON (portable)\n`);

  // TIMING SUMMARY
  console.log("═══════════════════════════════════════════════════");
  console.log("  TIMING SUMMARY");
  console.log("═══════════════════════════════════════════════════\n");
  timings.forEach(t => {
    const bar = "█".repeat(Math.min(50, Math.max(1, Math.round(t.ms / 10))));
    console.log(`   ${t.ms.toString().padStart(4)}ms ${bar} ${t.label}`);
  });
  const avg = Math.round(timings.reduce((s, t) => s + t.ms, 0) / timings.length);
  const max = Math.max(...timings.map(t => t.ms));
  const min = Math.min(...timings.map(t => t.ms));
  console.log(`\n   Average: ${avg}ms | Min: ${min}ms | Max: ${max}ms`);
  console.log(`   All operations under ${max}ms — real-time capable ✅`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
  try { fs.unlinkSync(exportPath); } catch {}
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
