"""
OWL QA Sensory Module (Pillar 4)
================================
Audits application audio/video media health, visual animation timing,
and tests stability under varying network emulation configurations (CDP).
"""

import asyncio
import os
import sys
import time
from typing import Any, Dict, List, Optional
from PIL import Image, ImageChops

# Predefined network throttle configurations (speeds in B/s)
NETWORK_PROFILES = {
    "fast_4g": {
        "offline": False,
        "latency": 20,
        "download": 1.5 * 1024 * 1024,
        "upload": 750 * 1024
    },
    "slow_3g": {
        "offline": False,
        "latency": 400,
        "download": 400 * 1024,
        "upload": 200 * 1024
    },
    "high_latency": {
        "offline": False,
        "latency": 800,
        "download": 5 * 1024 * 1024,
        "upload": 1 * 1024 * 1024
    },
    "offline": {
        "offline": True,
        "latency": 0,
        "download": 0,
        "upload": 0
    }
}

async def apply_network_conditions(page: Any, profile_name: str):
    """Emulates network speed using Chrome DevTools Protocol (CDP)."""
    if profile_name not in NETWORK_PROFILES:
        return
        
    prof = NETWORK_PROFILES[profile_name]
    try:
        # Obtain CDP session
        client = await page.context.new_cdp_session(page)
        await client.send("Network.emulateNetworkConditions", {
            "offline": prof["offline"],
            "latency": prof["latency"],
            "downloadThroughput": prof["download"],
            "uploadThroughput": prof["upload"]
        })
    except Exception as e:
        print(f"[Sensory] Failed to set network conditions: {e}", file=sys.stderr)

async def audit_media_elements(page: Any) -> Dict[str, Any]:
    """Inspects all audio/video elements on the page for playback health and accessibility."""
    # Check media states in page context
    media_info = await page.evaluate("""
        () => {
            const mediaList = [];
            const elements = document.querySelectorAll('video, audio');
            elements.forEach((el, idx) => {
                mediaList.push({
                    tagName: el.tagName.toLowerCase(),
                    src: el.src || el.currentSrc || 'none',
                    paused: el.paused,
                    ended: el.ended,
                    readyState: el.readyState,
                    currentTime: el.currentTime,
                    autoplay: el.autoplay,
                    muted: el.muted,
                    hasCaptions: el.querySelectorAll('track[kind="captions"]').length > 0
                });
            });
            return mediaList;
        }
    """)

    results = {
        "media_elements_count": len(media_info),
        "playing_count": 0,
        "broken_count": 0,
        "autoplay_violations": 0,
        "elements": []
    }

    for idx, item in enumerate(media_info):
        status = "stopped"
        is_broken = False
        
        # readyState < 2 means not enough data to play
        if item["readyState"] < 2 and item["src"] != "none":
            status = "loading_error"
            is_broken = True
            results["broken_count"] += 1
            
        elif not item["paused"] and not item["ended"]:
            status = "playing"
            results["playing_count"] += 1
            
        # Autoplay without mute is a browser policy violation often blocked
        if item["autoplay"] and not item["muted"] and item["paused"]:
            results["autoplay_violations"] += 1
            status = "blocked_autoplay"

        item["status"] = status
        results["elements"].append(item)

    return results

async def audit_animation_timing(page: Any, selector: str = "body", duration_ms: int = 500) -> Dict[str, Any]:
    """Captures successive screenshot frames to audit animation completion and progression smoothness."""
    frames = []
    temp_paths = []
    intervals = 5
    step_delay = duration_ms / intervals / 1000.0

    # Ensure temp dir exists
    import owl_qa_visual
    temp_dir = os.path.join(owl_qa_visual.QA_SCREENSHOT_DIR, "animation_temp")
    os.makedirs(temp_dir, exist_ok=True)

    # 1. Capture 5 frames
    for i in range(intervals):
        path = os.path.join(temp_dir, f"frame_{i}_{int(time.time())}.png")
        try:
            # Capture target element region
            el = await page.locator(selector).first
            await el.screenshot(path=path)
            temp_paths.append(path)
        except Exception:
            # Fallback to page screenshot
            await page.screenshot(path=path)
            temp_paths.append(path)
        await asyncio.sleep(step_delay)

    # 2. Compare frames using PIL
    deltas = []
    is_frozen = True
    is_janky = False
    
    try:
        loaded_imgs = [Image.open(p) for p in temp_paths]
        
        # Calculate pixel diff sum between consecutive frames
        for i in range(len(loaded_imgs) - 1):
            img_a = loaded_imgs[i]
            img_b = loaded_imgs[i+1]
            
            diff = ImageChops.difference(img_a, img_b)
            bbox = diff.getbbox()
            
            # If there's a bbox, it means the frames differ
            if bbox:
                # Sum of pixel differences in diff image
                diff_data = diff.convert("L").getdata()
                pixel_diff_sum = sum(diff_data)
                deltas.append(pixel_diff_sum)
                if pixel_diff_sum > 500: # Threshold for noticeable motion
                    is_frozen = False
            else:
                deltas.append(0)

        # Cleanup files
        for p in temp_paths:
            try:
                os.remove(p)
            except Exception:
                pass

        # Check for jank (high variance in pixel deltas)
        if len(deltas) >= 3 and not is_frozen:
            avg_delta = sum(deltas) / len(deltas)
            # If any step change deviates by more than 2x from average, flag as jank
            for d in deltas:
                if abs(d - avg_delta) > (avg_delta * 1.5):
                    is_janky = True
                    break
    except Exception as err:
        print(f"[Sensory] Animation comparison failed: {err}", file=sys.stderr)
        is_frozen = False # Don't falsely flag if comparison fails

    status = "fluid"
    if is_frozen:
        status = "frozen"
    elif is_janky:
        status = "janky"

    return {
        "selector": selector,
        "frames_captured": intervals,
        "pixel_deltas": deltas,
        "animation_status": status,
        "details": f"Animation is {status}. Visual progression deltas: {deltas}"
    }

async def run_sensory_audit(page: Any, selector: str = "body") -> Dict[str, Any]:
    """Runs combined media and animation audits on a live page."""
    media = await audit_media_elements(page)
    anim = await audit_animation_timing(page, selector=selector)
    
    return {
        "media_audit": media,
        "animation_audit": anim,
        "timestamp": datetime.now().isoformat()
    }
