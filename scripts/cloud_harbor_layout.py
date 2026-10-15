"""Shared layout of the Cloud Harbor (Wolkenhafen) parcours map.

Pure data, no bpy: the architecture builders, the setpiece builders and the map preset all read
their positions from here, so a ring and the structure around it cannot drift apart.

Coordinates are MAP coordinates in authored units (before MAP_SCALE 3): x east, y up, z south.
Blender is Z-up and the glTF export turns Blender -Y into map +Z, so every builder converts with
bl(x, y, z) -> (x, -z, y). The preset places every part at scale 1 on the centre/base the
generator reports, which puts each file back into this one shared frame.

The course (about 800 units per lane, roughly 55 s at base speed 15 units/s), a sky city of
floating islands above a sea of clouds:
mooring dock -> through the open cargo bay of a docked freight zeppelin past swinging cargo nets
-> through the upper rotor discs of two windmills on the wind isle -> split over the market isle:
the bazaar street under the sky bridges or the rooftops above them -> helix up the weather tower
through its gyroscope rings -> summit gate -> dive along the cable-car line past moving gondolas
-> between the anchor chains under the harbor island, across the patrol zeppelin's path -> harbor
gate (finish).
"""

ARENA_SIZE = (360.0, 180.0, 300.0)  # x, y, z; x and z are centred on 0, y runs 0..180


def bl(x, y, z):
    """Map coordinates -> Blender coordinates."""
    return (x, -z, y)


SPAWN = (-152.0, 68.0, 100.0)
SPAWN_FORWARD = (1.0, 0.0, 0.0)

# (id, type, position, radius, forward, next_ids, label)
CHECKPOINTS = (
    ("CP01", "gate", (-134.0, 68.0, 100.0), 6.0, (1.0, 0.0, 0.0), ("CP02",), "Ankermast"),
    ("CP02", "gate", (-106.0, 68.0, 100.0), 6.0, (1.0, 0.0, 0.0), ("CP03",), "Bugtor"),
    ("CP03", "gate", (-65.0, 68.0, 100.0), 5.5, (1.0, 0.0, 0.0), ("CP04",), "Frachtraum"),
    ("CP04", "gate", (-24.0, 68.0, 100.0), 6.0, (1.0, 0.0, 0.0), ("CP05",), "Heckluke"),
    # Each windmill ring sits in the upper half of its rotor disc: the blades sweep through it,
    # the tower and nacelle stay below.
    ("CP05", "gate", (15.0, 74.0, 92.0), 5.5, (1.0, 0.05, -0.2), ("CP06",), "Windmühle West"),
    ("CP06", "gate", (45.0, 80.0, 60.0), 5.5, (0.4, 0.1, -0.9), ("CP07",), "Windmühle Ost"),
    # The split lines up with the bazaar street so both lanes stay straight: the bazaar lane dips
    # under the sky bridges, the roof lane climbs over them.
    ("CP07", "branch_entry", (72.0, 78.0, 22.0), 6.0, (1.0, 0.0, 0.0),
     ("CP08_BAZAAR", "CP08_ROOF"), "Marktplatz"),
    ("CP08_BAZAAR", "gate", (110.0, 56.0, 22.0), 5.0, (1.0, 0.0, 0.0), ("CP09",), "Basargasse"),
    ("CP08_ROOF", "gate", (110.0, 104.0, 22.0), 5.0, (1.0, 0.0, 0.0), ("CP09",), "Dachgärten"),
    ("CP09", "gate", (158.0, 80.0, -5.0), 6.0, (0.85, 0.0, -0.55), ("CP10",), "Marktausgang"),
    ("CP10", "gate", (152.0, 92.0, -62.0), 6.0, (0.0, 0.25, -1.0), ("CP11",), "Wetterturm Ost"),
    ("CP11", "gate", (120.0, 112.0, -100.0), 6.0, (-1.0, 0.3, 0.0), ("CP12",), "Wetterturm Nord"),
    ("CP12", "gate", (86.0, 132.0, -66.0), 6.0, (0.0, 0.3, 1.0), ("CP13",), "Kreiselringe"),
    ("CP13", "gate", (120.0, 160.0, -66.0), 7.0, (0.0, 1.0, 0.0), ("CP14",), "Turmspitze"),
    ("CP14", "gate", (70.0, 118.0, -110.0), 6.0, (-1.0, -0.4, -0.2), ("CP15",), "Seilbahn"),
    ("CP15", "gate", (20.0, 98.0, -118.0), 5.5, (-1.0, -0.2, 0.0), ("CP16",), "Gondeln"),
    ("CP16", "gate", (-30.0, 84.0, -118.0), 5.5, (-1.0, -0.2, 0.0), ("CP17",), "Talstation"),
    ("CP17", "gate", (-80.0, 52.0, -88.0), 6.0, (-0.8, -0.3, 0.5), ("FINISH",), "Ankerketten"),
)
FINISH = ("FINISH", "finish", (-128.0, 56.0, -48.0), 7.5, (-0.8, 0.05, 0.6), (), "Hafentor")

# Static geometry must keep this far from a ring centre: ring radius + RING_MARGIN.
RING_MARGIN = 3.0
# And this far from the straight line between two consecutive rings: min(radius) + CORRIDOR_MARGIN.
# Setpieces are exempt -- crossing a moving hazard is the point -- but must never sit on a ring
# centre for a whole loop.
CORRIDOR_MARGIN = 1.5

# --- Sections (map coordinates) ----------------------------------------------------------------
# The cloud sea far below everything: a collidable floor slab with puffy decorative tops.
CLOUD_SEA = dict(y_bottom=0.0, y_top=4.0, puff_top_y=14.0)

# Start platform: a floating mooring island with the mast the freight zeppelin is tied to. The
# player spawns above its deck, facing the zeppelin's open bow.
MOORING_DOCK = dict(x_back=-178.0, x_front=-122.0, z=100.0, deck_y=56.0, deck_half_width=18.0,
                    island_bottom_y=24.0, mast_x=-128.0, mast_z=124.0, mast_top_y=104.0)

# The freight zeppelin lies along +x with its keel corridor open end to end: bow doors swung
# open at x_bow, a loading hatch open at the stern. Inside, a clear tunnel of bay_radius around
# the axis; ribs, gas cells and catwalks stay outside it.
CARGO_ZEPPELIN = dict(x_bow=-112.0, x_stern=-18.0, z=100.0, axis_y=68.0, envelope_radius=24.0,
                      bay_radius=13.0, fin_span=16.0, engine_pods=((-80.0, 1), (-80.0, -1),
                                                                   (-40.0, 1), (-40.0, -1)))

# The envelope optic is _nocol; collision comes from a closed _colonly thick tube around the
# tunnel: inner radius hull_collider_inner, outer hull_collider_outer, capped at both ends (a
# closed solid ring, so the parity test sees no phantom walls inside the tunnel).
CARGO_ZEPPELIN_COLLIDER = dict(hull_collider_inner=14.5, hull_collider_outer=22.0)

# Cargo nets swing on chains from a pivot just under the tunnel ceiling, across the tunnel, along
# z (setpiece). Everything they sweep stays inside hull_collider_inner of the axis.
CARGO_NETS = dict(x=(-86.0, -44.0), pivot_y=81.5, net_bottom_y=62.0, swing_degrees=25.0,
                  bundle_size=5.0, loop_seconds=8)

# Wind isle: a grassy island with two windmills whose rotors stand across the course.
WIND_ISLE = dict(x_min=-6.0, x_max=72.0, z_min=40.0, z_max=118.0, deck_y=14.0,
                 island_bottom_y=4.0)

# axis = map axis of the rotor shaft; the rotor disc is perpendicular to it and faces the incoming
# flight. The tower runs from the deck to just below the hub, the nacelle sits behind the rotor
# (downstream: +x for the west mill, -z for the east mill). Rotors are setpieces, towers and
# nacelles are static (wind isle part).
WINDMILLS = (
    dict(hub=(15.0, 50.0, 92.0), axis="x", downstream=(1.0, 0.0, 0.0), hub_radius=4.0,
         tip_radius=28.0, blades=4, blade_chord=5.0, loop_seconds=16),
    dict(hub=(48.0, 55.0, 60.0), axis="z", downstream=(0.0, 0.0, -1.0), hub_radius=4.0,
         tip_radius=28.0, blades=4, blade_chord=5.0, loop_seconds=16),
)

# Market isle: two rows of tall houses along a street running east (z = street_z). The bazaar
# lane flies down the street under the sky bridges; the roof lane flies above the bridges between
# rooftop gardens. House rows end at x_houses_end so the lanes can leave the street to CP09.
MARKET_ISLE = dict(x_min=82.0, x_max=150.0, z_min=-14.0, z_max=58.0, deck_y=36.0,
                   island_bottom_y=6.0, street_z=22.0, street_half_width=14.0,
                   x_houses_start=86.0, x_houses_end=122.0, roof_y=86.0,
                   sky_bridges_x=(104.0, 118.0), sky_bridge_bottom_y=70.0,
                   sky_bridge_top_y=76.0)

# Weather tower on its own island; the course spirals up around it.
WEATHER_TOWER = dict(x=120.0, z=-66.0, island_radius=34.0, deck_y=40.0, island_bottom_y=10.0,
                     radius=13.0, top_y=136.0, clear_radius_above_top=12.0)

# Two gyroscope rings tilted around the upper tower, turning on different axes (setpiece).
GYRO_RINGS = dict(center=(120.0, 122.0, -66.0), radius=(26.0, 33.0), tube_radius=1.6,
                  loop_seconds=24)

# Cable-car line from the mountain station (own rock pillar beside the weather tower) down to the
# valley station near the harbor. Two cables at cable_z +/- cable_offset run straight from the east
# to the west anchor, right above the lane; they are thin and _nocol. The portal pylons straddle
# the lane: legs at cable_z +/- pylon_leg_offset, crossbeam just above the cables.
CABLEWAY = dict(cable_z=-116.0, cable_offset=3.0, east_anchor=(98.0, 134.0),
                west_anchor=(-42.0, 96.0), pylon_x=(45.0, -5.0), pylon_leg_offset=14.0, crossbeam_gap=3.0,
                mountain_station=(100.0, 134.0, -122.0), valley_station=(-46.0, 96.0, -118.0),
                station_size=(14.0, 12.0, 16.0))


def cable_y(x):
    """Height of the cables at map x (straight line between the two anchors)."""
    (xe, ye), (xw, yw) = CABLEWAY["east_anchor"], CABLEWAY["west_anchor"]
    return yw + (x - xw) * (ye - yw) / (xe - xw)


# Gondolas run along both cables in opposite directions (setpiece); they hang hang_depth below the
# cable to the cabin top, so they sweep through the top of the lane.
CABLE_CARS = dict(count_per_cable=3, hang_depth=8.0, cabin_size=(6.0, 5.0, 4.0), loop_seconds=24)

# The harbor island: the city's biggest rock north-west of the course, with a stone pier reaching
# south-east over the approach. Anchor chains hang from the pier on both sides of the corridor
# CP16 -> CP17 -> FINISH like slalom poles (each chain clearance + 1..6 from the corridor line).
# The harbor gate (finish) is a round arch on a rock spur south of the island; its opening is
# centred on FINISH and faces FINISH's forward.
HARBOR_ISLAND = dict(x=-125.0, z=-110.0, radius=44.0, deck_y=74.0, island_bottom_y=28.0,
                     pier_deck_y=84.0, chain_bottom_y=24.0, chain_count=6,
                     gate=(-128.0, 56.0, -48.0), gate_inner_radius=12.0, gate_ring_width=4.0)

# A small patrol zeppelin cruising back and forth across the harbor approach (setpiece); its path
# crosses the corridor CP16 -> CP17 near x = -60.
PATROL_ZEPPELIN = dict(path_a=(-60.0, 66.0, -40.0), path_b=(-60.0, 66.0, -140.0), length=30.0,
                       radius=6.0, loop_seconds=20)
# No static geometry inside this box (map coordinates, min/max): the patrol zeppelin's sweep,
# turns at both ends included. The pier crosses it above, chains hang outside it.
PATROL_KEEP_OUT = dict(x=(-78.0, -42.0), y=(56.0, 78.0), z=(-158.0, -22.0))
# --- Materials: (base RGBA, emission strength, metallic[, emission RGB]) -------------------------
# A bright day map: glowing materials keep an almost black base and one dominant emission channel,
# and stay at or below 1.0, or the renderer's tone mapping turns them into flat white.
ENVELOPE = "Envelope"
ENVELOPE_DARK = "EnvelopeDark"
BRASS = "Brass"
WOOD = "Wood"
STONE = "Stone"
ROCK = "Rock"
GRASS = "Grass"
ROOF_TILE = "RoofTile"
PLASTER = "Plaster"
CLOUD = "Cloud"
CANVAS_RED = "CanvasRed"
IRON = "Iron"
GLOW_WARM = "GlowWarm"
GLOW_TEAL = "GlowTeal"

MATERIALS = {
    ENVELOPE: ((0.78, 0.74, 0.66, 1.0), 0.0, 0.0),
    ENVELOPE_DARK: ((0.36, 0.33, 0.30, 1.0), 0.0, 0.1),
    BRASS: ((0.72, 0.52, 0.22, 1.0), 0.0, 0.8),
    WOOD: ((0.42, 0.27, 0.15, 1.0), 0.0, 0.0),
    STONE: ((0.66, 0.62, 0.56, 1.0), 0.0, 0.0),
    ROCK: ((0.40, 0.36, 0.33, 1.0), 0.0, 0.0),
    GRASS: ((0.32, 0.50, 0.22, 1.0), 0.0, 0.0),
    ROOF_TILE: ((0.62, 0.26, 0.16, 1.0), 0.0, 0.0),
    PLASTER: ((0.86, 0.80, 0.70, 1.0), 0.0, 0.0),
    CLOUD: ((0.93, 0.95, 0.98, 1.0), 0.0, 0.0),
    CANVAS_RED: ((0.68, 0.14, 0.12, 1.0), 0.0, 0.0),
    IRON: ((0.20, 0.21, 0.23, 1.0), 0.0, 0.7),
    GLOW_WARM: ((0.03, 0.02, 0.01, 1.0), 0.8, 0.0, (1.0, 0.55, 0.12)),
    GLOW_TEAL: ((0.01, 0.03, 0.03, 1.0), 0.8, 0.0, (0.1, 0.9, 0.8)),
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
    """python scripts/cloud_harbor_layout.py -- sanity numbers for the route."""
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
            print(f"{feeder[0]:>12} -> {ring_id:<12} step={norm(step):6.1f} facing={facing:5.2f}")
            assert facing >= 0.2, (feeder[0], ring_id, facing)
    first = sub(CHECKPOINTS[0][2], SPAWN)
    print(f"spawn -> CP01 {norm(first):.1f}  path (all lanes) {total:.0f}")
    assert norm(first) <= 20.0
    assert set(by_id) >= {n for e in CHECKPOINTS for n in e[5]}


if __name__ == "__main__":
    _check()
