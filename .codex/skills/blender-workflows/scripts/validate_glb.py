#!/usr/bin/env python3
"""Validate structural and runtime facts in glTF 2.0 JSON or GLB files."""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path


GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A


def load_document(path: Path) -> dict:
    if path.suffix.lower() == ".gltf":
        return json.loads(path.read_text(encoding="utf-8"))
    if path.suffix.lower() != ".glb":
        raise ValueError(f"Unsupported file extension: {path.suffix}")

    payload = path.read_bytes()
    if len(payload) < 20:
        raise ValueError("GLB is shorter than the required header and JSON chunk")
    magic, version, declared_length = struct.unpack_from("<III", payload, 0)
    if magic != GLB_MAGIC:
        raise ValueError("Invalid GLB magic")
    if version != 2:
        raise ValueError(f"Unsupported GLB version: {version}")
    if declared_length != len(payload):
        raise ValueError(f"Declared GLB length {declared_length} differs from file size {len(payload)}")

    offset = 12
    while offset + 8 <= len(payload):
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunk = payload[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            return json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\x00"))
    raise ValueError("GLB has no JSON chunk")


def accessor_count(document: dict, index: int | None, errors: list[str]) -> int:
    if index is None:
        return 0
    accessors = document.get("accessors", [])
    if not isinstance(index, int) or not 0 <= index < len(accessors):
        errors.append(f"Invalid accessor index: {index}")
        return 0
    return int(accessors[index].get("count", 0))


def primitive_triangles(mode: int, count: int) -> int:
    if mode == 4:
        return count // 3
    if mode in {5, 6}:
        return max(0, count - 2)
    return 0


def inspect(path: Path, args: argparse.Namespace) -> dict:
    document = load_document(path)
    errors: list[str] = []
    warnings: list[str] = []
    meshes = document.get("meshes", [])
    accessors = document.get("accessors", [])
    primitives = []
    triangle_count = 0
    exported_vertices = 0
    morph_primitives = 0
    morph_targets = 0

    for mesh_index, mesh in enumerate(meshes):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            mode = int(primitive.get("mode", 4))
            position_accessor = primitive.get("attributes", {}).get("POSITION")
            vertices = accessor_count(document, position_accessor, errors)
            element_count = accessor_count(document, primitive.get("indices"), errors) or vertices
            triangles = primitive_triangles(mode, element_count)
            targets = primitive.get("targets", [])
            if targets:
                morph_primitives += 1
                morph_targets += len(targets)
            triangle_count += triangles
            exported_vertices += vertices
            primitives.append(
                {
                    "mesh": mesh_index,
                    "primitive": primitive_index,
                    "mode": mode,
                    "vertices": vertices,
                    "triangles": triangles,
                    "material": primitive.get("material"),
                    "morph_targets": len(targets),
                }
            )

    materials = []
    for material in document.get("materials", []):
        materials.append(
            {
                "name": material.get("name"),
                "alpha_mode": material.get("alphaMode", "OPAQUE"),
                "alpha_cutoff": material.get("alphaCutoff"),
                "double_sided": bool(material.get("doubleSided", False)),
                "metallic": material.get("pbrMetallicRoughness", {}).get("metallicFactor", 1.0),
                "roughness": material.get("pbrMetallicRoughness", {}).get("roughnessFactor", 1.0),
            }
        )

    animations = []
    for animation in document.get("animations", []):
        paths: dict[str, int] = {}
        for channel in animation.get("channels", []):
            path_name = channel.get("target", {}).get("path", "unknown")
            paths[path_name] = paths.get(path_name, 0) + 1
        animations.append({"name": animation.get("name"), "channels": len(animation.get("channels", [])), "paths": paths})

    used = set(document.get("extensionsUsed", []))
    required = set(document.get("extensionsRequired", []))
    if not required.issubset(used):
        errors.append("extensionsRequired contains entries missing from extensionsUsed")
    if not meshes:
        errors.append("No meshes found")
    if args.require_animation and not animations:
        errors.append("Animation required but none found")
    if args.require_morphs and not morph_primitives:
        errors.append("Morph targets required but none found")
    if args.max_triangles is not None and triangle_count > args.max_triangles:
        errors.append(f"Triangle count {triangle_count} exceeds maximum {args.max_triangles}")
    if args.expect_meshes is not None and len(meshes) != args.expect_meshes:
        errors.append(f"Expected {args.expect_meshes} meshes, found {len(meshes)}")

    if any(material["alpha_mode"] == "BLEND" for material in materials):
        warnings.append("BLEND materials require runtime sorting; confirm this is intentional")
    if any(material["alpha_mode"] == "MASK" and material["alpha_cutoff"] is None for material in materials):
        warnings.append("MASK material uses the implicit glTF alpha cutoff of 0.5")

    return {
        "file": str(path.resolve()),
        "bytes": path.stat().st_size,
        "asset": document.get("asset", {}),
        "scene_count": len(document.get("scenes", [])),
        "node_count": len(document.get("nodes", [])),
        "mesh_count": len(meshes),
        "primitive_count": len(primitives),
        "accessor_count": len(accessors),
        "exported_vertices": exported_vertices,
        "triangles": triangle_count,
        "morph_primitives": morph_primitives,
        "morph_targets_total": morph_targets,
        "materials": materials,
        "animations": animations,
        "extensions_used": sorted(used),
        "extensions_required": sorted(required),
        "primitives": primitives,
        "errors": errors,
        "warnings": warnings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-animation", action="store_true")
    parser.add_argument("--require-morphs", action="store_true")
    parser.add_argument("--max-triangles", type=int)
    parser.add_argument("--expect-meshes", type=int)
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.output and len(args.files) != 1:
        raise ValueError("--output can only be used with one input file")
    reports = [inspect(path, args) for path in args.files]
    result = reports[0] if len(reports) == 1 else reports
    payload = json.dumps(result, indent=2, sort_keys=True)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    failed = any(report["errors"] or (args.fail_on_warning and report["warnings"]) for report in reports)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
