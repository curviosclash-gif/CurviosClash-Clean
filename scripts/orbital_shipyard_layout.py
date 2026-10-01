"""Shared layout of the Orbital Shipyard parcours map.

Pure data, no bpy: the architecture builders, the setpiece builders and the map preset all read
their positions from here, so a ring and the structure around it cannot drift apart.

Coordinates are MAP coordinates in authored units (before MAP_SCALE 3): x east, y up, z south.
Blender is Z-up and the glTF export turns Blender -Y into map +Z, so every builder converts with
bl(x, y, z) -> (x, -z, y). The preset places every part at scale 1 on the centre/base the
generator reports, which puts each file back into this one shared frame.

The course (about 1060 units, roughly 70 s at base speed 15 units/s):
launch bay -> scaffold yard under a slewing crane -> through the rib cage of a half-built hull with
a welding gantry -> split: timed airlock doors or the maintenance duct above -> helix up the
drydock tower through a rotor -> summit gate -> dive into the fuel canyon with pistons -> finish
dock.
"""

ARENA_SIZE = (360.0, 170.0, 300.0)  # x, y, z; x and z are centred on 0, y runs 0..170


def bl(x, y, z):
    """Map coordinates -> Blender coordinates."""
    return (x, -z, y)


SPAWN = (-150.0, 40.0, 110.0)
SPAWN_FORWARD = (1.0, 0.0, 0.0)

# (id, type, position, radius, forward, next_ids, label)
CHECKPOINTS = (
    ("CP01", "gate", (-132.0, 40.0, 110.0), 6.0, (1.0, 0.0, 0.0), ("CP02",), "Startbucht"),
    ("CP02", "gate", (-95.0, 30.0, 95.0), 5.5, (0.9, -0.25, -0.35), ("CP03",), "Gerüst unten"),
    ("CP03", "gate", (-65.0, 58.0, 75.0), 5.0, (0.7, 0.6, -0.4), ("CP04",), "Gerüst oben"),
    ("CP04", "gate", (-35.0, 45.0, 50.0), 5.5, (0.8, -0.3, -0.5), ("CP05",), "Kranfeld"),
    ("CP05", "gate", (20.0, 45.0, 78.0), 7.0, (0.707, 0.0, -0.707), ("CP06",), "Rumpfbug"),
    ("CP06", "gate", (30.0, 38.0, 20.0), 5.5, (0.0, 0.0, -1.0), ("CP07",), "Rippenhalle"),
    ("CP07", "gate", (30.0, 30.0, -40.0), 5.0, (0.0, -0.1, -1.0), ("CP08",), "Kiel"),
    # The split sits high behind the stern so both lanes stay straight: the lock lane dips under
    # the front edge of the hall roof, the duct lane passes over it into the duct on that roof.
    ("CP08", "branch_entry", (30.0, 66.0, -118.0), 6.0, (0.0, 0.45, -0.9),
     ("CP09_LOCK", "CP09_DUCT"), "Heck"),
    ("CP09_LOCK", "gate", (87.0, 45.0, -110.0), 5.0, (1.0, 0.0, 0.0), ("CP10",), "Schleuse"),
    ("CP09_DUCT", "gate", (90.0, 80.0, -110.0), 5.0, (1.0, 0.0, 0.0), ("CP10",), "Wartungsschacht"),
    # Far enough east that the two lanes still pass either side of the roof's back edge.
    ("CP10", "gate", (174.0, 63.0, -110.0), 5.0, (0.8, 0.0, 0.6), ("CP11",), "Schleusenausgang"),
    ("CP11", "gate", (158.0, 62.0, -20.0), 6.0, (0.0, 0.2, 1.0), ("CP12",), "Dockturm Ost"),
    ("CP12", "gate", (125.0, 82.0, 20.0), 6.0, (-1.0, 0.3, 0.0), ("CP13",), "Dockturm Nord"),
    ("CP13", "gate", (92.0, 112.0, -15.0), 6.0, (0.0, 0.3, -1.0), ("CP14",), "Über dem Rotor"),
    ("CP14", "gate", (125.0, 142.0, -15.0), 7.0, (0.0, 1.0, 0.0), ("CP15",), "Turmspitze"),
    ("CP15", "gate", (160.0, 85.0, 45.0), 6.0, (0.3, -0.6, 0.75), ("CP16",), "Sturzflug"),
    ("CP16", "gate", (158.0, 35.0, 115.0), 6.0, (-0.4, -0.5, 0.77), ("CP17",), "Canyon-Einfahrt"),
    ("CP17", "gate", (128.0, 30.0, 115.0), 5.5, (-1.0, 0.0, 0.0), ("CP18",), "Kolben 1"),
    ("CP18", "gate", (102.0, 30.0, 115.0), 5.5, (-1.0, 0.0, 0.0), ("FINISH",), "Kolben 2"),
)
FINISH = ("FINISH", "finish", (66.0, 35.0, 115.0), 7.5, (-1.0, 0.0, 0.0), (), "Zieldock")

# Static geometry must keep this far from a ring centre: ring radius + RING_MARGIN.
RING_MARGIN = 3.0
# And this far from the straight line between two consecutive rings: min(radius) + CORRIDOR_MARGIN.
# Setpieces are exempt -- crossing a moving hazard is the point -- but must never sit on a ring
# centre for a whole loop.
CORRIDOR_MARGIN = 1.5

# --- Sections (map coordinates) ----------------------------------------------------------------
STATION_DECK = dict(y_bottom=0.0, y_top=3.0)  # the collidable deck far below everything

LAUNCH_BAY = dict(x_back=-175.0, x_mouth=-115.0, z=110.0, inner_half_width=12.0,
                  floor_y=30.0, ceiling_y=50.0)

SCAFFOLD_YARD = dict(x_min=-110.0, x_max=-10.0, z_min=40.0, z_max=140.0)

CRANE = dict(x=-60.0, z=120.0, mast_top_y=80.0, jib_y=72.0, jib_length=50.0,
             counter_jib_length=20.0, loop_seconds=24)

HULL = dict(axis_x=30.0, axis_y=45.0, z_bow=60.0, z_stern=-100.0, rib_radius=30.0,
            rib_spacing=12.0)

GANTRY = dict(z_front=45.0, z_back=-90.0, head_bottom_y=50.0, loop_seconds=16)

# The hall roof slab (ceiling_y..roof_top_y) is also the duct floor. Door leaves slide sideways
# into pockets outside the side walls (setpiece), out to door_pocket_reach beyond each wall.
AIRLOCK = dict(x_entry=60.0, x_exit=130.0, z_min=-127.0, z_max=-93.0, floor_y=25.0,
               ceiling_y=62.0, roof_top_y=65.0, doors_x=(78.0, 96.0, 114.0),
               door_slot_half_width=3.0, door_pocket_reach=18.0, loop_seconds=12)

DUCT = dict(x_entry=60.0, x_exit=130.0, z_min=-122.0, z_max=-98.0, floor_y=65.0,
            ceiling_y=95.0)

TOWER = dict(x=125.0, z=-15.0, radius=14.0, top_y=130.0, greeble_radius=20.0,
             clear_radius_above_top=12.0)

ROTOR = dict(y=100.0, hub_radius=18.0, tip_radius=45.0, arms=3, arm_thickness=3.0,
             loop_seconds=16)

CANYON = dict(x_min=75.0, x_max=150.0, z_min=102.0, z_max=128.0, floor_y=10.0, wall_top_y=60.0)

PISTONS = dict(x=(140.0, 115.0, 90.0), width_x=6.0, min_gap=8.0, loop_seconds=8)

FINISH_DOCK = dict(x=66.0, y=35.0, z=115.0, inner_radius=12.0)

# --- Materials: (base RGBA, emission strength, metallic[, emission RGB]) -------------------------
# Glowing materials keep an almost black base and one dominant emission channel, and stay at or
# below 1.2: the renderer's tone mapping turns anything brighter into flat white.
HULL_PLATE = "ShipHull"
HULL_DARK = "HullDark"
TRUSS = "Truss"
DECK = "Deck"
HAZARD = "Hazard"
PIPE = "Pipe"
GLOW_CYAN = "GlowCyan"
GLOW_AMBER = "GlowAmber"
GLOW_RED = "GlowRed"
WINDOW = "Window"

MATERIALS = {
    HULL_PLATE: ((0.46, 0.49, 0.54, 1.0), 0.0, 0.55),
    HULL_DARK: ((0.16, 0.17, 0.20, 1.0), 0.0, 0.6),
    TRUSS: ((0.62, 0.46, 0.12, 1.0), 0.0, 0.3),
    DECK: ((0.28, 0.29, 0.31, 1.0), 0.0, 0.4),
    HAZARD: ((0.85, 0.36, 0.06, 1.0), 0.0, 0.2),
    PIPE: ((0.35, 0.30, 0.26, 1.0), 0.0, 0.7),
    GLOW_CYAN: ((0.02, 0.03, 0.04, 1.0), 1.0, 0.0, (0.05, 0.55, 1.0)),
    GLOW_AMBER: ((0.03, 0.02, 0.01, 1.0), 0.9, 0.0, (1.0, 0.45, 0.05)),
    GLOW_RED: ((0.03, 0.01, 0.01, 1.0), 1.0, 0.0, (1.0, 0.08, 0.05)),
    WINDOW: ((0.05, 0.08, 0.12, 1.0), 0.8, 0.1, (0.3, 0.6, 1.0)),
}


def all_checkpoints():
    return CHECKPOINTS + (FINISH,)


def corridors():
    """Every (from, to, clearance) segment a player flies, branches included."""
    by_id = {entry[0]: entry for entry in all_checkpoints()}
    segments = [(SPAWN, CHECKPOINTS[0][2], CHECKPOINTS[0][3] + CORRIDOR_MARGIN)]
    for entry in CHECKPOINTS:
        for next_id in entry[5]:
            target = by_id[next_id]
            segments.append((entry[2], target[2], min(entry[3], target[3]) + CORRIDOR_MARGIN))
    return segments


def _check():
    """python scripts/orbital_shipyard_layout.py -- sanity numbers for the route."""
    from math import sqrt

    def sub(a, b):
        return tuple(x - y for x, y in zip(a, b))

    def norm(v):
        return sqrt(sum(x * x for x in v))

    by_id = {entry[0]: entry for entry in all_checkpoints()}
    feeders = {}
    for entry in CHECKPOINTS:
        for next_id in entry[5]:
            feeders.setdefault(next_id, []).append(entry)
    total = 0.0
    half = (ARENA_SIZE[0] / 2, ARENA_SIZE[2] / 2)
    for entry in all_checkpoints():
        ring_id, _type, pos, radius, forward, _next, _label = entry
        assert abs(pos[0]) + radius <= half[0] and abs(pos[2]) + radius <= half[1], ring_id
        assert radius <= pos[1] <= ARENA_SIZE[1] - radius, ring_id
        for feeder in feeders.get(ring_id, ()):
            step = sub(pos, feeder[2])
            facing = sum(a * b for a, b in zip(step, forward)) / (norm(step) * norm(forward))
            total += norm(step)
            print(f"{feeder[0]:>10} -> {ring_id:<10} step={norm(step):6.1f} facing={facing:5.2f}")
            assert facing >= 0.2, (feeder[0], ring_id, facing)
    first = sub(CHECKPOINTS[0][2], SPAWN)
    print(f"spawn -> CP01 {norm(first):.1f}  path (all lanes) {total:.0f}")
    assert norm(first) <= 20.0
    assert set(by_id) >= {n for e in CHECKPOINTS for n in e[5]}


if __name__ == "__main__":
    _check()
