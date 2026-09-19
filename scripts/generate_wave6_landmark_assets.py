#!/usr/bin/env python3
"""Generate editable and runtime assets for the Wave 6 landmarks.

Blender space is metres with Z up and -Y becoming map north. The runtime places every file at
0.2 authored units per metre and the arena scales authored units by three, so one Blender metre
becomes 0.6 world units. The script is deterministic and currently builds the bridge pack; later
Wave 6 packages extend the same dispatcher with lighthouse and dam builders.
"""

import argparse
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
FPS = 30
BRIDGE_PARTS = ('01_bridge', '20_bridge_collapse')


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


def box(name, location, dimensions, mat, parent=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
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
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format='GLB', export_animations=bool(clip_name),
        export_animation_mode='SCENE' if clip_name else 'ACTIONS',
        export_anim_scene_split_object=False, export_anim_slide_to_zero=True,
        export_yup=True, export_cameras=False, export_lights=False, export_extras=True,
        export_apply=True,
    )
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    triangles = sum(len(obj.data.loop_triangles) for obj in meshes)
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--landmark', choices=('bridge',), default='bridge')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    if args.landmark == 'bridge':
        generate_bridge()


if __name__ == '__main__':
    main()
