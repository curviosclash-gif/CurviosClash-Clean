# Blender Method Selection

Choose the smallest method that preserves editability, repeatability, and target compatibility.

| Situation | Preferred method | Main reason |
| --- | --- | --- |
| One-off adjustment to an existing scene | Direct Blender edit or focused `bpy` patch | Preserve the scene as source of truth |
| Repeated deterministic asset build | `bpy` generator | Reproducible output and command-line validation |
| Artist-facing parametric asset family | Geometry Nodes | Interactive controls and reusable node groups |
| Large repeated geometry | Instances kept unrealized | Lower memory and faster evaluation |
| Engine export that cannot consume procedural data | Evaluate or realize at export boundary | Preserve procedural authoring source |
| Complex sculptural hero asset | Manual modeling or sculpt plus scripted QA | Art direction is more important than regeneration |
| Existing generator with a local defect | Repair the shared cause in that generator | Avoid divergent manual fixes |

## Decision Questions

1. Is the `.blend` or a generator script the intended source of truth?
2. Will the user revise the same parameters repeatedly?
3. Must the result be built unattended in a repository or CI job?
4. Does the target format preserve the procedural representation?
5. Is the asset a single specimen or a configurable family?
6. Is destructive realization necessary now, or only for export?
7. Do repeated object-specific rules justify a specialized skill, or is this a one-off asset?

Prefer a hybrid when appropriate: generate the structural base with Geometry Nodes or `bpy`, preserve an editable authoring scene, then create evaluated export copies without destroying the source.

## Procedural Plant Base and Authored Detail

For new plants and trees, default to a reproducible procedural base, including for a single specimen. Generate growth axes, branching, and organ attachment sites with a small set of meaningful parameters and explicit seeds. Add authored organ meshes, silhouette corrections, or distinctive details where procedural rules alone do not achieve the requested quality. A short `bpy` generator is sufficient; an interactive Geometry Nodes system is optional. Use direct modeling when explicitly requested or when the particular form makes a procedural base impractical, and briefly explain that choice.

Keep generated geometry and authored additions in separate named collections or node branches. Rebuild only the generator-owned parts. Attach additions through stable role IDs and local parent frames so they follow proportion changes; do not rely on world coordinates or vertex indices that regeneration can invalidate. Preserve reusable authored leaves, flowers, and other source meshes. Save the generator or node setup, parameters, seeds, and authored source alongside the editable `.blend` in the permitted asset location.

Before scaling up a hybrid family, regenerate one representative specimen with the same seed and then change one structural parameter. Confirm that authored geometry survives, attachments follow their parents, and materials, interactive IDs, wind, and export selection remain valid. If a correction depends on the old topology, adapt it explicitly or limit the permitted variation instead of silently dropping it. Export evaluated copies while keeping the authoring source editable. Procedural authoring does not require procedural generation in the game.

For existing plants, inspect the `.blend`, generator, modifiers, and object hierarchy first. Reuse available controls; a saved mesh or GLB alone does not establish regenerability. With separate organs, an adapter can vary permitted parts and reapply authored detail. With flattened geometry, restrict variation to safe deformations or materials unless structural reconstruction is part of the request. Preserve the original specimen.

## Required Output Contract

Before construction, state or infer:

- source-of-truth file;
- deterministic seed, if randomness is used;
- units, axes, scale, pivot, and world origin;
- target Blender version and renderer;
- target runtime and interchange format;
- required hero, LOD, collision, animation, and preview outputs;
- measurable acceptance facts.

Do not add an interactive node system when a short deterministic script is the clearer deliverable. Do not flatten a useful procedural setup solely to make inspection easier; export from an evaluated copy.

## Skill Specialization Decision

Keep work in `blender-workflows` when the object uses ordinary modeling, materials, animation, and export rules or is unlikely to recur.

Propose a specialized object skill when at least one of these is substantial:

- a stable part hierarchy or construction grammar unique to the object class;
- repeated procedural generation with meaningful domain parameters;
- class-specific physics, rigging, damage, modularity, LOD, collision, or export contracts;
- authoritative references that must be consulted consistently;
- a recurring visual QA rubric not shared by general Blender assets;
- two or more concrete future use cases that benefit from the same workflow.

Do not create parallel skills with overlapping trigger descriptions. Prefer the narrowest existing skill that fully covers the request, then extend it only when the new cases share its core decisions.
