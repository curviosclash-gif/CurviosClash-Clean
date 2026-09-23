#!/usr/bin/env python3
"""Render consistent transparent turntable views and measure silhouettes.

Run with Blender, for example:
blender asset.blend --background --python render_views.py -- --output-dir previews --views 8
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


EXCLUDED_ROLES = {"collision", "helper", "preview_camera", "preview_light"}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--views", type=int, default=8)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--elevation", type=float, default=6.0)
    return parser.parse_args(argv)


def asset_objects() -> list[bpy.types.Object]:
    supported = {"MESH", "CURVE", "SURFACE", "FONT", "META"}
    return [
        obj
        for obj in bpy.context.scene.objects
        if obj.type in supported
        and not obj.hide_render
        and obj.get("asset_role") not in EXCLUDED_ROLES
        and not obj.name.startswith("COLLIDER_")
    ]


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners: list[Vector] = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not corners:
        raise RuntimeError("No renderable asset geometry found")
    minimum = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
    maximum = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
    return minimum, maximum


def create_camera_and_lights(center: Vector, span: float) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    collection = bpy.context.scene.collection
    camera_data = bpy.data.cameras.new("__SkillPreviewCameraData")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(span * 1.22, 0.1)
    camera_data.clip_start = max(span * 0.001, 0.01)
    camera_data.clip_end = max(span * 5.0, 1000.0)
    camera = bpy.data.objects.new("__SkillPreviewCamera", camera_data)
    camera["asset_role"] = "preview_camera"
    collection.objects.link(camera)

    lights: list[bpy.types.Object] = []
    settings = [
        ((0.75, -0.8, 1.25), 1.0, 5.0),
        ((-0.9, -0.2, 0.65), 0.5, 4.0),
        ((0.1, 0.9, 1.0), 0.7, 3.5),
    ]
    energy_base = 1000.0 * max(1.0, (span * span) / 16.0)
    for index, (offset, energy_factor, size_factor) in enumerate(settings):
        data = bpy.data.lights.new(f"__SkillPreviewLightData{index}", type="AREA")
        data.energy = energy_base * energy_factor
        data.shape = "DISK"
        data.size = max(span * size_factor / 10.0, 0.5)
        light = bpy.data.objects.new(f"__SkillPreviewLight{index}", data)
        light["asset_role"] = "preview_light"
        light.location = center + Vector(offset) * span
        light.rotation_euler = ((center - light.location).to_track_quat("-Z", "Y")).to_euler()
        collection.objects.link(light)
        lights.append(light)
    return camera, lights


def silhouette_metrics(path: Path) -> dict:
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        width, height = image.size
        pixels = image.pixels[:]
        xs: list[int] = []
        ys: list[int] = []
        for y in range(height):
            row = y * width * 4
            for x in range(width):
                if pixels[row + x * 4 + 3] > 0.01:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            raise RuntimeError(f"Rendered image is fully transparent: {path}")
        corners = [
            pixels[3],
            pixels[(width - 1) * 4 + 3],
            pixels[(height - 1) * width * 4 + 3],
            pixels[(height * width - 1) * 4 + 3],
        ]
        return {
            "pixel_bounds": [min(xs), min(ys), max(xs), max(ys)],
            "width_fraction": round((max(xs) - min(xs) + 1) / width, 6),
            "height_fraction": round((max(ys) - min(ys) + 1) / height, 6),
            "corner_alpha_max": round(max(corners), 6),
        }
    finally:
        bpy.data.images.remove(image)


def main() -> None:
    args = parse_args()
    if args.views < 4:
        raise ValueError("--views must be at least 4")
    if args.size < 64:
        raise ValueError("--size must be at least 64")

    objects = asset_objects()
    minimum, maximum = world_bounds(objects)
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    span = max(size)
    orbit_radius = max(span * 2.25, 1.0)
    elevation = math.radians(args.elevation)

    scene = bpy.context.scene
    args.output_dir.mkdir(parents=True, exist_ok=True)
    old_light_states = {obj.name: obj.hide_render for obj in scene.objects if obj.type == "LIGHT"}
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True

    camera, lights = create_camera_and_lights(center, span)
    scene.camera = camera
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT" if bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
    except TypeError:
        pass
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True

    views = []
    try:
        for index in range(args.views):
            azimuth = 2.0 * math.pi * index / args.views
            horizontal = orbit_radius * math.cos(elevation)
            camera.location = center + Vector(
                (
                    math.cos(azimuth) * horizontal,
                    math.sin(azimuth) * horizontal,
                    orbit_radius * math.sin(elevation),
                )
            )
            camera.rotation_euler = ((center - camera.location).to_track_quat("-Z", "Y")).to_euler()
            degrees = round(math.degrees(azimuth)) % 360
            path = args.output_dir / f"view_{index:02d}_{degrees:03d}deg.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            metrics = silhouette_metrics(path)
            views.append({"index": index, "azimuth_degrees": degrees, "file": str(path), **metrics})
    finally:
        for light in lights:
            bpy.data.objects.remove(light, do_unlink=True)
        bpy.data.objects.remove(camera, do_unlink=True)
        for name, hidden in old_light_states.items():
            if name in bpy.data.objects:
                bpy.data.objects[name].hide_render = hidden

    widths = [view["width_fraction"] for view in views]
    manifest = {
        "blender_version": bpy.app.version_string,
        "blend_file": bpy.data.filepath or None,
        "asset_bounds": {
            "min": [round(value, 6) for value in minimum],
            "max": [round(value, 6) for value in maximum],
            "size": [round(value, 6) for value in size],
        },
        "view_count": args.views,
        "silhouette_width_min": min(widths),
        "silhouette_width_max": max(widths),
        "silhouette_width_ratio": round(min(widths) / max(widths), 6),
        "views": views,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
