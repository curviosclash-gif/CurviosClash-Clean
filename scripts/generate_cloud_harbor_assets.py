#!/usr/bin/env python3
"""Generate the Cloud Harbor (Wolkenhafen) parcours map assets.

Run with Blender 4.2 LTS through the map dispatcher:

    npm run maps:generate -- --map cloud_harbor [--part <stem>]

A sky city of floating islands above a sea of clouds. The course runs from the mooring dock
through the open cargo bay of a docked freight zeppelin past swinging cargo nets, through the
rotor discs of two windmills, splits over the market isle (bazaar street under the sky bridges or
the rooftops above), spirals up the weather tower through its gyroscope rings, dives along the
cable-car line past moving gondolas and threads the anchor chains under the harbor pier, across the
patrol zeppelin's path, to the harbor gate.

Contract:
- Units: 1 Blender unit = 1 authored map unit; the runtime multiplies by MAP_SCALE 3.
- Frame: every part is modelled in one shared map frame (cloud_harbor_layout.py), converted with
  bl(x, y, z) -> (x, -z, y). The preset places each file at scale 1 on the centre/base that
  report() prints, which puts the parts back together.
- Collision: the map runs in glbColliderMode 'scene', so every mesh without _nocol collides.
  Anything a setpiece clip moves becomes a dynamic collider.
- Clearance: static geometry keeps ring radius + RING_MARGIN from every ring centre and
  min(radius) + CORRIDOR_MARGIN from the straight line between consecutive rings.
- Budgets: static part <= 18 000 triangles and <= 12 mesh nodes; setpiece <= 8 000 triangles and
  <= 40 mesh nodes; no file above 1 200 KiB.
- Loops are multiples of the 4 s map beat.

The toolkit (Canvas, rig, keyframe, export_part, export_setpiece) is the Eiffel Tower generator's,
reused through BASE like the orbital shipyard, the reactor site and the siege packs.
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import generate_eiffel_tower_assets as et  # noqa: E402
import cloud_harbor_layout as layout  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "cloud_harbor" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "cloud_harbor" / "glb"
BASE = et

et.MATERIAL_COLORS.update({name: entry[:3] for name, entry in layout.MATERIALS.items()})
EMISSION_COLORS = {name: entry[3] for name, entry in layout.MATERIALS.items() if len(entry) > 3}
_toolkit_build_material = et.build_material


def build_material(name):
    """The toolkit material, with a separate emission colour where the layout names one."""
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    value = _toolkit_build_material(name)
    emission = EMISSION_COLORS.get(name)
    if emission:
        shader = value.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
    return value


# Canvas.emit looks the builder up in the toolkit module, so the override has to live there.
et.build_material = build_material

from cloud_harbor_city import (  # noqa: E402
    build_cableway,
    build_harbor_island,
    build_market_isle,
    build_weather_tower,
)
from cloud_harbor_docks import (  # noqa: E402
    build_backdrop,
    build_cargo_zeppelin,
    build_cloud_sea,
    build_mooring_dock,
    build_wind_isle,
)
from cloud_harbor_setpieces import (  # noqa: E402
    build_cable_cars,
    build_cargo_nets,
    build_gyro_rings,
    build_patrol_zeppelin,
    build_windmill_rotors,
)

ARCHITECTURE = (
    ("01_cloud_sea", build_cloud_sea),
    ("02_mooring_dock", build_mooring_dock),
    ("03_cargo_zeppelin", build_cargo_zeppelin),
    ("04_wind_isle", build_wind_isle),
    ("05_market_isle", build_market_isle),
    ("06_weather_tower", build_weather_tower),
    ("07_cableway", build_cableway),
    ("08_harbor_island", build_harbor_island),
    ("09_backdrop", build_backdrop),
)

SETPIECES = (
    ("10_cargo_nets", "CargoNetSwingLoop", layout.CARGO_NETS["loop_seconds"], build_cargo_nets),
    ("11_windmill_rotors", "WindmillRotorLoop", layout.WINDMILLS[0]["loop_seconds"],
     build_windmill_rotors),
    ("12_gyro_rings", "GyroRingLoop", layout.GYRO_RINGS["loop_seconds"], build_gyro_rings),
    ("13_cable_cars", "CableCarLoop", layout.CABLE_CARS["loop_seconds"], build_cable_cars),
    ("14_patrol_zeppelin", "PatrolZeppelinLoop", layout.PATROL_ZEPPELIN["loop_seconds"],
     build_patrol_zeppelin),
)


def main():
    et.SOURCE_DIR = SOURCE_DIR
    et.GLB_DIR = GLB_DIR
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for part in ARCHITECTURE:
        et.export_part(*part)
    for setpiece in SETPIECES:
        et.export_setpiece(*setpiece)


if __name__ == "__main__":
    main()