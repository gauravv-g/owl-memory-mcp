/**
 * OWL Memory MCP v4.0 — Comprehensive Test Suite (v2)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v4-test2.db");
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

function getText(r) {
  try {
    if (r.result?.content?.[0]?.text) return r.result.content[0].text;
    if (r.result?.[0]?.text) return r.result[0].text;
    return JSON.stringify(r).slice(0, 300);
  } catch (e) { return String(r).slice(0, 300); }
}

function parse(r) { try { return JSON.parse(getText(r)); } catch (e) { return {}; } }

async function main() {
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "v4-test", version: "1.0" } });
  console.log("✓ Initialized v4 server\n");
  await new Promise(r => setTimeout(r, 5000));

  // ═══ LAYER 1: CORE MEMORY ═══
  console.log("═══ LAYER 1: CORE MEMORY ═══\n");

  const r1 = await sendRPC(proc, 10, "tools/call", { name: "remember", arguments: { content: "Sundar Pichai is the CEO of Google Alphabet Inc", project: "test" } });
  const d1 = parse(r1);
  assert("remember: stores memory", d1.memory_id?.length === 16, "no memory_id");
  assert("remember: extracts NER entities", d1.entities_extracted >= 3, "only " + d1.entities_extracted);
  assert("remember: NER finds person", d1.entity_summary?.person >= 1, "no person");
  assert("remember: NER finds organization", d1.entity_summary?.organization >= 1, "no org");
  assert("remember: vector embedding", d1.vector_embedding === true, "no vector");
  assert("remember: NER model active", d1.ner_model === true, "NER off");

  // Store more memories
  const memTexts = [
    "Satya Nadella leads Microsoft Corporation as CEO",
    "Tim Cook is the chief executive officer of Apple Inc",
    "Elon Musk founded SpaceX and Tesla Motors in California",
    "Python was created by Guido van Rossum in 1991",
    "JavaScript was developed by Brendan Eich at Netscape",
    "React was created by Jordan Walke at Facebook Meta",
    "Docker was developed by Solomon Hykes at dotCloud",
    "Kubernetes was created by Google and donated to CNCF",
    "RBI raised the repo rate by 25 basis points to 6.5 percent",
    "HDFC Bank merged with HDFC Ltd in July 2023",
    "SBI is the largest public sector bank in India",
    "Chandrayaan 3 successfully landed on the Moon south pole in August 2023",
    "ISRO launched Aditya L1 mission to study the Sun",
    "OpenAI released GPT 4 in March 2023",
    "DeepMind AlphaFold solved the protein folding problem",
    "Apple released the iPhone 15 with USB C port in September 2023",
    "Apple is the most valuable company in the world by market cap",
    "The apple fruit is grown extensively in Himachal Pradesh India",
    "Bitcoin reached its all time high of 69000 dollars in November 2021",
    "CRISPR gene editing was discovered by Jennifer Doudna and Emmanuelle Charpentier"
  ];
  for (let i = 0; i < memTexts.length; i++) {
    await sendRPC(proc, 11 + i, "tools/call", { name: "remember", arguments: { content: memTexts[i], project: "test" } });
  }

  // recall
  const r31 = await sendRPC(proc, 31, "tools/call", { name: "recall", arguments: { query: "Who is the CEO of Google?", project: "test", limit: 5 } });
  const d31 = parse(r31);
  assert("recall: returns results", d31.length > 0, "no results");
  assert("recall: top result relevant", d31[0]?.content?.includes("Sundar Pichai"), "top: " + d31[0]?.content?.slice(0, 50));
  assert("recall: has scores", d31[0]?.relevance_score > 0, "no score");

  // semantic recall
  const r32 = await sendRPC(proc, 32, "tools/call", { name: "recall", arguments: { query: "chief executive of Apple", project: "test", limit: 3 } });
  const d32 = parse(r32);
  assert("recall: semantic search", d32[0]?.content?.includes("Tim Cook"), "top: " + d32[0]?.content?.slice(0, 50));

  // get_memory
  const r33 = await sendRPC(proc, 33, "tools/call", { name: "get_memory", arguments: { memory_id: d1.memory_id } });
  const d33 = parse(r33);
  assert("get_memory: retrieves", d33.id === d1.memory_id, "wrong id");

  // update_memory
  const r34 = await sendRPC(proc, 34, "tools/call", { name: "update_memory", arguments: { memory_id: d1.memory_id, new_content: "Sundar Pichai is the CEO of Google Alphabet Inc, overseeing AI strategy" } });
  assert("update_memory: updates", parse(r34).updated === true, "not updated");

  // forget
  const fid = parse(await sendRPC(proc, 35, "tools/call", { name: "remember", arguments: { content: "Temp memory to forget", project: "test" } })).memory_id;
  const r36 = await sendRPC(proc, 36, "tools/call", { name: "forget", arguments: { memory_id: fid } });
  assert("forget: soft-deletes", getText(r36).includes("forgotten"), "not forgotten");

  // focus / unfocus
  const r37 = await sendRPC(proc, 37, "tools/call", { name: "focus", arguments: { memory_ids: [d1.memory_id], project: "test" } });
  assert("focus: loads WM", parse(r37).working_memory?.length > 0, "empty WM");
  const r38 = await sendRPC(proc, 38, "tools/call", { name: "get_working_memory", arguments: {} });
  assert("get_working_memory: shows state", parse(r38).working_memory?.length > 0, "empty");
  await sendRPC(proc, 39, "tools/call", { name: "unfocus", arguments: { clear_all: true } });

  // checkpoint
  const r40 = await sendRPC(proc, 40, "tools/call", { name: "save_checkpoint", arguments: { name: "test-cp", project: "test" } });
  assert("save_checkpoint: saves", parse(r40).checkpoint_id?.length === 16, "no id");
  const r41 = await sendRPC(proc, 41, "tools/call", { name: "list_checkpoints", arguments: { project: "test" } });
  assert("list_checkpoints: lists", parse(r41).length > 0, "empty");

  // dream
  const r42 = await sendRPC(proc, 42, "tools/call", { name: "dream", arguments: { project: "test" } });
  assert("dream: consolidates", parse(r42).status === "completed", "not completed");

  // health_check
  const r43 = await sendRPC(proc, 43, "tools/call", { name: "health_check", arguments: { project: "test" } });
  const h43 = parse(r43);
  assert("health_check: returns score", h43.health_score !== undefined, "no score");
  assert("health_check: tracks types", h43.memories?.episodic > 0, "no episodic");

  // get_stats
  const r44 = await sendRPC(proc, 44, "tools/call", { name: "get_stats", arguments: { project: "test" } });
  assert("get_stats: returns stats", parse(r44).episodic > 0, "no episodic");

  // ═══ LAYER 2: REASONING ═══
  console.log("\n═══ LAYER 2: REASONING ═══\n");

  const r50 = await sendRPC(proc, 50, "tools/call", { name: "decide", arguments: { title: "Choose cloud provider", context: "Need to decide between AWS and Google Cloud for our startup. Budget is limited.", options: ["AWS", "Google Cloud", "Azure"], chosen_option: "Google Cloud", project: "test" } });
  const d50 = parse(r50);
  assert("decide: decision_id", d50.decision_id?.length === 16, "no id");
  assert("decide: pre-mortem", d50.pre_mortem?.length > 0, "no pre-mortem");
  assert("decide: counterfactuals", d50.counterfactuals?.length > 0, "none");
  assert("decide: recommendation", d50.recommendation !== undefined, "none");

  const r51 = await sendRPC(proc, 51, "tools/call", { name: "why", arguments: { situation: "Our startup chose Google Cloud because the team knew Python", max_depth: 3, project: "test" } });
  const d51 = parse(r51);
  assert("why: causal chain", d51.causal_chain !== undefined, "no chain");
  assert("why: analysis", d51.analysis !== undefined, "no analysis");

  const r52 = await sendRPC(proc, 52, "tools/call", { name: "transfer", arguments: { skill_description: "Systematic debugging: isolate variables, reproduce, fix, verify", target_domain: "Business strategy analysis", project: "test" } });
  const d52 = parse(r52);
  assert("transfer: returns result", d52.skill !== undefined, "no skill");
  assert("transfer: recommendation", d52.recommendation !== undefined, "none");

  const r53 = await sendRPC(proc, 53, "tools/call", { name: "self_knowledge", arguments: { project: "test", analysis_type: "full" } });
  const d53 = parse(r53);
  assert("self_knowledge: total memories", d53.total_memories > 0, "no memories");
  assert("self_knowledge: mood distribution", d53.mood_distribution !== undefined, "no mood");
  assert("self_knowledge: event types", d53.event_type_distribution !== undefined, "no types");

  // ═══ LAYER 3: KNOWLEDGE ═══
  console.log("\n═══ LAYER 3: KNOWLEDGE ═══\n");

  const r60 = await sendRPC(proc, 60, "tools/call", { name: "knowledge_graph", arguments: { project: "test", action: "view" } });
  assert("knowledge_graph: view", parse(r60).nodes !== undefined, "no nodes");

  const r61 = await sendRPC(proc, 61, "tools/call", { name: "knowledge_graph", arguments: { project: "test", action: "gaps" } });
  assert("knowledge_graph: gaps", parse(r61).knowledge_gaps !== undefined, "no gaps");

  const r62 = await sendRPC(proc, 62, "tools/call", { name: "knowledge_graph", arguments: { project: "test", action: "stats" } });
  const d62 = parse(r62);
  assert("knowledge_graph: stats", d62.nodes !== undefined, "no stats");

  const r63 = await sendRPC(proc, 63, "tools/call", { name: "learn_path", arguments: { goal: "Become a machine learning engineer", project: "test" } });
  const d63 = parse(r63);
  assert("learn_path: returns path", d63.path !== undefined, "no path");
  assert("learn_path: has steps", d63.path?.length > 0, "empty path");

  // ═══ LAYER 4: ANTICIPATORY ═══
  console.log("\n═══ LAYER 4: ANTICIPATORY ═══\n");

  const r70 = await sendRPC(proc, 70, "tools/call", { name: "anticipate", arguments: { context: "I'm about to choose a cloud provider for our startup", project: "test", limit: 5 } });
  const d70 = parse(r70);
  assert("anticipate: suggestions", d70.suggestions !== undefined, "none");
  assert("anticipate: message", d70.message !== undefined, "none");

  const r71 = await sendRPC(proc, 71, "tools/call", { name: "warn", arguments: { planned_action: "Migrate our entire database to a new cloud provider in one weekend", project: "test" } });
  const d71 = parse(r71);
  assert("warn: warnings", d71.warnings !== undefined, "none");
  assert("warn: risk level", d71.risk_level !== undefined, "none");
  assert("warn: recommendation", d71.recommendation !== undefined, "none");

  // ═══ LAYER 5: MULTI-AGENT ═══
  console.log("\n═══ LAYER 5: MULTI-AGENT ═══\n");

  const r80 = await sendRPC(proc, 80, "tools/call", { name: "share", arguments: { memory_ids: [d1.memory_id], to_agent: "claude-code", trust_level: 0.8 } });
  const d80 = parse(r80);
  assert("share: shares", d80.memories_shared > 0, "none shared");
  assert("share: tracks agent", d80.shared_to === "claude-code", "wrong agent");

  const r81 = await sendRPC(proc, 81, "tools/call", { name: "trust", arguments: { agent_name: "claude-code", domain: "coding", trust_score: 0.9 } });
  const d81 = parse(r81);
  assert("trust: score", d81.trust_score === 0.9, "wrong score");
  assert("trust: status", d81.status === "TRUSTED", "wrong status");

  const r82 = await sendRPC(proc, 82, "tools/call", { name: "collective", arguments: { query: "cloud providers", limit: 5 } });
  const d82 = parse(r82);
  assert("collective: own results", d82.own_results !== undefined, "no results");
  assert("collective: total knowledge", d82.total_knowledge !== undefined, "no total");

  // ═══ LAYER 6: CODE INTELLIGENCE ═══
  console.log("\n═══ LAYER 6: CODE INTELLIGENCE ═══\n");

  const r90 = await sendRPC(proc, 90, "tools/call", { name: "code_pattern", arguments: { action: "store", pattern_type: "architecture", description: "Use repository pattern for database access in Python", code_snippet: "class UserRepository:\n    def get(self, id): ...", language: "python", file_path: "src/repositories/user.py", project: "test" } });
  assert("code_pattern store", parse(r90).stored === true, "not stored");

  const r91 = await sendRPC(proc, 91, "tools/call", { name: "code_pattern", arguments: { action: "retrieve", description: "database access pattern", project: "test" } });
  assert("code_pattern retrieve", parse(r91).patterns !== undefined, "no patterns");

  const r92 = await sendRPC(proc, 92, "tools/call", { name: "code_review", arguments: { file_path: "src/auth/login.py", change_description: "Refactoring authentication to use JWT tokens", project: "test" } });
  const d92 = parse(r92);
  assert("code_review: file_path", d92.file_path !== undefined, "no file_path");
  assert("code_review: risk_score", d92.risk_score !== undefined, "no risk");

  // ═══ RESOURCES ═══
  console.log("\n═══ RESOURCES ═══\n");

  const r100 = await sendRPC(proc, 100, "resources/read", { uri: "owl-memory://graph" });
  const gData = parse(r100);
  assert("resource: graph nodes", gData.nodes?.length > 0, "no nodes");
  assert("resource: graph entities", gData.entities?.length > 0, "no entities");
  assert("resource: graph stats", gData.stats?.vector_enabled === true, "no stats");

  const r101 = await sendRPC(proc, 101, "resources/read", { uri: "owl-memory://graph-ui" });
  const uiText = getText(r101);
  assert("resource: graph-ui HTML", uiText.includes("<!DOCTYPE html>"), "no HTML");
  assert("resource: graph-ui D3", uiText.includes("d3.v7"), "no D3");

  const r102 = await sendRPC(proc, 102, "resources/read", { uri: "owl-memory://knowledge-graph" });
  assert("resource: kg data", parse(r102).nodes !== undefined, "no nodes");

  const r103 = await sendRPC(proc, 103, "resources/read", { uri: "owl-memory://decisions" });
  const d103 = parse(r103);
  assert("resource: decisions", d103.decisions !== undefined, "no decisions");
  assert("resource: has decision", d103.decisions?.length > 0, "empty");

  const r104 = await sendRPC(proc, 104, "resources/read", { uri: "owl-memory://emotional-patterns" });
  assert("resource: emotional patterns", parse(r104).patterns !== undefined, "no patterns");

  // ═══ ADDITIONAL CORE ═══
  console.log("\n═══ ADDITIONAL CORE TOOLS ═══\n");

  const r110 = await sendRPC(proc, 110, "tools/call", { name: "create_room", arguments: { name: "Engineering", description: "Software engineering knowledge" } });
  assert("create_room", parse(r110).room_id?.length === 16, "no room_id");

  const r111 = await sendRPC(proc, 111, "tools/call", { name: "place_memory", arguments: { memory_id: d1.memory_id, room_id: parse(r110).room_id } });
  assert("place_memory", getText(r111).includes("placed"), "not placed");

  const r112 = await sendRPC(proc, 112, "tools/call", { name: "navigate_palace", arguments: { list_rooms: true } });
  assert("navigate_palace", parse(r112).rooms?.length > 0, "no rooms");

  const r113 = await sendRPC(proc, 113, "tools/call", { name: "create_narrative", arguments: { title: "Cloud Decision", project: "test" } });
  assert("create_narrative", parse(r113).chain_id?.length === 16, "no chain_id");

  const r114 = await sendRPC(proc, 114, "tools/call", { name: "learn_skill", arguments: { title: "Systematic Debugging", content: "1. Reproduce\n2. Isolate\n3. Fix\n4. Verify", project: "test" } });
  assert("learn_skill", parse(r114).skill_id?.length === 16, "no skill_id");

  const r115 = await sendRPC(proc, 115, "tools/call", { name: "practice_skill", arguments: { skill_id: parse(r114).skill_id, success: true } });
  assert("practice_skill", parse(r115).mastery_level > 0, "no mastery");

  const r116 = await sendRPC(proc, 116, "tools/call", { name: "predict_needs", arguments: { context: "Starting a new Python project", project: "test" } });
  assert("predict_needs", parse(r116).detected_mood !== undefined, "no mood");

  const r117 = await sendRPC(proc, 117, "tools/call", { name: "review", arguments: { project: "test", limit: 5 } });
  assert("review", parse(r117).due_for_review !== undefined, "no review");

  const r118 = await sendRPC(proc, 118, "tools/call", { name: "get_contradictions", arguments: { project: "test" } });
  assert("get_contradictions", Array.isArray(parse(r118)), "not array");

  const exportPath = path.join(os.tmpdir(), "owl-v4-export.json");
  await sendRPC(proc, 119, "tools/call", { name: "export_memories", arguments: { project: "test", filepath: exportPath } });
  assert("export_memories", fs.existsSync(exportPath), "file not created");

  // ═══ RESULTS ═══
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OWL MEMORY MCP v4.0 — TEST RESULTS");
  console.log("═══════════════════════════════════════════════════\n");
  results.forEach(r => console.log(r));
  const pct = Math.round((passed / total) * 100);
  const grade = pct >= 95 ? "EXCELLENT ✅" : pct >= 80 ? "GOOD ✅" : pct >= 60 ? "FAIR ⚠️" : "POOR ❌";
  console.log(`\n  Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Score: ${pct}% — ${grade}`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
  try { fs.unlinkSync(exportPath); } catch {}
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
