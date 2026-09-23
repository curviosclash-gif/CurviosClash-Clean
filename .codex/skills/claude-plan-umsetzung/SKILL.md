---
name: claude-plan-umsetzung
description: Plan and review an explicitly authorized implementation with Claude Fable at medium effort, and implement it with Claude Opus 5 at high effort in an isolated worktree. Invoke only when the user explicitly requests $claude-plan-umsetzung.
---

# Claude Plan Umsetzung

Coordinate three sequential external Claude roles while Codex retains scope, integration, verification, and commit responsibility:

1. planner: Claude `fable`, medium effort, read-only;
2. implementer: Claude `opus`, high effort, isolated Git worktree;
3. reviewer: a fresh Claude `fable`, medium effort, read-only.

The requested implementation model is Opus 5. Use the locally supported `opus` alias, then require the successful result's `modelUsage` to identify an Opus 5 model. If it does not, stop before integration and report the mismatch; never substitute another model silently.

## Token-efficient delegation

Apply the [Ponytail-lite baseline](../adaptive-model-routing/SKILL.md#ponytail-lite-baseline) to both plan and implementation while preserving all authorization, worktree, test, review, and integration requirements. The assigned Fable Medium planner and reviewer are the low-cost roles; do not add parallel agents that repeat their work. Use a Codex `economy_scout` only for a distinct repository inventory or test-log evidence lane. Opus 5 High is reserved for the single implementation lane as explicitly configured by this skill. Root receives compact conclusions and evidence rather than full transcripts.

## Authorization and preflight

`$claude-plan-umsetzung <task>` authorizes the full workflow. A request for a plan only remains read-only and stops after planning. A completed IDP prompt still requires a later explicit `UMSETZEN` command.

Read [Claude Subagent](../claude-subagent/SKILL.md), run its `scripts/invoke-claude.ps1 -CheckOnly`, read applicable repository instructions, and inspect repository status plus `claude agents --json --all --cwd <repository>`. Leave all pre-existing sessions untouched. Stop on authentication, quota, model, permission, overlapping-change, or shared-resource blockers; do not weaken safeguards.

## Plan with Fable Medium

Invoke the shared helper with `-Mode Review -Model fable -Effort medium`. Provide the complete approved scope, relevant repository context, foreign-change constraints, and acceptance criteria. Require a compact plan containing root cause or approach, owned files, smallest viable change, tests/build, risks, and explicit non-goals.

Codex checks that the plan stays within the authorized scope. If it changes a locked IDP decision, stop and return to concept approval. For plan-only requests, present the verified plan and finish here.

## Implement with Opus 5 High

Choose a unique worktree name beginning `codex-claude-`. Give Opus exclusive ownership of the named files or module and tell it that other agents' changes are untouchable. Invoke:

```powershell
& '<claude-subagent-dir>\scripts\invoke-claude.ps1' -Mode Implement -Model opus -Effort high -WorktreeName '<unique-name>' -WorkingDirectory '<repository>' -Prompt '<bounded implementation task>'
```

The implementation prompt must require reuse of existing project capabilities, standard-library or native features, and installed dependencies before introducing new code, abstractions, or dependencies.

Do not permit Claude to commit, push, stash, reset, rebase, or edit outside its ownership. Record the returned Claude session ID and identify the newly created worktree using `git worktree list --porcelain`; never infer it from another existing worktree. Inspect `modelUsage` before accepting the result as Opus 5.

## Review with a fresh Fable Medium session

Run the helper in `Review` mode with `-Model fable -Effort medium` and `-WorkingDirectory` set to the new worktree. Supply the approved plan, acceptance criteria, changed-file list, test evidence, and a bounded diff summary. Require one verdict:

- `freigegeben` with supporting evidence;
- `nacharbeit` with concrete, bounded corrections;
- `hindernis` with the blocking cause.

The reviewer must inspect the actual files and must not rely only on the implementer's summary. It may not edit anything.

For bounded remediation, resume only the recorded Opus implementer session from its worktree with the same model, effort, permissions, ownership, and Git prohibitions. Review again with the same Fable reviewer role only when new evidence exists. Stop after two unsuccessful remediation cycles.

## Integrate and finish

Codex independently inspects the worktree diff, verifies only owned files changed, and runs the repository-required tests and build. Integrate without overwriting foreign main-tree changes. Follow repository commit rules; Claude never creates the final commit. Do not remove the worktree or temporary artifacts without the authorization required by repository rules. Report models used, changed files, checks, review verdict, and any remaining risks.
