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
geometry for the runtime GLB. The generator bakes the bark, moss and four leaf palettes into a
material-bound vertex-colour attribute so every visible glTF primitive exports an effective
`COLOR_0` source without external texture paths. The bark uses a deliberately matte, non-metallic finish with
minimal specular reflection. It validates eight 45-degree presentation views,
crown silhouette consistency, ground contact, dimensions and mesh detail before writing the
source, GLB and transparent review renders.

The hero GLB includes a looping `WindGust` morph animation on leaves and fine branches. Directed
bark grooves, branch collars, sparse deadwood, shelf fungi, light-oriented leaves, dry-leaf
variation and asymmetric partly buried roots provide close-range age detail. Use LOD1 for the
middle distance, LOD2 for the far distance, and the collision GLB only for physics.

## Ten-tree variant set

`variants/` contains ten deterministic, game-ready trees. Every folder includes an animated
hero GLB, LOD1, LOD2, a collision GLB, a transparent front preview and the exact parameter set
in `parameters.json`. `variants/manifest.json` indexes the complete set, while
`variants/contact_sheet.png` shows variants 01–05 in the top row and 06–10 in the bottom row.

The variants use stratified sampling so every major control spans its approved slight-to-medium
range: height, crown size and aspect, trunk lean and twist, wood thickness, individual main-branch
length/azimuth/elevation, recursive branch density and lengths, gravity, phototropism, foliage
density/spread, leaf size/colour/dryness, root count/length/thickness, bark scale/lightness/
roughness, groove count, deadwood, fungi and wind strength.

Regenerate the complete set with Blender 4.2 LTS:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_ancient_tree_variants.py
```

Use `-- --only 3` after the script path to regenerate only variant 03 without changing the
other generated models.
