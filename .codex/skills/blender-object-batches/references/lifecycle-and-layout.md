# Batch Lifecycle and Layout

## States

| State | Meaning | Required evidence |
|---|---|---|
| `DRAFT` | Material decisions are still open | Brief or reference |
| `CONTRACT_LOCKED` | Contract is sufficient for deterministic production | Valid version 2 contract |
| `PROTOTYPE_APPROVED` | Canonical form or art direction was reviewed | Prototype ID or approved reference |
| `GENERATED` | Selected variants completed | Generation report |
| `VALIDATED` | Required checks passed | QA report |
| `RELEASED` | Accepted outputs were handed off | Final paths and contract hash |
| `REVISION_REQUIRED` | Generation or QA found actionable failures | Failed IDs and reasons |

Do not manufacture approval evidence. A precise brief may proceed from `CONTRACT_LOCKED` directly to generation. `RELEASED` remains a reporting state; scripts do not publish or externally distribute assets without authorization.

## Directory Layout

```text
object-family/
|-- object-contract.json
|-- variants.json
|-- object_generator.py
|-- generation-report.json
|-- qa-report.json
|-- contact-sheet.png
`-- variants/
    |-- object-v01/
    |   |-- source.blend
    |   `-- runtime.glb
    `-- object-v02/
```

Use the smallest subset needed by the target pipeline. Keep shared textures, node groups, and source libraries outside per-variant folders when they are genuinely shared.

This layout is illustrative, not a requirement to store reports in the product repository. If repository instructions forbid generated process artifacts, put the contract, manifest, generation report, QA report, and contact sheet in an external working directory; copy in only source and runtime deliverables permitted by the project. Do not automatically remove the external working directory when cleanup requires user authorization.

## Conversation Gates

Ask only when a missing decision changes family identity, runtime compatibility, or destructive output handling. Combine unresolved decisions into one message of at most three questions. After locking the contract, communicate by contract revision, hash, failed IDs, and deltas rather than repeating the brief.
