# Garden rose shoot

An art-directed, approximately 2.3 m cultivated rose shoot with a curved prickly stem, one full carmine bloom, a closed side bud, and four alternate pinnate leaves. The editable Blender scene keeps its neutral presentation setup in a separate collection. This remains a presentation asset; it has no game export or runtime integration.

## Editable source

- `blender/garden_rose.blend`: Blender 4.2 source scene, metric units, origin at the stem base.
- `blender/build_garden_rose.py`: deterministic source modelers and non-destructive regeneration interface; authored seed `314159`.
- `blender/previews/`: original specimen previews.

The adapter owns the existing `Main_stem_curved` shoot axis and its height ratio. Stable local sockets identify four compound leaves, eight thorns, the flower, and the bud. `PROCEDURAL | Rose shoot` contains the shoot curve and sockets; `AUTHORED | Rose organs` contains the original organ mesh and curve sources. Organ data, materials, and additional objects are retained during regeneration.

The safe structural range is `0.9` to `1.1` times the source height. The authored organ seed is pinned to `314159`; changing it is rejected because this pilot does not rebuild authored flower or leaf geometry.

The source builder validates that each tube curve has one radius per control point. It also repairs one known legacy defect in `Bud_pedicel` when its canonical point coordinates, radii, tilt, weight, material, role, transform, and curve settings match exactly. An edited or otherwise different pedicel is preserved.

## Regeneration

From the repository root, run the source against the saved editable scene:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe' --background --python-exit-code 1 --python assets/models/garden_rose/blender/build_garden_rose.py
```

In Blender's Python Console, use the public interface for a controlled change and an explicit source save:

```python
import runpy
rose = runpy.run_path("assets/models/garden_rose/blender/build_garden_rose.py")
rose["regenerate_scene"](seed=314159, stem_height_ratio=1.05)
rose["save_source"](seed=314159, stem_height_ratio=1.05)
```

The first migration checks the canonical stem signature, required authored roles, and reserved names before changing the scene. `build_factory_scene()` retains the original complete modeling routines for explicit use in an empty scene; it rejects an occupied scene and does not clear user objects or collections. Normal regeneration never calls the factory bootstrap.
