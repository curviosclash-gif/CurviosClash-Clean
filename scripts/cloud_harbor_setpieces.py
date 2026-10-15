"""Cloud Harbor (Wolkenhafen): the five animated setpieces (one clip each, moving collision).

Same scheme as orbital_shipyard_setpieces.py: everything is authored in the shared map frame of
cloud_harbor_layout.py. A moving part gets a rig (an Empty) placed once with L.bl(x, y, z); its
geometry is authored in the rig's local axes, which -- because bl() only flips signs -- are the
rig's Blender axes: local X = map x (east), local Z = map y (up), local Y = map -z (north). Only
the rigs carry keyframes.

Every loop is LINEAR-interpolated and closes on itself: the pose at scene.frame_end equals the pose
at scene.frame_start, so the runtime can loop the single clip without a jump.
"""

from math import cos, pi, radians, sin

from mathutils import Euler, Matrix, Vector

import generate_eiffel_tower_assets as et
import cloud_harbor_layout as L

Canvas = et.Canvas
rig = et.rig
keyframe = et.keyframe
bl = L.bl


# --- Shape helpers (raw verts/faces into a Canvas bucket, like Canvas.box) -----------------------


def _obox(canvas, material, center, u, v, w, size, decorative=False):
    """A box whose local x/y/z edges run along the unit vectors u/v/w."""
    sx, sy, sz = size
    matrix = Matrix((
        (u[0] * sx, v[0] * sy, w[0] * sz, center[0]),
        (u[1] * sx, v[1] * sy, w[1] * sz, center[1]),
        (u[2] * sx, v[2] * sy, w[2] * sz, center[2]),
        (0.0, 0.0, 0.0, 1.0),
    ))
    canvas._add(material, decorative, et.CUBE_VERTS, et.CUBE_FACES, matrix)


def _torus(canvas, material, matrix, radius, tube, major=56, minor=8):
    """A closed torus in the local XY plane (one closed shell for the parity collider)."""
    verts, faces = [], []
    for i in range(major):
        u = 2 * pi * i / major
        for j in range(minor):
            v = 2 * pi * j / minor
            ring = radius + tube * cos(v)
            verts.append((ring * cos(u), ring * sin(u), tube * sin(v)))
    for i in range(major):
        for j in range(minor):
            a, b = i * minor + j, ((i + 1) % major) * minor + j
            faces.append((a, b, ((i + 1) % major) * minor + (j + 1) % minor,
                          i * minor + (j + 1) % minor))
    canvas._add(material, False, verts, faces, matrix)


def _lathe(canvas, material, profile, sides=16):
    """A closed body of revolution around local Y; profile = [(y, r)], poles at both ends."""
    rings = profile[1:-1]
    verts = [(0.0, profile[0][0], 0.0)]
    for y, r in rings:
        for j in range(sides):
            a = 2 * pi * j / sides
            verts.append((r * cos(a), y, r * sin(a)))
    verts.append((0.0, profile[-1][0], 0.0))
    tip = len(verts) - 1
    faces = [(0, 1 + j, 1 + (j + 1) % sides) for j in range(sides)]
    for k in range(len(rings) - 1):
        for j in range(sides):
            a = 1 + k * sides + j
            b = 1 + (k + 1) * sides + j
            faces.append((a, b, 1 + (k + 1) * sides + (j + 1) % sides,
                          1 + k * sides + (j + 1) % sides))
    last = 1 + (len(rings) - 1) * sides
    faces += [(tip, last + (j + 1) % sides, last + j) for j in range(sides)]
    canvas._add(material, False, verts, faces, Matrix.Identity(4))


def _frames(scene, seconds):
    return round(seconds * (scene.frame_end - scene.frame_start)
                 / scene["loop_duration_seconds"])


# --- 10 Cargo nets ------------------------------------------------------------------------------


def build_cargo_nets(scene, _mats):
    """Two netted crates swinging across the cargo-bay tunnel on chains, in counter-phase.

    Pivot 13.5 above the zeppelin axis, crate centre 17 below the pivot: at the full 25 degrees the
    farthest crate corner is 11 from the axis, well inside the hull collider (14.5).
    """
    n = L.CARGO_NETS
    half = n["bundle_size"] / 2
    crate_z = -(n["pivot_y"] - n["net_bottom_y"]) + half  # crate centre below the pivot
    chain_end = crate_z + half + 0.9
    first, last = scene.frame_start, scene.frame_end
    for index, x in enumerate(n["x"]):
        pivot = rig(f"CargoNetPivot{index}", bl(x, n["pivot_y"], L.CARGO_ZEPPELIN["z"]))
        c = Canvas()
        c.box(L.IRON, (0, 0, -0.1), (1.4, 1.0, 0.7), decorative=True)  # shackle under the rail
        z, link = -0.45, 0
        while z > chain_end:
            size = (0.22, 0.6, 0.95) if link % 2 else (0.6, 0.22, 0.95)
            c.box(L.IRON, (0, 0, z - 0.4), size, decorative=True)
            z -= 0.8
            link += 1
        c.box(L.BRASS, (0, 0, chain_end - 0.2), (1.0, 1.0, 0.5), decorative=True)  # hook
        top = crate_z + half
        for sx in (-1, 1):
            for sy in (-1, 1):
                c.beam(L.IRON, (0, 0, chain_end - 0.3), (sx * (half - 0.4), sy * (half - 0.4), top),
                       0.16, decorative=True)
        c.box(L.WOOD, (0, 0, crate_z), (2 * half, 2 * half, 2 * half))  # the moving collider
        rope, out = 0.18, half + 0.1
        for offset in (-half * 0.55, 0.0, half * 0.55):  # net loops around the crate
            for side in (-1, 1):  # vertical strands: loops in the x = offset and y = offset planes
                for pos in ((offset, side * out), (side * out, offset)):
                    c.box(L.ENVELOPE_DARK, (*pos, crate_z), (rope, rope, 2 * out),
                          decorative=True)
            for level in (top + 0.1, crate_z - half - 0.1):
                c.box(L.ENVELOPE_DARK, (offset, 0, level), (rope, 2 * out, rope), decorative=True)
                c.box(L.ENVELOPE_DARK, (0, offset, level), (2 * out, rope, rope), decorative=True)
        c.box(L.GLOW_WARM, (0, 0, crate_z - half - 0.35), (0.7, 0.7, 0.5), decorative=True)
        c.emit(f"cargo_net_{index}", parent=pivot)

        sign = 1 if index == 0 else -1
        step = 5
        for frame in range(first, last + 1, step):
            angle = sign * radians(n["swing_degrees"]) * sin(2 * pi * (frame - first)
                                                              / (last - first))
            keyframe(pivot, frame, rotation=(angle, 0, 0))
        if (last - first) % step:
            keyframe(pivot, last, rotation=(0, 0, 0))


# --- 11 Windmill rotors -------------------------------------------------------------------------


def _rotor(canvas, mill, p, q, w, upstream):
    """Hub and sail blades in the rotor plane spanned by p and q; w is the shaft (downstream)."""
    tip, hub_r, chord = mill["tip_radius"], mill["hub_radius"], mill["blade_chord"]
    up = Vector(w) * upstream
    canvas.frustum(L.BRASS, tuple(up * 0.3), hub_r, hub_r, 3.0, sides=12,
                   rotation=tuple(Vector((0, 0, 1)).rotation_difference(Vector(w)).to_euler()))
    canvas.frustum(L.BRASS, tuple(up * 3.2), hub_r * 0.9, 0.6, 2.8, sides=12,
                   rotation=tuple(Vector((0, 0, 1)).rotation_difference(up).to_euler()))
    for k in range(mill["blades"]):
        theta = pi / 4 + 2 * pi * k / mill["blades"]
        d = Vector(p) * cos(theta) + Vector(q) * sin(theta)
        t = Vector(p) * -sin(theta) + Vector(q) * cos(theta)
        _obox(canvas, L.WOOD, d * (tip + 1.0) / 2, d, t, w, (tip - 1.0, 1.0, 1.0))
        sail_in, red_from = hub_r + 3.0, tip - 5.5
        lateral = t * (chord / 2 - 0.4)
        face = up * 0.75
        for material, r0, r1 in ((L.ENVELOPE, sail_in, red_from), (L.CANVAS_RED, red_from, tip)):
            _obox(canvas, material, d * (r0 + r1) / 2 + lateral + face, d, t, w,
                  (r1 - r0, chord, 0.4))
        for r in range(int(sail_in) + 2, int(tip), 3):
            _obox(canvas, L.WOOD, d * r + lateral + up * 1.05, d, t, w, (0.3, chord + 0.2, 0.3),
                  decorative=True)
        _obox(canvas, L.WOOD, d * (sail_in + tip) / 2 + lateral + t * (chord / 2) + up * 1.05,
              d, t, w, (tip - sail_in, 0.3, 0.3), decorative=True)


def build_windmill_rotors(scene, _mats):
    """Both windmill rotors: four sail blades each, a quarter turn per 4 s beat, 1 turn a loop.

    The blades start in an X so the rings straight above each hub (CP05, CP06) are open at frame 0;
    the two mills turn in opposite senses.
    """
    for index, mill in enumerate(L.WINDMILLS):
        hub = rig(f"WindmillRotor{index}", bl(*mill["hub"]))
        if mill["axis"] == "x":
            w, p, q = (1, 0, 0), (0, 1, 0), (0, 0, 1)
            axis_slot = 0
        else:
            w, p, q = (0, 1, 0), (1, 0, 0), (0, 0, 1)  # map -z is Blender +Y
            axis_slot = 1
        downstream = Vector(bl(*mill["downstream"]))
        c = Canvas()
        _rotor(c, mill, p, q, w, upstream=-1 if downstream.dot(Vector(w)) > 0 else 1)
        c.emit(f"windmill_rotor_{index}", parent=hub)
        turn = [0.0, 0.0, 0.0]
        keyframe(hub, scene.frame_start, rotation=tuple(turn))
        turn[axis_slot] = 2 * pi * (1 if index == 0 else -1)
        keyframe(hub, scene.frame_end, rotation=tuple(turn))


# --- 12 Gyro rings ------------------------------------------------------------------------------


def build_gyro_rings(scene, _mats):
    """Two brass rings tilted around the weather tower, precessing about the vertical tower axis
    in opposite senses. The tilt keeps every ring point at least R*cos(tilt) - tube from the axis
    (22.8 and 27.0), clear of the tower (radius 13)."""
    g = L.GYRO_RINGS
    for index, (radius, tilt) in enumerate(zip(g["radius"], (20.0, 30.0))):
        spin = rig(f"GyroRing{index}", bl(*g["center"]))
        tilt_matrix = Euler((radians(tilt), 0.0, radians(37.0 * index)), "XYZ").to_matrix()
        c = Canvas()
        _torus(c, L.BRASS, tilt_matrix.to_4x4(), radius, g["tube_radius"])
        for k in range(8):
            a = 2 * pi * (k + 0.5) / 8
            radial = Vector((cos(a), sin(a), 0.0))
            tangent = Vector((-sin(a), cos(a), 0.0))
            normal = Vector((0.0, 0.0, 1.0))
            material = L.GLOW_TEAL if k % 2 == 0 else L.IRON
            _obox(c, material, tilt_matrix @ (radial * radius), tilt_matrix @ tangent,
                  tilt_matrix @ radial, tilt_matrix @ normal,
                  (1.4, 2 * g["tube_radius"] + 0.5, 2 * g["tube_radius"] + 0.5), decorative=True)
        c.emit(f"gyro_ring_{index}", parent=spin)
        keyframe(spin, scene.frame_start, rotation=(0, 0, 0))
        keyframe(spin, scene.frame_end, rotation=(0, 0, 2 * pi * (1 if index == 0 else -1)))


# --- 13 Cable cars ------------------------------------------------------------------------------


def _gondola(canvas, size, hang):
    """Grip on the cable at the rig origin, hanger, and the cabin whose top is `hang` below."""
    length, height, width = size
    canvas.box(L.IRON, (0, 0, 0.9), (3.2, 0.9, 1.2), decorative=True)  # grip top 1.5 above cable
    for sx in (-1, 1):
        canvas.box(L.IRON, (sx * 1.1, 0, 0.25), (1.0, 0.5, 1.0), decorative=True)
    canvas.beam(L.IRON, (0, 0, 0.3), (0, 0, -hang - 0.2), 0.4, decorative=True)
    canvas.box(L.BRASS, (0, 0, -hang - 0.3), (length + 0.6, width + 0.6, 0.6))
    canvas.box(L.CANVAS_RED, (0, 0, -hang - 0.6 - (height - 0.8) / 2),
               (length, width, height - 0.8))
    canvas.box(L.WOOD, (0, 0, -hang - height + 0.1), (length + 0.2, width + 0.2, 0.4))
    window_z = -hang - 0.6 - (height - 0.8) * 0.35
    canvas.box(L.ENVELOPE_DARK, (0, 0, window_z), (length - 1.0, width + 0.1, 1.4),
               decorative=True)
    canvas.box(L.ENVELOPE_DARK, (0, 0, window_z), (length + 0.1, width - 1.0, 1.4),
               decorative=True)


def build_cable_cars(scene, _mats):
    """Three gondolas on each cable, the two cables running opposite ways between the stations.

    Each gondola rides the straight cable from just outside one station door to just outside the
    other (its cabin never crosses a door plane), shrinks to scale 0 in 0.3 s at the arrival door,
    jumps back while invisible and grows again at the departure door. LINEAR keys are exact here
    because the cable is a straight line.
    """
    w = L.CABLEWAY
    cars = L.CABLE_CARS
    length = cars["cabin_size"][0]
    door_east = w["mountain_station"][0] - w["station_size"][0] / 2
    door_west = w["valley_station"][0] + w["station_size"][0] / 2
    east_x = door_east - length / 2 - 0.5
    west_x = door_west + length / 2 + 0.5
    first, last = scene.frame_start, scene.frame_end
    cycle = last - first  # one gondola round per loop
    travel = cycle - 1  # the last frame is the invisible jump back to the start door
    fade = _frames(scene, 0.3)
    count = cars["count_per_cable"]

    for lane, z_cable, start_x, end_x in (
        (0, w["cable_z"] + w["cable_offset"], east_x, west_x),  # south cable runs downhill
        (1, w["cable_z"] - w["cable_offset"], west_x, east_x),  # north cable runs uphill
    ):
        for k in range(count):
            car = rig(f"CableCar{lane}{k}", bl(start_x, L.cable_y(start_x), z_cable))
            c = Canvas()
            _gondola(c, cars["cabin_size"], cars["hang_depth"])
            c.emit(f"cable_car_{lane}_{k}", parent=car)
            phase = round(cycle * (1 + 2 * k) / (2 * count))  # never mid-fade at frame 0

            def pose(tau, start_x=start_x, end_x=end_x, z_cable=z_cable):
                x = start_x + (end_x - start_x) * tau / travel
                # 1e-3, not 0: a zero-scale parent makes the exporter bake every child too.
                s = max(1e-3, min(1.0, tau / fade, (travel - tau) / fade))
                return bl(x, L.cable_y(x), z_cable), (s, s, s)

            frames = {first, last}
            for tau in (0, fade, travel - fade, travel):
                frames.add(first + (tau - phase) % cycle)
            for frame in sorted(frames):
                location, scale = pose((frame - first + phase) % cycle)
                keyframe(car, frame, location=location, scale=scale)


# --- 14 Patrol zeppelin -------------------------------------------------------------------------


def _hull_radius(y, half, radius):
    t = min(1.0, abs(y) / half)
    return radius * (1.0 - t * t) ** (0.5 if y > 0 else 0.8)


def build_patrol_zeppelin(scene, _mats):
    """A small red patrol airship shuttling between path_a and path_b, turning 180 degrees at
    each end (always the same way round, so the yaw closes the loop at 360 degrees).

    The farthest point from the hull centre (a tail fin tip) is 16.8 away, so turning on the spot
    keeps the whole sweep inside PATROL_KEEP_OUT (half-width 18 in x)."""
    p = L.PATROL_ZEPPELIN
    half, radius = p["length"] / 2, p["radius"]
    ship = rig("PatrolZeppelin", bl(*p["path_a"]))
    c = Canvas()
    stations = [-half + p["length"] * i / 14 for i in range(15)]
    _lathe(c, L.CANVAS_RED, [(y, _hull_radius(y, half, radius)) for y in stations], sides=16)
    for y in (-6.0, 1.5, 8.0):  # cream bands, decoration only
        r = _hull_radius(y, half, radius) + 0.12
        c.frustum(L.ENVELOPE, (0, y, 0), r, r, 1.4, sides=16, rotation=(pi / 2, 0, 0),
                  decorative=True)
    for a in (0.0, pi / 2, pi, 3 * pi / 2):  # cruciform tail fins
        radial = Vector((cos(a), 0.0, sin(a)))
        _obox(c, L.ENVELOPE_DARK, radial * 5.25 + Vector((0, -11.8, 0)), radial,
              Vector((0, 1, 0)), Vector((-sin(a), 0.0, cos(a))), (6.5, 5.4, 0.45))
    c.box(L.WOOD, (0, 1.0, -radius - 1.0), (3.0, 8.0, 2.8))
    c.box(L.GLOW_WARM, (0, 1.0, -radius - 0.7), (3.1, 6.0, 0.8), decorative=True)
    c.box(L.BRASS, (0, 5.4, -radius - 0.6), (2.2, 1.0, 1.6), decorative=True)
    for sx in (-1, 1):
        c.beam(L.IRON, (0, -2.0, -radius - 0.6), (sx * 2.7, -2.0, -radius - 1.2), 0.3,
               decorative=True)
        c.frustum(L.IRON, (sx * 2.7, -2.6, -radius - 1.2), 0.6, 0.45, 2.4, sides=8,
                  rotation=(pi / 2, 0, 0), decorative=True)
    c.emit("patrol_zeppelin", parent=ship)

    first, last = scene.frame_start, scene.frame_end
    for sx in (-1, 1):
        prop = rig(f"PatrolProp{'E' if sx > 0 else 'W'}", (sx * 2.7, -4.0, -radius - 1.2))
        prop.parent = ship
        blades = Canvas()
        for a in (0.0, pi / 2):
            _obox(blades, L.BRASS, (0, 0, 0), Vector((cos(a), 0, sin(a))), Vector((0, 1, 0)),
                  Vector((-sin(a), 0, cos(a))), (3.2, 0.2, 0.45), decorative=True)
        blades.emit(f"patrol_prop_{'e' if sx > 0 else 'w'}", parent=prop)
        keyframe(prop, first, rotation=(0, 0, 0))
        keyframe(prop, last, rotation=(0, sx * 2 * pi * 20, 0))

    a, b = Vector(bl(*p["path_a"])), Vector(bl(*p["path_b"]))
    cycle = last - first
    run, turn = _frames(scene, 8), _frames(scene, 2)
    legs = ((a, b, 0.0, 0.0), (b, b, 0.0, pi), (b, a, pi, pi), (a, a, pi, 2 * pi))
    frame = first
    for (start, end, yaw0, yaw1), span in zip(legs, (run, turn, run, turn)):
        step = 10 if span == run else 6
        for i in range(0, span, step):
            s = 0.5 - 0.5 * cos(pi * i / span)
            keyframe(ship, frame + i, location=tuple(start.lerp(end, s)),
                     rotation=(0, 0, yaw0 + (yaw1 - yaw0) * s))
        frame += span
    assert frame == first + cycle, (frame, cycle)
    keyframe(ship, last, location=tuple(a), rotation=(0, 0, 2 * pi))
