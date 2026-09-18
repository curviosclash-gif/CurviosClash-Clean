#!/usr/bin/env python3
"""Build the hand-authored ancient tree and its five presentation views.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python scripts/generate_ancient_tree_asset.py

The tree is based on the user-approved watercolour concept: a massive twisted oak with
exposed radial roots, a split trunk, an asymmetric crown, moss, and readable branch gaps.
The generator is deterministic so the editable Blender source, runtime GLB and preview
renders can be recreated together.
"""

from __future__ import annotations

from math import cos, pi, sin
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
    scene.render.resolution_x = 768
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
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.88
    shader.inputs["Specular IOR Level"].default_value = 0.22

    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (2.2, 2.2, 0.55)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "3D"
    noise.inputs["Scale"].default_value = 4.1
    noise.inputs["Detail"].default_value = 9.0
    noise.inputs["Roughness"].default_value = 0.82
    noise.inputs["Distortion"].default_value = 0.28

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = (0.022, 0.012, 0.006, 1)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (0.30, 0.205, 0.115, 1)
    mid = ramp.color_ramp.elements.new(0.52)
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
    bump.inputs["Strength"].default_value = 0.72
    bump.inputs["Distance"].default_value = 0.32

    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(mapping.outputs["Vector"], moss_noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(moss_noise.outputs["Fac"], moss_mask.inputs["Fac"])
    links.new(moss_mask.outputs["Color"], moss_mix.inputs["Fac"])
    links.new(ramp.outputs["Color"], moss_mix.inputs[1])
    links.new(moss_mix.outputs["Color"], shader.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
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
        "bark_dark": principled_material("BarkCrevice", (0.028, 0.012, 0.004, 1), 0.98),
        "bark_light": principled_material("BarkRaisedFiber", (0.31, 0.22, 0.13, 1), 0.92),
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
        texture = bpy.data.textures.new(f"{obj.name}_surface", type="CLOUDS")
        texture.noise_scale = max(0.12, displacement * 3.2)
        texture.noise_depth = 2
        modifier = obj.modifiers.new("OrganicSurface", "DISPLACE")
        modifier.texture = texture
        modifier.texture_coords = "GLOBAL"
        modifier.strength = displacement
        modifier.mid_level = 0.5
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


TRUNK_AND_BRANCHES = (
    ("TrunkCore", ((0, 0, 0.48), (0.18, 0.02, 2.7), (-0.28, 0.12, 4.45),
                   (0.22, -0.18, 6.4), (-0.12, 0.18, 8.5), (0.55, 0.05, 10.5),
                   (0.25, 0.22, 12.4)), (2.25, 2.05, 1.8, 1.52, 1.25, 0.92, 0.52)),
    ("LowerLeftLeader", ((-0.1, 0.05, 5.1), (-1.5, -0.1, 6.4), (-3.2, 0.12, 7.4),
                         (-5.1, -0.18, 8.0), (-6.7, 0.18, 9.0)), (1.22, 1.02, 0.73, 0.42, 0.14)),
    ("LowerRightLeader", ((0.05, -0.05, 5.8), (1.55, 0.3, 6.8), (3.1, 0.2, 7.8),
                          (4.9, 0.55, 8.9), (6.5, 0.2, 10.0)), (1.18, 0.94, 0.68, 0.39, 0.13)),
    ("UpperLeftLeader", ((0.1, 0.0, 7.3), (-1.1, -0.55, 9.1), (-2.0, -0.65, 11.2),
                         (-3.2, -0.35, 13.2), (-3.9, 0.15, 14.8)), (1.05, 0.82, 0.59, 0.34, 0.12)),
    ("UpperCrownLeader", ((0.12, 0.1, 8.2), (-0.45, 0.55, 10.2), (-0.65, 0.9, 12.5),
                          (-0.25, 1.0, 14.7), (-0.7, 0.75, 16.4)), (1.08, 0.78, 0.52, 0.3, 0.1)),
    ("UpperRightLeader", ((0.25, 0.02, 7.8), (1.45, -0.45, 9.5), (2.4, -0.75, 11.5),
                          (3.1, -0.35, 13.4), (4.1, 0.05, 14.4)), (1.0, 0.75, 0.52, 0.3, 0.11)),
    ("RearLeader", ((0.0, 0.3, 6.7), (0.8, 1.3, 8.5), (1.4, 2.1, 10.7),
                    (2.0, 2.45, 12.6), (2.6, 2.35, 13.8)), (0.94, 0.71, 0.48, 0.27, 0.1)),
)


SECONDARY_BRANCHES = (
    ("LeftLowForkA", ((-2.5, 0.05, 7.1), (-3.7, -0.8, 8.4), (-4.7, -1.35, 9.8), (-5.5, -1.6, 10.7)), (0.55, 0.4, 0.23, 0.08)),
    ("LeftLowForkB", ((-4.7, -0.1, 7.9), (-5.4, 0.8, 9.1), (-5.8, 1.35, 10.4)), (0.35, 0.24, 0.08)),
    ("LeftCrownForkA", ((-2.2, -0.6, 11.6), (-3.5, -1.5, 12.7), (-4.7, -2.0, 13.7)), (0.38, 0.22, 0.07)),
    ("LeftCrownForkB", ((-3.1, -0.35, 13.1), (-4.3, 0.45, 14.0), (-5.0, 0.75, 14.7)), (0.32, 0.2, 0.07)),
    ("TopForkLeft", ((-0.5, 0.9, 12.5), (-1.9, 1.2, 14.0), (-2.5, 1.4, 15.5)), (0.4, 0.23, 0.07)),
    ("TopForkRight", ((-0.25, 1.0, 14.6), (0.8, 1.3, 15.5), (1.4, 1.0, 16.2)), (0.25, 0.15, 0.06)),
    ("RightLowForkA", ((2.8, 0.2, 7.6), (3.8, -0.8, 8.7), (4.5, -1.4, 10.0)), (0.5, 0.3, 0.08)),
    ("RightLowForkB", ((4.6, 0.5, 8.8), (5.7, 1.2, 10.1), (6.1, 1.55, 11.3)), (0.31, 0.2, 0.07)),
    ("RightCrownForkA", ((2.3, -0.7, 11.4), (3.7, -1.4, 12.2), (5.0, -1.6, 12.8)), (0.38, 0.21, 0.07)),
    ("RightCrownForkB", ((3.0, -0.35, 13.3), (4.4, 0.6, 13.7), (5.3, 1.0, 14.2)), (0.29, 0.18, 0.06)),
    ("RearForkA", ((1.2, 1.9, 10.5), (0.1, 2.7, 11.8), (-0.7, 2.9, 12.8)), (0.37, 0.22, 0.07)),
    ("RearForkB", ((1.9, 2.4, 12.4), (3.0, 2.8, 13.2), (3.8, 2.6, 13.8)), (0.28, 0.17, 0.06)),
    ("FrontFork", ((0.1, -0.1, 8.7), (-0.2, -1.7, 10.0), (0.5, -2.5, 11.4), (1.1, -2.6, 12.6)), (0.56, 0.37, 0.2, 0.07)),
)


CROWN_CLUSTERS = (
    (-6.5, -0.2, 9.4, 1.45, 0.95, 1.0), (-5.6, -1.3, 10.7, 1.35, 0.9, 1.0),
    (-5.5, 1.1, 11.0, 1.4, 0.95, 1.05), (-4.7, -2.0, 13.5, 1.45, 0.9, 1.1),
    (-4.8, 0.7, 14.6, 1.4, 0.95, 1.0), (-3.4, -1.0, 14.6, 1.5, 1.0, 1.15),
    (-2.5, 1.3, 15.5, 1.5, 1.05, 1.1), (-1.0, 0.8, 16.3, 1.5, 1.0, 1.0),
    (0.7, 0.9, 16.0, 1.45, 1.05, 1.1), (2.1, -0.2, 15.1, 1.5, 1.0, 1.1),
    (3.7, -0.2, 14.3, 1.5, 0.95, 1.0), (5.0, 0.8, 13.8, 1.4, 0.9, 1.0),
    (5.2, -1.4, 12.8, 1.4, 0.9, 1.0), (6.2, 1.2, 11.2, 1.45, 1.0, 1.05),
    (6.6, 0.0, 10.0, 1.35, 0.95, 1.0), (5.2, 1.8, 10.0, 1.35, 0.95, 1.0),
    (3.8, 1.8, 11.6, 1.4, 1.0, 1.05), (2.7, 2.5, 13.4, 1.45, 1.05, 1.0),
    (1.0, 2.8, 13.3, 1.45, 1.1, 1.0), (-0.8, 2.7, 12.8, 1.35, 1.0, 1.0),
    (-2.5, 2.0, 13.2, 1.45, 1.0, 1.0), (-4.2, 1.7, 12.2, 1.4, 1.0, 1.05),
    (-3.8, -2.0, 11.3, 1.35, 0.9, 1.0), (-2.2, -2.5, 12.1, 1.4, 0.95, 1.0),
    (-0.2, -2.6, 11.4, 1.4, 1.0, 1.05), (1.4, -2.6, 12.6, 1.4, 1.0, 1.05),
    (3.2, -2.2, 11.7, 1.45, 0.95, 1.0), (4.3, -1.6, 10.3, 1.35, 0.9, 1.0),
)


def build_wood(tree_collection, mats):
    objects = []
    skeleton_points = []
    for name, points, radii in TRUNK_AND_BRANCHES + SECONDARY_BRANCHES:
        skeleton_points.extend(Vector(point) for point in points)
        curve = curve_object(name, points, radii, mats["bark"], tree_collection, resolution=4, bevel_resolution=4)
        displacement = min(0.16, max(radii) * 0.075)
        objects.append(convert_curve(curve, displacement))
    return objects, skeleton_points


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


def nearest_point(point, candidates):
    target = Vector(point)
    return min(candidates, key=lambda candidate: (candidate - target).length)


def build_crown_twigs(tree_collection, mats, skeleton_points):
    twigs = []
    for index, cluster in enumerate(CROWN_CLUSTERS):
        center = Vector(cluster[:3])
        start = nearest_point(center, skeleton_points)
        delta = center - start
        if delta.length < 0.8:
            continue
        middle = start.lerp(center, 0.55)
        middle += Vector((0.12 * sin(index * 1.7), 0.12 * cos(index * 1.3), 0.18))
        curve = curve_object(f"CrownTwig_{index:02d}", (start, middle, center),
                             (0.12, 0.065, 0.018), mats["bark"], tree_collection,
                             resolution=2, bevel_resolution=2)
        twigs.append(convert_curve(curve, 0.018))
    return twigs


def add_leaf_quad(vertices, faces, center, axis_a, axis_b):
    base = len(vertices)
    vertices.extend((center - axis_a, center + axis_b, center + axis_a, center - axis_b))
    faces.append((base, base + 1, base + 2, base + 3))


def build_foliage(tree_collection, mats, rng):
    vertices = []
    faces = []
    material_indices = []
    for cluster_index, cluster in enumerate(CROWN_CLUSTERS):
        center = Vector(cluster[:3])
        radii = Vector(cluster[3:])
        leaves_per_cluster = 142
        for leaf_index in range(leaves_per_cluster):
            direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
            if direction.length_squared == 0:
                direction = Vector((1, 0, 0))
            direction.normalize()
            radius = rng.random() ** 0.58
            position = center + Vector((direction.x * radii.x, direction.y * radii.y,
                                        direction.z * radii.z)) * radius
            rotation = Euler((rng.uniform(-pi, pi), rng.uniform(-pi, pi), rng.uniform(-pi, pi)))
            long_axis = rotation.to_matrix() @ Vector((rng.uniform(0.15, 0.245), 0, 0))
            short_axis = rotation.to_matrix() @ Vector((0, rng.uniform(0.068, 0.11), 0))
            add_leaf_quad(vertices, faces, position, long_axis, short_axis)
            material_indices.append((cluster_index + leaf_index) % 3)
            # A crossing blade prevents the canopy from disappearing at grazing angles.
            cross_rotation = rotation.to_matrix() @ Vector((0, 0, rng.uniform(0.065, 0.105)))
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
    target.location = (0, 0, 8.2)
    collection.objects.link(target)

    cameras = []
    views = (
        ("front", (0, -32, 8.2)),
        ("three_quarter_left", (-22.6, -22.6, 8.2)),
        ("side", (-32, 0, 8.2)),
        ("three_quarter_rear", (-22.6, 22.6, 8.2)),
        ("rear", (0, 32, 8.2)),
    )
    for label, location in views:
        camera_data = bpy.data.cameras.new(f"Camera_{label}")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 20.7
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


def validate_scene(scene, tree_collection, cameras):
    meshes = [obj for obj in tree_collection.objects if obj.type == "MESH"]
    if len(cameras) != 5:
        raise RuntimeError(f"expected five presentation cameras, found {len(cameras)}")
    if not any(obj.name == "AncientLeaves" for obj in meshes):
        raise RuntimeError("foliage mesh is missing")
    lows, highs = world_bounds(meshes)
    dimensions = highs - lows
    if dimensions.z < 16 or dimensions.x < 12 or dimensions.y < 7:
        raise RuntimeError(f"tree bounds are too small: {tuple(round(value, 2) for value in dimensions)}")
    if lows.z < -0.25 or lows.z > 0.25:
        for obj in meshes:
            object_low = min((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)
            print(f"ground diagnostic: {obj.name} z={object_low:.3f}")
        raise RuntimeError(f"tree must meet the ground plane, got z={lows.z:.3f}")
    face_count = sum(len(obj.data.polygons) for obj in meshes)
    if face_count < 8000:
        raise RuntimeError(f"tree detail budget is unexpectedly low: {face_count} faces")
    scene["mesh_count"] = len(meshes)
    scene["face_count"] = face_count
    scene["bounds_m"] = tuple(round(value, 3) for value in dimensions)
    print(f"validated ancient tree: meshes={len(meshes)} faces={face_count} bounds={tuple(dimensions)}")


def render_previews(scene, cameras):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for camera in cameras:
        label = camera.get("view", camera.name)
        scene.camera = camera
        scene.render.filepath = str(PREVIEW_DIR / f"ancient_tree_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {Path(scene.render.filepath).relative_to(ROOT)}")


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
    wood, skeleton_points = build_wood(tree_collection, mats)
    wood.extend(build_base_flare(tree_collection, mats))
    roots, root_specs = build_roots(tree_collection, mats, rng)
    roots.extend(build_root_ridges(tree_collection, mats, root_specs))
    twigs = build_crown_twigs(tree_collection, mats, skeleton_points)
    join_objects(wood + roots + twigs, "AncientTreeWood", tree_collection)["role"] = "wood"
    build_foliage(tree_collection, mats, rng)
    build_knots(tree_collection, mats)
    cameras = build_presentation(scene, presentation)
    validate_scene(scene, tree_collection, cameras)
    export(scene, tree_collection)
    render_previews(scene, cameras)
    scene.camera = bpy.data.objects.get("Camera_front")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)


if __name__ == "__main__":
    main()
