"""Deterministically build an art-directed, meter-scale garden rose specimen."""

from __future__ import annotations

import math
import os
import random
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


SEED = 314159
BLOOM_SCALE = 0.22
ROOT = Path(__file__).resolve().parents[1]
BLENDER_DIR = ROOT / "blender"
PREVIEW_DIR = BLENDER_DIR / "previews"
BLEND_PATH = BLENDER_DIR / "garden_rose.blend"

_RNG = random.Random(SEED)
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


def rose_petal_material():
    """Give every petal a shared, softly varied natural rose surface."""
    mat = bpy.data.materials.new("Petal | natural crimson satin")
    mat.diffuse_color = color("A5233D")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.53
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.075
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = (0.8, 0.28, 0.24)
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.025
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.42
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.28

    object_info = nodes.new("ShaderNodeObjectInfo")
    object_info.location = (-640, 240)
    texture_coordinates = nodes.new("ShaderNodeTexCoord")
    texture_coordinates.location = (-900, -120)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-640, 20)
    noise.inputs["Scale"].default_value = 8.0
    noise.inputs["Detail"].default_value = 2.0
    noise.inputs["Roughness"].default_value = 0.66
    links.new(texture_coordinates.outputs["UV"], noise.inputs["Vector"])
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.location = (-400, 170)
    mix.inputs["Fac"].default_value = 0.18
    links.new(object_info.outputs["Random"], mix.inputs["Color1"])
    links.new(noise.outputs["Fac"], mix.inputs["Color2"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-170, 170)
    ramp.color_ramp.elements[0].position = 0.04
    ramp.color_ramp.elements[0].color = color("74172D")
    ramp.color_ramp.elements[1].position = 0.96
    ramp.color_ramp.elements[1].color = color("B52C49")
    middle = ramp.color_ramp.elements.new(0.50)
    middle.color = color("971D39")
    links.new(mix.outputs["Color"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    roughness = nodes.new("ShaderNodeMapRange")
    roughness.location = (-170, -80)
    roughness.inputs["From Min"].default_value = 0.0
    roughness.inputs["From Max"].default_value = 1.0
    roughness.inputs["To Min"].default_value = 0.48
    roughness.inputs["To Max"].default_value = 0.60
    links.new(noise.outputs["Fac"], roughness.inputs["Value"])
    links.new(roughness.outputs["Result"], bsdf.inputs["Roughness"])

    fine_noise = nodes.new("ShaderNodeTexNoise")
    fine_noise.location = (-400, -280)
    fine_noise.inputs["Scale"].default_value = 58.0
    fine_noise.inputs["Detail"].default_value = 2.0
    links.new(texture_coordinates.outputs["UV"], fine_noise.inputs["Vector"])
    veins = nodes.new("ShaderNodeTexWave")
    veins.location = (-640, -500)
    veins.wave_type = "BANDS"
    veins.bands_direction = "Y"
    veins.inputs["Scale"].default_value = 8.0
    veins.inputs["Distortion"].default_value = 5.5
    veins.inputs["Detail"].default_value = 2.0
    veins.inputs["Detail Scale"].default_value = 1.6
    links.new(texture_coordinates.outputs["UV"], veins.inputs["Vector"])
    surface_detail = nodes.new("ShaderNodeMixRGB")
    surface_detail.blend_type = "MULTIPLY"
    surface_detail.location = (-390, -450)
    surface_detail.inputs["Fac"].default_value = 0.20
    links.new(veins.outputs["Color"], surface_detail.inputs["Color1"])
    links.new(fine_noise.outputs["Fac"], surface_detail.inputs["Color2"])
    bump = nodes.new("ShaderNodeBump")
    bump.location = (-150, -420)
    bump.inputs["Strength"].default_value = 0.045
    bump.inputs["Distance"].default_value = 0.002 * BLOOM_SCALE
    links.new(surface_detail.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def register(obj, asset=True):
    (ASSET_OBJECTS if asset else STUDIO_OBJECTS).append(obj)
    collection = ASSET_COLLECTION if asset else STUDIO_COLLECTION
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def curve_tube(name, points, radii, bevel, mat, asset=True, resolution=3):
    if len(points) != len(radii):
        raise ValueError(f"Curve point/radius count mismatch for {name}: {len(points)} points, {len(radii)} radii")
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
               z_start, z_end, edge_curl, twist, spiral, arch, mat, seed_offset):
    r_start *= BLOOM_SCALE
    r_end *= BLOOM_SCALE
    half_width *= BLOOM_SCALE
    z_start *= BLOOM_SCALE
    z_end *= BLOOM_SCALE
    edge_curl *= BLOOM_SCALE
    arch *= BLOOM_SCALE
    rows, columns = 32, 16
    vertices, faces = [], []
    length_jitter = _RNG.uniform(-0.035, 0.035)
    width_jitter = _RNG.uniform(0.82, 1.17)
    phase = _RNG.uniform(0.0, math.tau) + seed_offset * 0.37
    for row in range(rows + 1):
        t = row / rows
        radius = r_start + (r_end - r_start) * t + length_jitter * t
        if t <= 0.78:
            profile = 0.10 + 0.90 * math.sin((math.pi * 0.5) * t / 0.78) ** 0.78
        else:
            profile = math.sqrt(max(0.0, 1.0 - ((t - 0.78) / 0.22) ** 2))
        for column in range(columns + 1):
            q = -1.0 + 2.0 * column / columns
            local_theta = theta + spiral * t + twist * t * q + 0.018 * math.sin(t * 4.0 + phase) * t
            radial = right * math.cos(local_theta) + up * math.sin(local_theta)
            crosswise = -right * math.sin(local_theta) + up * math.cos(local_theta)
            edge_wave = BLOOM_SCALE * (0.019 * math.sin(t * 11.0 + phase) + 0.008 * math.sin(t * 23.0 + phase * 1.7)) * abs(q) ** 6
            point = Vector(center) + radial * (radius + edge_wave)
            point += crosswise * (q * half_width * profile * width_jitter * (1.0 + 0.10 * q))
            edge_bias = 0.16 * math.sin(phase)
            cup = edge_curl * abs(q) ** 1.7 * (1.0 + edge_bias * q) * max(0.0, math.sin(math.pi * t)) ** 0.45
            cup += BLOOM_SCALE * 0.012 * math.sin(t * 7.0 + phase) * q
            bowl = BLOOM_SCALE * -0.026 * math.sin(math.pi * t) * (1.0 - q * q)
            vein = BLOOM_SCALE * 0.006 * (1.0 - q * q) ** 3 * math.sin(math.pi * t)
            longitudinal_arch = arch * math.sin(math.pi * t)
            point += normal * (z_start + (z_end - z_start) * t + cup + bowl + vein + longitudinal_arch)
            vertices.append(tuple(point))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            b = a + columns + 1
            faces.append((a, b, b + 1, a + 1))
    obj = mesh_object(name, vertices, faces, mat)
    uv_layer = obj.data.uv_layers.new(name="Petal flow")
    for loop in obj.data.loops:
        row, column = divmod(loop.vertex_index, columns + 1)
        uv_layer.data[loop.index].uv = (row / rows, column / columns)
    add_surface_modifiers(obj, thickness=0.004 * BLOOM_SCALE, levels=1)
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
    rings = ((0.0, 0.006), (0.34, 0.0045), (0.72, 0.002), (1.0, 0.0004))
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
    bevel.width = 0.0008
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
    length = 0.16
    profile = ((0.00, 0.036), (0.10, 0.075), (0.28, 0.105), (0.53, 0.122),
               (0.72, 0.108), (0.88, 0.067), (0.97, 0.027), (1.00, 0.003))
    segments = 30
    vertices, faces = [], []
    scaled_profile = [(height, radius * BLOOM_SCALE) for height, radius in profile]
    for height, radius in scaled_profile:
        center = base + axis * (height * length)
        for index in range(segments):
            theta = math.tau * index / segments
            lobed_radius = radius * (1.0 + 0.055 * math.cos(5.0 * theta + 0.2))
            point = center + side * (lobed_radius * math.cos(theta)) + other * (lobed_radius * math.sin(theta))
            vertices.append(tuple(point))
    for row in range(len(scaled_profile) - 1):
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
        sepal_base = base + axis * 0.015 + radial * 0.012
        sepal_tip = base + axis * 0.115 + radial * 0.050 - Vector((0, 0, 0.008))
        sepal_material = calyx_mat if index % 2 == 0 else sepal_light
        add_blade(f"Bud_sepal_{index + 1}", sepal_base, sepal_tip, 0.035, sepal_material,
                  thickness=0.0015, curvature=0.007, serration=0.015, phase=index)

    # Slightly darker curved seams keep the closed bud readable as folded rose petals.
    for index in range(5):
        theta = math.tau * index / 5.0 + 0.55
        points = []
        for fraction in (0.24, 0.42, 0.62, 0.80, 0.94):
            z, radius = min(scaled_profile, key=lambda pair: abs(pair[0] - fraction))
            angle = theta + 0.12 * fraction
            center = base + axis * (z * length)
            points.append(center + side * (radius * 1.014 * math.cos(angle)) + other * (radius * 1.014 * math.sin(angle)))
        curve_tube(f"Bud_petal_seam_{index + 1}", points, [0.45, 0.7, 0.7, 0.45, 0.04], 0.0006, petal_mats[1])


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


def build_factory_scene(seed=SEED):
    """Create the preserved original specimen modelers in a genuinely empty scene only."""
    global ASSET_COLLECTION, STUDIO_COLLECTION
    if bpy.context.scene.objects or bpy.context.scene.collection.children:
        raise RuntimeError("Rose factory bootstrap requires an empty scene; use regenerate_scene for an existing specimen")
    if any(bpy.data.collections.get(name) for name in (
        "ASSET | Garden rose specimen", "STUDIO | cameras, lights, ground"
    )):
        raise RuntimeError("Rose factory bootstrap collection-name collision")
    ASSET_OBJECTS.clear()
    STUDIO_OBJECTS.clear()
    _RNG.seed(seed)
    root_collection = bpy.context.scene.collection
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
    bloom_petal_mat = rose_petal_material()

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
        add_thorn(f"Stem_thorn_{index:02d}", point, direction, length * 0.52, thorn_mat)

    flower_center = Vector((-0.105, -0.042, 2.075))
    flower_axis = Vector((0.32, -0.51, 0.80)).normalized()
    right = Vector((0, 0, 1)).cross(flower_axis).normalized()
    up = flower_axis.cross(right).normalized()
    calyx_base = flower_center - flower_axis * (0.15 * BLOOM_SCALE)
    curve_tube("Flower_pedicel", [stem_points[-2], (-0.075, -0.032, 1.92), calyx_base],
               [0.52, 0.42, 0.38], 0.025, stem_mat)
    for index in range(5):
        theta = math.tau * index / 5.0 + 0.31
        radial = right * math.cos(theta) + up * math.sin(theta)
        sepal_start = flower_center - flower_axis * (0.20 * BLOOM_SCALE) + radial * (0.045 * BLOOM_SCALE)
        sepal_tip = flower_center - flower_axis * (0.08 * BLOOM_SCALE) + radial * (0.57 * BLOOM_SCALE) - Vector((0, 0, 0.025 * BLOOM_SCALE))
        add_blade(f"Flower_sepal_{index + 1}", sepal_start, sepal_tip, 0.15 * BLOOM_SCALE, calyx_mat,
                  thickness=0.004 * BLOOM_SCALE, curvature=0.024 * BLOOM_SCALE, serration=0.025, phase=index * 0.9)

    # The shaded receptacle closes small gaps between the tightly overlapping inner petals.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16,
                                         location=flower_center - flower_axis * (0.035 * BLOOM_SCALE))
    receptacle = register(bpy.context.object)
    receptacle.name = "Flower_receptacle"
    receptacle.rotation_euler = flower_axis.to_track_quat("Z", "Y").to_euler()
    receptacle.scale = (0.32 * BLOOM_SCALE, 0.32 * BLOOM_SCALE, 0.11 * BLOOM_SCALE)
    receptacle.data.materials.append(petal_palette[1])
    for polygon in receptacle.data.polygons:
        polygon.use_smooth = True

    layers = [
        ("Outer", 14, 0.145, 0.710, 0.190, -0.035, -0.160, 0.075, 0.18, 0.04, 0.045),
        ("Middle", 12, 0.075, 0.550, 0.157, 0.006, -0.030, 0.064, 0.23, 0.07, 0.075),
        ("Inner", 10, 0.045, 0.390, 0.123, 0.052, 0.035, 0.052, 0.30, 0.12, 0.055),
        ("Heart", 8, 0.035, 0.255, 0.096, 0.048, 0.095, 0.042, 0.34, 0.20, 0.025),
        ("Core", 7, 0.004, 0.145, 0.055, 0.080, 0.110, 0.025, 0.12, 0.20, 0.018),
    ]
    petal_counter = 0
    golden_angle = math.tau * (1.0 - 1.0 / ((1.0 + math.sqrt(5.0)) * 0.5))
    for layer_index, (layer, count, r_start, r_end, half_width, z_start, z_end, curl, twist, spiral, arch) in enumerate(layers):
        phase = (0.14, 0.39, 0.03, 0.27, 0.19)[layer_index]
        for index in range(count):
            theta = index * golden_angle + phase + layer_index * 0.21
            theta += _RNG.uniform(-0.16, 0.16)
            petal_counter += 1
            start_jitter = min(0.025, r_start * 0.30 + 0.001)
            personal_start = max(0.0, r_start + _RNG.uniform(-start_jitter, start_jitter))
            personal_end = r_end * _RNG.uniform(0.94, 1.06)
            personal_width = half_width * _RNG.uniform(0.86, 1.14)
            personal_z_start = z_start + _RNG.uniform(-0.018, 0.018)
            personal_z_end = z_end + _RNG.uniform(-0.035, 0.035)
            personal_spiral = spiral + _RNG.uniform(-0.07, 0.07)
            personal_arch = arch * _RNG.uniform(0.70, 1.30)
            make_petal(f"Petal_{layer}_{index + 1:02d}", flower_center, right, up, flower_axis, theta,
                       personal_start, personal_end, personal_width, personal_z_start, personal_z_end,
                       curl * _RNG.uniform(0.72, 1.28), twist + _RNG.uniform(-0.18, 0.18), personal_spiral,
                       personal_arch, bloom_petal_mat, petal_counter)

    # A compact offset bud grows from a visible side node on its own curved pedicel.
    bud_origin = Vector((0.005, -0.005, 1.49))
    bud_axis = Vector((0.82, -0.36, 0.44)).normalized()
    bud_base = bud_origin + bud_axis * 0.24
    curve_tube("Bud_pedicel", [bud_origin, (0.13, -0.07, 1.53), (0.19, -0.11, 1.56), bud_base],
               [0.70, 0.53, 0.40, 0.30], 0.008, stem_mat)
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
    bloom_view = Vector((0.45, -0.82, 0.38)).normalized()
    cameras["bloom"] = create_camera("Camera_bloom_detail", flower_center + bloom_view * 0.75,
                                     flower_center, 0.42)

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
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == "VIEW_3D":
            area.spaces.active.region_3d.view_perspective = "CAMERA"

    root["species"] = "Rosa sp. | cultivated garden rose"
    root["asset_scale_m"] = "approximately 2.3 m tall"
    root["generation_seed"] = seed
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


# Canonical structural source. The existing stem curve is the only
# generator-owned geometry changed by this adapter; authored organ data stays intact.
CANONICAL_STEM = (
    (0.00, 0.00, 0.00, 0.92), (0.035, 0.008, 0.28, 0.88),
    (0.10, 0.025, 0.59, 0.80), (0.12, 0.035, 0.90, 0.74),
    (0.08, 0.020, 1.20, 0.66), (0.005, -0.005, 1.49, 0.59),
    (-0.045, -0.025, 1.78, 0.52), (-0.095, -0.035, 2.00, 0.45),
)
SCHEMA_VERSION = 1
ASSET_COLLECTION_NAME = "ASSET | Garden rose specimen"
STRUCTURE_COLLECTION_NAME = "PROCEDURAL | Rose shoot"
AUTHORED_COLLECTION_NAME = "AUTHORED | Rose organs"
ROOT_OBJECT_NAME = "GardenRose_root_origin"
STEM_OBJECT_NAME = "Main_stem_curved"
LEAF_SITES = (
    ((0.075, 0.020, 0.50), 0.50), ((0.11, 0.030, 0.84), 0.84),
    ((0.095, 0.025, 1.18), 1.18), ((-0.010, -0.005, 1.52), 1.52),
)
THORN_STEM_INDICES = (1, 2, 3, 4, 5, 6, 6, 2)


def _expected_role_names():
    roles = {}
    for index in range(1, 5):
        prefix = f"Compound_leaf_{index}"
        names = {f"{prefix}_petiole", f"{prefix}_rachis", f"{prefix}_terminal", f"{prefix}_terminal_midrib"}
        for pair in range(1, 6):
            for side in ("L", "R"):
                blade = f"{prefix}_leaflet_{pair}_{side}"
                names.update((blade, blade + "_midrib"))
        roles[f"leaf:{index:02d}"] = names
    roles["flower"] = {"Flower_pedicel", "Flower_receptacle"} | {f"Flower_sepal_{i}" for i in range(1, 6)}
    for layer, count in (("Outer", 14), ("Middle", 12), ("Inner", 10), ("Heart", 8), ("Core", 7)):
        roles["flower"].update(f"Petal_{layer}_{i:02d}" for i in range(1, count + 1))
    roles["bud"] = {"Bud_pedicel", "Bud_closed_corolla"} | {f"Bud_sepal_{i}" for i in range(1, 6)} | {
        f"Bud_petal_seam_{i}" for i in range(1, 6)
    }
    for index in range(1, 9):
        roles[f"thorn:{index:02d}"] = {f"Stem_thorn_{index:02d}"}
    return roles


ROLE_ANCHORS = {
    **{f"leaf:{i:02d}": (site, source_z) for i, (site, source_z) in enumerate(LEAF_SITES, 1)},
    **{f"thorn:{i:02d}": (CANONICAL_STEM[source_index][:3], CANONICAL_STEM[source_index][2])
       for i, source_index in enumerate(THORN_STEM_INDICES, 1)},
    "flower": (CANONICAL_STEM[6][:3], CANONICAL_STEM[6][2]),
    "bud": (CANONICAL_STEM[5][:3], CANONICAL_STEM[5][2]),
}


def _canonical_bud_pedicel_points():
    origin = Vector((0.005, -0.005, 1.49))
    axis = Vector((0.82, -0.36, 0.44)).normalized()
    return (origin, Vector((0.13, -0.07, 1.53)), Vector((0.19, -0.11, 1.56)), origin + axis * 0.24)


def _repair_canonical_bud_pedicel(root):
    """Repair only the exact legacy zip-truncation defect; retain edited organ curves."""
    obj = bpy.data.objects.get("Bud_pedicel")
    if obj is None or obj.type != "CURVE" or obj.data.users != 1 or obj.modifiers or obj.animation_data:
        return False
    authored = bpy.data.collections.get(AUTHORED_COLLECTION_NAME)
    if authored is None or authored not in obj.users_collection:
        return False
    if obj.parent is not _role_socket("bud") or obj.get("rose01_role_id") != "bud":
        return False
    root_relative = root.matrix_world.inverted() @ obj.matrix_world
    if max(abs(root_relative[row][column] - (1.0 if row == column else 0.0))
           for row in range(4) for column in range(4)) > 1e-5:
        return False
    curve = obj.data
    if (curve.dimensions != "3D" or curve.resolution_u != 8 or len(curve.splines) != 1
            or abs(curve.bevel_depth - 0.008) > 1e-7 or curve.bevel_resolution != 3
            or curve.materials[:] != [bpy.data.materials.get("Stem | deep olive green")]):
        return False
    spline = curve.splines[0]
    if spline.type != "POLY" or spline.use_cyclic_u or len(spline.points) != 4:
        return False
    legacy_points = _canonical_bud_pedicel_points()[:3] + (Vector((0.0, 0.0, 0.0)),)
    legacy_radii = (0.70, 0.53, 0.40, 1.0)
    if not all(
        max(abs(point.co[axis] - expected[axis]) for axis in range(3)) <= 1e-6
        and abs(point.radius - radius) <= 1e-6
        and abs(point.tilt) <= 1e-6
        and abs(point.weight - 1.0) <= 1e-6
        for point, expected, radius in zip(spline.points, legacy_points, legacy_radii)
    ):
        return False
    spline.points[-1].co = (*_canonical_bud_pedicel_points()[-1], 1.0)
    spline.points[-1].radius = 0.30
    return True


def _object_signature_is_canonical_stem(stem):
    if stem.type != "CURVE" or stem.data.dimensions != "3D" or len(stem.data.splines) != 1:
        return False
    spline = stem.data.splines[0]
    if spline.type != "POLY" or len(spline.points) != len(CANONICAL_STEM):
        return False
    if abs(stem.data.bevel_depth - 0.021) > 1e-7 or stem.data.bevel_resolution != 4:
        return False
    if stem.data.resolution_u != 8 or stem.modifiers or len(stem.data.materials) != 1:
        return False
    if stem.data.materials[0] is None or stem.data.materials[0].name != "Stem | deep olive green":
        return False
    if stem.parent is None or stem.parent.name != ROOT_OBJECT_NAME:
        return False
    if max(abs(stem.matrix_world[row][column] - (1.0 if row == column else 0.0))
           for row in range(4) for column in range(4)) > 1e-7:
        return False
    return all(
        max(abs(spline.points[i].co[axis] - expected[axis]) for axis in range(3)) < 1e-6
        and abs(spline.points[i].radius - expected[3]) < 1e-6
        for i, expected in enumerate(CANONICAL_STEM)
    )


def _preflight_first_migration():
    """Validate canonical source and all new names before the first scene mutation."""
    scene = bpy.context.scene
    asset = bpy.data.collections.get(ASSET_COLLECTION_NAME)
    root = bpy.data.objects.get(ROOT_OBJECT_NAME)
    stem = bpy.data.objects.get(STEM_OBJECT_NAME)
    if asset is None or root is None or root.type != "EMPTY" or stem is None:
        raise RuntimeError("Rose migration requires the canonical asset collection, root, and stem")
    if "rose01_schema_version" in root:
        raise RuntimeError("Unsupported Rose migration metadata; migration made no changes")
    if asset not in stem.users_collection:
        raise RuntimeError("Canonical stem is outside the garden rose asset collection")
    if stem.data.users != 1:
        raise RuntimeError("Canonical stem data is shared; migration made no changes")
    if not _object_signature_is_canonical_stem(stem):
        raise RuntimeError("Canonical stem signature differs; migration made no changes")
    expected = _expected_role_names()
    for role_id, names in expected.items():
        for name in names:
            obj = bpy.data.objects.get(name)
            if obj is None or asset not in obj.users_collection:
                raise RuntimeError(f"Canonical authored role missing: {role_id}/{name}")
            expected_type = "CURVE" if (
                name.endswith("_petiole") or name.endswith("_rachis") or name.endswith("_midrib")
                or name in {"Flower_pedicel", "Bud_pedicel"} or name.startswith("Bud_petal_seam_")
            ) else "MESH"
            if obj.type != expected_type:
                raise RuntimeError(f"Canonical authored role type mismatch: {role_id}/{name}")
    if len(scene.objects) < 176:
        raise RuntimeError("Rose scene is incomplete; migration made no changes")
    if any(bpy.data.collections.get(name) is not None for name in (
        STRUCTURE_COLLECTION_NAME, AUTHORED_COLLECTION_NAME
    )):
        raise RuntimeError("Rose migration collection name collision")
    reserved = {f"Rose01_socket_{role.replace(':', '_')}" for role in expected}
    collision = sorted(name for name in reserved if bpy.data.objects.get(name) is not None)
    if collision:
        raise RuntimeError("Rose migration socket name collision: " + ", ".join(collision))
    return root, stem, asset, expected


def _stem_point_at_source_z(source_z, height_ratio):
    for left, right in zip(CANONICAL_STEM, CANONICAL_STEM[1:]):
        if left[2] <= source_z <= right[2]:
            t = (source_z - left[2]) / (right[2] - left[2])
            return Vector((left[0] + (right[0] - left[0]) * t,
                           left[1] + (right[1] - left[1]) * t, source_z * height_ratio))
    raise ValueError(f"Anchor lies outside the canonical stem: {source_z}")


def _stem_tangent_at_source_z(source_z, height_ratio):
    for left, right in zip(CANONICAL_STEM, CANONICAL_STEM[1:]):
        if left[2] <= source_z <= right[2]:
            return Vector((right[0] - left[0], right[1] - left[1],
                           (right[2] - left[2]) * height_ratio)).normalized()
    raise ValueError(f"Frame lies outside the canonical stem: {source_z}")


def _socket_matrix(role_id, height_ratio):
    authored_anchor, source_z = ROLE_ANCHORS[role_id]
    source_path = _stem_point_at_source_z(source_z, 1.0)
    target_path = _stem_point_at_source_z(source_z, height_ratio)
    anchor = target_path + (Vector(authored_anchor) - source_path)
    tangent = _stem_tangent_at_source_z(source_z, height_ratio)
    # Fixed canonical reference avoids roll flips near the vertical shoot axis.
    reference = Vector((1.0, 0.0, 0.0))
    lateral = reference - tangent * reference.dot(tangent)
    if lateral.length < 1e-6:
        reference = Vector((0.0, 1.0, 0.0))
        lateral = reference - tangent * reference.dot(tangent)
    lateral.normalize()
    normal = tangent.cross(lateral).normalized()
    rotation = Matrix((lateral, normal, tangent)).transposed().to_4x4()
    rotation.translation = anchor
    return rotation


def _role_socket(role_id):
    socket = bpy.data.objects.get(f"Rose01_socket_{role_id.replace(':', '_')}")
    if socket is None or socket.get("rose01_role_id") != role_id:
        raise RuntimeError(f"Rose role socket is missing or ambiguous: {role_id}")
    return socket


def attach_to_role(obj, role_id):
    """Attach an authored addition to a stable role socket without changing its world matrix."""
    socket = _role_socket(role_id)
    world = obj.matrix_world.copy()
    obj.parent = socket
    obj.matrix_parent_inverse = socket.matrix_world.inverted()
    obj.matrix_world = world
    obj["rose01_role_id"] = role_id
    return obj


def _install_role_sockets(root, stem, asset, expected):
    structure = bpy.data.collections.new(STRUCTURE_COLLECTION_NAME)
    authored = bpy.data.collections.new(AUTHORED_COLLECTION_NAME)
    asset.children.link(structure)
    asset.children.link(authored)
    structure.objects.link(stem)
    asset.objects.unlink(stem)
    stem["rose01_generated_part"] = "main_shoot_axis"
    stem["rose01_schema_version"] = SCHEMA_VERSION
    for role_id, names in expected.items():
        socket = bpy.data.objects.new(f"Rose01_socket_{role_id.replace(':', '_')}", None)
        structure.objects.link(socket)
        socket.empty_display_type = "PLAIN_AXES"
        socket.empty_display_size = 0.035
        socket["rose01_role_id"] = role_id
        socket["rose01_schema_version"] = SCHEMA_VERSION
        socket.parent = root
        socket.matrix_parent_inverse = Matrix.Identity(4)
        socket.matrix_basis = _socket_matrix(role_id, 1.0)
        for name in names:
            obj = bpy.data.objects[name]
            authored.objects.link(obj)
            asset.objects.unlink(obj)
            world = obj.matrix_world.copy()
            obj.parent = socket
            obj.matrix_parent_inverse = socket.matrix_world.inverted()
            obj.matrix_world = world
            obj["rose01_role_id"] = role_id
    root["rose01_schema_version"] = SCHEMA_VERSION
    root["rose01_generation_seed"] = SEED
    root["rose01_height_ratio"] = 1.0


def _validate_migrated_scene():
    root = bpy.data.objects.get(ROOT_OBJECT_NAME)
    stem = bpy.data.objects.get(STEM_OBJECT_NAME)
    if root is None or root.get("rose01_schema_version") != SCHEMA_VERSION:
        raise RuntimeError("Rose scene has no supported adapter schema")
    if stem is None or stem.get("rose01_generated_part") != "main_shoot_axis":
        raise RuntimeError("Rose structural stem is not tagged as generator-owned")
    if stem.type != "CURVE" or len(stem.data.splines) != 1 or len(stem.data.splines[0].points) != len(CANONICAL_STEM):
        raise RuntimeError("Rose structural stem topology is unsupported")
    for role_id in ROLE_ANCHORS:
        _role_socket(role_id)
    if bpy.data.collections.get(STRUCTURE_COLLECTION_NAME) is None or bpy.data.collections.get(AUTHORED_COLLECTION_NAME) is None:
        raise RuntimeError("Rose role collections are incomplete")
    return root, stem


def regenerate_scene(seed=SEED, stem_height_ratio=1.0):
    """Regenerate only the shoot curve and its local role frames in the open Rose01 scene."""
    if isinstance(seed, bool) or not isinstance(seed, int) or seed != SEED:
        raise ValueError(f"Rose01 pilot preserves the authored source seed {SEED}")
    if isinstance(stem_height_ratio, bool) or not isinstance(stem_height_ratio, (int, float)):
        raise ValueError("stem_height_ratio must be a finite number in [0.9, 1.1]")
    if not math.isfinite(stem_height_ratio) or not 0.9 <= stem_height_ratio <= 1.1:
        raise ValueError("stem_height_ratio must be a finite number in [0.9, 1.1]")
    ratio = float(stem_height_ratio)
    root = bpy.data.objects.get(ROOT_OBJECT_NAME)
    if root is not None and root.get("rose01_schema_version") == SCHEMA_VERSION:
        root, stem = _validate_migrated_scene()
        _repair_canonical_bud_pedicel(root)
    else:
        root, stem, asset, expected = _preflight_first_migration()
        _install_role_sockets(root, stem, asset, expected)
        _repair_canonical_bud_pedicel(root)
        root, stem = _validate_migrated_scene()
    spline = stem.data.splines[0]
    for point, canonical in zip(spline.points, CANONICAL_STEM):
        point.co = (canonical[0], canonical[1], canonical[2] * ratio, 1.0)
        point.radius = canonical[3]
    for role_id in ROLE_ANCHORS:
        _role_socket(role_id).matrix_basis = _socket_matrix(role_id, ratio)
    root["rose01_generation_seed"] = seed
    root["rose01_height_ratio"] = ratio
    bpy.context.view_layer.update()
    return {"seed": seed, "stem_height_ratio": ratio, "roles": tuple(sorted(ROLE_ANCHORS)), "stem": stem}


def save_source(filepath=None, seed=SEED, stem_height_ratio=1.0):
    """Regenerate the open source scene, then save its editable .blend explicitly."""
    regenerate_scene(seed=seed, stem_height_ratio=stem_height_ratio)
    target = Path(filepath) if filepath else BLEND_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    return target


def build_scene():
    """Compatibility entry point for non-destructive regeneration of an open source scene."""
    return regenerate_scene()


def main():
    if not BLEND_PATH.is_file():
        raise FileNotFoundError(f"Editable Rose01 source scene not found: {BLEND_PATH}")
    bpy.ops.wm.open_mainfile(filepath=str(BLEND_PATH))
    result = regenerate_scene()
    saved = save_source(seed=result["seed"], stem_height_ratio=result["stem_height_ratio"])
    print(f"GARDEN_ROSE_REGENERATED seed={result['seed']} height_ratio={result['stem_height_ratio']} blend={saved}")


if __name__ == "__main__":
    main()
