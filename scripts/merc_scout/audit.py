"""Proportion and rig audit against the anthropometric reference table.

"The proportions look off" is not actionable. This module turns it into numbers:
every joint height, bone length and breadth of the built model is compared with the
reference values in :data:`spec.ANTHROPOMETRY`, and anything beyond
:data:`spec.TOLERANCE` is listed as a warning instead of being buried in a render.
"""

from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import materials as material_lib, mesh_utils as mu, occlusion, spec

#: Bone whose head *is* the joint, and the reference key it is compared with.
JOINT_CHECKS: tuple[tuple[str, str, str], ...] = (
    ("shoulder", "UpperArm_L", "shoulder"),
    ("knee", "LowerLeg_L", "knee"),
    ("ankle", "Foot_L", "ankle"),
    ("hip_joint", "UpperLeg_L", "hip_joint"),
    ("eye", "Eye_L", "eye"),
)

#: Bone name and the reference length it should have.
LENGTH_CHECKS: tuple[tuple[str, str], ...] = (
    ("humerus", "UpperArm_L"),
    ("radius", "LowerArm_L"),
    ("femur", "UpperLeg_L"),
    ("tibia", "LowerLeg_L"),
    ("foot_bone", "Foot_L"),
)

#: Silhouette band from ``body.profile_measurements`` and the reference breadth.
#: The shoulder gets its own narrow measurement: a 10 cm band around the acromion
#: also catches the biceps box, which made the body look 35 % too broad.
BREADTH_CHECKS: tuple[tuple[str, str], ...] = (
    ("chest", "chest_breadth"),
    ("waist", "waist_breadth"),
    ("hip", "hip_breadth"),
    ("head", "head_breadth"),
)

#: Lateral silhouette of the torso mesh at one height, ignoring anything further out
#: than ``limit`` (which is where the arms start).
def _silhouette_half_width(objects: list[bpy.types.Object], z: float, *, band: float,
                          limit: float) -> float | None:
    measured: float | None = None
    for obj in objects:
        for vertex in obj.data.vertices:
            point = vertex.co
            if abs(point.z - z) <= band and abs(point.x) <= limit:
                if measured is None or abs(point.x) > measured:
                    measured = abs(point.x)
    return measured


def _delta(built: float, reference: float) -> float:
    return round((built - reference) / reference, 4) if reference else 0.0


def _bone_length(rig: bpy.types.Object, name: str) -> float | None:
    bone = rig.data.bones.get(name)
    return (bone.tail_local - bone.head_local).length if bone else None


def _bone_height(rig: bpy.types.Object, name: str) -> float | None:
    bone = rig.data.bones.get(name)
    return bone.head_local.z if bone else None


def _hand_length(rig: bpy.types.Object) -> float | None:
    hand = rig.data.bones.get("Hand_L")
    tip = rig.data.bones.get("Middle3_L")
    if hand is None or tip is None:
        return None
    return (tip.tail_local - hand.head_local).length


def _head_dimensions(objects: list[bpy.types.Object]) -> dict[str, float] | None:
    head = next((obj for obj in objects if obj.name.endswith("_head")), None)
    if head is None:
        return None
    low, high = mu.bounds([head])
    return {"breadth": round(high.x - low.x, 4), "length": round(high.y - low.y, 4),
            "height": round(high.z - low.z, 4)}


def _garment_tree(meshes: list[bpy.types.Object],
                  garments: list[bpy.types.Object]) -> "BVHTree":
    """One BVH over all garments, so they can occlude each other correctly."""
    vertices: list[Vector] = []
    triangles: list[tuple[int, int, int]] = []
    for obj in garments:
        offset = len(vertices)
        matrix = obj.matrix_world
        vertices.extend([matrix @ vertex.co for vertex in obj.data.vertices])
        for polygon in obj.data.polygons:
            indices = list(polygon.vertices)
            for index in range(1, len(indices) - 1):
                triangles.append((offset + indices[0], offset + indices[index],
                                  offset + indices[index + 1]))
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True)


def _segment_distance(point: Vector, start: Vector, end: Vector) -> float:
    direction = end - start
    if direction.length_squared < 1e-12:
        return (start - point).length
    factor = max(0.0, min(1.0, (point - start).dot(direction) / direction.length_squared))
    return (start + direction * factor - point).length


def _body_region(point: Vector) -> str:
    """Which body part a vertex belongs to, measured from the joints.

    Region is not guessed from a height or an x threshold: the forearm sits at the
    same height as the hand, so a height-only split blamed the hands for bare
    forearms and sent the reader looking in the wrong place.
    """
    near_wrist = min((Vector(spec.mirror_x(spec.WRIST, side)) - point).length
                     for side in (1, -1))
    near_arm = min(_segment_distance(point, Vector(spec.mirror_x(spec.SHOULDER, side)),
                                     Vector(spec.mirror_x(spec.WRIST, side)))
                   for side in (1, -1))
    if near_wrist < 0.12:
        return "hand"
    if near_arm < 0.11:
        return "arm"
    if point.z < 0.16:
        return "foot"
    if point.z < 0.95:
        return "leg"
    return "torso"


def _cone_directions(normal: Vector, *, spread: float = math.radians(38.0),
                     count: int = 4) -> list[Vector]:
    """The surface normal plus a ring around it.

    A single normal ray reports false exposure wherever it grazes a garment
    tangentially (along a trouser leg, for instance), so a spot only counts as bare
    when no direction in the cone reaches cloth.
    """
    reference = Vector((0.0, 0.0, 1.0)) if abs(normal.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    tangent = normal.cross(reference).normalized()
    bitangent = normal.cross(tangent).normalized()
    directions = [normal]
    for index in range(count):
        angle = 2.0 * math.pi * index / count
        offset = (tangent * math.cos(angle) + bitangent * math.sin(angle)) * math.sin(spread)
        directions.append((normal * math.cos(spread) + offset).normalized())
    return directions


def skin_exposure(meshes: list[bpy.types.Object], *,
                  max_distance: float = 0.14, hugging_distance: float = 0.06) -> dict:
    """How much bare skin shows because no garment covers it.

    "The arms look bare" is not a number a build can be judged by. Here a ray is
    cast outwards from every vertex of the body mesh: if it leaves without hitting a
    garment within ``max_distance``, that spot is visible skin. The result is the
    same statement the red-skin render makes, but countable and repeatable.

    The distance has to be generous. A low-poly garment is cut from few rings, so the
    cloth of the mobile variant sits a median of 45 mm (up to 81 mm) away from the leg
    it encloses; with a 70 mm ray those covered vertices were reported as bare skin and
    a healthy variant looked like a regression. What matters is whether skin is
    *visible*, not how tightly the cloth hugs it.
    """
    body = next((obj for obj in meshes if obj.name.endswith("_body")), None)
    if body is None:
        return {}
    garments = [obj for obj in meshes
                if obj is not body
                and not obj.name.endswith(("_head", "_eye_L", "_eye_R", "_hair"))]
    if not garments:
        return {}
    tree = _garment_tree(meshes, garments)
    matrix = body.matrix_world
    normals = [matrix.to_3x3() @ vertex.normal for vertex in body.data.vertices]
    by_region: dict[str, int] = {}
    totals: dict[str, int] = {}
    exposed = 0
    for vertex, normal in zip(body.data.vertices, normals):
        point = matrix @ vertex.co
        region = _body_region(point)
        totals[region] = totals.get(region, 0) + 1
        direction = normal.normalized() if normal.length > 1e-9 else Vector((0.0, 0.0, 1.0))
        covered = False
        for ray in _cone_directions(direction):
            if tree.ray_cast(point + ray * 0.0015, ray, max_distance)[0] is not None:
                covered = True
                break
        if not covered:
            # A ray can also escape through the open ends of a tube (along a trouser
            # leg, out of a sleeve) without that spot being visible. So the second
            # test is distance: cloth closer than ``hugging_distance`` covers the skin
            # even when no ray happens to hit it.
            nearest = tree.find_nearest(point, max_distance)
            if nearest and nearest[0] is not None and nearest[3] < hugging_distance:
                covered = True
        if not covered:
            exposed += 1
            by_region[region] = by_region.get(region, 0) + 1
    total = len(body.data.vertices)
    ratios = {name: round(count / max(1, totals.get(name, 1)), 4)
              for name, count in sorted(by_region.items())}
    warnings = [
        f"skin exposure on the {name}: {ratio:.1%} of its vertices have no garment "
        f"within {max_distance * 1000:.0f} mm"
        for name, ratio in ratios.items()
        if name in ("arm", "foot", "hand") and ratio > 0.05
    ]
    worst = max(by_region.items(), key=lambda item: item[1] / max(1, totals[item[0]]),
                default=("none", 0))
    return {
        "exposed_vertices": exposed,
        "total_vertices": total,
        "ratio": round(exposed / total, 4) if total else 0.0,
        "exposed_by_region": by_region,
        "ratio_by_region": ratios,
        "worst_region": worst[0],
        "warnings": warnings,
    }


def unpainted_slots(meshes: list[bpy.types.Object],
                    materials: dict[str, bpy.types.Material], *,
                    minimum_std: float = 0.006, maximum_mean: float = 0.06
                    ) -> dict[str, list[str]]:
    """Atlas tiles the geometry claims but that are still blank.

    Twice now a part sampled a tile nobody had painted (the eyebrows and the sleeve
    cuffs) and shipped flat black, unnoticed because both materials are dark. The
    claim comes from the model's own UVs, the verdict from the painted pixels.

    A tile only counts as blank when it is both featureless *and* almost black: a
    deliberately calm tile (flat brown eyebrow, flat leather band) is a design
    choice, an untouched atlas patch is a bug. Flagging every flat tile produced
    three false alarms in a row.
    """
    images = occlusion._base_colour_images(materials)
    claimed = material_lib.slot_usage(meshes)
    flat_by_material: dict[str, list[str]] = {}
    for material_name, slots in claimed.items():
        image = images.get(material_name)
        if image is None:
            continue  # a factor material without a map has nothing to paint
        width, height = image.size
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
        blank: list[str] = []
        for slot in sorted(slots):
            u0, v0, u1, v1 = spec.region_uv(slot)
            x0, x1 = int(u0 * width), max(int(u0 * width) + 1, int(u1 * width))
            y0, y1 = int(v0 * height), max(int(v0 * height) + 1, int(v1 * height))
            patch = pixels[y0:y1, x0:x1, :3]
            if patch.size == 0:
                continue
            if float(patch.std()) < minimum_std and float(patch.mean()) < maximum_mean:
                blank.append(slot)
        if blank:
            flat_by_material[material_name] = blank
    return flat_by_material


def proportion_audit(meshes: list[bpy.types.Object], rig: bpy.types.Object, *,
                     profile: dict[str, dict] | None = None,
                     normalisation: dict | None = None) -> dict:
    """Compare joint heights, bone lengths, breadths and the span with the table."""
    warnings: list[str] = []
    if normalisation:
        scale = float(normalisation.get("scale", 1.0))
        offset = float(normalisation.get("offset_z", 0.0))
        if abs(scale - 1.0) > spec.NORMALISATION_TOLERANCE:
            warnings.append(f"the model needed scaling by {scale:.4f}; geometry is "
                            f"{abs(1.0 - scale):.1%} off the contract height")
        if abs(offset) > 0.01:
            warnings.append(f"the model was lifted by {offset:+.3f} m; something dips "
                            f"below the sole plane, which distorts every landmark")

    # Shoulder joints: the bone-to-bone distance, not the deltoid silhouette.
    left = rig.data.bones.get("UpperArm_L")
    right = rig.data.bones.get("UpperArm_R")
    if left and right:
        distance = abs(left.head_local.x - right.head_local.x)
        reference = spec.ANTHROPOMETRY["shoulder_joint_distance"]
        delta = _delta(distance, reference)
        joints_extra = {"shoulder_joint_distance": {"built": round(distance, 4),
                                                   "reference": reference, "delta": delta}}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"shoulder joints are {distance:.3f} m apart vs reference "
                            f"{reference:.3f} m ({delta:+.1%})")
    else:
        joints_extra = {}
    joints: dict[str, dict] = {}
    for label, bone_name, key in JOINT_CHECKS:
        built = _bone_height(rig, bone_name)
        reference = spec.ANTHROPOMETRY.get(key)
        if built is None or reference is None:
            continue
        delta = _delta(built, reference)
        joints[label] = {"built": round(built, 4), "reference": reference, "delta": delta}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"joint {label}: {built:.3f} m vs reference {reference:.3f} m "
                            f"({delta:+.1%})")

    lengths: dict[str, dict] = {}
    for label, bone_name in LENGTH_CHECKS:
        built = _bone_length(rig, bone_name)
        reference = spec.ANTHROPOMETRY.get(label)
        if built is None or reference is None:
            continue
        delta = _delta(built, reference)
        lengths[label] = {"built": round(built, 4), "reference": reference, "delta": delta}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"bone {label}: {built:.3f} m vs reference {reference:.3f} m "
                            f"({delta:+.1%})")

    hand = _hand_length(rig)
    if hand is not None:
        delta = _delta(hand, spec.ANTHROPOMETRY["hand"])
        lengths["hand"] = {"built": round(hand, 4), "reference": spec.ANTHROPOMETRY["hand"],
                           "delta": delta}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"hand: {hand:.3f} m vs reference {spec.ANTHROPOMETRY['hand']:.3f} m "
                            f"({delta:+.1%})")

    breadths: dict[str, dict] = {}
    # The deltoid breadth is measured at the acromion itself (3 cm band, arms out of
    # the way), not with the 10 cm torso band that reaches into the upper arm.
    deltoid = _silhouette_half_width(meshes, spec.ANTHROPOMETRY["shoulder"], band=0.015,
                                     limit=0.30)
    if deltoid is not None:
        reference = spec.ANTHROPOMETRY["deltoid_breadth"]
        built = deltoid * 2.0
        delta = _delta(built, reference)
        breadths["shoulder"] = {"built": round(built, 4), "reference": reference,
                                "delta": delta, "owner": "acromion band"}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"breadth shoulder: {built:.3f} m vs reference {reference:.3f} m "
                            f"({delta:+.1%}, acromion band)")
    for band, key in BREADTH_CHECKS:
        entry = (profile or {}).get(band) or {}
        half = entry.get("max_x")
        reference = spec.ANTHROPOMETRY.get(key)
        if half is None or reference is None:
            continue
        built = half * 2.0
        delta = _delta(built, reference)
        breadths[band] = {"built": round(built, 4), "reference": reference, "delta": delta,
                          "owner": entry.get("owner")}
        if abs(delta) > spec.TOLERANCE:
            warnings.append(f"breadth {band}: {built:.3f} m vs reference {reference:.3f} m "
                            f"({delta:+.1%}, on {entry.get('owner')})")

    low, high = mu.bounds(meshes)
    height = round(high.z - low.z, 4)
    if abs(_delta(height, spec.HEIGHT)) > 0.01:
        warnings.append(f"height: {height:.3f} m vs contract {spec.HEIGHT:.3f} m")

    span = None
    shoulder = rig.data.bones.get("UpperArm_L")
    if shoulder is not None and hand is not None:
        arm = (rig.data.bones["Hand_L"].head_local - shoulder.head_local).length + hand
        span = round(2.0 * (shoulder.head_local.x + arm), 4)
    span_ratio = round(span / height, 4) if span else None
    span_range = spec.ANTHROPOMETRY["arm_span_ratio"]
    if span_ratio is not None and not (span_range[0] <= span_ratio <= span_range[1]):
        warnings.append(f"arm span in T-pose would be {span:.3f} m ({span_ratio:.2f} H), "
                        f"reference is {span_range[0]}-{span_range[1]} H")

    return {
        "height": {"built": height, "reference": spec.HEIGHT},
        "joints": {**joints, **joints_extra},
        "lengths": lengths,
        "breadths": breadths,
        "head": _head_dimensions(meshes),
        "arm_span": {"built": span, "ratio": span_ratio, "reference": list(span_range)},
        "spine_curve_y": {name: round(rig.data.bones[name].head_local.y, 4)
                          for name in ("Hips", "Spine", "Chest", "UpperChest", "Neck")
                          if rig.data.bones.get(name)},
        "warnings": warnings,
    }


def format_audit(report: dict) -> str:
    """The audit as a plain text table for the generator log."""
    lines = ["proportion audit (built vs anthropometric reference)"]
    for label, entry in report["joints"].items():
        lines.append(f"  joint   {label:<10} {entry['built']:.3f} m  ref {entry['reference']:.3f}"
                     f"  {entry['delta']:+.1%}")
    for label, entry in report["lengths"].items():
        lines.append(f"  bone    {label:<10} {entry['built']:.3f} m  ref {entry['reference']:.3f}"
                     f"  {entry['delta']:+.1%}")
    for label, entry in report["breadths"].items():
        lines.append(f"  breadth {label:<10} {entry['built']:.3f} m  ref {entry['reference']:.3f}"
                     f"  {entry['delta']:+.1%}")
    head = report.get("head")
    if head:
        lines.append(f"  head    breadth {head['breadth']:.3f} (ref "
                     f"{spec.ANTHROPOMETRY['head_breadth']:.3f}), length {head['length']:.3f} "
                     f"(ref {spec.ANTHROPOMETRY['head_length']:.3f}), height {head['height']:.3f} "
                     f"(ref {spec.ANTHROPOMETRY['head_height']:.3f})")
    span = report["arm_span"]
    if span["built"]:
        lines.append(f"  span    {span['built']:.3f} m = {span['ratio']:.2f} H "
                     f"(reference {span['reference'][0]}-{span['reference'][1]} H)")
    for warning in report["warnings"]:
        lines.append(f"  WARN    {warning}")
    if not report["warnings"]:
        lines.append("  all checks within tolerance")
    return "\n".join(lines)
