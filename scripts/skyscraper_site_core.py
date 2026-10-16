"""Route-aware static construction geometry for Skyscraper Site.

Geometry is authored in the map frame and converted only at Canvas boundaries.  Solid
members stay outside the authored flight corridors; fine netting and service detail is
visual-only so it cannot become a thin accidental wall.
"""

import skyscraper_site_layout as L


def _p(point):
    return L.bl(*point)


def _size(size):
    return (size[0], size[2], size[1])


def _box(canvas, material, center, size, decorative=False):
    canvas.box(material, _p(center), _size(size), decorative=decorative)


def _beam(canvas, material, start, end, thickness, width=None, decorative=False):
    canvas.beam(material, _p(start), _p(end), thickness, width=width, decorative=decorative)


def _column(canvas, material, x, z, y0, y1, width=0.65, decorative=False):
    _beam(canvas, material, (x, y0, z), (x, y1, z), width, width=width, decorative=decorative)


def build_scaffold(canvas):
    """Two scaffold banks leave the sloping CP03 -> CP04 climb open through the middle."""
    s = L.SCAFFOLD
    # The CP04 -> CP05 diagonal clears the x=-48 post; the x=-42 pair and its
    # attached solid cross-rails intrude into the authored flight corridor.
    xs = (-78.0, -64.0, -48.0)
    zs = (57.0, 98.0)
    for x in xs:
        for z in zs:
            if z == 57.0 and x in (-78.0, -64.0):
                # Leave the crane's rope/load sweep open through the front bank.
                _column(canvas, L.SCAFFOLD_TUBE, x, z, 1.0, 32.0, 0.75)
                _column(canvas, L.SCAFFOLD_TUBE, x, z, 48.0, s["top_y"] - 1.0, 0.75)
            else:
                _column(canvas, L.SCAFFOLD_TUBE, x, z, 1.0, s["top_y"] - 1.0, 0.75)
        for z in zs:
            if z == 57.0 and x in (-78.0, -64.0):
                _beam(canvas, L.STEEL_RUST, (x, 7.0, z), (x, 32.0, z), 0.42,
                      width=0.42, decorative=True)
                _beam(canvas, L.STEEL_RUST, (x, 48.0, z), (x, 68.0, z), 0.42,
                      width=0.42, decorative=True)
            else:
                _beam(canvas, L.STEEL_RUST, (x, 7.0, z), (x, 68.0, z), 0.42,
                      width=0.42, decorative=True)
    for y in (8.0, 20.0, 34.0, 48.0, 62.0, 68.0):
        for z in zs:
            if z == 57.0 and y in (8.0, 20.0, 34.0):
                # Break the low front rails across the crane-rope sweep.
                _beam(canvas, L.SCAFFOLD_TUBE, (xs[0], y, z), (-76.0, y, z),
                      0.52, width=0.52)
                _beam(canvas, L.SCAFFOLD_TUBE, (-65.0, y, z), (xs[-1], y, z),
                      0.52, width=0.52)
            else:
                _beam(canvas, L.SCAFFOLD_TUBE, (xs[0], y, z), (xs[-1], y, z),
                      0.52, width=0.52)
    for x0, x1 in zip(xs, xs[1:]):
        for z in zs:
            if z == 57.0:
                continue
            _beam(canvas, L.STEEL_RUST, (x0, 8.0, z), (x1, 34.0, z),
                  0.36, decorative=True)
            _beam(canvas, L.STEEL_RUST, (x1, 34.0, z), (x0, 62.0, z),
                  0.36, decorative=True)
    # Safety mesh stays on the outside faces, away from the route-facing centre.
    for z in (56.2, 98.8):
        for y in (26.0, 48.0):
            if z == 56.2 and y == 26.0:
                continue
            _beam(canvas, L.NET, (xs[0], y, z), (xs[-1], y, z), 0.08,
                  width=0.08, decorative=True)
    for x in (-78.0, -32.0):
        _box(canvas, L.HAZARD, (x, 2.0, 77.5), (1.2, 4.0, 28.0), decorative=True)


def build_steel_skeleton(canvas):
    """An open steel frame; the ring-to-ring bay stays free of full floors and cross-walls."""
    s = L.SKELETON
    x_columns = (-28.0, -10.0, 8.0, 26.0, 44.0, 54.5)
    z_banks = (53.8, -73.0)
    for x in x_columns:
        for z in z_banks:
            # Keep the southwest bay open where the CP04 -> CP05 diagonal passes.
            if x == -28.0 and z == 53.8:
                continue
            _column(canvas, L.STEEL, x, z, 1.0, s["top_y"] - 2.0, 0.72)
            _column(canvas, L.STEEL_RUST, x + 1.25, z, 1.0, s["top_y"] - 2.0, 0.28,
                    decorative=True)
    # Longitudinal rails sit at the two boundaries of the bay, never across its flight line.
    for z in z_banks:
        for y in (12.0, 32.0, 82.0, 102.0):
            _beam(canvas, L.STEEL, (x_columns[0], y, z), (x_columns[-1], y, z),
                  0.62, width=0.62)
        for x0, x1 in zip(x_columns, x_columns[1:]):
            _beam(canvas, L.STEEL_RUST, (x0, 12.0, z), (x1, 32.0, z),
                  0.34, decorative=True)
            _beam(canvas, L.STEEL_RUST, (x1, 82.0, z), (x0, 102.0, z),
                  0.34, decorative=True)
    # Overhead roof trusses provide the hall silhouette but stay at least 24 units above flight.
    for x in (-20.0, -2.0, 16.0, 26.0, 52.0):
        _beam(canvas, L.STEEL, (x, 104.0, -73.0), (x, 104.0, 53.8), 0.7, width=0.7)
        _beam(canvas, L.STEEL_RUST, (x, 84.0, -73.0), (x, 104.0, -73.0),
              0.32, decorative=True)
        _beam(canvas, L.STEEL_RUST, (x, 84.0, 53.8), (x, 104.0, 53.8),
              0.32, decorative=True)
    for z in (-68.0, -50.0, -32.0, -14.0, 4.0, 22.0, 40.0):
        _beam(canvas, L.NET, (-27.0, 74.0, z), (-27.0, 100.0, z),
              0.07, decorative=True)
        _beam(canvas, L.NET, (53.5, 74.0, z), (53.5, 100.0, z),
              0.07, decorative=True)
    # Red edge marks are visual-only and remain on the outer banks.
    for z in (54.5, -73.8):
        for x in (-24.0, 0.0, 24.0, 48.0):
            _box(canvas, L.GLOW_RED, (x, 106.0, z), (1.4, 0.24, 0.18), decorative=True)


def build_concrete_core(canvas):
    """A compact four-wall service core beside the CP08 -> CP09 approach."""
    c = L.CONCRETE_CORE
    thickness = 1.2
    x_mid = (c["x_min"] + c["x_max"]) / 2
    z_low = c["z_min"] + 1.0
    z_high = c["z_max"] - 1.0
    z_mid = (z_low + z_high) / 2
    inner_depth = z_high - z_low - thickness * 2
    _box(canvas, L.CONCRETE, (c["x_min"] + thickness / 2, c["top_y"] / 2, z_mid),
         (thickness, c["top_y"], z_high - z_low))
    _box(canvas, L.CONCRETE, (c["x_max"] - thickness / 2, c["top_y"] / 2, z_mid),
         (thickness, c["top_y"], z_high - z_low))
    for z in (z_low + thickness / 2, z_high - thickness / 2):
        _box(canvas, L.CONCRETE_DARK, (x_mid, c["top_y"] / 2, z),
             (c["x_max"] - c["x_min"] - thickness * 2, c["top_y"], thickness))
    # Recessed ventilation bands are non-colliding; the west wall remains closed and solid.
    for y in range(14, 108, 14):
        _box(canvas, L.STEEL_RUST, (c["x_min"] + 0.08, float(y), z_mid),
             (0.12, 1.1, inner_depth * 0.58), decorative=True)
        for z in (z_low + 3.0, z_high - 3.0):
            _box(canvas, L.HAZARD, (x_mid, float(y), z), (4.0, 0.35, 0.35), decorative=True)
    _box(canvas, L.CONCRETE_DARK, (x_mid, c["top_y"] - 0.8, z_mid),
         (c["x_max"] - c["x_min"], 1.6, z_high - z_low))


def build_elevator_shaft(canvas):
    """Open-topped lift shaft with a west doorway and a high south egress for CP11 -> CP12."""
    s = L.SHAFT
    x, z, half, wall = s["x"], s["z"], s["inner_half"], s["wall"]
    x_west, x_east = x - half - wall, x + half + wall
    z_north, z_south = z - half - wall, z + half + wall
    y0, y1 = s["y_bottom"], s["y_top"]
    door_low, door_high = s["door_y"]
    door_half = s["door_half_width"]

    # Close the shaft base from the map floor to the existing wall line at y=50.
    _box(canvas, L.CONCRETE, (x, y0 / 2, z),
         (x_east - x_west, y0, z_south - z_north))

    # West doorway is split vertically and has two solid jambs through the opening band.
    west_wall_top = min(y1, 130.0)
    _box(canvas, L.CONCRETE, (x_west + wall / 2, (y0 + door_low) / 2, z),
         (wall, door_low - y0, half * 2 + wall * 2))
    _box(canvas, L.CONCRETE, (x_west + wall / 2, (door_high + west_wall_top) / 2, z),
         (wall, west_wall_top - door_high, half * 2 + wall * 2))
    jamb_width = (half * 2 + wall * 2 - door_half * 2) / 2
    for jamb_z in (z - door_half - jamb_width / 2, z + door_half + jamb_width / 2):
        _box(canvas, L.CONCRETE_DARK, (x_west + wall / 2, (door_low + door_high) / 2, jamb_z),
             (wall, door_high - door_low, jamb_width))

    # East and north walls close the lift; the south wall stops at 114 to leave the diagonal exit.
    _box(canvas, L.CONCRETE, (x_east - wall / 2, (y0 + y1) / 2, z),
         (wall, y1 - y0, half * 2 + wall * 2))
    _box(canvas, L.CONCRETE, (x, (y0 + y1) / 2, z_north + wall / 2),
         (half * 2, y1 - y0, wall))
    south_wall_top = 114.0
    _box(canvas, L.CONCRETE_DARK, (x, (y0 + south_wall_top) / 2, z_south - wall / 2),
         (half * 2, south_wall_top - y0, wall))

    # Vertical guide rails and floor numbers stay inset inside the shaft.
    for sign_x in (-1.0, 1.0):
        rail_x = x + sign_x * (half - 1.5)
        rail_z = z + sign_x * (half - 0.5)
        _beam(canvas, L.SCAFFOLD_TUBE, (rail_x, y0 + 2.0, rail_z),
              (rail_x, y1 - 3.0, rail_z), 0.38, width=0.38)
    for y in (80.0, 104.0):
        _beam(canvas, L.STEEL_RUST, (x - half + 2.0, y, z),
              (x + half - 2.0, y, z), 0.22, decorative=True)
    for y in (56.0, 72.0, 90.0, 108.0, 124.0):
        _box(canvas, L.GLOW_RED, (x_west + 0.08, y, z), (0.12, 0.7, 3.0), decorative=True)


def build_main_crane(canvas):
    """A fixed tower crane; the mast avoids the CP12 -> CP15 flight corridor."""
    crane = L.MAIN_CRANE
    x, z, half = crane["x"], crane["z"], crane["mast_half"]
    top, jib_y = crane["top_y"], crane["jib_y"]
    base_y = L.ROOF["y"] + 4.0  # clear the roof slab and seat the mast on its upper surface
    # Four closed legs and cross ties make a readable, low-poly lattice mast.
    for dx in (-half, half):
        for dz in (-half, half):
            _beam(canvas, L.STEEL, (x + dx, base_y, z + dz), (x + dx, top, z + dz), 0.85)
    for y in (120.0, 138.0, 156.0):
        _beam(canvas, L.STEEL_RUST, (x - half, y, z - half), (x + half, y, z + half), 0.42)
        _beam(canvas, L.STEEL_RUST, (x + half, y, z - half), (x - half, y, z + half), 0.42)

    # Jib and counter-jib sit high above the roof; the CP13/14 line passes well south of them.
    jib_length = crane["jib_length"]
    counter = crane["counter_jib_length"]
    _beam(canvas, L.CRANE_YELLOW, (x - counter, jib_y, z),
          (x + jib_length, jib_y, z), 1.5, width=1.8)
    for side_z in (z - 1.5, z + 1.5):
        _beam(canvas, L.STEEL, (x - counter, jib_y - 1.0, side_z),
              (x + jib_length, jib_y - 1.0, side_z), 0.35)
    for step in range(0, int(jib_length + counter) + 1, 8):
        beam_x = x - counter + step
        _beam(canvas, L.STEEL_RUST, (beam_x, jib_y - 1.0, z - 1.5),
              (beam_x, jib_y - 1.0, z + 1.5), 0.34)
    _box(canvas, L.CONCRETE_DARK, (x, top - 2.0, z), (7.0, 4.0, 7.0))
    _beam(canvas, L.CRANE_YELLOW, (x, top - 2.0, z), (x, top, z), 0.6)
    # Trolley and cable are intentionally offset from the ring centre and remain solid/closed.
    trolley_x = x + 39.0
    _box(canvas, L.HAZARD, (trolley_x, jib_y - 2.5, z), (5.0, 2.0, 4.0))
    _beam(canvas, L.STEEL, (trolley_x, jib_y - 3.5, z), (trolley_x, 130.0, z), 0.24)
    _box(canvas, L.CRANE_YELLOW, (trolley_x, 129.0, z), (3.0, 2.0, 3.0))
