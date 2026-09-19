#!/usr/bin/env python3
"""Deterministic Kinetic Tide decorative cladding generators.

The four thin family entrypoints call ``build_variant_for_family``.  Every exported mesh is
static and ends in ``_nocol`` so Kinetic Tide's dynamic GLB collision mode can never turn the
cladding into gameplay geometry.  Preview renders and batch reports are intentionally directed
outside the product repository by the version-2 object contracts.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from math import atan2, cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector


STEEL = (0.028, 0.038, 0.052, 1.0)
PLATE = (0.075, 0.09, 0.11, 1.0)
BRONZE = (0.34, 0.17, 0.055, 1.0)
ORANGE = (1.0, 0.30, 0.018, 1.0)
CYAN = (0.018, 0.68, 0.76, 1.0)
WEAR = (0.018, 0.014, 0.012, 1.0)


def material(name, color, *, metallic, roughness, emission=0.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    metallic_input = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission
    return value


def build_materials():
    return {
        "steel": material("KineticTide_Steel", STEEL, metallic=0.88, roughness=0.34),
        "plate": material("KineticTide_Plate", PLATE, metallic=0.74, roughness=0.48),
        "bronze": material("KineticTide_Bronze", BRONZE, metallic=0.9, roughness=0.3),
        "orange": material("KineticTide_WarningOrange", ORANGE, metallic=0.2, roughness=0.28, emission=1.25),
        "cyan": material("KineticTide_CyanSignal", CYAN, metallic=0.16, roughness=0.24, emission=1.35),
        "wear": material("KineticTide_WearDark", WEAR, metallic=0.42, roughness=0.72),
    }


def reset_scene(variant_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = variant_id
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("KineticTideWorld")
    scene.world.color = (0.012, 0.016, 0.023)
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def finish_mesh(obj, name, mat):
    stable = name if name.endswith("_nocol") else f"{name}_nocol"
    obj.name = stable
    obj.data.name = f"{stable}_mesh"
    obj.data.materials.append(mat)
    return obj


def box(name, center, size, mat, rotation=(0.0, 0.0, 0.0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=center, rotation=rotation)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new(name="EdgeWear", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.limit_method = "ANGLE"
    return obj


def cylinder(name, center, radius, depth, mat, *, vertices=12, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation
    )
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, center, scale, mat, *, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def torus(name, center, major_radius, minor_radius, mat, *, major_segments=32, minor_segments=6):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=center,
        rotation=(pi / 2, 0.0, 0.0),
    )
    return finish_mesh(bpy.context.object, name, mat)


def beam_between(name, start, end, thickness, depth, mat, bevel=0.0):
    start_v = Vector(start)
    end_v = Vector(end)
    delta = end_v - start_v
    center = (start_v + end_v) * 0.5
    length = (delta.x * delta.x + delta.z * delta.z) ** 0.5
    angle = -atan2(delta.z, delta.x)
    return box(name, center, (length, depth, thickness), mat, rotation=(0.0, angle, 0.0), bevel=bevel)


def front_bolt(name, x, z, y, radius, length, mat):
    return cylinder(name, (x, y, z), radius, length, mat, vertices=10, rotation=(pi / 2, 0.0, 0.0))


def add_hazard_bar(prefix, center, width, depth, mat, *, stripes=5, vertical=False):
    result = []
    stripe_width = width / max(1, stripes)
    for index in range(stripes):
        if vertical:
            location = (center[0], center[1], center[2] - width * 0.5 + stripe_width * (index + 0.5))
            size = (0.09, depth, stripe_width * 0.72)
            rotation = (0.0, 0.0, -0.42 if index % 2 == 0 else 0.42)
        else:
            location = (center[0] - width * 0.5 + stripe_width * (index + 0.5), center[1], center[2])
            size = (stripe_width * 0.72, depth, 0.11)
            rotation = (0.0, -0.42 if index % 2 == 0 else 0.42, 0.0)
        result.append(box(f"{prefix}_stripe_{index}", location, size, mat, rotation=rotation))
    return result


def build_machine_frame(parameters, mats, rng):
    width = float(parameters["width"])
    height = float(parameters["height"])
    depth = float(parameters["depth"])
    beam = float(parameters["beam_thickness"])
    front_y = -(depth * 0.5 + 0.035)
    post_x = width * 0.5 - beam * 0.5
    box("frame_left_post", (-post_x, 0, height * 0.5), (beam, depth, height), mats["plate"], bevel=0.07)
    box("frame_right_post", (post_x, 0, height * 0.5), (beam, depth, height), mats["plate"], bevel=0.07)
    box("frame_header", (0, 0, height - beam * 0.5), (width, depth, beam), mats["steel"], bevel=0.08)

    style = parameters["brace_style"]
    if style == "gusset":
        for side in (-1, 1):
            beam_between(
                f"frame_gusset_{side}",
                (side * (post_x - beam * 0.15), 0, height - beam * 2.8),
                (side * (post_x - beam * 2.5), 0, height - beam * 0.7),
                beam * 0.42, depth * 0.84, mats["bronze"], 0.035,
            )
    elif style == "arched":
        for side in (-1, 1):
            beam_between(
                f"frame_arch_knee_{side}",
                (side * (post_x - beam * 0.1), 0, height - beam * 3.8),
                (side * width * 0.23, 0, height - beam * 0.75),
                beam * 0.38, depth * 0.75, mats["bronze"], 0.03,
            )
        box("frame_arch_crown", (0, 0, height - beam * 1.22), (width * 0.36, depth * 0.78, beam * 0.26), mats["bronze"], bevel=0.03)
    elif style == "split-rail":
        box("frame_upper_rail", (0, 0, height + beam * 0.52), (width * 0.72, depth * 0.62, beam * 0.34), mats["bronze"], bevel=0.04)
        for side in (-1, 1):
            box(f"frame_side_rail_{side}", (side * (post_x + beam * 0.54), 0, height * 0.57), (beam * 0.34, depth * 0.74, height * 0.56), mats["bronze"], bevel=0.03)
    else:
        for side in (-1, 1):
            beam_between(
                f"frame_buttress_{side}",
                (side * (post_x + beam * 0.12), 0, beam * 0.35),
                (side * (post_x + beam * 2.3), 0, height * 0.36),
                beam * 0.6, depth * 1.05, mats["steel"], 0.045,
            )

    mount = parameters["mount_style"]
    if mount == "footplates":
        for side in (-1, 1):
            box(f"frame_footplate_{side}", (side * post_x, 0, beam * 0.12), (beam * 2.4, depth * 1.38, beam * 0.24), mats["bronze"], bevel=0.03)
    elif mount == "side-lugs":
        for side in (-1, 1):
            for level in (0.3, 0.72):
                box(f"frame_side_lug_{side}_{level}", (side * (post_x + beam * 0.88), 0, height * level), (beam * 1.25, depth * 1.18, beam * 0.54), mats["bronze"], bevel=0.03)
    else:
        for side in (-1, 1):
            box(f"frame_ceiling_clamp_{side}", (side * width * 0.34, 0, height + beam * 0.5), (beam * 1.1, depth * 1.24, beam), mats["bronze"], bevel=0.04)

    bolt_count = int(parameters["bolt_count"])
    for index in range(bolt_count):
        side = -1 if index % 2 == 0 else 1
        level_index = index // 2
        z = beam * 0.9 + (height - beam * 1.8) * ((level_index + 0.5) / max(1, (bolt_count + 1) // 2))
        front_bolt(f"frame_fastener_{index}", side * post_x, z, front_y, beam * 0.11, depth * 0.18, mats["bronze"])

    add_hazard_bar("frame_header_warning", (0, front_y - 0.025, height - beam * 0.48), width * 0.46, 0.07, mats["orange"], stripes=5)
    if parameters["asymmetry"]:
        box("frame_asymmetric_drive_box", (-post_x - beam * 0.82, 0, height * 0.64), (beam * 1.34, depth * 1.42, beam * 2.3), mats["steel"], bevel=0.06)
        cylinder("frame_asymmetric_drive_cap", (-post_x - beam * 0.82, front_y, height * 0.64), beam * 0.42, depth * 0.16, mats["bronze"], vertices=12, rotation=(pi / 2, 0, 0))
    if parameters["repair_patch"]:
        patch_side = -1 if rng.random() < 0.5 else 1
        box("frame_renewed_patch", (patch_side * post_x, front_y - 0.03, height * 0.44), (beam * 1.42, 0.08, height * 0.22), mats["bronze"], bevel=0.02)
        for offset in (-0.22, 0.22):
            front_bolt(f"frame_patch_bolt_{offset}", patch_side * post_x + offset * beam, height * 0.44, front_y - 0.09, beam * 0.09, 0.12, mats["cyan"])

    wear = parameters["wear_level"]
    scars = {"service": 1, "working": 2, "heavy": 4}[wear]
    for index in range(scars):
        side = -1 if index % 2 == 0 else 1
        z = height * (0.2 + 0.15 * index)
        box(f"frame_vertical_abrasion_{index}", (side * post_x, front_y - 0.055, z), (beam * 0.2, 0.035, height * 0.12), mats["wear"])


def build_bearing_flange(parameters, mats, rng):
    outer = float(parameters["outer_radius"])
    width = float(parameters["ring_width"])
    depth = float(parameters["depth"])
    center_z = outer
    main_minor = width * 0.5
    torus("flange_outer_body", (0, 0, center_z), outer - main_minor, main_minor, mats["plate"], major_segments=40)
    torus("flange_bronze_seat", (0, -depth * 0.16, center_z), outer - width * 1.15, width * 0.18, mats["bronze"], major_segments=36)
    torus("flange_grease_seam", (0, -(depth * 0.28 + 0.04), center_z), outer - width * 1.45, width * 0.10, mats["wear"], major_segments=36, minor_segments=5)

    bolt_count = int(parameters["bolt_count"])
    bolt_radius = max(0.11, width * 0.16)
    bolt_ring = outer - width * 0.52
    front_y = -(max(depth, width) * 0.52 + bolt_radius * 0.3)
    for index in range(bolt_count):
        angle = index * 2 * pi / bolt_count
        tone = mats["cyan"] if parameters["replacement_bolts"] and index in (1, bolt_count // 2 + 1) else mats["bronze"]
        front_bolt(
            f"flange_radial_bolt_{index}",
            bolt_ring * cos(angle),
            center_z + bolt_ring * sin(angle),
            front_y,
            bolt_radius,
            depth * 0.34,
            tone,
        )

    style = parameters["housing_style"]
    clamp_count = int(parameters["clamp_count"])
    if style == "split-bearing":
        box("flange_split_cap", (0, 0, center_z + outer - width * 0.32), (outer * 1.22, depth * 1.18, width * 0.5), mats["steel"], bevel=0.04)
        box("flange_split_key", (0, front_y - 0.02, center_z + outer - width * 0.3), (width * 0.34, 0.07, width * 0.8), mats["orange"])
    elif style == "ribbed":
        for index in range(clamp_count):
            angle = index * 2 * pi / clamp_count
            start_r = outer + width * 0.05
            end_r = outer + width * 0.78
            beam_between(
                f"flange_radial_rib_{index}",
                (start_r * cos(angle), 0, center_z + start_r * sin(angle)),
                (end_r * cos(angle), 0, center_z + end_r * sin(angle)),
                width * 0.3, depth * 0.86, mats["steel"], 0.025,
            )
    elif style == "clamp-crown":
        for index in range(clamp_count):
            angle = index * 2 * pi / clamp_count
            r = outer + width * 0.24
            box(
                f"flange_crown_clamp_{index}",
                (r * cos(angle), 0, center_z + r * sin(angle)),
                (width * 0.68, depth * 1.26, width * 0.82),
                mats["steel"],
                rotation=(0.0, -angle, 0.0),
                bevel=0.035,
            )
    else:
        for index in range(max(2, clamp_count // 2)):
            angle = index * 2 * pi / max(2, clamp_count // 2)
            r = outer + width * 0.16
            box(f"flange_mount_tab_{index}", (r * cos(angle), 0, center_z + r * sin(angle)), (width * 0.72, depth, width * 0.5), mats["steel"], rotation=(0, -angle, 0), bevel=0.03)

    if parameters["asymmetry"]:
        box("flange_asymmetric_oiler", (-outer * 0.72, -depth * 0.24, center_z + outer * 0.72), (width * 0.72, depth * 1.3, width * 1.25), mats["bronze"], bevel=0.035)
        cylinder("flange_oiler_cap", (-outer * 0.72, front_y, center_z + outer * 0.9), width * 0.22, depth * 0.35, mats["cyan"], vertices=10, rotation=(pi / 2, 0, 0))

    wear = parameters["wear_level"]
    marks = {"service": 1, "working": 2, "heavy": 4}[wear]
    for index in range(marks):
        angle = (-0.72 + index * 0.42) * pi
        r = outer - width * 1.22
        box(
            f"flange_rotational_abrasion_{index}",
            (r * cos(angle), front_y - 0.045, center_z + r * sin(angle)),
            (width * 0.55, 0.035, width * 0.13),
            mats["wear"],
            rotation=(0.0, -angle, 0.0),
        )


def build_warning_beacon(parameters, mats, rng):
    height = float(parameters["height"])
    width = float(parameters["base_width"])
    signal_count = int(parameters["signal_count"])
    guard_count = int(parameters["guard_count"])
    mount = parameters["mount_style"]
    signal_mat = mats["orange"] if parameters["emission_tone"] == "amber" else mats["cyan"]

    if mount == "floor-pedestal":
        box("beacon_floor_foot", (0, 0, width * 0.09), (width * 1.45, width, width * 0.18), mats["steel"], bevel=0.04)
        cylinder("beacon_pedestal", (0, 0, height * 0.34), width * 0.28, height * 0.58, mats["plate"], vertices=12)
    elif mount == "wall-bracket":
        box("beacon_wall_backplate", (0, width * 0.28, height * 0.42), (width * 1.2, width * 0.18, height * 0.82), mats["steel"], bevel=0.04)
        beam_between("beacon_wall_arm", (0, width * 0.22, height * 0.36), (0, 0, height * 0.62), width * 0.22, width * 0.24, mats["bronze"], 0.025)
    else:
        box("beacon_gantry_clamp", (0, 0, width * 0.16), (width * 1.5, width * 0.9, width * 0.32), mats["steel"], bevel=0.05)
        for side in (-1, 1):
            box(f"beacon_clamp_jaw_{side}", (side * width * 0.56, 0, width * 0.42), (width * 0.18, width, width * 0.52), mats["bronze"], bevel=0.025)

    stack_bottom = max(width * 0.52, height * 0.55)
    available = max(width * 0.75, height - stack_bottom - width * 0.18)
    lens_height = available / signal_count
    for index in range(signal_count):
        z = stack_bottom + lens_height * (index + 0.5)
        cylinder(f"beacon_lens_{index}", (0, -width * 0.03, z), width * 0.32, lens_height * 0.56, signal_mat, vertices=16)
        torus(f"beacon_lens_band_{index}", (0, 0, z), width * 0.36, width * 0.055, mats["bronze"], major_segments=20, minor_segments=5)

    cage_style = parameters["cage_style"]
    cage_bottom = stack_bottom - lens_height * 0.06
    cage_height = available + lens_height * 0.12
    if cage_style in ("vertical-bars", "split-cage"):
        for index in range(guard_count):
            angle = index * 2 * pi / guard_count
            if cage_style == "split-cage" and index == 0:
                continue
            cylinder(
                f"beacon_guard_bar_{index}",
                (width * 0.43 * cos(angle), width * 0.43 * sin(angle), cage_bottom + cage_height * 0.5),
                width * 0.045,
                cage_height,
                mats["bronze"],
                vertices=8,
            )
    else:
        hoop_count = max(2, guard_count // 2)
        for index in range(hoop_count):
            z = cage_bottom + cage_height * (index / max(1, hoop_count - 1))
            torus(f"beacon_guard_hoop_{index}", (0, 0, z), width * 0.43, width * 0.05, mats["bronze"], major_segments=18, minor_segments=5)
    if cage_style == "hooded":
        box("beacon_signal_hood", (0, -width * 0.2, height - width * 0.03), (width * 1.05, width * 0.86, width * 0.18), mats["steel"], rotation=(0.16, 0, 0), bevel=0.04)

    add_hazard_bar("beacon_hazard", (0, -width * 0.52, width * 0.28), width * 0.92, 0.05, mats["orange"], stripes=4)
    if parameters["asymmetry"]:
        box("beacon_asymmetric_shield", (-width * 0.55, 0, height * 0.72), (width * 0.22, width * 0.92, height * 0.38), mats["steel"], rotation=(0, 0, -0.12), bevel=0.035)
    if parameters["repair_plate"]:
        box("beacon_renewed_service_plate", (width * 0.34, -width * 0.46, height * 0.34), (width * 0.42, 0.07, height * 0.2), mats["bronze"], bevel=0.02)
        front_bolt("beacon_repair_fastener", width * 0.34, height * 0.34, -width * 0.52, width * 0.06, 0.11, mats["cyan"])

    wear = parameters["wear_level"]
    stains = {"service": 1, "working": 2, "heavy": 3}[wear]
    for index in range(stains):
        box(f"beacon_base_corrosion_{index}", (-width * 0.32 + index * width * 0.28, -width * 0.51, width * (0.12 + 0.07 * index)), (width * 0.18, 0.035, width * 0.1), mats["wear"])


def build_maintenance_panel(parameters, mats, rng):
    width = float(parameters["width"])
    height = float(parameters["height"])
    depth = float(parameters["depth"])
    front_y = -(depth * 0.5 + 0.025)
    box("panel_backplate", (0, 0, height * 0.5), (width, depth, height), mats["steel"], bevel=min(0.08, depth * 0.22))
    inset = min(width, height) * 0.1
    style = parameters["hatch_style"]
    if style == "split-door":
        for side in (-1, 1):
            box(f"panel_split_door_{side}", (side * width * 0.235, front_y - 0.03, height * 0.53), (width * 0.43, depth * 0.22, height * 0.72), mats["plate"], bevel=0.045)
    else:
        door_depth = depth * (0.18 if style == "recessed" else 0.34)
        box("panel_service_door", (0, front_y - door_depth * 0.45, height * 0.53), (width - inset * 1.2, door_depth, height * 0.72), mats["plate"], bevel=0.05)
        if style == "raised-rib":
            for side in (-1, 1):
                box(f"panel_raised_rib_{side}", (side * width * 0.25, front_y - depth * 0.22, height * 0.53), (width * 0.08, depth * 0.16, height * 0.64), mats["bronze"], bevel=0.025)

    hinge = parameters["hinge_side"]
    if hinge == "top":
        for offset in (-0.25, 0.25):
            cylinder(f"panel_top_hinge_{offset}", (width * offset, front_y - depth * 0.2, height * 0.89), depth * 0.12, width * 0.28, mats["bronze"], vertices=10, rotation=(0, pi / 2, 0))
    else:
        side = -1 if hinge == "left" else 1
        for level in (0.35, 0.7):
            cylinder(f"panel_side_hinge_{level}", (side * width * 0.43, front_y - depth * 0.2, height * level), depth * 0.13, height * 0.18, mats["bronze"], vertices=10)

    fasteners = int(parameters["fastener_count"])
    for index in range(fasteners):
        phase = index / fasteners
        if phase < 0.25:
            x = -width * 0.4 + width * 0.8 * (phase / 0.25)
            z = height * 0.12
        elif phase < 0.5:
            x = width * 0.4
            z = height * (0.12 + 0.76 * ((phase - 0.25) / 0.25))
        elif phase < 0.75:
            x = width * (0.4 - 0.8 * ((phase - 0.5) / 0.25))
            z = height * 0.88
        else:
            x = -width * 0.4
            z = height * (0.88 - 0.76 * ((phase - 0.75) / 0.25))
        front_bolt(f"panel_fastener_{index}", x, z, front_y - depth * 0.2, max(0.055, depth * 0.17), depth * 0.22, mats["bronze"])

    vent_count = int(parameters["vent_count"])
    for index in range(vent_count):
        z = height * (0.36 + index * 0.065)
        box(f"panel_vent_{index}", (width * 0.17, front_y - depth * 0.22, z), (width * 0.34, 0.045, max(0.04, height * 0.022)), mats["wear"])

    stripe = parameters["stripe_layout"]
    if stripe == "lower-edge":
        add_hazard_bar("panel_lower_warning", (0, front_y - depth * 0.24, height * 0.14), width * 0.62, 0.045, mats["orange"], stripes=5)
    elif stripe == "side-edge":
        add_hazard_bar("panel_side_warning", (-width * 0.38, front_y - depth * 0.24, height * 0.52), height * 0.54, 0.045, mats["orange"], stripes=5, vertical=True)
    elif stripe == "corner-pair":
        add_hazard_bar("panel_left_corner_warning", (-width * 0.27, front_y - depth * 0.24, height * 0.16), width * 0.22, 0.045, mats["orange"], stripes=2)
        add_hazard_bar("panel_right_corner_warning", (width * 0.27, front_y - depth * 0.24, height * 0.16), width * 0.22, 0.045, mats["orange"], stripes=2)
    else:
        for index in range(4):
            box(f"panel_diagonal_warning_{index}", (-width * 0.28 + index * width * 0.18, front_y - depth * 0.24, height * 0.22 + index * height * 0.1), (width * 0.22, 0.045, height * 0.055), mats["orange"], rotation=(0, 0.62, 0))

    conduit = parameters["conduit_side"]
    if conduit != "none":
        side = -1 if conduit == "left" else 1
        cylinder("panel_service_conduit", (side * width * 0.56, 0, height * 0.48), depth * 0.26, height * 0.72, mats["bronze"], vertices=10)
        box("panel_conduit_junction", (side * width * 0.56, front_y, height * 0.83), (depth * 0.72, depth * 0.72, depth * 0.72), mats["steel"], bevel=0.03)

    if parameters["asymmetry"]:
        box("panel_asymmetric_meter", (-width * 0.24, front_y - depth * 0.25, height * 0.72), (width * 0.28, 0.06, height * 0.18), mats["bronze"], bevel=0.025)
        box("panel_meter_signal", (-width * 0.24, front_y - depth * 0.29, height * 0.72), (width * 0.12, 0.035, height * 0.07), mats["cyan"])
    if parameters["repair_patch"]:
        patch_x = width * (-0.24 if rng.random() < 0.5 else 0.24)
        box("panel_renewed_patch", (patch_x, front_y - depth * 0.25, height * 0.48), (width * 0.26, 0.07, height * 0.28), mats["bronze"], bevel=0.02)

    wear = parameters["wear_level"]
    marks = {"service": 1, "working": 2, "heavy": 4}[wear]
    for index in range(marks):
        box(f"panel_hinge_streak_{index}", (-width * 0.38 + index * width * 0.18, front_y - depth * 0.29, height * (0.28 + 0.1 * index)), (width * 0.05, 0.025, height * 0.18), mats["wear"])


BUILDERS = {
    "machine-frame": build_machine_frame,
    "bearing-flange": build_bearing_flange,
    "warning-beacon": build_warning_beacon,
    "maintenance-panel": build_maintenance_panel,
}


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def batch_meshes_by_material(variant_id):
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("generated scene has no meshes")
    for obj in meshes:
        apply_modifiers(obj)
    grouped = {}
    for obj in meshes:
        material_name = obj.material_slots[0].material.name if obj.material_slots and obj.material_slots[0].material else "unassigned"
        grouped.setdefault(material_name, []).append(obj)

    roots = []
    for material_name, group in sorted(grouped.items()):
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        root = bpy.context.object
        material_slug = re.sub(r"[^a-z0-9]+", "-", material_name.lower()).strip("-")
        material_slug = material_slug.removeprefix("kinetictide-")
        root.name = f"{variant_id}_{material_slug}_nocol"
        root.data.name = f"{variant_id}_{material_slug}_mesh"
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
        root.rotation_euler = (0.0, 0.0, 0.0)
        root.scale = (1.0, 1.0, 1.0)
        roots.append(root)

    bpy.context.view_layer.update()
    corners = [root.matrix_world @ Vector(corner) for root in roots for corner in root.bound_box]
    low = Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners)))
    high = Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners)))
    shift = Vector((-(low.x + high.x) * 0.5, -(low.y + high.y) * 0.5, -low.z))
    for root in roots:
        for vertex in root.data.vertices:
            vertex.co += shift
        root.data.update()
    return roots


def principled_value(material_value, socket_names, default=0.0):
    shader = material_value.node_tree.nodes.get("Principled BSDF") if material_value.use_nodes else None
    if shader:
        for socket_name in socket_names:
            socket = shader.inputs.get(socket_name)
            if socket is not None:
                value = socket.default_value
                if hasattr(value, "__len__") and not isinstance(value, str):
                    return [round(float(component), 5) for component in value]
                return round(float(value), 5)
    return default


def material_metrics(material_value):
    emission_color = principled_value(material_value, ("Emission Color", "Emission"), [0, 0, 0, 1])
    emission_strength = principled_value(material_value, ("Emission Strength",), 0.0)
    return {
        "name": material_value.name,
        "base_color": principled_value(material_value, ("Base Color",), [0, 0, 0, 1]),
        "metallic": principled_value(material_value, ("Metallic IOR Level", "Metallic")),
        "roughness": principled_value(material_value, ("Roughness",)),
        "emission_color": emission_color,
        "emission_strength": emission_strength,
        "effective_emission": [round(float(component) * float(emission_strength), 5) for component in emission_color[:3]],
    }


def scene_metrics():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    lows = Vector((float("inf"), float("inf"), float("inf")))
    highs = Vector((float("-inf"), float("-inf"), float("-inf")))
    triangles = 0
    material_values = {}
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            for slot in obj.material_slots:
                if slot.material:
                    material_values[slot.material.name] = slot.material
            for corner in obj.bound_box:
                point = obj.matrix_world @ Vector(corner)
                for axis in range(3):
                    lows[axis] = min(lows[axis], point[axis])
                    highs[axis] = max(highs[axis], point[axis])
        finally:
            evaluated.to_mesh_clear()
    if not meshes:
        raise RuntimeError("scene contains no mesh objects")
    return {
        "objects": len([obj for obj in bpy.context.scene.objects if obj.type not in {"CAMERA", "LIGHT"}]),
        "mesh_objects": len(meshes),
        "triangles": triangles,
        "materials": len(material_values),
        "material_values": [material_metrics(material_values[name]) for name in sorted(material_values)],
        "bounds_min": [round(float(value), 5) for value in lows],
        "bounds_max": [round(float(value), 5) for value in highs],
        "bounds_size": [round(float(value), 5) for value in highs - lows],
        "origin": [round(float(value), 5) for value in meshes[0].location],
        "rotation": [round(float(value), 5) for value in meshes[0].rotation_euler],
        "scale": [round(float(value), 5) for value in meshes[0].scale],
        "mesh_names": sorted(obj.name for obj in meshes),
        "actions": len(bpy.data.actions),
        "cameras": len(bpy.data.cameras),
        "lights": len(bpy.data.lights),
    }


def close_enough(left, right, tolerance=0.006):
    if isinstance(left, list) and left and isinstance(left[0], dict):
        if len(left) != len(right):
            return False
        for left_entry, right_entry in zip(left, right):
            if left_entry["name"] != right_entry["name"]:
                return False
            for key in ("metallic", "roughness"):
                if abs(float(left_entry[key]) - float(right_entry[key])) > tolerance:
                    return False
            # glTF may normalize emissive color and strength separately through
            # KHR_materials_emissive_strength.  Their product is the rendered emission.
            for key in ("base_color", "effective_emission"):
                if not close_enough(left_entry[key], right_entry[key], tolerance):
                    return False
        return True
    return len(left) == len(right) and all(abs(float(a) - float(b)) <= tolerance for a, b in zip(left, right))


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(destination, family):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    fixed_scales = {
        "machine-frame": 15.5,
        "bearing-flange": 14.5,
        "warning-beacon": 6.8,
        "maintenance-panel": 8.2,
    }
    floor_size = fixed_scales[family] * 1.2
    floor = box("preview_floor", (0, 0, -0.06), (floor_size, floor_size, 0.12), bpy.data.materials["KineticTide_WearDark"])
    floor.hide_render = False
    bpy.ops.object.camera_add(location=(10.5, -14.0, 9.5))
    camera = bpy.context.object
    camera.name = "preview_camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = fixed_scales[family]
    look_at(camera, (0, 0, fixed_scales[family] * 0.27))
    scene.camera = camera
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(destination)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(floor, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)


def build_variant_for_family(context, family):
    if context["invariants"].get("family") != family:
        raise ValueError(f"contract family {context['invariants'].get('family')} does not match {family}")
    rng = random.Random(int(context["seed"]))
    output_dir = Path(context["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = output_dir / "source.blend"
    runtime_path = output_dir / "runtime.glb"
    preview_dir = Path(context["build_profile"]["preview_directory"])
    preview_dir.mkdir(parents=True, exist_ok=True)
    preview_path = preview_dir / f"{context['id']}.png"

    reset_scene(context["id"])
    mats = build_materials()
    BUILDERS[family](context["parameters"], mats, rng)
    roots = batch_meshes_by_material(context["id"])
    for root in roots:
        root["family"] = family
        root["variant_id"] = context["id"]
        root["seed"] = int(context["seed"])
        root["design_role"] = context["role"]
        root["collision_role"] = "decorative-nocol"
    bpy.context.view_layer.update()
    source_metrics = scene_metrics()
    if abs(source_metrics["bounds_min"][2]) > 0.012:
        raise RuntimeError(f"bottom-center origin failed: min z {source_metrics['bounds_min'][2]}")
    if source_metrics["objects"] != source_metrics["materials"] or source_metrics["mesh_objects"] != source_metrics["materials"]:
        raise RuntimeError(f"expected one mesh per material, got {source_metrics['objects']} objects and {source_metrics['materials']} materials")
    if not all("_nocol" in name for name in source_metrics["mesh_names"]):
        raise RuntimeError(f"decorative naming failed: {source_metrics['mesh_names']}")
    if source_metrics["actions"] or source_metrics["cameras"] or source_metrics["lights"]:
        raise RuntimeError("source scene unexpectedly contains animation, cameras, or lights")

    bpy.ops.wm.save_as_mainfile(filepath=str(source_path), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    for root in roots:
        root.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]
    bpy.ops.export_scene.gltf(
        filepath=str(runtime_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=False,
        export_materials="EXPORT",
    )
    render_preview(preview_path, family)

    # Real roundtrip: the source scene is discarded, then the exported GLB is imported into
    # a factory-empty Blender file and compared semantically.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(runtime_path))
    bpy.context.view_layer.update()
    imported_metrics = scene_metrics()
    mismatches = []
    for key in ("objects", "mesh_objects", "triangles", "materials", "actions", "cameras", "lights"):
        if source_metrics[key] != imported_metrics[key]:
            mismatches.append(f"{key} {source_metrics[key]} != {imported_metrics[key]}")
    for key in ("bounds_size", "origin", "rotation", "scale"):
        if not close_enough(source_metrics[key], imported_metrics[key]):
            mismatches.append(f"{key} {source_metrics[key]} != {imported_metrics[key]}")
    if not close_enough(source_metrics["material_values"], imported_metrics["material_values"], 0.025):
        mismatches.append("PBR or emission material values changed")
    if not imported_metrics["mesh_names"] or not all("_nocol" in name for name in imported_metrics["mesh_names"]):
        mismatches.append(f"collision naming lost: {imported_metrics['mesh_names']}")
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
            "objects": source_metrics["objects"],
            "mesh_objects": source_metrics["mesh_objects"],
            "roundtrip_import": True,
            "fingerprint": fingerprint,
        },
        "warnings": [],
        "metadata": {
            "family": family,
            "design_role": context["role"],
            "seed": context["seed"],
            "preview": str(preview_path.resolve()),
            "source": source_metrics,
            "roundtrip": imported_metrics,
        },
    }
