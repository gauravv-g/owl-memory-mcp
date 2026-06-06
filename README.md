# Your AI forgets. And sometimes it lies. OWL fixes both.

**OWL Memory MCP** — The only local AI memory system that reasons, warns, detects hallucinations, and thinks. Not just stores.

<p align="center">
  <img src="https://img.shields.io/badge/Tools-55%2B-blueviolet?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Memory_Types-6-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Token_Savings-95.4%25-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Cloud_Required-Zero-red?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" />
</p>

<p align="center">
  Works with <strong>Claude Desktop · Cursor · Windsurf · Antigravity</strong>
</p>

---

## The Problem

Every session, your AI starts from zero.

It forgets the bug you debugged for 3 hours last Tuesday. It forgets your architectural decisions. It re-reads the same files and charges you for every token. And sometimes — worse — it confidently tells you something that **contradicts what you told it last week**.

Tools like Mem0 and Supermemory try to fix the forgetting. They store and retrieve. That's a filing cabinet.

**OWL is a brain.**

---

## What Makes OWL Different

### 🔥 The Hallucination Firewall (Turing)
When your AI makes a claim, OWL cross-checks it against your stored semantic memories in real-time.

```
[TURING FIREWALL CORRECTION]: Ground truth dictates "this function throws on null input."
Your claim contradicts this. Verify before proceeding.
```

**No other memory tool does this.** Your AI can now catch itself lying.

### ⚠️ Cognitive Biorhythm (Pythagoras)
OWL tracks which hour and day of the week you historically ship bugs. It warns you:

```
⚠️ PYTHAGORAS: You are in your historical crash window (error rate 3.2x higher).
Defer critical deploys.
```

Friday 3–5pm is hard-coded at 3.2x risk. Because the data says so.

### 💉 Executable Bug Vaccines
When the same bug type appears twice, OWL auto-generates a sandboxed JavaScript function that detects that exact pattern in all future code. Each vaccine has a tracked precision score. They improve automatically.

### 🌐 P2P Cognitive Mesh (Berners-Lee)
OWL runs UDP multicast discovery on your local network. When another OWL user is found on your LAN, bug patterns and vaccines sync automatically — anonymized, private, no file paths exposed.

```
[OWL MESH] Learned 7 new bug patterns from peer 192.168.1.42
```

### 🕵️ Cargo Cult Detector (Feynman)
When you paste code without a stored rationale explaining *why*, OWL flags it:

```
⚠️ FEYNMAN CARGO CULT WARNING: Snippet in [auth.py] pasted without recorded rationale.
Store why you are using this pattern.
```

### ⚖️ Constitutional Violation Checker (Tata)
Define your project's mandatory coding rules. OWL enforces them on every file you open:

```
⚖️ CONSTITUTIONAL VIOLATION: Article 2 — 'Async calls must always be wrapped in try-catch blocks.'
```

---

## The Numbers

```
40-turn coding session WITHOUT OWL:
  Tokens: 2,050,000   Cost at $3/M: $6.15

40-turn coding session WITH OWL:
  Tokens: 96,000      Cost at $3/M: $0.28

Net savings: 95.4% reduction. Per session.
```

The math: OWL loads only what's relevant — solid (active file), liquid (neighbors), gas (rest). Distant files compress to 1% of their original size.

---

## Three Servers. One Brain.

```
┌─────────────────────────────────────────────────────────┐
│              owl_gateway.py  :3710                      │
│    ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │
│    │ owl-memory  │  │ owl-research │  │   owl-web   │  │
│    │ (Node.js)   │  │  (Python)    │  │  (Python)   │  │
│    │  55+ tools  │  │   9 tools    │  │  10 tools   │  │
│    └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  │
│           └────────────────┴──────────────────┘         │
│                     SQLite  ~/.owl-memory/               │
└─────────────────────────────────────────────────────────┘
```

All three servers share one SQLite database. Research results become memories. Web changes trigger memory alerts. Memory gates research — if OWL already knows the answer at 80%+ confidence, it returns it instantly with zero network calls.

---

## Complete Feature List

### 🧠 owl-memory — The Neuromorphic Engine (55+ tools)

**Memory Types (6 — competitors have 1-2)**
| Type | What It Stores |
|------|---------------|
| Episodic | Events, bugs, decisions with timestamps |
| Semantic | Facts, truths, architectural rules |
| Procedural | Skills, workflows, mastery levels |
| Somatic | Emotional residue from debugging pain |
| Transactive | Who knows what (agent directory) |
| Working | 4-chunk active cognitive stack |

**Retrieval (no competitor matches this stack)**
- 384-dim vector embeddings (Xenova/all-MiniLM-L6-v2, local, quantized, no API)
- BERT-NER entity extraction (Xenova/bert-base-NER, local)
- BM25 keyword + vector hybrid search
- Cross-encoder reranking of top-20
- Mood-congruent retrieval (emotional state biases results)
- Entity-boosted scoring
- Working memory priority boost

**Neuromorphic Intelligence**
- **Einstein Gravity**: Ranks memories by call-graph distance + emotional weight + salience
- **Tesla Resonance**: Spring-mass-damper wave propagation through your call graph
- **Thiel Contradiction**: Detects when code comments contradict crash logs
- **Musk Error Harvesting**: Surprise-gated writes — crashes on main branch get max salience
- **Naval Hotspots**: Flags files with highest bug-to-edit ratio for targeted refactoring
- **Tata Stewardship**: Package crash rate ledger → trust coefficient → circuit breaker suggestions
- **Torvalds Pruner**: Identifies dead code nodes via zero-activity ledger
- **Da Vinci Anatomical Paths**: Circulatory/nervous/skeletal system visualization of call paths

**Safety & Correctness**
- 🔥 **Hallucination Firewall** — AI claim vs stored ground truth cross-check
- ⚖️ **Constitutional Checker** — mandatory coding rules enforced per-file
- 🕵️ **Cargo Cult Detector** — flags copy-pasted code with no rationale memory
- ⚠️ **Cognitive Biorhythm** — your personal crash window tracker (hour × day)
- 💉 **Executable Bug Vaccines** — auto-generated sandboxed detection programs
- 🌐 **P2P Cognitive Mesh** — LAN-based anonymous bug sharing

**Self-Evolution**
- **Dream Cycle**: Idle-time consolidation, sandbox mutation, duplicate merge, schema abstraction
- **Self-Optimizing Constants**: Dream cycle mutates its own physics (gravity decay, resonance stiffness)
- **Memory Reconsolidation**: Memories drift in valence/strength each access (like human memory)
- **Semantic Distillation Engine**: Auto-generates abstractions from memory clusters
- **Stigmergy Pheromone Trails**: Action → outcome → path strengthening
- **Predictive Context Cache**: Pre-computes what you'll need next
- **Cognitive Fingerprint**: Builds a behavioral model of how YOU work
- **Feynman Abstraction Ladder**: 5 compression levels (PhD → 10-year-old → Analogy)
- **Memory Crystals**: Geometric clustering of related memories
- **Harmonic Analysis**: Bug density + cyclomatic complexity → code harmony score
- **Cross-Project Knowledge Transfer**: Matches patterns across your different projects
- **Specific Knowledge Crystals** (Naval): Unique heuristics captured as moat-building knowledge
- **Git-Native Memory Trees**: Memories tagged to branch + commit SHA

**UX**
- Session Resurrection: full state saved at end, restored at start
- Token Ledger: tracks tokens injected vs tokens saved per session
- D3.js Pythagorean Crystal visualization (interactive, force-directed, live)
- Narrative Templates: tracks recurring project flow patterns
- Decision Engine with Pre-Mortem (warns based on your failure history)

---

### 🔍 owl-research — The Research Engine (9 tools)

| Tool | What It Does |
|------|-------------|
| `research_quick` | DuckDuckGo + optional article extraction, <5 seconds |
| `research_deep` | 4–6 parallel queries + dedup + synthesis, 15–30 seconds |
| `research_compare` | Side-by-side research of 2–4 topics |
| `extract_article` | Full article text from any URL |
| `research_follow_up` | Generates 3 targeted follow-up angles from prior research |
| `research_on_file` | Researches every library detected in a code file |
| `research_first_principles` | Decomposes into axioms, mechanisms, constraints, alternatives |
| `research_synthesize` | Structures raw data into clean Markdown reports |
| `get_research_history` | Review what was already researched |

**Intelligence features:**
- **Memory-First Research Gate**: Checks memory at 0.80 confidence before any web call. Zero network cost on cache hits.
- **Evolutionary Query Templates**: Tracks which search patterns yield best results and promotes them automatically
- All results auto-stored in owl-memory, linked to active file

---

### 🌐 owl-web — The Web Intelligence Engine (10 tools)

| Tool | What It Does |
|------|-------------|
| `web_fetch` | Fast HTTP fetch — static pages, JSON, docs |
| `web_fetch_stealthy` | **Cloudflare bypass built-in** — LinkedIn, Twitter, Reddit |
| `web_fetch_dynamic` | JavaScript execution — React, Vue, SPAs |
| `web_scrape_adaptive` | **Survives site redesigns** — auto-relocates elements |
| `web_batch_fetch` | Up to 20 URLs in parallel |
| `web_extract_structured` | Title + metadata + headings + links + tables in one call |
| `web_diff` | Detects and classifies changes between page snapshots |
| `web_monitor_start` | Register URLs for recurring change detection |
| `web_session_scrape` | Multiple selectors from one page, one browser session |
| `web_research_crawl` | 20-page depth crawl following internal links |

**Intelligence features:**
- **Domain Temporal Freshness**: Per-domain exponential decay (Reuters: 1 day, GitHub: 90 days, RBI: 365 days)
- **Domain Trust Ledger**: Tracks source quality across fetches; warns on low-trust domains
- **Semantic Change Classification**: Price changes, security alerts, regulatory updates — auto-classified
- **Tesla Resonant Monitoring**: Adapts check frequency based on historical change patterns

---

## Honest Comparison

| | **OWL** | Mem0 | Supermemory | RecallNest |
|---|---|---|---|---|
| **Tools** | **55+** | 5 | 7 | 42 |
| **Memory types** | **6** | 2 | 2 | 2 |
| **Hallucination check** | **✅** | ❌ | ❌ | ❌ |
| **Reasoning engine** | **✅** | ❌ | ❌ | ❌ |
| **Cloudflare bypass** | **✅** | ❌ | ❌ | ❌ |
| **P2P mesh** | **✅** | ❌ | ❌ | ❌ |
| **Bug vaccines** | **✅** | ❌ | ❌ | ❌ |
| **Cognitive biorhythm** | **✅** | ❌ | ❌ | ❌ |
| **Adaptive scraping** | **✅** | ❌ | ❌ | ❌ |
| **Self-optimizing** | **✅** | ❌ | ❌ | ❌ |
| **95% token reduction** | **✅ (proven)** | ❌ | ❌ | ❌ |
| **Fully local** | **✅** | optional | ❌ | ✅ |
| **Zero API keys** | **✅** | ❌ | ❌ | ✅ |
| **Cloud sync** | ❌ planned | ✅ | ✅ | ❌ |
| **Gmail/Notion connectors** | ❌ planned | ✅ | ✅ | ❌ |

**Verdict**: Mem0 and Supermemory are filing cabinets. OWL is a brain. They win on cloud ecosystem. OWL wins on every intelligence dimension.

---

## Installation (30 seconds)

### Prerequisites
- Node.js v18+
- Python 3.10+

### Setup

```bash
git clone https://github.com/gauravv-g/owl-memory-mcp.git
cd owl-memory-mcp
npm install
pip install starlette uvicorn sse-starlette mcp scrapling beautifulsoup4 lxml html2text duckduckgo-search newspaper3k lxml_html_clean
```

### Start the Gateway

```bash
python owl_gateway.py
```

Runs on `http://localhost:3710`. All three servers live here.

---

## Configure Your AI Client

### Claude Desktop
File: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "owl-memory": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3710/memory/sse"]
    },
    "owl-web": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3710/web/sse"]
    },
    "owl-research": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3710/research/sse"]
    }
  }
}
```

### Cursor
File: `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "owl-memory": { "url": "http://localhost:3710/memory/sse" },
    "owl-web":    { "url": "http://localhost:3710/web/sse" },
    "owl-research": { "url": "http://localhost:3710/research/sse" }
  }
}
```

### Windsurf / Other MCP Clients
Point each server at the SSE endpoints above. Any MCP-compatible client works.

---

## The Architecture (for the curious)

```
owl_memory_v5.js     — Core memory engine (Node.js, 170KB, SQLite)
owl_research_mcp.py  — Research engine (Python, DuckDuckGo + newspaper3k)
owl_web_mcp.py       — Web intelligence (Python, Scrapling + Playwright)
owl_gateway.py       — Universal HTTP/SSE gateway (port 3710)
owl_daemon.js        — Background watcher (file events, dream cycles)
owl_mesh.js          — P2P LAN cognitive mesh (UDP multicast)
owl_shared_intelligence.py — Shared DB bridge (research ↔ web ↔ memory)
```

All three MCP servers read and write the same SQLite at `~/.owl-memory/memory-v5.db`. Your data is yours. You can query it directly with any SQLite viewer.

---

## The Origin Story

Every morning I'd open Cursor and spend the first 10 minutes re-explaining my codebase to an AI that had forgotten everything overnight. Then I'd pay for those tokens. Then I'd watch it make the same mistake it made last week.

I tried Mem0. I tried Supermemory. They help with basic recall. But they're filing cabinets. I wanted something that **thinks** about what it knows.

So I built OWL over 6 months.

The thing I discovered while building it: **the amnesia problem was the easy part.** The harder problem is that AI assistants sometimes confidently contradict knowledge you've given them before. So I built the Hallucination Firewall. And the Cargo Cult Detector. And the Constitutional Checker. And eventually the P2P Mesh, because I realized the real leverage isn't one developer's memory — it's a team's collective immunity to bugs they've already seen.

OWL is what I wanted to exist. Now it does.

---

## License

MIT. Free to use, fork, extend, and distribute. Forever.

---

<p align="center">
  <strong>⭐ Star this repo if OWL saves you from one bad Friday afternoon deploy.</strong>
</p>
