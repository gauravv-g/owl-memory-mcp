/**
 * OWL Memory MCP v3.2 — Quick NER Debug Test
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v32-debug.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const SERVER = path.join(__dirname, "owl_memory_v3.2.js");

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
          if (r.id === id) {
            clearTimeout(timeout);
            proc.stdout.off("data", handler);
            resolve(r);
            return;
          }
        } catch (e) {}
      }
    };
    proc.stdout.on("data", handler);
  });
}

async function main() {
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrBuf = [];
  proc.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    stderrBuf.push(msg);
    console.log("SERVER:", msg);
  });

  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "debug", version: "1.0" } });
  console.log("✓ Initialized, waiting 10s for models to load...\n");
  await new Promise(r => setTimeout(r, 10000));

  // Test 1: Simple sentence
  const t1 = await sendRPC(proc, 10, "tools/call", {
    name: "remember",
    arguments: { content: "Sundar Pichai works at Google in California", project: "debug" }
  });
  console.log("\n=== Test 1: Sundar Pichai at Google in California ===");
  console.log(JSON.stringify(JSON.parse(t1.result.content[0].text), null, 2));

  // Test 2: Sentence with mixed case
  const t2 = await sendRPC(proc, 11, "tools/call", {
    name: "remember",
    arguments: { content: "rahul from infosys visited the taj mahal in agra", project: "debug" }
  });
  console.log("\n=== Test 2: lowercase names ===");
  console.log(JSON.stringify(JSON.parse(t2.result.content[0].text), null, 2));

  // Test 3: Multi-word entities
  const t3 = await sendRPC(proc, 12, "tools/call", {
    name: "remember",
    arguments: { content: "The Reserve Bank of India is headquartered in Mumbai", project: "debug" }
  });
  console.log("\n=== Test 3: RBI Mumbai ===");
  console.log(JSON.stringify(JSON.parse(t3.result.content[0].text), null, 2));

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
