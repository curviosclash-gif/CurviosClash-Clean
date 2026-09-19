"""Batch generator for Aetherion orbit wayfinders and directional beacons."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aetherion_orientation_common import build_family_variant

GENERATOR_ID = "aetherion-orbit-beacon-generator"
GENERATOR_VERSION = "1.0.3"


def build_variant(context):
    return build_family_variant(context, "orbit-beacon")
