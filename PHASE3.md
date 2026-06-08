# OWL MCP Engineering Team — Phase 3

## Dynamic Tool Loading — Token Optimization

### Problem
All 88 MCP tools from 9 servers are loaded into every conversation turn.
Token cost: ~5,700 tokens in tool schema overhead alone.
Most tasks need 5-15 tools, not 88.

### Solution: Tiered Tool Loading

The Hermes MCP framework already supports `tools.include`/`tools.exclude` per server
(via `mcp_servers.<name>.tools.include` in config.yaml and `hermes mcp configure <server>`).
We use this to implement tiered loading.

### Tool Tiers

#### Tier 1 — Always Loaded (Core Engineering)
These servers are needed across nearly all work modes.

| Server | Tools | Tokens | Always Needed Because |
|--------|-------|--------|----------------------|
| owl-nexus | 8 | ~441 | Planning/verification for all tasks |
| owl-code | 8 | ~449 | Code analysis, build, test, review |
| owl-web | 11 | ~686 | Web fetch, scrape, extract |
| owl-research | 10 | ~657 | Research, article extraction |
| **Subtotal** | **37** | **~2,233** | |

#### Tier 2 — Domain-Specific (Load When Needed)
Enable these servers when working in their domain.

| Server | Tools | Tokens | Enable When |
|--------|-------|--------|-------------|
| owl-data | 8 | ~417 | Database work, ETL, CSV |
| owl-deploy | 9 | ~505 | Docker, K8s, CI/CD, deploy |
| creative-studio | 10 | ~987 | Creative writing, stories |
| **Subtotal** | **27** | **~1,909** | |

#### Tier 3 — Specialized (QA Only)
Only needed during testing/QA sessions.

| Server | Tools | Tokens | Enable When |
|--------|-------|--------|-------------|
| owl-qa | 24 | ~1,517 | Testing, QA, bug reproduction |
| **Subtotal** | **24** | **~1,517** | |

### Token Savings

| Configuration | Tools | Token Cost | Savings |
|--------------|-------|------------|---------|
| Current (all loaded) | 88 | ~5,659 | — |
| Tier 1 only | 37 | ~2,233 | **60.5%** |
| Tier 1 + Tier 2 | 64 | ~4,142 | **26.8%** |
| All tiers | 88 | ~5,659 | 0% |

### Workflow

**Default config:** Only Tier 1 servers enabled (owl-nexus, owl-code, owl-web, owl-research).
owl-memory is always enabled (Node.js server, separate lifecycle).

**When you need domain-specific tools:**
```
hermes mcp configure owl-data     # Interactive toggle
hermes mcp configure owl-deploy   # Interactive toggle
hermes mcp configure creative-studio
hermes mcp configure owl-qa       # Only during QA
```

**Or edit config.yaml directly:**
```yaml
mcp_servers:
  owl-data:
    enabled: true  # was false
  owl-deploy:
    enabled: true  # was false
  creative-studio:
    enabled: true  # was false
  owl-qa:
    enabled: false  # keep disabled unless testing
```

### Implementation

No code changes to MCP servers needed. The Hermes `mcp_tool.py` framework already
implements `tools.include`/`tools.exclude` filtering at registration time (line 3373).

To apply: `hermes mcp configure <server>` interactively, or set `tools.include` in config.yaml.

### Roadmap

- Phase 3.1: Document tool tiers (this file) — DONE
- Phase 3.2: Update config.yaml with tier-based defaults — NEXT
- Phase 3.3: Add tool category metadata to each server's list_tools() for self-documentation
- Phase 3.4: Build `owl doctor` command that suggests which servers to enable/disable
