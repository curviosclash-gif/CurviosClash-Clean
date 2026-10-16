"""Four animated construction hazards, each exported as its own named GLB clip."""

import math

import generate_eiffel_tower_assets as et
import skyscraper_site_layout as L


Canvas = et.Canvas
rig = et.rig
keyframe = et.keyframe


def _p(point):
    return L.bl(*point)


def _size(size):
    return (size[0], size[2], size[1])


def _box(canvas, material, center, size, decorative=False):
    canvas.box(material, _p(center), _size(size), decorative=decorative)


def _beam(canvas, material, start, end, thickness, width=None, decorative=False):
    canvas.beam(material, _p(start), _p(end), thickness, width=width, decorative=decorative)


def _local_box(canvas, material, center, size, decorative=False):
    """A map-frame box relative to a rig; bl() preserves the local axis permutation."""
    canvas.box(material, _p(center), _size(size), decorative=decorative)


def _local_beam(canvas, material, start, end, thickness, width=None, decorative=False):
    canvas.beam(material, _p(start), _p(end), thickness, width=width, decorative=decorative)


def _loop_frames(scene):
    return scene.frame_start, scene.frame_end


def build_slewing_crane(scene, _mats):
    """A tower-crane jib sweeps over the lower scaffold; hook and load share its rig."""
    c = L.SLEWING_CRANE
    x, z = c["x"], c["z"]
    static = Canvas()
    _box(static, L.CONCRETE_DARK, (x, 1.5, z), (7.0, 3.0, 7.0))
    for dx in (-1.5, 1.5):
        for dz in (-1.5, 1.5):
            _local_beam(static, L.STEEL, (x + dx, 3.0, z + dz),
                        (x + dx, c["top_y"], z + dz), 0.65)
    for y in (12.0, 24.0, 36.0, 48.0):
        _beam(static, L.STEEL_RUST, (x - 1.5, y, z - 1.5),
              (x + 1.5, y, z + 1.5), 0.35)
        _beam(static, L.STEEL_RUST, (x + 1.5, y, z - 1.5),
              (x - 1.5, y, z + 1.5), 0.35)
    static.emit("slewing_crane_mast")

    slew = rig("SlewingCraneRig", _p((x, c["jib_y"], z)))
    jib = Canvas()
    # Keep the rotating outline a small margin inside the published full-sweep bounds.
    forward = c["jib_length"] - 1.0
    counter = c["counter_jib_length"] - 0.5
    _local_beam(jib, L.CRANE_YELLOW, (-counter, 0.0, 0.0), (forward, 0.0, 0.0),
                1.25, width=1.6)
    for side_z in (-1.35, 1.35):
        _local_beam(jib, L.STEEL, (-counter, -0.7, side_z), (forward, -0.7, side_z), 0.32)
    for point_x in range(-12, 46, 8):
        _local_beam(jib, L.STEEL_RUST, (float(point_x), -0.7, -1.35),
                    (float(point_x), -0.7, 1.35), 0.3)
    for point_x in (-10.0, 15.0, 38.0):
        _local_beam(jib, L.STEEL_RUST, (point_x, 0.0, 0.0),
                    (point_x, -5.0, 0.0), 0.38)
    # A short hoist and boxed load remain inside the published part bounds through the full sweep.
    _local_beam(jib, L.STEEL, (27.0, -0.8, 0.0), (27.0, -27.0, 0.0), 0.22)
    _local_box(jib, L.HAZARD, (27.0, -29.5, 0.0), (6.0, 5.0, 6.0))
    _local_box(jib, L.NET, (27.0, -29.0, -3.1), (5.0, 3.2, 0.08), decorative=True)
    jib.emit("slewing_crane_jib_dyn", parent=slew)

    first, last = _loop_frames(scene)
    quarter = first + (last - first) // 4
    half = first + (last - first) // 2
    three_quarter = first + 3 * (last - first) // 4
    for frame, angle in ((first, 0.0), (quarter, math.pi / 2),
                         (half, math.pi), (three_quarter, 3 * math.pi / 2),
                         (last, 2 * math.pi)):
        keyframe(slew, frame, rotation=(0.0, 0.0, angle))


def build_hoist_cabin(scene, _mats):
    """A compact lift car rises inside the steel frame without filling the flight bay."""
    h = L.HOIST
    x, z = h["x"] + h["cabin_offset"][0], h["z"] + h["cabin_offset"][2]
    y_low, y_high = h["y_low"], h["y_high"]
    guide_x = x - h["cabin_size"][0] / 2 - 1.5
    cable = Canvas()
    _beam(cable, L.STEEL_RUST, (guide_x, y_low, z), (guide_x, y_high, z),
          0.24, decorative=True)
    for y in (y_low + 2.0, y_high - 2.0):
        _beam(cable, L.CRANE_YELLOW, (guide_x - 0.8, y, z), (guide_x + 0.8, y, z), 0.3,
              decorative=True)
    cable.emit("hoist_guide_cable")

    cabin = rig("HoistCabinRig", _p((x, y_low, z)))
    body = Canvas()
    width, height, depth = h["cabin_size"]
    _local_box(body, L.HAZARD, (0.0, 0.0, 0.0), (width, height, depth))
    _local_box(body, L.CONCRETE_DARK, (0.0, height / 2 - 0.35, 0.0),
               (width + 0.25, 0.7, depth + 0.25))
    for side in (-1.0, 1.0):
        _local_box(body, L.WINDOW_WARM, (side * (width / 2 + 0.06), 0.2, 0.0),
                   (0.08, 2.1, 2.8), decorative=True)
    _local_box(body, L.GLOW_RED, (0.0, -height / 2 - 0.06, 0.0),
               (2.4, 0.12, 2.4), decorative=True)
    body.emit("hoist_cabin_dyn", parent=cabin)

    first, last = _loop_frames(scene)
    middle = first + (last - first) // 2
    keyframe(cabin, first, location=_p((x, y_low, z)))
    keyframe(cabin, middle, location=_p((x, y_high, z)))
    keyframe(cabin, last, location=_p((x, y_low, z)))


def build_beam_pendulum(scene, _mats):
    """A heavy suspended beam swings across CP14 -> CP15 with a predictable looping arc."""
    p = L.BEAM_PENDULUM
    px, py, pz = p["pivot"]
    pendulum = rig("BeamPendulumRig", _p((px, py, pz)))
    geometry = Canvas()
    rope = p["rope"]
    _local_beam(geometry, L.STEEL, (0.0, 0.0, 0.0), (0.0, -rope + 1.5, 0.0), 0.38)
    _local_box(geometry, L.STEEL_RUST, (0.0, -rope + 1.5, 0.0), (p["beam_length"], 1.8, 2.0))
    for end in (-p["beam_length"] / 2 + 1.0, p["beam_length"] / 2 - 1.0):
        _local_box(geometry, L.HAZARD, (end, -rope + 1.5, 0.0), (1.0, 2.0, 2.4))
    _local_box(geometry, L.NET, (0.0, -rope + 2.6, -1.12),
               (p["beam_length"] - 2.0, 0.18, 0.08), decorative=True)
    geometry.emit("beam_pendulum_hammer_dyn", parent=pendulum)

    first, last = _loop_frames(scene)
    quarter = first + (last - first) // 4
    half = first + (last - first) // 2
    three_quarter = first + 3 * (last - first) // 4
    angle = math.radians(p["amplitude_deg"])
    # Map-X is Blender-X; the rotation preserves the authored plane and stays inside BBOX.
    for frame, value in ((first, 0.0), (quarter, angle), (half, 0.0),
                         (three_quarter, -angle), (last, 0.0)):
        keyframe(pendulum, frame, rotation=(value, 0.0, 0.0))


def build_concrete_bucket(scene, _mats):
    """A suspended formwork bucket swings in map X/Y while its rope remains collision-visible."""
    b = L.BUCKET
    px, py, pz = b["pivot"]
    bucket = rig("ConcreteBucketRig", _p((px, py, pz)))
    geometry = Canvas()
    _local_beam(geometry, L.STEEL_RUST, (0.0, 0.0, 0.0),
                (0.0, -b["rope"] + 2.0, 0.0), 0.36)
    _local_box(geometry, L.HAZARD, (0.0, -b["rope"], 0.0),
               (b["bucket_radius"] * 2.0, b["bucket_radius"] * 2.0,
                b["bucket_radius"] * 2.0))
    _local_box(geometry, L.CONCRETE_DARK, (0.0, -b["rope"] + 1.65, 0.0),
               (b["bucket_radius"] * 2.2, 0.45, b["bucket_radius"] * 2.2))
    for side in (-1.0, 1.0):
        _local_beam(geometry, L.STEEL, (side * 1.9, -b["rope"] + 3.0, 0.0),
                    (0.0, -b["rope"] + 7.0, 0.0), 0.28)
    _local_box(geometry, L.GLOW_RED,
               (0.0, -b["rope"] - b["bucket_radius"] - 0.1, 0.0),
               (0.65, 0.18, 0.65), decorative=True)
    geometry.emit("concrete_bucket_formwork_dyn", parent=bucket)

    first, last = _loop_frames(scene)
    quarter = first + (last - first) // 4
    half = first + (last - first) // 2
    three_quarter = first + 3 * (last - first) // 4
    angle = math.radians(b["amplitude_deg"])
    # Map-Z is Blender -Y. Rotating about Blender Y swings the vertical cable across map X.
    for frame, value in ((first, 0.0), (quarter, angle), (half, 0.0),
                         (three_quarter, -angle), (last, 0.0)):
        keyframe(bucket, frame, rotation=(0.0, value, 0.0))
