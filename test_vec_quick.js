// Quick test: store embedding, then search for it
const db = require("better-sqlite3")(':memory:');
const path = require('path');
const fs = require('fs');

db.loadExtension(path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll'));
db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT)");
db.exec("CREATE VIRTUAL TABLE memories_vec USING vec0(embedding float[3])");

async function main() {
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

  // Insert a memory
  db.exec("INSERT INTO memories(id, content) VALUES ('m1', 'dark mode for coding')");
  const rowId = db.prepare("SELECT last_insert_rowid()").get()["last_insert_rowid()"];
  console.log("Inserted rowid:", rowId);

  // Generate and store embedding
  const emb = await embedder('dark mode for coding', { pooling: 'mean', normalize: true });
  const embArr = Array.from(emb.data);
  console.log("Embedding dims:", embArr.length);

  // Store in vector table
  db.exec(`INSERT INTO memories_vec(rowid, embedding) VALUES (${rowId}, '${JSON.stringify(embArr)}')`);
  console.log("Stored embedding");

  // Search with similar query
  const queryEmb = await embedder('night theme', { pooling: 'mean', normalize: true });
  const queryArr = Array.from(queryEmb.data);

  const results = db.prepare("SELECT rowid, distance FROM memories_vec WHERE embedding MATCH ? AND k = 3").all(JSON.stringify(queryArr));
  console.log("Search results:", results);

  if (results.length > 0) {
    console.log("VECTOR SEARCH WORKS! Distance:", results[0].distance);
  } else {
    console.log("NO RESULTS - vector search failed");
  }

  db.close();
}

main().catch(e => console.error("ERROR:", e.message));
