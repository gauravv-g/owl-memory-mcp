# OWL Memory MCP v4.0 — The Anticipatory Memory Engine

OWL Memory is a local, SQLite-backed Model Context Protocol (MCP) server that provides a reasoning-oriented memory substrate for AI assistants (Claude, Cursor, Codex, Hermes, and standalone).

Instead of treating memory as a dry list of facts, OWL Memory acts as an active partner that remembers, warns, reasons, and maps code structure.

---

## Key Capabilities

*   **6 Memory Types**:
    *   *Episodic*: Dynamic history of developer interactions and observations.
    *   *Semantic*: Abstracted schemas and facts.
    *   *Procedural*: Stored development skills and practice counts.
    *   *Somatic*: Emotional valence and arousal tracking for entities.
    *   *Transactive*: Records who knows what across multiple agents.
    *   *Working Memory*: A active 4-chunk context window.
*   **Static Code Intelligence**:
    *   *AST Scanner*: Extracts files, classes, and function definitions recursively.
    *   *Call Graph Edges*: Maps function calls and import relationships.
    *   *Shortest Call Paths*: BFS traversal to trace call and import chains.
    *   *Modularity Clustering*: Local Label Propagation to group modules.
    *   *AST-Linked Reviews*: Surfaced past bugs tied directly to specific code functions during code reviews.
*   **Live Reasoning Layer**:
    *   *Decide*: Live pre-mortems comparing options against past failures.
    *   *Warn*: Warning engine flagging risks from past errors in planned actions.
    *   *Why*: Causal traceback query stepping backward through related historical events.
    *   *Transfer*: Analogy engine that adapts stored skills to new domains.
*   **Zero API Cost**: RunsCPU-quantized vector embedding (`all-MiniLM-L6-v2`) and NER token classification (`bert-base-NER`) models locally on your machine.

---

## Token Cost Reduction Proof

As conversation history grows in a coding session, context tokens accumulate exponentially. OWL Memory solves this by keeping your prompt window clean, loading only the most relevant memories.

Assume a standard coding session of 40 conversation turns:

1.  **Without Memory (Full Context)**:
    $$\text{Total Tokens} = \sum_{n=1}^{40} (n \times 2,500) = 2,050,000\text{ tokens}$$
    At $\$3.00$ per million input tokens, the cost is **$\$6.15$**.
2.  **With Memory (Dynamic Recall)**:
    $$\text{Total Tokens} = 40 \times (500\text{ query} + 1,000\text{ recalled memory}) = 60,000\text{ tokens}$$
    At $\$3.00$ per million input tokens, the cost is **$\$0.18$**.

**Net Savings**: **$97.07\%$** cost reduction and faster processing.

---

## Installation

### Prerequisites
*   [Node.js](https://nodejs.org/) installed.
*   Windows C++ Build Tools (required for compiling native SQLite bindings).

### Setup
Clone the repository and install the dependencies:
```bash
git clone https://github.com/your-username/owl-memory-mcp.git
cd owl-memory-mcp
npm install
```

---

## MCP Tool Reference

OWL Memory exposes 47 tools. Here are the core ones:

### Codebase Graph Tools
*   `index_codebase`: Scans and parses files recursively to extract dependencies, imports, classes, and function calls.
    *   *Arguments*: `scan_path` (string, path to folder)
*   `query_codebase`: Queries extracted code nodes (files, classes, functions) by name similarity.
    *   *Arguments*: `query` (string), `node_type` (string: `file`, `class`, `function`, `all`)
*   `code_path`: Traces call paths or import dependencies between two code nodes.
    *   *Arguments*: `from_node` (string, ID), `to_node` (string, ID)
*   `cluster_codebase`: Groups code nodes into modular communities using local Label Propagation.

### Reasoning & Anticipatory Tools
*   `decide`: Weighs options against past decisions and failures, running pre-mortems.
    *   *Arguments*: `title` (string), `context` (string), `options` (array of strings), `chosen_option` (string)
*   `warn`: Given a planned action, flags potential pitfalls from past failures.
    *   *Arguments*: `planned_action` (string)
*   `why`: Traces root causes through memory chains back to historical events.
    *   *Arguments*: `situation` (string), `max_depth` (integer)
*   `code_review`: Analyzes proposed changes against past files, reviews, patterns, and AST-linked bug memories.
    *   *Arguments*: `file_path` (string), `change_description` (string)

---

## Configuration

### Cursor Setup
Add as a new MCP tool in Cursor:
*   **Name**: `owl-memory`
*   **Type**: `command`
*   **Command**: `node /absolute/path/to/owl_memory_v4.js`

### Claude Desktop Setup
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "owl-memory": {
      "command": "node",
      "args": ["/absolute/path/to/owl_memory_v4.js"]
    }
  }
}
```

---

## Interactive Visualization

OWL Memory exposes a live force-directed D3.js memory graph. Open your browser and navigate to:
`owl-memory://graph-ui`
This lets you visually inspect your episodic memory, linked entities, and code structures.

---

## License
MIT License. Free to use, adapt, and distribute for the world.
