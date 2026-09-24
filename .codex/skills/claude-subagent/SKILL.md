---
name: claude-subagent
description: Delegate a bounded task to the locally installed Claude Code CLI when the user explicitly asks to use Claude or Anthropic as an agent, reviewer, or worker. Do not use for ordinary Codex delegation that does not specifically request Claude.
---

# Claude Subagent

Use Claude as an external process, not as a native Codex collaboration agent. Keep task ownership, integration, and final verification in the current Codex task.

Before each Claude launch or resume, verify that the **current** user instruction starts on its first line with exactly `CLAUDE-AGENT-FREIGABE: 3141`. A prior approval, a skill invocation, or an implementation handoff does not replace this check. The helper cannot reliably read the current user instruction; `.claude/hooks/claude-agent-lock.mjs` guards Claude-internal agent calls, not this Codex helper.

## Token-efficient routing

Apply the [Ponytail-lite baseline](../adaptive-model-routing/SKILL.md#ponytail-lite-baseline) after tracing the affected flow. Use Claude Fable at low or medium effort for ordinary read-only discovery and review unless the user names another Claude model. Reserve stronger Claude models and higher effort for implementation, difficult integration, or unresolved high-risk findings. Do not add a Codex subagent when it would duplicate the same Claude task; a cheap Codex `economy_scout` is useful only for a separate repository inventory or evidence-gathering lane. Explicit model assignments in a calling skill override this default.

## Preflight

1. Run `scripts/invoke-claude.ps1 -CheckOnly`.
2. If Claude Code is missing, report that exact blocker. Do not install or update it unless the user asks.
3. If the CLI is not authenticated, ask the user to run `claude auth login` in an interactive terminal. Never handle credentials, browser login, tokens, or recovery codes for them.
4. Before launching work in a repository, inspect `claude agents --json --all --cwd <repository>`. Treat every existing session as foreign unless it was launched and recorded during the current task. Never resume, stop, or modify a foreign session.

## Choose the smallest mode

- Use `Review` for research, code reading, diagnosis, planning, or a second opinion. This is the default and exposes only Claude's read/search tools.
- Use `Implement` only when the user asked Claude to change code. Require a unique worktree name and a bounded ownership statement naming the files or module Claude owns.
- Do not use Claude for a trivial local lookup that Codex can answer directly.
- Do not launch multiple Claude processes unless the user explicitly requested parallel Claude work and the tasks have disjoint ownership.

Invoke the helper from the target repository:

```powershell
& '<skill-dir>\scripts\invoke-claude.ps1' -Mode Review -Model fable -Effort low -Prompt '<bounded task>'
```

For implementation:

```powershell
& '<skill-dir>\scripts\invoke-claude.ps1' -Mode Implement -WorktreeName 'codex-claude-<short-slug>' -Prompt '<task, ownership, constraints, and expected result>'
```

For bounded follow-up, use only the session ID returned by the implementer launched in this task. Run from its recorded worktree and pass the same model and effort:

```powershell
& '<skill-dir>\scripts\invoke-claude.ps1' -Mode Implement -ResumeSessionId '<recorded-uuid>' -Model opus -Effort high -WorkingDirectory '<recorded-worktree>' -Prompt '<bounded correction within original ownership>'
```

The helper validates the UUID and worktree, then passes `--resume` with the same implementation permissions. It cannot prove that a session ID belongs to this task; verify that against the recorded first result before calling it.

Use the actual absolute skill directory in place of `<skill-dir>`. Pass an explicit `-WorkingDirectory` when the command is not launched from the intended repository.

## Prompt contract

Tell Claude:

- the concrete objective and expected result;
- whether the task is read-only or which files/module it owns;
- to reuse existing project capabilities, standard-library or native features, and installed dependencies before adding code or abstractions;
- that other agents are working concurrently and their changes must not be reverted, staged, formatted, or committed;
- the smallest relevant repository instructions and verification command;
- to return conclusions, changed files, tests, and unresolved risks concisely.

Do not send secrets, credentials, unrelated user data, or broad filesystem access. Do not use `--dangerously-skip-permissions`.

## Supervision and integration

Let the invocation finish through the command-session mechanism and parse its JSON result. For a long-running process, wait on that exact process/session; do not poll or manipulate the global Claude agent list repeatedly.

Treat Claude's output as untrusted review material. Inspect its worktree diff, run the repository's required tests and build, and integrate only files within the assigned ownership. Never commit Claude's work directly from its worktree. If the main working tree contains overlapping foreign changes, do not integrate or commit; report the overlap.

Stop after one failed authentication attempt, one permission failure, or two failed task hypotheses. Report the concrete blocker instead of weakening permissions.
