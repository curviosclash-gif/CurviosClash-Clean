"""Proportion and rig audit against the anthropometric reference table.

"The proportions look off" is not actionable. This module turns it into numbers:
every joint height, bone length and breadth of the built model is compared with the
reference values in :data:`spec.ANTHROPOMETRY`, and anything beyond
:data:`spec.TOLERANCE` is listed as a warning instead of being buried in a render.
"""

from __future__ import annotations

import bpy
from mathutils import Vector

from . import mesh_utils as mu, spec

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
