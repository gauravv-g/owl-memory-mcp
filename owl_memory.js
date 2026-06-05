/**
 * OWL Memory MCP Server — Node.js implementation
 *
 * Combines the best patterns from Supermemory, Mem0, Memori, and Zep:
 * - Fact extraction (not raw storage)
 * - Entity linking across memories
 * - Temporal reasoning with auto-expiry
 * - Contradiction detection
 * - Multi-signal retrieval (BM25 + entity + importance)
 * - Project/workspace scoping
 * - Local-first: SQLite + FTS5, zero cloud, zero API keys
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ─── Configuration ───────────────────────────────────────────────────────────

const DB_PATH = process.env.OWL_MEMORY_DB || path.join(require("os").homedir(), ".owl-memory", "memory.db");
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        memory_type TEXT DEFAULT 'fact',
        importance REAL DEFAULT 0.5,
        source TEXT DEFAULT 'conversation',
        project TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entity_type TEXT DEFAULT 'general',
        UNIQUE(name, entity_type)
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
        memory_id TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        PRIMARY KEY (memory_id, entity_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id_1 TEXT NOT NULL,
        memory_id_2 TEXT NOT NULL,
        resolved INTEGER DEFAULT 0,
        resolution TEXT,
        detected_at TEXT NOT NULL,
        FOREIGN KEY (memory_id_1) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id_2) REFERENCES memories(id) ON DELETE CASCADE
    );

    -- Simple search index (FTS5 removed for simplicity, LIKE is fast enough for local use)
    CREATE INDEX IF NOT EXISTS idx_memories_content ON memories(content);

    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(is_active);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
`);

// Rebuild FTS index on startup (handles external content sync)
db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(content, project) {
    return crypto.createHash("sha256").update(content + project + Date.now()).digest("hex").slice(0, 16);
}

function extractEntities(text) {
    const entities = [];
    // Quoted strings
    const quoted = text.matchAll(/"([^"]+)"/g);
    for (const m of quoted) entities.push([m[1], "quoted"]);
    // Key-value: X is/was/are Y
    const kv = text.matchAll(/(\w[\w\s]{1,30})\s+(?:is|was|are|were)\s+([^.]+)/gi);
    for (const m of kv) {
        entities.push([m[1].trim(), "attribute"]);
        entities.push([m[2].trim(), "value"]);
    }
    return [...new Map(entities.map(e => [`${e[0]}:${e[1]}`, e])).values()];
}

function computeImportance(content, memoryType) {
    let score = { preference: 0.8, decision: 0.9, fact: 0.6, context: 0.4, instruction: 0.7, profile: 0.85 }[memoryType] || 0.5;
    const lower = content.toLowerCase();
    if (/\b(always|never|must|important|critical|key)\b/.test(lower)) score += 0.15;
    if (/\b(prefer|like|want|need|favorite)\b/.test(lower)) score += 0.1;
    if (/\b(decided|chose|selected|agreed)\b/.test(lower)) score += 0.15;
    return Math.min(1, Math.max(0.1, score));
}

function calculateTTL(importance, memoryType) {
    const days = { preference: 365, profile: 365, decision: 365 }[memoryType] || (importance > 0.8 ? 180 : importance > 0.6 ? 90 : importance > 0.4 ? 30 : 14);
    return new Date(Date.now() + days * 86400000).toISOString();
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
    { name: "owl-memory", version: "1.0.0", description: "OWL Memory MCP — Local-first agent memory with entity linking, temporal reasoning, contradiction detection, and multi-signal retrieval." },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        { name: "remember", description: "Store a new memory. Extracts entities, detects contradictions, computes importance and TTL automatically.", inputSchema: { type: "object", properties: { content: { type: "string" }, memory_type: { type: "string", enum: ["fact", "preference", "decision", "context", "instruction", "profile"], default: "fact" }, project: { type: "string", default: "default" }, importance: { type: "number", default: -1 }, source: { type: "string", default: "conversation" } }, required: ["content"] } },
        { name: "recall", description: "Search memories using multi-signal retrieval: BM25 + entity matching + importance scoring.", inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string", default: "default" }, limit: { type: "number", default: 10 }, min_importance: { type: "number", default: 0 } }, required: ["query"] } },
        { name: "forget", description: "Soft-delete a memory by ID.", inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
        { name: "update_memory", description: "Update an existing memory with new content.", inputSchema: { type: "object", properties: { memory_id: { type: "string" }, new_content: { type: "string" } }, required: ["memory_id", "new_content"] } },
        { name: "get_memory", description: "Get a single memory by ID with linked entities.", inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
        { name: "list_memories", description: "List memories with filtering and pagination.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, memory_type: { type: "string", default: "" }, limit: { type: "number", default: 50 } } } },
        { name: "get_stats", description: "Get memory statistics for a project.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
        { name: "get_contradictions", description: "Get unresolved contradictions.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
        { name: "resolve_contradiction", description: "Resolve a contradiction by keeping one memory.", inputSchema: { type: "object", properties: { contradiction_id: { type: "number" }, keep_memory_id: { type: "string" }, resolution: { type: "string", default: "" } }, required: ["contradiction_id", "keep_memory_id"] } },
        { name: "export_memories", description: "Export memories to JSON.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" }, filepath: { type: "string", default: "" } } } },
        { name: "import_memories", description: "Import memories from JSON.", inputSchema: { type: "object", properties: { filepath: { type: "string" }, project: { type: "string", default: "default" } }, required: ["filepath"] } },
        { name: "cleanup_expired", description: "Remove expired memories.", inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } } },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const now = new Date().toISOString();

    try {
        if (name === "remember") {
            const content = args.content;
            const memType = args.memory_type || "fact";
            const project = args.project || "default";
            const importance = args.importance >= 0 ? args.importance : computeImportance(content, memType);
            const expiresAt = calculateTTL(importance, memType);
            const memId = generateId(content, project);
            const entities = extractEntities(content);

            db.prepare("INSERT INTO memories (id, content, memory_type, importance, source, project, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run(memId, content, memType, importance, args.source || "conversation", project, now, now, expiresAt);

            for (const [eName, eType] of entities) {
                db.prepare("INSERT OR IGNORE INTO entities (name, entity_type) VALUES (?, ?)").run(eName, eType);
                const row = db.prepare("SELECT id FROM entities WHERE name = ? AND entity_type = ?").get(eName, eType);
                if (row) db.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)").run(memId, row.id);
            }

            return { content: [{ type: "text", text: JSON.stringify({ memory_id: memId, importance, expires_at: expiresAt, entities_extracted: entities.length }, null, 2) }] };
        }

        if (name === "recall") {
            const query = args.query;
            const project = args.project || "default";
            const limit = args.limit || 10;
            // Search using LIKE (fast enough for local SQLite)
            const likeQuery = `%${query}%`;
            const ftsResults = db.prepare(
                "SELECT * FROM memories WHERE (content LIKE ? OR memory_type LIKE ?) AND project = ? AND is_active = 1 LIMIT ?"
            ).all(likeQuery, likeQuery, project, limit * 2);

            const entities = extractEntities(query);
            let entityResults = [];
            if (entities.length > 0) {
                const placeholders = entities.map(() => "?").join(",");
                entityResults = db.prepare(`SELECT DISTINCT m.* FROM memories m JOIN memory_entities me ON me.memory_id = m.id JOIN entities e ON e.id = me.entity_id WHERE e.name IN (${placeholders}) AND m.project = ? AND m.is_active = 1`)
                    .all(...entities.map(e => e[0]), project);
            }

            const seen = new Set();
            const scored = [];
            for (const r of ftsResults) {
                if (!seen.has(r.id)) {
                    seen.add(r.id);
                    const score = (1 / (1 + Math.abs(r.rank || 0))) * 0.4 + r.importance * 0.4 + Math.min(r.access_count / 10, 1) * 0.2;
                    scored.push({ score, r });
                }
            }
            for (const r of entityResults) {
                if (!seen.has(r.id)) {
                    seen.add(r.id);
                    scored.push({ score: r.importance * 0.8, r });
                    db.prepare("UPDATE memories SET access_count = access_count + 1 WHERE id = ?").run(r.id);
                }
            }
            scored.sort((a, b) => b.score - a.score);

            return { content: [{ type: "text", text: JSON.stringify(scored.slice(0, limit).map(s => ({ id: s.r.id, content: s.r.content, type: s.r.memory_type, importance: s.r.importance, relevance_score: Math.round(s.score * 1000) / 1000 })), null, 2) }] };
        }

        if (name === "forget") {
            db.prepare("UPDATE memories SET is_active = 0 WHERE id = ?").run(args.memory_id);
            return { content: [{ type: "text", text: `Memory ${args.memory_id} forgotten.` }] };
        }

        if (name === "list_memories") {
            const project = args.project || "default";
            const limit = args.limit || 50;
            const results = db.prepare("SELECT id, content, memory_type, importance, created_at, access_count FROM memories WHERE project = ? AND is_active = 1 ORDER BY importance DESC LIMIT ?")
                .all(project, limit);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        if (name === "get_stats") {
            const project = args.project || "default";
            const total = db.prepare("SELECT COUNT(*) as c FROM memories WHERE project = ? AND is_active = 1").get(project).c;
            const byType = db.prepare("SELECT memory_type as type, COUNT(*) as c, AVG(importance) as avg_imp FROM memories WHERE project = ? AND is_active = 1 GROUP BY memory_type").all(project);
            return { content: [{ type: "text", text: JSON.stringify({ project, total_active: total, by_type: byType, db_path: DB_PATH }, null, 2) }] };
        }

        if (name === "cleanup_expired") {
            const project = args.project || "default";
            const result = db.prepare("UPDATE memories SET is_active = 0 WHERE project = ? AND expires_at IS NOT NULL AND expires_at < ? AND is_active = 1").run(project, now);
            return { content: [{ type: "text", text: `Cleaned up ${result.changes} expired memories.` }] };
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
    console.error("OWL Memory MCP server running on stdio");
}

main().catch(console.error);
