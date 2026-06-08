# OWL MCP — Local AI Memory & Quality Substrate

> Your AI forgets. And sometimes it lies. OWL fixes both.

**Tools: ~169 | Servers: 21 | Cloud required: Zero**

The local brain that sits behind your AI coding editor to prevent memory loss, block hallucinations, and automatically verify and repair your app code as you build.

---

## The Problem

Every session, your AI starts from zero.

It forgets the bug you debugged for 3 hours last Tuesday. It forgets your architectural decisions. It re-reads the same files and charges you for every token. And sometimes, worse, it confidently tells you something that contradicts what you told it last week.

Tools like Mem0 and Supermemory try to fix the forgetting. They store and retrieve. That is a filing cabinet.

**OWL is a brain.**

---

## What Makes OWL Different

### Turing — The Hallucination Firewall
When your AI makes a claim, OWL cross-checks it against your stored semantic memories in real-time.

```
[TURING FIREWALL CORRECTION]: Ground truth dictates "this function throws on null input."
Your claim contradicts this. Verify before proceeding.
```

**No other memory tool does this.** Your AI can now catch itself lying.

### Self-Healing Selectors
If your frontend code changes and a test selector breaks, OWL runs a semantic analysis of the page, matches candidate elements, and automatically corrects the broken selector in SQLite.

### Temporal Relativity (Einstein)
Content from `coindesk.com` has a half-life of 1 day. Content from `rbi.org.in` has a half-life of 365 days. OWL knows this and adjusts cache freshness accordingly.

### Tesla Resonance
Context weight propagates across code networks. Files you edit near each other in time share a Hebbian attention weight.

### Thiel Contradiction Detector
OWL flags discrepancies between what code comments say and what database records show.

---

## The Numbers

```
40-turn coding session WITHOUT OWL:
  Tokens: 2,050,000   Cost at $3/M: $6.15

40-turn coding session WITH OWL:
  Tokens: 96,000      Cost at $3/M: $0.28

Net savings: 95.4% reduction. Per session.
```

The math: OWL loads only what is relevant. It partitions file context into active (solid), neighboring (liquid), and general project directories (gas). Distant files compress to 1% of their original size.

---

## Ten Servers. One Engineering Team.

```
owl-nexus       → Meta-orchestration (11 tools)     Task DAGs, planning, verification, agent feedback loop
owl-security    → Security audit (10 tools)         Secret scanning, OWASP Top 10, CVE lookup, CORS/auth audit
owl-research    → Deep research (10 tools)          Multi-query synthesis, article extraction
owl-workflow    → CI/CD pipelines (10 tools)        GitHub Actions, GitLab CI, Jenkins, Azure DevOps, CircleCI
owl-git         → Git intelligence (10 tools)       Smart commits, branch analysis, conflict prediction, PR gen
creative-studio → Creative writing (10 tools)       Stories, scoring, pacing, continuity
owl-deploy      → Infrastructure (9 tools)          Docker, K8s, CI/CD config
owl-code        → Code intelligence (8 tools)       Analyze, build, test, lint, review, refactor, explain
owl-agent       → Multi-agent orchestration (8 tools) Spawn, collect, merge, plan, execute
owl-data        → Data operations (8 tools)         SQL, schema, CSV, ETL
owl-qa          → Quality assurance (24 tools)      E2E test flows, regression, visual, API, Android
owl-web         → Web intelligence (11 tools)       Scraping, stealth, dynamic JS, monitoring
owl-qa-android  → Android automation (12 tools)    ADB, uiautomator2, screenshots, taps, swipes
owl-qa-visual   → Visual QA (9 tools)               Screenshots, layout, visual regression
owl-unified     → Unified memory+web+research (8 tools)  perceive, remember, recall, research, fetch
owl-qa-economics → Bug economics (3 tools)          Debt ROI, prioritized fix queues
owl-sentinel    → Monitoring (4 tools)              Change detection, alerts
owl-docs        → Auto-documentation (9 tools)      README, API docs, architecture diagrams, CHANGELOG
```

All servers run as stdio MCP servers managed by Hermes Agent.

---

## Core Capabilities

### Memory
- **Episodic memory**: Records developer insights, workspace state, discoveries
- **Semantic search**: Hybrid vector + Jaccard similarity recall
- **Auto-dream**: Merges redundant memories, compresses stale data
- **Source trust scoring**: Multi-dimensional domain trust (recency, consistency, topic)
- **Temporal decay**: Domain-aware freshness (news dies in 1 day, docs last 365 days)

### Code
- Auto-detects language, build system, test framework
- Build, test, lint, refactor, explain, review
- Cross-profile soft guard (prevents editing other profiles' files)

### Web
- Static fetch, stealth fetch (Cloudflare bypass), dynamic fetch (JS execution)
- Adaptive scraping (auto-recovers after site redesign)
- Web diff, change monitoring, structured extraction

### QA
- Playwright user flow testing with screenshots
- Visual regression, accessibility audit, performance probe
- Android ADB automation (uiautomator2)
- Bug economics (debt ROI prioritization)
- Chaos probe (offline, slow 3G injection)

### Research
- Quick single-query search (under 5 seconds)
- Deep multi-query synthesis with article extraction
- Side-by-side comparison of 2-4 topics
- First-principles decomposition

---

## Installation

### Prerequisites
- Node.js v18+
- Python 3.11+

### Setup
```bash
git clone https://github.com/gauravv-g/owl-memory-mcp.git
cd owl-memory-mcp
npm install
pip install mcp scrapling beautifulsoup4 lxml html2text duckduckgo-search newspaper3k lxml_html_clean playwright uiautomator2 pillow anthropic aiohttp networkx sentence-transformers
playwright install
```

---

## Running

All servers run as stdio MCP servers managed by Hermes Agent.

```bash
hermes mcp list          # List all registered servers
hermes mcp test <name>   # Test a server connection
hermes gateway restart   # Pick up code changes
```

---

## Architecture

```
hermes-custom-mcps/
├── owl_nexus_mcp.py          # Task graph orchestration (1066 lines)
├── owl_research_mcp.py       # Deep research engine (1630 lines)
├── creative_studio_mcp.py    # Creative writing tools (1216 lines)
├── owl_web_mcp.py            # Web scraping (1197 lines)
├── owl_qa_mcp.py             # QA test framework (1475 lines)
├── owl_security_mcp.py       # Security audit engine (1187 lines) [NEW]
├── owl_docs_mcp.py           # Auto-documentation (983 lines) [NEW]
├── owl_workflow_mcp.py       # CI/CD pipeline generator (892 lines) [NEW]
├── owl_git_mcp.py            # Git intelligence (924 lines) [NEW]
├── owl_agent_mcp.py          # Multi-agent orchestration (434 lines) [NEW]
├── owl_code_mcp.py           # Code intelligence (251 lines)
├── owl_data_mcp.py           # Data operations (184 lines)
├── owl_deploy_mcp.py         # Infrastructure (195 lines)
├── owl_qa_visual.py          # Visual QA (877 lines)
├── owl_qa_android.py         # Android automation (13 tools, MCP server)
├── owl_qa_economics.py       # Bug economics (3 tools, MCP server)
├── owl_unified_server.py     # Unified memory+web+research (8 tools)
├── owl_sentinel.py           # Monitoring daemon (4 tools)
├── owl_shared_intelligence.py # Shared DB/schema (library, imported by others)
├── owl_unified_daemon.py     # File-watcher daemon (standalone, not MCP server)
├── owl_memory_v5.js          # Legacy memory server (JS)
├── archive/                  # Old JS server versions (v2, v3, v4, v5)
├── assets/                   # Logo, banner images
├── node_modules/             # JS dependencies
├── .venv/                    # Python virtual environment
├── nexus.db                  # Task graph state
├── owl_nexus.db             # Nexus cache
├── creative_studio.db        # Creative studio data
├── memory-v5.db             # Memory v5 data
└── PHASE2.md .. PHASE9.md   # Phase documentation
```

## License
MIT.
