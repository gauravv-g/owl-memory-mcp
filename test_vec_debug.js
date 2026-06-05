// Debug sqlite-vec insert issue
const db = require("better-sqlite3")(':memory:');
const path = require('path');

db.loadExtension(path.join(__dirname, 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll'));

db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(embedding float[3])`);

// Check PRAGMA
const info = db.prepare('PRAGMA table_info(test_vec)').all();
console.log('Schema:', JSON.stringify(info));

// Try different insert approaches
console.log('\nTrying different insert approaches:');

// Approach 1: Direct exec
try {
  db.exec("INSERT INTO test_vec(rowid, embedding) VALUES (1, '[0.1, 0.2, 0.3]')");
  console.log('✓ Approach 1: exec with literal');
} catch (e) {
  console.log('✗ Approach 1:', e.message);
}

// Approach 2: prepare + run with number
try {
  const stmt = db.prepare('INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)');
  const result = stmt.run(2, '[0.4, 0.5, 0.6]');
  console.log('✓ Approach 2: prepare+run with number', result);
} catch (e) {
  console.log('✗ Approach 2:', e.message);
}

// Approach 3: prepare + run with explicit integer
try {
  const stmt = db.prepare('INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)');
  stmt.run(parseInt(3), '[0.7, 0.8, 0.9]');
  console.log('✓ Approach 3: parseInt');
} catch (e) {
  console.log('✗ Approach 3:', e.message);
}

// Approach 4: Using sqlite3_next_stmt
try {
  db.exec("BEGIN");
  db.exec("INSERT INTO test_vec(rowid, embedding) VALUES (4, '[1.0, 0.0, 0.5]')");
  db.exec("COMMIT");
  console.log('✓ Approach 4: explicit transaction');
} catch (e) {
  console.log('✗ Approach 4:', e.message);
}

// Check what's actually in the table
const rows = db.prepare('SELECT rowid, embedding FROM test_vec').all();
console.log('\nRows in table:', rows.length);
for (const r of rows) {
  console.log(`  rowid=${r.rowid} (${typeof r.rowid}), embedding=${r.embedding?.slice(0,30)}`);
}

db.close();
