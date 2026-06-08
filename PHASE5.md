# OWL MCP Engineering Team — Phase 5

## True Async Parallel Wave Execution

### What Changed

Phase 4 identified parallel waves and returned delegation hints. Phase 5 makes
`nexus_execute` a **self-executing orchestrator** that:

1. Fans out wave tasks concurrently using `asyncio.gather()` with bounded parallelism
2. Calls sibling MCP servers via subprocess JSON-RPC (MCP protocol with init handshake)
3. Propagates results between waves (Wave N outputs → Wave N+1 inputs)
4. Retries failed tasks up to `max_attempts` with immediate retry
5. Tracks template `success_rate` on save from completed graph history
6. Reports `completed_with_failures` status when partial success

### Architecture

```
nexus_plan → task graph stored in SQLite (nexus.db)
     ↓
nexus_execute → reads graph, groups into waves
     ↓
_for each wave:_ asyncio.gather() + Semaphore(max_parallel)
     ↓
_for each task:_ _call_mcp_tool(server, tool, args)
     ↓
_subprocess: python venv/server.py → MCP JSON-RPC
     ↓
_collect results, propagate, retry failures
     ↓
_update DB, return final status
```

### Task Type → MCP Tool Mapping

| Task Type | Server File | Tool |
|-----------|------------|------|
| analyze | owl_code_mcp.py | code_analyze |
| design | owl_code_mcp.py | code_explain |
| code_backend | owl_code_mcp.py | code_execute |
| code_frontend | owl_code_mcp.py | code_execute |
| code_fix | owl_code_mcp.py | code_execute |
| build | owl_code_mcp.py | code_build |
| test | owl_code_mcp.py | code_test |
| review | owl_code_mcp.py | code_review |
| etl | owl_data_mcp.py | data_etl_pipeline |
| schema | owl_data_mcp.py | data_schema_design |
| migrate | owl_data_mcp.py | data_sql_migrate |
| deploy | owl_deploy_mcp.py | deploy_docker_build |
| *other* | → delegation hint (Phase 4 fallback) |

### MCP Subprocess Protocol

Each tool call spawns a fresh MCP server subprocess:

1. Send `initialize` JSON-RPC (protocolVersion 2024-11-05)
2. Send `tools/call` JSON-RPC with tool name + arguments
3. Parse response by matching `call_id`
4. Extract text content, parse as JSON if possible
5. Return `{success, data}` or `{success: false, error}`

### Wave Execution Model

```
Wave 0: [Analyze requirements]              ← 1 task, sequential
Wave 1: [Design architecture]               ← 1 task, sequential
Wave 2: [Implement backend, Implement FE]   ← 2 tasks, PARALLEL (asyncio.gather)
Wave 3: [Integrate FE + BE]                 ← 1 task
Wave 4: [Test E2E]                          ← 1 task
Wave 5: [Verify and ship]                   ← 1 task
```

Backend and frontend run concurrently via `asyncio.gather()` because neither
depends on the other — both only need the design from Wave 1.
Total: 6 waves instead of 7 sequential steps.

### Bounded Parallelism

`Semaphore(max_parallel=3)` caps concurrent subprocesses. A wave with 5 tasks
will run 3 at a time, then 2 more.

### Retry Logic

If a task fails:
1. Increment `attempt_count`
2. If `attempt_count < max_attempts`: retry immediately
3. If retry succeeds: status = `completed_after_retry`
4. If all retries fail: status = `failed`, increments graph's `failed_tasks`

### Status Values

Added new status values:
- `retrying` → task failed attempt N, will retry
- `completed_after_retry` → task succeeded after N retries
- `completed_with_failures` → graph completed but some tasks failed

### New DB Field Usage

`workflow_templates.success_rate` is computed on save from the source graph's
completion rate: `(total_tasks - failed_tasks) / total_tasks * 100`.

`task_graphs.completed_at` is set on final status determination.

### New Parameters

No new tool parameters. Existing ones now have actual effect:

| Parameter | Type | Default | Pre-Phase 5 | Post-Phase 5 |
|-----------|------|---------|-------------|--------------|
| parallel | bool | true | Ignored (always returned waves) | Controls asyncio.gather vs sequential |
| max_parallel | int | 3 | Stored but unused | Semaphore bound on concurrency |
| dry_run | bool | false | Simulated execution | Same — no subprocess calls |

### Lines

owl_nexus_mcp.py: 813 lines (was 429)

### Future: Wave-level Retries

Current: immediate retry of failed tasks within same wave.
Next: defer failed tasks to a retry wave with exponential backoff.

### Test Results

```
7-task fullstack graph:
  Waves: 6 (vs 7 sequential)
  Completed: 7/7, Failed: 0
  Wave 2: backend + frontend run in parallel
  Total time: ~5.2s
  Verify: all_passed=True
  Template save: success_rate=100.0%
  Template reuse: 6 waves from saved template
```

Version: Phase 5
