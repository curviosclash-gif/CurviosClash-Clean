#!/usr/bin/env python3
"""Validate a Blender batch generation report and emit consolidated machine-readable QA."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def metric_summary(values: list[int | float]) -> dict[str, int | float]:
    return {
        "min": min(values),
        "median": statistics.median(values),
        "max": max(values),
    }


def resolve_output(path_text: str, output_directory: Path) -> Path:
    path = Path(path_text)
    return path if path.is_absolute() else output_directory / path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--generation-report", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--skip-file-check", action="store_true")
    parser.add_argument("--strict-warnings", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = load_json(args.manifest, "manifest")
        generation = load_json(args.generation_report, "generation report")
        if manifest.get("schema_version") != 2:
            raise ValueError("manifest schema_version must be 2")
        if generation.get("contract_hash") != manifest.get("contract_hash"):
            raise ValueError("generation report contract_hash does not match manifest")
        provenance = manifest.get("provenance", {})
        if generation.get("generator_id") != provenance.get("generator_id"):
            raise ValueError("generation report generator_id does not match manifest provenance")
        if generation.get("generator_version") != provenance.get("generator_version"):
            raise ValueError("generation report generator_version does not match manifest provenance")
        variants = manifest.get("variants")
        generated = generation.get("variants")
        if not isinstance(variants, list) or not isinstance(generated, list):
            raise ValueError("manifest and generation report need variant arrays")
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    expected = {variant["id"]: variant for variant in variants}
    actual = {variant.get("id"): variant for variant in generated}
    selected = set(actual)
    errors: list[str] = []
    warnings: list[str] = []
    per_variant: dict[str, Any] = {}

    unknown_ids = sorted(selected - set(expected))
    if unknown_ids:
        errors.append(f"generation report contains unknown IDs: {', '.join(unknown_ids)}")

    required_metrics = manifest.get("qa", {}).get("required_metrics", [])
    required_outputs = manifest.get("outputs", {}).get("required_roles", [])
    if not isinstance(required_metrics, list) or not all(isinstance(item, str) for item in required_metrics):
        errors.append("qa.required_metrics must be an array of strings")
        required_metrics = []
    if not isinstance(required_outputs, list) or not all(isinstance(item, str) for item in required_outputs):
        errors.append("outputs.required_roles must be an array of strings")
        required_outputs = []

    budgets = manifest.get("budgets", {})
    output_directory = Path(generation.get("output_directory", args.generation_report.parent))
    metrics_by_name: dict[str, list[int | float]] = {}
    fingerprints: list[str] = []

    for variant_id in sorted(selected & set(expected)):
        result = actual[variant_id]
        variant_errors: list[str] = []
        variant_warnings = list(result.get("warnings", []))
        if result.get("status") != "success":
            variant_errors.append(result.get("error", "generator reported failure"))

        metrics = result.get("metrics", {})
        outputs = result.get("outputs", [])
        if not isinstance(metrics, dict):
            variant_errors.append("metrics is not an object")
            metrics = {}
        if not isinstance(outputs, list):
            variant_errors.append("outputs is not an array")
            outputs = []

        for metric in required_metrics:
            if metric not in metrics:
                variant_errors.append(f"missing required metric '{metric}'")

        for budget_name, limit in budgets.items():
            if budget_name.endswith("_max"):
                metric = budget_name[:-4]
                if metric in metrics and numeric(metrics[metric]) and numeric(limit) and metrics[metric] > limit:
                    variant_errors.append(f"{metric} {metrics[metric]} exceeds maximum {limit}")
            elif budget_name.endswith("_min"):
                metric = budget_name[:-4]
                if metric in metrics and numeric(metrics[metric]) and numeric(limit) and metrics[metric] < limit:
                    variant_errors.append(f"{metric} {metrics[metric]} is below minimum {limit}")

        roles = {output.get("role") for output in outputs if isinstance(output, dict)}
        for role in required_outputs:
            if role not in roles:
                variant_errors.append(f"missing required output role '{role}'")

        if not args.skip_file_check:
            for output in outputs:
                if not isinstance(output, dict) or not isinstance(output.get("path"), str):
                    variant_errors.append("output entry needs a string path")
                    continue
                path = resolve_output(output["path"], output_directory)
                try:
                    path.resolve().relative_to(output_directory.resolve())
                except ValueError:
                    variant_errors.append(f"output path escapes batch directory: {path}")
                    continue
                if not path.is_file():
                    variant_errors.append(f"missing output file: {path}")

        if manifest.get("qa", {}).get("roundtrip_import") is True and metrics.get("roundtrip_import") is not True:
            variant_errors.append("roundtrip_import was required but not confirmed")

        for name, value in metrics.items():
            if numeric(value):
                metrics_by_name.setdefault(name, []).append(value)
        if isinstance(metrics.get("fingerprint"), str):
            fingerprints.append(metrics["fingerprint"])

        per_variant[variant_id] = {
            "status": "failed" if variant_errors else ("warning" if variant_warnings else "passed"),
            "errors": variant_errors,
            "warnings": variant_warnings,
            "metrics": metrics,
        }
        errors.extend(f"{variant_id}: {message}" for message in variant_errors)
        warnings.extend(f"{variant_id}: {message}" for message in variant_warnings)

    parameter_hashes = Counter(expected[variant_id].get("parameter_hash") for variant_id in selected & set(expected))
    duplicate_parameter_sets = sorted(key for key, amount in parameter_hashes.items() if key and amount > 1)
    if duplicate_parameter_sets:
        warnings.append(f"duplicate parameter sets: {', '.join(duplicate_parameter_sets)}")
    fingerprint_counts = Counter(fingerprints)
    duplicate_fingerprints = sorted(key for key, amount in fingerprint_counts.items() if amount > 1)
    if duplicate_fingerprints:
        warnings.append(f"duplicate asset fingerprints: {', '.join(duplicate_fingerprints)}")

    status = "FAILED" if errors else ("PASSED_WITH_WARNINGS" if warnings else "PASSED")
    if args.strict_warnings and warnings:
        status = "FAILED"
    report = {
        "schema_version": 1,
        "state": "REVISION_REQUIRED" if status == "FAILED" else "VALIDATED",
        "status": status,
        "object_id": manifest.get("object_id"),
        "contract_hash": manifest.get("contract_hash"),
        "selected_count": len(selected),
        "passed_count": sum(item["status"] == "passed" for item in per_variant.values()),
        "warning_count": len(warnings),
        "error_count": len(errors),
        "errors": errors,
        "warnings": warnings,
        "metric_summary": {
            name: metric_summary(values) for name, values in sorted(metrics_by_name.items()) if values
        },
        "variants": per_variant,
    }
    output = args.output or (args.generation_report.parent / "qa-report.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"QA {status}: {len(per_variant)} variants, {len(errors)} errors, "
        f"{len(warnings)} warnings -> {output}"
    )
    return 1 if status == "FAILED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
