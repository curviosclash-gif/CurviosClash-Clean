#!/usr/bin/env python3
"""Build the deterministic pyramid arena ("Krone des Sonnengottes") for Blender 4.2.

Contract
- Units: 1 Blender unit = 1 authored game unit before ARENA.MAP_SCALE (the preset sets
  scaleAuthoredAnchors, the runtime multiplies by 3).
- Axes: helpers take game coordinates (x, y up, z); Blender is Z-up and glTF exports Y-up,
  so game (x, y, z) is Blender (x, -z, y).
- Placement: GLBMapLoader centres each GLB's bounding box on the preset position in X/Z and
  puts its bottom on the preset Y. `report()` prints that preset position for every part.
- Roles: `_colonly` shells carry the pyramid walls (with authored door and window bands),
  `_nocol` marks the visual stepped skin and decoration, everything else collides as drawn.
  Parts are merged into one mesh per role and material to keep draw calls low on an iGPU.
- Shelters: the sandstorm shelter volumes in the preset are the interior spaces built here
  (hall, galleries, portal chambers, pavilion); tests/pyramid-blender-assets.contract.test.mjs
  checks them against these GLBs.
- Budget: <= 6000 triangles and <= 400 KiB per GLB. Randomness only from random.Random(SEED).
"""

import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / 'assets' / 'maps' / 'pyramid' / 'blender'
GLB_DIR = ROOT / 'assets' / 'maps' / 'pyramid' / 'glb'
SEED = 44221
SHELL_THICKNESS = 1.25
PORTAL_Y = 80.0
TERRAIN_LIFT = 0.1

KING = dict(prefix='king', cx=0.0, cz=-60.0, base=100.0, height=145.0, steps=12,
            door_levels=(0, 1), window_levels=(6, 7), door_half=9.0, window_half=6.0,
            galleries=((34.0, 14.0), (72.0, 14.0)), ceiling=96.8)
DAWN = dict(prefix='morning', cx=78.0, cz=55.0, base=78.0, height=130.0, steps=13,
            door_levels=(0, 1, 2), window_levels=(7, 8), door_half=9.0, window_half=6.0,
            galleries=((34.0, 12.0), (66.0, 10.0)), ceiling=90.0)
DUSK = dict(DAWN, prefix='evening', cx=-78.0)

_groups = {}


# --- Scene, materials, tinting --------------------------------------------------------------

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
    _groups.clear()
    return scene


def make_material(name, color, metallic=0.0, roughness=0.8, emission=None):
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
    # Emissive runes keep a near-black base and one dominant channel so tone mapping keeps the hue.
    return {
        'Sand': make_material('Sand', (0.66, 0.47, 0.27), 0.0, 1.0),
        'Sandstone': make_material('Sandstone', (0.58, 0.39, 0.2), 0.02, 0.9),
        'SunSandstone': make_material('SunSandstone', (0.74, 0.53, 0.29), 0.02, 0.86),
        'DuskSandstone': make_material('DuskSandstone', (0.47, 0.33, 0.24), 0.02, 0.9),
        'ShadowSandstone': make_material('ShadowSandstone', (0.33, 0.2, 0.1), 0.03, 0.92),
        'GoldBronze': make_material('GoldBronze', (0.66, 0.45, 0.14), 0.82, 0.34),
        'Lapis': make_material('LapisLazuli', (0.03, 0.08, 0.3), 0.2, 0.35),
        'CyanRune': make_material('CyanRune', (0.01, 0.02, 0.03), 0.0, 0.4, ((0.08, 0.55, 1.0), 1.1)),
        'AmberRune': make_material('AmberRune', (0.03, 0.015, 0.0), 0.0, 0.4, ((1.0, 0.32, 0.03), 1.0)),
        'CollisionProxy': make_material('CollisionProxy', (0.08, 0.08, 0.08), 0.0, 1.0),
    }


def tint(obj, shade=1.0):
    """Darken-only vertex tint (the exporter stores colours as normalised integers)."""
    value = max(0.0, min(1.0, shade))
    attr = obj.data.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for entry in attr.data:
        entry.color = (value, value, value, 1.0)
    obj.data.color_attributes.active_color = attr
    obj.data.color_attributes.render_color_index = 0
    return obj


def bl(x, y, z):
    return (x, -z, y)


def add(group, obj):
    _groups.setdefault(group, []).append(obj)
    return obj


def finish(obj, mat, shade, bevel):
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('SoftStoneEdges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return tint(obj, shade)


def box(group, center, size, mat, bevel=0.0, shade=1.0):
    """Axis-aligned box from game centre (x, y, z) and game size (sx, sy, sz)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=bl(*center))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return add(group, finish(obj, mat, shade, bevel))


def cylinder(group, base_center, radius, height, mat, vertices=12, shade=1.0, axis='y'):
    x, y, z = base_center
    rotation = (0.0, 0.0, 0.0)
    location = bl(x, y + height / 2, z)
    if axis == 'x':
        rotation, location = (0.0, math.pi / 2, 0.0), bl(x + height / 2, y, z)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height,
                                        location=location, rotation=rotation)
    return add(group, finish(bpy.context.object, mat, shade, 0.0))


def cone(group, base_center, radius, height, mat, vertices=4, shade=1.0):
    x, y, z = base_center
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0.0, depth=height,
                                    location=bl(x, y + height / 2, z), rotation=(0, 0, math.pi / 4))
    return add(group, finish(bpy.context.object, mat, shade, 0.0))


def torus(group, center, major, minor, mat, normal_axis='x'):
    rotation = (0.0, math.pi / 2, 0.0) if normal_axis == 'x' else (math.pi / 2, 0.0, 0.0)
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24,
                                     minor_segments=6, location=bl(*center), rotation=rotation)
    return add(group, finish(bpy.context.object, mat, 1.0, 0.0))


def merge_groups():
    """Join every group into one object named after the group (one node, one material)."""
    for name, objects in _groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = name
        merged.data.name = f'{name}_mesh'
    _groups.clear()


# --- Pyramid building blocks -----------------------------------------------------------------

def level_height(spec):
    return spec['height'] / spec['steps']


def step_thickness(spec):
    # Each ring reaches one step inset plus 1.2 m inward, so it covers the outer face of the ring
    # above it; thinner rings left a slit to the sky at every step.
    return spec['base'] / 2 / spec['steps'] + 1.2


def visual_inner_half(spec, y):
    level = min(spec['steps'] - 1, max(0, int(y // level_height(spec))))
    return spec['base'] / 2 * (1 - level / spec['steps']) - step_thickness(spec)


def shell_inner_half(spec, y):
    return spec['base'] / 2 * (1 - y / spec['height']) - SHELL_THICKNESS


def interior_half(spec, low, high):
    """Free half-width of the interior over a height band (the tighter of skin and shell)."""
    samples = [low, high, *[low + (high - low) * f for f in (0.25, 0.5, 0.75)]]
    return min(min(visual_inner_half(spec, y), shell_inner_half(spec, y)) for y in samples)


def ring_segments(half, thickness, opening):
    """Four wall slabs of a square ring (N/S full length, E/W between them), split at openings."""
    slabs = []
    for sign in (-1, 1):
        offset = sign * (half - thickness / 2)
        for axis, length in (('x', 2 * half), ('z', 2 * half - 2 * thickness)):
            spans = [(-length / 2, length / 2)]
            if opening:
                spans = [(-length / 2, -opening), (opening, length / 2)]
            for start, end in spans:
                if end - start <= 0.05:
                    continue
                middle, extent = (start + end) / 2, end - start
                if axis == 'x':
                    slabs.append(((middle, offset), (extent, thickness)))
                else:
                    slabs.append(((offset, middle), (thickness, extent)))
    return slabs


def stepped_skin(spec, stone, group):
    steps, h, t = spec['steps'], level_height(spec), step_thickness(spec)
    for level in range(steps):
        half = spec['base'] / 2 * (1 - level / steps)
        y = level * h + h / 2 + 0.01
        shade = 1.0 if level % 2 == 0 else 0.9
        if half <= t + 0.5:
            box(group, (spec['cx'], y, spec['cz']), (2 * half, h + 0.02, 2 * half), stone, 0.0, shade)
            continue
        opening = 0.0
        if level in spec['door_levels']:
            opening = spec['door_half']
        elif level in spec['window_levels']:
            opening = spec['window_half']
        for (dx, dz), (sx, sz) in ring_segments(half, t, opening):
            box(group, (spec['cx'] + dx, y, spec['cz'] + dz), (sx, h + 0.02, sz), stone, 0.0, shade)


def face_bands(spec, levels, height_ratio, depth, thickness, mat, group, length_ratio=1.0):
    """Thin trim strips proud of the outer faces, skipped where a level has openings."""
    steps, h = spec['steps'], level_height(spec)
    for level in levels:
        if level in spec['door_levels'] or level in spec['window_levels']:
            continue
        half = spec['base'] / 2 * (1 - level / steps)
        y = level * h + h * height_ratio
        length = 2 * half * length_ratio
        for sign in (-1, 1):
            box(group, (spec['cx'], y, spec['cz'] + sign * (half + depth / 2)), (length, thickness, depth), mat)
            box(group, (spec['cx'] + sign * (half + depth / 2), y, spec['cz']), (depth, thickness, length), mat)


def door_frames(spec, mat, group):
    h = level_height(spec)
    t = step_thickness(spec)
    for levels, opening in ((spec['door_levels'], spec['door_half']), (spec['window_levels'], spec['window_half'])):
        low, high = min(levels) * h, (max(levels) + 1) * h
        half = spec['base'] / 2 * (1 - min(levels) / spec['steps'])
        for sign in (-1, 1):
            for side in (-1, 1):
                along = side * (opening + 0.9)
                face = sign * (half - t / 2 + 0.35)
                box(group, (spec['cx'] + along, (low + high) / 2, spec['cz'] + face), (1.8, high - low, t + 0.7), mat)
                box(group, (spec['cx'] + face, (low + high) / 2, spec['cz'] + along), (t + 0.7, high - low, 1.8), mat)
            box(group, (spec['cx'], high + 0.6, spec['cz'] + sign * (half - t / 2 + 0.35)),
                (2 * opening + 3.6, 1.2, t + 0.7), mat)
            box(group, (spec['cx'] + sign * (half - t / 2 + 0.35), high + 0.6, spec['cz']),
                (t + 0.7, 1.2, 2 * opening + 3.6), mat)


def collision_shell(spec, mat):
    """One low-poly closed wall mesh with the same door and window bands as the stepped skin."""
    h = level_height(spec)
    door_top = (max(spec['door_levels']) + 1) * h
    win_low, win_high = min(spec['window_levels']) * h, (max(spec['window_levels']) + 1) * h
    bands = ((0.0, door_top, spec['door_half']), (door_top, win_low, 0.0),
             (win_low, win_high, spec['window_half']), (win_high, spec['height'] - 3.0, 0.0))
    x, centre_z, base, height = spec['cx'], spec['cz'], spec['base'], spec['height']
    vertices, faces = [], []

    def quad(points):
        start = len(vertices)
        vertices.extend(bl(px, py, pz) for px, py, pz in points)
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
            spans = [(-low_half, -opening, -high_half, -opening), (opening, low_half, opening, high_half)]
        for low_a, low_b, high_a, high_b in spans:
            for sign in (-1, 1):
                low_z, high_z = centre_z + sign * low_half, centre_z + sign * high_half
                inner_low_z = low_z - sign * SHELL_THICKNESS
                inner_high_z = high_z - sign * min(SHELL_THICKNESS, high_half)
                prism(((x + low_a, low, low_z), (x + low_b, low, low_z),
                       (x + high_b, high, high_z), (x + high_a, high, high_z)),
                      ((x + low_a, low, inner_low_z), (x + low_b, low, inner_low_z),
                       (x + high_b, high, inner_high_z), (x + high_a, high, inner_high_z)))
                low_x, high_x = x + sign * low_half, x + sign * high_half
                inner_low_x = low_x - sign * SHELL_THICKNESS
                inner_high_x = high_x - sign * min(SHELL_THICKNESS, high_half)
                prism(((low_x, low, centre_z + low_a), (low_x, low, centre_z + low_b),
                       (high_x, high, centre_z + high_b), (high_x, high, centre_z + high_a)),
                      ((inner_low_x, low, centre_z + low_a), (inner_low_x, low, centre_z + low_b),
                       (inner_high_x, high, centre_z + high_b), (inner_high_x, high, centre_z + high_a)))
    mesh = bpy.data.meshes.new(f'COL_{spec["prefix"]}_shell_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    collider = bpy.data.objects.new(f'COL_{spec["prefix"]}_shell_colonly', mesh)
    bpy.context.collection.objects.link(collider)
    collider.data.materials.append(mat)
    collider['collision_role'] = 'simplified_shell'
    return collider


def gallery(spec, y, hole_half, floor_mat, trim_mat, group, trim_group):
    """Square ring floor against the walls around an open light shaft, with a low balustrade."""
    outer = interior_half(spec, y, y + 1.0) + 0.3
    width = outer - hole_half
    for (dx, dz), (sx, sz) in ring_segments(outer, width, 0.0):
        box(group, (spec['cx'] + dx, y + 0.5, spec['cz'] + dz), (sx, 1.0, sz), floor_mat, 0.0, 0.92)
    for (dx, dz), (sx, sz) in ring_segments(hole_half + 0.35, 0.7, 4.0):
        box(trim_group, (spec['cx'] + dx, y + 1.0 + 0.7, spec['cz'] + dz), (sx, 1.4, sz), trim_mat)


def ceiling(spec, stone, group):
    # Reaches into the collision shell, not just to the stepped skin, so the sealed crown above
    # stays unreachable.
    y = spec['ceiling']
    half = max(visual_inner_half(spec, y + 0.2), shell_inner_half(spec, y)) + 0.5
    box(group, (spec['cx'], y + 0.6, spec['cz']), (2 * half, 1.2, 2 * half), stone, 0.0, 0.8)


def interior_columns(spec, offset, low, high, radius, mat, group):
    for sx in (-1, 1):
        for sz in (-1, 1):
            cylinder(group, (spec['cx'] + sx * offset, low, spec['cz'] + sz * offset), radius, high - low, mat)
            cylinder(group, (spec['cx'] + sx * offset, high - 1.2, spec['cz'] + sz * offset),
                     radius + 0.7, 1.2, mat, vertices=8)


def interior_floor(spec, mat, group):
    half = visual_inner_half(spec, 0.5) + 0.5
    box(group, (spec['cx'], 0.35, spec['cz']), (2 * half, 0.7, 2 * half), mat, 0.0, 0.85)


def wall_reliefs(spec, mat, glow, group, glow_group):
    """Carved panels and a rune line on the inner walls of the hall, purely visual."""
    y = 12.0
    half = visual_inner_half(spec, y) - 0.2
    for sign in (-1, 1):
        for along in (-1, 1):
            position = along * (spec['door_half'] + (half - spec['door_half']) / 2)
            length = half - spec['door_half'] - 3.0
            box(group, (spec['cx'] + position, y, spec['cz'] + sign * half), (length, 10.0, 0.4), mat, 0.0, 0.75)
            box(group, (spec['cx'] + sign * half, y, spec['cz'] + position), (0.4, 10.0, length), mat, 0.0, 0.75)
            box(glow_group, (spec['cx'] + position, y + 5.6, spec['cz'] + sign * (half - 0.25)), (length, 0.3, 0.12), glow)
            box(glow_group, (spec['cx'] + sign * (half - 0.25), y + 5.6, spec['cz'] + position), (0.12, 0.3, length), glow)


# --- Parts ------------------------------------------------------------------------------------

def smoothstep(edge0, edge1, value):
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


FOOTPRINTS = ((-58, 58, -118, -2), (31, 125, 8, 102), (-125, -31, 8, 102), (-24, 24, 0, 32))


def dune_height(x, z, phases):
    edge = max(abs(x), abs(z))
    rim = smoothstep(98.0, 128.0, edge)
    clearance = 1.0
    for x0, x1, z0, z1 in FOOTPRINTS:
        dx = max(x0 - x, 0.0, x - x1)
        dz = max(z0 - z, 0.0, z - z1)
        clearance = min(clearance, smoothstep(2.0, 12.0, math.hypot(dx, dz)))
    swell = (5.0 + 2.8 * math.sin(0.09 * x + phases[0]) * math.cos(0.07 * z + phases[1])
             + 1.6 * math.sin(0.19 * (x + z) + phases[2]))
    return max(0.0, rim * clearance * swell)


def build_terrain(m):
    # One shallow dune field: flat play space in the middle, dunes rising towards the arena rim.
    rng = random.Random(SEED)
    phases = [rng.uniform(0.0, math.tau) for _ in range(3)]
    cells, half = 52, 130.0
    step = 2 * half / cells
    vertices, faces, shades = [], [], []
    for row in range(cells + 1):
        for column in range(cells + 1):
            x, z = -half + column * step, -half + row * step
            # Lifted off the arena's own checker floor at y 0, which would otherwise z-fight with it.
            y = TERRAIN_LIFT + dune_height(x, z, phases)
            vertices.append(bl(x, y, z))
            ripple = 0.5 + 0.5 * math.sin(0.35 * x + 0.15 * z + 1.7 * math.sin(0.05 * z))
            shades.append(min(1.0, 0.8 + 0.12 * ripple + 0.012 * y))
    for row in range(cells):
        for column in range(cells):
            a = row * (cells + 1) + column
            faces.append((a, a + 1, a + cells + 2, a + cells + 1))
    mesh = bpy.data.meshes.new('terrain_dunes_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('terrain_dunes', mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(m['Sand'])
    attr = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for loop in mesh.loops:
        value = shades[loop.vertex_index]
        attr.data[loop.index].color = (value, value, value, 1.0)
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = 0
    for polygon in mesh.polygons:
        polygon.use_smooth = True


def build_king_exterior(m):
    spec = KING
    stepped_skin(spec, m['Sandstone'], 'king_steps_nocol')
    face_bands(spec, (3, 5, 9), 0.55, 0.5, 0.7, m['GoldBronze'], 'king_trim_nocol_noshadow')
    face_bands(spec, (4, 8), 0.5, 0.35, 0.35, m['CyanRune'], 'king_runes_nocol_noshadow', 0.4)
    door_frames(spec, m['GoldBronze'], 'king_frames_nocol')
    # The pyramidion ends just under the 160 m arena ceiling.
    cone('king_cap_nocol', (spec['cx'], spec['height'] - 0.5, spec['cz']),
         spec['base'] / spec['steps'] * 0.9, level_height(spec) * 1.2, m['GoldBronze'])
    # Ceremonial gateway before the front door, facing the plaza and the player spawn.
    front = spec['cz'] + spec['base'] / 2 + 4.0
    for side in (-1, 1):
        box('king_gateway', (side * 13.5, 13.0, front), (4.5, 26.0, 4.5), m['SunSandstone'], 0.25)
        box('king_gateway', (side * 13.5, 27.0, front), (6.0, 2.0, 6.0), m['SunSandstone'], 0.2)
    box('king_gateway_lintel', (0.0, 29.3, front), (34.0, 2.6, 5.0), m['GoldBronze'], 0.2)
    box('king_gateway_glow_nocol_noshadow', (0.0, 29.3, front + 2.6), (16.0, 0.8, 0.2), m['CyanRune'])
    collision_shell(spec, m['CollisionProxy'])


def build_king_interior(m):
    spec = KING
    interior_floor(spec, m['ShadowSandstone'], 'king_floor')
    for y, hole in spec['galleries']:
        gallery(spec, y, hole, m['Sandstone'], m['GoldBronze'], 'king_galleries', 'king_balustrades')
    ceiling(spec, m['ShadowSandstone'], 'king_ceiling')
    interior_columns(spec, 19.0, 0.7, spec['galleries'][0][0], 2.0, m['GoldBronze'], 'king_columns')
    interior_columns(spec, 17.0, spec['galleries'][0][0] + 1.0, spec['galleries'][1][0], 1.6,
                     m['GoldBronze'], 'king_columns')
    # Burial chamber at the back of the hall, off the shaft and off the door axis sightline.
    box('king_dais', (0.0, 1.9, -84.0), (16.0, 2.4, 10.0), m['GoldBronze'], 0.2)
    box('king_sarcophagus', (0.0, 4.4, -84.0), (5.0, 2.6, 8.0), m['Lapis'], 0.25)
    wall_reliefs(spec, m['Sandstone'], m['CyanRune'], 'king_reliefs_nocol_noshadow', 'king_glow_nocol_noshadow')
    # The light shaft is framed at its top and marked on the floor.
    for (dx, dz), (sx, sz) in ring_segments(14.2, 0.6, 0.0):
        box('king_glow_nocol_noshadow', (dx, spec['ceiling'] - 0.2, spec['cz'] + dz), (sx, 0.3, sz), m['CyanRune'])
    for (dx, dz), (sx, sz) in ring_segments(6.0, 0.8, 0.0):
        box('king_glow_nocol_noshadow', (dx, 0.75, spec['cz'] + dz), (sx, 0.1, sz), m['CyanRune'])


def build_side_pyramid(spec, stone, trim, rune, m):
    p = spec['prefix']
    stepped_skin(spec, m[stone], f'{p}_steps_nocol')
    face_bands(spec, (4, 6, 10), 0.55, 0.45, 0.6, m[trim], f'{p}_trim_nocol_noshadow')
    face_bands(spec, (5,), 0.5, 0.3, 0.3, m[rune], f'{p}_runes_nocol_noshadow', 0.35)
    door_frames(spec, m['GoldBronze'], f'{p}_frames_nocol')
    cone(f'{p}_cap_nocol', (spec['cx'], spec['height'] - 0.5, spec['cz']),
         spec['base'] / spec['steps'] * 0.9, level_height(spec) * 1.3, m[trim])
    collision_shell(spec, m['CollisionProxy'])
    interior_floor(spec, m['ShadowSandstone'], f'{p}_floor')
    for y, hole in spec['galleries']:
        gallery(spec, y, hole, m['Sandstone'], m['GoldBronze'], f'{p}_galleries', f'{p}_balustrades')
    ceiling(spec, m['ShadowSandstone'], f'{p}_ceiling')
    interior_columns(spec, 15.0, 0.7, spec['galleries'][0][0], 1.7, m[trim], f'{p}_columns')
    box(f'{p}_obelisk_base', (spec['cx'], 3.4, spec['cz']), (14.0, 5.4, 14.0), m['Lapis'], 0.2)
    cylinder(f'{p}_obelisk', (spec['cx'], 6.0, spec['cz']), 3.0, 30.0, m['GoldBronze'], vertices=6)
    cone(f'{p}_obelisk_tip_nocol', (spec['cx'], 36.0, spec['cz']), 3.2, 4.0, m[rune])
    wall_reliefs(spec, m['Sandstone'], m[rune], f'{p}_reliefs_nocol_noshadow', f'{p}_glow_nocol_noshadow')


def build_morning(m):
    build_side_pyramid(DAWN, 'SunSandstone', 'GoldBronze', 'AmberRune', m)


def build_evening(m):
    build_side_pyramid(DUSK, 'DuskSandstone', 'Lapis', 'CyanRune', m)


PAVILION = dict(cx=0.0, cz=16.0, half_x=20.5, half_z=13.5, roof=13.4)


def build_plaza(m):
    cx, cz, hx, hz, roof = (PAVILION[key] for key in ('cx', 'cz', 'half_x', 'half_z', 'roof'))
    # Sun pavilion: the roofed storm shelter in the middle of the plaza.
    box('plaza_pavilion', (cx, 0.3, cz), (2 * hx + 2.0, 0.6, 2 * hz + 2.0), m['ShadowSandstone'], 0.15)
    box('plaza_pavilion', (cx, roof + 0.8, cz), (2 * hx + 3.0, 1.6, 2 * hz + 3.0), m['SunSandstone'], 0.2)
    for side in (-1, 1):
        box('plaza_pavilion', (cx + side * hx, (0.6 + roof) / 2, cz), (1.2, roof - 0.6, 2 * hz), m['SunSandstone'], 0.12)
    for side in (-1, 1):
        for x in (-18.0, -9.0, 0.0, 9.0, 18.0):
            cylinder('plaza_columns', (cx + x, 0.6, cz + side * hz), 1.1, roof - 0.6, m['GoldBronze'])
    for side in (-1, 1):
        box('plaza_trim_nocol_noshadow', (cx, roof + 1.75, cz + side * (hz + 1.55)), (2 * hx + 3.2, 0.5, 0.3), m['GoldBronze'])
        box('plaza_trim_nocol_noshadow', (cx + side * (hx + 1.55), roof + 1.75, cz), (0.3, 0.5, 2 * hz + 3.2), m['GoldBronze'])
    for side in (-1, 1):
        box('plaza_glow_nocol_noshadow', (cx, roof - 0.35, cz + side * (hz - 1.6)), (2 * hx - 4.0, 0.25, 0.25), m['AmberRune'])
    # Guardian statues along the avenue towards the player spawn.
    for side in (-1, 1):
        for z in (46.0, 64.0):
            box('plaza_statues', (side * 12.0, 1.5, z), (5.0, 3.0, 9.0), m['Sandstone'], 0.25)
            box('plaza_statues', (side * 12.0, 4.6, z + 1.5), (4.0, 3.2, 5.5), m['SunSandstone'], 0.3)
            box('plaza_statues', (side * 12.0, 7.4, z - 2.4), (2.6, 3.0, 2.6), m['SunSandstone'], 0.3)
    # Weathered ruins and a fallen obelisk at the plaza edges.
    for index, (x, y, z, sx, sy, sz) in enumerate((
        (-55.0, 2.5, 0.0, 10.0, 5.0, 20.0), (55.0, 2.5, 0.0, 10.0, 5.0, 20.0),
        (-102.0, 4.0, 8.0, 9.0, 8.0, 18.0), (102.0, 4.0, 8.0, 9.0, 8.0, 18.0),
    )):
        box('plaza_ruins', (x, y, z), (sx, sy, sz), m['Sandstone'], 0.35, 0.85 + 0.03 * (index % 3))
    cylinder('plaza_ruins', (-38.0, 2.2, 88.0), 2.2, 26.0, m['Sandstone'], vertices=6, shade=0.8, axis='x')


def build_beacons(m):
    for index, (x, z, color) in enumerate(((-92.0, -84.0, 'CyanRune'), (92.0, -84.0, 'AmberRune'),
                                          (-112.0, 76.0, 'AmberRune'), (112.0, 76.0, 'CyanRune'))):
        cylinder('sandstorm_beacon_pedestal_nocol_noshadow', (x, 0.0, z), 6.0, 6.0, m['GoldBronze'], vertices=8)
        box('sandstorm_beacon_pedestal_nocol_noshadow', (x, 7.0, z), (3.0, 2.0, 3.0), m['Lapis'])
        torus(f'sandstorm_beacon_halo_{color.lower()}_nocol_noshadow', (x, 14.0, z), 5.2, 0.7, m[color], 'z')
        box(f'sandstorm_beacon_spine_{color.lower()}_nocol_noshadow', (x, 13.0, z - 0.65), (1.1, 12.0, 0.25), m[color])
    for spec, color in ((DUSK, 'CyanRune'), (DAWN, 'AmberRune')):
        torus(f'sandstorm_portal_{spec["prefix"]}_nocol_noshadow', (spec['cx'], PORTAL_Y, spec['cz']), 8.0, 1.15, m[color], 'x')
        torus('sandstorm_portal_frame_nocol_noshadow', (spec['cx'], PORTAL_Y, spec['cz']), 9.4, 0.45, m['GoldBronze'], 'x')


BUILDERS = {
    '01_terrain': build_terrain,
    '02_sun_king_exterior': build_king_exterior,
    '03_sun_king_interior': build_king_interior,
    '04_dawn_pyramid': build_morning,
    '05_dusk_pyramid': build_evening,
    '06_sun_plaza': build_plaza,
    '07_beacons_portals': build_beacons,
}
PARTS = tuple(BUILDERS)
ARCHITECTURE = tuple((stem, builder) for stem, builder in BUILDERS.items())
SETPIECES = ()


# --- Export ------------------------------------------------------------------------------------

def report(stem):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    triangles = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = [min(c[i] for c in corners) for i in range(3)]
    high = [max(c[i] for c in corners) for i in range(3)]
    # Blender (x, y, z) -> game (x, -y is z, z is height).
    preset = (round((low[0] + high[0]) / 2, 6), round(low[2], 6), round(-(low[1] + high[1]) / 2, 6))
    print(f'PYRAMID {stem}: meshes={len(meshes)} triangles={triangles} '
          f'materials={len(bpy.data.materials)} preset_position={list(preset)}')


def export_part(stem, builder):
    reset_scene(f'Pyramid_{stem}')
    builder(materials())
    merge_groups()
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / f'{stem}.blend'), check_existing=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(GLB_DIR / f'{stem}.glb'), export_format='GLB',
                              use_selection=True, export_animations=False, export_yup=True,
                              export_cameras=False, export_lights=False, export_extras=True,
                              export_apply=True, export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False)
    report(stem)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--part', action='append', choices=PARTS)
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    for stem in (args.part or PARTS):
        export_part(stem, BUILDERS[stem])


if __name__ == '__main__':
    main()
