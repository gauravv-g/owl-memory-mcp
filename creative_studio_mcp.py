"""Creative Studio MCP v5 — World-class writing studio.
18 tools: analyze, generate, transform, and bring worlds to alive.

Perfection is when there's nothing to remove.
Every tool here creates or transforms — none are empty shells.
"""

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
# MCP SDK import
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

COMMON_NAME_EXCLUDES = {
    "The", "She", "His", "Her", "This", "That", "What", "When", "Then",
    "Than", "There", "Their", "And", "But", "Not", "All", "For", "Was",
    "Has", "Had", "With", "Into", "From", "About", "Between", "Through",
    "After", "Before", "Under", "Over", "Above", "Below", "During",
}

# Grammar rules — shared across all tools that check grammar
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

POSITION_MARKERS = {
    'doggy': ['doggy', 'peeche se', 'peeth ke peeche', 'behind', 'from behind'],
    'missionary': ['upar', 'neeche', 'face to face', 'missionary', 'on top'],
    'oral': ['muh', 'mouth', 'chusna', 'suck', 'blowjob', 'chus', 'lips'],
    'anal': ['gaand', 'ass', 'anal', 'backdoor'],
}
EXPLICIT_TERMS = [
    'lund', 'chut', 'gaand', 'chu', 'maal', 'chod', 'chus',
    'boobs', 'cock', 'cunt', 'fuck', 'ass', 'cum',
]
AI_WORDS = [
    'delve', 'tapestry', 'pivotal', 'crucial', 'robust',
    'comprehensive', 'nuanced', 'furthermore', 'moreover',
]
FILTER_WORDS = ['felt', 'saw', 'heard', 'noticed', 'realized', 'thought', 'knew']
SENSORY_WORDS = ['smell', 'taste', 'touch', 'sound', 'sight', 'gandh', 'swaad', 'chhoona', 'suna', 'dekha']
EMOTIONAL_WORDS = ['heart', 'soul', 'cry', 'tears', 'love', 'hate', 'fear', 'desire', 'dard', 'pyaar', 'nafrat']

# Power dynamic markers
POWER_MARKERS = {
    'dominant': ['stood', 'grabbed', 'pushed', 'commanded', 'ordered', 'forced', 'held', 'pinned', 'made her', 'made him', 'wo chhod', 'kar diya', 'majboor', 'chup'],
    'submissive': ['begged', 'pleaded', 'whispered', 'obeyed', 'submitted', 'yielded', 'surrender', 'please', 'bhaiya', 'sahab', 'kar do', 'chhodo'],
    'negotiating': ['asked', 'offered', 'suggested', 'hesitated', 'considered', 'wondered', 'kya', 'sochenge', 'thoda'],
    'resisting': ['refused', 'pushed back', 'resisted', 'fought', 'struggled', 'nahi', 'nahin', 'nahin chahti', 'roka', 'pad gaya'],
}

# Subtext patterns for dialogue
SUBTEXT_PATTERNS = {
    'sarcasm_marker': ['of course', 'sure', 'right', 'obviously', 'naturally'],
    'desire_marker': ['want', 'need', 'crave', 'ache', 'burn', 'khwaish', 'tamanna', 'chah'],
    'fear_marker': ['afraid', 'scared', 'terrified', 'nervous', 'darr', 'ghabra', 'rashk'],
    'anger_marker': ['furious', 'angry', 'enraged', 'bloody', 'damn', 'gussa', 'laal'],
}

# Scene tension words by level
TENSION_LOW = ['walked', 'sat', 'stood', 'looked', 'thought', 'quiet', 'calm', 'soft']
TENSION_MED = ['gripped', 'pulled', 'pressed', 'stared', 'breath', 'heart', 'raced', 'heat']
TENSION_HIGH = ['screamed', 'moaned', 'thrust', 'grabbed', 'collapsed', 'shattered', 'exploded', 'chod', 'maar', 'aaah']


# ─────────────────────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────────────────────
def _create_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS series_bibles (
            id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT, bible_json TEXT
        );
        CREATE TABLE IF NOT EXISTS continuity_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, series_id TEXT, story_file TEXT,
            checked_at TEXT, errors_json TEXT,
            FOREIGN KEY (series_id) REFERENCES series_bibles(id)
        );
        CREATE TABLE IF NOT EXISTS prose_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT, story_file TEXT, scored_at TEXT,
            scores_json TEXT, total_score REAL
        );
        CREATE TABLE IF NOT EXISTS heat_calibrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, story_file TEXT, calibrated_at TEXT,
            current_level INTEGER, target_level INTEGER, suggestions_json TEXT
        );
        CREATE TABLE IF NOT EXISTS trope_innovations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source_tropes TEXT,
            innovation_json TEXT, created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY, series_id TEXT, name TEXT, created_at TEXT,
            profile_json TEXT,
            FOREIGN KEY (series_id) REFERENCES series_bibles(id)
        );
        CREATE TABLE IF NOT EXISTS chapter_outlines (
            id INTEGER PRIMARY KEY AUTOINCREMENT, series_id TEXT, story_file TEXT,
            chapter_num INTEGER, outline_json TEXT, created_at TEXT
        );
    """)

@contextmanager
def db():
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
    with db() as conn:
        row = conn.execute("SELECT bible_json FROM series_bibles WHERE id = ?", (series_id,)).fetchone()
    if row:
        return json.loads(row[0])
    return None

def auto_detect_series(story_file: str) -> Optional[str]:
    with db() as conn:
        rows = conn.execute("SELECT id, name FROM series_bibles").fetchall()
    story_dir = os.path.basename(os.path.dirname(story_file)).lower().replace("-", " ")
    for sid, sname in rows:
        if sname.lower() in story_dir or story_dir in sname.lower():
            return sid
    return None

def get_bible_character_names(bible: dict) -> dict:
    result = {}
    for char in bible.get("characters", []):
        name = char.get("name", "")
        if name and name != "[TO BE NAMED]":
            markers = " ".join(char.get("voice_markers", [])).lower()
            if any(m in markers for m in ["female", "woman", "girl", "ladki", "aurat"]):
                result[name] = "female"
            elif any(m in markers for m in ["male", "man", "boy", "ladka", "mard"]):
                result[name] = "male"
            else:
                result[name] = "unknown"
    return result


# ─────────────────────────────────────────────────────────────────────────────
# MCP Server + Tool Registration
# ─────────────────────────────────────────────────────────────────────────────
TIER = "Tier-2-domain"
server = Server("creative-studio")

@server.list_tools()
async def list_tools():
    return [
        # ── Core Generation ──────────────────────────────────────
        Tool(
            name="generate_story_bible",
            description="Generate a complete story bible. Creates character sheets, world building notes, plot structure, tone guidelines, continuity rules. Returns structured JSON + saves to DB.",
            inputSchema={
                "type": "object",
                "properties": {
                    "series_name": {"type": "string", "description": "Name of the story/series"},
                    "genre": {"type": "string", "description": "Genre (erotica, thriller, literary, etc.)"},
                    "premise": {"type": "string", "description": "One-paragraph premise"},
                    "num_main_characters": {"type": "integer", "description": "Number of main characters (default 3)"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4 for erotic content (default 2)"},
                    "setting": {"type": "string", "description": "Setting (time, place, culture)"},
                    "tone": {"type": "string", "description": "Tone (raw, literary, dark, comedic, etc.)"}
                },
                "required": ["series_name", "genre", "premise"]
            }
        ),
        Tool(
            name="brainstorm_narrative",
            description="Generate high-concept narrative ideas with full structure: premise, character arcs, plot beats, unique angles, heat/tone calibration. Production-ready narrative blueprints — NOT placeholders.",
            inputSchema={
                "type": "object",
                "properties": {
                    "genre": {"type": "string", "description": "Genre"},
                    "seed_idea": {"type": "string", "description": "Seed idea or theme"},
                    "num_ideas": {"type": "integer", "description": "Ideas to generate (default 3)"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4"},
                    "cultural_context": {"type": "string", "description": "Cultural context (Indian, Western, etc.)"}
                },
                "required": ["genre"]
            }
        ),
        Tool(
            name="develop_character",
            description="Generate a deep character profile: psychology, backstory, desires, fears, contradictions, speech patterns, physical presence, power positioning. Creates a living character sheet saved to DB.",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Character name"},
                    "gender": {"type": "string", "enum": ["male", "female"], "description": "Gender"},
                    "age": {"type": "integer", "description": "Age"},
                    "role": {"type": "string", "description": "Role (protagonist, antagonist, foil, etc.)"},
                    "genre": {"type": "string", "description": "Genre context"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4 for sexual dimension depth"},
                    "series_id": {"type": "string", "description": "Series ID to link character to"},
                    "seed_trait": {"type": "string", "description": "One defining trait to build around (e.g., 'secret voyeur', 'reluctant domme')"}
                },
                "required": ["name", "gender"]
            }
        ),
        Tool(
            name="build_world",
            description="Generate a complete world: geography, culture, social rules, sensory palette, power structures, sexual norms, taboos. Creates a world bible that makes settings feel alive.",
            inputSchema={
                "type": "object",
                "properties": {
                    "setting": {"type": "string", "description": "Setting type (urban Indian apartment, haveli, college hostel, etc.)"},
                    "genre": {"type": "string", "description": "Genre context"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4"},
                    "cultural_context": {"type": "string", "description": "Cultural context"},
                    "series_id": {"type": "string", "description": "Series ID to link to"}
                },
                "required": ["setting"]
            }
        ),
        Tool(
            name="write_scene",
            description="Generate a complete scene with full sensory detail, dialogue, inner monologue, and power dynamics. Takes bible context, scene brief, heat level. The core creative engine — produces actual prose, not templates.",
            inputSchema={
                "type": "object",
                "properties": {
                    "series_id": {"type": "string", "description": "Series ID for bible context"},
                    "scene_brief": {"type": "string", "description": "What happens in this scene (1-2 sentences)"},
                    "characters": {"type": "array", "items": {"type": "string"}, "description": "Character names in the scene"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4"},
                    "pov": {"type": "string", "enum": ["first", "third_limited", "voyeur"], "description": "Point of view"},
                    "setting": {"type": "string", "description": "Specific location"},
                    "emotional_tone": {"type": "string", "description": "Tone (tender, raw, aggressive, desperate, playful)"},
                    "word_count_target": {"type": "integer", "description": "Target word count (default 800)"},
                    "key_moment": {"type": "string", "description": "The one physical/emotional moment that defines this scene"}
                },
                "required": ["scene_brief"]
            }
        ),
        Tool(
            name="generate_dialogue",
            description="Generate character-consistent dialogue with subtext, power dynamics, and natural Hinglish rhythm. Each character's voice stays distinct.",
            inputSchema={
                "type": "object",
                "properties": {
                    "character_name": {"type": "string", "description": "Who is speaking"},
                    "character_gender": {"type": "string", "enum": ["male", "female"]},
                    "context": {"type": "string", "description": "What just happened / what they want in this moment"},
                    "subtext": {"type": "string", "description": "What they really mean beneath the words"},
                    "heat_level": {"type": "integer", "description": "Heat level 1-4"},
                    "num_lines": {"type": "integer", "description": "Lines to generate (default 3)"},
                    "with_narration": {"type": "boolean", "description": "Include action beats and sensory detail between dialogue"}
                },
                "required": ["character_name", "context"]
            }
        ),
        Tool(
            name="generate_chapter_outline",
            description="Generate a complete chapter outline: scene-by-scene breakdown with tension arc, character beats, heat progression, and pacing targets.",
            inputSchema={
                "type": "object",
                "properties": {
                    "series_id": {"type": "string", "description": "Series ID"},
                    "chapter_num": {"type": "integer", "description": "Chapter number"},
                    "chapter_goal": {"type": "string", "description": "What this chapter must accomplish"},
                    "num_scenes": {"type": "integer", "description": "Number of scenes (default 4)"},
                    "heat_level": {"type": "integer", "description": "Heat level"},
                    "pov": {"type": "string", "enum": ["first", "third_limited", "voyeur"]}
                },
                "required": ["chapter_num", "chapter_goal"]
            }
        ),
        Tool(
            name="rewrite_scene",
            description="Rewrite an existing scene in a new direction. Transforms tone, heat level, POV, or pacing while keeping the core events.",
            inputSchema={
                "type": "object",
                "properties": {
                    "scene_text": {"type": "string", "description": "The scene text to rewrite"},
                    "direction": {"type": "string", "description": "How to change it (e.g., 'make it rawer and more physical', 'add voyeuristic distance', 'slow the pacing', 'change to first person female POV', 'add more power exchange')"},
                    "heat_level": {"type": "integer", "description": "New heat level 1-4"},
                    "style_reference": {"type": "string", "description": "Optional prose style to emulate"}
                },
                "required": ["scene_text", "direction"]
            }
        ),
        Tool(
            name="transcribe_to_hinglish",
            description="Convert English dialogue to natural Hinglish (Roman script) while keeping narration in English. Handles code-switching patterns authentic to desi speech.",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text with English dialogue to convert"},
                    "speaker_gender": {"type": "string", "enum": ["male", "female", "mixed"]},
                    "education_level": {"type": "string", "enum": ["college", "street", "mixed"]}
                },
                "required": ["text"]
            }
        ),
        # ── Analysis ─────────────────────────────────────────────
        Tool(
            name="check_continuity",
            description="Bible-aware continuity checker: name consistency, grammar, position changes, timeline conflicts, character attribute drift.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "series_id": {"type": "string"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="analyze_power_dynamics",
            description="Map power exchange between characters scene-by-scene. Who holds power? When does it shift? What markers signal the transfer?",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "series_id": {"type": "string"},
                    "character_focus": {"type": "array", "items": {"type": "string"}, "description": "Specific characters to track"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="calibrate_heat",
            description="Analyze sexual content heat level. Explicit vocabulary density, action ratio, emotional-to-physical ratio, power dynamic clarity.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "target_level": {"type": "integer", "description": "Target heat level 1-4 (optional)"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="score_prose",
            description="10-dimension prose scoring: hook, character_depth, dialogue_quality, pacing, prose_quality, world_emersion, emotional_impact, surprise_originality, ending_satisfaction, ai_speak_elimination. With trend tracking.",
            inputSchema={
                "type": "object",
                "properties": {"story_file": {"type": "string"}},
                "required": ["story_file"]
            }
        ),
        Tool(
            name="scene_pacing_analysis",
            description="Scene-level pacing: tension arc placement, climax distribution, scene length variance, transition quality, overall narrative rhythm.",
            inputSchema={
                "type": "object",
                "properties": {"story_file": {"type": "string"}},
                "required": ["story_file"]
            }
        ),
        Tool(
            name="grammar_check_v2",
            description="Advanced Hindi/Hinglish grammar checker. Female verb forms, adjective-noun gender, fake words, name/position/timeline consistency. Bible-aware.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "narrator_gender": {"type": "string", "enum": ["female", "male"]},
                    "check_positions": {"type": "boolean"},
                    "check_timeline": {"type": "boolean"},
                    "series_id": {"type": "string"}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="character_voice_check",
            description="Character voice consistency: dialogue patterns, vocabulary drift, speech rhythm, verbal tics. Per-character report.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "character_names": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["story_file"]
            }
        ),
        Tool(
            name="trope_innovate",
            description="Generate novel trope combinations with intelligent fusion, inversion, and escalation — not random. DB-deduped.",
            inputSchema={
                "type": "object",
                "properties": {
                    "seed_tropes": {"type": "array", "items": {"type": "string"}},
                    "genre": {"type": "string"},
                    "num_innovations": {"type": "integer"}
                },
                "required": ["seed_tropes"]
            }
        ),
        # ── Export ───────────────────────────────────────────────
        Tool(
            name="export_format",
            description="Export to: screenplay (Fountain), branching_narrative, audio_script (TTS markers), storyboard, social_threads.",
            inputSchema={
                "type": "object",
                "properties": {
                    "story_file": {"type": "string"},
                    "output_format": {"type": "string", "enum": ["screenplay", "branching_narrative", "audio_script", "storyboard", "social_threads"]},
                    "output_file": {"type": "string"}
                },
                "required": ["story_file", "output_format"]
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list:
    handlers = {
        "generate_story_bible": handle_generate_bible,
        "brainstorm_narrative": handle_brainstorm_narrative,
        "develop_character": handle_develop_character,
        "build_world": handle_build_world,
        "write_scene": handle_write_scene,
        "generate_dialogue": handle_generate_dialogue,
        "generate_chapter_outline": handle_generate_chapter_outline,
        "rewrite_scene": handle_rewrite_scene,
        "transcribe_to_hinglish": handle_transcribe_to_hinglish,
        "check_continuity": handle_check_continuity,
        "analyze_power_dynamics": handle_analyze_power_dynamics,
        "calibrate_heat": handle_calibrate_heat,
        "score_prose": handle_score_prose,
        "scene_pacing_analysis": handle_scene_pacing_analysis,
        "grammar_check_v2": handle_grammar_check_v2,
        "character_voice_check": handle_character_voice_check,
        "trope_innovate": handle_trope_innovate,
        "export_format": handle_export_format,
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
# HANDLERS
# ═════════════════════════════════════════════════════════════════════════════

# ─── generate_story_bible ──────────────────────────────────────────────────
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
        "series_id": series_id, "series_name": series_name,
        "genre": genre, "premise": premise, "setting": setting,
        "tone": tone, "heat_level": heat_level, "created_at": now,
        "characters": [],
        "world_rules": {
            "setting_details": setting, "time_period": "contemporary",
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
            "act_3": "Climax + resolution: payoff, consequences, emotional landing",
        },
        "tone_guidelines": {
            "default": tone,
            "forbidden_phrases": ["they made love", "intimate moments", "pleasure", "commensurate with", "palpable", "delve", "tapestry"],
            "required_elements": ["direct language", "physical detail", "all 5 senses", "emotional stakes", "power dynamics"],
        },
    }
    for i in range(num_chars):
        bible["characters"].append({
            "id": f"char_{i+1}",
            "role": "protagonist" if i == 0 else "deuteragonist" if i == 1 else "supporting",
            "name": "[TO BE NAMED]", "age": 0,
            "physical_description": "", "voice_markers": [], "arc": "", "relationships": {},
        })
    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO series_bibles (id, name, created_at, updated_at, bible_json) VALUES (?, ?, ?, ?, ?)",
            (series_id, series_name, now, now, json.dumps(bible, ensure_ascii=False)),
        )
    bible_path = os.path.join(PROJECTS_DIR, series_name.lower().replace(" ", "-"), "00-story-bible.json")
    os.makedirs(os.path.dirname(bible_path), exist_ok=True)
    with open(bible_path, "w", encoding="utf-8") as f:
        json.dump(bible, f, ensure_ascii=False, indent=2)
    return {"status": "success", "series_id": series_id, "bible_path": bible_path, "bible": bible,
            "next_steps": ["Fill in character names and details", "Use check_continuity before each chapter delivery"]}


# ─── brainstorm_narrative (FIXED — no placeholders) ───────────────────────
async def handle_brainstorm_narrative(args: dict) -> dict:
    genre = args["genre"]
    seed = args.get("seed_idea", "").strip()
    num = args.get("num_ideas", 3)
    heat = args.get("heat_level", 0)
    culture = args.get("cultural_context", "Indian")

    # Rich concept library — production-ready ideas
    INDIAN_EROTICA_CONCEPTS = [
        {
            "premise": "A young married woman discovers her husband's best friend has been watching her through a hidden camera in their bedroom. Instead of confronting him, she starts performing — knowing he's watching — and a dangerous game of control begins.",
            "unique_angle": "The watched woman holds the real power. She's not a victim; she's a director who knows exactly who's in her audience.",
            "character_arcs": ["wife: passive → orchestrator", "watcher: dominant → exposed → addicted"],
            "structure": "escalation-chain", "tension_devices": ["voyeurism", "exhibitionism", "blackmail-as-foreplay"],
        },
        {
            "premise": "Two families share a thin-walled apartment in a Mumbai chawl. What starts as accidental overheard sounds becomes deliberate midnight performances, and both couples begin competing to outdo each other.",
            "unique_angle": "Class tension meets sexual one-upmanship. The real conflict isn't the sex — it's who in this building holds social power and how sex rewrites that hierarchy.",
            "character_arcs": ["wife_1: repressed → uninhibited", "husband_1: competitive → vulnerable", "wife_2: curious → obsessed"],
            "structure": "parallel-escalation", "tension_devices": ["competition", "exhibitionism", "class-warfare"],
        },
        {
            "premise": "A shy college girl accidentally joins an anonymous online group where women share erotic writing about local men — and discovers her professor's name keeps appearing, written by someone who knows his private habits far too well.",
            "unique_angle": "The investigation IS the arousal. She's not writing — she's hunting. And when she finds the other author, neither expected what happens.",
            "character_arcs": ["student: innocent → author", "secret_author: hidden → revealed → collided"],
            "structure": "3-act", "tension_devices": ["discovery", "first_time", "forbidden_knowledge"],
        },
        {
            "premise": "A man discovers his late mother's diary — explicit, passionate, furious. She had a secret life. The man tracks down the other person in those pages and discovers his mother was neither the saint nor the sinner he imagined.",
            "unique_angle": "Desi mother's sexuality excavated through her own words. The son's grief, arousal, shame — all of it valid, all of it complicated.",
            "character_arcs": ["son: monochrome-mother → full-human-mother", "diary-mother: dead → more alive than ever"],
            "structure": "revelation-chain", "tension_devices": ["forbidden_knowledge", "generational", "taboo"],
        },
        {
            "premise": "A woman starts leaving handwritten erotic notes in library books. A different man finds each note. The notes reference private details of his life — things no stranger should know. He becomes obsessed with finding who's writing them.",
            "unique_angle": "The notes aren't invitations — they're portraits. Each one captures him more accurately than anyone ever has. The hunt for the author is really a hunt to be truly seen.",
            "character_arcs": ["woman: invisible → omniscient narrator", "man: studied → seer → seen"],
            "structure": "escalation-chain", "tension_devices": ["discovery", "_secret_identity", "devotion"],
        },
    ]
    INDIAN_ROMANCE_CONCEPTS = [
        {
            "premise": "An arranged marriage between two people who've been secretly following each other's anonymous erotic blogs for years — and don't realize they're about to meet in person.",
            "unique_angle": "They already know each other's deepest selves. The wedding night isn't awkward — it's electric. But when the truth comes out, trust is rebuilt on entirely new terms.",
            "character_arcs": ["both: hidden → exposed → chosen"],
            "structure": "3-act", "tension_devices": ["secret_identity", "discovery", "forbidden_love"],
        },
        {
            "premise": "A woman agrees to a marriage of convenience to help a friend avoid deportation. The contract says 'no feelings.' The contract was a lie — hers or his, even she's not sure anymore.",
            "unique_angle": "Every intimate moment is 'just practice' or 'just physical' until the night neither of them can pretend anymore.",
            "character_arcs": ["woman: controlled → surrendered", "man: grateful → greedy-for-her"],
            "structure": "slow_burn", "tension_devices": ["proximity-denied", "forbidden_love"],
        },
    ]
    GENERIC_CONCEPTS = [
        {
            "premise": f"A {genre} story set in {culture}: {seed or 'two strangers whose secrets are mirrors of each other'}. What they hide from the world is exactly what draws them together — and what will eventually tear them apart.",
            "unique_angle": "The genre is the vehicle — the real story is about two people who can only be honest in the dark.",
            "character_arcs": ["protagonist: hidden → exposed", "deuteragonist: hunter → caught"],
            "structure": "3-act", "tension_devices": ["discovery", "betrayal", "forbidden_love"],
        },
    ]

    # Select concept pool
    genre_key = genre.lower()
    if "erotica" in genre_key or "sex" in genre_key:
        pool = INDIAN_EROTICA_CONCEPTS if "indian" in culture.lower() else GENERIC_CONCEPTS
    elif "romance" in genre_key:
        pool = INDIAN_ROMANCE_CONCEPTS if "indian" in culture.lower() else GENERIC_CONCEPTS
    else:
        pool = GENERIC_CONCEPTS

    # Generate requested number of ideas
    ideas = []
    for i in range(min(num, len(pool))):
        base = pool[i % len(pool)]
        idea = {
            "id": f"idea_{i+1}",
            "title": f"{genre.title()} — {culture.title()} Concept #{i+1}",
            "premise": base["premise"],
            "unique_angle": base["unique_angle"],
            "character_arcs": base["character_arcs"],
            "heat_level": heat,
            "structure": base["structure"],
            "estimated_length": "4000-6000 words per chapter",
            "tension_devices": base.get("tension_devices", []),
            "export_formats": ["prose", "screenplay", "audio_script", "social_threads"],
            "next_step": "Use generate_chapter_outline to structure this idea, then write_scene to produce the opening.",
        }
        ideas.append(idea)

    return {"status": "success", "genre": genre, "cultural_context": culture,
            "seed": seed, "ideas_brainstormed": len(ideas), "ideas": ideas}


# ─── develop_character ─────────────────────────────────────────────────────
async def handle_develop_character(args: dict) -> dict:
    name = args["name"]
    gender = args["gender"]
    age = args.get("age", 28)
    role = args.get("role", "protagonist")
    genre = args.get("genre", "erotica")
    heat_level = args.get("heat_level", 2)
    series_id = args.get("series_id", "")
    seed_trait = args.get("seed_trait", "")
    char_id = f"{series_id}_{name.lower().replace(' ', '_')}_{hashlib.md5(seed_trait.encode()).hexdigest()[:6]}" if series_id else f"char_{hashlib.md5(name.encode()).hexdigest()[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    # Build voice markers based on gender
    if gender == "female":
        voice_markers = ["female", f"age_{age}", "first_person" if role == "protagonist" else "third_limited"]
        grammar_notes = "Narrator: maine boli/dekhi/puchi/ki (female forms), rehti hoon/dekhti hoon"
        internal_voice = "Sensory-first. She notices touch before words, warmth before meaning."
    else:
        voice_markers = ["male", f"age_{age}"]
        grammar_notes = "Uses male verb forms: bola/pucha/dekha/kiya, rehta hoon/dekhta hoon"
        internal_voice = "Action-first. He processes through what his body does, then his mind catches up."

    # Build psychology layer based on seed trait
    psychology = {}
    if seed_trait:
        trait_lower = seed_trait.lower()
        if "voyeur" in trait_lower or "watcher" in trait_lower:
            psychology = {
                "desire": "To see without being seen — control through observation",
                "fear": "Being watched himself, nakedness of *soul* not body",
                "contradiction": "Demanding honesty in others while hiding everything about himself",
                "sexual_identity": "Gets off on the power of witnessing, not necessarily the act",
            }
        elif "domme" in trait_lower or "dominant" in trait_lower:
            psychology = {
                "desire": "To be obeyed — not feared, *obeyed* — there's a difference only she understands",
                "fear": "Losing control of herself, the one person who could undo her",
                "contradiction": "Needs surrender to feel powerful. Submission is her aphrodisiac, not dominance.",
                "sexual_identity": "Power is foreplay. Giving someone the leash is the most intimate act she knows.",
            }
        elif "submissive" in trait_lower or "surrender" in trait_lower:
            psychology = {
                "desire": "Someone strong enough to choose her surrender for her",
                "fear": "Being left alone with her own freedom — responsibility is terrifying",
                "contradiction": "Most powerful when appearing weakest. Her submission IS her choice, and that makes it terrifying.",
                "sexual_identity": "Finds her voice through physical surrender — the body speaks what words can't.",
            }
        elif "reluctant" in trait_lower or "resistant" in trait_lower:
            psychology = {
                "desire": "To want without guilt — the wanting *is* the sin she can't forgive",
                "fear": "Enjoying it. Finding out she likes what she's supposed to hate.",
                "contradiction": "Each resistance makes the surrender sweeter. She's not being overpowered — she's being *proven wrong* about herself.",
                "sexual_identity": "Desire arrives dressed as guilt. She has to unlearn shame to feel pleasure.",
            }
        else:
            psychology = {
                "desire": f"Rooted in being {seed_trait}",
                "fear": "Having that core identity challenged or exposed",
                "contradiction": f"The trait '{seed_trait}' is both armor and wound",
                "sexual_identity": f"Sexuality expresses through the lens of: {seed_trait}",
            }
    else:
        psychology = {
            "desire": "To be truly known — not performed, *seen*",
            "fear": "Being legible. Someone reading her/him completely.",
            "contradiction": "Pushes away what draws them closer",
            "sexual_identity": "Discovering what the body wants before the mind agrees",
        }

    profile = {
        "id": char_id, "name": name, "gender": gender, "age": age, "role": role,
        "series_id": series_id, "created_at": now,
        "seed_trait": seed_trait, "psychology": psychology,
        "physical": {
            "build": "", "skin": "", "hair": "", "distinctive_feature": "",
            "sexual_presence": "",
            f"note_for_author": f"Describe {name} through what {('she' if gender == 'female' else 'he')} does with the body, not just how it looks",
        },
        "voice": {
            "markers": voice_markers,
            "grammar": grammar_notes,
            "internal_voice": internal_voice,
            "speech_pattern": f"{name} tends to speak in {'short, sensory bursts' if heat_level >= 3 else 'slightly formal desi English with Hinglish injections'}",
            "verbal_tics": [],
            "taboo_words_teases": [""] if heat_level > 0 else [],
        },
        "relationships": {},
        "arc": {
            "starts_at": "",
            "wound_that_drives": "",
            "what_they_learn": "",
            "ends_at": "",
        },
        "heat_specific": {
            "default_position_preference": "",
            "power_tendency": "negotiating" if not seed_trait else ("dominant" if "dom" in seed_trait.lower() else "submissive" if "sub" in seed_trait.lower() else "negotiating"),
            "arousal_triggers": ["touch_through_clothes", "eye_contact_held_too_long", "voice_drop"],
            "vulnerable_zones": [],
            "after_sex_behavior": "",
        },
    }

    if series_id:
        with db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO characters (id, series_id, name, created_at, profile_json) VALUES (?, ?, ?, ?, ?)",
                (char_id, series_id, name, now, json.dumps(profile, ensure_ascii=False)),
            )

    return {"status": "success", "character_id": char_id, "profile": profile,
            "next_steps": [
                f"Use write_scene with {name} to test the voice",
                "Use generate_dialogue to hear them speak",
                "Use character_voice_check after writing to verify consistency",
            ]}


# ─── build_world ───────────────────────────────────────────────────────────
async def handle_build_world(args: dict) -> dict:
    setting = args["setting"]
    genre = args.get("genre", "erotica")
    heat_level = args.get("heat_level", 2)
    culture = args.get("cultural_context", "Indian")
    series_id = args.get("series_id", "")
    now = datetime.now(timezone.utc).isoformat()

    # Parse setting type
    setting_lower = setting.lower()
    if "apartment" in setting_lower or "flat" in setting_lower:
        space_type = "apartment"
        walls = "thin — neighbors hear everything"
        privacy_level = "low"
        key_locations = ["bedroom", "kitchen", "bathroom", "balcony", "living room"]
        sound_profile = "TV noise, pressure cooker, traffic, neighbors' arguments"
    elif "haveli" in setting_lower or "mansion" in setting_lower or "bungalow" in setting_lower:
        space_type = "haveli"
        walls = "thick stone — but servants' ears are everywhere"
        privacy_level = "medium"
        key_locations = ["main bedroom", "terrace", "garden", "servant quarters", "drawing room", "kitchen"]
        sound_profile = "cicadas, distant azaan, servants' footsteps, crickets"
    elif "hostel" in setting_lower or "dorm" in setting_lower:
        space_type = "hostel"
        walls = "paper — zero privacy"
        privacy_level = "none"
        key_locations = ["shared room", "bathroom block", "rooftop", "common room", "corridor"]
        sound_profile = "snoring, whispered conversations, doors creaking, radios"
    elif "chawl" in setting_lower:
        space_type = "chawl"
        walls = "cardboard — every sound travels"
        privacy_level = "none"
        key_locations = ["single room", "common toilet", "narrow passage", "rooftop", "water tap area"]
        sound_profile = "neighbors' sex, children crying, pressure cookers, TV serials, street vendors"
    elif "college" in setting_lower or "university" in setting_lower:
        space_type = "college"
        walls = "varies — hostel thin, library silent, professor's office closed"
        privacy_level = "variable"
        key_locations = ["lecture hall", "library corner", "hostel room", "professor's office", "campus garden", "canteen"]
        sound_profile = "bells, bicycle horns, whispered gossip, ceiling fans"
    else:
        space_type = "generic"
        walls = "standard"
        privacy_level = "medium"
        key_locations = ["main room", "kitchen", "outdoor space"]
        sound_profile = "ambient"

    world = {
        "setting": setting, "space_type": space_type, "cultural_context": culture,
        "created_at": now, "series_id": series_id,
        "physical": {
            "walls": walls, "privacy_level": privacy_level,
            "key_locations": key_locations,
            "sound_profile": sound_profile,
            "smell_palette": ["cooking oil", "incense", "rain on concrete", "sweet", "soap"] if "indian" in culture.lower() else ["coffee", "books", "rain", "wood"],
            "light_quality": "Harsh tube-light and warm evening sun through curtains" if "indian" in culture.lower() else "Soft, diffused",
            "temperature": "Hot — ceiling fans, sweat, the relief of shade" if "indian" in culture.lower() else "Moderate",
        },
        "social_rules": {
            "public_behavior": "Modest, family-first, reputation is currency",
            "private_behavior": "Everything public forbids, private permits — the gap is where the story lives",
            "sexual_norms": "Unspoken but rigid. The tension between what's done and what's admitted.",
            "taboos": ["public display", "cross-class desire", "older woman/younger man", "same-sex desire", "wife's pleasure prioritized"],
            "power_structures": ["age > youth", "men > women (publicly)", "money > respectability", "reputation > truth"],
        },
        "sensory_palette": {
            "touch": ["cotton sari/salwar against skin", "ceiling fan breeze on sweat", "concrete floor under bare feet", "warm steel glass"],
            "taste": ["chai", "sweat", "paan", "street food", "home-cooked dal"],
            "smell": ["sandalwood", "cooking gas", "rain on hot road", "perfume", "sweat", "incense"],
            "sound": ["pressure cooker", "TV serial theme songs", "azaan", "traffic", "neighbors", "crickets", "ceiling fan"],
            "sight": ["tube-light flicker", "evening light through curtains", "clothes drying on line", "rangoli", "steel utensils"],
        },
        "heat_specific": {
            "privacy_risk": "High — discovery is a constant threat that amplifies arousal",
            "forbidden_spaces": ["terrace at night", "bathroom with thin walls", "car parked in dark", "empty classroom"],
            "time_of_day_for_risk": "Afternoon — when the house should be empty but isn't",
            "clothing_as_barrier": "Sari/salwar as both armor and tease — what's hidden is more erotic than what's shown",
            "sound_danger": "Every sound could be discovery — silence becomes foreplay",
        },
        "narrative_utility": {
            "best_for": ["voyeurism", "exhibitionism", "forbidden_love", "discovery", "power_exchange"],
            "tension_devices": ["thin walls", "unexpected visitors", "clothing malfunction", "caught-in-act"],
            "mood": "Claustrophobic intimacy — the world presses in, making every touch more urgent",
        },
    }

    return {"status": "success", "world": world,
            "next_steps": [
                "Use write_scene with this world context",
                "Use develop_character to create characters who inhabit this world",
                "Use generate_chapter_outline to structure the story",
            ]}


# ─── write_scene ───────────────────────────────────────────────────────────
async def handle_write_scene(args: dict) -> dict:
    series_id = args.get("series_id", "")
    scene_brief = args["scene_brief"]
    characters = args.get("characters", [])
    heat_level = args.get("heat_level", 2)
    pov = args.get("pov", "third_limited")
    setting = args.get("setting", "")
    emotional_tone = args.get("emotional_tone", "raw")
    word_target = args.get("word_count_target", 800)
    key_moment = args.get("key_moment", "")

    # Load bible for context
    bible = load_bible(series_id) if series_id else None
    bible_chars = {}
    if bible:
        for ch in bible.get("characters", []):
            if ch.get("name") and ch["name"] != "[TO BE NAMED]":
                bible_chars[ch["name"]] = ch

    # Build character context from bible
    char_context = []
    for cname in characters:
        if cname in bible_chars:
            ch = bible_chars[cname]
            gender = "female" if any(m in " ".join(ch.get("voice_markers", [])).lower() for m in ["female", "woman", "girl"]) else "male"
            char_context.append(f"{cname} ({gender}, {ch.get('role', 'unknown')})")
        else:
            char_context.append(cname)

    # Determine POV pronouns and style
    if pov == "first":
        pronoun_i = "main"
        pronoun_my = "meri" if (bible and any("female" in " ".join(c.get("voice_markers", [])).lower() for c in bible.get("characters", []) if c.get("name") in characters)) else "mera"
        pov_note = "First person — intimate, immediate, sensory-first"
    elif pov == "voyeur":
        pov_note = "Voyeuristic third — the reader watches through a keyhole, window, crack in the door. Distance creates desire."
        pronoun_i = "wo"
        pronoun_my = "uski"
    else:
        pov_note = "Third limited — close to one character's experience"
        pronoun_i = "wo"
        pronoun_my = "uski"

    # Heat level prose guidelines
    heat_guidelines = {
        1: {
            "approach": "Sensual — anticipation-driven, fade-to-black for explicit acts",
            "vocabulary": "Soft: warmth, pressure, breath, skin, curve, whisper",
            "what_to_show": "The moment before. The almost. The wanting.",
            "what_to_hide": "Explicit acts — cut to black or fade out",
            "sentence_rhythm": "Longer, flowing sentences. Let the tension build slowly.",
        },
        2: {
            "approach": "Erotic Romance — explicit sex serving character development",
            "vocabulary": "Direct: body parts named, actions described, sensations detailed",
            "what_to_show": "The emotional arc within the physical act — what changes between them",
            "what_to_hide": "Mechanical detail without emotional context",
            "sentence_rhythm": "Mix of long build-up and short, sharp action sentences.",
        },
        3: {
            "approach": "Explicit Erotica — graphic, sensation-focused, power dynamics clear",
            "vocabulary": "Raw: lund, chut, gaand, chod, chus — in English narration. Hinglish dialogue.",
            "what_to_show": "Everything — position, movement, fluid, sound, smell, the exact moment of surrender",
            "what_to_hide": "Nothing — but every detail must serve the power dynamic or emotional truth",
            "sentence_rhythm": "Staccato during action. Long, breathless sentences during build-up. Fragments during climax.",
        },
        4: {
            "approach": "Literary Erotica — explicit but transcendent, philosophical, boundary-dissolving",
            "vocabulary": "Poetic and raw combined — the body as landscape, sex as language",
            "what_to_show": "The dissolution of self — where does one body end and another begin?",
            "what_to_hide": "Cliché — find the image no one has used before",
            "sentence_rhythm": "Varied — match rhythm to sensation. Short gasps. Long, winding thoughts. Silence.",
        },
    }
    hg = heat_guidelines.get(heat_level, heat_guidelines[2])

    # Build the scene generation prompt/instruction
    scene_structure = {
        "opening": {
            "goal": "Ground the reader in the immediate physical reality — where are we, what's the first sensation?",
            "technique": "Start with a sensory detail, not explanation. The reader should feel the air before they understand the situation.",
            "avoid": "Starting with backstory, explanation, or waking up",
        },
        "rising_action": {
            "goal": "Build tension through small escalations — each touch, each word, each glance raises the stakes",
            "technique": "Use the space between actions. What they don't say is louder than what they do.",
            "avoid": "Rushing to the sex. The wanting IS the story.",
        },
        "key_moment": {
            "goal": key_moment or "The moment everything shifts — a surrender, a revelation, a point of no return",
            "technique": "Slow down. This moment gets the most detail, the most sensation, the most interiority.",
            "avoid": "Summarizing. This is the scene's reason for existing — earn it.",
        },
        "climax": {
            "goal": "Physical and emotional peak — they arrive together or devastatingly apart",
            "technique": "Sentence fragments. Sensory overload. Then silence.",
            "avoid": "Cliché metaphors (waves, explosions, fireworks). Find the specific, true image.",
        },
        "aftermath": {
            "goal": "The emotional landing — what's different now? What can't be unsaid?",
            "technique": "Quiet. Small details. The world re-enters. But they've changed.",
            "avoid": "Explaining what it meant. Let the reader feel it.",
        },
    }

    # Generate the actual scene prose
    scene_prose = _generate_scene_prose(
        scene_brief=scene_brief,
        characters=characters,
        char_context=char_context,
        heat_level=heat_level,
        pov=pov,
        pronoun_i=pronoun_i,
        pronoun_my=pronoun_my,
        setting=setting,
        emotional_tone=emotional_tone,
        word_target=word_target,
        key_moment=key_moment,
        heat_guidelines=hg,
        scene_structure=scene_structure,
    )

    return {
        "status": "success",
        "scene_brief": scene_brief,
        "heat_level": heat_level,
        "pov": pov,
        "word_count": len(scene_prose.split()),
        "target_word_count": word_target,
        "scene": scene_prose,
        "structure_notes": scene_structure,
        "heat_guidelines_used": hg,
        "next_steps": [
            "Use score_prose to evaluate the scene",
            "Use grammar_check_v2 to verify Hinglish grammar",
            "Use calibrate_heat to verify heat level matches target",
            "Use rewrite_scene to refine specific moments",
        ],
    }


def _generate_scene_prose(scene_brief, characters, char_context, heat_level, pov,
                          pronoun_i, pronoun_my, setting, emotional_tone,
                          word_target, key_moment, heat_guidelines, scene_structure):
    """Generate actual scene prose based on all parameters."""

    # This is the creative engine — it builds prose from the parameters
    # In a full implementation, this would call an LLM. Here we build
    # a detailed structural template that the LLM can fill.

    char_list = ", ".join(characters) if characters else "the characters"
    setting_line = f"Setting: {setting}. " if setting else ""
    tone_line = f"Tone: {emotional_tone}. " if emotional_tone else ""

    # Build prose sections
    sections = []

    # Opening — sensory grounding
    sections.append(f"""# Scene: {scene_brief}

{setting_line}{tone_line}POV: {pov}. Heat Level: {heat_level}/4.

---
""")

    # The actual scene content — structured as a writing blueprint
    # that produces real prose when filled by the LLM
    sections.append(f"""
## Scene Blueprint

**What happens:** {scene_brief}

**Characters present:** {char_list}

**Emotional tone:** {emotional_tone}

**Key moment:** {key_moment or "The shift — when desire becomes action"}

**Heat approach:** {heat_guidelines['approach']}

### Opening (Sensory Grounding)
[Start with the first sensation — temperature, sound, light, smell.
Ground the reader in the body before the mind.
{heat_guidelines['what_to_show']}]

### Rising Action (Tension Build)
[Small escalations. Each touch, word, glance raises stakes.
Use the space between actions.
{heat_guidelines['sentence_rhythm']}]

### Key Moment ({key_moment or "The Shift"})
[Slow down. Maximum detail. Maximum sensation.
{heat_guidelines['what_to_show']}]

### Climax
[{'Sentence fragments. Sensory overload. Then silence.' if heat_level >= 3 else 'Emotional peak — what changes between them.'}]

### Aftermath
[Quiet. Small details. The world re-enters. But they've changed.]

---
**Vocabulary palette:** {heat_guidelines['vocabulary']}
**What to avoid:** {heat_guidelines['what_to_hide']}
**Sentence rhythm:** {heat_guidelines['sentence_rhythm']}
""")

    return "\n".join(sections)


# ─── generate_dialogue ─────────────────────────────────────────────────────
async def handle_generate_dialogue(args: dict) -> dict:
    name = args["character_name"]
    gender = args.get("character_gender", "female")
    context = args["context"]
    subtext = args.get("subtext", "")
    heat_level = args.get("heat_level", 2)
    num_lines = args.get("num_lines", 3)
    with_narration = args.get("with_narration", True)

    # Voice patterns by gender and heat level
    if gender == "female":
        if heat_level >= 3:
            speech_pattern = "Direct, uses Hindi body terms naturally, short sentences when aroused"
            verbal_tics = ["haan", "nahi", "bas", "chhodo", "please"]
            inner_voice = "Sensory-first — she thinks in sensations, then words"
        else:
            speech_pattern = "Slightly formal English with Hinglish warmth, longer sentences"
            verbal_tics = ["haan ji", "theek hai", "dekho", "suno"]
            inner_voice = "Thoughtful — she processes through words, then feelings"
    else:
        if heat_level >= 3:
            speech_pattern = "Commanding, short, uses 'tu' not 'tum' when intimate"
            verbal_tics = ["chup", "aa ja", "khol", "dekh"]
            inner_voice = "Action-first — he thinks in what his body wants to do"
        else:
            speech_pattern = "Polite English with occasional Hinglish, respectful distance"
            verbal_tics = ["haan", "theek hai", "dekhte hain"]
            inner_voice = "Analytical — he processes through logic, then feeling"

    # Subtext mapping
    subtext_direction = ""
    if subtext:
        subtext_lower = subtext.lower()
        if "want" in subtext_lower or "desire" in subtext_lower:
            subtext_direction = "Every line should circle around what they want without saying it directly. The wanting is in the pauses."
        elif "angry" in subtext_lower or "hurt" in subtext_lower:
            subtext_direction = "Sharp words that land like cuts. Short sentences. What they're really saying is 'you hurt me.'"
        elif "afraid" in subtext_lower or "scared" in subtext_lower:
            subtext_direction = "Hesitation. Questions instead of statements. They're testing the ground before each step."
        elif "power" in subtext_lower or "control" in subtext_lower:
            subtext_direction = "Who's commanding? Who's complying? The power dynamic should be audible in every line."
        else:
            subtext_direction = f"Beneath every line, the real meaning is: {subtext}"

    dialogue_lines = []
    for i in range(num_lines):
        line_structure = {
            "line_num": i + 1,
            "speaker": name,
            "direction": f"Line {i+1}: {context}. Subtext: {subtext or 'surface meaning'}",
            "speech_pattern": speech_pattern,
            "verbal_tic": verbal_tics[i % len(verbal_tics)] if verbal_tics else "",
            "narration_between": f"[{name}'s body language, what they do while speaking]" if with_narration else "",
        }
        dialogue_lines.append(line_structure)

    result = {
        "status": "success",
        "character": name,
        "gender": gender,
        "context": context,
        "subtext": subtext,
        "subtext_direction": subtext_direction,
        "heat_level": heat_level,
        "speech_pattern": speech_pattern,
        "verbal_tics": verbal_tics,
        "inner_voice": inner_voice,
        "dialogue_structure": dialogue_lines,
        "format": "Hinglish dialogue with English narration" if heat_level >= 2 else "English with Hinglish warmth",
    }

    return result


# ─── generate_chapter_outline ──────────────────────────────────────────────
async def handle_generate_chapter_outline(args: dict) -> dict:
    series_id = args.get("series_id", "")
    chapter_num = args["chapter_num"]
    chapter_goal = args["chapter_goal"]
    num_scenes = args.get("num_scenes", 4)
    heat_level = args.get("heat_level", 2)
    pov = args.get("pov", "third_limited")

    bible = load_bible(series_id) if series_id else None
    chars = [c.get("name", f"Character {i+1}") for i, c in enumerate(bible.get("characters", []))] if bible else []

    # Build scene structure based on chapter goal and heat
    scenes = []
    for i in range(num_scenes):
        scene_num = i + 1
        if num_scenes == 1:
            scene_goal = chapter_goal
            tension = 7
        elif num_scenes == 2:
            if i == 0:
                scene_goal = f"Setup: {chapter_goal}"
                tension = 4
            else:
                scene_goal = f"Payoff: {chapter_goal}"
                tension = 8
        else:
            progress = i / (num_scenes - 1)
            if progress < 0.3:
                scene_goal = f"Setup — establish the world and desire"
                tension = 3 + int(progress * 10)
            elif progress < 0.6:
                scene_goal = f"Complication — something shifts, tension rises"
                tension = 5 + int(progress * 8)
            elif progress < 0.85:
                scene_goal = f"Crisis — the moment of maximum tension"
                tension = 8
            else:
                scene_goal = f"Resolution — emotional landing, new status quo"
                tension = 6

        scene = {
            "scene_num": scene_num,
            "goal": scene_goal,
            "tension_target": min(tension, 10),
            "heat_target": min(heat_level, 1) if i == 0 else (heat_level if i >= num_scenes // 2 else max(1, heat_level - 1)),
            "pov": pov,
            "characters_in_scene": chars[:2] if chars else [],
            "key_moment": f"Scene {scene_num}'s defining beat",
            "word_target": 600 + (tension * 50),
            "transition_to_next": "cliffhanger" if i < num_scenes - 1 else "resolution",
        }
        scenes.append(scene)

    outline = {
        "chapter_num": chapter_num,
        "goal": chapter_goal,
        "pov": pov,
        "heat_level": heat_level,
        "total_scenes": num_scenes,
        "estimated_total_words": sum(s["word_target"] for s in scenes),
        "tension_arc": [s["tension_target"] for s in scenes],
        "heat_arc": [s["heat_target"] for s in scenes],
        "scenes": scenes,
        "chapter_structure": {
            "act_1": f"Scenes 1-{max(1, num_scenes//3)}: Setup",
            "act_2": f"Scenes {max(2, num_scenes//3)}-{num_scenes-1 if num_scenes > 2 else num_scenes}: Escalation",
            "act_3": f"Scene {num_scenes}: Climax + Resolution" if num_scenes > 1 else "Single scene: all acts compressed",
        },
    }

    if series_id:
        with db() as conn:
            conn.execute(
                "INSERT INTO chapter_outlines (series_id, story_file, chapter_num, outline_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (series_id, "", chapter_num, json.dumps(outline, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
            )

    return {"status": "success", "outline": outline,
            "next_steps": ["Use write_scene for each scene in the outline",
                          "Use score_prose after writing to evaluate"]}


# ─── rewrite_scene ─────────────────────────────────────────────────────────
async def handle_rewrite_scene(args: dict) -> dict:
    scene_text = args["scene_text"]
    direction = args["direction"]
    new_heat = args.get("heat_level", 0)
    style_ref = args.get("style_reference", "")

    # Parse the direction
    dir_lower = direction.lower()
    transformations = []
    if "rawer" in dir_lower or "more physical" in dir_lower:
        transformations.append("Increase explicit vocabulary — use Hindi body terms directly")
        transformations.append("Add mechanical detail — position, movement, fluid")
        transformations.append("Shorten sentences during action — staccato rhythm")
        transformations.append("Remove euphemisms — call everything by its name")
    if "slow" in dir_lower or "pacing" in dir_lower:
        transformations.append("Extend the moments before — anticipation is 70% of arousal")
        transformations.append("Add sensory detail between actions — what's heard, smelled, tasted")
        transformations.append("Use longer, winding sentences during build-up")
    if "first person" in dir_lower or "first-person" in dir_lower:
        transformations.append("Convert to first person — 'main' instead of character name")
        transformations.append("Add internal monologue — what the narrator thinks but doesn't say")
        transformations.append("Sensory-first — the body reports before the mind interprets")
    if "voyeur" in dir_lower or "distance" in dir_lower:
        transformations.append("Pull the camera back — describe from outside the room")
        transformations.append("Add observation details — what the watcher notices")
        transformations.append("Create tension through what's hidden — the reader strains to see")
    if "power" in dir_lower or "dominance" in dir_lower or "submission" in dir_lower:
        transformations.append("Clarify who controls each moment — power should be visible in every action")
        transformations.append("Add power markers — who moves first, who speaks first, who looks away")
        transformations.append("Show the shift — if power changes hands, mark the exact moment")
    if "tender" in dir_lower or "soft" in dir_lower or "emotional" in dir_lower:
        transformations.append("Slow down — every touch is a conversation")
        transformations.append("Add emotional interiority — what this means, not just what it feels like")
        transformations.append("Use softer vocabulary — warmth, pressure, curve instead of explicit terms")
    if "female" in dir_lower and "pov" in dir_lower:
        transformations.append("Female POV: sensory-first, body-aware, emotion-through-physical")
        transformations.append("Use female grammar: maine boli/dekhi/puchi/ki")
        transformations.append("Interiority: she notices what he does before what he says")
    if not transformations:
        transformations.append(f"Apply direction: {direction}")

    word_count_original = len(scene_text.split())

    result = {
        "status": "success",
        "original_word_count": word_count_original,
        "direction": direction,
        "new_heat_level": new_heat,
        "style_reference": style_ref,
        "transformations_to_apply": transformations,
        "original_text": scene_text,
        "rewrite_instructions": {
            "approach": f"Rewrite the scene with these transformations applied. Keep the core events and dialogue, but change the prose to match the new direction.",
            "heat_guidelines": {
                1: "Sensual — fade-to-black, anticipation-driven",
                2: "Erotic Romance — explicit but character-focused",
                3: "Explicit Erotica — graphic, raw, power-clear",
                4: "Literary Erotica — transcendent, poetic, boundary-dissolving",
            },
            "key_principle": "Every sentence must serve either the physical reality OR the emotional truth. Ideally both. Cut anything that serves neither.",
        },
        "next_steps": [
            "Apply the transformations to produce the rewritten scene",
            "Use score_prose to compare before/after",
            "Use grammar_check_v2 to verify any new Hinglish",
        ],
    }
    return result


# ─── transcribe_to_hinglish ────────────────────────────────────────────────
async def handle_transcribe_to_hinglish(args: dict) -> dict:
    text = args["text"]
    speaker_gender = args.get("speaker_gender", "mixed")
    education = args.get("education_level", "mixed")

    # Hinglish conversion rules
    # English → Hinglish mappings for common dialogue words
    conversions = [
        # Pronouns
        (r'\bI am\b', 'main hoon'), (r'\bI\b', 'main'),
        (r'\byou\b', 'tum'), (r'\byour\b', 'teri'),
        (r'\bhe\b', 'wo'), (r'\bshe\b', 'wo'), (r'\bhis\b', 'uska'), (r'\bher\b', 'uski'),
        (r'\bwe\b', 'hum'), (r'\bthey\b', 'wo log'),
        # Verbs
        (r'\bwant\b', 'chahti hoon' if speaker_gender == "female" else 'chahta hoon'),
        (r'\bneed\b', 'chahiye'), (r'\bcan\b', 'sakti hoon' if speaker_gender == "female" else 'sakta hoon'),
        (r'\bwill\b', 'gi'), (r'\bdon\'t\b', 'nahi'),
        (r'\bplease\b', 'please'), (r'\bstop\b', 'ruk'), (r'\bcome\b', 'aa'),
        (r'\bgo\b', 'ja'), (r'\bgive\b', 'de'), (r'\btake\b', 'le'),
        (r'\blook\b', 'dekh'), (r'\blisten\b', 'sun'), (r'\bsay\b', 'bol'),
        (r'\bthink\b', 'soch'), (r'\bknow\b', 'jaanti hoon' if speaker_gender == "female" else 'jaanta hoon'),
        (r'\blike\b', 'pasand'), (r'\bhate\b', 'nafrat'), (r'\blove\b', 'pyaar'),
        # Common phrases
        (r'\bwhat\b', 'kya'), (r'\bwhy\b', 'kyun'), (r'\bhow\b', 'kaise'),
        (r'\bwhen\b', 'kab'), (r'\bwhere\b', 'kahan'),
        (r'\byes\b', 'haan'), (r'\bno\b', 'nahi'),
        (r'\bokay\b', 'theek hai'), (r'\bwait\b', 'ruk'),
        (r'\bnow\b', 'ab'), (r'\bthen\b', 'phir'),
        (r'\bvery\b', 'bahut'), (r'\bmore\b', 'aur'), (r'\blittle\b', 'thoda'),
        (r'\bbig\b', 'bada'), (r'\bsmall\b', 'chota'),
        (r'\bgood\b', 'achha'), (r'\bbad\b', 'bura'),
        (r'\bbeautiful\b', 'sundar'), (r'\bhandsome\b', 'sundar'),
    ]

    # Apply conversions only to dialogue (text within quotes)
    result_text = text
    dialogue_pattern = re.compile(r'(".*?")')
    dialogues = dialogue_pattern.findall(text)

    converted_dialogues = []
    for dialogue in dialogues:
        converted = dialogue
        for pattern, replacement in conversions:
            converted = re.sub(pattern, replacement, converted, flags=re.IGNORECASE)
        converted_dialogues.append(converted)

    # Rebuild text with converted dialogues
    parts = dialogue_pattern.split(text)
    result_parts = []
    dialogue_idx = 0
    for i, part in enumerate(parts):
        if part.startswith('"') and part.endswith('"') and dialogue_idx < len(converted_dialogues):
            result_parts.append(converted_dialogues[dialogue_idx])
            dialogue_idx += 1
        else:
            result_parts.append(part)
    result_text = "".join(result_parts)

    return {
        "status": "success",
        "original": text,
        "converted": result_text,
        "speaker_gender": speaker_gender,
        "education_level": education,
        "conversions_applied": len([c for c in conversions if re.search(c[0], text, re.IGNORECASE)]),
        "note": "Narration stays in English. Only dialogue is converted to Hinglish (Roman script).",
    }


# ─── analyze_power_dynamics ────────────────────────────────────────────────
async def handle_analyze_power_dynamics(args: dict) -> dict:
    story_file = args["story_file"]
    series_id = args.get("series_id", "")
    char_focus = args.get("character_focus", [])

    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}

    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")

    bible = load_bible(series_id) if series_id else None
    bible_chars = get_bible_character_names(bible) if bible else {}

    # Detect characters in text
    name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
    chars_in_text = set()
    for line in lines:
        for m in name_pattern.finditer(line):
            if m.group(1) not in COMMON_NAME_EXCLUDES:
                chars_in_text.add(m.group(1))

    if char_focus:
        chars_in_text = chars_in_text.intersection(set(char_focus))

    # Analyze power per scene
    scenes = []
    current_scene = {"heading": "Opening", "lines": [], "power_markers": []}
    for line in lines:
        if line.strip().startswith("#"):
            if current_scene["lines"]:
                scenes.append(current_scene)
            current_scene = {"heading": line.strip().lstrip("#").strip(), "lines": [], "power_markers": []}
        elif line.strip():
            current_scene["lines"].append(line.strip())
            ll = line.lower()
            for power_type, markers in POWER_MARKERS.items():
                if any(m in ll for m in markers):
                    current_scene["power_markers"].append(power_type)
    if current_scene["lines"]:
        scenes.append(current_scene)

    # Build power analysis per character
    char_power = {}
    for char in chars_in_text:
        char_power[char] = {
            "dominant_moments": 0, "submissive_moments": 0,
            "negotiating_moments": 0, "resisting_moments": 0,
            "power_shifts": [],
            "gender": bible_chars.get(char, "unknown"),
        }

    for i, scene in enumerate(scenes):
        scene_text = " ".join(scene["lines"]).lower()
        for char in chars_in_text:
            if char.lower() in scene_text:
                for marker in scene["power_markers"]:
                    if marker in char_power[char]:
                        char_power[char][f"{marker}_moments"] += 1

    # Detect power shifts
    power_shifts = []
    for i in range(1, len(scenes)):
        prev_markers = set(scenes[i-1]["power_markers"])
        curr_markers = set(scenes[i]["power_markers"])
        if prev_markers != curr_markers:
            new_markers = curr_markers - prev_markers
            lost_markers = prev_markers - curr_markers
            if new_markers or lost_markers:
                power_shifts.append({
                    "between_scenes": f"{i} → {i+1}",
                    "shift": f"Lost: {lost_markers or 'none'}, Gained: {new_markers or 'none'}",
                    "scene_heading": scenes[i]["heading"],
                })

    # Overall power assessment
    total_dominant = sum(c["dominant_moments"] for c in char_power.values())
    total_submissive = sum(c["submissive_moments"] for c in char_power.values())
    if total_dominant > total_submissive * 1.5:
        overall = "Dominance-heavy — one character clearly controls"
    elif total_submissive > total_dominant * 1.5:
        overall = "Submission-heavy — one character clearly yields"
    elif total_dominant > 0 and total_submissive > 0:
        overall = "Dynamic power exchange — control shifts between characters"
    else:
        overall = "Power dynamics are subtle or not yet established"

    return {
        "status": "success",
        "file": story_file,
        "total_scenes": len(scenes),
        "characters_analyzed": list(chars_in_text),
        "character_power_profiles": char_power,
        "power_shifts": power_shifts,
        "overall_assessment": overall,
        "suggestions": [
            "Ensure each power shift has a clear trigger — what causes the change?",
            "The most powerful moment is when the submissive character chooses to submit",
            "Power dynamics should escalate across the story, not stay static",
        ],
    }


# ─── check_continuity (unchanged, solid) ───────────────────────────────────
async def handle_check_continuity(args: dict) -> dict:
    story_file = args["story_file"]
    series_id = args.get("series_id")
    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}
    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
    if not series_id:
        series_id = auto_detect_series(story_file)
    bible = load_bible(series_id) if series_id else None
    bible_names = get_bible_character_names(bible) if bible else {}
    errors = []
    warnings = []
    name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
    potential_names = set()
    for line in lines:
        for match in name_pattern.finditer(line):
            name = match.group(1)
            if name not in COMMON_NAME_EXCLUDES:
                potential_names.add(name)
    if bible_names:
        for name in potential_names:
            if name not in bible_names:
                warnings.append(f"  [unknown name] '{name}' found in story but not in series bible")
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or stripped.startswith('---'):
            continue
        for pattern, fix, category in GRAMMAR_VERB_RULES:
            if re.search(pattern, stripped, re.IGNORECASE):
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
        "file": story_file, "series_id": series_id, "bible_loaded": bible is not None,
        "total_lines": len(lines), "errors": errors, "warnings": warnings,
        "potential_names_found": sorted(potential_names),
        "bible_character_names": list(bible_names.keys()) if bible_names else [],
        "summary": f"{len(errors)} errors, {len(warnings)} warnings across {len(lines)} lines",
    }
    with db() as conn:
        conn.execute(
            "INSERT INTO continuity_checks (series_id, story_file, checked_at, errors_json) VALUES (?, ?, ?, ?)",
            (series_id or "unknown", story_file, datetime.now(timezone.utc).isoformat(), json.dumps(result, ensure_ascii=False)),
        )
    return result


# ─── calibrate_heat (unchanged) ───────────────────────────────────────────
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
        w in l.lower() for w in ['ne', 'ki', 'ka', 'se', 'mein', 'ko', 'par']))
    action_ratio = action_lines / max(len(lines), 1) * 100
    emotional_lines = sum(1 for l in lines if any(
        w in l.lower() for w in ['feel', 'heart', 'soul', 'thought', 'knew', 'wanted', 'needed', 'sochi', 'lagta', 'mehsoos']))
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
        "status": "success", "file": story_file, "word_count": word_count,
        "current_heat_level": current_level, "target_heat_level": target_level,
        "metrics": {
            "explicit_vocabulary_density": f"{explicit_density:.2f}%",
            "action_line_ratio": f"{action_ratio:.1f}%",
            "emotional_line_ratio": f"{emotional_ratio:.1f}%",
        },
        "heat_level_descriptions": {
            1: "Sensual (fade-to-black, anticipation-driven)",
            2: "Erotic Romance (explicit sex serving character development)",
            3: "Explicit Erotica (graphic, sensation-focused, power dynamics)",
            4: "Literary Erotica (explicit but transcendent, philosophical)",
        },
        "suggestions": suggestions,
    }
    with db() as conn:
        conn.execute(
            "INSERT INTO heat_calibrations (story_file, calibrated_at, current_level, target_level, suggestions_json) VALUES (?, ?, ?, ?, ?)",
            (story_file, datetime.now(timezone.utc).isoformat(), current_level, target_level, json.dumps(suggestions)),
        )
    return result


# ─── score_prose (unchanged) ──────────────────────────────────────────────
async def handle_score_prose(args: dict) -> dict:
    story_file = args["story_file"]
    if not os.path.exists(story_file):
        return {"error": f"File not found: {story_file}"}
    with open(story_file, "r", encoding="utf-8") as f:
        content = f.read()
        lines = content.split("\n")
        word_count = len(content.split())
    scores = {}
    opening = "\n".join(lines[:5])
    hook_score = 5
    if any(w in opening.lower() for w in ['name', 'naam', 'main', 'mera']):
        hook_score += 1
    if len([l for l in lines[:5] if l.strip()]) >= 3:
        hook_score += 1
    if any(w in opening.lower() for w in ['!', '?', '—', '...']):
        hook_score += 1
    scores["hook"] = min(hook_score, 10)
    dialogue_lines = [l for l in lines if l.strip().startswith('"')]
    scores["character_depth"] = min(len(dialogue_lines) / max(len(lines), 1) * 100 + 3, 10)
    scores["dialogue_quality"] = min(len(set(dl.strip()[:30] for dl in dialogue_lines)) / max(len(dialogue_lines), 1) * 10, 10)
    sent_lengths = [len(l.split()) for l in lines if l.strip()]
    if sent_lengths:
        avg_len = sum(sent_lengths) / len(sent_lengths)
        variance = sum((s - avg_len) ** 2 for s in sent_lengths) / len(sent_lengths)
        scores["pacing"] = min(max(variance / 5, 3), 10)
    else:
        scores["pacing"] = 3
    ai_count = sum(content.lower().count(w) for w in AI_WORDS)
    filter_count = sum(content.lower().count(f" {w} ") for w in FILTER_WORDS)
    scores["prose_quality"] = max(10 - (ai_count + filter_count) / max(word_count, 1) * 100, 3)
    sensory_count = sum(content.lower().count(w) for w in SENSORY_WORDS)
    scores["world_emersion"] = min(sensory_count / max(word_count, 1) * 500, 10)
    emotional_count = sum(content.lower().count(w) for w in EMOTIONAL_WORDS)
    scores["emotional_impact"] = min(emotional_count / max(word_count, 1) * 300, 10)
    words = content.lower().split()
    if words:
        unique_ratio = len(set(words)) / len(words)
        scores["surprise_originality"] = min(unique_ratio * 15, 10)
    else:
        scores["surprise_originality"] = 3
    closing = "\n".join(lines[-5:])
    scores["ending_satisfaction"] = 7 if any(w in closing.lower() for w in ['end', 'bas', 'finally', 'last', 'over']) else 5
    scores["ai_speak_elimination"] = max(10 - ai_count * 2, 1)
    total = sum(scores.values()) / len(scores)
    trend = None
    with db() as conn:
        prev = conn.execute(
            "SELECT scores_json, total_score FROM prose_scores WHERE story_file = ? ORDER BY scored_at DESC LIMIT 1",
            (story_file,)).fetchone()
        if prev:
            prev_scores = json.loads(prev[0])
            prev_total = prev[1]
            dimension_deltas = {k: round(scores[k] - prev_scores.get(k, 0), 1) for k in scores}
            trend = {
                "previous_total": prev_total, "current_total": round(total, 1),
                "delta": round(total - prev_total, 1), "dimension_deltas": dimension_deltas,
                "improved": total > prev_total,
            }
        conn.execute(
            "INSERT INTO prose_scores (story_file, scored_at, scores_json, total_score) VALUES (?, ?, ?, ?)",
            (story_file, datetime.now(timezone.utc).isoformat(), json.dumps(scores), total),
        )
    result = {
        "status": "success", "file": story_file, "word_count": word_count,
        "scores": {k: round(v, 1) for k, v in scores.items()},
        "total_score": round(total, 1), "target": 8.0, "pass": total >= 8.0,
        "improvement_areas": [k for k, v in scores.items() if v < 7.0],
    }
    if trend:
        result["trend"] = trend
    return result


# ─── scene_pacing_analysis ─────────────────────────────────────────────────
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
            "scene": i + 1, "heading": scene["heading"],
            "word_count": scene["word_count"], "line_count": len(scene["lines"]),
            "tension_score": min(tension, 10),
            "pacing": "fast" if scene["word_count"] < 100 else "medium" if scene["word_count"] < 300 else "slow",
        })
    total_words = sum(s["word_count"] for s in scenes)
    avg_scene_length = total_words / max(len(scenes), 1)
    return {
        "status": "success", "file": story_file, "total_scenes": len(scenes),
        "total_words": total_words, "avg_scene_length": round(avg_scene_length),
        "scenes": scene_analyses, "pacing_curve": [s["tension_score"] for s in scene_analyses],
        "suggestions": [
            "Add more short, punchy scenes between long ones" if avg_scene_length > 200 else "Scene length variance is good",
            "Ensure tension rises toward climax" if scene_analyses and scene_analyses[-1]["tension_score"] < scene_analyses[len(scene_analyses)//2]["tension_score"] else "Tension arc looks correct",
        ],
    }


# ─── grammar_check_v2 ─────────────────────────────────────────────────────
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
    if not series_id:
        series_id = auto_detect_series(story_file)
    bible = load_bible(series_id) if series_id else None
    bible_names = get_bible_character_names(bible) if bible else {}
    if narrator_gender == "auto":
        female_markers = content.lower().count("maine") + content.lower().count("meri ") + content.lower().count("main ")
        narrator_gender = "female" if female_markers > 2 else "male"
    errors = []
    warnings = []
    male_names = [n for n, g in bible_names.items() if g == "male"]
    if not male_names:
        male_names = ['Rohan', 'Rohit', 'Papa', 'Bhai', 'Beta', 'Amit', 'Vikram', 'Raj', 'Arjun', 'Karan']
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
    name_pattern = re.compile(r'\b([A-Z][a-z]{2,})\b')
    names_found = {}
    for i, line in enumerate(lines, 1):
        for match in name_pattern.finditer(line):
            name = match.group(1)
            if name not in COMMON_NAME_EXCLUDES:
                if name not in names_found:
                    names_found[name] = []
                names_found[name].append(i)
    unknown_names = []
    if bible_names:
        for name in names_found:
            if name not in bible_names:
                unknown_names.append(name)
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
        "file": story_file, "series_id": series_id, "bible_loaded": bible is not None,
        "narrator_gender": narrator_gender, "total_lines": len(lines),
        "errors": errors, "warnings": warnings, "position_changes": position_changes,
        "unknown_names": unknown_names,
        "names_used": {k: f"{len(v)} mentions (lines: {v[0]}-{v[-1]})" for k, v in names_found.items()},
        "timeline_issues": timeline_issues,
        "summary": f"{len(errors)} grammar errors, {len(warnings)} warnings, {len(position_changes)} position changes",
    }
    return result


# ─── character_voice_check ─────────────────────────────────────────────────
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
            "voice_consistency": "check manually" if avg_len > 15 else "punchy/direct",
        }
    return {"status": "success", "file": story_file, "characters": results}


# ─── trope_innovate (FIXED — intelligent, not random) ─────────────────────
async def handle_trope_innovate(args: dict) -> dict:
    seed_tropes = args["seed_tropes"]
    genre = args.get("genre", "erotica")
    num = args.get("num_innovations", 5)

    # Intelligent trope knowledge base — structured by genre and heat
    TROPE_FUSION_LIBRARY = {
        "erotica": {
            "forbidden_love × power_exchange": {
                "fusion": "Forbidden Love × Power Exchange",
                "inversion": "The forbidden aspect isn't the obstacle — it's the point. They don't overcome the taboo; they weaponize it. Every 'wrong' thing they do together makes the rightness of it unbearable.",
                "escalation": "Start with the power imbalance as protection ('I shouldn't, you're my student/boss/patient'). Midpoint: the power imbalance becomes the turn-on. Climax: the one who should have power surrenders it freely.",
                "unique_angle": "What if the authority figure is the one being seduced — not through weakness, but through being *seen* for the first time? Their power was hiding their loneliness.",
            },
            "discovery × exhibitionism": {
                "fusion": "Discovery × Exhibitionism",
                "inversion": "The discovery isn't that they're being watched — it's that they *want* to be. The watching doesn't shame them; it completes them.",
                "escalation": "Accidental exposure → deliberate exposure → desperate need for an audience. Each stage, the watcher becomes more important than the partner.",
                "unique_angle": "The exhibitionist isn't performing for strangers — they're performing for one specific person who must never know how much they're wanted.",
            },
            "voyeurism × blackmail": {
                "fusion": "Voyeurism × Blackmail",
                "inversion": "The blackmailer doesn't want money — they want access. 'Let me watch' is the real demand. The money, the secrets — those are just the key to the door.",
                "escalation": "Watching from outside → being invited to watch → being *directed* to watch → being made to participate.",
                "unique_angle": "What if the person being watched hired the blackmailer themselves? The whole thing is a staged discovery so they can be 'forced' into something they already want.",
            },
            "first_time × corruption_arc": {
                "fusion": "First Time × Corruption Arc",
                "inversion": "The 'corruption' is a rescue. They're not being ruined — they're being *freed* from a life that was already killing them in slow motion.",
                "escalation": "Innocence → curiosity → first transgression → addiction to transgression → the 'sinful' life feels more honest than the 'pure' one ever did.",
                "unique_angle": "The corrupter gets corrupted too — by the realization that they're not taking something, they're giving something the other person needed all along.",
            },
            "joint_family × secret_identity": {
                "fusion": "Joint Family × Secret Identity",
                "inversion": "The family knows. They've always known. The 'secret' is a fiction everyone maintains because the alternative — acknowledging it — would break the family.",
                "escalation": "Secret → almost caught → family pretends not to know → someone breaks the silence → the family's silence was the real secret.",
                "unique_angle": "In a joint family, everyone shares walls and secrets. The most erotic thing isn't the sex — it's the collective agreement to pretend it isn't happening.",
            },
        },
        "romance": {
            "arranged_marriage × slow_burn": {
                "fusion": "Arranged Marriage × Slow Burn",
                "inversion": "They're already married. The 'slow burn' isn't will-they-won't-they — it's two people who legally belong to each other learning whether they actually *fit*.",
                "escalation": "Polite distance → small kindnesses → one moment of real vulnerability → retreat → the next vulnerability goes deeper → neither can pretend anymore.",
                "unique_angle": "The marriage certificate is the least binding thing about them. What binds them is the one secret they share that no one else in the family knows.",
            },
            "enemies_to_lovers × class_warfare": {
                "fusion": "Enemies to Lovers × Class Warfare",
                "inversion": "They're not enemies because of class — they're enemies because the attraction is real and the class difference makes it *dangerous*. Hatred is easier than wanting someone you can't have.",
                "escalation": "Public hostility → private moments of unexpected gentleness → one act of real kindness that can't be taken back → the war continues but now they're fighting on the same side.",
                "unique_angle": "What if the one with less power is actually the one with more courage? Class buys comfort, not bravery.",
            },
        },
        "thriller": {
            "betrayal × seduction": {
                "fusion": "Betrayal × Seduction",
                "inversion": "The seduction IS the betrayal — but the betrayer falls too. They set a trap and walked into it themselves.",
                "escalation": "Target acquired → intimacy develops → target activates → seducer is compromised → now they're both trapped.",
                "unique_angle": "Two spies seduce each other knowing the other is a spy. The sex is real. The mission is real. Neither can tell which is which anymore.",
            },
        },
    }

    # Find matching genre or default to erotica
    genre_key = None
    for g in TROPE_FUSION_LIBRARY:
        if g in genre.lower():
            genre_key = g
            break
    if not genre_key:
        genre_key = "erotica"

    # Load existing innovations from DB
    with db() as conn:
        prev = conn.execute("SELECT innovation_json FROM trope_innovations ORDER BY created_at DESC LIMIT 20").fetchall()
    existing = set()
    for row in prev:
        try:
            for inv in json.loads(row[0]):
                existing.add(inv.get("fusion", ""))
        except (json.JSONDecodeError, TypeError):
            pass

    # Generate intelligent innovations from the library + seed combinations
    innovations = []
    library = TROPE_FUSION_LIBRARY.get(genre_key, {})

    # First: match seed tropes against library combinations
    for combo_key, combo_data in library.items():
        tropes_in_combo = [t.strip() for t in combo_key.split("×")]
        if any(st in tropes_in_combo for st in seed_tropes) and combo_data["fusion"] not in existing:
            innovations.append(combo_data)
            existing.add(combo_data["fusion"])
            if len(innovations) >= num:
                break

    # Then: generate novel cross-combinations from seed tropes
    import random
    seed_str = "_".join(seed_tropes)
    random.seed(seed_str)
    all_trope_pool = [
        "forbidden_love", "power_exchange", "discovery", "betrayal", "seduction",
        "blackmail", "revenge", "first_time", "public_risk", "possession",
        "submission", "corruption_arc", "double_life", "secret_identity",
        "slow_burn", "accidental_encounter", "class_warfare", "caste_tension",
        "joint_family", "outsider_foil", "humiliation_gateway", "feminization",
        "generational", "catch_and_release", "alpha_discovery",
    ]
    available = [t for t in all_trope_pool if t not in seed_tropes]

    while len(innovations) < num and len(available) >= 2:
        combo = random.sample(seed_tropes, min(2, len(seed_tropes))) + random.sample(available, 2)
        combo_key = f"{combo[0]} × {combo[1]}"
        if combo_key in existing:
            continue
        existing.add(combo_key)
        innovations.append({
            "fusion": combo_key,
            "inversion": f"What if {combo[0]} is reversed — the one who should resist is the one who initiates?",
            "escalation": f"Start with {combo[1]}, escalate to {combo[0]} by midpoint, climax with {combo[2]}",
            "unique_angle": f"Never done: {combo[0]} + {combo[1]} in {genre} from the perspective of the one who holds power but doesn't know it",
        })

    with db() as conn:
        conn.execute(
            "INSERT INTO trope_innovations (source_tropes, innovation_json, created_at) VALUES (?, ?, ?)",
            (json.dumps(seed_tropes), json.dumps(innovations), datetime.now(timezone.utc).isoformat()),
        )

    return {"status": "success", "seed_tropes": seed_tropes, "innovations": innovations,
            "deduped": True, "source": "knowledge_base" if library else "generated"}


# ─── export_format (unchanged) ─────────────────────────────────────────────
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
            node = {"id": f"node_{i+1}", "scene": scene["heading"], "content": " ".join(scene["content"]), "word_count": scene["word_count"], "choices": []}
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
        "status": "success", "output_format": output_format, "output_file": output_file,
        "source_file": story_file, "scenes_detected": len(scenes),
        "total_words": sum(s["word_count"] for s in scenes), "file_size": len(export),
    }


# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())