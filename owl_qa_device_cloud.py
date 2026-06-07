"""
OWL QA Device Cloud Module (Pillar 5)
=====================================
Discovers connected Android emulators and physical devices (USB/WiFi).
Gathers device specifications and coordinates parallel test execution.
"""

import asyncio
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from owl_shared_intelligence import _OWL_DB_PATH

def get_connected_serials() -> List[str]:
    """Queries adb devices to get list of active serial identifiers."""
    serials = []
    try:
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        lines = res.stdout.splitlines()
        for line in lines[1:]: # Skip headers
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                serials.append(parts[0])
    except Exception as e:
        print(f"[Device Cloud] ADB serial query failed: {e}", file=sys.stderr)
    return serials

def get_device_metadata(serial: str) -> Dict[str, Any]:
    """Gathers hardware and software profile information from a specific ADB device."""
    meta = {
        "serial": serial,
        "model": "Unknown",
        "manufacturer": "Unknown",
        "os_version": "Unknown",
        "api_level": 0,
        "screen_width": 1080,
        "screen_height": 1920,
        "ram_mb": 2048,
        "connection_type": "usb"
    }

    if ":" in serial:
        meta["connection_type"] = "wifi"

    try:
        # 1. Get build properties
        res = subprocess.run(["adb", "-s", serial, "shell", "getprop"], capture_output=True, text=True, timeout=5)
        props = res.stdout
        
        model_match = re.search(r'\[ro\.product\.model\]:\s*\[(.*?)\]', props)
        mfr_match = re.search(r'\[ro\.product\.manufacturer\]:\s*\[(.*?)\]', props)
        os_match = re.search(r'\[ro\.build\.version\.release\]:\s*\[(.*?)\]', props)
        api_match = re.search(r'\[ro\.build\.version\.sdk\]:\s*\[(.*?)\]', props)
        
        if model_match: meta["model"] = model_match.group(1)
        if mfr_match: meta["manufacturer"] = mfr_match.group(1)
        if os_match: meta["os_version"] = os_match.group(1)
        if api_match: meta["api_level"] = int(api_match.group(1))

        # 2. Get screen size
        size_res = subprocess.run(["adb", "-s", serial, "shell", "wm", "size"], capture_output=True, text=True, timeout=3)
        size_match = re.search(r'Physical size:\s*(\d+)x(\d+)', size_res.stdout)
        if size_match:
            meta["screen_width"] = int(size_match.group(1))
            meta["screen_height"] = int(size_match.group(2))

        # 3. Get RAM
        ram_res = subprocess.run(["adb", "-s", serial, "shell", "cat", "/proc/meminfo"], capture_output=True, text=True, timeout=3)
        ram_match = re.search(r'MemTotal:\s*(\d+)\s*kB', ram_res.stdout)
        if ram_match:
            kb = int(ram_match.group(1))
            meta["ram_mb"] = int(kb / 1024)

    except Exception as e:
        print(f"[Device Cloud] Failed to read metadata for {serial}: {e}", file=sys.stderr)

    return meta

def sync_device_registry() -> List[Dict[str, Any]]:
    """Scans connected devices and updates the SQLite active device registry."""
    serials = get_connected_serials()
    devices = []
    
    # Register each device
    try:
        with sqlite3.connect(_OWL_DB_PATH) as conn:
            # Create table if missing
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS qa_device_registry (
                  serial TEXT PRIMARY KEY,
                  model TEXT, manufacturer TEXT,
                  os_version TEXT, api_level INTEGER,
                  screen_width INTEGER, screen_height INTEGER,
                  screen_density INTEGER, ram_mb INTEGER,
                  connection_type TEXT,
                  last_seen TEXT, is_active INTEGER DEFAULT 1
                );
                """
            )
            
            # Set older registry entries to inactive
            conn.execute("UPDATE qa_device_registry SET is_active = 0")
            
            for serial in serials:
                meta = get_device_metadata(serial)
                devices.append(meta)
                conn.execute(
                    """
                    INSERT OR REPLACE INTO qa_device_registry 
                      (serial, model, manufacturer, os_version, api_level, 
                       screen_width, screen_height, screen_density, ram_mb, 
                       connection_type, last_seen, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 420, ?, ?, ?, 1)
                    """,
                    (
                        meta["serial"], meta["model"], meta["manufacturer"],
                        meta["os_version"], meta["api_level"], meta["screen_width"],
                        meta["screen_height"], meta["ram_mb"], meta["connection_type"],
                        datetime.now(timezone.utc).isoformat()
                    )
                )
            conn.commit()
    except Exception as e:
        print(f"[Device Cloud] Error syncing device registry: {e}", file=sys.stderr)
        
    return devices

def auto_connect_wifi_devices(subnet_base: str = "192.168.1") -> List[str]:
    """Helper to auto scan subnet for debug ports and connect via WiFi-ADB."""
    connected = []
    # In background, we check common IPs on the network segment
    # For speed, we just try to ping typical ranges asynchronously
    print(f"[Device Cloud] Scanning subnet {subnet_base}.x for open ADB ports (5555)...", file=sys.stderr)
    
    # Standard ADB port setup
    # subprocess.run(["adb", "tcpip", "5555"]) # Needs USB active first
    
    # Scan mock subnet range (e.g. 192.168.1.100 - 192.168.1.120)
    for i in range(100, 115):
        ip = f"{subnet_base}.{i}"
        try:
            # Quick tcp connect check
            res = subprocess.run(["adb", "connect", f"{ip}:5555"], capture_output=True, text=True, timeout=1)
            if "connected to" in res.stdout:
                connected.append(f"{ip}:5555")
        except Exception:
            pass
            
    return connected

async def run_parallel_android_flow(package: str, steps: List[Dict[str, Any]], project: str = "default") -> Dict[str, Any]:
    """Executes a uiautomator2 test flow across all connected devices in parallel."""
    import owl_qa_android
    devices = sync_device_registry()
    active_devices = [d for d in devices if d["connection_type"] != "unknown"]
    
    if not active_devices:
        return {"error": "No active Android devices found in registry to execute."}

    results = {}
    
    # Core parallel execution block
    async def run_on_single_device(device_meta: Dict[str, Any]):
        serial = device_meta["serial"]
        dev_name = f"{device_meta['manufacturer']} {device_meta['model']} ({serial})"
        
        try:
            # Connect uiautomator2 device
            d = owl_qa_android.connect_device(serial)
            if not d:
                return serial, {"passed": False, "error": "uiautomator2 connection failed"}
                
            owl_qa_android.start_app(d, package)
            await asyncio.sleep(2.0)
            
            # Step execution loop
            passed = True
            err_msg = ""
            for idx, step in enumerate(steps):
                act = step["action_type"]
                x, y = step.get("x"), step.get("y")
                res_id = step.get("resource_id")
                text = step.get("text")
                val = step.get("value")
                
                try:
                    if act == "tap":
                        owl_qa_android.tap(d, x, y)
                    elif act == "tap_by_element":
                        success = owl_qa_android.tap_by_element(d, res_id, text)
                        if not success:
                            raise ValueError(f"Selector {res_id or text} not found")
                    elif act == "swipe":
                        owl_qa_android.swipe(d, val or "up")
                    elif act == "wait":
                        await asyncio.sleep(float(val or 1.0))
                except Exception as e:
                    passed = False
                    err_msg = str(e)
                    break
                    
            return serial, {
                "device_name": dev_name,
                "passed": passed,
                "error": err_msg
            }
        except Exception as e:
            return serial, {
                "device_name": dev_name,
                "passed": False,
                "error": f"Device execution crash: {e}"
            }

    # Asynchronous gather call runs all tests concurrently
    tasks = [run_on_single_device(d) for d in active_devices]
    execution_reports = await asyncio.gather(*tasks)
    
    for serial, report in execution_reports:
        results[serial] = report
        
    return results
