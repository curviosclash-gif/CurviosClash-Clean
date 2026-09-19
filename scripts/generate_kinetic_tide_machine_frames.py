#!/usr/bin/env python3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kinetic_tide_cladding_common import build_variant_for_family

GENERATOR_ID = "kinetic-tide-machine-frame-generator"
GENERATOR_VERSION = "1.1.0"


def build_variant(context):
    return build_variant_for_family(context, "machine-frame")
