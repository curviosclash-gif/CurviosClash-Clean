"""Body, head, hands, eyes and hair of the mercenary scout.

The body is a Skin-modifier skeleton: the joint positions that later become bones
are the same nodes that generate the mesh, so rig and geometry cannot drift apart.
Skinning plus subdivision already yields connected quad topology through the
shoulders, elbows, hips and knees; a numeric shaping pass then adds the anatomy
the modifier does not know (waist, deltoids, biceps, calves, buttocks). Subdivision
shrinks the skin mesh where several limbs branch, so the shaping pass is also where
the girth is corrected against the measurements in ``spec``.

Head, nose, ears, eyebrows and hair are ring lofts with analytic UVs. Facial
features are placed *on the computed surface* (``head_surface``) instead of on
hand-guessed coordinates, which is what keeps brows attached to the face when the
skull table changes. Lips and eyelids are part of the surface warp: as separate
tubes they read as fins stuck to the face.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Vector

from . import mesh_utils as mu
from . import spec

BODY = "merc_scout_body"
HEAD = "merc_scout_head"
HAIR = "merc_scout_hair"
EYE = "merc_scout_eye"

SKIN_CENTRE_Y = -0.004
EYE_RING_T = 0.058
EYE_HEIGHT = 1.668
#: The skull grows in width and depth only: a slightly rounder, larger head reads
#: better in a game silhouette than the anatomical 7.6 heads of an adult.
HEAD_SCALE = 1.05


@dataclass(frozen=True)
class Node:
    key: str
    position: spec.Vec3
    radius: tuple[float, float]
    parent: str | None


def _bump(value: float, centre: float, width: float, amount: float) -> float:
    return amount * math.exp(-(((value - centre) / width) ** 2))


def _assign(obj: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.append(material)
    return obj


def _rotate_z(obj: bpy.types.Object, centre: spec.Vec3, degrees: float) -> None:
    rotation = Matrix.Rotation(math.radians(degrees), 3, "Z")
    pivot = Vector(centre)
    for vertex in obj.data.vertices:
        vertex.co = rotation @ (vertex.co - pivot) + pivot


# --------------------------------------------------------------------------- #
# skeleton (mesh and rig share these numbers)
# --------------------------------------------------------------------------- #


def skeleton_nodes(finger_segments: int = 3) -> list[Node]:
    joints = spec.JOINTS_L
    nodes: list[Node] = []

    def add(key: str, position: spec.Vec3, radius: tuple[float, float], parent: str | None) -> None:
        nodes.append(Node(key, position, radius, parent))

    # The skin modifier builds a box per node, so the visible surface is roughly
    # 1.2x the radius. Radii stay anatomical; the jacket is sized against the
    # *resulting* surface, otherwise the torso corners poke through the cloth.
    add("hips", joints["hips"], (0.148, 0.108), None)
    add("spine", joints["spine"], (0.128, 0.098), "hips")
    add("chest", joints["chest"], (0.152, 0.110), "spine")
    add("upper_chest", joints["upper_chest"], (0.140, 0.100), "chest")
    add("neck", joints["neck"], (0.066, 0.062), "upper_chest")
    add("head_stub", (0.0, -0.010, 1.552), (0.064, 0.066), "neck")

    for side, suffix in ((1, "_L"), (-1, "_R")):
        shoulder = spec.mirror_x(joints["shoulder"], side)
        upper_arm = spec.mirror_x(joints["upper_arm"], side)
        elbow = spec.mirror_x(joints["lower_arm"], side)
        wrist = spec.mirror_x(joints["hand"], side)
        add("shoulder" + suffix, shoulder, (0.028, 0.027), "upper_chest")
        add("upper_arm" + suffix, upper_arm, (0.039, 0.038), "shoulder" + suffix)
        add("bicep" + suffix, spec.lerp(upper_arm, elbow, 0.45), (0.041, 0.039), "upper_arm" + suffix)
        add("elbow" + suffix, elbow, (0.038, 0.036), "bicep" + suffix)
        add("forearm" + suffix, spec.lerp(elbow, wrist, 0.45), (0.035, 0.033), "elbow" + suffix)
        add("wrist" + suffix, wrist, (0.031, 0.019), "forearm" + suffix)

        # Palm and knuckles were 10 cm wide and 6 cm thick, which is what made the
        # hands read as paws. An adult hand is about 8.8 cm across and 3 cm thick.
        hand = spec.hand_points(side)
        add("palm" + suffix, spec.lerp(hand["wrist"], hand["knuckle"], 0.5), (0.044, 0.016), "wrist" + suffix)
        add("knuckle" + suffix, hand["knuckle"], (0.042, 0.014), "palm" + suffix)
        for finger, chain in hand["chains"].items():
            parent = "knuckle" + suffix
            landmarks = chain[1:] if finger_segments == 3 else chain[2:]
            for position, point in enumerate(landmarks):
                base = 0.0125 if finger == "Thumb" else 0.0108
                radius = base * (1.0 - 0.15 * position)
                key = f"{finger}{position + 1}{suffix}"
                add(key, point, (radius, radius), parent)
                parent = key

        hip = spec.mirror_x(joints["upper_leg"], side)
        knee = spec.mirror_x(joints["lower_leg"], side)
        ankle = spec.mirror_x(joints["foot"], side)
        toe = spec.mirror_x(joints["toe"], side)
        add("upper_leg" + suffix, hip, (0.104, 0.108), "hips")
        add("thigh" + suffix, spec.lerp(hip, knee, 0.5), (0.092, 0.096), "upper_leg" + suffix)
        add("lower_leg" + suffix, knee, (0.066, 0.070), "thigh" + suffix)
        add("calf" + suffix, spec.lerp(knee, ankle, 0.35), (0.070, 0.074), "lower_leg" + suffix)
        add("foot" + suffix, ankle, (0.041, 0.052), "calf" + suffix)
        # The foot sits above the sole plane: a toe node whose box reaches below z = 0
        # forces the final normalisation to lift the whole character, which shifts
        # every landmark and quietly ruins the proportions. The boot covers the foot.
        add("toe" + suffix, (toe[0], toe[1] + 0.018, 0.056), (0.028, 0.032), "foot" + suffix)
    return nodes


def shape_anatomy(obj: bpy.types.Object) -> None:
    """Numeric sculpting pass: anatomy plus the girth the subdivision eats."""
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        axis_x = abs(x)
        offset_y = y - SKIN_CENTRE_Y
        factor_x, factor_y = 1.0, 1.0

        # Torso: the branch nodes at the chest and shoulders lose the most volume
        # to subdivision, so they get the largest correction.
        factor_x += _bump(z, 1.134, 0.080, -0.055)
        factor_y += _bump(z, 1.134, 0.080, -0.045)
        factor_x += _bump(z, 1.300, 0.100, 0.300)
        factor_y += _bump(z, 1.300, 0.100, 0.200)
        factor_x += _bump(z, 1.420, 0.060, 0.130)
        factor_y += _bump(z, 1.420, 0.060, 0.090)
        factor_x += _bump(z, 0.960, 0.080, 0.030)
        factor_y += _bump(z, 0.960, 0.080, 0.020)
        if offset_y > 0.0:
            factor_y += _bump(z, 0.930, 0.075, 0.130)  # buttocks
        factor_y += _bump(z, 1.470, 0.045, 0.030)      # trapezius

        # Arms: deltoid and biceps volume. Kept small on purpose: a deltoid that
        # outgrows the sleeve leaves bare skin wings beside the shoulders.
        if axis_x > 0.14:
            factor_x += _bump(z, 1.430, 0.055, 0.006)
            factor_y += _bump(z, 1.430, 0.055, 0.005)
        if axis_x > 0.20:
            factor_x += _bump(z, 1.330, 0.055, 0.020)
            factor_y += _bump(z, 1.330, 0.055, 0.016)

        # Legs: calf bulge, slimmer knee and ankle.
        factor_x += _bump(z, 0.330, 0.070, 0.075)
        factor_y += _bump(z, 0.330, 0.070, 0.085)
        factor_x += _bump(z, spec.LANDMARKS["knee"], 0.045, -0.030)
        factor_y += _bump(z, spec.LANDMARKS["knee"], 0.045, -0.020)
        factor_x += _bump(z, 0.120, 0.045, -0.060)
        factor_y += _bump(z, 0.120, 0.045, -0.050)

        vertex.co.x = x * factor_x
        vertex.co.y = SKIN_CENTRE_Y + offset_y * factor_y


def build_body(variant: spec.Variant, materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    nodes = skeleton_nodes(variant.finger_segments)
    index_of = {node.key: position for position, node in enumerate(nodes)}
    vertices = [node.position for node in nodes]
    edges = [(index_of[node.parent], position)
             for position, node in enumerate(nodes) if node.parent]

    mesh = bpy.data.meshes.new(BODY + "_skeleton")
    mesh.from_pydata(vertices, edges, [])
    mesh.update()
    obj = bpy.data.objects.new(BODY + "_skin", mesh)
    bpy.context.collection.objects.link(obj)
    mu.select_only([obj], obj)

    skin = obj.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = True
    subdivision = obj.modifiers.new("Subdivision", "SUBSURF")
    subdivision.levels = variant.subdivision
    subdivision.render_levels = variant.subdivision

    layer = mesh.skin_vertices[0].data
    for position, node in enumerate(nodes):
        layer[position].radius = node.radius
    layer[index_of["hips"]].use_root = True

    mu.apply_modifier(obj, skin)
    mu.apply_modifier(obj, subdivision)
    obj.name = BODY
    obj.data.name = BODY

    shape_anatomy(obj)
    _assign(obj, materials["Skin"])
    mu.smart_unwrap(obj)
    mu.fit_uv_region(obj, spec.region_uv("body"))
    return obj


# --------------------------------------------------------------------------- #
# head
# --------------------------------------------------------------------------- #

#: z, rx, ry, exponent, front scale, back scale, centre offset in y
HEAD_SECTIONS: tuple[tuple[float, float, float, float, float, float, float], ...] = (
    (1.488, 0.060, 0.058, 2.2, 1.00, 1.00, -0.018),
    (1.520, 0.070, 0.072, 2.2, 1.00, 1.02, -0.016),
    (1.546, 0.080, 0.085, 2.1, 0.98, 1.03, -0.012),
    (1.568, 0.087, 0.094, 2.1, 0.97, 1.04, -0.010),
    (1.592, 0.091, 0.099, 2.1, 0.99, 1.03, -0.008),
    (1.618, 0.094, 0.102, 2.0, 1.00, 1.02, -0.006),
    (1.645, 0.096, 0.105, 2.0, 1.00, 1.00, -0.005),
    (1.668, 0.096, 0.106, 2.0, 1.00, 1.00, -0.005),
    (1.692, 0.095, 0.106, 2.0, 1.00, 1.00, -0.005),
    (1.716, 0.093, 0.104, 2.0, 1.00, 1.00, -0.005),
    (1.742, 0.086, 0.098, 2.0, 1.00, 1.00, -0.005),
    (1.766, 0.073, 0.084, 2.0, 1.00, 1.00, -0.005),
    (1.784, 0.048, 0.057, 2.0, 1.00, 1.00, -0.005),
    (1.796, 0.018, 0.022, 2.0, 1.00, 1.00, -0.005),
)


def _section_at(z: float) -> tuple[float, float, float, float, float, float]:
    """Interpolate the head table: rx, ry, exponent, front, back, centre y."""
    table = HEAD_SECTIONS
    if z <= table[0][0]:
        lower = upper = table[0]
        blend = 0.0
    elif z >= table[-1][0]:
        lower = upper = table[-1]
        blend = 0.0
    else:
        lower = upper = table[0]
        for first, second in zip(table, table[1:]):
            if first[0] <= z <= second[0]:
                lower, upper = first, second
                blend = (z - first[0]) / (second[0] - first[0])
                break
    values = [lower[index] + (upper[index] - lower[index]) * blend for index in range(1, 7)]
    values[0] *= HEAD_SCALE
    values[1] *= HEAD_SCALE
    return tuple(values)  # type: ignore[return-value]


def skull_radii(z: float) -> tuple[float, float]:
    """Interpolated skull half widths at a height, used for hair and head gear."""
    rx, ry, _exponent, _front, _back, _offset = _section_at(z)
    return rx, ry


def _angle_distance(a: float, b: float) -> float:
    delta = abs(a - b) % 1.0
    return min(delta, 1.0 - delta)


def _gauss(value: float, width: float) -> float:
    return math.exp(-((value / width) ** 2))


def _head_warp(z: float):
    """Shapes one head ring: sockets, brow, cheekbones, jaw, chin, lips, lids."""

    def warp(x: float, y: float, t: float) -> tuple[float, float]:
        front = _angle_distance(t, 0.0)
        for eye in (EYE_RING_T, 1.0 - EYE_RING_T):
            distance = _angle_distance(t, eye)
            socket = _gauss(distance, 0.042) * _gauss(z - EYE_HEIGHT, 0.020)
            y += 0.0100 * socket
            brow = _gauss(distance, 0.030) * _gauss(z - 1.701, 0.011)
            y -= 0.0050 * brow
        for cheek in (0.128, 0.872):
            distance = _angle_distance(t, cheek)
            cheek_weight = _gauss(distance, 0.055) * _gauss(z - 1.641, 0.024)
            y -= 0.0025 * cheek_weight
            x *= 1.0 + 0.032 * cheek_weight
        for temple in (0.25, 0.75):
            x *= 1.0 - 0.016 * _gauss(_angle_distance(t, temple), 0.05) * _gauss(z - 1.706, 0.018)
        for jaw in (0.150, 0.850):
            x *= 1.0 + 0.030 * _gauss(_angle_distance(t, jaw), 0.055) * _gauss(z - 1.575, 0.026)
        front_weight = _gauss(front, 0.055)
        y -= 0.0075 * front_weight * _gauss(z - 1.558, 0.018)    # chin
        y -= 0.0020 * front_weight * _gauss(z - 1.690, 0.020)    # nose bridge
        y -= 0.0042 * front_weight * _gauss(z - 1.604, 0.010)    # upper lip
        y -= 0.0036 * front_weight * _gauss(z - 1.590, 0.010)    # lower lip
        y += 0.0018 * front_weight * _gauss(z - 1.5975, 0.0035)  # mouth line
        for eye in (EYE_RING_T, 1.0 - EYE_RING_T):
            distance = _angle_distance(t, eye)
            y -= 0.0034 * _gauss(distance, 0.030) * _gauss(z - 1.684, 0.007)
            y -= 0.0024 * _gauss(distance, 0.028) * _gauss(z - 1.652, 0.006)
        return x, y

    return warp


def head_surface(z: float, t: float) -> tuple[float, float]:
    """World (x, y) of the head skin at height ``z`` and ring parameter ``t``.

    t = 0 is dead centre in front, 0.25 the character's left temple.
    """
    rx, ry, exponent, front, back, offset_y = _section_at(z)
    power = 2.0 / exponent
    angle = 2.0 * math.pi * t
    sin_t, cos_t = math.sin(angle), math.cos(angle)
    x = rx * math.copysign(abs(sin_t) ** power, sin_t)
    y = -ry * math.copysign(abs(cos_t) ** power, cos_t)
    y *= front if y < 0.0 else back
    x, y = _head_warp(z)(x, y, t)
    return x, offset_y + y


def _head_sections() -> list[dict]:
    sections = []
    for z, rx, ry, exponent, front, back, offset_y in HEAD_SECTIONS:
        sections.append({
            "center": (0.0, offset_y, z),
            "rx": rx * HEAD_SCALE, "ry": ry * HEAD_SCALE, "exponent": exponent,
            "front_scale": front, "back_scale": back,
            "warp": _head_warp(z),
        })
    return sections


def build_head(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    skin = materials["Skin"]
    parts: list[bpy.types.Object] = []

    verts, faces, uvs = mu.loft(_head_sections(), segments=32, cap_start=False, cap_end=True)
    skull = mu.make_object(HEAD + "_skull", verts, faces, uvs)
    _assign(skull, skin)
    mu.fit_uv_region(skull, spec.region_uv("head"))
    parts.append(skull)

    # Nose: sits on the surface and protrudes 12 mm past the bridge.
    bridge = head_surface(1.690, 0.0)[1]
    middle = head_surface(1.664, 0.0)[1]
    base = head_surface(1.632, 0.0)[1]
    tip = min(middle, base) - 0.011
    nose_path = [(0.0, bridge + 0.006, 1.704), (0.0, middle - 0.001, 1.674),
                 (0.0, tip, 1.652), (0.0, tip + 0.005, 1.638), (0.0, base + 0.007, 1.624)]
    nose_radii = [(0.009, 0.008), (0.011, 0.009), (0.014, 0.012), (0.019, 0.015), (0.022, 0.014)]
    verts, faces, uvs = mu.tube(nose_path, nose_radii, segments=14, exponent=2.3)
    nose = mu.make_object(HEAD + "_nose", verts, faces, uvs)
    _assign(nose, skin)
    mu.fit_uv_region(nose, spec.region_uv("nose"))
    parts.append(nose)

    for side, suffix in ((1, "_L"), (-1, "_R")):
        # Ear: small shell, angled backwards, lying against the skull.
        ear_path = []
        for z, outward, depth in ((1.664, 0.000, 0.000), (1.678, 0.003, 0.008),
                                  (1.692, 0.002, 0.010), (1.702, -0.004, 0.006)):
            surface_x, _surface_y = head_surface(z, 0.25)
            ear_path.append((side * (surface_x + outward), depth, z))
        ear_radii = [(0.013, 0.007), (0.017, 0.010), (0.015, 0.009), (0.010, 0.005)]
        verts, faces, uvs = mu.tube(ear_path, ear_radii, segments=12)
        ear = mu.make_object(HEAD + "_ear" + suffix, verts, faces, uvs)
        _assign(ear, skin)
        mu.fit_uv_region(ear, spec.region_uv("ear" + suffix))
        parts.append(ear)

        eyebrow_path = []
        for t in (0.014, 0.056, 0.098):
            surface_x, surface_y = head_surface(1.700, t)
            eyebrow_path.append((side * surface_x, surface_y - 0.0012, 1.700 - abs(t - 0.056) * 0.12))
        eyebrow_radii = [(0.0048, 0.0032), (0.0054, 0.0036), (0.0040, 0.0028)]
        verts, faces, uvs = mu.tube(eyebrow_path, eyebrow_radii, segments=10)
        brow = mu.make_object(HEAD + "_brow" + suffix, verts, faces, uvs)
        _assign(brow, materials["Hair"])
        mu.fit_uv_region(brow, spec.region_uv("brow" + suffix))
        parts.append(brow)

    return mu.join(parts, HEAD)


def build_eyes(materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    objects: list[bpy.types.Object] = []
    radius = 0.0132
    for side, suffix in ((1, "_L"), (-1, "_R")):
        surface_x, surface_y = head_surface(EYE_HEIGHT, EYE_RING_T)
        centre = (side * surface_x * 0.92, surface_y + 0.0055, EYE_HEIGHT)
        sections = []
        ring_count = 14
        for step in range(1, ring_count):
            phi = math.pi * step / ring_count
            sections.append({
                "center": (centre[0], centre[1], centre[2] + radius * math.cos(phi)),
                "rx": radius * math.sin(phi), "ry": radius * math.sin(phi),
            })
        verts, faces, uvs = mu.loft(sections, segments=18, cap_start=True, cap_end=True)
        obj = mu.make_object(EYE + suffix, verts, faces, uvs)
        _rotate_z(obj, centre, 180.0)  # seam at the back, iris sits on u = 0.5
        _assign(obj, materials["Eye"])
        mu.fit_uv_region(obj, spec.region_uv("eye" + suffix))
        objects.append(obj)
    return objects


def _hairline(t: float) -> float:
    """Vertical shift of the hair edge: high over the brow, low at the nape."""
    weight = math.cos(2.0 * math.pi * t)
    return (0.042 if weight > 0.0 else 0.052) * weight


def build_hair(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    sections: list[dict] = []
    levels = ((1.674, 1.026), (1.702, 1.030), (1.730, 1.034), (1.758, 1.036),
              (1.784, 1.030), (1.804, 1.012), (1.816, 0.996))
    for index, (z, factor) in enumerate(levels):
        rx, ry = skull_radii(z)
        section = {"center": (0.0, -0.005, z), "rx": rx * factor, "ry": ry * factor,
                   "exponent": 2.0}
        if index == 0:
            section["shift"] = lambda t: (0.0, 0.0, _hairline(t))
        elif index == 1:
            section["shift"] = lambda t: (0.0, 0.0, 0.45 * _hairline(t))
        sections.append(section)

    # Open shell plus solidify: a capped fan at the hairline pokes through the
    # forehead, which is what produced the jagged edge in the first passes.
    verts, faces, uvs = mu.loft(sections, segments=28, cap_start=False, cap_end=True)
    hair = mu.make_object(HAIR, verts, faces, uvs)
    solidify = hair.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = 0.013
    solidify.offset = -0.35
    solidify.use_even_offset = True
    mu.apply_modifier(hair, solidify)
    obj = mu.join([hair], HAIR)
    _assign(obj, materials["Hair"])
    mu.fit_uv_region(obj, spec.region_uv("hair"))
    return [obj]


# --------------------------------------------------------------------------- #
# contract checks and normalisation
# --------------------------------------------------------------------------- #

#: name, height, horizontal search limit, contractual half width at that height.
#: The bands describe the skin silhouette. ``shoulder`` and ``arm`` sit on the
#: branch junctions of the Skin modifier, where the surface bulges to roughly 1.5x
#: the node radius; they are reported for traceability and carry no target. The
#: bands a single limb node controls (chest, waist, hip, thigh, calf, ankle) do.
PROFILE_BANDS: tuple[tuple[str, float, float, float | None], ...] = (
    ("shoulder", 1.420, 0.35, None),
    ("chest", 1.310, 0.22, 0.176),
    ("waist", 1.118, 0.22, 0.136),
    ("hip", 0.962, 0.22, 0.168),
    ("thigh", 0.750, 0.30, 0.180),
    ("calf", 0.330, 0.25, 0.170),
    ("ankle", 0.100, 0.25, 0.152),
    ("arm", 1.300, 0.70, None),
    ("head", 1.668, 0.20, 0.096),
)


def profile_measurements(objects: list[bpy.types.Object], *, band: float = 0.05,
                         mesh_name: str | None = None) -> dict[str, dict]:
    """Outer half width of the silhouette at the heights the spec fixes.

    Measured *before* normalisation, because normalisation rescales z. The owning
    mesh and the exact vertex are reported as well: without them a wide band
    cannot be traced to a cause, and a stray spike would go unnoticed.
    """
    selected = [obj for obj in objects if mesh_name is None or obj.name == mesh_name]
    result: dict[str, dict] = {}
    for name, z, limit, target in PROFILE_BANDS:
        measured, owner, point = 0.0, None, None
        for obj in selected:
            for vertex in obj.data.vertices:
                co = vertex.co
                if abs(co.z - z) <= band and abs(co.x) <= limit and abs(co.x) > measured:
                    measured = abs(co.x)
                    owner = obj.name
                    point = [round(co.x, 4), round(co.y, 4), round(co.z, 4)]
        if owner is None:
            result[name] = {"max_x": None, "target": target, "delta": None, "owner": None}
            continue
        result[name] = {"max_x": round(measured, 4), "target": target,
                        "delta": None if target is None else round(measured - target, 4),
                        "owner": owner, "point": point}
    return result


def normalise_to_contract(meshes: list[bpy.types.Object], rig: bpy.types.Object,
                          height: float = spec.HEIGHT) -> dict[str, float]:
    """Scale to the contractual height and drop the soles onto z = 0.

    Subdivision shrinks the skin mesh, so the built model never lands exactly on
    1.80 m. Instead of chasing millimetres in the radii, the finished character is
    normalised once: geometry and bones get the same factor, which keeps the
    skinning valid.
    """
    low, high = mu.bounds(meshes)
    current = high.z - low.z
    factor = height / current if current else 1.0
    offset_z = -low.z * factor
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co = Vector((vertex.co.x * factor, vertex.co.y * factor,
                                vertex.co.z * factor + offset_z))
    mu.select_only([rig], rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in rig.data.edit_bones:
        bone.head = Vector((bone.head.x * factor, bone.head.y * factor,
                            bone.head.z * factor + offset_z))
        bone.tail = Vector((bone.tail.x * factor, bone.tail.y * factor,
                            bone.tail.z * factor + offset_z))
    bpy.ops.object.mode_set(mode="OBJECT")
    return {"scale": round(factor, 6), "offset_z": round(offset_z, 6),
            "height_before": round(current, 4)}


def measure(objects: list[bpy.types.Object]) -> dict[str, float]:
    low, high = mu.bounds(objects)
    return {
        "height": round(high.z - low.z, 4),
        "ground": round(low.z, 4),
        "width": round(high.x - low.x, 4),
        "depth": round(high.y - low.y, 4),
    }
