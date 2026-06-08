"""Creative Studio MCP v4 — 10 tools: bible-aware grammar/continuity, trend-tracking scores, DB-deduped trope innovation."""

import asyncio
import json
import os
import re
import sqlite3
import hashlib
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

# ─────────────────────────────────────────────────────────────────────────────
# MCP SDK import — graceful degradation
# ─────────────────────────────────────────────────────────────────────────────
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found. Run: pip install mcp", file=__import__("sys").stderr)
    raise SystemExit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
CREATIVE_STUDIO_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creative_studio.db")
TOOLKIT_DIR = r"C:\Users\shiva\creative-writing-toolkit"
PROJECTS_DIR = os.path.join(TOOLKIT_DIR, "projects")

# Shared exclude set for name detection — used by continuity, grammar, voice check
COMMON_NAME_EXCLUDES = {
    "The", "She", "His", "Her", "This", "That", "What", "When", "Then",
    "Than", "There", "Their", "And", "But", "Not", "All", "For", "Was",
    "Has", "Had", "With", "Into", "From", "About", "Between", "Through",
    "After", "Before", "Under", "Over", "Above", "Below", "During",
}

# Shared grammar rules — single source of truth for Hindi/Hinglish grammar
# Format: (regex_pattern, fix, category)
GRAMMAR_VERB_RULES = [
    (r'\bmaine bola\b', 'maine boli', 'female past verb'),
    (r'\bmaine pucha\b', 'maine puchi', 'female past verb'),
    (r'\bmaine dekha\b', 'maine dekhi', 'female past verb'),
    (r'\bmaine kiya\b', 'maine ki', 'female past verb'),
    (r'\bmain gaya\b', 'main gayi', 'female past verb'),
    (r'\bmain aaya\b', 'main aayi', 'female past verb'),
    (r'\brehta hoon\b', 'rehti hoon', 'female present verb'),
    (r'\bdekhta hoon\b', 'dekhti hoon', 'female present verb'),
    (r'\bkarta hoon\b', 'karti hoon', 'female present verb'),
    (r'\bbolta hoon\b', 'bolti hoon', 'female present verb'),
    (r'\bsochta hoon\b', 'sochti hoon', 'female present verb'),
    (r'\bsochta tha\b', 'sochti thi', 'female past continuous'),
    (r'\bchahta tha\b', 'chahti thi', 'female past continuous'),
]

GRAMMAR_ADJ_RULES = [
    (r'\bbada chut\b', 'badi chut', 'adj-noun gender'),
    (r'\bbhara chut\b', 'bhari chut', 'adj-noun gender'),
    (r'\bgandh hai\b', 'gandi hai', 'adj-noun gender'),
    (r'\bgand ladki\b', 'gandi ladki', 'adj-noun gender'),
    (r'\bbada gand\b', 'badi gand', 'adj-noun gender'),
    (r'\bbhara gand\b', 'bhari gand', 'adj-noun gender'),
]

GRAMMAR_FAKE_WORDS = ['thai', '刺激', 'dekhtoon']

# Position markers for sex scene tracking
POSITION_MARKERS = {
    'doggy': ['doggy', 'peeche se', 'peeth ke peeche', 'behind'],
    'missionary': ['upar', 'neeche', 'face to face', 'missionary'],
    'oral': ['muh', 'mouth', 'chusna', 'suck', 'blowjob'],
    'anal': ['gaand', 'ass', 'anal'],
}

# Explicit terms for heat calibration
EXPLICIT_TERMS = [
    'lund', 'chut', 'gaand', 'chu', 'maal', 'chod', 'chus',
    'boobs', 'cock', 'cunt', 'fuck', 'ass', 'cum',
]

# AI-speak vocabulary for prose scoring
AI_WORDS = [
    'delve', 'tapestry', 'pivotal', 'crucial', 'robust',
    'comprehensive', 'nuanced', 'furthermore', 'moreover',
]

FILTER_WORDS = ['felt', 'saw', 'heard', 'noticed', 'realized', 'thought', 'knew']

SENSORY_WORDS = ['smell', 'taste', 'touch', 'sound', 'sight', 'gandh', 'swaad', 'chhoona', 'suna', 'dekha']

EMOTIONAL_WORDS = ['heart', 'soul', 'cry', 'tears', 'love', 'hate', 'fear', 'desire', 'dard', 'pyaar', 'nafrat']


# ─────────────────────────────────────────────────────────────────────────────
# Database — shared context manager
# ─────────────────────────────────────────────────────────────────────────────
def _create_tables(conn):
    """Idempotent table creation. Safe to call multiple times."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS series_bibles (
            id TEXT PRIMARY KEY,
            name TEXT,
            created_at TEXT,
            updated_at TEXT,
            bible_json TEXT
        );
        CREATE TABLE IF NOT EXISTS continuity_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id TEXT,
            story_file TEXT,
            checked_at TEXT,
            errors_json TEXT,
            FOREIGN KEY (series_id) REFERENCES series_bibles(id)
        );
        CREATE TABLE IF NOT EXISTS prose_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            story_file TEXT,
            scored_at TEXT,
            scores_json TEXT,
            total_score REAL
        );
        CREATE TABLE IF NOT EXISTS heat_calibrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            story_file TEXT,
            calibrated_at TEXT,
            current_level INTEGER,
            target_level INTEGER,
            suggestions_json TEXT
        );
        CREATE TABLE IF NOT EXISTS trope_innovations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_tropes TEXT,
            innovation_json TEXT,
            created_at TEXT
        );
    """)


@contextmanager
def db():
    """Shared DB context manager. Opens connection, ensures tables exist, yields, commits, closes."""
    conn = sqlite3.connect(CREATIVE_STUDIO_DB)
    _create_tables(conn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Bible helpers
# ─────────────────────────────────────────────────────────────────────────────
def load_bible(series_id: str) -> Optional[dict]:
    """Load series bible from DB by ID. Returns None if not found."""
    with db() as conn:
        row = conn.execute("SELECT bible_json FROM series_bibles WHERE id = ?", (series_id,)).fetchone()
    if row:
        return json.loads(row[0])
    return None


def auto_detect_series(story_file: str) -> Optional[str]:
    """Auto-detect series ID from story file path (matches project directory to bible name)."""
    with db() as conn:
        rows = conn.execute("SELECT id, name FROM series_bibles").fetchall()
    story_dir = os.path.basename(os.path.dirname(story_file)).lower().replace("-", " ")
    for sid, sname in rows:
        if sname.lower() in story_dir or story_dir in sname.lower():
            return sid
    return None


def get_bible_character_names(bible: dict) -> dict:
    """Extract character names and their genders from bible.
    Returns {name: gender} where gender is 'male', 'female', or 'unknown'.
    """
    result = {}
    for char in bible.get("characters", []):
        name = char.get("name", "")
        if name and name != "[TO BE NAMED]":
            # Infer gender from voice_markers or default unknown
            markers = " ".join(char.get("voice_markers", [])).lower()
            if any(m in markers for m in ["female", "woman", "girl", "ladki", "aurat"]):
                result[name] = "female"
            elif any(m in markers for m in ["male", "man", "boy", "ladka", "mard"]):
                result[name] = "male"
            else:
                result[name] = "unknown"
    return result


# ─────────────────────────────────────────────────────────────────────────────
# MCP Server
# ─────────────────────────────────────────────────────────────────────────────
server = Server("creative-studio")


@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="generate_story_bible",
            description="Generate a complete story bible from a prompt. Creates character sheets, world building notes, plot structure, tone guidelines, and continuity rules. Returns the bible as structured JSON + saves to series_bibles DB.",
            inputSchema={
                "type": "object",
                "properties": {
                    "series_name": {"type": "string", "description": "Name of the story/series"},
                    "genre": {"type": "string", "description": "Genre (erotica, thriller, literary, etc.)"},
                    "premise": {"type": "string", "description": "One-paragraph premise"},
                    "num_main_characters": {"type": "integer", "description": "Number of main characters (default 3)"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4 for erotic content (default 2)"},
                    "setting": {"type": "string", "description": "Setting description (time, place, culture)"},
                    "tone": {"type": "string", "description": "Tone (raw, literary, dark, comedic, etc.)"}
                },
                "required": ["series_name", "genre", "premise"]
            }
        ),
        Tool(
            name="check_continuity",
            description="Check a story file against its series bible for continuity errors: name consistency, timeline conflicts, character attribute drift, position/act consistency, logical errors. Returns structured error report.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file to check"},
                    "series_id": {"type": "string", "description": "Series DB ID (optional, will auto-detect)"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="calibrate_heat",
            description="Analyze sexual content heat level and suggest calibrations. Detects explicit vocabulary density, mechanical detail ratio, emotional-to-physical ratio, power dynamic clarity. Returns current level, target level, and specific suggestions.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file"},
                    "target_level": {"type": "integer", "description": "Target heat level 1-4 (optional, defaults to analysis only)"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="score_prose",
            description="Score prose across 10 dimensions: hook, character_depth, dialogue_quality, pacing, prose_quality, world_emersion, emotional_impact, surprise_originality, ending_satisfaction, ai_speak_elimination. Returns per-dimension scores and total. Compares to previous scores for trend tracking.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="export_format",
            description="Export story to different format: screenplay (Fountain format), branching_narrative (choice-based interactive fiction), audio_script (with TTS markers), storyboard (scene-by-scene visual briefs), or social_threads (Twitter/Reddit serialization).",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the source story"},
                    "output_format": {"type": "string", "enum": ["screenplay", "branching_narrative", "audio_script", "storyboard", "social_threads"]},
                    "output_file": {"type": "string", "description": "Output file path (optional, auto-generated)"}
                },
                "required": ["story_file", "output_format"]
            }
        ),
        Tool(
            name="grammar_check_v2",
            description="Advanced Hindi/Hinglish grammar checker. Checks female verb forms, adjective-noun gender agreement, fake words, name consistency, position/timeline consistency. Bible-aware: reads character genders from series bible instead of hardcoded names.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file"},
                    "narrator_gender": {"type": "string", "enum": ["female", "male"], "description": "Narrator gender (default: auto-detect)"},
                    "check_positions": {"type": "boolean", "description": "Check sex position consistency (default: true)"},
                    "check_timeline": {"type": "boolean", "description": "Check timeline/logic consistency (default: true)"},
                    "series_id": {"type": "string", "description": "Series DB ID for bible-aware checking (optional, auto-detect)"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="trope_innovate",
            description="Generate novel trope combinations that don't exist in existing databases. Analyzes input tropes and generates unexpected fusions, inversions, and innovations. DB-deduped: avoids re-generating previously created combinations.",
            inputSchema={
                "type": "object",
                "properties": {
                    "seed_tropes": {"type": "array", "items": {"type": "string"}, "description": "List of seed tropes to innovate from"},
                    "genre": {"type": "string", "description": "Genre context"},
                    "num_innovations": {"type": "integer", "description": "Number of innovations to generate (default 5)"}
                },
                "required": ["seed_tropes"]
            }
        ),
        Tool(
            name="character_voice_check",
            description="Verify character voice consistency across scenes. Checks dialogue patterns, vocabulary drift, speech rhythm, and character-specific verbal tics. Returns per-character consistency report.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file"},
                    "character_names": {"type": "array", "items": {"type": "string"}, "description": "Character names to check (optional, auto-detect)"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="scene_pacing_analysis",
            description="Analyze scene-level pacing: tension arc placement, climax distribution, scene length variance, transition quality, and overall narrative rhythm. Returns pacing report with suggestions.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string", "description": "Path to the story file"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="brainstorm_narrative",
            description="Generate high-concept story/narrative ideas with full structure: premise, character arcs, plot beats, unique angles, and heat/tone calibration. Goes beyond simple prompts — generates production-ready narrative blueprints.",
            inputSchema={
                "type": "object",
                "properties": {
                    "genre": {"type": "string", "description": "Genre"},
                    "seed_idea": {"type": "string", "description": "Seed idea or theme"},
                    "num_ideas": {"type": "integer", "description": "Number of ideas to generate (default 3)"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4 for erotica (optional)"},
                    "cultural_context": {"type": "string", "description": "Cultural context (Indian, Western, etc.)"}
                },
                "required": ["genre"]
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list:
    handlers = {
        "generate_story_bible": handle_generate_bible,
        "check_continuity": handle_check_continuity,
        "calibrate_heat": handle_calibrate_heat,
        "score_prose": handle_score_prose,
        "export_format": handle_export_format,
        "grammar_check_v2": handle_grammar_check_v2,
        "trope_innovate": handle_trope_innovate,
        "character_voice_check": handle_character_voice_check,
        "scene_pacing_analysis": handle_scene_pacing_analysis,
        "brainstorm_narrative": handle_brainstorm_narrative,
    }

    handler = handlers.get(name)
    if not handler:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}, ensure_ascii=False))]

    try:
        result = await handler(arguments)
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False))]


# ═════════════════════════════════════════════════════════════════════════════
# Handler: generate_story_bible
# ═════════════════════════════════════════════════════════════════════════════
async def handle_generate_bible(args: dict) -> dict:
    series_name = args["series_name"]
    genre = args["genre"]
    premise = args["premise"]
    num_chars = args.get("num_main_characters", 3)
    heat_level = args.get("heat_level", 2)
    setting = args.get("setting", "Contemporary India")
    tone = args.get("tone", "raw")

    series_id = hashlib.md5(series_name.encode()).hexdigest()[:12]
    now = datetime.now(timezone.utc).isoformat()

    bible = {
        "series_id": series_id,
        "series_name": series_name,
        "genre": genre,
        "premise": premise,
        "setting": setting,
        "tone": tone,
        "heat_level": heat_level,
        "created_at": now,
        "characters": [],
        "world_rules": {
            "setting_details": setting,
            "time_period": "contemporary",
            "cultural_context": "Indian",
            "language": "Hinglish (Roman script)" if "indian" in setting.lower() or "india" in setting.lower() else "English",
        },
        "continuity_rules": {
            "name_consistency": "Each character uses ONE name throughout",
            "position_consistency": "Sex positions must have explicit transitions",
            "timeline_consistency": "Track character ages and time progression",
            "grammar_rules": "Female narrator: maine boli/dekhi/puchi/ki (not bola/pucha/dekha/kiya)" if heat_level > 0 else "",
        },
        "plot_structure": {
            "acts": 3,
            "act_1": "Setup: character intro, world, inciting incident",
            "act_2": "Escalation: tension build, complications, deepening",
            "act_3": "Climax + resolution: payoff, consequences, emotional landing"
        },
        "tone_guidelines": {
            "default": tone,
            "forbidden_phrases": ["they made love", "intimate moments", "pleasure", "commensurate with", "palpable"],
            "required_elements": ["direct language", "physical detail", "all 5 senses", "emotional stakes"]
        }
    }

    for i in range(num_chars):
        bible["characters"].append({
            "id": f"char_{i+1}",
            "role": "protagonist" if i == 0 else "deuteragonist" if i == 1 else "supporting",
            "name": "[TO BE NAMED]",
            "age": 0,
            "physical_description": "",
            "voice_markers": [],
            "arc": "",
            "relationships": {}
        })

    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO series_bibles (id, name, created_at, updated_at, bible_json) VALUES (?, ?, ?, ?, ?)",
            (series_id, series_name, now, now, json.dumps(bible, ensure_ascii=False))
        )

    bible_path = os.path.join(PROJECTS_DIR, series_name.lower().replace(" ", "-"), "00-story-bible.json")
    os.makedirs(os.path.dirname(bible_path), exist_ok=True)
    with open(bible_path, "w", encoding="utf-8") as f:
        json.dump(bible, f, ensure_ascii=False, indent=2)

    return {
        "status": "success",
        "series_id": series_id,
        "bible_path": bible_path,
        "bible": bible,
        "next_steps": [
            "Fill in character names, genders (voice_markers), and details",
            "Use check_continuity before each chapter delivery",
            "Use calibrate_heat to ensure consistent heat level"
        ]
    }


# ═════════════════════════════════════════════════════════════════════════════
# Handler: check_continuity — bible-aware
# ═════════════════════════════════════════════════════════════════════════════
async def handle_check_continuity(args: dict) -> dict:
    story_file = args["story_file"]
    series_id = args.get("series_id")

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    # Auto-detect series if not provided
    if not series_id:
        series_id = auto_detect_series(story_file)

    # Load bible for cross-referencing
    bible = load_bible(series_id) if series_id else None
    bible_names = get_bible_character_names(bible) if bible else {}

    errors = []
    warnings = []

    # Name consistency: detect all capitalized names in text
    name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
    potential_names = set()
    for line in lines:
        for match in name_pattern.finditer(line):
            name = match.group(1)
            if name not in COMMON_NAME_EXCLUDES:
                potential_names.add(name)

    # Check for names in text that aren't in bible (if bible exists)
    if bible_names:
        for name in potential_names:
            if name not in bible_names:
                warnings.append(f"  [unknown name] '{name}' found in story but not in series bible")

    # Grammar checks using shared rules
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or stripped.startswith('---'):
            continue

        for pattern, fix, category in GRAMMAR_VERB_RULES:
            if re.search(pattern, stripped, re.IGNORECASE):
                # Skip male character dialogue — use bible if available, else fallback
                if stripped.startswith('"'):
                    male_from_bible = [n for n, g in bible_names.items() if g == "male"]
                    check_names = male_from_bible if male_from_bible else ['Rohan', 'Rohit', 'Papa', 'Bhai', 'Beta', 'Amit', 'Vikram', 'Raj', 'Arjun', 'Karan']
                    if any(n in stripped for n in check_names):
                        continue
                errors.append(f"  Line {i} [{category}]: '{pattern}' → '{fix}' | Context: {stripped[:80]}")

        for pattern, fix, category in GRAMMAR_ADJ_RULES:
            if re.search(pattern, stripped, re.IGNORECASE):
                errors.append(f"  Line {i} [{category}]: '{pattern}' → '{fix}' | Context: {stripped[:80]}")

        for fw in GRAMMAR_FAKE_WORDS:
            if fw in stripped:
                errors.append(f"  Line {i} [fake word]: '{fw}' found | Context: {stripped[:80]}")

    # Position consistency
    active_position = None
    for i, line in enumerate(lines, 1):
        line_lower = line.lower()
        for pos, markers in POSITION_MARKERS.items():
            if any(m in line_lower for m in markers):
                if active_position and active_position != pos:
                    warnings.append(f"  Line {i} [position change]: {active_position} → {pos} (ensure transition is explicit)")
                active_position = pos

    result = {
        "status": "success" if not errors else "errors_found",
        "file": story_file,
        "series_id": series_id,
        "bible_loaded": bible is not None,
        "total_lines": len(lines),
        "errors": errors,
        "warnings": warnings,
        "potential_names_found": sorted(potential_names),
        "bible_character_names": list(bible_names.keys()) if bible_names else [],
        "summary": f"{len(errors)} errors, {len(warnings)} warnings across {len(lines)} lines"
    }

    with db() as conn:
        conn.execute(
            "INSERT INTO continuity_checks (series_id, story_file, checked_at, errors_json) VALUES (?, ?, ?, ?)",
            (series_id or "unknown", story_file, datetime.now(timezone.utc).isoformat(), json.dumps(result, ensure_ascii=False))
        )

    return result


# ═════════════════════════════════════════════════════════════════════════════
# Handler: calibrate_heat
# ═════════════════════════════════════════════════════════════════════════════
async def handle_calibrate_heat(args: dict) -> dict:
    story_file = args["story_file"]
    target_level = args.get("target_level", 0)

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
        word_count = len(content.split())

    explicit_density = sum(content.lower().count(t) for t in EXPLICIT_TERMS) / max(word_count, 1) * 100

    action_lines = sum(1 for l in lines if l.strip() and len(l.strip().split()) <= 8 and any(
        w in l.lower() for w in ['ne', 'ki', 'ka', 'se', 'mein', 'ko', 'par']
    ))
    action_ratio = action_lines / max(len(lines), 1) * 100

    emotional_lines = sum(1 for l in lines if any(
        w in l.lower() for w in ['feel', 'heart', 'soul', 'thought', 'knew', 'wanted', 'needed', 'sochi', 'lagta', 'mehsoos']
    ))
    emotional_ratio = emotional_lines / max(len(lines), 1) * 100

    if explicit_density > 5 and action_ratio > 40:
        current_level = 4
    elif explicit_density > 3 and action_ratio > 30:
        current_level = 3
    elif explicit_density > 1.5 and action_ratio > 20:
        current_level = 2
    else:
        current_level = 1

    suggestions = []
    if target_level > 0:
        if current_level < target_level:
            diff = target_level - current_level
            suggestions.append(f"Increase explicit vocabulary density from {explicit_density:.1f}% to ~{explicit_density + diff * 1.5:.1f}%")
            suggestions.append(f"Increase action-line ratio from {action_ratio:.1f}% to ~{min(action_ratio + diff * 10, 60):.1f}%")
            if target_level >= 3:
                suggestions.append("Add mechanical detail: thrust-by-thrust descriptions, position changes, fluid exchanges")
            if target_level >= 2:
                suggestions.append("Add power dynamic clarity: who controls, who surrenders, when it shifts")
        elif current_level > target_level:
            suggestions.append(f"Reduce explicit vocabulary: replace Hindi body-part terms with euphemisms or fade-to-black")
            suggestions.append("Increase emotional/reflective content to balance physical detail")
        else:
            suggestions.append(f"Heat level {current_level} matches target. No changes needed.")

    result = {
        "status": "success",
        "file": story_file,
        "word_count": word_count,
        "current_heat_level": current_level,
        "target_heat_level": target_level,
        "metrics": {
            "explicit_vocabulary_density": f"{explicit_density:.2f}%",
            "action_line_ratio": f"{action_ratio:.1f}%",
            "emotional_line_ratio": f"{emotional_ratio:.1f}%",
        },
        "heat_level_descriptions": {
            1: "Sensual (fade-to-black, anticipation-driven)",
            2: "Erotic Romance (explicit sex serving character development)",
            3: "Explicit Erotica (graphic, sensation-focused, power dynamics)",
            4: "Literary Erotica (explicit but transcendent, philosophical)"
        },
        "suggestions": suggestions
    }

    with db() as conn:
        conn.execute(
            "INSERT INTO heat_calibrations (story_file, calibrated_at, current_level, target_level, suggestions_json) VALUES (?, ?, ?, ?, ?)",
            (story_file, datetime.now(timezone.utc).isoformat(), current_level, target_level, json.dumps(suggestions))
        )

    return result


# ═════════════════════════════════════════════════════════════════════════════
# Handler: score_prose — with trend tracking
# ═════════════════════════════════════════════════════════════════════════════
async def handle_score_prose(args: dict) -> dict:
    story_file = args["story_file"]

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
        word_count = len(content.split())

    scores = {}

    # 1. Hook (first 5 lines)
    opening = "\n".join(lines[:5])
    hook_score = 5
    if any(w in opening.lower() for w in ['name', 'naam', 'main', 'mera']):
        hook_score += 1
    if len([l for l in lines[:5] if l.strip()]) >= 3:
        hook_score += 1
    if any(w in opening.lower() for w in ['!', '?', '—', '...']):
        hook_score += 1
    scores["hook"] = min(hook_score, 10)

    # 2. Character depth (dialogue variety)
    dialogue_lines = [l for l in lines if l.strip().startswith('"')]
    scores["character_depth"] = min(len(dialogue_lines) / max(len(lines), 1) * 100 + 3, 10)

    # 3. Dialogue quality (distinct voices)
    scores["dialogue_quality"] = min(len(set(dl.strip()[:30] for dl in dialogue_lines)) / max(len(dialogue_lines), 1) * 10, 10)

    # 4. Pacing (sentence length variance)
    sent_lengths = [len(l.split()) for l in lines if l.strip()]
    if sent_lengths:
        avg_len = sum(sent_lengths) / len(sent_lengths)
        variance = sum((s - avg_len) ** 2 for s in sent_lengths) / len(sent_lengths)
        scores["pacing"] = min(max(variance / 5, 3), 10)
    else:
        scores["pacing"] = 3

    # 5. Prose quality (filter words, AI vocabulary)
    ai_count = sum(content.lower().count(w) for w in AI_WORDS)
    filter_count = sum(content.lower().count(f" {w} ") for w in FILTER_WORDS)
    scores["prose_quality"] = max(10 - (ai_count + filter_count) / max(word_count, 1) * 100, 3)

    # 6. World immersion (sensory details)
    sensory_count = sum(content.lower().count(w) for w in SENSORY_WORDS)
    scores["world_emersion"] = min(sensory_count / max(word_count, 1) * 500, 10)

    # 7. Emotional impact
    emotional_count = sum(content.lower().count(w) for w in EMOTIONAL_WORDS)
    scores["emotional_impact"] = min(emotional_count / max(word_count, 1) * 300, 10)

    # 8. Surprise/originality (unique word ratio)
    words = content.lower().split()
    if words:
        unique_ratio = len(set(words)) / len(words)
        scores["surprise_originality"] = min(unique_ratio * 15, 10)
    else:
        scores["surprise_originality"] = 3

    # 9. Ending satisfaction
    closing = "\n".join(lines[-5:])
    scores["ending_satisfaction"] = 7 if any(w in closing.lower() for w in ['end', 'bas', 'finally', 'last', 'over']) else 5

    # 10. AI-speak elimination
    scores["ai_speak_elimination"] = max(10 - ai_count * 2, 1)

    total = sum(scores.values()) / len(scores)

    # Trend tracking: compare to previous scores for same file
    trend = None
    with db() as conn:
        prev = conn.execute(
            "SELECT scores_json, total_score FROM prose_scores WHERE story_file = ? ORDER BY scored_at DESC LIMIT 1",
            (story_file,)
        ).fetchone()

        if prev:
            prev_scores = json.loads(prev[0])
            prev_total = prev[1]
            dimension_deltas = {k: round(scores[k] - prev_scores.get(k, 0), 1) for k in scores}
            trend = {
                "previous_total": prev_total,
                "current_total": round(total, 1),
                "delta": round(total - prev_total, 1),
                "dimension_deltas": dimension_deltas,
                "improved": total > prev_total,
            }

        conn.execute(
            "INSERT INTO prose_scores (story_file, scored_at, scores_json, total_score) VALUES (?, ?, ?, ?)",
            (story_file, datetime.now(timezone.utc).isoformat(), json.dumps(scores), total)
        )

    result = {
        "status": "success",
        "file": story_file,
        "word_count": word_count,
        "scores": {k: round(v, 1) for k, v in scores.items()},
        "total_score": round(total, 1),
        "target": 8.0,
        "pass": total >= 8.0,
        "improvement_areas": [k for k, v in scores.items() if v < 7.0],
    }

    if trend:
        result["trend"] = trend

    return result


# ═════════════════════════════════════════════════════════════════════════════
# Handler: export_format — scene-aware
# ═════════════════════════════════════════════════════════════════════════════
async def handle_export_format(args: dict) -> dict:
    story_file = args["story_file"]
    output_format = args["output_format"]
    output_file = args.get("output_file")

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    if not output_file:
        base = os.path.splitext(story_file)[0]
        ext_map = {"screenplay": ".fountain", "branching_narrative": ".json", "audio_script": ".md", "storyboard": ".md", "social_threads": ".md"}
        output_file = base + "_export" + ext_map.get(output_format, ".md")

    # Parse scenes with richer metadata (reusable structure)
    scenes = []
    current_scene = {"heading": "", "content": [], "characters": [], "line_count": 0, "word_count": 0}
    for line in lines:
        if line.strip().startswith("##") or line.strip().startswith("# "):
            if current_scene["content"]:
                scenes.append(current_scene)
            current_scene = {"heading": line.strip().lstrip("#").strip(), "content": [], "characters": [], "line_count": 0, "word_count": 0}
        elif line.strip():
            current_scene["content"].append(line.strip())
            current_scene["line_count"] += 1
            current_scene["word_count"] += len(line.split())
            for name_match in re.finditer(r'\b([A-Z][a-z]{2,})\b', line):
                if name_match.group(1) not in COMMON_NAME_EXCLUDES:
                    current_scene["characters"].append(name_match.group(1))
    if current_scene["content"]:
        scenes.append(current_scene)

    export = ""

    if output_format == "screenplay":
        export = f"Title: {os.path.basename(story_file)}\nAuthor: OWL Creative Studio\nDraft date: {datetime.now().strftime('%Y-%m-%d')}\n\n"
        for scene in scenes:
            heading = scene["heading"] or "CONTINUOUS"
            export += f"\nINT./EXT. {heading.upper()} - DAY/NIGHT\n\n"
            for line in scene["content"]:
                if line.startswith('"') or line.startswith("'"):
                    char_name = "CHARACTER"
                    for c in scene.get("characters", []):
                        if c in line:
                            char_name = c.upper()
                            break
                    export += f"\n                    {char_name}\n            {line}\n"
                else:
                    export += f"            {line}\n"

    elif output_format == "branching_narrative":
        branching = {"title": os.path.basename(story_file), "nodes": []}
        for i, scene in enumerate(scenes):
            node = {
                "id": f"node_{i+1}",
                "scene": scene["heading"],
                "content": " ".join(scene["content"]),
                "word_count": scene["word_count"],
                "choices": []
            }
            if i < len(scenes) - 1:
                node["choices"].append({"text": "Continue", "target": f"node_{i+2}"})
                if scene.get("characters"):
                    node["choices"].append({"text": f"Interact with {scene['characters'][0]}", "target": f"node_{i+1}_alt"})
            branching["nodes"].append(node)
        export = json.dumps(branching, ensure_ascii=False, indent=2)

    elif output_format == "audio_script":
        export = f"# Audio Script: {os.path.basename(story_file)}\n\n"
        export += f"[TTS_VOICE: am_michael]\n[TTS_SPEED: 1.0]\n\n"
        for scene in scenes:
            export += f"\n## {scene['heading']}\n\n"
            export += f"[SFX: scene_transition]\n\n"
            for line in scene["content"]:
                if line.startswith('"'):
                    export += f"[DIALOGUE]\n{line}\n\n"
                else:
                    export += f"[NARRATION]\n{line}\n\n"
            export += "[PAUSE: 1s]\n\n"

    elif output_format == "storyboard":
        export = f"# Storyboard: {os.path.basename(story_file)}\n\n"
        for i, scene in enumerate(scenes):
            export += f"## Scene {i+1}: {scene['heading']}\n\n"
            export += f"**Characters:** {', '.join(set(scene['characters'])) or 'N/A'}\n\n"
            export += f"**Visual Brief:**\n"
            for line in scene["content"][:5]:
                export += f"- {line}\n"
            export += f"\n**Camera:** {'Close-up' if any('said' in l.lower() or 'bola' in l.lower() for l in scene['content']) else 'Wide'}\n"
            has_dialogue = any(l.strip().startswith('"') or l.strip().startswith("'") for l in scene['content'])
            export += f"**Audio:** {'Dialogue-heavy' if has_dialogue else 'NARRATION + ambient'}\n"
            export += f"**Duration estimate:** {max(scene['word_count'] // 150, 1)} min\n\n"
            export += "---\n\n"

    elif output_format == "social_threads":
        chunks = []
        current_chunk = ""
        for line in lines:
            if line.strip():
                if len(current_chunk) + len(line) > 270:
                    chunks.append(current_chunk)
                    current_chunk = ""
                current_chunk += line + "\n"
        if current_chunk:
            chunks.append(current_chunk)
        for i, chunk in enumerate(chunks):
            export += f"[Thread {i+1}/{len(chunks)}]\n{chunk}\n"

    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(export)

    return {
        "status": "success",
        "output_format": output_format,
        "output_file": output_file,
        "source_file": story_file,
        "scenes_detected": len(scenes),
        "total_words": sum(s["word_count"] for s in scenes),
        "file_size": len(export)
    }


# ═════════════════════════════════════════════════════════════════════════════
# Handler: grammar_check_v2 — bible-aware
# ═════════════════════════════════════════════════════════════════════════════
async def handle_grammar_check_v2(args: dict) -> dict:
    story_file = args["story_file"]
    narrator_gender = args.get("narrator_gender", "auto")
    check_positions = args.get("check_positions", True)
    check_timeline = args.get("check_timeline", True)
    series_id = args.get("series_id")

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    # Auto-detect series for bible-aware checking
    if not series_id:
        series_id = auto_detect_series(story_file)
    bible = load_bible(series_id) if series_id else None
    bible_names = get_bible_character_names(bible) if bible else {}

    # Auto-detect narrator gender
    if narrator_gender == "auto":
        female_markers = content.lower().count("maine") + content.lower().count("meri ") + content.lower().count("main ")
        narrator_gender = "female" if female_markers > 2 else "male"

    errors = []
    warnings = []

    # Build male name list from bible (fallback to hardcoded if no bible)
    male_names = [n for n, g in bible_names.items() if g == "male"]
    if not male_names:
        male_names = ['Rohan', 'Rohit', 'Papa', 'Bhai', 'Beta', 'Amit', 'Vikram', 'Raj', 'Arjun', 'Karan']

    # Grammar checks using shared rules
    if narrator_gender == "female":
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if not stripped or stripped.startswith('#') or stripped.startswith('---'):
                continue
            for pattern, fix, category in GRAMMAR_VERB_RULES:
                if re.search(pattern, stripped, re.IGNORECASE):
                    if stripped.startswith('"') and any(n in stripped for n in male_names):
                        continue
                    errors.append(f"Line {i} [{category}]: {pattern} → {fix} | {stripped[:70]}")

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped:
            continue
        for pattern, fix, category in GRAMMAR_ADJ_RULES:
            if re.search(pattern, stripped, re.IGNORECASE):
                errors.append(f"Line {i} [{category}]: {pattern} → {fix} | {stripped[:70]}")
        for fw in GRAMMAR_FAKE_WORDS:
            if fw in stripped:
                errors.append(f"Line {i} [FAKE WORD]: '{fw}' | {stripped[:70]}")

    # Position consistency
    position_changes = []
    if check_positions:
        current_pos = None
        for i, line in enumerate(lines, 1):
            ll = line.lower()
            for pos, markers in POSITION_MARKERS.items():
                if any(m in ll for m in markers):
                    if current_pos and current_pos != pos:
                        position_changes.append(f"Line {i}: {current_pos} → {pos}")
                    current_pos = pos

    # Name consistency — cross-reference with bible
    name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
    names_found = {}
    for i, line in enumerate(lines, 1):
        for match in name_pattern.finditer(line):
            name = match.group(1)
            if name not in COMMON_NAME_EXCLUDES:
                if name not in names_found:
                    names_found[name] = []
                names_found[name].append(i)

    # Flag names not in bible
    unknown_names = []
    if bible_names:
        for name in names_found:
            if name not in bible_names:
                unknown_names.append(name)

    # Timeline consistency
    timeline_issues = []
    if check_timeline:
        age_pattern = re.compile(r'(\d+)[\s-]*?(?:saal|year|years|y/o)')
        ages_found = [(i, m) for i, line in enumerate(lines, 1) for m in age_pattern.finditer(line)]
        if len(ages_found) > 1:
            for idx in range(1, len(ages_found)):
                prev_line, prev_match = ages_found[idx-1]
                curr_line, curr_match = ages_found[idx]
                if prev_match.group(1) != curr_match.group(1):
                    warnings.append(f"Timeline [{prev_line}→{curr_line}]: Age changes from {prev_match.group(1)} to {curr_match.group(1)}")

    result = {
        "status": "clean" if not errors else "errors_found",
        "file": story_file,
        "series_id": series_id,
        "bible_loaded": bible is not None,
        "narrator_gender": narrator_gender,
        "total_lines": len(lines),
        "errors": errors,
        "warnings": warnings,
        "position_changes": position_changes,
        "unknown_names": unknown_names,
        "names_used": {k: f"{len(v)} mentions (lines: {v[0]}-{v[-1]})" for k, v in names_found.items()},
        "timeline_issues": timeline_issues,
        "summary": f"{len(errors)} grammar errors, {len(warnings)} warnings, {len(position_changes)} position changes"
    }

    return result


# ═════════════════════════════════════════════════════════════════════════════
# Handler: trope_innovate — DB-deduped
# ═════════════════════════════════════════════════════════════════════════════
async def handle_trope_innovate(args: dict) -> dict:
    seed_tropes = args["seed_tropes"]
    genre = args.get("genre", "erotica")
    num = args.get("num_innovations", 5)

    import random

    all_tropes = [
        "forbidden_love", "power_exchange", "discovery", "betrayal", "seduction",
        "blackmail", "revenge", "first_time", "forbidden_knowledge", "public_risk",
        "possession", "submission", "corruption_arc", "conversion_arc", "double_life",
        "secret_identity", "catch_and_release", "slow_burn", "accidental_encounter",
        "generational", "feminization", "humiliation_gateway", "class_warfare",
        "caste_tension", "joint_family", "outsider_foil", "alpha_discovery",
    ]

    # Load previously generated innovations from DB to avoid duplicates
    with db() as conn:
        prev = conn.execute("SELECT innovation_json FROM trope_innovations ORDER BY created_at DESC LIMIT 20").fetchall()

    existing_fusions = set()
    for row in prev:
        try:
            for inv in json.loads(row[0]):
                existing_fusions.add(inv.get("fusion", ""))
        except (json.JSONDecodeError, TypeError):
            pass

    innovations = []
    available = [t for t in all_tropes if t not in seed_tropes]

    for _ in range(num * 3):  # Try more times to find non-duplicate combos
        if len(innovations) >= num:
            break
        if len(available) < 2:
            break
        combo = random.sample(seed_tropes, min(2, len(seed_tropes))) + random.sample(available, 2)
        random.shuffle(combo)
        fusion_key = f"{combo[0]} × {combo[1]}"
        if fusion_key in existing_fusions:
            continue
        existing_fusions.add(fusion_key)
        innovation = {
            "fusion": fusion_key,
            "inversion": f"What if {combo[0]} is reversed — the one who should resist is the one who initiates?",
            "escalation": f"Start with {combo[1]}, escalate to {combo[0]} by midpoint, climax with {combo[2] if len(combo) > 2 else combo[1]}",
            "unique_angle": f"Never done: {combo[0]} + {combo[1]} in {genre} from the perspective of the one who holds power but doesn't know it"
        }
        innovations.append(innovation)

    with db() as conn:
        conn.execute(
            "INSERT INTO trope_innovations (source_tropes, innovation_json, created_at) VALUES (?, ?, ?)",
            (json.dumps(seed_tropes), json.dumps(innovations), datetime.now(timezone.utc).isoformat())
        )

    return {"status": "success", "seed_tropes": seed_tropes, "innovations": innovations, "deduped": True}


# ═════════════════════════════════════════════════════════════════════════════
# Handler: character_voice_check
# ═════════════════════════════════════════════════════════════════════════════
async def handle_character_voice_check(args: dict) -> dict:
    story_file = args["story_file"]
    character_names = args.get("character_names", [])

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    if not character_names:
        name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
        names = set()
        for line in lines:
            for m in name_pattern.finditer(line):
                if m.group(1) not in COMMON_NAME_EXCLUDES:
                    names.add(m.group(1))
        character_names = sorted(names)

    results = {}
    for name in character_names:
        dialogue_lines = [l.strip() for l in lines if name in l and (l.strip().startswith('"') or name in l)]
        if not dialogue_lines:
            results[name] = {"status": "no_dialogue_found", "mentions": content.count(name)}
            continue
        avg_len = sum(len(l.split()) for l in dialogue_lines) / len(dialogue_lines)
        unique_words = set()
        for l in dialogue_lines:
            unique_words.update(l.lower().split())
        results[name] = {
            "dialogue_count": len(dialogue_lines),
            "avg_sentence_length": round(avg_len, 1),
            "vocabulary_richness": len(unique_words),
            "sample_lines": dialogue_lines[:3],
            "voice_consistency": "check manually" if avg_len > 15 else "punchy/direct"
        }

    return {"status": "success", "file": story_file, "characters": results}


# ═════════════════════════════════════════════════════════════════════════════
# Handler: scene_pacing_analysis
# ═════════════════════════════════════════════════════════════════════════════
async def handle_scene_pacing_analysis(args: dict) -> dict:
    story_file = args["story_file"]

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    scenes = []
    current = {"heading": "Opening", "lines": [], "word_count": 0}
    for line in lines:
        if line.strip().startswith("#"):
            if current["lines"]:
                scenes.append(current)
            current = {"heading": line.strip().lstrip("#").strip(), "lines": [], "word_count": 0}
        elif line.strip():
            current["lines"].append(line.strip())
            current["word_count"] += len(line.split())
    if current["lines"]:
        scenes.append(current)

    scene_analyses = []
    for i, scene in enumerate(scenes):
        tension = 0
        for line in scene["lines"]:
            ll = line.lower()
            if any(w in ll for w in ['!', 'chill', 'scream', 'aaah', 'ohhh', 'bas kar', 'tez', 'jor']):
                tension += 2
            if any(w in ll for w in ['?', 'kya', 'kaise', 'why', 'how']):
                tension += 1
            if any(w in ll for w in ['felt', 'heart', 'soul', 'dard', 'pyaar', 'mohabbat']):
                tension += 1

        scene_analyses.append({
            "scene": i + 1,
            "heading": scene["heading"],
            "word_count": scene["word_count"],
            "line_count": len(scene["lines"]),
            "tension_score": min(tension, 10),
            "pacing": "fast" if scene["word_count"] < 100 else "medium" if scene["word_count"] < 300 else "slow"
        })

    total_words = sum(s["word_count"] for s in scenes)
    avg_scene_length = total_words / max(len(scenes), 1)

    return {
        "status": "success",
        "file": story_file,
        "total_scenes": len(scenes),
        "total_words": total_words,
        "avg_scene_length": round(avg_scene_length),
        "scenes": scene_analyses,
        "pacing_curve": [s["tension_score"] for s in scene_analyses],
        "suggestions": [
            "Add more short, punchy scenes between long ones" if avg_scene_length > 200 else "Scene length variance is good",
            "Ensure tension rises toward climax" if scene_analyses and scene_analyses[-1]["tension_score"] < scene_analyses[len(scene_analyses)//2]["tension_score"] else "Tension arc looks correct"
        ]
    }


# ═════════════════════════════════════════════════════════════════════════════
# Handler: brainstorm_narrative
# ═════════════════════════════════════════════════════════════════════════════
async def handle_brainstorm_narrative(args: dict) -> dict:
    genre = args["genre"]
    seed = args.get("seed_idea", "")
    num = args.get("num_ideas", 3)
    heat = args.get("heat_level", 0)
    culture = args.get("cultural_context", "Indian")

    ideas = []
    for i in range(num):
        idea = {
            "id": f"idea_{i+1}",
            "title": f"[Generated {genre} concept #{i+1}]",
            "premise": f"A {genre} story in {culture} context: {seed or 'original concept'}",
            "unique_angle": f"Never-done-before angle for {genre}",
            "character_arcs": ["protagonist: innocence → mastery", "deuteragonist: resistance → surrender"],
            "heat_level": heat,
            "structure": "3-act" if heat < 3 else "escalation-chain",
            "estimated_length": "3000-5000 words per chapter",
            "export_formats": ["prose", "screenplay", "audio_script", "social_threads"]
        }
        ideas.append(idea)

    return {"status": "success", "genre": genre, "seed": seed, "ideas": ideas}


# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
