const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const DB_PATH = path.join(os.homedir(), ".owl-memory", "memory-v3-debug.db");
for (const f of [DB_PATH, DB_PATH + "-shm", DB_PATH + "-wal"]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const proc = spawn("node", [path.join(__dirname, "owl_memory_v3.js")], {
  env: { ...process.env, OWL_MEMORY_DB: DB_PATH },
  stdio: ["pipe", "pipe", "ipc"],
});

proc.stdout.on("data", (d) => {
  const lines = d.toString().split("\n");
  for (const line of lines) {
    if (line.trim().startsWith("{")) {
      try {
        const r = JSON.parse(line.trim());
        if (r.id === 2) {
          console.log("RESPONSE:", JSON.stringify(r).slice(0, 200));
          proc.stdin.end();
        }
      } catch (e) {
        console.log("PARSE ERROR:", line.slice(0, 100));
      }
    }
  }
});

proc.stderr.on("data", (d) => {
  console.log("STDERR:", d.toString().slice(0, 100));
});

proc.on("error", (e) => console.error("PROC ERROR:", e.message));

// Initialize
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } }) + "\n");

// Wait for init, then send remember
setTimeout(() => {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember", arguments: { content: "Hello world", project: "test" } } }) + "\n");
}, 1000);

setTimeout(() => {
  console.log("TIMEOUT - killing");
  proc.kill();
  process.exit(1);
}, 30000);
