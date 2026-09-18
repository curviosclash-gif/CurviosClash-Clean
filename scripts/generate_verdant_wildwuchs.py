"""Deterministic, collision-free greenhouse foliage for Verdant Aperture.

Used by the blender-object-batches run_batch.py interface. All dimensions are
local Blender units; the map selects the final authored targetSize.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

GENERATOR_ID = "verdant-wildwuchs"
GENERATOR_VERSION = "1.0.0"


class Geometry:
    def __init__(self):
        self.parts = {}

    def part(self, material):
        return self.parts.setdefault(material, ([], []))

    def tube(self, points, radii, material, sides=5):
        vertices, faces = self.part(material)
        base = len(vertices)
        for index, point in enumerate(points):
            tangent = Vector(points[min(index + 1, len(points) - 1)]) - Vector(points[max(index - 1, 0)])
            tangent.normalize()
            normal = tangent.cross(Vector((0, 0, 1)))
            if normal.length < 0.05:
                normal = tangent.cross(Vector((0, 1, 0)))
            normal.normalize()
            bitangent = tangent.cross(normal).normalized()
            for side in range(sides):
                angle = 2 * math.pi * side / sides
                vertices.append(tuple(Vector(point) + radii[index] * (
                    math.cos(angle) * normal + math.sin(angle) * bitangent)))
        for index in range(len(points) - 1):
            for side in range(sides):
                a = base + index * sides + side
                b = base + index * sides + (side + 1) % sides
                c = b + sides
                d = a + sides
                faces.extend(((a, b, c), (a, c, d)))
        faces.append(tuple(base + side for side in reversed(range(sides))))
        faces.append(tuple(base + (len(points) - 1) * sides + side for side in range(sides)))

    def leaf(self, root, tip, width, material, lift=0.0):
        start, end = Vector(root), Vector(tip)
        direction = end - start
        side = direction.cross(Vector((0, 0, 1)))
        if side.length < 0.05:
            side = direction.cross(Vector((0, 1, 0)))
        side.normalize()
        vertices, faces = self.part(material)
        base = len(vertices)
        middle = start.lerp(end, 0.52) + Vector((0, 0, lift))
        vertices.extend((tuple(start), tuple(middle + side * width), tuple(end),
                         tuple(middle - side * width), tuple(middle + Vector((0, 0, width * 0.12)))))
        faces.extend(((base, base + 1, base + 4), (base + 1, base + 2, base + 4),
                      (base + 2, base + 3, base + 4), (base + 3, base, base + 4)))

    def objects(self, materials):
        result = []
        for key, (vertices, faces) in self.parts.items():
            mesh = bpy.data.meshes.new(f"Wildwuchs_{key}")
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            obj = bpy.data.objects.new(f"Wildwuchs_{key}_nocol", mesh)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(materials[key])
            result.append(obj)
        return result


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = False
    return mat


def palette():
    return {
        "bark": material("WetUmber", (0.21, 0.145, 0.09), 0.88),
        "deep": material("FernShadow", (0.085, 0.20, 0.105), 0.84),
        "green": material("VerdantLeaf", (0.20, 0.39, 0.16), 0.77),
        "tip": material("SunlitNewGrowth", (0.46, 0.60, 0.25), 0.72),
    }


def vines(geo, p, rng):
    count = int(p["shoots"])
    length = p["length"]
    spread = p["spread"]
    for shoot in range(count):
        angle = 2 * math.pi * shoot / count + rng.uniform(-0.18, 0.18)
        base = Vector((math.cos(angle) * spread * 0.37, math.sin(angle) * spread * 0.37, 0))
        reach = length * rng.uniform(0.68, 1.0)
        points = [tuple(base + Vector((math.cos(angle + 0.5 * t) * spread * 0.24 * t,
                                       math.sin(angle + 0.5 * t) * spread * 0.24 * t,
                                       -reach * t))) for t in (0, .25, .5, .75, 1)]
        geo.tube(points, [.065, .054, .04, .027, .012], "bark", 5)
        for node in range(1, int(p["leaf_pairs"]) + 1):
            t = node / (int(p["leaf_pairs"]) + 1)
            point = Vector(points[0]).lerp(Vector(points[-1]), t)
            for side in (-1, 1):
                a = angle + side * 1.35
                tip = point + Vector((math.cos(a) * (.35 + .2 * t),
                                      math.sin(a) * (.35 + .2 * t), -.12 - .18 * t))
                geo.leaf(point, tip, .16 + .045 * t, "tip" if node > p["leaf_pairs"] * .7 else "green")


def fern(geo, p, rng):
    count = int(p["fronds"])
    length = p["length"]
    spread = p["spread"]
    for index in range(count):
        angle = 2 * math.pi * index / count + rng.uniform(-.16, .16)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        reach = length * rng.uniform(.75, 1.12)
        apex = Vector((0, 0, .16)) + direction * spread * rng.uniform(.72, 1.05) + Vector((0, 0, reach * .44))
        points = [(0, 0, .12), tuple(direction * spread * .24 + Vector((0, 0, reach * .30))),
                  tuple(direction * spread * .62 + Vector((0, 0, reach * .53))), tuple(apex)]
        geo.tube(points, [.052, .039, .024, .009], "deep", 4)
        for node in range(1, int(p["pinnae"]) + 1):
            t = node / (int(p["pinnae"]) + 1)
            origin = Vector(points[0]).lerp(apex, t)
            lateral = Vector((-direction.y, direction.x, 0))
            width = (.43 + .1 * rng.random()) * (1 - .53 * t)
            for sign in (-1, 1):
                tip = origin + lateral * sign * width + direction * .18 + Vector((0, 0, -.08))
                geo.leaf(origin, tip, .14 * (1 - .3 * t), "green" if index % 3 else "tip", .04)
    # A few newer vertical shoots give the shrub-like variant a deeper centre.
    if p["habit"] == "shrub":
        for index in range(3):
            angle = index * 2 * math.pi / 3
            tip = Vector((math.cos(angle) * .38, math.sin(angle) * .38, length * .75))
            geo.tube([(0, 0, .08), tuple(tip * .55), tuple(tip)], [.045, .027, .01], "deep", 4)
            for z in (.42, .69):
                origin = tip * z
                geo.leaf(origin, origin + Vector((.35 * math.cos(angle), .35 * math.sin(angle), .26)), .17, "tip")


def roots(geo, p, rng):
    length = p["length"]
    bend = p["bend"]
    tip = Vector((length * .5, bend, .18))
    start = Vector((-length * .5, 0, .22))
    middle = Vector((0, bend * .52, .42))
    geo.tube([tuple(start), tuple(start.lerp(middle, .5)), tuple(middle),
              tuple(middle.lerp(tip, .5)), tuple(tip)], [.16, .26, .32, .23, .09], "bark", 7)
    for index in range(int(p["forks"])):
        t = .18 + .64 * index / max(1, int(p["forks"]) - 1)
        base = start.lerp(tip, t) + Vector((0, bend * math.sin(math.pi * t) * .28, .12))
        side = -1 if index % 2 else 1
        end = base + Vector((rng.uniform(-.3, .3), side * rng.uniform(.75, 1.5), -.22))
        geo.tube([tuple(base), tuple(base.lerp(end, .55) + Vector((0, 0, .15))), tuple(end)],
                 [.14, .09, .018], "bark", 5)
    for index in range(int(p["moss_clusters"])):
        t = (index + .5) / int(p["moss_clusters"])
        origin = start.lerp(tip, t) + Vector((0, bend * math.sin(math.pi * t) * .28, .3))
        for leaf_index in range(5):
            angle = 2 * math.pi * leaf_index / 5 + rng.uniform(-.22, .22)
            extent = rng.uniform(.22, .45)
            end = origin + Vector((extent * math.cos(angle), extent * math.sin(angle), .17 + extent * .3))
            geo.leaf(origin, end, .09, "deep" if leaf_index % 3 == 0 else "green")


def signature(objects):
    # glTF duplicates vertex records across hard normals and material seams. Compare
    # geometric positions, not the representation-specific vertex record count.
    vertices = len({tuple(round(value, 4) for value in obj.matrix_world @ vertex.co)
                    for obj in objects for vertex in obj.data.vertices})
    triangles = sum(len(poly.vertices) - 2 for obj in objects for poly in obj.data.polygons)
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    lower = [min(point[axis] for point in points) for axis in range(3)]
    upper = [max(point[axis] for point in points) for axis in range(3)]
    materials = sorted({mat.name for obj in objects for mat in obj.data.materials})
    return vertices, triangles, lower, upper, materials


def render_views(path, objects):
    world = bpy.context.scene.world or bpy.data.worlds.new("PreviewWorld")
    bpy.context.scene.world = world
    world.color = (.23, .26, .23)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    vertices = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    centre = sum(vertices, Vector()) / len(vertices)
    extent = max(max(v[axis] for v in vertices) - min(v[axis] for v in vertices) for axis in range(3))
    light_data = bpy.data.lights.new("PreviewSoftbox", "AREA")
    light = bpy.data.objects.new("PreviewSoftbox", light_data)
    bpy.context.collection.objects.link(light)
    light.location = centre + Vector((extent, -extent, extent * 1.7))
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = extent * 2
    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = extent * 1.7
    for label, direction in (("front", (0, -1, .4)), ("side", (1, 0, .4)),
                             ("rear", (0, 1, .4)), ("game", (1, -1, .75))):
        camera.location = centre + Vector(direction).normalized() * extent * 2.6
        camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(path / f"{label}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(light, do_unlink=True)


def build_variant(context):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(context["seed"])
    geo = Geometry()
    params = context["parameters"]
    family = context["invariants"]["family"]
    if family == "vine":
        vines(geo, params, rng)
    elif family == "fern":
        fern(geo, params, rng)
    elif family == "root":
        roots(geo, params, rng)
    else:
        raise ValueError(f"unknown family {family}")
    objects = geo.objects(palette())
    before = signature(objects)
    output = Path(context["output_dir"])
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "source.blend"))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output / "runtime.glb"), export_format="GLB",
                              use_selection=True, export_animations=False, export_apply=True)
    render_views(output, objects)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(output / "runtime.glb"))
    imported = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    after = signature(imported)
    if before[:2] != after[:2] or before[4] != after[4] or any(
        abs(a - b) > .002 for a, b in zip(before[2] + before[3], after[2] + after[3])
    ):
        raise ValueError(f"GLB roundtrip changed geometry, bounds or materials: {before} vs {after}")
    if bpy.data.actions:
        raise ValueError("static foliage unexpectedly imported animation")
    return {
        "outputs": [{"role": "editable", "path": str(output / "source.blend")},
                    {"role": "runtime", "path": str(output / "runtime.glb")}],
        "metrics": {"vertices": before[0], "triangles": before[1],
                    "materials": len(before[4]), "file_size_bytes": (output / "runtime.glb").stat().st_size,
                    "roundtrip_import": True},
        "metadata": {"bounds_min": before[2], "bounds_max": before[3], "materials": before[4],
                     "views": ["front", "side", "rear", "game"], "animation_count": 0},
    }
