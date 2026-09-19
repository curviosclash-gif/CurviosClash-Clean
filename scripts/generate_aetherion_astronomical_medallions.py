"""Batch generator for Aetherion astronomical floor medallions."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aetherion_orientation_common import build_family_variant

GENERATOR_ID = "aetherion-astronomical-medallion-generator"
GENERATOR_VERSION = "1.0.4"


def build_variant(context):
    return build_family_variant(context, "astronomical-medallion")
