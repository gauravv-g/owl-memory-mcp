#!/usr/bin/env python3
"""
Smart Tools — Supercharged wrappers for Hermes native tools.

These don't replace native tools. They enhance them with:
- Batching (reduce round-trips)
- Caching (avoid redundant operations)
- Intelligence (auto-detect patterns, summarize, extract)
- Error recovery (auto-retry, fallback strategies)

Usage: Import and call from execute_code, or use as reference for skill building.
"""

import json
import os
import re
import hashlib
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone

# ─────────────────────────────────────────────────────────────────────────────
# SMART FILE OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

def smart_read(paths: List[str], summarize_threshold: int = 2000) -> Dict[str, Any]:
    """
    Read multiple files in one call. Auto-summarize large files.
    
    Args:
        paths: List of file paths to read
        summarize_threshold: Lines above which to auto-summarize
        
    Returns:
        Dict mapping path -> {content, lines, size, summary?, language}
    """
    results = {}
    for path in paths:
        try:
            p = Path(path)
            if not p.exists():
                results[path] = {"error": "File not found"}
                continue
            
            content = p.read_text(encoding='utf-8', errors='replace')
            lines = content.splitlines()
            size = p.stat().st_size
            
            result = {
                "content": content,
                "lines": len(lines),
                "size": size,
                "language": p.suffix,
            }
            
            # Auto-summarize large files
            if len(lines) > summarize_threshold:
                result["summary"] = _summarize_file(content, lines, p.suffix)
                result["content"] = None  # Don't return full content for large files
                result["note"] = f"File too large ({len(lines)} lines). Use read_file directly for full content."
            
            results[path] = result
        except Exception as e:
            results[path] = {"error": str(e)}
    
    return results


def _summarize_file(content: str, lines: List[str], suffix: str) -> str:
    """Generate a smart summary of a file."""
    summary_parts = []
    
    # Count by type
    blank = sum(1 for l in lines if not l.strip())
    comments = sum(1 for l in lines if l.strip().startswith(('#', '//', '/*', '*', '"""', "'''")))
    code = len(lines) - blank - comments
    
    summary_parts.append(f"Total: {len(lines)} lines ({code} code, {comments} comments, {blank} blank)")
    
    # Extract key structures
    if suffix in ('.py',):
        funcs = [l.strip() for l in lines if l.strip().startswith('def ')]
        classes = [l.strip() for l in lines if l.strip().startswith('class ')]
        imports = [l.strip() for l in lines if l.strip().startswith(('import ', 'from '))]
        
        if classes:
            summary_parts.append(f"Classes: {len(classes)}")
            for c in classes[:5]:
                summary_parts.append(f"  {c}")
        if funcs:
            summary_parts.append(f"Functions: {len(funcs)}")
            for f in funcs[:10]:
                summary_parts.append(f"  {f}")
        if imports:
            summary_parts.append(f"Imports: {len(imports)}")
    
    elif suffix in ('.js', '.ts', '.jsx', '.tsx'):
        funcs = [l.strip() for l in lines if 'function ' in l or '=>' in l]
        classes = [l.strip() for l in lines if l.strip().startswith('class ')]
        imports = [l.strip() for l in lines if l.strip().startswith(('import ', 'require('))]
        
        if classes:
            summary_parts.append(f"Classes: {len(classes)}")
        if funcs:
            summary_parts.append(f"Functions: {len(funcs)}")
        if imports:
            summary_parts.append(f"Imports: {len(imports)}")
    
    elif suffix in ('.json',):
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                summary_parts.append(f"JSON object: {len(data)} keys")
                summary_parts.append(f"Keys: {', '.join(list(data.keys())[:20])}")
            elif isinstance(data, list):
                summary_parts.append(f"JSON array: {len(data)} items")
        except:
            summary_parts.append("Invalid JSON")
    
    elif suffix in ('.md', '.txt'):
        headers = [l for l in lines if l.strip().startswith('#')]
        if headers:
            summary_parts.append(f"Headers: {len(headers)}")
            for h in headers[:10]:
                summary_parts.append(f"  {h.strip()}")
    
    return '\n'.join(summary_parts)


def smart_write(path: str, content: str, backup: bool = True, 
                template_vars: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Write file with auto-backup, template expansion, and diff preview.
    
    Args:
        path: File path
        content: Content to write
        backup: Create .bak backup of existing file
        template_vars: Optional dict for template variable substitution
        
    Returns:
        Dict with status, backup_path, diff_preview
    """
    result = {"path": path}
    p = Path(path)
    
    # Template expansion
    if template_vars:
        for key, value in template_vars.items():
            placeholder = "{{" + key + "}}"
            content = content.replace(placeholder, str(value))
            placeholder2 = "{{" + key + "}}"
            content = content.replace(placeholder2, str(value))
    
    # Backup existing file
    if backup and p.exists():
        backup_path = str(p) + '.bak'
        p.rename(backup_path)
        result["backup_path"] = backup_path
    
    # Create parent dirs
    p.parent.mkdir(parents=True, exist_ok=True)
    
    # Write
    p.write_text(content, encoding='utf-8')
    result["status"] = "written"
    result["size"] = len(content)
    result["lines"] = len(content.splitlines())
    
    return result


def smart_search(pattern: str, paths: List[str] = None, 
                 file_glob: str = "*", context_lines: int = 2,
                 max_results: int = 50) -> Dict[str, Any]:
    """
    Search across multiple paths with context and smart grouping.
    
    Args:
        pattern: Regex pattern to search
        paths: List of paths to search (default: current directory)
        file_glob: File pattern to filter
        context_lines: Lines of context around matches
        max_results: Maximum total results
        
    Returns:
        Dict with matches grouped by file, total count, search time
    """
    import time
    start = time.time()
    
    if paths is None:
        paths = ['.']
    
    all_matches = {}
    total = 0
    
    for search_path in paths:
        p = Path(search_path)
        if not p.exists():
            continue
        
        files = list(p.rglob(file_glob)) if p.is_dir() else [p]
        
        for f in files:
            if f.is_dir():
                continue
            try:
                content = f.read_text(encoding='utf-8', errors='replace')
                lines = content.splitlines()
                
                file_matches = []
                for i, line in enumerate(lines, 1):
                    if re.search(pattern, line):
                        start_line = max(0, i - context_lines - 1)
                        end_line = min(len(lines), i + context_lines)
                        context = '\n'.join(
                            f"{'>>>' if j == i else '   '} {j}: {l}"
                            for j, l in enumerate(lines[start_line:end_line], start_line + 1)
                        )
                        file_matches.append({
                            "line": i,
                            "match": line.strip(),
                            "context": context,
                        })
                        total += 1
                        
                        if total >= max_results:
                            break
                
                if file_matches:
                    all_matches[str(f)] = {
                        "matches": file_matches,
                        "count": len(file_matches),
                    }
                
                if total >= max_results:
                    break
            except Exception:
                continue
    
    elapsed = time.time() - start
    
    return {
        "pattern": pattern,
        "files_searched": len(paths),
        "files_with_matches": len(all_matches),
        "total_matches": total,
        "search_time_ms": round(elapsed * 1000),
        "matches": all_matches,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SMART CODE EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

def smart_execute(code: str, retry_count: int = 2, 
                  auto_install: bool = True,
                  timeout: int = 120) -> Dict[str, Any]:
    """
    Execute Python code with auto-retry, dependency detection, and caching.
    
    This is a reference implementation. In practice, use Hermes's execute_code
    tool directly. This function shows the pattern for smart execution.
    
    Args:
        code: Python code to execute
        retry_count: Number of retries on failure
        auto_install: Auto-install missing packages
        timeout: Execution timeout in seconds
        
    Returns:
        Dict with output, errors, execution time, cached result
    """
    # Generate cache key from code
    cache_key = hashlib.md5(code.encode()).hexdigest()[:12]
    
    result = {
        "cache_key": cache_key,
        "code_lines": len(code.splitlines()),
        "auto_install": auto_install,
        "retry_count": retry_count,
    }
    
    # Note: Actual execution happens via Hermes's execute_code tool.
    # This function provides the wrapper logic.
    result["note"] = "Use execute_code tool with this code. The smart wrapper provides retry/cache logic."
    result["execution_template"] = """
import sys
import subprocess
import json

# Auto-install missing packages
def ensure_import(module, package=None):
    try:
        __import__(module)
    except ImportError:
        pkg = package or module
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', pkg, '-q'])
        __import__(module)

# Execute with error handling
try:
    # USER_CODE
    result = {"status": "success", "output": "See stdout"}
except Exception as e:
    result = {"status": "error", "error": str(e), "traceback": __import__("traceback").format_exc()}}

print(json.dumps(result, ensure_ascii=False))
"""
    
    return result


# ─────────────────────────────────────────────────────────────────────────────
# SMART PROJECT STATE
# ─────────────────────────────────────────────────────────────────────────────

class ProjectState:
    """
    Persistent project state that survives across sessions.
    Stores: current task, progress, decisions, style preferences.
    """
    
    def __init__(self, project_dir: str):
        self.project_dir = Path(project_dir)
        self.state_file = self.project_dir / '.project-state.json'
        self.state = self._load()
    
    def _load(self) -> Dict:
        if self.state_file.exists():
            try:
                return json.loads(self.state_file.read_text(encoding='utf-8'))
            except:
                pass
        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "current_task": None,
            "progress": {},
            "decisions": [],
            "style": {},
            "todo": [],
        }
    
    def save(self):
        self.state["last_updated"] = datetime.now(timezone.utc).isoformat()
        self.state_file.write_text(
            json.dumps(self.state, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
    
    def set_task(self, task: str):
        self.state["current_task"] = task
        self.save()
    
    def add_decision(self, decision: str, reason: str = ""):
        self.state["decisions"].append({
            "decision": decision,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        self.save()
    
    def update_progress(self, key: str, value: Any):
        self.state["progress"][key] = value
        self.save()
    
    def get_progress(self) -> Dict:
        return self.state.get("progress", {})
    
    def get_decisions(self) -> List[Dict]:
        return self.state.get("decisions", [])
    
    def get_summary(self) -> str:
        """Get a human-readable project summary."""
        lines = [
            f"Project: {self.project_dir.name}",
            f"Current task: {self.state.get('current_task', 'None')}",
            f"Progress: {len(self.state.get('progress', {}))} items tracked",
            f"Decisions: {len(self.state.get('decisions', []))} recorded",
            f"Last updated: {self.state.get('last_updated', 'Never')}",
        ]
        return '\n'.join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# SMART BROWSER
# ─────────────────────────────────────────────────────────────────────────────

class BrowserCache:
    """
    Cache for browser operations to avoid redundant page loads.
    """
    
    def __init__(self, cache_dir: str = None):
        self.cache_dir = Path(cache_dir or os.path.expanduser('~/.hermes/browser-cache'))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.index_file = self.cache_dir / 'index.json'
        self.index = self._load_index()
    
    def _load_index(self) -> Dict:
        if self.index_file.exists():
            try:
                return json.loads(self.index_file.read_text(encoding='utf-8'))
            except:
                pass
        return {}
    
    def _save_index(self):
        self.index_file.write_text(
            json.dumps(self.index, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
    
    def get_cache_key(self, url: str) -> str:
        return hashlib.md5(url.encode()).hexdigest()[:16]
    
    def get(self, url: str, max_age_seconds: int = 300) -> Optional[Dict]:
        """Get cached page if fresh enough."""
        key = self.get_cache_key(url)
        if key in self.index:
            entry = self.index[key]
            age = time.time() - entry.get('timestamp', 0)
            if age < max_age_seconds:
                cache_file = self.cache_dir / f"{key}.json"
                if cache_file.exists():
                    return json.loads(cache_file.read_text(encoding='utf-8'))
        return None
    
    def put(self, url: str, data: Dict):
        """Cache a page."""
        key = self.get_cache_key(url)
        cache_file = self.cache_dir / f"{key}.json"
        cache_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
        self.index[key] = {
            "url": url,
            "timestamp": time.time(),
            "file": str(cache_file),
        }
        self._save_index()
    
    def clear(self):
        """Clear all cached pages."""
        for f in self.cache_dir.glob('*.json'):
            if f.name != 'index.json':
                f.unlink()
        self.index = {}
        self._save_index()


# ─────────────────────────────────────────────────────────────────────────────
# SMART TODO
# ─────────────────────────────────────────────────────────────────────────────

class SmartTodo:
    """
    Enhanced todo list with auto-prioritization, dependency tracking,
    and progress estimation.
    """
    
    def __init__(self, project_dir: str):
        self.project_dir = Path(project_dir)
        self.todo_file = self.project_dir / '.todo.json'
        self.todos = self._load()
    
    def _load(self) -> List[Dict]:
        if self.todo_file.exists():
            try:
                return json.loads(self.todo_file.read_text(encoding='utf-8'))
            except:
                pass
        return []
    
    def save(self):
        self.todo_file.write_text(
            json.dumps(self.todos, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
    
    def add(self, content: str, priority: int = 5, 
            depends_on: List[str] = None, estimated_minutes: int = 30) -> str:
        todo_id = hashlib.md5(f"{content}{time.time()}".encode()).hexdigest()[:8]
        self.todos.append({
            "id": todo_id,
            "content": content,
            "priority": priority,
            "status": "pending",
            "depends_on": depends_on or [],
            "estimated_minutes": estimated_minutes,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
        })
        self.save()
        return todo_id
    
    def complete(self, todo_id: str):
        for t in self.todos:
            if t["id"] == todo_id:
                t["status"] = "completed"
                t["completed_at"] = datetime.now(timezone.utc).isoformat()
                self.save()
                return True
        return False
    
    def get_next(self) -> Optional[Dict]:
        """Get the next actionable task (highest priority, no unmet dependencies)."""
        pending = [t for t in self.todos if t["status"] == "pending"]
        completed_ids = {t["id"] for t in self.todos if t["status"] == "completed"}
        
        # Filter out tasks with unmet dependencies
        actionable = []
        for t in pending:
            deps_met = all(d in completed_ids for d in t.get("depends_on", []))
            if deps_met:
                actionable.append(t)
        
        if not actionable:
            return None
        
        # Sort by priority (lower number = higher priority)
        actionable.sort(key=lambda t: t.get("priority", 5))
        return actionable[0]
    
    def get_summary(self) -> Dict:
        total = len(self.todos)
        completed = sum(1 for t in self.todos if t["status"] == "completed")
        pending = total - completed
        total_minutes = sum(t.get("estimated_minutes", 30) for t in self.todos if t["status"] == "pending")
        
        return {
            "total": total,
            "completed": completed,
            "pending": pending,
            "progress_pct": round(completed / total * 100) if total > 0 else 0,
            "estimated_remaining_minutes": total_minutes,
            "next_task": self.get_next(),
        }


# ─────────────────────────────────────────────────────────────────────────────
# CONVENIENCE FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def batch_read(paths: List[str]) -> str:
    """Read multiple files and return formatted output."""
    results = smart_read(paths)
    output_parts = []
    for path, data in results.items():
        if "error" in data:
            output_parts.append(f"## {path}\nERROR: {data['error']}\n")
        elif data.get("summary"):
            output_parts.append(f"## {path}\n{data['summary']}\n")
        else:
            output_parts.append(f"## {path} ({data['lines']} lines)\n{data['content']}\n")
    return '\n'.join(output_parts)


def quick_search(pattern: str, path: str = ".", file_glob: str = "*") -> str:
    """Quick search with formatted output."""
    results = smart_search(pattern, [path], file_glob)
    
    output_parts = [
        f"Search: '{pattern}' in {path}",
        f"Found {results['total_matches']} matches in {results['files_with_matches']} files ({results['search_time_ms']}ms)",
        ""
    ]
    
    for file_path, file_data in results["matches"].items():
        output_parts.append(f"### {file_path} ({file_data['count']} matches)")
        for match in file_data["matches"][:5]:  # Show first 5 per file
            output_parts.append(f"  Line {match['line']}: {match['match']}")
        if file_data["count"] > 5:
            output_parts.append(f"  ... and {file_data['count'] - 5} more")
        output_parts.append("")
    
    return '\n'.join(output_parts)


if __name__ == "__main__":
    # Demo
    print("Smart Tools loaded.")
    print(f"Available functions: smart_read, smart_write, smart_search, smart_execute")
    print(f"Available classes: ProjectState, BrowserCache, SmartTodo")
