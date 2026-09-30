"""Run in Blender background mode to check airborne asset animation contracts."""
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]

for index in range(1, 6):
    path = ROOT / 'assets/vfx/airburst-explosions' / ('airburst-v%02d' % index) / 'source.blend'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    scene = bpy.context.scene
    assert (scene.frame_start, scene.frame_end, scene.render.fps) == (1, 72, 24)
    meshes = [obj for obj in scene.objects if obj.type == 'MESH']
    assert meshes and {obj.get('role') for obj in meshes} == {'fire', 'smoke', 'fragment'}
    assert all('ground' not in obj.name.lower() and 'dust' not in obj.name.lower() for obj in scene.objects)
    for frame in range(1, 73):
        scene.frame_set(frame)
        for obj in meshes:
            assert all(math.isfinite(c) and c > 0 for c in obj.scale), (index, frame, obj.name)
            for corner in obj.bound_box:
                p = world_to_camera_view(scene, scene.camera, obj.matrix_world @ Vector(corner))
                assert .049 <= p.x <= .951 and .049 <= p.y <= .951, (index, frame, obj.name, tuple(p))
    # Fire and smoke must dissipate rather than leave a permanent floating ball.
    for mat in bpy.data.materials:
        if mat.name.startswith('Cooling flame'):
            vol = next(n for n in mat.node_tree.nodes if n.type == 'PRINCIPLED_VOLUME')
            assert vol.inputs['Density'].default_value == 0, mat.name
            glow = next(n for n in mat.node_tree.nodes if n.type == 'MAP_RANGE')
            assert glow.inputs['To Min'].default_value == 0, mat.name
            assert glow.inputs['To Max'].default_value == 0, mat.name
        if mat.name.startswith('Cooling smoke'):
            mul = next(n for n in mat.node_tree.nodes if n.type == 'MATH' and n.operation == 'MULTIPLY')
            assert mul.inputs[1].default_value == 0, mat.name
    print('PASS airburst %d: no ground, 72 frame camera sweep, dissipation' % index, flush=True)
