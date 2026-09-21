"""Build the static Hydra temple ring from the V3 source's stage.

Run with Blender 4.2: blender -b hydra_v3.blend --python build_map.py -- MAP.blend MAP.glb
"""

import bpy
import math
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
blend_path, glb_path = map(lambda value: Path(value).resolve(), args)
for path in (blend_path, glb_path):
    path.parent.mkdir(parents=True, exist_ok=True)

for obj in list(bpy.context.scene.objects):
    if not obj.name.startswith('STAGE'):
        bpy.data.objects.remove(obj, do_unlink=True)

def material(name, color, roughness=0.9):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

dark = material('basalt | charcoal', (0.055, 0.064, 0.071))
path = material('basalt | worn path', (0.11, 0.12, 0.125))
edge = material('basalt | temple edge', (0.19, 0.16, 0.12))

def add_cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj

add_cube('Arena | basalt floor', (0, 0, -1.5), (100, 100, 3), dark)

# A broad, level annulus under every waypoint, with broken radial seams.
vertices = []
faces = []
segments = 96
for radius in (19, 29):
    for index in range(segments):
        a = 2 * math.pi * index / segments
        vertices.append((radius * math.cos(a), radius * math.sin(a), 0.08))
for index in range(segments):
    nxt = (index + 1) % segments
    faces.append((index, nxt, segments + nxt, segments + index))
mesh = bpy.data.meshes.new('Ring path mesh')
mesh.from_pydata(vertices, [], faces)
mesh.update()
obj = bpy.data.objects.new('Ring | broad walkable path', mesh)
bpy.context.collection.objects.link(obj)
obj.data.materials.append(path)

for index in range(8):
    angle = (index + 0.5) * math.tau / 8
    x, y = 34 * math.cos(angle), 34 * math.sin(angle)
    height = (4.6, 5.2, 3.8, 5.8, 4.1, 5.1, 3.5, 4.8)[index]
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.9, depth=height,
                                        location=(x, y, height / 2))
    pillar = bpy.context.object
    pillar.name = f'Cover | broken column {index + 1}'
    pillar.rotation_euler.z = angle
    pillar.data.materials.append(edge)
    add_cube(f'Cover | plinth {index + 1}', (x, y, 0.35), (4.5, 4.5, 0.7), dark)

bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', use_selection=True,
                          export_animations=False, export_apply=True)
print('HYDRA_TEMPLE_MAP', glb_path, glb_path.stat().st_size)
