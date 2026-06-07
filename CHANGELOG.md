# Changelog

All notable changes to OWL Memory are documented here.

---

## [4.0.0] — 2026-07-07

### Creative Studio MCP — v4 Exponential Elevation

**Architecture:**
- **Shared DB context manager** (`db()`) — Replaces 5× duplicated open/commit/close blocks with single `@contextmanager` pattern. Eliminates connection leaks.
- **Shared constants** — `GRAMMAR_VERB_RULES`, `GRAMMAR_ADJ_RULES`, `GRAMMAR_FAKE_WORDS`, `POSITION_MARKERS`, `EXPLICIT_TERMS`, `AI_WORDS`, `FILTER_WORDS`, `SENSORY_WORDS`, `EMOTIONAL_WORDS`, `COMMON_NAME_EXCLUDES` — Single source of truth, no duplication.
- **Bible-aware pipeline** — `load_bible()`, `auto_detect_series()`, `get_bible_character_names()` helper functions shared across tools.

**Tool Changes:**
- `check_continuity` — Now bible-aware: loads series bible, validates character names against it, flags unknown names, uses bible character genders instead of hardcoded male name list.
- `grammar_check_v2` — Now bible-aware: reads character genders from series bible for male dialogue filtering. Auto-detects series from file path.
- `score_prose` — Trend tracking: compares current scores to previous scores for same file, reports dimension-level deltas and improvement direction.
- `trope_innovate` — DB-deduped: loads previously generated innovations from DB, avoids re-generating same fusion combinations.
- `export_format` — Scene metadata enriched: reports per-scene word counts, total words, duration estimates in storyboard mode.
- `brainstorm_narrative` — Unchanged (LLM generates content; tool provides structure).

**Removed:**
- Phantom `series_continuity_db` tool from docstring (never implemented).
- `sys.exit(1)` import guard (graceful degradation).
- `indent=2` from tool response JSON (not human-facing).
- `import random` from module level (moved inside `trope_innovate` handler only).
- Decorative comment separators between sections.
- Verbose module docstring changelog (belongs in CHANGELOG.md).

**Metrics:**
- v3: 1105 lines → v4: 1202 lines (+97)
- Net structural improvement: -111 lines of duplication, +208 lines of shared infrastructure
- 10 tools, 5 DB tables (unchanged schema)
- All grammar rules: 1 shared definition (was 2 duplicated copies)
- DB connections: 1 context manager (was 5× duplicated open/close blocks)


---

## [2.0.0] — 2026-06-07

### Added — owl-qa (Python, 31 tools)
- **12 Quality Assurance Pillars**: Test Genome, Causal AI, Bug Oracle, Sensory Testing, Device Cloud, Selector Healing, Bug Economics, Living Graph, Mirror Test, Temporal Velocity, App Connectors, and Neural Mesh.
- **Core QA Tools**: `qa_inspect_web`, `qa_android_inspect`, `qa_api_inspect`, `qa_interact_web`, `qa_android_interact`, `qa_test_flow`, `qa_regression_check`, `qa_sherlock`, `qa_accessibility_audit`, `qa_performance_probe`, `qa_chaos_probe`, `qa_harmonic_audit`, `qa_sentinel_register`, `qa_explain_bug`, `qa_predict_bugs`, `qa_sensory_audit`, `qa_economics_report`, `qa_knowledge_graph`, `qa_temporal_analysis`, `qa_protocol_test`, `qa_compare_apps`, `qa_load_test`, `qa_user_story_generate`, `qa_competitive_audit`.
- **Hermes v8.0 Pillar Tools**: `qa_genome_evolve`, `qa_genome_register_flow`, `qa_causal_chain`, `qa_device_cloud_scan`, `qa_device_parallel_test`, `qa_selftest`, `qa_orchestrator_status`.

### Added — owl_sentinel (Python Daemon)
- Background monitor loop supporting automated web and Android test execution schedules.
- System notifications on failure with local tray balloons.
- Automatic bug logging and event cascade triggering upon monitor failure.
- Live diagnostic status server hosted on port 7700.

### Modified — owl_daemon (JavaScript Daemon)
- Auto-triggers QA regression runs when python or javascript files change.
- Automated screenshot directory manager to clean old files.
- Catches git commits to queue predictive bug checks.

### Modified — owl_memory (JavaScript Server)
- Schema upgrades: Added 12 new QA tables to support predictions, healing logs, device registries, and health score logs.
- Added `runQADreamCycle` helper for test fitness and bug pattern crystallization.

---

## [1.0.0] — 2026-06-06

### The first public release.

### Added — owl-memory (Node.js, 55+ tools)
- 6 memory types: Episodic, Semantic, Procedural, Somatic, Transactive, Working
- BERT-NER entity extraction (local, quantized, no API)
- 384-dimensional vector embeddings (local, quantized, no API)
- Hybrid BM25 + vector retrieval with cross-encoder reranking
- Mood-congruent retrieval (emotional state biases search results)
- **Hallucination Firewall (Turing)**: real-time AI claim vs stored ground truth checker
- **Cognitive Biorhythm (Pythagoras)**: personal crash-window tracker by hour and day
- **Cargo Cult Detector (Feynman)**: flags copy-pasted code with no stored rationale
- **Constitutional Violation Checker (Tata)**: mandatory project coding rules enforced per-file
- **Executable Bug Vaccines**: auto-generated sandboxed JS programs that scan future code
- **P2P Cognitive Mesh (Berners-Lee)**: UDP multicast LAN-based anonymous bug sharing
- Dream Cycle: idle-time consolidation, sandbox mutation, duplicate merging, schema abstraction
- Self-Optimizing Constants: dream cycle mutates its own physics each run
- Einstein Relativistic Gravity ranking
- Tesla Resonance Wave Propagation through call graphs
- Thiel Contradiction Detection
- Musk Error Harvesting (surprise-gated, branch-aware salience)
- Naval Refactoring Hotspots
- Tata Dependency Stewardship
- Torvalds Chrono-Pruner
- Da Vinci Anatomical Path visualization
- Feynman Abstraction Ladder (5 levels)
- Memory Crystals
- Harmonic Analysis
- Stigmergy Pheromone Trails
- Predictive Context Cache
- Cognitive Fingerprint
- Session Resurrection
- Token Ledger
- Semantic Distillation Engine
- Cross-Project Knowledge Transfer
- Specific Knowledge Crystals
- Git-Native Memory Trees
- D3.js Pythagorean Crystal visualization (interactive, live)
- Memory Reconsolidation (Einstein Observer Effect)
- Decision Engine with Pre-Mortem

### Added — owl-research (Python, 9 tools)
- `research_quick`, `research_deep`, `research_compare`, `research_synthesize`
- `extract_article`, `research_follow_up`, `research_on_file`, `research_first_principles`
- `get_research_history`
- Memory-First Research Gate: checks memory at 0.80 confidence before any web call
- Evolutionary Query Templates: promotes high-quality search patterns over time
- All research auto-stored in owl-memory SQLite

### Added — owl-web (Python, 10 tools)
- `web_fetch`, `web_fetch_stealthy` (Cloudflare bypass), `web_fetch_dynamic`
- `web_scrape_adaptive` (survives site redesigns), `web_batch_fetch`
- `web_extract_structured`, `web_diff`, `web_monitor_start`
- `web_session_scrape`, `web_research_crawl`
- Domain Temporal Freshness (exponential decay per domain category)
- Domain Trust Ledger (source quality tracking)
- Semantic Change Classification
- Tesla Resonant Monitoring Frequency adaptation

### Added — Infrastructure
- `owl_gateway.py`: Universal HTTP/SSE gateway on port 3710
- `owl_daemon.js`: Background watcher (file events, dream cycle trigger)
- `owl_mesh.js`: P2P LAN cognitive mesh
- `owl_shared_intelligence.py`: Shared DB bridge across all three servers
- Single SQLite database shared by all three servers

---

*Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).*
