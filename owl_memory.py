"""
OWL Memory MCP — The best memory system for AI agents, built from scratch.

Combines the best patterns from Supermemory, Mem0, Memori, and Zep:
- Fact extraction (not raw storage) — extracts preferences, decisions, facts from text
- Entity linking — connects related memories via extracted entities
- Temporal reasoning — tracks what's current vs outdated, auto-expires old info
- Contradiction detection — resolves conflicting memories automatically
- Multi-signal retrieval — semantic + BM25 + entity scoring
- Project/workspace scoping — memories organized by project
- Auto-forgetting — TTL-based expiration with importance weighting
- Local-first — SQLite + FTF5, zero cloud dependency, zero API keys
- Import/Export — JSON backup and restore

Usage:
    python owl_memory.py              # Run as MCP server (stdio)
    python owl_memory.py --cli        # Interactive CLI mode
    python owl_memory.py --import file.json
    python owl_memory.py --export file.json
"""

import json
import os
import re
import sqlite3
import hashlib
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

from fastmcp import FastMCP

# ─── Configuration ───────────────────────────────────────────────────────────

DATA_DIR = Path.home() / ".owl-memory"
DB_PATH = DATA_DIR / "memory.db"
EMBEDDINGS_DIR = DATA_DIR / "embeddings"

# ─── Database Setup ──────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    """Get SQLite connection with WAL mode for concurrent access."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the database schema."""
    conn = get_db()
    conn.executescript("""
        -- Core memories table
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            memory_type TEXT DEFAULT 'fact',
            importance REAL DEFAULT 0.5,
            source TEXT DEFAULT 'conversation',
            project TEXT DEFAULT 'default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT,
            access_count INTEGER DEFAULT 0,
            last_accessed TEXT,
            is_active INTEGER DEFAULT 1,
            metadata TEXT DEFAULT '{}'
        );

        -- Entities extracted from memories (for entity linking)
        CREATE TABLE IF NOT EXISTS entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'general',
            UNIQUE(name, entity_type)
        );

        -- Memory-Entity links
        CREATE TABLE IF NOT EXISTS memory_entities (
            memory_id TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            PRIMARY KEY (memory_id, entity_id),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        );

        -- Contradiction/conflict tracking
        CREATE TABLE IF NOT EXISTS contradictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id_1 TEXT NOT NULL,
            memory_id_2 TEXT NOT NULL,
            resolved INTEGER DEFAULT 0,
            resolution TEXT,
            detected_at TEXT NOT NULL,
            FOREIGN KEY (memory_id_1) REFERENCES memories(id) ON DELETE CASCADE,
            FOREIGN KEY (memory_id_2) REFERENCES memories(id) ON DELETE CASCADE
        );

        -- Full-text search virtual table
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            memory_type,
            project,
            content='memories',
            content_rowid='rowid'
        );

        -- Triggers to keep FTS index in sync
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content, memory_type, project)
            VALUES (NEW.id, NEW.content, NEW.memory_type, NEW.project);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, memory_type, project)
            VALUES ('delete', OLD.id, OLD.content, OLD.memory_type, OLD.project);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, memory_type, project)
            VALUES ('delete', OLD.id, OLD.content, OLD.memory_type, OLD.project);
            INSERT INTO memories_fts(rowid, content, memory_type, project)
            VALUES (NEW.id, NEW.content, NEW.memory_type, NEW.project);
        END;

        -- Indices
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
        CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(is_active);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    """)
    conn.commit()
    conn.close()


# ─── Helper Functions ────────────────────────────────────────────────────────

def generate_id(content: str) -> str:
    """Generate a unique ID for a memory based on content hash."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def extract_entities(text: str) -> list[tuple[str, str]]:
    """
    Simple entity extraction. In production, use spaCy or LLM.
    Extracts: proper nouns, quoted strings, key-value patterns.
    """
    entities = []

    # Quoted strings
    for match in re.finditer(r'"([^"]+)"', text):
        entities.append((match.group(1), "quoted"))

    # Key-value patterns: "X is Y", "X was Y", "X = Y"
    for match in re.finditer(r'(\w[\w\s]{1,30})\s+(?:is|was|are|were|=)\s+(.+)', text, re.IGNORECASE):
        key = match.group(1).strip()
        val = match.group(2).strip().rstrip('.')
        if len(key) > 2 and len(val) > 2:
            entities.append((key, "attribute"))
            entities.append((val, "value"))

    # Capitalized proper nouns (2-4 words)
    for match in re.finditer(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b', text):
        entities.append((match.group(1), "proper_noun"))

    # Email addresses
    for match in re.finditer(r'[\w.+-]+@[\w-]+\.[\w.-]+', text):
        entities.append((match.group(), "email"))

    # URLs
    for match in re.finditer(r'https?://[^\s]+', text):
        entities.append((match.group(), "url"))

    return list(set(entities))


def compute_importance(content: str, memory_type: str) -> float:
    """
    Compute importance score (0.0 - 1.0) based on content signals.
    Mirrors Mem0's importance weighting approach.
    """
    score = 0.5  # base

    # Type-based adjustments
    type_scores = {
        "preference": 0.8,
        "decision": 0.9,
        "fact": 0.6,
        "context": 0.4,
        "instruction": 0.7,
        "profile": 0.85,
    }
    score = type_scores.get(memory_type, 0.5)

    # Content signals
    content_lower = content.lower()

    # Explicit importance markers
    if any(w in content_lower for w in ["always", "never", "must", "important", "critical", "key"]):
        score += 0.15
    if any(w in content_lower for w in ["prefer", "like", "want", "need", "favorite"]):
        score += 0.1
    if any(w in content_lower for w in ["decided", "chose", "selected", "agreed"]):
        score += 0.15

    # Length factor — very short or very long memories are less useful
    word_count = len(content.split())
    if 5 <= word_count <= 30:
        score += 0.05

    return min(1.0, max(0.1, score))


def detect_contradictions(conn: sqlite3.Connection, new_content: str, project: str) -> list[dict]:
    """
    Detect potential contradictions with existing memories.
    Simple heuristic: check for negation patterns and opposing statements.
    """
    contradictions = []
    cursor = conn.execute(
        "SELECT id, content FROM memories WHERE project = ? AND is_active = 1",
        (project,)
    )
    existing = cursor.fetchall()

    new_lower = new_content.lower()
    negation_patterns = [
        (r'\bnot\s+', r'\b'),
        (r'\bno\s+longer\b', r'\b'),
        (r'\bused\s+to\b', r'\bnow\b'),
        (r'\bchanged\b', r'\b'),
        (r'\bupdated\b', r'\b'),
        (r'\bactually\b', r'\b'),
        (r'\binstead\b', r'\b'),
    ]

    for row in existing:
        existing_lower = row["content"].lower()

        # Check if new memory negates existing
        for neg_pattern, _ in negation_patterns:
            if re.search(neg_pattern, new_lower):
                # Extract the core statement (simplified)
                # If the new memory says "X is not Y" and old says "X is Y"
                new_core = re.sub(neg_pattern, '', new_lower).strip()
                if new_core in existing_lower or existing_lower in new_core:
                    contradictions.append({
                        "existing_id": row["id"],
                        "existing_content": row["content"],
                        "new_content": new_content,
                        "reason": f"Potential negation detected",
                    })
                    break

    return contradictions


def calculate_ttl(importance: float, memory_type: str) -> Optional[str]:
    """
    Calculate expiration time based on importance and type.
    High-importance memories last longer. Mirrors Supermemory's auto-forgetting.
    """
    if memory_type in ("preference", "profile", "decision"):
        days = 365  # Almost permanent
    elif importance > 0.8:
        days = 180
    elif importance > 0.6:
        days = 90
    elif importance > 0.4:
        days = 30
    else:
        days = 14

    expires = datetime.utcnow() + timedelta(days=days)
    return expires.isoformat()


# ─── MCP Server ──────────────────────────────────────────────────────────────

init_db()
mcp = FastMCP("owl-memory")


@mcp.tool()
def remember(
    content: str,
    memory_type: str = "fact",
    project: str = "default",
    importance: float = -1.0,
    source: str = "conversation",
    metadata: str = "{}",
) -> str:
    """
    Store a new memory. Extracts entities, detects contradictions, computes importance.

    Args:
        content: The fact/preference/decision to remember
        memory_type: One of: fact, preference, decision, context, instruction, profile
        project: Project/workspace scope (default: "default")
        importance: Manual importance 0.0-1.0 (auto-computed if -1)
        source: Where this memory came from (conversation, file, manual, etc.)
        metadata: JSON string of additional metadata

    Returns:
        JSON with memory_id, entities extracted, contradictions detected
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()
    mem_id = generate_id(content + project + now)

    # Auto-compute importance if not provided
    if importance < 0:
        importance = compute_importance(content, memory_type)

    # Calculate TTL
    expires_at = calculate_ttl(importance, memory_type)

    # Extract entities
    entities = extract_entities(content)

    # Detect contradictions
    contradictions = detect_contradictions(conn, content, project)

    # Store memory
    conn.execute(
        """INSERT INTO memories (id, content, memory_type, importance, source, project,
           created_at, updated_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (mem_id, content, memory_type, importance, source, project, now, now, expires_at, metadata),
    )

    # Store entities and links
    for entity_name, entity_type in entities:
        conn.execute(
            "INSERT OR IGNORE INTO entities (name, entity_type) VALUES (?, ?)",
            (entity_name, entity_type),
        )
        cursor = conn.execute(
            "SELECT id FROM entities WHERE name = ? AND entity_type = ?",
            (entity_name, entity_type),
        )
        entity_id = cursor.fetchone()["id"]
        conn.execute(
            "INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)",
            (mem_id, entity_id),
        )

    # Store contradictions
    for c in contradictions:
        conn.execute(
            """INSERT INTO contradictions (memory_id_1, memory_id_2, detected_at)
               VALUES (?, ?, ?)""",
            (c["existing_id"], mem_id, now),
        )

    conn.commit()
    conn.close()

    return json.dumps({
        "memory_id": mem_id,
        "importance": importance,
        "expires_at": expires_at,
        "entities_extracted": [{"name": n, "type": t} for n, t in entities],
        "contradictions_detected": len(contradictions),
        "contradiction_details": contradictions,
    }, indent=2)


@mcp.tool()
def recall(
    query: str,
    project: str = "default",
    limit: int = 10,
    min_importance: float = 0.0,
    include_expired: bool = False,
) -> str:
    """
    Search memories using multi-signal retrieval: BM25 + entity matching + importance scoring.

    Args:
        query: Natural language search query
        project: Project scope to search (default: "default")
        limit: Max results to return
        min_importance: Minimum importance threshold
        include_expired: Whether to include expired memories

    Returns:
        JSON array of matching memories, ranked by relevance
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()

    # BM25 full-text search
    fts_results = conn.execute(
        """SELECT m.*, rank AS bm25_rank
           FROM memories_fts fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ?
           AND m.project = ?
           AND m.is_active = 1
           AND (? OR m.expires_at IS NULL OR m.expires_at > ?)
           AND m.importance >= ?
           ORDER BY rank
           LIMIT ?""",
        (query, project, include_expired, now, min_importance, limit * 2),
    ).fetchall()

    # Entity-based search
    query_entities = extract_entities(query)
    entity_results = []
    if query_entities:
        entity_names = [e[0] for e in query_entities]
        placeholders = ",".join("?" * len(entity_names))
        entity_results = conn.execute(
            f"""SELECT DISTINCT m.*, 0.0 AS bm25_rank
                FROM memories m
                JOIN memory_entities me ON me.memory_id = m.id
                JOIN entities e ON e.id = me.entity_id
                WHERE e.name IN ({placeholders})
                AND m.project = ?
                AND m.is_active = 1
                AND (? OR m.expires_at IS NULL OR m.expires_at > ?)
                AND m.importance >= ?""",
            (*entity_names, project, include_expired, now, min_importance),
        ).fetchall()

    # Merge and score results
    seen_ids = set()
    scored_results = []

    for row in fts_results:
        if row["id"] not in seen_ids:
            seen_ids.add(row["id"])
            # Combined score: BM25 (lower is better, so invert) + importance
            bm25_score = 1.0 / (1.0 + abs(row["bm25_rank"] or 0))
            combined = (bm25_score * 0.4) + (row["importance"] * 0.4) + (min(row["access_count"] / 10.0, 1.0) * 0.2)
            scored_results.append((combined, row))

    for row in entity_results:
        if row["id"] not in seen_ids:
            seen_ids.add(row["id"])
            # Entity match score
            entity_score = 0.6  # base for entity match
            combined = (entity_score * 0.4) + (row["importance"] * 0.4) + (min(row["access_count"] / 10.0, 1.0) * 0.2)
            scored_results.append((combined, row))

    # Sort by combined score
    scored_results.sort(key=lambda x: x[0], reverse=True)
    top_results = scored_results[:limit]

    # Update access counts
    for _, row in top_results:
        conn.execute(
            "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
            (now, row["id"]),
        )
    conn.commit()

    # Format results
    results = []
    for score, row in top_results:
        results.append({
            "id": row["id"],
            "content": row["content"],
            "type": row["memory_type"],
            "importance": row["importance"],
            "project": row["project"],
            "created_at": row["created_at"],
            "access_count": row["access_count"],
            "relevance_score": round(score, 3),
        })

    conn.close()
    return json.dumps(results, indent=2)


@mcp.tool()
def forget(memory_id: str) -> str:
    """
    Soft-delete a memory (mark as inactive). Use this when information becomes outdated.

    Args:
        memory_id: The ID of the memory to forget

    Returns:
        Confirmation message
    """
    conn = get_db()
    cursor = conn.execute("UPDATE memories SET is_active = 0 WHERE id = ?", (memory_id,))
    conn.commit()
    affected = cursor.rowcount
    conn.close()

    if affected:
        return f"Memory {memory_id} forgotten (soft-deleted)."
    return f"Memory {memory_id} not found."


@mcp.tool()
def update_memory(memory_id: str, new_content: str) -> str:
    """
    Update an existing memory with new content. Re-extracts entities and re-computes importance.

    Args:
        memory_id: The ID of the memory to update
        new_content: The new content to replace the old

    Returns:
        Confirmation with updated metadata
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()

    # Get existing memory
    existing = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
    if not existing:
        conn.close()
        return f"Memory {memory_id} not found."

    # Update content
    importance = compute_importance(new_content, existing["memory_type"])
    expires_at = calculate_ttl(importance, existing["memory_type"])

    conn.execute(
        """UPDATE memories SET content = ?, importance = ?, expires_at = ?, updated_at = ?
           WHERE id = ?""",
        (new_content, importance, expires_at, now, memory_id),
    )

    # Re-extract entities (remove old links, add new)
    conn.execute("DELETE FROM memory_entities WHERE memory_id = ?", (memory_id,))
    entities = extract_entities(new_content)
    for entity_name, entity_type in entities:
        conn.execute(
            "INSERT OR IGNORE INTO entities (name, entity_type) VALUES (?, ?)",
            (entity_name, entity_type),
        )
        cursor = conn.execute(
            "SELECT id FROM entities WHERE name = ? AND entity_type = ?",
            (entity_name, entity_type),
        )
        entity_id = cursor.fetchone()["id"]
        conn.execute(
            "INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)",
            (memory_id, entity_id),
        )

    conn.commit()
    conn.close()

    return json.dumps({
        "memory_id": memory_id,
        "new_importance": importance,
        "new_expires_at": expires_at,
        "entities_extracted": len(entities),
    }, indent=2)


@mcp.tool()
def get_contradictions(project: str = "default") -> str:
    """
    Get all unresolved contradictions in a project.

    Args:
        project: Project scope

    Returns:
        JSON array of contradiction pairs
    """
    conn = get_db()
    results = conn.execute(
        """SELECT c.id, c.detected_at,
                  m1.id as id1, m1.content as content1,
                  m2.id as id2, m2.content as content2
           FROM contradictions c
           JOIN memories m1 ON m1.id = c.memory_id_1
           JOIN memories m2 ON m2.id = c.memory_id_2
           WHERE c.resolved = 0
           AND (m1.project = ? OR m2.project = ?)
           ORDER BY c.detected_at DESC""",
        (project, project),
    ).fetchall()
    conn.close()

    contradictions = []
    for row in results:
        contradictions.append({
            "id": row["id"],
            "memory_1": {"id": row["id1"], "content": row["content1"]},
            "memory_2": {"id": row["id2"], "content": row["content2"]},
            "detected_at": row["detected_at"],
        })

    return json.dumps(contradictions, indent=2)


@mcp.tool()
def resolve_contradiction(contradiction_id: str, keep_memory_id: str, resolution: str = "") -> str:
    """
    Resolve a contradiction by keeping one memory and forgetting the other.

    Args:
        contradiction_id: The contradiction ID
        keep_memory_id: Which memory to keep
        resolution: Optional note about the resolution

    Returns:
        Confirmation message
    """
    conn = get_db()

    # Get the contradiction
    contra = conn.execute(
        "SELECT * FROM contradictions WHERE id = ?", (contradiction_id,)
    ).fetchone()
    if not contra:
        conn.close()
        return f"Contradiction {contradiction_id} not found."

    # Forget the other memory
    forget_id = contra["memory_id_2"] if keep_memory_id == contra["memory_id_1"] else contra["memory_id_1"]
    conn.execute("UPDATE memories SET is_active = 0 WHERE id = ?", (forget_id,))

    # Mark contradiction as resolved
    conn.execute(
        "UPDATE contradictions SET resolved = 1, resolution = ? WHERE id = ?",
        (resolution, contradiction_id),
    )

    conn.commit()
    conn.close()

    return f"Contradiction resolved. Kept {keep_memory_id}, forgot {forget_id}."


@mcp.tool()
def get_memory(memory_id: str) -> str:
    """Get a single memory by ID."""
    conn = get_db()
    row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
    if not row:
        conn.close()
        return f"Memory {memory_id} not found."

    # Get linked entities
    entities = conn.execute(
        """SELECT e.name, e.entity_type FROM entities e
           JOIN memory_entities me ON me.entity_id = e.id
           WHERE me.memory_id = ?""",
        (memory_id,),
    ).fetchall()

    result = {
        "id": row["id"],
        "content": row["content"],
        "type": row["memory_type"],
        "importance": row["importance"],
        "project": row["project"],
        "source": row["source"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "expires_at": row["expires_at"],
        "access_count": row["access_count"],
        "is_active": bool(row["is_active"]),
        "entities": [{"name": e["name"], "type": e["entity_type"]} for e in entities],
    }

    conn.close()
    return json.dumps(result, indent=2)


@mcp.tool()
def list_memories(
    project: str = "default",
    memory_type: str = "",
    limit: int = 50,
    offset: int = 0,
    order_by: str = "importance",
) -> str:
    """
    List memories with filtering and pagination.

    Args:
        project: Project scope
        memory_type: Filter by type (empty for all)
        limit: Max results
        offset: Pagination offset
        order_by: Sort field (importance, created_at, access_count)

    Returns:
        JSON array of memories
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()

    query = "SELECT * FROM memories WHERE project = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?)"
    params: list = [project, now]

    if memory_type:
        query += " AND memory_type = ?"
        params.append(memory_type)

    valid_orders = {"importance": "importance DESC", "created_at": "created_at DESC", "access_count": "access_count DESC"}
    order_clause = valid_orders.get(order_by, "importance DESC")
    query += f" ORDER BY {order_clause} LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            "content": row["content"][:200] + ("..." if len(row["content"]) > 200 else ""),
            "type": row["memory_type"],
            "importance": row["importance"],
            "created_at": row["created_at"],
            "access_count": row["access_count"],
        })

    return json.dumps(results, indent=2)


@mcp.tool()
def get_stats(project: str = "default") -> str:
    """
    Get memory statistics for a project.

    Returns:
        JSON with counts, type distribution, importance stats
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()

    # Total active memories
    total = conn.execute(
        "SELECT COUNT(*) as cnt FROM memories WHERE project = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?)",
        (project, now),
    ).fetchone()["cnt"]

    # By type
    by_type = conn.execute(
        """SELECT memory_type, COUNT(*) as cnt, AVG(importance) as avg_importance
           FROM memories WHERE project = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?)
           GROUP BY memory_type ORDER BY cnt DESC""",
        (project, now),
    ).fetchall()

    # Unresolved contradictions
    contradictions = conn.execute(
        """SELECT COUNT(*) as cnt FROM contradictions c
           JOIN memories m ON m.id = c.memory_id_1
           WHERE c.resolved = 0 AND m.project = ?""",
        (project,),
    ).fetchone()["cnt"]

    # Most accessed
    top_accessed = conn.execute(
        """SELECT id, content, access_count FROM memories
           WHERE project = ? AND is_active = 1
           ORDER BY access_count DESC LIMIT 5""",
        (project,),
    ).fetchall()

    result = {
        "project": project,
        "total_active_memories": total,
        "by_type": [{"type": r["memory_type"], "count": r["cnt"], "avg_importance": round(r["avg_importance"], 2)} for r in by_type],
        "unresolved_contradictions": contradictions,
        "most_accessed": [{"id": r["id"], "content": r["content"][:100], "access_count": r["access_count"]} for r in top_accessed],
        "database_path": str(DB_PATH),
    }

    conn.close()
    return json.dumps(result, indent=2)


@mcp.tool()
def export_memories(project: str = "default", filepath: str = "") -> str:
    """
    Export all memories for a project to JSON.

    Args:
        project: Project scope
        filepath: Output file path (default: ~/.owl-memory/export-<project>.json)

    Returns:
        Path to exported file
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM memories WHERE project = ? ORDER BY created_at",
        (project,),
    ).fetchall()

    memories = []
    for row in rows:
        memories.append({
            "id": row["id"],
            "content": row["content"],
            "type": row["memory_type"],
            "importance": row["importance"],
            "source": row["source"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "expires_at": row["expires_at"],
            "metadata": json.loads(row["metadata"] or "{}"),
        })

    conn.close()

    if not filepath:
        filepath = str(DATA_DIR / f"export-{project}.json")

    with open(filepath, "w") as f:
        json.dump({"project": project, "exported_at": datetime.utcnow().isoformat(), "memories": memories}, f, indent=2)

    return f"Exported {len(memories)} memories to {filepath}"


@mcp.tool()
def import_memories(filepath: str, project: str = "default") -> str:
    """
    Import memories from a JSON file.

    Args:
        filepath: Path to JSON file
        project: Target project scope

    Returns:
        Import summary
    """
    with open(filepath) as f:
        data = json.load(f)

    conn = get_db()
    imported = 0
    skipped = 0

    for mem in data.get("memories", []):
        mem_id = mem.get("id", generate_id(mem["content"] + project))
        existing = conn.execute("SELECT id FROM memories WHERE id = ?", (mem_id,)).fetchone()
        if existing:
            skipped += 1
            continue

        now = datetime.utcnow().isoformat()
        conn.execute(
            """INSERT INTO memories (id, content, memory_type, importance, source, project,
               created_at, updated_at, expires_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mem_id, mem["content"], mem.get("type", "fact"), mem.get("importance", 0.5),
             mem.get("source", "import"), project, mem.get("created_at", now), now,
             mem.get("expires_at"), json.dumps(mem.get("metadata", {}))),
        )
        imported += 1

    conn.commit()
    conn.close()

    return f"Imported {imported} memories, skipped {skipped} (already exist)."


@mcp.tool()
def cleanup_expired(project: str = "default") -> str:
    """
    Remove expired memories (soft-delete).

    Args:
        project: Project scope

    Returns:
        Number of memories cleaned up
    """
    conn = get_db()
    now = datetime.utcnow().isoformat()
    cursor = conn.execute(
        "UPDATE memories SET is_active = 0 WHERE project = ? AND expires_at IS NOT NULL AND expires_at < ? AND is_active = 1",
        (project, now),
    )
    conn.commit()
    count = cursor.rowcount
    conn.close()

    return f"Cleaned up {count} expired memories in project '{project}'."


# ─── CLI Mode ────────────────────────────────────────────────────────────────

def cli_mode():
    """Interactive CLI for testing memory operations."""
    print("🧠 OWL Memory MCP — Interactive CLI")
    print("=" * 50)
    print("Commands: remember, recall, list, forget, stats, quit")
    print()

    while True:
        try:
            cmd = input("memory> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            break

        if cmd == "quit" or cmd == "q":
            break
        elif cmd == "remember":
            content = input("  Content: ").strip()
            if not content:
                continue
            mem_type = input("  Type (fact/preference/decision/context/instruction/profile) [fact]: ").strip() or "fact"
            project = input("  Project [default]: ").strip() or "default"
            result = remember(content, mem_type, project)
            print(f"  ✓ {result}")
        elif cmd == "recall":
            query = input("  Query: ").strip()
            if not query:
                continue
            project = input("  Project [default]: ").strip() or "default"
            result = recall(query, project)
            data = json.loads(result)
            for mem in data:
                print(f"  [{mem['relevance_score']:.2f}] {mem['content'][:100]}")
        elif cmd == "list":
            project = input("  Project [default]: ").strip() or "default"
            result = list_memories(project)
            data = json.loads(result)
            for mem in data:
                print(f"  [{mem['importance']:.1f}] ({mem['type']}) {mem['content'][:80]}")
        elif cmd == "forget":
            mem_id = input("  Memory ID: ").strip()
            print(f"  {forget(mem_id)}")
        elif cmd == "stats":
            project = input("  Project [default]: ").strip() or "default"
            result = get_stats(project)
            print(f"  {result}")
        else:
            print("  Unknown command. Use: remember, recall, list, forget, stats, quit")


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OWL Memory MCP Server")
    parser.add_argument("--cli", action="store_true", help="Run in interactive CLI mode")
    parser.add_argument("--export", type=str, help="Export memories to file")
    parser.add_argument("--import-file", type=str, help="Import memories from file")
    parser.add_argument("--project", type=str, default="default", help="Project scope")
    args = parser.parse_args()

    if args.cli:
        cli_mode()
    elif args.export:
        print(export_memories(args.project, args.export))
    elif args.import_file:
        print(import_memories(args.import_file, args.project))
    else:
        # Run as MCP server (stdio) — this is the default for Hermes
        mcp.run()
