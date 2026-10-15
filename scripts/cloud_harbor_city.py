"""Cloud Harbor: market isle, weather tower, cableway, harbor island (static)."""

from math import cos, hypot, pi, sin

import cloud_harbor_layout as L
from cloud_harbor_geometry import add_arch_ring, add_rock_island


def _map_beam(canvas, material, start, end, thickness, width=None, *, decorative=False):
    canvas.beam(material, L.bl(*start), L.bl(*end), thickness, width,
                decorative=decorative)


def _storefront(canvas, x, z, *, facing, roof_height):
    """A compact plaster-and-timber shop; its door faces the bazaar street."""
    base_y, width, depth = L.MARKET_ISLE["deck_y"], 8.0, 9.0
    wall_top = roof_height - 3.0
    height = wall_top - base_y
    canvas.box(L.PLASTER, L.bl(x, base_y + height / 2, z), (width, depth, height))
    canvas.box(L.WOOD, L.bl(x, base_y + 1.0, z), (width + 0.6, depth + 0.6, 2.0),
               decorative=True)
    canvas.box(L.ROOF_TILE, L.bl(x, roof_height - 1.0, z),
               (width + 2.0, depth + 2.0, 2.0))
    # A stepped ridge and two sloped rafters make the roof profile read from either lane.
    canvas.box(L.WOOD, L.bl(x, roof_height + 0.1, z), (width + 1.5, 0.55, 0.55),
               decorative=True)
    for sign in (-1, 1):
        _map_beam(canvas, L.WOOD, (x - width / 2 - 0.4, roof_height - 2.0, z),
                  (x, roof_height + 1.2, z + sign * (depth / 2 + 0.5)), 0.55,
                  decorative=True)
    street_side = z + facing * (depth / 2 + 0.28)
    for offset in (-2.4, 2.4):
        canvas.box(L.GLOW_TEAL, L.bl(x + offset, base_y + 8.5, street_side),
                   (1.5, 0.22, 2.6), decorative=True)
        canvas.box(L.WOOD, L.bl(x + offset, base_y + 8.5, street_side + facing * 0.18),
                   (2.0, 0.28, 3.2), decorative=True)
    # Canvas awning is high above the bazaar ring but below the roof branch.
    canvas.box(L.CANVAS_RED, L.bl(x, base_y + 15.0, street_side + facing * 1.25),
               (width + 0.8, 2.5, 0.4), decorative=True)


def build_market_isle(canvas):
    """Two stepped shop rows, a low bazaar street, and a separate high roof lane."""
    m = L.MARKET_ISLE
    center = ((m["x_min"] + m["x_max"]) / 2, (m["z_min"] + m["z_max"]) / 2)
    add_rock_island(canvas, center, (m["x_max"] - m["x_min"]) / 2,
                    (m["z_max"] - m["z_min"]) / 2, m["island_bottom_y"],
                    m["deck_y"], segments=24)
    canvas.box(L.GRASS, L.bl(center[0], m["deck_y"] + 0.35, center[1]),
               (m["x_max"] - m["x_min"] - 5.0,
                m["z_max"] - m["z_min"] - 5.0, 0.7))
    street_z, street_half = m["street_z"], m["street_half_width"]
    for side, z in ((-1, street_z - 20.0), (1, street_z + 20.0)):
        for x in (90.0, 100.0, 110.0, 120.0):
            # Houses stop before CP09 so the market branch can reunite in open sky.
            _storefront(canvas, x, z, facing=-side, roof_height=m["roof_y"])
        # Light stone arcades frame the shop fronts outside the 28-unit street corridor.
        for x in (88.0, 104.0, 120.0):
            _map_beam(canvas, L.STONE, (x, m["deck_y"] + 1.0, z + side * 6.5),
                      (x, m["roof_y"] - 1.5, z + side * 6.5), 0.8)
            _map_beam(canvas, L.STONE, (x, m["roof_y"] - 1.5, z + side * 6.5),
                      (x + 5.0, m["roof_y"] - 1.5, z + side * 6.5), 0.8)

    # Two bridges cross the street above the bazaar portal (bottom 70, ring centre 56) and far
    # below the roof portal (104). Their piers remain at the street edges.
    for x in m["sky_bridges_x"]:
        bridge_center_y = (m["sky_bridge_bottom_y"] + m["sky_bridge_top_y"]) / 2
        bridge_height = m["sky_bridge_top_y"] - m["sky_bridge_bottom_y"]
        canvas.box(L.STONE, L.bl(x, bridge_center_y, street_z),
                   (5.0, 2.0 * (street_half + 4.0), bridge_height))
        canvas.box(L.BRASS, L.bl(x, m["sky_bridge_top_y"] + 0.35, street_z),
                   (5.8, 2.0 * (street_half + 4.0), 0.7), decorative=True)
        for side in (-1, 1):
            z = street_z + side * (street_half + 3.5)
            canvas.frustum(L.STONE, L.bl(x, m["deck_y"] + 15.0, z), 1.25, 0.8,
                           29.0, sides=8)

    # Roof gardens distinguish the upper branch without raising any collision surface into it.
    for x in (91.0, 105.0, 119.0):
        canvas.box(L.GRASS, L.bl(x, m["roof_y"] + 1.1, street_z - 20.0),
                   (3.0, 1.0, 1.4), decorative=True)
        canvas.box(L.GRASS, L.bl(x, m["roof_y"] + 1.1, street_z + 20.0),
                   (3.0, 1.0, 1.4), decorative=True)
        for side in (-1, 1):
            canvas.frustum(L.GRASS, L.bl(x, m["roof_y"] + 2.0,
                                          street_z + side * 20.0),
                           0.55, 0.75, 1.8, sides=6, decorative=True)
    # A low, straight stone street bed makes the lower route legible and remains below it.
    canvas.box(L.STONE, L.bl((m["x_houses_start"] + m["x_houses_end"]) / 2,
                             m["deck_y"] + 0.65, street_z),
               (m["x_houses_end"] - m["x_houses_start"], street_half * 2.0, 1.3))


def build_weather_tower(canvas):
    """A tapered brass-and-stone weather tower on a separate high-altitude rock island."""
    t = L.WEATHER_TOWER
    add_rock_island(canvas, (t["x"], t["z"]), t["island_radius"], t["island_radius"],
                    t["island_bottom_y"], t["deck_y"], segments=24)
    canvas.box(L.GRASS, L.bl(t["x"], t["deck_y"] + 0.45, t["z"]),
               (t["island_radius"] * 1.55, t["island_radius"] * 1.55, 0.9))
    height = t["top_y"] - t["deck_y"]
    canvas.frustum(L.STONE, L.bl(t["x"], t["deck_y"] + height * 0.5, t["z"]),
                   t["radius"], t["radius"] * 0.68, height, sides=16)
    # Narrow belt balconies stay inside the course's radial clearance while breaking up the shaft.
    for y in (62.0, 84.0, 106.0, 128.0):
        canvas.frustum(L.BRASS, L.bl(t["x"], y, t["z"]), t["radius"] + 1.6,
                       t["radius"] + 1.0, 1.4, sides=16)
        canvas.frustum(L.WOOD, L.bl(t["x"], y + 1.0, t["z"]), t["radius"] + 1.9,
                       t["radius"] + 1.6, 0.45, sides=16, decorative=True)
    # Four sloped braces and a capped weather vane crown stop below the CP13 portal.
    for index in range(4):
        angle = pi * index / 2.0
        dx, dz = cos(angle), sin(angle)
        _map_beam(canvas, L.BRASS, (t["x"] + dx * 8.5, 114.0, t["z"] + dz * 8.5),
                  (t["x"] + dx * 13.5, 134.0, t["z"] + dz * 13.5), 0.55)
    canvas.frustum(L.BRASS, L.bl(t["x"], t["top_y"] + 3.0, t["z"]), 2.4, 0.7, 6.0,
                   sides=10, decorative=True)
    canvas.frustum(L.GLOW_TEAL, L.bl(t["x"], t["top_y"] + 7.0, t["z"]), 0.75, 0.0,
                   2.5, sides=8, decorative=True)


def build_cableway(canvas):
    """Two thin visual-only cables, portal pylons, and compact terminal buildings."""
    c = L.CABLEWAY
    for cable_sign in (-1, 1):
        z = c["cable_z"] + cable_sign * c["cable_offset"]
        a = c["east_anchor"]
        b = c["west_anchor"]
        _map_beam(canvas, L.IRON, (a[0], a[1], z), (b[0], b[1], z), 0.18,
                  decorative=True)
    for index, x in enumerate(c["pylon_x"]):
        cable_height = L.cable_y(x)
        foot_y = cable_height - 31.0
        for side in (-1, 1):
            foot_z = c["cable_z"] + side * c["pylon_leg_offset"]
            head_z = c["cable_z"] + side * (c["pylon_leg_offset"] - 1.5)
            _map_beam(canvas, L.STONE, (x, foot_y, foot_z),
                      (x, cable_height + c["crossbeam_gap"], head_z), 1.65, 1.9)
            canvas.box(L.BRASS, L.bl(x, foot_y + 1.0, foot_z), (4.0, 4.0, 2.0),
                       decorative=True)
        cross_y = cable_height + c["crossbeam_gap"]
        _map_beam(canvas, L.WOOD, (x, cross_y, c["cable_z"] - c["pylon_leg_offset"]),
                  (x, cross_y, c["cable_z"] + c["pylon_leg_offset"]), 1.4, 2.0)
        for side in (-1, 1):
            z = c["cable_z"] + side * c["pylon_leg_offset"]
            canvas.frustum(L.BRASS, L.bl(x, cross_y + 1.3, z), 1.5, 0.8, 2.6,
                           sides=8, decorative=True)

    for index, station in enumerate((c["mountain_station"], c["valley_station"])):
        x, y, z = station
        sx, sy, sz = c["station_size"]
        canvas.box(L.WOOD, L.bl(x, y, z), (sx, sz, sy))
        canvas.box(L.STONE, L.bl(x, y + sy * 0.52, z), (sx + 1.4, sz + 1.4, 1.4))
        canvas.box(L.GLOW_WARM, L.bl(x, y + sy * 0.15, z + (sz / 2 + 0.2)),
                   (sx * 0.56, 0.35, 1.2), decorative=True)
        for sign in (-1, 1):
            _map_beam(canvas, L.BRASS, (x + sign * sx * 0.45, y - sy / 2, z),
                      (x + sign * sx * 0.45, y - sy / 2 - 3.5, z), 0.65)
        # A flat roof avoids catching the adjacent gate approaches.
        canvas.box(L.ROOF_TILE, L.bl(x, y + sy / 2 + 1.0, z),
                   (sx + 2.0, sz + 2.0, 2.0))


def _segment_point(a, b, t):
    return tuple(a[index] + (b[index] - a[index]) * t for index in range(3))


def build_harbor_island(canvas):
    """A notched rock island, high pier, side chains, and a clear 12-unit harbor arch."""
    h = L.HARBOR_ISLAND
    center = (h["x"], h["z"])
    # CP17 -> finish passes tangent to the nominal R44 footprint. This 60-degree outer gorge
    # removes the rock only where the corridor's clearance capsule approaches the island.
    add_rock_island(canvas, center, h["radius"], h["radius"], h["island_bottom_y"],
                    h["deck_y"], segments=32, notch=(50.0, 30.0, 30.0))
    # Grass landing leaves the gorge open; its reduced footprint stays inside the same rock top.
    # Keep the grass landing on the northwest shoulder so it cannot bridge the southeast gorge.
    canvas.box(L.GRASS, L.bl(h["x"] - 13.0, h["deck_y"] + 0.4, h["z"] - 12.0),
               (26.0, 22.0, 0.8))

    # A raised stone pier reaches southeast over the low CP17-to-finish flight. The route passes
    # below it; the bridge deck is at y=84, while that final lane remains around y=52..56.
    p1 = next(checkpoint[2] for checkpoint in L.CHECKPOINTS if checkpoint[0] == "CP17")
    p2 = L.FINISH[2]
    pier_start = (h["x"] + 6.0, h["pier_deck_y"], h["z"] + 2.0)
    pier_elbow = (p1[0], h["pier_deck_y"], p1[2])
    pier_finish = (p2[0], h["pier_deck_y"], p2[2])
    _map_beam(canvas, L.STONE, pier_start, pier_elbow, 4.0, 8.5)
    _map_beam(canvas, L.STONE, pier_elbow, pier_finish, 4.0, 8.5)
    for t in (0.0, 0.33, 0.66, 1.0):
        x, y, z = _segment_point(pier_start, pier_elbow, t)
        canvas.box(L.BRASS, L.bl(x, y + 1.2, z), (4.2, 8.8, 1.0), decorative=True)
    for t in (0.0, 0.33, 0.66, 1.0):
        x, y, z = _segment_point(pier_elbow, pier_finish, t)
        canvas.box(L.BRASS, L.bl(x, y + 1.2, z), (4.2, 8.8, 1.0), decorative=True)

    # Six static chains hang beyond the route's required min-radius + 1.5 clearance, three per
    # side of the final approach. Each link overlaps its neighbour for a continuous collision.
    offsets = []
    # All three rows hang under the final pier, west of the patrol zeppelin's swept volume.
    for a, b, fractions in ((p1, p2, (0.16, 0.42, 0.72)),):
        dx, dz = b[0] - a[0], b[2] - a[2]
        length = hypot(dx, dz)
        perpendicular = (-dz / length, dx / length)
        for t in fractions:
            point = _segment_point(a, b, t)
            pair = []
            for side in (-1, 1):
                pair.append((point[0] + side * perpendicular[0] * 11.5,
                             point[2] + side * perpendicular[1] * 11.5))
            offsets.extend(pair)
            # High crossbeams tie each pair to the overhead pier, 11.5 units off the lane axis.
            _map_beam(canvas, L.WOOD, (pair[0][0], h["pier_deck_y"] - 1.0, pair[0][1]),
                      (pair[1][0], h["pier_deck_y"] - 1.0, pair[1][1]), 0.55, 0.7)
    for index, (x, z) in enumerate(offsets):
        # The authored anchor follows the pier deck; the chain's collision remains outside the
        # corridor even where it crosses the checkpoint height.
        top_y, bottom_y = h["pier_deck_y"] - 2.0, h["chain_bottom_y"]
        link = 3.5
        previous = (x, top_y, z)
        step = 0
        while previous[1] > bottom_y:
            next_y = max(bottom_y, previous[1] - link)
            bend = 0.25 if step % 2 else -0.25
            current = (x + bend, next_y, z)
            _map_beam(canvas, L.IRON, previous, current, 0.26, 0.34)
            previous = current
            step += 1
        canvas.frustum(L.BRASS, L.bl(x, bottom_y - 1.0, z), 0.65, 0.35, 2.0,
                       sides=8, decorative=True)

    # Finish arch: inner radius 12, tube radius 2, so the nearest arch surface remains outside
    # the FINISH ring's radius + 3. The normal follows the authored finish direction.
    add_arch_ring(canvas, L.BRASS, h["gate"], L.FINISH[4][::2],
                  radius=h["gate_inner_radius"] + h["gate_ring_width"] / 2.0,
                  tube_radius=h["gate_ring_width"] / 2.0, major_segments=40,
                  minor_segments=8)
    forward_x, _forward_y, forward_z = L.FINISH[4]
    lateral_x, lateral_z = -forward_z, forward_x
    for side in (-1, 1):
        foot = (h["gate"][0] + side * lateral_x * 14.5, 38.0,
                h["gate"][2] + side * lateral_z * 14.5)
        crown = (h["gate"][0] + side * lateral_x * 14.5, 43.0,
                 h["gate"][2] + side * lateral_z * 14.5)
        _map_beam(canvas, L.STONE, foot, crown, 2.0, 2.0)
        canvas.frustum(L.BRASS, L.bl(*crown), 1.7, 0.8, 2.0,
                       sides=8, decorative=True)
