const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v32-graph-test4.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
const SERVER = path.join(__dirname, "owl_memory_v5.js");

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
  console.log("Graph response keys:", Object.keys(g.result));
  const graphText = g.result.contents?.[0]?.text;
  if (graphText) {
    const graph = JSON.parse(graphText);
    console.log("Graph JSON:");
    console.log("  Nodes:", graph.nodes.length);
    console.log("  Edges:", graph.edges.length);
    if (graph.nodes?.length > 0) {
      console.log("  Sample node:", JSON.stringify(graph.nodes[0]).slice(0, 120));
    }
  } else {
    console.log("Full graph response:", JSON.stringify(g).slice(0, 500));
  }

  // Read graph UI
  const ui = await sendRPC(proc, 21, "resources/read", { uri: "owl-memory://graph-ui" });
  console.log("\nUI response keys:", Object.keys(ui.result));
  const uiText = ui.result.contents?.[0]?.text;
  if (uiText) {
    console.log("Graph UI HTML:");
    console.log("  Length:", uiText.length, "chars");
    console.log("  Has D3:", uiText.includes("d3.v7"));
    console.log("  Has force:", uiText.includes("forceSimulation"));
    console.log("  Has zoom:", uiText.includes("d3.zoom"));
    console.log("  Has entity-tag:", uiText.includes("entity-tag"));
    const outPath = path.join(__dirname, "graph-ui-preview.html");
    fs.writeFileSync(outPath, uiText);
    console.log("  Saved to:", outPath);
  } else {
    console.log("Full UI response:", JSON.stringify(ui).slice(0, 500));
  }

  proc.kill();
  for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
