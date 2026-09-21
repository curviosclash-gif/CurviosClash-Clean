#!/usr/bin/env python3
"""Generate the reactor site: a nuclear plant whose towers can be shot down and whose reactor
block, once breached, sends up a mushroom cloud.

Run with Blender 4.2 LTS through the dispatcher:

    node scripts/generate-map-assets.mjs --map reactor_site

Everything is modelled in metres in one shared site coordinate system -- X and Y are the two
ground axes, Z is height above the apron -- and the map preset scales the whole set uniformly at
0.6 authored units per metre, like the Eiffel Tower. North on the map is +Z, which is Blender -Y:
the switchyard stands north of the reactor, the turbine hall south of it.

The pack borrows the Eiffel generator's toolkit (`BASE = et`): the vertex-buffer canvas, the
material and grain rules, the occlusion bake and the glTF exporter. No tower geometry is used --
the only thing the two packs share in the file is the exporter's flags, which keeps the reactor's
files loading exactly like every other Blender map.

What stands on the site
-----------------------
  01_site           the apron, the grass beyond it, roads, the perimeter fence, the switchyard
                    and its pylons, irregular blast-wall compounds, staggered checkpoints, lamp
                    masts, the basin under each cooling tower, and everything around and inside
                    the turbine hall that survives it: the floor, the turbine sets, the annexes,
                    the steam lines. Static.
  02_turbine_hall   the shell of the long hall south of the reactor: four walls, the roof, the
                    two gable doors a ship can fly through. Destructible: segment `turbine_hall`.
  03_reactor_block  the containment cylinder with its dome, flanked by two auxiliary wings on
                    -Y and +Y. Destructible: segment `reactor_dome`.
  04_cooling_tower  one hyperboloid shell on a ring of inlet columns. Placed twice by the preset,
                    west and east; the anchor tells the two apart.
                    Destructible: segments `cooling_tower_w` / `cooling_tower_e`.
  05_vent_stack     the tall discharge chimney beside the turbine hall. Destructible: `vent_stack`.

What comes down
---------------
  20_topple_tower_west, 21_topple_tower_east  the very same collapse, exported twice under
                    different rig names, because every piece of a map exists exactly once and the
                    two towers must not share one. A cooling tower is as wide as it is tall, and a
                    body that squat does not topple: shot at the base it does what demolished
                    towers do and folds into itself. The shell is cut into four sectors, front,
                    left, right and back of the hit; the front loses its columns outright and the
                    others keep a sliver of support on their inner edge, so each sector tips
                    towards the axis and the four of them come down onto each other inside the
                    basin, the struck one first.
  22_topple_stack   the chimney, which is slender and topples like one: it loses the ground on
                    the struck side, goes over the columns of concrete left standing, and shears a
                    third of the way up while it is falling. Two pieces, `stack_lower` and
                    `stack_upper`. It stands on the axis of its own slot and has no side of its
                    own, so the map turns this clip along the shot.
  23_collapse_hall  the turbine hall. Its walls lose the outer half of their footing and pivot
                    outwards on what is left; the roof they carried comes down between them onto
                    the turbine sets. Five pieces: the roof, the two long walls, the two gables.
                    The slot is never turned - every wall falls to its own side.
  30_mushroom_cloud the reactor breach. Not a fall: a fireball, a stem with offset streams beside
                    it, a cap with a rolled rim and lopsided masses on it, a base surge and a dust
                    front running out ahead of it, all keyed from curves above the containment's
                    broken lower half. Nothing in the cloud collides (every cloud mesh is `_nocol`);
                    the ruin does. The fireball is the one part of it that is dangerous, and only
                    while it is drawn - see FIREBALL_CURVE.

Sixteen pieces in all - four per tower, two for the stack, five for the hall, one for the
reactor - which is exactly what MapDestructibleContract allows a map.

The falls are simulated in Blender's rigid body world through scripts/blender_collapse.py and
baked one keyframe per frame, for the reasons the Eiffel siege generator gives at length: nothing
is pushed, the hit takes a bite out of what the structure stands on, gravity does the rest, and
Bullet is deterministic so host and replica derive the same wreck from the same event.

The cloud is the one hand-keyed clip in the pack, and it is keyed from curves rather than by
eye: the cap climbs with the square root of time, the way a buoyant thermal slows as it rises,
the radii approach their final size exponentially, and the fireball that starts it all is gone
inside the cap after four seconds. glTF cannot fade a material, so the cloud ends held in its
final pose rather than dissolving.

What the cloud has to look like from a cockpit is rising, rolling smoke, and glTF can only move,
scale and turn whole nodes - it cannot simulate anything. So the rolling is built rather than
simulated: every body is a handful of unequal masses instead of one smooth surface, the parts set
out at eight different seconds and approach their sizes on different time constants, and the ones
that turn do so at different rates with the cap's rolled rim turning against the cap itself. What
a player sees is two lumpy silhouettes sliding past each other while both grow - which is as close
to the toroidal circulation of the real thing (Glasstone & Dolan 1977, ch. II) as keyframes get.
The proportions come from the same place: the stem is about a fifth of the cap's width, the cap
grows sideways after it stops climbing, and the ground dust is drawn up by the afterwinds rather
than thrown out as a ring.
"""

import json
import sys
from math import atan2, cos, degrees, exp, hypot, pi, radians, sin, sqrt
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

import generate_eiffel_tower_assets as et  # noqa: E402  (needs the path above)
from blender_collapse import (  # noqa: E402
    REST_FRAMES,
    add_body,
    add_constraint,
    add_plane_lock,
    box_object,
    dismantle,
    hull_object,
    key_constraint_open,
    piece_steps,
    replay_matches,
    rest_pose,
    rigid_world,
    sample_poses,
    tilt_of,
    trim_to_rest,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "reactor_site" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "reactor_site" / "glb"

# The toolkit this pack is built with. scripts/generate_map_assets.py redirects the base module's
# ROOT/SOURCE_DIR/GLB_DIR through this attribute when it is given an --output-dir.
BASE = et
FPS = et.FPS

# --- Materials ------------------------------------------------------------------------------------
# Added to the Eiffel palette rather than replacing it: `build_material` reads one dictionary, and
# the site has no use for a second copy of the grain and occlusion rules that hang off it.
CONCRETE = "Concrete"
CONCRETE_DARK = "ConcreteDark"
CONCRETE_PALE = "ConcretePale"
BLAST_WALL = "BlastWall"
ASPHALT = "Asphalt"
GRASS = et.GRASS
STEEL = et.STEEL
STEEL_DARK = "SteelDark"
GLASS = et.GLASS
WATER = "Water"
WARNING = "Warning"
LAMP = et.LAMP
SCORCHED = "Scorched"
RUBBLE = "Rubble"
CLOUD = "Cloud"
CLOUD_DARK = "CloudDark"
DUST = "Dust"
FIREBALL = "Fireball"

et.MATERIAL_COLORS.update({
    CONCRETE: ((0.56, 0.55, 0.52, 1.0), 0.0, 0.0),
    CONCRETE_DARK: ((0.36, 0.36, 0.35, 1.0), 0.0, 0.0),
    CONCRETE_PALE: ((0.68, 0.67, 0.63, 1.0), 0.0, 0.0),
    BLAST_WALL: ((0.43, 0.42, 0.39, 1.0), 0.0, 0.0),
    ASPHALT: ((0.16, 0.16, 0.17, 1.0), 0.0, 0.0),
    STEEL_DARK: ((0.22, 0.24, 0.27, 1.0), 0.0, 0.7),
    WATER: ((0.08, 0.22, 0.28, 1.0), 0.0, 0.3),
    WARNING: ((0.85, 0.62, 0.08, 1.0), 0.0, 0.1),
    SCORCHED: ((0.11, 0.10, 0.09, 1.0), 0.0, 0.0),
    RUBBLE: ((0.30, 0.28, 0.25, 1.0), 0.0, 0.0),
    # The cloud materials are deliberately dark with no emission except the fireball, and that
    # one stays under 2: brighter than that and the tone mapping of the sky dome tears at the
    # horizon (see the illumination notes on the Notre-Dame fire).
    CLOUD: ((0.46, 0.43, 0.39, 1.0), 0.0, 0.0),
    CLOUD_DARK: ((0.25, 0.23, 0.21, 1.0), 0.0, 0.0),
    DUST: ((0.40, 0.34, 0.26, 1.0), 0.0, 0.0),
    FIREBALL: ((0.55, 0.18, 0.04, 1.0), 1.7, 0.0),
})
et.MATERIAL_GRAIN.update({
    CONCRETE: 0.09,
    CONCRETE_DARK: 0.08,
    CONCRETE_PALE: 0.08,
    BLAST_WALL: 0.11,
    ASPHALT: 0.06,
    RUBBLE: 0.12,
    SCORCHED: 0.05,
    CLOUD: 0.0,
    CLOUD_DARK: 0.0,
    DUST: 0.0,
})

# --- Measurements, all in metres --------------------------------------------------------------------
# The apron the plant stands on, and the grass beyond it. The grass has to reach past the furthest
# piece of a fallen structure; how far that is comes out of the collapse report, and the preset
# sizes the field off the same number.
APRON_HALF = 150.0
GROUND_HALF = 260.0

# The reactor block. A containment cylinder under a shallow dome, flanked by two auxiliary wings
# along Y so the block stays symmetric about its own axis -- the loader recentres every file on its
# bounding box, and the cloud scene has to land on exactly the same centre as the intact block.
CONTAINMENT_RADIUS = 24.0
CONTAINMENT_WALL_TOP = 42.0
DOME_TOP = 66.0
WING_SIZE = (44.0, 28.0, 22.0)
WING_OFFSET_Y = CONTAINMENT_RADIUS + WING_SIZE[1] / 2 + 8.0   # 46: the wing's centre along Y

# The cooling towers: one hyperboloid shell each on a ring of inlet columns. Real towers are half
# as tall again; a hundred metres keeps the field playable and the fall inside a minute.
TOWER_OFFSET_X = 105.0
TOWER_HEIGHT = 100.0
COLUMN_HEIGHT = 9.0
TOWER_SHELL_THICKNESS = 1.2
COLUMN_COUNT = 24
# (height, radius) up the shell: the inlet ring at the columns, the throat at four fifths of the
# height, and the flare at the top.
TOWER_PROFILE = (
    (COLUMN_HEIGHT, 42.0), (20.0, 38.5), (32.0, 34.6), (44.0, 31.2), (56.0, 28.6),
    (68.0, 26.9), (80.0, 26.0), (90.0, 26.4), (TOWER_HEIGHT, 28.5),
)

# The discharge stack east of the turbine hall: slender concrete, ninety metres. Far enough
# from the hall's east gable, the east tower's basin and the annexes that a stack toppling in any
# direction lands on the apron.
STACK_POSITION = (96.0, 66.0)
STACK_HEIGHT = 90.0
STACK_PROFILE = ((0.0, 5.2), (30.0, 4.4), (60.0, 3.8), (STACK_HEIGHT, 3.4))
STACK_WALL = 0.5

# The turbine hall south of the reactor (+Y), long along X. Its own file is modelled about its
# own centre so the collapse scene measures like the intact shell; the site places its floor and
# the machinery inside it at HALL_CENTRE_Y.
HALL_CENTRE_Y = 108.0
HALL_LENGTH = 120.0
HALL_DEPTH = 40.0
HALL_WALL_HEIGHT = 26.0
HALL_WALL_THICKNESS = 1.6
HALL_ROOF_THICKNESS = 2.0
HALL_DOOR = (16.0, 12.0)            # the opening in each gable: width, height
# What a wall of the collapsing hall still stands on. The blast takes the outer half of each
# wall's footing, so the wall pivots on its inner edge and goes over outwards on a lever a few
# tenths of a metre long: it stands for some seconds before it goes, the delay a real collapse
# has. The crowns are spalled as well, which keeps the hulls honest about what the roof can rest
# on (nothing, see hall_pieces).
HALL_FOOTING_STRIP = 0.5
HALL_FOOTING_BAND = 3.0
HALL_CROWN_STRIP = 0.4
HALL_CROWN_BAND = 2.0

# --- Cloud measurements ---------------------------------------------------------------------------
CLOUD_SECONDS = 48.0            # the keyed part of the clip
CLOUD_HOLD_SECONDS = 1.0        # held at the end, so a clip never ends on a moving frame
CLOUD_CAP_TOP = 300.0           # where the cap has climbed to by the end, in metres
CLOUD_CAP_BIRTH_RADIUS = 52.0   # just inside the fireball at CAP_START_SECONDS, so the cap grows
                                # out of it rather than appearing beside it
CLOUD_CAP_RADIUS = 115.0
CLOUD_RIM_RATIO = 0.94          # the rolled rim sits just inside the cap's own radius
CLOUD_BLOOM_RATIO = 0.72        # the late, lopsided masses reach this much of the cap
CLOUD_STEM_RADIUS = 24.0        # a fifth of the cap: the proportion Glasstone reports
CLOUD_PLUME_RADIUS = 34.0       # the offset streams stand wider than the stem they flank
CLOUD_RING_RADIUS = 168.0
CLOUD_FRONT_RADIUS = 204.0      # the dust front runs out just past the surge and breaks its edge
# Where the offset streams end: short of the cap's underside, which only the stem reaches.
PLUME_TOP = 0.86 * (CLOUD_CAP_TOP - 0.80 * CLOUD_CAP_RADIUS)
FIREBALL_PEAK_SECONDS = 1.4     # the fireball is fully grown here...
FIREBALL_GONE_SECONDS = 4.4     # ...and has shrunk to nothing inside the cap here
CAP_START_SECONDS = 0.9         # the cap takes over from the fireball
CAP_RISE_SECONDS = 40.0         # the cap has reached CLOUD_CAP_TOP by here
RIM_START_SECONDS = 1.2         # the toroid rolls out of the cap shortly after it forms
BLOOM_START_SECONDS = 2.6       # the lopsided masses boil up last, so the cap keeps changing
PLUME_START_SECONDS = 0.5       # the afterwinds set out before the stem is drawn
RING_START_SECONDS = 0.3        # the base surge sets out
FRONT_START_SECONDS = 0.6       # the dust front follows it
RUIN_SLUMP_START = 0.2
RUIN_SLUMP_END = 2.6
RUIN_SLUMP_SCALE = 0.62         # the containment's broken half settles to this height
TINY_SCALE = 0.001              # a part that is not there yet; zero would make its matrix singular

# How fast each turning part of the cloud comes round, in full turns over CLOUD_SECONDS. The cap
# and its rim turn against each other, which is what makes the rolled edge read as rolling rather
# than as a ring that merely grows; the dust keeps its own, slower pace.
CLOUD_TURNS = {"cap": 0.22, "rim": -0.55, "bloom": 0.34, "plume": -0.40, "front": 0.16}

# Shared authored samples (seconds, height, radius), consumed by Blender and the map preset.
FIREBALL_CURVE_PATH = Path(__file__).resolve().parents[1] / (
    "src/core/config/maps/presets/reactor_site/ReactorFireballCurve.json")
FIREBALL_CURVE = tuple(tuple(row) for row in json.loads(FIREBALL_CURVE_PATH.read_text(encoding="utf-8")))
FIREBALL_RADIUS = max(radius for _t, _height, radius in FIREBALL_CURVE)


def fireball_at(t):
    """(centre height, radius) in metres at `t` seconds, linearly between the authored rows.

    Before the first row and after the last there is no fireball: the breach has not happened, or
    the cap has closed over it. The runtime samples the same authored data.
    """
    if t <= FIREBALL_CURVE[0][0]:
        return FIREBALL_CURVE[0][1], FIREBALL_CURVE[0][2]
    if t >= FIREBALL_CURVE[-1][0]:
        return FIREBALL_CURVE[-1][1], 0.0
    for (low_t, low_h, low_r), (high_t, high_h, high_r) in zip(FIREBALL_CURVE, FIREBALL_CURVE[1:]):
        if t <= high_t:
            span = high_t - low_t
            ratio = 0.0 if span <= 0.0 else (t - low_t) / span
            return low_h + (high_h - low_h) * ratio, low_r + (high_r - low_r) * ratio
    return FIREBALL_CURVE[-1][1], 0.0

# --- Collapse physics -------------------------------------------------------------------------------
SIM_MAX_SECONDS = 40.0
CONCRETE_TONNES_PER_M3 = 2.4
COLUMN_TONNES = 14.0              # one inlet column with its footing
MASS_SLICE = 0.5

# Where a toppling chimney breaks, and when. Demolition footage puts the shear between twenty and
# forty degrees of lean, about a third of the way up, where the bending moment of the part above
# peaks against a section that has already thinned. The Eiffel siege derives the moment from the
# measured turn and compares it with a joint capacity; for a single slender tube the empirical
# angle is the stronger statement, and it is what is authored here. The joint is never called
# broken inside the first two seconds, while the solver is still settling the load.
STACK_SHEAR_TILT = radians(22.0)
JOINT_SETTLE_FRAMES = 60

# The stack: how much of the struck side is pulverised from the ground up, how far past the axis
# that cut reaches along the fall, the shear face at the joint, and where the joint is. A
# toppling chimney breaks about a third of the way up.
STACK_CRUSH_BAND = 6.0
STACK_SEAT_CUT = 1.5
STACK_SEAT_BAND = 4.0
STACK_JOINT = 34.0
PROXY_BAND = 4.0

# The tower. A cooling tower is as wide as it is tall, and shot at its base it neither topples
# whole - it sags fourteen degrees onto its crushed side and stops - nor folds into itself as four
# rigid sectors, whose seams jam against each other half a degree in. What a demolition of one
# actually shows is the struck flank giving way and the rest of the shell going over it. So the
# hit tears the near flank of the lower shell out: everything below TOWER_FLANK_TOP within
# TOWER_FLANK_CUT metres of the axis along the fall, and beyond it, is `debris`, a piece that is
# not simulated but keyed to crumble to the ground. What stands is the rest, `shell`: the far
# flank of the lower shell with the whole upper shell on it, whose common centre of mass now
# stands past the edge of the flank. It goes over the flank and keels onto its side.
#
# It does not shear on the way. Shearing was tried, at the same lean the stack breaks at: a
# fifty-metre ring as wide as it is tall does not topple once it is on its own, it drops onto
# its torn foot and stands there leaning, which is the one pose a collapse may never end in. So
# the shell stays one body - simulated as a compound of two hulls, the flank and the ring, so
# the hollow between them is real and the body cannot come to rest on a face it does not have.
TOWER_FLANK_TOP = 46.0             # the torn flank reaches this high
TOWER_FLANK_CUT = 12.0             # the flank is gone from here along the fall, past the axis
TOWER_FLANK_SPLIT = radians(110.0) # where the drawn shell is split into flank and far side
DEBRIS_CRUMBLE_SECONDS = 2.5       # the torn flank settles into a band of rubble in this time
DEBRIS_CRUMBLE_SCALE = 0.06        # ...this high, as a fraction of its standing height
SECTOR_STEPS = 72                  # hull samples around a ring, five degrees apart

# The fall is along +X. The map turns each scene's slot onto the heading the event decides - for
# the towers and the stack. The hall's slot is never turned; its pieces fall to their own sides.
FALL_YAW = 0.0
# Hull samples along one metre of a box edge, for the hall's slabs.
BOX_SAMPLE_METRES = 0.4


# --- Geometry helpers -----------------------------------------------------------------------------


class SmoothCanvas(et.Canvas):
    """The Eiffel canvas plus per-face smooth shading.

    A lattice is all edges and reads right faceted; a hyperboloid or a cloud does not. Faces added
    through `revolve` carry a smooth flag that `emit` writes onto the polygons, so the exporter
    averages the normals across the shell instead of showing every one of its sixty facets.
    """

    def _bucket(self, material, decorative):
        return self.buckets.setdefault((material, decorative), ([], [], [], []))

    def _add(self, material, decorative, verts, faces, matrix, smooth=False):
        bucket_verts, bucket_faces, bucket_colors, bucket_smooth = self._bucket(material, decorative)
        placed = [matrix @ Vector(vertex) for vertex in verts]
        if not placed:
            return
        offset = len(bucket_verts)
        center = sum(placed, Vector((0.0, 0.0, 0.0))) / len(placed)
        span = max(
            max(vertex[axis] for vertex in placed) - min(vertex[axis] for vertex in placed)
            for axis in range(3)
        )
        tint = et.element_tint(material, center, span)
        for vertex in placed:
            bucket_verts.append(tuple(vertex))
            bucket_colors.append(tint)
        for face in faces:
            bucket_faces.append(tuple(index + offset for index in face))
            bucket_smooth.append(smooth)

    def emit(self, part_name, parent=None):
        created = []
        for (material, decorative), (verts, faces, colors, smooth) in sorted(self.buckets.items()):
            if not faces:
                continue
            name = f"{part_name}_{material.lower()}{'_nocol' if decorative else ''}"
            mesh = bpy.data.meshes.new(f"{name}_mesh")
            mesh.from_pydata(verts, [], faces)
            mesh.validate()
            mesh.update()
            if len(mesh.polygons) == len(smooth):
                mesh.polygons.foreach_set("use_smooth", smooth)
            mesh.materials.append(et.build_material(material))
            et.apply_vertex_colors(mesh, colors)
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.collection.objects.link(obj)
            if parent is not None:
                obj.parent = parent
            created.append(obj)
        return created


# The exporter instantiates the canvas by name out of its own module, so the smooth-capable one
# is put in its place for every part of this pack.
et.Canvas = SmoothCanvas


def revolve(canvas, material, profile, segments=48, center=(0.0, 0.0, 0.0), decorative=False,
            closed=True, smooth=True, angle_range=None):
    """A surface of revolution about the Z axis through `center`, drawn onto a canvas.

    `profile` is a list of (radius, height) points. A closed profile is a polygon walked
    counter-clockwise in the (radius, height) half plane -- up the outside, in across the top,
    down the inside, out across the bottom -- and that direction is what makes every face point
    outwards. An open profile is a curve from the axis and back to it, a dome or a droplet.
    Points on the axis collapse their ring to a single vertex, so the caps close cleanly.

    `angle_range` limits the sweep to (start, end) radians, for the sectors of a shell; a closed
    profile then gets the two radial end faces as well, wound so they point out of the sector.
    """
    verts, faces = revolve_geometry(profile, segments, angle_range, closed)
    canvas._add(material, decorative, verts, faces, Matrix.Translation(Vector(center)), smooth=smooth)


def revolve_geometry(profile, segments, angle_range=None, closed=True):
    """The vertices and faces of `revolve`, for a canvas or for a collision proxy."""
    full = angle_range is None
    start, end = (0.0, 2.0 * pi) if full else angle_range
    columns = segments if full else segments + 1
    verts = []
    ring_index = []
    for radius, height in profile:
        if radius <= 1e-6:
            ring_index.append((len(verts), 1))
            verts.append((0.0, 0.0, height))
            continue
        ring_index.append((len(verts), columns))
        for index in range(columns):
            angle = start + (end - start) * index / segments
            verts.append((radius * cos(angle), radius * sin(angle), height))
    faces = []
    pairs = list(range(len(profile) - 1))
    if closed:
        pairs.append(len(profile) - 1)
    for step in pairs:
        this_start, this_count = ring_index[step]
        next_start, next_count = ring_index[(step + 1) % len(profile)]
        if this_count == 1 and next_count == 1:
            continue
        for index in range(segments):
            following = (index + 1) % segments if full else index + 1
            if this_count == 1:
                faces.append((this_start, next_start + following, next_start + index))
            elif next_count == 1:
                faces.append((this_start + index, this_start + following, next_start))
            else:
                faces.append((this_start + index, this_start + following,
                              next_start + following, next_start + index))
    if closed and not full:
        # The radial end faces: the profile polygon itself, at the first and the last column.
        first = [ring_start for ring_start, count in ring_index if count > 1]
        last = [ring_start + segments for ring_start, count in ring_index if count > 1]
        if len(first) >= 3:
            faces.append(tuple(first))
            faces.append(tuple(reversed(last)))
    return verts, faces


def shell_profile(outer, thickness):
    """A closed profile for a shell: the outer curve up, then the inner curve back down."""
    inner = [(max(0.3, radius - thickness), height) for radius, height in outer]
    return list(outer) + list(reversed(inner))


def shell_sections(canvas, material, radius_of, heights, thickness, joints, segments):
    """A shell drawn as one closed section per stretch between the break lines.

    The intact part and the falling pieces are drawn by the very same call. Cutting the shell at
    the joints here is what lets a piece canvas keep exactly the stretch of wall that stands in its
    own height band: an element belongs to the piece its centre stands in, and a shell drawn whole
    would have gone to one piece entire. The rims the cut adds face each other inside the wall and
    are never seen while the structure stands.
    """
    bounds = [heights[0]] + sorted(joint for joint in joints if heights[0] < joint < heights[-1])
    bounds.append(heights[-1])
    for low, high in zip(bounds, bounds[1:]):
        rings = [(low, radius_of(low))]
        rings.extend((height, radius_of(height)) for height in heights if low < height < high)
        rings.append((high, radius_of(high)))
        revolve(canvas, material, shell_profile([(radius, height) for height, radius in rings],
                                                thickness), segments=segments)


def spheroid_profile(radius, above, below, steps=10):
    """An open profile of a squashed sphere: `above` and `below` are the vertical semi-axes."""
    profile = [(0.0, -below)]
    for step in range(1, steps):
        angle = -pi / 2 + pi * step / steps
        height = (above if angle > 0 else below) * sin(angle)
        profile.append((radius * cos(angle), height))
    profile.append((0.0, above))
    return profile


def torus(canvas, material, center, major, minor, segments=48, rings=12, decorative=False,
          smooth=True):
    """A ring lying flat: the base surge of the cloud."""
    verts = []
    for ring in range(rings):
        theta = 2.0 * pi * ring / rings
        radius = major + minor * cos(theta)
        height = minor * sin(theta)
        for index in range(segments):
            angle = 2.0 * pi * index / segments
            verts.append((radius * cos(angle), radius * sin(angle), height))
    faces = []
    for ring in range(rings):
        next_ring = (ring + 1) % rings
        for index in range(segments):
            following = (index + 1) % segments
            faces.append((ring * segments + index, ring * segments + following,
                          next_ring * segments + following, next_ring * segments + index))
    canvas._add(material, decorative, verts, faces, Matrix.Translation(Vector(center)), smooth=smooth)


def interpolate(table, height):
    return et.interpolate(table, height)


def tower_radius(height):
    return interpolate(TOWER_PROFILE, height)


def stack_radius(height):
    return interpolate(STACK_PROFILE, height)


def angle_inside(angle, angle_range):
    """Whether an angle lies in a range, both folded to the same turn."""
    start, end = angle_range
    turn = (angle - start) % (2.0 * pi)
    return turn <= (end - start) + 1e-9


# --- Static parts ------------------------------------------------------------------------------------


def wall_segment(canvas, start, end, height, thickness=1.4, material=BLAST_WALL,
                 warning_cap=True):
    """One ground wall between two plan points, with collision and a readable hazard cap."""
    delta_x = end[0] - start[0]
    delta_y = end[1] - start[1]
    length = hypot(delta_x, delta_y)
    if length < 0.1:
        return
    centre = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    angle = atan2(delta_y, delta_x)
    canvas.box(material, (centre[0], centre[1], height / 2),
               (length, thickness, height), rotation=(0, 0, angle))
    if warning_cap:
        canvas.box(WARNING, (centre[0], centre[1], height + 0.16),
                   (max(0.6, length - 0.5), thickness + 0.08, 0.32),
                   rotation=(0, 0, angle), decorative=True)


def build_security_compounds(canvas):
    """Irregular static walls that divide the plant into readable, flyable compounds.

    None of these walls belongs to a destructible building. The four inner runs sit between the
    containment wings and cooling basins, the switchyard enclosure follows the permanent slab,
    and the low checkpoint baffles leave offset openings rather than closing a route outright.
    """
    inner_runs = (
        ((-58, -38), (-49, -49), (-35, -54), (-27, -44)),
        ((27, -44), (36, -55), (51, -50), (58, -37)),
        ((-58, 35), (-51, 48), (-36, 57), (-27, 48)),
        ((27, 48), (38, 58), (52, 51), (58, 36)),
    )
    for run_index, points in enumerate(inner_runs):
        for segment_index in range(len(points) - 1):
            height = 6.0 + 2.4 * et.hash01(run_index, segment_index, 13.0)
            thickness = 1.35 + 0.35 * et.hash01(segment_index, run_index, 5.0)
            wall_segment(canvas, points[segment_index], points[segment_index + 1], height, thickness)
        # Uneven end buttresses make the runs read as installed blast walls, not arena polygons.
        for end_index in (0, -1):
            x, y = points[end_index]
            height = 3.8 + 1.6 * et.hash01(run_index, end_index, 19.0)
            canvas.box(BLAST_WALL, (x, y, height / 2), (3.0, 3.0, height),
                       rotation=(0, 0, run_index * 0.31))

    # A crooked three-sided switchyard perimeter. The gaps at the centre and both northern
    # corners preserve the authored slingshot approaches.
    switchyard_runs = (
        ((-66, -137), (-73, -123), (-67, -108), (-75, -92)),
        ((66, -137), (75, -121), (68, -105), (77, -91)),
        ((-59, -86), (-39, -90), (-19, -86)),
        ((17, -87), (39, -91), (59, -84)),
    )
    for run_index, points in enumerate(switchyard_runs):
        for segment_index in range(len(points) - 1):
            height = 4.8 + 2.0 * et.hash01(run_index, segment_index, 31.0)
            wall_segment(canvas, points[segment_index], points[segment_index + 1], height,
                         1.25 + 0.25 * (segment_index % 2))

    # Low, staggered entry baffles at the outer north and south service approaches. A ship can
    # weave through the offsets or simply clear the three-metre walls.
    checkpoint_segments = (
        ((-72, 138), (-49, 143)), ((-42, 145), (-20, 139)),
        ((18, 140), (39, 146)), ((46, 142), (71, 136)),
        ((-70, -145), (-47, -140)), ((-39, -138), (-18, -144)),
        ((20, -144), (42, -138)), ((49, -141), (71, -146)),
    )
    for index, (start, end) in enumerate(checkpoint_segments):
        wall_segment(canvas, start, end, 2.6 + 0.8 * et.hash01(index, 41.0, 2.0),
                     1.7, warning_cap=index % 2 == 0)


def build_site(canvas):
    """The apron, roads, irregular compounds, switchyard, basins and permanent machinery."""
    canvas.box(GRASS, (0, 0, -0.9), (GROUND_HALF * 2, GROUND_HALF * 2, 1.4))
    canvas.box(CONCRETE_PALE, (0, 0, -0.2), (APRON_HALF * 2, APRON_HALF * 2, 0.4))
    # The ring road around the apron and the two access roads out to the fence.
    for sign in (-1, 1):
        canvas.box(ASPHALT, (0, sign * (APRON_HALF + 8), 0.02), (APRON_HALF * 2 + 32, 12, 0.3))
        canvas.box(ASPHALT, (sign * (APRON_HALF + 8), 0, 0.02), (12, APRON_HALF * 2 + 32, 0.3))
        canvas.box(ASPHALT, (sign * (GROUND_HALF - 45), 0, 0.02), (90, 12, 0.3))
    canvas.box(ASPHALT, (0, GROUND_HALF - 45, 0.02), (12, 90, 0.3))
    build_security_compounds(canvas)
    # The perimeter fence: posts that collide, mesh panels that do not.
    fence = APRON_HALF + 20
    for index in range(-17, 18):
        along = index * 10
        for sign in (-1, 1):
            canvas.box(STEEL_DARK, (along, sign * fence, 1.6), (0.3, 0.3, 3.2))
            canvas.box(STEEL_DARK, (sign * fence, along, 1.6), (0.3, 0.3, 3.2))
    for sign in (-1, 1):
        canvas.box(STEEL, (0, sign * fence, 1.8), (fence * 2, 0.08, 2.4), decorative=True)
        canvas.box(STEEL, (sign * fence, 0, 1.8), (0.08, fence * 2, 2.4), decorative=True)
    # The switchyard north of the reactor: transformer bays and a row of lattice pylons.
    yard_y = -112.0   # north is -Y
    canvas.box(CONCRETE_DARK, (0, yard_y, 0.3), (110, 44, 0.6))
    for index in range(-2, 3):
        x = index * 22
        canvas.box(STEEL_DARK, (x, yard_y - 8, 3.2), (7, 5, 6.0))
        canvas.box(WARNING, (x, yard_y - 8, 6.6), (5, 3.4, 0.8))
        for dy in (-3, 0, 3):
            canvas.frustum(CONCRETE_PALE, (x + 2.5 * dy / 3, yard_y - 5 + dy, 8.5), 0.5, 0.35, 3.0,
                           sides=8, decorative=True)
        # A pylon: four legs, a crossarm, insulator strings.
        for sx in (-1, 1):
            for sy in (-1, 1):
                canvas.beam(STEEL_DARK, (x + sx * 3.0, yard_y + 10 + sy * 3.0, 0),
                            (x + sx * 1.2, yard_y + 10 + sy * 1.2, 24.0), 0.45)
        canvas.box(STEEL_DARK, (x, yard_y + 10, 20.0), (18, 1.2, 1.2))
        canvas.box(STEEL_DARK, (x, yard_y + 10, 24.0), (2.8, 2.8, 0.6))
        for sx in (-1, 1):
            canvas.box(GLASS, (x + sx * 7.5, yard_y + 10, 17.6), (0.6, 0.6, 3.6), decorative=True)
    # Overhead lines between the pylons.
    for sx in (-1, 1):
        canvas.box(STEEL_DARK, (0, yard_y + 10 + sx * 0.5, 16.0), (88, 0.12, 0.12), decorative=True)
    # The basin of each cooling tower stands on the site rather than in the tower's own file: a
    # tower that comes down leaves its basin, its water and the fill packs behind on the ground.
    for sign in (-1, 1):
        centre = (sign * TOWER_OFFSET_X, 0.0, 0.0)
        base_radius = tower_radius(COLUMN_HEIGHT)
        revolve(canvas, CONCRETE_DARK, shell_profile([(base_radius + 2.0, 0.0), (base_radius + 2.0, 1.4)],
                                                     1.6), segments=60, center=centre)
        revolve(canvas, WATER, [(0.0, 0.0), (base_radius - 0.5, 0.0), (base_radius - 0.5, 0.6),
                                (0.0, 0.6)], segments=60, center=centre, decorative=True)
        for index in range(8):
            angle = 2.0 * pi * index / 8
            canvas.box(STEEL_DARK, (centre[0] + 22.0 * cos(angle), 22.0 * sin(angle), 6.0),
                       (11.0, 5.0, 3.0), rotation=(0, 0, angle))
    # Lamp masts on the apron corners and along the ring road.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for offset in ((0.0, 0.0), (60.0, 0.0), (0.0, 60.0)):
                x = sx * (APRON_HALF - 6 - offset[0])
                y = sy * (APRON_HALF - 6 - offset[1])
                canvas.box(STEEL_DARK, (x, y, 7.0), (0.7, 0.7, 14.0))
                canvas.box(LAMP, (x, y, 14.3), (2.6, 0.9, 0.6), decorative=True)
    # A stand of trees along the two long edges of the grass, for scale.
    edge = GROUND_HALF - 22
    for index in range(-9, 10):
        along = index * 24
        for sign in (-1, 1):
            canvas.frustum(GRASS, (along, sign * edge, 6.5), 5.0, 2.6, 13.0, sides=6)
    build_hall_surroundings(canvas)


def build_hall_surroundings(canvas):
    """What the turbine hall's collapse leaves behind: its floor and machinery, the annexes,
    the steam lines to the containment and the transformers. All of it stands on the site, so
    it is still there when the hall's shell has come down around it."""
    y = HALL_CENTRE_Y
    canvas.box(CONCRETE_DARK, (0, y, 0.15), (HALL_LENGTH + 2.0, HALL_DEPTH + 2.0, 0.3))
    # Three turbine-generator sets down the hall: a pedestal, the turbine casings, the generator.
    for index in range(-1, 2):
        x = index * 36.0
        canvas.box(CONCRETE_PALE, (x, y, 2.0), (26.0, 9.0, 4.0))
        canvas.frustum(STEEL, (x - 7.0, y, 6.4), 2.6, 2.6, 8.0, sides=14, rotation=(0, pi / 2, 0))
        canvas.frustum(STEEL_DARK, (x + 5.0, y, 6.2), 2.2, 2.2, 10.0, sides=14, rotation=(0, pi / 2, 0))
        canvas.box(WARNING, (x + 11.5, y, 5.0), (2.0, 3.0, 2.0))
        canvas.box(STEEL_DARK, (x, y - 6.5, 1.2), (20.0, 1.0, 2.4))
    # Two annexes beyond the reach of the falling gables: the switchgear house and the workshop.
    canvas.box(CONCRETE_DARK, (-HALL_LENGTH / 2 - 52, y, 6.0), (28, 26, 12.0))
    canvas.box(CONCRETE_DARK, (HALL_LENGTH / 2 + 50, y + 4, 4.5), (24, 22, 9.0))
    # Steam lines from the containment to the hall, on trestles.
    for index, x in enumerate((-10.0, 0.0, 10.0)):
        start_y = CONTAINMENT_RADIUS + 2
        end_y = y - HALL_DEPTH / 2 - HALL_WALL_THICKNESS
        canvas.beam(STEEL, (x, start_y, 9.5 + index * 0.4), (x, end_y, 9.5 + index * 0.4), 1.6)
    for step in range(5):
        y_step = CONTAINMENT_RADIUS + 8 + step * 12
        for x in (-13.0, 13.0):
            canvas.box(STEEL_DARK, (x, y_step, 4.5), (0.6, 0.6, 9.0))
        canvas.box(STEEL_DARK, (0, y_step, 8.6), (28, 0.8, 0.6))
    # Transformers between the hall and the east tower, wired towards the switchyard.
    for index in range(3):
        canvas.box(STEEL_DARK, (-40 + index * 14, 62.0, 3.0), (6, 5, 6.0))
        canvas.box(WARNING, (-40 + index * 14, 62.0, 6.5), (4, 3, 1.0))


def build_turbine_hall(canvas):
    """The shell of the turbine hall about its own centre: walls, gables with their doors, roof.

    The doors are the way through the hall - sixteen metres wide, twelve high, one at each end -
    and the strip windows under the eaves are decor. Every element is a box, so the pieces the
    hall breaks into are exactly what is drawn: a wall is a slab and its hull is the same slab.
    """
    half_x = HALL_LENGTH / 2
    half_y = HALL_DEPTH / 2
    t = HALL_WALL_THICKNESS
    h = HALL_WALL_HEIGHT
    door_w, door_h = HALL_DOOR
    # The two long walls, between the gables.
    for sign in (-1, 1):
        canvas.box(CONCRETE, (0, sign * (half_y - t / 2), h / 2), (HALL_LENGTH - 2 * t, t, h))
        canvas.box(GLASS, (0, sign * (half_y + 0.1), h - 4.0), (HALL_LENGTH - 8, 0.2, 3.0),
                   decorative=True)
        canvas.box(CONCRETE_DARK, (0, sign * (half_y + 0.3), h - 1.5), (HALL_LENGTH - 2 * t, 0.6, 1.2))
    # The gables: two panels beside the door and the lintel over it.
    for sign in (-1, 1):
        x = sign * (half_x - t / 2)
        panel = (half_y * 2 - door_w) / 2
        for side in (-1, 1):
            canvas.box(CONCRETE, (x, side * (door_w / 2 + panel / 2), h / 2), (t, panel, h))
        canvas.box(CONCRETE, (x, 0, (h + door_h) / 2), (t, door_w, h - door_h))
        canvas.box(WARNING, (x + sign * 0.2, 0, door_h + 0.4), (0.4, door_w + 1.0, 0.8),
                   decorative=True)
    # The roof: a slab on the walls, with a raised ventilation ridge down its middle.
    canvas.box(CONCRETE_DARK, (0, 0, h + HALL_ROOF_THICKNESS / 2),
               (HALL_LENGTH, HALL_DEPTH, HALL_ROOF_THICKNESS))
    canvas.box(CONCRETE, (0, 0, h + HALL_ROOF_THICKNESS + 1.0), (HALL_LENGTH - 10, 8.0, 2.0))
    for index in range(-4, 5):
        canvas.box(STEEL_DARK, (index * 12.0, 0, h + HALL_ROOF_THICKNESS + 3.0), (2.6, 2.6, 2.0))


def build_reactor_block(canvas):
    """The containment under its dome, and the two auxiliary wings that flank it."""
    dome = [
        (CONTAINMENT_RADIUS, 0.0), (CONTAINMENT_RADIUS, CONTAINMENT_WALL_TOP),
        (CONTAINMENT_RADIUS - 1.0, CONTAINMENT_WALL_TOP + 5.0), (20.5, 53.0), (16.0, 59.0),
        (10.0, 63.5), (4.0, 65.6), (0.0, DOME_TOP),
    ]
    revolve(canvas, CONCRETE, [(0.0, 0.0)] + dome, segments=56, closed=False)
    # The ring beam where the dome meets the wall, and the vent penetration on top.
    revolve(canvas, CONCRETE_DARK, shell_profile(
        [(CONTAINMENT_RADIUS + 1.2, CONTAINMENT_WALL_TOP - 2.0),
         (CONTAINMENT_RADIUS + 1.2, CONTAINMENT_WALL_TOP + 1.0)], 1.2), segments=56)
    canvas.frustum(STEEL_DARK, (0, 0, DOME_TOP + 1.2), 2.4, 2.0, 2.4, sides=12)
    # The equipment hatch and the personnel airlock on the containment wall.
    canvas.box(STEEL_DARK, (CONTAINMENT_RADIUS - 0.3, 0, 12.0), (2.4, 8.0, 8.0))
    canvas.box(WARNING, (CONTAINMENT_RADIUS + 0.9, 0, 12.0), (0.4, 6.0, 6.0), decorative=True)
    for sign in (-1, 1):
        wing_y = sign * WING_OFFSET_Y
        wx, wy, wz = WING_SIZE
        canvas.box(CONCRETE, (0, wing_y, wz / 2), (wx, wy, wz))
        canvas.box(CONCRETE_DARK, (0, wing_y, wz + 0.6), (wx + 1.0, wy + 1.0, 1.2))
        # The link between the wing and the containment, and rooftop ventilation.
        canvas.box(CONCRETE_DARK, (0, sign * (CONTAINMENT_RADIUS + 4.0), 6.0), (16.0, 10.0, 12.0))
        for index in range(-1, 2):
            canvas.box(STEEL_DARK, (index * 12.0, wing_y, wz + 2.6), (4.0, 3.0, 2.8))
        canvas.box(GLASS, (0, wing_y + sign * (wy / 2 + 0.1), 10.0), (wx - 6, 0.2, 2.4),
                   decorative=True)
    # A gantry crane rail down the length of the block, over the wings.
    for x in (-18.0, 18.0):
        canvas.beam(STEEL, (x, -WING_OFFSET_Y - 10, WING_SIZE[2] + 6),
                    (x, WING_OFFSET_Y + 10, WING_SIZE[2] + 6), 0.9)


def flank_ranges():
    """The two angular ranges of the lower shell: the far side that stays, and the near flank."""
    far = (TOWER_FLANK_SPLIT, 2.0 * pi - TOWER_FLANK_SPLIT)
    near = (-TOWER_FLANK_SPLIT, TOWER_FLANK_SPLIT)
    return far, near


def build_cooling_tower(canvas):
    """One hyperboloid shell on its ring of inlet columns.

    The gap under the shell is the way into the tower, and the open top is the way out again:
    a cooling tower on this map is a chimney a ship can fly through. The shell is drawn in the
    three parts it comes down in - the lower shell's far side, its near flank, and the upper shell
    - even while it stands; the seams meet inside the wall and are not seen.
    """
    heights = [height for height, _radius in TOWER_PROFILE]
    lower = [(tower_radius(height), height) for height in heights if height < TOWER_FLANK_TOP]
    lower.append((tower_radius(TOWER_FLANK_TOP), TOWER_FLANK_TOP))
    upper = [(tower_radius(TOWER_FLANK_TOP), TOWER_FLANK_TOP)]
    upper.extend((tower_radius(height), height) for height in heights if height > TOWER_FLANK_TOP)
    for angle_range in flank_ranges():
        revolve(canvas, CONCRETE, shell_profile(lower, TOWER_SHELL_THICKNESS), segments=30,
                angle_range=angle_range)
        # The hot-water distribution ring above the fill, in the same two arcs.
        revolve(canvas, STEEL_DARK, shell_profile([(30.0, 10.5), (30.0, 11.5)], 1.0), segments=24,
                angle_range=angle_range)
    revolve(canvas, CONCRETE, shell_profile(upper, TOWER_SHELL_THICKNESS), segments=60)
    base_radius = tower_radius(COLUMN_HEIGHT)
    for index in range(COLUMN_COUNT):
        angle = 2.0 * pi * (index + 0.5) / COLUMN_COUNT
        following = 2.0 * pi * (index + 1.0) / COLUMN_COUNT
        # V-columns: each pair meets under the shell.
        foot = (base_radius * cos(angle), base_radius * sin(angle), 0.0)
        head = ((base_radius - 0.6) * cos(following), (base_radius - 0.6) * sin(following),
                COLUMN_HEIGHT)
        head_back = ((base_radius - 0.6) * cos(angle - pi / COLUMN_COUNT),
                     (base_radius - 0.6) * sin(angle - pi / COLUMN_COUNT), COLUMN_HEIGHT)
        canvas.beam(CONCRETE_DARK, foot, head, 1.4)
        canvas.beam(CONCRETE_DARK, foot, head_back, 1.4)
    # Aviation lights on the rim.
    for index in range(4):
        angle = 2.0 * pi * index / 4
        radius = tower_radius(TOWER_HEIGHT) - 0.6
        canvas.frustum(WARNING, (radius * cos(angle), radius * sin(angle), TOWER_HEIGHT + 0.8),
                       0.5, 0.5, 1.6, sides=6, decorative=True)


def build_vent_stack(canvas):
    """The discharge chimney: a tapering concrete tube with its ladder cage and bands."""
    shell_sections(canvas, CONCRETE_PALE, stack_radius, [height for height, _radius in STACK_PROFILE],
                   STACK_WALL, (STACK_JOINT,), segments=32)
    for height in (30.0, 60.0):
        radius = stack_radius(height) + 0.35
        revolve(canvas, WARNING, shell_profile([(radius, height - 1.5), (radius, height + 1.5)], 0.35),
                segments=32)
    # The ladder up the north face, and the platform under the crown.
    for step in range(0, int(STACK_HEIGHT) - 4, 3):
        radius = stack_radius(step) + 0.7
        canvas.box(STEEL, (0, -radius, step + 1.5), (0.9, 0.25, 0.08), decorative=True)
    crown = stack_radius(STACK_HEIGHT - 6)
    revolve(canvas, STEEL_DARK, shell_profile([(crown + 1.6, STACK_HEIGHT - 6.0),
                                               (crown + 1.6, STACK_HEIGHT - 5.4)], 2.2), segments=32)
    canvas.frustum(WARNING, (0, 0, STACK_HEIGHT + 0.8), 0.5, 0.5, 1.6, sides=6, decorative=True)


ARCHITECTURE = (
    ("01_site", build_site),
    ("02_turbine_hall", build_turbine_hall),
    ("03_reactor_block", build_reactor_block),
    ("04_cooling_tower", build_cooling_tower),
    ("05_vent_stack", build_vent_stack),
)


# --- Mass models -------------------------------------------------------------------------------------


def shell_mass_slices(radius_of, low, high, thickness, fraction=1.0):
    """A thin shell between two heights as (height, tonnes) samples; `fraction` of its ring."""
    steps = max(1, int(round((high - low) / MASS_SLICE)))
    step = (high - low) / steps
    slices = []
    for index in range(steps):
        height = low + step * (index + 0.5)
        slices.append((height, 2.0 * pi * radius_of(height) * thickness * step
                       * CONCRETE_TONNES_PER_M3 * fraction))
    return slices


def total_mass(slices):
    return sum(tonnes for _height, tonnes in slices)


def centre_of_mass(slices):
    mass = total_mass(slices)
    return sum(height * tonnes for height, tonnes in slices) / mass if mass else 0.0


# --- Pieces and structures ----------------------------------------------------------------------------


class PieceSpec:
    """One rigid piece of a structure: where it stands, what it owns, and what the hit left it.

    `cuts` are (low, high, keep) triples: between the two heights above the piece's foot, only
    proxy samples the `keep` predicate accepts survive, so the proxy has no support where the hit
    took it away. `fall_yaw` is the direction the piece is allowed to travel in. `contains`
    decides which drawn elements belong to the piece, by their centre in the structure's frame.

    `origin` is the piece's centre of mass in the structure's frame, and it is where the rig
    empty stands and the proxy has its object origin. Blender's rigid body world takes the
    object origin for the centre of mass - it does not recentre - so a proxy with its origin at
    the foot would be simulated as a body whose whole weight sits on the ground. Every proxy and
    every drawn vertex of a piece is therefore expressed relative to this point.
    """

    def __init__(self, suffix, foot, head, origin, cuts=(), fall_yaw=FALL_YAW, mass=0.0,
                 contains=None):
        self.suffix = suffix
        self.foot = foot
        self.head = head
        self.origin = Vector(origin)
        self.cuts = tuple(cuts)
        self.fall_yaw = fall_yaw
        self.mass = mass
        self._contains = contains

    def contains(self, centre):
        if self._contains is not None:
            return self._contains(centre)
        return self.foot <= centre.z < self.head

    def keeps_at(self, level):
        return [keep for low, high, keep in self.cuts if low <= level <= high]

    def relative(self, point):
        return (point[0] - self.origin.x, point[1] - self.origin.y, point[2] - self.origin.z)

    def proxy_object(self, name):
        """The collision proxy, with its origin at the piece's centre of mass.

        Returns (object, shape, children): the children are the parts of a compound shape and
        get rigid bodies of their own but are never simulated on their own.
        """
        raise NotImplementedError


class ShellPiece(PieceSpec):
    """A height band of a body of revolution - a convex hull, like the tower's pieces."""

    def __init__(self, suffix, radius_of, foot, head, origin, open_top=False, **kw):
        super().__init__(suffix, foot, head, origin, **kw)
        self.radius_of = radius_of
        self.open_top = open_top

    def contains(self, centre):
        if self._contains is not None:
            return self._contains(centre)
        return centre.z >= self.foot and (self.open_top or centre.z < self.head)

    def proxy_object(self, name):
        points = []
        height = self.foot
        while height < self.head - 1e-6:
            top = min(self.head, height + PROXY_BAND)
            radius = max(self.radius_of(height), self.radius_of(top))
            for level in (height, top):
                keeps = self.keeps_at(level - self.foot)
                for index in range(SECTOR_STEPS):
                    angle = 2.0 * pi * index / SECTOR_STEPS
                    x, y = radius * cos(angle), radius * sin(angle)
                    if all(keep(x, y) for keep in keeps):
                        points.append(self.relative((x, y, level)))
            height = top
        return hull_object(name, points, location=self.origin), "CONVEX_HULL", []


class CompoundShellPiece(PieceSpec):
    """Several height bands of a body of revolution as one rigid body: a compound of hulls.

    One hull over all of them would fill the hollow between a torn lower flank and the ring
    above it with a slanted face, and the body would come to rest on that face half way over.
    """

    def __init__(self, suffix, radius_of, bands, origin, **kw):
        # bands: (foot, head, cuts) per hull, cuts in the band's own frame.
        super().__init__(suffix, bands[0][0], bands[-1][1], origin, **kw)
        self.radius_of = radius_of
        self.bands = tuple(bands)

    def proxy_object(self, name):
        parent = hull_object(name, [(dx, dy, dz) for dx, dy, dz in
                                    ((0.1, 0, 0), (0, 0.1, 0), (0, 0, 0.1), (-0.1, -0.1, -0.1))],
                             location=self.origin)
        children = []
        for index, (foot, head, cuts) in enumerate(self.bands):
            points = []
            height = foot
            while height < head - 1e-6:
                top = min(head, height + PROXY_BAND)
                radius = max(self.radius_of(height), self.radius_of(top))
                for level in (height, top):
                    keeps = [keep for low, high, keep in cuts if low <= level - foot <= high]
                    for step in range(SECTOR_STEPS):
                        angle = 2.0 * pi * step / SECTOR_STEPS
                        x, y = radius * cos(angle), radius * sin(angle)
                        if all(keep(x, y) for keep in keeps):
                            points.append(self.relative((x, y, level)))
                height = top
            child = hull_object(f"{name}_band{index}", points, location=(0.0, 0.0, 0.0))
            child.parent = parent
            children.append(child)
        return parent, "COMPOUND", children


class KeyedPiece:
    """A piece that is not simulated but keyed from a curve: the torn flank crumbling."""

    def __init__(self, suffix, origin, contains, pose):
        self.suffix = suffix
        self.origin = Vector(origin)
        self.contains = contains
        self.pose = pose


class BoxPiece(PieceSpec):
    """A slab: a wall, a gable, a roof. Its hull is the box itself, minus the cuts."""

    def __init__(self, suffix, centre_xy, size_xy, foot, head, **kw):
        cx, cy = centre_xy
        super().__init__(suffix, foot, head, (cx, cy, (foot + head) / 2.0), **kw)
        self.centre_xy = centre_xy
        self.size_xy = size_xy

    def proxy_object(self, name):
        points = []
        cx, cy = self.centre_xy
        sx, sy = self.size_xy
        steps_x = max(1, int(round(sx / BOX_SAMPLE_METRES)))
        steps_y = max(1, int(round(sy / BOX_SAMPLE_METRES)))
        levels = sorted({0.0, HALL_FOOTING_BAND, self.head - self.foot - HALL_CROWN_BAND,
                         self.head - self.foot})
        # The cuts are read inclusively, so a band that starts at a level in this list takes
        # that level with it. The crown band therefore starts just above its level: a gable whose
        # crown is gone still has a hull up to the crown line, not a three metre wedge at its foot
        # with its centre of mass ten metres above it.
        for level in levels:
            keeps = self.keeps_at(level)
            for ix in range(steps_x + 1):
                x = cx - sx / 2 + sx * ix / steps_x
                for iy in range(steps_y + 1):
                    # Only the perimeter of the slab is needed for a hull; the inside adds nothing.
                    if 0 < ix < steps_x and 0 < iy < steps_y:
                        continue
                    y = cy - sy / 2 + sy * iy / steps_y
                    if all(keep(x, y) for keep in keeps):
                        points.append(self.relative((x, y, self.foot + level)))
        return hull_object(name, points, location=self.origin), "CONVEX_HULL", []


class Structure:
    def __init__(self, key, builder, radius_of, pieces, joint=None, keyed=()):
        self.key = key
        self.builder = builder
        self.radius_of = radius_of
        self.pieces = tuple(pieces)
        # (height, lean in radians at which it shears) for a structure that breaks in two.
        self.joint = joint
        # Pieces that are keyed rather than simulated.
        self.keyed = tuple(keyed)


def keep_x_at_most(limit):
    return lambda x, _y: x <= limit


def keep_x_at_least(limit):
    return lambda x, _y: x >= limit


def keep_y_at_most(limit):
    return lambda _x, y: y <= limit


def keep_y_at_least(limit):
    return lambda _x, y: y >= limit


def keep_nothing(_x, _y):
    return False


def tower_pieces():
    """What is left of the shell, as one body, and the torn near flank.

    Returns the one simulated piece and the keyed one. The shell's centre of mass is that of the
    far flank of the lower ring - the centroid of what is left of it, well on the far side of the
    axis - together with the whole upper ring on the axis. It stands past the flank's cut edge,
    which is what brings the shell over.
    """
    far, _near = flank_ranges()
    lower_slices = shell_mass_slices(tower_radius, COLUMN_HEIGHT, TOWER_FLANK_TOP, TOWER_SHELL_THICKNESS)
    upper_slices = shell_mass_slices(tower_radius, TOWER_FLANK_TOP, TOWER_HEIGHT, TOWER_SHELL_THICKNESS)
    # The far side of a ring, as a fraction of it and as the pull of its centroid off the axis.
    half_span = pi - TOWER_FLANK_SPLIT
    far_fraction = half_span / pi
    centroid = sin(half_span) / half_span
    lower_far = [(height, tonnes * far_fraction) for height, tonnes in lower_slices]
    lower_far.append((COLUMN_HEIGHT / 2.0, COLUMN_COUNT * COLUMN_TONNES * far_fraction))
    mass = total_mass(lower_far) + total_mass(upper_slices)
    com_x = -sum(tonnes * tower_radius(height) * centroid for height, tonnes in lower_far) / mass
    com_z = (sum(height * tonnes for height, tonnes in lower_far)
             + sum(height * tonnes for height, tonnes in upper_slices)) / mass

    def in_shell(centre):
        return centre.z >= TOWER_FLANK_TOP or angle_inside(atan2(centre.y, centre.x), far)

    def in_near(centre):
        return not in_shell(centre)

    def crumble(t):
        progress = min(1.0, max(0.0, t) / DEBRIS_CRUMBLE_SECONDS)
        scale = 1.0 - (1.0 - DEBRIS_CRUMBLE_SCALE) * (1.0 - (1.0 - progress) ** 2)
        return (0.0, 0.0, 0.0), (1.0, 1.0, scale)

    simulated = [
        CompoundShellPiece("shell", tower_radius, [
            (0.0, TOWER_FLANK_TOP, [(0.0, TOWER_FLANK_TOP + PROXY_BAND, keep_x_at_most(-TOWER_FLANK_CUT))]),
            (TOWER_FLANK_TOP, TOWER_HEIGHT, []),
        ], (com_x, 0.0, com_z), mass=mass, contains=in_shell),
    ]
    keyed = [KeyedPiece("debris", (0.0, 0.0, 0.0), in_near, crumble)]
    return simulated, keyed


def stack_pieces():
    lower = shell_mass_slices(stack_radius, 0.0, STACK_JOINT, STACK_WALL)
    upper = shell_mass_slices(stack_radius, STACK_JOINT, STACK_HEIGHT, STACK_WALL)
    top = STACK_JOINT
    return [
        ShellPiece("lower", stack_radius, 0.0, STACK_JOINT, (0.0, 0.0, centre_of_mass(lower)), cuts=[
            (0.0, STACK_CRUSH_BAND, keep_x_at_most(-STACK_SEAT_CUT)),
            (top - STACK_SEAT_BAND, top + PROXY_BAND, keep_x_at_most(-STACK_SEAT_CUT)),
        ], mass=total_mass(lower)),
        ShellPiece("upper", stack_radius, STACK_JOINT, STACK_HEIGHT, (0.0, 0.0, centre_of_mass(upper)),
                   open_top=True, cuts=[
                       (0.0, STACK_SEAT_BAND, keep_x_at_most(-STACK_SEAT_CUT)),
                   ], mass=total_mass(upper)),
    ], upper


def hall_pieces():
    """The roof and the four walls, each standing on the inner strip of its footing.

    A wall pivots on its inner edge, so it goes over outwards: the long walls to north and south,
    the gables to west and east. The roof has nothing cut - it simply loses what carried it.
    """
    half_x = HALL_LENGTH / 2
    half_y = HALL_DEPTH / 2
    t = HALL_WALL_THICKNESS
    h = HALL_WALL_HEIGHT
    roof_top = h + HALL_ROOF_THICKNESS
    slab = lambda area, thickness: area * thickness * CONCRETE_TONNES_PER_M3  # noqa: E731
    wall_mass = slab((HALL_LENGTH - 2 * t) * h, t)
    gable_mass = slab(HALL_DEPTH * h, t)
    roof_mass = slab(HALL_LENGTH * HALL_DEPTH, HALL_ROOF_THICKNESS) + slab((HALL_LENGTH - 10) * 8.0, 2.0)
    inner_x = half_x - t
    inner_y = half_y - t

    def inside_walls(centre):
        return centre.z < h + 1e-6

    crown = h - HALL_CROWN_BAND + 0.01
    return [
        # The roof's hull stops a metre short of every wall: the blast has blown its bearings, so
        # it drops between the walls the moment the clip starts and pancakes onto the floor. A roof
        # that still bore on the walls was tried twice: on their whole crowns it tied them into a
        # box that stood for forty seconds, on their outer edges alone it slid off one wall, leaned
        # against the other and pinned it half way over.
        BoxPiece("roof", (0.0, 0.0), (2 * (inner_x - 1.0), 2 * (inner_y - 1.0)), h, roof_top,
                 mass=roof_mass, fall_yaw=0.0, contains=lambda centre: centre.z >= h - 1e-6),
        BoxPiece("wall_n", (0.0, -(half_y - t / 2)), (HALL_LENGTH - 2 * t, t), 0.0, h,
                 cuts=[(0.0, HALL_FOOTING_BAND, keep_y_at_least(-inner_y - HALL_FOOTING_STRIP)),
                       (crown, h, keep_y_at_most(-half_y + HALL_CROWN_STRIP))],
                 mass=wall_mass, fall_yaw=-pi / 2,
                 contains=lambda centre: inside_walls(centre) and centre.y < -inner_y + 0.5
                 and abs(centre.x) < inner_x),
        BoxPiece("wall_s", (0.0, half_y - t / 2), (HALL_LENGTH - 2 * t, t), 0.0, h,
                 cuts=[(0.0, HALL_FOOTING_BAND, keep_y_at_most(inner_y + HALL_FOOTING_STRIP)),
                       (crown, h, keep_y_at_least(half_y - HALL_CROWN_STRIP))],
                 mass=wall_mass, fall_yaw=pi / 2,
                 contains=lambda centre: inside_walls(centre) and centre.y > inner_y - 0.5
                 and abs(centre.x) < inner_x),
        BoxPiece("gable_w", (-(half_x - t / 2), 0.0), (t, HALL_DEPTH), 0.0, h,
                 cuts=[(0.0, HALL_FOOTING_BAND, keep_x_at_least(-inner_x - HALL_FOOTING_STRIP)),
                       (crown, h, keep_nothing)],
                 mass=gable_mass, fall_yaw=pi,
                 contains=lambda centre: inside_walls(centre) and centre.x <= -inner_x),
        BoxPiece("gable_e", (half_x - t / 2, 0.0), (t, HALL_DEPTH), 0.0, h,
                 cuts=[(0.0, HALL_FOOTING_BAND, keep_x_at_most(inner_x + HALL_FOOTING_STRIP)),
                       (crown, h, keep_nothing)],
                 mass=gable_mass, fall_yaw=0.0,
                 contains=lambda centre: inside_walls(centre) and centre.x >= inner_x),
    ]


_TOWER_SIMULATED, _TOWER_KEYED = tower_pieces()
TOWER = Structure("tower", build_cooling_tower, tower_radius, _TOWER_SIMULATED, keyed=_TOWER_KEYED)
STACK = Structure("stack", build_vent_stack, stack_radius, stack_pieces()[0],
                  joint=(STACK_JOINT, STACK_SHEAR_TILT))
HALL = Structure("hall", build_turbine_hall, None, hall_pieces())


class PieceCanvas(SmoothCanvas):
    """A canvas whose vertices come out relative to the piece's own foot, filtered to the piece.

    The rig empty stands at the foot and the meshes hang under it, so the mesh data has to be in
    the rig's frame. Geometry is drawn whole by the intact builder and sorted into the pieces
    element by element: an element belongs to the piece whose region its centre stands in. The
    shells are drawn in sections cut at the joints and in the sectors themselves, and the hall is
    all boxes, so no element ever straddles a break.
    """

    def __init__(self, spec):
        super().__init__()
        self.spec = spec
        self.shift = Matrix.Translation(-spec.origin)

    def _add(self, material, decorative, verts, faces, matrix, smooth=False):
        placed = [matrix @ Vector(vertex) for vertex in verts]
        if not placed:
            return
        centre = sum(placed, Vector((0.0, 0.0, 0.0))) / len(placed)
        if not self.spec.contains(centre):
            return
        super()._add(material, decorative, verts, faces, self.shift @ matrix, smooth=smooth)


def piece_canvas(structure, index):
    canvas = PieceCanvas(structure.pieces[index])
    structure.builder(canvas)
    return canvas


def canvas_vertices(canvas):
    for verts, _faces, _colors, _smooth in canvas.buckets.values():
        yield from verts


# --- The collapse ----------------------------------------------------------------------------------


class Collapse:
    """One structure coming down: its proxies, the joint if it has one, and the frames."""

    def __init__(self, scene, structure):
        self.scene = scene
        self.structure = structure
        self.pieces = tuple(spec.suffix for spec in structure.pieces)
        self.max_frames = int(SIM_MAX_SECONDS * FPS)
        self.simulation = []
        self.proxies = {}
        self.joint = None
        self.break_frame = None
        self.passes = 0
        self.frames = []
        self.samples = []
        self.rest_frame = 0
        self.rest_piece = None
        self._build()

    def _build(self):
        rigid_world(self.scene, self.max_frames)
        ground = box_object("sim_ground", 420.0, -30.0, 0.0)
        add_body(ground, "PASSIVE", "CONVEX_HULL")
        self.simulation.append(ground)

        structure = self.structure
        for spec in structure.pieces:
            proxy, shape, children = spec.proxy_object(f"sim_piece_{spec.suffix}")
            for child in children:
                add_body(child, "ACTIVE", "CONVEX_HULL", mass=spec.mass / len(children))
            add_body(proxy, "ACTIVE", shape, mass=spec.mass)
            self.proxies[spec.suffix] = proxy
            self.simulation.append(proxy)
            self.simulation.extend(children)
            self.simulation.append(add_plane_lock(f"sim_plane_{spec.suffix}", proxy, ground,
                                                  spec.fall_yaw))

        if structure.joint is not None:
            height = structure.joint[0]
            self.joint = add_constraint("sim_joint", (0.0, 0.0, height),
                                        self.proxies[self.pieces[0]], self.proxies[self.pieces[1]])
            self.simulation.append(self.joint)

    # -- the joint ---------------------------------------------------------------------------

    def first_failure(self, samples):
        """The first settled frame at which the lower piece leans past the shear angle."""
        _height, shear_tilt = self.structure.joint
        for frame in range(JOINT_SETTLE_FRAMES, len(samples)):
            if tilt_of(samples[frame][self.pieces[0]][1]) >= shear_tilt:
                return frame
        return None

    # -- running it ---------------------------------------------------------------------------

    def simulate(self):
        self.passes += 1
        return sample_poses(self.scene, self.proxies, self.max_frames)

    def run(self):
        samples = self.simulate()
        if self.joint is not None:
            found = self.first_failure(samples)
            if found is not None:
                key_constraint_open(self.joint, self.scene, found)
                self.break_frame = found
                samples = self.simulate()
        identical, mismatch = replay_matches(self.scene, self.proxies, self.max_frames, samples)
        if not identical:
            raise RuntimeError(f"collapse is not deterministic: first mismatch at {mismatch}")
        self.samples = samples
        self.frames, self.rest_frame, self.rest_piece = trim_to_rest(samples, self.pieces, FPS)
        return self.frames

    def dismantle(self):
        dismantle(self.scene, self.simulation)
        self.proxies, self.simulation, self.joint = {}, [], None

    # -- measurements -------------------------------------------------------------------------

    def pose_matrix(self, piece, frame):
        location, rotation = self.frames[frame][piece]
        return Matrix.Translation(location) @ rotation.to_matrix().to_4x4()

    def rest_vertices(self, piece, canvas):
        matrix = self.pose_matrix(piece, len(self.frames) - 1)
        for vertex in canvas_vertices(canvas):
            yield matrix @ Vector(vertex)

    def reach(self, canvases):
        """How far the wreck ends up from the structure's axis, in metres, as a radius.

        A radius rather than a footprint: the towers are turned onto their anchors, which lie on
        the map's X axis, the stack follows the shot and may land at any angle, and the hall's
        slot is never turned at all - so the radius is the one number that covers all three.
        """
        far = 0.0
        for piece in self.pieces:
            for point in self.rest_vertices(piece, canvases[piece]):
                far = max(far, hypot(point.x, point.y))
        return far

    def report(self, stem, clip_name, canvases):
        last = len(self.frames) - 1
        shear = "no joint"
        if self.structure.joint is not None:
            turns = [tilt_of(pose[self.pieces[0]][1]) for pose in self.samples]
            shear = (f"joint@frame{self.break_frame}/{degrees(turns[self.break_frame]):.1f}deg"
                     if self.break_frame is not None else "held")
        print(
            f"collapse {stem} clip={clip_name} pieces={','.join(self.pieces)} passes={self.passes} "
            f"shears={shear} rest_frame={self.rest_frame}/{self.rest_piece} frames={len(self.frames)} "
            f"duration={last / FPS:.2f}s reach={self.reach(canvases):.1f}m "
            f"overran={self.rest_frame >= self.max_frames - REST_FRAMES - 1}"
        )
        for piece in self.pieces:
            swept, step_move, step_turn = piece_steps(self.frames, piece)
            location, rotation = self.frames[-1][piece]
            lowest = min(point.z for point in self.rest_vertices(piece, canvases[piece]))
            highest = max(point.z for point in self.rest_vertices(piece, canvases[piece]))
            print(
                f"  piece {stem} {piece} turned={degrees(swept):.0f}deg "
                f"tilt={degrees(tilt_of(rotation)):.1f}deg "
                f"max_step={step_move:.2f}m/{degrees(step_turn):.2f}deg "
                f"rest=(x={location.x:.1f} y={location.y:.1f} z={location.z:.1f}) "
                f"lowest={lowest:.2f}m highest={highest:.1f}m"
            )


# One simulation per structure, cached: the two tower scenes are the same collapse under two
# sets of rig names, and running Bullet twice would only be a chance for the files to differ.
_COLLAPSE_CACHE = {}


def build_topple_scene(stem, clip_name, structure, prefix):
    """The builder handed to the shared exporter: simulate (or reuse), bake, then draw the pieces."""

    def builder(scene, _mats):
        scene.frame_end = scene.frame_start + int(SIM_MAX_SECONDS * FPS) - 1
        cached = _COLLAPSE_CACHE.get(structure.key)
        if cached is None:
            collapse = Collapse(scene, structure)
            frames = collapse.run()
            collapse.dismantle()
            canvases = {spec.suffix: piece_canvas(structure, index)
                        for index, spec in enumerate(structure.pieces)}
            collapse.report(stem, clip_name, canvases)
            cached = (frames, collapse.reach(canvases))
            _COLLAPSE_CACHE[structure.key] = cached
        else:
            print(f"collapse {stem} clip={clip_name} reuses the {structure.key} simulation "
                  f"frames={len(cached[0])} reach={cached[1]:.1f}m")
        frames, _reach = cached
        scene.frame_end = scene.frame_start + len(frames) - 1
        scene["loop_duration_seconds"] = (len(frames) - 1) / FPS

        rigs = {}
        for index, spec in enumerate(structure.pieces):
            piece = f"{prefix}_{spec.suffix}"
            rig = et.rig(f"piece_{piece}", spec.origin)
            rig.rotation_mode = "QUATERNION"
            piece_canvas(structure, index).emit(f"piece_{piece}", parent=rig)
            rigs[spec.suffix] = (rig, spec.origin)
        # The keyed pieces: not in the solver, but in the file like every other piece, under a
        # rig of their own with one key per frame, so the runtime moves their colliders too.
        for keyed in structure.keyed:
            piece = f"{prefix}_{keyed.suffix}"
            rig = et.rig(f"piece_{piece}", keyed.origin)
            canvas = PieceCanvas(keyed)
            structure.builder(canvas)
            canvas.emit(f"piece_{piece}", parent=rig)
            for index in range(len(frames)):
                location, scale = keyed.pose(index / FPS)
                et.keyframe(rig, scene.frame_start + index,
                            location=keyed.origin + Vector(location), scale=scale)

        for index, frame in enumerate(frames):
            at = scene.frame_start + index
            for suffix, (location, rotation) in frame.items():
                rig, origin = rigs[suffix]
                # Frame 1 is the standing structure, exactly: the preset places the scene off
                # this pose and the contract test measures it, so it is written rather than
                # sampled.
                if index == 0:
                    location = origin.copy()
                    rotation = rest_pose()
                rig.location = location
                rig.keyframe_insert("location", frame=at)
                rig.rotation_quaternion = rotation
                rig.keyframe_insert("rotation_quaternion", frame=at)

    return builder


# --- The mushroom cloud --------------------------------------------------------------------------


def ease_out(t, tau):
    """1 - e^(-t/tau): starts fast, approaches one and never quite gets there."""
    return 1.0 - exp(-max(0.0, t) / tau)


def turn(name, t):
    """Yaw of one turning part of the cloud at `t`, in radians.

    Every part turns at its own steady rate and the rim turns against the cap. From a cockpit the
    absolute angle means nothing; what reads is that two lumpy silhouettes slide past each other,
    which is the only way a keyed mesh can show the rolling circulation the real thing has.
    """
    return 2.0 * pi * CLOUD_TURNS[name] * t / CLOUD_SECONDS


def cloud_pose(t):
    """Every keyed value of the cloud at one second of the clip.

    Returns a dict of rig name -> (location, scale, yaw). The unit meshes are built at radius one,
    so a scale is a radius in metres. Before a part appears it is keyed at TINY_SCALE on the axis,
    so frame 1 - the rest pose the loader measures the scene by - is the ruin and nothing else.

    The parts start at different seconds and approach their sizes on different time constants, so
    the silhouette keeps changing long after everything is on screen: fireball, base surge, dust
    front, stem, cap, rolled rim, and last the lopsided masses that boil on the cap.
    """
    fireball_height, fireball = fireball_at(t)

    cap_t = t - CAP_START_SECONDS
    if cap_t < 0.0:
        cap_radius, cap_centre, stem_radius, stem_top = 0.0, 40.0, 0.0, 1.0
    else:
        # The cap emerges at the fireball's size and swells towards its final radius; its centre
        # climbs with the square root of time, the way a buoyant thermal slows as it rises, and
        # stops at its ceiling. The stem is drawn from the ground up to a quarter radius into it.
        cap_radius = (CLOUD_CAP_BIRTH_RADIUS
                      + (CLOUD_CAP_RADIUS - CLOUD_CAP_BIRTH_RADIUS) * ease_out(cap_t, 11.0))
        climb = min(1.0, cap_t / CAP_RISE_SECONDS)
        cap_centre = 40.0 + (CLOUD_CAP_TOP - 0.55 * CLOUD_CAP_RADIUS - 40.0) * sqrt(climb)
        stem_radius = 4.0 + (CLOUD_STEM_RADIUS - 4.0) * ease_out(cap_t, 7.0)
        stem_top = max(1.0, cap_centre - 0.25 * cap_radius)

    # The rolled rim: it rolls out of the cap on a much shorter time constant than the cap itself
    # swells, so the edge runs ahead of the body early and the body catches it up later. It hangs
    # a tenth of the cap's radius below the cap's centre, where the toroid draws its air in.
    rim_t = t - RIM_START_SECONDS
    rim_radius = 0.0 if rim_t < 0.0 else (
        CLOUD_RIM_RATIO * (34.0 + (CLOUD_CAP_RADIUS - 34.0) * ease_out(rim_t, 6.5)))
    rim_centre = cap_centre - 0.10 * max(cap_radius, rim_radius)

    # The masses that boil up on the cap, late and slowly: they are what stops the cap from being
    # a smooth dome for the rest of the clip.
    bloom_t = t - BLOOM_START_SECONDS
    bloom_radius = 0.0 if bloom_t < 0.0 else (
        CLOUD_BLOOM_RATIO * (26.0 + (CLOUD_CAP_RADIUS - 26.0) * ease_out(bloom_t, 16.0)))
    bloom_centre = cap_centre + 0.16 * cap_radius

    # The afterwinds: offset streams that set out before the stem is drawn and stand wider than it.
    # The columns under this rig are of different lengths, so one scale lifts them to different
    # heights and they never rise as one body.
    plume_t = t - PLUME_START_SECONDS
    plume_radius = 0.0 if plume_t < 0.0 else 6.0 + (CLOUD_PLUME_RADIUS - 6.0) * ease_out(plume_t, 9.0)
    # The streams climb on the cap's own square root of time but stop short of it, so the stem
    # stays the one thing that reaches the underside.
    plume_climb = sqrt(min(1.0, max(0.0, plume_t) / CAP_RISE_SECONDS))
    plume_top = 0.0 if plume_t < 0.0 else 6.0 + (PLUME_TOP - 6.0) * plume_climb

    # The base surge: wide and low, but not a pancake. Its height is a sixth of its reach, which is
    # about what surface-burst footage shows and enough that it takes light like a body rather than
    # painting a shadow on the apron.
    ring_t = t - RING_START_SECONDS
    ring_radius = 0.0 if ring_t < 0.0 else 20.0 + (CLOUD_RING_RADIUS - 20.0) * ease_out(ring_t, 13.0)
    ring_height = 8.0 + 26.0 * ease_out(max(0.0, ring_t), 9.0)

    # The dust front runs out ahead of the surge on a shorter time constant and stays lower, so from
    # the air the ground reads as a ragged edge advancing rather than a disc appearing.
    front_t = t - FRONT_START_SECONDS
    front_radius = 0.0 if front_t < 0.0 else 26.0 + (CLOUD_FRONT_RADIUS - 26.0) * ease_out(front_t, 9.0)
    front_height = 6.0 + 20.0 * ease_out(max(0.0, front_t), 7.0)

    slump = 1.0
    if t > RUIN_SLUMP_START:
        progress = min(1.0, (t - RUIN_SLUMP_START) / (RUIN_SLUMP_END - RUIN_SLUMP_START))
        slump = 1.0 - (1.0 - RUIN_SLUMP_SCALE) * (1.0 - (1.0 - progress) ** 2)

    def radius_scale(value):
        return max(TINY_SCALE, value)

    def disc(radius, height):
        """A part that is as flat as it is wide: nothing at all until its radius is there."""
        return (radius_scale(radius), radius_scale(radius),
                radius_scale(height if radius > 0.0 else 0.0))

    return {
        "fire": ((0.0, 0.0, fireball_height), (radius_scale(fireball),) * 3, 0.0),
        "cap": ((0.0, 0.0, cap_centre), (radius_scale(cap_radius),) * 3, turn("cap", t)),
        "roll": ((0.0, 0.0, rim_centre), (radius_scale(rim_radius),) * 3, turn("rim", t)),
        "bloom": ((0.0, 0.0, bloom_centre), (radius_scale(bloom_radius),) * 3, turn("bloom", t)),
        "stem": ((0.0, 0.0, 0.0), disc(stem_radius, stem_top), 0.0),
        "plume": ((0.0, 0.0, 0.0), disc(plume_radius, plume_top), turn("plume", t)),
        "ring": ((0.0, 0.0, 0.0), disc(ring_radius, ring_height), 0.0),
        "front": ((0.0, 0.0, 0.0), disc(front_radius, front_height), turn("front", t)),
        "ruin": ((0.0, 0.0, 0.0), (1.0, 1.0, slump), 0.0),
    }


def build_ruin(canvas):
    """The containment's lower half, torn open, and what is left of the wings.

    Drawn to the same footprint as the intact block -- the wings' plinths keep its extents -- so
    the scene's bounding box centres where the intact one does and the loader puts the ruin on the
    block's own axis.
    """
    # The broken wall: the lower half of the containment with a jagged top edge, sector by sector.
    sectors = 28
    for index in range(sectors):
        angle = 2.0 * pi * index / sectors
        following = 2.0 * pi * (index + 1) / sectors
        top = 14.0 + 12.0 * et.hash01(index * 1.7, 3.1, 0.4)
        radius = CONTAINMENT_RADIUS - 0.6
        start = (radius * cos(angle), radius * sin(angle))
        end = (radius * cos(following), radius * sin(following))
        centre = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, top / 2)
        width = hypot(end[0] - start[0], end[1] - start[1])
        canvas.box(SCORCHED, centre, (width + 0.2, 1.4, top),
                   rotation=(0, 0, angle + pi / 2 + pi / sectors))
    # The floor of the containment and the exposed reactor cavity ring.
    revolve(canvas, RUBBLE, [(0.0, 0.0), (CONTAINMENT_RADIUS - 0.2, 0.0),
                             (CONTAINMENT_RADIUS - 0.2, 1.2), (0.0, 1.2)], segments=40)
    revolve(canvas, SCORCHED, shell_profile([(9.0, 1.2), (9.0, 6.0)], 2.0), segments=32)
    # Rubble heaps spilled around the wall, in opposite pairs so the ruin's bounding box stays
    # centred on the axis, and the plinths of the two wings.
    for index in range(7):
        angle = 2.0 * pi * index / 7 + 0.3
        distance = CONTAINMENT_RADIUS + 4.0 + 6.0 * et.hash01(index, 2.0, 5.0)
        size = 3.0 + 4.0 * et.hash01(index, 7.0, 1.0)
        for mirror in (0.0, pi):
            # Lifted so that no tilted corner reaches under the apron: the scene is placed by
            # its lowest vertex, and that has to be the ruin's floor, at the block's own underside.
            canvas.box(RUBBLE, (distance * cos(angle + mirror), distance * sin(angle + mirror),
                                size * 0.55),
                       (size, size * 0.8, size * 0.7), rotation=(0.2, 0.1, angle + mirror))
    for sign in (-1, 1):
        wing_y = sign * WING_OFFSET_Y
        wx, wy, _wz = WING_SIZE
        canvas.box(SCORCHED, (0, wing_y, 0.75), (wx, wy, 1.5))
        # Wing walls standing to a third of their height, the roof gone.
        for side in (-1, 1):
            canvas.box(SCORCHED, (side * (wx / 2 - 0.7), wing_y, 4.5), (1.4, wy - 2, 7.0))
        canvas.box(SCORCHED, (0, wing_y + sign * (wy / 2 - 0.7), 5.5), (wx - 2, 1.4, 9.0))


def blob(canvas, material, center, size, squash=0.85, steps=6, segments=12):
    """One smoke mass: a squashed sphere of `size` at `center`, in the rig's own unit frame.

    Smoke reads by how ragged the outline of the whole body is, not by how round each mass is, so
    these are deliberately coarse and there are many of them - the 8000 triangles a scene may spend
    buy far more silhouette as thirty rough masses than as three smooth ones. Always decorative:
    nothing in the cloud collides.
    """
    verts, faces = revolve_geometry(spheroid_profile(size, size * squash, size * squash * 0.9,
                                                    steps=steps), segments)
    phase = 2 * pi * et.hash01(*center)
    for index, (x, y, z) in enumerate(verts):
        angle = atan2(y, x)
        ripple = 1 + 0.14 * sin(3 * angle + phase + z / size) + 0.07 * sin(7 * angle - phase)
        verts[index] = (x * ripple, y * ripple, z)
    canvas._add(material, True, verts, faces, Matrix.Translation(Vector(center)), smooth=True)


def dust_mound(canvas, center, radius, height, segments=12):
    """A closed uneven heap with a flat foot: dust cannot float above its ground source."""
    profile = [(0, 0), (radius * 0.94, 0), (radius, height * 0.22),
               (radius * 0.72, height * 0.68), (radius * 0.32, height), (0, height * 0.9)]
    verts, faces = revolve_geometry(profile, segments)
    phase = 2 * pi * et.hash01(*center)
    for index, (x, y, z) in enumerate(verts):
        ripple = 1 + 0.12 * sin(3 * atan2(y, x) + phase)
        verts[index] = (x * ripple, y * ripple, z)
    canvas._add(DUST, True, verts, faces, Matrix.Translation(Vector(center)), smooth=True)


def build_cap_body(canvas):
    """The cap: a squashed dome under a ring of unequal masses, over a wide dark underside.

    The dome is drawn slightly inside the rig's unit radius so the masses stand proud of it: a dome
    at full radius with bumps on it still reads as a circle, and a circle is what a cloud must never
    be. The masses differ in reach, size and height and every second one is the dark material, so
    neither the outline nor the light across it is even. The underside is one wide dark spheroid -
    that is where the toroid draws its air in, and it is what a player flying under the cloud sees.
    """
    revolve(canvas, CLOUD, spheroid_profile(0.90, 0.55, 0.34, steps=10), segments=30, decorative=True)
    for index in range(9):
        angle = 2.0 * pi * index / 9 + 0.4
        reach = 0.52 + 0.30 * et.hash01(index, 1.0, 2.0)
        size = 0.26 + 0.22 * et.hash01(index, 4.0, 1.0)
        height = 0.02 + 0.30 * et.hash01(index, 9.0, 3.0)
        blob(canvas, CLOUD if index % 2 else CLOUD_DARK,
             (reach * cos(angle), reach * sin(angle), height), size, segments=14)
    blob(canvas, CLOUD_DARK, (0.0, 0.0, -0.22), 0.66, squash=0.32, steps=8, segments=22)


def build_cap_rim(canvas):
    """The rolled rim, as a ring of masses lying on the cap's own radius.

    A torus would read as a smooth tube. Nine unequal masses at slightly different heights read as
    smoke that has rolled outwards and downwards, and because the rig turns against the cap the
    whole ring slides past the masses above it while both keep growing. They are large enough to
    overlap each other, so the rim is a lumpy band rather than a string of beads.
    """
    for index in range(9):
        angle = 2.0 * pi * index / 9
        size = 0.30 + 0.16 * et.hash01(index, 5.0, 8.0)
        height = -0.04 - 0.14 * et.hash01(index, 2.0, 6.0)
        blob(canvas, CLOUD_DARK, (cos(angle), sin(angle), height), size, squash=0.74)


def build_cap_bloom(canvas):
    """The masses that boil up late, all on one flank, so the cap never settles into a dome."""
    for index in range(5):
        angle = 1.1 + 2.4 * et.hash01(index, 3.0, 7.0)
        reach = 0.42 + 0.50 * et.hash01(index, 6.0, 2.0)
        size = 0.30 + 0.24 * et.hash01(index, 8.0, 4.0)
        height = -0.08 + 0.42 * et.hash01(index, 1.0, 9.0)
        blob(canvas, CLOUD, (reach * cos(angle), reach * sin(angle), height), size)


def build_stem_plumes(canvas):
    """Three offset streams beside the stem, of three different lengths.

    The rig scales them all at once, but because the columns are authored at 0.38 to 0.78 of the
    rig's unit height they arrive at different altitudes and keep arriving at different rates. Each
    one is short and thick rather than long and thin - a thin column over a hundred and fifty metres
    reads as a pipe - and carries three knots of smoke that drift off its axis as they rise. The rig
    turns as well, so the streams wind around the stem instead of standing beside it.
    """
    for index in range(3):
        angle = 2.0 * pi * index / 3 + 0.7
        offset = 0.44 + 0.34 * et.hash01(index, 2.0, 3.0)
        width = 0.26 + 0.18 * et.hash01(index, 7.0, 5.0)
        top = 0.38 + 0.40 * et.hash01(index, 4.0, 9.0)
        lean = 0.30 * et.hash01(index, 6.0, 1.0)
        centre = (offset * cos(angle), offset * sin(angle), 0.0)
        revolve(canvas, CLOUD_DARK,
                [(0.0, 0.0), (width, 0.0), (width * 0.72, top * 0.34), (width * 0.94, top * 0.66),
                 (width * 0.50, top), (0.0, top)],
                segments=12, closed=False, decorative=True, center=centre)
        # The knots are authored flat and come out round: this rig is scaled by its radius on X and
        # Y but by its whole height on Z, five times as much, so a unit sphere under it would be an
        # egg five times taller than it is wide - and its lower half would sink through the apron
        # into the bunker below the site.
        for height, drift, girth in ((top * 0.34, 0.2, 1.05), (top * 0.66, 0.6, 1.25),
                                     (top, 1.0, 1.45)):
            reach = offset + lean * drift
            blob(canvas, CLOUD_DARK, (reach * cos(angle), reach * sin(angle), height),
                 width * girth, squash=0.20, steps=5, segments=10)


def build_dust_front(canvas):
    """The advancing edge of the ground dust: nine unequal heaps on one ring.

    Uneven on purpose - an even ring reads as a disc that grows, and what a surface burst actually
    leaves is a ragged front that runs out further in some directions than others. Flat, because
    anything with height out here would read as a second cloud rather than as ground dust.
    """
    # Authored tall for the same reason the stream knots are authored flat: this rig is eight times
    # wider than it is high, so a heap has to be an egg here to arrive as a mound out there.
    for index in range(9):
        angle = 2.0 * pi * index / 9
        reach = 0.62 + 0.38 * et.hash01(index, 4.0, 2.0)
        size = 0.16 + 0.20 * et.hash01(index, 1.0, 7.0)
        dust_mound(canvas, (reach * cos(angle), reach * sin(angle), 0.0), size,
                   0.45 + 1.8 * size, segments=12)


def build_mushroom_cloud(scene, _mats):
    """The breach: ruin, fireball, stem and plumes, cap with its rolled rim, dust and its front.

    Every part is a unit body under a rig of its own and everything it does over the 49 seconds is
    keyed on that rig from `cloud_pose`: where it stands, how big it is, and how far it has turned.
    The fireball alone is keyed off FIREBALL_CURVE, because the runtime reads the same table to
    decide who the fireball burns - see MapDestructibleHazardContract.js.
    """
    for material in (CLOUD, CLOUD_DARK, DUST):
        shader = et.build_material(material).node_tree.nodes.get("Principled BSDF")
        shader.inputs["Roughness"].default_value = 1.0
        shader.inputs["Specular IOR Level"].default_value = 0.0
    root = et.rig("piece_reactor")
    ruin_rig = et.rig("ruin")
    ruin_rig.parent = root
    ruin = SmoothCanvas()
    build_ruin(ruin)
    ruin.emit("piece_reactor_ruin", parent=ruin_rig)

    rigs = {"ruin": ruin_rig}
    # The fireball is the one body that fills the screen on its own, for four seconds, so it gets
    # the roundest outline in the scene: at 62 m a coarse sphere reads as a faceted ball.
    fire = SmoothCanvas()
    revolve(fire, FIREBALL, spheroid_profile(1.0, 1.0, 1.0, steps=12), segments=32, decorative=True)
    cap, roll, bloom = SmoothCanvas(), SmoothCanvas(), SmoothCanvas()
    build_cap_body(cap)
    build_cap_rim(roll)
    build_cap_bloom(bloom)
    # The stem: not a cylinder. It is drawn in from the ruin, waists at a third of its height where
    # the draught is fastest, swells again where the cap takes it, and closes on the axis.
    stem = SmoothCanvas()
    revolve(stem, CLOUD_DARK,
            [(0.0, 0.0), (1.0, 0.0), (0.74, 0.22), (0.62, 0.48), (0.78, 0.76), (0.54, 1.0),
             (0.0, 1.0)],
            segments=24, closed=False, decorative=True)
    for verts, _faces, _colors, _smooth in stem.buckets.values():
        for index, (x, y, z) in enumerate(verts):
            swell = 1 + 0.22 * sin(z * 15)
            verts[index] = (x * swell + 0.32 * sin(z * 8),
                            y * swell + 0.24 * sin(z * 11), z)
    plume = SmoothCanvas()
    build_stem_plumes(plume)
    # The base surge: a broad low mound rather than the ring it used to be. A flat torus lying on
    # the apron draws two hard concentric circles on the ground, and no amount of dust heaped on its
    # edge hides them; filling the middle in leaves one edge, and the front breaks that one.
    ring = SmoothCanvas()
    dust_mound(ring, (0.0, 0.0, 0.0), 1.0, 0.75, segments=28)
    front = SmoothCanvas()
    build_dust_front(front)

    for name, canvas in (("fire", fire), ("cap", cap), ("roll", roll), ("bloom", bloom),
                         ("stem", stem), ("plume", plume), ("ring", ring), ("front", front)):
        rig = et.rig(name)
        rig.parent = root
        canvas.emit(f"piece_reactor_{name}", parent=rig)
        rigs[name] = rig

    frames = int(round((CLOUD_SECONDS + CLOUD_HOLD_SECONDS) * FPS))
    scene.frame_end = scene.frame_start + frames
    scene["loop_duration_seconds"] = frames / FPS
    # One key per frame, deliberately: the glTF exporter samples every frame anyway, and a sparser
    # set of keys would be interpolated by Blender's own curves rather than linearly - which would
    # put the exported fireball a little off the table the runtime reads.
    for index in range(frames + 1):
        t = min(CLOUD_SECONDS, index / FPS)
        for name, (location, scale, yaw) in cloud_pose(t).items():
            et.keyframe(rigs[name], scene.frame_start + index,
                        location=location, scale=scale, rotation=(0.0, 0.0, yaw))


SCENES = (
    ("20_topple_tower_west", "ToppleTowerWestOnce", TOWER, "tower_w"),
    ("21_topple_tower_east", "ToppleTowerEastOnce", TOWER, "tower_e"),
    ("22_topple_stack", "ToppleStackOnce", STACK, "stack"),
    ("23_collapse_hall", "CollapseHallOnce", HALL, "hall"),
)

SETPIECES = tuple(
    (stem, clip, 0, build_topple_scene(stem, clip, structure, prefix))
    for stem, clip, structure, prefix in SCENES
) + (
    ("30_mushroom_cloud", "MushroomCloudOnce", CLOUD_SECONDS + CLOUD_HOLD_SECONDS, build_mushroom_cloud),
)


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    et.SOURCE_DIR = SOURCE_DIR
    et.GLB_DIR = GLB_DIR
    for part in ARCHITECTURE:
        et.export_part(*part)
    for setpiece in SETPIECES:
        et.export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
