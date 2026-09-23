---
name: blender-trees
description: Create or refine full Blender trees with structured branching, volumetric crowns, bark, roots, foliage, wind, LODs, collision, and game-export validation.
---

# Blender Trees

Construct the tree as a load-bearing growth hierarchy. The crown must remain intentional from every important direction, and the runtime package must preserve the hierarchy at the appropriate budget.

## Model approval

Prefer procedural Blender tooling and the least costly adequate non-Astra model. Never intentionally select or delegate to `gpt-6-astra` without explicit user approval for that specific use in the current task. If Astra appears necessary or materially useful, briefly explain the concrete advantage and ask before invoking it. Without approval, use the strongest suitable non-Astra route and keep structural, visual, runtime, and export QA unchanged.

## Iterative improvement

Before every final response, run the short [final learning gate](../blender-workflows/references/final-learning-gate.md), including when all QA passed. If it finds no verified reusable lesson, do not change any skill. If it finds a candidate, read [the improvement cycle](../blender-workflows/references/iterative-improvement.md), update and validate the smallest owner before delivery. Own tree architecture, growth, and runtime profiles here; shared tooling belongs in `blender-workflows`. Compare crown repairs with stable seeds/views and a valid contrasting profile. Load only relevant references.

## Start with Architecture

Define the tree's species or archetype, age, environment, scale, crown envelope, trunk habit, central-leader behavior, asymmetry, season, and target platform.

Select the growth method before generating geometry. Use parametric recursion for strong art direction, L-systems for developmental grammar, space colonization for crown-volume and obstacle control, or a hybrid when both architecture and envelope matter. Read [references/growth-algorithms.md](references/growth-algorithms.md) before implementing a new generator.

Represent the hierarchy explicitly:

- trunk and buttress roots;
- primary or scaffold branches;
- secondary branches;
- tertiary branches;
- fine branches and twigs;
- foliage sites.

For a large old broad-crowned deciduous tree, a useful starting profile is 3–5 primary branches, roughly 4–5 secondary branches per primary, roughly 5–8 tertiary branches per secondary, then bounded recursive fine branching. This is a profile, not a universal rule; adapt it to the species and silhouette.

Give primary branches different emergence heights, azimuths, lengths, elevation angles, curvature, and dominance. A central leader should be a genuine continuing branch, not a capped trunk stump. Let child branches inherit the parent's direction while responding to light, gravity, available crown space, and collision avoidance.

## Use Controlled Fractal Growth

Recursive similarity should decrease with branch order. Scale length and radius, increase directional variation gradually, and stop recursion by thickness, length, crown boundary, or runtime budget. Keep the random seed stable.

Distribute attachments around the parent with phyllotactic spacing plus bounded jitter. Do not place all children in one plane. Preserve a plausible taper and avoid child radii that visually exceed the supporting parent.

Build the skeleton first, then assign radii from tips toward the trunk. Use the pipe-model relation as a plausibility check and use a minimum-twist or parallel-transport frame for branch cross-sections and directional bark.

Add some inward and bridging fine branches to fill the crown volume, but keep readable negative spaces near major forks. Natural fullness is not uniform density.

## Build Believable Transitions and Age

- Blend or overlap branch bases with branch collars that follow the parent surface; avoid visible end caps and black seams.
- Make roots asymmetric in prominence, length, angle, and branching. Sink distant tips slightly into the ground.
- Use predominantly longitudinal bark flow with secondary roughness and crevices. Keep old bark matte unless the requested species is naturally glossy.
- Place knots, scars, deadwood, cavities, fungi, broken twigs, and dry leaves sparingly where age and stress explain them.
- Check that bark detail follows branch direction and does not become a uniform noise shell.

## Shape the Crown in Volume

Define a target crown envelope and track occupied sectors around the trunk. Judge width and height from front, both sides, rear, and diagonal views. When the requested form is round or spreading, a narrow 90-degree silhouette is a structural failure, not a camera problem.

Place foliage on terminal and near-terminal branches, with some interior sites for depth. Orient leaf clusters using branch direction, outward crown direction, light bias, and scatter. Avoid repeated parallel cards and equal-sized clumps.

## Animation and Game Package

Separate fine branches and foliage from the rigid trunk when that makes wind authoring and export clearer. Apply small motion to thicker fine branches and larger motion to leaves, with shared local phase and bounded variation. Verify rest, gust, and loop poses after GLB or FBX export.

For a game-ready tree, normally deliver:

- editable `.blend`;
- animated or static hero export;
- one or more static LOD exports sized for the target engine;
- a separate, simple collision export based on the trunk and major branches;
- representative multi-angle previews;
- a short asset note containing scale, polygon counts, animation mechanism, and intended files.

LOD reduction must protect the outer crown, trunk profile, major forks, and material assignments. Collision should use primitive or low-poly volumes and must not duplicate render detail.

Select budgets from target platform, gameplay camera, number of simultaneous trees, and wind method. Read [references/runtime-profiles.md](references/runtime-profiles.md) when creating LOD, collision, foliage, or animation variants.

## Acceptance

Render at least front, side, rear, and diagonal views. Inspect silhouette balance, crown gaps, branch attachment seams, root grounding, material roughness, foliage orientation, and fine-branch distribution. Measure bounds, exported vertices and triangles, material slots, foliage overdraw, morph payload, texture memory, and file size. Re-import every runtime export into an empty scene and confirm animation, materials, morph targets, object count, and collision separation.

For branch ratios, crown coverage, bark, roots, LODs, and validation metrics, read [references/tree-architecture.md](references/tree-architecture.md).
