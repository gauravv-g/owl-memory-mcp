# OWL MCP

> Your AI forgets. And sometimes it lies. OWL fixes both.

**Tools: ~169 | Servers: 21 | Cloud required: Zero**

## What It Does

OWL is a local MCP server platform that gives your AI agent:
- **Memory** that persists across sessions (not a filing cabinet — a brain with hallucination detection)
- **Code intelligence** — analyze, build, test, lint, review, refactor
- **Security auditing** — secret scanning, OWASP Top 10, CVE lookup, auth audit
- **Git intelligence** — smart commits, conflict prediction, PR generation
- **Auto-documentation** — README, API docs, architecture diagrams from code
- **CI/CD pipelines** — generate GitHub Actions, GitLab CI, Jenkins, Azure DevOps
- **Multi-agent orchestration** — spawn workers, merge results, execute plans
- **Web intelligence** — scraping, stealth fetch, dynamic JS, change monitoring
- **Research** — multi-query deep research with article extraction
- **Creative writing** — story bible, continuity, prose scoring, grammar check

## Servers

```
owl-nexus        → Meta-orchestration (11 tools)
owl-security     → Security audit (10 tools)
owl-research     → Deep research (10 tools)
owl-workflow     → CI/CD pipelines (10 tools)
owl-git          → Git intelligence (10 tools)
creative-studio  → Creative writing (10 tools)
owl-deploy       → Infrastructure (9 tools)
owl-docs         → Auto-documentation (9 tools)
owl-code         → Code intelligence (8 tools)
owl-agent        → Multi-agent orchestration (8 tools)
owl-data         → Data operations (8 tools)
owl-qa           → Quality assurance (24 tools)
owl-web          → Web intelligence (11 tools)
owl-qa-android   → Android automation (12 tools)
owl-qa-visual    → Visual QA (9 tools)
owl-unified      → Unified memory+web+research (8 tools)
owl-qa-economics → Bug economics (3 tools)
owl-sentinel     → Monitoring (4 tools)
```

## Architecture

```
hermes-custom-mcps/
├── owl_shared_intelligence.py    # Shared utilities (imported by all servers)
├── owl_nexus_mcp.py              # Task graph orchestration
├── owl_security_mcp.py           # Security audit engine
├── owl_research_mcp.py           # Deep research engine
├── owl_workflow_mcp.py           # CI/CD pipeline generator
├── owl_git_mcp.py                # Git intelligence
├── creative_studio_mcp.py        # Creative writing
├── owl_deploy_mcp.py             # Infrastructure
├── owl_docs_mcp.py               # Auto-documentation
├── owl_code_mcp.py               # Code intelligence
├── owl_agent_mcp.py              # Multi-agent orchestration
├── owl_data_mcp.py               # Data operations
├── owl_qa_mcp.py                 # QA test framework
├── owl_web_mcp.py                # Web scraping
├── owl_qa_visual.py              # Visual QA
├── owl_qa_android.py             # Android automation
├── owl_qa_economics.py           # Bug economics
├── owl_unified_server.py         # Unified memory+web+research
├── owl_sentinel.py               # Monitoring daemon
├── owl_unified_daemon.py         # File-watcher daemon
├── .venv/                        # Python 3.11.15 virtual environment
└── PHASE9.md                     # Phase 9 documentation
```

## Setup

```bash
git clone https://github.com/gauravv-g/owl-memory-mcp.git
cd owl-memory-mcp
uv venv .venv --python 3.11.15
.venv/Scripts/activate
pip install mcp httpx duckduckgo-search newspaper3k lxml_html_clean
```

## Config

All servers are registered in `config.yaml`:

```yaml
hermes mcp list          # List all registered servers
hermes mcp test <name>   # Test a server connection
hermes gateway restart   # Pick up code changes
```

## Shared Utilities

Every server imports from `owl_shared_intelligence`:

```python
import owl_shared_intelligence as shared

shared.now()                    # UTC timestamp
shared.walk_code(path)          # Walk codebase (skips node_modules, .git, etc.)
shared.categorize_files(files)  # Group files by type
shared.detect_project(path)     # Detect language, framework, package manager
shared.SKIP_DIRS                # Directories to skip
shared.SKIP_EXTENSIONS          # File extensions to skip
shared.OWL_DB_PATH              # SQLite database path
```

## License

MIT
