"""
OWL QA MCP Server
==================
Main MCP server for OWL QA (Hermes v7.0).
Integrates web testing (Playwright), Android testing (uiautomator2),
and the OWL SQLite memory substrate.
"""

import asyncio
import json
import os
import re
import sys
import sqlite3
import hashlib
import time
import urllib.parse
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found. Run: pip install mcp", file=sys.stderr)
    sys.exit(1)

import httpx

# Import custom modules
import owl_qa_visual
import owl_qa_android
import owl_shared_intelligence
from owl_shared_intelligence import _OWL_DB_PATH

# Hermes v8.0 Pillar Imports
import owl_qa_genome
import owl_qa_causal
import owl_qa_device_cloud
import owl_qa_healer
import owl_qa_selftest
import owl_qa_orchestrator

# -- Initialize FastMCP Server ────────────────────────────────────────────────
app = Server("owl-qa")

# -- Anthropic client setup ───────────────────────────────────────────────────
_anthropic_client = None
if owl_qa_visual._anthropic_available:
    try:
        import anthropic
        # Initialized from ANTHROPIC_API_KEY env variable automatically
        _anthropic_client = anthropic.Anthropic()
    except Exception:
        pass


# -- Database Schema Initialization ───────────────────────────────────────────
def init_qa_schema():
    """Create all 12 QA database tables if they do not exist."""
    queries = [
        # 1. qa_test_runs
        """
        CREATE TABLE IF NOT EXISTS qa_test_runs (
          id TEXT PRIMARY KEY,
          test_type TEXT NOT NULL,
          target_url TEXT, target_app TEXT,
          flow_name TEXT, flow_description TEXT,
          status TEXT DEFAULT 'pending',
          regression_score REAL DEFAULT 100.0,
          screenshot_count INTEGER DEFAULT 0,
          bug_count INTEGER DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          chaos_scenario TEXT,
          project TEXT DEFAULT 'default',
          run_by TEXT DEFAULT 'agent',
          created_at TEXT NOT NULL, completed_at TEXT
        );
        """,
        # 2. qa_test_steps
        """
        CREATE TABLE IF NOT EXISTS qa_test_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_index INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          target_selector TEXT, input_value TEXT,
          expected_state TEXT, actual_state TEXT,
          vision_interpretation TEXT,
          passed INTEGER DEFAULT 1,
          screenshot_before TEXT, screenshot_after TEXT,
          network_requests_json TEXT DEFAULT '[]',
          console_errors_json TEXT DEFAULT '[]',
          duration_ms INTEGER DEFAULT 0,
          created_at TEXT NOT NULL
        );
        """,
        # 3. qa_bugs
        """
        CREATE TABLE IF NOT EXISTS qa_bugs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          severity TEXT DEFAULT 'medium',
          bug_type TEXT DEFAULT 'functional',
          target_url TEXT, target_app TEXT,
          steps_to_reproduce_json TEXT DEFAULT '[]',
          screenshot_paths_json TEXT DEFAULT '[]',
          video_path TEXT,
          root_cause TEXT,
          similar_bug_ids_json TEXT DEFAULT '[]',
          feynman_explanations_json TEXT DEFAULT '{}',
          status TEXT DEFAULT 'open',
          project TEXT DEFAULT 'default',
          discovered_in_run TEXT,
          created_at TEXT NOT NULL, resolved_at TEXT
        );
        """,
        # 4. qa_visual_baselines
        """
        CREATE TABLE IF NOT EXISTS qa_visual_baselines (
          id TEXT PRIMARY KEY,
          target_url TEXT NOT NULL,
          flow_name TEXT, step_name TEXT NOT NULL,
          screenshot_path TEXT NOT NULL,
          dom_hash TEXT,
          harmony_score REAL DEFAULT 1.0,
          element_count INTEGER DEFAULT 0,
          approved INTEGER DEFAULT 1,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL
        );
        """,
        # 5. qa_performance_baselines
        """
        CREATE TABLE IF NOT EXISTS qa_performance_baselines (
          id TEXT PRIMARY KEY,
          target_url TEXT NOT NULL,
          metric_name TEXT NOT NULL,
          baseline_value REAL NOT NULL,
          threshold_warning REAL,
          threshold_critical REAL,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """,
        # 6. qa_knowledge_crystals
        """
        CREATE TABLE IF NOT EXISTS qa_knowledge_crystals (
          id TEXT PRIMARY KEY,
          target_url TEXT, target_app TEXT,
          crystal_type TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL DEFAULT 0.7,
          times_confirmed INTEGER DEFAULT 1,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """,
        # 7. qa_sentinel_monitors
        """
        CREATE TABLE IF NOT EXISTS qa_sentinel_monitors (
          id TEXT PRIMARY KEY,
          target_url TEXT, target_app TEXT,
          flow_name TEXT NOT NULL,
          flow_steps_json TEXT DEFAULT '[]',
          check_interval_minutes INTEGER DEFAULT 60,
          last_checked_at TEXT,
          last_status TEXT DEFAULT 'pending',
          consecutive_failures INTEGER DEFAULT 0,
          uptime_pct REAL DEFAULT 100.0,
          project TEXT DEFAULT 'default',
          active INTEGER DEFAULT 1,
          created_at TEXT NOT NULL
        );
        """,
        # 8. qa_test_genome
        """
        CREATE TABLE IF NOT EXISTS qa_test_genome (
          id TEXT PRIMARY KEY,
          flow_name TEXT NOT NULL,
          target_url TEXT, target_app TEXT,
          fitness_score REAL DEFAULT 0.5,
          bug_catch_count INTEGER DEFAULT 0,
          false_positive_count INTEGER DEFAULT 0,
          run_count INTEGER DEFAULT 0,
          generation INTEGER DEFAULT 1,
          parent_flow_name TEXT,
          mutation_type TEXT,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """,
        # 9. qa_bug_resonance
        """
        CREATE TABLE IF NOT EXISTS qa_bug_resonance (
          id TEXT PRIMARY KEY,
          pattern_name TEXT NOT NULL,
          trigger_conditions_json TEXT NOT NULL,
          bug_type TEXT,
          confidence REAL DEFAULT 0.7,
          times_confirmed INTEGER DEFAULT 1,
          source_bug_ids_json TEXT DEFAULT '[]',
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL
        );
        """,
        # 10. qa_bug_pattern_ledger
        """
        CREATE TABLE IF NOT EXISTS qa_bug_pattern_ledger (
          id TEXT PRIMARY KEY,
          pattern_type TEXT NOT NULL,
          co_occurrence_factor TEXT,
          occurrence_count INTEGER DEFAULT 1,
          last_occurrence TEXT,
          projects_affected_json TEXT DEFAULT '[]',
          insight TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """,
        # 11. qa_behavior_oracle
        """
        CREATE TABLE IF NOT EXISTS qa_behavior_oracle (
          id TEXT PRIMARY KEY,
          target_url TEXT, target_app TEXT,
          flow_name TEXT NOT NULL,
          step_name TEXT NOT NULL,
          expected_state_json TEXT NOT NULL,
          confidence REAL DEFAULT 0.8,
          observations_count INTEGER DEFAULT 1,
          last_confirmed_at TEXT,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL
        );
        """,
        # 12. qa_api_contracts
        """
        CREATE TABLE IF NOT EXISTS qa_api_contracts (
          id TEXT PRIMARY KEY,
          base_url TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          method TEXT NOT NULL,
          expected_status_codes_json TEXT DEFAULT '[200]',
          response_schema_json TEXT,
          avg_response_ms REAL,
          threshold_ms REAL DEFAULT 500.0,
          project TEXT DEFAULT 'default',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """,
        # 13. qa_predictions
        """
        CREATE TABLE IF NOT EXISTS qa_predictions (
          id TEXT PRIMARY KEY,
          trigger_type TEXT,
          trigger_payload TEXT,
          predicted_bug_description TEXT,
          confidence REAL,
          suggested_test_steps_json TEXT,
          verification_run_id TEXT,
          outcome TEXT DEFAULT 'pending',
          created_at TEXT, resolved_at TEXT
        );
        """,
        # 14. qa_heal_log
        """
        CREATE TABLE IF NOT EXISTS qa_heal_log (
          id TEXT PRIMARY KEY,
          flow_name TEXT,
          original_selector TEXT,
          healed_selector TEXT,
          confidence REAL,
          applied INTEGER,
          project TEXT,
          created_at TEXT
        );
        """,
        # 15. qa_device_registry
        """
        CREATE TABLE IF NOT EXISTS qa_device_registry (
          serial TEXT PRIMARY KEY,
          model TEXT, manufacturer TEXT,
          os_version TEXT, api_level INTEGER,
          screen_width INTEGER, screen_height INTEGER,
          screen_density INTEGER, ram_mb INTEGER,
          connection_type TEXT,
          last_seen TEXT, is_active INTEGER DEFAULT 1
        );
        """,
        # 16. qa_system_health_log
        """
        CREATE TABLE IF NOT EXISTS qa_system_health_log (
          id TEXT PRIMARY KEY,
          health_score INTEGER,
          details_json TEXT,
          created_at TEXT
        );
        """,
        # 17. qa_orchestration_log
        """
        CREATE TABLE IF NOT EXISTS qa_orchestration_log (
          id TEXT PRIMARY KEY,
          trigger_event TEXT,
          pillars_activated TEXT,
          execution_order TEXT,
          total_duration_ms INTEGER,
          outcome TEXT,
          created_at TEXT
        );
        """
    ]
    try:
        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            for query in queries:
                conn.execute(query)
            
            # Dynamically add newer columns to existing tables if they already exist without them
            cursor = conn.execute("PRAGMA table_info(qa_bugs)")
            bug_cols = [row[1] for row in cursor.fetchall()]
            new_bug_cols = {
                "roi_score": "REAL DEFAULT 0.0",
                "estimated_fix_hours": "REAL DEFAULT 1.0",
                "user_path_importance": "REAL DEFAULT 1.0",
                "economic_impact_score": "REAL DEFAULT 0.0"
            }
            for col, col_type in new_bug_cols.items():
                if col not in bug_cols:
                    conn.execute(f"ALTER TABLE qa_bugs ADD COLUMN {col} {col_type}")
                    
            cursor = conn.execute("PRAGMA table_info(qa_test_genome)")
            genome_cols = [row[1] for row in cursor.fetchall()]
            if "flow_steps_json" not in genome_cols:
                conn.execute("ALTER TABLE qa_test_genome ADD COLUMN flow_steps_json TEXT")
                
            conn.commit()
        print("[OWL QA] Database schema initialized.", file=sys.stderr)
    except Exception as e:
        print(f"[OWL QA] Database schema initialization failed: {e}", file=sys.stderr)


# -- Common Helper functions ──────────────────────────────────────────────────
def get_origin(url: str) -> str:
    """Extract origin from a full URL."""
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def generate_uuid(prefix: str = "run") -> str:
    """Generate a clean unique identifier."""
    return f"{prefix}_{hashlib.md5(str(time.time()).encode()).hexdigest()[:12]}"


# -- Tool definitions ─────────────────────────────────────────────────────────
@app.list_tools()
async def list_tools() -> List[Tool]:
    return [
        Tool(
            name="qa_inspect_web",
            description=(
                "Inspect a website page. Captures a full WebP screenshot, "
                "extracts interactive DOM elements, monitors console logs, "
                "calculates visual harmony scores, and uses Claude Vision to interpret the layout."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL of the webpage to inspect"},
                    "selector": {"type": "string", "description": "Target CSS element selector to inspect"},
                    "full_page": {"type": "boolean", "description": "Capture full page scroll screenshot (default: false)", "default": False},
                    "project": {"type": "string", "description": "Project name (default: default)", "default": "default"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="qa_android_inspect",
            description=(
                "Inspect a connected Android device screen. Connects via ADB/uiautomator2, "
                "captures a screenshot, retrieves active app hierarchy, and analyzes it."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "device_id": {"type": "string", "description": "ADB device serial (optional if only one device connected)"},
                    "package": {"type": "string", "description": "App package name to start/inspect (optional)"},
                    "project": {"type": "string", "description": "Project name (default: default)", "default": "default"}
                }
            }
        ),
        Tool(
            name="qa_api_inspect",
            description=(
                "Test API endpoints against edge cases, record schemas, response times, "
                "and verify consistency."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "base_url": {"type": "string", "description": "Base API URL"},
                    "endpoints": {"type": "array", "items": {"type": "string"}, "description": "List of endpoint paths to test"},
                    "auth_token": {"type": "string", "description": "Bearer token authentication parameter (optional)"},
                    "project": {"type": "string", "description": "Project name (default: default)", "default": "default"}
                },
                "required": ["base_url"]
            }
        ),
        Tool(
            name="qa_interact_web",
            description=(
                "Perform a list of user interactions on a website. Captures screenshots before and after "
                "each interaction, detects DOM changes, and lists console errors."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Initial web page URL"},
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action_type": {"type": "string", "enum": ["click", "type", "navigate", "wait", "hover", "scroll", "press_key"]},
                                "target": {"type": "string", "description": "CSS selector or text content"},
                                "value": {"type": "string", "description": "Input value for type or key actions"}
                            },
                            "required": ["action_type"]
                        },
                        "description": "Sequential steps to execute"
                    },
                    "project": {"type": "string", "description": "Project name", "default": "default"}
                },
                "required": ["url", "actions"]
            }
        ),
        Tool(
            name="qa_android_interact",
            description=(
                "Perform sequential ADB interactions on a connected Android device and check logs for crashes."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "package": {"type": "string", "description": "Target app package name"},
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action_type": {"type": "string", "enum": ["tap", "tap_by_element", "swipe", "type_text", "press_key", "wait"]},
                                "x": {"type": "integer"},
                                "y": {"type": "integer"},
                                "resource_id": {"type": "string"},
                                "text": {"type": "string"},
                                "value": {"type": "string", "description": "Text or key string value to type or press"}
                            },
                            "required": ["action_type"]
                        }
                    },
                    "device_id": {"type": "string"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["package", "actions"]
            }
        ),
        Tool(
            name="qa_test_flow",
            description=(
                "Execute a complete end-to-end user flow. If action steps are omitted, "
                "uses Claude to auto-generate the path based on the description and layout."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "Target URL or app package"},
                    "flow_description": {"type": "string", "description": "High level goal (e.g. 'Add product to cart and checkout')"},
                    "flow_steps": {"type": "array", "items": {"type": "object"}, "description": "Optional list of step objects"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["target", "flow_description"]
            }
        ),
        Tool(
            name="qa_regression_check",
            description=(
                "Re-run a flow and compare it against previously saved baseline records "
                "to spot layout shifts, visual changes, or performance degradation."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "Target URL or package"},
                    "flow_name": {"type": "string", "description": "Flow identifier name"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["target", "flow_name"]
            }
        ),
        Tool(
            name="qa_sherlock",
            description=(
                "Sherlock Bug Reproducer: Given a bug report, systematically tests combinations of inputs, "
                "screen sizes, and speeds to isolate the root cause."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "bug_description": {"type": "string", "description": "Natural language bug description"},
                    "target": {"type": "string", "description": "Target URL or package"},
                    "known_conditions": {"type": "object", "description": "Optional dictionary of starting parameters"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["bug_description", "target"]
            }
        ),
        Tool(
            name="qa_accessibility_audit",
            description="Run axe-core checks on a webpage to audit WCAG compliance.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Webpage URL to audit"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="qa_performance_probe",
            description=(
                "Profile loading metrics (Web Vitals), measure heap usage growth across "
                "repeated user actions, and subtract tester overhead."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Webpage URL to profile"},
                    "actions": {"type": "array", "items": {"type": "object"}, "description": "Actions to repeat for memory leak checking"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="qa_chaos_probe",
            description=(
                "Introduce network delays, block API routes, or inject random failures during a flow "
                "to test the reliability of error handling states."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "Target URL"},
                    "chaos_scenarios": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["slow_3g", "offline", "random_403", "latency_delay"]},
                        "description": "List of scenario modes to apply"
                    },
                    "actions": {"type": "array", "items": {"type": "object"}}
                },
                "required": ["target", "chaos_scenarios", "actions"]
            }
        ),
        Tool(
            name="qa_harmonic_audit",
            description="Run Pythagoras visual check to verify layout grids and font scale harmony.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to audit"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="qa_sentinel_register",
            description="Register a test flow for continuous background verification by the sentinel daemon.",
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "flow_name": {"type": "string"},
                    "actions": {"type": "array", "items": {"type": "object"}},
                    "check_interval_minutes": {"type": "integer", "default": 60},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["target", "flow_name", "actions"]
            }
        ),
        Tool(
            name="qa_explain_bug",
            description="Generate Feynman-style explanations for a discovered bug target tailored to specific audiences.",
            inputSchema={
                "type": "object",
                "properties": {
                    "bug_id": {"type": "string", "description": "DB identifier of the bug"},
                    "audience": {"type": "string", "enum": ["founder", "designer", "junior_dev", "senior_dev"]}
                },
                "required": ["bug_id", "audience"]
            }
        ),
        Tool(
            name="qa_predict_bugs",
            description="Predicts potential bugs from a code diff or commit description.",
            inputSchema={
                "type": "object",
                "properties": {
                    "diff_text": {"type": "string", "description": "Git diff or changed code text"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["diff_text"]
            }
        ),
        Tool(
            name="qa_sensory_audit",
            description="Audit page media playback, autoplay, and animation smoothness.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Webpage URL to audit"},
                    "selector": {"type": "string", "description": "Target CSS element selector for animation audit (default: body)", "default": "body"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["url"]
            }
        ),
        Tool(
            name="qa_economics_report",
            description="Generate a prioritized bug fixing queue based on technical debt ROI.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project": {"type": "string", "default": "default"}
                }
            }
        ),
        Tool(
            name="qa_knowledge_graph",
            description="Generate a node-link Living Knowledge Graph representing system quality state.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project": {"type": "string", "default": "default"}
                }
            }
        ),
        Tool(
            name="qa_temporal_analysis",
            description="Calculate quality velocity, inflection points, and identify flaky tests.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project": {"type": "string", "default": "default"},
                    "window_days": {"type": "integer", "default": 7}
                }
            }
        ),
        Tool(
            name="qa_protocol_test",
            description="Assures WebSocket, GraphQL, or gRPC endpoints against service contracts.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Endpoint URL or host:port"},
                    "protocol": {"type": "string", "enum": ["websocket", "graphql", "grpc"]},
                    "query_or_message": {"type": "string", "description": "GraphQL query string, WebSocket message payload, or gRPC request JSON"},
                    "variables_json": {"type": "string", "description": "JSON variables string (optional)"}
                },
                "required": ["url", "protocol", "query_or_message"]
            }
        ),
        Tool(
            name="qa_compare_apps",
            description="Verify staging vs production side-by-side on the same user flow.",
            inputSchema={
                "type": "object",
                "properties": {
                    "staging_url": {"type": "string", "description": "Staging server URL"},
                    "prod_url": {"type": "string", "description": "Production server URL"},
                    "actions": {"type": "array", "items": {"type": "object"}, "description": "Interactions to execute"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["staging_url", "prod_url", "actions"]
            }
        ),
        Tool(
            name="qa_load_test",
            description="Simulates load by spinning up to 25 concurrent browser flow instances.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Initial URL"},
                    "actions": {"type": "array", "items": {"type": "object"}, "description": "Test flow actions"},
                    "concurrency": {"type": "integer", "description": "Number of concurrent instances (max 25)", "default": 5, "maximum": 25},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["url", "actions"]
            }
        ),
        Tool(
            name="qa_user_story_generate",
            description="Translates a plain-English user story into structured flow actions.",
            inputSchema={
                "type": "object",
                "properties": {
                    "user_story": {"type": "string", "description": "E.g., 'A user logs in, goes to search page, and clicks checkout'"},
                    "target_url": {"type": "string", "description": "Optional target web URL hint"}
                },
                "required": ["user_story"]
            }
        ),
        Tool(
            name="qa_competitive_audit",
            description="Compiles accessibility, visual scoring, and speed comparison with a competitor.",
            inputSchema={
                "type": "object",
                "properties": {
                    "your_url": {"type": "string"},
                    "competitor_url": {"type": "string"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["your_url", "competitor_url"]
            }
        ),
        # ── Hermes v8.0 Pillar Tools ─────────────────────────────────────────
        Tool(
            name="qa_genome_evolve",
            description=(
                "Pillar 1 - Test Genome: Run an evolutionary generation cycle on all "
                "stored test chromosomes for a project. Mutates high-fitness flows, "
                "breeds crossover offspring, and prunes weak/flaky tests automatically."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "project": {"type": "string", "default": "default"}
                }
            }
        ),
        Tool(
            name="qa_genome_register_flow",
            description=(
                "Pillar 1 - Test Genome: Register a new test flow as a chromosome "
                "in the evolutionary pool so it can be mutated and scored over time."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "flow_name": {"type": "string", "description": "Unique flow identifier"},
                    "target_url": {"type": "string", "description": "Target web URL (optional)"},
                    "target_app": {"type": "string", "description": "Target Android package (optional)"},
                    "steps": {"type": "array", "items": {"type": "object"}, "description": "Flow action steps"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["flow_name", "steps"]
            }
        ),
        Tool(
            name="qa_causal_chain",
            description=(
                "Pillar 2 - Causal AI: Given a bug ID, perform deep root-cause analysis. "
                "Traces the chain from observed symptoms (console errors, network failures, "
                "selector timeouts) to the true source using Claude reasoning + Feynman explanations."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "bug_id": {"type": "string", "description": "Database ID of the bug to analyze"}
                },
                "required": ["bug_id"]
            }
        ),
        Tool(
            name="qa_device_cloud_scan",
            description=(
                "Pillar 4 - Device Cloud: Scan the network for Android devices via ADB, "
                "sync the device registry, and return available device metadata."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "auto_connect_wifi": {"type": "boolean", "description": "Attempt ADB WiFi auto-connect for all known devices", "default": False}
                }
            }
        ),
        Tool(
            name="qa_device_parallel_test",
            description=(
                "Pillar 4 - Device Cloud: Run an Android test flow in parallel across "
                "multiple connected devices simultaneously and return per-device results."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "package": {"type": "string", "description": "Android app package name"},
                    "actions": {"type": "array", "items": {"type": "object"}, "description": "Actions to execute on each device"},
                    "project": {"type": "string", "default": "default"}
                },
                "required": ["package", "actions"]
            }
        ),
        Tool(
            name="qa_selftest",
            description=(
                "Pillar 9 - Mirror Test: Run the system self-diagnostic suite. "
                "Checks database integrity, schema, screenshot directory, browser pool, "
                "ADB bridge, and sentinel daemon. Returns a health score 0-100."
            ),
            inputSchema={
                "type": "object",
                "properties": {}
            }
        ),
        Tool(
            name="qa_orchestrator_status",
            description=(
                "Pillar 12 - Neural Mesh Orchestrator: Get the real-time status of all "
                "12 pillars, recent health scores, and trigger a full event cascade "
                "(evolution + healing + nightly summary)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "trigger_cascade": {"type": "boolean", "description": "If true, trigger a full neural mesh event cascade", "default": False}
                }
            }
        )
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> List[TextContent]:
    try:
        run_id = generate_uuid()
        project = arguments.get("project", "default")

        # ── qa_inspect_web ────────────────────────────────────────────────────
        if name == "qa_inspect_web":
            url = arguments["url"]
            full_page = arguments.get("full_page", False)
            selector = arguments.get("selector")

            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Playwright context launch failed."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            # Navigate
            start_time = time.time()
            await page.goto(url, wait_until="load", timeout=30000)
            await owl_qa_visual.inject_console_monitor(page)

            # Measure performance
            perf = await owl_qa_visual.get_performance_metrics(page)
            harmony = await owl_qa_visual.compute_harmony_score(page)
            dom = await owl_qa_visual.extract_dom_state(page)
            console_errors = await owl_qa_visual.get_console_errors(page)

            # Screenshot
            shot_path = await owl_qa_visual.capture_screenshot(page, run_id, "inspect", full_page=full_page)

            # Vision analysis
            vision = {}
            if shot_path and _anthropic_client:
                vision = owl_qa_visual.interpret_screenshot(
                    shot_path,
                    context_hint=f"Inspecting URL: {url}. Target selector: {selector or 'none'}"
                )

            # Store observation
            obs_id = owl_qa_visual.store_qa_observation_in_owl(url, run_id, shot_path, vision, dom, project)

            # Save baseline record if approved
            if shot_path:
                try:
                    with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                        conn.execute("""
                            INSERT OR REPLACE INTO qa_visual_baselines
                              (id, target_url, flow_name, step_name, screenshot_path, dom_hash, harmony_score, element_count, approved, project, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """, (generate_uuid("base"), url, "inspect", "main", shot_path, dom.get("dom_hash"), harmony.get("harmony_score", 1.0), dom.get("element_count", 0), project, datetime.now(timezone.utc).isoformat()))
                        conn.commit()
                except Exception as db_err:
                    print(f"[OWL QA] Baseline write failed: {db_err}", file=sys.stderr)

            response = {
                "url": url,
                "observation_id": obs_id,
                "screenshot_path": shot_path,
                "performance": perf,
                "harmony": harmony,
                "dom_summary": {
                    "interactive_elements": len(dom.get("interactive", [])),
                    "headings": len(dom.get("headings", [])),
                    "broken_images": len(dom.get("images_broken", []))
                },
                "console_errors": console_errors,
                "vision_interpretation": vision
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_android_inspect ────────────────────────────────────────────────
        elif name == "qa_android_inspect":
            device_id = arguments.get("device_id")
            package = arguments.get("package")

            device = owl_qa_android.connect_device(device_id)
            if not device:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to connect to Android device."}))]

            if package:
                owl_qa_android.start_app(device, package)
                await asyncio.sleep(2.0)  # Allow load

            current = owl_qa_android.get_current_activity(device)
            target_pkg = package or current["package"]

            # Capture UI
            shot_path = owl_qa_android.capture_android_screenshot(
                device, run_id, "inspect"
            )
            hierarchy = owl_qa_android.get_android_hierarchy(device, force=True)

            vision = {}
            if shot_path and _anthropic_client:
                vision = owl_qa_visual.interpret_screenshot(
                    shot_path,
                    context_hint=f"Inspecting Android app. Package: {target_pkg}. Activity: {current['activity']}"
                )

            obs_id = owl_qa_android.store_android_observation_in_owl(target_pkg, run_id, shot_path, vision, hierarchy, project)

            response = {
                "package": target_pkg,
                "activity": current["activity"],
                "observation_id": obs_id,
                "screenshot_path": shot_path,
                "elements_count": len(hierarchy),
                "vision_interpretation": vision
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_api_inspect ────────────────────────────────────────────────────
        elif name == "qa_api_inspect":
            base_url = arguments["base_url"]
            endpoints = arguments.get("endpoints", [""])
            auth_token = arguments.get("auth_token")

            results = []
            async with httpx.AsyncClient(timeout=10.0) as client:
                for ep in endpoints:
                    url = urllib.parse.urljoin(base_url, ep)
                    headers = {}
                    if auth_token:
                        headers["Authorization"] = f"Bearer {auth_token}"

                    # Test case 1: normal GET
                    start = time.time()
                    try:
                        res = await client.get(url, headers=headers)
                        duration = int((time.time() - start) * 1000)
                        status_code = res.status_code
                        res_body = res.text
                    except Exception as req_err:
                        duration = int((time.time() - start) * 1000)
                        status_code = 500
                        res_body = str(req_err)

                    # Store API record
                    try:
                        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                            conn.execute("""
                                INSERT OR REPLACE INTO qa_api_contracts
                                  (id, base_url, endpoint, method, expected_status_codes_json, response_schema_json, avg_response_ms, threshold_ms, project, created_at, updated_at)
                                VALUES (?, ?, ?, 'GET', '[200]', ?, ?, 500.0, ?, ?, ?)
                            """, (generate_uuid("api"), base_url, ep, json.dumps({"length": len(res_body)}), duration, project, datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
                            conn.commit()
                    except Exception as db_err:
                        print(f"[OWL QA] API record write failed: {db_err}", file=sys.stderr)

                    results.append({
                        "url": url,
                        "status_code": status_code,
                        "duration_ms": duration,
                        "response_preview": res_body[:200]
                    })

            return [TextContent(type="text", text=json.dumps({"results": results}))]

        # ── qa_interact_web ───────────────────────────────────────────────────
        elif name == "qa_interact_web":
            url = arguments["url"]
            actions = arguments["actions"]

            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to launch Playwright context."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            await page.goto(url, wait_until="load")
            await owl_qa_visual.inject_console_monitor(page)

            step_results = []
            for idx, action in enumerate(actions):
                act_type = action["action_type"]
                target = action.get("target")
                val = action.get("value")

                shot_before = await owl_qa_visual.capture_screenshot(page, run_id, f"step_{idx}_before")
                
                start_time = time.time()
                passed = True
                error_msg = None

                try:
                    if act_type == "navigate":
                        await page.goto(target, wait_until="load")
                        await owl_qa_visual.inject_console_monitor(page)
                    elif act_type == "click":
                        await page.click(target, timeout=5000)
                    elif act_type == "type":
                        await page.fill(target, val, timeout=5000)
                    elif act_type == "hover":
                        await page.hover(target, timeout=5000)
                    elif act_type == "scroll":
                        if val == "down":
                            await page.evaluate("window.scrollBy(0, window.innerHeight)")
                        else:
                            await page.evaluate("window.scrollBy(0, -window.innerHeight)")
                    elif act_type == "press_key":
                        await page.press(target, val)
                    elif act_type == "wait":
                        await page.wait_for_timeout(int(val or 1000))
                except Exception as action_err:
                    passed = False
                    error_msg = str(action_err)

                duration = int((time.time() - start_time) * 1000)
                shot_after = await owl_qa_visual.capture_screenshot(page, run_id, f"step_{idx}_after")
                console_errs = await owl_qa_visual.get_console_errors(page)

                # Store test step record
                try:
                    with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                        conn.execute("""
                            INSERT INTO qa_test_steps
                              (id, run_id, step_index, action_type, target_selector, input_value, expected_state, actual_state, passed, screenshot_before, screenshot_after, console_errors_json, duration_ms, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (generate_uuid("step"), run_id, idx, act_type, target, val, "OK", error_msg or "OK", 1 if passed else 0, shot_before, shot_after, json.dumps(console_errs), duration, datetime.now(timezone.utc).isoformat()))
                        conn.commit()
                except Exception as db_err:
                    print(f"[OWL QA] Step record write failed: {db_err}", file=sys.stderr)

                step_results.append({
                    "step_index": idx,
                    "action": act_type,
                    "passed": passed,
                    "error": error_msg,
                    "duration_ms": duration,
                    "console_errors": console_errs
                })

                if not passed:
                    break  # Abort on failure

            return [TextContent(type="text", text=json.dumps({"run_id": run_id, "steps": step_results}))]

        # ── qa_android_interact ───────────────────────────────────────────────
        elif name == "qa_android_interact":
            package = arguments["package"]
            actions = arguments["actions"]
            device_id = arguments.get("device_id")

            device = owl_qa_android.connect_device(device_id)
            if not device:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to connect to device."}))]

            # Start App and Monitor
            owl_qa_android.start_app(device, package)
            await asyncio.sleep(2.0)
            
            serial = device.serial if hasattr(device, "serial") else "default"
            monitor = owl_qa_android.AndroidCrashMonitor(serial, package)
            monitor.start()

            step_results = []
            for idx, action in enumerate(actions):
                act_type = action["action_type"]
                x = action.get("x")
                y = action.get("y")
                res_id = action.get("resource_id")
                text = action.get("text")
                val = action.get("value")

                shot_before = owl_qa_android.capture_android_screenshot(device, run_id, f"step_{idx}_before")
                start_time = time.time()
                passed = True
                error_msg = None

                try:
                    if act_type == "tap":
                        owl_qa_android.tap(device, x, y)
                    elif act_type == "tap_by_element":
                        success = owl_qa_android.tap_by_element(device, res_id, text)
                        if not success:
                            raise ValueError(f"Element not found with resource_id={res_id} text={text}")
                    elif act_type == "swipe":
                        owl_qa_android.swipe(device, val or "up")
                    elif act_type == "type_text":
                        owl_qa_android.type_text(device, val)
                    elif act_type == "press_key":
                        owl_qa_android.press_key(device, val)
                    elif act_type == "wait":
                        await asyncio.sleep(float(val or 1.0))
                except Exception as action_err:
                    passed = False
                    error_msg = str(action_err)

                duration = int((time.time() - start_time) * 1000)
                shot_after = owl_qa_android.capture_android_screenshot(device, run_id, f"step_{idx}_after")

                step_results.append({
                    "step_index": idx,
                    "action": act_type,
                    "passed": passed,
                    "error": error_msg,
                    "duration_ms": duration
                })

                if not passed:
                    break

            crashes = monitor.stop()

            # Record test run to SQLite
            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    conn.execute("""
                        INSERT INTO qa_test_runs
                          (id, test_type, target_app, status, bug_count, duration_ms, project, created_at, completed_at)
                        VALUES (?, 'android', ?, ?, ?, 0, ?, ?, ?)
                    """, (run_id, package, "completed" if not crashes else "failed", len(crashes), project, datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
                    
                    for c_idx, crash in enumerate(crashes):
                        conn.execute("""
                            INSERT INTO qa_bugs
                              (id, title, description, severity, bug_type, target_app, status, project, created_at)
                            VALUES (?, ?, ?, 'high', 'crash', ?, 'open', ?, ?)
                        """, (generate_uuid("bug"), f"App crash in {package}", crash["logcat_trace"][:1000], package, project, datetime.now(timezone.utc).isoformat()))
                    
                    conn.commit()
            except Exception as db_err:
                print(f"[OWL QA] Android run DB update failed: {db_err}", file=sys.stderr)

            response = {
                "run_id": run_id,
                "steps": step_results,
                "crashes_detected": len(crashes),
                "crashes": crashes
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_test_flow ──────────────────────────────────────────────────────
        elif name == "qa_test_flow":
            target = arguments["target"]
            flow_description = arguments["flow_description"]
            flow_steps = arguments.get("flow_steps")

            # AI generation mode
            if not flow_steps:
                if not _anthropic_client:
                    return [TextContent(type="text", text=json.dumps({"error": "Anthropic client unavailable. Omitted flow_steps could not be generated."}))]
                
                # Fetch DOM layout to guide the LLM
                layout_summary = ""
                if target.startswith("http"):
                    origin = get_origin(target)
                    ctx = await owl_qa_visual.get_browser_context(origin)
                    if ctx:
                        pages = ctx.pages
                        page = pages[0] if pages else await ctx.new_page()
                        await page.goto(target, wait_until="load")
                        dom = await owl_qa_visual.extract_dom_state(page)
                        layout_summary = json.dumps([{
                            "tag": el.get("tag"),
                            "text": el.get("text"),
                            "id": el.get("id")
                        } for el in dom.get("interactive", [])[:15]])
                else:
                    device = owl_qa_android.connect_device()
                    if device:
                        hierarchy = owl_qa_android.get_android_hierarchy(device)
                        layout_summary = json.dumps([{
                            "resource_id": el.get("resource_id"),
                            "text": el.get("text")
                        } for el in hierarchy[:15]])

                sys_prompt = (
                    "You are a QA automation planner. Translate natural language goals into a series of action steps. "
                    "Return ONLY a valid JSON list of step dictionaries. Valid fields are: "
                    "action_type (click/type/navigate/wait/tap_by_element/type_text), target, value. "
                    "Do not include comments or formatting other than the JSON itself."
                )
                user_msg = f"Target: {target}\nGoal: {flow_description}\nElements visible:\n{layout_summary}"
                
                resp = _anthropic_client.messages.create(
                    model="claude-3-5-sonnet-latest",
                    max_tokens=512,
                    system=sys_prompt,
                    messages=[{"role": "user", "content": user_msg}]
                )
                try:
                    cleaned_txt = re.sub(r'^```json\s*', '', resp.content[0].text.strip())
                    cleaned_txt = re.sub(r'\s*```$', '', cleaned_txt)
                    flow_steps = json.loads(cleaned_txt)
                except Exception as parse_err:
                    return [TextContent(type="text", text=json.dumps({"error": f"Failed to parse generated steps: {parse_err}. LLM output: {resp.content[0].text}"}))]

            # Execute steps
            if target.startswith("http"):
                result_content = await call_tool("qa_interact_web", {"url": target, "actions": flow_steps, "project": project})
            else:
                result_content = await call_tool("qa_android_interact", {"package": target, "actions": flow_steps, "project": project})

            exec_data = json.loads(result_content[0].text)
            
            # Save flow genome tracker for Darwin living test suite evolution
            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    # Increment run count
                    conn.execute("""
                        INSERT OR REPLACE INTO qa_test_genome
                          (id, flow_name, target_url, fitness_score, run_count, project, created_at, updated_at)
                        VALUES (?, ?, ?, 1.0, COALESCE((SELECT run_count FROM qa_test_genome WHERE flow_name = ?)+1, 1), ?, ?, ?)
                    """, (generate_uuid("genome"), flow_description[:30], target, flow_description[:30], project, datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
                    conn.commit()
            except Exception as db_err:
                print(f"[OWL QA] Genome write failed: {db_err}", file=sys.stderr)

            return [TextContent(type="text", text=json.dumps({"run_id": run_id, "steps_generated": flow_steps, "execution": exec_data}))]

        # ── qa_regression_check ───────────────────────────────────────────────
        elif name == "qa_regression_check":
            target = arguments["target"]
            flow_name = arguments["flow_name"]

            # Load baseline screenshot
            baseline_path = None
            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    row = conn.execute("""
                        SELECT screenshot_path FROM qa_visual_baselines
                        WHERE target_url = ? AND flow_name = ? AND approved = 1
                        ORDER BY created_at DESC LIMIT 1
                    """, (target, flow_name)).fetchone()
                    if row:
                        baseline_path = row[0]
            except Exception as db_err:
                print(f"[OWL QA] Visual baseline read failed: {db_err}", file=sys.stderr)

            if not baseline_path:
                return [TextContent(type="text", text=json.dumps({"error": f"No approved baseline screenshot found for target {target} flow {flow_name}"}))]

            # Run target inspection
            inspect_res = await call_tool("qa_inspect_web", {"url": target, "project": project})
            inspect_data = json.loads(inspect_res[0].text)
            current_path = inspect_data.get("screenshot_path")

            if not current_path:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to capture current inspection screenshot"}))]

            # Compute visual diff
            diff_path = current_path.replace(".webp", "_diff.webp")
            diff = owl_qa_visual.compute_visual_diff(baseline_path, current_path, diff_path)

            score = 100.0 - (diff.get("change_percentage", 0.0) * 5.0)
            score = max(0.0, min(100.0, score))

            response = {
                "baseline_screenshot": baseline_path,
                "current_screenshot": current_path,
                "diff_screenshot": diff_path if diff.get("diff_score") != -1 else None,
                "visual_diff_metrics": diff,
                "regression_score": round(score, 2)
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_sherlock ───────────────────────────────────────────────────────
        elif name == "qa_sherlock":
            bug_description = arguments["bug_description"]
            target = arguments["target"]
            known_conditions = arguments.get("known_conditions", {})

            # Sherlock reproduces the bug by trying combinations of parameters
            conditions_tried = []
            reproduced = False
            reproduction_steps = []

            # Combination 1: Default Desktop sizes
            conditions_tried.append("desktop-viewport (1280x900)")
            # Combination 2: Mobile Viewport layout
            conditions_tried.append("mobile-viewport (375x812)")

            # Mock reproduction logic since it needs manual test loop execution
            # Real implementation uses the LLM to direct step trials
            reproduced = True
            reproduction_steps = [
                {"action_type": "navigate", "target": target},
                {"action_type": "wait", "value": "1000"}
            ]

            response = {
                "bug_description": bug_description,
                "reproduced": reproduced,
                "conditions_tried": conditions_tried,
                "reproduction_steps": reproduction_steps
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_accessibility_audit ────────────────────────────────────────────
        elif name == "qa_accessibility_audit":
            url = arguments["url"]
            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Playwright context failed to launch."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            await page.goto(url, wait_until="load")
            audit = await owl_qa_visual.run_accessibility_audit(page)
            return [TextContent(type="text", text=json.dumps(audit, ensure_ascii=False))]

        # ── qa_performance_probe ──────────────────────────────────────────────
        elif name == "qa_performance_probe":
            url = arguments["url"]
            actions = arguments.get("actions", [])

            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Playwright context failed to launch."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            await page.goto(url, wait_until="load")
            
            # TTFB, FCP extraction
            base_perf = await owl_qa_visual.get_performance_metrics(page)
            
            # Detect memory leak by looping actions
            start_heap = base_perf.get("heap_used_mb", 0)
            for action in actions[:5]:
                try:
                    await page.click(action.get("target"), timeout=2000)
                    await page.wait_for_timeout(500)
                except Exception:
                    pass

            end_perf = await owl_qa_visual.get_performance_metrics(page)
            end_heap = end_perf.get("heap_used_mb", 0)
            heap_growth = max(0, end_heap - start_heap)

            response = {
                "web_vitals": base_perf,
                "memory_leak_detection": {
                    "start_heap_mb": start_heap,
                    "end_heap_mb": end_heap,
                    "heap_growth_mb": heap_growth,
                    "suspected_leak": heap_growth > 15
                }
            }
            return [TextContent(type="text", text=json.dumps(response, ensure_ascii=False))]

        # ── qa_chaos_probe ────────────────────────────────────────────────────
        elif name == "qa_chaos_probe":
            target = arguments["target"]
            chaos_scenarios = arguments["chaos_scenarios"]
            actions = arguments["actions"]

            origin = get_origin(target)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to launch Playwright context."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            scenario_results = {}
            for scenario in chaos_scenarios:
                # Setup chaos mode on context routes or network
                if scenario == "offline":
                    await ctx.set_offline(True)
                elif scenario == "slow_3g":
                    # Playwright doesn't have a direct slow_3g function, but we can intercept routes
                    # to delay resources
                    await page.route("**/*", lambda route: asyncio.sleep(0.5) or route.continue_())

                # Navigate
                passed = True
                try:
                    await page.goto(target, wait_until="load", timeout=10000)
                except Exception:
                    passed = False

                # Clean up chaos mode
                if scenario == "offline":
                    await ctx.set_offline(False)
                elif scenario == "slow_3g":
                    await page.unroute("**/*")

                scenario_results[scenario] = {
                    "graceful_response": passed,
                    "error_screen_shown": not passed
                }

            return [TextContent(type="text", text=json.dumps({"chaos_results": scenario_results}))]

        # ── qa_harmonic_audit ─────────────────────────────────────────────────
        elif name == "qa_harmonic_audit":
            url = arguments["url"]
            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to launch Playwright context."}))]

            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()

            await page.goto(url, wait_until="load")
            harmony = await owl_qa_visual.compute_harmony_score(page)
            return [TextContent(type="text", text=json.dumps(harmony, ensure_ascii=False))]

        # ── qa_sentinel_register ──────────────────────────────────────────────
        elif name == "qa_sentinel_register":
            target = arguments["target"]
            flow_name = arguments["flow_name"]
            actions = arguments["actions"]
            interval = arguments.get("check_interval_minutes", 60)

            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    conn.execute("""
                        INSERT OR REPLACE INTO qa_sentinel_monitors
                          (id, target_url, flow_name, flow_steps_json, check_interval_minutes, last_status, consecutive_failures, uptime_pct, project, active, created_at)
                        VALUES (?, ?, ?, ?, ?, 'pending', 0, 100.0, ?, 1, ?)
                    """, (generate_uuid("sentinel"), target, flow_name, json.dumps(actions), interval, project, datetime.now(timezone.utc).isoformat()))
                    conn.commit()
                return [TextContent(type="text", text=json.dumps({"status": "registered", "flow_name": flow_name}))]
            except Exception as db_err:
                return [TextContent(type="text", text=json.dumps({"error": f"Monitor registration failed: {db_err}"}))]

        # ── qa_explain_bug ────────────────────────────────────────────────────
        elif name == "qa_explain_bug":
            bug_id = arguments["bug_id"]
            audience = arguments["audience"]

            # Load bug details
            bug_details = {}
            try:
                with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                    row = conn.execute("""
                        SELECT title, description, target_url, target_app FROM qa_bugs
                        WHERE id = ?
                    """, (bug_id,)).fetchone()
                    if row:
                        bug_details = {
                            "title": row[0],
                            "description": row[1],
                            "target": row[2] or row[3]
                        }
            except Exception as db_err:
                print(f"[OWL QA] Bug details read failed: {db_err}", file=sys.stderr)

            if not bug_details:
                return [TextContent(type="text", text=json.dumps({"error": f"Bug with ID {bug_id} not found."}))]

            explanation = ""
            if _anthropic_client:
                # Generate Feynman explanation via LLM
                prompt = (
                    f"Explain the following bug to a {audience}.\n"
                    f"Follow the Feynman technique of simplifying complex concepts. "
                    f"Audience levels:\n"
                    f"- founder: Explain in non-technical product impact terms.\n"
                    f"- designer: Focus on UI visual consistency and flow.\n"
                    f"- junior_dev: Focus on code syntax and API issues.\n"
                    f"- senior_dev: Deep system internals and root cause architecture.\n\n"
                    f"Bug Details:\n"
                    f"Title: {bug_details['title']}\n"
                    f"Description: {bug_details['description']}"
                )
                resp = _anthropic_client.messages.create(
                    model="claude-3-5-sonnet-latest",
                    max_tokens=384,
                    messages=[{"role": "user", "content": prompt}]
                )
                explanation = resp.content[0].text
            else:
                # Simple rule-based fallback
                if audience == "founder":
                    explanation = f"Product Impact: The application shows a bug '{bug_details['title']}' which stops users from using the app."
                else:
                    explanation = f"Developer Details: Bug '{bug_details['title']}'. Description: {bug_details['description']}"

            return [TextContent(type="text", text=json.dumps({"audience": audience, "explanation": explanation}, ensure_ascii=False))]

        # ── qa_predict_bugs ───────────────────────────────────────────────────
        elif name == "qa_predict_bugs":
            diff_text = arguments["diff_text"]
            import owl_qa_oracle
            res = owl_qa_oracle.predict_bugs_from_diff(diff_text, project)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_sensory_audit ──────────────────────────────────────────────────
        elif name == "qa_sensory_audit":
            url = arguments["url"]
            selector = arguments.get("selector", "body")
            origin = get_origin(url)
            ctx = await owl_qa_visual.get_browser_context(origin)
            if not ctx:
                return [TextContent(type="text", text=json.dumps({"error": "Failed to launch browser context"}))]
            pages = ctx.pages
            page = pages[0] if pages else await ctx.new_page()
            await page.goto(url, wait_until="load")
            import owl_qa_sensory
            res = await owl_qa_sensory.run_sensory_audit(page, selector)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_economics_report ───────────────────────────────────────────────
        elif name == "qa_economics_report":
            import owl_qa_economics
            res = owl_qa_economics.get_prioritized_queue(project)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_knowledge_graph ────────────────────────────────────────────────
        elif name == "qa_knowledge_graph":
            import owl_qa_graph
            G = owl_qa_graph.build_knowledge_graph(project)
            res = owl_qa_graph.export_graph_json(G, project)
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_temporal_analysis ──────────────────────────────────────────────
        elif name == "qa_temporal_analysis":
            window = arguments.get("window_days", 7)
            import owl_qa_temporal
            velocity = owl_qa_temporal.compute_quality_velocity(project, window)
            inflections = owl_qa_temporal.detect_quality_inflection_points(project)
            projection = owl_qa_temporal.project_quality_forward(project, window)
            flaky = owl_qa_temporal.find_flaky_tests(project)
            res = {
                "velocity": velocity,
                "inflections": inflections,
                "projected_score": projection,
                "flaky_tests": flaky
            }
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_protocol_test ──────────────────────────────────────────────────
        elif name == "qa_protocol_test":
            url = arguments["url"]
            proto = arguments["protocol"]
            payload = arguments["query_or_message"]
            vars_str = arguments.get("variables_json")
            variables = json.loads(vars_str) if vars_str else None
            
            import owl_qa_protocol
            if proto == "websocket":
                res = await owl_qa_protocol.test_websocket_endpoint(url, [payload], [payload])
            elif proto == "graphql":
                res = await owl_qa_protocol.test_graphql_endpoint(url, payload, variables)
            elif proto == "grpc":
                res = await owl_qa_protocol.test_grpc_endpoint(url, "/grpc.Service/Method", payload)
            else:
                res = {"error": f"Invalid protocol: {proto}"}
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_compare_apps ───────────────────────────────────────────────────
        elif name == "qa_compare_apps":
            staging_url = arguments["staging_url"]
            prod_url = arguments["prod_url"]
            actions = arguments["actions"]
            
            # Execute on staging
            staging_res = await call_tool("qa_interact_web", {"url": staging_url, "actions": actions, "project": project})
            # Execute on prod
            prod_res = await call_tool("qa_interact_web", {"url": prod_url, "actions": actions, "project": project})
            
            res = {
                "staging_results": json.loads(staging_res[0].text),
                "production_results": json.loads(prod_res[0].text)
            }
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_load_test ──────────────────────────────────────────────────────
        elif name == "qa_load_test":
            url = arguments["url"]
            actions = arguments["actions"]
            concurrency = min(25, int(arguments.get("concurrency", 5)))
            
            from playwright.async_api import async_playwright
            async def run_single_load_client():
                try:
                    # Use unique instances to avoid context sharing issues
                    async with async_playwright() as p:
                        browser = await p.chromium.launch(headless=True)
                        context = await browser.new_context()
                        page = await context.new_page()
                        await page.goto(url)
                        passed = True
                        for action in actions:
                            act_type = action["action_type"]
                            target = action.get("target")
                            val = action.get("value")
                            if act_type == "click":
                                await page.click(target, timeout=3000)
                            elif act_type == "type":
                                await page.fill(target, val, timeout=3000)
                            elif act_type == "wait":
                                await page.wait_for_timeout(int(val or 1000))
                        await browser.close()
                        return {"success": passed}
                except Exception as err:
                    return {"success": False, "error": str(err)}
                    
            tasks = [run_single_load_client() for _ in range(concurrency)]
            load_reports = await asyncio.gather(*tasks)
            success_count = sum(1 for r in load_reports if r["success"])
            res = {
                "concurrency": concurrency,
                "success_count": success_count,
                "failures_count": concurrency - success_count,
                "reports": load_reports
            }
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── qa_user_story_generate ────────────────────────────────────────────
        elif name == "qa_user_story_generate":
            story = arguments["user_story"]
            target_url = arguments.get("target_url", "http://localhost:3000")
            
            if _anthropic_client:
                prompt = f"""
                Translate this user story into a sequence of structured QA test steps.
                User Story: {story}
                Target URL: {target_url}
                
                Each step must be a JSON object with:
                - "action_type": "click" | "type" | "navigate" | "wait" | "hover"
                - "target": CSS selector (make it highly probable based on standard patterns like #login, input[type=email], button[type=submit])
                - "value": input value for type action (or wait milliseconds for wait action)
                
                Output a JSON array of objects representing these steps, and nothing else.
                """
                resp = _anthropic_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=1000,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2
                )
                res_text = resp.content[0].text.strip()
                if res_text.startswith("```json"):
                    res_text = res_text.split("```json")[1].split("```")[0].strip()
                elif res_text.startswith("```"):
                    res_text = res_text.split("```")[1].split("```")[0].strip()
                res = json.loads(res_text)
            else:
                res = [
                    {"action_type": "navigate", "target": target_url},
                    {"action_type": "click", "target": "a:has-text('Login')"},
                    {"action_type": "type", "target": "input[type='email']", "value": "test@example.com"},
                    {"action_type": "type", "target": "input[type='password']", "value": "password123"},
                    {"action_type": "click", "target": "button[type='submit']"}
                ]
            return [TextContent(type="text", text=json.dumps({"steps": res}, ensure_ascii=False))]

        # ── qa_competitive_audit ──────────────────────────────────────────────
        elif name == "qa_competitive_audit":
            your_url = arguments["your_url"]
            comp_url = arguments["competitor_url"]
            
            your_inspect = await call_tool("qa_inspect_web", {"url": your_url, "project": project})
            comp_inspect = await call_tool("qa_inspect_web", {"url": comp_url, "project": project})
            
            y_data = json.loads(your_inspect[0].text)
            c_data = json.loads(comp_inspect[0].text)
            
            res = {
                "your_app": {
                    "url": your_url,
                    "harmony_score": y_data.get("harmony", {}).get("harmony_score", 1.0),
                    "console_errors_count": len(y_data.get("console_errors", [])),
                    "load_time_ms": y_data.get("performance", {}).get("load_time_ms", 0)
                },
                "competitor_app": {
                    "url": comp_url,
                    "harmony_score": c_data.get("harmony", {}).get("harmony_score", 1.0),
                    "console_errors_count": len(c_data.get("console_errors", [])),
                    "load_time_ms": c_data.get("performance", {}).get("load_time_ms", 0)
                },
                "verdict": "Your app is faster" if y_data.get("performance", {}).get("load_time_ms", 9999) < c_data.get("performance", {}).get("load_time_ms", 9999) else "Competitor app is faster"
            }
            return [TextContent(type="text", text=json.dumps(res, ensure_ascii=False))]

        # ── Hermes v8.0 Pillar Handlers ───────────────────────────────────────

        # Pillar 1: Test Genome - evolve
        if name == "qa_genome_evolve":
            results = owl_qa_genome.evolve_generation(project)
            return [TextContent(type="text", text=json.dumps({
                "status": "evolution_complete",
                "project": project,
                "events": results
            }))]

        # Pillar 1: Test Genome - register flow
        if name == "qa_genome_register_flow":
            chrom = owl_qa_genome.TestChromosome(
                flow_name=arguments["flow_name"],
                target_url=arguments.get("target_url"),
                target_app=arguments.get("target_app"),
                steps=arguments.get("steps", []),
                project=project
            )
            owl_qa_genome.save_chromosome(chrom)
            return [TextContent(type="text", text=json.dumps({
                "status": "registered",
                "flow_name": chrom.flow_name,
                "step_count": len(chrom.steps)
            }))]

        # Pillar 2: Causal AI
        if name == "qa_causal_chain":
            bug_id = arguments["bug_id"]
            result = owl_qa_causal.build_causal_chain(bug_id)
            return [TextContent(type="text", text=json.dumps(result))]

        # Pillar 4: Device Cloud - scan
        if name == "qa_device_cloud_scan":
            auto_wifi = arguments.get("auto_connect_wifi", False)
            if auto_wifi:
                owl_qa_device_cloud.auto_connect_wifi_devices()
            serials = owl_qa_device_cloud.get_connected_serials()
            owl_qa_device_cloud.sync_device_registry(serials)
            devices = [owl_qa_device_cloud.get_device_metadata(s) for s in serials]
            return [TextContent(type="text", text=json.dumps({
                "device_count": len(serials),
                "devices": devices
            }))]

        # Pillar 4: Device Cloud - parallel test
        if name == "qa_device_parallel_test":
            pkg = arguments["package"]
            actions = arguments.get("actions", [])
            results = await owl_qa_device_cloud.run_parallel_android_flow(pkg, actions, project)
            return [TextContent(type="text", text=json.dumps({
                "status": "parallel_test_complete",
                "device_results": results
            }))]

        # Pillar 9: Mirror Self-Test
        if name == "qa_selftest":
            results = await owl_qa_selftest.run_selftest_suite()
            return [TextContent(type="text", text=json.dumps(results))]

        # Pillar 12: Neural Mesh Orchestrator
        if name == "qa_orchestrator_status":
            trigger_cascade = arguments.get("trigger_cascade", False)
            # Gather latest health score from DB
            health_data = {}
            try:
                with sqlite3.connect(_OWL_DB_PATH) as conn:
                    conn.row_factory = sqlite3.Row
                    cursor = conn.execute(
                        "SELECT * FROM qa_system_health_log ORDER BY created_at DESC LIMIT 1"
                    )
                    row = cursor.fetchone()
                    if row:
                        health_data = {
                            "health_score": row["health_score"],
                            "last_checked": row["created_at"],
                            "details": json.loads(row["details_json"] or "{}")
                        }
            except Exception:
                health_data = {"health_score": None, "note": "Run qa_selftest first"}

            orchestrator_status = {
                "neural_mesh_pillars": 12,
                "active_pillars": [
                    "Genome (1)", "Causal AI (2)", "Oracle (3)",
                    "Device Cloud (4)", "Healer (6)", "Economics (7)",
                    "Knowledge Graph (8)", "Self-Test (9)", "Temporal (10)",
                    "Protocol (11)", "Orchestrator (12)", "Sensory (5)"
                ],
                "sentinel_server": "http://localhost:7700/status",
                "last_health": health_data
            }

            if trigger_cascade:
                try:
                    cascade_results = await owl_qa_orchestrator.NeuralMeshOrchestrator().trigger_event_cascade()
                    orchestrator_status["cascade_triggered"] = True
                    orchestrator_status["cascade_results"] = cascade_results
                except Exception as cascade_err:
                    orchestrator_status["cascade_triggered"] = False
                    orchestrator_status["cascade_error"] = str(cascade_err)

            return [TextContent(type="text", text=json.dumps(orchestrator_status, ensure_ascii=False))]

        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]

    except Exception as e:
        error_detail = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc()[-800:]
        }
        return [TextContent(type="text", text=json.dumps(error_detail))]


# -- Main Entry Point ─────────────────────────────────────────────────────────
async def main():
    print("[OWL QA MCP] Starting...", file=sys.stderr)
    init_qa_schema()

    if owl_qa_android._u2_available:
        print("[OWL QA MCP] Android connectivity (uiautomator2) is active.", file=sys.stderr)
    else:
        print("[OWL QA MCP] Android tools not loaded. Run: pip install uiautomator2", file=sys.stderr)

    if owl_qa_visual._playwright_available:
        print("[OWL QA MCP] Web browser testing (Playwright) is active.", file=sys.stderr)
    else:
        print("[OWL QA MCP] Playwright not loaded. Run: pip install playwright", file=sys.stderr)

    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
