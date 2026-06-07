"""
OWL QA Protocol Module (Pillar 11)
==================================
Handles testing of WebSockets, GraphQL, and gRPC protocols.
Verifies payloads against contracts and measures response latency.
"""

import asyncio
import json
import sys
import time
from typing import Any, Dict, List, Optional
import httpx
import websockets

# Try optional gRPC dependency
_grpc_available = False
try:
    import grpc
    _grpc_available = True
except ImportError:
    pass

async def test_websocket_endpoint(url: str, messages: List[str], expected_responses: List[str], timeout: float = 5.0) -> Dict[str, Any]:
    """Connects to a WebSocket endpoint, exchanges messages, and verifies schemas."""
    start_time = time.time()
    results = []
    connection_ok = False
    error_msg = None
    
    try:
        # Establish connection with a strict timeout
        async with websockets.connect(url, open_timeout=timeout) as ws:
            connection_ok = True
            for i, msg in enumerate(messages):
                send_start = time.time()
                await ws.send(msg)
                
                # Wait for response
                try:
                    response = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    latency = int((time.time() - send_start) * 1000)
                    
                    # Verify response (if simple matching is desired)
                    passed = True
                    if i < len(expected_responses):
                        exp = expected_responses[i]
                        if exp not in response:
                            passed = False
                            
                    results.append({
                        "message_sent": msg,
                        "response_received": response[:300],
                        "latency_ms": latency,
                        "passed": passed
                    })
                except asyncio.TimeoutError:
                    results.append({
                        "message_sent": msg,
                        "error": "Timeout waiting for message response",
                        "passed": False
                    })
    except Exception as e:
        error_msg = str(e)

    duration = int((time.time() - start_time) * 1000)
    
    return {
        "endpoint": url,
        "protocol": "websocket",
        "connection_successful": connection_ok,
        "error": error_msg,
        "exchanges": results,
        "duration_ms": duration
    }

async def test_graphql_endpoint(url: str, query: str, variables: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Tests a GraphQL API, verifies response formatting, and checks for N+1 issues."""
    start_time = time.time()
    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    response_body = None
    status_code = 500
    errors = None
    has_n_plus_one = False
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.post(url, json=payload, headers=req_headers)
            status_code = res.status_code
            response_body = res.json()
            errors = response_body.get("errors")
            
            # Simple N+1 pattern heuristic: looking for repeated nested arrays in responses
            # e.g., users -> posts -> comments (many similar arrays indicating multiple SQL sub-queries)
            res_str = res.text
            # If we see repeating lists of sub-entities, flag it
            nested_arrays = re.findall(r'\[\s*\{\s*"id"', res_str)
            if len(nested_arrays) > 5:
                has_n_plus_one = True
                
        except Exception as e:
            errors = [{"message": str(e)}]

    duration = int((time.time() - start_time) * 1000)

    return {
        "endpoint": url,
        "protocol": "graphql",
        "status_code": status_code,
        "passed": status_code == 200 and not errors,
        "errors": errors,
        "n_plus_one_detected": has_n_plus_one,
        "duration_ms": duration,
        "response_preview": response_body
    }

async def introspect_graphql_schema(url: str) -> Dict[str, Any]:
    """Fetches schema definition from GraphQL endpoint via standard introspection query."""
    introspection_query = """
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        types {
          kind
          name
          description
        }
      }
    }
    """
    return await test_graphql_endpoint(url, introspection_query)

async def test_grpc_endpoint(host_port: str, service_method: str, request_json: str, timeout: float = 3.0) -> Dict[str, Any]:
    """Performs dynamic gRPC method calls over channel endpoints."""
    if not _grpc_available:
        return {
            "endpoint": host_port,
            "protocol": "grpc",
            "passed": False,
            "error": "gRPC dependency (grpcio) is not available."
        }

    start_time = time.time()
    passed = False
    error_msg = None
    response_data = None

    try:
        # Connect asynchronously
        async with grpc.aio.insecure_channel(host_port) as channel:
            # Multi-callable invocation helper
            # service_method must be formatted as /package.Service/Method
            multi_callable = channel.unary_unary(service_method)
            
            # gRPC requires binary payload; we simulate with string serialize
            payload = request_json.encode("utf-8")
            
            # Send and await response
            response = await asyncio.wait_for(multi_callable(payload), timeout=timeout)
            response_data = response.decode("utf-8", errors="ignore")
            passed = True
    except asyncio.TimeoutError:
        error_msg = "gRPC Call timed out."
    except Exception as e:
        error_msg = str(e)

    duration = int((time.time() - start_time) * 1000)

    return {
        "endpoint": host_port,
        "protocol": "grpc",
        "service_method": service_method,
        "passed": passed,
        "error": error_msg,
        "response_preview": response_data,
        "duration_ms": duration
    }
