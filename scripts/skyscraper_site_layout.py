"""Shared layout of the Skyscraper Site parcours map (key skyscraper_site, "Wolkenkratzer-Baustelle").

Pure data, no bpy: the three builder modules, the generator and the map preset all read their
positions from here, so a ring and the structure around it cannot drift apart.

Coordinates are MAP coordinates in authored units (before MAP_SCALE 3): x east, y up, z south.
Blender is Z-up and the glTF export turns Blender -Y into map +Z, so every builder converts with
bl(x, y, z) -> (x, -z, y). The preset places every part at scale 1 on the centre/base the
generator reports, which puts each file back into this one shared frame.

The course (sunset, warm light from the west/south-west):
street canyon between finished towers -> up the facade scaffold under a slewing crane -> through
the steel skeleton past the hoist cabin -> along the concrete core -> into the elevator shaft and
straight up -> out over the main crane's jib -> past the beam swinging on its hook -> turn over the
canyon -> land on the roof of the construction tower (finish).

Builder contract (each module owns the parts listed in PARTS with its module name):
  build_<part_stem>(ctx) -> None   e.g. build_street_ground, build_tower_crane
  ctx carries mat(name), box(...), etc. from the generator; every mesh lives inside the part's
  BBOX (map frame), names follow NAMING below, setpieces own exactly one clip named CLIP.
"""

ARENA_SIZE = (360.0, 200.0, 300.0)  # x, y, z; x and z are centred on 0, y runs 0..200


def bl(x, y, z):
    """Map coordinates -> Blender coordinates."""
    return (x, -z, y)


SPAWN = (-160.0, 15.0, 100.0)
SPAWN_FORWARD = (1.0, 0.0, 0.0)

# (id, type, position, radius, forward, next_ids, label)
CHECKPOINTS = (
    ("CP01", "gate", (-142.0, 15.0, 100.0), 6.0, (1.0, 0.0, 0.0), ("CP02",), "Straßenschlucht"),
    ("CP02", "gate", (-102.0, 18.0, 100.0), 6.0, (1.0, 0.1, 0.0), ("CP03",), "Kreuzung"),
    ("CP03", "gate", (-70.0, 30.0, 86.0), 5.5, (0.8, 0.45, -0.4), ("CP04",), "Gerüst unten"),
    ("CP04", "gate", (-50.0, 50.0, 72.0), 5.0, (0.7, 0.6, -0.45), ("CP05",), "Gerüst oben"),
    ("CP05", "gate", (-22.0, 58.0, 45.0), 6.0, (0.7, 0.1, -0.7), ("CP06",), "Trägerskelett"),
    ("CP06", "gate", (4.0, 60.0, 15.0), 5.5, (0.6, 0.0, -0.8), ("CP07",), "Trägerfeld"),
    ("CP07", "gate", (25.0, 64.0, -15.0), 5.5, (0.55, 0.1, -0.85), ("CP08",), "Bauaufzug"),
    ("CP08", "gate", (48.0, 62.0, -45.0), 5.5, (0.8, 0.0, -0.6), ("CP09",), "Betonkern"),
    # The shaft door faces west; CP10/CP11 sit on the shaft axis, so the climb is truly vertical.
    ("CP09", "gate", (68.0, 62.0, -60.0), 5.0, (1.0, 0.0, 0.0), ("CP10",), "Schachttür"),
    ("CP10", "gate", (78.0, 90.0, -60.0), 5.0, (0.0, 1.0, 0.0), ("CP11",), "Aufzugsschacht"),
    ("CP11", "gate", (78.0, 124.0, -60.0), 5.0, (0.0, 1.0, 0.0), ("CP12",), "Schachtkopf"),
    ("CP12", "gate", (70.0, 152.0, -32.0), 6.0, (-0.3, 0.4, 0.85), ("CP13",), "Über dem Dach"),
    ("CP13", "gate", (42.0, 156.0, 0.0), 6.0, (-0.7, 0.0, 0.7), ("CP14",), "Kranausleger"),
    ("CP14", "gate", (8.0, 150.0, 28.0), 6.0, (-0.8, -0.15, 0.6), ("CP15",), "Kranhaken"),
    ("CP15", "gate", (-32.0, 142.0, 40.0), 6.0, (-0.95, -0.2, 0.2), ("CP16",), "Pendelträger"),
    ("CP16", "gate", (-58.0, 136.0, 5.0), 6.5, (-0.3, -0.1, -0.95), ("CP17",), "Wende"),
    ("CP17", "gate", (-30.0, 130.0, -38.0), 6.0, (0.8, -0.15, -0.55), ("CP18",), "Dachanflug"),
    ("CP18", "gate", (5.0, 127.0, -40.0), 6.0, (1.0, -0.05, 0.05), ("FINISH",), "Dachkante"),
)
FINISH = ("FINISH", "finish", (38.0, 126.0, -32.0), 7.0, (1.0, 0.0, 0.25), (), "Dachspitze")

# Static geometry must keep this far from a ring centre: ring radius + RING_MARGIN.
RING_MARGIN = 3.0
# And this far from the straight line between two consecutive rings: min(radius) + CORRIDOR_MARGIN.
# Setpieces are exempt -- crossing a moving hazard is the point -- but must never sit on a ring
# centre for a whole loop and must leave a passable gap in every frame (checked by the scratchpad
# probes, not by repo tests).
CORRIDOR_MARGIN = 1.5

# --- Sections (map coordinates) ----------------------------------------------------------------
GROUND = dict(y_bottom=-2.0, y_top=0.0)
STREET = dict(x_min=-180.0, x_max=-40.0, z_min=82.0, z_max=118.0)  # open canyon floor, y=0
SKYLINE_WEST = dict(x_min=-180.0, x_max=-80.0, street_gap=(82.0, 118.0), heights=(90.0, 170.0))
SCAFFOLD = dict(x_min=-80.0, x_max=-30.0, z_min=55.0, z_max=100.0, top_y=70.0, deck_step=10.0)
SKELETON = dict(x_min=-30.0, x_max=60.0, z_min=-75.0, z_max=55.0, floor_step=10.0, top_y=110.0,
                column_grid=15.0)
# The core sits east of the flown bays; the route runs along its west wall (CP08).
CONCRETE_CORE = dict(x_min=56.0, x_max=68.0, z_min=-40.0, z_max=-10.0, top_y=115.0)
SHAFT = dict(x=78.0, z=-60.0, inner_half=9.0, wall=1.0, y_bottom=50.0, y_top=135.0,
             door_y=(54.0, 86.0), door_half_width=9.0)
ROOF = dict(x_min=-20.0, x_max=60.0, z_min=-70.0, z_max=10.0, y=112.0, spire=(52.0, -40.0, 165.0))
MAIN_CRANE = dict(x=20.0, z=-5.0, mast_half=2.0, jib_y=144.0, jib_dir=(1.0, 0.0, 0.0),
                  jib_length=55.0, counter_jib_length=20.0, top_y=158.0)

# --- Setpieces (one clip each, LINEAR keys, loop) -------------------------------------------------
SLEWING_CRANE = dict(x=-95.0, z=45.0, jib_y=40.0, jib_length=45.0, counter_jib_length=15.0,
                     top_y=52.0, loop_seconds=24)  # jib sweeps the CP03->CP04 climb
HOIST = dict(x=40.0, z=-21.0, cabin_offset=(-3.5, 0.0, -2.7), cabin_size=(6.0, 6.0, 6.0), y_low=10.0, y_high=105.0,
             loop_seconds=12)  # mast beside the CP07->CP08 lane, cabin overhangs half of it
BEAM_PENDULUM = dict(pivot=(-12.0, 172.0, 34.0), rope=22.0, beam_length=16.0, amplitude_deg=35.0,
                     swing_axis=(1.0, 0.0, 0.0), loop_seconds=8)  # across CP14->CP15
BUCKET = dict(pivot=(-8.0, 100.0, 30.0), rope=38.0, bucket_radius=2.5, amplitude_deg=30.0,
              swing_axis=(0.0, 0.0, 1.0), loop_seconds=10)  # across CP05->CP06

# --- Parts: (file stem, builder module, kind, bbox (x0, y0, z0, x1, y1, z1) map frame[, clip, s]) --
SKYLINE = "skyscraper_site_skyline"
CORE = "skyscraper_site_core"
SETPIECES = "skyscraper_site_setpieces"

PARTS = (
    ("01_street_ground", SKYLINE, "static", (-180.0, -2.0, -150.0, 180.0, 0.0, 150.0)),
    ("02_skyline_street", SKYLINE, "static", (-180.0, 0.0, 40.0, -40.0, 170.0, 150.0)),
    ("03_skyline_backdrop", SKYLINE, "static", (-180.0, 0.0, -150.0, 180.0, 190.0, -95.0)),
    ("04_scaffold", CORE, "static", (-80.0, 0.0, 55.0, -30.0, 70.0, 100.0)),
    ("05_steel_skeleton", CORE, "static", (-30.0, 0.0, -75.0, 56.0, 110.0, 55.0)),
    ("06_concrete_core", CORE, "static", (56.0, 0.0, -40.0, 68.0, 115.0, -10.0)),
    ("07_elevator_shaft", CORE, "static", (68.0, 0.0, -70.0, 88.0, 135.0, -50.0)),
    ("08_roof_finale", SKYLINE, "static", (-20.0, 110.0, -70.0, 60.0, 165.0, 10.0)),
    ("09_main_crane", CORE, "static", (0.0, 0.0, -10.0, 78.0, 158.0, 0.0)),
    ("10_slewing_crane", SETPIECES, "anim", (-140.0, 0.0, 0.0, -50.0, 52.0, 90.0),
     "SlewingCraneLoop", 24),
    ("11_hoist_cabin", SETPIECES, "anim", (31.0, 0.0, -30.0, 44.0, 112.0, -17.0),
     "HoistCabinLoop", 12),
    ("12_beam_pendulum", SETPIECES, "anim", (-28.0, 140.0, 14.0, 4.0, 172.0, 54.0),
     "BeamPendulumLoop", 8),
    ("13_concrete_bucket", SETPIECES, "anim", (-30.0, 58.0, 26.0, 14.0, 100.0, 34.0),
     "ConcreteBucketLoop", 10),
)

# --- Naming (the loader reads roles from mesh names, case-insensitive substrings) ---------------
# <Part>_<Thing>[_<marker>...]; ASCII letters, digits, underscore only (no dots, spaces, umlauts).
#   no marker   visible and solid (closed mesh per material, else phantom walls)
#   _nocol      visible, fly-through (nets, cables, window glow, thin railings, striped skins)
#   _colonly    invisible, solid (one closed single-material hull under fine _nocol detail)
#   _dyn        collision follows the animation (every moving solid mesh in 10_.. parts)
#   _noshadow   no shadow (small detail)
NAMING = ("_nocol", "_colonly", "_dyn", "_noshadow")

# --- Materials: (base RGBA, emission strength, metallic[, emission RGB]) -------------------------
# Glowing materials keep an almost black base and one dominant emission channel, at or below 1.0.
STEEL = "Steel"
STEEL_RUST = "SteelRust"
CONCRETE = "Concrete"
CONCRETE_DARK = "ConcreteDark"
SCAFFOLD_TUBE = "ScaffoldTube"
CRANE_YELLOW = "CraneYellow"
HAZARD = "Hazard"
GLASS_TOWER = "GlassTower"
WINDOW_WARM = "WindowWarm"
ASPHALT = "Asphalt"
NET = "SafetyNet"
GLOW_RED = "GlowRed"

MATERIALS = {
    STEEL: ((0.38, 0.40, 0.43, 1.0), 0.0, 0.6),
    STEEL_RUST: ((0.42, 0.22, 0.10, 1.0), 0.0, 0.4),
    CONCRETE: ((0.58, 0.56, 0.52, 1.0), 0.0, 0.0),
    CONCRETE_DARK: ((0.30, 0.29, 0.28, 1.0), 0.0, 0.0),
    SCAFFOLD_TUBE: ((0.55, 0.57, 0.60, 1.0), 0.0, 0.7),
    CRANE_YELLOW: ((0.85, 0.62, 0.08, 1.0), 0.0, 0.3),
    HAZARD: ((0.85, 0.36, 0.06, 1.0), 0.0, 0.2),
    GLASS_TOWER: ((0.16, 0.20, 0.26, 1.0), 0.0, 0.8),
    WINDOW_WARM: ((0.04, 0.03, 0.01, 1.0), 0.8, 0.0, (1.0, 0.55, 0.15)),
    ASPHALT: ((0.12, 0.12, 0.13, 1.0), 0.0, 0.0),
    NET: ((0.15, 0.45, 0.20, 1.0), 0.0, 0.0),
    GLOW_RED: ((0.03, 0.01, 0.01, 1.0), 1.0, 0.0, (1.0, 0.08, 0.05)),
}


def all_checkpoints():
    return CHECKPOINTS + (FINISH,)


def corridors():
    """Every (from, to, clearance) segment a player flies."""
    by_id = {entry[0]: entry for entry in all_checkpoints()}
    segments = [(SPAWN, CHECKPOINTS[0][2], CHECKPOINTS[0][3] + CORRIDOR_MARGIN)]
    for entry in CHECKPOINTS:
        for next_id in entry[5]:
            target = by_id[next_id]
            segments.append((entry[2], target[2], min(entry[3], target[3]) + CORRIDOR_MARGIN))
    return segments


def parts_for(module):
    return tuple(p for p in PARTS if p[1] == module)


def _check():
    """python scripts/skyscraper_site_layout.py -- sanity numbers for the route and parts."""
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
            print(f"{feeder[0]:>6} -> {ring_id:<7} step={norm(step):6.1f} facing={facing:5.2f}")
            assert facing >= 0.2, (feeder[0], ring_id, facing)
            assert 15.0 <= norm(step) <= 60.0, (feeder[0], ring_id, norm(step))
    first = sub(CHECKPOINTS[0][2], SPAWN)
    ys = [e[2][1] for e in all_checkpoints()]
    print(f"spawn -> CP01 {norm(first):.1f}  path {total:.0f}  rings {len(all_checkpoints())}"
          f"  height {min(ys):.0f}..{max(ys):.0f}")
    assert norm(first) <= 20.0
    assert set(by_id) >= {n for e in CHECKPOINTS for n in e[5]}
    # Parts: unique stems, static 0x / animated 1x, bbox inside the arena.
    stems = [p[0] for p in PARTS]
    assert len(set(stems)) == len(stems)
    for stem, module, kind, box, *clip in PARTS:
        assert module in (SKYLINE, CORE, SETPIECES), stem
        assert (kind == "anim") == stem.startswith("1") == bool(clip), stem
        assert box[0] < box[3] and box[1] < box[4] and box[2] < box[5], stem
        assert -half[0] <= box[0] and box[3] <= half[0] and -half[1] <= box[2] and box[5] <= half[1], stem
        assert -2.0 <= box[1] and box[4] <= ARENA_SIZE[1], stem
    # The vertical shaft rings sit on the shaft axis and inside its top/bottom.
    for ring_id in ("CP10", "CP11"):
        pos, radius = by_id[ring_id][2], by_id[ring_id][3]
        assert (pos[0], pos[2]) == (SHAFT["x"], SHAFT["z"]), ring_id
        assert radius + RING_MARGIN <= SHAFT["inner_half"] + 0.01, ring_id
        assert SHAFT["y_bottom"] < pos[1] < SHAFT["y_top"], ring_id
    # The finish ring floats clear above the roof.
    assert FINISH[2][1] - FINISH[3] - RING_MARGIN >= ROOF["y"], "finish too low"


if __name__ == "__main__":
    _check()
