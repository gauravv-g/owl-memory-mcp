/**
 * OWL P2P Memory Mesh v1.0
 * 
 * "A local-network mesh for sharing anonymized bug patterns and cognitive vaccines."
 */

const dgram = require("dgram");
const http = require("http");
const Database = require("better-sqlite3");
const path = require("path");
const os = require("os");

const MULTICAST_ADDR = "224.0.0.114";
const PORT = 43210;
const PEER_ID = Math.random().toString(36).slice(2, 9);
const DB_PATH = process.env.OWL_MEMORY_DB || path.join(os.homedir(), ".owl-memory", "memory-v5.db");

const db = new Database(DB_PATH);
const knownPeers = new Set();

// ─── 1. HTTP Server for Sharing ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/bugs" && req.method === "GET") {
    try {
      const bugs = db.prepare("SELECT bug_type, description, resolution FROM code_bugs WHERE is_active = 0 AND resolution IS NOT NULL LIMIT 50").all();
      // Anonymize: remove file paths, exact project names, etc.
      const safeBugs = bugs.map(b => ({
        bug_type: b.bug_type,
        description: b.description.replace(/['"]?(\/[\w.-]+)+['"]?/g, "[PATH]"),
        resolution: b.resolution
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safeBugs));
    } catch (e) {
      res.writeHead(500);
      res.end("DB Error");
    }
  } else if (req.url === "/vaccines" && req.method === "GET") {
    try {
      const vaccines = db.prepare("SELECT name, description, program_code FROM memory_programs WHERE precision_score > 0.6 LIMIT 20").all();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(vaccines));
    } catch (e) {
      res.writeHead(500);
      res.end("DB Error");
    }
  } else if (req.url === "/crystal_data" && req.method === "GET") {
    try {
      const nodes = [];
      const links = [];
      
      let mems;
      try {
        mems = db.prepare("SELECT id, feynman_level, strength FROM episodic_memories LIMIT 100").all();
      } catch (err) {
        // Fallback for older database versions without feynman_level column
        const rows = db.prepare("SELECT id, strength FROM episodic_memories LIMIT 100").all();
        mems = rows.map(r => ({ id: r.id, feynman_level: 1, strength: r.strength }));
      }
      
      const code = db.prepare("SELECT id, node_type FROM code_nodes LIMIT 100").all();
      const edg = db.prepare("SELECT source_id, target_id FROM code_edges LIMIT 200").all();
      
      for (const m of mems) nodes.push({ id: m.id, group: "memory", level: m.feynman_level, val: m.strength });
      for (const c of code) nodes.push({ id: c.id, group: "code", type: c.node_type, val: 1 });
      for (const e of edg) links.push({ source: e.source_id, target: e.target_id });
      
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ nodes, links }));
    } catch (e) { res.writeHead(500); res.end("DB Error"); }
  } else if (req.url === "/crystal" && req.method === "GET") {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>OWL Pythagorean Crystal</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body { background: #0a0a0a; color: #00ffcc; font-family: monospace; overflow: hidden; margin: 0; }
    svg { width: 100vw; height: 100vh; }
    .node-memory { fill: #ff00ff; }
    .node-code { fill: #00ffff; }
    .link { stroke: rgba(255,255,255,0.2); stroke-width: 1.5px; }
  </style>
</head>
<body>
<svg id="crystal"></svg>
<script>
  fetch('/crystal_data').then(r=>r.json()).then(data => {
    const svg = d3.select("#crystal"), width = window.innerWidth, height = window.innerHeight;
    const sim = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id(d=>d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width/2, height/2))
      .force("3d", d3.forceRadial(200, width/2, height/2).strength(0.1));

    const link = svg.append("g").selectAll("line").data(data.links).join("line").attr("class", "link");
    const node = svg.append("g").selectAll("circle").data(data.nodes).join("circle")
      .attr("r", d => d.group === 'memory' ? (d.val || 1) * 10 : 6)
      .attr("class", d => "node-" + d.group)
      .call(d3.drag()
        .on("start", (e,d) => { if(!e.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
        .on("drag", (e,d) => { d.fx=e.x; d.fy=e.y; })
        .on("end", (e,d) => { if(!e.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));

    node.append("title").text(d => d.id);

    sim.on("tick", () => {
      link.attr("x1", d=>d.source.x).attr("y1", d=>d.source.y)
          .attr("x2", d=>d.target.x).attr("y2", d=>d.target.y);
      node.attr("cx", d=>d.x).attr("cy", d=>d.y);
    });
  });
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

server.listen(0, "0.0.0.0", () => {
  const httpPort = server.address().port;
  console.log(`[OWL MESH] Local HTTP Sharing Server running on port ${httpPort}`);
  
  // ─── 2. UDP Multicast Discovery ─────────────────────────────────────────────
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  
  socket.on("listening", () => {
    socket.setBroadcast(true);
    socket.setMulticastTTL(128);
    socket.addMembership(MULTICAST_ADDR);
    console.log(`[OWL MESH] Joined multicast group ${MULTICAST_ADDR}:${PORT}`);
    
    // Announce presence every 10 seconds
    setInterval(() => {
      const msg = Buffer.from(JSON.stringify({ peerId: PEER_ID, port: httpPort }));
      socket.send(msg, 0, msg.length, PORT, MULTICAST_ADDR);
    }, 10000);
  });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.peerId && data.peerId !== PEER_ID) {
        const peerKey = `${rinfo.address}:${data.port}`;
        if (!knownPeers.has(peerKey)) {
          knownPeers.add(peerKey);
          console.log(`[OWL MESH] Discovered new peer: ${peerKey}`);
          syncWithPeer(rinfo.address, data.port);
        }
      }
    } catch (e) {}
  });

  socket.bind(PORT);
});

// ─── 3. Sync Logic ────────────────────────────────────────────────────────────
function syncWithPeer(host, port) {
  // Sync Bugs
  http.get(`http://${host}:${port}/bugs`, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try {
        const bugs = JSON.parse(data);
        const now = new Date().toISOString();
        let inserted = 0;
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO code_bugs (id, bug_type, description, file_path, line_number, project, is_active, created_at, resolution)
          VALUES (?, ?, ?, 'mesh_peer', 0, 'mesh', 0, ?, ?)
        `);
        for (const b of bugs) {
          const id = require("crypto").createHash("sha256").update(b.description + b.resolution).digest("hex").slice(0, 16);
          const info = insertStmt.run(id, b.bug_type, b.description, now, b.resolution);
          if (info.changes > 0) inserted++;
        }
        if (inserted > 0) {
          console.log(`[OWL MESH] Learned ${inserted} new bug patterns from peer ${host}`);
        }
      } catch(e) {}
    });
  }).on("error", () => knownPeers.delete(`${host}:${port}`));

  // Sync Vaccines
  http.get(`http://${host}:${port}/vaccines`, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try {
        const vaccines = JSON.parse(data);
        const now = new Date().toISOString();
        let inserted = 0;
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO memory_programs (id, name, description, program_code, project, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'mesh', ?, ?)
        `);
        for (const v of vaccines) {
          const id = require("crypto").createHash("sha256").update(v.program_code).digest("hex").slice(0, 16);
          const info = insertStmt.run(id, v.name, v.description, v.program_code, now, now);
          if (info.changes > 0) inserted++;
        }
        if (inserted > 0) {
          console.log(`[OWL MESH] Learned ${inserted} new bug vaccines from peer ${host}`);
        }
      } catch(e) {}
    });
  }).on("error", () => {});
}

console.log(`[OWL MESH] Starting Peer-to-Peer Cognitive Mesh (ID: ${PEER_ID})...`);
