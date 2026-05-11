#!/usr/bin/env python3
"""Collect local AI-agent activity and write a Markdown report draft."""

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import subprocess
from collections import defaultdict
from pathlib import Path


HOME = Path.home()
DEFAULT_SOURCES = ["codex", "claude", "copilot", "git"]


def parse_time(value):
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).astimezone()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return dt.datetime.fromisoformat(text).astimezone()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = dt.datetime.strptime(text[:19], fmt)
            return parsed.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
        except ValueError:
            continue
    return None


def start_of_day(day):
    return day.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_range(expr, now=None):
    now = now or dt.datetime.now().astimezone()
    text = (expr or "today").strip().lower()
    text = re.sub(r"\s+", " ", text)

    aliases = {
        "today": "today",
        "今天": "today",
        "one day": "today",
        "一天": "today",
        "yesterday": "yesterday",
        "昨天": "yesterday",
        "this week": "this week",
        "本周": "this week",
        "last week": "last week",
        "上周": "last week",
        "past 7 days": "past 7 days",
        "最近7天": "past 7 days",
        "过去7天": "past 7 days",
    }
    text = aliases.get(text, text)

    if ".." in text:
        left, right = [part.strip() for part in text.split("..", 1)]
        start = parse_time(left)
        end = parse_time(right)
        if not start or not end:
            raise SystemExit("Invalid date range. Use YYYY-MM-DD..YYYY-MM-DD.")
        return start_of_day(start), start_of_day(end) + dt.timedelta(days=1), expr

    match = re.match(r"^(past|last)\s+(\d+)\s+days?$", text)
    if match:
        days = int(match.group(2))
        start = start_of_day(now) - dt.timedelta(days=days - 1)
        return start, now, expr

    match = re.match(r"^过去(\d+)天$", text)
    if match:
        days = int(match.group(1))
        start = start_of_day(now) - dt.timedelta(days=days - 1)
        return start, now, expr

    if text == "today":
        start = start_of_day(now)
        return start, start + dt.timedelta(days=1), expr
    if text == "yesterday":
        start = start_of_day(now) - dt.timedelta(days=1)
        return start, start + dt.timedelta(days=1), expr
    if text == "this week":
        start = start_of_day(now) - dt.timedelta(days=now.weekday())
        return start, now, expr
    if text == "last week":
        this_week = start_of_day(now) - dt.timedelta(days=now.weekday())
        return this_week - dt.timedelta(days=7), this_week, expr

    single = parse_time(text)
    if single:
        start = start_of_day(single)
        return start, start + dt.timedelta(days=1), expr

    raise SystemExit("Unsupported range: %s" % expr)


def in_range(ts, start, end):
    return ts is not None and start <= ts < end


def iter_jsonl(path):
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except (OSError, UnicodeError):
        return


def text_from_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text" and item.get("text"):
                    parts.append(str(item.get("text")))
                elif item.get("text"):
                    parts.append(str(item.get("text")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    if isinstance(content, dict):
        return str(content.get("text") or content.get("content") or "")
    return ""


def clean_text(text, limit=900):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "..."
    return text


def strip_context_noise(text):
    text = text or ""
    text = re.sub(r"<INSTRUCTIONS>.*?</INSTRUCTIONS>", " ", text, flags=re.DOTALL)
    text = re.sub(r"<environment_context>.*?</environment_context>", " ", text, flags=re.DOTALL)
    text = re.sub(r"^# AGENTS\.md instructions[^\n]*(?:\n|$)", " ", text)
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("<") and stripped.endswith(">"):
            continue
        if stripped.startswith("# AGENTS.md"):
            continue
        lines.append(stripped)
    return "\n".join(lines).strip()


def first_sentence(text, limit=120):
    text = clean_text(strip_context_noise(text), limit=500)
    if not text:
        return ""
    split = re.split(r"(?<=[。！？.!?])\s+", text, maxsplit=1)[0]
    return clean_text(split, limit=limit)


def session_title(prompts, cwd):
    for prompt in prompts:
        title = first_sentence(prompt, limit=140)
        if title:
            return title
    if cwd:
        return "Work in %s" % cwd
    return "Untitled activity"


def normalize_item(item):
    item["title"] = session_title(item.get("prompts", []), item.get("cwd"))
    item["summary"] = first_sentence("\n".join(item.get("assistant_text", [])[-3:]), limit=240)
    item["prompts"] = [clean_text(strip_context_noise(x), 500) for x in item.get("prompts", []) if clean_text(strip_context_noise(x), 500)]
    item["assistant_text"] = [clean_text(x, 700) for x in item.get("assistant_text", []) if clean_text(x, 700)]
    item["operations"] = sorted(set(item.get("operations", [])))[:40]
    item["changed_files"] = sorted(set(item.get("changed_files", [])))[:40]
    return item


def parse_json_maybe(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def normalize_path(path_text, cwd):
    path_text = (path_text or "").strip().strip("'\"")
    if not path_text:
        return ""
    if path_text.startswith("/"):
        return path_text
    if cwd and not path_text.startswith("-") and not path_text.startswith("http"):
        return str(Path(cwd) / path_text)
    return path_text


def should_keep_changed_file(path_text):
    if not path_text:
        return False
    normalized = path_text.replace("\\", "/")
    ignored_parts = [
        "/.codex/memories/",
        "/.codex/plugins/",
        "/.codex/sessions/",
        "/.codex/skills/.system/",
        "/.claude/",
        "/Library/Application Support/",
        "/Users/bytedance/.codex/",
        "/Users/bytedance/.claude/",
        "/Users/bytedance/Library/",
    ]
    if any(part in normalized for part in ignored_parts):
        return False
    if "/Users/bytedance/" in normalized and not normalized.startswith("/Users/bytedance/"):
        return False
    if normalized.startswith("Users/bytedance/"):
        return False
    return likely_source_path(normalized)


def extract_paths_from_text(text, cwd):
    found = []
    text = text or ""
    patch_patterns = [
        r"\*\*\* Add File: ([^\n]+)",
        r"\*\*\* Update File: ([^\n]+)",
        r"\*\*\* Delete File: ([^\n]+)",
        r"\*\*\* Move to: ([^\n]+)",
    ]
    for pattern in patch_patterns:
        for match in re.findall(pattern, text):
            path = normalize_path(match, cwd)
            if should_keep_changed_file(path):
                found.append(path)
    for match in re.findall(r"/Users/[^\s\"'`:,)]+", text):
        if should_keep_changed_file(match):
            found.append(match)
    for match in re.findall(r"(?:[\w.-]+/)+(?:[\w.-]+)\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|go|rs|css|scss|html|vue|svelte|toml|yaml|yml)", text):
        path = normalize_path(match, cwd)
        if should_keep_changed_file(path):
            found.append(path)
    return found


def likely_source_path(path_text):
    ignored = ["/.codex/sessions/", "/.claude/", "/Library/Application Support/"]
    if any(part in path_text for part in ignored):
        return False
    return bool(re.search(r"\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|go|rs|css|scss|html|vue|svelte|toml|yaml|yml)$", path_text))


def extract_changed_files(tool_name, args, cwd):
    changed = []
    edit_tool_names = {"edit", "write", "multiedit", "apply_patch"}
    if not tool_name or tool_name.lower() not in edit_tool_names:
        return []
    raw = args if isinstance(args, str) else json.dumps(args or {}, ensure_ascii=False)
    data = parse_json_maybe(args)
    for key in ("file_path", "path"):
        value = data.get(key)
        if isinstance(value, str):
            path = normalize_path(value, cwd)
            if should_keep_changed_file(path):
                changed.append(path)
    for key in ("cmd", "command", "arguments", "patch"):
        value = data.get(key)
        if isinstance(value, str):
            changed.extend(extract_paths_from_text(value, cwd))
    changed.extend(extract_paths_from_text(raw, cwd))
    return sorted(set(path for path in changed if should_keep_changed_file(path)))


def should_scan_file(path, start, end, margin_days=2):
    lower_bound = start - dt.timedelta(days=margin_days)
    upper_bound = end + dt.timedelta(days=margin_days)
    try:
        mtime = dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc).astimezone()
    except OSError:
        return True

    name = path.name
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", name)
    if match:
        day = dt.datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=start.tzinfo)
        return day < upper_bound and mtime >= lower_bound
    return mtime >= lower_bound


def collect_codex(start, end):
    root = HOME / ".codex" / "sessions"
    items = {}
    if not root.exists():
        return []
    for path in root.rglob("*.jsonl"):
        if not should_scan_file(path, start, end):
            continue
        item = {
            "source": "codex",
            "path": str(path),
            "session_id": path.stem,
            "cwd": "",
            "start": None,
            "end": None,
            "prompts": [],
            "assistant_text": [],
            "operations": [],
            "changed_files": [],
        }
        touched = False
        for row in iter_jsonl(path):
            ts = parse_time(row.get("timestamp"))
            if in_range(ts, start, end):
                touched = True
                item["start"] = min(filter(None, [item["start"], ts]), default=ts)
                item["end"] = max(filter(None, [item["end"], ts]), default=ts)
            payload = row.get("payload") or {}
            if row.get("type") == "session_meta":
                meta = payload
                item["cwd"] = meta.get("cwd") or item["cwd"]
                item["session_id"] = meta.get("id") or item["session_id"]
            if not in_range(ts, start, end):
                continue
            if row.get("type") == "response_item":
                ptype = payload.get("type")
                if ptype == "message":
                    role = payload.get("role")
                    text = text_from_content(payload.get("content"))
                    if role == "user":
                        item["prompts"].append(text)
                    elif role == "assistant":
                        item["assistant_text"].append(text)
                elif ptype == "function_call":
                    name = payload.get("name") or "tool"
                    args = payload.get("arguments")
                    if isinstance(args, str):
                        snippet = clean_text(args, 180)
                    else:
                        snippet = clean_text(json.dumps(args, ensure_ascii=False), 180)
                    item["operations"].append("%s %s" % (name, snippet))
                    item["changed_files"].extend(extract_changed_files(name, args, item.get("cwd", "")))
            elif row.get("type") == "event_msg":
                msg = payload.get("message")
                if msg:
                    item["operations"].append(clean_text(msg, 180))
        if touched and (item["prompts"] or item["assistant_text"] or item["operations"]):
            items[item["session_id"]] = normalize_item(item)
    return list(items.values())


def collect_claude(start, end):
    root = HOME / ".claude" / "projects"
    grouped = {}
    if not root.exists():
        return []
    for path in root.rglob("*.jsonl"):
        if not should_scan_file(path, start, end):
            continue
        for row in iter_jsonl(path):
            ts = parse_time(row.get("timestamp"))
            if not in_range(ts, start, end):
                continue
            session_id = row.get("sessionId") or path.parent.name
            key = "%s:%s" % (session_id, row.get("agentId") or "")
            item = grouped.setdefault(
                key,
                {
                    "source": "claude",
                    "path": str(path),
                    "session_id": session_id,
                    "cwd": row.get("cwd") or "",
                    "start": ts,
                    "end": ts,
                    "prompts": [],
                    "assistant_text": [],
                    "operations": [],
                    "changed_files": [],
                },
            )
            item["cwd"] = row.get("cwd") or item["cwd"]
            item["start"] = min(item["start"], ts)
            item["end"] = max(item["end"], ts)
            msg = row.get("message") or {}
            role = msg.get("role") or row.get("type")
            content = msg.get("content")
            if role == "user":
                item["prompts"].append(text_from_content(content))
            elif role == "assistant":
                if isinstance(content, list):
                    for entry in content:
                        if isinstance(entry, dict) and entry.get("type") == "tool_use":
                            name = entry.get("name") or "tool"
                            data = entry.get("input") or {}
                            item["operations"].append("%s %s" % (name, clean_text(json.dumps(data, ensure_ascii=False), 180)))
                            item["changed_files"].extend(extract_changed_files(name, data, item.get("cwd", "")))
                        else:
                            text = text_from_content([entry])
                            if text:
                                item["assistant_text"].append(text)
                else:
                    text = text_from_content(content)
                    if text:
                        item["assistant_text"].append(text)
    return [normalize_item(item) for item in grouped.values()]


def collect_copilot(start, end):
    roots = [
        HOME / "Library" / "Application Support" / "Code" / "User" / "globalStorage" / "github.copilot-chat",
        HOME / "Library" / "Application Support" / "Code" / "User" / "workspaceStorage",
    ]
    items = []
    seen = set()
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if not is_probably_copilot_activity(path):
                continue
            low = str(path).lower()
            if "copilot" not in low and "github.copilot" not in low:
                continue
            if path in seen:
                continue
            seen.add(path)
            try:
                mtime = dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc).astimezone()
            except OSError:
                continue
            if not in_range(mtime, start, end):
                continue
            snippet = extract_small_text(path)
            items.append(
                normalize_item(
                    {
                        "source": "copilot",
                        "path": str(path),
                        "session_id": path.name,
                        "cwd": "",
                        "start": mtime,
                        "end": mtime,
                        "prompts": [snippet] if snippet else ["Copilot-related local file changed: %s" % path.name],
                        "assistant_text": [],
                        "operations": [],
                        "changed_files": [],
                    }
                )
            )
    return items


def find_git_root(cwd):
    if not cwd:
        return ""
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return ""


def collect_git(start, end, seed_items):
    repos = set()
    for item in seed_items:
        root = find_git_root(item.get("cwd", ""))
        if root:
            repos.add(root)
    cwd_root = find_git_root(os.getcwd())
    if cwd_root:
        repos.add(cwd_root)

    items = []
    for repo in sorted(repos):
        try:
            result = subprocess.run(
                [
                    "git",
                    "-C",
                    repo,
                    "log",
                    "--since",
                    start.isoformat(),
                    "--until",
                    end.isoformat(),
                    "--name-only",
                    "--pretty=format:__COMMIT__%x09%H%x09%ad%x09%s",
                    "--date=iso",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
        except (subprocess.SubprocessError, OSError):
            continue
        items.extend(parse_git_log(repo, result.stdout, start))
    return items


def parse_git_log(repo, output, fallback_time):
    items = []
    current = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("__COMMIT__\t"):
            if current:
                items.append(normalize_item(current))
            parts = line.split("\t", 3)
            commit_hash = parts[1] if len(parts) > 1 else ""
            when = parse_time(parts[2]) if len(parts) > 2 else fallback_time
            subject = parts[3] if len(parts) > 3 else "Git commit"
            current = {
                "source": "git",
                "path": repo,
                "session_id": commit_hash[:12],
                "cwd": repo,
                "start": when or fallback_time,
                "end": when or fallback_time,
                "prompts": [subject],
                "assistant_text": ["提交包含代码或文档改动。"],
                "operations": [],
                "changed_files": [],
                "commit": commit_hash,
            }
        elif current:
            path = normalize_path(line, repo)
            if should_keep_changed_file(path):
                current["changed_files"].append(path)
    if current:
        items.append(normalize_item(current))
    return items


def is_probably_copilot_activity(path):
    low = str(path).lower()
    name = path.name.lower()
    ignored_names = {
        "commandembeddings.json",
        "codebase-external.sqlite",
        "copilotclishim.js",
        "copilotclishim.ps1",
        "copilot",
        "copilot-debug",
        "copilotdebugcommand.js",
        "ask.agent.md",
        "plan.agent.md",
        "explore.agent.md",
    }
    ignored_parts = [
        "/copilotcli/",
        "/debugcommand/",
        "/cachedextensionvsixs/",
        "/cache/",
    ]
    if name in ignored_names:
        return False
    if any(part in low for part in ignored_parts):
        return False
    if path.suffix.lower() not in ("", ".json", ".jsonl", ".log", ".md", ".txt", ".sqlite", ".db"):
        return False
    return True


def extract_small_text(path):
    suffix = path.suffix.lower()
    if suffix in (".sqlite", ".db"):
        return extract_sqlite_text(path)
    if suffix not in ("", ".json", ".jsonl", ".log", ".md", ".txt"):
        return ""
    try:
        data = path.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeError):
        return ""
    text = re.sub(r"\s+", " ", data)
    return clean_text(text, 500)


def extract_sqlite_text(path):
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    except sqlite3.Error:
        return ""
    parts = []
    try:
        cursor = conn.execute("select name from sqlite_master where type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        for table in tables[:8]:
            try:
                rows = conn.execute("select * from %s limit 5" % quote_ident(table)).fetchall()
            except sqlite3.Error:
                continue
            if rows:
                parts.append("%s: %s" % (table, rows[:2]))
    finally:
        conn.close()
    return clean_text(" ".join(parts), 500)


def quote_ident(name):
    return '"' + str(name).replace('"', '""') + '"'


STOPWORDS = set(
    """
    the and for with from this that into what when where why how you your our are was were
    task tasks work help please about need done doing make update fix add support use using
    今天 昨天 上周 本周 这个 那个 帮我 看下 一下 继续 支持 修复 增加 调整 更新 生成 总结
    """.split()
)


def candidate_keywords(text):
    words = []
    patterns = [
        r"`([^`]{2,50})`",
        r"\b[A-Z][A-Za-z0-9]*(?:[-_ ][A-Z]?[A-Za-z0-9]+){0,3}\b",
        r"\b[a-z][a-z0-9]+(?:[-_][a-z0-9]+){1,4}\b",
        r"[\u4e00-\u9fffA-Za-z0-9]{2,18}",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text):
            token = clean_text(match, 50).strip(".,:;()[]{}")
            low = token.lower()
            if len(token) >= 2 and low not in STOPWORDS:
                words.append(token)
    return words


def theme_for_item(item, hints):
    primary_text = " ".join([item.get("title", ""), item.get("cwd", "")] + item.get("prompts", []))
    secondary_text = " ".join(item.get("assistant_text", []) + item.get("operations", []) + item.get("changed_files", []))
    text = " ".join([primary_text, secondary_text])
    primary_low = primary_text.lower()
    text_low = text.lower()
    cwd_low = (item.get("cwd") or "").lower()
    for hint in hints:
        if hint.lower() in primary_low:
            return hint
    for hint in hints:
        if hint.lower() in text_low:
            return hint
    inferred = infer_feature_theme(item, primary_low, text_low, cwd_low)
    if inferred:
        return inferred

    explicit = [
        "Skill",
        "MCP Apps",
        "A2UI",
        "Claude Code",
        "Codex",
        "Copilot",
        "Chrome Debug",
        "Module Federation",
        "Rspack",
        "Garfish",
        "Mira",
        "Vmok",
        "Release Note",
        "DevTools",
    ]
    for key in explicit:
        if key.lower() in primary_low:
            return key
    for key in explicit:
        if key.lower() in text_low:
            return key

    cwd = item.get("cwd") or ""
    repo = Path(cwd).name if cwd else ""
    tokens = candidate_keywords(primary_text) or candidate_keywords(text)
    counts = defaultdict(int)
    for token in tokens:
        counts[token] += 1
    best = ""
    if counts:
        best = sorted(counts.items(), key=lambda pair: (-pair[1], -len(pair[0]), pair[0]))[0][0]
    if repo and best:
        return "%s / %s" % (repo, best)
    return repo or best or "Other"


def infer_feature_theme(item, primary_low, text_low, cwd_low):
    if item.get("source") == "git":
        title = normalize_commit_title(item.get("title", ""))
        if title:
            return title

    files = item.get("changed_files") or []
    package_theme = infer_theme_from_changed_files(files)
    if package_theme:
        return package_theme

    combined = " ".join([primary_low, text_low, cwd_low])
    if is_validation_surface(combined):
        file_theme = infer_theme_from_changed_files(files)
        if file_theme:
            return file_theme
    return ""


def normalize_commit_title(title):
    title = clean_text(title, 120)
    match = re.match(r"^(feat|fix|docs|refactor|perf|test|chore|build|ci)(?:\(([^)]+)\))?:\s*(.+)$", title, flags=re.I)
    if match:
        scope = match.group(2) or ""
        subject = match.group(3) or ""
        if scope and is_generic_scope(scope):
            return title_case_phrase(subject)
        if scope:
            return title_case_phrase(scope)
        return title_case_phrase(subject)
    return ""


def title_case_phrase(text):
    text = clean_text(text, 80)
    if not text:
        return ""
    if re.search(r"[\u4e00-\u9fff]", text):
        return text
    words = re.split(r"[-_\s]+", text)
    useful = [word for word in words if word and word.lower() not in STOPWORDS]
    if not useful:
        return text
    return " ".join(word[:1].upper() + word[1:] for word in useful[:5])


def is_generic_scope(scope):
    return scope.lower() in {"runtime", "core", "app", "apps", "demo", "test", "docs", "repo", "package"}


def infer_theme_from_changed_files(files):
    candidates = []
    for file_path in files:
        parts = Path(file_path).parts
        for marker in ("packages", "apps", "skills"):
            if marker in parts:
                idx = parts.index(marker)
                if idx + 1 < len(parts):
                    name = parts[idx + 1]
                    if not is_validation_name(name):
                        candidates.append(title_case_phrase(name))
        name = Path(file_path).stem
        if name and not is_validation_name(name):
            candidates.append(title_case_phrase(name))
    counts = defaultdict(int)
    for candidate in candidates:
        if candidate:
            counts[candidate] += 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[0][0]


def is_validation_name(name):
    low = name.lower()
    validation_terms = [
        "demo",
        "fixture",
        "fixtures",
        "showcase",
        "test",
        "tests",
        "spec",
        "e2e",
        "localhost",
    ]
    return any(term in low for term in validation_terms) or bool(re.search(r"\b\d{3,5}\b", low))


def is_validation_surface(text):
    validation_terms = [
        "demo",
        "fixture",
        "showcase",
        "playground",
        "localhost",
        "127.0.0.1",
        "testcase",
        "测试",
        "验证",
        "复现",
    ]
    return any(term in text for term in validation_terms)


def group_items(items, hints):
    grouped = defaultdict(list)
    for item in items:
        grouped[theme_for_item(item, hints)].append(item)
    return dict(sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0].lower())))


def format_time(value):
    if not value:
        return ""
    return value.strftime("%Y-%m-%d %H:%M")


def report_title(start, end):
    days = max(1, (start_of_day(end - dt.timedelta(seconds=1)) - start_of_day(start)).days + 1)
    if days <= 1:
        return "日报：%s" % start.strftime("%Y-%m-%d")
    return "周报：%s 至 %s" % (start.strftime("%Y-%m-%d"), (end - dt.timedelta(seconds=1)).strftime("%Y-%m-%d"))


def write_markdown(path, items, grouped, start, end, range_label, sources):
    lines = []
    lines.append("# %s" % report_title(start, end))
    lines.append("")
    lines.append("## 概览")
    lines.append("")
    if items:
        lines.append("- 时间范围：%s 至 %s。" % (format_time(start), format_time(end)))
        lines.append("- 共找到 %d 条活动记录，覆盖 %d 个主题。" % (len(items), len(grouped)))
        lines.append("- 下面是自动初稿，使用时应根据证据再合并同一大任务下的子项。")
    else:
        lines.append("- 时间范围：%s 至 %s。" % (format_time(start), format_time(end)))
        lines.append("- 未找到可用于生成报告的活动记录。")
    lines.append("")

    for theme, theme_items in grouped.items():
        lines.append("## %s" % theme)
        lines.append("")
        for item in sorted(theme_items, key=lambda x: x.get("start") or start):
            title = item.get("title") or "Untitled activity"
            summary = item.get("summary")
            source = item.get("source")
            when = format_time(item.get("start"))
            cwd = item.get("cwd")
            detail = summary or (item.get("prompts") or [""])[0]
            lines.append("- %s" % title)
            if detail and detail != title:
                lines.append("  - 结果：%s" % detail)
            changed_files = item.get("changed_files") or []
            if changed_files:
                short_files = [shorten_path_for_report(x, cwd) for x in changed_files[:6]]
                lines.append("  - 开发证据：%s" % "、".join(short_files))
            meta = "  - 来源：%s，时间：%s" % (source, when)
            if cwd:
                meta += "，目录：%s" % cwd
            lines.append(meta)
        lines.append("")

    lines.append("## 数据来源")
    lines.append("")
    counts = defaultdict(int)
    for item in items:
        counts[item.get("source", "unknown")] += 1
    for source in sources:
        lines.append("- %s：%d 条。" % (source, counts.get(source, 0)))
    lines.append("- 请求范围：%s。" % range_label)
    lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def shorten_path_for_report(path_text, cwd):
    if not path_text:
        return ""
    if cwd and path_text.startswith(cwd + "/"):
        return path_text[len(cwd) + 1 :]
    home = str(HOME)
    if path_text.startswith(home + "/"):
        return "~/" + path_text[len(home) + 1 :]
    return path_text


def encode_for_json(items):
    result = []
    for item in items:
        copy = dict(item)
        for key in ("start", "end"):
            if copy.get(key):
                copy[key] = copy[key].isoformat()
        result.append(copy)
    return result


def main():
    parser = argparse.ArgumentParser(description="Collect local AI agent activity and write a Markdown report draft.")
    parser.add_argument("--range", default="today", help="today, yesterday, last week, past 7 days, or YYYY-MM-DD..YYYY-MM-DD")
    parser.add_argument("--sources", default=",".join(DEFAULT_SOURCES), help="Comma-separated: codex,claude,copilot,git")
    parser.add_argument("--output", required=True, help="Markdown output path")
    parser.add_argument("--json-output", help="Optional JSON evidence output path")
    parser.add_argument("--topic-hints", default="", help="Comma-separated preferred major theme titles")
    args = parser.parse_args()

    start, end, range_label = parse_range(args.range)
    raw_sources = [x.strip().lower() for x in args.sources.split(",") if x.strip()]
    sources = raw_sources
    hints = [x.strip() for x in args.topic_hints.split(",") if x.strip()]

    items = []
    if "codex" in sources:
        items.extend(collect_codex(start, end))
    if "claude" in sources or "claude-code" in sources:
        items.extend(collect_claude(start, end))
    if "copilot" in sources:
        items.extend(collect_copilot(start, end))
    if "git" in sources:
        items.extend(collect_git(start, end, items))

    items = sorted(items, key=lambda item: (item.get("start") or start, item.get("source", "")))
    grouped = group_items(items, hints)
    output = Path(args.output).expanduser()
    write_markdown(output, items, grouped, start, end, range_label, sources)

    if args.json_output:
        json_output = Path(args.json_output).expanduser()
        json_output.parent.mkdir(parents=True, exist_ok=True)
        json_output.write_text(
            json.dumps(
                {
                    "range": {"label": range_label, "start": start.isoformat(), "end": end.isoformat()},
                    "sources": sources,
                    "items": encode_for_json(items),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    print("Wrote %s (%d items, %d themes)" % (output, len(items), len(grouped)))


if __name__ == "__main__":
    main()
