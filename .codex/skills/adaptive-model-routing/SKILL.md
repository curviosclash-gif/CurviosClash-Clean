---
name: adaptive-model-routing
description: Choose an efficient model and, when useful and allowed, an execution route for substantial coding, research, review, or repository work. Use when the user has not specified a model or delegation strategy.
---

# Adaptive model routing

Optimize total tokens to an accepted result, including task framing, handoffs, retries, integration and verification. A lower API price per token does not itself mean fewer tokens. Respect explicit user choices about models, reasoning, delegation and reviewers. Use only models and efforts offered by the current runtime; [OpenAI's model selection guidance](https://developers.openai.com/api/docs/guides/model-selection) is a starting point, not a substitute for evidence from the task.

## Choose the smallest effective path

- Do trivial, local and tightly sequential work directly. For substantial work, make a cheap preflight before deciding whether a handoff would save context or prevent a likely retry. Do not spawn agents solely because a task is large; follow current user, repository and runtime limits on delegation.
- Use `gpt-6-luna` at low effort for a bounded read-only question, triage, extraction, small edit or deterministic check with clear inputs and an objective result. Medium effort may fit a coordinated change with a clear brief. Keep judgment-heavy integration with Root.
- Use `gpt-6-sol` at medium effort for everyday coding, research, synthesis and implementation across an affected flow. Raise effort for material ambiguity, architecture, security, data loss, concurrency, network, storage-format or physics risk and for review where tests cannot settle the concern. Risk calls for suitable review and verification, not automatically the highest model.
- Start a permitted independent scout, worker or reviewer only when its expected context gain or avoided failure exceeds the handoff and integration cost. Prefer one precise task over several overlapping agents. Keep one writer at a time unless ownership and shared resources are demonstrably separate.
- If a Luna attempt produces an incomplete answer, unresolved ambiguity or one failed implementation hypothesis, pass its evidence to Sol rather than repeating the same attempt. Escalate Sol effort or seek independent expert review for material unresolved risk or a second failed hypothesis. Do not repeat work already established by sound evidence.

## Runtime model mapping

- When a GPT-6 override is available for subagents, use `agent_type: "default"` with `model: "gpt-6-luna"` for the bounded Luna lane or `model: "gpt-6-sol"` for a Sol implementation or review lane. Set `fork_turns: "none"` or a short fork and supply the needed context; full-history forks cannot take model overrides.
- Current `economy_scout`, `balanced_worker` and `expert_reviewer` roles may be pinned to older models. Do not assume their names select GPT-6. Use such roles only when their actual runtime model and scope make them the better route, or when a user explicitly chose one. `spark_explorer` remains an optional narrow codebase lookup when available and useful.
- If a GPT-6 override is unavailable, use the strongest suitable available route directly or a suitable role. Do not retry a rejected model selection or silently substitute a different model for an explicit user choice.

## Astra approval gate

- Never intentionally select, spawn, hand off to, retry with, or request review from `gpt-6-astra` unless the user has explicitly approved Astra for the specific use in the current task. An inherited default, automatic routing, a general request to use the best model, or approval from an unrelated task does not count. An explicit Astra selection or written approval for this task does count.
- If Astra appears necessary or materially useful, do not dispatch it yet. State the concrete reason, the expected benefit over the strongest adequate non-Astra route, and ask one concise approval question.
- While approval is pending, continue only safe work whose result does not depend on that choice. If the Astra decision changes the approach materially, wait for the answer.
- If approval is declined or not provided, use Sol or the strongest suitable non-Astra route and deterministic tooling, preserve the same tests and QA gates, and disclose any remaining limitation. Never reduce validation merely to fit a weaker model.
- Approval is limited to the described Astra use in the current task. Ask again for a materially different use or a later unrelated task.

## Ponytail-lite baseline

After understanding the complete affected flow, use the first adequate option: reuse an existing project capability, then the standard library, then a native platform feature, then an already-installed dependency, and only then write the minimum new code. Avoid speculative abstractions, configuration, dependencies, and broad refactors.

This shared baseline is not the persistent `$ponytail` mode and does not inherit its output style or `lite`/`full`/`ultra` intensities. It never removes validation, data-loss protection, security, accessibility, explicitly requested behavior, required tests, approval gates, or domain-specific QA. A calling skill's stricter requirements remain authoritative.

## Spend context deliberately

- Delegate only useful independent scope. Give compact inputs and an explicit result contract; return conclusions and selected evidence, not mirrored raw transcripts.
- Do not send the full conversation when a short task packet is sufficient. Include only requirements, owned files, constraints, and expected evidence.
- Keep requirements, decisions, integration and final verification in the main thread. Do not replan, retest or rerun review when no change or invalidated evidence justifies it. Never reduce necessary tests or safety guards to save tokens.
- Choose the lowest reasoning effort that has met the quality bar on comparable work; raise it for a concrete gap, then reuse the evidence already gathered. API prices and effort options can differ from Codex usage and runtime availability; do not promise numerical token savings from a model name.
- Prefer event or cursor waits to polling. On failure, inspect only the relevant output and choose the next evidence-producing step; avoid duplicated exploration.

## Optional existing loops

For an existing repeated workflow, select one concrete next candidate, finish the open iteration, then exit before heavy work if there is no work or the blocker is unchanged. Do not reactivate paused automations without the user and do not create schedulers automatically. This guidance does not create a loop where none exists.
