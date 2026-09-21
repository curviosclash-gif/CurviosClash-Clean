"""Generate the static Hydra temple ring used by the built-in map."""
from math import cos, pi, sin, tau
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "hydra_temple" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "hydra_temple" / "glb"
SETPIECES = (("hydra_temple",),)


def material(name, color, roughness=0.9):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return value


def add_cube(name, location, dimensions, surface):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    value = bpy.context.object
    value.name = name
    value.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    value.data.materials.append(surface)
    return value


def export_setpiece(stem):
    if stem != "hydra_temple":
        raise ValueError(f"Unknown Hydra temple part: {stem}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    dark = material("basalt | charcoal", (0.055, 0.064, 0.071))
    path = material("basalt | worn path", (0.11, 0.12, 0.125))
    edge = material("basalt | temple edge", (0.19, 0.16, 0.12))
    add_cube("Arena | basalt floor", (0, 0, -1.5), (100, 100, 3), dark)

    vertices = []
    faces = []
    segments = 96
    for radius in (19, 29):
        for index in range(segments):
            angle = 2 * pi * index / segments
            vertices.append((radius * cos(angle), radius * sin(angle), 0.08))
    for index in range(segments):
        following = (index + 1) % segments
        faces.append((index, following, segments + following, segments + index))
    mesh = bpy.data.meshes.new("Ring path mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    ring = bpy.data.objects.new("Ring | broad walkable path", mesh)
    bpy.context.collection.objects.link(ring)
    ring.data.materials.append(path)

    heights = (4.6, 5.2, 3.8, 5.8, 4.1, 5.1, 3.5, 4.8)
    for index, height in enumerate(heights):
        angle = (index + 0.5) * tau / len(heights)
        x, y = 34 * cos(angle), 34 * sin(angle)
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=8, radius=1.9, depth=height, location=(x, y, height / 2)
        )
        pillar = bpy.context.object
        pillar.name = f"Cover | broken column {index + 1}"
        pillar.rotation_euler.z = angle
        pillar.data.materials.append(edge)
        add_cube(f"Cover | plinth {index + 1}", (x, y, 0.35), (4.5, 4.5, 0.7), dark)

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    blend_path = SOURCE_DIR / f"{stem}.blend"
    glb_path = GLB_DIR / f"{stem}.glb"
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_animations=False, export_apply=True,
    )
