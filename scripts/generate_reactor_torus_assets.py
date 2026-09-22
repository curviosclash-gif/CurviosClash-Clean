"""Compile the four authored Blender volume designs into bounded animated game meshes.

Keeps the existing reactor ruin, fireball curve, dust extent and 49-second clock.
The source .blend materials provide proportions and colours; volume shaders are
represented by shaded billows with actual poloidal motion for glTF compatibility.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_reactor_site_assets as reactor

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'src/core/config/maps/presets/reactor_site/ReactorTorusCloudConfig.json').read_text())
TARGET_TOP = (CONFIG['baseMapHeight'] * CONFIG['mapHeightMultiplier'] * CONFIG['cloudTopMultiplier'] - 8) / .6
ORIGINAL_POSE = reactor.cloud_pose
VORTEX = json.loads((ROOT / 'src/shared/vfx/ReactorVortexProfiles.json').read_text())
GENERATOR_ID = 'reactor-torus-runtime'
GENERATOR_VERSION = '3.0.0'


def stem_profile(height):
    profile = VORTEX['stemProfile']
    u = min(1, max(0, (height - profile['lowerHeight']) / (profile['upperHeight'] - profile['lowerHeight'])))
    return profile['lower'] + (profile['upper'] - profile['lower']) * u * u * (3 - 2 * u)


def billow(canvas, material, center, radius, squash=1, steps=8, segments=16):
    """Smooth closed cloud lobe with multi-scale silhouette erosion."""
    vertices, faces = reactor.revolve_geometry(
        reactor.spheroid_profile(radius, radius * squash, radius * squash, steps=steps), segments)
    seed = Vector(center) * 7.1 + Vector((2.4, 8.2, 3.7))
    for i, point in enumerate(vertices):
        direction = Vector((point[0], point[1], point[2] / squash)) / radius
        coarse = noise.noise(direction * 2.3 + seed, noise_basis='PERLIN_ORIGINAL')
        fine = noise.noise(direction * 7 + seed, noise_basis='PERLIN_ORIGINAL')
        vertices[i] = tuple(Vector(point) * (1 + .28 * coarse + .1 * fine))
    canvas._add(material, True, vertices, faces, Matrix.Translation(Vector(center)), smooth=True)


def replace_billows(name, builder):
    rig = bpy.data.objects[name]
    for obj in list(rig.children):
        bpy.data.objects.remove(obj, do_unlink=True)
    canvas = reactor.SmoothCanvas()
    builder(canvas)
    canvas.emit(f'piece_reactor_{name}', parent=rig)


def read_design(index):
    source = ROOT / f'assets/vfx/torus-explosions/torus-explosion-v{index:02d}/source.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    bpy.context.scene.frame_set(144)
    material = bpy.data.materials['Torus smoke | animated physical coordinates']
    nodes = material.node_tree.nodes
    return {
        'profile': VORTEX['profiles'][index - 1],
        'radius': nodes['01 Major radius'].outputs[0].default_value,
        'tube': nodes['03 Tube radius'].outputs[0].default_value,
        'height': nodes['02 Altitude'].outputs[0].default_value,
        'color': tuple(nodes['Smoke and fire'].inputs['Color'].default_value),
    }


def build_cloud(scene, design):
    reactor.cloud_pose = ORIGINAL_POSE
    reactor.build_mushroom_cloud(scene, None)
    roll = bpy.data.objects['roll']
    profile = design['profile']
    roll['vortexProfile'] = profile['id']
    for obj in list(roll.children):
        bpy.data.objects.remove(obj, do_unlink=True)
    pivots = []
    tube = .26 * (design['tube'] / design['radius']) / (1.188 / 3.6)
    roll['vortexTubeRatio'] = tube
    # Twenty overlapping sectors. Each turns through its own radial/vertical
    # plane: at the outside gas moves down, at the inside it rises.
    for sector in range(20):
        azimuth = math.tau * sector / 20
        pivot = reactor.et.rig(f'torus_flow_{sector:02d}')
        pivot.parent = roll
        pivot.location = (.90 * math.cos(azimuth), .90 * math.sin(azimuth), 0)
        canvas = reactor.SmoothCanvas()
        phase = math.tau * reactor.et.hash01(sector, design['radius'], 4)
        for lobe in range(3):
            angle = phase + math.tau * lobe / 3
            size = .22 + .055 * reactor.et.hash01(sector, lobe, design['height'])
            billow(canvas, reactor.CLOUD if lobe != 1 else reactor.CLOUD_DARK,
                         (tube * math.cos(angle), 0, tube * math.sin(angle)),
                         size, squash=.95)
        canvas.emit(f'piece_reactor_torus_{sector:02d}', parent=pivot)
        pivots.append((pivot, azimuth))

    def cap(canvas):
        billow(canvas, reactor.CLOUD, (0, 0, .12), .75, squash=.6, steps=12, segments=24)
        for row, (reach, height, count, size) in enumerate(((.66, .16, 18, .27), (.37, .40, 12, .25), (.08, .51, 4, .23))):
            for i in range(count):
                angle = math.tau * i / count + row * .4
                billow(canvas, reactor.CLOUD, (reach * math.cos(angle), reach * math.sin(angle), height),
                       size * (.85 + .3 * reactor.et.hash01(i, row, design['radius'])))

    def stem(canvas):
        for level in range(14):
            z = (level + .95) / 15
            width = (.66 + .5 * abs(z - .45)) * (1 + .65 * max(0, (z - .65) / .35) ** 2)
            for side in range(3):
                angle = math.tau * side / 3 + level * .63
                billow(canvas, reactor.CLOUD_DARK,
                       (.40 * width * math.cos(angle), .40 * width * math.sin(angle), z),
                       width * .68, squash=.085, steps=6, segments=12)

    replace_billows('cap', cap)
    replace_billows('stem', stem)
    # Deform the existing sections, not their height: the endpoints are exact
    # diameter ratios against the frozen v2 geometry, including its upper flare.
    # Secondary plumes retain their own small wisps; widening their offset
    # centres as well would create disconnected, oversized side arms.
    for name in ('stem',):
        for obj in bpy.data.objects[name].children_recursive:
            if obj.type != 'MESH':
                continue
            for vertex in obj.data.vertices:
                factor = stem_profile(vertex.co.z)
                vertex.co.x *= factor
                vertex.co.y *= factor

    rgb = ((.31, .22, .14, 1), (.40, .29, .12, 1), (.43, .48, .52, 1), (.16, .17, .18, 1))[profile['id'] - 1]
    for name, factor in [(reactor.CLOUD, 1), (reactor.CLOUD_DARK, .65), (reactor.DUST, .77)]:
        mat = bpy.data.materials[name]
        color = tuple(v * factor for v in rgb[:3]) + (1,)
        mat.diffuse_color = color
        shader = mat.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value = color
        shader.inputs['Roughness'].default_value = 1
        shader.inputs['Specular IOR Level'].default_value = 0
    # Neutral vertex colours retain the four source palettes rather than the
    # original pack's baked brown tint. Ruin and fire keep their original data.
    for obj in scene.objects:
        if obj.type == 'MESH' and any(m.name in (reactor.CLOUD, reactor.CLOUD_DARK, reactor.DUST)
                                      for m in obj.data.materials):
            for attribute in list(obj.data.color_attributes):
                obj.data.color_attributes.remove(attribute)
            # Low-contrast self-shadow detail travels with the rolling lobes.
            colors = []
            for vertex in obj.data.vertices:
                value = .83 + .17 * noise.noise(vertex.co * 19 + Vector((4, 8, 2)))
                colors.append((value, value, value, 1))
            reactor.et.apply_vertex_colors(obj.data, colors)

    width = math.sqrt(design['radius'] / 3.6)
    thickness = design['tube'] / 1.188
    # Preserve the apron, ruin and spherical burn envelope. Only the smoke
    # climbs to the new ceiling; stretching the whole GLB would stretch fire.
    def pose(t, extra_height):
        values = ORIGINAL_POSE(t)
        smoke_time = 48 * (min(1, max(0, t / 48)) ** profile['riseExponent'])
        smoke_pose = ORIGINAL_POSE(smoke_time)
        for name in ('cap', 'roll', 'bloom', 'stem', 'plume'):
            values[name] = smoke_pose[name]
        progress = min(1, max(0, (smoke_time - reactor.CAP_START_SECONDS) / reactor.CAP_RISE_SECONDS)) ** .5
        head_growth = 1 + (VORTEX['headWidth'] - 1) * min(1, max(0, t / 40)) ** .7
        stem_growth = 1 + (VORTEX['stemWidth'] - 1) * min(1, max(0, t / 40)) ** .7
        widening = min(1, max(0, t / 24))
        stem_growth *= .4 + .6 * widening * widening * (3 - 2 * widening)
        for name, onset in (('front', reactor.FRONT_START_SECONDS), ('ring', reactor.RING_START_SECONDS)):
            dust_pose = ORIGINAL_POSE(t + onset - .28)[name]
            loc, scale, yaw = dust_pose
            values[name] = (loc, (scale[0], scale[1], scale[2] * .55), values[name][2])
        lift = extra_height * progress
        for name in ('cap', 'roll', 'bloom'):
            loc, scale, yaw = values[name]
            values[name] = ((loc[0], loc[1], loc[2] + lift),
                            (scale[0] * width * head_growth, scale[1] * width * head_growth, scale[2] * thickness * (.90 if name == 'cap' else 1)),
                            0 if name == 'roll' else yaw)
        for name in ('stem', 'plume'):
            loc, scale, yaw = values[name]
            values[name] = (loc, (scale[0] * stem_growth, scale[1] * stem_growth, scale[2] + lift * (1 if name == 'stem' else .8)), yaw)
        return values

    def circulation(t, azimuth):
        return (7.5 * profile['circulation'] * (1 - math.exp(-t / 20))
                + profile['turbulence'] * math.sin(azimuth * 3 + t * .3) * (1 - math.exp(-t / 5)))

    # Measure the actual visible final cap, not a rig origin, before choosing lift.
    final = pose(48, 0)
    for name, (loc, scale, yaw) in final.items():
        obj = bpy.data.objects[name]
        obj.location, obj.scale, obj.rotation_euler = loc, scale, (0, 0, yaw)
    for pivot, azimuth in pivots:
        pivot.rotation_euler = (0, circulation(48, azimuth), azimuth)
    bpy.context.view_layer.update()
    top = max((obj.matrix_world @ vertex.co).z
              for name in ('cap', 'roll', 'bloom')
              for obj in bpy.data.objects[name].children_recursive if obj.type == 'MESH'
              for vertex in obj.data.vertices)
    lift = TARGET_TOP - top
    for frame in range(scene.frame_start, scene.frame_end + 1):
        t = min(48, (frame - scene.frame_start) / reactor.FPS)
        for name, (location, scale, yaw) in pose(t, lift).items():
            reactor.et.keyframe(bpy.data.objects[name], frame,
                                location=location, scale=scale, rotation=(0, 0, yaw))
        for pivot, azimuth in pivots:
            reactor.et.keyframe(pivot, frame, rotation=(0, circulation(t, azimuth), azimuth))
    scene['generator_version'] = GENERATOR_VERSION
    scene['source_design'] = json.dumps(design)
    scene['cloud_top_metres'] = TARGET_TOP
    scene['physics'] = 'Buoyant toroidal circulation: inner upflow, outer downflow; slowing with entrainment.'


def build_variant(context):
    index = int(context['parameters']['style'])
    destination = Path(context['output_dir']) if context.get('output_dir') else None
    source_dir = destination / 'blender' if destination else ROOT / 'assets/maps/reactor_site/blender/torus'
    glb_dir = destination / 'glb' if destination else ROOT / 'assets/maps/reactor_site/glb'
    source_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)
    reactor.et.ROOT = destination or ROOT
    reactor.et.SOURCE_DIR, reactor.et.GLB_DIR = source_dir, glb_dir
    design = read_design(index)
    reactor.et.export_setpiece(f'torus_cloud_{index}', 'MushroomCloudOnce', 49,
                              lambda scene, _mats: build_cloud(scene, design))
    blend, glb = source_dir / f'torus_cloud_{index}.blend', glb_dir / f'torus_cloud_{index}.glb'
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    def triangles(objects):
        total = 0
        for obj in objects:
            obj.data.calc_loop_triangles()
            total += len(obj.data.loop_triangles)
        return total
    expected = triangles(meshes)
    count = len(meshes)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(glb))
    bpy.context.scene.frame_set(1441)
    imported = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    assert len(imported) == count and triangles(imported) == expected
    top = max((obj.matrix_world @ v.co).z for obj in imported for v in obj.data.vertices)
    assert abs(top - TARGET_TOP) < .02, top
    assert bpy.data.actions and bpy.data.objects['roll']['vortexProfile'] == index
    import hashlib
    return {'outputs': [{'role': 'editable', 'path': str(blend)}, {'role': 'runtime', 'path': str(glb)}],
            'metrics': {'triangles': expected, 'materials': len(bpy.data.materials),
                        'file_size_bytes': blend.stat().st_size + glb.stat().st_size,
                        'roundtrip_import': True, 'fingerprint': hashlib.sha256(glb.read_bytes()).hexdigest()},
            'metadata': {'profile': design['profile'], 'top_metres': top}}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--variant', type=int, choices=range(1, 5))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for index in ([args.variant] if args.variant else range(1, 5)):
        build_variant({'parameters': {'style': index}})


if __name__ == '__main__':
    main()
