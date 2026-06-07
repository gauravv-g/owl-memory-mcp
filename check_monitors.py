# check_monitors.py
"""
OWL Monitor Polling Engine (W1 + W4)
Reads owl_monitors.json and runs checks on registered pages.
Sends alerts and triggers invalidations when changes are detected.
"""

import os
import sys
import json
import time
import sqlite3
import hashlib
import re
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

# Import shared intelligence functions
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from owl_shared_intelligence import (
    _OWL_DB_PATH,
    _get_domain_trust,
    _notify_owl_memory_of_change,
    computeTemporalFreshness,
    invalidate_related_research,
    broadcast_event
)

# Fetcher imports
_scrapling_available = False
_stealthy_available = False
try:
    from scrapling.fetchers import Fetcher
    _scrapling_available = True
except ImportError:
    pass
try:
    from scrapling.fetchers import StealthyFetcher
    _stealthy_available = True
except ImportError:
    pass

CHANGE_PATTERN_CLASSIFIERS = [
    (r"₹[\d,]+|Rs\.?\s*[\d,]+|\$[\d,.]+", "price_change", "high"),
    (r"\b(discontinued|removed|no longer|unavailable|sold out)\b", "removal", "high"),
    (r"\b(new|launching|introducing|available now|added)\b", "new_listing", "medium"),
    (r"\b(deadline|last date|closing|expires?)\b.*\d{1,2}[\/-]\d{1,2}", "deadline_change", "critical"),
    (r"\b(circular|notification|gazette|amendment|regulation)\b", "regulatory_update", "critical"),
    (r"version\s+\d+\.\d+|\bv\d+\.\d+\b", "version_change", "medium"),
    (r"\b(security|vulnerability|CVE-\d+|breach|patch)\b", "security_alert", "critical"),
]

def _get_text(el):
    try:
        return el.get_all_text(strip=True)
    except Exception:
        try:
            return el.get_all_text()
        except Exception:
            return str(el)

def _classify_semantic_changes(added_lines, removed_lines):
    changes = []
    all_changed = added_lines + removed_lines
    combined_text = " ".join(all_changed).lower()
    
    for pattern, change_type, severity in CHANGE_PATTERN_CLASSIFIERS:
        if re.search(pattern, combined_text, re.IGNORECASE):
            matches = re.findall(pattern, combined_text, re.IGNORECASE)
            changes.append({
                "type": change_type,
                "severity": severity,
                "matched_text": list(set(matches))[:3]
            })
    return changes

def check_single_monitor(monitor):
    url = monitor["url"]
    selector = monitor.get("css_selector", "")
    label = monitor.get("label", "web_monitor")
    
    print(f"[OWL MONITOR] Checking: {label} ({url})...")
    current_text = ""
    
    # 1. Fetch content
    try:
        if _stealthy_available:
            page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
            if selector:
                current_text = "\n".join(_get_text(e) for e in page.css(selector) if _get_text(e))
            else:
                current_text = page.get_all_text(strip=True)
        elif _scrapling_available:
            page = Fetcher().get(url)
            if selector:
                current_text = "\n".join(_get_text(e) for e in page.css(selector) if _get_text(e))
            else:
                current_text = page.get_all_text(strip=True)
        else:
            # Fallback to standard urllib
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                html = response.read().decode('utf-8', errors='ignore')
                # Basic HTML tag stripping as fallback
                current_text = re.sub(r'<[^>]+>', ' ', html)
                current_text = " ".join(current_text.split())
    except Exception as e:
        print(f"[OWL MONITOR ERROR] Fetch failed for {url}: {e}")
        return False, None
        
    # 2. Check for changes
    content_hash = hashlib.sha256(current_text.encode()).hexdigest()
    last_hash = monitor.get("last_snapshot")
    
    if last_hash == content_hash:
        print(f"[OWL MONITOR] No changes for {url}")
        return True, content_hash
        
    print(f"[OWL MONITOR] Change detected for {url}!")
    
    # Get previous text from history or empty
    previous_text = ""
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            row = conn.execute("""
                SELECT content_snapshot FROM web_page_history
                WHERE url = ?
                ORDER BY fetched_at DESC LIMIT 1
            """, (url,)).fetchone()
            if row:
                previous_text = row[0]
    except Exception:
        pass
        
    import difflib
    prev_lines = previous_text.splitlines(keepends=True)
    curr_lines = current_text.splitlines(keepends=True)
    diff = list(difflib.unified_diff(prev_lines, curr_lines, fromfile="previous", tofile="current", n=2))
    added = [l[1:].strip() for l in diff if l.startswith("+") and not l.startswith("+++")]
    removed = [l[1:].strip() for l in diff if l.startswith("-") and not l.startswith("---")]
    
    semantic_changes = _classify_semantic_changes(added, removed)
    has_changes = bool(diff)
    is_significant = 1 if (len(semantic_changes) > 0 or len(added) > 5 or len(removed) > 5) else 0
    
    now_iso = datetime.now(timezone.utc).isoformat() + "Z"
    change_summary = ""
    if semantic_changes:
        change_summary = ", ".join(f"{c['type']} (severity: {c['severity']})" for c in semantic_changes)
    elif has_changes:
        change_summary = f"{len(added)} lines added, {len(removed)} lines removed"
        
    # Store history
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT INTO web_page_history (url, label, content_hash, content_snapshot, significant_change, change_summary, fetched_at, css_selector)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (url, label, content_hash, current_text[:1000], is_significant, change_summary, now_iso, selector))
            
            for change in semantic_changes:
                conn.execute("""
                    INSERT INTO web_semantic_changes (url, label, change_type, old_value, new_value, detected_at, alert_sent_to_memory)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                """, (url, label, change["type"], "", ", ".join(change["matched_text"]), now_iso))
            conn.commit()
    except Exception as db_err:
        print(f"[OWL MONITOR WARNING] Failed to write history: {db_err}")
        
    # Trigger notifications & invalidation
    if semantic_changes:
        _notify_owl_memory_of_change(url, f"web_monitor_alert: {label}", change_summary)
        
    if is_significant:
        invalidate_related_research(url, change_summary)
        
    # Write a daemon signal
    try:
        signal_payload = {
            "url": url,
            "label": label,
            "change_summary": change_summary,
            "is_significant": bool(is_significant),
            "semantic_changes": semantic_changes
        }
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT INTO daemon_signals (signal_type, payload, created_at, consumed)
                VALUES (?, ?, ?, 0)
            """, ("monitor_alert", json.dumps(signal_payload), now_iso))
            conn.commit()
            
        # Broadcast cross-server event
        broadcast_event(
            source_server="owl-web",
            event_type="monitor_alert",
            payload=signal_payload
        )
    except Exception as e:
        print(f"[OWL MONITOR WARNING] Failed to write signal: {e}")
        
    return True, content_hash

def main():
    monitor_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "owl_monitors.json")
    if not os.path.exists(monitor_file):
        print("[OWL MONITOR] No monitors file found. Exiting.")
        return
        
    try:
        with open(monitor_file, "r") as f:
            monitors = json.load(f)
    except Exception as e:
        print(f"[OWL MONITOR ERROR] Failed to read monitors file: {e}")
        return
        
    updated = False
    now = time.time()
    
    for m in monitors:
        if not m.get("is_active", True):
            continue
            
        url = m["url"]
        interval = m.get("check_interval_minutes", 60)
        last_checked = m.get("last_checked_at")
        
        should_check = False
        if not last_checked:
            should_check = True
        else:
            try:
                # ISO format parse
                clean_iso = last_checked.replace('Z', '')
                dt = datetime.fromisoformat(clean_iso)
                elapsed_min = (now - dt.timestamp()) / 60
                if elapsed_min >= interval:
                    should_check = True
            except Exception:
                should_check = True
                
        if should_check:
            success, new_hash = check_single_monitor(m)
            if success:
                m["last_snapshot"] = new_hash
                m["last_checked_at"] = datetime.now(timezone.utc).isoformat() + "Z"
                updated = True
                
    if updated:
        try:
            with open(monitor_file, "w") as f:
                json.dump(monitors, f, indent=2)
            print("[OWL MONITOR] Monitors list updated successfully.")
        except Exception as e:
            print(f"[OWL MONITOR ERROR] Failed to write updated monitors list: {e}")

if __name__ == "__main__":
    main()
