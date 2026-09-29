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

Determinism: all randomness comes from ``numpy.random.default_rng(seed)`. The
per-material streams are derived from the seed and the material name, so the
result does not depend on iteration order and never touches the clock.
"""

from __future__ import annotations

from pathlib import Path

import bpy
import numpy as np

from . import spec

#: Roughness of the relief per surface class: how strongly the height field bends
#: the shading normal. Fabric is soft, leather has body, skin is nearly flat.
#: Woven cloth stays low on purpose: at atlas texel density a strong fine weave
#: aliases into a visible plaid when the garment is minified on screen.
NORMAL_STRENGTH = {
    "Skin": 0.15,
    "Hair": 0.22,
    "Eye": 0.10,
    "Jacket": 0.16,
    "Trousers": 0.14,
    "Leather": 0.38,
    "Accent": 0.14,
}
NORMAL_STRENGTH_DEFAULT = 0.35

#: Converts the per-pixel slope of a height field (one unit step, roughly -0.5 to
#: 0.5 for the tile painters here) into a tangent space tilt. Tuned so that a
#: seam reads as an edge and a noise field stays a surface texture, not static.
NORMAL_RELIEF = 2.0

#: Which atlas slots each painted material owns. 45 of the 48 slots are used;
#: ``spare_a``/``spare_b``/``spare_c`` stay unpainted on purpose.
PAINTED_REGIONS: dict[str, tuple[str, ...]] = {
    "Skin": ("head", "nose", "lips", "ear_L", "ear_R", "lid_L", "lid_R",
             "body", "body_back", "scar"),
    "Hair": ("hair", "fringe", "brow_L", "brow_R"),
    "Eye": ("eye_L", "eye_R"),
    "Jacket": ("jacket", "sleeve_L", "sleeve_R", "hood", "collar", "quilt", "zip", "patch"),
    "Trousers": ("trousers", "knee_pad", "pocket", "cuff"),
    "Leather": ("boots", "boot_sole", "boot_cuff", "laces", "gloves", "glove_palm",
                "glove_knuckle", "belt", "pouch_A", "pouch_B", "holster"),
    "Accent": ("straps", "accent", "accent_L", "accent_R"),
}

#: Colour of the skin slots before shading, shared by face, limbs and scar.
SKIN_BASE = (0.62, 0.44, 0.34)

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
    """Fractal value noise, periodic in ``x`` (the atlas u axis)."""
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


def _cellular_row(rng: np.random.Generator, size: int, region: str, cells: int) -> np.ndarray:
    """Cellular noise over one atlas slot, periodic across the u seam."""
    width, height_px = _tile_pixels(size, region)
    period = max(2, cells)
    columns = np.arange(width, dtype=np.float32) * (period / width)
    rows = np.arange(height_px, dtype=np.float32) * (period / width)
    x, y = np.meshgrid(columns, rows, indexing="xy")
    return _cellular(rng, x, y, period)


def _lines(coordinate: np.ndarray, spacing: float, width: float) -> np.ndarray:
    """1 on a line, fading to 0 within ``width``; period 1/``spacing``."""
    unit = np.mod(coordinate / spacing, 1.0)
    distance = np.minimum(unit, 1.0 - unit) * spacing
    return np.exp(-((distance / width) ** 2)).astype(np.float32)


def _seam(distance: np.ndarray, width: float) -> np.ndarray:
    return np.exp(-((distance / width) ** 2)).astype(np.float32)


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
    """Zeroed buffer in the exact shape of one painted slot."""
    width, height_px = _tile_pixels(size, region)
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


# --------------------------------------------------------------------------- #
# skin: face, limbs and the scar slot
# --------------------------------------------------------------------------- #


def _skin_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    u, v, tu, tv = _coordinates_atlas(size, region)
    base = np.array(SKIN_BASE, dtype=np.float32).reshape(1, 1, 3)
    mottle = _fbm_row(rng, size, region, 4, octaves=4)

    # Vertical flow of the skin tone: lighter forehead, deeper jaw.
    colour = base + (np.array((0.055, 0.042, 0.030), dtype=np.float32).reshape(1, 1, 3) * tv[..., None])
    colour = colour + mottle[..., None] * np.array((0.075, 0.060, 0.048), dtype=np.float32).reshape(1, 1, 3)
    height = _empty_tile(size, region)

    if region == "head":
        # The face centre sits on the tile border, so the redness masks are built
        # from the head's own surface angles: t = 0.5 is the tile centre, and
        # t = 0.0 / 1.0 are the two ends of the wrapped face.
        angle = tu - 0.5
        cheek = np.exp(-((np.abs(angle) - 0.155) / 0.070) ** 2) * np.exp(-((tv - 0.44) / 0.18) ** 2)
        brow_ridge = np.exp(-((tv - 0.60) / 0.07) ** 2) * 0.5
        temples = np.exp(-((np.abs(angle) - 0.30) / 0.070) ** 2) * np.exp(-((tv - 0.62) / 0.16) ** 2)
        jaw = np.exp(-((tv - 0.22) / 0.12) ** 2)
        pores = _fbm_row(rng, size, region, 96, octaves=2)
        red = np.clip(0.22 * cheek + 0.16 * jaw + 0.10 * brow_ridge + 0.08 * temples, 0.0, 0.6)
        colour = colour + np.stack([red, red * 0.28, red * 0.22], axis=-1)
        colour = colour + pores[..., None] * np.array((0.030, 0.026, 0.024), dtype=np.float32).reshape(1, 1, 3)
        # Eye sockets sit 11 % off centre and read a touch deeper.
        sockets = np.exp(-((np.abs(angle) - 0.19) / 0.055) ** 2) * np.exp(-((tv - 0.72) / 0.055) ** 2)
        colour = colour - sockets[..., None] * np.array((0.030, 0.030, 0.026), dtype=np.float32).reshape(1, 1, 3)
        height = pores * 0.05 - sockets * 0.06 + brow_ridge * 0.04
    elif region == "nose":
        red = np.exp(-((tu - 0.5) / 0.30) ** 2) * np.exp(-((tv - 0.25) / 0.35) ** 2)
        pores = _fbm_row(rng, size, region, 64, octaves=2)
        colour = colour + np.stack([red * 0.20, red * 0.035, red * 0.020], axis=-1)
        colour = colour + pores[..., None] * 0.022
        height = pores * 0.06 + np.exp(-((tv - 0.22) / 0.10) ** 2) * 0.05
    elif region == "lips":
        lip = np.exp(-((tv - 0.5) / 0.30) ** 2)
        pores = _fbm_row(rng, size, region, 48, octaves=3)
        colour = colour + lip[..., None] * np.array((0.215, -0.075, -0.060), dtype=np.float32).reshape(1, 1, 3)
        creases = _lines(tv + 0.16 * np.sin(6.0 * np.pi * tu), 1.0 / 22.0, 0.0022)
        colour = colour - (creases * lip * 0.055)[..., None]
        height = creases * lip * -0.30 + pores * 0.05
    elif region in ("ear_L", "ear_R"):
        red = np.exp(-((tv - 0.45) / 0.40) ** 2)
        pores = _fbm_row(rng, size, region, 56, octaves=2)
        colour = colour + np.stack([red * 0.115, red * 0.010, red * 0.005], axis=-1)
        rim = _lines(tv - 0.12 * np.sin(np.pi * tu), 0.30, 0.030) * 0.5
        colour = colour - (rim * 0.030)[..., None]
        height = rim * 0.16 + pores * 0.06
    elif region in ("lid_L", "lid_R"):
        pores = _fbm_row(rng, size, region, 64, octaves=2)
        fold = np.exp(-((tv - 0.72) / 0.10) ** 2)
        colour = colour + np.stack([fold * 0.06, fold * 0.01, fold * 0.008], axis=-1)
        colour = colour + pores[..., None] * 0.020
        height = -fold * 0.10 + pores * 0.05
    elif region in ("body", "body_back"):
        # Nearly all of the body is covered by clothing; only tone and noise matter.
        pores = _fbm_row(rng, size, region, 40, octaves=3)
        colour = colour + pores[..., None] * np.array((0.045, 0.038, 0.032), dtype=np.float32)
        colour = colour + np.array((0.0, 0.0, -0.012), dtype=np.float32).reshape(1, 1, 3) * tv[..., None]
        height = pores * 0.08
    elif region == "scar":
        pores = _fbm_row(rng, size, region, 48, octaves=2)
        colour = colour + pores[..., None] * 0.020
        line = np.exp(-((tv - 0.62 + 0.22 * (tu - 0.5)) / 0.038) ** 2)
        line = line * (0.35 + 0.65 * np.exp(-((tu - 0.5) / 0.42) ** 2))
        pale = line * 0.85
        colour = colour + pale[..., None] * np.array((0.145, 0.155, 0.140), dtype=np.float32).reshape(1, 1, 3)
        height = pale * 0.22 + pores * 0.05
    else:
        pores = _fbm_row(rng, size, region, 48, octaves=2)
        height = pores * 0.05

    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# eyes
# --------------------------------------------------------------------------- #


def _eye_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    # The eyeball was rotated so that the gaze direction lands on u = 0.5: the
    # iris belongs in the middle of the slot, not on its border.
    radius = np.hypot(tu - 0.5, (tv - 0.5) * 0.92) / 0.5
    sclera = np.array(_SCLERA, dtype=np.float32).reshape(1, 1, 3)
    veins = _fbm_row(rng, size, region, 26, octaves=3)
    colour = sclera + veins[..., None] * np.array((0.045, 0.010, 0.010), dtype=np.float32)
    iris = np.exp(-(((radius - 0.565) / 0.105) ** 2))
    pupil = _seam(radius, 0.185)
    limbus = np.exp(-(((radius - 0.680) / 0.030) ** 2))
    fibres = _fbm_row(rng, size, region, 74, octaves=2)
    iris_colour = np.array(_IRIS, dtype=np.float32).reshape(1, 1, 3) \
        + np.array(_IRIS_LIGHT, dtype=np.float32).reshape(1, 1, 3) * (fibres * 0.55)[..., None]
    colour = colour + (iris_colour - colour) * np.clip(iris, 0.0, 1.0)[..., None]
    colour = colour + (np.array(_PUPIL, dtype=np.float32).reshape(1, 1, 3) - colour) * pupil[..., None]
    colour = colour - (limbus * iris * 0.16)[..., None]
    colour = np.clip(colour, 0.0, 1.0)
    height = iris * 0.06 + pupil * -0.10 + veins * 0.02
    return colour, height.astype(np.float32)


# --------------------------------------------------------------------------- #
# hair and brows
# --------------------------------------------------------------------------- #


def _hair_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    # Strand bundles run downwards: the noise is sampled along the tile's own
    # diagonal so the streaks follow v, whichever way the slot is unwrapped.
    strands = _fbm_row(rng, size, region, 11, octaves=3) + 0.6 * _fbm_row(rng, size, region, 5, octaves=2)
    sweeps = _fbm_row(rng, size, region, 26, octaves=2)
    dark = np.clip(0.5 + 0.60 * strands - 0.10 * sweeps, 0.0, 1.0)
    colour = np.array(_HAIR, dtype=np.float32).reshape(1, 1, 3) \
        + np.array(_HAIR_SHADE, dtype=np.float32).reshape(1, 1, 3) * (1.0 - dark)[..., None] * 1.35
    colour = colour + np.array(_HAIR_TIP, dtype=np.float32).reshape(1, 1, 3) * (np.clip(dark, 0.0, 1.0) ** 2)[..., None] * 0.35
    if region == "fringe":
        # The fringe hangs over the brow: longer, darker strands on the upper half.
        heavy = np.exp(-((tv - 0.62) / 0.42) ** 2)
        colour = colour - (heavy * 0.35)[..., None] * colour
    colour = np.clip(colour, 0.0, 1.0)
    relief = _fbm_row(rng, size, region, 9, octaves=2)
    height = np.clip(strands * 0.35 + relief * 0.15, -1.0, 1.0)
    return colour, height.astype(np.float32)


# --------------------------------------------------------------------------- #
# jacket canvas
# --------------------------------------------------------------------------- #


def _canvas_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    weave = _fbm_row(rng, size, region, 24, octaves=2)
    # One tile is one atlas slot: at 2048 px the slot is 256 px wide, so 48 threads
    # land on ~5 px each and read as canvas. Coarser than that turns the weave into
    # a visible check pattern, finer aliases into a moire diamond.
    warp = np.maximum(0.0, np.sin(2.0 * np.pi * tu * 48.0)).astype(np.float32)
    weft = np.maximum(0.0, np.sin(2.0 * np.pi * tv * 48.0)).astype(np.float32)
    colour = _mix(_CANVAS, [
        ((warp * 0.55 + weft * 0.45) * 0.22, _CANVAS_THREAD),
        (weave * 0.18, _CANVAS_SHADE),
    ])
    height = (warp * 0.14 + weft * 0.14 + weave * 0.14).astype(np.float32)

    if region in ("sleeve_L", "sleeve_R"):
        # Fold creases across the sleeve, kept shallow: hard lines read as stripes.
        creases = _lines(tv - 0.08 * np.sin(3.0 * np.pi * tu), 1.0 / 7.0, 0.020)
        colour = colour - (creases * 0.09)[..., None]
        height = height - creases * 0.12
    elif region in ("hood", "collar"):
        fold = np.exp(-((tv - 0.30) / 0.10) ** 2) + np.exp(-((tv - 0.76) / 0.09) ** 2)
        colour = colour - (np.clip(fold, 0.0, 1.0) * 0.22)[..., None]
        height = height - np.clip(fold, 0.0, 1.0) * 0.30
    elif region == "quilt":
        # Diamond quilting: the diagonal stitch lines bound padded panels.
        distance = np.minimum(np.abs(np.mod(tv - tu, 0.25)), np.abs(np.mod(tv + tu, 0.25)))
        distance = np.minimum(distance, 0.25 - distance)
        stitch = _seam(distance, 0.0045)
        colour = colour + (stitch * 0.75)[..., None] * (np.array(_CANVAS_STITCH, dtype=np.float32).reshape(1, 1, 3) - colour)
        colour = colour - ((1.0 - stitch) * 0.0)[..., None]
        height = height + stitch * 0.85
        padding = 1.0 - np.clip(distance / 0.125, 0.0, 1.0)
        height = height + padding * 0.35
        colour = colour + (padding * 0.06)[..., None]
    elif region == "zip":
        strip = np.exp(-(((tu - 0.5) / 0.075) ** 2))
        colour = colour + (strip * 0.95)[..., None] * (np.array(_METAL, dtype=np.float32).reshape(1, 1, 3) - colour)
        teeth = np.maximum(0.0, np.sin(2.0 * np.pi * tv * 30.0)).astype(np.float32)
        shade = _cells_for_zip(rng, size, region)
        colour = colour * (1.0 - (strip * teeth * 0.35)[..., None])
        colour = colour + (strip * teeth * shade * 0.10)[..., None]
        height = height + strip * 0.30 + strip * teeth * 0.55
    elif region == "patch":
        inner = 0.20
        frame = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.075, 0.0, 1.0)
        inside = ((tu > inner) & (tu < 1.0 - inner) & (tv > inner) & (tv < 1.0 - inner)).astype(np.float32)
        colour = colour + (frame * 0.85)[..., None] * (np.array(_ACCENT, dtype=np.float32).reshape(1, 1, 3) - colour)
        colour = colour + (inside * 0.55)[..., None] * (np.array(_CANVAS_LINING, dtype=np.float32).reshape(1, 1, 3) - colour)
        badge = np.exp(-(((tv - 0.5) / 0.035) ** 2)) * (np.abs(tu - 0.5) < 0.16)
        colour = colour + (badge * 0.8)[..., None] * (np.array(_ACCENT_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + frame * 0.55 + inside * 0.30 + badge.astype(np.float32) * 0.20

    # Edge wear: exposed threads read lighter along the slot border.
    edge = np.exp(-(np.minimum(*_edge_distance(tu, tv)) / 0.045) ** 2)
    scratch = np.clip(_fbm_row(rng, size, region, 64, octaves=2), 0.0, 1.0)
    wear = edge * (0.45 + 0.55 * scratch)
    colour = colour + wear[..., None] * (np.array(_CANVAS_WORN, dtype=np.float32).reshape(1, 1, 3) - colour) * 0.55
    height = height + wear * 0.25
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


def _cells_for_zip(rng: np.random.Generator, size: int, region: str) -> np.ndarray:
    """Loose grain behind the zip teeth."""
    return np.clip(_fbm_row(rng, size, region, 9, octaves=2), 0.0, 1.0)


# --------------------------------------------------------------------------- #
# ripstop trousers
# --------------------------------------------------------------------------- #


def _ripstop_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    noise = _fbm_row(rng, size, region, 12, octaves=3)
    rip = _lines(tu + tv, 1.0 / 6.0, 0.0030) + _lines(tv - tu, 1.0 / 6.0, 0.0030)
    fine = 0.5 * (np.maximum(0.0, np.sin(2.0 * np.pi * tu * 48.0))
                  + np.maximum(0.0, np.sin(2.0 * np.pi * tv * 48.0)))
    colour = _mix(_RIPSTOP, [
        (np.clip(rip, 0.0, 1.0) * 0.22, _RIPSTOP_THREAD),
        (noise * 0.22, _RIPSTOP_SHADE),
        (fine.astype(np.float32) * 0.05, _RIPSTOP_THREAD),
    ])
    height = (np.clip(rip, 0.0, 1.0) * 0.22 + fine.astype(np.float32) * 0.05 + noise * 0.16).astype(np.float32)

    if region == "knee_pad":
        # Reinforcement panel: darker, denser weave, stitched border.
        panel = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.06, 0.0, 1.0)
        colour = colour + (panel * 0.75)[..., None] * (np.array(_RIPSTOP_REINFORCED, dtype=np.float32).reshape(1, 1, 3) - colour)
        border = _seam(np.minimum(*_edge_distance(tu, tv)) - 0.06, 0.006)
        colour = colour + (border * 0.6)[..., None] * (np.array(_RIPSTOP_THREAD, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + panel * 0.35 + border * 0.55
    elif region == "pocket":
        distance = np.minimum(*_edge_distance(tu, tv))
        seam = _seam(np.abs(distance - 0.10), 0.006)
        mouth = _seam(tv - 0.30, 0.008)
        colour = colour + (seam * 0.55)[..., None] * (np.array(_RIPSTOP_THREAD, dtype=np.float32).reshape(1, 1, 3) - colour)
        colour = colour - (mouth * 0.35)[..., None]
        height = height + seam * 0.45 - mouth * 0.40
    elif region == "cuff":
        band = _lines(tv, 1.0 / 4.0, 0.010)
        colour = colour - (band * 0.18)[..., None]
        height = height - band * 0.20
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


# --------------------------------------------------------------------------- #
# leather kit
# --------------------------------------------------------------------------- #


def _leather_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    grain = 1.0 - np.clip(_cellular_row(rng, size, region, 9) * 5.0, 0.0, 1.0)
    fine = _fbm_row(rng, size, region, 40, octaves=2)
    colour = _mix(_LEATHER, [
        (grain * 0.45, _LEATHER_SHADE),
        (fine * 0.20, _LEATHER_WORN),
    ])
    height = (grain * 0.55 + fine * 0.25).astype(np.float32)

    if region == "boots":
        highlight = np.exp(-(((tv - 0.78) / 0.06) ** 2))
        colour = colour + (highlight * 0.30)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + highlight * 0.25
    elif region == "boot_sole":
        # Lug profile: coarse ribs running along the sole, worn at the edges.
        lugs = np.maximum(0.0, np.sin(2.0 * np.pi * tu * 7.0)).astype(np.float32)
        wear = np.clip(_fbm_row(rng, size, region, 8, octaves=2), 0.0, 1.0)
        colour = _mix(_SOLE, [
            (lugs * 0.65, _SOLE_WORN),
            (wear * 0.25, _SOLE_WORN),
        ])
        height = (lugs * 0.85 + wear * 0.20).astype(np.float32)
    elif region == "boot_cuff":
        pleat = np.exp(-((tv - 0.45) / 0.09) ** 2)
        colour = colour - (pleat * 0.22)[..., None]
        height = height - pleat * 0.30
    elif region == "laces":
        # Two twisted cords over the tongue; the braid is the visible texture.
        cord = 0.5 + 0.5 * np.sin(2.0 * np.pi * (0.5 * tv + 3.0 * tu))
        cord = cord.astype(np.float32)
        line = _lines(tu - 0.5, 1.0 / 3.0, 0.085) + _lines(tu - 0.18, 1.0 / 3.0, 0.085)
        line = np.clip(line, 0.0, 1.0)
        base_colour = np.array(_LEATHER_SHADE, dtype=np.float32).reshape(1, 1, 3)
        lace_colour = np.array(_LACE, dtype=np.float32).reshape(1, 1, 3) * (0.70 + 0.55 * cord)[..., None]
        colour = base_colour + (lace_colour - base_colour) * line[..., None]
        height = line * (0.55 + 0.45 * cord)
    elif region == "gloves":
        knuckle = np.exp(-((tu - 0.5) / 0.42) ** 2) * np.exp(-((tv - 0.72) / 0.14) ** 2)
        colour = colour + (knuckle * 0.16)[..., None]
        height = height + knuckle * 0.20
    elif region == "glove_palm":
        creases = _lines(tv - 0.12 * np.sin(4.0 * np.pi * tu), 1.0 / 5.0, 0.012)
        colour = colour - (creases * 0.25)[..., None]
        height = height - creases * 0.35
    elif region == "glove_knuckle":
        pad = np.clip(1.0 - np.hypot(tu - 0.5, (tv - 0.5) * 1.15) / 0.34, 0.0, 1.0)
        colour = colour + (pad * 0.25)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        seam = _seam(np.abs(np.hypot(tu - 0.5, (tv - 0.5) * 1.15) - 0.34), 0.008)
        height = height + pad * 0.45 + seam * 0.55
    elif region == "belt":
        band = np.exp(-(((tv - 0.5) / 0.42) ** 4))
        colour = colour * (0.55 + 0.45 * band)[..., None]
        hole_v = 0.5 + 0.0 * tu
        holes = np.zeros_like(tu)
        for index in range(6):
            centre = (index + 0.5) / 6.0
            holes = np.maximum(holes, np.exp(-((np.hypot((tu - centre) * 0.55, (tv - hole_v) * 0.55) / 0.026) ** 2)))
        hole_body = (holes > 0.55).astype(np.float32)
        edge = np.clip(1.0 - np.abs(holes - 0.55) / 0.45, 0.0, 1.0) * (1.0 - hole_body)
        colour = colour + (hole_body * 0.9)[..., None] * (np.array(_LEATHER_SHADE, dtype=np.float32).reshape(1, 1, 3) * 0.5 - colour)
        colour = colour + (edge * 0.6)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + edge * 0.45 - hole_body * 0.70
    elif region in ("pouch_A", "pouch_B"):
        distance = np.minimum(*_edge_distance(tu, tv))
        seam = _seam(np.abs(distance - 0.08), 0.006)
        flap = _seam(tv - 0.32, 0.010)
        colour = colour + (seam * 0.50 + flap * 0.35)[..., None] * (np.array(_LEATHER_SHADE, dtype=np.float32).reshape(1, 1, 3))
        height = height + seam * 0.45 + flap * 0.50
        if region == "pouch_B":
            buckle = np.exp(-((np.hypot((tu - 0.5) * 0.8, (tv - 0.32) * 1.6) / 0.075) ** 2))
            colour = colour + (buckle * 0.85)[..., None] * (np.array(_METAL, dtype=np.float32).reshape(1, 1, 3) - colour)
            height = height + buckle * 0.55
    elif region == "holster":
        seam = _seam(np.abs(np.minimum(*_edge_distance(tu, tv)) - 0.07), 0.006)
        strap = _seam(tu - 0.30, 0.035) + _seam(tv - 0.74, 0.030)
        strap = np.clip(strap, 0.0, 1.0)
        colour = colour + (seam * 0.45)[..., None] * (np.array(_LEATHER_SHADE, dtype=np.float32).reshape(1, 1, 3))
        colour = colour + (strap * 0.55)[..., None] * (np.array(_LEATHER_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + seam * 0.40 + strap * 0.35
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
    height = (weather * 0.25).astype(np.float32)

    if region == "straps":
        band = np.exp(-(((tv - 0.5) / 0.34) ** 4))
        colour = colour * (0.50 + 0.50 * band)[..., None]
        stitch = _lines(tv - 0.30, 1.0, 0.006) + _lines(tv - 0.70, 1.0, 0.006)
        colour = colour - (np.clip(stitch, 0.0, 1.0) * 0.25)[..., None]
        height = height - np.clip(stitch, 0.0, 1.0) * 0.35 + band * 0.20
    elif region in ("accent_L", "accent_R"):
        rim = np.clip(1.0 - np.minimum(*_edge_distance(tu, tv)) / 0.07, 0.0, 1.0)
        colour = colour + (rim * 0.35)[..., None] * (np.array(_ACCENT_WORN, dtype=np.float32).reshape(1, 1, 3) - colour)
        height = height + rim * 0.30
    elif region == "accent":
        arm = np.exp(-((np.abs(tu - 0.5) - 0.24) / 0.055) ** 2)
        colour = colour - (arm * 0.45)[..., None]
        height = height - arm * 0.35
    return np.clip(colour, 0.0, 1.0), height.astype(np.float32)


def _metal_tile(rng: np.random.Generator, size: int, region: str) -> tuple[np.ndarray, np.ndarray]:
    _u, _v, tu, tv = _coordinates_atlas(size, region)
    tone = _fbm_row(rng, size, region, 6, octaves=3)
    colour = np.clip(np.array(_METAL, dtype=np.float32).reshape(1, 1, 3) + (tone * 0.10)[..., None], 0.0, 1.0)
    scratches = _empty_tile(size, region)
    for _ in range(14):
        angle = float(rng.uniform(-0.9, 0.9))
        offset = float(rng.uniform(-1.0, 1.0))
        position = tv - offset - angle * (tu - 0.5)
        scratches = np.maximum(scratches, _seam(position, float(rng.uniform(0.0015, 0.0040))))
    colour = colour + (scratches * 0.35)[..., None] * (np.array((0.86, 0.87, 0.90), dtype=np.float32).reshape(1, 1, 3) - colour)
    height = (-scratches * 0.45 + tone * 0.15).astype(np.float32)
    if region == "metal_dark":
        colour = colour * 0.55
    return np.clip(colour, 0.0, 1.0), height


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


def _material_regions(name: str) -> tuple[str, ...]:
    if name in PAINTED_REGIONS:
        return PAINTED_REGIONS[name]
    return tuple(region for region in spec.REGIONS if region not in _SPARE_SLOTS)


_SPARE_SLOTS = frozenset({"spare_a", "spare_b", "spare_c"})


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


def _roll(values: np.ndarray, shift: int, axis: int) -> np.ndarray:
    if shift % values.shape[axis] == 0:
        return values
    return np.roll(values, shift, axis=axis)


def _blur(values: np.ndarray) -> np.ndarray:
    kernel = np.array((0.25, 0.5, 0.25), dtype=np.float32)
    smooth = kernel[0] * _roll(values, -1, 1) + kernel[1] * values + kernel[2] * _roll(values, 1, 1)
    padded = np.pad(smooth, ((1, 1), (0, 0)), mode="edge")
    return (kernel[0] * padded[:-2] + kernel[1] * padded[1:-1] + kernel[2] * padded[2:])


def _normal_map(height: np.ndarray, strength: float, relief: float) -> np.ndarray:
    """Tangent space normals from a height field; the u axis is periodic."""
    smooth = _blur(height.astype(np.float32))
    slope_x = (_roll(smooth, -1, 1) - _roll(smooth, 1, 1)) * 0.5
    padded = np.pad(smooth, ((1, 1), (0, 0)), mode="edge")
    slope_y = (padded[:-2] - padded[2:]) * 0.5
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
                   texture_dir, seed: int = 20260930) -> dict[str, str]:
    """Paint one BaseColor and one Normal PNG per painted material and wire them.

    ``texture_dir`` is created if missing. The returned mapping is
    ``{material_name: {"basecolor": path, "normal": path}}`` with both entries as
    strings. Calling the function twice on the same materials rewires the same
    nodes instead of stacking a second set.

    The directory is resolved to an absolute path before anything is written:
    ``Image.save()`` reports success but writes nothing for a plain relative path,
    because Blender reads those relative to the blend file, and that file does not
    exist yet while the character is being generated.
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
        for region in _material_regions(name):
            rng = np.random.default_rng(_tile_seed(seed, name, region, "paint"))
            colour, relief = painter(rng, size, region)
            _fill(base, colour, region)
            _fill(height, _stretch(relief, 2.5), region)

        _write_image(base_image, np.clip(base, 0.0, 1.0))
        strength = float(NORMAL_STRENGTH.get(name, NORMAL_STRENGTH_DEFAULT))
        normal = _normal_map(height, strength, NORMAL_RELIEF)
        normal_data = np.ones((size, size, 4), dtype=np.float32)
        normal_data[..., :3] = normal
        _write_image(normal_image, normal_data)

        base_path = _save_image(base_image, directory / f"{name}_BaseColor.png", non_colour=False)
        normal_path = _save_image(normal_image, directory / f"{name}_Normal.png", non_colour=True)
        _wire(material, base_image, normal_image, strength)
        written[name] = {"basecolor": base_path, "normal": normal_path}
    return written
