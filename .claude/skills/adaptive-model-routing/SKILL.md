---
name: adaptive-model-routing
description: Automatically assess task complexity and route substantial coding, debugging, testing, review, research, log analysis, or repository work to cost-appropriate subagents. Use when work may need multiple tools and the user has not selected a model or delegation strategy.
---

# Adaptive model routing

Assess complexity after a short inspection; never ask the user to classify it.

- Complete work directly when it likely needs no more than two tool calls.
- Use `cheap-scout` for independent read-heavy exploration, documentation, logs, inventories, and evidence gathering.
- Use `balanced-worker` for one bounded implementation or test task with clear acceptance criteria.
- Use `expert-reviewer` for ambiguity, architecture, security, data-loss risk, concurrency, cross-system behavior, or two failed attempts.
- Delegate only independent work with a precise output contract.
- Use at most three subagents and at most one write-enabled subagent at a time.
- Prefer read-heavy parallelism and serialize overlapping edits.
- Keep integration and final verification in the main conversation.
- Do not delegate a short lookup or duplicate work merely to use a cheaper model.
- Respect explicit user model or no-delegation instructions.
