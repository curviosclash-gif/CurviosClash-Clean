"""Bake ambient occlusion into the painted base-colour maps.

Ambient occlusion (AO) is the soft shading that appears where surfaces sit close
together: under the chin, in the armpits, inside a cloth fold, under the belt. It
is what makes a model stop looking like painted plastic. There is no bake farm
here and the runtime does not ray trace, so it is computed once:

1. one BVH tree over *all* meshes, so a sleeve occludes the torso and not only
   itself,
2. one deterministic hemisphere scan per vertex (golden-spiral directions, no
   random numbers),
3. the result multiplied into the base-colour atlas at each loop's UV position.

Because the occlusion ends up in the texture instead of in a shader node, both
the preview renders and the buyer's engine show it, and no material graph has to
change.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

#: How much of the geometric occlusion ends up in the colour. 1.0 would be
#: physically pure and much too dark for a stylised product.
DEFAULT_STRENGTH = 0.72


def hemisphere_directions(count: int) -> list[Vector]:
    """Cosine-weighted directions over the upper hemisphere, deterministic."""
    directions: list[Vector] = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for index in range(count):
        z = (index + 0.5) / count
        radius = math.sqrt(max(0.0, 1.0 - z * z))
        angle = golden * index
        directions.append(Vector((math.cos(angle) * radius, math.sin(angle) * radius, z)))
    return directions


def _scene_bvh(objects: list[bpy.types.Object]) -> tuple[BVHTree, list[Vector]]:
    """One BVH over every object in world space, plus all sample points."""
    points: list[Vector] = []
    triangles: list[tuple[int, int, int]] = []
    for obj in objects:
        mesh = obj.data
        matrix = obj.matrix_world
        base = len(points)
        points.extend(matrix @ vertex.co for vertex in mesh.vertices)
        mesh.calc_loop_triangles()
        triangles.extend(tuple(base + index for index in triangle.vertices)
                         for triangle in mesh.loop_triangles)
    return BVHTree.FromPolygons(points, triangles, all_triangles=True), points


def vertex_occlusion(objects: list[bpy.types.Object], *, samples: int = 20,
                     distance: float = 0.22) -> dict[str, np.ndarray]:
    """Occlusion per vertex in ``[0, 1]``: 0 lit, 1 fully occluded."""
    tree, _points = _scene_bvh(objects)
    directions = hemisphere_directions(samples)
    result: dict[str, np.ndarray] = {}
    for obj in objects:
        matrix = obj.matrix_world
        mesh = obj.data
        mesh.calc_normals_split() if hasattr(mesh, "calc_normals_split") else None
        occlusion = np.zeros(len(mesh.vertices), dtype=np.float32)
        for vertex in mesh.vertices:
            point = matrix @ vertex.co
            normal = (matrix.to_3x3() @ vertex.normal).normalized()
            if normal.length < 1e-6:
                continue
            # An arbitrary frame around the normal; only the hemisphere matters.
            helper = Vector((0.0, 0.0, 1.0)) if abs(normal.z) < 0.9 else Vector((1.0, 0.0, 0.0))
            side = normal.cross(helper).normalized()
            up = normal.cross(side)
            origin = point + normal * 0.0025
            hits = 0
            for x, y, z in directions:
                direction = (side * x + up * y + normal * z).normalized()
                location, _hit_normal, _index, ray_distance = tree.ray_cast(origin, direction, distance)
                if location is not None:
                    # Distance falloff: contact shadows darken, broad occlusion less.
                    hits += 1.0 - min(1.0, ray_distance / distance) * 0.55
            occlusion[vertex.index] = min(1.0, hits / len(directions))
        result[obj.name] = occlusion
    return result


def _base_colour_images(materials: dict[str, bpy.types.Material]) -> dict[str, bpy.types.Image]:
    """The base-colour image of each material, found by name, not by wiring.

    Looking at what feeds the Base Color input was enough until the painter grew a
    richer node graph (blend and detail nodes between the image and the shader).
    Searching the tree for an image whose name ends in ``_BaseColor`` survives that.
    """
    images: dict[str, bpy.types.Image] = {}
    for name, material in materials.items():
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            if node.image.name.endswith("_BaseColor"):
                images[name] = node.image
                break
    return images


def _material_of(obj: bpy.types.Object) -> str | None:
    if not obj.material_slots:
        return None
    material = obj.material_slots[0].material
    return material.name.replace("merc_scout_", "") if material else None


def bake_occlusion(objects: list[bpy.types.Object],
                   materials: dict[str, bpy.types.Material], *,
                   strength: float = DEFAULT_STRENGTH, samples: int = 20,
                   distance: float = 0.22) -> dict:
    """Multiply the baked occlusion into every base-colour map.

    Returns a report with the occlusion range per object, which is the number that
    says whether the bake did anything at all.
    """
    occlusion = vertex_occlusion(objects, samples=samples, distance=distance)
    images = _base_colour_images(materials)
    layers: dict[str, np.ndarray] = {}
    sizes: dict[str, tuple[int, int]] = {}

    for obj in objects:
        material_name = _material_of(obj)
        if material_name is None or material_name not in images:
            continue
        image = images[material_name]
        if material_name not in layers:
            width, height = image.size
            layers[material_name] = np.zeros((height, width), dtype=np.float32)
            sizes[material_name] = (width, height)
        layer = layers[material_name]
        width, height = sizes[material_name]
        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        if uv_layer is None:
            continue
        values = occlusion[obj.name]
        for loop in mesh.loops:
            u, v = uv_layer.data[loop.index].uv
            x = int((u % 1.0) * width)
            y = int((v % 1.0) * height)
            value = values[loop.vertex_index]
            # A 3x3 splat: a single pixel leaves speckles after minification.
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    px = min(width - 1, max(0, x + dx))
                    py = min(height - 1, max(0, y + dy))
                    if value > layer[py, px]:
                        layer[py, px] = value

    report: dict = {"strength": strength, "samples": samples, "distance": distance,
                    "objects": {}, "images": {}}
    for obj in objects:
        values = occlusion.get(obj.name)
        if values is not None:
            report["objects"][obj.name] = {"mean": round(float(values.mean()), 4),
                                           "max": round(float(values.max()), 4)}

    for material_name, layer in layers.items():
        image = images[material_name]
        width, height = sizes[material_name]
        # Blur the layer a little so a coarse mesh does not produce hard blobs.
        blurred = layer.copy()
        for _ in range(2):
            blurred = (blurred + np.roll(blurred, 1, axis=0) + np.roll(blurred, -1, axis=0)
                       + np.roll(blurred, 1, axis=1) + np.roll(blurred, -1, axis=1)) / 5.0
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape(height, width, 4)
        factor = 1.0 - np.clip(blurred, 0.0, 1.0) * strength
        rgba[..., :3] *= factor[..., None]
        image.pixels.foreach_set(rgba.reshape(-1))
        image.update()
        if image.filepath_raw:
            image.file_format = "PNG"
            image.save()
        report["images"][material_name] = {
            "darkest_factor": round(float(factor.min()), 4),
            "mean_factor": round(float(factor.mean()), 4),
            "file": image.filepath_raw,
        }
    return report
