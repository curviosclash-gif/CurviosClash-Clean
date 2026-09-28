"""Build the Nova Lance sci-fi space fighter as an editable blend and a GLB with moving parts.

Run with Blender 4.2:

    blender --background --factory-startup --python-exit-code 1 \\
        --python scripts/generate_scifi_fighter_asset.py
    ... -- --no-animation          # static model, no clips

The model is a single-seat space-superiority fighter: a faceted chined hull, a cranked delta wing
with elevons, foreplanes, two canted wingtip fins with rudders, two side engine pods with an iris
nozzle and an afterburner plume, retractable tricycle gear and a pair of wing-root cannons. The
hull is lofted from one twelve-point section profile per station, so every edge of the chine stays
where the profile puts it - that faceted look is geometry, not a normal map.

Axes. The game's player vehicles face -Z (`src/entities/obj-vehicle-mesh.js` puts the muzzle at
-size.z). Blender exports its +Y as glTF -Z, so the nose points along +Y here. Blender x stays the
game's x (span), Blender z becomes the game's y (height). A single stray vertex would move the
whole model: the loader places a model by the centre of its bounding box.

Units and scale. Authored 1:1 in metres - about 14 m long, 11 m span, roughly 4.5 m from the
ground line to the fin tips. The game normalises the longest edge to a fixed size and a map
placement uses `targetSize`, so no game unit is baked in. The ground line is the bottom of the
tyres.

Budgets (pinned by tests/scifi-fighter-blender-assets.contract.test.mjs): at most 30 000
triangles, 64 primitives (a primitive is one mesh with one material - that is what a draw call
costs) and 600 KiB. The target GPU is an Intel UHD 630: emissions stay under 2 so the tone mapping
keeps them coloured instead of white, and there are no vertex colours - the exporter writes COLOR_0
as a normalised 16-bit integer, where a value below 0.18 wraps around into black.

Roles. Every mesh is visible; nothing is `_colonly`, because a vehicle is collided by its hitbox
radius, not by drawn triangles. Trim (antennas, sensors, greebles, lights, cockpit interior,
plumes) carries `_noshadow_nocol` so it costs neither a shadow pass nor collision triangles.

Moving parts. Each one is an object whose origin sits on its hinge, with the mesh written in that
hinge's local frame, so a clip that writes rotation_euler.x (or y/z) deflects the surface about the
hinge. Clips are NLA tracks of the same name: the glTF exporter merges same-named tracks across
objects into one clip and solos them, so no clip leaks another system's pose (probed on Blender 4.2
before this file was written). Without any clip playing, the node transforms are the rest pose:
parked, gear down, canopy shut, airbrake shut, iris at cruise, plume a stub.
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
PART_NAME = "01_scifi_fighter"
SEED = 20261004

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "models" / "scifi_fighter" / "blender"
GLB_DIR = ROOT / "assets" / "models" / "scifi_fighter" / "glb"

# ---------------------------------------------------------------- livery, texture, shading

# One tileable grey skin: panel lines, rivets and access panels. It repeats, and one tile covers
# this much surface, so a 64 px panel line on a 512 px map lands at about 0.75 m - the size of a
# hull plate on a 14 m fighter.
TEXTURE_NAME = "NovaSkin"
TEXTURE_SIZE = 512
TEXTURE_METRES_PER_TILE = 6.0
PANEL_PIXELS = 64
RIVET_PIXELS = 8

# ---------------------------------------------------------------- design in metres

# (station y, half width, half height, centre z) from the nose back to the tail.
FUSELAGE = (
    (7.30, 0.09, 0.11, 0.05),
    (6.75, 0.30, 0.30, 0.03),
    (5.90, 0.58, 0.46, 0.01),
    (4.70, 0.82, 0.60, 0.00),
    (3.40, 1.00, 0.70, 0.02),
    (2.10, 1.14, 0.77, 0.04),
    (0.60, 1.22, 0.80, 0.04),
    (-0.90, 1.20, 0.78, 0.02),
    (-2.30, 1.12, 0.73, 0.00),
    (-3.70, 1.00, 0.65, -0.02),
    (-5.00, 0.86, 0.55, -0.03),
    (-6.10, 0.62, 0.40, -0.04),
)

# Half section, top to bottom on the right side: a flat top deck, a hard chine at the widest point
# and a tuck under it. The ring builder mirrors the left half.
SECTION_PROFILE = (
    (0.00, 1.00), (0.40, 0.94), (0.74, 0.70), (1.00, 0.22),
    (0.92, -0.34), (0.58, -0.86), (0.00, -1.00),
)
CHINE_INDEX = 3
DECK_INDEX = 1

# (y, half width, half height, centre z) of the raised dorsal deck.
SPINE = (
    (2.70, 0.30, 0.20, 0.88),
    (0.60, 0.42, 0.22, 0.86),
    (-1.40, 0.40, 0.20, 0.82),
    (-3.10, 0.32, 0.16, 0.78),
    (-4.40, 0.20, 0.10, 0.72),
)

# (span, leading edge y, full trailing edge y, thickness, centre z). The wing is cranked: a 38
# degree inner panel and a 53 degree outer panel that carries the elevons.
WING_SECTIONS = (
    (0.55, 4.45, -2.30, 0.40, 0.02),
    (1.80, 3.95, -2.05, 0.34, -0.04),
    (2.95, 2.60, -1.72, 0.26, -0.16),
    (4.30, 0.85, -1.35, 0.18, -0.34),
    (5.50, -0.75, -1.05, 0.12, -0.52),
)
ELEVON_START_X = 2.95
ELEVON_CHORD_FRACTION = 0.34
ELEVON_DEFLECTION = 22.0

# (span, leading edge y, trailing edge y, thickness, centre z)
CANARD_SECTIONS = (
    (0.80, 4.95, 3.55, 0.16, 0.28),
    (1.70, 4.55, 3.30, 0.12, 0.24),
    (2.45, 3.85, 3.00, 0.08, 0.16),
)
CANARD_DEFLECTION = 20.0

# (height z, leading edge y, trailing edge y, thickness) - a vertical plate, lofted along z.
FIN_SECTIONS = (
    (-0.30, 0.70, -1.60, 0.15),
    (0.75, 0.10, -1.40, 0.13),
    (1.70, -0.85, -1.30, 0.08),
)
FIN_X = 5.05
FIN_CANT_DEGREES = 22.0
RUDDER_HINGE_Y = -0.35
RUDDER_DEFLECTION = 26.0

# Engine pods and the nozzle exit they end in.
ENGINE_X = 0.92
ENGINE_PATH = ((ENGINE_X, -2.30, 0.02), (ENGINE_X, -3.60, 0.00),
               (ENGINE_X, -5.10, -0.02), (ENGINE_X, -5.95, -0.02))
ENGINE_RADII = (0.54, 0.60, 0.58, 0.52)
NOZZLE_Y = -5.95
NOZZLE_PETALS = 8
NOZZLE_INNER_RADIUS = 0.34
NOZZLE_OUTER_RADIUS = 0.52
BURNER_STUB_SCALE = 0.05
BURNER_RADIAL_SCALE = 0.24 + 0.76 * BURNER_STUB_SCALE

# (pivot, strut end, wheel centre, radius, width) of the three gear legs.
GEAR_LEGS = {
    "gear_nose": {"pivot": (0.00, 4.35, -0.62), "strut": (0.00, 4.28, -1.30),
                  "wheel": (0.00, 4.28, -1.63), "radius": 0.32, "width": 0.22},
    "gear_left": {"pivot": (-1.05, -1.10, -0.52), "strut": (-1.22, -1.10, -1.24),
                  "wheel": (-1.28, -1.10, -1.57), "radius": 0.38, "width": 0.26},
    "gear_right": {"pivot": (1.05, -1.10, -0.52), "strut": (1.22, -1.10, -1.24),
                   "wheel": (1.28, -1.10, -1.57), "radius": 0.38, "width": 0.26},
}
GEAR_RETRACT_DEGREES = 96.0
DOOR_OPEN_DEGREES = 82.0

CANOPY_PIVOT = (0.00, 2.30, 0.86)
CANOPY_OPEN_DEGREES = 32.0
AIRBRAKE_OPEN_DEGREES = 52.0

# ---------------------------------------------------------------- geometry helpers


def lerp(a, b, t):
    return a + (b - a) * t


def profile_ring(y, half_width, half_height, z_centre, profile=SECTION_PROFILE):
    """One closed hull ring: the right half of the profile plus its mirrored left half."""
    right = [(u * half_width, y, z_centre + v * half_height) for (u, v) in profile]
    left = [(-u * half_width, y, z_centre + v * half_height) for (u, v) in reversed(profile[1:-1])]
    return right + left


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


def plate_ring(y_le, y_te, thickness, centre=0.0):
    """One lifting-surface section: a lens with a sharp leading and a thin trailing edge."""
    chord = y_le - y_te
    return [
        (y_le, centre),
        (y_le - 0.30 * chord, centre + thickness * 0.50),
        (y_te + 0.12 * chord, centre + thickness * 0.32),
        (y_te, centre + thickness * 0.06),
        (y_te, centre - thickness * 0.06),
        (y_te + 0.12 * chord, centre - thickness * 0.32),
        (y_le - 0.30 * chord, centre - thickness * 0.50),
    ]


def wing_rings(sections, sign):
    """Loft rings of a horizontal surface, mirrored by `sign` (+1 right, -1 left)."""
    return [[(sign * span, y, z) for (y, z) in plate_ring(y_le, y_te, thickness, z_centre)]
            for span, y_le, y_te, thickness, z_centre in sections]


def fin_rings(sections, x_centre):
    """Loft rings of a vertical surface: chord along y, thickness along x, lofted along z."""
    return [[(x_centre + offset, y, height)
             for (y, offset) in plate_ring(y_le, y_te, thickness)]
            for height, y_le, y_te, thickness in sections]


def tube_rings(path, radii, sides=10, flatten=1.0):
    """Rings around a polyline: gear struts, gun barrels, antennas."""
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


def wheel_rings(centre, radius, width):
    """Tyre as a loft along x with rounded shoulders."""
    cx, cy, cz = centre
    profile = ((-0.5, 0.76), (-0.5, 0.96), (-0.34, 1.0), (0.34, 1.0), (0.5, 0.96), (0.5, 0.76))
    rings = []
    for offset, ratio in profile:
        x = cx + offset * width
        rings.append([(x, cy + math.cos(2.0 * math.pi * i / 12) * radius * ratio,
                       cz + math.sin(2.0 * math.pi * i / 12) * radius * ratio) for i in range(12)])
    return rings


def blister_rings(centre, radius, segments=8, rings=4):
    """Small faceted ball, for sensor blisters and navigation lights."""
    cx, cy, cz = centre
    result = []
    for ring in range(1, rings):
        polar = math.pi * ring / rings
        r = radius * math.sin(polar)
        height = radius * math.cos(polar)
        result.append([(cx + math.cos(2.0 * math.pi * i / segments) * r,
                        cy + height,
                        cz + math.sin(2.0 * math.pi * i / segments) * r) for i in range(segments)])
    return result


def petal_rings(angle, half_angle, profile):
    """One iris petal: a trapezoid plate, lofted across a narrow angular slice."""
    rings = []
    for sign in (-1.0, 1.0):
        turn = angle + sign * half_angle * 0.5
        rings.append([(math.cos(turn) * radius, y, math.sin(turn) * radius)
                      for (y, radius) in profile])
    return rings


def fuselage_station(y):
    """Interpolated (half width, half height, centre z) of the hull at one station."""
    table = FUSELAGE
    if y >= table[0][0]:
        return table[0][1:]
    if y <= table[-1][0]:
        return table[-1][1:]
    for index in range(len(table) - 1):
        high, low = table[index], table[index + 1]
        if low[0] <= y <= high[0]:
            t = (y - low[0]) / (high[0] - low[0])
            return tuple(lerp(low[i + 1], high[i + 1], t) for i in range(3))
    return table[-1][1:]


def fuselage_top(y):
    half_width, half_height, z_centre = fuselage_station(y)
    del half_width
    return z_centre + half_height


def fuselage_deck_half_width(y):
    half_width, _half_height, _z_centre = fuselage_station(y)
    return half_width * SECTION_PROFILE[DECK_INDEX][0]


def fuselage_chine(y):
    """The widest point of the section, where a strake belongs."""
    half_width, half_height, z_centre = fuselage_station(y)
    return half_width, z_centre + half_height * SECTION_PROFILE[CHINE_INDEX][1]


def fuselage_bottom(y):
    half_width, half_height, z_centre = fuselage_station(y)
    del half_width
    return z_centre - half_height


def engine_station(y):
    """Interpolated pod radius and centre z at one station, for ribs and the nozzle ring."""
    if y >= ENGINE_PATH[0][1]:
        return ENGINE_RADII[0], ENGINE_PATH[0][2]
    if y <= ENGINE_PATH[-1][1]:
        return ENGINE_RADII[-1], ENGINE_PATH[-1][2]
    for index in range(len(ENGINE_PATH) - 1):
        high, low = ENGINE_PATH[index], ENGINE_PATH[index + 1]
        if low[1] <= y <= high[1]:
            t = (y - low[1]) / (high[1] - low[1])
            return lerp(ENGINE_RADII[index], ENGINE_RADII[index + 1], t), lerp(high[2], low[2], t)
    return ENGINE_RADII[-1], ENGINE_PATH[-1][2]


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


def wing_cut_sections():
    """Wing sections with the elevon cut out of the trailing edge, outboard of the hinge."""
    result = []
    for span, y_le, y_te, thickness, z_centre in WING_SECTIONS:
        chord = y_le - y_te
        y_cut = y_te if span <= ELEVON_START_X else y_te + ELEVON_CHORD_FRACTION * chord
        result.append((span, y_le, y_cut, thickness, z_centre))
    return tuple(result)


def elevon_sections():
    """The cut-away trailing edge as its own surface, pivoting on the hinge line."""
    result = []
    for span, y_le, y_te, thickness, z_centre in WING_SECTIONS:
        if span + 1e-6 < ELEVON_START_X:
            continue
        chord = y_le - y_te
        y_cut = y_te + ELEVON_CHORD_FRACTION * chord
        result.append((span, y_cut, y_te, thickness * 0.45, z_centre - 0.01))
    return tuple(result)


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


def material(name, colour, roughness, metallic=0.0, emission=None, emission_strength=0.0,
             alpha=1.0, texture=None):
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    # Single sided on purpose: every part is a closed volume, and the target iGPU pays for
    # double-sided fill on every pixel it draws.
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if texture is not None:
        # Only a direct Principled connection survives the glTF export: a texture on Base Color
        # becomes baseColorTexture, anything fancier is dropped without a warning.
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
    """Paint one seamless grey skin map: panel lines, rivets and access panels.

    Every pattern is periodic over the tile, so the box projection can wrap anywhere without a
    seam. The values are the sRGB display values the PNG will hold, which is also what the renderer
    sees before tone mapping.
    """
    size = TEXTURE_SIZE
    generator = random.Random(SEED + 7)
    panels = size // PANEL_PIXELS
    cell = 16
    cells = size // cell
    mottle = [[generator.uniform(-0.030, 0.030) for _ in range(cells)] for _ in range(cells)]
    jitter = [generator.randrange(-3, 4) for _ in range(panels)]
    columns = [index * PANEL_PIXELS + jitter[index] for index in range(panels)]
    rows = [index * PANEL_PIXELS + jitter[(index * 5) % panels] for index in range(panels)]

    on_column = [False] * size
    for line in columns:
        for delta in (-1, 0, 1):
            on_column[(line + delta) % size] = True
    on_row = [False] * size
    for line in rows:
        for delta in (-1, 0, 1):
            on_row[(line + delta) % size] = True

    inner = set()
    edge = set()
    for _ in range(8):
        width = generator.randrange(2, 5) * PANEL_PIXELS
        height = generator.randrange(1, 3) * PANEL_PIXELS
        x0 = generator.randrange(6, size - width - 6)
        y0 = generator.randrange(6, size - height - 6)
        for y in range(y0, y0 + height):
            base = y * size
            for x in range(x0, x0 + width):
                if x in (x0, x0 + width - 1) or y in (y0, y0 + height - 1):
                    edge.add(base + x)
                else:
                    inner.add(base + x)

    pixels = [0.0] * (size * size * 4)
    for y in range(size):
        base = y * size
        row_cell = (y // cell) % cells
        row_line = on_row[y]
        for x in range(size):
            value = 0.545 + mottle[row_cell][(x // cell) % cells]
            if row_line or on_column[x]:
                value = 0.442
                if x % RIVET_PIXELS < 1 and y % RIVET_PIXELS < 1:
                    value = 0.418
            index = base + x
            if index in edge:
                value = 0.468
            elif index in inner:
                value += 0.012
            value = min(1.0, max(0.0, value))
            offset = index * 4
            pixels[offset] = value
            pixels[offset + 1] = min(1.0, value * 1.004)
            pixels[offset + 2] = min(1.0, value * 1.014)
            pixels[offset + 3] = 1.0
    image = bpy.data.images.new(TEXTURE_NAME, size, size, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.file_format = "PNG"
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def make_materials(texture):
    # Dark base colours on purpose: the renderer tone maps the scene, and a bright hull washes the
    # shape out. Emission stays well under 2 or the tone mapping turns the glow white.
    material("NovaSkin", (1.0, 1.0, 1.0), 0.440, 0.220, texture=texture)
    material("NovaHull", (0.068, 0.076, 0.094), 0.400, 0.550)
    material("NovaPanel", (0.300, 0.322, 0.360), 0.320, 0.880)
    material("NovaFrame", (0.048, 0.052, 0.060), 0.540, 0.420)
    material("NovaAccent", (0.020, 0.088, 0.140), 0.420, 0.620)
    material("NovaAccentWarm", (0.300, 0.140, 0.030), 0.460, 0.500)
    material("NovaDuct", (0.014, 0.015, 0.018), 0.800, 0.160)
    material("NovaGlass", (0.024, 0.032, 0.048), 0.080, 0.000, alpha=0.420)
    material("NovaCockpit", (0.030, 0.033, 0.038), 0.760, 0.100)
    material("NovaTire", (0.020, 0.020, 0.021), 0.930, 0.050)
    material("NovaMetal", (0.310, 0.330, 0.360), 0.280, 0.900)
    material("NovaBurner", (0.046, 0.030, 0.088), 0.480, 0.000,
             emission=(0.300, 0.420, 1.000), emission_strength=1.700)
    material("NovaDisplay", (0.016, 0.048, 0.058), 0.400, 0.000,
             emission=(0.150, 0.850, 0.950), emission_strength=1.200)
    material("NovaMuzzle", (0.040, 0.024, 0.014), 0.400, 0.000,
             emission=(1.000, 0.450, 0.100), emission_strength=1.300)
    material("NovaLightRed", (0.040, 0.010, 0.010), 0.400, 0.000,
             emission=(0.900, 0.070, 0.040), emission_strength=0.900)
    material("NovaLightGreen", (0.010, 0.040, 0.012), 0.400, 0.000,
             emission=(0.090, 0.900, 0.160), emission_strength=0.900)
    material("NovaLightWhite", (0.050, 0.050, 0.050), 0.400, 0.000,
             emission=(0.900, 0.870, 0.760), emission_strength=0.700)


# ---------------------------------------------------------------- part builder


class Part:
    """Collects world-space geometry, then builds one object whose origin is its hinge.

    `rotation_degrees` is the object's base orientation, for a hinge that is not parallel to an
    axis (the canted wingtip fins). The mesh is written in that rotated local frame, so the part
    sits exactly where the world coordinates say while its local axes stay the hinge axes.
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

    def build(self, parent=None):
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
    into a hull plate about 0.75 m wide. The three axes get different offsets so the projections do
    not line up into one obvious grid.
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


def attach(child, parent):
    """Parent without moving the child. `matrix_world` is only valid after a view layer update,
    and a stale identity there is what silently displaces children."""
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def finalize_mesh(mesh, sharp_degrees=34.0):
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


def build_hull(root):
    """Chined fuselage, dorsal spine, chine strakes, ventral keel and the cockpit sill."""
    part = Part("hull")
    part.add_loft([profile_ring(*station) for station in FUSELAGE], "NovaSkin")
    part.add_loft([profile_ring(*station) for station in SPINE], "NovaPanel")
    # Chine strakes along the widest line: the edge that makes the hull read as faceted.
    for sign in (-1.0, 1.0):
        stations = (5.40, 3.60, 1.60, -0.60, -2.80)
        path = []
        radii = []
        for y in stations:
            half_width, chine_z = fuselage_chine(y)
            path.append((sign * (half_width - 0.02), y, chine_z))
            radii.append(0.055 + 0.02 * (y / 5.40) ** 2)
        part.add_tube(path, tuple(radii), "NovaPanel", sides=4, flatten=0.45)
    # Ventral strake: a real fin rather than a box, so the silhouette from below stays sharp.
    part.add_loft(fin_rings(((-0.74, 0.70, -2.70, 0.18), (-1.18, 0.10, -2.30, 0.13),
                             (-1.42, -0.40, -1.90, 0.08)), 0.0), "NovaFrame")
    return part.build(root)


def build_cockpit_sill(root):
    """Static frame around the canopy opening, so the glass sits in something."""
    part = Part("cockpit_sill")
    for sign in (-1.0, 1.0):
        part.add_tube([(sign * 0.56, 4.30, fuselage_top(4.30) + 0.06),
                       (sign * 0.62, 3.40, fuselage_top(3.40) + 0.10),
                       (sign * 0.62, 2.40, fuselage_top(2.40) + 0.10)],
                      (0.075, 0.085, 0.085), "NovaFrame", sides=5, flatten=0.7)
    part.add_box((0.0, 2.32, fuselage_top(2.32) + 0.10), (1.40, 0.16, 0.26), "NovaFrame", axis="y")
    part.add_box((0.0, 4.32, fuselage_top(4.32) + 0.04), (1.10, 0.14, 0.18), "NovaFrame", axis="y")
    return part.build(root)


def build_wings(root, objects):
    """Cranked delta panels, their elevons and the foreplanes."""
    part = Part("wings")
    for sign in (-1.0, 1.0):
        part.add_loft(wing_rings(wing_cut_sections(), sign), "NovaSkin")
        part.add_loft(wing_rings(CANARD_SECTIONS, sign), "NovaSkin")
        # Wing fence between the inner and the outer panel.
        part.add_box((sign * 3.90, 0.10, -0.30), (0.07, 1.70, 0.30), "NovaHull", axis="x")
    part.build(root)

    for sign, label in ((-1.0, "left"), (1.0, "right")):
        y_le, y_te, thickness, z_centre = section_at(WING_SECTIONS, ELEVON_START_X)
        chord = y_le - y_te
        hinge_y = y_te + ELEVON_CHORD_FRACTION * chord
        elevon = Part(f"elevon_{label}", pivot=(sign * ELEVON_START_X, hinge_y, z_centre))
        elevon.add_loft(wing_rings(elevon_sections(), sign), "NovaHull")
        objects[f"elevon_{label}"] = elevon.build(root)

        canard = Part(f"canard_{label}",
                      pivot=(sign * CANARD_SECTIONS[0][0], CANARD_SECTIONS[0][1] - 0.42,
                             CANARD_SECTIONS[0][4]))
        canard.add_loft(wing_rings(CANARD_SECTIONS, sign), "NovaPanel")
        objects[f"canard_{label}"] = canard.build(root)


def build_fins(root, objects):
    """Two canted wingtip fins, each with its rudder as the aft moving panel."""
    for sign, label in ((-1.0, "left"), (1.0, "right")):
        cant = sign * FIN_CANT_DEGREES
        fin = Part(f"fin_{label}", pivot=(sign * FIN_X, RUDDER_HINGE_Y, -0.30),
                   rotation_degrees=(0.0, cant, 0.0))
        fin.add_loft(fin_rings(FIN_SECTIONS, sign * FIN_X), "NovaSkin")
        fin.build(root)

        rudder = Part(f"rudder_{label}", pivot=(sign * FIN_X, RUDDER_HINGE_Y, -0.30),
                      rotation_degrees=(0.0, cant, 0.0))
        rudder_sections = tuple((height, RUDDER_HINGE_Y, y_te, thickness * 0.6)
                                for (height, _y_le, y_te, thickness) in FIN_SECTIONS)
        rudder.add_loft(fin_rings(rudder_sections, sign * FIN_X), "NovaHull")
        objects[f"rudder_{label}"] = rudder.build(root)


def build_engines(root, objects):
    """Two side pods, their iris nozzles and the afterburner plumes."""
    pods = Part("engine_pods")
    for sign in (-1.0, 1.0):
        path = [(sign * point[0], point[1], point[2]) for point in ENGINE_PATH]
        pods.add_tube(path, ENGINE_RADII, "NovaHull", sides=14)
        # Intake lip: a dark ring that sticks out just ahead of the pod.
        pods.add_tube([(sign * ENGINE_X, -2.46, 0.02), (sign * ENGINE_X, -2.06, 0.04)],
                      (0.62, 0.50), "NovaDuct", sides=14)
        # Stiffener ribs along the pod, and the metal ring the iris petals sit in.
        for rib_y in (-3.05, -4.25, -5.25):
            radius, rib_z = engine_station(rib_y)
            pods.add_tube([(sign * ENGINE_X, rib_y - 0.06, rib_z), (sign * ENGINE_X, rib_y + 0.06, rib_z)],
                          (radius + 0.035, radius + 0.035), "NovaPanel", sides=14)
        pods.add_tube([(sign * ENGINE_X, -5.88, -0.02), (sign * ENGINE_X, -6.04, -0.02)],
                      (0.56, 0.53), "NovaMetal", sides=14)
    pods.build(root)

    for sign, label in ((-1.0, "left"), (1.0, "right")):
        petals = Part(f"nozzle_petals_{label}", pivot=(sign * ENGINE_X, NOZZLE_Y, 0.0))
        for index in range(NOZZLE_PETALS):
            angle = 2.0 * math.pi * index / NOZZLE_PETALS
            profile = ((0.00, NOZZLE_INNER_RADIUS), (0.00, NOZZLE_OUTER_RADIUS),
                       (-0.44, NOZZLE_OUTER_RADIUS + 0.05), (-0.44, NOZZLE_INNER_RADIUS + 0.04))
            petals.add_loft(petal_rings(angle, 2.0 * math.pi / NOZZLE_PETALS, profile), "NovaMetal")
        objects[f"nozzle_petals_{label}"] = petals.build(root)

        burner = Part(f"afterburner_{label}_noshadow_nocol",
                      pivot=(sign * ENGINE_X, NOZZLE_Y, 0.0))
        burner.add_loft([
            [(math.cos(2.0 * math.pi * i / 12) * 0.30, 0.00, math.sin(2.0 * math.pi * i / 12) * 0.30)
             for i in range(12)],
            [(math.cos(2.0 * math.pi * i / 12) * 0.22, -0.55, math.sin(2.0 * math.pi * i / 12) * 0.22)
             for i in range(12)],
            [(math.cos(2.0 * math.pi * i / 12) * 0.06, -1.55, math.sin(2.0 * math.pi * i / 12) * 0.06)
             for i in range(12)],
        ], "NovaBurner")
        flame = burner.build(root)
        # The plume rests as a stub: the rest pose is what a viewer without a running clip shows.
        flame.scale = Vector((BURNER_RADIAL_SCALE, BURNER_STUB_SCALE, BURNER_RADIAL_SCALE))
        objects[burner.name] = flame


def build_canopy(root, objects):
    """Tinted canopy, hinged at its rear frame."""
    canopy = Part("canopy", pivot=CANOPY_PIVOT)
    stations = ((4.32, 0.34, 0.18), (3.80, 0.54, 0.32), (3.10, 0.62, 0.40),
                (2.60, 0.56, 0.34), (2.30, 0.40, 0.22))
    profile = ((0.00, 1.00), (0.52, 0.86), (0.92, 0.36), (0.88, -0.34), (0.00, -1.00))
    rings = []
    for y, half_width, half_height in stations:
        centre = fuselage_top(y) + 0.14
        right = [(u * half_width, y, centre + v * half_height) for (u, v) in profile]
        left = [(-u * half_width, y, centre + v * half_height) for (u, v) in reversed(profile[1:-1])]
        rings.append(right + left)
    canopy.add_loft(rings, "NovaGlass")
    objects["canopy"] = canopy.build(root)


def build_cockpit(root):
    """Interior behind the glass: floor, seat, panel and two glowing displays."""
    part = Part("nova_cockpit_interior_noshadow_nocol")
    part.add_box((0.0, 3.30, 0.72), (0.94, 1.90, 0.10), "NovaCockpit", axis="y")
    part.add_box((0.0, 2.86, 0.98), (0.42, 0.30, 0.46), "NovaCockpit", axis="y")
    part.add_box((0.0, 3.86, 1.00), (0.60, 0.18, 0.34), "NovaCockpit", axis="y")
    part.add_box((0.0, 3.80, 1.04), (0.44, 0.06, 0.20), "NovaDisplay", axis="y")
    part.add_box((0.0, 3.52, 1.02), (0.16, 0.10, 0.14), "NovaDisplay", axis="y")
    return part.build(root)


def build_gear(root, objects):
    """Nose and main legs with their doors, and the wheels that ride on the legs."""
    door_parts = {
        "door_nose": (Part("door_nose", pivot=(0.34, 4.28, -0.62)), (0.34, 4.28, -0.94), (0.30, 1.10, 0.06)),
        "door_left": (Part("door_left", pivot=(-1.24, -1.10, -0.40)), (-1.24, -1.10, -0.62), (0.06, 1.30, 0.44)),
        "door_right": (Part("door_right", pivot=(1.24, -1.10, -0.40)), (1.24, -1.10, -0.62), (0.06, 1.30, 0.44)),
    }
    for name, (part, centre, size) in door_parts.items():
        part.add_box(centre, size, "NovaFrame", axis="x")
        objects[name] = part.build(root)

    for name, spec in GEAR_LEGS.items():
        leg = Part(name, pivot=spec["pivot"])
        midpoint = tuple((spec["pivot"][i] + spec["strut"][i]) * 0.5 for i in range(3))
        leg.add_box(midpoint, (0.16, 0.20, 0.62), "NovaMetal")
        leg.add_tube([spec["pivot"], spec["strut"]], (0.13, 0.11), "NovaMetal", sides=8)
        axle = spec["width"] * 0.75
        leg.add_tube([(spec["wheel"][0], spec["wheel"][1] - axle, spec["wheel"][2]),
                      (spec["wheel"][0], spec["wheel"][1] + axle, spec["wheel"][2])],
                     (0.07, 0.07), "NovaMetal", sides=6)
        objects[name] = leg.build(root)

        wheel_name = f"wheel_{'nose' if name == 'gear_nose' else name.split('_')[1]}"
        wheel = Part(wheel_name, pivot=spec["wheel"])
        wheel.add_loft(wheel_rings(spec["wheel"], spec["radius"], spec["width"]), "NovaTire")
        objects[wheel_name] = wheel.build(objects[name])


def build_weapons(root):
    """Two wing-root cannons and four underwing pylons with stores."""
    part = Part("weapons")
    for sign in (-1.0, 1.0):
        part.add_tube([(sign * 1.46, 2.30, -0.06), (sign * 1.46, 0.30, -0.08)],
                      (0.15, 0.13), "NovaMetal", sides=8)
        part.add_box((sign * 1.46, 0.22, -0.08), (0.12, 0.24, 0.12), "NovaMuzzle", axis="y")
        for pylon_y in (-0.20, -1.30):
            _y_le, _y_te, _thickness, z_centre = section_at(WING_SECTIONS, 3.10)
            part.add_box((sign * 3.10, pylon_y, z_centre - 0.14), (0.12, 0.60, 0.22),
                         "NovaPanel", axis="y")
            part.add_tube([(sign * 3.10, pylon_y - 0.30, z_centre - 0.30),
                           (sign * 3.10, pylon_y - 1.90, z_centre - 0.32)],
                          (0.12, 0.10), "NovaHull", sides=8)
            part.add_box((sign * 3.10, pylon_y - 1.95, z_centre - 0.32), (0.10, 0.22, 0.10),
                         "NovaAccentWarm", axis="y")
    return part.build(root)


def build_details(root):
    """Antennas, sensors, greebles and navigation lights - all trim."""
    generator = random.Random(SEED)
    part = Part("nova_details_noshadow_nocol")
    spine_top = fuselage_top(0.40) + 0.24
    part.add_tube([(0.30, 0.40, spine_top), (0.30, 0.40, spine_top + 1.10)],
                  (0.045, 0.020), "NovaMetal", sides=5)
    aft_top = fuselage_top(-2.60) + 0.20
    part.add_tube([(-0.34, -2.60, aft_top), (-0.34, -2.60, aft_top + 0.90)],
                  (0.040, 0.016), "NovaMetal", sides=5)
    for sign in (-1.0, 1.0):
        for y in (1.20, -0.40, -2.00):
            half_width, chine_z = fuselage_chine(y)
            part.add_loft(blister_rings((sign * (half_width - 0.03), y, chine_z + 0.16), 0.10),
                          "NovaDuct")
            part.add_box((sign * (half_width - 0.10), y - 0.55, chine_z - 0.30),
                         (0.14, 0.34, 0.10), "NovaFrame", axis="y")
        # Cooling vent on the flank, just ahead of the pod it feeds.
        half_width, chine_z = fuselage_chine(-1.75)
        part.add_box((sign * (half_width - 0.05), -1.75, chine_z + 0.06),
                     (0.10, 0.52, 0.24), "NovaDuct", axis="y")
        # Nose vanes: two thin plates that break the long nose up in profile.
        part.add_loft(fin_rings(((0.10, 6.62, 5.66, 0.07), (0.46, 6.42, 5.76, 0.05)),
                                sign * 0.40), "NovaPanel")
    # Greebles on the dorsal deck, where a texture cannot show a raised box.
    for _ in range(22):
        y = generator.uniform(-5.20, 2.40)
        deck = max(0.18, fuselage_deck_half_width(y) - 0.12)
        part.add_box((generator.uniform(-deck, deck), y,
                      fuselage_top(y) + generator.uniform(-0.02, 0.06)),
                     (generator.uniform(0.16, 0.42), generator.uniform(0.30, 0.90),
                      generator.uniform(0.06, 0.16)), "NovaFrame", axis="y")
    part.build(root)

    lights = Part("nova_nav_lights_noshadow_nocol")
    lights.add_loft(blister_rings((-5.16, -0.30, -0.10), 0.14), "NovaLightRed")
    lights.add_loft(blister_rings((5.16, -0.30, -0.10), 0.14), "NovaLightGreen")
    lights.add_loft(blister_rings((0.0, -6.22, 0.26), 0.13), "NovaLightWhite")
    lights.build(root)

    nose = Part("nose_tip_noshadow_nocol", pivot=(0.0, 7.57, 0.04))
    nose.add_tube([(0.0, 7.28, 0.05), (0.0, 7.86, 0.03)], (0.045, 0.020), "NovaMetal", sides=6)
    nose.build(root)

    tail = Part("tail_plate_noshadow_nocol", pivot=(0.0, -6.28, 0.10))
    tail.add_box((0.0, -6.28, 0.10), (1.30, 0.14, 0.90), "NovaFrame", axis="y")
    tail.build(root)


def build_airbrakes(root, objects):
    """Two plates on the dorsal spine, hinged along their inboard edge."""
    for sign, label in ((-1.0, "left"), (1.0, "right")):
        pivot = (sign * 0.18, -3.30, 0.84)
        plate = Part(f"airbrake_{label}", pivot=pivot)
        plate.add_box((sign * 0.62, -3.30, 0.84), (0.86, 1.50, 0.07), "NovaPanel", axis="x")
        objects[f"airbrake_{label}"] = plate.build(root)


def build_all():
    root = bpy.data.objects.new("scifi_fighter", None)
    bpy.context.collection.objects.link(root)
    root.empty_display_size = 1.0
    objects = {}
    build_hull(root)
    build_cockpit_sill(root)
    build_wings(root, objects)
    build_fins(root, objects)
    build_engines(root, objects)
    build_canopy(root, objects)
    build_cockpit(root)
    build_gear(root, objects)
    build_weapons(root)
    build_details(root)
    build_airbrakes(root, objects)
    return root, objects


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
        """Deflect a control surface about its own hinge: the local x axis."""
        self.rot(obj, frame, (angle_degrees, math.degrees(obj.rotation_euler.y),
                              math.degrees(obj.rotation_euler.z)))

    def yaw(self, obj, frame, angle_degrees):
        """Deflect about the vertical axis, on top of the object's base cant."""
        self.rot(obj, frame, (0.0, math.degrees(obj.rotation_euler.y),
                              math.degrees(obj.rotation_euler.z) + angle_degrees))

    def loc(self, obj, frame, vector):
        self._channel(obj, "location")[frame] = tuple(vector)

    def scale(self, obj, frame, vector):
        self._channel(obj, "scale")[frame] = tuple(vector)

    def apply(self, linear_objects=()):
        for _name, entry in self.channels.items():
            obj = entry["obj"]
            action = bpy.data.actions.new(self.name)
            action.use_fake_user = True
            if obj.animation_data is None:
                obj.animation_data_create()
            obj.animation_data.action = action
            for path in ("rotation_euler", "location", "scale"):
                for frame, value in sorted(entry[path].items()):
                    setattr(obj, path, value)
                    obj.keyframe_insert(data_path=path, frame=frame)
            for fcurve in action.fcurves:
                for point in fcurve.keyframe_points:
                    point.interpolation = "LINEAR" if obj.name in linear_objects else "BEZIER"
            track = obj.animation_data.nla_tracks.new()
            track.name = self.name
            track.strips.new(self.name, 0, action)
            obj.animation_data.action = None


def build_clips(objects):
    clips = []

    # A four second flight-control loop: pitch, a roll each way, ending where it started.
    clip = Clip("flight_controls", 120)
    script = ((0, 0.0, 0.0, 0.0, 0.0),
              (24, 10.0, 0.0, -6.0, 8.0),
              (48, -6.0, 12.0, 4.0, 14.0),
              (72, 4.0, -12.0, -4.0, -14.0),
              (96, -8.0, 6.0, 5.0, 6.0),
              (120, 0.0, 0.0, 0.0, 0.0))
    for frame, elevon, differential, canard, rudder in script:
        clip.hinge(objects["elevon_left"], frame, elevon + differential)
        clip.hinge(objects["elevon_right"], frame, elevon - differential)
        clip.hinge(objects["canard_left"], frame, canard - differential * 0.3)
        clip.hinge(objects["canard_right"], frame, canard + differential * 0.3)
        clip.yaw(objects["rudder_left"], frame, rudder)
        clip.yaw(objects["rudder_right"], frame, rudder)
    clips.append(clip)

    # Gear. The rest pose is the parked fighter with the gear down, so `gear_down` ends there and
    # `gear_up` starts there. `gear_down` is pushed onto the NLA stack first: a strip on top of
    # another replaces its channels, and the topmost of the two has to hold the rest pose at
    # frame 0 or the blend file would open with the legs already up.
    for name, up in (("gear_down", False), ("gear_up", True)):
        clip = Clip(name, 90)
        door_keys = ((0, 0.0), (18, DOOR_OPEN_DEGREES), (70, DOOR_OPEN_DEGREES), (90, 0.0))
        if up:
            leg_keys = ((0, 0.0), (18, 0.0), (30, 16.0),
                        (64, GEAR_RETRACT_DEGREES), (90, GEAR_RETRACT_DEGREES))
        else:
            leg_keys = ((0, GEAR_RETRACT_DEGREES), (18, GEAR_RETRACT_DEGREES), (30, 84.0),
                        (64, 2.0), (90, 0.0))
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
    for frame, angle in ((0, 0.0), (10, 5.0), (34, CANOPY_OPEN_DEGREES), (36, CANOPY_OPEN_DEGREES)):
        clip.rot(objects["canopy"], frame, (angle, 0.0, 0.0))
    clips.append(clip)

    clip = Clip("airbrake_open", 24)
    for frame, angle in ((0, 0.0), (8, 10.0), (22, AIRBRAKE_OPEN_DEGREES), (24, AIRBRAKE_OPEN_DEGREES)):
        clip.rot(objects["airbrake_left"], frame, (0.0, angle, 0.0))
        clip.rot(objects["airbrake_right"], frame, (0.0, -angle, 0.0))
    clips.append(clip)

    clip = Clip("nozzle_iris", 45)
    for frame, iris in ((0, 1.00), (12, 0.88), (30, 1.05), (45, 1.00)):
        clip.scale(objects["nozzle_petals_left"], frame, (iris, 1.0, iris))
        clip.scale(objects["nozzle_petals_right"], frame, (iris, 1.0, iris))
    clips.append(clip)

    clip = Clip("afterburner", 60)
    for label in ("left", "right"):
        flame = objects[f"afterburner_{label}_noshadow_nocol"]
        for frame, scale in ((0, BURNER_STUB_SCALE), (18, 1.00), (44, 0.94),
                             (60, BURNER_STUB_SCALE)):
            # Axial scale is the flame length; the plume keeps a wider mouth than a thin needle.
            radial = 0.24 + 0.76 * scale
            clip.scale(flame, frame, (radial, scale, radial))
    clips.append(clip)

    clip = Clip("wheel_roll", 30)
    for name in ("wheel_nose", "wheel_left", "wheel_right"):
        for frame in range(0, 31, 3):
            clip.rot(objects[name], frame, (frame * 12.0, 0.0, 0.0))
    clips.append(clip)

    linear = {"wheel_nose", "wheel_left", "wheel_right"}
    for entry in clips:
        entry.apply(linear_objects=linear)
    return clips


# ---------------------------------------------------------------- assembly and export


def export_blend(path, clips):
    path.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.frame_end = max([clip.length for clip in clips] + [1])
    scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    print(f"[nova] blend: {path} ({path.stat().st_size / 1024:.0f} KiB)")


def export_glb(path, animated):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB",
        export_yup=True, export_apply=True, export_extras=True,
        export_cameras=False, export_lights=False,
        export_animations=animated,
        export_animation_mode="NLA_TRACKS" if animated else "ACTIONS",
        export_anim_scene_split_object=False, export_anim_slide_to_zero=True,
    )
    print(f"[nova] glb: {path} ({path.stat().st_size / 1024:.1f} KiB)")


def report_bounds():
    """Parked bounds in the game's axes (y up, forward -z), with the part that sets each one.

    The scene is put on frame 0 first: writing keyframes leaves the last pose in the evaluated
    object, and a wheel sitting at 12 degrees of its roll clip would widen the measured box.
    """
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    lowest = (None, "")
    highest = (None, "")
    widest = (0.0, "")
    longest = (0.0, "")
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            if lowest[0] is None or world.z < lowest[0]:
                lowest = (world.z, obj.name)
            if highest[0] is None or world.z > highest[0]:
                highest = (world.z, obj.name)
            if abs(world.x) > widest[0]:
                widest = (abs(world.x), obj.name)
            if abs(world.y) > longest[0]:
                longest = (abs(world.y), obj.name)
    print(f"[nova]   parked bounds (game units, y up): ground {lowest[0]:.3f} ({lowest[1]}), "
          f"top {highest[0]:.3f} ({highest[1]})")
    print(f"[nova]   reach: half span {widest[0]:.3f} ({widest[1]}), "
          f"half length {longest[0]:.3f} ({longest[1]})")


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
    colored = len([primitive for primitive in primitives
                   if primitive.get("attributes", {}).get("COLOR_0") is not None])
    textured = len([mat for mat in document.get("materials", [])
                    if mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")])
    print(f"[nova] glb summary: {path.stat().st_size / 1024:.1f} KiB, {triangles} triangles, "
          f"{len(primitives)} primitives, {len(document.get('nodes', []))} nodes, "
          f"{len(document.get('materials', []))} materials")
    print(f"[nova]   textures: {len(document.get('images', []))} embedded image(s), "
          f"{textured} material(s) painted, {colored} primitive(s) carry COLOR_0")
    for animation in document.get("animations", []):
        duration = max([0.0] + [float(accessors[sampler["input"]].get("max", [0])[0])
                                for sampler in animation.get("samplers", [])])
        print(f"[nova]   clip {animation.get('name'):24s} {duration:5.2f} s  "
              f"{len(animation.get('channels', []))} channels")
    return {"triangles": triangles, "primitives": len(primitives),
            "kib": path.stat().st_size / 1024, "colored": colored,
            "clips": [animation.get("name") for animation in document.get("animations", [])]}


def parse_args():
    parser = argparse.ArgumentParser()
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser.add_argument("--output-blend", type=Path, default=SOURCE_DIR / f"{PART_NAME}.blend")
    parser.add_argument("--output-glb", type=Path, default=GLB_DIR / f"{PART_NAME}.glb")
    parser.add_argument("--no-animation", action="store_true")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    reset_scene()
    make_materials(build_skin_texture())
    root, objects = build_all()
    # Writing a keyframe sets the property first, so clipping leaves every animated object on its
    # last key. The rest transforms are captured here and put back before saving and exporting,
    # which is what makes the node transforms - and the pose of a viewer that plays no clip - the
    # parked fighter with the gear down, the canopy shut and the plume a stub.
    rest = {obj.name: (obj.location.copy(), obj.rotation_euler.copy(), obj.scale.copy())
            for obj in bpy.data.objects}
    clips = [] if args.no_animation else build_clips(objects)
    for obj in bpy.data.objects:
        if obj.name in rest:
            location, rotation, scale = rest[obj.name]
            obj.location = location
            obj.rotation_euler = rotation
            obj.scale = scale

    root["asset"] = "scifi_fighter"
    root["clips"] = ",".join(clip.name for clip in clips)
    root["movable_parts"] = ",".join(sorted(objects))
    report_bounds()

    export_blend(args.output_blend, clips)
    export_glb(args.output_glb, animated=not args.no_animation)
    summarize_glb(args.output_glb)


if __name__ == "__main__":
    main()
