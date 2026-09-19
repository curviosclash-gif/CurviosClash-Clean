"""Batch generator for Aetherion zodiac steles."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aetherion_orientation_common import build_family_variant

GENERATOR_ID = "aetherion-zodiac-stele-generator"
GENERATOR_VERSION = "1.0.3"


def build_variant(context):
    return build_family_variant(context, "zodiac-stele")
