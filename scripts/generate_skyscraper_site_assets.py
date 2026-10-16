#!/usr/bin/env python3
"""Generate the 13 Skyscraper Site GLBs from the authored shared layout.

Run through the repository map dispatcher with Blender 4.2 LTS:

    npm run maps:generate -- --map skyscraper_site [--part <stem>]

The Eiffel Tower Canvas/rig/export toolkit is reused without changing it. All dimensions stay in
map coordinates until the Canvas boundary converts (x, y, z) to Blender (x, -z, y). Static meshes
are closed collision hulls; fine lighting and nets use the toolkit's _nocol marker, and moving
collision meshes carry _dyn. A full generation checks the authored BBOX, triangle/node/file
budgets, and samples each animation frame before reporting its placement centre and base.
"""

from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import generate_eiffel_tower_assets as et
import skyscraper_site_layout as layout
import skyscraper_site_core as core
import skyscraper_site_setpieces as setpieces
import skyscraper_site_skyline as skyline


SOURCE_DIR = ROOT / "assets" / "maps" / "skyscraper_site" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "skyscraper_site" / "glb"
MAX_STATIC_TRIS = 18_000
MAX_STATIC_NODES = 12
MAX_ANIM_TRIS = 8_000
MAX_ANIM_NODES = 40
MAX_GLB_BYTES = 1_200 * 1024
BBOX_TOLERANCE = 0.5

BUILDERS = {
    layout.SKYLINE: skyline,
    layout.CORE: core,
    layout.SETPIECES: setpieces,
}

# The shared toolkit expects three-tuples. Keep its material construction and add the layout's
# optional independent emission hue after construction, so warm windows stay dark at the base.
layout_emissions = {
    name: values[3]
    for name, values in layout.MATERIALS.items()
    if len(values) > 3
}
et.MATERIAL_COLORS.update({
    name: (values[0], values[1], values[2])
    for name, values in layout.MATERIALS.items()
})
_toolkit_build_material = et.build_material


def build_material(name):
    material = _toolkit_build_material(name)
    emission_rgb = layout_emissions.get(name)
    if emission_rgb:
        shader = material.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Emission Color"].default_value = (*emission_rgb, 1.0)
    return material


# Canvas.emit resolves this function through the toolkit module.
et.build_material = build_material


def _map_bounds(lows, highs):
    """Convert toolkit Blender bounds to (x0, y0, z0, x1, y1, z1) map bounds."""
    return (lows[0], lows[2], -highs[1], highs[0], highs[2], -lows[1])


def _scene_envelope(scene, animated):
    """Collect world-space bounds at every exported frame for setpiece placement/validation."""
    first_frame = scene.frame_current
    lows = [float("inf")] * 3
    highs = [float("-inf")] * 3
    frames = range(scene.frame_start, scene.frame_end + 1) if animated else (first_frame,)
    for frame in frames:
        scene.frame_set(frame)
        for obj in scene.objects:
            if obj.type != "MESH":
                continue
            for corner in obj.bound_box:
                world = obj.matrix_world @ et.Vector(corner)
                for axis in range(3):
                    lows[axis] = min(lows[axis], world[axis])
                    highs[axis] = max(highs[axis], world[axis])
    scene.frame_set(first_frame)
    if lows[0] == float("inf"):
        raise RuntimeError("Skyscraper Site builder emitted no mesh geometry")
    return lows, highs


def _validate_part(part, lows, highs):
    stem, _module, _kind, expected, *_clip = part
    actual = _map_bounds(lows, highs)
    for axis in range(3):
        minimum, maximum = actual[axis], actual[axis + 3]
        expected_minimum, expected_maximum = expected[axis], expected[axis + 3]
        if minimum < expected_minimum - BBOX_TOLERANCE or maximum > expected_maximum + BBOX_TOLERANCE:
            raise RuntimeError(
                f"{stem} map BBOX axis {axis} [{minimum:.3f}, {maximum:.3f}] exceeds "
                f"authored range [{expected_minimum:.3f}, {expected_maximum:.3f}]; "
                f"actual={tuple(round(v, 3) for v in actual)}"
            )
    return actual


def _counts():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = sum(max(1, len(face.vertices) - 2)
                    for obj in meshes for face in obj.data.polygons)
    return triangles, len(meshes)


def _checked_report(part, glb_path, extra=""):
    stem, _module, kind, _expected, *_clip = part
    animated = kind == "anim"
    scene = bpy.context.scene
    # GLTF normalization uses the bind pose. Report its centre/base for model placement, while
    # validating the union of every animated frame against the authored envelope independently.
    lows, highs = _scene_envelope(scene, False)
    initial = _map_bounds(lows, highs)
    envelope_lows, envelope_highs = _scene_envelope(scene, animated)
    envelope = _validate_part(part, envelope_lows, envelope_highs)
    triangles, nodes = _counts()
    max_triangles, max_nodes = (
        (MAX_ANIM_TRIS, MAX_ANIM_NODES)
        if animated else (MAX_STATIC_TRIS, MAX_STATIC_NODES)
    )
    if triangles > max_triangles or nodes > max_nodes:
        raise RuntimeError(
            f"{stem} budget exceeded: {triangles}/{max_triangles} triangles, "
            f"{nodes}/{max_nodes} mesh nodes"
        )
    size_bytes = glb_path.stat().st_size
    if size_bytes > MAX_GLB_BYTES:
        raise RuntimeError(f"{stem} GLB is {size_bytes} bytes; limit is {MAX_GLB_BYTES}")

    # Toolkit Blender axes are X, -map-Z, map-Y. Report the frame envelope centre/base used by
    # the preset; for animation this includes the whole loop rather than only its initial pose.
    center_x = (lows[0] + highs[0]) / 2
    center_map_z = -(lows[1] + highs[1]) / 2
    base_y = lows[2]
    size_x, size_y, size_z = (
        highs[0] - lows[0], highs[2] - lows[2], highs[1] - lows[1]
    )
    print(
        f"generated {glb_path.relative_to(ROOT)} {extra}"
        f"tris={triangles} nodes={nodes} center_x={center_x:.2f} "
        f"center_z={center_map_z:.2f} base_y={base_y:.2f} "
        f"size=({size_x:.1f}, {size_y:.1f}, {size_z:.1f}) bytes={size_bytes} "
        f"map_bbox={tuple(round(value, 2) for value in initial)} "
        f"loop_bbox={tuple(round(value, 2) for value in envelope)}"
    )


def _part_builder(part):
    stem, module_name, kind, _bbox, *_clip = part
    module = BUILDERS[module_name]
    name = "build_" + stem.split("_", 1)[1]
    builder = getattr(module, name, None)
    if builder is None:
        raise RuntimeError(f"{stem} has no {module_name}.{name} builder")
    return builder


def _export_checked(part, operation, *args):
    original_report = et.report

    def report(glb_path, extra=""):
        _checked_report(part, glb_path, extra)

    et.SOURCE_DIR = SOURCE_DIR
    et.GLB_DIR = GLB_DIR
    et.report = report
    try:
        operation(*args)
    finally:
        et.report = original_report


def export_part(file_stem, builder):
    """Dispatcher-compatible static exporter with Skyscraper Site validation."""
    part = next((entry for entry in layout.PARTS if entry[0] == file_stem), None)
    if part is None or part[2] != "static":
        raise ValueError(f"unknown static Skyscraper Site part: {file_stem}")
    _export_checked(part, et.export_part, file_stem, builder)


def export_setpiece(file_stem, clip_name, duration, builder):
    """Dispatcher-compatible animated exporter with whole-loop validation."""
    part = next((entry for entry in layout.PARTS if entry[0] == file_stem), None)
    if part is None or part[2] != "anim":
        raise ValueError(f"unknown animated Skyscraper Site part: {file_stem}")
    if (clip_name, duration) != (part[4], part[5]):
        raise ValueError(f"{file_stem} clip does not match the authored layout")
    _export_checked(part, et.export_setpiece, file_stem, clip_name, duration, builder)


# The repository dispatcher calls these exact exporter seams for both full packs and --part.
# Keeping the module as BASE would bypass the custom whole-loop and budget validation above.
ARCHITECTURE = tuple(
    (part[0], _part_builder(part)) for part in layout.PARTS if part[2] == "static"
)
SETPIECES = tuple(
    (part[0], part[4], part[5], _part_builder(part))
    for part in layout.PARTS if part[2] == "anim"
)


def main():
    selected = None
    if "--" in sys.argv:
        arguments = sys.argv[sys.argv.index("--") + 1:]
        if arguments:
            if len(arguments) != 2 or arguments[0] != "--part":
                raise SystemExit("usage: -- --part <part-stem>")
            selected = arguments[1]

    parts = layout.PARTS
    if selected:
        parts = tuple(part for part in parts if part[0] == selected)
        if not parts:
            names = ", ".join(part[0] for part in layout.PARTS)
            raise SystemExit(f"unknown part {selected!r}; choose one of: {names}")
    else:
        layout._check()

    # Replace only the report seam so every exported file gets its whole-loop envelope,
    # authored-BBOX check, actual placement centre/base, and explicit budgets.
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    selected = {part[0] for part in parts}
    for stem, builder in ARCHITECTURE:
        if stem in selected:
            export_part(stem, builder)
    for stem, clip_name, duration, builder in SETPIECES:
        if stem in selected:
            export_setpiece(stem, clip_name, duration, builder)


if __name__ == "__main__":
    main()
