// Test local embedding generation with @xenova/transformers
async function main() {
  try {
    const { pipeline } = require('@xenova/transformers');
    console.log('Loading embedding model...');
    
    // Use a small, fast model: all-MiniLM-L6-v2 (384 dimensions, ~80MB)
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true, // Use quantized model for faster loading
    });
    
    console.log('Model loaded!');
    
    // Generate embeddings
    const texts = [
      'User prefers dark mode for coding',
      'User loves bright sunny days',
      'User hates dark gloomy interfaces',
      'Database migration failed in production',
    ];
    
    console.log('\nGenerating embeddings...');
    for (const text of texts) {
      const start = Date.now();
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      const elapsed = Date.now() - start;
      const embedding = Array.from(output.data);
      console.log(`  "${text.slice(0, 40)}..." → ${embedding.length} dims (${elapsed}ms)`);
      console.log(`    First 5: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
    }
    
    // Test similarity
    console.log('\nSimilarity test:');
    const emb1 = await embedder('dark mode', { pooling: 'mean', normalize: true });
    const emb2 = await embedder('night theme', { pooling: 'mean', normalize: true });
    const emb3 = await embedder('bright colors', { pooling: 'mean', normalize: true });
    
    const v1 = Array.from(emb1.data);
    const v2 = Array.from(emb2.data);
    const v3 = Array.from(emb3.data);
    
    // Cosine similarity (already normalized, so dot product)
    function dot(a, b) { return a.reduce((sum, v, i) => sum + v * b[i], 0); }
    
    console.log(`  "dark mode" vs "night theme":    ${dot(v1, v2).toFixed(4)}`);
    console.log(`  "dark mode" vs "bright colors":  ${dot(v1, v3).toFixed(4)}`);
    console.log(`  "night theme" vs "bright colors": ${dot(v2, v3).toFixed(4)}`);
    
    if (dot(v1, v2) > dot(v1, v3)) {
      console.log('\n✓ Semantic similarity works! "dark mode" is closer to "night theme" than "bright colors"');
    }
    
    console.log('\nLOCAL EMBEDDINGS WORK!');
  } catch (e) {
    console.log('ERROR:', e.message);
    console.log('Stack:', e.stack?.slice(0, 500));
  }
}

main();
