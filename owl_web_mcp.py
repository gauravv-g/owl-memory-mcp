"""
OWL Web Intelligence MCP Server
================================
Exposes all Scrapling capabilities as MCP tools callable by any AI agent.

Scrapling is a Python adaptive web scraping framework that:
  - Bypasses Cloudflare Turnstile and anti-bot systems (StealthyFetcher)
  - Handles JS-heavy pages via stealth browser automation (DynamicFetcher)
  - Performs adaptive scraping that survives website redesigns
  - Supports full-scale crawls with proxy rotation (Spider)
  - CSS/XPath selectors with element persistence (auto_save/adaptive)
  - Async batch fetching (AsyncFetcher)

This server runs alongside owl_memory_v5.js (Node.js MCP server).
Both are registered in claude_desktop_config.json / mcp_config.json.

Registration (already done in claude_desktop_config.json):
  "owl-web": {
    "command": "python",
    "args": ["c:/Users/shiva/hermes-custom-mcps/owl_web_mcp.py"]
  }
"""

import asyncio
import json
import sys
import traceback
import os
import re
import time
import sqlite3
import hashlib
from datetime import datetime, timezone
from typing import Any
import owl_shared_intelligence
from owl_shared_intelligence import _OWL_DB_PATH, _get_domain_trust, _notify_owl_memory_of_change, computeTemporalFreshness, invalidate_related_research

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found. Run: pip install mcp", file=sys.stderr)
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Lazy-load Scrapling — gives a clean error if not installed
# ─────────────────────────────────────────────────────────────────────────────
_scrapling_available = False
_stealthy_available = False
_dynamic_available = False
_async_available = False

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

try:
    from scrapling.fetchers import DynamicFetcher
    _dynamic_available = True
except ImportError:
    pass

try:
    from scrapling.fetchers import AsyncFetcher
    _async_available = True
except ImportError:
    pass

server = Server("owl-web")


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _get_text(el):
    """Safely extract text from a Scrapling element."""
    try:
        return el.get_all_text(strip=True)
    except Exception:
        try:
            return el.get_all_text()
        except Exception:
            return str(el)


CHANGE_PATTERN_CLASSIFIERS = [
    (r"₹[\d,]+|Rs\.?\s*[\d,]+|\$[\d,.]+", "price_change", "high"),
    (r"\b(discontinued|removed|no longer|unavailable|sold out)\b", "removal", "high"),
    (r"\b(new|launching|introducing|available now|added)\b", "new_listing", "medium"),
    (r"\b(deadline|last date|closing|expires?)\b.*\d{1,2}[\/-]\d{1,2}", "deadline_change", "critical"),
    (r"\b(circular|notification|gazette|amendment|regulation)\b", "regulatory_update", "critical"),
    (r"version\s+\d+\.\d+|\bv\d+\.\d+\b", "version_change", "medium"),
    (r"\b(security|vulnerability|CVE-\d+|breach|patch)\b", "security_alert", "critical"),
]

def _extract_semantic_events(previous_text: str, current_text: str) -> list[dict]:
    events = []
    
    # 1. Price extraction and comparison
    price_regex = r'(?:₹|\$|Rs\.?|USD|INR)\s*([0-9,]+(?:\.[0-9]+)?)'
    prev_prices = re.findall(price_regex, previous_text)
    curr_prices = re.findall(price_regex, current_text)
    
    if prev_prices and curr_prices:
        try:
            p1 = float(prev_prices[0].replace(',', ''))
            p2 = float(curr_prices[0].replace(',', ''))
            if p1 != p2:
                direction = "increase" if p2 > p1 else "decrease"
                magnitude = f"{abs(p2 - p1) / p1 * 100:.1f}%" if p1 > 0 else "N/A"
                events.append({
                    "type": "PriceChangeEvent",
                    "severity": "critical",
                    "old_value": f"{p1}",
                    "new_value": f"{p2}",
                    "magnitude": magnitude,
                    "direction": direction,
                    "description": f"Price changed from {p1} to {p2} ({direction} of {magnitude})"
                })
        except Exception:
            pass

    # 2. Version extraction and comparison
    version_regex = r'\b(?:version|v)\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b'
    prev_versions = re.findall(version_regex, previous_text, re.IGNORECASE)
    curr_versions = re.findall(version_regex, current_text, re.IGNORECASE)
    
    if prev_versions and curr_versions:
        v1 = prev_versions[0]
        v2 = curr_versions[0]
        if v1 != v2:
            try:
                p1_parts = v1.split('.')
                p2_parts = v2.split('.')
                is_major = p1_parts[0] != p2_parts[0]
            except Exception:
                is_major = False
            events.append({
                "type": "VersionChangeEvent",
                "severity": "high" if is_major else "medium",
                "old_value": v1,
                "new_value": v2,
                "is_major": is_major,
                "description": f"Version changed from {v1} to {v2} (Major: {is_major})"
            })

    # 3. Status extraction and comparison
    status_keywords = ["deprecated", "available", "maintenance", "offline", "active", "disabled"]
    for keyword in status_keywords:
        prev_has = keyword in previous_text.lower()
        curr_has = keyword in current_text.lower()
        if curr_has and not prev_has:
            events.append({
                "type": "StatusChangeEvent",
                "severity": "critical" if keyword in ["deprecated", "offline", "maintenance"] else "medium",
                "old_value": "not_present",
                "new_value": keyword,
                "description": f"Status updated to: {keyword}"
            })
            
    # Fallback to standard regex patterns if no specific events were found
    if not events:
        combined_text = (previous_text + " " + current_text).lower()
        for pattern, change_type, severity in CHANGE_PATTERN_CLASSIFIERS:
            if re.search(pattern, combined_text, re.IGNORECASE):
                matches = re.findall(pattern, combined_text, re.IGNORECASE)
                events.append({
                    "type": change_type,
                    "severity": severity,
                    "old_value": "",
                    "new_value": ", ".join(list(set(matches))[:3]),
                    "description": f"Detected {change_type} in text."
                })
                
    return events

def _classify_semantic_changes(added_lines: list[str], removed_lines: list[str]) -> list[dict]:
    # Compatibility wrapper
    added_text = " ".join(added_lines)
    removed_text = " ".join(removed_lines)
    return _extract_semantic_events(removed_text, added_text)


def _compute_optimal_check_frequency(url: str) -> int:
    """Pillar 19: Tesla Resonant Adaptive Monitoring Frequency"""
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            rows = conn.execute("""
                SELECT fetched_at, significant_change FROM web_page_history
                WHERE url = ?
                ORDER BY fetched_at ASC
            """, (url,)).fetchall()
            
            if len(rows) < 3:
                return 60
                
            change_times = []
            for r in rows:
                if r[1] == 1:
                    change_times.append(r[0])
                    
            if len(change_times) < 2:
                return 1440 # Daily
                
            intervals = []
            for i in range(1, len(change_times)):
                try:
                    dt1 = datetime.fromisoformat(change_times[i-1].replace('Z', ''))
                    dt2 = datetime.fromisoformat(change_times[i].replace('Z', ''))
                    delta = (dt2 - dt1).total_seconds() / 60
                    if delta > 0:
                        intervals.append(delta)
                except Exception:
                    pass
                    
            if not intervals:
                return 1440
                
            avg_interval = sum(intervals) / len(intervals)
            optimal = max(5, int(avg_interval / 3))
            return min(optimal, 1440)
    except Exception:
        pass
    return 60


def _extract_from_page(page, css_selector=None, xpath=None, attribute=None, limit=50):
    """Extract elements from a Scrapling page using CSS or XPath."""
    results = []
    try:
        if css_selector:
            elements = page.css(css_selector)
        elif xpath:
            elements = page.xpath(xpath)
        else:
            return None

        for el in list(elements)[:limit]:
            if attribute:
                val = el.attrib.get(attribute, '')
                if val:
                    results.append(val)
            else:
                text = _get_text(el)
                if text:
                    results.append(text)
    except Exception as e:
        results.append(f"[selector error: {e}]")
    return results


def _page_to_dict(page, url, css_selector=None, xpath=None, attribute=None, limit=50):
    """Convert a Scrapling Response page to a clean dict."""
    trust_score = _get_domain_trust(url)
    now_iso = datetime.now(timezone.utc).isoformat() + "Z"
    freshness = computeTemporalFreshness(url, now_iso)
    
    result = {
        "url": url,
        "status": getattr(page, 'status', None),
        "title": None,
        "domain_trust": {
            "trust_score": trust_score,
            "warning": "Low-trust domain in source leverage ledger. Proceed with caution." if trust_score < 0.2 else None
        },
        "freshness": freshness
    }

    # Title
    try:
        titles = page.css('title')
        if titles:
            result["title"] = _get_text(list(titles)[0])
    except Exception:
        pass

    # Extract elements if selector provided, else full text
    if css_selector or xpath:
        extracted = _extract_from_page(page, css_selector, xpath, attribute, limit)
        result["extracted_elements"] = extracted or []
        result["element_count"] = len(result["extracted_elements"])
    else:
        try:
            text = page.get_all_text(strip=True)
            result["text"] = text[:8000]  # Cap to avoid context bloat
            result["text_length"] = len(text)
        except Exception as e:
            try:
                result["text"] = page.html_content[:8000]
                result["text_length"] = len(page.html_content)
                result["text_note"] = "returned raw HTML (get_all_text failed)"
            except Exception:
                result["error"] = f"text extraction failed: {e}"

    return result


# ─────────────────────────────────────────────────────────────────────────────
# TOOL DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="web_fetch",
            description=(
                "Fetch a webpage using a simple HTTP request (no browser, no JavaScript). "
                "Fast and lightweight. Use for: static pages, JSON APIs, GitHub READMEs, "
                "documentation, news articles, any page that doesn't require JavaScript. "
                "Returns page text, title, and optionally CSS-selected elements."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch"},
                    "css_selector": {"type": "string", "description": "CSS selector to extract specific elements (optional)"},
                    "xpath": {"type": "string", "description": "XPath selector to extract elements (optional)"},
                    "attribute": {"type": "string", "description": "Element attribute to return (e.g. 'href', 'src'). Omit for text."},
                    "timeout": {"type": "integer", "description": "Request timeout in seconds (default: 30)", "default": 30},
                    "limit": {"type": "integer", "description": "Max elements to return when using selector (default: 50)", "default": 50}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="web_fetch_stealthy",
            description=(
                "Fetch a webpage using a STEALTH browser that bypasses anti-bot protection. "
                "Solves Cloudflare Turnstile and bot detection OUT OF THE BOX. "
                "Use when a normal web_fetch returns 403, a CAPTCHA page, or empty content "
                "from sites like LinkedIn, Twitter, Reddit, or Cloudflare-protected pages. "
                "Slower than web_fetch (browser launch ~3-5s) but undetectable."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch stealthily"},
                    "headless": {"type": "boolean", "description": "Run browser without visible window (default: true)", "default": True},
                    "network_idle": {"type": "boolean", "description": "Wait until network is idle before returning (default: true)", "default": True},
                    "css_selector": {"type": "string", "description": "CSS selector to extract specific elements (optional)"},
                    "attribute": {"type": "string", "description": "Element attribute to extract (e.g. 'href', 'src'). Omit for text."},
                    "timeout": {"type": "integer", "description": "Request timeout in seconds (default: 60)", "default": 60},
                    "limit": {"type": "integer", "description": "Max elements when using selector (default: 50)", "default": 50},
                    "solve_cloudflare": {"type": "boolean", "description": "Attempt to auto-solve Cloudflare challenges (default: true)", "default": True}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="web_fetch_dynamic",
            description=(
                "Fetch a webpage and execute JavaScript before returning content. "
                "Use for Single Page Apps (React, Vue, Angular), infinite scroll pages, "
                "or any page requiring JS to render content. "
                "Can wait for specific elements to appear before returning."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch with JS execution"},
                    "css_selector": {"type": "string", "description": "CSS selector to extract elements after JS renders (optional)"},
                    "wait_selector": {"type": "string", "description": "CSS selector to wait for before returning (optional)"},
                    "headless": {"type": "boolean", "description": "Run browser without visible window (default: true)", "default": True},
                    "network_idle": {"type": "boolean", "description": "Wait for network idle (default: true)", "default": True},
                    "timeout": {"type": "integer", "description": "Request timeout in seconds (default: 60)", "default": 60},
                    "attribute": {"type": "string", "description": "Attribute to extract (e.g. 'href', 'src'). Omit for text."},
                    "limit": {"type": "integer", "description": "Max elements to return (default: 50)", "default": 50}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="web_scrape_adaptive",
            description=(
                "Scrape elements from a webpage with ADAPTIVE MODE — the killer feature. "
                "First run: pass auto_save=true. OWL saves the LOCATION of the element in its memory. "
                "If the website redesigns later: pass adaptive=true. OWL automatically finds the "
                "element even if CSS classes, IDs, or structure changed. "
                "Use for monitoring pages that change over time (e-commerce prices, job listings, etc). "
                "Pass stealthy=true for anti-bot protected sites."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to scrape"},
                    "css_selector": {"type": "string", "description": "CSS selector for target elements"},
                    "auto_save": {"type": "boolean", "description": "Save element location for future adaptive recovery (first run)", "default": False},
                    "adaptive": {"type": "boolean", "description": "Auto-find elements even if they moved after site redesign (repeat runs)", "default": False},
                    "stealthy": {"type": "boolean", "description": "Use stealth browser to bypass bot detection", "default": False},
                    "attribute": {"type": "string", "description": "Attribute to extract (e.g. 'href', 'src', 'data-price'). Omit for text."},
                    "limit": {"type": "integer", "description": "Max elements to return (default: 50)", "default": 50}
                },
                "required": ["url", "css_selector"]
            }
        ),
        Tool(
            name="web_batch_fetch",
            description=(
                "Fetch multiple URLs in parallel using async requests. "
                "All URLs are fetched simultaneously. "
                "Use for research tasks requiring data from many pages at once. "
                "Up to 20 URLs per call. Does NOT use browsers — use web_fetch for each "
                "individually if you need stealth/JS."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "urls": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of URLs to fetch in parallel (max 20)"
                    },
                    "css_selector": {"type": "string", "description": "CSS selector applied to ALL pages (optional)"},
                    "timeout": {"type": "integer", "description": "Per-request timeout in seconds (default: 30)", "default": 30}
                },
                "required": ["urls"]
            }
        ),
        Tool(
            name="web_extract_structured",
            description=(
                "Extract ALL structured data from a webpage in one call. "
                "Returns: page title, metadata (Open Graph, Twitter cards), "
                "all hyperlinks, all headings (H1-H3), all tables, and optionally images. "
                "Use when you need a comprehensive snapshot of a page's content."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to extract structured data from"},
                    "stealthy": {"type": "boolean", "description": "Use stealth browser for bot-protected sites (default: false)", "default": False},
                    "include_links": {"type": "boolean", "description": "Include all hyperlinks (default: true)", "default": True},
                    "include_images": {"type": "boolean", "description": "Include image URLs and alt text (default: false)", "default": False},
                    "include_tables": {"type": "boolean", "description": "Extract table data as arrays (default: true)", "default": True},
                    "include_metadata": {"type": "boolean", "description": "Include meta tags, OG tags, Twitter cards (default: true)", "default": True},
                    "timeout": {"type": "integer", "description": "Timeout in seconds (default: 30)", "default": 30}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="web_diff",
            description=(
                "Compare two snapshots of a webpage and return what changed. "
                "Fetches the URL now and diffs against a previous snapshot you supply (as text). "
                "Use to detect price changes, content updates, or new listings since last check. "
                "Returns added lines, removed lines, and a change summary."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to fetch the current version of"},
                    "previous_text": {"type": "string", "description": "The previous page text to compare against"},
                    "css_selector": {"type": "string", "description": "CSS selector to focus comparison on a specific section (optional)"},
                    "stealthy": {"type": "boolean", "description": "Use stealth browser for bot-protected sites (default: false)", "default": False},
                    "context_lines": {"type": "integer", "description": "Lines of context around each change (default: 2)", "default": 2}
                },
                "required": ["url", "previous_text"]
            }
        ),
        Tool(
            name="web_monitor_start",
            description=(
                "Register a URL to monitor for changes. Writes a monitor record to owl_monitors.json "
                "in the MCP server directory. The daemon can poll this file to check for updates. "
                "Use to set up recurring change detection for a URL."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to monitor"},
                    "label": {"type": "string", "description": "Human-readable label for this monitor"},
                    "css_selector": {"type": "string", "description": "CSS selector to watch (optional — monitors full page if omitted)"},
                    "check_interval_minutes": {"type": "integer", "description": "How often to check for changes in minutes (default: 60)", "default": 60},
                    "notify_on": {"type": "string", "description": "What to notify on: 'any_change' or 'keyword_added' (default: 'any_change')", "default": "any_change"},
                    "keyword": {"type": "string", "description": "Keyword to watch for (only used when notify_on=keyword_added)", "default": ""}
                },
                "required": ["url", "label"]
            }
        ),
        Tool(
            name="web_session_scrape",
            description=(
                "Scrape multiple CSS selectors from a single page in one browser session. "
                "More efficient than calling web_fetch multiple times for the same page. "
                "Returns a dict mapping each selector to its extracted values. "
                "Use when you need multiple data points from one page (price + title + rating, etc)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to scrape"},
                    "selectors": {
                        "type": "object",
                        "description": "Dict mapping field names to CSS selectors. E.g. {\"price\": \".price-tag\", \"title\": \"h1\"}"
                    },
                    "stealthy": {"type": "boolean", "description": "Use stealth browser for bot-protected sites (default: false)", "default": False},
                    "attribute": {"type": "string", "description": "Attribute to extract from ALL selectors (e.g. 'href'). Omit for text."},
                    "limit_per_selector": {"type": "integer", "description": "Max elements per selector (default: 5)", "default": 5}
                },
                "required": ["url", "selectors"]
            }
        ),
        Tool(
            name="web_research_crawl",
            description=(
                "Crawl a website starting from a URL, following internal links up to a specified depth. "
                "Returns aggregated text content from all crawled pages. "
                "Use for documentation sites, wikis, or any multi-page research where you need the full picture. "
                "Max 20 pages per crawl."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "start_url": {"type": "string", "description": "Starting URL for the crawl"},
                    "max_pages": {"type": "integer", "description": "Maximum pages to crawl (1-20, default: 5)", "default": 5},
                    "same_domain_only": {"type": "boolean", "description": "Only follow links on the same domain (default: true)", "default": True},
                    "css_selector": {"type": "string", "description": "CSS selector to extract from each page (optional — uses full text if omitted)"},
                    "link_selector": {"type": "string", "description": "CSS selector to find links to follow (default: 'a')", "default": "a"}
                },
                "required": ["start_url"]
            }
        ),
        Tool(
            name="web_trace_claim",
            description=(
                "Returns the full provenance chain (source URLs, trust scores, fetch times) "
                "for a claim or snippet stored in OWL's memory."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "claim_text": {
                        "type": "string",
                        "description": "The claim text or keyword to trace."
                    },
                    "project": {
                        "type": "string",
                        "description": "The project context. Default 'default'.",
                        "default": "default"
                    }
                },
                "required": ["claim_text"]
            }
        )
    ]



# ─────────────────────────────────────────────────────────────────────────────
# TOOL HANDLERS
# ─────────────────────────────────────────────────────────────────────────────

def _not_installed(lib_name, extra=""):
    msg = {"error": f"{lib_name} not installed or failed to import."}
    if extra:
        msg["fix"] = extra
    return [TextContent(type="text", text=json.dumps(msg))]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        # ── web_fetch ──────────────────────────────────────────────────────
        if name == "web_fetch":
            if not _scrapling_available:
                return _not_installed("Scrapling", "pip install scrapling")

            url = arguments["url"]
            css_selector = arguments.get("css_selector")
            xpath = arguments.get("xpath")
            attribute = arguments.get("attribute")
            timeout = arguments.get("timeout", 30)
            limit = arguments.get("limit", 50)

            page = Fetcher().get(url, timeout=timeout)
            result = _page_to_dict(page, url, css_selector, xpath, attribute, limit)
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        # ── web_fetch_stealthy ─────────────────────────────────────────────
        elif name == "web_fetch_stealthy":
            if not _stealthy_available:
                return _not_installed("StealthyFetcher", "pip install scrapling && python -m playwright install chromium")

            url = arguments["url"]
            headless = arguments.get("headless", True)
            network_idle = arguments.get("network_idle", True)
            css_selector = arguments.get("css_selector")
            attribute = arguments.get("attribute")
            timeout = arguments.get("timeout", 60)
            limit = arguments.get("limit", 50)
            solve_cloudflare = arguments.get("solve_cloudflare", True)

            page = StealthyFetcher.fetch(
                url,
                headless=headless,
                network_idle=network_idle,
                timeout=timeout,
                solve_cloudflare=solve_cloudflare
            )
            result = _page_to_dict(page, url, css_selector, None, attribute, limit)
            result["mode"] = "stealthy_browser"
            result["cloudflare_bypass_attempted"] = solve_cloudflare
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        # ── web_fetch_dynamic ──────────────────────────────────────────────
        elif name == "web_fetch_dynamic":
            if not _dynamic_available:
                return _not_installed("DynamicFetcher", "pip install scrapling && python -m playwright install chromium")

            url = arguments["url"]
            css_selector = arguments.get("css_selector")
            wait_selector = arguments.get("wait_selector")
            headless = arguments.get("headless", True)
            network_idle = arguments.get("network_idle", True)
            timeout = arguments.get("timeout", 60)
            attribute = arguments.get("attribute")
            limit = arguments.get("limit", 50)

            kwargs = {
                "headless": headless,
                "network_idle": network_idle,
                "timeout": timeout
            }
            if wait_selector:
                kwargs["wait_selector"] = wait_selector

            # Run DynamicFetcher in thread pool to avoid sync_playwright() inside asyncio loop
            loop = asyncio.get_event_loop()
            page = await loop.run_in_executor(None, lambda: DynamicFetcher.fetch(url, **kwargs))
            result = _page_to_dict(page, url, css_selector, None, attribute, limit)
            result["mode"] = "dynamic_js"
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        # ── web_scrape_adaptive ────────────────────────────────────────────
        elif name == "web_scrape_adaptive":
            if not _scrapling_available:
                return _not_installed("Scrapling", "pip install scrapling")

            url = arguments["url"]
            css_selector = arguments["css_selector"]
            auto_save = arguments.get("auto_save", False)
            adaptive = arguments.get("adaptive", False)
            stealthy = arguments.get("stealthy", False)
            attribute = arguments.get("attribute")
            limit = arguments.get("limit", 50)

            if stealthy and _stealthy_available:
                page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
            else:
                page = Fetcher().get(url)

            # Use Scrapling's adaptive CSS selector
            elements = page.css(css_selector, auto_save=auto_save, adaptive=adaptive)

            extracted = []
            for el in list(elements)[:limit]:
                if attribute:
                    val = el.attrib.get(attribute, '')
                    if val:
                        extracted.append(val)
                else:
                    text = _get_text(el)
                    if text:
                        extracted.append(text)

            note = "Standard scrape."
            if auto_save:
                note = "Element positions saved to OWL's adaptive memory. On next run, pass adaptive=true to auto-recover if the site redesigns."
            elif adaptive:
                note = "Adaptive mode: OWL auto-relocated elements even if the site structure changed."

            trust_score = _get_domain_trust(url)
            now_iso = datetime.now(timezone.utc).isoformat() + "Z"
            freshness = computeTemporalFreshness(url, now_iso)

            return [TextContent(type="text", text=json.dumps({
                "url": url,
                "css_selector": css_selector,
                "adaptive_mode": adaptive,
                "auto_save_enabled": auto_save,
                "elements_found": len(extracted),
                "data": extracted,
                "note": note,
                "domain_trust": {
                    "trust_score": trust_score,
                    "warning": "Low-trust domain in source leverage ledger. Proceed with caution." if trust_score < 0.2 else None
                },
                "freshness": freshness
            }, ensure_ascii=False))]

        # ── web_batch_fetch ────────────────────────────────────────────────
        elif name == "web_batch_fetch":
            if not _async_available:
                return _not_installed("AsyncFetcher", "pip install scrapling")

            urls = arguments["urls"][:20]
            css_selector = arguments.get("css_selector")
            timeout = arguments.get("timeout", 30)

            results = []
            # AsyncFetcher uses sync API under the hood for .get()
            # Run them concurrently via asyncio
            async def fetch_one(url):
                try:
                    loop = asyncio.get_event_loop()
                    page = await loop.run_in_executor(None, lambda: Fetcher().get(url, timeout=timeout))
                    return _page_to_dict(page, url, css_selector)
                except Exception as e:
                    return {"url": url, "error": str(e)}

            results = await asyncio.gather(*[fetch_one(u) for u in urls])
            return [TextContent(type="text", text=json.dumps({
                "total": len(results),
                "results": list(results)
            }, ensure_ascii=False))]

        # ── web_extract_structured ─────────────────────────────────────────
        elif name == "web_extract_structured":
            if not _scrapling_available:
                return _not_installed("Scrapling", "pip install scrapling")

            url = arguments["url"]
            stealthy = arguments.get("stealthy", False)
            include_links = arguments.get("include_links", True)
            include_images = arguments.get("include_images", False)
            include_tables = arguments.get("include_tables", True)
            include_metadata = arguments.get("include_metadata", True)
            timeout = arguments.get("timeout", 30)

            if stealthy and _stealthy_available:
                page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=timeout)
            else:
                page = Fetcher().get(url, timeout=timeout)

            result = {"url": url, "status": getattr(page, 'status', None), "title": None}

            # Title
            try:
                titles = page.css("title")
                if titles:
                    result["title"] = _get_text(list(titles)[0])
            except Exception:
                pass

            # Metadata
            if include_metadata:
                meta = {}
                try:
                    for m in page.css("meta"):
                        name_attr = m.attrib.get("name") or m.attrib.get("property") or ""
                        content = m.attrib.get("content", "")
                        if name_attr and content:
                            meta[name_attr] = content[:300]
                    result["metadata"] = meta
                except Exception as e:
                    result["metadata_error"] = str(e)

            # Headings
            try:
                headings = []
                for h in page.css("h1, h2, h3"):
                    text = _get_text(h)
                    if text:
                        headings.append({"tag": h.tag, "text": text[:200]})
                    if len(headings) >= 30:
                        break
                result["headings"] = headings
            except Exception as e:
                result["headings_error"] = str(e)

            # Links
            if include_links:
                try:
                    links = []
                    for a in page.css("a"):
                        href = a.attrib.get("href", "")
                        text = _get_text(a)
                        if href and not href.startswith("#"):
                            links.append({"text": text[:100], "href": href[:400]})
                        if len(links) >= 100:
                            break
                    result["links"] = links
                    result["link_count"] = len(links)
                except Exception as e:
                    result["links_error"] = str(e)

            # Images
            if include_images:
                try:
                    images = []
                    for img in page.css("img"):
                        src = img.attrib.get("src", "")
                        alt = img.attrib.get("alt", "")
                        if src:
                            images.append({"src": src[:400], "alt": alt[:100]})
                        if len(images) >= 50:
                            break
                    result["images"] = images
                except Exception as e:
                    result["images_error"] = str(e)

            # Tables
            if include_tables:
                try:
                    tables = []
                    for table in page.css("table"):
                        rows = []
                        for tr in table.css("tr"):
                            cells = [_get_text(td) for td in tr.css("td, th") if _get_text(td)]
                            if cells:
                                rows.append(cells)
                            if len(rows) >= 25:
                                break
                        if rows:
                            tables.append(rows)
                        if len(tables) >= 5:
                            break
                    result["tables"] = tables
                    result["table_count"] = len(tables)
                except Exception as e:
                    result["tables_error"] = str(e)

            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

        # ─── web_diff ─────────────────────────────────────────────────────────
        elif name == "web_diff":
            import difflib
            url = arguments.get("url", "")
            previous_text = arguments.get("previous_text", "")
            selector = arguments.get("css_selector", "")
            stealthy = arguments.get("stealthy", False)
            context_lines = int(arguments.get("context_lines", 2))

            if not url or previous_text is None:
                return [TextContent(type="text", text=json.dumps({"error": "url and previous_text are required"}))]  

            # Fetch current version
            try:
                if stealthy and _stealthy_available:
                    page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
                else:
                    page = Fetcher().get(url)

                if selector:
                    elements = page.css(selector)
                    current_text = "\n".join(_get_text(e) for e in elements if _get_text(e))
                else:
                    current_text = page.get_all_text(strip=True)
            except Exception as fetch_err:
                return [TextContent(type="text", text=json.dumps({"error": f"Fetch failed: {str(fetch_err)}"}))]

            # Diff
            prev_lines = previous_text.splitlines(keepends=True)
            curr_lines = current_text.splitlines(keepends=True)
            diff = list(difflib.unified_diff(prev_lines, curr_lines, fromfile="previous", tofile="current", n=context_lines))
            added = [l[1:].strip() for l in diff if l.startswith("+") and not l.startswith("+++")]
            removed = [l[1:].strip() for l in diff if l.startswith("-") and not l.startswith("---")]

            # Pillar 20: Classify semantic changes
            semantic_events = _extract_semantic_events(previous_text, current_text)
            has_changes = bool(diff)
            is_significant = 1 if (len(semantic_events) > 0 or len(added) > 5 or len(removed) > 5) else 0

            # Store in web_page_history
            now_iso = datetime.now(timezone.utc).isoformat() + "Z"
            content_hash = hashlib.sha256(current_text.encode()).hexdigest()
            change_summary = ""
            if semantic_events:
                change_summary = ", ".join(f"{c['type']} ({c['description']})" for c in semantic_events)
            elif has_changes:
                change_summary = f"{len(added)} lines added, {len(removed)} lines removed"

            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    conn.execute("PRAGMA wal_autocheckpoint = 100")
                    conn.execute("""
                        INSERT INTO web_page_history (url, label, content_hash, content_snapshot, significant_change, change_summary, fetched_at, css_selector)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (url, "web_diff", content_hash, current_text[:1000], is_significant, change_summary, now_iso, selector))
                    
                    for ev in semantic_events:
                        conn.execute("""
                            INSERT INTO web_semantic_changes (url, label, change_type, old_value, new_value, detected_at, alert_sent_to_memory)
                            VALUES (?, ?, ?, ?, ?, ?, 1)
                        """, (url, "web_diff", ev["type"], ev.get("old_value", ""), ev.get("new_value", ""), now_iso))
                    conn.commit()
            except Exception as db_err:
                print(f"[debug] failed to write page history: {db_err}", file=sys.stderr)

            # Pillar 17: Send somatic alert to owl-memory if significant semantic changes found
            if semantic_events:
                _notify_owl_memory_of_change(url, "web_diff_alert", change_summary, arguments.get("project", "default"))
                
            # W4: Web-Research Feedback Loop
            if is_significant:
                invalidate_related_research(url, change_summary)

            # Einstein domain temporal freshness (Pillar 18)
            freshness = computeTemporalFreshness(url, now_iso)

            return [TextContent(type="text", text=json.dumps({
                "status": "diff_complete",
                "url": url,
                "has_changes": has_changes,
                "is_significant": bool(is_significant),
                "added_lines": added[:50],
                "removed_lines": removed[:50],
                "total_added": len(added),
                "total_removed": len(removed),
                "semantic_changes": semantic_events,
                "freshness": freshness,
                "current_text_preview": current_text[:500],
                "raw_diff": "".join(diff[:200])
            }, ensure_ascii=False))]

        # ─── web_monitor_start ────────────────────────────────────────────────
        elif name == "web_monitor_start":
            import os
            url = arguments.get("url", "")
            label = arguments.get("label", "")
            selector = arguments.get("css_selector", "")
            interval = int(arguments.get("check_interval_minutes", 60))
            notify_on = arguments.get("notify_on", "any_change")
            keyword = arguments.get("keyword", "")

            if not url or not label:
                return [TextContent(type="text", text=json.dumps({"error": "url and label are required"}))]

            is_adaptive = False
            if interval <= 0:
                interval = _compute_optimal_check_frequency(url)
                is_adaptive = True

            monitor_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "owl_monitors.json")
            monitors = []
            if os.path.exists(monitor_file):
                try:
                    with open(monitor_file, "r") as f:
                        monitors = json.load(f)
                except Exception:
                    monitors = []

            monitor_id = f"mon_{int(time.time())}_{label[:20].replace(' ', '_')}"
            new_monitor = {
                "id": monitor_id,
                "url": url,
                "label": label,
                "css_selector": selector,
                "check_interval_minutes": interval,
                "is_adaptive": is_adaptive,
                "notify_on": notify_on,
                "keyword": keyword,
                "created_at": datetime.now(timezone.utc).isoformat() + "Z",
                "last_checked_at": None,
                "last_snapshot": None,
                "is_active": True
            }
            monitors.append(new_monitor)
            try:
                with open(monitor_file, "w") as f:
                    json.dump(monitors, f, indent=2)
                write_status = "saved"
            except Exception as write_err:
                write_status = f"failed: {str(write_err)}"

            return [TextContent(type="text", text=json.dumps({
                "status": "monitor_registered",
                "monitor_id": monitor_id,
                "url": url,
                "label": label,
                "check_interval_minutes": interval,
                "is_adaptive": is_adaptive,
                "file_write_status": write_status,
                "monitor_file": monitor_file,
                "message": f"Monitor '{label}' registered. OWL will track changes to {url} every {interval} minutes (Adaptive: {is_adaptive})."
            }, ensure_ascii=False))]

        # ─── web_session_scrape ───────────────────────────────────────────────
        elif name == "web_session_scrape":
            url = arguments.get("url", "")
            selectors = arguments.get("selectors", {})
            stealthy = arguments.get("stealthy", False)
            attribute = arguments.get("attribute", None)
            limit = int(arguments.get("limit_per_selector", 5))

            if not url or not selectors:
                return [TextContent(type="text", text=json.dumps({"error": "url and selectors are required"}))]

            # Fetch once
            try:
                if stealthy and _stealthy_available:
                    page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
                elif _scrapling_available:
                    page = Fetcher().get(url)
                else:
                    return [TextContent(type="text", text=json.dumps({"error": "scrapling not available"}))]  
            except Exception as fetch_err:
                return [TextContent(type="text", text=json.dumps({"error": f"Fetch failed: {str(fetch_err)}"}))]

            results = {}
            for field_name, css_sel in selectors.items():
                try:
                    elements = list(page.css(css_sel))[:limit]
                    if attribute:
                        vals = [e.attrib.get(attribute, "") for e in elements]
                    else:
                        vals = [_get_text(e) for e in elements]
                    results[field_name] = [v.strip() for v in vals if v and v.strip()]
                except Exception as sel_err:
                    results[field_name] = {"error": str(sel_err)}

            trust_score = _get_domain_trust(url)
            now_iso = datetime.now(timezone.utc).isoformat() + "Z"
            freshness = computeTemporalFreshness(url, now_iso)

            return [TextContent(type="text", text=json.dumps({
                "status": "session_scrape_complete",
                "url": url,
                "selectors_queried": list(selectors.keys()),
                "results": results,
                "domain_trust": {
                    "trust_score": trust_score,
                    "warning": "Low-trust domain in source leverage ledger. Proceed with caution." if trust_score < 0.2 else None
                },
                "freshness": freshness
            }, ensure_ascii=False))]

        # ─── web_research_crawl ───────────────────────────────────────────────
        elif name == "web_research_crawl":
            from urllib.parse import urlparse, urljoin
            import asyncio as _asyncio

            start_url = arguments.get("start_url", "")
            max_pages = min(int(arguments.get("max_pages", 5)), 20)
            same_domain_only = bool(arguments.get("same_domain_only", True))
            css_selector = arguments.get("css_selector", "")
            link_selector = arguments.get("link_selector", "a")

            if not start_url:
                return [TextContent(type="text", text=json.dumps({"error": "start_url is required"}))]

            base_domain = urlparse(start_url).netloc
            visited = set()
            queue = [start_url]
            crawled_pages = []

            while queue and len(crawled_pages) < max_pages:
                current_url = queue.pop(0)
                if current_url in visited:
                    continue
                visited.add(current_url)

                try:
                    page = Fetcher().get(current_url, timeout=20)
                    if css_selector:
                        elements = page.css(css_selector)
                        text = "\n".join(_get_text(e) for e in elements if _get_text(e))
                    else:
                        text = page.get_all_text(strip=True) or ""

                    # Collect links
                    links = []
                    try:
                        link_elements = page.css(link_selector)
                        for le in link_elements:
                            href = le.attrib.get("href", "")
                            if href:
                                abs_href = urljoin(current_url, href)
                                parsed = urlparse(abs_href)
                                if parsed.scheme in ("http", "https"):
                                    if not same_domain_only or parsed.netloc == base_domain:
                                        if abs_href not in visited and abs_href not in queue:
                                            queue.append(abs_href)
                                            links.append(abs_href)
                    except Exception:
                        pass

                    crawled_pages.append({
                        "url": current_url,
                        "text_preview": text[:800],
                        "word_count": len(text.split()),
                        "links_found": len(links)
                    })
                except Exception as crawl_err:
                    crawled_pages.append({
                        "url": current_url,
                        "error": str(crawl_err),
                        "text_preview": "",
                        "word_count": 0,
                        "links_found": 0
                    })

            # Aggregate all text
            aggregated_text = "\n\n---\n\n".join(
                f"## {p['url']}\n{p['text_preview']}" for p in crawled_pages if p.get('text_preview')
            )

            return [TextContent(type="text", text=json.dumps({
                "status": "crawl_complete",
                "start_url": start_url,
                "pages_crawled": len(crawled_pages),
                "pages": crawled_pages,
                "aggregated_text": aggregated_text[:6000]
            }, ensure_ascii=False))]

        elif name == "web_trace_claim":
            claim_text = arguments["claim_text"]
            project = arguments.get("project", "default")
            
            try:
                import sqlite3
                from owl_shared_intelligence import _OWL_DB_PATH
                
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    conn.row_factory = sqlite3.Row
                    cursor = conn.execute("""
                        SELECT id, memory_id, claim_text, source_url, source_trust, fetched_at, is_contradicted 
                        FROM web_provenance_chain
                        WHERE claim_text LIKE ?
                        ORDER BY fetched_at DESC LIMIT 50
                    """, (f"%{claim_text}%",))
                    rows = [dict(r) for r in cursor.fetchall()]
                    
                return [TextContent(type="text", text=json.dumps({
                    "status": "success",
                    "claim_queried": claim_text,
                    "provenance_chain": rows
                }, indent=2))]
            except Exception as trace_err:
                return [TextContent(type="text", text=json.dumps({
                    "error": f"Failed to trace claim: {str(trace_err)}"
                }))]

        else:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]

    except Exception as e:
        error_detail = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc()[-800:]
        }
        return [TextContent(type="text", text=json.dumps(error_detail))]


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    print("[OWL WEB MCP] Starting...", file=sys.stderr)
    status = []
    if _scrapling_available:
        status.append("Fetcher=OK")
    if _stealthy_available:
        status.append("StealthyFetcher=OK")
    if _dynamic_available:
        status.append("DynamicFetcher=OK")
    if _async_available:
        status.append("AsyncFetcher=OK")
    print(f"[OWL WEB MCP] Scrapling components: {', '.join(status) or 'NONE — run pip install scrapling'}", file=sys.stderr)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
