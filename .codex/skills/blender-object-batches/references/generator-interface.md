# Generator Interface

An object-specific generator module must expose matching identity constants and one function:

```python
GENERATOR_ID = "wooden-crate-generator"
GENERATOR_VERSION = "1.0.0"

def build_variant(context: dict) -> dict:
    ...
```

The script at `Join-Path $skillDir 'scripts/run_batch.py'` imports the module once and calls this function for every selected variant. Resolve `$skillDir` to the absolute skill directory and run it through Blender when the generator imports `bpy`.

The runner refuses a module whose ID or version differs from `manifest.provenance`. Increment the generator version whenever a code change can alter outputs.

## Context

The context contains:

- `id`, `index`, `role`, `seed`, and `parameters`;
- `invariants`, `build_profile`, `outputs`, `budgets`, and `provenance`;
- `contract_hash` and an absolute per-variant `output_dir`.

Seed every stochastic subsystem from `context["seed"]`. Do not read randomness from global time or process state. Treat the context as read-only.

## Return Value

Return only these optional fields:

```json
{
  "outputs": [
    {"role": "editable", "path": "crate-v01/source.blend"},
    {"role": "runtime", "path": "crate-v01/runtime.glb"}
  ],
  "metrics": {
    "triangles": 8420,
    "materials": 2,
    "file_size_bytes": 420000,
    "roundtrip_import": true,
    "fingerprint": "optional-geometry-or-export-hash"
  },
  "warnings": [],
  "metadata": {}
}
```

Paths may be absolute or relative to the batch output directory. Report metrics using the same base name as contract budgets: `triangles_max` checks `metrics.triangles`.

Raise an exception for a failed variant. The runner isolates the failure, records it, and continues unless `--fail-fast` was requested.

`roundtrip_import` is a claim made by this generator, not a check performed by `validate_batch.py`. Report it as `true` only after importing each required runtime export into a fresh, empty Blender scene and comparing the exported geometry count, bounds, materials, and required animation data with the source. Leave it false or absent on failure, and include the specific mismatch in the exception or warnings. A structural GLB parse alone does not satisfy the roundtrip check.

## Targeted Runs

Use `--only object-v03,object-v08` to rebuild selected IDs. Preserve the original manifest, IDs, and seeds. After generation, validate the new report and merge accepted outputs through the target project's normal asset workflow.
