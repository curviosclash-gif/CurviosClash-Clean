"""The eleven in-place animation clips of the mercenary scout.

The clips are authored, not imported: each one is a deterministic function of the
clip time, keyed into bone-local Euler angles. Nothing here reads a file or a
random number, so a rerun of the generator reproduces the same curves.

Bone axes (verified against renders in ``.scratch/anim``)
    :func:`rig.build_rig` rolls every bone so its local Z points at world +Y,
    which is *backwards* for a character that faces -Y. The local X axis is
    therefore the flexion axis of the whole body:

    * ``+X`` swings the bone end backwards, ``-X`` forwards. So the hip flexes
      with ``-X`` on ``UpperLeg*``, the knee with ``+X`` on ``LowerLeg*``, the
      elbow with ``-X`` on ``LowerArm*`` and a forward arm raise is ``-X`` on
      ``UpperArm*``.
    * ``+Y`` (the bone axis) twists; on the spine it turns the character to its
      own left (+X world).
    * ``+Z`` tilts the bone end towards the character's left, so every sideways
      pose needs mirrored Z on the two sides.

    Two bones break the rule: ``Foot*`` and ``Toe*`` point along the roll
    reference itself, so :func:`rig.build_rig` falls back to world +Z for them.
    There a positive X rotation lifts the toes and +Z is a yaw towards the
    character's left.

Arms
    A pose rotation about the arm's local X axis is *not* a swing: the A-pose
    roll makes that axis point diagonally, so a large X rotation collapses the
    arm across the chest (a punch became a hook). Arms that move more than a few
    degrees are therefore aimed with :class:`Aim`, which solves the Euler angles
    that point a bone along a direction in armature space.

Feet
    Every grounded frame is solved with a two-bone analytic IK against a target
    ankle position, then refined by measuring the posed ankle and correcting the
    target. That is what keeps a planted foot from skating: during the stance
    phase the ankle target moves backwards in a straight line, so the sole is
    stationary against the ground the clip implies. Because the bind pose has
    fully extended legs, the pelvis has to come down for a foot to reach forward
    at all - ``bake_gait(..., drop=...)`` is that offset.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Vector

from . import spec

TAU = math.tau
SIDES = ((1, "_L"), (-1, "_R"))
LEG_PARTS = ("UpperLeg", "LowerLeg", "Foot", "Toe")
FINGERS = ("Index", "Middle", "Ring", "Pinky", "Thumb")

#: How much of the total curl one phalanx takes, by segment count.
CURL_SHARES = {1: (1.0,), 2: (0.58, 0.42), 3: (0.40, 0.34, 0.26)}

#: Foot pitches (degrees) at which :meth:`_Skeleton.calibrate_soles` measures the
#: boot. Between the samples the lift is interpolated linearly.
SOLE_SAMPLES = (-32.0, -24.0, -16.0, -8.0, 0.0, 8.0, 16.0)


def _lowest_point(meshes: list[bpy.types.Object]) -> float:
    """Lowest deformed vertex of the given meshes, in world space."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lowest = 1e9
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        coords = [0.0] * (len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", coords)
        lowest = min(lowest, min(coords[2::3]) + evaluated.matrix_world.translation.z)
        evaluated.to_mesh_clear()
    return lowest


# --------------------------------------------------------------------------- #
# small maths helpers
# --------------------------------------------------------------------------- #


def _clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return low if value < low else high if value > high else value


def _mix(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _smooth(t: float) -> float:
    t = _clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _sagittal(vector: Vector) -> float:
    """Angle of a direction in the sagittal plane, 0 = straight down, + = forward."""
    return math.atan2(-vector.y, -vector.z)


def _track(points: list[tuple[float, float]], frame: float, smooth: bool = True) -> float:
    """Piecewise interpolation of ``(frame, value)`` points."""
    if frame <= points[0][0]:
        return points[0][1]
    for (frame_a, value_a), (frame_b, value_b) in zip(points, points[1:]):
        if frame <= frame_b:
            span = max(frame_b - frame_a, 1e-6)
            t = (frame - frame_a) / span
            return _mix(value_a, value_b, _smooth(t) if smooth else t)
    return points[-1][1]


def _curl_shares(count: int) -> tuple[float, ...]:
    return CURL_SHARES.get(count, CURL_SHARES[3])


def _arm_direction(side: int, out: float, swing: float) -> tuple[float, float, float]:
    """Direction of an arm abducted ``out`` degrees from straight down and then
    swung ``swing`` degrees forward. ``out`` runs 0 (hanging) through 90 (out to
    the side) to 180 (straight up); past 90 the swing keeps turning the same way,
    so a raised arm folds with a negative swing."""
    side_angle, swing_angle = math.radians(out), math.radians(swing)
    reach = math.cos(side_angle)
    return (side * math.sin(side_angle), -reach * math.sin(swing_angle),
            -reach * math.cos(swing_angle))


def _arms(left: tuple[float, float, float], right: tuple[float, float, float],
          forearm_out: float = -6.0) -> dict[str, "Aim"]:
    """Upper arm and forearm aims for both arms.

    Each side is ``(out, swing, bend)``: how far the arm hangs from vertical,
    how far it swings forward and how far the elbow folds.
    """
    pose: dict[str, Aim] = {}
    for side, (out, swing, bend) in ((1, left), (-1, right)):
        suffix = "_L" if side > 0 else "_R"
        pose["UpperArm" + suffix] = Aim(_arm_direction(side, out, swing))
        pose["LowerArm" + suffix] = Aim(_arm_direction(side, out + forearm_out, swing + bend))
    return pose


# --------------------------------------------------------------------------- #
# foot targets
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Aim:
    """Point a bone along a world direction instead of guessing Euler angles.

    The A-pose rolls every arm bone about a *diagonal* axis, so swinging a bent
    arm with plain X angles makes it collapse across the chest. A direction in
    armature space (``+X`` the character's left, ``-Y`` forward, ``+Z`` up) says
    what the animator means. ``up`` is an optional hint for the bone's roll; the
    bind roll is kept when it is omitted.
    """

    direction: tuple[float, float, float]
    up: tuple[float, float, float] | None = None


@dataclass(frozen=True)
class FootTarget:
    """Where one ankle should sit and how the sole should point.

    Grounded targets use ``y``/``z`` (armature space, metres). Airborne targets
    use ``forward``/``down`` relative to the posed hip joint, which is what an
    animator means by "knee tucked". ``pitch`` is measured against the flat sole
    of the bind pose, so ``0`` is a planted foot and ``+20`` lifts the toes.
    """

    y: float | None = None
    z: float | None = None
    forward: float | None = None
    down: float | None = None
    pitch: float = 0.0
    toe: float | None = 0.0
    yaw: float = 0.0


@dataclass(frozen=True)
class Gait:
    """Parameters of one locomotion cycle (walk or run)."""

    stance: float
    reach: float  #: half the ankle excursion, metres
    lift: float  #: clearance of the swinging foot
    heel: float  #: foot pitch at contact, toe up, degrees
    toe_off: float  #: foot pitch at push-off, toe down, degrees
    yaw: float = 4.0


def _two_bone_ik(hip: Vector, target: Vector, length_a: float, length_b: float,
                 theta_a: float, theta_b: float) -> tuple[float, float, Vector]:
    """Angles that put the shank end on ``target``, knee pointing forward.

    ``theta_a``/``theta_b`` are the *current* world angles of the two bones with
    no pose rotation applied, so the answer also works while the pelvis is
    pitched (the death clip lies the body flat this way).
    """
    delta = Vector((0.0, target.y - hip.y, target.z - hip.z))
    distance = delta.length
    reach = _clamp(distance, abs(length_a - length_b) + 1e-4, length_a + length_b - 1e-5)
    aim = target if abs(reach - distance) < 1e-9 else Vector(
        (target.x, hip.y + delta.y / distance * reach, hip.z + delta.z / distance * reach))
    psi = math.atan2(-(aim.y - hip.y), -(aim.z - hip.z))
    gamma = math.acos(_clamp((length_a * length_a + reach * reach - length_b * length_b)
                             / (2.0 * length_a * reach)))
    theta_upper = psi + gamma
    thigh = Vector((0.0, -math.sin(theta_upper) * length_a, -math.cos(theta_upper) * length_a))
    shank = aim - hip - thigh
    theta_lower = math.atan2(-shank.y, -shank.z)
    alpha = theta_a - theta_upper
    return alpha, (theta_b - theta_lower) - alpha, aim


# --------------------------------------------------------------------------- #
# skeleton access
# --------------------------------------------------------------------------- #


class _Skeleton:
    """Pose access plus the rest measurements the leg solver needs."""

    def __init__(self, rig: bpy.types.Object, variant: spec.Variant):
        self.rig = rig
        self.variant = variant
        self.pose = rig.pose.bones
        for bone in self.pose:
            bone.rotation_mode = "XYZ"
        for required in ("Hips", "Spine", "Head", "UpperLeg_L", "UpperLeg_R", "Foot_L", "Foot_R"):
            if required not in self.pose:
                raise KeyError(f"rig is missing the bone {required!r}")
        self.rest_head = {bone.name: bone.head_local.copy() for bone in rig.data.bones}
        self.rest_tail = {bone.name: bone.tail_local.copy() for bone in rig.data.bones}
        self.hip_from_local = rig.data.bones["Hips"].matrix_local.to_3x3().inverted()
        self.ankle_height = min(self.rest_head["Foot_L"].z, self.rest_head["Foot_R"].z)
        self.sole_table: list[tuple[float, float]] = [(pitch, 0.0) for pitch in SOLE_SAMPLES]
        self.finger_bones = {finger: {side: self._finger_chain(finger, side)
                                      for side, _ in SIDES} for finger in FINGERS}
        segments = len(self.finger_bones["Index"][1])
        if segments != variant.finger_segments:
            raise ValueError(f"rig has {segments} finger segments, "
                             f"variant {variant.key!r} declares {variant.finger_segments}")

    def _finger_chain(self, finger: str, side: int) -> list[str]:
        suffix = "_L" if side > 0 else "_R"
        names = []
        for index in range(1, 4):
            name = f"{finger}{index}{suffix}"
            if name in self.pose:
                names.append(name)
        return names

    # -- posing ----------------------------------------------------------- #

    def reset(self) -> None:
        for bone in self.pose:
            bone.rotation_euler = (0.0, 0.0, 0.0)
            bone.location = (0.0, 0.0, 0.0)

    def update(self) -> None:
        bpy.context.view_layer.update()

    def apply(self, pose: dict[str, tuple[float, float, float]]) -> None:
        for name, rotation in pose.items():
            bone = self.pose.get(name)
            if bone is None:
                raise KeyError(f"unknown bone {name!r}")
            bone.rotation_euler = tuple(math.radians(value) for value in rotation)

    def set_hips_offset(self, forward: float = 0.0, up: float = 0.0, side: float = 0.0) -> None:
        """Move the pelvis by a world-space offset, without root motion."""
        self.pose["Hips"].location = self.hip_from_local @ Vector((side, -forward, up))

    def aim_bone(self, name: str, direction, up=None) -> None:
        """Rotate one bone so it points along ``direction`` (armature space)."""
        bone = self.pose[name]
        rest = self.rig.data.bones[name]
        base = rest.matrix_local.to_3x3()
        if rest.parent is not None:
            parent = rest.parent
            base = (self.pose[parent.name].matrix.to_3x3()
                    @ parent.matrix_local.to_3x3().inverted() @ base)
        axis_y = Vector(direction).normalized()
        hint = Vector(up).normalized() if up is not None else (base @ Vector((0.0, 0.0, 1.0)))
        axis_z = hint - axis_y * hint.dot(axis_y)
        if axis_z.length < 1.0e-6:
            axis_z = Vector((0.0, 0.0, 1.0)) - axis_y * axis_y.z
            if axis_z.length < 1.0e-6:
                axis_z = Vector((1.0, 0.0, 0.0)) - axis_y * axis_y.x
        axis_z.normalize()
        target = Matrix((axis_y.cross(axis_z), axis_y, axis_z)).transposed()
        bone.rotation_euler = (base.inverted() @ target).to_euler("XYZ", bone.rotation_euler)

    def finger_pose(self, curl: float, thumb: float | None = None) -> dict:
        pose: dict[str, tuple[float, float, float]] = {}
        for finger, chains in self.finger_bones.items():
            amount = curl if finger != "Thumb" else (0.45 * curl if thumb is None else thumb)
            for side, names in chains.items():
                if not names:
                    continue
                sign = 1.0 if side > 0 else -1.0
                for name, share in zip(names, _curl_shares(len(names))):
                    pose[name] = (0.0, 0.0, sign * amount * share)
        return pose

    # -- feet -------------------------------------------------------------- #

    def calibrate_soles(self, meshes: list[bpy.types.Object]) -> dict[float, float]:
        """Measure the ankle lift a pitched boot needs to stay on ``z = 0``.

        A flat sole rests on the ground in the bind pose, but a pitched boot
        pivots about its toe or heel, and the sole's lowest point then sits
        below the ankle. Rather than guess the boot's shape, the boot is posed
        and the mesh is measured.
        """
        suffix = "_L"
        foot = self.pose["Foot" + suffix]
        toe = self.pose["Toe" + suffix]
        toe_flat = _sagittal(self.rest_tail["Toe" + suffix] - self.rest_head["Toe" + suffix])
        measured: dict[float, float] = {}
        for pitch in SOLE_SAMPLES:
            self.reset()
            foot.rotation_euler = (math.radians(pitch), 0.0, 0.0)
            self.update()
            toe.rotation_euler = (toe_flat - _sagittal(toe.tail - toe.head), 0.0, 0.0)
            self.update()
            measured[pitch] = _lowest_point(meshes)
        self.reset()
        self.update()
        floor = measured.get(0.0, 0.0)
        self.sole_table = [(pitch, max(0.0, floor - lowest)) for pitch, lowest in measured.items()]
        return dict(self.sole_table)

    def sole_lift(self, pitch: float) -> float:
        """Ankle lift for a sole pitched by ``pitch`` degrees, from the table."""
        table = self.sole_table
        if pitch <= table[0][0]:
            return table[0][1]
        for (pitch_a, lift_a), (pitch_b, lift_b) in zip(table, table[1:]):
            if pitch <= pitch_b:
                return _mix(lift_a, lift_b, (pitch - pitch_a) / max(pitch_b - pitch_a, 1e-6))
        return table[-1][1]

    def _target_point(self, side: int, target: FootTarget, hip: Vector) -> Vector:
        suffix = "_L" if side > 0 else "_R"
        x = self.rest_head["Foot" + suffix].x
        if target.forward is not None:
            return Vector((x, hip.y - target.forward, hip.z - (target.down or 0.0)))
        y = self.rest_head["Foot" + suffix].y if target.y is None else target.y
        z = self.ankle_height if target.z is None else target.z
        return Vector((x, y, z + self.sole_lift(target.pitch)))

    def solve_leg(self, side: int, target: FootTarget, iterations: int = 6,
                  tolerance: float = 2.0e-4) -> None:
        suffix = "_L" if side > 0 else "_R"
        upper = self.pose["UpperLeg" + suffix]
        lower = self.pose["LowerLeg" + suffix]
        foot = self.pose["Foot" + suffix]
        toe = self.pose["Toe" + suffix]
        length_a = (self.rest_tail["UpperLeg" + suffix] - self.rest_head["UpperLeg" + suffix]).length
        length_b = (self.rest_tail["LowerLeg" + suffix] - self.rest_head["LowerLeg" + suffix]).length
        wanted: Vector | None = None

        for _ in range(iterations):
            upper.rotation_euler = (0.0, 0.0, 0.0)
            lower.rotation_euler = (0.0, 0.0, 0.0)
            foot.rotation_euler = (0.0, 0.0, 0.0)
            toe.rotation_euler = (0.0, 0.0, 0.0)
            self.update()
            hip = upper.head.copy()
            if wanted is None:
                wanted = self._target_point(side, target, hip)
            theta_a = _sagittal(upper.tail - upper.head)
            theta_b = _sagittal(lower.tail - lower.head)
            alpha, beta, aim = _two_bone_ik(hip, wanted, length_a, length_b, theta_a, theta_b)
            upper.rotation_euler = (alpha, 0.0, 0.0)
            lower.rotation_euler = (beta, 0.0, 0.0)
            self.update()
            error = aim - lower.tail
            if error.length <= tolerance:
                break
            wanted = wanted + error

        # The sole is aimed in world space, so a pitched pelvis still gets a
        # flat foot: measure the direction with the foot's own rotation zeroed.
        foot.rotation_euler = (0.0, 0.0, 0.0)
        toe.rotation_euler = (0.0, 0.0, 0.0)
        self.update()
        flat = _sagittal(self.rest_tail["Foot" + suffix] - self.rest_head["Foot" + suffix])
        foot_x = flat + math.radians(target.pitch) - _sagittal(foot.tail - foot.head)
        foot.rotation_euler = (foot_x, 0.0, math.radians(target.yaw * side))
        self.update()
        if target.toe is not None:
            toe_flat = _sagittal(self.rest_tail["Toe" + suffix] - self.rest_head["Toe" + suffix])
            toe.rotation_euler = (toe_flat + math.radians(target.toe)
                                  - _sagittal(toe.tail - toe.head), 0.0, 0.0)
            self.update()


# --------------------------------------------------------------------------- #
# clip authoring
# --------------------------------------------------------------------------- #


class _Clip:
    """One action under construction, with its own keying helpers."""

    def __init__(self, skeleton: _Skeleton, animation: spec.AnimationSpec):
        self.s = skeleton
        self.spec = animation
        self.name = animation.name
        self.frames = animation.frames
        self.loop = animation.loop
        self.baked_legs = False
        self.standing = self._standing_pose()

    # -- helpers ----------------------------------------------------------- #

    def _standing_pose(self) -> dict:
        # The bind pose is an A-pose with the arms 40 degrees out; a relaxed
        # stance brings them back to roughly 14 degrees, which is what the Z
        # term below does (positive Z adducts the left arm, negative the right).
        pose = {
            "Hips": (2.0, 0.0, 0.0),
            "Spine": (-2.0, 0.0, 0.0),
            "Chest": (-1.5, 0.0, 0.0),
            "UpperChest": (-1.0, 0.0, 0.0),
            "Neck": (0.5, 0.0, 0.0),
            "Head": (-1.0, 0.0, 0.0),
            "Shoulder_L": (0.0, 0.0, 0.0),
            "Shoulder_R": (0.0, 0.0, 0.0),
            "UpperArm_L": (2.0, 0.0, 26.0),
            "UpperArm_R": (2.0, 0.0, -26.0),
            "LowerArm_L": (-12.0, 0.0, 0.0),
            "LowerArm_R": (-12.0, 0.0, 0.0),
            "Hand_L": (2.0, 0.0, 0.0),
            "Hand_R": (2.0, 0.0, 0.0),
        }
        pose.update(self.s.finger_pose(22.0))
        return pose

    def time(self, frame: float) -> float:
        return (frame - 1.0) / max(self.frames - 1.0, 1.0)

    def key_upper(self, frame: int, pose: dict, hips=(0.0, 0.0, 0.0)) -> None:
        bpy.context.scene.frame_set(frame)
        self.s.reset()
        aims = [(name, value) for name, value in pose.items() if isinstance(value, Aim)]
        self.s.apply({name: value for name, value in pose.items() if not isinstance(value, Aim)})
        self.s.set_hips_offset(*hips)
        self.s.update()
        for name, aim in aims:  # parent first: a child aim needs its parent posed
            self.s.aim_bone(name, aim.direction, aim.up)
            self.s.update()
        for name in pose:
            self.s.pose[name].keyframe_insert("rotation_euler", frame=frame, group=name)
        self.s.pose["Hips"].keyframe_insert("location", frame=frame, group="Hips")

    def key_legs(self, frame: int, targets: dict[int, FootTarget]) -> None:
        self.baked_legs = True
        bpy.context.scene.frame_set(frame)
        for side, target in targets.items():
            self.s.solve_leg(side, target)
        for _, suffix in SIDES:
            for part in LEG_PARTS:
                name = part + suffix
                self.s.pose[name].keyframe_insert("rotation_euler", frame=frame, group=name)

    def foot_pair(self, left: FootTarget, right: FootTarget) -> dict[int, FootTarget]:
        return {1: left, -1: right}

    def rest_ankle_y(self) -> float:
        return self.s.rest_head["Foot_L"].y

    # -- gait -------------------------------------------------------------- #

    def gait_target(self, gait: Gait, side: int, phase: float,
                    ankle_y: float | None = None) -> FootTarget:
        """One foot of a locomotion cycle. ``phase`` 0 is the heel strike."""
        base_y = self.rest_ankle_y() if ankle_y is None else ankle_y
        phase %= 1.0
        if phase < gait.stance:
            u = phase / gait.stance
            offset = gait.reach - 2.0 * gait.reach * u
            if u < 0.18:  # rolling down over the heel
                pitch = gait.heel * (1.0 - u / 0.18)
            elif u > 0.72:  # pushing off over the toes
                pitch = -gait.toe_off * ((u - 0.72) / 0.28) ** 1.4
            else:
                pitch = 0.0
            return FootTarget(y=base_y - offset, z=self.s.ankle_height,
                              pitch=pitch, toe=0.0, yaw=gait.yaw * side)
        v = (phase - gait.stance) / (1.0 - gait.stance)
        offset = -gait.reach + 2.0 * gait.reach * _smooth(v)
        return FootTarget(y=base_y - offset,
                          z=self.s.ankle_height + gait.lift * math.sin(math.pi * v),
                          pitch=_mix(-gait.toe_off, gait.heel, _smooth(v)),
                          toe=None, yaw=gait.yaw * side)

    def bake_gait(self, gait: Gait, lean: float, drop: float) -> None:
        """Body and legs of a locomotion cycle; the legs are baked every frame.

        ``drop`` lowers the pelvis for the whole cycle. The bind pose has fully
        extended legs, so a planted foot can only reach forward once the pelvis
        comes down; without it the IK would clamp and the foot would skate.
        """
        running = gait.stance < 0.5
        swing = 44.0 if running else 30.0
        out = 8.0 if running else 16.0
        elbow = 78.0 if running else 14.0
        extra = 14.0 if running else 12.0
        bob = 0.030 if running else 0.022
        lateral = 0.009 if running else 0.017
        yaw = 8.0 if running else 4.5
        steps = self.frames - 1
        for step in range(steps + 1):
            t = step / steps
            frame = 1 + step
            phase = TAU * t
            cos, sin = math.cos(phase), math.sin(phase)
            pose = {
                **self.standing,
                "Hips": (lean, yaw * sin, -3.0 * sin),
                "Spine": (lean * 0.45, -0.5 * yaw * sin, 0.8 * sin),
                "Chest": (lean * 0.35, -0.7 * yaw * sin, 0.6 * sin),
                "UpperChest": (lean * 0.25, -0.9 * yaw * sin, 0.4 * sin),
                "Neck": (-lean * 0.5, 0.3 * yaw * sin, 0.0),
                "Head": (-lean * 0.75, 0.5 * yaw * sin + 2.0 * sin, -0.8 * sin),
                "Shoulder_L": (2.0 * cos, 0.0, -1.5 - 1.5 * cos),
                "Shoulder_R": (-2.0 * cos, 0.0, 1.5 - 1.5 * cos),
                "Hand_L": (4.0, 0.0, 0.0),
                "Hand_R": (4.0, 0.0, 0.0),
            }
            pose.update(_arms((out, -swing * cos, elbow + extra * max(0.0, -cos)),
                              (out, swing * cos, elbow + extra * max(0.0, cos))))
            pose.update(self.s.finger_pose(58.0 if running else 34.0))
            hips = (0.0, -drop - bob * math.cos(2.0 * phase), lateral * sin)
            self.key_upper(frame, pose, hips=hips)
            self.key_legs(frame, self.foot_pair(self.gait_target(gait, 1, t),
                                                self.gait_target(gait, -1, t + 0.5)))


# --------------------------------------------------------------------------- #
# clips
# --------------------------------------------------------------------------- #


def _idle(clip: _Clip) -> None:
    """Breathing stance with the weight on the back foot and a slow head turn."""
    beats = 18
    back_y = clip.rest_ankle_y() + 0.055
    front_y = clip.rest_ankle_y() - 0.055
    for step in range(beats + 1):
        t = step / beats
        frame = 1 + round(t * (clip.frames - 1))
        breath = math.sin(TAU * t)
        sway = math.sin(TAU * t + 0.7)
        look = math.sin(TAU * t) ** 3
        pose = {
            **clip.standing,
            "Hips": (2.0 + 0.4 * breath, 1.8 * sway, -1.2 + 0.9 * sway),
            "Spine": (-1.8 + 0.5 * breath, -1.0 * sway, 0.5 * sway),
            "Chest": (-1.2 + 0.9 * breath, -0.8 * sway, 0.4 * sway),
            "UpperChest": (-0.8 + 1.2 * breath, -0.5 * sway, 0.3 * sway),
            "Neck": (0.5 - 0.5 * breath, -0.4 * sway, 0.0),
            "Head": (-1.0 - 0.9 * breath, 8.0 * look, 0.8 * sway),
            "Shoulder_L": (0.5 * sway, 0.0, -0.8 * breath),
            "Shoulder_R": (-0.5 * sway, 0.0, 0.8 * breath),
            "UpperArm_L": (2.0 + 1.4 * breath + 0.9 * sway, 0.0, 26.0 - 1.2 * breath),
            "UpperArm_R": (2.0 + 1.4 * breath - 0.9 * sway, 0.0, -26.0 + 1.2 * breath),
            "LowerArm_L": (-13.0 - 2.0 * breath, 0.0, 0.0),
            "LowerArm_R": (-13.0 - 2.0 * breath, 0.0, 0.0),
            "Hand_L": (3.0 + 1.0 * sway, 0.0, 4.0),
            "Hand_R": (3.0 - 1.0 * sway, 0.0, -4.0),
        }
        pose.update(clip.s.finger_pose(20.0 + 2.0 * breath))
        clip.key_upper(frame, pose,
                       hips=(0.012 + 0.004 * sway, -0.006 + 0.004 * breath, -0.014 + 0.005 * sway))
        left = FootTarget(y=front_y, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=5.0)
        right = FootTarget(y=back_y, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=9.0)
        clip.key_legs(frame, clip.foot_pair(left, right))


def _walk(clip: _Clip) -> None:
    """Two-step walk cycle: pelvis leads, chest and arms counter-rotate."""
    gait = Gait(stance=0.60, reach=0.28, lift=0.10, heel=7.0, toe_off=16.0, yaw=5.0)
    clip.bake_gait(gait, lean=-3.0, drop=0.042)


def _run(clip: _Clip) -> None:
    """Two-step run cycle with a flight phase and a strong forward lean."""
    gait = Gait(stance=0.36, reach=0.28, lift=0.22, heel=4.0, toe_off=24.0, yaw=4.0)
    clip.bake_gait(gait, lean=-9.0, drop=0.055)


def _jump(clip: _Clip) -> None:
    """Crouch, launch, airborne pose. Feet leave the ground at frame 8."""
    ankle = clip.s.ankle_height
    rest_y = clip.rest_ankle_y()
    keys = (
        # frame, hips(forward, up, side), body pitch, arms, feet(y, z, pitch)
        (1, (0.0, 0.0, 0.0), 2.0, 2.0, (rest_y - 0.03, rest_y + 0.03)),
        (4, (-0.02, -0.055, 0.0), -12.0, 22.0, (rest_y - 0.03, rest_y + 0.03)),
        (6, (-0.03, -0.155, 0.0), -22.0, 42.0, (rest_y - 0.03, rest_y + 0.03)),
        (8, (0.0, -0.020, 0.0), -14.0, -20.0, (rest_y - 0.02, rest_y + 0.02)),
        (10, (0.02, 0.105, 0.0), -6.0, -62.0, None),
        (13, (0.02, 0.135, 0.0), 2.0, -74.0, None),
        (18, (0.01, 0.115, 0.0), 6.0, -50.0, None),
    )
    for frame, hips, pitch, arm, feet in keys:
        pose = {
            **clip.standing,
            "Hips": (pitch, 0.0, 0.0),
            "Spine": (pitch * 0.5, 0.0, 0.0),
            "Chest": (pitch * 0.35, 0.0, 0.0),
            "UpperChest": (pitch * 0.25, 0.0, 0.0),
            "Neck": (-pitch * 0.5, 0.0, 0.0),
            "Head": (-pitch * 0.8, 0.0, 0.0),
            "Shoulder_L": (0.0, 0.0, -0.25 * arm),
            "Shoulder_R": (0.0, 0.0, 0.25 * arm),
            "Hand_L": (4.0, 0.0, 0.0),
            "Hand_R": (4.0, 0.0, 0.0),
        }
        # arm > 0 swings both hands back, arm < 0 drives them forward and up.
        pose.update(_arms((16.0 - 0.10 * arm, -arm, 20.0 + 0.25 * abs(arm)),
                          (16.0 - 0.10 * arm, -arm, 20.0 + 0.25 * abs(arm))))
        pose.update(clip.s.finger_pose(30.0 if frame < 8 else 18.0))
        clip.key_upper(frame, pose, hips=hips)
    for frame in range(1, clip.frames + 1):
        grounded = frame <= 8
        targets = {}
        for side, base in ((1, rest_y - 0.03), (-1, rest_y + 0.03)):
            if grounded:
                pitch = _track([(1, 0.0), (5, 0.0), (8, -16.0)], frame)
                targets[side] = FootTarget(y=base, z=ankle, pitch=pitch, toe=0.0,
                                           yaw=5.0 * side)
            else:
                targets[side] = FootTarget(
                    forward=_track([(9, 0.06), (12, 0.16), (18, 0.20)], frame),
                    down=_track([(9, 0.80), (12, 0.62), (18, 0.70)], frame),
                    pitch=_track([(9, -14.0), (13, -4.0), (18, 8.0)], frame),
                    toe=None, yaw=5.0 * side)
        clip.key_legs(frame, targets)


def _fall(clip: _Clip) -> None:
    """Airborne loop: arms out for balance, legs trailing."""
    beats = 12
    for step in range(beats + 1):
        t = step / beats
        frame = 1 + round(t * (clip.frames - 1))
        phase = TAU * t
        sin, cos = math.sin(phase), math.cos(phase)
        pose = {
            **clip.standing,
            "Hips": (-2.0 + 1.5 * cos, 1.5 * sin, 1.0 * sin),
            "Spine": (-3.0 + 1.0 * cos, -1.0 * sin, 0.0),
            "Chest": (-2.0 + 1.0 * cos, -1.0 * sin, 0.0),
            "UpperChest": (-1.0, -0.5 * sin, 0.0),
            "Neck": (2.0, 0.0, 0.0),
            "Head": (4.0 + 2.0 * cos, 4.0 * sin, 0.0),
            "Shoulder_L": (0.0, 0.0, -6.0),
            "Shoulder_R": (0.0, 0.0, 6.0),
            "Hand_L": (0.0, 0.0, 12.0),
            "Hand_R": (0.0, 0.0, -12.0),
        }
        pose.update(_arms((72.0 + 6.0 * cos, 6.0 + 4.0 * cos, 34.0 + 8.0 * sin),
                          (72.0 - 6.0 * cos, 6.0 - 4.0 * cos, 34.0 - 8.0 * sin)))
        pose.update(clip.s.finger_pose(16.0))
        pose["UpperLeg_L"] = (-26.0 + 8.0 * cos, 0.0, -2.0)
        pose["UpperLeg_R"] = (2.0 - 8.0 * cos, 0.0, 2.0)
        pose["LowerLeg_L"] = (58.0 + 12.0 * cos, 0.0, 0.0)
        pose["LowerLeg_R"] = (34.0 - 12.0 * cos, 0.0, 0.0)
        pose["Foot_L"] = (-16.0, 0.0, 4.0)
        pose["Foot_R"] = (-16.0, 0.0, -4.0)
        pose["Toe_L"] = (0.0, 0.0, 0.0)
        pose["Toe_R"] = (0.0, 0.0, 0.0)
        clip.key_upper(frame, pose, hips=(0.0, 0.03 + 0.01 * cos, 0.004 * sin))


def _land(clip: _Clip) -> None:
    """Impact absorb back to the idle stance."""
    ankle = clip.s.ankle_height
    rest_y = clip.rest_ankle_y()
    keys = (
        (1, (0.0, 0.045, 0.0), -6.0, -30.0),
        (3, (-0.10, -0.075, 0.0), -20.0, -18.0),
        (5, (-0.075, -0.145, 0.0), -24.0, 6.0),
        (9, (-0.03, -0.060, 0.0), -12.0, 12.0),
        (12, (0.0, -0.012, 0.0), 0.0, 6.0),
        (15, (0.012, -0.006, -0.014), 2.0, 2.0),
    )
    for frame, hips, pitch, arm in keys:
        pose = {
            **clip.standing,
            "Hips": (pitch * 0.8, 0.0, 0.0),
            "Spine": (pitch * 0.5, 0.0, 0.0),
            "Chest": (pitch * 0.35, 0.0, 0.0),
            "UpperChest": (pitch * 0.2, 0.0, 0.0),
            "Neck": (-pitch * 0.4, 0.0, 0.0),
            "Head": (-pitch * 0.7, 0.0, 0.0),
            "Shoulder_L": (0.0, 0.0, -0.2 * arm),
            "Shoulder_R": (0.0, 0.0, 0.2 * arm),
            "Hand_L": (4.0, 0.0, 0.0),
            "Hand_R": (4.0, 0.0, 0.0),
        }
        pose.update(_arms((26.0, -arm, 24.0 + 0.6 * abs(arm)),
                          (26.0, -arm, 24.0 + 0.6 * abs(arm))))
        pose.update(clip.s.finger_pose(26.0))
        clip.key_upper(frame, pose, hips=hips)
    for frame in range(1, clip.frames + 1):
        y = _track([(1, rest_y - 0.03), (15, rest_y - 0.055)], frame)
        y_r = _track([(1, rest_y + 0.03), (15, rest_y + 0.055)], frame)
        z = _track([(1, ankle + 0.02), (4, ankle), (15, ankle)], frame)
        pitch = _track([(1, 8.0), (4, 0.0), (15, 0.0)], frame)
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=y, z=z, pitch=pitch, toe=0.0, yaw=5.0),
            FootTarget(y=y_r, z=z, pitch=pitch, toe=0.0, yaw=9.0)))


def _attack(clip: _Clip) -> None:
    """Right straight punch: wind-up, drive from the hips, follow through.

    Arms are aimed instead of rotated, because the punch has to travel straight
    forward: the A-pose roll turns an X rotation of that size into a wide hook.
    """
    rest_y = clip.rest_ankle_y()
    keys = (
        # frame, hips(fwd, up, side), twist, right arm, left arm  (out, swing, bend)
        (1, (0.02, -0.02, 0.0), 0.0, (24.0, 26.0, 118.0), (20.0, 30.0, 122.0)),
        (5, (-0.03, -0.045, -0.012), -14.0, (30.0, -18.0, 132.0), (22.0, 26.0, 116.0)),
        (9, (0.05, -0.020, 0.010), 26.0, (-4.0, 86.0, 4.0), (26.0, 34.0, 128.0)),
        (12, (0.06, -0.018, 0.012), 31.0, (-3.0, 92.0, 0.0), (27.0, 36.0, 130.0)),
        (16, (0.02, -0.025, 0.004), 10.0, (14.0, 52.0, 62.0), (24.0, 32.0, 124.0)),
        (20, (0.02, -0.022, 0.0), -4.0, (22.0, 30.0, 112.0), (21.0, 30.0, 120.0)),
        (24, (0.02, -0.02, 0.0), 0.0, (24.0, 26.0, 118.0), (20.0, 30.0, 122.0)),
    )
    for frame, hips, twist, right, left in keys:
        pose = {
            **clip.standing,
            "Hips": (-4.0, twist * 0.45, 0.0),
            "Spine": (-3.0, twist * 0.30, 0.0),
            "Chest": (-2.0, twist * 0.25, 0.0),
            "UpperChest": (-1.0, twist * 0.20, 0.0),
            "Neck": (2.0, -twist * 0.10, 0.0),
            "Head": (0.0, -twist * 0.45, 0.0),
            "Shoulder_L": (2.0, 0.0, -4.0),
            "Shoulder_R": (4.0 - 0.6 * twist, 0.0, 6.0),
            "Hand_L": (0.0, 0.0, 10.0),
            "Hand_R": (0.0, 0.0, -4.0),
        }
        pose.update(_arms(left, right))
        pose.update(clip.s.finger_pose(96.0, thumb=60.0))
        clip.key_upper(frame, pose, hips=hips)
    for frame in range(1, clip.frames + 1):
        drive = _track([(1, 0.0), (5, 0.0), (9, 1.0), (12, 1.0), (16, 0.35), (24, 0.0)], frame)
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=rest_y - 0.13, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=8.0),
            FootTarget(y=rest_y + 0.13, z=clip.s.ankle_height + 0.02 * drive,
                       pitch=-6.0 * drive, toe=0.0, yaw=26.0 + 10.0 * drive)))


def _hit(clip: _Clip) -> None:
    """Flinch backwards: head snaps back, knees buckle, guard comes up."""
    rest_y = clip.rest_ankle_y()
    keys = (
        (1, (0.0, -0.010, 0.0), 2.0, 2.0, 0.0),
        (3, (-0.045, -0.055, 0.010), 12.0, -26.0, 14.0),
        (5, (-0.070, -0.090, 0.014), 16.0, -34.0, 18.0),
        (8, (-0.040, -0.055, 0.008), 8.0, -20.0, 10.0),
        (11, (-0.012, -0.022, 0.002), 3.0, -6.0, 4.0),
        (15, (0.0, -0.008, 0.0), 1.0, 2.0, 0.0),
    )
    for frame, hips, lean, arm, head in keys:
        pose = {
            **clip.standing,
            "Hips": (lean * 0.4, -lean * 0.35, 0.0),
            "Spine": (lean * 0.7, -lean * 0.20, 0.0),
            "Chest": (lean * 0.6, -lean * 0.15, 0.0),
            "UpperChest": (lean * 0.4, lean * 0.10, 0.0),
            "Neck": (lean * 0.3, 0.0, 0.0),
            "Head": (head, -lean * 0.20, 0.0),
            "Shoulder_L": (0.0, 0.0, -0.4 * arm),
            "Shoulder_R": (0.0, 0.0, 0.4 * arm),
            "Hand_L": (0.0, 0.0, 8.0),
            "Hand_R": (0.0, 0.0, -8.0),
        }
        pose.update(_arms((22.0 - 0.3 * arm, -arm, 62.0 - 1.1 * arm),
                          (22.0 - 0.3 * arm, -arm, 62.0 - 1.1 * arm)))
        pose.update(clip.s.finger_pose(78.0, thumb=48.0))
        clip.key_upper(frame, pose, hips=hips)
    for frame in range(1, clip.frames + 1):
        step = _track([(1, 0.0), (3, 0.55), (5, 1.0), (8, 0.85), (15, 0.15)], frame)
        drop = _track([(1, 0.0), (3, 0.5), (5, 1.0), (9, 0.5), (15, 0.0)], frame)
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=rest_y - 0.02, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=6.0),
            FootTarget(y=rest_y + 0.02 + 0.16 * step, z=clip.s.ankle_height + 0.01 * drop,
                       pitch=4.0 * step, toe=0.0, yaw=11.0)))


def _death(clip: _Clip) -> None:
    """Stagger, drop to the knees, then fall flat onto the back."""
    rest_y = clip.rest_ankle_y()
    keys = (
        # frame, hips(fwd, up, side), pelvis pitch, spine, arms, head
        (1, (0.0, -0.005, 0.0), 2.0, -2.0, 2.0, -1.0),
        (3, (-0.02, -0.030, 0.012), 8.0, 10.0, -30.0, 16.0),
        (7, (-0.09, -0.070, 0.020), 14.0, 8.0, -46.0, 20.0),
        (13, (-0.10, -0.180, 0.016), 16.0, 4.0, -30.0, 14.0),
        (19, (-0.06, -0.380, 0.008), 22.0, 10.0, 22.0, 6.0),
        (26, (0.10, -0.630, 0.0), 46.0, 16.0, 42.0, -4.0),
        (33, (0.14, -0.795, -0.004), 76.0, 6.0, 34.0, 2.0),
        (39, (0.15, -0.822, -0.006), 86.0, 2.0, 16.0, -4.0),
        (43, (0.15, -0.814, -0.006), 84.0, 4.0, 20.0, -7.0),
        (48, (0.15, -0.822, -0.006), 86.0, 3.0, 18.0, -5.0),
    )
    for frame, hips, pitch, spine, arm, head in keys:
        pose = {
            **clip.standing,
            "Hips": (pitch, 0.0, 0.0),
            "Spine": (spine, 0.0, 0.0),
            "Chest": (spine * 0.7, 0.0, 0.0),
            "UpperChest": (spine * 0.4, 0.0, 0.0),
            "Neck": (-spine * 0.3, 0.0, 0.0),
            "Head": (head, 12.0 * _track([(39, 0.0), (43, 1.0), (48, 0.9)], frame), 0.0),
            "Shoulder_L": (0.0, 0.0, -0.3 * max(arm, 0.0)),
            "Shoulder_R": (0.0, 0.0, 0.3 * max(arm, 0.0)),
            "Hand_L": (0.0, 0.0, 6.0),
            "Hand_R": (0.0, 0.0, -6.0),
        }
        # Once the body is flat the arms are aimed *in world space*, so they have
        # to end up horizontal: a hanging aim would drive them through the floor.
        arm_out = _track([(1, 18.0), (7, 26.0), (13, 24.0), (19, 40.0), (26, 72.0),
                          (33, 92.0), (39, 101.0), (48, 101.0)], frame)
        arm_swing = _track([(1, 2.0), (3, -30.0), (7, -46.0), (13, -30.0), (19, 12.0),
                            (26, 6.0), (33, -4.0), (39, -8.0), (48, -8.0)], frame)
        bend = _track([(1, 14.0), (19, 28.0), (26, 30.0), (33, 20.0), (39, 14.0),
                       (48, 14.0)], frame)
        pose.update(_arms((arm_out, arm_swing, bend), (arm_out, arm_swing, bend)))
        pose.update(clip.s.finger_pose(30.0))
        clip.key_upper(frame, pose, hips=hips)
    for frame in range(1, clip.frames + 1):
        # The boots are off the ground while the legs swing clear, so the long
        # slide out from under the falling body does not drag along the floor.
        lift = _track([(1, 0.0), (21, 0.0), (24, 0.09), (30, 0.08), (33, 0.06),
                       (36, 0.02), (39, 0.012), (48, 0.010)], frame)
        left_y = _track([(1, rest_y - 0.05), (19, rest_y - 0.05), (22, rest_y - 0.22),
                         (25, rest_y - 0.50), (28, rest_y - 0.72), (33, rest_y - 0.88),
                         (39, rest_y - 0.94), (48, rest_y - 0.95)], frame)
        right_y = _track([(1, rest_y + 0.05), (7, rest_y + 0.20), (19, rest_y + 0.20),
                          (22, rest_y - 0.02), (25, rest_y - 0.34), (28, rest_y - 0.55),
                          (33, rest_y - 0.78), (39, rest_y - 0.86), (48, rest_y - 0.87)], frame)
        z = clip.s.ankle_height + lift
        pitch = _track([(1, 0.0), (19, -6.0), (26, -12.0), (33, 18.0), (48, 26.0)], frame)
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=left_y, z=z, pitch=pitch, toe=None, yaw=8.0),
            FootTarget(y=right_y, z=z, pitch=pitch, toe=None, yaw=12.0)))


def _emote_wave(clip: _Clip) -> None:
    """Raise the right arm and wave twice."""
    rest_y = clip.rest_ankle_y()
    keys = (1, 6, 10, 14, 18, 22, 26, 30, 34, 38, 43, 48)
    for frame in keys:
        raised = _track([(1, 0.0), (10, 1.0), (38, 1.0), (48, 0.0)], frame)
        wave = 0.0
        if 10 <= frame <= 38:
            wave = math.sin(TAU * 2.0 * (frame - 12.0) / 26.0)
        pose = {
            **clip.standing,
            "Hips": (0.0, -6.0 * raised, -2.0 * raised),
            "Spine": (-1.0, 3.0 * raised, 0.0),
            "Chest": (-1.0, 4.0 * raised, 0.0),
            "UpperChest": (0.0, 3.0 * raised, 0.0),
            "Neck": (0.0, -4.0 * raised, 0.0),
            "Head": (-2.0 - 2.0 * raised, -12.0 * raised, 2.0 * raised),
            "Shoulder_L": (0.0, 0.0, -1.0),
            "Shoulder_R": (0.0, 0.0, 14.0 * raised),
            "Hand_L": (3.0, 0.0, 4.0),
            "Hand_R": (0.0, 0.0, -6.0 + 14.0 * wave * raised),
        }
        pose.update(_arms((20.0 + 2.0 * raised, 6.0, 12.0),
                          (14.0 + 130.0 * raised, 6.0 - 10.0 * raised,
                           12.0 - raised * (42.0 + 14.0 * wave))))
        pose.update(clip.s.finger_pose(22.0 - 10.0 * raised))
        clip.key_upper(frame, pose, hips=(0.01, -0.004 + 0.004 * raised, -0.014 - 0.02 * raised))
    for frame in range(1, clip.frames + 1):
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=rest_y - 0.075, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=6.0),
            FootTarget(y=rest_y + 0.055, z=clip.s.ankle_height, pitch=0.0, toe=0.0, yaw=10.0)))


def _emote_cheer(clip: _Clip) -> None:
    """Both arms up, two hops."""
    rest_y = clip.rest_ankle_y()
    ankle = clip.s.ankle_height
    keys = (1, 6, 10, 14, 18, 22, 26, 30, 34, 38, 44, 50, 56, 60)
    for frame in keys:
        height = _track([(1, 0.0), (8, -0.02), (12, -0.115), (16, 0.075), (20, 0.0),
                         (26, 0.0), (30, -0.075), (33, 0.045), (36, 0.0), (44, 0.0),
                         (60, 0.0)], frame)
        arms = _track([(1, 0.0), (10, 0.55), (16, 1.0), (22, 0.85), (28, 0.75),
                       (34, 0.95), (40, 0.65), (48, 0.25), (60, 0.0)], frame)
        pose = {
            **clip.standing,
            "Hips": (-3.0 * arms, 0.0, 0.0),
            "Spine": (-3.0 * arms, 0.0, 0.0),
            "Chest": (-2.0 * arms, 0.0, 0.0),
            "UpperChest": (-1.0 * arms, 0.0, 0.0),
            "Neck": (2.0 * arms, 0.0, 0.0),
            "Head": (6.0 * arms, 0.0, 0.0),
            "Shoulder_L": (0.0, 0.0, -10.0 * arms),
            "Shoulder_R": (0.0, 0.0, 10.0 * arms),
            "Hand_L": (0.0, 0.0, 10.0 * arms),
            "Hand_R": (0.0, 0.0, -10.0 * arms),
        }
        pose.update(_arms((24.0 + 140.0 * arms, -4.0 * arms, -(10.0 + 30.0 * arms)),
                          (24.0 + 140.0 * arms, -4.0 * arms, -(10.0 + 30.0 * arms))))
        pose.update(clip.s.finger_pose(20.0))
        clip.key_upper(frame, pose, hips=(0.0, height, -0.006))
    for frame in range(1, clip.frames + 1):
        air = _track([(1, 0.0), (11, 0.0), (13, 1.0), (19, 1.0), (21, 0.0),
                      (29, 0.0), (31, 1.0), (35, 1.0), (37, 0.0), (60, 0.0)], frame)
        z = ankle + 0.085 * air
        clip.key_legs(frame, clip.foot_pair(
            FootTarget(y=rest_y - 0.045, z=z, pitch=-12.0 * air, toe=None, yaw=6.0),
            FootTarget(y=rest_y + 0.045, z=z, pitch=-12.0 * air, toe=None, yaw=6.0)))


CLIP_BUILDERS = {
    "Idle": _idle,
    "Walk": _walk,
    "Run": _run,
    "Jump": _jump,
    "Fall": _fall,
    "Land": _land,
    "Attack": _attack,
    "Hit": _hit,
    "Death": _death,
    "Emote_Wave": _emote_wave,
    "Emote_Cheer": _emote_cheer,
}


# --------------------------------------------------------------------------- #
# public interface
# --------------------------------------------------------------------------- #


def _new_action(rig: bpy.types.Object, animation: spec.AnimationSpec) -> bpy.types.Action:
    action = bpy.data.actions.get(animation.name)
    if action is None:
        action = bpy.data.actions.new(animation.name)
    else:  # rebuilding in the same file must not leave stale curves behind
        for curve in list(action.fcurves):
            action.fcurves.remove(curve)
    action.use_fake_user = True
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    return action


def _set_interpolation(action: bpy.types.Action, leg_bones: tuple[str, ...],
                       baked: bool) -> None:
    for curve in action.fcurves:
        linear = baked and any(f'"{name}"' in curve.data_path for name in leg_bones)
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR" if linear else "BEZIER"
            if not linear:
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"


def build_actions(rig: bpy.types.Object, variant) -> dict[str, bpy.types.Action]:
    """Create one action per clip in :data:`spec.ANIMATIONS` and return them."""
    if isinstance(variant, str):
        variant = next(item for item in spec.VARIANTS if item.key == variant)
    skeleton = _Skeleton(rig, variant)
    scene = bpy.context.scene
    scene.render.fps = spec.FPS
    leg_bones = tuple(part + suffix for part in LEG_PARTS for _, suffix in SIDES)

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    skeleton.calibrate_soles(meshes)

    # Deforming 45k vertices for every IK iteration is the only slow part of the
    # authoring pass, and no measurement here depends on the skin.
    deferred: list[bpy.types.Modifier] = []
    for obj in meshes:
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE" and modifier.show_viewport:
                modifier.show_viewport = False
                deferred.append(modifier)

    actions: dict[str, bpy.types.Action] = {}
    try:
        skeleton.reset()
        for animation in spec.ANIMATIONS:
            action = _new_action(rig, animation)
            clip = _Clip(skeleton, animation)
            skeleton.reset()
            scene.frame_start = 1
            scene.frame_end = animation.frames
            builder = CLIP_BUILDERS[animation.name]
            builder(clip)
            _set_interpolation(action, leg_bones, clip.baked_legs)
            actions[animation.name] = action
    finally:
        for modifier in deferred:
            modifier.show_viewport = True
        rig.animation_data.action = actions.get(spec.ANIMATIONS[0].name)
        scene.frame_start = 1
        scene.frame_end = max(animation.frames for animation in spec.ANIMATIONS)
        scene.frame_set(1)
        skeleton.update()
    return actions
