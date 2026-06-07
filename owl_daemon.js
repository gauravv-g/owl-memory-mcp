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

try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN is_shareable INTEGER DEFAULT 0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN mesh_source_node TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN original_content TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN stale_flag INTEGER DEFAULT 0;");
} catch(e) {}

console.log(`[OWL DAEMON] Watching workspace: ${WORKSPACE_DIR}`);
console.log(`[OWL DAEMON] Connected to DB: ${DB_PATH}`);

// State variables
let lastSavedFileId = null;
let lastSaveTime = 0;
const debounceMap = new Map();
let idleTimer = null;
let lastBriefingDay = -1;
let narrativeArc = "Spec";

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
    md += `*Narrative Chapter: ${narrativeArc}*\n`;
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

  // 2. Syntax Validation & Custom Handler
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
  } else if (ext === ".md") {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const decisions = [];
      for (const line of lines) {
        if (/decided|choosing|will use|rejected/i.test(line)) {
          decisions.push(line.trim());
        }
      }
      if (decisions.length > 0) {
        const memoryId = generateId(decisions.join("\n"), "md_decision");
        const decContent = `[ARCHITECTURAL DECISION] File: ${relPath}\n${decisions.slice(0, 5).join("\n")}`;
        db.prepare(`
          INSERT OR IGNORE INTO episodic_memories 
          (id, content, event_type, project, salience, strength, created_at, updated_at) 
          VALUES (?, ?, 'architectural_decision', 'default', 0.85, 1.0, ?, ?)
        `).run(memoryId, decContent, now, now);
        console.log(`[OWL DAEMON] Logged architectural decision memory: ${memoryId}`);
      }
    } catch (e) {
      console.error("[OWL DAEMON] MD processing error:", e.message);
    }
  } else if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
        .run("config_change", JSON.stringify({ file: relPath, size: content.length }), now);
    } catch (e) {}
  } else if (ext === ".sql") {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (/create table|alter table|drop table/i.test(content)) {
        const memoryId = generateId(content, "sql_migration");
        db.prepare(`
          INSERT OR IGNORE INTO episodic_memories 
          (id, content, event_type, project, salience, strength, created_at, updated_at) 
          VALUES (?, ?, 'schema_migration', 'default', 0.9, 1.0, ?, ?)
        `).run(memoryId, `[SCHEMA MIGRATION] File: ${relPath}\nContent outline: ${content.slice(0, 300)}`, now, now);
        
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
          .run("schema_migration_detected", JSON.stringify({ file: relPath }), now);
      }
    } catch (e) {}
  }

  // 3. Database Sync & OS Notification
  if (!isValid) {
    narrativeArc = "Error";
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
      narrativeArc = "Fix";
      db.prepare("UPDATE code_bugs SET is_active = 0, resolution = 'Resolved by save validation' WHERE file_path = ?").run(relPath);
      console.log(`[OWL DAEMON] Resolved active bugs for ${relPath}`);
      // ═══ Nerve Bridge: signal fix ═══
      try {
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES (?, ?, ?, 0)")
          .run("syntax_resolved", JSON.stringify({ file: relPath }), now);
      } catch(e) {}
      triggerWindowsNotification("OWL Info: Code Resolved", `${path.basename(relPath)} compiles successfully now.`);
    } else {
      narrativeArc = "Build";
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

  // D4: Run Reflexive Interrupt checks
  checkReflexiveInterrupts(relPath);

  // QA Regression Auto-trigger for .js or .py files
  if (ext === ".js" || ext === ".py") {
    try {
      const activeMonitors = db.prepare("SELECT COUNT(*) as cnt FROM qa_sentinel_monitors WHERE active = 1").get();
      if (activeMonitors && activeMonitors.cnt > 0) {
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES ('source_changed', ?, ?, 0)")
          .run(JSON.stringify({ file: relPath }), new Date().toISOString());
      }
    } catch(e) {
      console.error("[OWL DAEMON] Failed to queue source_changed signal:", e.message);
    }
  }

  // Reset idle timer
  resetIdleTimer();
}

// ─── Idle Dream Cycle ────────────────────────────────────────────────────────
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  
  // ═══ Innovation C: Circadian Rhythms ═══
  const hour = new Date().getHours();
  const isPeak = hour >= 9 && hour <= 17;
  const idleWaitMs = isPeak ? 5 * 60 * 1000 : 2 * 60 * 1000;

  idleTimer = setTimeout(() => {
    const today = new Date().getDay();
    const currentHour = new Date().getHours();
    if (currentHour >= 6 && currentHour <= 10 && lastBriefingDay !== today) {
      lastBriefingDay = today;
      triggerWindowsNotification("OWL Circadian Rhythm", "Morning Briefing: Substrate active. Peak cognitive state ready.");
    }
    
    console.log(`[OWL DAEMON] Workspace idle for ${idleWaitMs/60000} minutes. Triggering delta introspection and dream cycle...`);
    try {
      const now = new Date().toISOString();
      
      // ═══ Innovation 1: Zero-Prompt Delta Introspection ═══
      let diffStat = "";
      try {
        // Look at git diff to see what changed recently
        diffStat = execSync("git diff HEAD --stat", { cwd: WORKSPACE_DIR, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      } catch (e) { }

      if (diffStat && diffStat.length > 0) {
        const semanticDetails = parseSemanticDiff();
        const memoryId = generateId(diffStat + semanticDetails, "auto_checkpoint");
        let content = `AUTO-CHECKPOINT: Developer paused for 3 minutes. Workspace changes detected:\n${diffStat}\nIntention: Uncommitted local modifications.`;
        if (semanticDetails) {
          content = `AUTO-CHECKPOINT: ${semanticDetails}. Original diff stats:\n${diffStat}`;
        }
        db.prepare(`
          INSERT OR IGNORE INTO episodic_memories 
          (id, content, event_type, project, salience, strength, created_at, updated_at) 
          VALUES (?, ?, 'auto_checkpoint', 'default', 0.6, 1.0, ?, ?)
        `).run(memoryId, content, now, now);
        console.log(`[OWL DAEMON] Logged Zero-Prompt Delta Introspection checkpoint: ${memoryId}`);
        triggerWindowsNotification("OWL Auto-Checkpoint", "Logged recent changes into memory silently.");
      }

      // Connect to server or execute dream cycle logic locally
      // Local dream mock / trigger:
      const active = db.prepare("SELECT id, content, strength, generation, fitness_score, feynman_level, original_content FROM episodic_memories WHERE is_active = 1").all();
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
            const gen = Math.max(m1.generation || 1, m2.generation || 1) + 1;
            const fit = Math.min((m1.fitness_score || 0.5) + 0.1, 1.0);
            
            // ═══ Innovation H: Feynman Ladder Compression ═══
            const newFeynman = Math.min((m1.feynman_level || 1) + 1, 5);
            let newContent = m1.content;
            let originalContent = m1.original_content || m1.content;
            if (newFeynman >= 3) {
              const words = Array.from(new Set(m1.content.split(/\W+/))).filter(w => w.length > 4);
              newContent = `[L${newFeynman} Abstraction] ${words.slice(0, 20).join(' ')}`;
            }

            db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(m2.id);
            db.prepare("UPDATE episodic_memories SET content = ?, original_content = ?, strength = strength + 0.3, generation = ?, fitness_score = ?, feynman_level = ? WHERE id = ?").run(newContent, originalContent, gen, fit, newFeynman, m1.id);
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
      const prunedCount = (gly.pruned_synapses || 0) + (gly.pruned_bugs || 0) + (gly.pruned_memories || 0);

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
  }, idleWaitMs);
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

    // 2.5 Evolutionary Genetics: Prune weak memories
    const memRes = db.prepare(`
      UPDATE episodic_memories SET is_active = 0 
      WHERE fitness_score < 0.2 AND is_active = 1 AND created_at < ?
    `).run(yesterday);

    // 3. Compact database using VACUUM
    db.exec("VACUUM");

    console.log(`[OWL DAEMON] Glymphatic cleanup complete. Pruned ${synRes.changes} synapses, ${bugRes.changes} bugs, and ${memRes.changes} weak memories.`);
    return {
      status: "completed",
      pruned_synapses: synRes.changes,
      pruned_bugs: bugRes.changes,
      pruned_memories: memRes.changes
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

// Hermes v7.0: handleGitCommit helper
function handleGitCommit() {
  try {
    const stdout = execSync("git diff HEAD~1 --name-only", { encoding: "utf8", cwd: WORKSPACE_DIR });
    const changedFiles = stdout.split("\n").map(f => f.trim()).filter(Boolean);
    if (changedFiles.length > 0) {
      console.log(`[OWL DAEMON] Git commit detected with changes: ${changedFiles.join(", ")}`);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO daemon_signals (signal_type, payload, consumed, created_at)
        VALUES ('git_commit_detected', ?, 0, ?)
      `).run(JSON.stringify({ changed_files: changedFiles }), now);
    }
  } catch (e) {
    console.error(`[OWL DAEMON] Git diff extraction failed: ${e.message}`);
  }
}

// Hermes v7.0: runQAScreenshotManager helper
function runQAScreenshotManager() {
  const screenshotDir = path.join(path.dirname(DB_PATH), "qa-screenshots");
  if (!fs.existsSync(screenshotDir)) return;

  console.log(`[OWL DAEMON] Running QA Screenshot Manager on ${screenshotDir}`);
  const now = Date.now();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  try {
    const failingShots = new Set();
    const rows = db.prepare(`
      SELECT screenshot_before, screenshot_after FROM qa_test_steps WHERE passed = 0
    `).all();
    for (const r of rows) {
      if (r.screenshot_before) failingShots.add(path.resolve(r.screenshot_before));
      if (r.screenshot_after) failingShots.add(path.resolve(r.screenshot_after));
    }
    const bugRows = db.prepare("SELECT screenshot_paths_json FROM qa_bugs").all();
    for (const br of bugRows) {
      try {
        const paths = JSON.parse(br.screenshot_paths_json || "[]");
        for (const p of paths) {
          failingShots.add(path.resolve(p));
        }
      } catch(e) {}
    }

    let totalSize = 0;
    const files = fs.readdirSync(screenshotDir);
    for (const file of files) {
      const filePath = path.join(screenshotDir, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      totalSize += stat.size;

      if (file.startsWith("baseline_")) continue;

      const age = now - stat.mtimeMs;
      const isFailing = failingShots.has(path.resolve(filePath));

      const shouldDelete = (
        (isFailing && age > ninetyDays) ||
        (!isFailing && age > fourteenDays)
      );

      if (shouldDelete) {
        fs.unlinkSync(filePath);
        totalSize -= stat.size;
        console.log(`[OWL DAEMON] Purged old screenshot: ${file}`);
      }
    }

    const sizeGB = totalSize / (1024 * 1024 * 1024);
    if (sizeGB > 5.0) {
      triggerWindowsNotification(
        "QA Storage Warning",
        `QA Screenshot directory size is ${sizeGB.toFixed(2)}GB, exceeding 5GB limit.`
      );
    }
  } catch (e) {
    console.error("[OWL DAEMON] QA Screenshot Manager failed:", e.message);
  }
}

// ─── File Watcher loop ───────────────────────────────────────────────────────
function watchWorkspace() {
  fs.watch(WORKSPACE_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Normalize path separators
    const fullPath = path.join(WORKSPACE_DIR, filename);
    const relPath = filename.replace(/\\/g, "/");

    // HERMES v7.0: Catch Git commits
    if (relPath.endsWith(".git/COMMIT_EDITMSG") || relPath.endsWith("COMMIT_EDITMSG")) {
      handleGitCommit();
      return;
    }

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

    const ext = path.extname(fullPath).toLowerCase();
    // Note: .env.example is matched as .example by extname, handle separately
    const allowedExtensions = [".js", ".py", ".ts", ".md", ".json", ".yaml", ".yml", ".toml", ".sql", ".sh", ".txt"];
    const isEnvExample = fullPath.endsWith(".env.example") || fullPath.endsWith(".env.local");
    if (!allowedExtensions.includes(ext) && !isEnvExample) return;

    if (ext === ".txt") {
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size > 5120) return;
      } catch (e) {
        return;
      }
    }

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

function checkCrossServerEvents() {
  try {
    const crossEvents = db.prepare(
      // Only fetch events not yet consumed by owl-daemon to avoid full table scan
      "SELECT id, source_server, event_type, payload, target_servers, consumed_by, created_at FROM cross_server_events WHERE consumed_by NOT LIKE '%\"owl-daemon\"%' ORDER BY id DESC LIMIT 50"
    ).all();
    
    for (const ev of crossEvents) {
      let targetsList = [];
      let consumedList = [];
      try { targetsList = JSON.parse(ev.target_servers || "[]"); } catch(e) {}
      try { consumedList = JSON.parse(ev.consumed_by || "[]"); } catch(e) {}
      
      if (consumedList.includes("owl-daemon")) continue;
      if (targetsList.length > 0 && !targetsList.includes("owl-daemon")) continue;
      
      let parsedPayload = ev.payload;
      try { parsedPayload = JSON.parse(ev.payload); } catch(e) {}
      
      console.log(`[OWL DAEMON] Processed cross-server event: ${ev.event_type} from ${ev.source_server}`);
      
      if (ev.event_type === "research_complete" && parsedPayload.topic) {
        if (lastSavedFileId) {
          console.log(`[OWL DAEMON] Re-writing predictive cache due to research_complete on ${parsedPayload.topic}`);
          writePredictiveCache(lastSavedFileId, "default");
        }
      } else if (ev.event_type === "research_invalidation_required") {
        triggerWindowsNotification("OWL Knowledge Alert", `Research memory about ${parsedPayload.domain} marked stale due to monitored page changes.`);
      }
      
      consumedList.push("owl-daemon");
      db.prepare("UPDATE cross_server_events SET consumed_by = ? WHERE id = ?").run(
        JSON.stringify(consumedList), ev.id
      );
    }
  } catch (err) {
    console.error("[OWL DAEMON] checkCrossServerEvents failed:", err.message);
  }
}

function checkReflexiveInterrupts(relPath) {
  const now = new Date().toISOString();
  try {
    // 1. Suppression Mechanism
    const dismissalRow = db.prepare(`
      SELECT COUNT(*) as cnt, MAX(timestamp) as last_dismissed 
      FROM session_behavior_log 
      WHERE event_type = 'interrupt_dismissed' AND file_touched = ?
    `).get(relPath);
    
    let dismissals = dismissalRow ? dismissalRow.cnt : 0;
    let lastDismissed = dismissalRow ? dismissalRow.last_dismissed : null;
    
    if (dismissals >= 5 && lastDismissed) {
      const hoursSince = (Date.now() - new Date(lastDismissed).getTime()) / (3600 * 1000);
      if (hoursSince < 48) {
        console.log(`[OWL REFLEXIVE] Silencing warnings for ${relPath} (suppressed for 48h due to ${dismissals} dismissals)`);
        return;
      }
    }
    
    if (dismissals >= 3) {
      const nodeRow = db.prepare("SELECT edit_count FROM code_nodes WHERE id = ?").get(relPath);
      const editCount = nodeRow ? nodeRow.edit_count : 0;
      if (editCount % 2 !== 0) {
        console.log(`[OWL REFLEXIVE] Skipping warning for ${relPath} due to reduced frequency (dismissals = ${dismissals})`);
        return;
      }
    }

    // 2. Biorhythm risk check
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();
    let riskMultiplier = 1.0;
    const bioRow = db.prepare("SELECT risk_multiplier FROM cognitive_biorhythm WHERE hour_of_day = ? AND day_of_week = ?").get(currentHour, currentDay);
    if (bioRow) riskMultiplier = bioRow.risk_multiplier;
    if (currentDay === 5 && currentHour >= 15 && currentHour <= 17) {
      riskMultiplier = 3.2;
    }

    if (riskMultiplier > 2.0) {
      db.prepare(`
        INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
        VALUES ('reflexive_interrupt', ?, ?, 0)
      `).run(JSON.stringify({
        type: "cognitive_biorhythm",
        priority: "high",
        message: `⚠️ BIORHYTHM ALERT: You are in a high-risk hour. Risk multiplier is ${riskMultiplier.toFixed(1)}x. Double-check your code.`,
        file: relPath
      }), now);
    }

    // 3. Causal predictions check
    const predictions = db.prepare(`
      SELECT * FROM causal_predictions 
      WHERE outcome = 'pending' AND (predicted_file = ? OR ? LIKE '%' || predicted_file)
    `).all(relPath, relPath);

    for (const pred of predictions) {
      db.prepare(`
        INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
        VALUES ('reflexive_interrupt', ?, ?, 0)
      `).run(JSON.stringify({
        type: "causal_prediction",
        priority: pred.confidence > 0.8 ? "critical" : "medium",
        message: `⚠️ PROPHETIC WARNING: Editing ${pred.predicted_file} has historically led to errors/bugs in ${(pred.confidence * 100).toFixed(0)}% of sessions.`,
        file: relPath
      }), now);
    }

    // 4. Constitutional check (rules 1 and 2)
    const filePath = path.join(WORKSPACE_DIR, relPath);
    if (fs.existsSync(filePath)) {
      const codeSnippet = fs.readFileSync(filePath, "utf-8");
      
      // Rule 1: Credentials
      if (codeSnippet.match(/(?:key|password|secret|token)\s*=\s*['"][a-zA-Z0-9_-]{16,}['"]/i)) {
        db.prepare(`
          INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
          VALUES ('reflexive_interrupt', ?, ?, 0)
        `).run(JSON.stringify({
          type: "constitutional_violation",
          priority: "critical",
          message: "⚖️ CONSTITUTIONAL ALERT: Sensitive credentials/keys found in code.",
          file: relPath
        }), now);
      }
      
      // Rule 2: Async try-catch
      if (codeSnippet.includes("async ") && !codeSnippet.includes("try") && !codeSnippet.includes("catch")) {
        db.prepare(`
          INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
          VALUES ('reflexive_interrupt', ?, ?, 0)
        `).run(JSON.stringify({
          type: "constitutional_violation",
          priority: "high",
          message: "⚖️ CONSTITUTIONAL ALERT: Async call lacks try-catch wrapper.",
          file: relPath
        }), now);
      }
    }

  } catch(e) {
    console.error("[OWL REFLEXIVE] Error checking interrupts:", e.message);
  }
}

function parseSemanticDiff() {
  let semanticSummary = "";
  try {
    const diff = execSync("git diff HEAD --unified=0", { cwd: WORKSPACE_DIR, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const lines = diff.split("\n");
    let currentFile = "";
    const addedFuncs = [];
    const removedFuncs = [];
    const addedImports = [];
    const keywords = new Set();

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6).trim();
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const content = line.substring(1).trim();
        content.toLowerCase().match(/\b(jwt|auth|token|refresh|db|route|user|api|cache|fetch|predict|resonance|trust|synthesis)\b/g)?.forEach(w => keywords.add(w));
        
        const defMatch = content.match(/(?:def|function)\s+([a-zA-Z0-9_]+)/) || content.match(/const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/);
        if (defMatch) {
          addedFuncs.push(`function '${defMatch[1]}' to ${path.basename(currentFile)}`);
        }
        const importMatch = content.match(/import\s+([\s\S]+?)(?:\s+from\s+['"]([\w_-]+)['"]|;|$)/) || content.match(/const\s+([\w_-]+)\s*=\s*require\(/);
        if (importMatch) {
          const impName = importMatch[2] || importMatch[1].trim();
          addedImports.push(`import '${impName}' to ${path.basename(currentFile)}`);
        }
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        const content = line.substring(1).trim();
        const defMatch = content.match(/(?:def|function)\s+([a-zA-Z0-9_]+)/) || content.match(/const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/);
        if (defMatch) {
          removedFuncs.push(`function '${defMatch[1]}' from ${path.basename(currentFile)}`);
        }
      }
    }

    const summaries = [];
    if (addedFuncs.length > 0) summaries.push(`Added ${addedFuncs.join(", ")}`);
    if (removedFuncs.length > 0) summaries.push(`Removed ${removedFuncs.join(", ")}`);
    if (addedImports.length > 0) summaries.push(`Added ${addedImports.join(", ")}`);

    if (summaries.length > 0) {
      semanticSummary = summaries.join(". ");
      if (keywords.size > 0) {
        semanticSummary += `. Pattern: ${Array.from(keywords).join(" ")} implementation`;
      }
    }
  } catch (e) {
    console.error("[OWL SEMANTIC DIFF] Failed to parse semantic diff:", e.message);
  }
  return semanticSummary;
}

// Guard: prevent multiple concurrent monitor check processes
let _monitorCheckRunning = false;

function runMonitorChecking() {
  if (_monitorCheckRunning) {
    console.log("[OWL DAEMON] Monitor check already running, skipping.");
    return;
  }
  _monitorCheckRunning = true;
  const checkScript = path.join(__dirname, "check_monitors.py");
  console.log(`[OWL DAEMON] Running background monitor check: ${checkScript}`);
  exec(`python "${checkScript}"`, (err, stdout, stderr) => {
    _monitorCheckRunning = false;
    if (err) {
      console.error(`[OWL DAEMON MONITOR CHECK ERROR] ${err.message}`);
      return;
    }
    if (stdout && stdout.trim()) {
      console.log(`[OWL DAEMON MONITOR CHECK] ${stdout.trim()}`);
    }
  });
}

// Start watching and start idle timer
watchWorkspace();
resetIdleTimer();
runMonitorChecking();
setInterval(runMonitorChecking, 2 * 60 * 1000); // Check every 2 minutes
checkCrossServerEvents();
setInterval(checkCrossServerEvents, 15 * 1000); // Check every 15 seconds
runQAScreenshotManager();
setInterval(runQAScreenshotManager, 60 * 60 * 1000); // Check/purge screenshots every hour
triggerWindowsNotification("OWL Substrate", "Autonomic background daemon watcher is active.");
