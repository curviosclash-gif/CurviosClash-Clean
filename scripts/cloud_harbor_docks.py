"""Cloud Harbor: cloud sea, mooring dock, cargo zeppelin, wind isle, backdrop (static)."""

from math import cos, pi, sin

from mathutils import Matrix

import cloud_harbor_layout as L
from cloud_harbor_geometry import add_annular_shell, add_rock_island


def _map_beam(canvas, material, start, end, thickness, width=None, *, decorative=False):
    canvas.beam(material, L.bl(*start), L.bl(*end), thickness, width, decorative=decorative)


def _cloud_puff(canvas, x, z, radius, *, y=9.0):
    canvas.frustum(L.CLOUD, L.bl(x, y, z), radius * 0.62, radius, 5.0, sides=8,
                   decorative=True)


def build_cloud_sea(canvas):
    """Collidable soft-coloured floor with a broken horizon of non-colliding cloud crowns."""
    sea = L.CLOUD_SEA
    height = sea["y_top"] - sea["y_bottom"]
    canvas.box(L.CLOUD, L.bl(0, sea["y_bottom"] + height / 2, 0),
               (L.ARENA_SIZE[0], L.ARENA_SIZE[2], height))
    # A low ring of broad, overlapping crowns gives the edge a cloud-bank silhouette while the
    # single broad floor below remains the only cloud-sea collider.
    for index in range(18):
        angle = 2.0 * pi * index / 18
        radius = 132.0 + 8.0 * sin(index * 1.7)
        size = 12.0 + 3.0 * cos(index * 2.1)
        _cloud_puff(canvas, radius * cos(angle), radius * sin(angle), size,
                    y=sea["puff_top_y"] - 5.0)


def build_mooring_dock(canvas):
    """A grass-topped floating mooring island and a brass-ringed anchor mast."""
    d = L.MOORING_DOCK
    center_x = (d["x_back"] + d["x_front"]) / 2
    add_rock_island(canvas, (center_x, d["z"]), d["deck_half_width"] + 8.0, 25.0,
                    d["island_bottom_y"], d["deck_y"] - 1.5, segments=20)
    canvas.box(L.WOOD, L.bl(center_x, d["deck_y"] - 0.35, d["z"]),
               (d["x_front"] - d["x_back"], 2.0 * d["deck_half_width"], 0.7))
    # Broad edge beams and short mooring bollards sit outside the spawn-to-CP01 flight lane.
    for sign in (-1, 1):
        canvas.box(L.BRASS, L.bl(center_x, d["deck_y"] + 0.5,
                                 d["z"] + sign * (d["deck_half_width"] - 1.2)),
                   (d["x_front"] - d["x_back"] - 4.0, 0.4, 1.0), decorative=True)
        for x in (d["x_back"] + 5.0, d["x_front"] - 5.0):
            canvas.frustum(L.BRASS, L.bl(x, d["deck_y"] + 1.5,
                                         d["z"] + sign * (d["deck_half_width"] - 2.0)),
                           0.7, 0.45, 3.0, sides=8)

    mast_height = d["mast_top_y"] - d["deck_y"]
    mast_center = (d["mast_top_y"] + d["deck_y"]) / 2
    canvas.frustum(L.WOOD, L.bl(d["mast_x"], mast_center, d["mast_z"]), 1.8, 1.0,
                   mast_height, sides=8)
    for y in (d["deck_y"] + 12.0, d["deck_y"] + 28.0, d["mast_top_y"] - 5.0):
        canvas.frustum(L.BRASS, L.bl(d["mast_x"], y, d["mast_z"]), 2.0, 2.0, 0.65,
                       sides=8, decorative=True)
    canvas.frustum(L.BRASS, L.bl(d["mast_x"], d["mast_top_y"] + 2.0, d["mast_z"]),
                   1.0, 0.0, 4.0, sides=8, decorative=True)
    # Two taut lines point to the zeppelin's bow shoulders, clear of its open centreline.
    for sign in (-1, 1):
        _map_beam(canvas, L.IRON, (d["mast_x"], d["mast_top_y"] - 7.0,
                                   d["mast_z"] + sign * 3.0),
                  (-112.0, 70.0, 100.0 + sign * 20.0), 0.22, decorative=True)


def build_cargo_zeppelin(canvas):
    """Open freight hull with a genuinely empty through-bay and a separate annular collider."""
    ship = L.CARGO_ZEPPELIN
    x0, x1 = ship["x_bow"], ship["x_stern"]
    # The visible envelope is nocol. Its center bore remains open so the pilot can fly through;
    # the runtime receives a separate closed annular wall, never a solid cylinder across the bay.
    add_annular_shell(canvas, L.ENVELOPE, x0, x1, ship["axis_y"], ship["z"],
                      ship["bay_radius"], ship["envelope_radius"], stations=20, sides=24,
                      decorative=True)
    collider = L.CARGO_ZEPPELIN_COLLIDER
    collision_canvas = type(canvas)()
    add_annular_shell(collision_canvas, L.IRON, x0, x1, ship["axis_y"], ship["z"],
                      collider["hull_collider_inner"], collider["hull_collider_outer"],
                      stations=20, sides=24)
    for obj in collision_canvas.emit("cargo_hull_wall"):
        obj.name = f"{obj.name}_colonly"

    # Open-end hatch hoops and longitudinal girders stay on the outer envelope.
    for x in (x0 + 7.0, -92.0, -72.0, -52.0, -32.0, x1 - 7.0):
        radius = ship["envelope_radius"] * (0.88 + 0.12 * min(1.0,
                  (x - x0) / 18.0, (x1 - x) / 18.0))
        ring_points = []
        for side in range(12):
            angle = 2.0 * pi * side / 12
            ring_points.append((x, ship["axis_y"] + radius * sin(angle),
                                ship["z"] + radius * cos(angle)))
        for index, point in enumerate(ring_points):
            _map_beam(canvas, L.BRASS, point, ring_points[(index + 1) % 12], 0.7,
                      decorative=True)

    for sign in (-1, 1):
        for y_offset in (-8.0, 8.0):
            _map_beam(canvas, L.WOOD, (x0 + 4.0, ship["axis_y"] + y_offset,
                                       ship["z"] + sign * 20.0),
                      (x1 - 4.0, ship["axis_y"] + y_offset, ship["z"] + sign * 20.0),
                      0.45, decorative=True)
    # Four compact engine pods are below and outside the annular hull, away from the bay.
    for x, pod_sign in ship["engine_pods"]:
        z = ship["z"] + pod_sign * 17.0
        canvas.frustum(L.ENVELOPE_DARK, L.bl(x, ship["axis_y"] - 22.5, z),
                       3.2, 2.2, 14.0, sides=10, rotation=(0, pi / 2, 0))
        canvas.frustum(L.BRASS, L.bl(x, ship["axis_y"] - 22.5, z),
                       1.2, 0.0, 3.2, sides=8, rotation=(0, pi / 2, 0),
                       decorative=True)

    # Portholes, bridge glazing and a raised pilot cabin are small nocol reliefs on the envelope.
    for x in (-101.0, -90.0, -78.0, -66.0, -54.0, -42.0, -30.0):
        for sign in (-1, 1):
            canvas.frustum(L.GLOW_WARM, L.bl(x, ship["axis_y"] + 1.0,
                                             ship["z"] + sign * 21.5),
                           0.55, 0.55, 0.3, sides=8, rotation=(pi / 2, 0, 0),
                           decorative=True)
    canvas.box(L.WOOD, L.bl(x0 + 18.0, ship["axis_y"] + 25.0, ship["z"]),
               (12.0, 8.0, 4.0))
    canvas.box(L.GLOW_TEAL, L.bl(x0 + 18.0, ship["axis_y"] + 26.5, ship["z"]),
               (8.0, 6.2, 1.0), decorative=True)
    for sign in (-1, 1):
        _map_beam(canvas, L.BRASS, (x0 + 18.0, ship["axis_y"] + 24.0,
                                    ship["z"] + sign * 5.0),
                  (x0 + 12.0, ship["axis_y"] + 21.0, ship["z"] + sign * 13.0),
                  0.3, decorative=True)


def build_wind_isle(canvas):
    """The twin windmill island, with two tapered towers beneath the animated rotor discs."""
    isle = L.WIND_ISLE
    center = ((isle["x_min"] + isle["x_max"]) / 2,
              (isle["z_min"] + isle["z_max"]) / 2)
    add_rock_island(canvas, center, (isle["x_max"] - isle["x_min"]) / 2,
                    (isle["z_max"] - isle["z_min"]) / 2, isle["island_bottom_y"],
                    isle["deck_y"], segments=24, material=L.ROCK)
    canvas.box(L.GRASS, L.bl(center[0], isle["deck_y"] + 0.4, center[1]),
               (isle["x_max"] - isle["x_min"] - 6.0,
                isle["z_max"] - isle["z_min"] - 6.0, 0.8))
    for index, mill in enumerate(L.WINDMILLS):
        x, y, z = mill["hub"]
        support_x = x + mill["downstream"][0] * 6.5
        support_z = z + mill["downstream"][2] * 6.5
        height = y - isle["deck_y"]
        canvas.frustum(L.STONE, L.bl(support_x, isle["deck_y"] + height / 2, support_z),
                       4.4, 2.6, height, sides=10)
        canvas.frustum(L.WOOD, L.bl(support_x, isle["deck_y"] + height * 0.42, support_z),
                       4.6, 3.0, height * 0.24, sides=10)
        # Nacelles sit downstream of each hub; the rotor and its swept course rings are animated
        # separately by the existing setpiece file.
        if mill["axis"] == "x":
            rotation = (0, pi / 2, 0)
            nacelle = (support_x, y, support_z)
        else:
            rotation = (pi / 2, 0, 0)
            nacelle = (support_x, y, support_z)
        canvas.frustum(L.ENVELOPE_DARK, L.bl(*nacelle), mill["hub_radius"] * 1.05,
                       mill["hub_radius"] * 0.8, 7.0, sides=10, rotation=rotation)
        canvas.frustum(L.BRASS, L.bl(*mill["hub"]), mill["hub_radius"] * 0.52,
                       mill["hub_radius"] * 0.36, 2.8, sides=10,
                       rotation=rotation, decorative=True)
        for side in (-1, 1):
            # Timber braces meet the tower below the hub, never across the approach ring.
            _map_beam(canvas, L.WOOD, (support_x, isle["deck_y"] + height * 0.42, support_z),
                      (support_x + side * 5.5, isle["deck_y"] + height * 0.82,
                       support_z + side * 3.0), 0.7)
    # A tiny signal hut belongs on the back edge, well clear of both checkpoint discs.
    canvas.box(L.WOOD, L.bl(0.0, isle["deck_y"] + 4.0, 111.0), (8.0, 8.0, 8.0))
    canvas.frustum(L.ROOF_TILE, L.bl(0.0, isle["deck_y"] + 9.0, 111.0),
                   6.0, 0.0, 4.0, sides=4, rotation=(0, 0, pi / 4), decorative=True)


def build_backdrop(canvas):
    """Distant cream balloon silhouettes and wisps, kept visual-only at the arena rim."""
    clouds = ((-158.0, 134.0, 15.0), (-156.0, -134.0, 12.0),
              (158.0, 136.0, 13.0), (160.0, -132.0, 16.0),
              (-118.0, -142.0, 11.0), (128.0, 142.0, 10.0))
    for x, z, radius in clouds:
        _cloud_puff(canvas, x, z, radius, y=112.0)
        canvas.frustum(L.ENVELOPE, L.bl(x, 132.0, z), radius * 0.42, radius * 0.3,
                       10.0, sides=10, decorative=True)
        canvas.frustum(L.BRASS, L.bl(x, 127.0, z), radius * 0.32, radius * 0.32,
                       1.4, sides=10, decorative=True)
        for sign in (-1, 1):
            _map_beam(canvas, L.WOOD, (x + sign * radius * 0.15, 126.0, z),
                      (x + sign * radius * 0.3, 116.0, z), 0.22, decorative=True)
