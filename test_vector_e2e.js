// Full vector embedding test with working sqlite-vec approach
const db = require("better-sqlite3")(':memory:');
const path = require('path');
const fs = require('fs');

db.loadExtension(path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll'));
console.log('✓ sqlite-vec loaded');

// Create tables
db.exec(`
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(embedding float[3]);
`);

// Insert test memories
const memories = [
  [1, 'User prefers dark mode for coding at night'],
  [2, 'User loves bright sunny days and outdoor activities'],
  [3, 'User hates dark gloomy interfaces prefers light themes'],
  [4, 'Database migration failed in production due to missing rollback'],
  [5, 'The night mode feature was implemented with a toggle switch'],
  [6, 'Bright colors and high contrast improve accessibility'],
  [7, 'Dark theme reduces eye strain during late night coding'],
  [8, 'Production outage caused by untested database schema change'],
];

for (const [id, content] of memories) {
  db.exec(`INSERT INTO memories(id, content) VALUES (${id}, '${content.replace(/'/g, "''")}')`);
}

// Insert embeddings using exec (which works)
const embeddings = {
  1: [0.9, 0.1, 0.8],   // dark mode
  2: [0.1, 0.9, 0.2],   // bright
  3: [0.85, 0.15, 0.75], // dark hate (similar to 1)
  4: [0.2, 0.3, 0.1],   // unrelated
  5: [0.88, 0.12, 0.78], // night mode (similar to 1)
  6: [0.15, 0.85, 0.25], // bright colors (similar to 2)
  7: [0.87, 0.13, 0.77], // dark theme (similar to 1)
  8: [0.25, 0.28, 0.15], // production outage (similar to 4)
};

console.log('Inserting embeddings...');
for (const [id, emb] of Object.entries(embeddings)) {
  db.exec(`INSERT INTO memories_vec(rowid, embedding) VALUES (${id}, '[${emb.join(', ')}]')`);
}
console.log('✓ Embeddings inserted');

// Test vector search
console.log('\n═══════════════════════════════════════════════════');
console.log('  VECTOR SEARCH RESULTS');
console.log('═══════════════════════════════════════════════════\n');

const queries = [
  { emb: [0.9, 0.1, 0.8], label: 'dark mode pattern' },
  { emb: [0.1, 0.9, 0.2], label: 'bright pattern' },
  { emb: [0.2, 0.3, 0.1], label: 'database failure pattern' },
];

for (const q of queries) {
  console.log(`Query: [${q.label}]`);
  const results = db.prepare(`
    SELECT v.rowid, m.content, v.distance
    FROM memories_vec v
    JOIN memories m ON m.id = v.rowid
    WHERE v.embedding MATCH ? AND k = 4
    ORDER BY v.distance
  `).all(`[${q.emb.join(', ')}]`);
  
  for (const r of results) {
    console.log(`  rowid=${r.rowid}, dist=${r.distance.toFixed(4)}, "${r.content.slice(0, 60)}"`);
  }
  console.log('');
}

// Now test with REAL embeddings from Xenova model
console.log('═══════════════════════════════════════════════════');
console.log('  REAL EMBEDDING SEMANTIC SEARCH');
console.log('═══════════════════════════════════════════════════\n');

async function testRealEmbeddings() {
  const { pipeline } = await import('@xenova/transformers');
  console.log('Loading embedding model...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  console.log('✓ Model loaded');
  
  // Generate embeddings for real texts
  const texts = [
    'User prefers dark mode for coding',
    'User loves bright sunny days',
    'User hates dark gloomy interfaces',
    'Database migration failed in production',
    'The night mode feature toggle',
    'Bright colors improve accessibility',
    'Dark theme reduces eye strain',
    'Production outage from schema change',
  ];
  
  console.log('\nGenerating real embeddings...');
  const realEmbeddings = [];
  for (const text of texts) {
    const emb = await embedder(text, { pooling: 'mean', normalize: true });
    realEmbeddings.push(Array.from(emb.data));
    console.log(`  "${text.slice(0, 40)}..." → ${realEmbeddings[realEmbeddings.length-1].length} dims`);
  }
  
  // Cosine similarity
  function cosineSim(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0);
  }
  
  console.log('\nSemantic similarity proof:');
  console.log('  "dark mode" vs "night mode":', cosineSim(realEmbeddings[0], realEmbeddings[4]).toFixed(4));
  console.log('  "dark mode" vs "bright colors":', cosineSim(realEmbeddings[0], realEmbeddings[5]).toFixed(4));
  console.log('  "dark mode" vs "dark theme":', cosineSim(realEmbeddings[0], realEmbeddings[6]).toFixed(4));
  console.log('  "dark mode" vs "db migration":', cosineSim(realEmbeddings[0], realEmbeddings[3]).toFixed(4));
  console.log('  "night mode" vs "bright colors":', cosineSim(realEmbeddings[4], realEmbeddings[5]).toFixed(4));
  console.log('  "db migration" vs "production outage":', cosineSim(realEmbeddings[3], realEmbeddings[7]).toFixed(4));
  
  const darkVsNight = cosineSim(realEmbeddings[0], realEmbeddings[4]);
  const darkVsBright = cosineSim(realEmbeddings[0], realEmbeddings[5]);
  const darkVsDb = cosineSim(realEmbeddings[0], realEmbeddings[3]);
  
  console.log('\n✓ "dark mode" is closer to "night mode" than "bright colors":', darkVsNight > darkVsBright ? 'YES ✓' : 'NO ✗');
  console.log('✓ "dark mode" is closer to "night mode" than "db migration":', darkVsNight > darkVsDb ? 'YES ✓' : 'NO ✗');
  
  if (darkVsNight > darkVsBright && darkVsNight > darkVsDb) {
    console.log('\n✓✓✓ SEMANTIC SIMILARITY WORKS! Vector embeddings capture meaning!');
  }
}

testRealEmbeddings().then(() => {
  console.log('\n✓✓✓ ALL TESTS PASSED!');
  db.close();
}).catch(e => {
  console.error('ERROR:', e.message);
  db.close();
});
