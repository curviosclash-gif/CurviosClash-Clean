"""Render consistent transparent orbit views of a CurviosClash asset and measure silhouettes.

Adapted from the Codex skill blender-workflows. Differences: invisible collision hulls
(names containing `_colonly`) are hidden, since the game never draws them, and the report
names the game's axes (Blender Z is the game's height, Blender -Y the game's +Z).

    blender <asset>.blend --background --python .claude/skills/blender-assets/scripts/render_views.py \
        -- --output-dir <scratchpad>/views [--views 8] [--size 512] [--elevation 12] [--frame N]

Writes view_NN_DDDdeg.png and manifest.json into --output-dir. Never point it into the repo.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--views", type=int, default=8)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--elevation", type=float, default=12.0)
    parser.add_argument("--frame", type=int, help="animation frame to render (default: scene start)")
    return parser.parse_args(argv)


def drawn_meshes():
    return [obj for obj in bpy.context.scene.objects
            if obj.type == "MESH" and not obj.hide_render and "_colonly" not in obj.name.lower()]


def world_bounds(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not corners:
        raise RuntimeError("No drawn mesh geometry found")
    low = Vector(tuple(min(c[axis] for c in corners) for axis in range(3)))
    high = Vector(tuple(max(c[axis] for c in corners) for axis in range(3)))
    return low, high


def add_rig(center, span):
    collection = bpy.context.scene.collection
    camera_data = bpy.data.cameras.new("__PreviewCameraData")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(span * 1.22, 0.1)
    camera_data.clip_start = max(span * 0.001, 0.01)
    camera_data.clip_end = max(span * 5.0, 1000.0)
    camera = bpy.data.objects.new("__PreviewCamera", camera_data)
    collection.objects.link(camera)
    lights = []
    energy = 1000.0 * max(1.0, (span * span) / 16.0)
    for index, (offset, factor, size) in enumerate((
            ((0.75, -0.8, 1.25), 1.0, 5.0), ((-0.9, -0.2, 0.65), 0.5, 4.0), ((0.1, 0.9, 1.0), 0.7, 3.5))):
        data = bpy.data.lights.new(f"__PreviewLightData{index}", type="AREA")
        data.energy = energy * factor
        data.shape = "DISK"
        data.size = max(span * size / 10.0, 0.5)
        light = bpy.data.objects.new(f"__PreviewLight{index}", data)
        light.location = center + Vector(offset) * span
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        collection.objects.link(light)
        lights.append(light)
    return camera, lights


def silhouette(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        width, height = image.size
        pixels = image.pixels[:]
        xs, ys = [], []
        for y in range(height):
            row = y * width * 4
            for x in range(width):
                if pixels[row + x * 4 + 3] > 0.01:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            raise RuntimeError(f"Rendered image is fully transparent: {path}")
        corners = [pixels[3], pixels[(width - 1) * 4 + 3],
                   pixels[(height - 1) * width * 4 + 3], pixels[(height * width - 1) * 4 + 3]]
        return {"width_fraction": round((max(xs) - min(xs) + 1) / width, 4),
                "height_fraction": round((max(ys) - min(ys) + 1) / height, 4),
                "corner_alpha_max": round(max(corners), 4)}
    finally:
        bpy.data.images.remove(image)


def main():
    args = parse_args()
    if args.views < 4:
        raise ValueError("--views must be at least 4")
    scene = bpy.context.scene
    scene.frame_set(args.frame if args.frame is not None else scene.frame_start)

    hidden_hulls = [obj for obj in scene.objects if "_colonly" in obj.name.lower() and not obj.hide_render]
    for obj in hidden_hulls:
        obj.hide_render = True
    old_lights = {obj.name: obj.hide_render for obj in scene.objects if obj.type == "LIGHT"}
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True
    old_camera = scene.camera

    low, high = world_bounds(drawn_meshes())
    center = (low + high) * 0.5
    size = high - low
    span = max(size)
    radius = max(span * 2.25, 1.0)
    elevation = math.radians(args.elevation)

    camera, lights = add_rig(center, span)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT" if bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    args.output_dir.mkdir(parents=True, exist_ok=True)

    views = []
    try:
        for index in range(args.views):
            azimuth = 2.0 * math.pi * index / args.views
            horizontal = radius * math.cos(elevation)
            camera.location = center + Vector((math.cos(azimuth) * horizontal,
                                               math.sin(azimuth) * horizontal,
                                               radius * math.sin(elevation)))
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            degrees = round(math.degrees(azimuth)) % 360
            path = args.output_dir / f"view_{index:02d}_{degrees:03d}deg.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            views.append({"azimuth_degrees": degrees, "file": str(path), **silhouette(path)})
    finally:
        for light in lights:
            bpy.data.objects.remove(light, do_unlink=True)
        bpy.data.objects.remove(camera, do_unlink=True)
        scene.camera = old_camera
        for name, hidden in old_lights.items():
            if name in bpy.data.objects:
                bpy.data.objects[name].hide_render = hidden
        for obj in hidden_hulls:
            obj.hide_render = False

    widths = [view["width_fraction"] for view in views]
    manifest = {
        "blender_version": bpy.app.version_string,
        "blend_file": bpy.data.filepath or None,
        "frame": scene.frame_current,
        # Game axes: x = Blender x, height = Blender z, game z = Blender -y.
        "game_size_xyz": [round(size.x, 3), round(size.z, 3), round(size.y, 3)],
        "game_center_x": round(center.x, 3),
        "game_center_z": round(-center.y, 3),
        "game_base_y": round(low.z, 3),
        "hidden_collision_hulls": len(hidden_hulls),
        "silhouette_width_ratio": round(min(widths) / max(widths), 4),
        "views": views,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in manifest.items() if key != "views"}, indent=2))


if __name__ == "__main__":
    main()
