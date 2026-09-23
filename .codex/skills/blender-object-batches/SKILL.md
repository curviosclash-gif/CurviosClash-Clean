---
name: blender-object-batches
description: Create batches of Blender object variations from one approved brief using a reusable object contract, deterministic parameter manifests, and consolidated QA. Use when one asset family should produce multiple variants with minimal repeated discussion.
---

# Blender Object Batches

Turn one agreed object definition into a coherent, reproducible family of Blender assets. Default to ten variants unless the user gives another count.

This skill coordinates variation; it does not replace domain modeling knowledge. Combine it with `blender-trees` for trees, `blender-plants` for other vegetation, or another installed object-specific skill. Otherwise use `blender-workflows`. Do not create a new specialist skill merely because a batch is requested.

## Model approval

Run manifest generation, Blender production, validation, and ordinary triage with deterministic scripts or the least costly adequate non-Astra model. Never intentionally select or delegate to `gpt-6-astra` without explicit user approval for that specific use in the current task. If Astra appears necessary or materially useful for novel architecture, unresolved failures, or final review, briefly explain the concrete advantage and ask before invoking it. Without approval, use the strongest suitable non-Astra route and keep every batch QA gate unchanged.

## Iterative improvement

Before every final response, run the short [final learning gate](../blender-workflows/references/final-learning-gate.md), including when all QA passed. If it finds no verified reusable lesson, do not change any skill. If it finds a candidate, read [the improvement cycle](../blender-workflows/references/iterative-improvement.md), update and validate the smallest owner before delivery. Verify one affected variant before scaling; preserve IDs/seeds and follow [revision scope](references/qa-and-revisions.md) for shared changes. Own batch orchestration here, domain rules in the domain skill. Load only relevant references.

## Use One Controlled Pipeline

Move the batch through these states:

`DRAFT -> CONTRACT_LOCKED -> PROTOTYPE_APPROVED -> GENERATED -> VALIDATED -> RELEASED`

Use `REVISION_REQUIRED` after a failed generation or validation. A precise request may move directly from `CONTRACT_LOCKED` to generation; do not force a prototype approval when the reference and acceptance criteria are already sufficient.

Keep operational manifests and reports outside a product repository when its instructions prohibit generated process artifacts. Pass explicit output paths to the batch scripts, retain the evidence for the current run, and commit only deliverables the project permits. Never delete temporary artifacts without the project's required authorization.

Each stage produces one machine-readable artifact:

1. object contract;
2. compiled variant manifest;
3. generation report;
4. QA report;
5. optional regeneration plan after revisions.

Read [references/lifecycle-and-layout.md](references/lifecycle-and-layout.md) when setting up a new batch directory or changing its state.

## Compile One Object Contract

Infer as much as possible from the conversation and references. Ask at most one compact group of up to three questions, and only for choices that would materially change the batch.

Save the result as a version 2 JSON object contract containing:

- immutable identity, silhouette, scale, origin, axes, style, and required features;
- parameters allowed to vary, including ranges or choices and any correlations;
- target format, runtime budgets, naming, acceptance checks, and provenance;
- batch count, root seed, and either `appendable` or `coverage` sampling.

Read [references/object-contract.md](references/object-contract.md) when creating or changing the contract. Adapt [assets/object-contract.example.json](assets/object-contract.example.json) and validate against [assets/object-contract.schema.json](assets/object-contract.schema.json) instead of inventing a new format.

Do not repeat the full specification in later chat messages. Refer to the saved contract and its hash, then report only decisions, exceptions, and results.

## Lock the Canonical Design

When the shape or art direction is uncertain, generate one representative prototype before the full batch and obtain approval. Never require separate approval for every variant. Variant 1 is canonical by default; named design roles may override selected variants for compact, tall, material, detail, or other deliberate coverage targets.

Keep all variants inside the same object family. Vary proportions, construction details, materials, wear, pose, or procedural features only where the contract allows it. Preserve gameplay dimensions, sockets, collision roles, and semantic identity when they are locked.

## Generate the Batch

1. Run `scripts/generate_variant_manifest.py` on the locked contract. Use one root seed and stable variant IDs.
2. Drive one reusable `bpy` generator, Geometry Nodes asset, or existing procedural source through `scripts/run_batch.py`. Its module must expose `build_variant(context)` as defined in [references/generator-interface.md](references/generator-interface.md).
3. Share meshes, node groups, materials, and textures where the target runtime benefits from reuse. Make objects unique only where geometry must diverge.
4. Use `coverage` for a fixed batch with maximum range coverage. Use `appendable` when later variants must not change existing parameter assignments. Correlate dependent numeric parameters with `strata_group`; use `invert` for inverse relationships.
5. Preserve each variant's ID and seed across revisions. Regenerate only affected or failed variants unless a contract-wide invariant changed.

Example:

```powershell
python scripts/generate_variant_manifest.py assets/object-contract.example.json --output variants.json
```

Then run a domain generator inside Blender:

```powershell
blender --background --python scripts/run_batch.py -- --manifest variants.json --generator object_generator.py --output-dir batch
```

The scripts write compact operational summaries. Keep detailed parameters and logs in artifacts, not in chat.

## Validate Once, Report Once

Run `scripts/validate_batch.py` against the manifest and generation report. Inspect every variant programmatically, but consolidate results into one short report. Include:

- contract hash, count, seeds, output paths, and failed variant IDs;
- min/max/median geometry budgets and any outliers;
- one consistent contact sheet or multi-view overview;
- only material, silhouette, collision, animation, or export deviations that need action.

Use the scene inspection, multi-view rendering, and GLB validation helpers from `blender-workflows` where applicable. Read [references/qa-and-revisions.md](references/qa-and-revisions.md) for batch acceptance and targeted revision rules.

`validate_batch.py` checks the generator's `roundtrip_import` claim; it does not import a GLB itself. Set that metric to `true` only after an actual re-import into an empty Blender scene and comparison of the required geometry, bounds, materials, and animation data. A reported boolean without that check is not roundtrip evidence.

After a contract revision, compile a new manifest and run `scripts/compare_manifests.py` to determine which IDs need generation, re-export, or validation. Never delete removed candidates automatically.

When changing this skill, run `evals/test_pipeline.py` and use [references/eval-cases.md](references/eval-cases.md) plus `evals/prompts.csv` to check routing and observable behavior.

Do not claim success from generation alone. Check every output, but avoid dumping full manifests or logs into the conversation unless the user asks.

## Keep Token Cost Low

- One contract replaces repeated prose; one generator replaces per-variant code.
- Use defaults for reversible details and ask only about consequential ambiguity.
- Summarize ranges and outliers instead of describing every successful variant.
- Store decisions in files, then reference paths and hashes rather than restating them.
- Patch changed contract fields instead of reopening the whole design discussion.
- Record generator, Blender, contract, and domain-skill versions so a batch can be reproduced without another explanation.
- Keep ten as the default batch size, not a universal limit.
