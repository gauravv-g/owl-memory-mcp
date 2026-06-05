const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v32-final.db");
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

  // Store memories
  const memories = [
    "Sundar Pichai is the CEO of Google in California",
    "Satya Nadella leads Microsoft in Redmond Washington",
    "Tim Cook is the CEO of Apple in Cupertino California",
    "Elon Musk founded SpaceX and Tesla in Texas",
    "RBI raised the repo rate to 6.5 percent"
  ];
  for (let i = 0; i < memories.length; i++) {
    await sendRPC(proc, 10 + i, "tools/call", {
      name: "remember",
      arguments: { content: memories[i], project: "test" }
    });
  }

  // Read graph JSON
  const g = await sendRPC(proc, 20, "resources/read", { uri: "owl-memory://graph" });
  const graph = JSON.parse(g.result.contents[0].text);
  console.log("=== Graph JSON ===");
  console.log("Nodes:", graph.nodes.length);
  console.log("Edges:", graph.edges.length);
  console.log("Entities:", graph.entities?.length || 0);
  console.log("Vector:", graph.stats?.vector_enabled);
  console.log("NER:", graph.stats?.ner_enabled);
  if (graph.entities?.length > 0) {
    console.log("Entities found:");
    graph.entities.forEach(e => console.log("  " + e.name + " (" + e.entity_type + ")"));
  }

  // Read graph UI
  const ui = await sendRPC(proc, 21, "resources/read", { uri: "owl-memory://graph-ui" });
  const html = ui.result.contents[0].text;
  console.log("\n=== Graph UI ===");
  console.log("Length:", html.length, "chars");
  const checks = [
    ["D3.js", html.includes("d3.v7")],
    ["Force simulation", html.includes("forceSimulation")],
    ["Zoom", html.includes("d3.zoom")],
    ["Drag", html.includes("d3.drag")],
    ["Tooltip", html.includes("tooltip")],
    ["Entity tags", html.includes("entity-tag")],
    ["Legend", html.includes("legend")],
    ["Self-contained HTML", html.includes("<!DOCTYPE html>")],
    ["Dark theme", html.includes("#0a0a1a")],
    ["Color coding", html.includes("#2196F3")],
    ["Click handler", html.includes("onclick") || html.includes(".on(\"click")],
    ["Responsive", html.includes("window.innerWidth")],
  ];
  checks.forEach(([name, pass]) => console.log("  " + (pass ? "✓" : "✗") + " " + name));

  // Save HTML preview
  const outPath = path.join(__dirname, "graph-ui-preview.html");
  fs.writeFileSync(outPath, html);
  console.log("\nSaved to:", outPath);

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
