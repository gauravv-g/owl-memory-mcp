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

// ─── Vector Embeddings & NER ────────────────────────────────────────────────
let sqliteVecLoaded = false;
let embedder = null;
let embedderLoading = null;
let hasVectors = false;
let nerModel = null;
let nerLoading = null;
let hasNER = false;

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

// ─── Configuration & Database ───────────────────────────────────────────────
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

// ─── Unified SQLite Schema ──────────────────────────────────────────────────
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
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── 1. ALBERT EINSTEIN: RELATIVISTIC CODE SPACE-TIME (Gravity) ─────────────
function calculateRelativisticGravity(activeNodeId, projectId) {
  const memories = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
  const ranked = [];
  const now = Date.now();

  for (const mem of memories) {
    // Spatial call-graph distance
    let minDistance = 4; // Max fallback
    if (activeNodeId) {
      const links = db.prepare("SELECT code_node_id FROM memory_code_links WHERE memory_id = ?").all(mem.id);
      for (const link of links) {
        if (link.code_node_id === activeNodeId) { minDistance = 0; break; }
        const dist = getCodePathDistance(activeNodeId, link.code_node_id);
        if (dist < minDistance) minDistance = dist;
      }
    }

    const ageHours = (now - new Date(mem.created_at).getTime()) / (3600 * 1000);
    const emotionalWeight = 1.0 + Math.abs(mem.emotional_valence) * 0.5 + mem.emotional_arousal * 0.5;
    const gravity = (mem.salience * emotionalWeight) / (Math.pow(minDistance + 1, 2) * Math.pow(ageHours + 1, 0.15));

    ranked.push({
      id: mem.id,
      content: mem.content,
      event_type: mem.event_type,
      gravity: Math.round(gravity * 1000) / 1000,
      spatial_distance: minDistance,
      created_at: mem.created_at
    });
  }
  return ranked.sort((a, b) => b.gravity - a.gravity).slice(0, 10);
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

// ─── 2. NIKOLA TESLA: SYNAPTIC GRAPH RESONANCE (Energy Wave) ────────────────
function propagateTeslaResonance(activeNodeId, energy = 10.0, decayFactor = 0.1, threshold = 1.0) {
  if (!activeNodeId) return [];
  const queue = [[activeNodeId, energy, 0]];
  const activationMap = new Map();
  const visited = new Set();
  const nowTime = Date.now();

  while (queue.length > 0) {
    const [curr, currEnergy, depth] = queue.shift();
    if (visited.has(curr) || currEnergy < threshold) continue;
    visited.add(curr);
    
    const currentAct = activationMap.get(curr) || 0;
    activationMap.set(curr, currentAct + currEnergy);

    db.prepare(`
      INSERT INTO code_node_activation (node_id, activation, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET activation = excluded.activation, last_updated = excluded.last_updated
    `).run(curr, currentAct + currEnergy, nowTime);

    // Propagate wave to linked functions/files
    const edges = db.prepare("SELECT target_id, weight FROM code_edges WHERE source_id = ?").all(curr);
    for (const edge of edges) {
      const nextEnergy = currEnergy * (1.0 - decayFactor) * (edge.weight || 1.0);
      if (!visited.has(edge.target_id) && nextEnergy >= threshold) {
        queue.push([edge.target_id, nextEnergy, depth + 1]);
      }
    }
  }

  // Find memories associated with active nodes
  const resonanceMemories = [];
  for (const [nodeId, act] of activationMap) {
    const links = db.prepare("SELECT memory_id FROM memory_code_links WHERE code_node_id = ?").all(nodeId);
    for (const l of links) {
      const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ? AND is_active = 1").get(l.memory_id);
      if (mem) {
        resonanceMemories.push({
          id: mem.id,
          content: mem.content,
          activation: act,
          node_id: nodeId
        });
      }
    }
  }
  return resonanceMemories.sort((a, b) => b.activation - a.activation);
}

// ─── 3. ELON MUSK: SURPRISE-GATED ERROR HARVESTER (ACh Gated plastic writes) 
async function harvestErrorMusk(errorMessage, command = "test", projectId = "default") {
  // Simple stack trace parser
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

  // Compute surprise: base failure probability on branch history
  const gitInfo = getCurrentGitInfo();
  const branchFailCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM episodic_memories em
    JOIN memory_git_branches mgb ON mgb.memory_id = em.id
    WHERE mgb.branch_name = ? AND em.event_type = 'error'
  `).get(gitInfo.branch)?.cnt || 0;
  
  const surpriseScore = branchFailCount === 0 ? 1.0 : Math.max(0.1, 1 / (branchFailCount + 1));

  // Surprise spikes open write gates
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

  // Auto register bug log
  db.prepare("INSERT OR IGNORE INTO code_bugs (id, bug_type, description, file_path, line_number, project, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(generateId(errorMessage, "bug"), "runtime_error", errorMessage.slice(0, 200), filepath, lineNumber, projectId, now);

  return { status: "success", memory_id: memId, codeNodeId, surpriseScore };
}

// ─── 4. PETER THIEL: INVARIANT CODE SECRETS (Comment vs History Contradictions) 
function checkContrarianSecrets(activeFile, codeSnippet) {
  if (!activeFile) return [];
  const relPath = activeFile.replace(/\\/g, "/");
  const textToScan = codeSnippet || "";
  const assertions = [];
  const lines = textToScan.split("\n");

  for (const line of lines) {
    if (line.includes("//") || line.includes("#")) {
      const comment = line.slice(Math.max(line.indexOf("//"), line.indexOf("#"))).toLowerCase();
      if (comment.includes("thread-safe") || comment.includes("thread safe")) assertions.push({ type: "thread_safety", text: line.trim() });
      if (comment.includes("validated") || comment.includes("never throws")) assertions.push({ type: "stability", text: line.trim() });
      if (comment.includes("fast") || comment.includes("constant time")) assertions.push({ type: "performance", text: line.trim() });
    }
  }

  const secrets = [];
  for (const ass of assertions) {
    const historicalFailures = db.prepare(`
      SELECT em.content, em.created_at FROM episodic_memories em
      JOIN memory_code_links mcl ON mcl.memory_id = em.id
      WHERE mcl.code_node_id LIKE ? AND em.event_type = 'error'
    `).all(`%${relPath}%`);

    for (const fail of historicalFailures) {
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

// ─── 5. NAVAL RAVIKANT: LEVERAGED STRUCTURAL ROI (Edit/Bug Hotspots) ─────────
function calculateRefactoringHotspots(projectId) {
  // Naval Leverage Score = Bug Count / (Edit Count + 1) -> indicates high volatility and risk
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

// ─── 6. RATAN TATA: VENDOR STEWARDSHIP LEDGER (Dependency Health) ────────────
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
      if (status !== "stable") {
        alerts.push({
          package: steward.package_name,
          error_count: steward.error_count,
          use_count: steward.use_count,
          crash_rate: Math.round(crashRate * 100) + "%",
          status: status,
          message: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`,
          warning: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`
        });
      }
    }
  }
  return alerts;
}

// ─── 7. LEONARDO DA VINCI: ANATOMICAL SELF-HEALING CALL PATHS ───────────────
function calculateDaVinciHealing(activeNodeId) {
  if (!activeNodeId) return null;
  // Get downstream calls from this node
  const callees = db.prepare("SELECT target_id, edge_type FROM code_edges WHERE source_id = ?").all(activeNodeId);
  const recommendations = [];

  for (const callee of callees) {
    // Check if this node has known bug logs
    const bug = db.prepare("SELECT * FROM code_bugs WHERE file_path LIKE ? AND is_active = 1").get(`%${callee.target_id}%`);
    if (bug) {
      // Trace alternative paths (Self-Healing rerouting)
      const siblingNodes = db.prepare(`
        SELECT DISTINCT ce.target_id FROM code_edges ce
        WHERE ce.source_id = ? AND ce.target_id != ?
      `).all(activeNodeId, callee.target_id);

      // Classify path type anatomically
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

// ─── 8. LINUS TORVALDS: GIT-NATIVE SEMANTIC MERGING ─────────────────────────
function mergeGitBranchMemories(sourceBranch, targetBranch, projectId = "default") {
  const sourceMems = db.prepare(`
    SELECT em.* FROM episodic_memories em
    JOIN memory_git_branches mgb ON mgb.memory_id = em.id
    WHERE mgb.branch_name = ? AND em.project = ?
  `).all(sourceBranch, projectId);

  let mergedCount = 0;
  let contradictionCount = 0;

  for (const sm of sourceMems) {
    // Check if this memory contradicts target branch memories
    const targets = db.prepare(`
      SELECT em.* FROM episodic_memories em
      JOIN memory_git_branches mgb ON mgb.memory_id = em.id
      WHERE mgb.branch_name = ? AND em.project = ? AND em.is_active = 1
    `).all(targetBranch, projectId);

    let isConflict = false;
    for (const tm of targets) {
      const sim = calculateSimilarity(sm.content, tm.content);
      if (sim > 0.4) {
        // If one contains a negative assertion and other doesn't
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
      // Copy memory context to target branch
      db.prepare("INSERT OR IGNORE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)")
        .run(sm.id, targetBranch, "merged");
      mergedCount++;
    }
  }

  return { mergedCount, contradictionCount };
}

// ─── Consolidation (Dream Cycle) ─────────────────────────────────────────────
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

// ─── MCP Server Setup ────────────────────────────────────────────────────────
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
      // Register files dynamically
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

    // ═══ NEXUS COGNITIVE ENGINE ═══
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

        // Intercept compile/build error immediately
        if (terminalOutput && (terminalOutput.includes("Error") || terminalOutput.includes("Exception") || terminalOutput.includes("failed"))) {
          await harvestErrorMusk(terminalOutput, "auto_intercept", projectId);
        }

        const gravityContext = calculateRelativisticGravity(activeNodeId, projectId);
        const resonantContext = propagateTeslaResonance(activeNodeId);
        const secretContradictions = checkContrarianSecrets(activeFile, codeSnippet);
        const dependencyAlerts = checkDependencyStewardship(activeFile);
        const healingMocks = calculateDaVinciHealing(activeNodeId);
        const hotspots = calculateRefactoringHotspots(projectId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              active_node_id: activeNodeId,
              context_memories: gravityContext,
              resonance_memories: resonantContext,
              threat_warnings: secretContradictions.concat(dependencyAlerts),
              refactoring_hotspots: hotspots,
              self_healing_suggestions: healingMocks
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

        // If command failed, automatically harvest errors and learn (Elon Musk)
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
        return { content: [{ type: "text", text: JSON.stringify({ status: "dream_cycle_completed", report: rep }) }] };
      }
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Resources ──────────────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph v5", description: "V5 memory nodes and call links", mimeType: "application/json" }
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const mems = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE is_active = 1").all();
    const nodes = db.prepare("SELECT id, name, node_type FROM code_nodes").all();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ memories: mems, code_nodes: nodes }) }] };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  warmupNER();
  console.error(`OWL Memory MCP v5.0 — UNS Engine running on stdio`);
}

main().catch(console.error);
