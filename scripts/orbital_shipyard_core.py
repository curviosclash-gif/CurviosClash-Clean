"""Orbital Shipyard: station deck, airlock hall, drydock tower and fuel canyon (static architecture).

Every builder works in MAP coordinates (x east, y up, z south, before MAP_SCALE) and converts each
point to Blender with `_p()` right before it reaches the canvas, so a beam/box/pipe endpoint can be
read straight off `orbital_shipyard_layout.py` without a separate mental translation step.

Clearance only binds *colliding* geometry (the checker builds its BVH tree from every mesh whose
name has no `_nocol`), and the moving-setpiece overlap checker does the same. So the bulk of the
detail below -- ribs, panel lines, pipe runs, lights, bands, catwalks, lattices -- is decorative and
exempt from both; only the handful of load-bearing masses (the deck slab, the hall/duct shell, the
tower shaft, the canyon floor and walls) are built solid and sized against the ring/corridor numbers.
"""

from math import cos, pi, sin

from mathutils import Matrix, Vector

import generate_eiffel_tower_assets as et
import orbital_shipyard_layout as L

HULL_PLATE = L.HULL_PLATE
HULL_DARK = L.HULL_DARK
TRUSS = L.TRUSS
DECK = L.DECK
HAZARD = L.HAZARD
PIPE = L.PIPE
GLOW_CYAN = L.GLOW_CYAN
GLOW_AMBER = L.GLOW_AMBER
GLOW_RED = L.GLOW_RED
WINDOW = L.WINDOW
STEEL = et.STEEL


# --- Map-frame helpers ---------------------------------------------------------------------------
# Everything below is authored in map coordinates and converted at the last moment, so the numbers
# in this file read the same as the numbers in orbital_shipyard_layout.py.


def _p(x, y, z):
    """A map-frame point -> a Blender point, for box/beam/frustum centres and beam endpoints."""
    return L.bl(x, y, z)


def _size(dx, dy, dz):
    """A map-frame axis-aligned extent -> the Blender box() size.

    bl() turns map (x, y, z) into Blender (x, -z, y); an *extent* has no sign to flip, so the same
    permutation (drop the sign, swap y and z) carries a box size across.
    """
    return (dx, dz, dy)


def _box(canvas, material, center, size, decorative=False):
    """An axis-aligned box authored in map coordinates (bl() keeps axes aligned: no rotation)."""
    canvas.box(material, _p(*center), _size(*size), decorative=decorative)


def _beam(canvas, material, a, b, thickness, width=None, decorative=False):
    canvas.beam(material, _p(*a), _p(*b), thickness, width=width, decorative=decorative)


def _frustum_y(canvas, material, center, r_bottom, r_top, height, sides=12, decorative=False):
    """A cylinder/cone on the map Y (up) axis -- Blender Z, so this needs no rotation either."""
    canvas.frustum(material, _p(*center), r_bottom, r_top, height, sides=sides,
                    decorative=decorative)


def _pipe(canvas, material, a, b, radius, sides=8, decorative=False):
    """A round member between two map points in any direction, for pipes, rails and braces.

    Reuses the toolkit's frustum geometry with beam's own orientation trick (track the segment
    with local Z) instead of guessing an Euler angle for an arbitrary direction.
    """
    start, end = Vector(_p(*a)), Vector(_p(*b))
    direction = end - start
    length = direction.length
    if length < 1e-5:
        return
    matrix = (Matrix.Translation((start + end) / 2)
              @ direction.to_track_quat("Z", "Y").to_matrix().to_4x4())
    verts, faces = et.frustum_geometry(radius, radius, length, sides)
    canvas._add(material, decorative, verts, faces, matrix)


def _segments(lo, hi, gaps):
    """[lo, hi] with the sorted (gap_lo, gap_hi) spans removed, as a list of (start, end).

    Shared by the airlock hall's door gaps and the fuel canyon's piston gaps: both are a run of
    structure interrupted by a few fixed-width openings for another agent's setpiece.
    """
    spans = []
    cursor = lo
    for gap_lo, gap_hi in gaps:
        if gap_lo > cursor:
            spans.append((cursor, gap_lo))
        cursor = max(cursor, gap_hi)
    if cursor < hi:
        spans.append((cursor, hi))
    return spans


def _in_any(x, spans, pad=0.0):
    return any(lo - pad < x < hi + pad for lo, hi in spans)


# --- 01: station deck -----------------------------------------------------------------------------


def build_station_deck(canvas):
    """The colliding floor of the drydock, far below the course -- y 0..3 across the whole arena.

    Every ring on the route sits at y >= 30 (see orbital_shipyard_layout.CHECKPOINTS), so anything
    built here at y <= 11 is at least ~19 units below the lowest ring or corridor point -- more
    than any ring radius plus margin. Clearance holds by construction; no need to dodge x/z spots.
    That headroom is also why this part can carry real (colliding) clutter, not just decoration.
    """
    half_x = L.ARENA_SIZE[0] / 2
    half_z = L.ARENA_SIZE[2] / 2
    y0, y1 = L.STATION_DECK["y_bottom"], L.STATION_DECK["y_top"]
    mid = (y0 + y1) / 2

    _box(canvas, DECK, (0.0, mid, 0.0), (half_x * 2, y1 - y0, half_z * 2))

    # Expansion-joint seams: a grid raised a hair above the plate, decorative so it never fights
    # the plate's own top face for the collider.
    seam_y = y1 + 0.06
    x = -half_x + 40.0
    while x < half_x - 1.0:
        _box(canvas, HULL_DARK, (x, seam_y, 0.0), (0.5, 0.08, half_z * 2), decorative=True)
        x += 40.0
    z = -half_z + 40.0
    while z < half_z - 1.0:
        _box(canvas, HULL_DARK, (0.0, seam_y, z), (half_x * 2, 0.08, 0.5), decorative=True)
        z += 40.0

    # Two long taxi-guide lanes, glowing so the huge plain floor reads from height.
    for material, zpos in ((GLOW_CYAN, -55.0), (GLOW_AMBER, 55.0)):
        _box(canvas, material, (0.0, seam_y, zpos), (half_x * 1.7, 0.07, 1.2), decorative=True)

    _deck_yard(canvas, y1)
    _deck_cranes(canvas, y1)
    _deck_pads(canvas, y1)


def _deck_yard(canvas, y1):
    """Cargo containers (mixed sizes, some stacked), a rail spur and hatch covers."""
    # Containers: three staggered rows south of the corridor spine, sizes varied by index so the
    # row does not read as one stamped-out prop -- variation from the loop index, never random().
    sizes = ((8.0, 6.0, 5.0), (10.0, 6.0, 6.0), (6.0, 5.0, 5.0), (8.0, 9.0, 5.0))
    for row, rz in enumerate((-128.0, -116.0, -104.0)):
        for index in range(11):
            cx = -172.0 + index * 32.0
            size = sizes[(index + row) % len(sizes)]
            _box(canvas, HULL_PLATE, (cx, y1 + size[1] / 2, rz), size)
            if (index + row) % 3 == 0:
                # A second box stacked on top -- still comfortably under the 8-unit cap.
                top_size = sizes[(index + row + 1) % len(sizes)]
                top_size = (top_size[0] * 0.9, min(1.6, 8.0 - size[1]), top_size[2] * 0.9)
                if top_size[1] > 0.5:
                    _box(canvas, HULL_DARK, (cx, y1 + size[1] + top_size[1] / 2, rz), top_size)

    # A rail pair with cross-ties, like a gantry track laid into the deck.
    for sign in (-1, 1):
        _beam(canvas, TRUSS, (-150.0, y1 + 0.3, sign * 34.0), (150.0, y1 + 0.3, sign * 34.0), 0.8)
    tie_x = -145.0
    while tie_x <= 145.0:
        _beam(canvas, TRUSS, (tie_x, y1 + 0.25, -34.0), (tie_x, y1 + 0.25, 34.0), 0.45, width=1.3)
        tie_x += 12.0

    # Flush hazard-striped hatch covers, purely cosmetic markers scattered around the yard.
    hatches = ((-90.0, 100.0), (70.0, -70.0), (150.0, 40.0), (-30.0, -100.0), (10.0, 5.0),
               (-160.0, 60.0), (120.0, 100.0), (-60.0, 40.0))
    for hx, hz in hatches:
        _frustum_y(canvas, HAZARD, (hx, y1 + 0.03, hz), 4.0, 4.0, 0.06, sides=14, decorative=True)
        for ring in range(4):
            angle = 2 * pi * ring / 4
            bolt = (hx + 3.3 * cos(angle), y1 + 0.05, hz + 3.3 * sin(angle))
            _frustum_y(canvas, HULL_DARK, bolt, 0.25, 0.25, 0.1, sides=6, decorative=True)


def _deck_cranes(canvas, y1):
    """A pair of small gantry cranes -- kept under the 8-unit height cap, mast is colliding, the
    boom and rigging are decorative (they sway on nothing here, so cannot foul anything)."""
    for cx, cz, boom_dir in ((-100.0, 20.0, 1.0), (110.0, -20.0, -1.0)):
        for sign in (-1, 1):
            _beam(canvas, TRUSS, (cx, y1, cz + sign * 4.0), (cx, y1 + 7.5, cz + sign * 4.0), 0.7)
        _beam(canvas, TRUSS, (cx, y1 + 7.5, cz - 4.0), (cx, y1 + 7.5, cz + 4.0), 0.6)
        boom_end = (cx + boom_dir * 14.0, y1 + 7.0, cz)
        _beam(canvas, TRUSS, (cx, y1 + 7.5, cz), boom_end, 0.5, decorative=True)
        _pipe(canvas, PIPE, (cx, y1 + 7.5, cz), boom_end, 0.15, sides=6, decorative=True)
        _frustum_y(canvas, GLOW_AMBER, boom_end, 0.3, 0.1, 0.5, sides=6, decorative=True)


def _deck_pads(canvas, y1):
    """Two landing-pad rings with rim lights -- flush discs, low colliding bumps."""
    for px, pz in ((-40.0, 90.0), (90.0, -120.0)):
        _frustum_y(canvas, DECK, (px, y1 + 0.15, pz), 12.0, 12.0, 0.3, sides=20)
        lights = 14
        for index in range(lights):
            angle = 2 * pi * index / lights
            pos = (px + 11.3 * cos(angle), y1 + 0.35, pz + 11.3 * sin(angle))
            glow = GLOW_CYAN if index % 2 == 0 else GLOW_AMBER
            _frustum_y(canvas, glow, pos, 0.3, 0.1, 0.2, sides=6, decorative=True)
        _frustum_y(canvas, HAZARD, (px, y1 + 0.31, pz), 12.3, 12.3, 0.12, sides=20,
                   decorative=True)


# --- 05: airlock hall + maintenance duct ------------------------------------------------------


def build_airlock_hall(canvas):
    """An enclosed corridor (the airlock hall) with a maintenance duct riding its roof.

    The roof slab sits at exactly `ceiling_y..roof_top_y` and doubles as the duct floor; both the
    hall and the duct stop at exactly `x_entry`/`x_exit` with nothing overhanging either end -- the
    duct-lane corridor leaving through the exit clears the slab top by well under a metre in the
    layout's own numbers, so any lip there would fail the clearance check. The side walls get a
    clean gap at each `doors_x` for the door setpiece; the floor and roof stay unbroken since they
    sit outside the door's own floor_y..ceiling_y band. Every added surface detail below (ribs,
    panel lines, pipe runs, radiators, lights, portal frames, floor stripes) is decorative, so it
    is free to be dense without touching either the ring/corridor checker or the setpiece-overlap
    checker (both skip `_nocol` meshes) -- it stays out of the door gaps anyway, by convention with
    the door setpiece's own reserved pocket volume.
    """
    A, D = L.AIRLOCK, L.DUCT
    x0, x1 = A["x_entry"], A["x_exit"]
    zn, zx = A["z_min"], A["z_max"]
    floor_y, ceil_y, roof_y = A["floor_y"], A["ceiling_y"], A["roof_top_y"]
    wall_t = 2.0
    outer_zn, outer_zx = zn - wall_t, zx + wall_t

    # Floor slab (below floor_y, unbroken) and roof slab (exactly ceiling_y..roof_top_y, the tight
    # one -- it must not reach past x0/x1 by even a small trim).
    _box(canvas, HULL_PLATE, ((x0 + x1) / 2, floor_y - 1.5, (outer_zn + outer_zx) / 2),
         (x1 - x0, 3.0, outer_zx - outer_zn))
    _box(canvas, HULL_PLATE, ((x0 + x1) / 2, (ceil_y + roof_y) / 2, (outer_zn + outer_zx) / 2),
         (x1 - x0, roof_y - ceil_y, outer_zx - outer_zn))

    # Side walls, split into segments so each door gets a clean opening from floor_y to ceiling_y.
    gap_half = A["door_slot_half_width"] + 1.5
    gaps = [(dx - gap_half, dx + gap_half) for dx in A["doors_x"]]
    segments = _segments(x0, x1, gaps)
    wall_mid_y = (floor_y + ceil_y) / 2
    wall_h = ceil_y - floor_y
    for seg_x0, seg_x1 in segments:
        seg_len = seg_x1 - seg_x0
        seg_mid = (seg_x0 + seg_x1) / 2
        for wall_z in (zn - wall_t / 2, zx + wall_t / 2):
            _box(canvas, HULL_PLATE, (seg_mid, wall_mid_y, wall_z), (seg_len, wall_h, wall_t))
        # A door frame lip, flush with the opening edges -- decorative, so it costs no clearance.
        if seg_x1 < x1:
            for wall_z in (zn - wall_t, zx + wall_t):
                _box(canvas, HULL_DARK, (seg_x1 + 0.3, wall_mid_y, wall_z),
                     (0.6, wall_h + 1.0, wall_t + 1.0), decorative=True)

    _hall_exterior_detail(canvas, segments, zn, zx, floor_y, ceil_y, wall_t)
    _hall_interior_detail(canvas, segments, zn, zx, floor_y, ceil_y)
    _hall_portals(canvas, x0, x1, zn, zx, floor_y, ceil_y)

    # Pylons down to the station deck, planted outside the hall footprint so they never touch the
    # flight corridor (which runs along the hall's own centreline, well inside the walls).
    for seg_x0, seg_x1 in segments:
        for px in (seg_x0 + (seg_x1 - seg_x0) * 0.25, seg_x0 + (seg_x1 - seg_x0) * 0.75):
            for pz in (outer_zn - 1.0, outer_zx + 1.0):
                _beam(canvas, HULL_PLATE, (px, floor_y, pz), (px, 3.0, pz), 1.1)

    _build_maintenance_duct(canvas, D, roof_y)


def _hall_exterior_detail(canvas, segments, zn, zx, floor_y, ceil_y, wall_t):
    """Ribs, panel lines, pipe runs and radiator panels on the outside of each wall segment --
    all decorative, so a rib bump never has to be checked against a ring or a setpiece volume."""
    for seg_x0, seg_x1 in segments:
        rib_x = seg_x0 + 1.0
        toggle = False
        while rib_x < seg_x1 - 1.0:
            for sign, wall_z in ((-1, zn - wall_t), (1, zx + wall_t)):
                _box(canvas, HULL_DARK, (rib_x, (floor_y + ceil_y) / 2, wall_z + sign * 0.15),
                     (0.5, ceil_y - floor_y, 0.3), decorative=True)
            toggle = not toggle
            rib_x += 3.5

        # Panel-line grid: thin inset-look strips over the whole segment face.
        panel_y = floor_y + 6.0
        while panel_y < ceil_y - 2.0:
            for wall_z in (zn - wall_t - 0.05, zx + wall_t + 0.05):
                _box(canvas, HULL_DARK, ((seg_x0 + seg_x1) / 2, panel_y, wall_z),
                     (seg_x1 - seg_x0 - 1.0, 0.1, 0.04), decorative=True)
            panel_y += 8.0

        # Two pipe runs along the outside, plus a radiator panel per segment.
        for band_y in (floor_y + 4.0, ceil_y - 4.0):
            for wall_z in (zn - wall_t - 0.5, zx + wall_t + 0.5):
                _pipe(canvas, PIPE, (seg_x0, band_y, wall_z), (seg_x1, band_y, wall_z), 0.5,
                      sides=6, decorative=True)
        rad_x = (seg_x0 + seg_x1) / 2
        for wall_z, sign in ((zn - wall_t - 0.1, -1), (zx + wall_t + 0.1, 1)):
            _box(canvas, STEEL, (rad_x, wall_mid(floor_y, ceil_y), wall_z),
                 (min(4.0, seg_x1 - seg_x0 - 2.0), (ceil_y - floor_y) * 0.5, 0.15),
                 decorative=True)


def wall_mid(a, b):
    return (a + b) / 2


def _hall_interior_detail(canvas, segments, zn, zx, floor_y, ceil_y):
    """Blinking lights, interior lighting strips and floor markings -- interior, decorative."""
    for seg_x0, seg_x1 in segments:
        cursor = seg_x0 + 3.0
        toggle = False
        while cursor < seg_x1 - 3.0:
            material = GLOW_RED if toggle else GLOW_AMBER
            for wall_z in (zn + 0.4, zx - 0.4):
                _box(canvas, material, (cursor, ceil_y - 3.0, wall_z), (0.6, 0.3, 0.15),
                     decorative=True)
            toggle = not toggle
            cursor += 6.0

        # Ceiling-level lighting strips, running the length of the segment.
        for wall_z in (zn + 1.0, zx - 1.0):
            _box(canvas, GLOW_CYAN, ((seg_x0 + seg_x1) / 2, ceil_y - 0.3, wall_z),
                 (seg_x1 - seg_x0 - 1.0, 0.06, 0.3), decorative=True)

    # Floor markings: a centre-line stripe the length of the hall, dashed.
    dash_x = segments[0][0] + 2.0
    end_x = segments[-1][1] - 2.0
    toggle = False
    while dash_x < end_x:
        if not toggle:
            _box(canvas, HAZARD, (dash_x + 1.0, floor_y + 0.04, (zn + zx) / 2), (1.6, 0.05, 0.6),
                 decorative=True)
        toggle = not toggle
        dash_x += 4.0


def _hall_portals(canvas, x0, x1, zn, zx, floor_y, ceil_y):
    """Big hazard-striped portal frames at the entry and exit -- flush with the opening, so they
    never reach past x0/x1 or the roof-edge corridors that graze those ends."""
    for edge_x, direction in ((x0, 1.0), (x1, -1.0)):
        inset = edge_x + direction * 0.35
        # A ring: two side posts and a lintel, hugging the exact opening rectangle.
        for wall_z in (zn, zx):
            _box(canvas, HAZARD, (inset, (floor_y + ceil_y) / 2, wall_z), (0.5, ceil_y - floor_y,
                 0.15), decorative=True)
        _box(canvas, HAZARD, (inset, ceil_y - 0.3, (zn + zx) / 2), (0.5, 0.5, zx - zn),
             decorative=True)
        for stripe in range(3):
            sx = edge_x + direction * (1.4 + stripe * 1.2)
            _box(canvas, HAZARD, (sx, floor_y + 0.05, (zn + zx) / 2), (0.6, 0.06,
                 (zx - zn) * 0.6), decorative=True)


def _build_maintenance_duct(canvas, D, floor_y):
    """The rectangular tube on the hall's roof; both ends open, ribs and grates are decorative."""
    x0, x1 = D["x_entry"], D["x_exit"]
    zn, zx = D["z_min"], D["z_max"]
    ceil_y = D["ceiling_y"]
    wall_t = 1.5
    outer_zn, outer_zx = zn - wall_t, zx + wall_t

    for wall_z in (zn - wall_t / 2, zx + wall_t / 2):
        _box(canvas, HULL_PLATE, ((x0 + x1) / 2, (floor_y + ceil_y) / 2, wall_z),
             (x1 - x0, ceil_y - floor_y, wall_t))
    _box(canvas, HULL_PLATE, ((x0 + x1) / 2, ceil_y + 1.0, (outer_zn + outer_zx) / 2),
         (x1 - x0, 2.0, outer_zx - outer_zn))

    # Cross-ribs and grate windows, denser now, kept away from the two tight x edges.
    rib_x = x0 + 6.0
    toggle = False
    while rib_x < x1 - 6.0:
        for wall_z in (zn + 0.2, zx - 0.2):
            _box(canvas, TRUSS, (rib_x, (floor_y + ceil_y) / 2, wall_z),
                 (0.5, ceil_y - floor_y - 1.0, 0.3), decorative=True)
        material = WINDOW if toggle else GLOW_CYAN
        _box(canvas, material, (rib_x + 2.5, (floor_y + ceil_y) / 2, zn + 0.15),
             (2.0, (ceil_y - floor_y) * 0.4, 0.1), decorative=True)
        _box(canvas, material, (rib_x + 2.5, (floor_y + ceil_y) / 2, zx - 0.15),
             (2.0, (ceil_y - floor_y) * 0.4, 0.1), decorative=True)
        toggle = not toggle
        rib_x += 8.0

    # Rooftop pipe run along the duct's own outer wall.
    for wall_z in (outer_zn - 0.4, outer_zx + 0.4):
        _pipe(canvas, PIPE, (x0, ceil_y - 2.0, wall_z), (x1, ceil_y - 2.0, wall_z), 0.4, sides=6,
              decorative=True)


# --- 06: drydock tower ------------------------------------------------------------------------


def build_drydock_tower(canvas):
    """A segmented shaft around (x, z), built from stacked flanged modules; greebles stay
    decorative and low so the taper alone has to satisfy clearance.

    The route spirals up outside `greeble_radius` and finishes with CP14 hovering on the axis at
    `top_y + clear_radius_above_top`. The one tight spot is the final leg (CP13 -> CP14), a
    straight line that swings in close to the shaft near its own height -- the shaft tapers down
    to a thin cap by `top_y` specifically so that leg clears; a constant-radius shaft that high
    would not (checked by hand, then confirmed by the clearance checker). y 104..130 keeps that
    exact taper untouched. Below y=104, radius never exceeds 13 -- the same bound the corridor
    checks were proved against for a plain cylinder -- so the flange/collar alternation that gives
    the shaft its stacked-module silhouette stays inside an already-safe envelope and needs no
    re-derivation, only the checker run to confirm.
    """
    T = L.TOWER
    axis_x, axis_z = T["x"], T["z"]
    top_y = T["top_y"]

    _tower_shaft(canvas, axis_x, axis_z, top_y)
    _tower_greebles(canvas, axis_x, axis_z, top_y)


def _shaft_stack(canvas, material, axis_x, axis_z, points, sides=16):
    """Consecutive frustums through a (y, radius) polyline -- one mesh, many segments."""
    for (y0, r0), (y1, r1) in zip(points, points[1:]):
        if y1 - y0 < 1e-6:
            continue
        _frustum_y(canvas, material, (axis_x, (y0 + y1) / 2, axis_z), r0, r1, y1 - y0,
                   sides=sides)


def _tower_shaft(canvas, axis_x, axis_z, top_y):
    # Base: a flared skirt stepping down from the deck to the barrel radius -- unconditionally
    # safe, every ring/corridor on the route sits far outside this height and radius.
    points = [(3.0, 22.0), (7.0, 20.0), (9.5, 20.0), (13.0, 16.0), (15.0, 16.0), (18.0, 13.0),
              (20.0, 13.0)]

    # Barrel: seven flanged modules from y=20 to y=104 (the rotor band's own top), each a thin
    # flange ring at r=13 followed by a recessed collar at r=11.8 -- the envelope's maximum never
    # rises above the validated r=13, so clearance holds exactly as it did for the plain cylinder.
    y = 20.0
    for _module in range(7):
        points += [(y + 1.5, 13.0), (y + 2.5, 11.8), (y + 9.0, 11.8), (y + 10.0, 13.0),
                   (y + 12.0, 13.0)]
        y += 12.0

    _shaft_stack(canvas, HULL_PLATE, axis_x, axis_z, points)

    # y 104..130: the exact taper the CP13 -> CP14 approach was checked against -- left untouched.
    _frustum_y(canvas, HULL_PLATE, (axis_x, (104.0 + top_y) / 2, axis_z), 13.0, 2.0,
               top_y - 104.0, sides=16)


def _tower_greebles(canvas, axis_x, axis_z, top_y):
    """Decorative-only dressing: recessed window bands, service rails, radiator fins, docking
    arms with berthing clamps, cross-braced lattice outriggers, beacons and a summit antenna
    cluster.

    All `decorative=True` -- the clearance checker and the setpiece-overlap checker both skip
    `_nocol` meshes, so none of this needs to respect the ring/corridor numbers or the rotor's
    reserved volume by geometry, only by staying out of its way visually. The antenna cluster
    above `top_y` still splays outward past `clear_radius_above_top` on principle, matching what
    the layout comment says should be true there even though nothing enforces it automatically.
    Positions are index-derived (cos/sin of a running angle, or a modulo of the index), never
    `random`.
    """
    module_ys = [20.0 + module * 12.0 for module in range(7)]

    # Recessed window bands: flush with each module's recessed collar (r=11.8), so they read as
    # genuinely inset rather than just glued to a plain cylinder.
    for ys in module_ys:
        band_y = ys + 5.75
        _frustum_y(canvas, WINDOW, (axis_x, band_y, axis_z), 11.9, 11.9, 5.0, sides=16,
                   decorative=True)
        for index in range(10):
            angle = 2 * pi * index / 10
            pos = (axis_x + 11.95 * cos(angle), band_y, axis_z + 11.95 * sin(angle))
            _frustum_y(canvas, GLOW_CYAN, pos, 0.15, 0.15, 0.4, sides=5, decorative=True)

    # Vertical service rails, running most of the shaft's height just proud of the flanges.
    rail_count = 6
    for rail in range(rail_count):
        angle = 2 * pi * rail / rail_count + 0.2
        pos_top = (axis_x + 13.3 * cos(angle), 100.0, axis_z + 13.3 * sin(angle))
        pos_bot = (axis_x + 13.3 * cos(angle), 8.0, axis_z + 13.3 * sin(angle))
        _beam(canvas, TRUSS, pos_bot, pos_top, 0.3, decorative=True)

    # Radiator fins: flat panels low on the shaft, well clear of the tight upper approach even
    # though decorative detail is exempt -- keeps the silhouette sensible at a glance.
    for index in range(4):
        angle = 2 * pi * index / 4 + 0.5
        y = 22.0 + 10.0 * (index % 2)
        inner = (axis_x + 13.2 * cos(angle), y, axis_z + 13.2 * sin(angle))
        outer = (axis_x + 19.5 * cos(angle), y, axis_z + 19.5 * sin(angle))
        _box(canvas, STEEL, ((inner[0] + outer[0]) / 2, y, (inner[2] + outer[2]) / 2),
             (5.5, 4.0, 0.2), decorative=True)

    # Docking arms with berthing clamps.
    arm_count = 6
    for arm in range(arm_count):
        angle = 2 * pi * arm / arm_count
        y = 18.0 + 8.0 * (arm % 3)
        inner = (axis_x + 13.2 * cos(angle), y, axis_z + 13.2 * sin(angle))
        outer = (axis_x + 19.0 * cos(angle), y, axis_z + 19.0 * sin(angle))
        _beam(canvas, TRUSS, inner, outer, 1.0, decorative=True)
        _box(canvas, STEEL, outer, (1.6, 1.0, 1.6), decorative=True)
        glow = GLOW_RED if arm % 2 == 0 else GLOW_AMBER
        _frustum_y(canvas, glow, outer, 0.6, 0.2, 1.0, sides=8, decorative=True)

    # Cross-braced lattice outriggers between three module levels: exterior scaffolding rings.
    for ys in (module_ys[1], module_ys[3], module_ys[5]):
        _lattice_ring(canvas, axis_x, axis_z, ys, ys + 12.0, 13.0, 18.0)

    # Beacons scattered across the shaft height.
    beacon_count = 14
    for index in range(beacon_count):
        angle = 2 * pi * index / beacon_count + 0.3
        y = 8.0 + 92.0 * ((index * 37) % 100) / 100.0
        radius = 13.4 if 20.0 < y < 104.0 else 14.4
        pos = (axis_x + radius * cos(angle), y, axis_z + radius * sin(angle))
        glow = GLOW_CYAN if index % 2 == 0 else GLOW_RED
        _frustum_y(canvas, glow, pos, 0.35, 0.1, 0.7, sides=6, decorative=True)

    # Antenna cluster at the summit: splayed outward as it climbs past top_y, so even if it were
    # checked it would stay clear of the axis column CP14 hovers over.
    for index in range(5):
        angle = 2 * pi * index / 5 + 0.9
        base = (axis_x + 1.5 * cos(angle), top_y - 1.0, axis_z + 1.5 * sin(angle))
        tip = (axis_x + 13.0 * cos(angle), top_y + 4.0, axis_z + 13.0 * sin(angle))
        _beam(canvas, STEEL, base, tip, 0.35, decorative=True)
        _frustum_y(canvas, GLOW_RED, tip, 0.3, 0.05, 0.6, sides=6, decorative=True)


def _lattice_ring(canvas, axis_x, axis_z, y_low, y_high, inner_r, outer_r, posts=6):
    """A ring of standoff posts joined to the shaft and cross-braced to their neighbours --
    exterior scaffolding, always decorative."""
    for post in range(posts):
        angle = 2 * pi * post / posts
        outer_low = (axis_x + outer_r * cos(angle), y_low, axis_z + outer_r * sin(angle))
        outer_high = (axis_x + outer_r * cos(angle), y_high, axis_z + outer_r * sin(angle))
        inner_low = (axis_x + inner_r * cos(angle), y_low, axis_z + inner_r * sin(angle))
        inner_high = (axis_x + inner_r * cos(angle), y_high, axis_z + inner_r * sin(angle))
        _beam(canvas, TRUSS, outer_low, outer_high, 0.5, decorative=True)
        _beam(canvas, TRUSS, inner_low, outer_low, 0.4, decorative=True)
        _beam(canvas, TRUSS, inner_high, outer_high, 0.4, decorative=True)
        next_angle = 2 * pi * ((post + 1) % posts) / posts
        next_low = (axis_x + outer_r * cos(next_angle), y_low, axis_z + outer_r * sin(next_angle))
        next_high = (axis_x + outer_r * cos(next_angle), y_high,
                     axis_z + outer_r * sin(next_angle))
        _beam(canvas, TRUSS, outer_low, next_high, 0.3, decorative=True)
        _beam(canvas, TRUSS, next_low, outer_high, 0.3, decorative=True)


# --- 07: fuel canyon ---------------------------------------------------------------------------


def build_fuel_canyon(canvas):
    """A channel along x, floor and walls colliding, everything else (pipes, tanks, catwalks,
    bridges, the finish dock ring) decorative dressing.

    Both ends stay open (the west end feeds the finish dock further out at FINISH_DOCK.x, the east
    end is where CP16 sits, past x_max). The piston setpiece needs the same kind of gap the airlock
    doors need in the hall: no floor or wall in the piston's x-span from floor_y to wall_top_y, and
    nothing beyond the walls out to its own reach -- so every decorative run below (pipes, tanks,
    catwalks, bridges) stops at the same gaps too, even though only the collider is checked.
    """
    C, P = L.CANYON, L.PISTONS
    x0, x1 = C["x_min"], C["x_max"]
    zn, zx = C["z_min"], C["z_max"]
    floor_y, top_y = C["floor_y"], C["wall_top_y"]
    wall_t = 3.0

    gap_half = P["width_x"] / 2 + 1.5
    gaps = [(px - gap_half, px + gap_half) for px in sorted(P["x"])]
    segments = _segments(x0, x1, gaps)
    wall_mid_y = (floor_y + top_y) / 2
    wall_h = top_y - floor_y

    for seg_x0, seg_x1 in segments:
        seg_len = seg_x1 - seg_x0
        seg_mid = (seg_x0 + seg_x1) / 2
        _box(canvas, HULL_PLATE, (seg_mid, floor_y - 1.5, (zn + zx) / 2), (seg_len, 3.0, zx - zn))
        for wall_z in (zn - wall_t / 2, zx + wall_t / 2):
            _box(canvas, HULL_PLATE, (seg_mid, wall_mid_y, wall_z), (seg_len, wall_h, wall_t))

    _canyon_dressing(canvas, x0, x1, zn, zx, floor_y, top_y, segments, gaps)
    _finish_dock(canvas)


def _canyon_dressing(canvas, x0, x1, zn, zx, floor_y, top_y, segments, gaps):
    """Pipe bundles, stacked tanks with flanges and valves, catwalks and overhead bridges -- all
    decorative, so the open-top clearance requirement is free: nothing here can ever block a
    corridor. Every run still stops at the piston gaps (rather than crossing them) even though the
    clearance checker would not catch an overrun -- the gap is reserved space for the ram
    housings the piston setpiece slides out to the side, not just a hole in the collider.
    """
    outer_zn, outer_zx = zn - 3.0, zx + 3.0

    pipe_y = floor_y + 6.0
    for seg_x0, seg_x1 in segments:
        for band in range(3):
            y = pipe_y + band * 12.0
            for wall_z in (outer_zn - 0.6, outer_zx + 0.6):
                _pipe(canvas, PIPE, (seg_x0, y, wall_z), (seg_x1, y, wall_z), 1.1, sides=8,
                      decorative=True)
        # A catwalk along the wall top, with a rail on the outer edge.
        for wall_z in (outer_zn - 0.6, outer_zx + 0.6):
            _box(canvas, TRUSS, ((seg_x0 + seg_x1) / 2, top_y + 0.3, wall_z),
                 (seg_x1 - seg_x0, 0.15, 1.6), decorative=True)
            _beam(canvas, TRUSS, (seg_x0, top_y + 1.1, wall_z), (seg_x1, top_y + 1.1, wall_z),
                  0.15, decorative=True)

    tank_x = x0 + 6.0
    toggle = False
    while tank_x < x1 - 6.0:
        if not _in_any(tank_x, gaps, 2.0):
            wall_z = outer_zn - 3.5 if toggle else outer_zx + 3.5
            tank_center = (tank_x, floor_y + 4.0, wall_z)
            _frustum_y(canvas, HULL_DARK, tank_center, 2.6, 2.6, 8.0, sides=10, decorative=True)
            for flange_y in (floor_y + 0.3, floor_y + 7.7):
                _frustum_y(canvas, STEEL, (tank_x, flange_y, wall_z), 3.0, 3.0, 0.4, sides=10,
                           decorative=True)
            valve_dir = -1.0 if toggle else 1.0
            valve = (tank_x, floor_y + 4.0, wall_z + valve_dir * 3.2)
            _frustum_y(canvas, STEEL, valve, 0.6, 0.6, 1.2, sides=8, decorative=True)
            _frustum_y(canvas, GLOW_AMBER, (tank_x, floor_y + 6.5, wall_z), 0.35, 0.15, 0.3,
                       sides=6, decorative=True)
            toggle = not toggle
        tank_x += 9.0

    bridge_x = x0 + 10.0
    toggle = False
    while bridge_x < x1 - 10.0:
        if not _in_any(bridge_x, gaps, 2.0):
            by = top_y + (2.5 if toggle else 1.0)
            _beam(canvas, STEEL, (bridge_x, by, zn), (bridge_x, by, zx), 0.8, decorative=True)
            for gz in (zn + 6.0, (zn + zx) / 2, zx - 6.0):
                _pipe(canvas, PIPE, (bridge_x, by, gz), (bridge_x, by - 1.2, gz), 0.2, sides=6,
                      decorative=True)
            toggle = not toggle
        bridge_x += 12.0

    for gx, gy in gaps:
        px = (gx + gy) / 2
        for wall_z in (zn - 0.2, zx + 0.2):
            _box(canvas, HAZARD, (px, floor_y + 0.05, wall_z), (3.0, 0.06, 1.5), decorative=True)


def _finish_dock(canvas):
    """The docking collar around the finish ring: a denser spoke ring, an outer support frame,
    light rings and clamps -- purely decorative."""
    F = L.FINISH_DOCK
    center = (F["x"], F["y"], F["z"])
    radius = F["inner_radius"]

    spokes = 20
    for index in range(spokes):
        angle = 2 * pi * index / spokes
        y = center[1] + radius * sin(angle)
        z = center[2] + radius * cos(angle)
        pos = (center[0], y, z)
        material = GLOW_CYAN if index % 4 else HAZARD
        _frustum_y(canvas, material, pos, 0.4, 0.4, 1.4, sides=6, decorative=True)
        outer = (center[0], center[1] + (radius + 3.0) * sin(angle),
                 center[2] + (radius + 3.0) * cos(angle))
        _beam(canvas, STEEL, pos, outer, 0.3, decorative=True)

    # Outer support ring, tying the spoke tips together.
    ring_points = 20
    for index in range(ring_points):
        a0 = 2 * pi * index / ring_points
        a1 = 2 * pi * (index + 1) / ring_points
        r = radius + 3.0
        p0 = (center[0], center[1] + r * sin(a0), center[2] + r * cos(a0))
        p1 = (center[0], center[1] + r * sin(a1), center[2] + r * cos(a1))
        _beam(canvas, STEEL, p0, p1, 0.25, decorative=True)

    for clamp in range(4):
        angle = pi / 4 + clamp * pi / 2
        y = center[1] + (radius + 1.5) * sin(angle)
        z = center[2] + (radius + 1.5) * cos(angle)
        _beam(canvas, STEEL, (center[0] - 1.0, y, z), (center[0] + 1.0, y, z), 1.0,
              decorative=True)
        _frustum_y(canvas, GLOW_AMBER, (center[0], y, z), 0.4, 0.15, 0.4, sides=6,
                   decorative=True)
