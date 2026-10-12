"""Deterministic neon signal pylons for the Neon Circuit infield and verges.

Ten variants of one family: dark graphite posts on a plinth with stacked glowing light
bands, as single pylons, twin posts or a gantry arch. Each glow keeps a near-black base
and one dominant emissive channel (blue or red) so tone mapping cannot wash it to white.
Every mesh is decorative (`_nocol`); the map's `dynamic` GLB collider mode ignores static
props. Blender units equal map units, origin is bottom-centre, Z is up.

Build like the basalt outcrops (see scripts/generate_magma_maze_basalt_outcrops.py):

    python scripts/generate_neon_circuit_signal_pylons.py --write-contract <TMP>/object-contract.json
    python .codex/skills/blender-object-batches/scripts/generate_variant_manifest.py \
        <TMP>/object-contract.json --output <TMP>/variants.json
    blender --background --factory-startup --python-exit-code 1 \
        --python .codex/skills/blender-object-batches/scripts/run_batch.py -- \
        --manifest <TMP>/variants.json --generator scripts/generate_neon_circuit_signal_pylons.py \
        --output-dir assets/maps/neon_circuit/props/signal-pylons --report <TMP>/generation-report.json
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

GENERATOR_ID = "neon-circuit-signal-pylon-generator"
GENERATOR_VERSION = "1.0.0"
OBJECT_ID = "neon-signal-pylon"

PALETTE = {
    "post": ((0.05, 0.05, 0.07, 1.0), 0.6, 0.35, (0.0, 0.0, 0.0), 0.0),
    "blue": ((0.01, 0.01, 0.02, 1.0), 0.0, 0.4, (0.12, 0.45, 1.0), 0.85),
    "red": ((0.02, 0.005, 0.01, 1.0), 0.0, 0.4, (1.0, 0.08, 0.35), 0.8),
}
MESH_NAMES = {
    "post": "neon_pylon_post_nocol",
    "blue": "neon_pylon_band_blue_noshadow_nocol",
    "red": "neon_pylon_band_red_noshadow_nocol",
}


def contract():
    return {
        "schema_version": 2,
        "contract_revision": 1,
        "object_id": OBJECT_ID,
        "lifecycle": {"state": "CONTRACT_LOCKED"},
        "count": 10,
        "seed": 9047,
        "sampling": {"mode": "coverage", "canonical_first": True},
        "naming_pattern": "{object_id}-v{index:02d}",
        "invariants": {
            "units": "map-units",
            "up_axis": "Z",
            "origin": "bottom-center",
            "style": "stylized-low-poly",
            "target": "curviosclash-desktop-glb",
            "collision": "decorative-only",
            "must_keep": [
                "dark graphite post on a plinth",
                "stacked glowing light bands",
                "one dominant emissive channel per glow",
            ],
        },
        "parameters": {
            "height_scale": {"type": "float", "min": 0.75, "max": 1.3, "precision": 3, "canonical": 1.0},
            "band_count": {"type": "int", "min": 2, "max": 6, "canonical": 4},
            "red_ratio": {"type": "float", "min": 0.0, "max": 0.6, "precision": 3, "canonical": 0.25},
            "taper": {"type": "float", "min": 0.55, "max": 1.0, "precision": 3, "canonical": 0.8},
            "layout": {"type": "choice", "values": ["pylon", "twin", "gantry"], "canonical": "pylon"},
        },
        "design_roles": [
            {"index": 2, "name": "twin-posts", "overrides": {"layout": "twin", "band_count": 5}},
            {"index": 3, "name": "gantry", "overrides": {"layout": "gantry", "height_scale": 0.9}},
            {"index": 4, "name": "tall-beacon", "overrides": {"layout": "pylon", "height_scale": 1.28,
                                                             "band_count": 6}},
        ],
        "build_profile": {"renderer": "eevee", "target_engine": "three-r186-glb",
                          "lod_policy": "lod0-only", "texture_resolution": 0},
        "outputs": {"required_roles": ["editable", "runtime"], "editable_format": "blend",
                    "runtime_format": "glb", "preview": "contact-sheet"},
        "budgets": {"triangles_max": 1500, "materials_max": 3, "file_size_bytes_max": 120000},
        "qa": {"required_metrics": ["triangles", "materials", "file_size_bytes"],
               "required_views": ["front", "side", "rear", "three-quarter"], "roundtrip_import": True},
        "provenance": {"generator_id": GENERATOR_ID, "generator_version": GENERATOR_VERSION,
                       "blender_version": "4.2-lts", "domain_skill": "blender-assets"},
    }


def _box(bpy, location, size):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    return obj


def _post(bpy, parts, params, rng, x, height):
    width = 0.42
    parts["post"].append(_box(bpy, (x, 0, 0.2), (1.1, 1.1, 0.4)))  # plinth
    parts["post"].append(_box(bpy, (x, 0, 0.4 + height / 2), (width, width, height)))
    top_width = width * params["taper"] + 0.12
    parts["post"].append(_box(bpy, (x, 0, 0.4 + height + 0.15), (top_width + 0.2, top_width + 0.2, 0.3)))
    count = params["band_count"]
    for index in range(count):
        z = 0.4 + height * (0.25 + 0.7 * index / max(1, count - 1))
        band = 1.0 - (1.0 - params["taper"]) * index / max(1, count - 1)
        key = "red" if rng.random() < params["red_ratio"] else "blue"
        parts[key].append(_box(bpy, (x, 0, z), (width + 0.16 * band, width + 0.16 * band, 0.12)))


def _build(bpy, params, rng):
    parts = {"post": [], "blue": [], "red": []}
    height = 5.2 * params["height_scale"]
    layout = params["layout"]
    if layout == "pylon":
        _post(bpy, parts, params, rng, 0.0, height)
    else:
        span = 2.4 if layout == "twin" else 4.2
        _post(bpy, parts, params, rng, -span / 2, height)
        _post(bpy, parts, params, rng, span / 2, height * (0.86 if layout == "twin" else 1.0))
        if layout == "gantry":
            parts["post"].append(_box(bpy, (0, 0, 0.4 + height - 0.2), (span + 0.6, 0.36, 0.4)))
            key = "red" if params["red_ratio"] > 0.3 else "blue"
            parts[key].append(_box(bpy, (0, 0, 0.4 + height - 0.55), (span - 0.4, 0.2, 0.14)))
    return parts


def build_variant(context):
    import sys

    import bpy

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import map_prop_family_common as common

    if context["invariants"].get("collision") != "decorative-only":
        raise ValueError("signal pylons are decorative-only")
    common.reset_scene(context)
    rng = random.Random(context["seed"])
    mats = common.make_materials("NeonPylon", PALETTE)
    parts = _build(bpy, context["parameters"], rng)
    return common.finish_variant(context, parts, MESH_NAMES, mats,
                                 {"layout": context["parameters"]["layout"]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write-contract", type=Path, required=True)
    args = parser.parse_args()
    args.write_contract.parent.mkdir(parents=True, exist_ok=True)
    args.write_contract.write_text(json.dumps(contract(), indent=2) + "\n", encoding="utf-8")
    print(args.write_contract)
