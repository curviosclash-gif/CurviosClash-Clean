"""Frozen product specification for the modular mercenary scout ("Kestrel").

Contract that is fixed before the first polygon lives here, not in a separate
document: proportions, joint positions, rig, materials, variants and budgets.

Units and scale
    1 Blender unit = 1 metre. Height 1.80 m. The origin sits between the feet on
    the ground plane (Blender z = 0). The character faces Blender -Y, +X is the
    character's left side.

Axes in the exports
    glTF is written with ``export_yup=True``: Blender (x, y, z) becomes glTF
    (x, z, -y). The character therefore faces glTF +Z and up is +Y. FBX is
    written Y up as well. Consumers that want -Z forward rotate the root by 180
    degrees around Y; the datasheet names both conventions.

Naming
    Bones use ``_L``/``_R`` suffixes instead of dots: three.js strips every
    character outside ``[A-Za-z0-9_-]`` from node names, so ``UpperArm.L`` would
    silently become ``UpperArmL``. Meshes carry the ``merc_scout_`` prefix.

Variants (three saleable densities from one generator)
    mobile  ~24k triangles, 1024 px textures, 7 materials, 2 finger segments
    pc      ~45k triangles, 2048 px textures, 8 materials, 3 finger segments
    high    ~120k triangles, 4096 px skin texture (2048 px elsewhere), 8 materials,
            added stitching, laces and seam geometry

Rig
    A-pose bind, 4 bone influences per vertex maximum, root motion free
    (clips are "in place"), 30 fps.

Animation clips
    Idle, Walk, Run, Jump, Fall, Land, Attack, Hit, Death, Emote_Wave,
    Emote_Cheer. Loops: Idle, Walk, Run, Fall.

Licence
    Royalty free, commercial use allowed, redistributing the model itself is
    not allowed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# --------------------------------------------------------------------------- #
# tiny vector helpers (kept free of bpy so the spec can be read anywhere)
# --------------------------------------------------------------------------- #

Vec3 = tuple[float, float, float]


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec3, factor: float) -> Vec3:
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Vec3) -> Vec3:
    magnitude = length(a)
    return scale(a, 1.0 / magnitude) if magnitude else (0.0, 0.0, 0.0)


def lerp(a: Vec3, b: Vec3, t: float) -> Vec3:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def mirror_x(point: Vec3, side: int) -> Vec3:
    return (point[0] * side, point[1], point[2])


# --------------------------------------------------------------------------- #
# proportions
# --------------------------------------------------------------------------- #

HEIGHT = 1.80

#: Lean athletic build: 7.65 heads tall, which reads stylised but not cartoonish.
LANDMARKS = {
    "crown": 1.800,
    "brow": 1.700,
    "eye": 1.668,
    "nose_tip": 1.622,
    "mouth": 1.596,
    "chin": 1.565,
    "neck_base": 1.498,
    "shoulder_top": 1.472,
    "armpit": 1.355,
    "chest": 1.296,
    "waist": 1.134,
    "hip": 0.954,
    "crotch": 0.873,
    "knee": 0.513,
    "ankle": 0.070,
}

#: Cross-section half widths (rx = side to side, ry = front to back). The values
#: are half of the reference breadths in ANTHROPOMETRY, not guesses.
WIDTHS = {
    "neck": (0.058, 0.055),
    "shoulder": (0.220, 0.105),
    "chest": (0.157, 0.112),
    "waist": (0.140, 0.104),
    "hip": (0.172, 0.115),
    "thigh": (0.092, 0.094),
    "calf": (0.064, 0.068),
    "upper_arm": (0.050, 0.048),
    "forearm": (0.043, 0.041),
    "wrist": (0.031, 0.024),
    "palm": (0.048, 0.026),
    "finger": (0.0105, 0.0105),
    "head": (0.079, 0.100),
    "foot": (0.040, 0.108),
}

#: Reference body measurements for a 1.80 m adult, in metres. The fractions behind
#: them are the anthropometric proportions that game and film rigs are built on
#: (Drillis/Contini tables, as used for character rigs and ergonomic design):
#: eye 0.936 H, acromion 0.818 H, waist 0.630 H, crotch 0.485 H, trochanter 0.530 H,
#: knee 0.285 H, malleolus 0.039 H, foot 0.152 H, biacromial 0.245 H, head breadth
#: 0.087 H, head length 0.111 H, arm span 1.00-1.06 H.
#: ``audit.proportion_audit`` compares the built model against this table; a
#: deviation beyond ``TOLERANCE`` is reported instead of being hidden.
ANTHROPOMETRY = {
    "total_height": 1.800,
    "eye": 1.685,
    "chin": 1.575,
    "shoulder": 1.472,
    "chest": 1.296,
    "waist": 1.134,
    "crotch": 0.873,
    "hip_joint": 0.954,
    "knee": 0.513,
    "ankle": 0.070,
    "head_breadth": 0.157,
    "head_length": 0.200,
    "head_height": 0.234,
    "shoulder_breadth": 0.440,
    "chest_breadth": 0.314,
    "waist_breadth": 0.280,
    "hip_breadth": 0.344,
    "humerus": 0.315,
    "radius": 0.250,
    "hand": 0.190,
    "femur": 0.441,
    "tibia": 0.443,
    "foot": 0.274,
    #: The foot *bone* runs from the ankle to the toe joint; the heel sits about
    #: 60 mm behind the ankle, so the bone is shorter than the anatomical foot.
    "foot_bone": 0.214,
    #: Distance between the two shoulder joints (glenohumeral), not the acromion span.
    "shoulder_joint_distance": 0.380,
    #: Silhouette breadth across the deltoids; a body is wider here than the bone span.
    "deltoid_breadth": 0.520,
    "arm_span_ratio": (1.00, 1.06),
}

#: The finished model is scaled to the contract height and dropped onto z = 0. That
#: correction has to stay small: a large offset means geometry dips below the sole
#: plane, which silently lifts every landmark and distorts every proportion.
NORMALISATION_TOLERANCE = 0.02

#: How far the built model may sit from the reference before the audit complains.
TOLERANCE = 0.06

ARM_ANGLE_DEG = 40.0  # from vertical, the usual A-pose
ARM_FORWARD_LEAN = 0.06
#: The arm is split the way an anatomical arm is split (upper arm longer than the
#: forearm) while keeping the total, so the T-pose span stays at about 1.05 H.
UPPER_ARM_LENGTH = 0.315
FOREARM_LENGTH = 0.250
PALM_LENGTH = 0.105
FINGER_LENGTHS = {"Index": 0.078, "Middle": 0.085, "Ring": 0.078, "Pinky": 0.063, "Thumb": 0.060}
FINGER_SPREAD = {  # along the forward axis of the hand, thumb side positive
    "Index": 0.0265,
    "Middle": 0.0090,
    "Ring": -0.0090,
    "Pinky": -0.0265,
    "Thumb": 0.0300,
}
PHALANX_SHARE = {"Index": (0.42, 0.33, 0.25), "Middle": (0.42, 0.33, 0.25),
                 "Ring": (0.42, 0.33, 0.25), "Pinky": (0.44, 0.32, 0.24),
                 "Thumb": (0.45, 0.30, 0.25)}

_ARM_DIRECTION = normalize((math.sin(math.radians(ARM_ANGLE_DEG)),
                            -ARM_FORWARD_LEAN,
                            -math.cos(math.radians(ARM_ANGLE_DEG))))

SHOULDER = (0.190, -0.010, 1.445)
ELBOW = add(SHOULDER, scale(_ARM_DIRECTION, UPPER_ARM_LENGTH))
WRIST = add(ELBOW, scale(_ARM_DIRECTION, FOREARM_LENGTH))

HIP_JOINT = (0.088, -0.005, ANTHROPOMETRY["hip_joint"])
KNEE_JOINT = (0.100, -0.022, LANDMARKS["knee"])
ANKLE_JOINT = (0.104, 0.012, LANDMARKS["ankle"])
#: The ankle sits about 60 mm in front of the heel, so the toe joint has to reach
#: 214 mm forward for the reference foot length of 274 mm.
TOE_JOINT = (0.106, -0.202, 0.026)

#: All joints for the character's left side; the right side mirrors x. The spine
#: describes a real S-curve: lumbar forward, thoracic back, cervical forward again.
JOINTS_L: dict[str, Vec3] = {
    "hips": (0.0, -0.005, 0.995),
    "spine": (0.0, -0.020, 1.100),
    "chest": (0.0, 0.012, 1.230),
    "upper_chest": (0.0, 0.008, 1.350),
    "neck": (0.0, -0.015, 1.482),
    "head": (0.0, -0.010, 1.556),
    "head_top": (0.0, -0.004, 1.790),
    "shoulder": (0.048, -0.008, 1.418),
    "upper_arm": SHOULDER,
    "lower_arm": ELBOW,
    "hand": WRIST,
    "upper_leg": HIP_JOINT,
    "lower_leg": KNEE_JOINT,
    "foot": ANKLE_JOINT,
    "toe": TOE_JOINT,
}

HAND_DIRECTION = normalize(sub(WRIST, ELBOW))
PALM_FORWARD = normalize(sub((-1.0, 0.0, 0.0), scale(HAND_DIRECTION, dot((-1.0, 0.0, 0.0), HAND_DIRECTION))))
#: Palm normal points at the thigh, forward axis points at -Y (thumb side).
PALM_NORMAL = PALM_FORWARD
_hand_side = normalize(cross(HAND_DIRECTION, PALM_NORMAL))
HAND_FORWARD = _hand_side if _hand_side[1] < 0 else scale(_hand_side, -1.0)


#: A relaxed hand curls a little more at every phalanx. A straight bind pose reads
#: as a claw and makes every glove look like a mitten, because body mesh, rig bones
#: and glove shells are all derived from these chains.
FINGER_CURL_DEG = (9.0, 21.0, 26.0)
THUMB_CURL_DEG = (10.0, 18.0, 20.0)
#: Lateral fan in degrees, positive towards the thumb side. Fingers that all point
#: the same way are the other half of the "claw" look.
FINGER_FAN_DEG = {"Index": 5.0, "Middle": 0.0, "Ring": -5.0, "Pinky": -11.0, "Thumb": 0.0}


def _rotate_axis(vector: Vec3, axis: Vec3, degrees: float) -> Vec3:
    """Rodrigues rotation of ``vector`` around (not necessarily unit) ``axis``."""
    angle = math.radians(degrees)
    cosine, sine = math.cos(angle), math.sin(angle)
    unit = normalize(axis)
    return add(add(scale(vector, cosine), scale(cross(unit, vector), sine)),
               scale(unit, dot(unit, vector) * (1.0 - cosine)))


def hand_points(side: int) -> dict[str, list[Vec3]]:
    """Joint chains of one relaxed hand in world space, base first, tip last."""
    wrist = mirror_x(WRIST, side)
    forward = mirror_x(HAND_FORWARD, side)
    normal = mirror_x(PALM_NORMAL, side)
    direction = mirror_x(HAND_DIRECTION, side)
    # Curling around this axis swings a fingertip towards the palm.
    curl_axis = cross(direction, normal)
    chains: dict[str, list[Vec3]] = {}
    knuckle_line = add(wrist, scale(direction, PALM_LENGTH))
    for finger, total in FINGER_LENGTHS.items():
        if finger == "Thumb":
            root = add(add(knuckle_line, scale(forward, FINGER_SPREAD[finger])),
                       scale(normal, 0.012))
            heading = normalize(add(add(scale(direction, 0.55), scale(forward, 0.78)),
                                    scale(normal, 0.18)))
            curls = THUMB_CURL_DEG
        else:
            root = add(knuckle_line, scale(forward, FINGER_SPREAD[finger]))
            heading = normalize(add(direction, scale(
                forward, math.tan(math.radians(FINGER_FAN_DEG[finger])))))
            curls = FINGER_CURL_DEG
        chain = [root]
        for index, share in enumerate(PHALANX_SHARE[finger]):
            if index:
                heading = _rotate_axis(heading, curl_axis, curls[min(index - 1, len(curls) - 1)])
            chain.append(add(chain[-1], scale(heading, total * share)))
        chains[finger] = chain
    return {"wrist": wrist, "knuckle": knuckle_line, "chains": chains}


# --------------------------------------------------------------------------- #
# rig
# --------------------------------------------------------------------------- #

SPINE_BONES = (
    ("Root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.095)),
    ("Hips", "Root", JOINTS_L["hips"], JOINTS_L["spine"]),
    ("Spine", "Hips", JOINTS_L["spine"], JOINTS_L["chest"]),
    ("Chest", "Spine", JOINTS_L["chest"], JOINTS_L["upper_chest"]),
    ("UpperChest", "Chest", JOINTS_L["upper_chest"], JOINTS_L["neck"]),
    ("Neck", "UpperChest", JOINTS_L["neck"], JOINTS_L["head"]),
    ("Head", "Neck", JOINTS_L["head"], JOINTS_L["head_top"]),
)

LIMB_BONES = (
    ("Shoulder", "UpperChest", "shoulder", "upper_arm"),
    ("UpperArm", "Shoulder", "upper_arm", "lower_arm"),
    ("LowerArm", "UpperArm", "lower_arm", "hand"),
    ("Hand", "LowerArm", "hand", None),  # tail is the knuckle line
    ("UpperLeg", "Hips", "upper_leg", "lower_leg"),
    ("LowerLeg", "UpperLeg", "lower_leg", "foot"),
    ("Foot", "LowerLeg", "foot", "toe"),
    ("Toe", "Foot", "toe", None),  # tail points forward, see skeleton_tail()
)

TOE_TIP_OFFSET = (0.0, -0.075, -0.012)
KNUCKLE_TAIL_OFFSET = None  # computed from hand_points()


def bone_specs(finger_segments: int = 3) -> list[dict]:
    """Every bone as ``{name, parent, head, tail}`` in creation order."""
    bones: list[dict] = []
    for name, parent, head, tail in SPINE_BONES:
        bones.append({"name": name, "parent": parent, "head": head, "tail": tail})

    hand_cache = {side: hand_points(side) for side in (1, -1)}
    for side, suffix in ((1, "_L"), (-1, "_R")):
        for name, parent, head_key, tail_key in LIMB_BONES:
            head = mirror_x(JOINTS_L[head_key], side)
            if tail_key is None:
                if name == "Hand":
                    tail = hand_cache[side]["knuckle"]
                else:  # Toe
                    tail = add(head, TOE_TIP_OFFSET)
            else:
                tail = mirror_x(JOINTS_L[tail_key], side)
            parent_name = parent if parent in {b["name"] for b in bones} else parent + suffix
            bones.append({"name": name + suffix, "parent": parent_name,
                          "head": head, "tail": tail})

        chains = hand_cache[side]["chains"]
        for finger, chain in chains.items():
            # Three segments use every phalanx boundary; two segments merge the
            # proximal and middle phalanx, which is what mobile budgets allow.
            points = chain[1:] if finger_segments == 3 else chain[2:]
            parent_name = "Hand" + suffix
            bones.append({"name": f"{finger}1{suffix}", "parent": parent_name,
                          "head": chain[0], "tail": points[0]})
            parent_name = f"{finger}1{suffix}"
            for index, point in enumerate(points[1:], start=2):
                bones.append({"name": f"{finger}{index}{suffix}", "parent": parent_name,
                              "head": points[index - 2], "tail": point})
                parent_name = f"{finger}{index}{suffix}"
    return bones


#: Finger bone count per variant: mobile merges the two distal segments.
FINGER_SEGMENTS = {"mobile": 2, "pc": 3, "high": 3}

#: Extra bones only the high variant carries (cheap secondary motion).
EXTRA_BONES_HIGH = ("CoatBack", "StrapFront")


# --------------------------------------------------------------------------- #
# variants, materials, animations
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Variant:
    key: str
    label: str
    subdivision: int
    texture_size: int
    skin_texture_size: int
    max_triangles: int
    max_glb_mib: float
    materials: tuple[str, ...]
    finger_segments: int
    detail: bool
    note: str
    extra: tuple[str, ...] = field(default_factory=tuple)


VARIANTS: tuple[Variant, ...] = (
    Variant(
        key="mobile",
        label="Mobile / Handheld",
        subdivision=1,
        texture_size=1024,
        skin_texture_size=1024,
        #: The realistic head (9k) and the garment detail pass set the floor; 15k
        #: would only be reachable by decimating, which destroys the quad topology.
        max_triangles=26000,
        max_glb_mib=6.0,
        materials=("Skin", "Hair", "Eye", "Jacket", "Trousers", "Leather", "Metal"),
        finger_segments=2,
        detail=False,
        note="Single LOD, atlas textures, no secondary geometry.",
    ),
    Variant(
        key="pc",
        label="PC / Steam",
        subdivision=2,
        texture_size=2048,
        skin_texture_size=2048,
        max_triangles=45000,
        max_glb_mib=24.0,
        materials=("Skin", "Hair", "Eye", "Jacket", "Trousers", "Leather", "Metal", "Accent"),
        finger_segments=3,
        detail=True,
        note="Main product, hero LOD for third person games.",
    ),
    Variant(
        key="high",
        label="High / Cinematic",
        subdivision=3,
        texture_size=2048,
        skin_texture_size=4096,
        max_triangles=120000,
        max_glb_mib=64.0,
        materials=("Skin", "Hair", "Eye", "Jacket", "Trousers", "Leather", "Metal", "Accent"),
        finger_segments=3,
        detail=True,
        note="Denser mesh plus stitching, laces and seam geometry.",
        extra=EXTRA_BONES_HIGH,
    ),
)


@dataclass(frozen=True)
class MaterialSpec:
    name: str
    base_color: tuple[float, float, float]
    metallic: float
    roughness: float
    painted: bool
    note: str = ""


MATERIALS: tuple[MaterialSpec, ...] = (
    MaterialSpec("Skin", (1.0, 1.0, 1.0), 0.0, 0.42, True, "textured, tinted skin, scar and stubble detail"),
    MaterialSpec("Hair", (1.0, 1.0, 1.0), 0.0, 0.55, True, "cropped hair mass with painted strands"),
    MaterialSpec("Eye", (1.0, 1.0, 1.0), 0.0, 0.15, True, "sclera, iris and pupil"),
    MaterialSpec("Jacket", (1.0, 1.0, 1.0), 0.0, 0.62, True, "coated canvas, quilted lining"),
    MaterialSpec("Trousers", (1.0, 1.0, 1.0), 0.0, 0.70, True, "ripstop weave, knee reinforcement"),
    MaterialSpec("Leather", (1.0, 1.0, 1.0), 0.0, 0.48, True, "boots, gloves, belt, pouches"),
    MaterialSpec("Metal", (0.62, 0.63, 0.66), 0.92, 0.34, False, "buckles, zips, clips"),
    MaterialSpec("Accent", (1.0, 1.0, 1.0), 0.0, 0.55, True, "unit patches, straps, edge wear"),
)

#: UV regions for the shared material atlases: 64 slots in an 8x8 grid (48 used).
#: One slot per part, because the painter has to know where the face centre, the
#: quilted lining or a boot seam lands.
REGION_GRID = 8
REGION_MARGIN = 0.006
REGION_SLOTS: tuple[str, ...] = (
    # row 0 - head
    "head", "nose", "lips", "ear_L", "ear_R", "brow_L", "brow_R", "eye_L",
    # row 1 - head details and skin
    "eye_R", "lid_L", "lid_R", "hair", "fringe", "body", "body_back", "scar",
    # row 2 - jacket
    "jacket", "sleeve_L", "sleeve_R", "hood", "collar", "quilt", "zip", "patch",
    # row 3 - legs and kit
    "trousers", "knee_pad", "pocket", "cuff", "belt", "pouch_A", "pouch_B", "holster",
    # row 4 - boots, gloves, straps
    "boots", "boot_sole", "boot_cuff", "laces", "gloves", "glove_palm", "glove_knuckle", "straps",
    # row 5 - accents and metal trim
    "accent", "accent_L", "accent_R", "metal", "metal_dark", "spare_a", "spare_b", "spare_c",
    # row 6 - realism pass: seams and face detail
    "stitch", "seam", "rivet", "buckle", "tread", "stubble", "cheek", "lobe",
    # row 7 - realism pass: skin and wear
    "nostril", "lip_upper", "lip_lower", "lid_crease", "hairline", "grime", "worn", "pores",
)
REGIONS: dict[str, tuple[int, int]] = {
    name: (index % REGION_GRID, index // REGION_GRID) for index, name in enumerate(REGION_SLOTS)
}


def region_uv(name: str) -> tuple[float, float, float, float]:
    """Return the (u0, v0, u1, v1) rectangle of a named atlas slot."""
    column, row = REGIONS[name]
    span = 1.0 / REGION_GRID
    u0 = column * span + REGION_MARGIN
    v0 = row * span + REGION_MARGIN
    return (u0, v0, u0 + span - 2 * REGION_MARGIN, v0 + span - 2 * REGION_MARGIN)


@dataclass(frozen=True)
class AnimationSpec:
    name: str
    frames: int
    loop: bool
    description: str


FPS = 30

ANIMATIONS: tuple[AnimationSpec, ...] = (
    AnimationSpec("Idle", 90, True, "breathing stance, weight on the back foot, small head turn"),
    AnimationSpec("Walk", 32, True, "full cycle, two steps, 1.07 s"),
    AnimationSpec("Run", 22, True, "full cycle, two steps, forward lean, 0.73 s"),
    AnimationSpec("Jump", 18, False, "crouch, launch, airborne pose"),
    AnimationSpec("Fall", 24, True, "airborne loop with arms out for balance"),
    AnimationSpec("Land", 15, False, "impact absorb back to ready"),
    AnimationSpec("Attack", 24, False, "right straight punch with counter rotation"),
    AnimationSpec("Hit", 15, False, "flinch backwards, guard up"),
    AnimationSpec("Death", 48, False, "stagger, knee drop, fall onto the back"),
    AnimationSpec("Emote_Wave", 48, False, "raise right arm and wave twice"),
    AnimationSpec("Emote_Cheer", 60, False, "both arms up, two hops"),
)

#: Clips the datasheet advertises as seamless loops.
LOOPING_CLIPS = tuple(animation.name for animation in ANIMATIONS if animation.loop)

#: Root motion is deliberately absent: every clip is authored in place.
ROOT_MOTION = "none"

#: Bone name mapping for the engines buyers ask about.
ENGINE_BONE_MAP = {
    "Unity Mecanim": {"Hips": "Hips", "Spine": "Spine", "Chest": "Chest",
                      "UpperArm_L": "LeftUpperArm", "LowerArm_L": "LeftLowerArm",
                      "Hand_L": "LeftHand", "UpperLeg_L": "LeftUpperLeg",
                      "LowerLeg_L": "LeftLowerLeg", "Foot_L": "LeftFoot"},
    "Unreal": {"Hips": "pelvis", "Spine": "spine_01", "Chest": "spine_03",
               "UpperArm_L": "upperarm_l", "LowerArm_L": "lowerarm_l",
               "Hand_L": "hand_l", "UpperLeg_L": "thigh_l",
               "LowerLeg_L": "calf_l", "Foot_L": "foot_l"},
}
