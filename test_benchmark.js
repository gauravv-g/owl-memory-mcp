/**
 * OWL Memory MCP v3.2 — Benchmark Evaluation
 * Measures retrieval quality with Precision@K, Recall@K, MRR
 * Tests: entity-based search, semantic similarity, exact match, multi-hop
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v32-bench.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const SERVER = path.join(__dirname, "owl_memory_v4.js");

function sendRPC(proc, id, method, params) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 120000);
    const handler = (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const r = JSON.parse(trimmed);
          if (r.id === id) { clearTimeout(timeout); proc.stdout.off("data", handler); resolve(r); return; }
        } catch (e) {}
      }
    };
    proc.stdout.on("data", handler);
  });
}

// Benchmark dataset: memories + queries with expected results
const MEMORIES = [
  // People & Orgs
  { content: "Sundar Pichai is the CEO of Google Alphabet Inc", tags: ["person", "org"] },
  { content: "Satya Nadella leads Microsoft Corporation as CEO", tags: ["person", "org"] },
  { content: "Tim Cook is the chief executive officer of Apple Inc", tags: ["person", "org"] },
  { content: "Elon Musk founded SpaceX and Tesla Motors", tags: ["person", "org"] },
  { content: "Ratan Tata was the chairman of Tata Group until 2012", tags: ["person", "org"] },
  { content: "Mukesh Ambani is the chairman of Reliance Industries Limited", tags: ["person", "org"] },
  { content: "Nandan Nilekani co-founded Infosys and led Aadhaar project", tags: ["person", "org"] },
  { content: "Jeff Bezos founded Amazon and Blue Origin", tags: ["person", "org"] },
  // Locations
  { content: "Google headquarters is in Mountain View California", tags: ["org", "location"] },
  { content: "Microsoft headquarters is in Redmond Washington", tags: ["org", "location"] },
  { content: "Apple Park is located in Cupertino California", tags: ["org", "location"] },
  { content: "Tesla factory in Fremont California produces Model S", tags: ["org", "location"] },
  { content: "Infosys has its headquarters in Bangalore Karnataka India", tags: ["org", "location"] },
  { content: "Reliance Industries is based in Mumbai Maharashtra India", tags: ["org", "location"] },
  // Technical
  { content: "Python was created by Guido van Rossum in 1991", tags: ["person", "product"] },
  { content: "JavaScript was developed by Brendan Eich at Netscape", tags: ["person", "product"] },
  { content: "React was created by Jordan Walke at Facebook Meta", tags: ["person", "product"] },
  { content: "Docker was developed by Solomon Hykes at dotCloud", tags: ["person", "product"] },
  { content: "Kubernetes was created by Google and donated to CNCF", tags: ["org", "product"] },
  { content: "PostgreSQL is an open source relational database system", tags: ["product"] },
  // Finance
  { content: "RBI raised the repo rate by 25 basis points to 6.5 percent", tags: ["org", "finance"] },
  { content: "HDFC Bank merged with HDFC Ltd in July 2023", tags: ["org", "finance"] },
  { content: "SBI is the largest public sector bank in India", tags: ["org", "finance"] },
  { content: "Nifty 50 crossed 20000 points for the first time in 2023", tags: ["finance"] },
  { content: "Bitcoin reached its all time high of 69000 dollars in November 2021", tags: ["product", "finance"] },
  // Science
  { content: "Chandrayaan 3 successfully landed on the Moon south pole in August 2023", tags: ["event", "location"] },
  { content: "ISRO launched Aditya L1 mission to study the Sun", tags: ["org", "product"] },
  { content: "CRISPR gene editing was discovered by Jennifer Doudna and Emmanuelle Charpentier", tags: ["person", "product"] },
  { content: "James Webb Space Telescope launched on December 25 2021", tags: ["product", "event"] },
  { content: "OpenAI released GPT 4 in March 2023", tags: ["org", "product"] },
  { content: "DeepMind AlphaFold solved the protein folding problem", tags: ["org", "product"] },
  // Mixed / ambiguous
  { content: "Apple released the iPhone 15 with USB C port in September 2023", tags: ["org", "product", "event"] },
  { content: "Apple is the most valuable company in the world by market cap", tags: ["org", "finance"] },
  { content: "The apple fruit is grown extensively in Himachal Pradesh India", tags: ["product", "location"] },
  { content: "Orange is a major telecommunications company in France", tags: ["org", "location"] },
  { content: "Orange the fruit is grown in Nagpur Maharashtra", tags: ["product", "location"] },
];

const QUERIES = [
  // Entity-based queries
  { query: "Who is the CEO of Google?", expected: ["Sundar Pichai"], type: "entity" },
  { query: "Who leads Microsoft?", expected: ["Satya Nadella"], type: "entity" },
  { query: "Who founded SpaceX?", expected: ["Elon Musk"], type: "entity" },
  { query: "Who created Python?", expected: ["Guido van Rossum"], type: "entity" },
  { query: "Who developed JavaScript?", expected: ["Brendan Eich"], type: "entity" },
  // Semantic similarity
  { query: "chief executive of Apple", expected: ["Tim Cook"], type: "semantic" },
  { query: "head of Reliance Industries", expected: ["Mukesh Ambani"], type: "semantic" },
  { query: "founder of Amazon", expected: ["Jeff Bezos"], type: "semantic" },
  // Location-based
  { query: "Where is Google headquarters?", expected: ["Mountain View"], type: "location" },
  { query: "Where is Infosys based?", expected: ["Bangalore"], type: "location" },
  { query: "Where is Microsoft located?", expected: ["Redmond"], type: "location" },
  // Product/tech
  { query: "What is Kubernetes?", expected: ["Kubernetes"], type: "product" },
  { query: "Who created React?", expected: ["Jordan Walke"], type: "entity" },
  { query: "What is PostgreSQL?", expected: ["PostgreSQL"], type: "product" },
  // Finance
  { query: "What did RBI do with interest rates?", expected: ["RBI", "repo rate"], type: "finance" },
  { query: "Which bank merged with HDFC Ltd?", expected: ["HDFC Bank"], type: "finance" },
  { query: "What is the largest bank in India?", expected: ["SBI"], type: "finance" },
  // Science/space
  { query: "What did ISRO launch to study the Sun?", expected: ["Aditya L1"], type: "product" },
  { query: "What landed on the Moon south pole?", expected: ["Chandrayaan 3"], type: "event" },
  { query: "Who solved protein folding?", expected: ["AlphaFold", "DeepMind"], type: "product" },
  // Ambiguous (tests disambiguation)
  { query: "Apple iPhone release", expected: ["iPhone 15", "Apple"], type: "disambig" },
  { query: "Apple market cap", expected: ["most valuable company"], type: "disambig" },
  { query: "Apple fruit production", expected: ["Himachal Pradesh"], type: "disambig" },
  // Multi-concept
  { query: "Indian tech CEOs", expected: ["Sundar Pichai", "Nandan Nilekani", "Mukesh Ambani"], type: "multi" },
  { query: "California tech companies", expected: ["Google", "Apple", "Tesla"], type: "multi" },
];

function scoreResults(results, expected, k) {
  const topK = results.slice(0, k);
  let hits = 0;
  let rr = 0; // reciprocal rank
  for (let i = 0; i < topK.length; i++) {
    const content = (topK[i].content || "").toLowerCase();
    for (const exp of expected) {
      if (content.includes(exp.toLowerCase())) {
        hits++;
        if (rr === 0) rr = 1 / (i + 1);
        break;
      }
    }
  }
  const precision = hits / k;
  const recall = hits / expected.length;
  return { precision, recall, rr, hits };
}

async function main() {
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.startsWith("NER") && !msg.startsWith("Embedding")) console.log("SERVER:", msg);
  });

  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "benchmark", version: "1.0" } });
  console.log("✓ Initialized, waiting for models...\n");
  await new Promise(r => setTimeout(r, 8000));

  // Store all memories
  console.log(`Storing ${MEMORIES.length} memories...`);
  for (let i = 0; i < MEMORIES.length; i++) {
    await sendRPC(proc, 100 + i, "tools/call", {
      name: "remember",
      arguments: { content: MEMORIES[i].content, project: "bench" }
    });
  }
  console.log("✓ All memories stored\n");

  // Run benchmark queries
  console.log("═══════════════════════════════════════════════════");
  console.log("  BENCHMARK RESULTS");
  console.log("═══════════════════════════════════════════════════\n");

  const metrics = { p5: [], p10: [], rr: [], byType: {} };

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    const r = await sendRPC(proc, 200 + i, "tools/call", {
      name: "recall",
      arguments: { query: q.query, project: "bench", limit: 10 }
    });
    const results = JSON.parse(r.result.content[0].text);
    const s5 = scoreResults(results, q.expected, 5);
    const s10 = scoreResults(results, q.expected, 10);

    metrics.p5.push(s5.precision);
    metrics.p10.push(s10.precision);
    metrics.rr.push(s5.rr);

    if (!metrics.byType[q.type]) metrics.byType[q.type] = { p5: [], p10: [], rr: [], count: 0 };
    metrics.byType[q.type].p5.push(s5.precision);
    metrics.byType[q.type].p10.push(s10.precision);
    metrics.byType[q.type].rr.push(s5.rr);
    metrics.byType[q.type].count++;

    const topResult = results[0] ? results[0].content.slice(0, 50) : "(no results)";
    const pass = s5.hits > 0 ? "✓" : "✗";
    console.log(`${pass} [${q.type.padEnd(8)}] "${q.query.slice(0, 45)}"`);
    console.log(`  Expected: ${q.expected.join(", ")}`);
    console.log(`  Top: "${topResult}..." P@5=${s5.precision.toFixed(2)} R@5=${s10.recall.toFixed(2)}`);
  }

  // Aggregate scores
  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const overallP5 = avg(metrics.p5);
  const overallP10 = avg(metrics.p10);
  const overallMRR = avg(metrics.rr);
  const overallRecall = avg(metrics.p10.map((_, i) => {
    const q = QUERIES[i];
    const r = metrics.byType[q.type];
    return r ? avg(r.p10) : 0;
  }));

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  OVERALL SCORES");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(`  Precision@5:  ${(overallP5 * 100).toFixed(1)}%`);
  console.log(`  Precision@10: ${(overallP10 * 100).toFixed(1)}%`);
  console.log(`  MRR:          ${overallMRR.toFixed(3)}`);
  console.log(`  Queries:      ${QUERIES.length}`);

  console.log("\n  By Query Type:");
  for (const [type, m] of Object.entries(metrics.byType)) {
    console.log(`    ${type.padEnd(10)} P@5=${(avg(m.p5) * 100).toFixed(0)}%  P@10=${(avg(m.p10) * 100).toFixed(0)}%  MRR=${avg(m.rr).toFixed(2)}  (n=${m.count})`);
  }

  // Quality rating
  console.log("\n═══════════════════════════════════════════════════");
  let rating;
  if (overallP5 >= 0.7) rating = "EXCELLENT — Production ready";
  else if (overallP5 >= 0.5) rating = "GOOD — Competitive with cloud services";
  else if (overallP5 >= 0.3) rating = "FAIR — Needs improvement";
  else rating = "POOR — Significant gaps remain";
  console.log(`  RATING: ${rating}`);
  console.log("═══════════════════════════════════════════════════\n");

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
