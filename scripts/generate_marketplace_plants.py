#!/usr/bin/env python3
"""Build one stylized-realistic marketplace plant from the nature catalogue.

Run through the `blender-object-batches` runner, inside Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python <skill>/scripts/run_batch.py -- \
        --manifest <external>/variants.json \
        --generator scripts/generate_marketplace_plants.py \
        --output-dir <external>/batch

Contract for this module
------------------------
Identity        GENERATOR_ID "marketplace-nature-plants", version 1.1.0.
Interface       build_variant(context) -> {outputs, metrics, warnings, metadata}.
Context         context["id"] is the variant name, context["seed"] the only
                stochastic source, context["parameters"]["species"] one of
                one of SPECIES_HEIGHT_M with the matching fixed height.
Units/axes      Source scene and GLB are metres. The source scene is Blender
                Z-up; GLB is exported with Y-up (Blender +Z -> runtime +Y).
Origin          The plant stands on z = 0 with its base centre at the origin;
                min z is at (or within a few millimetres of) zero. The GLB keeps
                that base origin and the metre scale; these are standalone sale
                assets and no runtime loader convention is assumed.
Outputs         <output_dir>/Plant.blend (editable), plant.glb (runtime),
                plant_lod1.glb, plant_lod2.glb (static LODs). All renders and
                QA.json go to explicit paths under <output_dir>.
Roles           editable, runtime, lod1, lod2.
Budgets         Hero <= 20000 triangles, <= 5 materials, <= 2 000 000 bytes and
                <= 5 render meshes.
Wind            One shape-key morph clip ("WindGust") on the single plant mesh,
                looped, ~2 s at 30 fps, Min/Max -1/+1 with a negative gust.
Textures        No image textures. Colour is a small PBR vertex-colour palette
                (COLOR_0) authored into the mesh.
No claims       This module makes no engine-specific compatibility claim.

The Blender-free part of this module (vector helpers, `build_geometry`,
`resolve_species`, `prepare_variant_output_dir`) is importable and testable
without `bpy`; `bpy` is imported lazily inside the build functions only.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import sys
from pathlib import Path

# Importing helper modules must not leave `__pycache__` inside the repository.
sys.dont_write_bytecode = True

GENERATOR_ID = "marketplace-nature-plants"
GENERATOR_VERSION = "1.1.0"

SPECIES_HEIGHT_M = {
    "daisy": 0.65,
    "lavender": 0.70,
    "fern": 0.75,
    "grass": 0.85,
    "poppy": 0.72,
    "sunflower": 1.80,
    "cornflower": 0.70,
    "red_clover": 0.40,
    "cattail": 1.60,
}
BLOOM_SPECIES = ("daisy", "lavender", "poppy", "sunflower", "cornflower",
                 "red_clover", "cattail")
# Vertical size of the bloom feature that a closeup must cover, in metres. The
# lavender value frames one whole connected terminal head (its flowering zone is
# about 0.12 of the axis) instead of centring a wide shot on bare stem.
BLOOM_EXTENT_M = {"daisy": 0.085, "lavender": 0.110,
                  "poppy": 0.155, "sunflower": 0.58, "cornflower": 0.23,
                   "red_clover": 0.17, "cattail": 0.60}

# Triangles at or below this area are collapsed geometry, not blades: the
# smallest real triangle in the catalogue measures about 5e-8 m2 (a petal tip
# or fern leaflet), so 1e-10 m2 stays almost 500x below the finest organ and can
# only catch decimation collapse. The glTF exporter runs `Mesh.validate()`
# before gathering attributes and silently drops such triangles; the generator
# removes them itself so the source snapshot and the exported GLB agree.
DEGENERATE_AREA_M2 = 1e-10

# Lengthwise stations of a ray petal (fraction of the petal length) with a
# narrow root, a broad middle and a softly rounded, faintly notched tip. No
# station has zero width: a zero width collapses a whole cross-section.
PETAL_STATIONS = (0.0, 0.12, 0.25, 0.40, 0.56, 0.71, 0.84, 0.93, 1.0)
PETAL_WIDTHS = (0.30, 0.58, 0.82, 0.98, 1.00, 0.94, 0.80, 0.62, 0.40)
PETAL_CUP = (0.26, 0.26, 0.25, 0.24, 0.22, 0.19, 0.16, 0.13, 0.10)

# Lengthwise stations of an oblong leaf blade; the rounded tip keeps width so
# the blade does not end in the flat rectangle the three-station ribbon made.
LEAF_STATIONS = (0.0, 0.20, 0.40, 0.60, 0.80, 1.0)
LEAF_WIDTHS = (0.34, 0.66, 0.92, 1.00, 0.88, 0.42)
LEAF_CUP = (0.22, 0.24, 0.24, 0.22, 0.18, 0.12)

# A poppy leaf is coarsely lobed, not an even oval: two deep sinuses separate a
# broad terminal lobe from a pair of lateral lobes. The stations are uneven on
# purpose (0.16/0.32/0.48/0.64) so each lobe gets a high and a low width sample
# and the midrib pinch is real geometry rather than a shading trick.
POPPY_LEAF_STATIONS = (0.0, .14, .28, .42, .56, .70, .86, 1.0)
POPPY_LEAF_WIDTHS = (.22, .78, .40, 1.0, .38, .76, .52, .06)
POPPY_LEAF_CUPS = (.20, .26, .24, .24, .22, .20, .15, .07)

# The poppy capsule is ringed by a dense crown of dark stamens. Each is one
# short filament leaning out over the petals plus a tiny anther head; the ring
# radius sits just inside the petal root so the filaments rest on the corolla.
POPPY_STAMEN_COUNT = 34
POPPY_STAMEN_RING_FRACTION = .020
POPPY_STAMEN_FILAMENT_FRACTION = .013
POPPY_STAMEN_LEAN = .64

# Poppy petals are a shallow bowl, not the deeply cupped spoon of a daisy: the
# valley sits far below the rim so the dark stamen ring stays visible.
POPPY_PETAL_CUP = .20

# A fern pinnule is a small pointed leaflet, not a rounded spoon. The narrow
# root, a broad middle and a sharply drawn tip keep the half-width between 0.08
# and 0.12 of the leaflet length.
PINNULE_STATIONS = (0.0, 0.36, 0.72, 1.0)
PINNULE_WIDTHS = (0.08, 0.90, 0.70, 0.04)
PINNULE_CUPS = (0.18, 0.26, 0.22, 0.08)

# A lavender leaf is lanceolate: an explicit pointed profile instead of the
# shared broad LEAF_WIDTHS, with a half-width of 0.055-0.075 of its length.
LANCE_STATIONS = (0.0, 0.28, 0.55, 0.78, 1.0)
LANCE_WIDTHS = (0.30, 0.85, 1.00, 0.70, 0.10)
LANCE_CUPS = (0.24, 0.28, 0.26, 0.20, 0.08)

# Grass blades follow a curved centreline with a modest cup and a fine tip.
GRASS_STATIONS = 6
GRASS_WIDTHS = (0.55, 0.92, 1.00, 0.86, 0.58, 0.12)
GRASS_CUPS = (0.16, 0.26, 0.30, 0.28, 0.20, 0.06)

# Exactly five material definitions. A species only references the subset it
# needs; the exporter drops unused slots, so every hero stays <= 5 materials.
MATERIAL_NAMES = ("StemGreen", "LeafGreen", "PetalWhite", "BloomYellow", "BloomViolet",
                  "PetalRed", "PetalBlue", "CloverPink", "SeedBrown", "DarkCenter",
                  "BloomIndigo")
MATERIAL_COLORS = {
    "StemGreen": ((0.030, 0.062, 0.020, 1.0), (0.150, 0.285, 0.085, 1.0)),
    "LeafGreen": ((0.022, 0.070, 0.018, 1.0), (0.235, 0.430, 0.105, 1.0)),
    "PetalWhite": ((0.560, 0.545, 0.480, 1.0), (0.970, 0.960, 0.885, 1.0)),
    "BloomYellow": ((0.520, 0.330, 0.020, 1.0), (0.930, 0.760, 0.115, 1.0)),
    "BloomViolet": ((0.150, 0.075, 0.280, 1.0), (0.540, 0.350, 0.790, 1.0)),
    "PetalRed": ((0.310, 0.012, 0.012, 1.0), (0.840, 0.075, 0.050, 1.0)),
    "PetalBlue": ((0.025, 0.055, 0.280, 1.0), (0.135, 0.295, 0.820, 1.0)),
    "CloverPink": ((0.315, 0.075, 0.170, 1.0), (0.820, 0.375, 0.540, 1.0)),
    "SeedBrown": ((0.100, 0.045, 0.016, 1.0), (0.340, 0.165, 0.070, 1.0)),
    "DarkCenter": ((0.025, 0.016, 0.018, 1.0), (0.125, 0.070, 0.080, 1.0)),
    "BloomIndigo": ((0.035, 0.025, 0.160, 1.0), (0.105, 0.085, 0.390, 1.0)),
}
MATERIAL_ROUGHNESS = {
    "StemGreen": 0.86,
    "LeafGreen": 0.74,
    "PetalWhite": 0.66,
    "BloomYellow": 0.72,
    "BloomViolet": 0.68,
    "PetalRed": 0.72,
    "PetalBlue": 0.72,
    "CloverPink": 0.78,
    "SeedBrown": 0.91,
    "DarkCenter": 0.89,
    "BloomIndigo": 0.78,
}
WOOD_DARK = (0.055, 0.035, 0.018, 1.0)
WOOD_LIGHT = (0.185, 0.130, 0.070, 1.0)

RUNTIME_COLOR_ATTRIBUTE = "PlantColor"
WIND_GROUP = "WindFlex"

BUDGETS = {
    "triangles_max": 20000,
    "materials_max": 5,
    "file_size_bytes_max": 2000000,
    "render_meshes_max": 5,
}

# Relative names that prove a delivery already exists in an output directory.
OUTPUT_MARKERS = ("Plant.blend", "plant.glb", "plant_lod1.glb", "plant_lod2.glb",
                  "QA.json", "Media")

RENDER_SIZE = (1920, 1080)
FPS = 30
# Two seconds, rest at frame 1 and a real negative gust at frame 46.
WIND_KEYS = ((1, 0.0), (16, 0.85), (31, 0.0), (46, -0.55), (61, 0.0))
WIND_DURATION_SECONDS = (WIND_KEYS[-1][0] - WIND_KEYS[0][0]) / FPS


# ---------------------------------------------------------------------------
# Pure helpers (no bpy)
# ---------------------------------------------------------------------------

def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(v, s):
    return (v[0] * s, v[1] * s, v[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _length(v):
    return math.sqrt(_dot(v, v))


def _normalize(v, fallback=(0.0, 0.0, 1.0)):
    size = _length(v)
    if size < 1e-9:
        return fallback
    return (v[0] / size, v[1] / size, v[2] / size)


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t)


def _clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def _flex(z, height_m, local):
    """0 at a rooted base, rising towards flexible tips and free ends."""
    height_fraction = _clamp(z / height_m) if height_m > 0 else 0.0
    combined = 0.55 * (height_fraction ** 1.25) + 0.45 * _clamp(local)
    return _clamp(combined) ** 1.15


def _frame_reference(points):
    """A stable reference axis for tube/ribbon cross-sections."""
    net = _normalize(_sub(points[-1], points[0]))
    if abs(net[2]) > 0.9:
        return (1.0, 0.0, 0.0)
    return (0.0, 0.0, 1.0)


def _section_tangent(points, index):
    count = len(points)
    if count == 1:
        return (0.0, 0.0, 1.0)
    if index == 0:
        return _normalize(_sub(points[1], points[0]))
    if index == count - 1:
        return _normalize(_sub(points[count - 1], points[count - 2]))
    return _normalize(_sub(points[index + 1], points[index - 1]))


def _sample_polyline(points, fraction):
    """Return (position, tangent) at an arc-length fraction of a polyline."""
    segments = [_length(_sub(points[i + 1], points[i])) for i in range(len(points) - 1)]
    total = sum(segments) or 1.0
    target = _clamp(fraction) * total
    traversed = 0.0
    for index, segment in enumerate(segments):
        if traversed + segment >= target or index == len(segments) - 1:
            local = 0.0 if segment <= 0 else (target - traversed) / segment
            position = _lerp(points[index], points[index + 1], local)
            return position, _normalize(_sub(points[index + 1], points[index]))
        traversed += segment
    return points[-1], _normalize(_sub(points[-1], points[-2]))


def _plane_axes(normal):
    """A right-handed frame (u, v, n) whose plane is perpendicular to n.

    Vertical normals keep the former world X/Y basis so the root crowns of
    lavender, fern and grass are unchanged; tilted normals (the daisy head)
    build their own stable plane.
    """
    axis_n = _normalize(normal)
    if abs(axis_n[2]) >= 0.999:
        return (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), axis_n
    axis_u = _normalize(_cross((0.0, 0.0, 1.0), axis_n))
    axis_v = _normalize(_cross(axis_n, axis_u))
    return axis_u, axis_v, axis_n


def _fan_triangles(face):
    """Triangles of a convex face fan, matching Blender's loop triangles."""
    return [(face[0], face[index], face[index + 1]) for index in range(1, len(face) - 1)]


def _triangle_area(vertices, triangle):
    a, b, c = (vertices[index] for index in triangle)
    return 0.5 * _length(_cross(_sub(b, a), _sub(c, a)))


def _face_is_degenerate(vertices, face, area_tolerance=DEGENERATE_AREA_M2):
    """True for a face with repeated vertices or a collapsed triangle."""
    if len(face) < 3 or len(set(face)) < 3:
        return True
    return any(_triangle_area(vertices, triangle) <= area_tolerance
               for triangle in _fan_triangles(face))


def clean_geometry(vertices, faces, face_materials, flex, tint,
                   area_tolerance=DEGENERATE_AREA_M2):
    """Drop degenerate faces and re-index a plant mesh.

    Used identically for the procedural hero geometry and, through
    `_face_is_degenerate`, for the decimated LOD meshes, so the source snapshot
    and the exported GLB count exactly the same triangles. Returns arrays that
    keep only vertices some surviving face still references.
    """
    kept_faces = []
    kept_materials = []
    for face, material in zip(faces, face_materials):
        if _face_is_degenerate(vertices, face, area_tolerance):
            continue
        kept_faces.append(tuple(face))
        kept_materials.append(material)
    remap = {}
    order = []
    for face in kept_faces:
        for index in face:
            if index not in remap:
                remap[index] = len(order)
                order.append(index)
    if len(kept_faces) == len(faces) and len(order) == len(vertices):
        # Nothing collapsed and no loose vertex: keep the authored order so an
        # untouched species keeps its exact fingerprint.
        return {
            "vertices": [tuple(vertex) for vertex in vertices],
            "faces": [tuple(face) for face in faces],
            "face_materials": list(face_materials),
            "flex": [float(value) for value in flex],
            "tint": [float(value) for value in tint],
        }
    return {
        "vertices": [tuple(vertices[index]) for index in order],
        "faces": [tuple(remap[index] for index in face) for face in kept_faces],
        "face_materials": kept_materials,
        "flex": [float(flex[index]) for index in order],
        "tint": [float(tint[index]) for index in order],
    }


def _blade_sections(origin, direction, length, half_width, face_normal, *,
                    stations=LEAF_STATIONS, widths=LEAF_WIDTHS, cups=LEAF_CUP,
                    curl=0.12, pitch=0.0):
    """Three-row cross-sections for one oblong, softly cupped leaf blade.

    The blade plane is spanned by the growth direction and a width axis taken
    from `face_normal`, so a nearly horizontal leaf still shows its face instead
    of collapsing into the edge-on flat strip a world-up ribbon produced.
    Returns (sections, axis_z) with one (left, valley, right) triple per station.
    """
    direction = _normalize(direction)
    normal = _normalize(_sub(face_normal, _scale(direction, _dot(face_normal, direction))))
    side = _normalize(_cross(normal, direction))
    sections = []
    axis_z = []
    for step, t in enumerate(stations):
        reach = length * t
        droop = curl * length * (t ** 2)
        axis = _add(origin, _add(_add(_scale(direction, reach), (0.0, 0.0, -droop)),
                                 _scale(normal, pitch * length * t)))
        width = half_width * widths[step]
        sections.append((_add(axis, _scale(side, width)),
                         _sub(axis, _scale(normal, width * cups[step])),
                         _sub(axis, _scale(side, width))))
        axis_z.append(axis[2])
    return sections, axis_z


def _polyline_sections(points, half_widths, face_normal, cups):
    """Three-row cupped sections along an already curved centreline.

    `_blade_sections` grows a straight axis; a grass blade bends outward and
    arches over, so each station takes its own tangent here. That keeps the
    width axis stable along the curve instead of shearing it, and the caller
    still owns the lengthwise width profile and the local face normal.
    """
    if len(points) != len(half_widths) or len(points) != len(cups):
        raise ValueError("a curved blade needs one width and cup per station")
    sections = []
    axis_z = []
    for index, point in enumerate(points):
        tangent = _section_tangent(points, index)
        normal = _normalize(_sub(face_normal, _scale(tangent, _dot(face_normal, tangent))))
        side = _normalize(_cross(normal, tangent))
        half = half_widths[index]
        sections.append((_add(point, _scale(side, half)),
                         _sub(point, _scale(normal, half * cups[index])),
                         _sub(point, _scale(side, half))))
        axis_z.append(point[2])
    return sections, axis_z


def bloom_view_direction(normal):
    """Direction from the bloom focus onto the flower face.

    The camera sits along the head normal, tilted 0.42 (~23 deg) towards one
    in-plane axis so the face is seen from an elevated angle rather than edge-on.
    """
    axis_u, _axis_v, axis_n = _plane_axes(normal)
    return _normalize(_add(axis_n, _scale(axis_u, 0.42)))


def bloom_camera_location(focus, normal, extent):
    """Place the bloom closeup so the whole head fits with a small margin."""
    return _add(focus, _scale(bloom_view_direction(normal), extent * 3.6))


def color_signal(coordinate):
    """Cheap deterministic variation used to bake the vertex-colour palette."""
    x, y, z = coordinate
    value = (0.5
             + 0.26 * math.sin(x * 23.7 + z * 8.3 + 0.7)
             + 0.17 * math.sin(y * 31.1 - z * 13.9 + 2.1)
             + 0.10 * math.sin((x + y) * 57.3 + 4.3))
    return _clamp(value)


def mix_color(dark, light, amount):
    amount = _clamp(amount)
    return tuple(dark[i] * (1.0 - amount) + light[i] * amount for i in range(4))


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def glb_document(path):
    """Read the JSON chunk of a GLB without Blender or extra dependencies."""
    data = Path(path).read_bytes()
    if len(data) < 20 or struct.unpack_from("<III", data)[0] != 0x46546C67:
        raise RuntimeError(f"{Path(path).name} is not a valid GLB container")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A or 20 + length > len(data):
        raise RuntimeError(f"{Path(path).name} has no readable JSON chunk")
    return json.loads(data[20:20 + length].decode("utf-8").rstrip(" \t\r\n\x00"))


def audit_glb(path):
    """Structural facts of one exported GLB, checked without a Blender import."""
    document = glb_document(path)
    triangles = 0
    primitives = 0
    morph_targets = 0
    has_color0 = True
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            primitives += 1
            mode = int(primitive.get("mode", 4))
            if "indices" in primitive:
                accessor = document["accessors"][primitive["indices"]]
            else:
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
            count = int(accessor.get("count", 0))
            triangles += count // 3 if mode == 4 else max(0, count - 2)
            morph_targets += len(primitive.get("targets", []))
            if "COLOR_0" not in primitive.get("attributes", {}):
                has_color0 = False
    return {
        "bytes": Path(path).stat().st_size,
        "triangles": triangles,
        "materials": len(document.get("materials", [])),
        "meshes": len(document.get("meshes", [])),
        "primitives": primitives,
        "animations": len(document.get("animations", [])),
        "morph_targets": morph_targets,
        "has_images": bool(document.get("images") or document.get("textures")),
        "has_color0": has_color0,
        "extensions_required": sorted(document.get("extensionsRequired", [])),
    }


def _inside_git_worktree(path):
    """A checkout or linked worktree always carries a `.git` file or folder."""
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return True
    return False


def prepare_variant_output_dir(output_dir, markers=OUTPUT_MARKERS):
    """Create a fresh external output directory or refuse to clobber one.

    Rejects any path inside a Git checkout/worktree, and any directory that
    already carries one of the delivery markers. Returns the resolved path.
    """
    if output_dir is None:
        raise ValueError("context output_dir is required")
    target = Path(output_dir)
    if not target.is_absolute():
        raise ValueError("output_dir must be an absolute path")
    target = target.resolve()
    if _inside_git_worktree(target):
        raise ValueError(
            "Refusing to write generated plant assets inside a Git worktree: " + str(target))
    existing = [name for name in markers if (target / name).exists()]
    if existing:
        raise FileExistsError(
            "Refusing to overwrite an existing plant delivery in "
            f"{target}: {', '.join(sorted(existing))}")
    target.mkdir(parents=True, exist_ok=True)
    return target


def resolve_species(parameters):
    """Validate parameters['species'] and its exact parameters['height_m']."""
    if not isinstance(parameters, dict):
        raise ValueError("context parameters must be an object")
    species = parameters.get("species")
    if not isinstance(species, str) or species not in SPECIES_HEIGHT_M:
        raise ValueError(
            "parameters.species must be one of "
            f"{'/'.join(sorted(SPECIES_HEIGHT_M))}; got {species!r}")
    height = parameters.get("height_m")
    if isinstance(height, bool) or not isinstance(height, (int, float)):
        raise ValueError("parameters.height_m must be a number")
    height = float(height)
    if not math.isfinite(height) or height <= 0.0:
        raise ValueError(f"parameters.height_m must be positive and finite; got {height!r}")
    expected = SPECIES_HEIGHT_M[species]
    if abs(height - expected) > 1e-9:
        raise ValueError(f"{species} requires height_m={expected:.2f}; got {height}")
    return species, expected


def parameter_warnings(parameters):
    known = {"species", "height_m"}
    extra = sorted(set(parameters) - known)
    return [f"unexpected plant parameter(s) ignored: {', '.join(extra)}"] if extra else []


def context_seed(context):
    seed = context.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("context seed must be an integer")
    return seed


def context_id(context):
    name = context.get("id")
    if not isinstance(name, str) or not name:
        raise ValueError("context id must be a non-empty string")
    return name


# Model basenames the audit loops walk over. Keeping them as one tuple makes it
# obvious that they are file names and must never be used as the variant id.
MODEL_NAMES = ("plant.glb", "plant_lod1.glb", "plant_lod2.glb")


def variant_identity(context):
    """The context identity for the scene metadata, QA.json and the result.

    The variant id is the manifest id (nature-plant-v01..v04), never a delivered
    file name. A separate helper keeps the audit loops over `MODEL_NAMES` from
    reusing the variable, and rejects a file basename before the build starts.
    """
    identity = context_id(context)
    if identity in MODEL_NAMES or identity.endswith(".glb"):
        raise ValueError(f"context id must not be a model file name: {identity!r}")
    return identity


# ---------------------------------------------------------------------------
# Pure geometry builder
# ---------------------------------------------------------------------------

class PlantGeometry:
    """Accumulates one combined plant mesh with per-vertex wind flex and tint."""

    def __init__(self, material_names=MATERIAL_NAMES):
        self.material_names = tuple(material_names)
        self.vertices = []
        self.faces = []
        self.face_materials = []
        self.flex = []
        self.tint = []

    def _emit(self, verts, local_faces, material, flex, tint):
        base = len(self.vertices)
        for vertex in verts:
            self.vertices.append((float(vertex[0]), float(vertex[1]), float(vertex[2])))
        count = len(verts)
        if isinstance(flex, (int, float)):
            flex = [float(flex)] * count
        if isinstance(tint, (int, float)):
            tint = [float(tint)] * count
        self.flex.extend(float(value) for value in flex)
        self.tint.extend(float(value) for value in tint)
        index = self.material_names.index(material)
        for face in local_faces:
            self.faces.append(tuple(base + i for i in face))
            self.face_materials.append(index)

    def tube(self, points, radii, material, sides=4, flex=None, tint=0.5,
             cap_start=False, cap_end=False):
        points = [tuple(float(c) for c in point) for point in points]
        count = len(points)
        if count < 2:
            raise ValueError("tube needs at least two points")
        if flex is None:
            flex = [i / (count - 1) for i in range(count)]
        if isinstance(tint, (int, float)):
            tint = [float(tint)] * count
        reference = _frame_reference(points)
        verts = []
        for index, point in enumerate(points):
            tangent = _section_tangent(points, index)
            normal = _cross(tangent, reference)
            if _length(normal) < 1e-6:
                normal = _cross(tangent, (1.0, 0.0, 0.0))
            if _length(normal) < 1e-6:
                normal = (1.0, 0.0, 0.0)
            normal = _normalize(normal)
            bitangent = _normalize(_cross(tangent, normal))
            for side in range(sides):
                angle = 2.0 * math.pi * side / sides
                offset = _add(_scale(normal, math.cos(angle) * radii[index]),
                              _scale(bitangent, math.sin(angle) * radii[index]))
                verts.append(_add(point, offset))
        faces = []
        for index in range(count - 1):
            for side in range(sides):
                a = index * sides + side
                b = index * sides + (side + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        if cap_start:
            faces.append(tuple(reversed(range(sides))))
        if cap_end:
            faces.append(tuple(range((count - 1) * sides, count * sides)))
        self._emit(verts, faces, material,
                   [flex[i] for i in range(count) for _ in range(sides)],
                   [tint[i] for i in range(count) for _ in range(sides)])

    def ribbon(self, points, widths, material, flex=None, tint=0.5, reference=None):
        """A flat tapering blade; the width direction stays stable along it."""
        points = [tuple(float(c) for c in point) for point in points]
        count = len(points)
        if count < 2:
            raise ValueError("ribbon needs at least two points")
        if flex is None:
            flex = [i / (count - 1) for i in range(count)]
        if isinstance(tint, (int, float)):
            tint = [float(tint)] * count
        ref = reference or _frame_reference(points)
        verts = []
        previous = None
        for index, point in enumerate(points):
            tangent = _section_tangent(points, index)
            side = _cross(tangent, ref)
            if _length(side) < 1e-6:
                side = previous if previous else _cross(tangent, (1.0, 0.0, 0.0))
            side = _normalize(side)
            previous = side
            verts.append(_sub(point, _scale(side, widths[index])))
            verts.append(_add(point, _scale(side, widths[index])))
        faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(count - 1)]
        self._emit(verts, faces, material,
                   [flex[i] for i in range(count) for _ in (0, 1)],
                   [tint[i] for i in range(count) for _ in (0, 1)])

    def cupped_blade(self, sections, material, flex=None, tint=0.5):
        """Emit an explicit three-row blade from (left, valley, right) sections.

        Ray petals and oblong leaves use this. The caller builds the stable
        frame, the lengthwise width profile and any tip notch, so a cross-section
        can never twist or collapse into the flat angular shards a three-station
        ribbon produced.
        """
        count = len(sections)
        if count < 2:
            raise ValueError("cupped_blade needs at least two sections")
        if flex is None:
            flex = [i / (count - 1) for i in range(count)]
        if isinstance(flex, (int, float)):
            flex = [float(flex)] * count
        if isinstance(tint, (int, float)):
            tint = [float(tint)] * count
        verts = []
        for section in sections:
            if len(section) != 3:
                raise ValueError("cupped_blade sections need exactly three vertices")
            verts.extend(tuple(float(component) for component in vertex)
                         for vertex in section)
        faces = []
        for index in range(count - 1):
            a = 3 * index
            faces.append((a, a + 1, a + 4, a + 3))
            faces.append((a + 1, a + 2, a + 5, a + 4))
        self._emit(verts, faces, material,
                   [flex[i] for i in range(count) for _ in range(3)],
                   [tint[i] for i in range(count) for _ in range(3)])

    def octa(self, center, size, material, flex=0.5, tint=0.5):
        """A cheap eight-triangle bud."""
        cx, cy, cz = center
        sx, sy, sz = size
        verts = [(cx + sx, cy, cz), (cx - sx, cy, cz),
                 (cx, cy + sy, cz), (cx, cy - sy, cz),
                 (cx, cy, cz + sz), (cx, cy, cz - sz)]
        faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
                 (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
        self._emit(verts, faces, material, flex, tint)

    def dome(self, center, radius, height, material, segments=10, rings=3,
             bump=0.0, rng=None, flex=0.5, tint=0.5, normal=(0.0, 0.0, 1.0)):
        """A closed low-poly dome: daisy centre, receptacle or root crown.

        The rings lie in the plane perpendicular to `normal` and the dome grows
        along it, so the daisy's yellow centre follows its tilted head plane
        instead of the world XY plane. A world-up normal keeps the former
        geometry of the root crowns.
        """
        cx, cy, cz = center
        axis_u, axis_v, axis_n = _plane_axes(normal)
        verts = []
        ring_indices = []
        bottom = []
        for side in range(segments):
            angle = 2.0 * math.pi * side / segments
            local = radius * (1.0 + bump * rng.uniform(-1.0, 1.0) if bump and rng else 1.0)
            bottom.append(len(verts))
            verts.append(_add((cx, cy, cz),
                              _add(_scale(axis_u, math.cos(angle) * local),
                                   _scale(axis_v, math.sin(angle) * local))))
        ring_indices.append(bottom)
        for ring in range(1, max(2, rings)):
            phi = (ring / max(2, rings)) * (math.pi / 2.0)
            ring_radius = radius * math.cos(phi)
            ring_height = height * math.sin(phi)
            ring_vertices = []
            for side in range(segments):
                angle = 2.0 * math.pi * side / segments
                local = ring_radius * (1.0 + bump * rng.uniform(-1.0, 1.0)
                                       if bump and rng else 1.0)
                ring_vertices.append(len(verts))
                verts.append(_add(_add((cx, cy, cz), _scale(axis_n, ring_height)),
                                  _add(_scale(axis_u, math.cos(angle) * local),
                                       _scale(axis_v, math.sin(angle) * local))))
            ring_indices.append(ring_vertices)
        apex = len(verts)
        verts.append(_add((cx, cy, cz), _scale(axis_n, height)))
        faces = []
        for ring in range(len(ring_indices) - 1):
            lower = ring_indices[ring]
            upper = ring_indices[ring + 1]
            for side in range(segments):
                faces.append((lower[side], lower[(side + 1) % segments],
                              upper[(side + 1) % segments], upper[side]))
        top = ring_indices[-1]
        for side in range(segments):
            faces.append((top[side], top[(side + 1) % segments], apex))
        centre = len(verts)
        verts.append((cx, cy, cz))
        for side in range(segments):
            faces.append((centre, bottom[(side + 1) % segments], bottom[side]))
        self._emit(verts, faces, material, flex, tint)


def _plan_from_geometry(species, height_m, seed, geometry, focus, extra_stats):
    vertices = geometry.vertices
    if not vertices:
        raise RuntimeError(f"{species} builder produced no geometry")
    lows = [min(v[i] for v in vertices) for i in range(3)]
    highs = [max(v[i] for v in vertices) for i in range(3)]
    # Ground the completed plant exactly on z = 0. Tube cross-sections make the
    # lowest ring dip below its centre line, so the whole mesh is shifted once
    # by a deterministic amount; no organ is reshaped.
    shift = -lows[2]
    if shift != 0.0:
        vertices = [(v[0], v[1], v[2] + shift) for v in vertices]
        lows = [lows[0], lows[1], 0.0]
        highs = [highs[0], highs[1], highs[2] + shift]
        if focus is not None:
            focus = (focus[0], focus[1], focus[2] + shift)
    if (focus is not None) != (species in BLOOM_SPECIES):
        raise RuntimeError(
            f"{species} bloom focus does not match the flowering plant list {BLOOM_SPECIES}")
    bloom_normal = extra_stats.get("bloom_normal")
    if bloom_normal is not None:
        if focus is None:
            raise RuntimeError(f"{species} carries a bloom normal without a bloom focus")
        bloom_normal = _normalize(bloom_normal)
    triangles = sum(len(face) - 2 for face in geometry.faces)
    used = sorted({MATERIAL_NAMES[index] for index in geometry.face_materials})
    fingerprint = hashlib.sha256()
    for vertex in vertices:
        fingerprint.update(struct.pack("<3f", *vertex))
    for face in geometry.faces:
        fingerprint.update(struct.pack(f"<{len(face)}H", *face))
    stats = {
        "vertices": len(vertices),
        "faces": len(geometry.faces),
        "triangles": triangles,
        "materials": used,
        "focus": list(focus) if focus else None,
    }
    stats.update(extra_stats)
    return {
        "species": species,
        "height_m": height_m,
        "seed": seed,
        "vertices": vertices,
        "faces": geometry.faces,
        "face_materials": geometry.face_materials,
        "flex": geometry.flex,
        "tint": geometry.tint,
        "materials": used,
        "triangles": triangles,
        "bounds_min": lows,
        "bounds_max": highs,
        "bloom_focus": list(focus) if focus else None,
        "bloom_normal": list(bloom_normal) if bloom_normal else None,
        "fingerprint": fingerprint.hexdigest()[:20],
        "stats": stats,
    }


# ---------------------------------------------------------------------------
# Species builders (pure: tuples, math and random only)
# ---------------------------------------------------------------------------

def _leaf_sections(origin, outward_angle, elevation, length, half_width, rng, curl,
                   stations=LEAF_STATIONS, widths=LEAF_WIDTHS, cups=LEAF_CUP):
    """Oblong leaf blade held in a vertical-ish plane so it is never edge-on.

    The lengthwise profile is injectable so a narrow lanceolate lavender leaf
    can use its own pointed stations while the daisy keeps the shared oblong
    profile unchanged.
    """
    direction = _normalize((math.cos(outward_angle) * math.cos(elevation),
                            math.sin(outward_angle) * math.cos(elevation),
                            math.sin(elevation)))
    horizontal_normal = _normalize(_cross(direction, (0.0, 0.0, 1.0)),
                                   fallback=(1.0, 0.0, 0.0))
    face_normal = _add(horizontal_normal, _scale((0.0, 0.0, 1.0), rng.uniform(-0.28, 0.28)))
    return _blade_sections(origin, direction, length, half_width, face_normal,
                           stations=stations, widths=widths, cups=cups, curl=curl)


def _build_daisy(height_m, rng):
    geometry = PlantGeometry()
    geometry.dome((0.0, 0.0, 0.0), height_m * 0.032, height_m * 0.020, "StemGreen",
                  segments=9, rings=2, tint=0.12, flex=0.0)

    # Basal rosette: broad spoon-shaped leaves that rise out of the crown. The
    # blade plane is tilted upright so the front view shows a leaf face instead
    # of the edge of a flat stripe.
    for index in range(8):
        angle = 2.0 * math.pi * index / 8 + rng.uniform(-0.25, 0.25)
        length = height_m * rng.uniform(0.20, 0.32)
        origin = (math.cos(angle) * height_m * 0.022,
                  math.sin(angle) * height_m * 0.022, height_m * 0.008)
        sections, axis_z = _leaf_sections(origin, angle, rng.uniform(0.26, 0.50),
                                          length, length * rng.uniform(0.15, 0.20),
                                          rng, rng.uniform(0.10, 0.22))
        flex = [_flex(z, height_m, step / (len(sections) - 1))
                for step, z in enumerate(axis_z)]
        geometry.cupped_blade(sections, "LeafGreen", flex=flex, tint=0.55)

    stem_count = 4
    focus = None
    focus_z = -1.0
    focus_normal = None
    for stem in range(stem_count):
        angle = 2.0 * math.pi * stem / stem_count + rng.uniform(-0.32, 0.32)
        head_height = height_m * rng.uniform(0.86, 1.0)
        lean = rng.uniform(0.06, 0.17)
        base = (math.cos(angle) * height_m * 0.02, math.sin(angle) * height_m * 0.02, 0.0)
        head = (base[0] + math.cos(angle) * height_m * lean,
                base[1] + math.sin(angle) * height_m * lean,
                head_height)
        control = _lerp(base, head, 0.5)
        control = _add(control, (math.cos(angle) * height_m * 0.02, math.sin(angle) * height_m * 0.02, 0.0))
        points = []
        for step in range(7):
            t = step / 6.0
            point = _lerp(_lerp(base, control, t), _lerp(control, head, t), t)
            points.append(point)
        radii = [height_m * (0.0046 - 0.0024 * (step / 6.0)) for step in range(7)]
        flex = [_flex(point[2], height_m, step / 6.0) for step, point in enumerate(points)]
        geometry.tube(points, radii, "StemGreen", sides=4, flex=flex, tint=0.45)

        # Alternate oblong upper leaves: one per node, attached at the stem.
        for node in range(3):
            t = 0.20 + 0.24 * node
            node_point, _tangent = _sample_polyline(points, t)
            leaf_angle = angle + (1.0 if node % 2 == 0 else -1.0) * rng.uniform(0.75, 1.35)
            length = height_m * rng.uniform(0.075, 0.115)
            sections, axis_z = _leaf_sections(node_point, leaf_angle,
                                              rng.uniform(0.12, 0.46), length,
                                              length * rng.uniform(0.14, 0.20),
                                              rng, rng.uniform(0.06, 0.16))
            flex = [_flex(z, height_m, step / (len(sections) - 1))
                    for step, z in enumerate(axis_z)]
            geometry.cupped_blade(sections, "LeafGreen", flex=flex, tint=0.62)

        # A noticeable outward tilt keeps the flower face readable from the
        # specimen front and three-quarter cameras while the heads keep volume.
        head_normal = _normalize((math.cos(angle) * 0.72 + rng.uniform(-0.10, 0.10),
                                  math.sin(angle) * 0.72 + rng.uniform(-0.10, 0.10),
                                  1.0 + rng.uniform(-0.12, 0.12)))
        centre = _add(head, _scale(head_normal, height_m * 0.006))
        _add_daisy_head(geometry, height_m, rng, centre, head_normal)
        if centre[2] > focus_z:
            focus_z = centre[2]
            focus = centre
            focus_normal = head_normal

    extra = {"stems": stem_count, "basal_leaves": 8, "flower_heads": stem_count,
             "bloom_normal": list(focus_normal) if focus_normal else None}
    return geometry, focus, extra


def _add_daisy_head(geometry, height_m, rng, centre, normal):
    normal = _normalize(normal)
    axis_u, axis_v, _axis_n = _plane_axes(normal)
    head_flex = _flex(centre[2], height_m, 1.0)
    centre_radius = height_m * 0.019
    centre_height = height_m * 0.011

    # Green receptacle connecting the stem to the head, along the head normal.
    geometry.tube([_sub(centre, _scale(normal, height_m * 0.014)), centre],
                  [height_m * 0.0035, height_m * 0.0085], "StemGreen", sides=6,
                  flex=[head_flex * 0.9, head_flex], tint=0.5)

    # Yellow domed centre, its rings lying in the tilted head plane.
    geometry.dome(centre, centre_radius, centre_height, "BloomYellow",
                  segments=12, rings=3, bump=0.18, rng=rng, flex=head_flex,
                  tint=0.6, normal=normal)
    for _ in range(16):
        angle = rng.uniform(0.0, 2.0 * math.pi)
        radius = centre_radius * math.sqrt(rng.random())
        height_fraction = math.sqrt(max(0.0, 1.0 - (radius / centre_radius) ** 2))
        position = _add(centre, _add(_scale(axis_u, math.cos(angle) * radius),
                                     _add(_scale(axis_v, math.sin(angle) * radius),
                                          _scale(normal, centre_height * height_fraction))))
        geometry.octa(position, (height_m * 0.0021, height_m * 0.0021, height_m * 0.0017),
                      "BloomYellow", flex=head_flex, tint=0.78)

    # White oblong ray petals, spread around the centre in the head plane. Every
    # petal keeps its own fixed (radial, side, normal) frame, so the cross
    # section cups along the head normal and never twists into a flat shard.
    petal_count = 15 + rng.randrange(4)
    phase = rng.uniform(0.0, 2.0 * math.pi)
    base_radius = centre_radius * 0.82
    last = len(PETAL_STATIONS) - 1
    for index in range(petal_count):
        petal_angle = phase + 2.0 * math.pi * index / petal_count + rng.uniform(-0.09, 0.09)
        pitch = rng.uniform(-1.0, 1.0)
        length = height_m * rng.uniform(0.030, 0.049)
        half_width = height_m * rng.uniform(0.0038, 0.0052)
        radial = _normalize(_add(_scale(axis_u, math.cos(petal_angle)),
                                 _scale(axis_v, math.sin(petal_angle))))
        side = _normalize(_cross(normal, radial))
        reaches = [base_radius + (length - base_radius) * t for t in PETAL_STATIONS]
        # The valley of the last station stays behind the lobes but still moves
        # forward, so the shallow notch cannot fold the tip back on itself.
        notch = reaches[last - 1] + (length - reaches[last - 1]) * 0.12
        sections = []
        axis_z = []
        for step, t in enumerate(PETAL_STATIONS):
            lift = (height_m * 0.0028 * math.sin(math.pi * t)
                    + height_m * 0.0072 * pitch * (t ** 1.35))
            rim = _add(centre, _add(_scale(radial, reaches[step]), _scale(normal, lift)))
            valley_reach = notch if step == last else reaches[step]
            valley = _add(centre, _add(_scale(radial, valley_reach), _scale(normal, lift)))
            width = half_width * PETAL_WIDTHS[step]
            sections.append((_add(rim, _scale(side, width)),
                             _sub(valley, _scale(normal, width * PETAL_CUP[step])),
                             _sub(rim, _scale(side, width))))
            axis_z.append(rim[2])
        flex = [_flex(z, height_m, 1.0) for z in axis_z]
        geometry.cupped_blade(sections, "PetalWhite", flex=flex, tint=0.85)


def _lavender_floret(geometry, base, direction, height_m, material, rng):
    """One small tubular floret on a green calyx stalk with a lobed lip.

    The previous spike was a row of detached octahedra: from the review camera
    they read as floating purple diamonds beside a bare stick. A stalked bell
    fixes that - the green pedicel is the visible connection to the flowering
    axis, and the corolla tube plus lip gives the blossom a flower silhouette.
    """
    direction = _normalize(direction)
    pedicel_length = height_m * rng.uniform(0.0045, 0.0075)
    calyx_tip = _add(base, _scale(direction, pedicel_length))
    geometry.tube([base, calyx_tip],
                  [height_m * 0.0013, height_m * 0.0019], "StemGreen", sides=3,
                  flex=[_flex(base[2], height_m, 1.0),
                        _flex(calyx_tip[2], height_m, 1.0)], tint=0.28)
    throat = _add(calyx_tip, _scale(direction, height_m * rng.uniform(0.0032, 0.0050)))
    mouth = _add(throat, _scale(direction, height_m * rng.uniform(0.0032, 0.0050)))
    geometry.tube([calyx_tip, throat, mouth],
                  [height_m * 0.0011, height_m * 0.0024, height_m * 0.0020],
                  material, sides=4,
                  flex=[_flex(point[2], height_m, 1.0)
                        for point in (calyx_tip, throat, mouth)], tint=0.72)
    # A small lobed lip closes the corolla mouth; the bare tube would read as a
    # blunt peg in the closeup.
    lip_length = height_m * rng.uniform(0.0024, 0.0036)
    side = _normalize(_cross(direction, (0.0, 0.0, 1.0)), fallback=(1.0, 0.0, 0.0))
    lip_direction = _normalize(_add(direction, _scale(side, rng.uniform(0.25, 0.55))))
    lip_sections, _lip_z = _blade_sections(
        mouth, lip_direction, lip_length, lip_length * 0.66, side,
        stations=(0.0, 1.0), widths=(1.0, 0.52), cups=(0.20, 0.34))
    geometry.cupped_blade(lip_sections, material,
                          flex=[_flex(mouth[2], height_m, 1.0)] * 2, tint=0.82)


def _build_lavender(height_m, rng):
    geometry = PlantGeometry()
    geometry.dome((0.0, 0.0, 0.0), height_m * 0.040, height_m * 0.022, "StemGreen",
                  segments=10, rings=2, tint=0.08, flex=0.0)

    # Compact leafy clump: many short woody shoots, each carrying two opposite
    # pairs of narrow lanceolate leaves low down. Together with the axis leaves
    # they give the base the volume the review asked for, without touching the
    # terminal heads above.
    shoot_count = 10
    for index in range(shoot_count):
        angle = 2.0 * math.pi * index / shoot_count + rng.uniform(-0.30, 0.30)
        horizontal = (math.cos(angle), math.sin(angle), 0.0)
        length = height_m * rng.uniform(0.10, 0.19)
        points = [_add(_scale(horizontal, height_m * 0.012), (0.0, 0.0, 0.002)),
                  _add(_scale(horizontal, length * 0.55), (0.0, 0.0, length * 0.60)),
                  _add(_scale(horizontal, length), (0.0, 0.0, length * 0.92))]
        radii = [height_m * 0.0100, height_m * 0.0076, height_m * 0.0050]
        flex = [_flex(point[2], height_m, step / 2.0) for step, point in enumerate(points)]
        geometry.tube(points, radii, "StemGreen", sides=4, flex=flex, tint=0.05)
        for node in (0.45, 0.80):
            node_point, _tangent = _sample_polyline(points, node)
            for sign in (-1.0, 1.0):
                leaf_angle = angle + sign * (math.pi / 2.0) + rng.uniform(-0.30, 0.30)
                leaf_length = height_m * rng.uniform(0.035, 0.060)
                sections, axis_z = _leaf_sections(
                    node_point, leaf_angle, rng.uniform(0.05, 0.40), leaf_length,
                    leaf_length * rng.uniform(0.055, 0.075), rng, curl=0.14,
                    stations=LANCE_STATIONS, widths=LANCE_WIDTHS, cups=LANCE_CUPS)
                geometry.cupped_blade(
                    sections, "LeafGreen",
                    flex=[_flex(z, height_m, step / (len(axis_z) - 1))
                          for step, z in enumerate(axis_z)], tint=0.50)

    axis_count = 9
    focus = None
    focus_z = -1.0
    # A compact terminal head: the flowering zone is about 0.11 of the axis, so
    # eight close whorls read as one connected purple head instead of a string
    # of separated beads on a bare stem.
    spike_start = 0.89
    whorl_count = 9
    floret_total = 0
    for axis in range(axis_count):
        angle = 2.0 * math.pi * axis / axis_count + rng.uniform(-0.35, 0.35)
        height_factor = 0.60 + 0.38 * (axis / (axis_count - 1))
        axis_height = min(height_m * 0.99, height_m * height_factor * rng.uniform(0.95, 1.05))
        # Spread the axes outward so the clump reads instead of collapsing into
        # one pencil-thin line; heights still vary moderately per axis.
        lean = rng.uniform(0.075, 0.18)
        base = (math.cos(angle) * rng.uniform(0.040, 0.100),
                math.sin(angle) * rng.uniform(0.040, 0.100), 0.0)
        tip = (base[0] + math.cos(angle) * height_m * lean,
               base[1] + math.sin(angle) * height_m * lean,
               axis_height)
        control = _lerp(base, tip, 0.5)
        control = _add(control, (math.cos(angle) * height_m * 0.010,
                                 math.sin(angle) * height_m * 0.010, 0.0))
        points = []
        for step in range(6):
            t = step / 5.0
            points.append(_lerp(_lerp(base, control, t), _lerp(control, tip, t), t))
        radii = [height_m * (0.0042 - 0.0024 * (step / 5.0)) for step in range(6)]
        flex = [_flex(point[2], height_m, step / 5.0) for step, point in enumerate(points)]
        geometry.tube(points, radii, "StemGreen", sides=4, flex=flex, tint=0.42)

        # Four opposite narrow lanceolate leaf pairs fill the lower part of the
        # axis; the upper part stays clear so the terminal head keeps its airy
        # green gaps.
        for node in range(4):
            t = 0.07 + 0.12 * node
            node_point, _tangent = _sample_polyline(points, t)
            for sign in (-1.0, 1.0):
                leaf_angle = angle + sign * (math.pi / 2.0) + rng.uniform(-0.22, 0.22)
                leaf_length = height_m * rng.uniform(0.045, 0.075)
                sections, axis_z = _leaf_sections(
                    node_point, leaf_angle, rng.uniform(0.02, 0.55), leaf_length,
                    leaf_length * rng.uniform(0.055, 0.075), rng, curl=0.16,
                    stations=LANCE_STATIONS, widths=LANCE_WIDTHS, cups=LANCE_CUPS)
                geometry.cupped_blade(
                    sections, "LeafGreen",
                    flex=[_flex(z, height_m, step / (len(axis_z) - 1))
                          for step, z in enumerate(axis_z)], tint=0.55)

        # Compact terminal head: close whorls of stalked florets. Keeping a
        # green floret every sixth blossom leaves readable gaps instead of a
        # solid purple bar while the calyx stalks stay attached to the axis.
        terminal = None
        for whorl in range(whorl_count):
            t = spike_start + (1.0 - spike_start) * whorl / (whorl_count - 1)
            t = _clamp(t + rng.uniform(-0.010, 0.010), 0.88, 1.0)
            position, _tangent = _sample_polyline(points, t)
            florets = 5 + rng.randrange(2)
            phase = rng.uniform(0.0, 2.0 * math.pi)
            for bud in range(florets):
                bud_angle = phase + 2.0 * math.pi * bud / florets + rng.uniform(-0.14, 0.14)
                direction = _normalize((math.cos(bud_angle), math.sin(bud_angle),
                                        rng.uniform(0.30, 0.95)))
                base = _add(position, _scale(direction, height_m * rng.uniform(0.0022, 0.0040)))
                material = "StemGreen" if (whorl + bud) % 6 == 0 else "BloomViolet"
                _lavender_floret(geometry, base, direction, height_m, material, rng)
                floret_total += 1
            terminal = position
        for _bud in range(4):
            bud_angle = rng.uniform(0.0, 2.0 * math.pi)
            direction = _normalize((math.cos(bud_angle), math.sin(bud_angle),
                                    rng.uniform(0.75, 1.25)))
            base = _add(terminal, _scale(direction, height_m * 0.0032))
            _lavender_floret(geometry, base, direction, height_m, "BloomViolet", rng)
            floret_total += 1
        # Frame the closeup on the middle of this spike so its calyx stalks and
        # flowering axis are in shot, not a single loose blossom.
        spike_mid, _spike_tangent = _sample_polyline(points, (spike_start + 1.0) * 0.5)
        if spike_mid[2] > focus_z:
            focus_z = spike_mid[2]
            focus = spike_mid

    return geometry, focus, {"flowering_axes": axis_count, "woody_shoots": shoot_count,
                             "leaf_nodes_per_axis": 4, "spike_whorls": whorl_count,
                             "florets": floret_total,
                             "spike_zone_fraction": round(1.0 - spike_start, 3)}


def _fern_rachis(crown, horizontal, reach, peak_height, tip_height, samples=9):
    """A smooth cubic rachis that rises out of the crown and arches over its tip.

    The previous parabola had its peak in the middle and its steepest slopes at
    both ends, which is what made the fronds read as kinked umbrella spokes. A
    cubic with the first control point close to the crown and the second one out
    at peak height bends gradually and droops without a corner at the top.
    """
    crown_z = crown[2]
    lift = peak_height - crown_z
    p0 = crown
    p1 = (crown[0] + horizontal[0] * reach * 0.22,
          crown[1] + horizontal[1] * reach * 0.22,
          crown_z + lift * 0.72)
    p2 = (crown[0] + horizontal[0] * reach * 0.78,
          crown[1] + horizontal[1] * reach * 0.78,
          crown_z + lift)
    p3 = (crown[0] + horizontal[0] * reach,
          crown[1] + horizontal[1] * reach,
          tip_height)
    points = []
    for step in range(samples):
        t = step / (samples - 1)
        u = 1.0 - t
        point = _add(_add(_scale(p0, u ** 3), _scale(p1, 3.0 * u * u * t)),
                     _add(_scale(p2, 3.0 * u * t * t), _scale(p3, t ** 3)))
        points.append(point)
    return points


def _rolled_normal(normal, axis, roll):
    """Tilt a blade normal around its growth axis by a restrained roll."""
    axis = _normalize(axis)
    return _normalize(_add(_scale(normal, math.cos(roll)),
                           _scale(_cross(axis, normal), math.sin(roll))))


def _fern_pinna_scale(t):
    """Length of a paired pinna along the frond, from base to tip.

    Basal pinnae are already long, the widest sit around a third of the frond,
    and the outline tapers clearly towards the tip so the feather closes instead
    of fanning out and leaving the upper half bare.
    """
    if t <= 0.32:
        return 0.55 + 0.45 * math.sin(0.5 * math.pi * (t / 0.32))
    return 1.0 - 0.80 * ((t - 0.32) / 0.68)


def _build_fern(height_m, rng):
    geometry = PlantGeometry()
    geometry.dome((0.0, 0.0, 0.0), height_m * 0.048, height_m * 0.030, "StemGreen",
                  segments=10, rings=2, tint=0.10, flex=0.0)

    frond_count = 8
    upright_count = 0
    arching_count = 0
    node_count = 11
    for frond in range(frond_count):
        angle = 2.0 * math.pi * frond / frond_count + rng.uniform(-0.22, 0.22)
        horizontal = (math.cos(angle), math.sin(angle), 0.0)
        crown = (math.cos(angle) * height_m * 0.012, math.sin(angle) * height_m * 0.012,
                 height_m * 0.030)
        # Inner fronds stand up; outer ones spread lower and arch over their tips,
        # so the crown shows a graded, readable rosette in every view.
        upright = (frond % 3 == 0)
        if upright:
            upright_count += 1
            reach = height_m * rng.uniform(0.28, 0.44)
            peak_height = height_m * rng.uniform(1.05, 1.11)
            tip_height = peak_height - height_m * rng.uniform(0.05, 0.13)
        else:
            arching_count += 1
            reach = height_m * rng.uniform(0.48, 0.68)
            peak_height = height_m * rng.uniform(0.84, 0.96)
            tip_height = peak_height - height_m * rng.uniform(0.16, 0.28)
        points = _fern_rachis(crown, horizontal, reach, peak_height, tip_height)
        radii = [height_m * (0.0090 - 0.0074 * (step / 8.0)) for step in range(9)]
        flex = [_flex(point[2], height_m, step / 8.0) for step, point in enumerate(points)]
        geometry.tube(points, radii, "StemGreen", sides=5, flex=flex, tint=0.40)

        tip_point = points[-1]
        tip_tangent = _section_tangent(points, len(points) - 1)
        tip_lateral = _normalize(_cross(tip_tangent, (0.0, 0.0, 1.0)),
                                 fallback=(-math.sin(angle), math.cos(angle), 0.0))
        tip_plane = _normalize(_cross(tip_tangent, tip_lateral),
                               fallback=(math.cos(angle), math.sin(angle), 0.0))

        for node in range(node_count):
            t = 0.07 + 0.87 * node / (node_count - 1)
            position, tangent = _sample_polyline(points, t)
            pinna_length = reach * 0.34 * _fern_pinna_scale(t)
            if pinna_length < height_m * 0.010:
                continue
            lateral = _normalize(_cross(tangent, (0.0, 0.0, 1.0)),
                                 fallback=(-math.sin(angle), math.cos(angle), 0.0))
            # The pinnae stay inside the local frond plane, so their leaflet
            # faces point along that plane's normal instead of every leaflet
            # lying flat in the world XY plane and showing only its edge.
            plane_normal = _normalize(_cross(tangent, lateral),
                                      fallback=(math.cos(angle), math.sin(angle), 0.0))
            sweep = 0.30 + 0.24 * (1.0 - t)
            for sign in (-1.0, 1.0):
                direction = _normalize(_add(_add(_scale(lateral, sign),
                                                 _scale(tangent, sweep)),
                                            (0.0, 0.0, -0.06)))
                pinna_tip = _add(position, _scale(direction, pinna_length))
                pinna_axis = _normalize(_sub(pinna_tip, position))
                # A slender three-sided rachilla carries the leaflets; the broad
                # cupped saucer that used to sit on the frond is gone.
                mid = _lerp(position, pinna_tip, 0.55)
                mid = (mid[0], mid[1], mid[2] - pinna_length * 0.05)
                geometry.tube([position, mid, pinna_tip],
                              [height_m * 0.0011, height_m * 0.0008, height_m * 0.00035],
                              "StemGreen", sides=3,
                              flex=[_flex(point[2], height_m, t)
                                    for point in (position, mid, pinna_tip)], tint=0.44)
                # The in-plane direction across the rachilla: the paired
                # pinnules branch on opposing sides of it, never along it.
                across = _normalize(_cross(plane_normal, pinna_axis), fallback=lateral)
                for fraction, pair_scale in ((0.26, 0.60), (0.55, 0.52), (0.82, 0.44)):
                    origin = _lerp(position, pinna_tip, fraction)
                    pinnule_length = pinna_length * pair_scale * (1.0 - 0.25 * fraction)
                    if pinnule_length < height_m * 0.005:
                        continue
                    for branch in (-1.0, 1.0):
                        pinnule_direction = _normalize(_add(_scale(across, branch),
                                                            _scale(pinna_axis, 0.42)))
                        pinnule_normal = _rolled_normal(plane_normal, pinnule_direction,
                                                        rng.uniform(-0.18, 0.18))
                        sections, axis_z = _blade_sections(
                            origin, pinnule_direction, pinnule_length,
                            pinnule_length * 0.11, pinnule_normal,
                            stations=PINNULE_STATIONS, widths=PINNULE_WIDTHS,
                            cups=PINNULE_CUPS, curl=0.08)
                        geometry.cupped_blade(
                            sections, "LeafGreen",
                            flex=[_flex(z, height_m, t) for z in axis_z], tint=0.58)

        # One terminal pointed leaflet closes the frond outline at its tip.
        terminal_length = reach * 0.34 * _fern_pinna_scale(1.0) * 0.9
        if terminal_length > height_m * 0.010:
            terminal_normal = _rolled_normal(tip_plane, tip_tangent, rng.uniform(-0.15, 0.15))
            sections, axis_z = _blade_sections(
                tip_point, tip_tangent, terminal_length, terminal_length * 0.11,
                terminal_normal, stations=PINNULE_STATIONS, widths=PINNULE_WIDTHS,
                cups=PINNULE_CUPS, curl=0.08)
            geometry.cupped_blade(sections, "LeafGreen",
                                  flex=[_flex(z, height_m, 1.0) for z in axis_z], tint=0.58)

    return geometry, None, {"fronds": frond_count, "pinnae_per_frond": node_count,
                            "upright_fronds": upright_count,
                            "arching_fronds": arching_count}


def _grass_blade_selection(blades, level):
    """Deterministic organ pick for a grass LOD.

    The footprint of the clump is carried by the longest outer blade in every
    angular sector, so those stay in each LOD; the rest is thinned by a fixed
    stride. Nothing random happens here, so a LOD keeps the exact positions of
    the hero organs it retains.
    """
    count = len(blades)
    if level <= 0:
        return list(range(count))
    sector_best = {}
    for index, blade in enumerate(blades):
        sector = int((blade["angle"] % (2.0 * math.pi)) / (2.0 * math.pi) * 8.0) % 8
        best = sector_best.get(sector)
        if best is None or blade["reach"] > blades[best]["reach"]:
            sector_best[sector] = index
    stride = 2 if level == 1 else 4
    keep = set(sector_best.values())
    keep.update(index for index in range(count) if index % stride == 0)
    return sorted(keep)


def _grass_bristle_selection(level):
    """Bristles thin out first: a LOD keeps every second or sixth bristle.

    The kept samples preserve the tapering oval envelope of the bottlebrush,
    while the stalks are never dropped, so the vertical extent survives.
    """
    if level <= 0:
        return lambda _index: True
    stride = 2 if level == 1 else 6
    return lambda index: index % stride == 0


def _build_grass(height_m, rng, level=0):
    geometry = PlantGeometry()
    geometry.dome((0.0, 0.0, 0.0), height_m * 0.055, height_m * 0.028, "StemGreen",
                  segments=10, rings=2, tint=0.10, flex=0.0)

    # Dense basal clump: inner shoots stand taller, outer leaves arch outward.
    # Every organ consumes the same random draws at every level; a LOD then
    # selects from the finished list instead of decimating the whole mesh.
    blade_count = 56
    inner_count = 0
    blades = []
    for index in range(blade_count):
        angle = 2.0 * math.pi * index / blade_count + rng.uniform(-0.16, 0.16)
        inner = (index % 4 == 0)
        inner_count += 1 if inner else 0
        radial = rng.uniform(0.004, 0.016) if inner else rng.uniform(0.010, 0.038)
        if inner:
            tip_height = height_m * rng.uniform(0.55, 0.78)
            reach = rng.uniform(0.03, 0.10)
            droop = rng.uniform(0.0, 0.02)
        else:
            tip_height = height_m * rng.uniform(0.20, 0.46)
            reach = rng.uniform(0.16, 0.34)
            droop = rng.uniform(0.015, 0.075)
        wind = (rng.uniform(0.05, 0.15), rng.uniform(-0.05, 0.05), 0.0)
        # A tangential, per-blade rolled face normal keeps a grass blade from
        # turning edge-on while still varying its local orientation.
        face_normal = _rolled_normal(
            _normalize((math.cos(angle + 1.15), math.sin(angle + 1.15),
                        rng.uniform(-0.25, 0.45))),
            (math.cos(angle), math.sin(angle), 0.25), rng.uniform(-0.55, 0.55))
        points = []
        for step in range(GRASS_STATIONS):
            t = step / (GRASS_STATIONS - 1)
            spread = radial + reach * (t ** 1.35)
            x = math.cos(angle) * spread + wind[0] * (t ** 1.2)
            y = math.sin(angle) * spread + wind[1] * (t ** 1.2)
            z = tip_height * (1.0 - (1.0 - t) ** 1.7) - droop * (t ** 2.6)
            points.append((x, y, max(0.0, z)))
        base_width = height_m * (0.0090 if inner else 0.0072)
        blades.append({
            "points": points,
            "half_widths": [base_width * GRASS_WIDTHS[step]
                            for step in range(GRASS_STATIONS)],
            "face_normal": face_normal,
            "angle": angle,
            "reach": reach,
            "tint": 0.42 if inner else 0.62,
            "flex": [_flex(point[2], height_m, step / (GRASS_STATIONS - 1))
                     for step, point in enumerate(points)],
        })

    keep_blades = _grass_blade_selection(blades, level)
    for index in keep_blades:
        blade = blades[index]
        sections, _axis_z = _polyline_sections(blade["points"], blade["half_widths"],
                                               blade["face_normal"], GRASS_CUPS)
        geometry.cupped_blade(sections, "LeafGreen", flex=blade["flex"], tint=blade["tint"])

    # Taller stalks ending in a fluffy bottlebrush spike of real bristles; the
    # spike keeps a tapering oval envelope around the stalk.
    stalk_count = 5
    keep_bristle = _grass_bristle_selection(level)
    kept_bristles = 0
    for stalk in range(stalk_count):
        angle = 2.0 * math.pi * stalk / stalk_count + rng.uniform(-0.30, 0.30)
        stalk_height = height_m * rng.uniform(0.82, 1.0)
        lean = rng.uniform(0.01, 0.06)
        base = (math.cos(angle) * height_m * 0.014, math.sin(angle) * height_m * 0.014, 0.0)
        tip = (base[0] + math.cos(angle) * height_m * lean,
               base[1] + math.sin(angle) * height_m * lean,
               stalk_height)
        control = _lerp(base, tip, 0.5)
        points = []
        for step in range(7):
            t = step / 6.0
            points.append(_lerp(_lerp(base, control, t), _lerp(control, tip, t), t))
        radii = [height_m * (0.0034 - 0.0018 * (step / 6.0)) for step in range(7)]
        flex = [_flex(point[2], height_m, step / 6.0) for step, point in enumerate(points)]
        geometry.tube(points, radii, "StemGreen", sides=4, flex=flex, tint=0.45)

        spike_length = height_m * rng.uniform(0.085, 0.115)
        spike_t0 = max(0.0, 1.0 - spike_length / stalk_height)
        bristles = 56 + rng.randrange(10)
        for bristle in range(bristles):
            u = bristle / (bristles - 1)
            position, _tangent = _sample_polyline(points, spike_t0 + (1.0 - spike_t0) * u)
            fan = (u * 2.399963229728653 + rng.uniform(0.0, math.pi))
            tilt = rng.uniform(0.45, 1.15)
            direction = _normalize((math.cos(angle + fan) * math.sin(tilt),
                                    math.sin(angle + fan) * math.sin(tilt),
                                    math.cos(tilt)))
            bristle_length = spike_length * (0.35 + 0.55 * math.sin(math.pi * u)) * rng.uniform(0.75, 1.05)
            if not keep_bristle(bristle):
                continue
            tip_bristle = _add(position, _scale(direction, bristle_length))
            base_flex = _flex(position[2], height_m, 0.6)
            tip_flex = _flex(tip_bristle[2], height_m, 1.0)
            geometry.tube([position, tip_bristle],
                          [height_m * 0.0011, height_m * 0.0002], "PetalWhite", sides=3,
                          flex=[base_flex, tip_flex], tint=0.72)
            kept_bristles += 1

    # Pennisetum's bottlebrush is an inflorescence, but this asset set only
    # labels a dedicated bloom closeup for daisy and lavender; the grass spike
    # stays readable in the four orthographic views.
    return geometry, None, {"blades": len(keep_blades), "inner_blades": inner_count,
                            "flower_stalks": stalk_count, "bristles": kept_bristles,
                            "lod_level": level}


def _market_stem(geometry, base, tip, height, radius, *, sides=5):
    """A rooted, gently curved axis shared by the five later species."""
    points = [base,
              (base[0], base[1], height * 0.08),
              _lerp(base, tip, 0.42),
              _lerp(base, tip, 0.72), tip]
    radii = [radius, radius * 0.95, radius * 0.72, radius * 0.52, radius * 0.40]
    geometry.tube(points, radii, "StemGreen", sides=sides,
                  flex=[_flex(p[2], height, i / 4) for i, p in enumerate(points)],
                  tint=0.40)
    return points


def _market_leaf(geometry, origin, angle, elevation, length, width, height, rng,
                 *, tint=0.55, stations=LEAF_STATIONS, widths=LEAF_WIDTHS,
                 curl=0.16, cups=None):
    sections, axis_z = _leaf_sections(origin, angle, elevation, length, width,
                                      rng, curl=curl, stations=stations,
                                      widths=widths, cups=(cups if cups is not None else
                                      LEAF_CUP if len(stations) == len(LEAF_CUP) else
                                      tuple(0.18 for _ in stations)))
    geometry.cupped_blade(sections, "LeafGreen",
                          flex=[_flex(z, height, i / (len(axis_z) - 1))
                                for i, z in enumerate(axis_z)], tint=tint)


def _market_ray(geometry, centre, normal, angle, inner, outer, half_width,
                height, material, rng, *, wave=0.12, notch=0.0, cup=0.22):
    """A cupped radial petal with an uneven rim, attached to its receptacle."""
    u, v, n = _plane_axes(normal)
    radial = _normalize(_add(_scale(u, math.cos(angle)), _scale(v, math.sin(angle))))
    side = _normalize(_cross(n, radial))
    stations = (0.0, 0.16, 0.36, 0.58, 0.78, 0.93, 1.0)
    widths = (0.30, 0.58, 0.85, 1.0, 0.97, 0.82, 0.72)
    sections = []
    flex = []
    curl = rng.uniform(-1.0, 1.0)
    for i, t in enumerate(stations):
        reach = inner + (outer - inner) * t
        lift = (outer - inner) * (0.08 * math.sin(math.pi * t) + wave * curl * t * t)
        mid = _add(centre, _add(_scale(radial, reach), _scale(n, lift)))
        width = half_width * widths[i]
        ripple = width * wave * math.sin(2.7 * math.pi * t + angle)
        left = _add(mid, _add(_scale(side, width), _scale(n, ripple)))
        right = _sub(mid, _add(_scale(side, width), _scale(n, ripple * 0.6)))
        valley = _sub(mid, _scale(n, width * cup))
        if notch and i == len(stations) - 1:
            valley = _sub(valley, _scale(radial, (outer - inner) * notch))
        sections.append((left, valley, right))
        flex.append(_flex(mid[2], height, t))
    geometry.cupped_blade(sections, material, flex=flex,
                          tint=rng.uniform(0.58, 0.91))


def _build_poppy(height, rng):
    geometry = PlantGeometry()
    geometry.dome((0, 0, 0), height * 0.028, height * 0.013,
                  "StemGreen", flex=0.0, tint=0.18)
    # A single root crown feeds two open blooms and a hooked unopened bud.
    focus = None
    focus_normal = None
    for i in range(3):
        angle = 2 * math.pi * i / 3 + rng.uniform(-0.2, 0.2)
        base = (0.0, 0.0, 0.0)
        reach = height * (0.10 + i * 0.035)
        tip = (math.cos(angle) * reach, math.sin(angle) * reach,
               height * (0.76 + 0.10 * i))
        points = _market_stem(geometry, base, tip, height, height * 0.004)
        for node in (0.25, 0.47, 0.67):
            anchor, _ = _sample_polyline(points, node)
            leaf_angle = angle + (1 if node < 0.5 else -1) * 1.2
            # Lobed outlines replace the uniform oval silhouette.
            _market_leaf(geometry, anchor, leaf_angle, rng.uniform(0.24, 0.52),
                         height * rng.uniform(0.10, 0.17), height * 0.014,
                         height, rng, stations=POPPY_LEAF_STATIONS,
                         widths=POPPY_LEAF_WIDTHS, cups=POPPY_LEAF_CUPS)
        if i == 2:
            hooked = _add(tip, (height * 0.018, 0, -height * 0.040))
            geometry.tube([tip, hooked], [height * .0025, height * .0015],
                          "StemGreen", sides=4, flex=[.8, .95], tint=.42)
            geometry.dome(hooked, height * .014, height * .028,
                          "StemGreen", segments=8, rings=2, flex=.95, tint=.34,
                          normal=_normalize((.4, 0, -1)))
            continue
        normal = _normalize((math.cos(angle) * .72, math.sin(angle) * .72, 1.0))
        centre = _add(tip, _scale(normal, height * .006))
        geometry.dome(centre, height * .021, height * .014,
                      "DarkCenter", segments=12, rings=3,
                      flex=_flex(centre[2], height, 1), tint=.44, normal=normal)
        count = 5 + (i % 2)
        for petal in range(count):
            _market_ray(geometry, centre, normal, 2 * math.pi * petal / count,
                        height * .013, height * rng.uniform(.075, .092),
                        height * rng.uniform(.030, .040), height,
                        "PetalRed", rng, wave=.24, notch=.05, cup=POPPY_PETAL_CUP)
        # A dense crown of dark stamens rings the capsule just above the petal
        # roots: each short filament leans out over the corolla and carries a
        # tiny anther head, so the black centre reads as a ring, not a blob.
        u, v, n = _plane_axes(normal)
        ring = height * POPPY_STAMEN_RING_FRACTION
        filament = height * POPPY_STAMEN_FILAMENT_FRACTION
        for stamen in range(POPPY_STAMEN_COUNT):
            phi = 2 * math.pi * stamen / POPPY_STAMEN_COUNT + rng.uniform(-.04, .04)
            radial = _normalize(_add(_scale(u, math.cos(phi)), _scale(v, math.sin(phi))))
            stamen_base = _add(centre, _add(_scale(radial, ring),
                                            _scale(normal, height * .002)))
            anther = _add(stamen_base,
                          _add(_scale(radial, filament * POPPY_STAMEN_LEAN),
                               _scale(normal, filament * .90)))
            geometry.tube([stamen_base, anther], [height * .0016, height * .0011],
                          "DarkCenter", sides=3, flex=[.90, 1.0], tint=.30)
            geometry.octa(anther, (height * .0023,) * 3, "DarkCenter",
                          flex=1.0, tint=.38)
        if focus is None or centre[2] > focus[2]:
            focus, focus_normal = centre, normal
    return geometry, focus, {"flower_heads": 2, "buds": 1, "ray_petals": 11,
                             "stamens": 2 * POPPY_STAMEN_COUNT,
                             "stamen_ring_fraction": POPPY_STAMEN_RING_FRACTION,
                             "petal_cup": POPPY_PETAL_CUP,
                             "bloom_normal": list(focus_normal)}


def _build_sunflower(height, rng):
    geometry = PlantGeometry()
    geometry.dome((0, 0, 0), height * .021, height * .016,
                  "StemGreen", flex=0.0, tint=.24)
    tip = (height * .055, -height * .025, height * .88)
    points = _market_stem(geometry, (0, 0, 0), tip, height, height * .010, sides=8)
    # Alternate leaves are attached at nodes through explicit short petioles.
    for i, node in enumerate((.20, .34, .47, .59, .71, .79)):
        anchor, _ = _sample_polyline(points, node)
        angle = i * 2.39996 + rng.uniform(-.15, .15)
        petiole = _add(anchor, (height * .030 * math.cos(angle),
                                 height * .030 * math.sin(angle), height * .012))
        geometry.tube([anchor, petiole], [height * .0027, height * .0017],
                      "StemGreen", sides=4,
                      flex=[_flex(anchor[2], height, .4), _flex(petiole[2], height, .6)])
        _market_leaf(geometry, petiole, angle, rng.uniform(.18, .42),
                     height * rng.uniform(.15, .22), height * .034,
                     height, rng, tint=.59, curl=.22,
                     cups=(.28, .34, .36, .32, .26, .18))
    normal = _normalize((.16, -.72, .72))
    centre = _add(tip, _scale(normal, height * .010))
    reverse = _scale(normal, -1.0)
    # Sunflower heads have a substantial receptacle behind the florets, with
    # overlapping green involucral bracts supporting the ray-floret margin.
    geometry.dome(centre, height * .105, height * .065, "LeafGreen",
                  segments=20, rings=4, flex=.92, tint=.46, normal=reverse)
    bract_count = 24
    bract_origin = _add(centre, _scale(reverse, height * .055))
    for bract in range(bract_count):
        _market_ray(geometry, bract_origin, reverse, 2 * math.pi * bract / bract_count,
                    height * .070, height * .137, height * .0105,
                    height, "LeafGreen", rng, wave=.14, notch=.03)
    geometry.dome(centre, height * .090, height * .028,
                  "DarkCenter", segments=24, rings=4,
                  flex=_flex(centre[2], height, 1), tint=.47, normal=normal)
    # The convex disk has a seed mosaic on its actual domed surface rather
    # than seeds buried beneath the taller centre of the receptacle.
    u, v, _ = _plane_axes(normal)
    seed_count = 240
    disk_radius = height * .085
    disk_rise = height * .028
    for j in range(seed_count):
        phi = j * 2.39996
        radial = disk_radius * math.sqrt((j + .5) / seed_count)
        surface_rise = disk_rise * math.sqrt(max(0.0, 1.0 - (radial / (height * .090)) ** 2))
        centre_seed = _add(centre,
                           _add(_scale(u, radial * math.cos(phi)),
                                _add(_scale(v, radial * math.sin(phi)),
                                     _scale(normal, surface_rise + height * .005))))
        geometry.octa(centre_seed, (height * .0025,) * 3,
                      "SeedBrown", flex=.9, tint=.60)
    ray_petals = 0
    for layer, count in ((0, 17), (1, 19)):
        for j in range(count):
            angle = (j + .35 * layer) * 2 * math.pi / count
            _market_ray(geometry, centre, normal, angle,
                        height * (.078 + layer * .003),
                        height * (.151 + layer * .013),
                        height * (.012 + layer * .001), height,
                        "BloomYellow", rng, wave=.10, notch=.04)
            ray_petals += 1
    return geometry, centre, {"flower_heads": 1, "leaves": 6,
                              "ray_petals": ray_petals, "seeds": seed_count,
                              "receptacle_depth_m": height * .065,
                              "bracts": bract_count, "bract_backset_m": height * .055,
                              "bloom_normal": list(normal)}


def _build_cornflower(height, rng):
    geometry = PlantGeometry()
    geometry.dome((0, 0, 0), height * .025, height * .015,
                  "StemGreen", flex=0.0, tint=.2)
    head_centres = []
    normal = _normalize((.20, -.52, .88))
    central_florets = 0
    fringed_florets = 0
    for i in range(4):
        angle = i * 2.39996
        tip = (height * .13 * math.cos(angle), height * .13 * math.sin(angle),
               height * (.75 + .075 * (i % 3)))
        points = _market_stem(geometry, (0, 0, 0), tip, height, height * .003)
        for node in (.22, .48, .67):
            anchor, _ = _sample_polyline(points, node)
            _market_leaf(geometry, anchor, angle + 1.25, .36,
                         height * .10, height * .006, height, rng,
                         stations=LANCE_STATIONS, widths=LANCE_WIDTHS)
        centre = _add(tip, _scale(normal, height * .006))
        head_centres.append(centre)
        # A small indigo cup supports individual tubular disk florets; the
        # coloured centre stays textured by florets instead of a broad pastel
        # disk that makes the head read like a daisy.
        geometry.dome(centre, height * .026, height * .009,
                      "BloomIndigo", segments=16, rings=3,
                      flex=_flex(centre[2], height, 1), normal=normal)
        # Dense short tubes fill the centre in a correlated spiral.
        u, v, _ = _plane_axes(normal)
        for j in range(28):
            phi = j * 2.39996
            radius = height * .021 * math.sqrt((j + .5) / 28)
            radial = _normalize(_add(_scale(u, math.cos(phi)),
                                     _scale(v, math.sin(phi))))
            base = _add(centre, _add(_scale(radial, radius),
                                     _scale(normal, height * .008)))
            tip_floret = _add(base, _add(_scale(radial, height * .002),
                                         _scale(normal, height * rng.uniform(.009, .014))))
            geometry.tube([base, tip_floret], [height * .0020, height * .0014],
                          "PetalBlue", sides=4, flex=[.88, 1],
                          tint=rng.uniform(.67, .91))
            central_florets += 1

        # The outer sterile florets form a short, fringed indigo-blue rim.
        # Their stalks are deliberately tiny so each floret reads as one
        # attached organ rather than a tube ring with detached petals.
        fringe_count = 12
        for j in range(fringe_count):
            phi = 2 * math.pi * (j + .25 * (i % 2)) / fringe_count
            radial = _normalize(_add(_scale(u, math.cos(phi)),
                                     _scale(v, math.sin(phi))))
            base = _add(centre, _add(_scale(radial, height * .020),
                                     _scale(normal, height * .006)))
            mouth = _add(base, _add(_scale(radial, height * .003),
                                    _scale(normal, height * .002)))
            geometry.tube([base, mouth], [height * .0018, height * .0022],
                          "PetalBlue", sides=4, flex=[.9, 1], tint=.77)
            _market_ray(geometry, mouth, normal, phi,
                        0.0, height * .017, height * .0032, height,
                        "PetalBlue", rng, wave=.20, notch=.78)
            fringed_florets += 1

    focus = tuple(sum(point[axis] for point in head_centres) / len(head_centres)
                  for axis in range(3))
    return geometry, focus, {"flower_heads": 4, "central_tubular_florets": central_florets,
                             "fringed_outer_florets": fringed_florets,
                             "florets": central_florets + fringed_florets,
                             "outer_fringe_length_fraction": .017,
                             "outer_fringe_notch": .78,
                             "bloom_normal": list(normal)}


def _build_red_clover(height, rng):
    geometry = PlantGeometry()
    geometry.dome((0, 0, 0), height * .04, height * .02,
                  "StemGreen", flex=0.0, tint=.20)
    def shoot(start, angle, spread, tip_fraction, radius_scale=1.0):
        direction = (math.cos(angle), math.sin(angle))
        perpendicular = (-direction[1], direction[0])
        bend = height * spread * (.18 if tip_fraction > .68 else .10)
        tip = (start[0] + direction[0] * height * spread,
               start[1] + direction[1] * height * spread,
               height * tip_fraction)
        points = [start,
                  (start[0] + direction[0] * height * spread * .13 + perpendicular[0] * bend * .20,
                   start[1] + direction[1] * height * spread * .13 + perpendicular[1] * bend * .20,
                   height * .10),
                  (start[0] + direction[0] * height * spread * .43 + perpendicular[0] * bend,
                   start[1] + direction[1] * height * spread * .43 + perpendicular[1] * bend,
                   height * .27),
                  (start[0] + direction[0] * height * spread * .77 + perpendicular[0] * bend * .45,
                   start[1] + direction[1] * height * spread * .77 + perpendicular[1] * bend * .45,
                   height * max(.48, tip_fraction * .76)),
               tip]
        radii = [height * .0040 * radius_scale, height * .0037 * radius_scale,
                 height * .0030 * radius_scale, height * .0022 * radius_scale,
                 height * .0016 * radius_scale]
        geometry.tube(points, radii, "StemGreen", sides=5,
                      flex=[_flex(point[2], height, index / 4)
                            for index, point in enumerate(points)], tint=.41)
        return points

    def add_trifoliate(anchor, angle, group_index):
        # One short petiole leads to a separated terminal and two lateral
        # leaflets, so each node reads as a clover leaf rather than a foliage fan.
        outward = (math.cos(angle), math.sin(angle), 0.0)
        joint = _add(anchor, _add(_scale(outward, height * .050),
                                  (0.0, 0.0, height * .025)))
        geometry.tube([anchor, joint], [height * .0020, height * .0013],
                      "StemGreen", sides=3,
                      flex=[_flex(anchor[2], height, .45),
                            _flex(joint[2], height, .65)], tint=.44)
        tangent = (-outward[1], outward[0], 0.0)
        leaflet_specs = ((angle, .40, .112),
                         (angle + 1.42, .18, .100),
                         (angle - 1.42, .18, .100))
        for leaflet_index, (leaf_angle, elevation, length_fraction) in enumerate(leaflet_specs):
            side_offset = (leaflet_index - 1) * .040 * height
            origin = _add(joint, _add(_scale(tangent, side_offset),
                                      _scale(outward, height * (.012 if leaflet_index else 0))))
            _market_leaf(geometry, origin, leaf_angle, elevation,
                         height * length_fraction * rng.uniform(.92, 1.08),
                         height * (.022 if leaflet_index == 0 else .019),
                         height, rng, tint=.62 + .04 * (group_index % 3),
                          curl=.24, cups=(.27, .39, .43, .36, .25, .18))

    main_count = 4
    main_paths = []
    leaf_node_heights = []
    head_centres = []
    main_tip_fractions = (.66, .73, .79, .84)
    for i in range(main_count):
        angle = 2 * math.pi * i / main_count + rng.uniform(-.16, .16)
        base = (height * .018 * math.cos(angle), height * .018 * math.sin(angle), 0.0)
        spread = (.42, .50, .45, .53)[i]
        points = shoot(base, angle, spread, main_tip_fractions[i])
        main_paths.append(points)
        for group_index, node in enumerate((.20, .40, .60)):
            anchor, _ = _sample_polyline(points, node)
            add_trifoliate(anchor, angle + (.16 if group_index % 2 else -.16),
                           i * 3 + group_index)
            leaf_node_heights.append(anchor[2] / height)
        centre = points[-1]
        head_centres.append(centre)

    # Two lateral flowering branches arise halfway up separated main shoots.
    for branch_index, main_index in enumerate((0, 2)):
        parent = main_paths[main_index]
        anchor, _ = _sample_polyline(parent, .54)
        angle = (main_index * math.pi / 2) + (1 if branch_index == 0 else -1) * .88
        branch = shoot(anchor, angle, .27, (.60, .66)[branch_index], radius_scale=.72)
        head_centres.append(branch[-1])

    head_florets = 40
    for head_index, centre in enumerate(head_centres):
        normal = _normalize((.20 * math.cos(head_index * 1.7),
                             .20 * math.sin(head_index * 1.7), 1.0))
        geometry.dome(centre, height * .023, height * .036,
                      "CloverPink", segments=12, rings=4,
                      flex=_flex(centre[2], height, 1), tint=.53,
                      normal=normal)
        u, v, n = _plane_axes(normal)
        for j in range(head_florets):
            phi = j * 2.39996
            t = (j + .5) / head_florets
            radial_distance = height * .021 * math.sqrt(t)
            radial = _normalize(_add(_scale(u, math.cos(phi)),
                                     _scale(v, math.sin(phi))))
            rise = height * .033 * math.sqrt(max(0.0, 1.0 - t))
            root = _add(centre, _add(_scale(radial, radial_distance), _scale(n, rise)))
            direction = _normalize(_add(_scale(radial, .48), _scale(n, .88)))
            tip = _add(root, _scale(direction, height * rng.uniform(.009, .014)))
            geometry.tube([root, tip], [height * .0018, height * .0013],
                          "CloverPink", sides=4, flex=[.92, 1], tint=.69)
            geometry.dome(tip, height * .0020, height * .0018,
                          "CloverPink", segments=5, rings=2,
                          flex=1, tint=.76, normal=direction)
    heights = [centre[2] for centre in head_centres]
    focus = head_centres[max(range(len(head_centres)), key=lambda index: heights[index])]
    return geometry, focus, {"growth_habit": "low_spreading_clump",
                             "primary_axes": main_count, "secondary_branches": 2,
                             "flower_heads": len(head_centres), "head_florets": head_florets,
                             "florets": len(head_centres) * head_florets,
                             "trifoliate_groups": main_count * 3, "leaflets": main_count * 9,
                             "shoot_lateral_bend_fraction": .18,
                             "leaflet_fan_angle_rad": 1.42,
                             "flower_head_diameter_m": height * .046,
                             "leaf_node_height_range": [min(leaf_node_heights),
                                                        max(leaf_node_heights)]}


def _build_cattail(height, rng):
    geometry = PlantGeometry()
    geometry.dome((0, 0, 0), height * .025, height * .018,
                  "StemGreen", flex=0.0, tint=.22)
    # An upright fan of strap leaves, each bending naturally after its midrib.
    for i in range(15):
        angle = i * 2 * math.pi / 15 + rng.uniform(-.10, .10)
        reach = height * rng.uniform(.16, .27)
        leaf_height = height * rng.uniform(.50, .84)
        points = [(0, 0, height * .008),
                  (reach * .10 * math.cos(angle), reach * .10 * math.sin(angle), leaf_height * .30),
                  (reach * .35 * math.cos(angle), reach * .35 * math.sin(angle), leaf_height * .62),
                  (reach * .72 * math.cos(angle), reach * .72 * math.sin(angle), leaf_height * .87),
                  (reach * math.cos(angle), reach * math.sin(angle), leaf_height)]
        geometry.ribbon(points, [height * .007, height * .017, height * .018,
                                 height * .012, height * .001],
                        "LeafGreen", flex=[.04, .18, .42, .72, 1],
                        tint=.42 + .20 * (i % 3) / 2,
                        reference=(math.cos(angle + math.pi / 2),
                                   math.sin(angle + math.pi / 2), 0))
    focus = None
    for i in range(3):
        angle = i * 2 * math.pi / 3 + .2
        stalk_h = height * (.90 + .04 * (i % 2))
        base = (0, 0, 0)
        tip = (height * .07 * math.cos(angle),
               height * .07 * math.sin(angle), stalk_h)
        points = _market_stem(geometry, base, tip, height, height * .0045)
        female_start = stalk_h - height * .26
        female_end = stalk_h - height * .09
        x, y = tip[:2]
        geometry.tube([(x, y, female_start), (x, y, female_start + height * .015),
                       (x, y, female_end - height * .015), (x, y, female_end)],
                      [height * .015, height * .022, height * .022, height * .015],
                      "SeedBrown", sides=12, cap_start=True, cap_end=True,
                      flex=[.70, .78, .88, .92], tint=.55)
        # Leave a substantial stretch of exposed green axis between the female
        # and male inflorescences so the two spikes remain visually separate.
        male_start = female_end + height * .050
        geometry.tube([(x, y, male_start), (x, y, male_start + height * .07)],
                      [height * .006, height * .004], "BloomYellow", sides=8,
                      cap_start=True, cap_end=True, flex=[.94, 1], tint=.50)
        reproductive_midpoint = (female_start + male_start + height * .07) * .5
        if focus is None or reproductive_midpoint > focus[2]:
            focus = (x, y, reproductive_midpoint)
    return geometry, focus, {"female_spikes": 3, "male_spikes": 3,
                             "spike_gap_fraction": .050,
                             "strap_leaves": 15}


BUILDERS = {
    "daisy": _build_daisy,
    "lavender": _build_lavender,
    "fern": _build_fern,
    "grass": _build_grass,
    "poppy": _build_poppy,
    "sunflower": _build_sunflower,
    "cornflower": _build_cornflower,
    "red_clover": _build_red_clover,
    "cattail": _build_cattail,
}


def _clean_and_plan(species, height, seed, geometry, focus, extra):
    """Run the shared collapse cleanup, then snapshot the geometry into a plan."""
    # The shared cleanup runs for every species. It only drops faces that are
    # actually collapsed (repeated vertices or an area below the metric
    # tolerance), so fern, grass and lavender silhouettes keep their blades.
    cleaned = clean_geometry(geometry.vertices, geometry.faces, geometry.face_materials,
                             geometry.flex, geometry.tint)
    geometry.vertices = cleaned["vertices"]
    geometry.faces = cleaned["faces"]
    geometry.face_materials = cleaned["face_materials"]
    geometry.flex = cleaned["flex"]
    geometry.tint = cleaned["tint"]
    return _plan_from_geometry(species, height, seed, geometry, focus, extra)


def build_geometry(species, height_m, seed):
    """Deterministic, Blender-free plant geometry for one species and seed."""
    if species not in BUILDERS:
        raise ValueError(f"unknown plant species: {species!r}")
    height = float(height_m)
    if not math.isfinite(height) or height <= 0.0:
        raise ValueError(f"height_m must be positive and finite; got {height!r}")
    rng = random.Random(int(seed))
    geometry, focus, extra = BUILDERS[species](height, rng)
    return _clean_and_plan(species, height, int(seed), geometry, focus, extra)


def build_lod_geometry(species, height_m, seed, level):
    """Deterministic organ-aware LOD geometry for a species, without Blender.

    The hero builder runs unchanged and every organ consumes the same random
    draws; this pass then selects organs (blades, bristles) instead of
    decimating the finished mesh. Broad blade extents and the flower outline
    therefore survive, which a global quadric collapse could not guarantee.
    """
    if species != "grass":
        raise ValueError(f"no deterministic LOD builder for species {species!r}")
    if level not in (1, 2):
        raise ValueError(f"LOD level must be 1 or 2; got {level!r}")
    height = float(height_m)
    if not math.isfinite(height) or height <= 0.0:
        raise ValueError(f"height_m must be positive and finite; got {height!r}")
    rng = random.Random(int(seed))
    geometry, focus, extra = _build_grass(height, rng, level)
    return _clean_and_plan(species, height, int(seed), geometry, focus, extra)


def enforce_plan_budgets(plan):
    triangles = plan["triangles"]
    materials = len(plan["materials"])
    if triangles > BUDGETS["triangles_max"]:
        raise RuntimeError(
            f"{plan['species']} hero exceeds the triangle budget: "
            f"{triangles} > {BUDGETS['triangles_max']}")
    if materials > BUDGETS["materials_max"]:
        raise RuntimeError(
            f"{plan['species']} hero exceeds the material budget: "
            f"{materials} > {BUDGETS['materials_max']}")
    if plan["bounds_min"][2] < -1e-9 or plan["bounds_min"][2] > 1e-9:
        raise RuntimeError(
            f"{plan['species']} is not grounded at the origin: min z={plan['bounds_min'][2]:.6f}")
    return plan


# ---------------------------------------------------------------------------
# Blender scene assembly
# ---------------------------------------------------------------------------

def reset_scene(bpy, species):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = f"Plant_{species}"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.fps = FPS
    scene.frame_start = WIND_KEYS[0][0]
    scene.frame_end = WIND_KEYS[-1][0]
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene["asset"] = "marketplace_plant"
    scene["species"] = species
    scene["generator"] = "scripts/generate_marketplace_plants.py"
    bpy.context.preferences.filepaths.save_version = 0

    world = bpy.data.worlds.new("PlantNeutralWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.085, 0.095, 0.105, 1.0)
    background.inputs["Strength"].default_value = 0.8
    scene.world = world

    asset = bpy.data.collections.new("Plant")
    presentation = bpy.data.collections.new("Presentation")
    scene.collection.children.link(asset)
    scene.collection.children.link(presentation)
    return scene, asset, presentation


def build_plant_materials(bpy):
    materials = {}
    for name in MATERIAL_NAMES:
        dark, light = MATERIAL_COLORS[name]
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = light
        mat.metallic = 0.0
        mat.roughness = MATERIAL_ROUGHNESS[name]
        mat.use_nodes = True
        mat.use_backface_culling = False
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Roughness"].default_value = MATERIAL_ROUGHNESS[name]
        shader.inputs["Metallic"].default_value = 0.0
        if "Specular IOR Level" in shader.inputs:
            shader.inputs["Specular IOR Level"].default_value = 0.16
        colour = nodes.new("ShaderNodeVertexColor")
        colour.layer_name = RUNTIME_COLOR_ATTRIBUTE
        colour.label = "glTF COLOR_0"
        links.new(colour.outputs["Color"], shader.inputs["Base Color"])
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        mat["runtime_color_dark"] = dark
        mat["runtime_color_light"] = light
        materials[name] = mat
    return materials


def bake_vertex_colours(bpy, obj, tints, height_m):
    mesh = obj.data
    existing = mesh.color_attributes.get(RUNTIME_COLOR_ATTRIBUTE)
    if existing:
        mesh.color_attributes.remove(existing)
    attribute = mesh.color_attributes.new(name=RUNTIME_COLOR_ATTRIBUTE,
                                          type="BYTE_COLOR", domain="CORNER")
    index = len(mesh.color_attributes) - 1
    mesh.color_attributes.active_color_index = index
    mesh.color_attributes.render_color_index = index
    materials = [slot.material for slot in obj.material_slots]
    for polygon in mesh.polygons:
        material = (materials[polygon.material_index]
                    if polygon.material_index < len(materials) else None)
        dark = tuple(material.get("runtime_color_dark", (1.0, 1.0, 1.0, 1.0))) if material else None
        light = tuple(material.get("runtime_color_light", (1.0, 1.0, 1.0, 1.0))) if material else None
        name = material.name if material else ""
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            coordinate = mesh.vertices[vertex_index].co
            tint = tints[vertex_index]
            signal = color_signal((coordinate.x, coordinate.y, coordinate.z))
            if name == "StemGreen" and coordinate.z < height_m * 0.16:
                colour = mix_color(WOOD_DARK, WOOD_LIGHT, 0.18 + 0.70 * tint + 0.20 * signal)
            else:
                colour = mix_color(dark, light, 0.18 + 0.70 * tint + 0.14 * signal)
            attribute.data[loop_index].color = tuple(min(1.0, channel) for channel in colour[:3]) + (1.0,)
    obj["runtime_color_attribute"] = RUNTIME_COLOR_ATTRIBUTE


def build_plant_object(bpy, plan, materials):
    mesh = bpy.data.meshes.new("Plant_mesh")
    mesh.from_pydata(plan["vertices"], [], plan["faces"])
    mesh.update()
    obj = bpy.data.objects.new("Plant", mesh)
    for name in MATERIAL_NAMES:
        obj.data.materials.append(materials[name])
    for polygon, material_index in zip(mesh.polygons, plan["face_materials"]):
        polygon.material_index = material_index
        polygon.use_smooth = True
    group = obj.vertex_groups.new(name=WIND_GROUP)
    buckets = {}
    for index, weight in enumerate(plan["flex"]):
        key = round(_clamp(weight), 4)
        buckets.setdefault(key, []).append(index)
    for weight, indices in buckets.items():
        group.add(indices, weight, "REPLACE")
    bake_vertex_colours(bpy, obj, plan["tint"], plan["height_m"])
    obj["species"] = plan["species"]
    obj["height_m"] = plan["height_m"]
    obj["seed"] = plan["seed"]
    obj["role"] = "plant"
    obj["wind_morph"] = "WindGust"
    obj["wind_loop_frames"] = WIND_KEYS[-1][0]
    return obj


def add_wind_animation(bpy, obj, height_m, strength):
    """One looped shape-key gust with stiff bases and flexible tips."""
    mesh = obj.data
    basis = obj.shape_key_add(name="Basis", from_mix=False)
    gust = obj.shape_key_add(name="WindGust", from_mix=False)
    gust.slider_min = -1.0
    gust.slider_max = 1.0
    group = obj.vertex_groups.get(WIND_GROUP)
    for index, (source, target) in enumerate(zip(basis.data, gust.data)):
        weight = 0.0
        if group is not None:
            try:
                weight = group.weight(index)
            except RuntimeError:
                weight = 0.0
        coordinate = source.co
        phase = math.sin(coordinate.x * 23.1 + coordinate.y * 19.7 + coordinate.z * 37.3)
        anti = math.cos(coordinate.x * 17.3 - coordinate.z * 29.1)
        target.co.x += strength * weight * (0.86 + 0.14 * phase)
        target.co.y += strength * weight * (0.34 + 0.22 * anti)
        target.co.z += strength * weight * (-0.07 * abs(phase) + 0.03 * anti)
    for frame, value in WIND_KEYS:
        gust.value = value
        gust.keyframe_insert(data_path="value", frame=frame)
    animation = mesh.shape_keys.animation_data
    if animation and animation.action:
        for curve in animation.action.fcurves:
            curve.modifiers.new("CYCLES")
    mesh.shape_keys.name = "PlantWind"
    return gust


def look_at(obj, target):
    from mathutils import Vector
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_camera(bpy, collection, name, location, target, *, ortho_scale=None, lens=50.0):
    data = bpy.data.cameras.new(name)
    if ortho_scale is not None:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
        data.sensor_fit = "VERTICAL"
    else:
        data.type = "PERSP"
        data.lens = lens
        data.sensor_fit = "AUTO"
        data.clip_start = 0.001
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def build_presentation(bpy, plan, presentation):
    """Neutral studio lights plus labelled orthographic and bloom cameras."""
    height = plan["height_m"]
    centre = (0.0, 0.0, height * 0.5)
    distance = height * 2.4
    ortho = height * 1.30
    cameras = {}
    cameras["front"] = add_camera(bpy, presentation, "Camera_front",
                                  (0.0, -distance, centre[2]), centre, ortho_scale=ortho)
    cameras["side"] = add_camera(bpy, presentation, "Camera_side",
                                 (-distance, 0.0, centre[2]), centre, ortho_scale=ortho)
    cameras["rear"] = add_camera(bpy, presentation, "Camera_rear",
                                 (0.0, distance, centre[2]), centre, ortho_scale=ortho)
    cameras["three_quarter"] = add_camera(
        bpy, presentation, "Camera_three_quarter",
        (-distance * 0.707, -distance * 0.707, centre[2] * 1.05), centre, ortho_scale=ortho)
    if plan["bloom_focus"] is not None:
        focus = plan["bloom_focus"]
        # Frame the bloom feature with a little margin: at 55 mm and a 36 mm
        # sensor on 16:9 the vertical coverage is about 0.37 x distance.
        extent = BLOOM_EXTENT_M.get(plan["species"], height * 0.12)
        normal = plan.get("bloom_normal")
        if normal is not None:
            # Daisy-style head: look at the flower face along its own normal.
            location = bloom_camera_location(focus, normal, extent)
        else:
            offset = _normalize((0.55, -1.0, 0.30))
            location = _add(focus, _scale(offset, extent * 3.0))
        cameras["bloom"] = add_camera(bpy, presentation, "Camera_bloom", location, focus,
                                      lens=55.0)

    for name, offset, energy, colour in (
        ("Area_Key", (-1.6, -2.0, 2.2), 45.0, (1.0, 0.97, 0.92)),
        ("Area_Fill", (2.0, -1.1, 1.1), 20.0, (0.82, 0.88, 1.0)),
        ("Area_Rim", (0.4, 2.2, 1.9), 30.0, (0.88, 0.95, 0.82)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = height * 1.6
        data.color = colour
        light = bpy.data.objects.new(name, data)
        presentation.objects.link(light)
        light.location = (offset[0] * height, offset[1] * height, offset[2] * height)
        look_at(light, centre)

    sun_data = bpy.data.lights.new("Sun_Soft", "SUN")
    sun_data.energy = 2.5
    sun_data.angle = 0.35
    sun = bpy.data.objects.new("Sun_Soft", sun_data)
    sun.rotation_euler = (0.62, -0.35, -0.85)
    presentation.objects.link(sun)
    return cameras


def _select_only(bpy, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def export_glb(bpy, path, objects, animations):
    path.parent.mkdir(parents=True, exist_ok=True)
    _select_only(bpy, objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_vertex_color="MATERIAL",
        export_all_vertex_colors=False,
    )


def clean_mesh_geometry(mesh, label):
    """Remove collapsed triangles and loose geometry before a mesh is snapshotted.

    Two different sources of drift are closed here:

    * The glTF exporter runs `Mesh.validate()` before gathering attributes and
      that can silently drop invalid or duplicate decimation faces even without
      zero-area triangles. Running the same validation here, then deleting any
      zero-area triangles with the shared metric tolerance, lets the source
      snapshot and the exported GLB count exactly the same triangles.
    * The decimate modifier can leave vertices and edges that no face references.
      They are invisible in the viewport but the glTF exporter prunes them, so
      the source snapshot (which bounds every vertex) would be larger than the
      imported GLB bounds. Deleting them here, before the snapshot and the
      export, makes both agree.

    The result is a bmesh round trip, so vertex colours, material indices and
    every surviving non-degenerate triangle survive; the world transform lives on
    the object and is untouched.
    """
    import bmesh

    # The exporter runs exactly this validation before it gathers attributes.
    mesh.validate()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    coordinates = [tuple(vertex.co) for vertex in bm.verts]
    degenerate = [face for face in bm.faces
                  if _face_is_degenerate(coordinates,
                                         [vertex.index for vertex in face.verts],
                                         DEGENERATE_AREA_M2)]
    if degenerate:
        bmesh.ops.delete(bm, geom=degenerate, context="FACES")
    # Faces are gone; now drop what they left behind. Loose edges only hold
    # vertices, so removing them first, then the isolated vertices, clears both.
    loose_edges = [edge for edge in bm.edges if not edge.link_faces]
    if loose_edges:
        bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")
    loose_verts = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_verts:
        bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")
    if any(not vertex.link_faces for vertex in bm.verts) or \
            any(not edge.link_faces for edge in bm.edges):
        raise RuntimeError(f"{label} still carries vertices or edges no face uses")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    # Source-cleanup boundary: the export validation must no longer find a
    # single triangle to remove, or the snapshot would over-count.
    mesh.calc_loop_triangles()
    before = len(mesh.loop_triangles)
    mesh.validate()
    mesh.calc_loop_triangles()
    if len(mesh.loop_triangles) != before:
        raise RuntimeError(f"{label} still loses triangles to export validation")


def build_lod(bpy, source, label, ratio):
    """Decimate the evaluated rest mesh and keep the source world transform."""
    bpy.context.scene.frame_set(WIND_KEYS[0][0])
    collection = bpy.data.collections.new(f"Temporary_{label}")
    bpy.context.scene.collection.children.link(collection)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    duplicate = bpy.data.objects.new(f"Plant_{label}", mesh)
    duplicate.matrix_world = source.matrix_world.copy()
    collection.objects.link(duplicate)
    duplicate["lod"] = label
    modifier = duplicate.modifiers.new(f"{label}_Decimate", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    _select_only(bpy, [duplicate])
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    duplicate.select_set(False)
    clean_mesh_geometry(mesh, label)
    return collection, duplicate


def build_lod_object(bpy, plan, materials, label):
    """Build one static LOD object directly from an organ-aware LOD plan.

    The plan already holds the selected hero organs in their exact positions,
    so no global decimation runs here; the mesh still goes through the shared
    `clean_mesh_geometry`, keeping the source snapshot and the exported GLB in
    agreement. The result is a single static mesh with the same palette.
    """
    collection = bpy.data.collections.new(f"Temporary_{label}")
    bpy.context.scene.collection.children.link(collection)
    mesh = bpy.data.meshes.new(f"Plant_{label}_mesh")
    mesh.from_pydata(plan["vertices"], [], plan["faces"])
    mesh.update()
    duplicate = bpy.data.objects.new(f"Plant_{label}", mesh)
    collection.objects.link(duplicate)
    for name in MATERIAL_NAMES:
        duplicate.data.materials.append(materials[name])
    for polygon, material_index in zip(mesh.polygons, plan["face_materials"]):
        polygon.material_index = material_index
        polygon.use_smooth = True
    bake_vertex_colours(bpy, duplicate, plan["tint"], plan["height_m"])
    duplicate["lod"] = label
    duplicate["species"] = plan["species"]
    duplicate["lod_level"] = plan["stats"].get("lod_level", 0)
    clean_mesh_geometry(mesh, label)
    return collection, duplicate


def snapshot(bpy, objects):
    meshes = [obj for obj in objects if obj.type == "MESH"]
    triangles = 0
    points = []
    materials = set()
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        points.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        for polygon in obj.data.polygons:
            if polygon.material_index < len(obj.data.materials):
                material = obj.data.materials[polygon.material_index]
                if material:
                    materials.add(material.name)
    if not points:
        raise RuntimeError("snapshot found no vertices")
    lows = [min(point[i] for point in points) for i in range(3)]
    highs = [max(point[i] for point in points) for i in range(3)]
    return {
        "mesh_count": len(meshes),
        "triangles": triangles,
        "materials": sorted(materials),
        "bounds_min": lows,
        "bounds_max": highs,
        "size": [highs[i] - lows[i] for i in range(3)],
    }


def compare_snapshots(label, source, imported):
    problems = []
    for key in ("mesh_count", "triangles"):
        if source[key] != imported[key]:
            problems.append(f"{key} {source[key]} != {imported[key]}")
    if source["materials"] != imported["materials"]:
        problems.append(f"materials {source['materials']} != {imported['materials']}")
    for key in ("bounds_min", "bounds_max"):
        if any(abs(a - b) > 0.002 for a, b in zip(source[key], imported[key])):
            problems.append(f"{key} {source[key]} != {imported[key]}")
    if problems:
        raise RuntimeError(f"{label} roundtrip mismatch: " + "; ".join(problems))


def frame_set(scene, frame):
    integer = int(frame)
    scene.frame_set(integer, subframe=frame - integer)


def evaluated_bounds(bpy, obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        lows = [min(point[i] for point in points) for i in range(3)]
        highs = [max(point[i] for point in points) for i in range(3)]
        return {"min": lows, "max": highs,
                "size": [highs[i] - lows[i] for i in range(3)]}
    finally:
        evaluated.to_mesh_clear()


def check_hero_wind(bpy, imported_objects):
    """Activate the imported clip, restore -1/+1 and sample real weights."""
    keyed = [obj for obj in imported_objects
             if obj.type == "MESH" and obj.data.shape_keys]
    if len(keyed) != 1:
        raise RuntimeError(f"expected exactly one wind-morphed mesh, found {len(keyed)}")
    obj = keyed[0]
    blocks = obj.data.shape_keys.key_blocks
    if "WindGust" not in [block.name for block in blocks]:
        raise RuntimeError(f"imported mesh lost the WindGust shape key: "
                           f"{[block.name for block in blocks]}")
    for block in blocks[1:]:
        block.slider_min = -1.0
        block.slider_max = 1.0
    animation = obj.data.shape_keys.animation_data
    if animation is None:
        raise RuntimeError("imported WindGust has no shape-key animation")
    actions = {strip.action for track in animation.nla_tracks for strip in track.strips}
    if animation.action:
        actions.add(animation.action)
    if len(actions) != 1:
        raise RuntimeError(f"expected one imported wind action, found {len(actions)}")
    animation.use_nla = False
    animation.action = actions.pop()

    scene = bpy.context.scene
    first, last = animation.action.frame_range
    poses = []
    for index in range(9):
        frame_set(scene, first + (last - first) * index / 8.0)
        bpy.context.view_layer.update()
        poses.append([block.value for block in blocks[1:]])
    weights = poses[0]
    if max(max(p[i] for p in poses) - min(p[i] for p in poses)
           for i in range(len(weights))) < 0.5:
        raise RuntimeError("imported wind morph weights barely move")
    if any(min(p[i] for p in poses) > -0.30 or max(p[i] for p in poses) < 0.60
           for i in range(len(weights))):
        raise RuntimeError("imported wind lost its positive or negative authored gust")
    if max(abs(a - b) for a, b in zip(poses[0], poses[-1])) > 0.01:
        raise RuntimeError("imported wind loop endpoints do not match")

    peak_index = max(range(1, 8), key=lambda i: sum(abs(v) for v in poses[i]))
    frame_set(scene, first)
    bpy.context.view_layer.update()
    rest_bounds = evaluated_bounds(bpy, obj)
    frame_set(scene, first + (last - first) * peak_index / 8.0)
    bpy.context.view_layer.update()
    peak_bounds = evaluated_bounds(bpy, obj)
    movement = max(abs(rest_bounds[key][axis] - peak_bounds[key][axis])
                   for key in ("min", "max") for axis in (0, 1))
    if movement < 0.003:
        raise RuntimeError(
            f"imported shape key does not deform evaluated geometry (moved {movement:.5f} m)")
    duration = (last - first) / FPS
    if abs(duration - WIND_DURATION_SECONDS) > 0.15:
        raise RuntimeError(f"imported wind duration {duration:.3f}s is not about 2 s")
    return {
        "duration_seconds": duration,
        "frame_range": [first, last],
        "poses": poses,
        "peak_fraction": peak_index / 8.0,
        "moved_m": movement,
        "rest_bounds": rest_bounds,
        "peak_bounds": peak_bounds,
    }


def render(bpy, scene, camera, path):
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def imported_studio(bpy, blend_path):
    """Throw-away QA studio: load the labelled cameras/lights from the blend."""
    with bpy.data.libraries.load(str(blend_path), link=False) as (source, target):
        target.collections = ["Presentation"]
    bpy.context.scene.collection.children.link(target.collections[0])
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.fps = FPS
    world = bpy.data.worlds.new("NeutralQAWorld")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.085, 0.095, 0.105, 1.0)
    background.inputs[1].default_value = 0.8
    scene.world = world
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    return scene, bpy.data.objects["Camera_front"]


def check_scene_contract(bpy, scene, plan, cameras):
    asset_objects = list(bpy.data.collections["Plant"].objects)
    presentation_objects = list(bpy.data.collections["Presentation"].objects)
    meshes = [obj for obj in asset_objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"editable source must contain one plant mesh, found {len(meshes)}")
    if len(meshes) > BUDGETS["render_meshes_max"]:
        raise RuntimeError(f"render mesh budget exceeded: {len(meshes)}")
    if any(obj.type == "MESH" for obj in presentation_objects):
        raise RuntimeError("presentation collection must not contain render meshes")
    required = {"Camera_front", "Camera_side", "Camera_rear", "Camera_three_quarter"}
    labels = {obj.name for obj in presentation_objects if obj.type == "CAMERA"}
    if not required.issubset(labels):
        raise RuntimeError(f"missing labelled cameras: {sorted(required - labels)}")
    blooming = plan["bloom_focus"] is not None
    if blooming and "Camera_bloom" not in labels:
        raise RuntimeError("flowering plant is missing the bloom closeup camera")
    if not blooming and "Camera_bloom" in labels:
        raise RuntimeError("non-flowering plant must not carry a bloom camera")
    if scene.unit_settings.system != "METRIC" or scene.unit_settings.scale_length != 1.0:
        raise RuntimeError("editable source must use metre units")
    if bpy.data.libraries or bpy.data.texts:
        raise RuntimeError("editable source must not contain linked libraries or text blocks")
    if any(image.filepath for image in bpy.data.images):
        raise RuntimeError("editable source must not reference external images")
    if not meshes[0].data.shape_keys or "WindGust" not in [
            block.name for block in meshes[0].data.shape_keys.key_blocks]:
        raise RuntimeError("editable source is missing the WindGust shape key")
    gust = meshes[0].data.shape_keys.key_blocks["WindGust"]
    if gust.slider_min != -1.0 or gust.slider_max != 1.0:
        raise RuntimeError("WindGust source range must be -1/+1")
    scene.frame_set(WIND_KEYS[0][0])
    return meshes


# ---------------------------------------------------------------------------
# build_variant
# ---------------------------------------------------------------------------

def build_variant(context):
    import bpy

    seed = context_seed(context)
    variant_id = variant_identity(context)
    parameters = context.get("parameters")
    species, height_m = resolve_species(parameters)
    warnings = parameter_warnings(parameters)
    output_dir = prepare_variant_output_dir(context.get("output_dir"))

    plan = enforce_plan_budgets(build_geometry(species, height_m, seed))
    if plan["species"] != species:
        raise RuntimeError("geometry species drifted from the requested species")
    # Grass carries thin bristles and broad arching blades in one mesh, exactly
    # the mix a global quadric collapse sacrifices first. Its LODs are built
    # from a deterministic organ-aware plan instead; every other species keeps
    # the decimation path that already passed review.
    lod_plans = None
    if species == "grass":
        lod_plans = {label: build_lod_geometry(species, height_m, seed, level)
                     for label, level in (("LOD1", 1), ("LOD2", 2))}

    scene, asset, presentation = reset_scene(bpy, species)
    scene["variant_id"] = variant_id
    materials = build_plant_materials(bpy)
    obj = build_plant_object(bpy, plan, materials)
    asset.objects.link(obj)
    add_wind_animation(bpy, obj, height_m, 0.085 * height_m)
    cameras = build_presentation(bpy, plan, presentation)
    bpy.context.view_layer.update()
    check_scene_contract(bpy, scene, plan, cameras)

    blend_path = output_dir / "Plant.blend"
    hero_path = output_dir / "plant.glb"
    lod1_path = output_dir / "plant_lod1.glb"
    lod2_path = output_dir / "plant_lod2.glb"
    media = output_dir / "Media"
    media.mkdir(parents=True, exist_ok=True)

    scene.camera = cameras["front"]
    scene.frame_set(WIND_KEYS[0][0])
    # Snapshot before the exporter runs: `export_scene.gltf` validates the mesh
    # in place, so taking the source facts first keeps the comparison honest.
    hero_snapshot = snapshot(bpy, [obj])
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    export_glb(bpy, hero_path, [obj], animations=True)

    renders = []
    for label in ("front", "side", "rear", "three_quarter"):
        path = media / f"{species}_{label}.png"
        render(bpy, scene, cameras[label], path)
        renders.append(str(path.relative_to(output_dir).as_posix()))
    if "bloom" in cameras:
        path = media / f"{species}_bloom.png"
        render(bpy, scene, cameras["bloom"], path)
        renders.append(str(path.relative_to(output_dir).as_posix()))

    lod_snapshots = {}
    lod_objects = {}
    for label, ratio, path in (("LOD1", 0.55, lod1_path), ("LOD2", 0.28, lod2_path)):
        if lod_plans is not None:
            collection, duplicate = build_lod_object(bpy, lod_plans[label], materials, label)
        else:
            collection, duplicate = build_lod(bpy, obj, label, ratio)
        lod_snapshots[label] = snapshot(bpy, [duplicate])
        export_glb(bpy, path, [duplicate], animations=False)
        lod_objects[label] = (collection, duplicate)

    hero_triangles = hero_snapshot["triangles"]
    lod1_triangles = lod_snapshots["LOD1"]["triangles"]
    lod2_triangles = lod_snapshots["LOD2"]["triangles"]
    if not hero_triangles > lod1_triangles > lod2_triangles > 0:
        raise RuntimeError(f"{species} LOD triangle counts do not decrease: "
                           f"{hero_triangles}, {lod1_triangles}, {lod2_triangles}")
    if lod1_triangles >= hero_triangles * 0.80:
        raise RuntimeError(f"{species} LOD1 is not a meaningful reduction")
    if lod2_triangles >= lod1_triangles * 0.60:
        raise RuntimeError(f"{species} LOD2 is not a meaningful reduction")
    # A decimated copy must keep the species footprint: the vertical extent and
    # the ground contact are the load-bearing parts of a plant silhouette. The
    # hard floor rejects a collapsed LOD; the comfort band only warns, because
    # how much a quadric decimation keeps is a review decision for the parent.
    silhouette_ratios = {}
    silhouette_warnings = []
    for label, hard_size, hard_vertical, soft_size, soft_vertical in (
            ("LOD1", 0.50, 0.72, 0.65, 0.85),
            ("LOD2", 0.35, 0.55, 0.50, 0.72)):
        snapshot_lod = lod_snapshots[label]
        ratios = []
        for axis in range(3):
            ratio = (snapshot_lod["size"][axis] / hero_snapshot["size"][axis]
                     if hero_snapshot["size"][axis] > 1e-6 else 1.0)
            ratios.append(ratio)
            hard = hard_vertical if axis == 2 else hard_size
            soft = soft_vertical if axis == 2 else soft_size
            if ratio < hard or ratio > 1.20:
                raise RuntimeError(
                    f"{species} {label} lost its silhouette on axis {axis}: ratio {ratio:.3f}")
            if ratio < soft:
                silhouette_warnings.append(
                    f"{species} {label} keeps only {ratio:.2f} of the hero extent on axis {axis}")
        if abs(snapshot_lod["bounds_min"][2]) > 0.05:
            raise RuntimeError(
                f"{species} {label} left the ground: min z={snapshot_lod['bounds_min'][2]:.4f}")
        silhouette_ratios[label] = [round(value, 4) for value in ratios]
    warnings = list(warnings) + silhouette_warnings

    for collection, duplicate in lod_objects.values():
        bpy.data.objects.remove(duplicate, do_unlink=True)
        bpy.data.collections.remove(collection)

    # Blender-free structural audit of every delivered GLB before the heavier
    # empty-scene imports below. The loop variable is deliberately not the
    # variant id: reusing it silently renamed QA.json to the last file name.
    audits = {model_name: audit_glb(path) for model_name, path in (
        ("plant.glb", hero_path), ("plant_lod1.glb", lod1_path),
        ("plant_lod2.glb", lod2_path))}
    for model_name, audit in audits.items():
        if audit["has_images"]:
            raise RuntimeError(f"{model_name} contains image textures; the palette must be vertex colours")
        if audit["extensions_required"]:
            raise RuntimeError(
                f"{model_name} requires unsupported glTF extensions: {audit['extensions_required']}")
        if not audit["has_color0"]:
            raise RuntimeError(f"{model_name} is missing COLOR_0 vertex colours")
        if audit["bytes"] > BUDGETS["file_size_bytes_max"]:
            raise RuntimeError(f"{model_name} exceeds the file-size budget: {audit['bytes']}")
    if audits["plant.glb"]["animations"] < 1 or audits["plant.glb"]["morph_targets"] < 1:
        raise RuntimeError("hero GLB must carry the WindGust morph animation")
    for model_name in ("plant_lod1.glb", "plant_lod2.glb"):
        if audits[model_name]["animations"] or audits[model_name]["morph_targets"]:
            raise RuntimeError(f"{model_name} must stay a static mesh without morph animation")

    # Actual roundtrip gate: fresh empty scenes, then compare semantic facts.
    models = {}
    wind_report = None
    for label, path, source_snapshot, animated in (
            ("plant.glb", hero_path, hero_snapshot, True),
            ("plant_lod1.glb", lod1_path, lod_snapshots["LOD1"], False),
            ("plant_lod2.glb", lod2_path, lod_snapshots["LOD2"], False)):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = FPS
        bpy.ops.import_scene.gltf(filepath=str(path))
        bpy.context.view_layer.update()
        imported_objects = list(bpy.context.scene.objects)
        imported_snapshot = snapshot(bpy, imported_objects)
        compare_snapshots(label, source_snapshot, imported_snapshot)
        if animated:
            wind_report = check_hero_wind(bpy, imported_objects)
        else:
            if bpy.data.actions or any(obj.data.shape_keys for obj in imported_objects
                                       if obj.type == "MESH"):
                raise RuntimeError(f"{label} must stay a static mesh without animation")
        models[label] = {
            "bytes": path.stat().st_size,
            "triangles": imported_snapshot["triangles"],
            "mesh_count": imported_snapshot["mesh_count"],
            "materials": imported_snapshot["materials"],
            "bounds_min": imported_snapshot["bounds_min"],
            "bounds_max": imported_snapshot["bounds_max"],
            "source_triangles": source_snapshot["triangles"],
        }
        if animated:
            scene, camera = imported_studio(bpy, blend_path)
            first, last = wind_report["frame_range"]
            for label_name, fraction in (("wind_rest", 0.0),
                                         ("wind_peak", wind_report["peak_fraction"]),
                                         ("wind_loop", 1.0)):
                frame_set(scene, first + (last - first) * fraction)
                bpy.context.view_layer.update()
                target = media / f"{species}_{label_name}.png"
                render(bpy, scene, camera, target)
                renders.append(str(target.relative_to(output_dir).as_posix()))
            wind_report["renders"] = [f"{species}_wind_rest.png",
                                      f"{species}_wind_peak.png",
                                      f"{species}_wind_loop.png"]

    hero = models["plant.glb"]
    for model_name, audit in audits.items():
        if audit["triangles"] != models[model_name]["triangles"]:
            raise RuntimeError(
                f"{model_name}: GLB triangle count {audit['triangles']} does not match the "
                f"imported mesh {models[model_name]['triangles']}")
        if audit["materials"] != len(models[model_name]["materials"]):
            raise RuntimeError(
                f"{model_name}: GLB material count {audit['materials']} does not match the "
                f"imported materials {models[model_name]['materials']}")
    if hero["triangles"] > BUDGETS["triangles_max"]:
        raise RuntimeError(f"hero triangle budget exceeded: {hero['triangles']}")
    if len(hero["materials"]) > BUDGETS["materials_max"]:
        raise RuntimeError(f"hero material budget exceeded: {hero['materials']}")
    if hero["bytes"] > BUDGETS["file_size_bytes_max"]:
        raise RuntimeError(f"hero file-size budget exceeded: {hero['bytes']}")
    if wind_report is None:
        raise RuntimeError("hero roundtrip did not produce a wind report")

    qa = {
        "generator_id": GENERATOR_ID,
        "generator_version": GENERATOR_VERSION,
        "variant_id": variant_id,
        "species": species,
        "height_m": height_m,
        "seed": seed,
        "source_scene": {
            "mesh_count": 1,
            "triangles": hero_snapshot["triangles"],
            "materials": hero_snapshot["materials"],
            "bounds_min": hero_snapshot["bounds_min"],
            "bounds_max": hero_snapshot["bounds_max"],
            "base_origin_z": hero_snapshot["bounds_min"][2],
            "unit_system": "METRIC",
            "animation": "one looped WindGust morph clip",
        },
        "geometry_stats": plan["stats"],
        "lod_snapshots": {
            "LOD1": lod_snapshots["LOD1"],
            "LOD2": lod_snapshots["LOD2"],
        },
        "lod_silhouette_ratios": silhouette_ratios,
        "models": models,
        "glb_audit": audits,
        "wind": wind_report,
        "renders": sorted(renders),
        "checks": {
            "roundtrip_import": True,
            "static_lods": True,
            "no_image_textures": True,
            "metre_units": True,
            "base_origin": True,
        },
    }
    (output_dir / "QA.json").write_text(
        json.dumps(qa, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    metrics = {
        "triangles": hero["triangles"],
        "materials": len(hero["materials"]),
        "file_size_bytes": hero["bytes"],
        "lod1_triangles": models["plant_lod1.glb"]["triangles"],
        "lod2_triangles": models["plant_lod2.glb"]["triangles"],
        "render_meshes": 1,
        "wind_duration_seconds": wind_report["duration_seconds"],
        "roundtrip_import": True,
        "fingerprint": plan["fingerprint"],
    }
    metadata = {
        "generator_id": GENERATOR_ID,
        "generator_version": GENERATOR_VERSION,
        "variant_id": variant_id,
        "species": species,
        "height_m": height_m,
        "seed": seed,
        "geometry_stats": plan["stats"],
        "models": models,
        "glb_audit": audits,
        "lod_silhouette_ratios": silhouette_ratios,
        "wind": {
            "duration_seconds": wind_report["duration_seconds"],
            "peak_fraction": wind_report["peak_fraction"],
            "moved_m": wind_report["moved_m"],
        },
        "renders": sorted(renders),
        "qa_path": str((output_dir / "QA.json").resolve()),
        "note": ("No engine-specific compatibility is claimed; source scene is "
                 "metres/Z-up and the GLB is exported Y-up."),
    }
    # Identity guard: the model audit loops above iterate file basenames, so
    # verify once more that the manifest id, not a basename, is what ships.
    identity = variant_identity(context)
    if qa["variant_id"] != identity or metadata["variant_id"] != identity:
        raise RuntimeError(
            f"variant identity drifted from the context id {identity!r}: "
            f"{qa['variant_id']!r} / {metadata['variant_id']!r}")
    return {
        "outputs": [
            {"role": "editable", "path": str(blend_path.resolve())},
            {"role": "runtime", "path": str(hero_path.resolve())},
            {"role": "lod1", "path": str(lod1_path.resolve())},
            {"role": "lod2", "path": str(lod2_path.resolve())},
        ],
        "metrics": metrics,
        "warnings": warnings,
        "metadata": metadata,
    }


def main():  # pragma: no cover - convenience entry point for direct Blender runs
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, type=Path,
                        help="JSON file with a build_variant context")
    arguments = parser.parse_args()
    print(json.dumps(build_variant(json.loads(arguments.context.read_text(encoding="utf-8"))),
                     indent=2))


if __name__ == "__main__":
    main()
