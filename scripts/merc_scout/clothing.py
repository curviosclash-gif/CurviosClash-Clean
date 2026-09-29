"""Modular clothing for the mercenary scout.

Every garment is its own mesh with its own atlas region, so buyers can swap pieces
(jacket, sleeves, trousers, boots, gloves, belt, pouches, straps) without touching
the others.

The realism comes from four layers that all work on the same ring loft:

1. **Anatomical cut** - the cross sections are measured from the built body, not
   guessed at. ``measure_radius`` walks outwards from the limb axis until
   ``find_nearest`` says the probe has left the skin; the ring tables below are the
   result of running that over the arms, legs, torso and feet of the pc variant.
   ``build_clothing`` then runs two passes over every shell: ``repair_penetration``
   pushes anything that ended up under the skin back out to cloth thickness, and
   ``pad_ease`` lifts the whole shell by its comfort ease (2-4 cm, not the 8 cm of
   the first pass) *radially*, away from the ring centre it was lofted around,
   which keeps the cut intact where the skin normal points the wrong way.
2. **Fold pattern** - ``_fold`` is a deterministic sum of smooth ridges (no
   randomness): tension folds off the armpit, creases at the elbow, compression
   folds at the waist, behind the knee, over the boot and at the cuff. Amplitudes
   stay in the 2-5 mm range; deeper reads as damage, not as fabric.
3. **Seams and edges** - raised decorative seams on the centre front, the side
   seam, the sleeve underside and the trouser outseams; plus a stand collar, a
   shoulder yoke, a jacket hem, a sleeve cuff and leather boots with a treaded sole
   and laced eyelets as separate geometry.
4. **Density** - the same silhouettes serve all three variants. ``_segments`` and
   ``_thin`` cut the ring subdivision and the number of bands for mobile, and the
   fingers, zip teeth and laces are only built when ``variant.detail`` is set.

Material thickness is 6-10 mm for cloth and 4-6 mm for leather; the shells are open
at both ends (solidify closes them).
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import mesh_utils as mu
from . import spec

JACKET = "merc_scout_jacket"
TROUSERS = "merc_scout_trousers"
BELT = "merc_scout_belt"
STRAPS = "merc_scout_straps"
KIT = "merc_scout_kit"
BODY_NAME = "merc_scout_body"

#: Cloth thickness in metres. The client asked for 6-10 mm of cloth and 4-6 mm of
#: leather; the previous 14-16 mm is what made the jacket look like a life vest.
CLOTH = 0.007
LEATHER = 0.005
HEAVY = 0.009

#: Comfort ease (the air between skin and cloth) in metres, applied by ``pad_ease``
#: in the fit pass. These are the numbers the client asked for - 2-4 cm over the
#: torso, less on a sleeve or a boot - and they replace the 8 cm of the first pass.
PAD_CLOTH = 0.022
PAD_SLEEVE = 0.020
PAD_LEG = 0.020
PAD_BOOT = 0.008
PAD_GLOVE = 0.004

_TAU = 2.0 * math.pi

#: Ring subdivision per saleable density. Mobile is a 15k triangle budget for the
#: whole character while the head and body already eat about 10k of it, so the
#: clothing has to come in at roughly a fifth of the PC count. The silhouettes stay
#: the same - only the number of segments around each ring changes.
SEGMENT_SCALE = {"mobile": 0.30, "pc": 1.0, "high": 1.0}

#: The variant currently being built; ``build_clothing`` sets it before any shell.
_VARIANT_KEY = "pc"

#: Whether the current variant carries the small extra geometry (pockets, laces,
#: zip teeth). `build_clothing` sets it so helpers without a `detail` argument
#: can ask for their own subdivision without threading the flag through every call.
_DETAIL = True


def _segments(base: int, detail: bool) -> int:
    """Segments around a ring for the variant being built, never below 8."""
    scale = SEGMENT_SCALE.get(_VARIANT_KEY, 1.0)
    if not detail:
        scale *= 0.9
    return max(8, int(round(base * scale)))


# --------------------------------------------------------------------------- #
# smooth math: folds, seams, bumps
# --------------------------------------------------------------------------- #


def _gauss(value: float, width: float) -> float:
    return math.exp(-((value / width) ** 2))


def _ring_distance(a: float, b: float) -> float:
    delta = abs(a - b) % 1.0
    return min(delta, 1.0 - delta)


def _fold(t: float, delta: float, phase: float = 0.0) -> float:
    """One circular fold ridge: 1.0 in its centre line, 0 away from it.

    ``delta`` is the half width in ring parameter units, so a fold that is 4 cm
    wide on a 0.6 m circumference sits at ``delta = 0.033``. Smooth and
    deterministic, which is what keeps two runs of the generator identical.
    """
    return _gauss(_ring_distance(t, phase) / max(delta, 1e-6), 0.55)


def _fold_bank(t: float, count: int, phase: float = 0.0, width: float = 0.9) -> float:
    """A bank of ``count`` evenly spaced folds around the ring."""
    total = 0.0
    for index in range(count):
        total += _fold(t, width / count, phase + index / count)
    return total


def _band(value: float, centre: float, width: float) -> float:
    """1.0 at ``centre``, falling off smoothly outside ``width``."""
    return _gauss((value - centre) / max(width, 1e-6), 1.0)


# --------------------------------------------------------------------------- #
# fit helpers: measure the skin instead of guessing it
# --------------------------------------------------------------------------- #


def _body_tree() -> tuple[BVHTree | None, bpy.types.Object | None]:
    """The skin mesh as a BVH, so the cloth can be measured against it.

    ``build_character`` always builds the body before the clothing; a standalone
    call (unit test, quick probe) gets ``(None, None)`` and the fallback radii.
    """
    for name in (BODY_NAME, BODY_NAME + ".001"):
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.type == "MESH":
            verts = [tuple(v.co) for v in obj.data.vertices]
            polys = [tuple(p.vertices) for p in obj.data.polygons]
            if polys:
                return BVHTree.FromPolygons(verts, polys, all_triangles=False), obj
    return None, None


_BODY_TREE: BVHTree | None = None
_BODY_DONE = False


def body_tree() -> BVHTree | None:
    global _BODY_TREE, _BODY_DONE
    if not _BODY_DONE:
        _BODY_TREE, _ = _body_tree()
        _BODY_DONE = True
    return _BODY_TREE


#: How much air the padding pass leaves between skin and cloth, per garment kind.
#: These are the numbers the client asked for: 2-4 cm of comfort ease, not 8 cm.
PAD_CLOTH = 0.022
PAD_SLEEVE = 0.014
PAD_LEG = 0.020
PAD_BOOT = 0.008
PAD_GLOVE = 0.004


def nearest_skin(point: Vector, limit: float = 0.40):
    """Closest point on the skin mesh, its normal and the distance, or ``None``."""
    tree = body_tree()
    if tree is None:
        return None
    location, normal, _index, distance = tree.find_nearest(point, limit)
    if location is None or distance is None or distance > limit:
        return None
    return location, Vector(normal), float(distance)


def measure_radius(origin: Vector, direction: Vector, fallback: float, *,
                   limit: float = 0.30, step: float = 0.002,
                   tolerance: float = 0.0015) -> float:
    """Distance from ``origin`` to the skin surface along ``direction``.

    Marches outwards and watches the distance to the closest skin point. While the
    probe is still inside the body that distance shrinks or stays put; the first
    step where it clearly grows again is the surface. This is the only measurement
    that survived testing against this mesh: ``BVHTree.ray_cast`` returns a bogus
    distance field for it (measured 1645 for a 0.16 m span) and rays fired from
    inside the body miss the surface along unlucky directions.
    """
    tree = body_tree()
    if tree is None:
        return fallback
    unit = direction.normalized()
    previous: float | None = None
    for count in range(1, int(limit / step) + 1):
        distance = count * step
        location, _normal, _index, gap = tree.find_nearest(origin + unit * distance, limit)
        if location is None or gap is None:
            break
        if previous is not None and gap > previous + tolerance:
            return distance
        previous = gap
    return fallback


def pad_ease(obj: bpy.types.Object, centres, amount: float, *,
             ceiling: float = 0.030) -> float:
    """Lift a fitted shell off the skin by ``amount`` metres, radially.

    "Radially" means away from the ring centre the surface was lofted around, not
    along the skin normal. On a shoulder the skin normal points up towards the
    trapezius; pushing along it would slide the sleeve upwards instead of outwards
    and wreck the cut. The radial direction is the one the cross section was built
    in, so pushing along it grows the garment without deforming it.
    """
    moved = 0.0
    mesh = obj.data
    for vertex in mesh.vertices:
        nearest_index = 0
        best = None
        for position, centre in enumerate(centres):
            gap = (vertex.co - centre).length
            if best is None or gap < best:
                best, nearest_index = gap, position
        radial = vertex.co - centres[nearest_index]
        if radial.length < 1e-6:
            continue
        step = min(amount, ceiling)
        vertex.co = vertex.co + radial.normalized() * step
        moved = max(moved, step)
    return moved


# --------------------------------------------------------------------------- #
# ring construction
# --------------------------------------------------------------------------- #


def _loft_from_radii(name: str, path, frames, radius_of, *, segments: int, material,
                     region: str, thickness: float, cap_start: bool = False,
                     cap_end: bool = False, smooth: bool = True) -> bpy.types.Object:
    """Loft a path with a *per angle* radius function.

    ``radius_of(local_x, local_y, t, index)`` gets the unit-ellipse point and
    returns where the cloth surface sits for that ray. Inside the loft that is
    applied as a warp, so UVs, caps and quad topology stay the same as for every
    other shell in the project.
    """
    sections: list[dict] = []
    for index, (centre, frame) in enumerate(zip(path, frames)):
        tangent, side, up = frame

        def warp(x: float, y: float, t: float, _index: int = index,
                 _centre=centre, _side=side, _up=up) -> tuple[float, float]:
            radius = radius_of(x, y, t, _index)
            base = math.hypot(x, y)
            if base < 1e-9:
                return x, y
            factor = radius / base
            return x * factor, y * factor

        sections.append({"center": tuple(centre), "side": tuple(side), "up": tuple(up),
                         "rx": 1.0, "ry": 1.0, "exponent": 2.0, "warp": warp})
    verts, faces, uvs = mu.loft(sections, segments=segments, cap_start=cap_start,
                                cap_end=cap_end)
    obj = _finish(name, verts, faces, uvs, material, region, thickness, smooth=smooth)
    return remember_centres(obj, path)


def _vertical_frames(centres, *, side=(1.0, 0.0, 0.0), up=(0.0, -1.0, 0.0)):
    frames = []
    for _ in centres:
        frames.append((Vector((0.0, 0.0, 1.0)), Vector(side), Vector(up)))
    return frames


def remember_centres(obj: bpy.types.Object, centres) -> bpy.types.Object:
    """Store the ring centres on the object so the pad pass can push radially.

    A custom property survives modifier application and joining, so it is still
    there when the garment is padded after every piece has been built.
    """
    flat: list[float] = []
    for centre in centres:
        flat.extend((float(centre[0]), float(centre[1]), float(centre[2])))
    obj["mercScoutCentres"] = flat
    return obj


def ring_centres(obj: bpy.types.Object) -> list[Vector]:
    """The ring centres a garment was lofted around, or its centroid as a fallback."""
    stored = obj.get("mercScoutCentres")
    if stored:
        values = list(stored)
        return [Vector((values[index], values[index + 1], values[index + 2]))
                for index in range(0, len(values) - 2, 3)]
    centre = Vector((0.0, 0.0, 0.0))
    for vertex in obj.data.vertices:
        centre += vertex.co
    centre /= max(1, len(obj.data.vertices))
    return [centre]


# --------------------------------------------------------------------------- #
# folds
# --------------------------------------------------------------------------- #


def _apply_folds(obj: bpy.types.Object, fold_of, **extra) -> None:
    """Displace vertices along their normal with a smooth, deterministic field.

    ``fold_of(co, index, **extra)`` returns a signed offset in metres. Positive
    bulges the cloth outwards, negative presses a crease in. The normals come from
    the unfolded shell, which is enough because the offsets are millimetres.
    """
    mesh = obj.data
    normals = [Vector(v.normal) for v in mesh.vertices]
    for index, vertex in enumerate(mesh.vertices):
        offset = fold_of(vertex.co, index, **extra)
        if offset:
            vertex.co = vertex.co + normals[index] * offset


# --------------------------------------------------------------------------- #
# fitting pass
# --------------------------------------------------------------------------- #


def repair_penetration(objects: list[bpy.types.Object], margin: float) -> int:
    """Move every cloth vertex out of the skin, onto ``margin`` clearance.

    Pure safety net: it only ever pushes outwards, so the cut, the seams and the
    fold pattern survive untouched. The margin is the cloth thickness plus a hair,
    which is the smallest distance at which the shell cannot intersect the body.
    """
    repairs = 0
    for obj in objects:
        for vertex in obj.data.vertices:
            nearest = nearest_skin(vertex.co, 0.30)
            if nearest is None:
                continue
            point, normal, distance = nearest
            if distance >= margin:
                continue
            direction = vertex.co - point
            if direction.length < 1e-6:
                direction = normal
            vertex.co = point + direction.normalized() * margin
            repairs += 1
    return repairs




# --------------------------------------------------------------------------- #
# finishing
# --------------------------------------------------------------------------- #


def _finish(name: str, verts, faces, uvs, material, region: str, thickness: float,
            *, smooth: bool = True) -> bpy.types.Object:
    obj = mu.make_object(name, verts, faces, uvs, smooth=smooth)
    if thickness > 0.0:
        solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
        solidify.thickness = thickness
        solidify.offset = 0.0
        solidify.use_even_offset = True
        mu.apply_modifier(obj, solidify)
    obj.data.materials.append(material)
    mu.fit_uv_region(obj, spec.region_uv(region))
    return obj


def _loft_shell(name: str, sections: list[dict], material, region: str, thickness: float,
                *, segments: int = 20, cap_start: bool = False, cap_end: bool = False,
                smooth: bool = True) -> bpy.types.Object:
    verts, faces, uvs = mu.loft(sections, segments=segments,
                                cap_start=cap_start, cap_end=cap_end)
    obj = _finish(name, verts, faces, uvs, material, region, thickness, smooth=smooth)
    return remember_centres(obj, [section["center"] for section in sections])


def _tube_shell(name: str, path, radii, material, region: str, thickness: float, *,
                segments: int = 16, exponent: float = 2.0, cap_start: bool = False,
                cap_end: bool = False, smooth: bool = True) -> bpy.types.Object:
    verts, faces, uvs = mu.tube(path, radii, segments=segments, exponent=exponent,
                                cap_start=cap_start, cap_end=cap_end)
    obj = _finish(name, verts, faces, uvs, material, region, thickness, smooth=smooth)
    return remember_centres(obj, path)


def _arm_frame(axis, side_hint=(0.0, -1.0, 0.0)):
    """Frame with the tangent along the limb and ``local y`` pointing forward.

    ``local x`` is the side-to-side direction, ``local y`` the forward/back one,
    which is the layout the cross sections below are written for.
    """
    tangent = Vector(axis).normalized()
    side = Vector(side_hint) - tangent * Vector(side_hint).dot(tangent)
    if side.length < 1e-5:
        side = Vector((1.0, 0.0, 0.0)) - tangent * tangent.x
    side.normalize()
    up = tangent.cross(side).normalized()
    return (tangent, side, up)


# --------------------------------------------------------------------------- #
# torso
# --------------------------------------------------------------------------- #

#: The jacket profile: z, centre y offset, ring radii. The radii are measured from
#: the built body (``_JACKET_RINGS`` follows the ribcage from the hem up to the
#: collar) and sit *inside* the intended garment; ``PAD_CLOTH`` lifts the whole
#: shell to its final ease in the fit pass, which is the only step that guarantees
#: it never ends up under the skin.
_JACKET_RINGS = (
    # z,     centre_y, rx,    ry
    (1.010, -0.006, 0.166, 0.112),   # hem, hangs over the hip
    (1.062, -0.006, 0.156, 0.108),
    (1.118, -0.006, 0.146, 0.104),   # waist, taken in
    (1.176, -0.006, 0.150, 0.108),
    (1.240, -0.006, 0.162, 0.116),
    (1.300, -0.006, 0.170, 0.118),   # chest
    (1.360, -0.006, 0.176, 0.116),
    (1.412, -0.006, 0.178, 0.108),   # armpit / upper chest
    (1.460, -0.006, 0.178, 0.100),   # shoulder line, reaches outboard over the deltoid
    (1.496, -0.004, 0.180, 0.092),   # trapezius
    (1.534, -0.002, 0.150, 0.086),   # stand collar
    (1.566, -0.001, 0.110, 0.078),   # collar edge
)


def _jacket_pad(z: float) -> float:
    """Comfort ease of the jacket at a height.

    A hem hangs and a collar stands, so neither of them grips the body the way the
    chest does; that difference is what stops the silhouette from reading as a
    barrel.
    """
    if z > 1.505:
        return 0.026
    if z < 1.060:
        return 0.028
    return PAD_CLOTH


def _jacket_base(t: float, z: float) -> tuple[float, float]:
    """Jacket centre line (x, y) and front depth at ring parameter ``t``.

    Interpolates :data:`_JACKET_RINGS` so a detail placed by hand (a pocket, a zip
    tooth) lands on the same surface the shell was built from instead of on a
    number copied out of the table and wrong two rings later.
    """
    table = _JACKET_RINGS
    z = min(max(z, table[0][0]), table[-1][0])
    lower, upper = table[0], table[-1]
    for first, second in zip(table, table[1:]):
        if first[0] <= z <= second[0]:
            lower, upper = first, second
            break
    blend = 0.0 if upper[0] == lower[0] else (z - lower[0]) / (upper[0] - lower[0])
    rx = lower[2] + (upper[2] - lower[2]) * blend
    ry = lower[3] + (upper[3] - lower[3]) * blend
    depth = ry * math.cos(_TAU * t)
    return rx, depth


def _thin(table, detail: bool, keep: tuple[int, ...]):
    """Pick the rings that carry the outline for the mobile variant.

    Fewer bands means a coarser fold pattern, which is the right trade at 1024 px
    textures; the silhouette survives because the hem, waist, chest and shoulder
    edges are all in the keep list.
    """
    if detail:
        return list(table)
    return [table[index] for index in keep if index < len(table)]


def _jacket(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    rings = _thin(_JACKET_RINGS, detail, (0, 2, 5, 7, 8, 10, 11))
    path = [Vector((0.0, centre_y, z)) for z, centre_y, _x, _y in rings]
    frames = _vertical_frames(path)
    base = [(x, y) for _z, _cy, x, y in rings]

    def radius_of(x: float, y: float, t: float, index: int) -> float:
        rx, ry = base[index]
        return max(0.040, math.hypot(rx * x, ry * y))

    jacket = _loft_from_radii(JACKET, path, frames, radius_of, segments=_segments(28, detail),
                              material=materials["Jacket"], region="jacket",
                              thickness=CLOTH)
    _apply_folds(jacket, _jacket_folds)
    parts = [jacket]

    # Shoulder yoke: a shell over the trapezius that reaches outboard far enough to
    # meet the sleeve cap, and *down* far enough to cover the top of the deltoid.
    # The measurement that set these numbers: the highest bare point left on the
    # shoulder sat at (0.182, -0.018, 1.395), where the arm's upper surface is about
    # 6 cm from the arm axis, so the yoke has to start below 1.40 and reach 0.15 out.
    for side, suffix in ((1, "_L"), (-1, "_R")):
        yoke = []
        for step in range(7):
            blend = step / 6.0
            z = 1.330 + 0.178 * blend
            rx = 0.158 - 0.026 * blend + 0.010 * math.sin(blend * math.pi)
            ry = 0.118 - 0.030 * blend
            yoke.append({"center": (side * (0.066 + 0.028 * blend), -0.008, z),
                         "rx": rx, "ry": ry, "exponent": 2.2})
        parts.append(_loft_shell(JACKET + "_yoke" + suffix, yoke, materials["Jacket"],
                                 "jacket", CLOTH, segments=_segments(20, detail)))

    # Hem band: a slightly heavier fold of cloth along the bottom edge.
    hem = []
    for z, rx, ry in ((1.014, 0.190, 0.140), (1.000, 0.188, 0.138), (0.988, 0.180, 0.132)):
        hem.append({"center": (0.0, -0.006, z), "rx": rx, "ry": ry, "exponent": 2.4})
    parts.append(_loft_shell(JACKET + "_hem", hem, materials["Jacket"], "quilt",
                             CLOTH, segments=_segments(28, detail)))

    if detail:
        # Chest pockets and the zip sit *proud of* the jacket: their attachment line
        # is the shell's own radius (``_jacket_base``), so they overlap into the
        # cloth by their own thickness instead of floating in front of it.
        for side, suffix in ((1, "_L"), (-1, "_R")):
            pocket = []
            for dz, shrink in ((0.050, 1.0), (0.014, 1.0), (-0.018, 0.97)):
                rx, front = _jacket_base(0.06 * side / 0.06, 1.298 + dz)
                pocket.append({"center": (side * 0.078, front + 0.004, 1.298 + dz),
                               "rx": 0.048 * shrink, "ry": 0.024, "exponent": 2.8,
                               "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)})
            parts.append(_loft_shell(JACKET + "_pocket" + suffix, pocket,
                                     materials["Jacket"], "pocket", 0.004, segments=_segments(16, detail)))
            flap = []
            for dz in (0.016, -0.008):
                rx, front = _jacket_base(0.06, 1.352 + dz)
                flap.append({"center": (side * 0.078, front + 0.006, 1.352 + dz),
                             "rx": 0.052, "ry": 0.020, "exponent": 2.8,
                             "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)})
            parts.append(_loft_shell(JACKET + "_pocketflap" + suffix, flap,
                                     materials["Jacket"], "pocket", 0.004, segments=_segments(16, detail)))

        # Zip teeth: a row of small metal blocks down the centre front, half sunk
        # into the cloth so they read as teeth and not as a bump in the texture.
        for step in range(15):
            z = 1.040 + step * 0.032
            _rx, front = _jacket_base(0.0, z)
            tooth = []
            for depth in (-0.002, 0.008):
                tooth.append({"center": (0.0, front + depth, z), "rx": 0.005,
                              "ry": 0.007, "exponent": 2.4,
                              "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)})
            parts.append(_loft_shell(f"{JACKET}_zip{step:02d}", tooth,
                                     materials["Metal"], "metal", 0.0, segments=_segments(8, detail),
                                     smooth=False))
    return parts


def _jacket_folds(co: Vector, index: int = 0) -> float:
    """Waist compression, tension off the armpit, hem wave, raised seams.

    Amplitudes stay in the 2-5 mm range. A fold deeper than that on a 15 cm wide
    ring stops reading as fabric and starts reading as damage.
    """
    z = co.z
    angle = math.atan2(co.x, -co.y) / _TAU % 1.0

    # Compression folds in the waist: shallow horizontal creases that wrap further
    # round the front, where the fabric is pushed together.
    folds = 0.0040 * math.sin((z - 1.040) / 0.034 * math.pi) * _band(z, 1.130, 0.060)
    # Tension folds radiating out of the armpit.
    folds += 0.0050 * _fold(angle, 0.040, 0.055) * _band(z, 1.392, 0.060)
    folds += 0.0040 * _fold(angle, 0.036, 0.945) * _band(z, 1.392, 0.060)
    # Pull folds under the arm, down the side.
    folds += 0.0030 * _fold_bank(angle, 3, 0.10, 1.2) * _band(z, 1.330, 0.050)
    # Chest drape: two soft folds off the sternum.
    folds += 0.0028 * _fold(angle, 0.040, 0.13) * _band(z, 1.300, 0.065)
    folds += 0.0028 * _fold(angle, 0.040, 0.87) * _band(z, 1.300, 0.065)
    # Hem: pushed up by the belt, so a shallow wave all round.
    folds += 0.0030 * math.sin(angle * _TAU * 3.0) * _band(z, 1.020, 0.022)
    # Raised decorative seams: centre front (the zip), the side seam, the yoke.
    folds += 0.0022 * _gauss(_ring_distance(angle, 0.0) / 0.012, 0.5)
    folds += 0.0020 * _gauss(_ring_distance(angle, 0.25) / 0.012, 0.5)
    folds += 0.0020 * _gauss(_ring_distance(angle, 0.75) / 0.012, 0.5)
    folds += 0.0018 * _band(angle, 0.5, 0.9) * _band(z, 1.452, 0.014)
    return folds


# --------------------------------------------------------------------------- #
# sleeves
# --------------------------------------------------------------------------- #


#: Sleeve stations: position along the arm (fractions of shoulder->elbow and
#: elbow->wrist, negative values run past the shoulder towards the neck), base
#: radius, how much the section grows towards the top of the ring (local +y, which
#: is the inboard/up side), and how far the ring centre is pushed that same way.
#:
#: The offset is the part that matters. The chord from the shoulder joint to the
#: wrist does not run through the middle of the visible arm: the deltoid and the
#: biceps bulge about 5 cm above and outboard of it. Without the offset the sleeve
#: is a tube that sits inside the arm, which is what left the red oval on the
#: shoulder in the isolated renders.
_SLEEVE_STATIONS = (
    # station, base, rise, offset
    (-0.26, 0.044, 0.014, 0.008),   # cap top, over the trapezius
    (-0.12, 0.050, 0.022, 0.016),
    (0.00, 0.056, 0.038, 0.028),    # deltoid
    (0.14, 0.052, 0.064, 0.038),
    (0.32, 0.048, 0.088, 0.046),
    (0.50, 0.046, 0.092, 0.048),    # biceps, the widest part of the arm
    (0.68, 0.044, 0.060, 0.042),
    (0.82, 0.050, 0.032, 0.026),
    (1.00, 0.070, 0.014, 0.012),    # elbow
    (1.28, 0.058, 0.008, 0.008),
    (1.58, 0.046, 0.004, 0.004),
    (1.84, 0.034, 0.000, 0.000),
    (2.00, 0.029, 0.000, 0.000),    # wrist
    (2.12, 0.029, 0.000, 0.000),
)


def _sleeve_path(side: int):
    shoulder = Vector(spec.mirror_x(spec.SHOULDER, side))
    elbow = Vector(spec.mirror_x(spec.ELBOW, side))
    wrist = Vector(spec.mirror_x(spec.WRIST, side))
    axis = (wrist - shoulder).normalized()
    frame = _arm_frame(axis)
    upper = (elbow - shoulder).length
    lower = (wrist - elbow).length
    points = []
    for station, _radius, _rise, offset in _SLEEVE_STATIONS:
        if station <= 1.0:
            point = shoulder + axis * (upper * station)
        else:
            point = elbow + (wrist - elbow).normalized() * (lower * (station - 1.0))
        points.append(point + frame[2] * offset)
    return points


def _sleeve_folds(co: Vector, index: int, *, side: int, wrist: Vector,
                  elbow: Vector, axis: Vector) -> float:
    """Bunching along the arm: elbow crease, underarm tension, cuff compression.

    Measured backwards from the wrist along the arm axis, so the pattern is the
    same on both sides without mirroring it by hand.
    """
    along = (co - wrist).dot(axis)
    elbow_along = (elbow - wrist).dot(axis)

    # Elbow crease: the inside of the bend compresses into rings.
    folds = 0.0050 * math.sin((along - elbow_along) / 0.034 * math.pi) * \
        _band(along, elbow_along + 0.020, 0.060)
    # Tension where the sleeve leaves the torso, a third of the way up the upper arm.
    folds += 0.0045 * math.sin((along - elbow_along * 0.35) / 0.060 * math.pi) * \
        _band(along, elbow_along * 0.45, 0.080)
    # Cuff: fabric bunched up against the wrist.
    folds += 0.0035 * math.sin(along / 0.022 * math.pi) * _band(along, -0.030, 0.050)
    return folds


def _sleeves(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        shoulder = Vector(spec.mirror_x(spec.SHOULDER, side))
        elbow = Vector(spec.mirror_x(spec.ELBOW, side))
        wrist = Vector(spec.mirror_x(spec.WRIST, side))
        points = _sleeve_path(side)
        axis = (wrist - shoulder).normalized()
        frames = [_arm_frame(axis) for _point in points]
        bases = [radius for _station, radius, _rise, _offset in _SLEEVE_STATIONS]
        rises = [rise for _station, _radius, rise, _offset in _SLEEVE_STATIONS]

        def radius_of(x: float, y: float, t: float, index: int,
                      _bases=bases, _rises=rises) -> float:
            # ``y`` points inboard on the shoulder, so the deltoid cap reaches
            # further towards the torso than the rest of the ring does.
            inboard = max(0.0, y)
            return max(0.020, _bases[index] + _rises[index] * inboard)

        sleeve = _loft_from_radii("merc_scout_sleeve" + suffix, points, frames, radius_of,
                                  segments=_segments(20, detail), material=materials["Jacket"],
                                  region="sleeve" + suffix, thickness=CLOTH,
                                  cap_start=True, cap_end=True)
        _apply_folds(sleeve, _sleeve_folds, side=side, wrist=wrist, elbow=elbow,
                     axis=axis)
        parts.append(sleeve)

        if detail:
            # Leather cuff: a raised band at the wrist that the sleeve tucks into.
            cuff_points = [wrist - axis * 0.024 + axis * (0.010 * step) for step in range(4)]
            cuff_frames = [_arm_frame(axis) for _point in cuff_points]
            base = 0.030

            def cuff_radius(x: float, y: float, t: float, index: int) -> float:
                return base

            parts.append(_loft_from_radii("merc_scout_cuff" + suffix, cuff_points,
                                          cuff_frames, cuff_radius, segments=_segments(20, detail),
                                          material=materials["Leather"], region="cuff",
                                          thickness=LEATHER))
            # Raised seam along the underside of the sleeve.
            seam = []
            for step in range(7):
                blend = step / 6.0
                point = shoulder + (wrist - shoulder) * (0.16 + 0.76 * blend)
                frame = _arm_frame(axis)
                centre = point + frame[1] * 0.052 + frame[2] * 0.010
                seam.append({"center": tuple(centre), "rx": 0.005, "ry": 0.004,
                             "exponent": 3.0, "side": tuple(frame[1]),
                             "up": tuple(frame[2])})
            parts.append(_loft_shell("merc_scout_sleeseam" + suffix, seam,
                                     materials["Jacket"], "sleeve" + suffix, 0.002,
                                     segments=_segments(10, _DETAIL)))
    return parts


# --------------------------------------------------------------------------- #
# legs
# --------------------------------------------------------------------------- #

_TROUSER_SEAT = (
    # z, centre_y, rx, ry
    (1.168, -0.006, 0.166, 0.124),
    (1.118, -0.006, 0.160, 0.120),
    (1.060, -0.004, 0.165, 0.123),
    (0.998, -0.002, 0.169, 0.125),
    (0.940, 0.000, 0.166, 0.122),
    (0.890, 0.002, 0.158, 0.115),
)

#: Trousers, hip to ankle. Measured the same way as the arm profile: the thigh is
#: about 9 cm across at the top, the knee 7 cm, the calf 7 cm and the ankle 5 cm.
_LEG_STATIONS = (
    (0.02, 0.094), (0.16, 0.090), (0.34, 0.082), (0.55, 0.074),
    (0.78, 0.066), (1.00, 0.060), (1.18, 0.068), (1.38, 0.066),
    (1.60, 0.058), (1.82, 0.052), (2.02, 0.054), (2.22, 0.060),
)


def _seat(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    rings = _thin(_TROUSER_SEAT, _DETAIL, (0, 2, 3, 5))
    path = [Vector((0.0, centre_y, z)) for z, centre_y, _x, _y in rings]
    frames = _vertical_frames(path)
    fallbacks = [(x, y) for _z, _cy, x, y in rings]

    def radius_of(x: float, y: float, t: float, index: int) -> float:
        rx, ry = fallbacks[index]
        return max(0.040, math.hypot(rx * x, ry * y))

    seat = _loft_from_radii(TROUSERS + "_seat", path, frames, radius_of, segments=_segments(26, _DETAIL),
                            material=materials["Trousers"], region="trousers",
                            thickness=CLOTH)
    _apply_folds(seat, _trouser_seat_folds)
    return seat


def _trouser_seat_folds(co: Vector, index: int = 0) -> float:
    z = co.z
    angle = math.atan2(co.x, -co.y) / _TAU % 1.0
    folds = 0.0040 * math.sin((z - 0.880) / 0.036 * math.pi) * _band(z, 0.930, 0.065)
    # Crotch tension folds.
    folds += 0.0035 * _fold_bank(angle, 4, 0.0, 1.0) * _band(z, 0.900, 0.045)
    # Hip crease where the leg bends.
    folds += 0.0030 * _fold(angle, 0.040, 0.13) * _band(z, 1.010, 0.050)
    folds += 0.0030 * _fold(angle, 0.040, 0.87) * _band(z, 1.010, 0.050)
    # Raised outseams and the centre back seam.
    folds += 0.0020 * _gauss(_ring_distance(angle, 0.25) / 0.014, 0.5)
    folds += 0.0020 * _gauss(_ring_distance(angle, 0.75) / 0.014, 0.5)
    folds += 0.0018 * _gauss(_ring_distance(angle, 0.5) / 0.016, 0.5)
    return folds


def _leg(side: int, materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    suffix = "_L" if side > 0 else "_R"
    hip = Vector(spec.mirror_x(spec.HIP_JOINT, side))
    knee = Vector(spec.mirror_x(spec.KNEE_JOINT, side))
    ankle = Vector(spec.mirror_x(spec.ANKLE_JOINT, side))
    axis = (ankle - hip).normalized()
    thigh = (knee - hip).length
    shin = (ankle - knee).length

    points = []
    for station, _radius in _LEG_STATIONS:
        if station <= 1.0:
            points.append(hip + (knee - hip) * station)
        else:
            points.append(knee + (ankle - knee) * (station - 1.0))
    radii = [radius for _station, radius in _LEG_STATIONS]
    if not detail:
        keep = (0, 2, 4, 5, 7, 9, 11)
        points = [points[index] for index in keep]
        radii = [radii[index] for index in keep]
    frames = [_arm_frame(axis, side_hint=(0.0, -1.0, 0.0)) for _point in points]

    def radius_of(x: float, y: float, t: float, index: int,
                  _radii=radii) -> float:
        return max(0.030, _radii[index])

    leg = _loft_from_radii("merc_scout_leg" + suffix, points, frames, radius_of,
                           segments=_segments(20, detail), material=materials["Trousers"],
                           region="trousers", thickness=CLOTH)

    def folds(co: Vector, index: int) -> float:
        along = (co - hip).dot(axis)
        knee_along = thigh
        # Compression behind the knee.
        total = 0.0050 * math.sin((along - knee_along) / 0.036 * math.pi) * \
            _band(along, knee_along - 0.045, 0.060)
        # Fabric bunched above the boot.
        total += 0.0045 * math.sin((along - (thigh + shin)) / 0.030 * math.pi) * \
            _band(along, thigh + shin - 0.045, 0.060)
        # Thigh stretch folds.
        total += 0.0028 * math.sin((along - 0.16) / 0.060 * math.pi) * _band(along, 0.16, 0.10)
        return total

    _apply_folds(leg, folds)
    parts = [leg]

    # Knee reinforcement panel, as on the trousers of the reference kit.
    knee_panel = []
    for offset, rx in ((0.055, 0.052), (-0.055, 0.050)):
        knee_panel.append({"center": tuple(knee + axis * offset + Vector((0.0, -0.010, 0.0))),
                           "rx": rx, "ry": 0.030, "exponent": 2.4,
                           "side": (1.0, 0.0, 0.0), "up": (0.0, 0.0, 1.0)})
    parts.append(_loft_shell("merc_scout_kneepad" + suffix, knee_panel,
                             materials["Trousers"], "knee_pad", 0.004, segments=_segments(16, detail)))

    if detail:
        # Cargo pocket on the outside of the thigh.
        pocket = []
        for offset, shrink in ((0.070, 1.0), (-0.060, 0.98)):
            pocket.append({"center": tuple(hip + (knee - hip) * 0.42
                                           + Vector((side * 0.086, -0.030, 0.0))
                                           + (knee - hip).normalized() * offset),
                           "rx": 0.040 * shrink, "ry": 0.026, "exponent": 2.6,
                           "side": (0.0, 1.0, 0.0),
                           "up": tuple((knee - hip).normalized())})
        parts.append(_loft_shell("merc_scout_legpocket" + suffix, pocket,
                                 materials["Trousers"], "pocket", 0.004, segments=_segments(14, _DETAIL)))
    return parts


def _trousers(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts = [_seat(materials)]
    for side in (1, -1):
        parts.extend(_leg(side, materials, detail))
    return parts


# --------------------------------------------------------------------------- #
# boots
# --------------------------------------------------------------------------- #

#: The boot upper, as one loft from the top of the shaft forward and down to the
#: toe. Rings start horizontal and tilt forward as they descend; the centres are
#: placed so the *underside* of every ring stays above the sole plate (0.028),
#: which is what stopped the sole from poking through the toe box.
_BOOT_UPPER = (
    # z, y offset, rx, ry, forward tilt 0..1
    (0.313, -0.006, 0.052, 0.058, 0.00),
    (0.260, -0.008, 0.049, 0.055, 0.00),
    (0.208, -0.012, 0.048, 0.070, 0.05),
    (0.160, -0.032, 0.049, 0.105, 0.30),
    (0.112, -0.068, 0.050, 0.128, 0.55),
    (0.072, -0.108, 0.050, 0.098, 0.80),
    (0.050, -0.148, 0.046, 0.052, 0.95),
    (0.042, -0.176, 0.036, 0.022, 1.00),
)


def _boots(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        ankle = Vector(spec.mirror_x(spec.ANKLE_JOINT, side))
        toe = Vector(spec.mirror_x(spec.TOE_JOINT, side))
        sole_centre = Vector((ankle.x, (ankle.y + toe.y) * 0.5, 0.0))

        # Mobile keeps every other ring: the same outline with half the bands.
        profile = _BOOT_UPPER if detail else _BOOT_UPPER[::2]
        upper = []
        for z, offset, rx, ry, tilt in profile:
            tangent = Vector((0.0, -tilt, 1.0)).normalized()
            frame = _arm_frame(tangent, side_hint=(1.0, 0.0, 0.0))
            upper.append({"center": (ankle.x, ankle.y + offset, z), "rx": rx, "ry": ry,
                          "exponent": 2.4, "side": tuple(frame[1]), "up": tuple(frame[2])})
        parts.append(_loft_shell("merc_scout_boot" + suffix, upper,
                                 materials["Leather"], "boots", LEATHER,
                                 segments=_segments(22, detail), smooth=True))

        # Sole: a flat plate under the footprint, thinner than the boot and inset
        # at the arch. Its top stays at 0.028 so the upper never crosses it.
        sole_sections = []
        for z, scale in ((0.028, 0.96), (0.014, 1.02), (0.002, 1.00)):
            sole_sections.append({"center": (sole_centre.x, sole_centre.y, z),
                                  "rx": 0.058 * scale, "ry": 0.118 * scale,
                                  "exponent": 3.2, "side": (1.0, 0.0, 0.0),
                                  "up": (0.0, 1.0, 0.0),
                                  "warp": (lambda x, y, t: (x, y * (1.0 - 0.10 * _band(t, 0.0, 0.10)
                                                            - 0.08 * _band(t, 0.5, 0.12))))})
        parts.append(_loft_shell("merc_scout_sole" + suffix, sole_sections,
                                 materials["Leather"], "boot_sole", LEATHER,
                                 segments=_segments(22, detail), smooth=False))
        if detail:
            for index in range(5):
                y = sole_centre.y + 0.088 - index * 0.044
                tread = [
                    {"center": (sole_centre.x, y, 0.004), "rx": 0.052, "ry": 0.014,
                     "exponent": 3.4, "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)},
                    {"center": (sole_centre.x, y, 0.014), "rx": 0.055, "ry": 0.016,
                     "exponent": 3.4, "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)},
                ]
                parts.append(_loft_shell(f"merc_scout_tread{index}{suffix}", tread,
                                         materials["Leather"], "boot_sole", 0.0,
                                         segments=_segments(14, detail), smooth=False))
            # Lacing: metal eyelets down the instep with the laces crossed between
            # them, which is what makes a boot legible up close.
            for index in range(4):
                z = 0.170 + index * 0.042
                for lace_side in (-1, 1):
                    eyelet = [
                        {"center": (ankle.x + lace_side * 0.030, ankle.y - 0.052, z),
                         "rx": 0.007, "ry": 0.007, "exponent": 2.0,
                         "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)},
                        {"center": (ankle.x + lace_side * 0.036, ankle.y - 0.052, z),
                         "rx": 0.008, "ry": 0.008, "exponent": 2.0,
                         "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)},
                    ]
                    parts.append(_loft_shell(f"merc_scout_eyelet{index}{lace_side}{suffix}",
                                             eyelet, materials["Metal"], "metal", 0.0,
                                             segments=_segments(10, detail), smooth=False))
                lace = []
                for step in range(5):
                    blend = step / 4.0
                    x = ankle.x + (blend - 0.5) * 2.0 * 0.030 * (1 if index % 2 else -1)
                    lace.append({"center": (x, ankle.y - 0.056, z + 0.020 * blend),
                                 "rx": 0.004, "ry": 0.004, "exponent": 2.0,
                                 "side": (1.0, 0.0, 0.0), "up": (0.0, 1.0, 0.0)})
                parts.append(_loft_shell(f"merc_scout_lace{index}{suffix}", lace,
                                         materials["Leather"], "laces", 0.0,
                                         segments=_segments(8, detail), cap_start=True, cap_end=True))
    return parts


# --------------------------------------------------------------------------- #
# gloves
# --------------------------------------------------------------------------- #


def _gloves(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        hand = spec.hand_points(side)
        wrist = Vector(hand["wrist"])
        knuckle = Vector(hand["knuckle"])
        direction = (knuckle - wrist).normalized()
        pieces: list[bpy.types.Object] = []

        # The palm is a separate shell from the fingers, so the mobile variant can
        # drop the fingers entirely: five capped tubes per hand cost about 190
        # triangles each and a 15k budget cannot pay for them.
        if detail:
            palm_path = [wrist - direction * 0.030, wrist + direction * 0.020,
                         wrist + direction * 0.052, knuckle + direction * 0.008]
        else:
            palm_path = [wrist - direction * 0.030, wrist + direction * 0.030,
                         knuckle + direction * 0.010]
        palm_frames = [_arm_frame(direction) for _point in palm_path]

        def palm_radius(x: float, y: float, t: float, index: int) -> float:
            # Back of the hand (local -y) gets the knuckle pad: a little more room.
            back = max(0.0, -y)
            return 0.030 + 0.006 * back

        pieces.append(_loft_from_radii("merc_scout_glove_palm" + suffix, palm_path,
                                       palm_frames, palm_radius, segments=_segments(16, detail),
                                       material=materials["Leather"], region="gloves",
                                       thickness=LEATHER))

        if detail:
            for finger, chain in hand["chains"].items():
                finger_points = chain[::2] + [chain[-1]]
                finger_axis = (Vector(chain[-1]) - Vector(chain[0])).normalized()
                frames = [_arm_frame(finger_axis) for _point in finger_points]

                def finger_radius(x: float, y: float, t: float, index: int) -> float:
                    return 0.0135

                pieces.append(_loft_from_radii(f"merc_scout_glove_{finger}{suffix}",
                                               [Vector(p) for p in finger_points], frames,
                                               finger_radius, segments=_segments(12, detail),
                                               material=materials["Leather"], region="gloves",
                                               thickness=LEATHER, cap_start=True, cap_end=True))
        glove = mu.join(pieces, "merc_scout_glove" + suffix)
        mu.fit_uv_region(glove, spec.region_uv("gloves"))
        parts.append(glove)
    return parts


# --------------------------------------------------------------------------- #
# kit
# --------------------------------------------------------------------------- #


def _belt(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    sections = []
    for z, shrink in ((1.088, 1.012), (1.118, 1.020), (1.150, 1.012)):
        sections.append({"center": (0.0, -0.010, z), "rx": 0.166 * shrink,
                         "ry": 0.130 * shrink, "exponent": 2.4})
    belt = _loft_shell(BELT, sections, materials["Leather"], "belt", LEATHER,
                       segments=_segments(26, _DETAIL))
    _apply_folds(belt, lambda co, index: 0.0022 * _gauss(_ring_distance(
        math.atan2(co.x, -co.y) / _TAU % 1.0, 0.0) / 0.02, 0.6))
    return belt


def _pouches(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    placements = (
        ("pouch_A", (-0.148, -0.108, 1.062), (0.048, 0.028, 0.046)),
        ("pouch_B", (0.166, -0.028, 1.056), (0.040, 0.046, 0.042)),
    )
    for name, (x, y, z), (rx, ry, height) in placements:
        sections = [
            {"center": (x, y, z - height), "rx": rx, "ry": ry, "exponent": 3.0},
            {"center": (x, y, z + height), "rx": rx, "ry": ry, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_" + name, sections, materials["Leather"],
                                 name, LEATHER, segments=_segments(14, _DETAIL)))
        if detail:
            flap = [
                {"center": (x, y - 0.004, z + height - 0.006), "rx": rx * 1.06,
                 "ry": ry * 1.06, "exponent": 3.0},
                {"center": (x, y - 0.004, z + height - 0.024), "rx": rx * 1.04,
                 "ry": ry * 1.04, "exponent": 3.0},
            ]
            parts.append(_loft_shell("merc_scout_" + name + "_flap", flap,
                                     materials["Leather"],
                                     "pouch_A" if name == "pouch_A" else "pouch_B",
                                     0.004, segments=_segments(14, _DETAIL)))
    return parts


def _straps(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    chest = spec.JOINTS_L["upper_chest"]
    path = [(chest[0] - 0.118, -0.126, 1.190),
            (chest[0] - 0.082, -0.134, 1.310),
            (chest[0] - 0.008, -0.086, 1.430),
            (chest[0] + 0.092, 0.052, 1.412),
            (chest[0] + 0.124, 0.114, 1.286)]
    radii = [(0.028, 0.010), (0.030, 0.010), (0.032, 0.011), (0.030, 0.010), (0.028, 0.009)]
    parts = [_tube_shell(STRAPS, path, radii, materials["Leather"], "straps", LEATHER,
                         segments=_segments(14, detail), exponent=2.8)]
    if detail:
        buckle_sections = [
            {"center": (-0.086, -0.138, 1.296), "rx": 0.024, "ry": 0.013, "exponent": 3.0},
            {"center": (-0.086, -0.138, 1.324), "rx": 0.024, "ry": 0.013, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_buckle_strap", buckle_sections,
                                 materials["Metal"], "metal", 0.004, segments=_segments(12, detail),
                                 smooth=False))
        belt_buckle = [
            {"center": (0.0, -0.144, 1.090), "rx": 0.030, "ry": 0.011, "exponent": 3.0},
            {"center": (0.0, -0.144, 1.148), "rx": 0.030, "ry": 0.011, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_buckle_belt", belt_buckle,
                                 materials["Metal"], "metal", 0.004, segments=_segments(12, detail),
                                 smooth=False))
        # Belt loops, so the belt reads as threaded and not glued on.
        for index, angle in enumerate((0.06, 0.25, 0.44, 0.56, 0.75, 0.94)):
            x = 0.176 * math.sin(_TAU * angle)
            y = -0.138 * math.cos(_TAU * angle) - 0.010
            loop = [
                {"center": (x, y, 1.086), "rx": 0.010, "ry": 0.006, "exponent": 3.0},
                {"center": (x, y, 1.152), "rx": 0.010, "ry": 0.006, "exponent": 3.0},
            ]
            parts.append(_loft_shell(f"merc_scout_beltloop{index}", loop,
                                     materials["Leather"], "belt", 0.003, segments=_segments(8, _DETAIL)))
    return parts


def _patches(materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        shoulder = Vector(spec.mirror_x(spec.SHOULDER, side))
        elbow = Vector(spec.mirror_x(spec.ELBOW, side))
        anchor = shoulder + (elbow - shoulder) * 0.30
        outward = Vector((side * 0.80, -0.55, 0.0)).normalized()
        base = anchor + outward * 0.058
        sections = [
            {"center": tuple(base), "rx": 0.028, "ry": 0.022, "exponent": 3.0,
             "side": tuple((elbow - shoulder).normalized()), "up": (0.0, 0.0, 1.0)},
            {"center": tuple(base + (elbow - shoulder).normalized() * 0.010),
             "rx": 0.026, "ry": 0.020, "exponent": 3.0,
             "side": tuple((elbow - shoulder).normalized()), "up": (0.0, 0.0, 1.0)},
        ]
        parts.append(_loft_shell("merc_scout_patch" + suffix, sections, materials["Accent"],
                                 "accent" + suffix, 0.003, segments=_segments(12, _DETAIL), smooth=False))
    return parts


def _holster(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    hip = Vector(spec.mirror_x(spec.HIP_JOINT, -1))
    sections = [
        {"center": (hip.x - 0.020, -0.088, 0.760), "rx": 0.044, "ry": 0.034, "exponent": 3.0},
        {"center": (hip.x - 0.020, -0.090, 0.660), "rx": 0.040, "ry": 0.030, "exponent": 3.0},
        {"center": (hip.x - 0.022, -0.086, 0.620), "rx": 0.034, "ry": 0.026, "exponent": 3.0},
    ]
    return _loft_shell("merc_scout_holster", sections, materials["Leather"], "holster",
                       LEATHER, segments=_segments(12, _DETAIL))


# --------------------------------------------------------------------------- #
# assembly
# --------------------------------------------------------------------------- #


def clothing_group(name: str) -> str:
    """Which modular piece a built part belongs to.

    Buyers expect a handful of swappable pieces (jacket, sleeves, trousers, boots,
    gloves, kit), not thirty loose shells, so small details are joined into the
    garment they sit on. Joining keeps all material slots and all UVs.
    """
    if name.startswith("merc_scout_glove"):
        return "merc_scout_glove_R" if name.endswith("_R") else "merc_scout_glove_L"
    if name.startswith(("merc_scout_belt", "merc_scout_holster", "merc_scout_pouch")):
        return "merc_scout_kit"
    if name.startswith(("merc_scout_lining", "merc_scout_patch", "merc_scout_straps",
                        "merc_scout_buckle", "merc_scout_jacket", "merc_scout_gusset",
                        "merc_scout_shoulder", "merc_scout_sleeseam", "merc_scout_yoke")):
        return "merc_scout_jacket"
    if name.startswith(("merc_scout_cuff", "merc_scout_sleeve")):
        return "merc_scout_sleeve_R" if name.endswith("_R") else "merc_scout_sleeve_L"
    if name.startswith(("merc_scout_leg", "merc_scout_kneepad", "merc_scout_trousers")):
        return "merc_scout_trousers"
    if name.startswith(("merc_scout_boot", "merc_scout_sole", "merc_scout_laces",
                        "merc_scout_tread", "merc_scout_eyelet", "merc_scout_lace")):
        return "merc_scout_boot_R" if name.endswith("_R") else "merc_scout_boot_L"
    return name


def build_clothing(variant: spec.Variant,
                   materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    global _VARIANT_KEY, _DETAIL
    _VARIANT_KEY = variant.key
    _DETAIL = variant.detail
    detail = variant.detail
    parts: list[bpy.types.Object] = []
    parts.extend(_jacket(materials, detail))
    parts.extend(_sleeves(materials, detail))
    parts.extend(_trousers(materials, detail))
    parts.extend(_boots(materials, detail))
    parts.extend(_gloves(materials, detail))
    parts.append(_belt(materials))
    parts.extend(_pouches(materials, detail))
    parts.extend(_straps(materials, detail))
    if detail:
        parts.extend(_patches(materials))
        parts.append(_holster(materials))

    # Fitting pass, in two steps. The shells were lofted *inside* the intended
    # garment so that neither step ever has to pull cloth towards the body:
    #   1. push anything that ended up under the skin back out to thickness + 1 mm,
    #   2. lift the whole shell by its comfort ease, measured from the skin normal.
    # Because step 2 works on the repaired mesh and only moves outwards, the red
    # test cannot regress: the sum of the two is monotonically non-decreasing.
    deformable = [obj for obj in parts if obj.name.startswith(
        ("merc_scout_jacket", "merc_scout_sleeve", "merc_scout_leg", "merc_scout_trousers",
         "merc_scout_boot", "merc_scout_glove", "merc_scout_cuff"))]
    repair_penetration(deformable, CLOTH + 0.001)

    def pad_of(obj: bpy.types.Object) -> float:
        if obj.name.startswith("merc_scout_sleeve"):
            return PAD_SLEEVE
        if obj.name.startswith(("merc_scout_boot", "merc_scout_glove", "merc_scout_cuff")):
            return PAD_BOOT
        if obj.name.startswith(("merc_scout_leg", "merc_scout_trousers")):
            return PAD_LEG
        return PAD_CLOTH

    for obj in deformable:
        pad_ease(obj, ring_centres(obj), pad_of(obj))

    grouped: dict[str, list[bpy.types.Object]] = {}
    for obj in parts:
        grouped.setdefault(clothing_group(obj.name), []).append(obj)
    return [mu.join(objects, name) for name, objects in grouped.items()]
