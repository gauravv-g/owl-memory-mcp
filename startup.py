#!/usr/bin/env python3
"""
Hermes Session Bootstrap — Runs automatically at session start.

This script:
1. Loads project state from .workflow-state.json
2. Loads series bible from 00-bible.json
3. Checks quality of previous work
4. Shows a compact status dashboard
5. Suggests next action

Hermes calls this via execute_code at the start of every session.
No user trigger needed.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

def get_project_root():
    """Find the project root by looking for .workflow-state.json or 00-bible.json."""
    cwd = Path.cwd()
    for p in [cwd] + list(cwd.parents):
        if (p / '.workflow-state.json').exists() or (p / '00-bible.json').exists():
            return p
    return cwd

def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except:
        return None

def check_grammar_issues(chapters_dir):
    """Quick scan for common grammar issues in chapter files."""
    issues = []
    if not Path(chapters_dir).exists():
        return issues
    
    female_verb_errors = [
        (r'\bmaine bola\b', 'maine boli'),
        (r'\bmaine pucha\b', 'maine puchi'),
        (r'\bmaine dekha\b', 'maine dekhi'),
        (r'\bmaine kiya\b', 'maine ki'),
        (r'\bmain gaya\b', 'main gayi'),
        (r'\bmain aaya\b', 'main aayi'),
        (r'\brehta hoon\b', 'rehti hoon'),
        (r'\bdekhta hoon\b', 'dekhti hoon'),
        (r'\bkarta hoon\b', 'karti hoon'),
        (r'\bbolta hoon\b', 'balti hoon'),
    ]
    
    for f in Path(chapters_dir).glob('**/*.md'):
        content = f.read_text(encoding='utf-8', errors='replace')
        for pattern, fix in female_verb_errors:
            import re
            matches = list(re.finditer(pattern, content, re.IGNORECASE))
            if matches:
                line_num = content[:matches[0].start()].count('\n') + 1
                issues.append(f"  {f.name}:{line_num} → '{pattern}' should be '{fix}'")
    
    return issues[:10]  # Limit to first 10

def get_session_summary():
    """Generate a compact session summary."""
    root = get_project_root()
    
    state = load_json(root / '.workflow-state.json')
    bible = load_json(root / '00-bible.json')
    
    lines = []
    lines.append("=" * 50)
    lines.append("SESSION BOOTSTRAP")
    lines.append("=" * 50)
    
    # Project info
    if bible:
        lines.append(f"Project: {bible.get('series_name', 'Unknown')}")
        lines.append(f"Genre: {bible.get('genre', 'Unknown')}")
        lines.append(f"Heat Level: {bible.get('heat_level', '?')}/4")
        chars = bible.get('characters', [])
        char_names = [c.get('name', '?') for c in chars if c.get('name') != '[TO BE NAMED]']
        lines.append(f"Characters: {', '.join(char_names) if char_names else 'None defined'}")
    else:
        lines.append("No bible found. Run Stage 0 (Project Init) first.")
    
    # Current state
    if state:
        lines.append(f"Current Task: {state.get('current_task', 'None')}")
        progress = state.get('progress', {})
        if progress:
            for k, v in list(progress.items())[:5]:
                lines.append(f"  {k}: {v}")
    
    # Grammar check
    chapters_dir = root / 'chapters'
    if chapters_dir.exists():
        issues = check_grammar_issues(chapters_dir)
        if issues:
            lines.append(f"\n⚠ GRAMMAR ISSUES ({len(issues)} found):")
            for issue in issues:
                lines.append(issue)
        else:
            lines.append("\n✓ No obvious grammar issues detected")
    
    # Next action suggestion
    lines.append("\n" + "=" * 50)
    if not bible:
        lines.append("NEXT: Create 00-bible.json (Stage 0)")
    elif not state or not state.get('current_task'):
        lines.append("NEXT: Set current task in .workflow-state.json")
    else:
        lines.append(f"CONTINUE: {state.get('current_task')}")
    lines.append("=" * 50)
    
    return '\n'.join(lines)

if __name__ == '__main__':
    print(get_session_summary())
