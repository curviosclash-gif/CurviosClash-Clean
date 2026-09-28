"""Deterministic airborne Blender explosion studies; procedural volumes, no cache.

Shares material/mesh helpers with the conventional studies. Blender-only visual
assets: no ground, gameplay blast calculations, or glTF volume claims.
"""
import hashlib
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_conventional_explosions as base

GENERATOR_ID = 'airburst-explosion-generator'
GENERATOR_VERSION = '1.0.0'
DESIGNS = [
    ('Compact airburst', 1.0, (1, 1, 1), 10, 15, 14),
    ('Fragmentation flash', .65, (1, 1, 1), 5, 10, 46),
    ('Elongated detonation', 1.0, (1.8, .70, .65), 11, 17, 25),
    ('Airborne fuel fireball', 1.45, (1.2, 1.2, .9), 16, 24, 12),
    ('Staggered secondary bursts', .75, (1, 1, 1), 6, 9, 22),
]


def sphere_direction(rng):
    z = rng.uniform(-1, 1)
    angle = rng.uniform(0, math.tau)
    r = math.sqrt(1-z*z)
    return Vector((r*math.cos(angle), r*math.sin(angle), z))


def cooling_fire(seed, delay, fuel):
    mat = base.fire_material('Cooling flame %d' % seed, seed)
    nodes = mat.node_tree.nodes
    volume = next(n for n in nodes if n.type == 'PRINCIPLED_VOLUME')
    strength = next(n for n in nodes if n.type == 'MAP_RANGE').inputs['To Max']
    for f, heat in [(1, 0), (4, 11), (10, 8), (23 if fuel else 16, 3), (35 if fuel else 25, 0), (72, 0)]:
        strength.default_value = heat
        strength.keyframe_insert('default_value', frame=f+delay)
    for f, density in [(1, 0), (4, .35), (15, .25), (35 if fuel else 25, 0), (72, 0)]:
        volume.inputs['Density'].default_value = density
        volume.inputs['Density'].keyframe_insert('default_value', frame=f+delay)
    return mat


def fading_smoke(seed, delay):
    mat = base.smoke_material('Cooling smoke %d' % seed, (.13, .14, .16), seed, 2.7)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    volume = next(n for n in nodes if n.type == 'PRINCIPLED_VOLUME')
    socket = volume.inputs['Density']
    source = socket.links[0].from_socket
    mult = nodes.new('ShaderNodeMath')
    mult.operation = 'MULTIPLY'
    links.new(source, mult.inputs[0])
    links.new(mult.outputs[0], socket)
    for f, density in [(1, 0), (7, .25), (19, 1), (35, .75), (55, .35), (72, 0)]:
        mult.inputs[1].default_value = density
        mult.inputs[1].keyframe_insert('default_value', frame=min(72, f+delay))
    return mat


def build_variant(context):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    index = int(context['parameters']['style'])
    label, size, axes, flames, clouds, sparks = DESIGNS[index-1]
    rng = random.Random(context['seed'])
    scene = bpy.context.scene
    scene.name = label
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, 72
    scene.eevee.taa_render_samples = 24
    scene.eevee.volumetric_samples = 64
    scene.eevee.volumetric_tile_size = '2'
    scene.world = bpy.data.worlds.new('Dark blue air backdrop')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.012, .021, .036, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    scene.view_settings.view_transform = 'AgX'
    scene['seed'] = context['seed']
    scene['style'] = index
    scene['generator_version'] = GENERATOR_VERSION
    scene['scope'] = 'Airborne visual effect, Z up, origin at detonation; no ground or simulation cache'
    centers = [(Vector((0, 0, 0)), 0)]
    if index == 5:
        centers = [(Vector((-1.7, 0, .4)), 0), (Vector((.4, .25, -.4)), 7), (Vector((2.0, -.1, .9)), 14)]

    for cluster, (center, delay) in enumerate(centers):
        fire = cooling_fire(context['seed']+cluster, delay, index == 4)
        smoke = fading_smoke(context['seed']+cluster, delay)
        for i in range(flames):
            direction = sphere_direction(rng)
            offset = Vector(tuple(direction[a]*axes[a] for a in range(3))) * size * rng.uniform(.45, 1.1)
            radius = size*rng.uniform(.45, .8)
            obj = base.uv_ball('flame billow %d-%02d' % (cluster, i), center, radius, fire, segments=20, rings=12)
            obj['role'] = 'fire'
            base.animate(obj, [(1+delay, center, (.002,)*3),
                              (5+delay, center+offset*.3, tuple(v*.68 for v in axes)),
                              (12+delay, center+offset, axes),
                              (28+delay, center+offset*1.3, tuple(v*1.15 for v in axes)),
                              (72, center+offset*1.4, tuple(v*1.25 for v in axes))])
        for i in range(clouds):
            direction = sphere_direction(rng)
            offset = Vector(tuple(direction[a]*axes[a] for a in range(3))) * size * rng.uniform(.9, 2.0)
            obj = base.uv_ball('smoke billow %d-%02d' % (cluster, i), center, size*rng.uniform(.45, .78), smoke)
            obj['role'] = 'smoke'
            base.animate(obj, [(1+delay, center, (.002,)*3),
                              (9+delay, center+offset*.3, (.45,)*3),
                              (26+delay, center+offset, (1.05,)*3),
                              (72, center+offset*1.55+Vector((.65, 0, 1.15)), (1.7,)*3)])

    spark_mat = base.material('Cooling airborne embers', (1, .30, .035), emission=5)
    for i in range(sparks):
        direction = sphere_direction(rng)
        velocity = Vector(tuple(direction[a]*axes[a] for a in range(3)))*rng.uniform(2.0, 4.0)*size
        obj = base.uv_ball('fragment %02d' % i, (0, 0, 0), rng.uniform(.017, .035), spark_mat, segments=8, rings=5)
        obj['role'] = 'fragment'
        obj.rotation_euler = velocity.to_track_quat('Z', 'Y').to_euler()
        base.animate(obj, [(1, (0, 0, 0), (.001,)*3),
                          (7, velocity*.35, (.5, .5, 5)),
                          (20, velocity, (.5, .5, 2.5)),
                          (34, velocity*1.2+Vector((0, 0, -.45)), (.001,)*3),
                          (72, velocity*1.2+Vector((0, 0, -.45)), (.001,)*3)])

    for location, power in [((0, -5, 7), 1100), ((-5, 3, 2), 800)]:
        bpy.ops.object.light_add(type='AREA', location=location)
        obj = bpy.context.object
        obj.rotation_euler = (-obj.location).to_track_quat('-Z','Y').to_euler()
        obj.data.energy, obj.data.size = power, 8
    bpy.ops.object.light_add(type='POINT', location=(0, 0, 0))
    light = bpy.context.object
    light.data.color = (1, .30, .06)
    light.data.shadow_soft_size = 2
    for frame, energy in [(1, 0), (5, 950), (15, 450), (30, 0), (72, 0)]:
        light.data.energy = energy
        light.data.keyframe_insert('energy', frame=frame)

    bpy.ops.object.camera_add(location=(8, -13, 6))
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 20
    camera.rotation_euler = (Vector((0, 0, .6))-camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    # Measure every evaluated frame, including fragment endpoints, then fit the
    # full clip once. The chosen framing remains constant while the effect grows.
    meshes = [obj for obj in scene.objects if obj.type == 'MESH']
    max_x, max_y = 0, 0
    for frame in range(1, 73):
        scene.frame_set(frame)
        for obj in meshes:
            for corner in obj.bound_box:
                p = world_to_camera_view(scene, camera, obj.matrix_world @ Vector(corner))
                max_x = max(max_x, abs(p.x-.5))
                max_y = max(max_y, abs(p.y-.5))
    camera.data.ortho_scale *= max(max_x, max_y)/.45
    for f, name in [(1,'Ignition'),(12,'Expansion'),(30,'Cooling'),(72,'Dissipation')]:
        scene.timeline_markers.new(name, frame=f)
    output = Path(context['output_dir'])
    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene.frame_set(12)
    blend = output/'source.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(output/'preview.png')
    bpy.ops.render.render(write_still=True)
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    return {'outputs':[{'role':'editable','path':str(blend)}, {'role':'preview','path':str(output/'preview.png')}],
            'metrics':{'triangles':triangles,'materials':len(bpy.data.materials),
                       'file_size_bytes':blend.stat().st_size,'fingerprint':hashlib.sha256(blend.read_bytes()).hexdigest(),
                       'clip_frames':72,'camera_fit':True},
            'metadata':{'label':label,'seed':context['seed'],'no_ground':True}}
