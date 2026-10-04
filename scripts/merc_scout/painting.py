"""Painted image maps for the mercenary scout.

The generator builds one shared atlas per material; every part owns a slot in the
8x8 region grid of :mod:`spec` and reaches it through ``fit_uv_region``. This
module paints those slots and wires the result into the Principled BSDF that
:mod:`materials` already built.

Two things are easy to get wrong and are handled explicitly here:

* **Slots wrap in u.** The skull loft puts the face centre on the tile border
  (``u = 0`` and ``u = 1`` are the same point on the head), and ``fit_uv_region``
  puts every other part's seam on its slot border as well. Every noise octave is
  therefore drawn so that one slot is exactly one lattice period. Painted in
  absolute UV space instead, the seam shows up as a stripe down the middle of the
  face.
* **The normal maps come from a shared height field.** Every painter returns a
  height grid next to its colour, the two are assembled into one image each, and
  the normals are the gradient of that height. That keeps bumps and shading in
  step instead of drifting apart.

Relief is measured in millimetres
---------------------------------
A tile coordinate spans one atlas slot, and a slot covers ``SLOT_SPAN_METRES`` -
about 0.35 m - of surface, so one height unit is 350 mm. Painting a "0.3 deep"
crease in tile units therefore carves a 10 cm canyon. All relief in this module is
written in millimetres and converted by :func:`_relief`, so a value can be checked
against the real object.

One factor was missing for a long time and made every millimetre of it invisible:
the height field is in tile units while :func:`_normal_map` takes its gradient per
*texel*, so the slope needs the tile's pixel count. Measured on the maps of the
first pass, the whole Leather atlas varied by 0.0019 around the flat 0.5 - a normal
map that changed nothing. See :func:`_normal_map` and :data:`RELIEF_GAIN`.

Texel budget, and why there is no 1 mm weave
--------------------------------------------
A slot is ``texture_size / 8`` wide: 256 px on the 2048 atlas, 128 px on mobile
and 512 px on the 4096 skin atlas. One texel of the pc atlas is therefore about
1.4 mm of garment and one texel of mobile about 2.7 mm. A cotton thread of 0.3 mm
and a warp spacing of 1 mm are **below that sampling limit**: one thread is 0.2 to
0.7 px, and no filter can turn that into a thread, only into aliasing. Painted
anyway it comes back as the moire diamond that already shipped once on the jacket.

The weave is therefore painted as *behaviour above the sampling limit* instead of
as threads: a low-frequency warp/weft sheen whose phase is warped by noise (so it
reads as a cloth surface and not a grid), slubs and thick places, colour
unevenness, edge wear and compression folds. The real 1 mm weave is the buyer's
job, with a detail map his engine can tile at the density he needs; this generator
delivers the low-frequency structure that survives minification.

Determinism: all randomness comes from ``numpy.random.default_rng(seed)``. The
per-material streams are derived from the seed and the material name, so the
result does not depend on iteration order and never touches the clock.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np

from . import spec

#: Roughness of the relief per surface class: how strongly the height field bends
#: the shading normal. Fabric stays low on purpose - at this texel density a deep
#: fine weave aliases into a visible plaid when the garment is minified on screen.
#: Leather has body, skin is nearly flat, cloth carries folds rather than threads.
NORMAL_STRENGTH = {
    "Skin": 0.18,
    "Hair": 0.30,
    "Eye": 0.10,
    "Jacket": 0.20,
    "Trousers": 0.18,
    "Leather": 0.42,
    "Accent": 0.16,
}
NORMAL_STRENGTH_DEFAULT = 0.35

#: Converts the per-pixel slope of a height field into a tangent space tilt. The
#: height fields carry real relief (see :func:`_relief`) and :func:`_normal_map`
#: turns them into a true surface slope, so a slope of 1 is a 45 degree facet and
#: this factor is the deliberate exaggeration on top of that. It used to be the only
#: factor, because the slope itself was 256 times too small - see _normal_map.
NORMAL_RELIEF = 2.0

#: Gain on the physical relief, per material. With :func:`_normal_map` fixed every
#: painted height finally reaches the normal map, which multiplies all of them by the
#: tile's pixel count - 256 on a pc atlas. The garment and hair amplitudes were
#: written and reviewed against the old, flat maps, so switching the factor on for
#: everything at once turned the hair into a chaos of 90 degree normals (measured
#: std 0.31 on the hair tile, 0.002 on the shipped maps). The gains below bring each
#: material back to the relief its amplitudes were tuned for, and the skin, which
#: this pass is about, up to the relief a face needs. Measured tile by tile with
#: ``.scratch/face/measure_relief.py``; the numbers are in the generator report.
RELIEF_GAIN = {
    "Skin": 1.0,
    "Hair": 0.03,
    "Eye": 4.0,
    "Jacket": 0.20,
    "Trousers": 0.20,
    "Leather": 0.10,
    "Accent": 0.20,
    "Metal": 0.20,
}
RELIEF_GAIN_DEFAULT = 0.20

#: Tick to the blur radius of the height field before the normals are taken.
#: Cell noise and grain leave single-texel spikes; unblurred they become the
#: sparkle that reads as film grain on a smooth surface. Two ticks at radius 1
#: remove the spikes and keep every real crease.
NORMAL_BLUR_TICKS = 2


# --------------------------------------------------------------------------- #
# material -> atlas slots
# --------------------------------------------------------------------------- #

#: Which atlas slots each painted material owns. Every one of the 64 slots of the
#: 8x8 grid is owned exactly once, so no material ships an unpainted hole. The
#: names are matched leniently (see ``_material_regions``): a slot the spec grows
#: before this module knows it still gets painted instead of left black.
PAINTED_REGIONS: dict[str, tuple[str, ...]] = {
    "Skin": (
        "head", "nose", "lips", "ear_L", "ear_R", "brow_L", "brow_R",
        "lid_L", "lid_R", "body", "body_back", "scar",
        "stubble",       # beard shadow on jaw, chin and upper lip
        "cheek",         # cheek redness and the nasolabial fold
        "lobe",          # ear lobe, deeper red than the shell
        "nostril",       # dark nostril and the alar crease
        "lip_upper",     # mouth red, upper lip, plus the mouth line at its lower edge
        "lip_lower",     # mouth red, lower lip, plus the mouth line at its top edge
        "lid_crease",    # upper lid crease, slightly darker
        "hairline",      # forehead hairline shadow and temple recession
        "pores",         # pore detail of the limbs and torso
        # Reserve tiles that hold geometry since the realism pass: the nose wings
        # and the right nostril live here, because the grid has no ``ala_*`` slot
        # and only one ``nostril``. Left out of this table they would ship black.
        "spare_a", "spare_b", "spare_c",
    ),
    "Hair": ("hair", "fringe", "brow_L", "brow_R"),
    "Eye": ("eye_L", "eye_R"),
    "Jacket": ("jacket", "sleeve_L", "sleeve_R", "hood", "collar", "quilt", "zip",
               "patch", "grime"),
    "Trousers": ("trousers", "knee_pad", "pocket", "cuff", "worn", "stitch", "seam"),
    "Leather": ("boots", "boot_sole", "boot_cuff", "laces", "gloves", "glove_palm",
                "glove_knuckle", "belt", "pouch_A", "pouch_B", "holster", "straps",
                "rivet", "buckle", "tread"),
    "Accent": ("accent", "accent_L", "accent_R"),
    "Metal": ("metal", "metal_dark"),
}

#: Words that decide which material owns a slot the tables above do not name.
#: Used as the fallback when the spec grows a slot this module has not seen yet.
_OWNER_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Eye", ("eye",)),
    ("Hair", ("hair", "fringe", "brow", "beard", "lash")),
    ("Skin", ("pores", "pore", "stubble", "cheek", "lobe", "nostril", "lip",
              "lid", "lash", "hairline", "brow", "scar", "skin", "head", "nose",
              "ear", "body")),
    ("Jacket", ("jacket", "sleeve", "hood", "collar", "quilt", "zip", "patch",
                "grime", "canvas")),
    ("Trousers", ("trouser", "knee", "pocket", "cuff", "ripstop", "worn", "stitch",
                  "seam")),
    ("Leather", ("boot", "lace", "glove", "belt", "pouch", "holster", "strap",
                 "leather", "rivet", "buckle", "tread", "sole")),
    ("Accent", ("accent", "badge")),
    ("Metal", ("metal", "steel", "buckle")),
)

#: Slots that are deliberately left blank when the spec still carries them.
_SPARE_SLOTS = frozenset({"spare_a", "spare_b", "spare_c", "spare_d", "spare_e",
                          "spare_f", "spare_g", "spare_h"})

#: Colour of the skin slots before shading, shared by face, limbs and scar.
SKIN_BASE = (0.62, 0.44, 0.34)

#: Vermilion of the lips, as an absolute albedo and not as an offset from the skin.
#: Adding a red delta to the skin base overshot into a pale salmon: a lip is darker
#: *and* redder than the face, not just redder.
_LIP = (0.330, 0.100, 0.088)
_LIP_LIGHT = (0.200, 0.088, 0.070)


# --------------------------------------------------------------------------- #
# noise building blocks (all functions take lattice coordinates in cells)
# --------------------------------------------------------------------------- #


def _lattice(rng: np.random.Generator, period: int) -> np.ndarray:
    return rng.standard_normal((period, period)).astype(np.float32)


def _lattice_grid(x: np.ndarray, y: np.ndarray, values: np.ndarray, period: int) -> np.ndarray:
    """Bilinear value noise sampled at lattice coordinates ``x``/``y``, in cells."""
    fx, fy = x * period, y * period
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    tx = fx - x0
    ty = fy - y0
    x0 %= period
    y0 %= period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period
    sx = tx * tx * (3.0 - 2.0 * tx)
    sy = ty * ty * (3.0 - 2.0 * ty)
    top = values[y0, x0] + (values[y0, x1] - values[y0, x0]) * sx
    bottom = values[y1, x0] + (values[y1, x1] - values[y1, x0]) * sx
    return top + (bottom - top) * sy


def _fbm(rng: np.random.Generator, x: np.ndarray, y: np.ndarray, frequency: int,
         octaves: int = 4, gain: float = 0.5) -> np.ndarray:
    """Fractal value noise, periodic in ``x`` and ``y`` (the atlas u and v axis)."""
    total = np.zeros_like(x, dtype=np.float32)
    amplitude = 1.0
    norm = 0.0
    for octave in range(octaves):
        period = frequency * (2 ** octave)
        total += amplitude * _lattice_grid(x, y, _lattice(rng, period), period)
        norm += amplitude
        amplitude *= gain
    return total / norm


def _lattice_period(width: int, frequency: float, octaves: int) -> int:
    """Whole cells across one slot, chosen so the tightest octave still resolves.

    The value is clamped to what the pixel grid can carry (two pixels per cell at
    the finest octave), which keeps a high ``frequency`` from aliasing into noise.
    """
    finest = max(frequency, 2.0) / (2 ** (octaves - 1))
    return max(4, int(round(width / finest)))


def _fbm_row(rng: np.random.Generator, size: int, region: str, frequency: float,
             octaves: int = 4, gain: float = 0.5) -> np.ndarray:
    """Tileable fractal noise over one atlas slot.

    ``frequency`` is the size of one finest lattice cell in tile pixels, so the
    same number means the same texture scale on a 512 and on a 2048 atlas. The
    slot's pixel extent is exactly one lattice period: the first and the last
    column therefore carry the values of two adjacent lattice columns and the
    field is continuous across the u seam.
    """
    width, height_px = _tile_pixels(size, region)
    period = _lattice_period(width, frequency, octaves)
    columns = np.arange(width, dtype=np.float32) * (period / width)
    rows = np.arange(height_px, dtype=np.float32) * (period / width)
    x, y = np.meshgrid(columns, rows, indexing="xy")
    return _fbm(rng, x, y, period, octaves, gain)


def _grain(rng: np.random.Generator, size: int, region: str, frequency: float,
           octaves: int = 2, gain: float = 0.45) -> np.ndarray:
    """Fine tileable noise in [-1, 1], centred and contrast-normalised.

    One lattice cell is about ``frequency`` pixels, so frequency 1.5 is close to
    the sampling limit; the mean and the standard deviation are corrected so the
    output amplitude does not depend on the cell size. This is the "irregular
    noise" the skin pores and the leather scratches are built from: it has no
    period inside the tile and no seam on the tile border.

    The field is damped where the lattice falls below the sampling limit. Value
    noise on a one-pixel lattice is a sawtooth, and a sawtooth in the height field
    becomes a 90 degree shading normal: that is the mechanism behind the film
    grain a normal map shows on an otherwise smooth surface. A real surface is
    smooth at that scale, so the sub-texel octave is damped instead of painted.
    """
    values = _fbm_row(rng, size, region, frequency, octaves, gain)
    spread = float(values.std()) or 1.0
    values = np.clip((values - float(values.mean())) / spread, -3.0, 3.0)
    width, _height_px = _tile_pixels(size, region)
    cells_per_pixel = _lattice_period(width, frequency, octaves) / width
    # Full amplitude at 0.4 cells per pixel (a lattice cell every 2.5 px), down to
    # 15 % at 1.0 cells per pixel, i.e. once the lattice *is* the pixel grid.
    damp = 1.0 - 0.85 * float(min(1.0, max(0.0, (cells_per_pixel - 0.4) / 0.6)))
    return values * damp


def _bump(rng: np.random.Generator, size: int, region: str, cells: int,
          width: float) -> np.ndarray:
    """Scattered round dents or pores on a jittered grid inside the tile."""
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    width_px, height_px = _tile_pixels(size, region)
    jitter = _grain(rng, size, region, max(6.0, width_px / (cells * 1.6)), octaves=1) * 0.35
    offset = _grain(rng, size, region, max(6.0, height_px / (cells * 1.6)), octaves=1) * 0.35
    field = np.zeros((height_px, width_px), dtype=np.float32)
    span = max(1, cells)
    for row in range(-1, span + 1):
        centre_v = (row + 0.5) / span + offset * (1.0 / span)
        for column in range(-1, span + 1):
            centre_u = (column + 0.5) / span + jitter * (1.0 / span)
            radial = np.hypot((tu - centre_u) / width * span, (tv - centre_v) / width * span)
            field = np.maximum(field, np.exp(-(radial ** 2)).astype(np.float32))
    return field


def _wrapped_1d(rng: np.random.Generator, coordinate: np.ndarray, period: int) -> np.ndarray:
    """Tileable 1D value noise in [-1, 1] over a 0..1 coordinate."""
    values = rng.standard_normal(max(2, period)).astype(np.float32)
    values = (values - float(values.mean())) / (float(values.std()) or 1.0)
    scaled = coordinate * period
    base = np.floor(scaled)
    fraction = scaled - base
    smooth = fraction * fraction * (3.0 - 2.0 * fraction)
    left = values[np.mod(base.astype(np.int64), period)]
    right = values[np.mod(base.astype(np.int64) + 1, period)]
    return np.clip((left + (right - left) * smooth) / 2.0, -1.0, 1.0)


def _wrap_distance(centre: np.ndarray, coordinate: np.ndarray) -> np.ndarray:
    """Distance on the u circle, so a mask crossing the seam stays continuous."""
    delta = np.abs(coordinate - centre)
    return np.minimum(delta, 1.0 - delta)


def _cellular(rng: np.random.Generator, x: np.ndarray, y: np.ndarray, period: int) -> np.ndarray:
    """Voronoi distance field (0 at the cell centre), the base of leather grain."""
    fx, fy = x * period, y * period
    base_x = np.floor(fx).astype(np.int64)
    base_y = np.floor(fy).astype(np.int64)
    seed = rng.random((period, period, 2)).astype(np.float32)
    distance = np.full(x.shape, 4.0, dtype=np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cell_x = (base_x + dx) % period
            cell_y = (base_y + dy) % period
            centre_x = base_x + dx + seed[cell_y, cell_x, 0]
            centre_y = base_y + dy + seed[cell_y, cell_x, 1]
            distance = np.minimum(distance, np.hypot(fx - centre_x, fy - centre_y))
    return distance / period


def _lines(coordinate: np.ndarray, spacing: float, width: float) -> np.ndarray:
    """1 on a line, fading to 0 within ``width``; period 1/``spacing``."""
    unit = np.mod(coordinate / spacing, 1.0)
    distance = np.minimum(unit, 1.0 - unit) * spacing
    return np.exp(-((distance / width) ** 2)).astype(np.float32)


def _seam(distance: np.ndarray, width: float) -> np.ndarray:
    return np.exp(-((distance / width) ** 2)).astype(np.float32)


def _smoothstep(edge: np.ndarray, low: float, high: float) -> np.ndarray:
    t = np.clip((edge - low) / max(1e-6, high - low), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def _edge_distance(tu: np.ndarray, tv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Distance to the slot border in u and in v.

    The u distance is ``min(tu, 1 - tu)``: it rises from a border and falls again,
    so a border effect such as edge wear carries the same value on the first and
    the last column and cannot break the wrap. The v distance is the plain
    minimum, because the slot does not repeat vertically.
    """
    return np.minimum(tu, 1.0 - tu), np.minimum(tv, 1.0 - tv)


def _mix(base: tuple[float, float, float], layers: list[tuple[np.ndarray, tuple[float, float, float]]],
         *extra: tuple[np.ndarray, tuple[float, float, float]]) -> np.ndarray:
    """Blend RGB layers into one tile, each with its own weight field."""
    colour = np.array(base, dtype=np.float32).reshape(1, 1, 3)
    for weight, target in layers + list(extra):
        colour = colour + (np.asarray(target, dtype=np.float32).reshape(1, 1, 3)
                           - colour) * weight[..., None]
    return np.clip(colour, 0.0, 1.0)


def _shade(colour: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """Darken a tile with a weight field, the cheap way to read relief as shading."""
    return np.clip(colour * (1.0 - weight)[..., None], 0.0, 1.0)


def _slot_pixels(size: int, region: str, divisions: int = 8) -> tuple[int, int, int, int]:
    """Pixel rectangle of one atlas slot: the painted area inside the slot margin.

    This is the exact inverse of :func:`_grid`, so a tile and the pixels it lands
    on can never drift apart.
    """
    u0, v0, u1, v1 = spec.region_uv(region)
    inset = 1.0 / (size * divisions)
    return (int(round((u0 + inset) * size)), int(round((v0 + inset) * size)),
            int(round((u1 - inset) * size)), int(round((v1 - inset) * size)))


def _grid(size: int, region: str, divisions: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Coordinates of one atlas slot, one sample per painted pixel of that slot."""
    u0, v0, u1, v1 = spec.region_uv(region)
    inset = 1.0 / (size * divisions)
    left, bottom, right, top = _slot_pixels(size, region, divisions)
    u = np.linspace(u0 + inset, u1 - inset, right - left, dtype=np.float32, endpoint=False)
    v = np.linspace(v0 + inset, v1 - inset, top - bottom, dtype=np.float32, endpoint=False)
    return np.meshgrid(u, v, indexing="xy")


def _tile_pixels(size: int, region: str, divisions: int = 8) -> tuple[int, int]:
    """Pixel size of one painted atlas slot."""
    left, bottom, right, top = _slot_pixels(size, region, divisions)
    return right - left, top - bottom


def _empty_tile(size: int, region: str, channels: int = 1) -> np.ndarray:
    """Zeroed buffer in the exact shape of one painted slot.

    ``channels=0`` returns a 2D field, which is what the height and mask
    accumulators need; the default 1 channel is a (h, w, 1) stack.
    """
    width, height_px = _tile_pixels(size, region)
    if channels == 0:
        return np.zeros((height_px, width), dtype=np.float32)
    return np.zeros((height_px, width, channels), dtype=np.float32)


_GRID_CACHE: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = {}


def _coordinates_atlas(size: int, region: str,
                       divisions: int = 8) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Slot grid plus the local 0..1 coordinates that the wrapped patterns use."""
    key = f"{size}:{region}:{divisions}"
    cached = _GRID_CACHE.get(key)
    if cached is not None:
        return cached
    width, height_px = _tile_pixels(size, region, divisions)
    u0, v0, u1, v1 = spec.region_uv(region)
    inset = 1.0 / (size * divisions)
    u = np.linspace(u0 + inset, u1 - inset, width, dtype=np.float32, endpoint=False)
    v = np.linspace(v0 + inset, v1 - inset, height_px, dtype=np.float32, endpoint=False)
    grid_u, grid_v = np.meshgrid(u, v, indexing="xy")
    grid = (grid_u, grid_v, (grid_u - u0) / (u1 - u0), (grid_v - v0) / (v1 - v0))
    _GRID_CACHE[key] = grid
    return grid


def _stretch(values: np.ndarray, factor: float) -> np.ndarray:
    """Widen an axis of a height field without letting its mean drift."""
    if factor <= 1.0:
        return values
    return values * factor - float(values.mean()) * (factor - 1.0)


#: How much surface one atlas slot spans, in metres. The median over the boot,
#: trouser and glove slots measured on the generator's own meshes. It is what turns
#: "a 2 mm leather cell" or "a 0.4 mm fold" into a number this module can paint.
SLOT_SPAN_METRES = 0.35

#: Millimetres of surface that one height unit of a tile painter covers. A slot
#: spans ``SLOT_SPAN_METRES`` across the whole 0..1 tile coordinate, so one tile
#: unit is 350 mm and a 0.4 mm fold is 0.0011 units. Painting a "0.3" crease in
#: tile units instead - which is what the first pass did - carves 13 cm.
_MILLIMETRES_PER_UNIT = SLOT_SPAN_METRES * 1000.0


def _pixels(size: int, metres: float) -> float:
    """Pixels that cover a feature of ``metres`` length on an atlas of ``size`` px.

    One slot is ``size / 8`` pixels wide and ``SLOT_SPAN_METRES`` across, so a
    feature of ``metres`` is this many pixels. Painting at a fixed pixel size
    instead would make every surface detail twice as coarse on the mobile atlas as
    on the pc one; painting at a fixed real size keeps the two variants looking
    like the same material.
    """
    return max(1.0, (size / spec.REGION_GRID) * (metres / SLOT_SPAN_METRES))


def _relief(millimetres: float) -> float:
    """Convert a relief depth in millimetres into tile height units."""
    return millimetres / _MILLIMETRES_PER_UNIT


def _stroke(tu: np.ndarray, tv: np.ndarray, origin_u: float, origin_v: float,
            angle: float, length: float, width: float) -> np.ndarray:
    """One straight groove of finite length, in tile coordinates.

    ``origin`` is the near end, ``angle`` the direction in tile space (0 = along u),
    ``length`` the extent and ``width`` the half width. Used for the small face
    creases - crow's feet, frown lines, nasolabial fold - whose position matters
    more than their shape.
    """
    du = tu - origin_u
    dv = tv - origin_v
    cosine, sine = math.cos(angle), math.sin(angle)
    along = du * cosine + dv * sine
    across = -du * sine + dv * cosine
    onset = _smoothstep(along, -0.15 * length, 0.05 * length)
    fade = 1.0 - _smoothstep(along, 0.85 * length, 1.15 * length)
    return (np.exp(-(across / width) ** 2) * onset * fade).astype(np.float32)


try:  # the head module owns the face stations; the painter only reads them
    from . import head as _head
except ImportError:  # pragma: no cover - head is part of the package
    _head = None  # type: ignore[assignment]

#: Tile u of the eye centres in the skull slot. The skull loft starts the ring on
#: the face centre, so a feature at ring parameter ``t`` is at tile u = ``t``. The
#: painter used to place the eye socket at 0.058, which is the value of the *old*
#: flat head in ``body.py``: every eye-related fold of the face was painted on the
#: cheek, 20 mm away from the eye.
FACE_EYE_U = _head.EYE_RING_T if _head is not None else 0.1115
#: Tile u of the mouth corner, same convention.
FACE_MOUTH_U = _head.MOUTH_CORNER_T if _head is not None else 0.0385
#: Philtrum: the flat groove between the nose base and the upper lip.
PHILTRUM_Z = 1.6075


def _part_slots(*names: str) -> frozenset[str]:
    """Atlas slots of named head parts, taken from head.py.

    The atlas grid has no ``ala_L`` and only one ``nostril`` tile, so head.py parks
    those parts in the reserve slots. Deriving them here instead of writing the
    names twice keeps both modules in step: move a part and only head.py changes.
    """
    fallback = {"ala_L": "spare_a", "ala_R": "spare_b",
                "nostril_L": "nostril", "nostril_R": "spare_c"}
    table = getattr(_head, "FACE_PART_REGIONS", fallback) if _head is not None else fallback
    return frozenset(table[name] for name in names if name in table)


#: Slots that hold one nose wing / one nostril, wherever head.py put them.
_ALA_REGIONS = _part_slots("ala_L", "ala_R")
_NOSTRIL_REGIONS = _part_slots("nostril_L", "nostril_R")


# --------------------------------------------------------------------------- #
# skin: face, limbs and the scar slot
# --------------------------------------------------------------------------- #

#: Vertical span of the skull loft in world z (see head.HEAD_RINGS). The head slot
#: is unwrapped with v proportional to the *cumulative arc length* of the ring
#: centres, not to z, and the rings are resampled with a 0.72 power so they bunch
#: towards the crown. A linear z-to-v map is therefore wrong by a factor of three
#: in the middle of the face, which is what painted the cheeks as forehead and
#: produced the seams across the face in the first review pass. The mapping below
#: is rebuilt from the generator's own table at import time.
HEAD_Z_BOTTOM = 1.4870
HEAD_Z_TOP = 1.8020


def _head_v_table() -> tuple[tuple[float, float], ...]:
    """``(z, tile v)`` samples of the skull, taken from the generator's table.

    The ring heights and the ring centres come from :mod:`head`, so a change to
    the skull proportions moves the painted folds with it instead of leaving them
    behind. The cumulative length of the centre path is what ``mesh_utils.loft``
    writes into v; ``fit_uv_region`` then normalises it to 0..1.
    """
    try:
        from . import head as head_module
    except ImportError:  # pragma: no cover - the module is part of the package
        return ((HEAD_Z_BOTTOM, 0.0), (HEAD_Z_TOP, 1.0))
    rings = head_module._skull_ring_heights(head_module.DENSE["rings"])
    cumulative = [0.0]
    for lower, upper in zip(rings, rings[1:]):
        upper_y = head_module._ring_row(upper)[1] + head_module.FACE_PLANE_Y
        lower_y = head_module._ring_row(lower)[1] + head_module.FACE_PLANE_Y
        cumulative.append(cumulative[-1] + math.hypot(upper_y - lower_y, upper - lower))
    total = cumulative[-1] or 1.0
    samples = [(float(z), float(value / total)) for z, value in zip(rings, cumulative)]
    return tuple(samples) or ((HEAD_Z_BOTTOM, 0.0), (HEAD_Z_TOP, 1.0))


_HEAD_V_SAMPLES = _head_v_table()


def _head_v(z: np.ndarray | float) -> np.ndarray | float:
    """Tile v of a world height on the skull, interpolated from the ring table."""
    heights = [sample[0] for sample in _HEAD_V_SAMPLES]
    values = [sample[1] for sample in _HEAD_V_SAMPLES]
    return np.asarray(np.interp(z, heights, values), dtype=np.float32)


def _face_arc(tu: np.ndarray, width: float = 0.05) -> np.ndarray:
    """Weight 1 at the face centre (tile u = 0 / 1) fading to 0 at the wrap."""
    return _seam(_wrap_distance(np.float32(0.0), tu).astype(np.float32), width)


def _skin_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    base = np.array(SKIN_BASE, dtype=np.float32).reshape(1, 1, 3)

    # Broad tone drift: lighter forehead, deeper jaw, uneven from cheek to cheek.
    mottle = _fbm_row(rng, size, region, 10, octaves=4)
    colour = base + mottle[..., None] * np.array((0.062, 0.050, 0.040), dtype=np.float32)
    height = np.zeros_like(tu, dtype=np.float32)

    # Pores: fine irregular noise, no period inside the tile, no lattice grid. At
    # this texel density - a texel on the pc atlas is 1.4 mm of skin - a pore of
    # 0.2 to 0.4 mm is a fraction of a texel, so it cannot be a bump: it is painted
    # as the albedo variation that survives minification, and the relief of the
    # face is carried by the folds below. That division is deliberate.
    pores = _grain(rng, size, region, 1.6, octaves=2)
    pores = np.clip(pores, 0.0, 3.0)
    pore_shade = np.clip(pores - 0.45, 0.0, 3.0)
    colour = _shade(colour, pore_shade * np.float32(0.11))
    # Skin is never a flat surface: the centimetre-scale undulation of the flesh is
    # what the eye reads as "not a decal". Kept at 0.03 mm because it is the one
    # term every skin slot shares - a face part gets its own relief below.
    undulation = _fbm_row(rng, size, region, 26, octaves=2)
    height = height + undulation * _relief(0.03)

    if region == "head":
        # Redness where the skin is thin over bone and where the sun lands.
        nose_red = np.exp(-(_wrap_distance(np.float32(0.0), tu) / 0.09) ** 2) \
            * np.exp(-((tv - _head_v(1.660)) / 0.075) ** 2)
        cheek_red = (np.exp(-(_wrap_distance(np.float32(0.128), tu) / 0.075) ** 2)
                     + np.exp(-(_wrap_distance(np.float32(0.872), tu) / 0.075) ** 2)) \
            * np.exp(-((tv - _head_v(1.640)) / 0.085) ** 2)
        ear_red = (np.exp(-(_wrap_distance(np.float32(0.25), tu) / 0.06) ** 2)
                   + np.exp(-(_wrap_distance(np.float32(0.75), tu) / 0.06) ** 2)) \
            * np.exp(-((tv - _head_v(1.678)) / 0.055) ** 2)
        # Nasolabial fold and the frown line: a soft dark line, no drawn stroke.
        fold = (np.exp(-(_wrap_distance(np.float32(0.055), tu) / 0.045) ** 2)
                + np.exp(-(_wrap_distance(np.float32(0.945), tu) / 0.045) ** 2)) \
            * np.exp(-((tv - _head_v(1.604)) / 0.022) ** 2)
        brow_glabella = _face_arc(tu, 0.045) * np.exp(-((tv - _head_v(1.696)) / 0.016) ** 2)
        eye_socket = (np.exp(-(_wrap_distance(np.float32(FACE_EYE_U), tu) / 0.035) ** 2)
                      + np.exp(-(_wrap_distance(np.float32(1.0 - FACE_EYE_U), tu) / 0.035) ** 2)) \
            * np.exp(-((tv - _head_v(1.672)) / 0.018) ** 2)
        lid_fold = (np.exp(-(_wrap_distance(np.float32(FACE_EYE_U), tu) / 0.030) ** 2)
                    + np.exp(-(_wrap_distance(np.float32(1.0 - FACE_EYE_U), tu) / 0.030) ** 2)) \
            * np.exp(-((tv - _head_v(1.684)) / 0.013) ** 2)
        chin_light = _face_arc(tu, 0.10) * np.exp(-((tv - _head_v(1.566)) / 0.045) ** 2)
        forehead_light = _face_arc(tu, 0.30) * np.exp(-((tv - _head_v(1.730)) / 0.055) ** 2)

        # The skull is alone in its slot since the realism pass: nose, wings,
        # nostrils, both lips and the lids moved to their own tiles (head.py). Tone
        # can therefore be stronger than the old "soft and low contrast" pass, which
        # existed only because everything painted here also landed on the nose.
        red = np.clip(0.34 * nose_red + 0.22 * cheek_red + 0.30 * ear_red + 0.10 * chin_light, 0.0, 0.62)
        colour = colour + np.stack([red, red * 0.24, red * 0.18], axis=-1)
        dark = np.clip(0.12 * fold + 0.10 * eye_socket + 0.08 * brow_glabella + 0.07 * lid_fold, 0.0, 0.4)
        colour = colour - np.stack([dark, dark * 0.95, dark * 0.90], axis=-1)
        # Skull shine: forehead, nose bridge and cheekbones stay a touch lighter.
        light = np.clip(0.05 * forehead_light + 0.04 * chin_light, 0.0, 0.12)
        colour = colour + np.stack([light, light * 0.9, light * 0.8], axis=-1)

        # Relief of the face, in millimetres. One texel of the skull slot is about
        # 1.3 mm of skin vertically and 2.2 mm around the head, so a fold narrower
        # than 3 texels is not a fold but aliasing. The widths below are therefore
        # 3 to 6 mm of skin - a real forehead crease is a round depression of that
        # width, not a hairline scratch - and the depth is 0.4 to 0.9 mm.
        forehead = np.exp(-(_wrap_distance(np.float32(0.0), tu) / 0.16) ** 2)
        folds = np.zeros_like(tu, dtype=np.float32)
        for index, (z, width) in enumerate(((1.7360, 0.0170), (1.7530, 0.0155), (1.7690, 0.0140))):
            wave = 0.006 * np.sin(np.pi * (_wrap_distance(np.float32(0.0), tu) / 0.14 * 3.0 + index))
            line = np.exp(-((tv - (_head_v(z) + wave)) / width) ** 2)
            folds = np.maximum(folds, line * forehead * (1.0 - index * 0.18))
        frown = np.zeros_like(tu, dtype=np.float32)
        for side in (1.0, -1.0):
            frown = np.maximum(frown, _stroke(tu, tv, side * 0.0130, _head_v(1.6880),
                                              side * 0.35, 0.062, 0.0070))
            frown = np.maximum(frown, _stroke(tu, tv, side * 0.0230, _head_v(1.6895),
                                              side * 0.30, 0.048, 0.0062))
        crows = np.zeros_like(tu, dtype=np.float32)
        for side in (1.0, -1.0):
            for index, (dz, angle, length) in enumerate(((0.0010, 0.55, 0.024),
                                                         (-0.0016, 0.15, 0.028),
                                                         (-0.0042, -0.20, 0.022))):
                crows = np.maximum(crows, _stroke(
                    tu, tv, side * (FACE_EYE_U + 0.024), _head_v(1.6720) + dz,
                    angle if side > 0 else math.pi - angle, length, 0.0062) * (1.0 - index * 0.1))
        nasolabial = np.zeros_like(tu, dtype=np.float32)
        for side in (1.0, -1.0):
            nasolabial = np.maximum(nasolabial, _stroke(
                tu, tv, side * 0.0620, _head_v(1.6340), side * 1.28, 0.055, 0.0085))
        philtrum = np.exp(-(_wrap_distance(np.float32(0.0), tu) / 0.014) ** 2) \
            * np.exp(-((tv - _head_v(PHILTRUM_Z)) / 0.0180) ** 2)
        chin_crease = _face_arc(tu, 0.055) * np.exp(-((tv - _head_v(1.5780)) / 0.0120) ** 2)
        relief = (0.55 * folds + 0.45 * frown + 0.60 * crows + 0.50 * nasolabial
                  + 0.45 * philtrum + 0.30 * chin_crease)
        height = height - relief * _relief(1.0)
        colour = _shade(colour, np.clip(0.30 * folds + 0.26 * frown + 0.20 * crows
                                        + 0.22 * nasolabial + 0.26 * philtrum, 0.0, 0.55))
        # Cheekbones and the hollow under them: a broad, soft relief that the
        # geometry warp only hints at. Deliberately low frequency - a narrow bump
        # would read as a scar, which this slot also carries a proper tile for.
        cheek_bone = (np.exp(-(_wrap_distance(np.float32(0.150), tu) / 0.055) ** 2)
                      + np.exp(-(_wrap_distance(np.float32(0.850), tu) / 0.055) ** 2))
        hollow = (np.exp(-(_wrap_distance(np.float32(0.190), tu) / 0.045) ** 2)
                  + np.exp(-(_wrap_distance(np.float32(0.810), tu) / 0.045) ** 2))
        colour = colour + np.clip(0.05 * cheek_bone, 0.0, 0.06)[..., None]
        height = height + (cheek_bone * np.exp(-((tv - _head_v(1.6380)) / 0.045) ** 2)
                           * _relief(0.35))
        height = height - (hollow * np.exp(-((tv - _head_v(1.6200)) / 0.040) ** 2)
                           * _relief(0.40))
    elif region == "nose":
        # The nose body runs from the nasion (tile v = 0) to the columella (v = 1).
        # Measured on the built tube, the dorsum and the tip face tile u = 0.75; the
        # old painter centred its redness at 0.5 and so tinted the character's left
        # flank of the nose while the bridge stayed grey.
        front = np.exp(-(_wrap_distance(np.float32(0.75), tu) / 0.16) ** 2)
        dorsum = front * np.exp(-((tv - 0.30) / 0.30) ** 2)
        tip = front * np.exp(-((tv - 0.80) / 0.14) ** 2)
        # Thin skin over cartilage: redder than the cheek, and the bridge is the
        # only part of the face that catches the light without a fold in it.
        colour = colour + np.stack([front * 0.16, front * 0.030, front * 0.018], axis=-1)
        colour = colour + (tip * 0.30)[..., None] * (np.array((0.10, 0.035, 0.025), dtype=np.float32)
                                                     - colour)
        # Sebaceous sheen: the tip and the bridge go slightly paler, which is what
        # reads as specular in a base colour map. Kept to a warm grey - mixed towards
        # a cold grey the nose looked like a separate plastic part.
        sheen = np.clip(tip * 0.7 + dorsum * 0.45, 0.0, 1.0)
        colour = colour + (sheen * 0.14)[..., None] * (np.array((0.78, 0.70, 0.64), dtype=np.float32)
                                                       - colour)
        # Cartilage relief, in millimetres: a shallow ridge down the bridge, the
        # ball of the tip, and the two creases where the wings will meet it.
        bridge = np.exp(-(_wrap_distance(np.float32(0.75), tu) / 0.075) ** 2) \
            * np.exp(-((tv - 0.34) / 0.28) ** 2)
        ball = front * np.exp(-((tv - 0.80) / 0.115) ** 2)
        waist = np.exp(-(_wrap_distance(np.float32(0.75), tu) / 0.05) ** 2) \
            * np.exp(-((tv - 0.545) / 0.045) ** 2)
        granular = _grain(rng, size, region, 1.7, octaves=2)
        colour = _shade(colour, np.clip(granular - 0.85, 0.0, 3.0) * 0.34)
        height = height + bridge * _relief(0.45) + ball * _relief(0.90) - waist * _relief(0.35)
    elif region in _ALA_REGIONS:
        # A nose wing: a dome whose crown faces the front of the face (tile u = 0.75
        # on the built tube). The mask is periodic in u, so the dome has no seam on
        # the tile border, which is the same point of the geometry.
        dome = 0.5 + 0.5 * np.cos(2.0 * np.pi * _wrap_distance(np.float32(0.75), tu))
        dome = dome * (0.45 + 0.55 * np.sin(np.pi * np.clip(tv, 0.0, 1.0)))
        colour = colour + (dome * 0.16)[..., None] * (np.array((0.78, 0.60, 0.52), dtype=np.float32)
                                                      - colour)
        # Alar crease: the fold that separates the wing from the cheek, at the back
        # of the wing (u = 0.25) and towards its base (v = 1).
        crease = np.exp(-(_wrap_distance(np.float32(0.25), tu) / 0.13) ** 2) \
            * np.exp(-((tv - 0.92) / 0.22) ** 2)
        colour = _shade(colour, crease * 0.26)
        height = height + dome * _relief(0.85) - crease * _relief(0.55)
    elif region in _NOSTRIL_REGIONS:
        # Dark cavity with a thin rim; the alar crease sits in the wing's own tile.
        # The tube is simply the hollow, so the whole tile is the inside of the nose
        # and v = 1 is its deep end.
        cavity = np.clip(np.exp(-(np.hypot((tu - 0.5) / 0.30, (tv - 0.55) / 0.40) ** 2)) * 1.5,
                         0.0, 1.0)
        depth = np.clip(0.55 + 0.45 * tv, 0.0, 1.0)
        colour = colour + (cavity * depth * 0.95)[..., None] \
            * (np.array((0.032, 0.018, 0.016), dtype=np.float32) - colour)
        rim = _seam(np.abs(np.hypot((tu - 0.5) / 0.34, (tv - 0.12) / 0.16) - 1.0), 0.12)
        colour = _shade(colour, rim * 0.34)
        height = height - cavity * _relief(3.0) + rim * _relief(0.5)
    elif region in ("lip_upper", "lip_lower"):
        # Measured on the built rolls: tile u = 0 is the crest of the lip (the part
        # that faces the camera), u = 0.5 the back where the roll meets the face,
        # u = 0.75 the top of the roll and u = 0.25 its bottom. Which of the two
        # ends is the mouth line depends on the lip: the upper roll meets the lower
        # one at its bottom, the lower roll at its top.
        mouth_u = 0.25 if region == "lip_upper" else 0.75
        skin_u = 0.75 if region == "lip_upper" else 0.25
        crest = np.exp(-(_wrap_distance(np.float32(0.0), tu) / 0.26) ** 2)
        body = _fbm_row(rng, size, region, 14, octaves=3)
        # Vermilion: an absolute colour, uneven from lip line to lip line.
        red = np.clip(0.55 + 0.45 * body, 0.0, 1.0)
        lip_colour = np.array(_LIP, dtype=np.float32).reshape(1, 1, 3) \
            + np.array(_LIP_LIGHT, dtype=np.float32).reshape(1, 1, 3) * red[..., None]
        colour = colour + (crest * red)[..., None] * (lip_colour - colour)
        # The mouth line: a dark, slightly cool groove where the two rolls meet.
        line = np.exp(-(_wrap_distance(np.float32(mouth_u), tu) / 0.055) ** 2)
        # The vermilion border: the lip fades into the skin over a millimetre or two.
        border = np.exp(-(_wrap_distance(np.float32(skin_u), tu) / 0.10) ** 2)
        colour = _shade(colour, line * 0.42)
        colour = colour + (border * 0.55)[..., None] * (np.array(SKIN_BASE, dtype=np.float32) - colour)
        # Vertical lip lines. They run across the roll, so they are lines of constant
        # v, warped a little so they are not ruled. 18 lines over a mouth that is
        # about 40 mm wide is a line every 2 mm - and each line is 5 texels wide on
        # purpose: at 0.5 texels the normal map turned them into a sawtooth, which is
        # the striped lip the first render after the relief fix showed.
        lines = _lines(tv + 0.10 * np.sin(5.0 * np.pi * tu), 1.0 / 18.0, 0.0050)
        colour = _shade(colour, lines * crest * 0.07)
        if region == "lip_lower":
            sheen = np.exp(-(((tu - 0.5) / 0.30) ** 2 + ((tv - 0.60) / 0.30) ** 2))
            colour = colour + (sheen * crest * 0.18)[..., None] \
                * (np.array((0.90, 0.86, 0.84), dtype=np.float32) - colour)
            height = height + sheen * _relief(0.08)
        height = height - (lines * crest * _relief(0.10) + line * _relief(0.30))
    elif region == "lips":
        # No geometry owns this slot any more (the two lips have their own tiles);
        # it stays in the painted list so the atlas carries no black hole. It is
        # painted as a plain lip so a stray island would still read as a mouth.
        lip = np.exp(-((tv - 0.5) / 0.32) ** 2)
        colour = colour + lip[..., None] * np.array((0.160, -0.060, -0.048), dtype=np.float32)
        creases = _lines(tv + 0.16 * np.sin(6.0 * np.pi * tu), 1.0 / 18.0, 0.0050)
        colour = _shade(colour, creases * lip * 0.055)
        height = height - creases * lip * _relief(0.10)
    elif region in ("ear_L", "ear_R"):
        red = np.exp(-((tv - 0.45) / 0.40) ** 2)
        colour = colour + np.stack([red * 0.115, red * 0.010, red * 0.005], axis=-1)
        rim = _lines(tv - 0.12 * np.sin(np.pi * tu), 0.30, 0.030) * 0.5
        colour = _shade(colour, rim * 0.030)
        height = height + rim * _relief(0.05)
    elif region in ("lid_L", "lid_R"):
        # The lid shell is a closed ring: v = 0 and v = 1 are the same curve - the
        # lid margin that touches the eyeball - and v = 0.5 is the rim, which turns
        # away behind the skull (head.py, ``LID_RIM_RHO``). The visible skin is the
        # outer half between them, and everything is written symmetrically in
        # |v - 0.5| so the margin curve is painted on both surfaces at once.
        distance = np.abs(tv - 0.5)
        wave = 0.030 * np.sin(2.0 * np.pi * (tu * 1.0 + 0.15))
        crease = np.exp(-((distance - (0.115 + wave)) / 0.050) ** 2)
        margin = np.exp(-((distance - 0.455) / 0.032) ** 2)
        pad = np.exp(-((distance - 0.280) / 0.110) ** 2)
        colour = _shade(colour, crease * 0.24 + margin * 0.34)
        colour = colour + (pad * 0.10)[..., None] * (np.array((0.86, 0.74, 0.70), dtype=np.float32)
                                                     - colour)
        fine = _lines(tu + 0.08 * np.sin(3.0 * np.pi * tv), 1.0 / 18.0, 0.0055)
        colour = _shade(colour, fine * pad * 0.05)
        height = height - crease * _relief(0.55) - margin * _relief(0.25) \
            + pad * _relief(0.15) - fine * pad * _relief(0.06)
    elif region in ("body", "body_back"):
        # Nearly all of the body is covered by clothing; tone and pores matter.
        stretch = _fbm_row(rng, size, region, 8, octaves=3)
        colour = colour + np.array((0.0, 0.0, -0.012), dtype=np.float32) * tv[..., None]
        height = height + stretch * _relief(0.6)
    elif region == "scar":
        line = np.exp(-((tv - 0.62 + 0.22 * (tu - 0.5)) / 0.038) ** 2)
        line = line * (0.35 + 0.65 * np.exp(-((tu - 0.5) / 0.42) ** 2))
        pale = line * 0.85
        colour = colour + pale[..., None] * np.array((0.145, 0.155, 0.140), dtype=np.float32)
        height = height + pale * _relief(1.4)
    elif region == "stubble":
        # Beard shadow: dark in the crevices between the hair roots, plus the
        # individual dark specks of a two-day beard. Deliberately cool-toned -
        # a warm shadow reads as dirt, a cool one as hair under the skin.
        hair = _grain(rng, size, region, 1.3, octaves=2)
        cover = np.clip(0.55 + 0.45 * _fbm_row(rng, size, region, 15, octaves=3), 0.0, 1.0)
        cover = cover * (0.75 + 0.25 * (tv > 0.30).astype(np.float32))
        roots = np.clip(hair * 1.15 - 0.15, 0.0, 2.0) * cover
        shadow = (0.30 * cover + 0.34 * np.clip(roots, 0.0, 1.0))
        colour = colour + (shadow * 0.42)[..., None] * (np.array((0.185, 0.180, 0.190), dtype=np.float32) - colour)
        height = height + roots * _relief(0.35)
    elif region == "cheek":
        red = 0.30 + 0.70 * _fbm_row(rng, size, region, 12, octaves=3)
        colour = colour + np.clip(red, 0.0, 1.0)[..., None] * np.array((0.10, 0.030, 0.022), dtype=np.float32)
        # Pore field denser than the body, this slot is a close-up surface.
        dense = np.clip(_grain(rng, size, region, 1.5, octaves=2) - 0.5, 0.0, 3.0) * 0.6
        colour = _shade(colour, dense * 0.08)
        height = height + dense * _relief(0.30)
    elif region == "lobe":
        red = np.exp(-((tv - 0.35) / 0.45) ** 2)
        colour = colour + np.stack([red * 0.16, red * 0.012, red * 0.010], axis=-1)
        # Piercing dimple: a small round dent, no ring - the metal is geometry.
        dimple = np.exp(-(np.hypot((tu - 0.5) / 0.06, (tv - 0.42) / 0.06) ** 2))
        colour = _shade(colour, dimple * 0.22)
        height = height - dimple * _relief(1.5)
    elif region == "nostril":
        # Dark cavity with a thin rim; the alar crease sits just outside it.
        cavity = np.exp(-(np.hypot((tu - 0.5) / 0.16, (tv - 0.42) / 0.20) ** 2))
        cavity = np.clip(cavity * 1.6, 0.0, 1.0)
        colour = colour + (cavity * 0.92)[..., None] * (np.array((0.055, 0.030, 0.026), dtype=np.float32) - colour)
        rim = _seam(np.abs(np.hypot((tu - 0.5) / 0.16, (tv - 0.42) / 0.20) - 1.0), 0.10)
        colour = _shade(colour, rim * 0.30)
        height = height - cavity * _relief(4.0) + rim * _relief(0.6)
    elif region in ("lip_upper", "lip_lower"):
        body = _fbm_row(rng, size, region, 14, octaves=3)
        red = np.clip(0.55 + 0.45 * body, 0.0, 1.0)
        colour = colour + red[..., None] * np.array((0.24, -0.085, -0.070), dtype=np.float32)
        # Vertical lip lines plus the wet sheen in the middle of the lower lip.
        lines = _lines(tu + 0.10 * np.sin(5.0 * np.pi * tv), 1.0 / 26.0, 0.0020)
        colour = _shade(colour, lines * 0.07)
        vertical = np.exp(-((tv - 0.5) / 0.30) ** 2)
        height = height - lines * vertical * _relief(0.5)
        if region == "lip_lower":
            sheen = np.exp(-(((tu - 0.5) / 0.22) ** 2 + ((tv - 0.60) / 0.22) ** 2))
            colour = colour + sheen[..., None] * np.array((0.10, 0.035, 0.030), dtype=np.float32) * 0.6
            height = height + sheen * _relief(0.4)
    elif region == "lid_crease":
        crease = np.exp(-((tv - 0.40) / 0.07) ** 2)
        pale = np.exp(-((tv - 0.70) / 0.14) ** 2)
        colour = _shade(colour, crease * 0.16)
        colour = colour + pale[..., None] * np.array((0.045, 0.035, 0.030), dtype=np.float32)
        lash = np.exp(-((tv - 0.90) / 0.035) ** 2)
        colour = _shade(colour, lash * 0.35)
        height = height - crease * _relief(0.9) + pale * _relief(0.3) - lash * _relief(0.5)
    elif region == "hairline":
        # Forehead end of the hair: a soft shadow with a receding temple line and
        # the tiny vellus hairs that break the border up. The edge sits high in the
        # tile on purpose - the nose and the lips are islands in the *lower* half of
        # the shared head slot, so a hairline drawn at the middle of the tile
        # painted a grey band straight down the nose.
        vellus = _grain(rng, size, region, 1.4, octaves=2)
        edge = _smoothstep(tv, 0.62, 0.80) * (0.75 + 0.25 * (1.0 - np.abs(tu - 0.5) * 2.0) ** 2)
        temple = (np.exp(-((tu - 0.06) / 0.05) ** 2) + np.exp(-((tu - 0.94) / 0.05) ** 2)) \
            * np.exp(-((tv - 0.74) / 0.14) ** 2)
        colour = colour + np.clip(edge + temple, 0.0, 1.0)[..., None] \
            * (np.array((0.20, 0.135, 0.105), dtype=np.float32) - colour) * 0.45
        colour = _shade(colour, np.clip(vellus - 0.4, 0.0, 3.0) * edge * 0.06)
        height = height + np.clip(edge + temple, 0.0, 1.0) * _relief(0.5)
    elif region == "pores":
        # Limb and torso pore sheet: same irregular noise, slightly coarser scale
        # because a forearm texel covers more skin than a face texel.
        coarse = np.clip(_grain(rng, size, region, 1.9, octaves=2), 0.0, 3.0)
        colour = _shade(colour, np.clip(coarse - 0.6, 0.0, 3.0) * 0.065)
        height = height + coarse * _relief(0.35)

    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# eyes
# --------------------------------------------------------------------------- #


#: Where the cornea lands in an eye slot, in tile coordinates. Measured on the
#: built mesh (``.scratch/face/probe_faces.py``): the vertex whose direction is the
#: gaze direction carries uv (0.5, 0.5) on *both* eyeballs, exactly. The
#: (0.220, 0.050) this constant used to hold was measured on the old eyeball, whose
#: rings were built perpendicular to the gaze; the current one is lofted along Z and
#: mirrored in X and Y, which moves the seam to the back of the eye and the gaze to
#: the middle of the tile. Painted at the stale position the iris sat 68 degrees off
#: and the visible cap rendered as a white ball with a dark rim.
_CORNEA_TILE_U = 0.5
_CORNEA_TILE_V = 0.5
#: The slot is not an angle chart. u spans 360 degrees of longitude, v is the path
#: through the ring centres, ``v = (1 - cos(phi)) / 2``, so v compresses towards the
#: poles and a circle around the gaze pole is an ellipse in tile coordinates - 1.6
#: times taller than wide. These two constants turn a tile offset into the angle it
#: covers, in radians, so the iris stays round: 360 degrees of longitude are 2 pi,
#: and the polar offset is ``arcsin(2 * dv)``.
_EYE_LONGITUDE = 2.0 * math.pi
#: Half angle of the iris, in radians. A 10 mm iris on the 25.2 mm eyeball is 23.4
#: degrees, and the lid opening spans -6.8 to +17.7 degrees around the gaze, so the
#: upper and lower lid cut the iris the way they do on a real eye. An iris sized to
#: the opening instead (12 degrees) leaves a small pupil in a lot of sclera, and the
#: old 0.22 tile radius covered the whole visible cap.
_EYE_IRIS_ANGLE = 0.42
#: Pupil radius as a share of the iris: a 4.5 mm pupil inside a 10 mm iris.
_EYE_PUPIL_SHARE = 0.45


def _eye_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    # Angular distance from the cornea, in radians: this puts 0 at the pupil and
    # keeps the radius isotropic on the sphere instead of in the tile.
    local_u = (tu - _CORNEA_TILE_U) * _EYE_LONGITUDE
    local_v = np.arcsin(np.clip((tv - _CORNEA_TILE_V) * 2.0, -1.0, 1.0))
    radius = np.hypot(local_u, local_v) / _EYE_IRIS_ANGLE
    sclera = np.array(_SCLERA, dtype=np.float32).reshape(1, 1, 3)
    veins = _fbm_row(rng, size, region, 26, octaves=3)
    colour = sclera + veins[..., None] * np.array((0.045, 0.010, 0.010), dtype=np.float32)
    # Iris, pupil and limbus are discs with a real edge: a Gaussian iris blends into
    # the sclera over a third of its radius and reads as a smudge, not an eye.
    iris = 1.0 - _smoothstep(radius, 0.90, 1.02)
    pupil = 1.0 - _smoothstep(radius, _EYE_PUPIL_SHARE - 0.07, _EYE_PUPIL_SHARE + 0.07)
    limbus = _seam(radius - 0.94, 0.09)
    # Radial iris fibres: the strands run outward from the pupil, so the noise is
    # sampled around the angle instead of along the tile axes.
    angle = np.arctan2(local_v, local_u)
    fibre_u = np.mod(angle / (2.0 * np.pi), 1.0).astype(np.float32)
    fibres = _wrapped_1d(rng, fibre_u, 96)
    fine = _fbm_row(rng, size, region, 74, octaves=2)
    iris_colour = np.array(_IRIS, dtype=np.float32).reshape(1, 1, 3) \
        + np.array(_IRIS_LIGHT, dtype=np.float32).reshape(1, 1, 3) \
        * (fibres * 0.35 + fine * 0.25 + 0.35)[..., None]
    colour = colour + (iris_colour - colour) * np.clip(iris, 0.0, 1.0)[..., None]
    # An iris darkens towards its rim.
    colour = _shade(colour, iris * _smoothstep(radius, 0.55, 1.0) * 0.30)
    colour = _shade(colour, limbus * 0.40)
    colour = colour + (np.array(_PUPIL, dtype=np.float32).reshape(1, 1, 3) - colour) * pupil[..., None]
    # Beyond the canthus the eyeball is not seen through the lid opening. The lid
    # shell reaches exactly as far as the socket is wide, so the sclera 40 to 90
    # degrees off the gaze is exposed at the corners, where the eye has neither
    # sclera nor lid but the caruncle and the conjunctiva. Painted as the vascular
    # tissue it would be: left white, the corner read as a hole in the face.
    tissue = _smoothstep(radius, 1.35, 2.20)
    colour = colour + tissue[..., None] * (np.array((0.400, 0.190, 0.170), dtype=np.float32)
                                           - colour)
    colour = colour + (tissue * np.clip(veins, 0.0, 3.0) * 0.08)[..., None]
    # Cornea: the eyeball is alone in its slot, so the dome over the iris can carry
    # the real bulge - 0.25 mm in the middle, dropping to the sclera at the limbus.
    cornea = np.exp(-((radius / 0.95) ** 4))
    height = (cornea * _relief(0.25) - pupil * _relief(0.10)
              + veins * _relief(0.01) + fibres * _relief(0.01))
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# hair and brows
# --------------------------------------------------------------------------- #


def _hair_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    if region in ("brow_L", "brow_R"):
        # An eyebrow is a different surface from the hair cap and needs its own
        # branch: the strip is 35 mm long and 6 mm tall, so its tile is mostly
        # magnified. Individual hairs run along the brow (tile u), and the mesh has
        # only two rows of vertices across its height, which means only detail that
        # varies *along* u survives the interpolation.
        clumps = _fbm_row(rng, size, region, 9, octaves=3) + 0.5 * _fbm_row(rng, size, region, 21, octaves=2)
        hairs = _wrapped_1d(rng, tu, 40) * 0.5 + _wrapped_1d(rng, tu * 1.0, 18) * 0.5
        density = np.clip(0.55 + 0.45 * clumps + 0.30 * hairs, 0.0, 1.4)
        # Towards the nose (u = 0) the brow thins out, at the temple end it fades.
        taper = np.clip(0.35 + 0.65 * np.sin(np.pi * np.clip(tu, 0.0, 1.0)) ** 0.5, 0.0, 1.0)
        # Across the brow: darker at the lower edge (v = 0), lighter towards the skin.
        edge = 0.75 + 0.25 * (1.0 - np.clip(tv, 0.0, 1.0))
        colour = np.array(_HAIR, dtype=np.float32).reshape(1, 1, 3) \
            + np.array(_HAIR_SHADE, dtype=np.float32).reshape(1, 1, 3) * (1.0 - density)[..., None] * 1.2 \
            + np.array(_HAIR_TIP, dtype=np.float32).reshape(1, 1, 3) * (density - 1.0)[..., None] * 0.5
        colour = colour + (np.array(SKIN_BASE, dtype=np.float32) - colour) \
            * np.clip(1.0 - density * taper * edge, 0.0, 1.0)[..., None] * 0.5
        # Brow hairs are 0.3 mm thick and the strip is magnified, so the ridges can be
        # painted at 1.2 mm with the strand noise in charge of where they sit.
        height = (density * _relief(1.2) + clumps * _relief(0.5) + hairs * _relief(0.4))
        return np.clip(colour, 0.0, 1.0), height.astype(np.float32)

    # Strand bundles run downwards: the noise is sampled along the tile's own
    # diagonal so the streaks follow v, whichever way the slot is unwrapped.
    strands = _fbm_row(rng, size, region, 11, octaves=3) + 0.6 * _fbm_row(rng, size, region, 5, octaves=2)
    sweeps = _fbm_row(rng, size, region, 26, octaves=2)
    dark = np.clip(0.5 + 0.60 * strands - 0.10 * sweeps, 0.0, 1.0)
    colour = np.array(_HAIR, dtype=np.float32).reshape(1, 1, 3) \
        + np.array(_HAIR_SHADE, dtype=np.float32).reshape(1, 1, 3) * (1.0 - dark)[..., None] * 1.35
    colour = colour + np.array(_HAIR_TIP, dtype=np.float32).reshape(1, 1, 3) \
        * (np.clip(dark, 0.0, 1.0) ** 2)[..., None] * 0.35
    if region == "fringe":
        # The fringe hangs over the brow: longer, darker strands on the upper half.
        heavy = np.exp(-((tv - 0.62) / 0.42) ** 2)
        colour = colour - (heavy * 0.35)[..., None] * colour
    colour = np.clip(colour, 0.0, 1.0)
    relief = _fbm_row(rng, size, region, 9, octaves=2)
    # A strand bundle is a millimetre across its own width: the hair shell carries
    # the silhouette, the map carries a couple of millimetres of bundle relief.
    height = strands * _relief(1.5) + relief * _relief(0.6)
    return colour, height.astype(np.float32)


# --------------------------------------------------------------------------- #
# jacket canvas
# --------------------------------------------------------------------------- #

#: Weave scale of the two cloth materials, in metres between two thread pairs.
#: Canvas threads sit about 1.2 mm apart and ripstop about 1.5 mm, so one warp and
#: one weft pair span 2.4 mm and 3.0 mm. The value is converted to a cell count on
#: each atlas, which keeps the weave the same real size on mobile and on pc.
_CANVAS_THREAD_PAIR = 0.0024
_RIPSTOP_THREAD_PAIR = 0.0030


def _cloth_weave(rng: np.random.Generator, size: int, region: str, pair_metres: float,
                 phase: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Warp/weft sheen of a woven fabric: returns (warp, weft, coverage, sunlight).

    ``coverage`` is the uneven cloth thickness (slubs, thin places) and
    ``sunlight`` is the low-frequency colour drift of a dyed bolt. The two thread
    directions are separate fields so the weft and the warp can be shaded and
    tinted differently, which is what makes the weave read as cloth and not as a
    checkerboard.
    """
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    cells = max(4, int(round(_pixels(size, pair_metres))))
    wobble_u = _fbm_row(rng, size, region, 7, octaves=2) * 0.035
    wobble_v = _fbm_row(rng, size, region, 9, octaves=2) * 0.035
    warp = 0.5 + 0.5 * np.sin(2.0 * np.pi * ((tu + wobble_u) * cells + 0.25))
    weft = 0.5 + 0.5 * np.sin(2.0 * np.pi * ((tv + wobble_v) * cells + 0.75))
    if phase is not None:
        warp = 0.5 + 0.5 * np.sin(2.0 * np.pi * ((tu + wobble_u) * cells + 0.25) + phase)
        weft = 0.5 + 0.5 * np.sin(2.0 * np.pi * ((tv + wobble_v) * cells + 0.75) - phase)
    coverage = np.clip(0.6 + 0.5 * _fbm_row(rng, size, region, 6, octaves=3), 0.1, 1.0)
    # Slubs: short thick places where an extra thread sits on top of the weave.
    slub = np.clip(_fbm_row(rng, size, region, 3.0, octaves=2), 0.0, 3.0)
    coverage = np.clip(coverage + np.clip(slub - 0.5, 0.0, 3.0) * 0.35, 0.1, 1.4)
    # Sunlight across the bolt: still a low frequency, but with amplitude. Cloth
    # that is mixed to within 5 % of its base colour disappears at character
    # distance - the review of the first pass said exactly that ("Stoff ohne echten
    # Gewebemaßstab"), and a 2 % weave cannot be read from three metres away.
    sunlight = _fbm_row(rng, size, region, 22, octaves=3)
    return (warp.astype(np.float32), weft.astype(np.float32), coverage.astype(np.float32),
            sunlight.astype(np.float32))


def _canvas_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    warp, weft, coverage, sunlight = _cloth_weave(rng, size, region, _CANVAS_THREAD_PAIR)
    weave = _fbm_row(rng, size, region, 12, octaves=3)
    dent = _fbm_row(rng, size, region, 5, octaves=2)
    # Warp and weft catch the light differently and that sheen is the cloth's
    # dominant texture at character distance, so the amplitude is sized to be seen:
    # the first pass mixed the weave in at 5 % of the base colour and the jacket
    # read as a smooth plastic shell in the review render.
    colour = _mix(_CANVAS, [
        (sunlight * 0.85, _CANVAS_SHADE),
        (warp * 0.60, _CANVAS_THREAD),
        (weft * 0.65, _CANVAS_THREAD),
        (weave * 0.30, _CANVAS_SHADE),
        (coverage * 0.22, _CANVAS_WORN),
        (np.clip(-dent, 0.0, 1.0) * 0.18, _CANVAS_WORN),
    ])
    # Relief in millimetres of real cloth: a canvas thread is 0.3 mm thick. The
    # first pass used amplitudes of 0.13 tile units, which is 57 mm deep and gave
    # every jacket texel a 69 degree shading normal.
    height = (warp * _relief(0.20) + weft * _relief(0.20) + coverage * _relief(0.18)
              + weave * _relief(0.12) + dent * _relief(0.10)).astype(np.float32)

    if region in ("sleeve_L", "sleeve_R"):
        # Compression folds across the sleeve: an elbow bends the cloth, so the
        # creases curve and bunch instead of running straight. Kept shallow, a
        # hard line reads as a stripe.
        bend = _fbm_row(rng, size, region, 4, octaves=2)
        creases = _lines(tv - 0.10 * np.sin(3.0 * np.pi * tu) + bend * 0.05, 1.0 / 7.0, 0.020)
        creases = creases * (0.6 + 0.4 * np.clip(bend + 0.5, 0.0, 1.0))
        colour = _shade(colour, creases * 0.14)
        colour = colour + (np.roll(creases, 3, axis=0) * 0.05)[..., None] \
            * (np.array(_CANVAS_THREAD, dtype=np.float32) - colour)
        height = height - creases * _relief(2.5) + np.roll(creases, 3, axis=0) * _relief(0.8)
    elif region in ("hood", "collar"):
        fold = np.exp(-((tv - 0.30) / 0.10) ** 2) + np.exp(-((tv - 0.76) / 0.09) ** 2)
        fold = np.clip(fold, 0.0, 1.0)
        colour = _shade(colour, fold * 0.22)
        height = height - fold * _relief(3.0)
    elif region == "quilt":
        # Diamond quilting: the diagonal stitch lines bound padded panels. The
        # panels are 8 cm across; the stitch itself is 1.5 mm wide and 1 mm proud.
        distance = np.minimum(np.abs(np.mod(tv - tu, 0.25)), np.abs(np.mod(tv + tu, 0.25)))
        distance = np.minimum(distance, 0.25 - distance)
        stitch = _seam(distance, 0.0045)
        colour = colour + (stitch * 0.75)[..., None] * (np.array(_CANVAS_STITCH, dtype=np.float32) - colour)
        height = height + stitch * _relief(1.0)
        padding = 1.0 - np.clip(distance / 0.125, 0.0, 1.0)
        height = height + padding * _relief(3.0)
        colour = colour + (padding * 0.06)[..., None]
    elif region == "zip":
        strip = np.exp(-(((tu - 0.5) / 0.075) ** 2))
        colour = colour + (strip * 0.95)[..., None] * (np.array(_METAL, dtype=np.float32) - colour)
        # Teeth are geometry-scale: a 30-tooth row over this slot is a 5 mm tooth,
        # which is what a heavy jacket zip actually has, so it is painted as teeth
        # and not as a fine texture.
        teeth = np.maximum(0.0, np.sin(2.0 * np.pi * tv * 30.0)).astype(np.float32)
        shade = _cells_for_zip(rng, size, region)
        colour = _shade(colour, strip * teeth * 0.35)
        colour = colour + (strip * teeth * shade * 0.10)[..., None]
        height = height + strip * _relief(0.8) + strip * teeth * _relief(1.5)
    elif region == "patch":
        inner = 0.20
        frame = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.075, 0.0, 1.0)
        inside = ((tu > inner) & (tu < 1.0 - inner) & (tv > inner) & (tv < 1.0 - inner)).astype(np.float32)
        colour = colour + (frame * 0.85)[..., None] * (np.array(_ACCENT, dtype=np.float32) - colour)
        colour = colour + (inside * 0.55)[..., None] * (np.array(_CANVAS_LINING, dtype=np.float32) - colour)
        badge = np.exp(-(((tv - 0.5) / 0.035) ** 2)) * (np.abs(tu - 0.5) < 0.16)
        colour = colour + (badge * 0.8)[..., None] * (np.array(_ACCENT_WORN, dtype=np.float32) - colour)
        # Patch: 1.5 mm of felt, its border stitched 2 mm proud.
        height = height + frame * _relief(2.0) + inside * _relief(1.5) + badge.astype(np.float32) * _relief(0.5)
    elif region == "grime":
        # Field dirt: soft irregular patches with a darker core and a dusty halo,
        # plus the grey sheen worn canvas gets where a pack strap rubs.
        patch = _fbm_row(rng, size, region, 6, octaves=3)
        patch = np.clip(patch * 1.5 + 0.15, 0.0, 1.0)
        core = np.clip(patch - 0.45, 0.0, 1.0) * 1.8
        halo = np.clip(patch - 0.15, 0.0, 1.0) * 0.6
        dust = np.clip(_grain(rng, size, region, 1.6, octaves=2), 0.0, 3.0)
        colour = colour + (halo * 0.30)[..., None] * (np.array((0.235, 0.215, 0.185), dtype=np.float32) - colour)
        colour = colour + (core * 0.55)[..., None] * (np.array((0.105, 0.092, 0.072), dtype=np.float32) - colour)
        colour = colour + (dust * 0.035)[..., None] * np.array((0.9, 0.85, 0.78), dtype=np.float32)
        height = height - core * _relief(0.3)

    # Edge wear: exposed threads read lighter along the slot border. The border is
    # the garment seam and every hem, so the wear sits where the buyer expects it.
    edge = np.exp(-(np.minimum(*_edge_distance(tu, tv)) / 0.045) ** 2)
    scratch = np.clip(_grain(rng, size, region, 1.8, octaves=2), 0.0, 1.0)
    wear = edge * (0.45 + 0.55 * scratch)
    colour = colour + wear[..., None] * (np.array(_CANVAS_WORN, dtype=np.float32) - colour) * 0.55
    height = height + wear * _relief(0.6)
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


def _cells_for_zip(rng: np.random.Generator, size: int, region: str) -> np.ndarray:
    """Loose grain behind the zip teeth."""
    return np.clip(_fbm_row(rng, size, region, 9, octaves=2), 0.0, 1.0)


# --------------------------------------------------------------------------- #
# ripstop trousers
# --------------------------------------------------------------------------- #


def _ripstop_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    warp, weft, coverage, sunlight = _cloth_weave(rng, size, region, _RIPSTOP_THREAD_PAIR)
    noise = _fbm_row(rng, size, region, 12, octaves=3)
    # The rip grid is a real feature of the fabric and coarse enough to paint: the
    # reinforcing threads sit every 4 mm, which is one diamond per 2.7 px here.
    rip = _lines(tu + tv, 1.0 / 6.0, 0.0030) + _lines(tv - tu, 1.0 / 6.0, 0.0030)
    # Contrast sized to be read at character distance, see _canvas_tile.
    colour = _mix(_RIPSTOP, [
        (sunlight * 0.80, _RIPSTOP_SHADE),
        (np.clip(rip, 0.0, 1.0) * 0.45, _RIPSTOP_THREAD),
        (warp * 0.42 + weft * 0.42, _RIPSTOP_THREAD),
        (noise * 0.30, _RIPSTOP_SHADE),
        (coverage * 0.20, _RIPSTOP_REINFORCED),
    ])
    # 0.35 mm of rip thread over the 0.2 mm of the base cloth.
    height = (np.clip(rip, 0.0, 1.0) * _relief(0.35) + warp * _relief(0.15) + weft * _relief(0.15)
              + coverage * _relief(0.15) + noise * _relief(0.20)).astype(np.float32)

    if region == "knee_pad":
        # Reinforcement panel: darker, denser weave, stitched border.
        panel = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.06, 0.0, 1.0)
        colour = colour + (panel * 0.75)[..., None] * (np.array(_RIPSTOP_REINFORCED, dtype=np.float32) - colour)
        border = _seam(np.minimum(*_edge_distance(tu, tv)) - 0.06, 0.006)
        colour = colour + (border * 0.6)[..., None] * (np.array(_RIPSTOP_THREAD, dtype=np.float32) - colour)
        height = height + panel * _relief(1.2) + border * _relief(1.0)
    elif region == "pocket":
        distance = np.minimum(*_edge_distance(tu, tv))
        seam = _seam(np.abs(distance - 0.10), 0.006)
        mouth = _seam(tv - 0.30, 0.008)
        colour = colour + (seam * 0.55)[..., None] * (np.array(_RIPSTOP_THREAD, dtype=np.float32) - colour)
        colour = _shade(colour, mouth * 0.35)
        height = height + seam * _relief(0.8) - mouth * _relief(1.2)
    elif region == "cuff":
        band = _lines(tv, 1.0 / 4.0, 0.010)
        colour = _shade(colour, band * 0.18)
        height = height - band * _relief(1.0)
    elif region == "stitch":
        # Double topstitch of a real seam: two rows of short stitches, each one a
        # slanted thread with a shadow at both ends and a little irregularity.
        stitch = np.zeros_like(tu, dtype=np.float32)
        for row in (0.5 - 0.22, 0.5 + 0.22):
            line = np.exp(-((tv - row) / 0.010) ** 2)
            along = tu * 34.0
            cell = np.floor(along)
            phase = along - cell
            thread = _seam(np.abs(phase - 0.5), 0.16)
            jitter = _wrapped_1d(rng, tu, 34) * 0.06
            stitch = np.maximum(stitch, (line * thread * (0.7 + 0.3 * jitter)).astype(np.float32))
        thread_colour = np.array(_RIPSTOP_THREAD, dtype=np.float32)
        colour = colour + (np.clip(stitch, 0.0, 1.0) * 0.80)[..., None] * (thread_colour * 1.35 - colour)
        colour = _shade(colour, np.clip(stitch - 0.5, 0.0, 1.0) * 0.25)
        height = height + stitch * _relief(0.9)
    elif region == "seam":
        # A raised fold of cloth: a ridge, a compression shadow on either side and
        # the frayed thread ends where the fold has been abraded.
        path = 0.5 + 0.10 * np.sin(2.0 * np.pi * (tu * 1.5 + 0.2)) \
            + 0.4 * _fbm_row(rng, size, region, 5, octaves=2)
        ridge = _seam(tv - path, 0.014)
        side = _seam(np.abs(tv - path) - 0.045, 0.018)
        fray = np.clip(_grain(rng, size, region, 1.7, octaves=2) - 0.55, 0.0, 3.0)
        colour = _shade(colour, np.clip(side, 0.0, 1.0) * 0.20)
        colour = colour + (ridge * 0.45)[..., None] * (np.array(_RIPSTOP_THREAD, dtype=np.float32) - colour)
        colour = colour + (fray * ridge * 0.25)[..., None] * np.array((0.9, 0.9, 0.88), dtype=np.float32)
        height = height + ridge * _relief(1.5) - side * _relief(1.0)
    elif region == "worn":
        # Abrasion sheet: a patchy mask of rubbed-through cloth. The fibres lose
        # their dye first, so the worn areas go lighter and lose their relief.
        patch = _fbm_row(rng, size, region, 7, octaves=3)
        mask = _smoothstep(patch, -0.10, 0.35)
        fibre = np.clip(_grain(rng, size, region, 1.5, octaves=2), 0.0, 3.0)
        pill = np.clip(fibre - 0.9, 0.0, 3.0)
        colour = colour + (mask * 0.40)[..., None] * (np.array((0.290, 0.300, 0.315), dtype=np.float32) - colour)
        colour = colour + (pill * mask * 0.30)[..., None] * np.array((0.78, 0.79, 0.80), dtype=np.float32)
        height = height + mask * _relief(0.3) + pill * _relief(0.4)

    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# leather kit
# --------------------------------------------------------------------------- #


def _leather_grain(rng: np.random.Generator, size: int, region: str,
                   warp: float = 0.10, coarse_metres: float = 0.016,
                   fine_metres: float = 0.005) -> np.ndarray:
    """Full-grain surface: cells, fine creases and the pebble between them.

    The two cell scales are given in metres of hide, then converted to pixels, so
    the grain keeps its real size on every atlas. That matters more than it looks:
    a real hide cell is about 5 mm, and 5 mm is 23 px on the 2048 atlas but 12 px
    on mobile - painted at a fixed pixel count the coarse cells fell to 1.6 px on
    the pc atlas and dissolved into the mip as flat brown.

    ``warp`` displaces the cell pattern so the grain runs slightly diagonally
    across the slot; a hide is never ruled straight.
    """
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    skew_u = _fbm_row(rng, size, region, 7, octaves=2) * warp
    skew_v = _fbm_row(rng, size, region, 8, octaves=2) * warp
    shift_u = np.clip(tu + skew_u, 0.0, 1.0)
    shift_v = np.clip(tv + skew_v, 0.0, 1.0)
    coarse_cells = max(3, int(round(_pixels(size, coarse_metres))))
    fine_cells = max(6, int(round(_pixels(size, fine_metres))))
    distance = _cellular(rng, (shift_u * coarse_cells).astype(np.float32),
                         (shift_v * coarse_cells).astype(np.float32), coarse_cells)
    fine_distance = _cellular(rng, (shift_u * fine_cells).astype(np.float32),
                              (shift_v * fine_cells).astype(np.float32), fine_cells)
    return (1.0 - np.clip(distance * 3.0, 0.0, 1.0)) * 0.70 \
        + (1.0 - np.clip(fine_distance * 2.5, 0.0, 1.0)) * 0.30


def _leather_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    grain = _leather_grain(rng, size, region).astype(np.float32)
    fine = _grain(rng, size, region, 1.6, octaves=2)
    creases = np.clip(_fbm_row(rng, size, region, 8, octaves=2), 0.0, 3.0)
    creases = np.clip(creases - 0.55, 0.0, 3.0) * 0.7
    # The grain carries the material, so it gets a real weight in the colour: the
    # first pass mixed it in at a fifth and the flat slots read as plain brown.
    colour = _mix(_LEATHER, [
        (grain * 0.62, _LEATHER_SHADE),
        (np.clip(fine, 0.0, 1.0) * 0.22, _LEATHER_WORN),
        (creases * 0.30, _LEATHER_SHADE),
    ])
    # Grain 0.6 mm at the cell walls, creases half a millimetre deep: a hide is
    # rough at the tenth-of-a-millimetre scale, not at the centimetre scale.
    height = (grain * _relief(0.60) + np.clip(fine, 0.0, 1.0) * _relief(0.15)
              - creases * _relief(0.50)).astype(np.float32)

    if region == "boots":
        # Toe cap and instep take the polish: a broad sheen with its own highlight,
        # plus the scuffing and the deep bending creases across the vamp.
        highlight = np.exp(-(((tv - 0.78) / 0.06) ** 2))
        cap = np.exp(-(((tv - 0.20) / 0.10) ** 2)) * np.exp(-(((tu - 0.5) / 0.30) ** 2))
        scuff = np.clip(_fbm_row(rng, size, region, 5, octaves=3) - 0.25, 0.0, 2.0)
        scratches = _empty_tile(size, region, channels=0)
        direction = _grain(rng, size, region, 1.2, octaves=1)
        for _ in range(9):
            angle = float(rng.uniform(-0.5, 0.5))
            offset = float(rng.uniform(-0.6, 0.6))
            position = tv - offset - angle * (tu - 0.5) + direction * 0.01
            scratches = np.maximum(scratches, _seam(position, float(rng.uniform(0.0010, 0.0022))))
        colour = colour + ((highlight * 0.35 + cap * 0.30) * (0.35 + 0.65 * scuff))[..., None] \
            * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        colour = colour + (scratches * 0.30)[..., None] * (np.array((0.52, 0.42, 0.32), dtype=np.float32) - colour)
        creases_vamp = _lines(tv - 0.55 + 0.06 * np.sin(4.0 * np.pi * tu), 1.0 / 5.0, 0.014)
        colour = _shade(colour, creases_vamp * 0.18)
        height = (height + highlight * _relief(0.4) + cap * _relief(0.8)
                  - scratches * _relief(0.3) - creases_vamp * _relief(1.2))
    elif region == "boot_sole":
        # Lug profile: the ribs run across the sole, each lug has a groove in its
        # face and the tread is rounded off at the edges where the rubber is worn.
        lugs = np.maximum(0.0, np.sin(2.0 * np.pi * tu * 7.0)).astype(np.float32)
        groove = _lines(tu, 1.0 / 7.0, 0.006)
        roll = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.09, 0.0, 1.0)
        wear = np.clip(_fbm_row(rng, size, region, 8, octaves=2), 0.0, 1.0)
        stone = np.clip(_grain(rng, size, region, 1.8, octaves=2), 0.0, 3.0)
        colour = _mix(_SOLE, [
            (lugs * 0.55, _SOLE_WORN),
            (wear * 0.25, _SOLE_WORN),
            (stone * roll * 0.18, _SOLE_WORN),
        ])
        colour = _shade(colour, groove * 0.45)
        height = (lugs * _relief(3.0) - groove * _relief(2.5) + wear * _relief(0.6)
                  - (1.0 - roll) * _relief(1.5)).astype(np.float32)
    elif region == "boot_cuff":
        # Collar fold plus the laces' cross wear on the tongue side. The fold is
        # painted, not only shaded: a plain leather slot reads as flat, and this
        # tile is the part of the boot that is always in view.
        pleat = np.exp(-((tv - 0.45) / 0.09) ** 2)
        roll = _seam(np.abs(tv - 0.45) - 0.16, 0.05)
        colour = _shade(colour, np.clip(pleat * 0.30 + roll * 0.18, 0.0, 1.0))
        colour = colour + (roll * 0.22)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        height = height - pleat * _relief(2.0) + roll * _relief(1.0)
    elif region == "laces":
        # Two twisted cords over the tongue; the braid is the visible texture. A
        # lace is 3 mm across, so the cord really is a shape and not a noise field.
        cord = 0.5 + 0.5 * np.sin(2.0 * np.pi * (0.5 * tv + 3.0 * tu))
        cord = cord.astype(np.float32)
        line = _lines(tu - 0.5, 1.0 / 3.0, 0.085) + _lines(tu - 0.18, 1.0 / 3.0, 0.085)
        line = np.clip(line, 0.0, 1.0)
        base_colour = np.array(_LEATHER_SHADE, dtype=np.float32).reshape(1, 1, 3)
        lace_colour = np.array(_LACE, dtype=np.float32).reshape(1, 1, 3) * (0.70 + 0.55 * cord)[..., None]
        colour = base_colour + (lace_colour - base_colour) * line[..., None]
        fuzzy = np.clip(_grain(rng, size, region, 1.5, octaves=2), 0.0, 3.0)
        colour = colour + (line * fuzzy * 0.05)[..., None] * np.array((0.9, 0.85, 0.75), dtype=np.float32)
        height = line * _relief(1.5) * (0.75 + 0.25 * cord)
    elif region == "gloves":
        knuckle = np.exp(-((tu - 0.5) / 0.42) ** 2) * np.exp(-((tv - 0.72) / 0.14) ** 2)
        colour = colour + (knuckle * 0.16)[..., None]
        height = height + knuckle * _relief(2.0)
    elif region == "glove_palm":
        # Palm side: the grip creases are worn smooth by abrasion, so they are
        # shallow and slightly irregular but still clearly readable. Three creases
        # over the hand, which is what a leather glove actually has.
        wobble = _fbm_row(rng, size, region, 6, octaves=2) * 0.04
        creases = _lines(tv - 0.12 * np.sin(4.0 * np.pi * tu) + wobble, 1.0 / 3.0, 0.016)
        mask = np.clip(creases, 0.0, 1.0)
        colour = _shade(colour, mask * 0.80)
        colour = colour + (mask * 0.45)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        height = height - mask * _relief(2.5)
    elif region == "glove_knuckle":
        pad = np.clip(1.0 - np.hypot(tu - 0.5, (tv - 0.5) * 1.15) / 0.34, 0.0, 1.0)
        colour = colour + (pad * 0.25)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        seam = _seam(np.abs(np.hypot(tu - 0.5, (tv - 0.5) * 1.15) - 0.34), 0.008)
        height = height + pad * _relief(1.5) + seam * _relief(1.2)
    elif region == "belt":
        band = np.exp(-(((tv - 0.5) / 0.42) ** 4))
        colour = colour * (0.55 + 0.45 * band)[..., None]
        holes = np.zeros_like(tu)
        for index in range(6):
            centre = (index + 0.5) / 6.0
            holes = np.maximum(holes, np.exp(-((np.hypot((tu - centre) * 0.55, (tv - 0.5) * 0.55) / 0.026) ** 2)))
        hole_body = (holes > 0.55).astype(np.float32)
        edge = np.clip(1.0 - np.abs(holes - 0.55) / 0.45, 0.0, 1.0) * (1.0 - hole_body)
        colour = colour + (hole_body * 0.9)[..., None] * (np.array(_LEATHER_SHADE, dtype=np.float32) * 0.5 - colour)
        colour = colour + (edge * 0.6)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        # Belt 4 mm thick, punched holes 4 mm wide: both are real geometry scale.
        height = height + edge * _relief(1.5) - hole_body * _relief(4.0)
    elif region in ("pouch_A", "pouch_B"):
        # Flap, seam and the fold where the pouch bulges: the bulge is why this
        # slot exists, so it is painted with real contrast and not only with a
        # two-pixel seam line.
        distance = np.minimum(*_edge_distance(tu, tv))
        seam = _seam(np.abs(distance - 0.08), 0.008)
        flap = _seam(tv - 0.32, 0.014)
        bulge = np.clip(_fbm_row(rng, size, region, 9, octaves=2) * 1.6 + 0.3, 0.0, 1.0)
        colour = colour + (seam * 0.70 + flap * 0.55)[..., None] * np.array(_LEATHER_SHADE, dtype=np.float32)
        colour = colour + (bulge * 0.30)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        height = height + seam * _relief(1.2) + flap * _relief(2.0) + bulge * _relief(1.5)
    elif region == "holster":
        seam = _seam(np.abs(np.minimum(*_edge_distance(tu, tv)) - 0.07), 0.006)
        strap = _seam(tu - 0.30, 0.035) + _seam(tv - 0.74, 0.030)
        strap = np.clip(strap, 0.0, 1.0)
        colour = colour + (seam * 0.45)[..., None] * np.array(_LEATHER_SHADE, dtype=np.float32)
        colour = colour + (strap * 0.55)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32) - colour)
        height = height + seam * _relief(1.2) + strap * _relief(2.0)
    elif region == "rivet":
        # A field of dome rivets with a shaft shadow, plus the leather that was
        # pushed up around each head. Rivet heads are 6 mm across and 2 mm high.
        rivet_cells = max(2, int(round(_pixels(size, 0.06))))
        field = _bump(rng, size, region, rivet_cells, 0.055)
        head = np.clip(field * 1.9, 0.0, 1.0)
        stem = np.clip(field * 1.2 - 0.35, 0.0, 1.0)
        polish = np.exp(-(((tu - 0.5) * 0.5) ** 2 + ((tv - 0.5) * 0.5) ** 2))
        metal = np.array(_METAL, dtype=np.float32).reshape(1, 1, 3)
        colour = colour + head[..., None] * (metal * (0.72 + 0.28 * polish)[..., None] - colour)
        colour = _shade(colour, np.clip(stem * 1.4 - head, 0.0, 1.0) * 0.45)
        # Scratched metal: rivets get hit, so their heads carry short bright cuts.
        cut = np.clip(_grain(rng, size, region, 1.3, octaves=1), 0.0, 3.0)
        cut = np.clip(cut - 1.1, 0.0, 3.0)
        colour = colour + (cut * head * 0.35)[..., None] * np.array((0.88, 0.89, 0.92), dtype=np.float32)
        height = height + head * _relief(2.0) + stem * _relief(0.4) - cut * _relief(0.1)
    elif region == "buckle":
        # Frame and tongue of a side-release buckle: a raised rim with a recessed
        # centre where the strap runs through. Frame 3 mm proud, recess 2 mm deep.
        distance = np.minimum(*_edge_distance(tu, tv))
        frame = np.clip(1.0 - distance / 0.075, 0.0, 1.0)
        outer = np.clip(1.0 - distance / 0.030, 0.0, 1.0)
        tongue = _seam(tu - 0.5, 0.030) * np.clip((tv - 0.35) * 3.0, 0.0, 1.0)
        bar = _seam(tv - 0.78, 0.045)
        metal = np.array(_METAL, dtype=np.float32).reshape(1, 1, 3)
        polish = np.exp(-(((tu - 0.5) / 0.45) ** 2 + ((tv - 0.5) / 0.45) ** 2))[..., None]
        colour = colour + np.clip(frame + outer + tongue + bar, 0.0, 1.0)[..., None] \
            * (metal * (0.70 + 0.30 * polish) - colour)
        colour = _shade(colour, (1.0 - frame) * 0.55)
        height = (height + np.clip(frame * 0.70 + outer * 0.35 + tongue * 0.40 + bar * 0.35, 0.0, 1.2) * _relief(3.0)
                  - (1.0 - frame) * _relief(2.0))
    elif region == "tread":
        # Sole tread: longitudinal ribs with a sharp shoulder, groove and a
        # rounded, worn edge, plus stones pressed into the soft rubber. The ribs
        # are spaced 2 cm, which is a realistic 5 mm lug pair; a 1 cm lug would be
        # 40 ribs over this slot and alias into stripes.
        rib_count = max(2, int(round(_pixels(size, 0.02))))
        ribs = np.maximum(0.0, np.sin(2.0 * np.pi * tu * rib_count)).astype(np.float32)
        shoulder = _lines(tu, 1.0 / rib_count, 0.012)
        cross = _lines(tv, 1.0 / 8.0, 0.008) * 0.4
        roll = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.10, 0.0, 1.0)
        stone = np.clip(_grain(rng, size, region, 1.7, octaves=2), 0.0, 3.0)
        pebble = np.clip(stone - 0.9, 0.0, 3.0)
        colour = _mix(_SOLE, [
            (np.clip(ribs * 0.8 + shoulder * 0.4, 0.0, 1.0) * 0.75, _SOLE_WORN),
            (pebble * roll * 0.25, _SOLE_WORN),
        ])
        colour = _shade(colour, (shoulder + cross) * 0.55 * roll)
        height = (ribs * _relief(4.0) + shoulder * _relief(1.0) - cross * _relief(2.0)
                  + pebble * _relief(0.5) - (1.0 - roll) * _relief(2.0)).astype(np.float32)
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# accents, straps and metal
# --------------------------------------------------------------------------- #


def _accent_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    weather = np.clip(_fbm_row(rng, size, region, 10, octaves=3), -1.0, 1.0)
    colour = _mix(_ACCENT, [
        (np.clip(weather * 0.6 + 0.3, 0.0, 1.0) * 0.45, _ACCENT_WORN),
        (np.clip(-weather * 0.6, 0.0, 1.0) * 0.35, _ACCENT_SHADE),
    ])
    height = (weather * _relief(0.5)).astype(np.float32)

    if region == "straps":
        # A webbing strap: the band is raised, the edges are turned over and the
        # stitch rows sit on both sides. Strap 1.5 mm proud, edges 2.5 mm thick.
        band = np.exp(-(((tv - 0.5) / 0.34) ** 4))
        edge = _seam(np.abs(tv - 0.5) - 0.34, 0.05)
        # Webbing, not flat tape: the longitudinal ribs are what a nylon strap
        # actually shows, and without them the slot is one flat colour.
        ribs = 0.5 + 0.5 * np.sin(2.0 * np.pi * tv * max(4.0, _pixels(size, 0.004)))
        colour = colour * (0.50 + 0.50 * band)[..., None]
        # Webbing again, this time as the wear it collects: a strap is the part of
        # the kit that rubs against buckles and dirt, so it carries the strongest
        # tonal variation of the accent material.
        grime = _fbm_row(rng, size, region, 11, octaves=3)
        colour = _shade(colour, np.clip(grime * 0.8 + 0.2, 0.0, 1.0) * 0.35)
        colour = _shade(colour, (1.0 - ribs) * band * 0.60)
        colour = colour + (edge * 0.75)[..., None] * (np.array(_ACCENT_WORN, dtype=np.float32) - colour)
        stitch = _lines(tv - 0.30, 1.0, 0.006) + _lines(tv - 0.70, 1.0, 0.006)
        stitch = np.clip(stitch, 0.0, 1.0)
        colour = _shade(colour, stitch * 0.45)
        height = height - stitch * _relief(0.8) + band * _relief(1.5) - edge * _relief(1.0) \
            + (1.0 - ribs) * band * _relief(0.4)
    elif region in ("accent_L", "accent_R"):
        rim = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.07, 0.0, 1.0)
        colour = colour + (rim * 0.35)[..., None] * (np.array(_ACCENT_WORN, dtype=np.float32) - colour)
        height = height + rim * _relief(1.0)
    elif region == "accent":
        arm = np.exp(-((np.abs(tu - 0.5) - 0.24) / 0.055) ** 2)
        colour = _shade(colour, arm * 0.45)
        height = height - arm * _relief(1.5)
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


def _metal_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    tone = _fbm_row(rng, size, region, 6, octaves=3)
    polish = _fbm_row(rng, size, region, 14, octaves=2)
    colour = np.clip(np.array(_METAL, dtype=np.float32).reshape(1, 1, 3)
                     + (tone * 0.10 + polish * 0.04)[..., None], 0.0, 1.0)
    scratches = _empty_tile(size, region, channels=0)
    for _ in range(14):
        angle = float(rng.uniform(-0.9, 0.9))
        offset = float(rng.uniform(-1.0, 1.0))
        position = tv - offset - angle * (tu - 0.5)
        scratches = np.maximum(scratches, _seam(position, float(rng.uniform(0.0015, 0.0040))))
    # A few short cuts that stop inside the slot: brush marks, not full lines.
    # The cut runs along the v axis, so its window is the v coordinate.
    cuts = _empty_tile(size, region, channels=0)
    for _ in range(6):
        angle = float(rng.uniform(-1.2, 1.2))
        offset = float(rng.uniform(-0.8, 0.8))
        start = float(rng.uniform(0.0, 0.8))
        span = float(rng.uniform(0.15, 0.45))
        position = tu - offset - angle * (tv - 0.5)
        window = _smoothstep(tv, start, start + 0.02) \
            * (1.0 - _smoothstep(tv, start + span, start + span + 0.02))
        cuts = np.maximum(cuts, _seam(position, float(rng.uniform(0.0012, 0.0025))) * window)
    bright = np.array((0.86, 0.87, 0.90), dtype=np.float32).reshape(1, 1, 3)
    colour = colour + (scratches * 0.35 + cuts * 0.40)[..., None] * (bright - colour)
    # Edge of the part: a buckle blank is stamped, so its rim is rubbed bright
    # while the recesses behind it collect dark grime.
    border = np.exp(-(np.minimum(*_edge_distance(tu, tv)) / 0.035) ** 2)
    grime = np.clip(_fbm_row(rng, size, region, 7, octaves=2) - 0.35, 0.0, 2.0)
    colour = colour + (border * 0.30)[..., None] * (bright - colour)
    colour = _shade(colour, grime * 0.22)
    # Scratches are 0.1 mm deep scribes, the stamped rim is 0.3 mm proud and the
    # grime film is thinner still. Metal is smooth: a deep scratch here would read
    # as a dent, which is the wrong story for a buckle.
    height = (-scratches * _relief(0.10) - cuts * _relief(0.08) + tone * _relief(0.15)
              - grime * _relief(0.08) + border * _relief(0.30)).astype(np.float32)
    if region == "metal_dark":
        colour = colour * 0.55
    return np.clip(colour, 0.0, 1.0), height


# --------------------------------------------------------------------------- #
# colour tables
# --------------------------------------------------------------------------- #

_CANVAS = (0.145, 0.160, 0.140)
_CANVAS_THREAD = (0.196, 0.210, 0.186)
_CANVAS_WORN = (0.290, 0.286, 0.250)
_CANVAS_SHADE = (0.095, 0.108, 0.094)
_CANVAS_STITCH = (0.330, 0.310, 0.260)
_CANVAS_LINING = (0.190, 0.185, 0.150)
_METAL = (0.62, 0.63, 0.66)

_RIPSTOP = (0.085, 0.092, 0.105)
_RIPSTOP_THREAD = (0.130, 0.138, 0.152)
_RIPSTOP_REINFORCED = (0.053, 0.058, 0.068)
_RIPSTOP_SHADE = (0.055, 0.060, 0.070)

_LEATHER = (0.070, 0.052, 0.042)
_LEATHER_SHADE = (0.038, 0.028, 0.023)
_LEATHER_WORN = (0.165, 0.128, 0.098)
_SOLE = (0.035, 0.034, 0.033)
_SOLE_WORN = (0.082, 0.079, 0.074)
_LACE = (0.185, 0.150, 0.110)

_HAIR = (0.075, 0.055, 0.042)
_HAIR_SHADE = (0.032, 0.024, 0.019)
_HAIR_TIP = (0.148, 0.110, 0.076)

_ACCENT = (0.520, 0.180, 0.062)
_ACCENT_WORN = (0.660, 0.310, 0.135)
_ACCENT_SHADE = (0.260, 0.090, 0.030)

_SCLERA = (0.820, 0.815, 0.800)
_IRIS = (0.085, 0.098, 0.055)
_IRIS_LIGHT = (0.140, 0.150, 0.070)
_PUPIL = (0.014, 0.014, 0.016)


# --------------------------------------------------------------------------- #
# dispatch
# --------------------------------------------------------------------------- #

_TILE_PAINTERS = {
    "Skin": _skin_tile,
    "Hair": _hair_tile,
    "Eye": _eye_tile,
    "Jacket": _canvas_tile,
    "Trousers": _ripstop_tile,
    "Leather": _leather_tile,
    "Accent": _accent_tile,
    "Metal": _metal_tile,
}


def _tile_seed(seed: int, material: str, region: str, purpose: str) -> int:
    """Fold seed, material, region and purpose into one stable integer."""
    text = f"{seed}:{material}:{region}:{purpose}".encode("utf-8")
    value = 0x811C9DC5
    for byte in text:
        value = ((value ^ byte) * 0x01000193) & 0xFFFFFFFF
    return value


def _owner_words(material: str) -> frozenset[str]:
    for name, words in _OWNER_WORDS:
        if name == material:
            return frozenset(words)
    return frozenset()


def _material_regions(material: str) -> tuple[str, ...]:
    """Atlas slots one material paints.

    The explicit table wins, then the material's own words, so a slot the spec
    grows before this module knows it is still painted instead of left black. A
    slot that no rule claims is painted by every material: an unused slot renders
    as whatever material happens to reach it, and black is the one answer that is
    always wrong.
    """
    known = tuple(spec.REGIONS)
    table = PAINTED_REGIONS.get(material)
    if table is not None:
        picked = tuple(region for region in table if region in spec.REGIONS)
        if picked:
            return picked
    words = _owner_words(material)
    picked = tuple(region for region in known
                   if region not in _SPARE_SLOTS and any(word in region for word in words))
    if picked:
        return picked
    return tuple(region for region in known if region not in _SPARE_SLOTS)


def _texture_size(variant: spec.Variant, material: str) -> int:
    return variant.skin_texture_size if material == "Skin" else variant.texture_size


def _fill(image_data: np.ndarray, tile: np.ndarray, region: str, divisions: int = 8) -> None:
    """Copy one painted slot into the atlas at the pixel range its UVs own.

    Colour tiles carry three channels, the atlas four; the alpha channel keeps the
    value the image was created with. Height tiles are single channel.
    """
    left, bottom, right, top = _slot_pixels(image_data.shape[1], region, divisions)
    if tile.ndim == 3:
        image_data[bottom:top, left:right, :tile.shape[2]] = tile
    else:
        image_data[bottom:top, left:right] = tile


# --------------------------------------------------------------------------- #
# height -> normal
# --------------------------------------------------------------------------- #


def _blur(values: np.ndarray, radius: int = 1) -> np.ndarray:
    """Separable 1-2-1 blur, wrapping in u and clamping in v.

    The u axis wraps because a slot is one lattice period around the head; the v
    axis does not, so it is clamped at the slot border instead.
    """
    kernel = np.array((0.25, 0.5, 0.25), dtype=np.float32)
    result = values.astype(np.float32)
    for _ in range(radius):
        padded = np.pad(result, ((0, 0), (1, 1)), mode="wrap")
        result = kernel[0] * padded[:, :-2] + kernel[1] * padded[:, 1:-1] + kernel[2] * padded[:, 2:]
        padded = np.pad(result, ((1, 1), (0, 0)), mode="edge")
        result = kernel[0] * padded[:-2] + kernel[1] * padded[1:-1] + kernel[2] * padded[2:]
    return result


def _normal_map(height: np.ndarray, strength: float, relief: float, radius: int = 1) -> np.ndarray:
    """Tangent space normals from a height field; the u axis is periodic.

    The height is written in *tile* units - one unit spans the whole slot, which is
    ``SLOT_SPAN_METRES`` of surface - while the gradient is taken from one texel to
    the next. A texel is ``1 / width`` of a tile unit, so the slope of the surface is
    ``dh * width``, not ``dh``. Without that factor every normal map this module
    wrote was flat to within half a grey level: measured on the shipped maps, the
    whole Leather atlas varied by 0.0019 around 0.5, and no painted fold, crease or
    seam could show in a render however deep it was painted. That is also why the
    skull used to be painted without relief - there was no point, the relief never
    arrived.

    The height is smoothed first: single-texel spikes of the grain and cell noise
    would otherwise turn into the sparkle that reads as film grain on a smooth
    surface. Everything wider than two texels - pores, creases, seams - survives
    the blur and stays in the normal.
    """
    smooth = _blur(height.astype(np.float32), radius)
    height_px, width_px = smooth.shape
    padded = np.pad(smooth, ((0, 0), (1, 1)), mode="wrap")
    slope_x = (padded[:, 2:] - padded[:, :-2]) * 0.5 * float(width_px)
    padded = np.pad(smooth, ((1, 1), (0, 0)), mode="edge")
    slope_y = (padded[:-2] - padded[2:]) * 0.5 * float(height_px)
    normal = np.empty(height.shape + (3,), dtype=np.float32)
    normal[..., 0] = -slope_x * strength * relief
    normal[..., 1] = -slope_y * strength * relief
    normal[..., 2] = 1.0
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-8)
    return normal * 0.5 + 0.5


# --------------------------------------------------------------------------- #
# images
# --------------------------------------------------------------------------- #


def _new_image(name: str, size: int, colour_space: str) -> bpy.types.Image:
    """Fetch or create the atlas image for a material slot.

    Two Blender traps sit here, both about generated images losing their pixels:

    * ``colorspace_settings.name`` may only be assigned on a *fresh* image. On an
      image that already holds data the assignment rebuilds the buffer from the
      (empty) original and throws the paint away.
    * ``generated_color`` likewise resets the buffer, so it is set once at
      creation and never again.
    """
    image = bpy.data.images.get(name)
    if image is not None and tuple(image.size) != (size, size):
        bpy.data.images.remove(image)
        image = None
    if image is None:
        image = bpy.data.images.new(name, width=size, height=size, alpha=True)
        image.colorspace_settings.name = colour_space
        image.generated_color = (0.0, 0.0, 0.0, 1.0)
    return image


def _save_image(image: bpy.types.Image, path: Path, *, non_colour: bool) -> str:
    image.file_format = "PNG"
    image.filepath_raw = str(path)
    image.save()
    return str(path)


def _write_image(image: bpy.types.Image, data: np.ndarray) -> None:
    image.pixels.foreach_set(np.ascontiguousarray(data, dtype=np.float32).ravel())
    image.update()


# --------------------------------------------------------------------------- #
# node wiring
# --------------------------------------------------------------------------- #


def _texture_node(material: bpy.types.Material, image: bpy.types.Image) -> bpy.types.ShaderNode:
    """One image node per image: a second call reuses the first, never doubles it."""
    nodes = material.node_tree.nodes
    node = nodes.get(image.name)
    if node is not None and node.bl_idname != "ShaderNodeTexImage":
        nodes.remove(node)
        node = None
    if node is None:
        node = nodes.new("ShaderNodeTexImage")
        node.name = image.name
        node.label = "BaseColor" if image.name.endswith("_BaseColor") else "Normal"
    node.image = image
    return node


def _wire(material: bpy.types.Material, base_colour: bpy.types.Image,
          normal: bpy.types.Image, strength: float) -> None:
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = next((node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if bsdf is None:
        raise RuntimeError(f"{material.name}: no Principled BSDF to wire into")

    base_node = _texture_node(material, base_colour)
    links.new(base_node.outputs["Color"], bsdf.inputs["Base Color"])
    base_node.location = (bsdf.location.x - 620.0, bsdf.location.y + 180.0)

    normal_node = _texture_node(material, normal)
    normal_node.location = (bsdf.location.x - 620.0, bsdf.location.y - 240.0)
    mapper = nodes.get(f"{material.name}_NormalMap")
    if mapper is None:
        mapper = nodes.new("ShaderNodeNormalMap")
        mapper.name = f"{material.name}_NormalMap"
        mapper.label = "Normal"
    mapper.location = (bsdf.location.x - 280.0, bsdf.location.y - 240.0)
    mapper.inputs["Strength"].default_value = 1.0
    mapper.space = "TANGENT"
    links.new(normal_node.outputs["Color"], mapper.inputs["Color"])
    links.new(mapper.outputs["Normal"], bsdf.inputs["Normal"])
    material["mercScoutNormalStrength"] = float(strength)
    material["mercScoutNormalScale"] = float(NORMAL_RELIEF)


# --------------------------------------------------------------------------- #
# public entry point
# --------------------------------------------------------------------------- #


def paint_and_wire(variant: spec.Variant, materials: dict[str, bpy.types.Material], *,
                   texture_dir, seed: int = 20260930,
                   slot_usage: dict[str, set[str]] | None = None) -> dict[str, str]:
    """Paint one BaseColor and one Normal PNG per painted material and wire them.

    ``texture_dir`` is created if missing. The returned mapping is
    ``{material_name: {"basecolor": path, "normal": path}}`` with both entries as
    strings. Calling the function twice on the same materials rewires the same
    nodes instead of stacking a second set.

    The directory is resolved to an absolute path before anything is written:
    ``Image.save()`` reports success but writes nothing for a plain relative path,
    because Blender reads those relative to the blend file, and that file does not
    exist yet while the character is being generated.

    Roughness is *not* painted here. Blender writes glTF ``roughnessFactor`` as a
    constant unless the roughness comes from an image wired the way its exporter
    recognises, and a third atlas per material costs 30 to 50 % file size for a
    channel the engine can synthesise from the base colour. See the generator
    report for the measurement behind that decision.
    """
    directory = Path(texture_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)

    written: dict[str, dict[str, str]] = {}
    for material_spec in spec.MATERIALS:
        name = material_spec.name
        if not material_spec.painted or name not in materials:
            continue
        material = materials[name]
        size = _texture_size(variant, name)
        painter = _TILE_PAINTERS[name]
        # Both images are created empty first: the colour space has to be in place
        # before any pixel is written, see _new_image.
        base_image = _new_image(f"{name}_BaseColor", size, "sRGB")
        normal_image = _new_image(f"{name}_Normal", size, "Non-Color")

        base = np.zeros((size, size, 4), dtype=np.float32)
        base[..., 3] = 1.0
        height = np.zeros((size, size), dtype=np.float32)
        regions = set(_material_regions(name)) | (slot_usage or {}).get(name, set())
        for region in sorted(regions):
            rng = np.random.default_rng(_tile_seed(seed, name, region, "paint"))
            colour, relief = painter(rng, size, region)
            _fill(base, colour, region)
            _fill(height, _stretch(relief, 2.5), region)

        _write_image(base_image, np.clip(base, 0.0, 1.0))
        strength = float(NORMAL_STRENGTH.get(name, NORMAL_STRENGTH_DEFAULT))
        gain = float(RELIEF_GAIN.get(name, RELIEF_GAIN_DEFAULT))
        normal = _normal_map(height, strength, NORMAL_RELIEF * gain, radius=1)
        normal_data = np.ones((size, size, 4), dtype=np.float32)
        normal_data[..., :3] = normal
        _write_image(normal_image, normal_data)

        base_path = _save_image(base_image, directory / f"{name}_BaseColor.png", non_colour=False)
        normal_path = _save_image(normal_image, directory / f"{name}_Normal.png", non_colour=True)
        _wire(material, base_image, normal_image, strength)
        written[name] = {"basecolor": base_path, "normal": normal_path}
    return written
