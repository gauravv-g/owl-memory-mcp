// Debug: test storeEmbedding with real 384-dim embedding
const db = require("better-sqlite3")(':memory:');
const path = require('path');
const fs = require('fs');

db.loadExtension(path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll'));
console.log('✓ sqlite-vec loaded');

db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(embedding float[384])`);

// Generate a real 384-dim embedding
async function main() {
  const { pipeline } = await import('@xenova/transformers');
  console.log('Loading model...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  console.log('✓ Model loaded');

  const text = 'User prefers dark mode for coding';
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  const emb = Array.from(out.data);
  console.log(`Embedding: ${emb.length} dims, first 5: [${emb.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);

  // Test storeEmbedding function (same as in MCP)
  function storeEmbedding(db, memId, emb) {
    if (!emb || emb.length !== 384) { console.log('SKIP: invalid emb'); return; }
    try {
      const jsonStr = JSON.stringify(emb);
      console.log(`JSON length: ${jsonStr.length}`);
      console.log(`First 100 chars: ${jsonStr.slice(0, 100)}`);
      db.exec(`INSERT OR REPLACE INTO test_vec(rowid, embedding) VALUES (${memId}, '${jsonStr.replace(/'/g, "''")}')`);
      console.log('✓ Stored via string interpolation');
    } catch (e) {
      console.log('✗ Store failed:', e.message);
    }
  }

  // Store
  storeEmbedding(db, 1, emb);

  // Verify
  const rows = db.prepare('SELECT rowid, length(embedding) as len FROM test_vec').all();
  console.log('Rows:', rows);

  // Search
  const queryText = 'night theme';
  const queryOut = await embedder(queryText, { pooling: 'mean', normalize: true });
  const queryEmb = Array.from(queryOut.data);

  try {
    const results = db.prepare('SELECT rowid, distance FROM test_vec WHERE embedding MATCH ? AND k = 3').all(JSON.stringify(queryEmb));
    console.log(`\nSearch for "${queryText}":`);
    for (const r of results) {
      console.log(`  rowid=${r.rowid}, distance=${r.distance.toFixed(4)}`);
    }
    console.log('✓ Vector search works!');
  } catch (e) {
    console.log('✗ Search failed:', e.message);
  }

  // Also test with blob approach
  console.log('\n--- Testing blob approach ---');
  try {
    const blob = Buffer.from(new Float32Array(emb).buffer);
    console.log(`Blob length: ${blob.length} bytes`);
    db.exec(`INSERT OR REPLACE INTO test_vec(rowid, embedding) VALUES (2, X'${blob.toString('hex')}')`);
    console.log('✓ Stored via blob');

    const queryBlob = Buffer.from(new Float32Array(queryEmb).buffer);
    const results2 = db.prepare('SELECT rowid, distance FROM test_vec WHERE embedding MATCH ? AND k = 3').all(queryBlob);
    console.log('Blob search results:');
    for (const r of results2) {
      console.log(`  rowid=${r.rowid}, distance=${r.distance.toFixed(4)}`);
    }
  } catch (e) {
    console.log('✗ Blob approach failed:', e.message);
  }

  db.close();
}

main().catch(e => console.error('FATAL:', e.message));
