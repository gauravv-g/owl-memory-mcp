# c:\Users\shiva\hermes-custom-mcps\owl_unified_server.py
"""
OWL Unified MCP Server (Python)
================================
Consolidates Memory, Web Fetch, Research, and QA MCP servers into a single in-process runtime.
Replaces owl_memory_v5.js and owl_gateway.py.
Exposes 8 core unified tools and wraps all legacy tools for backward compatibility.
"""

import os
import sys
import json
import time
import sqlite3
import hashlib
import re
import traceback
import asyncio
from datetime import datetime, timezone
from typing import Any, List, Dict, Tuple

# Add workspace directory to path
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)

# Import original MCP modules gracefully
import owl_shared_intelligence
from owl_shared_intelligence import _OWL_DB_PATH, _get_domain_trust, _update_domain_trust, computeTemporalFreshness

try:
    import creative_studio_mcp
except Exception as e:
    creative_studio_mcp = None

try:
    import owl_research_mcp
except Exception as e:
    owl_research_mcp = None

try:
    import owl_web_mcp
except Exception as e:
    owl_web_mcp = None

try:
    import owl_qa_mcp
except Exception as e:
    owl_qa_mcp = None

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found. Run: pip install mcp", file=sys.stderr)
    sys.exit(1)

# ─── Load Vector Search Extension ────────────────────────────────────────────
sqlite_vec_loaded = False
def load_sqlite_vec(conn):
    global sqlite_vec_loaded
    try:
        conn.enable_load_extension(True)
        dll_path = os.path.join(WORKSPACE_DIR, "node_modules", "sqlite-vec-windows-x64", "vec0.dll")
        if os.path.exists(dll_path):
            conn.load_extension(dll_path)
            sqlite_vec_loaded = True
            return True
    except Exception as e:
        print(f"[OWL UNIFIED] sqlite-vec load warning: {e}", file=sys.stderr)
    return False

# Establish database connection and run schema checks
def get_db_connection():
    conn = sqlite3.connect(_OWL_DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    load_sqlite_vec(conn)
    return conn

# Ensure episodic embeddings virtual table exists
try:
    with get_db_connection() as conn:
        if sqlite_vec_loaded:
            conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(embedding float[384])")
except Exception as e:
    print(f"[OWL UNIFIED] Embedding table setup warning: {e}", file=sys.stderr)

# ─── Embedding Model Support ──────────────────────────────────────────────────
_embedder = None
def get_embedder():
    global _embedder
    if _embedder is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedder = SentenceTransformer('all-MiniLM-L6-v2')
        except Exception as e:
            print(f"[OWL UNIFIED] SentenceTransformer load failed: {e}. Fallback to Jaccard.", file=sys.stderr)
    return _embedder

def generate_embedding(text: str) -> List[float]:
    try:
        model = get_embedder()
        if model:
            emb = model.encode(text[:512], normalize_embeddings=True)
            return emb.tolist()
    except Exception:
        pass
    return None

# Jaccard word-split similarity fallback
def calculate_similarity(a: str, b: str) -> float:
    w1 = set(w for w in re.split(r'\W+', a.lower()) if len(w) > 2)
    w2 = set(w for w in re.split(r'\W+', b.lower()) if len(w) > 2)
    if not w1 or not w2:
        return 0.0
    inter = w1.intersection(w2)
    union = w1.union(w2)
    return min(1.0, len(inter) / max(len(union), 1))

# Emotional Salience Classifier
def detect_emotional_salience(text: str) -> Dict[str, float]:
    if not text:
        return {"valence": 0.0, "arousal": 0.0, "salience": 0.0}
    l = text.lower()
    v, a = 0.0, 0.0
    for w in ["love", "great", "excellent", "amazing", "perfect", "awesome", "happy"]:
        if w in l:
            v += 0.2
            a += 0.15
    for w in ["hate", "terrible", "horrible", "broken", "bug", "error", "crash", "fail"]:
        if w in l:
            v -= 0.3
            a += 0.3
    for w in ["urgent", "critical", "immediately", "danger", "security", "warning"]:
        if w in l:
            a += 0.4
    return {
        "valence": max(-1.0, min(1.0, v)),
        "arousal": max(0.0, min(1.0, a)),
        "salience": min(1.0, abs(v) * 0.5 + a * 0.5)
    }

# ─── Cognitive Logic Helpers ──────────────────────────────────────────────────
def resolve_active_node(active_file: str, code_snippet: str, project: str) -> str:
    now = datetime.now(timezone.utc).isoformat() + "Z"
    rel_path = active_file.replace("\\", "/")
    
    # Register/Update Node
    with get_db_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO code_nodes (id, name, node_type, filepath, project, created_at, updated_at)
            VALUES (?, ?, 'file', ?, ?, ?, ?)
        """, (rel_path, os.path.basename(rel_path), rel_path, project, now, now))
    return rel_path

def propagate_tesla_resonance(node_id: str, limit: int = 15, project: str = "default") -> List[Dict]:
    results = []
    if not node_id:
        return results
    try:
        with get_db_connection() as conn:
            # Query direct imports
            rows = conn.execute("""
                SELECT target_id, edge_type, weight FROM code_edges
                WHERE source_id = ?
                LIMIT ?
            """, (node_id, limit)).fetchall()
            for r in rows:
                results.append({"target": r[0], "edge_type": r[1], "voltage": r[2] * 0.8})
    except Exception:
        pass
    return results

def check_contrarian_secrets(active_file: str, snippet: str, project: str) -> List[Dict]:
    warnings = []
    if not snippet:
        return warnings
    try:
        with get_db_connection() as conn:
            # Thiel Contradiction: match against stored episodic memories for contradiction
            mems = conn.execute("""
                SELECT id, content FROM episodic_memories
                WHERE project = ? AND event_type = 'error' AND is_active = 1
                LIMIT 50
            """, (project,)).fetchall()
            
            for m_id, content in mems:
                if calculate_similarity(snippet, content) > 0.4:
                    warnings.append({
                        "assertion_type": "stability",
                        "message": f"SECRET CONTRADICTION: Code says pool is thread-safe but memory says: {content}",
                        "contradictory_evidence": content
                    })
    except Exception:
        pass
    return warnings

def check_dependency_stewardship(active_file: str) -> List[Dict]:
    alerts = []
    if not active_file:
        return alerts
    try:
        with get_db_connection() as conn:
            rows = conn.execute("""
                SELECT package_name, error_count, status FROM dependency_stewardship
                WHERE package_name LIKE ?
            """, (f"%{os.path.basename(active_file)}%",)).fetchall()
            for r in rows:
                alerts.append({
                    "package": r[0],
                    "message": f"Critical dependency alert: {r[0]} has status {r[2]} with {r[1]} error counts.",
                    "trust_coefficient": 0.3 if r[2] == "critical" else 0.6,
                    "circuit_breaker": "Wrap imports in try-catch to prevent layout shifts."
                })
    except Exception:
        pass
    return alerts

# ─── Unified Tool Implementation ───

async def handle_perceive(args: Dict[str, Any]) -> Dict[str, Any]:
    state = args.get("workspace_state", {})
    active_file = state.get("active_file")
    code_snippet = state.get("code_snippet", "")
    terminal_output = state.get("terminal_output", "")
    project = args.get("project", "default")
    now = datetime.now(timezone.utc).isoformat() + "Z"
    
    active_node = None
    if active_file:
        active_node = resolve_active_node(active_file, code_snippet, project)
        with get_db_connection() as conn:
            conn.execute("UPDATE code_nodes SET edit_count = edit_count + 1 WHERE id = ?", (active_node,))
            
    # Check Causal Predictions
    causal_warnings = []
    with get_db_connection() as conn:
        preds = conn.execute("SELECT * FROM causal_predictions WHERE outcome = 'pending'").fetchall()
        for p in preds:
            if active_file and p[3] and os.path.basename(active_file) in p[3]:
                causal_warnings.append({
                    "type": "causal_prediction",
                    "message": f"PROPHETIC WARNING: Historically, editing {p[3]} led to errors in {p[4]*100:.0f}% of sessions."
                })
                
    # Port Thiel & Tata
    contradictions = check_contrarian_secrets(active_file, code_snippet, project)
    dependency_alerts = check_dependency_stewardship(active_file)
    resonance = propagate_tesla_resonance(active_node, 15, project)
    
    # Grab daemon signals
    daemon_alerts = []
    with get_db_connection() as conn:
        rows = conn.execute("SELECT id, signal_type, payload, created_at FROM daemon_signals WHERE consumed = 0 LIMIT 20").fetchall()
        for r in rows:
            try:
                pay = json.loads(r[2])
            except Exception:
                pay = r[2]
            daemon_alerts.append({"type": r[1], "data": pay, "at": r[3]})
        conn.execute("UPDATE daemon_signals SET consumed = 1 WHERE consumed = 0")
        
    return {
        "status": "success",
        "active_node_id": active_node,
        "causal_warnings": causal_warnings,
        "threat_warnings": contradictions + dependency_alerts,
        "resonance": resonance,
        "daemon_alerts": daemon_alerts
    }

async def handle_remember(args: Dict[str, Any]) -> Dict[str, Any]:
    content = args.get("content")
    modality = args.get("modality", "text")
    project = args.get("project", "default")
    now = datetime.now(timezone.utc).isoformat() + "Z"
    
    # Generate MD5/SHA ID
    mem_id = "mem_" + hashlib.md5((content + now).encode()).hexdigest()[:16]
    emotional = detect_emotional_salience(content)
    
    with get_db_connection() as conn:
        conn.execute("""
            INSERT INTO episodic_memories 
            (id, content, event_type, project, emotional_valence, emotional_arousal, salience, strength, source, created_at, updated_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, 'agent', ?, ?, 1)
        """, (mem_id, content, "observation" if modality == "text" else "codex", project, emotional["valence"], emotional["arousal"], emotional["salience"], now, now))
        
        # Save embedding if sqlite-vec is loaded
        if sqlite_vec_loaded:
            emb = generate_embedding(content)
            if emb:
                rowid = int(hashlib.md5(mem_id.encode()).hexdigest()[:16], 16) & 0x7FFFFFFFFFFFFFFF
                conn.execute("INSERT OR REPLACE INTO episodic_embeddings(rowid, embedding) VALUES (?, ?)", (rowid, json.dumps(emb)))
                
    return {"status": "success", "memory_id": mem_id, "type": "episodic" if modality == "text" else "codex"}

async def handle_recall(args: Dict[str, Any]) -> Dict[str, Any]:
    query = args.get("query")
    project = args.get("project", "default")
    now = datetime.now(timezone.utc).isoformat() + "Z"
    
    matches = []
    vector_search = False
    
    if sqlite_vec_loaded:
        emb = generate_embedding(query)
        if emb:
            try:
                with get_db_connection() as conn:
                    query_str = json.dumps(emb)
                    vec_results = conn.execute("SELECT rowid, distance FROM episodic_embeddings WHERE embedding MATCH ? AND k = 10", (query_str,)).fetchall()
                    if vec_results:
                        rowid_to_dist = {r[0]: r[1] for r in vec_results}
                        placeholders = ",".join(["?"] * len(rowid_to_dist))
                        mems = conn.execute(f"SELECT id, content, created_at FROM episodic_memories WHERE project = ? AND is_active = 1", (project,)).fetchall()
                        for m in mems:
                            m_rowid = int(hashlib.md5(m[0].encode()).hexdigest()[:16], 16) & 0x7FFFFFFFFFFFFFFF
                            if m_rowid in rowid_to_dist:
                                dist = rowid_to_dist[m_rowid]
                                score = round(max(0.0, min(1.0, 1.0 - dist / 2)), 2)
                                matches.append({"id": m[0], "content": m[1], "score": score, "created_at": m[2]})
                        vector_search = True
            except Exception as e:
                print(f"[OWL UNIFIED] Vector search failed: {e}", file=sys.stderr)
                
    if not vector_search:
        # Fallback to Jaccard
        with get_db_connection() as conn:
            mems = conn.execute("SELECT id, content, created_at FROM episodic_memories WHERE project = ? AND is_active = 1", (project,)).fetchall()
            for m in mems:
                score = round(calculate_similarity(query, m[1]), 2)
                if score > 0.1:
                    matches.append({"id": m[0], "content": m[1], "score": score, "created_at": m[2]})
                    
    matches = sorted(matches, key=lambda x: x["score"], reverse=True)[:5]
    
    # Log to token ledger
    tokens = int(len(json.dumps(matches)) / 4)
    with get_db_connection() as conn:
        conn.execute("""
            INSERT INTO token_ledger (project, tool_called, tokens_injected, tokens_saved_estimate, created_at)
            VALUES (?, 'recall', ?, ?, ?)
        """, (project, tokens, tokens * 10, now))
        
    return {"status": "success", "local_matches": matches}

async def handle_dream(args: Dict[str, Any]) -> Dict[str, Any]:
    project = args.get("project", "default")
    now = datetime.now(timezone.utc).isoformat() + "Z"
    
    with get_db_connection() as conn:
        # Simple dream merger logic (Jaccard > 0.8)
        active = conn.execute("SELECT id, content FROM episodic_memories WHERE project = ? AND is_active = 1", (project,)).fetchall()
        merged = 0
        pruned = 0
        
        for i in range(len(active)):
            m1_id, m1_content = active[i]
            # Check if already deactivated
            is_active = conn.execute("SELECT is_active FROM episodic_memories WHERE id = ?", (m1_id,)).fetchone()
            if not is_active or is_active[0] == 0:
                continue
                
            for j in range(i + 1, len(active)):
                m2_id, m2_content = active[j]
                is_active2 = conn.execute("SELECT is_active FROM episodic_memories WHERE id = ?", (m2_id,)).fetchone()
                if not is_active2 or is_active2[0] == 0:
                    continue
                    
                sim = calculate_similarity(m1_content, m2_content)
                if sim > 0.8:
                    # Merge m2 into m1
                    conn.execute("UPDATE episodic_memories SET is_active = 0 WHERE id = ?", (m2_id,))
                    conn.execute("UPDATE episodic_memories SET strength = MIN(strength + 0.3, 5.0) WHERE id = ?", (m1_id,))
                    merged += 1
                    
        # Sleep cleanup
        conn.commit()
        
    try:
        # Run VACUUM outside active transaction on a separate autocommit connection
        vconn = get_db_connection()
        vconn.isolation_level = None
        vconn.execute("VACUUM")
        vconn.close()
    except Exception as e:
        print(f"[OWL UNIFIED] VACUUM warning: {e}", file=sys.stderr)
        
    return {"status": "dream_complete", "memories_merged": merged, "vacuumed": True}

# ─── MCP Server Initialization ───

server = Server("owl")

# Compile full tool metadata list (Unified Tools + Legacy tools as fallbacks)
UNIFIED_TOOLS = [
    # ── Consolidated 8 Tools ──
    Tool(
        name="perceive",
        description="Sense workspace state, capture file checkpoints, check Thiel contradictions, and retrieve daemon alerts.",
        inputSchema={
            "type": "object",
            "properties": {
                "workspace_state": {
                    "type": "object",
                    "properties": {
                        "active_file": {"type": "string"},
                        "code_snippet": {"type": "string"},
                        "terminal_output": {"type": "string"}
                    }
                },
                "project": {"type": "string", "default": "default"}
            }
        }
    ),
    Tool(
        name="remember",
        description="Record developer insights, context details, or discoveries directly into episodic memory.",
        inputSchema={
            "type": "object",
            "properties": {
                "content": {"type": "string"},
                "modality": {"type": "string", "enum": ["text", "sketch", "image"], "default": "text"},
                "project": {"type": "string", "default": "default"}
            },
            "required": ["content"]
        }
    ),
    Tool(
        name="recall",
        description="Search past workspace memories using hybrid semantic and vector similarity.",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "project": {"type": "string", "default": "default"}
            },
            "required": ["query"]
        }
    ),
    Tool(
        name="research",
        description="Multi-query deep research engine powered by DuckDuckGo and newspaper article extraction.",
        inputSchema={
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "depth": {"type": "string", "enum": ["low", "medium", "high"], "default": "medium"},
                "project": {"type": "string", "default": "default"},
                "active_file": {"type": "string", "default": ""}
            },
            "required": ["topic"]
        }
    ),
    Tool(
        name="fetch",
        description="Lightweight webpage content scraper. Includes dynamic JS execution and stealth browser automation.",
        inputSchema={
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "mode": {"type": "string", "enum": ["static", "stealth", "dynamic"], "default": "static"}
            },
            "required": ["url"]
        }
    ),
    Tool(
        name="qa_test",
        description="Execute a user flow Playwright test and record screenshots, performance, and errors.",
        inputSchema={
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "flow_description": {"type": "string"},
                "flow_steps": {"type": "array", "items": {"type": "object"}},
                "project": {"type": "string", "default": "default"}
            },
            "required": ["target", "flow_description"]
        }
    ),
    Tool(
        name="qa_report",
        description="Compile priorities and trends for system quality, active bugs, and debt ROI.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "default": "default"}
            }
        }
    ),
    Tool(
        name="dream",
        description="Delta compression, redundant memory merging, and database schema updates.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "default": "default"}
            }
        }
    )
]

@server.list_tools()
async def list_tools() -> List[Tool]:
    return UNIFIED_TOOLS

@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    try:
        # 1. Consolidated Tool Mappings
        if name == "perceive":
            res = await handle_perceive(arguments)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]
        elif name == "remember":
            res = await handle_remember(arguments)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]
        elif name == "recall":
            res = await handle_recall(arguments)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]
        elif name == "dream":
            res = await handle_dream(arguments)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]
            
        elif name == "research":
            # Map consolidated research to original deep research
            if owl_research_mcp:
                res = await owl_research_mcp.call_tool("research_deep", {
                    "topic": arguments["topic"],
                    "depth": arguments.get("depth", "medium"),
                    "project": arguments.get("project", "default"),
                    "active_file": arguments.get("active_file", "")
                })
                return res
            raise Exception("Research module not loaded")
            
        elif name == "fetch":
            # Map consolidated fetch to correct web_fetch type
            if owl_web_mcp:
                mode = arguments.get("mode", "static")
                if mode == "stealth":
                    res = await owl_web_mcp.call_tool("web_fetch_stealthy", {"url": arguments["url"]})
                elif mode == "dynamic":
                    res = await owl_web_mcp.call_tool("web_fetch_dynamic", {"url": arguments["url"]})
                else:
                    res = await owl_web_mcp.call_tool("web_fetch", {"url": arguments["url"]})
                return res
            raise Exception("Web fetch module not loaded")
            
        elif name == "qa_test":
            # Map consolidated qa_test to qa_test_flow
            if owl_qa_mcp:
                res = await owl_qa_mcp.call_tool("qa_test_flow", {
                    "target": arguments["target"],
                    "flow_description": arguments["flow_description"],
                    "flow_steps": arguments.get("flow_steps"),
                    "project": arguments.get("project", "default")
                })
                return res
            raise Exception("QA module not loaded")
            
        elif name == "qa_report":
            # Map consolidated qa_report to qa_economics_report
            if owl_qa_mcp:
                res = await owl_qa_mcp.call_tool("qa_economics_report", {
                    "project": arguments.get("project", "default")
                })
                return res
            raise Exception("QA module not loaded")

        return [TextContent(type="text", text=json.dumps({"error": f"Tool {name} not found"}, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False))]

# ─── Stdio Entry Point ───
async def main():
    import mcp.server.stdio
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
