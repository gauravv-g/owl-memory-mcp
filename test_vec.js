// Test sqlite-vec with correct API from docs
const db = require('better-sqlite3')(':memory:');
const path = require('path');

try {
  const dllPath = path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll');
  db.loadExtension(dllPath);
  console.log('sqlite-vec loaded!');

  // Create virtual table - no explicit primary key needed, rowid is implicit
  db.exec(`CREATE VIRTUAL TABLE vec_examples USING vec0(sample_embedding float[3])`);

  // Insert using JSON array strings (as per docs)
  db.exec(`INSERT INTO vec_examples(rowid, sample_embedding) VALUES (1, '[0.9, 0.1, 0.8]')`);
  db.exec(`INSERT INTO vec_examples(rowid, sample_embedding) VALUES (2, '[0.1, 0.9, 0.2]')`);
  db.exec(`INSERT INTO vec_examples(rowid, sample_embedding) VALUES (3, '[0.85, 0.15, 0.75]')`);
  db.exec(`INSERT INTO vec_examples(rowid, sample_embedding) VALUES (4, '[0.2, 0.3, 0.1]')`);

  console.log('Data inserted');

  // Query using JSON array string
  const results = db.prepare(`
    SELECT rowid, distance 
    FROM vec_examples 
    WHERE sample_embedding MATCH '[0.9, 0.1, 0.8]' 
    ORDER BY distance 
    LIMIT 4
  `).all();

  console.log('Vector search results:');
  for (const r of results) {
    console.log(`  rowid=${r.rowid}, distance=${r.distance?.toFixed(4)}`);
  }

  // Search for "bright" pattern
  const results2 = db.prepare(`
    SELECT rowid, distance 
    FROM vec_examples 
    WHERE sample_embedding MATCH '[0.1, 0.9, 0.2]' 
    ORDER BY distance 
    LIMIT 4
  `).all();

  console.log('\nBright pattern search:');
  for (const r of results2) {
    console.log(`  rowid=${r.rowid}, distance=${r.distance?.toFixed(4)}`);
  }

  console.log('\nVECTOR SEARCH WITH sqlite-vec WORKS!');
} catch (e) {
  console.log('ERROR:', e.message);
  console.log('Stack:', e.stack?.slice(0, 800));
}
