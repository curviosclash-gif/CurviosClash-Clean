# Ancient tree

Original CurviosClash environment asset derived from the approved watercolour concept of a
massive, exposed-root oak. The canonical runtime model is `ancient_tree.glb`; the editable
source and transparent review renders live below `blender/` and are excluded from game exports.

Regenerate with Blender 4.2 LTS:

```powershell
blender --background --factory-startup --python-exit-code 1 --python scripts/generate_ancient_tree_asset.py
```

The deterministic generator validates the five-camera presentation scene, ground contact,
minimum dimensions and mesh detail before writing the source, GLB and review renders.
