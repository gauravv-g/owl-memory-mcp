# C:\Users\shiva\hermes-custom-mcps\owl_shared_intelligence.py
"""
Shared Intelligence Layer for OWL MCP v6.0 (Python components)
Bridges owl-research and owl-web with owl-memory SQLite database.
"""

import os
import sys
import sqlite3
import json
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
            
            # D3: Cross-Server Events
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cross_server_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  source_server TEXT,
                  event_type TEXT,
                  payload TEXT,
                  target_servers TEXT,
                  consumed_by TEXT DEFAULT '[]',
                  created_at TEXT
                )
            """)
            
            # Predictive Layer Tables
            conn.execute("""
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
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memory_observer_sessions (
                  session_id TEXT NOT NULL,
                  observer_type TEXT NOT NULL,
                  observer_context TEXT,
                  top_memories TEXT,
                  resolution_time_ms INTEGER,
                  resolution_outcome TEXT
                )
            """)
            
            conn.execute("""
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
                )
            """)
            
            # Try to add stale_flag and provenance_chain if not exist
            try:
                conn.execute("ALTER TABLE episodic_memories ADD COLUMN stale_flag INTEGER DEFAULT 0")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE episodic_memories ADD COLUMN provenance_chain TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE episodic_memories ADD COLUMN tags TEXT")
            except Exception:
                pass

            # Evolve source_leverage_ledger with new trust dimensions
            try:
                conn.execute("ALTER TABLE source_leverage_ledger ADD COLUMN recency_trust REAL DEFAULT 0.5")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE source_leverage_ledger ADD COLUMN consistency_trust REAL DEFAULT 0.5")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE source_leverage_ledger ADD COLUMN topic_trust TEXT DEFAULT '{}'")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE source_leverage_ledger ADD COLUMN recent_qualities TEXT DEFAULT '[]'")
            except Exception:
                pass

            # Phase 4: Create tables code_topology_snapshots and web_provenance_chain
            conn.execute("""
                CREATE TABLE IF NOT EXISTS code_topology_snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  project TEXT NOT NULL,
                  node_count INTEGER DEFAULT 0,
                  edge_count INTEGER DEFAULT 0,
                  hotspot_centroid TEXT,
                  avg_gravity REAL DEFAULT 0.0,
                  complexity_score REAL DEFAULT 0.0,
                  captured_at TEXT NOT NULL
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS web_provenance_chain (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  memory_id TEXT,
                  claim_text TEXT,
                  source_url TEXT,
                  source_trust REAL DEFAULT 0.5,
                  fetched_at TEXT,
                  is_contradicted INTEGER DEFAULT 0
                )
            """)

            # Phase 4: Column migrations
            for tbl in ["episodic_memories", "memory_programs", "project_constitution"]:
                try:
                    conn.execute(f"ALTER TABLE {tbl} ADD COLUMN inherited INTEGER DEFAULT 0")
                except Exception:
                    pass
                try:
                    conn.execute(f"ALTER TABLE {tbl} ADD COLUMN donor_project TEXT")
                except Exception:
                    pass
                try:
                    conn.execute(f"ALTER TABLE {tbl} ADD COLUMN transplant_confidence REAL DEFAULT 1.0")
                except Exception:
                    pass
                try:
                    conn.execute(f"ALTER TABLE {tbl} ADD COLUMN template_id TEXT")
                except Exception:
                    pass

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
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            # LIKE match topic or first part of topic
            # Retrieve tags (holds JSON list of sources)
            cursor = conn.execute("""
                SELECT id, content, salience, access_count, created_at, tags
                FROM episodic_memories
                WHERE event_type = 'research'
                  AND project = ?
                  AND content LIKE ?
                  AND is_active = 1
                  AND salience >= ?
                  AND stale_flag = 0
                ORDER BY salience DESC, access_count DESC
                LIMIT 1
            """, (project, f"%{clean_topic[:40]}%", threshold))
            result = cursor.fetchone()
            
            if result:
                mem_id, content, salience, access_count, created_at, tags = result
                
                # R2: Cache Freshness and Web Monitor checks
                bypass_cache = False
                sources = []
                if tags:
                    try:
                        import json
                        sources = json.loads(tags)
                    except Exception:
                        pass
                
                freshness_scores = []
                min_freshness = 1.0
                for url in sources:
                    fresh_info = computeTemporalFreshness(url, created_at)
                    score = fresh_info.get("freshness_score", 1.0)
                    freshness_scores.append(score)
                    if score < min_freshness:
                        min_freshness = score
                        
                    # Check if any source domain has recency_trust < 0.3
                    dt_trust = _get_domain_trust_detailed(url)
                    if dt_trust.get("recency_trust", 0.5) < 0.3:
                        bypass_cache = True
                        
                    # Force cache bypass if topic matches a monitor URL that has significant_change since cache was written
                    cursor_chg = conn.execute("""
                        SELECT COUNT(*) FROM web_page_history
                        WHERE url = ? AND significant_change = 1 AND fetched_at > ?
                    """, (url, created_at))
                    if cursor_chg.fetchone()[0] > 0:
                        bypass_cache = True

                if not sources:
                    fresh_info = computeTemporalFreshness("http://general-decay.com", created_at)
                    min_freshness = fresh_info.get("freshness_score", 1.0)
                
                # 90-day-old technical hit -> freshness < 0.3 -> bypass cache
                if min_freshness < 0.3:
                    bypass_cache = True
                    
                if bypass_cache:
                    return None
                
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
                    "freshness_score": min_freshness,
                    "note": f"Returned from OWL memory cache. Freshness: {min_freshness:.2f}"
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

def _update_domain_trust(url: str, quality_score: float, topic: str = None):
    """Update domain quality score in source leverage ledger with multi-dimensional trust."""
    if not url:
        return
    try:
        domain = urlparse(url).netloc.replace("www.", "")
        if not domain:
            return
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            row = conn.execute("""
                SELECT avg_content_quality, total_fetches, successful_stores, 
                       recent_qualities, topic_trust, last_high_quality_result
                FROM source_leverage_ledger WHERE domain = ?
            """, (domain,)).fetchone()
            
            # Simple keyword matching for topic trust
            keywords = ["python", "rust", "javascript", "node", "fastapi", "react", "sqlite", "postgres", "docker", "aws", "git", "auth", "html", "css"]
            matched_key = None
            if topic:
                topic_lower = topic.lower()
                for kw in keywords:
                    if kw in topic_lower:
                        matched_key = kw
                        break

            if row:
                avg_q, fetches, stores, req_q_str, topic_t_str, last_high = row
                new_fetches = fetches + 1
                is_high_quality = 1 if quality_score >= 0.7 else 0
                new_stores = stores + is_high_quality
                new_avg = (avg_q * fetches + quality_score) / new_fetches
                
                # Update recent qualities
                try:
                    qualities = json.loads(req_q_str or "[]")
                except Exception:
                    qualities = []
                qualities.append(quality_score)
                if len(qualities) > 20:
                    qualities = qualities[-20:]
                new_req_q_str = json.dumps(qualities)
                
                # Calculate consistency trust (1.0 - std_dev)
                import statistics
                if len(qualities) >= 2:
                    std_dev = statistics.stdev(qualities)
                else:
                    std_dev = 0.0
                consistency_trust = max(0.0, min(1.0, 1.0 - std_dev))
                
                # Update topic trust
                try:
                    topic_trust_dict = json.loads(topic_t_str or "{}")
                except Exception:
                    topic_trust_dict = {}
                if matched_key:
                    old_topic_q = topic_trust_dict.get(matched_key, 0.5)
                    topic_trust_dict[matched_key] = max(0.1, min(1.0, (old_topic_q * 4 + quality_score) / 5))
                new_topic_t_str = json.dumps(topic_trust_dict)
                
                # Update last high quality result time
                new_last_high = now if is_high_quality else last_high
                if not new_last_high:
                    new_last_high = now
                
                # Capped trust score
                new_trust = new_avg * (new_stores / new_fetches if new_fetches > 0 else 0.5)
                new_trust = max(0.1, min(1.0, new_trust))
                
                conn.execute("""
                    UPDATE source_leverage_ledger
                    SET avg_content_quality = ?, total_fetches = ?, successful_stores = ?, 
                        trust_score = ?, updated_at = ?, recent_qualities = ?, 
                        topic_trust = ?, last_high_quality_result = ?, consistency_trust = ?
                    WHERE domain = ?
                """, (new_avg, new_fetches, new_stores, new_trust, now, new_req_q_str, 
                      new_topic_t_str, new_last_high, consistency_trust, domain))
            else:
                new_avg = quality_score
                new_fetches = 1
                is_high_quality = 1 if quality_score >= 0.7 else 0
                new_stores = is_high_quality
                new_trust = new_avg * 0.5
                qualities = [quality_score]
                topic_trust_dict = {}
                if matched_key:
                    topic_trust_dict[matched_key] = quality_score
                
                conn.execute("""
                    INSERT INTO source_leverage_ledger 
                      (domain, avg_content_quality, total_fetches, successful_stores, trust_score, 
                       updated_at, recent_qualities, topic_trust, last_high_quality_result, 
                       consistency_trust, recency_trust)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0)
                """, (domain, new_avg, new_fetches, new_stores, new_trust, now, 
                      json.dumps(qualities), json.dumps(topic_trust_dict), now, 1.0))
            conn.commit()
    except Exception as e:
        print(f"[OWL Ledger Warning] failed to update: {e}", file=sys.stderr)

def _get_domain_trust_detailed(url: str, topic: str = None) -> dict:
    """Retrieve detailed multi-dimensional domain trust score from source leverage ledger."""
    default_res = {
        "trust_score": 0.5,
        "recency_trust": 0.5,
        "consistency_trust": 0.5,
        "topic_trust": {}
    }
    if not url:
        return default_res
    try:
        domain = urlparse(url).netloc.replace("www.", "")
        if not domain:
            return default_res
        
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            row = conn.execute("""
                SELECT trust_score, recency_trust, consistency_trust, topic_trust, last_high_quality_result 
                FROM source_leverage_ledger WHERE domain = ?
            """, (domain,)).fetchone()
            
            if row:
                trust_score, recency_t, consistency_t, topic_t_str, last_high = row
                
                half_life, _ = DOMAIN_TEMPORAL_DECAY_PROFILES.get(domain, (30, "general"))
                recency_val = 0.5
                if last_high:
                    try:
                        clean_iso = last_high
                        if clean_iso.endswith('Z'):
                            clean_iso = clean_iso[:-1]
                        dt = datetime.fromisoformat(clean_iso)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        now = datetime.now(timezone.utc)
                        age_days = max(0, (now - dt).days)
                        recency_val = math.exp(-0.693 * age_days / half_life)
                    except Exception:
                        recency_val = 0.5
                else:
                    recency_val = recency_t if recency_t is not None else 0.5
                
                try:
                    topic_trust_dict = json.loads(topic_t_str or "{}")
                except Exception:
                    topic_trust_dict = {}
                
                # Update recency_trust in DB
                conn.execute("""
                    UPDATE source_leverage_ledger 
                    SET recency_trust = ? 
                    WHERE domain = ?
                """, (recency_val, domain))
                conn.commit()
                
                return {
                    "trust_score": trust_score,
                    "recency_trust": recency_val,
                    "consistency_trust": consistency_t if consistency_t is not None else 0.5,
                    "topic_trust": topic_trust_dict
                }
    except Exception:
        pass
    return default_res

def _get_domain_trust(url: str) -> float:
    """Retrieve domain trust score from source leverage ledger."""
    detailed = _get_domain_trust_detailed(url)
    return detailed["trust_score"]

def broadcast_event(source_server: str, event_type: str, payload: dict, target_servers: list = None):
    """Broadcast an event for cross-server observer propagation."""
    import json
    target_servers_str = json.dumps(target_servers) if target_servers else "[]"
    payload_str = json.dumps(payload)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT INTO cross_server_events (source_server, event_type, payload, target_servers, consumed_by, created_at)
                VALUES (?, ?, ?, ?, '[]', ?)
            """, (source_server, event_type, payload_str, target_servers_str, now))
            conn.commit()
    except Exception as e:
        print(f"[OWL Cross-Server Event Warning] broadcast failed: {e}", file=sys.stderr)

def get_unconsumed_events(target_server: str) -> list:
    """Retrieve all cross-server events not yet consumed by the target server."""
    import json
    events = []
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return []
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            # Pre-filter: skip rows already consumed by this server using LIKE
            # This avoids fetching the entire growing table
            cursor = conn.execute("""
                SELECT id, source_server, event_type, payload, target_servers, consumed_by, created_at
                FROM cross_server_events
                WHERE consumed_by NOT LIKE ?
                ORDER BY id ASC
                LIMIT 100
            """, (f'%"{target_server}"%',))
            rows = cursor.fetchall()
            for r in rows:
                ev_id, src, ev_type, pay, targets, consumed, created = r
                
                try:
                    targets_list = json.loads(targets) if targets else []
                except Exception:
                    targets_list = []
                try:
                    consumed_list = json.loads(consumed) if consumed else []
                except Exception:
                    consumed_list = []
                
                # Double-check (in case LIKE false-positive on partial match)
                if target_server in consumed_list:
                    continue
                
                if targets_list and target_server not in targets_list:
                    continue
                
                try:
                    payload_dict = json.loads(pay)
                except Exception:
                    payload_dict = {}
                    
                events.append({
                    "id": ev_id,
                    "source_server": src,
                    "event_type": ev_type,
                    "payload": payload_dict,
                    "created_at": created
                })
    except Exception as e:
        print(f"[OWL Cross-Server Event Warning] get_unconsumed failed: {e}", file=sys.stderr)
    return events


def mark_event_consumed(event_id: int, target_server: str):
    """Mark a cross-server event as consumed by the target server."""
    import json
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            row = conn.execute("SELECT consumed_by FROM cross_server_events WHERE id = ?", (event_id,)).fetchone()
            if row:
                consumed = row[0]
                try:
                    consumed_list = json.loads(consumed) if consumed else []
                except Exception:
                    consumed_list = []
                if target_server not in consumed_list:
                    consumed_list.append(target_server)
                    conn.execute("UPDATE cross_server_events SET consumed_by = ? WHERE id = ?", (json.dumps(consumed_list), event_id))
                    conn.commit()
    except Exception as e:
        print(f"[OWL Cross-Server Event Warning] mark_consumed failed: {e}", file=sys.stderr)

def invalidate_related_research(url: str, change_summary: str):
    """
    W4: Web-Research Feedback Loop
    If a monitored page has a significant change, invalidate related research memories.
    """
    import json
    from urllib.parse import urlparse
    domain = urlparse(url).netloc.replace("www.", "")
    if not domain:
        return
        
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return
            
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        invalidated_count = 0
        events_to_broadcast = []
        
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            # Get all active research memories
            cursor = conn.execute("""
                SELECT id, content, project FROM episodic_memories
                WHERE event_type = 'research' AND is_active = 1
            """)
            rows = cursor.fetchall()
            
            for mem_id, content, project in rows:
                if domain.lower() in content.lower():
                    # Set stale_flag = 1
                    conn.execute("""
                        UPDATE episodic_memories
                        SET stale_flag = 1, updated_at = ?
                        WHERE id = ?
                    """, (now, mem_id))
                    invalidated_count += 1
                    
                    # Create a daemon signal for each invalidation
                    signal_payload = {
                        "memory_id": mem_id,
                        "url": url,
                        "domain": domain,
                        "change_summary": change_summary,
                        "reason": f"Monitored page {url} changed significantly."
                    }
                    conn.execute("""
                        INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
                        VALUES (?, ?, ?, 0)
                    """, ("research_invalidation_required", json.dumps(signal_payload), now))
                    
                    events_to_broadcast.append(signal_payload)
            conn.commit()
            
        # Broadcast outside transaction to prevent database locks
        for payload in events_to_broadcast:
            broadcast_event(
                source_server="owl-web",
                event_type="research_invalidation_required",
                payload=payload
            )
            
        if invalidated_count > 0:
            print(f"[OWL Web-Research Loop] Invalidated {invalidated_count} research memories mentioning {domain}")
    except Exception as e:
        print(f"[OWL Web-Research Loop Warning] Invalidation failed: {e}", file=sys.stderr)
