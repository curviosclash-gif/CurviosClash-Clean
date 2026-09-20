#!/usr/bin/env python3
"""Build the deterministic antik-futurist Pyramid arena asset kit for Blender 4.2.

Blender coordinates use metres, Z up, with the playable plaza centred on the origin.
The seven modular GLBs are conservative core glTF 2.0 and use boxy, low-cost geometry
that doubles as deliberately simple gameplay collision.
"""

import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / 'assets' / 'maps' / 'pyramid'
SEED = 44221
PARTS = ('01_terrain', '02_sun_king_exterior', '03_sun_king_interior',
         '04_dawn_pyramid', '05_dusk_pyramid', '06_sun_plaza',
         '07_beacons_portals')


def reset_scene(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene['asset_family'] = 'pyramid_sandstorm'
    scene['seed'] = SEED
    scene['blender_contract'] = '4.2 core glTF 2.0'
    return scene


def make_material(name, color, metallic=0.0, roughness=0.6, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission[0], 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    mat.diffuse_color = (*color, 1.0)
    return mat


def materials():
    return {
        'Sandstone': make_material('Sandstone', (0.48, 0.255, 0.105), 0.02, 0.9),
        'SunSandstone': make_material('SunSandstone', (0.70, 0.43, 0.17), 0.02, 0.84),
        'ShadowSandstone': make_material('ShadowSandstone', (0.18, 0.075, 0.035), 0.04, 0.92),
        'GoldBronze': make_material('GoldBronze', (0.55, 0.22, 0.035), 0.84, 0.28),
        'Lapis': make_material('LapisLazuli', (0.012, 0.055, 0.28), 0.26, 0.31),
        'CyanRune': make_material('CyanRune', (0.02, 0.40, 0.52), 0.1, 0.24, ((0.01, 0.72, 1.0), 3.2)),
        'AmberRune': make_material('AmberRune', (0.72, 0.18, 0.01), 0.15, 0.25, ((1.0, 0.22, 0.01), 3.0)),
        'CollisionProxy': make_material('CollisionProxy', (0.08, 0.08, 0.08), 0, 1),
    }


def box(name, location, dimensions, mat, bevel=0.0):
    # Calls use (game X, game Z, game Y); Blender is Z-up and glTF exports Y-up.
    x, z, y = location
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('SoftStoneEdges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
    return obj


def cylinder(name, location, radius, depth, mat, vertices=16, rotation=(0, 0, 0)):
    x, z, y = location
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
        location=(x, -z, y), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def ramp(name, location, dimensions, angle_degrees, mat):
    obj = box(name, location, dimensions, mat, .12)
    obj.rotation_euler.x = math.radians(angle_degrees)
    return obj


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    x, z, y = location
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius,
        major_segments=24, minor_segments=8, location=(x, -z, y), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def collision_shell(prefix, x, centre_z, base, height, bands, mat):
    """One low-poly closed wall mesh with authored ground and high doorway gaps."""
    vertices, faces = [], []
    thickness = 1.25

    def point(game_x, game_z, game_y):
        return (game_x, -game_z, game_y)

    def quad(points):
        start = len(vertices)
        vertices.extend(point(*entry) for entry in points)
        faces.append((start, start + 1, start + 2, start + 3))

    def prism(outer, inner):
        quad(outer)
        quad(tuple(reversed(inner)))
        for index in range(4):
            following = (index + 1) % 4
            quad((outer[index], outer[following], inner[following], inner[index]))

    for low, high, opening in bands:
        low_half = base * 0.5 * max(0, 1 - low / height)
        high_half = base * 0.5 * max(0, 1 - high / height)
        spans = [(-low_half, low_half, -high_half, high_half)]
        if opening > 0:
            spans = [(-low_half, -opening, -high_half, -opening),
                     (opening, low_half, opening, high_half)]
        for low_a, low_b, high_a, high_b in spans:
            for sign in (-1, 1):
                low_z = centre_z + sign * low_half
                high_z = centre_z + sign * high_half
                inner_low_z = low_z - sign * thickness
                inner_high_z = high_z - sign * min(thickness, high_half)
                prism(((x + low_a, low_z, low), (x + low_b, low_z, low),
                       (x + high_b, high_z, high), (x + high_a, high_z, high)),
                      ((x + low_a, inner_low_z, low), (x + low_b, inner_low_z, low),
                       (x + high_b, inner_high_z, high), (x + high_a, inner_high_z, high)))
                low_x = x + sign * low_half
                high_x = x + sign * high_half
                inner_low_x = low_x - sign * thickness
                inner_high_x = high_x - sign * min(thickness, high_half)
                prism(((low_x, centre_z + low_a, low), (low_x, centre_z + low_b, low),
                       (high_x, centre_z + high_b, high), (high_x, centre_z + high_a, high)),
                      ((inner_low_x, centre_z + low_a, low), (inner_low_x, centre_z + low_b, low),
                       (inner_high_x, centre_z + high_b, high), (inner_high_x, centre_z + high_a, high)))
    mesh = bpy.data.meshes.new(f'COL_{prefix}_shell_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    collider = bpy.data.objects.new(f'COL_{prefix}_shell_colonly', mesh)
    bpy.context.collection.objects.link(collider)
    collider.data.materials.append(mat)
    collider['collision_role'] = 'simplified_shell'
    return collider


def pyramid_shell(prefix, x, y, base, height, stone, trim, rune, steps=12):
    """Stepped rings keep the silhouette while leaving the centre economical/open."""
    for level in range(steps):
        ratio = 1 - level / steps
        side = base * ratio
        z = level * height / steps
        thickness = max(2.2, base / 34)
        ring_h = height / steps + 0.18
        opening = 18 if level < 3 else (12 if prefix == 'king' and level in (8, 9) else 0)
        if opening:
            segment = max(1, (side - opening) * .5)
            for suffix, dx, dy, dims in (
                ('north_l', -(opening + segment) * .5, side / 2 - thickness / 2, (segment, thickness, ring_h)),
                ('north_r', (opening + segment) * .5, side / 2 - thickness / 2, (segment, thickness, ring_h)),
                ('south_l', -(opening + segment) * .5, -side / 2 + thickness / 2, (segment, thickness, ring_h)),
                ('south_r', (opening + segment) * .5, -side / 2 + thickness / 2, (segment, thickness, ring_h)),
                ('east_l', side / 2 - thickness / 2, -(opening + segment) * .5, (thickness, segment, ring_h)),
                ('east_r', side / 2 - thickness / 2, (opening + segment) * .5, (thickness, segment, ring_h)),
                ('west_l', -side / 2 + thickness / 2, -(opening + segment) * .5, (thickness, segment, ring_h)),
                ('west_r', -side / 2 + thickness / 2, (opening + segment) * .5, (thickness, segment, ring_h)),
            ):
                box(f'{prefix}_step_{level:02d}_{suffix}_nocol', (x + dx, y + dy, z + ring_h / 2), dims,
                    stone, 0.16)
        else:
            for suffix, dx, dy, dims in (
                ('north', 0, side / 2 - thickness / 2, (side, thickness, ring_h)),
                ('south', 0, -side / 2 + thickness / 2, (side, thickness, ring_h)),
                ('east', side / 2 - thickness / 2, 0, (thickness, side, ring_h)),
                ('west', -side / 2 + thickness / 2, 0, (thickness, side, ring_h)),
            ):
                box(f'{prefix}_step_{level:02d}_{suffix}_nocol', (x + dx, y + dy, z + ring_h / 2), dims,
                    stone, 0.16)
        if level in (2, 6, 9):
            inset = side / 2 - thickness - 0.18
            box(f'{prefix}_lapis_band_{level:02d}_nocol_noshadow', (x, y - inset, z + ring_h * .58),
                (side - thickness * 2, .30, .62), trim)
            box(f'{prefix}_rune_band_{level:02d}_nocol_noshadow', (x, y - inset - .18, z + ring_h * .58),
                (side * .36, .16, .30), rune)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=base / steps * 1.18,
        radius2=0, depth=height / steps * 1.55,
        location=(x, -y, height + height / steps * .16), rotation=(0, 0, math.pi / 4))
    cap = bpy.context.object
    cap.name = f'{prefix}_crown_cap_nocol'
    cap.data.materials.append(trim)


def build_terrain(m):
    # Low-poly dune field is intentionally broad and shallow around the combat landmarks.
    rng = random.Random(SEED)
    for index in range(22):
        angle = index * math.tau / 22 + .13
        radius = 80 + (index % 4) * 6
        x, y = math.cos(angle) * radius, math.sin(angle) * radius
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(x, -y, -3.2))
        dune = bpy.context.object
        dune.name = f'terrain_dune_{index:02d}'
        dune.scale = (18 + rng.random() * 12, 10 + rng.random() * 8, 4 + rng.random() * 3)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        dune.data.materials.append(m['Sandstone'] if index % 3 else m['SunSandstone'])
    box('terrain_playable_plaza', (0, 0, -1.5), (214, 214, 3), m['ShadowSandstone'])


def build_king_exterior(m):
    # Brief placement [0, 0, -60] is authored directly in game coordinates.
    pyramid_shell('king', 0, -60, 100, 145, m['Sandstone'], m['GoldBronze'], m['CyanRune'], 15)
    collision_shell('king', 0, -60, 100, 145,
                    ((0, 25, 9), (25, 76, 0), (76, 100, 6), (100, 142, 0)),
                    m['CollisionProxy'])
    # Broad south (front) ceremonial opening; portals are visual lintels, not doors.
    box('king_gateway_lintel', (0, -111.3, 18), (34, 4.8, 7), m['GoldBronze'], .35)
    for x in (-15, 15):
        box(f'king_gateway_pylon_{x:+}', (x, -111.3, 9), (5, 5, 18), m['SunSandstone'], .25)
    box('king_gateway_cyan_keystone_nocol', (0, -113.8, 19), (15, .25, 1.2), m['CyanRune'])


def build_king_interior(m):
    # Cross hall, switchback flying gallery, chamber and light shaft occupy the hollow core.
    box('king_interior_cross_floor', (0, -60, .4), (58, 58, .8), m['ShadowSandstone'])
    # Four corner masses define a 16 m wide cross without closing any arm.
    for x in (-19, 19):
        for z in (-79, -41):
            box(f'king_cross_corner_{x:+}_{z:+}', (x, z, 10), (12, 12, 20), m['Sandstone'])
    for x, y in ((-22, -82), (22, -82), (-22, -38), (22, -38)):
        cylinder(f'king_gallery_column_{x:+}_{y:+}', (x, y, 19), 2.1, 38, m['GoldBronze'])
        cylinder(f'king_gallery_cap_{x:+}_{y:+}', (x, y, 38.5), 3.2, 1.1, m['Lapis'])
    # Broad ramps and landings allow driving/flying to both high exits.
    for index, (z, height, angle) in enumerate(((-72, 14, -28), (-48, 32, 28), (-72, 50, -28), (-48, 68, 28))):
        ramp(f'king_ascending_gallery_{index}', (0, z, height), (14, 34, 1.8), angle, m['ShadowSandstone'])
        box(f'king_gallery_landing_{index}', (0, z + (12 if angle > 0 else -12), height + 8),
            (20, 10, 1.4), m['GoldBronze'])
    box('king_inner_chamber_back', (0, -33.5, 17), (30, 3, 34), m['ShadowSandstone'])
    box('king_inner_chamber_dais', (0, -42, 3), (17, 11, 5), m['GoldBronze'], .22)
    # Four slim corners frame a real light shaft instead of sealing the crown.
    for x in (-8, 8):
        for y in (-68, -52):
            box(f'king_lightshaft_frame_{x:+}_{y:+}', (x, y, 44), (2.5, 2.5, 52), m['Lapis'])
    box('king_lightshaft_core_nocol', (0, -60, 69), (11, 11, 1.0), m['CyanRune'])
    for level, z in enumerate((10, 34, 76)):
        box(f'king_gallery_ring_{level}', (0, -60, z), (47, 47, 1.0), m['GoldBronze'])


def build_morning(m):
    pyramid_shell('morning', 78, 55, 78, 130, m['SunSandstone'], m['GoldBronze'], m['AmberRune'], 13)
    collision_shell('morning', 78, 55, 78, 130, ((0, 28, 9), (28, 127, 0)), m['CollisionProxy'])
    box('morning_hall_floor', (78, 55, .5), (50, 50, 1), m['ShadowSandstone'])
    ramp('morning_height_ramp', (78, 55, 42), (15, 64, 2), -32, m['ShadowSandstone'])
    box('morning_height_platform', (78, 55, 84), (32, 32, 2), m['GoldBronze'])
    box('morning_obelisk_base', (78, 55, 3), (18, 18, 6), m['Lapis'], .2)
    cylinder('morning_sun_obelisk', (78, 55, 21), 3.3, 32, m['GoldBronze'], vertices=6)
    box('morning_sun_rune_nocol', (78, 51.6, 22), (4.4, .22, 15), m['AmberRune'])


def build_evening(m):
    pyramid_shell('evening', -78, 55, 78, 126, m['ShadowSandstone'], m['Lapis'], m['CyanRune'], 13)
    collision_shell('evening', -78, 55, 78, 126, ((0, 28, 9), (28, 123, 0)), m['CollisionProxy'])
    box('evening_hall_floor', (-78, 55, .5), (50, 50, 1), m['Sandstone'])
    ramp('evening_height_ramp', (-78, 55, 42), (15, 64, 2), 32, m['ShadowSandstone'])
    box('evening_height_platform', (-78, 55, 84), (32, 32, 2), m['Lapis'])
    box('evening_moon_obelisk_base', (-78, 55, 3), (18, 18, 6), m['GoldBronze'], .2)
    cylinder('evening_moon_obelisk', (-78, 55, 20), 3.2, 30, m['Lapis'], vertices=6)
    box('evening_moon_rune_nocol', (-78, 51.6, 21), (4.4, .22, 14), m['CyanRune'])


def build_plaza(m):
    for index, (x, y, z, sx, sy, sz) in enumerate((
        (-54, -2, 5, 20, 5, 10), (54, -2, 5, 20, 5, 10), (-44, -101, 3, 14, 9, 6),
        (44, -101, 3, 14, 9, 6), (-102, 8, 4, 9, 18, 8), (102, 8, 4, 9, 18, 8),
    )):
        box(f'plaza_ruin_{index:02d}', (x, y, z), (sx, sy, sz), m['Sandstone'], .3)
    for index, (x, y) in enumerate(((-36, -16), (36, -16), (-36, 20), (36, 20), (-24, -112), (24, -112))):
        cylinder(f'plaza_column_{index:02d}_nocol', (x, y, 8), 1.5, 16, m['GoldBronze'])
        cylinder(f'plaza_column_rune_{index:02d}_nocol', (x, y, 16.4), 2.2, .7,
                 m['AmberRune'] if index % 2 else m['CyanRune'])


def build_beacons(m):
    for index, (x, y, color) in enumerate(((-92, -84, 'CyanRune'), (92, -84, 'AmberRune'), (-112, 76, 'AmberRune'), (112, 76, 'CyanRune'))):
        cylinder(f'sandstorm_beacon_{index:02d}_pedestal_nocol_noshadow', (x, y, 3), 6, 6, m['GoldBronze'], vertices=8)
        torus(f'sandstorm_beacon_{index:02d}_halo_nocol_noshadow', (x, y, 14), 5.2, .7,
            m[color], rotation=(math.pi / 2, 0, 0))
        box(f'sandstorm_beacon_{index:02d}_spine_nocol_noshadow', (x, y + .65, 12), (1.1, .25, 13), m[color])
    for side, x, color in (('dusk', -78, 'CyanRune'), ('dawn', 78, 'AmberRune')):
        torus(f'sandstorm_beacon_portal_{side}_nocol_noshadow', (x, 55, 84), 8, 1.15,
            m[color], rotation=(0, math.pi / 2, 0))
        box(f'portal_{side}_collider', (x, 55, 76), (3, 18, 4), m['GoldBronze'])


BUILDERS = {
    '01_terrain': build_terrain,
    '02_sun_king_exterior': build_king_exterior,
    '03_sun_king_interior': build_king_interior,
    '04_dawn_pyramid': build_morning,
    '05_dusk_pyramid': build_evening,
    '06_sun_plaza': build_plaza,
    '07_beacons_portals': build_beacons,
}


def metrics():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    triangles = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    verts = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = tuple(round(min(v[i] for v in verts), 2) for i in range(3))
    high = tuple(round(max(v[i] for v in verts), 2) for i in range(3))
    return len(meshes), triangles, len(bpy.data.materials), low, high


def save_and_export(stem):
    blend_dir, glb_dir = ASSET_ROOT / 'blender', ASSET_ROOT / 'glb'
    blend_dir.mkdir(parents=True, exist_ok=True)
    glb_dir.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_dir / f'{stem}.blend'), check_existing=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(glb_dir / f'{stem}.glb'), export_format='GLB',
        use_selection=True, export_animations=False, export_yup=True, export_cameras=False,
        export_lights=False, export_extras=True, export_apply=True)
    count, triangles, material_count, low, high = metrics()
    print(f'PYRAMID {stem}: meshes={count} triangles={triangles} materials={material_count} bounds={low}..{high}')


def build_part(stem):
    reset_scene(f'Pyramid_{stem}')
    m = materials()
    BUILDERS[stem](m)
    save_and_export(stem)


def render_qa(qa_dir):
    qa_dir.mkdir(parents=True, exist_ok=True)
    reset_scene('PyramidGLBRoundtripPreview')
    for stem in PARTS:
        bpy.ops.import_scene.gltf(filepath=str(ASSET_ROOT / 'glb' / f'{stem}.glb'))
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 960, 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('PyramidQASky')
    scene.world.color = (0.025, 0.035, 0.055)
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 250))
    bpy.context.object.data.energy, bpy.context.object.data.angle = 4.0, .35
    bpy.context.object.rotation_euler = (math.radians(25), math.radians(-20), math.radians(25))
    bpy.ops.object.light_add(type='AREA', location=(0, -120, 95))
    bpy.context.object.data.energy, bpy.context.object.data.shape, bpy.context.object.data.size = 5000, 'DISK', 90
    target = Vector((0, -10, 45))
    for name, location in (('front', (0, -330, 145)), ('east', (330, -40, 135)),
                           ('rear', (0, 290, 155)), ('three_quarter', (270, -260, 170))):
        bpy.ops.object.camera_add(location=location)
        camera = bpy.context.object
        camera.name = f'qa_camera_{name}'
        camera.data.lens = 48
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = camera
        scene.render.filepath = str(qa_dir / f'pyramid_{name}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(camera, do_unlink=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--part', action='append', choices=PARTS)
    parser.add_argument('--qa-dir', type=Path)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    for stem in (args.part or PARTS):
        build_part(stem)
    if args.qa_dir:
        render_qa(args.qa_dir.resolve())


if __name__ == '__main__':
    main()
