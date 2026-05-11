---
name: agent-activity-report
description: Generate Markdown daily or weekly work reports from local AI agent activity history. Use this when the user asks to summarize what Codex, Claude Code, or Copilot did during a time range such as today, yesterday, one day, this week, last week, or a custom date range. The skill collects evidence from local history, groups small tasks under larger ongoing initiatives, and writes a .md report with titles chosen from the actual work.
---

# agent-activity-report

Create a Markdown daily, weekly, or custom-period report from local agent history.

## What This Skill Does

- Reads local activity from Codex, Claude Code, best-effort Copilot history, and nearby Git history.
- Accepts natural time ranges such as `today`, `yesterday`, `last week`, `this week`, `past 7 days`, `2026-05-01..2026-05-07`, `今天`, `昨天`, `上周`, `本周`, `过去7天`.
- Produces a `.md` report.
- Groups related small tasks under larger work themes, for example `MCP Apps 支持` with subitems such as `支持 xxx` and `支持 yyy`.

## Workflow

1. Resolve the user's requested time range and report type.
   - If the user names the main initiative, pass it with `--topic-hints`, for example `--topic-hints "Main Feature Name"`.
2. Collect raw evidence:

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range "last week" \
  --output /tmp/agent-report.md \
  --json-output /tmp/agent-report.evidence.json
```

3. Read the generated Markdown and, when needed, the JSON evidence.
4. Rewrite the Markdown into the final report using `references/grouping-rules.md`.
5. Save the final answer as a `.md` file. Do not only paste the report in chat unless the user explicitly asks for inline output.
6. Verify that the file exists, is valid Markdown, and contains grouped headings, not just a flat timeline.

## Common Commands

Daily report:

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range today \
  --output reports/daily-$(date +%F).md
```

Weekly report:

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range "last week" \
  --output reports/weekly-last-week.md
```

Limit sources:

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range "2026-05-01..2026-05-07" \
  --sources codex,claude,copilot,git \
  --output reports/weekly-2026-05-01.md
```

## Reference Files

- `references/report-workflow.md` - collection, rewriting, and validation workflow.
- `references/grouping-rules.md` - how to infer large themes and write the final Markdown report.
