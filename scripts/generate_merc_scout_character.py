"""Build the "Mercenary Scout" character and its game-ready exports.

The generator is the source of truth: it writes the editable ``.blend`` sources
and the ``.glb`` exports under ``assets/models/characters/merc_scout``. The
frozen contract (proportions, variants, bones, materials, clips) lives in
``scripts/merc_scout/spec.py``.

Usage::

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_merc_scout_character.py -- \
        --variant pc --preview-dir <scratch dir>

``--python-exit-code 1`` is mandatory: without it Blender exits with code 0 even
when the script raises.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from merc_scout import build, preview, spec  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", default="pc", choices=[variant.key for variant in spec.VARIANTS])
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--no-preview", action="store_true")
    parser.add_argument("--no-painting", action="store_true",
                        help="skip the PBR texture pass (fast geometry iteration)")
    parser.add_argument("--no-animations", action="store_true",
                        help="skip the action build (fast geometry iteration)")
    parser.add_argument("--blend", type=Path)
    parser.add_argument("--glb", type=Path)
    parser.add_argument("--resolution", default="520x700")
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--engine", default="CYCLES", choices=("CYCLES", "BLENDER_EEVEE_NEXT"))
    parser.add_argument("--views", default=",".join(preview.VIEWS))
    parser.add_argument("--fbx", action="store_true", help="also write the FBX export")
    parser.add_argument("--verify", action="store_true",
                        help="re-import the GLB into an empty scene and report the round trip")
    parser.add_argument("--report", type=Path, help="write the JSON report to this file as well")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def main() -> None:
    args = parse_args()
    width, height = (int(part) for part in args.resolution.lower().split("x"))
    report = build.run(
        args.variant,
        preview_dir=args.preview_dir,
        blend_path=args.blend,
        glb_path=args.glb,
        do_preview=not args.no_preview and args.preview_dir is not None,
        resolution=(width, height),
        samples=args.samples,
        views=tuple(name for name in args.views.split(",") if name),
        engine=args.engine,
        do_painting=not args.no_painting,
        do_actions=not args.no_animations,
        do_fbx=args.fbx,
        do_verify=args.verify,
    )
    text = json.dumps(report, indent=2, sort_keys=True)
    print("[merc-scout] report begin")
    print(text)
    print("[merc-scout] report end")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
