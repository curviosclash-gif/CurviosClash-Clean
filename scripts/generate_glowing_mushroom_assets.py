#!/usr/bin/env python3
"""Generate the deterministic family of glowing decoration mushrooms.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_glowing_mushroom_assets.py

Four silhouettes in three variants each. The silhouettes differ in shape rather than in
proportion because a player reads outline first: four proportions of one cap mushroom look
like one plant seen four times, while a cap, a trumpet, a coral and a shelf read as a flora.

Two constraints shaped every material in here.

First, bloom is off by default (DEFAULT_BLOOM_QUALITY in src/shared/contracts/BloomQualityContract.js),
so nothing in the scene spreads light past its own silhouette. A glow has to carry purely on
the contrast between its own dark flesh and its saturated emission.

Second, emission strength above roughly two saturates to white through the scene tone mapping,
which is exactly how the first pass of the Notre-Dame flames turned into pale cones. The
glowing() helper below therefore keeps the base colour near black and the strength under two,
and lets the emission *colour* carry the impression of brightness.

Every mesh is named with the `_nocol` marker so GLBMapLoader keeps these models decorative.
Decoration a player can collide with is worse than no decoration: the shapes are organic, the
colliders derived from them would not be, and nobody expects to die on a mushroom.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import random
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "models" / "glowing_mushroom"
SOURCE_DIR = ASSET_DIR / "blender"
PREVIEW_DIR = SOURCE_DIR / "previews"
MANIFEST_PATH = ASSET_DIR / "manifest.json"
CONTACT_SHEET_PATH = PREVIEW_DIR / "contact_sheet.png"
PREVIEW_SIZE = 360

GENERATOR_ID = "glowing-mushroom"
GENERATOR_VERSION = "1.0.0"
SEED = 6042023

# Emission strength stays inside the band the tone map can still show as colour. The lower bound
# is not cosmetic either: below roughly one the emission loses against the ambient light of a lit
# map and the mushroom reads as painted plastic.
EMISSION_MIN = 1.1
EMISSION_MAX = 1.8

# Near-black flesh under the emission. Shared by every glowing material; see the module docstring.
GLOW_BASE_COLOUR = (0.05, 0.05, 0.06, 1.0)

# The three hues the family is allowed to use. Each silhouette gets all three, one per variant,
# so any map can pick a colour scheme without being forced into a single shape.
#
# Every hue peaks at exactly 1.0 on purpose. The glTF exporter stores emission as a colour scaled
# to a maximum of one plus a separate strength factor, so a hue that peaks at 0.95 comes back out
# of the file with its strength multiplied by 0.95. Peaking at one keeps the number written here,
# the number in the manifest and the number the game applies the same number.
HUES = {
    "teal": (0.168, 1.0, 0.905, 1.0),
    "violet": (0.64, 0.34, 1.0, 1.0),
    "amber": (1.0, 0.63, 0.19, 1.0),
}
HUE_ORDER = ("teal", "violet", "amber")

# Triangle budget per model. These are placed by the dozen, so the budget is what keeps a
# decorated cellar from costing more than the map it decorates.
MAX_TRIANGLES = 2600


def glowing(name, hue, strength):
    """A material that only emits: near-black base colour, saturated emission on top.

    Copied in spirit from glowing() in scripts/generate_notre_dame_fire_assets.py, for the same
    reason: a bright base colour also *receives* light from the map, and the tone map then
    finishes the job and washes the colour out entirely.
    """
    if not EMISSION_MIN <= strength <= EMISSION_MAX:
        raise ValueError(f"emission strength {strength} outside the tone-map-safe band")
    if abs(max(HUES[hue][:3]) - 1.0) > 1e-6:
        raise ValueError(f"hue {hue} must peak at 1.0 so the exported strength stays unscaled")
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = GLOW_BASE_COLOUR
    shader.inputs["Roughness"].default_value = 0.62
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Emission Color"].default_value = HUES[hue]
    shader.inputs["Emission Strength"].default_value = strength
    material.diffuse_color = HUES[hue]
    material.use_backface_culling = False
    return material


def flesh(name, colour, roughness):
    """The non-emitting body. Kept desaturated so the glow has something to win against."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0.0
    material.diffuse_color = (*colour, 1.0)
    material.use_backface_culling = False
    return material


class Geometry:
    """Accumulates vertices and faces per material slot, then hands out Blender objects.

    Keeping one mesh per material rather than one per part is what holds the triangle and
    draw-call count down: a finished mushroom is two or three objects, not twenty.
    """

    def __init__(self):
        self.parts = {}

    def part(self, material):
        return self.parts.setdefault(material, ([], []))

    def tube(self, points, radii, material, sides=6, cap_start=True, cap_end=True):
        """A closed tube through `points` with per-point `radii`.

        The cross-section frame is carried along the curve rather than rebuilt at every point.
        Rebuilding it independently is what put the visible hourglass pinches in the first pass
        of the stems: two neighbouring rings ended up rotated against each other by most of a
        sector, and the quads between them crossed over.
        """
        vertices, faces = self.part(material)
        base = len(vertices)
        normal = None
        for index, point in enumerate(points):
            ahead = Vector(points[min(index + 1, len(points) - 1)])
            behind = Vector(points[max(index - 1, 0)])
            tangent = ahead - behind
            if tangent.length < 1e-6:
                tangent = Vector((0, 0, 1))
            tangent.normalize()
            if normal is None:
                normal = tangent.cross(Vector((0, 0, 1)))
                if normal.length < 0.05:
                    normal = tangent.cross(Vector((0, 1, 0)))
            else:
                # Parallel transport: keep the previous frame and only remove the part of it that
                # no longer lies in the plane of the new tangent.
                normal = normal - tangent * normal.dot(tangent)
                if normal.length < 1e-6:
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
                faces.extend(((a, b, b + sides), (a, b + sides, a + sides)))
        if cap_start:
            faces.append(tuple(base + side for side in reversed(range(sides))))
        if cap_end:
            faces.append(tuple(base + (len(points) - 1) * sides + side for side in range(sides)))

    def revolve(self, profile, material, sides=16, arc=2 * math.pi, origin=(0, 0, 0),
                flip=False):
        """A surface of revolution from a `(radius, z)` profile.

        This one helper carries the cap dome, the cap underside, the trumpet funnel and the shelf
        brackets. `arc` under a full turn leaves the shape open, which is what makes a shelf
        mushroom a half disc growing out of a wall rather than a free-standing ring.
        """
        vertices, faces = self.part(material)
        base = len(vertices)
        closed = abs(arc - 2 * math.pi) < 1e-6
        columns = sides if closed else sides + 1
        offset = Vector(origin)
        for radius, height in profile:
            for column in range(columns):
                angle = arc * (column / sides if not closed else column / sides)
                vertices.append(tuple(offset + Vector((
                    radius * math.cos(angle), radius * math.sin(angle), height))))
        for row in range(len(profile) - 1):
            for column in range(columns if closed else columns - 1):
                a = base + row * columns + column
                b = base + row * columns + ((column + 1) % columns if closed else column + 1)
                c = b + columns
                d = a + columns
                faces.extend(((a, d, c), (a, c, b)) if flip else ((a, b, c), (a, c, d)))

    def disc(self, centre, radius, material, sides=8, normal_up=True):
        """A flat n-gon, used for cap spots and coral tips."""
        vertices, faces = self.part(material)
        base = len(vertices)
        centre = Vector(centre)
        for side in range(sides):
            angle = 2 * math.pi * side / sides
            vertices.append(tuple(centre + Vector((
                radius * math.cos(angle), radius * math.sin(angle), 0))))
        order = range(sides) if normal_up else reversed(range(sides))
        faces.append(tuple(base + side for side in order))

    def objects(self, materials, prefix):
        result = []
        for key, (vertices, faces) in self.parts.items():
            if not faces:
                continue
            mesh = bpy.data.meshes.new(f"{prefix}_{key}")
            mesh.from_pydata(vertices, [], faces)
            mesh.update()
            # The `_nocol` suffix is the contract with GLBMapLoader: decoration, never collision.
            obj = bpy.data.objects.new(f"{prefix}_{key}_nocol", mesh)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(materials[key])
            result.append(obj)
        return result


@dataclass(frozen=True)
class MushroomParameters:
    """The knobs a variant is allowed to turn. Shape stays with the silhouette function."""

    name: str
    form: str
    variant: int
    hue: str
    seed: int
    height: float
    girth: float
    spread: float
    glow_strength: float
    detail: float
    lean: float
    cluster: int = 1
    extras: dict = field(default_factory=dict)


def cap_mushroom(geo, p, rng):
    """The classic silhouette: a bent stem under a domed cap, glowing from underneath.

    The glow sits on the underside and the rim, not on the dome. A cap lit from above is a lamp;
    a cap lit from below is a mushroom, and it also keeps the light where a player flying under
    the canopy actually sees it.
    """
    for index in range(p.cluster):
        angle = 2 * math.pi * index / max(1, p.cluster) + rng.uniform(-0.3, 0.3)
        distance = 0.0 if index == 0 else p.spread * rng.uniform(0.45, 0.95)
        foot = Vector((math.cos(angle) * distance, math.sin(angle) * distance, 0))
        scale = 1.0 if index == 0 else rng.uniform(0.45, 0.78)
        height = p.height * scale
        stem_radius = p.girth * scale
        lean = Vector((math.cos(angle + 1.1), math.sin(angle + 1.1), 0)) * p.lean * height
        points = [tuple(foot + lean * t * t + Vector((0, 0, height * t)))
                  for t in (0.0, 0.34, 0.68, 1.0)]
        radii = [stem_radius * 1.28, stem_radius * 0.92, stem_radius * 0.84, stem_radius * 0.9]
        geo.tube(points, radii, "flesh", sides=7, cap_end=False)

        top = Vector(points[-1])
        cap_radius = stem_radius * (3.4 + 1.5 * p.detail) * scale
        dome = height * 0.34 * scale
        rim_z = top.z - dome * 0.18
        origin = (top.x, top.y, 0)
        # Dome, from the crown outward to the rim.
        geo.revolve([(0.0, top.z + dome), (cap_radius * 0.34, top.z + dome * 0.86),
                     (cap_radius * 0.68, top.z + dome * 0.52), (cap_radius * 0.9, top.z + dome * 0.2),
                     (cap_radius, rim_z)],
                    "flesh", sides=14, origin=origin)
        # The rim band. Without it the cap only glows straight down, where a player flying past
        # at cap height never sees it - the first contact sheet showed twelve dark lumps with a
        # few bright freckles. The band is what makes the silhouette read as lit from the side.
        geo.revolve([(cap_radius, rim_z + dome * 0.14), (cap_radius * 1.02, rim_z),
                     (cap_radius * 0.99, rim_z - dome * 0.1)],
                    "glow", sides=14, origin=origin)
        # Underside back to the stem, facing down.
        geo.revolve([(cap_radius * 0.99, rim_z - dome * 0.1), (cap_radius * 0.82, rim_z + dome * 0.1),
                     (cap_radius * 0.4, rim_z + dome * 0.24), (stem_radius * 0.95, rim_z + dome * 0.3)],
                    "glow", sides=14, origin=origin, flip=True)
        # Spots on the dome. Flat discs rather than domes keep the triangle count in budget.
        for spot in range(int(3 + p.detail * 5)):
            spot_angle = 2 * math.pi * rng.random()
            radial = cap_radius * rng.uniform(0.22, 0.82)
            factor = radial / cap_radius
            geo.disc((top.x + math.cos(spot_angle) * radial,
                      top.y + math.sin(spot_angle) * radial,
                      top.z + dome * (1.0 - factor * factor * 0.82) + 0.004),
                     cap_radius * rng.uniform(0.07, 0.13), "glow", sides=6)


def trumpet_mushroom(geo, p, rng):
    """Tall, slender funnels with the glow inside the bell.

    The point of this silhouette is height: a cluster of trumpets reads as a vertical marker
    from across a room, which is what a dark map needs more than another ground-level clump.
    """
    for index in range(p.cluster):
        angle = 2 * math.pi * index / max(1, p.cluster) + rng.uniform(-0.25, 0.25)
        distance = 0.0 if index == 0 else p.spread * rng.uniform(0.4, 1.0)
        foot = Vector((math.cos(angle) * distance, math.sin(angle) * distance, 0))
        scale = 1.0 if index == 0 else rng.uniform(0.52, 0.86)
        height = p.height * scale
        neck = p.girth * scale
        bell = neck * (3.0 + 2.2 * p.detail)
        origin = (foot.x, foot.y, 0)
        stem = [(neck * 1.25, 0.0), (neck * 0.82, height * 0.3), (neck * 0.86, height * 0.62),
                (bell * 0.52, height * 0.84), (bell, height)]
        geo.revolve(stem, "flesh", sides=12, origin=origin)
        # The inner wall of the bell, running back down. Seen from above and from the side
        # through the mouth, this is the whole light of the shape.
        inner = [(bell * 0.94, height), (bell * 0.44, height * 0.86), (neck * 0.6, height * 0.66)]
        geo.revolve(inner, "glow", sides=12, origin=origin, flip=True)
        # A short lip so the mouth is not a zero-thickness edge when seen edge-on.
        geo.revolve([(bell, height), (bell * 0.94, height)], "glow", sides=12, origin=origin)


def coral_mushroom(geo, p, rng):
    """A branching coral fungus, glowing along its upper thirds.

    Proportion is the whole difference between a coral and a stalagmite, and the first pass got
    it wrong: thick stems, two children each and a short glowing cap read as rock spikes. A
    coral is thin, forks wide, and carries most of its length above the first fork.
    """

    def branch(start, direction, length, radius, depth):
        end = start + direction * length
        mid = start.lerp(end, 0.5) + Vector((0, 0, length * 0.08))
        material = "glow" if depth == 0 else "flesh"
        geo.tube([tuple(start), tuple(mid), tuple(end)],
                 [radius, radius * 0.78, radius * 0.56], material, sides=5, cap_end=False)
        if depth <= 0:
            # A rounded tip rather than a flat disc: at this radius a disc seen edge-on vanishes.
            geo.revolve([(radius * 0.56, end.z), (radius * 0.42, end.z + radius * 0.5),
                         (0.0, end.z + radius * 0.85)],
                        "glow", sides=5, origin=(end.x, end.y, 0))
            return
        # Three and four children, not two: a two-way fork repeated twice makes a Y, and a Y is
        # a stick. Wide yaw keeps the forks from stacking into one vertical line.
        for _ in range(3 if rng.random() < 0.55 else 4):
            yaw = rng.uniform(-1.35, 1.35)
            lean = rng.uniform(0.3, 0.72)
            side = Vector((math.cos(yaw), math.sin(yaw), 0))
            nxt = (direction + side * lean).normalized()
            branch(end, nxt, length * rng.uniform(0.62, 0.8), radius * 0.6, depth - 1)

    stems = max(2, int(2 + p.detail * 3))

    stems = max(2, int(2 + p.detail * 3))
    # A tube's end ring stands perpendicular to its own direction, so a leaning stem started at
    # z=0 dips its lower rim below the ground plane. Lifting the foot by the radius keeps the
    # model's own bounding box honest, which is what the map places it by.
    lift = p.girth * 0.75
    for index in range(stems):
        angle = 2 * math.pi * index / stems + rng.uniform(-0.3, 0.3)
        foot = Vector((math.cos(angle) * p.spread * 0.3, math.sin(angle) * p.spread * 0.3, lift))
        direction = Vector((math.cos(angle) * p.lean, math.sin(angle) * p.lean, 1)).normalized()
        branch(foot, direction, p.height * rng.uniform(0.34, 0.46), p.girth, 2)
        # A small pad closes the gap the lift opens, so the coral sits on ground rather than over it.
        geo.revolve([(p.girth * 1.5, 0.0), (p.girth * 1.1, lift * 0.9)], "flesh", sides=6,
                    origin=(foot.x, foot.y, 0))


def shelf_mushroom(geo, p, rng):
    """Stacked brackets for walls and columns, glowing on their undersides.

    Built as half discs in the +Y half space with their flat edge on the XZ plane, so the model
    can be placed straight against a wall without the map having to cut anything away.
    """
    count = max(3, int(3 + p.detail * 3))
    for index in range(count):
        share = index / max(1, count - 1)
        height = p.height * (0.12 + 0.8 * share) * rng.uniform(0.92, 1.08)
        radius = p.spread * (1.0 - 0.42 * share) * rng.uniform(0.82, 1.06)
        thickness = p.girth * (1.0 - 0.3 * share)
        sideways = rng.uniform(-0.22, 0.22) * p.spread
        origin = (sideways, 0.0, 0.0)
        arc = math.pi * rng.uniform(0.86, 1.0)
        # Top face: a slightly domed half disc growing out of the wall.
        top = [(radius * 0.18, height + thickness * 0.55), (radius * 0.6, height + thickness * 0.72),
               (radius * 0.88, height + thickness * 0.58), (radius * 0.94, height + thickness * 0.4)]
        geo.revolve(top, "flesh", sides=10, arc=arc, origin=origin)
        # The outer edge glows, for the same reason the cap has a rim band: a bracket seen from
        # above or from the side is all top face, and a light that only points at the wall below
        # it is a light nobody in the map ever sees. The band carries most of the thickness -
        # a hairline edge is visible in a still render and gone in motion.
        geo.revolve([(radius * 0.94, height + thickness * 0.4), (radius, height + thickness * 0.1),
                     (radius * 0.97, height - thickness * 0.12)],
                    "glow", sides=10, arc=arc, origin=origin)
        # The pore surface underneath. Only the outer ring glows: on a real bracket the pores sit
        # at the rim, and a fully lit underside is light aimed at the wall, where nobody is.
        geo.revolve([(radius * 0.97, height - thickness * 0.12), (radius * 0.66, height - thickness * 0.2)],
                    "glow", sides=10, arc=arc, origin=origin, flip=True)
        geo.revolve([(radius * 0.66, height - thickness * 0.2), (radius * 0.18, height - thickness * 0.05)],
                    "flesh", sides=10, arc=arc, origin=origin, flip=True)


FORMS = {
    "cap": cap_mushroom,
    "trumpet": trumpet_mushroom,
    "coral": coral_mushroom,
    "shelf": shelf_mushroom,
}

# Per-silhouette ranges. The variants sample these in stratified fashion (see variant_values):
# the range is cut into as many bands as there are variants and each variant draws from its own
# band, so three variants actually cover the range instead of clustering near its middle.
FORM_RANGES = {
    "cap": {"height": (1.05, 1.85), "girth": (0.1, 0.16), "spread": (0.75, 1.35),
            "detail": (0.25, 0.95), "lean": (0.04, 0.17), "cluster": (2, 4)},
    "trumpet": {"height": (1.7, 2.7), "girth": (0.075, 0.115), "spread": (0.5, 0.95),
                "detail": (0.3, 0.95), "lean": (0.02, 0.1), "cluster": (3, 5)},
    "coral": {"height": (0.9, 1.5), "girth": (0.075, 0.125), "spread": (0.65, 1.15),
              "detail": (0.25, 0.95), "lean": (0.12, 0.4), "cluster": (1, 1)},
    "shelf": {"height": (1.15, 2.0), "girth": (0.13, 0.22), "spread": (0.62, 1.05),
              "detail": (0.2, 0.9), "lean": (0.0, 0.0), "cluster": (1, 1)},
}

# Where the preview camera stands per silhouette. Shelf mushrooms grow into the +Y half space
# against a wall, so the default three-quarter view from -Y looks straight into their open back
# and shows the glowing underside as if it were the top.
PREVIEW_VIEWS = {
    "cap": (1, -1.35, 0.42),
    "trumpet": (1, -1.35, 0.42),
    "coral": (1, -1.35, 0.42),
    "shelf": (0.9, 1.3, 0.3),
}

FLESH_COLOURS = {
    "cap": ((0.33, 0.24, 0.21), 0.78),
    "trumpet": ((0.26, 0.22, 0.25), 0.82),
    "coral": ((0.38, 0.31, 0.26), 0.74),
    "shelf": ((0.29, 0.25, 0.19), 0.86),
}

VARIANT_COUNT = 3


def variant_values(low, high, count, seed):
    """Stratified sampling: one value per band, bands shuffled so order is not monotone."""
    rng = random.Random(seed)
    bands = list(range(count))
    rng.shuffle(bands)
    return [low + (high - low) * ((band + rng.uniform(0.2, 0.8)) / count) for band in bands]


def build_parameters():
    profiles = []
    for form_index, form in enumerate(FORMS):
        ranges = FORM_RANGES[form]
        sampled = {
            key: variant_values(low, high, VARIANT_COUNT, SEED + form_index * 1013 + key_index * 97)
            for key_index, (key, (low, high)) in enumerate(ranges.items())
        }
        glow = variant_values(EMISSION_MIN, EMISSION_MAX, VARIANT_COUNT, SEED + form_index * 71)
        for variant in range(VARIANT_COUNT):
            profiles.append(MushroomParameters(
                name=f"{form}_v{variant + 1:02d}",
                form=form,
                variant=variant + 1,
                # Each silhouette runs through all three hues, so no map is forced into one shape
                # to get one colour. The offset keeps two neighbouring forms from matching.
                hue=HUE_ORDER[(variant + form_index) % len(HUE_ORDER)],
                seed=SEED + form_index * 7919 + (variant + 1) * 31,
                height=sampled["height"][variant],
                girth=sampled["girth"][variant],
                spread=sampled["spread"][variant],
                glow_strength=round(glow[variant], 3),
                detail=sampled["detail"][variant],
                lean=sampled["lean"][variant],
                cluster=int(round(sampled["cluster"][variant])),
            ))
    return profiles


def render_preview(objects, destination, view):
    """One render per variant, against a dark background.

    The background is dark on purpose: these are judged on whether their glow reads without
    bloom, and a bright preview would flatter every one of them equally.
    """
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("MushroomPreviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.025, 0.03, 1.0)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = PREVIEW_SIZE
    scene.render.resolution_y = PREVIEW_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    # Eight bits per channel. Blender defaults these renders to sixteen, which quadruples a
    # preview that is flat colour on a flat background and has nothing to gain from the depth.
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 90
    scene.render.film_transparent = False
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    centre = sum(points, Vector()) / len(points)
    extent = max(max(p[axis] for p in points) - min(p[axis] for p in points) for axis in range(3))
    light_data = bpy.data.lights.new("PreviewKey", "AREA")
    light = bpy.data.objects.new("PreviewKey", light_data)
    bpy.context.collection.objects.link(light)
    light.location = centre + Vector((extent, -extent, extent * 1.6))
    light_data.energy = 110
    light_data.shape = "DISK"
    light_data.size = extent * 2
    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = extent * 1.35
    camera.location = centre + Vector(view).normalized() * extent * 2.6
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    destination.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.objects.remove(light, do_unlink=True)


def build_contact_sheet(previews, destination):
    """All twelve in one image, in silhouette rows, so the family can be judged as a family."""
    import numpy as np

    images = [bpy.data.images.load(str(path), check_existing=False) for path in previews]
    try:
        width, height = images[0].size
        columns, rows = VARIANT_COUNT, len(FORMS)
        canvas = np.zeros((rows * height, columns * width, 4), dtype=np.float32)
        for index, image in enumerate(images):
            pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
            # Blender images start at the bottom row, the contact sheet reads top down.
            target_row = rows - (index // columns) - 1
            column = index % columns
            canvas[target_row * height:(target_row + 1) * height,
                   column * width:(column + 1) * width] = pixels
        sheet = bpy.data.images.new("MushroomContactSheet", width=columns * width,
                                    height=rows * height, alpha=True)
        sheet.pixels.foreach_set(canvas.ravel())
        sheet.filepath_raw = str(destination)
        sheet.file_format = "PNG"
        sheet.save()
        bpy.data.images.remove(sheet)
    finally:
        for image in images:
            bpy.data.images.remove(image)


def triangle_count(objects):
    return sum(len(polygon.vertices) - 2 for obj in objects for polygon in obj.data.polygons)


def bounds(objects):
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    lower = [round(min(point[axis] for point in points), 4) for axis in range(3)]
    upper = [round(max(point[axis] for point in points), 4) for axis in range(3)]
    return lower, upper


def build_variant(parameters):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # No .blend1 backups. Re-running the generator would otherwise leave a second copy of every
    # source file next to it, six megabytes of it, which is noise in the repository and in every
    # later `git status`.
    bpy.context.preferences.filepaths.save_version = 0
    rng = random.Random(parameters.seed)
    geo = Geometry()
    FORMS[parameters.form](geo, parameters, rng)
    colour, roughness = FLESH_COLOURS[parameters.form]
    materials = {
        "flesh": flesh(f"MushroomFlesh_{parameters.name}", colour, roughness),
        "glow": glowing(f"MushroomGlow_{parameters.name}", parameters.hue,
                        parameters.glow_strength),
    }
    objects = geo.objects(materials, f"mushroom_{parameters.form}")
    if not objects:
        raise RuntimeError(f"{parameters.name} produced no geometry")
    triangles = triangle_count(objects)
    if triangles > MAX_TRIANGLES:
        raise RuntimeError(f"{parameters.name}: {triangles} triangles exceeds budget {MAX_TRIANGLES}")
    if not any(obj.data.materials[0].name.startswith("MushroomGlow") for obj in objects):
        raise RuntimeError(f"{parameters.name} has no glowing surface")
    lower, upper = bounds(objects)
    if lower[2] < -0.01:
        raise RuntimeError(f"{parameters.name} reaches below its own ground plane: {lower[2]}")

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    preview_path = PREVIEW_DIR / f"{parameters.name}.png"
    render_preview(objects, preview_path, PREVIEW_VIEWS[parameters.form])
    glb_path = ASSET_DIR / f"{parameters.name}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_animations=False, export_yup=True, export_cameras=False,
        export_lights=False, export_apply=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / f"{parameters.name}.blend"),
                                check_existing=False, compress=True)

    # Round trip check: what the game will load is the file, not what is in memory here.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not imported:
        raise RuntimeError(f"{parameters.name}: round trip produced no meshes")
    if bpy.data.actions:
        raise RuntimeError(f"{parameters.name}: static decoration imported an animation")
    for obj in imported:
        if "_nocol" not in obj.name.lower():
            raise RuntimeError(f"{parameters.name}: mesh {obj.name} lost its _nocol marker")

    return {
        "name": parameters.name,
        "form": parameters.form,
        "variant": parameters.variant,
        "hue": parameters.hue,
        "seed": parameters.seed,
        "glow_strength": parameters.glow_strength,
        "file": str(glb_path.relative_to(ROOT)).replace("\\", "/"),
        "triangles": triangles,
        "meshes": len(objects),
        "bounds_min": lower,
        "bounds_max": upper,
        "height": round(upper[2] - lower[2], 4),
        "file_size_bytes": glb_path.stat().st_size,
        "preview": str(preview_path.relative_to(ROOT)).replace("\\", "/"),
    }


def main():
    only = None
    if "--" in sys.argv:
        arguments = sys.argv[sys.argv.index("--") + 1:]
        if arguments:
            only = set(arguments[0].split(","))
    entries = []
    for parameters in build_parameters():
        if only and parameters.name not in only and parameters.form not in only:
            continue
        entry = build_variant(parameters)
        entries.append(entry)
        print(f"built {entry['name']}: {entry['triangles']} triangles, "
              f"{entry['file_size_bytes']} bytes, height {entry['height']}")
    if only:
        print("partial run; manifest left untouched")
        return
    manifest = {
        "generator": "scripts/generate_glowing_mushroom_assets.py",
        "generator_id": GENERATOR_ID,
        "generator_version": GENERATOR_VERSION,
        "seed": SEED,
        "variation_method": "deterministic stratified sampling per silhouette",
        "emission_band": [EMISSION_MIN, EMISSION_MAX],
        "hues": {name: list(value) for name, value in HUES.items()},
        "max_triangles": MAX_TRIANGLES,
        "mushrooms": entries,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {MANIFEST_PATH.relative_to(ROOT)} with {len(entries)} mushrooms")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_contact_sheet([ROOT / entry["preview"] for entry in entries], CONTACT_SHEET_PATH)
    print(f"wrote {CONTACT_SHEET_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
