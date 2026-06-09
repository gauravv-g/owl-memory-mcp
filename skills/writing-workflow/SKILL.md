---
name: writing-workflow
description: >
  Production writing pipeline. Automatically bootstraps at session start.
  Bible → outline → draft → quality gates → revision → export.
  Enforces Hindi/Hinglish grammar, heat calibration, voice, continuity.
  Use for ALL fiction writing. Triggers on: write, chapter, scene, story,
  bible, outline, draft, revise, grammar, heat, continuity, export, fiction,
  erotica, hinglish, mohalla, gokuldham.
---

# Writing Pipeline v3

## Auto-Bootstrap (Runs Every Session)

```python
# Load and run session bootstrap
import sys
sys.path.insert(0, r"C:\Users\shiva\hermes-custom-mcp")
exec(open(r"C:\Users\shiva\hermes-custom-mcp\startup.py").read())
```

This automatically:
1. Loads project state + bible
2. Checks grammar across all chapters
3. Shows current status
4. Suggests next action

## Project Structure
```
project/
├── 00-bible.json          # Characters, world, rules
├── 01-outline.json        # Chapter/scene breakdown
├── chapters/chXX/final.md # Final drafts
└── .workflow-state.json   # Session state (auto-managed)
```

## 6 Stages

| Stage | Trigger | Output |
|-------|---------|--------|
| 0. Init | New project, no bible | `00-bible.json` |
| 1. Outline | Per chapter | `01-outline.json` |
| 2. Draft | Per scene | `chapters/chXX/draft.md` |
| 3. Quality | After every draft | Gate report |
| 4. Revise | After gates pass | `chapters/chXX/final.md` |
| 5. Export | After final | `exports/` |

## Writing Rules (NON-NEGOTIABLE)

- Start with sensation, not explanation
- Every sentence serves physical reality OR emotional truth
- **NO filter words:** felt, saw, heard, noticed, realized, thought, knew
- **NO AI-speak:** delve, tapestry, pivotal, crucial, robust, comprehensive, nuanced
- **NO euphemisms:** "they made love", "intimate moments"
- **YES explicit terms:** lund, chut, gaand, chod, chus in narration
- **YES Hinglish dialogue:** natural code-switching, Roman script
- **YES female grammar:** maine boli/dekhi/puchi/ki (NOT bola/pucha/dekha/kiya)
- Power dynamics clear in every physical interaction

## Quality Gates (run in order after EVERY draft)

1. **Grammar** — female verb forms, adj-noun gender, fake words
2. **Heat** — calibrate to target level (1-4)
3. **Voice** — per-character dialogue consistency
4. **Continuity** — names, attributes, timeline, positions

## Heat Levels

| Level | Name | Density | Approach |
|-------|------|---------|----------|
| 1 | Sensual | <1.5% | Fade-to-black |
| 2 | Erotic Romance | 1.5-3% | Explicit, character-driven |
| 3 | Explicit Erotica | 3-5% | Graphic, power-clear |
| 4 | Literary Erotica | >5% | Transcendent, poetic |

## Power Dynamics

Track per scene: dominant, submissive, negotiating, resisting.
Power shifts need clear triggers. Escalation across story.

## References
- `references/grammar-rules.md` — Full grammar tables
- `references/heat-levels.md` — Detailed heat calibration
- `references/trope-library.md` — Trope fusion library

## Templates
- `templates/bible-template.json`
- `templates/chapter-outline-template.json`
- `templates/workflow-state-template.json`
