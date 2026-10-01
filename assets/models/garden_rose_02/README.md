# Garden rose 02

Editable Blender 4.2 presentation specimen: curved cane, layered flower, one side bud, three pinnate leaf groups, and prickles. It is a separate model from `assets/models/garden_rose` and has no runtime export or game integration.

## Source and regeneration

- `blender/garden_rose_02.blend` is the canonical authored scene and preserves the hand-tuned leaf, flower, and bud meshes.
- `blender/build_garden_rose_02.py` contains the hybrid structural regenerator. Normal regeneration operates on the open source scene; it does not rebuild authored organs.
- `blender/source_models_garden_rose_02.py` preserves the original full procedural source builder as a callable, empty-scene-only bootstrap. It performs no scene clearing, rendering, or file save.
- `blender/previews/` contains the existing hero, front, side, and back renders.

Open the `.blend` in Blender and run the script from Blender's Text Editor, or use:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.2\blender.exe' --background assets/models/garden_rose_02/blender/garden_rose_02.blend --python-exit-code 1 --python assets/models/garden_rose_02/blender/build_garden_rose_02.py
```

The public `regenerate_scene(parameters=None, seed=314159, save_path=None)` rebuilds only the cane, five prickles, flower peduncle, and bud shoot. The bounded `stem_height_scale` parameter accepts `0.9` through `1.1`; stable role sockets move the preserved organs in local parent frames. Calling `save_source(path)` saves the current scene explicitly. Invalid arguments are rejected before scene mutation.

For deliberate source reconstruction, import and call `build_original_authored_source(scene)` from `source_models_garden_rose_02.py` with Blender's active scene empty. It preserves the original leaf-blade, pinnate-leaf, petal-ring, receptacle, and bud modeling code. Routine regeneration never invokes this bootstrap.
