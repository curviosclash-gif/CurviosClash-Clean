# Evidence-driven Blender improvement

Use this cycle in all four installed Blender skills after the mandatory [final learning gate](final-learning-gate.md) identifies a verified reusable candidate, or earlier when a failure needs immediate repair. Learning means maintaining instructions and executable checks between tasks; it is not model training or a background process. Read only the applicable skill references so previous corrections influence the next attempt.

## Keep maintenance small and organized

Normal tasks use the selected skill and its task-relevant references. The final learning gate is always required, but load this longer maintenance procedure only when the gate finds a candidate or a concrete trigger appears during work: failed QA, user correction, obsolete or conflicting guidance, or a demonstrated reusable way to reduce work while preserving the result. Do not scan all four skills or unrelated history on every run. No new report or investigation is required when the gate finds no lesson.

The user has requested ongoing improvement of these Blender skills, including necessary subskills and routing skills. When evidence justifies a task-related change, implement and validate it during the task rather than merely proposing it or repeatedly asking for permission. Instructions, scripts, tests, reference organization, and routing may be changed when that is the smallest effective fix. For a justified skill split or new router, follow [skill organization](object-skill-planning.md). Existing permissions and concurrent-work restrictions still apply. Finish the requested artifact; do not turn maintenance into an unrelated rewrite.

Choose the smallest durable location:

| Change | Owner/location |
| --- | --- |
| Decision every task in this skill needs | Short rule or conditional link in its `SKILL.md` |
| Conditional domain detail or version workaround | Relevant existing reference |
| Repeated mechanical operation or measurable invariant | Existing helper and meaningful test |
| Visual judgment or routing failure | Existing behavioral evaluation cases |
| Distinct recurring task with its own inputs, outputs, and QA | Narrow sibling subskill, linked by its caller |
| Demonstrated ambiguous selection or unnecessary context loading | Small routing section; separate routing skill only if that is insufficient |
| One-off artistic preference or temporary environment issue | Current task only, unless a reusable defect is demonstrated |

Keep one authoritative explanation and link to it. Search the owning file and its direct references before adding guidance; broaden the search only if ownership remains unclear. Merge related findings into one coherent maintenance pass. Replace ambiguous or obsolete text instead of continually appending rules. Move growing conditional detail out of `SKILL.md`; create a new reference only for a distinct reusable topic that cannot fit naturally in an existing one, and link it from its decision point. Never create a lesson file per incident or a second index of all rules.

For efficiency improvements without a failure, establish the current behavior, change one mechanism, and verify the same required outputs and QA with fewer repeated reads, tool calls, or generation steps. Do not claim measured token savings without usage evidence. Do not shorten prompts by removing acceptance criteria, data-loss protection, or runtime validation. Reuse already-read unchanged context; batch independent inspections and summarize only actionable differences.

## Repair the current result

1. Establish the requested acceptance criteria and a reproducible baseline: source or generator, seed/variant ID, relevant parameters, Blender/exporter/engine version, and actual failing check or user observation. Reuse existing contracts and QA artifacts. Preserve the last usable source and output before a risky experiment.
2. Distinguish a generation defect, omitted agent step, misleading validator, export/import incompatibility, resource failure, and changed artistic preference. Inspect the artifact at the failing boundary. A timeout, missing executable, or busy process is not evidence that geometry is wrong. A new preference changes this asset's brief, not every future asset.
3. State one testable cause and make the smallest correction at its owner. Keep seed, camera, lighting, scale, and unrelated settings stable for comparison. Repair a collapsed crown in geometry, not with a flattering camera; repair missing runtime data at the export/import boundary, not by suppressing its check.
4. Re-run the failed check against the newly produced artifact, then the relevant neighboring acceptance checks. Compare source, export roundtrip, and target runtime where the defect crosses those boundaries. Inspect renders for visual claims. A zero exit code or generator-reported boolean alone does not establish visual or runtime correctness.
5. If the same failure remains after one corrective attempt, stop repeating that hypothesis and inspect the cause before another run. After two distinct unsuccessful hypotheses, preserve the best artifact and report the remaining uncertainty or missing evidence; continue independent work, but do not run an unbounded regeneration loop or silently escalate models. Resume affected generation only with new evidence or a revised approach. Batch-specific retry limits also apply.

## Persist only verified learning

After a verified repair or improvement, check whether an existing instruction was missing, ambiguous, incorrect, redundant, or simply skipped. Update the smallest existing owner when the correction will change future behavior:

- Shared Blender execution, scene inspection, material/export checks: `blender-workflows`.
- Plant morphology, organ attachment, species profiles: `blender-plants`.
- Tree hierarchy, crown volume, bark, roots, tree LODs: `blender-trees`.
- Contract compilation, reproducibility, regeneration scope, batch validation: `blender-object-batches`.

Use the configured installed skill path, resolving sibling links relative to the skill folder. Update only task-related files and preserve concurrent edits. Maintenance and justified Blender subskills/routers are authorized; unrelated configuration and unrelated skill families are not. Filesystem permissions, user restrictions, and project rules still apply. If the owner is unavailable or cannot safely be edited, report the exact proposed correction as pending rather than claiming it was learned.

Prefer correcting the existing rule or helper to appending a new warning. If an adequate instruction was skipped, improve its placement at the actual decision point or strengthen a check that detects the omission; do not duplicate the instruction across all skills. A single demonstrated failure may justify a narrow correction. Speculation and unverified fixes must not become permanent rules.

For each retained correction, preserve enough information in the existing reference or regression case to make it usable: **trigger and scope; observed defect or inefficiency; verified remedy; observable acceptance check; relevant version limitation**. Omit inapplicable fields rather than adding boilerplate. Keep raw logs, local paths, task transcripts, and temporary before/after renders out of skill instructions and product repositories. Do not create a separate error diary, agent knowledge base, status archive, or placeholder lessons file.

Automate a reproducible invariant in the existing helper/tests when practical. The test should expose the defect before the fix and pass afterward; do not weaken thresholds or replace evidence with hardcoded success. For visual or judgment failures, add a compact behavioral case with required views, expected decisions, and disallowed shortcuts. Label synthetic cases as evaluation scenarios, not historical incidents.

## Validate the learning itself

- Recheck the original failing input and a nearby valid counterexample. For stochastic generation, include another representative seed when relevant; for species-specific rules, check that an intentionally different valid morphology remains allowed.
- Run `skill-creator/scripts/quick_validate.py` on each modified skill, resolving that script from the installed `skill-creator` location. Check reference links. Run affected helper tests; for batch pipeline changes, run `blender-object-batches/evals/test_pipeline.py` as well.
- Use [evaluation cases](eval-cases.md) for behavioral review. A manual scenario walkthrough is not an executed Blender or independent-agent test; report that distinction. Missing Blender/runtime access leaves visual or integration claims unverified.
- Consolidate overlapping rules and replace obsolete advice only when evidence supports the replacement. Scope version-specific workarounds instead of making them universal.
- End with a short account of the repaired result, the skill/check improved, verification performed, and anything still unverified. If no new reusable lesson was demonstrated, do not modify skills merely to show activity.
