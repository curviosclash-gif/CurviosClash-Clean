"""Produce the sales material for the mercenary scout from the built sources.

It opens each variant's saved ``.blend`` (the editable source is the deliverable,
so the shop pictures must come from it, not from a private scene), renders the
wireframe views and a motion clip per variant into ``--output-dir``, and writes the
technical datasheet from the generator reports.

Usage::

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/generate_merc_scout_sales.py -- \
        --output-dir <scratch dir> --reports-dir <dir with final_<variant>.json>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from merc_scout import sales, spec  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "assets/models/characters/merc_scout"

PRICE_ANCHOR = """\
Comparable single characters on Fab (prices read on 2026-09-28, EUR, personal licence):
*Modular Meta Soldier Female* (48 animations, modular, realistic) EUR 35.14; *Stylized Ninja*
and *Stylized Female Soldier* (modular, **no** animations included) EUR 43.93 each;
*Elite Tactical Soldier* (4 clips) EUR 21.96; *Modular Character Urban Citizen* (three LODs,
48 clips) EUR 87.88; *Modular Creative Characters* (420 assets) EUR 140.62.

Recommended list prices for this product, derived from those anchors:

- All three variants together: EUR 60-99 (Professional tier about 2.5x)
- PC variant alone: EUR 29-45
- Animation upgrade (11 clips): EUR 19-29

The three-variant split and the editable ``.blend`` source are what none of the
compared listings offer; the honest limits are listed below.
"""

LIMITS = """\
## Honest limits

- The walk cycle implies 0.91 m/s, the run 2.24 m/s; drive the character faster and the
  planted foot slides. Step length is capped by the leg length of a straight bind pose.
- The boot toe corner sinks up to 10 mm into the floor during the walk stance.
- Hit and Death slide the right foot on purpose instead of lifting it.
- A small patch of skin can show at the outer deltoid, where the skin modifier's branch
  bulge is wider than the sleeve.
- The high variant's extra cloth bones (``CoatBack``, ``StrapFront``) carry no motion yet.
- Roughness and metallic are scalar per material; there are no roughness or metallic maps.
- The renders for this datasheet are EEVEE previews, not offline renders.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reports-dir", type=Path, required=True)
    parser.add_argument("--clips", default="Walk")
    parser.add_argument("--loops", type=int, default=1,
                        help="how often a clip is repeated inside one video")
    parser.add_argument("--variants", default=",".join(variant.key for variant in spec.VARIANTS))
    parser.add_argument("--resolution", default="720x900")
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--datasheet", type=Path, default=MODEL_DIR / "DATASHEET.md")
    parser.add_argument("--skip-renders", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def main() -> None:
    args = parse_args()
    width, height = (int(part) for part in args.resolution.lower().split("x"))
    variants = [name for name in args.variants.split(",") if name]
    clips = [name for name in args.clips.split(",") if name]
    reports: list[dict] = []

    for variant in variants:
        blend = MODEL_DIR / f"blender/merc_scout_{variant}.blend"
        if not blend.exists():
            raise SystemExit(f"missing source {blend}; run the generator first")
        bpy.ops.wm.open_mainfile(filepath=str(blend))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
        if not meshes or not armatures:
            raise SystemExit(f"{blend} has no rigged mesh")
        rig = armatures[0]
        if not args.skip_renders:
            print(f"[sales] wireframe {variant}", flush=True)
            sales.render_wireframe(meshes, args.output_dir / variant,
                                   prefix=f"merc_scout_{variant}_",
                                   resolution=(width, height), samples=args.samples)
            for clip in clips:
                print(f"[sales] motion {variant} {clip}", flush=True)
                sales.render_motion(rig, clip,
                                    args.output_dir / variant / f"merc_scout_{variant}_{clip}.mp4",
                                    resolution=(width, height), samples=args.samples,
                                    loops=args.loops)
        report_file = args.reports_dir / f"final_{variant}.json"
        if report_file.exists():
            reports.append(json.loads(report_file.read_text(encoding="utf-8")))

    if reports:
        text = sales.write_report(reports, args.datasheet, price_anchor=PRICE_ANCHOR)
        text.write_text(text.read_text(encoding="utf-8") + LIMITS, encoding="utf-8")
        print(f"[sales] datasheet {args.datasheet} ({text.stat().st_size} B)", flush=True)
    print("[sales] done", flush=True)


if __name__ == "__main__":
    main()
