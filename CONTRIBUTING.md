# Contributing to OWL Memory

OWL is MIT licensed. All contributions are welcome.

---

## What to contribute

### High value
- **Benchmarks**: Run the retrieval speed benchmark and submit your results with your machine specs. Real data matters.
- **Bug reports**: Open an issue. Include your OS, Node version, Python version, and the exact error message.
- **New memory types**: OWL has 6. If you have a principled argument for a 7th, open a discussion first.
- **New tools for owl-web or owl-research**: New capabilities aligned with the existing architecture.

### Medium value
- **Connector integrations**: GitHub, Notion, Gmail — listed in the roadmap, contributions welcome.
- **Documentation**: Explanations of the neuromorphic concepts for developers new to the ideas.
- **Tests**: We need them. Any test coverage is good coverage right now.

### Low priority (will not merge)
- Cloud-first rewrites — OWL is local-first by design principle, not oversight.
- Replacing SQLite with a different DB — the local, zero-dependency constraint is intentional.
- Features that require an API key — OWL has zero required external API keys by design.

---

## How to contribute

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Test locally: `node owl_memory_v5.js` and `python owl_gateway.py`
5. Open a pull request with:
   - What you changed and why
   - How you tested it
   - Any tradeoffs you made

---

## Local setup

```bash
git clone https://github.com/gauravv-g/owl-memory-mcp.git
cd owl-memory-mcp
npm install
pip install starlette uvicorn sse-starlette mcp scrapling beautifulsoup4 lxml html2text duckduckgo-search newspaper3k lxml_html_clean
python owl_gateway.py
```

---

## Code style

- **JavaScript**: No semicolons (existing code style). `const` over `let` where possible.
- **Python**: Black-formatted. Type hints preferred.
- **Comments**: Write for the developer who reads this in 6 months with no context. That developer is probably you.

---

## Questions?

Open a GitHub Discussion. Not an issue — discussions are for questions, issues are for bugs and features.

---

*OWL is built by one person and a lot of sleep-deprived debugging. Every contribution is read and appreciated personally.*
