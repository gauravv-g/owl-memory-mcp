// Build OWL Memory MCP v3.1 with vector embeddings
// This script patches v3_final.js → v3.1.js with vector search capability

const fs = require('fs');
const path = require('path');

const input = path.join(__dirname, 'owl_memory_v3_final.js');
const output = path.join(__dirname, 'owl_memory_v3.1.js');

let code = fs.readFileSync(input, 'utf-8');

// ─── 1. Add embedding utilities after crypto import ───
code = code.replace(
  'const crypto = require("crypto");',
  `const crypto = require("crypto");

// ─── Vector Embeddings (sqlite-vec + local Xenova model) ────────────────────
let sqliteVecLoaded = false;
let embedder = null;
let embedderLoading = null;
let hasVectors = false;

function loadSqliteVec(db) {
  if (sqliteVecLoaded) return true;
  try {
    const vecDll = path.join(__dirname, "node_modules", "sqlite-vec-windows-x64", "vec0.dll");
    if (fs.existsSync(vecDll)) { db.loadExtension(vecDll); sqliteVecLoaded = true; return true; }
  } catch (e) { console.error("sqlite-vec load:", e.message); }
  return false;
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;
  embedderLoading = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
      console.error("Embedding model: Xenova/all-MiniLM-L6-v2 (384 dims, quantized)");
      return embedder;
    } catch (e) { console.error("Embedder load:", e.message); embedderLoading = null; return null; }
  })();
  return embedderLoading;
}

async function generateEmbedding(text) {
  const m = await getEmbedder();
  if (!m) return null;
  try {
    const out = await m(text.slice(0, 512), { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (e) { console.error("Embedding:", e.message); return null; }
}

function storeEmbedding(db, memoryId, embedding) {
  if (!hasVectors || !embedding || embedding.length !== 384) return;
  try {
    db.exec(\`INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (\${memoryId}, '\${JSON.stringify(embedding)}')\`);
  } catch (e) { console.error("Store embedding:", e.message); }
}`
);

// ─── 2. After DB pragma setup, load extension and create virtual table ───
code = code.replace(
  'db.pragma("synchronous = NORMAL");',
  `db.pragma("synchronous = NORMAL");
hasVectors = loadSqliteVec(db);
if (hasVectors) {
  db.exec(\`CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(embedding float[384]);\`);
}`
);

// ─── 3. Update version ───
code = code.replace('version: "3.0.0"', 'version: "3.1.0"');

// ─── 4. Find the remember handler and add embedding storage after somatic creation ───
// Look for the specific pattern at the end of the remember handler's contradiction detection
const rememberEndOfSomatic = 'if (emotion.salience > 0.3) {\n        for (const [eName, eType] of entities) {\n          if (eType === "proper_noun" || eType === "quoted") {\n            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")\n              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);\n          }\n        }\n      }\n\n      // Store vector embedding';  

code = code.replace(
  'if (emotion.salience > 0.3) {\n        for (const [eName, eType] of entities) {\n          if (eType === "proper_noun" || eType === "quoted") {\n            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")\n              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);\n          }\n        }\n      }',
  'if (emotion.salience > 0.3) {\n        for (const [eName, eType] of entities) {\n          if (eType === "proper_noun" || eType === "quoted") {\n            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")\n              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);\n          }\n        }\n      }\n\n      // Store vector embedding (async, non-blocking)\n      generateEmbedding(content).then(emb => storeEmbedding(db, memId, emb)).catch(() => {});'
);

// ─── 5. Find the recall handler's episodic search and upgrade to hybrid ───
// This is the big one - replace the entire episodic search block
const oldEpisodicSearch = `if (memoryType === "all" || memoryType === "episodic") {
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
      }`;

const newEpisodicSearch = `if (memoryType === "all" || memoryType === "episodic") {
        // Phase 1: Vector search (semantic similarity)
        let vectorScores = new Map();
        if (hasVectors) {
          const queryEmb = await generateEmbedding(query);
          if (queryEmb && queryEmb.length === 384) {
            try {
              const vecRows = db.prepare("SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 50 ORDER BY distance").all(JSON.stringify(queryEmb));
              for (const vr of vecRows) {
                vectorScores.set(vr.rowid, 1 - Math.min(vr.distance, 1)); // Convert distance to similarity
              }
            } catch (e) { console.error("Vector search:", e.message); }
          }
        }

        // Phase 2: BM25 + metadata search (keyword + structured)
        const q = includeWeak ? "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1" : "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?";
        const p = includeWeak ? [projectId] : [projectId, minStrength];
        const candidateIds = new Set();
        
        for (const mem of db.prepare(q).all(...p)) {
          candidateIds.add(mem.id);
          let bm25Score = calculateSimilarity(query, mem.content) * 0.3 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) bm25Score += 0.1;
          const memEntities = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          bm25Score += Math.min(0.15, queryEntities.filter(qe => memEntities.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) bm25Score += 0.1;
          if (moodContext && mem.mood_tag === moodContext) bm25Score += 0.1;
          if (mem.developmental_stage === "abstracted") bm25Score += 0.05;
          if (mem.developmental_stage === "consolidated") bm25Score += 0.03;

          // Hybrid: combine BM25 + vector scores
          const vecScore = vectorScores.get(mem.id) || 0;
          const finalScore = bm25Score * 0.4 + vecScore * 0.6; // 40% keyword, 60% semantic
          
          if (finalScore > 0.05 || vecScore > 0.3) { // Lower threshold if vector match is strong
            results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, salience: mem.salience, confidence: mem.confidence, emotional_valence: mem.emotional_valence, developmental_stage: mem.developmental_stage, mood_tag: mem.mood_tag, access_count: mem.access_count, relevance_score: Math.round(finalScore * 1000) / 1000, vector_score: vecScore, bm25_score: bm25Score });
          }
          
          const hoursSince = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hoursSince)), mem.id);
        }

        // Phase 3: Add vector-only hits that weren't in BM25 results
        for (const [memId, vecScore] of vectorScores) {
          if (!candidateIds.has(memId) && vecScore > 0.3) {
            const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND project = ? AND is_active = 1").get(memId, projectId);
            if (mem) {
              const finalScore = vecScore * 0.6; // Vector only
              results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, salience: mem.salience, confidence: mem.confidence, emotional_valence: mem.emotional_valence, developmental_stage: mem.developmental_stage, mood_tag: mem.mood_tag, access_count: mem.access_count, relevance_score: Math.round(finalScore * 1000) / 1000, vector_score: vecScore, bm25_score: 0 });
            }
          }
        }
      }`;

code = code.replace(oldEpisodicSearch, newEpisodicSearch);

// ─── Write output ───
fs.writeFileSync(output, code);
console.log('Created:', output);
console.log('Size:', fs.statSync(output).size, 'bytes');

// Verify syntax
try {
  require('child_process').execSync(`node -c "${output}"`, { encoding: 'utf8' });
  console.log('✓ Syntax OK');
} catch (e) {
  console.log('✗ Syntax ERROR:', e.stderr?.slice(0, 500));
}

// Count key changes
const changes = {
  'sqlite-vec': (code.match(/sqlite-vec/g) || []).length,
  'generateEmbedding': (code.match(/generateEmbedding/g) || []).length,
  'episodic_embeddings': (code.match(/episodic_embeddings/g) || []).length,
  'vector_score': (code.match(/vector_score/g) || []).length,
  'v3.1.0': (code.match(/3\.1\.0/g) || []).length,
};
console.log('Key changes:', JSON.stringify(changes, null, 2));
