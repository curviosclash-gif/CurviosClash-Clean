"""Create the two shared, low-poly trunk blockers used by Kirschhain."""
import os
from pathlib import Path
import bpy

OUT = Path(os.environ.get('CHERRY_GROVE_OUTPUT_DIR', Path(__file__).resolve().parents[1] / 'assets/maps/cherry_grove/glb'))
OUT.mkdir(parents=True, exist_ok=True)

for name, height, radius, vertices in (
    ('akebono_collision.glb', 9.6, 0.40, 16),
    ('kanzan_collision.glb', 5.2, 0.30, 14),
):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(0, 0, height * 0.5))
    trunk = bpy.context.object
    trunk.name = name.replace('.glb', '')
    trunk.data.name = f'{trunk.name} | coarse trunk'
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / name),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        use_selection=True,
    )
    print(f'CHERRY_GROVE_COLLISION {name} tris={len(trunk.data.polygons) * 2} bytes={(OUT / name).stat().st_size}')
