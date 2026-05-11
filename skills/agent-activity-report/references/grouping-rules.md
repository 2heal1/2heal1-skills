# Grouping Rules

## Goal

The report must make long-running work visible. Do not present every prompt as a separate headline when several tasks clearly belong to one larger effort.

## How to Infer Major Themes

Use these signals, in this order:

1. User-provided correction or context in the current request. If the user says "I was mainly doing X", make `X` the candidate major theme and regroup matching evidence under it.
2. Explicit product, project, or feature names in prompts, paths, branch names, PR titles, or final summaries.
3. Git commit titles and changed files. These often reveal the real development theme when agent prompts only mention validation.
4. Repeated nouns across multiple sessions, such as `MCP Apps`, `A2UI`, `Chrome Debug`, `release note`, `Module Federation`.
5. Same repository plus same feature area.
6. Same output artifact, such as docs, plugin, skill, report, demo, CI, or test.
7. User wording that indicates continuation: `继续`, `再`, `补`, `上次`, `这个能力`, `这块`, `下一步`.

## Goal vs. Validation Surface

Separate the feature being built from the place used to validate it.

- If work happens in a demo, testcase, diagnostics page, or local playground, first ask what capability the demo is validating.
- Do not use a demo app name, test page name, port number, localhost URL, or temporary fixture as the major theme when surrounding evidence points to a product capability.
- Prefer a feature title from the user's wording, commit title, branch name, changed package, or roadmap file over a validation-surface title.

Example:

```markdown
## Feature Name

- 完成核心实现，并补齐对应的文档或发布记录。
- 通过 demo 页面、测试用例或本地 playground 验证主要流程。
- 修复验证中发现的问题，确认结果不是本地环境偶发导致。
```

## Theme Titles

Good titles are feature-level, not prompt-level:

- `MCP Apps 支持`
- `A2UI 渲染链路`
- `Chrome 调试 Skill`
- `发布说明 Skill`
- `运行时诊断能力`

Avoid titles like:

- `修复 bug`
- `今天做的事情`
- `Codex 任务`
- `Claude 任务`
- demo app name
- localhost or port-based titles
- `其他`
- broad repository umbrellas, such as `Module Federation runtime 能力、诊断与可观测性`, when the section actually contains several independent tasks.

## Avoid Over-Merging

Do not merge work only because it shares the same repository, package family, or product namespace.

Split a broad theme when the items have different deliverables, for example:

- API or public behavior changes.
- diagnostics or error-reporting capability.
- observability or tracing capability.
- demo validation or recording support.
- docs, release, or changeset cleanup.
- native/mobile/build-cache work.

If one heading needs `、` or `and` to join three or more concepts, it is usually too broad. Prefer multiple smaller headings with concrete names.

Example split:

```markdown
## Module Federation runtime API 与文档收口

- ...

## MF 加载诊断能力

- ...

## MF 加载可观测插件

- ...
```

## Subitems

Each major theme should list concrete progress:

```markdown
## MCP Apps 支持

- 支持应用连接信息读取，并补齐失败时的提示。
- 调整插件安装流程，让缺失连接器时能给出明确下一步。
- 验证本地调试流程，确认主要路径可以跑通。
```

Keep source labels only when useful:

```markdown
- Codex 侧完成脚本和文档整理；Claude Code 侧补了边界验证。
```

## Merging and Splitting

Merge items when they share a feature goal even if they happened in separate sessions or tools.

Split items when the same repository contains unrelated work, for example docs cleanup and CI repair.

When several items are all validation steps for one feature, keep them under the feature and write each item as a validation result, not as an independent project.

Use `零散事项` only for genuinely unrelated small tasks. Keep it short.

## Report Shape

Use this structure unless the user asks otherwise:

```markdown
# 周报：YYYY-MM-DD 至 YYYY-MM-DD

## 概览

- 本周期主要推进了 ...
- 重点集中在 ...

## MCP Apps 支持

- ...
- ...

## 其他事项

- ...

## 数据来源

- Codex：...
- Claude Code：...
- Copilot：...
```

Do not include raw JSON, long command output, or internal debug noise in the final report.
