#!/usr/bin/env python3
"""Shared deterministic Blender builders for the Eiffel historic prop batches.

The four thin family modules expose the object-batches interface. Contracts, manifests,
reports and contact sheets are written outside the product repository; only this reproducible
generator and the validated editable/runtime assets belong to the product tree.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


GENERATOR_VERSION = "1.0.0"

PALETTE = {
    "CastIron": ((0.035, 0.045, 0.048, 1.0), 0.72, 0.68, None),
    "IronWear": ((0.11, 0.075, 0.045, 1.0), 0.48, 0.84, None),
    "Bronze": ((0.23, 0.12, 0.055, 1.0), 0.72, 0.56, None),
    "Brass": ((0.42, 0.24, 0.07, 1.0), 0.78, 0.42, None),
    "Limestone": ((0.63, 0.59, 0.49, 1.0), 0.0, 0.92, None),
    "LimestoneDark": ((0.40, 0.38, 0.33, 1.0), 0.0, 0.96, None),
    "Wood": ((0.31, 0.13, 0.045, 1.0), 0.0, 0.78, None),
    "WoodLight": ((0.48, 0.25, 0.09, 1.0), 0.0, 0.82, None),
    "WoodRepair": ((0.20, 0.085, 0.025, 1.0), 0.0, 0.88, None),
    "Glass": ((0.72, 0.86, 0.88, 0.58), 0.0, 0.18, None),
    "LampGlow": ((1.0, 0.54, 0.16, 0.78), 0.0, 0.28, ((1.0, 0.25, 0.055, 1.0), 2.0)),
    "Soil": ((0.12, 0.055, 0.022, 1.0), 0.0, 1.0, None),
    "LeafDark": ((0.055, 0.15, 0.045, 1.0), 0.0, 0.91, None),
    "Leaf": ((0.12, 0.28, 0.075, 1.0), 0.0, 0.86, None),
    "LeafDry": ((0.31, 0.25, 0.09, 1.0), 0.0, 0.94, None),
    "PosterCream": ((0.72, 0.61, 0.39, 1.0), 0.0, 0.88, None),
    "PosterBlue": ((0.06, 0.18, 0.29, 1.0), 0.0, 0.82, None),
    "PosterRed": ((0.38, 0.055, 0.035, 1.0), 0.0, 0.86, None),
}

FAMILY_IDS = {
    "lamp": "eiffel-historic-lamp",
    "bench": "eiffel-historic-bench",
    "urn": "eiffel-historic-urn",
    "information": "eiffel-historic-information",
}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    if scene.world is None:
        scene.world = bpy.data.worlds.new("EiffelHistoricPropsWorld")
    scene.world.color = (0.045, 0.055, 0.065)


def material(name: str) -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    base, metallic, roughness, emission = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = base
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = base
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    if "Alpha" in node.inputs:
        node.inputs["Alpha"].default_value = base[3]
    if base[3] < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        mat.use_transparency_overlap = False
    if emission:
        color, strength = emission
        input_name = "Emission Color" if "Emission Color" in node.inputs else "Emission"
        node.inputs[input_name].default_value = color
        if "Emission Strength" in node.inputs:
            node.inputs["Emission Strength"].default_value = strength
    return mat


def finish(obj: bpy.types.Object, mat_name: str, bevel: float = 0.0) -> bpy.types.Object:
    obj.name = f"{obj.name}_nocol" if "_nocol" not in obj.name.lower() else obj.name
    obj.data.name = f"{obj.name}_mesh"
    obj.data.materials.append(material(mat_name))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("soft_worn_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["asset_role"] = "decorative-nocol"
    return obj


def box(name, location, size, mat_name, rotation=(0, 0, 0), bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(max(0.003, float(value)) * 0.5 for value in size)
    return finish(obj, mat_name, min(bevel, min(size) * 0.16))


def cylinder(name, location, radius, depth, mat_name, vertices=12, rotation=(0, 0, 0), bevel=0.018):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name, min(bevel, radius * 0.18))


def cone(name, location, radius1, radius2, depth, mat_name, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2,
                                   depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name, min(0.018, max(radius1, radius2) * 0.12))


def sphere(name, location, scale, mat_name, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return finish(obj, mat_name)


def torus(name, location, major_radius, minor_radius, mat_name, major_segments=16,
          minor_segments=6, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius,
                                    major_segments=major_segments, minor_segments=minor_segments,
                                    location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat_name)


def beam(name, start, end, radius, mat_name, vertices=8):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cylinder(name, (a + b) * 0.5, radius, delta.length, mat_name, vertices, bevel=radius * 0.12)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.rotation_mode = "XYZ"
    return obj


def prism(name, outline, depth, mat_name, y=0.0):
    vertices = [(x, y - depth * 0.5, z) for x, z in outline]
    vertices += [(x, y + depth * 0.5, z) for x, z in outline]
    count = len(outline)
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat_name, min(0.024, depth * 0.14))


def add_wear(rng, prefix, amount, radius, height):
    for index in range(max(0, round(amount * 4))):
        angle = rng.random() * math.tau
        x, y = math.cos(angle) * radius, math.sin(angle) * radius
        box(f"{prefix}_wear_{index}", (x, y, rng.uniform(0.08, max(0.1, height))),
            (0.05, 0.035, rng.uniform(0.08, 0.20)), "IronWear",
            rotation=(0, 0, angle), bevel=0.006)


def add_lantern(name, center, scale=1.0, ornate=False):
    x, y, z = center
    box(f"{name}_glass", (x, y, z), (0.44 * scale, 0.44 * scale, 0.66 * scale), "LampGlow", bevel=0.03)
    for sx in (-1, 1):
        for sy in (-1, 1):
            beam(f"{name}_frame_{sx}_{sy}", (x + sx * 0.24 * scale, y + sy * 0.24 * scale, z - 0.38 * scale),
                 (x + sx * 0.24 * scale, y + sy * 0.24 * scale, z + 0.38 * scale), 0.035 * scale, "CastIron", 6)
    box(f"{name}_base", (x, y, z - 0.39 * scale), (0.62 * scale, 0.62 * scale, 0.10 * scale), "CastIron")
    cone(f"{name}_roof", (x, y, z + 0.47 * scale), 0.44 * scale, 0.08 * scale,
         0.30 * scale, "CastIron", 8)
    if ornate:
        sphere(f"{name}_finial", (x, y, z + 0.68 * scale), (0.08 * scale,) * 3, "Brass", 10, 5)


def build_lamp(p, rng):
    style, height = p["archetype"], p["height"]
    shaft_top = height - 0.70
    base_radius = p["base_radius"]
    cylinder("foot", (0, 0, 0.12), base_radius, 0.24, "CastIron", 14)
    cone("plinth", (0, 0, 0.43), base_radius * 0.82, base_radius * 0.54, 0.48, "CastIron", 14)
    if style in {"fluted_single", "ornate_crown", "triple_candelabra"}:
        for angle in (0, math.tau / 3, 2 * math.tau / 3):
            beam(f"base_rib_{angle:.2f}", (math.cos(angle) * base_radius * 0.38, math.sin(angle) * base_radius * 0.38, 0.32),
                 (math.cos(angle) * 0.12, math.sin(angle) * 0.12, 1.18), 0.045, "Bronze", 6)
    if style == "bollard":
        shaft_top = height * 0.62
        cone("bollard_body", (0, 0, shaft_top * 0.5), 0.24, 0.16, shaft_top, "CastIron", 12)
        add_lantern("bollard_lantern", (0, 0, shaft_top + 0.38), 0.76, True)
    elif style == "paired_arch":
        spread = 0.72
        for side in (-1, 1):
            beam(f"arch_post_{side}", (side * spread, 0, 0.20), (side * spread, 0, shaft_top), 0.085, "CastIron", 10)
            beam(f"arch_slope_{side}", (side * spread, 0, shaft_top), (0, 0, height), 0.07, "CastIron", 10)
        add_lantern("arch_lantern", (0, 0, height - 0.44), 0.92, True)
    else:
        segments = 4 if style == "telescoping" else 2
        for index in range(segments):
            bottom = 0.62 + (shaft_top - 0.62) * index / segments
            top = 0.62 + (shaft_top - 0.62) * (index + 1) / segments
            radius = (0.14 - index * 0.018) if style == "telescoping" else (0.13 - index * 0.025)
            cylinder(f"shaft_{index}", (0, 0, (bottom + top) * 0.5), radius, top - bottom,
                     "CastIron", 12)
            if style == "telescoping":
                torus(f"shaft_ring_{index}", (0, 0, top), radius * 1.25, 0.035, "Bronze", 12, 5)
        if style in {"twin_crossbar", "triple_candelabra", "asymmetric_repair"}:
            left, right = (-0.80, 0.80) if style != "asymmetric_repair" else (-0.55, 1.0)
            beam("crossbar", (left, 0, shaft_top), (right, 0, shaft_top), 0.07, "CastIron", 8)
            for label, x in (("left", left), ("right", right)):
                beam(f"drop_{label}", (x, 0, shaft_top), (x, 0, shaft_top - 0.22), 0.045, "CastIron", 7)
                add_lantern(f"lantern_{label}", (x, 0, shaft_top - 0.62), 0.82, style == "triple_candelabra")
            if style == "triple_candelabra":
                add_lantern("lantern_top", (0, 0, height - 0.42), 0.72, True)
            if style == "asymmetric_repair":
                box("repair_clamp", (0.18, 0, shaft_top - 0.18), (0.32, 0.25, 0.16), "Brass")
        elif style in {"shepherd_hook", "weathered_hook"}:
            points = [Vector((0, 0, shaft_top - 0.2)), Vector((0.20, 0, shaft_top + 0.25)),
                      Vector((0.58, 0, shaft_top + 0.34)), Vector((0.78, 0, shaft_top + 0.05))]
            for index in range(len(points) - 1):
                beam(f"hook_{index}", points[index], points[index + 1], 0.065, "CastIron", 8)
            add_lantern("hook_lantern", (0.78, 0, shaft_top - 0.37), 0.84, False)
        else:
            add_lantern("top_lantern", (0, 0, height - 0.43), 0.90,
                        style in {"fluted_single", "ornate_crown"})
            if style == "ornate_crown":
                for side in (-1, 1):
                    beam(f"crown_scroll_{side}", (0, 0, shaft_top - 0.05),
                         (side * 0.43, 0, shaft_top + 0.18), 0.045, "Bronze", 7)
                    sphere(f"crown_tip_{side}", (side * 0.43, 0, shaft_top + 0.18), (0.07,) * 3, "Brass", 8, 4)
    add_wear(rng, "lamp", p["wear"], base_radius * 0.72, min(1.4, height * 0.3))


def add_bench_end(name, x, depth, height, style):
    if style in {"stone_end", "monumental"}:
        box(f"{name}_stone", (x, 0, height * 0.38), (0.30, depth, height * 0.76), "Limestone", bevel=0.045)
        return
    for y in (-depth * 0.34, depth * 0.34):
        beam(f"{name}_leg_{y:+.2f}", (x, y, 0.04), (x, y, height * 0.62), 0.065, "CastIron", 8)
    beam(f"{name}_runner", (x, -depth * 0.42, 0.05), (x, depth * 0.42, 0.05), 0.075, "CastIron", 8)
    if style in {"scroll_iron", "promenade", "arched_back"}:
        torus(f"{name}_scroll", (x, 0, height * 0.70), depth * 0.28, 0.045,
              "Bronze", 12, 5, rotation=(0, math.pi * 0.5, 0))


def build_bench(p, rng):
    style, width, depth = p["archetype"], p["width"], p["depth"]
    seat_height = p["seat_height"]
    end_style = style if style in {"stone_end", "monumental", "scroll_iron", "promenade", "arched_back"} else "plain"
    for side in (-1, 1):
        add_bench_end(f"end_{side}", side * width * 0.46, depth, seat_height + 0.55, end_style)
    slats = p["seat_slats"]
    for index in range(slats):
        y = -depth * 0.38 + index * depth * 0.76 / max(1, slats - 1)
        tone = "WoodRepair" if style == "repaired" and index == slats // 2 else "Wood"
        box(f"seat_slat_{index}", (0, y, seat_height), (width * 0.90, depth / (slats + 1), 0.085), tone, bevel=0.018)
    backless = style in {"backless", "double_sided"}
    if not backless:
        back_height = seat_height + (0.82 if style == "high_back" else 0.62)
        for side in (-1, 1):
            beam(f"back_post_{side}", (side * width * 0.42, depth * 0.34, seat_height - 0.05),
                 (side * width * 0.42, depth * 0.42, back_height + 0.14), 0.055, "CastIron", 7)
        back_slats = 5 if style == "high_back" else 3
        for index in range(back_slats):
            z = seat_height + 0.18 + index * (back_height - seat_height - 0.14) / max(1, back_slats - 1)
            if style == "arched_back":
                z += 0.10 * (1.0 - abs(index - (back_slats - 1) * 0.5) / max(1, back_slats * 0.5))
            box(f"back_slat_{index}", (0, depth * 0.40, z),
                (width * 0.84, 0.075, 0.095), "WoodLight" if index == back_slats - 1 else "Wood", bevel=0.018)
    if style == "double_sided":
        for side in (-1, 1):
            box(f"second_seat_{side}", (0, side * depth * 0.54, seat_height),
                (width * 0.84, depth * 0.32, 0.10), "Wood")
        box("central_rail", (0, 0, seat_height + 0.18), (width * 0.86, 0.10, 0.13), "CastIron")
    if style not in {"backless", "stone_end"}:
        for side in (-1, 1):
            beam(f"arm_{side}", (side * width * 0.41, -depth * 0.12, seat_height + 0.05),
                 (side * width * 0.41, depth * 0.23, seat_height + 0.36), 0.055, "CastIron", 7)
    if style == "asymmetric":
        beam("single_repair_brace", (-width * 0.46, -depth * 0.35, 0.08),
             (-width * 0.18, depth * 0.22, seat_height - 0.05), 0.055, "Brass", 7)
    for index in range(max(1, round(p["wear"] * 3))):
        x = rng.uniform(-width * 0.34, width * 0.34)
        box(f"wood_wear_{index}", (x, -depth * 0.39, seat_height + 0.047),
            (rng.uniform(0.08, 0.22), 0.025, 0.018), "WoodRepair", rotation=(0, 0, rng.uniform(-0.2, 0.2)), bevel=0.003)


def add_leaf_cluster(rng, radius, base_z, density, dryness):
    stem_count = max(3, density)
    for index in range(stem_count):
        angle = math.tau * index / stem_count + rng.uniform(-0.16, 0.16)
        length = rng.uniform(0.28, 0.55) * radius
        start = Vector((0, 0, base_z))
        end = Vector((math.cos(angle) * length, math.sin(angle) * length, base_z + rng.uniform(0.18, 0.38) * radius))
        beam(f"plant_stem_{index}", start, end, max(0.012, radius * 0.025), "LeafDark", 6)
        mat = "LeafDry" if rng.random() < dryness else "Leaf"
        sphere(f"plant_leaf_{index}", end, (radius * 0.18, radius * 0.08, radius * 0.28), mat, 8, 4)


def build_urn(p, rng):
    style, width, height = p["archetype"], p["width"], p["height"]
    radius = width * 0.5
    vertices = 4 if style in {"square", "trough"} else (8 if style in {"octagonal", "fluted"} else 14)
    if style == "trough":
        box("trough_foot", (0, 0, 0.12), (width * 1.15, width * 0.55, 0.24), "LimestoneDark", bevel=0.04)
        box("trough_body", (0, 0, height * 0.48), (width * 1.25, width * 0.64, height * 0.70), "Limestone", bevel=0.08)
        box("trough_rim", (0, 0, height * 0.83), (width * 1.38, width * 0.78, 0.15), "LimestoneDark", bevel=0.035)
        soil_radius = width * 0.42
    else:
        cylinder("foot", (0, 0, 0.10), radius * (0.72 if style != "pedestal" else 0.92), 0.20,
                 "LimestoneDark", vertices)
        pedestal_height = height * (0.32 if style in {"pedestal", "handled", "lidded"} else 0.18)
        cone("pedestal", (0, 0, 0.18 + pedestal_height * 0.5), radius * 0.60, radius * 0.42,
             pedestal_height, "Limestone", vertices)
        body_bottom = 0.18 + pedestal_height
        body_height = height - body_bottom - 0.18
        cone("vessel", (0, 0, body_bottom + body_height * 0.5), radius * 0.58,
             radius * (0.88 if style not in {"basin", "lidded"} else 1.02), body_height,
             "Limestone", vertices)
        torus("rim", (0, 0, height - 0.12), radius * (0.92 if style != "basin" else 1.08),
              max(0.045, radius * 0.10), "LimestoneDark", max(12, vertices), 5)
        soil_radius = radius * 0.72
        if style in {"handled", "volute"}:
            for side in (-1, 1):
                torus(f"handle_{side}", (side * radius * 0.88, 0, height * 0.66), radius * 0.30,
                      radius * 0.075, "LimestoneDark", 12, 5, rotation=(math.pi * 0.5, 0, 0))
        if style == "fluted":
            for index in range(8):
                angle = math.tau * index / 8
                beam(f"flute_{index}", (math.cos(angle) * radius * 0.60, math.sin(angle) * radius * 0.60, body_bottom + 0.08),
                     (math.cos(angle) * radius * 0.82, math.sin(angle) * radius * 0.82, height - 0.20),
                     radius * 0.035, "LimestoneDark", 6)
        if style == "lidded":
            cone("lid", (0, 0, height + 0.08), radius * 0.94, radius * 0.20, 0.28, "LimestoneDark", vertices)
            sphere("lid_finial", (0, 0, height + 0.29), (radius * 0.13,) * 3, "Bronze", 10, 5)
    if style != "lidded":
        cylinder("soil", (0, 0, height - 0.11), soil_radius, 0.08, "Soil", max(8, vertices), bevel=0)
        if p["foliage"]:
            add_leaf_cluster(rng, soil_radius, height - 0.05, p["leaf_density"], p["dryness"])
    if style in {"weathered", "repaired"}:
        beam("old_crack", (-radius * 0.34, -radius * 0.78, height * 0.32),
             (radius * 0.06, -radius * 0.84, height * 0.70), 0.018, "LimestoneDark", 5)
    if style == "repaired":
        torus("repair_band", (0, 0, height * 0.55), radius * 0.73, 0.035, "Bronze", 14, 5)


def add_poster_panel(name, center, size, color="PosterCream"):
    x, y, z = center
    box(f"{name}_paper", (x, y, z), size, color, bevel=0.012)
    stripe_width = size[0] * 0.11
    for index in (-1, 0, 1):
        box(f"{name}_graphic_{index}", (x + index * size[0] * 0.24, y - size[1] * 0.52, z),
            (stripe_width, 0.018, size[2] * (0.62 if index else 0.84)),
            "PosterRed" if index else "PosterBlue", bevel=0.003)


def add_arrow(name, z, length, direction=1):
    start = -length * 0.48 * direction
    end = length * 0.32 * direction
    beam(f"{name}_bar", (start, 0, z), (end, 0, z), 0.06, "CastIron", 7)
    tip = end + length * 0.20 * direction
    prism(f"{name}_tip", [(end - 0.02 * direction, z - 0.17), (tip, z),
                           (end - 0.02 * direction, z + 0.17)], 0.11, "Brass")


def build_information(p, rng):
    style, height, width = p["archetype"], p["height"], p["width"]
    if style.startswith("morris_"):
        radius = width * 0.5
        cylinder("morris_plinth", (0, 0, 0.14), radius * 1.18, 0.28, "LimestoneDark", 16)
        cylinder("morris_body", (0, 0, height * 0.48), radius, height * 0.78, "PosterCream", 18)
        for index, angle in enumerate((0, math.pi * 2 / 3, math.pi * 4 / 3)):
            center = (math.cos(angle) * (radius + 0.012), math.sin(angle) * (radius + 0.012), height * 0.50)
            box(f"poster_badge_{index}", center, (width * 0.22, 0.025, height * 0.42),
                "PosterBlue" if index % 2 else "PosterRed", rotation=(0, 0, angle), bevel=0.008)
        cone("morris_cap", (0, 0, height * 0.90), radius * 1.22, radius * 0.32,
             height * 0.18, "CastIron", 16)
        if style == "morris_clock":
            cylinder("clock_face", (0, -radius * 1.04, height * 0.77), radius * 0.34, 0.10,
                     "Glass", 16, rotation=(math.pi * 0.5, 0, 0))
            beam("clock_hand_a", (0, -radius * 1.10, height * 0.77), (radius * 0.18, -radius * 1.10, height * 0.88), 0.018, "CastIron", 5)
            beam("clock_hand_b", (0, -radius * 1.11, height * 0.77), (-radius * 0.08, -radius * 1.11, height * 0.60), 0.018, "CastIron", 5)
        elif style == "morris_open":
            box("service_hatch", (0, -radius * 1.04, height * 0.34), (width * 0.50, 0.06, height * 0.32), "CastIron", rotation=(0, 0, 0.10))
        else:
            torus("morris_crown", (0, 0, height * 0.97), radius * 0.38, 0.055, "Brass", 16, 5)
    elif style.startswith("signpost_"):
        cylinder("sign_foot", (0, 0, 0.12), 0.28, 0.24, "CastIron", 12)
        cylinder("sign_post", (0, 0, height * 0.48), 0.10, height * 0.82, "CastIron", 10)
        counts = {"signpost_single": 1, "signpost_double": 2, "signpost_multi": 3}[style]
        for index in range(counts):
            z = height * (0.64 + index * 0.11)
            direction = -1 if index % 2 else 1
            add_arrow(f"direction_{index}", z, width * (0.88 - index * 0.08), direction)
        sphere("sign_finial", (0, 0, height * 0.92), (0.13,) * 3, "Brass", 10, 5)
    else:
        board_bottom = height * (0.20 if style != "board_lectern" else 0.34)
        board_height = height * (0.58 if style != "board_lectern" else 0.38)
        spread = width * 0.42
        if style == "board_lectern":
            for side in (-1, 1):
                beam(f"lectern_leg_{side}", (side * spread, 0.25, 0.02),
                     (side * spread, 0, board_bottom + board_height * 0.5), 0.07, "CastIron", 8)
            box("lectern_panel", (0, 0, board_bottom + board_height * 0.5),
                (width, 0.12, board_height), "PosterCream", rotation=(math.radians(18), 0, 0), bevel=0.035)
        else:
            for side in (-1, 1):
                cylinder(f"board_post_{side}", (side * spread, 0, height * 0.42), 0.075, height * 0.84,
                         "CastIron", 8)
            add_poster_panel("board", (0, 0, board_bottom + board_height * 0.5),
                             (width, 0.10, board_height), "PosterCream")
            for z in (board_bottom, board_bottom + board_height):
                box(f"board_frame_{z:.2f}", (0, 0, z), (width * 1.08, 0.18, 0.08), "CastIron")
            if style == "board_gabled":
                prism("gabled_header", [(-width * 0.54, board_bottom + board_height),
                                         (0, height), (width * 0.54, board_bottom + board_height)],
                      0.18, "CastIron")
            elif style == "board_arched":
                torus("arched_header", (0, 0, board_bottom + board_height), width * 0.34, 0.06,
                      "Bronze", 16, 5, rotation=(math.pi * 0.5, 0, 0))
            elif style == "board_glazed":
                box("glass_cover", (0, -0.07, board_bottom + board_height * 0.5),
                    (width * 0.92, 0.025, board_height * 0.88), "Glass", bevel=0.01)
    add_wear(rng, "info", p["wear"], max(0.25, width * 0.28), min(1.1, height * 0.34))


BUILDERS = {
    "lamp": build_lamp,
    "bench": build_bench,
    "urn": build_urn,
    "information": build_information,
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
    minimum_z = min((root.matrix_world @ Vector(corner)).z for corner in root.bound_box)
    root.data.transform(Matrix.Translation((0, 0, -minimum_z)))
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    root["asset_role"] = "decorative-nocol"
    root["collision"] = "none"
    return root


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
        "bounds_min": [round(float(value), 5) for value in lows],
        "bounds_max": [round(float(value), 5) for value in highs],
        "bounds_size": [round(float(value), 5) for value in highs - lows],
        "cameras": sum(obj.type == "CAMERA" for obj in bpy.context.scene.objects),
        "lights": sum(obj.type == "LIGHT" for obj in bpy.context.scene.objects),
        "actions": len(bpy.data.actions),
    }


def close_enough(left, right, tolerance=0.004):
    return all(abs(float(a) - float(b)) <= tolerance for a, b in zip(left, right))


def build_family_variant(family: str, context: dict) -> dict:
    expected = FAMILY_IDS.get(family)
    if expected is None or context["invariants"].get("family") != family:
        raise ValueError(f"invalid Eiffel historic prop family: {family}")
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
    if source_metrics["bounds_min"][2] < -0.01:
        raise RuntimeError(f"geometry crosses below origin: {source_metrics['bounds_min'][2]}")
    if source_metrics["mesh_objects"] != 1 or not root.name.endswith("_nocol"):
        raise RuntimeError("runtime source must be one collision-free mesh")
    if source_metrics["cameras"] or source_metrics["lights"] or source_metrics["actions"]:
        raise RuntimeError("source contains an unexpected camera, light or animation")

    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(runtime_path), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
        export_extras=True, export_animations=False, export_materials="EXPORT",
    )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(runtime_path))
    bpy.context.view_layer.update()
    imported_metrics = scene_metrics()
    mismatches = []
    for metric in ("mesh_objects", "triangles", "materials", "cameras", "lights", "actions"):
        if source_metrics[metric] != imported_metrics[metric]:
            mismatches.append(f"{metric} {source_metrics[metric]} != {imported_metrics[metric]}")
    if not close_enough(source_metrics["bounds_size"], imported_metrics["bounds_size"]):
        mismatches.append(f"bounds {source_metrics['bounds_size']} != {imported_metrics['bounds_size']}")
    imported_names = [obj.name for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not imported_names or not all("_nocol" in name.lower() for name in imported_names):
        mismatches.append(f"collision naming lost: {imported_names}")
    if imported_metrics["bounds_min"][2] < -0.01:
        mismatches.append(f"ground contact lost: {imported_metrics['bounds_min'][2]}")
    if mismatches:
        raise RuntimeError("roundtrip mismatch: " + "; ".join(mismatches))

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
            "file_size_bytes": runtime_path.stat().st_size,
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
            "emissive_glass": family == "lamp",
            "transparent_glass": family in {"lamp", "information"},
        },
    }


COMMON = {
    "schema_version": 2,
    "contract_revision": 1,
    "lifecycle": {"state": "CONTRACT_LOCKED"},
    "count": 10,
    "sampling": {"mode": "coverage", "canonical_first": True},
    "invariants": {
        "units": "meters", "up_axis": "Z", "origin": "bottom-center",
        "style": "Paris circa 1900, stylized-realistic", "target": "CurviosClash desktop",
        "collision": "all decorative meshes named _nocol", "animation": "none",
    },
    "build_profile": {
        "renderer": "eevee", "target_engine": "CurviosClash GLB collection",
        "lod_policy": "single static runtime asset", "texture_policy": "shared procedural PBR materials",
    },
    "outputs": {"required_roles": ["editable", "runtime"], "editable_format": "blend", "runtime_format": "glb"},
    "qa": {
        "required_metrics": ["triangles", "materials", "file_size_bytes", "mesh_objects", "roundtrip_import"],
        "required_views": ["family-contact-sheet"], "roundtrip_import": True,
    },
}


def roles(archetypes):
    names = ["canonical", "compact", "tall", "wide", "ornate", "plain", "asymmetric", "repaired", "weathered", "long-range"]
    return [{"index": index + 1, "name": names[index], "overrides": {"archetype": archetype}}
            for index, archetype in enumerate(archetypes)]


def contract(family: str) -> dict:
    base = json.loads(json.dumps(COMMON))
    base["object_id"] = FAMILY_IDS[family]
    base["naming_pattern"] = "{object_id}-v{index:02d}"
    base["seed"] = {"lamp": 190004, "bench": 190118, "urn": 190227, "information": 190319}[family]
    base["invariants"]["family"] = family
    base["provenance"] = {
        "generator_id": f"eiffel-historic-{family}-generator",
        "generator_version": GENERATOR_VERSION,
        "blender_version": "4.2 LTS", "domain_skill": "blender-workflows",
    }
    if family == "lamp":
        archetypes = ["fluted_single", "bollard", "telescoping", "twin_crossbar", "ornate_crown",
                      "plain_single", "asymmetric_repair", "repaired_single", "weathered_hook", "triple_candelabra"]
        base["parameters"] = {
            "archetype": {"type": "choice", "values": archetypes, "canonical": archetypes[0]},
            "height": {"type": "float", "min": 2.6, "max": 5.4, "canonical": 4.2, "precision": 2, "strata_group": "scale"},
            "base_radius": {"type": "float", "min": 0.28, "max": 0.54, "canonical": 0.42, "precision": 2, "strata_group": "scale", "invert": True},
            "wear": {"type": "float", "min": 0.08, "max": 0.78, "canonical": 0.20, "precision": 2},
        }
        base["budgets"] = {"triangles_max": 6500, "materials_max": 7, "file_size_bytes_max": 900000, "mesh_objects_max": 1}
    elif family == "bench":
        archetypes = ["promenade", "backless", "high_back", "double_sided", "scroll_iron",
                      "plain", "asymmetric", "repaired", "stone_end", "arched_back"]
        base["parameters"] = {
            "archetype": {"type": "choice", "values": archetypes, "canonical": archetypes[0]},
            "width": {"type": "float", "min": 1.65, "max": 2.75, "canonical": 2.10, "precision": 2, "strata_group": "scale"},
            "depth": {"type": "float", "min": 0.52, "max": 0.92, "canonical": 0.70, "precision": 2},
            "seat_height": {"type": "float", "min": 0.42, "max": 0.50, "canonical": 0.46, "precision": 2},
            "seat_slats": {"type": "int", "min": 4, "max": 7, "canonical": 5},
            "wear": {"type": "float", "min": 0.08, "max": 0.82, "canonical": 0.22, "precision": 2},
        }
        base["budgets"] = {"triangles_max": 7000, "materials_max": 6, "file_size_bytes_max": 900000, "mesh_objects_max": 1}
    elif family == "urn":
        archetypes = ["round", "square", "pedestal", "trough", "handled", "octagonal", "volute", "repaired", "weathered", "fluted"]
        base["parameters"] = {
            "archetype": {"type": "choice", "values": archetypes, "canonical": archetypes[0]},
            "width": {"type": "float", "min": 0.75, "max": 1.65, "canonical": 1.10, "precision": 2, "strata_group": "scale"},
            "height": {"type": "float", "min": 0.72, "max": 1.72, "canonical": 1.15, "precision": 2, "strata_group": "scale", "invert": True},
            "foliage": {"type": "bool", "canonical": True},
            "leaf_density": {"type": "int", "min": 3, "max": 8, "canonical": 5},
            "dryness": {"type": "float", "min": 0.0, "max": 0.32, "canonical": 0.06, "precision": 2},
        }
        base["budgets"] = {"triangles_max": 8000, "materials_max": 7, "file_size_bytes_max": 950000, "mesh_objects_max": 1}
        base["provenance"]["domain_skill"] = "blender-plants"
    else:
        archetypes = ["morris_classic", "signpost_single", "board_gabled", "morris_clock", "board_glazed",
                      "board_plain", "signpost_multi", "board_lectern", "morris_open", "board_arched"]
        base["parameters"] = {
            "archetype": {"type": "choice", "values": archetypes, "canonical": archetypes[0]},
            "height": {"type": "float", "min": 1.65, "max": 3.75, "canonical": 3.0, "precision": 2, "strata_group": "scale"},
            "width": {"type": "float", "min": 0.72, "max": 2.20, "canonical": 1.35, "precision": 2, "strata_group": "scale", "invert": True},
            "wear": {"type": "float", "min": 0.06, "max": 0.76, "canonical": 0.18, "precision": 2},
        }
        base["budgets"] = {"triangles_max": 7500, "materials_max": 8, "file_size_bytes_max": 950000, "mesh_objects_max": 1}
    base["design_roles"] = roles(archetypes)
    return base


def write_contracts(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for family in FAMILY_IDS:
        family_dir = output_dir / family
        family_dir.mkdir(parents=True, exist_ok=True)
        path = family_dir / "object-contract.json"
        path.write_text(json.dumps(contract(family), indent=2) + "\n", encoding="utf-8")
        print(f"contract -> {path}")


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) == 2 and args[0] == "--write-contracts":
        write_contracts(Path(args[1]).resolve())
        return
    raise SystemExit("use -- --write-contracts <external-directory>")


if __name__ == "__main__":
    main()
