"""Build the Curvios Clash fighter jet as an editable blend and a GLB with moving parts.

Run with Blender 4.2:
  blender --background --python scripts/generate_fighter_jet_asset.py -- [options]
  blender --background --python scripts/generate_fighter_jet_asset.py -- --no-animation

The model is a canard-delta multirole fighter in the class of the JAS 39 Gripen: single engine,
canard foreplanes, a cropped delta wing with elevons and leading-edge flaps, one vertical fin with
a rudder, a dorsal speed brake and a telescoping refuelling probe. All lifting surfaces are lofted
from one NACA-style airfoil per station (thickness distribution plus a little camber), and every
control surface is a sub-range of that same section. That is what keeps a deflected elevon flush
with the wing behind its hinge instead of hovering next to it.

Axes: the game's player vehicles face -Z (`src/entities/obj-vehicle-mesh.js` puts the muzzle at
-size.z). Blender exports its +Y as glTF -Z, so the nose points along +Y here. Blender x stays the
game's x (span), Blender z becomes the game's y (height).

Scale: authored 1:1 in metres - 14.10 m long, 8.40 m span, 2.30 m to the fin tip. The game's OBJ
vehicle path normalises the longest edge to 4.5 units and a map placement uses `targetSize`; both
ignore the authored size, so no game unit is baked in.

Moving parts. Every one keeps its object origin on its hinge, so the runtime can rotate the node
directly. Swept hinges carry a base rotation that puts their local x on the hinge line, and the
clips always write the full euler, base rotation included:
  canopy                rear hinge, lifts 30 degrees
  canard_left/right     foreplanes, +-22 degrees
  elevon_left/right     trailing edge, +-22 degrees symmetric and differential
  lef_left/right        leading-edge flaps, 0..24 degrees droop
  rudder                vertical hinge, +-26 degrees
  speed_brake           front hinge on the spine, opens 55 degrees
  refuel_probe          telescopes 0.95 m forward, drooping 8 degrees
  gear_nose/left/right  retract aft and inward, after their doors swung open
  wheel_nose/left/right spin about the axle, children of the gear legs
  nozzle_petals         variable iris, scales 0.92..1.05
  afterburner           flame cone, scales 0.05..1.0

Clips are NLA tracks of the same name: the glTF exporter merges same-named tracks across objects
into one clip and solos them, so no clip leaks another system's pose. That was probed on Blender
4.2.16 before this file was written, because the action-per-object mode would have produced one
clip per object and a scene mode only one clip in total. The exporter writes the clips in
alphabetical order, so the file starts with `afterburner`; a caller that wants a specific pose
names the clip, and a caller that names none gets that first one. Without any clip playing, the
node transforms are the rest pose: parked, gear down, canopy shut, probe stowed.

Livery and shading, all of it in the file rather than in a Blender viewport:
  - one 512 px PNG skin, painted here, embedded in the GLB and box-projected onto every part. One
    tile covers 8 m of surface, so a 64 px panel line lands about a metre wide, and the map repeats
    without a seam because every pattern in it wraps.
  - COLOR_0 carries the two-tone underside and the ambient occlusion baked with Cycles over the
    whole model. glTF multiplies it onto the painted map, so both only ever darken, and the values
    are clamped to the floor the repo allows.
  - the national markings are geometry, not pixels: a three-ring roundel laid on the measured wing
    surface, a fin flash that passes through the fin, and a yellow warning ring in each intake
    mouth. Decals placed by guessed heights used to end up buried inside the skin.
Budgets: 7,910 triangles, 56 primitives, 29 mesh nodes and under 700 KiB for the whole file.
"""

import argparse
import json
import math
import random
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Vector

FPS = 30
PART_NAME = "01_fighter_jet"
RING_POINTS = 24
FUSELAGE_EXPONENT = 2.4

# ---------------------------------------------------------------- livery, texture, shading

# One tileable grey skin: panel lines, rivets, access panels and a fine mottle. It repeats, and one
# tile covers this much surface, so a 64 px panel line on a 512 px map lands at about 1 m - the size
# of a real skin panel on a fighter.
TEXTURE_NAME = "FighterJetSkin"
TEXTURE_SIZE = 512
TEXTURE_METRES_PER_TILE = 8.0
PANEL_PIXELS = 64
RIVET_PIXELS = 8

# Occlusion baked into vertex colours, the way the Eiffel and Falkenwacht packs do it: no second
# texture, no second draw call, and it still darkens the wing root, the intakes and the bays.
AO_STRENGTH = 0.55
AO_DISTANCE = 1.40
AO_SAMPLES = 32
# COLOR_0 multiplies the paint, so it may only darken. 0.18 is the darkest value the repo allows:
# the exporter writes the layer as a normalised integer, and a value below it means the run wrapped
# around above 1.0 in Blender.
AO_MIN_TONE = 0.18

# ---------------------------------------------------------------- design in metres

# (y, half width, half height, centre height). The front stations follow a tangent-ogive radome
# (radius ~ t ** 0.62 along its 2.20 m), which is what keeps a jet nose convex instead of a cone.
# The waist from y = 5.20 to 2.90 is where the canopy sits; the spine rises again behind it, and
# the aft body flattens and tapers towards the nozzle.
FUSELAGE = (
    (7.40, 0.020, 0.020, -0.140),
    (7.33, 0.040, 0.038, -0.132),
    (7.18, 0.085, 0.080, -0.118),
    (6.96, 0.131, 0.124, -0.098),
    (6.70, 0.174, 0.165, -0.076),
    (6.41, 0.214, 0.202, -0.052),
    (6.12, 0.249, 0.236, -0.030),
    (5.82, 0.283, 0.267, -0.010),
    (5.51, 0.316, 0.298, 0.000),
    (5.20, 0.348, 0.305, 0.002),
    (4.85, 0.382, 0.322, 0.016),
    (4.45, 0.418, 0.336, 0.026),
    (4.05, 0.455, 0.348, 0.032),
    (3.65, 0.492, 0.356, 0.034),
    (3.25, 0.530, 0.362, 0.032),
    (2.90, 0.565, 0.366, 0.030),
    (2.60, 0.600, 0.380, 0.026),
    (2.25, 0.640, 0.408, 0.022),
    (1.85, 0.678, 0.428, 0.018),
    (1.35, 0.708, 0.440, 0.015),
    (0.75, 0.732, 0.448, 0.012),
    (0.05, 0.744, 0.452, 0.010),
    (-0.75, 0.746, 0.450, 0.008),
    (-1.55, 0.742, 0.446, 0.005),
    (-2.35, 0.732, 0.440, 0.002),
    (-3.15, 0.718, 0.432, 0.000),
    (-3.95, 0.700, 0.422, 0.000),
    (-4.65, 0.676, 0.410, 0.000),
    (-5.30, 0.646, 0.396, 0.000),
    (-5.85, 0.610, 0.382, 0.000),
    (-6.10, 0.545, 0.365, 0.000),
    (-6.28, 0.480, 0.352, 0.000),
    (-6.42, 0.420, 0.344, 0.000),
)
RADOME_END_Y = 5.20

# (x, leading-edge y, trailing-edge y, thickness ratio, centre z) for the right wing. The innermost
# station is buried deep in the fuselage (0.35 m against a hull that is 0.41 m wide at the nose end
# of the chord): the wing then leaves the skin along the hull's own silhouette instead of starting
# beside it and leaving an open slot at the root.
WING_SECTIONS = (
    (0.35, 2.95, -3.15, 0.066, 0.012),
    (0.65, 2.75, -3.10, 0.062, 0.015),
    (1.30, 2.45, -3.05, 0.055, 0.020),
    (2.10, 1.60, -3.32, 0.053, 0.050),
    (2.90, 0.60, -3.55, 0.051, 0.085),
    (3.50, -0.25, -3.66, 0.050, 0.110),
    (3.95, -0.95, -3.72, 0.049, 0.130),
    (4.20, -1.40, -3.74, 0.049, 0.140),
)
# The hinges follow the sweep of the outer wing, not of the buried root extension.
WING_SWEEP_SPANS = (1.30, 4.20)

# Leading-edge root extension. It is lofted along y, not along x: its inboard edge follows the hull
# width at every station, so the strake grows out of the fuselage instead of hanging beside it.
LERX_STATIONS = (
    (2.50, 1.30, 0.100),
    (2.90, 1.06, 0.092),
    (3.30, 0.90, 0.082),
    (3.70, 0.78, 0.070),
    (4.10, 0.68, 0.058),
    (4.50, 0.58, 0.048),
    (4.85, 0.50, 0.038),
)
LERX_BITE = 0.060
ELEVON_HINGE_OFFSET = 0.78
LEF_CUT_MAX = 0.34
LEF_START_X = 2.90
LEF_FULL_X = 3.24

# (x, leading-edge y, trailing-edge y, thickness ratio, centre z) for the right canard. Same rule as
# the wing: the first station is buried in the fuselage so no slot is left at the root.
CANARD_SECTIONS = (
    (0.35, 4.55, 3.05, 0.075, 0.095),
    (0.85, 4.35, 2.95, 0.070, 0.105),
    (1.45, 4.02, 2.72, 0.066, 0.135),
    (1.95, 3.70, 2.48, 0.062, 0.160),
    (2.30, 3.45, 2.20, 0.060, 0.175),
)
CANARD_SWEEP_SPANS = (0.85, 2.30)

# (z, leading-edge y, trailing-edge y, thickness ratio, x centre) for the vertical fin. The tip
# chord stays wider than the rudder hinge offset, or the hinge cut would run off the trailing edge.
FIN_SECTIONS = (
    (0.20, -3.20, -6.30, 0.055, 0.0),
    (0.95, -3.50, -6.10, 0.050, 0.0),
    (1.60, -3.90, -5.88, 0.046, 0.0),
    (2.10, -4.35, -5.68, 0.044, 0.0),
    (2.40, -4.75, -5.55, 0.044, 0.0),
)
RUDDER_HINGE_OFFSET = 0.68

# (z, leading-edge y, trailing-edge y, thickness ratio, x centre) for the ventral strakes.
STRAKE_SECTIONS = (
    (-0.05, -3.75, -5.35, 0.070, 0.40),
    (-0.50, -3.90, -5.25, 0.065, 0.56),
    (-0.88, -4.05, -5.15, 0.060, 0.68),
)

CANOPY_BOTTOM_INSET = 0.050
# A bubble, not a lid: the seat, the headrest and the instrument panel have to fit under it. The
# heights were raised after the old shell cut through the seat back and the head-up display.
CANOPY_STATIONS = (
    (5.10, 0.150, 0.055),
    (4.80, 0.295, 0.265),
    (4.42, 0.385, 0.430),
    (4.00, 0.425, 0.530),
    (3.60, 0.440, 0.575),
    (3.18, 0.420, 0.560),
    (2.90, 0.320, 0.360),
)
CANOPY_HINGE_Y = 2.92
CANOPY_OPEN_DEGREES = 30.0

INTAKE_STATIONS = (
    (4.55, 0.270, 0.240, 0.660, -0.115),
    (4.05, 0.275, 0.250, 0.700, -0.100),
    (3.55, 0.272, 0.252, 0.700, -0.065),
    (3.00, 0.265, 0.250, 0.680, -0.025),
    (2.50, 0.245, 0.238, 0.660, 0.010),
)

GEAR_PIVOT_NOSE = (0.0, 4.10, -0.400)
GEAR_STRUT_NOSE = (0.0, 4.30, -1.600)
GEAR_PIVOT_MAIN_X = 1.02
GEAR_PIVOT_MAIN_Y = -0.55
GEAR_PIVOT_MAIN_Z = -0.380
GEAR_STRUT_MAIN = (-0.28, -1.550)
WHEEL_NOSE = (0.0, 4.28, -1.740, 0.300, 0.150)
WHEEL_MAIN = (-0.320, -1.700, 0.365, 0.190)
# Lower skin of the wing root, measured from the airfoil rather than guessed: the gear bays and
# the belly panels have to sit on it.
WING_ROOT_LOWER_Z = -0.131

NOZZLE_Y = -6.40
NOZZLE_EXIT_Y = -6.80
NOZZLE_PETALS = 14

FILE_BUDGET_KIB = 700


# ---------------------------------------------------------------- geometry helpers


def smoothstep(value):
    t = max(0.0, min(1.0, value))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def resolve(value, span, chord):
    return value(span, chord) if callable(value) else value


def superellipse_ring(y, half_width, half_height, z_centre, points=RING_POINTS,
                      exponent=FUSELAGE_EXPONENT):
    ring = []
    for index in range(points):
        angle = 2.0 * math.pi * index / points
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        x = half_width * math.copysign(abs(cos_a) ** (2.0 / exponent), cos_a)
        z = z_centre + half_height * math.copysign(abs(sin_a) ** (2.0 / exponent), sin_a)
        ring.append((x, y, z))
    return ring


def loft_rings(rings, cap_start=True, cap_end=True):
    """Quads between consecutive rings of equal length, optionally closed with n-gon caps."""
    points = len(rings[0])
    vertices = []
    faces = []
    for ring in rings:
        assert len(ring) == points, "every loft ring needs the same point count"
        vertices.extend(ring)
    for station in range(len(rings) - 1):
        low = station * points
        high = (station + 1) * points
        for index in range(points):
            nxt = (index + 1) % points
            faces.append((low + index, low + nxt, high + nxt, high + index))
    if cap_start:
        faces.append(tuple(range(points - 1, -1, -1)))
    if cap_end:
        base = (len(rings) - 1) * points
        faces.append(tuple(range(base, base + points)))
    return vertices, faces


def airfoil_ring(y_le, chord, thickness_ratio, centre_z, camber=0.012, camber_pos=0.4,
                 n_side=9, x_start=0.0, x_end=1.0):
    """Closed NACA-style section in the y/z plane: leading edge at y_le, trailing edge at
    y_le - x_end * chord. A sub-range (x_start > 0 or x_end < 1) keeps the thickness of the full
    chord, which is what makes a flap cut out of a wing line up again."""
    def thickness(x):
        return 5.0 * thickness_ratio * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                                        + 0.2843 * x ** 3 - 0.1015 * x ** 4)

    def camber_line(x):
        m, p = camber, camber_pos
        if x < p:
            return m / (p * p) * (2.0 * p * x - x * x)
        return m / ((1.0 - p) ** 2) * ((1.0 - 2.0 * p) + 2.0 * p * x - x * x)

    grid = [lerp(x_start, x_end, 0.5 * (1.0 - math.cos(math.pi * i / n_side)))
            for i in range(n_side + 1)]
    upper = [(x, camber_line(x) + thickness(x)) for x in grid]
    lower = [(x, camber_line(x) - thickness(x)) for x in grid]
    section = upper + list(reversed(lower[1:-1]))
    return [(y_le - x * chord, centre_z + offset * chord) for (x, offset) in section]


def surface_rings(sections, axis, x_start=0.0, x_end=1.0, n_side=9, camber=0.012):
    """Loft rings for a lifting surface. axis x: chord along y, thickness in z (wing).
    axis z: chord along y, thickness in x (fin, strake). x_start and x_end may be callables
    taking (span, chord) so a hinge cut can sit at a fixed distance behind the leading edge."""
    rings = []
    for span, y_le, y_te, ratio, centre in sections:
        chord = y_le - y_te
        start = resolve(x_start, abs(span), chord)
        end = resolve(x_end, abs(span), chord)
        section = airfoil_ring(y_le, chord, ratio, centre, camber=camber, n_side=n_side,
                               x_start=start, x_end=end)
        if axis == "x":
            rings.append([(span, y, z) for (y, z) in section])
        else:
            rings.append([(x, y, span) for (y, x) in section])
    return rings


def tube_rings(path, radii, sides=10, flatten=1.0):
    """Rings around a polyline: struts, probes, missiles, frame ribs."""
    rings = []
    for index, point in enumerate(path):
        if index == 0:
            direction = Vector(path[1]) - Vector(path[0])
        elif index == len(path) - 1:
            direction = Vector(path[-1]) - Vector(path[-2])
        else:
            direction = Vector(path[index + 1]) - Vector(path[index - 1])
        direction.normalize()
        up = Vector((0.0, 0.0, 1.0))
        if abs(direction.dot(up)) > 0.94:
            up = Vector((0.0, 1.0, 0.0))
        side = direction.cross(up).normalized()
        normal = side.cross(direction).normalized()
        radius = radii[index]
        ring = []
        for step in range(sides):
            angle = 2.0 * math.pi * step / sides
            offset = side * (math.cos(angle) * radius) + normal * (math.sin(angle) * radius * flatten)
            ring.append(tuple(Vector(point) + offset))
        rings.append(ring)
    return rings


def box_rings(centre, size, axis="y"):
    """Axis-aligned box as two rings of four points, so it can go through the same loft."""
    cx, cy, cz = centre
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    if axis == "y":
        return [[(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
                 (cx + hx, cy - hy, cz + hz), (cx - hx, cy - hy, cz + hz)],
                [(cx - hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz - hz),
                 (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]]
    if axis == "x":
        return [[(cx - hx, cy - hy, cz - hz), (cx - hx, cy + hy, cz - hz),
                 (cx - hx, cy + hy, cz + hz), (cx - hx, cy - hy, cz + hz)],
                [(cx + hx, cy - hy, cz - hz), (cx + hx, cy + hy, cz - hz),
                 (cx + hx, cy + hy, cz + hz), (cx + hx, cy - hy, cz + hz)]]
    return [[(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
             (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz)],
            [(cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
             (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]]


def disc_rings(centre, radius, thickness, points=14):
    """Flat disc as two rings, for markings."""
    cx, cy, cz = centre
    lower = [(cx + math.cos(2.0 * math.pi * i / points) * radius,
              cy + math.sin(2.0 * math.pi * i / points) * radius, cz) for i in range(points)]
    upper = [(x, y, z + thickness) for (x, y, z) in lower]
    return [lower, upper]


def leaning_slab(bottom, top, half_width_bottom, half_width_top, thickness):
    """Two rectangles at different heights and stations, so a seat back or an instrument panel can
    lean without rotating the object. `bottom` and `top` are (y, z); the slab is `thickness` deep."""
    def ring(y, z, half_width):
        half = thickness * 0.5
        return [(-half_width, y - half, z), (half_width, y - half, z),
                (half_width, y + half, z), (-half_width, y + half, z)]
    return [ring(bottom[0], bottom[1], half_width_bottom),
            ring(top[0], top[1], half_width_top)]


def wheel_rings(centre, radius, width):
    """Tyre as a loft along x with rounded shoulders."""
    cx, cy, cz = centre
    profile = ((-0.5, 0.78), (-0.5, 0.97), (-0.36, 1.0), (0.36, 1.0), (0.5, 0.97), (0.5, 0.78))
    rings = []
    for offset, ratio in profile:
        x = cx + offset * width
        rings.append([(x, cy + math.cos(2.0 * math.pi * i / 16) * radius * ratio,
                       cz + math.sin(2.0 * math.pi * i / 16) * radius * ratio) for i in range(16)])
    return rings


def fuselage_station(y):
    """Half width, half height and centre height of the fuselage at one station."""
    table = FUSELAGE
    if y >= table[0][0]:
        return table[0][1], table[0][2], table[0][3]
    if y <= table[-1][0]:
        return table[-1][1], table[-1][2], table[-1][3]
    for index in range(len(table) - 1):
        high, low = table[index], table[index + 1]
        if low[0] <= y <= high[0]:
            t = (y - low[0]) / (high[0] - low[0])
            return tuple(lerp(low[axis], high[axis], t) for axis in (1, 2, 3))
    return table[-1][1], table[-1][2], table[-1][3]


def fuselage_half_width(y):
    return fuselage_station(y)[0]


def fuselage_skin_z(x, y, upper=True):
    """Height of the fuselage skin at a point beside the centreline. The cross section is a
    superellipse, so a panel placed at the centreline's height floats above the skin further out -
    which is what left loose plates hanging over the wing root."""
    half_width, half_height, centre = fuselage_station(y)
    ratio = min(0.999, abs(x) / half_width)
    offset = half_height * (1.0 - ratio ** FUSELAGE_EXPONENT) ** (1.0 / FUSELAGE_EXPONENT)
    return centre + (offset if upper else -offset)


def fuselage_top(y):
    return fuselage_skin_z(0.0, y, upper=True)


def fuselage_skin_x(z, y):
    """Half width of the fuselage at a given height, for trim mounted on the side. Laying a probe
    or an antenna at a fixed x is what left parts hovering a third of a metre beside the nose."""
    half_width, half_height, centre = fuselage_station(y)
    ratio = min(0.999, abs(z - centre) / half_height)
    return half_width * (1.0 - ratio ** FUSELAGE_EXPONENT) ** (1.0 / FUSELAGE_EXPONENT)


def section_at(sections, span):
    if span <= sections[0][0]:
        return tuple(sections[0][1:])
    if span >= sections[-1][0]:
        return tuple(sections[-1][1:])
    for index in range(len(sections) - 1):
        low, high = sections[index], sections[index + 1]
        if low[0] <= span <= high[0]:
            t = (span - low[0]) / (high[0] - low[0])
            return tuple(lerp(low[i + 1], high[i + 1], t) for i in range(4))
    return tuple(sections[-1][1:])


def fuselage_bottom(y):
    return fuselage_skin_z(0.0, y, upper=False)


def wing_upper_z(span, y, camber=0.012, camber_pos=0.4):
    """Height of a wing's upper skin at one point, so decals land on the surface."""
    return _wing_skin_z(span, y, 1.0, camber, camber_pos)


def _wing_skin_z(span, y, side, camber, camber_pos):
    y_le, y_te, ratio, centre = section_at(WING_SECTIONS, abs(span))
    chord = y_le - y_te
    x = min(0.97, max(0.03, (y_le - y) / chord))
    thickness = 5.0 * ratio * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                               + 0.2843 * x ** 3 - 0.1015 * x ** 4)
    if x < camber_pos:
        line = camber / (camber_pos * camber_pos) * (2.0 * camber_pos * x - x * x)
    else:
        line = camber / ((1.0 - camber_pos) ** 2) * ((1.0 - 2.0 * camber_pos)
                                                     + 2.0 * camber_pos * x - x * x)
    return centre + side * (line + thickness) * chord


def hinge_sweep_degrees(sections, span_a=None, span_b=None):
    """Direction of a hinge line, measured on the outer wing so a buried root station cannot tilt
    every control surface."""
    if span_a is None or span_b is None:
        span_a, span_b = sections[0][0], sections[-1][0]
    y_a = section_at(sections, span_a)[0]
    y_b = section_at(sections, span_b)[0]
    return math.degrees(math.atan2(y_b - y_a, span_b - span_a))


def lef_recess(span):
    """How far the wing box is cut back behind the leading-edge flap."""
    if span <= LEF_START_X:
        return 0.0
    if span >= LEF_FULL_X:
        return LEF_CUT_MAX
    return LEF_CUT_MAX * smoothstep((span - LEF_START_X) / (LEF_FULL_X - LEF_START_X))


# ---------------------------------------------------------------- materials


MATERIALS = {}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATERIALS.clear()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = 1
    scene.unit_settings.system = "METRIC"


def material(name, colour, roughness, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0,
             texture=None):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    # Single sided on purpose: every part of this model is a closed volume, and the iGPU pays for
    # double-sided fill on every pixel it draws.
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if texture is not None:
        # Only a direct Principled connection survives the glTF export: a texture on Base Color
        # becomes baseColorTexture, anything fancier is dropped without a warning. The factor
        # itself is the texture's mid grey, so the paint keeps the tone mapped darkness the other
        # packs are authored with instead of washing the shape out.
        image_node = nodes.new("ShaderNodeTexImage")
        image_node.image = texture
        image_node.location = (-360.0, 220.0)
        mat.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    MATERIALS[name] = mat
    return mat


def build_skin_texture():
    """Paint one seamless grey skin map: mottling, panel lines, rivets and access panels.

    Every pattern is periodic over the tile, so the box projection can wrap anywhere without a
    seam. Values are written as the sRGB display values the PNG will hold, which is also what the
    renderer sees before tone mapping.
    """
    size = TEXTURE_SIZE
    generator = random.Random(4117)
    panels = size // PANEL_PIXELS
    # Coarse mottle, one value per 16 px cell, wrapped so the tile stays seamless.
    cell = 16
    cells = size // cell
    mottle = [[generator.uniform(-0.028, 0.028) for _ in range(cells)] for _ in range(cells)]
    blotch = [[generator.uniform(-0.018, 0.018) for _ in range(cells // 4)] for _ in range(cells // 4)]
    # A few access panels: (x, y, width, height) in pixels, inset so no panel crosses the seam.
    access = []
    for _ in range(7):
        width = generator.randrange(2, 5) * PANEL_PIXELS
        height = generator.randrange(1, 3) * PANEL_PIXELS
        access.append((generator.randrange(6, size - width - 6), generator.randrange(6, size - height - 6),
                       width, height))
    line_jitter = [generator.randrange(-3, 4) for _ in range(panels)]
    columns = [index * PANEL_PIXELS + line_jitter[index] for index in range(panels)]
    rows = [index * PANEL_PIXELS + line_jitter[(index * 3) % panels] for index in range(panels)]

    def near_line(value, lines):
        for line in lines:
            if abs(value - line) <= 1:
                return True
        return False

    def wrapped_row(values, index):
        return values[index % len(values)]

    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        row_cells = (y // cell) % cells
        blotch_row = (y // (cell * 4)) % (cells // 4)
        on_row = near_line(y, rows)
        for x in range(size):
            value = 0.545
            value += mottle[row_cells][(x // cell) % cells]
            value += blotch[blotch_row][(x // (cell * 4)) % (cells // 4)]
            on_column = near_line(x, columns)
            if on_row or on_column:
                value = 0.442
            # Rivets sit on the panel lines, spaced so they tile as well.
            if (on_row or on_column) and (x % RIVET_PIXELS < 1) and (y % RIVET_PIXELS < 1):
                value = 0.418
            for (px, py, width, height) in access:
                inside = px <= x < px + width and py <= y < py + height
                edge = inside and (x in (px, px + width - 1) or y in (py, py + height - 1))
                if edge:
                    value = 0.466
                elif inside:
                    value += 0.010
            # Faint dirt streaks running along the tile's v axis, like airflow staining.
            streak = ((x * 7 + 13) % 97)
            if streak < 4:
                value -= 0.010
            index = (y * size + x) * 4
            pixels[index] = min(1.0, max(0.0, value))
            pixels[index + 1] = min(1.0, max(0.0, value * 1.004))
            pixels[index + 2] = min(1.0, max(0.0, value * 1.012))
            pixels[index + 3] = 1.0
    image = bpy.data.images.new(TEXTURE_NAME, size, size, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.file_format = "PNG"
    image.pixels.foreach_set(pixels)
    image.pack()
    _ = wrapped_row
    return image


def make_materials(texture):
    # Dark base colours on purpose: the renderer tone maps the scene and a bright hull washes the
    # shape out. Emission stays well under 2 or the tone mapping turns the glow white.
    material("JetSkin", (1.0, 1.0, 1.0), 0.480, 0.180, texture=texture)
    material("JetFrame", (0.070, 0.072, 0.078), 0.520, 0.400)
    material("JetRadome", (0.070, 0.072, 0.076), 0.620, 0.080)
    material("JetAntiGlare", (0.038, 0.039, 0.042), 0.760, 0.040)
    material("JetMetal", (0.300, 0.310, 0.325), 0.320, 0.900)
    material("JetExhaust", (0.105, 0.098, 0.092), 0.440, 0.850)
    material("JetDuct", (0.016, 0.017, 0.019), 0.820, 0.150)
    material("JetCockpit", (0.032, 0.033, 0.036), 0.780, 0.100)
    material("JetScreen", (0.014, 0.020, 0.024), 0.320, 0.000,
             emission=(0.100, 0.420, 0.500), emission_strength=0.550)
    material("JetGlass", (0.030, 0.038, 0.052), 0.090, 0.000, alpha=0.420)
    material("JetTire", (0.020, 0.020, 0.021), 0.930, 0.050)
    material("JetInsigniaBlue", (0.030, 0.060, 0.190), 0.520, 0.050)
    material("JetInsigniaWhite", (0.400, 0.410, 0.420), 0.520, 0.050)
    material("JetInsigniaRed", (0.320, 0.030, 0.035), 0.520, 0.050)
    material("JetMarkingYellow", (0.420, 0.320, 0.045), 0.560, 0.050)
    material("JetLightRed", (0.040, 0.010, 0.010), 0.400, 0.000,
             emission=(0.900, 0.070, 0.040), emission_strength=0.900)
    material("JetLightGreen", (0.010, 0.040, 0.012), 0.400, 0.000,
             emission=(0.090, 0.900, 0.160), emission_strength=0.900)
    material("JetLightWhite", (0.050, 0.050, 0.050), 0.400, 0.000,
             emission=(0.900, 0.870, 0.760), emission_strength=0.700)
    material("JetBurner", (0.045, 0.030, 0.075), 0.500, 0.000,
             emission=(0.320, 0.230, 0.950), emission_strength=1.600)


# ---------------------------------------------------------------- part builder


class Part:
    """Collects world-space geometry, then builds one object whose origin is its hinge.

    `rotation_degrees` is the object's base orientation, for a hinge that is not parallel to an
    axis (the swept elevon, flap and canard hinges). The mesh is written in that rotated local
    frame, so the object sits exactly where the world coordinates say while its local x axis is
    the hinge line - keyframing rotation_euler.x then deflects the surface about its own hinge.
    """

    def __init__(self, name, pivot=(0.0, 0.0, 0.0), rotation_degrees=(0.0, 0.0, 0.0)):
        self.name = name
        self.pivot = Vector(pivot)
        self.rotation_degrees = tuple(rotation_degrees)
        self.rotation = Euler([math.radians(value) for value in rotation_degrees], "XYZ")
        self.vertices = []
        self.faces = []

    def add(self, vertices, faces, material_name):
        base = len(self.vertices)
        self.vertices.extend(tuple(vertex) for vertex in vertices)
        for face in faces:
            self.faces.append((tuple(base + index for index in face), material_name))

    def add_loft(self, rings, material_name, cap_start=True, cap_end=True):
        vertices, faces = loft_rings(rings, cap_start=cap_start, cap_end=cap_end)
        self.add(vertices, faces, material_name)

    def add_box(self, centre, size, material_name, axis="y"):
        self.add_loft(box_rings(centre, size, axis=axis), material_name)

    def add_tube(self, path, radii, material_name, sides=10, flatten=1.0):
        self.add_loft(tube_rings(path, radii, sides=sides, flatten=flatten), material_name)

    def build(self, parent=None, tone="skin"):
        assert self.vertices, f"{self.name} has no geometry"
        mesh = bpy.data.meshes.new(f"{self.name}_mesh")
        inverse = self.rotation.to_matrix().inverted()
        mesh.from_pydata([tuple(inverse @ (Vector(vertex) - self.pivot))
                          for vertex in self.vertices], [],
                         [list(face) for face, _ in self.faces])
        assert len(mesh.polygons) == len(self.faces), \
            f"{self.name}: {len(mesh.polygons)} polygons for {len(self.faces)} faces"
        used = []
        for _, material_name in self.faces:
            if material_name not in used:
                used.append(material_name)
        for material_name in used:
            mesh.materials.append(MATERIALS[material_name])
        for polygon, (_, material_name) in zip(mesh.polygons, self.faces):
            polygon.material_index = used.index(material_name)
            polygon.use_smooth = True
        finalize_mesh(mesh)
        project_skin_uvs(mesh, self.vertices, self.rotation)
        write_vertex_tone(mesh, self.rotation, tone)
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = self.pivot
        obj.rotation_euler = self.rotation
        bpy.context.collection.objects.link(obj)
        if parent is not None:
            attach(obj, parent)
        return obj


def project_skin_uvs(mesh, world_vertices, rotation):
    """Box-project the tileable skin map onto a part.

    One atlas serves the whole model, so every part projects by its own face orientation: the map
    repeats every TEXTURE_METRES_PER_TILE metres of surface, which is what turns a 64 px panel line
    into a panel about a metre wide on the fuselage. The three axes get different offsets so the
    projections do not line up into one obvious grid.
    """
    scale = 1.0 / TEXTURE_METRES_PER_TILE
    matrix = rotation.to_matrix()
    layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = matrix @ polygon.normal
        axis = max(range(3), key=lambda index: abs(normal[index]))
        for corner, loop in enumerate(polygon.loop_indices):
            world = world_vertices[polygon.vertices[corner]]
            if axis == 0:
                uv = (world[1] * scale + 0.13, world[2] * scale + 0.29)
            elif axis == 1:
                uv = (world[0] * scale + 0.47, world[2] * scale + 0.61)
            else:
                uv = (world[0] * scale + 0.83, world[1] * scale + 0.17)
            layer.data[loop].uv = uv


def write_vertex_tone(mesh, rotation, tone):
    """Write the two-tone livery into COLOR_0: the underside of an aircraft is the darker surface,
    and the glTF loader multiplies this layer onto the painted map."""
    if tone == "flat":
        return
    matrix = rotation.to_matrix()
    tones = []
    for normal in mesh.vertex_normals:
        up = 0.5 * (matrix @ normal.vector).z + 0.5
        tones.append(round(lerp(0.80, 1.0, smoothstep(up)), 4))
    if all(value > 0.999 for value in tones):
        return
    layer = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    flat = []
    for value in tones:
        flat.extend((value, value, value, 1.0))
    layer.data.foreach_set("color", flat)
    mesh.color_attributes.active_color_index = len(mesh.color_attributes) - 1
    mesh.color_attributes.render_color_index = len(mesh.color_attributes) - 1


def attach(child, parent):
    """Parent without moving the child. `matrix_world` is only valid after a view layer
    update, and a stale identity there is what silently displaced the wheels once."""
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def finalize_mesh(mesh, sharp_degrees=37.0):
    """Outward normals, and sharp edges wherever two faces meet at a steep angle."""
    threshold = math.radians(sharp_degrees)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            edge.smooth = edge.calc_face_angle(0.0) < threshold
        else:
            edge.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


# ---------------------------------------------------------------- airframe


def build_airframe(parent):
    part = Part("jet_airframe")

    radome = [superellipse_ring(y, hw, hh, zc) for (y, hw, hh, zc) in FUSELAGE if y >= RADOME_END_Y]
    body = [superellipse_ring(y, hw, hh, zc) for (y, hw, hh, zc) in FUSELAGE if y <= RADOME_END_Y]
    part.add_loft(radome, "JetRadome", cap_start=True, cap_end=False)
    part.add_loft(body, "JetSkin", cap_start=False, cap_end=True)

    for sign in (-1, 1):
        # Wing box: full-chord sections, cut back at the leading edge for the flap and at the
        # trailing edge for the elevon, so both control surfaces continue the same airfoil.
        sections = [(sign * span, y_le, y_te, ratio, centre)
                    for (span, y_le, y_te, ratio, centre) in WING_SECTIONS]
        part.add_loft(surface_rings(
            sections, "x",
            x_start=lambda span, chord: lef_recess(span) / chord,
            x_end=lambda span, chord: 1.0 - ELEVON_HINGE_OFFSET / chord), "JetSkin")
        build_lerx(part, sign)
        strakes = [(sign * s[4], s[1], s[2], s[3], 0.0) for s in STRAKE_SECTIONS]
        part.add_loft(surface_rings(strakes, "z", camber=0.0), "JetSkin")

    part.add_loft(surface_rings(
        FIN_SECTIONS, "z", camber=0.010,
        x_end=lambda span, chord: max(0.10, 1.0 - RUDDER_HINGE_OFFSET / chord)), "JetSkin")

    for sign in (-1, 1):
        build_intake(part, sign)

    # Gun fairing on the left shoulder with its dark muzzle, sitting on the curved shoulder.
    fairing_z = fuselage_skin_z(-0.30, 4.95) + 0.030
    part.add_box((-0.30, 4.95, fairing_z), (0.32, 1.50, 0.170), "JetSkin")
    part.add_tube([(-0.30, 5.55, fairing_z + 0.052), (-0.30, 5.88, fairing_z + 0.040)],
                  (0.055, 0.048), "JetDuct", sides=8)
    # Anti-glare shield in front of the windscreen: the one large dark panel of the livery.
    glare = []
    for y in (5.05, 5.50, 5.95, 6.35):
        top = fuselage_top(y)
        half = lerp(0.215, 0.130, (y - 5.05) / 1.30)
        glare.append([(half, y, top - 0.010), (-half, y, top - 0.010),
                      (-half, y, top + 0.012), (half, y, top + 0.012)])
    part.add_loft(glare, "JetAntiGlare")
    # Access panels: thin raised plates that break the outline without costing a draw call. Every
    # one of them sits on the skin at its own station - the outboard pair used to float 17 cm above
    # a hull that curves away from the centreline.
    for x, y, size in ((0.0, 0.05, (0.46, 1.40, 0.016)),
                       (0.0, -2.30, (0.52, 1.10, 0.016)),
                       (0.0, -1.10, (0.60, 1.60, 0.016)),
                       (0.62, 1.30, (0.30, 1.20, 0.014)),
                       (-0.62, 1.30, (0.30, 1.20, 0.014)),
                       (0.0, 5.75, (0.44, 0.90, 0.014))):
        upper = y > -0.6
        centre_z = fuselage_skin_z(x, y, upper=upper)
        part.add_box((x, y, centre_z + (0.004 if upper else -0.004)), size, "JetSkin")
    # No gear bays: a bay only reads as a recess if the skin above it has a hole, and an axis
    # aligned box laid on the curved lower skin showed up as a black patch from below instead.
    # The dark inner face of each door carries the look when a door is open.
    # Pylon bodies are part of the airframe; the stores below them are their own nodes.
    for sign in (-1, 1):
        span = 2.72
        section = section_at(WING_SECTIONS, span)
        part.add_box((sign * span, -1.10, section[3] - 0.155), (0.24, 1.10, 0.330), "JetSkin")
    return part.build(parent)


def build_lerx(part, sign):
    """Leading-edge root extension as a strake that grows out of the hull.

    Lofted along y with a four point section per station: the inboard edge sits LERX_BITE inside the
    fuselage skin at that station, the outboard edge is the sharp strake the planform shows, and the
    section tapers so the outer edge stays thin. Lofting it along x instead - a fixed inboard edge -
    left the front of the strake floating beside a hull that narrows towards the nose.
    """
    rings = []
    for index, (y, outer, thickness) in enumerate(LERX_STATIONS):
        inner = max(0.18, fuselage_half_width(y) - LERX_BITE)
        z = lerp(0.032, 0.018, index / (len(LERX_STATIONS) - 1))
        rings.append([(sign * inner, y, z + thickness * 0.5),
                      (sign * outer, y, z + thickness * 0.18),
                      (sign * outer, y, z - thickness * 0.18),
                      (sign * inner, y, z - thickness * 0.5)])
    part.add_loft(rings, "JetSkin")


def build_intake(part, sign):
    outer = []
    inner = []
    for y, half_width, half_height, x_centre, z_centre in INTAKE_STATIONS:
        outer.append([(sign * x, y, z)
                      for (x, z) in rounded_ring(half_width, half_height, x_centre, z_centre)])
        inner.append([(sign * x, y, z)
                      for (x, z) in rounded_ring(half_width - 0.055, half_height - 0.055,
                                                 x_centre, z_centre)])
    part.add_loft(outer, "JetSkin", cap_start=False, cap_end=True)
    part.add_loft(inner[:4], "JetDuct", cap_start=False, cap_end=True)
    lip = []
    for index in range(len(outer[0])):
        lip.append(outer[0][index])
        lip.append(inner[0][index])
    faces = []
    for index in range(len(outer[0])):
        nxt = (index + 1) % len(outer[0])
        faces.append((index * 2, nxt * 2, nxt * 2 + 1, index * 2 + 1))
    part.add(lip, faces, "JetSkin")
    # Yellow warning band around the intake mouth, the colour a ground crew looks for. It is a flat
    # ring in the mouth plane, so it stays visible without closing the duct.
    half_width, half_height, x_centre, z_centre = INTAKE_STATIONS[0][1:]
    ring_y = INTAKE_STATIONS[0][0] - 0.003
    warning = [[(sign * x, ring_y, z)
                for (x, z) in rounded_ring(half_width * scale, half_height * scale,
                                           x_centre, z_centre)]
               for scale in (1.060, 1.008)]
    part.add_loft(warning, "JetMarkingYellow", cap_start=False, cap_end=False)
    part.add_box((sign * 0.420, 3.95, -0.150), (0.028, 1.15, 0.420), "JetSkin")


def rounded_ring(half_width, half_height, x_centre, z_centre, points=12):
    ring = []
    for index in range(points):
        angle = 2.0 * math.pi * index / points
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        x = half_width * math.copysign(abs(cos_a) ** (2.0 / 3.0), cos_a)
        z = half_height * math.copysign(abs(sin_a) ** (2.0 / 3.0), sin_a)
        ring.append((x_centre + x, z_centre + z))
    return ring


# ---------------------------------------------------------------- moving surfaces


def build_control_surface(name, sections, axis, x_start, x_end, pivot, sweep_degrees, camber):
    part = Part(name, pivot, (0.0, 0.0, sweep_degrees))
    part.add_loft(surface_rings(sections, axis, x_start=x_start, x_end=x_end, camber=camber),
                  "JetSkin")
    obj = part.build()
    return obj


def build_elevon(parent, sign):
    sections = [(sign * span, y_le, y_te, ratio, centre)
                for (span, y_le, y_te, ratio, centre) in WING_SECTIONS if span >= 1.80]
    reference = section_at(WING_SECTIONS, 2.80)
    pivot = (0.0, reference[1] + ELEVON_HINGE_OFFSET, reference[3])
    sweep = hinge_sweep_degrees(WING_SECTIONS, *WING_SWEEP_SPANS)
    obj = build_control_surface(
        "elevon_right" if sign > 0 else "elevon_left", sections, "x",
        x_start=lambda span, chord: 1.0 - ELEVON_HINGE_OFFSET / chord - 0.06,
        x_end=1.0, pivot=pivot, sweep_degrees=sweep if sign > 0 else 180.0 - sweep,
        camber=0.012)
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def build_lef(parent, sign):
    sections = [(sign * span, y_le, y_te, ratio, centre)
                for (span, y_le, y_te, ratio, centre) in WING_SECTIONS if span >= LEF_START_X]
    reference = section_at(WING_SECTIONS, 3.10)
    pivot = (0.0, reference[1] - lef_recess(3.10) * 0.5, reference[3])
    sweep = hinge_sweep_degrees(WING_SECTIONS, *WING_SWEEP_SPANS)
    obj = build_control_surface(
        "lef_right" if sign > 0 else "lef_left", sections, "x", x_start=0.0,
        x_end=lambda span, chord: (lef_recess(span) + 0.020) / chord, pivot=pivot,
        sweep_degrees=sweep if sign > 0 else 180.0 - sweep, camber=0.012)
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def build_canard(parent, sign):
    sections = [(sign * span, y_le, y_te, ratio, centre)
                for (span, y_le, y_te, ratio, centre) in CANARD_SECTIONS]
    reference = section_at(CANARD_SECTIONS, 1.60)
    pivot = (0.0, reference[0] - 0.55, reference[2])
    sweep = hinge_sweep_degrees(CANARD_SECTIONS, *CANARD_SWEEP_SPANS)
    obj = build_control_surface(
        "canard_right" if sign > 0 else "canard_left", sections, "x", x_start=0.0, x_end=1.0,
        pivot=pivot, sweep_degrees=sweep if sign > 0 else 180.0 - sweep, camber=0.014)
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def build_rudder(parent):
    sections = [(z, y_le, y_te, ratio, centre)
                for (z, y_le, y_te, ratio, centre) in FIN_SECTIONS]
    reference = section_at(FIN_SECTIONS, 1.60)
    pivot = (0.0, reference[1] + RUDDER_HINGE_OFFSET, 0.60)
    obj = build_control_surface(
        "rudder", sections, "z",
        x_start=lambda span, chord: max(0.02, 1.0 - RUDDER_HINGE_OFFSET / chord - 0.06),
        x_end=1.0, pivot=pivot, sweep_degrees=0.0, camber=0.010)
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def build_canopy(parent):
    hinge_z = fuselage_top(CANOPY_HINGE_Y) - CANOPY_BOTTOM_INSET
    part = Part("canopy", (0.0, CANOPY_HINGE_Y, hinge_z))
    rings = []
    for y, half_width, height in CANOPY_STATIONS:
        bottom = fuselage_top(y) - CANOPY_BOTTOM_INSET
        ring = []
        for index in range(20):
            angle = math.pi * index / 19.0
            ring.append((half_width * math.cos(angle), y, bottom + height * math.sin(angle)))
        rings.append(ring)
    part.add_loft(rings, "JetGlass")
    for sign in (-1, 1):
        sill = [(sign * half_width, y, fuselage_top(y) - CANOPY_BOTTOM_INSET)
                for (y, half_width, _) in CANOPY_STATIONS]
        part.add_tube(sill, (0.040,) * len(sill), "JetFrame", sides=6)
    bow = []
    y, half_width, height = CANOPY_STATIONS[0]
    bottom = fuselage_top(y) - CANOPY_BOTTOM_INSET
    for index in range(11):
        angle = math.pi * index / 10.0
        bow.append((half_width * math.cos(angle) * 1.02, y,
                    bottom + height * math.sin(angle) * 1.02))
    part.add_tube(bow, (0.034,) * len(bow), "JetFrame", sides=6)
    # Rear arch, so the canopy edge is a frame and not bare glass.
    rear = []
    y, half_width, height = CANOPY_STATIONS[-1]
    bottom = fuselage_top(y) - CANOPY_BOTTOM_INSET
    for index in range(11):
        angle = math.pi * index / 10.0
        rear.append((half_width * math.cos(angle) * 1.02, y,
                     bottom + height * math.sin(angle) * 1.02))
    part.add_tube(rear, (0.030,) * len(rear), "JetFrame", sides=6)
    obj = part.build(parent, tone="flat")
    return obj


def canopy_inner_top(y):
    """Height of the inside of the canopy shell at one station, for fitting the cockpit."""
    stations = CANOPY_STATIONS
    if y <= stations[-1][0]:
        half_width, height = stations[-1][1], stations[-1][2]
    elif y >= stations[0][0]:
        half_width, height = stations[0][1], stations[0][2]
    else:
        half_width, height = stations[0][1], stations[0][2]
        for index in range(len(stations) - 1):
            low, high = stations[index + 1], stations[index]
            if low[0] <= y <= high[0]:
                t = (y - low[0]) / (high[0] - low[0])
                half_width = lerp(low[1], high[1], t)
                height = lerp(low[2], high[2], t)
                break
    return fuselage_top(y) - CANOPY_BOTTOM_INSET + height


def build_cockpit(parent):
    """Seat, consoles, instrument panel and head-up display, fitted inside the canopy shell.

    Every piece that stands up is checked against the shell above it: the earlier cockpit pushed its
    seat back and its head-up display straight through the glass, which only a close-up showed.
    """
    part = Part("jet_cockpit_interior_noshadow_nocol")
    deck = fuselage_top(3.70) - CANOPY_BOTTOM_INSET
    fits = []

    # Floor and side consoles: a dark tub over the light fuselage deck, so the lit skin does not
    # shine up through the glass. It stops short of the canopy's rear edge, where the shell closes.
    part.add_box((0.0, 3.85, deck + 0.010), (0.62, 1.60, 0.030), "JetCockpit")
    for sign in (-1, 1):
        part.add_box((sign * 0.30, 3.85, deck + 0.100), (0.16, 1.30, 0.120), "JetCockpit")
        part.add_box((sign * 0.30, 4.05, deck + 0.172), (0.11, 0.30, 0.020), "JetScreen")

    # Ejection seat: pan, survival kit under it, a leaning back with side rails, and the headrest.
    part.add_box((0.0, 3.62, deck + 0.109), (0.46, 0.60, 0.100), "JetCockpit")
    part.add_box((0.0, 3.50, deck + 0.049), (0.40, 0.34, 0.100), "JetCockpit")
    part.add_loft(leaning_slab((3.56, deck + 0.149), (3.30, deck + 0.419), 0.215, 0.185, 0.170),
                  "JetCockpit")
    for sign in (-1, 1):
        part.add_loft(leaning_slab((3.58, deck + 0.159), (3.34, deck + 0.379), 0.022, 0.020, 0.240),
                      "JetMetal")
    part.add_box((0.0, 3.28, deck + 0.459), (0.38, 0.17, 0.100), "JetCockpit")
    part.add_tube([(0.0, 3.20, deck + 0.539), (0.0, 3.24, deck + 0.369)], (0.030, 0.030),
                  "JetMetal", sides=6)
    fits.append((3.30, deck + 0.419))
    fits.append((3.28, deck + 0.509))

    # Instrument panel under the windscreen, with its coaming and two screens.
    part.add_loft(leaning_slab((4.44, deck + 0.059), (4.26, deck + 0.319), 0.250, 0.215, 0.090),
                  "JetCockpit")
    part.add_box((0.0, 4.32, deck + 0.344), (0.46, 0.22, 0.050), "JetDuct")
    for sign in (-1, 1):
        part.add_loft(leaning_slab((4.42, deck + 0.119), (4.34, deck + 0.229), 0.085, 0.080, 0.030),
                      "JetScreen")
    fits.append((4.32, deck + 0.369))

    # Head-up display: two posts, a frame and the glass, all clear of the canopy.
    for sign in (-1, 1):
        part.add_tube([(sign * 0.145, 4.28, deck + 0.299), (sign * 0.140, 4.06, deck + 0.399)],
                      (0.020, 0.018), "JetFrame", sides=6)
    part.add_loft(leaning_slab((4.10, deck + 0.404), (4.02, deck + 0.434), 0.150, 0.150, 0.030),
                  "JetFrame")
    part.add_loft(leaning_slab((4.08, deck + 0.289), (4.02, deck + 0.414), 0.135, 0.135, 0.020),
                  "JetGlass")
    fits.append((4.02, deck + 0.434))

    # Control stick and throttle quadrant.
    part.add_tube([(0.0, 3.98, deck + 0.089), (0.0, 3.96, deck + 0.239)], (0.026, 0.022),
                  "JetMetal", sides=6)
    part.add_box((0.0, 3.96, deck + 0.269), (0.090, 0.110, 0.070), "JetCockpit")
    fits.append((3.96, deck + 0.304))
    part.add_box((-0.27, 3.85, deck + 0.159), (0.075, 0.240, 0.050), "JetCockpit")
    part.add_tube([(-0.27, 3.80, deck + 0.184), (-0.27, 3.72, deck + 0.224)], (0.018, 0.012),
                  "JetMetal", sides=6)

    for y, top in fits:
        limit = canopy_inner_top(y) - 0.020
        assert top <= limit, \
            f"cockpit part at y={y:.2f} reaches {top:.3f}, canopy inner skin is {limit:.3f}"
    return part.build(parent, tone="flat")


def build_speed_brake(parent):
    part = Part("speed_brake", (0.0, 2.28, 0.585))
    part.add_loft([[(0.20, 2.28, 0.585), (-0.20, 2.28, 0.585), (-0.20, 2.28, 0.650),
                    (0.20, 2.28, 0.650)],
                   [(0.175, 1.42, 0.585), (-0.175, 1.42, 0.585), (-0.175, 1.42, 0.640),
                    (0.175, 1.42, 0.640)]], "JetSkin")
    part.add_tube([(0.0, 2.30, 0.585), (0.0, 2.10, 0.590)], (0.055, 0.055), "JetMetal", sides=6)
    return part.build(parent)


def build_refuel_probe(parent):
    part = Part("refuel_probe", (0.0, 0.0, 0.0))
    housing_x = fuselage_skin_x(0.150, 4.62) - 0.040
    probe_x = fuselage_skin_x(0.180, 5.05) - 0.020
    part.add_tube([(probe_x, 5.05, 0.180), (probe_x - 0.02, 5.80, 0.205),
                   (probe_x - 0.06, 6.35, 0.220)], (0.075, 0.058, 0.030), "JetMetal", sides=8)
    part.add_box((housing_x, 4.62, 0.150), (0.22, 0.62, 0.150), "JetSkin")
    return part.build(parent, tone="flat")


def build_nozzle(parent):
    petals = Part("nozzle_petals", (0.0, NOZZLE_EXIT_Y, 0.0))
    rings = []
    for y, radius in ((NOZZLE_Y, 0.365), (NOZZLE_EXIT_Y, 0.312)):
        ring = []
        for index in range(NOZZLE_PETALS * 4):
            angle = 2.0 * math.pi * index / (NOZZLE_PETALS * 4)
            ring.append((math.cos(angle) * radius, y, math.sin(angle) * radius))
        rings.append(ring)
    petals.add_loft(rings, "JetExhaust", cap_start=True, cap_end=False)
    petals.add_tube([(0.0, NOZZLE_Y + 0.10, 0.0), (0.0, NOZZLE_EXIT_Y - 0.24, 0.0)],
                    (0.318, 0.282), "JetDuct", sides=16)
    petals_obj = petals.build(parent, tone="flat")
    petals_obj.scale = (0.92, 0.96, 0.92)

    flame = Part("afterburner_noshadow_nocol", (0.0, NOZZLE_EXIT_Y, 0.0))
    flame.add_tube([(0.0, NOZZLE_EXIT_Y, 0.0), (0.0, NOZZLE_EXIT_Y - 1.30, 0.0),
                    (0.0, NOZZLE_EXIT_Y - 2.20, 0.0)],
                   (0.275, 0.180, 0.030), "JetBurner", sides=14)
    flame.add_tube([(0.0, NOZZLE_EXIT_Y - 0.08, 0.0), (0.0, NOZZLE_EXIT_Y - 1.00, 0.0)],
                   (0.160, 0.020), "JetBurner", sides=10)
    flame_obj = flame.build(parent, tone="flat")
    flame_obj.scale = (0.278, 0.05, 0.278)
    return petals_obj, flame_obj


def build_gear(parent, label, pivot, strut_end, wheel, door, mirror):
    gear = Part(f"gear_{label}", pivot)
    gear.add_tube([(pivot[0], pivot[1], pivot[2] + 0.03), strut_end],
                  (0.085, 0.070), "JetMetal", sides=8)
    gear.add_tube([(pivot[0], pivot[1] + 0.08, pivot[2] - 0.16),
                   (pivot[0] + mirror * 0.05, pivot[1] + 0.46, pivot[2] - 0.58)],
                  (0.046, 0.038), "JetMetal", sides=6)
    gear.add_box((wheel[0], wheel[1], wheel[2] + 0.16), (0.10, 0.30, 0.34), "JetMetal")
    gear_obj = gear.build(parent, tone="flat")

    wheel_part = Part(f"wheel_{label}", (wheel[0], wheel[1], wheel[2]))
    wheel_part.add_loft(wheel_rings((wheel[0], wheel[1], wheel[2]), wheel[3], wheel[4]), "JetTire")
    wheel_part.add_tube([(wheel[0] - wheel[4] * 0.52, wheel[1], wheel[2]),
                         (wheel[0] + wheel[4] * 0.52, wheel[1], wheel[2])],
                        (wheel[3] * 0.55, wheel[3] * 0.55), "JetMetal", sides=12)
    wheel_obj = wheel_part.build(parent, tone="flat")
    attach(wheel_obj, gear_obj)

    # Door: hinge on one edge, plate reaching across the bay.
    hinge_x, door_y, door_z, width, length, reach = door
    door_part = Part(f"door_{label}", (hinge_x, door_y, door_z))
    door_part.add_box((hinge_x + reach * width * 0.5, door_y, door_z),
                      (width, length, 0.075), "JetSkin")
    door_part.add_box((hinge_x + reach * width * 0.5, door_y, door_z + 0.045),
                      (width * 0.94, length * 0.94, 0.012), "JetMetal")
    door_obj = door_part.build(parent)
    return gear_obj, wheel_obj, door_obj


def build_stores(parent):
    objects = []
    for sign in (-1, 1):
        side = "right" if sign > 0 else "left"
        tip = WING_SECTIONS[-1]
        rail = Part(f"store_wingtip_{side}", (sign * tip[0], -1.45, tip[4]))
        rail.add_box((sign * tip[0], -1.55, tip[4] - 0.020), (0.14, 0.90, 0.130), "JetSkin")
        rail.add_tube([(sign * tip[0], 0.62, tip[4] - 0.070),
                       (sign * tip[0], -1.10, tip[4] - 0.070),
                       (sign * tip[0], -2.55, tip[4] - 0.070)],
                      (0.055, 0.085, 0.085), "JetMetal", sides=10)
        add_missile(rail, sign * tip[0], tip[4] - 0.070, 0.62, 3.10, 0.115)
        objects.append(rail.build(parent))

        span = 2.72
        section = section_at(WING_SECTIONS, span)
        under = Part(f"store_underwing_{side}", (sign * span, 0.0, section[3]))
        add_missile(under, sign * span, section[3] - 0.360, 1.35, 3.65, 0.150)
        objects.append(under.build(parent))

    tank = Part("store_centerline_tank", (0.0, -0.40, -0.62))
    tank.add_tube([(0.0, 1.45, -0.520), (0.0, 0.10, -0.860), (0.0, -1.95, -0.860),
                   (0.0, -3.05, -0.520)], (0.070, 0.250, 0.250, 0.070), "JetSkin", sides=12)
    tank.add_box((0.0, -0.30, -0.430), (0.20, 0.90, 0.240), "JetSkin")
    tank.add_tube([(0.0, -3.10, -0.750), (0.0, -3.30, -0.700)], (0.070, 0.040),
                  "JetMetal", sides=8)
    objects.append(tank.build(parent))
    return objects


def add_missile(part, x, z, y_nose, length, radius):
    y_tail = y_nose - length
    part.add_tube([(x, y_nose, z), (x, y_nose - 0.24, z), (x, y_tail + 0.10, z),
                   (x, y_tail, z)], (0.020, radius, radius, radius * 0.92), "JetSkin", sides=10)
    add_missile_fins(part, x, z, radius, 0.300, y_tail + 0.86, y_tail + 0.06, 4, 0.40)
    add_missile_fins(part, x, z, radius, 0.150, y_nose - 0.32, y_nose - 0.54, 4, 0.45)


def add_missile_fins(part, x, z, radius, span, y_root_le, y_root_te, count, sweep):
    """Thin triangular fins around the missile axis, one wedge each."""
    for index in range(count):
        angle = 2.0 * math.pi * index / count + math.pi / count
        radial = (math.cos(angle), math.sin(angle))
        normal = (-radial[1], radial[0])
        thickness = 0.013
        tip_y = y_root_te - sweep * span

        def point(radial_offset, y, offset):
            return (x + radial[0] * radial_offset + normal[0] * offset, y,
                    z + radial[1] * radial_offset + normal[1] * offset)

        inner = [point(radius, y_root_le, -thickness), point(radius, y_root_te, -thickness),
                 point(radius + span, tip_y, -thickness)]
        outer = [point(radius, y_root_le, thickness), point(radius, y_root_te, thickness),
                 point(radius + span, tip_y, thickness)]
        part.add_loft([inner, outer], "JetMetal")


def build_details(parent):
    part = Part("jet_details_noshadow_nocol")
    part.add_tube([(0.0, 7.30, -0.128), (0.0, 7.92, -0.126)], (0.026, 0.012), "JetMetal", sides=6)
    # Blade antennas and the two angle-of-attack probes on the nose, each on the skin it belongs to.
    for sign in (-1, 1):
        antenna_x = sign * fuselage_skin_x(-0.010, 6.05)
        part.add_tube([(antenna_x, 6.05, -0.010), (antenna_x + sign * 0.06, 6.00, -0.030)],
                      (0.030, 0.010), "JetMetal", sides=6)
        part.add_box((sign * 0.62, 1.60, fuselage_skin_z(sign * 0.62, 1.60) + 0.070),
                     (0.028, 0.42, 0.140), "JetMetal")
        # A blade antenna under the aft body, sitting on the real skin instead of floating:
        part.add_box((sign * 0.40, -4.60, fuselage_skin_z(sign * 0.40, -4.60, upper=False) - 0.055),
                     (0.026, 0.34, 0.120), "JetMetal")
        # Roundel on the wing: blue ring, white band, red centre, laid on the upper skin.
        span, chord_position = sign * 2.85, -1.05
        surface = wing_upper_z(span, chord_position)
        for radius, lift, material_name in ((0.300, 0.006, "JetInsigniaBlue"),
                                            (0.192, 0.008, "JetInsigniaWhite"),
                                            (0.086, 0.010, "JetInsigniaRed")):
            part.add_loft(disc_rings((span, chord_position, surface + lift), radius, 0.004),
                          material_name)
    # Fin flash: three bands painted through the fin, so they show on both sides at once.
    for (y_front, y_back, material_name) in ((-4.58, -4.82, "JetInsigniaBlue"),
                                             (-4.82, -5.06, "JetInsigniaWhite"),
                                             (-5.06, -5.30, "JetInsigniaRed")):
        rings = []
        for z in (0.50, 1.60):
            y_le, y_te, ratio, _ = section_at(FIN_SECTIONS, z)
            half = 0.5 * ratio * (y_le - y_te) + 0.004
            rings.append([(half, y_front, z), (half, y_back, z),
                          (-half, y_back, z), (-half, y_front, z)])
        part.add_loft(rings, material_name)
    part.add_tube([(-4.24, -3.42, 0.146), (-4.30, -3.42, 0.146)], (0.048, 0.040),
                  "JetLightRed", sides=8)
    part.add_tube([(4.24, -3.42, 0.146), (4.30, -3.42, 0.146)], (0.048, 0.040),
                  "JetLightGreen", sides=8)
    part.add_tube([(0.0, -5.10, 2.410), (0.0, -5.22, 2.410)], (0.042, 0.036),
                  "JetLightWhite", sides=8)
    return part.build(parent, tone="flat")


# ---------------------------------------------------------------- animation


class Clip:
    """One named clip: per object a rotation_euler / location / scale track, all in one action."""

    def __init__(self, name, length):
        self.name = name
        self.length = length
        self.channels = {}

    def _channel(self, obj, path):
        entry = self.channels.setdefault(obj.name,
                                         {"obj": obj, "rotation_euler": {}, "location": {},
                                          "scale": {}})
        return entry[path]

    def rot(self, obj, frame, euler_degrees):
        self._channel(obj, "rotation_euler")[frame] = tuple(math.radians(value)
                                                           for value in euler_degrees)

    def hinge(self, obj, frame, angle_degrees):
        """Deflect a control surface about its own hinge: the local x axis, which the object's
        base z rotation has already aligned with the hinge line."""
        self.rot(obj, frame, (angle_degrees, 0.0, math.degrees(obj.rotation_euler.z)))

    def yaw(self, obj, frame, angle_degrees):
        """Deflect about the vertical axis, on top of the object's base rotation."""
        self.rot(obj, frame, (0.0, 0.0, math.degrees(obj.rotation_euler.z) + angle_degrees))

    def loc(self, obj, frame, vector):
        self._channel(obj, "location")[frame] = tuple(vector)

    def scale(self, obj, frame, vector):
        self._channel(obj, "scale")[frame] = tuple(vector)

    def apply(self, linear_objects=()):
        for name, entry in self.channels.items():
            obj = entry["obj"]
            action = bpy.data.actions.new(self.name)
            action.use_fake_user = True
            if obj.animation_data is None:
                obj.animation_data_create()
            obj.animation_data.action = action
            for path in ("rotation_euler", "location", "scale"):
                keys = entry[path]
                for frame, value in sorted(keys.items()):
                    setattr(obj, path, value)
                    obj.keyframe_insert(data_path=path, frame=frame)
            for fcurve in action.fcurves:
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR" if name in linear_objects else "BEZIER"
            track = obj.animation_data.nla_tracks.new()
            track.name = self.name
            track.strips.new(self.name, 0, action)
            obj.animation_data.action = None


def build_clips(objects):
    clips = []

    # A four second flight-control loop: pitch, then roll both ways, ending where it started.
    clip = Clip("flight_controls", 120)
    script = ((0, 0.0, 0.0, 0.0, 0.0, 0.0),
              (20, 12.0, -8.0, 8.0, 0.0, 0.0),
              (40, -16.0, 6.0, 18.0, 0.0, 0.0),
              (60, 15.0, -7.0, 14.0, 20.0, 20.0),
              (80, -14.0, 7.0, 20.0, -20.0, -20.0),
              (100, 9.0, -5.0, 10.0, 6.0, 6.0),
              (120, 0.0, 0.0, 0.0, 0.0, 0.0))
    for frame, elevon, canard, lef, roll, rudder in script:
        clip.hinge(objects["elevon_left"], frame, elevon + roll)
        clip.hinge(objects["elevon_right"], frame, elevon - roll)
        clip.hinge(objects["canard_left"], frame, canard - roll * 0.4)
        clip.hinge(objects["canard_right"], frame, canard + roll * 0.4)
        clip.hinge(objects["lef_left"], frame, lef)
        clip.hinge(objects["lef_right"], frame, lef)
        clip.yaw(objects["rudder"], frame, rudder)
    clips.append(clip)

    # Gear. The rest pose is the parked jet with the gear down, so `gear_down` ends there and
    # `gear_up` starts there. `gear_down` is pushed onto the NLA stack first: a strip on top of
    # another replaces its channels, and the topmost of the two has to hold the rest pose at
    # frame 0 or the blend file would open with the legs already up.
    for name, up in (("gear_down", False), ("gear_up", True)):
        clip = Clip(name, 90)
        if up:
            door_keys = ((0, 0.0), (18, 82.0), (70, 82.0), (90, 0.0))
            leg_keys = ((0, 0.0), (18, 0.0), (30, 14.0), (64, 96.0), (90, 96.0))
        else:
            door_keys = ((0, 0.0), (18, 82.0), (70, 82.0), (90, 0.0))
            leg_keys = ((0, 96.0), (18, 96.0), (30, 84.0), (64, 2.0), (90, 0.0))
        for frame, angle in door_keys:
            clip.rot(objects["door_nose"], frame, (0.0, angle, 0.0))
            clip.rot(objects["door_left"], frame, (0.0, angle, 0.0))
            clip.rot(objects["door_right"], frame, (0.0, -angle, 0.0))
        for frame, angle in leg_keys:
            clip.rot(objects["gear_nose"], frame, (-angle, 0.0, 0.0))
            clip.rot(objects["gear_left"], frame, (0.0, -angle, 0.0))
            clip.rot(objects["gear_right"], frame, (0.0, angle, 0.0))
        clips.append(clip)

    clip = Clip("canopy_open", 36)
    for frame, angle in ((0, 0.0), (10, 4.0), (34, CANOPY_OPEN_DEGREES),
                         (36, CANOPY_OPEN_DEGREES)):
        clip.rot(objects["canopy"], frame, (angle, 0.0, 0.0))
    clips.append(clip)

    clip = Clip("speed_brake_open", 24)
    for frame, angle in ((0, 0.0), (8, -8.0), (22, -55.0), (24, -55.0)):
        clip.rot(objects["speed_brake"], frame, (angle, 0.0, 0.0))
    clips.append(clip)

    clip = Clip("refuel_probe_extend", 45)
    for frame, travel, droop in ((0, 0.0, 0.0), (14, 0.10, -1.0), (42, 0.95, -8.0),
                                 (45, 0.95, -8.0)):
        clip.loc(objects["refuel_probe"], frame, (0.0, travel, 0.0))
        clip.rot(objects["refuel_probe"], frame, (droop, 0.0, 0.0))
    clips.append(clip)

    clip = Clip("afterburner", 60)
    flame = objects["afterburner_noshadow_nocol"]
    for frame, scale, petals in ((0, 0.05, 0.92), (18, 1.00, 1.05), (44, 0.94, 1.03),
                                 (60, 0.05, 0.92)):
        # Axial scale is the flame length; the plume keeps a wider mouth than a thin needle.
        radial = 0.24 + 0.76 * scale
        clip.scale(flame, frame, (radial, scale, radial))
        clip.scale(objects["nozzle_petals"], frame,
                   (petals, 1.0 + (petals - 1.0) * 0.5, petals))
    clips.append(clip)

    clip = Clip("wheel_roll", 30)
    for name in ("wheel_nose", "wheel_left", "wheel_right"):
        for frame in range(0, 31, 3):
            clip.rot(objects[name], frame, (frame * 12.0, 0.0, 0.0))
    clips.append(clip)

    for entry in clips:
        entry.apply(linear_objects=("wheel_nose", "wheel_left", "wheel_right"))
    return clips


# ---------------------------------------------------------------- assembly and export


def build_all():
    root = bpy.data.objects.new("fighter_jet", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_size = 1.0

    objects = {}
    build_airframe(root)
    objects["canopy"] = build_canopy(root)
    build_cockpit(root)
    for sign in (-1, 1):
        side = "right" if sign > 0 else "left"
        objects[f"elevon_{side}"] = build_elevon(root, sign)
        objects[f"lef_{side}"] = build_lef(root, sign)
        objects[f"canard_{side}"] = build_canard(root, sign)
    objects["rudder"] = build_rudder(root)
    objects["speed_brake"] = build_speed_brake(root)
    objects["refuel_probe"] = build_refuel_probe(root)
    objects["nozzle_petals"], objects["afterburner_noshadow_nocol"] = build_nozzle(root)
    build_details(root)
    build_stores(root)

    nose = build_gear(
        root, "nose", GEAR_PIVOT_NOSE, GEAR_STRUT_NOSE, WHEEL_NOSE,
        (-0.36, 4.10, -0.520, 0.72, 1.70, 1.0), 1.0)
    objects["gear_nose"], objects["wheel_nose"], objects["door_nose"] = nose
    for sign in (-1, 1):
        side = "right" if sign > 0 else "left"
        pivot = (sign * GEAR_PIVOT_MAIN_X, GEAR_PIVOT_MAIN_Y, GEAR_PIVOT_MAIN_Z)
        strut_end = (sign * (GEAR_PIVOT_MAIN_X + 0.02), GEAR_STRUT_MAIN[0], GEAR_STRUT_MAIN[1])
        wheel = (sign * (GEAR_PIVOT_MAIN_X + 0.03), WHEEL_MAIN[0], WHEEL_MAIN[1],
                 WHEEL_MAIN[2], WHEEL_MAIN[3])
        # Doors hinge on the outer edge and reach inward over the bay.
        door = (sign * 1.32, -0.55, -0.440, 0.66, 1.90, -sign)
        gear, wheel_obj, door_obj = build_gear(root, side, pivot, strut_end, wheel, door, sign)
        objects[f"gear_{side}"] = gear
        objects[f"wheel_{side}"] = wheel_obj
        objects[f"door_{side}"] = door_obj
    return root, objects


def triangle_count(obj):
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def bake_ambient_occlusion(objects):
    """Bake contact shading into COLOR_0, the way the Eiffel and Falkenwacht packs do it.

    Cycles samples how much of the sky each vertex can see inside the whole model, so the wing
    root, the intake trunks and the gear bays come back darker than an open panel. The result is
    multiplied into the two-tone livery layer that is already there, never brightened, and clamped
    to AO_MIN_TONE because COLOR_0 wraps above 1.0 instead of clamping.
    """
    meshes = [obj for obj in objects
              if obj.type == "MESH" and len(obj.data.vertices)
              and not obj.name.startswith("afterburner")]
    if not meshes:
        return 0
    scene = bpy.context.scene
    previous_engine = scene.render.engine
    darkened = 0
    try:
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = AO_SAMPLES
        if scene.world is None:
            scene.world = bpy.data.worlds.new("JetBakeWorld")
        scene.world.light_settings.distance = AO_DISTANCE
        scene.render.bake.target = "VERTEX_COLORS"
        for obj in meshes:
            layer = obj.data.color_attributes.get("AO")
            if layer is None:
                layer = obj.data.color_attributes.new(name="AO", type="FLOAT_COLOR",
                                                      domain="POINT")
            layer.data.foreach_set("color", [1.0] * (4 * len(obj.data.vertices)))
            obj.data.color_attributes.active_color_index = obj.data.color_attributes.find("AO")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.bake(type="AO")
        for obj in meshes:
            mesh = obj.data
            count = len(mesh.vertices)
            occlusion = [0.0] * (4 * count)
            mesh.color_attributes["AO"].data.foreach_get("color", occlusion)
            grain = mesh.color_attributes.get("Col")
            tints = [1.0] * (4 * count)
            if grain is not None:
                grain.data.foreach_get("color", tints)
            else:
                grain = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
            for index in range(count):
                open_sky = min(1.0, max(0.0, occlusion[index * 4]))
                shade = 1.0 - AO_STRENGTH * (1.0 - open_sky)
                if shade < 0.999:
                    darkened += 1
                for channel in range(3):
                    tints[index * 4 + channel] = min(1.0, max(AO_MIN_TONE,
                                                              tints[index * 4 + channel] * shade))
                tints[index * 4 + 3] = 1.0
            grain.data.foreach_set("color", tints)
            mesh.color_attributes.remove(mesh.color_attributes["AO"])
            active = mesh.color_attributes.find("Col")
            mesh.color_attributes.active_color_index = active
            mesh.color_attributes.render_color_index = active
    except Exception as error:                                  # noqa: BLE001 - keep building
        print(f"[jet] WARNING ambient occlusion bake skipped: {error}")
    finally:
        scene.render.engine = previous_engine
    return darkened


def vertex_tone_report():
    darkest = 1.0
    layered = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        layer = obj.data.color_attributes.get("Col")
        if layer is None or not len(obj.data.vertices):
            continue
        layered += 1
        values = [0.0] * (4 * len(obj.data.vertices))
        layer.data.foreach_get("color", values)
        darkest = min(darkest, min(values[index * 4] for index in range(len(obj.data.vertices))))
    return layered, darkest


def report_scene():
    total = 0
    print("[jet] parts:")
    for obj in sorted(bpy.data.objects, key=lambda entry: entry.name):
        if obj.type != "MESH":
            continue
        triangles = triangle_count(obj)
        total += triangles
        print(f"[jet]   {obj.name:34s} {triangles:6d} tris  {len(obj.data.vertices):6d} verts"
              f"  {len(obj.data.materials)} mat")
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    print(f"[jet] scene total: {total} triangles, {len(meshes)} mesh objects")


def export_blend(path, clips):
    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.frame_end = max([clip.length for clip in clips] + [1])
    scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    print(f"[jet] blend: {path} ({path.stat().st_size / 1024:.0f} KiB)")


def export_glb(path, animated):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB",
        export_yup=True, export_apply=True, export_extras=True,
        export_cameras=False, export_lights=False,
        export_animations=animated,
        export_animation_mode="NLA_TRACKS" if animated else "ACTIONS",
        export_anim_scene_split_object=False, export_anim_slide_to_zero=True,
        # The two-tone underside and the baked occlusion live in COLOR_0, which the loader
        # multiplies onto the painted map. Only the active layer is exported: a neutral one would
        # cost bytes and change nothing.
        export_vertex_color="ACTIVE", export_all_vertex_colors=False,
    )
    print(f"[jet] glb: {path} ({path.stat().st_size / 1024:.1f} KiB)")


def summarize_glb(path):
    data = path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + json_length].decode("utf-8").rstrip("\x00 "))
    accessors = document.get("accessors", [])
    primitives = [primitive for mesh in document.get("meshes", [])
                  for primitive in mesh.get("primitives", [])]
    triangles = 0
    for primitive in primitives:
        accessor = accessors[primitive.get("indices", primitive["attributes"]["POSITION"])]
        count = accessor.get("count", 0)
        mode = primitive.get("mode", 4)
        triangles += count // 3 if mode == 4 else max(0, count - 2) if mode in (5, 6) else 0
    mesh_nodes = [node for node in document.get("nodes", []) if "mesh" in node]
    images = document.get("images", [])
    textured = len([material for material in document.get("materials", [])
                    if material.get("pbrMetallicRoughness", {}).get("baseColorTexture")])
    colored = len([primitive for primitive in primitives
                   if primitive.get("attributes", {}).get("COLOR_0") is not None])
    print(f"[jet] glb summary: {path.stat().st_size / 1024:.1f} KiB, {triangles} triangles, "
          f"{len(primitives)} primitives, {len(mesh_nodes)} mesh nodes, "
          f"{len(document.get('materials', []))} materials")
    print(f"[jet]   textures: {len(images)} embedded image(s), {textured} material(s) painted, "
          f"{colored} primitive(s) carry COLOR_0")
    for animation in document.get("animations", []):
        duration = max([0.0] + [float(accessors[sampler["input"]].get("max", [0])[0])
                                for sampler in animation.get("samplers", [])])
        print(f"[jet]   clip {animation.get('name'):24s} {duration:5.2f} s  "
              f"{len(animation.get('channels', []))} channels")
    return {"triangles": triangles, "primitives": len(primitives),
            "kib": path.stat().st_size / 1024, "images": len(images), "colored": colored,
            "clips": [animation.get("name") for animation in document.get("animations", [])]}


def parse_args():
    parser = argparse.ArgumentParser()
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    default_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--output-blend", type=Path,
                        default=default_root / "assets/models/fighter_jet/blender"
                                / f"{PART_NAME}.blend")
    parser.add_argument("--output-glb", type=Path,
                        default=default_root / "assets/models/fighter_jet/glb"
                                / f"{PART_NAME}.glb")
    parser.add_argument("--no-animation", action="store_true")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    reset_scene()
    make_materials(build_skin_texture())
    root, objects = build_all()
    # Occlusion is baked in the rest pose, before any clip is written: the shading belongs to the
    # surface, and a bake on top of an animated pose would freeze that pose into the colours.
    darkened = bake_ambient_occlusion(list(bpy.data.objects))
    layered, darkest = vertex_tone_report()
    # Writing a keyframe sets the property first, so clipping leaves every animated object on its
    # last key. The rest transforms are captured here and put back before saving and exporting,
    # which is what makes the node transforms - and the pose of a viewer that plays no clip - the
    # parked jet with the gear down and the probe stowed.
    rest = {obj.name: (obj.location.copy(), obj.rotation_euler.copy(), obj.scale.copy())
            for obj in bpy.data.objects}
    clips = [] if args.no_animation else build_clips(objects)
    for obj in bpy.data.objects:
        if obj.name in rest:
            location, rotation, scale = rest[obj.name]
            obj.location = location
            obj.rotation_euler = rotation
            obj.scale = scale
    root["asset"] = "fighter_jet"
    root["clips"] = ",".join(clip.name for clip in clips)
    root["movable_parts"] = ",".join([
        "canopy", "canard_left", "canard_right", "elevon_left", "elevon_right", "lef_left",
        "lef_right", "rudder", "speed_brake", "refuel_probe", "gear_nose", "gear_left",
        "gear_right", "door_nose", "door_left", "door_right", "wheel_nose", "wheel_left",
        "wheel_right", "nozzle_petals", "afterburner",
    ])
    root["forward_axis"] = "-Z in game, nose along Blender +Y"
    root["authored_size_metres"] = "14.10 long, 8.40 span, 2.30 to fin tip"
    root["livery"] = (f"{TEXTURE_NAME} {TEXTURE_SIZE}px, one tile per "
                      f"{TEXTURE_METRES_PER_TILE:g} m; COLOR_0 carries the two-tone underside "
                      f"and baked ambient occlusion")
    report_scene()
    print(f"[jet] shading: {layered} meshes with a COLOR_0 layer, "
          f"{darkened} vertices darkened by occlusion, darkest tone {darkest:.3f}")
    export_blend(args.output_blend, clips)
    export_glb(args.output_glb, bool(clips))
    summary = summarize_glb(args.output_glb)
    if summary["kib"] > FILE_BUDGET_KIB:
        print(f"[jet] WARNING file budget: {summary['kib']:.1f} KiB > {FILE_BUDGET_KIB} KiB")


if __name__ == "__main__":
    main()
