"""
OWL Agent MCP Server — Multi-Agent Orchestration
==================================================
Coordinate multiple AI agents working on a single task.
Spawn workers, distribute work, merge results, resolve conflicts.

Tools (8):
  agent_spawn        — Spawn a sub-agent with a specific task
  agent_status       — Check status of running sub-agents
  agent_collect      — Collect results from completed agents
  agent_merge        — Merge results from multiple agents
  agent_plan         — Create a multi-agent execution plan
  agent_execute_plan — Execute a multi-agent plan
  agent_cancel       — Cancel a running sub-agent
  agent_history      — View history of agent executions

Dependencies: Python 3.11+
"""

import asyncio
import json
import os
import sys
import time
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

# ─── Agent Registry (in-process) ──────────────────────────────────────────────

_agents = {}  # agent_id -> agent info
_agent_results = {}  # agent_id -> results
_agent_history = []  # list of past agent executions
_max_agents = 10


def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"


def _gen_id():
    return f"agent_{uuid.uuid4().hex[:12]}"


# ─── Tool Handlers ────────────────────────────────────────────────────────────

async def handle_spawn(args: dict) -> dict:
    """Spawn a sub-agent with a specific task."""
    task = args.get("task", "")
    agent_type = args.get("type", "worker")  # worker, reviewer, researcher, coder
    timeout = args.get("timeout", 300)
    context = args.get("context", {})
    dependencies = args.get("dependencies", [])  # agent_ids this depends on

    if not task:
        return {"error": "task is required"}

    if len(_agents) >= _max_agents:
        return {"error": f"max agents ({_max_agents}) reached", "active_agents": len(_agents)}

    agent_id = _gen_id()

    agent_info = {
        "id": agent_id,
        "type": agent_type,
        "task": task,
        "status": "spawning",
        "created_at": _now(),
        "timeout": timeout,
        "context": context,
        "dependencies": dependencies,
        "result": None,
        "error": None,
        "started_at": None,
        "completed_at": None,
    }

    _agents[agent_id] = agent_info

    # In a real implementation, this would spawn an actual subprocess or API call
    # For MCP, we return the agent spec and let the orchestrator handle execution
    agent_info["status"] = "pending"

    return {
        "agent_id": agent_id,
        "status": "spawned",
        "type": agent_type,
        "task": task[:200],
        "message": f"Agent {agent_id} spawned. Use agent_status to check progress."
    }


async def handle_status(args: dict) -> dict:
    """Check status of running sub-agents."""
    agent_id = args.get("agent_id", "")

    if agent_id:
        agent = _agents.get(agent_id)
        if not agent:
            return {"error": f"agent not found: {agent_id}"}
        return {"agent": agent}

    # Return all agents
    active = []
    pending = []
    completed = []
    failed = []

    for aid, info in _agents.items():
        if info["status"] in ("spawning", "running"):
            active.append({"id": aid, "type": info["type"], "task": info["task"][:100]})
        elif info["status"] == "pending":
            pending.append({"id": aid, "type": info["type"], "task": info["task"][:100]})
        elif info["status"] == "completed":
            completed.append({"id": aid, "type": info["type"]})
        elif info["status"] == "failed":
            failed.append({"id": aid, "type": info["type"], "error": info.get("error", "")})

    return {
        "total_agents": len(_agents),
        "active": active,
        "pending": pending,
        "completed": completed,
        "failed": failed
    }


async def handle_collect(args: dict) -> dict:
    """Collect results from completed agents."""
    agent_ids = args.get("agent_ids", [])

    if not agent_ids:
        # Collect all completed
        agent_ids = [aid for aid, info in _agents.items() if info["status"] == "completed"]

    results = {}
    missing = []
    for aid in agent_ids:
        agent = _agents.get(aid)
        if not agent:
            missing.append(aid)
        elif agent["status"] == "completed":
            results[aid] = {
                "type": agent["type"],
                "result": agent.get("result"),
                "completed_at": agent.get("completed_at")
            }
        else:
            results[aid] = {
                "type": agent["type"],
                "status": agent["status"],
                "message": f"Agent {aid} is {agent['status']}, not completed"
            }

    return {
        "results": results,
        "missing_agents": missing,
        "collected": len([r for r in results.values() if "result" in r])
    }


async def handle_merge(args: dict) -> dict:
    """Merge results from multiple agents."""
    agent_ids = args.get("agent_ids", [])
    strategy = args.get("strategy", "union")  # union, intersection, priority, vote

    if not agent_ids:
        return {"error": "agent_ids required"}

    results = []
    for aid in agent_ids:
        agent = _agents.get(aid)
        if agent and agent.get("result"):
            results.append({"agent_id": aid, "type": agent["type"], "result": agent["result"]})

    if not results:
        return {"error": "no results to merge"}

    merged = None
    conflicts = []

    if strategy == "union":
        # Combine all unique results
        if all(isinstance(r["result"], dict) for r in results):
            merged = {}
            for r in results:
                for k, v in r["result"].items():
                    if k in merged and merged[k] != v:
                        conflicts.append({"key": k, "values": [merged[k], v]})
                    merged[k] = v
        elif all(isinstance(r["result"], list) for r in results):
            seen = set()
            merged = []
            for r in results:
                for item in r["result"]:
                    key = json.dumps(item, sort_keys=True) if isinstance(item, dict) else str(item)
                    if key not in seen:
                        seen.add(key)
                        merged.append(item)
        else:
            merged = results[0]["result"]

    elif strategy == "priority":
        # Use highest priority agent type
        priority = {"reviewer": 3, "researcher": 2, "coder": 2, "worker": 1}
        sorted_results = sorted(results, key=lambda r: priority.get(r["type"], 0), reverse=True)
        merged = sorted_results[0]["result"]

    elif strategy == "vote":
        # Majority vote for conflicting values
        if all(isinstance(r["result"], dict) for r in results):
            merged = {}
            all_keys = set()
            for r in results:
                all_keys.update(r["result"].keys())
            for key in all_keys:
                values = [r["result"].get(key) for r in results if key in r["result"]]
                if values:
                    # Most common value
                    from collections import Counter
                    counter = Counter(json.dumps(v, sort_keys=True) if isinstance(v, dict) else str(v) for v in values)
                    most_common = counter.most_common(1)[0][0]
                    merged[key] = json.loads(most_common) if most_common.startswith("{") else most_common

    return {
        "merged_result": merged,
        "strategy": strategy,
        "agents_merged": len(results),
        "conflicts": conflicts,
        "conflict_count": len(conflicts)
    }


async def handle_plan(args: dict) -> dict:
    """Create a multi-agent execution plan."""
    goal = args.get("goal", "")
    max_agents = args.get("max_agents", 4)
    strategy = args.get("strategy", "decompose")  # decompose, parallel, pipeline

    if not goal:
        return {"error": "goal is required"}

    # Generate a plan based on the goal
    plan = {
        "plan_id": f"plan_{uuid.uuid4().hex[:8]}",
        "goal": goal,
        "strategy": strategy,
        "created_at": _now(),
        "steps": []
    }

    if strategy == "decompose":
        # Break goal into subtasks
        plan["steps"] = [
            {
                "step": 1,
                "agent_type": "researcher",
                "task": f"Research and gather information about: {goal}",
                "dependencies": []
            },
            {
                "step": 2,
                "agent_type": "coder",
                "task": f"Implement solution for: {goal}",
                "dependencies": [1]
            },
            {
                "step": 3,
                "agent_type": "reviewer",
                "task": f"Review and validate the implementation for: {goal}",
                "dependencies": [2]
            }
        ]

    elif strategy == "parallel":
        # Split into parallel workstreams
        plan["steps"] = [
            {"step": 1, "agent_type": "worker", "task": f"Part 1 of: {goal}", "dependencies": []},
            {"step": 2, "agent_type": "worker", "task": f"Part 2 of: {goal}", "dependencies": []},
            {"step": 3, "agent_type": "worker", "task": f"Part 3 of: {goal}", "dependencies": []},
            {"step": 4, "agent_type": "reviewer", "task": f"Merge and validate results for: {goal}", "dependencies": [1, 2, 3]}
        ]

    elif strategy == "pipeline":
        # Sequential pipeline
        plan["steps"] = [
            {"step": 1, "agent_type": "researcher", "task": f"Analyze requirements for: {goal}", "dependencies": []},
            {"step": 2, "agent_type": "coder", "task": f"Design architecture for: {goal}", "dependencies": [1]},
            {"step": 3, "agent_type": "coder", "task": f"Implement core for: {goal}", "dependencies": [2]},
            {"step": 4, "agent_type": "reviewer", "task": f"Test and review: {goal}", "dependencies": [3]}
        ]

    plan["total_steps"] = len(plan["steps"])
    plan["estimated_agents"] = min(len(plan["steps"]), max_agents)

    return plan


async def handle_execute_plan(args: dict) -> dict:
    """Execute a multi-agent plan."""
    plan = args.get("plan", {})
    if not plan:
        return {"error": "plan is required"}

    steps = plan.get("steps", [])
    if not steps:
        return {"error": "plan has no steps"}

    spawned = []
    for step in steps:
        agent_type = step.get("agent_type", "worker")
        task = step.get("task", "")
        deps = step.get("dependencies", [])

        # Map dependency step numbers to agent IDs
        dep_ids = []
        for dep_step in deps:
            for s in spawned:
                if s["step"] == dep_step:
                    dep_ids.append(s["agent_id"])

        result = await handle_spawn({
            "task": task,
            "type": agent_type,
            "dependencies": dep_ids
        })

        spawned.append({
            "step": step.get("step", 0),
            "agent_id": result.get("agent_id", ""),
            "type": agent_type,
            "task": task[:100]
        })

    return {
        "plan_id": plan.get("plan_id", ""),
        "status": "executing",
        "agents_spawned": len(spawned),
        "agents": spawned,
        "message": f"Plan executing with {len(spawned)} agents. Use agent_status to monitor."
    }


async def handle_cancel(args: dict) -> dict:
    """Cancel a running sub-agent."""
    agent_id = args.get("agent_id", "")
    if not agent_id:
        return {"error": "agent_id required"}

    agent = _agents.get(agent_id)
    if not agent:
        return {"error": f"agent not found: {agent_id}"}

    if agent["status"] in ("completed", "failed"):
        return {"error": f"agent already in terminal state: {agent['status']}"}

    agent["status"] = "cancelled"
    agent["completed_at"] = _now()

    # Add to history
    _agent_history.append({
        "agent_id": agent_id,
        "type": agent["type"],
        "task": agent["task"][:100],
        "status": "cancelled",
        "timestamp": _now()
    })

    return {"agent_id": agent_id, "status": "cancelled"}


async def handle_history(args: dict) -> dict:
    """View history of agent executions."""
    limit = args.get("limit", 20)
    agent_type = args.get("type", "")  # filter by type

    history = _agent_history
    if agent_type:
        history = [h for h in history if h.get("type") == agent_type]

    return {
        "total_history": len(_agent_history),
        "returned": min(limit, len(history)),
        "history": history[-limit:]
    }


# ─── Server Setup ─────────────────────────────────────────────────────────────

server = Server("owl-agent")

ALL_TOOLS = [
    ("agent_spawn", "Spawn a sub-agent with a specific task", handle_spawn),
    ("agent_status", "Check status of running sub-agents", handle_status),
    ("agent_collect", "Collect results from completed agents", handle_collect),
    ("agent_merge", "Merge results from multiple agents", handle_merge),
    ("agent_plan", "Create a multi-agent execution plan", handle_plan),
    ("agent_execute_plan", "Execute a multi-agent plan", handle_execute_plan),
    ("agent_cancel", "Cancel a running sub-agent", handle_cancel),
    ("agent_history", "View history of agent executions", handle_history),
]

@server.list_tools()
async def list_tools() -> List[Tool]:
    return [Tool(name=n, description=d, inputSchema={"type": "object", "properties": {}, "additionalProperties": True})
            for n, d, _ in ALL_TOOLS]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    handler_map = {n: h for n, _, h in ALL_TOOLS}
    handler = handler_map.get(name)
    if not handler:
        return [TextContent(type="text", text=json.dumps({"error": f"unknown tool: {name}"}))]
    try:
        result = await handler(arguments)
        return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
