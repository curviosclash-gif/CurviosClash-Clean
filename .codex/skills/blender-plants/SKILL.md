---
name: blender-plants
description: Create Blender grasses, flowers, shrubs, vines, and foliage with botanical structure, procedural placement, wind, and game exports. Use blender-trees for full trees.
---

# Blender Plants

Build plants from a growth model rather than scattering unrelated geometry. Preserve the requested species, stylization, season, age, density, and runtime budget.

## Model approval

Prefer procedural Blender tooling and the least costly adequate non-Astra model. Never intentionally select or delegate to `gpt-6-astra` without explicit user approval for that specific use in the current task. If Astra appears necessary or materially useful, briefly explain the concrete advantage and ask before invoking it. Without approval, use the strongest suitable non-Astra route and keep botanical, visual, runtime, and export QA unchanged.

## Iterative improvement

Before every final response, run the short [final learning gate](../blender-workflows/references/final-learning-gate.md), including when all QA passed. If it finds no verified reusable lesson, do not change any skill. If it finds a candidate, read [the improvement cycle](../blender-workflows/references/iterative-improvement.md), update and validate the smallest owner before delivery. Own plant morphology, organ attachment, and species guidance here; shared tooling belongs in `blender-workflows`. Keep species-specific rules scoped and load only relevant references.

## Establish the Plant Grammar

Before modeling, identify:

- growth habit: upright, clumping, creeping, climbing, rosette, shrub, or branching herb;
- primary growth axis and gravity direction;
- node and internode rhythm;
- branch order and apical dominance;
- leaf arrangement: alternate, opposite, whorled, basal, or compound;
- tropisms: light seeking, gravity response, support seeking, and wind exposure;
- organ hierarchy: stems, petioles, blades, buds, flowers, fruit, dead material, and roots if visible.

Use correlated variation. Neighboring organs should share some direction and scale, while different clusters diverge. Independent random rotation at every element usually looks noisy rather than natural.

## Procedural Construction

Prefer curves for stems and branch paths, then convert or evaluate them for export. Generate attachment sites from the parent path so leaves and child branches remain connected when proportions change.

Build in this order:

1. primary silhouette and growth axes;
2. branch or shoot hierarchy;
3. leaf and flower sites;
4. organ geometry and orientation;
5. age, damage, dryness, and color variation;
6. wind deformation and runtime variants.

Orient leaves from a blend of the local stem frame, outward growth, light direction, and bounded scatter. Vary roll and droop. Avoid repeated parallel leaf planes, perfectly even spacing, and identical scale.

Keep a deterministic seed and expose a small set of biologically meaningful parameters instead of many unrelated noise controls.

Choose the generator from the requested outcome:

- use direct mesh or curve editing for a single art-directed specimen;
- use Geometry Nodes for interactive families and reusable procedural controls;
- use deterministic `bpy` for batch generation and repository builds;
- use an L-system when developmental grammar, node order, or phyllotaxis is the main source of form.

For a Geometry Nodes pipeline, read [references/geometry-nodes.md](references/geometry-nodes.md). For starting archetypes and a portable parameter schema, read [references/species-profiles.md](references/species-profiles.md).

## Materials and Seasonality

Use a small palette with restrained variation across healthy, shaded, sunlit, young, and dry organs. Separate color variation from roughness and translucency. For cutout cards, verify alpha mode, back-face behavior, mip behavior, and normals in the target renderer.

Add imperfections where growth explains them: missing leaves, bent stems, dry tips, old nodes, insect damage, or occluded interior growth. Do not distribute damage uniformly.

## Reference-led Realism

For a realistic hero plant, establish a visual reference for the intended species or cultivar and growth stage before detailed modeling. Use a supplied reference when available; otherwise find one when permitted and state the chosen interpretation. Set plausible dimensions for the whole specimen and its defining organs, such as flower diameter and petal thickness. Preserve an explicitly requested stylization instead of treating photographic realism as the default.

Compare the first geometry render with the reference at similar scale and viewing angles, including a side view. If a flower reads as a flat disk, petals form conspicuously even rings or thick ribbons, or leaves collapse into flat strips, change the organ shape, layering, or orientation before tuning materials or adding random variation.

Before calling a realism-oriented asset visually finished, compare final hero and side or rear renders with the reference under lighting that exposes form and material color. A successful render, saved scene, or geometry report does not establish visual likeness. If a targeted correction still leaves the defining form unconvincing, continue visual iteration or seek stronger visual review with the renders and reference.

## Wind and Runtime Geometry

Separate deformation by structural stiffness:

- base and thick stems move little;
- thin stems bend moderately;
- leaves and flowers respond most;
- neighboring organs share phase with small offsets.

Use shape keys, an armature, geometry nodes, or shader wind according to the target engine. Verify the exported mechanism, loop boundary, and rest pose. Avoid self-intersections at the peak wind pose.

For real-time assets, preserve the outer silhouette first when reducing geometry. Simplify hidden stem segments, interior leaves, and distant organ curvature before removing defining lobes or flower shapes. Small plants usually need simple bounds rather than detailed collision unless gameplay requires interaction.

## Interactive Organs

If leaves, fruit, seeds, or other organs must detach or be hit independently, define their runtime identity before combining geometry. Keep each interactive organ addressable with a stable exported node name or ID and the minimum metadata the game needs; decorative organs can remain batched. Inspect the exported file **and the target engine's loaded hierarchy**: an importer may place metadata and transforms on a parent node while splitting its materials into child meshes.

For large organ counts, compare targeted hit queries or shared collision proxies with one permanent physics collider per organ. Test the choice at the requested world scale, including hit radius, flight speed, bounds, and cost; a convincing Blender-scale preview does not establish game-scale behavior.

When an interactive organ and its target can both move, validate continuous contact in relative motion across the expected frame spike (for example with a swept sphere or capsule). Endpoint-only overlap checks can tunnel even with a visually adequate hit radius. Pair the crossing test with a nearby miss so reliability is not achieved by inflating the hitbox without bound.

If detachment depends on changing wind, distinguish authored sway from runtime flight. Let the runtime derive wind from its match clock and record each release time when deterministic replay or multiplayer synchronization is required. Check that nearby release times produce gradual change and meaningfully separated times can produce different flight directions. Do not prescribe a particular wind formula or network scheme when the target game already has one.

## QA

Inspect the plant from multiple azimuths and from its likely gameplay camera height. Confirm that foliage density, gaps, and branch reach do not collapse from the side or rear. Validate the editable scene and every runtime export by roundtrip import.

Measure evaluated and exported vertices, triangles, material slots, alpha-card overlap, texture memory, instances, morph data, and file size. Triangle count alone is not a sufficient vegetation budget.

Use the shared [`inspect_scene.py`](../blender-workflows/scripts/inspect_scene.py) for evaluated mesh checks. It reports every mesh in the current scene, so isolate studio geometry before treating bounds as asset-only; include evaluated curve geometry separately when stems or veins remain as curves.

For a single hero flower, inspect a dedicated bloom close-up as well as full-specimen views. Check that petal overlap, cupping, and the center remain natural at close range; the full silhouette can hide repeated radial bands and overly smooth surfaces.

For a repository asset, also verify that the actual runtime loader finds the interactive nodes and that the project's smallest relevant build packages the exported file. Use a representative target-scale placement for this check.

For morphology parameters, placement logic, and optimization heuristics, read [references/botanical-construction.md](references/botanical-construction.md).
