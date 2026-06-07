"""
OWL QA Orchestrator Module (Pillar 12)
======================================
The "brain" of the Single Body Architecture (Neural Mesh).
Routes signals, logs orchestration events, and hosts status port 7700.
"""

import asyncio
import json
import sqlite3
import sys
import os
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any, Dict, List, Optional
from owl_shared_intelligence import _OWL_DB_PATH

# HTTP Status Server Handler
class StatusHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress console logging to prevent cluttering output
        return

    def do_GET(self):
        if self.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            # Retrieve latest status data from SQLite
            status_data = {"status": "healthy", "database": "connected"}
            try:
                with sqlite3.connect(_OWL_DB_PATH) as conn:
                    conn.row_factory = sqlite3.Row
                    
                    # Get last orchestration log
                    r = conn.execute("SELECT * FROM qa_orchestration_log ORDER BY created_at DESC LIMIT 1").fetchone()
                    if r:
                        status_data["last_orchestration"] = dict(r)
                        
                    # Get health score
                    r2 = conn.execute("SELECT health_score FROM qa_system_health_log ORDER BY created_at DESC LIMIT 1").fetchone()
                    if r2:
                        status_data["system_health_score"] = r2["health_score"]
            except Exception as e:
                status_data["error"] = str(e)
                status_data["status"] = "degraded"
                
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def start_status_server(port: int = 7700):
    """Starts the diagnostic HTTP status server in a daemon thread."""
    # Ensure schema is initialized before handling requests
    try:
        orch = NeuralMeshOrchestrator("default")
    except Exception as e:
        print(f"[Orchestrator] Failed to initialize schema on status startup: {e}", file=sys.stderr)
        
    def run_server():
        try:
            server = HTTPServer(("localhost", port), StatusHandler)
            print(f"[Orchestrator] Status HTTP server started on http://localhost:{port}", file=sys.stderr)
            server.serve_forever()
        except Exception as e:
            print(f"[Orchestrator] HTTP server failed to start: {e}", file=sys.stderr)

    t = Thread(target=run_server, daemon=True)
    t.start()

# Core Orchestrator Class
class NeuralMeshOrchestrator:
    def __init__(self, project: str = "default"):
        self.project = project
        self.initialize_schema()

    def initialize_schema(self):
        """Ensures the orchestration log table exists."""
        try:
            with sqlite3.connect(_OWL_DB_PATH) as conn:
                conn.execute(
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
                )
                conn.commit()
        except Exception as e:
            print(f"[Orchestrator] Schema initialization failed: {e}", file=sys.stderr)

    async def trigger_event_cascade(self, event_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Triggers the full cascade across all active pillars in the neural mesh."""
        start_time = time.time()
        activated = []
        execution_order = []
        outcome = "success"
        
        print(f"[Orchestrator] Starting event cascade for: {event_name}", file=sys.stderr)

        # Step 1: Git Commit detected → Trigger Oracle predictions
        if event_name == "git_commit":
            activated.append("Pillar 3: Oracle")
            execution_order.append("oracle.predict_bugs_from_diff")
            try:
                import owl_qa_oracle
                diff_text = payload.get("diff", "")
                if not diff_text:
                    diff_text = owl_qa_oracle.read_git_diff()
                
                # Run prediction
                preds = owl_qa_oracle.predict_bugs_from_diff(diff_text, self.project)
                print(f"[Orchestrator] Oracle predicted {len(preds)} possible failures.", file=sys.stderr)
            except Exception as err:
                print(f"[Orchestrator] Oracle stage failed: {err}", file=sys.stderr)
                outcome = "degraded"

            # Step 2: Trigger Genome evolution step
            activated.append("Pillar 1: Genome")
            execution_order.append("genome.evolve_generation")
            try:
                import owl_qa_genome
                evo_results = owl_qa_genome.evolve_generation(self.project)
                print(f"[Orchestrator] Genome generation step: {evo_results}", file=sys.stderr)
            except Exception as err:
                print(f"[Orchestrator] Genome stage failed: {err}", file=sys.stderr)
                outcome = "degraded"

        # Step 3: Test Run Finished with bugs → Trigger Causal root-cause and Economics prioritization
        elif event_name == "test_run_completed":
            bug_ids = payload.get("discovered_bug_ids", [])
            run_id = payload.get("run_id")
            
            if bug_ids:
                # Run Causal AI
                activated.append("Pillar 2: Causal AI")
                execution_order.append("causal.build_causal_chain")
                try:
                    import owl_qa_causal
                    for b_id in bug_ids:
                        causal_res = owl_qa_causal.build_causal_chain(b_id)
                        print(f"[Orchestrator] Causal reasoning finished for bug {b_id}.", file=sys.stderr)
                except Exception as err:
                    print(f"[Orchestrator] Causal stage failed: {err}", file=sys.stderr)
                    outcome = "degraded"

                # Run Economics re-ranking
                activated.append("Pillar 7: Economics")
                execution_order.append("economics.sync_bug_economics")
                try:
                    import owl_qa_economics
                    owl_qa_economics.sync_bug_economics(self.project)
                    print(f"[Orchestrator] Bug economics synced.", file=sys.stderr)
                except Exception as err:
                    print(f"[Orchestrator] Economics stage failed: {err}", file=sys.stderr)
                    outcome = "degraded"

            # Check if any step failed due to selector issue
            step_failures = payload.get("selector_failures", [])
            if step_failures:
                activated.append("Pillar 6: Self Healer")
                execution_order.append("healer.auto_apply_healing")
                try:
                    import owl_qa_healer
                    # Heal selector issues if any
                    for fail in step_failures:
                        flow_name = fail.get("flow_name")
                        step_idx = fail.get("step_index")
                        old_selector = fail.get("target_selector")
                        # Try to apply
                        # Requires page context - usually run inline during visual flow.
                        # Here we log proposal
                        owl_qa_healer.save_healing_log(flow_name, old_selector, old_selector, 0.5, False, self.project)
                except Exception as err:
                    print(f"[Orchestrator] Healer stage failed: {err}", file=sys.stderr)

        # Step 4: System Health check triggers daily
        elif event_name == "daily_maintenance":
            activated.append("Pillar 9: Self-Test")
            execution_order.append("selftest.run_selftest_suite")
            try:
                import owl_qa_selftest
                health_rep = await owl_qa_selftest.run_selftest_suite()
                print(f"[Orchestrator] Self-test complete. Health score: {health_rep.get('health_score')}%", file=sys.stderr)
            except Exception as err:
                print(f"[Orchestrator] Self-test stage failed: {err}", file=sys.stderr)
                outcome = "degraded"

            # Re-compile living knowledge graph
            activated.append("Pillar 8: Knowledge Graph")
            execution_order.append("graph.build_knowledge_graph")
            try:
                import owl_qa_graph
                G = owl_qa_graph.build_knowledge_graph(self.project)
                graph_data = owl_qa_graph.export_graph_json(G, self.project)
                # Save graph JSON representation somewhere if needed
                print(f"[Orchestrator] Knowledge Graph updated. Nodes: {graph_data['nodes_count']}", file=sys.stderr)
            except Exception as err:
                print(f"[Orchestrator] Graph update stage failed: {err}", file=sys.stderr)

        duration_ms = int((time.time() - start_time) * 1000)

        # Save orchestration log
        try:
            with sqlite3.connect(_OWL_DB_PATH) as conn:
                log_id = f"orch_{int(time.time())}"
                conn.execute(
                    """
                    INSERT INTO qa_orchestration_log 
                      (id, trigger_event, pillars_activated, execution_order, total_duration_ms, outcome, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        log_id,
                        event_name,
                        json.dumps(activated),
                        json.dumps(execution_order),
                        duration_ms,
                        outcome,
                        datetime.now(timezone.utc).isoformat()
                    )
                )
                conn.commit()
        except Exception as e:
            print(f"[Orchestrator] Log save failed: {e}", file=sys.stderr)

        return {
            "event": event_name,
            "pillars_activated": activated,
            "duration_ms": duration_ms,
            "outcome": outcome
        }
