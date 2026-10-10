"""Shared bpy helpers for decorative map prop families built with blender-object-batches.

A family module builds its pieces, then hands one list of objects per material to
`finish_variant`, which joins them into one `_nocol` mesh per material, moves the result to
bottom-centre, saves `source.blend`, exports `runtime.glb` and proves the export by
re-importing it into an empty scene. Every prop built this way is decorative only.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def reset_scene(context):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = context["id"]
    scene["variant_id"] = context["id"]
    scene["variant_seed"] = context["seed"]
    scene["contract_hash"] = context["contract_hash"]
    bpy.context.preferences.filepaths.save_version = 0


def make_materials(prefix, palette):
    """palette: key -> (rgba, metallic, roughness, emission_rgb, emission_strength)."""
    result = {}
    for key, (color, metallic, roughness, emission, strength) in palette.items():
        mat = bpy.data.materials.new(f"{prefix}_{key.title()}")
        mat.diffuse_color = color
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
        shader.inputs["Emission Strength"].default_value = strength
        result[key] = mat
    return result


def _join(objects, name, material):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objects) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = f"{name}_mesh"
    joined.data.materials.clear()
    joined.data.materials.append(material)
    for layer in list(joined.data.uv_layers):
        joined.data.uv_layers.remove(layer)
    return joined


def _place_bottom_center(meshes):
    corners = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    lows = [min(v[i] for v in corners) for i in range(3)]
    highs = [max(v[i] for v in corners) for i in range(3)]
    offset = Vector(((lows[0] + highs[0]) / -2, (lows[1] + highs[1]) / -2, -lows[2]))
    for obj in meshes:
        obj.data.transform(Matrix.Translation(offset))


def _metrics():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    for obj in meshes:
        data = obj.evaluated_get(depsgraph).to_mesh()
        data.calc_loop_triangles()
        triangles += len(data.loop_triangles)
        obj.evaluated_get(depsgraph).to_mesh_clear()
    corners = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
    return {
        "mesh_names": sorted(obj.name for obj in meshes),
        "triangles": triangles,
        "materials": sorted({slot.material.name for obj in meshes for slot in obj.material_slots}),
        "dimensions": [round(max(v[i] for v in corners) - min(v[i] for v in corners), 4) for i in range(3)],
        "bottom": round(min(v[2] for v in corners), 4),
        "colliding": [obj.name for obj in meshes if "_nocol" not in obj.name],
        "extras": len([obj for obj in bpy.context.scene.objects if obj.type in {"CAMERA", "LIGHT"}]),
    }


def finish_variant(context, parts, mesh_names, materials, metadata=None):
    """parts/mesh_names/materials are keyed by material; empty part lists are skipped."""
    meshes = [_join(parts[key], mesh_names[key], materials[key]) for key in mesh_names if parts.get(key)]
    _place_bottom_center(meshes)
    bpy.context.view_layer.update()
    source = _metrics()
    if source["colliding"] or source["extras"]:
        raise RuntimeError(f"prop must be decorative and static: {source}")

    output_dir = Path(context["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path, glb_path = output_dir / "source.blend", output_dir / "runtime.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", export_animations=False,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_extras=True, export_apply=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = _metrics()
    checks = {key: imported[key] == source[key] for key in ("mesh_names", "triangles", "materials", "colliding")}
    checks["dimensions"] = all(abs(a - b) <= 0.004 for a, b in zip(imported["dimensions"], source["dimensions"]))
    checks["bottom"] = abs(imported["bottom"] - source["bottom"]) <= 0.004
    if not all(checks.values()):
        raise RuntimeError(f"GLB roundtrip failed: {[k for k, ok in checks.items() if not ok]}")
    return {
        "outputs": [{"role": "editable", "path": f"{context['id']}/source.blend"},
                    {"role": "runtime", "path": f"{context['id']}/runtime.glb"}],
        "metrics": {
            "triangles": source["triangles"],
            "materials": len(source["materials"]),
            "file_size_bytes": glb_path.stat().st_size,
            "width": source["dimensions"][0], "depth": source["dimensions"][1],
            "height": source["dimensions"][2],
            "roundtrip_import": True,
            "fingerprint": hashlib.sha256(glb_path.read_bytes()).hexdigest()[:20],
        },
        "metadata": {**(metadata or {}), "roundtrip_checks": checks},
    }
