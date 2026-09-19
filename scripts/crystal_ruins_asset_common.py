"""Deterministic Crystal Ruins prop builders shared by four batch generators.

The editable Blender files retain every construction piece. Runtime GLBs use the same
small flat-PBR palette and deliberately separate coarse structural collision from
decorative fracture, deposit, rubble, and crystal geometry through the `_nocol` suffix.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


PALETTE = {
    "stone": ((0.58, 0.55, 0.49, 1.0), 0.0, 0.82, 0.0),
    "fracture": ((0.12, 0.105, 0.12, 1.0), 0.0, 0.9, 0.0),
    "deposit": ((0.25, 0.22, 0.23, 1.0), 0.0, 0.96, 0.0),
    "cyan": ((0.025, 0.72, 0.82, 1.0), 0.08, 0.26, 1.15),
    "violet": ((0.38, 0.08, 0.66, 1.0), 0.08, 0.3, 0.9),
    "turquoise": ((0.025, 0.48, 0.42, 1.0), 0.05, 0.34, 0.7),
}


def _material(name, color, metallic, roughness, emission):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Emission Color"].default_value = color
    shader.inputs["Emission Strength"].default_value = emission
    return mat


def _materials():
    return {
        key: _material(f"CrystalRuins_{key.title()}", *values)
        for key, values in PALETTE.items()
    }


def _reset(context, family):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = context["id"]
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.frame_start = scene.frame_end = 1
    scene["asset_family"] = family
    scene["variant_id"] = context["id"]
    scene["variant_seed"] = context["seed"]
    scene["contract_hash"] = context["contract_hash"]
    scene["collision_role"] = context["parameters"].get("collision_role", "decorative")
    bpy.context.preferences.filepaths.save_version = 0


def _finish(obj, name, material, *, collision=False, bevel=0.0):
    suffix = "" if collision else "_nocol"
    obj.name = f"{name}{suffix}"
    obj.data.name = f"{name}{suffix}_mesh"
    obj.data.materials.append(material)
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("WeatheredEdges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.limit_method = "ANGLE"
    obj.select_set(False)
    return obj


def _cube(name, location, size, material, *, rotation=(0, 0, 0), collision=False, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    return _finish(obj, name, material, collision=collision, bevel=bevel)


def _cylinder(name, location, radius, depth, material, *, vertices=10, rotation=(0, 0, 0), collision=False, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return _finish(bpy.context.object, name, material, collision=collision, bevel=bevel)


def _stone_block(prefix, index, location, size, mats, rng, *, collision=False, tilt=0.1):
    rotation = (
        rng.uniform(-tilt, tilt),
        rng.uniform(-tilt, tilt),
        rng.uniform(-tilt * 1.4, tilt * 1.4),
    )
    obj = _cube(
        f"{prefix}_stone_{index:02d}", location, size, mats["stone"],
        rotation=rotation, collision=collision, bevel=min(size) * 0.055,
    )
    return obj


def _fracture_plate(prefix, index, location, size, mats, *, rotation=(0, 0, 0)):
    return _cube(
        f"{prefix}_fracture_{index:02d}", location, size, mats["fracture"],
        rotation=rotation, collision=False, bevel=min(size) * 0.02,
    )


def _crystal(prefix, index, start, direction, length, radius, material):
    start_v = Vector(start)
    direction_v = Vector(direction).normalized()
    end_v = start_v + direction_v * length
    bpy.ops.mesh.primitive_cone_add(
        vertices=6,
        radius1=radius,
        radius2=radius * 0.08,
        depth=length,
        location=(start_v + end_v) / 2,
    )
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction_v)
    return _finish(obj, f"{prefix}_crystal_{index:02d}", material, collision=False, bevel=radius * 0.03)


def _crystal_cluster(prefix, origin, count, spread, height, mats, rng, *, bias=(0, 0, 1)):
    tones = ("cyan", "violet", "turquoise")
    for index in range(count):
        angle = (index / max(1, count)) * math.tau + rng.uniform(-0.34, 0.34)
        radial = spread * (0.18 + 0.82 * rng.random())
        start = (
            origin[0] + math.cos(angle) * radial,
            origin[1] + math.sin(angle) * radial,
            max(0.06, origin[2] + rng.uniform(-0.04, 0.16)),
        )
        direction = Vector((
            math.cos(angle) * rng.uniform(0.12, 0.46) + bias[0],
            math.sin(angle) * rng.uniform(0.12, 0.46) + bias[1],
            rng.uniform(0.82, 1.18) + bias[2] * 0.2,
        ))
        _crystal(
            prefix,
            index,
            start,
            direction,
            height * rng.uniform(0.55, 1.1),
            max(0.09, height * rng.uniform(0.075, 0.14)),
            mats[tones[index % len(tones)]],
        )


def _deposit(prefix, index, location, scale, mats, rng):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=location)
    obj = bpy.context.object
    obj.scale = scale
    obj.rotation_euler = (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.random() * math.tau)
    return _finish(obj, f"{prefix}_deposit_{index:02d}", mats["deposit"], collision=False)


def _arch(context, mats, rng):
    p = context["parameters"]
    prefix = context["id"]
    width = 8.0 * p["width_scale"]
    height = 6.4 * p["height_scale"]
    depth = 1.55 * p["depth_scale"]
    damage = p["damage"]
    layout = p["layout"]
    collision = p["collision_role"] == "coarse-obstacle"
    asym = -1 if p["break_side"] == "left" else 1
    pier_width = width * (0.16 if layout not in {"massive", "fortified"} else 0.21)
    opening_half = width * 0.5 - pier_width
    left_height = height * (1.0 - (damage * 0.34 if asym < 0 else damage * 0.08))
    right_height = height * (1.0 - (damage * 0.34 if asym > 0 else damage * 0.08))

    _stone_block(prefix, 0, (-width * 0.5 + pier_width * 0.5, 0, left_height * 0.5),
                 (pier_width, depth, left_height), mats, rng, collision=collision, tilt=0.025)
    _stone_block(prefix, 1, (width * 0.5 - pier_width * 0.5, 0, right_height * 0.5),
                 (pier_width, depth, right_height), mats, rng, collision=collision, tilt=0.025)

    segment_count = int(p["arch_segments"])
    arch_radius = opening_half
    arch_center_z = min(left_height, right_height) - arch_radius * 0.05
    missing = max(1, round(segment_count * damage * 0.28))
    missing_start = 1 if asym < 0 else segment_count - missing - 1
    for index in range(segment_count):
        if missing_start <= index < missing_start + missing:
            continue
        t = index / max(1, segment_count - 1)
        theta = math.pi * (1.0 - t)
        x = arch_radius * math.cos(theta)
        z = arch_center_z + arch_radius * math.sin(theta)
        block_width = math.pi * arch_radius / segment_count * 1.08
        _cube(
            f"{prefix}_voussoir_{index:02d}", (x, 0, z),
            (block_width, depth, pier_width * 0.92), mats["stone"],
            rotation=(0, theta - math.pi / 2, rng.uniform(-0.025, 0.025)),
            collision=collision, bevel=pier_width * 0.045,
        )
    # Dark, directional fracture caps stay visibly tied to missing masonry.
    broken_x = asym * (arch_radius * 0.62)
    broken_z = arch_center_z + arch_radius * 0.72
    _fracture_plate(prefix, 0, (broken_x, -depth * 0.51, broken_z),
                    (pier_width * 0.95, 0.07, pier_width * 0.7), mats,
                    rotation=(0, asym * 0.34, asym * 0.08))
    rubble_count = int(p["rubble_count"])
    for index in range(rubble_count):
        x = asym * (width * 0.48 + index * pier_width * 0.62)
        size = pier_width * rng.uniform(0.45, 0.8)
        _stone_block(prefix, 10 + index, (x, rng.uniform(-depth, depth), size * 0.42),
                     (size, size * rng.uniform(0.7, 1.25), size * 0.8), mats, rng, collision=False, tilt=0.38)
    if layout in {"double-buttress", "fortified", "wide-ruin"}:
        for side in (-1, 1):
            _stone_block(prefix, 20 + side, (side * width * 0.62, depth * 0.1, height * 0.24),
                         (pier_width * 0.7, depth * 1.45, height * 0.48), mats, rng,
                         collision=collision, tilt=0.04)
    if p["crystal_count"]:
        _crystal_cluster(prefix, (broken_x, 0, broken_z - pier_width * 0.35), int(p["crystal_count"]),
                         pier_width * 0.35, pier_width * 1.2, mats, rng, bias=(asym * 0.3, 0, 0.4))


def _column(context, mats, rng):
    p = context["parameters"]
    prefix = context["id"]
    height = 7.5 * p["height_scale"]
    radius = 1.05 * p["width_scale"]
    damage = p["damage"]
    collision = p["collision_role"] == "coarse-obstacle"
    layout = p["layout"]
    standing = layout not in {"fallen", "split-fallen", "shattered-base"}
    base_h = max(0.28, radius * 0.35)
    _cylinder(f"{prefix}_base", (0, 0, base_h / 2), radius * 1.3, base_h, mats["stone"],
              vertices=10, collision=collision and standing, bevel=0.06)
    if standing:
        segments = int(p["shaft_segments"])
        visible_height = height * (1.0 - damage * 0.48)
        segment_h = visible_height / segments
        for index in range(segments):
            offset = p["lean"] * index / max(1, segments - 1)
            loc = (offset, rng.uniform(-0.04, 0.04), base_h + segment_h * (index + 0.5))
            _cylinder(f"{prefix}_shaft_{index:02d}", loc, radius * (1 - index * 0.025),
                      segment_h * 0.94, mats["stone"], vertices=10,
                      rotation=(0, p["lean"] * 0.025, rng.uniform(-0.035, 0.035)),
                      collision=collision, bevel=0.045)
        top_z = base_h + visible_height
        _fracture_plate(prefix, 0, (p["lean"], 0, top_z + 0.02),
                        (radius * 1.55, radius * 1.2, 0.1), mats,
                        rotation=(rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14), 0))
        if layout in {"capital-remnant", "tall-marker", "paired-drum"} and damage < 0.58:
            _cylinder(f"{prefix}_capital", (p["lean"], 0, top_z + base_h * 0.45),
                      radius * 1.35, base_h * 0.8, mats["stone"], vertices=8,
                      collision=collision, bevel=0.05)
    else:
        pieces = int(p["shaft_segments"])
        for index in range(pieces):
            length = height * (0.18 + 0.08 * rng.random())
            x = -height * 0.2 + index * height * 0.24
            _cylinder(f"{prefix}_fallen_{index:02d}", (x, rng.uniform(-radius, radius), radius * 0.72),
                      radius * rng.uniform(0.72, 1.0), length, mats["stone"], vertices=10,
                      rotation=(0, math.pi / 2 + rng.uniform(-0.16, 0.16), rng.uniform(-0.18, 0.18)),
                      collision=False, bevel=0.04)
            _fracture_plate(prefix, index, (x + length * 0.48, 0, radius * 0.72),
                            (0.08, radius * 1.35, radius * 1.35), mats,
                            rotation=(0, math.pi / 2, rng.uniform(-0.2, 0.2)))
    for index in range(int(p["deposit_count"])):
        angle = index * 2.4
        _deposit(prefix, index, (math.cos(angle) * radius, math.sin(angle) * radius, 0.18),
                 (radius * 0.55, radius * 0.35, 0.2), mats, rng)
    if p["crystal_count"]:
        anchor_z = base_h + (height * (1.0 - damage * 0.48) * 0.72 if standing else radius * 0.8)
        _crystal_cluster(prefix, (0, -radius * 0.5, anchor_z), int(p["crystal_count"]),
                         radius * 0.45, radius * 1.8, mats, rng, bias=(0, -0.35, 0.15))


def _rubble(context, mats, rng):
    p = context["parameters"]
    prefix = context["id"]
    width = 7.0 * p["width_scale"]
    depth = 4.6 * p["depth_scale"]
    height = 2.5 * p["height_scale"]
    layout = p["layout"]
    count = int(p["block_count"])
    for index in range(count):
        t = index / max(1, count - 1)
        if layout in {"wall-line", "collapsed-corner", "terraced"}:
            x = (t - 0.5) * width
            y = (0.35 * math.sin(t * math.pi * (2 if layout == "collapsed-corner" else 1))) * depth
        elif layout in {"crescent", "spill", "fan"}:
            angle = -1.1 + t * 2.2
            x = math.cos(angle) * width * 0.42
            y = math.sin(angle) * depth * 0.52
        else:
            x = rng.uniform(-width * 0.48, width * 0.48)
            y = rng.uniform(-depth * 0.48, depth * 0.48)
        scale = 0.55 + (1 - abs(t - 0.5) * 1.5) * 0.65
        sx = width / max(4, count * 0.62) * rng.uniform(0.8, 1.35)
        sy = depth / max(3, count * 0.45) * rng.uniform(0.75, 1.3)
        sz = height * scale * rng.uniform(0.28, 0.72)
        _stone_block(prefix, index, (x, y, sz * 0.44), (sx, sy, sz), mats, rng, collision=False, tilt=0.45)
        if index % 3 == 0:
            _fracture_plate(prefix, index, (x, y - sy * 0.48, sz * 0.48),
                            (sx * 0.7, 0.06, sz * 0.55), mats,
                            rotation=(0, rng.uniform(-0.25, 0.25), rng.uniform(-0.35, 0.35)))
    for index in range(int(p["deposit_count"])):
        _deposit(prefix, index, (rng.uniform(-width * 0.45, width * 0.45),
                                 rng.uniform(-depth * 0.45, depth * 0.45), 0.15),
                 (rng.uniform(0.35, 0.8), rng.uniform(0.3, 0.65), rng.uniform(0.12, 0.28)), mats, rng)
    if p["crystal_count"]:
        _crystal_cluster(prefix, (width * 0.16, -depth * 0.08, height * 0.3),
                         int(p["crystal_count"]), width * 0.12, height * 0.75, mats, rng)


def _crystal_ruin(context, mats, rng):
    p = context["parameters"]
    prefix = context["id"]
    width = 5.2 * p["width_scale"]
    depth = 3.8 * p["depth_scale"]
    height = 4.6 * p["height_scale"]
    layout = p["layout"]
    # The ruin host gives every cluster visible joints and cracks to emerge from.
    if layout in {"split-slab", "altar", "stair-remnant", "wall-seam"}:
        _stone_block(prefix, 0, (-width * 0.18, 0, height * 0.26),
                     (width * 0.58, depth, height * 0.52), mats, rng, collision=False, tilt=0.08)
        _stone_block(prefix, 1, (width * 0.3, depth * 0.06, height * 0.18),
                     (width * 0.36, depth * 0.82, height * 0.36), mats, rng, collision=False, tilt=0.16)
        crack_origin = (width * 0.05, -depth * 0.45, height * 0.43)
    elif layout in {"column-split", "spire-remnant", "rooted-pier"}:
        _cylinder(f"{prefix}_host_column", (0, 0, height * 0.38), width * 0.22,
                  height * 0.76, mats["stone"], vertices=9, collision=False, bevel=0.06)
        _fracture_plate(prefix, 0, (0, 0, height * 0.77),
                        (width * 0.42, depth * 0.34, 0.1), mats, rotation=(0.12, -0.1, 0.2))
        crack_origin = (0, -width * 0.2, height * 0.58)
    else:
        # Broken arch-root: two feet and an off-centre lintel fragment.
        _stone_block(prefix, 0, (-width * 0.34, 0, height * 0.36),
                     (width * 0.22, depth * 0.58, height * 0.72), mats, rng, collision=False, tilt=0.04)
        _stone_block(prefix, 1, (width * 0.27, 0, height * 0.23),
                     (width * 0.2, depth * 0.62, height * 0.46), mats, rng, collision=False, tilt=0.12)
        _stone_block(prefix, 2, (-width * 0.03, 0, height * 0.68),
                     (width * 0.58, depth * 0.55, height * 0.16), mats, rng, collision=False, tilt=0.14)
        crack_origin = (-width * 0.02, -depth * 0.3, height * 0.62)
    _fracture_plate(prefix, 1, crack_origin,
                    (width * 0.46, 0.07, height * 0.12), mats,
                    rotation=(0, p["growth_direction"] * 0.12, p["growth_direction"] * 0.28))
    _crystal_cluster(prefix, crack_origin, int(p["crystal_count"]), width * 0.2,
                     height * p["crystal_scale"], mats, rng,
                     bias=(p["growth_direction"] * 0.5, -0.15, 0.3))
    for index in range(int(p["rubble_count"])):
        size = rng.uniform(0.35, 0.8)
        _stone_block(prefix, 10 + index,
                     (rng.uniform(-width * 0.5, width * 0.5), rng.uniform(-depth * 0.5, depth * 0.5), size * 0.35),
                     (size, size * rng.uniform(0.7, 1.2), size * 0.7), mats, rng, collision=False, tilt=0.4)


BUILDERS = {
    "broken-arch": _arch,
    "damaged-column": _column,
    "rubble-cluster": _rubble,
    "crystal-ruin-growth": _crystal_ruin,
}


def _place_on_bottom_center():
    """Move the complete editable assembly so its world origin is its footprint centre.

    Rotated rubble and bevelled fracture pieces may extend below their object origins. The
    evaluated bounds, rather than construction guesses, therefore define the placement offset.
    """
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    offset = Vector((-(minimum.x + maximum.x) / 2, -(minimum.y + maximum.y) / 2, -minimum.z))
    for obj in meshes:
        obj.location += offset


def _evaluated_metrics():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    world_points = []
    material_names = set()
    mesh_names = []
    zero_area = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        zero_area += sum(1 for poly in mesh.polygons if poly.area <= 1e-10)
        world_points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
        material_names.update(slot.material.name for slot in obj.material_slots if slot.material)
        mesh_names.append(obj.name)
        evaluated.to_mesh_clear()
    minimum = [min(point[axis] for point in world_points) for axis in range(3)]
    maximum = [max(point[axis] for point in world_points) for axis in range(3)]
    return {
        "objects": len(bpy.context.scene.objects),
        "meshes": len(meshes),
        "mesh_names": sorted(mesh_names),
        "triangles": triangles,
        "materials": len(material_names),
        "bounds_min": minimum,
        "bounds_max": maximum,
        "dimensions": [maximum[i] - minimum[i] for i in range(3)],
        "animations": len(bpy.data.actions),
        "cameras": sum(obj.type == "CAMERA" for obj in bpy.context.scene.objects),
        "lights": sum(obj.type == "LIGHT" for obj in bpy.context.scene.objects),
        "zero_area_faces": zero_area,
        "collision_meshes": sum(not name.endswith("_nocol") for name in mesh_names),
        "decorative_meshes": sum(name.endswith("_nocol") for name in mesh_names),
        "fracture_surfaces": sum("_fracture_" in name for name in mesh_names),
        "crystals": sum("_crystal_" in name for name in mesh_names),
    }


def _material_metrics():
    result = {}
    used = {
        slot.material for obj in bpy.context.scene.objects if obj.type == "MESH"
        for slot in obj.material_slots if slot.material is not None
    }
    for mat in used:
        shader = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
        if not shader:
            continue
        result[mat.name] = {
            "base_color": list(shader.inputs["Base Color"].default_value),
            "metallic": float(shader.inputs["Metallic"].default_value),
            "roughness": float(shader.inputs["Roughness"].default_value),
            "emission_radiance": [
                float(value) * float(shader.inputs["Emission Strength"].default_value)
                for value in shader.inputs["Emission Color"].default_value[:3]
            ],
        }
    return result


def _close(left, right, tolerance=0.004):
    return len(left) == len(right) and all(abs(a - b) <= tolerance for a, b in zip(left, right))


def _roundtrip(glb_path, source, source_materials, collision_role):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = _evaluated_metrics()
    imported_materials = _material_metrics()
    material_match = imported_materials.keys() == source_materials.keys()
    if material_match:
        for name, expected in source_materials.items():
            actual = imported_materials[name]
            if not (
                _close(actual["base_color"], expected["base_color"], 0.001)
                and abs(actual["metallic"] - expected["metallic"]) <= 0.001
                and abs(actual["roughness"] - expected["roughness"]) <= 0.001
                and _close(actual["emission_radiance"], expected["emission_radiance"], 0.002)
            ):
                material_match = False
                break
    checks = {
        "object_and_mesh_count": imported["objects"] == source["objects"] and imported["meshes"] == source["meshes"],
        "stable_mesh_names": imported["mesh_names"] == source["mesh_names"],
        "dimensions": _close(imported["dimensions"], source["dimensions"]),
        "bottom_origin": abs(imported["bounds_min"][2] - source["bounds_min"][2]) <= 0.004,
        "triangles": imported["triangles"] == source["triangles"],
        "materials": imported["materials"] == source["materials"] and material_match,
        "clean_normals": imported["zero_area_faces"] == 0,
        "static": imported["animations"] == 0,
        "no_cameras": imported["cameras"] == 0,
        "no_lights": imported["lights"] == 0,
        "collision_role": (
            imported["collision_meshes"] > 0 if collision_role == "coarse-obstacle"
            else imported["collision_meshes"] == 0
        ),
    }
    if not all(checks.values()):
        failed = ", ".join(name for name, passed in checks.items() if not passed)
        raise RuntimeError(f"GLB roundtrip failed: {failed}")
    return imported, imported_materials, checks


def build_family_variant(context, family):
    if family not in BUILDERS:
        raise ValueError(f"unknown Crystal Ruins family: {family}")
    _reset(context, family)
    rng = random.Random(context["seed"])
    mats = _materials()
    BUILDERS[family](context, mats, rng)
    _place_on_bottom_center()
    source = _evaluated_metrics()
    source_materials = _material_metrics()
    collision_role = context["parameters"].get("collision_role", "decorative")
    if source["zero_area_faces"]:
        raise RuntimeError("generated source contains zero-area faces")
    if source["animations"] or source["cameras"] or source["lights"]:
        raise RuntimeError("Crystal Ruins props must be static and contain no cameras or lights")
    if collision_role == "decorative" and source["collision_meshes"]:
        raise RuntimeError("decorative variant contains a colliding mesh")
    if family in {"rubble-cluster", "crystal-ruin-growth"} and source["collision_meshes"]:
        raise RuntimeError("small rubble and crystal growth must always be decorative")

    output_dir = Path(context["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = output_dir / "source.blend"
    glb_path = output_dir / "runtime.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", export_animations=False,
        export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True, export_apply=True,
    )
    fingerprint = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:20]
    imported, imported_materials, checks = _roundtrip(
        glb_path, source, source_materials, collision_role
    )
    return {
        "outputs": [
            {"role": "editable", "path": f"{context['id']}/source.blend"},
            {"role": "runtime", "path": f"{context['id']}/runtime.glb"},
        ],
        "metrics": {
            "triangles": source["triangles"],
            "materials": source["materials"],
            "file_size_bytes": glb_path.stat().st_size,
            "objects": source["objects"],
            "meshes": source["meshes"],
            "width": round(source["dimensions"][0], 4),
            "depth": round(source["dimensions"][1], 4),
            "height": round(source["dimensions"][2], 4),
            "collision_meshes": source["collision_meshes"],
            "decorative_meshes": source["decorative_meshes"],
            "fracture_surfaces": source["fracture_surfaces"],
            "crystals": source["crystals"],
            "roundtrip_import": True,
            "fingerprint": fingerprint,
        },
        "metadata": json.loads(json.dumps({
            "family": family,
            "role": context["role"],
            "collision_role": collision_role,
            "source": source,
            "reimport": imported,
            "roundtrip_checks": checks,
            "source_pbr": source_materials,
            "reimport_pbr": imported_materials,
        })),
    }
