"""
OWL Workflow MCP Server — CI/CD Pipeline as Code
=================================================
Generate, validate, and manage CI/CD pipelines for any platform.
Not just templates — understands your project and generates
optimal pipelines.

Tools (10):
  workflow_generate_github_actions — Generate GitHub Actions workflow
  workflow_generate_gitlab_ci      — Generate GitLab CI configuration
  workflow_generate_jenkins         — Generate Jenkins pipeline
  workflow_generate_azure_devops    — Generate Azure DevOps pipeline
  workflow_generate_circleci        — Generate CircleCI configuration
  workflow_generate_docker_compose  — Generate docker-compose for CI
  workflow_validate                 — Validate existing CI/CD config
  workflow_security_scan            — Scan CI/CD config for security issues
  workflow_optimize                 — Optimize pipeline for speed/cost
  workflow_visualize                — Generate pipeline visualization

Dependencies: Python 3.11+
"""

import asyncio
import json
import os
import re
import sys
import traceback
from typing import Any, Dict, List, Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

import owl_shared_intelligence as shared

def _detect_project(path):
    """Detect project type for workflow generation."""
    result = {"language": "unknown", "framework": "unknown", "has_tests": False,
              "has_docker": False, "has_db": False, "test_cmd": "", "build_cmd": "",
              "start_cmd": "", "package_manager": "unknown"}

    files = set()
    for root, dirs, fs in os.walk(path):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv")]
        for f in fs:
            files.add(f)
        if len(files) > 300:
            break

    # Language
    if any(f.endswith(".py") for f in files):
        result["language"] = "python"
    elif any(f.endswith((".ts", ".tsx")) for f in files):
        result["language"] = "typescript"
    elif any(f.endswith((".js", ".jsx")) for f in files):
        result["language"] = "javascript"
    elif any(f.endswith(".go") for f in files):
        result["language"] = "go"
    elif any(f.endswith(".rs") for f in files):
        result["language"] = "rust"
    elif any(f.endswith(".java") for f in files):
        result["language"] = "java"

    # Package manager
    if "package.json" in files:
        result["package_manager"] = "npm"
    elif "pyproject.toml" in files or "setup.py" in files:
        result["package_manager"] = "pip"
    elif "Cargo.toml" in files:
        result["package_manager"] = "cargo"
    elif "go.mod" in files:
        result["package_manager"] = "go"

    # Framework
    if "package.json" in files:
        try:
            with open(os.path.join(path, "package.json")) as f:
                pkg = json.load(f)
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            if "next" in deps: result["framework"] = "nextjs"
            elif "react" in deps: result["framework"] = "react"
            elif "vue" in deps: result["framework"] = "vue"
            elif "express" in deps: result["framework"] = "express"
            elif "svelte" in deps: result["framework"] = "svelte"
        except:
            pass

    # Commands
    if result["language"] == "python":
        result["test_cmd"] = "pytest -v" if "pytest" in files else "python -m pytest"
        result["build_cmd"] = "pip install -r requirements.txt"
        result["start_cmd"] = "python -m uvicorn main:app --host 0.0.0.0 --port 8000"
    elif result["language"] in ("javascript", "typescript"):
        result["test_cmd"] = "npm test"
        result["build_cmd"] = "npm run build" if result["framework"] in ("react", "nextjs", "vue", "svelte") else "npm install"
        result["start_cmd"] = "npm start"

    result["has_tests"] = any("test" in f.lower() or "spec" in f.lower() for f in files)
    result["has_docker"] = "Dockerfile" in files
    result["has_db"] = any(db in " ".join(files).lower() for db in ["postgres", "mysql", "mongodb", "redis", "sqlite"])

    return result


# ─── Tool Handlers ────────────────────────────────────────────────────────────

async def handle_generate_github_actions(args: dict) -> dict:
    """Generate GitHub Actions workflow."""
    path = args.get("path", ".")
    project_name = args.get("project_name", os.path.basename(os.path.abspath(path)))
    triggers = args.get("triggers", ["push", "pull_request"])
    branches = args.get("branches", ["main"])
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    workflow = {
        "name": f"{project_name} CI",
        "on": {}
    }

    # Triggers
    if "push" in triggers:
        workflow["on"]["push"] = {"branches": branches}
    if "pull_request" in triggers:
        workflow["on"]["pull_request"] = {"branches": branches}
    if "schedule" in triggers:
        workflow["on"]["schedule"] = [{"cron": "0 0 * * 0"}]  # Weekly
    if "workflow_dispatch" in triggers:
        workflow["on"]["workflow_dispatch"] = None

    # Jobs
    jobs = {}

    # Lint job
    lint_job = {
        "runs-on": "ubuntu-latest",
        "steps": [
            {"uses": "actions/checkout@v4"},
        ]
    }

    if project["language"] == "python":
        lint_job["steps"].extend([
            {"uses": "actions/setup-python@v5", "with": {"python-version": "3.11"}},
            {"name": "Install dependencies", "run": "pip install -r requirements.txt"},
            {"name": "Lint", "run": "python -m py_compile ."},
        ])
    elif project["language"] in ("javascript", "typescript"):
        lint_job["steps"].extend([
            {"uses": "actions/setup-node@v4", "with": {"node-version": "20"}},
            {"name": "Install dependencies", "run": "npm ci"},
            {"name": "Lint", "run": "npm run lint"},
        ])

    jobs["lint"] = lint_job

    # Test job
    if project["has_tests"]:
        test_job = {
            "runs-on": "ubuntu-latest",
            "needs": "lint",
            "steps": [
                {"uses": "actions/checkout@v4"},
            ]
        }

        if project["language"] == "python":
            test_job["steps"].extend([
                {"uses": "actions/setup-python@v5", "with": {"python-version": "3.11"}},
                {"name": "Install dependencies", "run": "pip install -r requirements.txt"},
                {"name": "Run tests", "run": project["test_cmd"]},
            ])
        elif project["language"] in ("javascript", "typescript"):
            test_job["steps"].extend([
                {"uses": "actions/setup-node@v4", "with": {"node-version": "20"}},
                {"name": "Install dependencies", "run": "npm ci"},
                {"name": "Run tests", "run": project["test_cmd"]},
            ])

        # Add coverage
        if project["language"] == "python":
            test_job["steps"].append({
                "name": "Upload coverage",
                "uses": "codecov/codecov-action@v3",
                "if": "always()"
            })

        jobs["test"] = test_job

    # Build job (for Docker)
    if project["has_docker"]:
        build_job = {
            "runs-on": "ubuntu-latest",
            "needs": ["lint"] + (["test"] if project["has_tests"] else []),
            "steps": [
                {"uses": "actions/checkout@v4"},
                {"name": "Build Docker image",
                 "run": f"docker build -t {project_name.lower()}:latest ."},
            ]
        }

        # Optional: push to registry
        if args.get("push_to_registry"):
            registry = args.get("registry", "ghcr.io")
            build_job["steps"].extend([
                {"name": "Login to registry",
                 "uses": "docker/login-action@v3",
                 "with": {"registry": registry, "username": "${{ github.actor }}",
                          "password": "${{ secrets.GITHUB_TOKEN }}"}},
                {"name": "Push image",
                 "run": f"docker push {registry}/${{{{ github.repository }}}}:latest"},
            ])

        jobs["build"] = build_job

    # Deploy job (optional)
    if args.get("deploy"):
        deploy_config = args["deploy"]
        deploy_job = {
            "runs-on": "ubuntu-latest",
            "needs": list(jobs.keys()),
            "if": "github.ref == 'refs/heads/" + branches[0] + "'",
            "steps": []
        }

        platform = deploy_config.get("platform", "docker")
        if platform == "docker":
            deploy_job["steps"] = [
                {"name": "Deploy via SSH",
                 "uses": "appleboy/ssh-action@v1",
                 "with": {"host": deploy_config.get("host", "${{ secrets.HOST }}"),
                          "username": deploy_config.get("user", "deploy"),
                          "key": "${{ secrets.SSH_KEY }}",
                          "script": f"docker pull {project_name.lower()}:latest && docker-compose up -d"}}
            ]
        elif platform == "heroku":
            deploy_job["steps"] = [
                {"uses": "akhileshns/heroku-deploy@v3.13.15",
                 "with": {"heroku_api_key": "${{ secrets.HEROKU_API_KEY }}",
                          "heroku_app_name": deploy_config.get("app_name", project_name.lower())}}
            ]
        elif platform == "vercel":
            deploy_job["steps"] = [
                {"uses": "amondnet/vercel-action@v25",
                 "with": {"vercel-token": "${{ secrets.VERCEL_TOKEN }}",
                          "vercel-org-id": "${{ secrets.VERCEL_ORG_ID }}",
                          "vercel-project-id": "${{ secrets.VERCEL_PROJECT_ID }}"}}
            ]

        jobs["deploy"] = deploy_job

    workflow["jobs"] = jobs

    # Convert to YAML-like string
    yaml = _dict_to_yaml(workflow)

    return {
        "workflow": yaml,
        "filename": f".github/workflows/ci.yml",
        "jobs": list(jobs.keys()),
        "project_type": project,
        "instructions": f"Save to {project_name}/.github/workflows/ci.yml"
    }


def _dict_to_yaml(d, indent=0):
    """Simple dict-to-YAML converter."""
    lines = []
    prefix = "  " * indent
    for k, v in d.items():
        if v is None:
            lines.append(f"{prefix}{k}:")
        elif isinstance(v, dict):
            lines.append(f"{prefix}{k}:")
            lines.append(_dict_to_yaml(v, indent + 1))
        elif isinstance(v, list):
            lines.append(f"{prefix}{k}:")
            for item in v:
                if isinstance(item, dict):
                    first = True
                    for ik, iv in item.items():
                        if first:
                            lines.append(f"{prefix}  - {ik}: {_yaml_value(iv)}")
                            first = False
                        else:
                            lines.append(f"{prefix}    {ik}: {_yaml_value(iv)}")
                else:
                    lines.append(f"{prefix}  - {_yaml_value(item)}")
        else:
            lines.append(f"{prefix}{k}: {_yaml_value(v)}")
    return "\n".join(lines)


def _yaml_value(v):
    if isinstance(v, str):
        if any(c in v for c in [":", "#", "{", "}", "[", "]", "&", "*", "?", "|", ">", "<", "!", "%", "@", "`", "'", '"']):
            return f'"{v}"'
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


async def handle_generate_gitlab_ci(args: dict) -> dict:
    """Generate GitLab CI configuration."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    config = {
        "stages": ["lint", "test", "build"] + (["deploy"] if args.get("deploy") else []),
        "variables": {},
    }

    # Default image
    if project["language"] == "python":
        config["image"] = "python:3.11-slim"
        config["variables"]["PIP_CACHE_DIR"] = "$CI_PROJECT_DIR/.cache/pip"
        config["cache"] = {"paths": [".cache/pip", ".venv/"]}
    elif project["language"] in ("javascript", "typescript"):
        config["image"] = "node:20-slim"
        config["variables"]["NODE_ENV"] = "test"
        config["cache"] = {"paths": ["node_modules/"]}

    # Lint job
    if project["language"] == "python":
        config["lint"] = {
            "stage": "lint",
            "script": ["pip install -r requirements.txt", "python -m py_compile ."],
        }
    elif project["language"] in ("javascript", "typescript"):
        config["lint"] = {
            "stage": "lint",
            "script": ["npm ci", "npm run lint"],
        }

    # Test job
    if project["has_tests"]:
        if project["language"] == "python":
            config["test"] = {
                "stage": "test",
                "script": ["pip install -r requirements.txt", project["test_cmd"]],
                "coverage": "/TOTAL.+ ([0-9]+%)/",
                "artifacts": {"reports": {"coverage_report": {"coverage_format": "cobertura", "path": "coverage.xml"}}}
            }
        elif project["language"] in ("javascript", "typescript"):
            config["test"] = {
                "stage": "test",
                "script": ["npm ci", "npm test -- --coverage"],
                "coverage": "/All files[^|]*\|[^|]*\s+([\d\.]+)/",
            }

    # Build job
    if project["has_docker"]:
        config["build"] = {
            "stage": "build",
            "image": "docker:24",
            "services": ["docker:24-dind"],
            "script": [
                "docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY",
                f"docker build -t $CI_REGISTRY_IMAGE:latest .",
                f"docker push $CI_REGISTRY_IMAGE:latest"
            ],
            "only": ["main"]
        }

    yaml = _dict_to_yaml(config)
    return {
        "config": yaml,
        "filename": ".gitlab-ci.yml",
        "stages": config["stages"],
        "project_type": project
    }


async def handle_generate_jenkins(args: dict) -> dict:
    """Generate Jenkins pipeline (Jenkinsfile)."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    stages = []
    if project["language"] == "python":
        stages.append("stage('Install') { steps { sh 'pip install -r requirements.txt' } }")
        stages.append("stage('Lint') { steps { sh 'python -m py_compile .' } }")
    elif project["language"] in ("javascript", "typescript"):
        stages.append("stage('Install') { steps { sh 'npm ci' } }")
        stages.append("stage('Lint') { steps { sh 'npm run lint' } }")

    if project["has_tests"]:
        stages.append(f"stage('Test') {{ steps {{ sh '{project['test_cmd']}' }} }}")

    if project["has_docker"]:
        stages.append("stage('Build') { steps { sh 'docker build -t app .' } }")

    stages_str = "\n    ".join(stages)

    jenkinsfile = f"""pipeline {{
    agent any

    environment {{
        CI = 'true'
    }}

    stages {{
        {stages_str}
    }}

    post {{
        always {{
            cleanWs()
        }}
        success {{
            echo 'Pipeline succeeded!'
        }}
        failure {{
            echo 'Pipeline failed!'
        }}
    }}
}}"""

    return {
        "jenkinsfile": jenkinsfile,
        "filename": "Jenkinsfile",
        "stages": [s.split("'")[1] for s in stages],
        "project_type": project
    }


async def handle_generate_azure_devops(args: dict) -> dict:
    """Generate Azure DevOps pipeline."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    pool = "ubuntu-latest"
    steps = [{"checkout": "self"}]

    if project["language"] == "python":
        steps.extend([
            {"task": "UsePythonVersion@0", "inputs": {"versionSpec": "3.11"}},
            {"script": "pip install -r requirements.txt", "displayName": "Install dependencies"},
            {"script": "python -m py_compile .", "displayName": "Lint"},
        ])
    elif project["language"] in ("javascript", "typescript"):
        steps.extend([
            {"task": "NodeTool@0", "inputs": {"versionSpec": "20.x"}},
            {"script": "npm ci", "displayName": "Install dependencies"},
            {"script": "npm run lint", "displayName": "Lint"},
        ])

    if project["has_tests"]:
        steps.append({"script": project["test_cmd"], "displayName": "Run tests"})

    if project["has_docker"]:
        steps.append({"task": "Docker@2", "inputs": {"command": "buildAndPush",
                     "repository": "$(Build.Repository.Name)",
                     "Dockerfile": "Dockerfile",
                     "tags": "$(Build.BuildId)"}})

    yaml = _dict_to_yaml({
        "trigger": ["main"],
        "pool": {"vmImage": pool},
        "steps": steps
    })

    return {
        "pipeline": yaml,
        "filename": "azure-pipelines.yml",
        "project_type": project
    }


async def handle_generate_circleci(args: dict) -> dict:
    """Generate CircleCI configuration."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    if project["language"] == "python":
        executor = "python/default"
        install_step = {"run": {"name": "Install dependencies", "command": "pip install -r requirements.txt"}}
        test_step = {"run": {"name": "Run tests", "command": project["test_cmd"]}}
    elif project["language"] in ("javascript", "typescript"):
        executor = "node/default"
        install_step = {"run": {"name": "Install dependencies", "command": "npm ci"}}
        test_step = {"run": {"name": "Run tests", "command": project["test_cmd"]}}
    else:
        executor = "ubuntu/default"
        install_step = {"run": {"name": "Setup", "command": "echo 'Setup complete'"}}
        test_step = None

    orbs = {}
    if project["language"] == "python":
        orbs["python"] = "circleci/python@2.1.1"
    elif project["language"] in ("javascript", "typescript"):
        orbs["node"] = "circleci/node@5.1.0"

    jobs = {
        "build-and-test": {
            "docker": [{"image": f"cimg/{'python:3.11' if project['language'] == 'python' else 'node:20.0'}"}],
            "steps": ["checkout", install_step] + ([test_step] if test_step else [])
        }
    }

    workflow = {"version": "2.1"}
    if orbs:
        workflow["orbs"] = orbs
    workflow["jobs"] = jobs
    workflow["workflows"] = {"ci": {"jobs": ["build-and-test"]}}

    yaml = _dict_to_yaml(workflow)
    return {"config": yaml, "filename": ".circleci/config.yml", "project_type": project}


async def handle_generate_docker_compose(args: dict) -> dict:
    """Generate docker-compose for CI environment."""
    path = args.get("path", ".")
    project_name = args.get("project_name", os.path.basename(os.path.abspath(path)))
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    project = _detect_project(path)

    services = {
        "app": {
            "build": ".",
            "ports": ["8000:8000"],
            "environment": ["NODE_ENV=test"] if project["language"] in ("javascript", "typescript") else ["ENV=test"],
            "depends_on": [],
            "restart": "unless-stopped"
        }
    }

    if project["has_db"]:
        db_type = "postgres"  # Default
        services["db"] = {
            "image": "postgres:16-alpine",
            "environment": {
                "POSTGRES_DB": project_name.lower(),
                "POSTGRES_USER": "user",
                "POSTGRES_PASSWORD": "password"
            },
            "ports": ["5432:5432"],
            "volumes": ["db_data:/var/lib/postgresql/data"]
        }
        services["app"]["depends_on"].append("db")
        services["app"]["environment"].append(f"DATABASE_URL=postgresql://user:password@db:5432/{project_name.lower()}")

    # Redis cache
    if args.get("include_redis"):
        services["redis"] = {
            "image": "redis:7-alpine",
            "ports": ["6379:6379"]
        }
        services["app"]["depends_on"].append("redis")

    compose = {"version": "3.8", "services": services}
    if project["has_db"]:
        compose["volumes"] = {"db_data": {}}

    yaml = _dict_to_yaml(compose)
    return {
        "compose": yaml,
        "filename": "docker-compose.yml",
        "services": list(services.keys()),
        "project_type": project
    }


async def handle_validate(args: dict) -> dict:
    """Validate existing CI/CD configuration."""
    path = args.get("path", ".")
    config_type = args.get("type", "auto")  # auto, github, gitlab, jenkins, azure, circleci
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    # Auto-detect config type
    config_files = {
        "github": ".github/workflows/ci.yml",
        "gitlab": ".gitlab-ci.yml",
        "jenkins": "Jenkinsfile",
        "azure": "azure-pipelines.yml",
        "circleci": ".circleci/config.yml"
    }

    if config_type == "auto":
        for ctype, cfile in config_files.items():
            if os.path.exists(os.path.join(path, cfile)):
                config_type = ctype
                break

    if config_type == "auto":
        return {"error": "no CI/CD config found", "checked": list(config_files.values())}

    config_path = os.path.join(path, config_files[config_type])
    if not os.path.exists(config_path):
        return {"error": f"config file not found: {config_files[config_type]}"}

    with open(config_path) as f:
        content = f.read()

    issues = []
    warnings_list = []

    # Common checks
    if "latest" in content and "image:" in content:
        warnings_list.append("Using 'latest' tag for Docker images — pin to specific version for reproducibility")

    if "secrets." not in content and ("password" in content.lower() or "token" in content.lower() or "key" in content.lower()):
        issues.append("Hardcoded secrets detected — use secret management")

    if config_type == "github":
        # GitHub Actions specific
        if "actions/checkout" not in content:
            issues.append("Missing actions/checkout step")
        if "ubuntu-latest" not in content and "runs-on" in content:
            warnings_list.append("Consider using ubuntu-latest for consistency")
        if "cache" not in content.lower():
            warnings_list.append("No caching configured — add cache for dependencies to speed up builds")
        if "matrix" not in content and "strategy" not in content:
            warnings_list.append("No build matrix — consider testing multiple versions")

    elif config_type == "gitlab":
        if "cache:" not in content:
            warnings_list.append("No cache configured")
        if "artifacts:" not in content:
            warnings_list.append("No artifacts configured")

    # Security checks
    if "curl" in content.lower() and "|" in content:
        warnings_list.append("Piping curl to shell — consider downloading and verifying first")
    if "sudo" in content.lower():
        warnings_list.append("Using sudo in CI — avoid if possible")

    return {
        "config_type": config_type,
        "config_file": config_files[config_type],
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings_list,
        "recommendations": [
            "Add caching for dependencies",
            "Pin all action/image versions",
            "Add branch protection rules",
            "Configure notifications for failures"
        ]
    }


async def handle_workflow_security_scan(args: dict) -> dict:
    """Scan CI/CD config for security issues."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    findings = []

    # Check for common CI/CD security issues
    ci_files = []
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, path)
            if any(rel.startswith(p) for p in [".github/workflows/", ".circleci/", "ci/", ".gitlab-ci"]):
                ci_files.append((rel, fp))
            elif f in ("Jenkinsfile", "azure-pipelines.yml", ".gitlab-ci.yml"):
                ci_files.append((rel, fp))

    for rel_path, full_path in ci_files:
        try:
            with open(full_path) as f:
                content = f.read()

            # Check for hardcoded secrets
            for pattern_name, pattern in [
                ("Hardcoded password", r"password\s*[:=]\s*['\"][^'\"]+['\"]"),
                ("Hardcoded API key", r"api[_-]?key\s*[:=]\s*['\"][^'\"]+['\"]"),
                ("Hardcoded token", r"token\s*[:=]\s*['\"][^'\"]+['\"]"),
            ]:
                matches = re.findall(pattern, content, re.IGNORECASE)
                if matches:
                    findings.append({
                        "file": rel_path, "issue": pattern_name,
                        "severity": "critical",
                        "recommendation": "Use secret management (GitHub Secrets, GitLab CI Variables)"
                    })

            # Check for script injection
            if re.search(r"run:\s*\$\{\{.*github\.event", content):
                findings.append({
                    "file": rel_path, "issue": "Potential script injection from event payload",
                    "severity": "high",
                    "recommendation": "Sanitize event data before using in scripts"
                })

            # Check for unpinned actions
            if "uses:" in content:
                unpinned = re.findall(r"uses:\s*([^@]+)@master", content)
                for u in unpinned:
                    findings.append({
                        "file": rel_path, "issue": f"Unpinned action: {u.strip()}@master",
                        "severity": "medium",
                        "recommendation": "Pin to specific commit SHA"
                    })

            # Check for missing permissions
            if "permissions:" not in content and ".github/workflows" in rel_path:
                findings.append({
                    "file": rel_path, "issue": "No permissions block",
                    "severity": "medium",
                    "recommendation": "Add 'permissions: contents: read' for least privilege"
                })
        except:
            pass

    return {
        "findings": findings,
        "files_scanned": len(ci_files),
        "risk": "high" if any(f["severity"] == "critical" for f in findings) else
                "medium" if findings else "low"
    }


async def handle_optimize(args: dict) -> dict:
    """Optimize pipeline for speed and cost."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    optimizations = []

    # Check for existing configs
    for config_file in (".github/workflows/ci.yml", ".gitlab-ci.yml", "Jenkinsfile"):
        config_path = os.path.join(path, config_file)
        if os.path.exists(config_path):
            with open(config_path) as f:
                content = f.read()

            if "cache" not in content.lower():
                optimizations.append({
                    "type": "speed",
                    "impact": "high",
                    "description": "Add dependency caching — can reduce build time by 40-60%",
                    "example": "actions/cache@v4 with key: ${{ runner.os }}-pip-${{ hashFiles('requirements.txt') }}"
                })

            if "matrix" not in content.lower() and "parallel" not in content.lower():
                optimizations.append({
                    "type": "speed",
                    "impact": "medium",
                    "description": "Run lint and test in parallel jobs"
                })

            if "npm install" in content and "npm ci" not in content:
                optimizations.append({
                    "type": "reliability",
                    "impact": "medium",
                    "description": "Use 'npm ci' instead of 'npm install' for reproducible builds"
                })

            if "latest" in content:
                optimizations.append({
                    "type": "reliability",
                    "impact": "high",
                    "description": "Pin all versions to specific SHA/tags for reproducibility"
                })

    # General optimizations
    optimizations.extend([
        {"type": "cost", "impact": "medium", "description": "Use conditional jobs — skip deploy on PRs"},
        {"type": "speed", "impact": "medium", "description": "Use smaller base images (alpine, slim)"},
        {"type": "speed", "impact": "low", "description": "Combine related steps to reduce overhead"},
    ])

    return {
        "optimizations": optimizations,
        "estimated_improvement": f"{len(optimizations) * 15}% faster builds"
    }


async def handle_visualize(args: dict) -> dict:
    """Generate pipeline visualization."""
    path = args.get("path", ".")
    if not os.path.isdir(path):
        return {"error": f"not a directory: {path}"}

    # Find CI config
    config_found = None
    for config_file in (".github/workflows/ci.yml", ".gitlab-ci.yml", "Jenkinsfile"):
        if os.path.exists(os.path.join(path, config_file)):
            config_found = config_file
            break

    if not config_found:
        return {"error": "no CI config found to visualize"}

    with open(os.path.join(path, config_found)) as f:
        content = f.read()

    # Extract stages/jobs
    stages = []
    if config_found == "Jenkinsfile":
        for m in re.finditer(r"stage\('(\w+)'\)", content):
            stages.append(m.group(1))
    elif "stages:" in content:
        for m in re.finditer(r"-\s*(\w+)", content.split("stages:")[1].split("\n\n")[0]):
            stages.append(m.group(1))
    elif "jobs:" in content:
        for m in re.finditer(r"^\s{2}(\w+):\s*$", content, re.MULTILINE):
            stages.append(m.group(1))

    if not stages:
        stages = ["lint", "test", "build", "deploy"]

    # Generate Mermaid
    mermaid = ["graph LR"]
    for i, stage in enumerate(stages):
        safe = re.sub(r"[^a-zA-Z0-9]", "_", stage)
        mermaid.append(f"    {safe}[{stage}]")
        if i > 0:
            prev = re.sub(r"[^a-zA-Z0-9]", "_", stages[i-1])
            mermaid.append(f"    {prev} --> {safe}")

    return {
        "stages": stages,
        "mermaid": "\n".join(mermaid),
        "config_source": config_found
    }


# ─── Server Setup ─────────────────────────────────────────────────────────────

server = Server("owl-workflow")

ALL_TOOLS = [
    ("workflow_generate_github_actions", "Generate GitHub Actions workflow", handle_generate_github_actions),
    ("workflow_generate_gitlab_ci", "Generate GitLab CI configuration", handle_generate_gitlab_ci),
    ("workflow_generate_jenkins", "Generate Jenkins pipeline", handle_generate_jenkins),
    ("workflow_generate_azure_devops", "Generate Azure DevOps pipeline", handle_generate_azure_devops),
    ("workflow_generate_circleci", "Generate CircleCI configuration", handle_generate_circleci),
    ("workflow_generate_docker_compose", "Generate docker-compose for CI environment", handle_generate_docker_compose),
    ("workflow_validate", "Validate existing CI/CD configuration", handle_validate),
    ("workflow_security_scan", "Scan CI/CD config for security issues", handle_workflow_security_scan),
    ("workflow_optimize", "Optimize pipeline for speed and cost", handle_optimize),
    ("workflow_visualize", "Generate pipeline visualization", handle_visualize),
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
