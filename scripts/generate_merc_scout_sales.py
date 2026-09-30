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

from merc_scout import preview, sales, spec  # noqa: E402

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

- The walk cycle implies roughly 0.9 m/s, the run roughly 2.3 m/s; drive the character
  faster and the planted foot slides. Step length is capped by the leg length.
- Measured on the built model: during the walk stance the lowest boot point sinks up to
  18 mm below the floor, in the run 19 mm. The idle stance stays within 7 mm.
- Skin coverage is measured per build: about 12 % of the body's vertices carry no
  garment within 70 mm, most of them on the arm (16 %), the collar opening and the
  boot; the head and the hands are meant to be bare.
- Hit and Death slide the right foot on purpose instead of lifting it.
- Ambient occlusion is baked into the base-colour maps, not delivered as a separate
  AO map, so it cannot be re-used for a different lighting setup.
- Roughness and metallic are scalar per material; there are no roughness or metallic maps.
- The hair is a sculpted mass, not card geometry: no strand-level silhouette.
- The renders for this datasheet are EEVEE previews (hero shots: Cycles), not offline
  production renders.
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
    parser.add_argument("--hero-views", default="hero,three_quarter,face,hand")
    parser.add_argument("--hero-engine", default="BLENDER_EEVEE_NEXT",
                        choices=("BLENDER_EEVEE_NEXT", "CYCLES"))
    parser.add_argument("--hero-resolution", default="900x1200")
    parser.add_argument("--hero-samples", type=int, default=48)
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
            hero_width, hero_height = (int(part) for part in args.hero_resolution.lower().split("x"))
            print(f"[sales] hero {variant} ({args.hero_engine})", flush=True)
            preview.render_views(meshes, args.output_dir / variant,
                                 prefix=f"merc_scout_{variant}_hero_",
                                 resolution=(hero_width, hero_height),
                                 samples=args.hero_samples,
                                 views=tuple(name for name in args.hero_views.split(",") if name),
                                 engine=args.hero_engine, ground=True)
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
