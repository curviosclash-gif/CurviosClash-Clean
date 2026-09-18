# Ancient tree

Original CurviosClash environment asset derived from the approved watercolour concept of a
massive, exposed-root oak. The canonical runtime model is `ancient_tree.glb`; optimized
`ancient_tree_lod1.glb` and `ancient_tree_lod2.glb` variants plus
`ancient_tree_collision.glb` support distance rendering and gameplay collision. The editable
source and transparent review renders live below `blender/` and are excluded from game exports.

Regenerate with Blender 4.2 LTS:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_ancient_tree_asset.py
```

The deterministic generator builds five art-directed main branches—including a living central
leader that replaces the former cut—and a recursive hierarchy
of secondary, tertiary and fine branches using pipe-model tapering. Fine branches follow
staggered attachment bands and golden-angle rotation instead of artificial-looking whorls.
Three related procedural
octaves form self-similar bark at plate, groove and fibre scales and are also baked into the
geometry for the runtime GLB. The bark uses a deliberately matte, non-metallic finish with
minimal specular reflection. It validates eight 45-degree presentation views,
crown silhouette consistency, ground contact, dimensions and mesh detail before writing the
source, GLB and transparent review renders.

The hero GLB includes a looping `WindGust` morph animation on leaves and fine branches. Directed
bark grooves, branch collars, sparse deadwood, shelf fungi, light-oriented leaves, dry-leaf
variation and asymmetric partly buried roots provide close-range age detail. Use LOD1 for the
middle distance, LOD2 for the far distance, and the collision GLB only for physics.
