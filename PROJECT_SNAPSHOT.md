# OWL MCP — Project Snapshot
> Saved: August 19, 2026
> Commit: f12247f
> Remote: github.com/gauravv-g/owl-memory-mcp

## What Is This

A focused toolkit of 5 MCP servers that give Hermes capabilities it **cannot do natively**:
- **creative-studio**: World-class writing studio (18 tools)
- **owl-research**: Deep multi-query research with article extraction (10 tools)
- **owl-web**: Stealth web scraping with Cloudflare bypass (11 tools)
- **owl-qa**: Browser automation, E2E testing, visual regression (24 tools)
- **owl-qa-android**: Android device automation via ADB (12 tools)

**Zero cloud required. Everything runs locally.**

## The Numbers

| Metric | Value |
|--------|-------|
| MCP servers | 5 (all enabled, all useful) |
| Total tools | 75 |
| Python files | 5 |
| Python lines | ~5,500 |
| Dead code | 0 |

## Servers

| Server | Tools | Why it survives |
|--------|-------|-----------------|
| creative-studio | 18 | Domain-specific writing tools Hermes can't replicate: heat calibration, Hindi/Hinglish grammar, power dynamic analysis, trope innovation library, world-class scene generation |
| owl-research | 10 | Deep multi-query research + article extraction via DuckDuckGo + newspaper3k — more capable than Hermes's web_search alone |
| owl-web | 11 | Stealth scraping, adaptive selectors, Cloudflare Turnstile bypass — Hermes physically cannot do this with built-in tools |
| owl-qa | 24 | Playwright E2E testing, visual regression, load testing, accessibility audit — requires browser automation |
| owl-qa-android | 12 | ADB/uiautomator2 — device screenshots, taps, swipes, app control |

## What Was Removed (and why)

| Server | Reason for removal |
|--------|-------------------|
| owl-agent | 0 tools registered. Dead file (429 lines). |
| owl-docs | 0 tools registered. Dead file (972 lines). |
| owl-git | 0 tools registered. Dead file (890 lines). |
| owl-security | 0 tools registered. Dead file (1,179 lines). |
| owl-workflow | 0 tools registered. Dead file (886 lines). |
| owl-code | Redundant — Hermes has execute_code, read_file, search_files built-in |
| owl-data | Redundant — Hermes can run SQL via execute_code + Python sqlite3 |
| owl-deploy | Redundant — Hermes can write Dockerfiles/CI YAML directly |
| owl-nexus | Adds latency, not capability — Hermes's execute_code handles multi-step workflows |
| owl-qa-economics | 3 math tools Hermes can do in one execute_code call |
| owl-unified | Wrapper that duplicates existing servers |
| owl-sentinel | Standalone daemon, not an MCP server |
| owl_shared_intelligence.py | Utility library only used by deleted servers |

**Net: -13 servers, -8,039 lines of dead code removed. 0% token waste.**

## Key Files

| File | Purpose |
|------|---------|
| `creative_studio_mcp.py` | 18-tool writing studio (1,644 lines) |
| `owl_research_mcp.py` | Deep research engine (1,630 lines) |
| `owl_web_mcp.py` | Web scraping with stealth (1,197 lines) |
| `owl_qa_mcp.py` | QA test framework (1,475 lines) |
| `owl_qa_android.py` | Android automation (447 lines) |
| `config.yaml` | Hermes MCP server registrations (5 servers) |

## How To Verify

```bash
# Test all servers import clean
cd hermes-custom-mcps
.venv/Scripts/python.exe -m py_compile creative_studio_mcp.py
.venv/Scripts/python.exe -m py_compile owl_research_mcp.py
.venv/Scripts/python.exe -m py_compile owl_web_mcp.py
.venv/Scripts/python.exe -m py_compile owl_qa_mcp.py
.venv/Scripts/python.exe -m py_compile owl_qa_android.py

# Test a specific server
hermes mcp test creative-studio
hermes mcp test owl-research
```

## Quality Standards

Perfection is when there's nothing to remove. Every tool in every surviving server must earn its place by doing something Hermes **cannot do with its built-in tools alone**. If a tool is just a thin wrapper around `read_file`, `execute_code`, or `web_search` — it gets cut.
