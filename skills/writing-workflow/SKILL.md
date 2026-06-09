---
name: writing-workflow
description: >
  Production writing system for Indian fiction and erotica. Complete pipeline:
  bible → outline → draft → quality gates → revision → export. Enforces grammar,
  heat calibration, voice consistency, continuity. Maintains project state across
  sessions. Triggers: write, chapter, scene, story, bible, outline, draft, revise,
  grammar check, heat check, continuity, export, fiction, erotica, hinglish.
  This is the ONLY writing skill. All other writing skills are aliases to this one.
---

# Writing Workflow v2 — Production System

> Perfection is when there's nothing to remove. Every step earns its place.

## Architecture

```
PROJECT_DIR/
├── 00-bible.json           # Series bible (characters, world, rules)
├── 01-outline.json         # Chapter-by-chapter outline
├── chapters/
│   ├── ch01/
│   │   ├── draft.md        # Working draft
│   │   └── final.md        # After quality gates
│   └── ch02/
│       └── ...
├── exports/                # Output formats
│   ├── screenplay.fountain
│   ├── audio-script.md
│   └── social-threads.md
└── .workflow-state.json    # Tracks progress, decisions, style learning
```

## Quick Reference: The 6 Stages

| Stage | What | Output |
|-------|------|--------|
| 0. Init | Create bible, characters, world | `00-bible.json` |
| 1. Outline | Chapter structure, scene breakdown | `01-outline.json` |
| 2. Draft | Write each scene | `chapters/chXX/draft.md` |
| 3. Quality | Grammar, heat, voice, continuity gates | Gate report |
| 4. Revise | Fix issues, enhance | `chapters/chXX/final.md` |
| 5. Export | Format conversion | `exports/` |

## Stage 0: Project Initialization

```bash
# Create project
mkdir -p ~/creative-writing-toolkit/projects/<series-name>
cd ~/creative-writing-toolkit/projects/<series-name>
mkdir -p chapters exports
```

Create `00-bible.json` (see `templates/bible-template.json`):
- Series name, genre, premise, setting, tone, heat level (1-4)
- Characters: name, gender, age, role, psychology, voice, heat-specific
- World: physical, social rules, sensory palette
- Continuity rules, plot structure, tone guidelines

**Quality Gate — Bible must have:**
- [ ] ≥2 characters with names, genders, voice markers
- [ ] Setting with sensory palette
- [ ] Heat level defined (1-4)
- [ ] ≥3 forbidden phrases
- [ ] ≥3 required elements

## Stage 1: Chapter Outline

For each chapter:
1. Define chapter goal (what must this chapter accomplish?)
2. Determine scenes (default 4)
3. Per scene: goal, tension target (1-10), heat target (1-4), characters, key moment, word target
4. Verify: tension rises, heat escalates, each scene has a key moment

**Tension arc:** Low → Medium → High → Resolution (never flat, never declining)
**Heat arc:** Scene 1 < Scene N (always escalates within chapter)

## Stage 2: Scene Drafting

**Scene structure (NON-NEGOTIABLE):**

1. **Opening** — Sensory grounding. Where are we? First sensation? Start with body, not explanation.
2. **Rising Action** — Small escalations. Each touch/word/glance raises stakes. Use space between actions.
3. **Key Moment** — The defining beat. Slow down. Maximum detail. Maximum sensation.
4. **Climax** — Physical/emotional peak. Sentence fragments. Sensory overload. Then silence.
5. **Aftermath** — Quiet landing. Small details. World re-enters. They've changed.

**Writing Rules (NON-NEGOTIABLE):**
- Start with sensation, not explanation
- Every sentence serves physical reality OR emotional truth (ideally both)
- **NO filter words** as primary verbs: felt, saw, heard, noticed, realized, thought, knew
- **NO AI-speak**: delve, tapestry, pivotal, crucial, robust, comprehensive, nuanced, furthermore, moreover
- **NO euphemisms** for sex: don't say "they made love" or "intimate moments"
- **Hindi body terms** in English narration: lund, chut, gaand, chod, chus
- **Hinglish dialogue**: natural code-switching, Roman script
- **Female narrator grammar**: maine boli/dekhi/puchi/ki (NOT bola/pucha/dekha/kiya)
- **Show power dynamics** in every physical interaction

## Stage 3: Quality Gates

Run in order. **Fix failures before proceeding.**

### Gate 3a: Grammar Check

**Female narrator verb forms (CRITICAL — #1 error):**

| Wrong | Right |
|-------|-------|
| maine bola | maine boli |
| maine pucha | maine puchi |
| maine dekha | maine dekhi |
| maine kiya | maine ki |
| main gaya | main gayi |
| main aaya | main aayi |
| rehta hoon | rehti hoon |
| dekhta hoon | dekhti hoon |
| karta hoon | karti hoon |
| bolta hoon | balti hoon |

**Adjective-noun gender:**

| Wrong | Right |
|-------|-------|
| bada chut | badi chut |
| bhara chut | bhari chut |
| gandh hai | gandi hai |
| gand ladki | gandi ladki |
| bada gand | badi gand |

**Fake words:** thai, 刺激, dekhtoon

**Exception:** Male character dialogue uses male forms. Check bible for genders.

### Gate 3b: Heat Calibration

| Level | Name | Density | Action Ratio |
|-------|------|---------|-------------|
| 1 | Sensual | <1.5% | <20% |
| 2 | Erotic Romance | 1.5-3% | 20-30% |
| 3 | Explicit Erotica | 3-5% | 30-40% |
| 4 | Literary Erotica | >5% | >40% |

**Metrics:**
- Explicit terms: lund, chut, gaand, chu, maal, chod, chus, boobs, cock, cunt, fuck, ass, cum
- Density: count / total_words × 100
- Action lines: ≤8 words with Hindi markers (ne, ki, ka, se, mein, ko, par)
- Ratio: action_lines / total_lines × 100

### Gate 3c: Voice Consistency

Per character in scene:
- Extract all dialogue lines
- Check avg sentence length (consistent with previous chapters?)
- Check vocabulary richness (unique words / total words)
- Flag lines that sound like a different character

### Gate 3d: Continuity Check

- Names consistent (no new names not in bible)
- Character attributes unchanged
- Timeline consistent (no age jumps)
- Position changes have explicit transitions

## Stage 4: Revision

1. Read draft + all gate reports
2. Fix every flagged issue
3. Enhance: add sensory detail where thin, sharpen dialogue, deepen interiority

## Stage 5: Final Polish

1. Read aloud (mentally) — does it flow?
2. Vary sentence length — short punches + long flows
3. Remove remaining filter words / AI-speak
4. Verify ending lands emotionally

## Stage 6: Export

| Format | Use |
|--------|-----|
| prose | Clean markdown, ready to publish |
| screenplay | Fountain format (INT./EXT., character dialogue) |
| audio-script | TTS markers, dialogue/narration labels |
| storyboard | Scene-by-scene visual briefs |
| social-threads | 270-char chunks, thread numbering |

## Power Dynamics Framework

Every physical interaction has a power dimension.

**Markers:**
- **Dominant:** stood, grabbed, pushed, commanded, ordered, forced, held, pinned
- **Submissive:** begged, pleaded, whispered, obeyed, submitted, yielded, surrender
- **Negotiating:** asked, offered, suggested, hesitated, considered
- **Resisting:** refused, pushed back, resisted, fought, struggled

**Rules:**
1. Power must be clear in every physical scene
2. Power shifts need a clear trigger
3. Most powerful moment: when submissive character *chooses* to submit
4. Power dynamics escalate across the story, never stay static

## Trope Fusion Library

See `references/trope-library.md` for full library.

**Key fusions for Indian erotica:**
- Forbidden Love × Power Exchange
- Discovery × Exhibitionism
- Voyeurism × Blackmail
- First Time × Corruption Arc
- Joint Family × Secret Identity
- Caste Tension × Forbidden Love
- Thin Walls × Competition

**Generating new fusions:**
1. Pick 2 seed tropes
2. Find the tension — what makes each work? Where do they conflict?
3. Invert: "What if the expected power dynamic is reversed?"
4. Escalate: "Start with A, escalate to B by midpoint, climax with C"
5. Unique angle: "Never done: X + Y from perspective of Z"

## Session Management

**Start of session:**
1. Load `.workflow-state.json` (use `ProjectState` from smart-tools for structured state)
2. Load `00-bible.json`
3. Identify current stage
4. Show status: "Chapter 3, Scene 2 — draft complete, awaiting grammar check"

**End of session:**
1. Save all work
2. Update `.workflow-state.json`
3. Note style observations
4. State next session's starting point

## Smart Tools Integration

For faster operations, use the smart-tools layer:

```python
import sys
sys.path.insert(0, r"C:\Users\shiva\hermes-custom-mcps\tools")
from smart_tools import smart_read, smart_search, ProjectState, SmartTodo

# Batch read all chapter drafts
results = smart_read(["chapters/ch01/final.md", "chapters/ch02/final.md"])

# Search across all chapters
results = smart_search("maine bola", ["chapters/"])  # Find grammar errors

# Track project state
state = ProjectState(".")
state.set_task("Writing chapter 4, Scene 2")
print(state.get_summary())

# Track writing tasks with dependencies
todo = SmartTodo(".")
todo.add("Draft ch4 scene 2", priority=1)
todo.add("Grammar check ch4", priority=2, depends_on=["Draft ch4 scene 2"])
```

## Quality Standards

Before any scene is marked final:
- [ ] Grammar check passes (0 errors)
- [ ] Heat level matches target
- [ ] Voice consistency verified
- [ ] Continuity verified
- [ ] No filter words as primary verbs
- [ ] No AI-speak
- [ ] Power dynamics clear
- [ ] Sensory detail in every paragraph
- [ ] Dialogue sounds like the character
- [ ] Ending lands emotionally
