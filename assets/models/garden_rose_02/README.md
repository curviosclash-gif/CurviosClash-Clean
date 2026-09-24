# Garden rose 02

An editable, render-ready second garden rose specimen: a curved cane with a layered pink flower, one side bud, three pinnate leaf groups, and prickles. It is a separate model from `assets/models/garden_rose`.

## Files

- `blender/garden_rose_02.blend`: Blender 4.2 source scene with metric units, the stem base at the origin, materials, lights, and four cameras.
- `blender/build_garden_rose_02.py`: deterministic scene generator (seed `314159`).
- `blender/previews/`: transparent hero, front, side, and back renders.

Regenerate from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe' --background --factory-startup --python-exit-code 1 --python assets/models/garden_rose_02/blender/build_garden_rose_02.py
```

This is a presentation asset. It has no runtime export or game integration.
