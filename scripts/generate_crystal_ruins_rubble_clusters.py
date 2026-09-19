"""Batch generator for Crystal Ruins rubble and masonry clusters."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crystal_ruins_asset_common import build_family_variant

GENERATOR_ID = "crystal-ruins-rubble-cluster-generator"
GENERATOR_VERSION = "1.0.1"


def build_variant(context):
    return build_family_variant(context, "rubble-cluster")
