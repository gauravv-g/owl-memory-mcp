# OWL MCP Engineering Team — Phase 6

## Project-Aware Orchestration + Dual Dispatch Strategy

### What Changed

Phase 5 called ALL tasks via subprocess MCP dispatch. This was wrong for
code-generation tasks that need LLM reasoning. Phase 6 splits tasks into
two categories:

**Category A — Auto-executable** (subprocess dispatch):
`analyze`, `design`, `build`, `test`, `review`, `etl`, `schema`, `migrate`, `deploy`

These tools run deterministically — no LLM needed. nexus spawns the
MCP server subprocess and returns structured results.

**Category B — Agent-delegated** (rich context for LLM):
`code_backend`, `code_frontend`, `code_fix`, `integration`, `report`, `execute`, `plan`

These need the LLM agent to reason, write code, and make decisions.
nexus returns rich delegation context with project_path, upstream
results, and specific delegation hints.

### New Parameter

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| project_path | string | "." | Target directory for tool execution |

### Args Builders

Each auto-executable task has a dedicated args_builder function that
receives `(task, wave_results, project_path)` and returns tool-specific
arguments. Context from upstream dependency outputs is automatically
injected.

### Key Architecture Decisions

1. **Don't use subprocess for code writing** — `code_execute` with stub code
   is useless. Agent-delegated tasks return context for the LLM to act on.

2. **project_path matters** — Tools operate on a specific directory.
   `handle_execute` accepts `project_path` and passes it to all args builders.

3. **Dual-mode output** — Task outputs include `mode: "async_executed"` for
   auto-executable tasks, `mode: "agent_delegated"` for delegation tasks.

### Results

Review flow (3 tasks, all auto-executable):
  3/3 completed, 3 waves, all via subprocess

Fullstack flow (7 tasks, mixed):
  7/7 completed, 6 waves
  Wave 2: code_backend + code_frontend run in parallel (agent-delegated)
  analyze, design, test run as real subprocess tool calls

### Lines

owl_nexus_mcp.py: 881 lines (was 821)

Version: Phase 6
