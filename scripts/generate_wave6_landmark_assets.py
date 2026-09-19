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


def dam_wall_segment(name, x0, x1, height, bottom_thickness, top_thickness, mat, parent=None):
    y0 = dam_curve_y(x0)
    y1 = dam_curve_y(x1)
    vertices = [
        (x0, y0 + bottom_thickness / 2, 0),
        (x1, y1 + bottom_thickness / 2, 0),
        (x1, y1 - bottom_thickness / 2, 0),
        (x0, y0 - bottom_thickness / 2, 0),
        (x0, y0 + top_thickness / 2, height),
        (x1, y1 + top_thickness / 2, height),
        (x1, y1 - top_thickness / 2, height),
        (x0, y0 - top_thickness / 2, height),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    mesh = bpy.data.meshes.new(f'{name}_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
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


def build_dam(parent=None, breach_parent=None):
    concrete = material('DamConcrete', (0.37, 0.40, 0.39), 0.02, 0.82)
    concrete_light = material('DamConcreteSun', (0.50, 0.51, 0.47), 0.01, 0.76)
    wet = material('DamWetConcrete', (0.13, 0.20, 0.21), 0.01, 0.68)
    rock_mat = material('DamGranite', (0.20, 0.18, 0.16), 0.02, 0.94)
    steel = material('DamSteel', (0.055, 0.09, 0.105), 0.82, 0.28)
    warning = material('DamWarning', (0.95, 0.34, 0.025), 0.16, 0.38)
    glass = material('DamControlGlass', (0.06, 0.25, 0.31), 0.35, 0.16)
    objects = []
    segment_count = 17
    span = 900
    step = span / segment_count
    breach_indices = set(range(6, 11)) if breach_parent is not None else set()

    for index in range(segment_count):
        x0 = -span / 2 + (index * step)
        x1 = x0 + step
        x = (x0 + x1) / 2
        segment_parent = breach_parent if index in breach_indices else parent
        wall = dam_wall_segment(
            f'dam_wall_arch_{index:02d}', x0, x1, 700, 138, 38,
            concrete_light if index % 3 == 1 else concrete,
            segment_parent,
        )
        objects.append(wall)
        curve_y, yaw = dam_tangent_transform(x)
        chord = math.hypot(step, dam_curve_y(x1) - dam_curve_y(x0))
        objects.append(box(
            f'dam_wall_crown_{index:02d}', (x, curve_y, 704), (chord + 2, 48, 8), wet,
            segment_parent, rotation=(0, 0, yaw), bevel=1.2,
        ))
        if index not in (0, segment_count - 1):
            objects.append(box(
                f'dam_joint_{index:02d}_nocol', (x0, dam_curve_y(x0) + 20, 370),
                (2.2, 2.0, 580), wet, segment_parent, rotation=(0, 0, yaw),
            ))

    for x in (-360, -240, -120, 0, 120, 240, 360):
        curve_y, yaw = dam_tangent_transform(x)
        detail_parent = breach_parent if abs(x) <= 130 and breach_parent is not None else parent
        objects.append(box(
            f'dam_wall_buttress_{x:+}', (x, curve_y + 68, 270), (22, 104, 540), concrete,
            detail_parent, rotation=(0, 0, yaw), bevel=2.5,
        ))

    for x in (-288, -144, 0, 144, 288):
        curve_y, yaw = dam_tangent_transform(x)
        detail_parent = breach_parent if abs(x) <= 110 and breach_parent is not None else parent
        objects.append(box(
            f'dam_wall_spillway_frame_{x:+}', (x, curve_y + 28, 525), (64, 22, 210), steel,
            detail_parent, rotation=(0, 0, yaw), bevel=2,
        ))
        objects.append(box(
            f'dam_spillway_inset_{x:+}_nocol', (x, curve_y + 40, 525), (46, 2, 176), wet,
            detail_parent, rotation=(0, 0, yaw),
        ))
        objects.append(box(
            f'dam_warning_panel_{x:+}_nocol', (x, curve_y + 42, 648), (38, 2, 9), warning,
            detail_parent, rotation=(0, 0, yaw), bevel=1,
        ))

    for x in (-385, -275, -165, -55, 55, 165, 275, 385):
        curve_y, yaw = dam_tangent_transform(x)
        objects.append(box(
            f'dam_crest_rail_{x:+}_nocol', (x, curve_y + 27, 716), (78, 2, 12), steel,
            parent, rotation=(0, 0, yaw), bevel=0.5,
        ))
        objects.append(cylinder(
            f'dam_warning_light_{x:+}_nocol', (x, curve_y + 28, 725), 2.4, 7,
            warning, parent,
        ))

    for x in (-150, 150):
        objects.append(box(
            f'dam_powerhouse_{x:+}', (x, 105, 42), (230, 105, 84), concrete_light,
            parent, bevel=5,
        ))
        objects.append(box(
            f'dam_control_glass_{x:+}_nocol', (x, 160, 59), (155, 3, 25), glass,
            parent, bevel=1,
        ))
    for x in (-270, -90, 90, 270):
        objects.append(cylinder(
            f'dam_turbine_outlet_{x:+}', (x, 164, 38), 22, 34, steel, parent,
            rotation=(math.pi / 2, 0, 0),
        ))
        objects.append(cylinder(
            f'dam_turbine_ring_{x:+}_nocol', (x, 182, 38), 27, 4, warning, parent,
            rotation=(math.pi / 2, 0, 0),
        ))

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
    return objects


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
        scene = reset_scene('DamCollapseOnce', 5)
        rig = bpy.data.objects.new('DamBreachRig', None)
        scene.collection.objects.link(rig)
        build_dam(breach_parent=rig)
        rig.rotation_mode = 'XYZ'
        rig.keyframe_insert('location', frame=1)
        rig.keyframe_insert('rotation_euler', frame=1)
        rig.location = (0, 150, -520)
        rig.rotation_euler = (0.48, 0.07, -0.05)
        rig.keyframe_insert('location', frame=scene.frame_end)
        rig.keyframe_insert('rotation_euler', frame=scene.frame_end)
        if rig.animation_data and rig.animation_data.action:
            rig.animation_data.action.name = 'DamCollapseOnce'
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
