"""
Pody Project Context MCP Server

Gives AI agents instant context about the Pody project without reading files.
Includes project structure, conventions, doc locations, and domain knowledge.
"""

import json
from pathlib import Path
from fastmcp import FastMCP

mcp = FastMCP("pody-context")

# Project root — adjust if needed
PROJECT_ROOT = Path("C:/Users/shiva/ProductLifeOS")

# Load project knowledge
PROJECT_CONTEXT = {
    "name": "Pody",
    "description": "Product Life OS — complete product lifecycle management app for India",
    "tech_stack": {
        "frontend": "Flutter",
        "backend": "Firebase",
        "database": "Firestore",
        "auth": "Firebase Auth",
        "storage": "Firebase Storage",
        "offline": "Hive/SQLite for local storage",
        "languages": "Dart (Flutter), TypeScript (Cloud Functions)",
    },
    "target_audience": "70-75% offline appliance buyers in India",
    "languages": ["Hindi", "English"],
    "key_features": [
        "Product registration and tracking",
        "Warranty management",
        "Service scheduling",
        "Spare parts ordering",
        "Product lifecycle (birth-to-death)",
        "Offline-first architecture",
        "Multi-brand support",
    ],
    "monetization": [
        "Warranty leads",
        "Service commissions",
        "Brand analytics",
        "Replacement leads",
    ],
    "data_moat": "Real-world product reliability + cost of ownership data",
    "docs_location": str(PROJECT_ROOT),
    "key_docs": {
        "PRD": "PRD.md",
        "Database_Schema": "Database_Schema.md",
        "UI_Spec": "UI_Spec.md",
        "API_Spec": "API_Spec.md",
        "Monetization": "Monetization.md",
        "Audit": "Agency_Audit.md",
        "Release_Plan": "Release_Plan.md",
        "Security": "Security.md",
        "Error_Handling": "Error_Handling.md",
        "Performance": "Performance.md",
        "UX": "UX.md",
        "Observability": "Observability.md",
        "Service_Provider_Network": "Service_Provider_Network.md",
    },
    "conventions": {
        "naming": "camelCase for variables, PascalCase for classes, snake_case for files",
        "state_management": "Riverpod",
        "routing": "GoRouter",
        "folder_structure": "feature-based architecture",
        "testing": "flutter_test + integration_test",
        "ci_cd": "GitHub Actions",
    },
    "releases": {
        "1": "Core product registration + warranty tracking",
        "2": "Service scheduling + spare parts",
        "3": "Service Provider Network",
        "4": "Analytics + monetization",
        "5": "Service Provider Network expansion",
    },
}


@mcp.tool()
def get_project_overview() -> str:
    """Get a complete overview of the Pody project — tech stack, target audience, features."""
    return json.dumps(PROJECT_CONTEXT, indent=2)


@mcp.tool()
def get_tech_stack() -> str:
    """Get the technology stack details."""
    return json.dumps(PROJECT_CONTEXT["tech_stack"], indent=2)


@mcp.tool()
def get_doc_locations() -> str:
    """Get the locations of all project documentation files."""
    docs = {}
    for name, filename in PROJECT_CONTEXT["key_docs"].items():
        path = PROJECT_ROOT / filename
        exists = path.exists()
        docs[name] = {
            "file": filename,
            "path": str(path),
            "exists": exists,
            "size": path.stat().st_size if exists else 0,
        }
    return json.dumps(docs, indent=2)


@mcp.tool()
def read_doc(doc_name: str) -> str:
    """Read a specific project document by name. Available: PRD, Database_Schema, UI_Spec, API_Spec, Monetization, Audit, Release_Plan, Security, Error_Handling, Performance, UX, Observability, Service_Provider_Network."""
    doc_map = PROJECT_CONTEXT["key_docs"]
    if doc_name not in doc_map:
        return f"Unknown doc: {doc_name}. Available: {', '.join(doc_map.keys())}"
    
    path = PROJECT_ROOT / doc_map[doc_name]
    if not path.exists():
        return f"File not found: {path}"
    
    return path.read_text(encoding="utf-8")


@mcp.tool()
def get_conventions() -> str:
    """Get project coding conventions and standards."""
    return json.dumps(PROJECT_CONTEXT["conventions"], indent=2)


@mcp.tool()
def get_release_plan() -> str:
    """Get the release plan and what's included in each release."""
    return json.dumps(PROJECT_CONTEXT["releases"], indent=2)


@mcp.tool()
def get_monetization_model() -> str:
    """Get the monetization strategy and revenue streams."""
    return json.dumps(PROJECT_CONTEXT["monetization"], indent=2)


@mcp.tool()
def list_project_files(pattern: str = "*.md") -> str:
    """List project files matching a pattern. Default: *.md files."""
    files = list(PROJECT_ROOT.glob(pattern))
    result = []
    for f in sorted(files):
        result.append({
            "name": f.name,
            "path": str(f),
            "size": f.stat().st_size,
        })
    return json.dumps(result, indent=2)


@mcp.tool()
def get_file_tree(max_depth: int = 2) -> str:
    """Get the project file tree up to a specified depth."""
    def tree(path: Path, depth: int, prefix: str = "") -> list:
        if depth > max_depth:
            return []
        items = []
        try:
            for item in sorted(path.iterdir()):
                if item.name.startswith('.') or item.name in ('node_modules', '__pycache__', '.git'):
                    continue
                if item.is_dir():
                    items.append(f"{prefix}📁 {item.name}/")
                    items.extend(tree(item, depth + 1, prefix + "  "))
                else:
                    size = item.stat().st_size
                    items.append(f"{prefix}📄 {item.name} ({size:,} bytes)")
        except PermissionError:
            pass
        return items
    
    lines = tree(PROJECT_ROOT, 0)
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
