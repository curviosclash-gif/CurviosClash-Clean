"""Shared deterministic builders for Aetherion Orrery orientation props."""

from __future__ import annotations

import hashlib
import json
from math import cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector


PALETTES = {
    "foundry": {
        "body": (0.012, 0.016, 0.027, 1.0),
        "metal": (0.28, 0.13, 0.035, 1.0),
        "accent": (0.08, 0.72, 0.78, 1.0),
        "ivory": (0.69, 0.63, 0.47, 1.0),
        "accent_strength": 3.2,
    },
    "gallery": {
        "body": (0.69, 0.63, 0.47, 1.0),
        "metal": (0.46, 0.25, 0.055, 1.0),
        "accent": (0.95, 0.46, 0.12, 1.0),
        "ivory": (0.82, 0.78, 0.66, 1.0),
        "accent_strength": 2.2,
    },
    "crown": {
        "body": (0.025, 0.018, 0.06, 1.0),
        "metal": (0.43, 0.23, 0.05, 1.0),
        "accent": (0.25, 0.12, 0.72, 1.0),
        "ivory": (0.78, 0.69, 0.48, 1.0),
        "accent_strength": 2.6,
    },
}


def _material(name, color, *, metallic=0.0, roughness=0.58, emission=0.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Emission Color"].default_value = color
    shader.inputs["Emission Strength"].default_value = emission
    return value


def _materials(level):
    palette = PALETTES[level]
    prefix = f"AO_{level.title()}"
    return {
        "body": _material(f"{prefix}_Body", palette["body"], metallic=0.22, roughness=0.42),
        "metal": _material(f"{prefix}_Metal", palette["metal"], metallic=0.78, roughness=0.32),
        "accent": _material(
            f"{prefix}_Accent",
            palette["accent"],
            metallic=0.18,
            roughness=0.34,
            emission=palette["accent_strength"],
        ),
        "ivory": _material(f"{prefix}_Ivory", palette["ivory"], roughness=0.7),
    }


def _finish(obj, name, mat):
    obj.name = f"{name}_nocol"
    obj.data.name = f"{name}_nocol_mesh"
    obj.data.materials.append(mat)
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def _cube(name, location, half_size, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = half_size
    return _finish(obj, name, mat)


def _cylinder(name, location, radius, depth, mat, vertices=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return _finish(bpy.context.object, name, mat)


def _cone(name, location, radius1, radius2, depth, mat, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return _finish(bpy.context.object, name, mat)


def _sphere(name, location, scale, mat, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.scale = scale
    return _finish(obj, name, mat)


def _torus(name, location, major, minor, mat, rotation=(0, 0, 0), segments=24):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=segments,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    return _finish(bpy.context.object, name, mat)


def _beam_between(name, start, end, radius, mat):
    start_v, end_v = Vector(start), Vector(end)
    delta = end_v - start_v
    obj = _cylinder(name, (start_v + end_v) / 2, radius, delta.length, mat, 10)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def _reset(variant_id, family, level, seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = variant_id
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.frame_start = scene.frame_end = 1
    scene["aetherion_orientation_family"] = family
    scene["aetherion_orientation_level"] = level
    scene["aetherion_orientation_seed"] = seed
    scene["static_orientation_prop"] = True
    bpy.context.preferences.filepaths.save_version = 0


def _constellation(prefix, center, radius, count, mats, tilt=0.0):
    points = []
    for index in range(count):
        angle = (index / count) * 2 * pi + tilt
        radial = radius * (0.58 if index % 3 == 1 else 1.0)
        point = (
            center[0] + radial * cos(angle),
            center[1] - 0.12,
            center[2] + radial * sin(angle),
        )
        points.append(point)
        _sphere(f"{prefix}_star_{index:02d}", point, (0.16, 0.10, 0.16), mats["accent"], 10, 5)
    for index in range(count - 1):
        _beam_between(f"{prefix}_link_{index:02d}", points[index], points[index + 1], 0.055, mats["metal"])


def build_stele(params, mats, variant_id):
    layout = params["layout"]
    h = 8.0 * params["height_scale"]
    w = 2.5 * params["width_scale"]
    damaged = params["damaged"]
    asymmetric = params["asymmetric"]
    _cylinder(f"{variant_id}_foot", (0, 0, 0.28), w * 0.78, 0.56, mats["metal"], 12)
    _cylinder(f"{variant_id}_plinth", (0, 0, 0.72), w * 0.55, 0.42, mats["ivory"], 12)

    if layout in {"monolith", "stepped", "broken"}:
        lean = 0.13 if asymmetric else 0.0
        _cube(f"{variant_id}_shaft", (lean * h, 0, 1.0 + h * 0.43), (w * 0.38, 0.42, h * 0.43), mats["body"], (0, lean, 0))
        cap_z = 1.0 + h * (0.86 if damaged else 0.94)
        _cube(f"{variant_id}_shoulder", (lean * h, 0, cap_z), (w * 0.56, 0.48, 0.35), mats["metal"], (0, lean, 0))
    elif layout in {"bifurcated", "fork", "ascent"}:
        spread = w * (0.42 if asymmetric else 0.34)
        left_h = h * (0.72 if damaged else 0.88)
        right_h = h * (0.98 if asymmetric else 0.88)
        _cube(f"{variant_id}_left_pier", (-spread, 0, 1 + left_h / 2), (w * 0.16, 0.34, left_h / 2), mats["body"], (0, 0.05, 0))
        _cube(f"{variant_id}_right_pier", (spread, 0, 1 + right_h / 2), (w * 0.16, 0.34, right_h / 2), mats["ivory"], (0, -0.05, 0))
        _beam_between(f"{variant_id}_fork_link", (-spread, 0, 1 + left_h), (spread, 0, 1 + right_h), 0.15, mats["metal"])
    else:
        _cube(f"{variant_id}_left_pier", (-w * 0.55, 0, 1 + h * 0.42), (w * 0.13, 0.32, h * 0.42), mats["ivory"])
        _cube(f"{variant_id}_right_pier", (w * 0.55, 0, 1 + h * 0.42), (w * 0.13, 0.32, h * 0.42), mats["body"])
        _cube(f"{variant_id}_lintel", (0, 0, 1 + h * 0.82), (w * 0.68, 0.38, 0.24), mats["metal"])

    symbol_z = 1 + h * (0.62 if damaged else 0.72)
    ring_major = max(0.8, w * 0.52)
    if layout in {"crescent", "ring", "portal"}:
        _torus(f"{variant_id}_primary_meridian", (0, -0.52, symbol_z), ring_major, 0.16, mats["accent"], (pi / 2, 0, 0), 24)
        if layout != "crescent":
            _torus(f"{variant_id}_cross_meridian", (0, -0.48, symbol_z), ring_major * 0.76, 0.10, mats["metal"], (pi / 2, 0, pi / 2), 20)
        _sphere(f"{variant_id}_sun", (ring_major * 0.45, -0.65, symbol_z + ring_major * 0.35), (0.28, 0.12, 0.28), mats["accent"], 12, 6)
    else:
        _torus(f"{variant_id}_primary_orbit", (0, -0.48, symbol_z), ring_major * 1.08, 0.11, mats["accent"], (pi / 2, 0, 0), 24)
        _constellation(f"{variant_id}_constellation", (0, -0.52, symbol_z), ring_major, int(params["symbol_count"]), mats, 0.35)
    if layout in {"stepped", "ascent"}:
        for index in range(3):
            _cube(f"{variant_id}_rise_{index}", (-w * 0.58 + index * w * 0.48, -0.48, 1.8 + index * 0.9), (w * 0.22, 0.1, 0.13), mats["accent"])


def build_beacon(params, mats, variant_id):
    layout = params["layout"]
    h = 6.8 * params["height_scale"]
    w = 3.1 * params["width_scale"]
    asymmetric = params["asymmetric"]
    _cylinder(f"{variant_id}_base", (0, 0, 0.25), w * 0.72, 0.5, mats["body"], 12)
    _torus(f"{variant_id}_base_orbit", (0, 0, 0.52), w * 0.58, 0.12, mats["accent"], segments=20)

    if layout in {"mast", "needle", "stack"}:
        _cylinder(f"{variant_id}_mast", (0, 0, h * 0.46 + 0.5), w * 0.12, h * 0.92, mats["metal"], 10)
        for index in range(2 if layout == "mast" else 3):
            z = 2.0 + index * h * 0.24
            _torus(f"{variant_id}_meridian_{index}", (0, 0, z), w * (0.34 + index * 0.1), 0.10, mats["ivory"], (pi / 2, index * 0.35, 0), 18)
    elif layout in {"fork", "twin", "ladder"}:
        spread = w * 0.38
        left_h = h * (0.72 if asymmetric else 0.88)
        right_h = h * 0.98
        _cylinder(f"{variant_id}_left_mast", (-spread, 0, 0.5 + left_h / 2), w * 0.10, left_h, mats["metal"], 10)
        _cylinder(f"{variant_id}_right_mast", (spread, 0, 0.5 + right_h / 2), w * 0.10, right_h, mats["ivory"], 10)
        for index in range(3):
            z = 1.8 + index * h * 0.22
            _beam_between(f"{variant_id}_rung_{index}", (-spread, 0, z), (spread, 0, z + (0.35 if asymmetric else 0)), 0.09, mats["accent" if index == 1 else "metal"])
    else:
        _cube(f"{variant_id}_left_leg", (-w * 0.46, 0, h * 0.42 + 0.5), (w * 0.11, 0.25, h * 0.42), mats["metal"], (0, 0.08, 0))
        _cube(f"{variant_id}_right_leg", (w * 0.46, 0, h * 0.42 + 0.5), (w * 0.11, 0.25, h * 0.42), mats["ivory"], (0, -0.08, 0))
        _torus(f"{variant_id}_open_hoop", (0, 0, h * 0.72), w * 0.62, 0.15, mats["accent"], (pi / 2, 0, 0), 24)

    direction = -1 if params["direction"] == "left" else 1
    arrow_z = h * 0.62
    _cube(f"{variant_id}_direction_bar", (direction * w * 0.12, -0.42, arrow_z), (w * 0.58, 0.13, 0.16), mats["accent"])
    _cone(
        f"{variant_id}_direction_head",
        (direction * w * 0.88, -0.42, arrow_z),
        w * 0.42,
        0,
        w * 0.75,
        mats["accent"],
        6,
        (0, direction * pi / 2, 0),
    )
    _sphere(f"{variant_id}_zenith", (0, 0, h + 0.6), (0.34, 0.34, 0.34), mats["accent"], 12, 6)


def build_medallion(params, mats, variant_id):
    layout = params["layout"]
    radius = 3.6 * params["width_scale"]
    thickness = 0.34 * params["height_scale"]
    broken = params["damaged"]
    if layout in {"disc", "radial", "compass", "eclipse"}:
        _cylinder(f"{variant_id}_field", (0, 0, thickness / 2), radius, thickness, mats["body"], 24)
    elif layout in {"split", "fork"}:
        _cube(f"{variant_id}_field_west", (-radius * 0.52, 0, thickness / 2), (radius * 0.42, radius * 0.76, thickness / 2), mats["body"], (0, 0, 0.12))
        _cube(f"{variant_id}_field_east", (radius * 0.52, 0, thickness / 2), (radius * 0.42, radius * 0.76, thickness / 2), mats["ivory"], (0, 0, -0.12))
    else:
        for index in range(3):
            angle = index * 2 * pi / 3 + (0.18 if broken and index == 2 else 0)
            _cylinder(
                f"{variant_id}_lobe_{index}",
                (radius * 0.42 * cos(angle), radius * 0.42 * sin(angle), thickness / 2),
                radius * 0.48,
                thickness,
                mats["body" if index != 1 else "ivory"],
                16,
            )
    _torus(f"{variant_id}_outer_meridian", (0, 0, thickness + 0.08), radius * 0.83, 0.14, mats["metal"], segments=28)
    if not broken:
        _torus(f"{variant_id}_inner_meridian", (0, 0, thickness + 0.12), radius * 0.48, 0.09, mats["accent"], segments=24)

    ray_count = int(params["symbol_count"])
    for index in range(ray_count):
        angle = index * 2 * pi / ray_count
        length = radius * (0.66 if index % 2 else 0.92)
        offset = 0.25 if broken and index >= ray_count - 2 else 0.0
        start = (radius * 0.16 * cos(angle), radius * 0.16 * sin(angle), thickness + 0.22)
        end = (length * cos(angle + offset), length * sin(angle + offset), thickness + 0.22)
        _beam_between(f"{variant_id}_bearing_{index:02d}", start, end, 0.075, mats["accent" if index % 3 == 0 else "metal"])
    if layout in {"compass", "fork"}:
        pointer = _cone(f"{variant_id}_north_pointer", (0, radius * 0.45, thickness + 0.3), radius * 0.22, 0, radius * 0.9, mats["accent"], 6, (pi / 2, 0, 0))
        pointer.scale.z = 0.28
        bpy.context.view_layer.objects.active = pointer
        pointer.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        pointer.select_set(False)
    elif layout == "eclipse":
        _sphere(f"{variant_id}_sun", (radius * 0.24, 0, thickness + 0.34), (radius * 0.24,) * 3, mats["accent"], 14, 7)
        _sphere(f"{variant_id}_moon", (-radius * 0.12, -0.08, thickness + 0.38), (radius * 0.18, radius * 0.18, radius * 0.12), mats["body"], 12, 6)


BUILDERS = {
    "zodiac-stele": build_stele,
    "orbit-beacon": build_beacon,
    "astronomical-medallion": build_medallion,
}


def _scene_metrics():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    world_points = []
    material_names = set()
    mesh_names = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        world_points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
        material_names.update(slot.material.name for slot in obj.material_slots if slot.material)
        mesh_names.append(obj.name)
        evaluated.to_mesh_clear()
    minimum = [min(point[index] for point in world_points) for index in range(3)]
    maximum = [max(point[index] for point in world_points) for index in range(3)]
    dimensions = [maximum[index] - minimum[index] for index in range(3)]
    return {
        "objects": len(bpy.context.scene.objects),
        "meshes": len(meshes),
        "mesh_names": sorted(mesh_names),
        "triangles": triangles,
        "materials": len(material_names),
        "bounds_min": minimum,
        "bounds_max": maximum,
        "dimensions": dimensions,
        "transforms": {
            obj.name: {
                "location": list(obj.location),
                "scale": list(obj.scale),
                "rotation": list(obj.rotation_euler),
            }
            for obj in meshes
        },
        "animations": len(bpy.data.actions),
        "cameras": len([obj for obj in bpy.context.scene.objects if obj.type == "CAMERA"]),
        "lights": len([obj for obj in bpy.context.scene.objects if obj.type == "LIGHT"]),
    }


def _material_metrics():
    result = {}
    used_materials = {
        slot.material
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        for slot in obj.material_slots
        if slot.material is not None
    }
    for value in used_materials:
        if not value.use_nodes:
            continue
        shader = value.node_tree.nodes.get("Principled BSDF")
        if shader is None:
            continue
        base_color = list(shader.inputs["Base Color"].default_value)
        emission_color = list(shader.inputs["Emission Color"].default_value)
        emission_strength = float(shader.inputs["Emission Strength"].default_value)
        result[value.name] = {
            "base_color": base_color,
            "metallic": float(shader.inputs["Metallic"].default_value),
            "roughness": float(shader.inputs["Roughness"].default_value),
            "emission_color": emission_color,
            "emission_strength": emission_strength,
            "emission_radiance": [component * emission_strength for component in emission_color[:3]],
        }
    return result


def _close_vector(left, right, tolerance=0.001):
    return len(left) == len(right) and all(abs(a - b) <= tolerance for a, b in zip(left, right))


def _roundtrip(glb_path, expected, expected_materials):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    actual = _scene_metrics()
    actual_materials = _material_metrics()
    transforms_match = actual["transforms"].keys() == expected["transforms"].keys()
    if transforms_match:
        for name, transform in expected["transforms"].items():
            imported = actual["transforms"][name]
            transforms_match = all(
                _close_vector(imported[key], transform[key], 0.003)
                for key in ("location", "scale", "rotation")
            )
            if not transforms_match:
                break
    materials_match = actual_materials.keys() == expected_materials.keys()
    if materials_match:
        for name, values in expected_materials.items():
            imported = actual_materials[name]
            materials_match = (
                _close_vector(imported["base_color"], values["base_color"], 0.001)
                and abs(imported["metallic"] - values["metallic"]) <= 0.001
                and abs(imported["roughness"] - values["roughness"]) <= 0.001
                and _close_vector(imported["emission_radiance"], values["emission_radiance"], 0.001)
            )
            if not materials_match:
                break
    checks = {
        "object_count": actual["objects"] == expected["objects"],
        "mesh_count": actual["meshes"] == expected["meshes"],
        "mesh_names": actual["mesh_names"] == expected["mesh_names"],
        "triangles": actual["triangles"] == expected["triangles"],
        "materials": actual["materials"] == expected["materials"],
        "dimensions": _close_vector(actual["dimensions"], expected["dimensions"], 0.003),
        "bounds_min": _close_vector(actual["bounds_min"], expected["bounds_min"], 0.003),
        "bounds_max": _close_vector(actual["bounds_max"], expected["bounds_max"], 0.003),
        "transforms": transforms_match,
        "pbr_and_emission": materials_match,
        "static": actual["animations"] == 0,
        "no_cameras": actual["cameras"] == 0,
        "no_lights": actual["lights"] == 0,
        "nocol_meshes": all(name.endswith("_nocol") for name in actual["mesh_names"]),
    }
    if not all(checks.values()):
        failed = ", ".join(name for name, passed in checks.items() if not passed)
        raise RuntimeError(f"GLB roundtrip failed: {failed}")
    return actual, actual_materials, checks


def build_family_variant(context, family):
    variant_id = context["id"]
    params = context["parameters"]
    level = params["level"]
    _reset(variant_id, family, level, context["seed"])
    BUILDERS[family](params, _materials(level), variant_id)
    source_metrics = _scene_metrics()
    source_materials = _material_metrics()
    if not source_metrics["mesh_names"] or not all(name.endswith("_nocol") for name in source_metrics["mesh_names"]):
        raise RuntimeError("every generated mesh must use the _nocol suffix")
    if source_metrics["animations"] or source_metrics["cameras"] or source_metrics["lights"]:
        raise RuntimeError("orientation props must be static and contain no cameras or lights")

    output_dir = Path(context["output_dir"])
    blend_path = output_dir / "source.blend"
    glb_path = output_dir / "runtime.glb"
    bpy.context.scene["contract_hash"] = context["contract_hash"]
    bpy.context.scene["variant_id"] = variant_id
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    file_size = glb_path.stat().st_size
    fingerprint = hashlib.sha256(glb_path.read_bytes()).hexdigest()[:20]
    imported, imported_materials, checks = _roundtrip(glb_path, source_metrics, source_materials)
    metadata = {
        "family": family,
        "level": level,
        "role": context["role"],
        "source": source_metrics,
        "reimport": imported,
        "roundtrip_checks": checks,
        "source_pbr": source_materials,
        "reimport_pbr": imported_materials,
    }
    return {
        "outputs": [
            {"role": "editable", "path": f"{variant_id}/source.blend"},
            {"role": "runtime", "path": f"{variant_id}/runtime.glb"},
        ],
        "metrics": {
            "triangles": source_metrics["triangles"],
            "materials": source_metrics["materials"],
            "file_size_bytes": file_size,
            "objects": source_metrics["objects"],
            "meshes": source_metrics["meshes"],
            "width": round(source_metrics["dimensions"][0], 4),
            "depth": round(source_metrics["dimensions"][1], 4),
            "height": round(source_metrics["dimensions"][2], 4),
            "roundtrip_import": True,
            "fingerprint": fingerprint,
        },
        "metadata": json.loads(json.dumps(metadata)),
    }
