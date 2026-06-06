#!/usr/bin/env python3
"""
OWL Universal HTTP Gateway
==========================
Runs all 3 OWL MCP servers over a single HTTP port using standard MCP SSE transport.
Any MCP client (Claude Desktop, Cursor, Antigravity, Hermes, custom agents) can connect.

Routes:
  /memory/sse   -> owl-memory  (managed node subprocess for owl_memory_v5.js)
  /web/sse      -> owl-web     (in-process python server for owl_web_mcp.py)
  /research/sse -> owl-research (in-process python server for owl_research_mcp.py)

Usage:
  python owl_gateway.py              # starts on port 3710 (default)
  python owl_gateway.py --port 3710  # explicit port

Client URLs (use these in any MCP config):
  http://localhost:3710/memory/sse
  http://localhost:3710/web/sse
  http://localhost:3710/research/sse
"""

import argparse
import asyncio
import logging
import sys
import os
import anyio
from anyio.streams.text import TextReceiveStream

# ─── Add workspace to path so we can import the Python MCP servers ────────────
WORKSPACE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKSPACE)

try:
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Route, Mount
    from starlette.requests import Request
    from starlette.responses import Response
    
    import mcp.types as types
    from mcp.shared.message import SessionMessage
    from mcp.server.sse import SseServerTransport
except ImportError as e:
    print(f"ERROR: Missing dependency — {e}")
    print("Fix: pip install starlette uvicorn sse-starlette mcp")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="[OWL GATEWAY] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ─── Load Python MCP Servers ──────────────────────────────────────────────────
def _load_server(module_name: str, server_attr: str):
    """Import a server module and return its MCP Server instance."""
    try:
        import importlib
        mod = importlib.import_module(module_name)
        srv = getattr(mod, server_attr)
        logger.info(f"Loaded {module_name}.{server_attr} OK")
        return srv
    except Exception as e:
        logger.error(f"Failed to load {module_name}: {e}")
        return None

# Load the Python-based servers
web_srv = _load_server("owl_web_mcp", "app")
research_srv = _load_server("owl_research_mcp", "server")

# ─── Create SSE Transports ───────────────────────────────────────────────────
memory_sse = SseServerTransport("/memory/messages/")
web_sse = SseServerTransport("/web/messages/")
research_sse = SseServerTransport("/research/messages/")

# ─── Request Handlers ─────────────────────────────────────────────────────────
async def handle_memory_sse(request):
    """
    Connects the client's SSE transport to a spawned Node.js process running owl_memory_v5.js.
    Forwards incoming JSON-RPC messages to stdin and reads responses from stdout.
    """
    async with memory_sse.connect_sse(
        request.scope, request.receive, request._send
    ) as (read_stream, write_stream):
        proc = None
        try:
            logger.info("Spawning Node.js memory server (owl_memory_v5.js)...")
            proc = await anyio.open_process(
                ["node", "owl_memory_v5.js"],
                cwd=WORKSPACE,
                env=os.environ
            )

            async def read_from_node():
                try:
                    async for line in TextReceiveStream(proc.stdout):
                        line_str = line.strip()
                        if not line_str:
                            continue
                        if line_str.startswith("{") and line_str.endswith("}"):
                            try:
                                message = types.JSONRPCMessage.model_validate_json(line_str)
                                await write_stream.send(SessionMessage(message))
                            except Exception as e:
                                logger.error(f"Error parsing Node stdout JSON-RPC: {e}. Raw line: {line_str}")
                        else:
                            # Log non-JSON-RPC stdout output
                            logger.info(f"[Node Stdout] {line_str}")
                except anyio.get_cancelled_class():
                    raise
                except Exception as e:
                    logger.error(f"Error reading from Node process: {e}")
                finally:
                    try:
                        await write_stream.aclose()
                    except Exception:
                        pass

            async def write_to_node():
                try:
                    async for session_msg in read_stream:
                        msg_json = session_msg.message.model_dump_json(by_alias=True, exclude_none=True)
                        await proc.stdin.send((msg_json + "\n").encode("utf-8"))
                except anyio.get_cancelled_class():
                    raise
                except Exception as e:
                    logger.error(f"Error writing to Node process: {e}")
                finally:
                    try:
                        await proc.stdin.aclose()
                    except Exception:
                        pass

            async def log_node_stderr():
                try:
                    async for line in TextReceiveStream(proc.stderr):
                        line_str = line.strip()
                        if line_str:
                            logger.warning(f"[Node Stderr] {line_str}")
                except Exception:
                    pass

            async with anyio.create_task_group() as tg:
                tg.start_soon(read_from_node)
                tg.start_soon(write_to_node)
                tg.start_soon(log_node_stderr)
                await proc.wait()
        finally:
            if proc:
                try:
                    proc.terminate()
                    await proc.wait()
                except Exception:
                    pass
                logger.info("Node.js memory server terminated.")
    return Response()

async def handle_web_sse(request):
    """Handles SSE connection for the owl-web Python server."""
    if not web_srv:
        return Response("Web server not loaded", status_code=503)
    async with web_sse.connect_sse(
        request.scope, request.receive, request._send
    ) as (read_stream, write_stream):
        await web_srv.run(
            read_stream, write_stream, web_srv.create_initialization_options()
        )
    return Response()

async def handle_research_sse(request):
    """Handles SSE connection for the owl-research Python server."""
    if not research_srv:
        return Response("Research server not loaded", status_code=503)
    async with research_sse.connect_sse(
        request.scope, request.receive, request._send
    ) as (read_stream, write_stream):
        await research_srv.run(
            read_stream, write_stream, research_srv.create_initialization_options()
        )
    return Response()

async def health_check(request: Request) -> Response:
    """Returns the current loading status and endpoints config."""
    status = {
        "owl_gateway": "running",
        "endpoints": {
            "memory": "/memory/sse",
            "web": "/web/sse",
            "research": "/research/sse",
        },
        "loaded_servers": {
            "memory": "Available (Node subprocess)",
            "web": "Loaded" if web_srv else "Failed to load",
            "research": "Loaded" if research_srv else "Failed to load",
        },
        "usage": {
            "cursor": "Set url: http://localhost:3710/memory/sse in ~/.cursor/mcp.json",
            "claude_desktop": "Use url or mcp-remote command in claude_desktop_config.json",
            "antigravity": "Use mcp-remote command in mcp_config.json"
        }
    }
    return Response(
        content=__import__("json").dumps(status, indent=2),
        media_type="application/json"
    )

# ─── Starlette Application ───────────────────────────────────────────────────
app = Starlette(
    routes=[
        Route("/health", health_check, methods=["GET"]),
        Route("/memory/sse", handle_memory_sse, methods=["GET"]),
        Mount("/memory/messages/", app=memory_sse.handle_post_message),
        Route("/web/sse", handle_web_sse, methods=["GET"]),
        Mount("/web/messages/", app=web_sse.handle_post_message),
        Route("/research/sse", handle_research_sse, methods=["GET"]),
        Mount("/research/messages/", app=research_sse.handle_post_message),
    ]
)

def main():
    parser = argparse.ArgumentParser(description="OWL Universal MCP HTTP Gateway")
    parser.add_argument("--port", type=int, default=3710, help="Port to listen on (default: 3710)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    args = parser.parse_args()

    logger.info(f"OWL Gateway listening on http://{args.host}:{args.port}")
    logger.info(f"  Memory:   http://{args.host}:{args.port}/memory/sse")
    logger.info(f"  Web:      http://{args.host}:{args.port}/web/sse")
    logger.info(f"  Research: http://{args.host}:{args.port}/research/sse")
    logger.info(f"  Health:   http://{args.host}:{args.port}/health")

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")

if __name__ == "__main__":
    main()
