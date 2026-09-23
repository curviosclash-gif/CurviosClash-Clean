#!/usr/bin/env python3
"""Run one object generator module for selected variants in a compiled manifest."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable


REPORT_VERSION = 1


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def load_generator(
    path: Path,
) -> tuple[Callable[[dict[str, Any]], dict[str, Any]], str, str, str]:
    try:
        source = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"cannot read generator: {exc}") from exc
    module_name = f"blender_batch_generator_{hashlib.sha256(source).hexdigest()[:12]}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load generator module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    function = getattr(module, "build_variant", None)
    if not callable(function):
        raise ValueError("generator module must expose build_variant(context)")
    generator_id = getattr(module, "GENERATOR_ID", None)
    generator_version = getattr(module, "GENERATOR_VERSION", None)
    if not isinstance(generator_id, str) or not generator_id:
        raise ValueError("generator module must expose a non-empty GENERATOR_ID string")
    if not isinstance(generator_version, str) or not generator_version:
        raise ValueError("generator module must expose a non-empty GENERATOR_VERSION string")
    return function, hashlib.sha256(source).hexdigest()[:16], generator_id, generator_version


def validate_result(result: Any, variant_id: str) -> dict[str, Any]:
    if result is None:
        result = {}
    if not isinstance(result, dict):
        raise ValueError(f"{variant_id}: build_variant must return a JSON-compatible object")
    allowed = {"outputs", "metrics", "warnings", "metadata"}
    unknown = sorted(set(result) - allowed)
    if unknown:
        raise ValueError(f"{variant_id}: generator returned unknown fields: {', '.join(unknown)}")
    outputs = result.get("outputs", [])
    metrics = result.get("metrics", {})
    warnings = result.get("warnings", [])
    metadata = result.get("metadata", {})
    if not isinstance(outputs, list):
        raise ValueError(f"{variant_id}: outputs must be an array")
    for offset, output in enumerate(outputs):
        if not isinstance(output, dict) or set(output) - {"role", "path"}:
            raise ValueError(f"{variant_id}: outputs[{offset}] needs only role and path")
        if not isinstance(output.get("role"), str) or not isinstance(output.get("path"), str):
            raise ValueError(f"{variant_id}: outputs[{offset}] role and path must be strings")
    if not isinstance(metrics, dict):
        raise ValueError(f"{variant_id}: metrics must be an object")
    if not isinstance(warnings, list) or any(not isinstance(item, str) for item in warnings):
        raise ValueError(f"{variant_id}: warnings must be an array of strings")
    if not isinstance(metadata, dict):
        raise ValueError(f"{variant_id}: metadata must be an object")
    normalized = {"outputs": outputs, "metrics": metrics, "warnings": warnings, "metadata": metadata}
    try:
        json.dumps(normalized, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{variant_id}: generator result is not JSON-compatible: {exc}") from exc
    return normalized


def parse_only(values: list[str] | None) -> set[str] | None:
    if not values:
        return None
    result = {item.strip() for value in values for item in value.split(",") if item.strip()}
    return result or None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--generator", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--only", action="append", help="variant ID or comma-separated IDs")
    parser.add_argument("--fail-fast", action="store_true")
    return parser.parse_args(script_args())


def main() -> int:
    args = parse_args()
    try:
        manifest = load_json(args.manifest, "manifest")
        if manifest.get("schema_version") != 2 or not isinstance(manifest.get("variants"), list):
            raise ValueError("manifest must be a compiled version 2 variant manifest")
        build_variant, generator_hash, generator_id, generator_version = load_generator(args.generator)
        provenance = manifest.get("provenance", {})
        if provenance.get("generator_id") != generator_id:
            raise ValueError(
                f"generator ID '{generator_id}' does not match manifest provenance "
                f"'{provenance.get('generator_id')}'"
            )
        if provenance.get("generator_version") != generator_version:
            raise ValueError(
                f"generator version '{generator_version}' does not match manifest provenance "
                f"'{provenance.get('generator_version')}'"
            )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    selected_ids = parse_only(args.only)
    known_ids = {variant.get("id") for variant in manifest["variants"]}
    if selected_ids and not selected_ids <= known_ids:
        missing = ", ".join(sorted(selected_ids - known_ids))
        print(f"error: unknown variant IDs: {missing}", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    started = time.time()
    for variant in manifest["variants"]:
        variant_id = variant["id"]
        if selected_ids and variant_id not in selected_ids:
            continue
        variant_dir = args.output_dir / variant_id
        variant_dir.mkdir(parents=True, exist_ok=True)
        context = {
            "id": variant_id,
            "index": variant["index"],
            "role": variant["role"],
            "seed": variant["seed"],
            "parameter_hash": variant["parameter_hash"],
            "parameters": variant["parameters"],
            "invariants": manifest.get("invariants", {}),
            "build_profile": manifest.get("build_profile", {}),
            "outputs": manifest.get("outputs", {}),
            "budgets": manifest.get("budgets", {}),
            "provenance": manifest.get("provenance", {}),
            "contract_hash": manifest["contract_hash"],
            "output_dir": str(variant_dir.resolve()),
        }
        variant_started = time.time()
        try:
            result = validate_result(build_variant(context), variant_id)
            results.append(
                {
                    "id": variant_id,
                    "status": "success",
                    "duration_seconds": round(time.time() - variant_started, 6),
                    **result,
                }
            )
        except Exception as exc:  # generator failures must be isolated by variant
            results.append(
                {
                    "id": variant_id,
                    "status": "failed",
                    "duration_seconds": round(time.time() - variant_started, 6),
                    "error": f"{type(exc).__name__}: {exc}",
                    "outputs": [],
                    "metrics": {},
                    "warnings": [],
                    "metadata": {},
                }
            )
            if args.fail_fast:
                break

    failed = [result["id"] for result in results if result["status"] != "success"]
    report = {
        "schema_version": REPORT_VERSION,
        "state": "REVISION_REQUIRED" if failed else "GENERATED",
        "object_id": manifest["object_id"],
        "contract_hash": manifest["contract_hash"],
        "manifest_path": str(args.manifest.resolve()),
        "generator_path": str(args.generator.resolve()),
        "generator_hash": generator_hash,
        "generator_id": generator_id,
        "generator_version": generator_version,
        "output_directory": str(args.output_dir.resolve()),
        "requested_count": len(selected_ids) if selected_ids else manifest["count"],
        "completed_count": len(results),
        "failed_ids": failed,
        "duration_seconds": round(time.time() - started, 6),
        "variants": results,
    }
    report_path = args.report or (args.output_dir / "generation-report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"generated {len(results) - len(failed)}/{len(results)} selected variants; "
        f"report -> {report_path}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
