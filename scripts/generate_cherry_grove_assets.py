"""Rebuild the Kirschhain pack by running its three tree authors in the order that produced it.

The seeds come from the checked-in reports (glb/qa_metrics.json and kanzan_NN_qa.json).
"""
import os
from pathlib import Path
import runpy

import bpy

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
AKEBONO_SEEDS = (270425, 270426, 270427, 270428, 270429)
KANZAN_SEEDS = (314159, 314160, 314161, 314162, 314163)


def run(script, env):
    saved = dict(os.environ)
    os.environ.update(env)
    try:
        runpy.run_path(str(SCRIPTS / script), run_name='__main__')
    finally:
        # The akebono author sets its own per-variant variables; none may leak into the next author.
        os.environ.clear()
        os.environ.update(saved)


def main(output_dir=None):
    glb = (Path(output_dir) if output_dir else ROOT).resolve() / 'assets/maps/cherry_grove/glb'
    # An empty profile list skips the hero and LOD exports under assets/models; the grove
    # only uses the five seeded variants.
    run('generate_sakura_akebono_asset.py', {
        'SAKURA_AKEBONO_OUTPUT_DIR': str(glb),
        'SAKURA_AKEBONO_PROFILES': '',
        'SAKURA_AKEBONO_VARIANT_SEEDS': ','.join(map(str, AKEBONO_SEEDS)),
    })
    for index, seed in enumerate(KANZAN_SEEDS, 1):
        # The kanzan author is a top-level script that expects a fresh startup scene per variant;
        # it also writes kanzan_grove.blend next to the glb folder for variant 01.
        bpy.ops.wm.read_factory_settings(use_empty=False)
        run('generate_sakura_kanzan_asset.py', {
            'SAKURA_KANZAN_OUTPUT_DIR': str(glb),
            'SAKURA_KANZAN_VARIANT': f'{index:02d}',
            'SAKURA_KANZAN_SEED': str(seed),
        })
    # Last on purpose: kanzan variant 01 writes a shorter kanzan_collision.glb that this replaces.
    run('generate_cherry_grove_collisions.py', {'CHERRY_GROVE_OUTPUT_DIR': str(glb)})
