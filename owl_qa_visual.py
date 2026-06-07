"""
OWL QA Visual Intelligence Module
===================================
Handles all screenshot management, visual diff, harmonic UI analysis,
and vision-based semantic understanding of screenshots.

Architecture:
- Playwright for screenshots (persistent context, sub-100ms capture)
- WebP compression for storage efficiency
- Claude vision for semantic screenshot interpretation
- pixelmatch-style pixel diff for regression detection
- Mathematical harmony scoring for UI quality
"""

import asyncio
import base64
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ── Storage paths ────────────────────────────────────────────────────────────
_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

QA_SCREENSHOT_DIR = os.path.join(os.path.dirname(_OWL_DB_PATH), "qa-screenshots")
os.makedirs(QA_SCREENSHOT_DIR, exist_ok=True)

# ── Optional dependencies ────────────────────────────────────────────────────
_playwright_available = False
_pil_available = False
_anthropic_available = False

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
    _playwright_available = True
except ImportError:
    pass

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFont
    import io
    _pil_available = True
except ImportError:
    pass

try:
    import anthropic
    _anthropic_available = True
except ImportError:
    pass

# ── Persistent browser pool ──────────────────────────────────────────────────
# Key insight: launch once, reuse forever. Sub-100ms per action after warmup.
_browser_pool: dict[str, BrowserContext] = {}   # origin → context
_playwright_instance = None
_browser_instance: Optional[Browser] = None
_pool_lock = asyncio.Lock()

async def get_browser_context(origin: str, headless: bool = True) -> Optional["BrowserContext"]:
    """Get or create a persistent browser context for a given origin."""
    global _playwright_instance, _browser_instance

    if not _playwright_available:
        return None

    async with _pool_lock:
        if origin in _browser_pool:
            try:
                # Health check: verify context is still alive
                _ = _browser_pool[origin].pages
                return _browser_pool[origin]
            except Exception:
                # Context died, remove it
                del _browser_pool[origin]

        # Launch browser if not running
        if _playwright_instance is None:
            _playwright_instance = await async_playwright().start()
        if _browser_instance is None or not _browser_instance.is_connected():
            _browser_instance = await _playwright_instance.chromium.launch(
                headless=headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",  # Anti-detection
                    "--disable-infobars",
                    "--window-size=1280,900",
                ]
            )

        # Create new context for this origin
        ctx = await _browser_instance.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            java_script_enabled=True,
            ignore_https_errors=True,
        )
        _browser_pool[origin] = ctx
        return ctx


async def close_all_contexts():
    """Gracefully close all browser contexts and the browser instance."""
    global _playwright_instance, _browser_instance
    async with _pool_lock:
        for origin, ctx in _browser_pool.items():
            try:
                await ctx.close()
            except Exception:
                pass
        _browser_pool.clear()
        if _browser_instance:
            try:
                await _browser_instance.close()
            except Exception:
                pass
            _browser_instance = None
        if _playwright_instance:
            try:
                await _playwright_instance.stop()
            except Exception:
                pass
            _playwright_instance = None


# ── Screenshot capture ───────────────────────────────────────────────────────

def _screenshot_path(run_id: str, step: str, variant: str = "") -> str:
    """Generate a storage path for a screenshot."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    name_parts = [run_id[:8], step, variant, timestamp] if variant else [run_id[:8], step, timestamp]
    filename = "_".join(name_parts).replace(" ", "_").replace("/", "-") + ".webp"
    return os.path.join(QA_SCREENSHOT_DIR, filename)


async def capture_screenshot(
    page: "Page",
    run_id: str,
    step_name: str,
    full_page: bool = False,
    variant: str = ""
) -> Optional[str]:
    """
    Capture a screenshot from a Playwright page and save as WebP.
    Returns absolute path to saved file, or None on failure.
    """
    if not _playwright_available or not page:
        return None

    try:
        path = _screenshot_path(run_id, step_name, variant)
        await page.screenshot(
            path=path,
            full_page=full_page,
            type="jpeg",  # Playwright saves as JPEG, we'll convert below
            quality=85,
            animations="disabled",  # Freeze animations for stable screenshots
        )

        # Convert to WebP for 3-5x size reduction
        if _pil_available and os.path.exists(path):
            webp_path = path.replace(".webp", ".webp")
            try:
                with Image.open(path) as img:
                    img.save(webp_path, "WEBP", quality=85, method=6)
                os.replace(webp_path, path)  # Atomic rename
            except Exception:
                pass  # Keep original if conversion fails

        return path
    except Exception as e:
        print(f"[QA Visual] Screenshot failed: {e}", file=sys.stderr)
        return None


def screenshot_to_base64(path: str) -> Optional[str]:
    """Convert a screenshot file to base64 for vision API."""
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except Exception:
        return None


# ── Vision interpretation ────────────────────────────────────────────────────

def interpret_screenshot(
    screenshot_path: str,
    context_hint: str = "",
    expected_state: str = "",
) -> dict:
    """
    Use Claude's vision API to semantically understand a screenshot.
    Returns structured interpretation: screen_type, visible_elements, 
    current_state, anomalies, matches_expected.
    
    Fast: single API call, ~500ms typical response time.
    """
    if not _anthropic_available:
        return {"error": "anthropic package not installed", "understood": False}

    b64 = screenshot_to_base64(screenshot_path)
    if not b64:
        return {"error": "screenshot file not found or unreadable", "understood": False}

    # Detect image type
    ext = os.path.splitext(screenshot_path)[1].lower()
    media_type = "image/webp" if ext == ".webp" else "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"

    try:
        client = anthropic.Anthropic()

        system_prompt = """You are a QA expert analyzing UI screenshots.
Return ONLY valid JSON with these exact fields:
{
  "screen_type": "login|dashboard|checkout|form|error|loading|empty|list|detail|modal|unknown",
  "current_state": "a one-sentence description of what the UI currently shows",
  "interactive_elements": ["list of buttons, inputs, links visible with their labels"],
  "errors_visible": ["any error messages, validation warnings, or broken UI elements"],
  "anomalies": ["anything that looks wrong, broken, or unexpected"],
  "matches_expected": true/false/null,
  "confidence": 0.0-1.0
}
Do not include any text outside the JSON object."""

        user_content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": b64,
                }
            }
        ]

        if context_hint:
            user_content.append({
                "type": "text",
                "text": f"Context: {context_hint}"
            })

        if expected_state:
            user_content.append({
                "type": "text",
                "text": f"Expected state: {expected_state}. Does the screenshot match this? Set matches_expected accordingly."
            })

        response = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}]
        )

        result_text = response.content[0].text.strip()
        # Strip code fences if present
        result_text = re.sub(r'^```(?:json)?\s*', '', result_text)
        result_text = re.sub(r'\s*```$', '', result_text)

        parsed = json.loads(result_text)
        parsed["understood"] = True
        return parsed

    except json.JSONDecodeError as e:
        return {"error": f"Vision response not valid JSON: {e}", "understood": False}
    except Exception as e:
        return {"error": str(e), "understood": False}


# ── Visual diff ──────────────────────────────────────────────────────────────

def compute_visual_diff(
    baseline_path: str,
    current_path: str,
    output_path: Optional[str] = None,
) -> dict:
    """
    Compare two screenshots. Returns:
    - diff_score: 0.0 (identical) to 1.0 (completely different)
    - changed_pixels: count of changed pixels
    - total_pixels: total pixel count
    - diff_image_path: path to annotated diff image (if PIL available)
    - regions_changed: list of bounding boxes where changes occurred
    """
    if not _pil_available:
        return {
            "error": "Pillow not installed. Run: pip install pillow",
            "diff_score": -1,
        }

    if not os.path.exists(baseline_path) or not os.path.exists(current_path):
        return {
            "error": "One or both screenshot files not found",
            "diff_score": -1,
        }

    try:
        with Image.open(baseline_path) as img_baseline, \
             Image.open(current_path) as img_current:

            # Normalize sizes (resize current to baseline size if needed)
            if img_baseline.size != img_current.size:
                img_current = img_current.resize(img_baseline.size, Image.LANCZOS)

            # Convert to RGB for comparison
            baseline_rgb = img_baseline.convert("RGB")
            current_rgb = img_current.convert("RGB")

            # Pixel-level diff
            diff = ImageChops.difference(baseline_rgb, current_rgb)
            diff_array = list(diff.getdata())

            # Compute changed pixels (threshold: any channel > 10 = changed)
            changed = sum(
                1 for pixel in diff_array
                if max(pixel) > 10
            )
            total = len(diff_array)
            diff_score = changed / total if total > 0 else 0.0

            # Find changed regions (simple bounding box per 50px grid)
            width, height = img_baseline.size
            regions = []
            grid_size = 50

            for row in range(0, height, grid_size):
                for col in range(0, width, grid_size):
                    region_changed = 0
                    region_total = 0
                    for y in range(row, min(row + grid_size, height)):
                        for x in range(col, min(col + grid_size, width)):
                            idx = y * width + x
                            if idx < total:
                                region_total += 1
                                if max(diff_array[idx]) > 10:
                                    region_changed += 1
                    if region_total > 0 and region_changed / region_total > 0.05:
                        regions.append({
                            "x": col, "y": row,
                            "width": min(grid_size, width - col),
                            "height": min(grid_size, height - row),
                            "change_pct": round(region_changed / region_total * 100, 1)
                        })

            # Generate diff image with highlighted changes
            diff_image_path = None
            if output_path:
                try:
                    diff_img = current_rgb.copy()
                    draw = ImageDraw.Draw(diff_img, "RGBA")
                    for region in regions:
                        intensity = min(255, int(region["change_pct"] * 5))
                        draw.rectangle(
                            [region["x"], region["y"],
                             region["x"] + region["width"],
                             region["y"] + region["height"]],
                            outline=(255, 50, 50, 200),
                            width=2,
                            fill=(255, 50, 50, max(30, intensity // 4))
                        )
                    diff_img.save(output_path, "WEBP", quality=85)
                    diff_image_path = output_path
                except Exception as e:
                    print(f"[QA Visual] Diff image generation failed: {e}", file=sys.stderr)

            return {
                "diff_score": round(diff_score, 4),
                "changed_pixels": changed,
                "total_pixels": total,
                "change_percentage": round(diff_score * 100, 2),
                "diff_image_path": diff_image_path,
                "regions_changed": regions[:20],  # Cap at 20 regions
                "size": {"width": width, "height": height},
            }

    except Exception as e:
        return {"error": str(e), "diff_score": -1}


# ── DOM extraction ───────────────────────────────────────────────────────────

async def extract_dom_state(page: "Page") -> dict:
    """
    Extract interactive elements, heading structure, and ARIA info from page.
    Fast: single JS evaluation, <50ms typical.
    """
    if not _playwright_available or not page:
        return {}

    try:
        dom_data = await page.evaluate("""() => {
            const result = {
                url: window.location.href,
                title: document.title,
                interactive: [],
                headings: [],
                forms: [],
                errors: [],
                images_broken: []
            };

            // Interactive elements
            const interactive_selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]';
            document.querySelectorAll(interactive_selectors).forEach((el, i) => {
                if (i > 100) return; // Cap at 100
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return; // Skip hidden
                result.interactive.push({
                    tag: el.tagName.toLowerCase(),
                    type: el.type || '',
                    text: (el.innerText || el.value || el.placeholder || el.alt || el.title || '').trim().slice(0, 80),
                    aria_label: el.getAttribute('aria-label') || '',
                    role: el.getAttribute('role') || '',
                    id: el.id || '',
                    disabled: el.disabled || false,
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            });

            // Headings
            document.querySelectorAll('h1,h2,h3').forEach(h => {
                result.headings.push({level: parseInt(h.tagName[1]), text: h.innerText.trim().slice(0, 100)});
            });

            // Console errors captured by window.onerror
            // Forms
            document.querySelectorAll('form').forEach((f, i) => {
                if (i > 10) return;
                result.forms.push({
                    id: f.id || '',
                    action: f.action || '',
                    method: f.method || 'get',
                    fields: Array.from(f.elements).map(e => ({
                        name: e.name, type: e.type, required: e.required
                    })).filter(e => e.name)
                });
            });

            // Error indicators in DOM
            const error_selectors = '.error, .alert-danger, .toast-error, [role="alert"], .invalid, .field-error';
            document.querySelectorAll(error_selectors).forEach(el => {
                const text = el.innerText.trim();
                if (text) result.errors.push(text.slice(0, 200));
            });

            // Broken images
            document.querySelectorAll('img').forEach(img => {
                if (!img.complete || img.naturalWidth === 0) {
                    result.images_broken.push(img.src || img.getAttribute('src') || 'unknown');
                }
            });

            return result;
        }""")

        dom_data["element_count"] = len(dom_data.get("interactive", []))
        dom_data["dom_hash"] = hashlib.md5(
            json.dumps(sorted([e.get("text", "") for e in dom_data.get("interactive", [])]))
            .encode()
        ).hexdigest()

        return dom_data

    except Exception as e:
        return {"error": str(e)}


async def get_console_errors(page: "Page") -> list:
    """
    Retrieve console errors captured during page load/interaction.
    Called after page navigation or action.
    """
    if not _playwright_available or not page:
        return []
    try:
        return await page.evaluate("""() => {
            return window.__owl_console_errors__ || [];
        }""")
    except Exception:
        return []


async def inject_console_monitor(page: "Page"):
    """Inject JS to capture console errors into window.__owl_console_errors__."""
    if not _playwright_available or not page:
        return
    try:
        await page.evaluate("""() => {
            if (window.__owl_console_errors__) return;
            window.__owl_console_errors__ = [];
            const original = console.error;
            console.error = function(...args) {
                window.__owl_console_errors__.push(args.map(String).join(' '));
                original.apply(console, args);
            };
            window.addEventListener('error', function(e) {
                window.__owl_console_errors__.push(e.message + ' (' + e.filename + ':' + e.lineno + ')');
            });
            window.addEventListener('unhandledrejection', function(e) {
                window.__owl_console_errors__.push('Unhandled Promise: ' + String(e.reason));
            });
        }""")
    except Exception:
        pass


# ── Performance capture ──────────────────────────────────────────────────────

async def get_performance_metrics(page: "Page") -> dict:
    """
    Extract Web Vitals and performance timing from current page.
    Returns TTFB, FCP, LCP (if available), DOM load, full load times.
    """
    if not _playwright_available or not page:
        return {}
    try:
        metrics = await page.evaluate("""() => {
            const result = {};
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) {
                result.ttfb = Math.round(nav.responseStart - nav.requestStart);
                result.dom_content_loaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
                result.full_load = Math.round(nav.loadEventEnd - nav.startTime);
                result.dns_time = Math.round(nav.domainLookupEnd - nav.domainLookupStart);
                result.connect_time = Math.round(nav.connectEnd - nav.connectStart);
            }
            const paint = performance.getEntriesByType('paint');
            for (const p of paint) {
                if (p.name === 'first-contentful-paint') result.fcp = Math.round(p.startTime);
            }
            // Resource count
            result.resource_count = performance.getEntriesByType('resource').length;
            // Memory (Chrome only)
            if (performance.memory) {
                result.heap_used_mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
                result.heap_total_mb = Math.round(performance.memory.totalJSHeapSize / 1048576);
            }
            return result;
        }""")
        return metrics
    except Exception as e:
        return {"error": str(e)}


# ── Harmonic UI analysis ─────────────────────────────────────────────────────

async def compute_harmony_score(page: "Page") -> dict:
    """
    Pythagoras' Harmonic UI Validator.
    Measures mathematical harmony of the UI: spacing ratios, font scale, 
    color contrast, golden ratio adherence.
    Returns harmony_score (0.0-1.0) and dissonance alerts.
    """
    if not _playwright_available or not page:
        return {"harmony_score": 0.5, "dissonance": []}

    try:
        harmony_data = await page.evaluate("""() => {
            const result = {
                font_sizes: [],
                spacing_values: [],
                colors: [],
                contrast_failures: [],
                spacing_ratios: []
            };

            // Collect all font sizes
            const all_elements = document.querySelectorAll('*');
            all_elements.forEach(el => {
                const style = window.getComputedStyle(el);
                const fs = parseFloat(style.fontSize);
                if (fs > 0 && fs < 200) result.font_sizes.push(Math.round(fs));
                
                // Margin and padding
                const mt = parseFloat(style.marginTop);
                const mb = parseFloat(style.marginBottom);
                const pt = parseFloat(style.paddingTop);
                const pb = parseFloat(style.paddingBottom);
                if (mt > 0) result.spacing_values.push(Math.round(mt));
                if (mb > 0) result.spacing_values.push(Math.round(mb));
                if (pt > 0) result.spacing_values.push(Math.round(pt));
                if (pb > 0) result.spacing_values.push(Math.round(pb));
            });

            return result;
        }""")

        # Compute font scale harmony (should follow a scale like 1.25 or 1.618)
        font_sizes = sorted(set(harmony_data.get("font_sizes", [])))
        font_harmony = 1.0
        if len(font_sizes) >= 2:
            ratios = [font_sizes[i+1] / font_sizes[i] for i in range(len(font_sizes)-1) if font_sizes[i] > 0]
            if ratios:
                # Good: ratios close to 1.25, 1.333, 1.5, or 1.618
                ideal_ratios = [1.25, 1.333, 1.414, 1.5, 1.618, 2.0]
                best_ideal = min(ideal_ratios, key=lambda r: abs(sum(ratios)/len(ratios) - r))
                avg_ratio = sum(ratios) / len(ratios)
                deviation = abs(avg_ratio - best_ideal) / best_ideal
                font_harmony = max(0.0, 1.0 - deviation * 2)

        # Compute spacing harmony (should follow a base-8 or base-4 grid)
        spacing_values = [s for s in harmony_data.get("spacing_values", []) if 0 < s <= 200]
        spacing_harmony = 1.0
        if spacing_values:
            # Check if majority are multiples of 4 or 8
            on_grid_4 = sum(1 for s in spacing_values if s % 4 == 0) / len(spacing_values)
            on_grid_8 = sum(1 for s in spacing_values if s % 8 == 0) / len(spacing_values)
            spacing_harmony = max(on_grid_4, on_grid_8)

        harmony_score = (font_harmony * 0.5 + spacing_harmony * 0.5)

        dissonance = []
        if font_harmony < 0.6:
            dissonance.append({
                "type": "font_scale_dissonance",
                "message": f"Font sizes do not follow a consistent scale. Found {len(font_sizes)} sizes: {font_sizes[:8]}",
                "severity": "warning"
            })
        if spacing_harmony < 0.5:
            dissonance.append({
                "type": "spacing_grid_dissonance",
                "message": "Spacing values are not aligned to a 4px or 8px grid. Design feels inconsistent.",
                "severity": "warning"
            })

        return {
            "harmony_score": round(harmony_score, 3),
            "font_harmony": round(font_harmony, 3),
            "spacing_harmony": round(spacing_harmony, 3),
            "font_sizes_found": font_sizes[:20],
            "dissonance": dissonance,
        }

    except Exception as e:
        return {"harmony_score": 0.5, "error": str(e), "dissonance": []}


# ── Screenshot storage management ────────────────────────────────────────────

def purge_old_screenshots(dry_run: bool = False) -> dict:
    """
    Auto-purge screenshots based on retention policy:
    - Passing test screenshots: delete after 14 days
    - Failing test screenshots: keep for 90 days
    - Baseline screenshots: never delete
    
    Returns: count of files deleted and bytes freed.
    """
    now = time.time()
    fourteen_days = 14 * 86400
    ninety_days = 90 * 86400

    deleted_count = 0
    freed_bytes = 0

    try:
        # Get list of failing test screenshots from DB
        failing_shots = set()
        if os.path.exists(_OWL_DB_PATH):
            with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
                try:
                    rows = conn.execute("""
                        SELECT screenshot_before, screenshot_after 
                        FROM qa_test_steps WHERE passed = 0
                    """).fetchall()
                    for r in rows:
                        if r[0]: failing_shots.add(r[0])
                        if r[1]: failing_shots.add(r[1])
                    
                    rows2 = conn.execute("""
                        SELECT screenshot_paths_json FROM qa_bugs
                    """).fetchall()
                    for r in rows2:
                        try:
                            paths = json.loads(r[0] or "[]")
                            failing_shots.update(paths)
                        except Exception:
                            pass
                except Exception:
                    pass

        for fname in os.listdir(QA_SCREENSHOT_DIR):
            fpath = os.path.join(QA_SCREENSHOT_DIR, fname)
            if not os.path.isfile(fpath):
                continue
            if fname.startswith("baseline_"):
                continue  # Never delete baselines

            fage = now - os.path.getmtime(fpath)
            fsize = os.path.getsize(fpath)
            is_failing = fpath in failing_shots

            should_delete = (
                (is_failing and fage > ninety_days) or
                (not is_failing and fage > fourteen_days)
            )

            if should_delete:
                if not dry_run:
                    os.remove(fpath)
                deleted_count += 1
                freed_bytes += fsize

    except Exception as e:
        return {"error": str(e), "deleted": 0, "freed_bytes": 0}

    return {
        "deleted_count": deleted_count,
        "freed_bytes": freed_bytes,
        "freed_mb": round(freed_bytes / 1048576, 2),
        "dry_run": dry_run
    }


def get_screenshot_storage_stats() -> dict:
    """Return current screenshot storage stats."""
    try:
        total_files = 0
        total_bytes = 0
        for fname in os.listdir(QA_SCREENSHOT_DIR):
            fpath = os.path.join(QA_SCREENSHOT_DIR, fname)
            if os.path.isfile(fpath):
                total_files += 1
                total_bytes += os.path.getsize(fpath)
        return {
            "total_files": total_files,
            "total_mb": round(total_bytes / 1048576, 2),
            "total_gb": round(total_bytes / 1073741824, 3),
            "screenshot_dir": QA_SCREENSHOT_DIR,
        }
    except Exception as e:
        return {"error": str(e)}


# ── OWL memory integration ───────────────────────────────────────────────────

def store_qa_observation_in_owl(
    target_url: str,
    run_id: str,
    screenshot_path: Optional[str],
    vision_result: dict,
    dom_state: dict,
    project: str = "default"
) -> Optional[str]:
    """Store a QA observation as an episodic memory in OWL."""
    if not os.path.exists(_OWL_DB_PATH):
        return None
    try:
        screen_type = vision_result.get("screen_type", "unknown")
        current_state = vision_result.get("current_state", "")
        errors = vision_result.get("errors_visible", [])
        anomalies = vision_result.get("anomalies", [])

        content_parts = [f"[QA OBSERVATION] {target_url}"]
        content_parts.append(f"Screen: {screen_type} | State: {current_state}")
        if errors:
            content_parts.append(f"Errors visible: {'; '.join(errors[:3])}")
        if anomalies:
            content_parts.append(f"Anomalies: {'; '.join(anomalies[:3])}")
        if dom_state.get("images_broken"):
            content_parts.append(f"Broken images: {len(dom_state['images_broken'])}")

        content = "\n".join(content_parts)
        mem_id = "qa_obs_" + hashlib.sha256(
            (content + run_id).encode()
        ).hexdigest()[:16]
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Compute emotional salience: errors/anomalies = higher arousal
        has_issues = bool(errors or anomalies)
        valence = -0.3 if has_issues else 0.1
        arousal = 0.6 if has_issues else 0.2
        salience = 0.85 if has_issues else 0.6

        with sqlite3.connect(_OWL_DB_PATH, timeout=5) as conn:
            conn.execute("""
                INSERT OR IGNORE INTO episodic_memories
                  (id, content, event_type, project, emotional_valence,
                   emotional_arousal, salience, strength, source, created_at, updated_at, is_active)
                VALUES (?, ?, 'qa_observation', ?, ?, ?, ?, 1.0, 'owl-qa', ?, ?, 1)
            """, (mem_id, content, project, valence, arousal, salience, now, now))
            conn.commit()

        return mem_id
    except Exception as e:
        print(f"[QA Visual] OWL store failed: {e}", file=sys.stderr)
        return None


# ── Accessibility audit ──────────────────────────────────────────────────────

# Minimal axe-core URL (CDN) — injected into page for WCAG checks
_AXE_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.2/axe.min.js"

async def run_accessibility_audit(page: "Page") -> dict:
    """
    Inject axe-core and run WCAG 2.1 AA accessibility audit.
    Returns structured violations with severity and fix suggestions.
    """
    if not _playwright_available or not page:
        return {"error": "Playwright not available"}

    try:
        # Inject axe-core
        await page.add_script_tag(url=_AXE_CDN_URL)
        await page.wait_for_timeout(500)  # Let axe initialize

        results = await page.evaluate("""async () => {
            try {
                const results = await window.axe.run(document, {
                    runOnly: {
                        type: 'tag',
                        values: ['wcag2a', 'wcag2aa', 'wcag21aa']
                    }
                });
                return {
                    violations: results.violations.map(v => ({
                        id: v.id,
                        impact: v.impact,
                        description: v.description,
                        help: v.help,
                        helpUrl: v.helpUrl,
                        nodes_count: v.nodes.length,
                        sample_target: v.nodes[0]?.target?.join(', ') || ''
                    })),
                    passes: results.passes.length,
                    incomplete: results.incomplete.length,
                    inapplicable: results.inapplicable.length
                };
            } catch(e) {
                return { error: e.message };
            }
        }""")

        if results.get("error"):
            return {"error": results["error"]}

        violations = results.get("violations", [])
        critical = [v for v in violations if v.get("impact") == "critical"]
        serious = [v for v in violations if v.get("impact") == "serious"]

        # Compute accessibility score (100 - penalty for violations)
        penalty = len(critical) * 15 + len(serious) * 8 + len(violations) * 3
        score = max(0, 100 - penalty)

        return {
            "accessibility_score": score,
            "wcag_level": "AA",
            "violations_total": len(violations),
            "critical_count": len(critical),
            "serious_count": len(serious),
            "passes": results.get("passes", 0),
            "violations": violations[:20],  # Cap for context efficiency
        }

    except Exception as e:
        return {"error": str(e)}
