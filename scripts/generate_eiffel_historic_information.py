#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_eiffel_historic_prop_asset import GENERATOR_VERSION, build_family_variant

GENERATOR_ID = "eiffel-historic-information-generator"


def build_variant(context):
    return build_family_variant("information", context)
