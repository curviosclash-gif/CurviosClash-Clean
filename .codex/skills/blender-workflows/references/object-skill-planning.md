# Organizing Blender Subskills and Routing

Use this workflow when a Blender domain or reusable operation deserves a subskill, or demonstrated routing problems justify a routing skill. The user has authorized necessary creation as part of ongoing Blender-skill improvement. Proceed within that scope without another approval gate; ask only when a consequential requirement cannot be inferred. The user's current request takes precedence.

## Purpose and Boundary

A specialized skill should capture repeatable object-domain decisions that the general Blender workflow cannot express cheaply. It should not be a record of one model, a project diary, or an excuse to create folders before the workflow is understood.

First inspect installed Blender skills and their descriptions. Choose one outcome:

1. **Use general workflow** — ordinary or one-off asset.
2. **Reuse an installed skill** — its boundary already covers the object.
3. **Extend an installed skill** — new cases share the same core domain and validation.
4. **Create a narrow subskill** — stable domain or operational decisions justify an independent trigger and acceptance checks.
5. **Add routing** — demonstrated ambiguity or unnecessary context loading remains after clarifying existing descriptions and links.

## Scope Before Writing

Infer scope, representative requests, outputs, and acceptance criteria from the task and available evidence. A single new object does not justify a subskill. A distinct reusable workflow, repeated domain-specific decisions, or a demonstrated context/routing problem can justify one. Use a short commentary update to explain a justified split and continue; Plan mode is optional unless the user requests planning before implementation.

Inspect relevant references, existing assets, target engine conventions, and nearby skill descriptions before asking questions. Ask only questions whose answers materially change the skill. Prefer one compact round; continue independent work while a needed answer is pending.

## Explain a Justified Split

Explain briefly, using only the relevant items:

- one recommended skill scope;
- up to two real alternatives, such as a narrower first skill or an extension of an installed skill;
- why each option changes triggers, reusable resources, or maintenance;
- the recommended name in lowercase hyphen case, usually `blender-<object-class>`;
- what should remain in `blender-workflows`.

Avoid an artificial choice when only one scope is sensible. If a one-off object does not justify a skill, say so and continue with the general workflow.

## Agreement Questions

Resolve the smallest useful set:

1. **Scope:** Which objects belong, and which nearby objects do not?
2. **Use cases:** What 2–3 representative tasks should activate the skill?
3. **Output contract:** Editable `.blend`, generators, node groups, GLB or FBX, LOD, collision, rig, animation, previews, or engine integration?
4. **Visual contract:** Realistic or stylized, reference sources, scale, material fidelity, allowed variation?
5. **Technical contract:** Blender versions, renderer, engine, budgets, naming, units, axes, and required extensions?
6. **Authoring method:** Direct modeling, `bpy`, Geometry Nodes, sculpting, simulation, or hybrid?
7. **Acceptance:** What visual, structural, runtime, and roundtrip checks define success?

Infer routine details from existing project conventions. Do not ask the user to choose implementation trivia that does not affect the result.

## Proposal Format

Before writing files, show a compact proposal:

```text
Skill: blender-<object-class>
Purpose: <one sentence>
Triggers: <phrases and tasks that should activate it>
Non-triggers: <nearby requests that stay elsewhere>
Representative use cases:
- <case 1>
- <case 2>
- <case 3, if useful>
Inputs: <references, files, dimensions, engine contract>
Outputs: <editable and runtime artifacts>
Method: <direct, bpy, Geometry Nodes, or hybrid>
Resources: <only justified references, scripts, or assets>
Validation: <observable checks and forward test>
```

For the authorized Blender scope, this is a concise design check, not a mandatory approval form or saved process artifact. Ask for a decision only when the scope remains materially ambiguous or would extend beyond the user's authorization.

## Creation and Routing

Use `skill-creator` and follow its complete instructions.

- Install subskills as normal sibling `blender-<domain-or-operation>` skills, not hidden nested packages. Give each a discriminating trigger, inputs, outputs, and acceptance checks.
- Prefer routing in the existing caller over a new router. Create a standalone routing skill only when multiple real destinations require shared selection logic and it removes demonstrated duplication or unnecessary context loading.
- A router contains concise request-to-destination rules, selection priority, and a fallback to `blender-workflows` for general Blender work. Non-Blender requests leave this family. It does not copy modeling procedures or load every destination to decide.
- Route directly to a specialist; avoid router-to-router chains and cycles. A specialist may read a shared reference, but must not route back to the router. Batches may combine their orchestration with one applicable domain skill; that is composition, not a routing loop.
- Keep exactly one owner for shared checks and link it at the relevant execution point. Describe any required sibling dependency and report a missing dependency rather than silently omitting QA.
- Update incoming links and affected descriptions/evaluation cases in the same maintenance pass. Preserve existing invocation policy. Do not create scaffolds for hypothetical future domains.
- Skill routing does not authorize spawning agents or switching models.

- Create the skill in the user's personal skills directory unless a repository or plugin destination was approved.
- Keep `SKILL.md` concise and route conditional detail to focused references.
- Put deterministic repeated logic in scripts and test those scripts.
- Include assets only when they are genuine reusable output resources, such as a validated node-group library or starter `.blend`.
- Write a short discriminating description with the primary trigger first and an important boundary when needed.
- Preserve implicit invocation unless explicit-only behavior was requested.
- Do not create README files, status copies, placeholder examples, or speculative folders.

## Acceptance Gate

The new specialized skill is complete only when:

- `quick_validate.py` passes;
- there are no scaffold placeholders;
- every reference is linked from `SKILL.md` with a loading condition;
- every script compiles and has been exercised on a representative fixture;
- at least one realistic positive prompt follows the intended workflow;
- at least one nearby negative prompt does not misroute to the skill;
- changed routing selects the correct destination for a positive case, an overlapping/ambiguous case, and an out-of-scope case, without cycles or loading all destinations;
- shared QA remains reachable from every affected workflow;
- the final report links the skill and names any deliberate limitation.

Create an independent forward test only when the skill is complex enough to justify it and delegation is available and authorized.

## Evolution

Improve specialized and routing skills through the shared [improvement cycle](iterative-improvement.md). Prefer narrow corrections to accumulating rules. If two skills converge on the same trigger and workflow, consolidate overlapping guidance and clarify descriptions within the authorized scope; preserve entry points in use and do not delete skill folders without authorization.

## Official OpenAI Guidance

- [Codex best practices: Plan mode and reusable skills](https://developers.openai.com/guides/best-practices)
- [Creating skills](https://developers.openai.com/docs/build-skills)
