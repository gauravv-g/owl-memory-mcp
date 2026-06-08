"""
OWL QA Economics MCP Server
Generates prioritized bug-fixing queues based on technical debt ROI.
"""
import json
import os
import sqlite3
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

_QA_DB_PATH = os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-observations.db")


def get_prioritized_queue(project: str = "default") -> dict:
    """Return a prioritized queue of bugs/issues for the given project.

    Priority is calculated as: severity * frequency / fix_effort_estimate
    Falls back gracefully if the database or tables don't exist yet.
    """
    queue = []

    db_paths = [
        _QA_DB_PATH,
        os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-economics.db"),
    ]

    for db_path in db_paths:
        if not os.path.exists(db_path):
            continue
        try:
            conn = sqlite3.connect(db_path, timeout=5)
            conn.row_factory = sqlite3.Row

            tables_to_try = [
                ("qa_bugs", "id, title, severity, frequency, status, project"),
                ("bugs", "id, title, severity, frequency, status, project"),
                ("qa_observations", "id, url, created_at, project"),
            ]

            for table, cols in tables_to_try:
                try:
                    rows = conn.execute(
                        f"SELECT {cols} FROM {table} WHERE project=? ORDER BY severity DESC, frequency DESC LIMIT 50",
                        (project,)
                    ).fetchall()
                    for row in rows:
                        queue.append(dict(row))
                    if queue:
                        conn.close()
                        return {"project": project, "queue": queue, "total": len(queue)}
                except Exception:
                    continue

            conn.close()
        except Exception:
            continue

    # Fallback: scan QA screenshot directory for recent observations
    screenshot_dir = os.path.join(os.path.expanduser("~"), ".owl-memory", "qa-screenshots")
    recent_observations = []
    if os.path.isdir(screenshot_dir):
        files = sorted(
            [f for f in os.listdir(screenshot_dir) if f.endswith((".webp", ".png"))],
            key=lambda f: os.path.getmtime(os.path.join(screenshot_dir, f)),
            reverse=True
        )[:20]
        recent_observations = [{"file": f} for f in files]

    return {
        "project": project,
        "queue": queue,
        "total": len(queue),
        "note": "No QA economics database found yet. Run qa_load_test or qa_test_flow to populate.",
        "recent_screenshots": recent_observations
    }


def compute_debt_roi(queue: list) -> list:
    """Compute technical debt ROI for each item: severity * frequency / fix_effort."""
    results = []
    for item in queue:
        severity = float(item.get("severity", 5))
        frequency = float(item.get("frequency", 1))
        effort = float(item.get("fix_effort", 5))
        roi = round(severity * frequency / max(effort, 0.1), 2)
        results.append({**item, "debt_roi": roi})
    return sorted(results, key=lambda x: x.get("debt_roi", 0), reverse=True)


# ─── MCP Server ──────────────────────────────────────────────────────────────

server = Server("owl-qa-economics")

TOOLS = [
    Tool(
        name="qa_economics_report",
        description="Compile priorities and trends for system quality, active bugs, and debt ROI.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "default": "default"}
            }
        }
    ),
    Tool(
        name="qa_economics_queue",
        description="Return a raw prioritized queue of bugs from the QA database.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "default": "default"}
            }
        }
    ),
    Tool(
        name="qa_economics_debt_roi",
        description="Compute debt ROI score for each bug (severity * frequency / fix_effort) and sort by ROI descending.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "default": "default"}
            }
        }
    ),
]


@server.list_tools()
async def list_tools():
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    project = arguments.get("project", "default")

    if name == "qa_economics_report":
        queue = get_prioritized_queue(project)
        debt_roi = compute_debt_roi(queue.get("queue", []))
        output = {"summary": f"{queue['total']} items in queue", "top_by_roi": debt_roi[:10], "raw": queue}
        return [TextContent(type="text", text=json.dumps(output, indent=2))]

    elif name == "qa_economics_queue":
        result = get_prioritized_queue(project)
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "qa_economics_debt_roi":
        queue = get_prioritized_queue(project)
        debt_roi = compute_debt_roi(queue.get("queue", []))
        return [TextContent(type="text", text=json.dumps(debt_roi, indent=2))]

    else:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
