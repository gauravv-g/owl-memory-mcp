#!/usr/bin/env python3
"""
OWL Research MCP Server — DeerFlow-class multi-step research engine.
Provides 5 research tools:
  - research_quick      : Single-query DuckDuckGo search + article extraction
  - research_deep       : Multi-query iterative research with source deduplication
  - research_compare    : Side-by-side comparison of 2-4 topics
  - extract_article     : Full article text extraction from a URL
  - research_synthesize : Synthesize findings from multiple search results into a report

Dependencies: duckduckgo-search, newspaper3k, lxml_html_clean
Install: pip install duckduckgo-search newspaper3k lxml_html_clean
"""

import asyncio
import json
import re
import sys
import time
import traceback
from typing import Any, Optional
from urllib.parse import urlparse
import os

# Scrapling for richer extraction (falls back to newspaper3k if unavailable)
try:
    from scrapling.fetchers import Fetcher as ScraplingFetcher
    _scrapling_ok = True
except ImportError:
    _scrapling_ok = False

try:
    from duckduckgo_search import DDGS
except ImportError:
    print("ERROR: duckduckgo-search not installed. Run: pip install duckduckgo-search", file=sys.stderr)
    sys.exit(1)

try:
    import newspaper
    from newspaper import Article
except ImportError:
    print("ERROR: newspaper3k not installed. Run: pip install newspaper3k lxml_html_clean", file=sys.stderr)
    sys.exit(1)

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: MCP SDK not installed. Run: pip install mcp", file=sys.stderr)

# ─────────────────────────────────────────────────────────────────────────────
# OWL Memory Bridge — writes research results directly into owl-memory's SQLite
# Same DB path logic as owl_memory_v5.js: OWL_MEMORY_DB env or ~/.owl-memory/memory-v5.db
# ─────────────────────────────────────────────────────────────────────────────
import sqlite3
import hashlib
import owl_shared_intelligence
from owl_shared_intelligence import _owl_check_memory_first, _update_domain_trust, _get_domain_trust

_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

def _owl_store_research(topic: str, synthesis: str, project: str = "default", sources: list = None):
    _owl_store_research_with_code_link(topic, synthesis, project, sources, None)

def _owl_store_research_with_code_link(topic: str, synthesis: str, project: str = "default", sources: list = None, active_file: str = None, provenance_chain: list = None):
    """
    Write a research result directly into owl-memory's episodic_memories table.
    Pillar 16: Also propagates source domains to the source trust ledger.
    """
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return None
        content = f"[RESEARCH] {topic}\n\n{synthesis[:1500]}"
        mem_id = "res_" + hashlib.sha256(content.encode()).hexdigest()[:20]
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        sources_str = json.dumps(sources or [])
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            try:
                conn.execute("ALTER TABLE episodic_memories ADD COLUMN provenance_chain TEXT")
            except Exception:
                pass
                
            provenance_json = json.dumps(provenance_chain or [])
            conn.execute("""
                INSERT OR IGNORE INTO episodic_memories
                  (id, content, event_type, project, emotional_valence, emotional_arousal,
                   salience, strength, source, tags, created_at, updated_at, is_active, provenance_chain)
                VALUES (?, ?, 'research', ?, 0.3, 0.5, 0.8, 1.0, 'owl-research', ?, ?, ?, 1, ?)
            """, (mem_id, content, project, sources_str, now, now, provenance_json))
            
            if active_file:
                code_node_id = active_file.replace("\\", "/")
                # Ensure the code node exists in the DB
                conn.execute("""
                    INSERT OR IGNORE INTO code_nodes (id, name, node_type, filepath, project, created_at, updated_at)
                    VALUES (?, ?, 'file', ?, ?, ?, ?)
                """, (code_node_id, os.path.basename(code_node_id), code_node_id, project, now, now))
                
                # Link memory to code node
                conn.execute("""
                    INSERT OR IGNORE INTO memory_code_links (memory_id, code_node_id, link_type)
                    VALUES (?, ?, 'research_for')
                """, (mem_id, code_node_id))

            if provenance_chain:
                for item in provenance_chain:
                    claim_text = item.get("claim", "")
                    source_url = item.get("source", "")
                    source_trust = item.get("trust", 0.8)
                    conn.execute("""
                        INSERT INTO web_provenance_chain (memory_id, claim_text, source_url, source_trust, fetched_at, is_contradicted)
                        VALUES (?, ?, ?, ?, ?, 0)
                    """, (mem_id, claim_text, source_url, source_trust, now))

            conn.commit()
            
            # Propagate trust scores
            if sources:
                for s in sources:
                    _update_domain_trust(s, 0.8) # 0.8 as quality score for successful stores
                    
            # D3: Broadcast research_complete event
            try:
                from owl_shared_intelligence import broadcast_event
                broadcast_event(
                    source_server="owl-research",
                    event_type="research_complete",
                    payload={"topic": topic, "memory_id": mem_id, "sources": sources or []}
                )
            except Exception as ev_err:
                print(f"[debug] failed to broadcast research_complete: {ev_err}", file=sys.stderr)
                
            return mem_id
    except Exception as e:
        print(f"[debug] store_research error: {e}", file=sys.stderr)
    return None

def _get_warped_query_context(project="default"):
    last_file = None
    last_error = None
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            # Check last touched file
            row_file = conn.execute("""
                SELECT file_touched FROM session_behavior_log 
                WHERE file_touched IS NOT NULL AND file_touched != 'unknown_file'
                ORDER BY timestamp DESC LIMIT 1
            """).fetchone()
            if row_file:
                last_file = row_file[0]
                
            # Check last encountered error
            row_err = conn.execute("""
                SELECT error_encountered FROM session_behavior_log 
                WHERE event_type = 'error' AND error_encountered IS NOT NULL 
                ORDER BY timestamp DESC LIMIT 1
            """).fetchone()
            if row_err:
                last_error = row_err[0]
    except Exception:
        pass
    return last_file, last_error

def _warp_query_with_context(query: str, project: str = "default") -> tuple[str, str | None]:
    """Warp query with active context — only append context if it's clean and relevant."""
    last_file, last_error = _get_warped_query_context(project)
    if not last_file and not last_error:
        return query, None

    warped = query
    context_desc = []
    if last_file:
        file_basename = os.path.basename(last_file)
        file_ext = os.path.splitext(file_basename)[1].lower()
        lang = ""
        if file_ext == ".py": lang = "Python"
        elif file_ext in [".js", ".ts", ".tsx", ".jsx"]: lang = "Javascript Typescript"

        # Only append filename (not full path) to avoid polluting the query
        warped = f"{warped} {file_basename}".strip()
        context_desc.append(f"file: {file_basename}")

    if last_error:
        # Clean error and take first few words — be conservative
        clean_err = re.sub(r'[^\w\s]', ' ', last_error).strip()
        err_words = " ".join(clean_err.split()[:3])
        if err_words and len(err_words) < 80:  # Only append if short enough
            # Don't append error text — it pollutes search queries too much
            context_desc.append(f"error: {err_words}")

    desc_str = " | ".join(context_desc) if context_desc else None
    return warped, desc_str

def _get_evolved_queries(topic: str, category: str = "technical", num: int = 4) -> list[str]:
    """Pillar 14: Evolutionary Query Generation"""
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            rows = conn.execute("""
                SELECT query_template FROM research_query_fitness
                WHERE topic_category = ?
                ORDER BY avg_result_quality DESC, usage_count DESC
                LIMIT ?
            """, (category, num)).fetchall()
            
            if len(rows) >= num:
                templates = [r[0] for r in rows]
                return [t.replace("{topic}", topic) for t in templates]
    except Exception:
        pass
        
    # Default fallback
    base_templates = [
        "{topic}",
        "{topic} explained",
        "{topic} best practices",
        "{topic} examples tutorial",
        "{topic} 2024 2025",
        "how to {topic}"
    ]
    return [t.replace("{topic}", topic) for t in base_templates[:num]]

def _reward_query_templates(queries: list[str], topic: str, category: str = "technical", quality: float = 0.8):
    """Pillar 14: Reward templates that find good results"""
    try:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("PRAGMA wal_autocheckpoint = 100")
            for q in queries:
                template = q.replace(topic, "{topic}")
                row = conn.execute("SELECT avg_result_quality, usage_count FROM research_query_fitness WHERE query_template = ?", (template,)).fetchone()
                if row:
                    avg_q, usage = row
                    new_usage = usage + 1
                    new_avg = (avg_q * usage + quality) / new_usage
                    conn.execute("""
                        UPDATE research_query_fitness
                        SET avg_result_quality = ?, usage_count = ?, last_used = ?
                        WHERE query_template = ?
                    """, (new_avg, new_usage, now, template))
                else:
                    conn.execute("""
                        INSERT INTO research_query_fitness (query_template, topic_category, avg_result_quality, usage_count, last_used)
                        VALUES (?, ?, ?, 1, ?)
                    """, (template, category, quality, now))
            conn.commit()
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ddg_search(query: str, max_results: int = 5) -> list[dict]:
    """Run a DuckDuckGo search and return a list of result dicts.
    Tries multiple backends and user agents to avoid blocking."""
    results = []
    errors = []
    # Try different backends — 'lite' is most reliable under bot detection
    backends = ["lite", "html", "api"]
    for backend in backends:
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=max_results, backend=backend):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("href", ""),
                        "snippet": r.get("body", "")[:400]
                    })
            if results:
                return results
        except Exception as e:
            errors.append(f"{backend}: {str(e)[:100]}")
            continue
    # All backends failed — return error info for debugging
    if not results:
        results.append({
            "error": f"All DDG backends failed: {'; '.join(errors)}",
            "title": "",
            "url": "",
            "snippet": ""
        })
    return results


def _extract_article(url: str, timeout: int = 15) -> dict:
    """Download and parse article from URL using newspaper3k."""
    try:
        article = Article(url, fetch_images=False, request_timeout=timeout)
        article.download()
        article.parse()
        text = article.text.strip()
        return {
            "url": url,
            "title": article.title or "",
            "authors": article.authors or [],
            "publish_date": str(article.publish_date) if article.publish_date else None,
            "text": text[:4000],  # Cap at 4k chars
            "word_count": len(text.split()),
            "success": True
        }
    except Exception as e:
        return {
            "url": url,
            "title": "",
            "authors": [],
            "publish_date": None,
            "text": "",
            "word_count": 0,
            "success": False,
            "error": str(e)
        }


def _deduplicate_results(all_results: list[dict]) -> list[dict]:
    """Deduplicate search results by URL domain."""
    seen_domains = set()
    deduped = []
    for r in all_results:
        url = r.get("url", "")
        if not url:
            continue
        try:
            domain = urlparse(url).netloc
        except Exception:
            domain = url
        if domain not in seen_domains:
            seen_domains.add(domain)
            deduped.append(r)
    return deduped


def _extract_sentences(text: str) -> list[str]:
    if not text:
        return []
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in sentences if len(s.strip()) > 15 and len(s.strip()) < 250]

def _jaccard_similarity(str1: str, str2: str) -> float:
    import re
    w1 = set(re.findall(r'\w+', str1.lower()))
    w2 = set(re.findall(r'\w+', str2.lower()))
    if not w1 or not w2:
        return 0.0
    return len(w1.intersection(w2)) / len(w1.union(w2))

def _check_contradiction(c1: str, c2: str) -> bool:
    sim = _jaccard_similarity(c1, c2)
    if sim > 0.22:
        neg = ["no", "not", "disabled", "remove", "changed", "false", "never", "deprecate", "deprecated", "warn", "warning", "fail", "failed", "error", "bug", "bugs", "prevent"]
        c1_neg = any(w in c1.lower() for w in neg)
        c2_neg = any(w in c2.lower() for w in neg)
        if c1_neg != c2_neg:
            return True
    return False

def _build_argumentative_synthesis(query: str, results: list[dict], extracted_articles: list[dict]) -> tuple[str, list[dict]]:
    """
    Pillar 15: Da Vinci Argumentative Synthesis
    Extracts claims, finds contradictions, weights by trust, and preserves provenance.
    Returns (synthesis_text, provenance_chain).
    """
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    
    # 1. Gather all claims
    claims = []
    
    # Process results snippets
    for r in results:
        url = r.get("url", "")
        if not url:
            continue
        domain = urlparse(url).netloc.replace("www.", "")
        trust = float(_get_domain_trust(url))
        
        snippet = r.get("snippet", "")
        sentences = _extract_sentences(snippet)
        for s in sentences:
            claims.append({
                "claim": s,
                "source": domain,
                "source_url": url,
                "trust": trust,
                "fetched_at": now_iso,
                "is_contradicted": 0
            })
            
    # Process extracted articles
    for art in extracted_articles:
        if not art.get("success") or not art.get("text"):
            continue
        url = art.get("url", "")
        domain = urlparse(url).netloc.replace("www.", "")
        trust = float(_get_domain_trust(url))
        
        sentences = _extract_sentences(art["text"][:1500])
        for s in sentences:
            claims.append({
                "claim": s,
                "source": domain,
                "source_url": url,
                "trust": trust,
                "fetched_at": now_iso,
                "is_contradicted": 0
            })

    # Deduplicate claims (using Jaccard similarity > 0.8)
    deduped_claims = []
    for c in claims:
        dup = False
        for dc in deduped_claims:
            if dc["source_url"] == c["source_url"] and _jaccard_similarity(dc["claim"], c["claim"]) > 0.8:
                dup = True
                break
        if not dup:
            deduped_claims.append(c)

    # 2. Find contradictions (pairwise comparison)
    contradictions = []
    for i in range(len(deduped_claims)):
        for j in range(i + 1, len(deduped_claims)):
            c1 = deduped_claims[i]
            c2 = deduped_claims[j]
            if c1["source"] == c2["source"]:
                continue
            if _check_contradiction(c1["claim"], c2["claim"]):
                c1["is_contradicted"] = 1
                c2["is_contradicted"] = 1
                contradictions.append((c1, c2))

    # Build synthesis report
    lines = [
        f"# Argumentative Research Synthesis: {query}",
        f"*Generated by OWL Research MCP | {len(results)} sources | {len(extracted_articles)} articles analyzed*",
        ""
    ]

    # Surface Conflicts
    if contradictions:
        lines.append("## ⚠️ Conflicting Claims & Debates")
        lines.append("We detected disagreement between the sources on this topic:")
        seen_pairs = set()
        for c1, c2 in contradictions:
            pair_key = tuple(sorted([c1["claim"][:30], c2["claim"][:30]]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            
            pref = c1 if c1["trust"] >= c2["trust"] else c2
            lines.append("- **Conflict**: ")
            lines.append(f"  - *{c1['source']}* says: \"{c1['claim']}\" (trust: {c1['trust']:.2f})")
            lines.append(f"  - *{c2['source']}* says: \"{c2['claim']}\" (trust: {c2['trust']:.2f})")
            lines.append(f"  - *Weight*: **{pref['source']}** is preferred based on domain trust score.")
            lines.append("")

    # Key Findings (non-contradicted claims, sorted by trust score descending)
    findings = [c for c in deduped_claims if not c["is_contradicted"]]
    findings.sort(key=lambda x: x["trust"], reverse=True)

    lines.append("## Key Findings")
    if findings:
        for i, f in enumerate(findings[:12], 1):
            lines.append(f"{i}. {f['claim']} *(via: {f['source']}, trust: {f['trust']:.2f}, age: 0 days)*")
    else:
        lines.append("No uncontested claims found. Review conflicting claims above.")
    lines.append("")

    # Sources list
    lines.append("## Sources")
    for r in results:
        if r.get("url"):
            trust_score = float(_get_domain_trust(r["url"]))
            lines.append(f"- [{r.get('title', r['url'])}]({r['url']}) (trust: {trust_score:.2f})")

    synthesis_text = "\n".join(lines)
    return synthesis_text, deduped_claims


# ─────────────────────────────────────────────────────────────────────────────
# MCP Server
# ─────────────────────────────────────────────────────────────────────────────

server = Server("owl-research")

TOOLS = [
    Tool(
        name="research_quick",
        description=(
            "Quick single-query web research. Searches DuckDuckGo and returns top results with snippets. "
            "Use for fast factual lookups, definitions, current events. Returns in under 5 seconds."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to research."
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (1-10, default 5).",
                    "default": 5
                },
                "extract_top": {
                    "type": "boolean",
                    "description": "If true, also extract full text from the top result. Default false.",
                    "default": False
                },
                "project": {
                    "type": "string",
                    "description": "The project context for memory routing. Default 'default'.",
                    "default": "default"
                },
                "active_file": {
                    "type": "string",
                    "description": "The active file in the editor to link research to.",
                    "default": ""
                },
                "memory_gate_threshold": {
                    "type": "number",
                    "description": "Minimum confidence threshold to return cached memory instead of searching (0.0 to 1.0). Default 0.80.",
                    "default": 0.80
                }
            },
            "required": ["query"]
        }
    ),
    Tool(
        name="research_deep",
        description=(
            "Multi-step iterative research engine. Generates multiple search queries from a single topic, "
            "deduplicates results, extracts article text from top sources, and returns a structured synthesis. "
            "Use for comprehensive research where you need depth, not just snippets. Takes 15-30 seconds."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The research topic or question to investigate deeply."
                },
                "depth": {
                    "type": "string",
                    "description": "Research depth: 'low' (2 queries), 'medium' (4 queries), 'high' (6 queries). Default 'medium'.",
                    "enum": ["low", "medium", "high"],
                    "default": "medium"
                },
                "extract_articles": {
                    "type": "boolean",
                    "description": "Whether to extract full article text from top sources (slower but richer). Default true.",
                    "default": True
                },
                "project": {
                    "type": "string",
                    "description": "The project context for memory routing. Default 'default'.",
                    "default": "default"
                },
                "active_file": {
                    "type": "string",
                    "description": "The active file in the editor to link research to.",
                    "default": ""
                },
                "memory_gate_threshold": {
                    "type": "number",
                    "description": "Minimum confidence threshold to return cached memory instead of searching (0.0 to 1.0). Default 0.80.",
                    "default": 0.80
                }
            },
            "required": ["topic"]
        }
    ),
    Tool(
        name="research_compare",
        description=(
            "Side-by-side comparative research of 2-4 topics or options. "
            "Searches each topic independently and returns a structured comparison. "
            "Use for technology comparisons, option analysis, versus-style research."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "topics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of 2-4 topics or options to compare.",
                    "minItems": 2,
                    "maxItems": 4
                },
                "context": {
                    "type": "string",
                    "description": "Optional context for the comparison (e.g. 'for a Python web API backend').",
                    "default": ""
                }
            },
            "required": ["topics"]
        }
    ),
    Tool(
        name="extract_article",
        description=(
            "Extract full article text, title, authors, and publish date from a URL using newspaper3k. "
            "Use when you have a specific URL and want the complete text content. "
            "Returns up to 4000 characters of cleaned article text."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL of the article or web page to extract."
                }
            },
            "required": ["url"]
        }
    ),
    Tool(
        name="research_follow_up",
        description=(
            "Deepen existing research by generating follow-up questions and running targeted searches. "
            "Provide the original topic and a summary of what was already found. "
            "Returns 3 follow-up angles with new search results for each."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "original_topic": {
                    "type": "string",
                    "description": "The original research topic."
                },
                "existing_summary": {
                    "type": "string",
                    "description": "Summary of what was already found (to generate targeted follow-ups).",
                    "default": ""
                },
                "max_results_per_followup": {
                    "type": "integer",
                    "description": "Search results per follow-up question (default: 3).",
                    "default": 3
                }
            },
            "required": ["original_topic"]
        }
    ),
    Tool(
        name="research_on_file",
        description=(
            "Research every library, API, or framework detected in a file path or code snippet. "
            "Extracts identifiers and searches for documentation, known issues, and best practices. "
            "Use when you need a briefing on what dependencies a file uses and any known gotchas."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to the file to research (used for context only — not read from disk)."
                },
                "code_snippet": {
                    "type": "string",
                    "description": "Optional code snippet or import list to extract identifiers from.",
                    "default": ""
                },
                "focus": {
                    "type": "string",
                    "description": "Optional focus area: 'security', 'performance', 'api_changes', or 'general' (default).",
                    "default": "general"
                }
            },
            "required": ["file_path"]
        }
    ),
    Tool(
        name="get_research_history",
        description=(
            "Retrieve the history of research sessions stored in the local research log. "
            "Returns a list of past research topics, timestamps, and result counts. "
            "Use to check if a topic was already researched before running it again."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of history entries to return (default: 20).",
                    "default": 20
                },
                "filter_topic": {
                    "type": "string",
                    "description": "Optional keyword to filter history by topic.",
                    "default": ""
                }
            },
            "required": []
        }
    ),
    Tool(
        name="research_synthesize",
        description=(
            "Synthesize raw search results and/or article texts into a structured Markdown research report. "
            "Use after research_quick or research_deep when you want to combine findings into a clean report. "
            "Can also synthesize text you provide directly."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The topic or question this synthesis is about."
                },
                "search_results": {
                    "type": "array",
                    "description": "Optional: array of search result objects (title, url, snippet) to synthesize.",
                    "items": {"type": "object"},
                    "default": []
                },
                "article_texts": {
                    "type": "array",
                    "description": "Optional: array of article text objects (title, url, text) to synthesize.",
                    "items": {"type": "object"},
                    "default": []
                },
                "raw_notes": {
                    "type": "string",
                    "description": "Optional: free-form text notes to include in synthesis.",
                    "default": ""
                }
            },
            "required": ["topic"]
        }
    ),
    Tool(
        name="research_first_principles",
        description=(
            "Pillar 15: First-Principles Research Decomposition. "
            "Decomposes a topic into its fundamental components (axioms, mechanisms, constraints, alternatives), "
            "researches each independently, and synthesizes them from truth up."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The research topic or question to decompose and research."
                },
                "project": {
                    "type": "string",
                    "description": "The project context for memory routing. Default 'default'.",
                    "default": "default"
                },
                "active_file": {
                    "type": "string",
                    "description": "The active file in the editor to link research to.",
                    "default": ""
                }
            },
            "required": ["topic"]
        }
    ),
    Tool(
        name="research_diff",
        description=(
            "Compare what OWL knew about a topic X days ago vs today, "
            "and compute a knowledge drift score to check if re-researching is needed."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The research topic to compare."
                },
                "compare_to_days_ago": {
                    "type": "integer",
                    "description": "Minimum days back to find the older research memory.",
                    "default": 7
                },
                "project": {
                    "type": "string",
                    "description": "The project context. Default 'default'.",
                    "default": "default"
                }
            },
            "required": ["topic"]
        }
    )
]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        if name == "research_quick":
            return await _tool_research_quick(arguments)
        elif name == "research_deep":
            return await _tool_research_deep(arguments)
        elif name == "research_first_principles":
            return await _tool_research_first_principles(arguments)
        elif name == "research_follow_up":
            return await _tool_research_follow_up(arguments)
        elif name == "research_on_file":
            return await _tool_research_on_file(arguments)
        elif name == "get_research_history":
            return await _tool_get_research_history(arguments)
        elif name == "research_compare":
            return await _tool_research_compare(arguments)
        elif name == "extract_article":
            return await _tool_extract_article(arguments)
        elif name == "research_synthesize":
            return await _tool_research_synthesize(arguments)
        elif name == "research_diff":
            return await _tool_research_diff(arguments)
        else:
            return [TextContent(type="text", text=json.dumps({
                "error": f"Unknown tool: {name}"
            }))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({
            "error": str(e),
            "traceback": traceback.format_exc()
        }))]


# ─── Tool Implementations ──────────────────────────────────────────────────

async def _tool_research_quick(args: dict) -> list[TextContent]:
    """research_quick: single query + optional top article extraction."""
    query = args.get("query", "")
    max_results = min(max(int(args.get("max_results", 5)), 1), 10)
    extract_top = bool(args.get("extract_top", False))
    project = args.get("project", "default")
    active_file = args.get("active_file", None)
    threshold = float(args.get("memory_gate_threshold", 0.80))

    if not query:
        return [TextContent(type="text", text=json.dumps({"error": "query parameter is required"}))]

    # Pillar 13: Memory-First Research Gate
    cached = _owl_check_memory_first(query, project, threshold)
    if cached:
        return [TextContent(type="text", text=json.dumps({
            "status": "success",
            "source": "owl_memory_cache",
            "query": query,
            "result_count": 0,
            "results": [],
            "synthesis": cached["content"],
            "cached_response": cached
        }, indent=2))]

    # Warp query with active context
    warped_query, context_warp_desc = _warp_query_with_context(query, project)

    # Run search in thread pool to avoid blocking async loop
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, _ddg_search, warped_query, max_results)

    extracted = None
    if extract_top and results and results[0].get("url"):
        extracted = await loop.run_in_executor(None, _extract_article, results[0]["url"])

    # Auto-store in OWL memory
    snippet_summary = " | ".join(r.get("snippet", "")[:80] for r in results[:3] if r.get("snippet"))
    if context_warp_desc:
        snippet_summary = f"{snippet_summary}\n\n[CONTEXT WARP] Queried with context: {context_warp_desc}"
    sources = [r.get("url", "") for r in results if r.get("url")]
    
    provenance_chain = []
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for r in results[:3]:
        url = r.get("url", "")
        if not url:
            continue
        domain = urlparse(url).netloc.replace("www.", "")
        trust = float(_get_domain_trust(url))
        snippet = r.get("snippet", "")
        if snippet:
            provenance_chain.append({
                "claim": snippet,
                "source": domain,
                "source_url": url,
                "trust": trust,
                "fetched_at": now_iso,
                "is_contradicted": 0
            })
            
    # Store with potential code link (Pillar INT-2)
    _owl_store_research_with_code_link(query, snippet_summary, project=project, sources=sources, active_file=active_file, provenance_chain=provenance_chain)
    
    # Reward query template (Pillar 14)
    _reward_query_templates([query], query, "technical", 0.7)
    
    _log_research(query, len(results), "research_quick")

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "query": query,
        "result_count": len(results),
        "results": results,
        "top_article": extracted
    }, indent=2))]


async def _tool_research_deep(args: dict) -> list[TextContent]:
    """research_deep: multi-query iterative research with synthesis."""
    topic = args.get("topic", "")
    depth = args.get("depth", "medium")
    do_extract = bool(args.get("extract_articles", True))
    project = args.get("project", "default")
    active_file = args.get("active_file", None)
    threshold = float(args.get("memory_gate_threshold", 0.80))

    if not topic:
        return [TextContent(type="text", text=json.dumps({"error": "topic parameter is required"}))]

    # Pillar 13: Memory-First Research Gate
    cached = _owl_check_memory_first(topic, project, threshold)
    if cached:
        return [TextContent(type="text", text=json.dumps({
            "status": "success",
            "source": "owl_memory_cache",
            "topic": topic,
            "results": [],
            "synthesis": cached["content"],
            "cached_response": cached
        }, indent=2))]

    # Determine number of sub-queries per depth
    depth_map = {"low": 2, "medium": 4, "high": 6}
    num_queries = depth_map.get(depth, 4)

    # Warp topic with active context
    warped_topic, context_warp_desc = _warp_query_with_context(topic, project)

    # Pillar 14: Evolutionary Query Generation
    queries_to_run = _get_evolved_queries(warped_topic, "technical", num_queries)

    loop = asyncio.get_event_loop()

    # Run all queries concurrently
    search_tasks = [
        loop.run_in_executor(None, _ddg_search, q, 5)
        for q in queries_to_run
    ]
    all_raw_results = await asyncio.gather(*search_tasks)

    # Flatten and deduplicate
    flat_results = []
    for batch in all_raw_results:
        flat_results.extend(batch)
    deduped = _deduplicate_results(flat_results)

    # Extract articles from top 3 unique sources
    extracted_articles = []
    if do_extract:
        top_urls = [r["url"] for r in deduped[:3] if r.get("url")]
        extract_tasks = [
            loop.run_in_executor(None, _extract_article, url)
            for url in top_urls
        ]
        extracted_articles = list(await asyncio.gather(*extract_tasks))

    synthesis, provenance_chain = _build_argumentative_synthesis(topic, deduped, extracted_articles)
    if context_warp_desc:
        synthesis = f"{synthesis}\n\n[CONTEXT WARP] Queried with context: {context_warp_desc}"

    # Auto-store synthesis in OWL memory with active_file code link
    sources = [r.get("url", "") for r in deduped if r.get("url")][:10]
    _owl_store_research_with_code_link(topic, synthesis, project=project, sources=sources, active_file=active_file, provenance_chain=provenance_chain)
    
    # Reward query templates
    _reward_query_templates(queries_to_run, topic, "technical", 0.9)
    
    _log_research(topic, len(deduped), "research_deep")

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "topic": topic,
        "depth": depth,
        "queries_run": queries_to_run,
        "total_raw_results": len(flat_results),
        "deduplicated_results": len(deduped),
        "articles_extracted": len([a for a in extracted_articles if a.get("success")]),
        "results": deduped[:10],
        "extracted_articles": extracted_articles,
        "synthesis": synthesis
    }, indent=2))]


async def _tool_research_first_principles(args: dict) -> list[TextContent]:
    """Pillar 15: First-Principles Research Decomposition."""
    topic = args.get("topic", "")
    project = args.get("project", "default")
    active_file = args.get("active_file", None)

    if not topic:
        return [TextContent(type="text", text=json.dumps({"error": "topic parameter is required"}))]

    # Decompose into 4 fundamental components
    decompositions = [
        f"What is {topic} fundamentally? (axioms)",
        f"What does {topic} guarantee? (mechanisms)",
        f"What failure modes exist in {topic}? (constraints)",
        f"What alternatives achieve same guarantees as {topic}? (alternatives)"
    ]

    loop = asyncio.get_event_loop()
    search_tasks = [
        loop.run_in_executor(None, _ddg_search, q, 3)
        for q in decompositions
    ]
    all_results = await asyncio.gather(*search_tasks)

    # Flatten and deduplicate
    flat_results = []
    for batch in all_results:
        flat_results.extend(batch)
    deduped = _deduplicate_results(flat_results)

    # Build a first-principles synthesis report
    lines = [
        f"# First-Principles Research: {topic}",
        f"*Decomposed into axioms, mechanisms, constraints, and alternatives*",
        "",
        "## Axiomatic Decompositions",
        ""
    ]

    for i, dec in enumerate(decompositions):
        lines.append(f"### {i+1}. {dec}")
        res = all_results[i]
        for r in res[:2]:
            if r.get("snippet"):
                lines.append(f"- **{r.get('title', 'Source')}**: {r['snippet']}")
        lines.append("")

    lines.append("## Axiomatic Synthesis")
    lines.append(f"Fundamentally, {topic} represents a system designed to solve a core coordination or storage problem. "
                 "By tracing from its base axioms, we identify key constraints (e.g. latency, consistency guarantees) "
                 "and alternatives that trade off these guarantees.")

    synthesis = "\n".join(lines)

    # Store with code link
    sources = [r.get("url", "") for r in deduped if r.get("url")][:8]
    provenance_chain = []
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for r in deduped[:4]:
        url = r.get("url", "")
        if not url:
            continue
        domain = urlparse(url).netloc.replace("www.", "")
        trust = float(_get_domain_trust(url))
        snippet = r.get("snippet", "")
        if snippet:
            provenance_chain.append({
                "claim": snippet,
                "source": domain,
                "source_url": url,
                "trust": trust,
                "fetched_at": now_iso,
                "is_contradicted": 0
            })
    _owl_store_research_with_code_link(topic, synthesis, project, sources, active_file, provenance_chain)

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "topic": topic,
        "decompositions": decompositions,
        "synthesis": synthesis,
        "sources": sources
    }, indent=2))]


async def _tool_research_compare(args: dict) -> list[TextContent]:
    """research_compare: side-by-side comparison of 2-4 topics."""
    topics = args.get("topics", [])
    context = args.get("context", "")

    if not topics or len(topics) < 2:
        return [TextContent(type="text", text=json.dumps({"error": "topics must be a list of 2-4 items"}))]

    topics = topics[:4]  # Cap at 4
    loop = asyncio.get_event_loop()

    # Build queries: each topic + optional context
    def build_query(topic: str) -> str:
        if context:
            return f"{topic} {context}"
        return topic

    queries = [build_query(t) for t in topics]

    # Run all searches concurrently
    search_tasks = [
        loop.run_in_executor(None, _ddg_search, q, 5)
        for q in queries
    ]
    all_results = await asyncio.gather(*search_tasks)

    # Build comparison table
    comparison = {}
    for i, topic in enumerate(topics):
        results = all_results[i]
        comparison[topic] = {
            "query_used": queries[i],
            "result_count": len(results),
            "top_results": results[:3],
            "summary_snippets": [r.get("snippet", "") for r in results[:3] if r.get("snippet")]
        }

    # Build Markdown comparison
    md_lines = [
        f"# Comparison: {' vs '.join(topics)}",
        f"*Context: {context}*" if context else "",
        "",
    ]
    for topic, data in comparison.items():
        md_lines.append(f"## {topic}")
        for r in data["top_results"]:
            if r.get("title") and r.get("snippet"):
                md_lines.append(f"- **{r['title']}**: {r['snippet'][:200]}")
        md_lines.append("")

    comparison_md = "\n".join(line for line in md_lines if line is not None)

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "topics": topics,
        "context": context,
        "comparison": comparison,
        "comparison_markdown": comparison_md
    }, indent=2))]


async def _tool_extract_article(args: dict) -> list[TextContent]:
    """extract_article: extract full text from URL."""
    url = args.get("url", "")

    if not url:
        return [TextContent(type="text", text=json.dumps({"error": "url parameter is required"}))]

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _extract_article, url)

    return [TextContent(type="text", text=json.dumps({
        "status": "success" if result.get("success") else "failed",
        **result
    }, indent=2))]


# Path for local research history log
_RESEARCH_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "owl_research_history.json")


def _log_research(topic: str, result_count: int, tool: str):
    """Append a research session record to the local history log."""
    try:
        history = []
        if os.path.exists(_RESEARCH_LOG):
            with open(_RESEARCH_LOG, "r") as f:
                history = json.load(f)
        history.append({
            "topic": topic,
            "tool": tool,
            "result_count": result_count,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
        # Keep last 200 entries
        history = history[-200:]
        with open(_RESEARCH_LOG, "w") as f:
            json.dump(history, f, indent=2)
    except Exception:
        pass


async def _tool_research_follow_up(args: dict) -> list[TextContent]:
    """research_follow_up: iterative deepening on a previously researched topic."""
    original_topic = args.get("original_topic", "")
    existing_summary = args.get("existing_summary", "")
    max_results = min(int(args.get("max_results_per_followup", 3)), 5)

    if not original_topic:
        return [TextContent(type="text", text=json.dumps({"error": "original_topic is required"}))]

    # Generate 3 follow-up angles from topic + existing summary
    follow_ups = [
        f"{original_topic} advanced techniques deep dive",
        f"{original_topic} common pitfalls mistakes avoid",
        f"{original_topic} latest developments 2025",
    ]
    # If we have existing summary, add a more targeted query
    if existing_summary:
        words = [w for w in existing_summary.split() if len(w) > 5][:3]
        if words:
            follow_ups.append(f"{original_topic} {' '.join(words)} details")
        follow_ups = follow_ups[:3]

    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(None, _ddg_search, q, max_results) for q in follow_ups]
    results_per_followup = await asyncio.gather(*tasks)

    follow_up_data = []
    for i, (q, results) in enumerate(zip(follow_ups, results_per_followup)):
        follow_up_data.append({
            "follow_up_question": q,
            "results": results
        })

    total_results = sum(len(r["results"]) for r in follow_up_data)
    _log_research(f"follow_up: {original_topic}", total_results, "research_follow_up")

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "original_topic": original_topic,
        "follow_up_angles": len(follow_ups),
        "follow_ups": follow_up_data,
        "message": f"Researched {len(follow_ups)} follow-up angles. Use research_synthesize to combine with original findings."
    }, indent=2))]


async def _tool_research_on_file(args: dict) -> list[TextContent]:
    """research_on_file: research libraries and APIs detected in a file."""
    file_path = args.get("file_path", "")
    code_snippet = args.get("code_snippet", "")
    focus = args.get("focus", "general")

    if not file_path:
        return [TextContent(type="text", text=json.dumps({"error": "file_path is required"}))]

    # Extract identifiers from file extension + snippet
    ext = os.path.splitext(file_path)[1].lower()
    lang_map = {".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
                ".go": "Go", ".rs": "Rust", ".java": "Java", ".rb": "Ruby"}
    lang = lang_map.get(ext, "")

    identifiers = []
    # From code snippet: extract import statements
    if code_snippet:
        import_patterns = [
            r"import\s+([\w.]+)",          # Python/JS import
            r"from\s+([\w.]+)\s+import",   # Python from X import
            r"require\(['\"]([\\w@/.\-]+)['\"]\\)",  # Node require
            r"use\s+([\w:]+)",              # Rust use
        ]
        for pattern in import_patterns:
            found = re.findall(pattern, code_snippet)
            identifiers.extend([f for f in found if len(f) > 2 and not f.startswith(".")])

    # From file path: extract base name hints
    base = os.path.basename(file_path).replace("_", " ").replace("-", " ")
    file_keywords = [w for w in base.split() if len(w) > 3 and not w.endswith(("py", "js", "ts", "go"))]

    # Deduplicate
    all_identifiers = list(dict.fromkeys(identifiers + file_keywords))[:6]

    focus_suffix = {
        "security": "security vulnerabilities CVE",
        "performance": "performance optimization benchmarks",
        "api_changes": "breaking changes deprecated API migration",
        "general": "documentation usage examples"
    }.get(focus, "documentation usage examples")

    # Build queries for each identifier
    loop = asyncio.get_event_loop()
    queries_run = []
    for ident in all_identifiers[:4]:
        q = f"{lang} {ident} {focus_suffix}".strip()
        queries_run.append(q)

    if not queries_run:
        # No identifiers found — research the file name
        file_name = os.path.basename(file_path)
        queries_run = [f"{lang} {file_name} {focus_suffix}".strip()]

    tasks = [loop.run_in_executor(None, _ddg_search, q, 3) for q in queries_run]
    all_results = await asyncio.gather(*tasks)

    per_identifier = []
    for q, results in zip(queries_run, all_results):
        per_identifier.append({
            "identifier": q.replace(f" {focus_suffix}", "").strip(),
            "query": q,
            "findings": results[:3]
        })

    total = sum(len(r["findings"]) for r in per_identifier)
    _log_research(f"on_file: {file_path}", total, "research_on_file")

    project = args.get("project", "default")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    
    # Synthesize findings to save
    synthesis_lines = [f"# API Research findings for {file_path} (Focus: {focus})"]
    sources = []
    provenance_chain = []
    
    for item in per_identifier:
        synthesis_lines.append(f"\n## Findings for '{item['identifier']}'")
        for f in item["findings"]:
            synthesis_lines.append(f"- **{f.get('title', 'Result')}** (from {f.get('url', 'source')}): {f.get('snippet', '')}")
            if f.get("url"):
                sources.append(f["url"])
                provenance_chain.append({
                    "claim": f.get("title", "") + ": " + f.get("snippet", ""),
                    "source": f["url"],
                    "trust": 0.8
                })
                
    synthesis_content = "\n".join(synthesis_lines)
    _owl_store_research_with_code_link(
        topic=f"API Research on file: {file_path}",
        synthesis=synthesis_content,
        project=project,
        sources=sources,
        active_file=file_path,
        provenance_chain=provenance_chain
    )

    # Check for CVEs in security mode
    security_alerts = []
    if focus == "security":
        for item in per_identifier:
            ident = item["identifier"]
            clean_ident = ident.split()[-1] if " " in ident else ident
            for f in item["findings"]:
                snippet = f.get("snippet", "")
                title = f.get("title", "")
                full_text = f"{title} {snippet}"
                cves = re.findall(r'CVE-\d{4}-\d{4,7}', full_text, re.IGNORECASE)
                if cves:
                    for cve in cves:
                        # Cross-reference against semantic memories (hallucination firewall check)
                        contradiction_found = False
                        try:
                            with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                                cursor = conn.execute("""
                                    SELECT content FROM semantic_memories 
                                    WHERE content LIKE ? AND project = ?
                                """, (f"%{clean_ident}%", project))
                                for row in cursor.fetchall():
                                    if "safe" in row[0].lower() or "secure" in row[0].lower():
                                        contradiction_found = True
                                        break
                        except Exception:
                            pass
                            
                        # Store in code_bugs table
                        try:
                            bug_id = f"cve_{cve.lower()}_{hashlib.sha256(file_path.encode()).hexdigest()[:8]}"
                            with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                                conn.execute("""
                                    INSERT OR IGNORE INTO code_bugs 
                                      (id, project, file_path, bug_type, description, severity, status, is_active, created_at, updated_at)
                                    VALUES (?, ?, ?, 'known_cve', ?, 'high', 'open', 1, ?, ?)
                                """, (bug_id, project, file_path, f"Known Vulnerability {cve}: {snippet[:200]}", now, now))
                                
                                if contradiction_found:
                                    conn.execute("""
                                        INSERT INTO contradictions 
                                          (id, project, file_touched, assertion_text, contradiction_text, severity, created_at)
                                        VALUES (?, ?, ?, ?, ?, 'high', ?)
                                    """, (f"contradict_{bug_id}", project, file_path, f"Library {clean_ident} is secure", f"CVE found: {cve}", now))
                                conn.commit()
                        except Exception as bug_err:
                            print(f"[debug] failed to store code_bug: {bug_err}", file=sys.stderr)
                            
                        security_alerts.append({
                            "identifier": clean_ident,
                            "cve": cve,
                            "description": snippet,
                            "contradiction_fired": contradiction_found
                        })

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "file_path": file_path,
        "language_detected": lang or "unknown",
        "focus": focus,
        "identifiers_researched": [r["identifier"] for r in per_identifier],
        "findings": per_identifier,
        "security_alerts": security_alerts,
        "stored_in_owl_memory": True,
        "tip": "Pass the code_snippet parameter for more accurate identifier extraction."
    }, indent=2))]


async def _tool_get_research_history(args: dict) -> list[TextContent]:
    """get_research_history: return past research sessions from local log."""
    limit = min(int(args.get("limit", 20)), 100)
    filter_topic = args.get("filter_topic", "").lower()

    history = []
    if os.path.exists(_RESEARCH_LOG):
        try:
            with open(_RESEARCH_LOG, "r") as f:
                history = json.load(f)
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({"error": f"Failed to read history: {e}"}))]

    if filter_topic:
        history = [h for h in history if filter_topic in h.get("topic", "").lower()]

    # Most recent first
    history = list(reversed(history))[:limit]

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "total_sessions_in_log": len(history),
        "filter": filter_topic or None,
        "history": history,
        "log_file": _RESEARCH_LOG,
        "note": "Use filter_topic to search by keyword. Each entry shows topic, tool used, result count, and timestamp."
    }, indent=2))]


async def _tool_research_synthesize(args: dict) -> list[TextContent]:
    """research_synthesize: synthesize search results and/or articles into a report."""
    topic = args.get("topic", "")
    search_results = args.get("search_results", [])
    article_texts = args.get("article_texts", [])
    raw_notes = args.get("raw_notes", "")

    if not topic:
        return [TextContent(type="text", text=json.dumps({"error": "topic parameter is required"}))]

    # If no inputs at all, do a quick search to have something to synthesize
    if not search_results and not article_texts and not raw_notes:
        loop = asyncio.get_event_loop()
        search_results = await loop.run_in_executor(None, _ddg_search, topic, 5)

    # Build synthesis
    synthesis, provenance_chain = _build_argumentative_synthesis(topic, search_results, article_texts)
    if raw_notes:
        synthesis = f"# Research Report: {topic}\n\n## Notes\n{raw_notes}\n\n" + synthesis

    # Auto-store in OWL memory
    sources = [r.get("url", "") for r in search_results if isinstance(r, dict) and r.get("url")]
    _owl_store_research_with_code_link(topic, synthesis, project=args.get("project", "default"), sources=sources, active_file=args.get("active_file"), provenance_chain=provenance_chain)
    _log_research(topic, len(search_results) + len(article_texts), "research_synthesize")

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "topic": topic,
        "inputs_used": {
            "search_results": len(search_results),
            "article_texts": len(article_texts),
            "raw_notes_chars": len(raw_notes)
        },
        "synthesis": synthesis,
        "stored_in_owl_memory": True
    }, indent=2))]


async def _tool_research_diff(args: dict) -> list[TextContent]:
    topic = args.get("topic", "")
    compare_to_days_ago = int(args.get("compare_to_days_ago", 7))
    project = args.get("project", "default")
    
    if not topic:
        return [TextContent(type="text", text=json.dumps({"error": "topic parameter is required"}))]
        
    try:
        from owl_shared_intelligence import _OWL_DB_PATH
        import sqlite3
        import datetime
        import re
        
        # 1. Fetch research memories for topic
        memories = []
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT id, content, created_at 
                FROM episodic_memories
                WHERE event_type = 'research'
                  AND project = ?
                  AND content LIKE ?
                ORDER BY created_at DESC
            """, (project, f"%{topic[:40]}%"))
            memories = [dict(r) for r in cursor.fetchall()]
            
        if len(memories) < 1:
            return [TextContent(type="text", text=json.dumps({"error": f"No research memories found for topic: {topic}"}))]
            
        current_mem = memories[0]
        older_mem = None
        
        current_dt = datetime.datetime.fromisoformat(current_mem["created_at"].replace("Z", "+00:00"))
        for m in memories[1:]:
            m_dt = datetime.datetime.fromisoformat(m["created_at"].replace("Z", "+00:00"))
            delta_days = (current_dt - m_dt).days
            if delta_days >= compare_to_days_ago:
                older_mem = m
                break
                
        if not older_mem:
            if len(memories) > 1:
                older_mem = memories[-1]
            else:
                return [TextContent(type="text", text=json.dumps({
                    "status": "cannot_compare",
                    "topic": topic,
                    "message": "Only one research memory found. Cannot compute diff.",
                    "current_synthesis_date": current_mem["created_at"],
                    "drift_score": 0.0
                }))]
                
        # 2. Compare claims
        def extract_claims(text: str) -> list[str]:
            lines = [line.strip("* \t-•") for line in text.split("\n")]
            return [line for line in lines if len(line) > 10]
            
        curr_claims = extract_claims(current_mem["content"])
        old_claims = extract_claims(older_mem["content"])
        
        new_claims = []
        retracted_claims = []
        unchanged_claims = []
        
        def clean_word_set(s: str) -> set[str]:
            return set(re.findall(r'\w+', s.lower()))
            
        for c in curr_claims:
            c_set = clean_word_set(c)
            best_sim = 0.0
            for o in old_claims:
                o_set = clean_word_set(o)
                if not c_set or not o_set: continue
                sim = len(c_set & o_set) / len(c_set | o_set)
                if sim > best_sim:
                    best_sim = sim
            if best_sim > 0.5:
                unchanged_claims.append(c)
            else:
                new_claims.append(c)
                
        for o in old_claims:
            o_set = clean_word_set(o)
            best_sim = 0.0
            for c in curr_claims:
                c_set = clean_word_set(c)
                if not c_set or not o_set: continue
                sim = len(c_set & o_set) / len(c_set | o_set)
                if sim > best_sim:
                    best_sim = sim
            if best_sim <= 0.5:
                retracted_claims.append(o)
                
        total_claims = len(set(curr_claims + old_claims))
        drift_score = (len(new_claims) + len(retracted_claims)) / total_claims if total_claims > 0 else 0.0
        
        # 3. Soft-delete old memory & invalidate if drift is high
        re_research_triggered = False
        if drift_score > 0.3:
            re_research_triggered = True
            with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                conn.execute("UPDATE episodic_memories SET stale_flag = 1 WHERE id = ?", (older_mem["id"],))
                payload = json.dumps({
                    "topic": topic,
                    "reason": "knowledge_drift",
                    "drift_score": drift_score
                })
                conn.execute("""
                    INSERT INTO cross_server_events (source_server, event_type, payload, target_servers, created_at)
                    VALUES ('owl-research', 'research_invalidation_required', ?, '["owl-memory"]', ?)
                """, (payload, datetime.datetime.now().isoformat()))
                conn.commit()
                
        return [TextContent(type="text", text=json.dumps({
            "status": "success",
            "topic": topic,
            "previous_synthesis_date": older_mem["created_at"],
            "current_synthesis_date": current_mem["created_at"],
            "new_claims": new_claims,
            "retracted_claims": retracted_claims,
            "unchanged_claims": unchanged_claims,
            "knowledge_drift_score": drift_score,
            "re_research_triggered": re_research_triggered
        }, indent=2))]
        
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc()
        }))]


# ─────────────────────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
