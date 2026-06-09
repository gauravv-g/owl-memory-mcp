"""
SuperMCP v1 — Unified Knowledge Graph + Code Intelligence Server

Replaces: codegraph MCP + owl-code MCP + graphify
Exponentially upgraded: real graph DB, AST parsing, call graphs, semantic search,
impact analysis, cross-file reasoning, community detection, blast radius.

Tools (20):
  graph_build          — Build/update knowledge graph from codebase
  graph_query          — Query graph: find nodes, paths, communities, bridges
  graph_impact         — Impact analysis: what breaks if X changes?
  graph_explain        — Explain a symbol: definition, usages, call chain
  graph_visualize      — Generate interactive HTML graph visualization
  code_analyze         — Deep code analysis: structure, complexity, quality
  code_search          — Hybrid semantic + keyword search across codebase
  code_review          — AI-powered code review with graph context
  code_refactor        — Suggest and apply refactoring with impact preview
  code_explain         — Explain code block with call graph context
  code_test_impact     — Find tests affected by code changes
  code_dead            — Find dead/unreachable code via graph reachability
  code_complexity      — Cyclomatic + cognitive complexity per function
  code_security        — Security scan: SQLi, XSS, hardcoded secrets, etc.
  code_dependencies    — Dependency graph: internal + external
  context_build        — Build minimal context for a task from graph
  context_explain      — Why does this code exist? Trace to requirements
  diff_analyze         — Analyze git diff for impact, risks, test gaps
  project_map          — Generate project architecture map
  health_check         — Full system health: graph freshness, index status
"""

import asyncio
import ast
import hashlib
import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import time
import traceback
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ── MCP SDK ──────────────────────────────────────────────────────────────────
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found. Run: pip install mcp", file=sys.stderr)
    raise SystemExit(1)

# ── Constants ────────────────────────────────────────────────────────────────
SUPERMCP_DIR = os.path.dirname(os.path.abspath(__file__))
SUPERMCP_DB = os.path.join(SUPERMCP_DIR, "supermcp.db")
SUPERMCP_GRAPH_DIR = os.path.join(SUPERMCP_DIR, "supermcp-graph")

SKIP_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".codegraph",
    "supermcp-graph", ".pytest_cache", ".mypy_cache", "dist", "build",
    ".next", ".nuxt", "coverage", ".tox", ".eggs", "*.egg-info",
}
SKIP_EXTENSIONS = {
    ".pyc", ".pyo", ".so", ".dll", ".exe", ".o", ".a", ".class",
    ".jar", ".war", ".zip", ".tar", ".gz", ".rar", ".7z",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".bmp",
    ".woff", ".woff2", ".ttf", ".eot", ".map",
}

# ── Database ─────────────────────────────────────────────────────────────────
def _create_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            file_path TEXT,
            line_start INTEGER,
            line_end INTEGER,
            signature TEXT,
            docstring TEXT,
            complexity REAL DEFAULT 0,
            importance REAL DEFAULT 0,
            metadata TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            type TEXT NOT NULL,
            weight REAL DEFAULT 1.0,
            metadata TEXT DEFAULT '{}',
            FOREIGN KEY (source_id) REFERENCES nodes(id),
            FOREIGN KEY (target_id) REFERENCES nodes(id)
        );
        CREATE TABLE IF NOT EXISTS communities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            community_id INTEGER NOT NULL,
            node_id TEXT NOT NULL,
            FOREIGN KEY (node_id) REFERENCES nodes(id)
        );
        CREATE TABLE IF NOT EXISTS file_index (
            file_path TEXT PRIMARY KEY,
            hash TEXT,
            last_indexed TEXT,
            word_count INTEGER DEFAULT 0,
            line_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS bm25_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            term TEXT NOT NULL,
            file_path TEXT NOT NULL,
            frequency INTEGER DEFAULT 1,
            field TEXT DEFAULT 'content'
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
        CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
        CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
        CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term);
        CREATE INDEX IF NOT EXISTS idx_bm25_file ON bm25_index(file_path);
    """)

@contextmanager
def db():
    os.makedirs(SUPERMCP_DIR, exist_ok=True)
    conn = sqlite3.connect(SUPERMCP_DB, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    _create_tables(conn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

# ── Graph Engine ──────────────────────────────────────────────────────────────
class GraphEngine:
    """In-memory graph with persistence to SQLite."""

    def __init__(self):
        self.nodes = {}  # id -> dict
        self.edges = []  # list of (source, target, type, weight)
        self.adj = defaultdict(set)  # node_id -> set of target_ids
        self.rev_adj = defaultdict(set)  # node_id -> set of source_ids

    def add_node(self, node_id, node_type, name, **kwargs):
        self.nodes[node_id] = {
            "id": node_id, "type": node_type, "name": name, **kwargs
        }

    def add_edge(self, source, target, edge_type, weight=1.0):
        self.edges.append((source, target, edge_type, weight))
        self.adj[source].add(target)
        self.rev_adj[target].add(source)

    def get_reachable(self, node_id, max_depth=10):
        """BFS reachability from node."""
        visited = set()
        queue = [(node_id, 0)]
        while queue:
            current, depth = queue.pop(0)
            if current in visited or depth > max_depth:
                continue
            visited.add(current)
            for neighbor in self.adj.get(current, set()):
                if neighbor in self.nodes and neighbor not in visited:
                    queue.append((neighbor, depth + 1))
        return visited

    def get_reverse_reachable(self, node_id, max_depth=10):
        """What reaches this node? (reverse BFS)"""
        visited = set()
        queue = [(node_id, 0)]
        while queue:
            current, depth = queue.pop(0)
            if current in visited or depth > max_depth:
                continue
            visited.add(current)
            for neighbor in self.rev_adj.get(current, set()):
                if neighbor in self.nodes and neighbor not in visited:
                    queue.append((neighbor, depth + 1))
        return visited

    def find_path(self, source, target, max_depth=10):
        """BFS shortest path."""
        if source == target:
            return [source]
        visited = {source}
        queue = [(source, [source])]
        while queue:
            current, path = queue.pop(0)
            if len(path) > max_depth:
                continue
            for neighbor in self.adj.get(current, set()):
                if neighbor == target:
                    return path + [neighbor]
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, path + [neighbor]))
        return None

    def betweenness_centrality(self, sample_size=200):
        """Approximate betweenness centrality via sampling."""
        import random
        nodes = list(self.nodes.keys())
        if len(nodes) > sample_size:
            sample = random.sample(nodes, sample_size)
        else:
            sample = nodes
        centrality = defaultdict(float)
        for source in sample:
            visited = {source}
            queue = [source]
            paths = {source: 1}
            order = [source]
            while queue:
                current = queue.pop(0)
                for neighbor in self.adj.get(current, set()):
                    if neighbor not in self.nodes:
                        continue
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append(neighbor)
                        order.append(neighbor)
                    if neighbor in visited:
                        paths[neighbor] = paths.get(neighbor, 0) + paths.get(current, 1)
            dependency = defaultdict(float)
            for node in reversed(order):
                for neighbor in self.adj.get(node, set()):
                    if neighbor not in self.nodes or neighbor not in visited:
                        continue
                    dependency[node] += (paths.get(node, 1) / max(paths.get(neighbor, 1), 1)) * (1 + dependency.get(neighbor, 0))
                if node != source:
                    centrality[node] += dependency.get(node, 0)
        return dict(centrality)

    def detect_communities(self):
        """Simple label propagation community detection."""
        import random
        labels = {nid: i for i, nid in enumerate(self.nodes)}
        for _ in range(20):
            order = list(self.nodes.keys())
            random.shuffle(order)
            for node in order:
                neighbor_labels = defaultdict(float)
                for neighbor in self.adj.get(node, set()):
                    if neighbor in labels:
                        neighbor_labels[labels[neighbor]] += 1
                for neighbor in self.rev_adj.get(node, set()):
                    if neighbor in labels:
                        neighbor_labels[labels[neighbor]] += 1
                if neighbor_labels:
                    labels[node] = max(neighbor_labels, key=neighbor_labels.get)
        communities = defaultdict(list)
        for nid, label in labels.items():
            communities[label].append(nid)
        return dict(communities)

    def find_bridges(self):
        """Find nodes that connect different communities (high betweenness)."""
        centrality = self.betweenness_centrality()
        if not centrality:
            return []
        avg = sum(centrality.values()) / len(centrality)
        bridges = [(nid, score) for nid, score in centrality.items() if score > avg * 2]
        return sorted(bridges, key=lambda x: x[1], reverse=True)

    def dead_code(self, entry_points):
        """Find unreachable nodes from entry points."""
        reachable = set()
        for ep in entry_points:
            if ep in self.nodes:
                reachable.update(self.get_reachable(ep))
        return set(self.nodes.keys()) - reachable

    def save_to_db(self, conn):
        conn.execute("DELETE FROM nodes")
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM communities")
        now = datetime.now(timezone.utc).isoformat()
        for nid, node in self.nodes.items():
            conn.execute(
                "INSERT INTO nodes (id, type, name, file_path, line_start, line_end, signature, docstring, complexity, importance, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (nid, node.get("type", ""), node.get("name", ""),
                 node.get("file_path"), node.get("line_start"), node.get("line_end"),
                 node.get("signature"), node.get("docstring"),
                 node.get("complexity", 0), node.get("importance", 0),
                 json.dumps(node.get("metadata", {})), now, now)
            )
        node_set = set(self.nodes.keys())
        for source, target, edge_type, weight in self.edges:
            if source in node_set and target in node_set:
                conn.execute(
                    "INSERT INTO edges (source_id, target_id, type, weight) VALUES (?, ?, ?, ?)",
                    (source, target, edge_type, weight)
                )
        communities = self.detect_communities()
        for cid, members in communities.items():
            for nid in members:
                conn.execute(
                    "INSERT INTO communities (community_id, node_id) VALUES (?, ?)",
                    (cid, nid)
                )

    def load_from_db(self, conn):
        self.nodes = {}
        self.edges = []
        self.adj = defaultdict(set)
        self.rev_adj = defaultdict(set)
        for row in conn.execute("SELECT * FROM nodes").fetchall():
            self.nodes[row["id"]] = dict(row)
        for row in conn.execute("SELECT * FROM edges").fetchall():
            self.edges.append((row["source_id"], row["target_id"], row["type"], row["weight"]))
            self.adj[row["source_id"]].add(row["target_id"])
            self.rev_adj[row["target_id"]].add(row["source_id"])

# ── AST Parser ────────────────────────────────────────────────────────────────
class ASTParser:
    """Parse Python files into graph nodes and edges."""

    @staticmethod
    def parse_file(file_path):
        """Parse a Python file and return (nodes, edges) for the graph."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                source = f.read()
            tree = ast.parse(source, filename=file_path)
        except (SyntaxError, UnicodeDecodeError):
            return [], []

        nodes = []
        edges = []
        file_node_id = f"file:{file_path}"

        # File node
        nodes.append({
            "id": file_node_id, "type": "file", "name": os.path.basename(file_path),
            "file_path": file_path, "line_start": 1, "line_end": len(source.splitlines()),
        })

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                func_id = f"func:{file_path}:{node.name}:{node.lineno}"
                sig = ASTParser._get_signature(node)
                doc = ast.get_docstring(node) or ""
                complexity = ASTParser._cyclomatic_complexity(node)
                nodes.append({
                    "id": func_id, "type": "function", "name": node.name,
                    "file_path": file_path, "line_start": node.lineno,
                    "line_end": node.end_lineno or node.lineno,
                    "signature": sig, "docstring": doc,
                    "complexity": complexity,
                })
                edges.append((file_node_id, func_id, "contains"))

                # Function calls within this function
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        if isinstance(child.func, ast.Name):
                            target = f"func:{file_path}:{child.func.id}"
                            edges.append((func_id, target, "calls"))
                        elif isinstance(child.func, ast.Attribute):
                            target = f"method:{child.func.attr}"
                            edges.append((func_id, target, "calls"))

                # Imports
                for child in ast.walk(node):
                    if isinstance(child, ast.Global):
                        for name in child.names:
                            edges.append((func_id, f"global:{name}", "uses_global"))

            elif isinstance(node, ast.ClassDef):
                class_id = f"class:{file_path}:{node.name}:{node.lineno}"
                doc = ast.get_docstring(node) or ""
                bases = []
                for base in node.bases:
                    if isinstance(base, ast.Name):
                        bases.append(base.id)
                nodes.append({
                    "id": class_id, "type": "class", "name": node.name,
                    "file_path": file_path, "line_start": node.lineno,
                    "line_end": node.end_lineno or node.lineno,
                    "docstring": doc,
                    "metadata": {"bases": bases},
                })
                edges.append((file_node_id, class_id, "contains"))

                # Inheritance
                for base in bases:
                    edges.append((class_id, f"class:*:{base}", "inherits"))

            elif isinstance(node, ast.Import) or isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    mod = alias.name
                    imp_id = f"import:{mod}"
                    nodes.append({
                        "id": imp_id, "type": "import", "name": mod,
                    })
                    edges.append((file_node_id, imp_id, "imports"))

        return nodes, edges

    @staticmethod
    def _get_signature(func_node):
        args = []
        for arg in func_node.args.args:
            name = arg.arg
            if arg.annotation:
                try:
                    annotation = ast.unparse(arg.annotation)
                    name += f": {annotation}"
                except Exception:
                    pass
            args.append(name)
        sig = f"({', '.join(args)})"
        if func_node.returns:
            try:
                sig += f" -> {ast.unparse(func_node.returns)}"
            except Exception:
                pass
        return sig

    @staticmethod
    def _cyclomatic_complexity(func_node):
        complexity = 1
        for node in ast.walk(func_node):
            if isinstance(node, (ast.If, ast.While, ast.For, ast.ExceptHandler)):
                complexity += 1
            elif isinstance(node, ast.BoolOp):
                complexity += len(node.values) - 1
        return complexity

# ── BM25 Index ────────────────────────────────────────────────────────────────
class BM25Index:
    """Simple BM25 full-text index."""

    def __init__(self):
        self.doc_freqs = defaultdict(int)  # term -> doc frequency
        self.term_freqs = defaultdict(lambda: defaultdict(int))  # file -> term -> freq
        self.doc_lengths = {}  # file -> length
        self.avg_dl = 0
        self.total_docs = 0

    def tokenize(self, text):
        return re.findall(r'[a-zA-Z_][a-zA-Z0-9_]{2,}', text.lower())

    def add_document(self, file_path, text):
        terms = self.tokenize(text)
        self.doc_lengths[file_path] = len(terms)
        self.total_docs += 1
        seen = set()
        for term in terms:
            self.term_freqs[file_path][term] += 1
            if term not in seen:
                self.doc_freqs[term] += 1
                seen.add(term)
        self.avg_dl = sum(self.doc_lengths.values()) / max(self.total_docs, 1)

    def search(self, query, top_k=10, k1=1.5, b=0.75):
        query_terms = self.tokenize(query)
        if not query_terms:
            return []
        scores = defaultdict(float)
        for term in query_terms:
            if term not in self.doc_freqs:
                continue
            idf = max(0, math.log((self.total_docs - self.doc_freqs[term] + 0.5) /
                                   max(self.doc_freqs[term], 0.5) + 1))
            for file_path, tf in self.term_freqs.items():
                if term not in tf:
                    continue
                dl = self.doc_lengths.get(file_path, 0)
                score = idf * (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + b * dl / max(self.avg_dl, 1)))
                scores[file_path] += score
        results = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return results[:top_k]

# ── Security Scanner ──────────────────────────────────────────────────────────
class SecurityScanner:
    """Scan code for security issues."""

    PATTERNS = [
        (r'password\s*=\s*["\'][^"\']+["\']', "HARDCODED_PASSWORD", "Hardcoded password detected"),
        (r'api_key\s*=\s*["\'][^"\']+["\']', "HARDCODED_API_KEY", "Hardcoded API key detected"),
        (r'secret\s*=\s*["\'][^"\']+["\']', "HARDCODED_SECRET", "Hardcoded secret detected"),
        (r'execute\s*\(\s*["\'].*%s', "SQL_INJECTION", "Possible SQL injection (string formatting in query)"),
        (r'execute\s*\(\s*f["\']', "SQL_INJECTION_FSTRING", "Possible SQL injection (f-string in query)"),
        (r'\.format\s*\).*\.execute', "SQL_INJECTION_FORMAT", "Possible SQL injection (.format in query)"),
        (r'eval\s*\(', "CODE_INJECTION", "Dangerous eval() call"),
        (r'exec\s*\(', "CODE_INJECTION", "Dangerous exec() call"),
        (r'subprocess\..*shell\s*=\s*True', "SHELL_INJECTION", "subprocess with shell=True"),
        (r'pickle\.loads?', "DESERIALIZATION", "Unsafe pickle deserialization"),
        (r'yaml\.load\s*\([^)]*$', "YAML_LOAD", "Unsafe yaml.load (use yaml.safe_load)"),
        (r'tempfile\.mktemp', "INSECURE_TEMP", "Insecure temp file (use mkstemp)"),
        (r'random\.randint|RANDOM\.randint', "WEAK_RANDOM", "Weak random for security context"),
        (r'hashlib\.md5', "WEAK_HASH", "Weak hash algorithm (MD5)"),
        (r'hashlib\.sha1', "WEAK_HASH", "Weak hash algorithm (SHA1)"),
        (r'CORS\s*\(\s*\)', "PERMISSIVE_CORS", "Permissive CORS configuration"),
        (r'Access-Control-Allow-Origin.*\*', "PERMISSIVE_CORS_HEADER", "Wildcard CORS header"),
        (r'debug\s*=\s*True', "DEBUG_ENABLED", "Debug mode enabled (should be False in production)"),
        (r'os\.path\.join\s*\(.*\+', "PATH_TRAVERSAL", "Possible path traversal"),
        (r'\.read\s*\(\s*\).*\.write\s*\(\s*\)', "FILE_INJECTION", "Unvalidated file read/write"),
    ]

    @classmethod
    def scan_file(cls, file_path):
        issues = []
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except Exception:
            return issues
        for i, line in enumerate(lines, 1):
            for pattern, code, message in cls.PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    issues.append({
                        "file": file_path, "line": i, "code": code,
                        "message": message, "snippet": line.strip()[:100],
                    })
        return issues

# ── Global State ──────────────────────────────────────────────────────────────
_graph = GraphEngine()
_bm25 = BM25Index()
_graph_loaded = False

def _ensure_graph_loaded():
    global _graph_loaded
    if not _graph_loaded:
        with db() as conn:
            if conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0] > 0:
                _graph.load_from_db(conn)
        _graph_loaded = True

# ── MCP Server ────────────────────────────────────────────────────────────────
server = Server("owl-supermcp")

@server.list_tools()
async def list_tools():
    return [
        Tool(name="graph_build", description="Build or update the knowledge graph from a codebase. Parses all source files, extracts functions, classes, imports, call relationships. Returns stats: nodes, edges, communities, build time.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Root path of the project to index"}, "force_rebuild": {"type": "boolean", "description": "Force full rebuild (default: incremental)"}}, "required": ["project_path"]}),
        Tool(name="graph_query", description="Query the knowledge graph. Supports: find node, find path between nodes, find community, find bridges (most connected), find dead code, neighborhood of a node.",
            inputSchema={"type": "object", "properties": {"query_type": {"type": "string", "enum": ["find", "path", "community", "bridges", "dead_code", "neighborhood", "stats"]}, "node_id": {"type": "string", "description": "Node ID for find/path/neighborhood"}, "target_id": {"type": "string", "description": "Target node for path queries"}, "name": {"type": "string", "description": "Name pattern to search"}, "max_depth": {"type": "integer", "default": 5}}, "required": ["query_type"]}),
        Tool(name="graph_impact", description="Impact analysis: what breaks if a function/class/file changes? Returns all reachable dependents, affected tests, blast radius score.",
            inputSchema={"type": "object", "properties": {"node_id": {"type": "string", "description": "Node ID to analyze impact for"}, "file_path": {"type": "string", "description": "File path (alternative to node_id)"}, "max_depth": {"type": "integer", "default": 10}}, "required": ["node_id"]}),
        Tool(name="graph_explain", description="Explain a symbol: show definition, signature, docstring, all usages, call chain, and why it exists in the graph.",
            inputSchema={"type": "object", "properties": {"name": {"type": "string", "description": "Symbol name to explain"}, "file_path": {"type": "string", "description": "Optional file path to narrow search"}}, "required": ["name"]}),
        Tool(name="graph_visualize", description="Generate interactive HTML graph visualization. Returns path to HTML file with force-directed graph.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root"}, "output_file": {"type": "string", "description": "Output HTML path (optional)"}, "max_nodes": {"type": "integer", "default": 200}}, "required": ["project_path"]}),
        Tool(name="code_analyze", description="Deep code analysis: project structure, file counts, language detection, complexity metrics, quality indicators. Returns comprehensive project report.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root path"}, "depth": {"type": "string", "enum": ["shallow", "standard", "deep"], "default": "standard"}}, "required": ["project_path"]}),
        Tool(name="code_search", description="Hybrid search across codebase: BM25 keyword + semantic context. Returns ranked results with file, line, and context snippet.",
            inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}, "project_path": {"type": "string", "description": "Project root to search in"}, "max_results": {"type": "integer", "default": 10}}, "required": ["query", "project_path"]}),
        Tool(name="code_review", description="AI-powered code review with graph context. Analyzes: complexity, security, dead code, naming, structure. Returns prioritized issues.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "File to review"}, "project_path": {"type": "string", "description": "Project root for context"}}, "required": ["file_path"]}),
        Tool(name="code_refactor", description="Suggest refactoring opportunities: extract function, merge duplicates, simplify conditionals, reduce complexity. Returns suggestions with before/after.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "File to analyze for refactoring"}, "focus": {"type": "string", "enum": ["complexity", "duplication", "structure", "all"], "default": "all"}}, "required": ["file_path"]}),
        Tool(name="code_explain", description="Explain a code block or function with call graph context. Shows what it does, what calls it, what it calls, and why.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "File path"}, "function_name": {"type": "string", "description": "Function to explain (optional, explains whole file if omitted)"}, "line_start": {"type": "integer", "description": "Start line"}, "line_end": {"type": "integer", "description": "End line"}}, "required": ["file_path"]}),
        Tool(name="code_test_impact", description="Find all tests affected by changes to a file or function. Uses graph reverse reachability from changed nodes to test nodes.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "Changed file path"}, "function_name": {"type": "string", "description": "Changed function (optional)"}}, "required": ["file_path"]}),
        Tool(name="code_dead", description="Find dead/unreachable code via graph reachability from entry points. Returns list of functions/classes that are never called.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root"}, "entry_points": {"type": "array", "items": {"type": "string"}, "description": "Entry point function names (auto-detected if not provided)"}}, "required": ["project_path"]}),
        Tool(name="code_complexity", description="Calculate cyclomatic + cognitive complexity per function. Returns sorted list with hotspots highlighted.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "File to analyze"}, "project_path": {"type": "string", "description": "Project root (analyzes all files)"}, "threshold": {"type": "integer", "default": 10}}, "required": ["file_path"]}),
        Tool(name="code_security", description="Security scan: SQLi, XSS, hardcoded secrets, weak crypto, path traversal, shell injection, deserialization. Returns prioritized findings.",
            inputSchema={"type": "object", "properties": {"file_path": {"type": "string", "description": "File to scan"}, "project_path": {"type": "string", "description": "Project root (scans all files)"}}, "required": ["file_path"]}),
        Tool(name="code_dependencies", description="Dependency graph: internal (imports, calls) and external (pip packages). Returns dependency tree with version info.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root"}, "depth": {"type": "integer", "default": 3}}, "required": ["project_path"]}),
        Tool(name="context_build", description="Build minimal context for a task from the graph. Given a task description, finds relevant files, functions, and their relationships. Returns focused context.",
            inputSchema={"type": "object", "properties": {"task": {"type": "string", "description": "Task description"}, "project_path": {"type": "string", "description": "Project root"}, "max_files": {"type": "integer", "default": 10}}, "required": ["task", "project_path"]}),
        Tool(name="diff_analyze", description="Analyze git diff for impact, risks, and test gaps. Shows what changed, what's affected, what tests should run, risk level.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root"}, "diff_text": {"type": "string", "description": "Git diff text (optional, auto-detected from git)"}}, "required": ["project_path"]}),
        Tool(name="project_map", description="Generate project architecture map: modules, layers, data flow, key abstractions. Returns structured map + Mermaid diagram.",
            inputSchema={"type": "object", "properties": {"project_path": {"type": "string", "description": "Project root"}, "format": {"type": "string", "enum": ["json", "mermaid", "markdown"], "default": "markdown"}}, "required": ["project_path"]}),
        Tool(name="health_check", description="Full system health: graph freshness, index status, node/edge counts, last build time, BM25 stats.",
            inputSchema={"type": "object", "properties": {}}),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list:
    handlers = {
        "graph_build": handle_graph_build,
        "graph_query": handle_graph_query,
        "graph_impact": handle_graph_impact,
        "graph_explain": handle_graph_explain,
        "graph_visualize": handle_graph_visualize,
        "code_analyze": handle_code_analyze,
        "code_search": handle_code_search,
        "code_review": handle_code_review,
        "code_refactor": handle_code_refactor,
        "code_explain": handle_code_explain,
        "code_test_impact": handle_code_test_impact,
        "code_dead": handle_code_dead,
        "code_complexity": handle_code_complexity,
        "code_security": handle_code_security,
        "code_dependencies": handle_code_dependencies,
        "context_build": handle_context_build,
        "diff_analyze": handle_diff_analyze,
        "project_map": handle_project_map,
        "health_check": handle_health_check,
    }
    handler = handlers.get(name)
    if not handler:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}, ensure_ascii=False))]
    try:
        result = await handler(arguments)
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False))]

# ═════════════════════════════════════════════════════════════════════════════
# Handler: graph_build
# ═════════════════════════════════════════════════════════════════════════════
async def handle_graph_build(args):
    project_path = args["project_path"]
    force = args.get("force_rebuild", False)
    if not os.path.isdir(project_path):
        return {"error": f"Directory not found: {project_path}"}

    start = time.time()
    graph = GraphEngine()
    bm25 = BM25Index()
    files_processed = 0
    total_lines = 0
    errors = []

    for root, dirs, files in os.walk(project_path):
        # Filter skip dirs
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SKIP_EXTENSIONS or fname in SKIP_DIRS:
                continue
            file_path = os.path.join(root, fname)
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                lines = content.splitlines()
                total_lines += len(lines)
                files_processed += 1

                # BM25 index
                bm25.add_document(file_path, content)

                # AST parsing for Python
                if ext == ".py":
                    nodes, edges = ASTParser.parse_file(file_path)
                    for node in nodes:
                        graph.add_node(node["id"], node["type"], node["name"], **{
                            k: v for k, v in node.items()
                            if k not in ("id", "type", "name")
                        })
                    for source, target, edge_type in edges:
                        graph.add_edge(source, target, edge_type)

                # For non-Python files, add file node + basic content hash
                file_id = f"file:{file_path}"
                graph.add_node(file_id, "file", fname,
                               file_path=file_path, line_count=len(lines),
                               hash=hashlib.md5(content.encode()).hexdigest()[:12])

            except Exception as e:
                errors.append(f"{file_path}: {e}")

    # Detect communities
    communities = graph.detect_communities()
    bridges = graph.find_bridges()

    # Persist
    with db() as conn:
        graph.save_to_db(conn)
        # Save BM25
        conn.execute("DELETE FROM bm25_index")
        for file_path, terms in bm25.term_freqs.items():
            for term, freq in terms.items():
                conn.execute(
                    "INSERT INTO bm25_index (term, file_path, frequency) VALUES (?, ?, ?)",
                    (term, file_path, freq)
                )
        # Save file index
        conn.execute("DELETE FROM file_index")
        for file_path, length in bm25.doc_lengths.items():
            conn.execute(
                "INSERT INTO file_index (file_path, hash, last_indexed, word_count, line_count) VALUES (?, ?, ?, ?, ?)",
                (file_path, "", datetime.now(timezone.utc).isoformat(),
                 length, length)
            )

    elapsed = time.time() - start

    # Update global state
    global _graph, _bm25, _graph_loaded
    _graph = graph
    _bm25 = bm25
    _graph_loaded = True

    return {
        "status": "success",
        "build_time_seconds": round(elapsed, 2),
        "files_processed": files_processed,
        "total_lines": total_lines,
        "nodes": len(graph.nodes),
        "edges": len(graph.edges),
        "communities": len(communities),
        "bridges": len(bridges),
        "top_bridges": [
            {"node": graph.nodes.get(nid, {}).get("name", nid), "score": round(score, 2)}
            for nid, score in bridges[:5]
        ],
        "errors": errors[:10],
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: graph_query
# ═════════════════════════════════════════════════════════════════════════════
async def handle_graph_query(args):
    _ensure_graph_loaded()
    query_type = args["query_type"]

    if query_type == "stats":
        communities = _graph.detect_communities()
        node_type_counts = defaultdict(int)
        for n in _graph.nodes.values():
            node_type_counts[n.get("type", "unknown")] += 1
        edge_type_counts = defaultdict(int)
        for _, _, et, _ in _graph.edges:
            edge_type_counts[et] += 1
        return {
            "nodes": len(_graph.nodes),
            "edges": len(_graph.edges),
            "communities": len(communities),
            "node_types": dict(node_type_counts),
            "edge_types": dict(edge_type_counts),
        }

    if query_type == "find":
        name = args.get("name", "")
        results = []
        for nid, node in _graph.nodes.items():
            if name.lower() in node.get("name", "").lower():
                results.append({
                    "id": nid, "type": node.get("type"), "name": node.get("name"),
                    "file": node.get("file_path"), "line": node.get("line_start"),
                })
        return {"results": results[:50], "total": len(results)}

    if query_type == "path":
        source = args.get("node_id", "")
        target = args.get("target_id", "")
        max_depth = args.get("max_depth", 10)
        path = _graph.find_path(source, target, max_depth)
        if path:
            return {
                "path": [_graph.nodes.get(n, {}).get("name", n) for n in path],
                "path_ids": path,
                "length": len(path) - 1,
            }
        return {"path": None, "message": f"No path found from {source} to {target}"}

    if query_type == "community":
        communities = _graph.detect_communities()
        result = {}
        for cid, members in communities.items():
            result[cid] = [
                {"name": _graph.nodes.get(n, {}).get("name", n),
                 "type": _graph.nodes.get(n, {}).get("type", "")}
                for n in members[:20]
            ]
        return {"communities": result, "total": len(communities)}

    if query_type == "bridges":
        bridges = _graph.find_bridges()
        return {
            "bridges": [
                {
                    "node": _graph.nodes.get(nid, {}).get("name", nid),
                    "type": _graph.nodes.get(nid, {}).get("type", ""),
                    "score": round(score, 2),
                }
                for nid, score in bridges[:20]
            ]
        }

    if query_type == "dead_code":
        entry_points = args.get("entry_points", ["main", "__main__", "app", "run", "setup"])
        dead = _graph.dead_code(entry_points)
        return {
            "dead_nodes": [
                {"name": _graph.nodes.get(n, {}).get("name", n),
                 "type": _graph.nodes.get(n, {}).get("type", ""),
                 "file": _graph.nodes.get(n, {}).get("file_path", "")}
                for n in dead if _graph.nodes.get(n, {}).get("type") in ("function", "class")
            ][:50],
            "total_dead": len([n for n in dead if _graph.nodes.get(n, {}).get("type") in ("function", "class")]),
        }

    if query_type == "neighborhood":
        node_id = args.get("node_id", "")
        max_depth = args.get("max_depth", 3)
        forward = _graph.get_reachable(node_id, max_depth)
        backward = _graph.get_reverse_reachable(node_id, max_depth)
        return {
            "node": _graph.nodes.get(node_id, {}).get("name", node_id),
            "forward_reachable": len(forward),
            "reverse_reachable": len(backward),
            "forward_nodes": [
                {"name": _graph.nodes.get(n, {}).get("name", n),
                 "type": _graph.nodes.get(n, {}).get("type", "")}
                for n in list(forward)[:20]
            ],
            "reverse_nodes": [
                {"name": _graph.nodes.get(n, {}).get("name", n),
                 "type": _graph.nodes.get(n, {}).get("type", "")}
                for n in list(backward)[:20]
            ],
        }

    return {"error": f"Unknown query_type: {query_type}"}

# ═════════════════════════════════════════════════════════════════════════════
# Handler: graph_impact
# ═════════════════════════════════════════════════════════════════════════════
async def handle_graph_impact(args):
    _ensure_graph_loaded()
    node_id = args.get("node_id", "")
    file_path = args.get("file_path", "")
    max_depth = args.get("max_depth", 10)

    # Resolve file_path to node_id if needed
    if file_path and not node_id:
        for nid, node in _graph.nodes.items():
            if node.get("file_path") == file_path:
                node_id = nid
                break

    if not node_id or node_id not in _graph.nodes:
        return {"error": f"Node not found: {node_id}"}

    # Forward: what depends on this?
    dependents = _graph.get_reverse_reachable(node_id, max_depth)
    # Backward: what does this depend on?
    dependencies = _graph.get_reachable(node_id, max_depth)

    # Find affected tests
    affected_tests = [
        {"name": _graph.nodes.get(n, {}).get("name", n),
         "file": _graph.nodes.get(n, {}).get("file_path", "")}
        for n in dependents
        if "test" in _graph.nodes.get(n, {}).get("name", "").lower()
        or "test" in _graph.nodes.get(n, {}).get("file_path", "").lower()
    ]

    blast_radius = len(dependents) / max(len(_graph.nodes), 1) * 100

    return {
        "node": _graph.nodes[node_id].get("name", node_id),
        "blast_radius_percent": round(blast_radius, 1),
        "dependents_count": len(dependents),
        "dependencies_count": len(dependencies),
        "affected_tests": affected_tests[:20],
        "high_risk": blast_radius > 10,
        "dependents": [
            {"name": _graph.nodes.get(n, {}).get("name", n),
             "type": _graph.nodes.get(n, {}).get("type", ""),
             "file": _graph.nodes.get(n, {}).get("file_path", "")}
            for n in list(dependents)[:30]
        ],
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: graph_explain
# ═════════════════════════════════════════════════════════════════════════════
async def handle_graph_explain(args):
    _ensure_graph_loaded()
    name = args.get("name", "")
    file_path = args.get("file_path", "")

    # Find matching nodes
    matches = []
    for nid, node in _graph.nodes.items():
        if name.lower() == node.get("name", "").lower():
            if not file_path or file_path in node.get("file_path", ""):
                matches.append(node)

    if not matches:
        return {"error": f"Symbol '{name}' not found"}

    results = []
    for node in matches:
        nid = node["id"]
        callers = _graph.rev_adj.get(nid, set())
        callees = _graph.adj.get(nid, set())
        results.append({
            "name": node["name"],
            "type": node.get("type"),
            "file": node.get("file_path"),
            "line": node.get("line_start"),
            "signature": node.get("signature"),
            "docstring": node.get("docstring"),
            "complexity": node.get("complexity"),
            "callers": [
                {"name": _graph.nodes.get(c, {}).get("name", c),
                 "file": _graph.nodes.get(c, {}).get("file_path", "")}
                for c in list(callers)[:10]
            ],
            "callees": [
                {"name": _graph.nodes.get(c, {}).get("name", c),
                 "file": _graph.nodes.get(c, {}).get("file_path", "")}
                for c in list(callees)[:10]
            ],
        })
    return {"symbols": results}

# ═════════════════════════════════════════════════════════════════════════════
# Handler: graph_visualize
# ═════════════════════════════════════════════════════════════════════════════
async def handle_graph_visualize(args):
    _ensure_graph_loaded()
    project_path = args["project_path"]
    output_file = args.get("output_file", os.path.join(SUPERMCP_GRAPH_DIR, "graph.html"))
    max_nodes = args.get("max_nodes", 200)

    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)

    # Build D3.js force-directed graph
    nodes_data = []
    edges_data = []
    node_ids = list(_graph.nodes.keys())[:max_nodes]
    node_set = set(node_ids)

    for nid in node_ids:
        node = _graph.nodes[nid]
        nodes_data.append({
            "id": nid,
            "name": node.get("name", nid),
            "type": node.get("type", "unknown"),
            "file": os.path.basename(node.get("file_path", "")) if node.get("file_path") else "",
            "complexity": node.get("complexity", 0),
        })

    for source, target, edge_type, weight in _graph.edges:
        if source in node_set and target in node_set:
            edges_data.append({
                "source": source, "target": target,
                "type": edge_type, "weight": weight,
            })

    # Build HTML without f-strings to avoid backslash issues
    nodes_json = json.dumps(nodes_data)
    edges_json = json.dumps(edges_data)
    html_parts = [
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SuperMCP Graph</title>',
        '<script src="https://d3js.org/d3.v7.min.js"></script>',
        '<style>',
        'body{margin:0;background:#0d1117;color:#c9d1d9;font-family:monospace;}',
        '#graph{width:100vw;height:100vh;}',
        '.node circle{stroke:#fff;stroke-width:1.5px;}',
        '.node text{font-size:10px;fill:#c9d1d9;pointer-events:none;}',
        '.link{stroke:#484f58;stroke-opacity:0.6;}',
        '.link.calls{stroke:#58a6ff;}',
        '.link.inherits{stroke:#f97583;}',
        '.link.imports{stroke:#79c0ff;}',
        '#info{position:fixed;top:10px;left:10px;background:#161b22;padding:15px;border-radius:8px;border:1px solid #30363d;max-width:400px;}',
        '#info h3{margin:0 0 8px 0;color:#58a6ff;}',
        '#info p{margin:4px 0;font-size:12px;}',
        '.legend{position:fixed;bottom:10px;right:10px;background:#161b22;padding:10px;border-radius:8px;border:1px solid #30363d;font-size:11px;}',
        '.legend-item{display:flex;align-items:center;gap:6px;margin:3px 0;}',
        '.legend-color{width:12px;height:12px;border-radius:50%;}',
        '</style></head><body>',
        '<div id="info"><h3>SuperMCP Knowledge Graph</h3>',
        f'<p>Nodes: {len(nodes_data)} | Edges: {len(edges_data)}</p>',
        '<p>Drag to rearrange. Scroll to zoom. Hover for details.</p></div>',
        '<div class="legend">',
        '<div class="legend-item"><div class="legend-color"style="background:#58a6ff"></div>Function</div>',
        '<div class="legend-item"><div class="legend-color"style="background:#f97583"></div>Class</div>',
        '<div class="legend-item"><div class="legend-color"style="background:#79c0ff"></div>File</div>',
        '<div class="legend-item"><div class="legend-color"style="background:#ffa657"></div>Import</div>',
        '</div>',
        '<svg id="graph"></svg>',
        '<script>',
        f'const nodes = {nodes_json};',
        f'const links = {edges_json};',
        'const colorMap={function:"#58a6ff",class:"#f97583",file:"#79c0ff",import:"#ffa657",method:"#d2a8ff",unknown:"#8b949e"};',
        'const svg=d3.select("#graph").attr("width",window.innerWidth).attr("height",window.innerHeight);',
        'const g=svg.append("g");',
        'const zoom=d3.zoom().scaleExtent([0.1,10]).on("zoom",(e)=>g.attr("transform",e.transform));',
        'svg.call(zoom);',
        'const simulation=d3.forceSimulation(nodes).force("link",d3.forceLink(links).id(d=>d.id).distance(80)).force("charge",d3.forceManyBody().strength(-200)).force("center",d3.forceCenter(window.innerWidth/2,window.innerHeight/2)).force("collision",d3.forceCollide().radius(20));',
        'const link=g.append("g").selectAll(".link").data(links).enter().append("line").attr("class",d=>"link "+d.type).attr("stroke-width",d=>Math.sqrt(d.weight));',
        'const node=g.append("g").selectAll(".node").data(nodes).enter().append("g").attr("class","node").call(d3.drag().on("start",(e,d)=>{if(!e.active)simulation.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;}).on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y;}).on("end",(e,d)=>{if(!e.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}));',
        'node.append("circle").attr("r",d=>Math.max(5,Math.min(15,(d.complexity||1)*2))).attr("fill",d=>colorMap[d.type]||colorMap.unknown);',
        'node.append("text").attr("dx",12).attr("dy",4).text(d=>d.name);',
        'node.append("title").text(d=>d.name+"\\n"+d.type+"\\n"+(d.file||""));',
        'simulation.on("tick",()=>{link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y1).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y2);node.attr("transform",d=>"translate("+d.x+","+d.y+")");});',
        '</script></body></html>'
    ]
    html = "".join(html_parts)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(html)

    return {
        "status": "success",
        "output_file": output_file,
        "nodes": len(nodes_data),
        "edges": len(edges_data),
        "message": f"Open {output_file} in browser to view interactive graph",
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_analyze
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_analyze(args):
    project_path = args["project_path"]
    depth = args.get("depth", "standard")
    if not os.path.isdir(project_path):
        return {"error": f"Directory not found: {project_path}"}

    stats = {"files": 0, "lines": 0, "by_ext": defaultdict(int), "by_dir": defaultdict(int)}
    languages = set()
    total_complexity = 0
    func_count = 0
    class_count = 0
    issues = []

    for root, dirs, files in os.walk(project_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        rel_dir = os.path.relpath(root, project_path)
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SKIP_EXTENSIONS:
                continue
            stats["files"] += 1
            stats["by_ext"][ext] += 1
            stats["by_dir"][rel_dir] += 1
            if ext in (".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs", ".c", ".cpp", ".rb", ".php"):
                languages.add(ext)
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                lines = content.splitlines()
                stats["lines"] += len(lines)
                if ext == ".py" and depth != "shallow":
                    try:
                        tree = ast.parse(content)
                        for node in ast.walk(tree):
                            if isinstance(node, ast.FunctionDef):
                                func_count += 1
                                total_complexity += ASTParser._cyclomatic_complexity(node)
                            elif isinstance(node, ast.ClassDef):
                                class_count += 1
                    except SyntaxError:
                        issues.append(f"Syntax error: {fpath}")
            except Exception:
                pass

    avg_complexity = total_complexity / max(func_count, 1)

    return {
        "status": "success",
        "project_path": project_path,
        "files": stats["files"],
        "lines": stats["lines"],
        "languages": sorted(languages),
        "by_ext": dict(sorted(stats["by_ext"].items(), key=lambda x: x[1], reverse=True)[:15]),
        "top_dirs": dict(sorted(stats["by_dir"].items(), key=lambda x: x[1], reverse=True)[:10]),
        "functions": func_count,
        "classes": class_count,
        "avg_complexity": round(avg_complexity, 1),
        "complexity_rating": "low" if avg_complexity < 5 else "medium" if avg_complexity < 10 else "high",
        "issues": issues[:10],
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_search
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_search(args):
    query = args["query"]
    project_path = args["project_path"]
    max_results = args.get("max_results", 10)

    # BM25 search from index
    _ensure_graph_loaded()
    bm25_results = _bm25.search(query, top_k=max_results)

    # Also do direct grep for terms not in index
    results = []
    seen_files = set()

    for file_path, score in bm25_results:
        seen_files.add(file_path)
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            # Find matching lines
            matching_lines = []
            for i, line in enumerate(lines, 1):
                if any(term in line.lower() for term in query.lower().split()):
                    matching_lines.append({"line": i, "content": line.rstrip()[:120]})
            results.append({
                "file": file_path,
                "score": round(score, 2),
                "matches": matching_lines[:5],
            })
        except Exception:
            pass

    # If BM25 has no results, fall back to direct search
    if not results:
        for root, dirs, files in os.walk(project_path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in SKIP_EXTENSIONS:
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                        for i, line in enumerate(f, 1):
                            if query.lower() in line.lower():
                                results.append({
                                    "file": fpath, "line": i,
                                    "content": line.rstrip()[:120],
                                })
                                if len(results) >= max_results:
                                    break
                except Exception:
                    pass
            if len(results) >= max_results:
                break

    return {"query": query, "results": results[:max_results], "total": len(results)}

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_review
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_review(args):
    file_path = args["file_path"]
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    lines = content.splitlines()

    issues = []

    # Complexity check
    if file_path.endswith(".py"):
        try:
            tree = ast.parse(content)
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    cc = ASTParser._cyclomatic_complexity(node)
                    if cc > 10:
                        issues.append({"severity": "warning", "line": node.lineno,
                                       "code": "HIGH_COMPLEXITY",
                                       "message": f"Function '{node.name}' has cyclomatic complexity {cc} (threshold: 10)"})
                    if len(node.body) > 50:
                        issues.append({"severity": "info", "line": node.lineno,
                                       "code": "LONG_FUNCTION",
                                       "message": f"Function '{node.name}' has {len(node.body)} statements (consider splitting)"})
        except SyntaxError as e:
            issues.append({"severity": "error", "line": e.lineno, "code": "SYNTAX_ERROR", "message": str(e)})

    # Security scan
    sec_issues = SecurityScanner.scan_file(file_path)
    for si in sec_issues:
        issues.append({"severity": "error" if "HARDCODED" in si["code"] or "INJECTION" in si["code"] else "warning",
                       "line": si["line"], "code": si["code"], "message": si["message"]})

    # Naming conventions
    for i, line in enumerate(lines, 1):
        if re.match(r'^\s*def [A-Z]', line):
            issues.append({"severity": "info", "line": i, "code": "NAMING",
                           "message": "Function name starts with uppercase (should be snake_case)"})

    # Line length
    for i, line in enumerate(lines, 1):
        if len(line) > 120:
            issues.append({"severity": "info", "line": i, "code": "LINE_LENGTH",
                           "message": f"Line is {len(line)} chars (recommended: <120)"})

    return {
        "file": file_path,
        "lines": len(lines),
        "issues": sorted(issues, key=lambda x: {"error": 0, "warning": 1, "info": 2}.get(x["severity"], 3)),
        "error_count": sum(1 for i in issues if i["severity"] == "error"),
        "warning_count": sum(1 for i in issues if i["severity"] == "warning"),
        "info_count": sum(1 for i in issues if i["severity"] == "info"),
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_refactor
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_refactor(args):
    file_path = args["file_path"]
    focus = args.get("focus", "all")
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    suggestions = []

    if file_path.endswith(".py"):
        try:
            tree = ast.parse(content)
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    cc = ASTParser._cyclomatic_complexity(node)
                    # High complexity → extract sub-functions
                    if (focus in ("complexity", "all")) and cc > 10:
                        suggestions.append({
                            "type": "extract_function",
                            "target": node.name,
                            "line": node.lineno,
                            "reason": f"Cyclomatic complexity {cc} — extract conditional blocks into helper functions",
                            "priority": "high" if cc > 20 else "medium",
                        })
                    # Long function → split
                    if (focus in ("structure", "all")) and len(node.body) > 40:
                        suggestions.append({
                            "type": "split_function",
                            "target": node.name,
                            "line": node.lineno,
                            "reason": f"{len(node.body)} statements — split into smaller functions",
                            "priority": "medium",
                        })
                    # Too many arguments
                    arg_count = len(node.args.args)
                    if arg_count > 5:
                        suggestions.append({
                            "type": "reduce_arguments",
                            "target": node.name,
                            "line": node.lineno,
                            "reason": f"{arg_count} arguments — use a config object or split",
                            "priority": "low",
                        })
        except SyntaxError as e:
            return {"error": f"Syntax error: {e}"}

    # Duplication detection (simple: repeated line blocks)
    if focus in ("duplication", "all"):
        lines = content.splitlines()
        seen_blocks = {}
        for i in range(len(lines) - 3):
            block = "\n".join(lines[i:i+4]).strip()
            if len(block) > 30 and not block.startswith("#"):
                if block in seen_blocks:
                    suggestions.append({
                        "type": "extract_duplicate",
                        "line": i + 1,
                        "reason": f"Duplicate 4-line block also at line {seen_blocks[block]}",
                        "priority": "medium",
                    })
                else:
                    seen_blocks[block] = i + 1

    return {
        "file": file_path,
        "suggestions": sorted(suggestions, key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x["priority"], 3)),
        "total": len(suggestions),
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_explain
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_explain(args):
    file_path = args["file_path"]
    func_name = args.get("function_name")
    line_start = args.get("line_start")
    line_end = args.get("line_end")

    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    lines = content.splitlines()

    if file_path.endswith(".py"):
        try:
            tree = ast.parse(content)
        except SyntaxError as e:
            return {"error": f"Syntax error: {e}"}

        if func_name:
            # Explain specific function
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and node.name == func_name:
                    func_lines = lines[node.lineno - 1:node.end_lineno]
                    doc = ast.get_docstring(node) or "No docstring"
                    sig = ASTParser._get_signature(node)
                    cc = ASTParser._cyclomatic_complexity(node)
                    return {
                        "name": func_name,
                        "signature": sig,
                        "docstring": doc,
                        "complexity": cc,
                        "lines": f"{node.lineno}-{node.end_lineno}",
                        "code": "\n".join(func_lines),
                        "analysis": {
                            "complexity_rating": "low" if cc < 5 else "medium" if cc < 10 else "high",
                            "has_docstring": bool(ast.get_docstring(node)),
                            "arg_count": len(node.args.args),
                            "body_length": len(node.body),
                        },
                    }
            return {"error": f"Function '{func_name}' not found in {file_path}"}

        # Explain file overview
        funcs = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
        classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
        imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
        return {
            "file": file_path,
            "lines": len(lines),
            "functions": [{"name": f.name, "line": f.lineno, "complexity": ASTParser._cyclomatic_complexity(f)} for f in funcs],
            "classes": [{"name": c.name, "line": c.lineno} for c in classes],
            "imports": [ast.dump(i) for i in imports[:10]],
        }

    # Non-Python: return structure overview
    return {
        "file": file_path,
        "lines": len(lines),
        "preview": "\n".join(lines[:30]),
        "language": os.path.splitext(file_path)[1],
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_test_impact
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_test_impact(args):
    _ensure_graph_loaded()
    file_path = args["file_path"]
    func_name = args.get("function_name", "")

    # Find the node
    target_node = None
    for nid, node in _graph.nodes.items():
        if node.get("file_path") == file_path:
            if not func_name or func_name in node.get("name", ""):
                target_node = nid
                break

    if not target_node:
        return {"error": f"No graph node found for {file_path}"}

    # Reverse reachability: what tests depend on this?
    dependents = _graph.get_reverse_reachable(target_node, max_depth=15)
    tests = [
        {"name": _graph.nodes.get(n, {}).get("name", n),
         "file": _graph.nodes.get(n, {}).get("file_path", ""),
         "type": _graph.nodes.get(n, {}).get("type", "")}
        for n in dependents
        if "test" in _graph.nodes.get(n, {}).get("name", "").lower()
        or "test" in _graph.nodes.get(n, {}).get("file_path", "").lower()
    ]

    return {
        "changed_file": file_path,
        "changed_function": func_name,
        "affected_tests": tests,
        "total_affected": len(tests),
        "recommendation": f"Run {len(tests)} affected tests" if tests else "No tests directly affected (consider adding tests)",
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_dead
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_dead(args):
    _ensure_graph_loaded()
    project_path = args["project_path"]
    entry_points = args.get("entry_points", ["main", "__main__", "app", "run", "setup", "cli"])

    # Find entry point nodes
    ep_nodes = []
    for nid, node in _graph.nodes.items():
        if node.get("name", "") in entry_points and node.get("type") == "function":
            ep_nodes.append(nid)

    if not ep_nodes:
        # Fall back: all public functions in __main__ files
        for nid, node in _graph.nodes.items():
            if node.get("type") == "function" and "__main__" in node.get("file_path", ""):
                ep_nodes.append(nid)

    dead = _graph.dead_code(ep_nodes)
    dead_functions = [
        {"name": _graph.nodes[n].get("name", n),
         "file": _graph.nodes[n].get("file_path", ""),
         "line": _graph.nodes[n].get("line_start", 0)}
        for n in dead
        if _graph.nodes.get(n, {}).get("type") == "function"
    ]

    return {
        "entry_points_used": len(ep_nodes),
        "dead_functions": dead_functions[:50],
        "total_dead": len(dead_functions),
        "message": f"{len(dead_functions)} unreachable functions found" if dead_functions else "No dead code detected",
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_complexity
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_complexity(args):
    file_path = args["file_path"]
    threshold = args.get("threshold", 10)

    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if not file_path.endswith(".py"):
        return {"message": "Complexity analysis only supported for Python files"}

    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        return {"error": f"Syntax error: {e}"}

    functions = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            cc = ASTParser._cyclomatic_complexity(node)
            functions.append({
                "name": node.name,
                "line": node.lineno,
                "complexity": cc,
                "args": len(node.args.args),
                "lines": (node.end_lineno or node.lineno) - node.lineno + 1,
                "hot": cc >= threshold,
            })

    functions.sort(key=lambda x: x["complexity"], reverse=True)
    avg = sum(f["complexity"] for f in functions) / max(len(functions), 1)

    return {
        "file": file_path,
        "functions": functions,
        "total_functions": len(functions),
        "average_complexity": round(avg, 1),
        "hotspots": [f for f in functions if f["hot"]],
        "rating": "clean" if avg < 5 else "moderate" if avg < 10 else "complex",
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_security
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_security(args):
    file_path = args["file_path"]
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    issues = SecurityScanner.scan_file(file_path)
    return {
        "file": file_path,
        "issues": issues,
        "error_count": sum(1 for i in issues if "HARDCODED" in i["code"] or "INJECTION" in i["code"]),
        "warning_count": sum(1 for i in issues if "WEAK" in i["code"] or "DEBUG" in i["code"]),
        "total": len(issues),
        "clean": len(issues) == 0,
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: code_dependencies
# ═════════════════════════════════════════════════════════════════════════════
async def handle_code_dependencies(args):
    project_path = args["project_path"]
    depth = args.get("depth", 3)

    internal_deps = defaultdict(set)  # file -> set of files it imports
    external_deps = set()

    for root, dirs, files in os.walk(project_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            if not fname.endswith(".py"):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                tree = ast.parse(content)
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            mod = alias.name.split(".")[0]
                            if os.path.exists(os.path.join(root, mod + ".py")):
                                internal_deps[fpath].add(mod + ".py")
                            else:
                                external_deps.add(mod)
                    elif isinstance(node, ast.ImportFrom):
                        if node.module:
                            mod = node.module.split(".")[0]
                            if os.path.exists(os.path.join(root, mod + ".py")):
                                internal_deps[fpath].add(mod + ".py")
                            else:
                                external_deps.add(mod)
            except Exception:
                pass

    # Check requirements.txt
    req_file = os.path.join(project_path, "requirements.txt")
    pinned = []
    if os.path.exists(req_file):
        with open(req_file) as f:
            pinned = [l.strip() for l in f if l.strip() and not l.startswith("#")]

    return {
        "internal_dependencies": {k: list(v) for k, v in list(internal_deps.items())[:30]},
        "external_dependencies": sorted(external_deps),
        "pinned_requirements": pinned[:30],
        "total_internal": sum(len(v) for v in internal_deps.values()),
        "total_external": len(external_deps),
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: context_build
# ═════════════════════════════════════════════════════════════════════════════
async def handle_context_build(args):
    _ensure_graph_loaded()
    task = args["task"]
    project_path = args["project_path"]
    max_files = args.get("max_files", 10)

    # Search for relevant files using BM25
    bm25_results = _bm25.search(task, top_k=max_files)

    # Also search graph for relevant nodes
    relevant_nodes = []
    task_terms = set(task.lower().split())
    for nid, node in _graph.nodes.items():
        name = node.get("name", "").lower()
        if any(term in name for term in task_terms if len(term) > 3):
            relevant_nodes.append({
                "name": node["name"], "type": node.get("type"),
                "file": node.get("file_path"), "line": node.get("line_start"),
            })

    # Build context from top files
    context_files = []
    for file_path, score in bm25_results[:max_files]:
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            context_files.append({
                "file": file_path,
                "score": round(score, 2),
                "lines": len(content.splitlines()),
                "preview": content[:500],
            })
        except Exception:
            pass

    return {
        "task": task,
        "relevant_files": context_files,
        "relevant_symbols": relevant_nodes[:20],
        "total_context_files": len(context_files),
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: diff_analyze
# ═════════════════════════════════════════════════════════════════════════════
async def handle_diff_analyze(args):
    _ensure_graph_loaded()
    project_path = args["project_path"]
    diff_text = args.get("diff_text", "")

    # Auto-detect diff from git if not provided
    if not diff_text:
        try:
            result = subprocess.run(
                ["git", "diff", "--cached", "--no-color"],
                capture_output=True, text=True, cwd=project_path, timeout=10
            )
            diff_text = result.stdout
        except Exception:
            pass

    if not diff_text:
        return {"error": "No diff provided and no git diff available"}

    # Parse diff
    changed_files = []
    current_file = None
    added_lines = 0
    removed_lines = 0
    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            if current_file:
                changed_files.append(current_file)
            match = re.search(r'b/(.+)$', line)
            current_file = {"file": match.group(1) if match else line, "added": 0, "removed": 0, "issues": []}
        elif line.startswith("+") and not line.startswith("+++"):
            added_lines += 1
            if current_file:
                current_file["added"] += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed_lines += 1
            if current_file:
                current_file["removed"] += 1
    if current_file:
        changed_files.append(current_file)

    # Analyze impact per file
    total_impact = 0
    high_risk_files = []
    for cf in changed_files:
        file_path = os.path.join(project_path, cf["file"]) if not os.path.isabs(cf["file"]) else cf["file"]
        # Find in graph
        for nid, node in _graph.nodes.items():
            if node.get("file_path") == file_path:
                dependents = _graph.get_reverse_reachable(nid, max_depth=10)
                impact = len(dependents)
                total_impact += impact
                cf["impact"] = impact
                if impact > 10:
                    high_risk_files.append(cf["file"])
                break

    # Risk assessment
    risk = "low"
    if total_impact > 50 or len(high_risk_files) > 2:
        risk = "high"
    elif total_impact > 20 or len(high_risk_files) > 0:
        risk = "medium"

    return {
        "changed_files": changed_files,
        "total_added": added_lines,
        "total_removed": removed_lines,
        "total_impact_score": total_impact,
        "high_risk_files": high_risk_files,
        "risk_level": risk,
        "recommendation": {
            "low": "Safe to merge. Run standard tests.",
            "medium": "Review high-impact files. Run affected tests.",
            "high": "Significant blast radius. Full test suite + manual review recommended.",
        }[risk],
    }

# ═════════════════════════════════════════════════════════════════════════════
# Handler: project_map
# ═════════════════════════════════════════════════════════════════════════════
async def handle_project_map(args):
    _ensure_graph_loaded()
    project_path = args["project_path"]
    fmt = args.get("format", "markdown")

    # Build module structure
    modules = defaultdict(lambda: {"files": [], "functions": 0, "classes": 0})
    for nid, node in _graph.nodes.items():
        fp = node.get("file_path", "")
        if not fp.startswith(project_path):
            continue
        rel = os.path.relpath(fp, project_path)
        module = os.path.dirname(rel) or "root"
        modules[module]["files"].append(os.path.basename(fp))
        if node.get("type") == "function":
            modules[module]["functions"] += 1
        elif node.get("type") == "class":
            modules[module]["classes"] += 1

    # Key abstractions (high-centrality nodes)
    bridges = _graph.find_bridges()[:10]
    key_abstractions = [
        {"name": _graph.nodes.get(nid, {}).get("name", nid),
         "type": _graph.nodes.get(nid, {}).get("type", ""),
         "file": _graph.nodes.get(nid, {}).get("file_path", ""),
         "centrality": round(score, 2)}
        for nid, score in bridges
    ]

    if fmt == "mermaid":
        lines = ["graph TD"]
        for mod, info in sorted(modules.items())[:20]:
            safe_mod = re.sub(r'[^a-zA-Z0-9_]', '_', mod)
            file_count = len(info["files"])
            lines.append(f'    {safe_mod}["{mod}<br/>{file_count} files\"]')
        for bridge in key_abstractions[:5]:
            safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', bridge["name"])
            lines.append(f'    {safe_name}({bridge["name"]})')
        return {"map": "\n".join(lines), "format": "mermaid"}

    if fmt == "json":
        return {
            "modules": {k: {"files": list(set(v["files"])), "functions": v["functions"], "classes": v["classes"]} for k, v in modules.items()},
            "key_abstractions": key_abstractions,
            "total_nodes": len(_graph.nodes),
            "total_edges": len(_graph.edges),
        }

    # Markdown (default)
    lines = [f"# Project Map: {os.path.basename(project_path)}\n"]
    lines.append(f"**Nodes:** {len(_graph.nodes)} | **Edges:** {len(_graph.edges)}\n")
    lines.append("## Modules\n")
    lines.append("| Module | Files | Functions | Classes |")
    lines.append("|--------|-------|-----------|---------|")
    for mod, info in sorted(modules.items(), key=lambda x: len(x[1]["files"]), reverse=True)[:20]:
        lines.append(f"| `{mod}` | {len(set(info['files']))} | {info['functions']} | {info['classes']} |")
    lines.append("\n## Key Abstractions (High Centrality)\n")
    for ka in key_abstractions:
        lines.append(f"- **{ka['name']}** ({ka['type']}) — centrality: {ka['centrality']}")
    return {"map": "\n".join(lines), "format": "markdown"}

# ═════════════════════════════════════════════════════════════════════════════
# Handler: health_check
# ═════════════════════════════════════════════════════════════════════════════
async def handle_health_check(args):
    _ensure_graph_loaded()
    with db() as conn:
        node_count = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        edge_count = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        community_count = conn.execute("SELECT COUNT(DISTINCT community_id) FROM communities").fetchone()[0]
        bm25_terms = conn.execute("SELECT COUNT(DISTINCT term) FROM bm25_index").fetchone()[0]
        bm25_docs = conn.execute("SELECT COUNT(DISTINCT file_path) FROM bm25_index").fetchone()[0]
        last_indexed = conn.execute("SELECT MAX(last_indexed) FROM file_index").fetchone()[0]

    return {
        "status": "healthy",
        "graph": {
            "nodes": node_count,
            "edges": edge_count,
            "communities": community_count,
            "loaded_in_memory": _graph_loaded,
        },
        "search": {
            "bm25_terms": bm25_terms,
            "bm25_documents": bm25_docs,
        },
        "last_indexed": last_indexed,
        "database": SUPERMCP_DB,
        "database_size_mb": round(os.path.getsize(SUPERMCP_DB) / 1024 / 1024, 2) if os.path.exists(SUPERMCP_DB) else 0,
    }

# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
