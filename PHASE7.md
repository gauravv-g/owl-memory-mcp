# OWL MCP Engineering Team — Phase 7

## Agent Feedback Loop

### What Changed

Phases 5-6 were half a system: nexus could plan and execute auto-tasks, but
agent-delegated tasks were fire-and-forget. There was no way for the agent
to report back results. Phase 7 closes the loop with 3 new tools.

### New Tools

**`nexus_run`** — Full lifecycle in one call:
  1. Plans the goal (like nexus_plan)
  2. Executes auto-executable tasks (analyze, build, test, review, deploy)
  3. Returns a report of agent-delegated tasks needing attention

Pass `graph_id` to continue an existing graph.

**`nexus_update_task`** — Agent calls this to report back:
  - Updates task status (completed / failed / in_progress)
  - Stores agent outputs (files modified, summary, artifacts)
  - Adjusts graph counters (completed_tasks, failed_tasks)
  - Handles counter corrections (undo done→not-done, etc.)

**`nexus_report`** — Progress dashboard:
  - Completed tasks with types
  - Failed tasks with errors
  - Tasks needing agent attention (unblocked, with delegation context)
  - Blocked tasks (waiting for dependencies)
  - In-progress tasks

### Agent Workflow

```
nexus_run("build a web app")
  → auto-executes: analyze, design
  → returns report with: code_backend, code_frontend (unblocked, parallel)
                         integration (blocked, needs BE+FE)
                         test (blocked, needs integration)
                         verify (blocked, needs test)

agent reads report → writes backend code
  → nexus_update_task(task_id, "completed", outputs={...})

agent writes frontend code (was parallel with backend)
  → nexus_update_task(task_id, "completed", outputs={...})

nexus_report → now integration is unblocked
agent integrates → nexus_update_task

... continues until all tasks done

nexus_verify → checks all outputs
nexus_save_template → saves successful workflow
```

### Design Decisions

1. **Async by default** — nexus_run returns immediately. It doesn't block
   waiting for agent input. The agent polls with nexus_report.

2. **Counter corrections** — update_task handles status transitions correctly:
   completed→failed decrements completed_tasks and increments failed_tasks.

3. **Delegation context** — nexus_report includes upstream results so the
   agent has full context for each task without re-querying.

4. **Graph continuation** — nexus_run with graph_id re-executes and returns
   fresh report. Agent can call this after each update_task to see newly
   unblocked tasks.

### Lines

owl_nexus_mcp.py: 1066 lines (was 881)

### Test Results

Review flow: 3/3 auto-completed, report shows 0 agent tasks needed
Fullstack flow: 7/7 graph, agent feedback loop tested end-to-end
Update task: status transitions correct, counters update properly

Version: Phase 7
