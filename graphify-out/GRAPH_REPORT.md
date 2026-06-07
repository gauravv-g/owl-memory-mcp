# Graph Report - .  (2026-06-05)

## Corpus Check
- 38 files · ~101,135 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 482 nodes · 628 edges · 32 communities (31 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Python Memory Implementation|Python Memory Implementation]]
- [[_COMMUNITY_JS Memory v3.1 Engine|JS Memory v3.1 Engine]]
- [[_COMMUNITY_JS Memory v4.0 Engine|JS Memory v4.0 Engine]]
- [[_COMMUNITY_JS Memory v3.2 Engine|JS Memory v3.2 Engine]]
- [[_COMMUNITY_JS Memory v3.0 Engine|JS Memory v3.0 Engine]]
- [[_COMMUNITY_v3 JS Test Suite|v3 JS Test Suite]]
- [[_COMMUNITY_JS Memory v2.0 Engine|JS Memory v2.0 Engine]]
- [[_COMMUNITY_Pody Context Documentation|Pody Context Documentation]]
- [[_COMMUNITY_v3.0 Hybrid Search Engine|v3.0 Hybrid Search Engine]]
- [[_COMMUNITY_NPM Package Dependencies|NPM Package Dependencies]]
- [[_COMMUNITY_Memory Helper Functions|Memory Helper Functions]]
- [[_COMMUNITY_v4 Comprehensive Test Suite|v4 Comprehensive Test Suite]]
- [[_COMMUNITY_v4 Final Test Suite|v4 Final Test Suite]]
- [[_COMMUNITY_v4 Proof Test Suite|v4 Proof Test Suite]]
- [[_COMMUNITY_v4 Quick Test Suite|v4 Quick Test Suite]]
- [[_COMMUNITY_Retrieval Benchmark Suite|Retrieval Benchmark Suite]]
- [[_COMMUNITY_E2E Integration Test Suite|E2E Integration Test Suite]]
- [[_COMMUNITY_Final Verification Test Suite|Final Verification Test Suite]]
- [[_COMMUNITY_Graph UI Test Suite|Graph UI Test Suite]]
- [[_COMMUNITY_Graph UI 2 Test Suite|Graph UI 2 Test Suite]]
- [[_COMMUNITY_Graph UI 3 Test Suite|Graph UI 3 Test Suite]]
- [[_COMMUNITY_Graph UI 4 Test Suite|Graph UI 4 Test Suite]]
- [[_COMMUNITY_NER Extraction Test Suite|NER Extraction Test Suite]]
- [[_COMMUNITY_NER Debug Test Suite|NER Debug Test Suite]]
- [[_COMMUNITY_Vector E2E Test Suite|Vector E2E Test Suite]]
- [[_COMMUNITY_v3.1 Build Patch Script|v3.1 Build Patch Script]]
- [[_COMMUNITY_Core Memory Flow Methods|Core Memory Flow Methods]]
- [[_COMMUNITY_Vector Debug Script|Vector Debug Script]]
- [[_COMMUNITY_Vector Quick Script|Vector Quick Script]]
- [[_COMMUNITY_Vector Store Script|Vector Store Script]]
- [[_COMMUNITY_Vector Basic Script|Vector Basic Script]]

## God Nodes (most connected - your core abstractions)
1. `str` - 17 edges
2. `get_db()` - 16 edges
3. `runTests()` - 12 edges
4. `remember()` - 11 edges
5. `recall()` - 9 edges
6. `str` - 9 edges
7. `MCPClient` - 9 edges
8. `update_memory()` - 7 edges
9. `cli_mode()` - 7 edges
10. `extract_entities()` - 6 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core Memory Architecture Components** — concept_episodic_memory, concept_semantic_memory, concept_procedural_memory [INFERRED 0.85]
- **Brain-Inspired Memory Management** — concept_memory_palace, concept_dream_consolidation, concept_temporal_traceback [INFERRED 0.85]
- **Advanced Search and Extraction Engine** — concept_hybrid_recall, concept_sqlite_vec_integration, concept_local_ner_bert [INFERRED 0.85]
- **Interactive Force-Directed Memory Graph UI Suite** — graph_ui_preview, concept_mcp_app_ui, test_graph_ui, test_graph_ui2, test_graph_ui3, test_graph_ui4 [INFERRED 0.85]
- **Vector Search and Storage Testing Suite** — test_vec, test_vec_debug, test_vec_quick, test_vec_store, test_vector_e2e [INFERRED 0.85]

## Communities (32 total, 1 thin omitted)

### Community 0 - "Python Memory Implementation"
Cohesion: 0.09
Nodes (46): bool, Connection, float, calculate_ttl(), cleanup_expired(), cli_mode(), compute_importance(), detect_contradictions() (+38 more)

### Community 1 - "JS Memory v3.1 Engine"
Cohesion: 0.05
Nodes (28): changes, code, fs, input, output, path, calculateSimilarity(), {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} (+20 more)

### Community 2 - "JS Memory v4.0 Engine"
Cohesion: 0.07
Nodes (29): Cross-Encoder Reranking Heuristic, Local NER extraction via BERT, MCP App Force-Directed Graph UI, Memory Retrieval Benchmarking Suite, Sqlite-Vec Integration, Temporal Traceback & Episodic Replay, calculateSimilarity(), {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} (+21 more)

### Community 3 - "JS Memory v3.2 Engine"
Cohesion: 0.08
Nodes (23): calculateSimilarity(), {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
}, consolidateMemories(), crypto, DATA_DIR, Database, db, extractEntities() (+15 more)

### Community 4 - "JS Memory v3.0 Engine"
Cohesion: 0.10
Nodes (17): calculateSimilarity(), {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
}, consolidateMemories(), crypto, DATA_DIR, Database, db, extractEntities() (+9 more)

### Community 5 - "v3 JS Test Suite"
Cohesion: 0.14
Nodes (15): assert(), assertEqual(), assertHas(), assertInRange(), DB_PATH, fs, log(), MCPClient (+7 more)

### Community 6 - "JS Memory v2.0 Engine"
Cohesion: 0.10
Nodes (18): Dream Consolidation & Decay Heuristic, Episodic Memory, Memory Palace Heuristic, Procedural Memory, Semantic Memory, calculateSimilarity(), { CallToolRequestSchema, ListToolsRequestSchema }, consolidateMemories() (+10 more)

### Community 7 - "Pody Context Documentation"
Cohesion: 0.13
Nodes (21): get_conventions(), get_doc_locations(), get_file_tree(), get_monetization_model(), get_project_overview(), get_release_plan(), get_tech_stack(), list_project_files() (+13 more)

### Community 8 - "v3.0 Hybrid Search Engine"
Cohesion: 0.11
Nodes (12): Hybrid Search Recall (BM25 + Vector), {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
}, crypto, DATA_DIR, Database, db, fs, generateEmbedding() (+4 more)

### Community 9 - "NPM Package Dependencies"
Cohesion: 0.12
Nodes (16): author, dependencies, better-sqlite3, @modelcontextprotocol/sdk, sqlite-vec, sqlite-vec-windows-x64, @xenova/transformers, description (+8 more)

### Community 10 - "Memory Helper Functions"
Cohesion: 0.13
Nodes (9): { CallToolRequestSchema, ListToolsRequestSchema }, crypto, DATA_DIR, Database, db, fs, path, { Server } (+1 more)

### Community 11 - "v4 Comprehensive Test Suite"
Cohesion: 0.22
Nodes (12): assert(), DB_PATH, fs, getText(), main(), os, parse(), path (+4 more)

### Community 12 - "v4 Final Test Suite"
Cohesion: 0.22
Nodes (12): assert(), DB_PATH, fs, main(), os, parse(), parseTool(), path (+4 more)

### Community 13 - "v4 Proof Test Suite"
Cohesion: 0.21
Nodes (12): DB_PATH, fs, main(), os, path, PR(), PT(), results (+4 more)

### Community 14 - "v4 Quick Test Suite"
Cohesion: 0.21
Nodes (12): DB_PATH, fs, main(), os, path, PR(), PT(), results (+4 more)

### Community 15 - "Retrieval Benchmark Suite"
Cohesion: 0.20
Nodes (11): DB_PATH, fs, main(), MEMORIES, os, path, QUERIES, scoreResults() (+3 more)

### Community 16 - "E2E Integration Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 17 - "Final Verification Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 18 - "Graph UI Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 19 - "Graph UI 2 Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 20 - "Graph UI 3 Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 21 - "Graph UI 4 Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 22 - "NER Extraction Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 23 - "NER Debug Test Suite"
Cohesion: 0.25
Nodes (8): DB_PATH, fs, main(), os, path, sendRPC(), SERVER, { spawn }

### Community 24 - "Vector E2E Test Suite"
Cohesion: 0.25
Nodes (6): db, embeddings, fs, memories, path, queries

### Community 25 - "v3.1 Build Patch Script"
Cohesion: 0.29
Nodes (6): code, { execSync }, fs, inputPath, outputPath, path

### Community 26 - "Core Memory Flow Methods"
Cohesion: 0.50
Nodes (5): calculateSimilarity(), consolidateMemories(), extractEntities(), generateId(), progressDevelopmentalStage()

### Community 27 - "Vector Debug Script"
Cohesion: 0.40
Nodes (4): db, info, path, rows

### Community 28 - "Vector Quick Script"
Cohesion: 0.40
Nodes (3): db, fs, path

### Community 29 - "Vector Store Script"
Cohesion: 0.40
Nodes (3): db, fs, path

## Knowledge Gaps
- **212 isolated node(s):** `fs`, `path`, `input`, `output`, `code` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Local NER extraction via BERT` connect `JS Memory v4.0 Engine` to `JS Memory v3.2 Engine`?**
  _High betweenness centrality (0.216) - this node is a cross-community bridge._
- **Why does `Sqlite-Vec Integration` connect `JS Memory v4.0 Engine` to `v3.0 Hybrid Search Engine`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `Hybrid Search Recall (BM25 + Vector)` connect `v3.0 Hybrid Search Engine` to `JS Memory v4.0 Engine`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `input` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Python Memory Implementation` be split into smaller, more focused modules?**
  _Cohesion score 0.08788159111933395 - nodes in this community are weakly interconnected._
- **Should `JS Memory v3.1 Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.0545876887340302 - nodes in this community are weakly interconnected._
- **Should `JS Memory v4.0 Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.06612685560053981 - nodes in this community are weakly interconnected._