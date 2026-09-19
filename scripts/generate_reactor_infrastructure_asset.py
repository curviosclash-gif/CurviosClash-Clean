#!/usr/bin/env python3
"""Deterministic Blender generator for the Reactor Site infrastructure prop library.

The module implements the blender-object-batches ``build_variant`` interface. Version-2
contracts, manifests, reports and contact sheets intentionally live outside the product
repository; only this reproducible generator and the approved Blender/GLB deliverables belong
to the game.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


GENERATOR_ID = "reactor-site-infrastructure-generator"
GENERATOR_VERSION = "1.0.2"


PALETTE = {
    "Concrete": ((0.33, 0.36, 0.35, 1), 0.0, 0.92, None, 0.0),
    "ConcreteDark": ((0.18, 0.20, 0.20, 1), 0.0, 0.94, None, 0.0),
    "PaintGreen": ((0.12, 0.25, 0.19, 1), 0.18, 0.70, None, 0.0),
    "PaintBlue": ((0.07, 0.20, 0.31, 1), 0.16, 0.72, None, 0.0),
    "PaintCream": ((0.56, 0.57, 0.48, 1), 0.10, 0.78, None, 0.0),
    "PaintRed": ((0.43, 0.055, 0.035, 1), 0.12, 0.80, None, 0.0),
    "Galvanized": ((0.49, 0.54, 0.54, 1), 0.72, 0.48, None, 0.0),
    "SteelDark": ((0.10, 0.12, 0.12, 1), 0.78, 0.58, None, 0.0),
    "Rubber": ((0.025, 0.032, 0.033, 1), 0.0, 0.93, None, 0.0),
    "CableRed": ((0.32, 0.035, 0.025, 1), 0.0, 0.80, None, 0.0),
    "CableBlue": ((0.025, 0.11, 0.28, 1), 0.0, 0.82, None, 0.0),
    "Warning": ((0.82, 0.51, 0.035, 1), 0.08, 0.74, None, 0.0),
    "Rust": ((0.31, 0.085, 0.025, 1), 0.08, 0.96, None, 0.0),
    "Glass": ((0.56, 0.72, 0.67, 1), 0.0, 0.32, None, 0.0),
    "EmissionWarm": ((0.84, 0.72, 0.38, 1), 0.0, 0.30, (1.0, 0.64, 0.20, 1), 3.5),
    "EmissionGreen": ((0.12, 0.56, 0.20, 1), 0.0, 0.36, (0.08, 1.0, 0.18, 1), 2.2),
    "EmissionRed": ((0.68, 0.04, 0.025, 1), 0.0, 0.40, (1.0, 0.03, 0.015, 1), 2.0),
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("ReactorInfrastructureWorld")
    scene.world.color = (0.035, 0.045, 0.045)


def material(name: str) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    base, metallic, roughness, emission, strength = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = base
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = base
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if emission:
        emission_input = node.inputs.get("Emission Color") or node.inputs.get("Emission")
        strength_input = node.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = emission
        if strength_input:
            strength_input.default_value = strength
    return mat


def finish(obj: bpy.types.Object, mat_name: str, bevel: float = 0.0) -> bpy.types.Object:
    obj.data.materials.append(material(mat_name))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("softened_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["asset_role"] = "render"
    obj["collision"] = "none"
    return obj


def box(name: str, location, size, mat_name: str, rotation=(0, 0, 0), bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(max(0.002, value) * 0.5 for value in size)
    return finish(obj, mat_name, min(bevel, min(size) * 0.18))


def cylinder(name: str, location, radius: float, depth: float, mat_name: str,
             vertices=12, rotation=(0, 0, 0), bevel=0.015):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name, min(bevel, radius * 0.16))


def sphere(name: str, location, radius: float, mat_name: str, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=location,
    )
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name)


def beam(name: str, start, end, radius: float, mat_name: str, vertices=10):
    a, b = Vector(start), Vector(end)
    delta = b - a
    if delta.length < 0.001:
        raise ValueError(f"beam {name} has no length")
    # Orient the primitive before applying transforms. Rotating a cylinder after its location has
    # already been baked into mesh data rotates that baked translation around the world origin.
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=delta.length, location=(a + b) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    obj = finish(obj, mat_name, radius * 0.10)
    obj.rotation_mode = "XYZ"
    return obj


def pipe_path(name: str, points, radius: float, mat_name="Galvanized", collars=True):
    for index, (start, end) in enumerate(zip(points, points[1:])):
        beam(f"{name}_section_{index:02d}", start, end, radius, mat_name, 12)
        if collars and index < len(points) - 2:
            sphere(f"{name}_elbow_{index:02d}", end, radius * 1.12, mat_name, 12, 6)


def cable_path(name: str, points, radius: float, mat_name="Rubber"):
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    curve.resolution_u = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return finish(bpy.context.object, mat_name, 0)


def base_plate(name: str, x: float, y: float, z: float, size=0.42, mat_name="Galvanized"):
    box(name, (x, y, z), (size, size, 0.10), mat_name, bevel=0.018)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder(f"{name}_bolt_{sx}_{sy}", (x + sx * size * 0.32, y + sy * size * 0.32, z + 0.08),
                     0.035, 0.10, "SteelDark", 8)


def rust_patch(name: str, location, size=(0.20, 0.05, 0.08), rotation=(0, 0, 0)):
    box(name, location, size, "Rust", rotation=rotation, bevel=0.008)


def add_warning_band(prefix: str, center, width: float, depth: float, z: float):
    count = 5
    stripe = width / count
    for index in range(count):
        box(f"{prefix}_stripe_{index}",
            (center[0] - width * 0.5 + stripe * (index + 0.5), center[1], z),
            (stripe * 0.82, depth, 0.18), "Warning" if index % 2 == 0 else "SteelDark", bevel=0.01)


def support_frame(prefix: str, width: float, height: float, y=0.0, crossbar=True, concrete=False,
                  lean=0.0):
    post_mat = "Concrete" if concrete else "Galvanized"
    for side in (-1, 1):
        x = side * width * 0.5
        base_plate(f"{prefix}_base_{side}", x, y, 0.05, 0.48, "SteelDark")
        beam(f"{prefix}_post_{side}", (x, y, 0.10), (x + side * lean, y, height),
             0.095 if not concrete else 0.16, post_mat, 8)
    if crossbar:
        beam(f"{prefix}_crossbar", (-width * 0.55, y, height), (width * 0.55, y, height),
             0.12, post_mat, 8)


def add_clamp(name: str, location, pipe_radius: float, mat_name="SteelDark"):
    cylinder(name, location, pipe_radius * 1.28, pipe_radius * 0.34, mat_name, 12,
             rotation=(math.pi / 2, 0, 0), bevel=0.01)


def build_pipe_support(p, rng):
    style = p["archetype"]
    width, height = p["width"], p["height"]
    radius = p["pipe_diameter"] * 0.5
    wear = p["wear"]
    pipe_mat = "PaintGreen" if p["painted_pipe"] else "Galvanized"

    if style == "portal_straight":
        support_frame("portal", width, height * 0.72)
        for index, x in enumerate((-width * 0.28, 0, width * 0.28)):
            z = height * 0.82 + index * 0.08
            pipe_path(f"process_{index}", [(x, -2.1, z), (x, 2.1, z)], radius * (1.0 - index * 0.12), pipe_mat)
            add_clamp(f"process_{index}_clamp", (x, 0, z), radius)
    elif style == "stacked_offset":
        support_frame("stacked", width, height * 0.58)
        support_frame("stacked_upper", width * 0.86, height * 0.90, crossbar=True)
        routes = [
            [(-width * 0.24, -2.0, height * 0.67), (-width * 0.24, 0.2, height * 0.67),
             (width * 0.05, 0.6, height * 0.83), (width * 0.05, 2.0, height * 0.83)],
            [(width * 0.25, -2.0, height * 0.98), (width * 0.25, 2.0, height * 0.98)],
        ]
        for index, route in enumerate(routes):
            pipe_path(f"offset_{index}", route, radius * (1.0 if index == 0 else 0.78), pipe_mat)
    elif style == "cantilever":
        base_plate("cantilever_base", -width * 0.34, 0, 0.05, 0.62, "ConcreteDark")
        beam("cantilever_post", (-width * 0.34, 0, 0.1), (-width * 0.34, 0, height * 0.82), 0.15, "Galvanized", 8)
        beam("cantilever_arm", (-width * 0.38, 0, height * 0.78), (width * 0.48, 0, height * 0.78), 0.14, "Galvanized", 8)
        beam("cantilever_brace", (-width * 0.30, 0, height * 0.42), (width * 0.26, 0, height * 0.75), 0.075, "SteelDark", 8)
        for index, x in enumerate((-width * 0.05, width * 0.30)):
            pipe_path(f"cantilever_pipe_{index}", [(x, -2.0, height * (0.88 + index * 0.10)),
                                                   (x, 2.0, height * (0.88 + index * 0.10))],
                      radius * (1.0 - index * 0.15), pipe_mat)
    elif style == "low_trestle":
        for side in (-1, 1):
            beam(f"trestle_leg_a_{side}", (side * width * 0.45, -0.32, 0.05),
                 (side * width * 0.26, 0, height * 0.48), 0.11, "Galvanized", 8)
            beam(f"trestle_leg_b_{side}", (side * width * 0.45, 0.32, 0.05),
                 (side * width * 0.26, 0, height * 0.48), 0.11, "Galvanized", 8)
        beam("trestle_rail", (-width * 0.5, 0, height * 0.48), (width * 0.5, 0, height * 0.48), 0.11, "Galvanized", 8)
        for index, x in enumerate((-0.36, -0.12, 0.12, 0.36)):
            pipe_path(f"trestle_pipe_{index}", [(x * width, -2.0, height * 0.61),
                                                (x * width, 2.0, height * 0.61)], radius * 0.68, pipe_mat)
    elif style == "service_bridge":
        support_frame("bridge_front", width, height * 0.76, y=-0.55)
        support_frame("bridge_back", width, height * 0.76, y=0.55)
        box("bridge_walkway", (0, 0, height * 0.90), (width * 0.88, 1.3, 0.16), "Galvanized")
        for side in (-1, 1):
            beam(f"bridge_rail_{side}", (side * width * 0.43, -0.58, height * 0.92),
                 (side * width * 0.43, 0.58, height * 0.92), 0.045, "SteelDark", 8)
        for index, x in enumerate((-width * 0.22, width * 0.22)):
            pipe_path(f"bridge_pipe_{index}", [(x, -2.2, height * (0.53 + index * 0.10)),
                                               (x, 2.2, height * (0.53 + index * 0.10))], radius, pipe_mat)
    elif style == "wall_rack":
        box("wall_mount", (0, 0.24, height * 0.48), (width, 0.28, height * 0.96), "ConcreteDark", bevel=0.05)
        for level, z in enumerate((height * 0.28, height * 0.52, height * 0.76)):
            beam(f"wall_bracket_{level}", (-width * 0.45, -0.05, z), (width * 0.45, -0.05, z), 0.07, "Galvanized", 8)
            route = [(-width * 0.48, -0.20, z + 0.13), (width * 0.48, -0.20, z + 0.13)]
            pipe_path(f"wall_pipe_{level}", route, radius * (0.72 + level * 0.12), pipe_mat)
    elif style == "a_frame":
        for side in (-1, 1):
            beam(f"a_leg_left_{side}", (-width * 0.48, side * 0.34, 0.05), (0, 0, height * 0.78), 0.12, "Galvanized", 8)
            beam(f"a_leg_right_{side}", (width * 0.48, side * 0.34, 0.05), (0, 0, height * 0.78), 0.12, "Galvanized", 8)
        pipe_path("a_main", [(0, -2.15, height * 0.90), (0, 2.15, height * 0.90)], radius * 1.35, pipe_mat)
        for side in (-1, 1):
            pipe_path(f"a_small_{side}", [(side * width * 0.24, -2.0, height * 0.48),
                                          (side * width * 0.24, 2.0, height * 0.48)], radius * 0.62, "Galvanized")
    elif style == "crossover":
        support_frame("cross", width, height * 0.64)
        pipe_path("cross_low", [(-width * 0.32, -2.2, height * 0.74),
                                (-width * 0.32, -0.25, height * 0.74),
                                (width * 0.28, 0.35, height * 0.95),
                                (width * 0.28, 2.2, height * 0.95)], radius, pipe_mat)
        pipe_path("cross_high", [(width * 0.34, -2.2, height * 1.03),
                                 (width * 0.34, -0.35, height * 1.03),
                                 (-width * 0.20, 0.28, height * 0.83),
                                 (-width * 0.20, 2.2, height * 0.83)], radius * 0.78, "PaintBlue")
    elif style == "retrofit_bypass":
        support_frame("retrofit", width, height * 0.72)
        pipe_path("retrofit_main", [(-width * 0.20, -2.2, height * 0.82),
                                     (-width * 0.20, 2.2, height * 0.82)], radius * 1.15, "PaintGreen")
        pipe_path("retrofit_bypass", [(width * 0.22, -2.2, height * 0.82),
                                       (width * 0.22, -0.65, height * 0.82),
                                       (width * 0.38, -0.20, height * 1.10),
                                       (width * 0.38, 0.75, height * 1.10),
                                       (width * 0.22, 1.15, height * 0.82),
                                       (width * 0.22, 2.2, height * 0.82)], radius * 0.70, "PaintBlue")
        for y in (-0.65, 1.15):
            add_clamp(f"retrofit_new_clamp_{y}", (width * 0.22, y, height * 0.82), radius * 0.72, "Warning")
    elif style == "bent_repair":
        support_frame("damaged", width, height * 0.72, lean=width * 0.06)
        beam("damaged_brace", (-width * 0.42, 0, height * 0.30),
             (width * 0.40, 0, height * 0.68), 0.07, "Rust", 8)
        pipe_path("damaged_main", [(-width * 0.24, -2.2, height * 0.84),
                                    (-width * 0.24, -0.25, height * 0.84),
                                    (-width * 0.10, 0.30, height * 0.78),
                                    (-width * 0.10, 2.2, height * 0.78)], radius, pipe_mat)
        pipe_path("damaged_patch", [(width * 0.22, -2.0, height * 0.88),
                                     (width * 0.22, 2.0, height * 0.88)], radius * 0.72, "PaintBlue")
        add_clamp("damaged_patch_clamp", (width * 0.22, 0, height * 0.88), radius * 0.90, "Warning")
    else:
        raise ValueError(f"unsupported pipe support archetype: {style}")

    if wear > 0.35:
        for index in range(max(1, round(wear * 4))):
            rust_patch(f"pipe_rust_{index}",
                       (rng.uniform(-width * 0.42, width * 0.42), rng.uniform(-0.08, 0.08),
                        rng.uniform(0.12, max(0.18, height * 0.65))),
                       (rng.uniform(0.10, 0.26), 0.045, rng.uniform(0.06, 0.16)))


def tray_segment(prefix: str, start, end, width: float, rung_count: int, mat_name="Galvanized"):
    a, b = Vector(start), Vector(end)
    direction = (b - a).normalized()
    side = direction.cross(Vector((0, 0, 1)))
    if side.length < 0.1:
        side = Vector((1, 0, 0))
    side.normalize()
    for sign in (-1, 1):
        beam(f"{prefix}_rail_{sign}", a + side * width * 0.5, b + side * width * 0.5, 0.045, mat_name, 8)
    for index in range(rung_count + 1):
        at = a.lerp(b, index / max(1, rung_count))
        beam(f"{prefix}_rung_{index:02d}", at - side * width * 0.48, at + side * width * 0.48,
             0.025, mat_name, 6)


def tray_path(prefix: str, points, width: float, mat_name="Galvanized"):
    for index, (start, end) in enumerate(zip(points, points[1:])):
        length = (Vector(end) - Vector(start)).length
        tray_segment(f"{prefix}_{index}", start, end, width, max(2, round(length / 0.55)), mat_name)


def cable_bundle(prefix: str, paths, radius=0.035):
    colors = ("Rubber", "CableRed", "CableBlue", "Rubber")
    for index, points in enumerate(paths):
        cable_path(f"{prefix}_{index:02d}", points, radius * (1.0 + 0.08 * (index % 2)), colors[index % len(colors)])


def build_cable_tray(p, rng):
    style = p["archetype"]
    length, height, width = p["length"], p["height"], p["tray_width"]
    wear = p["wear"]
    z = max(0.35, height * 0.68)

    if style == "wall_straight":
        box("wall_backing", (0, 0.20, height * 0.50), (length, 0.24, height), "ConcreteDark")
        tray_path("wall_tray", [(-length * 0.48, -0.02, z), (length * 0.48, -0.02, z)], width)
        cable_bundle("wall_cable", [[(-length * 0.46, -0.08 + i * 0.04, z + 0.04),
                                     (length * 0.46, -0.08 + i * 0.04, z + 0.04)] for i in range(4)])
    elif style == "stacked_pair":
        for x in (-length * 0.42, length * 0.42):
            beam(f"stack_post_{x}", (x, 0, 0.05), (x, 0, height), 0.075, "Galvanized", 8)
        for level, level_z in enumerate((height * 0.42, height * 0.78)):
            tray_path(f"stack_tray_{level}", [(-length * 0.46, 0, level_z), (length * 0.46, 0, level_z)], width)
            cable_bundle(f"stack_cable_{level}", [[(-length * 0.44, -0.10 + i * 0.07, level_z + 0.05),
                                                   (length * 0.44, -0.10 + i * 0.07, level_z + 0.05)] for i in range(3)])
    elif style == "vertical_riser":
        box("riser_backing", (0, 0.18, height * 0.50), (width * 1.8, 0.25, height), "ConcreteDark")
        tray_path("riser", [(0, -0.02, 0.10), (0, -0.02, height * 0.94)], width)
        cable_bundle("riser_cables", [[(-width * 0.25 + i * width * 0.16, -0.08, 0.12),
                                       (-width * 0.25 + i * width * 0.16, -0.08, height * 0.92)] for i in range(4)])
    elif style == "ninety_elbow":
        tray_path("elbow", [(-length * 0.50, 0, z), (0, 0, z), (0, length * 0.50, z)], width)
        paths = []
        for i in range(4):
            offset = -width * 0.28 + i * width * 0.18
            paths.append([(-length * 0.48, offset, z + 0.05), (offset, offset, z + 0.05),
                          (offset, length * 0.48, z + 0.05)])
        cable_bundle("elbow_cables", paths)
        for x, y in ((-length * 0.38, 0), (0, length * 0.38)):
            beam(f"elbow_support_{x}_{y}", (x, y, 0.05), (x, y, z - 0.08), 0.07, "Galvanized", 8)
    elif style == "tee_branch":
        tray_path("tee_main", [(-length * 0.50, 0, z), (length * 0.50, 0, z)], width)
        tray_path("tee_branch", [(0, 0, z), (0, length * 0.44, z)], width * 0.82)
        paths = [[(-length * 0.48, -0.10 + i * 0.07, z + 0.05),
                  (-0.04 + i * 0.03, -0.02, z + 0.05),
                  (-0.04 + i * 0.03, length * 0.42, z + 0.05)] for i in range(4)]
        cable_bundle("tee_cables", paths)
    elif style == "floor_bridge":
        for x in (-length * 0.43, length * 0.43):
            for y in (-width * 0.75, width * 0.75):
                base_plate(f"bridge_foot_{x}_{y}", x, y, 0.04, 0.26, "ConcreteDark")
                beam(f"bridge_post_{x}_{y}", (x, y, 0.08), (x, y, z), 0.055, "Galvanized", 8)
        tray_path("bridge_tray", [(-length * 0.48, 0, z), (length * 0.48, 0, z)], width)
        box("bridge_cover", (0, 0, z + 0.13), (length * 0.88, width * 1.05, 0.10), "PaintCream")
        cable_bundle("bridge_cables", [[(-length * 0.45, -width * 0.28 + i * width * 0.18, z + 0.04),
                                        (length * 0.45, -width * 0.28 + i * width * 0.18, z + 0.04)] for i in range(4)])
    elif style == "sagging_bundle":
        for x in (-length * 0.48, length * 0.48):
            beam(f"sag_post_{x}", (x, 0, 0.05), (x, 0, height), 0.08, "Galvanized", 8)
        beam("sag_top", (-length * 0.52, 0, height), (length * 0.52, 0, height), 0.08, "Galvanized", 8)
        paths = []
        for i in range(6):
            y = -width * 0.30 + i * width * 0.12
            sag = height * (0.58 - 0.03 * (i % 2))
            paths.append([(-length * 0.48, y, height * 0.90), (-length * 0.22, y, sag),
                          (length * 0.22, y, sag * 0.94), (length * 0.48, y, height * 0.90)])
        cable_bundle("sag_cables", paths, 0.045)
    elif style == "covered_trunk":
        tray_path("trunk", [(-length * 0.48, 0, z), (length * 0.48, 0, z)], width)
        box("trunk_cover", (0, 0, z + 0.18), (length * 0.96, width * 1.18, 0.22), "Galvanized")
        for x in (-length * 0.38, 0, length * 0.38):
            beam(f"trunk_support_{x}", (x, 0, 0.05), (x, 0, z - 0.08), 0.065, "Galvanized", 8)
        add_warning_band("trunk_warning", (0, -width * 0.61, 0), length * 0.58, 0.025, z + 0.19)
    elif style == "bypass_repair":
        tray_path("repair_old", [(-length * 0.48, 0, z), (-length * 0.08, 0, z)], width)
        tray_path("repair_old_2", [(length * 0.10, 0, z), (length * 0.48, 0, z)], width)
        paths = []
        for i in range(5):
            y = -width * 0.28 + i * width * 0.14
            paths.append([(-length * 0.46, y, z + 0.05), (-length * 0.10, y, z + 0.05),
                          (0, y - 0.15, z + 0.35), (length * 0.12, y, z + 0.05),
                          (length * 0.46, y, z + 0.05)])
        cable_bundle("repair_bypass", paths, 0.042)
        for x in (-length * 0.11, length * 0.11):
            box(f"repair_clamp_{x}", (x, -width * 0.58, z + 0.10), (0.16, 0.08, 0.32), "Warning")
    elif style == "gantry_drop":
        for x in (-length * 0.45, length * 0.45):
            beam(f"gantry_post_{x}", (x, 0, 0.05), (x, 0, height), 0.09, "Galvanized", 8)
        tray_path("gantry_top", [(-length * 0.48, 0, height * 0.88), (length * 0.48, 0, height * 0.88)], width)
        tray_path("gantry_drop", [(length * 0.24, 0, height * 0.88), (length * 0.24, 0, height * 0.18)], width * 0.78)
        cable_bundle("gantry_cables", [[(-length * 0.45, -width * 0.25 + i * width * 0.16, height * 0.93),
                                        (length * 0.22, -width * 0.25 + i * width * 0.16, height * 0.93),
                                        (length * 0.22, -width * 0.25 + i * width * 0.16, height * 0.20)]
                                       for i in range(4)])
    else:
        raise ValueError(f"unsupported cable tray archetype: {style}")

    if wear > 0.40:
        for index in range(max(1, round(wear * 3))):
            rust_patch(f"tray_rust_{index}",
                       (rng.uniform(-length * 0.42, length * 0.42), -width * 0.55, rng.uniform(0.12, max(0.18, z))),
                       (rng.uniform(0.12, 0.28), 0.035, rng.uniform(0.05, 0.13)))


def lamp_head(prefix: str, location, size=(0.90, 0.42, 0.46), cage=True, hood=False,
              rotation=(0, 0, 0)):
    x, y, z = location
    sx, sy, sz = size
    box(f"{prefix}_housing", (x, y, z), size, "PaintGreen", rotation=rotation, bevel=0.055)
    box(f"{prefix}_lens", (x, y - sy * 0.53, z), (sx * 0.78, 0.055, sz * 0.68),
        "EmissionWarm", rotation=rotation, bevel=0.018)
    if cage:
        for offset in (-0.30, 0, 0.30):
            box(f"{prefix}_cage_v_{offset}", (x + offset * sx, y - sy * 0.60, z),
                (0.035, 0.035, sz * 0.90), "Galvanized", rotation=rotation, bevel=0.005)
        for offset in (-0.34, 0.34):
            box(f"{prefix}_cage_h_{offset}", (x, y - sy * 0.60, z + offset * sz),
                (sx * 0.94, 0.035, 0.035), "Galvanized", rotation=rotation, bevel=0.005)
    if hood:
        box(f"{prefix}_hood", (x, y - sy * 0.05, z + sz * 0.58),
            (sx * 1.18, sy * 1.38, 0.09), "Galvanized", rotation=(0.10, 0, 0), bevel=0.015)


def wall_mount(prefix: str, height: float, offset=0.0):
    box(f"{prefix}_backplate", (0, 0.16, height * 0.50), (0.72, 0.16, height), "Galvanized")
    beam(f"{prefix}_arm", (0, 0.05, height * 0.72), (offset, -0.55, height * 0.72), 0.065, "SteelDark", 8)


def build_maintenance_light(p, rng):
    style = p["archetype"]
    height = p["height"]
    wear = p["wear"]

    if style == "wall_cage":
        wall_mount("wall", height)
        lamp_head("wall_lamp", (0, -0.66, height * 0.72), (0.72, 0.40, 0.46), cage=True)
    elif style == "twin_bulkhead":
        box("twin_backplate", (0, 0.16, height * 0.50), (1.80, 0.18, height), "ConcreteDark")
        for side in (-1, 1):
            beam(f"twin_arm_{side}", (side * 0.55, 0.05, height * 0.66),
                 (side * 0.55, -0.36, height * 0.66), 0.055, "Galvanized", 8)
            lamp_head(f"twin_lamp_{side}", (side * 0.55, -0.50, height * 0.66),
                      (0.62, 0.34, 0.40), cage=True)
    elif style == "gooseneck":
        box("goose_backplate", (0, 0.14, height * 0.42), (0.58, 0.16, height * 0.84), "PaintGreen")
        pipe_path("goose_arm", [(0, 0.02, height * 0.66), (0, -0.42, height * 0.86),
                                (0, -0.90, height * 0.86)], 0.065, "Galvanized")
        lamp_head("goose_lamp", (0, -1.02, height * 0.78), (0.82, 0.40, 0.42), cage=False, hood=True)
    elif style == "strip_cage":
        box("strip_backplate", (0, 0.12, height * 0.48), (2.3, 0.16, height * 0.72), "ConcreteDark")
        box("strip_housing", (0, -0.10, height * 0.54), (2.05, 0.32, 0.44), "PaintCream")
        box("strip_emitter", (0, -0.29, height * 0.54), (1.72, 0.035, 0.20), "EmissionWarm", bevel=0.01)
        for x in (-0.82, -0.41, 0, 0.41, 0.82):
            box(f"strip_cage_{x}", (x, -0.33, height * 0.54), (0.025, 0.025, 0.46), "Galvanized", bevel=0.004)
    elif style == "tripod_portable":
        cylinder("tripod_hub", (0, 0, height * 0.46), 0.13, 0.24, "SteelDark", 10)
        for index, angle in enumerate((0, math.tau / 3, 2 * math.tau / 3)):
            beam(f"tripod_leg_{index}", (0, 0, height * 0.42),
                 (math.cos(angle) * 0.78, math.sin(angle) * 0.78, 0.04), 0.055, "Galvanized", 8)
        beam("tripod_mast", (0, 0, height * 0.42), (0, 0, height * 0.92), 0.075, "Galvanized", 8)
        lamp_head("tripod_lamp", (0, -0.18, height), (1.00, 0.48, 0.62), cage=True)
        cable_path("tripod_lead", [(0.10, 0.05, height * 0.40), (0.55, 0.32, 0.10),
                                   (1.10, 0.58, 0.04)], 0.035, "Rubber")
    elif style == "pole_single":
        base_plate("pole_base", 0, 0, 0.05, 0.65, "ConcreteDark")
        beam("pole_mast", (0, 0, 0.10), (0, 0, height * 0.86), 0.12, "Galvanized", 10)
        beam("pole_arm", (0, 0, height * 0.82), (0, -0.82, height * 0.96), 0.075, "Galvanized", 8)
        lamp_head("pole_lamp", (0, -0.92, height * 0.94), (0.92, 0.42, 0.46), cage=False, hood=True)
    elif style == "pole_twin":
        base_plate("twin_pole_base", 0, 0, 0.05, 0.72, "ConcreteDark")
        beam("twin_pole_mast", (0, 0, 0.10), (0, 0, height * 0.88), 0.13, "Galvanized", 10)
        beam("twin_pole_bar", (-0.92, 0, height * 0.88), (0.92, 0, height * 0.88), 0.075, "Galvanized", 8)
        for side in (-1, 1):
            lamp_head(f"twin_pole_lamp_{side}", (side * 0.78, -0.22, height * 0.96),
                      (0.72, 0.38, 0.42), cage=False, hood=True)
    elif style == "suspended_beam":
        for x in (-1.1, 1.1):
            base_plate(f"suspended_mount_{x}", x, 0, height, 0.35, "Galvanized")
            beam(f"suspended_drop_{x}", (x, 0, height), (x, 0, height * 0.55), 0.045, "SteelDark", 8)
        beam("suspended_bar", (-1.25, 0, height * 0.55), (1.25, 0, height * 0.55), 0.075, "Galvanized", 8)
        for x in (-0.72, 0.72):
            lamp_head(f"suspended_lamp_{x}", (x, -0.18, height * 0.46), (0.82, 0.40, 0.44), cage=True)
    elif style == "angled_worklight":
        base_plate("worklight_base", 0, 0, 0.05, 0.72, "ConcreteDark")
        beam("worklight_post", (0, 0, 0.10), (0.22, 0, height * 0.76), 0.11, "PaintGreen", 8)
        beam("worklight_brace", (-0.34, 0, 0.12), (0.18, 0, height * 0.55), 0.06, "Galvanized", 8)
        lamp_head("worklight_lamp", (0.28, -0.28, height * 0.84), (1.12, 0.52, 0.70), cage=True, hood=True,
                  rotation=(0.10, 0, 0))
    elif style == "repaired_conduit":
        box("repair_backplate", (0, 0.15, height * 0.46), (1.18, 0.18, height * 0.92), "ConcreteDark")
        cable_path("repair_conduit_old", [(-0.34, -0.02, 0.08), (-0.34, -0.02, height * 0.48)], 0.065, "Galvanized")
        cable_path("repair_conduit_new", [(-0.34, -0.02, height * 0.48), (0.28, -0.16, height * 0.66),
                                          (0.28, -0.16, height * 0.84)], 0.075, "PaintBlue")
        lamp_head("repair_lamp", (0.28, -0.44, height * 0.82), (0.78, 0.38, 0.48), cage=True)
        box("repair_junction", (-0.34, -0.14, height * 0.46), (0.42, 0.20, 0.48), "Warning")
    else:
        raise ValueError(f"unsupported maintenance light archetype: {style}")

    if wear > 0.42:
        for index in range(max(1, round(wear * 3))):
            rust_patch(f"light_rust_{index}",
                       (rng.uniform(-0.35, 0.35), -0.02, rng.uniform(0.10, max(0.18, height * 0.72))),
                       (rng.uniform(0.08, 0.20), 0.035, rng.uniform(0.05, 0.12)))


SEGMENTS = {
    0: "abcdef",
    1: "bc",
    2: "abdeg",
    3: "abcdg",
    4: "bcfg",
    5: "acdfg",
    6: "acdefg",
    7: "abc",
    8: "abcdefg",
    9: "abcdfg",
}


def seven_segment_digit(prefix: str, value: int, center, scale: float, front_y: float):
    cx, _cy, cz = center
    horizontal = {
        "a": (0, 0.92), "g": (0, 0), "d": (0, -0.92),
    }
    vertical = {
        "f": (-0.46, 0.46), "b": (0.46, 0.46),
        "e": (-0.46, -0.46), "c": (0.46, -0.46),
    }
    for segment in SEGMENTS[value]:
        if segment in horizontal:
            x, z = horizontal[segment]
            size = (0.72 * scale, 0.035, 0.14 * scale)
        else:
            x, z = vertical[segment]
            size = (0.14 * scale, 0.035, 0.76 * scale)
        box(f"{prefix}_{segment}", (cx + x * scale, front_y, cz + z * scale), size,
            "PaintCream", bevel=0.012)


def number_plate(prefix: str, number: int, width: float, depth: float, z: float):
    front = -depth * 0.51
    plate_width = min(width * 0.72, 1.55)
    box(f"{prefix}_plate", (0, front, z), (plate_width, 0.055, 0.70), "SteelDark", bevel=0.025)
    scale = 0.30
    digits = f"{number:02d}"
    seven_segment_digit(f"{prefix}_digit_a", int(digits[0]), (-0.34, front - 0.035, z), scale, front - 0.035)
    seven_segment_digit(f"{prefix}_digit_b", int(digits[1]), (0.34, front - 0.035, z), scale, front - 0.035)


def indicator_row(prefix: str, width: float, depth: float, z: float, count=3):
    for index in range(count):
        x = (index - (count - 1) / 2) * min(0.28, width * 0.15)
        mat = "EmissionGreen" if index % 3 != 2 else "EmissionRed"
        cylinder(f"{prefix}_indicator_{index}", (x, -depth * 0.53, z), 0.065, 0.05, mat, 10,
                 rotation=(math.pi / 2, 0, 0), bevel=0.008)


def cabinet(prefix: str, width: float, depth: float, height: float, mat_name="PaintGreen", doors=1):
    box(f"{prefix}_body", (0, 0, height * 0.50), (width, depth, height), mat_name, bevel=0.065)
    for index in range(doors):
        door_width = width / doors * 0.92
        x = -width * 0.5 + width / doors * (index + 0.5)
        box(f"{prefix}_door_{index}", (x, -depth * 0.515, height * 0.52),
            (door_width, 0.06, height * 0.88), "PaintCream" if index % 2 else mat_name, bevel=0.028)
        box(f"{prefix}_handle_{index}", (x + door_width * 0.32, -depth * 0.565, height * 0.52),
            (0.055, 0.045, 0.28), "SteelDark", bevel=0.012)


def conduit(prefix: str, start, end, radius=0.055, mat_name="Galvanized"):
    pipe_path(prefix, [start, end], radius, mat_name, collars=False)


def build_control_box(p, rng, index: int):
    style = p["archetype"]
    width, depth, height = p["width"], p["depth"], p["height"]
    wear = p["wear"]
    body_mat = "PaintGreen" if p["paint"] == "green" else ("PaintBlue" if p["paint"] == "blue" else "PaintCream")

    if style == "wall_single":
        box("single_backplate", (0, depth * 0.36, height * 0.50), (width * 1.16, 0.16, height * 1.10), "ConcreteDark")
        cabinet("single", width, depth, height, body_mat, 1)
    elif style == "wall_twin":
        box("twin_backplate", (0, depth * 0.36, height * 0.50), (width * 1.12, 0.16, height * 1.08), "ConcreteDark")
        cabinet("twin", width, depth, height, body_mat, 2)
    elif style == "floor_cabinet":
        box("floor_plinth", (0, 0, 0.10), (width * 1.12, depth * 1.14, 0.20), "ConcreteDark")
        cabinet("floor", width, depth, height, body_mat, 2)
        for side in (-1, 1):
            conduit(f"floor_conduit_{side}", (side * width * 0.30, depth * 0.42, 0.10),
                    (side * width * 0.30, depth * 0.42, height * 0.36), 0.06)
    elif style == "pedestal":
        box("pedestal_foot", (0, 0, 0.10), (width * 0.80, depth * 0.92, 0.20), "ConcreteDark")
        box("pedestal_stem", (0, 0, height * 0.27), (width * 0.38, depth * 0.48, height * 0.54), "Galvanized")
        cabinet("pedestal_box", width, depth, height * 0.58, body_mat, 1)
        for obj in [item for item in bpy.context.scene.objects if item.name.startswith("pedestal_box")]:
            obj.data.transform(Matrix.Translation((0, 0, height * 0.44)))
    elif style == "junction_cluster":
        cabinet("cluster_main", width * 0.68, depth, height * 0.76, body_mat, 1)
        for side, scale in ((-1, 0.56), (1, 0.46)):
            x = side * width * 0.46
            box(f"cluster_side_{side}", (x, 0.02, height * (0.28 + 0.12 * (side > 0))),
                (width * scale, depth * 0.80, height * (0.48 + 0.10 * (side > 0))), "PaintCream", bevel=0.05)
            conduit(f"cluster_link_{side}", (side * width * 0.30, 0, height * 0.36),
                    (x, 0, height * (0.28 + 0.12 * (side > 0))), 0.055, "Galvanized")
    elif style == "sloped_console":
        box("console_base", (0, 0, height * 0.34), (width, depth, height * 0.68), body_mat, bevel=0.06)
        box("console_slope", (0, -depth * 0.10, height * 0.76), (width * 0.96, depth * 0.86, height * 0.22),
            "PaintCream", rotation=(math.radians(-18), 0, 0), bevel=0.045)
        for i in range(4):
            cylinder(f"console_button_{i}", (-width * 0.30 + i * width * 0.20, -depth * 0.50, height * 0.78),
                     0.055, 0.045, "EmissionGreen" if i < 3 else "EmissionRed", 10,
                     rotation=(math.pi / 2, 0, 0))
    elif style == "tall_distribution":
        box("distribution_plinth", (0, 0, 0.10), (width * 1.12, depth * 1.14, 0.20), "ConcreteDark")
        cabinet("distribution", width, depth, height, body_mat, 3)
        for level in (0.28, 0.52, 0.74):
            box(f"distribution_bus_{level}", (0, -depth * 0.55, height * level),
                (width * 0.72, 0.045, 0.08), "Warning", bevel=0.01)
    elif style == "outdoor_canopy":
        cabinet("canopy_box", width * 0.78, depth, height * 0.76, body_mat, 2)
        for x in (-width * 0.56, width * 0.56):
            beam(f"canopy_post_{x}", (x, depth * 0.30, 0.05), (x, depth * 0.30, height * 1.12), 0.065, "Galvanized", 8)
        box("canopy_roof", (0, 0, height * 1.12), (width * 1.35, depth * 1.55, 0.12), "Galvanized",
            rotation=(0, 0.08, 0), bevel=0.02)
    elif style == "retrofit_sidecar":
        cabinet("retrofit_main", width * 0.74, depth, height, body_mat, 1)
        side_x = width * 0.55
        box("retrofit_sidecar", (side_x, -0.04, height * 0.40),
            (width * 0.48, depth * 0.78, height * 0.62), "PaintBlue", bevel=0.05)
        pipe_path("retrofit_conduit", [(width * 0.30, depth * 0.34, height * 0.65),
                                       (side_x, depth * 0.34, height * 0.65),
                                       (side_x, depth * 0.34, height * 0.50)], 0.055, "Galvanized")
        box("retrofit_tag", (side_x, -depth * 0.43, height * 0.45), (0.36, 0.04, 0.20), "Warning")
    elif style == "damaged_door":
        box("damaged_plinth", (0, 0, 0.10), (width * 1.08, depth * 1.08, 0.20), "ConcreteDark")
        box("damaged_body", (0, 0, height * 0.50), (width, depth, height), body_mat, bevel=0.06)
        door = box("damaged_door", (-width * 0.18, -depth * 0.62, height * 0.52),
                   (width * 0.88, 0.07, height * 0.84), "PaintCream", rotation=(0, 0, math.radians(-9)), bevel=0.025)
        door.data.transform(Matrix.Translation((-width * 0.06, 0, 0)))
        conduit("damaged_bypass", (width * 0.44, depth * 0.36, 0.12),
                (width * 0.44, depth * 0.36, height * 0.72), 0.07, "PaintBlue")
        rust_patch("damaged_hinge_rust", (-width * 0.48, -depth * 0.55, height * 0.34), (0.10, 0.05, 0.34))
    else:
        raise ValueError(f"unsupported control box archetype: {style}")

    number_plate("control", index, width, depth, height * 0.72)
    indicator_row("control", width, depth, height * 0.48, 3)
    add_warning_band("control_warning", (0, -depth * 0.52, 0), width * 0.62, 0.035, height * 0.18)
    if wear > 0.38:
        for patch_index in range(max(1, round(wear * 4))):
            rust_patch(f"box_rust_{patch_index}",
                       (rng.uniform(-width * 0.42, width * 0.42), -depth * 0.54,
                        rng.uniform(height * 0.10, height * 0.88)),
                       (rng.uniform(0.08, 0.22), 0.035, rng.uniform(0.05, 0.16)))


BUILDERS = {
    "pipe-support": lambda context, rng: build_pipe_support(context["parameters"], rng),
    "cable-tray": lambda context, rng: build_cable_tray(context["parameters"], rng),
    "maintenance-light": lambda context, rng: build_maintenance_light(context["parameters"], rng),
    "control-box": lambda context, rng: build_control_box(context["parameters"], rng, int(context["index"])),
}


def join_meshes(name: str) -> bpy.types.Object:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("generator created no mesh geometry")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    root = bpy.context.object
    root.name = f"{name}_nocol"
    root.data.name = f"{root.name}_mesh"
    coordinates = [root.matrix_world @ vertex.co for vertex in root.data.vertices]
    lows = Vector((min(point.x for point in coordinates), min(point.y for point in coordinates),
                   min(point.z for point in coordinates)))
    highs = Vector((max(point.x for point in coordinates), max(point.y for point in coordinates),
                    max(point.z for point in coordinates)))
    center = (lows + highs) * 0.5
    root.data.transform(Matrix.Translation((-center.x, -center.y, -lows.z)))
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    root.scale = (1, 1, 1)
    root["asset_role"] = "render"
    root["collision"] = "none"
    return root


def material_emission_strength(mat: bpy.types.Material) -> float:
    if not mat or not mat.use_nodes:
        return 0.0
    node = mat.node_tree.nodes.get("Principled BSDF")
    if not node:
        return 0.0
    strength = node.inputs.get("Emission Strength")
    return float(strength.default_value) if strength else 0.0


def scene_metrics() -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "EMPTY"}]
    if not meshes:
        raise RuntimeError("scene has no mesh objects")
    triangles = 0
    materials = set()
    emission = set()
    lows = Vector((math.inf, math.inf, math.inf))
    highs = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            world = evaluated.matrix_world
            for vertex in mesh.vertices:
                point = world @ vertex.co
                lows.x, lows.y, lows.z = min(lows.x, point.x), min(lows.y, point.y), min(lows.z, point.z)
                highs.x, highs.y, highs.z = max(highs.x, point.x), max(highs.y, point.y), max(highs.z, point.z)
            for slot in obj.material_slots:
                if slot.material:
                    materials.add(slot.material.name)
                    if material_emission_strength(slot.material) > 0.001:
                        emission.add(slot.material.name)
        finally:
            evaluated.to_mesh_clear()
    root = meshes[0]
    return {
        "objects": len(objects),
        "mesh_objects": len(meshes),
        "triangles": triangles,
        "materials": len(materials),
        "material_names": sorted(materials),
        "emissive_materials": sorted(emission),
        "bounds_min": [round(float(v), 5) for v in lows],
        "bounds_max": [round(float(v), 5) for v in highs],
        "bounds_size": [round(float(v), 5) for v in highs - lows],
        "origin": [round(float(v), 5) for v in root.location],
        "rotation": [round(float(v), 5) for v in root.rotation_euler],
        "scale": [round(float(v), 5) for v in root.scale],
        "mesh_names": sorted(obj.name for obj in meshes),
    }


def close_enough(left, right, tolerance=0.004):
    return all(abs(float(a) - float(b)) <= tolerance for a, b in zip(left, right))


def look_at(obj: bpy.types.Object, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(root: bpy.types.Object, output_path: Path, family: str, bounds_size) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    floor = box("preview_floor", (0, 0, -0.04), (14, 14, 0.08), "ConcreteDark", bevel=0)
    floor["preview_only"] = True
    bpy.ops.object.camera_add(location=(8.5, -10.5, 7.5))
    camera = bpy.context.object
    camera.name = "preview_camera"
    camera.data.type = "ORTHO"
    family_scale = {
        "pipe-support": 7.5,
        "cable-tray": 7.2,
        "maintenance-light": 6.6,
        "control-box": 5.2,
    }[family]
    camera.data.ortho_scale = max(family_scale, max(bounds_size) * 1.24)
    look_at(camera, (0, 0, bounds_size[2] * 0.45))
    scene.camera = camera
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)


def build_variant(context: dict) -> dict:
    family = context["invariants"].get("family")
    if family not in BUILDERS:
        raise ValueError(f"unsupported Reactor Site infrastructure family: {family}")
    rng = random.Random(int(context["seed"]))
    output_dir = Path(context["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = output_dir / "source.blend"
    runtime_path = output_dir / "runtime.glb"
    preview_path = output_dir / "preview.png"

    reset_scene()
    BUILDERS[family](context, rng)
    root = join_meshes(context["id"])
    root["family"] = family
    root["variant_id"] = context["id"]
    root["seed"] = int(context["seed"])
    root["archetype"] = str(context["parameters"].get("archetype", ""))
    bpy.context.view_layer.update()
    source_metrics = scene_metrics()
    if abs(source_metrics["bounds_min"][2]) > 0.01:
        raise RuntimeError(f"bottom origin failed: {source_metrics['bounds_min'][2]}")
    if source_metrics["mesh_objects"] != 1 or source_metrics["objects"] != 1:
        raise RuntimeError(f"expected one batched mesh, got {source_metrics['objects']} objects")
    if not all(name.endswith("_nocol") for name in source_metrics["mesh_names"]):
        raise RuntimeError(f"decorative naming failed: {source_metrics['mesh_names']}")
    if not close_enough(source_metrics["origin"], (0, 0, 0), 0.0001):
        raise RuntimeError(f"origin is not bottom-center: {source_metrics['origin']}")

    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(runtime_path), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
        export_extras=True, export_animations=False, export_materials="EXPORT",
    )
    render_preview(root, preview_path, family, source_metrics["bounds_size"])

    # Actual roundtrip gate: reset to an empty scene, import, and compare semantic facts.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(runtime_path))
    bpy.context.view_layer.update()
    imported_metrics = scene_metrics()
    mismatches = []
    for key in ("objects", "mesh_objects", "triangles", "materials"):
        if source_metrics[key] != imported_metrics[key]:
            mismatches.append(f"{key} {source_metrics[key]} != {imported_metrics[key]}")
    for key in ("bounds_size", "origin", "rotation", "scale"):
        if not close_enough(source_metrics[key], imported_metrics[key]):
            mismatches.append(f"{key} {source_metrics[key]} != {imported_metrics[key]}")
    if source_metrics["emissive_materials"] != imported_metrics["emissive_materials"]:
        mismatches.append(
            f"emission {source_metrics['emissive_materials']} != {imported_metrics['emissive_materials']}"
        )
    if not imported_metrics["mesh_names"] or not all(
        name.endswith("_nocol") for name in imported_metrics["mesh_names"]
    ):
        mismatches.append(f"collision naming lost: {imported_metrics['mesh_names']}")
    if bpy.data.actions:
        mismatches.append(f"unexpected animations: {[action.name for action in bpy.data.actions]}")
    if mismatches:
        raise RuntimeError("roundtrip mismatch: " + "; ".join(mismatches))

    file_size = runtime_path.stat().st_size
    fingerprint_payload = {
        "family": family,
        "seed": context["seed"],
        "parameters": context["parameters"],
        "triangles": source_metrics["triangles"],
        "bounds": source_metrics["bounds_size"],
    }
    fingerprint = hashlib.sha256(json.dumps(fingerprint_payload, sort_keys=True).encode()).hexdigest()[:20]
    return {
        "outputs": [
            {"role": "editable", "path": str(source_path.resolve())},
            {"role": "runtime", "path": str(runtime_path.resolve())},
            {"role": "preview", "path": str(preview_path.resolve())},
        ],
        "metrics": {
            "triangles": source_metrics["triangles"],
            "materials": source_metrics["materials"],
            "file_size_bytes": file_size,
            "objects": source_metrics["objects"],
            "mesh_objects": source_metrics["mesh_objects"],
            "emissive_materials": len(source_metrics["emissive_materials"]),
            "roundtrip_import": True,
            "fingerprint": fingerprint,
        },
        "warnings": [],
        "metadata": {
            "family": family,
            "archetype": context["parameters"].get("archetype"),
            "seed": context["seed"],
            "source": source_metrics,
            "roundtrip": imported_metrics,
        },
    }
