"""Deterministically build an art-directed, meter-scale garden rose specimen."""

from __future__ import annotations

import math
import os
import random
from pathlib import Path

import bpy
from mathutils import Vector


SEED = 314159
ROOT = Path(__file__).resolve().parents[1]
BLENDER_DIR = ROOT / "blender"
PREVIEW_DIR = BLENDER_DIR / "previews"
BLEND_PATH = BLENDER_DIR / "garden_rose.blend"

random.seed(SEED)
ASSET_OBJECTS = []
STUDIO_OBJECTS = []
ASSET_COLLECTION = None
STUDIO_COLLECTION = None


def srgb_channel(value):
    value /= 255.0
    return value / 12.92 if value < 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(hex_value, alpha=1.0):
    raw = hex_value.lstrip("#")
    return tuple(srgb_channel(int(raw[index:index + 2], 16)) for index in (0, 2, 4)) + (alpha,)


def material(name, hex_value, roughness=0.42, subsurface=0.0, coat=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color(hex_value)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color(hex_value)
    bsdf.inputs["Roughness"].default_value = roughness
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = subsurface
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.28
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.38
    return mat


def register(obj, asset=True):
    (ASSET_OBJECTS if asset else STUDIO_OBJECTS).append(obj)
    collection = ASSET_COLLECTION if asset else STUDIO_COLLECTION
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def curve_tube(name, points, radii, bevel, mat, asset=True, resolution=3):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 8
    curve.bevel_depth = bevel
    curve.bevel_resolution = resolution
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for index, (point, radius) in enumerate(zip(points, radii)):
        spline.points[index].co = (*point, 1.0)
        spline.points[index].radius = radius
    obj = bpy.data.objects.new(name, curve)
    (ASSET_COLLECTION if asset else STUDIO_COLLECTION).objects.link(obj)
    obj.data.materials.append(mat)
    (ASSET_OBJECTS if asset else STUDIO_OBJECTS).append(obj)
    return obj


def mesh_object(name, vertices, faces, mat, asset=True, smooth=True):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (ASSET_COLLECTION if asset else STUDIO_COLLECTION).objects.link(obj)
    if mat:
        mesh.materials.append(mat)
    if smooth:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    (ASSET_OBJECTS if asset else STUDIO_OBJECTS).append(obj)
    return obj


def add_surface_modifiers(obj, thickness=0.003, levels=1):
    solidify = obj.modifiers.new("Petal and leaf thickness", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = 0.0
    subdiv = obj.modifiers.new("Soft organic surface", "SUBSURF")
    subdiv.subdivision_type = "CATMULL_CLARK"
    subdiv.levels = levels
    subdiv.render_levels = levels


def add_blade(name, base, tip, width, mat, thickness=0.003, curvature=0.025, serration=0.0, phase=0.0):
    """Create a tapered, gently cupped blade between two attachment points."""
    base = Vector(base)
    tip = Vector(tip)
    axis = (tip - base).normalized()
    reference = Vector((0, 0, 1))
    if abs(axis.dot(reference)) > 0.92:
        reference = Vector((1, 0, 0))
    lateral = reference.cross(axis).normalized()
    normal = axis.cross(lateral).normalized()
    rows, columns = 16, 9
    vertices = []
    faces = []
    for row in range(rows + 1):
        t = row / rows
        profile = max(0.0, math.sin(math.pi * t)) ** 0.47
        profile *= 0.84 + 0.22 * t
        for column in range(columns + 1):
            q = -1.0 + 2.0 * column / columns
            tooth = 1.0 + serration * (abs(q) ** 7) * math.cos(t * 47.0 + phase)
            half_width = width * profile * 0.5 * tooth
            point = base + (tip - base) * t
            point += lateral * (q * half_width)
            point += normal * (curvature * (1.0 - q * q) * math.sin(math.pi * t))
            point += normal * (0.008 * math.sin(math.pi * t + phase) * q)
            vertices.append(tuple(point))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            b = a + columns + 1
            faces.append((a, b, b + 1, a + 1))
    obj = mesh_object(name, vertices, faces, mat)
    add_surface_modifiers(obj, thickness=thickness, levels=1)
    return obj


def add_compound_leaf(origin, reach, axis, size, prefix, deep_leaf, young_leaf, vein_mat):
    """Make an alternate, pinnate rose leaf with five pairs and a terminal leaflet."""
    origin = Vector(origin)
    axis = Vector(axis).normalized()
    endpoint = origin + axis * reach
    rachis_points = [origin, origin.lerp(endpoint, 0.30), origin.lerp(endpoint, 0.68), endpoint]
    curve_tube(prefix + "_petiole", [origin - axis * 0.02, *rachis_points], [1.1, 1.0, 0.82, 0.62, 0.40], 0.011 * size, deep_leaf)
    curve_tube(prefix + "_rachis", rachis_points[1:], [0.72, 0.56, 0.32], 0.006 * size, deep_leaf)

    upward = Vector((0, 0, 1))
    lateral = axis.cross(upward)
    if lateral.length < 0.05:
        lateral = Vector((1, 0, 0))
    lateral.normalize()
    pair_count = 5
    for pair in range(pair_count):
        t = 0.16 + pair * 0.145
        attach = origin.lerp(endpoint, t)
        scale = size * (0.70 + 0.25 * math.sin(math.pi * (t + 0.12)))
        leaflet_length = 0.275 * scale * (0.76 + 0.08 * pair)
        for side in (-1.0, 1.0):
            branch = (axis * 0.28 + lateral * side * 0.86 + upward * (0.16 - t * 0.20)).normalized()
            start = attach + axis * 0.012
            tip = start + branch * leaflet_length
            mat = young_leaf if pair == 4 and size < 1.05 else deep_leaf
            blade_name = f"{prefix}_leaflet_{pair + 1}_{'L' if side < 0 else 'R'}"
            add_blade(blade_name, start, tip, 0.125 * scale, mat, thickness=0.0027, curvature=0.025 * scale,
                      serration=0.045, phase=pair * 1.7 + side)
            curve_tube(blade_name + "_midrib", [start + (tip - start) * t0 for t0 in (0.06, 0.42, 0.80, 0.98)],
                       [0.8, 0.62, 0.38, 0.06], 0.0017 * scale, vein_mat)

    terminal_start = endpoint - axis * 0.02
    terminal_tip = endpoint + axis * (0.17 * size)
    add_blade(prefix + "_terminal", terminal_start, terminal_tip, 0.12 * size, deep_leaf,
              thickness=0.0028, curvature=0.02 * size, serration=0.04, phase=1.1)
    curve_tube(prefix + "_terminal_midrib", [terminal_start, terminal_start.lerp(terminal_tip, 0.55), terminal_tip],
               [0.8, 0.42, 0.04], 0.0017 * size, vein_mat)


def make_petal(name, center, right, up, normal, theta, r_start, r_end, half_width,
               z_start, z_end, edge_curl, twist, mat, seed_offset):
    rows, columns = 20, 10
    vertices, faces = [], []
    length_jitter = random.uniform(-0.022, 0.022)
    width_jitter = random.uniform(0.91, 1.08)
    phase = seed_offset * 1.73
    for row in range(rows + 1):
        t = row / rows
        radius = r_start + (r_end - r_start) * t + length_jitter * t
        profile = (0.12 + 0.88 * max(0.0, math.sin(math.pi * t / 2.0)) ** 0.9) * (1.0 - 0.22 * t)
        if t > 0.90:
            profile *= math.sqrt(max(0.0, (1.0 - t) / 0.10))
        for column in range(columns + 1):
            q = -1.0 + 2.0 * column / columns
            local_theta = theta + twist * t * q
            radial = right * math.cos(local_theta) + up * math.sin(local_theta)
            crosswise = -right * math.sin(local_theta) + up * math.cos(local_theta)
            ruffle = 1.0 + 0.075 * math.cos(t * 18.0 + phase) * abs(q) ** 5
            point = Vector(center) + radial * (radius * ruffle)
            point += crosswise * (q * half_width * profile * width_jitter * (1.0 + 0.10 * q))
            cup = edge_curl * abs(q) ** 1.7 * max(0.0, math.sin(math.pi * t)) ** 0.45
            cup += 0.009 * math.sin(t * 7.0 + phase) * q
            point += normal * (z_start + (z_end - z_start) * t + cup)
            vertices.append(tuple(point))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            b = a + columns + 1
            faces.append((a, b, b + 1, a + 1))
    obj = mesh_object(name, vertices, faces, mat)
    add_surface_modifiers(obj, thickness=0.010, levels=1)
    return obj


def add_thorn(name, base, direction, length, mat):
    direction = Vector(direction).normalized()
    start = Vector(base)
    tip = start + direction * length
    side = direction.cross(Vector((0, 0, 1)))
    if side.length < 0.05:
        side = direction.cross(Vector((1, 0, 0)))
    side.normalize()
    normal = direction.cross(side).normalized()
    rings = ((0.0, 0.014), (0.34, 0.011), (0.72, 0.005), (1.0, 0.0007))
    vertices, faces = [], []
    segments = 8
    for along, radius in rings:
        center = start.lerp(tip, along)
        for index in range(segments):
            angle = math.tau * index / segments
            point = center + side * (radius * math.cos(angle)) + normal * (radius * math.sin(angle))
            vertices.append(tuple(point))
    for ring in range(len(rings) - 1):
        for index in range(segments):
            a = ring * segments + index
            b = ring * segments + (index + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(range((len(rings) - 1) * segments, len(rings) * segments)))
    obj = mesh_object(name, vertices, faces, mat)
    bevel = obj.modifiers.new("Soft thorn root", "BEVEL")
    bevel.width = 0.002
    bevel.segments = 2
    return obj


def add_bud(base, axis, calyx_mat, sepal_light, petal_mats):
    base = Vector(base)
    axis = Vector(axis).normalized()
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < 0.08:
        side = axis.cross(Vector((1, 0, 0)))
    side.normalize()
    other = axis.cross(side).normalized()
    length = 0.35
    profile = ((0.00, 0.036), (0.10, 0.075), (0.28, 0.105), (0.53, 0.122),
               (0.72, 0.108), (0.88, 0.067), (0.97, 0.027), (1.00, 0.003))
    segments = 30
    vertices, faces = [], []
    for height, radius in profile:
        center = base + axis * (height * length)
        for index in range(segments):
            theta = math.tau * index / segments
            lobed_radius = radius * (1.0 + 0.055 * math.cos(5.0 * theta + 0.2))
            point = center + side * (lobed_radius * math.cos(theta)) + other * (lobed_radius * math.sin(theta))
            vertices.append(tuple(point))
    for row in range(len(profile) - 1):
        for index in range(segments):
            a = row * segments + index
            b = row * segments + (index + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    bud = mesh_object("Bud_closed_corolla", vertices, faces, petal_mats[0])
    bud.data.materials.append(petal_mats[1])
    for polygon in bud.data.polygons:
        polygon.material_index = 1 if (polygon.index % segments) % 5 == 2 else 0

    for index in range(5):
        theta = math.tau * index / 5.0 + 0.20
        radial = side * math.cos(theta) + other * math.sin(theta)
        sepal_base = base + axis * 0.035 + radial * 0.025
        sepal_tip = base + axis * 0.27 + radial * 0.115 - Vector((0, 0, 0.015))
        sepal_material = calyx_mat if index % 2 == 0 else sepal_light
        add_blade(f"Bud_sepal_{index + 1}", sepal_base, sepal_tip, 0.075, sepal_material,
                  thickness=0.003, curvature=0.018, serration=0.015, phase=index)

    # Slightly darker curved seams keep the closed bud readable as folded rose petals.
    for index in range(5):
        theta = math.tau * index / 5.0 + 0.55
        points = []
        for fraction in (0.24, 0.42, 0.62, 0.80, 0.94):
            z, radius = min(profile, key=lambda pair: abs(pair[0] - fraction))
            angle = theta + 0.12 * fraction
            center = base + axis * (z * length)
            points.append(center + side * (radius * 1.014 * math.cos(angle)) + other * (radius * 1.014 * math.sin(angle)))
        curve_tube(f"Bud_petal_seam_{index + 1}", points, [0.45, 0.7, 0.7, 0.45, 0.04], 0.0025, petal_mats[1])


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_camera(name, location, target, ortho_scale=3.28):
    data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, data)
    STUDIO_COLLECTION.objects.link(camera)
    STUDIO_OBJECTS.append(camera)
    camera.location = location
    aim(camera, target)
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    data.lens = 52
    data.dof.use_dof = False
    return camera


def area_light(name, location, target, energy, size, tint):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = tint
    obj = bpy.data.objects.new(name, data)
    STUDIO_COLLECTION.objects.link(obj)
    STUDIO_OBJECTS.append(obj)
    obj.location = location
    aim(obj, target)
    return obj


def build_scene():
    global ASSET_COLLECTION, STUDIO_COLLECTION
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    root_collection = bpy.context.scene.collection
    old = bpy.data.collections.get("Collection")
    if old:
        bpy.data.collections.remove(old)
    ASSET_COLLECTION = bpy.data.collections.new("ASSET | Garden rose specimen")
    STUDIO_COLLECTION = bpy.data.collections.new("STUDIO | cameras, lights, ground")
    root_collection.children.link(ASSET_COLLECTION)
    root_collection.children.link(STUDIO_COLLECTION)

    stem_mat = material("Stem | deep olive green", "35542D", 0.60)
    thorn_mat = material("Thorns | muted olive", "4A5632", 0.62)
    leaf_mat = material("Leaf | rose green", "275A31", 0.54, coat=0.04)
    leaf_shade = material("Leaf | shaded green", "204827", 0.56, coat=0.025)
    leaf_young = material("Leaf | young tips", "58804A", 0.52, coat=0.03)
    vein_mat = material("Leaf veins | soft sage", "78915E", 0.53)
    calyx_mat = material("Calyx | forest green", "294A29", 0.52)
    sepal_light = material("Calyx | lighter ridges", "45673A", 0.5)
    petal_palette = [
        material("Petal | carmine", "A70F36", 0.45, subsurface=0.045, coat=0.045),
        material("Petal | rose shadow", "8F102E", 0.48, subsurface=0.04, coat=0.035),
        material("Petal | warm crimson", "BD2041", 0.43, subsurface=0.05, coat=0.05),
        material("Petal | inner ruby", "C52A4A", 0.42, subsurface=0.05, coat=0.05),
    ]

    root = bpy.data.objects.new("GardenRose_root_origin", None)
    ASSET_COLLECTION.objects.link(root)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = 0.12
    root.location = (0, 0, 0)
    ASSET_OBJECTS.append(root)

    stem_points = [
        (0.00, 0.00, 0.00), (0.035, 0.008, 0.28), (0.10, 0.025, 0.59),
        (0.12, 0.035, 0.90), (0.08, 0.020, 1.20), (0.005, -0.005, 1.49),
        (-0.045, -0.025, 1.78), (-0.095, -0.035, 2.00),
    ]
    curve_tube("Main_stem_curved", stem_points, [0.92, 0.88, 0.80, 0.74, 0.66, 0.59, 0.52, 0.45],
               0.021, stem_mat, resolution=4)

    leaf_sites = [
        ((0.075, 0.02, 0.50), (0.76, -0.16, -0.24), 0.79, 1.10),
        ((0.11, 0.03, 0.84), (-0.65, -0.43, 0.39), 0.78, 1.00),
        ((0.095, 0.025, 1.18), (0.30, 0.76, -0.34), 0.78, 0.98),
        ((-0.01, -0.005, 1.52), (-0.57, 0.16, 0.47), 0.71, 0.90),
    ]
    for index, (site, direction, reach, size) in enumerate(leaf_sites, start=1):
        add_compound_leaf(site, reach, direction, size, f"Compound_leaf_{index}", leaf_mat, leaf_young, vein_mat)

    for index, (point_index, side, length) in enumerate(((1, -1, 0.075), (2, 1, 0.078), (3, -1, 0.063),
                                                          (4, 1, 0.072), (5, -1, 0.058), (6, 1, 0.054),
                                                          (6, -1, 0.051), (2, -1, 0.060)), start=1):
        point = Vector(stem_points[point_index])
        direction = Vector((side * 0.76, 0.16 * (-1 if index % 2 else 1), -0.64))
        add_thorn(f"Stem_thorn_{index:02d}", point, direction, length, thorn_mat)

    flower_center = Vector((-0.105, -0.042, 2.075))
    flower_axis = Vector((0.32, -0.51, 0.80)).normalized()
    right = Vector((0, 0, 1)).cross(flower_axis).normalized()
    up = flower_axis.cross(right).normalized()
    calyx_base = flower_center - flower_axis * 0.15
    curve_tube("Flower_pedicel", [stem_points[-2], (-0.075, -0.032, 1.92), calyx_base],
               [0.52, 0.42, 0.38], 0.025, stem_mat)
    for index in range(5):
        theta = math.tau * index / 5.0 + 0.31
        radial = right * math.cos(theta) + up * math.sin(theta)
        sepal_start = flower_center - flower_axis * 0.20 + radial * 0.045
        sepal_tip = flower_center - flower_axis * 0.08 + radial * 0.57 - Vector((0, 0, 0.025))
        add_blade(f"Flower_sepal_{index + 1}", sepal_start, sepal_tip, 0.15, calyx_mat,
                  thickness=0.004, curvature=0.024, serration=0.025, phase=index * 0.9)

    # The shaded receptacle closes small gaps between the tightly overlapping inner petals.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16,
                                         location=flower_center - flower_axis * 0.035)
    receptacle = register(bpy.context.object)
    receptacle.name = "Flower_receptacle"
    receptacle.rotation_euler = flower_axis.to_track_quat("Z", "Y").to_euler()
    receptacle.scale = (0.32, 0.32, 0.11)
    receptacle.data.materials.append(petal_palette[1])
    for polygon in receptacle.data.polygons:
        polygon.use_smooth = True

    layers = [
        ("Outer", 15, 0.205, 0.680, 0.163, -0.045, -0.195, 0.078, 0.30),
        ("Middle", 12, 0.100, 0.525, 0.142, 0.018, -0.012, 0.061, 0.48),
        ("Inner", 9, 0.080, 0.370, 0.108, 0.074, 0.034, 0.043, 0.72),
        ("Heart", 7, 0.065, 0.240, 0.092, 0.085, 0.105, 0.030, 1.05),
    ]
    petal_counter = 0
    for layer_index, (layer, count, r_start, r_end, half_width, z_start, z_end, curl, twist) in enumerate(layers):
        phase = (0.14, 0.39, 0.03, 0.27)[layer_index]
        for index in range(count):
            theta = math.tau * (index + 0.5 * (layer_index % 2)) / count + phase
            theta += random.uniform(-0.12, 0.12)
            petal_counter += 1
            palette = petal_palette[layer_index] if layer_index < 3 else petal_palette[3 if index % 3 else 2]
            make_petal(f"Petal_{layer}_{index + 1:02d}", flower_center, right, up, flower_axis, theta,
                       r_start, r_end * random.uniform(0.965, 1.035), half_width, z_start, z_end,
                       curl, twist + random.uniform(-0.06, 0.06), palette, petal_counter)

    # A compact offset bud grows from a visible side node on its own curved pedicel.
    bud_origin = Vector((0.005, -0.005, 1.49))
    bud_axis = Vector((0.72, -0.18, 0.67)).normalized()
    bud_base = bud_origin + bud_axis * 0.43
    curve_tube("Bud_pedicel", [bud_origin, (0.19, -0.10, 1.59), (0.36, -0.20, 1.73), bud_base],
               [0.70, 0.53, 0.40], 0.018, stem_mat)
    add_bud(bud_base, bud_axis, calyx_mat, sepal_light, [petal_palette[0], petal_palette[1]])

    for obj in ASSET_OBJECTS:
        if obj != root:
            obj.parent = root

    # A neutral shadow-catching ground plane and soft area-light rig are presentation only.
    ground_mat = material("Studio | warm ivory background", "E8E6E1", 0.82)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.018))
    ground = register(bpy.context.object, asset=False)
    ground.name = "Studio_ground"
    ground.data.materials.append(ground_mat)

    world = bpy.data.worlds.new("Soft neutral studio") if bpy.data.worlds.get("Soft neutral studio") is None else bpy.data.worlds.get("Soft neutral studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = color("DDE1E1")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.36

    area_light("Key | large warm softbox", (3.6, -3.5, 5.3), (0, 0, 1.1), 280, 3.2, (1.0, 0.86, 0.79))
    area_light("Fill | cool softbox", (-3.8, -2.4, 3.4), (0, 0, 1.0), 180, 3.8, (0.78, 0.87, 1.0))
    area_light("Rim | leaf separation", (1.0, 3.0, 4.5), (0, 0, 1.3), 300, 2.7, (1.0, 0.92, 0.82))

    target = (0.0, 0.0, 1.17)
    cameras = {
        "hero": create_camera("Camera_hero_three_quarter", (3.5, -6.4, 4.15), target, 3.23),
        "front": create_camera("Camera_front", (0.0, -8.0, 2.70), target, 3.28),
        "side": create_camera("Camera_side", (8.0, 0.0, 2.70), target, 3.28),
        "back": create_camera("Camera_back", (0.0, 8.0, 2.70), target, 3.28),
    }

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.camera = cameras["hero"]
    scene.render.filepath = str(PREVIEW_DIR / "garden_rose_hero.png")
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 18

    # Helpful opening state: asset selected, studio hidden from selection, hero camera active.
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_perspective = "CAMERA"

    root["species"] = "Rosa sp. | cultivated garden rose"
    root["asset_scale_m"] = "approximately 2.3 m tall"
    root["generation_seed"] = SEED
    root["description"] = "Single curved flowering shoot with a full crimson bloom, side bud, prickles and compound pinnate leaves."
    return cameras


def mesh_metrics(collection):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices = triangles = 0
    bounds_min = Vector((float("inf"),) * 3)
    bounds_max = Vector((float("-inf"),) * 3)
    for obj in collection.objects:
        if obj.type not in {"MESH", "CURVE", "SURFACE", "FONT", "META"}:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        if not mesh:
            continue
        mesh.calc_loop_triangles()
        vertices += len(mesh.vertices)
        triangles += len(mesh.loop_triangles)
        matrix = evaluated.matrix_world
        for vertex in mesh.vertices:
            point = matrix @ vertex.co
            for axis in range(3):
                bounds_min[axis] = min(bounds_min[axis], point[axis])
                bounds_max[axis] = max(bounds_max[axis], point[axis])
        evaluated.to_mesh_clear()
    return vertices, triangles, bounds_min, bounds_max


def main():
    BLENDER_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    cameras = build_scene()
    scene = bpy.context.scene
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    for view_name, camera in cameras.items():
        scene.camera = camera
        scene.render.filepath = str(PREVIEW_DIR / f"garden_rose_{view_name}.png")
        bpy.ops.render.render(write_still=True)

    scene.camera = cameras["hero"]
    scene.render.filepath = str(PREVIEW_DIR / "garden_rose_hero.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    vertices, triangles, bounds_min, bounds_max = mesh_metrics(ASSET_COLLECTION)
    dimensions = bounds_max - bounds_min
    materials = {mat.name for obj in ASSET_COLLECTION.objects if obj.data for mat in obj.data.materials}
    print("GARDEN_ROSE_QA")
    print(f"objects={len(ASSET_COLLECTION.objects)} materials={len(materials)} evaluated_vertices={vertices} evaluated_triangles={triangles}")
    print(f"bounds_min={tuple(round(value, 4) for value in bounds_min)}")
    print(f"bounds_max={tuple(round(value, 4) for value in bounds_max)}")
    print(f"dimensions_m={tuple(round(value, 4) for value in dimensions)}")
    print(f"seed={SEED} blender={bpy.app.version_string} blend={BLEND_PATH}")
    for view_name in cameras:
        print(f"preview_{view_name}={(PREVIEW_DIR / f'garden_rose_{view_name}.png').stat().st_size} bytes")


if __name__ == "__main__":
    main()
