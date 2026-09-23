#!/usr/bin/env python3
"""Compare two batch manifests and plan the smallest safe regeneration scope."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 2:
        raise ValueError(f"{path} is not a version 2 manifest")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        old = load(args.old)
        new = load(args.new)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    old_variants = {item["id"]: item for item in old["variants"]}
    new_variants = {item["id"]: item for item in new["variants"]}
    shared = set(old_variants) & set(new_variants)
    added = sorted(set(new_variants) - set(old_variants))
    removed = sorted(set(old_variants) - set(new_variants))
    changed = sorted(
        variant_id
        for variant_id in shared
        if old_variants[variant_id].get("parameter_hash") != new_variants[variant_id].get("parameter_hash")
        or old_variants[variant_id].get("seed") != new_variants[variant_id].get("seed")
    )
    unchanged = sorted(shared - set(changed))

    family_fields = ("invariants", "build_profile")
    export_fields = ("outputs",)
    validation_fields = ("budgets", "qa")
    family_changed = any(old.get(field) != new.get(field) for field in family_fields)
    generator_changed = old.get("provenance") != new.get("provenance")
    export_changed = any(old.get(field) != new.get(field) for field in export_fields)
    validation_changed = any(old.get(field) != new.get(field) for field in validation_fields)

    if family_changed or generator_changed:
        changed = sorted(set(new_variants))
        unchanged = []

    plan = {
        "old_contract_hash": old.get("contract_hash"),
        "new_contract_hash": new.get("contract_hash"),
        "classification": {
            "family_or_generator_changed": family_changed or generator_changed,
            "export_contract_changed": export_changed,
            "validation_contract_changed": validation_changed,
        },
        "generate": sorted(set(added) | set(changed)),
        "reexport": sorted(set(new_variants) if export_changed else set()),
        "revalidate": sorted(set(new_variants) if validation_changed or changed or added else set()),
        "unchanged": unchanged,
        "removed_candidates": removed,
    }
    payload = json.dumps(plan, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
        print(f"regeneration plan -> {args.output}")
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
