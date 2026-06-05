/**
 * OWL Memory MCP v3 — The Memory the Human Brain Wishes It Had
 *
 * Built from first principles by studying human memory in depth:
 *
 * FROM INFANT LEARNING:
 *   - Statistical learning: detect patterns across experiences
 *   - Sensory-motor loops: learn by doing, not just storing
 *   - Developmental stages: raw → structured → consolidated → abstracted
 *
 * FROM EXPERT MEMORY:
 *   - Chunking: experts see patterns, not individual pieces
 *   - Long-term working memory: experts hold more in active context
 *   - Skill transfer: expertise in one domain accelerates another
 *
 * FROM FALSE MEMORY RESEARCH:
 *   - Every recall modifies the memory (reconsolidation)
 *   - Source monitoring: did I experience this or hear about it?
 *   - Mutation tracking: full audit trail of belief changes
 *
 * FROM BODY/SOMATIC MEMORY:
 *   - Emotional residue persists after content fades
 *   - "I don't remember why, but I distrust this person"
 *   - Implicit associations without explicit reasoning
 *
 * FROM COLLECTIVE MEMORY:
 *   - Transactive memory: "I know who knows"
 *   - Shared narratives shape individual recall
 *   - Distributed knowledge across agents
 *
 * FROM DREAM RESEARCH:
 *   - Emotional regulation through consolidation
 *   - Threat simulation: rehearse dangerous scenarios
 *   - Creativity: novel combinations of existing memories
 *
 * FROM FORGETTING RESEARCH:
 *   - Forgetting is adaptive, not a bug
 *   - Prevents interference between similar memories
 *   - Enables generalization (forget details, keep patterns)
 *
 * FROM PRIMING RESEARCH:
 *   - Spreading activation through semantic network
 *   - Mood-congruent memory: happy memories when happy
 *   - Context-dependent recall: same state → better recall
 *
 * NOVEL FEATURES (exist in NO other memory MCP):
 *   1. Somatic memory (emotional residue)
 *   2. Developmental memory stages
 *   3. Memory mutation tracking
 *   4. Transactive/distributed memory
 *   5. Adaptive forgetting engine
 *   6. Predictive/anticipatory retrieval
 *   7. Threat simulation
 *   8. Mood-congruent retrieval
 *   9. Sensory memory layers
 *   10. Session checkpoint/resume
 *   11. Memory graph visualization (MCP resources)
 *   12. Counterfactual reasoning ("imagine")
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

// ─── Vector Embeddings (sqlite-vec + local model) ───────────────────────────
let sqliteVecLoaded = false;
let embedder = null;
let embedderLoading = null;

function loadSqliteVec(db) {
  if (sqliteVecLoaded) return true;
  try {
    const vecPath = path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll');
    if (fs.existsSync(vecPath)) {
      db.loadExtension(vecPath);
      sqliteVecLoaded = true;
      return true;
    }
  } catch (e) {
    console.error('sqlite-vec load failed:', e.message);
  }
  return false;
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;
  embedderLoading = (async () => {
    try {
      const { pipeline } = await import('@xenova/transformers');
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
      console.error('Embedding model loaded: Xenova/all-MiniLM-L6-v2 (384 dims)');
      return embedder;
    } catch (e) {
      console.error('Embedding model load failed:', e.message);
      embedderLoading = null;
      return null;
    }
  })();
  return embedderLoading;
}

async function generateEmbedding(text) {
  const model = await getEmbedder();
  if (!model) return null;
  try {
    const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (e) {
    console.error('Embedding generation failed:', e.message);
    return null;
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DB_PATH =
  process.env.OWL_MEMORY_DB ||
  path.join(require("os").homedir(), ".owl-memory", "memory-v3.db");
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// Load sqlite-vec extension and create vector index
const hasVectors = loadSqliteVec(db);
if (hasVectors) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(
      memory_id INTEGER PRIMARY KEY,
      embedding float[384]
    );
  `);
}

db.exec(`
    -- ═══════════════════════════════════════════════════════════════════════
    -- EPISODIC MEMORY — Specific events with full context + mutation tracking
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        event_type TEXT DEFAULT 'observation',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        event_timestamp TEXT,
        project TEXT DEFAULT 'default',
        location TEXT,
        -- Emotional tagging (amygdala)
        emotional_valence REAL DEFAULT 0,
        emotional_arousal REAL DEFAULT 0,
        salience REAL DEFAULT 0.5,
        -- Somatic residue (persists after content fades)
        somatic_weight REAL DEFAULT 0,
        somatic_valence REAL DEFAULT 0,
        -- Memory strength (spacing effect + developmental stage)
        strength REAL DEFAULT 1.0,
        developmental_stage TEXT DEFAULT 'raw',
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        next_review TEXT,
        review_interval REAL DEFAULT 1.0,
        -- Source & provenance (for false memory detection)
        source TEXT DEFAULT 'conversation',
        source_path TEXT,
        source_hash TEXT,
        source_reliability REAL DEFAULT 0.8,
        confidence REAL DEFAULT 0.8,
        is_experiential INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        is_consolidated INTEGER DEFAULT 0,
        -- Working memory
        is_in_working_memory INTEGER DEFAULT 0,
        working_memory_position INTEGER,
        -- Sensory layer
        sensory_type TEXT DEFAULT 'text',
        sensory_fidelity REAL DEFAULT 1.0,
        -- Mood context for mood-congruent retrieval
        mood_tag TEXT,
        metadata TEXT DEFAULT '{}'
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- MEMORY MUTATION TRACKING — Full audit trail of changes
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS memory_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL,
        previous_content TEXT,
        new_content TEXT,
        previous_confidence REAL,
        new_confidence REAL,
        previous_stage TEXT,
        new_stage TEXT,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES episodic_memories(id)
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- SEMANTIC MEMORY — Consolidated knowledge, schemas, concepts
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS semantic_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        concept_type TEXT DEFAULT 'fact',
        schema_id TEXT,
        schema_name TEXT,
        abstraction_level INTEGER DEFAULT 0,
        source_episodes TEXT DEFAULT '[]',
        project TEXT DEFAULT 'default',
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8,
        verification_count INTEGER DEFAULT 0,
        contradiction_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}'
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- PROCEDURAL MEMORY — Skills, habits, action sequences
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS procedural_memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        trigger_conditions TEXT DEFAULT '[]',
        action_sequence TEXT DEFAULT '[]',
        mastery_level REAL DEFAULT 0.1,
        practice_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_practiced TEXT,
        transfer_skills TEXT DEFAULT '[]',
        decay_rate REAL DEFAULT 0.01,
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}'
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- SOMATIC MEMORY — Emotional residue that persists after content fades
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS somatic_memories (
        id TEXT PRIMARY KEY,
        entity_name TEXT NOT NULL,
        entity_type TEXT DEFAULT 'general',
        somatic_valence REAL DEFAULT 0,
        somatic_arousal REAL DEFAULT 0,
        somatic_weight REAL DEFAULT 0.5,
        source_episodes TEXT DEFAULT '[]',
        last_triggered TEXT,
        trigger_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        note TEXT
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- TRANSATIVE MEMORY — "I know who knows" (distributed knowledge)
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS transactive_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        expertise_level REAL DEFAULT 0.5,
        last_verified TEXT,
        trust_level REAL DEFAULT 0.8,
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_name, domain, project)
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- PREDICTIVE MEMORY — Anticipatory retrieval patterns
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS predictive_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_context TEXT NOT NULL,
        predicted_need TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        hit_count INTEGER DEFAULT 0,
        miss_count INTEGER DEFAULT 0,
        last_triggered TEXT,
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- THREAT SIMULATION — Danger forecasting based on past failures
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS threat_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_name TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger_conditions TEXT DEFAULT '[]',
        past_failures TEXT DEFAULT '[]',
        severity TEXT DEFAULT 'warning',
        mitigation TEXT,
        hit_count INTEGER DEFAULT 0,
        last_triggered TEXT,
        created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- MEMORY PALACE — Spatial organization with multi-sensory anchors
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS palace_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        parent_room_id TEXT,
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        position_z REAL DEFAULT 0,
        sensory_anchors TEXT DEFAULT '[]',
        mood TEXT DEFAULT 'neutral',
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_room_id) REFERENCES palace_rooms(id)
    );

    CREATE TABLE IF NOT EXISTS memory_placements (
        memory_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        position_z REAL DEFAULT 0,
        placement_note TEXT,
        placed_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, memory_type, room_id),
        FOREIGN KEY (room_id) REFERENCES palace_rooms(id)
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- ASSOCIATIVE NETWORK — Spreading activation graph
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        association_type TEXT DEFAULT 'semantic',
        strength REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        last_activated TEXT,
        activation_count INTEGER DEFAULT 0,
        UNIQUE(source_id, source_type, target_id, target_type, association_type)
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- NARRATIVE CHAINS — Causal/temporal memory sequences
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS narrative_chains (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS narrative_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        sequence_order INTEGER NOT NULL,
        causal_role TEXT DEFAULT 'event',
        FOREIGN KEY (chain_id) REFERENCES narrative_chains(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- COUNTERFACTUAL MEMORY — "What if" reasoning
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS counterfactuals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        narrative_id TEXT NOT NULL,
        original_event_id TEXT NOT NULL,
        counterfactual_scenario TEXT NOT NULL,
        predicted_outcome TEXT,
        plausibility REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        FOREIGN KEY (narrative_id) REFERENCES narrative_chains(id)
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- CONSOLIDATION LOG — Dream/sleep processing record
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS consolidation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        memories_processed INTEGER DEFAULT 0,
        memories_merged INTEGER DEFAULT 0,
        memories_pruned INTEGER DEFAULT 0,
        schemas_created INTEGER DEFAULT 0,
        associations_formed INTEGER DEFAULT 0,
        contradictions_resolved INTEGER DEFAULT 0,
        threats_identified INTEGER DEFAULT 0,
        somatic_updated INTEGER DEFAULT 0,
        patterns_discovered INTEGER DEFAULT 0,
        novel_connections INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        summary TEXT
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- METACOGNITION — Memory about memory
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS metacognition (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        confidence REAL DEFAULT 0.8,
        source_reliability REAL DEFAULT 0.5,
        knowledge_gap TEXT,
        reflection TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- ENTITIES — For entity linking across all memory types
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entity_type TEXT DEFAULT 'general',
        canonical_name TEXT,
        description TEXT,
        importance REAL DEFAULT 0.5,
        mention_count INTEGER DEFAULT 0,
        first_seen TEXT,
        last_seen TEXT,
        UNIQUE(name, entity_type)
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
        memory_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        role TEXT DEFAULT 'subject',
        PRIMARY KEY (memory_id, memory_type, entity_id),
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- CONTRADICTIONS — Conflict tracking
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id_1 TEXT NOT NULL,
        memory_type_1 TEXT NOT NULL,
        memory_id_2 TEXT NOT NULL,
        memory_type_2 TEXT NOT NULL,
        severity TEXT DEFAULT 'warning',
        detected_at TEXT NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolution TEXT,
        resolved_at TEXT
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- SESSION CHECKPOINTS — Save/restore working memory state
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project TEXT DEFAULT 'default',
        working_memory_ids TEXT DEFAULT '[]',
        mood_tag TEXT,
        context_description TEXT,
        created_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- INDICES
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE INDEX IF NOT EXISTS idx_episodic_project ON episodic_memories(project);
    CREATE INDEX IF NOT EXISTS idx_episodic_active ON episodic_memories(is_active);
    CREATE INDEX IF NOT EXISTS idx_episodic_strength ON episodic_memories(strength);
    CREATE INDEX IF NOT EXISTS idx_episodic_review ON episodic_memories(next_review);
    CREATE INDEX IF NOT EXISTS idx_episodic_working ON episodic_memories(is_in_working_memory);
    CREATE INDEX IF NOT EXISTS idx_episodic_salience ON episodic_memories(salience);
    CREATE INDEX IF NOT EXISTS idx_episodic_stage ON episodic_memories(developmental_stage);
    CREATE INDEX IF NOT EXISTS idx_episodic_mood ON episodic_memories(mood_tag);
    CREATE INDEX IF NOT EXISTS idx_episodic_somatic ON episodic_memories(somatic_weight);
    CREATE INDEX IF NOT EXISTS idx_somatic_entity ON somatic_memories(entity_name);
    CREATE INDEX IF NOT EXISTS idx_somatic_active ON somatic_memories(is_active);
    CREATE INDEX IF NOT EXISTS idx_transactive_agent ON transactive_memory(agent_name);
    CREATE INDEX IF NOT EXISTS idx_transactive_domain ON transactive_memory(domain);
    CREATE INDEX IF NOT EXISTS idx_predictive_trigger ON predictive_patterns(trigger_context);
    CREATE INDEX IF NOT EXISTS idx_threat_active ON threat_patterns(is_active);
    CREATE INDEX IF NOT EXISTS idx_semantic_project ON semantic_memories(project);
    CREATE INDEX IF NOT EXISTS idx_semantic_schema ON semantic_memories(schema_id);
    CREATE INDEX IF NOT EXISTS idx_procedural_project ON procedural_memories(project);
    CREATE INDEX IF NOT EXISTS idx_associations_source ON associations(source_id, source_type);
    CREATE INDEX IF NOT EXISTS idx_associations_target ON associations(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_contradictions_resolved ON contradictions(resolved);
    CREATE INDEX IF NOT EXISTS idx_mutations_memory ON memory_mutations(memory_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON session_checkpoints(project);
`);

// ─── Brain-Inspired Algorithms ───────────────────────────────────────────────

function calculateRetention(strength, hoursSinceReview) {
  return Math.exp(-hoursSinceReview / Math.max(strength, 0.1));
}

function calculateNextReview(strength, accessCount, emotionalSalience, developmentalStage) {
  const baseInterval = 24;
  const spacingFactor = Math.pow(2.1, accessCount);
  const emotionalBoost = 1 + emotionalSalience * 0.5;
  const stageMultiplier =
    developmentalStage === "abstracted" ? 3.0 :
    developmentalStage === "consolidated" ? 2.0 :
    developmentalStage === "structured" ? 1.5 : 1.0;
  const interval = (baseInterval * spacingFactor * emotionalBoost * stageMultiplier) / strength;
  return new Date(Date.now() + interval * 3600000).toISOString();
}

function detectEmotionalSalience(text) {
  const lower = text.toLowerCase();
  let valence = 0, arousal = 0;
  const positive = ["love","great","excellent","amazing","wonderful","fantastic","happy","excited","perfect","best","awesome","brilliant","success","won","achieved","celebrate","beautiful","joy"];
  const negative = ["hate","terrible","awful","horrible","worst","angry","frustrated","annoyed","disappointed","failed","broken","bug","error","crash","disaster","catastrophe","nightmare","fear"];
  const highArousal = ["urgent","critical","emergency","immediately","asap","crucial","vital","essential","must","never","always","danger","warning"];
  for (const w of positive) { if (lower.includes(w)) { valence += 0.15; arousal += 0.1; } }
  for (const w of negative) { if (lower.includes(w)) { valence -= 0.15; arousal += 0.15; } }
  for (const w of highArousal) { if (lower.includes(w)) { arousal += 0.2; } }
  return { valence: Math.max(-1, Math.min(1, valence)), arousal: Math.max(0, Math.min(1, arousal)), salience: Math.min(1, Math.abs(valence) * 0.5 + arousal * 0.5) };
}

function getSensoryDecayRate(sensoryType) {
  const rates = { visual: 0.95, audio: 0.85, haptic: 0.80, text: 0.90, multi: 0.97 };
  return rates[sensoryType] || 0.90;
}

function extractEntities(text) {
  const entities = [];
  for (const m of text.matchAll(/"([^"]+)"/g)) entities.push([m[1], "quoted"]);
  for (const m of text.matchAll(/(\w[\w\s]{1,30})\s+(?:is|was|are|were)\s+([^.]+)/gi)) { entities.push([m[1].trim(), "attribute"]); entities.push([m[2].trim(), "value"]); }
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
    if (!["The","This","That","These","Those","There","Their","Then","Than"].includes(m[1].split(" ")[0])) entities.push([m[1], "proper_noun"]);
  }
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) entities.push([m[0], "email"]);
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) entities.push([m[0], "url"]);
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|px|em|rem|%|kb|mb|gb)\b/gi)) entities.push([m[0], "measurement"]);
  return [...new Map(entities.map(e => [`${e[0]}:${e[1]}`, e])).values()];
}

function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  const jaccard = intersection.size / Math.max(union.size, 1);
  const entities1 = extractEntities(text1);
  const entities2 = extractEntities(text2);
  const entityOverlap = entities1.filter(e1 => entities2.some(e2 => e1[0].toLowerCase() === e2[0].toLowerCase())).length;
  return Math.min(1, jaccard + Math.min(0.3, entityOverlap * 0.1));
}

function detectMood(text) {
  const lower = text.toLowerCase();
  const moods = {
    debugging: ["bug","error","fix","debug","crash","issue","broken","fail"],
    designing: ["design","ui","ux","layout","color","visual","beautiful","style"],
    planning: ["plan","roadmap","strategy","goal","milestone","timeline","schedule"],
    learning: ["learn","understand","how","why","what","explain","tutorial","guide"],
    creating: ["create","build","make","new","start","initiate","launch","ship"],
    reviewing: ["review","check","audit","verify","test","validate","inspect"],
    frustrated: ["frustrated","stuck","can't","impossible","hate","annoying","waste"],
    excited: ["excited","amazing","awesome","great","love","perfect","brilliant","yes"],
  };
  let bestMood = "neutral", bestScore = 0;
  for (const [mood, keywords] of Object.entries(moods)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; bestMood = mood; }
  }
  return bestScore > 0 ? bestMood : "neutral";
}

function progressDevelopmentalStage(currentStage, accessCount, similarityToExisting) {
  if (currentStage === "abstracted") return "abstracted";
  if (currentStage === "consolidated" && accessCount > 10) return "abstracted";
  if (currentStage === "structured" && accessCount > 5) return "consolidated";
  if (currentStage === "raw" && accessCount > 2) return "structured";
  if (similarityToExisting > 0.8 && currentStage === "raw") return "structured";
  return currentStage;
}

function generateId(content, salt = "") {
  return crypto.createHash("sha256").update(content + salt + Date.now().toString()).digest("hex").slice(0, 16);
}

// ─── Memory Consolidation (Dream Algorithm) ──────────────────────────────────

function consolidateMemories(projectId) {
  const now = new Date().toISOString();
  const logId = db.prepare("INSERT INTO consolidation_log (started_at) VALUES (?)").run(now).lastInsertRowid;
  let processed = 0, merged = 0, pruned = 0, schemasCreated = 0, associationsFormed = 0;
  let contradictionsResolved = 0, threatsIdentified = 0, somaticUpdated = 0, patternsDiscovered = 0, novelConnections = 0;

  const activeMemories = db.prepare("SELECT id, content, project, strength, developmental_stage, access_count FROM episodic_memories WHERE is_active = 1 AND is_consolidated = 0 AND project = ?").all(projectId);
  const processedIds = new Set();

  for (let i = 0; i < activeMemories.length; i++) {
    const mem1 = activeMemories[i];
    if (processedIds.has(mem1.id)) continue;
    for (let j = i + 1; j < activeMemories.length; j++) {
      const mem2 = activeMemories[j];
      if (processedIds.has(mem2.id) || mem1.project !== mem2.project) continue;
      const similarity = calculateSimilarity(mem1.content, mem2.content);
      if (similarity > 0.7) {
        const keep = mem1.strength >= mem2.strength ? mem1 : mem2;
        const deprecate = mem1.strength >= mem2.strength ? mem2 : mem1;
        db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, previous_content, new_content, reason, created_at) VALUES (?, 'merged', ?, ?, 'Consolidation merge', ?)").run(keep.id, deprecate.content, keep.content, now);
        db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(deprecate.id);
        db.prepare("UPDATE episodic_memories SET strength = strength + 0.5, access_count = access_count + 1 WHERE id = ?").run(keep.id);
        processedIds.add(deprecate.id); merged++;
      }
    }
    const newStage = progressDevelopmentalStage(mem1.developmental_stage, mem1.access_count, 0);
    if (newStage !== mem1.developmental_stage) {
      db.prepare("UPDATE episodic_memories SET developmental_stage = ? WHERE id = ?").run(newStage, mem1.id);
      db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, previous_stage, new_stage, reason, created_at) VALUES (?, 'stage_progression', ?, ?, 'Consolidation', ?)").run(mem1.id, mem1.developmental_stage, newStage, now);
    }
    processed++;
  }

  // Create semantic schemas from groups
  const projectGroups = db.prepare("SELECT project, GROUP_CONCAT(content, ' | ') as contents, COUNT(*) as cnt FROM episodic_memories WHERE is_active = 1 AND project = ? GROUP BY project HAVING cnt > 2").all(projectId);
  for (const group of projectGroups) {
    const schemaId = generateId(group.project + group.contents.slice(0, 100), "schema");
    db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, schema_id, schema_name, abstraction_level, project, created_at, updated_at, importance) VALUES (?, ?, 'schema', ?, ?, 1, ?, ?, ?, 0.7)").run(schemaId, `Schema for ${group.project}: ${group.cnt} memories`, schemaId, `${group.project}-schema`, group.project, now, now);
    schemasCreated++;
  }

  // Form associations
  const allActive = db.prepare("SELECT id, content, project FROM episodic_memories WHERE is_active = 1 AND project = ?").all(projectId);
  for (let i = 0; i < allActive.length; i++) {
    for (let j = i + 1; j < allActive.length; j++) {
      if (allActive[i].project !== allActive[j].project) continue;
      const sim = calculateSimilarity(allActive[i].content, allActive[j].content);
      if (sim > 0.3 && sim < 0.7) {
        db.prepare("INSERT OR IGNORE INTO associations (source_id, source_type, target_id, target_type, association_type, strength, created_at) VALUES (?, 'episodic', ?, 'episodic', 'semantic', ?, ?)").run(allActive[i].id, allActive[j].id, sim, now);
        associationsFormed++;
      }
      // Novel connections (creativity)
      if (sim < 0.2) {
        const e1 = extractEntities(allActive[i].content), e2 = extractEntities(allActive[j].content);
        if (e1.some(en1 => e2.some(en2 => en1[0].toLowerCase() === en2[0].toLowerCase()))) {
          db.prepare("INSERT OR IGNORE INTO associations (source_id, source_type, target_id, target_type, association_type, strength, created_at) VALUES (?, 'episodic', ?, 'episodic', 'novel', 0.3, ?)").run(allActive[i].id, allActive[j].id, now);
          novelConnections++;
        }
      }
    }
  }

  // Threat detection from failures
  const failures = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND (event_type = 'error' OR content LIKE '%fail%' OR content LIKE '%crash%' OR content LIKE '%broken%')").all(projectId);
  if (failures.length >= 2) {
    for (let i = 0; i < failures.length; i++) {
      for (let j = i + 1; j < failures.length; j++) {
        if (calculateSimilarity(failures[i].content, failures[j].content) > 0.3) {
          const name = `Threat pattern ${i}-${j}`;
          if (!db.prepare("SELECT id FROM threat_patterns WHERE pattern_name = ? AND is_active = 1").get(name)) {
            db.prepare("INSERT INTO threat_patterns (pattern_name, description, past_failures, severity, created_at) VALUES (?, ?, ?, 'warning', ?)").run(name, failures[i].content.slice(0, 120), JSON.stringify([failures[i].id, failures[j].id]), now);
            threatsIdentified++;
          }
        }
      }
    }
  }

  // Somatic update
  const emotionalEpisodes = db.prepare("SELECT id, content, emotional_valence, emotional_arousal FROM episodic_memories WHERE project = ? AND is_active = 1 AND (ABS(emotional_valence) > 0.3 OR emotional_arousal > 0.5)").all(projectId);
  for (const ep of emotionalEpisodes) {
    for (const [eName, eType] of extractEntities(ep.content)) {
      if (eType === "proper_noun" || eType === "quoted") {
        const existing = db.prepare("SELECT id, somatic_valence, somatic_weight FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(eName);
        if (existing) {
          db.prepare("UPDATE somatic_memories SET somatic_valence = ?, somatic_weight = ?, last_triggered = ?, trigger_count = trigger_count + 1 WHERE id = ?").run(existing.somatic_valence * 0.7 + ep.emotional_valence * 0.3, Math.min(1, existing.somatic_weight + 0.1), now, existing.id);
        } else {
          db.prepare("INSERT INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, 0.3, ?, ?, 1, ?)").run(generateId(eName, "somatic"), eName, eType, ep.emotional_valence, ep.emotional_arousal, JSON.stringify([ep.id]), now, now);
        }
        somaticUpdated++;
      }
    }
  }

  // Adaptive forgetting (keep emotional memories)
  const weak = db.prepare("SELECT id, strength, emotional_valence, emotional_arousal FROM episodic_memories WHERE is_active = 1 AND project = ? AND strength < 0.08").all(projectId);
  for (const mem of weak) {
    if (Math.abs(mem.emotional_valence) > 0.5 || mem.emotional_arousal > 0.7) continue;
    db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(mem.id);
    db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, reason, created_at) VALUES (?, 'forgotten', 'Adaptive forgetting', ?)").run(mem.id, now);
    pruned++;
  }

  // Pattern discovery for predictive memory
  const recent = db.prepare("SELECT mood_tag FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 20").all(projectId);
  const moodCounts = {};
  for (const ep of recent) { if (ep.mood_tag) moodCounts[ep.mood_tag] = (moodCounts[ep.mood_tag] || 0) + 1; }
  for (const [mood, count] of Object.entries(moodCounts)) {
    if (count >= 3) {
      db.prepare("INSERT OR IGNORE INTO predictive_patterns (trigger_context, predicted_need, confidence, project, created_at) VALUES (?, ?, ?, ?, ?)").run(`mood:${mood}`, `User in ${mood} mode`, count / recent.length, projectId, now);
      patternsDiscovered++;
    }
  }

  db.prepare("UPDATE episodic_memories SET is_consolidated = 1 WHERE is_active = 1 AND is_consolidated = 0 AND project = ?").run(projectId);
  db.prepare("UPDATE consolidation_log SET completed_at = ?, memories_processed = ?, memories_merged = ?, memories_pruned = ?, schemas_created = ?, associations_formed = ?, contradictions_resolved = ?, threats_identified = ?, somatic_updated = ?, patterns_discovered = ?, novel_connections = ?, status = 'completed', summary = ? WHERE id = ?").run(
    now, processed, merged, pruned, schemasCreated, associationsFormed, contradictionsResolved, threatsIdentified, somaticUpdated, patternsDiscovered, novelConnections,
    `Dream: processed ${processed}, merged ${merged}, pruned ${pruned}, schemas ${schemasCreated}, associations ${associationsFormed}, threats ${threatsIdentified}, somatic ${somaticUpdated}, patterns ${patternsDiscovered}, creative ${novelConnections}`,
    logId
  );

  return { processed, merged, pruned, schemasCreated, associationsFormed, contradictionsResolved, threatsIdentified, somaticUpdated, patternsDiscovered, novelConnections };
}

// ─── MCP Server Setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: "owl-memory", version: "3.0.0", description: "OWL Memory MCP v3 — Brain-inspired agent memory with episodic/semantic/procedural/somatic/transactive memory, developmental stages, mutation tracking, adaptive forgetting, threat simulation, mood-congruent retrieval, predictive memory, creativity engine, memory palace, dream consolidation, spaced repetition, session checkpoints, counterfactual reasoning, and graph visualization." },
  { capabilities: { tools: {}, resources: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "remember", description: "Store an episodic memory. Auto-detects emotional salience, developmental stage, mood tag, sensory type. Records mutation.", inputSchema: { type: "object", properties: { content: { type: "string" }, event_type: { type: "string", enum: ["observation","decision","interaction","learning","error","insight"], default: "observation" }, project: { type: "string", default: "default" }, location: { type: "string" }, source: { type: "string", default: "conversation" }, confidence: { type: "number", default: 0.8 }, is_experiential: { type: "boolean", default: true }, sensory_type: { type: "string", enum: ["text","visual","audio","haptic","multi"], default: "text" } }, required: ["content"] } },
    { name: "recall", description: "Search ALL memory types. Semantic similarity + entity matching + emotional salience + strength + mood-congruent boosting.", inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all","episodic","semantic","procedural","somatic"], default: "all" }, limit: { type: "number", default: 10 }, min_strength: { type: "number", default: 0 }, include_weak: { type: "boolean", default: false }, mood_context: { type: "string" } }, required: ["query"] } },
    { name: "focus", description: "Load memories into working memory (max 4 chunks, like human prefrontal cortex).", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, query: { type: "string" }, project: { type: "string", default: "default" } } } },
    { name: "unfocus", description: "Clear working memory.", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, clear_all: { type: "boolean", default: false } } } },
    { name: "get_working_memory", description: "Show current working memory contents.", inputSchema: { type: "object", properties: {} } },
    { name: "save_checkpoint", description: "Save current working memory state. Restore later.", inputSchema: { type: "object", properties: { name: { type: "string" }, project: { type: "string", default: "default" }, context_description: { type: "string" } }, required: ["name"] } },
    { name: "restore_checkpoint", description: "Restore a previous checkpoint.", inputSchema: { type: "object", properties: { checkpoint_id: { type: "string" } }, required: ["checkpoint_id"] } },
    { name: "list_checkpoints", description: "List saved checkpoints.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "create_room", description: "Create a memory palace room with multi-sensory anchors.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, parent_room_id: { type: "string" }, position_x: { type: "number", default: 0 }, position_y: { type: "number", default: 0 }, position_z: { type: "number", default: 0 }, sensory_anchors: { type: "array", items: { type: "string" }, default: [] }, mood: { type: "string", default: "neutral" } }, required: ["name"] } },
    { name: "place_memory", description: "Place a memory in a palace room.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural"], default: "episodic" }, room_id: { type: "string" }, position_x: { type: "number", default: 0 }, position_y: { type: "number", default: 0 }, position_z: { type: "number", default: 0 }, placement_note: { type: "string" } }, required: ["memory_id","room_id"] } },
    { name: "navigate_palace", description: "Navigate memory palace. List rooms or find memories in a room.", inputSchema: { type: "object", properties: { room_id: { type: "string" }, list_rooms: { type: "boolean", default: true } } } },
    { name: "dream", description: "Run memory consolidation. Clustering, merging, abstraction, threat detection, somatic update, pattern discovery, creativity.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, aggressive: { type: "boolean", default: false } } } },
    { name: "get_consolidation_history", description: "View past consolidation runs.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 10 } } } },
    { name: "create_narrative", description: "Create a narrative chain (causal/temporal sequence of memories).", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, project: { type: "string", default: "default" } }, required: ["title"] } },
    { name: "add_to_narrative", description: "Add a memory to a narrative chain.", inputSchema: { type: "object", properties: { chain_id: { type: "string" }, memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural"], default: "episodic" }, causal_role: { type: "string", enum: ["event","cause","effect","decision","outcome"], default: "event" } }, required: ["chain_id","memory_id"] } },
    { name: "get_narrative", description: "Get a narrative chain with all memories in sequence.", inputSchema: { type: "object", properties: { chain_id: { type: "string" } }, required: ["chain_id"] } },
    { name: "list_narratives", description: "List narrative chains for a project.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "imagine", description: "Counterfactual reasoning — 'What if' scenarios based on past narratives.", inputSchema: { type: "object", properties: { narrative_id: { type: "string" }, counterfactual: { type: "string" } }, required: ["narrative_id","counterfactual"] } },
    { name: "learn_skill", description: "Store a procedural memory (skill/habit/how-to).", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, trigger_conditions: { type: "array", items: { type: "string" }, default: [] }, action_sequence: { type: "array", items: { type: "string" }, default: [] }, project: { type: "string", default: "default" } }, required: ["title","content"] } },
    { name: "practice_skill", description: "Record practice of a skill. Masters decay without practice.", inputSchema: { type: "object", properties: { skill_id: { type: "string" }, success: { type: "boolean", default: true }, notes: { type: "string" } }, required: ["skill_id"] } },
    { name: "get_somatic", description: "Get somatic (body/emotional) memory for an entity. 'I feel X about Y.'", inputSchema: { type: "object", properties: { entity_name: { type: "string" } }, required: ["entity_name"] } },
    { name: "list_somatic", description: "List all somatic memories — emotional residues.", inputSchema: { type: "object", properties: { min_weight: { type: "number", default: 0 } } } },
    { name: "know_who_knows", description: "Transactive memory — track what other agents know. 'I know who knows.'", inputSchema: { type: "object", properties: { agent_name: { type: "string" }, domain: { type: "string" }, expertise_level: { type: "number", default: 0.5 }, trust_level: { type: "number", default: 0.8 }, project: { type: "string", default: "default" } }, required: ["agent_name","domain"] } },
    { name: "find_expert", description: "Find who knows about a domain. Enables delegation.", inputSchema: { type: "object", properties: { domain: { type: "string" }, project: { type: "string", default: "default" }, min_expertise: { type: "number", default: 0.3 } }, required: ["domain"] } },
    { name: "get_threats", description: "Get active threat patterns — danger forecasts from past failures.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, severity: { type: "string", enum: ["info","warning","critical","all"], default: "all" } } } },
    { name: "warn_me", description: "Proactive threat check — given current context, what threats to be aware of?", inputSchema: { type: "object", properties: { context: { type: "string" }, project: { type: "string", default: "default" } }, required: ["context"] } },
    { name: "predict_needs", description: "Predict what memories will be needed based on current context. Anticipatory retrieval.", inputSchema: { type: "object", properties: { context: { type: "string" }, project: { type: "string", default: "default" } }, required: ["context"] } },
    { name: "get_mutation_history", description: "Get full mutation history of a memory. 'I used to think X, now believe Z.'", inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
    { name: "reflect", description: "Reflect on a memory — update confidence, note knowledge gaps.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural"], default: "episodic" }, confidence: { type: "number" }, knowledge_gap: { type: "string" }, reflection: { type: "string" } }, required: ["memory_id"] } },
    { name: "health_check", description: "Full memory system health check. Conflicts, stale, somatic balance, threats.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "review", description: "Get memories due for review (spaced repetition).", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, limit: { type: "number", default: 10 } } } },
    { name: "strengthen", description: "Strengthen a memory (mark as reviewed).", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, quality: { type: "number", minimum: 0, maximum: 1, default: 1 } }, required: ["memory_id"] } },
    { name: "associations", description: "Find memories associated with a memory (spreading activation).", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural"], default: "episodic" }, max_depth: { type: "number", default: 2 }, min_strength: { type: "number", default: 0.2 } }, required: ["memory_id"] } },
    { name: "find_path", description: "Find associative path between two memories (free association).", inputSchema: { type: "object", properties: { from_id: { type: "string" }, to_id: { type: "string" }, max_depth: { type: "number", default: 5 } }, required: ["from_id","to_id"] } },
    { name: "forget", description: "Soft-delete a memory.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural","somatic"], default: "episodic" } }, required: ["memory_id"] } },
    { name: "update_memory", description: "Update memory content. Records mutation.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural"], default: "episodic" }, new_content: { type: "string" } }, required: ["memory_id","new_content"] } },
    { name: "get_memory", description: "Get a single memory with associations, mutations, metacognition.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic","semantic","procedural","somatic"], default: "episodic" } }, required: ["memory_id"] } },
    { name: "list_memories", description: "List memories with filtering by type, stage, mood.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all","episodic","semantic","procedural","somatic"], default: "all" }, limit: { type: "number", default: 50 }, min_strength: { type: "number", default: 0 }, order_by: { type: "string", enum: ["strength","salience","created_at","access_count","somatic_weight"], default: "strength" }, developmental_stage: { type: "string" }, mood_tag: { type: "string" } } } },
    { name: "get_contradictions", description: "Get unresolved contradictions.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    { name: "resolve_contradiction", description: "Resolve a contradiction by keeping one memory.", inputSchema: { type: "object", properties: { contradiction_id: { type: "number" }, keep_memory_id: { type: "string" }, resolution: { type: "string", default: "" } }, required: ["contradiction_id","keep_memory_id"] } },
    { name: "export_memories", description: "Export all memories to JSON.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, filepath: { type: "string", default: "" }, memory_type: { type: "string", enum: ["all","episodic","semantic","procedural","somatic"], default: "all" } } } },
    { name: "import_memories", description: "Import memories from JSON.", inputSchema: { type: "object", properties: { filepath: { type: "string" }, project: { type: "string", default: "default" } }, required: ["filepath"] } },
    { name: "get_stats", description: "Comprehensive memory statistics with brain-inspired metrics.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
  ],
}));

// ─── Resources ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph", description: "Interactive memory graph. Nodes = memories, edges = associations. Clusters, communities, novel connections.", mimeType: "application/json" },
  { uri: "owl-memory://somatic-map", name: "Somatic Map", description: "Map of emotional residues — entities with gut feelings and emotional weights.", mimeType: "application/json" },
  { uri: "owl-memory://threat-landscape", name: "Threat Landscape", description: "Active threat patterns and danger forecasts.", mimeType: "application/json" },
  { uri: "owl-memory://transactive-directory", name: "Transactive Directory", description: "Who knows what — distributed knowledge map.", mimeType: "application/json" },
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const memories = db.prepare("SELECT id, content, event_type, strength, salience, emotional_valence, developmental_stage, sensory_type FROM episodic_memories WHERE is_active = 1").all();
    const associations = db.prepare("SELECT source_id, target_id, association_type, strength FROM associations").all();
    const entities = db.prepare("SELECT name, entity_type, importance FROM entities").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes: memories.map(m => ({ id: m.id, label: m.content.slice(0, 60), type: "episodic", group: m.event_type, size: m.strength * 10, color: m.emotional_valence > 0.2 ? "#4CAF50" : m.emotional_valence < -0.2 ? "#f44336" : "#2196F3", stage: m.developmental_stage, sensory: m.sensory_type })), edges: associations.map(a => ({ source: a.source_id, target: a.target_id, type: a.association_type, strength: a.strength })), entities, stats: { total_memories: memories.length, total_associations: associations.length, total_entities: entities.length } }, null, 2) }] };
  }
  if (uri === "owl-memory://somatic-map") {
    const somatic = db.prepare("SELECT entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, trigger_count, note FROM somatic_memories WHERE is_active = 1 ORDER BY somatic_weight DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ somatic_map: somatic, count: somatic.length }, null, 2) }] };
  }
  if (uri === "owl-memory://threat-landscape") {
    const threats = db.prepare("SELECT pattern_name, description, severity, hit_count, mitigation FROM threat_patterns WHERE is_active = 1 ORDER BY severity DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ threats, count: threats.length }, null, 2) }] };
  }
  if (uri === "owl-memory://transactive-directory") {
    const directory = db.prepare("SELECT agent_name, domain, expertise_level, trust_level, last_verified FROM transactive_memory ORDER BY domain, expertise_level DESC").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ directory, count: directory.length }, null, 2) }] };
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
      const content = args.content;
      const projectId = args.project || "default";
      const eventType = args.event_type || "observation";
      const confidence = args.confidence || 0.8;
      const isExperiential = args.is_experiential !== false;
      const sensoryType = args.sensory_type || "text";
      const emotion = detectEmotionalSalience(content);
      const moodTag = detectMood(content);
      const initialStrength = 0.5 + emotion.salience * 0.5;
      const sensoryDecay = getSensoryDecayRate(sensoryType);
      const nextReview = calculateNextReview(initialStrength, 0, emotion.salience, "raw");
      const memId = generateId(content, projectId);
      const entities = extractEntities(content);

      db.prepare(`INSERT INTO episodic_memories (id, content, event_type, project, location, source, confidence, emotional_valence, emotional_arousal, salience, strength, somatic_weight, somatic_valence, developmental_stage, created_at, updated_at, next_review, review_interval, is_experiential, sensory_type, sensory_fidelity, mood_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(memId, content, eventType, projectId, args.location || null, args.source || "conversation", confidence, emotion.valence, emotion.arousal, emotion.salience, initialStrength, emotion.salience > 0.3 ? emotion.salience * 0.5 : 0, emotion.valence * emotion.arousal, now, now, nextReview, 1.0, isExperiential ? 1 : 0, sensoryType, sensoryDecay, moodTag);

      db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, new_content, new_confidence, new_stage, reason, created_at) VALUES (?, 'created', ?, ?, 'raw', 'Initial storage', ?)").run(memId, content, confidence, now);

      for (const [eName, eType] of entities) {
        db.prepare("INSERT OR IGNORE INTO entities (name, entity_type, first_seen, last_seen) VALUES (?, ?, ?, ?)").run(eName, eType, now, now);
        const entityRow = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
        if (entityRow) {
          db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, memory_type, entity_id) VALUES (?, 'episodic', ?)").run(memId, entityRow.id);
          db.prepare("UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?").run(now, entityRow.id);
        }
      }

      const existingMemories = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND id != ?").all(projectId, memId);
      let contradictionsFound = 0;
      for (const existing of existingMemories) {
        const similarity = calculateSimilarity(content, existing.content);
        if (similarity > 0.3) {
          const negationWords = ["not","don't","doesn't","won't","can't","never","no longer","changed","updated","actually","instead"];
          if (negationWords.some(w => content.toLowerCase().includes(w)) !== negationWords.some(w => existing.content.toLowerCase().includes(w))) {
            db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, severity, detected_at) VALUES (?, 'episodic', ?, 'episodic', 'warning', ?)").run(existing.id, memId, now);
            contradictionsFound++;
          }
        }
      }

      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, event_type: eventType, emotional_valence: emotion.valence, emotional_arousal: emotion.arousal, salience: emotion.salience, strength: initialStrength, developmental_stage: "raw", next_review: nextReview, entities_extracted: entities.length, contradictions_detected: contradictionsFound, mood_tag: moodTag, sensory_type: sensoryType }, null, 2) }] };
    }

    // ═══ RECALL ═══
    if (name === "recall") {
      const query = args.query, projectId = args.project || "default", limit = args.limit || 10;
      const memoryType = args.memory_type || "all", minStrength = args.min_strength || 0;
      const includeWeak = args.include_weak || false, moodContext = args.mood_context || detectMood(query);
      const results = [], queryEntities = extractEntities(query), queryEmotion = detectEmotionalSalience(query);

      if (memoryType === "all" || memoryType === "episodic") {
        const q = includeWeak ? "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1" : "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?";
        const p = includeWeak ? [projectId] : [projectId, minStrength];
        for (const mem of db.prepare(q).all(...p)) {
          let score = calculateSimilarity(query, mem.content) * 0.25 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) score += 0.1;
          const memEntities = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          score += Math.min(0.15, queryEntities.filter(qe => memEntities.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) score += 0.15;
          if (moodContext && mem.mood_tag === moodContext) score += 0.1;
          if (mem.developmental_stage === "abstracted") score += 0.05;
          if (mem.developmental_stage === "consolidated") score += 0.03;
          if (score > 0.1) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, salience: mem.salience, confidence: mem.confidence, emotional_valence: mem.emotional_valence, developmental_stage: mem.developmental_stage, mood_tag: mem.mood_tag, access_count: mem.access_count, relevance_score: Math.round(score * 1000) / 1000 });
          const hoursSince = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hoursSince)), mem.id);
        }
      }
      if (memoryType === "all" || memoryType === "semantic") {
        for (const mem of db.prepare("SELECT * FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.4 + mem.importance * 0.3 + mem.confidence * 0.3;
          if (score > 0.1) results.push({ id: mem.id, type: "semantic", content: mem.content, concept_type: mem.concept_type, importance: mem.importance, confidence: mem.confidence, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      if (memoryType === "all" || memoryType === "procedural") {
        for (const mem of db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId)) {
          const score = calculateSimilarity(query, mem.content) * 0.3 + mem.mastery_level * 0.3 + (mem.success_count / Math.max(mem.practice_count, 1)) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "procedural", title: mem.title, content: mem.content, mastery_level: mem.mastery_level, practice_count: mem.practice_count, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      if (memoryType === "all" || memoryType === "somatic") {
        for (const mem of db.prepare("SELECT * FROM somatic_memories WHERE is_active = 1").all()) {
          const score = calculateSimilarity(query, mem.entity_name) * 0.3 + mem.somatic_weight * 0.4 + Math.abs(mem.somatic_valence) * 0.2;
          if (score > 0.1) results.push({ id: mem.id, type: "somatic", entity_name: mem.entity_name, somatic_valence: mem.somatic_valence, somatic_weight: mem.somatic_weight, note: mem.note, relevance_score: Math.round(score * 1000) / 1000 });
        }
      }
      results.sort((a, b) => b.relevance_score - a.relevance_score);
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
    }

    // ═══ FOCUS / UNFOCUS / GET_WORKING_MEMORY ═══
    if (name === "focus") {
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      let memoryIds = args.memory_ids || [];
      if (args.query && memoryIds.length === 0) {
        memoryIds = db.prepare("SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 4").all(args.project || "default").map(m => m.id);
      }
      const limited = memoryIds.slice(0, 4);
      for (let i = 0; i < limited.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, limited[i]);
      const loaded = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: loaded, capacity: 4, used: loaded.length }, null, 2) }] };
    }
    if (name === "unfocus") {
      if (args.clear_all) { db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run(); return { content: [{ type: "text", text: "Working memory cleared." }] }; }
      if (args.memory_ids?.length > 0) { for (const id of args.memory_ids) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL WHERE id = ?").run(id); return { content: [{ type: "text", text: `Removed ${args.memory_ids.length} memories.` }] }; }
      return { content: [{ type: "text", text: "Nothing to unfocus." }] };
    }
    if (name === "get_working_memory") {
      const memories = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      return { content: [{ type: "text", text: JSON.stringify({ working_memory: memories, capacity: 4, used: memories.length }, null, 2) }] };
    }

    // ═══ SESSION CHECKPOINTS ═══
    if (name === "save_checkpoint") {
      const checkpointId = generateId(args.name, "checkpoint");
      const wm = db.prepare("SELECT id FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
      db.prepare("INSERT INTO session_checkpoints (id, name, project, working_memory_ids, context_description, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(checkpointId, args.name, args.project || "default", JSON.stringify(wm.map(m => m.id)), args.context_description || null, now);
      return { content: [{ type: "text", text: JSON.stringify({ checkpoint_id: checkpointId, name: args.name, memories_saved: wm.length }, null, 2) }] };
    }
    if (name === "restore_checkpoint") {
      const cp = db.prepare("SELECT * FROM session_checkpoints WHERE id = ?").get(args.checkpoint_id);
      if (!cp) return { content: [{ type: "text", text: "Checkpoint not found." }], isError: true };
      db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
      const ids = JSON.parse(cp.working_memory_ids || "[]");
      for (let i = 0; i < ids.length; i++) db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, ids[i]);
      return { content: [{ type: "text", text: JSON.stringify({ restored: true, checkpoint: cp.name, memories_loaded: ids.length }, null, 2) }] };
    }
    if (name === "list_checkpoints") {
      const checkpoints = db.prepare("SELECT id, name, project, context_description, created_at FROM session_checkpoints WHERE project = ? AND is_active = 1 ORDER BY created_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(checkpoints, null, 2) }] };
    }

    // ═══ MEMORY PALACE ═══
    if (name === "create_room") {
      const roomId = generateId(args.name, "room");
      db.prepare("INSERT INTO palace_rooms (id, name, description, parent_room_id, position_x, position_y, position_z, sensory_anchors, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(roomId, args.name, args.description || null, args.parent_room_id || null, args.position_x || 0, args.position_y || 0, args.position_z || 0, JSON.stringify(args.sensory_anchors || []), args.mood || "neutral", now);
      return { content: [{ type: "text", text: JSON.stringify({ room_id: roomId, name: args.name }, null, 2) }] };
    }
    if (name === "place_memory") {
      db.prepare("INSERT OR REPLACE INTO memory_placements (memory_id, memory_type, room_id, position_x, position_y, position_z, placement_note, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.room_id, args.position_x || 0, args.position_y || 0, args.position_z || 0, args.placement_note || null, now);
      return { content: [{ type: "text", text: JSON.stringify({ placed: true, memory_id: args.memory_id, room_id: args.room_id }, null, 2) }] };
    }
    if (name === "navigate_palace") {
      if (args.list_rooms !== false) {
        const rooms = db.prepare("SELECT id, name, description, parent_room_id, position_x, position_y, position_z, mood FROM palace_rooms ORDER BY name").all();
        return { content: [{ type: "text", text: JSON.stringify({ rooms }, null, 2) }] };
      }
      if (args.room_id) {
        const room = db.prepare("SELECT * FROM palace_rooms WHERE id = ?").get(args.room_id);
        const memories = db.prepare("SELECT mp.*, em.content FROM memory_placements mp LEFT JOIN episodic_memories em ON em.id = mp.memory_id WHERE mp.room_id = ?").all(args.room_id);
        return { content: [{ type: "text", text: JSON.stringify({ room, memories }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ error: "Provide room_id or list_rooms: true" }) }] };
    }

    // ═══ DREAM CONSOLIDATION ═══
    if (name === "dream") {
      const result = consolidateMemories(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ status: "completed", ...result, message: `Dream: processed ${result.processed}, merged ${result.merged}, pruned ${result.pruned}, schemas ${result.schemasCreated}, associations ${result.associationsFormed}, threats ${result.threatsIdentified}, somatic ${result.somaticUpdated}, patterns ${result.patternsDiscovered}, creative ${result.novelConnections}` }, null, 2) }] };
    }
    if (name === "get_consolidation_history") {
      const history = db.prepare("SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT ?").all(args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
    }

    // ═══ NARRATIVE MEMORY ═══
    if (name === "create_narrative") {
      const chainId = generateId(args.title, "narrative");
      db.prepare("INSERT INTO narrative_chains (id, title, description, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(chainId, args.title, args.description || null, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ chain_id: chainId, title: args.title }, null, 2) }] };
    }
    if (name === "add_to_narrative") {
      const maxOrder = db.prepare("SELECT MAX(sequence_order) as max FROM narrative_events WHERE chain_id = ?").get(args.chain_id);
      const nextOrder = (maxOrder?.max || 0) + 1;
      db.prepare("INSERT INTO narrative_events (chain_id, memory_id, memory_type, sequence_order, causal_role) VALUES (?, ?, ?, ?, ?)").run(args.chain_id, args.memory_id, args.memory_type || "episodic", nextOrder, args.causal_role || "event");
      db.prepare("UPDATE narrative_chains SET updated_at = ? WHERE id = ?").run(now, args.chain_id);
      return { content: [{ type: "text", text: JSON.stringify({ added: true, chain_id: args.chain_id, position: nextOrder }, null, 2) }] };
    }
    if (name === "get_narrative") {
      const chain = db.prepare("SELECT * FROM narrative_chains WHERE id = ?").get(args.chain_id);
      if (!chain) return { content: [{ type: "text", text: "Narrative not found." }] };
      const events = db.prepare("SELECT ne.*, em.content FROM narrative_events ne LEFT JOIN episodic_memories em ON em.id = ne.memory_id WHERE ne.chain_id = ? ORDER BY ne.sequence_order").all(args.chain_id);
      return { content: [{ type: "text", text: JSON.stringify({ chain, events }, null, 2) }] };
    }
    if (name === "list_narratives") {
      const narratives = db.prepare("SELECT * FROM narrative_chains WHERE project = ? AND is_active = 1 ORDER BY updated_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(narratives, null, 2) }] };
    }
    if (name === "imagine") {
      const cfId = generateId(args.counterfactual, "cf");
      db.prepare("INSERT INTO counterfactuals (narrative_id, original_event_id, counterfactual_scenario, plausibility, created_at) VALUES (?, ?, ?, 0.5, ?)").run(args.narrative_id, args.narrative_id, args.counterfactual, now);
      return { content: [{ type: "text", text: JSON.stringify({ imagined: true, scenario: args.counterfactual, message: "Counterfactual recorded. The narrative can now explore 'what if' this had happened differently." }, null, 2) }] };
    }

    // ═══ PROCEDURAL MEMORY ═══
    if (name === "learn_skill") {
      const skillId = generateId(args.title, "skill");
      db.prepare("INSERT INTO procedural_memories (id, title, content, trigger_conditions, action_sequence, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(skillId, args.title, args.content, JSON.stringify(args.trigger_conditions || []), JSON.stringify(args.action_sequence || []), args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: skillId, title: args.title, mastery_level: 0.1 }, null, 2) }] };
    }
    if (name === "practice_skill") {
      const skill = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(args.skill_id);
      if (!skill) return { content: [{ type: "text", text: "Skill not found." }], isError: true };
      const newPractice = skill.practice_count + 1, newSuccess = skill.success_count + (args.success ? 1 : 0), newFailure = skill.failure_count + (args.success ? 0 : 1);
      const newMastery = Math.max(0, Math.min(1, skill.mastery_level + (args.success ? 0.05 : -0.02)));
      db.prepare("UPDATE procedural_memories SET practice_count = ?, success_count = ?, failure_count = ?, mastery_level = ?, last_practiced = ?, updated_at = ? WHERE id = ?").run(newPractice, newSuccess, newFailure, newMastery, now, now, args.skill_id);
      return { content: [{ type: "text", text: JSON.stringify({ skill_id: args.skill_id, mastery_level: Math.round(newMastery * 100) / 100, practice_count: newPractice, success_rate: Math.round(newSuccess / newPractice * 100) / 100 }, null, 2) }] };
    }

    // ═══ SOMATIC MEMORY ═══
    if (name === "get_somatic") {
      const somatic = db.prepare("SELECT * FROM somatic_memories WHERE entity_name = ? AND is_active = 1").get(args.entity_name);
      if (!somatic) return { content: [{ type: "text", text: JSON.stringify({ entity_name: args.entity_name, found: false, message: "No somatic memory for this entity." }, null, 2) }] };
      return { content: [{ type: "text", text: JSON.stringify({ found: true, ...somatic }, null, 2) }] };
    }
    if (name === "list_somatic") {
      const somatic = db.prepare("SELECT entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, trigger_count, note FROM somatic_memories WHERE is_active = 1 AND somatic_weight >= ? ORDER BY somatic_weight DESC").all(args.min_weight || 0);
      return { content: [{ type: "text", text: JSON.stringify({ somatic_map: somatic, count: somatic.length }, null, 2) }] };
    }

    // ═══ TRANSATIVE MEMORY ═══
    if (name === "know_who_knows") {
      db.prepare("INSERT OR REPLACE INTO transactive_memory (agent_name, domain, expertise_level, trust_level, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(args.agent_name, args.domain, args.expertise_level || 0.5, args.trust_level || 0.8, args.project || "default", now, now);
      return { content: [{ type: "text", text: JSON.stringify({ recorded: true, agent: args.agent_name, domain: args.domain }, null, 2) }] };
    }
    if (name === "find_expert") {
      const experts = db.prepare("SELECT agent_name, domain, expertise_level, trust_level FROM transactive_memory WHERE domain LIKE ? AND expertise_level >= ? AND project = ? ORDER BY expertise_level DESC").all(`%${args.domain}%`, args.min_expertise || 0.3, args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify({ domain: args.domain, experts, count: experts.length }, null, 2) }] };
    }

    // ═══ THREAT SIMULATION ═══
    if (name === "get_threats") {
      const severityFilter = args.severity === "all" ? "" : ` AND severity = '${args.severity}'`;
      const threats = db.prepare(`SELECT pattern_name, description, severity, hit_count, mitigation FROM threat_patterns WHERE is_active = 1${severityFilter} ORDER BY severity DESC`).all();
      return { content: [{ type: "text", text: JSON.stringify({ threats, count: threats.length }, null, 2) }] };
    }
    if (name === "warn_me") {
      const context = args.context;
      const threats = db.prepare("SELECT * FROM threat_patterns WHERE is_active = 1").all();
      const relevant = threats.filter(t => {
        const triggers = JSON.parse(t.trigger_conditions || "[]");
        return triggers.some(tr => context.toLowerCase().includes(tr.toLowerCase())) || calculateSimilarity(context, t.description) > 0.3;
      });
      return { content: [{ type: "text", text: JSON.stringify({ context, threats_found: relevant.length, threats: relevant, message: relevant.length > 0 ? `⚠️ ${relevant.length} potential threat(s) detected based on past failures.` : "No threats detected for this context." }, null, 2) }] };
    }

    // ═══ PREDICTIVE MEMORY ═══
    if (name === "predict_needs") {
      const context = args.context;
      const mood = detectMood(context);
      const patterns = db.prepare("SELECT * FROM predictive_patterns WHERE (trigger_context LIKE ? OR trigger_context LIKE ?) AND is_active = 1 ORDER BY confidence DESC").all(`%${context.slice(0, 30)}%`, `%mood:${mood}%`);
      const relatedMemories = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE project = ? AND is_active = 1 AND mood_tag = ? ORDER BY strength DESC LIMIT 5").all(args.project || "default", mood);
      return { content: [{ type: "text", text: JSON.stringify({ context, detected_mood: mood, predicted_patterns: patterns, likely_needed_memories: relatedMemories }, null, 2) }] };
    }

    // ═══ MEMORY MUTATIONS ═══
    if (name === "get_mutation_history") {
      const mutations = db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, mutations, count: mutations.length }, null, 2) }] };
    }

    // ═══ METACOGNITION ═══
    if (name === "reflect") {
      db.prepare("INSERT OR REPLACE INTO metacognition (memory_id, memory_type, confidence, source_reliability, knowledge_gap, reflection, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(args.memory_id, args.memory_type || "episodic", args.confidence || 0.8, 0.5, args.knowledge_gap || null, args.reflection || null, now, now);
      return { content: [{ type: "text", text: JSON.stringify({ reflected: true, memory_id: args.memory_id }, null, 2) }] };
    }
    if (name === "health_check") {
      const projectId = args.project || "default";
      const totalEpisodic = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalSemantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalProcedural = db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId).c;
      const totalSomatic = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get().c;
      const conflicts = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId).c;
      const stale = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength < 0.2").get(projectId).c;
      const wmLoad = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get().c;
      const avgStrength = db.prepare("SELECT AVG(strength) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).avg || 0;
      const lastDream = db.prepare("SELECT * FROM consolidation_log WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1").get();
      const threats = db.prepare("SELECT COUNT(*) as c FROM threat_patterns WHERE is_active = 1").get().c;
      const transactive = db.prepare("SELECT COUNT(*) as c FROM transactive_memory").get().c;
      let healthScore = 100;
      healthScore -= conflicts * 10 + stale * 5 + (1 - avgStrength) * 20;
      healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
      return { content: [{ type: "text", text: JSON.stringify({ health_score: healthScore, status: healthScore > 80 ? "healthy" : healthScore > 50 ? "needs_attention" : "critical", project: projectId, memories: { episodic: totalEpisodic, semantic: totalSemantic, procedural: totalProcedural, somatic: totalSomatic, total: totalEpisodic + totalSemantic + totalProcedural + totalSomatic }, conflicts, stale_memories: stale, working_memory: `${wmLoad}/4`, avg_strength: Math.round(avgStrength * 100) / 100, threats_tracked: threats, transactive_entries: transactive, last_consolidation: lastDream?.completed_at || "never" }, null, 2) }] };
    }

    // ═══ SPACED REPETITION ═══
    if (name === "review") {
      const due = db.prepare("SELECT id, content, strength, review_interval, access_count FROM episodic_memories WHERE project = ? AND is_active = 1 AND (next_review IS NULL OR next_review <= ?) ORDER BY strength ASC LIMIT ?").all(args.project || "default", now, args.limit || 10);
      return { content: [{ type: "text", text: JSON.stringify({ due_for_review: due, count: due.length }, null, 2) }] };
    }
    if (name === "strengthen") {
      const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(args.memory_id);
      if (!mem) return { content: [{ type: "text", text: "Memory not found." }], isError: true };
      const quality = args.quality || 1;
      const newStrength = Math.min(1, mem.strength + quality * 0.2);
      const newInterval = mem.review_interval * (1.5 + quality);
      const nextReview = new Date(Date.now() + newInterval * 3600000).toISOString();
      db.prepare("UPDATE episodic_memories SET strength = ?, review_interval = ?, next_review = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?").run(newStrength, newInterval, nextReview, now, args.memory_id);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, new_strength: Math.round(newStrength * 100) / 100, next_review: nextReview }, null, 2) }] };
    }

    // ═══ ASSOCIATIVE RECALL ═══
    if (name === "associations") {
      const assoc = db.prepare("SELECT a.*, e.name as target_name FROM associations a LEFT JOIN entities e ON e.id = a.target_id WHERE a.source_id = ? AND a.source_type = ? AND a.strength >= ? ORDER BY a.strength DESC").all(args.memory_id, args.memory_type || "episodic", args.min_strength || 0.2);
      return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, associations: assoc }, null, 2) }] };
    }
    if (name === "find_path") {
      const visited = new Set(), queue = [{ id: args.from_id, path: [] }];
      let found = null;
      while (queue.length > 0 && !found) {
        const current = queue.shift();
        if (current.id === args.to_id) { found = current.path; break; }
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        if (current.path.length >= (args.max_depth || 5)) continue;
        const neighbors = db.prepare("SELECT target_id, target_type, strength, association_type FROM associations WHERE source_id = ? AND strength >= 0.2").all(current.id);
        for (const n of neighbors) {
          if (!visited.has(n.target_id)) queue.push({ id: n.target_id, path: [...current.path, { id: n.target_id, type: n.target_type, strength: n.strength, association_type: n.association_type }] });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ from: args.from_id, to: args.to_id, path: found || [], found: !!found }, null, 2) }] };
    }

    // ═══ STANDARD OPERATIONS ═══
    if (name === "forget") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(args.memory_id);
      return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
    }
    if (name === "update_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
      const old = db.prepare(`SELECT content, confidence FROM ${table} WHERE id = ?`).get(args.memory_id);
      const emotion = detectEmotionalSalience(args.new_content);
      db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
      if (args.memory_type !== "semantic" && args.memory_type !== "procedural") {
        db.prepare("UPDATE episodic_memories SET emotional_valence = ?, emotional_arousal = ?, salience = ? WHERE id = ?").run(emotion.valence, emotion.arousal, emotion.salience, args.memory_id);
      }
      db.prepare("INSERT INTO memory_mutations (memory_id, mutation_type, previous_content, new_content, previous_confidence, new_confidence, reason, created_at) VALUES (?, 'updated', ?, ?, ?, ?, 'User update', ?)").run(args.memory_id, old?.content, args.new_content, old?.confidence, emotion.salience, now);
      return { content: [{ type: "text", text: JSON.stringify({ updated: true, memory_id: args.memory_id }, null, 2) }] };
    }
    if (name === "get_memory") {
      const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : args.memory_type === "somatic" ? "somatic_memories" : "episodic_memories";
      const mem = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(args.memory_id);
      if (!mem || !mem.is_active) return { content: [{ type: "text", text: "Memory not found." }] };
      const entities = db.prepare("SELECT e.name, e.entity_type FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = ?").all(args.memory_id, args.memory_type || "episodic");
      const assoc = db.prepare("SELECT * FROM associations WHERE source_id = ? AND source_type = ?").all(args.memory_id, args.memory_type || "episodic");
      const mutations = db.prepare("SELECT * FROM memory_mutations WHERE memory_id = ? ORDER BY created_at ASC").all(args.memory_id);
      const metacog = db.prepare("SELECT * FROM metacognition WHERE memory_id = ? AND memory_type = ?").get(args.memory_id, args.memory_type || "episodic");
      return { content: [{ type: "text", text: JSON.stringify({ ...mem, entities, associations: assoc, mutations, metacognition: metacog }, null, 2) }] };
    }
    if (name === "list_memories") {
      const projectId = args.project || "default", memoryType = args.memory_type || "all", limit = args.limit || 50;
      const minStrength = args.min_strength || 0, orderBy = args.order_by || "strength";
      const results = { episodic: [], semantic: [], procedural: [], somatic: [] };
      if (memoryType === "all" || memoryType === "episodic") {
        let q = `SELECT id, content, event_type, strength, salience, confidence, emotional_valence, developmental_stage, mood_tag, access_count, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?`;
        if (args.developmental_stage) q += ` AND developmental_stage = '${args.developmental_stage}'`;
        if (args.mood_tag) q += ` AND mood_tag = '${args.mood_tag}'`;
        q += ` ORDER BY ${orderBy} DESC LIMIT ?`;
        results.episodic = db.prepare(q).all(projectId, minStrength, limit);
      }
      if (memoryType === "all" || memoryType === "semantic") {
        results.semantic = db.prepare("SELECT id, content, concept_type, importance, confidence, created_at FROM semantic_memories WHERE project = ? AND is_active = 1 ORDER BY importance DESC LIMIT ?").all(projectId, limit);
      }
      if (memoryType === "all" || memoryType === "procedural") {
        results.procedural = db.prepare("SELECT id, title, content, mastery_level, practice_count, success_count FROM procedural_memories WHERE project = ? AND is_active = 1 ORDER BY mastery_level DESC LIMIT ?").all(projectId, limit);
      }
      if (memoryType === "all" || memoryType === "somatic") {
        results.somatic = db.prepare("SELECT entity_name, entity_type, somatic_valence, somatic_weight, trigger_count FROM somatic_memories WHERE is_active = 1 ORDER BY somatic_weight DESC LIMIT ?").all(limit);
      }
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    // ═══ CONTRADICTIONS ═══
    if (name === "get_contradictions") {
      const contradictions = db.prepare("SELECT c.*, m1.content as content1, m2.content as content2 FROM contradictions c JOIN episodic_memories m1 ON m1.id = c.memory_id_1 JOIN episodic_memories m2 ON m2.id = c.memory_id_2 WHERE m1.project = ? AND c.resolved = 0 ORDER BY c.detected_at DESC").all(args.project || "default");
      return { content: [{ type: "text", text: JSON.stringify(contradictions, null, 2) }] };
    }
    if (name === "resolve_contradiction") {
      const contra = db.prepare("SELECT * FROM contradictions WHERE id = ?").get(args.contradiction_id);
      if (!contra) return { content: [{ type: "text", text: "Contradiction not found." }], isError: true };
      const forgetId = args.keep_memory_id === contra.memory_id_1 ? contra.memory_id_2 : contra.memory_id_1;
      db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(forgetId);
      db.prepare("UPDATE contradictions SET resolved = 1, resolution = ?, resolved_at = ? WHERE id = ?").run(args.resolution || "", now, args.contradiction_id);
      return { content: [{ type: "text", text: JSON.stringify({ resolved: true, kept: args.keep_memory_id, forgot: forgetId }, null, 2) }] };
    }

    // ═══ IMPORT/EXPORT ═══
    if (name === "export_memories") {
      const projectId = args.project || "default", filepath = args.filepath || path.join(DATA_DIR, `export-${projectId}-${Date.now()}.json`);
      const export_data = { project: projectId, exported_at: now, version: "3.0" };
      if (args.memory_type === "all" || args.memory_type === "episodic") export_data.episodic = db.prepare("SELECT * FROM episodic_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "semantic") export_data.semantic = db.prepare("SELECT * FROM semantic_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "procedural") export_data.procedural = db.prepare("SELECT * FROM procedural_memories WHERE project = ?").all(projectId);
      if (args.memory_type === "all" || args.memory_type === "somatic") export_data.somatic = db.prepare("SELECT * FROM somatic_memories").all();
      export_data.associations = db.prepare("SELECT * FROM associations").all();
      export_data.entities = db.prepare("SELECT * FROM entities").all();
      export_data.narrative_chains = db.prepare("SELECT * FROM narrative_chains WHERE project = ?").all(projectId);
      export_data.mutations = db.prepare("SELECT * FROM memory_mutations").all();
      export_data.transactive = db.prepare("SELECT * FROM transactive_memory").all();
      export_data.threats = db.prepare("SELECT * FROM threat_patterns").all();
      fs.writeFileSync(filepath, JSON.stringify(export_data, null, 2));
      return { content: [{ type: "text", text: `Exported to ${filepath}` }] };
    }
    if (name === "import_memories") {
      const data = JSON.parse(fs.readFileSync(args.filepath, "utf-8"));
      const projectId = args.project || "default";
      let imported = 0;
      for (const mem of (data.episodic || [])) { db.prepare("INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.content, mem.event_type, projectId, mem.emotional_valence, mem.emotional_arousal, mem.salience, mem.strength, mem.confidence, mem.source || "import", mem.created_at, now); imported++; }
      for (const mem of (data.semantic || [])) { db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, project, importance, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.content, mem.concept_type, projectId, mem.importance, mem.confidence, mem.created_at, now); imported++; }
      for (const mem of (data.procedural || [])) { db.prepare("INSERT OR IGNORE INTO procedural_memories (id, title, content, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(mem.id, mem.title, mem.content, projectId, mem.created_at, now); imported++; }
      for (const mem of (data.somatic || [])) { db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(mem.id, mem.entity_name, mem.entity_type, mem.somatic_valence, mem.somatic_arousal, mem.somatic_weight, now); imported++; }
      return { content: [{ type: "text", text: `Imported ${imported} memories.` }] };
    }

    // ═══ STATS ═══
    if (name === "get_stats") {
      const projectId = args.project || "default";
      const episodic = db.prepare("SELECT COUNT(*) as c, AVG(strength) as avg_str, AVG(salience) as avg_sal FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId);
      const semantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId);
      const procedural = db.prepare("SELECT COUNT(*) as c, AVG(mastery_level) as avg_mastery FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId);
      const somatic = db.prepare("SELECT COUNT(*) as c FROM somatic_memories WHERE is_active = 1").get();
      const entities = db.prepare("SELECT COUNT(*) as c FROM entities").get();
      const associations = db.prepare("SELECT COUNT(*) as c FROM associations").get();
      const contradictions = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId);
      const wm = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get();
      const rooms = db.prepare("SELECT COUNT(*) as c FROM palace_rooms").get();
      const narratives = db.prepare("SELECT COUNT(*) as c FROM narrative_chains WHERE project = ? AND is_active = 1").get(projectId);
      const mutations = db.prepare("SELECT COUNT(*) as c FROM memory_mutations").get();
      const transactive = db.prepare("SELECT COUNT(*) as c FROM transactive_memory").get();
      const threats = db.prepare("SELECT COUNT(*) as c FROM threat_patterns WHERE is_active = 1").get();
      const patterns = db.prepare("SELECT COUNT(*) as c FROM predictive_patterns WHERE is_active = 1").get();
      const checkpoints = db.prepare("SELECT COUNT(*) as c FROM session_checkpoints WHERE project = ? AND is_active = 1").get(projectId);
      return { content: [{ type: "text", text: JSON.stringify({ project: projectId, memories: { episodic: episodic?.c || 0, semantic: semantic?.c || 0, procedural: procedural?.c || 0, somatic: somatic?.c || 0, total: (episodic?.c || 0) + (semantic?.c || 0) + (procedural?.c || 0) + (somatic?.c || 0) }, avg_strength: Math.round((episodic?.avg_str || 0) * 100) / 100, avg_salience: Math.round((episodic?.avg_sal || 0) * 100) / 100, avg_mastery: Math.round((procedural?.avg_mastery || 0) * 100) / 100, entities: entities?.c || 0, associations: associations?.c || 0, contradictions: contradictions?.c || 0, working_memory: `${wm?.c || 0}/4`, palace_rooms: rooms?.c || 0, narratives: narratives?.c || 0, mutations: mutations?.c || 0, transactive: transactive?.c || 0, threats: threats?.c || 0, predictive_patterns: patterns?.c || 0, checkpoints: checkpoints?.c || 0, database: DB_PATH }, null, 2) }] };
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
  console.error("OWL Memory MCP v3.0 — Brain-inspired agent memory running on stdio");
}

main().catch(console.error);
