import bpy
import math
import random
from pathlib import Path
from mathutils import Vector


OUT = Path(__file__).resolve().parent
random.seed(240921)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in bpy.data.materials:
    bpy.data.materials.remove(data)

scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples = 24
scene.render.resolution_x = 960
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.color_mode = 'RGBA'
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 120
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'HIGH'
scene.render.filepath = str(OUT / 'hydra_5_seconds.mp4')
scene.render.image_settings.color_mode = 'RGB'
scene.world.color = (0.015, 0.02, 0.035)
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.camera = None


def material(name, color, metallic=0, roughness=0.5, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Metallic'].default_value = metallic
    principled.inputs['Roughness'].default_value = roughness
    if emission:
        principled.inputs['Emission Color'].default_value = (*emission[0], 1)
        principled.inputs['Emission Strength'].default_value = emission[1]
    return mat


skin = material('deep petrol scales', (0.018, 0.13, 0.15), 0.48, 0.32)
skin_alt = material('raised scales', (0.035, 0.22, 0.22), 0.42, 0.38)
belly = material('bronze ventral armor', (0.28, 0.19, 0.11), 0.45, 0.4)
dark = material('obsidian horns and claws', (0.016, 0.024, 0.036), 0.22, 0.29)
mouth = material('inner mouth', (0.13, 0.023, 0.055), 0.08, 0.45)
teeth_mat = material('ivory teeth', (0.8, 0.75, 0.59), 0.05, 0.25)
eye_mat = material('amber luminous eyes', (1.0, 0.21, 0.025), 0.1, 0.2, ((1.0, 0.19, 0.01), 2.3))
glow = material('arcane breath', (0.2, 0.045, 0.55), 0, 0.3, ((0.28, 0.045, 0.75), 1.8))
ground_mat = material('volcanic stone', (0.02, 0.025, 0.035), 0.1, 0.85)
ring_mat = material('etched arcane ring', (0.2, 0.08, 0.36), 0.3, 0.3, ((0.18, 0.035, 0.42), 1.7))


def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj


def smooth(obj):
    if obj.type == 'MESH':
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def uv(name, pos, scale, mat, parent=None, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    if parent:
        ob.parent = parent
    assign(ob, mat)
    return smooth(ob)


def empty(name, location=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    scene.collection.objects.link(ob)
    ob.location = location
    if parent:
        ob.parent = parent
    return ob


def tapered(name, a, b, r1, r2, mat, parent=None, vertices=12):
    mid = (Vector(a) + Vector(b)) * 0.5
    delta = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2,
                                    depth=delta.length, location=mid)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    if parent:
        ob.parent = parent
    assign(ob, mat)
    return smooth(ob)


def torus(name, loc, major, minor, mat, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=6,
                                     location=loc, major_radius=major, minor_radius=minor)
    ob = bpy.context.object
    ob.name = name
    if parent:
        ob.parent = parent
    return assign(smooth(ob), mat)



exec(compile((OUT / 'creature_v3.py').read_text(encoding='utf-8'), str(OUT / 'creature_v3.py'), 'exec'))
