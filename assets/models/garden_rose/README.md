# Garden rose shoot

An art-directed, approximately 2.3 m garden rose shoot with a curved prickly stem, one full carmine bloom, a closed side bud, and four alternate pinnate leaves. The editable Blender scene includes its own neutral presentation setup; the studio collection is separate from the plant collection.

## Files

- `blender/garden_rose.blend`: editable Blender 4.2 scene, metric units, origin at the stem base.
- `blender/build_garden_rose.py`: deterministic source generator (seed `314159`).
- `blender/previews/`: hero, front, side, and back renders.

Regenerate from the repository root with Blender 4.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe' --background --factory-startup --python-exit-code 1 --python assets/models/garden_rose/blender/build_garden_rose.py
```

The asset is a presentation-ready specimen. No game export or runtime integration is included.
