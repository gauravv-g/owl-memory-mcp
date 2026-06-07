"""
OWL QA Android Intelligence Module
====================================
Handles ADB device connectivity, uiautomator2 automation, logcat crash monitoring,
and screen recording.
"""

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# -- Storage paths ────────────────────────────────────────────────────────────
_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

QA_SCREENSHOT_DIR = os.path.join(os.path.dirname(_OWL_DB_PATH), "qa-screenshots")
os.makedirs(QA_SCREENSHOT_DIR, exist_ok=True)

# -- Standard Android SDK path detector ───────────────────────────────────────
def configure_adb_path():
    """Detect and append the Android SDK platform-tools folder to the path."""
    standard_paths = [
        "C:\\Android\\SDK\\platform-tools",
        os.path.join(os.path.expanduser("~"), "AppData", "Local", "Android", "Sdk", "platform-tools"),
    ]
    for path in standard_paths:
        if os.path.isdir(path):
            if path not in os.environ["PATH"]:
                os.environ["PATH"] = path + os.path.pathsep + os.environ["PATH"]
                break

configure_adb_path()

# -- Lazy import uiautomator2 and PIL ─────────────────────────────────────────
_u2_available = False
_pil_available = False

try:
    import uiautomator2 as u2
    _u2_available = True
except ImportError:
    pass

try:
    from PIL import Image
    _pil_available = True
except ImportError:
    pass


# -- Device Connection ────────────────────────────────────────────────────────
def list_connected_devices() -> List[str]:
    """List all connected Android device serial numbers."""
    try:
        result = subprocess.run(
            ["adb", "devices"],
            capture_output=True,
            text=True,
            check=True
        )
        devices = []
        for line in result.stdout.strip().split("\n")[1:]:
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                devices.append(parts[0])
        return devices
    except Exception as e:
        print(f"[QA Android] Error running adb devices: {e}", file=sys.stderr)
        return []


def connect_device(device_id: Optional[str] = None) -> Optional[Any]:
    """
    Connect to an Android device using uiautomator2.
    If device_id is omitted, connects to the single active device.
    """
    if not _u2_available:
        print("[QA Android] uiautomator2 package is not installed.", file=sys.stderr)
        return None

    devices = list_connected_devices()
    if not devices:
        print("[QA Android] No Android devices or emulators found.", file=sys.stderr)
        return None

    target_id = device_id
    if not target_id:
        if len(devices) == 1:
            target_id = devices[0]
        else:
            print(f"[QA Android] Multiple devices found: {devices}. Please specify one.", file=sys.stderr)
            return None

    if target_id not in devices:
        print(f"[QA Android] Device {target_id} is not connected.", file=sys.stderr)
        return None

    try:
        device = u2.connect(target_id)
        # Verify connection works by calling info
        device.info
        return device
    except Exception as e:
        print(f"[QA Android] Connection to device {target_id} failed: {e}", file=sys.stderr)
        return None


# -- View Hierarchy and Caching ──────────────────────────────────────────────
_hierarchy_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_cache_lock = threading.Lock()

def parse_bounds(bounds_str: str) -> Tuple[int, int, int, int]:
    """Parse bounds string like [0,0][1080,1920] into (x, y, width, height)."""
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds_str)
    if not match:
        return 0, 0, 0, 0
    x1, y1, x2, y2 = map(int, match.groups())
    return x1, y1, x2 - x1, y2 - y1


def get_android_hierarchy(device: Any, force: bool = False) -> List[Dict[str, Any]]:
    """
    Get the list of interactive or descriptive elements from the screen.
    Caches results for 500 milliseconds to prevent repetitive ADB queries.
    """
    device_serial = device.serial if hasattr(device, "serial") else "default"
    now = time.time()

    with _cache_lock:
        if not force and device_serial in _hierarchy_cache:
            cache_time, cached_elements = _hierarchy_cache[device_serial]
            if now - cache_time < 0.5:
                return cached_elements

    try:
        # Get XML dump
        xml_dump = device.dump_hierarchy()
        if not xml_dump:
            return []

        # Parse XML
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_dump)
        elements = []

        def traverse(node):
            attrib = node.attrib
            bounds_str = attrib.get("bounds", "")
            x, y, w, h = parse_bounds(bounds_str)

            # We care about visible and interactive/descriptive nodes
            is_clickable = attrib.get("clickable", "false") == "true"
            is_focusable = attrib.get("focusable", "false") == "true"
            is_scrollable = attrib.get("scrollable", "false") == "true"
            is_enabled = attrib.get("enabled", "true") == "true"
            text = attrib.get("text", "").strip()
            desc = attrib.get("content-desc", "").strip()
            res_id = attrib.get("resource-id", "").strip()
            cls = attrib.get("class", "").strip()

            if w > 0 and h > 0:
                is_meaningful = (
                    is_clickable or is_focusable or is_scrollable or
                    text or desc or res_id
                )
                if is_meaningful:
                    elements.append({
                        "resource_id": res_id,
                        "text": text[:100],
                        "content_desc": desc[:100],
                        "class_name": cls,
                        "clickable": is_clickable,
                        "focusable": is_focusable,
                        "scrollable": is_scrollable,
                        "enabled": is_enabled,
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "center_x": x + w // 2,
                        "center_y": y + h // 2
                    })

            for child in node:
                traverse(child)

        traverse(root)

        with _cache_lock:
            _hierarchy_cache[device_serial] = (now, elements)

        return elements
    except Exception as e:
        print(f"[QA Android] Hierarchy dump parsing failed: {e}", file=sys.stderr)
        return []


# -- Actions ──────────────────────────────────────────────────────────────────
def capture_android_screenshot(
    device: Any,
    run_id: str,
    step_name: str,
    variant: str = ""
) -> Optional[str]:
    """
    Capture device screen and save as WebP.
    Returns the absolute file path, or None on failure.
    """
    if not device:
        return None

    # Construct file path
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    name_parts = [run_id[:8], step_name, variant, timestamp] if variant else [run_id[:8], step_name, timestamp]
    filename = "_".join(name_parts).replace(" ", "_").replace("/", "-") + ".webp"
    filepath = os.path.join(QA_SCREENSHOT_DIR, filename)

    try:
        # Get screenshot PIL Image directly from uiautomator2
        pil_img = device.screenshot()
        if not pil_img:
            return None

        # Save as WebP with 85% quality
        pil_img.save(filepath, "WEBP", quality=85, method=6)
        return filepath
    except Exception as e:
        print(f"[QA Android] Screenshot failed: {e}", file=sys.stderr)
        return None


def tap(device: Any, x: int, y: int):
    """Tap coordinates on the screen."""
    device.click(x, y)


def tap_by_element(device: Any, resource_id: Optional[str] = None, text: Optional[str] = None) -> bool:
    """
    Find element by ID or text and tap its center.
    Returns True if found and tapped, False otherwise.
    """
    elements = get_android_hierarchy(device, force=True)
    for el in elements:
        match_id = resource_id and el["resource_id"] == resource_id
        match_text = text and el["text"] == text
        if match_id or match_text:
            device.click(el["center_x"], el["center_y"])
            return True
    return False


def swipe(device: Any, direction: str, distance: float = 0.5):
    """
    Swipe in a direction (up, down, left, right).
    Distance is percentage of the screen dimensions.
    """
    # Get screen width and height
    info = device.info
    w = info.get("displayWidth", 1080)
    h = info.get("displayHeight", 1920)

    center_x = w // 2
    center_y = h // 2
    
    if direction == "up":
        device.swipe(center_x, int(center_y * 1.5), center_x, int(center_y * 0.5))
    elif direction == "down":
        device.swipe(center_x, int(center_y * 0.5), center_x, int(center_y * 1.5))
    elif direction == "left":
        device.swipe(int(center_x * 1.5), center_y, int(center_x * 0.5), center_y)
    elif direction == "right":
        device.swipe(int(center_x * 0.5), center_y, int(center_x * 1.5), center_y)


def type_text(device: Any, text: str):
    """Type text into the currently focused input field."""
    device.send_keys(text)


def press_key(device: Any, key: str):
    """Press a physical or virtual key (e.g., home, back, enter)."""
    device.press(key)


def start_app(device: Any, package: str):
    """Start an Android application by package name."""
    device.app_start(package)


def stop_app(device: Any, package: str):
    """Stop an Android application by package name."""
    device.app_stop(package)


def get_current_activity(device: Any) -> Dict[str, str]:
    """Get the active app package and activity name."""
    res = device.app_current()
    return {
        "package": res.get("package", ""),
        "activity": res.get("activity", "")
    }


# -- Logcat Crash Monitor ─────────────────────────────────────────────────────
class AndroidCrashMonitor:
    """Watches logcat output for fatal exceptions and app crashes."""
    def __init__(self, device_id: str, package_name: str):
        self.device_id = device_id
        self.package_name = package_name
        self.crashes: List[Dict[str, Any]] = []
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._process: Optional[subprocess.Popen] = None

    def start(self):
        """Start the background logcat parser thread."""
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> List[Dict[str, Any]]:
        """Stop parsing logcat and return any caught crashes."""
        self._stop_event.set()
        if self._process:
            try:
                self._process.terminate()
            except Exception:
                pass
        if self._thread:
            self._thread.join(timeout=1.0)
        return self.crashes

    def _run(self):
        # Clear logcat first
        subprocess.run(["adb", "-s", self.device_id, "logcat", "-c"], capture_output=True)
        
        # Read logcat
        cmd = ["adb", "-s", self.device_id, "logcat", "*:E"]
        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
        except Exception as e:
            print(f"[QA Android] Failed to start logcat process: {e}", file=sys.stderr)
            return

        crash_patterns = [
            r"FATAL EXCEPTION",
            r"Process: " + re.escape(self.package_name),
            r"ANR in " + re.escape(self.package_name)
        ]

        buffer = []
        while not self._stop_event.is_set():
            line = self._process.stdout.readline()
            if not line:
                break
            
            buffer.append(line.strip())
            if len(buffer) > 100:
                buffer.pop(0)

            # Check if line indicates a crash
            if any(re.search(pat, line, re.IGNORECASE) for pat in crash_patterns):
                # Capture surrounding context
                context = list(buffer[-15:])
                # Read a few more lines to get the stack trace
                for _ in range(20):
                    next_line = self._process.stdout.readline()
                    if next_line:
                        context.append(next_line.strip())
                    else:
                        break
                
                self.crashes.append({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "trigger_line": line.strip(),
                    "logcat_trace": "\n".join(context)
                })
                # Prevent flood
                time.sleep(0.5)


# -- Screen Recording ─────────────────────────────────────────────────────────
class AndroidScreenRecorder:
    """Manages recording device screen to mp4."""
    def __init__(self, device_id: str):
        self.device_id = device_id
        self._process: Optional[subprocess.Popen] = None
        self.temp_device_path = "/sdcard/temp_qa_record.mp4"

    def start(self):
        """Start recording screen on the device."""
        cmd = [
            "adb", "-s", self.device_id, "shell",
            f"screenrecord --size 1280x720 {self.temp_device_path}"
        ]
        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
        except Exception as e:
            print(f"[QA Android] Screen recording failed to start: {e}", file=sys.stderr)

    def stop(self, local_destination_path: str) -> bool:
        """Stop recording and transfer file to local storage."""
        if not self._process:
            return False

        try:
            # Terminate screenrecord cleanly with SIGINT (Ctrl+C)
            # screenrecord requires SIGINT to finalize MP4 file format
            import signal
            # On Windows, we send Ctrl_C_Event
            self._process.send_signal(signal.CTRL_C_EVENT)
        except Exception:
            try:
                self._process.terminate()
            except Exception:
                pass

        try:
            self._process.wait(timeout=3.0)
        except Exception:
            pass

        # Give it a second to write the file header
        time.sleep(1.0)

        # Pull to host machine
        pull_success = False
        try:
            pull_res = subprocess.run(
                ["adb", "-s", self.device_id, "pull", self.temp_device_path, local_destination_path],
                capture_output=True,
                check=True
            )
            pull_success = os.path.exists(local_destination_path)
        except Exception as e:
            print(f"[QA Android] Pulling video file failed: {e}", file=sys.stderr)

        # Remove file from device
        try:
            subprocess.run(
                ["adb", "-s", self.device_id, "shell", "rm", self.temp_device_path],
                capture_output=True
            )
        except Exception:
            pass

        self._process = None
        return pull_success


# -- OWL memory integration ───────────────────────────────────────────────────
def store_android_observation_in_owl(
    target_package: str,
    run_id: str,
    screenshot_path: Optional[str],
    vision_result: dict,
    hierarchy_elements: List[dict],
    project: str = "default"
) -> Optional[str]:
    """Store Android device inspection details as an episodic memory in OWL."""
    if not os.path.exists(_OWL_DB_PATH):
        return None
    try:
        screen_type = vision_result.get("screen_type", "unknown")
        current_state = vision_result.get("current_state", "")
        errors = vision_result.get("errors_visible", [])
        anomalies = vision_result.get("anomalies", [])

        content_parts = [f"[QA ANDROID OBSERVATION] {target_package}"]
        content_parts.append(f"Screen: {screen_type} | State: {current_state}")
        if errors:
            content_parts.append(f"Errors: {'; '.join(errors[:3])}")
        if anomalies:
            content_parts.append(f"Anomalies: {'; '.join(anomalies[:3])}")
        content_parts.append(f"Interactive elements count: {len(hierarchy_elements)}")

        content = "\n".join(content_parts)
        mem_id = "qa_and_" + hashlib.sha256(
            (content + run_id).encode()
        ).hexdigest()[:16]
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Determine arousal/salience based on issues detected
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
        print(f"[QA Android] OWL store failed: {e}", file=sys.stderr)
        return None
