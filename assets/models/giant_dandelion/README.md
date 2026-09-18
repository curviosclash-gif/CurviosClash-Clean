# Giant dandelion

Giant, game-ready common dandelion (`Taraxacum`) seed head with a basal lobed rosette, one
leafless curved scape, a full spherical pappus crown, a naturally missing leeward patch and six
airborne seeds. At roughly 18 metres tall it reads as environmental landmark vegetation rather
than a normal-scale prop.

The morphology follows the genus description from
[Kew Science](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A328762-2/general-information):
perennial rosette habit, solitary capitulum on a leafless hollow scape, and a pappus of numerous
fine persistent setae. The mesh uses real geometry rather than alpha cards, so no alpha or
double-sided runtime material is required.

## Files

- `giant_dandelion.glb`: hero mesh with the looping 72-frame `WindGust` morph animation.
- `giant_dandelion_lod1.glb`: middle-distance mesh.
- `giant_dandelion_lod2.glb`: far-distance silhouette mesh.
- `giant_dandelion_collision.glb`: simple stem-and-head collision proxy.
- `blender/giant_dandelion.blend`: editable Blender 4.2 source with all LODs and presentation.
- `blender/previews/`: front, three-quarter, side and elevated QA renders.

Regenerate deterministically with Blender 4.2 LTS:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_giant_dandelion_asset.py
```

The generator validates bounds, decreasing LOD triangle counts, material count, wind morphs,
collision complexity and a GLB roundtrip import before saving the editable source.
