#!/usr/bin/env python3
"""Generate the Orbital Shipyard parcours map assets.

Run with Blender 4.2 LTS through the map dispatcher:

    npm run maps:generate -- --map orbital_shipyard [--part <stem>]

A half-built capital ship in a floating drydock. The course runs from the launch bay through a
scaffold yard under a slewing crane, through the rib cage of the hull past a welding gantry, splits
into timed airlock doors or the duct above them, spirals up the drydock tower through a rotor,
dives from the summit into the fuel canyon with its pistons and ends in the finish dock.

Contract:
- Units: 1 Blender unit = 1 authored map unit; the runtime multiplies by MAP_SCALE 3.
- Frame: every part is modelled in one shared map frame (orbital_shipyard_layout.py), converted
  with bl(x, y, z) -> (x, -z, y). The preset places each file at scale 1 on the centre/base that
  report() prints, which puts the parts back together.
- Collision: the map runs in glbColliderMode 'scene', so every mesh without _nocol collides.
  Anything a setpiece clip moves becomes a dynamic collider.
- Clearance: static geometry keeps ring radius + RING_MARGIN from every ring centre and
  min(radius) + CORRIDOR_MARGIN from the straight line between consecutive rings.
- Budgets: static part <= 18 000 triangles and <= 12 mesh nodes; setpiece <= 8 000 triangles and
  <= 40 mesh nodes; no file above 1 200 KiB.
- Loops are multiples of the 4 s map beat.

The toolkit (Canvas, rig, keyframe, export_part, export_setpiece) is the Eiffel Tower generator's,
reused through BASE like the reactor site and the siege packs.
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import generate_eiffel_tower_assets as et  # noqa: E402
import orbital_shipyard_layout as layout  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "orbital_shipyard" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "orbital_shipyard" / "glb"
BASE = et

et.MATERIAL_COLORS.update({name: entry[:3] for name, entry in layout.MATERIALS.items()})
EMISSION_COLORS = {name: entry[3] for name, entry in layout.MATERIALS.items() if len(entry) > 3}
_toolkit_build_material = et.build_material


def build_material(name):
    """The toolkit material, with a separate emission colour where the layout names one.

    The Eiffel toolkit glows in its base colour, which is right for lamps on a bright map. Out here
    the glow sits on an almost black base, so only the light itself reads, not a pale panel.
    """
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

from orbital_shipyard_core import (  # noqa: E402
    build_airlock_hall,
    build_drydock_tower,
    build_fuel_canyon,
    build_station_deck,
)
from orbital_shipyard_setpieces import (  # noqa: E402
    build_airlock_doors,
    build_crane_sweep,
    build_fuel_pistons,
    build_tower_rotor,
    build_weld_gantry,
)
from orbital_shipyard_station import (  # noqa: E402
    build_backdrop,
    build_hull_spine,
    build_launch_bay,
    build_scaffold_yard,
)

ARCHITECTURE = (
    ("01_station_deck", build_station_deck),
    ("02_launch_bay", build_launch_bay),
    ("03_scaffold_yard", build_scaffold_yard),
    ("04_hull_spine", build_hull_spine),
    ("05_airlock_hall", build_airlock_hall),
    ("06_drydock_tower", build_drydock_tower),
    ("07_fuel_canyon", build_fuel_canyon),
    ("08_backdrop", build_backdrop),
)

SETPIECES = (
    ("10_crane_sweep", "CraneSweepLoop", layout.CRANE["loop_seconds"], build_crane_sweep),
    ("11_weld_gantry", "WeldGantryLoop", layout.GANTRY["loop_seconds"], build_weld_gantry),
    ("12_airlock_doors", "AirlockCycleLoop", layout.AIRLOCK["loop_seconds"], build_airlock_doors),
    ("13_tower_rotor", "TowerRotorLoop", layout.ROTOR["loop_seconds"], build_tower_rotor),
    ("14_fuel_pistons", "FuelPistonLoop", layout.PISTONS["loop_seconds"], build_fuel_pistons),
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
