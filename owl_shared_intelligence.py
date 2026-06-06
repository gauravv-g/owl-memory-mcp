# C:\Users\shiva\hermes-custom-mcps\owl_shared_intelligence.py
"""
Shared Intelligence Layer for OWL MCP v6.0 (Python components)
Bridges owl-research and owl-web with owl-memory SQLite database.
"""

import os
import sys
import sqlite3
import time
import math
import hashlib
from urllib.parse import urlparse
from datetime import datetime, timezone

_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

# Domain specific half-life (temporal relativity)
DOMAIN_TEMPORAL_DECAY_PROFILES = {
    "rbi.org.in": (365, "regulatory"),
    "mca.gov.in": (365, "regulatory"),
    "stackoverflow.com": (180, "technical"),
    "github.com": (90, "technical"),
    "docs.python.org": (365, "docs"),
    "npmjs.com": (30, "package"),
    "coindesk.com": (1, "financial"),
    "reuters.com": (1, "news"),
}

def init_shared_db():
    """Ensure the shared schema exists in SQLite."""
    try:
        db_dir = os.path.dirname(_OWL_DB_PATH)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA foreign_keys = ON")
            
            # Pillar 16: Source Leverage Ledger
            conn.execute("""
                CREATE TABLE IF NOT EXISTS source_leverage_ledger (
                  domain TEXT PRIMARY KEY,
                  avg_content_quality REAL DEFAULT 0.5,
                  total_fetches INTEGER DEFAULT 0,
                  successful_stores INTEGER DEFAULT 0,
                  last_high_quality_result TEXT,
                  domain_category TEXT,
                  staleness_days_avg REAL,
                  trust_score REAL DEFAULT 0.5,
                  updated_at TEXT
                )
            """)
            
            # Pillar 17: Web version history
            conn.execute("""
                CREATE TABLE IF NOT EXISTS web_page_history (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  url TEXT NOT NULL,
                  label TEXT,
                  content_hash TEXT NOT NULL,
                  content_snapshot TEXT,
                  significant_change INTEGER DEFAULT 0,
                  change_summary TEXT,
                  fetched_at TEXT NOT NULL,
                  css_selector TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS web_semantic_changes (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  url TEXT NOT NULL,
                  label TEXT,
                  change_type TEXT,
                  old_value TEXT,
                  new_value TEXT,
                  detected_at TEXT,
                  alert_sent_to_memory INTEGER DEFAULT 0
                )
            """)
            
            # Pillar 14: Query fitness registry
            conn.execute("""
                CREATE TABLE IF NOT EXISTS research_query_fitness (
                  query_template TEXT PRIMARY KEY,
                  topic_category TEXT,
                  avg_result_quality REAL DEFAULT 0.5,
                  usage_count INTEGER DEFAULT 0,
                  last_used TEXT
                )
            """)
            conn.commit()
    except Exception as e:
        print(f"[OWL SHARED DB INIT WARNING] {e}", file=sys.stderr)

# Initialize schema immediately upon import
init_shared_db()

def _owl_check_memory_first(topic: str, project: str = "default", threshold: float = 0.80) -> dict | None:
    """
    轻量级的 SQLite 查询检查（无需向量搜索/嵌入）
    Pillar 13: Memory-First Research Gate
    """
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return None
        
        clean_topic = topic.strip()
        if not clean_topic or len(clean_topic) < 3:
            return None
            
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            # LIKE match topic or first part of topic
            cursor = conn.execute("""
                SELECT id, content, salience, access_count, created_at
                FROM episodic_memories
                WHERE event_type = 'research'
                  AND project = ?
                  AND content LIKE ?
                  AND is_active = 1
                  AND salience >= ?
                ORDER BY salience DESC, access_count DESC
                LIMIT 1
            """, (project, f"%{clean_topic[:40]}%", threshold))
            result = cursor.fetchone()
            
            if result:
                mem_id, content, salience, access_count, created_at = result
                # Update access_count (Einstein reconsolidation trigger)
                conn.execute("""
                    UPDATE episodic_memories SET access_count = access_count + 1
                    WHERE id = ?
                """, (mem_id,))
                conn.commit()
                
                # Strip prefix for display
                display_content = content
                if content.startswith("[RESEARCH] "):
                    display_content = content[len("[RESEARCH] "):]
                
                return {
                    "source": "owl_memory_cache",
                    "confidence": salience,
                    "content": display_content,
                    "cached_at": created_at,
                    "note": "Returned from OWL memory cache. No network call made."
                }
    except Exception as e:
        print(f"[OWL Memory Gate Warning] check failed: {e}", file=sys.stderr)
    return None

def computeTemporalFreshness(url: str, fetched_at_iso: str) -> dict:
    """
    Pillar 18: Einstein Domain Temporal Relativity
    Decays content fresh score based on domain decay half-life.
    """
    domain = urlparse(url).netloc.replace("www.", "")
    half_life, category = DOMAIN_TEMPORAL_DECAY_PROFILES.get(domain, (30, "general"))
    
    try:
        # Strip trailing 'Z' or offset if needed
        clean_iso = fetched_at_iso
        if clean_iso.endswith('Z'):
            clean_iso = clean_iso[:-1]
        
        # Parse timestamp
        dt = datetime.fromisoformat(clean_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
            
        now = datetime.now(timezone.utc)
        age_days = (now - dt).days
        age_days = max(0, age_days)
    except Exception:
        age_days = 30
        
    # Exponential decay formula: N(t) = e^(-lambda * t)
    # lambda = ln(2) / half_life
    freshness = math.exp(-0.693 * age_days / half_life)
    
    return {
        "freshness_score": round(freshness, 3),
        "age_days": age_days,
        "domain_category": category,
        "half_life_days": half_life,
        "verdict": "fresh" if freshness > 0.7 else ("stale" if freshness < 0.3 else "aging")
    }

def _notify_owl_memory_of_change(url: str, label: str, change_summary: str, project: str = "default"):
    """
    Pillar 17: Web version history -> somatic memory alert bridge
    """
    content = f"[WEB CHANGE ALERT] {label} ({url}): {change_summary}"
    mem_id = "webchg_" + hashlib.sha256(content.encode()).hexdigest()[:16]
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT OR IGNORE INTO episodic_memories
                  (id, content, event_type, project, emotional_valence,
                   emotional_arousal, salience, strength, source, created_at, updated_at, is_active)
                VALUES (?, ?, 'web_change', ?, 0.2, 0.9, 0.95, 1.0, 'owl-web', ?, ?, 1)
            """, (mem_id, content, project, now, now))
            conn.commit()
    except Exception as e:
        print(f"[OWL Web Alert Warning] failed: {e}", file=sys.stderr)

def _update_domain_trust(url: str, quality_score: float):
    """Update domain quality score in source leverage ledger."""
    if not url:
        return
    try:
        domain = urlparse(url).netloc.replace("www.", "")
        if not domain:
            return
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            row = conn.execute("SELECT avg_content_quality, total_fetches, successful_stores FROM source_leverage_ledger WHERE domain = ?", (domain,)).fetchone()
            if row:
                avg_q, fetches, stores = row
                new_fetches = fetches + 1
                new_stores = stores + (1 if quality_score >= 0.7 else 0)
                new_avg = (avg_q * fetches + quality_score) / new_fetches
                new_trust = new_avg * (new_stores / new_fetches if new_fetches > 0 else 0.5)
                new_trust = max(0.1, min(1.0, new_trust))
                
                conn.execute("""
                    UPDATE source_leverage_ledger
                    SET avg_content_quality = ?, total_fetches = ?, successful_stores = ?, trust_score = ?, updated_at = ?
                    WHERE domain = ?
                """, (new_avg, new_fetches, new_stores, new_trust, now, domain))
            else:
                new_avg = quality_score
                new_fetches = 1
                new_stores = 1 if quality_score >= 0.7 else 0
                new_trust = new_avg * 0.5
                conn.execute("""
                    INSERT INTO source_leverage_ledger (domain, avg_content_quality, total_fetches, successful_stores, trust_score, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (domain, new_avg, new_fetches, new_stores, new_trust, now))
            conn.commit()
    except Exception as e:
        print(f"[OWL Ledger Warning] failed to update: {e}", file=sys.stderr)

def _get_domain_trust(url: str) -> float:
    """Retrieve domain trust score from source leverage ledger."""
    if not url:
        return 0.5
    try:
        domain = urlparse(url).netloc.replace("www.", "")
        if not domain:
            return 0.5
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            row = conn.execute("SELECT trust_score FROM source_leverage_ledger WHERE domain = ?", (domain,)).fetchone()
            if row:
                return row[0]
    except Exception:
        pass
    return 0.5
