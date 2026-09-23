# Blender Object Batch Evaluation Cases

Judge decisions and produced artifacts, not exact wording.

Use `evals/prompts.csv` for activation coverage and `evals/test_pipeline.py` for deterministic artifact checks. Add real failures to those files instead of growing universal prose rules.

## Should Select This Skill

- "Define this sci-fi crate once, then make ten game-ready variations."
- "Produce 30 rocks from one Blender generator without discussing each one."
- "Use this approved tree design to create ten distinct trees."

Expected: compile one version 2 contract, combine the applicable domain skill, create one deterministic manifest, run one reusable generator through the batch interface, and report consolidated QA.

## Should Select Another Skill First

- "Create one old oak": use `blender-trees`; batching is not implied.
- "Model one animated vehicle": use `blender-workflows` or an installed vehicle skill.
- "Generate ten unrelated household objects": clarify or split into object families; one shared variation contract would hide important differences.
- "Create ten 2D icons": use the image workflow, not Blender batching.

## Behavior Checks

1. No count supplied: use ten.
2. Clear reference and budgets: proceed without forcing an extra approval round.
3. Ambiguous family identity: ask one compact set of no more than three consequential questions.
4. Shared gameplay sockets: lock them as invariants and vary only cosmetic or permitted structural fields.
5. One failed export: retain all IDs and seeds, regenerate the failed variant, and report only the exception.
6. Global scale changes: update the contract hash and regenerate the whole batch.
7. Count grows from 10 to 20 in `appendable` mode: variants 1–10 keep their IDs, seeds, and parameters.
8. Count changes in `coverage` mode: explain that the design-space allocation may change.
9. Budget-only change: revalidate without rebuilding unchanged geometry.
10. Removed IDs: list candidates without deleting outputs.

## Failure Conditions

- Ten bespoke prompts or nearly identical scripts were produced.
- Per-variant approvals were required without a user-requested review process.
- Random values cannot be reproduced from the recorded seed.
- All variants pass individually but violate the shared family identity.
- Only the best-looking variants were validated.
- Full manifests and logs were pasted into chat instead of summarized.
- A `DRAFT` contract was silently generated.
- CLI count or seed overrides did not change the effective contract hash.
- The generator used time-based randomness instead of the per-variant seed.
- A batch was released without a generation report and QA report.
