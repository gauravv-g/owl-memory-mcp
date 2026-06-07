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
const vm = require("vm");

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
db.pragma("wal_autocheckpoint = 100");

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
    is_active INTEGER DEFAULT 1, is_consolidated INTEGER DEFAULT 0,
    generation INTEGER DEFAULT 1, fitness_score REAL DEFAULT 0.5, feynman_level INTEGER DEFAULT 1,
    is_shareable INTEGER DEFAULT 0, mesh_source_node TEXT, original_content TEXT,
    stale_flag INTEGER DEFAULT 0, provenance_chain TEXT, tags TEXT
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

  -- ═══ Innovation 5: Daemon-MCP Nerve Bridge ═══
  -- Background daemon writes signals here; nexus.perceive reads + flushes them
  CREATE TABLE IF NOT EXISTS daemon_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    consumed INTEGER DEFAULT 0
  );

  -- ═══ Innovation Predictive Layer ═══
  CREATE TABLE IF NOT EXISTS causal_predictions (
    id TEXT PRIMARY KEY,
    trigger_pattern TEXT NOT NULL,
    predicted_event TEXT NOT NULL,
    predicted_file TEXT,
    confidence REAL DEFAULT 0.5,
    predicted_at TEXT NOT NULL,
    verify_at TEXT NOT NULL,
    verified_at TEXT,
    outcome TEXT DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS memory_observer_sessions (
    session_id TEXT NOT NULL,
    observer_type TEXT NOT NULL,
    observer_context TEXT,
    top_memories TEXT,
    resolution_time_ms INTEGER,
    resolution_outcome TEXT
  );

  -- ═══ Innovation 1: Session Resurrection Protocol ═══
  -- Written at end of session, read at start of next session
  CREATE TABLE IF NOT EXISTS session_states (
    id TEXT PRIMARY KEY,
    project TEXT DEFAULT 'default',
    summary TEXT NOT NULL,
    last_file TEXT,
    last_error TEXT,
    pending_decisions TEXT DEFAULT '[]',
    recent_memory_ids TEXT DEFAULT '[]',
    emotional_tone TEXT DEFAULT 'neutral',
    token_count INTEGER DEFAULT 0,
    ended_at TEXT NOT NULL
  );

  -- ═══ Innovation 3: Token Ledger ═══
  -- Tracks token costs saved vs injected per session
  CREATE TABLE IF NOT EXISTS token_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT DEFAULT 'default',
    tool_called TEXT NOT NULL,
    tokens_injected INTEGER DEFAULT 0,
    tokens_saved_estimate INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- ═══ Innovation A: Neocortex — Semantic Distillation Engine ═══
  -- Auto-generated semantic abstractions from episodic memory clusters
  CREATE TABLE IF NOT EXISTS semantic_distillations (
    id TEXT PRIMARY KEY,
    project TEXT DEFAULT 'default',
    pattern TEXT NOT NULL,
    source_memory_ids TEXT DEFAULT '[]',
    strength REAL DEFAULT 1.0,
    recall_count INTEGER DEFAULT 0,
    outcome_score REAL DEFAULT 0.0,
    fitness REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ═══ Innovation C: Stigmergy — Pheromone Trail Table ═══
  CREATE TABLE IF NOT EXISTS pheromone_trails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_memory_id TEXT,
    action_type TEXT NOT NULL,
    outcome TEXT CHECK(outcome IN ('success','failure','neutral')),
    strength_delta REAL DEFAULT 0.0,
    agent_id TEXT DEFAULT 'default',
    project TEXT DEFAULT 'default',
    created_at TEXT NOT NULL
  );

  -- ═══ Innovation B: Predictive Sensorium — Pre-computed context cache ═══
  CREATE TABLE IF NOT EXISTS predictive_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT DEFAULT 'default',
    trigger_file TEXT,
    predicted_contexts TEXT DEFAULT '[]',
    pre_retrieved_memories TEXT DEFAULT '[]',
    confidence REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed INTEGER DEFAULT 0
  );

  -- ═══ Innovation D: Cognitive Fingerprint — Per-project behavioral model ═══
  -- Updated every 10 dream cycles. Captures how you work, not just what you worked on.
  CREATE TABLE IF NOT EXISTS cognitive_fingerprint (
    id TEXT PRIMARY KEY,
    project TEXT DEFAULT 'default',
    work_style TEXT DEFAULT 'unknown',
    peak_hour_start INTEGER DEFAULT 9,
    peak_hour_end INTEGER DEFAULT 17,
    avg_session_length_minutes REAL DEFAULT 60,
    decision_reversal_rate REAL DEFAULT 0.0,
    primary_memory_type TEXT DEFAULT 'observation',
    mental_model_clusters TEXT DEFAULT '[]',
    cognitive_style TEXT DEFAULT 'outcome-first',
    total_sessions_analyzed INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- ═══ Innovation E: Memory Programs (Executable Bug Vaccines) ═══
  CREATE TABLE IF NOT EXISTS memory_programs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    program_code TEXT NOT NULL,        -- Sandboxed JS function body
    compiled_from_memory_ids TEXT DEFAULT '[]',
    execution_count INTEGER DEFAULT 0,
    true_positive_count INTEGER DEFAULT 0,
    false_positive_count INTEGER DEFAULT 0,
    precision_score REAL DEFAULT 0.5,
    project TEXT DEFAULT 'default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ═══ Federated P2P Memory Mesh: Peer Registry ═══
  CREATE TABLE IF NOT EXISTS mesh_peers (
    node_id TEXT PRIMARY KEY,
    display_name TEXT,
    trust_level TEXT DEFAULT 'team',
    last_seen TEXT NOT NULL,
    memories_received INTEGER DEFAULT 0,
    memories_shared INTEGER DEFAULT 0
  );

  -- ═══ Immunological Memory: Antigen Profiles ═══
  CREATE TABLE IF NOT EXISTS package_antigen_profiles (
    package_name TEXT NOT NULL,
    package_version TEXT NOT NULL,
    api_surface_hash TEXT NOT NULL,
    risk_antigens TEXT DEFAULT '[]',
    immune_status TEXT DEFAULT 'naive',
    antibody_strength REAL DEFAULT 0.0,
    first_exposure TEXT,
    last_exposure TEXT,
    PRIMARY KEY (package_name, package_version)
  );

  -- ═══ Narrative Templates ═══
  CREATE TABLE IF NOT EXISTS narrative_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stages TEXT NOT NULL,             -- JSON array of stages
    stage_transitions TEXT NOT NULL,  -- JSON mapping of triggers
    avg_duration_hours REAL,
    success_rate REAL DEFAULT 0.5,
    times_observed INTEGER DEFAULT 0
  );

  -- ═══ Active Narratives ═══
  CREATE TABLE IF NOT EXISTS active_narratives (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    project TEXT NOT NULL,
    current_stage TEXT NOT NULL,
    stage_entered_at TEXT NOT NULL,
    context TEXT DEFAULT '{}',
    predicted_next_stage TEXT,
    predicted_next_blocker TEXT,
    started_at TEXT NOT NULL,
    FOREIGN KEY(template_id) REFERENCES narrative_templates(id)
  );

  -- ═══ Feynman Ladder Cognitive Compression Levels ═══
  CREATE TABLE IF NOT EXISTS cognitive_compression_levels (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    compression_level INTEGER NOT NULL,
    content TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    coverage REAL DEFAULT 0.0,
    lossless INTEGER DEFAULT 0,
    feynman_score REAL DEFAULT 0.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ═══ Memory Crystals Store ═══
  CREATE TABLE IF NOT EXISTS memory_crystals (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    crystal_type TEXT,
    member_memory_ids TEXT DEFAULT '[]',
    symmetry_score REAL DEFAULT 0.5,
    growth_rate REAL DEFAULT 0.0,
    lattice_connections TEXT DEFAULT '[]',
    d3_position TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ═══ Pythagorean Harmonic Analysis ═══
  CREATE TABLE IF NOT EXISTS harmonic_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    file_path TEXT NOT NULL,
    function_to_line_ratio REAL,
    bug_density REAL,
    cyclomatic_complexity REAL,
    cognitive_complexity REAL,
    cc_ratio REAL,
    harmony_score REAL,
    dissonance_alert INTEGER DEFAULT 0,
    analyzed_at TEXT NOT NULL
  );

  -- Pillar 1: Hallucination Firewall
  CREATE TABLE IF NOT EXISTS hallucination_registry (
    id TEXT PRIMARY KEY,
    agent_claim TEXT NOT NULL,
    ground_truth TEXT,
    discrepancy_score REAL,
    correction_injected TEXT,
    project TEXT DEFAULT 'default',
    detected_at TEXT NOT NULL
  );
  
  -- Pillar 3: Feynman Cargo Cult Detector
  CREATE TABLE IF NOT EXISTS cargo_cult_registry (
    id TEXT PRIMARY KEY,
    code_snippet_hash TEXT NOT NULL,
    file_path TEXT NOT NULL,
    paste_detected_at TEXT NOT NULL,
    has_rationale_memory INTEGER DEFAULT 0,
    rationale_memory_id TEXT,
    risk_level TEXT
  );
  
  -- Pillar 4: Competitive Memory Selection - Fossil Record
  CREATE TABLE IF NOT EXISTS fossil_record (
    id TEXT PRIMARY KEY,
    original_content TEXT NOT NULL,
    final_fitness REAL,
    extinction_date TEXT NOT NULL,
    reason TEXT
  );
  
  -- Pillar 8: Naval Specific Knowledge Crystals
  CREATE TABLE IF NOT EXISTS specific_knowledge_crystals (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    knowledge_content TEXT NOT NULL,
    uniqueness_score REAL DEFAULT 0.5,
    moat_classification TEXT,
    times_applied REAL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  
  -- Pillar 9: Tata Project Constitution
  CREATE TABLE IF NOT EXISTS project_constitution (
    id TEXT PRIMARY KEY,
    article_number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    rule_definition TEXT NOT NULL,
    is_mandatory INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  );
  
  -- Pillar 11: Da Vinci Cross-Modal Codex
  CREATE TABLE IF NOT EXISTS codex_memories (
    id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL,
    raw_content BLOB,
    extracted_text TEXT,
    linked_code_nodes TEXT,
    project TEXT DEFAULT 'default',
    created_at TEXT NOT NULL
  );
  
  -- Pillar 2: Einstein Observer Effect Reconsolidation Log
  CREATE TABLE IF NOT EXISTS reconsolidation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    valence_drift REAL,
    arousal_drift REAL,
    previous_strength REAL,
    new_strength REAL,
    recalled_at TEXT NOT NULL
  );
  
  -- Pillar 5: Pythagoras Cognitive Biorhythm
  CREATE TABLE IF NOT EXISTS cognitive_biorhythm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hour_of_day INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    historical_error_count INTEGER DEFAULT 0,
    historical_success_count INTEGER DEFAULT 0,
    avg_error_rate REAL DEFAULT 0.0,
    risk_multiplier REAL DEFAULT 1.0,
    updated_at TEXT NOT NULL,
    UNIQUE(hour_of_day, day_of_week)
  );

  -- Pillar 12: Bounded Self-Optimization constants
  CREATE TABLE IF NOT EXISTS synaptic_constants (
    name TEXT PRIMARY KEY,
    value REAL NOT NULL
  );

  -- D3: Cross-Server Events
  CREATE TABLE IF NOT EXISTS cross_server_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_server TEXT,
    event_type TEXT,
    payload TEXT,
    target_servers TEXT,
    consumed_by TEXT DEFAULT '[]',
    created_at TEXT
  );

  -- M2: Behavioral Turing Audit session log
  CREATE TABLE IF NOT EXISTS session_behavior_log (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    file_touched TEXT,
    decision_made TEXT,
    error_encountered TEXT,
    contradiction_fired INTEGER DEFAULT 0,
    vaccine_fired TEXT,
    constitution_violated INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL
  );

  -- M6: Code Topology Snapshots
  CREATE TABLE IF NOT EXISTS code_topology_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    node_count INTEGER DEFAULT 0,
    edge_count INTEGER DEFAULT 0,
    hotspot_centroid TEXT,
    avg_gravity REAL DEFAULT 0.0,
    complexity_score REAL DEFAULT 0.0,
    captured_at TEXT NOT NULL
  );

  -- W5: Provenance-Preserving Web Store
  CREATE TABLE IF NOT EXISTS web_provenance_chain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT,
    claim_text TEXT,
    source_url TEXT,
    source_trust REAL DEFAULT 0.5,
    fetched_at TEXT,
    is_contradicted INTEGER DEFAULT 0
  );
`);

try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN stale_flag INTEGER DEFAULT 0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN provenance_chain TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN tags TEXT;");
} catch(e) {}

// Phase 4: DB Schema Extensions
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN inherited INTEGER DEFAULT 0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN donor_project TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN transplant_confidence REAL DEFAULT 1.0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE episodic_memories ADD COLUMN template_id TEXT;");
} catch(e) {}

// Hermes v7.0 (QA Schema Extensions)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_test_runs (
      id TEXT PRIMARY KEY,
      test_type TEXT NOT NULL,
      target_url TEXT, target_app TEXT,
      flow_name TEXT, flow_description TEXT,
      status TEXT DEFAULT 'pending',
      regression_score REAL DEFAULT 100.0,
      screenshot_count INTEGER DEFAULT 0,
      bug_count INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      chaos_scenario TEXT,
      project TEXT DEFAULT 'default',
      run_by TEXT DEFAULT 'agent',
      created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS qa_test_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      target_selector TEXT, input_value TEXT,
      expected_state TEXT, actual_state TEXT,
      vision_interpretation TEXT,
      passed INTEGER DEFAULT 1,
      screenshot_before TEXT, screenshot_after TEXT,
      network_requests_json TEXT DEFAULT '[]',
      console_errors_json TEXT DEFAULT '[]',
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_bugs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      bug_type TEXT DEFAULT 'functional',
      target_url TEXT, target_app TEXT,
      steps_to_reproduce_json TEXT DEFAULT '[]',
      screenshot_paths_json TEXT DEFAULT '[]',
      video_path TEXT,
      root_cause TEXT,
      similar_bug_ids_json TEXT DEFAULT '[]',
      feynman_explanations_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'open',
      project TEXT DEFAULT 'default',
      discovered_in_run TEXT,
      created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS qa_visual_baselines (
      id TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      flow_name TEXT, step_name TEXT NOT NULL,
      screenshot_path TEXT NOT NULL,
      dom_hash TEXT,
      harmony_score REAL DEFAULT 1.0,
      element_count INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 1,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_performance_baselines (
      id TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      baseline_value REAL NOT NULL,
      threshold_warning REAL,
      threshold_critical REAL,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_knowledge_crystals (
      id TEXT PRIMARY KEY,
      target_url TEXT, target_app TEXT,
      crystal_type TEXT NOT NULL,
      description TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      times_confirmed INTEGER DEFAULT 1,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_sentinel_monitors (
      id TEXT PRIMARY KEY,
      target_url TEXT, target_app TEXT,
      flow_name TEXT NOT NULL,
      flow_steps_json TEXT DEFAULT '[]',
      check_interval_minutes INTEGER DEFAULT 60,
      last_checked_at TEXT,
      last_status TEXT DEFAULT 'pending',
      consecutive_failures INTEGER DEFAULT 0,
      uptime_pct REAL DEFAULT 100.0,
      project TEXT DEFAULT 'default',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_test_genome (
      id TEXT PRIMARY KEY,
      flow_name TEXT NOT NULL,
      target_url TEXT, target_app TEXT,
      fitness_score REAL DEFAULT 0.5,
      bug_catch_count INTEGER DEFAULT 0,
      false_positive_count INTEGER DEFAULT 0,
      run_count INTEGER DEFAULT 0,
      generation INTEGER DEFAULT 1,
      parent_flow_name TEXT,
      mutation_type TEXT,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_bug_resonance (
      id TEXT PRIMARY KEY,
      pattern_name TEXT NOT NULL,
      trigger_conditions_json TEXT NOT NULL,
      bug_type TEXT,
      confidence REAL DEFAULT 0.7,
      times_confirmed INTEGER DEFAULT 1,
      source_bug_ids_json TEXT DEFAULT '[]',
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_bug_pattern_ledger (
      id TEXT PRIMARY KEY,
      pattern_type TEXT NOT NULL,
      co_occurrence_factor TEXT,
      occurrence_count INTEGER DEFAULT 1,
      last_occurrence TEXT,
      projects_affected_json TEXT DEFAULT '[]',
      insight TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_behavior_oracle (
      id TEXT PRIMARY KEY,
      target_url TEXT, target_app TEXT,
      flow_name TEXT NOT NULL,
      step_name TEXT NOT NULL,
      expected_state_json TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      observations_count INTEGER DEFAULT 1,
      last_confirmed_at TEXT,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_api_contracts (
      id TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      expected_status_codes_json TEXT DEFAULT '[200]',
      response_schema_json TEXT,
      avg_response_ms REAL,
      threshold_ms REAL DEFAULT 500.0,
      project TEXT DEFAULT 'default',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
} catch(e) {
  console.error("[OWL QA Schema] Failed to initialize QA tables:", e);
}

try {
  db.exec("ALTER TABLE memory_programs ADD COLUMN inherited INTEGER DEFAULT 0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE memory_programs ADD COLUMN donor_project TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE memory_programs ADD COLUMN transplant_confidence REAL DEFAULT 1.0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE memory_programs ADD COLUMN template_id TEXT;");
} catch(e) {}

try {
  db.exec("ALTER TABLE project_constitution ADD COLUMN inherited INTEGER DEFAULT 0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE project_constitution ADD COLUMN donor_project TEXT;");
} catch(e) {}
try {
  db.exec("ALTER TABLE project_constitution ADD COLUMN transplant_confidence REAL DEFAULT 1.0;");
} catch(e) {}
try {
  db.exec("ALTER TABLE project_constitution ADD COLUMN template_id TEXT;");
} catch(e) {}

let synapticConstants = {
  gravity_decay: 0.15,
  resonance_stiffness: 0.6,
  resonance_damping: 0.2,
  compression_threshold: 0.3
};

function initSynapticConstants() {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM synaptic_constants").get()?.cnt || 0;
  if (count === 0) {
    for (const [k, v] of Object.entries(synapticConstants)) {
      db.prepare("INSERT INTO synaptic_constants (name, value) VALUES (?, ?)").run(k, v);
    }
  } else {
    const rows = db.prepare("SELECT * FROM synaptic_constants").all();
    for (const r of rows) {
      if (synapticConstants[r.name] !== undefined) {
        synapticConstants[r.name] = r.value;
      }
    }
  }
}
initSynapticConstants();

function runSelfOptimization(projectId = "default") {
  const now = new Date().toISOString();
  let stats;
  try {
    stats = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success FROM pheromone_trails WHERE project = ?").get(projectId);
  } catch(e) {}
  const currentMetric = stats && stats.total > 0 ? stats.success / stats.total : 0.5;

  for (const [k, v] of Object.entries(synapticConstants)) {
    if (k === 'resonance_stiffness' || k === 'resonance_damping') continue;

    const lastMetric = getSynapticConstant(k + "_last_metric", -1.0);
    const lastDirection = getSynapticConstant(k + "_direction", 1.0);
    let direction = lastDirection;

    if (currentMetric < lastMetric) {
      direction = -lastDirection;
      db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)").run(k + "_direction", direction);
    }

    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)").run(k + "_last_metric", currentMetric);

    const perturbation = direction * 0.05 * v;
    let newValue = v + perturbation;
    newValue = Math.max(0.1, Math.min(2.0, newValue));

    synapticConstants[k] = newValue;
    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)").run(k, newValue);
  }
}

function checkHallucinations(agentClaim, projectId = "default") {
  const facts = db.prepare("SELECT content, confidence FROM semantic_memories WHERE project = ? AND is_active = 1").all(projectId);
  const now = new Date().toISOString();
  
  const contradictions = [];
  for (const f of facts) {
    const similarity = calculateSimilarity(agentClaim, f.content);
    if (similarity > 0.45) {
      const neg = ["no", "not", "disabled", "remove", "changed", "false", "never"];
      const claimNeg = neg.some(w => agentClaim.toLowerCase().includes(w));
      const factNeg = neg.some(w => f.content.toLowerCase().includes(w));
      
      if (claimNeg !== factNeg) {
        const id = generateId(agentClaim, "hallucination");
        const discrepancy = similarity;
        const correction = `[TURING FIREWALL CORRECTION]: Ground truth dictates "${f.content}". Claim contradicts this.`;
        
        db.prepare(`
          INSERT OR IGNORE INTO hallucination_registry (id, agent_claim, ground_truth, discrepancy_score, correction_injected, project, detected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, agentClaim, f.content, discrepancy, correction, projectId, now);
        
        // Log in session_behavior_log
        try {
          const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
          const currentSessionId = lastSession ? lastSession.id : 'default_session';
          db.prepare(`
            INSERT INTO session_behavior_log (id, session_id, event_type, contradiction_fired, timestamp)
            VALUES (?, ?, 'contradiction', 1, ?)
          `).run(generateId('contra_' + id + now, 'behavior'), currentSessionId, now);
        } catch(e) {}
        
        contradictions.push({
          type: "hallucination",
          message: correction,
          claim: agentClaim,
          ground_truth: f.content
        });
      }
    }
  }
  return contradictions;
}

function reconsolidateMemory(memId, emotionalContext = { valence: 0, arousal: 0 }) {
  const now = new Date().toISOString();
  const mem = db.prepare("SELECT strength, emotional_valence, emotional_arousal FROM episodic_memories WHERE id = ?").get(memId);
  if (!mem) return;
  
  const valenceDrift = emotionalContext.valence * 0.02;
  const arousalDrift = emotionalContext.arousal * 0.02;
  
  const previousStrength = mem.strength;
  const newStrength = Math.min(5.0, mem.strength + 0.05);
  
  db.prepare(`
    UPDATE episodic_memories
    SET strength = ?, emotional_valence = MIN(1.0, MAX(-1.0, emotional_valence + ?)),
        emotional_arousal = MIN(1.0, MAX(0.0, emotional_arousal + ?)), updated_at = ?
    WHERE id = ?
  `).run(newStrength, valenceDrift, arousalDrift, now, memId);
  
  db.prepare(`
    INSERT INTO reconsolidation_log (memory_id, valence_drift, arousal_drift, previous_strength, new_strength, recalled_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(memId, valenceDrift, arousalDrift, previousStrength, newStrength, now);
}

function runCargoCultDetector(activeFile, codeSnippet, projectId = "default") {
  if (!activeFile || !codeSnippet || codeSnippet.length < 50) return null;
  const hash = crypto.createHash("sha256").update(codeSnippet).digest("hex").slice(0, 16);
  const now = new Date().toISOString();
  
  const existing = db.prepare("SELECT id FROM cargo_cult_registry WHERE code_snippet_hash = ?").get(hash);
  if (existing) return null;
  
  const fileKey = activeFile.replace(/\\/g, "/");
  const memories = db.prepare(`
    SELECT em.id, em.content FROM episodic_memories em
    JOIN memory_code_links mcl ON mcl.memory_id = em.id
    WHERE mcl.code_node_id LIKE ? AND em.project = ?
  `).all(`%${fileKey}%`, projectId);
  
  const hasRationale = memories.some(m => 
    m.content.toLowerCase().includes("rationale") || 
    m.content.toLowerCase().includes("why") || 
    m.content.toLowerCase().includes("reason") ||
    m.content.toLowerCase().includes("because")
  );
  
  if (!hasRationale) {
    const id = generateId(codeSnippet, "cargo_cult");
    db.prepare(`
      INSERT INTO cargo_cult_registry (id, code_snippet_hash, file_path, paste_detected_at, has_rationale_memory, risk_level)
      VALUES (?, ?, ?, ?, 0, 'medium')
    `).run(id, hash, fileKey, now);
    
    // Log to session_behavior_log
    try {
      const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
      const currentSessionId = lastSession ? lastSession.id : 'default_session';
      db.prepare(`
        INSERT INTO session_behavior_log (id, session_id, event_type, timestamp)
        VALUES (?, ?, 'cargo_cult', ?)
      `).run(generateId('cargo_' + id + now, 'behavior'), currentSessionId, now);
    } catch(e) {}

    return {
      type: "cargo_cult",
      message: `⚠️ FEYNMAN CARGO CULT WARNING: Snippet in [${activeFile}] pasted without recorded rationale. Store why you are using this pattern.`
    };
  }
  return null;
}

function getCognitiveBiorhythmStatus() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  const row = db.prepare("SELECT avg_error_rate, risk_multiplier FROM cognitive_biorhythm WHERE hour_of_day = ? AND day_of_week = ?").get(currentHour, currentDay);
  
  let multiplier = 1.0;
  if (row) {
    multiplier = row.risk_multiplier;
  }
  
  if (currentDay === 5 && currentHour >= 15 && currentHour <= 17) {
    multiplier = 3.2; // Friday afternoon high-risk window
  }
  
  if (multiplier > 2.0) {
    return {
      high_risk: true,
      risk_multiplier: multiplier,
      message: `⚠️ PYTHAGORAS: You are in your historical crash window (error rate ${multiplier}x higher). Defer critical deploys.`
    };
  }
  return { high_risk: false, risk_multiplier: multiplier };
}

function updateBiorhythmStats() {
  const now = new Date().toISOString();
  const errors = db.prepare("SELECT created_at FROM episodic_memories WHERE event_type = 'error'").all();
  const allMems = db.prepare("SELECT created_at FROM episodic_memories").all();
  
  const errorCounts = {};
  const totalCounts = {};
  
  for (const e of errors) {
    try {
      const dt = new Date(e.created_at);
      const key = `${dt.getDay()}_${dt.getHours()}`;
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    } catch(err) {}
  }
  
  for (const m of allMems) {
    try {
      const dt = new Date(m.created_at);
      const key = `${dt.getDay()}_${dt.getHours()}`;
      totalCounts[key] = (totalCounts[key] || 0) + 1;
    } catch(err) {}
  }
  
  for (const [key, total] of Object.entries(totalCounts)) {
    const [day, hour] = key.split("_").map(Number);
    const errs = errorCounts[key] || 0;
    const rate = errs / total;
    const avgRate = errors.length / Math.max(1, allMems.length);
    const multiplier = rate > avgRate ? (rate / avgRate) : 1.0;
    
    db.prepare(`
      INSERT INTO cognitive_biorhythm (hour_of_day, day_of_week, historical_error_count, historical_success_count, avg_error_rate, risk_multiplier, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hour_of_day, day_of_week) DO UPDATE SET
        historical_error_count = excluded.historical_error_count,
        avg_error_rate = excluded.avg_error_rate,
        risk_multiplier = excluded.risk_multiplier,
        updated_at = excluded.updated_at
    `).run(hour, day, errs, total - errs, rate, multiplier, now);
  }
}

function autoEvolveMetaPrograms(projectId = "default") {
  const now = new Date().toISOString();
  const bugs = db.prepare("SELECT bug_type, description, file_path FROM code_bugs WHERE project = ? AND is_active = 1").all(projectId);
  if (bugs.length < 2) return;
  
  const counts = {};
  for (const b of bugs) {
    counts[b.bug_type] = (counts[b.bug_type] || 0) + 1;
  }
  
  for (const [bugType, count] of Object.entries(counts)) {
    if (count >= 2) {
      const progName = `vaccine_${bugType.toLowerCase()}`;
      const existing = db.prepare("SELECT id FROM memory_programs WHERE name = ?").get(progName);
      if (existing) continue;
      
      const progCode = `
        (function(code) {
          const lowerCode = code.toLowerCase();
          if (lowerCode.includes("error") || lowerCode.includes("fail")) {
            return { triggered: true, score: 0.8, message: "Potential bug pattern of type ${bugType} detected." };
          }
          return { triggered: false };
        })
      `;
      const id = generateId(progCode, "meta");
      db.prepare(`
        INSERT INTO memory_programs (id, name, description, program_code, project, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, progName, `Auto-evolved vaccine for ${bugType} bugs`, progCode, projectId, now, now);
    }
  }
}

function queryCrossProjectKnowledge(query, currentProject = "default") {
  const rows = db.prepare("SELECT content, project, salience FROM episodic_memories WHERE project != ? AND is_active = 1 LIMIT 3").all(currentProject);
  const matches = [];
  for (const r of rows) {
    const sim = calculateSimilarity(query, r.content);
    if (sim > 0.4) {
      matches.push({
        type: "cross_project",
        source_project: r.project,
        content: r.content,
        message: `🌐 CROSS-PROJECT TRANSFER: Identical pattern solved in project [${r.project}]: "${r.content.substring(0, 100)}..."`
      });
    }
  }
  return matches;
}

function crystallizeSpecificKnowledge(content, projectId = "default") {
  const isWeb = content.includes("http://") || content.includes("https://") || content.includes("www.");
  if (content.length > 100 && !isWeb) {
    const id = generateId(content, "crystal");
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO specific_knowledge_crystals (id, domain, knowledge_content, uniqueness_score, moat_classification, times_applied, created_at)
      VALUES (?, 'architectural_wisdom', ?, 0.85, 'heuristic', 1, ?)
    `).run(id, content, now);
    return id;
  }
  return null;
}

function initProjectConstitution(projectId = "default") {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM project_constitution").get()?.cnt || 0;
  if (count === 0) {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project_constitution (id, article_number, title, rule_definition, is_mandatory, created_at) VALUES (?, 1, 'Data Security', 'Sensitive credentials and keys must never be stored in plaintext.', 1, ?)").run("const_1", now);
    db.prepare("INSERT INTO project_constitution (id, article_number, title, rule_definition, is_mandatory, created_at) VALUES (?, 2, 'Error Safety', 'Async calls must always be wrapped in try-catch blocks.', 1, ?)").run("const_2", now);
    db.prepare("INSERT INTO project_constitution (id, article_number, title, rule_definition, is_mandatory, created_at) VALUES (?, 3, 'Clean Code', 'Function size should not exceed 100 lines.', 0, ?)").run("const_3", now);
  }
}

function checkConstitutionalRules(codeSnippet, projectId = "default") {
  if (!codeSnippet) return [];
  initProjectConstitution(projectId);
  const rules = db.prepare("SELECT * FROM project_constitution WHERE is_mandatory = 1").all();
  
  const violations = [];
  const now = new Date().toISOString();
  for (const r of rules) {
    let violated = false;
    if (r.article_number === 1) {
      if (codeSnippet.match(/(?:key|password|secret|token)\s*=\s*['"][a-zA-Z0-9_-]{16,}['"]/i)) {
        violated = true;
      }
    }
    if (r.article_number === 2) {
      if (codeSnippet.includes("async ") && !codeSnippet.includes("try") && !codeSnippet.includes("catch")) {
        violated = true;
      }
    }
    if (violated) {
      violations.push({
        type: "constitutional_violation",
        message: `⚖️ CONSTITUTIONAL VIOLATION: Article ${r.article_number} — '${r.rule_definition}'`
      });
      // Log to session_behavior_log
      try {
        const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
        const currentSessionId = lastSession ? lastSession.id : 'default_session';
        db.prepare(`
          INSERT INTO session_behavior_log (id, session_id, event_type, constitution_violated, timestamp)
          VALUES (?, ?, 'constitution_violation', 1, ?)
        `).run(generateId('const_viol_' + r.article_number + now, 'behavior'), currentSessionId, now);
      } catch(e) {}
    }
  }
  return violations;
}

function captureTopologySnapshot(projectId) {
  try {
    const nodeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_nodes WHERE project = ?").get(projectId)?.cnt || 0;
    const edgeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_edges JOIN code_nodes ON code_edges.source_id = code_nodes.id WHERE code_nodes.project = ?").get(projectId)?.cnt || 0;
    
    const avgGravity = db.prepare("SELECT AVG(activation) as avg_grav FROM code_node_activation JOIN code_nodes ON code_node_activation.node_id = code_nodes.id WHERE code_nodes.project = ?").get(projectId)?.avg_grav || 0.0;
    let centroidNode = db.prepare("SELECT filepath FROM code_nodes JOIN code_node_activation ON code_nodes.id = code_node_activation.node_id WHERE code_nodes.project = ? ORDER BY code_node_activation.activation DESC LIMIT 1").get(projectId);
    if (!centroidNode) {
      centroidNode = db.prepare("SELECT filepath FROM code_nodes WHERE project = ? ORDER BY bug_count DESC, edit_count DESC LIMIT 1").get(projectId);
    }
    const hotspotCentroid = centroidNode ? centroidNode.filepath : null;
    const complexityScore = nodeCount * 1.5 + edgeCount * 2.5 + (avgGravity * 10);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO code_topology_snapshots (project, node_count, edge_count, hotspot_centroid, avg_gravity, complexity_score, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, nodeCount, edgeCount, hotspotCentroid, avgGravity, complexityScore, now);
  } catch(e) {
    console.error("[captureTopologySnapshot ERROR]", e);
  }
}

function computeTopologyDiff(projectId) {
  try {
    const snapshots = db.prepare(`
      SELECT * FROM code_topology_snapshots 
      WHERE project = ? 
      ORDER BY captured_at DESC LIMIT 2
    `).all(projectId);
    
    if (snapshots.length < 2) return null;
    const current = snapshots[0];
    const previous = snapshots[1];
    
    const nodeDiff = current.node_count - previous.node_count;
    const edgeDiff = current.edge_count - previous.edge_count;
    const complexityDiff = current.complexity_score - previous.complexity_score;
    const centroidChanged = current.hotspot_centroid !== previous.hotspot_centroid;
    
    return {
      node_diff: nodeDiff,
      edge_diff: edgeDiff,
      complexity_diff: complexityDiff,
      centroid_changed: centroidChanged,
      current_centroid: current.hotspot_centroid,
      previous_centroid: previous.hotspot_centroid
    };
  } catch(e) {
    return null;
  }
}

function generateCognitiveMirrorReport(projectId) {
  try {
    const now = new Date().toISOString();
    
    // 1. Engineering Personality
    const totalViolations = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE event_type = 'constitution_violation'").get()?.cnt || 0;
    const totalReversals = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE event_type = 'vaccine_dismissed'").get()?.cnt || 0;
    const totalPerceives = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE event_type = 'perceive'").get()?.cnt || 0;
    
    let personality = "Iterative Builder";
    if (totalReversals > totalViolations && totalReversals > 2) {
      personality = "Skeptical Architect";
    } else if (totalViolations > 3) {
      personality = "Rapid Prototype Developer";
    } else if (totalPerceives > 20) {
      personality = "Reflective Analyst";
    }
    
    // 2. Three Blind Spots
    const bugs = db.prepare("SELECT bug_type, COUNT(*) as cnt FROM code_bugs WHERE project = ? GROUP BY bug_type ORDER BY cnt DESC LIMIT 3").all(projectId);
    const blindSpots = bugs.map(b => `${b.bug_type || 'Syntax Errors'} (occurred ${b.cnt} times)`);
    while (blindSpots.length < 3) {
      blindSpots.push("No significant blind spots identified yet.");
    }
    
    // 3. Danger Windows
    const logs = db.prepare("SELECT timestamp FROM session_behavior_log WHERE event_type = 'constitution_violation' OR error_encountered IS NOT NULL").all();
    const timeCounts = {};
    logs.forEach(l => {
      try {
        const d = new Date(l.timestamp);
        const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
        const hour = d.getHours();
        const key = `${day} ${hour}:00-${hour+1}:00`;
        timeCounts[key] = (timeCounts[key] || 0) + 1;
      } catch(e) {}
    });
    const dangerWindows = Object.entries(timeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(entry => `${entry[0]} (frequency: ${entry[1]} errors)`);
    while (dangerWindows.length < 3) {
      dangerWindows.push("Insufficient error history to map danger windows.");
    }
    
    // 4. Moat Skills
    const crystals = db.prepare("SELECT domain, knowledge_content, times_applied FROM specific_knowledge_crystals ORDER BY times_applied DESC LIMIT 3").all();
    const moatSkills = crystals.map(c => `${c.domain}: ${c.knowledge_content.substring(0, 50)}... (applied ${c.times_applied} times)`);
    while (moatSkills.length < 3) {
      moatSkills.push("Developing custom domain knowledge base.");
    }
    
    // 5. Mirror Score
    const autopsies = db.prepare("SELECT content FROM episodic_memories WHERE event_type = 'session_autopsy' AND project = ?").all(projectId);
    let sumBis = 0;
    autopsies.forEach(a => {
      const match = a.content.match(/BIS:\s*(\d+)/);
      if (match) sumBis += parseInt(match[1]);
    });
    const avgBis = autopsies.length > 0 ? sumBis / autopsies.length : 85;
    const mirrorScore = Math.min(100, Math.max(0, avgBis));
    
    const report = {
      personality,
      blind_spots: blindSpots,
      danger_windows: dangerWindows,
      moat_skills: moatSkills,
      mirror_score: Math.round(mirrorScore),
      generated_at: now
    };
    
    const memContent = `COGNITIVE MIRROR REPORT\nScore: ${report.mirror_score}/100 | Personality: ${personality}\nBlind Spots:\n- ${blindSpots.join('\n- ')}\nDanger Windows:\n- ${dangerWindows.join('\n- ')}\nMoat Skills:\n- ${moatSkills.join('\n- ')}`;
    const memId = generateId(memContent, projectId);
    
    db.prepare(`
      INSERT INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
      VALUES (?, ?, 'cognitive_mirror_report', ?, 0.0, 0.0, 0.95, 1.0, ?, ?)
    `).run(memId, memContent, projectId, now, now);
    
    return report;
  } catch(e) {
    console.error("[generateCognitiveMirrorReport ERROR]", e);
    return null;
  }
}

function runMemoryInheritance(projectId) {
  try {
    const checkInherited = db.prepare("SELECT COUNT(*) as cnt FROM episodic_memories WHERE project = ? AND inherited = 1").get(projectId)?.cnt || 0;
    if (checkInherited > 0) return { status: "already_inherited" };

    const projects = db.prepare("SELECT DISTINCT project FROM episodic_memories WHERE project != ?").all(projectId).map(p => p.project);
    if (projects.length === 0) return { status: "no_donors_available" };

    const currentNodeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_nodes WHERE project = ?").get(projectId)?.cnt || 0;
    const currentEdgeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_edges JOIN code_nodes ON code_edges.source_id = code_nodes.id WHERE code_nodes.project = ?").get(projectId)?.cnt || 0;
    const currentDensity = currentNodeCount > 0 ? currentEdgeCount / currentNodeCount : 0;
    
    const currentRows = db.prepare("SELECT filepath FROM code_nodes WHERE project = ?").all(projectId);
    const currentExts = {};
    currentRows.forEach(r => {
      const ext = r.filepath.split('.').pop();
      currentExts[ext] = (currentExts[ext] || 0) + 1;
    });
    
    const currentDna = { extensions: currentExts, density: currentDensity, nodeCount: currentNodeCount };

    let bestDonor = null;
    let bestScore = -1;

    for (const proj of projects) {
      const pNodeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_nodes WHERE project = ?").get(proj)?.cnt || 0;
      const pEdgeCount = db.prepare("SELECT COUNT(*) as cnt FROM code_edges JOIN code_nodes ON code_edges.source_id = code_nodes.id WHERE code_nodes.project = ?").get(proj)?.cnt || 0;
      const pDensity = pNodeCount > 0 ? pEdgeCount / pNodeCount : 0;
      
      const pRows = db.prepare("SELECT filepath FROM code_nodes WHERE project = ?").all(proj);
      const pExts = {};
      pRows.forEach(r => {
        const ext = r.filepath.split('.').pop();
        pExts[ext] = (pExts[ext] || 0) + 1;
      });
      
      const pDna = { extensions: pExts, density: pDensity, nodeCount: pNodeCount };

      const allExts = new Set([...Object.keys(currentDna.extensions), ...Object.keys(pDna.extensions)]);
      let dot = 0, norm1 = 0, norm2 = 0;
      allExts.forEach(ext => {
        const v1 = currentDna.extensions[ext] || 0;
        const v2 = pDna.extensions[ext] || 0;
        dot += v1 * v2;
        norm1 += v1 * v1;
        norm2 += v2 * v2;
      });
      const densitySim = 1 / (1 + Math.abs(currentDna.density - pDna.density));
      const extSim = norm1 > 0 && norm2 > 0 ? dot / (Math.sqrt(norm1) * Math.sqrt(norm2)) : 0;
      const score = (extSim * 0.7) + (densitySim * 0.3);

      if (score > bestScore) {
        bestScore = score;
        bestDonor = proj;
      }
    }

    if (!bestDonor || bestScore < 0.2) {
      let maxMems = -1;
      for (const proj of projects) {
        const cnt = db.prepare("SELECT COUNT(*) as cnt FROM episodic_memories WHERE project = ?").get(proj)?.cnt || 0;
        if (cnt > maxMems) {
          maxMems = cnt;
          bestDonor = proj;
        }
      }
      bestScore = 0.5;
    }

    if (!bestDonor) return { status: "no_donor_found" };

    const now = new Date().toISOString();
    let transplantedCount = 0;

    const vaccines = db.prepare(`
      SELECT * FROM memory_programs 
      WHERE project = ? 
      ORDER BY (true_positive_count * 1.0) / (true_positive_count + false_positive_count + 1) DESC 
      LIMIT 5
    `).all(bestDonor);
    vaccines.forEach(v => {
      try {
        db.prepare(`
          INSERT INTO memory_programs (id, name, description, program_code, compiled_from_memory_ids, execution_count, true_positive_count, false_positive_count, precision_score, project, inherited, donor_project, transplant_confidence, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0.5, ?, 1, ?, ?, ?, ?)
        `).run(v.id + '_inherited_' + projectId, v.name, v.description, v.program_code, v.compiled_from_memory_ids, projectId, bestDonor, bestScore, now, now);
        transplantedCount++;
      } catch(e) {}
    });

    const rules = db.prepare(`
      SELECT * FROM project_constitution 
      WHERE donor_project = ? OR (donor_project IS NULL AND inherited = 0)
      LIMIT 3
    `).all(bestDonor);
    const maxArticleRow = db.prepare("SELECT MAX(article_number) as max_art FROM project_constitution").get();
    let currentMaxArticle = maxArticleRow ? (maxArticleRow.max_art || 0) : 0;
    rules.forEach(r => {
      try {
        currentMaxArticle++;
        db.prepare(`
          INSERT INTO project_constitution (id, article_number, title, rule_definition, is_mandatory, inherited, donor_project, transplant_confidence, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(r.id + '_inherited_' + projectId, currentMaxArticle, r.title, r.rule_definition, r.is_mandatory, bestDonor, bestScore, now);
        transplantedCount++;
      } catch(e) {}
    });

    const researchMems = db.prepare(`
      SELECT * FROM episodic_memories 
      WHERE project = ? AND event_type = 'research' 
      ORDER BY salience DESC, access_count DESC 
      LIMIT 3
    `).all(bestDonor);
    researchMems.forEach(m => {
      try {
        db.prepare(`
          INSERT INTO episodic_memories (id, content, event_type, project, location, emotional_valence, emotional_arousal, salience, strength, developmental_stage, access_count, source, is_active, inherited, donor_project, transplant_confidence, created_at, updated_at)
          VALUES (?, ?, 'research', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?)
        `).run(m.id + '_inherited_' + projectId, m.content, projectId, m.location, m.emotional_valence, m.emotional_arousal, m.salience, m.strength, m.developmental_stage, m.source, m.is_active, bestDonor, bestScore, now, now);
        transplantedCount++;
      } catch(e) {}
    });

    return { status: "inherited_successfully", donor: bestDonor, confidence: bestScore, transplanted: transplantedCount };
  } catch(e) {
    console.error("[runMemoryInheritance ERROR]", e);
    return { status: "error", message: e.message };
  }
}

function runPostHocQueryFitnessVerification(projectId) {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const memories = db.prepare(`
      SELECT id, template_id, project, created_at 
      FROM episodic_memories 
      WHERE template_id IS NOT NULL 
        AND created_at < ? 
        AND event_type = 'research'
    `).all(threeDaysAgo);

    for (const mem of memories) {
      const trail = db.prepare(`
        SELECT outcome FROM pheromone_trails 
        WHERE project = ? AND created_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(mem.project, mem.created_at);

      if (trail && (trail.outcome === 'success' || trail.outcome === 'failure')) {
        const delta = trail.outcome === 'success' ? 0.05 : -0.05;
        db.prepare(`
          UPDATE research_query_fitness 
          SET avg_result_quality = MIN(1.0, MAX(0.0, avg_result_quality + ?)) 
          WHERE query_template = ?
        `).run(delta, mem.template_id);
      }
    }

    db.prepare(`
      INSERT INTO fossil_record (entity_type, original_data, reason, timestamp)
      SELECT 'query_template', query_template, 'Deprecated due to low fitness score: ' || avg_result_quality, ?
      FROM research_query_fitness
      WHERE avg_result_quality < 0.2 AND usage_count > 5
    `).run(new Date().toISOString());

    db.prepare(`
      DELETE FROM research_query_fitness
      WHERE avg_result_quality < 0.2 AND usage_count > 5
    `).run();

  } catch(e) {
    console.error("[runPostHocQueryFitnessVerification ERROR]", e);
  }
}





function storeCodexMemory(content, modality = "text", rawContent = null, linkedCodeNodes = [], projectId = "default") {
  const id = generateId(content || "codex", modality);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO codex_memories (id, memory_type, raw_content, extracted_text, linked_code_nodes, project, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, modality, rawContent, content, JSON.stringify(linkedCodeNodes), projectId, now);
  
  db.prepare(`
    INSERT INTO episodic_memories (id, content, event_type, project, salience, strength, source, created_at, updated_at)
    VALUES (?, ?, 'insight', ?, 0.8, 1.0, 'codex', ?, ?)
  `).run(id, `[CODEX ${modality.toUpperCase()}] ${content}`, projectId, now, now);
  
  return id;
}

function callPythonTool(toolName, args) {
  try {
    const input = JSON.stringify({ tool: toolName, arguments: args });
    const runnerPath = path.join(__dirname, "owl_python_runner.py");
    const result = execSync(`python "${runnerPath}"`, {
      input: input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    return JSON.parse(result);
  } catch (err) {
    return { error: err.message };
  }
}


function calculateSimilarity(a, b) {
  const w1 = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const w2 = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const inter = new Set([...w1].filter(w => w2.has(w)));
  const union = new Set([...w1, ...w2]);
  return Math.min(1, inter.size / Math.max(union.size, 1));
}

function detectEmotionalSalience(t) {
  if (!t || typeof t !== "string") return { valence: 0, arousal: 0, salience: 0 };
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

function calculateRelativisticGravityWithObserver(activeNodeId, projectId, observerType = null, observerContext = null) {
  var memories = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(projectId);
  var ranked = [];
  var now = Date.now();
  var errorCount = db.prepare("SELECT COUNT(*) as cnt FROM episodic_memories WHERE project = ? AND event_type = 'error'").get(projectId);
  var errorMass = errorCount ? Math.min(errorCount.cnt / 50, 1.0) : 0;

  // Extract filenames from observer context if available
  let observerFiles = [];
  if (observerType && observerContext) {
    let matches = [];
    if (observerType === "open_pr_diff") {
      matches = observerContext.match(/(?:[ab]\/)?([a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+)/g) || [];
    } else {
      matches = observerContext.match(/([a-zA-Z0-9_\-\/]+\.(?:py|js|ts|tsx|jsx|json|yaml|sql|md|txt))/g) || [];
    }
    observerFiles = matches.map(m => {
      const parts = m.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1];
    });
  }

  for (var mem of memories) {
    var minDistance = 4;
    var curvatureObserver = 0.0;
    
    // Check observer file links first
    if (observerFiles.length > 0) {
      var links = db.prepare("SELECT code_node_id FROM memory_code_links WHERE memory_id = ?").all(mem.id);
      for (var link of links) {
        const linkBase = link.code_node_id.replace(/\\/g, "/").split("/").pop().split("::")[0];
        if (observerFiles.includes(linkBase)) {
          minDistance = 0;
          curvatureObserver = 1.0;
          break;
        }
      }
    }

    if (activeNodeId && minDistance > 0) {
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
    var gravity = (curvatureSpacetime * mem.salience + curvatureEmotional * 0.20 + curvatureSalience * 0.20 + curvatureError * 0.10 + curvatureRecency * 0.10 + curvatureObserver * 0.40) * timeDilationFactor;
    ranked.push({ 
      id: mem.id, 
      content: mem.content, 
      event_type: mem.event_type, 
      gravity: Math.round(gravity * 1000) / 1000, 
      spatial_distance: minDistance, 
      curvature_tensor: { 
        spacetime: Math.round(curvatureSpacetime * 1000) / 1000, 
        emotional: Math.round(curvatureEmotional * 1000) / 1000, 
        salience: Math.round(curvatureSalience * 1000) / 1000, 
        errorMass: Math.round(curvatureError * 1000) / 1000, 
        recency: Math.round(curvatureRecency * 1000) / 1000,
        observerWarp: Math.round(curvatureObserver * 1000) / 1000
      }, 
      time_dilation_factor: Math.round(timeDilationFactor * 1000) / 1000, 
      created_at: mem.created_at 
    });
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

function getSynapticConstant(name, defaultValue) {
  try {
    const row = db.prepare("SELECT value FROM synaptic_constants WHERE name = ?").get(name);
    return row ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function propagateTeslaResonance(activeNodeId, steps = 15, stiffnessOverride = null, dampingOverride = null, skipDbWrite = false, projectId = 'default') {
  if (!activeNodeId || (Array.isArray(activeNodeId) && activeNodeId.length === 0)) return [];

  // Fetch all nodes in the codebase
  const allNodes = db.prepare("SELECT id FROM code_nodes").all().map(n => n.id);
  if (allNodes.length === 0) return [];

  // Initialize displacements (u) and velocities (v)
  const u = {};
  const v = {};
  for (const id of allNodes) {
    u[id] = 0.0;
    v[id] = 0.0;
  }

  // Inject initial impulse (focus event) at activeNodeId
  if (Array.isArray(activeNodeId)) {
    for (const node of activeNodeId) {
      if (u[node] !== undefined) {
        u[node] = 10.0;
      }
    }
  } else if (activeNodeId) {
    if (u[activeNodeId] !== undefined) {
      u[activeNodeId] = 10.0;
    }
  }

  // Fetch weights of code_edges & synaptic_weights
  const edges = db.prepare("SELECT source_id, target_id, 1.0 as weight FROM code_edges").all();
  const synWeights = db.prepare("SELECT source_id, target_id, attention_weight as weight FROM synaptic_weights").all();
  const allEdges = edges.concat(synWeights);

  // Group edges for fast adjacency lookup
  const adj = {};
  for (const id of allNodes) adj[id] = [];
  for (const e of allEdges) {
    if (adj[e.source_id] && adj[e.target_id]) {
      adj[e.source_id].push({ target: e.target_id, weight: e.weight });
      adj[e.target_id].push({ target: e.source_id, weight: e.weight }); // bi-directional springs
    }
  }

  // Wave simulation constants
  const dt = 0.15;
  const stiffness = stiffnessOverride !== null ? stiffnessOverride : getSynapticConstant(`${projectId}:resonance_stiffness`, getSynapticConstant('resonance_stiffness', 0.6));
  const damping = dampingOverride !== null ? dampingOverride : getSynapticConstant(`${projectId}:resonance_damping`, getSynapticConstant('resonance_damping', 0.2));

  // Solve spring-mass-damper wave propagation
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

  // Store final absolute displacements as the activation levels
  if (!skipDbWrite) {
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
  }

  // Find memories associated with active nodes
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

  try {
    const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
    const currentSessionId = lastSession ? lastSession.id : 'default_session';
    db.prepare(`
      INSERT INTO session_behavior_log (id, session_id, event_type, file_touched, error_encountered, timestamp)
      VALUES (?, ?, 'error', ?, ?, ?)
    `).run(generateId('error_' + now, 'behavior'), currentSessionId, filepath, errorMessage.slice(0, 200), now);
  } catch(e) {}

  return { status: "success", memory_id: memId, codeNodeId, surpriseScore };
}

// ═══ Innovation E: Memory Programs (Executable Vaccines) ═══
function simulateMemoryPrograms(codeSnippet, projectId = "default") {
  if (!codeSnippet) return [];
  const programs = db.prepare("SELECT * FROM memory_programs WHERE project = ? AND precision_score > 0.4").all(projectId);
  
  const results = [];
  for (const prog of programs) {
    try {
      const sandbox = { code: codeSnippet, result: null };
      vm.createContext(sandbox);
      const script = new vm.Script(`
        const program = ${prog.program_code};
        result = program(code);
      `);
      script.runInContext(sandbox, { timeout: 50 }); // 50ms hard limit
      
      if (sandbox.result && sandbox.result.triggered) {
        results.push({
          program_name: prog.name,
          risk_score: sandbox.result.score || 0.8,
          message: sandbox.result.message || prog.description,
          program_id: prog.id
        });
        
        // Log to session_behavior_log
        try {
          const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
          const currentSessionId = lastSession ? lastSession.id : 'default_session';
          const nowStr = new Date().toISOString();
          db.prepare(`
            INSERT INTO session_behavior_log (id, session_id, event_type, vaccine_fired, timestamp)
            VALUES (?, ?, 'vaccine_fired', ?, ?)
          `).run(generateId('fire_' + prog.id + nowStr, 'behavior'), currentSessionId, prog.id, nowStr);
        } catch(e) {}

        db.prepare("UPDATE memory_programs SET execution_count = execution_count + 1 WHERE id = ?").run(prog.id);
      } else {
        db.prepare("UPDATE memory_programs SET execution_count = execution_count + 1 WHERE id = ?").run(prog.id);
      }
    } catch (e) {
      console.error(`[OWL MEMORY] Memory program '${prog.name}' failed:`, e.message);
    }
  }
  return results.sort((a, b) => b.risk_score - a.risk_score);
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
    // 1. Direct links to this file/node
    const historicalFailures = db.prepare(`
      SELECT em.content, em.created_at FROM episodic_memories em
      JOIN memory_code_links mcl ON mcl.memory_id = em.id
      WHERE em.project = ? AND mcl.code_node_id LIKE ? AND em.event_type = 'error'
    `).all(projectId, `%${relPath}%`);

    // 2. Project-wide keyword matches
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
        at: ass.type,
        ax: ass.text,
        ce: fail.content,
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
          pn: steward.package_name,
          error_count: steward.error_count,
          use_count: steward.use_count,
          crash_rate: Math.round(crashRate * 100) + "%",
          tc: Math.round(trustCoefficient * 100) / 100,
          status: status,
          message: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`,
          warning: `Stewardship alert: [${steward.package_name}] has local crash rate of ${Math.round(crashRate * 100)}%. Avoid deploying without wrappers.`,
          cb: circuitBreakerProposal,
          circuit_breaker: circuitBreakerProposal
        });
      }
    } else {
      // ═══ Innovation G: Immunological Memory ═══
      // If we don't have data for this exact package, check its "family" (structural similarity via prefix)
      const prefix = imp.target_id.split(/[-/]/)[0];
      if (prefix && prefix.length > 3) {
        const family = db.prepare("SELECT package_name, error_count, use_count FROM dependency_stewardship WHERE package_name LIKE ? AND package_name != ?").all(`${prefix}%`, imp.target_id);
        
        let familyErrors = 0, familyUses = 0;
        for (const f of family) { familyErrors += f.error_count; familyUses += f.use_count; }
        
        if (familyUses > 0 && (familyErrors / familyUses) > 0.3) {
          alerts.push({
            package: imp.target_id,
            status: "immunological_warning",
            message: `Immunological Memory Alert: Though [${imp.target_id}] has no direct errors, its structural family '${prefix}-*' has a high crash rate (${Math.round((familyErrors/familyUses)*100)}%). Proceed with caution.`
          });
        }
      }
    }
  }
  return alerts;
}

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

// ═══════════════════════════════════════════════════════════════
// Innovation A: NEOCORTEX — Semantic Distillation Engine
// The hippocampus stores episodes. The neocortex distills patterns.
// This runs after every dream cycle, scanning episodic clusters
// and auto-generating semantic abstractions from recurring themes.
// ═══════════════════════════════════════════════════════════════
function distillateNeocortex(projectId) {
  const now = new Date().toISOString();
  const distilled = [];

  try {
    // Group episodic memories by event_type + active file cluster
    const episodics = db.prepare(
      "SELECT id, content, event_type, strength, emotional_valence FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 200"
    ).all(projectId);

    if (episodics.length < 3) return { status: 'insufficient_memories', count: episodics.length };

    // Group by event_type
    const byType = {};
    for (const m of episodics) {
      const t = m.event_type || 'observation';
      if (!byType[t]) byType[t] = [];
      byType[t].push(m);
    }

    for (const [eventType, mems] of Object.entries(byType)) {
      if (mems.length < 3) continue; // Need at least 3 episodes to distill a pattern

      // Find clusters: memories that share high word overlap
      const processed = new Set();
      for (let i = 0; i < mems.length; i++) {
        if (processed.has(mems[i].id)) continue;
        const cluster = [mems[i]];
        processed.add(mems[i].id);

        for (let j = i + 1; j < mems.length; j++) {
          if (processed.has(mems[j].id)) continue;
          if (calculateSimilarity(mems[i].content, mems[j].content) > 0.35) {
            cluster.push(mems[j]);
            processed.add(mems[j].id);
          }
        }

        if (cluster.length < 3) continue; // Not enough to form a pattern

        // Distill: find the longest common significant words
        const wordFreq = {};
        for (const m of cluster) {
          const words = m.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
          for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;
        }

        const patternWords = Object.entries(wordFreq)
          .filter(([, cnt]) => cnt >= Math.ceil(cluster.length * 0.5))
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([w]) => w);

        if (patternWords.length < 2) continue;

        // Build the distilled pattern sentence
        const avgValence = cluster.reduce((s, m) => s + m.emotional_valence, 0) / cluster.length;
        const tone = avgValence > 0.2 ? 'positive' : avgValence < -0.2 ? 'negative' : 'neutral';
        const pattern = `[${eventType.toUpperCase()} PATTERN — ${tone}] Recurring theme across ${cluster.length} episodes: ${patternWords.join(', ')}. Source IDs span ${cluster.length} distinct observations.`;

        const distId = generateId(pattern, projectId + '_neocortex');

        // Check if this pattern already exists (avoid duplication)
        const existing = db.prepare("SELECT id FROM semantic_distillations WHERE id = ?").get(distId);
        if (existing) {
          // Strengthen existing pattern
          db.prepare("UPDATE semantic_distillations SET strength = MIN(strength + 0.2, 5.0), updated_at = ? WHERE id = ?").run(now, distId);
          distilled.push({ id: distId, action: 'strengthened', pattern: pattern.slice(0, 80) });
        } else {
          const avgStrength = cluster.reduce((s, m) => s + (m.strength || 1), 0) / cluster.length;
          db.prepare(`
            INSERT INTO semantic_distillations (id, project, pattern, source_memory_ids, strength, fitness, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0.6, ?, ?)
          `).run(distId, projectId, pattern, JSON.stringify(cluster.map(m => m.id)), avgStrength * 1.3, now, now);

          // Also save to semantic_memories table (existing table) for recall integration
          db.prepare(`
            INSERT OR IGNORE INTO semantic_memories (id, content, concept_type, project, importance, confidence, is_active, created_at)
            VALUES (?, ?, 'neocortex_pattern', ?, ?, 0.8, 1, ?)
          `).run(distId, pattern, projectId, Math.min(avgStrength * 1.3, 3.0), now);

          distilled.push({ id: distId, action: 'created', cluster_size: cluster.length, pattern: pattern.slice(0, 80) });
        }
      }
    }

    return { status: 'completed', patterns_created_or_strengthened: distilled.length, distilled };
  } catch (err) {
    console.error('[OWL NEOCORTEX] Distillation failed:', err.message);
    return { status: 'failed', error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Innovation E: Memory Fitness Scoring (Darwinian selection)
// Runs after dream cycle. Memories with low fitness get archived.
// ═══════════════════════════════════════════════════════════════
// Helper for vaccine outcomes processing
function processVaccineOutcomes(projectId) {
  try {
    const unprocessed = db.prepare("SELECT * FROM session_behavior_log WHERE event_type = 'vaccine_fired' AND processed = 0").all();
    for (const log of unprocessed) {
      const dismissed = db.prepare("SELECT 1 FROM session_behavior_log WHERE session_id = ? AND event_type = 'vaccine_dismissed' AND vaccine_fired = ?").get(log.session_id, log.vaccine_fired);
      const sessionFailure = db.prepare("SELECT 1 FROM pheromone_trails WHERE project = ? AND outcome = 'failure' AND created_at >= ?").get(projectId, log.timestamp);
      
      if (dismissed || sessionFailure) {
        db.prepare("UPDATE memory_programs SET false_positive_count = false_positive_count + 1 WHERE id = ?").run(log.vaccine_fired);
      } else {
        db.prepare("UPDATE memory_programs SET true_positive_count = true_positive_count + 1 WHERE id = ?").run(log.vaccine_fired);
      }
      db.prepare("UPDATE session_behavior_log SET processed = 1 WHERE id = ?").run(log.id);
    }
  } catch (e) {
    console.error("[OWL Memory] Failed to process vaccine outcomes:", e.message);
  }
}

// Helper to optimize resonance stiffness & damping per project
function optimizeTeslaResonance(projectId = "default") {
  try {
    let successfulTrails = db.prepare(`
      SELECT DISTINCT source_memory_id 
      FROM pheromone_trails 
      WHERE project = ? AND outcome = 'success'
    `).all(projectId).map(t => t.source_memory_id);

    if (successfulTrails.length === 0) {
      successfulTrails = db.prepare(`
        SELECT id FROM episodic_memories 
        WHERE project = ? AND is_active = 1 
        ORDER BY strength DESC LIMIT 10
      `).all(projectId).map(m => m.id);
    }

    if (successfulTrails.length === 0) {
      return { status: "no_memories_to_optimize" };
    }

    const allLinkedNodes = new Set();
    for (const memId of successfulTrails) {
      const links = db.prepare("SELECT code_node_id FROM memory_code_links WHERE memory_id = ?").all(memId);
      links.forEach(l => allLinkedNodes.add(l.code_node_id));
    }
    let nodeList = Array.from(allLinkedNodes);

    if (nodeList.length === 0) {
      const nodes = db.prepare("SELECT id FROM code_nodes WHERE project = ? LIMIT 10").all(projectId);
      nodes.forEach(n => nodeList.push(n.id));
    }

    if (nodeList.length === 0) {
      return { status: "no_nodes_to_simulate" };
    }

    const grid = [
      { stiffness: 0.3, damping: 0.1 }, { stiffness: 0.3, damping: 0.2 }, { stiffness: 0.3, damping: 0.4 },
      { stiffness: 0.6, damping: 0.1 }, { stiffness: 0.6, damping: 0.2 }, { stiffness: 0.6, damping: 0.4 },
      { stiffness: 0.9, damping: 0.1 }, { stiffness: 0.9, damping: 0.2 }, { stiffness: 0.9, damping: 0.4 }
    ];

    let bestConfig = grid[4];
    let bestScore = -1;
    const sampleNodes = nodeList.slice(0, 5);

    for (const config of grid) {
      let score = 0;
      for (const startNode of sampleNodes) {
        const resonantMems = propagateTeslaResonance(startNode, 15, config.stiffness, config.damping, true, projectId);
        const top10 = resonantMems.sort((a, b) => b.activation - a.activation).slice(0, 10);
        const count = top10.filter(rm => successfulTrails.includes(rm.id)).length;
        score += count;
      }
      if (score > bestScore) {
        bestScore = score;
        bestConfig = config;
      }
    }

    const lastScore = getSynapticConstant(`${projectId}:resonance_last_score`, -1);
    const stiffnessDir = getSynapticConstant(`${projectId}:resonance_stiffness_dir`, 1);
    const dampingDir = getSynapticConstant(`${projectId}:resonance_damping_dir`, 1);

    let finalStiffness = bestConfig.stiffness;
    let finalDamping = bestConfig.damping;
    let nextStiffnessDir = stiffnessDir;
    let nextDampingDir = dampingDir;

    if (bestScore > lastScore) {
      const pertS = stiffnessDir * 0.05;
      const pertD = dampingDir * 0.03;
      finalStiffness = Math.max(0.1, Math.min(2.0, finalStiffness + pertS));
      finalDamping = Math.max(0.05, Math.min(1.0, finalDamping + pertD));
    } else {
      nextStiffnessDir = -stiffnessDir;
      nextDampingDir = -dampingDir;
      const pertS = nextStiffnessDir * 0.05;
      const pertD = nextDampingDir * 0.03;
      finalStiffness = Math.max(0.1, Math.min(2.0, finalStiffness + pertS));
      finalDamping = Math.max(0.05, Math.min(1.0, finalDamping + pertD));
    }

    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)")
      .run(`${projectId}:resonance_stiffness`, finalStiffness);
    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)")
      .run(`${projectId}:resonance_damping`, finalDamping);
    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)")
      .run(`${projectId}:resonance_last_score`, bestScore);
    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)")
      .run(`${projectId}:resonance_stiffness_dir`, nextStiffnessDir);
    db.prepare("INSERT OR REPLACE INTO synaptic_constants (name, value) VALUES (?, ?)")
      .run(`${projectId}:resonance_damping_dir`, nextDampingDir);

    return {
      status: "optimized",
      grid_best: bestConfig,
      bayesian_final: { stiffness: finalStiffness, damping: finalDamping },
      score: bestScore
    };
  } catch (err) {
    console.error("[OWL Tesla Resonance Optimization Error]", err);
    return { error: err.message };
  }
}

function runCausalInferenceEngine(projectId = "default") {
  const now = new Date().toISOString();
  try {
    // Verify pending predictions first
    verifyCausalPredictions(projectId);

    // Scan session behavior log for trigger pattern
    const touchedFiles = db.prepare(`
      SELECT DISTINCT file_touched 
      FROM session_behavior_log 
      WHERE file_touched IS NOT NULL AND file_touched != 'unknown_file'
    `).all();

    let patternsFound = 0;
    for (const f of touchedFiles) {
      const file = f.file_touched;
      
      const sessions = db.prepare(`
        SELECT DISTINCT session_id 
        FROM session_behavior_log 
        WHERE file_touched = ?
      `).all(file);

      if (sessions.length < 3) continue;

      let errorSessions = 0;
      for (const s of sessions) {
        const hasError = db.prepare(`
          SELECT 1 FROM session_behavior_log 
          WHERE session_id = ? AND (event_type = 'error' OR event_type = 'cargo_cult' OR constitution_violated = 1)
          LIMIT 1
        `).get(s.session_id);

        const hasBug = db.prepare(`
          SELECT 1 FROM code_bugs 
          WHERE file_path = ? AND project = ? AND created_at >= (
            SELECT MIN(timestamp) FROM session_behavior_log WHERE session_id = ? AND file_touched = ?
          ) LIMIT 1
        `).get(file, projectId, s.session_id, file);

        if (hasError || hasBug) {
          errorSessions++;
        }
      }

      const completionRate = errorSessions / sessions.length;
      if (completionRate >= 0.70) {
        const predId = generateId(`causal_${file}`, "prediction");
        const triggerPattern = `editing ${file}`;
        const predictedEvent = `crash or logic bug in ${file}`;
        const verifyAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

        db.prepare(`
          INSERT OR REPLACE INTO causal_predictions 
            (id, trigger_pattern, predicted_event, predicted_file, confidence, predicted_at, verify_at, outcome)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(predId, triggerPattern, predictedEvent, file, completionRate, now, verifyAt);

        patternsFound++;
      }
    }
    return { status: "success", patterns_detected: patternsFound };
  } catch(e) {
    console.error("[OWL Causal Inference Engine Error]", e);
    return { status: "error", error: e.message };
  }
}

function verifyCausalPredictions(projectId = "default") {
  const now = new Date().toISOString();
  try {
    const pending = db.prepare(`
      SELECT * FROM causal_predictions 
      WHERE outcome = 'pending' AND verify_at <= ?
    `).all(now);

    for (const pred of pending) {
      const bug = db.prepare(`
        SELECT 1 FROM code_bugs 
        WHERE file_path = ? AND project = ? AND created_at BETWEEN ? AND ?
        LIMIT 1
      `).get(pred.predicted_file, projectId, pred.predicted_at, pred.verify_at);

      const error = db.prepare(`
        SELECT 1 FROM session_behavior_log 
        WHERE file_touched = ? AND event_type = 'error' AND timestamp BETWEEN ? AND ?
        LIMIT 1
      `).get(pred.predicted_file, pred.predicted_at, pred.verify_at);

      if (bug || error) {
        const newConfidence = Math.min(1.0, pred.confidence + 0.1);
        db.prepare(`
          UPDATE causal_predictions 
          SET outcome = 'confirmed', confidence = ?, verified_at = ? 
          WHERE id = ?
        `).run(newConfidence, now, pred.id);
      } else {
        const newConfidence = pred.confidence - 0.15;
        if (newConfidence < 0.25) {
          db.prepare(`DELETE FROM causal_predictions WHERE id = ?`).run(pred.id);
        } else {
          db.prepare(`
            UPDATE causal_predictions 
            SET outcome = 'decayed', confidence = ?, verified_at = ? 
            WHERE id = ?
          `).run(newConfidence, now, pred.id);
        }
      }
    }
  } catch(e) {
    console.error("[OWL Prediction Verification Error]", e);
  }
}

function applyMemoryFitnessSelection(projectId) {
  try {
    // 1. Process vaccine outcomes from Behavior Log
    processVaccineOutcomes(projectId);

    // 2. Evaluate vaccine precision and fossilize bad ones
    const progs = db.prepare("SELECT * FROM memory_programs WHERE project = ?").all(projectId);
    for (const prog of progs) {
      const tp = prog.true_positive_count || 0;
      const fp = prog.false_positive_count || 0;
      const total = tp + fp;
      const precision = total > 0 ? (tp / total) : 0.5;
      db.prepare("UPDATE memory_programs SET precision_score = ? WHERE id = ?").run(precision, prog.id);
      
      if (precision < 0.25 && total >= 3) {
        const now = new Date().toISOString();
        db.prepare("DELETE FROM memory_programs WHERE id = ?").run(prog.id);
        db.prepare("INSERT OR IGNORE INTO fossil_record (id, original_content, final_fitness, extinction_date, reason) VALUES (?, ?, ?, ?, ?)")
          .run(prog.id, JSON.stringify({ name: prog.name, description: prog.description, program_code: prog.program_code }), precision, now, 'low_vaccine_precision');
      }
    }

    // 3. Process memory fitness
    const mems = db.prepare(`
      SELECT em.id, em.strength, em.content, em.fitness_score, em.access_count, em.created_at,
             COALESCE(COUNT(mcl.code_node_id), 0) as link_count
      FROM episodic_memories em
      LEFT JOIN memory_code_links mcl ON mcl.memory_id = em.id
      WHERE em.project = ? AND em.is_active = 1
      GROUP BY em.id
    `).all(projectId);

    let archived = 0, strengthened = 0;
    const now = new Date().toISOString();
    const nowTime = Date.now();

    for (const m of mems) {
      const linkBonus = Math.min(m.link_count * 0.1, 0.5);
      const fitness = (m.fitness_score || m.strength || 1.0) + linkBonus;
      const ageDays = (nowTime - new Date(m.created_at).getTime()) / (24 * 3600 * 1000);

      if (fitness < 0.15 && (m.access_count || 0) < 3 && ageDays > 14) {
        // Archive — not delete. The pattern may still be valuable.
        db.prepare("UPDATE episodic_memories SET is_active = 0 WHERE id = ?").run(m.id);
        db.prepare("INSERT OR IGNORE INTO fossil_record (id, original_content, final_fitness, extinction_date, reason) VALUES (?, ?, ?, ?, ?)")
          .run(m.id, m.content, fitness, now, 'low_fitness');
        archived++;
      } else if (fitness > 2.5) {
        db.prepare("UPDATE episodic_memories SET strength = MIN(strength + 0.05, 5.0), fitness_score = MIN(fitness_score + 0.05, 1.0) WHERE id = ?").run(m.id);
        strengthened++;
      }
    }

    return { archived, strengthened, total_evaluated: mems.length };
  } catch (err) {
    return { error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Innovation D: Cognitive Fingerprint — Behavioral Modeling
// Called every 10 dream cycles. Reads session patterns and
// computes a behavioral fingerprint: peak hours, primary memory
// type, mental model clusters, decision reversal rate.
// ═══════════════════════════════════════════════════════════════
function updateCognitiveFingerprint(projectId) {
  try {
    const now = new Date().toISOString();

    // Read last 50 session records
    const sessions = db.prepare(
      "SELECT summary, emotional_tone, ended_at, token_count FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 50"
    ).all(projectId);

    if (sessions.length === 0) {
      return { status: "no_sessions_to_analyze" };
    }

    // Calculate peak hours from session ended_at timestamps
    const hourCounts = {};
    for (const s of sessions) {
      try {
        const hour = new Date(s.ended_at).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      } catch (e) {}
    }

    // Find peak hour window (top 2 hours)
    const sortedHours = Object.entries(hourCounts).sort(([, a], [, b]) => b - a);
    let peakHourStart = 9, peakHourEnd = 17;
    if (sortedHours.length >= 2) {
      const topHours = sortedHours.slice(0, 3).map(([h]) => parseInt(h)).sort((a, b) => a - b);
      peakHourStart = topHours[0];
      peakHourEnd = topHours[topHours.length - 1];
    }

    // Most common event_type = primary_memory_type
    const typeCounts = {};
    const recentMems = db.prepare(
      "SELECT event_type FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 200"
    ).all(projectId);
    for (const m of recentMems) {
      const t = m.event_type || "observation";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const primaryMemoryType = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || "observation";

    // Decision reversal rate: decisions with actual_outcome != predicted_outcome
    const totalDecisions = db.prepare("SELECT COUNT(*) as cnt FROM decisions WHERE project = ?").get(projectId)?.cnt || 0;
    const reversals = db.prepare(
      "SELECT COUNT(*) as cnt FROM decisions WHERE project = ? AND actual_outcome IS NOT NULL AND actual_outcome != predicted_outcome"
    ).get(projectId)?.cnt || 0;
    const decisionReversalRate = totalDecisions > 0 ? Math.round((reversals / totalDecisions) * 100) / 100 : 0;

    // Mental model clusters: find files that are co-edited together
    const coEditPairs = db.prepare(`
      SELECT sw.source_id, sw.target_id, sw.co_occurrences
      FROM synaptic_weights sw
      WHERE sw.co_occurrences >= 3
      ORDER BY sw.co_occurrences DESC LIMIT 10
    `).all();
    const clusterMap = {};
    for (const pair of coEditPairs) {
      const key = [pair.source_id, pair.target_id].sort().join(" <-> ");
      clusterMap[key] = pair.co_occurrences;
    }
    const mentalModelClusters = Object.entries(clusterMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k, v]) => ({ files: k, co_edits: v }));

    // Work style: error-heavy = debug-first, insight-heavy = exploration-first
    const errorCount = typeCounts["error"] || 0;
    const insightCount = typeCounts["insight"] || 0;
    const decisionCount = typeCounts["decision"] || 0;
    let workStyle = "balanced";
    if (errorCount > insightCount * 2) workStyle = "debug-first";
    else if (insightCount > errorCount * 2) workStyle = "exploration-first";
    else if (decisionCount > (errorCount + insightCount)) workStyle = "decision-driven";

    // Cognitive style
    const avgValence = recentMems.length === 0 ? 0 :
      (db.prepare("SELECT AVG(emotional_valence) as avg FROM episodic_memories WHERE project = ? AND is_active = 1").get(projectId)?.avg || 0);
    const cognitiveStyle = avgValence > 0.1 ? "outcome-first" : avgValence < -0.1 ? "risk-aware" : "systematic";

    // Average session token count as proxy for session length in minutes
    const avgTokens = sessions.reduce((s, ss) => s + (ss.token_count || 0), 0) / sessions.length;
    const avgSessionLengthMinutes = Math.round(avgTokens / 100 * 10) / 10 || 60;

    // Write or update fingerprint
    const fpId = `fp_${projectId}`;
    const existing = db.prepare("SELECT id FROM cognitive_fingerprint WHERE id = ?").get(fpId);
    if (existing) {
      db.prepare(`
        UPDATE cognitive_fingerprint SET
          work_style = ?, peak_hour_start = ?, peak_hour_end = ?,
          avg_session_length_minutes = ?, decision_reversal_rate = ?,
          primary_memory_type = ?, mental_model_clusters = ?,
          cognitive_style = ?, total_sessions_analyzed = ?, updated_at = ?
        WHERE id = ?
      `).run(workStyle, peakHourStart, peakHourEnd, avgSessionLengthMinutes,
             decisionReversalRate, primaryMemoryType, JSON.stringify(mentalModelClusters),
             cognitiveStyle, sessions.length, now, fpId);
    } else {
      db.prepare(`
        INSERT INTO cognitive_fingerprint
          (id, project, work_style, peak_hour_start, peak_hour_end, avg_session_length_minutes,
           decision_reversal_rate, primary_memory_type, mental_model_clusters, cognitive_style,
           total_sessions_analyzed, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fpId, projectId, workStyle, peakHourStart, peakHourEnd, avgSessionLengthMinutes,
             decisionReversalRate, primaryMemoryType, JSON.stringify(mentalModelClusters),
             cognitiveStyle, sessions.length, now);
    }

    return {
      status: "fingerprint_updated",
      project: projectId,
      work_style: workStyle,
      peak_hours: `${peakHourStart}:00 - ${peakHourEnd}:00`,
      primary_memory_type: primaryMemoryType,
      decision_reversal_rate: decisionReversalRate,
      mental_model_clusters: mentalModelClusters.length,
      cognitive_style: cognitiveStyle,
      sessions_analyzed: sessions.length
    };
  } catch (err) {
    console.error("[OWL FINGERPRINT] updateCognitiveFingerprint failed:", err.message);
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
      description: "The Single Unified Cognitive Interface. Collapses memory, call-graphs, context curvature (gravity), dependencies, and error harvesting into a single query. Actions: 'perceive' (sense workspace), 'record' (store memory), 'cogitate' (reason), 'act' (run command), 'dream' (consolidate), 'end_session' (save session state before ending), 'resurrect' (load last session at start), 'echo' (extract + store AI insights automatically).",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["perceive", "record", "cogitate", "act", "dream", "end_session", "resurrect", "echo", "compile_vaccine", "oracle", "prophecy", "autopsy", "dismiss_vaccine"],
            description: "The cognitive action. Use 'end_session' before ending a session. Use 'compile_vaccine' to add executable bug checks. Use 'oracle' to fuse all signals into top 5 insights."
          },
          observer_type: {
            type: "string",
            enum: ["active_file", "failing_test", "open_pr_diff", "error_message", "stack_trace"],
            description: "Optional relativistic observer type."
          },
          observer_context: {
            type: "string",
            description: "Optional context for the observer."
          },
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
              linked_code_nodes: { type: "array", items: { type: "string" } },
              vaccine_code: { type: "string", description: "JS sandbox function returning {triggered: true/false, score: 0-1, message: string}." },
              vaccine_name: { type: "string" }
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
          // end_session params
          session_summary: { type: "string", description: "One-sentence summary of what was accomplished this session. Used by 'end_session'." },
          // resurrect params
          format: { type: "string", enum: ["full", "brief"], description: "'brief' returns a compact system-prompt-injectable handoff. Default: 'full'." },
          // echo params
          ai_output: { type: "string", description: "The AI response text to extract memories from. Used by 'echo'." },
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
      name: "get_ledger",
      description: "Get token savings report. Shows how many tokens OWL has saved vs injected across all sessions.",
      inputSchema: { type: "object", properties: { project: { type: "string", default: "default" } } }
    },
    {
      name: "index_codebase",
      description: "Register folders and AST files.",
      inputSchema: { type: "object", properties: { scan_path: { type: "string" }, project: { type: "string", default: "default" } }, required: ["scan_path"] }
    },
    {
      name: "owl.nexus",
      description: "The Single Unified Cognitive Router. Automatically decides whether to serve from memory cache, fetch a URL, trigger deep research, or search local project knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          context: { type: "string", description: "The query, goal, or question to resolve." },
          action: { type: "string", enum: ["recall", "research", "fetch"], description: "Optional explicit override for routing." },
          project: { type: "string", default: "default" }
        },
        required: ["context"]
      }
    },
    {
      name: "owl.remember",
      description: "Store memory. Automatically routes to the cross-modal codex if the modality is not 'text' (e.g. image, voice), otherwise stores as a standard episodic memory.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The memory content or text extraction." },
          modality: { type: "string", enum: ["text", "image", "voice_transcript", "sketch"], default: "text", description: "The sensory modality of the memory." },
          project: { type: "string", default: "default" }
        },
        required: ["content"]
      }
    },
    {
      name: "owl.recall",
      description: "Recall memories. Conducts semantic search over project databases and runs cross-project knowledge transfer checks.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query to match against memories." },
          project: { type: "string", default: "default" }
        },
        required: ["query"]
      }
    },
    {
      name: "owl.research",
      description: "Trigger deep research on a topic. Memory-gated to bypass redundant web calls if the answer is already cached.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The research topic or question." },
          depth: { type: "string", enum: ["quick", "medium", "deep"], default: "medium", description: "Research depth level." },
          project: { type: "string", default: "default" },
          active_file: { type: "string", description: "The file currently active in the editor (for auto-linking)." }
        },
        required: ["topic"]
      }
    },
    {
      name: "owl.fetch",
      description: "Fetch web page content with automatic domain trust verification, semantic difference checks, and freshness decay.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL of the webpage to fetch." },
          mode: { type: "string", enum: ["static", "stealth", "dynamic"], default: "static", description: "Web fetching mode." }
        },
        required: ["url"]
      }
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
      // Exclude stale memories (stale_flag=1 means monitored page changed, knowledge may be outdated)
      const mems = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1 AND (stale_flag IS NULL OR stale_flag = 0)").all(projectId);
      const matches = mems.map(m => ({
        id: m.id,
        content: m.content,
        score: Math.round(calculateSimilarity(query, m.content) * 100) / 100
      })).sort((a, b) => b.score - a.score).slice(0, 10);

      // Trigger reconsolidation and Hebbian strengthening for the top retrieved memories
      const emotional = detectEmotionalSalience(query);
      for (const m of matches.slice(0, 3)) {
        if (m.score > 0.35) {
          reconsolidateMemory(m.id, emotional);
        }
      }

      // Log token usage for ledger
      const tokensInjected = Math.round(JSON.stringify(matches).length / 4);
      db.prepare(
        "INSERT INTO token_ledger (project, tool_called, tokens_injected, tokens_saved_estimate, created_at) VALUES (?, 'recall', ?, ?, ?)"
      ).run(projectId, tokensInjected, tokensInjected * 10, now);
      return { content: [{ type: "text", text: JSON.stringify(matches) }] };
    }

    // ═══ Innovation 3: Token Ledger ═══
    if (name === "get_ledger") {
      const ledger = db.prepare(
        "SELECT tool_called, SUM(tokens_injected) as injected, SUM(tokens_saved_estimate) as saved, COUNT(*) as calls FROM token_ledger WHERE project = ? GROUP BY tool_called"
      ).all(projectId);
      const totals = db.prepare(
        "SELECT SUM(tokens_injected) as total_injected, SUM(tokens_saved_estimate) as total_saved, COUNT(*) as total_calls FROM token_ledger WHERE project = ?"
      ).get(projectId);
      const totalSaved = totals ? (totals.total_saved || 0) : 0;
      const totalInjected = totals ? (totals.total_injected || 0) : 0;
      const ratio = totalInjected > 0 ? Math.round((totalSaved / totalInjected) * 10) / 10 : 0;
      // Rough cost estimate at $3/1M tokens (Claude Sonnet)
      const dollarsSaved = (totalSaved / 1_000_000 * 3).toFixed(4);
      return { content: [{ type: "text", text: JSON.stringify({
        project: projectId,
        summary: {
          total_tokens_injected_by_owl: totalInjected,
          total_tokens_saved_estimate: totalSaved,
          efficiency_ratio: `${ratio}x`,
          estimated_dollars_saved: `$${dollarsSaved}`,
          total_owl_calls: totals ? totals.total_calls : 0
        },
        by_tool: ledger,
        note: "Tokens saved = estimated context tokens that would have been spent without OWL memory injection."
      }) }] };
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

        // Log to session_behavior_log
        try {
          const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
          const currentSessionId = lastSession ? lastSession.id : 'default_session';
          db.prepare(`
            INSERT INTO session_behavior_log (id, session_id, event_type, file_touched, timestamp)
            VALUES (?, ?, 'perceive', ?, ?)
          `).run(generateId('perceive_' + now, 'behavior'), currentSessionId, activeFile || null, now);
        } catch(e) {}

        // Capture code topology snapshot
        captureTopologySnapshot(projectId);

        let activeNodeId = null;
        if (activeFile) {
          activeNodeId = resolveActiveNode(activeFile, codeSnippet, projectId);
          db.prepare("UPDATE code_nodes SET edit_count = edit_count + 1 WHERE id = ?").run(activeNodeId);
        }

        if (activeNodeId) {
          updateHebbianTransition(lastFocusedNodeId, activeNodeId);
          lastFocusedNodeId = activeNodeId;
        }

        // Intercept compile/build error immediately
        if (terminalOutput && (terminalOutput.includes("Error") || terminalOutput.includes("Exception") || terminalOutput.includes("failed"))) {
          await harvestErrorMusk(terminalOutput, "auto_intercept", projectId);
        }

        const observerType = args.observer_type || null;
        const observerContext = args.observer_context || null;

        let observerFiles = [];
        if (observerType && observerContext) {
          let matches = [];
          if (observerType === "open_pr_diff") {
            matches = observerContext.match(/(?:[ab]\/)?([a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+)/g) || [];
          } else {
            matches = observerContext.match(/([a-zA-Z0-9_\-\/]+\.(?:py|js|ts|tsx|jsx|json|yaml|sql|md|txt))/g) || [];
          }
          observerFiles = matches.map(m => {
            const parts = m.replace(/\\/g, "/").split("/");
            return parts[parts.length - 1];
          });
        }

        let observerNodeIds = [];
        if (activeNodeId) {
          observerNodeIds.push(activeNodeId);
        }
        if (observerFiles.length > 0) {
          for (const f of observerFiles) {
            const rows = db.prepare("SELECT id FROM code_nodes WHERE filepath LIKE ?").all(`%${f}`);
            rows.forEach(r => {
              if (!observerNodeIds.includes(r.id)) {
                observerNodeIds.push(r.id);
              }
            });
          }
        }

        const gravityContext = calculateRelativisticGravityWithObserver(activeNodeId, projectId, observerType, observerContext);
        const resonantContext = propagateTeslaResonance(observerNodeIds.length > 0 ? observerNodeIds : activeNodeId, 15, null, null, false, projectId);

        // Log observer sessions
        if (observerType) {
          try {
            const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
            const currentSessionId = lastSession ? lastSession.id : 'default_session';
            const topMemoriesStr = JSON.stringify(gravityContext.slice(0, 3).map(m => m.id));
            db.prepare(`
              INSERT INTO memory_observer_sessions (session_id, observer_type, observer_context, top_memories, resolution_time_ms, resolution_outcome)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(currentSessionId, observerType, observerContext || "", topMemoriesStr, null, "pending");
          } catch(e) {}
        }

        // Check causal predictions for warnings
        const causalWarnings = [];
        try {
          const activePreds = db.prepare("SELECT * FROM causal_predictions WHERE outcome = 'pending'").all();
          for (const pred of activePreds) {
            if (activeFile && activeFile.replace(/\\/g, "/").endsWith(pred.predicted_file.replace(/\\/g, "/"))) {
              causalWarnings.push({
                type: "causal_prediction",
                message: `⚠️ PROPHETIC WARNING: Historically, editing ${pred.predicted_file} led to errors/bugs in ${(pred.confidence * 100).toFixed(0)}% of sessions. Proceed with caution.`
              });
            }
          }
        } catch(e) {}
        const secretContradictions = checkContrarianSecrets(activeFile, codeSnippet, projectId);
        const dependencyAlerts = checkDependencyStewardship(activeFile);
        const healingMocks = calculateDaVinciHealing(activeNodeId);
        const hotspots = calculateRefactoringHotspots(projectId);
        const dilatedContext = getRefractoryDilation(activeNodeId, projectId);
        const simulatedVaccines = simulateMemoryPrograms(codeSnippet, projectId);

        // ═══ Innovation 5: Daemon-MCP Nerve Bridge ═══
        // Flush unconsumed daemon signals — the background brain tells the AI brain what it noticed
        const daemonAlerts = db.prepare(
          "SELECT id, signal_type, payload, created_at FROM daemon_signals WHERE consumed = 0 ORDER BY created_at ASC LIMIT 20"
        ).all().map(s => {
          try { return { type: s.signal_type, data: JSON.parse(s.payload), at: s.created_at }; }
          catch(e) { return { type: s.signal_type, data: s.payload, at: s.created_at }; }
        });
        if (daemonAlerts.length > 0) {
          db.prepare("UPDATE daemon_signals SET consumed = 1 WHERE consumed = 0").run();
        }

        // ═══ D3: Cross-Server Observer Propagation ═══
        // Fetch only unconsumed cross_server_events (avoid full table scan as table grows)
        const crossEvents = db.prepare(
          "SELECT id, source_server, event_type, payload, target_servers, consumed_by, created_at FROM cross_server_events WHERE consumed_by NOT LIKE '%\"owl-memory\"%' ORDER BY id DESC LIMIT 50"
        ).all();
        const unconsumedCrossEvents = [];
        for (const ev of crossEvents) {
          let targetsList = [];
          let consumedList = [];
          try { targetsList = JSON.parse(ev.target_servers || "[]"); } catch(e) {}
          try { consumedList = JSON.parse(ev.consumed_by || "[]"); } catch(e) {}
          
          if (consumedList.includes("owl-memory")) continue;
          if (targetsList.length > 0 && !targetsList.includes("owl-memory")) continue;
          
          let parsedPayload = ev.payload;
          try { parsedPayload = JSON.parse(ev.payload); } catch(e) {}
          
          unconsumedCrossEvents.push({
            id: ev.id,
            source: ev.source_server,
            type: ev.event_type,
            payload: parsedPayload,
            created_at: ev.created_at
          });
          
          consumedList.push("owl-memory");
          db.prepare("UPDATE cross_server_events SET consumed_by = ? WHERE id = ?").run(
            JSON.stringify(consumedList), ev.id
          );
        }

        // ═══ Innovation 2: Cognitive Echo — suggested memories from perceive context ═══
        const suggestedMemories = [];
        // If there are active threat warnings, suggest storing them as memories
        for (const tw of secretContradictions.slice(0, 2)) {
          suggestedMemories.push({
            content: `Contradiction detected: ${tw.message || tw.assertion_text || JSON.stringify(tw).slice(0, 120)}`,
            event_type: "insight",
            confidence: 0.9,
            reason: "Thiel contradiction check fired"
          });
        }
        // If there are high-gravity memories surfaced, note the top one
        if (gravityContext.length > 0 && gravityContext[0].gravity > 0.5) {
          suggestedMemories.push({
            content: `High-gravity context active: ${gravityContext[0].content.slice(0, 120)}`,
            event_type: "observation",
            confidence: 0.7,
            reason: "Einstein gravity > 0.5 — this memory is pulling hard on the current context"
          });
        }

        // Log token usage for ledger
        const tokensInjected = JSON.stringify({ gravityContext, resonantContext, daemonAlerts, cross_server_events: unconsumedCrossEvents }).length / 4;
        db.prepare(
          "INSERT INTO token_ledger (project, tool_called, tokens_injected, tokens_saved_estimate, created_at) VALUES (?, 'nexus.perceive', ?, ?, ?)"
        ).run(projectId, Math.round(tokensInjected), Math.round(tokensInjected * 12), now);

        let allThreats = secretContradictions.concat(dependencyAlerts);
        if (causalWarnings && causalWarnings.length > 0) {
          allThreats = allThreats.concat(causalWarnings);
        }
        const cargoCultWarning = runCargoCultDetector(activeFile, codeSnippet, projectId);
        const constitutionalViolations = checkConstitutionalRules(codeSnippet, projectId);
        const biorhythmStatus = getCognitiveBiorhythmStatus();

        if (cargoCultWarning) {
          allThreats.push(cargoCultWarning);
        }
        if (constitutionalViolations && constitutionalViolations.length > 0) {
          allThreats = allThreats.concat(constitutionalViolations);
        }
        if (biorhythmStatus && biorhythmStatus.high_risk) {
          allThreats.push({
            type: "cognitive_biorhythm",
            message: biorhythmStatus.message
          });
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              a: activeNodeId,
              active_node_id: activeNodeId,
              gravity_memories: gravityContext,
              context_memories: gravityContext,
              resonant_memories: resonantContext,
              resonance_memories: resonantContext,
              tw: allThreats,
              threat_warnings: allThreats,
              rh: hotspots,
              refactoring_hotspots: hotspots,
              healing_suggestions: healingMocks,
              self_healing_suggestions: healingMocks,
              dc: dilatedContext,
              daemon_alerts: daemonAlerts,
              suggested_memories: suggestedMemories,
              bug_vaccines: simulatedVaccines,
              cross_server_events: unconsumedCrossEvents
            })
          }]
        };
      }

      if (action === "oracle") {
        const state = args.workspace_state || {};
        const activeFile = state.active_file;
        const codeSnippet = state.code_snippet;
        const activeNodeId = activeFile ? resolveActiveNode(activeFile, codeSnippet, projectId) : null;
        
        const signals = [];
        
        // 1. Tesla Resonance
        const resonant = activeNodeId ? propagateTeslaResonance(activeNodeId, 15, null, null, false, projectId) : [];
        resonant.forEach(r => signals.push({ type: "resonance", score: r.voltage || 0.5, message: `Resonance with ${r.target}` }));
        
        // 2. Einstein Gravity
        const gravity = activeNodeId ? calculateRelativisticGravity(activeNodeId, projectId) : [];
        gravity.forEach(g => signals.push({ type: "gravity", score: g.gravity || 0.5, message: g.content.substring(0, 100) }));
        
        // 3. Thiel Contradictions & Tata Dependencies
        const tw = checkContrarianSecrets(activeFile, codeSnippet, projectId);
        tw.forEach(t => signals.push({ type: "contradiction", score: 0.9, message: t.message || t.assertion_text || "Contradiction found" }));
        
        const da = checkDependencyStewardship(activeFile);
        da.forEach(d => signals.push({ type: "dependency", score: 0.8, message: d.message }));
        
        // 4. Memory Vaccines
        const vaccines = simulateMemoryPrograms(codeSnippet, projectId);
        vaccines.forEach(v => signals.push({ type: "vaccine", score: v.risk_score || 0.8, message: v.message }));
        
        // 5. Sort by score and apply Miller's Law (limit to top 5)
        const oracleSignals = signals.sort((a, b) => b.score - a.score).slice(0, 5);
        
        // Innovation F: Epistemic Uncertainty
        const epistemicBounds = {
          staleness_warning: gravity.some(g => {
            const ageDays = (new Date() - new Date(g.created_at)) / (1000 * 60 * 60 * 24);
            return ageDays > 7;
          }),
          confidence_score: oracleSignals.length > 0 ? oracleSignals.reduce((sum, s) => sum + s.score, 0) / oracleSignals.length : 0.0,
          known_unknowns: oracleSignals.length === 0 ? [`Zero signals detected for ${activeFile || 'current context'}. The substrate is blind here.`] : []
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ oracle_insights: oracleSignals, epistemic_bounds: epistemicBounds })
          }]
        };
      }
      if (action === "compile_vaccine") {
        const memData = args.memory_data || {};
        if (!memData.vaccine_code || !memData.vaccine_name) throw new Error("vaccine_code and vaccine_name required");
        const id = generateId(memData.vaccine_code, "prog");
        db.prepare("INSERT INTO memory_programs (id, name, description, program_code, project, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(id, memData.vaccine_name, memData.content, memData.vaccine_code, projectId, now, now);
        return { content: [{ type: "text", text: `Vaccine compiled: ${id} (${memData.vaccine_name})` }] };
      }

      if (action === "dismiss_vaccine") {
        const vaccineId = args.vaccine_id || args.program_id;
        if (vaccineId) {
          db.prepare("UPDATE memory_programs SET false_positive_count = false_positive_count + 1 WHERE id = ?").run(vaccineId);
          const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
          const currentSessionId = lastSession ? lastSession.id : 'default_session';
          db.prepare(`
            INSERT INTO session_behavior_log (id, session_id, event_type, vaccine_fired, timestamp)
            VALUES (?, ?, 'vaccine_dismissed', ?, ?)
          `).run(generateId('dismiss_' + vaccineId + now, 'behavior'), currentSessionId, vaccineId, now);
          
          return { content: [{ type: "text", text: JSON.stringify({ status: "vaccine_dismissed", vaccine_id: vaccineId }) }] };
        } else {
          throw new Error("vaccine_id or program_id required");
        }
      }

      if (action === "prophecy") {
        try {
          const activePredictions = db.prepare(`
            SELECT id, trigger_pattern, predicted_event, predicted_file, confidence, predicted_at, verify_at
            FROM causal_predictions
            WHERE outcome = 'pending'
            ORDER BY confidence DESC
          `).all();

          const confirmed = db.prepare("SELECT COUNT(*) as cnt FROM causal_predictions WHERE outcome = 'confirmed'").get()?.cnt || 0;
          const decayed = db.prepare("SELECT COUNT(*) as cnt FROM causal_predictions WHERE outcome = 'decayed'").get()?.cnt || 0;
          const total = confirmed + decayed;
          const accuracy = total > 0 ? (confirmed / total) : 0.8;

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "success",
                active_predictions: activePredictions,
                prophecy_accuracy: accuracy.toFixed(2),
                prophecy_index: activePredictions.length > 0 ? (activePredictions.reduce((sum, p) => sum + p.confidence, 0) / activePredictions.length).toFixed(2) : 0.0,
                message: `Active Causal Warnings: ${activePredictions.length}. Historical prophecy accuracy: ${(accuracy * 100).toFixed(1)}%.`
              })
            }]
          };
        } catch (err) {
          return { error: err.message };
        }
      }

      if (action === "autopsy") {
        const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
        const currentSessionId = lastSession ? lastSession.id : 'default_session';

        const perceiveCount = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'perceive'").get(currentSessionId)?.cnt || 0;
        const rememberCount = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'remember'").get(currentSessionId)?.cnt || 0;
        const constViolations = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'constitution_violation'").get(currentSessionId)?.cnt || 0;
        const contradictions = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'contradiction'").get(currentSessionId)?.cnt || 0;
        const vaccinesFired = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'vaccine_fired'").get(currentSessionId)?.cnt || 0;
        const cargoCults = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'cargo_cult'").get(currentSessionId)?.cnt || 0;
        const reversals = db.prepare("SELECT COUNT(*) as cnt FROM session_behavior_log WHERE session_id = ? AND event_type = 'vaccine_dismissed'").get(currentSessionId)?.cnt || 0;

        const revDeduct = Math.min(reversals * 25, 25);
        const constDeduct = Math.min(constViolations * 20, 20);
        const cargoDeduct = Math.min(cargoCults * 15, 15);
        
        let predictionAccuracy = 0.8; 
        try {
          const confirmed = db.prepare("SELECT COUNT(*) as cnt FROM causal_predictions WHERE outcome = 'confirmed'").get()?.cnt || 0;
          const decayed = db.prepare("SELECT COUNT(*) as cnt FROM causal_predictions WHERE outcome = 'decayed'").get()?.cnt || 0;
          const total = confirmed + decayed;
          if (total > 0) {
            predictionAccuracy = confirmed / total;
          }
        } catch(e) {}
        
        const predScore = predictionAccuracy * 20;
        
        let fileDiffScore = 20;
        try {
          const predictedRows = db.prepare("SELECT DISTINCT predicted_file FROM causal_predictions WHERE predicted_file IS NOT NULL").all();
          const predictedFiles = new Set(predictedRows.map(r => r.predicted_file));
          if (predictedFiles.size > 0) {
            const touchedRows = db.prepare("SELECT DISTINCT file_touched FROM session_behavior_log WHERE session_id = ? AND file_touched IS NOT NULL").all(currentSessionId);
            const touchedFiles = touchedRows.map(r => r.file_touched);
            const matched = touchedFiles.filter(f => predictedFiles.has(f)).length;
            fileDiffScore = (matched / predictedFiles.size) * 20;
          }
        } catch(e) {}
        
        const bis = Math.max(0, 100 - revDeduct - constDeduct - cargoDeduct - (20 - predScore) - (20 - fileDiffScore));

        const memContent = `SESSION AUTOPSY — Session #${currentSessionId}\nBIS: ${bis.toFixed(0)}/100 | Reversals: ${reversals} | Violations: ${constViolations} | Cargo Cults: ${cargoCults}`;
        const memId = generateId(memContent, projectId);
        
        db.prepare(`
          INSERT INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
          VALUES (?, ?, 'session_autopsy', ?, 0.0, 0.0, 0.9, 1.0, ?, ?)
        `).run(memId, memContent, projectId, now, now);

        return { content: [{ type: "text", text: JSON.stringify({
          status: "autopsy_completed",
          bis: Math.round(bis),
          reversals,
          const_violations: constViolations,
          contradictions,
          vaccines_fired: vaccinesFired,
          cargo_cults: cargoCults,
          message: `Behavioral Integrity Score: ${Math.round(bis)}/100. Autopsy stored in episodic memories.`
        }) }] };
      }

      if (action === "film") {
        const fromDate = args.from_date || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const toDate = args.to_date || new Date().toISOString();
        
        try {
          const snapshots = db.prepare(`
            SELECT * FROM code_topology_snapshots 
            WHERE project = ? AND captured_at BETWEEN ? AND ? 
            ORDER BY captured_at ASC
          `).all(projectId, fromDate, toDate);
          
          if (snapshots.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ message: "No topology snapshots found in the specified range." }) }] };
          }
          
          const first = snapshots[0];
          const last = snapshots[snapshots.length - 1];
          
          const complexityTrend = last.complexity_score > first.complexity_score ? "increasing" : "decreasing";
          const complexityPct = first.complexity_score > 0 ? ((last.complexity_score - first.complexity_score) / first.complexity_score) * 100 : 0;
          
          const migration = [];
          let lastHotspot = null;
          snapshots.forEach(s => {
            if (s.hotspot_centroid && s.hotspot_centroid !== lastHotspot) {
              migration.push(s.hotspot_centroid);
              lastHotspot = s.hotspot_centroid;
            }
          });
          
          const days = (new Date(last.captured_at) - new Date(first.captured_at)) / (24 * 3600 * 1000) || 1;
          const nodesAdded = last.node_count - first.node_count;
          const deadCodeAccumulation = (nodesAdded / days).toFixed(2) + " nodes/day";
          
          const prediction = last.avg_gravity > 0.8 
            ? `${last.hotspot_centroid || 'Hotspot'} is becoming an event horizon due to high gravity of ${last.avg_gravity.toFixed(2)}.`
            : `System stability is normal. Trend is stable.`;
            
          const timeline = snapshots.map(s => ({
            timestamp: s.captured_at,
            nodes: s.node_count,
            edges: s.edge_count,
            hotspot: s.hotspot_centroid,
            complexity: s.complexity_score
          }));
          
          return { content: [{ type: "text", text: JSON.stringify({
            complexity_trend: `${complexityTrend}_${Math.abs(complexityPct).toFixed(0)}%_overall`,
            hotspot_migration: migration,
            dead_code_accumulation: deadCodeAccumulation,
            prediction: prediction,
            timeline: timeline
          }) }] };
        } catch(err) {
          return { error: err.message };
        }
      }

      if (action === "mirror") {
        try {
          const latestMem = db.prepare(`
            SELECT content FROM episodic_memories 
            WHERE event_type = 'cognitive_mirror_report' AND project = ? 
            ORDER BY created_at DESC LIMIT 1
          `).get(projectId);
          
          if (latestMem) {
            return { content: [{ type: "text", text: latestMem.content }] };
          } else {
            const report = generateCognitiveMirrorReport(projectId);
            if (report) {
              const reportStr = `COGNITIVE MIRROR REPORT\nScore: ${report.mirror_score}/100 | Personality: ${report.personality}\nBlind Spots:\n- ${report.blind_spots.join('\n- ')}\nDanger Windows:\n- ${report.danger_windows.join('\n- ')}\nMoat Skills:\n- ${report.moat_skills.join('\n- ')}`;
              return { content: [{ type: "text", text: reportStr }] };
            }
          }
          return { content: [{ type: "text", text: "Cognitive Mirror Report could not be generated." }] };
        } catch(err) {
          return { error: err.message };
        }
      }

      if (action === "record") {
        const data = args.memory_data || {};
        const content = data.content;
        const eventType = data.event_type || "observation";
        const linkedCodeNodes = data.linked_code_nodes || [];

        // Log to session_behavior_log
        try {
          const lastSession = db.prepare("SELECT id FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1").get(projectId);
          const currentSessionId = lastSession ? lastSession.id : 'default_session';
          db.prepare(`
            INSERT INTO session_behavior_log (id, session_id, event_type, decision_made, timestamp)
            VALUES (?, ?, 'remember', ?, ?)
          `).run(generateId('remember_' + now, 'behavior'), currentSessionId, (content || "").substring(0, 200), now);
        } catch(e) {}

        // Check for hallucinations
        const corrections = checkHallucinations(content, projectId);
        let finalContent = content;
        if (corrections && corrections.length > 0) {
          finalContent = content + " | " + corrections.map(c => c.message).join(" | ");
        }

        const memId = generateId(finalContent, projectId);
        const emotional = detectEmotionalSalience(finalContent);

        db.prepare(`
          INSERT INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?)
        `).run(memId, finalContent, eventType, projectId, emotional.valence, emotional.arousal, emotional.salience, now, now);

        const gitInfo = getCurrentGitInfo();
        db.prepare("INSERT OR REPLACE INTO memory_git_branches (memory_id, branch_name, commit_sha) VALUES (?, ?, ?)")
          .run(memId, gitInfo.branch, gitInfo.commit);

        if (hasVectors) {
          const emb = await generateEmbedding(finalContent);
          if (emb) db.prepare("INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (?, ?)").run(hexToBigInt(memId), JSON.stringify(emb));
        }

        for (const nodeId of linkedCodeNodes) {
          db.prepare("INSERT OR REPLACE INTO memory_code_links (memory_id, code_node_id, link_type) VALUES (?, ?, 'associated')").run(memId, nodeId);
        }

        // Crystallize specific knowledge
        crystallizeSpecificKnowledge(finalContent, projectId);

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
              ec: code,
              exit_code: code,
              stdout: stdout.slice(0, 1000),
              stderr: stderr.slice(0, 1000),
              sh2: harvestResult,
              surprise_harvest: harvestResult
            })
          }]
        };
      }

      if (action === "dream") {
        const rep = consolidateMemories(projectId);
        const sim = runAutonomicDreamSimulation(projectId);
        const evo = evolveDatabaseSchema(projectId);
        const gly = pruneGlymphaticSubstrate(projectId);
        const torvalds = chronoPruneWorkspace(projectId);
        
        // ═══ Hermes v7.0: runQADreamCycle ═══
        let qaDream = null;
        try {
          qaDream = runQADreamCycle(projectId);
        } catch(e) {
          console.error("QA Dream cycle failed:", e);
        }

        // ═══ Phase 1: Neocortex Distillation ═══
        const neocortex = distillateNeocortex(projectId);

        // ═══ Phase 3: Memory Fitness Selection (Darwinian) ═══
        const fitness = applyMemoryFitnessSelection(projectId);

        // ═══ Phase 4: Innovation D — Update Cognitive Fingerprint ═══
        const fingerprint = updateCognitiveFingerprint(projectId);

        // ═══ Phase D-F: Additional Cognitive Pillars ═══
        runSelfOptimization(projectId);
        updateBiorhythmStats();
        autoEvolveMetaPrograms(projectId);
        runPostHocQueryFitnessVerification(projectId);
        
        // M5: Tesla Resonance Variable-Frequency Optimization
        const teslaRes = optimizeTeslaResonance(projectId);

        // M1: Causal Inference Engine pattern analysis
        const causalRes = runCausalInferenceEngine(projectId);

        // M6: Temporal Film topology diff
        const topoDiff = computeTopologyDiff(projectId);

        // M8: Cognitive Mirror weekly report check
        let runMirrorReport = false;
        try {
          const lastReport = db.prepare("SELECT created_at FROM episodic_memories WHERE event_type = 'cognitive_mirror_report' AND project = ? ORDER BY created_at DESC LIMIT 1").get(projectId);
          if (!lastReport) {
            runMirrorReport = true;
          } else {
            const elapsed = Date.now() - new Date(lastReport.created_at).getTime();
            if (elapsed > 7 * 24 * 3600 * 1000) {
              runMirrorReport = true;
            }
          }
        } catch(e) {
          runMirrorReport = true;
        }

        let mirrorReportResult = null;
        if (runMirrorReport) {
          mirrorReportResult = generateCognitiveMirrorReport(projectId);
        }

        // Write a daemon signal so the next perceive picks this up
        db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES ('dream_completed', ?, ?, 0)")
          .run(JSON.stringify({
            merged: rep.merged,
            pruned: rep.pruned,
            schema_evolutions: evo.evolutions_count || 0,
            neocortex_patterns: neocortex.patterns_created_or_strengthened || 0,
            memories_archived_by_fitness: fitness.archived || 0,
            fingerprint_updated: fingerprint.status === "fingerprint_updated",
            tesla_resonance_optimization: teslaRes,
            causal_patterns_detected: causalRes.patterns_detected || 0,
            topology_diff: topoDiff,
            cognitive_mirror_generated: !!mirrorReportResult,
            qa_dream_cycle: qaDream
          }), now);

        return { content: [{ type: "text", text: JSON.stringify({
          status: "dream_cycle_completed",
          consolidation: rep,
          simulation: sim,
          schema_evolution: evo,
          glymphatic_cleanup: gly,
          torvalds_chrono_pruner: torvalds,
          neocortex_distillation: neocortex,
          fitness_selection: fitness,
          cognitive_fingerprint: fingerprint,
          self_optimization: "completed",
          cognitive_biorhythm: "updated",
          meta_programming: "evolved",
          tesla_resonance_optimization: teslaRes,
          causal_predictions: causalRes,
          qa_dream_cycle: qaDream,
          topology_diff: topoDiff,
          cognitive_mirror_generated: !!mirrorReportResult
        }) }] };
      }

      // ═══ Innovation 1: Session Resurrection — end_session ═══
      // Call this at the end of every session to snapshot state for the next AI
      if (action === "end_session") {
        const summary = args.session_summary || "Session ended without summary.";
        const sessionId = generateId(summary + now, "session");

        // Capture the 5 most recent memories
        const recentMems = db.prepare(
          "SELECT id FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 5"
        ).all(projectId).map(m => m.id);

        // Capture any pending (unresolved) decisions
        const pendingDecisions = db.prepare(
          "SELECT title, context FROM decisions WHERE project = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 3"
        ).all(projectId);

        // Get last error in this project
        const lastError = db.prepare(
          "SELECT content FROM episodic_memories WHERE project = ? AND event_type = 'error' AND is_active = 1 ORDER BY created_at DESC LIMIT 1"
        ).get(projectId);

        // Detect emotional tone from recent memories
        const recentEmotions = db.prepare(
          "SELECT emotional_valence FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 10"
        ).all(projectId);
        const avgValence = recentEmotions.length
          ? recentEmotions.reduce((s, m) => s + m.emotional_valence, 0) / recentEmotions.length
          : 0;
        const emotionalTone = avgValence > 0.2 ? "productive" : avgValence < -0.2 ? "frustrated" : "neutral";

        // Get the file that was most active (highest edit_count recently)
        const lastFile = lastFocusedNodeId || null;

        db.prepare(`
          INSERT OR REPLACE INTO session_states
            (id, project, summary, last_file, last_error, pending_decisions, recent_memory_ids, emotional_tone, token_count, ended_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          projectId,
          summary,
          lastFile,
          lastError ? lastError.content.slice(0, 200) : null,
          JSON.stringify(pendingDecisions),
          JSON.stringify(recentMems),
          emotionalTone,
          0,
          now
        );

        return { content: [{ type: "text", text: JSON.stringify({
          status: "session_saved",
          session_id: sessionId,
          summary,
          last_file: lastFile,
          emotional_tone: emotionalTone,
          pending_decisions: pendingDecisions.length,
          message: "Session state saved. Next AI session can call nexus.resurrect to restore full context."
        }) }] };
      }

      // ═══ Innovation 1 + B + C + D + F: Session Resurrection — resurrect ═══
      // Call this as the FIRST action in any new session
      if (action === "resurrect") {
        const format = args.format || "full";

        // Get the most recent session state for this project
        const lastSession = db.prepare(
          "SELECT * FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1"
        ).get(projectId);

        // Get cumulative token savings
        const ledger = db.prepare(
          "SELECT SUM(tokens_injected) as total_injected, SUM(tokens_saved_estimate) as total_saved FROM token_ledger WHERE project = ?"
        ).get(projectId);
        const totalSaved = ledger ? (ledger.total_saved || 0) : 0;
        const totalInjected = ledger ? (ledger.total_injected || 0) : 0;

        // Get active threat patterns
        const threats = db.prepare(
          "SELECT pattern_name, description FROM threat_patterns WHERE is_active = 1 LIMIT 3"
        ).all();

        // Log this resurrection for the ledger
        const resurrectionTokens = lastSession ? JSON.stringify(lastSession).length / 4 : 50;
        db.prepare(
          "INSERT INTO token_ledger (project, tool_called, tokens_injected, tokens_saved_estimate, created_at) VALUES (?, 'nexus.resurrect', ?, ?, ?)"
        ).run(projectId, Math.round(resurrectionTokens), Math.round(resurrectionTokens * 15), now);

        // ─── Innovation B: Check predictive_cache ───
        let predictiveContextPreLoaded = false;
        let predictivePreloadedMemories = [];
        let predictiveTriggerFile = null;
        try {
          const pcRow = db.prepare(`
            SELECT * FROM predictive_cache
            WHERE project = ? AND consumed = 0 AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
          `).get(projectId, now);
          if (pcRow) {
            predictiveContextPreLoaded = true;
            predictiveTriggerFile = pcRow.trigger_file;
            predictivePreloadedMemories = JSON.parse(pcRow.pre_retrieved_memories || "[]");
            db.prepare("UPDATE predictive_cache SET consumed = 1 WHERE id = ?").run(pcRow.id);
          }
        } catch (e) {}

        // ─── Innovation C (Full): Cross-agent pheromone activity ───
        let otherAgentActivity = [];
        try {
          const agentId = args.agent_id || "default";
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
          otherAgentActivity = db.prepare(`
            SELECT agent_id, action_type, outcome, created_at, source_memory_id
            FROM pheromone_trails
            WHERE project = ? AND agent_id != ? AND created_at > ?
            ORDER BY created_at DESC LIMIT 5
          `).all(projectId, agentId, sevenDaysAgo);
        } catch (e) {}

        // ─── Innovation D: Cognitive fingerprint ───
        let cognitiveContext = null;
        try {
          const fp = db.prepare("SELECT * FROM cognitive_fingerprint WHERE id = ?").get(`fp_${projectId}`);
          if (fp) {
            const currentHour = new Date().getHours();
            const isPeakWindow = currentHour >= fp.peak_hour_start && currentHour <= fp.peak_hour_end;
            cognitiveContext = {
              work_style: fp.work_style,
              cognitive_style: fp.cognitive_style,
              primary_memory_type: fp.primary_memory_type,
              peak_window: `${fp.peak_hour_start}:00 - ${fp.peak_hour_end}:00`,
              is_peak_now: isPeakWindow,
              decision_reversal_rate: fp.decision_reversal_rate,
              mental_model_clusters: JSON.parse(fp.mental_model_clusters || "[]"),
              message: isPeakWindow
                ? `You're in your peak quality window (${fp.peak_hour_start}:00-${fp.peak_hour_end}:00). Your style: ${fp.cognitive_style}.`
                : `Outside peak window. Your peak is ${fp.peak_hour_start}:00-${fp.peak_hour_end}:00. Style: ${fp.cognitive_style}.`
            };
          }
        } catch (e) {}

        // ─── Innovation F: Onboarding brief for new projects ───
        if (!lastSession) {
          // First time for this project — build onboarding brief from any existing data
          let onboardingBrief = {
            status: "onboarding",
            message: "First session for this project. Building context from available data.",
            project: projectId
          };
          try {
            const inheritanceResult = runMemoryInheritance(projectId);
            const distillations = db.prepare(
              "SELECT pattern FROM semantic_distillations WHERE project = ? ORDER BY strength DESC LIMIT 5"
            ).all(projectId);
            const criticalFiles = db.prepare(
              "SELECT id, filepath, bug_count, edit_count FROM code_nodes WHERE project = ? ORDER BY bug_count DESC LIMIT 5"
            ).all(projectId);
            const knownBugs = db.prepare(
              "SELECT description, file_path FROM code_bugs WHERE project = ? AND is_active = 1 LIMIT 3"
            ).all(projectId);
            const keyDecisions = db.prepare(
              "SELECT title, context, chosen_option FROM decisions WHERE project = ? ORDER BY created_at DESC LIMIT 3"
            ).all(projectId);
            onboardingBrief = {
              status: "onboarding",
              message: "First session for this project. Here is what OWL already knows:",
              project: projectId,
              known_patterns: distillations.map(d => d.pattern.slice(0, 150)),
              critical_files: criticalFiles,
              known_bugs: knownBugs,
              key_architectural_decisions: keyDecisions,
              memory_inheritance: inheritanceResult,
              instruction: "You are now oriented. Proceed with full awareness of the project's known state."
            };
          } catch (e) {}
          return { content: [{ type: "text", text: JSON.stringify(onboardingBrief) }] };
        }

        const hoursAgo = Math.round((Date.now() - new Date(lastSession.ended_at).getTime()) / 3600000);
        const pendingDecisions = JSON.parse(lastSession.pending_decisions || "[]");
        const recentMemoryIds = JSON.parse(lastSession.recent_memory_ids || "[]");

        // Check for pending handoff to this agent
        let incomingHandoff = null;
        try {
          const handoffRow = db.prepare(`
            SELECT payload FROM pheromone_trails
            WHERE project = ? AND action_type = 'explicit_handoff'
            ORDER BY created_at DESC LIMIT 1
          `).get(projectId);
          if (handoffRow) {
            incomingHandoff = JSON.parse(handoffRow.payload || "{}");
          }
        } catch (e) {}

        // Fetch content of recent memories
        const recentMemories = recentMemoryIds.map(id => {
          const m = db.prepare("SELECT content, event_type FROM episodic_memories WHERE id = ?").get(id);
          return m ? { content: m.content.slice(0, 150), type: m.event_type } : null;
        }).filter(Boolean);

        // Merge predictive pre-loaded memories with recent memories
        const allContextMemories = [...recentMemories];
        for (const pm of predictivePreloadedMemories) {
          if (!allContextMemories.some(m => m.content === pm.content)) {
            allContextMemories.push({ content: pm.content, type: pm.event_type, source: "predictive_cache" });
          }
        }

        if (format === "brief") {
          // Compact, system-prompt-injectable format — under 400 tokens
          const briefLines = [
            `=== OWL SESSION HANDOFF === Project: ${projectId} | ${hoursAgo}h ago | Tone: ${lastSession.emotional_tone}`,
            `LAST WORKED ON: ${lastSession.summary}`,
            lastSession.last_file ? `ACTIVE FILE: ${lastSession.last_file}` : "",
            lastSession.last_error ? `LAST ERROR: ${lastSession.last_error.slice(0, 120)}` : "",
            pendingDecisions.length ? `PENDING DECISIONS: ${pendingDecisions.map(d => d.title).join(" | ")}` : "",
            threats.length ? `ACTIVE THREATS: ${threats.map(t => t.pattern_name).join(" | ")}` : "",
            predictiveContextPreLoaded ? `PREDICTIVE CONTEXT: ${predictivePreloadedMemories.length} memories pre-loaded from file ${predictiveTriggerFile}` : "",
            cognitiveContext ? `COGNITIVE CONTEXT: ${cognitiveContext.message}` : "",
            `TOKEN SAVINGS TO DATE: ~${Math.round(totalSaved / 1000)}k tokens saved`,
            `=== END HANDOFF ===`
          ].filter(l => l).join("\n");
          return { content: [{ type: "text", text: briefLines }] };
        }

        // ─── Phase 5 Additions: QA summary for resurrection ───
        let qaSummary = { open_bugs: 0, failing_monitors: [], regression_score: 100.0, last_test_run: null, pending_flows: [], knowledge_crystals_count: 0 };
        try {
          const openBugsCount = db.prepare("SELECT COUNT(*) as cnt FROM qa_bugs WHERE status = 'open'").get()?.cnt || 0;
          const failingMonitors = db.prepare("SELECT flow_name, target_url FROM qa_sentinel_monitors WHERE last_status = 'failed' LIMIT 5").all();
          const lastRun = db.prepare("SELECT flow_name, status, bug_count FROM qa_test_runs ORDER BY completed_at DESC LIMIT 1").get();
          const crystalsCount = db.prepare("SELECT COUNT(*) as cnt FROM qa_knowledge_crystals").get()?.cnt || 0;
          
          qaSummary = {
            open_bugs: openBugsCount,
            failing_monitors: failingMonitors.map(m => m.flow_name),
            regression_score: 100.0,
            last_test_run: lastRun ? { flow: lastRun.flow_name, status: lastRun.status, bugs_found: lastRun.bug_count } : null,
            knowledge_crystals_count: crystalsCount
          };
        } catch (e) {}

        // Full format
        return { content: [{ type: "text", text: JSON.stringify({
          status: "resurrected",
          hours_since_last_session: hoursAgo,
          predictive_context_pre_loaded: predictiveContextPreLoaded,
          predictive_trigger_file: predictiveTriggerFile,
          identity: {
            project: projectId,
            last_worked_on: lastSession.summary,
            emotional_tone_last_session: lastSession.emotional_tone
          },
          state: {
            last_active_file: lastSession.last_file,
            last_error: lastSession.last_error,
            pending_decisions: pendingDecisions,
            recent_memories: allContextMemories
          },
          other_agent_activity: otherAgentActivity,
          incoming_handoff: incomingHandoff,
          cognitive_context: cognitiveContext,
          warnings: threats,
          qa_summary: qaSummary,
          efficiency: {
            total_tokens_saved: totalSaved,
            total_tokens_injected: totalInjected,
            efficiency_ratio: totalInjected > 0 ? Math.round((totalSaved / totalInjected) * 10) / 10 : 0,
            message: `OWL has saved approximately ${Math.round(totalSaved / 1000)}k tokens for this project.`
          },
          instruction: "You are now fully context-aware. Proceed without re-asking the user for context."
        }) }] };
      }

      // ═══ Innovation C (Full): Agent Handoff — explicit cross-agent handoff ═══
      if (action === "agent_handoff") {
        try {
          const toAgentId = args.to_agent_id || "unknown_agent";
          const taskSummary = args.task_summary || args.session_summary || "";
          const filesInvolved = args.files_involved || [];

          const handoffPayload = {
            from_agent_id: args.agent_id || "default",
            to_agent_id: toAgentId,
            task_summary: taskSummary,
            files_involved: filesInvolved,
            handoff_at: now
          };

          // Write to pheromone_trails with action_type = 'explicit_handoff'
          db.prepare(`
            INSERT INTO pheromone_trails (source_memory_id, action_type, outcome, strength_delta, agent_id, project, created_at)
            VALUES (?, 'explicit_handoff', 'neutral', 0.0, ?, ?, ?)
          `).run(null, toAgentId, projectId, now);

          // Also write a daemon signal so next perceive surfaces it
          db.prepare("INSERT INTO daemon_signals (signal_type, payload, created_at, consumed) VALUES ('agent_handoff', ?, ?, 0)")
            .run(JSON.stringify(handoffPayload), now);

          return { content: [{ type: "text", text: JSON.stringify({
            status: "handoff_recorded",
            to_agent: toAgentId,
            task_summary: taskSummary,
            files_involved: filesInvolved,
            message: `Handoff recorded. Agent '${toAgentId}' will see this on their first resurrect call.`
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Innovation D: Get Fingerprint ═══
      if (action === "get_fingerprint") {
        try {
          const fp = db.prepare("SELECT * FROM cognitive_fingerprint WHERE id = ?").get(`fp_${projectId}`);
          if (!fp) {
            return { content: [{ type: "text", text: JSON.stringify({
              status: "no_fingerprint",
              message: "No cognitive fingerprint yet. Run nexus.dream at least once to generate it.",
              project: projectId
            }) }] };
          }
          return { content: [{ type: "text", text: JSON.stringify({
            status: "found",
            project: projectId,
            fingerprint: {
              work_style: fp.work_style,
              peak_hours: `${fp.peak_hour_start}:00 - ${fp.peak_hour_end}:00`,
              avg_session_length_minutes: fp.avg_session_length_minutes,
              decision_reversal_rate: fp.decision_reversal_rate,
              primary_memory_type: fp.primary_memory_type,
              mental_model_clusters: JSON.parse(fp.mental_model_clusters || "[]"),
              cognitive_style: fp.cognitive_style,
              total_sessions_analyzed: fp.total_sessions_analyzed,
              updated_at: fp.updated_at
            }
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Innovation B: Get Prediction (debug) ═══
      if (action === "get_prediction") {
        try {
          const pcRow = db.prepare(`
            SELECT * FROM predictive_cache
            WHERE project = ? AND consumed = 0 AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
          `).get(projectId, now);
          if (!pcRow) {
            return { content: [{ type: "text", text: JSON.stringify({
              status: "no_active_prediction",
              message: "No unexpired predictive cache entry. Save a file in the monitored workspace to generate one.",
              project: projectId
            }) }] };
          }
          return { content: [{ type: "text", text: JSON.stringify({
            status: "found",
            project: projectId,
            trigger_file: pcRow.trigger_file,
            confidence: pcRow.confidence,
            expires_at: pcRow.expires_at,
            predicted_contexts: JSON.parse(pcRow.predicted_contexts || "[]"),
            pre_retrieved_memories: JSON.parse(pcRow.pre_retrieved_memories || "[]"),
            note: "This is a READ-ONLY view. Cache is not consumed. Use resurrect to consume it."
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Innovation F: Archaeology — full file history query ═══
      if (action === "archaeology") {
        try {
          const filePath = args.file_path || args.session_summary || "";
          if (!filePath) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "file_path parameter required" }) }] };
          }

          const baseName = filePath.split("/").pop().split("\\").pop();

          // 1. All episodic memories linked to this file via memory_code_links
          const linkedMemories = db.prepare(`
            SELECT em.id, em.content, em.event_type, em.created_at, em.strength
            FROM episodic_memories em
            JOIN memory_code_links mcl ON mcl.memory_id = em.id
            WHERE mcl.code_node_id LIKE ? AND em.is_active = 1
            ORDER BY em.created_at DESC LIMIT 20
          `).all(`%${filePath}%`);

          // 2. All decisions ever recorded about that file
          const fileDecisions = db.prepare(
            "SELECT title, context, chosen_option, predicted_outcome, actual_outcome, status, created_at FROM decisions WHERE project = ? AND (context LIKE ? OR title LIKE ?) ORDER BY created_at DESC LIMIT 10"
          ).all(projectId, `%${baseName}%`, `%${baseName}%`);

          // 3. All errors linked to that file
          const fileErrors = db.prepare(
            "SELECT id, description, bug_type, created_at, resolution FROM code_bugs WHERE file_path LIKE ? ORDER BY created_at DESC LIMIT 10"
          ).all(`%${filePath}%`);

          // 4. Semantic distillations that mention that file's name
          const relatedDistillations = db.prepare(
            "SELECT pattern, strength, fitness, updated_at FROM semantic_distillations WHERE project = ? AND pattern LIKE ? ORDER BY strength DESC LIMIT 5"
          ).all(projectId, `%${baseName}%`);

          // 5. Pheromone trail outcomes for that file
          const pheromoneOutcomes = db.prepare(`
            SELECT pt.action_type, pt.outcome, pt.agent_id, pt.created_at
            FROM pheromone_trails pt
            JOIN episodic_memories em ON em.id = pt.source_memory_id
            JOIN memory_code_links mcl ON mcl.memory_id = em.id
            WHERE mcl.code_node_id LIKE ? AND pt.project = ?
            ORDER BY pt.created_at DESC LIMIT 10
          `).all(`%${filePath}%`, projectId);

          return { content: [{ type: "text", text: JSON.stringify({
            status: "archaeology_complete",
            file_path: filePath,
            summary: `OWL found ${linkedMemories.length} memories, ${fileDecisions.length} decisions, ${fileErrors.length} errors, ${relatedDistillations.length} patterns about this file.`,
            episodic_memories: linkedMemories,
            decisions: fileDecisions,
            errors: fileErrors,
            semantic_patterns: relatedDistillations,
            pheromone_outcomes: pheromoneOutcomes
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Innovation F: Succession Export ═══
      if (action === "succession_export") {
        try {
          const distillations = db.prepare(
            "SELECT pattern, strength, fitness, created_at FROM semantic_distillations WHERE project = ? ORDER BY strength DESC LIMIT 50"
          ).all(projectId);

          const decisions = db.prepare(
            "SELECT title, context, chosen_option, predicted_outcome, actual_outcome, status, created_at FROM decisions WHERE project = ? ORDER BY created_at DESC LIMIT 30"
          ).all(projectId);

          const recentEpisodics = db.prepare(
            "SELECT content, event_type, strength, created_at FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 30"
          ).all(projectId);

          const fp = db.prepare("SELECT * FROM cognitive_fingerprint WHERE id = ?").get(`fp_${projectId}`);

          const pheromonesSummary = db.prepare(`
            SELECT action_type, outcome, COUNT(*) as count, AVG(strength_delta) as avg_delta
            FROM pheromone_trails WHERE project = ?
            GROUP BY action_type, outcome ORDER BY count DESC LIMIT 20
          `).all(projectId);

          const lastSession = db.prepare(
            "SELECT summary, emotional_tone, ended_at FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1"
          ).get(projectId);

          const exportPackage = {
            export_version: "1.0",
            project: projectId,
            exported_at: now,
            semantic_distillations: distillations,
            key_decisions: decisions,
            recent_episodic_summary: recentEpisodics.map(m => ({ content: m.content.slice(0, 200), type: m.event_type })),
            cognitive_fingerprint: fp ? {
              work_style: fp.work_style,
              peak_hours: `${fp.peak_hour_start}:00-${fp.peak_hour_end}:00`,
              primary_memory_type: fp.primary_memory_type,
              cognitive_style: fp.cognitive_style
            } : null,
            pheromone_summary: pheromonesSummary,
            last_session: lastSession || null
          };

          return { content: [{ type: "text", text: JSON.stringify({
            status: "succession_package_ready",
            package: exportPackage,
            instructions: "Save this JSON. Use nexus.succession_import on the new project to onboard instantly."
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Innovation F: Succession Import ═══
      if (action === "succession_import") {
        try {
          const packageData = args.succession_package || args.memory_data?.content;
          let pkg;
          if (typeof packageData === "string") {
            pkg = JSON.parse(packageData);
          } else if (typeof packageData === "object") {
            pkg = packageData;
          } else {
            return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: "succession_package parameter required (JSON string or object)" }) }] };
          }

          let importedDistillations = 0, importedDecisions = 0, importedMemories = 0;

          // Import semantic distillations
          for (const d of (pkg.semantic_distillations || [])) {
            const distId = generateId(d.pattern, projectId + "_import");
            db.prepare(`
              INSERT OR IGNORE INTO semantic_distillations (id, project, pattern, strength, fitness, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(distId, projectId, d.pattern, d.strength || 1.0, d.fitness || 0.5, now, now);
            importedDistillations++;
          }

          // Import decisions (as informational)
          for (const d of (pkg.key_decisions || [])) {
            const decId = generateId(d.title + d.created_at, "succession");
            db.prepare(`
              INSERT OR IGNORE INTO decisions (id, title, context, chosen_option, predicted_outcome, actual_outcome, status, project, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)
            `).run(decId, d.title, d.context, d.chosen_option, d.predicted_outcome, d.actual_outcome, projectId, now);
            importedDecisions++;
          }

          // Import recent episodic summary as semantic memories
          for (const m of (pkg.recent_episodic_summary || [])) {
            const memId = generateId(m.content, projectId + "_succession");
            const emotional = detectEmotionalSalience(m.content);
            db.prepare(`
              INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, source, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, 'succession_import', ?, ?)
            `).run(memId, m.content, m.type || "observation", projectId, emotional.valence, emotional.arousal, emotional.salience, now, now);
            importedMemories++;
          }

          return { content: [{ type: "text", text: JSON.stringify({
            status: "succession_import_complete",
            project: projectId,
            imported: {
              semantic_distillations: importedDistillations,
              decisions: importedDecisions,
              episodic_memories: importedMemories
            },
            source_project: pkg.project || "unknown",
            message: `Onboarding complete. Imported ${importedDistillations} patterns, ${importedDecisions} decisions, ${importedMemories} memories from predecessor project.`
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }

      // ═══ Phase 4 Unification: 'do' — Universal Action Router ═══
      if (action === "do") {
        try {
          const goal = (args.goal || args.session_summary || "").toLowerCase();
          let routedTo = null;
          let result = null;

          // URL detection -> web routing
          if (goal.match(/https?:\/\/[^\s]+/) || goal.includes("fetch") || goal.includes("scrape")) {
            routedTo = "web_fetch";
            result = { routed_to: routedTo, message: "URL detected. Use owl-web MCP tool 'web_fetch' or 'web_scrape_adaptive' for this goal.", goal };
          }
          // "what changed on" -> web_diff
          else if (goal.includes("what changed") || goal.includes("diff") || goal.includes("monitor")) {
            routedTo = "web_diff";
            result = { routed_to: routedTo, message: "Change detection goal. Use owl-web MCP tool 'web_diff' or 'web_monitor_start'.", goal };
          }
          // "remember" or "store" -> record memory
          else if (goal.includes("remember") || goal.includes("store") || goal.includes("save")) {
            routedTo = "nexus.record";
            const content = args.goal || "";
            const memId = generateId(content, projectId);
            const emotional = detectEmotionalSalience(content);
            db.prepare(`
              INSERT OR IGNORE INTO episodic_memories (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, created_at, updated_at)
              VALUES (?, ?, 'observation', ?, ?, ?, ?, 1.0, ?, ?)
            `).run(memId, content, projectId, emotional.valence, emotional.arousal, emotional.salience, now, now);
            result = { routed_to: routedTo, memory_id: memId, message: "Memory stored via universal do router." };
          }
          // "what do I know about" -> recall
          else if (goal.includes("what do i know") || goal.includes("recall") || goal.includes("remember what")) {
            routedTo = "nexus.recall";
            const mems = db.prepare("SELECT content, event_type FROM episodic_memories WHERE project = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 10").all(projectId);
            result = { routed_to: routedTo, memories: mems, message: "Recall executed via universal do router." };
          }
          // Research questions (fact-based questions)
          else if (goal.includes("?") || goal.includes("what is") || goal.includes("how to") || goal.includes("explain") || goal.includes("research")) {
            routedTo = "research_quick";
            result = { routed_to: routedTo, message: "Research question detected. Use owl-research MCP tool 'research_quick' for this goal.", goal };
          }
          // File archaeology
          else if (goal.includes("why does") || goal.includes("archaeology") || goal.includes("history of")) {
            routedTo = "nexus.archaeology";
            result = { routed_to: routedTo, message: "File history query detected. Use nexus action 'archaeology' with file_path parameter.", goal };
          }
          // Default: perceive
          else {
            routedTo = "nexus.perceive";
            result = { routed_to: routedTo, message: "No specific routing detected. Falling back to workspace perception. Use nexus.perceive for full context.", goal };
          }

          return { content: [{ type: "text", text: JSON.stringify({
            status: "routed",
            goal: args.goal || "",
            routed_to: routedTo,
            result
          }) }] };
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ status: "error", error: err.message }) }] };
        }
      }


      // ═══ Innovation C: Stigmergy — mark_outcome ═══
      // When something works or fails, mark it so the pheromone trail strengthens or weakens
      if (action === "mark_outcome") {
        const outcome = args.outcome || 'neutral'; // 'success' | 'failure' | 'neutral'
        const context = args.session_summary || ''; // reuse session_summary field
        const agentId = args.agent_id || 'default';

        // Get memories active in recent context (last 20 minutes)
        const recentMems = db.prepare(`
          SELECT id, strength FROM episodic_memories
          WHERE project = ? AND is_active = 1
          ORDER BY created_at DESC LIMIT 10
        `).all(projectId);

        const delta = outcome === 'success' ? 0.3 : outcome === 'failure' ? -0.2 : 0;
        const fitDelta = outcome === 'success' ? 0.1 : outcome === 'failure' ? -0.05 : 0;

        for (const m of recentMems) {
          // Update memory strength as pheromone reinforcement
          db.prepare("UPDATE episodic_memories SET strength = MAX(0.05, MIN(5.0, strength + ?)), fitness_score = MAX(0.0, MIN(1.0, COALESCE(fitness_score, 0.5) + ?)) WHERE id = ?").run(delta, fitDelta, m.id);

          // Log the pheromone trail
          db.prepare(`
            INSERT INTO pheromone_trails (source_memory_id, action_type, outcome, strength_delta, agent_id, project, created_at)
            VALUES (?, 'session_outcome', ?, ?, ?, ?, ?)
          `).run(m.id, outcome, delta, agentId, projectId, now);
        }

        // Also update semantic distillations related to this context
        if (context) {
          const relatedDistillations = db.prepare(
            "SELECT id FROM semantic_distillations WHERE project = ? AND pattern LIKE ?"
          ).all(projectId, `%${context.slice(0, 20)}%`);
          for (const d of relatedDistillations) {
            const scoreAdj = outcome === 'success' ? 0.1 : outcome === 'failure' ? -0.1 : 0;
            db.prepare("UPDATE semantic_distillations SET outcome_score = outcome_score + ?, fitness = MIN(1.0, MAX(0.0, fitness + ?)), updated_at = ? WHERE id = ?").run(scoreAdj, scoreAdj, now, d.id);
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({
          status: 'outcome_marked',
          outcome,
          memories_updated: recentMems.length,
          pheromone_delta: delta,
          message: outcome === 'success'
            ? `Pheromone boost applied to ${recentMems.length} recent memories. Successful paths strengthened.`
            : outcome === 'failure'
            ? `Pheromone penalty applied to ${recentMems.length} recent memories. Failed paths weakened.`
            : `Neutral outcome recorded.`
        }) }] };
      }

      // \u2550\u2550\u2550 Innovation 2: Cognitive Echo \u2550\u2550\u2550
      // Extract high-value insights from an AI response and store them automatically
      if (action === "echo") {
        const aiOutput = args.ai_output || "";
        const extracted = [];

        // Pattern matching for high-value AI cognition signals
        const insightPatterns = [
          { regex: /the (?:bug|issue|problem|error) is (?:in|at|caused by) ([^.\n]{10,120})/gi, type: "insight" },
          { regex: /(?:warning|risk|caution|danger|watch out)[:\s]+([^.\n]{10,120})/gi, type: "error" },
          { regex: /(?:i (?:recommend|suggest)|recommendation)[:\s]+([^.\n]{10,120})/gi, type: "decision" },
          { regex: /(?:the fix|solution|resolution)[:\s]+([^.\n]{10,120})/gi, type: "learning" },
          { regex: /(?:discovered|found|noticed|learned)[:\s]+([^.\n]{10,120})/gi, type: "insight" }
        ];

        for (const { regex, type } of insightPatterns) {
          let match;
          while ((match = regex.exec(aiOutput)) !== null) {
            const content = match[1].trim();
            if (content.length > 15) {
              extracted.push({ content: content.slice(0, 200), event_type: type, confidence: 0.85 });
            }
          }
        }

        // Auto-store high-confidence extractions
        const stored = [];
        for (const e of extracted.slice(0, 5)) {
          const corrections = checkHallucinations(e.content, projectId);
          let finalContent = e.content;
          if (corrections && corrections.length > 0) {
            finalContent = e.content + " | " + corrections.map(c => c.message).join(" | ");
          }

          const memId = generateId(finalContent, projectId + "_echo");
          const emotional = detectEmotionalSalience(finalContent);
          db.prepare(`
            INSERT OR IGNORE INTO episodic_memories
              (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, 'cognitive_echo', ?, ?)
          `).run(memId, finalContent, e.event_type, projectId, emotional.valence, emotional.arousal, Math.max(0.7, emotional.salience), now, now);
          
          // Crystallize specific knowledge
          crystallizeSpecificKnowledge(finalContent, projectId);
          
          stored.push({ memory_id: memId, content: finalContent, type: e.event_type });
        }

        return { content: [{ type: "text", text: JSON.stringify({
          status: "echo_complete",
          extracted_count: extracted.length,
          stored_count: stored.length,
          stored_memories: stored,
          message: stored.length > 0
            ? `Captured ${stored.length} insight(s) from your response into OWL memory.`
            : "No high-confidence insights detected in this response."
        }) }] };
      }
    }

    // ═══════════════════════════════════════════════════
    // COLLAPSED V6 PARALLEL TOOLS
    // ═══════════════════════════════════════════════════

    if (name === "owl.nexus") {
      const context = args.context;
      const action = args.action; // optional override
      const project = args.project || "default";

      // 1. Is the answer already in memory? (Memory-First check)
      const mems = db.prepare("SELECT content, salience FROM episodic_memories WHERE project = ? AND is_active = 1").all(project);
      let bestMatch = null;
      let maxSim = 0;
      for (const m of mems) {
        const sim = calculateSimilarity(context, m.content);
        if (sim > maxSim) {
          maxSim = sim;
          bestMatch = m;
        }
      }

      if (maxSim > 0.8 && (!action || action === "recall")) {
        const responseText = JSON.stringify({
          status: "success",
          source: "owl_memory_cache",
          confidence: maxSim,
          content: bestMatch.content,
          message: "Returned from OWL memory cache. No network call or LLM call made."
        });
        return { content: [{ type: "text", text: responseText }] };
      }

      // 2. Decide routing if not resolved from cache
      let routedAction = action;
      if (!routedAction) {
        const lowerContext = context.toLowerCase();
        if (lowerContext.match(/https?:\/\/[^\s]+/) || lowerContext.includes("fetch") || lowerContext.includes("scrape")) {
          routedAction = "fetch";
        } else if (lowerContext.includes("research") || lowerContext.includes("explain") || lowerContext.includes("how to") || lowerContext.includes("what is") || lowerContext.includes("?")) {
          routedAction = "research";
        } else {
          routedAction = "recall";
        }
      }

      if (routedAction === "fetch") {
        const urlMatch = context.match(/https?:\/\/[^\s]+/);
        const url = urlMatch ? urlMatch[0] : null;
        if (url) {
          const fetchResult = callPythonTool("fetch", { url: url, mode: "static" });
          return { content: [{ type: "text", text: JSON.stringify(fetchResult) }] };
        }
      }

      if (routedAction === "research") {
        const researchResult = callPythonTool("research", { topic: context, depth: "medium", project: project });
        return { content: [{ type: "text", text: JSON.stringify(researchResult) }] };
      }

      // Default fallback: recall
      const recallMems = mems.map(m => ({
        id: m.id,
        content: m.content,
        score: Math.round(calculateSimilarity(context, m.content) * 100) / 100
      })).sort((a, b) => b.score - a.score).slice(0, 5);

      return { content: [{ type: "text", text: JSON.stringify({ status: "success", local_matches: recallMems }) }] };
    }

    if (name === "owl.remember") {
      const content = args.content;
      const modality = args.modality || "text";
      const project = args.project || "default";

      if (modality !== "text") {
        const codexId = storeCodexMemory(content, modality, null, [], project);
        return { content: [{ type: "text", text: JSON.stringify({ status: "success", memory_id: codexId, type: "codex" }) }] };
      } else {
        const memId = generateId(content, project);
        const emotional = detectEmotionalSalience(content);
        db.prepare("INSERT INTO episodic_memories (id, content, project, emotional_valence, emotional_arousal, salience, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(memId, content, project, emotional.valence, emotional.arousal, emotional.salience, now, now);
        return { content: [{ type: "text", text: JSON.stringify({ status: "success", memory_id: memId, type: "episodic" }) }] };
      }
    }

    if (name === "owl.recall") {
      const query = args.query;
      const project = args.project || "default";
      const mems = db.prepare("SELECT * FROM episodic_memories WHERE project = ? AND is_active = 1").all(project);
      
      const matches = mems.map(m => ({
        id: m.id,
        content: m.content,
        score: Math.round(calculateSimilarity(query, m.content) * 100) / 100
      })).sort((a, b) => b.score - a.score).slice(0, 10);

      // Hebbian strengthening & reconconsolidation
      const emotional = detectEmotionalSalience(query);
      for (const m of matches.slice(0, 3)) {
        if (m.score > 0.35) {
          reconsolidateMemory(m.id, emotional);
        }
      }

      const crossMatches = queryCrossProjectKnowledge(query, project);
      const responsePayload = {
        status: "success",
        local_matches: matches,
        cross_project_matches: crossMatches
      };

      const tokensInjected = Math.round(JSON.stringify(responsePayload).length / 4);
      db.prepare(
        "INSERT INTO token_ledger (project, tool_called, tokens_injected, tokens_saved_estimate, created_at) VALUES (?, 'owl.recall', ?, ?, ?)"
      ).run(project, tokensInjected, tokensInjected * 10, now);

      return { content: [{ type: "text", text: JSON.stringify(responsePayload) }] };
    }

    if (name === "owl.research") {
      const topic = args.topic;
      const depth = args.depth || "medium";
      const project = args.project || "default";
      const activeFile = args.active_file || "";

      const researchResult = callPythonTool("research", { topic, depth, project, active_file: activeFile });
      return { content: [{ type: "text", text: JSON.stringify(researchResult) }] };
    }

    if (name === "owl.fetch") {
      const url = args.url;
      const mode = args.mode || "static";

      const fetchResult = callPythonTool("fetch", { url, mode });
      return { content: [{ type: "text", text: JSON.stringify(fetchResult) }] };
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

  // Memory node
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

  // 1. Fetch Episodic Memories
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

  // 2. Fetch Semantic Memories
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

  // 3. Fetch Procedural Memories
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

  // 4. Fetch Somatic Memories
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

  // 5. Fetch Code Nodes
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

  // 6. Fetch Code Bugs
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

  // 7. Fetch Decisions
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

  // 8. Fetch Threat Patterns
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

  // Generate 10-year-old child style explanations for all nodes
  for (const node of nodes) {
    node.simple_explanation = generate10YearOldExplanation(node);
  }

  const nodeIds = new Set(nodes.map(n => n.id));

  // 9. Fetch Code Edges
  const codeEdges = db.prepare("SELECT * FROM code_edges").all();
  for (const e of codeEdges) {
    edges.push({ source: e.source_id, target: e.target_id, type: e.edge_type || "calls" });
  }

  // 10. Fetch Memory-Code Links
  const memLinks = db.prepare("SELECT * FROM memory_code_links").all();
  for (const l of memLinks) {
    edges.push({ source: l.memory_id, target: l.code_node_id, type: l.link_type || "associated" });
  }

  // 11. Fetch Synaptic Weights
  const synWeights = db.prepare("SELECT * FROM synaptic_weights").all();
  for (const w of synWeights) {
    edges.push({ source: w.source_id, target: w.target_id, type: "synaptic", weight: w.attention_weight });
  }

  // 12. Fetch Causal Links
  const causalLinks = db.prepare("SELECT * FROM causal_links").all();
  for (const c of causalLinks) {
    edges.push({ source: c.cause_id, target: c.effect_id, type: c.link_type || "causes" });
  }

  // Filter out invalid edges (dangling links)
  const cleanEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  return { nodes, edges: cleanEdges };
}

server.setRequestHandler(ListResourcesRequestSchema, async () => [
  { uri: "owl-memory://graph", name: "Memory Graph v5", description: "V5 memory nodes and call links", mimeType: "application/json" },
  { uri: "owl-memory://graph-ui", name: "Memory Graph UI", description: "Interactive force-directed graph visualization with 10-year-old explanations", mimeType: "text/html" },
  { uri: "owl-memory://handoff", name: "Session Handoff Brief", description: "Compact session state for injecting into a new AI session's system prompt. Read this at the start of any new session.", mimeType: "text/plain" },
  { uri: "owl-memory://ledger", name: "Token Ledger", description: "Token savings report showing efficiency of OWL memory injection.", mimeType: "application/json" }
]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === "owl-memory://graph") {
    const data = await getGraphData();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] };
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

  // ═══ Innovation 4: Handoff Brief Resource ═══
  // Any AI agent (Claude, GPT, Gemini) can read this URI to instantly orient itself
  if (uri === "owl-memory://handoff") {
    const projectId = "default";
    const lastSession = db.prepare(
      "SELECT * FROM session_states WHERE project = ? ORDER BY ended_at DESC LIMIT 1"
    ).get(projectId);
    const threats = db.prepare(
      "SELECT pattern_name FROM threat_patterns WHERE is_active = 1 LIMIT 3"
    ).all();
    const ledger = db.prepare(
      "SELECT SUM(tokens_saved_estimate) as saved FROM token_ledger WHERE project = ?"
    ).get(projectId);

    if (!lastSession) {
      return { contents: [{ uri, mimeType: "text/plain", text: "No prior session found. This is a fresh start." }] };
    }

    const hoursAgo = Math.round((Date.now() - new Date(lastSession.ended_at).getTime()) / 3600000);
    const pendingDecisions = JSON.parse(lastSession.pending_decisions || "[]");
    const lines = [
      `=== OWL MEMORY HANDOFF BRIEF ===`,
      `Project: ${projectId} | Last session: ${hoursAgo}h ago | Mood: ${lastSession.emotional_tone}`,
      ``,
      `WHAT WAS BEING WORKED ON:`,
      lastSession.summary,
      ``,
      lastSession.last_file ? `ACTIVE FILE: ${lastSession.last_file}` : "",
      lastSession.last_error ? `LAST ERROR TO KNOW ABOUT: ${lastSession.last_error.slice(0, 150)}` : "",
      pendingDecisions.length ? `PENDING DECISIONS:\n${pendingDecisions.map(d => `  - ${d.title}: ${d.context ? d.context.slice(0, 80) : ""}`).join("\n")}` : "",
      threats.length ? `ACTIVE THREAT PATTERNS:\n${threats.map(t => `  - ${t.pattern_name}`).join("\n")}` : "",
      ``,
      `TOKEN SAVINGS: ~${Math.round((ledger?.saved || 0) / 1000)}k tokens saved to date.`,
      ``,
      `INSTRUCTION: You are now context-aware. Do not ask the user to re-explain the project. Proceed.`,
      `=== END HANDOFF ===`
    ].filter(l => l !== null && l !== undefined).join("\n");

    return { contents: [{ uri, mimeType: "text/plain", text: lines }] };
  }

  // ═══ Innovation 3: Token Ledger Resource ═══
  if (uri === "owl-memory://ledger") {
    const projectId = "default";
    const totals = db.prepare(
      "SELECT SUM(tokens_injected) as total_injected, SUM(tokens_saved_estimate) as total_saved, COUNT(*) as calls FROM token_ledger WHERE project = ?"
    ).get(projectId);
    const byTool = db.prepare(
      "SELECT tool_called, SUM(tokens_injected) as injected, SUM(tokens_saved_estimate) as saved, COUNT(*) as calls FROM token_ledger WHERE project = ? GROUP BY tool_called"
    ).all(projectId);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({
      project: projectId,
      total_tokens_saved: totals?.total_saved || 0,
      total_tokens_injected: totals?.total_injected || 0,
      total_calls: totals?.calls || 0,
      by_tool: byTool
    }) }] };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Hermes v7.0: runQADreamCycle helper
function runQADreamCycle(projectId) {
  const result = { fitness_updates: 0, bug_patterns_crystallized: 0, oracle_updated: 0 };
  
  // 1. Darwin fitness update
  try {
    const genomes = db.prepare("SELECT * FROM qa_test_genome WHERE project = ? AND run_count > 10").all(projectId);
    for (const g of genomes) {
      if (g.fitness_score < 0.2) {
        db.prepare("UPDATE qa_test_genome SET mutation_type = 'weak_pruned', fitness_score = 0.0, updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), g.id);
        result.fitness_updates++;
      } else if (g.fitness_score > 0.8) {
        db.prepare("UPDATE qa_test_genome SET generation = generation + 1, updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), g.id);
        result.fitness_updates++;
      }
    }
  } catch (e) {}

  // 2. Bug pattern crystallization (Tesla resonance)
  try {
    const bugClusters = db.prepare(`
      SELECT bug_type, COUNT(*) as cnt FROM qa_bugs 
      WHERE project = ? AND status = 'open' 
      GROUP BY bug_type HAVING cnt >= 3
    `).all(projectId);
    for (const cluster of bugClusters) {
      const bugType = cluster.bug_type;
      const patternName = `resonance_${bugType}_cluster`;
      const crystalId = generateId(patternName, projectId);
      
      db.prepare(`
        INSERT OR IGNORE INTO qa_bug_resonance 
          (id, pattern_name, trigger_conditions_json, bug_type, confidence, times_confirmed, project, created_at)
        VALUES (?, ?, ?, ?, 0.8, 1, ?, ?)
      `).run(
        crystalId, 
        patternName, 
        JSON.stringify({ bug_type: bugType }), 
        bugType, 
        projectId,
        new Date().toISOString()
      );
      result.bug_patterns_crystallized++;
    }
  } catch (e) {}

  // 3. Oracle update from passed steps
  try {
    const passedSteps = db.prepare(`
      SELECT s.target_selector, s.action_type, s.actual_state 
      FROM qa_test_steps s
      JOIN qa_test_runs r ON s.run_id = r.id
      WHERE r.project = ? AND s.passed = 1 LIMIT 50
    `).all(projectId);
    for (const step of passedSteps) {
      if (step.target_selector && step.actual_state) {
        const oracleId = generateId(step.target_selector, projectId);
        db.prepare(`
          INSERT OR REPLACE INTO qa_behavior_oracle 
            (id, target_url, flow_name, step_name, expected_state_json, confidence, observations_count, project, created_at)
          VALUES (?, '', 'flow', ?, ?, 0.9, 1, ?, ?)
        `).run(
          oracleId, 
          step.target_selector, 
          JSON.stringify({ state: step.actual_state }), 
          projectId,
          new Date().toISOString()
        );
        result.oracle_updated++;
      }
    }
  } catch (e) {}

  return result;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  warmupNER();
  console.error(`OWL Memory MCP v5.0 — UNS Engine running on stdio`);

  // Launch background daemon automatically
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
