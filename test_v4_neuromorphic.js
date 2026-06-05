const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "test_neuromorphic.db");
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const DatabaseInit = require("better-sqlite3");
const db = new DatabaseInit(DB_PATH);

// Create essential tables including git branch awareness schema
db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, event_type TEXT DEFAULT 'observation',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project TEXT DEFAULT 'default',
        emotional_valence REAL DEFAULT 0, emotional_arousal REAL DEFAULT 0, salience REAL DEFAULT 0.5,
        strength REAL DEFAULT 1.0, developmental_stage TEXT DEFAULT 'raw',
        access_count INTEGER DEFAULT 0, last_accessed TEXT, next_review TEXT, review_interval REAL DEFAULT 1.0,
        is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS code_nodes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, node_type TEXT NOT NULL,
        filepath TEXT NOT NULL, content TEXT, project TEXT DEFAULT 'default',
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
        node_id TEXT PRIMARY KEY,
        activation REAL DEFAULT 0.0,
        last_updated INTEGER,
        FOREIGN KEY(node_id) REFERENCES code_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_git_branches (
        memory_id TEXT,
        branch_name TEXT,
        commit_sha TEXT,
        PRIMARY KEY(memory_id, branch_name),
        FOREIGN KEY(memory_id) REFERENCES episodic_memories(id) ON DELETE CASCADE
    );
`);

// Mock helper functions
function detectEmotionalSalience(t) {
  return { valence: -0.5, arousal: 0.8, salience: 0.9 };
}

function calculateNextReview(s) {
  return new Date(Date.now() + 86400000).toISOString();
}

// Global active branch state for tests
let testActiveBranch = "main";

function handleLearnFromError(args) {
  const errorMessage = args.error_message;
  const command = args.command || "unknown";
  const projectId = args.project || "default";
  const surprise = args.surprise_score !== undefined ? args.surprise_score : 0.8;

  let filepath = "";
  let lineNumber = 0;
  let functionName = "";

  const jsPatt1 = /at\s+([^\s(]+)\s+\(([^:]+):(\d+):(\d+)\)/;
  const jsPatt2 = /at\s+([^:]+):(\d+):(\d+)/;
  const pyPatt = /File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(\w+)/;
  const genericPatt = /^([^:\n]+):(\d+):(\d+):/;

  let match = errorMessage.match(jsPatt1);
  if (match) {
    functionName = match[1];
    filepath = match[2];
    lineNumber = parseInt(match[3], 10);
  } else {
    match = errorMessage.match(jsPatt2);
    if (match) {
      filepath = match[1];
      lineNumber = parseInt(match[2], 10);
    } else {
      match = errorMessage.match(pyPatt);
      if (match) {
        filepath = match[1];
        lineNumber = parseInt(match[2], 10);
        functionName = match[3];
      } else {
        match = errorMessage.match(genericPatt);
        if (match) {
          filepath = match[1];
          lineNumber = parseInt(match[2], 10);
        }
      }
    }
  }

  if (filepath) {
    filepath = filepath.replace(/\\/g, "/").trim();
    if (filepath.includes("/")) {
      const parts = filepath.split("/");
      filepath = parts.slice(-2).join("/");
    }
  } else {
    filepath = "unknown_file";
  }

  if (!functionName) {
    functionName = "anonymous";
  }

  let targetNodeId = `${filepath}::function::${functionName}`;
  if (functionName === "anonymous") {
    targetNodeId = `${filepath}::file::${filepath}`;
  }

  const nodeCheck = db.prepare("SELECT id FROM code_nodes WHERE id = ?").get(targetNodeId);
  if (!nodeCheck) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetNodeId,
      functionName === "anonymous" ? filepath : functionName,
      functionName === "anonymous" ? "file" : "function",
      filepath,
      `Auto-registered via learn_from_error tool`,
      projectId,
      now,
      now
    );
  }

  const memoryContent = `CRITICAL EXCEPTION [Command: ${command}]: ${errorMessage.slice(0, 500)}`;
  const nowStr = new Date().toISOString();
  const memoryId = crypto.randomBytes(8).toString("hex");

  db.prepare(`
    INSERT INTO episodic_memories (
      id, content, event_type, created_at, updated_at, project,
      emotional_valence, emotional_arousal, salience, strength,
      developmental_stage, access_count, last_accessed, next_review, review_interval
    ) VALUES (?, ?, 'error', ?, ?, ?, -0.5, 0.8, 0.9, ?, 'raw', 1, ?, ?, 1.0)
  `).run(
    memoryId,
    memoryContent,
    nowStr,
    nowStr,
    projectId,
    surprise,
    nowStr,
    calculateNextReview(surprise)
  );

  db.prepare(`
    INSERT INTO memory_code_links (memory_id, code_node_id, link_type)
    VALUES (?, ?, 'caused_bug')
  `).run(memoryId, targetNodeId);

  // Link to test branch
  db.prepare("INSERT OR REPLACE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)").run(
    memoryId,
    testActiveBranch,
    "mock_commit_sha"
  );

  return {
    status: "success",
    surprise_metric: surprise,
    parsed_stack: { filepath, line_number: lineNumber, function_name: functionName },
    registered_code_node: targetNodeId,
    stored_memory_id: memoryId
  };
}

function handleInjectActivation(args) {
  const nodeId = args.node_id, projectId = args.project || "default";
  const energy = args.energy !== undefined ? args.energy : 10.0;
  const decayFactor = args.decay_factor !== undefined ? args.decay_factor : 0.1;
  const threshold = args.threshold !== undefined ? args.threshold : 1.0;
  const maxDepth = args.max_depth !== undefined ? args.max_depth : 2;

  // Decay old activation levels
  db.prepare(`
    UPDATE code_node_activation 
    SET activation = activation * (1.0 - ?) 
    WHERE node_id IN (SELECT id FROM code_nodes WHERE project = ?)
  `).run(decayFactor, projectId);

  // Spreading BFS
  const queue = [[nodeId, energy, 0]];
  const visited = new Set();
  const nodeEnergies = new Map();

  while (queue.length > 0) {
    const [curr, currEnergy, depth] = queue.shift();
    if (visited.has(curr)) continue;
    visited.add(curr);

    const row = db.prepare("SELECT activation FROM code_node_activation WHERE node_id = ?").get(curr);
    const existing = row ? row.activation : 0.0;
    const targetEnergy = existing + currEnergy;
    nodeEnergies.set(curr, targetEnergy);

    db.prepare(`
      INSERT INTO code_node_activation (node_id, activation, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET activation = excluded.activation, last_updated = excluded.last_updated
    `).run(curr, targetEnergy, Date.now());

    if (depth < maxDepth) {
      const nextEnergy = currEnergy * (1.0 - decayFactor);
      if (nextEnergy > 0.1) {
        const edges = db.prepare("SELECT target_id, weight FROM code_edges WHERE source_id = ?").all(curr);
        for (const edge of edges) {
          if (!visited.has(edge.target_id)) {
            queue.push([edge.target_id, nextEnergy * (edge.weight || 1.0), depth + 1]);
          }
        }
      }
    }
  }

  // Retrieve spiked memories filtered by the active test branch
  const spikedMemories = [];
  const seenMemIds = new Set();

  const activatedNodes = db.prepare(`
    SELECT cna.node_id, cna.activation, cn.name, cn.filepath
    FROM code_node_activation cna
    JOIN code_nodes cn ON cn.id = cna.node_id
    WHERE cna.activation > ? AND cn.project = ?
  `).all(threshold, projectId);

  for (const node of activatedNodes) {
    const links = db.prepare(`
      SELECT mcl.link_type, em.* FROM memory_code_links mcl
      JOIN episodic_memories em ON em.id = mcl.memory_id
      LEFT JOIN memory_git_branches mgb ON mgb.memory_id = em.id
      WHERE mcl.code_node_id = ? AND em.project = ? AND em.is_active = 1
        AND (mgb.branch_name IS NULL OR mgb.branch_name = ?)
    `).all(node.node_id, projectId, testActiveBranch);

    for (const link of links) {
      if (!seenMemIds.has(link.id)) {
        seenMemIds.add(link.id);
        spikedMemories.push({
          id: link.id,
          content: link.content,
          event_type: link.event_type,
          node_id: node.node_id,
          node_name: node.name,
          activation: Math.round(node.activation * 100) / 100
        });
      }
    }
  }

  return {
    activated_nodes_count: nodeEnergies.size,
    spiked_memories_found: spikedMemories.length,
    spiked_memories: spikedMemories
  };
}

function handleRecall(args) {
  const projectId = args.project || "default";
  const querySql = `
    SELECT em.* FROM episodic_memories em
    LEFT JOIN memory_git_branches mgb ON mgb.memory_id = em.id
    WHERE em.project = ? AND em.is_active = 1
      AND (mgb.branch_name IS NULL OR mgb.branch_name = ?)
  `;
  return db.prepare(querySql).all(projectId, testActiveBranch);
}

function handleGlymphaticPrune(args) {
  const projectId = args.project || "default";
  const minStrength = args.min_strength !== undefined ? args.min_strength : 0.1;
  const dryRun = args.dry_run !== undefined ? args.dry_run : false;

  const decayedMemories = db.prepare(`
    SELECT id, content, strength, access_count, event_type, created_at
    FROM episodic_memories
    WHERE project = ? AND is_active = 1
      AND strength < ? AND access_count <= 1
      AND (event_type = 'observation' OR event_type = 'error')
  `).all(projectId, minStrength);

  const prunedIds = [];
  if (!dryRun) {
    const pruneStmt = db.prepare("UPDATE episodic_memories SET is_active = 0, updated_at = ? WHERE id = ?");
    const nowStr = new Date().toISOString();
    for (const mem of decayedMemories) {
      pruneStmt.run(nowStr, mem.id);
      prunedIds.push(mem.id);
    }
  }

  const allActive = db.prepare("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
  const groups = new Map();
  for (const mem of allActive) {
    const cleanContent = mem.content.replace(/[0-9a-fA-F]{16}/g, "[ID]").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, "[TIME]");
    if (!groups.has(cleanContent)) groups.set(cleanContent, []);
    groups.get(cleanContent).push(mem.id);
  }

  const mergedCount = [];
  if (!dryRun) {
    const nowStr = new Date().toISOString();
    for (const [pattern, ids] of groups.entries()) {
      if (ids.length > 1) {
        const primaryId = ids[0];
        const duplicateIds = ids.slice(1);
        
        const sumRow = db.prepare(`
          SELECT SUM(access_count) as total_access, MAX(strength) as max_strength 
          FROM episodic_memories 
          WHERE id IN (${ids.map(() => "?").join(",")})
        `).get(...ids);

        db.prepare(`
          UPDATE episodic_memories 
          SET access_count = ?, strength = ?, updated_at = ? 
          WHERE id = ?
        `).run(sumRow.total_access, Math.min(1.0, sumRow.max_strength + 0.1), nowStr, primaryId);

        const deactivateStmt = db.prepare("UPDATE episodic_memories SET is_active = 0, updated_at = ? WHERE id = ?");
        for (const dupId of duplicateIds) {
          deactivateStmt.run(nowStr, dupId);
          mergedCount.push(dupId);
        }
      }
    }
  }

  return {
    decayed_memories_found: decayedMemories.length,
    pruned_memories_count: dryRun ? 0 : prunedIds.length,
    pruned_ids: prunedIds,
    redundant_memories_merged: mergedCount.length,
    merged_ids: mergedCount
  };
}

function handleAnonymizeMemory(args) {
  const memoryId = args.memory_id;
  const mem = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(memoryId);
  if (!mem) return null;

  let content = mem.content;
  content = content.replace(/(api_key|token|password|auth|secret|key|passwd)\s*[:=]\s*["']?[a-zA-Z0-9_\-\.\=\+]{16,}["']?/gi, "$1 = [SCRUBBED]");
  content = content.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP_ADDRESS]");
  content = content.replace(/(?:[a-zA-Z]:)?\/Users\/[^\/]+/gi, "/Users/[USER]");
  
  let signature = "generic_observation";
  const errMatch = content.match(/([A-Z][a-zA-Z]+Error|Exception|CRITICAL\s+[A-Z]+)/);
  if (errMatch) {
    signature = errMatch[1];
  }

  const cleanPattern = content.trim();
  const hash = crypto.createHash("sha256").update(signature + ":" + cleanPattern).digest("hex");

  return {
    memory_id: memoryId,
    event_type: mem.event_type,
    original_length: mem.content.length,
    anonymized_content: cleanPattern,
    extracted_signature: signature,
    cryptographic_hash: hash
  };
}

// ─── Run Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log("======================================================================");
  console.log("   OWL NEUROMORPHIC MEMORY SUBSYSTEMS — VERIFICATION TESTS");
  console.log("======================================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✓ ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
    }
  }

  // Set branch context
  testActiveBranch = "main";

  // 1. Test Stack Trace Parsing and Node Auto-Registration
  console.log("[Test 1] Testing ASGM error learning stack trace parsing...");
  const sampleTrace = `ReferenceError: x is not defined
    at storeEmbedding (utils/database.js:42:15)
    at runTest (utils/test.js:10:5)`;

  const errResult = handleLearnFromError({
    error_message: sampleTrace,
    command: "npm test",
    project: "neuromorphic-test",
    surprise_score: 0.95
  });

  assert(errResult.status === "success", "Error learning executed successfully");
  assert(errResult.parsed_stack.function_name === "storeEmbedding", "Extracted correct function name");
  assert(errResult.parsed_stack.filepath === "utils/database.js", "Extracted correct filepath");
  assert(errResult.registered_code_node === "utils/database.js::function::storeEmbedding", "Formed correct code node ID");

  // Verify DB record existence
  const nodeRow = db.prepare("SELECT * FROM code_nodes WHERE id = ?").get(errResult.registered_code_node);
  assert(!!nodeRow, "Node was successfully auto-registered in the database");
  assert(nodeRow.filepath === "utils/database.js", "Auto-registered node has correct filepath metadata");

  const linkRow = db.prepare("SELECT * FROM memory_code_links WHERE memory_id = ?").get(errResult.stored_memory_id);
  assert(!!linkRow, "Episodic memory was successfully linked to the registered code node");

  console.log("");

  // 2. Test Spreading Activation Across Call Graph
  console.log("[Test 2] Testing Tesla Spreading Activation BFS propagation...");

  // Setup caller node A
  const callerNodeId = "utils/test.js::function::runTest";
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO code_nodes (id, name, node_type, filepath, content, project, created_at, updated_at)
    VALUES (?, 'runTest', 'function', 'utils/test.js', 'caller', 'neuromorphic-test', ?, ?)
  `).run(callerNodeId, now, now);

  // Setup call graph edge: runTest --[calls]--> storeEmbedding
  db.prepare(`
    INSERT INTO code_edges (source_id, target_id, edge_type, weight, created_at)
    VALUES (?, ?, 'calls', 1.0, ?)
  `).run(callerNodeId, errResult.registered_code_node, now);

  // Inject energy of 10.0 into A (caller)
  const actResult = handleInjectActivation({
    node_id: callerNodeId,
    energy: 10.0,
    decay_factor: 0.1,
    threshold: 1.0,
    project: "neuromorphic-test",
    max_depth: 2
  });

  assert(actResult.activated_nodes_count === 2, "Spreading activation reached exactly 2 connected nodes");
  assert(actResult.spiked_memories_found === 1, "Exactly 1 linked memory spiked above the threshold");
  assert(actResult.spiked_memories[0].node_name === "storeEmbedding", "Spiked memory returned is connected to callee function B");
  assert(actResult.spiked_memories[0].activation === 9.0, "Callee function received the correct decayed energy level (9.0)");

  console.log("");

  // 3. Test Git Branch Isolation
  console.log("[Test 3] Testing Git branch memory isolation...");

  // Write a global memory (null branch name)
  const globalMemId = crypto.randomBytes(8).toString("hex");
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, created_at, updated_at, project)
    VALUES (?, 'Global architectural guideline: avoid mutating state', 'observation', ?, ?, 'neuromorphic-test')
  `).run(globalMemId, now, now);

  // Set branch context to "feature-x" and create a branch-specific error memory
  testActiveBranch = "feature-x";
  const featureError = handleLearnFromError({
    error_message: `TypeError: Cannot read property 'foo' of undefined
      at runFeature (features/x.js:12:4)`,
    command: "npm run dev",
    project: "neuromorphic-test",
    surprise_score: 0.9
  });

  // Switch context back to "main" and run recall
  testActiveBranch = "main";
  const mainMems = handleRecall({ project: "neuromorphic-test" });
  
  assert(mainMems.length === 2, "Recall on 'main' branch returned correct 2 memories");
  assert(!mainMems.some(m => m.id === featureError.stored_memory_id), "Recall on 'main' successfully ignored 'feature-x' memories");

  // Switch context to "feature-x" and recall
  testActiveBranch = "feature-x";
  const featureMems = handleRecall({ project: "neuromorphic-test" });
  assert(featureMems.length === 2, "Recall on 'feature-x' branch returned correct 2 memories");
  assert(featureMems.some(m => m.id === featureError.stored_memory_id), "Recall on 'feature-x' successfully retrieved branch-specific error memory");
  assert(featureMems.some(m => m.id === globalMemId), "Recall on 'feature-x' successfully retrieved global memory");

  console.log("");

  // 4. Test Glymphatic Sleep-State Pruning & Consolidation
  console.log("[Test 4] Testing Glymphatic Sleep-State Pruning & Consolidation...");

  // Write a decayed memory with strength 0.05
  const decayedId = crypto.randomBytes(8).toString("hex");
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, created_at, updated_at, project, strength, access_count)
    VALUES (?, 'Stale observation to prune', 'observation', ?, ?, 'neuromorphic-test', 0.05, 1)
  `).run(decayedId, now, now);

  // Write duplicate error logs to test merging
  const dup1 = crypto.randomBytes(8).toString("hex");
  const dup2 = crypto.randomBytes(8).toString("hex");
  const errorMsg = "TypeError: db.prepare is not a function at init";
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, created_at, updated_at, project, strength, access_count)
    VALUES (?, ?, 'error', ?, ?, 'neuromorphic-test', 0.8, 1)
  `).run(dup1, errorMsg, now, now);
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, created_at, updated_at, project, strength, access_count)
    VALUES (?, ?, 'error', ?, ?, 'neuromorphic-test', 0.8, 1)
  `).run(dup2, errorMsg, now, now);

  const pruneRes = handleGlymphaticPrune({ project: "neuromorphic-test", min_strength: 0.1 });
  assert(pruneRes.pruned_memories_count === 1, "Decayed memory was successfully pruned");
  assert(pruneRes.pruned_ids[0] === decayedId, "Pruned memory matches correct ID");
  assert(pruneRes.redundant_memories_merged === 1, "Redundant duplicate memories were successfully merged");
  assert(pruneRes.merged_ids[0] === dup2, "Deactivated duplicate memory matches correct ID");

  // Verify DB state
  const decayedRow = db.prepare("SELECT is_active FROM episodic_memories WHERE id = ?").get(decayedId);
  assert(decayedRow.is_active === 0, "Decayed memory is soft-deleted in database");

  const dup2Row = db.prepare("SELECT is_active FROM episodic_memories WHERE id = ?").get(dup2);
  assert(dup2Row.is_active === 0, "Duplicate error log is soft-deleted in database");

  const primaryRow = db.prepare("SELECT access_count, strength FROM episodic_memories WHERE id = ?").get(dup1);
  assert(primaryRow.access_count === 2, "Primary consolidated memory accumulated access count (2)");
  assert(primaryRow.strength === 0.9, "Primary consolidated memory strength increased by learning factor (0.9)");

  console.log("");

  // 5. Test Memory Anonymization & Hashing
  console.log("[Test 5] Testing Memory Anonymization & P2P Cryptographic hashing...");

  // Write a memory with credentials, local paths, and IPs
  const sensitiveMemId = crypto.randomBytes(8).toString("hex");
  const sensitiveContent = `Connection error: api_key = "abc123xyz7890def" on server 192.168.1.100 while scanning C:/Users/shiva/code/index.js. TypeError: timeout`;
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, created_at, updated_at, project)
    VALUES (?, ?, 'error', ?, ?, 'neuromorphic-test')
  `).run(sensitiveMemId, sensitiveContent, now, now);

  const anonRes = handleAnonymizeMemory({ memory_id: sensitiveMemId });
  assert(!!anonRes, "Anonymization handler ran successfully");
  assert(!anonRes.anonymized_content.includes("abc123xyz7890def"), "Scrubbed API key successfully");
  assert(anonRes.anonymized_content.includes("api_key = [SCRUBBED]"), "Inserted API key placeholder");
  assert(!anonRes.anonymized_content.includes("192.168.1.100"), "Scrubbed IP address successfully");
  assert(anonRes.anonymized_content.includes("[IP_ADDRESS]"), "Inserted IP address placeholder");
  assert(!anonRes.anonymized_content.includes("/shiva"), "Scrubbed local system username path successfully");
  assert(anonRes.anonymized_content.includes("/Users/[USER]"), "Inserted username path placeholder");
  assert(anonRes.extracted_signature === "TypeError", "Extracted correct exception signature");
  assert(anonRes.cryptographic_hash.length === 64, "Generated valid SHA-256 cryptographic hash");

  console.log("\n======================================================================");
  console.log(`   TESTS COMPLETED: ${passed}/${total} assertions passed (${Math.round(passed/total * 100)}%)`);
  console.log("======================================================================");

  db.close();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  
  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
