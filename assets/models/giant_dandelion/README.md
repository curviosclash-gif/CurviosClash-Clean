# Giant dandelion

Giant, game-ready common dandelion (`Taraxacum`) seed head with a basal lobed rosette, one
leafless curved scape, a full spherical pappus crown, a naturally missing leeward patch and nine
airborne seeds arranged as a coherent turbulent wind plume. At roughly 18 metres tall it reads as environmental landmark vegetation rather
than a normal-scale prop.

The morphology follows the genus description from
[Kew Science](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A328762-2/general-information):
perennial rosette habit, solitary capitulum on a leafless hollow scape, and a pappus of numerous
fine persistent setae. The mesh uses real geometry rather than alpha cards, so no alpha or
double-sided runtime material is required.

## Files

- `giant_dandelion.glb`: hero mesh with nine individually addressable flying seeds and one
  120-frame `SeedFlight` clip. The seeds release at staggered times, drift and rotate through
  a widening plume while the stem, leaves and head sway.
- `giant_dandelion_lod1.glb`: middle-distance mesh with five synchronized animated seeds.
- `giant_dandelion_lod2.glb`: far-distance silhouette mesh.
- `giant_dandelion_collision.glb`: simple stem-and-head collision proxy.
- `blender/giant_dandelion.blend`: editable Blender 4.2 source with all LODs and presentation.
- `blender/previews/`: front, three-quarter, side, elevated, release and mid-flight QA renders.
- `blender/previews/giant_dandelion_seedflight.mp4`: four-second 720p video preview.

`SeedFlight` is a one-shot four-second animation at 30 fps. Do not loop it: after the final
frame, keep the pose or hide the airborne seed nodes. Each seed is an independent GLB node
named `FlyingSeed_XX_HERO` and can be moved or hidden separately at runtime. The middle LOD
uses corresponding odd-numbered seeds and the same timing. The far LOD omits airborne seeds.

Regenerate deterministically with Blender 4.2 LTS:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_giant_dandelion_asset.py
```

The generator validates bounds, decreasing LOD triangle counts, material count, wind morphs,
individual flight actions, collision complexity and a GLB roundtrip import before saving the
editable source.

Render the video preview from the generated Blender source:

```powershell
blender --background assets/models/giant_dandelion/blender/giant_dandelion.blend --python-exit-code 1 --python scripts/render_giant_dandelion_video.py
```
