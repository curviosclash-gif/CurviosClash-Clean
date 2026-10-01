#!/usr/bin/env python3
"""Build one marketplace ancient-tree variant through the pinned source generator.

Run through the `blender-object-batches` runner, inside Blender 4.2 LTS:

    blender --background --factory-startup --python-exit-code 1 \
        --python <skill>/scripts/run_batch.py -- \
        --manifest <external>/variants.json \
        --generator scripts/generate_marketplace_trees.py \
        --output-dir <external>/batch

Contract for this module
------------------------
Identity        GENERATOR_ID "marketplace-ancient-nature", version 1.0.0.
Interface       build_variant(context) -> {outputs, metrics, warnings, metadata}.
Source pin      The wrapped `scripts/generate_ancient_tree_asset.py` is read
                only and must match SHA256
                6546b76ca383c98e5d6a057b0ff0a763c3d7ee46200060b3d67ff788e106da46.
                A changed source aborts before generation; the pin is never
                updated silently.
Parameters      context["parameters"] carries exactly the six TreeParameters
                fields height_scale, crown_scale, crown_aspect,
                branch_density_scale, foliage_density_scale and wind_scale.
                context["id"] is the variant name and context["seed"] is the
                only stochastic source. The pinned generator is never called
                with its default arguments and its `main` is never used.
Outputs         <output_dir>/AncientTree/Blender/AncientTree.blend (editable)
                and <output_dir>/AncientTree/Game/ancient_tree.glb,
                ancient_tree_lod1.glb, ancient_tree_lod2.glb,
                ancient_tree_collision.glb. Roles: editable, runtime, lod1,
                lod2, collision.
Units/axes      Source and runtime are metres; the source blend is Z-up and
                the GLB is exported Y-up. The base sits on the ground plane.
Wind            The pinned generator writes two shape-key wind clips (foliage
                and fine branches). Both must survive the export, and the
                imported GLB must still carry the positive and negative gust.
LOD repair      The pinned LOD export loses `matrix_world` on evaluated
                duplicates, which moves ShelfFungi and TrunkCavities to the
                origin. `package_ancient_tree_marketplace.restore_lod_transforms`
                restores the hero transforms in the generated LOD copies
                without touching their mesh buffers.
QA              `package_ancient_tree_marketplace.blender_worker` re-imports
                every GLB into an empty scene, compares hero bounds with the
                authoring scene, samples nine wind poses and renders four
                source views, three imported wind poses and both LODs into
                <output_dir>/Media. `roundtrip_import` is only reported as true
                after that worker has written QA.json successfully.
Budgets         Hero <= 120000 triangles, <= 8 materials, <= 10 000 000 bytes.
No claims       No engine-specific compatibility claim is made here.

The module is importable without `bpy`: the pinned source and the marketplace
helper are loaded lazily, and the dataclass-based source module is registered
in `sys.modules` before execution so `dataclasses` can resolve its annotations.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

# Importing the pinned source and the sale helper must not leave `__pycache__`
# inside the repository.
sys.dont_write_bytecode = True

GENERATOR_ID = "marketplace-ancient-nature"
GENERATOR_VERSION = "1.0.0"

SOURCE_RELATIVE = "scripts/generate_ancient_tree_asset.py"
SOURCE_SHA256 = "6546b76ca383c98e5d6a057b0ff0a763c3d7ee46200060b3d67ff788e106da46"
HELPER_RELATIVE = "scripts/package_ancient_tree_marketplace.py"

PARAMETER_FIELDS = (
    "height_scale",
    "crown_scale",
    "crown_aspect",
    "branch_density_scale",
    "foliage_density_scale",
    "wind_scale",
)

# Advisory windows derived from the pinned generator's own variant ranges and
# the budgets of the canonical hero (113116 triangles, 9112788 bytes). Values
# outside them still build, but they are reported as warnings because the
# pinned source may then reject the silhouette or exceed the hero budget.
ADVISORY_RANGES = {
    "height_scale": (0.88, 1.12),
    "crown_scale": (0.88, 1.14),
    "crown_aspect": (0.90, 1.10),
    "branch_density_scale": (0.95, 1.10),
    "foliage_density_scale": (0.78, 1.02),
    "wind_scale": (0.50, 1.60),
}

BUDGETS = {
    "triangles_max": 120000,
    "materials_max": 8,
    "file_size_bytes_max": 10000000,
}

PACKAGE_NAME = "AncientTree"
PREVIEW_DIRECTORY = "GeneratorPreview"
MODEL_NAMES = (
    "ancient_tree.glb",
    "ancient_tree_lod1.glb",
    "ancient_tree_lod2.glb",
    "ancient_tree_collision.glb",
)
# Relative names that prove a delivery already exists in an output directory.
OUTPUT_MARKERS = (PACKAGE_NAME, "Media", "QA.json", PREVIEW_DIRECTORY)

_MODULE_CACHE: dict[str, object] = {}


# ---------------------------------------------------------------------------
# Pinning and module loading (no bpy)
# ---------------------------------------------------------------------------

def repository_root():
    return Path(__file__).resolve().parents[1]


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_source_pin(source_path=None, expected=None):
    """Prove the wrapped generator is still the reviewed revision.

    The pin is compared before any geometry is built; it is never updated by
    this module. Returns provenance data for the result metadata.
    """
    source = Path(source_path) if source_path is not None else repository_root() / SOURCE_RELATIVE
    expected = expected or SOURCE_SHA256
    if not source.is_file():
        raise ValueError(f"pinned ancient-tree source is missing: {source}")
    actual = digest(source)
    if actual != expected:
        raise ValueError(
            "ancient-tree source pin mismatch for "
            f"{source}: expected {expected}, got {actual}. "
            "Review the provenance of the change instead of updating the pin silently.")
    return {"path": str(source.resolve()), "sha256": actual}


def _load_module(name, path):
    path = Path(path)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load module from {path}")
    module = importlib.util.module_from_spec(spec)
    # Register before execution: the source module defines dataclasses with
    # `from __future__ import annotations`, and dataclasses resolves string
    # annotations through sys.modules[cls.__module__].
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def load_source_generator(source_path=None):
    """Import the pinned ancient-tree generator with a verified pin."""
    pin = verify_source_pin(source_path)
    cache_key = pin["path"]
    cached = _MODULE_CACHE.get(cache_key)
    if cached is None:
        cached = _load_module("marketplace_ancient_tree_source", Path(pin["path"]))
        _MODULE_CACHE[cache_key] = cached
    return cached


def load_marketplace_helper():
    """Import the reviewed sale helper without running its main()."""
    path = repository_root() / HELPER_RELATIVE
    cache_key = str(path.resolve())
    cached = _MODULE_CACHE.get(cache_key)
    if cached is None:
        cached = _load_module("marketplace_ancient_tree_helper", path)
        _MODULE_CACHE[cache_key] = cached
    return cached


# ---------------------------------------------------------------------------
# Input validation and output safety (no bpy)
# ---------------------------------------------------------------------------

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
            "Refusing to write generated tree assets inside a Git worktree: " + str(target))
    existing = [name for name in markers if (target / name).exists()]
    if existing:
        raise FileExistsError(
            "Refusing to overwrite an existing tree delivery in "
            f"{target}: {', '.join(sorted(existing))}")
    target.mkdir(parents=True, exist_ok=True)
    return target


def extract_tree_parameters(context):
    """Read exactly the six TreeParameters fields plus id and seed."""
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    name = context.get("id")
    if not isinstance(name, str) or not name:
        raise ValueError("context id must be a non-empty string")
    seed = context.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("context seed must be an integer")
    parameters = context.get("parameters")
    if not isinstance(parameters, dict):
        raise ValueError("context parameters must be an object")
    values = {}
    for field in PARAMETER_FIELDS:
        if field not in parameters:
            raise ValueError(f"missing tree parameter '{field}'")
        value = parameters[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"tree parameter '{field}' must be a number")
        value = float(value)
        if not math.isfinite(value) or value <= 0.0:
            raise ValueError(f"tree parameter '{field}' must be a positive finite number")
        values[field] = value
    return {"name": name, "seed": seed, **values}


def tree_parameter_warnings(prepared):
    warnings = []
    for field, (low, high) in ADVISORY_RANGES.items():
        value = prepared[field]
        if value < low or value > high:
            warnings.append(
                f"{field}={value} is outside the reviewed window [{low}, {high}]; "
                "the pinned source may reject the silhouette or exceed the hero budget")
    return warnings


def context_output_dir(context):
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    return context.get("output_dir")


def _plain(value):
    """Convert Blender ID-property containers into plain JSON data."""
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if hasattr(value, "keys"):
        return {str(key): _plain(value[key]) for key in value.keys()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    try:
        return [_plain(item) for item in value]
    except TypeError:
        return str(value)


def read_source_scene_metrics(tree_module):
    """Read the pinned generator's own validation facts from the live scene."""
    scene = tree_module.bpy.context.scene
    return {
        "mesh_count": int(scene.get("mesh_count", 0)),
        "face_count": int(scene.get("face_count", 0)),
        "bounds_m": [float(value) for value in scene.get("bounds_m", [])],
        "branch_counts": _plain(scene.get("branch_counts", {})),
        "crown_footprint_ratio": float(scene.get("crown_footprint_ratio", 0.0)),
        "variant": str(scene.get("variant", "")),
        "variant_seed": int(scene.get("variant_seed", 0)),
    }


def ensure_metric_source(tree_module, blend_path):
    """Make the metre contract explicit in the editable source and re-save it.

    The pinned generator builds numerically in metres but leaves Blender's unit
    display unset. Setting it and saving again does not touch any geometry, and
    the marketplace worker still validates the same scene afterwards.
    """
    bpy = tree_module.bpy
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene["unit_system"] = "METRIC"
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    return {"system": "METRIC", "scale_length": 1.0}


# ---------------------------------------------------------------------------
# build_variant
# ---------------------------------------------------------------------------

def build_variant(context):
    prepared = extract_tree_parameters(context)
    warnings = tree_parameter_warnings(prepared)
    output_dir = prepare_variant_output_dir(context_output_dir(context))
    package = output_dir / PACKAGE_NAME

    tree = load_source_generator()
    # The pinned module prints output paths relative to its ROOT; point that at
    # the external delivery root without touching the reviewed source file.
    tree.ROOT = output_dir
    outputs = tree.TreeOutputPaths(
        asset_dir=package / "Game",
        preview_dir=output_dir / PREVIEW_DIRECTORY,
        blend_path=package / "Blender" / "AncientTree.blend",
        glb_path=package / "Game" / "ancient_tree.glb",
        lod1_path=package / "Game" / "ancient_tree_lod1.glb",
        lod2_path=package / "Game" / "ancient_tree_lod2.glb",
        collision_path=package / "Game" / "ancient_tree_collision.glb",
    )
    parameters = tree.TreeParameters(name=prepared["name"], seed=prepared["seed"],
                                     **{field: prepared[field] for field in PARAMETER_FIELDS})
    requested = {field: prepared[field] for field in PARAMETER_FIELDS}
    try:
        summary = tree.generate_tree(parameters, outputs, render_all=False)
    except Exception as exc:  # surface the pinned generator's reason verbatim
        raise RuntimeError(
            f"pinned ancient-tree build failed for {prepared['name']} ({requested}): {exc}"
        ) from exc
    source_metrics = read_source_scene_metrics(tree)
    source_units = ensure_metric_source(tree, outputs.blend_path)

    helper = load_marketplace_helper()
    adjustments = {}
    for label, lod_path in (("LOD1", outputs.lod1_path), ("LOD2", outputs.lod2_path)):
        adjustments[label] = helper.restore_lod_transforms(outputs.glb_path, lod_path, label)

    # True empty-scene imports, source parity, wind sampling and every render.
    helper.blender_worker(output_dir)
    reports = json.loads((output_dir / "QA.json").read_text(encoding="utf-8"))
    return assemble_result(prepared, output_dir, outputs, summary, reports, adjustments,
                           warnings, source_metrics, source_units)


def assemble_result(prepared, output_dir, outputs, summary, reports, adjustments,
                    warnings, source_metrics, source_units):
    missing = [name for name in MODEL_NAMES if name not in reports]
    if missing:
        raise RuntimeError(f"worker QA.json is missing models: {missing}")
    hero = reports["ancient_tree.glb"]
    lod1 = reports["ancient_tree_lod1.glb"]
    lod2 = reports["ancient_tree_lod2.glb"]
    collision = reports["ancient_tree_collision.glb"]

    triangles = int(hero["triangles"])
    materials = len(hero.get("materials", []))
    size_bytes = int(hero["bytes"])
    if triangles > BUDGETS["triangles_max"]:
        raise RuntimeError(f"hero triangle budget exceeded: {triangles} > "
                           f"{BUDGETS['triangles_max']}")
    if materials > BUDGETS["materials_max"]:
        raise RuntimeError(f"hero material budget exceeded: {materials} > "
                           f"{BUDGETS['materials_max']}")
    if size_bytes > BUDGETS["file_size_bytes_max"]:
        raise RuntimeError(f"hero file-size budget exceeded: {size_bytes} > "
                           f"{BUDGETS['file_size_bytes_max']}")
    if hero.get("roundtrip_triangles") != triangles:
        raise RuntimeError("worker roundtrip triangle count does not match the GLB")
    for label, report in (("LOD1", lod1), ("LOD2", lod2)):
        if not report.get("node_transforms_match_hero"):
            raise RuntimeError(f"{label} placement does not match the hero after repair")
    poses = hero.get("wind_poses") or []
    if len(poses) != 9:
        raise RuntimeError(f"expected nine imported wind poses, found {len(poses)}")

    worker_warnings = []
    for name in MODEL_NAMES:
        for message in reports[name].get("warnings", []):
            worker_warnings.append(f"{name}: {message}")
    warnings = list(warnings) + worker_warnings

    helper_path = repository_root() / HELPER_RELATIVE
    fingerprint_payload = {
        "variant": prepared["name"],
        "seed": prepared["seed"],
        "parameters": {field: prepared[field] for field in PARAMETER_FIELDS},
        "triangles": triangles,
        "bounds": hero.get("bounds_m"),
    }
    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:20]

    metrics = {
        "triangles": triangles,
        "materials": materials,
        "file_size_bytes": size_bytes,
        "lod1_triangles": int(lod1["triangles"]),
        "lod2_triangles": int(lod2["triangles"]),
        "collision_triangles": int(collision["triangles"]),
        "wind_duration_seconds": hero.get("wind_duration_seconds"),
        "roundtrip_import": True,
        "fingerprint": fingerprint,
    }
    metadata = {
        "generator_id": GENERATOR_ID,
        "generator_version": GENERATOR_VERSION,
        "variant_id": prepared["name"],
        "parameters": {field: prepared[field] for field in PARAMETER_FIELDS},
        "seed": prepared["seed"],
        "source_pin": {"path": SOURCE_RELATIVE, "sha256": SOURCE_SHA256},
        "helper_sha256": digest(helper_path) if helper_path.is_file() else None,
        "source_scene": source_metrics,
        "source_units": source_units,
        "base_origin_z": (hero.get("source_bounds_m") or {}).get("min", [None, None, None])[2],
        "branch_counts": summary.get("branch_counts"),
        "models": {
            name: {
                "bytes": int(reports[name]["bytes"]),
                "triangles": int(reports[name]["triangles"]),
                "mesh_count": int(reports[name].get("mesh_count", 0)),
                "materials": len(reports[name].get("materials", [])),
                "bounds_m": reports[name].get("bounds_m"),
            }
            for name in MODEL_NAMES
        },
        "lod_transform_adjustments": adjustments,
        "wind": {
            "duration_seconds": hero.get("wind_duration_seconds"),
            "peak_fraction": hero.get("wind_peak_fraction"),
            "clip_count": len(hero.get("animations", [])),
        },
        "preview": str((output_dir / PREVIEW_DIRECTORY / "ancient_tree_front.png").resolve()),
        "media_directory": str((output_dir / "Media").resolve()),
        "qa_path": str((output_dir / "QA.json").resolve()),
        "source_pin_verified": True,
    }
    return {
        "outputs": [
            {"role": "editable", "path": str(outputs.blend_path.resolve())},
            {"role": "runtime", "path": str(outputs.glb_path.resolve())},
            {"role": "lod1", "path": str(outputs.lod1_path.resolve())},
            {"role": "lod2", "path": str(outputs.lod2_path.resolve())},
            {"role": "collision", "path": str(outputs.collision_path.resolve())},
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
