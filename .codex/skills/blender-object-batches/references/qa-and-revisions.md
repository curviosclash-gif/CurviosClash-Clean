# Batch QA and Revisions

## Acceptance Layers

Validate in this order:

1. contract structure and lifecycle state;
2. manifest count, IDs, seeds, roles, bounds, and effective contract hash;
3. family identity and design-space coverage;
4. per-asset topology, normals, materials, bounds, origin, collision, animation, and exports;
5. batch budgets, duplicate fingerprints, missing files, and outliers.

Use identical camera, lighting, framing, and background for comparison renders. Prefer one labeled contact sheet over ten separate explanations.

## Machine Report

Run:

```powershell
$skillDir = (Resolve-Path '<absolute path to blender-object-batches>').Path
python (Join-Path $skillDir 'scripts/validate_batch.py') --manifest variants.json --generation-report batch/generation-report.json
```

The validator checks required output roles, files, metrics, `_min` and `_max` budgets, roundtrip evidence, duplicate parameter sets, and duplicate fingerprints. It writes `qa-report.json` and exits nonzero when acceptance fails.
For roundtrip evidence, it checks only the generator-reported `roundtrip_import` metric. The generator must perform the actual Blender re-import described in [generator-interface.md](generator-interface.md); the validator cannot establish it from a boolean alone.

Object-specific skills remain responsible for meaningful domain metrics. For example, a tree generator may report crown-width ratios and branch hierarchy checks, while a vehicle generator may report wheelbase, sockets, and collision roles.

## Revision Scope

Compile the revised contract to a second manifest, then run:

```powershell
$skillDir = (Resolve-Path '<absolute path to blender-object-batches>').Path
python (Join-Path $skillDir 'scripts/compare_manifests.py') old-variants.json new-variants.json --output regeneration-plan.json
```

- Regenerate changed and added IDs.
- Re-export all current IDs when the output contract changes.
- Revalidate all current IDs when budgets or QA rules change.
- Regenerate the family when invariants, the build profile, or generator provenance changes.
- Report removed IDs as candidates; do not delete them automatically.

Stop automatic retries after one corrective regeneration of the same failure. Diagnose the shared cause before another batch run.

## User Report

Report only the contract hash, requested/generated/passed counts, output paths, metric ranges, and failed or exceptional IDs. Keep the manifest, generation details, and full QA evidence in files.
