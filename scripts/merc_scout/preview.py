"""Multi-view renders for geometry review.

Renders are scratch material: they go to a scratch directory, never into the
repository. Every view uses the same lighting and camera framing so two runs can
be compared side by side.
"""

from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector

from . import mesh_utils as mu

VIEWS = ("front", "side", "back", "three_quarter", "head", "face", "profile")


def _aim(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_render(resolution: tuple[int, int] = (520, 700), samples: int = 16,
                 engine: str = "CYCLES") -> list[bpy.types.Object]:
    scene = bpy.context.scene
    scene.render.engine = engine
    if engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    else:
        scene.eevee.taa_render_samples = samples
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("preview_environment")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.17, 0.19, 0.22, 1.0)
    background.inputs["Strength"].default_value = 0.7
    scene.world = world

    lights: list[bpy.types.Object] = []
    for name, location, energy, colour, size in (
        ("key", (-2.4, -3.2, 3.4), 850, (1.0, 0.96, 0.90), 3.2),
        ("fill", (3.2, -2.2, 1.5), 300, (0.62, 0.76, 1.0), 2.6),
        ("rim", (0.6, 3.4, 2.9), 700, (0.86, 0.92, 1.0), 2.2),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = colour
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        _aim(obj, (0.0, 0.0, 1.0))
        lights.append(obj)
    return lights


def render_views(objects: list[bpy.types.Object], output_dir: Path, *, prefix: str = "",
                 resolution: tuple[int, int] = (520, 700), samples: int = 16,
                 height: float = 0.90, views: tuple[str, ...] = VIEWS,
                 engine: str = "CYCLES") -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    setup_render(resolution, samples, engine)
    low, high = mu.bounds(objects)
    centre = (low + high) * 0.5
    span = max(high.z - low.z, high.x - low.x) * 1.14
    distance = span * 2.4
    target = (centre.x, centre.y, centre.z)

    camera_data = bpy.data.cameras.new("preview_camera")
    camera = bpy.data.objects.new("preview_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    frames = {
        "front": ("ORTHO", (centre.x, centre.y - distance, centre.z), target, span),
        "side": ("ORTHO", (centre.x + distance, centre.y, centre.z), target, span),
        "back": ("ORTHO", (centre.x, centre.y + distance, centre.z), target, span),
        "three_quarter": ("PERSP", (centre.x - distance * 0.5, centre.y - distance * 0.5,
                                    centre.z + span * 0.16), target, 55.0),
        "head": ("PERSP", (0.36, -0.62, 1.76), (0.0, -0.02, 1.67), 85.0),
        "face": ("ORTHO", (0.0, -2.0, 1.684), (0.0, 0.0, 1.684), 0.30),
        "profile": ("ORTHO", (2.0, -0.01, 1.684), (0.0, -0.01, 1.684), 0.30),
    }

    written: list[Path] = []
    for name in views:
        kind, location, aim, value = frames[name]
        camera_data.type = kind
        if kind == "ORTHO":
            camera_data.ortho_scale = value
        else:
            camera_data.lens = value
        camera.location = location
        _aim(camera, aim)
        path = output_dir / f"{prefix}{name}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        written.append(path)
    return written
