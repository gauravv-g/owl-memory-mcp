"""OWL Shared Intelligence — Minimal stub for MCP server compatibility.

This is a stripped-down version of the original owl_shared_intelligence.py.
Only the functions actually used by surviving MCP servers are preserved.
"""

import os
import sqlite3
import json
from datetime import datetime, timezone

# ── Database Path ──────────────────────────────────────────────────────────

OWL_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "owl_memory.db")

# ── Domain Trust ────────────────────────────────────────────────────────────

def _get_domain_trust(url):
    """Get trust score for a domain. Returns 0.5 (neutral) by default."""
    try:
        if os.path.exists(OWL_DB_PATH):
            with sqlite3.connect(OWL_DB_PATH, timeout=5) as conn:
                row = conn.execute(
                    "SELECT trust FROM domain_trust WHERE domain = ?",
                    (url,)
                ).fetchone()
                if row:
                    return float(row[0])
    except Exception:
        pass
    return 0.5

def _update_domain_trust(url, score):
    """Update trust score for a domain."""
    try:
        if os.path.exists(OWL_DB_PATH):
            with sqlite3.connect(OWL_DB_PATH, timeout=5) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO domain_trust (domain, trust) VALUES (?, ?)",
                    (url, score)
                )
                conn.commit()
    except Exception:
        pass

# ── Temporal Freshness ──────────────────────────────────────────────────────

def computeTemporalFreshness(url, now_iso=None):
    """Compute temporal freshness score for a URL. Returns 1.0 (fresh) by default."""
    return 1.0

# ── Memory Check ────────────────────────────────────────────────────────────

def _owl_check_memory_first(query, project="default", threshold=0.8):
    """Check if research result is already in memory. Returns None if not found."""
    return None

# ── Research Storage ───────────────────────────────────────────────────────

def _owl_store_research_with_code_link(topic, synthesis, project="default", sources=None, active_file=None, provenance_chain=None):
    """Store research result in OWL memory. Stub — does nothing."""
    pass

# ── Notifications ───────────────────────────────────────────────────────────

def _notify_owl_memory_of_change(url, change_type, summary, project="default"):
    """Notify OWL memory of a change. Stub — does nothing."""
    pass

def invalidate_related_research(url, change_summary):
    """Invalidate related research when content changes. Stub — does nothing."""
    pass

def broadcast_event(event_type, data, project="default"):
    """Broadcast event to OWL system. Stub — does nothing."""
    pass
