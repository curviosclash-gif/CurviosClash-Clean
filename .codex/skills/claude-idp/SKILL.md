---
name: claude-idp
description: Turn an idea into an approved implementation prompt with Claude Fable at medium effort for bounded brainstorming and independent review. Invoke only when the user explicitly requests $claude-idp.
---

# Claude IDP

Run the gated [IDP workflow](../idp/SKILL.md) with Claude Fable as an external read-only planning partner. Read that skill completely when invoked and preserve all of its Plan-mode, concept-approval, prompt, and implementation gates. This skill changes the planning roles, not the user's authorization.

Before every Claude planning or review call, require `CLAUDE-AGENT-FREIGABE: 3141` as the exact first line of the current user instruction. The Claude Subagent helper cannot verify this itself, and the Claude-internal hook does not guard Codex's helper calls. If the current instruction lacks the line, continue only local IDP work.

## Token-efficient delegation

Apply the [Ponytail-lite baseline](../adaptive-model-routing/SKILL.md#ponytail-lite-baseline) to scope and technical approaches without weakening IDP approval gates. Fable Medium is already the weaker delegated planning role for this workflow. Use a separate Codex `economy_scout` only when `TIEF` needs an independent repository inventory that can run without duplicating Fable's analysis. Keep scope decisions, concept integration, approval, and the final prompt in the root task. Do not escalate beyond Fable Medium unless the user changes the model assignment.

## Preflight

Read [Claude Subagent](../claude-subagent/SKILL.md) and run its `scripts/invoke-claude.ps1 -CheckOnly`. Inspect `claude agents --json --all --cwd <repository>` and leave every pre-existing session untouched. If authentication, quota, or the `fable` model is unavailable, continue IDP locally only after telling the user that the Claude pass was skipped; never substitute another Claude model silently.

## Claude planning pass

Do not call Claude in `SCHNELL`. In `STANDARD`, call it once only when materially different variants remain useful. In `TIEF`, call it once after the local project inspection and before presenting variants.

Invoke the shared helper in `Review` mode with `-Model fable -Effort medium`. Give Claude the idea, depth, relevant read-only repository context, constraints, assumptions, and open decisions. Ask for compact JSON-shaped content containing distinct variants, reuse opportunities, risks, and missing decisions. Claude may inspect but never edit the repository.

Codex remains the facilitator: remove duplicates, reject scope expansion, and present only useful variants to the user. Claude cannot select or approve a concept.

## Independent prompt review

After `FREIGEGEBENER STAND`, draft the standalone implementation prompt locally. Then start a separate Fable Medium `Review` invocation with the locked concept and draft prompt. Ask only for contradictions, missing non-goals, untestable acceptance criteria, incorrect repository assumptions, and implementation ambiguity.

Apply corrections that preserve the concept lock. If a finding changes a locked decision, reopen concept approval instead of accepting it silently. Present the corrected `FINALER IMPLEMENTIERUNGSPROMPT` and state that it has not been executed.

## Implementation handoff

Concept approval does not authorize implementation. After the user explicitly says `UMSETZEN` and Plan mode has ended, read and execute [Claude Plan & Umsetzung](../claude-plan-umsetzung/SKILL.md), passing the complete locked state and final prompt. Do not request another plan approval.

While active, retain the IDP workflow-state line required by the base skill.
