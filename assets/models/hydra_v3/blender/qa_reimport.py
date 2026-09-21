"""Reimport and check the shipped GLB; render three review angles to a temporary directory."""

import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
model = Path(args[0]).resolve()
render_dir = Path(args[1]).resolve()
render_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))

scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == 'MESH']
triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
sockets = [obj for obj in scene.objects if obj.name.startswith('Mouth_')]
actions = {action.name.split('_HYDRA')[0].split('_head ')[0].split('_foot ')[0]
           for action in bpy.data.actions}
expected = {'Idle', 'Walk', *(f'Snap_{i}' for i in range(1, 6)), *(f'Spit_{i}' for i in range(1, 6))}
assert len(meshes) <= 100, len(meshes)
assert triangles <= 120000, triangles
assert len(sockets) == 5, [obj.name for obj in sockets]
assert expected <= actions, (expected, actions)
textured = {material.name for obj in meshes for material in obj.data.materials if material
            and material.node_tree and any(node.type == 'TEX_IMAGE' for node in material.node_tree.nodes)}
assert len(textured) >= 3, textured
print('REIMPORT_OK', len(meshes), triangles, sorted(actions), [obj.name for obj in sockets])

world = bpy.data.worlds.new('QA world')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.21, 0.24, 0.27, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
for name, location, energy, size in (
    ('Key', (8, -10, 16), 1800, 8), ('Fill', (-11, -3, 9), 900, 10),
    ('Rim', (2, 10, 13), 2100, 9),
):
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy = energy
    light_data.shape = 'DISK'
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 4)) - light.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('QA camera')
camera = bpy.data.objects.new('QA camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 16
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
for name, location in (
    ('front', (0, -19, 10)), ('side', (19, 0, 10)), ('three_quarter', (14, -16, 11)),
):
    camera.location = location
    camera.rotation_euler = (Vector((0, 0, 4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(render_dir / f'hydra_{name}.png')
    bpy.ops.render.render(write_still=True)
print('RENDER_OK', render_dir)
