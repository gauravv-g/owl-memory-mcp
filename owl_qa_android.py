"""
OWL QA Android MCP Server
ADB device connectivity, uiautomator2 automation, logcat crash monitoring, and screen recording.
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

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

_OWL_DB_PATH = os.environ.get(
    "OWL_MEMORY_DB",
    os.path.join(os.path.expanduser("~"), ".owl-memory", "memory-v5.db")
)

QA_SCREENSHOT_DIR = os.path.join(os.path.dirname(_OWL_DB_PATH), "qa-screenshots")
os.makedirs(QA_SCREENSHOT_DIR, exist_ok=True)


def configure_adb_path():
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


def list_connected_devices() -> List[str]:
    try:
        result = subprocess.run(["adb", "devices"], capture_output=True, text=True, check=True)
        devices = []
        for line in result.stdout.strip().split("\n")[1:]:
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                devices.append(parts[0])
        return devices
    except Exception:
        return []


def connect_device(device_id: Optional[str] = None) -> Optional[Any]:
    if not _u2_available:
        return None
    devices = list_connected_devices()
    if not devices:
        return None
    target_id = device_id
    if not target_id:
        if len(devices) == 1:
            target_id = devices[0]
        else:
            return None
    try:
        device = u2.connect(target_id)
        device.info
        return device
    except Exception:
        return None


def parse_bounds(bounds_str: str) -> Tuple[int, int, int, int]:
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds_str)
    if not match:
        return 0, 0, 0, 0
    x1, y1, x2, y2 = map(int, match.groups())
    return x1, y1, x2 - x1, y2 - y1


def get_android_hierarchy(device: Any) -> List[Dict[str, Any]]:
    try:
        xml_dump = device.dump_hierarchy()
        if not xml_dump:
            return []
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_dump)
        elements = []

        def traverse(node):
            attrib = node.attrib
            bounds_str = attrib.get("bounds", "")
            x, y, w, h = parse_bounds(bounds_str)
            is_clickable = attrib.get("clickable", "false") == "true"
            is_focusable = attrib.get("focusable", "false") == "true"
            is_scrollable = attrib.get("scrollable", "false") == "true"
            is_enabled = attrib.get("enabled", "true") == "true"
            text = attrib.get("text", "").strip()
            desc = attrib.get("content-desc", "").strip()
            res_id = attrib.get("resource-id", "").strip()
            cls = attrib.get("class", "").strip()
            if w > 0 and h > 0:
                if is_clickable or is_focusable or is_scrollable or text or desc or res_id:
                    elements.append({
                        "resource_id": res_id, "text": text[:100], "content_desc": desc[:100],
                        "class_name": cls, "clickable": is_clickable, "focusable": is_focusable,
                        "scrollable": is_scrollable, "enabled": is_enabled,
                        "x": x, "y": y, "width": w, "height": h,
                        "center_x": x + w // 2, "center_y": y + h // 2
                    })
            for child in node:
                traverse(child)

        traverse(root)
        return elements
    except Exception:
        return []


def capture_android_screenshot(device: Any, run_id: str, step_name: str) -> Optional[str]:
    if not device:
        return None
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{run_id[:8]}_{step_name}_{timestamp}.webp".replace(" ", "_").replace("/", "-")
    filepath = os.path.join(QA_SCREENSHOT_DIR, filename)
    try:
        pil_img = device.screenshot()
        if not pil_img:
            return None
        pil_img.save(filepath, "WEBP", quality=85, method=6)
        return filepath
    except Exception:
        return None


def tap(device: Any, x: int, y: int):
    device.click(x, y)


def tap_by_element(device: Any, resource_id: Optional[str] = None, text: Optional[str] = None) -> bool:
    elements = get_android_hierarchy(device)
    for el in elements:
        match_id = resource_id and el["resource_id"] == resource_id
        match_text = text and el["text"] == text
        if match_id or match_text:
            device.click(el["center_x"], el["center_y"])
            return True
    return False


def swipe(device: Any, direction: str, distance: float = 0.5):
    info = device.info
    w = info.get("displayWidth", 1080)
    h = info.get("displayHeight", 1920)
    cx, cy = w // 2, h // 2
    if direction == "up":
        device.swipe(cx, int(cy * 1.5), cx, int(cy * 0.5))
    elif direction == "down":
        device.swipe(cx, int(cy * 0.5), cx, int(cy * 1.5))
    elif direction == "left":
        device.swipe(int(cx * 1.5), cy, int(cx * 0.5), cy)
    elif direction == "right":
        device.swipe(int(cx * 0.5), cy, int(cx * 1.5), cy)


def type_text(device: Any, text: str):
    device.send_keys(text)


def press_key(device: Any, key: str):
    device.press(key)


def start_app(device: Any, package: str):
    device.app_start(package)


def stop_app(device: Any, package: str):
    device.app_stop(package)


def get_current_activity(device: Any) -> Dict[str, str]:
    res = device.app_current()
    return {"package": res.get("package", ""), "activity": res.get("activity", "")}


# ─── MCP Server ──────────────────────────────────────────────────────────────

server = Server("owl-qa-android")

TOOLS = [
    Tool(
        name="qa_android_devices",
        description="List all connected Android device serial numbers.",
        inputSchema={"type": "object", "properties": {}}
    ),
    Tool(
        name="qa_android_connect",
        description="Connect to an Android device. If device_id omitted, connects to the single active device.",
        inputSchema={
            "type": "object",
            "properties": {
                "device_id": {"type": "string"}
            }
        }
    ),
    Tool(
        name="qa_android_hierarchy",
        description="Get the list of interactive/descriptive UI elements from the device screen.",
        inputSchema={
            "type": "object",
            "properties": {
                "device_id": {"type": "string"}
            }
        }
    ),
    Tool(
        name="qa_android_screenshot",
        description="Capture device screen and save as WebP. Returns the absolute file path.",
        inputSchema={
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "default": "default"},
                "step_name": {"type": "string", "default": "step"},
                "device_id": {"type": "string"}
            }
        }
    ),
    Tool(
        name="qa_android_tap",
        description="Tap coordinates on the device screen.",
        inputSchema={
            "type": "object",
            "properties": {
                "x": {"type": "integer"},
                "y": {"type": "integer"},
                "device_id": {"type": "string"}
            },
            "required": ["x", "y"]
        }
    ),
    Tool(
        name="qa_android_tap_element",
        description="Find element by resource_id or text and tap its center.",
        inputSchema={
            "type": "object",
            "properties": {
                "resource_id": {"type": "string"},
                "text": {"type": "string"},
                "device_id": {"type": "string"}
            }
        }
    ),
    Tool(
        name="qa_android_swipe",
        description="Swipe in a direction (up, down, left, right).",
        inputSchema={
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "distance": {"type": "number", "default": 0.5},
                "device_id": {"type": "string"}
            },
            "required": ["direction"]
        }
    ),
    Tool(
        name="qa_android_type",
        description="Type text into the currently focused input field.",
        inputSchema={
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "device_id": {"type": "string"}
            },
            "required": ["text"]
        }
    ),
    Tool(
        name="qa_android_press",
        description="Press a physical or virtual key (home, back, enter, etc).",
        inputSchema={
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "device_id": {"type": "string"}
            },
            "required": ["key"]
        }
    ),
    Tool(
        name="qa_android_start_app",
        description="Start an Android application by package name.",
        inputSchema={
            "type": "object",
            "properties": {
                "package": {"type": "string"},
                "device_id": {"type": "string"}
            },
            "required": ["package"]
        }
    ),
    Tool(
        name="qa_android_stop_app",
        description="Stop an Android application by package name.",
        inputSchema={
            "type": "object",
            "properties": {
                "package": {"type": "string"},
                "device_id": {"type": "string"}
            },
            "required": ["package"]
        }
    ),
    Tool(
        name="qa_android_activity",
        description="Get the currently active app package and activity name.",
        inputSchema={
            "type": "object",
            "properties": {
                "device_id": {"type": "string"}
            }
        }
    ),
]


@server.list_tools()
async def list_tools():
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    device_id = arguments.get("device_id")

    if name == "qa_android_devices":
        devices = list_connected_devices()
        return [TextContent(type="text", text=json.dumps({"devices": devices, "uiautomator2": _u2_available}))]

    if _u2_available:
        device = connect_device(device_id)
    else:
        device = None

    if name == "qa_android_connect":
        if not _u2_available:
            return [TextContent(type="text", text=json.dumps({"error": "uiautomator2 not installed. pip install uiautomator2"}))]
        if device:
            return [TextContent(type="text", text=json.dumps({"connected": True, "device_id": device.serial}))]
        return [TextContent(type="text", text=json.dumps({"connected": False, "error": "No device found or multiple devices without device_id"}))]

    elif name == "qa_android_hierarchy":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        elements = get_android_hierarchy(device)
        return [TextContent(type="text", text=json.dumps({"elements": elements, "count": len(elements)}))]

    elif name == "qa_android_screenshot":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        run_id = arguments.get("run_id", "default")
        step_name = arguments.get("step_name", "step")
        path = capture_android_screenshot(device, run_id, step_name)
        return [TextContent(type="text", text=json.dumps({"path": path}))]

    elif name == "qa_android_tap":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        tap(device, arguments["x"], arguments["y"])
        return [TextContent(type="text", text=json.dumps({"tapped": True, "x": arguments["x"], "y": arguments["y"]}))]

    elif name == "qa_android_tap_element":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        found = tap_by_element(device, arguments.get("resource_id"), arguments.get("text"))
        return [TextContent(type="text", text=json.dumps({"tapped": found}))]

    elif name == "qa_android_swipe":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        swipe(device, arguments["direction"], arguments.get("distance", 0.5))
        return [TextContent(type="text", text=json.dumps({"swiped": arguments["direction"]}))]

    elif name == "qa_android_type":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        type_text(device, arguments["text"])
        return [TextContent(type="text", text=json.dumps({"typed": True}))]

    elif name == "qa_android_press":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        press_key(device, arguments["key"])
        return [TextContent(type="text", text=json.dumps({"pressed": arguments["key"]}))]

    elif name == "qa_android_start_app":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        start_app(device, arguments["package"])
        return [TextContent(type="text", text=json.dumps({"started": arguments["package"]}))]

    elif name == "qa_android_stop_app":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        stop_app(device, arguments["package"])
        return [TextContent(type="text", text=json.dumps({"stopped": arguments["package"]}))]

    elif name == "qa_android_activity":
        if not device:
            return [TextContent(type="text", text=json.dumps({"error": "No device connected"}))]
        activity = get_current_activity(device)
        return [TextContent(type="text", text=json.dumps(activity))]

    else:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
