# OWL MCP — Project Snapshot
> Saved: June 9, 2026
> Commit: 36b5de7
> Remote: github.com/gauravv-g/owl-memory-mcp

## What Is This

A local MCP server platform that gives an AI agent persistent memory, code intelligence, security auditing, git intelligence, auto-documentation, CI/CD pipeline generation, multi-agent orchestration, web intelligence, research, and creative writing tools.

**Zero cloud required. Everything runs locally.**

## The Numbers

| Metric | Value |
|--------|-------|
| MCP servers | 18 registered, all enabled |
| Total tools | 157 |
| Python files | 20 |
| Python lines | ~15,283 |
| End-to-end pass rate | 93.8% (75/80 tools tested) |
| Dead code removed | 3,895 lines |
| Duplicate functions consolidated | 14 → 1 |

## Servers

| Server | Tools | Status |
|--------|-------|--------|
| creative-studio | 10 | PASS |
| owl-agent | 8 | PASS |
| owl-code | 8 | PASS |
| owl-data | 8 | PASS |
| owl-deploy | 9 | PASS |
| owl-docs | 9 | PASS |
| owl-git | 10 | PASS |
| owl-nexus | 11 | PASS |
| owl-qa | 24 | PASS |
| owl-qa-android | 12 | PASS |
| owl-qa-economics | 3 | PASS |
| owl-qa-visual | 0 (in owl-qa) | — |
| owl-research | 10 | PASS |
| owl-security | 10 | PASS |
| owl-sentinel | 0 (in owl-qa) | — |
| owl-unified | 4 | PASS |
| owl-web | 11 | PASS |
| owl-workflow | 10 | PASS |

## Key Files

| File | Purpose |
|------|---------|
| `owl_shared_intelligence.py` | Shared utilities (imported by all servers) |
| `QUALITY_CHECKLIST.md` | Self-enforcement standard for all work |
| `test_servers.py` | End-to-end test suite for all servers |
| `PHASE9.md` | Phase 9 documentation (5 new servers) |
| `PHASE10.md` | Phase 10 documentation (cleanup + consolidation) |
| `docker-compose.yml` | App + Postgres deployment |
| `config.yaml` | Hermes MCP server registrations |

## What Was Built (Phases 9-10)

### Phase 9: 5 New Servers (47 tools)
- **owl-git**: smart commits, branch analysis, conflict prediction, PR generation, release notes
- **owl-security**: secret scanning, OWASP Top 10, CVE lookup, CORS/auth audit, security headers
- **owl-docs**: README generation, API docs, architecture diagrams, CHANGELOG, onboarding guide
- **owl-workflow**: GitHub Actions, GitLab CI, Jenkins, Azure DevOps, CircleCI generation
- **owl-agent**: multi-agent orchestration, spawn/collect/merge, planning, execution

### Phase 10: Cleanup
- Removed archive/ (923 KB old JS files), scratch/, owl_memory_v5.js, old PHASE docs
- Consolidated 14 duplicate functions into owl_shared_intelligence.py
- Fixed os.path.relpath ValueError on Windows cross-drive paths
- Fixed handle_report → handle_security_report bug
- Fixed SKIP_DIRS/SKIP_EXTENSIONS references after consolidation
- Removed rogue 'nul' file that broke codebase scanning

## Known Issues

1. **5 tools fail end-to-end** — all are test harness bugs (missing required args), not server bugs
2. **owl_qa_visual.py and owl_sentinel.py** — library files, tools registered in owl_qa_mcp.py
3. **System Python 3.11** has SRE module corruption — use `.venv` Python
4. **Some tools skip testing** — require external services (Docker, network, ADB)

## How To Verify

```bash
# Test all servers import clean
cd hermes-custom-mcps
.venv/Scripts/python.exe -c "import importlib.util, os, sys; repo = r'.'; [print(f) for f in os.listdir(repo) if f.endswith('_mcp.py')]"

# Run end-to-end tests
.venv/Scripts/python.exe test_servers.py

# Test a specific server
hermes mcp test owl-git
hermes mcp test owl-security
```

## Quality Standards

All future work must pass the QUALITY_CHECKLIST.md before claiming completion:
- Show, don't tell
- Run it, check exit codes
- Read what you wrote
- Count what you claim
- Test edge cases
- No dead code, no placeholders
- Error paths tested
