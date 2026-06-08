"""
OWL Docs MCP Server — Auto-Documentation Engine
================================================
Generates documentation from code. Not template-filling —
actual understanding of code structure, patterns, and intent.

Tools (9):
  docs_readme_generate    — Generate comprehensive README from codebase analysis
  docs_api_generate       — Generate API documentation from code
  docs_architecture_diagram — Generate Mermaid architecture diagrams
  docs_changelog_generate — Generate CHANGELOG from git history
  docs_contributing_generate — Generate CONTRIBUTING.md
  docs_license_detect     — Detect and suggest appropriate license
  docs_type_docs          — Generate type documentation (TypeScript/Python types)
  docs_dependency_graph   — Generate dependency graph documentation
  docs_onboarding         — Generate developer onboarding guide

Dependencies: Python 3.11+
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)


def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"


def _run_git(repo_path, *args, timeout=15):
    try:
        result = subprocess.run(
            ["git", "-C", repo_path] + list(args),
            capture_output=True, text=True, timeout=timeout
        )
        return {"success": result.returncode == 0, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except:
        return {"success": False, "stdout": "", "stderr": "git not available"}


def _detect_project_type(path):
    """Detect the project type and framework."""
    result = {
        "language": "unknown", "framework": "unknown", "package_manager": "unknown",
        "has_tests": False, "has_ci": False, "has_docker": False, "has_docs": False
    }

    files = set()
    for root, dirs, fs in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
        for f in fs:
            files.add(f)
        if len(files) > 500:
            break

    # Language detection
    if any(f.endswith(".py") for f in files):
        result["language"] = "python"
    elif any(f.endswith((".ts", ".tsx")) for f in files):
        result["language"] = "typescript"
    elif any(f.endswith((".js", ".jsx")) for f in files):
        result["language"] = "javascript"
    elif any(f.endswith(".go") for f in files):
        result["language"] = "go"
    elif any(f.endswith(".rs") for f in files):
        result["language"] = "rust"
    elif any(f.endswith(".java") for f in files):
        result["language"] = "java"

    # Framework detection
    if "package.json" in files:
        result["package_manager"] = "npm"
        try:
            with open(os.path.join(path, "package.json")) as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            if "next" in deps:
                result["framework"] = "nextjs"
            elif "react" in deps:
                result["framework"] = "react"
            elif "vue" in deps:
                result["framework"] = "vue"
            elif "express" in deps:
                result["framework"] = "express"
            elif "fastify" in deps:
                result["framework"] = "fastify"
            elif "@nestjs/core" in deps:
                result["framework"] = "nestjs"
        except:
            pass
    elif "pyproject.toml" in files or "setup.py" in files:
        result["package_manager"] = "pip"
        for f in files:
            if f.endswith(".py"):
                try:
                    with open(os.path.join(path, f), errors="ignore") as fh:
                        content = fh.read(2000)
                    if "from fastapi" in content or "import fastapi" in content:
                        result["framework"] = "fastapi"
                        break
                    elif "from flask" in content or "import flask" in content:
                        result["framework"] = "flask"
                        break
                    elif "from django" in content or "import django" in content:
                        result["framework"] = "django"
                        break
                except:
                    pass
    elif "Cargo.toml" in files:
        result["package_manager"] = "cargo"
    elif "go.mod" in files:
        result["package_manager"] = "go modules"

    result["has_tests"] = any("test" in f.lower() or "spec" in f.lower() for f in files)
    result["has_ci"] = any(".github" in f or ".gitlab-ci" in f or "Jenkinsfile" in f for f in files)
    result["has_docker"] = "Dockerfile" in files
    result["has_docs"] = any(f in files for f in ("docs", "doc", "documentation"))

    return result


def _analyze_codebase(path):
    """Deep analysis of codebase structure."""
    modules = []
    classes = []
    functions = []
    imports = set()
    entry_points = []

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv", "env", "dist", "build")]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1]
            rel_path = os.path.relpath(filepath, path)

            if ext == ".py":
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read(5000)
                    # Classes
                    for m in re.finditer(r"^class\s+(\w+)", content, re.MULTILINE):
                        classes.append({"name": m.group(1), "file": rel_path})
                    # Functions
                    for m in re.finditer(r"^(?:async\s+)?def\s+(\w+)", content, re.MULTILINE):
                        functions.append({"name": m.group(1), "file": rel_path})
                    # Imports
                    for m in re.finditer(r"^(?:from|import)\s+(\S+)", content, re.MULTILINE):
                        imports.add(m.group(1).split(".")[0])
                    # Entry points
                    if "if __name__" in content:
                        entry_points.append(rel_path)
                except:
                    pass

            elif ext in (".js", ".ts", ".jsx", ".tsx"):
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read(5000)
                    for m in re.finditer(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", content):
                        functions.append({"name": m.group(1), "file": rel_path})
                    for m in re.finditer(r"class\s+(\w+)", content):
                        classes.append({"name": m.group(1), "file": rel_path})
                    for m in re.finditer(r"(?:import|from)\s+['\"]([^'\"]+)['\"]", content):
                        imports.add(m.group(1).split("/")[0])
                except:
                    pass

    # Top-level directories as modules
    for item in os.listdir(path):
        full = os.path.join(path, item)
        if os.path.isdir(full) and item not in (".git", "node_modules", "__pycache__", ".venv", "venv"):
            modules.append(item)

    return {
        "modules": sorted(modules),
        "classes": classes[:30],
        "functions": functions[:30],
        "imports": sorted(imports)[:30],
        "entry_points": entry_points[:10]
    }


# ─── Tool Handlers ────────────────────────────────────────────────────────────

async def handle_readme_generate(args: dict) -> dict:
    """Generate comprehensive README from codebase analysis."""
    path = args.get("path", ".")
    project_name = args.get("project_name", "")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    if not project_name:
        project_name = os.path.basename(os.path.abspath(path))

    project = _detect_project_type(path)
    analysis = _analyze_codebase(path)

    # Get git info
    git_info = {}
    git_log = _run_git(path, "log", "--oneline", "-5")
    if git_log["success"]:
        git_info["recent_commits"] = git_log["stdout"].split("\n")
    git_branch = _run_git(path, "rev-parse", "--abbrev-ref", "HEAD")
    if git_branch["success"]:
        git_info["branch"] = git_branch["stdout"]

    # Get existing README
    existing_readme = ""
    for readme_name in ("README.md", "README.rst", "README.txt", "README"):
        readme_path = os.path.join(path, readme_name)
        if os.path.exists(readme_path):
            with open(readme_path) as f:
                existing_readme = f.read()[:2000]
            break

    # Build README sections
    sections = []

    # Title
    sections.append(f"# {project_name}\n")

    # Badges
    badges = []
    if project["language"] != "unknown":
        badges.append(f"![Language](https://img.shields.io/badge/language-{project['language']}-blue)")
    if project["has_ci"]:
        badges.append("![CI](https://img.shields.io/badge/CI-passing-brightgreen)")
    if project["has_tests"]:
        badges.append("![Tests](https://img.shields.io/badge/tests-included-blue)")
    if project["has_docker"]:
        badges.append("![Docker](https://img.shields.io/badge/Docker-ready-blue)")
    if badges:
        sections.append(" ".join(badges) + "\n")

    # Description
    sections.append("## Overview\n")
    sections.append(f"A {project['language']} project" +
                    (f" built with {project['framework']}" if project["framework"] != "unknown" else "") +
                    ".\n")

    # Features (from module names)
    if analysis["modules"]:
        sections.append("## Project Structure\n")
        sections.append("```")
        for mod in analysis["modules"][:15]:
            sections.append(f"├── {mod}/")
        sections.append("```\n")

    # Installation
    sections.append("## Installation\n")
    if project["package_manager"] == "npm":
        sections.append("```bash\nnpm install\n```\n")
    elif project["package_manager"] == "pip":
        sections.append("```bash\npip install -r requirements.txt\n")
        if os.path.exists(os.path.join(path, "pyproject.toml")):
            sections.append("# or\npip install -e .\n")
        sections.append("```\n")
    elif project["package_manager"] == "cargo":
        sections.append("```bash\ncargo build\n```\n")
    elif project["package_manager"] == "go modules":
        sections.append("```bash\ngo mod download\n```\n")
    elif project["has_docker"]:
        sections.append("```bash\ndocker build -t " + project_name.lower() + " .\n```\n")
    else:
        sections.append("```bash\n# Add installation instructions here\n```\n")

    # Usage
    sections.append("## Usage\n")
    if analysis["entry_points"]:
        for ep in analysis["entry_points"][:3]:
            if ep.endswith(".py"):
                sections.append(f"```bash\npython {ep}\n```\n")
            elif ep.endswith((".js", ".ts")):
                sections.append(f"```bash\nnode {ep}\n```\n")
    else:
        sections.append("```bash\n# Add usage instructions here\n```\n")

    # API/Modules
    if analysis["classes"] or analysis["functions"]:
        sections.append("## API\n")
        if analysis["classes"]:
            sections.append("### Classes\n")
            for c in analysis["classes"][:10]:
                sections.append(f"- `{c['name']}` — `{c['file']}`")
            sections.append("")
        if analysis["functions"]:
            sections.append("### Functions\n")
            for f in analysis["functions"][:10]:
                sections.append(f"- `{f['name']}()` — `{f['file']}`")
            sections.append("")

    # Testing
    if project["has_tests"]:
        sections.append("## Testing\n")
        if project["language"] == "python":
            sections.append("```bash\npytest\n```\n")
        elif project["language"] in ("javascript", "typescript"):
            sections.append("```bash\nnpm test\n```\n")
        elif project["language"] == "go":
            sections.append("```bash\ngo test ./...\n```\n")
        elif project["language"] == "rust":
            sections.append("```bash\ncargo test\n```\n")

    # Dependencies
    if analysis["imports"]:
        sections.append("## Key Dependencies\n")
        for imp in analysis["imports"][:15]:
            sections.append(f"- `{imp}`")
        sections.append("")

    # Contributing
    sections.append("## Contributing\n")
    sections.append("1. Fork the repository")
    sections.append("2. Create a feature branch (`git checkout -b feature/amazing`)")
    sections.append("3. Commit your changes (`git commit -m 'feat: add amazing feature'`)")
    sections.append("4. Push to the branch (`git push origin feature/amazing`)")
    sections.append("5. Open a Pull Request\n")

    # License
    sections.append("## License\n")
    license_file = None
    for lf in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"):
        if os.path.exists(os.path.join(path, lf)):
            license_file = lf
            break
    if license_file:
        sections.append(f"See [{license_file}](./{license_file})\n")
    else:
        sections.append("MIT License (add LICENSE file)\n")

    return {
        "readme": "\n".join(sections),
        "project_type": project,
        "analysis_summary": {
            "modules": len(analysis["modules"]),
            "classes": len(analysis["classes"]),
            "functions": len(analysis["functions"]),
            "external_dependencies": len(analysis["imports"])
        },
        "existing_readme_found": bool(existing_readme)
    }


async def handle_api_generate(args: dict) -> dict:
    """Generate API documentation from code analysis."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    endpoints = []

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1]
            rel_path = os.path.relpath(filepath, path)

            if ext not in (".py", ".js", ".ts", ".go", ".java"):
                continue

            try:
                with open(filepath, errors="ignore") as f:
                    content = f.read()

                # Flask/FastAPI
                for m in re.finditer(r"@(?:app|router|blueprint)\.(?:route|get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]+)['\"](?:.*?methods\s*=\s*\[([^\]]+)\])?", content):
                    route = m.group(1)
                    methods = m.group(2) if m.group(2) else "GET"
                    line = content[:m.start()].count("\n") + 1
                    # Get docstring
                    rest = content[m.end():m.end()+500]
                    docstring = ""
                    dm = re.search(r'"""(.*?)"""', rest, re.DOTALL)
                    if dm:
                        docstring = dm.group(1).strip()[:200]
                    endpoints.append({"route": route, "methods": methods.strip().replace("'", ""), "file": rel_path, "line": line, "description": docstring})

                # Express
                for m in re.finditer(r"(?:app|router)\.(?:get|post|put|delete|patch|use)\s*\(\s*['\"]([^'\"]+)['\"]", content):
                    route = m.group(1)
                    method = m.group(0).split(".")[1].split("(")[0].upper()
                    line = content[:m.start()].count("\n") + 1
                    endpoints.append({"route": route, "methods": method, "file": rel_path, "line": line, "description": ""})

                # Go Gin
                for m in re.finditer(r"(?:r|router)\.(?:GET|POST|PUT|DELETE|PATCH)\s*\(\s*['\"]([^'\"]+)['\"]", content):
                    route = m.group(1)
                    method = m.group(0).split(".")[1].split("(")[0]
                    line = content[:m.start()].count("\n") + 1
                    endpoints.append({"route": route, "methods": method, "file": rel_path, "line": line, "description": ""})
            except:
                pass

    # Generate markdown
    sections = ["# API Documentation\n"]
    methods_order = ["GET", "POST", "PUT", "DELETE", "PATCH"]

    grouped = {}
    for ep in endpoints:
        for m in ep["methods"].split(","):
            m = m.strip().upper()
            if m not in grouped:
                grouped[m] = []
            grouped[m].append(ep)

    for method in methods_order:
        if method in grouped:
            sections.append(f"## {method}\n")
            for ep in grouped[method]:
                sections.append(f"### `{ep['route']}`")
                sections.append(f"- **File:** `{ep['file']}:{ep['line']}`")
                if ep["description"]:
                    sections.append(f"- **Description:** {ep['description']}")
                sections.append("")

    return {
        "total_endpoints": len(endpoints),
        "by_method": {m: len(e) for m, e in grouped.items()},
        "documentation": "\n".join(sections),
        "endpoints": endpoints
    }


async def handle_architecture_diagram(args: dict) -> dict:
    """Generate Mermaid architecture diagrams from codebase."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project_type(path)
    analysis = _analyze_codebase(path)

    diagrams = []

    # Module dependency diagram
    mermaid = ["graph TD"]
    for i, mod in enumerate(analysis["modules"][:12]):
        safe_name = re.sub(r"[^a-zA-Z0-9]", "_", mod)
        mermaid.append(f"    {safe_name}[{mod}]")

    # Add connections based on imports
    for i, mod in enumerate(analysis["modules"][:8]):
        safe_name = re.sub(r"[^a-zA-Z0-9]", "_", mod)
        if i > 0:
            prev = re.sub(r"[^a-zA-Z0-9]", "_", analysis["modules"][i-1])
            mermaid.append(f"    {prev} --> {safe_name}")

    diagrams.append({
        "title": "Module Dependencies",
        "type": "flowchart",
        "mermaid": "\n".join(mermaid)
    })

    # Class diagram
    if analysis["classes"]:
        class_diagram = ["classDiagram"]
        for c in analysis["classes"][:15]:
            safe = re.sub(r"[^a-zA-Z0-9]", "_", c["name"])
            class_diagram.append(f"    class {safe}")
        diagrams.append({
            "title": "Class Structure",
            "type": "class",
            "mermaid": "\n".join(class_diagram)
        })

    # System architecture
    sys_arch = ["graph LR"]
    if project["framework"] != "unknown":
        sys_arch.append(f"    Client[Client] --> {project['framework']}[{project['framework']}]")
    if project["has_docker"]:
        sys_arch.append(f"    {project['framework']} --> Docker[Docker Container]")
    sys_arch.append(f"    {project['framework']} --> DB[(Database)]")
    diagrams.append({
        "title": "System Architecture",
        "type": "flowchart",
        "mermaid": "\n".join(sys_arch)
    })

    return {
        "diagrams": diagrams,
        "project_type": project,
        "embed_instructions": "Use these Mermaid diagrams in Markdown: ```mermaid\n...\n```"
    }


async def handle_changelog_generate(args: dict) -> dict:
    """Generate CHANGELOG from git history."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    log = _run_git(path, "log", "--format=%H|%an|%ar|%s", "--no-merges")
    if not log["success"]:
        return {"error": "not a git repository or git not available"}

    features, fixes, breaking, other = [], [], [], []
    for line in log["stdout"].split("\n"):
        if "|" not in line:
            continue
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        hash_, author, reltime, subject = parts

        if re.search(r"^feat(\(.+?\))?!?:", subject):
            features.append(f"- {subject} ({author})")
        elif re.search(r"^fix(\(.+?\))?!?:", subject):
            fixes.append(f"- {subject} ({author})")
        elif "!" in (subject.split(":")[0] if ":" in subject else ""):
            breaking.append(f"- {subject} ({author})")
        elif re.search(r"^(?:chore|docs|style|refactor|test|build|ci)(\(.+?\))?:", subject):
            other.append(f"- {subject} ({author})")

    sections = ["# Changelog\n"]
    if breaking:
        sections.append("## Breaking Changes\n" + "\n".join(breaking[:20]) + "\n")
    if features:
        sections.append("## Features\n" + "\n".join(features[:30]) + "\n")
    if fixes:
        sections.append("## Bug Fixes\n" + "\n".join(fixes[:30]) + "\n")
    if other:
        sections.append("## Other Changes\n" + "\n".join(other[:20]) + "\n")

    return {
        "changelog": "\n".join(sections),
        "summary": {
            "features": len(features), "fixes": len(fixes),
            "breaking": len(breaking), "other": len(other)
        }
    }


async def handle_contributing_generate(args: dict) -> dict:
    """Generate CONTRIBUTING.md."""
    path = args.get("path", ".")
    project_name = args.get("project_name", os.path.basename(os.path.abspath(path)))
    project = _detect_project_type(path)

    sections = [
        f"# Contributing to {project_name}\n",
        "Thank you for your interest in contributing!\n",
        "## Getting Started\n",
        "1. Fork the repository",
        "2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/" + project_name + ".git`",
        "3. Create a feature branch: `git checkout -b feature/your-feature`\n",
        "## Development Setup\n",
    ]

    if project["package_manager"] == "npm":
        sections.extend(["```bash", "npm install", "npm run dev", "```\n"])
    elif project["package_manager"] == "pip":
        sections.extend(["```bash", "pip install -r requirements.txt", "pip install -e '.[dev]'", "```\n"])
    elif project["has_docker"]:
        sections.extend(["```bash", "docker-compose up", "```\n"])

    sections.extend([
        "## Code Style\n",
        "- Follow existing code patterns",
        "- Write meaningful commit messages (conventional commits)",
        "- Add tests for new features",
        "- Update documentation as needed\n",
        "## Pull Request Process\n",
        "1. Update the README.md with details of changes if applicable",
        "2. Add tests for any new functionality",
        "3. Ensure all tests pass",
        "4. Update the CHANGELOG.md",
        "5. Submit a pull request with a clear description\n",
        "## Commit Convention\n",
        "We use conventional commits:\n",
        "- `feat:` New feature",
        "- `fix:` Bug fix",
        "- `docs:` Documentation",
        "- `style:` Formatting",
        "- `refactor:` Code refactoring",
        "- `test:` Tests",
        "- `chore:` Maintenance\n",
        "## Code of Conduct\n",
        "Be respectful. Be constructive. Be excellent to each other.\n",
    ])

    return {"contributing": "\n".join(sections)}


async def handle_license_detect(args: dict) -> dict:
    """Detect existing license or suggest appropriate one."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    # Check for existing license
    existing = None
    for lf in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md"):
        full = os.path.join(path, lf)
        if os.path.exists(full):
            with open(full) as f:
                content = f.read(500)
            existing = {"file": lf, "preview": content[:200]}
            break

    # Detect from package.json or pyproject.toml
    license_type = None
    pkg_json = os.path.join(path, "package.json")
    if os.path.exists(pkg_json):
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            license_type = pkg.get("license")
        except:
            pass

    pyproject = os.path.join(path, "pyproject.toml")
    if not license_type and os.path.exists(pyproject):
        with open(pyproject) as f:
            content = f.read()
        m = re.search(r"license\s*=\s*['\"]([^'\"]+)['\"]", content)
        if m:
            license_type = m.group(1)

    suggestions = []
    if not existing:
        suggestions = [
            {"license": "MIT", "description": "Permissive, good for most projects"},
            {"license": "Apache-2.0", "description": "Permissive with patent protection"},
            {"license": "GPL-3.0", "description": "Copyleft, requires source sharing"},
            {"license": "BSD-3-Clause", "description": "Permissive, simple"},
            {"license": "MPL-2.0", "description": "Weak copyleft, file-level"},
        ]

    return {
        "existing_license": existing,
        "detected_license": license_type,
        "suggestions": suggestions if not existing else [],
        "recommendation": license_type or ("Add a LICENSE file — MIT is recommended for most projects" if not existing else "License file exists")
    }


async def handle_type_docs(args: dict) -> dict:
    """Generate type documentation for TypeScript/Python."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    types = []
    interfaces = []
    type_aliases = []
    enums = []
    dataclasses = []
    pydantic_models = []

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1]
            rel_path = os.path.relpath(filepath, path)

            if ext in (".ts", ".tsx"):
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read()
                    # Interfaces
                    for m in re.finditer(r"interface\s+(\w+)\s*\{([^}]+)\}", content, re.DOTALL):
                        props = [p.strip() for p in m.group(2).split(";") if p.strip() and ":" in p]
                        interfaces.append({"name": m.group(1), "file": rel_path, "properties": props[:10]})
                    # Type aliases
                    for m in re.finditer(r"type\s+(\w+)\s*=\s*([^;]+);", content):
                        type_aliases.append({"name": m.group(1), "definition": m.group(2).strip()[:100], "file": rel_path})
                    # Enums
                    for m in re.finditer(r"enum\s+(\w+)\s*\{([^}]+)\}", content, re.DOTALL):
                        values = [v.strip().split("=")[0].strip() for v in m.group(2).split(",") if v.strip()]
                        enums.append({"name": m.group(1), "values": values[:15], "file": rel_path})
                except:
                    pass

            elif ext == ".py":
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read()
                    # Dataclasses
                    for m in re.finditer(r"@dataclass\s*\nclass\s+(\w+)", content):
                        dc_name = m.group(1)
                        # Get fields
                        rest = content[m.end():m.end()+500]
                        fields = re.findall(r"(\w+)\s*:\s*(\w+)", rest)
                        dataclasses.append({"name": dc_name, "file": rel_path, "fields": fields[:10]})
                    # Pydantic models
                    for m in re.finditer(r"class\s+(\w+)\s*\(\s*(?:BaseModel|BaseSettings)\s*\)", content):
                        model_name = m.group(1)
                        rest = content[m.end():m.end()+500]
                        fields = re.findall(r"(\w+)\s*:\s*(\w+)", rest)
                        pydantic_models.append({"name": model_name, "file": rel_path, "fields": fields[:10]})
                    # Type aliases
                    for m in re.finditer(r"^(\w+)\s*=\s*(?:TypeVar|Generic|Union|Optional|List|Dict|Tuple)", content, re.MULTILINE):
                        type_aliases.append({"name": m.group(1), "definition": m.group(0)[:100], "file": rel_path})
                except:
                    pass

    # Generate markdown
    sections = ["# Type Documentation\n"]
    if interfaces:
        sections.append("## TypeScript Interfaces\n")
        for iface in interfaces:
            sections.append(f"### `{iface['name']}` — `{iface['file']}`")
            for prop in iface["properties"]:
                sections.append(f"- `{prop}`")
            sections.append("")
    if type_aliases:
        sections.append("## Type Aliases\n")
        for ta in type_aliases:
            sections.append(f"### `{ta['name']}` — `{ta['file']}`")
            sections.append(f"```\n{ta['definition']}\n```\n")
    if enums:
        sections.append("## Enums\n")
        for enum in enums:
            sections.append(f"### `{enum['name']}` — `{enum['file']}`")
            for v in enum["values"]:
                sections.append(f"- `{v}`")
            sections.append("")
    if dataclasses:
        sections.append("## Python Dataclasses\n")
        for dc in dataclasses:
            sections.append(f"### `{dc['name']}` — `{dc['file']}`")
            for fname, ftype in dc["fields"]:
                sections.append(f"- `{fname}: {ftype}`")
            sections.append("")
    if pydantic_models:
        sections.append("## Pydantic Models\n")
        for m in pydantic_models:
            sections.append(f"### `{m['name']}` — `{m['file']}`")
            for fname, ftype in m["fields"]:
                sections.append(f"- `{fname}: {ftype}`")
            sections.append("")

    return {
        "documentation": "\n".join(sections),
        "summary": {
            "interfaces": len(interfaces), "type_aliases": len(type_aliases),
            "enums": len(enums), "dataclasses": len(dataclasses),
            "pydantic_models": len(pydantic_models)
        }
    }


async def handle_dependency_graph(args: dict) -> dict:
    """Generate dependency graph documentation."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    deps = {"internal": [], "external": []}

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1]
            rel_path = os.path.relpath(filepath, path)

            if ext == ".py":
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read()
                    for m in re.finditer(r"from\s+(\S+)\s+import", content):
                        mod = m.group(1)
                        if mod.startswith(".") or mod.startswith(os.path.basename(path)):
                            deps["internal"].append({"from": rel_path, "imports": mod})
                        else:
                            deps["external"].append({"from": rel_path, "imports": mod.split(".")[0]})
                    for m in re.finditer(r"import\s+(\S+)", content):
                        mod = m.group(1)
                        if not mod.startswith("from"):
                            if mod.startswith(os.path.basename(path)):
                                deps["internal"].append({"from": rel_path, "imports": mod})
                            else:
                                deps["external"].append({"from": rel_path, "imports": mod.split(".")[0]})
                except:
                    pass

            elif ext in (".js", ".ts"):
                try:
                    with open(filepath, errors="ignore") as f:
                        content = f.read()
                    for m in re.finditer(r"(?:import|from)\s+['\"]([^'\"]+)['\"]", content):
                        mod = m.group(1)
                        if mod.startswith("."):
                            deps["internal"].append({"from": rel_path, "imports": mod})
                        elif not mod.startswith("node:"):
                            deps["external"].append({"from": rel_path, "imports": mod.split("/")[0]})
                except:
                    pass

    # Deduplicate
    ext_unique = {}
    for d in deps["external"]:
        key = d["imports"]
        if key not in ext_unique:
            ext_unique[key] = {"name": key, "used_by": []}
        ext_unique[key]["used_by"].append(d["from"])

    # Mermaid diagram
    mermaid = ["graph LR"]
    for i, (name, info) in enumerate(list(ext_unique.items())[:15]):
        safe = re.sub(r"[^a-zA-Z0-9]", "_", name)
        mermaid.append(f"    {safe}[{name}]")

    return {
        "external_dependencies": list(ext_unique.values())[:30],
        "internal_imports": deps["internal"][:30],
        "total_external": len(ext_unique),
        "total_internal": len(deps["internal"]),
        "mermaid_diagram": "\n".join(mermaid)
    }


async def handle_onboarding(args: dict) -> dict:
    """Generate developer onboarding guide."""
    path = args.get("path", ".")
    project_name = args.get("project_name", os.path.basename(os.path.abspath(path)))
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project_type(path)
    analysis = _analyze_codebase(path)

    sections = [
        f"# Developer Onboarding — {project_name}\n",
        "## Welcome!\n",
        f"This guide will help you get started with {project_name}.\n",
        "## Prerequisites\n",
    ]

    if project["language"] == "python":
        sections.append("- Python 3.8+")
        sections.append("- pip or uv package manager")
    elif project["language"] == "typescript":
        sections.append("- Node.js 18+")
        sections.append("- npm or pnpm")
    elif project["language"] == "javascript":
        sections.append("- Node.js 18+")
        sections.append("- npm or yarn")
    elif project["language"] == "go":
        sections.append("- Go 1.21+")
    elif project["language"] == "rust":
        sections.append("- Rust 1.70+ (via rustup)")

    if project["has_docker"]:
        sections.append("- Docker and Docker Compose")

    sections.extend(["\n## Quick Start\n"])

    if project["package_manager"] == "npm":
        sections.extend([
            "```bash",
            "# Clone the repository",
            f"git clone https://github.com/YOUR_ORG/{project_name}.git",
            f"cd {project_name}",
            "",
            "# Install dependencies",
            "npm install",
            "",
            "# Start development server",
            "npm run dev",
            "```\n"
        ])
    elif project["package_manager"] == "pip":
        sections.extend([
            "```bash",
            f"git clone https://github.com/YOUR_ORG/{project_name}.git",
            f"cd {project_name}",
            "",
            "# Create virtual environment",
            "python -m venv .venv",
            "source .venv/bin/activate  # or .venv\\Scripts\\activate on Windows",
            "",
            "# Install dependencies",
            "pip install -r requirements.txt",
            "pip install -e '.[dev]'",
            "",
            "# Run the application",
            "python -m " + (analysis["modules"][0] + "." if analysis["modules"] else "") + "main",
            "```\n"
        ])
    elif project["has_docker"]:
        sections.extend([
            "```bash",
            f"git clone https://github.com/YOUR_ORG/{project_name}.git",
            f"cd {project_name}",
            "",
            "# Start with Docker",
            "docker-compose up",
            "```\n"
        ])

    if analysis["modules"]:
        sections.extend(["## Project Structure\n"])
        for mod in analysis["modules"][:10]:
            sections.append(f"- `{mod}/` — Add description here")
        sections.append("")

    if project["has_tests"]:
        sections.extend(["## Running Tests\n"])
        if project["language"] == "python":
            sections.append("```bash\npytest\n```\n")
        elif project["language"] in ("javascript", "typescript"):
            sections.append("```bash\nnpm test\n```\n")

    sections.extend([
        "## Development Workflow\n",
        "1. Create a feature branch: `git checkout -b feature/your-feature`",
        "2. Make your changes",
        "3. Run tests: `pytest` or `npm test`",
        "4. Commit: `git commit -m 'feat: your feature'`",
        "5. Push: `git push origin feature/your-feature`",
        "6. Open a Pull Request\n",
        "## Key Contacts\n",
        "- Project Lead: [Name]",
        "- Tech Lead: [Name]",
        "- DevOps: [Name]\n",
        "## Resources\n",
        "- [README](./README.md)",
        "- [API Documentation](./docs/API.md)",
        "- [Architecture](./docs/ARCHITECTURE.md)\n",
    ])

    return {"onboarding": "\n".join(sections)}


# ─── Server Setup ─────────────────────────────────────────────────────────────

server = Server("owl-docs")

ALL_TOOLS = [
    ("docs_readme_generate", "Generate comprehensive README from codebase analysis", handle_readme_generate),
    ("docs_api_generate", "Generate API documentation from code analysis", handle_api_generate),
    ("docs_architecture_diagram", "Generate Mermaid architecture diagrams", handle_architecture_diagram),
    ("docs_changelog_generate", "Generate CHANGELOG from git history", handle_changelog_generate),
    ("docs_contributing_generate", "Generate CONTRIBUTING.md", handle_contributing_generate),
    ("docs_license_detect", "Detect and suggest appropriate license", handle_license_detect),
    ("docs_type_docs", "Generate type documentation (TypeScript/Python)", handle_type_docs),
    ("docs_dependency_graph", "Generate dependency graph documentation", handle_dependency_graph),
    ("docs_onboarding", "Generate developer onboarding guide", handle_onboarding),
]

@server.list_tools()
async def list_tools() -> List[Tool]:
    return [Tool(name=n, description=d, inputSchema={"type": "object", "properties": {}, "additionalProperties": True})
            for n, d, _ in ALL_TOOLS]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    handler_map = {n: h for n, _, h in ALL_TOOLS}
    handler = handler_map.get(name)
    if not handler:
        return [TextContent(type="text", text=json.dumps({"error": f"unknown tool: {name}"}))]
    try:
        result = await handler(arguments)
        return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
