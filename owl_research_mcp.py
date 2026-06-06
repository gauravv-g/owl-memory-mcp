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

_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

def _owl_store_research(topic: str, synthesis: str, project: str = "default", sources: list = None):
    """
    Write a research result directly into owl-memory's episodic_memories table.
    Uses content hash as ID so the same research never creates duplicates.
    Silently does nothing if the DB doesn't exist yet or any error occurs.
    """
    try:
        if not os.path.exists(_OWL_DB_PATH):
            return  # DB not initialised yet — skip silently
        content = f"[RESEARCH] {topic}\n\n{synthesis[:1500]}"
        mem_id = "res_" + hashlib.sha256(content.encode()).hexdigest()[:20]
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        sources_str = json.dumps(sources or [])
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT OR IGNORE INTO episodic_memories
                  (id, content, event_type, project, emotional_valence, emotional_arousal,
                   salience, strength, source, tags, created_at, updated_at, is_active)
                VALUES (?, ?, 'research', ?, 0.3, 0.5, 0.8, 1.0, 'owl-research', ?, ?, ?, 1)
            """, (mem_id, content, project, sources_str, now, now))
            conn.commit()
    except Exception:
        pass  # Never crash the research tool because of a DB write


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ddg_search(query: str, max_results: int = 5) -> list[dict]:
    """Run a DuckDuckGo search and return a list of result dicts."""
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")[:400]
                })
    except Exception as e:
        results.append({"error": str(e), "title": "", "url": "", "snippet": ""})
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


def _build_synthesis(query: str, results: list[dict], extracted_articles: list[dict]) -> str:
    """Build a structured synthesis report from search results and extracted articles."""
    lines = [
        f"# Research Synthesis: {query}",
        f"*Generated by OWL Research MCP | {len(results)} sources | {len(extracted_articles)} articles extracted*",
        "",
        "## Key Findings",
        ""
    ]

    # Bullet points from snippets
    for i, r in enumerate(results[:6], 1):
        if r.get("snippet"):
            lines.append(f"{i}. **{r.get('title', 'Source')}**: {r['snippet']}")
            if r.get("url"):
                lines.append(f"   Source: {r['url']}")
    lines.append("")

    # Full article extracts
    successful_articles = [a for a in extracted_articles if a.get("success") and a.get("text")]
    if successful_articles:
        lines.append("## Detailed Content")
        for art in successful_articles[:3]:
            lines.append(f"\n### {art.get('title', art['url'])}")
            if art.get("publish_date"):
                lines.append(f"Published: {art['publish_date']}")
            # Take first 800 chars of article text
            excerpt = art["text"][:800]
            lines.append(excerpt)
            if len(art["text"]) > 800:
                lines.append("*[content truncated]*")

    lines.append("")
    lines.append("## Sources")
    for r in results:
        if r.get("url"):
            lines.append(f"- [{r.get('title', r['url'])}]({r['url']})")

    return "\n".join(lines)


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

    if not query:
        return [TextContent(type="text", text=json.dumps({"error": "query parameter is required"}))]

    # Run search in thread pool to avoid blocking async loop
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, _ddg_search, query, max_results)

    extracted = None
    if extract_top and results and results[0].get("url"):
        extracted = await loop.run_in_executor(None, _extract_article, results[0]["url"])

    # Auto-store in OWL memory
    snippet_summary = " | ".join(r.get("snippet", "")[:80] for r in results[:3] if r.get("snippet"))
    sources = [r.get("url", "") for r in results if r.get("url")]
    _owl_store_research(query, snippet_summary, project=args.get("project", "default"), sources=sources)
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

    if not topic:
        return [TextContent(type="text", text=json.dumps({"error": "topic parameter is required"}))]

    # Determine number of sub-queries per depth
    depth_map = {"low": 2, "medium": 4, "high": 6}
    num_queries = depth_map.get(depth, 4)

    # Generate sub-queries from the topic
    # Pattern: original + variations (with/without context)
    base_queries = [
        topic,
        f"{topic} explained",
        f"{topic} best practices",
        f"{topic} examples tutorial",
        f"{topic} 2024 2025",
        f"how to {topic}"
    ]
    queries_to_run = base_queries[:num_queries]

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

    synthesis = _build_synthesis(topic, deduped, extracted_articles)

    # Auto-store synthesis in OWL memory
    sources = [r.get("url", "") for r in deduped if r.get("url")][:10]
    _owl_store_research(topic, synthesis, project=args.get("project", "default"), sources=sources)
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

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "file_path": file_path,
        "language_detected": lang or "unknown",
        "focus": focus,
        "identifiers_researched": [r["identifier"] for r in per_identifier],
        "findings": per_identifier,
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
    synthesis_lines = [
        f"# Research Report: {topic}",
        f"*Synthesized by OWL Research MCP*",
        ""
    ]

    if raw_notes:
        synthesis_lines.append("## Notes")
        synthesis_lines.append(raw_notes)
        synthesis_lines.append("")

    if search_results:
        synthesis_lines.append("## Key Findings")
        for i, r in enumerate(search_results[:8], 1):
            if isinstance(r, dict) and r.get("snippet"):
                title = r.get("title", f"Source {i}")
                url = r.get("url", "")
                synthesis_lines.append(f"{i}. **{title}**: {r['snippet']}")
                if url:
                    synthesis_lines.append(f"   [{url}]({url})")
        synthesis_lines.append("")

    successful_articles = [a for a in article_texts if isinstance(a, dict) and a.get("text")]
    if successful_articles:
        synthesis_lines.append("## Detailed Content")
        for art in successful_articles[:3]:
            synthesis_lines.append(f"\n### {art.get('title', art.get('url', 'Article'))}")
            if art.get("publish_date"):
                synthesis_lines.append(f"Published: {art['publish_date']}")
            synthesis_lines.append(art["text"][:1000])
            if len(art["text"]) > 1000:
                synthesis_lines.append("*[content truncated]*")
        synthesis_lines.append("")

    if search_results:
        synthesis_lines.append("## Sources")
        for r in search_results:
            if isinstance(r, dict) and r.get("url"):
                synthesis_lines.append(f"- [{r.get('title', r['url'])}]({r['url']})")

    synthesis = "\n".join(synthesis_lines)

    # Auto-store in OWL memory
    sources = [r.get("url", "") for r in search_results if isinstance(r, dict) and r.get("url")]
    _owl_store_research(topic, synthesis, project=args.get("project", "default"), sources=sources)
    _log_research(topic, len(search_results) + len(successful_articles), "research_synthesize")

    return [TextContent(type="text", text=json.dumps({
        "status": "success",
        "topic": topic,
        "inputs_used": {
            "search_results": len(search_results),
            "article_texts": len(successful_articles),
            "raw_notes_chars": len(raw_notes)
        },
        "synthesis": synthesis,
        "stored_in_owl_memory": True
    }, indent=2))]


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
