#!/usr/bin/env python3
"""Deterministic Blender generator for the Falkenwacht medieval prop library.

The module implements the blender-object-batches generator interface. Contracts and
operational reports intentionally live outside the product repository; this script and
the generated editable/runtime assets are the reproducible product deliverables.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


GENERATOR_ID = "falkenwacht-medieval-props-generator"
GENERATOR_VERSION = "1.0.2"

PALETTE = {
    "WoodDark": ((0.16, 0.075, 0.032, 1), 0.0, 0.88),
    "Wood": ((0.30, 0.16, 0.065, 1), 0.0, 0.84),
    "WoodLight": ((0.48, 0.29, 0.12, 1), 0.0, 0.82),
    "CutWood": ((0.64, 0.43, 0.20, 1), 0.0, 0.88),
    "Stone": ((0.46, 0.42, 0.34, 1), 0.0, 0.91),
    "StoneLight": ((0.61, 0.55, 0.44, 1), 0.0, 0.90),
    "StoneDark": ((0.29, 0.28, 0.24, 1), 0.0, 0.94),
    "Iron": ((0.11, 0.12, 0.13, 1), 0.68, 0.67),
    "Rust": ((0.34, 0.105, 0.035, 1), 0.18, 0.90),
    "Leather": ((0.22, 0.085, 0.035, 1), 0.0, 0.86),
    "ShieldBlue": ((0.045, 0.15, 0.35, 1), 0.0, 0.83),
    "ShieldRed": ((0.44, 0.045, 0.024, 1), 0.0, 0.86),
    "ShieldOchre": ((0.62, 0.34, 0.07, 1), 0.0, 0.88),
    "PaintWear": ((0.24, 0.16, 0.08, 1), 0.0, 0.96),
    "IvyDark": ((0.075, 0.16, 0.045, 1), 0.0, 0.92),
    "Ivy": ((0.16, 0.29, 0.075, 1), 0.0, 0.88),
    "IvyLight": ((0.28, 0.40, 0.10, 1), 0.0, 0.84),
    "IvyDry": ((0.36, 0.27, 0.095, 1), 0.0, 0.95),
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FalkenwachtPreviewWorld")
    scene.world.color = (0.055, 0.065, 0.075)


def material(name: str) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    base, metallic, roughness = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = base
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = base
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    return mat


def finish(obj: bpy.types.Object, mat_name: str, bevel: float = 0.0) -> bpy.types.Object:
    obj.name = f"{obj.name}_nocol" if not obj.name.endswith("_nocol") else obj.name
    obj.data.name = f"{obj.name}_mesh"
    obj.data.materials.append(material(mat_name))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("worn_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["asset_role"] = "render"
    return obj


def box(name: str, location, size, mat_name: str, rotation=(0, 0, 0), bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(max(0.002, value) * 0.5 for value in size)
    return finish(obj, mat_name, min(bevel, min(size) * 0.18))


def cylinder(name: str, location, radius: float, depth: float, mat_name: str,
             vertices=10, rotation=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name, min(bevel, radius * 0.18))


def beam(name: str, start, end, radius: float, mat_name: str, vertices=8):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cylinder(name, (a + b) * 0.5, radius, delta.length, mat_name, vertices, bevel=radius * 0.12)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.rotation_mode = "XYZ"
    return obj


def sphere(name: str, location, scale, mat_name: str, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return finish(obj, mat_name, 0)


def torus(name: str, location, major_radius: float, minor_radius: float, mat_name: str,
          major_segments=16, minor_segments=6, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius,
                                    major_segments=major_segments, minor_segments=minor_segments,
                                    location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name, 0)


def prism(name: str, outline, depth: float, mat_name: str, y=0.0):
    """Extrude an X/Z outline along local Y."""
    vertices = [(x, y - depth * 0.5, z) for x, z in outline]
    vertices += [(x, y + depth * 0.5, z) for x, z in outline]
    count = len(outline)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat_name, min(depth * 0.12, 0.025))


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
    minimum_z = min((root.matrix_world @ Vector(corner)).z for corner in root.bound_box)
    root.data.transform(Matrix.Translation((0, 0, -minimum_z)))
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    root["asset_role"] = "render"
    root["collision"] = "none"
    return root


def add_log(rng, name: str, center, length: float, radius: float, yaw=0.0, pitch=0.0):
    direction = Vector((math.cos(yaw) * math.cos(pitch), math.sin(yaw) * math.cos(pitch), math.sin(pitch)))
    start = Vector(center) - direction * length * 0.5
    end = Vector(center) + direction * length * 0.5
    beam(name, start, end, radius, "Wood", 9)
    for side, point in (("a", start), ("b", end)):
        cap_center = point + direction * (0.006 if side == "a" else -0.006)
        cap = cylinder(f"{name}_cut_{side}", cap_center, radius * 0.86, 0.012, "CutWood", 9, bevel=0)
        cap.rotation_mode = "QUATERNION"
        cap.rotation_quaternion = direction.to_track_quat("Z", "Y")
        bpy.context.view_layer.objects.active = cap
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        cap.rotation_mode = "XYZ"
    if rng.random() < 0.65:
        beam(f"{name}_barkscar", Vector(center) + Vector((0, 0, radius * 0.75)),
             Vector(center) + Vector((length * 0.16, 0, radius * 0.75)), radius * 0.10, "WoodDark", 6)


def build_woodpile(p, rng):
    style = p["archetype"]
    width, depth = p["width"], p["depth"]
    count, wear = p["log_count"], p["wear"]
    supports = style in {"lean_to", "roofed_rack", "staggered", "tall_stack"}
    if supports:
        for x in (-width * 0.43, width * 0.43):
            box(f"rack_post_{x:+.2f}", (x, 0, 1.15), (0.16, 0.18, 2.3), "WoodDark", bevel=0.025)
        box("rack_base", (0, 0, 0.11), (width, depth * 0.85, 0.22), "WoodDark")
    if style == "roofed_rack":
        for side in (-1, 1):
            box(f"roof_{side}", (side * width * 0.22, 0, 2.42), (width * 0.56, depth * 1.15, 0.12),
                "WoodDark", rotation=(0, side * 0.16, 0))
    if style == "round_bundle":
        count = max(count, 14)
    for i in range(count):
        row = int(math.sqrt(i * 0.8)) if style in {"triangular", "tall_stack"} else i // max(3, int(width / 0.42))
        column = i - row * max(3, int(width / 0.42))
        if style == "collapsed" and i > count * 0.55:
            x = rng.uniform(-width * 0.65, width * 0.65)
            y = rng.uniform(-depth * 0.65, depth * 0.65)
            z = 0.16 + rng.uniform(0, 0.22)
            yaw = rng.uniform(-0.55, 0.55)
        elif style == "round_bundle":
            angle = math.tau * i / count
            x = math.cos(angle) * width * 0.23
            y = math.sin(angle) * depth * 0.22
            z = 0.58 + math.sin(angle * 2) * 0.12
            yaw = rng.uniform(-0.05, 0.05)
        else:
            per_row = max(3, int(width / 0.42))
            x = -width * 0.42 + (column % per_row) * (width * 0.84 / max(1, per_row - 1))
            y = rng.uniform(-depth * 0.10, depth * 0.10)
            z = 0.18 + row * 0.31
            if style == "lean_to":
                z += (x / width + 0.5) * 0.38
            yaw = rng.uniform(-0.055, 0.055)
        length = depth * rng.uniform(0.78, 1.08) if style != "split_heap" else depth * rng.uniform(0.48, 0.82)
        add_log(rng, f"log_{i:02d}", (x, y, z), length, rng.uniform(0.11, 0.17),
                yaw=math.pi * 0.5 + yaw, pitch=rng.uniform(-0.035, 0.035))
    if style in {"crate_mix", "split_heap"}:
        box("chopping_block", (width * 0.44, -depth * 0.24, 0.35), (0.55, 0.55, 0.7), "WoodDark")
        beam("axe_handle", (width * 0.44, -depth * 0.24, 0.68),
             (width * 0.61, -depth * 0.16, 1.45), 0.035, "WoodLight", 8)
        box("axe_head", (width * 0.61, -depth * 0.16, 1.45), (0.34, 0.07, 0.18), "Iron", rotation=(0, 0.15, 0))
    for i in range(max(1, round(wear * 4))):
        x = rng.uniform(-width * 0.48, width * 0.48)
        box(f"bark_chip_{i}", (x, rng.uniform(-depth * 0.5, depth * 0.5), 0.025),
            (rng.uniform(0.10, 0.24), rng.uniform(0.04, 0.12), 0.05), "WoodLight", rotation=(0, 0, rng.random()))


def stone_block(name, angle, radius, z, width, height, depth, mat_name="Stone"):
    x, y = math.cos(angle) * radius, math.sin(angle) * radius
    return box(name, (x, y, z), (width, depth, height), mat_name, rotation=(0, 0, angle))


def build_well(p, rng):
    style = p["archetype"]
    radius, height, courses = p["radius"], p["height"], p["courses"]
    square = style in {"square", "trough"}
    segments = 4 if square else (8 if style in {"octagonal", "broken"} else 12)
    for course in range(courses):
        z = 0.18 + course * (height / courses)
        for i in range(segments):
            if style == "broken" and course == courses - 1 and i in {1, 2, 6}:
                continue
            angle = math.tau * (i + 0.5 * (course % 2)) / segments
            block_width = (math.tau * radius / segments) * 0.90
            stone_block(f"well_stone_{course}_{i}", angle, radius, z, block_width,
                        height / courses * 0.82, 0.38, "StoneLight" if (i + course) % 5 == 0 else "Stone")
    torus("well_lip", (0, 0, height + 0.09), radius, 0.14, "StoneLight", max(12, segments), 4)
    if style == "trough":
        box("trough_basin", (radius * 1.35, 0, 0.42), (radius * 1.7, radius * 1.0, 0.55), "Stone")
        box("trough_water_gap", (radius * 1.35, 0, 0.71), (radius * 1.3, radius * 0.6, 0.04), "StoneDark", bevel=0.01)
    if style in {"roofed", "crank", "bucket", "round_tall"}:
        post_height = height + p["post_height"]
        for x in (-radius * 1.05, radius * 1.05):
            box(f"well_post_{x:+.2f}", (x, 0, post_height * 0.5), (0.17, 0.20, post_height), "WoodDark")
        beam("well_crank", (-radius * 1.22, 0, post_height * 0.72),
             (radius * 1.22, 0, post_height * 0.72), 0.07, "WoodLight", 8)
        if style == "roofed":
            for side in (-1, 1):
                box(f"well_roof_{side}", (side * radius * 0.42, 0, post_height + 0.18),
                    (radius * 1.45, radius * 2.65, 0.10), "WoodDark", rotation=(0, side * 0.30, 0))
        if style in {"bucket", "crank"}:
            beam("well_rope", (0, 0, post_height * 0.72), (0, 0, height * 0.72), 0.018, "Leather", 6)
            cylinder("well_bucket", (0, 0, height * 0.62), radius * 0.20, radius * 0.34, "Wood", 10)
    for i in range(max(1, round(p["wear"] * 5))):
        angle = rng.random() * math.tau
        stone_block(f"fallen_stone_{i}", angle, radius * rng.uniform(1.2, 1.7), 0.10,
                    rng.uniform(0.22, 0.38), 0.20, rng.uniform(0.20, 0.34), "StoneDark")


def add_weapon(rng, name, x, y, z, kind, height, lean=0.0):
    if kind == "spear":
        beam(f"{name}_shaft", (x, y, z), (x + lean, y, z + height), 0.025, "WoodLight", 7)
        prism(f"{name}_tip", [(x + lean - 0.09, z + height), (x + lean, z + height + 0.30),
                              (x + lean + 0.09, z + height)], 0.045, "Iron", y)
    elif kind == "sword":
        beam(f"{name}_blade", (x, y, z + 0.18), (x + lean, y, z + height), 0.035, "Iron", 6)
        box(f"{name}_guard", (x, y, z + 0.22), (0.30, 0.07, 0.055), "Rust", rotation=(0, 0, -lean * 0.2))
        beam(f"{name}_grip", (x, y, z), (x, y, z + 0.22), 0.045, "Leather", 7)
    else:
        beam(f"{name}_haft", (x, y, z), (x + lean, y, z + height * 0.75), 0.032, "WoodLight", 7)
        prism(f"{name}_axe", [(x + lean - 0.05, z + height * 0.68), (x + lean + 0.23, z + height * 0.76),
                              (x + lean + 0.18, z + height), (x + lean - 0.05, z + height * 0.92)],
              0.065, "Iron", y)


def build_weapon_rack(p, rng):
    style = p["archetype"]
    width, height = p["width"], p["height"]
    depth = p["depth"]
    if style in {"a_frame", "training"}:
        for side in (-1, 1):
            beam(f"frame_front_{side}", (side * width * 0.46, -depth * 0.30, 0),
                 (side * width * 0.30, 0, height), 0.07, "WoodDark", 8)
            beam(f"frame_back_{side}", (side * width * 0.46, depth * 0.30, 0),
                 (side * width * 0.30, 0, height), 0.07, "WoodDark", 8)
    else:
        for x in (-width * 0.46, width * 0.46):
            box(f"rack_post_{x:+.2f}", (x, 0, height * 0.5), (0.13, depth, height), "WoodDark")
    for z in (height * 0.25, height * 0.72):
        box(f"rack_rail_{z:.2f}", (0, 0, z), (width, 0.13, 0.13), "Wood")
    if style in {"bench", "armory"}:
        box("rack_bench", (0, 0, 0.27), (width * 0.94, depth * 1.25, 0.16), "Wood")
    kinds = {
        "spear_line": ["spear"], "sword_line": ["sword"], "axe_line": ["axe"],
        "mixed": ["spear", "sword", "axe"], "a_frame": ["spear", "axe"],
        "wall_frame": ["sword", "axe"], "bench": ["sword", "spear"],
        "armory": ["spear", "sword", "axe"], "training": ["sword", "axe"],
        "damaged": ["spear", "axe"],
    }[style]
    count = p["weapon_count"]
    for i in range(count):
        if style == "damaged" and i == count - 1:
            add_weapon(rng, f"weapon_{i}", width * 0.58, depth * 0.45, 0.04, "spear", height * 0.65, width * 0.16)
            continue
        x = -width * 0.38 + i * width * 0.76 / max(1, count - 1)
        kind = kinds[i % len(kinds)]
        add_weapon(rng, f"weapon_{i}", x, -0.04 + (i % 2) * 0.08, 0.12, kind,
                   height * rng.uniform(0.78, 1.04), rng.uniform(-0.10, 0.10))
    for i in range(round(p["wear"] * 3)):
        box(f"rack_chip_{i}", (rng.uniform(-width * 0.4, width * 0.4), -depth * 0.45, 0.025),
            (0.14, 0.06, 0.05), "WoodLight", rotation=(0, 0, rng.random()))


SHIELD_OUTLINES = {
    "heater": [(-0.62, 1.45), (0.62, 1.45), (0.55, 0.65), (0, 0), (-0.55, 0.65)],
    "kite": [(-0.55, 1.65), (0.55, 1.65), (0.48, 0.85), (0, 0), (-0.48, 0.85)],
    "round": [
        (math.cos(math.tau * i / 14) * 0.74, 0.82 + math.sin(math.tau * i / 14) * 0.74)
        for i in range(14)
    ],
    "oval": [
        (math.cos(math.tau * i / 14) * 0.62, 0.92 + math.sin(math.tau * i / 14) * 0.90)
        for i in range(14)
    ],
    "pavise": [(-0.64, 1.75), (0, 1.92), (0.64, 1.75), (0.60, 0.15), (0.28, 0), (-0.28, 0), (-0.60, 0.15)],
    "buckler": [
        (math.cos(math.tau * i / 12) * 0.52, 0.56 + math.sin(math.tau * i / 12) * 0.52)
        for i in range(12)
    ],
    "notched": [(-0.68, 1.50), (-0.18, 1.42), (0, 1.58), (0.20, 1.40), (0.68, 1.50), (0.54, 0.55), (0, 0), (-0.54, 0.55)],
    "split": [(-0.60, 1.52), (0.02, 1.46), (0.58, 1.38), (0.48, 0.56), (-0.08, 0.04), (-0.55, 0.62)],
    "layered": [(-0.68, 1.38), (-0.48, 1.65), (0.48, 1.65), (0.68, 1.38), (0.54, 0.48), (0, 0), (-0.54, 0.48)],
    "twin": [(-0.55, 1.40), (0.55, 1.40), (0.50, 0.48), (0, 0), (-0.50, 0.48)],
}


def build_wall_shield(p, rng):
    style = p["archetype"]
    outline = SHIELD_OUTLINES[style]
    scale = p["scale"]
    outline = [(x * scale, z * scale) for x, z in outline]
    color = {"blue": "ShieldBlue", "red": "ShieldRed", "ochre": "ShieldOchre"}[p["paint"]]
    prism("shield_body", outline, 0.12 * scale, color)
    if style in {"round", "buckler", "oval"}:
        torus("shield_rim", (0, -0.071 * scale, (0.82 if style == "round" else 0.60) * scale),
              (0.70 if style == "round" else 0.48) * scale, 0.035 * scale, "Iron", 14, 4,
              rotation=(math.pi * 0.5, 0, 0))
    else:
        for i in range(len(outline)):
            a, b = outline[i], outline[(i + 1) % len(outline)]
            beam(f"rim_{i}", (a[0], -0.075 * scale, a[1]), (b[0], -0.075 * scale, b[1]),
                 0.028 * scale, "Iron", 6)
    sphere("shield_boss", (0, -0.10 * scale, 0.82 * scale),
           (0.18 * scale, 0.08 * scale, 0.18 * scale), "Iron", 12, 6)
    box("mounting_peg", (0, 0.18 * scale, 1.05 * scale), (0.11, 0.42, 0.11), "WoodDark")
    wear = p["wear"]
    for i in range(max(1, round(wear * 5))):
        x = rng.uniform(-0.40, 0.40) * scale
        z = rng.uniform(0.35, 1.30) * scale
        beam(f"paint_scrape_{i}", (x - 0.09, -0.072 * scale, z - 0.03),
             (x + 0.09, -0.074 * scale, z + 0.03), 0.016 * scale, "PaintWear", 5)
    if style in {"split", "notched"}:
        beam("old_crack", (-0.08 * scale, -0.078 * scale, 0.25 * scale),
             (0.12 * scale, -0.080 * scale, 1.35 * scale), 0.018 * scale, "WoodDark", 5)
    if style == "twin":
        second = prism("shield_companion", [(x * 0.68 + 0.82 * scale, z * 0.68 + 0.08) for x, z in outline],
                       0.10 * scale, "ShieldRed", y=0.06)
        second.rotation_euler.y = -0.16


def leaf(name: str, center, size: float, angle: float, mat_name: str, depth=0.025):
    x, y, z = center
    points = [(-0.65, 0), (-0.28, 0.18), (0, 1.0), (0.28, 0.18), (0.65, 0), (0, 0.12)]
    ca, sa = math.cos(angle), math.sin(angle)
    outline = []
    for px, pz in points:
        px, pz = px * size, pz * size
        outline.append((x + px * ca - pz * sa, z + px * sa + pz * ca))
    return prism(name, outline, depth, mat_name, y=y)


def build_ivy(p, rng):
    style = p["archetype"]
    width, height = p["width"], p["height"]
    stems = p["stem_count"]
    density, dryness = p["leaf_density"], p["dryness"]
    if style in {"corner", "arch_drape"}:
        stems += 1
    for stem_index in range(stems):
        base_x = rng.uniform(-width * 0.36, width * 0.36)
        points = [Vector((base_x, 0, 0))]
        steps = rng.randint(5, 8)
        for step in range(1, steps + 1):
            t = step / steps
            bias = math.sin(t * math.pi * (1.2 + stem_index * 0.12)) * width * rng.uniform(0.08, 0.20)
            if style == "diagonal":
                bias += (t - 0.5) * width * 0.75
            elif style == "fan":
                bias += (stem_index / max(1, stems - 1) - 0.5) * width * t
            elif style == "drooping":
                bias += math.sin(t * math.pi) * width * 0.35
            elif style == "corner":
                bias = width * (0.42 if stem_index % 2 else -0.42) + bias * 0.25
            z = height * t * (0.72 if style == "low_crawl" else 1.0)
            if style == "arch_drape" and t > 0.65:
                z -= (t - 0.65) * height * 0.55
            points.append(Vector((base_x + bias, rng.uniform(-0.015, 0.015), z)))
        for i in range(len(points) - 1):
            beam(f"vine_{stem_index}_{i}", points[i], points[i + 1], 0.018 + 0.006 * (1 - i / steps), "IvyDark", 6)
            if i == 0:
                continue
            leaf_count = max(1, round(density * 3))
            for leaf_index in range(leaf_count):
                t = (leaf_index + 1) / (leaf_count + 1)
                pos = points[i].lerp(points[i + 1], t)
                side = -1 if (leaf_index + i + stem_index) % 2 else 1
                size = rng.uniform(0.16, 0.28) * (0.78 if style == "sparse" else 1.0)
                pos.x += side * size * 0.55
                pos.y -= 0.025
                tone_roll = rng.random()
                mat_name = "IvyDry" if tone_roll < dryness else ("IvyLight" if tone_roll > 0.72 else "Ivy")
                leaf(f"leaf_{stem_index}_{i}_{leaf_index}", pos, size, rng.uniform(-0.8, 0.8), mat_name)
        if style in {"branched", "fan", "dense_cascade"} and len(points) > 4:
            anchor = points[len(points) // 2]
            side = -1 if stem_index % 2 else 1
            tip = anchor + Vector((side * width * rng.uniform(0.20, 0.38), 0, height * 0.22))
            beam(f"branch_{stem_index}", anchor, tip, 0.014, "IvyDark", 6)
            for j in range(2):
                pos = anchor.lerp(tip, (j + 1) / 3)
                leaf(f"branch_leaf_{stem_index}_{j}", pos, rng.uniform(0.17, 0.25), side * 0.55,
                     "IvyDry" if rng.random() < dryness else "Ivy")


BUILDERS = {
    "falkenwacht-woodpile": build_woodpile,
    "falkenwacht-stone-well": build_well,
    "falkenwacht-weapon-rack": build_weapon_rack,
    "falkenwacht-wall-shield": build_wall_shield,
    "falkenwacht-wall-ivy": build_ivy,
}


def scene_metrics() -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    materials = set()
    lows = Vector((math.inf, math.inf, math.inf))
    highs = Vector((-math.inf, -math.inf, -math.inf))
    mesh_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh_count += 1
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            materials.update(slot.material.name for slot in obj.material_slots if slot.material)
            for corner in obj.bound_box:
                point = obj.matrix_world @ Vector(corner)
                for axis in range(3):
                    lows[axis] = min(lows[axis], point[axis])
                    highs[axis] = max(highs[axis], point[axis])
        finally:
            evaluated.to_mesh_clear()
    if mesh_count == 0:
        raise RuntimeError("scene has no mesh objects")
    return {
        "mesh_objects": mesh_count,
        "triangles": triangles,
        "materials": len(materials),
        "material_names": sorted(materials),
        "bounds_min": [round(float(v), 5) for v in lows],
        "bounds_max": [round(float(v), 5) for v in highs],
        "bounds_size": [round(float(v), 5) for v in highs - lows],
    }


def close_enough(left, right, tolerance=0.003):
    return all(abs(float(a) - float(b)) <= tolerance for a, b in zip(left, right))


def build_variant(context: dict) -> dict:
    family = context["invariants"].get("family")
    if family not in BUILDERS:
        raise ValueError(f"unsupported Falkenwacht prop family: {family}")
    rng = random.Random(int(context["seed"]))
    output_dir = Path(context["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = output_dir / "source.blend"
    runtime_path = output_dir / "runtime.glb"

    reset_scene()
    BUILDERS[family](context["parameters"], rng)
    root = join_meshes(context["id"])
    root["family"] = family
    root["variant_id"] = context["id"]
    root["seed"] = int(context["seed"])
    root["archetype"] = str(context["parameters"].get("archetype", ""))
    bpy.context.view_layer.update()
    source_metrics = scene_metrics()
    if min(source_metrics["bounds_min"][2], 0) < -0.01:
        raise RuntimeError(f"geometry crosses below origin: {source_metrics['bounds_min'][2]}")
    if not all(obj.name.endswith("_nocol") for obj in bpy.context.scene.objects if obj.type == "MESH"):
        raise RuntimeError("every decorative mesh must end in _nocol")

    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(runtime_path), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
        export_extras=True, export_animations=False, export_materials="EXPORT",
    )

    # Actual roundtrip gate: clear Blender, import the GLB, then compare evaluated data.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(runtime_path))
    bpy.context.view_layer.update()
    imported_metrics = scene_metrics()
    mismatches = []
    if source_metrics["triangles"] != imported_metrics["triangles"]:
        mismatches.append(f"triangles {source_metrics['triangles']} != {imported_metrics['triangles']}")
    if source_metrics["materials"] != imported_metrics["materials"]:
        mismatches.append(f"materials {source_metrics['materials']} != {imported_metrics['materials']}")
    if not close_enough(source_metrics["bounds_size"], imported_metrics["bounds_size"]):
        mismatches.append(f"bounds {source_metrics['bounds_size']} != {imported_metrics['bounds_size']}")
    imported_names = [obj.name for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not imported_names or not all(name.endswith("_nocol") for name in imported_names):
        mismatches.append(f"collision naming lost: {imported_names}")
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
        ],
        "metrics": {
            "triangles": source_metrics["triangles"],
            "materials": source_metrics["materials"],
            "file_size_bytes": file_size,
            "mesh_objects": source_metrics["mesh_objects"],
            "roundtrip_import": True,
            "fingerprint": fingerprint,
        },
        "warnings": [],
        "metadata": {
            "family": family,
            "archetype": context["parameters"].get("archetype"),
            "seed": context["seed"],
            "source_bounds": source_metrics["bounds_size"],
            "roundtrip_bounds": imported_metrics["bounds_size"],
            "material_names": source_metrics["material_names"],
        },
    }
