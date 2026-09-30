"""Humanoid rig, skin weights and the checks that prove they hold.

Bone positions come from :mod:`spec`, the same table that drives the mesh
skeleton, so the rig cannot drift away from the geometry. Weights come from
Blender's bone heat solver; rigid props (the eyeballs) are weighted by hand,
because bone heat struggles with meshes that sit inside another mesh. Anything
the solver leaves unweighted is reported instead of being hidden.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from . import mesh_utils as mu
from . import spec

RIG = "merc_scout_rig"
MAX_INFLUENCES = 4


def build_rig(variant: spec.Variant,
              eye_objects: list[bpy.types.Object] | None = None) -> bpy.types.Object:
    armature = bpy.data.armatures.new(RIG)
    rig = bpy.data.objects.new(RIG, armature)
    bpy.context.collection.objects.link(rig)
    mu.select_only([rig], rig)
    bpy.ops.object.mode_set(mode="EDIT")

    bones = spec.bone_specs(variant.finger_segments)
    for bone in bones:
        edit_bone = armature.edit_bones.new(bone["name"])
        edit_bone.head = Vector(bone["head"])
        edit_bone.tail = Vector(bone["tail"])
        edit_bone.use_connect = False
        # Root is a control bone between the feet; if it deformed, bone heat
        # would pull the boots towards the origin.
        edit_bone.use_deform = bone["name"] != "Root"
    for bone in bones:
        if bone["parent"]:
            armature.edit_bones[bone["name"]].parent = armature.edit_bones[bone["parent"]]

    # One gaze bone per eye. Its position comes from the eyeball mesh itself, so rig
    # and geometry cannot drift apart, and buyers get look-at control for free.
    for obj in eye_objects or []:
        coordinates = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        if not coordinates:
            continue
        centre = sum(coordinates, Vector((0.0, 0.0, 0.0))) / len(coordinates)
        name = "Eye_L" if obj.name.endswith("_L") else "Eye_R"
        edit_bone = armature.edit_bones.new(name)
        edit_bone.head = centre
        edit_bone.tail = centre + Vector((0.0, -0.032, 0.0))  # gaze points forward (-Y)
        edit_bone.parent = armature.edit_bones["Head"]
        edit_bone.use_deform = True

    for edit_bone in armature.edit_bones:
        direction = (edit_bone.tail - edit_bone.head).normalized()
        reference = Vector((0.0, 1.0, 0.0))
        if abs(direction.dot(reference)) > 0.9:  # toe and root point along the reference
            reference = Vector((0.0, 0.0, 1.0))
        edit_bone.align_roll(reference)

    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    armature.display_type = "OCTAHEDRAL"
    return rig


def bind_auto(rig: bpy.types.Object, meshes: list[bpy.types.Object]) -> None:
    """Bone heat weights for every deformable mesh at once."""
    mu.select_only(meshes + [rig], rig)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def bind_rigid(rig: bpy.types.Object, obj: bpy.types.Object, bone_name: str) -> None:
    """Weight a prop to exactly one bone: correct for eyeballs and badges."""
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    everything = [vertex.index for vertex in obj.data.vertices]
    for other in list(obj.vertex_groups):
        if other.name != bone_name:
            other.remove(everything)
    group.add(everything, 1.0, "REPLACE")


def limit_influences(objects: list[bpy.types.Object]) -> None:
    """Game engines expect four influences per vertex at the most.

    Smoothing the weights is deliberately *not* part of this: the operator works
    per loose island, so the straps and buckles that were joined into a garment
    came back with zero weight and would snap to the origin during playback.
    """
    for obj in objects:
        mu.select_only([obj], obj)
        for operation in (
            lambda: bpy.ops.object.vertex_group_limit_total(limit=MAX_INFLUENCES),
            lambda: bpy.ops.object.vertex_group_normalize_all(lock_active=False),
        ):
            try:
                operation()
            except RuntimeError as error:  # operator unavailable in background
                print(f"[rig] skipped operator on {obj.name}: {error}")


def _point_segment_distance(point: Vector, head: Vector, tail: Vector) -> float:
    segment = tail - head
    length_squared = segment.length_squared
    if length_squared < 1e-12:
        return (point - head).length
    factor = max(0.0, min(1.0, (point - head).dot(segment) / length_squared))
    return (point - (head + segment * factor)).length


def repair_unweighted(rig: bpy.types.Object, obj: bpy.types.Object) -> int:
    """Give unweighted vertices the nearest deform bone.

    Bone heat normally weights every vertex, but it does fail on geometry it cannot
    reach. A vertex with no weight collapses to the armature origin in every pose,
    so it is repaired instead of being hidden by a warning.
    """
    bones = [bone for bone in rig.data.bones if bone.use_deform]
    if not bones:
        return 0
    repaired = 0
    segments = [(bone.name, rig.matrix_world @ bone.head_local, rig.matrix_world @ bone.tail_local)
                for bone in bones]
    for vertex in obj.data.vertices:
        if sum(element.weight for element in vertex.groups) > 1e-6:
            continue
        point = obj.matrix_world @ vertex.co
        name = min(segments, key=lambda item: _point_segment_distance(point, item[1], item[2]))[0]
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        group.add([vertex.index], 1.0, "REPLACE")
        repaired += 1
    return repaired


def weight_report(obj: bpy.types.Object) -> dict:
    totals = []
    for vertex in obj.data.vertices:
        totals.append(sum(element.weight for element in vertex.groups))
    unweighted = sum(1 for total in totals if total <= 1e-6)
    return {
        "vertices": len(obj.data.vertices),
        "unweighted": unweighted,
        "max_influences": max((len(vertex.groups) for vertex in obj.data.vertices), default=0),
        "groups": len(obj.vertex_groups),
        "weight_min": round(min(totals), 4) if totals else 0.0,
    }


def deformation_report(rig: bpy.types.Object, meshes: list[bpy.types.Object],
                       poses: dict[str, dict[str, tuple[float, float, float]]]) -> dict[str, dict]:
    """Apply extreme poses and measure how far the skin travels.

    A pose that moves a vertex by tens of centimetres more than its neighbours
    means broken weights; this catches that without a human looking at a render.
    """
    report: dict[str, dict] = {}
    rest: dict[str, list[Vector]] = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        rest[obj.name] = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]

    original_rotations = {bone.name: bone.rotation_mode for bone in rig.pose.bones}
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"

    for name, pose in poses.items():
        for bone in rig.pose.bones:
            bone.rotation_euler = (0.0, 0.0, 0.0)
        for bone_name, rotation in pose.items():
            pose_bone = rig.pose.bones.get(bone_name)
            if pose_bone is None:
                raise KeyError(f"pose {name} names unknown bone {bone_name}")
            pose_bone.rotation_euler = tuple(math.radians(value) for value in rotation)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        worst = 0.0
        for obj in meshes:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            for index, vertex in enumerate(mesh.vertices):
                moved = (evaluated.matrix_world @ vertex.co - rest[obj.name][index]).length
                worst = max(worst, moved)
            evaluated.to_mesh_clear()
        report[name] = {"max_displacement": round(worst, 4)}

    for bone in rig.pose.bones:
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.rotation_mode = original_rotations.get(bone.name, "QUATERNION")
    bpy.context.view_layer.update()
    return report


#: Extremes the product has to survive; used by the generator report and tests.
EXTREME_POSES: dict[str, dict[str, tuple[float, float, float]]] = {
    "arms_overhead": {"UpperArm_L": (0.0, 0.0, -95.0), "UpperArm_R": (0.0, 0.0, 95.0)},
    "elbows_folded": {"LowerArm_L": (125.0, 0.0, 0.0), "LowerArm_R": (125.0, 0.0, 0.0)},
    "deep_squat": {"UpperLeg_L": (-95.0, 0.0, 0.0), "UpperLeg_R": (-95.0, 0.0, 0.0),
                   "LowerLeg_L": (110.0, 0.0, 0.0), "LowerLeg_R": (110.0, 0.0, 0.0)},
    "twist": {"Spine": (0.0, 0.0, 40.0), "Chest": (0.0, 0.0, 35.0), "Head": (0.0, 0.0, -30.0)},
}

FIST_FINGERS = ("Index", "Middle", "Ring", "Pinky")


def extreme_poses(finger_segments: int = 3) -> dict[str, dict[str, tuple[float, float, float]]]:
    """The extremes to test, adapted to the finger bone count of a variant.

    Mobile merges the two distal phalanges, so a pose that names ``Index3_L`` would
    abort the build on that variant.
    """
    poses = {name: dict(pose) for name, pose in EXTREME_POSES.items()}
    fists: dict[str, tuple[float, float, float]] = {}
    for finger in FIST_FINGERS:
        fists[f"{finger}1_L"] = (80.0, 0.0, 0.0)
        fists[f"{finger}2_L"] = (90.0, 0.0, 0.0)
        if finger_segments == 3:
            fists[f"{finger}3_L"] = (70.0, 0.0, 0.0)
    poses["fists"] = fists
    return poses
