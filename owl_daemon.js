/**
 * OWL Autonomic Daemon v1.0
 * 
 * "A 24/7 background process that monitors codebase saves, validates syntax,
 * calculates Hebbian attention pathways, and triggers native Windows notifications."
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { exec, execSync } = require("child_process");
const crypto = require("crypto");

const WORKSPACE_DIR = process.cwd();
const DB_PATH = process.env.OWL_MEMORY_DB || path.join(require("os").homedir(), ".owl-memory", "memory-v5.db");

// ─── Initialize Database ────────────────────────────────────────────────────
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const pidFile = path.join(DATA_DIR, "daemon.pid");
if (fs.existsSync(pidFile)) {
  try {
    const oldPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    process.kill(oldPid, 0);
    console.log(`[OWL DAEMON] Daemon already running with PID: ${oldPid}. Exiting.`);
    process.exit(0);
  } catch (err) {
    // Process not found or dead, ignore
  }
}
fs.writeFileSync(pidFile, process.pid.toString(), "utf-8");

process.on("exit", () => {
  try {
    if (fs.existsSync(pidFile)) {
      const currentPid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
      if (currentPid === process.pid) fs.unlinkSync(pidFile);
    }
  } catch (e) {}
});

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

console.log(`[OWL DAEMON] Watching workspace: ${WORKSPACE_DIR}`);
console.log(`[OWL DAEMON] Connected to DB: ${DB_PATH}`);

// State variables
let lastSavedFileId = null;
let lastSaveTime = 0;
const debounceMap = new Map();
let idleTimer = null;

// ─── Helpers ────────────────────────────────────────────────────────────────
function generateId(content, salt = "") {
  return crypto.createHash("sha256").update(content + salt + Date.now().toString()).digest("hex").slice(0, 16);
}

function triggerWindowsNotification(title, text) {
  // Use PowerShell to load System.Windows.Forms and display a native balloon notification
  const cleanTitle = title.replace(/'/g, "''").replace(/"/g, '`"');
  const cleanText = text.replace(/'/g, "''").replace(/"/g, '`"');
  const psCmd = `powershell -Command "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $obj = New-Object System.Windows.Forms.NotifyIcon; $obj.Icon = [System.Drawing.SystemIcons]::Warning; $obj.BalloonTipText = '${cleanText}'; $obj.BalloonTipTitle = '${cleanTitle}'; $obj.Visible = $true; $obj.ShowBalloonTip(10000)"`;
  exec(psCmd, (err) => {
    if (err) console.error("[OWL DAEMON] Failed to trigger notification:", err.message);
  });
}

function updateHebbianTransition(fromNode, toNode) {
  if (!fromNode || !toNode || fromNode === toNode) return;
  const now = new Date().toISOString();
  const row = db.prepare("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?").get(fromNode, toNode);
  if (row) {
    const w = row.attention_weight;
    const nextW = w + 0.15 * (1.0 - w);
    db.prepare("UPDATE synaptic_weights SET attention_weight = ?, co_occurrences = co_occurrences + 1, last_transition = ? WHERE source_id = ? AND target_id = ?")
      .run(nextW, now, fromNode, toNode);
    console.log(`[OWL DAEMON] Strengthened Hebbian transition: ${fromNode} -> ${toNode} (weight: ${nextW.toFixed(2)})`);
  } else {
    db.prepare("INSERT INTO synaptic_weights (source_id, target_id, attention_weight, co_occurrences, last_transition) VALUES (?, ?, 0.15, 1, ?)")
      .run(fromNode, toNode, now);
    console.log(`[OWL DAEMON] Created Hebbian transition: ${fromNode} -> ${toNode}`);
  }
}

// ─── Refractory Context Dilation & Prompt Deck Helpers ───────────────────────
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

function generate10YearOldExplanation(node) {
  const isFile = node.node_type === "file";
  if (isFile) {
    const filePath = node.node_id.toLowerCase();
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
    return `📄 <strong>The Code Recipe</strong>: A javascript source file containing custom logic for the <code>${path.basename(node.node_id)}</code> component.`;
  }
  return "🧠 <strong>Cognitive Memory Unit</strong>: A unit of information stored in the OWL neuromorphic substrate.";
}

function getRefractoryDilation(activeNodeId) {
  if (!activeNodeId) return [];
  const nodes = db.prepare("SELECT * FROM code_nodes").all();
  const dilated = [];
  
  for (const node of nodes) {
    let state = "gas";
    let gravity = 0;
    
    if (node.id === activeNodeId) {
      state = "solid";
      gravity = 1.0;
    } else {
      const dist = getCodePathDistance(activeNodeId, node.id);
      const hebb = db.prepare("SELECT attention_weight FROM synaptic_weights WHERE source_id = ? AND target_id = ?").get(activeNodeId, node.id);
      const weight = hebb ? hebb.attention_weight : 0.0;
      
      const gravityVal = (weight * 0.5) + (1.0 / (dist + 1) * 0.5);
      gravity = Math.round(gravityVal * 100) / 100;
      
      if (dist <= 1 || weight > 0.4) {
        state = "liquid";
      }
    }
    
    let representation = "";
    if (state === "solid") {
      try {
        representation = fs.readFileSync(path.join(WORKSPACE_DIR, node.filepath), "utf-8");
      } catch (e) {
        representation = node.content || `// File content of ${node.id} is solid context.`;
      }
    } else if (state === "liquid") {
      let content = node.content;
      if (!content) {
        try { content = fs.readFileSync(path.join(WORKSPACE_DIR, node.filepath), "utf-8"); } catch (e) {}
      }
      const clean = (content || "").split("\n").filter(line => {
        const l = line.trim();
        return l.startsWith("import") || l.startsWith("const ") || l.startsWith("require") || l.startsWith("function") || l.startsWith("class") || l.startsWith("export");
      }).slice(0, 15).join("\n");
      representation = `// File Outline: ${node.id}\n${clean || "(Outline empty)"}`;
    } else {
      representation = `// Concept: ${node.id} (${node.node_type})`;
    }
    
    dilated.push({
      node_id: node.id,
      state,
      gravity,
      representation,
      node_type: node.node_type
    });
  }
  return dilated.sort((a, b) => b.gravity - a.gravity).slice(0, 15);
}

function writeContextDeck(activeNodeId) {
  try {
    const dilated = getRefractoryDilation(activeNodeId);
    const now = new Date().toISOString();
    let md = `# OWL Memory Substrate Context Deck\n\n`;
    md += `*Last Updated: ${now}*\n`;
    md += `*Active Focus: \`${activeNodeId}\`*\n\n`;
    md += `> [!NOTE]\n`;
    md += `> This is a self-updating dilated prompt context deck generated in real-time by the OWL background daemon.\n\n`;

    // 1. Solid Nodes
    md += `## 🔴 Solid Context (Active Files & Functions)\n\n`;
    const solids = dilated.filter(n => n.state === "solid");
    for (const s of solids) {
      md += `### File: \`${s.node_id}\`\n`;
      const ext = path.extname(s.node_id).slice(1) || "javascript";
      md += `\`\`\`${ext}\n${s.representation}\n\`\`\`\n\n`;
    }

    // 2. Liquid Nodes
    md += `## 🟡 Liquid Context (Import and Call path outlines)\n\n`;
    const liquids = dilated.filter(n => n.state === "liquid");
    if (liquids.length > 0) {
      md += `\`\`\`javascript\n`;
      for (const l of liquids) {
        md += `${l.representation}\n\n`;
      }
      md += `\`\`\`\n\n`;
    } else {
      md += `*No liquid call path outlines loaded.*\n\n`;
    }

    // 3. Gas Context
    md += `## 🔵 Gas Context (General Codebase Directory)\n\n`;
    const gases = dilated.filter(n => n.state === "gas");
    if (gases.length > 0) {
      for (const g of gases) {
        const analogy = generate10YearOldExplanation(g);
        md += `- **\`${g.node_id}\`** (${g.node_type}) — Gravity: ${g.gravity}\n`;
        md += `  *Analogy*: ${analogy}\n`;
      }
    } else {
      md += `*No gas nodes registered.*\n`;
    }

    const deckPath = path.join(WORKSPACE_DIR, ".owl_context.md");
    fs.writeFileSync(deckPath, md, "utf-8");
    console.log(`[OWL DAEMON] Wrote context deck to ${deckPath}`);
  } catch (err) {
    console.error("[OWL DAEMON] Failed to write context deck:", err.message);
  }
}

// ─── File Validation & Processing ───────────────────────────────────────────
function handleFileChange(filePath) {
  const relPath = path.relative(WORKSPACE_DIR, filePath).replace(/\\/g, "/");
  const ext = path.extname(filePath);
  const now = new Date().toISOString();

  // 1. AST/Node registration
  db.prepare(`
    INSERT INTO code_nodes (id, name, node_type, filepath, created_at, updated_at)
    VALUES (?, ?, 'file', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(relPath, path.basename(relPath), relPath, now, now);

  db.prepare("UPDATE code_nodes SET edit_count = edit_count + 1 WHERE id = ?").run(relPath);

  // Hebbian sequence tracking
  const currentTime = Date.now();
  if (lastSavedFileId && (currentTime - lastSaveTime < 15000)) {
    updateHebbianTransition(lastSavedFileId, relPath);
    // ═══ Nerve Bridge: signal rapid co-edit (Hebbian spike) ═══
    try {
      db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
        .run(
          "hebbian_spike",
          JSON.stringify({ from: lastSavedFileId, to: relPath, gap_ms: currentTime - lastSaveTime }),
          new Date().toISOString()
        );
    } catch(e) {}
  }
  lastSavedFileId = relPath;
  lastSaveTime = currentTime;

  // 2. Syntax Validation
  let isValid = true;
  let syntaxError = "";

  if (ext === ".js") {
    try {
      execSync(`node -c "${filePath}"`, { stdio: "ignore" });
    } catch (err) {
      isValid = false;
      syntaxError = err.message || "JavaScript syntax error detected.";
    }
  } else if (ext === ".py") {
    try {
      execSync(`python -m py_compile "${filePath}"`, { stdio: "ignore" });
    } catch (err) {
      isValid = false;
      syntaxError = err.message || "Python syntax error detected.";
    }
  }

  // 3. Database Sync & OS Notification
  if (!isValid) {
    console.log(`[OWL DAEMON] Syntax failure in ${relPath}: ${syntaxError}`);
    
    // Look up past bug resolutions for matching error patterns
    let suggestion = "Check for missing semicolons, brackets, or typos in recent edits.";
    try {
      const pastBugs = db.prepare("SELECT description, resolution FROM code_bugs WHERE bug_type = 'syntax_error' AND resolution IS NOT NULL AND resolution != ''").all();
      for (const pb of pastBugs) {
        const w1 = new Set(syntaxError.toLowerCase().split(/\W+/));
        const w2 = new Set(pb.description.toLowerCase().split(/\W+/));
        const inter = new Set([...w1].filter(x => w2.has(x)));
        const union = new Set([...w1, ...w2]);
        const sim = inter.size / union.size;
        if (sim > 0.5) {
          suggestion = `💡 **Suggested Fix from Past Resolved Bug**: ${pb.resolution}`;
          break;
        }
      }
    } catch (e) {}

    // Log bug node
    const bugId = generateId(syntaxError, "daemon_bug");
    db.prepare(`
      INSERT OR IGNORE INTO code_bugs (id, bug_type, description, file_path, line_number, project, created_at, resolution)
      VALUES (?, 'syntax_error', ?, ?, 0, 'default', ?, ?)
    `).run(bugId, syntaxError.slice(0, 300), relPath, now, suggestion);

    db.prepare("UPDATE code_nodes SET bug_count = bug_count + 1 WHERE id = ?").run(relPath);

    // ═══ Nerve Bridge: signal the MCP server about this syntax error ═══
    try {
      db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
        .run(
          "syntax_error_detected",
          JSON.stringify({ file: relPath, error: syntaxError.slice(0, 200), suggestion: suggestion.slice(0, 150) }),
          now
        );
    } catch(e) {}

    // Trigger Desktop notification
    triggerWindowsNotification("OWL Alert: Code broken!", `Syntax issue in ${path.basename(relPath)}. View suggestion card in Graph UI.`);
  } else {
    // If it was broken and is now fixed, resolve the bugs
    const row = db.prepare("SELECT COUNT(*) as cnt FROM code_bugs WHERE file_path = ? AND is_active = 1").get(relPath);
    if (row && row.cnt > 0) {
      db.prepare("UPDATE code_bugs SET is_active = 0, resolution = 'Resolved by save validation' WHERE file_path = ?").run(relPath);
      console.log(`[OWL DAEMON] Resolved active bugs for ${relPath}`);
      // ═══ Nerve Bridge: signal fix ═══
      try {
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
          .run("syntax_resolved", JSON.stringify({ file: relPath }), now);
      } catch(e) {}
      triggerWindowsNotification("OWL Info: Code Resolved", `${path.basename(relPath)} compiles successfully now.`);
    }
    
    // Update node content in db
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      db.prepare("UPDATE code_nodes SET content = ?, updated_at = ? WHERE id = ?").run(content, now, relPath);
    } catch (e) {}
  }

  // 4. Generate Live Prompt Context Deck
  writeContextDeck(relPath);

  // 5. Innovation B: Write Predictive Cache for next resurrect call
  writePredictiveCache(relPath, "default");

  // Reset idle timer
  resetIdleTimer();
}

// ─── Idle Dream Cycle ────────────────────────────────────────────────────────
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log("[OWL DAEMON] Workspace idle for 5 minutes. Triggering consolidation dream cycle...");
    try {
      // Connect to server or execute dream cycle logic locally
      // Local dream mock / trigger:
      const now = new Date().toISOString();
      const active = db.prepare("SELECT id, content, strength FROM episodic_memories WHERE is_active = 1").all();
      let processed = 0, merged = 0;
      const processedIds = new Set();
      for (let i = 0; i < active.length; i++) {
        const m1 = active[i]; if (processedIds.has(m1.id)) continue;
        for (let j = i + 1; j < active.length; j++) {
          const m2 = active[j]; if (processedIds.has(m2.id)) continue;
          // Simple Jaccard similarity
          const w1 = new Set(m1.content.toLowerCase().split(/\W+/));
          const w2 = new Set(m2.content.toLowerCase().split(/\W+/));
          const inter = new Set([...w1].filter(x => w2.has(x)));
          const union = new Set([...w1, ...w2]);
          const sim = inter.size / union.size;
          if (sim > 0.75) {
            db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(m2.id);
            db.prepare("UPDATE episodic_memories SET strength = strength + 0.3 WHERE id = ?").run(m1.id);
            processedIds.add(m2.id); merged++;
          }
        }
        processed++;
      }
      db.prepare("INSERT INTO consolidation_log (started_at, completed_at, memories_processed, memories_merged, memories_pruned, status) VALUES (?, ?, ?, ?, 0, 'completed')")
        .run(now, now, processed, merged);
      
      const evo = evolveDatabaseSchema("default");
      const gly = pruneGlymphaticSubstrate("default");
      console.log(`[OWL DAEMON] Dream cycle completed: merged ${merged} memories. Schema evolution: ${JSON.stringify(evo)}. Glymphatic: ${JSON.stringify(gly)}`);
      
      const evolvedCount = evo.evolutions_count || 0;
      const prunedCount = (gly.pruned_synapses || 0) + (gly.pruned_bugs || 0);

      // ═══ Nerve Bridge: signal dream completion and glymphatic results ═══
      try {
        const sigNow = new Date().toISOString();
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
          .run(
            "idle_consolidation_complete",
            JSON.stringify({ merged, evolved: evolvedCount, pruned: prunedCount }),
            sigNow
          );
      } catch(e) {}

      triggerWindowsNotification("OWL Substrate", `Dream cycle finished. Merged: ${merged}, Evolved: ${evolvedCount}, Pruned: ${prunedCount}. Database compacted.`);
    } catch (err) {
      console.error("[OWL DAEMON] Dream cycle failed:", err.message);
    }
    resetIdleTimer();
  }, 5 * 60 * 1000); // 5 minutes
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
      console.log(`[OWL DAEMON] Evolving schema: adding column [${key}] to episodic_memories`);
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
    console.error(`[OWL DAEMON] Schema evolution failed: ${err.message}`);
    return { status: "failed", error: err.message };
  }
}

function pruneGlymphaticSubstrate(projectId) {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  
  try {
    console.log(`[OWL DAEMON] Executing Sleep-State Glymphatic Cleanup...`);
    
    // 1. Prune weak synaptic weights (weight < 0.12, inactive for 24 hours)
    const synRes = db.prepare(`
      DELETE FROM synaptic_weights 
      WHERE attention_weight < 0.12 
        AND last_transition < ?
    `).run(yesterday);

    // 2. Prune old resolved bugs (inactive for 48 hours)
    const bugRes = db.prepare(`
      DELETE FROM code_bugs 
      WHERE is_active = 0 
        AND created_at < ?
    `).run(twoDaysAgo);

    // 3. Compact database using VACUUM
    db.exec("VACUUM");

    console.log(`[OWL DAEMON] Glymphatic cleanup complete. Pruned ${synRes.changes} synapses and ${bugRes.changes} bugs.`);
    return {
      status: "completed",
      pruned_synapses: synRes.changes,
      pruned_bugs: bugRes.changes
    };
  } catch (err) {
    console.error(`[OWL DAEMON] Glymphatic cleanup failed: ${err.message}`);
    return { status: "failed", error: err.message };
  }
}

// ─── Innovation B: Predictive Sensorium — Write Predictive Cache on File Save ─
function writePredictiveCache(relPath, projectId) {
  try {
    // 1. Identify the project (use default if not resolvable)
    const project = projectId || "default";

    // 2. Query recent episodic memories linked to this file via memory_code_links
    let linkedMemories = [];
    try {
      const links = db.prepare(`
        SELECT em.id, em.content, em.event_type, em.strength
        FROM episodic_memories em
        JOIN memory_code_links mcl ON mcl.memory_id = em.id
        WHERE mcl.code_node_id = ? AND em.is_active = 1
        ORDER BY em.created_at DESC LIMIT 5
      `).all(relPath);
      linkedMemories = links.map(m => ({
        id: m.id,
        content: m.content.slice(0, 200),
        event_type: m.event_type,
        strength: m.strength
      }));
    } catch (e) {}

    // 3. Query the last error for this project
    let lastError = null;
    try {
      const errMem = db.prepare(`
        SELECT content FROM episodic_memories
        WHERE project = ? AND event_type = 'error' AND is_active = 1
        ORDER BY created_at DESC LIMIT 1
      `).get(project);
      if (errMem) lastError = errMem.content.slice(0, 300);
    } catch (e) {}

    // 4. Query pending decisions for this project
    let pendingDecisions = [];
    try {
      const decs = db.prepare(`
        SELECT title, context FROM decisions
        WHERE project = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 3
      `).all(project);
      pendingDecisions = decs.map(d => ({ title: d.title, context: d.context ? d.context.slice(0, 150) : null }));
    } catch (e) {}

    // 5. Build the predicted contexts summary
    const predictedContexts = [];
    if (lastError) {
      predictedContexts.push({ type: "last_error", value: lastError });
    }
    for (const d of pendingDecisions) {
      predictedContexts.push({ type: "pending_decision", value: d.title });
    }
    if (linkedMemories.length > 0) {
      predictedContexts.push({ type: "linked_memories_count", value: linkedMemories.length });
    }

    // 6. Write the predictive_cache record with 10-minute TTL
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Expire old unconsumed cache for this project first
    try {
      db.prepare("UPDATE predictive_cache SET consumed = 1 WHERE project = ? AND consumed = 0").run(project);
    } catch (e) {}

    db.prepare(`
      INSERT INTO predictive_cache
        (project, trigger_file, predicted_contexts, pre_retrieved_memories, confidence, created_at, expires_at, consumed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      project,
      relPath,
      JSON.stringify(predictedContexts),
      JSON.stringify(linkedMemories),
      linkedMemories.length > 0 ? 0.8 : 0.4,
      now,
      expiresAt
    );

    console.log(`[OWL DAEMON] Predictive cache written for ${relPath} (${linkedMemories.length} memories pre-loaded, expires ${expiresAt})`);
  } catch (err) {
    console.error("[OWL DAEMON] Failed to write predictive cache:", err.message);
  }
}

// ─── File Watcher loop ───────────────────────────────────────────────────────
function watchWorkspace() {
  fs.watch(WORKSPACE_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Normalize path separators
    const fullPath = path.join(WORKSPACE_DIR, filename);
    const relPath = filename.replace(/\\/g, "/");

    // Filter directories
    if (
      relPath.includes(".git/") ||
      relPath.includes("node_modules/") ||
      relPath.includes(".venv/") ||
      relPath.includes(".owl-temp/") ||
      relPath.includes(".gemini/") ||
      relPath.endsWith("graph-ui-preview.html") ||
      relPath.endsWith("memory-v5.db") ||
      relPath.endsWith("memory-v5.db-shm") ||
      relPath.endsWith("memory-v5.db-wal")
    ) {
      return;
    }

    const ext = path.extname(fullPath);
    if (ext !== ".js" && ext !== ".py" && ext !== ".ts") return;

    // Debounce saves
    if (debounceMap.has(fullPath)) clearTimeout(debounceMap.get(fullPath));
    
    debounceMap.set(
      fullPath,
      setTimeout(() => {
        debounceMap.delete(fullPath);
        if (fs.existsSync(fullPath)) {
          console.log(`[OWL DAEMON] File saved: ${relPath}`);
          handleFileChange(fullPath);
        }
      }, 500)
    );
  });
}

// Start watching and start idle timer
watchWorkspace();
resetIdleTimer();
triggerWindowsNotification("OWL Substrate", "Autonomic background daemon watcher is active.");
