# Shootable sunflower

This is a mature-transition *Helianthus annuus* with a 4.8 m authored height and a 2.3 m
flower-head spread. The large cultivated silhouette keeps recognizable stem, leaf, head, ray,
and phyllary proportions at the map's 15 m target size. The Blender source uses a fixed seed and
220 individual achenes placed on a perturbed golden-angle spiral.

## Files

- `sunflower_shootable.glb` is the runtime model. It has no baked flight animation.
- `blender/sunflower.blend` is the editable Blender 4.2 scene and contains the studio setup.
- `blender/previews/sunflower_front.png`, `sunflower_quarter.png`, `sunflower_side.png`, and
  `sunflower_back.png` are the form checks. `sunflower_bloom.png` shows the bloom close-up, and
  `sunflower_game.png` is framed at game scale.
- `blender/previews/sunflower_desktop_game_camera.png` and the `sunflower_desktop_*_removed.png`
  captures show the loaded prop and two adjacent MG hits in the desktop renderer.
- `scripts/generate_sunflower_asset.py` rebuilds the source, previews, and GLB.

Run the generator from the repository root:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_sunflower_asset.py
```

## Runtime contract

Each `shootable_kernel` GLB node has a stable `kernel_index`, three local hit radii, and the
`heavy_achene_v1` flight profile. The mesh lives on that node; the pale shell stripe may import as
a child mesh. `SunflowerKernelController` reads identity and bounds from the parent and places the
flight at the parent's current world transform. One shared socket mesh remains under the kernels,
so a removed achene reveals its own dark well and ochre rim.

The engine tests a coarse head sphere before the transformed kernel ellipsoids. It uses no
per-kernel physics colliders and batches the attached shell meshes. The host transmits each released
kernel's ID, release time in milliseconds, and quantized hit direction. The heavy kernel then uses a
fixed outward impulse, bounded tangent response, tumble, and gravity; after 4.5 seconds it is
removed from the flight view. A round restart reattaches every kernel and clears the event list.

The target is placed in the open upper play volume on `dandelion_sky` at a 15 m map size. It has
`collision: false`; aimed hits use the shared shootable-organ ray query and do not add hidden head
or per-kernel colliders. The desktop contract fires two directly aimable neighboring kernels
through the regular Hunt MG path.

## Botanical references

- [Kew, Plants of the World Online: *Helianthus annuus*](https://powo.science.kew.org/taxon/urn:lsid:ipni.org:names:119003-2/general-information)
- [Cornell CALS: Common sunflower morphology](https://cals.cornell.edu/weed-science/weed-profiles/common-sunflower)
- [Royal Society Open Science: sunflower capitulum spiral observations](https://doi.org/10.1098/rsos.160091)

The plant uses the annual upright habit, alternate broad toothed leaves with raised veins, overlapping
ciliate involucral bracts, cupped yellow rays, a thick receptacle, and a varied dark spiral achene
field described in those sources. The model does not include roots below ground or a texture atlas;
its depth comes from the modeled organs and the game renderer's scene lighting.
