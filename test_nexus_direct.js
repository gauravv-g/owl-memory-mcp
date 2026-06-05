const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const SERVER = path.join(__dirname, "owl_memory_v4.js");

function sendRPC(proc, id, method, params) {
  return new Promise((resolve) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    proc.stdin.write(msg + "\n");
    
    function handler(data) {
      for (const line of data.toString().split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const r = JSON.parse(line.trim());
          if (r.id === id) {
            proc.stdout.off("data", handler);
            resolve(r);
            return;
          }
        } catch (e) {}
      }
    }
    proc.stdout.on("data", handler);
  });
}

async function main() {
  let args = {};
  const argsFile = path.join(__dirname, "args.json");
  if (fs.existsSync(argsFile)) {
    args = JSON.parse(fs.readFileSync(argsFile, "utf-8"));
  } else {
    let argsStr = process.argv.slice(2).join(" ").trim();
    if (argsStr.startsWith("'") && argsStr.endsWith("'")) {
      argsStr = argsStr.slice(1, -1);
    }
    args = JSON.parse(argsStr || "{}");
  }
  const proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "ignore"] });
  
  // Wait a brief moment for initialization
  await new Promise(r => setTimeout(r, 1000));
  
  // Initialize
  await sendRPC(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "direct-client", version: "1" } });
  
  // Call tool
  const res = await sendRPC(proc, 2, "tools/call", {
    name: "nexus",
    arguments: args
  });
  
  console.log(JSON.stringify(res.result || res.error || {}, null, 2));
  proc.kill();
  process.exit(0);
}
main().catch(console.error);
