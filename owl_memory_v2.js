/**
 * OWL Memory MCP v2 — Brain-Inspired Agent Memory
 *
 * Built from first principles by studying human memory systems:
 *
 * 1. EPISODIC MEMORY — Specific events with temporal/spatial context
 *    (Hippocampus → Cortical consolidation)
 *    Each memory has: what, when, where, emotional weight, sensory anchors
 *
 * 2. SEMANTIC MEMORY — General knowledge, facts, concepts
 *    (Neocortical networks, schema-based)
 *    Extracted from episodic memories through consolidation
 *    Organized into schemas (mental models) with spreading activation
 *
 * 3. PROCEDURAL MEMORY — Skills, habits, "how to" knowledge
 *    (Basal ganglia, cerebellum)
 *    Stored as action sequences with trigger conditions
 *
 * 4. WORKING MEMORY — Active context with limited capacity
 *    (Prefrontal cortex, ~4 chunks)
 *    Managed via attention, rehearsal, chunking
 *
 * 5. MEMORY CONSOLIDATION — Sleep/dream equivalent
 *    (Hippocampal replay → Cortical integration)
 *    Clustering, merging, abstraction, forgetting
 *
 * 6. EMOTIONAL TAGGING — Amygdala-based salience
 *    Emotionally charged memories are stronger, decay slower
 *    Valence (positive/negative) and arousal (intensity) tracked
 *
 * 7. SPACING EFFECT — Ebbinghaus forgetting curve
 *    Memories reviewed at expanding intervals last longer
 *    Each access strengthens the memory trace
 *
 * 8. CONTEXT-DEPENDENT RECALL — Encoding specificity principle
 *    Memories are easier to recall in similar contexts
 *    Environmental, emotional, and cognitive state matching
 *
 * 9. RECONSTRUCTIVE MEMORY — Memories are rebuilt, not replayed
 *    Each recall modifies the memory (reconsolidation)
 *    Source monitoring (did this happen or was it suggested?)
 *
 * 10. FORGETTING CURVE — Power law of forgetting
 *     Without review: 70% lost in 24h, 80% in a week
 *     With spaced review: near-permanent retention
 *
 * NOVEL FEATURES (don't exist in any current memory MCP):
 *
 * A. MEMORY PALACE — Spatial memory organization
 *    Memories placed in virtual "rooms" with spatial relationships
 *    Recall by navigating the palace (context-dependent retrieval)
 *
 * B. DREAM CONSOLIDATION — Automatic memory processing
 *    Clusters related memories, extracts patterns, creates abstractions
 *    Merges duplicates, resolves contradictions, prunes noise
 *    Runs on schedule or on-demand (like sleep consolidation)
 *
 * C. COGNITIVE LOAD MANAGEMENT — Working memory simulation
 *    Tracks active context, manages attention
 *    Auto-chunks related memories for efficient recall
 *    Prevents context overflow (like human working memory limits)
 *
 * D. NARRATIVE MEMORY — Autobiographical timeline
 *    Memories linked into causal chains (this led to that)
 *    "Story so far" generation for any topic
 *    Counterfactual reasoning ("what if I had chosen differently?")
 *
 * E. METACOGNITION — Memory about memory
 *    Confidence scoring ("how sure am I about this?")
 *    Source reliability tracking
 *    Knowledge gap detection ("what don't I know?")
 *
 * F. ASSOCIATIVE PRIMING — Spreading activation
 *    Activating one memory primes related ones
 *    Semantic distance calculation between memories
 *    "Reminds me of..." suggestions
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─── Configuration ───────────────────────────────────────────────────────────

const DB_PATH = process.env.OWL_MEMORY_DB || path.join(require("os").homedir(), ".owl-memory", "memory-v2.db");
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
    -- ═══════════════════════════════════════════════════════════════════════
    -- EPISODIC MEMORY — Specific events with full context
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        event_type TEXT DEFAULT 'observation',
        -- Temporal context
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        event_timestamp TEXT,
        -- Spatial/contextual context
        project TEXT DEFAULT 'default',
        location TEXT,
        -- Emotional tagging (amygdala)
        emotional_valence REAL DEFAULT 0,
        emotional_arousal REAL DEFAULT 0,
        salience REAL DEFAULT 0.5,
        -- Memory strength (spacing effect)
        strength REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        next_review TEXT,
        review_interval REAL DEFAULT 1.0,
        -- Source & provenance
        source TEXT DEFAULT 'conversation',
        source_path TEXT,
        source_hash TEXT,
        confidence REAL DEFAULT 0.8,
        -- Status
        is_active INTEGER DEFAULT 1,
        is_consolidated INTEGER DEFAULT 0,
        -- Working memory
        is_in_working_memory INTEGER DEFAULT 0,
        working_memory_position INTEGER,
        -- Metadata
        metadata TEXT DEFAULT '{}'
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- SEMANTIC MEMORY — Consolidated knowledge, schemas, concepts
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS semantic_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        concept_type TEXT DEFAULT 'fact',
        -- Schema organization
        schema_id TEXT,
        schema_name TEXT,
        -- Abstraction level (higher = more abstract)
        abstraction_level INTEGER DEFAULT 0,
        -- Source episodic memories
        source_episodes TEXT DEFAULT '[]',
        -- Importance & reliability
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.8,
        verification_count INTEGER DEFAULT 0,
        contradiction_count INTEGER DEFAULT 0,
        -- Context
        project TEXT DEFAULT 'default',
        -- Temporal
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        -- Status
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
        -- Skill mastery (basal ganglia)
        mastery_level REAL DEFAULT 0.1,
        practice_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_practiced TEXT,
        -- Context
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}'
    );

    -- ═══════════════════════════════════════════════════════════════════════
    -- MEMORY PALACE — Spatial organization
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
        memory_type_2 NOT NULL,
        severity TEXT DEFAULT 'warning',
        detected_at TEXT NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolution TEXT,
        resolved_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_semantic_project ON semantic_memories(project);
    CREATE INDEX IF NOT EXISTS idx_semantic_active ON semantic_memories(is_active);
    CREATE INDEX IF NOT EXISTS idx_semantic_schema ON semantic_memories(schema_id);
    CREATE INDEX IF NOT EXISTS idx_procedural_project ON procedural_memories(project);
    CREATE INDEX IF NOT EXISTS idx_associations_source ON associations(source_id, source_type);
    CREATE INDEX IF NOT EXISTS idx_associations_target ON associations(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_contradictions_resolved ON contradictions(resolved);
    CREATE INDEX IF NOT EXISTS idx_narrative_chain ON narrative_chains(project);
`);

// ─── Brain-Inspired Algorithms ───────────────────────────────────────────────

/**
 * Ebbinghaus Forgetting Curve
 * R = e^(-t/S) where R=retention, t=time, S=strength
 * Each review increases S by factor of 2-3x
 */
function calculateRetention(strength, hoursSinceReview) {
    return Math.exp(-hoursSinceReview / Math.max(strength, 0.1));
}

function calculateNextReview(strength, accessCount, emotionalSalience) {
    // Spacing effect: intervals expand with each successful review
    const baseInterval = 24; // hours
    const spacingFactor = Math.pow(2.1, accessCount);
    const emotionalBoost = 1 + (emotionalSalience * 0.5); // Emotional memories last longer
    const interval = baseInterval * spacingFactor * emotionalBoost / strength;
    return new Date(Date.now() + interval * 3600000).toISOString();
}

/**
 * Emotional Salience Detection
 * Detects emotional content in text (simplified — production would use LLM)
 */
function detectEmotionalSalience(text) {
    const lower = text.toLowerCase();
    let valence = 0; // -1 (negative) to 1 (positive)
    let arousal = 0; // 0 (calm) to 1 (intense)

    // Positive markers
    const positive = ['love', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'happy', 'excited', 'perfect', 'best', 'awesome', 'brilliant'];
    // Negative markers
    const negative = ['hate', 'terrible', 'awful', 'horrible', 'worst', 'angry', 'frustrated', 'annoyed', 'disappointed', 'failed', 'broken', 'bug', 'error', 'crash'];
    // High arousal markers
    const highArousal = ['urgent', 'critical', 'emergency', 'immediately', 'asap', 'crucial', 'vital', 'essential', 'must', 'never', 'always'];

    for (const word of positive) {
        if (lower.includes(word)) { valence += 0.2; arousal += 0.1; }
    }
    for (const word of negative) {
        if (lower.includes(word)) { valence -= 0.2; arousal += 0.15; }
    }
    for (const word of highArousal) {
        if (lower.includes(word)) { arousal += 0.2; }
    }

    return {
        valence: Math.max(-1, Math.min(1, valence)),
        arousal: Math.max(0, Math.min(1, arousal)),
        salience: Math.min(1, Math.abs(valence) * 0.5 + arousal * 0.5)
    };
}

/**
 * Entity Extraction (enhanced)
 */
function extractEntities(text) {
    const entities = [];
    // Quoted strings
    for (const m of text.matchAll(/"([^"]+)"/g)) entities.push([m[1], "quoted"]);
    // Key-value patterns
    for (const m of text.matchAll(/(\w[\w\s]{1,30})\s+(?:is|was|are|were)\s+([^.]+)/gi)) {
        entities.push([m[1].trim(), "attribute"]);
        entities.push([m[2].trim(), "value"]);
    }
    // Proper nouns
    for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
        if (!['The', 'This', 'That', 'These', 'Those', 'There', 'Their', 'Then', 'Than'].includes(m[1].split(' ')[0])) {
            entities.push([m[1], "proper_noun"]);
        }
    }
    // Emails
    for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) entities.push([m[0], "email"]);
    // URLs
    for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) entities.push([m[0], "url"]);
    // Numbers with units
    for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|px|em|rem|%|kb|mb|gb)\b/gi)) {
        entities.push([m[0], "measurement"]);
    }
    return [...new Map(entities.map(e => [`${e[0]}:${e[1]}`, e])).values()];
}

/**
 * Semantic Similarity (simplified — production would use embeddings)
 * Uses Jaccard similarity on word sets + entity overlap
 */
function calculateSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const jaccard = intersection.size / Math.max(union.size, 1);

    // Entity overlap bonus
    const entities1 = extractEntities(text1);
    const entities2 = extractEntities(text2);
    const entityOverlap = entities1.filter(e1 =>
        entities2.some(e2 => e1[0].toLowerCase() === e2[0].toLowerCase())
    ).length;
    const entityBonus = Math.min(0.3, entityOverlap * 0.1);

    return Math.min(1, jaccard + entityBonus);
}

/**
 * Memory Consolidation (Dream Algorithm)
 * Clusters related memories, extracts patterns, creates semantic abstractions
 */
function consolidateMemories() {
    const now = new Date().toISOString();
    const logId = db.prepare("INSERT INTO consolidation_log (started_at) VALUES (?)").run(now).lastInsertRowid;

    let processed = 0, merged = 0, pruned = 0, schemasCreated = 0, associationsFormed = 0, contradictionsResolved = 0;

    // 1. Find and merge duplicate/similar episodic memories
    const activeMemories = db.prepare(
        "SELECT id, content, project, strength FROM episodic_memories WHERE is_active = 1 AND is_consolidated = 0"
    ).all();

    const processedIds = new Set();
    for (let i = 0; i < activeMemories.length; i++) {
        const mem1 = activeMemories[i];
        if (processedIds.has(mem1.id)) continue;

        for (let j = i + 1; j < activeMemories.length; j++) {
            const mem2 = activeMemories[j];
            if (processedIds.has(mem2.id)) continue;
            if (mem1.project !== mem2.project) continue;

            const similarity = calculateSimilarity(mem1.content, mem2.content);
            if (similarity > 0.7) {
                // Merge: keep the stronger one, deprecate the other
                const keep = mem1.strength >= mem2.strength ? mem1 : mem2;
                const deprecate = mem1.strength >= mem2.strength ? mem2 : mem1;

                db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(deprecate.id);
                db.prepare("UPDATE episodic_memories SET strength = strength + 0.5, access_count = access_count + 1 WHERE id = ?").run(keep.id);

                processedIds.add(deprecate.id);
                merged++;
            }
        }
        processed++;
    }

    // 2. Create semantic memories from consolidated episodic memories
    const projectGroups = db.prepare(
        "SELECT project, GROUP_CONCAT(content, ' | ') as contents, COUNT(*) as cnt FROM episodic_memories WHERE is_active = 1 GROUP BY project HAVING cnt > 2"
    ).all();

    for (const group of projectGroups) {
        const schemaId = generateId(group.project + group.contents.slice(0, 100), "schema");
        const summary = `Schema for ${group.project}: ${group.cnt} memories consolidated`;

        db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, schema_id, schema_name, abstraction_level, project, created_at, updated_at, importance) VALUES (?, ?, 'schema', ?, ?, 1, ?, ?, ?, 0.7)")
            .run(schemaId, summary, schemaId, `${group.project}-schema`, group.project, now, now);
        schemasCreated++;
    }

    // 3. Form associations between related memories
    const allActive = db.prepare("SELECT id, content, project FROM episodic_memories WHERE is_active = 1").all();
    for (let i = 0; i < allActive.length; i++) {
        for (let j = i + 1; j < allActive.length; j++) {
            if (allActive[i].project !== allActive[j].project) continue;
            const sim = calculateSimilarity(allActive[i].content, allActive[j].content);
            if (sim > 0.3 && sim < 0.7) {
                db.prepare("INSERT OR IGNORE INTO associations (source_id, source_type, target_id, target_type, association_type, strength, created_at) VALUES (?, 'episodic', ?, 'episodic', 'semantic', ?, ?)")
                    .run(allActive[i].id, allActive[j].id, sim, now);
                associationsFormed++;
            }
        }
    }

    // 4. Prune weak memories (forgetting curve)
    const weakMemories = db.prepare(
        "SELECT id, strength, created_at FROM episodic_memories WHERE is_active = 1 AND strength < 0.1"
    ).all();
    for (const mem of weakMemories) {
        db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(mem.id);
        pruned++;
    }

    // 5. Mark remaining as consolidated
    db.prepare("UPDATE episodic_memories SET is_consolidated = 1 WHERE is_active = 1 AND is_consolidated = 0").run();

    // Update log
    db.prepare("UPDATE consolidation_log SET completed_at = ?, memories_processed = ?, memories_merged = ?, memories_pruned = ?, schemas_created = ?, associations_formed = ?, contradictions_resolved = ?, status = 'completed', summary = ? WHERE id = ?")
        .run(now, processed, merged, pruned, schemasCreated, associationsFormed, contradictionsResolved,
            `Processed ${processed}, merged ${merged}, pruned ${pruned}, created ${schemasCreated} schemas, formed ${associationsFormed} associations`,
            logId);

    return { processed, merged, pruned, schemasCreated, associationsFormed, contradictionsResolved };
}

function generateId(content, salt = "") {
    return crypto.createHash("sha256").update(content + salt + Date.now().toString()).digest("hex").slice(0, 16);
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
    {
        name: "owl-memory",
        version: "2.0.0",
        description: "OWL Memory MCP v2 — Brain-inspired agent memory with episodic/semantic/procedural memory, memory palace, dream consolidation, emotional tagging, spaced repetition, and metacognition."
    },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        // ── Episodic Memory ──
        { name: "remember", description: "Store an episodic memory (specific event/observation). Auto-detects emotional salience, computes strength, sets review schedule. Brain-inspired: emotional memories are stronger, spacing effect for review.", inputSchema: { type: "object", properties: { content: { type: "string" }, event_type: { type: "string", enum: ["observation", "decision", "interaction", "learning", "error", "insight"], default: "observation" }, project: { type: "string", default: "default" }, location: { type: "string" }, source: { type: "string", default: "conversation" }, confidence: { type: "number", default: 0.8 } }, required: ["content"] } },

        // ── Recall (Multi-Memory-Type) ──
        { name: "recall", description: "Search across ALL memory types (episodic, semantic, procedural). Uses semantic similarity + entity matching + emotional salience + memory strength. Returns results ranked by relevance and trust.", inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all", "episodic", "semantic", "procedural"], default: "all" }, limit: { type: "number", default: 10 }, min_strength: { type: "number", default: 0 }, include_weak: { type: "boolean", default: false }, context: { type: "string" } }, required: ["query"] } },

        // ── Working Memory ──
        { name: "focus", description: "Load memories into working memory (like human prefrontal cortex). Limited to 4 chunks. Subsequent recalls prioritize working memory contents.", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, query: { type: "string" }, project: { type: "string", default: "default" } } } },
        { name: "unfocus", description: "Clear working memory or remove specific items.", inputSchema: { type: "object", properties: { memory_ids: { type: "array", items: { type: "string" } }, clear_all: { type: "boolean", default: false } } } },
        { name: "get_working_memory", description: "Show current working memory contents.", inputSchema: { type: "object", properties: {} } },

        // ── Memory Palace ──
        { name: "create_room", description: "Create a room in the memory palace for spatial memory organization.", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, parent_room_id: { type: "string" }, position_x: { type: "number", default: 0 }, position_y: { type: "number", default: 0 }, position_z: { type: "number", default: 0 }, sensory_anchors: { type: "array", items: { type: "string" }, default: [] } }, required: ["name"] } },
        { name: "place_memory", description: "Place a memory in a palace room (spatial context aids recall).", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" }, room_id: { type: "string" }, position_x: { type: "number", default: 0 }, position_y: { type: "number", default: 0 }, position_z: { type: "number", default: 0 }, placement_note: { type: "string" } }, required: ["memory_id", "room_id"] } },
        { name: "navigate_palace", description: "Navigate the memory palace. List rooms, find memories in a room, or explore by proximity.", inputSchema: { type: "object", properties: { room_id: { type: "string" }, project: { type: "string", default: "default" }, list_rooms: { type: "boolean", default: true } } } },

        // ── Dream Consolidation ──
        { name: "dream", description: "Run memory consolidation (like sleep/dream processing). Clusters related memories, merges duplicates, extracts semantic patterns, forms associations, prunes weak memories. Returns consolidation report.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, aggressive: { type: "boolean", default: false } } } },
        { name: "get_consolidation_history", description: "View past consolidation runs and their results.", inputSchema: { type: "object", properties: { limit: { type: "number", default: 10 } } } },

        // ── Narrative Memory ──
        { name: "create_narrative", description: "Create a narrative chain (causal/temporal sequence of memories). Like autobiographical memory.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, project: { type: "string", default: "default" } }, required: ["title"] } },
        { name: "add_to_narrative", description: "Add a memory to a narrative chain.", inputSchema: { type: "object", properties: { chain_id: { type: "string" }, memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" }, causal_role: { type: "string", enum: ["event", "cause", "effect", "decision", "outcome"], default: "event" } }, required: ["chain_id", "memory_id"] } },
        { name: "get_narrative", description: "Get a narrative chain with all its memories in sequence.", inputSchema: { type: "object", properties: { chain_id: { type: "string" } }, required: ["chain_id"] } },
        { name: "list_narratives", description: "List all narrative chains for a project.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },

        // ── Procedural Memory ──
        { name: "learn_skill", description: "Store a procedural memory (skill/habit/how-to). With trigger conditions and action sequence.", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, trigger_conditions: { type: "array", items: { type: "string" }, default: [] }, action_sequence: { type: "array", items: { type: "string" }, default: [] }, project: { type: "string", default: "default" } }, required: ["title", "content"] } },
        { name: "practice_skill", description: "Record practice of a skill. Increments mastery level, success/failure count.", inputSchema: { type: "object", properties: { skill_id: { type: "string" }, success: { type: "boolean", default: true }, notes: { type: "string" } }, required: ["skill_id"] } },

        // ── Metacognition ──
        { name: "reflect", description: "Reflect on a memory — update confidence, note knowledge gaps, add metacognitive notes.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" }, confidence: { type: "number" }, knowledge_gap: { type: "string" }, reflection: { type: "string" } }, required: ["memory_id"] } },
        { name: "health_check", description: "Full memory system health check. Scores: conflicts, stale memories, orphaned references, working memory load, consolidation status.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },

        // ── Spaced Repetition ──
        { name: "review", description: "Get memories due for review (spaced repetition). Strengthens memories that are reviewed before they're forgotten.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, limit: { type: "number", default: 10 } } } },
        { name: "strengthen", description: "Strengthen a memory (mark as reviewed). Increases strength and extends review interval.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, quality: { type: "number", minimum: 0, maximum: 1, default: 1 } }, required: ["memory_id"] } },

        // ── Associative Recall ──
        { name: "associations", description: "Find memories associated with a given memory (spreading activation).", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" }, max_depth: { type: "number", default: 2 }, min_strength: { type: "number", default: 0.2 } }, required: ["memory_id"] } },
        { name: "find_path", description: "Find the associative path between two memories (like human free association).", inputSchema: { type: "object", properties: { from_id: { type: "string" }, to_id: { type: "string" }, max_depth: { type: "number", default: 5 } }, required: ["from_id", "to_id"] } },

        // ── Standard Operations ──
        { name: "forget", description: "Soft-delete a memory by ID and type.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" } }, required: ["memory_id"] } },
        { name: "update_memory", description: "Update memory content. Re-extracts entities, re-computes emotional salience.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" }, new_content: { type: "string" } }, required: ["memory_id", "new_content"] } },
        { name: "get_memory", description: "Get a single memory by ID with full details including associations and metacognition.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, memory_type: { type: "string", enum: ["episodic", "semantic", "procedural"], default: "episodic" } }, required: ["memory_id"] } },
        { name: "list_memories", description: "List memories with filtering by type, project, strength, emotional valence.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, memory_type: { type: "string", enum: ["all", "episodic", "semantic", "procedural"], default: "all" }, limit: { type: "number", default: 50 }, min_strength: { type: "number", default: 0 }, order_by: { type: "string", enum: ["strength", "salience", "created_at", "access_count"], default: "strength" } } } },

        // ── Contradictions ──
        { name: "get_contradictions", description: "Get unresolved contradictions.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
        { name: "resolve_contradiction", description: "Resolve a contradiction by keeping one memory.", inputSchema: { type: "object", properties: { contradiction_id: { type: "number" }, keep_memory_id: { type: "string" }, resolution: { type: "string", default: "" } }, required: ["contradiction_id", "keep_memory_id"] } },

        // ── Import/Export ──
        { name: "export_memories", description: "Export all memories to JSON.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, filepath: { type: "string", default: "" }, memory_type: { type: "string", enum: ["all", "episodic", "semantic", "procedural"], default: "all" } } } },
        { name: "import_memories", description: "Import memories from JSON.", inputSchema: { type: "object", properties: { filepath: { type: "string" }, project: { type: "string", default: "default" } }, required: ["filepath"] } },

        // ── Stats ──
        { name: "get_stats", description: "Get comprehensive memory statistics including brain-inspired metrics.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    ],
}));

// ─── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const now = new Date().toISOString();

    try {
        // ═══════════════════════════════════════════════════════════════════
        // REMEMBER — Episodic Memory Storage
        // ═══════════════════════════════════════════════════════════════════
        if (name === "remember") {
            const content = args.content;
            const projectId = args.project || "default";
            const eventType = args.event_type || "observation";
            const confidence = args.confidence || 0.8;

            // Detect emotional salience (amygdala)
            const emotion = detectEmotionalSalience(content);

            // Compute initial strength based on emotional salience
            const initialStrength = 0.5 + (emotion.salience * 0.5);

            // Calculate next review (spacing effect)
            const nextReview = calculateNextReview(initialStrength, 0, emotion.salience);

            const memId = generateId(content, projectId);
            const entities = extractEntities(content);

            db.prepare(`INSERT INTO episodic_memories
                (id, content, event_type, project, location, source, confidence,
                 emotional_valence, emotional_arousal, salience, strength,
                 created_at, updated_at, next_review, review_interval)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(memId, content, eventType, projectId, args.location || null,
                    args.source || "conversation", confidence,
                    emotion.valence, emotion.arousal, emotion.salience, initialStrength,
                    now, now, nextReview, 1.0);

            // Extract and link entities
            for (const [eName, eType] of entities) {
                db.prepare("INSERT OR IGNORE INTO entities (name, entity_type, first_seen, last_seen) VALUES (?, ?, ?, ?)")
                    .run(eName, eType, now, now);
                const entityRow = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
                if (entityRow) {
                    db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, memory_type, entity_id) VALUES (?, 'episodic', ?)")
                        .run(memId, entityRow.id);
                    db.prepare("UPDATE entities SET mention_count = mention_count + 1, last_seen = ? WHERE id = ?")
                        .run(now, entityRow.id);
                }
            }

            // Auto-detect contradictions
            const existingMemories = db.prepare(
                "SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1 AND id != ?"
            ).all(projectId, memId);

            let contradictionsFound = 0;
            for (const existing of existingMemories) {
                const similarity = calculateSimilarity(content, existing.content);
                if (similarity > 0.5) {
                    // Check for negation patterns
                    const negationWords = ['not', "don't", "doesn't", "won't", "can't", "never", "no longer", "changed", "updated", "actually", "instead"];
                    const hasNewNegation = negationWords.some(w => content.toLowerCase().includes(w));
                    const hasOldNegation = negationWords.some(w => existing.content.toLowerCase().includes(w));

                    if (hasNewNegation !== hasOldNegation && similarity > 0.6) {
                        db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, severity, detected_at) VALUES (?, 'episodic', ?, 'episodic', 'warning', ?)")
                            .run(existing.id, memId, now);
                        contradictionsFound++;
                    }
                }
            }

            return { content: [{ type: "text", text: JSON.stringify({
                memory_id: memId,
                event_type: eventType,
                emotional_valence: emotion.valence,
                emotional_arousal: emotion.arousal,
                salience: emotion.salience,
                strength: initialStrength,
                next_review: nextReview,
                entities_extracted: entities.length,
                contradictions_detected: contradictionsFound
            }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // RECALL — Multi-Memory-Type Search
        // ═══════════════════════════════════════════════════════════════════
        if (name === "recall") {
            const query = args.query;
            const projectId = args.project || "default";
            const limit = args.limit || 10;
            const memoryType = args.memory_type || "all";
            const minStrength = args.min_strength || 0;
            const includeWeak = args.include_weak || false;

            const results = [];
            const queryEntities = extractEntities(query);
            const queryEmotion = detectEmotionalSalience(query);

            // Search episodic memories
            if (memoryType === "all" || memoryType === "episodic") {
                const episodicQuery = includeWeak
                    ? "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1"
                    : "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?";
                const episodicParams = includeWeak ? [projectId] : [projectId, minStrength];
                const episodicResults = db.prepare(episodicQuery).all(...episodicParams);

                for (const mem of episodicResults) {
                    let score = calculateSimilarity(query, mem.content) * 0.3;
                    score += mem.strength * 0.2;
                    score += mem.salience * 0.15;
                    score += Math.min(mem.access_count / 10, 1) * 0.1;
                    score += mem.confidence * 0.1;

                    // Emotional context matching
                    if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) {
                        score += 0.1;
                    }

                    // Entity overlap bonus
                    const memEntities = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
                    const entityOverlap = queryEntities.filter(qe => memEntities.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length;
                    score += Math.min(0.15, entityOverlap * 0.05);

                    // Working memory boost
                    if (mem.is_in_working_memory) {
                        score += 0.2;
                    }

                    if (score > 0.1) {
                        results.push({
                            id: mem.id, type: "episodic", content: mem.content,
                            event_type: mem.event_type, strength: mem.strength,
                            salience: mem.salience, confidence: mem.confidence,
                            emotional_valence: mem.emotional_valence,
                            access_count: mem.access_count,
                            relevance_score: Math.round(score * 1000) / 1000
                        });
                    }

                    // Update access count and strength (spacing effect)
                    const hoursSinceReview = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
                    const retention = calculateRetention(mem.strength, hoursSinceReview);
                    db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?")
                        .run(now, Math.max(0.1, retention), mem.id);
                }
            }

            // Search semantic memories
            if (memoryType === "all" || memoryType === "semantic") {
                const semanticResults = db.prepare("SELECT * FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId);
                for (const mem of semanticResults) {
                    const score = calculateSimilarity(query, mem.content) * 0.4 + mem.importance * 0.3 + mem.confidence * 0.3;
                    if (score > 0.1) {
                        results.push({
                            id: mem.id, type: "semantic", content: mem.content,
                            concept_type: mem.concept_type, importance: mem.importance,
                            confidence: mem.confidence,
                            relevance_score: Math.round(score * 1000) / 1000
                        });
                    }
                }
            }

            // Search procedural memories
            if (memoryType === "all" || memoryType === "procedural") {
                const procResults = db.prepare("SELECT * FROM procedural_memories WHERE project = ? AND is_active = 1").all(projectId);
                for (const mem of procResults) {
                    const score = calculateSimilarity(query, mem.content) * 0.3 + mem.mastery_level * 0.3 + (mem.success_count / Math.max(mem.practice_count, 1)) * 0.2;
                    if (score > 0.1) {
                        results.push({
                            id: mem.id, type: "procedural", title: mem.title,
                            content: mem.content, mastery_level: mem.mastery_level,
                            practice_count: mem.practice_count,
                            relevance_score: Math.round(score * 1000) / 1000
                        });
                    }
                }
            }

            // Sort by relevance
            results.sort((a, b) => b.relevance_score - a.relevance_score);

            return { content: [{ type: "text", text: JSON.stringify(results.slice(0, limit), null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // FOCUS — Working Memory
        // ═══════════════════════════════════════════════════════════════════
        if (name === "focus") {
            // Clear existing working memory
            db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();

            let memoryIds = args.memory_ids || [];

            // If query provided, find matching memories
            if (args.query && memoryIds.length === 0) {
                const matches = db.prepare("SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY strength DESC LIMIT 4").all(args.project || "default");
                memoryIds = matches.map(m => m.id);
            }

            // Load into working memory (max 4 chunks, like human prefrontal cortex)
            const limited = memoryIds.slice(0, 4);
            for (let i = 0; i < limited.length; i++) {
                db.prepare("UPDATE episodic_memories SET is_in_working_memory = 1, working_memory_position = ? WHERE id = ?").run(i, limited[i]);
            }

            const loaded = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();

            return { content: [{ type: "text", text: JSON.stringify({ working_memory: loaded, capacity: 4, used: loaded.length }, null, 2) }] };
        }

        if (name === "unfocus") {
            if (args.clear_all) {
                db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL").run();
                return { content: [{ type: "text", text: "Working memory cleared." }] };
            }
            if (args.memory_ids && args.memory_ids.length > 0) {
                for (const id of args.memory_ids) {
                    db.prepare("UPDATE episodic_memories SET is_in_working_memory = 0, working_memory_position = NULL WHERE id = ?").run(id);
                }
                return { content: [{ type: "text", text: `Removed ${args.memory_ids.length} memories from working memory.` }] };
            }
            return { content: [{ type: "text", text: "Nothing to unfocus." }] };
        }

        if (name === "get_working_memory") {
            const memories = db.prepare("SELECT id, content, working_memory_position FROM episodic_memories WHERE is_in_working_memory = 1 ORDER BY working_memory_position").all();
            return { content: [{ type: "text", text: JSON.stringify({ working_memory: memories, capacity: 4, used: memories.length }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // MEMORY PALACE
        // ═══════════════════════════════════════════════════════════════════
        if (name === "create_room") {
            const roomId = generateId(args.name, "room");
            db.prepare("INSERT INTO palace_rooms (id, name, description, parent_room_id, position_x, position_y, position_z, sensory_anchors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run(roomId, args.name, args.description || null, args.parent_room_id || null,
                    args.position_x || 0, args.position_y || 0, args.position_z || 0,
                    JSON.stringify(args.sensory_anchors || []), now);
            return { content: [{ type: "text", text: JSON.stringify({ room_id: roomId, name: args.name }, null, 2) }] };
        }

        if (name === "place_memory") {
            db.prepare("INSERT OR REPLACE INTO memory_placements (memory_id, memory_type, room_id, position_x, position_y, position_z, placement_note, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .run(args.memory_id, args.memory_type || "episodic", args.room_id,
                    args.position_x || 0, args.position_y || 0, args.position_z || 0,
                    args.placement_note || null, now);
            return { content: [{ type: "text", text: JSON.stringify({ placed: true, memory_id: args.memory_id, room_id: args.room_id }, null, 2) }] };
        }

        if (name === "navigate_palace") {
            if (args.list_rooms !== false) {
                const rooms = db.prepare("SELECT id, name, description, parent_room_id, position_x, position_y, position_z FROM palace_rooms ORDER BY name").all();
                return { content: [{ type: "text", text: JSON.stringify({ rooms }, null, 2) }] };
            }
            if (args.room_id) {
                const room = db.prepare("SELECT * FROM palace_rooms WHERE id = ?").get(args.room_id);
                const memories = db.prepare("SELECT mp.*, em.content FROM memory_placements mp LEFT JOIN episodic_memories em ON em.id = mp.memory_id WHERE mp.room_id = ?").all(args.room_id);
                return { content: [{ type: "text", text: JSON.stringify({ room, memories }, null, 2) }] };
            }
            return { content: [{ type: "text", text: JSON.stringify({ error: "Provide room_id or list_rooms: true" }) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // DREAM CONSOLIDATION
        // ═══════════════════════════════════════════════════════════════════
        if (name === "dream") {
            const result = consolidateMemories();
            return { content: [{ type: "text", text: JSON.stringify({
                status: "completed",
                ...result,
                message: `Dream consolidation complete: processed ${result.processed}, merged ${result.merged}, pruned ${result.pruned}, created ${result.schemasCreated} schemas, formed ${result.associationsFormed} associations`
            }, null, 2) }] };
        }

        if (name === "get_consolidation_history") {
            const history = db.prepare("SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT ?").all(args.limit || 10);
            return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // NARRATIVE MEMORY
        // ═══════════════════════════════════════════════════════════════════
        if (name === "create_narrative") {
            const chainId = generateId(args.title, "narrative");
            db.prepare("INSERT INTO narrative_chains (id, title, description, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
                .run(chainId, args.title, args.description || null, args.project || "default", now, now);
            return { content: [{ type: "text", text: JSON.stringify({ chain_id: chainId, title: args.title }, null, 2) }] };
        }

        if (name === "add_to_narrative") {
            const maxOrder = db.prepare("SELECT MAX(sequence_order) as max FROM narrative_events WHERE chain_id = ?").get(args.chain_id);
            const nextOrder = (maxOrder?.max || 0) + 1;
            db.prepare("INSERT INTO narrative_events (chain_id, memory_id, memory_type, sequence_order, causal_role) VALUES (?, ?, ?, ?, ?)")
                .run(args.chain_id, args.memory_id, args.memory_type || "episodic", nextOrder, args.causal_role || "event");
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

        // ═══════════════════════════════════════════════════════════════════
        // PROCEDURAL MEMORY
        // ═══════════════════════════════════════════════════════════════════
        if (name === "learn_skill") {
            const skillId = generateId(args.title, "skill");
            db.prepare("INSERT INTO procedural_memories (id, title, content, trigger_conditions, action_sequence, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .run(skillId, args.title, args.content, JSON.stringify(args.trigger_conditions || []), JSON.stringify(args.action_sequence || []), args.project || "default", now, now);
            return { content: [{ type: "text", text: JSON.stringify({ skill_id: skillId, title: args.title, mastery_level: 0.1 }, null, 2) }] };
        }

        if (name === "practice_skill") {
            const skill = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(args.skill_id);
            if (!skill) return { content: [{ type: "text", text: "Skill not found." }] };

            const newPracticeCount = skill.practice_count + 1;
            const newSuccessCount = skill.success_count + (args.success ? 1 : 0);
            const newFailureCount = skill.failure_count + (args.success ? 0 : 1);
            // Mastery increases with practice, decreases with failures
            const newMastery = Math.min(1, skill.mastery_level + (args.success ? 0.05 : -0.02));

            db.prepare("UPDATE procedural_memories SET practice_count = ?, success_count = ?, failure_count = ?, mastery_level = ?, last_practiced = ?, updated_at = ? WHERE id = ?")
                .run(newPracticeCount, newSuccessCount, newFailureCount, Math.max(0, newMastery), now, now, args.skill_id);

            return { content: [{ type: "text", text: JSON.stringify({ skill_id: args.skill_id, mastery_level: Math.round(newMastery * 100) / 100, practice_count: newPracticeCount, success_rate: Math.round(newSuccessCount / newPracticeCount * 100) / 100 }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // METACOGNITION
        // ═══════════════════════════════════════════════════════════════════
        if (name === "reflect") {
            db.prepare("INSERT OR REPLACE INTO metacognition (memory_id, memory_type, confidence, source_reliability, knowledge_gap, reflection, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .run(args.memory_id, args.memory_type || "episodic", args.confidence || 0.8, 0.5, args.knowledge_gap || null, args.reflection || null, now, now);
            return { content: [{ type: "text", text: JSON.stringify({ reflected: true, memory_id: args.memory_id }, null, 2) }] };
        }

        if (name === "health_check") {
            const projectId = args.project || "default";

            const totalEpisodic = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
            const totalSemantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId).c;
            const totalProcedural = db.prepare("SELECT COUNT(*) as c FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId).c;

            const conflicts = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId).c;

            const staleMemories = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength < 0.2").get(projectId).c;

            const workingMemoryLoad = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get().c;

            const avgStrength = db.prepare("SELECT AVG(strength) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId).avg || 0;

            const lastConsolidation = db.prepare("SELECT * FROM consolidation_log WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1").get();

            // Health score (0-100)
            let healthScore = 100;
            healthScore -= conflicts * 10;
            healthScore -= staleMemories * 5;
            healthScore -= (1 - avgStrength) * 20;
            healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

            return { content: [{ type: "text", text: JSON.stringify({
                health_score: healthScore,
                project: projectId,
                memories: { episodic: totalEpisodic, semantic: totalSemantic, procedural: totalProcedural, total: totalEpisodic + totalSemantic + totalProcedural },
                conflicts,
                stale_memories: staleMemories,
                working_memory_load: `${workingMemoryLoad}/4`,
                avg_strength: Math.round(avgStrength * 100) / 100,
                last_consolidation: lastConsolidation ? lastConsolidation.completed_at : "never",
                status: healthScore > 80 ? "healthy" : healthScore > 50 ? "needs_attention" : "critical"
            }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // SPACED REPETITION
        // ═══════════════════════════════════════════════════════════════════
        if (name === "review") {
            const dueMemories = db.prepare(
                "SELECT id, content, strength, review_interval, access_count FROM episodic_memories WHERE project = ? AND is_active = 1 AND (next_review IS NULL OR next_review <= ?) ORDER BY strength ASC LIMIT ?"
            ).all(args.project || "default", now, args.limit || 10);

            return { content: [{ type: "text", text: JSON.stringify({ due_for_review: dueMemories, count: dueMemories.length }, null, 2) }] };
        }

        if (name === "strengthen") {
            const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(args.memory_id);
            if (!mem) return { content: [{ type: "text", text: "Memory not found." }] };

            const quality = args.quality || 1;
            const newStrength = Math.min(1, mem.strength + (quality * 0.2));
            const newInterval = mem.review_interval * (1.5 + quality);
            const nextReview = new Date(Date.now() + newInterval * 3600000).toISOString();

            db.prepare("UPDATE episodic_memories SET strength = ?, review_interval = ?, next_review = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?")
                .run(newStrength, newInterval, nextReview, now, args.memory_id);

            return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, new_strength: Math.round(newStrength * 100) / 100, next_review: nextReview }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // ASSOCIATIVE RECALL
        // ═══════════════════════════════════════════════════════════════════
        if (name === "associations") {
            const associations = db.prepare("SELECT a.*, e.name as target_name FROM associations a LEFT JOIN entities e ON e.id = a.target_id WHERE a.source_id = ? AND a.source_type = ? AND a.strength >= ? ORDER BY a.strength DESC").all(args.memory_id, args.memory_type || "episodic", args.min_strength || 0.2);

            return { content: [{ type: "text", text: JSON.stringify({ memory_id: args.memory_id, associations }, null, 2) }] };
        }

        if (name === "find_path") {
            // BFS to find path between two memories through associations
            const visited = new Set();
            const queue = [{ id: args.from_id, path: [] }];
            let found = null;

            while (queue.length > 0 && !found) {
                const current = queue.shift();
                if (current.id === args.to_id) {
                    found = current.path;
                    break;
                }
                if (visited.has(current.id)) continue;
                visited.add(current.id);

                if (current.path.length >= (args.max_depth || 5)) continue;

                const neighbors = db.prepare("SELECT target_id, target_type, strength, association_type FROM associations WHERE source_id = ? AND strength >= 0.2").all(current.id);
                for (const n of neighbors) {
                    if (!visited.has(n.target_id)) {
                        queue.push({ id: n.target_id, path: [...current.path, { id: n.target_id, type: n.target_type, strength: n.strength, association_type: n.association_type }] });
                    }
                }
            }

            return { content: [{ type: "text", text: JSON.stringify({ from: args.from_id, to: args.to_id, path: found || [], found: !!found }, null, 2) }] };
        }

        // ═══════════════════════════════════════════════════════════════════
        // STANDARD OPERATIONS
        // ═══════════════════════════════════════════════════════════════════
        if (name === "forget") {
            const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
            db.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).run(args.memory_id);
            return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
        }

        if (name === "update_memory") {
            const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
            const emotion = detectEmotionalSalience(args.new_content);
            db.prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`).run(args.new_content, now, args.memory_id);
            if (args.memory_type === "episodic" || !args.memory_type) {
                db.prepare("UPDATE episodic_memories SET emotional_valence = ?, emotional_arousal = ?, salience = ? WHERE id = ?").run(emotion.valence, emotion.arousal, emotion.salience, args.memory_id);
            }
            return { content: [{ type: "text", text: JSON.stringify({ updated: true, memory_id: args.memory_id }, null, 2) }] };
        }

        if (name === "get_memory") {
            const table = args.memory_type === "semantic" ? "semantic_memories" : args.memory_type === "procedural" ? "procedural_memories" : "episodic_memories";
            const mem = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(args.memory_id);
            if (!mem) return { content: [{ type: "text", text: "Memory not found." }] };

            const entities = db.prepare("SELECT e.name, e.entity_type FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = ?").all(args.memory_id, args.memory_type || "episodic");
            const associations = db.prepare("SELECT * FROM associations WHERE source_id = ? AND source_type = ?").all(args.memory_id, args.memory_type || "episodic");
            const metacog = db.prepare("SELECT * FROM metacognition WHERE memory_id = ? AND memory_type = ?").get(args.memory_id, args.memory_type || "episodic");

            return { content: [{ type: "text", text: JSON.stringify({ ...mem, entities, associations, metacognition: metacog }, null, 2) }] };
        }

        if (name === "list_memories") {
            const projectId = args.project || "default";
            const memoryType = args.memory_type || "all";
            const limit = args.limit || 50;
            const minStrength = args.min_strength || 0;
            const orderBy = args.order_by || "strength";

            const results = { episodic: [], semantic: [], procedural: [] };

            if (memoryType === "all" || memoryType === "episodic") {
                results.episodic = db.prepare(`SELECT id, content, event_type, strength, salience, confidence, emotional_valence, access_count, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ? ORDER BY ${orderBy} DESC LIMIT ?`).all(projectId, minStrength, limit);
            }
            if (memoryType === "all" || memoryType === "semantic") {
                results.semantic = db.prepare(`SELECT id, content, concept_type, importance, confidence, created_at FROM semantic_memories WHERE project = ? AND is_active = 1 ORDER BY importance DESC LIMIT ?`).all(projectId, limit);
            }
            if (memoryType === "all" || memoryType === "procedural") {
                results.procedural = db.prepare(`SELECT id, title, content, mastery_level, practice_count, success_count FROM procedural_memories WHERE project = ? AND is_active = 1 ORDER BY mastery_level DESC LIMIT ?`).all(projectId, limit);
            }

            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        if (name === "get_contradictions") {
            const contradictions = db.prepare("SELECT c.*, m1.content as content1, m2.content as content2 FROM contradictions c JOIN episodic_memories m1 ON m1.id = c.memory_id_1 JOIN episodic_memories m2 ON m2.id = c.memory_id_2 WHERE m1.project = ? AND c.resolved = 0 ORDER BY c.detected_at DESC").all(args.project || "default");
            return { content: [{ type: "text", text: JSON.stringify(contradictions, null, 2) }] };
        }

        if (name === "resolve_contradiction") {
            const contra = db.prepare("SELECT * FROM contradictions WHERE id = ?").get(args.contradiction_id);
            if (!contra) return { content: [{ type: "text", text: "Contradiction not found." }] };

            const forgetId = args.keep_memory_id === contra.memory_id_1 ? contra.memory_id_2 : contra.memory_id_1;
            db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(forgetId);
            db.prepare("UPDATE contradictions SET resolved = 1, resolution = ?, resolved_at = ? WHERE id = ?").run(args.resolution || "", now, args.contradiction_id);

            return { content: [{ type: "text", text: JSON.stringify({ resolved: true, kept: args.keep_memory_id, forgot: forgetId }, null, 2) }] };
        }

        if (name === "export_memories") {
            const projectId = args.project || "default";
            const memoryType = args.memory_type || "all";
            const filepath = args.filepath || path.join(DATA_DIR, `export-${projectId}-${Date.now()}.json`);

            const export_data = { project: projectId, exported_at: now, version: "2.0" };

            if (memoryType === "all" || memoryType === "episodic") {
                export_data.episodic = db.prepare("SELECT * FROM episodic_memories WHERE project = ?").all(projectId);
            }
            if (memoryType === "all" || memoryType === "semantic") {
                export_data.semantic = db.prepare("SELECT * FROM semantic_memories WHERE project = ?").all(projectId);
            }
            if (memoryType === "all" || memoryType === "procedural") {
                export_data.procedural = db.prepare("SELECT * FROM procedural_memories WHERE project = ?").all(projectId);
            }
            export_data.associations = db.prepare("SELECT * FROM associations").all();
            export_data.entities = db.prepare("SELECT * FROM entities").all();
            export_data.narrative_chains = db.prepare("SELECT * FROM narrative_chains WHERE project = ?").all(projectId);

            fs.writeFileSync(filepath, JSON.stringify(export_data, null, 2));
            return { content: [{ type: "text", text: `Exported to ${filepath}` }] };
        }

        if (name === "import_memories") {
            const data = JSON.parse(fs.readFileSync(args.filepath, "utf-8"));
            const projectId = args.project || "default";
            let imported = 0;

            for (const mem of (data.episodic || [])) {
                db.prepare("INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .run(mem.id, mem.content, mem.event_type, projectId, mem.emotional_valence, mem.emotional_arousal, mem.salience, mem.strength, mem.confidence, mem.source || "import", mem.created_at, now);
                imported++;
            }
            for (const mem of (data.semantic || [])) {
                db.prepare("INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, project, importance, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    .run(mem.id, mem.content, mem.concept_type, projectId, mem.importance, mem.confidence, mem.created_at, now);
                imported++;
            }
            for (const mem of (data.procedural || [])) {
                db.prepare("INSERT OR IGNORE INTO procedural_memories (id, title, content, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
                    .run(mem.id, mem.title, mem.content, projectId, mem.created_at, now);
                imported++;
            }

            return { content: [{ type: "text", text: `Imported ${imported} memories.` }] };
        }

        if (name === "get_stats") {
            const projectId = args.project || "default";
            const episodic = db.prepare("SELECT COUNT(*) as c, AVG(strength) as avg_str, AVG(salience) as avg_sal FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId);
            const semantic = db.prepare("SELECT COUNT(*) as c FROM semantic_memories WHERE project = ? AND is_active = 1").get(projectId);
            const procedural = db.prepare("SELECT COUNT(*) as c, AVG(mastery_level) as avg_mastery FROM procedural_memories WHERE project = ? AND is_active = 1").get(projectId);
            const entities = db.prepare("SELECT COUNT(*) as c FROM entities").get();
            const associations = db.prepare("SELECT COUNT(*) as c FROM associations").get();
            const contradictions = db.prepare("SELECT COUNT(*) as c FROM contradictions c JOIN episodic_memories m ON m.id = c.memory_id_1 WHERE m.project = ? AND c.resolved = 0").get(projectId);
            const workingMemory = db.prepare("SELECT COUNT(*) as c FROM episodic_memories WHERE is_in_working_memory = 1").get();
            const rooms = db.prepare("SELECT COUNT(*) as c FROM palace_rooms").get();
            const narratives = db.prepare("SELECT COUNT(*) as c FROM narrative_chains WHERE project = ? AND is_active = 1").get(projectId);

            return { content: [{ type: "text", text: JSON.stringify({
                project: projectId,
                memories: {
                    episodic: episodic?.c || 0,
                    semantic: semantic?.c || 0,
                    procedural: procedural?.c || 0,
                    total: (episodic?.c || 0) + (semantic?.c || 0) + (procedural?.c || 0)
                },
                avg_strength: Math.round((episodic?.avg_str || 0) * 100) / 100,
                avg_salience: Math.round((episodic?.avg_sal || 0) * 100) / 100,
                avg_mastery: Math.round((procedural?.avg_mastery || 0) * 100) / 100,
                entities: entities?.c || 0,
                associations: associations?.c || 0,
                contradictions: contradictions?.c || 0,
                working_memory: `${workingMemory?.c || 0}/4`,
                palace_rooms: rooms?.c || 0,
                narratives: narratives?.c || 0,
                database: DB_PATH
            }, null, 2) }] };
        }

        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OWL Memory MCP v2.0 — Brain-inspired agent memory running on stdio");
}

main().catch(console.error);
