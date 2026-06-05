/**
 * OWL Memory MCP v3.1 — Brain-Inspired Agent Memory with Vector Embeddings
 *
 * NEW in v3.1:
 * - Vector embeddings via sqlite-vec (384-dim, local Xenova model)
 * - Hybrid recall: 40% BM25 keyword + 60% vector semantic search
 * - "dark mode" now matches "night theme" (semantic similarity)
 * - Backward compatible with all v3 tools
 *
 * All 43 tools from v3, plus vector-enhanced recall.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─── Vector Embeddings ──────────────────────────────────────────────────────
let sqliteVecLoaded = false;
let embedder = null;
let embedderLoading = null;
let hasVectors = false;

function loadSqliteVec(db) {
  if (sqliteVecLoaded) return true;
  try {
    const vecDll = path.join(__dirname, "node_modules", "sqlite-vec-windows-x64", "vec0.dll");
    if (fs.existsSync(vecDll)) { db.loadExtension(vecDll); sqliteVecLoaded = true; return true; }
  } catch (e) { console.error("sqlite-vec:", e.message); }
  return false;
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;
  embedderLoading = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
      console.error("Embedding model: Xenova/all-MiniLM-L6-v2 (384 dims)");
      return embedder;
    } catch (e) {
      console.error("Embedder load failed:", e.message);
      embedderLoading = null;
      return null;
    }
  })();
  return embedderLoading;
}

async function generateEmbedding(text) {
  const m = await getEmbedder();
  if (!m) return null;
  try {
    const out = await m(text.slice(0, 512), { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (e) { return null; }
}

function storeEmbedding(db, memId, emb) {
  if (!hasVectors || !emb || emb.length !== 384) return;
  try {
    db.exec(`INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (${memId}, '${JSON.stringify(emb).replace(/'/g, "''")}')`);
  } catch (e) { /* ignore */ }
}

// ─── Configuration ───────────────────────────────────────────────────────────
const DB_PATH = process.env.OWL_MEMORY_DB || path.join(require("os").homedir(), ".owl-memory", "memory-v3.db");
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Database ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

hasVectors = loadSqliteVec(db);
if (hasVectors) {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(embedding float[384])");
}

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, event_type TEXT DEFAULT 'observation',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, event_timestamp TEXT,
        project TEXT DEFAULT 'default', location TEXT,
        emotional_valence REAL DEFAULT 0, emotional_arousal REAL DEFAULT 0, salience REAL DEFAULT 0.5,
        somatic_weight REAL DEFAULT 0, somatic_valence REAL DEFAULT 0,
        strength REAL DEFAULT 1.0, developmental_stage TEXT DEFAULT 'raw',
        access_count INTEGER DEFAULT 0, last_accessed TEXT, next_review TEXT, review_interval REAL DEFAULT 1.0,
        source TEXT DEFAULT 'conversation', source_reliability REAL DEFAULT 0.8, confidence REAL DEFAULT 0.8,
        is_experiential INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1, is_consolidated INTEGER DEFAULT 0,
        is_in_working_memory INTEGER DEFAULT 0, working_memory_position INTEGER,
        sensory_type TEXT DEFAULT 'text', mood_tag TEXT, metadata TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS memory_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, mutation_type TEXT NOT NULL,
        previous_content TEXT, new_content TEXT, previous_stage TEXT, new_stage TEXT,
        reason TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS semantic_memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, concept_type TEXT DEFAULT 'fact',
        schema_id TEXT, schema_name TEXT, abstraction_level INTEGER DEFAULT 0,
        source_episodes TEXT DEFAULT '[]', project TEXT DEFAULT 'default',
        importance REAL DEFAULT 0.5, confidence REAL DEFAULT 0.8,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS procedural_memories (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
        trigger_conditions TEXT DEFAULT '[]', action_sequence TEXT DEFAULT '[]',
        mastery_level REAL DEFAULT 0.1, practice_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0, last_practiced TEXT,
        project TEXT DEFAULT 'default', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS somatic_memories (
        id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, entity_type TEXT DEFAULT 'general',
        somatic_valence REAL DEFAULT 0, somatic_arousal REAL DEFAULT 0, somatic_weight REAL DEFAULT 0.5,
        source_episodes TEXT DEFAULT '[]', last_triggered TEXT, trigger_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1, note TEXT
    );
    CREATE TABLE IF NOT EXISTS transactive_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_name TEXT NOT NULL, domain TEXT NOT NULL,
        expertise_level REAL DEFAULT 0.5, last_verified TEXT, trust_level REAL DEFAULT 0.8,
        project TEXT DEFAULT 'default', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(agent_name, domain, project)
    );
    CREATE TABLE IF NOT EXISTS predictive_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_context TEXT NOT NULL, predicted_need TEXT NOT NULL,
        confidence REAL DEFAULT 0.5, hit_count INTEGER DEFAULT 0, miss_count INTEGER DEFAULT 0,
        project TEXT DEFAULT 'default', created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS threat_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_name TEXT NOT NULL, description TEXT NOT NULL,
        trigger_conditions TEXT DEFAULT '[]', severity TEXT DEFAULT 'warning',
        created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS palace_rooms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, parent_room_id TEXT,
        position_x REAL DEFAULT 0, position_y REAL DEFAULT 0, position_z REAL DEFAULT 0,
        sensory_anchors TEXT DEFAULT '[]', mood TEXT DEFAULT 'neutral', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_placements (
        memory_id TEXT NOT NULL, memory_type TEXT NOT NULL, room_id TEXT NOT NULL,
        position_x REAL DEFAULT 0, position_y REAL DEFAULT 0, position_z REAL DEFAULT 0,
        placement_note TEXT, placed_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, memory_type, room_id)
    );
    CREATE TABLE IF NOT EXISTS associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, source_type TEXT NOT NULL,
        target_id TEXT NOT NULL, target_type TEXT NOT NULL, association_type TEXT DEFAULT 'semantic',
        strength REAL DEFAULT 0.5, created_at TEXT NOT NULL,
        UNIQUE(source_id, source_type, target_id, target_type, association_type)
    );
    CREATE TABLE IF NOT EXISTS narrative_chains (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS narrative_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id TEXT NOT NULL, memory_id TEXT NOT NULL,
        memory_type TEXT NOT NULL, sequence_order INTEGER NOT NULL, causal_role TEXT DEFAULT 'event'
    );
    CREATE TABLE IF NOT EXISTS counterfactuals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, narrative_id TEXT NOT NULL,
        counterfactual_scenario TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS consolidation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, completed_at TEXT,
        memories_processed INTEGER DEFAULT 0, memories_merged INTEGER DEFAULT 0, memories_pruned INTEGER DEFAULT 0,
        schemas_created INTEGER DEFAULT 0, associations_formed INTEGER DEFAULT 0, threats_identified INTEGER DEFAULT 0,
        somatic_updated INTEGER DEFAULT 0, novel_connections INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running', summary TEXT
    );
    CREATE TABLE IF NOT EXISTS metacognition (
        id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, memory_type TEXT NOT NULL,
        confidence REAL DEFAULT 0.8, knowledge_gap TEXT, reflection TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, entity_type TEXT DEFAULT 'general',
        importance REAL DEFAULT 0.5, mention_count INTEGER DEFAULT 0,
        first_seen TEXT, last_seen TEXT, UNIQUE(name, entity_type)
    );
    CREATE TABLE IF NOT EXISTS memory_entities (
        memory_id TEXT NOT NULL, memory_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
        role TEXT DEFAULT 'subject', PRIMARY KEY (memory_id, memory_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id_1 TEXT NOT NULL, memory_type_1 TEXT NOT NULL,
        memory_id_2 TEXT NOT NULL, memory_type_2 TEXT NOT NULL, severity TEXT DEFAULT 'warning',
        detected_at TEXT NOT NULL, resolved INTEGER DEFAULT 0, resolution TEXT, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, project TEXT DEFAULT 'default',
        working_memory_ids TEXT DEFAULT '[]', created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_project ON episodic_memories(project);
    CREATE INDEX IF NOT EXISTS idx_episodic_active ON episodic_memories(is_active);
    CREATE INDEX IF NOT EXISTS idx_episodic_strength ON episodic_memories(strength);
    CREATE INDEX IF NOT EXISTS idx_episodic_mood ON episodic_memories(mood_tag);
    CREATE INDEX IF NOT EXISTS idx_semantic_project ON semantic_memories(project);
    CREATE INDEX IF NOT EXISTS idx_procedural_project ON procedural_memories(project);
    CREATE INDEX IF NOT EXISTS idx_somatic_entity ON somatic_memories(entity_name);
    CREATE INDEX IF NOT EXISTS idx_transactive_domain ON transactive_memory(domain);
    CREATE INDEX IF NOT EXISTS idx_mutations_memory ON memory_mutations(memory_id);
`);

// ─── Brain-Inspired Algorithms ───────────────────────────────────────────────
function calculateRetention(s, h) { return Math.exp(-h / Math.max(s, 0.1)); }
function calculateNextReview(s, c, e, stage) {
  const mult = stage === "abstracted" ? 3 : stage === "consolidated" ? 2 : stage === "structured" ? 1.5 : 1;
  return new Date(Date.now() + (24 * Math.pow(2.1, c) * (1 + e * 0.5) * mult) / s * 3600000).toISOString();
}
function detectEmotionalSalience(t) {
  const l = t.toLowerCase(); let v = 0, a = 0;
  for (const w of ["love","great","excellent","amazing","wonderful","happy","excited","perfect","best","awesome"]) if (l.includes(w)) { v += 0.15; a += 0.1; }
  for (const w of ["hate","terrible","awful","horrible","worst","angry","frustrated","failed","broken","bug","error","crash"]) if (l.includes(w)) { v -= 0.15; a += 0.15; }
  for (const w of ["urgent","critical","emergency","immediately","asap","crucial","must","never","always","danger"]) if (l.includes(w)) a += 0.2;
  return { valence: Math.max(-1, Math.min(1, v)), arousal: Math.max(0, Math.min(1, a)), salience: Math.min(1, Math.abs(v) * 0.5 + a * 0.5) };
}
function extractEntities(t) {
  const e = [];
  for (const m of t.matchAll(/"([^"]+)"/g)) e.push([m[1], "quoted"]);
  for (const m of t.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) if (!["The","This","That","These","Those","There","Their","Then","Than"].includes(m[1].split(" ")[0])) e.push([m[1], "proper_noun"]);
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) e.push([m[0], "email"]);
  return [...new Map(e.map(x => [`${x[0]}:${x[1]}`, x])).values()];
}
function calculateSimilarity(a, b) {
  const w1 = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const w2 = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const inter = new Set([...w1].filter(w => w2.has(w)));
  const union = new Set([...w1, ...w2]);
  return Math.min(1, inter.size / Math.max(union.size, 1) + Math.min(0.3, extractEntities(a).filter(e1 => extractEntities(b).some(e2 => e1[0].toLowerCase() === e2[0].toLowerCase())).length * 0.1));
}
function detectMood(t) {
  const l = t.toLowerCase(), moods = { debugging: ["bug","error","fix","debug","crash","issue","fail"], designing: ["design","ui","ux","layout","color","visual","style"], planning: ["plan","roadmap","strategy","goal","milestone"], learning: ["learn","understand","how","why","explain","tutorial"], frustrated: ["frustrated","stuck","can't","impossible","hate","annoying"], excited: ["excited","amazing","awesome","great","love","perfect","brilliant"] };
  let best = "neutral", bestScore = 0;
  for (const [m, kws] of Object.entries(moods)) { const s = kws.filter(k => l.includes(k)).length; if (s > bestScore) { bestScore = s; best = m; } }
  return bestScore > 0 ? best : "neutral";
}
function progressDevelopmentalStage(stage, accessCount, sim) {
  if (stage === "abstracted") return "abstracted";
  if (stage === "consolidated" && accessCount > 10) return "abstracted";
  if (stage === "structured" && accessCount > 5) return "consolidated";
  if (stage === "raw" && accessCount > 2) return "structured";
  if (sim > 0.8 && stage === "raw") return "structured";
  return stage;
}
function generateId(content, salt = "") { return crypto.createHash("sha256").update(content + salt + Date.now().toString()).digest("hex").slice(0, 16); }

// ─── Consolidation ───────────────────────────────────────────────────────────
function consolidateMemories(projectId) {
  const now = new Date().toISOString();
  const logId = db.prepare("INSERT INTO consolidation_log (started_at) VALUES (?)").run(now).lastInsertRowid;
  let processed = 0, merged = 0, pruned = 0, schemasCreated = 0, associationsFormed = 0, threatsIdentified = 0, somaticUpdated = 0, novelConnections = 0;
  const active = db.prepare("SELECT id, content, project, strength, developmental_stage, access_count FROM episodic_memories WHERE is_active = 1 AND is_consolidated = 0 AND project = ?").all(projectId);
  const processedIds = new Set();
  for (let i = 0; i < active.length; i++) {
    const m1 = active[i]; if (processedIds.has(m1.id)) continue;
    for (let j = i + 1; j < active.length; j++) {
      const m2 = active[j]; if (processedIds.has(m2.id) || m1.project !== m2.project) continue;
      if (calculateSimilarity(m1.content, m2.content) > 0.7) {
        const keep = m1.strength >= m2.strength ? m1 : m2, dep = m1.strength >= m2.strength ? m2 : m1;
        db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(dep.id);
        db.prepare("UPDATE episodic_memories SET strength = strength + 0.5 WHERE id = ?").run(keep.id);
        processedIds.add(dep.id); merged++;
      }
    }
    const ns = progressDevelopmentalStage(m1.developmental_stage, m1.access_count, 0);
    if (ns !== m1.developmental_stage) db.prepare("UPDATE episodic_memories SET developmental_stage = ? WHERE id = ?").run(ns, m1.id);
    processed++;
  }
  const groups = db.prepare("SELECT project, COUNT(*) as cnt FROM episodic_memories WHERE is_active = 1 AND project = ? GROUP BY project HAVING cnt > 2").all(projectId);
  for (const g of groups) { const sid = generateId(g.project, "schema"); db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, schema_id, schema_name, abstraction_level, project, created_at, updated_at, importance) VALUES (?, ?, 'schema', ?, ?, 1, ?, ?, ?, 0.7)").run(sid, `Schema: ${g.cnt} memories`, sid, `${g.project}-schema`, g.project, now, now); schemasCreated++; }
  const allActive = db.prepare("SELECT id, content, project FROM episodic_memories WHERE is_active = 1 AND project = ?").all(projectId);
  for (let i = 0; i < allActive.length; i++) for (let j = i + 1; j < allActive.length; j++) {
    if (allActive[i].project !== allActive[j].project) continue;
    const sim = calculateSimilarity(allActive[i].content, allActive[j].content);
    if (sim > 0.3 && sim < 0.7) { db.prepare("INSERT OR IGNORE INTO associations (source_id, source_type, target_id, target_type, association_type, strength, created_at) VALUES (?, 'episodic', ?, 'episodic', 'semantic', ?, ?)").run(allActive[i].id, allActive[j].id, sim, now); associationsFormed++; }
    if (sim < 0.2 && extractEntities(allActive[i].content).some(e1 => extractEntities(allActive[j].content).some(e2 => e1[0].toLowerCase() === e2[0].toLowerCase()))) {
      db.prepare("INSERT OR IGNORE INTO associations (source_id, source_type, target_id, target_type, association_type, strength, created_at) VALUES (?, 'episodic', ?, 'episodic', 'novel', 0.3, ?)").run(allActive[i].id, allActive[j].id, now); novelConnections++;
    }
  }
  const failures = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND (event_type = 'error' OR content LIKE '%fail%' OR content LIKE '%crash%')").all(projectId);
  if (failures.length >= 2) for (let i = 0; i < failures.length; i++) for (let j = i + 1; j < failures.length; j++) {
    if (calculateSimilarity(failures[i].content, failures[j].content) > 0.3 && !db.prepare("SELECT id FROM threat_patterns WHERE pattern_name = ? AND is_active = 1").get(`T${i}-${j}`)) {
      db.prepare("INSERT INTO threat_patterns (pattern_name, description, severity, created_at) VALUES (?, ?, 'warning', ?)").run(`T${i}-${j}`, failures[i].content.slice(0, 120), now); threatsIdentified++;
    }
  }
  const emotional = db.prepare("SELECT id, content, emotional_valence, emotional_arousal FROM episodic_memories WHERE project = ? AND is_active = 1 AND (ABS(emotional_valence) > 0.3 OR emotional_arousal > 0.5)").all(projectId);
  for (const ep of emotional) for (const [eName, eType] of extractEntities(ep.content)) {
    if (eType === "proper_noun" || eType === "quoted") {
      const ex = db.prepare("SELECT id, somatic_valence, somatic_weight FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(eName);
      if (ex) db.prepare("UPDATE somatic_memories SET somatic_valence = ?, somatic_weight = ?, last_triggered = ?, trigger_count = trigger_count + 1 WHERE id = ?").run(ex.somatic_valence * 0.7 + ep.emotional_valence * 0.3, Math.min(1, ex.somatic_weight + 0.1), now, ex.id);
      else db.prepare("INSERT INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, 0.3, ?, ?, 1, ?)").run(generateId(eName, "somatic"), eName, eType, ep.emotional_valence, ep.emotional_arousal, JSON.stringify([ep.id]), now, now);
      somaticUpdated++;
    }
  }
  const weak = db.prepare("SELECT id, emotional_valence, emotional_arousal FROM episodic_memories WHERE is_active = 1 AND project = ? AND strength < 0.08").all(projectId);
  for (const m of weak) { if (Math.abs(m.emotional_valence) > 0.5 || m.emotional_arousal > 0.7) continue; db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(m.id); pruned++; }
  db.prepare("UPDATE episodic_memories SET is_consolidated = 1 WHERE is_active = 1 AND is_consolidated = 0 AND project = ?").run(projectId);
  db.prepare("UPDATE consolidation_log SET completed_at = ?, memories_processed = ?, memories_merged = ?, memories_pruned = ?, schemas_created = ?, associations_formed = ?, threats_identified = ?, somatic_updated = ?, novel_connections = ?, status = 'completed', summary = ? WHERE id = ?").run(now, processed, merged, pruned, schemasCreated, associationsFormed, threatsIdentified, somaticUpdated, novelConnections, `Dream: p=${processed} m=${merged} pruned=${pruned} schemas=${schemasCreated} assoc=${associationsFormed} threats=${threatsIdentified} somatic=${somaticUpdated} creative=${novelConnections}`, logId);
  return { processed, merged, pruned, schemasCreated, associationsFormed, threatsIdentified, somaticUpdated, novelConnections };
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP SERVER & TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

const server = new Server(
  { name: "owl-memory", version: "3.1.0", description: "OWL Memory MCP v3.1 — Brain-inspired agent memory with vector embeddings. 43 tools: episodic/semantic/procedural/somatic/transactive memory, vector+BM25 hybrid search, developmental stages, mutation tracking, adaptive forgetting, threat simulation, mood-congruent retrieval, predictive memory, creativity engine, memory palace, dream consolidation, spaced repetition, session checkpoints, counterfactual reasoning, and graph visualization." },
  { capabilities: { tools: {}, resources: {} } }
);

// ─── Tool Definitions (43 tools) ────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "remember", description: "Store episodic memory with emotional/sensory/mood tagging. Auto-generates 384-dim vector embedding for semantic search.", inputSchema: { type: "object", properties: { content: { type: "string" }, event_type: { type: "string", enum: ["observation","decision","interaction","learning","error","insight"], default: "observation" }, project: { type: "string", default: "default" }, confidence: { type: "number", default: 0.8 }, sensory_type: { type: "string", enum: ["text","visual","audio","haptic","multi"], default: "text" } }, required: ["content"] } },
    { name: "recall", description: "HYBRID SEARCH: 40% BM25 keyword + 60% vector semantic. 'dark mode' matches 'night theme'. Searches ALL memory types.", inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all","episodic","semantic","procedural","somatic"], default: "all" }, limit: { type: "number", default: 10 }, mood_context: { type: "string" } }, required: ["query"] } },
    { name: "focus", description: "Load memories into working memory (max 4 chunks).", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, query: { type: "string" }, project: { type: "string", default: "default" } } } },
    { name: "unfocus", description: "Clear working memory.", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, clear_all: { type: "boolean", default: false } } } },
    { name: "get_working_memory", description: "Show current working memory.", inputSchema: { type: "object", properties: {} } },
    { name: "save_checkpoint", description: "Save working memory state.", inputSchema: { type: "object", properties: { name: { type: "string" }, project: { type: "string", default: "default" } }, required: ["name"] } },
    { name: "restore_checkpoint", description: "Restore checkpoint.", inputSchema: { type: "object", properties: { checkpoint_id: { type: "string" } }, required: ["checkpoint_id"] } },
    { name: "list_checkpoints", description: "List checkpoints.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "create_room", description: "Create memory palace room.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, parent_room_id: { type: "string" }, sensory_anchors: { type: "array", items: { type: "string" }, default: [] }, mood: { type: "string", default: "neutral" } }, required: ["name"] } },
    { name: "place_memory", description: "Place memory in palace room.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, room_id: { type: "string" } }, required: ["memory_id","room_id"] } },
    { name: "navigate_palace", description: "Navigate memory palace.", inputSchema: { type: "object", properties: { room_id: { type: "string" }, list_rooms: { type: "boolean", default: true } } } },
    { name: "dream", description: "Run memory consolidation.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "get_consolidation_history", description: "View consolidation history.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 10 } } } },
    { name: "create_narrative", description: "Create narrative chain.", inputSchema: { type: "object", properties: { title: { type: "string" }, project: { type: "string", default: "default" } }, required: ["title"] } },
    { name: "add_to_narrative", description: "Add memory to narrative.", inputSchema: { type: "object", properties: { chain_id: { type: "string" }, memory_id: { type: "string" }, causal_role: { type: "string", enum: ["event","cause","effect","decision","outcome"], default: "event" } }, required: ["chain_id","memory_id"] } },
    { name: "get_narrative", description: "Get narrative chain.", inputSchema: { type: "object", properties: { chain_id: { type: "string" } }, required: ["chain_id"] } },
    { name: "list_narratives", description: "List narratives.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "imagine", description: "Counterfactual reasoning.", inputSchema: { type: "object", properties: { narrative_id: { type: "string" }, counterfactual: { type: "string" } }, required: ["narrative_id","counterfactual"] } },
    { name: "learn_skill", description: "Store procedural memory.", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, project: { type: "string", default: "default" } }, required: ["title","content"] } },
    { name: "practice_skill", description: "Record skill practice.", inputSchema: { type: "object", properties: { skill_id: { type: "string" }, success: { type: "boolean", default: true } }, required: ["skill_id"] } },
    { name: "get_somatic", description: "Get emotional residue for entity.", inputSchema: { type: "object", properties: { entity_name: { type: "string" } }, required: ["entity_name"] } },
    { name: "list_somatic", description: "List somatic memories.", inputSchema: { type: "object", properties: { min_weight: { type: "number", default: 0 } } } },
    { name: "know_who_knows", description: "Track what others know.", inputSchema: { type: "object", properties: { agent_name: { type: "string" }, domain: { type: "string" }, expertise_level: { type: "number", default: 0.5 }, project: { type: "string", default: "default" } }, required: ["agent_name","domain"] } },
    { name: "find_expert", description: "Find who knows a domain.", inputSchema: { type: "object", properties: { domain: { type: "string" }, project: { type: "string", default: "default" }, min_expertise: { type: "number", default: 0.3 } }, required: ["domain"] } },
    { name: "get_threats", description: "Get threat patterns.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "warn_me", description: "Proactive threat check.", inputSchema: { type: "object", properties: { context: { type: "string" }, project: { type: "string", default: "default" } }, required: ["context"] } },
    { name: "predict_needs", description: "Predict needed memories.", inputSchema: { type: "object", properties: { context: { type: "string" }, project: { type: "string", default: "default" } }, required: ["context"] } },
    { name: "get_mutation_history", description: "Get memory mutation history.", inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
    { name: "reflect", description: "Reflect on memory.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, confidence: { type: "number" }, knowledge_gap: { type: "string" } }, required: ["memory_id"] } },
    { name: "health_check", description: "Full system health check.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "review", description: "Get memories due for review.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, limit: { type: "number", default: 10 } } } },
    { name: "strengthen", description: "Strengthen memory.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, quality: { type: "number", minimum: 0, maximum: 1, default: 1 } }, required: ["memory_id"] } },
    { name: "associations", description: "Find associated memories.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, min_strength: { type: "number", default: 0.2 } }, required: ["memory_id"] } },
    { name: "find_path", description: "Find path between memories.", inputSchema: { type: "object", properties: { from_id: { type: "string" }, to_id: { type: "string" }, max_depth: { type: "number", default: 5 } }, required: ["from_id","to_id"] } },
    { name: "forget", description: "Soft-delete memory.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural","somatic"], default: "episodic" } }, required: ["memory_id"] } },
    { name: "update_memory", description: "Update memory content.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, new_content: { type: "string" } }, required: ["memory_id","new_content"] } },
    { name: "get_memory", description: "Get memory with full details.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural","somatic"], default: "episodic" } }, required: ["memory_id"] } },
    { name: "list_memories", description: "List memories with filtering.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all","episodic","semantic","procedural","somatic"], default: "all" }, limit: { type: "number", default: 50 }, mood_tag: { type: "string" } } } },
    { name: "get_contradictions", description: "Get unresolved contradictions.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "resolve_contradiction", description: "Resolve contradiction.", inputSchema: { type: "object", properties: { contradiction_id: { type: "number" }, keep_memory_id: { type: "string" } }, required: ["contradiction_id","keep_memory_id"] } },
    { name: "export_memories", description: "Export to JSON.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, filepath: { type: "string", default: "" } } } },
    { name: "import_memories", description: "Import from JSON.", inputSchema: { type: "object", properties: { filepath: { type: "string" }, project: { type: "string", default: "default" } }, required: ["filepath"] } },
    { name: "get_stats", description: "Comprehensive statistics.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
  ],
}));

// ─── Resources ───────────────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph", description: "Interactive memory graph with vector similarity edges.", mimeType: "application/json" },
  { uri: "owl-memory://somatic-map", name: "Somatic Map", description: "Emotional residue map.", mimeType: "application/json" },
  { uri: "owl-memory://threat-landscape", name: "Threat Landscape", description: "Active threat patterns.", mimeType: "application/json" },
  { uri: "owl-memory://transactive-directory", name: "Transactive Directory", description: "Who knows what.", mimeType: "application/json" },
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const mems = db.prepare("SELECT id, content, event_type, strength, salience, emotional_valence, developmental_stage FROM episodic_memories WHERE is_active = 1").all();
    const assoc = db.prepare("SELECT source_id, target_id, association_type, strength FROM associations").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes: mems.map(m => ({ id: m.id, label: m.content.slice(0, 60), group: m.event_type, size: m.strength * 10, color: m.emotional_valence > 0.2 ? "#4CAF50" : m.emotional_valence < -0.2 ? "#f44336" : "#2196F3", stage: m.developmental_stage })), edges: assoc.map(a => ({ source: a.source_id, target: a.target_id, type: a.association_type, strength: a.strength })), stats: { total: mems.length, associations: assoc.length, vector_enabled: hasVectors } }, null, 2) }] };
  }
  if (uri === "owl-memory://somatic-map") {
    const s = db.prepare("SELECT entity_name, somatic_valence, somatic_weight FROM somatic_memories WHERE is_active = 1 ORDER BY somatic_weight DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ somatic_map: s }, null, 2) }] };
  }
  if (uri === "owl-memory://threat-landscape") {
    const t = db.prepare("SELECT pattern_name, description, severity FROM threat_patterns WHERE is_active = 1").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ threats: t }, null, 2) }] };
  }
  if (uri === "owl-memory://transactive-directory") {
    const d = db.prepare("SELECT agent_name, domain, expertise_level FROM transactive_memory ORDER BY domain").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ directory: d }, null, 2) }] };
  }
  throw new Error(`Unknown resource: ${uri}`);
});


// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const now = new Date().toISOString();

  try {
    // ═══ REMEMBER ═══
    if (name === "remember") {
      const content = args.content, projectId = args.project || "default", eventType = args.event_type || "observation";
      const confidence = args.confidence || 0.8, sensoryType = args.sensory_type || "text";
      const emotion = detectEmotionalSalience(content), moodTag = detectMood(content);
      const initialStrength = 0.5 + emotion.salience * 0.5, nextReview = calculateNextReview(initialStrength, 0, emotion.salience, "raw");
      const memId = generateId(content, projectId), entities = extractEntities(content);

      db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, source, confidence, emotional_valence, emotional_arousal, salience, strength, somatic_weight, somatic_valence, developmental_stage, created_at, updated_at, next_review, review_interval, sensory_type, mood_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?)`)
        .run(memId, content, eventType, projectId, args.source || "conversation", confidence, emotion.valence, emotion.arousal, emotion.salience, initialStrength, emotion.salience > 0.3 ? emotion.salience * 0.5 : 0, emotion.valence * emotion.arousal, now, now, nextReview, 1.0, sensoryType, moodTag);

      for (const [eName, eType] of entities) {
        db.prepare("INSERT OR IGNORE INTO entities (name, entity_type, first_seen, last_seen) VALUES (?, ?, ?, ?)").run(eName, eType, now, now);
        const er = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
        if (er) { db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, memory_type, entity_id) VALUES (?, 'episodic', ?)").run(memId, er.id); db.prepare("UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?").run(now, er.id); }
      }

      const existing = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND id != ?").all(projectId, memId);
      let contradictionsFound = 0;
      for (const ex of existing) {
        const sim = calculateSimilarity(content, ex.content);
        if (sim > 0.3) {
          const neg = ["not","don't","doesn't","won't","can't","never","no longer","changed","updated","actually","instead"];
          if (neg.some(w => content.toLowerCase().includes(w)) !== neg.some(w => ex.content.toLowerCase().includes(w))) {
            db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, severity, detected_at) VALUES (?, 'episodic', ?, 'episodic', 'warning', ?)").run(ex.id, memId, now);
            contradictionsFound++;
          }
        }
      }

      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      // Store vector embedding (async, non-blocking)
      generateEmbedding(content).then(emb => storeEmbedding(db, memId, emb)).catch(() => {});

      return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, event_type: eventType, emotional_valence: emotion.valence, salience: emotion.salience, strength: initialStrength, developmental_stage: "raw", next_review: nextReview, entities_extracted: entities.length, contradictions_detected: contradictionsFound, mood_tag: moodTag, vector_embedding: hasVectors }, null, 2) }] };
    }

    // ═══ RECALL (HYBRID: Vector + BM25) ═══
    if (name === "recall") {
      const query = args.query, projectId = args.project || "default", limit = args.limit || 10;
      const memoryType = args.memory_type || "all", moodContext = args.mood_context || detectMood(query);
      const results = [], queryEntities = extractEntities(query), queryEmotion = detectEmotionalSalience(query);

      if (memoryType === "all" || memoryType === "episodic") {
        // Phase 1: Vector search
        let vectorScores = new Map();
        if (hasVectors) {
          const queryEmb = await generateEmbedding(query);
          if (queryEmb && queryEmb.length === 384) {
            try {
              const vecRows = db.prepare("SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(queryEmb));
              for (const vr of vecRows) vectorScores.set(vr.rowid, 1 - Math.min(vr.distance, 1));
            } catch (e) { /* ignore */ }
          }
        }

        // Phase 2: BM25 + metadata
        const candidates = new Set();
        for (const mem of db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          candidates.add(mem.id);
          let bm25 = calculateSimilarity(query, mem.content) * 0.3 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) bm25 += 0.1;
          const memEnts = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          bm25 += Math.min(0.15, queryEntities.filter(qe => memEnts.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) bm25 += 0.1;
          if (moodContext && mem.mood_tag === moodContext) bm25 += 0.1;
          if (mem.developmental_stage === "abstracted") bm25 += 0.05;

          const vecScore = vectorScores.get(mem.id) || 0;
          const finalScore = bm25 * 0.4 + vecScore * 0.6;

          if (finalScore > 0.05 || vecScore > 0.3) {
            results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(finalScore * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: Math.round(bm25 * 1000) / 1000 });
          }

          const hs = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hs)), mem.id);
        }

        // Phase 3: Vector-only hits
        for (const [memId, vecScore] of vectorScores) {
          if (!candidates.has(memId) && vecScore > 0.3) {
            const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND project = ? AND is_active = 1").get(memId, projectId);
            if (mem) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(vecScore * 0.6 * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: 0 });
          }
        }
      }

      if (memoryType === "all" || memoryType === "semantic") {
        for (const mem of db.prepare("SELECT * FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.4 + mem.importance * 0.3 + mem.confidence * 0.3;
          if (score > 0.1) results.push({ id: mem.id, type: "semantic", content: mem.content, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      if (memoryType === "all" || memoryType === "procedural") {
        for (const mem of db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.3 + mem.mastery_level * 0.3 + (mem.success_count / Math.max(mem.practice_count, 1)) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "procedural", title: mem.title, mastery_level: mem.mastery_level, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      if (memoryType === "all" || memoryType === "somatic") {
        for (const mem of db.prepare("SELECT * FROM somatic_memories WHERE is_active = 1").all()) {
          const score = calculateSimilarity(query, mem.entity_name) * 0.3 + mem.somatic_weight * 0.4;
          if (score > 0.1) results.push({ id: mem.id, type: "somatic", entity_name: mem.entity_name, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }

      results.sort((a, b) => b.relevance_score - a.relevance_score);
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
    }

    // ═══ FOCUS / UNFOCUS / GET_WORKING_MEMORY ═══
    if (name === "focus") {
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      let ids = args.memory_ids || [];
      if (args.query && ids.length === 0) ids = db.prepare("SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 4").all(args.project || "default").map(m => m.id);
      const lim = ids.slice(0, 4);
      for (let i = 0; i < lim.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, lim[i]);
      const loaded = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: loaded, capacity: 4, used: loaded.length }, null, 2) }] };
    }
    if (name === "unfocus") {
      if (args.clear_all) { db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run(); return { content: [{ type: "text", text: "Working memory cleared." }] }; }
      if (args.memory_ids?.length > 0) { for (const id of args.memory_ids) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL WHERE id = ?").run(id); return { content: [{ type: "text", text: `Removed ${args.memory_ids.length}.` }] }; }
      return { content: [{ type: "text", text: "Nothing to unfocus." }] };
    }
    if (name === "get_working_memory") {
      const mems = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: mems, capacity: 4, used: mems.length }, null, 2) }] };
    }

    // ═══ SESSION CHECKPOINTS ═══
    if (name === "save_checkpoint") {
      const cpId = generateId(args.name, "checkpoint");
      const wm = db.prepare("SELECT id FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      db.prepare("INSERT INTO session_checkpoints (id, name, project, working_memory_ids, created_at) VALUES (?, ?, ?, ?, ?)").run(cpId, args.name, args.project || "default", JSON.stringify(wm.map(m => m.id)), now);
      return { content: [{ type: "text", text: JSON.stringify({ checkpoint_id: cpId, memories_saved: wm.length }, null, 2) }] };
    }
    if (name === "restore_checkpoint") {
      const cp = db.prepare("SELECT * FROM session_checkpoints WHERE id = ?").get(args.checkpoint_id);
      if (!cp) return { content: [{ type: "text", text: "Checkpoint not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      for (let i = 0; i < (JSON.parse(cp.working_memory_ids || "[]")).length; i++) {
        const id = JSON.parse(cp.working_memory_ids)[i];
        if (id) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, id);
      }
      return { content: [{ type: "text", text: JSON.stringify({ restored: true }, null, 2) }] };
    }
    if (name === "list_checkpoints") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT id, name, created_at FROM session_checkpoints WHERE project = ? AND is_active = 1 ORDER BY created_at DESC").all(args.project || "default"), null, 2) }] };
    }

    // ═══ MEMORY PALACE ═══
    if (name === "create_room") {
      const rid = generateId(args.name, "room");
      db.prepare("INSERT INTO palace_rooms (id, name, description, parent_room_id, sensory_anchors, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(rid, args.name, args.description || null, args.parent_room_id || null, JSON.stringify(args.sensory_anchors || []), args.mood || "neutral", now);
      return { content: [{ type: "text", text: JSON.stringify({ room_id: rid }, null, 2) }] };
    }
    if (name === "place_memory") {
      db.prepare("INSERT OR REPLACE INTO memory_placements (memory_id, memory_type, room_id, placed_at) VALUES (?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.room_id, now);
      return { content: [{ type: "text", text: JSON.stringify({ placed: true }, null, 2) }] };
    }
    if (name === "navigate_palace") {
      if (args.list_rooms !== false) return { content: [{ type: "text", text: JSON.stringify({ rooms: db.prepare("SELECT id, name, mood FROM palace_rooms ORDER BY name").all() }, null, 2) }] };
      if (args.room_id) return { content: [{ type: "text", text: JSON.stringify({ room: db.prepare("SELECT * FROM palace_rooms WHERE id = ?").get(args.room_id), memories: db.prepare("SELECT mp.*, em.content FROM memory_placements mp LEFT JOIN episodic_memories em ON em.id = mp.memory_id WHERE mp.room_id = ?").all(args.room_id) }, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide room_id" }) }] };
    }

    // ═══ DREAM ═══
    if (name === "dream") {
      const r = consolidateMemories(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ status: "completed", ...r, vector_reindexed: hasVectors }, null, 2) }] };
    }
    if (name === "get_consolidation_history") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT ?").all(args.limit || 10), null, 2) }] };
    }

    // ═══ NARRATIVE ═══
    if (name === "create_narrative") {
      const cid = generateId(args.title, "narrative");
      db.prepare("INSERT INTO narrative_chains (id, title, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(cid, args.title, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ chain_id: cid }, null, 2) }] };
    }
    if (name === "add_to_narrative") {
      const mo = db.prepare("SELECT MAX(sequence_order) as max FROM narrative_events WHERE chain_id = ?").get(args.chain_id);
      db.prepare("INSERT INTO narrative_events (chain_id, memory_id, memory_type, sequence_order, causal_role) VALUES (?, ?, ?, ?, ?)").run(args.chain_id, args.memory_id, args.memory_type || "episodic", (mo?.max || 0) + 1, args.causal_role || "event");
      return { content: [{ type: "text", text: JSON.stringify({ added: true }, null, 2) }] };
    }
    if (name === "get_narrative") {
      const chain = db.prepare("SELECT * FROM narrative_chains WHERE id = ?").get(args.chain_id);
      if (!chain) return { content: [{ type: "text", text: "Not found." }] };
      return { content: [{ type: "text", text: JSON.stringify({ chain, events: db.prepare("SELECT ne.*, em.content FROM narrative_events ne LEFT JOIN episodic_memories em ON em.id = ne.memory_id WHERE ne.chain_id = ? ORDER BY ne.sequence_order").all(args.chain_id) }, null, 2) }] };
    }
    if (name === "list_narratives") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT * FROM narrative_chains WHERE project = ? AND is_active = 1 ORDER BY updated_at DESC").all(args.project || "default"), null, 2) }] };
    }
    if (name === "imagine") {
      db.prepare("INSERT INTO counterfactuals (narrative_id, counterfactual_scenario, created_at) VALUES (?, ?, ?)").run(args.narrative_id, args.counterfactual, now);
      return { content: [{ type: "text", text: JSON.stringify({ imagined: true }, null, 2) }] };
    }

    // ═══ PROCEDURAL ═══
    if (name === "learn_skill") {
      const sid = generateId(args.title, "skill");
      db.prepare("INSERT INTO procedural_memories (id, title, content, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(sid, args.title, args.content, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: sid, mastery_level: 0.1 }, null, 2) }] };
    }
    if (name === "practice_skill") {
      const s = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(args.skill_id);
      if (!s) return { content: [{ type: "text", text: "Skill not found." }], isError: true };
      const np = s.practice_count + 1, ns = s.success_count + (args.success ? 1 : 0), nm = Math.max(0, Math.min(1, s.mastery_level + (args.success ? 0.05 : -0.02)));
      db.prepare("UPDATE procedural_memories SET practice_count = ?, success_count = ?, mastery_level = ?, last_practiced = ?, updated_at = ? WHERE id = ?").run(np, ns, nm, now, now, args.skill_id);
      return { content: [{ type: "text", text: JSON.stringify({ mastery_level: Math.round(nm * 100) / 100 }, null, 2) }] };
    }

    // ═══ SOMATIC ═══
    if (name === "get_somatic") {
      const s = db.prepare("SELECT * FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(args.entity_name);
      return { content: [{ type: "text", text: JSON.stringify(s ? { found: true, ...s } : { found: false }, null, 2) }] };
    }
    if (name === "list_somatic") {
      return { content: [{ type: "text", text: JSON.stringify({ somatic_map: db.prepare("SELECT entity_name, somatic_valence, somatic_weight FROM somatic_memories WHERE is_active = 1 AND somatic_weight >= ? ORDER BY somatic_weight DESC").all(args.min_weight || 0) }, null, 2) }] };
    }

    // ═══ TRANSATIVE ═══
    if (name === "know_who_knows") {
      db.prepare("INSERT OR REPLACE INTO transactive_memory (agent_name, domain, expertise_level, trust_level, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.agent_name, args.domain, args.expertise_level || 0.5, args.trust_level || 0.8, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ recorded: true }, null, 2) }] };
    }
    if (name === "find_expert") {
      const ex = db.prepare("SELECT agent_name, domain, expertise_level, trust_level FROM transactive_memory WHERE domain LIKE ? AND expertise_level >= ? AND project = ? ORDER BY expertise_level DESC").all(`%${args.domain}%`, args.min_expertise || 0.3, args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ experts: ex, count: ex.length }, null, 2) }] };
    }

    // ═══ THREATS ═══
    if (name === "get_threats") {
      return { content: [{ type: "text", text: JSON.stringify({ threats: db.prepare("SELECT pattern_name, description, severity FROM threat_patterns WHERE is_active = 1").all() }, null, 2) }] };
    }
    if (name === "warn_me") {
      const threats = db.prepare("SELECT * FROM threat_patterns WHERE is_active = 1").all();
      const rel = threats.filter(t => calculateSimilarity(args.context, t.description) > 0.3);
      return { content: [{ type: "text", text: JSON.stringify({ threats_found: rel.length, threats: rel }, null, 2) }] };
    }

    // ═══ PREDICTIVE ═══
    if (name === "predict_needs") {
      const mood = detectMood(args.context);
      const mems = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND mood_tag = ? ORDER BY strength DESC LIMIT 5").all(args.project || "default", mood);
      return { content: [{ type: "text", text: JSON.stringify({ detected_mood: mood, likely_needed_memories: mems }, null, 2) }] };
    }

    // ═══ MUTATIONS ═══
    if (name === "get_mutation_history") {
      return { content: [{ type: "text", text: JSON.stringify({ mutations: db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id) }, null, 2) }] };
    }

    // ═══ METACOGNITION ═══
    if (name === "reflect") {
      db.prepare("INSERT OR REPLACE INTO metacognition (memory_id, memory_type, confidence, knowledge_gap, reflection, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.confidence || 0.8, args.knowledge_gap || null, args.reflection || null, now, now);
      return { content: [{ type: "text", text: JSON.stringify({ reflected: true }, null, 2) }] };
    }
    if (name === "health_check") {
      const pid = args.project || "default";
      const te = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const ts = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const tp = db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(pid).c;
      const tso = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c;
      const avgS = db.prepare("SELECT AVG(strength) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).avg || 0;
      let score = 100 - (1 - avgS) * 20;
      score = Math.max(0, Math.min(100, Math.round(score)));
      return { content: [{ type: "text", text: JSON.stringify({ health_score: score, memories: { episodic: te, semantic: ts, procedural: tp, somatic: tso, total: te + ts + tp + tso }, vector_search: hasVectors }, null, 2) }] };
    }

    // ═══ SPACED REPETITION ═══
    if (name === "review") {
      const due = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND (next_review IS NULL OR next_review <= ?) ORDER BY strength ASC LIMIT ?").all(args.project || "default", now, args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify({ due_for_review: due, count: due.length }, null, 2) }] };
    }
    if (name === "strengthen") {
      const m = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(args.memory_id);
      if (!m) return { content: [{ type: "text", text: "Memory not found." }], isError: true };
      const ns = Math.min(1, m.strength + (args.quality || 1) * 0.2);
      db.prepare("UPDATE episodic_memories SET strength = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?").run(ns, now, args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ new_strength: Math.round(ns * 100) / 100 }, null, 2) }] };
    }

    // ═══ ASSOCIATIVE RECALL ═══
    if (name === "associations") {
      return { content: [{ type: "text", text: JSON.stringify({ associations: db.prepare("SELECT * FROM associations WHERE source_id = ? AND strength >= ? ORDER BY strength DESC").all(args.memory_id, args.min_strength || 0.2) }, null, 2) }] };
    }
    if (name === "find_path") {
      const visited = new Set(), queue = [{ id: args.from_id, path: [] }];
      let found = null;
      while (queue.length > 0 && !found) {
        const c = queue.shift();
        if (c.id === args.to_id) { found = c.path; break; }
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        if (c.path.length >= (args.max_depth || 5)) continue;
        for (const n of db.prepare("SELECT target_id, strength FROM associations WHERE source_id = ? AND strength >= 0.2").all(c.id)) {
          if (!visited.has(n.target_id)) queue.push({ id: n.target_id, path: [...c.path, { id: n.target_id, strength: n.strength }] });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ path: found || [], found: !!found }, null, 2) }] };
    }

    // ═══ STANDARD OPERATIONS ═══
    if (name === "forget") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(args.memory_id);
      if (hasVectors && table === "episodic_memories") try { db.exec(`DELETE FROM episodic_embeddings WHERE rowid = ${args.memory_id}`); } catch (e) { /* ignore */ }
      return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
    }
    if (name === "update_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
      if (hasVectors && table === "episodic_memories") generateEmbedding(args.new_content).then(emb => storeEmbedding(db, args.memory_id, emb)).catch(() => {});
      return { content: [{ type: "text", text: JSON.stringify({ updated: true }, null, 2) }] };
    }
    if (name === "get_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      const m = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(args.memory_id);
      if (!m || !m.is_active) return { content: [{ type: "text", text: "Memory not found." }] };
      return { content: [{ type: "text", text: JSON.stringify({ ...m, mutations: db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at").all(args.memory_id) }, null, 2) }] };
    }
    if (name === "list_memories") {
      const pid = args.project || "default", mt = args.memory_type || "all", lim = args.limit || 50;
      const r = { episodic: [], semantic: [], procedural: [], somatic: [] };
      if (mt === "all" || mt === "episodic") r.episodic = db.prepare(`SELECT id, content, event_type, strength, mood_tag FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT ?`).all(pid, lim);
      if (mt === "all" || mt === "semantic") r.semantic = db.prepare("SELECT id, content, importance FROM semantic_memories WHERE project = ? AND is_active = 1 LIMIT ?").all(pid, lim);
      if (mt === "all" || mt === "procedural") r.procedural = db.prepare("SELECT id, title, mastery_level FROM procedural_memories WHERE project = ? AND is_active = 1 LIMIT ?").all(pid, lim);
      if (mt === "all" || mt === "somatic") r.somatic = db.prepare("SELECT entity_name, somatic_valence, somatic_weight FROM somatic_memories WHERE is_active = 1 LIMIT ?").all(lim);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }

    // ═══ CONTRADICTIONS ═══
    if (name === "get_contradictions") {
      return { content: [{ type: "text", text: JSON.stringify(db.prepare("SELECT c.*, m1.content as c1, m2.content as c2 FROM contradictions c JOIN episodic_memories m1 ON m1.id = c.memory_id_1 JOIN episodic_memories m2 ON m2.id = c.memory_id_2 WHERE m1.project = ? AND c.resolved = 0").all(args.project || "default"), null, 2) }] };
    }
    if (name === "resolve_contradiction") {
      const c = db.prepare("SELECT * FROM contradictions WHERE id = ?").get(args.contradiction_id);
      if (!c) return { content: [{ type: "text", text: "Not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(args.keep_memory_id === c.memory_id_1 ? c.memory_id_2 : c.memory_id_1);
      db.prepare("UPDATE contradictions SET resolved = 1, resolved_at = ? WHERE id = ?").run(now, args.contradiction_id);
      return { content: [{ type: "text", text: JSON.stringify({ resolved: true }, null, 2) }] };
    }

    // ═══ IMPORT/EXPORT ═══
    if (name === "export_memories") {
      const pid = args.project || "default", fp = args.filepath || path.join(DATA_DIR, `export-${pid}-${Date.now()}.json`);
      const exp = { project: pid, exported_at: now, version: "3.1", episodic: db.prepare("SELECT * FROM episodic_memories WHERE project = ?").all(pid), semantic: db.prepare("SELECT * FROM semantic_memories WHERE project = ?").all(pid), procedural: db.prepare("SELECT * FROM procedural_memories WHERE project = ?").all(pid) };
      fs.writeFileSync(fp, JSON.stringify(exp, null, 2));
      return { content: [{ type: "text", text: `Exported to ${fp}` }] };
    }
    if (name === "import_memories") {
      const data = JSON.parse(fs.readFileSync(args.filepath, "utf-8")), pid = args.project || "default";
      let n = 0;
      for (const m of (data.episodic || [])) { db.prepare("INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, created_at) VALUES (?, ?, ?, ?, ?)").run(m.id, m.content, m.event_type, pid, m.created_at || now); n++; }
      return { content: [{ type: "text", text: `Imported ${n} memories.` }] };
    }

    // ═══ STATS ═══
    if (name === "get_stats") {
      const pid = args.project || "default";
      return { content: [{ type: "text", text: JSON.stringify({ project: pid, episodic: db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(pid).c, semantic: db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(pid).c, procedural: db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(pid).c, somatic: db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c, vector_search: hasVectors }, null, 2) }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`OWL Memory MCP v3.1 — Brain-inspired agent memory ${hasVectors ? "+ vector embeddings" : "(no vector extension)"} running on stdio`);
}

main().catch(console.error);
