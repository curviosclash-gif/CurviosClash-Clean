#!/usr/bin/env python3
"""Generate ten deterministic, game-ready ancient-tree variants.

Run with Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_ancient_tree_variants.py
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import random
import sys

import bpy
import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import generate_ancient_tree_asset as tree  # noqa: E402


VARIANT_ROOT = tree.ASSET_DIR / "variants"


def stratified_values(count, low, high, seed):
    """Cover the full range without clustering all variants near the midpoint."""
    rng = random.Random(seed)
    bins = list(range(count))
    rng.shuffle(bins)
    values = []
    for bin_index in bins:
        position = (bin_index + rng.uniform(0.18, 0.82)) / count
        values.append(low + (high - low) * position)
    return values


def variant_parameters(count):
    ranges = {
        "height_scale": (0.90, 1.10),
        "crown_scale": (0.90, 1.12),
        "crown_aspect": (0.92, 1.08),
        "trunk_lean_x": (-0.65, 0.65),
        "trunk_lean_y": (-0.65, 0.65),
        "trunk_twist_deg": (-9.0, 9.0),
        "wood_thickness_scale": (0.88, 1.12),
        "branch_density_scale": (0.90, 1.12),
        "secondary_length_scale": (0.87, 1.14),
        "tertiary_length_scale": (0.86, 1.15),
        "fine_length_scale": (0.84, 1.16),
        "gravity_scale": (0.82, 1.18),
        "phototropism_scale": (0.85, 1.18),
        "foliage_density_scale": (0.84, 1.16),
        "foliage_spread_scale": (0.88, 1.12),
        "leaf_size_scale": (0.88, 1.12),
        "leaf_hue_shift": (-0.035, 0.035),
        "dry_leaf_ratio": (0.02, 0.085),
        "root_length_scale": (0.85, 1.16),
        "root_thickness_scale": (0.86, 1.16),
        "bark_scale": (0.82, 1.20),
        "bark_lightness": (0.82, 1.16),
        "bark_roughness": (0.93, 0.995),
        "deadwood_length_scale": (0.80, 1.25),
        "age_detail_scale": (0.82, 1.20),
        "wind_scale": (0.75, 1.25),
    }
    sampled = {
        name: stratified_values(count, low, high, 731 + index * 97)
        for index, (name, (low, high)) in enumerate(ranges.items())
    }
    root_counts = [10 + (index % 5) for index in range(count)]
    groove_counts = [5 + ((index * 3) % 5) for index in range(count)]
    random.Random(1701).shuffle(root_counts)
    random.Random(2718).shuffle(groove_counts)

    results = []
    for index in range(count):
        local_rng = random.Random(tree.SEED + (index + 1) * 7919)
        global_main_scale = local_rng.uniform(0.88, 1.14)
        main_lengths = tuple(
            global_main_scale * local_rng.uniform(0.94, 1.06)
            for _ in tree.MAIN_BRANCHES
        )
        main_elevations = tuple(
            local_rng.uniform(0.88, 1.12)
            for _ in tree.MAIN_BRANCHES
        )
        main_offsets = tuple(
            local_rng.uniform(-7.0, 7.0) * (0.45 if branch_index == 4 else 1.0)
            for branch_index, _branch in enumerate(tree.MAIN_BRANCHES)
        )
        values = {name: sampled[name][index] for name in ranges}
        results.append(tree.TreeParameters(
            name=f"variant_{index + 1:02d}",
            seed=tree.SEED + (index + 1) * 7919,
            main_length_scales=main_lengths,
            main_elevation_scales=main_elevations,
            main_azimuth_offsets_deg=main_offsets,
            root_count=root_counts[index],
            groove_count=groove_counts[index],
            **values,
        ))
    return results


def output_paths(index):
    label = f"variant_{index:02d}"
    directory = VARIANT_ROOT / label
    stem = f"ancient_tree_{index:02d}"
    return tree.TreeOutputPaths(
        asset_dir=directory,
        preview_dir=directory / "previews",
        blend_path=None,
        glb_path=directory / f"{stem}.glb",
        lod1_path=directory / f"{stem}_lod1.glb",
        lod2_path=directory / f"{stem}_lod2.glb",
        collision_path=directory / f"{stem}_collision.glb",
    )


def build_contact_sheet(previews, destination):
    images = [bpy.data.images.load(str(path), check_existing=False) for path in previews]
    try:
        width, height = images[0].size
        columns = 5
        rows = 2
        canvas = np.zeros((rows * height, columns * width, 4), dtype=np.float32)
        for index, image in enumerate(images):
            pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
            display_row = index // columns
            target_row = rows - display_row - 1
            column = index % columns
            canvas[target_row * height:(target_row + 1) * height,
                   column * width:(column + 1) * width] = pixels
        sheet = bpy.data.images.new("AncientTreeVariantContactSheet",
                                    width=columns * width, height=rows * height, alpha=True)
        sheet.pixels.foreach_set(canvas.ravel())
        sheet.filepath_raw = str(destination)
        sheet.file_format = "PNG"
        sheet.save()
        bpy.data.images.remove(sheet)
    finally:
        for image in images:
            bpy.data.images.remove(image)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--only", help="Comma-separated one-based variant indices")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(arguments)


def main():
    args = parse_args()
    if args.count != 10:
        raise ValueError("the approved variant set contains exactly ten trees")
    selected = ({int(value) for value in args.only.split(",")}
                if args.only else set(range(1, args.count + 1)))
    if not selected.issubset(set(range(1, args.count + 1))):
        raise ValueError(f"variant indices must be between 1 and {args.count}")

    VARIANT_ROOT.mkdir(parents=True, exist_ok=True)
    profiles = variant_parameters(args.count)
    manifest_entries = []
    preview_paths = []
    for index, parameters in enumerate(profiles, start=1):
        outputs = output_paths(index)
        if index in selected:
            summary = tree.generate_tree(parameters, outputs, render_all=False)
            print(f"completed {parameters.name}: {summary['branch_counts']}")
        preview_paths.append(outputs.preview_dir / "ancient_tree_front.png")
        entry = asdict(parameters)
        entry["files"] = {
            "hero": str(outputs.glb_path.relative_to(tree.ROOT)),
            "lod1": str(outputs.lod1_path.relative_to(tree.ROOT)),
            "lod2": str(outputs.lod2_path.relative_to(tree.ROOT)),
            "collision": str(outputs.collision_path.relative_to(tree.ROOT)),
            "preview": str(preview_paths[-1].relative_to(tree.ROOT)),
        }
        manifest_entries.append(entry)
        outputs.asset_dir.mkdir(parents=True, exist_ok=True)
        (outputs.asset_dir / "parameters.json").write_text(
            json.dumps(entry, indent=2) + "\n", encoding="utf-8")

    manifest = {
        "generator": "scripts/generate_ancient_tree_variants.py",
        "variant_count": args.count,
        "variation_method": "deterministic stratified sampling",
        "variants": manifest_entries,
    }
    (VARIANT_ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if all(path.exists() for path in preview_paths):
        build_contact_sheet(preview_paths, VARIANT_ROOT / "contact_sheet.png")
        print(f"generated {(VARIANT_ROOT / 'contact_sheet.png').relative_to(tree.ROOT)}")


if __name__ == "__main__":
    main()
