# OWL MCP — Phase 8: Cleanup & Stabilization

## What Changed

### New MCP Servers
1. **owl_qa_economics** — Previously a standalone library (74 lines, 0 tools). Now a proper MCP server with 3 tools:
   - `qa_economics_report` — Full report with top bugs by debt ROI
   - `qa_economics_queue` — Raw prioritized queue from QA database
   - `qa_economics_debt_roi` — Debt ROI scoring (severity * frequency / fix_effort)

2. **owl_qa_android** — Previously a standalone library (524 lines, 0 tools). Now a proper MCP server with 12 tools:
   - `qa_android_devices` — List connected ADB devices
   - `qa_android_connect` — Connect to a device
   - `qa_android_hierarchy` — Get UI element hierarchy
   - `qa_android_screenshot` — Capture screen as WebP
   - `qa_android_tap` — Tap coordinates
   - `qa_android_tap_element` — Find and tap by resource_id or text
   - `qa_android_swipe` — Swipe in direction
   - `qa_android_type` — Type text
   - `qa_android_press` — Press key (home, back, enter)
   - `qa_android_start_app` — Launch app by package
   - `qa_android_stop_app` — Stop app by package
   - `qa_android_activity` — Get current activity

### Cleanup
- Removed dead files from root: `test_qa_server.py`, `write_nexus.py`, `nul`, `msg.txt`, `go.py`, `audit_final.py`, `check_monitors.py`, `test_unified_server.py`
- Rewrote README.md to match actual server/tool counts
- Removed phantom pillar references (owl_qa_genome.py etc. were never created)
- Accurately documented all 10 active servers and their tool counts

### Tool Count (verified)
| Server | Tools | Notes |
|--------|-------|-------|
| owl_nexus_mcp | 18 | Was 8 in README, actually 18 |
| owl_research_mcp | 13 | research_quick, research_deep, etc. |
| creative_studio_mcp | 13 | Story tools |
| owl_qa_android | 12 | NEW — was 0 (library only) |
| owl_deploy_mcp | 12 | Docker, K8s, CI/CD |
| owl_code_mcp | 11 | Code intelligence |
| owl_data_mcp | 11 | Data operations |
| owl_qa_visual | 9 | Visual QA |
| owl_unified_server | 8 | perceive, remember, recall, research, fetch, qa_test, qa_report, dream |
| owl_web_mcp | 4 | Web scraping |
| owl_sentinel_mcp | 4 | Monitoring |
| owl_qa_economics | 3 | NEW — was 0 (library only) |
| owl_qa_mcp | 4 | QA framework |
| **Total** | **~122** | |

### Known Issue
System Python 3.11 has corrupted SRE module (`AssertionError: SRE module mismatch`).
This prevents `python -m py_compile` from working. The MCP servers run fine through
Hermes's MCP subprocess which uses a different Python environment.
Fix: `uv venv .venv --python 3.11 && source .venv/Scripts/activate`

### Venv Fix
System Python 3.11 had corrupted SRE module (`AssertionError: SRE module mismatch`).
Repaired by: `uv venv .venv --python 3.11.15` then `uv pip install <deps>`.
All 13 servers now compile and pass `py_comiple` with the new venv.

### Notes
- `owl_shared_intelligence.py` (725 lines) — shared DB/schema library, imported by research and web MCPs. Not a standalone server.
- `owl_unified_daemon.py` (402 lines) — standalone file-watcher daemon with `if __name__ == "__main__"`. Not an MCP server.
- `scratch/` directory still contains old helper scripts. Harmless.
- `archive/` contains old JS server versions (v2-v5). Keep for reference.
