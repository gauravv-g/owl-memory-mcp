/**
 * OWL Memory MCP v5.0 — The Ultimate Neuromorphic Substrate (UNS)
 * 
 * "Memory, structure, and action collapsed into a single self-healing, self-evolving substrate."
 * 
 * Designed by the Council:
 * - Einstein: Gravitational context curvature
 * - Tesla: Synaptic resonance wave propagation
 * - Musk: Surprise-gated Acetylcholine error harvesting
 * - Thiel: Contrarian secret contradiction check
 * - Naval: Structural ROI hotspot refactoring
 * - Tata: Dependency stewardship stability ledger
 * - Da Vinci: Anatomical path mapping & circulatory/skeletal self-healing
 * - Torvalds: Git-native branch semantic memory merging
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");

function getCurrentGitInfo(dirPath = ".") {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dirPath, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const commit = execSync("git rev-parse HEAD", { cwd: dirPath, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { branch, commit };
  } catch (e) {
    return { branch: "main", commit: "none" };
  }
}

let sqliteVecLoaded = false;
let embedder = null;
let embedderLoading = null;
let hasVectors = false;
let nerModel = null;
let nerLoading = null;
let hasNER = false;
let lastFocusedNodeId = null;

function loadSqliteVec(db) {
  if (sqliteVecLoaded) return true;
  try {
    const vecDll = path.join(__dirname, "node_modules", "sqlite-vec-windows-x64", "vec0.dll");
    if (fs.existsSync(vecDll)) { db.loadExtension(vecDll); sqliteVecLoaded = true; return true; }
  } catch (e) { console.error("sqlite-vec load failed:", e.message); }
  return false;
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;
  embedderLoading = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
      return embedder;
    } catch (e) {
      console.error("Embedder load failed:", e.message);
      embedderLoading = null;
      return null;
    }
  })();
  return embedderLoading;
}

async function getNER() {
  if (hasNER && nerModel) return nerModel;
  if (nerLoading) return nerLoading;
  nerLoading = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      nerModel = await pipeline("token-classification", "Xenova/bert-base-NER", { quantized: true });
      hasNER = true;
      return nerModel;
    } catch (e) {
      console.error("NER load failed:", e.message);
      nerLoading = null;
      return null;
    }
  })();
  return nerLoading;
}

function warmupNER() { getNER().catch(() => {}); }

async function extractEntitiesNER(text) {
  try {
    const model = await getNER();
    if (!model) return extractEntitiesFallback(text);
    const results = await model(text.slice(0, 512));
    const entities = [];
    let currentEntity = null, currentWords = [], currentType = null;
    for (const r of results) {
      const tag = r.entity;
      const isCont = r.word.startsWith("##");
      const word = r.word.replace(/^##/, "");
      if (tag.startsWith("B-")) {
        if (currentEntity) entities.push([currentEntity, currentType]);
        currentType = tag.slice(2).toLowerCase();
        currentEntity = word;
      } else if (tag.startsWith("I-") && currentEntity) {
        currentEntity += isCont ? word : " " + word;
      } else {
        if (currentEntity) { entities.push([currentEntity, currentType]); currentEntity = null; }
      }
    }
    if (currentEntity) entities.push([currentEntity, currentType]);
    return entities.filter(([n]) => n.length > 1);
  } catch (e) {
    return extractEntitiesFallback(text);
  }
}

function extractEntitiesFallback(text) {
  const e = [];
  for (const m of text.matchAll(/"([^"]+)"/g)) e.push([m[1], "quoted"]);
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)) {
    if (!["The","This","That","These","Those"].includes(m[1].split(" ")[0])) {
      e.push([m[1], "proper_noun"]);
    }
  }
  return e;
}

async function generateEmbedding(text) {
  const m = await getEmbedder();
  if (!m) return null;
  try {
    const out = await m(text.slice(0, 512), { pooling: "mean", normalize: true });
    return Array.from(out.data);
  } catch (e) { return null; }
}

function hexToBigInt(hex) { return BigInt.asIntN(64, BigInt("0x" + hex)); }
function bigIntToHex(bigint) { return BigInt.asUintN(64, bigint).toString(16).padStart(16, "0"); }

const DB_PATH = process.env.OWL_MEMORY_DB || path.join(require("os").homedir(), ".owl-memory", "memory-v5.db");
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

hasVectors = loadSqliteVec(db);
if (hasVectors) {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(embedding float[384])");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS episodic_memories (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, event_type TEXT DEFAULT 'observation',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    project TEXT DEFAULT 'default', location TEXT,
    emotional_valence REAL DEFAULT 0, emotional_arousal REAL DEFAULT 0, salience REAL DEFAULT 0.5,
    strength REAL DEFAULT 1.0, developmental_stage TEXT DEFAULT 'raw',
    access_count INTEGER DEFAULT 0, last_accessed TEXT, next_review TEXT, review_interval REAL DEFAULT 1.0,
    source TEXT DEFAULT 'conversation', mood_tag TEXT, metadata TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1, is_consolidated INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS memory_git_branches (
    memory_id TEXT, branch_name TEXT, commit_sha TEXT,
    PRIMARY KEY(memory_id, branch_name),
    FOREIGN KEY(memory_id) REFERENCES episodic_memories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS semantic_memories (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, concept_type TEXT DEFAULT 'fact',
    project TEXT DEFAULT 'default', importance REAL DEFAULT 0.5, confidence REAL DEFAULT 0.8,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS procedural_memories (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    mastery_level REAL DEFAULT 0.1, practice_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
    project TEXT DEFAULT 'default', created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS somatic_memories (
    id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, entity_type TEXT DEFAULT 'general',
    somatic_valence REAL DEFAULT 0, somatic_arousal REAL DEFAULT 0, somatic_weight REAL DEFAULT 0.5,
    last_triggered TEXT, trigger_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS transactive_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_name TEXT NOT NULL, domain TEXT NOT NULL,
    expertise_level REAL DEFAULT 0.5, project TEXT DEFAULT 'default', created_at TEXT NOT NULL,
    UNIQUE(agent_name, domain, project)
  );

  CREATE TABLE IF NOT EXISTS threat_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_name TEXT NOT NULL, description TEXT NOT NULL,
    trigger_conditions TEXT DEFAULT '[]', severity TEXT DEFAULT 'warning',
    created_at TEXT NOT NULL, is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, context TEXT,
    options TEXT, chosen_option TEXT, predicted_outcome TEXT,
    actual_outcome TEXT, status TEXT DEFAULT 'pending',
    project TEXT DEFAULT 'default', created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS causal_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cause_id TEXT NOT NULL,
    effect_id TEXT NOT NULL, strength REAL DEFAULT 0.5,
    link_type TEXT DEFAULT 'causes', created_at TEXT NOT NULL,
    UNIQUE(cause_id, effect_id, link_type)
  );

  CREATE TABLE IF NOT EXISTS contradictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id_1 TEXT NOT NULL, memory_type_1 TEXT NOT NULL,
    memory_id_2 TEXT NOT NULL, memory_type_2 TEXT NOT NULL, severity TEXT DEFAULT 'warning',
    detected_at TEXT NOT NULL, resolved INTEGER DEFAULT 0, resolution TEXT
  );

  CREATE TABLE IF NOT EXISTS code_nodes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, node_type TEXT NOT NULL,
    filepath TEXT NOT NULL, content TEXT, project TEXT DEFAULT 'default',
    edit_count INTEGER DEFAULT 0, bug_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS code_edges (
    source_id TEXT NOT NULL, target_id TEXT NOT NULL,
    edge_type TEXT DEFAULT 'calls', weight REAL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, edge_type)
  );

  CREATE TABLE IF NOT EXISTS memory_code_links (
    memory_id TEXT NOT NULL, code_node_id TEXT NOT NULL,
    link_type TEXT DEFAULT 'associated',
    PRIMARY KEY (memory_id, code_node_id)
  );

  CREATE TABLE IF NOT EXISTS code_node_activation (
    node_id TEXT PRIMARY KEY, activation REAL DEFAULT 0.0,
    last_updated INTEGER,
    FOREIGN KEY(node_id) REFERENCES code_nodes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dependency_stewardship (
    package_name TEXT PRIMARY KEY, error_count INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0, status TEXT DEFAULT 'stable',
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS code_bugs (
    id TEXT PRIMARY KEY, bug_type TEXT NOT NULL,
    description TEXT, file_path TEXT, line_number INTEGER,
    resolution TEXT, project TEXT, created_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS consolidation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, completed_at TEXT,
    memories_processed INTEGER DEFAULT 0, memories_merged INTEGER DEFAULT 0, memories_pruned INTEGER DEFAULT 0,
    status TEXT DEFAULT 'completed'
  );

  CREATE TABLE IF NOT EXISTS synaptic_weights (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    attention_weight REAL DEFAULT 0.1,
    co_occurrences INTEGER DEFAULT 1,
    last_transition TEXT NOT NULL,
    PRIMARY KEY(source_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS schema_evolution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evolved_column TEXT NOT NULL,
    source_metadata_key TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

function calculateSimilarity(a, b) {
  const w1 = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const w2 = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const inter = new Set([...w1].filter(w => w2.has(w)));
  const union = new Set([...w1, ...w2]);
  return Math.min(1, inter.size / Math.max(union.size, 1));
}

function detectEmotionalSalience(t) {
  const l = t.toLowerCase(); let v = 0, a = 0;
  for (const w of ["love","great","excellent","amazing","perfect","awesome","happy"]) { if (l.includes(w)) { v += 0.2; a += 0.15; } }
  for (const w of ["hate","terrible","horrible","broken","bug","error","crash","fail"]) { if (l.includes(w)) { v -= 0.3; a += 0.3; } }
  for (const w of ["urgent","critical","immediately","danger","security","warning"]) { if (l.includes(w)) a += 0.4; }
  return { valence: Math.max(-1, Math.min(1, v)), arousal: Math.max(0, Math.min(1, a)), salience: Math.min(1, Math.abs(v) * 0.5 + a * 0.5) };
}

function generateId(content, salt = "") {
  return crypto.createHash("sha256").update(content + salt + Date.now().toString()).digest("hex").slice(0, 16);
}

function resolveActiveNode(activeFile, codeSnippet, projectId = "default") {
  if (!activeFile) return null;
  const relPath = activeFile.replace(/\\/g, "/");
  const fileNode = db.prepare("SELECT id FROM code_nodes WHERE id = ?").get(relPath);
  if (!fileNode) {
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO code_nodes (id, name, node_type, filepath, project, created_at, updated_at) VALUES (?, ?, 'file', ?, ?, ?, ?)").run(relPath, path.basename(relPath), relPath, projectId, now, now);
  }
  if (codeSnippet) {
    const funcs = db.prepare("SELECT id, name FROM code_nodes WHERE filepath = ? AND node_type = 'function'").all(relPath);
    for (const f of funcs) {
      if (codeSnippet.includes(f.name)) return f.id;
    }
  }
  return relPath;
}

function updateHebbianTransition(fromNode, toNode) {
  if (!fromNode || !toNode || fromNode === toNode) return;
  const now = new Date().toISOString();
  const row = db.prepare("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?").get(fromNode, toNode);
  if (row) {
    const w = row.attention_weight;
    const nextW = w + 0.1 * (1.0 - w);
    db.prepare("UPDATE synaptic_weights SET attention_weight = ?, co_occurrences = co_occurrences + 1, last_transition = ? WHERE source_id = ? AND target_id = ?")
      .run(nextW, now, fromNode, toNode);
  } else {
    db.prepare("INSERT INTO synaptic_weights (source_id, target_id, attention_weight, co_occurrences, last_transition) VALUES (?, ?, 0.1, 1, ?)")
      .run(fromNode, toNode, now);
  }
}

function getRefractoryDilation(activeNodeId, projectId) {
  if (!activeNodeId) return [];
  var nodes = db.prepare("SELECT * FROM code_nodes WHERE project = ?").all(projectId);
  var dilated = [];
  var contradictions = db.prepare("SELECT * FROM episodic_memories WHERE event_type = 'error' AND project = ?").all(projectId);
  var now = Date.now();

  for (var node of nodes) {
    var state = "gas";
    var gravity = 0;
    var curvatureTensor = { spacetime: 0, hebbian: 0, errorDensity: 0, editFrequency: 0, recency: 0 };
    var timeDilation = 1.0;
    var darkMatterWarp = 0;
    var insideEventHorizon = false;
    if (node.id === activeNodeId) {
      state = "solid";
      gravity = 1.0;
      curvatureTensor = { spacetime: 1.0, hebbian: 1.0, errorDensity: 0, editFrequency: 0, recency: 1.0 };
    } else {
      var dist = getCodePathDistance(activeNodeId, node.id);
      var hebb = db.prepare("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?").get(activeNodeId, node.id);
      var weight = hebb ? hebb.attention_weight : 0.0;
      var editStats = db.prepare("SELECT edit_count, bug_count FROM code_nodes WHERE id = ?").get(node.id);
      var editFreq = editStats && editStats.edit_count > 0 ? Math.min(editStats.edit_count / 10, 1) : 0;
      var errorDensity = editStats && editStats.bug_count > 0 ? Math.min(editStats.bug_count / (editStats.edit_count + 1) * 2, 1) : 0;
      var spacetimeCurvature = 1.0 / (dist + 1);
      var hebbianCurvature = weight;
      var recencyCurvature = node.created_at ? 1.0 - Math.min(1, (now - new Date(node.created_at).getTime()) / (86400000 * 14)) : 0;
      curvatureTensor = {
        spacetime: Math.round(spacetimeCurvature * 100) / 100,
        hebbian: Math.round(hebbianCurvature * 100) / 100,
        errorDensity: Math.round(errorDensity * 100) / 100,
        editFrequency: Math.round(editFreq * 100) / 100,
        recency: Math.round(recencyCurvature * 100) / 100
      };
      var tensorMagnitude = (spacetimeCurvature * 0.25 + hebbianCurvature * 0.25 + errorDensity * 0.20 + editFreq * 0.15 + recencyCurvature * 0.15);
      var nodeContradictions = contradictions.filter(function(m){return m.content && (m.content.indexOf(node.name||"")>=0 || m.content.indexOf(node.id)>=0)});
      var contradictionMass = nodeContradictions.length * 0.1;
      darkMatterWarp = Math.min(contradictionMass, 0.5);
      gravity = Math.round((tensorMagnitude + darkMatterWarp) * 100) / 100;
      if (tensorMagnitude > 0.3 && node.created_at) {
        var nodeAgeMs = now - new Date(node.created_at).getTime();
        var nodeAgeHours = nodeAgeMs / 3600000;
        timeDilation = 1.0 + (tensorMagnitude * 0.5) / (nodeAgeHours + 1);
        timeDilation = Math.round(timeDilation * 100) / 100;
      }
      if (gravity > 0.65) {
        insideEventHorizon = true;
        state = "blackhole";
      } else if (dist <= 1 || weight > 0.4 || gravity > 0.4) {
        state = "liquid";
      }
    }
    var representation = "";
    if (state === "solid") {
      representation = node.content || ("// File content of " + node.id);
    } else if (state === "blackhole") {
      representation = "[EVENT HORIZON - context trapped] node: " + (node.id || node.name) + ", curvature: " + gravity + ", dark_matter: " + darkMatterWarp;
    }
    dilated.push({ id: node.id, name: node.name, filepath: node.filepath, state: state, gravity: gravity, curvature_tensor: curvatureTensor, time_dilation: timeDilation, dark_matter_warp: darkMatterWarp, inside_event_horizon: insideEventHorizon, representation: representation });
  }
  return dilated.sort(function(a,b){return b.gravity - a.gravity}).slice(0, 15);
}

function runAutonomicDreamSimulation(p){
var h=calculateRefactoringHotspots(p);if(!h||!h.length)return{s:[],z:0};
var r=[],f=require("fs");
for(var t of h){var x;try{x=f.readFileSync(t.filepath,"utf8")}catch(e){}
var o={f:t.filepath,hs:t.leverage_score,m:[]};
if(x){if(x.indexOf("db.prepare")>=0)o.m.push({t:"db"});
var rx=/require\s*\(\s*["']([^"']+)/;var m=rx.exec(x);if(m)o.m.push({t:"req",d:m[1]})
}else o.m.push({t:"nf"});if(o.m.length)r.push(o)}
try{var dn=db.prepare("SELECT id FROM code_nodes WHERE edit_count=0 AND bug_count=0 AND type='file'").all(p);for(var d of dn){var ed=db.prepare("SELECT source_id FROM code_edges WHERE target_id=?").all(d.id);if(ed.length)r.push({f:d.id,dead:1,imp:ed.length})}}catch(e){}
return{s:"ok",n:r.length,r:r}}

function calculateRelativisticGravity(activeNodeId, projectId) {
  var memories = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
  var ranked = [];
  var now = Date.now();
  var errorCount = db.prepare("SELECT COUNT(*) as cnt FROM episodic_memories WHERE project = ? AND event_type = 'error'").get(projectId);
  var errorMass = errorCount ? Math.min(errorCount.cnt / 50, 1.0) : 0;
  for (var mem of memories) {
    var minDistance = 4;
    if (activeNodeId) {
      var links = db.prepare("SELECT code_node_id FROM memory_code_links WHERE memory_id = ?").all(mem.id);
      for (var link of links) {
        if (link.code_node_id === activeNodeId) { minDistance = 0; break; }
        var dist = getCodePathDistance(activeNodeId, link.code_node_id);
        if (dist < minDistance) minDistance = dist;
      }
    }
    var ageHours = (now - new Date(mem.created_at).getTime()) / (3600 * 1000);
    var emotionalWeight = 1.0 + Math.abs(mem.emotional_valence) * 0.5 + mem.emotional_arousal * 0.5;
    var curvatureSpacetime = 1.0 / (Math.pow(minDistance + 1, 2));
    var curvatureEmotional = emotionalWeight * 0.3;
    var curvatureSalience = mem.salience * 0.3;
    var curvatureError = errorMass * 0.2;
    var curvatureRecency = 1.0 / (Math.pow(ageHours + 1, 0.15));
    var timeDilationFactor = 1.0;
    if (minDistance <= 1 && ageHours < 24) {
      timeDilationFactor = 1.0 + (1.0 / (ageHours + 1)) * 0.5;
    }
    var gravity = (curvatureSpacetime * mem.salience + curvatureEmotional * 0.25 + curvatureSalience * 0.25 + curvatureError * 0.15 + curvatureRecency * 0.15) * timeDilationFactor;
    ranked.push({ id: mem.id, content: mem.content, event_type: mem.event_type, gravity: Math.round(gravity * 1000) / 1000, spatial_distance: minDistance, curvature_tensor: { spacetime: Math.round(curvatureSpacetime * 1000) / 1000, emotional: Math.round(curvatureEmotional * 1000) / 1000, salience: Math.round(curvatureSalience * 1000) / 1000, errorMass: Math.round(curvatureError * 1000) / 1000, recency: Math.round(curvatureRecency * 1000) / 1000 }, time_dilation_factor: Math.round(timeDilationFactor * 1000) / 1000, created_at: mem.created_at });
  }
  return ranked.sort(function(a,b){return b.gravity - a.gravity}).slice(0, 10);
}

function getCodePathDistance(fromNode, toNode) {
  if (fromNode === toNode) return 0;
  const visited = new Set();
  const queue = [[fromNode, 0]];
  while (queue.length > 0) {
    const [curr, dist] = queue.shift();
    if (curr === toNode) return dist;
    if (dist >= 4) continue;
    if (visited.has(curr)) continue;
    visited.add(curr);
    const edges = db.prepare("SELECT target_id FROM code_edges WHERE source_id = ?").all(curr);
    for (const edge of edges) {
      if (!visited.has(edge.target_id)) queue.push([edge.target_id, dist + 1]);
    }
  }
  return 4;
}

function propagateTeslaResonance(activeNodeId, steps = 15) {
  if (!activeNodeId) return [];

  const allNodes = db.prepare("SELECT id FROM code_nodes").all().map(n => n.id);
  if (allNodes.length === 0) return [];

  const u = {};
  const v = {};
  for (const id of allNodes) {
    u[id] = 0.0;
    v[id] = 0.0;
  }

  if (u[activeNodeId] !== undefined) {
    u[activeNodeId] = 10.0;
  }

  const edges = db.prepare("SELECT source_id, target_id, 1.0 as weight FROM code_edges").all();
  const synWeights = db.prepare("SELECT source_id, target_id, attention_weight as weight FROM synaptic_weights").all();
  const allEdges = edges.concat(synWeights);

  const adj = {};
  for (const id of allNodes) adj[id] = [];
  for (const e of allEdges) {
    if (adj[e.source_id] && adj[e.target_id]) {
      adj[e.source_id].push({ target: e.target_id, weight: e.weight });
      adj[e.target_id].push({ target: e.source_id, weight: e.weight }); // bi-directional springs
    }
  }

  const dt = 0.15;
  const damping = 0.2; // Energy dissipation
  const stiffness = 0.6; // Coupling strength

  for (let step = 0; step < steps; step++) {
    const accelerations = {};
    for (const id of allNodes) {
      let force = 0.0;
      for (const neighbor of adj[id]) {
        force += stiffness * neighbor.weight * (u[neighbor.target] - u[id]);
      }
      accelerations[id] = force - damping * v[id] - 0.15 * u[id];
    }

    for (const id of allNodes) {
      v[id] += accelerations[id] * dt;
      u[id] += v[id] * dt;
    }
  }

  const nowTime = Date.now();
  for (const id of allNodes) {
    const act = Math.max(0, Math.abs(u[id]));
    if (act > 0.01) {
      db.prepare(`
        INSERT INTO code_node_activation (node_id, activation, last_updated)
        VALUES (?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET activation = excluded.activation, last_updated = excluded.last_updated
      `).run(id, act, nowTime);
    }
  }

  const resonanceMemories = [];
  for (const id of allNodes) {
    const act = Math.max(0, Math.abs(u[id]));
    if (act > 0.5) {
      const links = db.prepare("SELECT memory_id FROM memory_code_links WHERE code_node_id = ?").all(id);
      for (const l of links) {
        const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND is_active = 1").get(l.memory_id);
        if (mem) {
          resonanceMemories.push({
            id: mem.id,
            content: mem.content,
            activation: act,
            node_id: id
          });
        }
      }
    }
  }
  return resonanceMemories.sort((a, b) => b.activation - a.activation);
}

async function harvestErrorMusk(errorMessage, command = "test", projectId = "default") {
  
  let filepath = "unknown_file";
  let lineNumber = 0;
  let functionName = "anonymous";

  const jsPatt = /at\s+([^\s(]+)\s+\(([^:]+):(\d+):(\d+)\)/;
  const jsPatt2 = /at\s+([^:]+):(\d+):(\d+)/;
  const pyPatt = /File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(\w+)/;

  let match = errorMessage.match(jsPatt);
  if (match) {
    functionName = match[1]; filepath = match[2]; lineNumber = parseInt(match[3], 10);
  } else {
    match = errorMessage.match(jsPatt2);
    if (match) { filepath = match[1]; lineNumber = parseInt(match[2], 10); }
    else {
      match = errorMessage.match(pyPatt);
      if (match) { filepath = match[1]; lineNumber = parseInt(match[2], 10); functionName = match[3]; }
    }
  }

  filepath = filepath.replace(/\\/g, "/").trim();
  if (filepath.includes("/")) {
    const parts = filepath.split("/");
    filepath = parts.slice(-2).join("/"); // Normalize to relative tail path
  }

  const codeNodeId = `${filepath}::function::${functionName}`;
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO code_nodes (id, name, node_type, filepath, created_at, updated_at) VALUES (?, ?, 'function', ?, ?, ?)").run(codeNodeId, functionName, filepath, now, now);
  db.prepare("UPDATE code_nodes SET bug_count = bug_count + 1 WHERE id = ? OR id = ?").run(codeNodeId, filepath);

  const gitInfo = getCurrentGitInfo();
  const branchFailCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM episodic_memories em
    JOIN memory_git_branches mgb ON mgb.memory_id = em.id
    WHERE mgb.branch_name = ? AND em.event_type = 'error'
  `).get(gitInfo.branch)?.cnt || 0;
  
  const surpriseScore = branchFailCount === 0 ? 1.0 : Math.max(0.1, 1 / (branchFailCount + 1));

  const memId = generateId(errorMessage, "musk");
  const emotional = detectEmotionalSalience(errorMessage);
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
    VALUES (?, ?, 'error', ?, ?, ?, ?, ?, ?, ?)
  `).run(memId, `BUG HARVESTED: ${errorMessage.slice(0, 400)}`, projectId, emotional.valence, Math.max(0.8, emotional.arousal), surpriseScore, 1.0, now, now);

  db.prepare("INSERT OR REPLACE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)")
    .run(memId, gitInfo.branch, gitInfo.commit);

  db.prepare("INSERT OR REPLACE INTO memory_code_links (memory_id, code_node_id, link_type) VALUES (?, ?, 'caused_bug')").run(memId, codeNodeId);
  db.prepare("INSERT OR REPLACE INTO memory_code_links (memory_id, code_node_id, link_type) VALUES (?, ?, 'caused_bug')").run(memId, filepath);

  db.prepare("INSERT OR IGNORE INTO code_bugs (id, bug_type, description, file_path, line_number, project, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(generateId(errorMessage, "bug"), "runtime_error", errorMessage.slice(0, 200), filepath, lineNumber, projectId, now);

  return { status: "success", memory_id: memId, codeNodeId, surpriseScore };
}

function checkContrarianSecrets(activeFile, codeSnippet, projectId = "default") {
  if (!activeFile) return [];
  const relPath = activeFile.replace(/\\/g, "/");
  const textToScan = codeSnippet || "";
  const assertions = [];
  const lines = textToScan.split("\n");

  for (const line of lines) {
    if (line.includes("//") || line.includes("#")) {
      const comment = line.slice(Math.max(line.indexOf("//"), line.indexOf("#"))).toLowerCase();
      if (comment.includes("thread-safe") || comment.includes("thread safe")) assertions.push({ type: "thread_safety", text: line.trim() });
      if (comment.includes("validated") || comment.includes("never throws") || comment.includes("no-throw") || comment.includes("never fails")) assertions.push({ type: "stability", text: line.trim() });
      if (comment.includes("fast") || comment.includes("constant time") || comment.includes("linear time")) assertions.push({ type: "performance", text: line.trim() });
      if (comment.includes("not null") || comment.includes("never null") || comment.includes("non-null")) assertions.push({ type: "null_handling", text: line.trim() });
    }
  }

  const secrets = [];
  for (const ass of assertions) {
    const historicalFailures = db.prepare(`
      SELECT em.content, em.created_at FROM episodic_memories em
      JOIN memory_code_links mcl ON mcl.memory_id = em.id
      WHERE em.project = ? AND mcl.code_node_id LIKE ? AND em.event_type = 'error'
    `).all(projectId, `%${relPath}%`);

    let matchingFails = [...historicalFailures];
    let projectFails = [];
    if (ass.type === "thread_safety") {
      projectFails = db.prepare(`
        SELECT content, created_at FROM episodic_memories 
        WHERE project = ? AND event_type = 'error' 
          AND (content LIKE '%thread%' OR content LIKE '%race%' OR content LIKE '%concurrency%' OR content LIKE '%lock%' OR content LIKE '%deadlock%')
      `).all(projectId);
    } else if (ass.type === "stability") {
      projectFails = db.prepare(`
        SELECT content, created_at FROM episodic_memories 
        WHERE project = ? AND event_type = 'error'
          AND (content LIKE '%throw%' OR content LIKE '%exception%' OR content LIKE '%crash%' OR content LIKE '%error%' OR content LIKE '%fail%' OR content LIKE '%leak%')
      `).all(projectId);
    } else if (ass.type === "null_handling") {
      projectFails = db.prepare(`
        SELECT content, created_at FROM episodic_memories 
        WHERE project = ? AND event_type = 'error'
          AND (content LIKE '%null%' OR content LIKE '%undefined%' OR content LIKE '%pointer%' OR content LIKE '%dereference%')
      `).all(projectId);
    } else if (ass.type === "performance") {
      projectFails = db.prepare(`
        SELECT content, created_at FROM episodic_memories 
        WHERE project = ? AND event_type = 'observation'
          AND (content LIKE '%slow%' OR content LIKE '%performance%' OR content LIKE '%ms%' OR content LIKE '%latency%')
      `).all(projectId);
    }

    const seenContents = new Set(matchingFails.map(f => f.content));
    for (const pf of projectFails) {
      if (!seenContents.has(pf.content)) {
        matchingFails.push(pf);
        seenContents.add(pf.content);
      }
    }

    for (const fail of matchingFails) {
      secrets.push({
        assertion_type: ass.type,
        assertion_text: ass.text,
        contradictory_evidence: fail.content,
        date_recorded: fail.created_at,
        message: `SECRET: Declared rule '${ass.text}' contradicts recorded local crash: '${fail.content}'.`
      });
    }
  }
  return secrets;
}

function calculateRefactoringHotspots(projectId) {
  const nodes = db.prepare(`
    SELECT id, name, node_type, filepath, edit_count, bug_count FROM code_nodes
    WHERE project = ? AND (edit_count > 0 OR bug_count > 0)
  `).all(projectId);

  const hotspots = nodes.map(n => {
    const leverageScore = (n.bug_count * 2.0) / (n.edit_count + 1);
    return {
      node_id: n.id,
      name: n.name,
      filepath: n.filepath,
      type: n.node_type,
      edit_count: n.edit_count,
      bug_count: n.bug_count,
      leverage_score: Math.round(leverageScore * 100) / 100
    };
  });

  return hotspots.sort((a, b) => b.leverage_score - a.leverage_score).slice(0, 5);
}

function checkDependencyStewardship(activeFile) {
  if (!activeFile) return [];
  const relPath = activeFile.replace(/\\/g, "/");
  const imports = db.prepare("SELECT target_id FROM code_edges WHERE source_id = ? AND edge_type = 'imports'").all(relPath);
  const alerts = [];

  for (const imp of imports) {
    const steward = db.prepare("SELECT * FROM dependency_stewardship WHERE package_name = ?").get(imp.target_id);
    if (steward) {
      const crashRate = steward.use_count === 0 ? 0 : steward.error_count / steward.use_count;
      const status = crashRate > 0.4 ? "critical" : (crashRate > 0.15 ? "unstable" : "stable");
      const trustCoefficient = 1.0 - crashRate;
      
      if (status !== "stable") {
        let circuitBreakerProposal = null;
        if (trustCoefficient < 0.8) {
          circuitBreakerProposal = `PROPOSAL: Wrap all invocations of '${steward.package_name}' in a try-catch circuit breaker. Example:\n` +
            `try { return require('${steward.package_name}').call(); } catch (e) { console.error('Tata Circuit Breaker Tripped:', e.message); return null; }`;
        }
        alerts.push({
          package: steward.package_name,
          error_count: steward.error_count,
          use_count: steward.use_count,
          crash_rate: Math.round(crashRate * 100) + "%",
          trust_coefficient: Math.round(trustCoefficient * 100) / 100,
          status: status,
          message: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`,
          warning: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`,
          circuit_breaker: circuitBreakerProposal
        });
      }
    }
  }
  return alerts;
}

function calculateDaVinciHealing(activeNodeId) {
  if (!activeNodeId) return null;
  const callees = db.prepare("SELECT target_id, edge_type FROM code_edges WHERE source_id = ?").all(activeNodeId);
  const recommendations = [];

  for (const callee of callees) {
    const bug = db.prepare("SELECT * FROM code_bugs WHERE file_path LIKE ? AND is_active = 1").get(`%${callee.target_id}%`);
    if (bug) {
      const siblingNodes = db.prepare(`
        SELECT DISTINCT ce.target_id FROM code_edges ce
        WHERE ce.source_id = ? AND ce.target_id != ?
      `).all(activeNodeId, callee.target_id);

      let pathType = "Circulatory (Data Stream)";
      if (callee.edge_type === "imports") pathType = "Skeletal (Import Schema)";
      if (callee.target_id.includes("event") || callee.target_id.includes("handler")) pathType = "Nervous (Event Callback)";

      recommendations.push({
        anatomical_path: pathType,
        failed_node: callee.target_id,
        cause: bug.description,
        healing_options: siblingNodes.map(s => s.target_id),
        resolution_hint: bug.resolution ? `Apply previous fix: ${bug.resolution}` : "Mock interface or wrap in try/catch circuit breaker."
      });
    }
  }
  return recommendations;
}

function mergeGitBranchMemories(sourceBranch, targetBranch, projectId = "default") {
  const sourceMems = db.prepare(`
    SELECT em.* FROM episodic_memories em
    JOIN memory_git_branches mgb ON mgb.memory_id = em.id
    WHERE mgb.branch_name = ? AND em.project = ?
  `).all(sourceBranch, projectId);

  let mergedCount = 0;
  let contradictionCount = 0;

  for (const sm of sourceMems) {
    const targets = db.prepare(`
      SELECT em.* FROM episodic_memories em
      JOIN memory_git_branches mgb ON mgb.memory_id = em.id
      WHERE mgb.branch_name = ? AND em.project = ? AND em.is_active = 1
    `).all(targetBranch, projectId);

    let isConflict = false;
    for (const tm of targets) {
      const sim = calculateSimilarity(sm.content, tm.content);
      if (sim > 0.4) {
        const neg = ["no", "not","no longer","disabled","remove","changed"];
        const smNeg = neg.some(w => sm.content.toLowerCase().includes(w));
        const tmNeg = neg.some(w => tm.content.toLowerCase().includes(w));
        if (smNeg !== tmNeg) {
          db.prepare("INSERT INTO contradictions (memory_id_1, memory_type_1, memory_id_2, memory_type_2, detected_at) VALUES (?, 'episodic', ?, 'episodic', ?)")
            .run(tm.id, sm.id, new Date().toISOString());
          contradictionCount++;
          isConflict = true;
        }
      }
    }

    if (!isConflict) {
      db.prepare("INSERT OR IGNORE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)")
        .run(sm.id, targetBranch, "merged");
      mergedCount++;
    }
  }

  return { mergedCount, contradictionCount };
}

function consolidateMemories(projectId) {
  const now = new Date().toISOString();
  const active = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE is_active = 1 AND project = ?").all(projectId);
  let processed = 0, merged = 0, pruned = 0;

  const processedIds = new Set();
  for (let i = 0; i < active.length; i++) {
    const m1 = active[i]; if (processedIds.has(m1.id)) continue;
    for (let j = i + 1; j < active.length; j++) {
      const m2 = active[j]; if (processedIds.has(m2.id)) continue;
      if (calculateSimilarity(m1.content, m2.content) > 0.75) {
        const keep = m1.strength >= m2.strength ? m1 : m2, dep = m1.strength >= m2.strength ? m2 : m1;
        db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(dep.id);
        db.prepare("UPDATE episodic_memories SET strength = strength + 0.3 WHERE id = ?").run(keep.id);
        processedIds.add(dep.id); merged++;
      }
    }
    processed++;
  }

  db.prepare("INSERT INTO consolidation_log (started_at, completed_at, memories_processed, memories_merged, memories_pruned) VALUES (?, ?, ?, ?, ?)")
    .run(now, now, processed, merged, pruned);
  return { processed, merged, pruned };
}

function evolveDatabaseSchema(projectId) {
  const now = new Date().toISOString();
  const evolutions = [];
  
  try {
    const memories = db.prepare("SELECT metadata FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
    if (memories.length < 5) {
      return { status: "no_evolution_threshold_under_minimum", count: memories.length };
    }

    const keyCounts = {};
    let totalWithMetadata = 0;
    
    for (const mem of memories) {
      if (!mem.metadata) continue;
      try {
        const meta = JSON.parse(mem.metadata);
        if (meta && typeof meta === "object") {
          totalWithMetadata++;
          for (const key of Object.keys(meta)) {
            keyCounts[key] = (keyCounts[key] || 0) + 1;
          }
        }
      } catch (e) {}
    }

    if (totalWithMetadata < 3) {
      return { status: "insufficient_metadata_records", count: totalWithMetadata };
    }

    const tableInfo = db.prepare("PRAGMA table_info(episodic_memories)").all();
    const existingColumns = new Set(tableInfo.map(col => col.name.toLowerCase()));

    const candidates = [];
    const threshold = memories.length * 0.40;
    
    for (const [key, count] of Object.entries(keyCounts)) {
      if (count > threshold) {
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) && key.length <= 30) {
          if (!existingColumns.has(key.toLowerCase())) {
            candidates.push(key);
          }
        }
      }
    }

    for (const key of candidates) {
      console.error(`[OWL SERVER] Evolving schema: adding column [${key}] to episodic_memories`);
      db.prepare(`ALTER TABLE episodic_memories ADD COLUMN ${key} TEXT`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_episodic_memories_${key} ON episodic_memories(${key})`).run();
      db.prepare(`
        UPDATE episodic_memories 
        SET ${key} = json_extract(metadata, '$.${key}') 
        WHERE json_extract(metadata, '$.${key}') IS NOT NULL
      `).run();
      
      db.prepare(`
        INSERT INTO schema_evolution_log (evolved_column, source_metadata_key, applied_at)
        VALUES (?, ?, ?)
      `).run(key, key, now);
      
      evolutions.push({ column: key, source_key: key, status: "evolved" });
    }

    return { status: "completed", evolutions_count: evolutions.length, evolutions };

  } catch (err) {
    console.error(`[OWL SERVER] Schema evolution failed: ${err.message}`);
    return { status: "failed", error: err.message };
  }
}

function pruneGlymphaticSubstrate(projectId) {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  
  try {
    console.error(`[OWL SERVER] Executing Sleep-State Glymphatic Cleanup...`);
    
    const synRes = db.prepare(`
      DELETE FROM synaptic_weights 
      WHERE attention_weight < 0.12 
        AND last_transition < ?
    `).run(yesterday);

    const bugRes = db.prepare(`
      DELETE FROM code_bugs 
      WHERE is_active = 0 
        AND created_at < ?
    `).run(twoDaysAgo);

    db.exec("VACUUM");

    console.error(`[OWL SERVER] Glymphatic cleanup complete. Pruned ${synRes.changes} synapses and ${bugRes.changes} bugs.`);
    return {
      status: "completed",
      pruned_synapses: synRes.changes,
      pruned_bugs: bugRes.changes
    };
  } catch (err) {
    console.error(`[OWL SERVER] Glymphatic cleanup failed: ${err.message}`);
    return { status: "failed", error: err.message };
  }
}

function chronoPruneWorkspace(projectId) {
  try {
    const deadNodes = db.prepare(`
      SELECT cn.id, cn.name, cn.filepath, cn.node_type 
      FROM code_nodes cn
      LEFT JOIN code_node_activation cna ON cna.node_id = cn.id
      WHERE cn.project = ? AND cn.edit_count = 0 AND cn.bug_count = 0
        AND (cna.activation IS NULL OR cna.activation < 0.1)
    `).all(projectId);

    const proposals = deadNodes.map(n => {
      return {
        node_id: n.id,
        name: n.name,
        filepath: n.filepath,
        type: n.node_type,
        recommendation: `DELETE: Node [${n.name}] is completely dead weight (0 edits, 0 bugs, 0 focus activation). Delete it to reach perfection.`
      };
    });

    return {
      status: "pruner_analysis_completed",
      dead_nodes_count: deadNodes.length,
      proposals
    };
  } catch (err) {
    console.error(`[OWL SERVER] Chrono-pruner failed: ${err.message}`);
    return { status: "failed", error: err.message };
  }
}

const server = new Server(
  { name: "owl-memory", version: "5.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "nexus",
      description: "The Single Unified Cognitive Interface. Collapses memory, call-graphs, context curvature (gravity), dependencies, and error harvesting into a single query. Action can be 'perceive', 'record', 'cogitate', 'act', or 'dream'.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["perceive", "record", "cogitate", "act", "dream"], description: "The cognitive/operational action to perform." },
          workspace_state: {
            type: "object",
            description: "Used for 'perceive' and 'act'. Current editor / file state.",
            properties: {
              active_file: { type: "string", description: "The file currently focused in the editor." },
              cursor_line: { type: "integer" },
              code_snippet: { type: "string", description: "The code focused or proposed." },
              terminal_output: { type: "string" },
              git_diff: { type: "string" }
            }
          },
          memory_data: {
            type: "object",
            properties: {
              content: { type: "string" },
              event_type: { type: "string", enum: ["observation", "decision", "interaction", "learning", "error", "insight"] },
              linked_code_nodes: { type: "array", items: { type: "string" } }
            },
            required: ["content"]
          },
          reasoning_query: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["decide", "why", "transfer", "self_analyze", "merge_branches"] },
              context: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              chosen_option: { type: "string" },
              target_domain: { type: "string" },
              source_branch: { type: "string" },
              target_branch: { type: "string" }
            },
            required: ["type"]
          },
          operational_cmd: {
            type: "object",
            properties: {
              command: { type: "string" },
              cwd: { type: "string" }
            },
            required: ["command"]
          },
          project: { type: "string", default: "default" }
        },
        required: ["action"]
      }
    },
    {
      name: "remember",
      description: "Store episodic memory.",
      inputSchema: { type: "object", properties: { content: { type: "string" }, project: { type: "string", default: "default" } }, required: ["content"] }
    },
    {
      name: "recall",
      description: "Recall memories via keyword/vector similarity.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string", default: "default" } }, required: ["query"] }
    },
    {
      name: "get_stats",
      description: "Get database stats.",
      inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } }
    },
    {
      name: "index_codebase",
      description: "Register folders and AST files.",
      inputSchema: { type: "object", properties: { scan_path: { type: "string" }, project: { type: "string", default: "default" } }, required: ["scan_path"] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const now = new Date().toISOString();
  const projectId = args.project || "default";

  try {
    if (name === "remember") {
      const content = args.content;
      const memId = generateId(content, projectId);
      const emotional = detectEmotionalSalience(content);
      db.prepare("INSERT INTO episodic_memories (id, content, project, emotional_valence, emotional_arousal, salience, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(memId, content, projectId, emotional.valence, emotional.arousal, emotional.salience, now, now);
      if (hasVectors) {
        const emb = await generateEmbedding(content);
        if (emb) db.prepare("INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (?, ?)").run(hexToBigInt(memId), JSON.stringify(emb));
      }
      return { content: [{ type: "text", text: JSON.stringify({ status: "success", memory_id: memId }) }] };
    }

    if (name === "recall") {
      const query = args.query;
      const mems = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
      const matches = mems.map(m => ({
        id: m.id,
        content: m.content,
        score: Math.round(calculateSimilarity(query, m.content) * 100) / 100
      })).sort((a, b) => b.score - a.score).slice(0, 10);
      return { content: [{ type: "text", text: JSON.stringify(matches) }] };
    }

    if (name === "get_stats") {
      const ep = db.prepare("SELECT COUNT(*) as cnt FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId)?.cnt || 0;
      const sem = db.prepare("SELECT COUNT(*) as cnt FROM semantic_memories WHERE project = ?").get(projectId)?.cnt || 0;
      const proc = db.prepare("SELECT COUNT(*) as cnt FROM procedural_memories WHERE project = ?").get(projectId)?.cnt || 0;
      const som = db.prepare("SELECT COUNT(*) as cnt FROM somatic_memories").get()?.cnt || 0;
      return { content: [{ type: "text", text: JSON.stringify({ project: projectId, episodic: ep, semantic: sem, procedural: proc, somatic: som, vector_search: hasVectors }) }] };
    }

    if (name === "index_codebase") {
      const scanPath = args.scan_path;
      const files = [];
      function recurse(dir) {
        if (!fs.existsSync(dir)) return;
        for (const file of fs.readdirSync(dir)) {
          const full = path.join(dir, file);
          if (file === "node_modules" || file === ".git" || file === ".venv") continue;
          if (fs.statSync(full).isDirectory()) recurse(full);
          else if (file.endsWith(".js") || file.endsWith(".py") || file.endsWith(".ts")) files.push(full);
        }
      }
      recurse(scanPath);

      for (const f of files) {
        const rel = path.relative(scanPath, f).replace(/\\/g, "/");
        db.prepare(`
          INSERT INTO code_nodes (id, name, node_type, filepath, created_at, updated_at)
          VALUES (?, ?, 'file', ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(rel, path.basename(rel), rel, now, now);
      }
      return { content: [{ type: "text", text: JSON.stringify({ status: "indexed", total_files: files.length }) }] };
    }

    if (name === "nexus") {
      const action = args.action;

      if (action === "perceive") {
        const state = args.workspace_state || {};
        const activeFile = state.active_file;
        const codeSnippet = state.code_snippet;
        const terminalOutput = state.terminal_output;

        let activeNodeId = null;
        if (activeFile) {
          activeNodeId = resolveActiveNode(activeFile, codeSnippet, projectId);
          db.prepare("UPDATE code_nodes SET edit_count = edit_count + 1 WHERE id = ?").run(activeNodeId);
        }

        if (activeNodeId) {
          updateHebbianTransition(lastFocusedNodeId, activeNodeId);
          lastFocusedNodeId = activeNodeId;
        }

        if (terminalOutput && (terminalOutput.includes("Error") || terminalOutput.includes("Exception") || terminalOutput.includes("failed"))) {
          await harvestErrorMusk(terminalOutput, "auto_intercept", projectId);
        }

        const gravityContext = calculateRelativisticGravity(activeNodeId, projectId);
        const resonantContext = propagateTeslaResonance(activeNodeId);
        const secretContradictions = checkContrarianSecrets(activeFile, codeSnippet, projectId);
        const dependencyAlerts = checkDependencyStewardship(activeFile);
        const healingMocks = calculateDaVinciHealing(activeNodeId);
        const hotspots = calculateRefactoringHotspots(projectId);
        const dilatedContext = getRefractoryDilation(activeNodeId, projectId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              active_node_id: activeNodeId,
              context_memories: gravityContext,
              resonance_memories: resonantContext,
              threat_warnings: secretContradictions.concat(dependencyAlerts),
              refactoring_hotspots: hotspots,
              self_healing_suggestions: healingMocks,
              dilated_context: dilatedContext
            }, null, 2)
          }]
        };
      }

      if (action === "record") {
        const data = args.memory_data || {};
        const content = data.content;
        const eventType = data.event_type || "observation";
        const linkedCodeNodes = data.linked_code_nodes || [];

        const memId = generateId(content, projectId);
        const emotional = detectEmotionalSalience(content);

        db.prepare(`
          INSERT INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?)
        `).run(memId, content, eventType, projectId, emotional.valence, emotional.arousal, emotional.salience, now, now);

        const gitInfo = getCurrentGitInfo();
        db.prepare("INSERT OR REPLACE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)")
          .run(memId, gitInfo.branch, gitInfo.commit);

        if (hasVectors) {
          const emb = await generateEmbedding(content);
          if (emb) db.prepare("INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (?, ?)").run(hexToBigInt(memId), JSON.stringify(emb));
        }

        for (const nodeId of linkedCodeNodes) {
          db.prepare("INSERT OR REPLACE INTO memory_code_links (memory_id, code_node_id, link_type) VALUES (?, ?, 'associated')").run(memId, nodeId);
        }

        return { content: [{ type: "text", text: JSON.stringify({ status: "success", memory_id: memId }) }] };
      }

      if (action === "cogitate") {
        const query = args.reasoning_query || {};
        const type = query.type;

        if (type === "decide") {
          const decisionId = generateId(query.context, "decision");
          const preMortem = `Pre-mortem check: Proposed option [${query.chosen_option}] could face regressions. Review similar code nodes before merging.`;
          db.prepare(`
            INSERT INTO decisions (id, title, context, options, chosen_option, predicted_outcome, project, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(decisionId, query.context.slice(0, 80), query.context, JSON.stringify(query.options), query.chosen_option, preMortem, projectId, now);
          return { content: [{ type: "text", text: JSON.stringify({ decision_id: decisionId, pre_mortem: preMortem, recommendation: "PROCEED_WITH_WARNINGS" }) }] };
        }

        if (type === "why") {
          const trace = db.prepare("SELECT * FROM causal_links LIMIT 5").all();
          return { content: [{ type: "text", text: JSON.stringify({ situation: query.context, causal_chain: trace }) }] };
        }

        if (type === "merge_branches") {
          const report = mergeGitBranchMemories(query.source_branch, query.target_branch, projectId);
          return { content: [{ type: "text", text: JSON.stringify({ status: "merged", report }) }] };
        }

        if (type === "self_analyze") {
          const mems = db.prepare("SELECT emotional_valence, emotional_arousal FROM episodic_memories").all();
          let avgValence = 0;
          for (const m of mems) avgValence += m.emotional_valence;
          return { content: [{ type: "text", text: JSON.stringify({ total_memories: mems.length, average_valence: mems.length ? (avgValence / mems.length) : 0 }) }] };
        }
      }

      if (action === "act") {
        const cmd = args.operational_cmd || {};
        const runCmd = cmd.command;
        const cwd = cmd.cwd || process.cwd();

        let stdout = "", stderr = "", code = 0;
        try {
          const res = execSync(runCmd, { cwd, encoding: "utf-8", stdio: "pipe" });
          stdout = res;
        } catch (err) {
          stderr = err.message + "\n" + (err.stderr || "");
          code = err.status || 1;
        }

        let harvestResult = null;
        if (code !== 0) {
          const errorLog = stderr || stdout;
          harvestResult = await harvestErrorMusk(errorLog, runCmd, projectId);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              exit_code: code,
              stdout: stdout.slice(0, 1000),
              stderr: stderr.slice(0, 1000),
              surprise_harvest: harvestResult
            }, null, 2)
          }]
        };
      }

      if (action === "dream") {
        const rep = consolidateMemories(projectId);
        const sim = runAutonomicDreamSimulation(projectId);
        const evo = evolveDatabaseSchema(projectId);
        const gly = pruneGlymphaticSubstrate(projectId);
        const torvalds = chronoPruneWorkspace(projectId);
        return { content: [{ type: "text", text: JSON.stringify({ status: "dream_cycle_completed", report: rep, simulation: sim, schema_evolution: evo, glymphatic_cleanup: gly, torvalds_chrono_pruner: torvalds }) }] };
      }
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

function generate10YearOldExplanation(node) {
  if (node.group === "file") {
    const filePath = node.id.toLowerCase();
    if (filePath.includes("test")) {
      return "🧪 <strong>The Inspector Badge</strong>: This is a tester file. It runs mock runs with fake data to make sure our main program doesn't break when we make changes.";
    }
    if (filePath.includes("database") || filePath.includes("db") || filePath.includes("schema")) {
      return "🗄️ <strong>The Digital Filing Cabinet</strong>: This manages our SQL database tables. It stores memories, errors, and habits so they are saved forever, even when the computer restarts.";
    }
    if (filePath.includes("server") || filePath.includes("mcp") || filePath.includes("handler")) {
      return "🔌 <strong>The Post Office</strong>: This is the server logic. It listens for incoming letters (API calls), reads them, and sends back the correct response.";
    }
    if (filePath.includes("vector") || filePath.includes("embedding")) {
      return "🗺️ <strong>The GPS Map of Meanings</strong>: This turns normal words into lists of numbers (vector coordinates) so we can calculate how similar two ideas are, like finding nearby cities on a map.";
    }
    if (filePath.includes("ner") || filePath.includes("entity")) {
      return "🕵️ <strong>The Word Detective</strong>: This reads your messages and extracts important names, places, and project titles automatically.";
    }
    return `📄 <strong>The Code Recipe</strong>: A javascript source file containing custom logic for the <code>${node.label}</code> component.`;
  }

  if (node.group === "function") {
    const name = node.id.split("::").pop().toLowerCase();
    if (name.includes("dream") || name.includes("consolidate")) {
      return "🌙 <strong>The Sleep Rehearsal Machine</strong>: This function runs when the computer is resting. It reviews all recorded facts, merges similar ones, deletes unimportant details, and simulates error patterns to prepare for the future.";
    }
    if (name.includes("perceive")) {
      return "👁️ <strong>The Active Focus Eye</strong>: This keeps track of what file you are currently looking at and strengthens connections between files you edit together.";
    }
    if (name.includes("harvest") || name.includes("bug") || name.includes("error")) {
      return "🚨 <strong>The Error Catcher</strong>: If a command crashes, this runs immediately to capture the stack trace and log a warning.";
    }
    if (name.includes("hebbian") || name.includes("transition")) {
      return "🔗 <strong>The Memory Glue</strong>: This strengthens connections between files. If you edit File A and File B at the same time, this glues them together so we remember they are related.";
    }
    if (name.includes("dilation") || name.includes("gravity")) {
      return "🔬 <strong>The Context Shrink Ray</strong>: To save memory and token costs, this shrinks far-away files into tiny summaries while expanding the file you are actively working on.";
    }
    if (name.includes("remember") || name.includes("recall")) {
      return "📥 <strong>The File Cabinet Drawer</strong>: This lets us slide a new memory into the drawer or search the drawer for matching files.";
    }
    return `⚙️ <strong>A Small Sub-Assembly Machine</strong>: A function named <code>${name}</code> designed to perform a specific job in the system.`;
  }

  if (node.group === "error" || node.group === "bug") {
    return "💥 <strong>The Crash Site</strong>: An error log saved when a command failed. It shows exactly which line broke and why.";
  }
  if (node.group === "decision") {
    return "⚖️ <strong>The Choice Book</strong>: A record of a decision we made. We predicted the outcome to help us make better decisions next time.";
  }
  if (node.group === "observation") {
    return "📝 <strong>The Diary Page</strong>: A simple observation or note recorded during a coding session.";
  }
  if (node.group === "insight" || node.group === "learning") {
    return "💡 <strong>Lightbulb Moment</strong>: An insight or learning experience recorded when a task was resolved successfully.";
  }
  if (node.group === "semantic") {
    return "🏷️ <strong>The Concept Tag</strong>: A general fact or concept extracted from multiple observations.";
  }
  if (node.group === "procedural") {
    return "🛹 <strong>The Skill Card</strong>: A procedural step-by-step tutorial learned by the system.";
  }
  if (node.group === "somatic") {
    return "❤️ <strong>Emotional Resonance</strong>: A record of how we 'feel' about a file or folder based on whether it causes bugs (bad feelings) or success (good feelings).";
  }

  return "🧠 <strong>Cognitive Memory Unit</strong>: A unit of information stored in the OWL neuromorphic substrate.";
}

async function getGraphData() {
  const nodes = [];
  const edges = [];

  const epMems = db.prepare("SELECT * FROM episodic_memories WHERE is_active = 1").all();
  for (const m of epMems) {
    nodes.push({
      id: m.id,
      label: m.content.slice(0, 60),
      group: m.event_type || "observation",
      size: Math.max(8, (m.strength || 0.5) * 15),
      raw: { content: m.content, event_type: m.event_type, strength: m.strength, salience: m.salience, emotional_valence: m.emotional_valence }
    });
  }

  const semMems = db.prepare("SELECT * FROM semantic_memories WHERE is_active = 1").all();
  for (const m of semMems) {
    nodes.push({
      id: m.id,
      label: m.content.slice(0, 60),
      group: "semantic",
      size: Math.max(8, (m.importance || 0.5) * 15),
      raw: { content: m.content, concept_type: m.concept_type, importance: m.importance, confidence: m.confidence }
    });
  }

  const procMems = db.prepare("SELECT * FROM procedural_memories WHERE is_active = 1").all();
  for (const m of procMems) {
    nodes.push({
      id: m.id,
      label: m.title,
      group: "procedural",
      size: 12,
      raw: { content: m.content, title: m.title }
    });
  }

  const somMems = db.prepare("SELECT * FROM somatic_memories WHERE is_active = 1").all();
  for (const m of somMems) {
    nodes.push({
      id: m.id,
      label: `Somatic: ${m.entity_name}`,
      group: "somatic",
      size: Math.max(8, (m.somatic_weight || 0.5) * 15),
      raw: { entity_name: m.entity_name, entity_type: m.entity_type, somatic_valence: m.somatic_valence, somatic_weight: m.somatic_weight }
    });
  }

  const codeNodes = db.prepare(`
    SELECT cn.*, COALESCE(cna.activation, 0.0) as activation 
    FROM code_nodes cn
    LEFT JOIN code_node_activation cna ON cna.node_id = cn.id
  `).all();
  for (const n of codeNodes) {
    nodes.push({
      id: n.id,
      label: n.name,
      group: n.node_type || "file",
      size: Math.max(10, (n.edit_count || 0) * 1.5 + (n.bug_count || 0) * 3),
      raw: { content: n.content, filepath: n.filepath, edit_count: n.edit_count, bug_count: n.bug_count, activation: n.activation }
    });
  }

  const bugs = db.prepare("SELECT * FROM code_bugs WHERE is_active = 1").all();
  for (const b of bugs) {
    nodes.push({
      id: b.id,
      label: `Bug: ${b.bug_type}`,
      group: "bug",
      size: 12,
      raw: { bug_type: b.bug_type, description: b.description, file_path: b.file_path, line_number: b.line_number }
    });
  }

  const decs = db.prepare("SELECT * FROM decisions").all();
  for (const d of decs) {
    nodes.push({
      id: d.id,
      label: d.title || `Decision: ${d.id}`,
      group: "decision",
      size: 12,
      raw: { context: d.context, chosen_option: d.chosen_option, predicted_outcome: d.predicted_outcome }
    });
  }

  const threats = db.prepare("SELECT * FROM threat_patterns WHERE is_active = 1").all();
  for (const t of threats) {
    nodes.push({
      id: `threat_${t.id}`,
      label: t.pattern_name,
      group: "error",
      size: 14,
      raw: { description: t.description, severity: t.severity }
    });
  }

  for (const node of nodes) {
    node.simple_explanation = generate10YearOldExplanation(node);
  }

  const nodeIds = new Set(nodes.map(n => n.id));

  const codeEdges = db.prepare("SELECT * FROM code_edges").all();
  for (const e of codeEdges) {
    edges.push({ source: e.source_id, target: e.target_id, type: e.edge_type || "calls" });
  }

  const memLinks = db.prepare("SELECT * FROM memory_code_links").all();
  for (const l of memLinks) {
    edges.push({ source: l.memory_id, target: l.code_node_id, type: l.link_type || "associated" });
  }

  const synWeights = db.prepare("SELECT * FROM synaptic_weights").all();
  for (const w of synWeights) {
    edges.push({ source: w.source_id, target: w.target_id, type: "synaptic", weight: w.attention_weight });
  }

  const causalLinks = db.prepare("SELECT * FROM causal_links").all();
  for (const c of causalLinks) {
    edges.push({ source: c.cause_id, target: c.effect_id, type: c.link_type || "causes" });
  }

  const cleanEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  return { nodes, edges: cleanEdges };
}

server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph v5", description: "V5 memory nodes and call links", mimeType: "application/json" },
  { uri: "owl-memory://graph-ui", name: "Memory Graph UI", description: "Interactive force-directed graph visualization with 10-year-old explanations", mimeType: "text/html" }
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const data = await getGraphData();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "owl-memory://graph-ui") {
    const data = await getGraphData();
    const templatePath = path.join(__dirname, "graph-ui-preview.html");
    let html = "";
    if (fs.existsSync(templatePath)) {
      html = fs.readFileSync(templatePath, "utf-8");
      html = html.replace(
        /const INLINED_GRAPH_DATA = [\s\S]*?;/,
        `const INLINED_GRAPH_DATA = ${JSON.stringify(data)};`
      );
    } else {
      html = `<html><body style="background:#05050d;color:#ef4444;font-family:sans-serif;padding:20px;"><h3>Error: graph-ui-preview.html template file not found on disk</h3></body></html>`;
    }
    return { contents: [{ uri, mimeType: "text/html", text: html }] };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  warmupNER();
  console.error(`OWL Memory MCP v5.0 — UNS Engine running on stdio`);

  try {
    const daemonPath = path.join(__dirname, "owl_daemon.js");
    const { spawn } = require("child_process");
    const child = spawn("node", [daemonPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, OWL_MEMORY_DB: DB_PATH }
    });
    child.unref();
    console.error(`[OWL SERVER] Spawned background daemon`);
  } catch (e) {
    console.error(`[OWL SERVER] Failed to spawn background daemon: ${e.message}`);
  }
}

main().catch(console.error);
