# Tree Runtime Profiles

Choose budgets from the target camera, platform, number of visible trees, lighting, foliage method, and animation system. Do not apply fixed triangle ratios as universal quality levels.

## Hero Asset

Preserve:

- outer crown silhouette;
- trunk and root profile;
- primary and important secondary forks;
- representative fine branches in visible gaps;
- bark and foliage material identity;
- required wind animation.

Report exported vertices and triangles, material slots, texture memory, morph or skin payload, alpha mode, file size, and bounds.

## LOD Generation

Reduce in this order unless the target view disproves it:

1. hidden interior leaves and twigs;
2. duplicated or occluded foliage cards;
3. radial segments on distant fine branches;
4. fine-branch curve resolution;
5. medium branch curvature subdivisions;
6. only then defining outer terminals and major forks.

Evaluate LODs from the actual switching distance. Compare silhouette width, projected crown area, gaps, material count, and wind behavior. A lower triangle count that increases alpha overdraw may be slower.

Keep LOD bounds and pivot compatible to avoid visible jumps. If only the hero animates, confirm the transition to static LODs is acceptable.

For repeated static placements, decode each unique tree LOD once and reuse immutable geometry and
materials through engine instances or cloned scene graphs. Each placement must still own its
transform, visibility, and culling state. Do not share mixers, mutable animation state, or gameplay
collision state this way. Verify the runtime loads each unique URL once, creates the requested
number of independent placements, and preserves the intended collision policy.

## Collision

Use a small set of primitives or low-poly volumes for:

- trunk base;
- main trunk;
- only gameplay-relevant primary limbs;
- optional coarse root or canopy volumes when mechanics require them.

Do not use render geometry as collision by default. Keep collision in a separate file or use the target engine's naming contract. Validate that collision objects do not appear in the render export.

## Wind Choices

| Method | Strength | Cost or limitation |
| --- | --- | --- |
| Shader wind | Cheap for forests | Engine-specific; not stored as glTF motion |
| Bones | Reusable clips and hierarchical motion | Skinning cost and authoring complexity |
| Morph targets | Predictable deformation and simple playback | Large per-vertex payload; limited flexibility |
| Object transforms | Simple branch clusters | Many nodes and draw or update overhead |

Keep trunk motion minimal, scale displacement toward tips, and share phase locally. Validate rest, gust, loop boundary, normals, and self-intersection in the target runtime.

## Foliage

- Prefer masked foliage for most game trees and tune alpha cutoff in-engine.
- Track card overlap and projected alpha area, not only polygon count.
- Keep normals and two-sided behavior explicit.
- Test mipmapped edges and distance behavior against the final background.
- Preserve terminal clusters and crown gaps before interior density.

## Acceptance Manifest

For each hero, LOD, and collision file record:

- Blender and generator version;
- seed;
- file size;
- bounds and pivot;
- mesh, exported vertex, and triangle counts;
- materials, textures, and alpha modes;
- animation names, paths, bones, and morph targets;
- extensions used and required;
- multi-view silhouette measurements;
- roundtrip result and target-engine validation.
