#!/usr/bin/env python3
"""Inspect the evaluated Blender scene and emit a deterministic JSON report.

Run with Blender, for example:
blender asset.blend --background --python inspect_scene.py -- --output report.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fail-on-errors", action="store_true")
    return parser.parse_args(argv)


def rounded(values: Vector) -> list[float]:
    return [round(float(value), 6) for value in values]


def scene_report() -> dict:
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    object_reports: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    scene_min = Vector((math.inf, math.inf, math.inf))
    scene_max = Vector((-math.inf, -math.inf, -math.inf))

    totals = {"mesh_objects": 0, "vertices": 0, "faces": 0, "triangles": 0}

    for obj in sorted(scene.objects, key=lambda item: item.name):
        if obj.type != "MESH":
            continue

        totals["mesh_objects"] += 1
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            non_finite = 0
            degenerate = 0
            for vertex in mesh.vertices:
                if not all(math.isfinite(component) for component in vertex.co):
                    non_finite += 1
            for polygon in mesh.polygons:
                if polygon.area <= 1.0e-12:
                    degenerate += 1

            if non_finite:
                errors.append(f"{obj.name}: {non_finite} non-finite vertices")
            if degenerate:
                warnings.append(f"{obj.name}: {degenerate} degenerate faces")

            world_corners = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
            obj_min = Vector(tuple(min(corner[axis] for corner in world_corners) for axis in range(3)))
            obj_max = Vector(tuple(max(corner[axis] for corner in world_corners) for axis in range(3)))
            for axis in range(3):
                scene_min[axis] = min(scene_min[axis], obj_min[axis])
                scene_max[axis] = max(scene_max[axis], obj_max[axis])

            triangles = len(mesh.loop_triangles)
            totals["vertices"] += len(mesh.vertices)
            totals["faces"] += len(mesh.polygons)
            totals["triangles"] += triangles

            scale = obj.matrix_world.to_scale()
            if any(abs(abs(component) - 1.0) > 1.0e-4 for component in scale):
                warnings.append(f"{obj.name}: non-unit world scale {rounded(scale)}")
            if obj.matrix_world.to_3x3().determinant() < 0:
                warnings.append(f"{obj.name}: mirrored world transform")

            shape_keys = []
            if getattr(obj.data, "shape_keys", None):
                shape_keys = [key.name for key in obj.data.shape_keys.key_blocks]

            object_reports.append(
                {
                    "name": obj.name,
                    "role": obj.get("asset_role"),
                    "vertices": len(mesh.vertices),
                    "faces": len(mesh.polygons),
                    "triangles": triangles,
                    "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                    "modifiers": [modifier.type for modifier in obj.modifiers],
                    "shape_keys": shape_keys,
                    "bounds": {"min": rounded(obj_min), "max": rounded(obj_max)},
                    "non_finite_vertices": non_finite,
                    "degenerate_faces": degenerate,
                }
            )
        finally:
            evaluated.to_mesh_clear()

    if not object_reports:
        errors.append("Scene contains no mesh objects")
        bounds = None
    else:
        bounds = {
            "min": rounded(scene_min),
            "max": rounded(scene_max),
            "size": rounded(scene_max - scene_min),
        }

    actions = []
    for action in sorted(bpy.data.actions, key=lambda item: item.name):
        actions.append(
            {
                "name": action.name,
                "frame_range": [round(float(value), 4) for value in action.frame_range],
                "users": action.users,
            }
        )

    return {
        "blender_version": bpy.app.version_string,
        "blend_file": bpy.data.filepath or None,
        "scene": scene.name,
        "frame_range": [scene.frame_start, scene.frame_end],
        "fps": scene.render.fps / scene.render.fps_base,
        "bounds": bounds,
        "totals": totals,
        "materials": sorted(material.name for material in bpy.data.materials),
        "actions": actions,
        "objects": object_reports,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> None:
    args = parse_args()
    report = scene_report()
    payload = json.dumps(report, indent=2, sort_keys=True)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    if args.fail_on_errors and report["errors"]:
        raise RuntimeError("Scene inspection failed: " + "; ".join(report["errors"]))


if __name__ == "__main__":
    main()
