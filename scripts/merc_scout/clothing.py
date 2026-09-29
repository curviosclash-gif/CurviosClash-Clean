"""Modular clothing for the mercenary scout.

Every garment is its own mesh with its own atlas region, so buyers can swap
pieces (jacket, sleeves, trousers, boots, gloves, belt, pouches, straps) without
touching the others. All of it is ring lofted and solidified into a shell with
visible thickness, which is what separates cloth from body paint.
"""

from __future__ import annotations

import math

import bpy

from . import mesh_utils as mu
from . import spec

JACKET = "merc_scout_jacket"
TROUSERS = "merc_scout_trousers"
BELT = "merc_scout_belt"
STRAPS = "merc_scout_straps"
KIT = "merc_scout_kit"

_G = math.exp


def _gauss(value: float, width: float) -> float:
    return _G(-((value / width) ** 2))


def _ring_distance(a: float, b: float) -> float:
    delta = abs(a - b) % 1.0
    return min(delta, 1.0 - delta)


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
    return _finish(name, verts, faces, uvs, material, region, thickness, smooth=smooth)


def _tube_shell(name: str, path, radii, material, region: str, thickness: float, *,
                segments: int = 16, exponent: float = 2.0, cap_start: bool = False,
                cap_end: bool = False, smooth: bool = True) -> bpy.types.Object:
    verts, faces, uvs = mu.tube(path, radii, segments=segments, exponent=exponent,
                                cap_start=cap_start, cap_end=cap_end)
    return _finish(name, verts, faces, uvs, material, region, thickness, smooth=smooth)


# --------------------------------------------------------------------------- #
# torso
# --------------------------------------------------------------------------- #


def _jacket(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    def zip_channel(x: float, y: float, t: float) -> tuple[float, float]:
        """A shallow channel down the centre front where the zip sits.

        Deeper than 3 mm and the jacket thins out enough for the chest of the body
        to show through as bare skin down the middle.
        """
        return x, y + 0.002 * _gauss(_ring_distance(t, 0.0), 0.022)

    table = (
        # z, rx, ry, exponent, front scale, back scale
        (1.040, 0.194, 0.160, 2.5, 1.02, 1.00),
        (1.110, 0.174, 0.146, 2.5, 1.02, 1.00),
        (1.215, 0.196, 0.152, 2.4, 1.02, 1.00),
        (1.310, 0.226, 0.158, 2.4, 1.01, 1.00),
        (1.400, 0.234, 0.154, 2.3, 1.00, 1.00),
        (1.452, 0.226, 0.142, 2.3, 1.00, 1.02),
        (1.486, 0.132, 0.112, 2.2, 1.00, 1.04),
        (1.540, 0.106, 0.098, 2.2, 1.00, 1.06),
    )
    sections = [
        {"center": (0.0, -0.006, z), "rx": rx, "ry": ry, "exponent": exponent,
         "front_scale": front, "back_scale": back, "warp": zip_channel}
        for z, rx, ry, exponent, front, back in table
    ]
    jacket = _loft_shell(JACKET, sections, materials["Jacket"], "jacket", 0.016, segments=24)
    parts = [jacket]

    # Armpit gussets: the one spot where a torso shell and a sleeve shell cannot
    # meet by themselves, so the body shows through as bare skin.
    for side, suffix in ((1, "_L"), (-1, "_R")):
        gusset = [
            {"center": (side * 0.150, -0.012, 1.330), "rx": 0.080, "ry": 0.076, "exponent": 2.2},
            {"center": (side * 0.180, -0.012, 1.372), "rx": 0.112, "ry": 0.104, "exponent": 2.2},
            {"center": (side * 0.196, -0.012, 1.410), "rx": 0.118, "ry": 0.108, "exponent": 2.2},
            {"center": (side * 0.196, -0.012, 1.448), "rx": 0.096, "ry": 0.088, "exponent": 2.2},
            {"center": (side * 0.182, -0.012, 1.474), "rx": 0.062, "ry": 0.058, "exponent": 2.2},
        ]
        parts.append(_loft_shell(JACKET + "_gusset" + suffix, gusset, materials["Jacket"],
                                 "jacket", 0.0, segments=16, cap_start=True, cap_end=True))
        # Shoulder cap: a flattened ellipsoid over the deltoid. The sleeve is a tube
        # around the arm axis and cannot close the top of the shoulder on its own.
        anchor = spec.mirror_x(spec.SHOULDER, side)
        shoulder_cap = []
        for step in range(1, 8):
            phi = math.pi * step / 8
            shoulder_cap.append({
                "center": (anchor[0], anchor[1] - 0.004, anchor[2] + 0.078 * math.cos(phi)),
                "rx": 0.138 * math.sin(phi), "ry": 0.130 * math.sin(phi), "exponent": 2.0,
            })
        parts.append(_loft_shell(JACKET + "_shoulder" + suffix, shoulder_cap,
                                 materials["Jacket"], "jacket", 0.0, segments=18,
                                 cap_start=True, cap_end=True))

    if detail:
        # Quilted lining peeking out at the hem keeps the silhouette layered.
        lining_sections = [
            {"center": (0.0, -0.006, 1.052), "rx": 0.198, "ry": 0.156, "exponent": 2.5},
            {"center": (0.0, -0.006, 1.020), "rx": 0.190, "ry": 0.150, "exponent": 2.5},
        ]
        parts.append(_loft_shell(JACKET + "_lining", lining_sections, materials["Jacket"],
                                 "quilt", 0.010, segments=24))
    return parts


def _sleeves(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        shoulder = spec.mirror_x(spec.SHOULDER, side)
        elbow = spec.mirror_x(spec.ELBOW, side)
        wrist = spec.mirror_x(spec.WRIST, side)
        direction = spec.normalize(spec.sub(wrist, shoulder))
        # The sleeve is a shoulder yoke: it sits exactly on the arm axis and its
        # first ring is a cap over the deltoid. Where the clavicle, shoulder and
        # upper arm nodes meet, the skin mesh bulges to about 1.5x the node radius,
        # so a sleeve sized like a bare arm leaves bare skin wings beside it.
        path = [shoulder,
                spec.lerp(shoulder, elbow, 0.22),
                spec.lerp(shoulder, elbow, 0.65),
                elbow,
                spec.lerp(elbow, wrist, 0.40),
                spec.lerp(elbow, wrist, 0.80),
                spec.add(wrist, spec.scale(direction, 0.020))]
        radii = [(0.140, 0.130), (0.120, 0.112), (0.100, 0.094),
                 (0.090, 0.084), (0.072, 0.067), (0.056, 0.052), (0.050, 0.046)]
        parts.append(_tube_shell("merc_scout_sleeve" + suffix, path, radii,
                                 materials["Jacket"], "sleeve" + suffix, 0.014, segments=18))
        if detail:
            cuff_path = [spec.add(wrist, spec.scale(direction, -0.030)),
                         spec.add(wrist, spec.scale(direction, 0.012))]
            cuff_radii = [(0.054, 0.050), (0.056, 0.052)]
            parts.append(_tube_shell("merc_scout_cuff" + suffix, cuff_path, cuff_radii,
                                     materials["Leather"], "cuff", 0.010, segments=18))
    return parts


# --------------------------------------------------------------------------- #
# legs
# --------------------------------------------------------------------------- #


def _trousers(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    seat_sections = [
        {"center": (0.0, -0.004, 1.140), "rx": 0.184, "ry": 0.160, "exponent": 2.5},
        {"center": (0.0, -0.004, 1.070), "rx": 0.178, "ry": 0.154, "exponent": 2.5},
        {"center": (0.0, -0.002, 0.990), "rx": 0.180, "ry": 0.152, "exponent": 2.4,
         "front_scale": 0.98, "back_scale": 1.04},
        {"center": (0.0, 0.000, 0.905), "rx": 0.180, "ry": 0.150, "exponent": 2.4},
        {"center": (0.0, 0.002, 0.852), "rx": 0.170, "ry": 0.140, "exponent": 2.4},
    ]
    parts = [_loft_shell(TROUSERS + "_seat", seat_sections, materials["Trousers"],
                         "trousers", 0.014, segments=24)]

    for side, suffix in ((1, "_L"), (-1, "_R")):
        hip = spec.mirror_x(spec.JOINTS_L["upper_leg"], side)
        knee = spec.mirror_x(spec.JOINTS_L["lower_leg"], side)
        ankle = spec.mirror_x(spec.JOINTS_L["foot"], side)
        path = [spec.add(hip, (0.0, 0.0, 0.030)),
                spec.lerp(hip, knee, 0.22),
                spec.lerp(hip, knee, 0.60),
                knee,
                spec.lerp(knee, ankle, 0.35),
                spec.lerp(knee, ankle, 0.75),
                spec.add(ankle, (0.0, 0.0, 0.055))]
        radii = [(0.108, 0.112), (0.102, 0.106), (0.094, 0.098),
                 (0.084, 0.088), (0.078, 0.082), (0.070, 0.074), (0.066, 0.070)]
        parts.append(_tube_shell("merc_scout_leg" + suffix, path, radii,
                                 materials["Trousers"], "trousers", 0.014, segments=18))
    return parts


def _boots(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        ankle = spec.mirror_x(spec.JOINTS_L["foot"], side)
        toe = spec.mirror_x(spec.JOINTS_L["toe"], side)
        top = (ankle[0], ankle[1] - 0.010, 0.315)
        path = [top,
                (ankle[0], ankle[1] - 0.006, 0.215),
                (ankle[0], ankle[1] - 0.010, 0.120),
                (ankle[0] - 0.004 * side, ankle[1] - 0.045, 0.058),
                (toe[0] - 0.004 * side, toe[1] + 0.030, 0.048),
                (toe[0], toe[1] - 0.035, 0.046)]
        radii = [(0.058, 0.062), (0.062, 0.068), (0.060, 0.068),
                 (0.052, 0.072), (0.046, 0.062), (0.040, 0.052)]
        parts.append(_tube_shell("merc_scout_boot" + suffix, path, radii,
                                 materials["Leather"], "boots", 0.014, segments=18,
                                 cap_end=True))
        sole_sections = [
            {"center": (ankle[0] - 0.004 * side, ankle[1] - 0.030, 0.026),
             "rx": 0.056, "ry": 0.080, "exponent": 3.0},
            {"center": (ankle[0] - 0.004 * side, ankle[1] - 0.030, 0.006),
             "rx": 0.052, "ry": 0.074, "exponent": 3.0, "warp": lambda x, y, t: (x, y * 0.94)},
        ]
        parts.append(_loft_shell("merc_scout_sole" + suffix, sole_sections, materials["Leather"],
                                 "boot_sole", 0.010, segments=18, smooth=False))
        if detail:
            lace_path = [(ankle[0], ankle[1] - 0.052, 0.300), (ankle[0], ankle[1] - 0.058, 0.150)]
            lace_radii = [(0.014, 0.012), (0.016, 0.014)]
            parts.append(_tube_shell("merc_scout_laces" + suffix, lace_path, lace_radii,
                                     materials["Leather"], "laces", 0.008, segments=12))
    return parts


def _gloves(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        hand = spec.hand_points(side)
        wrist = hand["wrist"]
        knuckle = hand["knuckle"]
        direction = spec.normalize(spec.sub(knuckle, wrist))
        palm_path = [spec.add(wrist, spec.scale(direction, -0.030)),
                     spec.lerp(wrist, knuckle, 0.45),
                     spec.add(knuckle, spec.scale(direction, 0.012))]
        palm_radii = [(0.038, 0.031), (0.050, 0.034), (0.048, 0.032)]
        pieces = [_tube_shell("merc_scout_glove_palm" + suffix, palm_path, palm_radii,
                              materials["Leather"], "gloves", 0.012, segments=16)]
        for finger, chain in hand["chains"].items():
            finger_path = chain[::2] + [chain[-1]]
            # A glove finger may not taper below the body fingertip: the skin mesh
            # builds a box of ~1.4x its radius, and that box pokes through.
            base = 0.0160 if finger == "Thumb" else 0.0144
            finger_radii = [(base, base)] * len(finger_path)
            pieces.append(_tube_shell(f"merc_scout_glove_{finger}{suffix}", finger_path,
                                      finger_radii, materials["Leather"], "gloves", 0.010,
                                      segments=12, cap_start=True, cap_end=True))
        parts.append(mu.join(pieces, "merc_scout_glove" + suffix))
        mu.fit_uv_region(parts[-1], spec.region_uv("gloves"))
    return parts


# --------------------------------------------------------------------------- #
# kit
# --------------------------------------------------------------------------- #


def _belt(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    sections = [
        {"center": (0.0, -0.004, 1.108), "rx": 0.190, "ry": 0.164, "exponent": 2.5},
        {"center": (0.0, -0.004, 1.150), "rx": 0.188, "ry": 0.162, "exponent": 2.5},
    ]
    return _loft_shell(BELT, sections, materials["Leather"], "belt", 0.012, segments=24)


def _pouches(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    placements = (
        ("pouch_A", (-0.150, -0.148, 1.070), (0.052, 0.030, 0.052)),
        ("pouch_B", (0.168, -0.020, 1.062), (0.044, 0.052, 0.048)),
    )
    for name, (x, y, z), (rx, ry, height) in placements:
        sections = [
            {"center": (x, y, z - height), "rx": rx, "ry": ry, "exponent": 3.0},
            {"center": (x, y, z + height), "rx": rx, "ry": ry, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_" + name, sections, materials["Leather"],
                                 name, 0.012, segments=14))
        if detail:
            flap = [
                {"center": (x, y - 0.006, z + height - 0.010), "rx": rx * 1.06, "ry": ry * 1.06,
                 "exponent": 3.0},
                {"center": (x, y - 0.006, z + height - 0.026), "rx": rx * 1.04, "ry": ry * 1.04,
                 "exponent": 3.0},
            ]
            parts.append(_loft_shell("merc_scout_" + name + "_flap", flap, materials["Leather"],
                                     "pouch_A" if name == "pouch_A" else "pouch_B", 0.008,
                                     segments=14))
    return parts


def _straps(materials: dict[str, bpy.types.Material], detail: bool) -> list[bpy.types.Object]:
    chest = spec.JOINTS_L["upper_chest"]
    path = [(chest[0] - 0.130, -0.142, 1.215),
            (chest[0] - 0.090, -0.150, 1.330),
            (chest[0] - 0.010, -0.090, 1.452),
            (chest[0] + 0.100, 0.060, 1.430),
            (chest[0] + 0.135, 0.130, 1.300)]
    radii = [(0.030, 0.011), (0.032, 0.011), (0.034, 0.012), (0.032, 0.011), (0.030, 0.010)]
    parts = [_tube_shell(STRAPS, path, radii, materials["Leather"], "straps", 0.010,
                         segments=14, exponent=2.8)]
    if detail:
        buckle_sections = [
            {"center": (-0.095, -0.150, 1.318), "rx": 0.026, "ry": 0.014, "exponent": 3.0},
            {"center": (-0.095, -0.150, 1.348), "rx": 0.026, "ry": 0.014, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_buckle_strap", buckle_sections, materials["Metal"],
                                 "metal", 0.008, segments=12, smooth=False))
        belt_buckle = [
            {"center": (0.0, -0.176, 1.108), "rx": 0.034, "ry": 0.012, "exponent": 3.0},
            {"center": (0.0, -0.176, 1.152), "rx": 0.034, "ry": 0.012, "exponent": 3.0},
        ]
        parts.append(_loft_shell("merc_scout_buckle_belt", belt_buckle, materials["Metal"],
                                 "metal", 0.008, segments=12, smooth=False))
    return parts


def _patches(materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    parts: list[bpy.types.Object] = []
    for side, suffix in ((1, "_L"), (-1, "_R")):
        shoulder = spec.mirror_x(spec.SHOULDER, side)
        elbow = spec.mirror_x(spec.ELBOW, side)
        anchor = spec.lerp(shoulder, elbow, 0.30)
        outward = spec.normalize(spec.sub(anchor, spec.JOINTS_L["upper_chest"] if side > 0
                                         else spec.mirror_x(spec.JOINTS_L["upper_chest"], -1)))
        base = spec.add(anchor, spec.scale(outward, 0.060))
        sections = [
            {"center": base, "rx": 0.030, "ry": 0.024, "exponent": 3.0,
             "side": (0.0, 0.0, 1.0), "up": direction_axis(side, anchor, elbow)},
            {"center": spec.add(base, spec.scale(spec.normalize(spec.sub(elbow, shoulder)), 0.010)),
             "rx": 0.028, "ry": 0.022, "exponent": 3.0,
             "side": (0.0, 0.0, 1.0), "up": direction_axis(side, anchor, elbow)},
        ]
        parts.append(_loft_shell("merc_scout_patch" + suffix, sections, materials["Accent"],
                                 "accent" + suffix, 0.004, segments=12, smooth=False))
    return parts


def direction_axis(side: int, anchor, elbow) -> tuple[float, float, float]:
    """A stable 'up' axis for a flat patch on a sloping arm."""
    axis = spec.normalize(spec.cross(spec.sub(elbow, anchor), (0.0, 1.0, 0.0)))
    return axis


def _holster(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    hip = spec.mirror_x(spec.JOINTS_L["upper_leg"], -1)
    sections = [
        {"center": (hip[0] - 0.010, -0.030, 0.760), "rx": 0.048, "ry": 0.036, "exponent": 3.0},
        {"center": (hip[0] - 0.010, -0.030, 0.640), "rx": 0.044, "ry": 0.032, "exponent": 3.0},
    ]
    return _loft_shell("merc_scout_holster", sections, materials["Leather"], "holster", 0.010,
                       segments=12)


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
                        "merc_scout_shoulder")):
        return "merc_scout_jacket"
    if name.startswith(("merc_scout_cuff", "merc_scout_sleeve")):
        return "merc_scout_sleeve_R" if name.endswith("_R") else "merc_scout_sleeve_L"
    if name.startswith(("merc_scout_leg", "merc_scout_kneepad", "merc_scout_trousers")):
        return "merc_scout_trousers"
    if name.startswith(("merc_scout_boot", "merc_scout_sole", "merc_scout_laces")):
        return "merc_scout_boot_R" if name.endswith("_R") else "merc_scout_boot_L"
    return name


def build_clothing(variant: spec.Variant,
                   materials: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
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

    grouped: dict[str, list[bpy.types.Object]] = {}
    for obj in parts:
        grouped.setdefault(clothing_group(obj.name), []).append(obj)
    return [mu.join(objects, name) for name, objects in grouped.items()]
