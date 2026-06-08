"""
OWL Security MCP Server — Automated Security Audit Engine
=========================================================
Bank-grade security scanning for web applications, APIs, and codebases.
Goes beyond basic linting — finds real vulnerabilities.

Tools (10):
  security_secret_scan     — Detect hardcoded secrets, API keys, tokens in code
  security_dependency_scan — Check dependencies for known CVEs
  security_owasp_scan      — OWASP Top 10 vulnerability patterns
  security_code_audit      — Deep code audit for security anti-patterns
  security_api_audit       — API endpoint security analysis
  security_cve_lookup      — Look up CVE details for a package/version
  security_headers_check   — HTTP security headers analysis
  security_cors_audit      — CORS misconfiguration detection
  security_auth_audit      — Authentication/authorization flow audit
  security_report          — Comprehensive security report combining all scans

Dependencies: Python 3.11+, httpx (for HTTP checks)
"""

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

# ─── Secret Detection Patterns ────────────────────────────────────────────────

SECRET_PATTERNS = {
    "AWS Access Key": r"(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}",
    "AWS Secret Key": r"(?:aws_secret_access_key|aws_secret|secret_key)\s*[:=]\s*['\"]([a-zA-Z0-9/+=]{40})['\"]",
    "Generic API Key": r"(?:api_key|apikey|api-key)\s*[:=]\s*['\"]([a-zA-Z0-9_\-]{16,})['\"]",
    "Generic Secret": r"(?:secret|private_key|private-key)\s*[:=]\s*['\"]([a-zA-Z0-9_\-]{16,})['\"]",
    "Password Assignment": r"(?:password|passwd|pwd)\s*[:=]\s*['\"]([^'\"]{8,})['\"]",
    "JWT Token": r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    "GitHub Token": r"(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{36,}",
    "Slack Token": r"xox[bprs]-[A-Za-z0-9-]{10,}",
    "Slack Webhook": r"https://hooks\.slack\.com/services/T[a-zA-Z0-9_]{8}/B[a-zA-Z0-9_]{8}/[a-zA-Z0-9_]{24}",
    "Google API Key": r"AIza[0-9A-Za-z_-]{35}",
    "Stripe Key": r"(?:sk_live|pk_live|sk_test|pk_test)_[0-9a-zA-Z]{24,}",
    "Twilio SID": r"AC[0-9a-fA-F]{32}",
    "SendGrid Key": r"SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}",
    "Database URL": r"(?:postgres|mysql|mongodb|redis|amqp)://[^:]+:[^@]+@[^/]+",
    "Private Key": r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
    "Firebase URL": r"https://[a-z0-9-]+\.firebaseio\.com",
    "Heroku API Key": r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    "Bearer Token": r"(?:bearer|token)\s+['\"]?([A-Za-z0-9_\-\.]{20,})['\"]?",
    "Basic Auth": r"Basic\s+[A-Za-z0-9+/]{20,}={0,2}",
}

# Files to skip during secret scanning
SKIP_EXTENSIONS = {".pyc", ".pyo", ".so", ".dll", ".exe", ".png", ".jpg", ".jpeg", ".gif",
                   ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot", ".map", ".lock",
                   ".zip", ".tar", ".gz", ".rar", ".7z", ".pdf", ".doc", ".docx"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "env", ".env",
             "dist", "build", ".next", ".nuxt", "coverage", ".cache"}

# ─── OWASP Patterns ───────────────────────────────────────────────────────────

OWASP_PATTERNS = {
    "A01: Broken Access Control": {
        "patterns": [
            r"@login_required.*\n.*@login_required",  # Double decorator (redundant)
            r"is_admin\s*=\s*(?:True|1|'true')",  # Hardcoded admin
            r"role\s*==\s*['\"]admin['\"].*or\s+role\s*==\s*['\"]admin['\"]",  # Duplicate check
            r"request\.args\.get\(['\"](?:is_admin|admin|role)['\"]",  # User-controlled role
            r"eval\s*\(",  # eval() usage
            r"exec\s*\(",  # exec() usage
        ],
        "severity": "critical",
        "description": "Potential broken access control or code injection"
    },
    "A02: Cryptographic Failures": {
        "patterns": [
            r"md5\s*\(",  # MD5 hashing
            r"sha1\s*\(",  # SHA1 hashing
            r"DES|3DES|RC4",  # Weak ciphers
            r"ECB\s*mode",  # ECB mode
            r"hashlib\.md5",  # Python MD5
            r"hashlib\.sha1",  # Python SHA1
            r"random\.random\(\)",  # Insecure random
            r"Math\.random\(\)",  # JS insecure random
        ],
        "severity": "high",
        "description": "Weak cryptographic algorithms or insecure randomness"
    },
    "A03: Injection": {
        "patterns": [
            r"execute\s*\(\s*['\"].*%s",  # SQL string formatting
            r"execute\s*\(\s*f['\"]",  # SQL f-string
            r"\.format\s*\(.*\).*(?:SELECT|INSERT|UPDATE|DELETE)",  # SQL format
            r"SELECT\s+.*\+",  # SQL concatenation
            r"innerHTML\s*=",  # XSS via innerHTML
            r"document\.write\s*\(",  # XSS via document.write
            r"dangerouslySetInnerHTML",  # React XSS
            r"__proto__",  # Prototype pollution
            r"constructor\s*\[",  # Constructor access
        ],
        "severity": "critical",
        "description": "Potential injection vulnerability (SQL, XSS, prototype pollution)"
    },
    "A04: Insecure Design": {
        "patterns": [
            r"rate_limit\s*=\s*(?:None|0|False)",  # No rate limiting
            r"csrf_exempt",  # CSRF disabled
            r"CORS\s*\(\s*\{\s*['\"]origin['\"]\s*:\s*['\"]\*['\"]",  # Wildcard CORS
            r"Access-Control-Allow-Origin.*\*",  # Wildcard CORS header
            r"verify\s*=\s*False",  # SSL verification disabled
            r"DEBUG\s*=\s*True",  # Debug mode in production
        ],
        "severity": "high",
        "description": "Insecure design patterns"
    },
    "A05: Security Misconfiguration": {
        "patterns": [
            r"DEBUG\s*=\s*True",
            r"TESTING\s*=\s*True",
            r"SECURE_SSL_REDIRECT\s*=\s*False",
            r"SESSION_COOKIE_SECURE\s*=\s*False",
            r"CSRF_COOKIE_SECURE\s*=\s*False",
            r"X-Frame-Options.*ALLOW",
            r"ALLOWED_HOSTS\s*=\s*\[\s*['\"]\*['\"]\s*\]",
            r"CORS_ALLOW_ALL_ORIGINS\s*=\s*True",
        ],
        "severity": "medium",
        "description": "Security misconfiguration"
    },
    "A06: Vulnerable Components": {
        "patterns": [
            r"urllib3.*1\.",  # Old urllib3
            r"requests.*2\.[0-2][0-9]\.",  # Old requests
            r"lodash.*4\.[0-9]\.",  # Old lodash (prototype pollution)
            r"jquery.*[12]\.",  # Old jQuery
        ],
        "severity": "medium",
        "description": "Potentially vulnerable dependency versions"
    },
    "A07: Auth Failures": {
        "patterns": [
            r"password\s*==\s*password",  # Plain text comparison
            r"token\s*=\s*['\"][a-zA-Z0-9]{5,}['\"].*#.*hardcoded",  # Hardcoded token
            r"bcrypt.*rounds\s*=\s*[1-4]",  # Low bcrypt rounds
            r"pbkdf2.*iterations\s*=\s*(?:1000|10000)",  # Low PBKDF2 iterations
            r"session\[['\"]user['\"]\]\s*=\s*True",  # Session fixation
        ],
        "severity": "high",
        "description": "Authentication weakness"
    },
    "A08: Data Integrity": {
        "patterns": [
            r"pickle\.loads?",  # Unsafe deserialization
            r"yaml\.load\s*\([^)]*\)(?!.*Loader)",  # Unsafe YAML load
            r"unserialize\s*\(",  # PHP unserialize
            r"ObjectInputStream",  # Java deserialization
        ],
        "severity": "high",
        "description": "Unsafe deserialization"
    },
    "A09: Logging Failures": {
        "patterns": [
            r"print\s*\(.*password",  # Password logging
            r"print\s*\(.*token",  # Token logging
            r"print\s*\(.*secret",  # Secret logging
            r"console\.log\s*\(.*password",  # JS password logging
            r"logging.*password",  # Password in logs
        ],
        "severity": "medium",
        "description": "Sensitive data in logs"
    },
    "A10: SSRF": {
        "patterns": [
            r"requests\.get\s*\(.*request\.",  # User-controlled URL
            r"urllib\.request\.urlopen\s*\(.*request\.",
            r"fetch\s*\(.*(?:params|query|body)",  # User-controlled fetch
            r"http\.Get\s*\(.*(?:r\.|req\.|request\.)",  # Go user-controlled URL
        ],
        "severity": "high",
        "description": "Potential Server-Side Request Forgery"
    },
}

# ─── Tool Handlers ────────────────────────────────────────────────────────────

async def handle_secret_scan(args: dict) -> dict:
    """Scan codebase for hardcoded secrets and credentials."""
    path = args.get("path", ".")
    max_file_size = args.get("max_file_size_kb", 500) * 1024
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []
    files_scanned = 0
    files_skipped = 0

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lower()

            if ext in SKIP_EXTENSIONS:
                files_skipped += 1
                continue

            try:
                file_size = os.path.getsize(filepath)
                if file_size > max_file_size:
                    files_skipped += 1
                    continue

                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                files_scanned += 1
                rel_path = os.path.relpath(filepath, path)

                for secret_type, pattern in SECRET_PATTERNS.items():
                    matches = re.finditer(pattern, content, re.MULTILINE | re.IGNORECASE)
                    for match in matches:
                        # Get line number
                        line_num = content[:match.start()].count("\n") + 1
                        line_content = content.split("\n")[line_num - 1].strip() if line_num <= len(content.split("\n")) else ""

                        # Mask the actual secret
                        matched_text = match.group(0)
                        if len(matched_text) > 20:
                            masked = matched_text[:4] + "*" * (len(matched_text) - 8) + matched_text[-4:]
                        else:
                            masked = matched_text[:2] + "*" * (len(matched_text) - 2)

                        # Skip common false positives
                        if _is_false_positive(matched_text, secret_type):
                            continue

                        findings.append({
                            "type": secret_type,
                            "file": rel_path,
                            "line": line_num,
                            "masked_value": masked,
                            "severity": _secret_severity(secret_type),
                            "snippet": line_content[:100]
                        })
            except (IOError, OSError):
                files_skipped += 1

    # Deduplicate
    seen = set()
    unique = []
    for f in findings:
        key = (f["type"], f["file"], f["line"])
        if key not in seen:
            seen.add(key)
            unique.append(f)

    severity_counts = {}
    for f in unique:
        sev = f["severity"]
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    return {
        "findings": unique,
        "total_findings": len(unique),
        "severity_counts": severity_counts,
        "files_scanned": files_scanned,
        "files_skipped": files_skipped,
        "scan_time": _now()
    }


def _is_false_positive(text, secret_type):
    """Filter common false positives."""
    false_positive_patterns = [
        r"example", r"sample", r"test", r"dummy", r"fake",
        r"placeholder", r"xxxx", r"your_", r"my_", r"TODO",
        r"process\.env", r"getenv", r"environ\[", r"config\[",
        r"settings\[", r"os\.getenv", r"import", r"require",
    ]
    for fp in false_positive_patterns:
        if re.search(fp, text, re.IGNORECASE):
            return True
    # Skip if it's clearly a variable name assignment
    if re.match(r"^[A-Z_]+$", text) and len(text) < 30:
        return True
    return False


def _secret_severity(secret_type):
    critical_types = {"AWS Secret Key", "Private Key", "Database URL", "Stripe Key"}
    high_types = {"AWS Access Key", "GitHub Token", "Slack Token", "Google API Key",
                  "SendGrid Key", "JWT Token", "Bearer Token"}
    if secret_type in critical_types:
        return "critical"
    if secret_type in high_types:
        return "high"
    return "medium"


async def handle_dependency_scan(args: dict) -> dict:
    """Check project dependencies for known vulnerabilities."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    results = {"python": [], "node": [], "rust": [], "go": [], "java": []}

    # Python: requirements.txt
    req_file = os.path.join(path, "requirements.txt")
    if os.path.exists(req_file):
        with open(req_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    pkg = re.split(r"[=<>!~\s]", line)[0]
                    if pkg:
                        results["python"].append({"package": pkg, "version_spec": line[len(pkg):].strip() or "any"})

    # Python: pyproject.toml
    pyproject = os.path.join(path, "pyproject.toml")
    if os.path.exists(pyproject):
        with open(pyproject) as f:
            content = f.read()
        deps = re.findall(r"['\"]([a-zA-Z0-9_-]+)['\"]\s*=\s*['\"]([^'\"]+)['\"]", content)
        for pkg, ver in deps:
            if pkg not in ("python", "version", "name", "description"):
                results["python"].append({"package": pkg, "version_spec": ver})

    # Node: package.json
    pkg_json = os.path.join(path, "package.json")
    if os.path.exists(pkg_json):
        try:
            with open(pkg_json) as f:
                pkg_data = json.load(f)
            for section in ("dependencies", "devDependencies"):
                for pkg, ver in pkg_data.get(section, {}).items():
                    results["node"].append({"package": pkg, "version_spec": ver})
        except (json.JSONDecodeError, IOError):
            pass

    # Rust: Cargo.toml
    cargo = os.path.join(path, "Cargo.toml")
    if os.path.exists(cargo):
        with open(cargo) as f:
            content = f.read()
        deps = re.findall(r"^([a-zA-Z0-9_-]+)\s*=\s*['\"]([^'\"]+)['\"]", content, re.MULTILINE)
        for pkg, ver in deps:
            results["rust"].append({"package": pkg, "version_spec": ver})

    # Go: go.mod
    go_mod = os.path.join(path, "go.mod")
    if os.path.exists(go_mod):
        with open(go_mod) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 2 and not line.startswith("module"):
                    results["go"].append({"package": parts[0], "version_spec": parts[1]})

    # Try pip-audit for Python if available
    pip_audit_results = []
    try:
        audit = subprocess.run(
            [sys.executable, "-m", "pip_audit"],
            capture_output=True, text=True, timeout=60, cwd=path
        )
        if audit.returncode == 0:
            pip_audit_results = audit.stdout.strip().split("\n")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Try npm audit for Node if available
    npm_audit_results = []
    if os.path.exists(pkg_json):
        try:
            audit = subprocess.run(
                ["npm", "audit", "--json"],
                capture_output=True, text=True, timeout=60, cwd=path
            )
            if audit.stdout:
                try:
                    npm_data = json.loads(audit.stdout)
                    npm_audit_results = npm_data.get("vulnerabilities", {})
                except json.JSONDecodeError:
                    pass
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    total_deps = sum(len(v) for v in results.values())
    return {
        "dependencies": {k: v for k, v in results.items() if v},
        "total_dependencies": total_deps,
        "pip_audit": pip_audit_results[:20] if pip_audit_results else [],
        "npm_audit": npm_audit_results if isinstance(npm_audit_results, list) else list(npm_audit_results.keys())[:20],
        "recommendation": "Run 'pip-audit' or 'npm audit' for detailed CVE information"
    }


async def handle_owasp_scan(args: dict) -> dict:
    """Scan code for OWASP Top 10 vulnerability patterns."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []
    files_scanned = 0

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lower()

            if ext in SKIP_EXTENSIONS:
                continue
            if ext not in (".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java",
                           ".rb", ".php", ".c", ".cpp", ".h", ".cs", ".swift", ".kt"):
                continue

            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                files_scanned += 1
                rel_path = os.path.relpath(filepath, path)

                for owasp_id, config in OWASP_PATTERNS.items():
                    for pattern in config["patterns"]:
                        matches = re.finditer(pattern, content, re.MULTILINE | re.IGNORECASE)
                        for match in matches:
                            line_num = content[:match.start()].count("\n") + 1
                            line_content = content.split("\n")[line_num - 1].strip() if line_num <= len(content.split("\n")) else ""

                            # Skip comments
                            if line_content.startswith(("#", "//", "/*", "*", "<!--")):
                                continue

                            findings.append({
                                "owasp_id": owasp_id,
                                "severity": config["severity"],
                                "description": config["description"],
                                "file": rel_path,
                                "line": line_num,
                                "snippet": line_content[:120],
                                "pattern_matched": pattern[:60]
                            })
            except (IOError, OSError):
                pass

    # Deduplicate
    seen = set()
    unique = []
    for f in findings:
        key = (f["owasp_id"], f["file"], f["line"])
        if key not in seen:
            seen.add(key)
            unique.append(f)

    severity_counts = {}
    owasp_counts = {}
    for f in unique:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1
        owasp_counts[f["owasp_id"]] = owasp_counts.get(f["owasp_id"], 0) + 1

    return {
        "findings": unique,
        "total_findings": len(unique),
        "severity_counts": severity_counts,
        "owasp_category_counts": owasp_counts,
        "files_scanned": files_scanned,
        "scan_time": _now()
    }


async def handle_code_audit(args: dict) -> dict:
    """Deep code audit for security anti-patterns."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []
    files_scanned = 0

    ANTI_PATTERNS = {
        "Hardcoded IP": {
            "pattern": r"(?:https?://)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?",
            "severity": "low",
            "description": "Hardcoded IP address"
        },
        "TODO Security": {
            "pattern": r"(?:TODO|FIXME|HACK|XXX).*?(?:security|vuln|exploit|bypass|hack)",
            "severity": "medium",
            "description": "Security-related TODO comment"
        },
        "Disabled Security": {
            "pattern": r"(?:verify_ssl|verify_signature|check_cert|validate_cert)\s*=\s*False",
            "severity": "high",
            "description": "Security validation explicitly disabled"
        },
        "Weak Random": {
            "pattern": r"(?:random\.randint|random\.choice|random\.shuffle|Math\.random)",
            "severity": "medium",
            "description": "Insecure random number generation for security context"
        },
        "SQL String Concatenation": {
            "pattern": r"(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*(?:\+|%|\.format|f['\"])",
            "severity": "critical",
            "description": "SQL query built with string concatenation"
        },
        "Shell Injection": {
            "pattern": r"(?:os\.system|subprocess\.call|subprocess\.Popen|exec|eval)\s*\(.*(?:request\.|params|args|input)",
            "severity": "critical",
            "description": "Potential command injection from user input"
        },
        "Path Traversal": {
            "pattern": r"(?:open|read|write)\s*\(.*(?:request\.|params|args|input)",
            "severity": "high",
            "description": "Potential path traversal from user input"
        },
        "Weak Hash": {
            "pattern": r"(?:hashlib\.md5|hashlib\.sha1|md5|sha1)\s*\(",
            "severity": "medium",
            "description": "Weak hashing algorithm"
        },
        "Debug Endpoint": {
            "pattern": r"(?:@app\.route|@api\.route|router\.(?:get|post)).*?(?:debug|admin|internal)",
            "severity": "medium",
            "description": "Potentially exposed debug/admin endpoint"
        },
        "Missing Input Validation": {
            "pattern": r"(?:request\.(?:args|form|json|data)|req\.(?:body|params|query))\s*(?!.*(?:validate|sanitize|clean))",
            "severity": "medium",
            "description": "User input used without visible validation"
        },
    }

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lower()

            if ext not in (".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java", ".rb", ".php"):
                continue

            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                files_scanned += 1
                rel_path = os.path.relpath(filepath, path)

                for anti_name, config in ANTI_PATTERNS.items():
                    matches = re.finditer(config["pattern"], content, re.MULTILINE | re.IGNORECASE)
                    for match in matches:
                        line_num = content[:match.start()].count("\n") + 1
                        line_content = content.split("\n")[line_num - 1].strip() if line_num <= len(content.split("\n")) else ""

                        findings.append({
                            "type": anti_name,
                            "severity": config["severity"],
                            "description": config["description"],
                            "file": rel_path,
                            "line": line_num,
                            "snippet": line_content[:120]
                        })
            except (IOError, OSError):
                pass

    # Deduplicate
    seen = set()
    unique = []
    for f in findings:
        key = (f["type"], f["file"], f["line"])
        if key not in seen:
            seen.add(key)
            unique.append(f)

    severity_counts = {}
    for f in unique:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1

    return {
        "findings": unique,
        "total_findings": len(unique),
        "severity_counts": severity_counts,
        "files_scanned": files_scanned,
        "scan_time": _now()
    }


async def handle_headers_check(args: dict) -> dict:
    """Check HTTP security headers for a URL."""
    url = args.get("url", "")
    if not url:
        return {"error": "url required"}

    try:
        import httpx
    except ImportError:
        return {"error": "httpx not installed. Run: pip install httpx"}

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url)
    except Exception as e:
        return {"error": f"request failed: {e}"}

    headers = dict(response.headers)

    SECURITY_HEADERS = {
        "Strict-Transport-Security": {
            "description": "HSTS - Forces HTTPS",
            "recommended": "max-age=31536000; includeSubDomains",
            "severity": "high"
        },
        "Content-Security-Policy": {
            "description": "CSP - Prevents XSS and injection",
            "recommended": "default-src 'self'",
            "severity": "high"
        },
        "X-Content-Type-Options": {
            "description": "Prevents MIME sniffing",
            "recommended": "nosniff",
            "severity": "medium"
        },
        "X-Frame-Options": {
            "description": "Prevents clickjacking",
            "recommended": "DENY or SAMEORIGIN",
            "severity": "medium"
        },
        "X-XSS-Protection": {
            "description": "Legacy XSS filter",
            "recommended": "1; mode=block",
            "severity": "low"
        },
        "Referrer-Policy": {
            "description": "Controls referrer information",
            "recommended": "strict-origin-when-cross-origin",
            "severity": "medium"
        },
        "Permissions-Policy": {
            "description": "Controls browser features",
            "recommended": "camera=(), microphone=(), geolocation=()",
            "severity": "low"
        },
        "X-Permitted-Cross-Domain-Policies": {
            "description": "Controls cross-domain policies",
            "recommended": "none",
            "severity": "low"
        },
    }

    results = []
    score = 0
    max_score = 0

    for header, config in SECURITY_HEADERS.items():
        max_score += {"critical": 3, "high": 3, "medium": 2, "low": 1}[config["severity"]]
        present = header.lower() in {h.lower() for h in headers}
        if present:
            actual = headers.get(header) or headers.get(header.lower())
            score += {"critical": 3, "high": 3, "medium": 2, "low": 1}[config["severity"]]
            status = "present"
        else:
            actual = None
            status = "missing"

        results.append({
            "header": header,
            "status": status,
            "actual_value": actual,
            "recommended": config["recommended"],
            "description": config["description"],
            "severity": config["severity"]
        })

    # Check for information disclosure
    info_headers = ["Server", "X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version"]
    info_disclosure = []
    for h in info_headers:
        if h in headers:
            info_disclosure.append({"header": h, "value": headers[h]})

    grade = "A+" if score == max_score else \
            "A" if score >= max_score * 0.8 else \
            "B" if score >= max_score * 0.6 else \
            "C" if score >= max_score * 0.4 else \
            "F"

    return {
        "url": url,
        "status_code": response.status_code,
        "grade": grade,
        "score": f"{score}/{max_score}",
        "headers": results,
        "information_disclosure": info_disclosure,
        "recommendations": [f"Add {r['header']}: {r['recommended']}" for r in results if r["status"] == "missing"]
    }


async def handle_cve_lookup(args: dict) -> dict:
    """Look up CVE information for a package."""
    package = args.get("package", "")
    version = args.get("version", "")
    ecosystem = args.get("ecosystem", "pypi")  # pypi, npm, cargo, go, maven

    if not package:
        return {"error": "package name required"}

    # Use OSV (Open Source Vulnerabilities) API
    try:
        import httpx
    except ImportError:
        return {"error": "httpx not installed"}

    osv_url = "https://api.osv.dev/v1/query"
    payload = {
        "version": version or "0",
        "package": {
            "name": package,
            "ecosystem": ecosystem.capitalize() if ecosystem != "pypi" else "PyPI"
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(osv_url, json=payload)
            data = resp.json()
    except Exception as e:
        return {"error": f"OSV API request failed: {e}"}

    vulnerabilities = []
    for vuln in data.get("vulns", []):
        severity = "unknown"
        if "severity" in vuln:
            for s in vuln.get("severity", []):
                if s.get("type") == "CVSS_V3":
                    score = s.get("score", "")
                    try:
                        cvss = float(score.split("/")[0]) if score else 0
                        severity = "critical" if cvss >= 9 else "high" if cvss >= 7 else "medium" if cvss >= 4 else "low"
                    except:
                        pass

        affected_versions = []
        for aff in vuln.get("affected", []):
            for r in aff.get("ranges", []):
                for event in r.get("events", []):
                    if "introduced" in event:
                        affected_versions.append(f">={event['introduced']}")
                    if "fixed" in event:
                        affected_versions.append(f"<{event['fixed']}")

        vulnerabilities.append({
            "id": vuln.get("id", ""),
            "summary": vuln.get("summary", ""),
            "details": vuln.get("details", "")[:500],
            "severity": severity,
            "affected_versions": affected_versions[:5],
            "published": vuln.get("published", ""),
            "references": [r["url"] for r in vuln.get("references", [])[:3]]
        })

    return {
        "package": package,
        "version": version or "any",
        "ecosystem": ecosystem,
        "total_vulnerabilities": len(vulnerabilities),
        "vulnerabilities": vulnerabilities[:20]
    }


async def handle_cors_audit(args: dict) -> dict:
    """Audit CORS configuration for a URL."""
    url = args.get("url", "")
    if not url:
        return {"error": "url required"}

    try:
        import httpx
    except ImportError:
        return {"error": "httpx not installed"}

    findings = []
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # Test with various Origin headers
    test_origins = [
        "https://evil.com",
        "null",
        f"{parsed.scheme}://evil.{parsed.netloc}",
        f"https://{parsed.netloc}.evil.com",
        origin,  # Legitimate
    ]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for test_origin in test_origins:
                try:
                    resp = await client.get(url, headers={"Origin": test_origin})
                    acao = resp.headers.get("Access-Control-Allow-Origin", "")
                    acac = resp.headers.get("Access-Control-Allow-Credentials", "")

                    if acao == "*":
                        findings.append({
                            "issue": "Wildcard CORS origin",
                            "severity": "high",
                            "detail": "Access-Control-Allow-Origin: * allows any origin",
                            "test_origin": test_origin
                        })
                    elif acao == "null" and test_origin == "null":
                        findings.append({
                            "issue": "Null origin allowed",
                            "severity": "high",
                            "detail": "null origin is accepted — can be exploited via sandboxed iframes",
                            "test_origin": test_origin
                        })
                    elif test_origin != origin and test_origin in acao:
                        findings.append({
                            "issue": "Reflected origin",
                            "severity": "critical",
                            "detail": f"Origin {test_origin} is reflected in ACAO header",
                            "test_origin": test_origin
                        })

                    if acac.lower() == "true" and (acao == "*" or test_origin != origin):
                        findings.append({
                            "issue": "Credentials with permissive CORS",
                            "severity": "critical",
                            "detail": "Allow-Credentials: true with permissive origin allows credential theft",
                            "test_origin": test_origin
                        })
                except Exception:
                    pass
    except Exception as e:
        return {"error": f"request failed: {e}"}

    return {
        "url": url,
        "findings": findings,
        "risk": "critical" if any(f["severity"] == "critical" for f in findings) else
                "high" if any(f["severity"] == "high" for f in findings) else
                "low" if findings else "none"
    }


async def handle_auth_audit(args: dict) -> dict:
    """Audit authentication/authorization patterns in code."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []
    files_scanned = 0

    AUTH_PATTERNS = {
        "Missing Auth Decorator": {
            "pattern": r"@(?:app\.route|router\.(?:get|post|put|delete)|api\.route)\s*\(\s*['\"][^'\"]+['\"]\s*\)\s*\n(?!\s*@)(?!\s*def\s+_)\s*(?:async\s+)?def\s+(\w+)",
            "severity": "high",
            "description": "Route without visible auth decorator"
        },
        "Plaintext Password": {
            "pattern": r"(?:password|passwd|pwd)\s*==\s*(?:password|passwd|pwd)",
            "severity": "critical",
            "description": "Plaintext password comparison"
        },
        "Weak Token Generation": {
            "pattern": r"(?:token|secret|key)\s*=\s*(?:str\(random|uuid\.uuid1|time\.time|os\.urandom\([1-9]\))",
            "severity": "high",
            "description": "Weak token/secret generation"
        },
        "No Rate Limit": {
            "pattern": r"@(?:app\.route|router\.(?:post|put|delete)).*\n(?!\s*@limiter)(?!\s*@rate_limit)(?!\s*def\s+_)\s*(?:async\s+)?def\s+(?:login|auth|signup|register|reset)",
            "severity": "medium",
            "description": "Auth endpoint without rate limiting"
        },
        "Session in URL": {
            "pattern": r"(?:session_id|token|sid)\s*=\s*(?:request\.(?:args|query)|req\.query|\$_GET|\$_REQUEST)",
            "severity": "high",
            "description": "Session token passed via URL parameter"
        },
        "Insecure Cookie": {
            "pattern": r"(?:set_cookie|response\.set_cookie).*?(?:httponly\s*=\s*False|secure\s*=\s*False|httponly\s*=\s*False)",
            "severity": "medium",
            "description": "Cookie without secure flags"
        },
        "JWT No Expiry": {
            "pattern": r"jwt\.encode\s*\([^,]+,\s*[^,]+\s*\)(?!.*exp)",
            "severity": "high",
            "description": "JWT token without expiration"
        },
        "Open Redirect": {
            "pattern": r"(?:redirect|responses\.RedirectResponse)\s*\(.*(?:request\.|req\.)(?:args|query|params)",
            "severity": "medium",
            "description": "Open redirect from user input"
        },
    }

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lower()

            if ext not in (".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java", ".rb", ".php"):
                continue

            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                files_scanned += 1
                rel_path = os.path.relpath(filepath, path)

                for auth_name, config in AUTH_PATTERNS.items():
                    matches = re.finditer(config["pattern"], content, re.MULTILINE | re.IGNORECASE)
                    for match in matches:
                        line_num = content[:match.start()].count("\n") + 1
                        line_content = content.split("\n")[line_num - 1].strip() if line_num <= len(content.split("\n")) else ""

                        findings.append({
                            "type": auth_name,
                            "severity": config["severity"],
                            "description": config["description"],
                            "file": rel_path,
                            "line": line_num,
                            "snippet": line_content[:120]
                        })
            except (IOError, OSError):
                pass

    seen = set()
    unique = []
    for f in findings:
        key = (f["type"], f["file"], f["line"])
        if key not in seen:
            seen.add(key)
            unique.append(f)

    severity_counts = {}
    for f in unique:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1

    return {
        "findings": unique,
        "total_findings": len(unique),
        "severity_counts": severity_counts,
        "files_scanned": files_scanned,
        "scan_time": _now()
    }


async def handle_api_audit(args: dict) -> dict:
    """Audit API endpoint security patterns in code."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []
    endpoints = []
    files_scanned = 0

    # Framework-specific endpoint patterns
    FRAMEWORK_PATTERNS = {
        "flask": r"@(?:app|blueprint)\.route\s*\(\s*['\"]([^'\"]+)['\"](?:,\s*methods\s*=\s*\[([^\]]+)\])?",
        "fastapi": r"@(?:app|router)\.(?:get|post|put|delete|patch|options|head)\s*\(\s*['\"]([^'\"]+)['\"]",
        "django": r"(?:path|re_path)\s*\(\s*['\"]([^'\"]+)['\"]",
        "express": r"(?:app|router)\.(?:get|post|put|delete|patch|use)\s*\(\s*['\"]([^'\"]+)['\"]",
        "nestjs": r"@(?:Get|Post|Put|Delete|Patch)\s*\(\s*['\"]?([^'\")\s]+)?",
        "gin": r"(?:r|router)\.(?:GET|POST|PUT|DELETE|PATCH)\s*\(\s*['\"]([^'\"]+)['\"]",
    }

    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in files:
            filepath = os.path.join(root, filename)
            ext = os.path.splitext(filename)[1].lower()

            if ext not in (".py", ".js", ".ts", ".go", ".java", ".rb"):
                continue

            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                files_scanned += 1
                rel_path = os.path.relpath(filepath, path)

                for framework, pattern in FRAMEWORK_PATTERNS.items():
                    matches = re.finditer(pattern, content, re.MULTILINE)
                    for match in matches:
                        route = match.group(1) or "/"
                        methods = match.group(2) if match.lastindex and match.lastindex >= 2 and match.group(2) else "GET"
                        line_num = content[:match.start()].count("\n") + 1

                        endpoints.append({
                            "route": route,
                            "methods": methods,
                            "framework": framework,
                            "file": rel_path,
                            "line": line_num
                        })
            except (IOError, OSError):
                pass

    # Analyze endpoints for security issues
    for ep in endpoints:
        issues = []

        # Check for parameter in route (potential IDOR)
        if re.search(r"\{[^}]+\}|<[^>]+>|:id|:\w+_id", ep["route"]):
            issues.append({"type": "parameterized_route", "severity": "info",
                          "detail": "Parameterized route — ensure authorization checks"})

        # Check for sensitive routes
        sensitive = ["admin", "user", "account", "password", "token", "secret", "key", "auth", "login"]
        if any(s in ep["route"].lower() for s in sensitive):
            issues.append({"type": "sensitive_route", "severity": "medium",
                          "detail": f"Sensitive route '{ep['route']}' — verify auth and rate limiting"})

        # Check for write operations
        if any(m in ep["methods"].upper() for m in ["POST", "PUT", "DELETE", "PATCH"]):
            issues.append({"type": "write_operation", "severity": "low",
                          "detail": "Write operation — ensure CSRF protection and input validation"})

        if issues:
            findings.append({
                "route": ep["route"],
                "methods": ep["methods"],
                "framework": ep["framework"],
                "file": ep["file"],
                "line": ep["line"],
                "issues": issues
            })

    return {
        "total_endpoints": len(endpoints),
        "endpoints_with_issues": len(findings),
        "findings": findings,
        "all_endpoints": endpoints[:50],
        "files_scanned": files_scanned
    }


async def handle_security_report(args: dict) -> dict:
    """Comprehensive security report combining all scans."""
    path = args.get("path", ".")
    url = args.get("url", "")

    # Run all scans
    secret_result = await handle_secret_scan({"path": path})
    owasp_result = await handle_owasp_scan({"path": path})
    code_result = await handle_code_audit({"path": path})
    dep_result = await handle_dependency_scan({"path": path})
    auth_result = await handle_auth_audit({"path": path})
    api_result = await handle_api_audit({"path": path})

    header_result = {}
    cors_result = {}
    if url:
        header_result = await handle_headers_check({"url": url})
        cors_result = await handle_cors_audit({"url": url})

    # Aggregate severity counts
    total_critical = 0
    total_high = 0
    total_medium = 0
    total_low = 0

    for result in [secret_result, owasp_result, code_result, auth_result]:
        if "severity_counts" in result:
            total_critical += result["severity_counts"].get("critical", 0)
            total_high += result["severity_counts"].get("high", 0)
            total_medium += result["severity_counts"].get("medium", 0)
            total_low += result["severity_counts"].get("low", 0)

    total_findings = total_critical + total_high + total_medium + total_low

    # Calculate risk score (0-100, lower is better)
    risk_score = min(100, total_critical * 10 + total_high * 5 + total_medium * 2 + total_low * 1)

    grade = "A" if risk_score == 0 else \
            "B" if risk_score <= 10 else \
            "C" if risk_score <= 25 else \
            "D" if risk_score <= 50 else \
            "F"

    return {
        "grade": grade,
        "risk_score": risk_score,
        "summary": {
            "critical": total_critical,
            "high": total_high,
            "medium": total_medium,
            "low": total_low,
            "total": total_findings
        },
        "scans": {
            "secrets": {"findings": secret_result.get("total_findings", 0)},
            "owasp": {"findings": owasp_result.get("total_findings", 0)},
            "code_audit": {"findings": code_result.get("total_findings", 0)},
            "dependencies": {"total": dep_result.get("total_dependencies", 0)},
            "auth": {"findings": auth_result.get("total_findings", 0)},
            "api": {"endpoints": api_result.get("total_endpoints", 0), "issues": api_result.get("endpoints_with_issues", 0)},
            "headers": {"grade": header_result.get("grade", "N/A")} if header_result else None,
            "cors": {"risk": cors_result.get("risk", "N/A")} if cors_result else None,
        },
        "top_priorities": _get_top_priorities(secret_result, owasp_result, code_result, auth_result),
        "scan_time": _now()
    }


def _get_top_priorities(*results):
    """Extract top priority findings across all scans."""
    priorities = []
    for result in results:
        if "findings" in result:
            for f in result["findings"]:
                if f.get("severity") in ("critical", "high"):
                    priorities.append({
                        "severity": f["severity"],
                        "type": f.get("type", f.get("owasp_id", "unknown")),
                        "file": f.get("file", ""),
                        "line": f.get("line", 0),
                        "description": f.get("description", f.get("snippet", ""))[:100]
                    })
    priorities.sort(key=lambda x: 0 if x["severity"] == "critical" else 1)
    return priorities[:15]


# ─── Server Setup ─────────────────────────────────────────────────────────────

server = Server("owl-security")

ALL_TOOLS = [
    ("security_secret_scan", "Scan codebase for hardcoded secrets, API keys, tokens", handle_secret_scan),
    ("security_dependency_scan", "Check dependencies for known vulnerabilities", handle_dependency_scan),
    ("security_owasp_scan", "Scan code for OWASP Top 10 vulnerability patterns", handle_owasp_scan),
    ("security_code_audit", "Deep code audit for security anti-patterns", handle_code_audit),
    ("security_api_audit", "Audit API endpoint security patterns", handle_api_audit),
    ("security_cve_lookup", "Look up CVE details for a package/version via OSV API", handle_cve_lookup),
    ("security_headers_check", "HTTP security headers analysis with grading", handle_headers_check),
    ("security_cors_audit", "CORS misconfiguration detection", handle_cors_audit),
    ("security_auth_audit", "Authentication/authorization flow audit", handle_auth_audit),
    ("security_report", "Comprehensive security report combining all scans", handle_report),
]

@server.list_tools()
async def list_tools() -> List[Tool]:
    return [Tool(name=n, description=d, inputSchema={"type": "object", "properties": {}, "additionalProperties": True})
            for n, d, _ in ALL_TOOLS]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    handler_map = {n: h for n, _, h in ALL_TOOLS}
    handler = handler_map.get(name)
    if not handler:
        return [TextContent(type="text", text=json.dumps({"error": f"unknown tool: {name}"}))]
    try:
        result = await handler(arguments)
        return [TextContent(type="text", text=json.dumps(result, indent=2, default=str))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e), "traceback": traceback.format_exc()}))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
