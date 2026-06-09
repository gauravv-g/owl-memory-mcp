---
name: writing-workflow
description: >
  Production writing pipeline: bible → outline → draft → quality gates → revision → export.
  Enforces Hindi/Hinglish grammar, heat calibration, voice consistency, continuity.
  Use for all fiction writing, especially Indian erotica.
---

# Writing Pipeline

## Project Structure
```
project/
├── 00-bible.json          # Characters, world, rules
├── 01-outline.json        # Chapter/scene breakdown
├── chapters/chXX/final.md # Final drafts
└── .workflow-state.json   # Session state
```

## 6 Stages

| Stage | Trigger | Output |
|-------|---------|--------|
| 0. Init | New project | `00-bible.json` |
| 1. Outline | Per chapter | `01-outline.json` |
| 2. Draft | Per scene | `chapters/chXX/draft.md` |
| 3. Quality | After draft | Gate report |
| 4. Revise | After gates | `chapters/chXX/final.md` |
| 5. Export | After final | `exports/` |

## Writing Rules (NON-NEGOTIABLE)

- Start with sensation, not explanation
- Every sentence serves physical reality OR emotional truth
- **NO:** felt, saw, heard, noticed, realized, thought, knew (filter words)
- **NO:** delve, tapestry, pivotal, crucial, robust (AI-speak)
- **NO:** "they made love", "inthem intimate moments" (euphemisms)
- **YES:** lund, chut, gaand, chod, chus in narration
- **YES:** Hinglish dialogue, Roman script
- **YES:** Female grammar → maine boli/dekhi/puchi/ki (NOT bola/pucha/dekha/kiya)
- Power dynamics clear in every physical interaction

## Quality Gates (run in order)

1. **Grammar** — female verb forms, adj-noun gender, fake words
2. **Heat** — calibrate to target level (1-4), check density/action ratios
3. **Voice** — per-character dialogue consistency
4. **Continuity** — names, attributes, timeline, positions

## Heat Levels

| Level | Name | Density | Approach |
|-------|------|---------|----------|
| 1 | Sensual | <1.5% | Fade-to-black, anticipation |
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

## Session Start/End

**Start:** Load `.workflow-state.json` + `00-bible.json`. Show current stage.
**End:** Save all work, update state, note next action.
