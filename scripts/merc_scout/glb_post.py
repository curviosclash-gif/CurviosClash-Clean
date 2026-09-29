"""GLB post-processing and inspection that does not need Blender.

Blender's glTF exporter names animation clips ``<action>_<armature>`` when a file
carries several actions. Buyers expect ``Idle``, ``Walk``, ``Run``; this module
rewrites the JSON chunk of the GLB to get there, and reports what a file actually
contains (clips with duration, meshes with triangle counts, materials, images).

The GLB container is simple: a 12-byte header, then 4-byte-aligned chunks that each
carry an 8-byte header. Both chunks are rewritten together, because renaming the
animations changes the JSON length.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def read_glb(path: Path | str) -> tuple[dict, bytes]:
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"{path} is not a GLB file")
    if version != 2:
        raise ValueError(f"{path} uses glTF version {version}, expected 2")
    offset = 12
    gltf: dict | None = None
    binary = b""
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8: offset + 8 + chunk_length]
        if chunk_type == CHUNK_JSON:
            gltf = json.loads(payload.decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            binary = payload
        offset += 8 + chunk_length
    if gltf is None:
        raise ValueError(f"{path} carries no JSON chunk")
    return gltf, binary


def write_glb(path: Path | str, gltf: dict, binary: bytes) -> None:
    payload = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((4 - len(payload) % 4) % 4)
    chunks = struct.pack("<II", len(payload), CHUNK_JSON) + payload
    if binary:
        padded = binary + b"\x00" * ((4 - len(binary) % 4) % 4)
        chunks += struct.pack("<II", len(padded), CHUNK_BIN) + padded
    header = struct.pack("<III", GLB_MAGIC, 2, 12 + len(chunks))
    Path(path).write_bytes(header + chunks)


def rename_animations(path: Path | str, known_clips: tuple[str, ...]) -> dict[str, str]:
    """Rename exported clips back to the contractual names.

    ``Idle_merc_scout_rig`` becomes ``Idle``. A clip that matches nothing is left
    alone on purpose: a silent rename would hide a renamed action in the generator.
    """
    gltf, binary = read_glb(path)
    renames: dict[str, str] = {}
    for animation in gltf.get("animations", []):
        name = animation.get("name", "")
        for clip in sorted(known_clips, key=len, reverse=True):
            if name == clip or name.startswith(clip + "_"):
                if name != clip:
                    animation["name"] = clip
                    renames[name] = clip
                break
    if renames:
        write_glb(path, gltf, binary)
    return renames


def _component_size(component_type: int) -> int:
    return {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[component_type]


def _triangle_count(gltf: dict) -> int:
    total = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            indices = primitive.get("indices")
            if indices is not None:
                total += gltf["accessors"][indices]["count"] // 3
            else:
                attribute = primitive.get("attributes", {}).get("POSITION")
                if attribute is not None:
                    total += gltf["accessors"][attribute]["count"] // 3
    return total


def summarise(path: Path | str) -> dict:
    """Everything the report and the re-import comparison need, read from the file."""
    gltf, binary = read_glb(path)
    animations = []
    for animation in gltf.get("animations", []):
        duration = 0.0
        for sampler in animation.get("samplers", []):
            accessor = gltf["accessors"][sampler["input"]]
            if accessor.get("max"):
                duration = max(duration, float(accessor["max"][0]))
        animations.append({"name": animation.get("name", ""), "seconds": round(duration, 4),
                           "channels": len(animation.get("channels", []))})
    images = []
    for image in gltf.get("images", []):
        images.append({"name": image.get("name", ""), "mime": image.get("mimeType", ""),
                       "buffer_bytes": gltf["bufferViews"][image["bufferView"]]["byteLength"]
                       if "bufferView" in image else 0})
    extensions = sorted(set(gltf.get("extensionsUsed", [])) | set(gltf.get("extensionsRequired", [])))
    skins = []
    for skin in gltf.get("skins", []):
        skins.append({"name": skin.get("name", ""), "joints": len(skin.get("joints", []))})
    return {
        "file_bytes": Path(path).stat().st_size,
        "nodes": len(gltf.get("nodes", [])),
        "meshes": [mesh.get("name", "") for mesh in gltf.get("meshes", [])],
        "triangles": _triangle_count(gltf),
        "materials": [material.get("name", "") for material in gltf.get("materials", [])],
        "images": images,
        "animations": animations,
        "skins": skins,
        "extensions": extensions,
        "binary_bytes": len(binary),
    }
