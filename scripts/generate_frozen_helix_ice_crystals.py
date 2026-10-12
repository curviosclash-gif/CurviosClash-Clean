"""Deterministic ice crystal clusters for the Frozen Helix ice floor.

Ten variants of one family: pointed hexagonal ice crystals bursting from a low snow
mound, some in a deeper blue. Opaque materials only (no BLEND cost on the target GPU).
Every mesh is decorative (`_nocol`); the map's `dynamic` GLB collider mode ignores static
props and the authored obstacles stay the collision. Blender units equal map units,
origin is bottom-centre, Z is up.

Build like the basalt outcrops (see scripts/generate_magma_maze_basalt_outcrops.py):

    python scripts/generate_frozen_helix_ice_crystals.py --write-contract <TMP>/object-contract.json
    python .codex/skills/blender-object-batches/scripts/generate_variant_manifest.py \
        <TMP>/object-contract.json --output <TMP>/variants.json
    blender --background --factory-startup --python-exit-code 1 \
        --python .codex/skills/blender-object-batches/scripts/run_batch.py -- \
        --manifest <TMP>/variants.json --generator scripts/generate_frozen_helix_ice_crystals.py \
        --output-dir assets/maps/frozen_helix/props/ice-crystals --report <TMP>/generation-report.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

GENERATOR_ID = "frozen-helix-ice-crystal-generator"
GENERATOR_VERSION = "1.0.0"
OBJECT_ID = "frozen-ice-crystal"

PALETTE = {
    "snow": ((0.80, 0.86, 0.91, 1.0), 0.0, 0.72, (0.0, 0.0, 0.0), 0.0),
    "ice": ((0.56, 0.80, 0.92, 1.0), 0.0, 0.12, (0.0, 0.0, 0.0), 0.0),
    "deep": ((0.17, 0.41, 0.62, 1.0), 0.0, 0.18, (0.0, 0.0, 0.0), 0.0),
}
MESH_NAMES = {
    "snow": "frozen_crystal_snow_noshadow_nocol",
    "ice": "frozen_crystal_ice_nocol",
    "deep": "frozen_crystal_deep_nocol",
}


def contract():
    return {
        "schema_version": 2,
        "contract_revision": 1,
        "object_id": OBJECT_ID,
        "lifecycle": {"state": "CONTRACT_LOCKED"},
        "count": 10,
        "seed": 5821,
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
                "pointed hexagonal ice crystal silhouette",
                "low snow mound base",
                "opaque materials only",
            ],
        },
        "parameters": {
            "crystal_count": {"type": "int", "min": 4, "max": 9, "canonical": 6},
            "height_scale": {"type": "float", "min": 0.7, "max": 1.3, "precision": 3,
                             "canonical": 1.0, "strata_group": "mass"},
            "spread": {"type": "float", "min": 0.6, "max": 1.1, "precision": 3,
                       "canonical": 0.85, "strata_group": "mass", "invert": True},
            "splay": {"type": "float", "min": 0.15, "max": 0.6, "precision": 3, "canonical": 0.35},
            "deep_ratio": {"type": "float", "min": 0.0, "max": 0.5, "precision": 3, "canonical": 0.25},
            "layout": {"type": "choice", "values": ["burst", "fan", "twin"], "canonical": "burst"},
        },
        "design_roles": [
            {"index": 2, "name": "wide-fan", "overrides": {"layout": "fan", "splay": 0.58}},
            {"index": 3, "name": "tall-burst", "overrides": {"layout": "burst", "height_scale": 1.28,
                                                            "crystal_count": 9}},
            {"index": 4, "name": "twin-spires", "overrides": {"layout": "twin", "splay": 0.18}},
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


def _crystal_axes(params, rng):
    count, layout, splay = params["crystal_count"], params["layout"], params["splay"]
    axes = []
    for index in range(count):
        if layout == "fan":
            azimuth = math.pi * (0.1 + 0.8 * index / max(1, count - 1))
        elif layout == "twin":
            azimuth = (math.pi if index % 2 else 0.0) + rng.uniform(-0.6, 0.6)
        else:
            azimuth = index * 2.39996 + rng.uniform(-0.25, 0.25)  # golden-angle burst
        # The first crystal is the leader: upright and longest, so each cluster peaks once.
        tilt = 0.04 if index == 0 else splay * rng.uniform(0.55, 1.0)
        length = (3.4 if index == 0 else rng.uniform(1.2, 2.8)) * params["height_scale"]
        offset = 0.0 if index == 0 else rng.uniform(0.25, 0.9) * params["spread"]
        axes.append((azimuth, tilt, length, rng.uniform(0.16, 0.3) * (1.25 if index == 0 else 1.0), offset))
    return axes


def _build(bpy, params, rng):
    from mathutils import Vector

    parts = {"snow": [], "ice": [], "deep": []}
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=(0, 0, 0))
    mound = bpy.context.object
    mound.scale = (1.5 * params["spread"] + 0.4, 1.3 * params["spread"] + 0.4, 0.32)
    parts["snow"].append(mound)
    for index, (azimuth, tilt, length, radius, offset) in enumerate(_crystal_axes(params, rng)):
        direction = Vector((math.sin(tilt) * math.cos(azimuth), math.sin(tilt) * math.sin(azimuth), math.cos(tilt)))
        rotation = Vector((0, 0, 1)).rotation_difference(direction).to_euler()
        base = Vector((math.cos(azimuth) * offset, math.sin(azimuth) * offset, 0.05))
        shaft = length * 0.78
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=shaft,
                                            location=base + direction * (shaft / 2), rotation=rotation)
        body = bpy.context.object
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=radius, radius2=0.0, depth=length - shaft,
                                        location=base + direction * (shaft + (length - shaft) / 2),
                                        rotation=rotation)
        tip = bpy.context.object
        key = "deep" if index > 0 and rng.random() < params["deep_ratio"] else "ice"
        parts[key].extend((body, tip))
    return parts


def build_variant(context):
    import sys

    import bpy

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import map_prop_family_common as common

    if context["invariants"].get("collision") != "decorative-only":
        raise ValueError("ice crystals are decorative-only")
    common.reset_scene(context)
    rng = random.Random(context["seed"])
    mats = common.make_materials("FrozenCrystal", PALETTE)
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
