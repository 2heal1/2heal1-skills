# Report Workflow

## Inputs to Clarify

Only ask a question if the request is impossible to infer.

- Time range: default to `today` for a daily report and `last week` for a weekly report.
- Sources: default to `codex,claude,copilot,git`.
- Output path: if absent, create a clear path under the current workspace, such as `reports/daily-YYYY-MM-DD.md` or `reports/weekly-YYYY-MM-DD_YYYY-MM-DD.md`.
- Language: match the user's request language.

## Collection

Run the collector first. It is intentionally evidence-oriented and conservative:

```bash
python3 skills/agent-activity-report/scripts/collect_activity.py \
  --range "<time range>" \
  --sources codex,claude,copilot,git \
  --output "<report.md>" \
  --json-output "<evidence.json>"
```

The collector writes a Markdown draft and, optionally, JSON evidence. Git is included because agent conversations often describe validation while commits and changed files show the actual development theme. The draft is not the final report if it is too flat or has weak theme names. Use it as evidence, then rewrite the report.

## Rewriting

Read the Markdown draft first. Read the JSON evidence when:

- a section title is vague,
- a task looks duplicated,
- related work is split across Codex and Claude Code,
- the user specifically cares about which larger task an item belongs to.
- demo or diagnostics tasks may actually be validation work for a larger feature.
- conversation text only says "validate" but Git evidence shows feature development.

Rewrite the final `.md` with:

- one top-level title,
- a short overview,
- grouped major themes,
- concrete subitems under each theme,
- a short source coverage note.

## Validation

Before reporting back:

1. Confirm the output file exists.
2. Confirm it is `.md`.
3. Confirm it has at least one major theme heading when there is activity.
4. Confirm the main theme is the actual feature or initiative, not only the repo, demo, port, page, or tool used to test it.
5. If a heading is only a demo app, test page, localhost URL, port number, temporary fixture, or another validation surface, check whether the section should be renamed to the feature being validated.
6. Confirm no heading is an over-broad umbrella that joins unrelated work just because it shares a repo or product family. If a heading combines three or more concepts, split it into smaller deliverable-based headings.
7. Confirm related items are not left as a pure chronological list.
8. If the user provided a correction such as "this was mainly X", confirm matching evidence was regrouped under `X`.
9. If no activity is found, say which sources and time range were checked.
