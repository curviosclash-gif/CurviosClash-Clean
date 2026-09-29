"""Sales material: wireframe renders, a motion clip and the technical datasheet.

Everything here is derived from a built variant: the renders come from the same
scene the exports come from, and the datasheet is written from the generator's own
report, so a number in the shop text cannot drift away from the file.
"""

from __future__ import annotations

import json
from pathlib import Path

import bpy

from . import mesh_utils as mu, preview, spec


def render_wireframe(objects: list[bpy.types.Object], output_dir: Path, *, prefix: str = "",
                     resolution: tuple[int, int] = (700, 900), samples: int = 24,
                     thickness: float = 0.0022, views: tuple[str, ...] = ("front", "three_quarter")) -> list[Path]:
    """Render the mesh as a wire cage: the proof buyers ask for at a glance."""
    added: list[tuple[bpy.types.Object, bpy.types.Modifier]] = []
    for obj in objects:
        modifier = obj.modifiers.new("Wireframe", "WIREFRAME")
        modifier.thickness = thickness
        modifier.use_replace = True
        modifier.use_boundary = True
        added.append((obj, modifier))
    try:
        return preview.render_views(objects, output_dir, prefix=prefix + "wire_",
                                    resolution=resolution, samples=samples, views=views,
                                    engine="BLENDER_EEVEE_NEXT")
    finally:
        for obj, modifier in added:
            obj.modifiers.remove(modifier)


def render_motion(rig: bpy.types.Object, clip: str, output_path: Path, *,
                  resolution: tuple[int, int] = (720, 900), samples: int = 24,
                  engine: str = "BLENDER_EEVEE_NEXT", loops: int = 1) -> Path:
    """Render one action to an H.264 MP4: the movement proof for the shop page."""
    action = bpy.data.actions.get(clip)
    if action is None:
        raise KeyError(f"no action named {clip!r} in this scene")
    scene = bpy.context.scene
    preview.setup_render(resolution, samples, engine)
    rig.animation_data_create()
    rig.animation_data.action = action
    start, end = (int(value) for value in action.frame_range)
    scene.frame_start, scene.frame_end = start, end
    span = max(1, end - start)

    camera_data = bpy.data.cameras.new("motion_camera")
    camera = bpy.data.objects.new("motion_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "PERSP"
    camera_data.lens = 55.0
    camera.location = (-1.55, -2.35, 1.55)
    target = (0.0, 0.0, 0.95)
    from mathutils import Vector
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.fps = spec.FPS
    scene.frame_end = start + span * max(1, loops)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output_path.with_suffix(""))
    bpy.ops.render.render(animation=True)
    return output_path


def datasheet(report: dict, textures: dict[str, dict[str, str]] | None = None) -> str:
    """Build the technical text that belongs on the product page."""
    variant = report["variant"]
    files = report["files"]
    summary = report["glb_summary"]
    clips = sorted(summary["animations"], key=lambda item: item["name"])
    lines = [
        f"### {report['label']} (`{variant}`)",
        "",
        f"- Triangles: **{report['triangles']}** (budget {report['budget_triangles']})",
        f"- Vertices: {sum(report['vertices'].values())} across {report['mesh_count']} meshes",
        f"- Bones: **{report['bones']}** (including one gaze bone per eye), "
        f"at most 4 influences per vertex, "
        f"{sum(item['unweighted'] for item in report['weights'].values())} unweighted vertices",
        f"- Materials: {len(summary['materials'])} ({', '.join(sorted(summary['materials']))})",
        f"- Textures: {len(summary['images'])} embedded PNG maps, ambient occlusion baked in",
        f"- Clips: {len(clips)} — " + ", ".join(f"{item['name']} ({item['seconds']:.2f} s)" for item in clips),
        f"- Looping clips: {', '.join(report.get('looping_clips', []))}",
        f"- Size: height {report['measurements']['height']} m, soles on z = "
        f"{report['measurements']['ground']} m, width in the A-pose "
        f"{report['measurements']['width']} m",
        f"- Files: `.blend` {(files['blend_bytes'] / 1024 / 1024):.2f} MiB, "
        f"`.glb` {(files['glb_bytes'] / 1024 / 1024):.2f} MiB, "
        f"`.fbx` {(files.get('fbx_bytes', 0) / 1024 / 1024):.2f} MiB",
        f"- Round trip: re-imported GLB has {report['round_trip']['bones']} bones and "
        f"{report['round_trip']['triangles']} triangles, missing meshes: "
        f"{report['round_trip']['missing'] or 'none'}",
        "",
    ]
    audit = report.get("audit")
    if audit:
        lines.append("Proportions, measured on the built model against the anthropometric "
                     "reference of a 1.80 m adult:")
        lines.append("")
        lines.append("| Measure | Built | Reference | Deviation |")
        lines.append("| --- | --- | --- | --- |")
        for group in ("joints", "lengths", "breadths"):
            for label, entry in audit.get(group, {}).items():
                lines.append(f"| {label.replace('_', ' ')} | {entry['built']:.3f} m | "
                             f"{entry['reference']:.3f} m | {entry['delta']:+.1%} |")
        head = audit.get("head")
        if head:
            lines.append(f"| head (including ears) | {head['breadth']:.3f} m | "
                         f"{spec.ANTHROPOMETRY['head_breadth']:.3f} m skull | — |")
        span = audit.get("arm_span") or {}
        if span.get("built"):
            lines.append(f"| arm span, T-pose | {span['built']:.3f} m | "
                         f"{span['reference'][0]:.2f}-{span['reference'][1]:.2f} x height | "
                         f"{span['ratio']:.2f} x height |")
        lines.append("")
        if audit.get("warnings"):
            lines.append("Open deviations:")
            lines.append("")
            for warning in audit["warnings"]:
                lines.append(f"- {warning}")
            lines.append("")
    return "\n".join(lines)


def write_report(reports: list[dict], output_path: Path, *, price_anchor: str = "") -> Path:
    """Write the whole datasheet for all variants."""
    parts = [
        "# Mercenary Scout (Kestrel) — technical data",
        "",
        "Modular, stylised-realistic humanoid for third person games. One generator",
        "(`scripts/generate_merc_scout_character.py`) writes every file below.",
        "",
        "## License",
        "",
        "Royalty free. Commercial use in your own projects is allowed. Redistributing,",
        "reselling or sub-licensing the model itself, modified or not, is not allowed.",
        "",
        "## Contents",
        "",
        "- `blender/merc_scout_<variant>.blend` — editable source, rigged and textured",
        "- `glb/merc_scout_<variant>.glb` — glTF 2.0 binary, textures embedded",
        "- `fbx/merc_scout_<variant>.fbx` — FBX with embedded textures, one take per clip",
        "- `textures/<variant>/` — the PBR maps as separate PNG files",
        "",
        "## Technical data",
        "",
    ]
    for report in reports:
        parts.append(datasheet(report))
    if price_anchor:
        parts.extend(["## Price", "", price_anchor, ""])
    output_path.write_text("\n".join(parts), encoding="utf-8")
    return output_path
