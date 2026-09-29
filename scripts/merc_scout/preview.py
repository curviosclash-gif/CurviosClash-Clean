"""Multi-view renders for geometry review and for the shop page.

Renders are scratch material: they go to a scratch directory, never into the
repository. Every view uses the same lighting and camera framing so two runs can be
compared side by side.

The light rig mimics a portrait studio rather than a game level: one large soft key,
a cooler fill, a rim that separates the silhouette from the background, and a weak
bounce card from below. A flat three-point rig with small hard lights is what makes
a model look like painted plastic.
"""

from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector

from . import mesh_utils as mu

VIEWS = ("front", "side", "back", "three_quarter", "head", "face", "profile", "hand")


def _aim(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def _gradient_world(scene: bpy.types.Scene, top: tuple, bottom: tuple, strength: float) -> None:
    """A sky-to-floor gradient: soft ambient that a flat grey cannot provide."""
    world = bpy.data.worlds.new("preview_environment")
    world.use_nodes = True
    tree = world.node_tree
    background = tree.nodes["Background"]
    background.inputs["Strength"].default_value = strength
    coordinates = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*bottom, 1.0)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (*top, 1.0)
    tree.links.new(coordinates.outputs["Generated"], separate.inputs["Vector"])
    tree.links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], background.inputs["Color"])
    scene.world = world


def _clear_previous(scene: bpy.types.Scene) -> None:
    """Remove the rig of an earlier call: otherwise lights stack and the render blows out."""
    for name in ("key", "fill", "rim", "bounce", "ground", "preview_camera", "motion_camera"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
    for world in [item for item in bpy.data.worlds if item.name.startswith("preview_environment")]:
        bpy.data.worlds.remove(world)


def setup_render(resolution: tuple[int, int] = (520, 700), samples: int = 16,
                 engine: str = "CYCLES", *, exposure: float = -0.2,
                 ground: bool = False) -> list[bpy.types.Object]:
    scene = bpy.context.scene
    _clear_previous(scene)
    scene.render.engine = engine
    if engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    else:
        scene.eevee.taa_render_samples = samples
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = not ground
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = exposure
    try:
        scene.view_settings.look = "AgX - Base Contrast"
    except TypeError:  # look names differ between Blender builds
        pass

    _gradient_world(scene, top=(0.42, 0.47, 0.55), bottom=(0.16, 0.14, 0.13), strength=0.55)

    lights: list[bpy.types.Object] = []
    rig = (
        # name, location, energy, colour, size, target
        ("key", (-1.9, -2.6, 2.95), 430, (1.0, 0.95, 0.88), 2.6, (0.0, 0.0, 1.28)),
        ("fill", (2.5, -2.1, 1.45), 130, (0.72, 0.82, 1.0), 3.0, (0.0, 0.0, 1.15)),
        ("rim", (0.9, 2.7, 2.45), 380, (0.96, 0.98, 1.0), 1.8, (0.0, 0.0, 1.35)),
        ("bounce", (0.0, -1.3, 0.05), 70, (0.88, 0.82, 0.75), 3.0, (0.0, 0.0, 0.75)),
    )
    for name, location, energy, colour, size, target in rig:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = colour
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        _aim(obj, target)
        lights.append(obj)

    if ground:
        mesh = bpy.data.meshes.new("ground")
        size = 12.0
        mesh.from_pydata([(-size, -size, 0.0), (size, -size, 0.0), (size, size, 0.0),
                          (-size, size, 0.0)], [], [(0, 1, 2, 3)])
        mesh.update()
        material = bpy.data.materials.new("ground_material")
        material.use_nodes = True
        bsdf = material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (0.24, 0.24, 0.25, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.75
        mesh.materials.append(material)
        plane = bpy.data.objects.new("ground", mesh)
        scene.collection.objects.link(plane)
        lights.append(plane)
    return lights


def render_views(objects: list[bpy.types.Object], output_dir: Path, *, prefix: str = "",
                 resolution: tuple[int, int] = (520, 700), samples: int = 16,
                 height: float = 0.90, views: tuple[str, ...] = VIEWS,
                 engine: str = "CYCLES", ground: bool = False,
                 exposure: float = -0.2) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    setup_render(resolution, samples, engine, exposure=exposure, ground=ground)
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
        "three_quarter": ("PERSP", (centre.x - distance * 0.46, centre.y - distance * 0.52,
                                    centre.z + span * 0.14), target, 62.0),
        "hero": ("PERSP", (centre.x - distance * 0.42, centre.y - distance * 0.50,
                           centre.z + span * 0.10), (centre.x, centre.y, centre.z + 0.06), 78.0),
        "head": ("PERSP", (0.34, -0.58, 1.755), (0.0, -0.015, 1.672), 95.0),
        "face": ("ORTHO", (0.0, -2.0, 1.678), (0.0, 0.0, 1.678), 0.34),
        "profile": ("ORTHO", (2.0, -0.01, 1.678), (0.0, -0.01, 1.678), 0.34),
        "hand": ("PERSP", (0.80, -0.60, 1.18), (0.556, -0.042, 1.02), 85.0),
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
