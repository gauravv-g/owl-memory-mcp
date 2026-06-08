"""
OWL Git MCP Server — Git Intelligence Engine
==============================================
Smart git operations beyond basic commit/push.
Understands your repo, predicts conflicts, generates
conventional commits, analyzes branch health.

Tools (11):
  git_status        — Enhanced status with file categorization
  git_smart_commit  — AI-powered conventional commit messages
  git_branch_analyze — Branch health, divergence, stale detection
  git_conflict_predict — Predict merge conflicts before they happen
  git_history_inspect — Semantic commit history analysis
  git_blame_inspect — Enhanced blame with author stats
  git_diff_analyze  — Semantic diff (not just lines — what changed and why)
  git_pr_generate   — Auto-generate PR descriptions from diff
  git_release_notes — Generate release notes from commit range
  git_repo_map      — Generate repo architecture map
  git_contributor_stats — Contributor analytics

Dependencies: git (system), Python 3.11+
"""

import asyncio
import json
import os
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("ERROR: mcp package not found.", file=sys.stderr)
    sys.exit(1)

import owl_shared_intelligence as shared


def _run_git(repo_path: str, *args, timeout: int = 30) -> dict:
    """Run a git command and return structured result."""
    try:
        result = subprocess.run(
            ["git", "-C", repo_path] + list(args),
            capture_output=True, text=True, timeout=timeout
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "exit_code": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "timeout", "exit_code": -1}
    except FileNotFoundError:
        return {"success": False, "stdout": "", "stderr": "git not found", "exit_code": -1}


# ─── Tool Handlers ────────────────────────────────────────────────────────────

async def handle_status(args: dict) -> dict:
    """Enhanced git status with file categorization and branch info."""
    repo = args.get("repo", ".")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Basic status
    status = _run_git(repo, "status", "--porcelain", "-b")
    if not status["success"]:
        return {"error": status["stderr"]}

    lines = status["stdout"].split("\n") if status["stdout"] else []
    branch_line = lines[0] if lines and lines[0].startswith("## ") else "## main"
    branch_info = branch_line[3:]

    staged, unstaged, untracked = [], [], []
    for line in lines[1:]:
        if len(line) < 3:
            continue
        index_status = line[0]
        work_status = line[1]
        filename = line[3:]
        if index_status != "?" and index_status != " ":
            staged.append({"file": filename, "status": index_status})
        if work_status != "?" and work_status != " ":
            unstash_map = {"M": "modified", "D": "deleted", "A": "added", "R": "renamed", "C": "copied"}
            unstaged.append({"file": filename, "status": unstash_map.get(work_status, work_status)})
        if index_status == "?":
            untracked.append(filename)

    all_changed = [f["file"] for f in staged + unstaged] + untracked
    categories = shared.categorize_files(all_changed)

    # Ahead/behind
    ab = _run_git(repo, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")
    ahead, behind = 0, 0
    if ab["success"] and "\t" in ab["stdout"]:
        parts = ab["stdout"].split("\t")
        ahead, behind = int(parts[0]), int(parts[1])

    # Last commit
    last = _run_git(repo, "log", "-1", "--format=%H|%an|%ae|%ar|%s")
    last_commit = {}
    if last["success"] and "|" in last["stdout"]:
        parts = last["stdout"].split("|", 4)
        last_commit = {
            "hash": parts[0][:8], "author": parts[1], "email": parts[2],
            "relative_time": parts[3], "subject": parts[4] if len(parts) > 4 else ""
        }

    return {
        "branch": branch_info,
        "ahead": ahead, "behind": behind,
        "staged": staged, "unstaged": unstaged, "untracked": untracked,
        "categories": categories,
        "last_commit": last_commit,
        "clean": not staged and not unstaged and not untracked
    }


async def handle_smart_commit(args: dict) -> dict:
    """Generate a conventional commit message from staged changes."""
    repo = args.get("repo", ".")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Get staged diff
    diff = _run_git(repo, "diff", "--cached", "--stat")
    if not diff["success"] or not diff["stdout"]:
        return {"error": "no staged changes"}

    # Get detailed staged diff for analysis
    diff_detail = _run_git(repo, "diff", "--cached", "--no-color", timeout=15)
    diff_text = diff_detail["stdout"] if diff_detail["success"] else ""

    # Analyze changes
    files_changed = re.findall(r"^\+\+\+ b/(.+)$", diff_text, re.MULTILINE)
    categories = shared.categorize_files(files_changed)

    # Determine commit type
    commit_type = "chore"
    scope = ""
    description = ""

    if categories.get("test"):
        commit_type = "test"
    elif categories.get("docs"):
        commit_type = "docs"
    elif categories.get("ci"):
        commit_type = "ci"
    elif categories.get("build"):
        commit_type = "build"
    elif categories.get("style"):
        commit_type = "style"
    elif categories.get("source"):
        # Check if it's a feature or fix
        if re.search(r"(fix|bug|hotfix|patch|resolve|close)", diff_text, re.IGNORECASE):
            commit_type = "fix"
        elif re.search(r"(add|new|create|implement|introduce|support)", diff_text, re.IGNORECASE):
            commit_type = "feat"
        elif re.search(r"(refactor|restructure|reorganize|clean)", diff_text, re.IGNORECASE):
            commit_type = "refactor"
        elif re.search(r"(perf|optimiz|speed|fast|cache|lazy)", diff_text, re.IGNORECASE):
            commit_type = "perf"
        else:
            commit_type = "feat"

    # Determine scope from file paths
    if files_changed:
        dirs = set()
        for f in files_changed:
            parts = f.split("/")
            if len(parts) > 1:
                dirs.add(parts[0])
        if len(dirs) == 1:
            scope = list(dirs)[0]
        elif len(dirs) <= 3:
            scope = "/".join(sorted(dirs)[:2])

    # Generate description from diff analysis
    added_funcs = re.findall(r"^\+\s*(def|function|func|async def)\s+(\w+)", diff_text, re.MULTILINE)
    removed_funcs = re.findall(r"^-\s*(def|function|func|async def)\s+(\w+)", diff_text, re.MULTILINE)
    added_classes = re.findall(r"^\+\s*class\s+(\w+)", diff_text, re.MULTILINE)

    descriptions = []
    if added_classes:
        descriptions.append(f"add {', '.join(c for _, c in added_classes[:3])}")
    if added_funcs:
        new_fns = [name for _, name in added_funcs[:3]]
        descriptions.append(f"add {', '.join(new_fns)}")
    if removed_funcs:
        descriptions.append(f"remove {', '.join(name for _, name in removed_funcs[:2])}")

    if descriptions:
        description = descriptions[0]
    else:
        # Fallback: use file count
        n = len(files_changed)
        description = f"update {n} file{'s' if n > 1 else ''}"

    # Build conventional commit message
    msg = f"{commit_type}"
    if scope:
        msg += f"({scope})"
    msg += f": {description}"

    # Generate body from diff stats
    stats_lines = diff["stdout"].strip().split("\n")
    body_lines = []
    for line in stats_lines[:-1]:  # Skip summary line
        if "|" in line:
            file_part = line.split("|")[0].strip()
            change_part = line.split("|")[1].strip()
            body_lines.append(f"- {file_part}: {change_part}")

    full_msg = msg
    if body_lines:
        full_msg += "\n\n" + "\n".join(body_lines[:10])

    # Auto-commit if requested
    committed = False
    if args.get("commit", False):
        result = _run_git(repo, "commit", "-m", msg)
        committed = result["success"]
        if not committed:
            return {"error": result["stderr"], "suggested_message": msg}

    return {
        "suggested_message": msg,
        "full_message": full_msg,
        "type": commit_type,
        "scope": scope,
        "files_changed": len(files_changed),
        "committed": committed
    }


async def handle_branch_analyze(args: dict) -> dict:
    """Analyze branch health: divergence, staleness, merge readiness."""
    repo = args.get("repo", ".")
    branch = args.get("branch", "")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    if not branch:
        br = _run_git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        branch = br["stdout"] if br["success"] else "main"

    # Get branch list with last commit dates
    branches_raw = _run_git(repo, "for-each-ref", "--format=%(refname:short)|%(committerdate:iso)|%(upstream:short)", "refs/heads/")
    branches = []
    if branches_raw["success"]:
        for line in branches_raw["stdout"].split("\n"):
            if "|" not in line:
                continue
            parts = line.split("|", 2)
            branches.append({
                "name": parts[0],
                "last_commit": parts[1],
                "upstream": parts[2] if len(parts) > 2 else "",
                "is_current": parts[0] == branch
            })

    # Divergence from upstream
    upstream = ""
    for b in branches:
        if b["is_current"] and b["upstream"]:
            upstream = b["upstream"]
            break

    ahead, behind = 0, 0
    if upstream:
        ab = _run_git(repo, "rev-list", "--left-right", "--count", f"{upstream}...{branch}")
        if ab["success"] and "\t" in ab["stdout"]:
            parts = ab["stdout"].split("\t")
            ahead, behind = int(parts[0]), int(parts[1])

    # Staleness: days since last commit
    last_date = _run_git(repo, "log", "-1", "--format=%ci", branch)
    stale_days = 0
    if last_date["success"]:
        try:
            dt = datetime.fromisoformat(last_date["stdout"].replace("Z", "+00:00"))
            stale_days = (datetime.now(timezone.utc) - dt).days
        except:
            pass

    # Merge conflict prediction
    conflicts = []
    if upstream:
        merge_base = _run_git(repo, "merge-base", branch, upstream)
        if merge_base["success"]:
            mb = merge_base["stdout"].strip()
            # Files changed on both branches
            our_files = _run_git(repo, "diff", "--name-only", mb, branch)
            their_files = _run_git(repo, "diff", "--name-only", mb, upstream)
            if our_files["success"] and their_files["success"]:
                our_set = set(our_files["stdout"].split("\n")) if our_files["stdout"] else set()
                their_set = set(their_files["stdout"].split("\n")) if their_files["stdout"] else set()
                conflicts = sorted(our_set & their_set)

    # Commit count
    count = _run_git(repo, "rev-list", "--count", branch)
    commit_count = int(count["stdout"]) if count["success"] else 0

    health = "healthy"
    if stale_days > 30:
        health = "stale"
    elif conflicts:
        health = "conflict-risk"
    elif behind > 20:
        health = "behind-upstream"
    elif ahead > 50:
        health = "needs-merge"

    return {
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead, "behind": behind,
        "stale_days": stale_days,
        "commit_count": commit_count,
        "health": health,
        "potential_conflicts": conflicts[:20],
        "total_branches": len(branches),
        "recommendation": _branch_recommendation(health, ahead, behind, stale_days, conflicts)
    }


def _branch_recommendation(health, ahead, behind, stale_days, conflicts):
    if conflicts:
        return f"Resolve {len(conflicts)} potential merge conflicts before merging"
    if health == "stale":
        return f"Branch is {stale_days} days stale — consider rebasing or deleting"
    if behind > 20:
        return f"Branch is {behind} commits behind upstream — rebase recommended"
    if ahead > 50:
        return f"Branch is {ahead} commits ahead — consider merging or splitting into smaller PRs"
    return "Branch is healthy"


async def handle_conflict_predict(args: dict) -> dict:
    """Predict merge conflicts between two branches."""
    repo = args.get("repo", ".")
    source = args.get("source", "")
    target = args.get("target", "main")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    if not source:
        br = _run_git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        source = br["stdout"] if br["success"] else ""

    if not source:
        return {"error": "no source branch specified"}

    # Find merge base
    mb = _run_git(repo, "merge-base", source, target)
    if not mb["success"]:
        return {"error": f"no common ancestor between {source} and {target}"}

    merge_base = mb["stdout"].strip()

    # Get files changed on each side
    our_changes = _run_git(repo, "diff", "--name-only", merge_base, source)
    their_changes = _run_git(repo, "diff", "--name-only", merge_base, target)

    our_files = set(our_changes["stdout"].split("\n")) if our_changes["stdout"] else set()
    their_files = set(their_changes["stdout"].split("\n")) if their_changes["stdout"] else set()
    our_files.discard("")
    their_files.discard("")

    conflict_files = sorted(our_files & their_files)
    our_only = sorted(our_files - their_files)
    their_only = sorted(their_files - our_files)

    # Analyze severity
    severity = "none"
    if conflict_files:
        critical = [f for f in conflict_files if re.search(r"(config|schema|migration|package\.json|requirements)", f)]
        if critical:
            severity = "high"
        elif len(conflict_files) > 10:
            severity = "medium"
        else:
            severity = "low"

    # Try dry-run merge
    dry_run = _run_git(repo, "merge", "--no-commit", "--no-ff", source, timeout=10)
    can_merge_clean = dry_run["success"]
    # Abort the dry run merge
    _run_git(repo, "merge", "--abort")

    return {
        "source": source, "target": target,
        "can_merge_cleanly": can_merge_clean,
        "severity": severity,
        "conflict_files": conflict_files,
        "conflict_count": len(conflict_files),
        "source_only_files": our_only[:20],
        "target_only_files": their_only[:20],
        "recommendation": "Safe to merge" if can_merge_clean else f"Expected {len(conflict_files)} conflicts — resolve before merging"
    }


async def handle_history_inspect(args: dict) -> dict:
    """Semantic analysis of commit history."""
    repo = args.get("repo", ".")
    branch = args.get("branch", "HEAD")
    limit = args.get("limit", 50)
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Get commit log with stats
    log = _run_git(repo, "log", branch, f"--max-count={limit}",
                   "--format=%H|%an|%ae|%ar|%s|%b<END>",
                   "--shortstat")
    if not log["success"]:
        return {"error": log["stderr"]}

    commits = []
    current = {}
    for line in log["stdout"].split("\n"):
        if line == "<END>":
            if current:
                commits.append(current)
            current = {}
            continue
        if "|" in line and not current.get("hash"):
            parts = line.split("|", 5)
            if len(parts) >= 5:
                current = {
                    "hash": parts[0][:8], "author": parts[1], "email": parts[2],
                    "relative_time": parts[3], "subject": parts[4],
                    "body": parts[5] if len(parts) > 5 else ""
                }
        elif re.match(r"^\s*\d+ file", line):
            nums = re.findall(r"(\d+) insertion", line)
            dels = re.findall(r"(\d+) deletion", line)
            files = re.findall(r"(\d+) file", line)
            current["files_changed"] = int(files[0]) if files else 0
            current["insertions"] = int(nums[0]) if nums else 0
            current["deletions"] = int(dels[0]) if dels else 0

    if current.get("hash"):
        commits.append(current)

    # Analyze patterns
    authors = {}
    commit_types = {}
    hourly_dist = [0] * 24
    for c in commits:
        author = c.get("author", "unknown")
        authors[author] = authors.get(author, 0) + 1
        # Detect conventional commit type
        subject = c.get("subject", "")
        m = re.match(r"^(\w+)(?:\(.+?\))?!?:\s", subject)
        if m:
            t = m.group(1)
            commit_types[t] = commit_types.get(t, 0) + 1

    # Find largest commit
    largest = max(commits, key=lambda c: c.get("files_changed", 0)) if commits else {}

    return {
        "total_commits_analyzed": len(commits),
        "authors": dict(sorted(authors.items(), key=lambda x: -x[1])[:10]),
        "commit_types": commit_types,
        "largest_commit": {
            "hash": largest.get("hash", ""),
            "subject": largest.get("subject", ""),
            "files_changed": largest.get("files_changed", 0)
        } if largest else {},
        "recent_commits": commits[:10]
    }


async def handle_diff_analyze(args: dict) -> dict:
    """Semantic diff analysis — what changed and why."""
    repo = args.get("repo", ".")
    source = args.get("source", "HEAD~1")
    target = args.get("target", "HEAD")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    diff = _run_git(repo, "diff", source, target, "--no-color", timeout=15)
    if not diff["success"]:
        return {"error": diff["stderr"]}

    diff_text = diff["stdout"]

    # File-level analysis
    files = re.findall(r"^diff --git a/(.+?) b/", diff_text, re.MULTILINE)
    added_lines = len(re.findall(r"^\+[^+]", diff_text, re.MULTILINE))
    removed_lines = len(re.findall(r"^-[^-]", diff_text, re.MULTILINE))

    # Detect patterns
    patterns = {
        "new_functions": re.findall(r"^\+\s*(?:def|function|func|async def)\s+(\w+)", diff_text, re.MULTILINE),
        "new_classes": re.findall(r"^\+\s*class\s+(\w+)", diff_text, re.MULTILINE),
        "removed_functions": re.findall(r"^-\s*(?:def|function|func|async def)\s+(\w+)", diff_text, re.MULTILINE),
        "imports_added": re.findall(r"^\+\s*(?:import|from)\s+(\S+)", diff_text, re.MULTILINE),
        "imports_removed": re.findall(r"^-\s*(?:import|from)\s+(\S+)", diff_text, re.MULTILINE),
        "config_changes": re.findall(r"^[+-].*?(?:API_KEY|SECRET|PASSWORD|TOKEN|URL|HOST|PORT)", diff_text, re.MULTILINE | re.IGNORECASE),
        "todo_added": re.findall(r"^\+.*?(?:TODO|FIXME|HACK|XXX|BUG)", diff_text, re.MULTILINE),
    }

    # Categorize the change
    change_type = "refactor"
    if patterns["new_classes"] or (patterns["new_functions"] and not patterns["removed_functions"]):
        change_type = "feature"
    elif patterns["removed_functions"] and not patterns["new_functions"]:
        change_type = "cleanup"
    elif patterns["config_changes"]:
        change_type = "config"
    elif patterns["imports_added"] or patterns["imports_removed"]:
        change_type = "dependency"

    return {
        "files_changed": len(files),
        "files": files[:20],
        "added_lines": added_lines,
        "removed_lines": removed_lines,
        "net_change": added_lines - removed_lines,
        "change_type": change_type,
        "patterns": {k: v[:10] for k, v in patterns.items() if v},
        "summary": _diff_summary(change_type, patterns, added_lines, removed_lines, len(files))
    }


def _diff_summary(change_type, patterns, added, removed, files):
    parts = []
    if patterns["new_classes"]:
        parts.append(f"adds class {', '.join(patterns['new_classes'][:3])}")
    if patterns["new_functions"]:
        parts.append(f"adds {len(patterns['new_functions'])} function(s)")
    if patterns["removed_functions"]:
        parts.append(f"removes {len(patterns['removed_functions'])} function(s)")
    if patterns["imports_added"]:
        parts.append(f"adds {len(patterns['imports_added'])} import(s)")
    if patterns["config_changes"]:
        parts.append("modifies configuration values")
    if not parts:
        parts.append(f"modifies {files} file(s) (+{added}/-{removed} lines)")
    return f"{change_type}: {', '.join(parts)}"


async def handle_pr_generate(args: dict) -> dict:
    """Auto-generate PR description from branch changes."""
    repo = args.get("repo", ".")
    branch = args.get("branch", "")
    target = args.get("target", "main")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    if not branch:
        br = _run_git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        branch = br["stdout"] if br["success"] else ""

    # Get merge base and diff
    mb = _run_git(repo, "merge-base", branch, target)
    if not mb["success"]:
        return {"error": "no common ancestor"}

    merge_base = mb["stdout"].strip()

    # Changed files
    files = _run_git(repo, "diff", "--name-only", merge_base, branch)
    changed_files = [f for f in files["stdout"].split("\n") if f] if files["success"] else []

    # Diff stats
    stats = _run_git(repo, "diff", "--stat", merge_base, branch)
    stat_text = stats["stdout"] if stats["success"] else ""

    # Commit messages
    commits = _run_git(repo, "log", "--format=%s", f"{merge_base}..{branch}")
    commit_list = [c for c in commits["stdout"].split("\n") if c] if commits["success"] else []

    # Categorize
    categories = shared.categorize_files(changed_files)

    # Generate title from commits or branch name
    title = ""
    if commit_list:
        # Use first commit or synthesize
        first = commit_list[0]
        title = re.sub(r"^\w+(\(.+?\))?:\s*", "", first)
    else:
        title = branch.replace("-", " ").replace("_", " ").title()

    # Generate body
    body_sections = []
    body_sections.append(f"## Changes\n")
    if categories.get("source"):
        body_sections.append(f"**Source:** {', '.join(categories['source'][:5])}")
    if categories.get("test"):
        body_sections.append(f"**Tests:** {', '.join(categories['test'][:3])}")
    if categories.get("config"):
        body_sections.append(f"**Config:** {', '.join(categories['config'][:3])}")
    if categories.get("docs"):
        body_sections.append(f"**Docs:** {', '.join(categories['docs'][:3])}")

    body_sections.append(f"\n## Commits\n")
    for c in commit_list[:15]:
        body_sections.append(f"- {c}")

    if stat_text:
        body_sections.append(f"\n## Stats\n```\n{stat_text}\n```")

    return {
        "title": title,
        "body": "\n".join(body_sections),
        "changed_files": len(changed_files),
        "commits": len(commit_list),
        "categories": {k: len(v) for k, v in categories.items()}
    }


async def handle_release_notes(args: dict) -> dict:
    """Generate release notes from a commit range."""
    repo = args.get("repo", ".")
    since = args.get("since", "")  # tag or commit
    until = args.get("until", "HEAD")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Get tags for reference
    tags = _run_git(repo, "tag", "--sort=-creatordate")
    recent_tags = tags["stdout"].split("\n")[:10] if tags["success"] else []

    # Build revision range
    rev_range = f"{since}..{until}" if since else until

    # Get commits
    log = _run_git(repo, "log", rev_range, "--format=%H|%an|%ar|%s")
    if not log["success"]:
        return {"error": log["stderr"]}

    features, fixes, breaking, other = [], [], [], []
    contributors = set()

    for line in log["stdout"].split("\n"):
        if "|" not in line:
            continue
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        hash_, author, reltime, subject = parts
        contributors.add(author)

        # Categorize
        if re.search(r"^feat(\(.+?\))?!?:", subject) or re.search(r"^feat(\(.+?\)):", subject):
            features.append(f"- {subject} ({author}, {reltime})")
        elif re.search(r"^fix(\(.+?\))?!?:", subject) or re.search(r"^fix(\(.+?\)):", subject):
            fixes.append(f"- {subject} ({author}, {reltime})")
        elif "!" in subject.split(":")[0] if ":" in subject else False:
            breaking.append(f"- {subject} ({author}, {reltime})")
        else:
            other.append(f"- {subject} ({author}, {reltime})")

    # Get diff stats
    stats = _run_git(repo, "diff", "--stat", since or until, until) if since else {"stdout": ""}

    sections = []
    if breaking:
        sections.append("## Breaking Changes\n" + "\n".join(breaking))
    if features:
        sections.append("## New Features\n" + "\n".join(features))
    if fixes:
        sections.append("## Bug Fixes\n" + "\n".join(fixes))
    if other:
        sections.append("## Other Changes\n" + "\n".join(other))

    version = until if until != "HEAD" else "next"
    if recent_tags:
        # Suggest next version
        latest = recent_tags[0]
        m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", latest)
        if m:
            version = f"v{m.group(1)}.{m.group(2)}.{int(m.group(3)) + 1}"

    return {
        "version": version,
        "since": since or "beginning",
        "until": until,
        "release_notes": "# Release " + version + "\n\n" + "\n\n".join(sections),
        "summary": {
            "features": len(features), "fixes": len(fixes),
            "breaking": len(breaking), "other": len(other),
            "contributors": len(contributors)
        },
        "recent_tags": recent_tags[:5]
    }


async def handle_repo_map(args: dict) -> dict:
    """Generate a structural map of the repository."""
    repo = args.get("repo", ".")
    max_depth = args.get("max_depth", 3)
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Get top-level structure
    tree = _run_git(repo, "ls-tree", "--name-only", "-r", "HEAD")
    all_files = [f for f in tree["stdout"].split("\n") if f] if tree["success"] else []

    # If git ls-tree fails, fall back to filesystem
    if not all_files:
        for root, dirs, files in os.walk(repo):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv", "venv", ".git")]
            level = root.replace(repo, "").count(os.sep)
            if level > max_depth:
                continue
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), repo)
                all_files.append(rel)

    # Build directory tree
    dir_tree = {}
    for f in all_files:
        parts = f.split("/")
        current = dir_tree
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        current[parts[-1]] = None

    # Count by extension
    ext_counts = {}
    for f in all_files:
        ext = os.path.splitext(f)[1] or "(no ext)"
        ext_counts[ext] = ext_counts.get(ext, 0) + 1

    # Detect project type
    project_type = "unknown"
    if any(f.endswith("package.json") for f in all_files):
        project_type = "node"
    elif any(f.endswith("requirements.txt") or f.endswith("pyproject.toml") for f in all_files):
        project_type = "python"
    elif any(f.endswith("Cargo.toml") for f in all_files):
        project_type = "rust"
    elif any(f.endswith("go.mod") for f in all_files):
        project_type = "go"
    elif any(f.endswith("pom.xml") or f.endswith("build.gradle") for f in all_files):
        project_type = "java"

    # Key files
    key_files = []
    key_patterns = ["README", "LICENSE", "CONTRIBUTING", "CHANGELOG", "Makefile",
                    "Dockerfile", "docker-compose", ".gitignore", "setup.py", "pyproject.toml",
                    "package.json", "tsconfig", "webpack", "vite.config", "next.config"]
    for f in all_files:
        for pat in key_patterns:
            if pat in f:
                key_files.append(f)
                break

    return {
        "project_type": project_type,
        "total_files": len(all_files),
        "extensions": dict(sorted(ext_counts.items(), key=lambda x: -x[1])[:15]),
        "key_files": key_files[:20],
        "directory_tree": dir_tree,
        "recommendations": _repo_recommendations(project_type, all_files)
    }


def _repo_recommendations(project_type, files):
    recs = []
    if not any("README" in f for f in files):
        recs.append("Add a README.md")
    if not any(".gitignore" in f for f in files):
        recs.append("Add a .gitignore")
    if not any("LICENSE" in f for f in files):
        recs.append("Add a LICENSE file")
    if project_type == "python" and not any("test" in f.lower() for f in files):
        recs.append("Add tests/ directory")
    if not any(".github" in f for f in files):
        recs.append("Consider adding CI/CD with GitHub Actions")
    return recs


async def handle_contributor_stats(args: dict) -> dict:
    """Contributor analytics for the repository."""
    repo = args.get("repo", ".")
    if not os.path.isdir(repo):
        return {"error": f"not a directory: {repo}"}

    # Get all commits with author info
    log = _run_git(repo, "shortlog", "-sn", "--all", "--no-merges")
    if not log["success"]:
        return {"error": log["stderr"]}

    contributors = []
    total_commits = 0
    for line in log["stdout"].split("\n"):
        m = re.match(r"^\s*(\d+)\s+(.+)$", line)
        if m:
            count = int(m.group(1))
            name = m.group(2).strip()
            contributors.append({"name": name, "commits": count})
            total_commits += count

    # Get per-author detailed stats
    detailed = []
    for c in contributors[:10]:
        email_r = _run_git(repo, "log", "--format=%ae", "--author", c["name"], "--all", "--no-merges")
        emails = set(e for e in email_r["stdout"].split("\n") if e) if email_r["success"] else []

        first_commit = _run_git(repo, "log", "--format=%ar", "--author", c["name"], "--all", "--no-merges", "--reverse", "-1")
        last_commit = _run_git(repo, "log", "--format=%ar", "--author", c["name"], "--all", "--no-merges", "-1")

        # Files touched
        files_r = _run_git(repo, "log", "--format=", "--name-only", "--author", c["name"], "--all", "--no-merges")
        files_touched = set(f for f in files_r["stdout"].split("\n") if f) if files_r["success"] else set()

        detailed.append({
            "name": c["name"],
            "commits": c["commits"],
            "percentage": round(c["commits"] / total_commits * 100, 1) if total_commits else 0,
            "emails": list(emails)[:3],
            "first_commit": first_commit["stdout"] if first_commit["success"] else "",
            "last_commit": last_commit["stdout"] if last_commit["success"] else "",
            "files_touched": len(files_touched)
        })

    return {
        "total_contributors": len(contributors),
        "total_commits": total_commits,
        "top_contributors": detailed
    }


# ─── Server Setup ─────────────────────────────────────────────────────────────

server = Server("owl-git")

ALL_TOOLS = [
    ("git_status", "Enhanced git status with file categorization, branch info, ahead/behind counts", handle_status),
    ("git_smart_commit", "Generate conventional commit messages from staged changes, optionally commit", handle_smart_commit),
    ("git_branch_analyze", "Analyze branch health: divergence, staleness, merge readiness", handle_branch_analyze),
    ("git_conflict_predict", "Predict merge conflicts between two branches before merging", handle_conflict_predict),
    ("git_history_inspect", "Semantic commit history analysis with author stats and patterns", handle_history_inspect),
    ("git_diff_analyze", "Semantic diff analysis — what changed, why, and what patterns emerged", handle_diff_analyze),
    ("git_pr_generate", "Auto-generate PR title and description from branch changes", handle_pr_generate),
    ("git_release_notes", "Generate release notes from a commit range with categorization", handle_release_notes),
    ("git_repo_map", "Generate repository architecture map with file type analysis", handle_repo_map),
    ("git_contributor_stats", "Contributor analytics: commits, files touched, activity timeline", handle_contributor_stats),
]

_tools_registered = False


@server.list_tools()
async def list_tools() -> List[Tool]:
    global _tools_registered
    tools = []
    for name, desc, _ in ALL_TOOLS:
        tools.append(Tool(name=name, description=desc, inputSchema={
            "type": "object",
            "properties": {},
            "additionalProperties": True
        }))
    _tools_registered = True
    return tools


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
