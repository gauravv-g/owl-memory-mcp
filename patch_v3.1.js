// Patch owl_memory_v3_final.js to add vector embeddings (v3.1)
const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'owl_memory_v3_final.js');
const outputPath = path.join(__dirname, 'owl_memory_v3.1.js');

let code = fs.readFileSync(inputPath, 'utf-8');

// ─── PATCH 1: Add sqlite-vec import and embedding model loading ───
const patch1Old = `const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");`;

const patch1New = `const Database = require("better-sqlite3");
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
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      });
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
}`;

code = code.replace(patch1Old, patch1New);

// ─── PATCH 2: After DB creation, load sqlite-vec and create virtual table ───
const patch2Old = `db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");`;

const patch2New = `db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// Load sqlite-vec extension
const hasVectors = loadSqliteVec(db);

// Create vector index table if sqlite-vec is available
if (hasVectors) {
  db.exec(\`
    CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(
      memory_id INTEGER PRIMARY KEY,
      embedding float[384]
    );
  \`);
}`;

code = code.replace(patch2Old, patch2New);

// ─── PATCH 3: In remember handler, store embedding after insert ───
// Find the pattern after the somatic memory creation in remember
const patch3Old = `      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }`;

const patch3New = `      if (emotion.salience > 0.3) {
        for (const [eName, eType] of entities) {
          if (eType === "proper_noun" || eType === "quoted") {
            db.prepare("INSERT OR IGNORE INTO somatic_memories (id, entity_name, entity_type, somatic_valence, somatic_arousal, somatic_weight, source_episodes, last_triggered, trigger_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
              .run(generateId(eName, "somatic"), eName, eType, emotion.valence, emotion.arousal, emotion.salience * 0.3, JSON.stringify([memId]), now, now);
          }
        }
      }

      // Store vector embedding (async, non-blocking)
      if (hasVectors) {
        generateEmbedding(content).then(emb => {
          if (emb && emb.length === 384) {
            try {
              db.prepare('INSERT OR REPLACE INTO episodic_embeddings(memory_id, embedding) VALUES (?, ?)')
                .run(memId, JSON.stringify(emb));
            } catch (e) {
              console.error('Embedding store failed:', e.message);
            }
          }
        }).catch(() => {});
      }`;

code = code.replace(patch3Old, patch3New);

// ─── PATCH 4: Upgrade recall to use vector + BM25 hybrid ───
// Find the episodic search section in recall
const patch4Old = `      if (memoryType === "all" || memoryType === "episodic") {
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

const patch4New = `      if (memoryType === "all" || memoryType === "episodic") {
        // Vector search (if available)
        let vectorResults = new Map();
        if (hasVectors) {
          const queryEmb = await generateEmbedding(query);
          if (queryEmb && queryEmb.length === 384) {
            try {
              const vecRows = db.prepare(
                'SELECT memory_id, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 20 ORDER BY distance'
              ).all(JSON.stringify(queryEmb));
              for (const vr of vecRows) {
                // Convert distance to similarity score (cosine distance → similarity)
                vectorResults.set(vr.memory_id, 1 - Math.min(vr.distance, 1));
              }
            } catch (e) {
              console.error('Vector search failed:', e.message);
            }
          }
        }

        // BM25 + metadata search (existing)
        const q = includeWeak ? "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1" : "SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND strength >= ?";
        const p = includeWeak ? [projectId] : [projectId, minStrength];
        for (const mem of db.prepare(q).all(...p)) {
          let score = calculateSimilarity(query, mem.content) * 0.2 + mem.strength * 0.15 + mem.salience * 0.1 + Math.min(mem.access_count / 10, 1) * 0.1 + mem.confidence * 0.1;
          if (Math.abs(queryEmotion.valence - mem.emotional_valence) < 0.3) score += 0.1;
          const memEntities = db.prepare("SELECT e.name FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = ? AND me.memory_type = 'episodic'").all(mem.id);
          score += Math.min(0.15, queryEntities.filter(qe => memEntities.some(me => me.name.toLowerCase() === qe[0].toLowerCase())).length * 0.05);
          if (mem.is_in_working_memory) score += 0.1;
          if (moodContext && mem.mood_tag === moodContext) score += 0.1;
          if (mem.developmental_stage === "abstracted") score += 0.05;
          if (mem.developmental_stage === "consolidated") score += 0.03;

          // Vector similarity boost
          const vecScore = vectorResults.get(mem.id);
          if (vecScore !== undefined) {
            score = score * 0.5 + vecScore * 0.5; // 50% BM25, 50% vector
          }

          if (score > 0.1) results.push({ id: mem.id, type: "episodic", content: mem.content, event_type: mem.event_type, strength: mem.strength, salience: mem.salience, confidence: mem.confidence, emotional_valence: mem.emotional_valence, developmental_stage: mem.developmental_stage, mood_tag: mem.mood_tag, access_count: mem.access_count, relevance_score: Math.round(score * 1000) / 1000, vector_score: vecScore });
          const hoursSince = mem.last_accessed ? (Date.now() - new Date(mem.last_accessed).getTime()) / 3600000 : 24;
          db.prepare("UPDATE episodic_memories SET access_count = access_count + 1, last_accessed = ?, strength = ? WHERE id = ?").run(now, Math.max(0.1, calculateRetention(mem.strength, hoursSince)), mem.id);
        }
      }`;

code = code.replace(patch4Old, patch4New);

// ─── PATCH 5: Update version number ───
code = code.replace('version: "3.0.0"', 'version: "3.1.0"');
code = code.replace('OWL Memory MCP v3 —', 'OWL Memory MCP v3.1 —');
code = code.replace('description: "OWL Memory MCP v3 —', 'description: "OWL Memory MCP v3.1 —');

// Write output
fs.writeFileSync(outputPath, code);
console.log('Created v3.1:', outputPath);
console.log('Size:', fs.statSync(outputPath).size, 'bytes');

// Verify syntax
const { execSync } = require('child_process');
try {
  execSync(`node -c "${outputPath}"`, { encoding: 'utf8' });
  console.log('Syntax: OK');
} catch (e) {
  console.log('Syntax ERROR:', e.stderr?.slice(0, 500));
}
