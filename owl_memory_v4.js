/**
 * OWL Memory MCP v4.0 — The Anticipatory Memory Engine
 *
 * "Memory is not a database. It's a reasoning substrate that thinks, predicts, warns, and decides."
 *
 * NEW in v4.0:
 * REASONING LAYER:
 * - decide: Decision engine with pre-mortem analysis, counterfactual reasoning, outcome prediction
 * - why: Causal reasoning — root cause tracing through memory chains
 * - transfer: Skill transfer via analogical reasoning across domains
 * - self_knowledge: Emotional intelligence — pattern detection in emotional history
 *
 * KNOWLEDGE LAYER:
 * - knowledge_graph: Dynamic knowledge graph with temporal decay, gap detection, learning paths
 * - learn_path: Personalized learning paths based on knowledge gaps
 * - code_review: Memory-driven code review — past bugs, patterns, institutional knowledge
 * - code_pattern: Store/retrieve code patterns and architectural decisions
 *
 * ANTICIPATORY LAYER:
 * - anticipate: Proactive memory surfacing based on current context
 * - warn: Warning system — flags pitfalls from past failures
 *
 * MULTI-AGENT LAYER:
 * - share: Selective memory sharing between agents
 * - collective: Query collective knowledge of all agents
 * - trust: Score reliability of shared memories
 *
 * CODE INTELLIGENCE:
 * - Deep integration with CodeGraph for code-aware memory
 * - Institutional memory for engineering teams
 * - Pattern-based bug prevention
 *
 * All from v3.2: 43 tools, 6 memory types, vector embeddings, NER, hybrid recall, reranking,
 * dream consolidation, memory palace, narrative chains, spaced repetition, interactive graph UI.
 *
 * Total: 55+ tools, 6 memory types, 8 resource types.
 * Architecture: Reasoning > Storage. Prediction > Retrieval. Action > Recall.
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

// ─── NER Entity Extraction ───────────────────────────────────────────────────
let nerModel = null;
let nerLoading = null;
let hasNER = false;
// Entity type mapping from BIO tags to our internal types
const NER_TYPE_MAP = {
  PER: "person", ORG: "organization", LOC: "location", MISC: "misc",
  // Also handle common fine-grained NER labels
  DATE: "date", TIME: "time", MONEY: "money", PERCENT: "percent",
  FAC: "facility", GPE: "location", PRODUCT: "product", EVENT: "event",
  LANGUAGE: "language", LAW: "law", NORP: "group", WORK_OF_ART: "creative_work",
};
// Words that look like entities but aren't
const NER_STOP_WORDS = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","shall","should","may","might","must","can","could","need","dare","ought","used","to","of","in","for","on","with","at","by","from","as","into","through","during","before","after","above","below","between","out","off","over","under","again","further","then","once","here","there","when","where","why","how","all","each","every","both","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","because","but","and","or","if","while","although","though","after","before","since","until","unless","however","therefore","moreover","furthermore","nevertheless","meanwhile","otherwise","instead","also","still","already","even","just","quite","rather","enough","indeed","thus","hence","yet"]);

async function getNER() {
  if (hasNER && nerModel) return nerModel;
  if (nerLoading) return nerLoading;
  nerLoading = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      nerModel = await pipeline("token-classification", "Xenova/bert-base-NER", { quantized: true });
      hasNER = true;
      console.error("NER model: Xenova/bert-base-NER (quantized)");
      return nerModel;
    } catch (e) {
      console.error("NER load failed:", e.message);
      nerLoading = null;
      return null;
    }
  })();
  return nerLoading;
}

// Ensure NER model is loaded (call during init, non-blocking warmup)
function warmupNER() { getNER().catch(() => {}); }

async function extractEntitiesNER(text) {
  const entities = [];
  try {
    const model = await getNER();
    if (!model) return extractEntitiesFallback(text);
    // Run NER on original text (not normalized — WordPiece tokenization is sensitive to casing)
    const results = await model(text.slice(0, 512));
    // Merge BIO-tagged tokens into full entities
    let currentEntity = null, currentWords = [], currentType = null, currentScore = 0;
    for (const r of results) {
      const tag = r.entity;
      const rawWord = r.word;
      const score = r.score;
      // WordPiece: ##prefix means continuation (no space), otherwise new word (add space)
      const isContinuation = rawWord.startsWith("##");
      const word = rawWord.replace(/^##/, "");
      if (tag.startsWith("B-")) {
        if (currentEntity) {
          entities.push([currentEntity, currentType, Math.round(currentScore / currentWords.length * 100) / 100]);
        }
        currentType = NER_TYPE_MAP[tag.slice(2)] || "misc";
        currentWords = [word];
        currentEntity = word;
        currentScore = score;
      } else if (tag.startsWith("I-") && currentEntity) {
        currentWords.push(word);
        // Continuation words join directly, new words get a space
        currentEntity += isContinuation ? word : " " + word;
        currentScore += score;
        const newType = NER_TYPE_MAP[tag.slice(2)] || "misc";
        if (newType === "organization" || newType === "person") {
          if (currentType === "location" || currentType === "misc") {
            currentType = newType;
          }
        }
      } else {
        // Handle I-tag without preceding B-tag (model quirk)
        if (tag.startsWith("I-") && !currentEntity) {
          // Orphan I-tag: treat as B-tag
          currentType = NER_TYPE_MAP[tag.slice(2)] || "misc";
          currentWords = [word];
          currentEntity = word;
          currentScore = score;
        } else {
          if (currentEntity) {
            entities.push([currentEntity, currentType, Math.round(currentScore / currentWords.length * 100) / 100]);
            currentEntity = null; currentWords = []; currentType = null; currentScore = 0;
          }
        }
      }
    }
    // Don't forget the last entity
    if (currentEntity) {
      entities.push([currentEntity, currentType, Math.round(currentScore / currentWords.length * 100) / 100]);
    }
    // Post-merge: combine adjacent fragments of the same type
    // e.g., "Sun" + "dar Picha" → "Sundar Picha" (WordPiece fragmentation)
    const merged = [];
    for (const [name, type, score] of entities) {
      if (merged.length > 0 && merged[merged.length - 1][1] === type) {
        const prev = merged[merged.length - 1];
        // Merge if the previous entity ends with a partial word (lowercase continuation)
        // or if the current entity starts with lowercase (continuation fragment)
        const prevEndsPartial = /[a-z]$/.test(prev[0]) && /^[a-z]/.test(name);
        const curStartsLower = /^[a-z]/.test(name);
        if (prevEndsPartial || curStartsLower) {
          merged[merged.length - 1] = [prev[0] + name, type, Math.max(prev[2], score)];
          continue;
        }
      }
      merged.push([name, type, score]);
    }
    // Filter: remove stop words, very short entities, low confidence
    const filtered = merged.filter(([name, type, score]) => {
      const lower = name.toLowerCase().trim();
      if (NER_STOP_WORDS.has(lower)) return false;
      if (name.trim().length < 2) return false;
      if (score < 0.5) return false;
      return true;
    });
    // Deduplicate by normalized name
    const seen = new Map();
    for (const [name, type, score] of filtered) {
      const key = name.toLowerCase().trim();
      if (!seen.has(key) || seen.get(key)[2] < score) {
        seen.set(key, [name, type, score]);
      }
    }
    return [...seen.values()];
  } catch (e) {
    console.error("NER extraction failed, using fallback:", e.message);
    return extractEntitiesFallback(text);
  }
}

// Fallback regex-based extraction (from v3.1)
function extractEntitiesFallback(text) {
  const e = [];
  for (const m of text.matchAll(/"([^"]+)"/g)) e.push([m[1], "quoted", 0.9]);
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) if (!["The","This","That","These","Those","There","Their","Then","Than"].includes(m[1].split(" ")[0])) e.push([m[1], "proper_noun", 0.7]);
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) e.push([m[0], "email", 0.95]);
  // Also extract:
  // - URLs
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) e.push([m[0], "url", 0.95]);
  // - Hashtags
  for (const m of text.matchAll(/#(\w+)/g)) e.push([m[1], "hashtag", 0.8]);
  // - Mentions
  for (const m of text.matchAll(/@(\w+)/g)) e.push([m[1], "mention", 0.8]);
  // - CamelCase terms (likely tech/product names)
  for (const m of text.matchAll(/\b([A-Z][a-z]+[A-Z]\w*)\b/g)) e.push([m[1], "product", 0.6]);
  // - ALL_CAPS acronyms (2-6 chars)
  for (const m of text.matchAll(/\b([A-Z]{2,6})\b/g)) if (!["HTTP","HTTPS","JSON","HTML","CSS","URL"].includes(m[0])) e.push([m[0], "acronym", 0.5]);
  const seen = new Map();
  for (const [name, type, score] of e) {
    const key = `${name.toLowerCase().trim()}:${type}`;
    if (!seen.has(key) || seen.get(key)[2] < score) seen.set(key, [name, type, score]);
  }
  return [...seen.values()];
}

async function generateEmbedding(text) {
  const m = await getEmbedder();
  if (!m) return null;
  try {
    const out = await m(text.slice(0, 512), { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (e) { return null; }
}

function hexToBigInt(hex) {
  return BigInt.asIntN(64, BigInt("0x" + hex));
}

function bigIntToHex(bigint) {
  return BigInt.asUintN(64, bigint).toString(16).padStart(16, "0");
}

function parseEmbedding(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) {
    const floatArray = new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4);
    return Array.from(floatArray);
  }
  try {
    if (typeof value === "string") return JSON.parse(value);
  } catch (e) {}
  return null;
}

function storeEmbedding(db, memId, emb) {
  if (!hasVectors || !emb || emb.length !== 384) return;
  try {
    const bigintId = hexToBigInt(memId);
    db.prepare("INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (?, ?)").run(bigintId, JSON.stringify(emb));
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

    -- ═══ v4 NEW: Decision Memory ═══
    CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, context TEXT,
        options TEXT, chosen_option TEXT, predicted_outcome TEXT,
        actual_outcome TEXT, status TEXT DEFAULT 'pending',
        project TEXT DEFAULT 'default', created_at TEXT NOT NULL,
        decided_at TEXT, reviewed_at TEXT, lessons_learned TEXT
    );
    CREATE TABLE IF NOT EXISTS decision_memories (
        decision_id TEXT NOT NULL, memory_id TEXT NOT NULL,
        role TEXT DEFAULT 'supporting',
        PRIMARY KEY (decision_id, memory_id)
    );

    -- ═══ v4 NEW: Causal Chains ═══
    CREATE TABLE IF NOT EXISTS causal_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cause_id TEXT NOT NULL,
        effect_id TEXT NOT NULL, strength REAL DEFAULT 0.5,
        link_type TEXT DEFAULT 'causes', created_at TEXT NOT NULL,
        UNIQUE(cause_id, effect_id, link_type)
    );

    -- ═══ v4 NEW: Knowledge Graph ═══
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, node_type TEXT DEFAULT 'concept',
        description TEXT, importance REAL DEFAULT 0.5,
        mastery REAL DEFAULT 0, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS knowledge_edges (
        source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        edge_type TEXT DEFAULT 'related', weight REAL DEFAULT 0.5,
        created_at TEXT NOT NULL, last_reinforced TEXT,
        decay_rate REAL DEFAULT 0.01,
        PRIMARY KEY (source_id, target_id, edge_type)
    );
    CREATE TABLE IF NOT EXISTS knowledge_gaps (
        id TEXT PRIMARY KEY, node_id TEXT NOT NULL,
        gap_type TEXT DEFAULT 'missing', priority REAL DEFAULT 0.5,
        suggested_resources TEXT, created_at TEXT NOT NULL, resolved INTEGER DEFAULT 0
    );

    -- ═══ v4 NEW: Emotional Patterns ═══
    CREATE TABLE IF NOT EXISTS emotional_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_name TEXT NOT NULL,
        description TEXT, trigger_conditions TEXT,
        frequency INTEGER DEFAULT 1, first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL, is_active INTEGER DEFAULT 1
    );

    -- ═══ v4 NEW: Agent Sharing ═══
    CREATE TABLE IF NOT EXISTS shared_memories (
        id TEXT PRIMARY KEY, memory_id TEXT NOT NULL,
        from_agent TEXT NOT NULL, to_agent TEXT NOT NULL,
        trust_score REAL DEFAULT 0.5, shared_at TEXT NOT NULL,
        accepted INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS agent_trust (
        agent_name TEXT NOT NULL, domain TEXT,
        trust_score REAL DEFAULT 0.5, interactions INTEGER DEFAULT 0,
        last_interaction TEXT, PRIMARY KEY (agent_name, domain)
    );

    -- ═══ v4 NEW: Context Monitoring ═══
    CREATE TABLE IF NOT EXISTS context_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, context_type TEXT NOT NULL,
        context_data TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS anticipatory_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, context_snapshot_id INTEGER,
        memory_id TEXT NOT NULL, relevance_score REAL NOT NULL,
        surfaced INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );

    -- ═══ v4 NEW: Code Intelligence ═══
    CREATE TABLE IF NOT EXISTS code_patterns (
        id TEXT PRIMARY KEY, pattern_type TEXT NOT NULL,
        description TEXT, code_snippet TEXT, language TEXT,
        file_path TEXT, project TEXT, created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS code_bugs (
        id TEXT PRIMARY KEY, bug_type TEXT NOT NULL,
        description TEXT, file_path TEXT, line_number INTEGER,
        resolution TEXT, project TEXT, created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS code_reviews (
        id TEXT PRIMARY KEY, file_path TEXT, change_description TEXT,
        issues_found TEXT, suggestions TEXT, project TEXT,
        created_at TEXT NOT NULL
    );

    -- ═══ v4 NEW: Graphify Integration ═══
    CREATE TABLE IF NOT EXISTS code_nodes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, node_type TEXT NOT NULL,
        filepath TEXT NOT NULL, content TEXT, project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS code_edges (
        source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        edge_type TEXT DEFAULT 'calls', weight REAL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, edge_type)
    );
    CREATE TABLE IF NOT EXISTS memory_code_links (
        memory_id TEXT NOT NULL, code_node_id TEXT NOT NULL,
        link_type TEXT DEFAULT 'associated',
        PRIMARY KEY (memory_id, code_node_id)
    );

    CREATE TABLE IF NOT EXISTS code_node_activation (
        node_id TEXT PRIMARY KEY,
        activation REAL DEFAULT 0.0,
        last_updated INTEGER,
        FOREIGN KEY(node_id) REFERENCES code_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS synaptic_weights (
        source_id TEXT,
        target_id TEXT,
        weight REAL DEFAULT 1.0,
        co_occurrences INTEGER DEFAULT 1,
        PRIMARY KEY(source_id, target_id),
        FOREIGN KEY(source_id) REFERENCES code_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(target_id) REFERENCES code_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_git_branches (
        memory_id TEXT,
        branch_name TEXT,
        commit_sha TEXT,
        PRIMARY KEY(memory_id, branch_name),
        FOREIGN KEY(memory_id) REFERENCES episodic_memories(id) ON DELETE CASCADE
    );
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
// Legacy sync wrapper — kept for backward compat but delegates to fallback
// Use extractEntitiesNER() directly for full NER + scores
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
  { name: "owl-memory", version: "4.0.0", description: "OWL Memory MCP v4.0 — The Anticipatory Memory Engine. 55+ tools: episodic/semantic/procedural/somatic/transactive/working memory, vector+BM25 hybrid search with NER entity extraction, adaptive blending, cross-encoder reranking, decision engine with pre-mortem reasoning, causal root-cause analysis, skill transfer, emotional intelligence, knowledge graph with temporal decay, multi-agent memory sharing, anticipatory proactive surfacing, code intelligence, and interactive D3.js graph visualization. Works across all AI tools: Claude, Cursor, Codex, Hermes, and standalone." },
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

    // ═══ v4 NEW: REASONING LAYER ═══
    { name: "decide", description: "Decision engine with pre-mortem analysis. Given a decision context, retrieves relevant past decisions, runs counterfactual reasoning, generates pre-mortem (why this might fail), and stores the decision for future learning.", inputSchema: { type: "object", properties: { title: { type: "string" }, context: { type: "string" }, options: { type: "array", items: { type: "string" } }, chosen_option: { type: "string" }, project: { type: "string", default: "default" } }, required: ["title","context"] } },
    { name: "why", description: "Causal reasoning — traces root causes through memory chains. Given a current situation, finds the causal chain that led to it and identifies intervention points.", inputSchema: { type: "object", properties: { situation: { type: "string" }, max_depth: { type: "number", default: 5 }, project: { type: "string", default: "default" } }, required: ["situation"] } },
    { name: "transfer", description: "Skill transfer via analogical reasoning. Given a skill and target domain, finds analogous patterns and generates adapted skill variants.", inputSchema: { type: "object", properties: { skill_description: { type: "string" }, target_domain: { type: "string" }, project: { type: "string", default: "default" } }, required: ["skill_description","target_domain"] } },
    { name: "self_knowledge", description: "Emotional intelligence layer — analyzes emotional patterns across all memories. Detects decision-making patterns, energy levels, emotional triggers, and correlations.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, analysis_type: { type: "string", enum: ["patterns","triggers","energy","correlations","full"], default: "full" } } } },

    // ═══ v4 NEW: KNOWLEDGE LAYER ═══
    { name: "knowledge_graph", description: "Dynamic knowledge graph with temporal decay, gap detection, and learning path suggestions.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, action: { type: "string", enum: ["view","gaps","decay","stats"], default: "view" } } } },
    { name: "learn_path", description: "Generate personalized learning path based on knowledge gaps and existing knowledge.", inputSchema: { type: "object", properties: { goal: { type: "string" }, project: { type: "string", default: "default" } }, required: ["goal"] } },

    // ═══ v4 NEW: ANTICIPATORY LAYER ═══
    { name: "anticipate", description: "Proactive memory surfacing — given current context, surfaces relevant memories before being asked.", inputSchema: { type: "object", properties: { context: { type: "string" }, project: { type: "string", default: "default" }, limit: { type: "number", default: 5 } }, required: ["context"] } },
    { name: "warn", description: "Warning system — given a planned action, flags potential pitfalls from past failures.", inputSchema: { type: "object", properties: { planned_action: { type: "string" }, project: { type: "string", default: "default" } }, required: ["planned_action"] } },

    // ═══ v4 NEW: MULTI-AGENT LAYER ═══
    { name: "share", description: "Share selected memories with another agent.", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, to_agent: { type: "string" }, trust_level: { type: "number", default: 0.5 } }, required: ["memory_ids","to_agent"] } },
    { name: "collective", description: "Query the collective knowledge of all agents.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 10 } }, required: ["query"] } },
    { name: "trust", description: "Score and update reliability of an agent's shared memories.", inputSchema: { type: "object", properties: { agent_name: { type: "string" }, domain: { type: "string" }, trust_score: { type: "number", minimum: 0, maximum: 1 } }, required: ["agent_name"] } },

    // ═══ v4 NEW: CODE INTELLIGENCE ═══
    { name: "code_review", description: "Memory-driven code review — retrieves past similar changes, bugs, and patterns for a given code change.", inputSchema: { type: "object", properties: { file_path: { type: "string" }, change_description: { type: "string" }, project: { type: "string", default: "default" } }, required: ["file_path","change_description"] } },
    { name: "code_pattern", description: "Store or retrieve code patterns, architectural decisions, and lessons learned.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["store","retrieve"], default: "retrieve" }, pattern_type: { type: "string" }, description: { type: "string" }, code_snippet: { type: "string" }, language: { type: "string" }, file_path: { type: "string" }, project: { type: "string", default: "default" } } } },

    // ═══ v4 NEW: GRAPHIFY INTEGRATION ═══
    { name: "index_codebase", description: "Scan and parse a codebase directory recursively to extract dependencies, imports, classes, and function calls.", inputSchema: { type: "object", properties: { scan_path: { type: "string" }, project: { type: "string", default: "default" } }, required: ["scan_path"] } },
    { name: "query_codebase", description: "Query the extracted code nodes (files, classes, functions) by keyword similarity.", inputSchema: { type: "object", properties: { query: { type: "string" }, node_type: { type: "string", enum: ["all","file","class","function"], default: "all" }, project: { type: "string", default: "default" } }, required: ["query"] } },
    { name: "code_path", description: "Find call paths or import dependencies between two code nodes using BFS.", inputSchema: { type: "object", properties: { from_node: { type: "string" }, to_node: { type: "string" }, project: { type: "string", default: "default" } }, required: ["from_node","to_node"] } },
    { name: "cluster_codebase", description: "Group code nodes into modular communities using a local Label Propagation algorithm.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "anticipate_resonant", description: "Nikola Tesla Resonant Context — find memories linked to functions and files connected in the call graph.", inputSchema: { type: "object", properties: { node_id: { type: "string" }, project: { type: "string", default: "default" }, limit: { type: "number", default: 5 }, max_depth: { type: "number", default: 2 } }, required: ["node_id"] } },
    { name: "inject_activation", description: "Inject spreading activation energy into a code node. Propagates energy through the call graph, decay over distance/time, and retrieve memories with activation above the threshold.", inputSchema: { type: "object", properties: { node_id: { type: "string" }, energy: { type: "number", default: 10.0 }, project: { type: "string", default: "default" }, decay_factor: { type: "number", default: 0.1 }, threshold: { type: "number", default: 1.0 }, max_depth: { type: "number", default: 2 } }, required: ["node_id"] } },
    { name: "learn_from_error", description: "Surprise-Gated Acetylcholine Memory (ASGM). Capture command error traces, parse stack trace, automatically locate/register the code function, store the bug memory, and link them.", inputSchema: { type: "object", properties: { error_message: { type: "string" }, command: { type: "string", default: "unknown" }, project: { type: "string", default: "default" }, surprise_score: { type: "number", default: 0.8 } }, required: ["error_message"] } },
  ],
}));

// ─── Resources ───────────────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph", description: "Full memory graph with nodes, edges, entities, and stats.", mimeType: "application/json" },
  { uri: "owl-memory://graph-ui", name: "Memory Graph UI", description: "Interactive D3.js force-directed graph with entity tags, tooltips, zoom, drag.", mimeType: "text/html" },
  { uri: "owl-memory://somatic-map", name: "Somatic Map", description: "Emotional residue map.", mimeType: "application/json" },
  { uri: "owl-memory://threat-landscape", name: "Threat Landscape", description: "Active threat patterns.", mimeType: "application/json" },
  { uri: "owl-memory://transactive-directory", name: "Transactive Directory", description: "Who knows what across agents.", mimeType: "application/json" },
  { uri: "owl-memory://knowledge-graph", name: "Knowledge Graph", description: "Dynamic knowledge graph with gaps and learning paths.", mimeType: "application/json" },
  { uri: "owl-memory://decisions", name: "Decision History", description: "All decisions with outcomes and lessons learned.", mimeType: "application/json" },
  { uri: "owl-memory://emotional-patterns", name: "Emotional Patterns", description: "Detected emotional patterns and triggers.", mimeType: "application/json" },
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const mems = db.prepare("SELECT id, content, event_type, strength, salience, emotional_valence, developmental_stage FROM episodic_memories WHERE is_active = 1").all();
    const assoc = db.prepare("SELECT source_id, target_id, association_type, strength FROM associations").all();
    const ents = db.prepare("SELECT e.name, e.entity_type, me.memory_id FROM entities e JOIN memory_entities me ON me.entity_id = e.id").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes: mems.map(m => ({ id: m.id, label: m.content.slice(0, 60), group: m.event_type, size: Math.max(5, m.strength * 10), color: m.emotional_valence > 0.2 ? "#4CAF50" : m.emotional_valence < -0.2 ? "#f44336" : "#2196F3", stage: m.developmental_stage, salience: m.salience })), edges: assoc.map(a => ({ source: a.source_id, target: a.target_id, type: a.association_type, strength: a.strength })), entities: ents, stats: { total: mems.length, associations: assoc.length, entities: ents.length, vector_enabled: hasVectors, ner_enabled: hasNER } }, null, 2) }] };
  }
  if (uri === "owl-memory://graph-ui") {
    // Interactive D3.js force-directed graph visualization
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OWL Memory Graph</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a1a;color:#e0e0e0;overflow:hidden}
#graph{width:100vw;height:100vh}
#controls{position:fixed;top:16px;left:16px;background:rgba(15,15,35,0.92);border:1px solid #2a2a4a;border-radius:12px;padding:16px;max-width:320px;backdrop-filter:blur(10px);z-index:10}
#controls h2{font-size:14px;color:#8b5cf6;margin-bottom:8px;font-weight:600}
#controls .stat{font-size:11px;color:#888;margin:3px 0}
#controls .stat span{color:#c0c0c0;font-weight:500}
#controls .legend{margin-top:10px;padding-top:10px;border-top:1px solid #2a2a4a}
#controls .legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#888;margin:3px 0}
#controls .legend-dot{width:10px;height:10px;border-radius:50%}
#tooltip{position:fixed;background:rgba(20,20,50,0.95);border:1px solid #3a3a6a;border-radius:8px;padding:12px;max-width:350px;font-size:12px;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:20;backdrop-filter:blur(10px)}
#tooltip .content{color:#e0e0e0;line-height:1.5}
#tooltip .meta{color:#8b5cf6;font-size:10px;margin-top:6px}
#tooltip .entity-tag{display:inline-block;background:#2a2a4a;border-radius:4px;padding:1px 6px;margin:2px;font-size:10px;color:#a78bfa}
svg text{font-size:9px;fill:#aaa;pointer-events:none}
</style>
</head>
<body>
<div id="controls"><h2>OWL Memory Graph</h2><div id="stats"></div><div class="legend" id="legend"></div></div>
<div id="graph"></div>
<div id="tooltip"><div class="content"></div><div class="meta"></div></div>
<script>
const WIDTH=window.innerWidth,HEIGHT=window.innerHeight;
const svg=d3.select("#graph").append("svg").attr("width",WIDTH).attr("height",HEIGHT);
const g=svg.append("g");
const zoom=d3.zoom().scaleExtent([0.1,8]).on("zoom",(e)=>g.attr("transform",e.transform));
svg.call(zoom);

const colors={observation:"#2196F3",decision:"#f59e0b",interaction:"#10b981",learning:"#8b5cf6",error:"#ef4444",insight:"#06b6d4",person:"#f472b6",organization:"#a78bfa",location:"#34d399",product:"#fbbf24",event:"#fb923c",finance:"#22d3ee",misc:"#94a3b8"};
const groupNames={observation:"Observation",decision:"Decision",interaction:"Interaction",learning:"Learning",error:"Error",insight:"Insight",person:"Person",organization:"Organization",location:"Location",product:"Product",event:"Event",finance:"Finance",misc:"Misc"};

const tooltip=d3.select("#tooltip");
const tooltipContent=tooltip.select(".content");
const tooltipMeta=tooltip.select(".meta");

function showTooltip(d,event){
  let html="<strong>"+d.label+"</strong>";
  if(d.stage) html+="<br>Stage: "+d.stage;
  if(d.salience) html+="<br>Salience: "+d.salience.toFixed(2);
  if(d.group) html+="<br>Type: "+(groupNames[d.group]||d.group);
  tooltipContent.html(html);
  tooltipMeta.text(d.id.slice(0,8)+"...");
  tooltip.style("opacity",1).style("left",(event.clientX+15)+"px").style("top",(event.clientY-10)+"px");
}
function hideTooltip(){tooltip.style("opacity",0);}

// Fetch graph data from MCP resource
fetch("owl-memory://graph").then(r=>r.json()).then(data=>{
  const nodes=data.nodes.map(d=>({...d}));
  const links=data.edges.map(d=>({...d}));
  const entMap={};
  (data.entities||[]).forEach(e=>{if(!entMap[e.memory_id])entMap[e.memory_id]=[];entMap[e.memory_id].push(e);});

  document.getElementById("stats").innerHTML=
    '<div class="stat">Nodes: <span>'+nodes.length+'</span></div>'+
    '<div class="stat">Edges: <span>'+links.length+'</span></div>'+
    '<div class="stat">Entities: <span>'+(data.stats?.entities||0)+'</span></div>'+
    '<div class="stat">Vector: <span>'+(data.stats?.vector_enabled?'ON':'OFF')+'</span></div>'+
    '<div class="stat">NER: <span>'+(data.stats?.ner_enabled?'ON':'OFF')+'</span></div>';

  // Build legend from actual groups
  const groups=[...new Set(nodes.map(d=>d.group))].filter(Boolean);
  const legendHtml=groups.slice(0,8).map(g=>'<div class="legend-item"><div class="legend-dot" style="background:'+(colors[g]||"#888")+'"></div>'+(groupNames[g]||g)+'</div>').join("");
  document.getElementById("legend").innerHTML=legendHtml;

  const simulation=d3.forceSimulation(nodes)
    .force("link",d3.forceLink(links).id(d=>d.id).distance(80).strength(d=>(d.strength||0.3)*0.5))
    .force("charge",d3.forceManyBody().strength(-200))
    .force("center",d3.forceCenter(WIDTH/2,HEIGHT/2))
    .force("collision",d3.forceCollide().radius(d=>d.size+5));

  const link=g.append("g").selectAll("line").data(links).join("line")
    .attr("stroke","#2a2a4a").attr("stroke-width",d=>Math.max(1,(d.strength||0.3)*3)).attr("stroke-opacity",0.5);

  const node=g.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("r",d=>d.size||5).attr("fill",d=>colors[d.group]||"#6b7280")
    .attr("stroke","#fff").attr("stroke-width",0.5).attr("stroke-opacity",0.3)
    .style("cursor","pointer")
    .call(d3.drag().on("start",(e,d)=>{if(!e.active)simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;}).on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y;}).on("end",(e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}))
    .on("mouseover",(e,d)=>{showTooltip(e,d);d3.select(e.currentTarget).attr("stroke-width",2).attr("stroke-opacity",0.8);})
    .on("mousemove",(e,d)=>showTooltip(e,d))
    .on("mouseout",(e,d)=>{hideTooltip();d3.select(e.currentTarget).attr("stroke-width",0.5).attr("stroke-opacity",0.3);})
    .on("click",(e,d)=>{
      const ents=entMap[d.id]||[];
      if(ents.length){
        let html="<strong>"+d.label+"</strong><br><br>Entities:";
        ents.forEach(ent=>{html+='<span class="entity-tag">'+ent.name+' ('+ent.entity_type+')</span>';});
        tooltipContent.html(html);
        tooltipMeta.text("Click elsewhere to close");
        tooltip.style("opacity",1).style("left",(e.clientX+15)+"px").style("top",(e.clientY-10)+"px");
      }
    });

  // Labels for high-salience nodes
  const labels=g.append("g").selectAll("text").data(nodes.filter(d=>d.salience>0.5)).join("text")
    .text(d=>d.label.length>30?d.label.slice(0,30)+"...":d.label)
    .attr("dx",8).attr("dy",3);

  simulation.on("tick",()=>{
    link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
    node.attr("cx",d=>d.x).attr("cy",d=>d.y);
    labels.attr("x",d=>d.x).attr("y",d=>d.y);
  });

  // Initial zoom to fit
  setTimeout(()=>{
    const bounds=g.node().getBBox();
    const fullWidth=Math.max(bounds.width+100,100);
    const fullHeight=Math.max(bounds.height+100,100);
    const scale=Math.min(WIDTH/fullWidth,HEIGHT/fullHeight,1)*0.9;
    svg.call(zoom.transform,d3.zoomIdentity.translate(WIDTH/2-bounds.x*scale,HEIGHT/2-bounds.y*scale).scale(scale));
  },500);

}).catch(e=>{
  document.getElementById("stats").innerHTML='<div class="stat" style="color:#ef4444">Error loading graph: '+e.message+'</div>';
});
</script></body></html>`;
    return { contents: [{ uri, mimeType: "text/html", text: html }] };
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
  if (uri === "owl-memory://knowledge-graph") {
    const nodes = db.prepare("SELECT * FROM knowledge_nodes WHERE is_active = 1 ORDER BY importance DESC").all();
    const edges = db.prepare("SELECT * FROM knowledge_edges ORDER BY weight DESC").all();
    const gaps = db.prepare("SELECT kg.*, kn.label FROM knowledge_gaps kg JOIN knowledge_nodes kn ON kn.id = kg.node_id WHERE kg.resolved = 0 ORDER BY kg.priority DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes, edges, gaps, stats: { nodes: nodes.length, edges: edges.length, gaps: gaps.length } }, null, 2) }] };
  }
  if (uri === "owl-memory://decisions") {
    const d = db.prepare("SELECT * FROM decisions ORDER BY created_at DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ decisions: d }, null, 2) }] };
  }
  if (uri === "owl-memory://emotional-patterns") {
    const p = db.prepare("SELECT * FROM emotional_patterns WHERE is_active = 1 ORDER BY frequency DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ patterns: p }, null, 2) }] };
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
      const memId = generateId(content, projectId);
      const entities = await extractEntitiesNER(content);

      db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, source, confidence, emotional_valence, emotional_arousal, salience, strength, somatic_weight, somatic_valence, developmental_stage, created_at, updated_at, next_review, review_interval, sensory_type, mood_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?)`)
        .run(memId, content, eventType, projectId, args.source || "conversation", confidence, emotion.valence, emotion.arousal, emotion.salience, initialStrength, emotion.salience > 0.3 ? emotion.salience * 0.5 : 0, emotion.valence * emotion.arousal, now, now, nextReview, 1.0, sensoryType, moodTag);

      for (const [eName, eType, eScore] of entities) {
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
        for (const [eName, eType, eScore] of entities) {
          if (eType === "proper_noun" || eType === "quoted" || eType === "person" || eType === "organization") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)").run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      // Store vector embedding (blocking to ensure consistency)
      if (hasVectors) {
        const emb = await generateEmbedding(content);
        storeEmbedding(db, memId, emb);
      }

      const entitySummary = {};
      for (const [n, t, s] of entities) { entitySummary[t] = (entitySummary[t] || 0) + 1; }

      return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, event_type: eventType, emotional_valence: emotion.valence, salience: emotion.salience, strength: initialStrength, developmental_stage: "raw", next_review: nextReview, entities_extracted: entities.length, entity_summary: entitySummary, ner_model: hasNER, contradictions_detected: contradictionsFound, mood_tag: moodTag, vector_embedding: hasVectors }, null, 2) }] };
    }

    // ═══ RECALL (HYBRID: Vector + BM25 + Rerank) ═══
    if (name === "recall") {
      const query = args.query, projectId = args.project || "default", limit = args.limit || 10;
      const memoryType = args.memory_type || "all", moodContext = args.mood_context || detectMood(query);
      const results = [], queryEntities = await extractEntitiesNER(query), queryEmotion = detectEmotionalSalience(query);

      // Compute query embedding once for reranking
      let queryEmbedding = null;
      if (hasVectors) {
        queryEmbedding = await generateEmbedding(query);
      }

      if (memoryType === "all" || memoryType === "episodic") {
        // Phase 1: Vector search (ANN approximation)
        let vectorScores = new Map();
        if (hasVectors && queryEmbedding && queryEmbedding.length === 384) {
          try {
            const vecRows = db.prepare("SELECT CAST(rowid AS TEXT) AS rowid_str, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(queryEmbedding));
            for (const vr of vecRows) vectorScores.set(BigInt(vr.rowid_str), 1 - vr.distance / 2);
          } catch (e) { /* ignore */ }
        }

        // Phase 2: BM25 + metadata scoring
        const candidates = new Set();
        const candidateEmbeddings = new Map(); // Store embeddings for reranking
        for (const mem of db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          candidates.add(mem.id);
          let bm25 = calculateSimilarity(query, mem.content) * 0.3 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) bm25 += 0.1;
          const memEnts = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          bm25 += Math.min(0.15, queryEntities.filter(qe => memEnts.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) bm25 += 0.1;
          if (moodContext && mem.mood_tag === moodContext) bm25 += 0.1;
          if (mem.developmental_stage === "abstracted") bm25 += 0.05;

          const bigintId = hexToBigInt(mem.id);
          const vecScore = vectorScores.get(bigintId) || 0;
          // Adaptive blending: when vector score is confident (>0.5), trust it more
          // When vector score is weak, rely more on BM25
          const vecWeight = vecScore > 0.5 ? 0.8 : (vecScore > 0.3 ? 0.6 : 0.3);
          const bm25Weight = 1 - vecWeight;
          const finalScore = bm25 * bm25Weight + vecScore * vecWeight;

          if (finalScore > 0.05 || vecScore > 0.3) {
            results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(finalScore * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: Math.round(bm25 * 1000) / 1000, _bm25: bm25, _vec: vecScore });
          }

          // Load embedding for reranking (lazy)
          if (hasVectors) {
            const embRow = db.prepare("SELECT embedding FROM episodic_embeddings WHERE rowid = ?").get(bigintId);
            if (embRow && embRow.embedding) candidateEmbeddings.set(mem.id, parseEmbedding(embRow.embedding));
          }

          const hs = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hs)), mem.id);
        }

        // Phase 3: Vector-only hits
        for (const [bigintRowid, vecScore] of vectorScores) {
          const memId = bigIntToHex(bigintRowid);
          if (!candidates.has(memId) && vecScore > 0.3) {
            const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND project = ? AND is_active = 1").get(memId, projectId);
            if (mem) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, relevance_score: Math.round(vecScore * 0.6 * 1000) / 1000, vector_score: Math.round(vecScore * 1000) / 1000, bm25_score: 0, _bm25: 0, _vec: vecScore });
          }
        }

        // Phase 4: Cross-encoder reranking of top candidates
        // Compute exact cosine similarity for top 20, then blend with BM25
        if (queryEmbedding && queryEmbedding.length === 384) {
          const cosSim = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
          // Sort by current score, take top 20 for reranking
          results.sort((a, b) => b.relevance_score - a.relevance_score);
          const topK = results.slice(0, 20);
          for (const r of topK) {
            const memEmb = candidateEmbeddings.get(r.id);
            if (memEmb && memEmb.length === 384) {
              const exactSim = cosSim(queryEmbedding, memEmb);
              // Blend: 30% BM25 + 30% exact cosine + 40% ANN vector (reduces ANN approximation error)
              const reranked = r._bm25 * 0.2 + exactSim * 0.5 + r._vec * 0.3;
              r.relevance_score = Math.round(reranked * 1000) / 1000;
              r.reranked = true;
            }
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
      // Clean up internal scoring fields from output
      const cleanResults = results.slice(0, limit).map(r => {
        const { _bm25, _vec, ...rest } = r;
        return rest;
      });
      return { content: [{ type: "text", text: JSON.stringify(cleanResults, null, 2) }] };
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
      if (hasVectors && table === "episodic_memories") try { db.prepare("DELETE FROM episodic_embeddings WHERE rowid = ?").run(hexToBigInt(args.memory_id)); } catch (e) { /* ignore */ }
      return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
    }
    if (name === "update_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
      if (hasVectors && table === "episodic_memories") {
        const emb = await generateEmbedding(args.new_content);
        storeEmbedding(db, args.memory_id, emb);
      }
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

    // ═══ v4 NEW: DECIDE ═══
    if (name === "decide") {
      const title = args.title, context = args.context, options = args.options || [], chosen = args.chosen_option, projectId = args.project || "default";
      const decId = generateId(title, "decision");
      const pastDecisions = db.prepare("SELECT * FROM decisions WHERE project = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 20").all(projectId);
      const relevantPast = pastDecisions.filter(d => calculateSimilarity(context, d.context || "") > 0.2 || calculateSimilarity(title, d.title) > 0.3);

      let contextEmbedding = null;
      let vectorScores = new Map();
      if (hasVectors) {
        contextEmbedding = await generateEmbedding(context);
        if (contextEmbedding && contextEmbedding.length === 384) {
          try {
            const vecRows = db.prepare("SELECT CAST(rowid AS TEXT) AS rowid_str, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(contextEmbedding));
            for (const vr of vecRows) vectorScores.set(BigInt(vr.rowid_str), 1 - vr.distance / 2);
          } catch (e) { /* ignore */ }
        }
      }

      const relevantMems = db.prepare("SELECT id, content, event_type, emotional_valence FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 50").all(projectId);
      const relevant = relevantMems.filter(m => {
        const keywordSim = calculateSimilarity(context, m.content);
        const bigintId = hexToBigInt(m.id);
        const vecSim = vectorScores.get(bigintId) || 0;
        const score = hasVectors && vecSim > 0 ? (keywordSim * 0.4 + vecSim * 0.6) : keywordSim;
        return score > 0.15;
      });

      const failures = relevant.filter(m => m.event_type === "error" || m.emotional_valence < -0.2);
      const successes = relevant.filter(m => m.event_type === "insight" || m.emotional_valence > 0.3);
      const preMortem = [];
      if (failures.length > 0) { preMortem.push("⚠️ PAST FAILURES TO WATCH:"); failures.slice(0, 3).forEach(f => preMortem.push("  - " + f.content.slice(0, 80))); }
      if (successes.length > 0) { preMortem.push("✅ PAST SUCCESSES TO LEARN FROM:"); successes.slice(0, 3).forEach(s => preMortem.push("  - " + s.content.slice(0, 80))); }
      if (relevantPast.length > 0) { preMortem.push("📋 RELEVANT PAST DECISIONS:"); relevantPast.slice(0, 3).forEach(d => preMortem.push("  - " + d.title + ": " + d.status + " (" + (d.lessons_learned || "no lessons") + ")")); }
      const counterfactuals = options.filter(o => o !== chosen).map(o => ({ option: o, risk: failures.length > 0 ? "Similar to past failure: " + failures[0].content.slice(0, 60) : "No direct past data", opportunity: successes.length > 0 ? "Similar to past success: " + successes[0].content.slice(0, 60) : "No direct past data" }));
      db.prepare("INSERT INTO decisions (id, title, context, options, chosen_option, status, project, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)").run(decId, title, context, JSON.stringify(options), chosen, projectId, now);
      for (const m of relevant.slice(0, 10)) { db.prepare("INSERT OR IGNORE INTO decision_memories (decision_id, memory_id, role) VALUES (?, ?, ?)").run(decId, m.id, "supporting"); }
      return { content: [{ type: "text", text: JSON.stringify({ decision_id: decId, title, chosen_option: chosen, pre_mortem: preMortem, counterfactuals, relevant_past_decisions: relevantPast.length, relevant_memories: relevant.length, recommendation: failures.length > successes.length ? "⚠️ CAUTION: More past failures than successes in similar contexts" : "✅ PROCEED: Past data supports this direction" }, null, 2) }] };
    }

    // ═══ v4 NEW: WHY (Causal Reasoning) ═══
    if (name === "why") {
      const situation = args.situation, maxDepth = args.max_depth || 5, projectId = args.project || "default";
      const allMems = db.prepare("SELECT id, content, event_type, emotional_valence, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at ASC").all(projectId);
      const relevant = allMems.filter(m => calculateSimilarity(situation, m.content) > 0.15).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const chain = [], visited = new Set();
      function traceBack(memory, depth) {
        if (depth <= 0 || visited.has(memory.id)) return;
        visited.add(memory.id);
        chain.push({ depth, id: memory.id, content: memory.content.slice(0, 100), type: memory.event_type, valence: memory.emotional_valence, when: memory.created_at });
        const earlier = allMems.filter(m => new Date(m.created_at) < new Date(memory.created_at) && calculateSimilarity(m.content, memory.content) > 0.1 && !visited.has(m.id));
        earlier.sort((a, b) => calculateSimilarity(b.content, memory.content) - calculateSimilarity(a.content, memory.content));
        if (earlier.length > 0) traceBack(earlier[0], depth - 1);
      }
      if (relevant.length > 0) traceBack(relevant[relevant.length - 1], maxDepth);
      const interventionPoints = chain.filter(m => m.type === "decision" || m.valence < -0.2);
      return { content: [{ type: "text", text: JSON.stringify({ situation, causal_chain: chain.reverse(), intervention_points: interventionPoints.map(m => ({ id: m.id, content: m.content, type: m.type, when: m.when })), root_cause: chain.length > 0 ? chain[0] : null, analysis: chain.length > 2 ? "Multi-step causal chain identified" : chain.length > 0 ? "Direct cause found" : "Insufficient memory to determine causality" }, null, 2) }] };
    }

    // ═══ v4 NEW: TRANSFER (Skill Transfer) ═══
    if (name === "transfer") {
      const skill = args.skill_description, targetDomain = args.target_domain, projectId = args.project || "default";
      const skills = db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId);
      const sourceSkill = skills.find(s => calculateSimilarity(skill, s.content) > 0.2 || calculateSimilarity(skill, s.title) > 0.3);
      const targetMems = db.prepare("SELECT id, content, event_type FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
      const targetRelevant = targetMems.filter(m => calculateSimilarity(targetDomain, m.content) > 0.15);
      const analogies = [];
      if (sourceSkill) {
        for (const tm of targetRelevant) {
          const structuralSim = calculateSimilarity(sourceSkill.content, tm.content);
          if (structuralSim > 0.1 && structuralSim < 0.7) {
            analogies.push({ source: sourceSkill.title, target_memory: tm.content.slice(0, 80), similarity: Math.round(structuralSim * 100) / 100, insight: "The pattern '" + sourceSkill.title.slice(0, 40) + "' from " + (sourceSkill.content.slice(0, 60) || "your experience") + " may apply to: " + tm.content.slice(0, 60) });
          }
        }
      }
      if (sourceSkill) {
        db.prepare("INSERT OR IGNORE INTO skill_domains (skill_id, domain, transfer_strength) VALUES (?, ?, ?)").run(sourceSkill.id, targetDomain, analogies.length > 0 ? 0.7 : 0.3);
      }
      return { content: [{ type: "text", text: JSON.stringify({ skill, target_domain: targetDomain, source_skill_found: !!sourceSkill, source_skill: sourceSkill ? sourceSkill.title : null, analogies_found: analogies.length, analogies: analogies.slice(0, 5), recommendation: analogies.length > 0 ? `Found ${analogies.length} analogous patterns. Consider how '${sourceSkill?.title}' applies to '${targetDomain}'.` : "No direct analogies found. Consider learning the target domain from scratch." }, null, 2) }] };
    }

    // ═══ v4 NEW: SELF_KNOWLEDGE (Emotional Intelligence) ═══
    if (name === "self_knowledge") {
      const projectId = args.project || "default", analysisType = args.analysis_type || "full";
      const mems = db.prepare("SELECT id, content, event_type, emotional_valence, emotional_arousal, salience, mood_tag, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at ASC").all(projectId);
      const result = { total_memories: mems.length };
      if (analysisType === "full" || analysisType === "patterns") {
        const moodCounts = {}, eventTypeCounts = {}, valenceByMonth = {};
        mems.forEach(m => {
          moodCounts[m.mood_tag] = (moodCounts[m.mood_tag] || 0) + 1;
          eventTypeCounts[m.event_type] = (eventTypeCounts[m.event_type] || 0) + 1;
          const month = m.created_at.slice(0, 7);
          if (!valenceByMonth[month]) valenceByMonth[month] = { total: 0, count: 0 };
          valenceByMonth[month].total += m.emotional_valence;
          valenceByMonth[month].count++;
        });
        result.mood_distribution = moodCounts;
        result.event_type_distribution = eventTypeCounts;
        result.emotional_trajectory = Object.entries(valenceByMonth).map(([m, v]) => ({ month: m, avg_valence: Math.round(v.total / v.count * 100) / 100 })).slice(-12);
      }
      if (analysisType === "full" || analysisType === "triggers") {
        const negativeMems = mems.filter(m => m.emotional_valence < -0.2);
        const positiveMems = mems.filter(m => m.emotional_valence > 0.2);
        const extractWords = (texts) => {
          const words = {};
          texts.forEach(t => t.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !["this","that","with","from","have","been","were","they","their","there","about","would","could","should"].includes(w)).forEach(w => words[w] = (words[w] || 0) + 1));
          return Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
        };
        result.negative_triggers = extractWords(negativeMems.map(m => m.content));
        result.positive_triggers = extractWords(positiveMems.map(m => m.content));
      }
      if (analysisType === "full" || analysisType === "energy") {
        const highEnergy = mems.filter(m => m.emotional_arousal > 0.3 && m.emotional_valence > 0);
        const lowEnergy = mems.filter(m => m.emotional_arousal < 0.1 && m.emotional_valence < 0);
        result.energy_patterns = { high_energy_count: highEnergy.length, low_energy_count: lowEnergy.length, high_energy_contexts: highEnergy.slice(0, 3).map(m => m.content.slice(0, 60)), low_energy_contexts: lowEnergy.slice(0, 3).map(m => m.content.slice(0, 60)) };
      }
      if (analysisType === "full" || analysisType === "correlations") {
        const decisions = mems.filter(m => m.event_type === "decision");
        const outcomes = mems.filter(m => m.event_type === "insight" || m.event_type === "error");
        result.decision_patterns = { total_decisions: decisions.length, positive_outcomes: outcomes.filter(o => o.emotional_valence > 0).length, negative_outcomes: outcomes.filter(o => o.emotional_valence < 0).length };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ═══ v4 NEW: KNOWLEDGE_GRAPH ═══
    if (name === "knowledge_graph") {
      const projectId = args.project || "default", action = args.action || "view";
      if (action === "view") {
        const nodes = db.prepare("SELECT * FROM knowledge_nodes WHERE is_active = 1 ORDER BY importance DESC").all();
        const edges = db.prepare("SELECT * FROM knowledge_edges ORDER BY weight DESC").all();
        return { content: [{ type: "text", text: JSON.stringify({ nodes, edges, stats: { nodes: nodes.length, edges: edges.length } }, null, 2) }] };
      }
      if (action === "gaps") {
        const gaps = db.prepare("SELECT kg.*, kn.label FROM knowledge_gaps kg JOIN knowledge_nodes kn ON kn.id = kg.node_id WHERE kg.resolved = 0 ORDER BY kg.priority DESC").all();
        return { content: [{ type: "text", text: JSON.stringify({ knowledge_gaps: gaps, count: gaps.length }, null, 2) }] };
      }
      if (action === "stats") {
        const nodeCount = db.prepare("SELECT COUNT(*) as c FROM knowledge_nodes WHERE is_active = 1").get().c;
        const edgeCount = db.prepare("SELECT COUNT(*) as c FROM knowledge_edges").get().c;
        const gapCount = db.prepare("SELECT COUNT(*) as c FROM knowledge_gaps WHERE resolved = 0").get().c;
        const avgMastery = db.prepare("SELECT AVG(mastery) as avg FROM knowledge_nodes WHERE is_active = 1").get().avg || 0;
        return { content: [{ type: "text", text: JSON.stringify({ nodes: nodeCount, edges: edgeCount, gaps: gapCount, avg_mastery: Math.round(avgMastery * 100) / 100 }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Unknown action" }), isError: true }] };
    }

    // ═══ v4 NEW: LEARN_PATH ═══
    if (name === "learn_path") {
      const goal = args.goal, projectId = args.project || "default";
      const nodes = db.prepare("SELECT * FROM knowledge_nodes WHERE is_active = 1 ORDER BY importance DESC").all();
      const goalNode = nodes.find(n => calculateSimilarity(goal, n.label) > 0.3 || calculateSimilarity(goal, n.description || "") > 0.3);
      const gaps = db.prepare("SELECT kg.*, kn.label, kn.description FROM knowledge_gaps kg JOIN knowledge_nodes kn ON kn.id = kg.node_id WHERE kg.resolved = 0 ORDER BY kg.priority DESC").all();
      const path = [];
      if (goalNode) {
        const prereqs = db.prepare("SELECT kn.* FROM knowledge_edges ke JOIN knowledge_nodes kn ON kn.id = ke.source_id WHERE ke.target_id = ? AND ke.edge_type = 'prerequisite' ORDER BY kn.mastery ASC").all(goalNode.id);
        prereqs.forEach(p => path.push({ step: path.length + 1, node: p.label, mastery: p.mastery, action: p.mastery < 0.3 ? "Learn fundamentals" : p.mastery < 0.7 ? "Deepen understanding" : "Review" }));
        path.push({ step: path.length + 1, node: goalNode.label, mastery: goalNode.mastery, action: "Goal" });
      } else {
        path.push({ step: 1, node: goal, mastery: 0, action: "New topic — start from fundamentals" });
        const related = nodes.filter(n => calculateSimilarity(goal, n.label) > 0.1).slice(0, 3);
        related.forEach((r, i) => path.push({ step: i + 2, node: r.label, mastery: r.mastery, action: "Related knowledge to build on" }));
      }
      return { content: [{ type: "text", text: JSON.stringify({ goal, path, knowledge_gaps: gaps.length, existing_nodes: nodes.length }, null, 2) }] };
    }

    // ═══ v4 NEW: ANTICIPATE ═══
    if (name === "anticipate") {
      const context = args.context, projectId = args.project || "default", limit = args.limit || 5;
      const contextEmb = await generateEmbedding(context);
      const allMems = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
      const scored = [];
      for (const mem of allMems) {
        let score = calculateSimilarity(context, mem.content);
        if (contextEmb && contextEmb.length === 384) {
          const memEmbRow = db.prepare("SELECT embedding FROM episodic_embeddings WHERE rowid = ?").get(hexToBigInt(mem.id));
          if (memEmbRow?.embedding) {
            const memEmb = parseEmbedding(memEmbRow.embedding);
            if (memEmb && memEmb.length === 384) {
              let dot = 0; for (let i = 0; i < 384; i++) dot += contextEmb[i] * memEmb[i];
              score = score * 0.3 + dot * 0.7;
            }
          }
        }
        if (score > 0.1) scored.push({ id: mem.id, content: mem.content.slice(0, 100), relevance: Math.round(score * 100) / 100, type: mem.event_type });
      }
      scored.sort((a, b) => b.relevance - a.relevance);
      const suggestions = scored.slice(0, limit);
      db.prepare("INSERT INTO context_snapshots (context_type, context_data, created_at) VALUES ('anticipate', ?, ?)").run(context, now);
      return { content: [{ type: "text", text: JSON.stringify({ context, suggestions, total_candidates: scored.length, message: suggestions.length > 0 ? "Based on your history, these memories may be relevant to your current context:" : "No highly relevant memories found for this context." }, null, 2) }] };
    }

    // ═══ v4 NEW: WARN ═══
    if (name === "warn") {
      const planned = args.planned_action, projectId = args.project || "default";
      let plannedEmbedding = null;
      let vectorScores = new Map();
      if (hasVectors) {
        plannedEmbedding = await generateEmbedding(planned);
        if (plannedEmbedding && plannedEmbedding.length === 384) {
          try {
            const vecRows = db.prepare("SELECT CAST(rowid AS TEXT) AS rowid_str, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(plannedEmbedding));
            for (const vr of vecRows) vectorScores.set(BigInt(vr.rowid_str), 1 - vr.distance / 2);
          } catch (e) { /* ignore */ }
        }
      }

      const failures = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND (event_type = 'error' OR emotional_valence < -0.2) ORDER BY created_at DESC LIMIT 20").all(projectId);
      
      const relevant = [];
      for (const f of failures) {
        const keywordSim = calculateSimilarity(planned, f.content);
        const bigintId = hexToBigInt(f.id);
        const vecSim = vectorScores.get(bigintId) || 0;
        const score = hasVectors && vecSim > 0 ? (keywordSim * 0.4 + vecSim * 0.6) : keywordSim;
        if (score > 0.15) {
          relevant.push({ f, score });
        }
      }

      const warnings = relevant.map(r => ({
        memory: r.f.content.slice(0, 100),
        type: r.f.event_type,
        when: r.f.created_at,
        similarity: Math.round(r.score * 100) / 100
      }));

      const decisions = db.prepare("SELECT * FROM decisions WHERE project = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 10").all(projectId);
      const relevantDecisions = decisions.filter(d => calculateSimilarity(planned, d.context || "") > 0.2);
      return { content: [{ type: "text", text: JSON.stringify({ planned_action: planned, warnings, failed_decisions: relevantDecisions.map(d => ({ title: d.title, lessons: d.lessons_learned })), risk_level: warnings.length > 0 ? "HIGH" : "LOW", recommendation: warnings.length > 0 ? `⚠️ ${warnings.length} past failures match this pattern. Review warnings before proceeding.` : "✅ No direct past failures match this pattern." }, null, 2) }] };
    }

    // ═══ v4 NEW: SHARE (Multi-Agent) ═══
    if (name === "share") {
      const memoryIds = args.memory_ids, toAgent = args.to_agent, trustLevel = args.trust_level || 0.5;
      const shared = [];
      for (const memId of memoryIds) {
        const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND is_active = 1").get(memId);
        if (mem) {
          const shareId = generateId(memId, "share");
          db.prepare("INSERT INTO shared_memories (id, memory_id, from_agent, to_agent, trust_score, shared_at) VALUES (?, ?, ?, ?, ?, ?)").run(shareId, memId, "self", toAgent, trustLevel, now);
          shared.push({ share_id: shareId, memory_id: memId, content_preview: mem.content.slice(0, 60) });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ shared_to: toAgent, memories_shared: shared.length, shared, trust_level: trustLevel }, null, 2) }] };
    }

    // ═══ v4 NEW: COLLECTIVE ═══
    if (name === "collective") {
      const query = args.query, limit = args.limit || 10;
      // Do our own recall inline
      const queryEntities = await extractEntitiesNER(query);
      const queryEmotion = detectEmotionalSalience(query);
      let queryEmbedding = null;
      if (hasVectors) queryEmbedding = await generateEmbedding(query);
      const ownResults = [];
      const allMems = db.prepare("SELECT * FROM episodic_memories WHERE is_active = 1").all();
      for (const mem of allMems) {
        let score = calculateSimilarity(query, mem.content);
        if (queryEmbedding && queryEmbedding.length === 384) {
          const memEmbRow = db.prepare("SELECT embedding FROM episodic_embeddings WHERE rowid = ?").get(hexToBigInt(mem.id));
          if (memEmbRow?.embedding) {
            const memEmb = parseEmbedding(memEmbRow.embedding);
            if (memEmb && memEmb.length === 384) { let dot = 0; for (let i = 0; i < 384; i++) dot += queryEmbedding[i] * memEmb[i]; score = score * 0.3 + dot * 0.7; }
          }
        }
        if (score > 0.1) ownResults.push({ id: mem.id, content: mem.content.slice(0, 80), relevance: Math.round(score * 100) / 100 });
      }
      ownResults.sort((a, b) => b.relevance - a.relevance);
      const sharedMems = db.prepare("SELECT sm.*, em.content FROM shared_memories sm JOIN episodic_memories em ON em.id = sm.memory_id WHERE sm.accepted = 1 ORDER BY sm.trust_score DESC LIMIT ?").all(limit);
      return { content: [{ type: "text", text: JSON.stringify({ query, own_results: ownResults.slice(0, limit), shared_from_agents: sharedMems.map(s => ({ from: s.from_agent, content: s.content.slice(0, 80), trust: s.trust_score })), total_knowledge: ownResults.length + sharedMems.length }, null, 2) }] };
    }

    // ═══ v4 NEW: TRUST ═══
    if (name === "trust") {
      const agentName = args.agent_name, domain = args.domain, trustScore = args.trust_score;
      const existing = db.prepare("SELECT * FROM agent_trust WHERE agent_name = ? AND domain = ?").get(agentName, domain);
      if (existing) {
        db.prepare("UPDATE agent_trust SET trust_score = ?, interactions = interactions + 1, last_interaction = ? WHERE agent_name = ? AND domain = ?").run(trustScore, now, agentName, domain);
      } else {
        db.prepare("INSERT INTO agent_trust (agent_name, domain, trust_score, interactions, last_interaction) VALUES (?, ?, ?, 1, ?)").run(agentName, domain, trustScore, now);
      }
      return { content: [{ type: "text", text: JSON.stringify({ agent: agentName, domain: domain || "general", trust_score: trustScore, previous_trust: existing?.trust_score || null, status: trustScore > 0.7 ? "TRUSTED" : trustScore > 0.4 ? "NEUTRAL" : "UNTRUSTED" }, null, 2) }] };
    }

    // ═══ v4 NEW: CODE_REVIEW ═══
    if (name === "code_review") {
      const filePath = args.file_path, changeDesc = args.change_description, projectId = args.project || "default";
      const pastBugs = db.prepare("SELECT * FROM code_bugs WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 20").all(projectId);
      const relevantBugs = pastBugs.filter(b => calculateSimilarity(changeDesc, b.description) > 0.15 || filePath.includes(b.file_path || ""));
      const pastReviews = db.prepare("SELECT * FROM code_reviews WHERE project = ? ORDER BY created_at DESC LIMIT 10").all(projectId);
      const relevantReviews = pastReviews.filter(r => calculateSimilarity(changeDesc, r.change_description || "") > 0.15 || filePath.includes(r.file_path || ""));
      const patterns = db.prepare("SELECT * FROM code_patterns WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 10").all(projectId);
      const relevantPatterns = patterns.filter(p => calculateSimilarity(changeDesc, p.description) > 0.15);
      const mems = db.prepare("SELECT id, content, event_type FROM episodic_memories WHERE project = ? AND is_active = 1 AND event_type = 'error' ORDER BY created_at DESC LIMIT 20").all(projectId);
      const relevantMems = mems.filter(m => calculateSimilarity(changeDesc, m.content) > 0.15);
      
      // Look up linked memories for functions defined in this file
      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      const fileFunctions = db.prepare("SELECT id, name FROM code_nodes WHERE filepath = ? AND node_type = 'function'").all(relPath);
      const linkedMemories = [];
      for (const fn of fileFunctions) {
        const links = db.prepare(`SELECT em.content, em.event_type FROM episodic_memories em 
                                  JOIN memory_code_links mcl ON mcl.memory_id = em.id 
                                  WHERE mcl.code_node_id = ? AND em.is_active = 1`).all(fn.id);
        for (const l of links) {
          linkedMemories.push({ function_name: fn.name, memory: l.content, event_type: l.event_type });
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({ file_path: filePath, change: changeDesc, warnings: relevantBugs.map(b => ({ type: b.bug_type, description: b.description.slice(0, 100), file: b.file_path, resolution: b.resolution })), past_similar_reviews: relevantReviews.map(r => ({ file: r.file_path, issues: r.issues_found, suggestions: r.suggestions })), relevant_patterns: relevantPatterns.map(p => ({ type: p.pattern_type, description: p.description.slice(0, 100) })), related_failures: relevantMems.map(m => m.content.slice(0, 80)), linked_memories: linkedMemories, risk_score: (relevantBugs.length * 0.3 + relevantMems.length * 0.2 + linkedMemories.length * 0.2) > 1 ? "HIGH" : relevantBugs.length > 0 ? "MEDIUM" : "LOW" }, null, 2) }] };
    }

    // ═══ v4 NEW: CODE_PATTERN ═══
    if (name === "code_pattern") {
      const action = args.action || "retrieve", projectId = args.project || "default";
      if (action === "store") {
        const patId = generateId(args.description || args.pattern_type, "pattern");
        db.prepare("INSERT OR REPLACE INTO code_patterns (id, pattern_type, description, code_snippet, language, file_path, project, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(patId, args.pattern_type, args.description, args.code_snippet || null, args.language || null, args.file_path || null, projectId, now);
        return { content: [{ type: "text", text: JSON.stringify({ stored: true, pattern_id: patId }, null, 2) }] };
      }
      const patterns = db.prepare("SELECT * FROM code_patterns WHERE project = ? AND is_active = 1 ORDER BY created_at DESC").all(projectId);
      const relevant = args.description ? patterns.filter(p => calculateSimilarity(args.description, p.description) > 0.15) : patterns;
      return { content: [{ type: "text", text: JSON.stringify({ patterns: relevant.slice(0, 20), total: patterns.length }, null, 2) }] };
    }

    // ═══ v4 NEW: INDEX_CODEBASE ═══
    if (name === "index_codebase") {
      const scanPath = args.scan_path, projectId = args.project || "default";
      if (!fs.existsSync(scanPath)) {
        return { content: [{ type: "text", text: `Path not found: ${scanPath}` }], isError: true };
      }
      
      const fileList = [];
      function scanDirectory(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            if (!["node_modules", ".git", ".venv", "dist", "build", "graphify-out"].includes(file)) {
              scanDirectory(filePath);
            }
          } else {
            if (/\.(js|jsx|ts|tsx|py|json|md)$/i.test(file)) {
              fileList.push(filePath);
            }
          }
        }
      }
      
      const stats = fs.statSync(scanPath);
      if (stats.isDirectory()) {
        scanDirectory(scanPath);
      } else {
        fileList.push(scanPath);
      }

      const knownFuncs = new Map();
      const nowTime = new Date().toISOString();

      // Pass 1: Extract nodes (files, classes, functions)
      for (const filePath of fileList) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
          
          // Insert file node
          db.prepare(`INSERT OR REPLACE INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
                      VALUES (?, ?, 'file', ?, ?, ?, ?, ?)`).run(relPath, path.basename(filePath), relPath, content.slice(0, 10000), projectId, nowTime, nowTime);

          // Parse JS/TS structure
          if (/\.(js|jsx|ts|tsx)$/i.test(filePath)) {
            const classRegex = /class\s+([A-Za-z0-9_$]+)/g;
            let m;
            while ((m = classRegex.exec(content)) !== null) {
              const className = m[1];
              const classId = `${relPath}::class::${className}`;
              db.prepare(`INSERT OR REPLACE INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
                          VALUES (?, ?, 'class', ?, ?, ?, ?, ?)`).run(classId, className, relPath, `Class ${className}`, projectId, nowTime, nowTime);
              db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                          VALUES (?, ?, 'defines', ?)`).run(relPath, classId, nowTime);
            }

            const functionRegexes = [
              /function\s+([A-Za-z0-9_$]+)\s*\(/g,
              /async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
              /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g
            ];
            for (const regex of functionRegexes) {
              let m2;
              while ((m2 = regex.exec(content)) !== null) {
                const funcName = m2[1];
                if (["if","for","while","switch","catch","function"].includes(funcName)) continue;
                const funcId = `${relPath}::function::${funcName}`;
                knownFuncs.set(funcName, funcId);
                db.prepare(`INSERT OR REPLACE INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
                            VALUES (?, ?, 'function', ?, ?, ?, ?, ?)`).run(funcId, funcName, relPath, `Function ${funcName}`, projectId, nowTime, nowTime);
                db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                            VALUES (?, ?, 'defines', ?)`).run(relPath, funcId, nowTime);
              }
            }

            const importRegexes = [
              /require\(['"]([^'"]+)['"]\)/g,
              /import\s+.*\s+from\s+['"]([^'"]+)['"]/g
            ];
            for (const regex of importRegexes) {
              let m3;
              while ((m3 = regex.exec(content)) !== null) {
                const target = m3[1];
                let targetId = target;
                if (target.startsWith(".")) {
                  const absoluteTarget = path.resolve(path.dirname(filePath), target);
                  let targetPath = absoluteTarget;
                  if (!fs.existsSync(targetPath)) {
                    for (const ext of [".js", ".ts", "/index.js", "/index.ts"]) {
                      if (fs.existsSync(absoluteTarget + ext)) {
                        targetPath = absoluteTarget + ext;
                        break;
                      }
                    }
                  }
                  targetId = path.relative(process.cwd(), targetPath).replace(/\\/g, "/");
                }
                db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                            VALUES (?, ?, 'imports', ?)`).run(relPath, targetId, nowTime);
              }
            }
          }

          // Parse Python structure
          if (/\.py$/i.test(filePath)) {
            const classRegex = /class\s+([A-Za-z0-9_$]+)/g;
            let m;
            while ((m = classRegex.exec(content)) !== null) {
              const className = m[1];
              const classId = `${relPath}::class::${className}`;
              db.prepare(`INSERT OR REPLACE INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
                          VALUES (?, ?, 'class', ?, ?, ?, ?, ?)`).run(classId, className, relPath, `Class ${className}`, projectId, nowTime, nowTime);
              db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                          VALUES (?, ?, 'defines', ?)`).run(relPath, classId, nowTime);
            }

            const functionRegex = /def\s+([A-Za-z0-9_$]+)\s*\(/g;
            let m2;
            while ((m2 = functionRegex.exec(content)) !== null) {
              const funcName = m2[1];
              const funcId = `${relPath}::function::${funcName}`;
              knownFuncs.set(funcName, funcId);
              db.prepare(`INSERT OR REPLACE INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
                          VALUES (?, ?, 'function', ?, ?, ?, ?, ?)`).run(funcId, funcName, relPath, `Function ${funcName}`, projectId, nowTime, nowTime);
              db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                          VALUES (?, ?, 'defines', ?)`).run(relPath, funcId, nowTime);
            }

            const importRegexes = [
              /import\s+([A-Za-z0-9_$.]+)/g,
              /from\s+([A-Za-z0-9_$.]+)\s+import/g
            ];
            for (const regex of importRegexes) {
              let m3;
              while ((m3 = regex.exec(content)) !== null) {
                db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                            VALUES (?, ?, 'imports', ?)`).run(relPath, m3[1], nowTime);
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // Pass 2: Extract function call relationships
      for (const filePath of fileList) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
          const lines = content.split('\n');
          let currentFunc = null;
          let braceDepth = 0;
          let currentIndent = -1;

          const jsFunctionRegexes = [
            /function\s+([A-Za-z0-9_$]+)\s*\(/,
            /async\s+function\s+([A-Za-z0-9_$]+)\s*\(/,
            /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/
          ];

          for (const line of lines) {
            if (/\.(js|jsx|ts|tsx)$/i.test(filePath)) {
              let funcDefMatch = null;
              for (const regex of jsFunctionRegexes) {
                const m = regex.exec(line);
                if (m) {
                  funcDefMatch = m[1];
                  break;
                }
              }

              if (funcDefMatch && !["if","for","while","switch","catch","function"].includes(funcDefMatch)) {
                currentFunc = `${relPath}::function::${funcDefMatch}`;
                braceDepth = 0;
              }

              const openBraces = (line.match(/\{/g) || []).length;
              const closeBraces = (line.match(/\}/g) || []).length;
              braceDepth += openBraces - closeBraces;

              const callerId = currentFunc || relPath;

              if (currentFunc && braceDepth <= 0 && closeBraces > 0) {
                currentFunc = null;
              }

              for (const [funcName, funcId] of knownFuncs.entries()) {
                const callRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
                if (callRegex.test(line) && callerId !== funcId) {
                  db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                              VALUES (?, ?, 'calls', ?)`).run(callerId, funcId, nowTime);
                }
              }
            }

            if (/\.py$/i.test(filePath)) {
              const indentMatch = line.match(/^(\s*)/);
              const indent = indentMatch ? indentMatch[1].length : 0;
              
              if (line.trim().startsWith("def ")) {
                const defMatch = line.match(/def\s+([A-Za-z0-9_$]+)\s*\(/);
                if (defMatch) {
                  currentFunc = `${relPath}::function::${defMatch[1]}`;
                  currentIndent = indent;
                }
              } else if (currentFunc && indent <= currentIndent && line.trim().length > 0) {
                currentFunc = null;
                currentIndent = -1;
              }

              const callerId = currentFunc || relPath;

              for (const [funcName, funcId] of knownFuncs.entries()) {
                const callRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
                if (callRegex.test(line) && callerId !== funcId) {
                  db.prepare(`INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, created_at)
                              VALUES (?, ?, 'calls', ?)`).run(callerId, funcId, nowTime);
                }
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }

      const totalNodes = db.prepare("SELECT COUNT(*) as c FROM code_nodes WHERE project = ?").get(projectId).c;
      const totalEdges = db.prepare("SELECT COUNT(*) as c FROM code_edges").get().c;
      return { content: [{ type: "text", text: JSON.stringify({ indexed: true, files_scanned: fileList.length, total_nodes: totalNodes, total_edges: totalEdges }, null, 2) }] };
    }

    // ═══ v4 NEW: QUERY_CODEBASE ═══
    if (name === "query_codebase") {
      const query = args.query, nodeType = args.node_type || "all", projectId = args.project || "default";
      let rows;
      if (nodeType === "all") {
        rows = db.prepare("SELECT * FROM code_nodes WHERE project = ? AND (name LIKE ? OR filepath LIKE ?) ORDER BY name LIMIT 50")
                  .all(projectId, `%${query}%`, `%${query}%`);
      } else {
        rows = db.prepare("SELECT * FROM code_nodes WHERE project = ? AND node_type = ? AND (name LIKE ? OR filepath LIKE ?) ORDER BY name LIMIT 50")
                  .all(projectId, nodeType, `%${query}%`, `%${query}%`);
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }

    // ═══ v4 NEW: CODE_PATH ═══
    if (name === "code_path") {
      const fromNode = args.from_node, toNode = args.to_node, projectId = args.project || "default";
      const visited = new Set();
      const queue = [[fromNode, []]];
      let pathResult = null;

      while (queue.length > 0) {
        const [curr, pathArray] = queue.shift();
        if (curr === toNode) {
          pathResult = pathArray;
          break;
        }

        if (visited.has(curr)) continue;
        visited.add(curr);

        const edges = db.prepare("SELECT target_id, edge_type FROM code_edges WHERE source_id = ?").all(curr);
        for (const edge of edges) {
          if (!visited.has(edge.target_id)) {
            queue.push([edge.target_id, [...pathArray, { source: curr, target: edge.target_id, type: edge.edge_type }]]);
          }
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({ path: pathResult || [], found: !!pathResult }, null, 2) }] };
    }

    // ═══ v4 NEW: CLUSTER_CODEBASE ═══
    if (name === "cluster_codebase") {
      const projectId = args.project || "default";
      const nodes = db.prepare("SELECT id FROM code_nodes WHERE project = ?").all(projectId).map(n => n.id);
      const edges = db.prepare("SELECT source_id, target_id FROM code_edges").all();
      
      if (nodes.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ message: "No code nodes to cluster. Run index_codebase first." }, null, 2) }] };
      }

      const adj = new Map();
      for (const n of nodes) adj.set(n, []);
      for (const e of edges) {
        if (adj.has(e.source_id)) adj.get(e.source_id).push(e.target_id);
        if (adj.has(e.target_id)) adj.get(e.target_id).push(e.source_id);
      }

      const labels = new Map();
      for (const n of nodes) labels.set(n, n);

      let changed = true;
      for (let iter = 0; iter < 10 && changed; iter++) {
        changed = false;
        const shuffled = [...nodes].sort(() => Math.random() - 0.5);
        for (const node of shuffled) {
          const neighbors = adj.get(node) || [];
          if (neighbors.length === 0) continue;
          
          const counts = new Map();
          for (const neigh of neighbors) {
            const l = labels.get(neigh);
            counts.set(l, (counts.get(l) || 0) + 1);
          }
          
          let maxCount = -1;
          let bestLabel = labels.get(node);
          for (const [l, count] of counts.entries()) {
            if (count > maxCount) {
              maxCount = count;
              bestLabel = l;
            }
          }
          
          if (labels.get(node) !== bestLabel) {
            labels.set(node, bestLabel);
            changed = true;
          }
        }
      }

      const groups = new Map();
      for (const [node, label] of labels.entries()) {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(node);
      }

      const communities = {};
      let cid = 0;
      for (const [label, members] of groups.entries()) {
        communities[`community_${cid++}`] = members;
      }

      return { content: [{ type: "text", text: JSON.stringify({ communities, total_communities: Object.keys(communities).length }, null, 2) }] };
    }

    // ═══ v4 NEW: ANTICIPATE_RESONANT (Tesla Resonant Context) ═══
    if (name === "anticipate_resonant") {
      const nodeId = args.node_id, projectId = args.project || "default";
      const limit = args.limit || 5, maxDepth = args.max_depth || 2;
      
      const queue = [[nodeId, 0]];
      const visited = new Set();
      const nodeDistances = new Map();
      
      while (queue.length > 0) {
        const [curr, depth] = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);
        nodeDistances.set(curr, depth);
        
        if (depth < maxDepth) {
          const edges = db.prepare("SELECT target_id FROM code_edges WHERE source_id = ?").all(curr);
          for (const edge of edges) {
            if (!visited.has(edge.target_id)) {
              queue.push([edge.target_id, depth + 1]);
            }
          }
        }
      }

      const resonantMemories = [];
      const seenMemIds = new Set();

      for (const [currNodeId, depth] of nodeDistances.entries()) {
        const weight = depth === 0 ? 1.0 : (depth === 1 ? 1.0 : 0.5);
        const links = db.prepare(`SELECT mcl.link_type, em.* FROM memory_code_links mcl
                                  JOIN episodic_memories em ON em.id = mcl.memory_id
                                  WHERE mcl.code_node_id = ? AND em.project = ? AND em.is_active = 1`).all(currNodeId, projectId);
        
        for (const link of links) {
          if (!seenMemIds.has(link.id)) {
            seenMemIds.add(link.id);
            const score = link.strength * weight;
            resonantMemories.push({
              id: link.id,
              content: link.content,
              event_type: link.event_type,
              proximity_depth: depth,
              proximity_weight: weight,
              original_strength: link.strength,
              resonant_strength: Math.round(score * 100) / 100
            });
          }
        }
      }

      resonantMemories.sort((a, b) => b.resonant_strength - a.resonant_strength);
      const suggestions = resonantMemories.slice(0, limit);

      return { content: [{ type: "text", text: JSON.stringify({ node_id: nodeId, traversed_nodes: nodeDistances.size, memories_found: resonantMemories.length, suggestions }, null, 2) }] };
    }

    // ═══ v4 NEW: INJECT_ACTIVATION (Spreading Activation Context) ═══
    if (name === "inject_activation") {
      const nodeId = args.node_id, projectId = args.project || "default";
      const energy = args.energy !== undefined ? args.energy : 10.0;
      const decayFactor = args.decay_factor !== undefined ? args.decay_factor : 0.1;
      const threshold = args.threshold !== undefined ? args.threshold : 1.0;
      const maxDepth = args.max_depth !== undefined ? args.max_depth : 2;

      // 1. Decaying all existing activation levels of other nodes in the same project first
      db.prepare(`
        UPDATE code_node_activation 
        SET activation = activation * (1.0 - ?) 
        WHERE node_id IN (SELECT id FROM code_nodes WHERE project = ?)
      `).run(decayFactor, projectId);

      // 2. Perform BFS to propagate energy
      const queue = [[nodeId, energy, 0]];
      const visited = new Set();
      const nodeEnergies = new Map();

      while (queue.length > 0) {
        const [curr, currEnergy, depth] = queue.shift();
        if (visited.has(curr)) continue;
        visited.add(curr);

        // Get existing activation level
        const row = db.prepare("SELECT activation FROM code_node_activation WHERE node_id = ?").get(curr);
        const existing = row ? row.activation : 0.0;
        const targetEnergy = existing + currEnergy;
        nodeEnergies.set(curr, targetEnergy);

        // Update database activation level
        const now = Date.now();
        db.prepare(`
          INSERT INTO code_node_activation (node_id, activation, last_updated)
          VALUES (?, ?, ?)
          ON CONFLICT(node_id) DO UPDATE SET activation = excluded.activation, last_updated = excluded.last_updated
        `).run(curr, targetEnergy, now);

        if (depth < maxDepth) {
          const nextEnergy = currEnergy * (1.0 - decayFactor);
          if (nextEnergy > 0.1) {
            const edges = db.prepare("SELECT target_id, weight FROM code_edges WHERE source_id = ?").all(curr);
            for (const edge of edges) {
              if (!visited.has(edge.target_id)) {
                queue.push([edge.target_id, nextEnergy * (edge.weight || 1.0), depth + 1]);
              }
            }
          }
        }
      }

      // 3. Find and return memories connected to nodes that have spiked above the threshold
      const spikedMemories = [];
      const seenMemIds = new Set();

      const activatedNodes = db.prepare(`
        SELECT cna.node_id, cna.activation, cn.name, cn.filepath
        FROM code_node_activation cna
        JOIN code_nodes cn ON cn.id = cna.node_id
        WHERE cna.activation > ? AND cn.project = ?
      `).all(threshold, projectId);

      for (const node of activatedNodes) {
        const links = db.prepare(`
          SELECT mcl.link_type, em.* FROM memory_code_links mcl
          JOIN episodic_memories em ON em.id = mcl.memory_id
          WHERE mcl.code_node_id = ? AND em.project = ? AND em.is_active = 1
        `).all(node.node_id, projectId);

        for (const link of links) {
          if (!seenMemIds.has(link.id)) {
            seenMemIds.add(link.id);
            spikedMemories.push({
              id: link.id,
              content: link.content,
              event_type: link.event_type,
              node_id: node.node_id,
              node_name: node.name,
              node_filepath: node.filepath,
              activation: Math.round(node.activation * 100) / 100
            });
          }
        }
      }

      spikedMemories.sort((a, b) => b.activation - a.activation);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            starting_node: nodeId,
            energy_injected: energy,
            activated_nodes_count: nodeEnergies.size,
            spiked_memories_found: spikedMemories.length,
            spiked_memories: spikedMemories
          }, null, 2)
        }]
      };
    }

    // ═══ v4 NEW: LEARN_FROM_ERROR (Acetylcholine Surprise-Gated Loop) ═══
    if (name === "learn_from_error") {
      const errorMessage = args.error_message;
      const command = args.command || "unknown";
      const projectId = args.project || "default";
      const surprise = args.surprise_score !== undefined ? args.surprise_score : 0.8;

      // 1. Stack trace parsing heuristics (supporting Javascript, Python, and generic logs)
      let filepath = "";
      let lineNumber = 0;
      let functionName = "";

      const jsPatt1 = /at\s+([^\s(]+)\s+\(([^:]+):(\d+):(\d+)\)/;
      const jsPatt2 = /at\s+([^:]+):(\d+):(\d+)/;
      const pyPatt = /File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(\w+)/;
      const genericPatt = /^([^:\n]+):(\d+):(\d+):/;

      let match = errorMessage.match(jsPatt1);
      if (match) {
        functionName = match[1];
        filepath = match[2];
        lineNumber = parseInt(match[3], 10);
      } else {
        match = errorMessage.match(jsPatt2);
        if (match) {
          filepath = match[1];
          lineNumber = parseInt(match[2], 10);
        } else {
          match = errorMessage.match(pyPatt);
          if (match) {
            filepath = match[1];
            lineNumber = parseInt(match[2], 10);
            functionName = match[3];
          } else {
            match = errorMessage.match(genericPatt);
            if (match) {
              filepath = match[1];
              lineNumber = parseInt(match[2], 10);
            }
          }
        }
      }

      if (filepath) {
        filepath = filepath.replace(/\\/g, "/").trim();
        if (filepath.includes("/")) {
          const parts = filepath.split("/");
          filepath = parts.slice(-2).join("/");
        }
      } else {
        filepath = "unknown_file";
      }

      if (!functionName) {
        functionName = "anonymous";
      }

      let targetNodeId = `${filepath}::function::${functionName}`;
      if (functionName === "anonymous") {
        targetNodeId = `${filepath}::file::${filepath}`;
      }

      const nodeCheck = db.prepare("SELECT id FROM code_nodes WHERE id = ?").get(targetNodeId);
      if (!nodeCheck) {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          targetNodeId,
          functionName === "anonymous" ? filepath : functionName,
          functionName === "anonymous" ? "file" : "function",
          filepath,
          `Auto-registered via learn_from_error tool`,
          projectId,
          now,
          now
        );
      }

      const memoryContent = `CRITICAL EXCEPTION [Command: ${command}]: ${errorMessage.slice(0, 500)}`;
      const emotional = detectEmotionalSalience(memoryContent);
      const nowStr = new Date().toISOString();
      const memoryId = crypto.randomBytes(8).toString("hex");

      const emotionalArousal = Math.max(0.8, emotional.arousal);
      const salience = Math.max(0.9, emotional.salience);
      const strength = surprise;

      db.prepare(`
        INSERT INTO episodic_memories (
          id, content, event_type, created_at, updated_at, project,
          emotional_valence, emotional_arousal, salience, strength,
          developmental_stage, access_count, last_accessed, next_review, review_interval
        ) VALUES (?, ?, 'error', ?, ?, ?, -0.5, ?, ?, ?, 'raw', 1, ?, ?, 1.0)
      `).run(
        memoryId,
        memoryContent,
        nowStr,
        nowStr,
        projectId,
        emotionalArousal,
        salience,
        strength,
        nowStr,
        calculateNextReview(strength, 1, 0.5, "raw")
      );

      if (hasVectors) {
        try {
          const embedder = getEmbedder();
          const embedding = embedder(memoryContent);
          const buf = Float32Array.from(embedding);
          db.prepare("INSERT INTO episodic_embeddings (rowid, embedding) VALUES (?, ?)").run(memoryId, buf);
        } catch (embErr) {
          console.error("Vector embedding failed in learn_from_error:", embErr.message);
        }
      }

      db.prepare(`
        INSERT INTO memory_code_links (memory_id, code_node_id, link_type)
        VALUES (?, ?, 'caused_bug')
        ON CONFLICT(memory_id, code_node_id) DO UPDATE SET link_type = excluded.link_type
      `).run(memoryId, targetNodeId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "success",
            surprise_metric: surprise,
            parsed_stack: {
              filepath: filepath,
              line_number: lineNumber,
              function_name: functionName
            },
            registered_code_node: targetNodeId,
            stored_memory: {
              id: memoryId,
              content: memoryContent,
              emotional_arousal: emotionalArousal,
              salience: salience,
              strength: strength
            }
          }, null, 2)
        }]
      };
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
  // Warmup NER model in background (non-blocking)
  warmupNER();
  console.error(`OWL Memory MCP v4.0 — Anticipatory Memory Engine ${hasVectors ? "+ vector embeddings" : "(no vector extension)"} ${hasNER ? "+ NER entity extraction" : "(NER loading...)"} running on stdio`);
}

main().catch(console.error);
