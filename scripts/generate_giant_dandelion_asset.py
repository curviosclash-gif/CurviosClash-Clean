#!/usr/bin/env python3
"""Generate the giant dandelion source, runtime LODs, collision, and QA renders.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_giant_dandelion_asset.py

The asset is deterministic. Geometry uses real mesh filaments instead of alpha cards so the
white seed silhouette remains stable from every gameplay angle.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import cos, pi, radians, sin, sqrt
from pathlib import Path
import random

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "models" / "giant_dandelion"
SOURCE_DIR = ASSET_DIR / "blender"
PREVIEW_DIR = SOURCE_DIR / "previews"
BLEND_PATH = SOURCE_DIR / "giant_dandelion.blend"
HERO_PATH = ASSET_DIR / "giant_dandelion.glb"
SHOOTABLE_PATH = ASSET_DIR / "giant_dandelion_shootable.glb"
LOD1_PATH = ASSET_DIR / "giant_dandelion_lod1.glb"
LOD2_PATH = ASSET_DIR / "giant_dandelion_lod2.glb"
COLLISION_PATH = ASSET_DIR / "giant_dandelion_collision.glb"

SEED = 27041984
GOLDEN_ANGLE = pi * (3.0 - sqrt(5.0))
HEAD_CENTER = Vector((1.12, 0.08, 14.45))
STEM_TOP = Vector((1.08, 0.06, 13.78))


@dataclass(frozen=True)
class LodProfile:
    label: str
    seed_count: int
    bristles_per_seed: int
    leaf_count: int
    stem_sides: int
    detached_seed_count: int


PROFILES = (
    LodProfile("HERO", 252, 12, 12, 20, 9),
    LodProfile("LOD1", 150, 8, 10, 14, 5),
    LodProfile("LOD2", 72, 5, 8, 10, 0),
)
SHOOTABLE_PROFILE = LodProfile("SHOOTABLE", 252, 12, 12, 20, 0)


class MeshBuilder:
    def __init__(self):
        self.vertices: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.material_indices: list[int] = []

    def vertex(self, point):
        self.vertices.append(tuple(Vector(point)))
        return len(self.vertices) - 1

    def face(self, indices, material_index=0):
        self.faces.append(tuple(indices))
        self.material_indices.append(material_index)

    def add_cylinder(self, start, end, radius, sides=6, material_index=0,
                     end_radius=None, caps=True):
        start = Vector(start)
        end = Vector(end)
        axis = end - start
        if axis.length < 1.0e-6:
            return
        direction = axis.normalized()
        helper = Vector((0, 0, 1)) if abs(direction.z) < 0.92 else Vector((0, 1, 0))
        u = direction.cross(helper).normalized()
        v = direction.cross(u).normalized()
        end_radius = radius if end_radius is None else end_radius
        lower = []
        upper = []
        for index in range(sides):
            angle = 2.0 * pi * index / sides
            radial = u * cos(angle) + v * sin(angle)
            lower.append(self.vertex(start + radial * radius))
            upper.append(self.vertex(end + radial * end_radius))
        for index in range(sides):
            nxt = (index + 1) % sides
            self.face((lower[index], lower[nxt], upper[nxt], upper[index]), material_index)
        if caps:
            self.face(tuple(reversed(lower)), material_index)
            self.face(tuple(upper), material_index)

    def add_tube(self, points, radii, sides=16, material_index=0):
        rings = []
        for point_index, point in enumerate(points):
            if point_index == 0:
                tangent = Vector(points[1]) - Vector(points[0])
            elif point_index == len(points) - 1:
                tangent = Vector(points[-1]) - Vector(points[-2])
            else:
                tangent = Vector(points[point_index + 1]) - Vector(points[point_index - 1])
            tangent.normalize()
            helper = Vector((0, 0, 1)) if abs(tangent.z) < 0.92 else Vector((0, 1, 0))
            u = tangent.cross(helper).normalized()
            v = tangent.cross(u).normalized()
            ring = []
            for side in range(sides):
                angle = 2.0 * pi * side / sides
                radial = u * cos(angle) + v * sin(angle)
                ring.append(self.vertex(Vector(point) + radial * radii[point_index]))
            rings.append(ring)
        for ring_index in range(len(rings) - 1):
            lower = rings[ring_index]
            upper = rings[ring_index + 1]
            for side in range(sides):
                nxt = (side + 1) % sides
                self.face((lower[side], lower[nxt], upper[nxt], upper[side]), material_index)
        self.face(tuple(reversed(rings[0])), material_index)
        self.face(tuple(rings[-1]), material_index)

    def add_uv_sphere(self, center, radii, segments=20, rings=10, material_index=0):
        center = Vector(center)
        rx, ry, rz = radii
        top = self.vertex(center + Vector((0, 0, rz)))
        rows = []
        for ring in range(1, rings):
            theta = pi * ring / rings
            row = []
            for segment in range(segments):
                phi = 2.0 * pi * segment / segments
                row.append(self.vertex(center + Vector((
                    rx * sin(theta) * cos(phi),
                    ry * sin(theta) * sin(phi),
                    rz * cos(theta),
                ))))
            rows.append(row)
        bottom = self.vertex(center - Vector((0, 0, rz)))
        for segment in range(segments):
            nxt = (segment + 1) % segments
            self.face((top, rows[0][segment], rows[0][nxt]), material_index)
        for ring in range(len(rows) - 1):
            for segment in range(segments):
                nxt = (segment + 1) % segments
                self.face((rows[ring][segment], rows[ring + 1][segment],
                           rows[ring + 1][nxt], rows[ring][nxt]), material_index)
        for segment in range(segments):
            nxt = (segment + 1) % segments
            self.face((rows[-1][nxt], rows[-1][segment], bottom), material_index)

    def add_spindle(self, start, end, radius, sides=7, material_index=0):
        start = Vector(start)
        end = Vector(end)
        axis = end - start
        direction = axis.normalized()
        helper = Vector((0, 0, 1)) if abs(direction.z) < 0.92 else Vector((0, 1, 0))
        u = direction.cross(helper).normalized()
        v = direction.cross(u).normalized()
        start_index = self.vertex(start)
        end_index = self.vertex(end)
        middle = start.lerp(end, 0.53)
        ring = []
        for side in range(sides):
            angle = 2.0 * pi * side / sides
            ring.append(self.vertex(middle + (u * cos(angle) + v * sin(angle)) * radius))
        for side in range(sides):
            nxt = (side + 1) % sides
            self.face((start_index, ring[side], ring[nxt]), material_index)
            self.face((end_index, ring[nxt], ring[side]), material_index)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "GiantDandelion"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 120
    scene["asset"] = "giant_dandelion"
    scene["species_grammar"] = "Taraxacum rosette, leafless scape, spherical pappus head"
    scene["height_m"] = 17.8
    scene["seed"] = SEED
    scene["generator"] = "scripts/generate_giant_dandelion_asset.py"
    scene["wind_mechanism"] = "WindGust morph and one-shot SeedFlight animation"
    bpy.context.preferences.filepaths.save_version = 0

    world = bpy.data.worlds.new("DandelionWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.085, 0.12, 1)
    background.inputs["Strength"].default_value = 0.28
    scene.world = world
    return scene


def material(name, color, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


def build_materials():
    return {
        "stem": material("ScapeGreen", (0.16, 0.31, 0.085, 1), 0.76),
        "leaf": material("LeafGreen", (0.12, 0.285, 0.065, 1), 0.83),
        "leaf_dark": material("LeafShadow", (0.055, 0.16, 0.035, 1), 0.9),
        "leaf_dry": material("LeafDryTips", (0.30, 0.265, 0.085, 1), 0.92),
        "receptacle": material("SeedReceptacle", (0.23, 0.18, 0.08, 1), 0.88),
        "achene": material("Achene", (0.31, 0.24, 0.13, 1), 0.82),
        "pappus": material("PappusIvory", (0.94, 0.955, 0.93, 1), 0.62),
        "pappus_shadow": material("PappusShadow", (0.60, 0.67, 0.65, 1), 0.74),
        "ground": material("PresentationGround", (0.105, 0.145, 0.075, 1), 0.96),
        "scale_figure": material("ScaleFigure", (0.62, 0.20, 0.075, 1), 0.74),
    }


def make_collection(scene, name, hide_render=False):
    collection = bpy.data.collections.new(name)
    scene.collection.children.link(collection)
    collection.hide_render = hide_render
    return collection


def object_from_builder(name, builder, collection, materials, role, lod):
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update()
    for mat in materials:
        mesh.materials.append(mat)
    for polygon, material_index in zip(mesh.polygons, builder.material_indices):
        polygon.material_index = material_index
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj["asset"] = "giant_dandelion"
    obj["role"] = role
    obj["lod"] = lod
    return obj


def append_leaf(builder, rng, angle, length, max_width, material_index, segments=16):
    radial = Vector((cos(angle), sin(angle), 0))
    tangent = Vector((-sin(angle), cos(angle), 0))
    top_left = []
    top_right = []
    bottom_left = []
    bottom_right = []
    thickness = 0.035
    phase = rng.uniform(-0.7, 0.7)
    lateral_curve = rng.uniform(-0.16, 0.16)
    lift = rng.uniform(0.58, 0.92)
    droop = rng.uniform(0.34, 0.72)
    lobes = rng.randint(5, 7)
    for index in range(segments + 1):
        t = index / segments
        center = radial * (0.24 + length * t)
        center += tangent * (lateral_curve * length * sin(pi * t))
        center.z = 0.16 + lift * sin(pi * t) - droop * (t ** 2.2)
        envelope = max(0.025, sin(pi * t) ** 0.72)
        serration = 0.60 + 0.40 * abs(sin((lobes + 0.5) * pi * t + phase))
        width = max_width * envelope * serration
        top_left.append(builder.vertex(center + tangent * width + Vector((0, 0, thickness))))
        top_right.append(builder.vertex(center - tangent * width + Vector((0, 0, thickness))))
        bottom_left.append(builder.vertex(center + tangent * width - Vector((0, 0, thickness))))
        bottom_right.append(builder.vertex(center - tangent * width - Vector((0, 0, thickness))))
    for index in range(segments):
        nxt = index + 1
        builder.face((top_left[index], top_right[index], top_right[nxt], top_left[nxt]),
                     material_index)
        builder.face((bottom_right[index], bottom_left[index], bottom_left[nxt],
                      bottom_right[nxt]), material_index)
        builder.face((top_left[index], top_left[nxt], bottom_left[nxt], bottom_left[index]),
                     material_index)
        builder.face((top_right[nxt], top_right[index], bottom_right[index], bottom_right[nxt]),
                     material_index)


def build_stem(collection, profile, materials):
    builder = MeshBuilder()
    points = []
    radii = []
    ring_count = 25
    for index in range(ring_count):
        t = index / (ring_count - 1)
        points.append(Vector((
            0.04 + 1.03 * (t ** 1.72) + 0.055 * sin(t * pi * 3.0),
            0.025 * sin(t * pi * 2.0) + 0.045 * sin(t * pi * 5.0),
            0.30 + 13.48 * t,
        )))
        radii.append(0.255 * (1.0 - 0.43 * t) + 0.018 * sin(pi * t))
    builder.add_tube(points, radii, sides=profile.stem_sides, material_index=0)
    builder.add_uv_sphere((0.02, 0, 0.28), (0.48, 0.46, 0.22),
                          segments=profile.stem_sides, rings=6, material_index=0)
    return object_from_builder(f"Scape_{profile.label}", builder, collection,
                               [materials["stem"]], "scape", profile.label)


def build_leaves(collection, profile, materials, rng):
    builder = MeshBuilder()
    for index in range(profile.leaf_count):
        angle = index * GOLDEN_ANGLE + rng.uniform(-0.13, 0.13)
        length = rng.uniform(3.55, 5.1) * (0.92 if profile.label == "LOD2" else 1.0)
        width = rng.uniform(0.58, 0.86)
        material_index = 2 if index in (2, 9) and profile.label in ("HERO", "SHOOTABLE") else index % 2
        append_leaf(builder, rng, angle, length, width, material_index,
                    segments=16 if profile.label in ("HERO", "SHOOTABLE") else 11)
    return object_from_builder(f"RosetteLeaves_{profile.label}", builder, collection,
                               [materials["leaf"], materials["leaf_dark"], materials["leaf_dry"]],
                               "basal_rosette", profile.label)


def stable_frame(direction):
    direction = Vector(direction).normalized()
    helper = Vector((0, 0, 1)) if abs(direction.z) < 0.88 else Vector((0, 1, 0))
    u = direction.cross(helper).normalized()
    v = direction.cross(u).normalized()
    return u, v


def fibonacci_directions(count, rng):
    for index in range(count):
        z = 1.0 - 2.0 * (index + 0.5) / count
        radius = sqrt(max(0.0, 1.0 - z * z))
        phi = index * GOLDEN_ANGLE
        direction = Vector((radius * cos(phi), radius * sin(phi), z))
        u, v = stable_frame(direction)
        direction = (direction + u * rng.uniform(-0.035, 0.035)
                     + v * rng.uniform(-0.035, 0.035)).normalized()
        yield direction


def append_pappus(builder, rng, pappus_center, axis, bristle_count, material_index):
    u, v = stable_frame(axis)
    phase = rng.uniform(0, 2.0 * pi)
    for bristle in range(bristle_count):
        angle = phase + 2.0 * pi * bristle / bristle_count + rng.uniform(-0.08, 0.08)
        tangent = u * cos(angle) + v * sin(angle)
        length = rng.uniform(0.48, 0.69)
        end = pappus_center + tangent * length + Vector(axis) * rng.uniform(0.05, 0.15)
        builder.add_cylinder(pappus_center, end, 0.0105, sides=4,
                             material_index=material_index, end_radius=0.0045, caps=False)


def append_attached_seed(builder, rng, direction, bristle_count, shade_index):
    root = HEAD_CENTER + direction * 0.47
    achene_end = root + direction * rng.uniform(0.25, 0.34)
    pappus_center = HEAD_CENTER + direction * rng.uniform(2.15, 2.37)
    builder.add_spindle(root, achene_end, rng.uniform(0.048, 0.066), sides=7,
                        material_index=0)
    builder.add_cylinder(achene_end, pappus_center, 0.014, sides=5,
                         material_index=0, end_radius=0.009, caps=False)
    append_pappus(builder, rng, pappus_center, direction, bristle_count, shade_index)


def append_shootable_seed(builder, rng, bristle_count, shade_index):
    """Local +Z geometry lets one exported node detach without moving its neighbours."""
    axis = Vector((0, 0, 1))
    root = Vector((0, 0, 0))
    achene_end = axis * rng.uniform(0.25, 0.34)
    pappus_height = rng.uniform(1.68, 1.90)
    pappus_center = axis * pappus_height
    builder.add_spindle(root, achene_end, rng.uniform(0.048, 0.066), sides=7,
                        material_index=0)
    builder.add_cylinder(achene_end, pappus_center, 0.014, sides=5,
                         material_index=0, end_radius=0.009, caps=False)
    append_pappus(builder, rng, pappus_center, axis, bristle_count, shade_index)
    return pappus_height


def append_detached_seed(builder, rng, pappus_center, axis, bristle_count):
    axis = Vector(axis).normalized()
    achene_tip = Vector(pappus_center) - axis * rng.uniform(1.45, 1.72)
    achene_base = achene_tip - axis * 0.30
    builder.add_spindle(achene_base, achene_tip, 0.061, sides=7, material_index=0)
    builder.add_cylinder(achene_tip, pappus_center, 0.014, sides=5,
                         material_index=0, end_radius=0.009, caps=False)
    append_pappus(builder, rng, Vector(pappus_center), axis, bristle_count, 1)


def flight_seed_specs(count, rng):
    """Yield a correlated wind plume rather than independent seed positions."""
    wind = Vector((0.965, 0.08, 0.25)).normalized()
    crosswind = Vector((-wind.y, wind.x, 0)).normalized()
    upward = Vector((0, 0, 1))
    horizontal_wind = Vector((wind.x, wind.y, 0)).normalized()
    release_tilts = (72, 17, 48, 80, 28, 63, 12, 54, 75)
    phase = rng.uniform(-0.35, 0.35)
    for index in range(count):
        progress = (index + 0.42) / max(1, count)
        distance = 2.62 + 6.45 * (progress ** 1.38) + rng.uniform(-0.18, 0.18)
        plume_radius = 0.18 + 1.45 * progress
        swirl = sin(progress * pi * 2.7 + phase) * plume_radius
        cross_offset = swirl + rng.uniform(-0.28, 0.28) * (0.4 + progress)
        lift = (0.12 + 0.78 * sqrt(progress)
                + 0.52 * sin(progress * pi * 3.4 + phase)
                + rng.uniform(-0.28, 0.28))
        pappus_center = HEAD_CENTER + wind * distance + crosswind * cross_offset + upward * lift
        tilt = release_tilts[index] + rng.uniform(-4.0, 4.0)
        heading = (horizontal_wind + crosswind * rng.uniform(-0.22, 0.22)).normalized()
        axis = upward * cos(radians(tilt)) + heading * sin(radians(tilt))
        yield pappus_center, axis, tilt


def build_head(collection, profile, materials, rng):
    core = MeshBuilder()
    core.add_uv_sphere(HEAD_CENTER - Vector((0, 0, 0.12)), (0.62, 0.62, 0.49),
                       segments=24 if profile.label in ("HERO", "SHOOTABLE") else 16,
                       rings=10 if profile.label in ("HERO", "SHOOTABLE") else 7,
                       material_index=1)
    bract_count = 30 if profile.label in ("HERO", "SHOOTABLE") else (20 if profile.label == "LOD1" else 12)
    for index in range(bract_count):
        angle = 2.0 * pi * index / bract_count
        radial = Vector((cos(angle), sin(angle), 0))
        start = HEAD_CENTER + radial * 0.34 - Vector((0, 0, 0.39))
        end = HEAD_CENTER + radial * 0.92 - Vector((0, 0, 0.70))
        core.add_cylinder(start, end, 0.055, sides=5, material_index=0,
                          end_radius=0.012, caps=False)
    core_obj = object_from_builder(f"SeedHeadCore_{profile.label}", core, collection,
                                   [materials["stem"], materials["receptacle"]],
                                   "receptacle_and_bracts", profile.label)

    seeds = MeshBuilder()
    patch_axis = Vector((0.965, 0.08, 0.25)).normalized()
    attached_count = 0
    missing_count = 0
    for site_index, direction in enumerate(fibonacci_directions(profile.seed_count, rng), 1):
        patch_strength = direction.dot(patch_axis)
        omit_chance = 0.78 if patch_strength > 0.80 else (0.30 if patch_strength > 0.66 else 0.02)
        if rng.random() < omit_chance:
            missing_count += 1
            continue
        shade_index = 2 if direction.z < -0.24 or rng.random() < 0.13 else 1
        if profile.label == "SHOOTABLE":
            separate = MeshBuilder()
            pappus_height = append_shootable_seed(
                separate, rng, profile.bristles_per_seed, shade_index)
            obj = object_from_builder(f"AttachedSeed_{site_index:03d}_SHOOTABLE_nocol",
                                      separate, collection,
                                      [materials["achene"], materials["pappus"],
                                       materials["pappus_shadow"]],
                                      "shootable_seed", profile.label)
            obj.location = HEAD_CENTER + direction * 0.47
            obj.rotation_euler = Vector((0, 0, 1)).rotation_difference(direction).to_euler()
            obj["seed_index"] = site_index
            obj["pappus_height"] = pappus_height
        else:
            append_attached_seed(seeds, rng, direction, profile.bristles_per_seed, shade_index)
        attached_count += 1

    if profile.label == "SHOOTABLE":
        core_obj["attached_seed_count"] = attached_count
        core_obj["missing_seed_sites"] = missing_count
        return core_obj, None, []

    seed_obj = object_from_builder(f"AttachedSeedsAndPappus_{profile.label}", seeds, collection,
                                   [materials["achene"], materials["pappus"],
                                    materials["pappus_shadow"]],
                                   "attached_seeds_and_pappus", profile.label)
    seed_obj["attached_seed_count"] = attached_count
    seed_obj["missing_seed_sites"] = missing_count
    seed_obj["bristles_per_seed"] = profile.bristles_per_seed
    flying_seeds = []
    all_flight_specs = list(flight_seed_specs(PROFILES[0].detached_seed_count,
                                             random.Random(SEED + 1024)))
    flight_indices = (
        range(PROFILES[0].detached_seed_count) if profile.label == "HERO"
        else range(0, PROFILES[0].detached_seed_count, 2) if profile.label == "LOD1"
        else ()
    )
    for source_index in flight_indices:
        pappus_center, axis, tilt = all_flight_specs[source_index]
        detached = MeshBuilder()
        append_detached_seed(detached, rng, Vector((0, 0, 0)), axis,
                             profile.bristles_per_seed)
        obj = object_from_builder(f"FlyingSeed_{source_index + 1:02d}_{profile.label}",
                                  detached, collection,
                                  [materials["achene"], materials["pappus"]],
                                  "flying_seed", profile.label)
        obj.location = pappus_center
        obj["seed_index"] = source_index + 1
        obj["release_tilt_deg"] = tilt
        obj["release_direction"] = tuple(axis)
        obj["wind_stiffness"] = 0.18
        flying_seeds.append(obj)
    return core_obj, seed_obj, flying_seeds


def animate_flying_seeds(objects):
    """Release seeds in waves, then advect them through a widening wind plume."""
    wind = Vector((0.965, 0.08, 0.25)).normalized()
    crosswind = Vector((-wind.y, wind.x, 0)).normalized()
    for obj in objects:
        index = obj["seed_index"] - 1
        rng = random.Random(SEED + 9000 + index)
        destination = obj.location.copy()
        launch_frame = 4 + 12 * (PROFILES[0].detached_seed_count - 1 - index)
        launch_frame += rng.randint(-1, 1)
        launch = (HEAD_CENTER + wind * rng.uniform(2.50, 2.75)
                  + crosswind * rng.uniform(-0.28, 0.28)
                  + Vector((0, 0, rng.uniform(-0.16, 0.22))))
        release_direction = Vector(obj["release_direction"])
        first_drift = launch + release_direction * 1.45
        base_roll = rng.uniform(-0.18, 0.18)
        sway_phase = rng.uniform(-pi, pi)
        obj["release_frame"] = launch_frame
        obj["flight_end_frame"] = 120

        def pose(frame, progress):
            progress = min(1.0, max(0.0, progress))
            trajectory = (launch * (1.0 - progress) ** 2
                          + first_drift * (2.0 * progress * (1.0 - progress))
                          + destination * progress ** 2)
            turbulence = sin(progress * pi * 2.7 + sway_phase) - sin(sway_phase)
            trajectory += crosswind * turbulence * (0.10 + 0.43 * progress)
            trajectory.z += 0.23 * sin(progress * pi * 2.0) * (0.25 + progress)
            obj.location = trajectory
            obj.rotation_euler = (
                base_roll + 0.13 * sin(progress * pi * 2.8 + sway_phase),
                0.12 * sin(progress * pi * 1.7 + index),
                0.52 * progress + 0.16 * sin(progress * pi * 2.5 + sway_phase),
            )
            obj.keyframe_insert(data_path="location", frame=frame)
            obj.keyframe_insert(data_path="rotation_euler", frame=frame)

        pose(1, 0.0)
        pose(launch_frame, 0.0)
        duration = 120 - launch_frame
        for progress in (0.18, 0.38, 0.62, 0.82, 1.0):
            pose(round(launch_frame + duration * progress), progress)
        obj.scale = (0.001, 0.001, 0.001)
        obj.keyframe_insert(data_path="scale", frame=1)
        obj.keyframe_insert(data_path="scale", frame=launch_frame)
        obj.scale = (1.0, 1.0, 1.0)
        obj.keyframe_insert(data_path="scale", frame=launch_frame + 3)
        obj.keyframe_insert(data_path="scale", frame=120)
        action = obj.animation_data.action
        if action:
            action.name = f"SeedFlight_{index + 1:02d}"
            for curve in action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "BEZIER"


def add_wind_shape(obj, kind, strength):
    basis = obj.shape_key_add(name="Basis")
    gust = obj.shape_key_add(name="WindGust")
    gust.slider_min = 0.0
    gust.slider_max = 1.0
    for source, target in zip(basis.data, gust.data):
        co = source.co
        if kind == "leaf":
            factor = min(1.0, sqrt(co.x * co.x + co.y * co.y) / 4.6)
        else:
            factor = min(1.0, max(0.0, co.z / 14.5)) ** 2
        target.co.x += strength * factor
        target.co.y += 0.11 * strength * factor * sin(co.z * 0.72 + co.x * 0.31)
        if kind == "leaf":
            target.co.z += 0.065 * factor * sin(co.x + co.y)
    for frame, value in ((1, 0.0), (30, 1.0), (72, 0.0), (95, 0.75), (120, 0.0)):
        gust.value = value
        gust.keyframe_insert(data_path="value", frame=frame)
    if obj.data.shape_keys and obj.data.shape_keys.animation_data:
        action = obj.data.shape_keys.animation_data.action
        if action:
            for curve in action.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "SINE"
    obj["wind_stiffness"] = {
        "leaf": 0.28,
        "stem": 0.72,
        "head": 0.44,
    }[kind]


def group_action_in_clip(animated_data, clip_name):
    animation = animated_data.animation_data
    if animation is None or animation.action is None:
        raise RuntimeError(f"missing action for {animated_data.name}")
    action = animation.action
    track = animation.nla_tracks.new()
    track.name = clip_name
    track.strips.new(action.name, 1, action)
    animation.action = None


def build_variant(scene, profile, materials):
    rng = random.Random(SEED + sum(ord(char) for char in profile.label))
    collection = make_collection(scene, f"GiantDandelion_{profile.label}",
                                 hide_render=profile.label != "HERO")
    stem = build_stem(collection, profile, materials)
    leaves = build_leaves(collection, profile, materials, rng)
    core, seeds, flying_seeds = build_head(collection, profile, materials, rng)
    if profile.label == "HERO":
        add_wind_shape(stem, "stem", 0.42)
        add_wind_shape(leaves, "leaf", 0.36)
        add_wind_shape(core, "head", 0.44)
        add_wind_shape(seeds, "head", 0.49)
        for obj in (stem, leaves, core, seeds):
            group_action_in_clip(obj.data.shape_keys, "SeedFlight")
    if profile.label in ("HERO", "LOD1"):
        animate_flying_seeds(flying_seeds)
        for obj in flying_seeds:
            group_action_in_clip(obj, "SeedFlight")
    return collection


def build_collision(scene, materials):
    collection = make_collection(scene, "GiantDandelion_Collision", hide_render=True)
    builder = MeshBuilder()
    builder.add_cylinder((0.03, 0, 0.18), STEM_TOP, 0.32, sides=10,
                         material_index=0, end_radius=0.22)
    builder.add_uv_sphere(HEAD_CENTER, (3.02, 3.02, 3.02), segments=14, rings=8,
                          material_index=0)
    obj = object_from_builder("GiantDandelionCollision", builder, collection,
                              [materials["stem"]], "collision", "COLLISION")
    obj.display_type = "WIRE"
    return collection


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_camera(collection, name, location, target, lens=52):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = 36
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def add_scale_figure(collection, figure_material):
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.16, depth=1.04,
                                        location=(-2.15, -0.55, 0.93))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.145,
                                        location=(-2.15, -0.55, 1.60))
    parts.append(bpy.context.object)
    for x_offset in (-0.085, 0.085):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.065, depth=0.72,
                                            location=(-2.15 + x_offset, -0.55, 0.36))
        parts.append(bpy.context.object)
    for side in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.052, depth=0.76,
                                            location=(-2.15 + side * 0.23, -0.55, 1.04),
                                            rotation=(0, side * 0.18, 0))
        parts.append(bpy.context.object)
    for index, part in enumerate(parts):
        part.name = f"ScaleFigure_{index:02d}"
        for owner in list(part.users_collection):
            owner.objects.unlink(part)
        collection.objects.link(part)
        part.data.materials.append(figure_material)
        part["presentation_only"] = True


def build_presentation(scene, materials):
    collection = make_collection(scene, "Presentation")
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=10.5, depth=0.20,
                                        location=(0.6, 0, -0.12))
    ground = bpy.context.object
    ground.name = "PresentationGround"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    collection.objects.link(ground)
    ground.data.materials.append(materials["ground"])
    add_scale_figure(collection, materials["scale_figure"])

    lights = (
        ("Key", "AREA", (-8, -10, 21), 2500, 8.0),
        ("Fill", "AREA", (10, -5, 12), 1450, 7.0),
        ("Rim", "AREA", (3, 9, 18), 2100, 6.0),
    )
    for name, light_type, location, energy, size in lights:
        data = bpy.data.lights.new(name, light_type)
        data.energy = energy
        data.color = (1.0, 0.91, 0.76) if name == "Key" else (0.63, 0.78, 1.0)
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.location = location
        look_at(obj, HEAD_CENTER)

    target = Vector((1.35, 0, 8.15))
    cameras = {
        "front": add_camera(collection, "Camera_front", (0, -37, 11.0), target, 53),
        "quarter": add_camera(collection, "Camera_quarter", (29, -29, 12.4), target, 55),
        "side": add_camera(collection, "Camera_side", (35, 0, 11.2), target, 55),
        "top": add_camera(collection, "Camera_top", (17, -20, 31), HEAD_CENTER, 49),
    }
    return cameras


def triangulated_face_count(objects):
    count = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        count += len(obj.data.loop_triangles)
    return count


def object_bounds(objects):
    points = []
    for obj in objects:
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    minimum = Vector((min(point.x for point in points), min(point.y for point in points),
                      min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points),
                      max(point.z for point in points)))
    return minimum, maximum


def validate_scene(scene, collections):
    scene.frame_set(120)
    triangle_counts = {}
    for profile in PROFILES:
        collection = collections[profile.label]
        objects = list(collection.objects)
        triangle_counts[profile.label] = triangulated_face_count(objects)
        if len(objects) != 4 + profile.detached_seed_count:
            raise RuntimeError(f"{profile.label} has an unexpected number of runtime mesh objects")
    if not (triangle_counts["HERO"] > triangle_counts["LOD1"] > triangle_counts["LOD2"]):
        raise RuntimeError(f"LOD triangle counts do not decrease: {triangle_counts}")
    minimum, maximum = object_bounds(collections["HERO"].objects)
    dimensions = maximum - minimum
    if not 17.0 <= dimensions.z <= 20.0:
        raise RuntimeError(f"unexpected giant dandelion height: {dimensions.z:.2f} m")
    if dimensions.x < 10.0 or dimensions.y < 5.0:
        raise RuntimeError(f"seed head or airborne silhouette collapsed: {tuple(dimensions)}")
    material_names = {slot.material.name for obj in collections["HERO"].objects
                      for slot in obj.material_slots if slot.material}
    if len(material_names) > 8:
        raise RuntimeError(f"runtime material budget exceeded: {material_names}")
    for obj in list(collections["HERO"].objects) + list(collections["LOD1"].objects):
        if obj.get("role") == "flying_seed":
            if obj.animation_data is None or not obj.animation_data.nla_tracks:
                raise RuntimeError(f"missing individual flight animation on {obj.name}")
    for obj in collections["HERO"].objects:
        if obj.get("role") == "flying_seed":
            continue
        if obj.data.shape_keys is None or "WindGust" not in obj.data.shape_keys.key_blocks:
            raise RuntimeError(f"missing WindGust shape on {obj.name}")
    print("validated scene:", {
        "bounds_min": tuple(round(value, 3) for value in minimum),
        "bounds_max": tuple(round(value, 3) for value in maximum),
        "dimensions_m": tuple(round(value, 3) for value in dimensions),
        "triangles": triangle_counts,
        "materials": len(material_names),
        "animation": "WindGust morph plus individual SeedFlight paths, 120 frames",
    })


def render_previews(scene, cameras):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene.frame_set(120)
    for label, camera in cameras.items():
        scene.camera = camera
        scene.render.filepath = str(PREVIEW_DIR / f"giant_dandelion_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {Path(scene.render.filepath).relative_to(ROOT)}")
    scene.camera = cameras["front"]
    for label, frame in (("release", 35), ("midflight", 68)):
        scene.frame_set(frame)
        scene.render.filepath = str(PREVIEW_DIR / f"giant_dandelion_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"rendered {Path(scene.render.filepath).relative_to(ROOT)}")


def export_collection(collection, path, animations):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    objects = [obj for obj in collection.objects if obj.type == "MESH"]
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=animations,
        export_animation_mode="NLA_TRACKS" if animations else "ACTIONS",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=False,
    )
    print(f"exported {path.relative_to(ROOT)}")


def validate_roundtrip(path, expected_max_triangles=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    triangles = triangulated_face_count(meshes)
    if not meshes or triangles <= 0:
        raise RuntimeError(f"roundtrip import failed for {path.name}")
    if expected_max_triangles is not None and triangles > expected_max_triangles:
        raise RuntimeError(f"collision triangle budget exceeded: {triangles}")
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    print(f"roundtrip validated {path.name}: {len(meshes)} meshes, {triangles} triangles")


def main():
    scene = reset_scene()
    materials = build_materials()
    collections = {profile.label: build_variant(scene, profile, materials)
                   for profile in PROFILES}
    collections["SHOOTABLE"] = build_variant(scene, SHOOTABLE_PROFILE, materials)
    collision = build_collision(scene, materials)
    cameras = build_presentation(scene, materials)
    validate_scene(scene, collections)
    shootable_seeds = [obj for obj in collections["SHOOTABLE"].objects
                       if obj.get("role") == "shootable_seed"]
    if not 180 <= len(shootable_seeds) <= SHOOTABLE_PROFILE.seed_count:
        raise RuntimeError(f"unexpected number of individually shootable seeds: {len(shootable_seeds)}")
    if len({obj["seed_index"] for obj in shootable_seeds}) != len(shootable_seeds):
        raise RuntimeError("shootable seed IDs are not unique")
    render_previews(scene, cameras)
    export_collection(collections["HERO"], HERO_PATH, animations=True)
    export_collection(collections["SHOOTABLE"], SHOOTABLE_PATH, animations=False)
    export_collection(collections["LOD1"], LOD1_PATH, animations=True)
    export_collection(collections["LOD2"], LOD2_PATH, animations=False)
    export_collection(collision, COLLISION_PATH, animations=False)
    validate_roundtrip(HERO_PATH)
    validate_roundtrip(SHOOTABLE_PATH)
    validate_roundtrip(LOD1_PATH)
    validate_roundtrip(LOD2_PATH)
    validate_roundtrip(COLLISION_PATH, expected_max_triangles=500)
    scene.camera = cameras["front"]
    scene.frame_set(120)
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    print(f"saved {BLEND_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
