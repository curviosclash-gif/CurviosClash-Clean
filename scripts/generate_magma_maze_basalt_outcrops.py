"""Deterministic basalt outcrop props for the Magma Maze lava floor.

Ten variants of one family: hexagonal basalt columns with lighter caps, glowing lava
cracks at their foot and a few embers. Every mesh is decorative (`_nocol`); the map's
authored obstacles stay the collision, and its `dynamic` GLB collider mode ignores
static props anyway. Blender units equal map units, origin is bottom-centre, Z is up.

The object contract is written outside the repository, then compiled and built with the
blender-object-batches scripts:

    python scripts/generate_magma_maze_basalt_outcrops.py --write-contract <TMP>/object-contract.json
    python .codex/skills/blender-object-batches/scripts/generate_variant_manifest.py \
        <TMP>/object-contract.json --output <TMP>/variants.json
    blender --background --factory-startup --python-exit-code 1 \
        --python .codex/skills/blender-object-batches/scripts/run_batch.py -- \
        --manifest <TMP>/variants.json --generator scripts/generate_magma_maze_basalt_outcrops.py \
        --output-dir assets/maps/magma_maze/props/basalt-outcrops --report <TMP>/generation-report.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

GENERATOR_ID = "magma-maze-basalt-outcrop-generator"
GENERATOR_VERSION = "1.0.0"
OBJECT_ID = "magma-basalt-outcrop"

# Lava keeps a near-black base under one dominant emissive channel so tone mapping
# cannot wash it out to white.
PALETTE = {
    "basalt": ((0.075, 0.062, 0.058, 1.0), 0.0, 0.92, (0.0, 0.0, 0.0), 0.0),
    "cap": ((0.12, 0.10, 0.095, 1.0), 0.0, 0.84, (0.0, 0.0, 0.0), 0.0),
    "lava": ((0.02, 0.006, 0.0, 1.0), 0.0, 0.6, (1.0, 0.25, 0.02), 0.9),
}
MESH_NAMES = {
    "basalt": "magma_outcrop_basalt_nocol",
    "cap": "magma_outcrop_cap_noshadow_nocol",
    "lava": "magma_outcrop_lava_noshadow_nocol",
}


def contract():
    return {
        "schema_version": 2,
        "contract_revision": 1,
        "object_id": OBJECT_ID,
        "lifecycle": {"state": "CONTRACT_LOCKED"},
        "count": 10,
        "seed": 7319,
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
                "hexagonal basalt column silhouette",
                "glowing lava cracks at the foot",
                "three shared materials",
            ],
        },
        "parameters": {
            "column_count": {"type": "int", "min": 3, "max": 7, "canonical": 5},
            "height_scale": {"type": "float", "min": 0.7, "max": 1.3, "precision": 3,
                             "canonical": 1.0, "strata_group": "mass"},
            "spread": {"type": "float", "min": 0.6, "max": 1.1, "precision": 3,
                       "canonical": 0.85, "strata_group": "mass", "invert": True},
            "lean": {"type": "float", "min": 0.0, "max": 0.16, "precision": 3, "canonical": 0.06},
            "crack_count": {"type": "int", "min": 2, "max": 5, "canonical": 3},
            "ember_count": {"type": "int", "min": 0, "max": 4, "canonical": 2},
            "layout": {"type": "choice", "values": ["cluster", "ridge", "arc"], "canonical": "cluster"},
        },
        "design_roles": [
            {"index": 2, "name": "low-ridge", "overrides": {"layout": "ridge", "height_scale": 0.72}},
            {"index": 3, "name": "tall-cluster", "overrides": {"layout": "cluster", "height_scale": 1.28,
                                                              "column_count": 7}},
            {"index": 4, "name": "open-arc", "overrides": {"layout": "arc", "spread": 1.08}},
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



def _column_sites(params, rng):
    count, spread, layout = params["column_count"], params["spread"], params["layout"]
    sites = []
    for index in range(count):
        t = index / max(1, count - 1)
        if layout == "ridge":
            x, y = (t - 0.5) * 3.2 * spread, rng.uniform(-0.25, 0.25)
        elif layout == "arc":
            angle = math.pi * (0.15 + 0.7 * t)
            x, y = math.cos(angle) * 1.6 * spread, math.sin(angle) * 1.6 * spread - 0.8 * spread
        elif index == 0:
            x, y = 0.0, 0.0
        else:
            angle = (index - 1) * 2 * math.pi / (count - 1) + rng.uniform(-0.3, 0.3)
            radius = rng.uniform(0.75, 1.15) * spread
            x, y = math.cos(angle) * radius, math.sin(angle) * radius
        # The tallest column sits in the middle of the run so the silhouette peaks once.
        centrality = 1.0 - abs(t - 0.5) * 1.2 if layout != "cluster" else (1.0 if index == 0 else 0.55)
        height = (1.4 + 2.0 * centrality * rng.uniform(0.82, 1.0)) * params["height_scale"]
        sites.append((x, y, rng.uniform(0.32, 0.52), height))
    return sites


def _hex_prism(bpy, location, radius, depth, rotation):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=depth,
                                        location=location, rotation=rotation)
    return bpy.context.object


def _build(bpy, params, rng):
    parts = {"basalt": [], "cap": [], "lava": []}
    lean = params["lean"]
    for x, y, radius, height in _column_sites(params, rng):
        tilt = (rng.uniform(-lean, lean), rng.uniform(-lean, lean), rng.uniform(0, math.pi / 3))
        # Columns start slightly below zero so the lava floor swallows their foot.
        parts["basalt"].append(_hex_prism(bpy, (x, y, height / 2 - 0.08), radius, height + 0.16, tilt))
        top = (x + math.sin(tilt[1]) * height / 2, y - math.sin(tilt[0]) * height / 2, height - 0.04)
        parts["cap"].append(_hex_prism(bpy, top, radius * 1.06, 0.16, tilt))
    for _ in range(params["crack_count"]):
        # Cracks radiate outwards from the columns' foot so they stay visible beside them.
        heading = rng.uniform(0, 2 * math.pi)
        distance = rng.uniform(1.4, 2.1) * params["spread"]
        bpy.ops.mesh.primitive_cube_add(
            location=(math.cos(heading) * distance, math.sin(heading) * distance, 0.0),
            rotation=(0, 0, heading + rng.uniform(-0.3, 0.3)))
        crack = bpy.context.object
        crack.scale = (rng.uniform(0.6, 1.3), rng.uniform(0.06, 0.12), 0.03)
        parts["lava"].append(crack)
    for _ in range(params["ember_count"]):
        heading = rng.uniform(0, 2 * math.pi)
        distance = rng.uniform(1.3, 2.1) * params["spread"]
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rng.uniform(0.1, 0.2),
                                              location=(math.cos(heading) * distance,
                                                        math.sin(heading) * distance, 0.05))
        parts["lava"].append(bpy.context.object)
    return parts





def build_variant(context):
    import sys

    import bpy

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import map_prop_family_common as common

    if context["invariants"].get("collision") != "decorative-only":
        raise ValueError("basalt outcrops are decorative-only")
    common.reset_scene(context)
    rng = random.Random(context["seed"])
    mats = common.make_materials("MagmaOutcrop", PALETTE)
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
