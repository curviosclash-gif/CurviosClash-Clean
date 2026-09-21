#!/usr/bin/env python3
"""Generate editable and runtime assets for the Wave 6 landmarks.

Blender space is metres with Z up and -Y becoming map north. The runtime places every file at
0.2 authored units per metre and the arena scales authored units by three, so one Blender metre
becomes 0.6 world units. The script is deterministic and builds the three landmark packs plus
their moving obstacles.
"""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_collapse import (
    add_body, add_constraint, key_constraint_open, replay_matches,
    hull_object, rigid_world, sample_poses,
)


ROOT = Path(__file__).resolve().parents[1]
FPS = 30
BRIDGE_PARTS = ('01_bridge', '20_bridge_collapse', '30_bridge_train')
LIGHTHOUSE_PARTS = ('01_lighthouse', '20_lighthouse_collapse', '30_lighthouse_lift')
DAM_PARTS = ('01_dam', '20_dam_collapse', '30_dam_gate')


def reset_scene(name, seconds=0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = max(1, int(seconds * FPS))
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def material(name, color, metallic=0.0, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1.0)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    return mat


def box(name, location, dimensions, mat, parent=None, rotation=(0, 0, 0), bevel=0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new(name='EdgeBevel', type='BEVEL')
        modifier.width = bevel
        modifier.segments = 2
    if parent is not None:
        obj.parent = parent
    return obj


def cylinder(name, location, radius, depth, mat, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    return obj


def cone(name, location, radius1, radius2, depth, mat, parent=None):
    bpy.ops.mesh.primitive_cone_add(
        vertices=24, radius1=radius1, radius2=radius2, depth=depth, location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    return obj


def rock(name, location, dimensions, mat, parent=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    return obj


def dam_curve_y(x):
    normalized = abs(x) / 450
    return 58 * (normalized ** 1.8)


def dam_wall_segment(name, x0, x1, height, bottom_thickness, top_thickness, mat, parent=None,
                     z0=0, z1=None, fracture_mat=None):
    z1 = height if z1 is None else z1
    y0 = dam_curve_y(x0)
    y1 = dam_curve_y(x1)
    lower_thickness = bottom_thickness + (top_thickness - bottom_thickness) * z0 / height
    upper_thickness = bottom_thickness + (top_thickness - bottom_thickness) * z1 / height
    vertices = [
        (x0, y0 + lower_thickness / 2, z0),
        (x1, y1 + lower_thickness / 2, z0),
        (x1, y1 - lower_thickness / 2, z0),
        (x0, y0 - lower_thickness / 2, z0),
        (x0, y0 + upper_thickness / 2, z1),
        (x1, y1 + upper_thickness / 2, z1),
        (x1, y1 - upper_thickness / 2, z1),
        (x0, y0 - upper_thickness / 2, z1),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(f'{name}_mesh')
    center = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    mesh.from_pydata([tuple(vertex[axis] - center[axis] for axis in range(3))
                      for vertex in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = center
    obj.data.materials.append(mat)
    if fracture_mat is not None:
        # Keep the playable hull one material/one collider. Thin rough caps are
        # decorative and buried in the standing wall until neighbouring tiers move.
        face_indices = (0, 3, 5) if z1 == height else (0, 1, 3, 5)
        fracture_vertices = []
        fracture_faces = []
        for face_index in face_indices:
            polygon = mesh.polygons[face_index]
            start = len(fracture_vertices)
            for vertex_index in polygon.vertices:
                vertex = mesh.vertices[vertex_index].co + polygon.normal * 0.12
                fracture_vertices.append(tuple(vertex))
            fracture_faces.append(tuple(range(start, len(fracture_vertices))))
        fracture_mesh = bpy.data.meshes.new(f'{name}_fracture_mesh')
        fracture_mesh.from_pydata(fracture_vertices, [], fracture_faces)
        fracture_mesh.update()
        overlay = bpy.data.objects.new(f'{name}_fracture_nocol', fracture_mesh)
        bpy.context.scene.collection.objects.link(overlay)
        overlay.parent = obj
        overlay.data.materials.append(fracture_mat)
    if parent is not None:
        obj.parent = parent
    return obj


def dam_tangent_transform(x):
    delta = 1
    y0 = dam_curve_y(x - delta)
    y1 = dam_curve_y(x + delta)
    return dam_curve_y(x), math.atan2(y1 - y0, delta * 2)


def finish_action(obj, name, interpolation='BEZIER'):
    action = obj.animation_data.action
    action.name = name
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = interpolation


def build_bridge(parent=None):
    steel = material('StormSteel', (0.16, 0.24, 0.30), 0.75, 0.28)
    deck = material('BridgeDeck', (0.20, 0.22, 0.23), 0.15, 0.72)
    signal = material('BridgeSignal', (0.08, 0.55, 0.75), 0.25, 0.25)
    objects = []
    objects.append(box('bridge_span_deck', (0, 0, 34), (118, 18, 4), deck, parent))
    objects.append(box('bridge_span_spine', (0, 0, 31), (118, 4, 4), steel, parent))
    for x in (-50, 50):
        objects.append(box(f'bridge_span_tower_{x:+}', (x, 0, 40), (6, 12, 80), steel, parent))
        objects.append(box(f'bridge_span_cross_{x:+}', (x, 0, 61), (18, 5, 4), steel, parent))
    for x in range(-45, 46, 15):
        objects.append(cylinder(f'bridge_span_hanger_{x:+}', (x, 0, 50), 0.55, 28, signal, parent))
    objects.append(box('bridge_span_left_rail', (0, -8, 38), (118, 1, 5), steel, parent))
    objects.append(box('bridge_span_right_rail', (0, 8, 38), (118, 1, 5), steel, parent))
    return objects


def export_scene(asset, file_stem, clip_name=''):
    source_dir = ROOT / 'assets' / 'maps' / asset / 'blender'
    glb_dir = ROOT / 'assets' / 'maps' / asset / 'glb'
    source_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)
    blend_path = source_dir / f'{file_stem}.blend'
    glb_path = glb_dir / f'{file_stem}.glb'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.object.select_all(action='DESELECT')
    export_objects = [obj for obj in bpy.context.scene.objects if obj.type in {'MESH', 'EMPTY', 'ARMATURE'}]
    for obj in export_objects:
        obj.select_set(True)
    if export_objects:
        bpy.context.view_layer.objects.active = export_objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format='GLB', export_animations=bool(clip_name),
        export_animation_mode='SCENE' if clip_name else 'ACTIONS',
        export_anim_scene_split_object=False, export_anim_slide_to_zero=True,
        export_yup=True, export_cameras=False, export_lights=False, export_extras=True,
        export_apply=True, use_selection=True,
    )
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    print(f'generated {glb_path.relative_to(ROOT)} meshes={len(meshes)} triangles={triangles} clip={clip_name or "none"}')


def generate_bridge(parts=None):
    selected = set(parts or BRIDGE_PARTS)
    unknown = selected - set(BRIDGE_PARTS)
    if unknown:
        raise ValueError(f'Unknown bridge parts: {sorted(unknown)}')
    if '01_bridge' in selected:
        reset_scene('StormBridgeIntact')
        build_bridge()
        export_scene('storm_bridge_siege', '01_bridge')

    if '20_bridge_collapse' in selected:
        scene = reset_scene('BridgeCollapseOnce', 4)
        rig = bpy.data.objects.new('BridgeCollapseRig', None)
        scene.collection.objects.link(rig)
        build_bridge(rig)
        rig.rotation_mode = 'XYZ'
        rig.location = (0, 0, 0)
        rig.rotation_euler = (0, 0, 0)
        rig.keyframe_insert('location', frame=1)
        rig.keyframe_insert('rotation_euler', frame=1)
        rig.location = (0, 0, -27)
        rig.rotation_euler = (0.22, 0.0, 0.11)
        rig.keyframe_insert('location', frame=scene.frame_end)
        rig.keyframe_insert('rotation_euler', frame=scene.frame_end)
        if rig.animation_data and rig.animation_data.action:
            rig.animation_data.action.name = 'BridgeCollapseOnce'
        export_scene('storm_bridge_siege', '20_bridge_collapse', 'BridgeCollapseOnce')

    if '30_bridge_train' in selected:
        scene = reset_scene('BridgeTrainLoop', 12)
        rig = bpy.data.objects.new('BridgeTrainRig', None)
        scene.collection.objects.link(rig)
        steel = material('TrainSteel', (0.08, 0.16, 0.21), 0.82, 0.24)
        cabin = material('TrainCabin', (0.80, 0.18, 0.035), 0.28, 0.38)
        glass = material('TrainGlass', (0.10, 0.55, 0.70), 0.35, 0.16)
        wheel = material('TrainWheel', (0.025, 0.035, 0.04), 0.7, 0.34)
        box('bridge_train_chassis', (0, 0, 42), (24, 10, 4), steel, rig)
        box('bridge_train_body', (0, 0, 48), (18, 9, 9), cabin, rig)
        box('bridge_train_window', (5, 0, 50), (5, 9.4, 3), glass, rig)
        box('bridge_train_nose', (-10, 0, 46), (5, 9, 6), steel, rig)
        for x in (-7, 7):
            for y in (-5, 5):
                cylinder(f'bridge_train_wheel_{x:+}_{y:+}', (x, y, 40), 2.4, 1.6, wheel, rig, (1.5708, 0, 0))
        for frame, x in ((1, -72), (scene.frame_end // 2, 0), (scene.frame_end, 72)):
            rig.location = (x, 0, 0)
            rig.keyframe_insert('location', frame=frame)
        finish_action(rig, 'BridgeTrainLoop', 'LINEAR')
        export_scene('storm_bridge_siege', '30_bridge_train', 'BridgeTrainLoop')


def build_lighthouse(parent=None):
    white = material('LighthouseWhite', (0.76, 0.80, 0.79), 0.05, 0.68)
    red = material('LighthouseRed', (0.55, 0.035, 0.025), 0.18, 0.5)
    iron = material('LighthouseIron', (0.075, 0.095, 0.11), 0.72, 0.3)
    lamp = material('LighthouseLamp', (1.0, 0.72, 0.14), 0.2, 0.18)
    objects = []
    objects.append(cylinder('lighthouse_tower_foot', (0, 0, 5), 17, 10, iron, parent))
    for index, (z, radius, height, mat) in enumerate((
        (17, 14.5, 20, white), (36, 12.5, 18, red), (53, 10.5, 16, white), (68, 9, 14, red),
    )):
        objects.append(cone(f'lighthouse_tower_shaft_{index}', (0, 0, z), radius, radius - 2, height, mat, parent))
    objects.append(cylinder('lighthouse_tower_gallery', (0, 0, 78), 13, 3, iron, parent))
    objects.append(cylinder('lighthouse_tower_lantern', (0, 0, 84), 8, 10, lamp, parent))
    objects.append(cone('lighthouse_tower_roof', (0, 0, 92), 11, 0.5, 7, red, parent))
    objects.append(cylinder('lighthouse_tower_beacon', (0, 0, 84), 2.2, 15, lamp, parent, (0, 1.5708, 0)))
    return objects


def generate_lighthouse(parts=None):
    selected = set(parts or LIGHTHOUSE_PARTS)
    unknown = selected - set(LIGHTHOUSE_PARTS)
    if unknown:
        raise ValueError(f'Unknown lighthouse parts: {sorted(unknown)}')
    if '01_lighthouse' in selected:
        reset_scene('StormLighthouseIntact')
        build_lighthouse()
        export_scene('storm_lighthouse_siege', '01_lighthouse')
    if '20_lighthouse_collapse' in selected:
        scene = reset_scene('LighthouseCollapseOnce', 5)
        rig = bpy.data.objects.new('LighthouseCollapseRig', None)
        scene.collection.objects.link(rig)
        build_lighthouse(rig)
        rig.rotation_mode = 'XYZ'
        rig.keyframe_insert('location', frame=1)
        rig.keyframe_insert('rotation_euler', frame=1)
        rig.location = (4, 0, -3)
        rig.rotation_euler = (0.0, 1.28, -0.08)
        rig.keyframe_insert('location', frame=scene.frame_end)
        rig.keyframe_insert('rotation_euler', frame=scene.frame_end)
        if rig.animation_data and rig.animation_data.action:
            rig.animation_data.action.name = 'LighthouseCollapseOnce'
        export_scene('storm_lighthouse_siege', '20_lighthouse_collapse', 'LighthouseCollapseOnce')

    if '30_lighthouse_lift' in selected:
        scene = reset_scene('LighthouseLiftLoop', 10)
        rig = bpy.data.objects.new('LighthouseLiftRig', None)
        scene.collection.objects.link(rig)
        steel = material('LiftSteel', (0.09, 0.13, 0.15), 0.78, 0.28)
        platform = material('LiftPlatform', (0.84, 0.42, 0.055), 0.35, 0.42)
        lamp = material('LiftLamp', (1.0, 0.76, 0.18), 0.15, 0.2)
        box('lighthouse_lift_platform', (22, 0, 12), (12, 12, 3), platform, rig)
        for x in (17, 27):
            for y in (-5, 5):
                box(f'lighthouse_lift_post_{x}_{y:+}', (x, y, 19), (1.2, 1.2, 13), steel, rig)
        box('lighthouse_lift_roof', (22, 0, 26), (12, 12, 2), steel, rig)
        box('lighthouse_lift_warning', (22, -6.2, 19), (7, 1, 2), lamp, rig)
        for frame, z in ((1, 0), (scene.frame_end // 2, 56), (scene.frame_end, 0)):
            rig.location = (0, 0, z)
            rig.keyframe_insert('location', frame=frame)
        finish_action(rig, 'LighthouseLiftLoop')
        export_scene('storm_lighthouse_siege', '30_lighthouse_lift', 'LighthouseLiftLoop')


def parent_to_chunk(obj, chunk):
    if chunk is not None:
        bpy.context.view_layer.update()
        transform = obj.matrix_world.copy()
        obj.parent = chunk
        obj.matrix_world = transform
    return obj


def dam_cascade_mesh(mat, name='dam_breach_cascade_nocol', sections=None):
    """Faceted, uneven water sheet; the breach variant joins reservoir lip to floor jet."""
    if sections is None:
        # Cross the top of the opened wall, then stay downstream of the remaining
        # lower buttress all the way to the floor-side runtime jet at Blender Y=125.
        sections = ((475, -86, 71, 0), (470, 125, 66, -5), (445, 130, 70, 4),
                    (330, 131, 86, -7), (245, 129, 98, 6), (145, 128, 94, -3),
                    (20, 125, 108, 0))
    vertices = []
    for height, depth, half_width, offset in sections:
        vertices.extend(((offset - half_width, depth, height),
                         (offset + half_width, depth, height),
                         (offset - half_width, depth + 5, height),
                         (offset + half_width, depth + 5, height)))
    faces = []
    for index in range(len(sections) - 1):
        a = index * 4
        b = a + 4
        faces.extend(((a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3),
                      (a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1)))
    end = (len(sections) - 1) * 4
    faces.extend(((0, 2, 3, 1), (end, end + 1, end + 3, end + 2)))
    mesh = bpy.data.meshes.new(f'{name}_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def dam_crack_mesh(name, x, z0, z1, mat):
    """A narrow zigzag on the downstream wall face, invisible in the first pose."""
    vertices = []
    for index in range(7):
        z = z0 + (z1 - z0) * index / 6
        center_x = x + (3 if index % 3 == 1 else -2 if index % 3 == 2 else 0)
        face_y = dam_curve_y(center_x) + (138 - 100 * z / 700) / 2 + 0.8
        vertices.extend(((center_x - 1.5, face_y, z), (center_x + 1.5, face_y, z)))
    faces = [(2 * index, 2 * index + 1, 2 * index + 3, 2 * index + 2)
             for index in range(6)]
    mesh = bpy.data.meshes.new(f'{name}_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def build_dam(parent=None, collapse=False):
    concrete = material('DamConcrete', (0.37, 0.40, 0.39), 0.02, 0.82)
    concrete_light = material('DamConcreteSun', (0.50, 0.51, 0.47), 0.01, 0.76)
    wet = material('DamWetConcrete', (0.13, 0.20, 0.21), 0.01, 0.68)
    rock_mat = material('DamGranite', (0.20, 0.18, 0.16), 0.02, 0.94)
    steel = material('DamSteel', (0.055, 0.09, 0.105), 0.82, 0.28)
    warning = material('DamWarning', (0.95, 0.34, 0.025), 0.16, 0.38)
    glass = material('DamControlGlass', (0.06, 0.25, 0.31), 0.35, 0.16)
    water = material('DamReservoir', (0.055, 0.27, 0.34), 0.02, 0.19)
    foam = material('DamFlowFoam', (0.39, 0.72, 0.73), 0.0, 0.46)
    fracture = material('DamFractureAggregate', (0.27, 0.28, 0.26), 0.0, 0.98)
    objects = []
    pieces = {}
    segment_count = 17
    span = 900
    step = span / segment_count
    breach_indices = set(range(6, 11))
    breach_cuts = {6: (228, 466), 7: (248, 490), 8: (220, 452),
                   9: (240, 480), 10: (232, 470)}

    def chunk_for(x, z):
        index = int((x + span / 2) / step)
        if index not in breach_indices or not collapse:
            return None
        tier = 0 if z < 235 else 1 if z < 475 else 2
        return pieces.get((index, tier))

    for index in range(segment_count):
        x0 = -span / 2 + (index * step)
        x1 = x0 + step
        x = (x0 + x1) / 2
        if index in breach_indices:
            lower, upper = breach_cuts[index]
            for tier, (low, high) in enumerate(((20, lower), (lower, upper), (upper, 700))):
                # Shared tier boundaries fit without gaps. The cuts step along the five
                # spans, leaving an irregular silhouette as neighbouring blocks depart.
                wall = dam_wall_segment(
                    f'dam_wall_arch_{index:02d}_tier_{tier}', x0, x1, 700, 138, 38,
                    concrete_light if index % 3 == 1 else concrete,
                    parent, z0=low, z1=high, fracture_mat=fracture,
                )
                pieces[index, tier] = wall
                objects.append(wall)
        else:
            objects.append(dam_wall_segment(
                f'dam_wall_arch_{index:02d}', x0, x1, 700, 138, 38,
                concrete_light if index % 3 == 1 else concrete, parent,
            ))
        curve_y, yaw = dam_tangent_transform(x)
        chord = math.hypot(step, dam_curve_y(x1) - dam_curve_y(x0))
        crown = box(
            f'dam_wall_crown_{index:02d}', (x, curve_y, 704), (chord + 2, 48, 8), wet,
            parent, rotation=(0, 0, yaw), bevel=1.2,
        )
        objects.append(parent_to_chunk(crown, chunk_for(x, 704)))
        if index not in (0, segment_count - 1):
            for tier, (low, high) in enumerate(((80, 235), (235, 475), (475, 660))):
                joint = box(
                    f'dam_joint_{index:02d}_tier_{tier}_nocol',
                    (x0, dam_curve_y(x0) + 20, (low + high) / 2),
                    (2.2, 2.0, high - low), wet, parent, rotation=(0, 0, yaw),
                )
                objects.append(parent_to_chunk(joint, chunk_for(x, (low + high) / 2)))

    for x in (-360, -240, -120, 0, 120, 240, 360):
        curve_y, yaw = dam_tangent_transform(x)
        if abs(x) <= 130:
            chunk_index = int((x + span / 2) / step)
            lower, upper = breach_cuts[chunk_index]
            for tier, (low, high) in enumerate(((20, lower), (lower, upper), (upper, 540))):
                buttress = box(
                    f'dam_wall_buttress_{x:+}_tier_{tier}_nocol',
                    (x, curve_y + 68, (low + high) / 2), (22, 104, high - low), concrete,
                    parent, rotation=(0, 0, yaw), bevel=2.5,
                )
                objects.append(parent_to_chunk(buttress, chunk_for(x, (low + high) / 2)))
        else:
            objects.append(box(
                f'dam_wall_buttress_{x:+}', (x, curve_y + 68, 270), (22, 104, 540), concrete,
                parent, rotation=(0, 0, yaw), bevel=2.5,
            ))

    for x in (-288, -144, 0, 144, 288):
        curve_y, yaw = dam_tangent_transform(x)
        moving = chunk_for(x, 525)
        if x == 0:
            cut = breach_cuts[8][1]
            for tier, low, high in ((1, 420, cut), (2, cut, 630)):
                frame = box(
                    f'dam_wall_spillway_frame_{x:+}_tier_{tier}',
                    (x, curve_y + 28, (low + high) / 2), (50, 22, high - low), steel,
                    parent, rotation=(0, 0, yaw), bevel=2,
                )
                objects.append(parent_to_chunk(frame, pieces[8, tier] if collapse else None))
        else:
            frame = box(
                f'dam_wall_spillway_frame_{x:+}',
                (x, curve_y + 28, 525), (64, 22, 210), steel,
                parent, rotation=(0, 0, yaw), bevel=2,
            )
            objects.append(frame)
        inset = box(
            f'dam_spillway_inset_{x:+}_nocol', (x, curve_y + 40, 525), (46, 2, 176), wet,
            parent, rotation=(0, 0, yaw),
        )
        objects.append(parent_to_chunk(inset, moving))
        panel = box(
            f'dam_warning_panel_{x:+}_nocol', (x, curve_y + 42, 648), (38, 2, 9), warning,
            parent, rotation=(0, 0, yaw), bevel=1,
        )
        objects.append(parent_to_chunk(panel, chunk_for(x, 648)))

    for x in (-385, -275, -165, -55, 55, 165, 275, 385):
        curve_y, yaw = dam_tangent_transform(x)
        rail = box(
            f'dam_crest_rail_{x:+}_nocol', (x, curve_y + 27, 716), (78, 2, 12), steel,
            parent, rotation=(0, 0, yaw), bevel=0.5,
        )
        objects.append(parent_to_chunk(rail, chunk_for(x, 716)))
        light = cylinder(
            f'dam_warning_light_{x:+}_nocol', (x, curve_y + 28, 725), 2.4, 7,
            warning, parent,
        )
        objects.append(parent_to_chunk(light, chunk_for(x, 725)))

    for x in (-240, 240):
        objects.append(box(
            f'dam_powerhouse_{x:+}', (x, 105, 42), (150, 105, 84), concrete_light,
            parent, bevel=5,
        ))
        objects.append(box(
            f'dam_control_glass_{x:+}_nocol', (x, 160, 59), (115, 3, 25), glass,
            parent, bevel=1,
        ))
    for x in (-270, -90, 90, 270):
        moving = chunk_for(x, 38)
        outlet = cylinder(
            f'dam_turbine_outlet_{x:+}{"_nocol" if moving else ""}',
            (x, 164, 48), 22, 34, steel, parent,
            rotation=(math.pi / 2, 0, 0),
        )
        objects.append(parent_to_chunk(outlet, moving))
        ring = cylinder(
            f'dam_turbine_ring_{x:+}_nocol', (x, 182, 48), 27, 4, warning, parent,
            rotation=(math.pi / 2, 0, 0),
        )
        objects.append(parent_to_chunk(ring, moving))

    for side in (-1, 1):
        for index, (x_offset, y, z, dims) in enumerate((
            (480, 10, 150, (150, 170, 300)),
            (520, 25, 390, (180, 190, 430)),
            (560, 40, 540, (210, 210, 360)),
        )):
            objects.append(rock(
                f'dam_granite_{side:+}_{index}', (side * x_offset, y, z), dims, rock_mat, parent,
                rotation=(0, 0, 0.23 * side * (index + 1)),
            ))

    for x in (-390, -320, -250, 250, 320, 390):
        curve_y, yaw = dam_tangent_transform(x)
        objects.append(box(
            f'dam_wet_stain_{x:+}_nocol', (x, curve_y + 22, 320), (30, 1.5, 500), wet,
            parent, rotation=(0, 0, yaw),
        ))
    # Both states share the reservoir; the surface remains behind the wall at the swap.
    objects.append(box('dam_reservoir_surface_nocol', (0, -44, 475), (860, 76, 1.8), water, parent))
    backwater = dam_cascade_mesh(water, 'dam_reservoir_body_nocol', (
        (20, -88, 79, -4), (67, -87, 88, 3), (111, -88, 82, -6),
        (157, -86, 98, 5), (205, -87, 93, -3), (250, -87, 111, 7),
        (301, -86, 105, -6), (347, -88, 121, 2), (392, -87, 117, -4),
        (435, -86, 133, 5), (475, -86, 140, 0),
    ))
    if parent is not None:
        backwater.parent = parent
    objects.append(backwater)
    for index, x in enumerate((-59, -30, 12, 53)):
        # Vertical broken highlights make the deep reserve read as rushing water, from rear
        # and oblique views, rather than as a solid blue plate in the opened dam.
        stripe = dam_cascade_mesh(foam, f'dam_reservoir_rivulet_{index}_nocol', (
            (28, -82, 2.5, x - 6), (133, -81, 4, x + 3),
            (257, -82, 2, x - 4), (382, -81, 3.5, x + 7),
            (471, -81, 2, x),
        ))
        if parent is not None:
            stripe.parent = parent
        objects.append(stripe)
    if collapse:
        # The first faint crack and light spalls precede the large rigid-body release.
        # They are decorative only; the solver and in-game collider count stay bounded.
        for index, (x, low, high) in enumerate(((-62, 286, 402), (-36, 324, 430),
                                                (28, 273, 388), (61, 310, 420))):
            crack = dam_crack_mesh(f'dam_crack_{index}_nocol', x, low, high, wet)
            crack = parent_to_chunk(crack, chunk_for(x, (low + high) / 2))
            crack.scale = (0, 0, 0)
            crack.keyframe_insert('scale', frame=1)
            crack.scale = (1, 1, 1)
            crack.keyframe_insert('scale', frame=5)
            objects.append(crack)
        for index, x in enumerate((-66, -39, -17, 14, 38, 63)):
            z = 295 + (index % 3) * 42
            y = dam_curve_y(x) + (138 - 100 * z / 700) / 2 + 7
            chip = rock(f'dam_spall_{index}_nocol', (x, y, z),
                        (7 + index % 3 * 2, 5 + index % 2 * 2, 9 + index % 3), fracture)
            start = chip.location.copy()
            chip.scale = (0, 0, 0)
            chip.keyframe_insert('scale', frame=1)
            chip.location = start
            chip.keyframe_insert('location', frame=1)
            chip.keyframe_insert('rotation_euler', frame=1)
            chip.scale = (1, 1, 1)
            chip.keyframe_insert('scale', frame=5 + index % 3)
            chip.location = (start.x + (index - 2.5) * 2, start.y + 10, start.z - 5)
            chip.keyframe_insert('location', frame=5 + index % 3)
            chip.rotation_euler = (1.1 + index * 0.2, 0.8 + index * 0.13, index * 0.31)
            local_floor = min((chip.rotation_euler.to_matrix() @ vertex.co).z
                              for vertex in chip.data.vertices)
            chip.location = (start.x + (index - 2.5) * 8, start.y + 100 + index * 6,
                             20 - local_floor + 0.5)
            chip.keyframe_insert('location', frame=71 + index * 3)
            chip.keyframe_insert('rotation_euler', frame=71 + index * 3)
            objects.append(chip)
        flow = dam_cascade_mesh(water)
        for index, height in enumerate((54, 118, 184, 263, 346, 420)):
            depth = 131
            stripe = box(f'dam_cascade_foam_{index}_nocol',
                         ((index % 3 - 1) * 23, depth, height),
                         (60 + (index % 2) * 35, 1.4, 2.8), foam,
                         rotation=(0, 0, (index % 3 - 1) * 0.08))
            objects.append(parent_to_chunk(stripe, flow))
        flow.scale = (0, 0, 0)
        flow.keyframe_insert('scale', frame=1)
        flow.scale = (1, 1, 1)
        flow.keyframe_insert('scale', frame=1 + round(0.9 * FPS))
        objects.append(flow)
    return objects, pieces


def bake_dam_breach(scene, pieces):
    # The exported metre becomes 0.6 world units. Dam-only gravity brings the
    # 700-unit crown down during the breach without changing any
    # global physics helper or runtime gameplay force.
    rigid_world(scene, scene.frame_end)
    scene.gravity = (0, 0, -85)
    floor = box('dam_simulation_floor', (0, 385, 10), (1200, 1030, 20),
                bpy.data.materials['DamConcrete'])
    add_body(floor, 'PASSIVE', 'BOX')
    back_stop = box('dam_simulation_closed_rear', (0, -110, 460), (1200, 20, 920),
                    bpy.data.materials['DamConcrete'])
    add_body(back_stop, 'PASSIVE', 'BOX')
    front_stop = box('dam_simulation_closed_front', (0, 890, 460), (1200, 20, 920),
                     bpy.data.materials['DamConcrete'])
    add_body(front_stop, 'PASSIVE', 'BOX')
    anchor = box('dam_simulation_anchor', (0, 0, -2000), (1, 1, 1),
                 bpy.data.materials['DamConcrete'])
    add_body(anchor, 'PASSIVE', 'BOX')
    static_obstacles = [obj for obj in scene.objects if obj.type == 'MESH'
                        and (obj.name.startswith('dam_wall_arch_') and '_tier_' not in obj.name
                             or obj.name.startswith('dam_powerhouse_'))]
    # The right shoulder keeps one high tooth anchored to the adjacent intact span.
    static_obstacles.extend((pieces[6, 0], pieces[10, 0], pieces[10, 2]))
    static_transforms = {obj.name: obj.matrix_world.copy() for obj in static_obstacles}
    for obstacle in static_obstacles:
        add_body(obstacle, 'PASSIVE', 'CONVEX_HULL')
    proxies = {}
    joints = []
    originals = {}
    bpy.context.view_layer.update()
    for (index, tier), piece in sorted(pieces.items()):
        if (tier == 0 and index in (6, 10)) or (index, tier) == (10, 2):
            continue
        piece.rotation_mode = 'QUATERNION'
        original = piece.location.copy()
        local_from_world = piece.matrix_world.inverted()
        solid_parts = [piece, *(child for child in piece.children if child.type == 'MESH'
                                  and child.name.startswith((
                                      'dam_wall_buttress_', 'dam_wall_spillway_frame_',
                                      'dam_wall_crown_', 'dam_turbine_outlet_',
                                  )))]
        points = []
        for part in solid_parts:
            transform = local_from_world @ part.matrix_world
            points.extend(tuple(transform @ vertex.co) for vertex in part.data.vertices)
        proxy = hull_object(f'dam_simulation_{index}_{tier}', points, location=piece.location)
        proxy.rotation_mode = 'QUATERNION'
        body = add_body(proxy, 'ACTIVE', 'CONVEX_HULL', mass=250 + tier * 20)
        body.use_margin = True
        body.collision_margin = 0.08
        body.linear_damping = 0.8
        body.angular_damping = 0.8
        body.friction = 0.9
        body.use_deactivation = True
        body.deactivate_linear_velocity = 0.4
        body.deactivate_angular_velocity = 0.08
        release_seconds = (2.2 + abs(index - 8) * 0.25 if tier == 0
                           else 0.32 + tier * 0.20 + abs(index - 8) * 0.24)
        release = 1 + round(release_seconds * FPS)
        joint = add_constraint(f'dam_joint_release_{index}_{tier}', proxy.location, anchor, proxy)
        key_constraint_open(joint, scene, release)
        # The reservoir drives each newly free block into the arena. A short keyed
        # kinematic shove supplies that pressure before Bullet takes over the fall.
        body.kinematic = True
        proxy.keyframe_insert('rigid_body.kinematic', frame=1)
        proxy.keyframe_insert('location', frame=1)
        proxy.keyframe_insert('location', frame=release - 1)
        proxy.keyframe_insert('rotation_quaternion', frame=1)
        proxy.keyframe_insert('rotation_quaternion', frame=release - 1)
        pressure = 30 if tier == 0 else (90 if tier == 1 and index == 8 else 70 if tier == 1 else 80)
        proxy.location.y = original.y + pressure
        tilt = 0 if tier == 0 else (0.17 if tier == 1 else 0.24) + 0.02 * (index - 8)
        if tier == 1 and index == 8:
            tilt = 0.52
        proxy.rotation_quaternion = Quaternion((1, 0, 0), -tilt)
        proxy.keyframe_insert('location', frame=release + 30)
        proxy.keyframe_insert('rotation_quaternion', frame=release + 30)
        for curve in proxy.animation_data.action.fcurves:
            if curve.data_path == 'location':
                for point in curve.keyframe_points:
                    point.interpolation = 'BEZIER'
                    point.handle_left_type = 'AUTO_CLAMPED'
                    point.handle_right_type = 'AUTO_CLAMPED'
        body.kinematic = False
        proxy.keyframe_insert('rigid_body.kinematic', frame=release + 31)
        for curve in proxy.animation_data.action.fcurves:
            if curve.data_path == 'rigid_body.kinematic':
                for point in curve.keyframe_points:
                    point.interpolation = 'CONSTANT'
        proxy.location = original
        joints.append(joint)
        proxies[piece.name] = proxy
        originals[piece.name] = original
    initial = {name: piece.matrix_world.translation.copy() for name, piece in proxies.items()}
    samples = sample_poses(scene, proxies, scene.frame_end)
    equal, mismatch = replay_matches(scene, proxies, scene.frame_end, samples)
    if not equal:
        raise RuntimeError(f'Dam Bullet replay diverged at {mismatch}')
    first_error = max((samples[0][name][0] - location).length
                      for name, location in initial.items())
    displacements = {name: (samples[-1][name][0] - samples[0][name][0]).length
                     for name in proxies}
    tail_step = max((samples[frame][name][0] - samples[frame - 1][name][0]).length
                    for frame in range(len(samples) - 29, len(samples)) for name in proxies)
    peak_frame, peak_piece = max(
        ((frame, name) for frame in range(len(samples) - 29, len(samples)) for name in proxies),
        key=lambda pair: (samples[pair[0]][pair[1]][0]
                          - samples[pair[0] - 1][pair[1]][0]).length,
    )
    tail_piece = max(proxies, key=lambda name: (samples[-1][name][0] - samples[-2][name][0]).length)
    tail_turn = max(samples[frame][name][1].rotation_difference(
        samples[frame - 1][name][1]).angle
        for frame in range(len(samples) - 29, len(samples)) for name in proxies)
    floor_low, floor_piece, floor_frame = min(
        ((min((location + rotation @ vertex.co).z for vertex in proxies[name].data.vertices),
          name, frame)
         for frame, pose in enumerate(samples)
         for name, (location, rotation) in pose.items()),
        key=lambda entry: entry[0],
    )
    print(f'dam rigid replay matches frames={len(samples)} pieces={len(proxies)} '
          f'first_error={first_error:.6f} min_displacement={min(displacements.values()):.3f} '
          f'max_displacement={max(displacements.values()):.3f} '
          f'tail_step={tail_step:.3f} peak={peak_piece}@{peak_frame} tail_piece={tail_piece} '
          f'tail_position={tuple(round(v, 2) for v in samples[-1][tail_piece][0])} '
          f'tail_turn={tail_turn:.6f} floor_low={floor_low:.3f} '
          f'floor_piece={floor_piece}@{floor_frame}')
    if (first_error > 0.001 or sum(value > 15 for value in displacements.values()) < 12
            or tail_step > 0.2 or tail_turn > math.radians(0.5) or floor_low < 19.9):
        raise RuntimeError('Dam did not begin intact or move its major pieces independently')
    # A full Bullet run settles the rubble before export. Time-map its sampled poses into
    # the existing event's visual window; the mapping is monotone, so contacts and falls
    # remain the solver's exact poses and the last 0.4 s holds a measured quiet ruin.
    clip_frames = 6 * FPS
    retimed = []
    for output_frame in range(clip_frames):
        seconds = output_frame / FPS
        source_duration = (len(samples) - 1) / FPS
        source_seconds = min(source_duration, seconds if seconds <= 1.0
                             else 1.0 + (seconds - 1.0) * 3.0 if seconds <= 3.0
                             else 7.0 + (seconds - 3.0) * ((source_duration - 7.0) / 2.6))
        source_frame = min(len(samples) - 1, source_seconds * FPS)
        before = int(source_frame)
        after = min(len(samples) - 1, before + 1)
        alpha = source_frame - before
        retimed.append({
            name: (samples[before][name][0].copy().lerp(samples[after][name][0], alpha),
                   samples[before][name][1].slerp(samples[after][name][1], alpha))
            for name in proxies
        })
    # Clear only simulation objects. The rendered pieces keep their authored mesh and names.
    bpy.ops.object.select_all(action='DESELECT')
    for joint in joints:
        joint.select_set(True)
    bpy.context.view_layer.objects.active = joints[0]
    bpy.ops.object.delete()
    bpy.ops.object.select_all(action='DESELECT')
    for proxy in proxies.values():
        proxy.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(proxies.values()))
    bpy.ops.object.delete()
    for obstacle in static_obstacles:
        bpy.ops.object.select_all(action='DESELECT')
        obstacle.select_set(True)
        bpy.context.view_layer.objects.active = obstacle
        bpy.ops.rigidbody.object_remove()
        obstacle.matrix_world = static_transforms[obstacle.name]
    bpy.data.objects.remove(floor, do_unlink=True)
    bpy.data.objects.remove(back_stop, do_unlink=True)
    bpy.data.objects.remove(front_stop, do_unlink=True)
    bpy.data.objects.remove(anchor, do_unlink=True)
    bpy.ops.rigidbody.world_remove()
    scene.frame_end = clip_frames
    for frame, poses in enumerate(retimed, start=1):
        for name, (location, rotation) in poses.items():
            piece = next(part for part in pieces.values() if part.name == name)
            piece.location = originals[name] + (location - initial[name])
            piece.rotation_quaternion = rotation
            piece.keyframe_insert('location', frame=frame)
            piece.keyframe_insert('rotation_quaternion', frame=frame)
    scene.frame_set(1)
    for piece in pieces.values():
        if piece.animation_data and piece.animation_data.action:
            piece.animation_data.action.name = 'DamCollapseOnce'


def generate_dam(parts=None):
    selected = set(parts or DAM_PARTS)
    unknown = selected - set(DAM_PARTS)
    if unknown:
        raise ValueError(f'Unknown dam parts: {sorted(unknown)}')
    if '01_dam' in selected:
        reset_scene('StormDamIntact')
        build_dam()
        export_scene('storm_dam_siege', '01_dam')
    if '20_dam_collapse' in selected:
        scene = reset_scene('DamCollapseOnce', 60)
        _, pieces = build_dam(collapse=True)
        bake_dam_breach(scene, pieces)
        export_scene('storm_dam_siege', '20_dam_collapse', 'DamCollapseOnce')

    if '30_dam_gate' in selected:
        scene = reset_scene('DamGateLoop', 8)
        rig = bpy.data.objects.new('DamGateRig', None)
        scene.collection.objects.link(rig)
        steel = material('GateSteel', (0.055, 0.12, 0.15), 0.88, 0.22)
        warning = material('GateWarning', (0.98, 0.42, 0.025), 0.22, 0.34)
        box('dam_gate_slab', (0, 42, 525), (58, 10, 188), steel, rig, bevel=2)
        for z in (465, 495, 525, 555, 585):
            box(f'dam_gate_warning_{z}', (0, 43, z), (49, 1.2, 5), warning, rig)
        for frame, z in ((1, 0), (scene.frame_end // 2, 145), (scene.frame_end, 0)):
            rig.location = (0, 0, z)
            rig.keyframe_insert('location', frame=frame)
        finish_action(rig, 'DamGateLoop')
        export_scene('storm_dam_siege', '30_dam_gate', 'DamGateLoop')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--landmark', choices=('bridge', 'lighthouse', 'dam'), default='bridge')
    parser.add_argument('--part')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    if args.landmark == 'bridge':
        generate_bridge([args.part] if args.part else None)
    elif args.landmark == 'lighthouse':
        generate_lighthouse([args.part] if args.part else None)
    elif args.landmark == 'dam':
        generate_dam([args.part] if args.part else None)


if __name__ == '__main__':
    main()
