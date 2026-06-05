/**
 * OWL Memory MCP v4.0 — Final Verification Test
 * Fixes all known issues from v1 test
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v4-final.db");
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
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 120000);
    const handler = (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const r = JSON.parse(trimmed);
          if (r.id === id) { clearTimeout(timeout); proc.stdout.off("data", handler); resolve(r); return; }
        } catch (e) {}
      }
    };
    proc.stdout.on("data", handler);
  });
}

function assert(testName, condition, detail) {
  total++;
  if (condition) { passed++; results.push("  ✓ " + testName); }
  else { failed++; results.push("  ✗ " + testName + " — " + (detail || "FAILED")); }
}

function parse(r) {
  try {
    // MCP resources return result.contents[0].text
    const text = r.result?.contents?.[0]?.text || r.result?.content?.[0]?.text || r.result?.[0]?.text || "";
    return JSON.parse(text);
  } catch (e) { return {}; }
}

function parseTool(r) {
  try {
    const text = r.result?.content?.[0]?.text || "";
    return JSON.parse(text);
  } catch (e) { return {}; }
}

async function main() {
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "v4-final", version: "1.0" } });
  console.log("✓ Initialized v4 server\n");
  await new Promise(r => setTimeout(r => {}, 5000));

  // ═══ SEED DATA ═══
  console.log("═══ SEEDING DATA ═══\n");

  // Store memories including failures for pre-mortem testing
  const seedData = [
    { content: "Sundar Pichai is the CEO of Google Alphabet Inc", type: "observation" },
    { content: "Satya Nadella leads Microsoft Corporation as CEO", type: "observation" },
    { content: "Tim Cook is the chief executive officer of Apple Inc", type: "observation" },
    { content: "Elon Musk founded SpaceX and Tesla Motors in California", type: "observation" },
    { content: "Python was created by Guido van Rossum in 1991", type: "observation" },
    { content: "JavaScript was developed by Brendan Eich at Netscape", type: "observation" },
    { content: "React was created by Jordan Walke at Facebook Meta", type: "observation" },
    { content: "Docker was developed by Solomon Hykes at dotCloud", type: "observation" },
    { content: "Kubernetes was created by Google and donated to CNCF", type: "observation" },
    { content: "RBI raised the repo rate by 25 basis points to 6.5 percent", type: "observation" },
    { content: "HDFC Bank merged with HDFC Ltd in July 2023", type: "observation" },
    { content: "SBI is the largest public sector bank in India", type: "observation" },
    { content: "Chandrayaan 3 successfully landed on the Moon south pole in August 2023", type: "observation" },
    { content: "ISRO launched Aditya L1 mission to study the Sun", type: "observation" },
    { content: "OpenAI released GPT 4 in March 2023", type: "observation" },
    { content: "DeepMind AlphaFold solved the protein folding problem", type: "observation" },
    { content: "Apple released the iPhone 15 with USB C port in September 2023", type: "observation" },
    { content: "Apple is the most valuable company in the world by market cap", type: "observation" },
    { content: "The apple fruit is grown extensively in Himachal Pradesh India", type: "observation" },
    { content: "Bitcoin reached its all time high of 69000 dollars in November 2021", type: "observation" },
    // Failures for pre-mortem testing
    { content: "Failed to migrate database to AWS — data loss occurred due to insufficient testing", type: "error" },
    { content: "Startup failed because we chose the wrong cloud provider and ran out of budget", type: "error" },
    { content: "Production outage caused by rushing a deployment without proper rollback plan", type: "error" },
    // Insights
    { content: "Choosing Google Cloud was the right decision — our team's Python expertise transferred well", type: "insight" },
    { content: "Investing in automated testing saved us 40 hours per week", type: "insight" },
  ];

  const memIds = [];
  for (let i = 0; i < seedData.length; i++) {
    const r = await sendRPC(proc, 100 + i, "tools/call", {
      name: "remember",
      arguments: { content: seedData[i].content, project: "test", event_type: seedData[i].type }
    });
    const d = parseTool(r);
    if (d.memory_id) memIds.push(d.memory_id);
  }
  assert("Seeded " + memIds.length + " memories", memIds.length === seedData.length, "only " + memIds.length);

  // ═══ LAYER 1: CORE MEMORY ═══
  console.log("\n═══ LAYER 1: CORE MEMORY ═══\n");

  // NER entity extraction
  const r1 = await sendRPC(proc, 200, "tools/call", { name: "remember", arguments: { content: "Sundar Pichai announced Google AI strategy in California", project: "test" } });
  const d1 = parseTool(r1);
  assert("NER: extracts entities", d1.entities_extracted >= 2, "only " + d1.entities_extracted);
  assert("NER: finds person", d1.entity_summary?.person >= 1, "no person");
  assert("NER: finds organization", d1.entity_summary?.organization >= 1, "no org");
  assert("NER: finds location", d1.entity_summary?.location >= 1, "no location");

  // recall
  const r2 = await sendRPC(proc, 201, "tools/call", { name: "recall", arguments: { query: "Who is the CEO of Google?", project: "test", limit: 5 } });
  const d2 = parseTool(r2);
  assert("recall: returns results", d2.length > 0, "no results");
  assert("recall: top result relevant", d2[0]?.content?.includes("Sundar Pichai"), "top: " + d2[0]?.content?.slice(0, 50));
  assert("recall: has relevance scores", d2[0]?.relevance_score > 0, "no score");
  assert("recall: reranking applied", d2[0]?.reranked === true, "not reranked");

  // semantic recall
  const r3 = await sendRPC(proc, 202, "tools/call", { name: "recall", arguments: { query: "chief executive of Apple", project: "test", limit: 3 } });
  assert("recall: semantic search", parseTool(r3)[0]?.content?.includes("Tim Cook"), "wrong top");

  // get_memory
  const r4 = await sendRPC(proc, 203, "tools/call", { name: "get_memory", arguments: { memory_id: memIds[0] } });
  assert("get_memory: retrieves", parseTool(r4).id === memIds[0], "wrong id");

  // update_memory
  const r5 = await sendRPC(proc, 204, "tools/call", { name: "update_memory", arguments: { memory_id: memIds[0], new_content: "Updated content" } });
  assert("update_memory: updates", parseTool(r5).updated === true, "not updated");

  // forget
  const r6 = await sendRPC(proc, 205, "tools/call", { name: "forget", arguments: { memory_id: memIds[memIds.length - 1] } });
  assert("forget: soft-deletes", parseTool(r6).forgotten !== undefined || r6.result?.content?.[0]?.text?.includes("forgotten"), "not forgotten");

  // focus / unfocus
  const r7 = await sendRPC(proc, 206, "tools/call", { name: "focus", arguments: { memory_ids: [memIds[0], memIds[1]], project: "test" } });
  assert("focus: loads WM", parseTool(r7).working_memory?.length === 2, "wrong WM size");

  const r8 = await sendRPC(proc, 207, "tools/call", { name: "get_working_memory", arguments: {} });
  assert("get_working_memory: shows state", parseTool(r8).working_memory?.length === 2, "wrong size");

  await sendRPC(proc, 208, "tools/call", { name: "unfocus", arguments: { clear_all: true } });

  // checkpoint
  const r9 = await sendRPC(proc, 209, "tools/call", { name: "save_checkpoint", arguments: { name: "test-checkpoint", project: "test" } });
  assert("save_checkpoint: saves", parseTool(r9).checkpoint_id?.length === 16, "no id");

  const r10 = await sendRPC(proc, 210, "tools/call", { name: "list_checkpoints", arguments: { project: "test" } });
  assert("list_checkpoints: lists", parseTool(r10).length > 0, "empty");

  // dream
  const r11 = await sendRPC(proc, 211, "tools/call", { name: "dream", arguments: { project: "test" } });
  assert("dream: consolidates", parseTool(r11).status === "completed", "not completed");

  // health_check
  const r12 = await sendRPC(proc, 212, "tools/call", { name: "health_check", arguments: { project: "test" } });
  const h12 = parseTool(r12);
  assert("health_check: score", h12.health_score > 0, "no score");
  assert("health_check: tracks types", h12.memories?.episodic > 0, "no episodic");

  // get_stats
  const r13 = await sendRPC(proc, 213, "tools/call", { name: "get_stats", arguments: { project: "test" } });
  assert("get_stats: returns stats", parseTool(r13).episodic > 0, "no episodic");

  // ═══ LAYER 2: REASONING ═══
  console.log("\n═══ LAYER 2: REASONING ═══\n");

  // decide (now with past failures in the dataset)
  const r14 = await sendRPC(proc, 214, "tools/call", { name: "decide", arguments: {
    title: "Migrate database to new cloud",
    context: "Planning to migrate our entire database to a new cloud provider. This is a critical operation.",
    options: ["Migrate all at once", "Gradual migration", "Hybrid approach"],
    chosen_option: "Gradual migration",
    project: "test"
  }});
  const d14 = parseTool(r14);
  assert("decide: decision_id", d14.decision_id?.length === 16, "no id");
  assert("decide: pre-mortem has content", d14.pre_mortem?.length > 0, "empty pre-mortem: " + JSON.stringify(d14.pre_mortem));
  assert("decide: counterfactuals", d14.counterfactuals?.length === 2, "wrong count: " + d14.counterfactuals?.length);
  assert("decide: recommendation", d14.recommendation !== undefined, "none");

  // why
  const r15 = await sendRPC(proc, 215, "tools/call", { name: "why", arguments: { situation: "Our startup had a production outage after rushing a deployment", max_depth: 3, project: "test" } });
  const d15 = parseTool(r15);
  assert("why: causal chain", d15.causal_chain !== undefined, "no chain");
  assert("why: analysis", d15.analysis !== undefined, "no analysis");

  // transfer
  const r16 = await sendRPC(proc, 216, "tools/call", { name: "transfer", arguments: { skill_description: "Systematic debugging: isolate variables, reproduce, fix, verify", target_domain: "Business strategy analysis", project: "test" } });
  const d16 = parseTool(r16);
  assert("transfer: returns result", d16.skill !== undefined, "no skill");
  assert("transfer: recommendation", d16.recommendation !== undefined, "none");

  // self_knowledge
  const r17 = await sendRPC(proc, 217, "tools/call", { name: "self_knowledge", arguments: { project: "test", analysis_type: "full" } });
  const d17 = parseTool(r17);
  assert("self_knowledge: total memories", d17.total_memories > 0, "no memories");
  assert("self_knowledge: mood distribution", d17.mood_distribution !== undefined, "no mood");
  assert("self_knowledge: event types", d17.event_type_distribution !== undefined, "no types");
  assert("self_knowledge: emotional trajectory", d17.emotional_trajectory !== undefined, "no trajectory");
  assert("self_knowledge: triggers", d17.negative_triggers !== undefined, "no triggers");
  assert("self_knowledge: energy patterns", d17.energy_patterns !== undefined, "no energy");
  assert("self_knowledge: decision patterns", d17.decision_patterns !== undefined, "no patterns");

  // ═══ LAYER 3: KNOWLEDGE ═══
  console.log("\n═══ LAYER 3: KNOWLEDGE ═══\n");

  // Populate knowledge graph
  const r18 = await sendRPC(proc, 218, "tools/call", { name: "learn_skill", arguments: { title: "Python Programming", content: "Variables, functions, classes, modules, packages", project: "test" } });
  const skillId = parseTool(r18).skill_id;

  // knowledge_graph
  const r19 = await sendRPC(proc, 219, "tools/call", { name: "knowledge_graph", arguments: { project: "test", action: "view" } });
  const d19 = parseTool(r19);
  assert("knowledge_graph: view", d19.nodes !== undefined, "no nodes");

  const r20 = await sendRPC(proc, 220, "tools/call", { name: "knowledge_graph", arguments: { project: "test", action: "stats" } });
  const d20 = parseTool(r20);
  assert("knowledge_graph: stats", d20.nodes !== undefined, "no stats");

  // learn_path
  const r21 = await sendRPC(proc, 221, "tools/call", { name: "learn_path", arguments: { goal: "Become a machine learning engineer", project: "test" } });
  const d21 = parseTool(r21);
  assert("learn_path: returns path", d21.path !== undefined, "no path");
  assert("learn_path: has steps", d21.path?.length > 0, "empty path");

  // ═══ LAYER 4: ANTICIPATORY ═══
  console.log("\n═══ LAYER 4: ANTICIPATORY ═══\n");

  const r22 = await sendRPC(proc, 222, "tools/call", { name: "anticipate", arguments: { context: "I'm about to migrate our database to a new cloud provider", project: "test", limit: 5 } });
  const d22 = parseTool(r22);
  assert("anticipate: suggestions", d22.suggestions !== undefined, "none");
  assert("anticipate: has relevant results", d22.suggestions?.length > 0, "no relevant memories");
  assert("anticipate: message", d22.message !== undefined, "none");

  const r23 = await sendRPC(proc, 223, "tools/call", { name: "warn", arguments: { planned_action: "Migrate our entire database to a new cloud provider in one weekend without testing", project: "test" } });
  const d23 = parseTool(r23);
  assert("warn: warnings", d23.warnings !== undefined, "none");
  assert("warn: has relevant warnings", d23.warnings?.length > 0, "no warnings found");
  assert("warn: risk level", d23.risk_level === "HIGH", "risk: " + d23.risk_level);
  assert("warn: recommendation", d23.recommendation !== undefined, "none");

  // ═══ LAYER 5: MULTI-AGENT ═══
  console.log("\n═══ LAYER 5: MULTI-AGENT ═══\n");

  const r24 = await sendRPC(proc, 224, "tools/call", { name: "share", arguments: { memory_ids: [memIds[0], memIds[1]], to_agent: "claude-code", trust_level: 0.8 } });
  const d24 = parseTool(r24);
  assert("share: shares", d24.memories_shared === 2, "wrong count");
  assert("share: tracks agent", d24.shared_to === "claude-code", "wrong agent");

  const r25 = await sendRPC(proc, 225, "tools/call", { name: "trust", arguments: { agent_name: "claude-code", domain: "coding", trust_score: 0.9 } });
  const d25 = parseTool(r25);
  assert("trust: score", d25.trust_score === 0.9, "wrong score");
  assert("trust: status", d25.status === "TRUSTED", "wrong status");

  const r26 = await sendRPC(proc, 226, "tools/call", { name: "collective", arguments: { query: "cloud providers", limit: 5 } });
  const d26 = parseTool(r26);
  assert("collective: own results", d26.own_results?.length > 0, "no results");
  assert("collective: total knowledge", d26.total_knowledge > 0, "no total");

  // ═══ LAYER 6: CODE INTELLIGENCE ═══
  console.log("\n═══ LAYER 6: CODE INTELLIGENCE ═══\n");

  const r27 = await sendRPC(proc, 227, "tools/call", { name: "code_pattern", arguments: { action: "store", pattern_type: "architecture", description: "Repository pattern for database access", code_snippet: "class UserRepository:\n    def get(self, id): ...", language: "python", file_path: "src/repositories/user.py", project: "test" } });
  assert("code_pattern store", parseTool(r27).stored === true, "not stored");

  const r28 = await sendRPC(proc, 228, "tools/call", { name: "code_pattern", arguments: { action: "retrieve", description: "database access pattern", project: "test" } });
  assert("code_pattern retrieve", parseTool(r28).patterns?.length > 0, "no patterns");

  const r29 = await sendRPC(proc, 229, "tools/call", { name: "code_review", arguments: { file_path: "src/auth/login.py", change_description: "Refactoring authentication to use JWT tokens", project: "test" } });
  const d29 = parseTool(r29);
  assert("code_review: file_path", d29.file_path !== undefined, "no file_path");
  assert("code_review: risk_score", d29.risk_score !== undefined, "no risk");

  // ═══ RESOURCES ═══
  console.log("\n═══ RESOURCES ═══\n");

  const r30 = await sendRPC(proc, 230, "resources/read", { uri: "owl-memory://graph" });
  const g30 = parse(r30);
  assert("resource: graph nodes", g30.nodes?.length > 0, "no nodes");
  assert("resource: graph entities", g30.entities?.length > 0, "no entities");
  assert("resource: graph stats", g30.stats?.vector_enabled === true, "no stats");

  const r31 = await sendRPC(proc, 231, "resources/read", { uri: "owl-memory://graph-ui" });
  const uiText = r31.result?.contents?.[0]?.text || "";
  assert("resource: graph-ui HTML", uiText.includes("<!DOCTYPE html>"), "no HTML");
  assert("resource: graph-ui D3", uiText.includes("d3.v7"), "no D3");
  assert("resource: graph-ui force", uiText.includes("forceSimulation"), "no force");

  const r32 = await sendRPC(proc, 232, "resources/read", { uri: "owl-memory://knowledge-graph" });
  const kg32 = parse(r32);
  assert("resource: kg data", kg32.nodes !== undefined, "no nodes");

  const r33 = await sendRPC(proc, 233, "resources/read", { uri: "owl-memory://decisions" });
  const d33 = parse(r33);
  assert("resource: decisions", d33.decisions !== undefined, "no decisions");
  assert("resource: has decision", d33.decisions?.length > 0, "empty");

  const r34 = await sendRPC(proc, 234, "resources/read", { uri: "owl-memory://emotional-patterns" });
  const ep34 = parse(r34);
  assert("resource: emotional patterns", ep34.patterns !== undefined, "no patterns");

  // ═══ ADDITIONAL CORE ═══
  console.log("\n═══ ADDITIONAL CORE TOOLS ═══\n");

  const r35 = await sendRPC(proc, 235, "tools/call", { name: "create_room", arguments: { name: "Engineering", description: "Software engineering" } });
  assert("create_room", parseTool(r35).room_id?.length === 16, "no room_id");

  const r36 = await sendRPC(proc, 236, "tools/call", { name: "place_memory", arguments: { memory_id: memIds[0], room_id: parseTool(r35).room_id } });
  assert("place_memory", parseTool(r36).placed === true, "not placed");

  const r37 = await sendRPC(proc, 237, "tools/call", { name: "navigate_palace", arguments: { list_rooms: true } });
  assert("navigate_palace", parseTool(r37).rooms?.length > 0, "no rooms");

  const r38 = await sendRPC(proc, 238, "tools/call", { name: "create_narrative", arguments: { title: "Cloud Decision", project: "test" } });
  assert("create_narrative", parseTool(r38).chain_id?.length === 16, "no chain_id");

  const r39 = await sendRPC(proc, 239, "tools/call", { name: "learn_skill", arguments: { title: "Debugging", content: "Reproduce, isolate, fix, verify", project: "test" } });
  assert("learn_skill", parseTool(r39).skill_id?.length === 16, "no skill_id");

  const r40 = await sendRPC(proc, 240, "tools/call", { name: "practice_skill", arguments: { skill_id: parseTool(r39).skill_id, success: true } });
  assert("practice_skill", parseTool(r40).mastery_level > 0, "no mastery");

  const r41 = await sendRPC(proc, 241, "tools/call", { name: "predict_needs", arguments: { context: "Starting a new Python project", project: "test" } });
  assert("predict_needs", parseTool(r41).detected_mood !== undefined, "no mood");

  const r42 = await sendRPC(proc, 242, "tools/call", { name: "review", arguments: { project: "test", limit: 5 } });
  assert("review", parseTool(r42).due_for_review !== undefined, "no review");

  const r43 = await sendRPC(proc, 243, "tools/call", { name: "get_contradictions", arguments: { project: "test" } });
  assert("get_contradictions", Array.isArray(parseTool(r43)), "not array");

  const exportPath = path.join(os.tmpdir(), "owl-v4-export.json");
  await sendRPC(proc, 244, "tools/call", { name: "export_memories", arguments: { project: "test", filepath: exportPath } });
  assert("export_memories", fs.existsSync(exportPath), "file not created");

  // ═══ RESULTS ═══
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v4.0 — FINAL TEST RESULTS");
  console.log("═══════════════════════════════════════════════════\n");
  results.forEach(r => console.log(r));
  const pct = Math.round((passed / total) * 100);
  const grade = pct >= 95 ? "EXCELLENT ✅" : pct >= 85 ? "GOOD ✅" : pct >= 70 ? "FAIR ⚠️" : "POOR ❌";
  console.log(`\n  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Score: ${pct}% — ${grade}`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
  try { fs.unlinkSync(exportPath); } catch {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
