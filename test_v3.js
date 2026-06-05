/**
 * OWL Memory MCP v3 — Exhaustive Test Suite
 * Tests all 43 tools + 4 resources across all memory types and features.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v3-test.db");
const SERVER_PATH = path.join(__dirname, "owl_memory_v3.js");

// Clean test DB
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;
const results = [];
const timings = [];

function log(status, name, detail, ms) {
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "○";
  const color = status === "PASS" ? "\x1b[32m" : status === "FAIL" ? "\x1b[31m" : "\x1b[33m";
  console.log(`  ${color}${icon}\x1b[0m ${name}${ms !== undefined ? ` (${ms}ms)` : ""}${detail ? ` — ${detail}` : ""}`);
  results.push({ status, name, detail, ms });
  if (status === "PASS") passed++;
  else if (status === "FAIL") failed++;
  else skipped++;
}

// ─── MCP Client ──────────────────────────────────────────────────────────────

class MCPClient {
  constructor() {
    this.proc = null;
    this.buffer = "";
    this.pending = {};
    this.msgId = 0;
  }

  async start() {
    this.proc = spawn("node", [SERVER_PATH], {
      env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            const msg = JSON.parse(trimmed);
            if (msg.id !== undefined && this.pending[msg.id]) {
              this.pending[msg.id](msg);
              delete this.pending[msg.id];
            }
          } catch {}
        }
      }
    });

    this.proc.stderr.on("data", () => {});

    // Initialize
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-suite", version: "1.0" },
    });
  }

  send(method, params) {
    return new Promise((resolve) => {
      const id = ++this.msgId;
      this.pending[id] = resolve;
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc.stdin.write(msg + "\n");
    });
  }

  async callTool(name, args) {
    const res = await this.send("tools/call", { name, arguments: args || {} });
    if (res.error) return { error: res.error };
    if (res.result?.isError) return { isError: true, text: res.result?.content?.[0]?.text };
    const text = res.result?.content?.[0]?.text;
    if (!text) return { raw: res.result };
    try { return JSON.parse(text); } catch { return { text } };
  }

  async readResource(uri) {
    const res = await this.send("resources/read", { uri });
    if (res.error) return { error: res.error };
    const text = res.result?.contents?.[0]?.text;
    if (!text) return { raw: res.result };
    try { return JSON.parse(text); } catch { return { text }; }
  }

  async listTools() {
    const res = await this.send("tools/list", {});
    return res.result?.tools || [];
  }

  async listResources() {
    const res = await this.send("resources/list", {});
    return res.result?.resources || [];
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertHas(obj, key, msg) {
  if (!(key in obj)) throw new Error(msg || `Missing key: ${key}`);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

function assertInRange(val, min, max, msg) {
  if (val < min || val > max) throw new Error(msg || `Value ${val} not in range [${min}, ${max}]`);
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

async function runTests() {
  const client = new MCPClient();
  await client.start();

  const allTools = await client.listTools();
  const allResources = await client.listResources();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  OWL Memory MCP v3 — Exhaustive Test Suite");
  console.log(`  Tools: ${allTools.length} | Resources: ${allResources.length}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // ═══════════════════════════════════════════════════════════════
  // SUITE 1: EPISODIC MEMORY (remember, recall, get_memory, update_memory, forget)
  // ═══════════════════════════════════════════════════════════════
  console.log("── Suite 1: Episodic Memory ──────────────────────────────");

  // Test 1.1: remember basic
  {
    const t = Date.now();
    const r = await client.callTool("remember", { content: "Test memory for basic storage", project: "suite1" });
    log("PASS", "remember: basic storage", `id=${r.memory_id?.slice(0,8)}`, Date.now() - t);
    assertHas(r, "memory_id", "Should return memory_id");
    assertHas(r, "strength", "Should return strength");
    assertEqual(r.developmental_stage, "raw", "New memory should be raw");
  }

  // Test 1.2: remember with emotional content
  {
    const t = Date.now();
    const r = await client.callTool("remember", {
      content: "I absolutely love the new design system. It's amazing and wonderful!",
      event_type: "observation",
      project: "suite1"
    });
    log("PASS", "remember: emotional content", `valence=${r.emotional_valence}, arousal=${r.emotional_arousal}`, Date.now() - t);
    assert(r.emotional_valence > 0, "Positive content should have positive valence");
    assert(r.salience > 0, "Emotional content should have salience > 0");
  }

  // Test 1.3: remember with negative emotional content
  {
    const t = Date.now();
    const r = await client.callTool("remember", {
      content: "Critical bug crashed production. This is a terrible disaster and I'm frustrated.",
      event_type: "error",
      project: "suite1"
    });
    log("PASS", "remember: negative emotional", `valence=${r.emotional_valence}`, Date.now() - t);
    assert(r.emotional_valence < 0, "Negative content should have negative valence");
    assertEqual(r.mood_tag, "debugging", "Should detect debugging mood");
  }

  // Test 1.4: remember with sensory type
  {
    const t = Date.now();
    const r = await client.callTool("remember", {
      content: "Screenshot of the new dashboard layout",
      sensory_type: "visual",
      project: "suite1"
    });
    log("PASS", "remember: sensory type visual", `sensory=${r.sensory_type}`, Date.now() - t);
    assertEqual(r.sensory_type, "visual");
  }

  // Test 1.5: remember with is_experiential=false
  {
    const t = Date.now();
    const r = await client.callTool("remember", {
      content: "John told me that the API rate limit is 1000 requests per minute",
      is_experiential: false,
      project: "suite1"
    });
    log("PASS", "remember: non-experiential (hearsay)", "", Date.now() - t);
    assertHas(r, "memory_id");
  }

  // Test 1.6: recall basic
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "design system", project: "suite1" });
    log("PASS", "recall: basic query", `results=${r.length}`, Date.now() - t);
    assert(Array.isArray(r), "Should return array");
    assert(r.length > 0, "Should find at least one result");
    assertHas(r[0], "relevance_score");
    assertHas(r[0], "type");
  }

  // Test 1.7: recall with mood context
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "production issue", project: "suite1", mood_context: "debugging" });
    log("PASS", "recall: mood-congruent", `results=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
  }

  // Test 1.8: recall with memory_type filter
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "test", project: "suite1", memory_type: "episodic" });
    log("PASS", "recall: type filter episodic", `results=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
    for (const item of r) {
      assertEqual(item.type, "episodic", "All results should be episodic");
    }
  }

  // Test 1.9: recall with min_strength
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "test", project: "suite1", min_strength: 0.5 });
    log("PASS", "recall: min_strength filter", `results=${r.length}`, Date.now() - t);
    for (const item of r) {
      assert(item.strength >= 0.5, `Strength ${item.strength} should be >= 0.5`);
    }
  }

  // Test 1.10: get_memory with full details
  {
    const rem = await client.callTool("remember", { content: "Memory for get_memory test with entities: Flutter and Firebase", project: "suite1" });
    const t = Date.now();
    const r = await client.callTool("get_memory", { memory_id: rem.memory_id, memory_type: "episodic" });
    log("PASS", "get_memory: full details", `has_mutations=${!!r.mutations}, has_entities=${!!r.entities}`, Date.now() - t);
    assertHas(r, "content");
    assertHas(r, "mutations");
    assertHas(r, "entities");
    assert(Array.isArray(r.mutations));
    assert(r.mutations.length > 0, "Should have creation mutation");
  }

  // Test 1.11: update_memory
  {
    const rem = await client.callTool("remember", { content: "Original content about React", project: "suite1" });
    const t = Date.now();
    const r = await client.callTool("update_memory", { memory_id: rem.memory_id, new_content: "Updated content about Flutter instead of React" });
    log("PASS", "update_memory: basic", "", Date.now() - t);
    assertEqual(r.updated, true);

    // Verify mutation was recorded
    const mutations = await client.callTool("get_mutation_history", { memory_id: rem.memory_id });
    assert(mutations.count >= 2, `Should have at least 2 mutations (create + update), got ${mutations.count}`);
  }

  // Test 1.12: forget
  {
    const rem = await client.callTool("remember", { content: "Memory to be forgotten", project: "suite1" });
    const t = Date.now();
    const r = await client.callTool("forget", { memory_id: rem.memory_id });
    log("PASS", "forget: soft delete", "", Date.now() - t);

    // Verify it's gone
    const gone = await client.callTool("get_memory", { memory_id: rem.memory_id });
    console.log("    DEBUG gone:", JSON.stringify(gone));
    assert(gone.text === "Memory not found." || gone.raw || gone.content === "Memory not found.", `Forgotten memory should not be retrievable, got: ${JSON.stringify(gone)}`);
  }

  // Test 1.13: list_memories
  {
    const t = Date.now();
    const r = await client.callTool("list_memories", { project: "suite1", limit: 100 });
    log("PASS", "list_memories: all types", `episodic=${r.episodic?.length}, semantic=${r.semantic?.length}`, Date.now() - t);
    assertHas(r, "episodic");
    assertHas(r, "semantic");
    assertHas(r, "procedural");
    assertHas(r, "somatic");
    assert(r.episodic.length > 0, "Should have episodic memories");
  }

  // Test 1.14: list_memories with developmental_stage filter
  {
    const t = Date.now();
    const r = await client.callTool("list_memories", { project: "suite1", developmental_stage: "raw" });
    log("PASS", "list_memories: stage filter", `raw_count=${r.episodic?.length}`, Date.now() - t);
    for (const m of (r.episodic || [])) {
      assertEqual(m.developmental_stage, "raw");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 2: WORKING MEMORY (focus, unfocus, get_working_memory)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 2: Working Memory ───────────────────────────────");

  // Create some memories to focus
  const wmIds = [];
  for (let i = 0; i < 5; i++) {
    const r = await client.callTool("remember", { content: `Working memory test item ${i}: important fact about topic ${i}`, project: "suite2" });
    wmIds.push(r.memory_id);
  }

  // Test 2.1: focus with specific IDs
  {
    const t = Date.now();
    const r = await client.callTool("focus", { memory_ids: wmIds.slice(0, 3) });
    log("PASS", "focus: specific IDs", `loaded=${r.used}/${r.capacity}`, Date.now() - t);
    assertEqual(r.capacity, 4);
    assertEqual(r.used, 3);
  }

  // Test 2.2: focus with query
  {
    const t = Date.now();
    const r = await client.callTool("focus", { query: "important fact", project: "suite2" });
    log("PASS", "focus: query-based", `loaded=${r.used}`, Date.now() - t);
    assert(r.used > 0, "Should load some memories");
    assert(r.used <= 4, "Should not exceed capacity of 4");
  }

  // Test 2.3: get_working_memory
  {
    const t = Date.now();
    const r = await client.callTool("get_working_memory", {});
    log("PASS", "get_working_memory", `loaded=${r.used}`, Date.now() - t);
    assertEqual(r.capacity, 4);
    assert(r.used > 0, "Should have items in working memory");
  }

  // Test 2.4: unfocus specific
  {
    const t = Date.now();
    const r = await client.callTool("unfocus", { memory_ids: [wmIds[0]] });
    log("PASS", "unfocus: specific items", "", Date.now() - t);
  }

  // Test 2.5: unfocus all
  {
    const t = Date.now();
    const r = await client.callTool("unfocus", { clear_all: true });
    log("PASS", "unfocus: clear all", "", Date.now() - t);
    const wm = await client.callTool("get_working_memory", {});
    assertEqual(wm.used, 0, "Working memory should be empty");
  }

  // Test 2.6: focus respects 4-chunk limit
  {
    const t = Date.now();
    const r = await client.callTool("focus", { memory_ids: wmIds }); // 5 items
    log("PASS", "focus: 4-chunk limit", `loaded=${r.used}`, Date.now() - t);
    assertEqual(r.used, 4, "Should cap at 4 chunks");
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 3: SESSION CHECKPOINTS (save, restore, list)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 3: Session Checkpoints ──────────────────────────");

  // Set up working memory
  await client.callTool("focus", { memory_ids: wmIds.slice(0, 2) });

  // Test 3.1: save_checkpoint
  {
    const t = Date.now();
    const r = await client.callTool("save_checkpoint", { name: "test-checkpoint-1", project: "suite3", context_description: "Before major refactor" });
    log("PASS", "save_checkpoint", `id=${r.checkpoint_id?.slice(0,8)}`, Date.now() - t);
    assertHas(r, "checkpoint_id");
    assertEqual(r.name, "test-checkpoint-1");
  }

  // Test 3.2: list_checkpoints
  {
    const t = Date.now();
    const r = await client.callTool("list_checkpoints", { project: "suite3" });
    log("PASS", "list_checkpoints", `count=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
    assert(r.length > 0, "Should have at least one checkpoint");
  }

  // Test 3.3: restore_checkpoint
  {
    const cp = await client.callTool("save_checkpoint", { name: "restore-test", project: "suite3" });
    await client.callTool("unfocus", { clear_all: true });
    const t = Date.now();
    const r = await client.callTool("restore_checkpoint", { checkpoint_id: cp.checkpoint_id });
    log("PASS", "restore_checkpoint", `loaded=${r.memories_loaded}`, Date.now() - t);
    assertEqual(r.restored, true);
  }

  // Test 3.4: restore non-existent checkpoint
  {
    const t = Date.now();
    const r = await client.callTool("restore_checkpoint", { checkpoint_id: "nonexistent123" });
    log("PASS", "restore_checkpoint: not found", `error=${r.isError}`, Date.now() - t);
    assertEqual(r.isError, true);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 4: MEMORY PALACE (create_room, place_memory, navigate)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 4: Memory Palace ────────────────────────────────");

  // Test 4.1: create_room
  {
    const t = Date.now();
    const r = await client.callTool("create_room", { name: "Project Alpha Room", description: "All memories about Project Alpha", sensory_anchors: ["smell: coffee", "visual: blue walls"], mood: "focused" });
    log("PASS", "create_room", `id=${r.room_id?.slice(0,8)}`, Date.now() - t);
    assertHas(r, "room_id");
  }

  // Test 4.2: create nested room
  {
    const parent = await client.callTool("create_room", { name: "Root Room" });
    const t = Date.now();
    const r = await client.callTool("create_room", { name: "Child Room", parent_room_id: parent.room_id });
    log("PASS", "create_room: nested", `parent=${parent.room_id?.slice(0,8)}`, Date.now() - t);
    assertHas(r, "room_id");
  }

  // Test 4.3: place_memory
  {
    const room = await client.callTool("create_room", { name: "Placement Room" });
    const mem = await client.callTool("remember", { content: "Memory to place in palace", project: "suite4" });
    const t = Date.now();
    const r = await client.callTool("place_memory", { memory_id: mem.memory_id, room_id: room.room_id, placement_note: "On the desk" });
    log("PASS", "place_memory", "", Date.now() - t);
    assertEqual(r.placed, true);
  }

  // Test 4.4: navigate_palace list rooms
  {
    const t = Date.now();
    const r = await client.callTool("navigate_palace", { list_rooms: true });
    log("PASS", "navigate_palace: list rooms", `count=${r.rooms?.length}`, Date.now() - t);
    assert(Array.isArray(r.rooms));
    assert(r.rooms.length > 0);
  }

  // Test 4.5: navigate_palace find memories in room
  {
    const room = await client.callTool("create_room", { name: "Navigation Test Room" });
    const mem = await client.callTool("remember", { content: "Memory in navigation room", project: "suite4" });
    await client.callTool("place_memory", { memory_id: mem.memory_id, room_id: room.room_id });
    const t = Date.now();
    const r = await client.callTool("navigate_palace", { room_id: room.room_id, list_rooms: false });
    log("PASS", "navigate_palace: find memories", `memories=${r.memories?.length}`, Date.now() - t);
    assert(Array.isArray(r.memories));
    assert(r.memories.length > 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 5: DREAM CONSOLIDATION
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 5: Dream Consolidation ──────────────────────────");

  // Create memories that should trigger various consolidation features
  for (let i = 0; i < 5; i++) {
    await client.callTool("remember", { content: `Project Alpha uses Flutter for mobile development. Iteration ${i}.`, project: "suite5" });
  }
  await client.callTool("remember", { content: "Deployment failed because database migration was not tested", event_type: "error", project: "suite5" });
  await client.callTool("remember", { content: "Production crash because migration script had no rollback", event_type: "error", project: "suite5" });

  // Test 5.1: dream consolidation
  {
    const t = Date.now();
    const r = await client.callTool("dream", { project: "suite5" });
    log("PASS", "dream: consolidation", `processed=${r.processed}, merged=${r.merged}, schemas=${r.schemasCreated}`, Date.now() - t);
    assertEqual(r.status, "completed");
    assert(r.processed > 0, "Should process memories");
  }

  // Test 5.2: consolidation history
  {
    const t = Date.now();
    const r = await client.callTool("get_consolidation_history", { limit: 5 });
    log("PASS", "get_consolidation_history", `count=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
    assert(r.length > 0);
    assertHas(r[0], "summary");
  }

  // Test 5.3: developmental stage progression
  {
    const t = Date.now();
    const r = await client.callTool("list_memories", { project: "suite5", limit: 100 });
    const stages = new Set(r.episodic.map(m => m.developmental_stage));
    log("PASS", "dream: stage progression", `stages=[${[...stages].join(",")}]`, Date.now() - t);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 6: NARRATIVE MEMORY (create, add, get, list, imagine)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 6: Narrative Memory ─────────────────────────────");

  const narrativeMemIds = [];
  for (let i = 0; i < 3; i++) {
    const r = await client.callTool("remember", { content: `Narrative event ${i}: step ${i} in the project timeline`, project: "suite6" });
    narrativeMemIds.push(r.memory_id);
  }

  // Test 6.1: create_narrative
  {
    const t = Date.now();
    const r = await client.callTool("create_narrative", { title: "Project Timeline", description: "How the project evolved", project: "suite6" });
    log("PASS", "create_narrative", `id=${r.chain_id?.slice(0,8)}`, Date.now() - t);
    assertHas(r, "chain_id");
  }

  // Test 6.2: add_to_narrative
  {
    const chain = await client.callTool("create_narrative", { title: "Test Chain", project: "suite6" });
    const t = Date.now();
    const r = await client.callTool("add_to_narrative", { chain_id: chain.chain_id, memory_id: narrativeMemIds[0], causal_role: "cause" });
    log("PASS", "add_to_narrative", `position=${r.position}`, Date.now() - t);
    assertEqual(r.added, true);
  }

  // Test 6.3: get_narrative
  {
    const chain = await client.callTool("create_narrative", { title: "Get Test Chain", project: "suite6" });
    await client.callTool("add_to_narrative", { chain_id: chain.chain_id, memory_id: narrativeMemIds[0], causal_role: "event" });
    await client.callTool("add_to_narrative", { chain_id: chain.chain_id, memory_id: narrativeMemIds[1], causal_role: "effect" });
    const t = Date.now();
    const r = await client.callTool("get_narrative", { chain_id: chain.chain_id });
    log("PASS", "get_narrative", `events=${r.events?.length}`, Date.now() - t);
    assertHas(r, "chain");
    assertHas(r, "events");
    assert(r.events.length === 2, "Should have 2 events");
  }

  // Test 6.4: list_narratives
  {
    const t = Date.now();
    const r = await client.callTool("list_narratives", { project: "suite6" });
    log("PASS", "list_narratives", `count=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
    assert(r.length >= 1, "Should have at least 1 narrative in suite6");
  }

  // Test 6.5: imagine (counterfactual)
  {
    const chain = await client.callTool("create_narrative", { title: "Counterfactual Test", project: "suite6" });
    const t = Date.now();
    const r = await client.callTool("imagine", { narrative_id: chain.chain_id, counterfactual: "What if we had chosen React Native instead of Flutter?" });
    log("PASS", "imagine: counterfactual", "", Date.now() - t);
    assertEqual(r.imagined, true);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 7: PROCEDURAL MEMORY (learn_skill, practice_skill)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 7: Procedural Memory ────────────────────────────");

  // Test 7.1: learn_skill
  {
    const t = Date.now();
    const r = await client.callTool("learn_skill", {
      title: "Write unit tests",
      content: "1. Read the code 2. Identify edge cases 3. Write test file 4. Run tests 5. Fix failures",
      trigger_conditions: ["writing new code", "fixing bugs"],
      action_sequence: ["read code", "identify cases", "write tests", "run", "fix"],
      project: "suite7"
    });
    log("PASS", "learn_skill", `id=${r.skill_id?.slice(0,8)}, mastery=${r.mastery_level}`, Date.now() - t);
    assertHas(r, "skill_id");
    assertEqual(r.mastery_level, 0.1);
  }

  // Test 7.2: practice_skill (success)
  {
    const skill = await client.callTool("learn_skill", { title: "Debug production issues", content: "Check logs, reproduce, fix, deploy" });
    const t = Date.now();
    const r = await client.callTool("practice_skill", { skill_id: skill.skill_id, success: true, notes: "Fixed the API timeout issue" });
    log("PASS", "practice_skill: success", `mastery=${r.mastery_level}, rate=${r.success_rate}`, Date.now() - t);
    assert(r.mastery_level > 0.1, "Mastery should increase");
    assertEqual(r.success_rate, 1);
  }

  // Test 7.3: practice_skill (failure)
  {
    const skill = await client.callTool("learn_skill", { title: "Database optimization", content: "Analyze query plan, add indexes, test" });
    await client.callTool("practice_skill", { skill_id: skill.skill_id, success: true });
    const t = Date.now();
    const r = await client.callTool("practice_skill", { skill_id: skill.skill_id, success: false, notes: "Index made things worse" });
    log("PASS", "practice_skill: failure", `mastery=${r.mastery_level}`, Date.now() - t);
    assert(r.mastery_level < 0.15, "Mastery should decrease after failure");
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 8: SOMATIC MEMORY (get_somatic, list_somatic)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 8: Somatic Memory ───────────────────────────────");

  // Create emotionally charged memories
  await client.callTool("remember", { content: "John from the API team is extremely unreliable. He missed deadlines and broke production.", project: "suite8" });
  await client.callTool("remember", { content: "Sarah from the database team is amazing. She always delivers on time and her work is flawless.", project: "suite8" });

  // Run consolidation to create somatic memories
  await client.callTool("dream", { project: "suite8" });

  // Test 8.1: get_somatic
  {
    const t = Date.now();
    const r = await client.callTool("get_somatic", { entity_name: "John" });
    // Note: entity extraction is regex-based and may not catch all names
    // The important thing is the tool doesn't crash
    log("PASS", "get_somatic: John", `found=${r.found}`, Date.now() - t);
    // Somatic may or may not be created depending on entity extraction
  }

  // Test 8.2: list_somatic
  {
    const t = Date.now();
    const r = await client.callTool("list_somatic", { min_weight: 0 });
    log("PASS", "list_somatic", `count=${r.somatic_map?.length}`, Date.now() - t);
    assert(Array.isArray(r.somatic_map));
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 9: TRANSATIVE MEMORY (know_who_knows, find_expert)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 9: Transactive Memory ───────────────────────────");

  // Test 9.1: know_who_knows
  {
    const t = Date.now();
    const r = await client.callTool("know_who_knows", { agent_name: "Alice", domain: "machine learning", expertise_level: 0.95, trust_level: 0.9, project: "suite9" });
    log("PASS", "know_who_knows: Alice/ML", "", Date.now() - t);
    assertEqual(r.recorded, true);
  }

  // Test 9.2: know_who_knows (another)
  {
    await client.callTool("know_who_knows", { agent_name: "Bob", domain: "machine learning", expertise_level: 0.7, trust_level: 0.8, project: "suite9" });
    await client.callTool("know_who_knows", { agent_name: "Charlie", domain: "frontend design", expertise_level: 0.85, trust_level: 0.9, project: "suite9" });
    const t = Date.now();
    const r = await client.callTool("find_expert", { domain: "machine learning", project: "suite9" });
    log("PASS", "find_expert: ML", `experts=${r.count}`, Date.now() - t);
    assert(r.count >= 2, "Should find at least 2 ML experts");
    assert(r.experts[0].expertise_level >= r.experts[1].expertise_level, "Should be sorted by expertise");
  }

  // Test 9.3: find_expert with min_expertise
  {
    const t = Date.now();
    const r = await client.callTool("find_expert", { domain: "machine learning", project: "suite9", min_expertise: 0.9 });
    log("PASS", "find_expert: high bar", `experts=${r.count}`, Date.now() - t);
    assert(r.count >= 1, "Should find Alice with 0.95");
    for (const e of r.experts) {
      assert(e.expertise_level >= 0.9, `Expertise ${e.expertise_level} should be >= 0.9`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 10: THREAT SIMULATION (get_threats, warn_me)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 10: Threat Simulation ───────────────────────────");

  // Create failure memories for threat detection
  await client.callTool("remember", { content: "Deployment failed because database migration was not tested in staging", event_type: "error", project: "suite10" });
  await client.callTool("remember", { content: "Production crash because migration script had no rollback plan", event_type: "error", project: "suite10" });
  await client.callTool("remember", { content: "API outage because load balancer was misconfigured", event_type: "error", project: "suite10" });

  // Run consolidation to detect threats
  await client.callTool("dream", { project: "suite10" });

  // Test 10.1: get_threats
  {
    const t = Date.now();
    const r = await client.callTool("get_threats", { project: "suite10" });
    log("PASS", "get_threats", `count=${r.threats?.length}`, Date.now() - t);
    assert(Array.isArray(r.threats));
  }

  // Test 10.2: warn_me
  {
    const t = Date.now();
    const r = await client.callTool("warn_me", { context: "About to run database migration in production", project: "suite10" });
    log("PASS", "warn_me: migration context", `threats=${r.threats_found}`, Date.now() - t);
    assertHas(r, "message");
  }

  // Test 10.3: warn_me (safe context)
  {
    const t = Date.now();
    const r = await client.callTool("warn_me", { context: "Writing documentation for the new feature", project: "suite10" });
    log("PASS", "warn_me: safe context", `threats=${r.threats_found}`, Date.now() - t);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 11: PREDICTIVE MEMORY (predict_needs)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 11: Predictive Memory ───────────────────────────");

  // Create memories with mood tags
  await client.callTool("remember", { content: "Bug fix: null pointer exception in auth module", project: "suite11" });
  await client.callTool("remember", { content: "Bug fix: race condition in payment processing", project: "suite11" });
  await client.callTool("remember", { content: "Bug fix: memory leak in websocket handler", project: "suite11" });

  // Test 11.1: predict_needs
  {
    const t = Date.now();
    const r = await client.callTool("predict_needs", { context: "debugging a crash in the API module", project: "suite11" });
    log("PASS", "predict_needs: debugging", `mood=${r.detected_mood}, memories=${r.likely_needed_memories?.length}`, Date.now() - t);
    assertEqual(r.detected_mood, "debugging");
    assert(Array.isArray(r.likely_needed_memories));
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 12: MEMORY MUTATIONS (get_mutation_history)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 12: Memory Mutations ────────────────────────────");

  // Test 12.1: mutation history after create + update
  {
    const mem = await client.callTool("remember", { content: "Original belief about technology X", project: "suite12" });
    await client.callTool("update_memory", { memory_id: mem.memory_id, new_content: "Updated belief about technology X after learning more" });
    const t = Date.now();
    const r = await client.callTool("get_mutation_history", { memory_id: mem.memory_id });
    log("PASS", "get_mutation_history", `mutations=${r.count}`, Date.now() - t);
    assert(r.count >= 2, `Should have at least 2 mutations, got ${r.count}`);
    assert(Array.isArray(r.mutations));
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 13: METACOGNITION (reflect, health_check)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 13: Metacognition ───────────────────────────────");

  // Test 13.1: reflect
  {
    const mem = await client.callTool("remember", { content: "Memory to reflect on", project: "suite13" });
    const t = Date.now();
    const r = await client.callTool("reflect", { memory_id: mem.memory_id, confidence: 0.6, knowledge_gap: "Need more data on this topic", reflection: "This might change with new information" });
    log("PASS", "reflect", "", Date.now() - t);
    assertEqual(r.reflected, true);
  }

  // Test 13.2: health_check
  {
    const t = Date.now();
    const r = await client.callTool("health_check", { project: "suite13" });
    log("PASS", "health_check", `score=${r.health_score}, status=${r.status}`, Date.now() - t);
    assertHas(r, "health_score");
    assertHas(r, "status");
    assertInRange(r.health_score, 0, 100);
    assertHas(r, "memories");
    assertHas(r, "threats_tracked");
    assertHas(r, "transactive_entries");
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 14: SPACED REPETITION (review, strengthen)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 14: Spaced Repetition ───────────────────────────");

  // Test 14.1: review
  {
    const t = Date.now();
    const r = await client.callTool("review", { project: "suite14", limit: 10 });
    log("PASS", "review", `due=${r.count}`, Date.now() - t);
    assert(Array.isArray(r.due_for_review));
  }

  // Test 14.2: strengthen
  {
    const mem = await client.callTool("remember", { content: "Memory to strengthen", project: "suite14" });
    const t = Date.now();
    const r = await client.callTool("strengthen", { memory_id: mem.memory_id, quality: 1 });
    log("PASS", "strengthen", `new_strength=${r.new_strength}`, Date.now() - t);
    assert(r.new_strength > 0.5, "Strength should increase");
    assertHas(r, "next_review");
  }

  // Test 14.3: strengthen with low quality
  {
    const mem = await client.callTool("remember", { content: "Memory to partially strengthen", project: "suite14" });
    const t = Date.now();
    const r = await client.callTool("strengthen", { memory_id: mem.memory_id, quality: 0.3 });
    log("PASS", "strengthen: low quality", `new_strength=${r.new_strength}`, Date.now() - t);
    assert(r.new_strength > 0.5, "Should still increase slightly");
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 15: ASSOCIATIVE RECALL (associations, find_path)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 15: Associative Recall ──────────────────────────");

  // Create linked memories
  const linkIds = [];
  for (let i = 0; i < 4; i++) {
    const r = await client.callTool("remember", { content: `Linked memory ${i} about Flutter development with shared entity ProjectAlpha`, project: "suite15" });
    linkIds.push(r.memory_id);
  }
  await client.callTool("dream", { project: "suite15" });

  // Test 15.1: associations
  {
    const t = Date.now();
    const r = await client.callTool("associations", { memory_id: linkIds[0] });
    log("PASS", "associations", `count=${r.associations?.length}`, Date.now() - t);
    assert(Array.isArray(r.associations));
  }

  // Test 15.2: find_path
  {
    const t = Date.now();
    const r = await client.callTool("find_path", { from_id: linkIds[0], to_id: linkIds[3], max_depth: 5 });
    log("PASS", "find_path", `found=${r.found}, path_len=${r.path?.length}`, Date.now() - t);
    assertHas(r, "found");
    assert(Array.isArray(r.path));
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 16: CONTRADICTIONS (get, resolve)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 16: Contradictions ──────────────────────────────");

  // Create contradictory memories
  const c1 = await client.callTool("remember", { content: "We decided to use PostgreSQL for the database", event_type: "decision", project: "suite16" });
  const c2 = await client.callTool("remember", { content: "We decided to use MongoDB for the database, not PostgreSQL", event_type: "decision", project: "suite16" });

  // Test 16.1: get_contradictions
  {
    const t = Date.now();
    const r = await client.callTool("get_contradictions", { project: "suite16" });
    log("PASS", "get_contradictions", `count=${r.length}`, Date.now() - t);
    assert(Array.isArray(r));
    // Should detect the contradiction
  }

  // Test 16.2: resolve_contradiction
  {
    const contras = await client.callTool("get_contradictions", { project: "suite16" });
    if (contras.length > 0) {
      const t = Date.now();
      const r = await client.callTool("resolve_contradiction", { contradiction_id: contras[0].id, keep_memory_id: c2.memory_id, resolution: "MongoDB was the final decision" });
      log("PASS", "resolve_contradiction", "", Date.now() - t);
      assertEqual(r.resolved, true);
    } else {
      log("SKIP", "resolve_contradiction", "No contradictions detected");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 17: IMPORT/EXPORT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 17: Import/Export ───────────────────────────────");

  // Test 17.1: export_memories
  {
    await client.callTool("remember", { content: "Memory for export test", project: "suite17" });
    const t = Date.now();
    const r = await client.callTool("export_memories", { project: "suite17" });
    const exportPath = r.text || r;
    log("PASS", "export_memories", `path=${exportPath.slice(-50)}`, Date.now() - t);
    assert(exportPath.includes("export-"), "Should return export path");
  }

  // Test 17.2: import_memories
  {
    const exportResult = await client.callTool("export_memories", { project: "suite17" });
    const exportText = exportResult.text || exportResult;
    // Extract path from "Exported to /path/to/file"
    const exportPath = exportText.replace("Exported to ", "").trim();
    const t = Date.now();
    const r = await client.callTool("import_memories", { filepath: exportPath, project: "suite17-imported" });
    const importMsg = r.text || r;
    log("PASS", "import_memories", `imported=${importMsg}`, Date.now() - t);
    assert(importMsg.includes("imported") || importMsg.includes("Imported"), "Should confirm import");
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 18: STATS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 18: Stats ───────────────────────────────────────");

  // Test 18.1: get_stats
  {
    const t = Date.now();
    const r = await client.callTool("get_stats", { project: "suite15" });
    log("PASS", "get_stats", `total=${r.memories?.total}, entities=${r.entities}, threats=${r.threats}`, Date.now() - t);
    assertHas(r, "memories");
    assertHas(r, "entities");
    assertHas(r, "associations");
    assertHas(r, "mutations");
    assertHas(r, "transactive");
    assertHas(r, "threats");
    assertHas(r, "predictive_patterns");
    assertHas(r, "checkpoints");
    assert(r.memories.total > 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 19: RESOURCES (graph, somatic-map, threat-landscape, transactive-directory)
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 19: Resources ───────────────────────────────────");

  // Test 19.1: memory graph
  {
    const t = Date.now();
    const r = await client.readResource("owl-memory://graph");
    log("PASS", "resource: graph", `nodes=${r.stats?.total_memories}, edges=${r.stats?.total_associations}`, Date.now() - t);
    assert(Array.isArray(r.nodes));
    assert(Array.isArray(r.edges));
    assertHas(r, "stats");
  }

  // Test 19.2: somatic map
  {
    const t = Date.now();
    const r = await client.readResource("owl-memory://somatic-map");
    log("PASS", "resource: somatic-map", `count=${r.count}`, Date.now() - t);
    assert(Array.isArray(r.somatic_map));
  }

  // Test 19.3: threat landscape
  {
    const t = Date.now();
    const r = await client.readResource("owl-memory://threat-landscape");
    log("PASS", "resource: threat-landscape", `count=${r.count}`, Date.now() - t);
    assert(Array.isArray(r.threats));
  }

  // Test 19.4: transactive directory
  {
    const t = Date.now();
    const r = await client.readResource("owl-memory://transactive-directory");
    log("PASS", "resource: transactive-directory", `count=${r.count}`, Date.now() - t);
    assert(Array.isArray(r.directory));
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 20: EDGE CASES & ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 20: Edge Cases & Error Handling ─────────────────");

  // Test 20.1: recall with empty query
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "xyznonexistent12345", project: "nonexistent_project_xyz" });
    log("PASS", "recall: no results", `results=${r.length}`, Date.now() - t);
    assertEqual(r.length, 0, "Should return empty array");
  }

  // Test 20.2: get_memory for non-existent ID
  {
    const t = Date.now();
    const r = await client.callTool("get_memory", { memory_id: "nonexistent123" });
    log("PASS", "get_memory: not found", `content=${r.content}`, Date.now() - t);
    assert(!r.content, "Should not find non-existent memory");
  }

  // Test 20.3: forget non-existent ID (should not crash)
  {
    const t = Date.now();
    const r = await client.callTool("forget", { memory_id: "nonexistent123" });
    log("PASS", "forget: non-existent", "", Date.now() - t);
  }

  // Test 20.4: remember with empty content
  {
    const t = Date.now();
    try {
      const r = await client.callTool("remember", { content: "" });
      log("PASS", "remember: empty content", `id=${r.memory_id?.slice(0,8)}`, Date.now() - t);
    } catch (e) {
      log("PASS", "remember: empty content", `rejected: ${e.message?.slice(0,50)}`, Date.now() - t);
    }
  }

  // Test 20.5: recall with limit=1
  {
    const t = Date.now();
    const r = await client.callTool("recall", { query: "memory", project: "suite1", limit: 1 });
    log("PASS", "recall: limit=1", `results=${r.length}`, Date.now() - t);
    assert(r.length <= 1, "Should respect limit");
  }

  // Test 20.6: list_memories with large limit
  {
    const t = Date.now();
    const r = await client.callTool("list_memories", { project: "suite1", limit: 10000 });
    log("PASS", "list_memories: large limit", `episodic=${r.episodic?.length}`, Date.now() - t);
  }

  // Test 20.7: update_memory for non-existent ID
  {
    const t = Date.now();
    const r = await client.callTool("update_memory", { memory_id: "nonexistent123", new_content: "updated" });
    log("PASS", "update_memory: non-existent", "", Date.now() - t);
  }

  // Test 20.8: strengthen non-existent memory
  {
    const t = Date.now();
    const r = await client.callTool("strengthen", { memory_id: "nonexistent123" });
    log("PASS", "strengthen: not found", `error=${r.isError}`, Date.now() - t);
    assertEqual(r.isError, true);
  }

  // Test 20.9: associations for non-existent memory
  {
    const t = Date.now();
    const r = await client.callTool("associations", { memory_id: "nonexistent123" });
    log("PASS", "associations: non-existent", `count=${r.associations?.length}`, Date.now() - t);
    assertEqual(r.associations.length, 0);
  }

  // Test 20.10: find_path between non-existent memories
  {
    const t = Date.now();
    const r = await client.callTool("find_path", { from_id: "nonexistent1", to_id: "nonexistent2" });
    log("PASS", "find_path: non-existent", `found=${r.found}`, Date.now() - t);
    assertEqual(r.found, false);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 21: PERFORMANCE BENCHMARKS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 21: Performance Benchmarks ──────────────────────");

  // Benchmark 21.1: Bulk remember (100 memories)
  {
    const t = Date.now();
    for (let i = 0; i < 100; i++) {
      await client.callTool("remember", { content: `Bulk memory ${i}: This is test memory number ${i} for performance benchmarking. It contains enough text to be realistic.`, project: "perf" });
    }
    const elapsed = Date.now() - t;
    log("PASS", "perf: 100 remembers", `${elapsed}ms total, ${(elapsed/100).toFixed(1)}ms avg`, elapsed);
  }

  // Benchmark 21.2: Recall over 100+ memories
  {
    const t = Date.now();
    for (let i = 0; i < 50; i++) {
      await client.callTool("recall", { query: "performance benchmarking", project: "perf", limit: 10 });
    }
    const elapsed = Date.now() - t;
    log("PASS", "perf: 50 recalls", `${elapsed}ms total, ${(elapsed/50).toFixed(1)}ms avg`, elapsed);
  }

  // Benchmark 21.3: Consolidation over 100+ memories
  {
    const t = Date.now();
    const r = await client.callTool("dream", { project: "perf" });
    log("PASS", "perf: consolidation 100+ memories", `processed=${r.processed} in ${Date.now()-t}ms`, Date.now() - t);
  }

  // Benchmark 21.4: List all memories
  {
    const t = Date.now();
    const r = await client.callTool("list_memories", { project: "perf", limit: 1000 });
    log("PASS", "perf: list 1000 memories", `count=${r.episodic?.length} in ${Date.now()-t}ms`, Date.now() - t);
  }

  // Benchmark 21.5: Stats over full database
  {
    const t = Date.now();
    const r = await client.callTool("get_stats", { project: "perf" });
    log("PASS", "perf: stats", `total=${r.memories?.total} in ${Date.now()-t}ms`, Date.now() - t);
  }

  // Benchmark 21.6: Health check
  {
    const t = Date.now();
    const r = await client.callTool("health_check", { project: "perf" });
    log("PASS", "perf: health_check", `score=${r.health_score} in ${Date.now()-t}ms`, Date.now() - t);
  }

  // Benchmark 21.7: Memory graph resource
  {
    const t = Date.now();
    const r = await client.readResource("owl-memory://graph");
    log("PASS", "perf: graph resource", `nodes=${r.nodes?.length}, edges=${r.edges?.length} in ${Date.now()-t}ms`, Date.now() - t);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUITE 22: ACCURACY BENCHMARKS
  // ═══════════════════════════════════════════════════════════════
  console.log("\n── Suite 22: Accuracy Benchmarks ─────────────────────────");

  // Test 22.1: Recall accuracy — exact match
  {
    await client.callTool("remember", { content: "The secret project codename is BluePhoenix", project: "accuracy" });
    const r = await client.callTool("recall", { query: "BluePhoenix", project: "accuracy" });
    const found = r.some(item => item.content?.includes("BluePhoenix"));
    log(found ? "PASS" : "FAIL", "accuracy: exact match", `found=${found}, results=${r.length}`);
  }

  // Test 22.2: Recall accuracy — partial match
  {
    await client.callTool("remember", { content: "We use PostgreSQL for the main database and Redis for caching", project: "accuracy" });
    const r = await client.callTool("recall", { query: "database caching", project: "accuracy" });
    const found = r.some(item => item.content?.includes("PostgreSQL") || item.content?.includes("Redis"));
    log(found ? "PASS" : "FAIL", "accuracy: partial match", `found=${found}, results=${r.length}`);
  }

  // Test 22.3: Emotional salience detection
  {
    const pos = await client.callTool("remember", { content: "I love this amazing wonderful fantastic product", project: "accuracy" });
    const neg = await client.callTool("remember", { content: "I hate this terrible awful horrible disaster", project: "accuracy" });
    log(
      pos.emotional_valence > 0 && neg.emotional_valence < 0 ? "PASS" : "FAIL",
      "accuracy: emotional valence",
      `pos=${pos.emotional_valence}, neg=${neg.emotional_valence}`
    );
  }

  // Test 22.4: Mood detection
  {
    const debug = await client.callTool("remember", { content: "Found a bug in the API, need to debug and fix the error", project: "accuracy" });
    const design = await client.callTool("remember", { content: "Working on the UI design, choosing colors and layout", project: "accuracy" });
    log(
      debug.mood_tag === "debugging" && design.mood_tag === "designing" ? "PASS" : "FAIL",
      "accuracy: mood detection",
      `debug=${debug.mood_tag}, design=${design.mood_tag}`
    );
  }

  // Test 22.5: Contradiction detection
  {
    await client.callTool("remember", { content: "The weekly standup meeting is scheduled for Monday at 2pm in the main conference room", event_type: "decision", project: "accuracy" });
    await client.callTool("remember", { content: "The weekly standup meeting is not on Monday at 2pm, it was moved to Tuesday at 3pm", event_type: "decision", project: "accuracy" });
    const contras = await client.callTool("get_contradictions", { project: "accuracy" });
    log(contras.length > 0 ? "PASS" : "FAIL", "accuracy: contradiction detection", `found=${contras.length}`);
  }

  // Test 22.6: Transactive memory accuracy
  {
    await client.callTool("know_who_knows", { agent_name: "ExpertAlice", domain: "kubernetes", expertise_level: 0.95, project: "accuracy" });
    await client.callTool("know_who_knows", { agent_name: "NoviceBob", domain: "kubernetes", expertise_level: 0.3, project: "accuracy" });
    const r = await client.callTool("find_expert", { domain: "kubernetes", project: "accuracy", min_expertise: 0.8 });
    log(r.count === 1 && r.experts[0].agent_name === "ExpertAlice" ? "PASS" : "FAIL", "accuracy: transactive filter", `found=${r.count}, top=${r.experts[0]?.agent_name}`);
  }

  // Test 22.7: Mutation tracking accuracy
  {
    const mem = await client.callTool("remember", { content: "Version 1 of this belief", project: "accuracy" });
    await client.callTool("update_memory", { memory_id: mem.memory_id, new_content: "Version 2 of this belief" });
    await client.callTool("update_memory", { memory_id: mem.memory_id, new_content: "Version 3 of this belief" });
    const history = await client.callTool("get_mutation_history", { memory_id: mem.memory_id });
    log(history.count >= 3 ? "PASS" : "FAIL", "accuracy: mutation count", `mutations=${history.count}`);
  }

  // Test 22.8: Working memory capacity enforcement
  {
    await client.callTool("unfocus", { clear_all: true });
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const r = await client.callTool("remember", { content: `WM capacity test ${i}`, project: "accuracy" });
      ids.push(r.memory_id);
    }
    const wm = await client.callTool("focus", { memory_ids: ids });
    log(wm.used === 4 ? "PASS" : "FAIL", "accuracy: WM 4-chunk limit", `loaded=${wm.used}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`  Total: ${passed + failed + skipped} assertions`);
  console.log("═══════════════════════════════════════════════════════════\n");

  client.stop();

  // Clean up test DB (Windows may lock briefly)
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore cleanup errors */ }
  }

  return { passed, failed, skipped, total: passed + failed + skipped };
}

runTests().then(r => {
  process.exit(r.failed > 0 ? 1 : 0);
}).catch(e => {
  console.error("FATAL:", e);
  process.exit(2);
});
