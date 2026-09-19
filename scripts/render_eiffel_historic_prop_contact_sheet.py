#!/usr/bin/env python3
"""Render one Eiffel historic prop family with fixed camera and neutral lighting."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--canonical-only", action="store_true")
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(values)


def bounds(objects):
    low = Vector((math.inf, math.inf, math.inf))
    high = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    return low, high


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    options = args()
    runtimes = sorted(options.batch_dir.glob("*/runtime.glb"))
    if options.canonical_only:
        runtimes = runtimes[:1]
    if not runtimes:
        raise RuntimeError(f"no runtime GLBs under {options.batch_dir}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 800 if len(runtimes) == 1 else 1600
    scene.render.resolution_y = 800 if len(runtimes) == 1 else 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("EiffelHistoricPreviewWorld")
    scene.world.color = (0.055, 0.065, 0.078)

    groups = []
    sizes = []
    for runtime in runtimes:
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(runtime))
        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        low, high = bounds(imported)
        root = bpy.data.objects.new(runtime.parent.name, None)
        bpy.context.collection.objects.link(root)
        for obj in imported:
            if obj.parent is None:
                obj.parent = root
        root.location = (-(low.x + high.x) * 0.5, -(low.y + high.y) * 0.5, -low.z)
        groups.append(root)
        sizes.append(high - low)

    max_width = max(max(size.x, size.y) for size in sizes)
    max_height = max(size.z for size in sizes)
    columns = 1 if len(groups) == 1 else 5
    rows = math.ceil(len(groups) / columns)
    cell_width = max_width * 1.38
    cell_height = max_height * 1.25
    for index, root in enumerate(groups):
        column = index % columns
        row = index // columns
        root.location.x += (column - (columns - 1) * 0.5) * cell_width
        root.location.z += (rows - 1 - row) * cell_height

        bpy.ops.object.text_add(location=(root.location.x, -max_width * 0.72,
                                          root.location.z - max_height * 0.10))
        label = bpy.context.object
        label.data.body = root.name.rsplit("-", 1)[-1].upper()
        label.data.align_x = "CENTER"
        label.data.size = max_height * 0.055
        label.data.extrude = max_height * 0.002
        label.rotation_euler = (math.pi * 0.5, 0, 0)

    total_width = max(cell_width, columns * cell_width)
    total_height = max(cell_height, rows * cell_height)
    focus = Vector((0, 0, (rows - 1) * cell_height * 0.5 + max_height * 0.48))

    bpy.ops.mesh.primitive_plane_add(size=max(total_width, total_height) * 2.2,
                                     location=(0, 0, -0.025))
    floor = bpy.context.object
    floor_mat = bpy.data.materials.new("NeutralGround")
    floor_mat.diffuse_color = (0.12, 0.13, 0.14, 1)
    floor.data.materials.append(floor_mat)

    bpy.ops.object.camera_add(location=(0, -max(total_width, total_height) * 1.6, focus.z))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    aspect = scene.render.resolution_x / scene.render.resolution_y
    # Keep the full silhouettes and labels visible even for unusually wide end
    # variants (benches and handled urns exceed their family's median width).
    camera.data.ortho_scale = max(total_height * 1.85, total_width / aspect * 1.85)
    look_at(camera, focus)
    scene.camera = camera

    for name, location, energy, size in (
        ("Key", (-total_width * 0.35, -max_height, focus.z + max_height), 1500, max_height * 2.0),
        ("Fill", (total_width * 0.45, -max_height * 0.4, focus.z + max_height * 0.3), 900, max_height * 2.5),
        ("Rim", (0, max_height, focus.z + max_height * 1.2), 1200, max_height * 1.8),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        lamp = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(lamp)
        lamp.location = location
        look_at(lamp, focus)

    options.output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(options.output)
    bpy.ops.render.render(write_still=True)
    print(f"contact sheet -> {options.output}")


if __name__ == "__main__":
    main()
