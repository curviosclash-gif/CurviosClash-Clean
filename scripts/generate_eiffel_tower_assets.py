#!/usr/bin/env python3
"""Generate the Eiffel Tower map assets.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_eiffel_tower_assets.py

Like the Notre-Dame set this reproduces a real structure, so the geometry is driven by
measurements rather than by a movement rule: 125 m base square, first platform at 57.63 m,
second at 115.73 m, top platform at 276.1 m, antenna tip at 330 m. Everything is modelled in
metres in one shared tower coordinate system -- X and Y are the two ground axes, Z is height
above the esplanade -- and the map preset scales the whole set uniformly. The exporter prints
each part's bounding box so the preset can place the parts back together.

The tower is a lattice, and a lattice is thousands of straight members. Building each member with
bpy.ops would cost one full scene update per beam, so the geometry is accumulated into plain
vertex and face buffers and handed to Blender as one mesh per material at the end. That keeps the
generator fast and, more importantly, keeps the export at a handful of nodes instead of a few
thousand draw calls.

The tower itself is public domain (the structure, not the night-time light show); every mesh here
is authored from primitives, nothing is downloaded or scanned.

Collision: the map runs in glbColliderMode 'scene', so every exported mesh that is not marked
_nocol carries triangle collision. That is deliberate -- on this map the openings between the
members *are* the level, and no set of authored boxes can describe them. Pure decoration (lamp
glass, the frieze, railing infill) keeps the _nocol suffix so the collider stays affordable.
"""

from math import cos, floor, pi, sin
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "eiffel_tower" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "eiffel_tower" / "glb"
FPS = 30

# --- Measurements, all in metres above the esplanade -------------------------------------------
FIRST_DECK = 57.63
SECOND_DECK = 115.73
TOP_DECK = 276.1
CUPOLA_TOP = 300.0
TIP = 330.0

# Half the square the four leg centres stand on, sampled up the tower. This is the curve that
# makes the silhouette: it falls steeply at the bottom and flattens out towards the top, which is
# what the wrought-iron profile does. Everything else -- bracing, decks, arches -- is derived from
# it, so the whole tower tapers consistently from this one table.
SPREAD = (
    (0.0, 62.5), (10.0, 55.0), (20.0, 48.0), (30.0, 42.5), (40.0, 38.0), (50.0, 34.3),
    (FIRST_DECK, 32.5), (70.0, 27.4), (85.0, 22.4), (100.0, 18.2), (SECOND_DECK, 15.0),
    (140.0, 12.3), (170.0, 10.0), (196.0, 8.6), (230.0, 7.0), (TOP_DECK, 5.6),
    (CUPOLA_TOP, 3.2), (TIP, 0.4),
)

# Each of the four legs is itself a square box of four uprights. This is the width of that box.
# Above the second platform it has shrunk to almost nothing, which is exactly how the four legs
# turn into the single upper shaft.
LEG_WIDTH = (
    (0.0, 26.0), (FIRST_DECK, 12.0), (SECOND_DECK, 6.0), (196.0, 2.6), (TOP_DECK, 1.3),
)

# Thickness of an upright. The members get lighter as the load above them gets smaller.
POST_THICKNESS = (
    (0.0, 1.7), (FIRST_DECK, 1.15), (SECOND_DECK, 0.8), (196.0, 0.58), (TOP_DECK, 0.42),
)

# The decorative arches under the first platform. They carry no load on the real tower either --
# Eiffel added them because the engineers' tower had to look like it belonged in Paris.
ARCH_SPRING = 26.0
ARCH_CROWN = 44.0

FIRST_DECK_OUTER = 36.5
FIRST_DECK_INNER = 24.0
SECOND_DECK_OUTER = 18.0
SECOND_DECK_INNER = 10.5

# Corner signs, walked in order so consecutive entries are neighbours around the square.
CORNERS = ((-1, -1), (1, -1), (1, 1), (-1, 1))

# --- Materials ---------------------------------------------------------------------------------
# "Brun tour Eiffel", the three-shade brown the tower is actually painted in: darker at the
# bottom, lighter at the top, so the structure does not read as a flat silhouette.
IRON = "Iron"
IRON_LIGHT = "IronLight"
IRON_DARK = "IronDark"
STONE = "Stone"
GRASS = "Grass"
GRAVEL = "Gravel"
GLASS = "Glass"
LAMP = "Lamp"
BEACON = "Beacon"
STEEL = "Steel"
SIGNAL = "Signal"

MATERIAL_COLORS = {
    IRON: ((0.29, 0.19, 0.11, 1.0), 0.0, 0.55),
    IRON_LIGHT: ((0.40, 0.27, 0.16, 1.0), 0.0, 0.5),
    IRON_DARK: ((0.17, 0.11, 0.07, 1.0), 0.0, 0.6),
    STONE: ((0.60, 0.57, 0.50, 1.0), 0.0, 0.05),
    GRASS: ((0.18, 0.30, 0.13, 1.0), 0.0, 0.0),
    GRAVEL: ((0.48, 0.44, 0.38, 1.0), 0.0, 0.05),
    GLASS: ((0.22, 0.42, 0.60, 1.0), 1.4, 0.35),
    LAMP: ((1.0, 0.74, 0.30, 1.0), 3.4, 0.1),
    BEACON: ((1.0, 0.96, 0.86, 1.0), 6.0, 0.1),
    STEEL: ((0.54, 0.56, 0.60, 1.0), 0.0, 0.75),
    SIGNAL: ((1.0, 0.46, 0.08, 1.0), 2.4, 0.2),
}


# --- Surface grain -----------------------------------------------------------------------------
# One flat colour per material makes a wall read as poured concrete: every stone in it carries the
# exact same value. Vertex colours fix that without a texture and without a second draw call --
# glTF multiplies COLOR_0 onto the material's base colour, so the authored colour stays the single
# source of truth and the tint only shades individual elements away from it.
#
# The tint darkens and never brightens. COLOR_0 leaves the exporter as a normalised ushort, so a
# value above 1.0 does not clamp -- it wraps, and 1.02 arrives as 0.02, turning one stone black.
# Keeping the range inside [0, 1] is a hard requirement, not a stylistic choice. Darkening is also
# the truthful direction: weathering makes stone dirtier, not brighter.
#
# One tint per element rather than per vertex: a single masonry block should be one shade, not a
# gradient across itself. It is derived from the element's own centre, so re-running a generator
# reproduces the identical file instead of reshuffling every stone.
GRAIN = True
DEFAULT_GRAIN_STRENGTH = 0.07
# Elements wider than this get proportionally less jitter. Variation between many repeated parts is
# what reads as a material; the same jitter applied to a single 400-unit terrain slab is not
# variation at all, just an arbitrary amount of darkness on the whole map floor.
GRAIN_FULL_SPAN = 12.0
# Below this the tint is not worth an attribute: invisible on screen and finer than the exported
# ushort resolves anyway.
GRAIN_EPSILON = 0.02
# Per-material overrides. Emissive materials are excluded automatically below -- a colour cast
# drifting across a torch flame reads as a bug rather than as variation.
MATERIAL_GRAIN = {
    STONE: 0.10,
    GRAVEL: 0.10,
    GRASS: 0.12,
    GLASS: 0.03,
    STEEL: 0.04,
}


def hash01(*values):
    """Deterministic 0..1 noise from a position.

    Python's own hash() is salted per process, so using it would make every regeneration produce a
    different file and turn each run into a diff.
    """
    total = 0.0
    for index, value in enumerate(values):
        total += (value + 3.7) * (12.9898 + 7.233 * index)
    fractional = sin(total) * 43758.5453
    return fractional - floor(fractional)


def grain_strength(material):
    override = MATERIAL_GRAIN.get(material)
    if override is not None:
        return override
    entry = MATERIAL_COLORS.get(material)
    if entry and entry[1] > 0:
        return 0.0
    return DEFAULT_GRAIN_STRENGTH


def element_tint(material, center, span=0.0):
    """The COLOR_0 multiplier for one drawn element, in [1 - 2 * strength, 1]."""
    strength = grain_strength(material) if GRAIN else 0.0
    if strength > 0 and span > GRAIN_FULL_SPAN:
        strength *= GRAIN_FULL_SPAN / span
    if strength <= 0:
        return (1.0, 1.0, 1.0, 1.0)
    shade = 1.0 - hash01(center.x, center.y, center.z) * 2.0 * strength
    # A second, weaker axis. Purely grey jitter still reads as one material sample repeated;
    # real stone varies in warmth as well as in brightness.
    warm = 1.0 - hash01(center.z, center.y, center.x) * strength
    channels = (shade, shade * (0.5 + 0.5 * warm), shade * warm)
    return tuple(min(1.0, max(0.0, channel)) for channel in channels) + (1.0,)


def apply_vertex_colors(mesh, colors):
    """Write the per-element tints as the mesh's active colour attribute.

    FLOAT_COLOR on the POINT domain: the buffers never share a vertex between two elements, so
    per-point is enough and stays a quarter the size of a per-corner layer. Float keeps the values
    linear, which is the space glTF reads COLOR_0 in -- a byte layer would be treated as sRGB and
    shift every shade.
    """
    if not colors:
        return None
    if len(colors) != len(mesh.vertices):
        # validate() dropped or merged vertices, so the tints no longer line up one to one.
        # Shipping a misaligned layer would stain random faces; skip it and say so.
        print(f"WARNING {mesh.name}: {len(colors)} tints for {len(mesh.vertices)} vertices, no grain")
        return None
    layer = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    flat = []
    for color in colors:
        flat.extend(color)
    layer.data.foreach_set("color", flat)
    mesh.color_attributes.active_color_index = len(mesh.color_attributes) - 1
    return layer


# --- Ambient occlusion -------------------------------------------------------------------------
# The grain says one stone differs from the next. It cannot say that the inside of an arch is
# darker than its face, because that depends on what stands around a surface rather than on which
# surface it is. Cycles bakes exactly that, and the result multiplies onto the same COLOR_0 the
# grain already uses -- so it still costs no texture, no second draw call and no material change.
#
# Two things decide whether it is worth anything:
#  - Distance. This is how far a surface looks for something blocking its view of the sky. At 0
#    Blender searches nowhere and every surface comes back fully lit. Measured on a wall standing
#    on a floor: distance 0 gave the contact 0.98, distance 6 gave it 0.37.
#  - Resolution. A vertex layer can only darken where there are vertices, and a wall drawn as a box
#    has eight of them, all on its corners. Large faces are therefore cut down to a grid before
#    baking, which is where the triangles go.
AO = True
# In authored units. Roughly the reach of a real contact shadow on this architecture: deep enough
# to darken an arch and a corner, short enough to leave an open wall alone.
AO_DISTANCE = 10.0
# Target edge length for the pre-bake grid. Occlusion falls off over AO_DISTANCE, so a grid coarser
# than about half of that cannot show the gradient at all.
AO_EDGE = 6.0
# Occlusion is sampled stochastically, so too few samples leave visible speckle rather than a
# gradient. It showed up first on thin bars, which is also why AO_MIN_EDGE exists.
AO_SAMPLES = 64
# How much of the baked occlusion reaches the final colour. Full strength reads as dirt.
AO_STRENGTH = 0.7
# Faces below this area keep their corners. A masonry block already has vertices on all four of its
# edges, which is where its contact shadow belongs -- cutting up its middle adds triangles that all
# come back with the same value.
AO_MIN_FACE_AREA = 80.0
# ...and a face is only worth refining if it is broad, not merely long. A 1x28 iron bar clears any
# area threshold while being far too narrow to hold a gradient across its width; subdividing it
# just gives the sampler somewhere to put noise.
AO_MIN_EDGE = 3.0


def _part_bvh(objects):
    """One BVH over everything in the part, to ask whether a surface has anything above it."""
    from mathutils.bvhtree import BVHTree

    verts = []
    polygons = []
    for obj in objects:
        offset = len(verts)
        matrix = obj.matrix_world
        verts.extend(matrix @ vertex.co for vertex in obj.data.vertices)
        polygons.extend(
            [offset + index for index in polygon.vertices] for polygon in obj.data.polygons
        )
    if not polygons:
        return None
    return BVHTree.FromPolygons(verts, polygons, all_triangles=False)


def _cone_directions(normal):
    """The face normal plus four directions tilted away from it, as a cheap sky sample."""
    up = Vector((0.0, 0.0, 1.0))
    if abs(normal.dot(up)) > 0.9:
        up = Vector((1.0, 0.0, 0.0))
    right = normal.cross(up).normalized()
    forward = normal.cross(right).normalized()
    yield normal
    for axis in (right, -right, forward, -forward):
        yield (normal + axis * 0.9).normalized()


def _face_is_occluded(bvh, face, distance):
    """Does anything block this face's view of the sky, within the occlusion distance?

    Sampled at the face centre and its corners: one probe in the middle of a 400 unit slab would
    miss the wall standing on its edge, and then the slab would never be refined there.
    """
    normal = face.normal
    if normal.length_squared < 1e-12:
        return False
    points = [face.calc_center_median()]
    points.extend(vertex.co for vertex in face.verts)
    for point in points:
        origin = point + normal * 0.02
        for direction in _cone_directions(normal):
            if bvh.ray_cast(origin, direction, distance)[0] is not None:
                return True
    return False


def _subdivide_shadowed_faces(obj, bvh, target_edge, min_area, distance):
    """Refine only the faces something actually shadows.

    A flat grid over every large surface is what makes this expensive, and most of it is wasted: an
    open terrain slab has nothing above it, so a thousand extra triangles there carry a thousand
    identical values. Testing before each round and refining only what is occluded keeps the
    triangles where the gradient will be. Each round halves the faces, so the test gets sharper as
    the faces get smaller.
    """
    import bmesh

    mesh = obj.data
    for _ in range(5):
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        edges = set()
        for face in bm.faces:
            if face.calc_area() < min_area:
                continue
            lengths = [edge.calc_length() for edge in face.edges]
            if min(lengths) < AO_MIN_EDGE:
                continue
            long_edges = [edge for edge in face.edges if edge.calc_length() > target_edge]
            if not long_edges or not _face_is_occluded(bvh, face, distance):
                continue
            edges.update(long_edges)
        if not edges:
            bm.free()
            break
        bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=1, use_grid_fill=True)
        bm.to_mesh(mesh)
        bm.free()
    mesh.update()


def bake_ambient_occlusion(objects, distance=None, samples=None):
    """Bake occlusion for one part and multiply it into the existing grain layer.

    Every part is exported from its own scene, so a surface is only shadowed by the geometry of the
    part it belongs to. That is a real limit -- a curtain wall does not darken the ground of another
    file -- but within a part it covers arches, corners, galleries and undersides.
    """
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices)]
    if not AO or not meshes:
        return 0

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(samples or AO_SAMPLES)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = float(distance or AO_DISTANCE)
    scene.render.bake.target = "VERTEX_COLORS"

    bvh = _part_bvh(meshes)
    for obj in meshes:
        if bvh is not None:
            _subdivide_shadowed_faces(obj, bvh, AO_EDGE, AO_MIN_FACE_AREA, AO_DISTANCE)
        layer = obj.data.color_attributes.get("AO")
        if layer is None:
            layer = obj.data.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        layer.data.foreach_set("color", [1.0] * (4 * len(obj.data.vertices)))
        obj.data.color_attributes.active_color_index = obj.data.color_attributes.find("AO")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type="AO")

    darkened = 0
    for obj in meshes:
        mesh = obj.data
        count = len(mesh.vertices)
        occlusion = [0.0] * (4 * count)
        mesh.color_attributes["AO"].data.foreach_get("color", occlusion)

        grain = mesh.color_attributes.get("Col")
        tints = [1.0] * (4 * count)
        if grain:
            grain.data.foreach_get("color", tints)
        else:
            grain = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")

        for index in range(count):
            # 1 is open sky, 0 is fully enclosed. Never brighten: the grain is already the ceiling,
            # and COLOR_0 wraps rather than clamps above 1.
            shade = 1.0 - AO_STRENGTH * (1.0 - min(1.0, max(0.0, occlusion[index * 4])))
            if shade < 0.999:
                darkened += 1
            for channel in range(3):
                tints[index * 4 + channel] = min(1.0, max(0.0, tints[index * 4 + channel] * shade))
            tints[index * 4 + 3] = 1.0
        grain.data.foreach_set("color", tints)

        mesh.color_attributes.remove(mesh.color_attributes["AO"])
        mesh.color_attributes.active_color_index = mesh.color_attributes.find("Col")
    return darkened


def prune_neutral_vertex_colors():
    """Drop colour layers that would multiply everything by one.

    Runs after the bake, because a layer that looked neutral when the grain was written may well
    carry occlusion by now. Left in, it costs eight bytes per vertex to change nothing.
    """
    removed = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        layer = obj.data.color_attributes.get("Col")
        if layer is None:
            continue
        values = [0.0] * (4 * len(obj.data.vertices))
        layer.data.foreach_get("color", values)
        if all(value >= 1.0 - GRAIN_EPSILON for index, value in enumerate(values) if index % 4 != 3):
            obj.data.color_attributes.remove(layer)
            removed += 1
    return removed


def interpolate(table, height):
    """Read a tapering table at one height, clamped at both ends."""
    if height <= table[0][0]:
        return table[0][1]
    if height >= table[-1][0]:
        return table[-1][1]
    for index in range(len(table) - 1):
        low_z, low_value = table[index]
        high_z, high_value = table[index + 1]
        if low_z <= height <= high_z:
            span = high_z - low_z
            ratio = 0.0 if span <= 0 else (height - low_z) / span
            return low_value + (high_value - low_value) * ratio
    return table[-1][1]


def spread(height):
    return interpolate(SPREAD, height)


def leg_width(height):
    return interpolate(LEG_WIDTH, height)


def post_thickness(height):
    return interpolate(POST_THICKNESS, height)


# --- Primitive geometry ------------------------------------------------------------------------
# Unit shapes centred on their own origin, so one transform matrix places any of them.

CUBE_VERTS = (
    (-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
    (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5),
)
CUBE_FACES = (
    (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
)


def frustum_geometry(radius_bottom, radius_top, height, sides):
    """A closed frustum: a cylinder when both radii match, a cone when the top one is zero."""
    verts = []
    for radius, level in ((radius_bottom, -height / 2), (radius_top, height / 2)):
        for index in range(sides):
            angle = 2 * pi * index / sides
            verts.append((radius * cos(angle), radius * sin(angle), level))
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    for index in range(sides):
        following = (index + 1) % sides
        faces.append((index, following, following + sides, index + sides))
    return verts, faces


class Canvas:
    """Everything drawn for one exported part, bucketed by material.

    Members are appended as raw vertices and faces rather than as Blender objects. A part of this
    tower is a few thousand members; created one bpy.ops call at a time that takes minutes and
    exports thousands of nodes, while a single mesh per material takes a second and exports as one.
    """

    def __init__(self):
        self.buckets = {}

    def _bucket(self, material, decorative):
        return self.buckets.setdefault((material, decorative), ([], [], []))

    def _add(self, material, decorative, verts, faces, matrix):
        bucket_verts, bucket_faces, bucket_colors = self._bucket(material, decorative)
        placed = [matrix @ Vector(vertex) for vertex in verts]
        if not placed:
            return
        offset = len(bucket_verts)
        center = sum(placed, Vector((0.0, 0.0, 0.0))) / len(placed)
        span = max(
            max(vertex[axis] for vertex in placed) - min(vertex[axis] for vertex in placed)
            for axis in range(3)
        )
        tint = element_tint(material, center, span)
        for vertex in placed:
            bucket_verts.append(tuple(vertex))
            bucket_colors.append(tint)
        for face in faces:
            bucket_faces.append(tuple(index + offset for index in face))

    def box(self, material, center, size, rotation=(0, 0, 0), decorative=False):
        matrix = (
            Matrix.Translation(Vector(center))
            @ Euler(rotation, "XYZ").to_matrix().to_4x4()
            @ Matrix.Diagonal(Vector((size[0], size[1], size[2], 1.0)))
        )
        self._add(material, decorative, CUBE_VERTS, CUBE_FACES, matrix)

    def beam(self, material, start, end, thickness, width=None, decorative=False):
        """One straight member between two points, oriented along the line that joins them.

        This is the only shape the lattice needs. Getting the orientation from the direction
        vector instead of from axis-aligned boxes is the whole job: an axis-aligned member turns
        a splayed leg back into a staircase of blocks.
        """
        direction = Vector(end) - Vector(start)
        length = direction.length
        if length < 1e-5:
            return
        matrix = (
            Matrix.Translation((Vector(start) + Vector(end)) / 2)
            @ direction.to_track_quat("Z", "Y").to_matrix().to_4x4()
            @ Matrix.Diagonal(Vector((thickness, width or thickness, length, 1.0)))
        )
        self._add(material, decorative, CUBE_VERTS, CUBE_FACES, matrix)

    def frustum(self, material, center, radius_bottom, radius_top, height, sides=10,
                rotation=(0, 0, 0), decorative=False):
        verts, faces = frustum_geometry(radius_bottom, radius_top, height, sides)
        matrix = Matrix.Translation(Vector(center)) @ Euler(rotation, "XYZ").to_matrix().to_4x4()
        self._add(material, decorative, verts, faces, matrix)

    def emit(self, part_name, parent=None):
        """Hand the buffers to Blender as one object per material."""
        created = []
        for (material, decorative), (verts, faces, colors) in sorted(self.buckets.items()):
            if not faces:
                continue
            name = f"{part_name}_{material.lower()}{'_nocol' if decorative else ''}"
            mesh = bpy.data.meshes.new(f"{name}_mesh")
            mesh.from_pydata(verts, [], faces)
            mesh.validate()
            mesh.update()
            mesh.materials.append(build_material(material))
            apply_vertex_colors(mesh, colors)
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.collection.objects.link(obj)
            if parent is not None:
                obj.parent = parent
            created.append(obj)
        return created


def build_material(name):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    color, emission, metallic = MATERIAL_COLORS[name]
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    metallic_input = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    shader.inputs["Roughness"].default_value = 0.34
    if emission > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission
    return value


# --- The lattice -------------------------------------------------------------------------------


def pillar_nodes(height, sign_x, sign_y):
    """The four uprights of one leg at one height, walked around the leg's own square."""
    center = spread(height)
    half = leg_width(height) / 2
    return [
        (sign_x * center + dx * half, sign_y * center + dy * half, height)
        for dx, dy in CORNERS
    ]


def tower_section(canvas, low, high, bays, belt_top=True):
    """One stretch of the tower: four legs, each an X-braced box of four uprights.

    Every bay is sampled off the taper tables rather than interpolated between two end shapes, so
    the members always land on the curve the silhouette is drawn from.
    """
    for bay in range(bays):
        lower_z = low + (high - low) * bay / bays
        upper_z = low + (high - low) * (bay + 1) / bays
        thickness = post_thickness(lower_z)
        for sign_x, sign_y in CORNERS:
            lower = pillar_nodes(lower_z, sign_x, sign_y)
            upper = pillar_nodes(upper_z, sign_x, sign_y)
            for index in range(4):
                following = (index + 1) % 4
                canvas.beam(IRON, lower[index], upper[index], thickness)
                canvas.beam(IRON_DARK, lower[index], lower[following], thickness * 0.7)
                # The X on every face. Two diagonals per bay per face is what carries the wind
                # load on the real tower and what makes the see-through texture of the thing.
                canvas.beam(IRON_LIGHT, lower[index], upper[following], thickness * 0.5)
                canvas.beam(IRON_LIGHT, lower[following], upper[index], thickness * 0.5)
            if belt_top and bay == bays - 1:
                for index in range(4):
                    canvas.beam(IRON_DARK, upper[index], upper[(index + 1) % 4], thickness * 0.7)


def deck_ring(canvas, material, height, outer, inner, thickness, decorative=False):
    """A square platform with an open middle, built as four slabs.

    The middle stays open on purpose: on the real tower the first and second floors are galleries
    around a void, and on this map that void is the way up through the building.
    """
    band = outer - inner
    center = (outer + inner) / 2
    for sign in (-1, 1):
        canvas.box(material, (0, sign * center, height), (outer * 2, band, thickness),
                   decorative=decorative)
        canvas.box(material, (sign * center, 0, height), (band, inner * 2, thickness),
                   decorative=decorative)


def railing(canvas, height, half, posts_per_side=14):
    """Parapet around a platform edge: a solid kerb that collides, infill that does not."""
    for sign in (-1, 1):
        canvas.box(IRON, (0, sign * half, height + 0.7), (half * 2, 0.35, 1.4))
        canvas.box(IRON, (sign * half, 0, height + 0.7), (0.35, half * 2, 1.4))
    for index in range(posts_per_side + 1):
        offset = -half + (2 * half) * index / posts_per_side
        for sign in (-1, 1):
            canvas.box(IRON_LIGHT, (offset, sign * half, height + 0.7), (0.16, 0.5, 1.35),
                       decorative=True)
            canvas.box(IRON_LIGHT, (sign * half, offset, height + 0.7), (0.5, 0.16, 1.35),
                       decorative=True)


# --- Static parts ------------------------------------------------------------------------------


def build_esplanade(canvas):
    """The Champ-de-Mars under the tower, plus the four masonry piers the legs stand on."""
    canvas.box(GRASS, (0, 0, -0.75), (300, 300, 1.5))
    # The gravel square directly under the tower, and the two long walks that cross it.
    canvas.box(GRAVEL, (0, 0, 0.05), (170, 170, 0.4))
    canvas.box(GRAVEL, (0, 0, 0.12), (300, 26, 0.4))
    canvas.box(GRAVEL, (0, 0, 0.12), (26, 300, 0.4))
    for sign_x, sign_y in CORNERS:
        base = spread(0.0)
        canvas.box(STONE, (sign_x * base, sign_y * base, 1.4), (34, 34, 2.8))
        canvas.box(STONE, (sign_x * base, sign_y * base, 3.4), (28, 28, 1.4))
        # A lamp standard at each pier, so the piers read at night as well as by day.
        for dx, dy in CORNERS:
            canvas.box(IRON_DARK, (sign_x * base + dx * 19, sign_y * base + dy * 19, 3.0),
                       (0.6, 0.6, 6.0))
            canvas.frustum(LAMP, (sign_x * base + dx * 19, sign_y * base + dy * 19, 6.4),
                           0.9, 0.4, 1.4, sides=8, decorative=True)
    # Tree blocks along the two garden edges. Cheap, but they give the ground a scale reference.
    for index in range(-4, 5):
        for sign in (-1, 1):
            canvas.frustum(GRASS, (index * 22.0, sign * 108.0, 6.0), 5.5, 3.0, 12.0, sides=6)
            canvas.frustum(GRASS, (sign * 108.0, index * 22.0, 6.0), 5.5, 3.0, 12.0, sides=6)


def build_legs_lower(canvas):
    """Ground to the first platform: the widest, heaviest stretch of the lattice."""
    tower_section(canvas, 0.0, FIRST_DECK, 8)
    # The shoes: each upright meets its pier through a cast base rather than ending in mid-air.
    for sign_x, sign_y in CORNERS:
        for node in pillar_nodes(0.0, sign_x, sign_y):
            canvas.box(IRON_DARK, (node[0], node[1], 1.6), (3.6, 3.6, 3.2))


def build_arches(canvas):
    """The four decorative arches under the first platform, one per side.

    Each side is drawn in its own frame -- `along` runs across the side, `out` points away from
    the tower -- and then rotated into place, so the same curve serves all four.
    """
    steps = 16
    for quarter in range(4):
        angle = quarter * pi / 2
        cosine, sine = cos(angle), sin(angle)

        def place(along, out, height):
            return (along * cosine - out * sine, along * sine + out * cosine, height)

        def sample(step):
            ratio = -1.0 + 2.0 * step / steps
            height = ARCH_CROWN - (ARCH_CROWN - ARCH_SPRING) * ratio * ratio
            return ratio * spread(ARCH_SPRING), spread(height) - 1.2, height

        for step in range(steps):
            along_a, out_a, z_a = sample(step)
            along_b, out_b, z_b = sample(step + 1)
            upper_a = place(along_a, out_a, z_a)
            upper_b = place(along_b, out_b, z_b)
            lower_a = place(along_a, out_a, z_a - 4.2)
            lower_b = place(along_b, out_b, z_b - 4.2)
            canvas.beam(IRON, upper_a, upper_b, 1.5, width=2.4)
            canvas.beam(IRON, lower_a, lower_b, 1.1, width=2.0)
            canvas.beam(IRON_LIGHT, lower_a, upper_b, 0.5)
            if step % 2 == 0:
                # The openwork panel hanging below the arch band.
                canvas.beam(IRON_LIGHT, lower_a, place(along_a, out_a, z_a - 8.4), 0.45)
        # The clock face that sat over the middle of each arch at the 1889 exposition.
        canvas.frustum(LAMP, place(0.0, spread(ARCH_CROWN) - 1.4, ARCH_CROWN - 6.0),
                       3.4, 3.4, 0.5, sides=14, rotation=(pi / 2, 0, angle), decorative=True)


def build_first_floor(canvas):
    """The first platform at 57.63 m: gallery ring, parapet, frieze and the four pavilions."""
    deck_ring(canvas, IRON, FIRST_DECK + 0.6, FIRST_DECK_OUTER, FIRST_DECK_INNER, 1.4)
    # The bracket work that carries the overhang past the legs.
    for quarter in range(4):
        angle = quarter * pi / 2
        cosine, sine = cos(angle), sin(angle)
        for index in range(-6, 7):
            along = index * 5.6
            root = (along * cosine - (FIRST_DECK_INNER + 2) * sine,
                    along * sine + (FIRST_DECK_INNER + 2) * cosine, FIRST_DECK - 5.0)
            tip = (along * cosine - FIRST_DECK_OUTER * sine,
                   along * sine + FIRST_DECK_OUTER * cosine, FIRST_DECK - 0.2)
            canvas.beam(IRON_DARK, root, tip, 0.55)
    railing(canvas, FIRST_DECK + 1.3, FIRST_DECK_OUTER)
    # The frieze: on the real tower this band carries the seventy-two engravers' names in gold.
    for sign in (-1, 1):
        canvas.box(LAMP, (0, sign * (FIRST_DECK_OUTER + 0.2), FIRST_DECK - 1.4),
                   (FIRST_DECK_OUTER * 2, 0.3, 1.8), decorative=True)
        canvas.box(LAMP, (sign * (FIRST_DECK_OUTER + 0.2), 0, FIRST_DECK - 1.4),
                   (0.3, FIRST_DECK_OUTER * 2, 1.8), decorative=True)
    # Four pavilions, one at the middle of each side.
    for quarter in range(4):
        angle = quarter * pi / 2
        center = ((FIRST_DECK_OUTER + FIRST_DECK_INNER) / 2)
        position = (-center * sin(angle), center * cos(angle), FIRST_DECK + 3.6)
        canvas.box(IRON_DARK, position, (16.0, 9.0, 5.0), rotation=(0, 0, angle))
        canvas.box(GLASS, (position[0], position[1], position[2] + 0.2), (15.0, 9.4, 2.6),
                   rotation=(0, 0, angle), decorative=True)
        canvas.box(IRON, (position[0], position[1], position[2] + 3.0), (17.0, 10.0, 1.0),
                   rotation=(0, 0, angle))


def build_legs_mid(canvas):
    """First to second platform: the four legs are still separate, and converging fast."""
    tower_section(canvas, FIRST_DECK + 2.4, SECOND_DECK, 7)


def build_second_floor(canvas):
    """The second platform at 115.73 m, and the restaurant box that sits on it."""
    deck_ring(canvas, IRON, SECOND_DECK + 0.5, SECOND_DECK_OUTER, SECOND_DECK_INNER, 1.2)
    for quarter in range(4):
        angle = quarter * pi / 2
        cosine, sine = cos(angle), sin(angle)
        for index in range(-3, 4):
            along = index * 4.4
            root = (along * cosine - (SECOND_DECK_INNER + 1) * sine,
                    along * sine + (SECOND_DECK_INNER + 1) * cosine, SECOND_DECK - 4.0)
            tip = (along * cosine - SECOND_DECK_OUTER * sine,
                   along * sine + SECOND_DECK_OUTER * cosine, SECOND_DECK - 0.2)
            canvas.beam(IRON_DARK, root, tip, 0.45)
    railing(canvas, SECOND_DECK + 1.1, SECOND_DECK_OUTER, posts_per_side=10)
    for sign in (-1, 1):
        position = (0, sign * (SECOND_DECK_OUTER + SECOND_DECK_INNER) / 2, SECOND_DECK + 3.4)
        canvas.box(IRON_DARK, position, (18.0, 6.4, 4.2))
        canvas.box(GLASS, (position[0], position[1], position[2] + 0.3), (17.0, 6.8, 2.2),
                   decorative=True)
    for sign in (-1, 1):
        canvas.box(LAMP, (sign * (SECOND_DECK_OUTER + 0.2), 0, SECOND_DECK - 1.2),
                   (0.3, SECOND_DECK_OUTER * 2, 1.4), decorative=True)


def build_shaft(canvas):
    """Second platform to top platform: one tapering lattice, 156 m of it.

    The four legs have effectively merged by now, which is why this reads as a single shaft even
    though it is built by the same four-leg rule as everything below.
    """
    tower_section(canvas, SECOND_DECK + 2.2, TOP_DECK, 16)
    # The intermediate platform two thirds of the way up, a landmark on an otherwise even climb.
    deck_ring(canvas, IRON_DARK, 196.0, spread(196.0) + 2.6, spread(196.0) - 1.8, 0.9)
    for sign in (-1, 1):
        canvas.box(LAMP, (sign * (spread(196.0) + 2.7), 0, 196.6),
                   (0.3, (spread(196.0) + 2.6) * 2, 0.7), decorative=True)


def build_summit(canvas):
    """Top platform, cupola, mast and the antenna that takes the tower to 330 m."""
    canvas.frustum(IRON, (0, 0, TOP_DECK + 0.6), 9.5, 9.5, 1.2, sides=12)
    railing(canvas, TOP_DECK + 1.2, 9.0, posts_per_side=8)
    # The glazed upper level and Gustave Eiffel's own apartment beside it.
    canvas.frustum(IRON_DARK, (0, 0, TOP_DECK + 5.4), 8.4, 7.6, 4.4, sides=12)
    canvas.frustum(GLASS, (0, 0, TOP_DECK + 5.4), 8.6, 7.8, 2.6, sides=12, decorative=True)
    canvas.frustum(IRON, (0, 0, TOP_DECK + 8.2), 8.8, 8.8, 1.0, sides=12)
    canvas.box(IRON_DARK, (0, 6.0, TOP_DECK + 11.0), (7.0, 4.0, 4.4))
    canvas.box(GLASS, (0, 6.0, TOP_DECK + 11.2), (6.2, 4.4, 2.0), decorative=True)
    # The cupola, then the mast.
    canvas.frustum(IRON, (0, 0, TOP_DECK + 15.0), 7.4, 3.0, 9.0, sides=12)
    for step in range(4):
        low = CUPOLA_TOP - 8.0 + step * 3.0
        canvas.frustum(STEEL, (0, 0, low), 2.4 - step * 0.35, 2.1 - step * 0.35, 3.0, sides=8)
    canvas.frustum(STEEL, (0, 0, (CUPOLA_TOP + 316.0) / 2), 1.5, 0.9, 316.0 - CUPOLA_TOP, sides=8)
    # The broadcast antenna. Its rings are what make the last twenty metres read as an aerial
    # rather than as a flagpole.
    canvas.frustum(STEEL, (0, 0, (316.0 + TIP) / 2), 0.55, 0.16, TIP - 316.0, sides=6)
    for step in range(4):
        height = 304.0 + step * 5.0
        canvas.frustum(SIGNAL, (0, 0, height), 1.9 - step * 0.35, 1.9 - step * 0.35, 0.35,
                       sides=10, decorative=True)
    canvas.frustum(BEACON, (0, 0, TIP - 0.6), 0.5, 0.5, 1.2, sides=6, decorative=True)


# --- Animated parts ----------------------------------------------------------------------------
# Each of these is a rig empty with meshes parented under it. The runtime derives a dynamic
# collider from anything an animation moves, so what is parented under a keyframed empty is what
# a player can be hit by.


def rig(name, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def keyframe(obj, frame, *, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def build_leg_elevator(scene, _mats):
    """The inclined lift that climbs inside one leg, from the pier up to the first platform.

    Modelled in the leg's own frame: the track climbs in +Y as it rises, at the same slope the
    leg does, so the preset only has to rotate the file onto whichever leg it is placed on.
    """
    run = 42.4      # the leg's horizontal travel, taken along its diagonal
    rise = FIRST_DECK
    track = Canvas()
    for side in (-1, 1):
        track.beam(STEEL, (side * 2.4, 0, 0), (side * 2.4, run, rise), 0.4)
        track.beam(IRON_DARK, (side * 3.6, 0, 0), (side * 3.6, run, rise), 0.5)
    for step in range(13):
        ratio = step / 12
        track.box(IRON_DARK, (0, run * ratio, rise * ratio + 0.2), (8.4, 0.5, 0.4))
    track.emit("leg_elevator_track")

    car_rig = rig("LegElevatorCar")
    car = Canvas()
    car.box(SIGNAL, (0, 0, 1.9), (6.4, 5.6, 3.8))
    car.box(GLASS, (0, 0, 2.4), (6.6, 5.0, 2.0), decorative=True)
    car.box(STEEL, (0, 0, 4.0), (7.0, 6.0, 0.5))
    car.emit("leg_elevator_car", parent=car_rig)

    first, middle, last = scene.frame_start, (scene.frame_start + scene.frame_end) // 2, scene.frame_end
    keyframe(car_rig, first, location=(0, 1.5, 1.0))
    keyframe(car_rig, middle, location=(0, run - 1.5, rise - 1.0))
    keyframe(car_rig, last, location=(0, 1.5, 1.0))


def build_shaft_lift(scene, _mats):
    """The vertical lift between the second platform and the summit.

    It runs inside the upper shaft, which is the map's shortcut: a player who takes the inside of
    the tower instead of spiralling around it has to share the channel with this car.
    """
    travel = TOP_DECK - SECOND_DECK - 6.0
    guides = Canvas()
    for dx, dy in CORNERS:
        guides.beam(STEEL, (dx * 2.0, dy * 2.0, 0), (dx * 2.0, dy * 2.0, travel), 0.3)
    for step in range(9):
        height = travel * step / 8
        for index in range(4):
            dx, dy = CORNERS[index]
            nx, ny = CORNERS[(index + 1) % 4]
            guides.beam(IRON_DARK, (dx * 2.0, dy * 2.0, height), (nx * 2.0, ny * 2.0, height), 0.25)
    guides.emit("shaft_lift_guides")

    car_rig = rig("ShaftLiftCar")
    car = Canvas()
    car.box(SIGNAL, (0, 0, 0), (5.0, 5.0, 3.4))
    car.box(GLASS, (0, 0, 0.2), (5.2, 5.2, 1.8), decorative=True)
    car.box(SIGNAL, (0, 0, 3.4), (5.0, 5.0, 3.4))
    car.box(STEEL, (0, 0, 5.4), (5.6, 5.6, 0.5))
    car.emit("shaft_lift_car", parent=car_rig)

    first, middle, last = scene.frame_start, (scene.frame_start + scene.frame_end) // 2, scene.frame_end
    keyframe(car_rig, first, location=(0, 0, 2.5))
    keyframe(car_rig, middle, location=(0, 0, travel - 4.0))
    keyframe(car_rig, last, location=(0, 0, 2.5))


def build_beacon(scene, _mats):
    """The rotating beacon on the summit: two beams sweeping the sky once per loop."""
    housing = Canvas()
    housing.frustum(IRON_DARK, (0, 0, 0), 3.4, 3.0, 2.2, sides=10)
    housing.frustum(STEEL, (0, 0, 1.6), 3.6, 3.6, 0.4, sides=10)
    housing.emit("beacon_housing")

    beacon_rig = rig("BeaconHead", (0, 0, 2.6))
    head = Canvas()
    head.frustum(BEACON, (0, 0, 0), 2.2, 2.2, 2.4, sides=10)
    for sign in (-1, 1):
        # The visible beam. It collides, which is the point: it sweeps the airspace a player has
        # to cross to reach the tip.
        head.box(BEACON, (sign * 13.0, 0, 0), (24.0, 1.6, 1.6))
        head.box(LAMP, (sign * 13.0, 0, 0), (24.4, 2.4, 2.4), decorative=True)
    head.emit("beacon_head", parent=beacon_rig)

    keyframe(beacon_rig, scene.frame_start, rotation=(0, 0, 0))
    keyframe(beacon_rig, scene.frame_end, rotation=(0, 0, 2 * pi))


def build_illumination_ring(scene, _mats):
    """An iris of floodlight panels under the first platform whose opening travels.

    Closed, the twelve panels overlap into a near-solid disc across the way up through the middle
    of the tower; open, they fold out to the housing ring. They fold in sequence, so the gap
    travels around the iris instead of the whole thing opening at once. This is the first thing a
    run flies through, and it teaches the rule the tower runs on: the way up is always open
    somewhere, just not where it was a moment ago.
    """
    closed_radius = 6.0
    open_radius = 15.5
    frame = Canvas()
    for index in range(12):
        angle = 2 * pi * index / 12
        frame.beam(
            IRON_DARK,
            (17.0 * cos(angle), 17.0 * sin(angle), 0),
            (17.0 * cos(angle + pi / 6), 17.0 * sin(angle + pi / 6), 0),
            0.7,
        )
    frame.emit("illumination_ring_frame")

    first = scene.frame_start
    last = scene.frame_end
    for index in range(12):
        angle = 2 * pi * index / 12
        closed = (closed_radius * cos(angle), closed_radius * sin(angle), 0)
        opened = (open_radius * cos(angle), open_radius * sin(angle), 0)
        panel_rig = rig(f"IlluminationPanel{index}", closed)
        panel = Canvas()
        # The panel stands across its own arc, not along the radius: twelve of them then meet
        # edge to edge when pulled in, and leave a real gap when one folds out.
        panel.box(SIGNAL, (0, 0, 0), (4.0, 1.0, 5.6), rotation=(0, 0, angle + pi / 2))
        panel.box(LAMP, (0, 0, 0), (3.6, 1.4, 5.2), rotation=(0, 0, angle + pi / 2),
                  decorative=True)
        panel.emit(f"illumination_panel_{index}", parent=panel_rig)
        # Each panel folds out one twelfth of a loop after the one before it, so the gap travels
        # around the iris instead of the whole thing opening at once.
        open_frame = first + int((last - first) * (index / 12.0))
        keyframe(panel_rig, first, location=closed)
        if open_frame > first + 2:
            keyframe(panel_rig, open_frame - 2, location=closed)
        keyframe(panel_rig, min(open_frame + 4, last - 2), location=opened)
        keyframe(panel_rig, min(open_frame + 12, last - 1), location=closed)
        keyframe(panel_rig, last, location=closed)


# --- Export ------------------------------------------------------------------------------------

ARCHITECTURE = (
    ("01_champ_de_mars", build_esplanade),
    ("02_legs_lower", build_legs_lower),
    ("03_arches", build_arches),
    ("04_first_floor", build_first_floor),
    ("05_legs_mid", build_legs_mid),
    ("06_second_floor", build_second_floor),
    ("07_shaft", build_shaft),
    ("08_summit", build_summit),
)

SETPIECES = (
    ("09_leg_elevator", "LegElevatorLoop", 14, build_leg_elevator),
    ("10_shaft_lift", "ShaftLiftLoop", 12, build_shaft_lift),
    ("11_beacon", "BeaconLoop", 8, build_beacon),
    ("12_illumination_ring", "IlluminationRingLoop", 9, build_illumination_ring),
)


def reset_scene(name, duration_seconds=0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1 + round(duration_seconds * FPS) if duration_seconds else 1
    scene["setpiece"] = name
    if duration_seconds:
        scene["loop_duration_seconds"] = duration_seconds
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def scene_bounds():
    """Bounding box of everything in the scene, in tower metres.

    Printed for every part because the loader recentres each file on its own bounding box: the
    preset position is this centre in X/Y and this minimum in Z.
    """
    lows = [float("inf")] * 3
    highs = [float("-inf")] * 3
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lows[axis] = min(lows[axis], world[axis])
                highs[axis] = max(highs[axis], world[axis])
    return lows, highs


def triangle_count():
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for polygon in obj.data.polygons:
            total += max(1, len(polygon.vertices) - 2)
    return total


def report(glb_path, extra=""):
    lows, highs = scene_bounds()
    nodes = len([obj for obj in bpy.context.scene.objects if obj.type == "MESH"])
    # Blender is Z-up, the export is Y-up: the preset reads X from Blender X, height from
    # Blender Z and the map's Z axis from Blender -Y.
    print(
        f"generated {glb_path.relative_to(ROOT)} {extra}"
        f"tris={triangle_count()} nodes={nodes} "
        f"center_x={(lows[0] + highs[0]) / 2:.2f} "
        f"center_z={-(lows[1] + highs[1]) / 2:.2f} "
        f"base_y={lows[2]:.2f} "
        f"size=({highs[0] - lows[0]:.1f}, {highs[2] - lows[2]:.1f}, {highs[1] - lows[1]:.1f})"
    )


def export_part(file_stem, builder):
    scene = reset_scene(file_stem)
    canvas = Canvas()
    builder(canvas)
    canvas.emit(file_stem.split("_", 1)[1])
    scene.frame_set(scene.frame_start)
    bake_ambient_occlusion(list(scene.objects))
    prune_neutral_vertex_colors()

    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
        # ACTIVE rather than MATERIAL: the tints are written straight onto the mesh, so the
        # materials keep their plain Principled setup instead of carrying a colour-attribute node
        # just to satisfy the exporter.
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
    )
    report(glb_path)


def export_setpiece(file_stem, clip_name, duration, builder):
    scene = reset_scene(clip_name, duration)
    builder(scene, None)
    scene.frame_set(scene.frame_start)
    # No occlusion on setpieces. A drawbridge that swings through ninety degrees has no fixed
    # relationship to what shadows it, so any baked value would be wrong for most of the loop.
    prune_neutral_vertex_colors()

    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        # SCENE mode exports exactly one clip named after the scene, which is what the runtime
        # clock addresses by name.
        export_animation_mode="SCENE",
        export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
    )
    report(glb_path, extra=f"clip={clip_name} loop={duration}s ")


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for part in ARCHITECTURE:
        export_part(*part)
    for setpiece in SETPIECES:
        export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
