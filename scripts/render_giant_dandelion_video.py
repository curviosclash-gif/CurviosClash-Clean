#!/usr/bin/env python3
"""Render the dandelion's four-second SeedFlight clip to an MP4 preview.

Run with Blender 4.2 LTS from the repository root:

    blender --background assets/models/giant_dandelion/blender/giant_dandelion.blend \
        --python-exit-code 1 --python scripts/render_giant_dandelion_video.py
"""

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = (ROOT / "assets" / "models" / "giant_dandelion" / "blender"
          / "previews" / "giant_dandelion_seedflight.mp4")


def main():
    scene = bpy.context.scene
    if scene.get("asset") != "giant_dandelion":
        raise RuntimeError("load the generated giant_dandelion.blend before rendering")
    camera = bpy.data.objects.get("Camera_front")
    if camera is None:
        raise RuntimeError("missing front presentation camera")
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 16
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.fps = 15
    scene.frame_start = 2
    scene.frame_end = 120
    scene.frame_step = 2
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(animation=True)
    if not OUTPUT.exists() or OUTPUT.stat().st_size < 200_000:
        raise RuntimeError("video render is missing or unexpectedly small")
    print(f"rendered {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
