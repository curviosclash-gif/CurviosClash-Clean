"""Orbital Shipyard: launch bay, scaffold yard, hull spine and backdrop (static architecture).

Everything here is authored in the shared map frame from orbital_shipyard_layout.py (x east, y up,
z south) and only converted to Blender coordinates at the last step, with L.bl(x, y, z). Two small
helpers do that conversion so the builders below never juggle the axis swap themselves:

- map_box() places an axis-aligned box (no rotation) given a map-space centre and size. Since
  L.bl only permutes and negates axes, a box aligned with the map axes stays axis-aligned in
  Blender space -- its Y and Z sizes simply trade places.
- map_beam() places a straight member between two map-space points, for the few shapes that are
  not axis-aligned (scaffold bracing, the hull's circular ribs).

The one place that needs an arbitrary rotation is the hull's tangential plating: a plate sits at
some angle around the ship's circular cross-section, which is a rotation about the map z axis.
Because z maps onto Blender Y, that is exactly the rotation Canvas.box's Euler (0, angle, 0)
already expresses, so map_box's `rotation` argument (used by _hull_bay_plating below) covers it
with a plain box() call and some trigonometry -- no custom transform code required.
"""

from math import cos, pi, sin

import generate_eiffel_tower_assets as et
import orbital_shipyard_layout as L


def map_box(canvas, material, center, size, decorative=False, rotation=0.0):
    """An axis-aligned box authored in map coordinates (x, y, z).

    `rotation` (radians) turns the box about the map z axis before placing it -- used only by the
    hull's tangential plates, where L.bl carries that rotation straight over to Blender's Y axis.
    """
    cx, cy, cz = center
    sx, sy, sz = size
    canvas.box(material, L.bl(cx, cy, cz), (sx, sz, sy), decorative=decorative,
               rotation=(0.0, -rotation, 0.0))


def map_beam(canvas, material, start, end, thickness, width=None, decorative=False):
    """A straight member between two map-space points."""
    canvas.beam(material, L.bl(*start), L.bl(*end), thickness, width=width, decorative=decorative)


# --- 02_launch_bay ------------------------------------------------------------------------------


def build_launch_bay(canvas):
    """An enclosed hangar tube, closed at x_back and open at x_mouth.

    Spawn (-150, 40, 110) and CP01 (-132, 40, 110) sit on the tube's centreline, well inside the
    inner_half_width=12 / floor..ceiling=30..50 box, so the shell and ribs only have to stay
    outside that box to leave them clear.
    """
    lb = L.LAUNCH_BAY
    x_back, x_mouth, z = lb["x_back"], lb["x_mouth"], lb["z"]
    half_w = lb["inner_half_width"]
    floor_y, ceiling_y = lb["floor_y"], lb["ceiling_y"]
    wall = 1.4
    outer_half_w = half_w + wall
    inner_h = ceiling_y - floor_y
    # The shell stops 8 units short of x_mouth: the CP01->CP02 corridor clips the tube's
    # south-east corner right as it exits, and a wall running flush to the mouth puts that sharp
    # edge only ~4.7 units from the corridor line (checked with the clearance checker) against the
    # ~7 it needs. Stopping the shell early leaves the last stretch open, like a flared hangar lip,
    # which is also the more natural read for a mouth anyway.
    shell_end_x = x_mouth - 8.0
    length = shell_end_x - x_back
    mid_x = (x_back + shell_end_x) / 2.0

    # Shell: floor, ceiling, and two side walls, each split into segments with a hairline gap so
    # the surface reads as bolted panels instead of one slab, plus a closed back wall at x_back.
    _paneled_wall(canvas, mid_x, length, floor_y - wall / 2, z, wall, 2 * outer_half_w)
    _paneled_wall(canvas, mid_x, length, ceiling_y + wall / 2, z, wall, 2 * outer_half_w)
    _paneled_wall(canvas, mid_x, length, (floor_y + ceiling_y) / 2, z - outer_half_w + wall / 2,
                   inner_h, wall)
    _paneled_wall(canvas, mid_x, length, (floor_y + ceiling_y) / 2, z + outer_half_w - wall / 2,
                   inner_h, wall)
    map_box(canvas, L.HULL_DARK, (x_back, (floor_y + ceiling_y) / 2, z),
            (wall, inner_h + 2 * wall, 2 * outer_half_w))

    # Structural ribs: closed rectangular frames standing proud of the outer wall, spaced along
    # the tube. The last one stops well short of the mouth so it never crosses the CP01->CP02
    # corridor, which clips the tube's south-east corner on its way out. A thinner decorative
    # frame just inside the same wall gives the interior a ribbed read too, without touching the
    # flight box (inset from the flyable centreline, not the collision).
    rib_x = x_back + 8.0
    while rib_x < x_mouth - 10.0:
        _launch_bay_rib(canvas, rib_x, z, half_w, floor_y, ceiling_y)
        rib_x += 15.0
    frame_x = x_back + 6.0
    while frame_x < shell_end_x - 3.0:
        _launch_bay_interior_frame(canvas, frame_x, z, half_w, floor_y, ceiling_y)
        frame_x += 8.0

    # Ceiling gantry rails: two long rails just under the ceiling, running the shell's length --
    # far above the y=40 centreline the corridor holds, so the extra collision costs no margin.
    for side in (-1, 1):
        map_box(canvas, L.HULL_DARK, (mid_x, ceiling_y - 0.4, z + side * half_w * 0.5),
                (length, 0.35, 0.6))

    # Launch catapult rails on the floor, straddling the centreline without touching it -- the
    # corridor line itself sits far above at y=40, so the floor is free regardless.
    for side in (-1, 1):
        map_box(canvas, L.PIPE, (mid_x, floor_y + 0.22, z + side * 3.0), (length - 2.0, 0.4, 0.9))

    # Side galleries: a row of glowing control-room windows down each wall.
    gallery_x = x_back + 10.0
    while gallery_x < shell_end_x - 4.0:
        for side in (-1, 1):
            map_box(canvas, L.WINDOW, (gallery_x, ceiling_y - 5.0, z + side * (outer_half_w - wall / 2)),
                    (2.4, 2.2, 0.3), decorative=True)
        gallery_x += 9.0

    # Exterior greebles: radiator fins along the top and small equipment boxes along the sides.
    fin_x = x_back + 6.0
    while fin_x < shell_end_x - 3.0:
        map_box(canvas, L.HULL_DARK, (fin_x, ceiling_y + wall + 0.8, z), (0.3, 1.4, 2 * half_w * 0.7))
        fin_x += 3.0
    box_x = x_back + 10.0
    while box_x < shell_end_x - 6.0:
        for side in (-1, 1):
            map_box(canvas, L.HULL_DARK,
                    (box_x, (floor_y + ceiling_y) / 2 - 6.0, z + side * (outer_half_w + 0.6)),
                    (2.0, 2.6, 0.9))
        box_x += 11.0

    # Mouth frame: a bigger glowing cyan portal right at the open end, with hazard chevrons
    # around the whole rim rather than just the floor.
    strip = 1.0
    map_box(canvas, L.GLOW_CYAN, (x_mouth - strip / 2, ceiling_y, z), (strip, 0.5, 2 * outer_half_w),
            decorative=True)
    map_box(canvas, L.GLOW_CYAN, (x_mouth - strip / 2, floor_y, z), (strip, 0.5, 2 * outer_half_w),
            decorative=True)
    for side in (-1, 1):
        map_box(canvas, L.GLOW_CYAN,
                (x_mouth - strip / 2, (floor_y + ceiling_y) / 2, z + side * half_w),
                (strip, inner_h, 0.5), decorative=True)
    for i in range(5):
        stripe_x = x_mouth - 3.0 - i * 2.2
        offset = 1.1 if i % 2 else 0.0
        map_box(canvas, L.HAZARD, (stripe_x, floor_y + 0.03, z - half_w + 1.5 + offset),
                (0.9, 0.06, 2.2), decorative=True)
        map_box(canvas, L.HAZARD, (stripe_x, ceiling_y - 0.03, z + half_w - 1.5 - offset),
                (0.9, 0.06, 2.2), decorative=True)

    # Runway lights: two rows of amber studs down the floor toward the mouth.
    light_x = x_back + 14.0
    while light_x < x_mouth - 6.0:
        for side in (-1, 1):
            map_box(canvas, L.GLOW_AMBER,
                    (light_x, floor_y + 0.08, z + side * (half_w - 1.5)),
                    (0.7, 0.16, 0.5), decorative=True)
        light_x += 7.0

    # A couple of support pylons down to the station deck, well clear of the spawn/CP01
    # centreline and of the CP01->CP02 corridor as it clips the mouth (checked numerically).
    for px in (x_back + 10.0, x_mouth - 8.0):
        for pz in (z - outer_half_w - 1.5, z + outer_half_w + 1.5):
            map_box(canvas, L.HULL_DARK, (px, (floor_y + L.STATION_DECK["y_top"]) / 2, pz),
                    (2.0, floor_y - L.STATION_DECK["y_top"], 2.0))


def _paneled_wall(canvas, mid_x, length, y, z, size_a, size_b):
    """A flat wall/floor/ceiling slab split into a handful of segments with hairline gaps.

    `size_a`/`size_b` are the box's own (thickness-ish, width-ish) sizes in the two dimensions
    that are not split; the segments only divide the tube-length dimension, so panel seams line
    up with roughly the rib spacing instead of looking arbitrary.
    """
    segments = 4
    gap = 0.12
    seg_length = length / segments - gap
    for i in range(segments):
        seg_x = mid_x - length / 2 + seg_length / 2 + gap / 2 + i * (seg_length + gap)
        map_box(canvas, L.DECK, (seg_x, y, z), (seg_length, size_a, size_b))


def _launch_bay_rib(canvas, x, z, half_w, floor_y, ceiling_y):
    """One rectangular fuselage frame, proud of the tube's outer wall."""
    material = L.HULL_DARK
    thickness = 1.1
    ow = half_w + 1.4 + 0.4
    top = ceiling_y + 1.4 + 0.4
    bottom = floor_y - 1.4 - 0.4
    map_box(canvas, material, (x, top, z), (thickness, thickness, 2 * ow))
    map_box(canvas, material, (x, bottom, z), (thickness, thickness, 2 * ow))
    map_box(canvas, material, (x, (top + bottom) / 2, z - ow), (thickness, top - bottom, thickness))
    map_box(canvas, material, (x, (top + bottom) / 2, z + ow), (thickness, top - bottom, thickness))


def _launch_bay_interior_frame(canvas, x, z, half_w, floor_y, ceiling_y):
    """A thin decorative frame just inside the wall, so the tube reads as ribbed from inside too.

    Decorative rather than collidable: it sits close to the inner_half_width=12 / floor..ceiling
    box that spawn, CP01 and the CP01->CP02 corridor all need clear, and there is no visual need
    for it to be solid -- the exterior ribs above already carry the actual collision.
    """
    thickness = 0.45
    inset = half_w - 0.5
    top, bottom = ceiling_y - 0.5, floor_y + 0.5
    map_box(canvas, L.HULL_DARK, (x, top, z), (thickness, thickness, 2 * inset), decorative=True)
    map_box(canvas, L.HULL_DARK, (x, bottom, z), (thickness, thickness, 2 * inset), decorative=True)
    map_box(canvas, L.HULL_DARK, (x, (top + bottom) / 2, z - inset), (thickness, top - bottom, thickness),
            decorative=True)
    map_box(canvas, L.HULL_DARK, (x, (top + bottom) / 2, z + inset), (thickness, top - bottom, thickness),
            decorative=True)


# --- 03_scaffold_yard ----------------------------------------------------------------------------


def build_scaffold_yard(canvas):
    """A construction yard the route weaves through: towers, decks, bridges and two hull modules.

    Positions are picked and margin-checked against L.corridors()/L.all_checkpoints() up front
    (see the layout's clearance numbers and the pick_positions.py numbers this was built from),
    not by eye, because "weave between towers" only works if nothing is close enough to read as a
    wall across the route. Two walkway bridges deliberately cross close over/under CP01->CP02 and
    CP03->CP04 (margins ~3-7 over the required clearance, not the 15-40 the plain towers keep) so
    the route reads as threading through the yard rather than just past it.

    The crane setpiece (built elsewhere) owns a radius-5 column around its mast from the deck up
    to mast_top_y, the whole radius-(jib_length+5)=55 disc in the jib's height band
    [jib_y-8, mast_top_y+2]=[64, 82], and -- since its hanging load now swings low enough to clip a
    y=55 tower top -- everything within radius 45 of the mast additionally stays at or below y=55.
    Towers within radius 45 are kept at or under that; the two tall corner towers and the bow
    module stand outside radius 55 (or top out low enough to not matter) so their height is free.
    """
    # (x, z, top_y, deck_every): tower base, height, and how often (in bays) to drop a small
    # platform. The two 88-90 unit towers sit in the yard's far corners, outside the crane's
    # radius-55 jib disc, so they run the full height freely; the rest stay <=55 within radius 45
    # of the mast (checked per tower below) and <64 within the wider radius-55 band.
    towers = (
        (-100.0, 60.0, 42.0, 0),
        (-100.0, 130.0, 50.0, 3),
        (-85.0, 45.0, 38.0, 0),
        (-90.0, 115.0, 53.0, 3),
        (-45.0, 100.0, 48.0, 3),
        (-20.0, 110.0, 36.0, 0),
        (-30.0, 130.0, 52.0, 3),
        (-108.0, 42.0, 90.0, 2),
        (-12.0, 40.0, 88.0, 2),
    )
    for cx, cz, top_y, deck_every in towers:
        _scaffold_tower(canvas, cx, cz, top_y, deck_every=deck_every)

    # Cross-bracing that visibly links nearby towers into one yard, at a couple of different
    # levels. Decorative: the two collidable bridges below are what the route actually has to
    # thread between, these are the "read as connected" dressing.
    for (ax, az, ah), (bx, bz, bh) in (
        ((-100.0, 60.0, 30.0), (-85.0, 45.0, 26.0)),
        ((-100.0, 60.0, 16.0), (-85.0, 45.0, 14.0)),
        ((-30.0, 130.0, 34.0), (-20.0, 110.0, 24.0)),
        ((-100.0, 130.0, 32.0), (-90.0, 115.0, 34.0)),
        ((-45.0, 100.0, 30.0), (-30.0, 130.0, 30.0)),
    ):
        map_beam(canvas, L.TRUSS, (ax, ah, az), (bx, bh, bz), 0.4, decorative=True)

    # Two collidable walkway structures the route actually crosses close to.
    #
    # CP01->CP02 descends through y=30-40 across its whole span, so any full-height pier planted
    # near its path fails clearance somewhere along that span (checked point by point with a
    # continuous y scan, not just a few samples -- the first attempt here looked fine at three
    # sample heights and still failed the real checker). Both piers instead stand south of the
    # corridor's path at z=84, clear by 4.7-11 units over the full column; only the thin deck slab
    # reaches north to actually overhang above the corridor, with 2.4 units to spare.
    _bridge_pier(canvas, -117.0, 84.0, 46.0)
    _bridge_pier(canvas, -106.0, 84.0, 46.0)
    _cantilever_deck(canvas, -118.0, -105.0, 84.0, 103.0, 46.3)

    # CP03->CP04 stays up at y=45-58 the whole way, well above where these piers top out (37-38),
    # so a symmetric bridge directly under it is clear by construction (checked).
    _bridge_pier(canvas, -55.0, 66.0, 38.0)
    _bridge_pier(canvas, -45.0, 59.0, 37.0)
    _bridge(canvas, -55.0, 66.0, -45.0, 59.0, 37.5, width=3.2)

    # None of the towers, bridges or modules sit within L.CRANE's radius-5 mast column; the
    # column itself is only drawn by the crane setpiece.
    _scaffold_module(canvas, -55.0, 58.0)
    _scaffold_module_bow(canvas, -25.0, 95.0)

    _pallet_stack(canvas, -80.0, 45.0)
    _pallet_stack(canvas, -14.0, 44.0)

    # Cable/pipe bundles slung between towers -- a light sag drawn as two straight segments so it
    # reads as hanging rather than a taut rod, decorative so it never affects clearance.
    for (ax, az, ah), (bx, bz, bh) in (
        ((-100.0, 60.0, 40.0), (-85.0, 45.0, 36.0)),
        ((-30.0, 130.0, 48.0), (-20.0, 110.0, 34.0)),
        ((-100.0, 130.0, 46.0), (-90.0, 115.0, 51.0)),
    ):
        mx, mz = (ax + bx) / 2.0, (az + bz) / 2.0
        sag = min(ah, bh) - 2.5
        map_beam(canvas, L.PIPE, (ax, ah, az), (mx, sag, mz), 0.3, decorative=True)
        map_beam(canvas, L.PIPE, (mx, sag, mz), (bx, bh, bz), 0.3, decorative=True)


def _scaffold_tower(canvas, cx, cz, top_y, half_width=2.2, bay_height=7.0, deck_every=0):
    """A TRUSS lattice tower: four straight legs plus X-braced bays, like a scaled-down pylon.

    The legs are drawn as single axis-aligned boxes rather than per-bay beams -- they never bend,
    so one box per leg is both cheaper and immune to the beam-orientation questions a purely
    vertical beam raises. Only the diagonals, which move in two axes at once, use beam(). Deck
    platforms get a low railing so they read as somewhere to stand, not just a shelf.
    """
    thickness = 0.55
    mid_y = (3.0 + top_y) / 2.0
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        map_box(canvas, L.TRUSS, (cx + sx * half_width, mid_y, cz + sz * half_width),
                (thickness, top_y - 3.0, thickness))

    bays = max(2, round((top_y - 3.0) / bay_height))
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    for bay in range(bays):
        y0 = 3.0 + (top_y - 3.0) * bay / bays
        y1 = 3.0 + (top_y - 3.0) * (bay + 1) / bays
        pts0 = [(cx + sx * half_width, y0, cz + sz * half_width) for sx, sz in corners]
        pts1 = [(cx + sx * half_width, y1, cz + sz * half_width) for sx, sz in corners]
        for i in range(4):
            j = (i + 1) % 4
            map_beam(canvas, L.TRUSS, pts0[i], pts1[j], thickness * 0.85)
            map_beam(canvas, L.TRUSS, pts0[j], pts1[i], thickness * 0.85)
        if deck_every and (bay + 1) % deck_every == 0 and bay + 1 < bays:
            deck_half = half_width * 1.2
            map_box(canvas, L.DECK, (cx, y1, cz), (deck_half * 2, 0.35, deck_half * 2))
            rail_h = 1.0
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                map_box(canvas, L.TRUSS, (cx + sx * deck_half, y1 + rail_h / 2, cz + sz * deck_half),
                        (0.15, rail_h, 0.15))

    map_box(canvas, L.GLOW_AMBER, (cx, top_y + 0.4, cz), (0.6, 0.5, 0.6), decorative=True)


def _bridge_pier(canvas, cx, cz, top_y, thickness=1.8):
    """A single slim support column for a walkway bridge (not a full 4-legged tower).

    The bridges below cross close enough to a corridor that a full tower footprint would violate
    its clearance (checked with pick_positions.py); a lone column stays inside it with margin.
    """
    map_box(canvas, L.TRUSS, (cx, (3.0 + top_y) / 2.0, cz), (thickness, top_y - 3.0, thickness))
    map_box(canvas, L.GLOW_AMBER, (cx, top_y + 0.3, cz), (0.5, 0.4, 0.5), decorative=True)


def _bridge(canvas, x0, z0, x1, z1, y, width=3.0, thickness=0.6):
    """An axis-aligned walkway deck between two piers, with a railing on both long edges."""
    cx, cz = (x0 + x1) / 2.0, (z0 + z1) / 2.0
    along_x = abs(x1 - x0) >= abs(z1 - z0)
    span = max(abs(x1 - x0), abs(z1 - z0)) + width * 0.6
    size = (span, thickness, width) if along_x else (width, thickness, span)
    map_box(canvas, L.DECK, (cx, y, cz), size)
    rail_h = 1.1
    offset = width / 2.0 - 0.12
    for sign in (-1, 1):
        if along_x:
            map_box(canvas, L.TRUSS, (cx, y + rail_h / 2.0, cz + sign * offset), (span, rail_h, 0.18))
        else:
            map_box(canvas, L.TRUSS, (cx + sign * offset, y + rail_h / 2.0, cz), (0.18, rail_h, span))


def _cantilever_deck(canvas, x0, x1, z0, z1, y, thickness=0.6):
    """A rectangular deck slab whose supporting piers sit only along its near (z0) edge.

    Unlike _bridge, the two ends are not required to be piers themselves -- this is for a deck
    that overhangs past where it is safe to plant a column, with a railing on the far edge where
    someone standing on it would otherwise walk off into open air above the corridor below.
    """
    cx, cz = (x0 + x1) / 2.0, (z0 + z1) / 2.0
    map_box(canvas, L.DECK, (cx, y, cz), (x1 - x0, thickness, z1 - z0))
    rail_h = 1.1
    map_box(canvas, L.TRUSS, (cx, y + rail_h / 2.0, z1 - 0.15), (x1 - x0, rail_h, 0.18))
    for sx in (x0, x1):
        map_box(canvas, L.TRUSS, (sx, y + rail_h / 2.0, cz), (0.18, rail_h, z1 - z0))


def _pallet_stack(canvas, cx, cz):
    """A short stack of hull-plate pallets sitting on the deck -- yard clutter, not a route hazard."""
    plate_h = 0.4
    for i in range(4):
        y = 3.0 + plate_h / 2.0 + i * (plate_h + 0.15)
        offset = 0.15 if i % 2 else 0.0
        map_box(canvas, L.HULL_PLATE, (cx + offset, y, cz), (3.6, plate_h, 2.6))
    map_box(canvas, L.GLOW_AMBER, (cx, 3.0 + 4 * (plate_h + 0.15) + 0.3, cz), (0.4, 0.3, 0.4),
            decorative=True)


def _scaffold_module(canvas, cx, cz):
    """A half-plated ship module resting on two cradle legs -- the yard's centrepiece.

    Its footprint (radius ~5 including the cradles) around (-55, 58) keeps the required margin
    from CP04's corridors on every side (checked numerically) and sits well outside the crane's
    jib disc regardless of height, since the whole module tops out under y=20.
    """
    cradle_h = 3.0
    body_y0 = cradle_h
    body_y1 = body_y0 + 9.0
    body_x, body_z = 16.0, 11.0

    for sx in (-1, 1):
        map_box(canvas, L.TRUSS, (cx + sx * (body_x / 2 - 1.5), cradle_h / 2, cz),
                (2.0, cradle_h, body_z + 1.5))

    # Plated two-thirds, open framework at the bow end (-x side) where the ship is still being
    # built -- the big visual tell that this module is unfinished.
    plated_x = body_x * 0.62
    map_box(canvas, L.HULL_PLATE, (cx + (body_x - plated_x) / 2, (body_y0 + body_y1) / 2, cz),
            (plated_x, body_y1 - body_y0, body_z))
    frame_x = body_x - plated_x
    frame_cx = cx - body_x / 2 + frame_x / 2
    thickness = 0.6
    for sy in (body_y0, body_y1):
        map_box(canvas, L.HULL_DARK, (frame_cx, sy, cz), (frame_x, thickness, body_z))
    for sz in (-1, 1):
        map_box(canvas, L.HULL_DARK, (frame_cx, (body_y0 + body_y1) / 2, cz + sz * body_z / 2),
                (frame_x, body_y1 - body_y0, thickness))
    map_box(canvas, L.HULL_DARK, (cx - body_x / 2 + 0.3, (body_y0 + body_y1) / 2, cz),
            (0.6, body_y1 - body_y0, body_z))

    map_box(canvas, L.HAZARD, (cx, cradle_h + 0.02, cz - body_z / 2 - 0.4), (body_x * 0.5, 0.05, 0.5),
            decorative=True)


def _scaffold_module_bow(canvas, cx, cz):
    """A second, smaller module: a bow section tapering along z, so it reads differently from the
    boxy hull block at (-55, 58) rather than looking like a copy of it.

    Three shrinking segments along z stand in for a nose cone without a rotated frustum -- the
    rotation math for an axis-along-z cylinder is one more thing to get wrong under time pressure,
    and three boxes read as "tapered" just as well at flying speed.
    """
    cradle_h = 3.0
    body_y0, body_y1 = cradle_h, cradle_h + 7.0
    mid_y = (body_y0 + body_y1) / 2.0
    height = body_y1 - body_y0

    for sx in (-1, 1):
        map_box(canvas, L.TRUSS, (cx + sx * 3.2, cradle_h / 2, cz), (1.8, cradle_h, 12.0))

    map_box(canvas, L.HULL_PLATE, (cx, mid_y, cz - 5.0), (9.0, height, 6.0))
    map_box(canvas, L.HULL_PLATE, (cx, mid_y, cz - 0.5), (6.5, height * 0.8, 3.0))
    map_box(canvas, L.HULL_DARK, (cx, mid_y, cz + 2.5), (3.5, height * 0.55, 3.0))
    map_box(canvas, L.GLOW_AMBER, (cx, body_y1 + 0.4, cz - 5.0), (0.6, 0.5, 0.6), decorative=True)


# --- 04_hull_spine --------------------------------------------------------------------------------

_HULL_RIB_SEGMENTS = 36
_HULL_PLATE_SLOTS = 16


def build_hull_spine(canvas):
    """The half-built capital ship: a rib cage the player flies straight through.

    Ribs are full circles at rib_radius (30) around the ship's axis -- nothing here needs a floor,
    only an opening to cross. Plating covers the lower flanks solidly and only a scattered third
    of the upper half, which is what leaves the "big window gaps" the brief asks for: the gaps are
    simply where no plate was drawn, not a separate glazed object.

    The welding gantry (built elsewhere) needs every point with z in [z_stern+5, z_bow-12] to stay
    at least 28.5 from the axis. Every member below sits centred on rib_radius=30 with at most
    +-0.7 of half-thickness, so the closest any of them comes is about 29.2 -- checked per-shape in
    the comments below, not just asserted.
    """
    h = L.HULL
    axis_x, axis_y = h["axis_x"], h["axis_y"]
    z_stern, z_bow = h["z_stern"], h["z_bow"]
    radius = h["rib_radius"]
    spacing = h["rib_spacing"]

    # z_bow (60) and z_stern (-100) both sit outside the welding gantry's exclusion range
    # (z_stern+5 .. z_bow-12 = -95 .. 48), so the last two ribs are free to taper the bow inward.
    # That taper also fixes a real clash: at the full 30 radius the bow rib's left side (x=0)
    # sits only ~6.3 from the CP04->CP05 corridor as it lines up on the opening, short of the 7
    # it needs (checked with the clearance checker); tapering to 22 pulls it clear.
    rib_zs = []
    z = z_stern
    while z <= z_bow - spacing:
        rib_zs.append(z)
        z += spacing
    rib_zs.append(z_bow - spacing / 2.0)  # neck rib, tapering
    rib_zs.append(z_bow)  # bow opening frame, ringed with marker lights
    bow_start_index = len(rib_zs) - 2
    rib_radii = [radius] * bow_start_index + [26.0, 22.0]

    for index, (z_map, r) in enumerate(zip(rib_zs, rib_radii)):
        material = L.HULL_DARK if index % 2 == 0 else L.HULL_PLATE
        _hull_rib(canvas, material, axis_x, axis_y, z_map, r)

    # Keel (bottom) and dorsal spine (top): straight, axis-aligned in map space, centred on the
    # main hull radius, running the full length -- they read as what the regular ribs bolt to and
    # simply disappear under the tapered nose the last two ribs describe.
    length = z_bow - z_stern
    mid_z = (z_stern + z_bow) / 2.0
    map_box(canvas, L.HULL_DARK, (axis_x, axis_y - radius, mid_z), (1.6, 1.6, length))
    map_box(canvas, L.HULL_DARK, (axis_x, axis_y + radius, mid_z), (1.4, 1.4, length))

    # Plating between the regular ribs; the tapering neck/bow bays stay open framework, which
    # reads as the ship's unfinished nose rather than needing per-bay radius bookkeeping.
    for bay in range(bow_start_index):
        _hull_bay_plating(canvas, axis_x, axis_y, radius, rib_zs[bay], rib_zs[bay + 1], bay)

    # Bow marker lights, ringed around the tapered opening.
    bow_radius = rib_radii[-1]
    for i in range(12):
        theta = 2 * pi * i / 12
        px = axis_x + bow_radius * cos(theta)
        py = axis_y + bow_radius * sin(theta)
        canvas.box(L.GLOW_RED, L.bl(px, py, z_bow + 0.3), (0.7, 0.7, 0.5), decorative=True)

    # Docking clamps: two pylons straight down to the station deck, at z positions checked clear
    # of every CP05..CP08 corridor segment by several units.
    deck_y = L.STATION_DECK["y_top"]
    hull_bottom_y = axis_y - radius
    for pz in (-70.0, 45.0):
        map_box(canvas, L.HULL_DARK, (axis_x, (deck_y + hull_bottom_y) / 2, pz),
                (2.2, hull_bottom_y - deck_y, 2.2))

    # Flank maintenance rails, outside the ribs (radius+1.8): a straight bar at a fixed (x, y)
    # offset from the axis needs no rotation, same as the keel/spine, and sitting further out than
    # the ribs only widens the welding gantry's own margin. Work lights sit under alternating
    # ribs, clear of the plating above.
    flank_radius = radius + 1.8
    flank_end_z = rib_zs[bow_start_index - 1]
    for angle_deg in (55.0, 235.0):
        theta = angle_deg * pi / 180.0
        rx = axis_x + flank_radius * cos(theta)
        ry = axis_y + flank_radius * sin(theta)
        map_box(canvas, L.TRUSS, (rx, ry, (z_stern + flank_end_z) / 2.0),
                (0.8, 0.8, flank_end_z - z_stern))
    for index in range(0, bow_start_index, 2):
        lx = axis_x
        ly = axis_y - radius - 0.6
        canvas.box(L.GLOW_AMBER, L.bl(lx, ly, rib_zs[index]), (0.6, 0.6, 0.5), decorative=True)


def _hull_rib(canvas, material, axis_x, axis_y, z_map, radius):
    """One full-circle rib, drawn as a ring of square beams.

    A beam between two points on the circle has direction (dx, 0, dy) in Blender space -- its
    Blender-Y component is always zero, so it can never line up with the beam-orientation
    toolkit's degenerate case regardless of which local axis that case turns out to be. Using the
    same thickness for both cross-section sides (a square rod) also means the beam's closest
    approach to the axis does not depend on its (otherwise unpredictable) roll.
    """
    thickness = 1.0
    points = [
        L.bl(axis_x + radius * cos(2 * pi * i / _HULL_RIB_SEGMENTS),
             axis_y + radius * sin(2 * pi * i / _HULL_RIB_SEGMENTS), z_map)
        for i in range(_HULL_RIB_SEGMENTS)
    ]
    for i in range(_HULL_RIB_SEGMENTS):
        canvas.beam(material, points[i], points[(i + 1) % _HULL_RIB_SEGMENTS], thickness)


def _hull_bay_plating(canvas, axis_x, axis_y, radius, z0, z1, bay_index):
    """Tangential plates between one pair of ribs: solid on the lower flanks, sparse above.

    Each plate is a box rotated about the map z axis by its slot's angle -- map_box's `rotation`
    argument -- with radial thickness as its X size and tangential width as its Z size, so the
    surface stays flush with the rib circle no matter which way around it sits.
    """
    thickness = 0.8
    r_place = radius - thickness / 2.0
    axial = (z1 - z0) * 0.82
    z_mid = (z0 + z1) / 2.0
    slot_span = 2 * pi / _HULL_PLATE_SLOTS
    arc_width = 2 * pi * radius / _HULL_PLATE_SLOTS * 0.85
    for slot in range(_HULL_PLATE_SLOTS):
        theta = slot_span * (slot + 0.5)
        lower_flank = pi <= theta <= 2 * pi
        if not lower_flank and et.hash01(bay_index, slot, 7.0) > 0.35:
            continue
        material = L.HULL_PLATE if lower_flank else L.HULL_DARK
        cx = axis_x + r_place * cos(theta)
        cy = axis_y + r_place * sin(theta)
        map_box(canvas, material, (cx, cy, z_mid), (thickness, arc_width, axial), rotation=theta)


# --- 08_backdrop -----------------------------------------------------------------------------------


def build_backdrop(canvas):
    """Everything decorative that makes the station read as huge and busy from every ring.

    Every element sits outside the arena's own play volume by a wide margin -- solar wings and
    the derelict hull skeleton hug the +-x edges, beacons and tanks sit past z=+-130 -- well clear
    of the 15-unit rule, since the route itself never leaves roughly x in [-175, 175],
    z in [-130, 130].
    """
    _solar_wing(canvas, -172.0, 95.0, -60.0)
    _solar_wing(canvas, -172.0, 95.0, 40.0)
    _solar_wing(canvas, 172.0, 150.0, -40.0)

    _distant_truss(canvas, -150.0, 3.0, -135.0, 70.0)
    _distant_truss(canvas, 150.0, 3.0, 135.0, 55.0)
    _distant_truss(canvas, -60.0, 3.0, -140.0, 45.0)

    _derelict_hull(canvas, 0.0, 100.0, -140.0)

    for x, y, z in ((-176.0, 150.0, -80.0), (176.0, 20.0, 130.0), (-40.0, 165.0, 140.0),
                    (140.0, 165.0, -140.0)):
        canvas.box(L.GLOW_RED, L.bl(x, y, z), (0.9, 0.9, 0.9), decorative=True)

    for x, z in ((-165.0, -110.0), (165.0, 100.0), (-150.0, 130.0)):
        # frustum()'s local Z is its long axis and Blender Z is already map y (L.bl keeps that
        # component in place), so an upright tank needs no extra rotation at all.
        canvas.frustum(et.STEEL, L.bl(x, 18.0, z), 8.0, 6.0, 30.0, sides=10, decorative=True)


def _solar_wing(canvas, x, y, z):
    """A big flat panel on a mast, standing in for the station's power arrays."""
    canvas.box(et.STEEL, L.bl(x, y - 15.0, z), (2.0, 30.0, 2.0), decorative=True)
    for sign in (-1, 1):
        map_box(canvas, L.HULL_DARK, (x, y, z + sign * 13.0), (1.2, 22.0, 24.0), decorative=True)


def _distant_truss(canvas, x, y0, z, height):
    """A skeletal frame on the skyline: four corner beams and a couple of cross-braces."""
    half = 6.0
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        map_box(canvas, L.TRUSS, (x + sx * half, y0 + height / 2.0, z + sz * half),
                (1.0, height, 1.0), decorative=True)
    for frac in (0.35, 0.7):
        y = y0 + height * frac
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            map_box(canvas, L.TRUSS, (x + sx * half / 2, y, z + sz * half / 2), (half, 0.6, half),
                    decorative=True)


def _derelict_hull(canvas, axis_x, axis_y, z_center):
    """A second, smaller hull skeleton far off at the arena edge -- a sister ship, unfinished too."""
    radius = 16.0
    for i in range(6):
        z_map = z_center - 25.0 + i * 10.0
        points = [
            L.bl(axis_x + radius * cos(2 * pi * s / 20), axis_y + radius * sin(2 * pi * s / 20), z_map)
            for s in range(20)
        ]
        for s in range(20):
            canvas.beam(L.HULL_DARK, points[s], points[(s + 1) % 20], 0.8, decorative=True)
