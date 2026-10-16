"""Skyline, street canyon, and roof-finale geometry for Skyscraper Site.

All dimensions are authored in the map frame from ``skyscraper_site_layout``.  This
module only fills Canvas buckets; the shared generator owns names, bounds, and export.
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


def _tower(canvas, *, x, z, width, depth, height, material, window_rows=0):
    """One closed tower mass with a restrained grid of non-colliding lit windows."""
    _box(canvas, material, (x, height / 2, z), (width, height, depth))
    if window_rows <= 0:
        return
    cols = max(2, int(width // 5))
    rows = window_rows
    for face_z, sign in ((z - depth / 2 - 0.025, -1), (z + depth / 2 + 0.025, 1)):
        for row in range(rows):
            y = 7.0 + row * max(8.0, (height - 14.0) / rows)
            if y + 3.2 >= height - 2.0:
                continue
            for col in range(cols):
                x_pos = x - width / 2 + (col + 0.5) * width / cols
                _box(canvas, L.WINDOW_WARM, (x_pos, y, face_z + sign * 0.01),
                     (1.3, 3.2, 0.08), decorative=True)


def build_street_ground(canvas):
    """A continuous low street base; the first flight lane remains nine units above it."""
    ground = L.GROUND
    _box(canvas, L.ASPHALT, (0.0, (ground["y_bottom"] + ground["y_top"]) / 2, 0.0),
         (L.ARENA_SIZE[0], ground["y_top"] - ground["y_bottom"], L.ARENA_SIZE[2]))
    # Fine paint remains visual-only; it never turns into a thin collision wall.
    for x in range(-170, 171, 20):
        _box(canvas, L.HAZARD, (float(x), ground["y_top"] + 0.03, 100.0),
             (5.0, 0.04, 0.22), decorative=True)
    for z in (80.0, 120.0):
        _beam(canvas, L.CONCRETE_DARK, (-180.0, 0.04, z), (-40.0, 0.04, z),
              0.18, decorative=True)


def build_skyline_street(canvas):
    """Two finished blocks frame the open street canyon and leave the full route visible."""
    gap_lo, gap_hi = L.STREET["z_min"], L.STREET["z_max"]
    west_row_z = (42.0 + (gap_lo - 6.0)) / 2
    west_row_depth = gap_lo - 6.0 - 42.0
    east_row_z = (gap_hi + 6.0 + 150.0) / 2
    east_row_depth = 150.0 - (gap_hi + 6.0)
    # The low west frontage stays beyond the slewing crane's full radius and the CP03->CP04
    # corridor. Further buildings use the opposite, high-z frontage below the street opening.
    west_towers = (
        (-168.0, 12.0, 104.0), (-150.0, 16.0, 148.0),
    )
    for index, (x, width, height) in enumerate(west_towers):
        _tower(canvas, x=x, z=west_row_z, width=width, depth=west_row_depth,
               height=height, material=L.GLASS_TOWER if index % 2 else L.CONCRETE_DARK,
               window_rows=max(4, int(height // 15)))
        # Roof plant and parapet are set back from the canyon-facing edge.
        _box(canvas, L.CONCRETE, (x, height + 1.0, west_row_z),
             (width * 0.72, 2.0, west_row_depth * 0.55))

    east_towers = (
        (-166.0, 16.0, 132.0), (-140.0, 20.0, 96.0), (-110.0, 18.0, 150.0),
        (-80.0, 20.0, 110.0), (-52.0, 16.0, 138.0),
    )
    for index, (x, width, height) in enumerate(east_towers):
        _tower(canvas, x=x, z=east_row_z, width=width, depth=east_row_depth,
               height=height, material=L.GLASS_TOWER if index % 2 else L.CONCRETE,
               window_rows=max(4, int(height // 15)))
        _box(canvas, L.STEEL_RUST, (x, height + 1.0, east_row_z),
             (width * 0.7, 2.0, east_row_depth * 0.5))

    # Short bridges only join buildings behind the protected z=76..124 street opening.
    for x in (-155.0, -111.0):
        _beam(canvas, L.STEEL_RUST, (x - 4.0, 42.0, gap_lo - 8.0),
              (x + 4.0, 42.0, gap_hi + 8.0), 0.65, width=1.1, decorative=True)
        _beam(canvas, L.NET, (x - 4.0, 43.0, gap_lo - 8.0),
              (x + 4.0, 43.0, gap_hi + 8.0), 0.08, decorative=True)


def build_skyline_backdrop(canvas):
    """A distant south skyline, separated from the flown route by a broad negative-space band."""
    buildings = (
        (-154.0, 22.0, 148.0), (-119.0, 26.0, 182.0), (-80.0, 20.0, 126.0),
        (-48.0, 28.0, 168.0), (-8.0, 24.0, 190.0), (34.0, 31.0, 154.0),
        (80.0, 24.0, 176.0), (122.0, 30.0, 138.0), (164.0, 22.0, 170.0),
    )
    for index, (x, width, height) in enumerate(buildings):
        _tower(canvas, x=x, z=-124.0, width=width, depth=42.0, height=height,
               material=L.GLASS_TOWER if index % 3 else L.CONCRETE_DARK,
               window_rows=max(4, int(height // 18)))
        # A narrow crown changes the skyline without adding a large collision silhouette.
        _box(canvas, L.STEEL_RUST, (x, min(height + 2.0, 187.0), -124.0),
             (width * 0.5, 4.0, 16.0))
        _beam(canvas, L.GLOW_RED, (x, min(height + 4.2, 187.0), -124.0),
              (x, min(height + 8.0, 189.0), -124.0), 0.55, decorative=True)


def build_roof_finale(canvas):
    """Construction-tower roof, with the finish approach left open above the roof deck."""
    roof = L.ROOF
    center_x = (roof["x_min"] + roof["x_max"]) / 2
    center_z = (roof["z_min"] + roof["z_max"]) / 2
    _box(canvas, L.CONCRETE, (center_x, roof["y"] + 1.5, center_z),
         (roof["x_max"] - roof["x_min"], 3.0, roof["z_max"] - roof["z_min"]))
    _box(canvas, L.CONCRETE_DARK, (center_x, roof["y"] + 3.0, center_z),
         (56.0, 1.0, 56.0))

    # Parapets stay at the deck edge; the CP17 -> CP18 -> FINISH line is above y=126.
    parapet_y = roof["y"] + 5.0
    for z in (roof["z_min"] + 2.0, roof["z_max"] - 2.0):
        _box(canvas, L.SCAFFOLD_TUBE, (center_x, parapet_y, z),
             (roof["x_max"] - roof["x_min"] - 8.0, 1.0, 0.7))
    for x in (roof["x_min"] + 2.0, roof["x_max"] - 2.0):
        _box(canvas, L.SCAFFOLD_TUBE, (x, parapet_y, center_z),
             (0.7, 1.0, roof["z_max"] - roof["z_min"] - 8.0))
    for x in range(-16, 57, 12):
        for z in range(-66, 7, 12):
            _box(canvas, L.HAZARD, (float(x), roof["y"] + 3.55, float(z)),
                 (0.32, 0.1, 0.32), decorative=True)

    # The spire sits east of the landing corridor and uses a thin collidable core plus glow detail.
    sx, sz, top_y = roof["spire"]
    base_y = roof["y"] + 4.0
    _box(canvas, L.CONCRETE_DARK, (sx, (base_y + top_y) / 2, sz),
         (4.0, top_y - base_y, 4.0))
    for y in (124.0, 136.0, 148.0, 160.0):
        _beam(canvas, L.STEEL_RUST, (sx - 4.0, y, sz), (sx + 4.0, y, sz),
              0.5, decorative=True)
    _beam(canvas, L.GLOW_RED, (sx, top_y - 1.5, sz), (sx, top_y, sz),
          0.45, decorative=True)
