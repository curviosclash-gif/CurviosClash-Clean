#!/usr/bin/env python3
"""Compile a strict object contract into a deterministic Blender variant manifest."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import random
import re
import string
import sys
from collections import Counter
from pathlib import Path
from typing import Any


GENERATOR_VERSION = "2.0.0"
OBJECT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ROLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
SUPPORTED_TYPES = {"float", "int", "choice", "bool", "fixed"}
SAMPLING_MODES = {"coverage", "appendable"}
GENERATABLE_STATES = {"CONTRACT_LOCKED", "PROTOTYPE_APPROVED", "REVISION_REQUIRED"}
TOP_LEVEL_FIELDS = {
    "schema_version",
    "contract_revision",
    "object_id",
    "lifecycle",
    "count",
    "seed",
    "sampling",
    "naming_pattern",
    "invariants",
    "parameters",
    "design_roles",
    "constraints",
    "build_profile",
    "outputs",
    "budgets",
    "qa",
    "provenance",
}
REQUIRED_TOP_LEVEL_FIELDS = {
    "schema_version",
    "contract_revision",
    "object_id",
    "lifecycle",
    "count",
    "seed",
    "sampling",
    "naming_pattern",
    "invariants",
    "parameters",
    "build_profile",
    "outputs",
    "budgets",
    "qa",
    "provenance",
}
PARAMETER_FIELDS_BY_TYPE = {
    "float": {"type", "min", "max", "precision", "canonical", "strata_group", "invert"},
    "int": {"type", "min", "max", "precision", "canonical", "strata_group", "invert"},
    "choice": {"type", "values", "canonical", "strata_group", "invert"},
    "bool": {"type", "canonical", "strata_group", "invert"},
    "fixed": {"type", "value", "canonical"},
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: Any, length: int = 16) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()[:length]


def stable_seed(*parts: object) -> int:
    payload = "\x1f".join(str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def load_contract(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read contract: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("contract root must be a JSON object")
    return data


def reject_unknown(mapping: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise ValueError(f"{label} contains unknown fields: {', '.join(unknown)}")


def require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def require_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    if not math.isfinite(float(value)):
        raise ValueError(f"{label} must be finite")
    return float(value)


def value_matches_spec(value: Any, spec: dict[str, Any]) -> bool:
    kind = spec["type"]
    if kind == "float":
        return (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and float(spec["min"]) <= float(value) <= float(spec["max"])
        )
    if kind == "int":
        return (
            not isinstance(value, bool)
            and isinstance(value, int)
            and int(spec["min"]) <= value <= int(spec["max"])
        )
    if kind == "choice":
        return value in spec["values"]
    if kind == "bool":
        return isinstance(value, bool)
    return value == spec["value"]


def validate_parameter(name: str, spec: dict[str, Any]) -> None:
    kind = spec.get("type")
    if kind not in SUPPORTED_TYPES:
        raise ValueError(f"parameter '{name}' has unsupported type '{kind}'")
    reject_unknown(spec, PARAMETER_FIELDS_BY_TYPE[kind], f"parameter '{name}'")

    group = spec.get("strata_group")
    if group is not None and (not isinstance(group, str) or not group):
        raise ValueError(f"parameter '{name}' strata_group must be a non-empty string")
    if "invert" in spec and not isinstance(spec["invert"], bool):
        raise ValueError(f"parameter '{name}' invert must be boolean")

    if kind in {"float", "int"}:
        lower = require_number(spec.get("min"), f"{name}.min")
        upper = require_number(spec.get("max"), f"{name}.max")
        if lower > upper:
            raise ValueError(f"parameter '{name}' has min greater than max")
        if kind == "int" and (not lower.is_integer() or not upper.is_integer()):
            raise ValueError(f"integer parameter '{name}' needs integer bounds")
        precision = spec.get("precision", 4)
        if isinstance(precision, bool) or not isinstance(precision, int) or not 0 <= precision <= 12:
            raise ValueError(f"parameter '{name}' precision must be from 0 to 12")
    elif kind == "choice":
        values = spec.get("values")
        if not isinstance(values, list) or not values:
            raise ValueError(f"choice parameter '{name}' needs a non-empty values list")
        if len({canonical_json(value) for value in values}) != len(values):
            raise ValueError(f"choice parameter '{name}' contains duplicate values")
    elif kind == "fixed" and "value" not in spec:
        raise ValueError(f"fixed parameter '{name}' needs a value")

    if "canonical" in spec and not value_matches_spec(spec["canonical"], spec):
        raise ValueError(f"parameter '{name}' canonical value does not match its type or bounds")


def validate_design_roles(
    roles: Any, count: int, parameters: dict[str, dict[str, Any]]
) -> dict[int, dict[str, Any]]:
    if roles is None:
        return {}
    if not isinstance(roles, list):
        raise ValueError("design_roles must be an array")
    result: dict[int, dict[str, Any]] = {}
    role_names: set[str] = set()
    for offset, role in enumerate(roles):
        role = require_mapping(role, f"design_roles[{offset}]")
        reject_unknown(role, {"index", "name", "overrides"}, f"design_roles[{offset}]")
        index = role.get("index")
        name = role.get("name")
        overrides = role.get("overrides", {})
        if isinstance(index, bool) or not isinstance(index, int) or not 1 <= index <= count:
            raise ValueError(f"design_roles[{offset}].index must be from 1 to count")
        if index in result:
            raise ValueError(f"design role index {index} is duplicated")
        if not isinstance(name, str) or not ROLE_RE.fullmatch(name):
            raise ValueError(f"design_roles[{offset}].name must be a lowercase slug")
        if name in role_names:
            raise ValueError(f"design role name '{name}' is duplicated")
        role_names.add(name)
        overrides = require_mapping(overrides, f"design_roles[{offset}].overrides")
        for parameter, value in overrides.items():
            if parameter not in parameters:
                raise ValueError(f"design role '{name}' overrides unknown parameter '{parameter}'")
            if not value_matches_spec(value, parameters[parameter]):
                raise ValueError(f"design role '{name}' has invalid value for '{parameter}'")
        result[index] = {"name": name, "overrides": overrides}
    return result


def validate_constraints(
    constraints: Any, parameters: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    if constraints is None:
        return []
    if not isinstance(constraints, list):
        raise ValueError("constraints must be an array")
    validated = []
    for offset, constraint in enumerate(constraints):
        constraint = require_mapping(constraint, f"constraints[{offset}]")
        reject_unknown(constraint, {"when", "then"}, f"constraints[{offset}]")
        when = require_mapping(constraint.get("when"), f"constraints[{offset}].when")
        then = require_mapping(constraint.get("then"), f"constraints[{offset}].then")
        reject_unknown(when, {"parameter", "equals", "in"}, f"constraints[{offset}].when")
        reject_unknown(then, {"set", "disable", "clamp"}, f"constraints[{offset}].then")
        if not then:
            raise ValueError(f"constraints[{offset}].then must contain an action")
        source = when.get("parameter")
        if source not in parameters:
            raise ValueError(f"constraints[{offset}] references unknown parameter '{source}'")
        if ("equals" in when) == ("in" in when):
            raise ValueError(f"constraints[{offset}].when needs exactly one of equals or in")
        tests = when.get("in") if "in" in when else [when.get("equals")]
        if not isinstance(tests, list) or not tests:
            raise ValueError(f"constraints[{offset}].when.in must be a non-empty array")
        for value in tests:
            if not value_matches_spec(value, parameters[source]):
                raise ValueError(f"constraints[{offset}] has an invalid comparison value")

        setters = require_mapping(then.get("set", {}), f"constraints[{offset}].then.set")
        for target, value in setters.items():
            if target not in parameters or not value_matches_spec(value, parameters[target]):
                raise ValueError(f"constraints[{offset}] has invalid set value for '{target}'")

        disabled = then.get("disable", [])
        if not isinstance(disabled, list) or any(item not in parameters for item in disabled):
            raise ValueError(f"constraints[{offset}].then.disable contains an unknown parameter")
        if len(set(disabled)) != len(disabled):
            raise ValueError(f"constraints[{offset}].then.disable contains duplicates")

        clamps = require_mapping(then.get("clamp", {}), f"constraints[{offset}].then.clamp")
        for target, bounds in clamps.items():
            if target not in parameters or parameters[target]["type"] not in {"float", "int"}:
                raise ValueError(f"constraints[{offset}] can only clamp numeric parameters")
            bounds = require_mapping(bounds, f"constraints[{offset}].then.clamp.{target}")
            reject_unknown(bounds, {"min", "max"}, f"constraints[{offset}].then.clamp.{target}")
            if not bounds:
                raise ValueError(f"constraints[{offset}] clamp for '{target}' is empty")
            for side, value in bounds.items():
                number = require_number(value, f"constraints[{offset}].then.clamp.{target}.{side}")
                if parameters[target]["type"] == "int" and not number.is_integer():
                    raise ValueError(f"constraints[{offset}] needs integer clamp bounds for '{target}'")
        overlap = (set(setters) & set(disabled)) | (set(setters) & set(clamps)) | (set(disabled) & set(clamps))
        if overlap:
            raise ValueError(
                f"constraints[{offset}] applies conflicting actions to: {', '.join(sorted(overlap))}"
            )
        validated.append(constraint)
    return validated


def validate_contract(
    contract: dict[str, Any], count_override: int | None, seed_override: int | None
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[int, dict[str, Any]], list[dict[str, Any]]]:
    reject_unknown(contract, TOP_LEVEL_FIELDS, "contract")
    missing = sorted(REQUIRED_TOP_LEVEL_FIELDS - set(contract))
    if missing:
        raise ValueError(f"contract is missing required fields: {', '.join(missing)}")
    if contract.get("schema_version") != 2:
        raise ValueError("schema_version must be 2")
    revision = contract.get("contract_revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("contract_revision must be a positive integer")

    object_id = contract.get("object_id")
    if not isinstance(object_id, str) or not OBJECT_ID_RE.fullmatch(object_id):
        raise ValueError("object_id must use lowercase letters, digits, '_' or '-'")

    lifecycle = require_mapping(contract.get("lifecycle"), "lifecycle")
    reject_unknown(lifecycle, {"state", "prototype_id"}, "lifecycle")
    if lifecycle.get("state") not in GENERATABLE_STATES:
        allowed = ", ".join(sorted(GENERATABLE_STATES))
        raise ValueError(f"lifecycle.state must permit generation: {allowed}")
    if "prototype_id" in lifecycle and not isinstance(lifecycle["prototype_id"], str):
        raise ValueError("lifecycle.prototype_id must be a string")

    effective = copy.deepcopy(contract)
    count = count_override if count_override is not None else effective.get("count", 10)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 1000:
        raise ValueError("count must be an integer from 1 to 1000")
    seed = seed_override if seed_override is not None else effective.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    effective["count"] = count
    effective["seed"] = seed

    sampling = require_mapping(effective["sampling"], "sampling")
    reject_unknown(sampling, {"mode", "canonical_first"}, "sampling")
    if set(sampling) != {"mode", "canonical_first"}:
        raise ValueError("sampling needs exactly mode and canonical_first")
    if sampling["mode"] not in SAMPLING_MODES:
        raise ValueError("sampling.mode must be 'coverage' or 'appendable'")
    if not isinstance(sampling["canonical_first"], bool):
        raise ValueError("sampling.canonical_first must be boolean")
    effective["sampling"] = sampling

    naming_pattern = effective["naming_pattern"]
    if not isinstance(naming_pattern, str) or not naming_pattern:
        raise ValueError("naming_pattern must be a non-empty string")
    try:
        for _, field_name, _, conversion in string.Formatter().parse(naming_pattern):
            if field_name is not None and field_name not in {"object_id", "index"}:
                raise ValueError(f"unsupported field '{field_name}'")
            if conversion:
                raise ValueError("conversions are not supported")
        rendered_name = naming_pattern.format(object_id=object_id, index=1)
    except (KeyError, ValueError, IndexError) as exc:
        raise ValueError(f"invalid naming_pattern: {exc}") from exc
    if not rendered_name or any(separator in rendered_name for separator in ("/", "\\")):
        raise ValueError("naming_pattern must produce a file-safe name without path separators")
    effective["naming_pattern"] = naming_pattern

    parameters = require_mapping(effective.get("parameters"), "parameters")
    if not parameters:
        raise ValueError("parameters must not be empty")
    for name, spec in parameters.items():
        if not isinstance(name, str) or not name:
            raise ValueError("parameter names must be non-empty strings")
        validate_parameter(name, require_mapping(spec, f"parameter '{name}'"))

    roles = validate_design_roles(effective.get("design_roles"), count, parameters)
    constraints = validate_constraints(effective.get("constraints"), parameters)

    for field in ("invariants", "build_profile", "outputs", "budgets", "qa", "provenance"):
        effective[field] = require_mapping(effective.get(field, {}), field)

    budgets = effective["budgets"]
    for name, limit in budgets.items():
        if not re.fullmatch(r"[A-Za-z0-9_]+_(min|max)", name):
            raise ValueError(f"budget '{name}' must end in _min or _max")
        require_number(limit, f"budgets.{name}")
    for field, container in (
        ("outputs.required_roles", effective["outputs"].get("required_roles", [])),
        ("qa.required_metrics", effective["qa"].get("required_metrics", [])),
        ("qa.required_views", effective["qa"].get("required_views", [])),
    ):
        if not isinstance(container, list) or any(not isinstance(item, str) or not item for item in container):
            raise ValueError(f"{field} must be an array of non-empty strings")
        if len(set(container)) != len(container):
            raise ValueError(f"{field} must not contain duplicates")
    if "roundtrip_import" in effective["qa"] and not isinstance(effective["qa"]["roundtrip_import"], bool):
        raise ValueError("qa.roundtrip_import must be boolean")
    provenance = effective["provenance"]
    for field in ("generator_id", "generator_version"):
        if not isinstance(provenance.get(field), str) or not provenance[field]:
            raise ValueError(f"provenance.{field} must be a non-empty string")

    return effective, parameters, roles, constraints


def prime_numbers(count: int) -> list[int]:
    primes: list[int] = []
    candidate = 2
    while len(primes) < count:
        if all(candidate % prime for prime in primes if prime * prime <= candidate):
            primes.append(candidate)
        candidate += 1
    return primes


def van_der_corput(index: int, base: int) -> float:
    result = 0.0
    denominator = 1.0
    while index:
        index, remainder = divmod(index, base)
        denominator *= base
        result += remainder / denominator
    return result


def canonical_value(spec: dict[str, Any]) -> Any:
    if "canonical" in spec:
        return spec["canonical"]
    kind = spec["type"]
    if kind == "float":
        return round((float(spec["min"]) + float(spec["max"])) / 2, spec.get("precision", 4))
    if kind == "int":
        return round((int(spec["min"]) + int(spec["max"])) / 2)
    if kind == "choice":
        return spec["values"][0]
    if kind == "bool":
        return False
    return spec["value"]


def map_unit_value(unit: float, spec: dict[str, Any]) -> Any:
    if spec.get("invert", False):
        unit = 1.0 - unit
    kind = spec["type"]
    if kind == "float":
        lower = float(spec["min"])
        upper = float(spec["max"])
        return round(lower + unit * (upper - lower), spec.get("precision", 4))
    if kind == "int":
        lower = int(spec["min"])
        upper = int(spec["max"])
        return min(upper, lower + math.floor(unit * (upper - lower + 1)))
    if kind == "choice":
        values = spec["values"]
        return values[min(len(values) - 1, math.floor(unit * len(values)))]
    if kind == "bool":
        return unit >= 0.5
    return spec["value"]


def appendable_discrete_value(
    index: int, spec: dict[str, Any], seed: int, key: str
) -> Any:
    values = list(spec["values"]) if spec["type"] == "choice" else [False, True]
    canonical = canonical_value(spec)
    first_cycle = [canonical] + [value for value in values if value != canonical]
    cycle, position = divmod(index - 1, len(values))
    if cycle == 0:
        order = first_cycle
    else:
        order = list(values)
        random.Random(stable_seed(seed, "appendable-choice", key, cycle)).shuffle(order)
    if spec.get("invert", False):
        order = list(reversed(order))
    return order[position]


def coverage_units(size: int, seed: int, key: str) -> list[float]:
    if size <= 0:
        return []
    rng = random.Random(stable_seed(seed, "coverage", key))
    values = [(index + rng.random()) / size for index in range(size)]
    rng.shuffle(values)
    return values


def build_sample_matrix(
    parameters: dict[str, dict[str, Any]],
    count: int,
    seed: int,
    sampling: dict[str, Any],
) -> list[dict[str, Any]]:
    canonical_first = sampling["canonical_first"]
    exploration_start = 2 if canonical_first else 1
    exploration_size = count - 1 if canonical_first else count

    group_keys = sorted(
        {
            spec.get("strata_group", f"parameter:{name}")
            for name, spec in parameters.items()
            if spec["type"] != "fixed"
        }
    )
    bases = dict(zip(group_keys, prime_numbers(len(group_keys))))
    coverage = {
        key: coverage_units(exploration_size, seed, key) for key in group_keys
    }

    matrix: list[dict[str, Any]] = []
    for index in range(1, count + 1):
        if canonical_first and index == 1:
            matrix.append({name: canonical_value(spec) for name, spec in sorted(parameters.items())})
            continue
        ordinal = index - exploration_start
        values: dict[str, Any] = {}
        for name, spec in sorted(parameters.items()):
            if spec["type"] == "fixed":
                values[name] = spec["value"]
                continue
            key = spec.get("strata_group", f"parameter:{name}")
            if sampling["mode"] == "appendable" and spec["type"] in {"choice", "bool"}:
                values[name] = appendable_discrete_value(index, spec, seed, key)
                continue
            if sampling["mode"] == "coverage":
                unit = coverage[key][ordinal]
            else:
                unit = van_der_corput(ordinal + 1, bases[key])
            values[name] = map_unit_value(unit, spec)
        matrix.append(values)
    return matrix


def apply_constraints(values: dict[str, Any], constraints: list[dict[str, Any]]) -> dict[str, Any]:
    result = dict(values)
    for constraint in constraints:
        when = constraint["when"]
        current = result.get(when["parameter"])
        matched = current == when.get("equals") if "equals" in when else current in when["in"]
        if not matched:
            continue
        then = constraint["then"]
        result.update(then.get("set", {}))
        for target, bounds in then.get("clamp", {}).items():
            if target not in result:
                continue
            value = result[target]
            if "min" in bounds:
                value = max(value, bounds["min"])
            if "max" in bounds:
                value = min(value, bounds["max"])
            result[target] = value
        for target in then.get("disable", []):
            result.pop(target, None)
    return result


def coverage_summary(values: list[Any]) -> dict[str, Any]:
    if values and all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values):
        return {"min": min(values), "max": max(values), "unique": len(set(values))}
    counts = Counter(canonical_json(value) for value in values)
    return {"counts": {key: counts[key] for key in sorted(counts)}}


def build_manifest(
    contract: dict[str, Any], count_override: int | None = None, seed_override: int | None = None
) -> dict[str, Any]:
    source_hash = digest(contract)
    effective, parameters, roles, constraints = validate_contract(
        contract, count_override, seed_override
    )
    effective_hash = digest(effective)
    count = effective["count"]
    seed = effective["seed"]
    matrix = build_sample_matrix(parameters, count, seed, effective["sampling"])

    variants = []
    for offset, sampled in enumerate(matrix):
        index = offset + 1
        default_role = "canonical" if effective["sampling"]["canonical_first"] and index == 1 else "exploration"
        role = roles.get(index, {"name": default_role, "overrides": {}})
        sampled.update(role["overrides"])
        sampled = apply_constraints(sampled, constraints)
        for name, value in sampled.items():
            if name not in parameters or not value_matches_spec(value, parameters[name]):
                raise ValueError(f"variant {index} produced an invalid value for '{name}'")
        variants.append(
            {
                "id": effective["naming_pattern"].format(object_id=effective["object_id"], index=index),
                "index": index,
                "role": role["name"],
                "seed": stable_seed(seed, "variant", index) % (2**31),
                "parameter_hash": digest(sampled),
                "parameters": sampled,
            }
        )

    variant_ids = [variant["id"] for variant in variants]
    if len(set(variant_ids)) != count:
        raise ValueError("naming_pattern must produce a unique ID for every variant")

    coverage = {}
    for name in sorted(parameters):
        present = [variant["parameters"][name] for variant in variants if name in variant["parameters"]]
        coverage[name] = coverage_summary(present)

    return {
        "schema_version": 2,
        "manifest_generator_version": GENERATOR_VERSION,
        "object_id": effective["object_id"],
        "contract_revision": effective["contract_revision"],
        "source_contract_hash": source_hash,
        "contract_hash": effective_hash,
        "count": count,
        "seed": seed,
        "sampling": effective["sampling"],
        "lifecycle": effective["lifecycle"],
        "invariants": effective["invariants"],
        "constraints": constraints,
        "build_profile": effective["build_profile"],
        "outputs": effective["outputs"],
        "budgets": effective["budgets"],
        "qa": effective["qa"],
        "provenance": effective["provenance"],
        "coverage": coverage,
        "variants": variants,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract", type=Path, help="version 2 JSON object contract")
    parser.add_argument("--output", type=Path, help="manifest destination; stdout when omitted")
    parser.add_argument("--count", type=int, help="override the contract count")
    parser.add_argument("--seed", type=int, help="override the contract root seed")
    parser.add_argument("--pretty", action="store_true", help="indent JSON for human inspection")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = build_manifest(load_contract(args.contract), args.count, args.seed)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    payload = json.dumps(
        manifest,
        indent=2 if args.pretty else None,
        separators=None if args.pretty else (",", ":"),
        ensure_ascii=False,
    ) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
        print(
            f"generated {manifest['count']} {manifest['sampling']['mode']} variants "
            f"for {manifest['object_id']} (contract {manifest['contract_hash']}) -> {args.output}"
        )
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
