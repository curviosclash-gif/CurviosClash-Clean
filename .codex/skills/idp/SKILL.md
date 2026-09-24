---
name: idp
description: Turn a rough product, feature, game, map, asset, or creative idea into a user-approved concept and a standalone implementation prompt through a gated Plan-mode workflow. Use when the user invokes `$idp`, starts with `IDEE:`, explicitly asks for idea-to-prompt development, or wants brainstorming before implementation. Support `SCHNELL`, `STANDARD`, and `TIEF` depths. Do not use for direct implementation requests that do not ask for ideation or this workflow.
---

# IDP - Idea to Prompt

Develop an idea without mixing ideation and implementation. Keep the workflow concise, explicit, and reversible until the user authorizes implementation.

## Token-efficient delegation

Apply the [Ponytail-lite baseline and model mapping](../adaptive-model-routing/SKILL.md) to scope and proposed implementation approaches without reducing brainstorming or approval gates. For `SCHNELL`, work locally. For `STANDARD`, delegate only a genuinely independent read-heavy question whose answer changes the variants. For `TIEF`, consider one `gpt-6-luna` scout with low reasoning and `fork_turns: none` for repository discovery, comparable-system inventory, or evidence gathering when the context gain exceeds handoff cost; give it a narrow output contract and integrate only its conclusions. Keep clarification, creative synthesis, concept approval, and the final prompt in the root task. Use an independent `gpt-6-sol` reviewer with increased reasoning only for material architecture, security, data-loss, concurrency, or repeated-failure risk, when delegation is allowed.

## Start the workflow

If the user invokes `$idp` without an idea, ask only for the idea. Do not request a mode switch yet.

When an idea is present:

1. Summarize it in one to three sentences.
2. Identify only decisions that materially affect the result.
3. Use the explicitly requested depth or default to `STANDARD`.
4. Preserve intentional ambiguity for brainstorming instead of inventing hidden requirements.

Allow the user to change depth before concept approval:

- `SCHNELL`: Skip optional brainstorming, ask only blocking questions, and produce the smallest useful concept.
- `STANDARD`: Offer two or three distinct variants when brainstorming is useful.
- `TIEF`: Inspect relevant project context read-only and compare three or four variants with more technical detail.

## Enforce the Plan-mode boundary

Require Plan mode before brainstorming or developing the concept. Capturing and summarizing the initial idea may happen before the switch. If Plan mode is not active and ideation work remains, ask the user to switch to Plan mode and stop before brainstorming. Never claim to change the mode yourself.

While in Plan mode:

- Inspect existing project context only when it materially improves the concept; keep inspection read-only.
- Do not edit files, generate assets, run mutating commands, build into tracked output, commit, publish, or begin implementation.
- Use the user's language unless requested otherwise.

## Limit clarification

Ask at most three short, material questions in one turn. Ask only when the answer changes scope, user experience, architecture, cost, risk, or acceptance criteria. Continue with clearly labeled assumptions when a safe default exists. Never turn minor uncertainty into an interrogation.

## Brainstorm only when useful

Brainstorm when multiple materially different directions are plausible or when style, experience, mechanics, scope, assets, or technical strategy remain undecided. Skip it for a precise idea or in `SCHNELL` mode and say so briefly.

Offer two to four genuinely distinct variants according to the selected depth and the idea's breadth. Compare them compactly using the relevant columns from:

| Variant | Experience or benefit | Mechanics, assets, or approach | Existing-system reuse | Effort | Main risk |
| --- | --- | --- | --- | --- | --- |

Recommend one variant with a concrete reason, but leave the decision to the user. Accept `VARIANTE B`, `KOMBINIERE A UND C`, `ÄNDERE VARIANTE B: ...`, `NEUE VARIANTEN`, `BRAINSTORMING ÜBERSPRINGEN`, `SCHNELL`, `STANDARD`, `TIEF`, and `ABBRECHEN`.

## Develop the concept

Turn the selected direction into a concrete concept containing only relevant sections from:

- working title, objective, and intended experience;
- visual style, atmosphere, structure, and progression;
- mechanics, routes, interactions, assets, and animations;
- reuse of existing project systems;
- technical boundaries, performance needs, and risks;
- explicit assumptions and non-goals;
- measurable acceptance criteria.

Prefer existing product systems and the smallest viable scope. Do not silently broaden the idea.

## Approve and lock the concept

Show the concept in chat and wait for `FREIGEBEN` or an equally explicit approval. Support `ÄNDERE: ...`, `MEHR DETAILS ZU: ...`, `ZURÜCK ZUM BRAINSTORMING`, `NEUE VARIANTE`, and `ABBRECHEN`.

After approval, record a concise `FREIGEGEBENER STAND` containing the core decisions, scope, assumptions, non-goals, and acceptance criteria. Treat this as the concept lock. Do not create the final prompt before approval.

If the user changes a locked core decision, reopen the concept phase, update the concept, invalidate any previous final prompt, and request approval again. Minor wording changes that do not alter meaning may remain within the lock.

## Produce and verify the final prompt

After concept approval, write a standalone prompt that another Codex task can execute without the preceding conversation. Include:

1. objective and approved concept;
2. functional and visual requirements;
3. relevant asset and animation requirements;
4. technical constraints and existing systems to inspect or reuse;
5. allowed scope, assumptions, and explicit non-goals;
6. performance and resource-lifecycle expectations;
7. required tests, build steps, and measurable acceptance criteria;
8. applicable repository instructions and commit requirements;
9. as its final section, `Modellnutzung` with the recommended available model and reasoning effort for implementation and verification, what each model handles, and an objective trigger for switching. A recommendation does not change the active model or authorize delegation.

Before presenting it, verify that:

- scope and target environment are unambiguous;
- requirements do not contradict each other;
- assumptions and non-goals are visible;
- acceptance criteria are observable or testable;
- tests and build steps match the risk and target surface;
- current repository instructions remain authoritative.

Resolve correctable gaps silently. Ask one blocking question only when the prompt would otherwise direct materially different work.

Label the result `FINALER IMPLEMENTIERUNGSPROMPT`, format it as one copy-ready block, and state that it has not been executed.

## Enforce the implementation gate

Treat concept approval and implementation approval as separate permissions. Do not implement because the user approved the concept or requested the final prompt.

Begin implementation only when both conditions are true:

- the user explicitly writes `UMSETZEN` or gives an equally unambiguous command after seeing the final prompt;
- Plan mode has ended and the task is in an implementation-capable mode.

If `UMSETZEN` arrives while Plan mode is active, ask once for the mode switch, preserve the approved prompt, and make no edits. If the implementation request also changes locked scope, reopen concept approval first.

Before the first implementation mutation:

Only after the explicit implementation command and the end of Plan mode, read and
execute [IDP Execution Router](../idp-execution-router/SKILL.md). Pass the complete
`FINALER IMPLEMENTIERUNGSPROMPT` and `FREIGEGEBENER STAND` from the conversation,
including scope, assumptions, non-goals, and acceptance criteria. Preserve the
existing implementation authorization instead of requesting another plan approval.
The linked skill chooses the smallest safe route from direct root work through
bounded discovery or implementation agents to independent review. Applicable
repository rules for tests, builds, commits, shared resources, and unrelated changes
remain authoritative.

## Show compact workflow state

Only while an IDP workflow is active, end each response with one concise line:

`Phase: <IDEE|BRAINSTORMING|KONZEPT|FREIGABE|FINALER PROMPT|UMSETZUNG> · Tiefe: <SCHNELL|STANDARD|TIEF> · Nächster Schritt: <valid action>`

Stop showing the line after completion or `ABBRECHEN`.
