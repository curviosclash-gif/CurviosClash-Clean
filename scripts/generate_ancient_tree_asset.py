#!/usr/bin/env python3
"""Build the hand-authored ancient tree and its eight presentation views.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python scripts/generate_ancient_tree_asset.py

The tree is based on the user-approved watercolour concept: a massive twisted oak with
exposed radial roots, four art-directed leaders, a recursively branching crown, moss, and
readable branch gaps. The generator is deterministic so the editable Blender source,
runtime GLB and preview renders can be recreated together.
"""

from __future__ import annotations

from math import atan2, cos, degrees, pi, sin
from pathlib import Path
import random

import bpy
from mathutils import Euler, Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "models" / "ancient_tree"
SOURCE_DIR = ASSET_DIR / "blender"
PREVIEW_DIR = SOURCE_DIR / "previews"
BLEND_PATH = SOURCE_DIR / "ancient_tree.blend"
GLB_PATH = ASSET_DIR / "ancient_tree.glb"
SEED = 41073

TREE_COLLECTION = "AncientTree"
PRESENTATION_COLLECTION = "Presentation"


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "AncientTree"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 1
    scene["asset"] = "ancient_tree"
    scene["generator"] = "scripts/generate_ancient_tree_asset.py"
    scene["reference"] = "user-approved watercolour ancient oak"
    bpy.context.preferences.filepaths.save_version = 0

    world = bpy.data.worlds.new("AncientTreeWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.05, 0.025, 1)
    background.inputs["Strength"].default_value = 0.18
    scene.world = world

    tree = bpy.data.collections.new(TREE_COLLECTION)
    presentation = bpy.data.collections.new(PRESENTATION_COLLECTION)
    scene.collection.children.link(tree)
    scene.collection.children.link(presentation)
    return scene, tree, presentation


def link_to_collection(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def principled_material(name, color, roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


def bark_material():
    mat = bpy.data.materials.new("AncientBark")
    mat.diffuse_color = (0.18, 0.12, 0.068, 1)
    mat.metallic = 0.0
    mat.roughness = 0.97
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = 0.97
    shader.inputs["Specular IOR Level"].default_value = 0.06
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = 0.0

    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1.7, 1.7, 0.38)

    # Three related octaves create self-similar bark plates at trunk, branch and fibre scale.
    fractal_noises = []
    for label, scale, detail, roughness, distortion in (
        ("Macro", 3.2, 6.0, 0.78, 0.24),
        ("Meso", 12.8, 7.0, 0.82, 0.18),
        ("Micro", 51.2, 4.0, 0.7, 0.08),
    ):
        noise = nodes.new("ShaderNodeTexNoise")
        noise.label = f"FractalBark{label}"
        noise.noise_dimensions = "3D"
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = detail
        noise.inputs["Roughness"].default_value = roughness
        noise.inputs["Distortion"].default_value = distortion
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        fractal_noises.append(noise)

    weighted = []
    for noise, weight in zip(fractal_noises, (0.57, 0.3, 0.13)):
        multiply = nodes.new("ShaderNodeMath")
        multiply.operation = "MULTIPLY"
        multiply.inputs[1].default_value = weight
        links.new(noise.outputs["Fac"], multiply.inputs[0])
        weighted.append(multiply)
    macro_and_meso = nodes.new("ShaderNodeMath")
    macro_and_meso.operation = "ADD"
    fractal_height = nodes.new("ShaderNodeMath")
    fractal_height.operation = "ADD"
    links.new(weighted[0].outputs[0], macro_and_meso.inputs[0])
    links.new(weighted[1].outputs[0], macro_and_meso.inputs[1])
    links.new(macro_and_meso.outputs[0], fractal_height.inputs[0])
    links.new(weighted[2].outputs[0], fractal_height.inputs[1])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (0.022, 0.012, 0.006, 1)
    ramp.color_ramp.elements[1].position = 0.8
    ramp.color_ramp.elements[1].color = (0.30, 0.205, 0.115, 1)
    mid = ramp.color_ramp.elements.new(0.5)
    mid.color = (0.105, 0.063, 0.03, 1)

    moss_noise = nodes.new("ShaderNodeTexNoise")
    moss_noise.inputs["Scale"].default_value = 1.65
    moss_noise.inputs["Detail"].default_value = 5.0
    moss_noise.inputs["Roughness"].default_value = 0.74
    moss_mask = nodes.new("ShaderNodeValToRGB")
    moss_mask.color_ramp.interpolation = "CONSTANT"
    moss_mask.color_ramp.elements[0].position = 0.66
    moss_mask.color_ramp.elements[0].color = (0, 0, 0, 1)
    moss_mask.color_ramp.elements[1].position = 0.73
    moss_mask.color_ramp.elements[1].color = (0.34, 0.34, 0.34, 1)
    moss_mix = nodes.new("ShaderNodeMixRGB")
    moss_mix.blend_type = "MIX"
    moss_mix.inputs[2].default_value = (0.045, 0.14, 0.018, 1)

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.82
    bump.inputs["Distance"].default_value = 0.3

    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], moss_noise.inputs["Vector"])
    links.new(fractal_height.outputs[0], ramp.inputs["Fac"])
    links.new(moss_noise.outputs["Fac"], moss_mask.inputs["Fac"])
    links.new(moss_mask.outputs["Color"], moss_mix.inputs["Fac"])
    links.new(ramp.outputs["Color"], moss_mix.inputs[1])
    links.new(moss_mix.outputs["Color"], shader.inputs["Base Color"])
    links.new(fractal_height.outputs[0], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    mat["fractal_bark_octaves"] = 3
    mat["fractal_bark_scales"] = (3.2, 12.8, 51.2)
    mat["finish"] = "matte"
    return mat


def leaf_material(name, dark, light):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = light
    mat.use_nodes = True
    mat.use_backface_culling = False
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.72
    shader.inputs["Specular IOR Level"].default_value = 0.18
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.3
    noise.inputs["Detail"].default_value = 3.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].color = light
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    return mat


def build_materials():
    return {
        "bark": bark_material(),
        "bark_dark": principled_material("BarkCrevice", (0.028, 0.012, 0.004, 1), 1.0),
        "bark_light": principled_material("BarkRaisedFiber", (0.31, 0.22, 0.13, 1), 0.98),
        "leaf_1": leaf_material("LeafForest", (0.018, 0.09, 0.015, 1), (0.12, 0.34, 0.055, 1)),
        "leaf_2": leaf_material("LeafSage", (0.035, 0.12, 0.025, 1), (0.24, 0.47, 0.10, 1)),
        "leaf_3": leaf_material("LeafSunlit", (0.05, 0.15, 0.025, 1), (0.43, 0.62, 0.13, 1)),
    }


def curve_object(name, points, radii, material, collection, resolution=3, bevel_resolution=3):
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = 1.0
    curve.bevel_resolution = bevel_resolution
    curve.resolution_u = resolution
    curve.twist_smooth = 10
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for index, (coordinate, radius) in enumerate(zip(points, radii)):
        point = spline.bezier_points[index]
        point.co = coordinate
        point.radius = radius
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def convert_curve(obj, displacement=0.0):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if displacement > 0:
        for label, scale_multiplier, strength, depth in (
            ("Macro", 3.4, 0.58, 2),
            ("Meso", 1.35, 0.28, 1),
            ("Micro", 0.52, 0.14, 0),
        ):
            texture = bpy.data.textures.new(f"{obj.name}_FractalBark_{label}", type="CLOUDS")
            texture.noise_scale = max(0.025, displacement * scale_multiplier)
            texture.noise_depth = depth
            modifier = obj.modifiers.new(f"FractalBark_{label}", "DISPLACE")
            modifier.texture = texture
            modifier.texture_coords = "GLOBAL"
            modifier.strength = displacement * strength
            modifier.mid_level = 0.5
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


TRUNK_SPEC = (
    "TrunkCore",
    ((0, 0, 0.48), (0.18, 0.02, 2.7), (-0.28, 0.12, 4.45),
     (0.22, -0.18, 6.4), (-0.12, 0.18, 8.5), (0.42, 0.05, 10.3)),
    (2.25, 2.05, 1.8, 1.52, 1.18, 0.58),
)


# Four art-directed leaders preserve the concept silhouette. All later levels are generated
# recursively from these anchors, so the crown remains self-similar without losing its identity.
MAIN_BRANCHES = (
    ("MainFrontLeft", ((-0.05, -0.05, 5.2), (-1.2, -0.95, 6.8), (-2.8, -2.2, 8.6),
                       (-4.6, -3.55, 10.3), (-6.2, -4.7, 11.8)),
     (1.28, 1.02, 0.74, 0.48, 0.24)),
    ("MainFrontRight", ((0.08, -0.04, 5.8), (0.95, -0.75, 8.0), (2.05, -1.75, 10.7),
                        (3.5, -3.1, 13.2), (4.8, -4.3, 15.2)),
     (1.22, 0.98, 0.71, 0.45, 0.22)),
    ("MainRearLeft", ((-0.08, 0.1, 6.4), (-1.0, 1.1, 7.9), (-2.0, 2.3, 9.8),
                      (-3.1, 3.6, 11.7), (-4.2, 4.8, 13.4)),
     (1.14, 0.9, 0.65, 0.41, 0.2)),
    ("MainRearRight", ((0.1, 0.12, 6.9), (0.7, 0.85, 9.6), (1.6, 1.9, 12.5),
                       (2.7, 3.1, 15.0), (4.0, 4.6, 17.5)),
     (1.08, 0.86, 0.61, 0.38, 0.18)),
)


def sample_branch(points, radii, fraction):
    coordinates = [Vector(point) for point in points]
    lengths = [(coordinates[index + 1] - coordinates[index]).length
               for index in range(len(coordinates) - 1)]
    total = sum(lengths)
    target = max(0.0, min(1.0, fraction)) * total
    traversed = 0.0
    for index, length in enumerate(lengths):
        if traversed + length >= target or index == len(lengths) - 1:
            local = 0.0 if length == 0 else (target - traversed) / length
            position = coordinates[index].lerp(coordinates[index + 1], local)
            tangent = (coordinates[index + 1] - coordinates[index]).normalized()
            radius = radii[index] + (radii[index + 1] - radii[index]) * local
            return position, tangent, radius
        traversed += length
    raise RuntimeError("branch sampling failed")


def pipe_child_radius(parent_radius, child_count, scale=0.94):
    return parent_radius * scale / (child_count ** (1.0 / 2.2))


def cone_direction(axis, angle, azimuth):
    axis = Vector(axis).normalized()
    helper = Vector((0, 0, 1)) if abs(axis.z) < 0.92 else Vector((1, 0, 0))
    side = axis.cross(helper).normalized()
    other = side.cross(axis).normalized()
    return (axis * cos(angle) + (side * cos(azimuth) + other * sin(azimuth)) * sin(angle)).normalized()


def branch_path(start, direction, length, rng, *, gravity, phototropism):
    start = Vector(start)
    direction = Vector(direction).normalized()
    up = Vector((0, 0, 1))
    side = direction.cross(up)
    if side.length_squared < 0.001:
        side = Vector((1, 0, 0))
    side.normalize()
    other = direction.cross(side).normalized()
    bend = rng.uniform(-0.09, 0.09) * length
    twist = rng.uniform(-0.055, 0.055) * length
    points = []
    for fraction in (0.0, 0.24, 0.5, 0.76, 1.0):
        point = start + direction * length * fraction
        point += side * sin(pi * fraction) * bend
        point += other * sin(2 * pi * fraction) * twist
        point += up * (phototropism * length * fraction * fraction
                       - gravity * length * sin(pi * fraction))
        points.append(point)
    return tuple(points)


def radius_profile(start_radius, end_radius, count=5):
    return tuple(start_radius * ((1.0 - fraction) ** 1.28) + end_radius * fraction
                 for fraction in (0.0, 0.24, 0.5, 0.76, 1.0)[:count])


def curve_bundle(name, specs, material, collection, *, resolution, bevel_resolution):
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = 1.0
    curve.bevel_resolution = bevel_resolution
    curve.use_fill_caps = True
    for _branch_name, points, radii in specs:
        spline = curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for index, (coordinate, radius) in enumerate(zip(points, radii)):
            point = spline.bezier_points[index]
            point.co = coordinate
            point.radius = radius
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    return convert_curve(obj)


def outward_vector(position):
    result = Vector((position.x, position.y, 0))
    if result.length_squared < 0.001:
        return Vector((1, 0, 0))
    return result.normalized()


def build_fractal_wood(tree_collection, mats, rng):
    objects = []
    trunk = curve_object(*TRUNK_SPEC, mats["bark"], tree_collection,
                         resolution=4, bevel_resolution=5)
    objects.append(convert_curve(trunk, 0.16))

    main_specs = list(MAIN_BRANCHES)
    for name, points, radii in main_specs:
        curve = curve_object(name, points, radii, mats["bark"], tree_collection,
                             resolution=4, bevel_resolution=4)
        objects.append(convert_curve(curve, min(0.11, radii[0] * 0.07)))

    secondary_specs = []
    tertiary_specs = []
    fine_specs = []
    leaf_sites = []

    for main_index, (_main_name, main_points, main_radii) in enumerate(main_specs):
        sector = atan2(main_points[-1][1], main_points[-1][0])
        secondary_count = 4 + (main_index % 2)
        for secondary_index in range(secondary_count):
            fraction = 0.28 + 0.62 * (secondary_index + 1) / (secondary_count + 1)
            fraction += rng.uniform(-0.025, 0.025)
            start, tangent, parent_radius = sample_branch(main_points, main_radii, fraction)
            spread = -0.92 + 1.84 * secondary_index / max(1, secondary_count - 1)
            heading = sector + spread + rng.uniform(-0.16, 0.16)
            radial_direction = Vector((cos(heading), sin(heading), rng.uniform(0.32, 0.68))).normalized()
            direction = (tangent * 0.2 + radial_direction * 0.74 + Vector((0, 0, 0.18))).normalized()
            length = rng.uniform(5.2, 7.0)
            start_radius = pipe_child_radius(parent_radius, secondary_count) * rng.uniform(0.9, 1.08)
            points = branch_path(start, direction, length, rng, gravity=0.055, phototropism=0.1)
            radii = radius_profile(start_radius, max(0.045, start_radius * 0.14))
            secondary_name = f"Secondary_{main_index:02d}_{secondary_index:02d}"
            secondary_specs.append((secondary_name, points, radii))

            tertiary_count = 5 + rng.randrange(4)
            for tertiary_index in range(tertiary_count):
                tertiary_fraction = 0.18 + 0.74 * (tertiary_index + 1) / (tertiary_count + 1)
                tertiary_fraction += rng.uniform(-0.02, 0.02)
                t_start, t_tangent, t_parent_radius = sample_branch(points, radii, tertiary_fraction)
                angle = rng.uniform(0.5, 0.94)
                azimuth = 2 * pi * tertiary_index / tertiary_count + rng.uniform(-0.25, 0.25)
                t_direction = cone_direction(t_tangent, angle, azimuth)
                t_direction = (t_direction * 0.67 + outward_vector(t_start) * 0.2
                               + Vector((0, 0, 0.24))).normalized()
                t_length = rng.uniform(2.15, 3.45)
                t_start_radius = pipe_child_radius(t_parent_radius, tertiary_count) * rng.uniform(0.9, 1.1)
                t_points = branch_path(t_start, t_direction, t_length, rng,
                                       gravity=0.035, phototropism=0.075)
                t_radii = radius_profile(t_start_radius, max(0.014, t_start_radius * 0.12))
                tertiary_name = f"Tertiary_{main_index:02d}_{secondary_index:02d}_{tertiary_index:02d}"
                tertiary_specs.append((tertiary_name, t_points, t_radii))

                fine_count = 2 + rng.randrange(3)
                for fine_index in range(fine_count):
                    fine_fraction = 0.42 + 0.5 * (fine_index + 1) / (fine_count + 1)
                    fine_fraction += rng.uniform(-0.035, 0.035)
                    f_start, f_tangent, f_parent_radius = sample_branch(t_points, t_radii, fine_fraction)
                    f_direction = cone_direction(
                        f_tangent,
                        rng.uniform(0.34, 0.72),
                        2 * pi * fine_index / fine_count + rng.uniform(-0.3, 0.3),
                    )
                    f_direction = (f_direction * 0.8 + Vector((0, 0, 0.18))
                                   + outward_vector(f_start) * 0.08).normalized()
                    f_length = rng.uniform(0.9, 1.58)
                    f_start_radius = pipe_child_radius(f_parent_radius, fine_count) * rng.uniform(0.86, 1.05)
                    f_points = branch_path(f_start, f_direction, f_length, rng,
                                           gravity=0.018, phototropism=0.045)
                    f_radii = radius_profile(f_start_radius, 0.006)
                    fine_name = (f"Fine_{main_index:02d}_{secondary_index:02d}_"
                                 f"{tertiary_index:02d}_{fine_index:02d}")
                    fine_specs.append((fine_name, f_points, f_radii))
                    cluster_radius = rng.uniform(0.44, 0.64)
                    for point_index, scale in ((2, 0.72), (3, 0.88), (4, 1.0)):
                        leaf_sites.append((Vector(f_points[point_index]), f_direction,
                                           cluster_radius * scale))

    objects.append(curve_bundle("SecondaryBranches", secondary_specs, mats["bark"], tree_collection,
                                resolution=3, bevel_resolution=3))
    objects.append(curve_bundle("TertiaryBranches", tertiary_specs, mats["bark"], tree_collection,
                                resolution=2, bevel_resolution=2))
    objects.append(curve_bundle("FineBranches", fine_specs, mats["bark"], tree_collection,
                                resolution=1, bevel_resolution=1))
    counts = {
        "main": len(main_specs),
        "secondary": len(secondary_specs),
        "tertiary": len(tertiary_specs),
        "fine": len(fine_specs),
        "leaf_sites": len(leaf_sites),
        "main_lengths_m": tuple(round(sum(
            (Vector(points[index + 1]) - Vector(points[index])).length
            for index in range(len(points) - 1)
        ), 3) for _name, points, _radii in main_specs),
        "main_angles_deg": tuple(round(degrees(
            (Vector(points[-1]) - Vector(points[0])).angle(Vector((0, 0, 1)))
        ), 2) for _name, points, _radii in main_specs),
    }
    return objects, leaf_sites, counts


def build_base_flare(tree_collection, mats):
    """Bridge the vertical trunk and radial roots with the swollen base seen in the concept."""
    pieces = []
    for index, (location, scale, rotation) in enumerate((
        ((0, 0, 1.85), (2.15, 1.9, 1.8), (0.06, -0.08, 0.0)),
        ((-0.2, 0.18, 2.25), (1.75, 1.55, 1.45), (-0.08, 0.12, 0.16)),
    )):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=location, rotation=rotation)
        obj = bpy.context.object
        obj.name = f"TrunkFlare_{index:02d}"
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(mats["bark"])
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        link_to_collection(obj, tree_collection)
        pieces.append(obj)
    return pieces


def root_path(index, count, rng):
    angle = 2 * pi * index / count + rng.uniform(-0.12, 0.12)
    length = rng.uniform(4.6, 7.0)
    bend = rng.uniform(-0.28, 0.28)
    start_radius = rng.uniform(0.72, 1.15)
    fractions = (0.0, 0.18, 0.42, 0.7, 1.0)
    radii = [start_radius * ((1.0 - fraction) ** 1.35) + 0.035 for fraction in fractions]
    points = []
    for fraction, radius in zip(fractions, radii):
        theta = angle + bend * sin(fraction * pi)
        distance = 0.45 + length * fraction
        # The curve radius expands around each control point. Keeping the centre at least one
        # radius above z=0 makes the complete root rest on the ground instead of intersecting it.
        vertical = radius + 0.075 + 0.11 * sin(fraction * pi)
        points.append((cos(theta) * distance, sin(theta) * distance, vertical))
    return points, radii


def build_roots(tree_collection, mats, rng):
    objects = []
    root_specs = []
    count = 15
    for index in range(count):
        points, radii = root_path(index, count, rng)
        root_specs.append((points, radii))
        curve = curve_object(f"Root_{index:02d}", points, radii, mats["bark"], tree_collection,
                             resolution=4, bevel_resolution=4)
        objects.append(convert_curve(curve, min(0.12, radii[0] * 0.08)))
        if index % 3 == 1:
            fork_start = Vector(points[2])
            end = Vector(points[-1])
            direction = (end - fork_start).normalized()
            side = Vector((-direction.y, direction.x, 0)) * rng.choice((-1, 1))
            fork_points = (
                fork_start,
                fork_start + direction * 1.15 + side * 0.65 + Vector((0, 0, -0.08)),
                fork_start + direction * 2.25 + side * 1.15 + Vector((0, 0, -0.16)),
            )
            curve = curve_object(f"RootFork_{index:02d}", fork_points,
                                 (radii[2] * 0.56, 0.16, 0.035), mats["bark"], tree_collection,
                                 resolution=3, bevel_resolution=3)
            objects.append(convert_curve(curve, 0.035))
    return objects, root_specs


def build_root_ridges(tree_collection, mats, root_specs):
    ridges = []
    for index, (points, radii) in enumerate(root_specs):
        for strand in (-0.22, 0.22):
            ridge_points = []
            for point, radius in zip(points, radii):
                coordinate = Vector(point)
                radial = Vector((coordinate.x, coordinate.y, 0))
                if radial.length_squared:
                    radial.normalize()
                tangent = Vector((-radial.y, radial.x, 0))
                ridge_points.append(coordinate + Vector((0, 0, radius * 0.84))
                                    + tangent * radius * strand)
            ridge_radii = tuple(max(0.012, radius * 0.055) for radius in radii)
            curve = curve_object(f"RootRidge_{index:02d}_{strand:+.2f}", ridge_points, ridge_radii,
                                 mats["bark_light"], tree_collection,
                                 resolution=3, bevel_resolution=2)
            ridges.append(convert_curve(curve))
    return ridges


def add_leaf_quad(vertices, faces, center, axis_a, axis_b):
    base = len(vertices)
    vertices.extend((center - axis_a, center + axis_b, center + axis_a, center - axis_b))
    faces.append((base, base + 1, base + 2, base + 3))


def build_foliage(tree_collection, mats, rng, leaf_sites):
    vertices = []
    faces = []
    material_indices = []
    for cluster_index, (center, _branch_direction, radius) in enumerate(leaf_sites):
        leaves_per_cluster = 9 + rng.randrange(5)
        for leaf_index in range(leaves_per_cluster):
            direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
            if direction.length_squared == 0:
                direction = Vector((1, 0, 0))
            direction.normalize()
            distance = rng.random() ** 0.55
            cluster_scale = Vector((radius, radius * 0.97, radius * 0.88))
            position = center + Vector((direction.x * cluster_scale.x,
                                        direction.y * cluster_scale.y,
                                        direction.z * cluster_scale.z)) * distance
            rotation = Euler((rng.uniform(-pi, pi), rng.uniform(-pi, pi), rng.uniform(-pi, pi)))
            long_axis = rotation.to_matrix() @ Vector((rng.uniform(0.095, 0.17), 0, 0))
            short_axis = rotation.to_matrix() @ Vector((0, rng.uniform(0.045, 0.075), 0))
            add_leaf_quad(vertices, faces, position, long_axis, short_axis)
            material_indices.append((cluster_index + leaf_index) % 3)
            # A crossing blade prevents the canopy from disappearing at grazing angles.
            cross_rotation = rotation.to_matrix() @ Vector((0, 0, rng.uniform(0.045, 0.072)))
            add_leaf_quad(vertices, faces, position, long_axis, cross_rotation)
            material_indices.append((cluster_index + leaf_index + 1) % 3)

    mesh = bpy.data.meshes.new("AncientLeaves_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("AncientLeaves", mesh)
    tree_collection.objects.link(obj)
    obj.data.materials.append(mats["leaf_1"])
    obj.data.materials.append(mats["leaf_2"])
    obj.data.materials.append(mats["leaf_3"])
    for polygon, material_index in zip(obj.data.polygons, material_indices):
        polygon.material_index = material_index
    obj["role"] = "foliage"
    return obj


def join_objects(objects, name, collection):
    if not objects:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    link_to_collection(result, collection)
    return result


def build_knots(tree_collection, mats):
    knots = []
    specs = (
        ((-1.18, -1.1, 3.1), (0.28, 0.09, 0.48), (pi / 2, 0.2, -0.12)),
        ((1.15, -0.75, 5.1), (0.22, 0.08, 0.34), (pi / 2, -0.25, 0.18)),
        ((-0.7, -0.95, 7.0), (0.2, 0.07, 0.3), (pi / 2, 0.18, -0.25)),
    )
    for index, (location, scale, rotation) in enumerate(specs):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=location, rotation=rotation)
        obj = bpy.context.object
        obj.name = f"TrunkCavity_{index:02d}"
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(mats["bark_dark"])
        link_to_collection(obj, tree_collection)
        knots.append(obj)
    return join_objects(knots, "TrunkCavities", tree_collection)


def aim_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def build_presentation(scene, collection):
    target = bpy.data.objects.new("TreePresentationTarget", None)
    target.location = (0, 0, 9.25)
    collection.objects.link(target)

    cameras = []
    views = (
        ("front", (0, -36, 9.25)),
        ("three_quarter_left", (-25.46, -25.46, 9.25)),
        ("side", (-36, 0, 9.25)),
        ("three_quarter_rear", (-25.46, 25.46, 9.25)),
        ("rear", (0, 36, 9.25)),
        ("rear_right", (25.46, 25.46, 9.25)),
        ("opposite_side", (36, 0, 9.25)),
        ("three_quarter_right", (25.46, -25.46, 9.25)),
    )
    for label, location in views:
        camera_data = bpy.data.cameras.new(f"Camera_{label}")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 30.0
        camera = bpy.data.objects.new(f"Camera_{label}", camera_data)
        camera.location = location
        aim_at(camera, target.location)
        camera["view"] = label
        collection.objects.link(camera)
        cameras.append(camera)

    sun_data = bpy.data.lights.new("Sun_Key", "SUN")
    sun_data.energy = 2.3
    sun_data.angle = 0.2
    sun = bpy.data.objects.new("Sun_Key", sun_data)
    sun.rotation_euler = (0.55, -0.45, -0.65)
    collection.objects.link(sun)

    for name, location, energy, size, color in (
        ("Area_Key", (-9, -12, 18), 1750, 8.0, (1.0, 0.78, 0.48)),
        ("Area_Fill", (10, -4, 10), 1100, 7.0, (0.55, 0.72, 1.0)),
        ("Area_Rim", (0, 10, 16), 1450, 6.0, (0.74, 0.9, 0.56)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = location
        aim_at(light, target.location)
        collection.objects.link(light)
    scene.camera = cameras[0]
    return cameras


def world_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    lows = Vector((min(point.x for point in points), min(point.y for point in points),
                   min(point.z for point in points)))
    highs = Vector((max(point.x for point in points), max(point.y for point in points),
                    max(point.z for point in points)))
    return lows, highs


def validate_scene(scene, tree_collection, cameras, branch_counts):
    meshes = [obj for obj in tree_collection.objects if obj.type == "MESH"]
    if len(cameras) != 8:
        raise RuntimeError(f"expected eight presentation cameras, found {len(cameras)}")
    if branch_counts["main"] != 4:
        raise RuntimeError(f"expected four main branches, found {branch_counts['main']}")
    if not 16 <= branch_counts["secondary"] <= 20:
        raise RuntimeError(f"secondary branch count outside target: {branch_counts['secondary']}")
    if branch_counts["tertiary"] < 80 or branch_counts["fine"] < 200:
        raise RuntimeError(f"branch hierarchy is too sparse: {branch_counts}")
    if max(branch_counts["main_lengths_m"]) - min(branch_counts["main_lengths_m"]) < 1.5:
        raise RuntimeError(f"main branch lengths are too uniform: {branch_counts['main_lengths_m']}")
    if max(branch_counts["main_angles_deg"]) - min(branch_counts["main_angles_deg"]) < 12:
        raise RuntimeError(f"main branch angles are too uniform: {branch_counts['main_angles_deg']}")
    if not any(obj.name == "AncientLeaves" for obj in meshes):
        raise RuntimeError("foliage mesh is missing")
    lows, highs = world_bounds(meshes)
    dimensions = highs - lows
    if dimensions.z < 18 or dimensions.x < 18 or dimensions.y < 18:
        raise RuntimeError(f"tree bounds are too small: {tuple(round(value, 2) for value in dimensions)}")
    crown_roundness = min(dimensions.x, dimensions.y) / max(dimensions.x, dimensions.y)
    if crown_roundness < 0.86:
        raise RuntimeError(f"tree crown footprint is too narrow: ratio={crown_roundness:.3f}")
    if lows.z < -0.25 or lows.z > 0.25:
        for obj in meshes:
            object_low = min((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)
            print(f"ground diagnostic: {obj.name} z={object_low:.3f}")
        raise RuntimeError(f"tree must meet the ground plane, got z={lows.z:.3f}")
    face_count = sum(len(obj.data.polygons) for obj in meshes)
    if face_count < 16000:
        raise RuntimeError(f"tree detail budget is unexpectedly low: {face_count} faces")
    if face_count > 60000:
        raise RuntimeError(f"tree detail budget is too high for the runtime asset: {face_count} faces")
    scene["mesh_count"] = len(meshes)
    scene["face_count"] = face_count
    scene["bounds_m"] = tuple(round(value, 3) for value in dimensions)
    scene["branch_counts"] = branch_counts
    scene["crown_footprint_ratio"] = round(crown_roundness, 4)
    print(f"validated ancient tree: meshes={len(meshes)} faces={face_count} "
          f"bounds={tuple(dimensions)} branches={branch_counts}")


def render_previews(scene, cameras):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for camera in cameras:
        label = camera.get("view", camera.name)
        scene.camera = camera
        scene.render.filepath = str(PREVIEW_DIR / f"ancient_tree_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {Path(scene.render.filepath).relative_to(ROOT)}")


def crown_silhouette_width(image_path):
    image = bpy.data.images.load(str(image_path), check_existing=False)
    width, height = image.size
    pixels = image.pixels[:]
    crown_bottom = int(height * 0.42)
    crown_top = int(height * 0.94)
    occupied_x = []
    for y in range(crown_bottom, crown_top):
        row = y * width * 4
        for x in range(width):
            if pixels[row + x * 4 + 3] > 0.05:
                occupied_x.append(x)
    bpy.data.images.remove(image)
    if not occupied_x:
        raise RuntimeError(f"preview contains no visible crown: {image_path.name}")
    return (max(occupied_x) - min(occupied_x) + 1) / width


def validate_silhouettes(scene, cameras):
    widths = {
        camera.get("view", camera.name): crown_silhouette_width(
            PREVIEW_DIR / f"ancient_tree_{camera.get('view', camera.name)}.png"
        )
        for camera in cameras
    }
    if max(widths.values()) > 0.97:
        raise RuntimeError(f"crown touches the preview frame: {widths}")
    cardinal_widths = [widths[label] for label in ("front", "side", "rear", "opposite_side")]
    widest = max(cardinal_widths)
    narrowest = min(cardinal_widths)
    roundness = narrowest / widest
    if roundness < 0.84:
        raise RuntimeError(f"crown silhouette varies too much by view: ratio={roundness:.3f}, {widths}")
    for label in ("side", "rear", "opposite_side"):
        if widths[label] / widths["front"] < 0.86:
            raise RuntimeError(f"{label} crown is too narrow relative to front: {widths}")
    scene["silhouette_widths"] = {label: round(value, 4) for label, value in widths.items()}
    scene["silhouette_roundness"] = round(roundness, 4)
    print(f"validated crown silhouettes: roundness={roundness:.3f} widths={widths}")


def export(scene, tree_collection):
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    scene.camera = bpy.data.objects.get("Camera_front")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in tree_collection.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    print(f"generated {BLEND_PATH.relative_to(ROOT)} and {GLB_PATH.relative_to(ROOT)}")


def main():
    rng = random.Random(SEED)
    scene, tree_collection, presentation = reset_scene()
    mats = build_materials()
    wood, leaf_sites, branch_counts = build_fractal_wood(tree_collection, mats, rng)
    wood.extend(build_base_flare(tree_collection, mats))
    roots, root_specs = build_roots(tree_collection, mats, rng)
    roots.extend(build_root_ridges(tree_collection, mats, root_specs))
    join_objects(wood + roots, "AncientTreeWood", tree_collection)["role"] = "wood"
    build_foliage(tree_collection, mats, rng, leaf_sites)
    build_knots(tree_collection, mats)
    cameras = build_presentation(scene, presentation)
    validate_scene(scene, tree_collection, cameras, branch_counts)
    render_previews(scene, cameras)
    validate_silhouettes(scene, cameras)
    export(scene, tree_collection)
    scene.camera = bpy.data.objects.get("Camera_front")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)


if __name__ == "__main__":
    main()
