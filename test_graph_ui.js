const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v32-graph-test.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const SERVER = path.join(__dirname, "owl_memory_v3.2.js");

function sendRPC(proc, id, method, params) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    const timeout = setTimeout(() => reject(new Error("Timeout " + id)), 60000);
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

async function main() {
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => {});
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } });
  await new Promise(r => setTimeout(r, 5000));

  // List resources
  const r = await sendRPC(proc, 2, "resources/list", {});
  console.log("Resources:");
  r.result.resources.forEach(res => {
    console.log(`  ${res.uri}  [${res.mimeType}]  ${res.name}`);
  });

  // Store a memory with entities
  await sendRPC(proc, 3, "tools/call", {
    name: "remember",
    arguments: { content: "Sundar Pichai is the CEO of Google in California", project: "test" }
  });

  // Read graph resource
  const g = await sendRPC(proc, 4, "resources/read", { uri: "owl-memory://graph" });
  const graph = JSON.parse(g.result.contents[0].text);
  console.log("\nGraph data:");
  console.log("  Nodes:", graph.nodes.length);
  console.log("  Edges:", graph.edges.length);
  console.log("  Entities:", graph.entities.length);
  console.log("  Stats:", JSON.stringify(graph.stats));
  if (graph.nodes.length > 0) {
    console.log("  Sample node:", JSON.stringify(graph.nodes[0]).slice(0, 100));
  }

  // Read graph-ui resource
  const ui = await sendRPC(proc, 5, "resources/read", { uri: "owl-memory://graph-ui" });
  const html = ui.result.contents[0].text;
  console.log("\nGraph UI:");
  console.log("  Length:", html.length, "chars");
  console.log("  Has D3:", html.includes("d3.v7"));
  console.log("  Has force:", html.includes("forceSimulation"));
  console.log("  Has colors:", html.includes("#2196F3"));
  console.log("  Has tooltip:", html.includes("tooltip"));

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
