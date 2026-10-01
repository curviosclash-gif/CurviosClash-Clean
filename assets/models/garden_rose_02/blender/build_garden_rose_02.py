"""Regenerate only the structural parts of the authored Rose 02 specimen.

Open ``garden_rose_02.blend`` in Blender, then run this file to rebuild its
cane, prickles, peduncle, and bud shoot. Authored leaves, flower, and bud are
kept as editable meshes and follow stable local attachment sockets.
"""

import json
import hashlib
import math
import random
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent
BLEND_PATH = ROOT / "garden_rose_02.blend"
SEED = 314159
SCHEMA = "rose02.hybrid.v1"
OWNER = "garden_rose_02.generator"
GENERATED_COLLECTION = "ROSE02 | Generated structure"
SOCKET_COLLECTION = "ROSE02 | Attachment sockets"
AUTHOR_COLLECTIONS = {
    "leaf": "02 Compound leaves",
    "flower": "03 Open flower",
    "bud": "04 Bud",
}
SOCKET_ROLES = ("leaf.01", "leaf.02", "leaf.03", "flower.main", "bud.main")
DEFAULTS = {"stem_height_scale": 1.0}
PARAMETER_LIMITS = {"stem_height_scale": (0.9, 1.1)}

_STEM_PATH = (
    (0.0, 0.0, 0.0), (0.006, 0.003, 0.11), (0.018, 0.006, 0.23),
    (0.034, 0.005, 0.35), (0.052, 0.012, 0.47),
    (0.073, 0.025, 0.57), (0.099, 0.044, 0.665),
)
_STEM_RADII = (0.0075, 0.0072, 0.0066, 0.0058, 0.005, 0.0042, 0.0033)
_LEAF_SOCKETS = (
    (0.022, 0.004, 0.25), (0.046, 0.01, 0.42), (0.066, 0.02, 0.535),
)
_FLOWER_SOCKET = (0.099, 0.044, 0.665)
_BUD_ROOT = (0.055, 0.015, 0.48)
_BUD_MID = (0.13, -0.036, 0.545)
_BUD_TIP = (0.207, -0.056, 0.603)
_LEGACY_GENERATED_NAMES = {
    "Main arching cane", "Flower peduncle", "Bud lateral shoot",
    "Curved prickle 1", "Curved prickle 2", "Curved prickle 3",
    "Curved prickle 4", "Curved prickle 5",
}
_LEGACY_VERTEX_COUNTS = {
    "Main arching cane": 84,
    "Curved prickle 1": 21, "Curved prickle 2": 21,
    "Curved prickle 3": 21, "Curved prickle 4": 21, "Curved prickle 5": 21,
    "Flower peduncle": 20,
    "Bud lateral shoot": 27,
}
_LEGACY_GEOMETRY_SHA256 = {
    "Main arching cane": "c515ba4cc99253025677871a5afe06bb864a958d2a75ffb778a0d45f4a6498e2",
    "Flower peduncle": "7044ec85a94962de907ffbba2e1de5aafff8fb657017572b61b1ce283ae8130d",
    "Bud lateral shoot": "b02a887e0a5c4d6171b44c998e1a99065766d624bd2356595d106d0a37c8ec8b",
    "Curved prickle 1": "aa451d599d3056836e387079363b59fccdefd889ff1c1bf74be2430471cea0e9",
    "Curved prickle 2": "0ac4c825faba383a2cdb636037fbc598f51d33cf4c0b0513b7f15e51080b9ff1",
    "Curved prickle 3": "e4ca91b9032df934a38cb0512e13a367a2a6e7b2beee61916e8e95ab102406ec",
    "Curved prickle 4": "8a8cdd831f829d12b787c0cbbc2f9669a63a938b943d03382da93ef17a958ae3",
    "Curved prickle 5": "c24bd1298f0258778ce85bcfcd6c6f8d3fd9c97a8a64be85fcc5aa5516ba3d21",
}


def _validate(parameters, seed):
    params = dict(DEFAULTS)
    if parameters is not None:
        if not isinstance(parameters, dict):
            raise TypeError("parameters must be a dict")
        unknown = set(parameters) - set(DEFAULTS)
        if unknown:
            raise ValueError(f"unknown parameter(s): {', '.join(sorted(unknown))}")
        params.update(parameters)
    for name, value in params.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(f"{name} must be a finite number")
        if not math.isfinite(value):
            raise ValueError(f"{name} must be finite")
        low, high = PARAMETER_LIMITS[name]
        if not low <= value <= high:
            raise ValueError(f"{name} must be in [{low}, {high}]")
        params[name] = float(value)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise TypeError("seed must be an integer")
    return params


def _preflight(scene):
    required = set(AUTHOR_COLLECTIONS.values()) | {"01 Stems and prickles"}
    missing = sorted(name for name in required if bpy.data.collections.get(name) is None)
    if missing:
        raise RuntimeError("Rose 02 source collections missing: " + ", ".join(missing))
    required_materials = ("Stem | olive green", "Prickles | warm olive")
    missing = [name for name in required_materials if bpy.data.materials.get(name) is None]
    if missing:
        raise RuntimeError("Rose 02 source materials missing: " + ", ".join(missing))
    if scene is None:
        raise RuntimeError("An active Rose 02 source scene is required")
    socket_collection = bpy.data.collections.get(SOCKET_COLLECTION)
    for role in SOCKET_ROLES:
        name = "Socket | " + role
        existing = bpy.data.objects.get(name)
        if existing is None:
            continue
        expected_collections = {socket_collection} if socket_collection is not None else set()
        if (existing.type != "EMPTY" or existing.get("rose02.owner") != "garden_rose_02.socket"
                or existing.get("rose02.role_id") != role
                or not expected_collections.intersection(existing.users_collection[:])):
            raise RuntimeError(f"Unowned or ambiguous Rose 02 socket name: {name}")

    # The original scene has no schema tag. Migrate only its full, validated
    # canonical structure once. After migration, untagged same-name user objects
    # are never considered generator-owned.
    if scene.get("rose02.schema") == SCHEMA:
        return []
    if scene.get("rose02.schema") is not None:
        raise RuntimeError(f"Unsupported Rose 02 schema: {scene.get('rose02.schema')}")
    stems = bpy.data.collections["01 Stems and prickles"]
    missing = sorted(name for name in _LEGACY_GENERATED_NAMES
                     if bpy.data.objects.get(name) is None or bpy.data.objects[name] not in stems.objects[:])
    if missing:
        raise RuntimeError("Ambiguous legacy Rose 02 structure; missing canonical objects: " + ", ".join(missing))
    legacy = []
    for name, expected_vertices in _LEGACY_VERTEX_COUNTS.items():
        obj = bpy.data.objects[name]
        expected_material = "Prickles | warm olive" if name.startswith("Curved prickle") else "Stem | olive green"
        if (obj.type != "MESH" or obj.data is None or len(obj.data.vertices) != expected_vertices
                or set(obj.users_collection[:]) != {stems}
                or [mat.name for mat in obj.data.materials if mat] != [expected_material]):
            raise RuntimeError(f"Ambiguous legacy Rose 02 structural object: {name}")
        mesh_signature = {
            "v": [tuple(round(float(c), 7) for c in vertex.co) for vertex in obj.data.vertices],
            "e": [tuple(edge.vertices) for edge in obj.data.edges],
            "f": [tuple(poly.vertices) for poly in obj.data.polygons],
            "m": [mat.name for mat in obj.data.materials if mat],
        }
        signature = hashlib.sha256(json.dumps(mesh_signature, separators=(",", ":")).encode()).hexdigest()
        if signature != _LEGACY_GEOMETRY_SHA256[name]:
            raise RuntimeError(f"Ambiguous legacy Rose 02 geometry signature: {name}")
        legacy.append(obj)
    if any(any(obj.name == name or obj.name.startswith(name + ".") for name in _LEGACY_GENERATED_NAMES)
           for obj in stems.objects if obj not in legacy):
        raise RuntimeError("Ambiguous duplicate legacy Rose 02 structural names")
    return legacy


def _point_at_height(z, scale):
    points = [Vector((x, y, h * scale)) for x, y, h in _STEM_PATH]
    for a, b in zip(points, points[1:]):
        if a.z <= z <= b.z or b.z <= z <= a.z:
            t = (z - a.z) / (b.z - a.z)
            return a.lerp(b, t)
    return points[0] if z < points[0].z else points[-1]


def _tangent_at_height(z, scale):
    points = [Vector((x, y, h * scale)) for x, y, h in _STEM_PATH]
    index = min(range(len(points)), key=lambda i: abs(points[i].z - z))
    lo, hi = max(0, index - 1), min(len(points) - 1, index + 1)
    return (points[hi] - points[lo]).normalized()


def _socket_matrix(location, axis, reference):
    # Keep a reference chosen at the canonical 1.0 pose; don't switch axes as
    # the stem tangent crosses a threshold during small parameter changes.
    z_axis = Vector(axis).normalized()
    up = Vector(reference).normalized()
    x_axis = up.cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis).normalized()
    rotation = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
    rotation.translation = Vector(location)
    return rotation


def _socket_specs(scale):
    specs = {}
    for index, point in enumerate(_LEAF_SOCKETS, 1):
        location = (point[0], point[1], point[2] * scale)
        tangent = _tangent_at_height(location[2], scale)
        canonical = _tangent_at_height(point[2], 1.0)
        reference = Vector((0, 0, 1)) if abs(canonical.z) <= 0.96 else Vector((0, 1, 0))
        specs[f"leaf.{index:02}"] = (location, tangent, reference)
    flower = (0.099, 0.044, 0.665 * scale)
    flower_axis = _tangent_at_height(flower[2], scale)
    canonical_flower_axis = _tangent_at_height(0.665, 1.0)
    flower_reference = Vector((0, 0, 1)) if abs(canonical_flower_axis.z) <= 0.96 else Vector((0, 1, 0))
    specs["flower.main"] = (flower, flower_axis, flower_reference)
    bud_location = (0.207, -0.056, 0.603 * scale)
    branch_axis = Vector((0.47, -0.13, 0.87 * scale)).normalized()
    canonical_branch_axis = Vector((0.47, -0.13, 0.87)).normalized()
    bud_reference = Vector((0, 0, 1)) if abs(canonical_branch_axis.z) <= 0.96 else Vector((0, 1, 0))
    specs["bud.main"] = (bud_location, branch_axis, bud_reference)
    return specs


def _collection(name, scene):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        scene.collection.children.link(coll)
    return coll


def _ensure_sockets(scene, specs):
    coll = _collection(SOCKET_COLLECTION, scene)
    sockets = {}
    for role in SOCKET_ROLES:
        name = "Socket | " + role
        obj = bpy.data.objects.get(name)
        if obj is None:
            obj = bpy.data.objects.new(name, None)
            coll.objects.link(obj)
            obj.empty_display_type = "ARROWS"
            obj.empty_display_size = 0.018
        elif obj.name not in coll.objects:
            coll.objects.link(obj)
        obj["rose02.role_id"] = role
        obj["rose02.owner"] = "garden_rose_02.socket"
        obj.matrix_world = _socket_matrix(*specs[role])
        sockets[role] = obj
    return sockets


def _parent_preserving_world(obj, socket):
    world = obj.matrix_world.copy()
    obj.parent = socket
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = socket.matrix_world.inverted() @ world


def _attach_authored(scene, sockets):
    # One-time localization of baked world-coordinate authoring into stable sockets.
    for role, collection_name in AUTHOR_COLLECTIONS.items():
        coll = bpy.data.collections[collection_name]
        if role == "leaf":
            # Assign each whole compound leaf to its own anchor by authored naming.
            for obj in list(coll.objects):
                import re
                match = re.match(r"Leaf\s+(\d+)\b", obj.name)
                index = int(match.group(1)) if match else 1
                socket = sockets[f"leaf.{min(max(index, 1), 3):02}"]
                if obj.parent != socket:
                    _parent_preserving_world(obj, socket)
        else:
            socket = sockets["flower.main" if role == "flower" else "bud.main"]
            for obj in list(coll.objects):
                if obj.parent != socket:
                    _parent_preserving_world(obj, socket)


def _tube_data(points, radii, sides):
    points = [Vector(p) for p in points]
    vertices, faces = [], []
    for i, center in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        reference = Vector((0, 0, 1))
        if abs(tangent.dot(reference)) > 0.9:
            reference = Vector((0, 1, 0))
        right = tangent.cross(reference).normalized()
        up = tangent.cross(right).normalized()
        for k in range(sides):
            angle = 2 * math.pi * k / sides
            vertices.append(tuple(center + radii[i] * (math.cos(angle) * right + math.sin(angle) * up)))
    faces.append(tuple(reversed(range(sides))))
    for i in range(len(points) - 1):
        for k in range(sides):
            j = (k + 1) % sides
            faces.append((i * sides + k, i * sides + j, (i + 1) * sides + j, (i + 1) * sides + k))
    faces.append(tuple((len(points) - 1) * sides + k for k in range(sides)))
    return vertices, faces


def _new_owned_tube(name, role, points, radii, sides, material, collection):
    vertices, faces = _tube_data(points, radii, sides)
    mesh = bpy.data.meshes.new(name + " | mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj["rose02.owner"] = OWNER
    obj["rose02.role_id"] = role
    return obj


def _structural_spec(seed, scale):
    points = [Vector((x, y, z * scale)) for x, y, z in _STEM_PATH]
    rng = random.Random(seed)
    prickles = []
    for index, (height, angle) in enumerate(((0.095, 0.2), (0.18, 2.4), (0.315, 4.4), (0.395, 1.1), (0.505, 3.2)), 1):
        height *= scale
        angle += rng.uniform(-0.025, 0.025)
        base = Vector((0.004 + 0.13 * (height / scale), 0.015 * (height / scale), height))
        radial = Vector((math.cos(angle), math.sin(angle), 0))
        base += radial * 0.0045
        jitter = rng.uniform(-0.001, 0.001)
        prickles.append((f"Curved prickle {index}", f"prickle.{index:02}",
                         [base, base + radial * (0.010 + jitter) + Vector((0, 0, 0.005 * scale)),
                          base + radial * 0.018 + Vector((0, 0, -0.004 * scale))]))
    bud_root = Vector((_BUD_ROOT[0], _BUD_ROOT[1], _BUD_ROOT[2] * scale))
    bud_mid = Vector((_BUD_MID[0], _BUD_MID[1], _BUD_MID[2] * scale))
    bud_tip = Vector((_BUD_TIP[0], _BUD_TIP[1], _BUD_TIP[2] * scale))
    return points, prickles, (bud_root, bud_mid, bud_tip)


def regenerate_scene(parameters=None, seed=SEED, save_path=None):
    """Regenerate owned structure in the open source scene; authored meshes survive.

    ``stem_height_scale`` is the single bounded structural control (0.9–1.1).
    Validation and source checks complete before the scene is changed.
    """
    params = _validate(parameters, seed)
    scene = bpy.context.scene
    legacy_to_migrate = _preflight(scene)
    scale = params["stem_height_scale"]
    points, prickles, bud_points = _structural_spec(seed, scale)
    specs = _socket_specs(scale)
    stem_mat = bpy.data.materials["Stem | olive green"]
    thorn_mat = bpy.data.materials["Prickles | warm olive"]

    generated = _collection(GENERATED_COLLECTION, scene)
    sockets = _ensure_sockets(scene, specs)
    # Remove only tagged generator output and the exact structural names from the
    # original build. Unknown/user objects in the source collections are retained.
    for obj in list(bpy.data.objects):
        generator_owned = obj.get("rose02.owner") == OWNER and generated in obj.users_collection[:]
        if generator_owned or obj in legacy_to_migrate:
            data = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                bpy.data.meshes.remove(data)
    _attach_authored(scene, sockets)

    _new_owned_tube("Main arching cane", "stem.main", points, _STEM_RADII,
                    12, stem_mat, generated)
    for name, role, path in prickles:
        _new_owned_tube(name, role, path, [0.0032, 0.0017, 0.0001], 7, thorn_mat, generated)
    _new_owned_tube("Flower peduncle", "peduncle.main", [points[-2], points[-1]],
                    [0.0042, 0.0032], 10, stem_mat, generated)
    _new_owned_tube("Bud lateral shoot", "shoot.bud", bud_points,
                    [0.0031, 0.0025, 0.0019], 9, stem_mat, generated)

    scene["rose02.schema"] = SCHEMA
    scene["rose02.seed"] = seed
    scene["rose02.parameters_json"] = json.dumps(params, sort_keys=True, separators=(",", ":"))
    scene["rose02.source_script"] = str(Path(__file__).resolve())
    scene["seed"] = seed
    bpy.context.view_layer.update()
    if save_path is not None:
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(save_path).resolve()))
    return {"seed": seed, "parameters": params, "generated_collection": generated.name,
            "socket_roles": list(SOCKET_ROLES)}


def save_source(path=BLEND_PATH):
    """Save the current source scene after regeneration to an explicit .blend path."""
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(path).resolve()))
    return Path(path).resolve()


if __name__ == "__main__":
    result = regenerate_scene(save_path=BLEND_PATH)
    print("ROSE02_REGENERATED " + json.dumps(result, sort_keys=True))
