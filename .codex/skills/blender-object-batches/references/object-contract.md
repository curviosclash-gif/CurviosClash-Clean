# Object Contract Version 2

Use the contract as the single source of truth for one object family. Validate it with `assets/object-contract.schema.json`; the manifest compiler also rejects unknown or inconsistent fields without external dependencies.

## Sections

- `schema_version`: must be `2`.
- `contract_revision`: increment after an approved contract change.
- `object_id`: stable lowercase family identifier.
- `lifecycle`: current state and optional approved prototype ID.
- `count` and `seed`: default to ten variants and a recorded root seed.
- `sampling`: `appendable` or `coverage`, plus whether variant 1 is canonical.
- `invariants`: identity, scale, axes, origin, sockets, collision roles, and other locked decisions.
- `parameters`: the permitted variation space.
- `design_roles`: optional named variants with deliberate parameter overrides.
- `constraints`: safe conditional corrections applied in listed order.
- `build_profile`: renderer, target engine, LOD policy, texture policy, and other production settings.
- `outputs`: directory rules and required output roles.
- `budgets`: numeric metric names ending in `_min` or `_max`.
- `qa`: required metrics, views, and roundtrip requirements.
- `provenance`: generator, Blender, domain-skill, and source versions.

Adapt `assets/object-contract.example.json` rather than writing the structure from memory.

## Parameter Types

```json
"width": {
  "type": "float",
  "min": 0.8,
  "max": 1.2,
  "precision": 3,
  "canonical": 1.0,
  "strata_group": "overall-size"
}
```

Supported types are `float`, `int`, `choice`, `bool`, and `fixed`. Every type may specify a valid `canonical` value. Without one, the compiler uses the numeric midpoint, the first choice, `false`, or the fixed value.

Give related numeric or discrete parameters the same `strata_group` so they use the same design-space coordinate. Add `invert: true` for an inverse relationship.

## Sampling Modes

- `appendable`: uses index-based low-discrepancy sampling. Increasing the count preserves the parameter values and seeds of existing IDs as long as the parameter space itself did not change.
- `coverage`: uses stratified sampling for the current batch size. It gives tighter coverage and balanced choices, but changing the count may change existing parameter values.

Use `appendable` by default. Use `coverage` only when the requested batch size is final and maximum coverage matters more than later expansion.

## Design Roles

Use design roles for deliberate anchors rather than ten unstructured random results:

```json
"design_roles": [
  {"index": 2, "name": "compact", "overrides": {"width": 0.82, "height": 0.78}},
  {"index": 3, "name": "wide", "overrides": {"width": 1.18}}
]
```

Variant 1 is automatically `canonical` when `canonical_first` is enabled. Roles override sampled values but must remain inside declared parameter bounds.

## Constraints

Constraints use a small non-executable rule language:

```json
{
  "when": {"parameter": "has_side_handles", "equals": false},
  "then": {
    "set": {"handle_size": 0.0},
    "disable": ["handle_style"],
    "clamp": {"width": {"min": 0.85}}
  }
}
```

Conditions support exactly one of `equals` or `in`. Actions support `set`, `disable`, and numeric `clamp`. Rules run once in listed order. Use explicit rules instead of free-form expressions or executable code.

## Change Discipline

- Increment `contract_revision` after an accepted contract edit.
- Preserve the root seed unless the user requests a new family.
- Change a design role for a deliberate variant correction; change a parameter range for a family-wide correction.
- Compile both old and new manifests, then use `Join-Path $skillDir 'scripts/compare_manifests.py'` from the absolute skill directory before regeneration.
- Treat invariant or generator-version changes as family-wide.
- Never remove obsolete outputs automatically; list them as removal candidates for review.
