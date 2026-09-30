"""Orbital Shipyard: the five animated setpieces (one clip each, moving collision).

Every builder works in the shared map frame from orbital_shipyard_layout.py: positions that do not
move (mast, door frame, ram housings) are written straight into a Canvas with layout.bl(x, y, z).
Anything that moves gets a rig (an Empty) placed with layout.bl(...) once, and the geometry hung
off it is authored in the rig's own local axes -- which, because bl() only flips signs and never
rotates, line up one-to-one with the rig's Blender axes: local X is map x (east), local Z is map y
(up), local Y is map -z (so +z, "south", is -Y locally). Only the rig's keyframes move; the local
shapes stay fixed, exactly like the Eiffel Tower setpieces this toolkit was built for.

All loops are LINEAR-interpolated and close on themselves (last frame pose == first frame pose):
scene.frame_start and scene.frame_end are the two ends export_setpiece hands in, so every keyframe
list below runs frame_start -> ... -> frame_end with the same pose at both ends.
"""

from math import cos, pi, radians, sin

import generate_eiffel_tower_assets as et
import orbital_shipyard_layout as layout

Canvas = et.Canvas
rig = et.rig
keyframe = et.keyframe
bl = layout.bl

HULL_PLATE = layout.HULL_PLATE
HULL_DARK = layout.HULL_DARK
TRUSS = layout.TRUSS
DECK = layout.DECK
HAZARD = layout.HAZARD
PIPE = layout.PIPE
GLOW_CYAN = layout.GLOW_CYAN
GLOW_AMBER = layout.GLOW_AMBER
GLOW_RED = layout.GLOW_RED
WINDOW = layout.WINDOW


def _lerp(a, b, t):
    return a + (b - a) * t


def _pulse(t, phase, loop_frames, rise_start, rise_len, high_len, fall_len):
    """A 0 -> 1 -> 0 ramp/hold/ramp/hold cycle, looping every loop_frames, shifted by phase.

    Shared by the airlock doors (open/closed) and the fuel pistons (retracted/extended): both are
    "wait, move, wait, move back" cycles, just with different timings and phase offsets.
    """
    local = (t - phase) % loop_frames
    if local < rise_start:
        return 0.0
    local -= rise_start
    if local < rise_len:
        return local / rise_len
    local -= rise_len
    if local < high_len:
        return 1.0
    local -= high_len
    if local < fall_len:
        return 1.0 - local / fall_len
    return 0.0


def _pulse_keyframe_times(phase, loop_frames, rise_start, rise_len, high_len, fall_len):
    """Every frame offset (0..loop_frames) where the pulse's slope changes, plus both ends.

    Keyframing exactly at these kinks reproduces the piecewise-linear pulse with Blender's own
    LINEAR interpolation between them -- no extra sampling needed, and it is robust to any phase.
    """
    kinks = (
        rise_start,
        rise_start + rise_len,
        rise_start + rise_len + high_len,
        rise_start + rise_len + high_len + fall_len,
    )
    return sorted({0, loop_frames, *((k + phase) % loop_frames for k in kinks)})


def build_crane_sweep(scene, _mats):
    """Tower crane over the scaffold yard: a slewing jib swings a hoisted container once a loop.

    The mast is static lattice -- it never moves, so it collides like any other fixed structure.
    Only the head turns: jib, counter-jib, cab and cable are one rigid assembly rotating a full
    turn about the mast axis, with the load riding a trolley that also drifts in and out along the
    jib so it is never at a fixed radius. That is the moving collider a player has to dodge.
    """
    cx = layout.CRANE["x"]
    cz = layout.CRANE["z"]
    mast_top = layout.CRANE["mast_top_y"]
    jib_y = layout.CRANE["jib_y"]
    jib_length = layout.CRANE["jib_length"]
    counter_length = layout.CRANE["counter_jib_length"]

    # --- Static mast: a slim lattice tower, kept inside the CRANE section's 4.5-unit radius ---
    half = 2.9
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    base_y = 3.0
    bays = 10
    mast = Canvas()
    for bay in range(bays):
        low = _lerp(base_y, mast_top, bay / bays)
        high = _lerp(base_y, mast_top, (bay + 1) / bays)
        lower = [bl(cx + sx * half, low, cz + sy * half) for sx, sy in corners]
        upper = [bl(cx + sx * half, high, cz + sy * half) for sx, sy in corners]
        for index in range(4):
            following = (index + 1) % 4
            mast.beam(TRUSS, lower[index], upper[index], 0.55)
            mast.beam(TRUSS, lower[index], lower[following], 0.4)
            mast.beam(HULL_DARK, lower[index], upper[following], 0.28)
            mast.beam(HULL_DARK, lower[following], upper[index], 0.28)
    top_corners = [bl(cx + sx * half, mast_top, cz + sy * half) for sx, sy in corners]
    for index in range(4):
        mast.beam(TRUSS, top_corners[index], top_corners[(index + 1) % 4], 0.5)
    mast.emit("crane_mast")

    # --- Rotating head: jib, counter-jib with counterweight, and the operator cab ---
    slew = rig("CraneSlewRig", bl(cx, jib_y, cz))
    head = Canvas()
    head.box(TRUSS, (0, jib_length / 2, 0.6), (1.3, jib_length, 1.3))
    head.box(TRUSS, (0, -counter_length / 2, 0.6), (1.3, counter_length, 1.3))
    head.box(HULL_DARK, (0, -counter_length + 1.5, 0.6), (3.4, 3.4, 2.6))  # counterweight
    head.box(HULL_PLATE, (0, -2.5, -1.6), (3.2, 5.0, 3.0))  # cab
    head.box(WINDOW, (0, -1.0, -1.0), (3.4, 2.2, 1.4), decorative=True)
    head.box(GLOW_RED, (0, jib_length - 1.0, 1.4), (0.8, 0.8, 0.8), decorative=True)  # tip light
    head.emit("crane_head", parent=slew)

    first, last = scene.frame_start, scene.frame_end
    keyframe(slew, first, rotation=(0, 0, 0))
    keyframe(slew, last, rotation=(0, 0, 2 * pi))

    # --- Hoist: a trolley that drifts along the jib while the whole head turns underneath it ---
    load = rig("CraneLoadRig", (0, 35.0, -22.0))
    load.parent = slew
    hook = Canvas()
    hook.beam(PIPE, (0, 0, 6.5), (0, 0, 0), 0.35)
    hook.box(HAZARD, (0, 0, -1.5), (4.2, 4.2, 3.6))
    hook.box(GLOW_AMBER, (0, 0, -3.1), (1.0, 1.0, 0.6), decorative=True)
    hook.emit("crane_load", parent=load)

    steps = 4
    for index in range(steps + 1):
        frac = index / steps
        radius = 35.0 + 5.0 * sin(2 * pi * frac)
        sway = 3.0 * sin(4 * pi * frac)
        # Base raised from -22 so the load's hazard box (bottom 3.3 below the rig, jib_y=72)
        # never dips under map y 57.5 -- the scaffold towers below reach up to y 55.
        drop = -8.0 + 3.0 * sin(2 * pi * frac)
        frame = round(_lerp(first, last, frac))
        keyframe(load, frame, location=(sway, radius, drop))


def build_weld_gantry(scene, _mats):
    """Welding gantry portal that rides the length of the hull rib cage and back.

    The frame is a truss arch that hugs the inside of the hull tube between radius 22 and 27.5, so
    the radius-20 channel down the middle stays clear; only the welding head, hanging from the
    crossbeam at the top, dips down into that channel to head_bottom_y and never lower.
    """
    axis_x = layout.HULL["axis_x"]
    axis_y = layout.HULL["axis_y"]
    z_front = layout.GANTRY["z_front"]
    z_back = layout.GANTRY["z_back"]
    head_bottom_y = layout.GANTRY["head_bottom_y"]

    carriage = rig("GantryCarriage", bl(axis_x, axis_y, z_front))
    frame = Canvas()

    inner_r, outer_r = 22.0, 27.5
    start_deg, end_deg = -150.0, 150.0  # a 60-degree gap at the bottom, clear of the keel below
    segments = 18
    thetas = [radians(_lerp(start_deg, end_deg, i / segments)) for i in range(segments + 1)]
    inner_pts = [(inner_r * sin(t), 0.0, inner_r * cos(t)) for t in thetas]
    outer_pts = [(outer_r * sin(t), 0.0, outer_r * cos(t)) for t in thetas]
    for index in range(segments + 1):
        frame.beam(TRUSS, inner_pts[index], outer_pts[index], 0.5)
    for index in range(segments):
        frame.beam(TRUSS, inner_pts[index], inner_pts[index + 1], 0.45)
        frame.beam(HULL_DARK, outer_pts[index], outer_pts[index + 1], 0.55)
        frame.beam(HAZARD, inner_pts[index], outer_pts[index + 1], 0.2)

    # The welding head hangs from the crossbeam centre (theta = 0, straight up) down into the
    # flight channel, its underside sitting exactly on head_bottom_y and never past it.
    head_top_z = inner_r
    head_bottom_z = head_bottom_y - axis_y
    frame.beam(PIPE, (0, 0, head_top_z), (0, 0, head_bottom_z + 1.0), 0.45)
    frame.box(HULL_DARK, (0, 0, head_bottom_z + 1.0), (3.0, 2.6, 2.0))
    for angle in (0.0, 2 * pi / 3, 4 * pi / 3):
        arm = (0.9 * cos(angle), 0.9 * sin(angle) * 0.4, head_bottom_z + 0.3)
        frame.box(GLOW_CYAN, arm, (0.6, 0.6, 0.6), decorative=True)
    frame.box(GLOW_AMBER, (0, 0, head_bottom_z + 1.0), (3.4, 3.0, 0.3), decorative=True)
    frame.emit("weld_gantry", parent=carriage)

    first, last = scene.frame_start, scene.frame_end
    fronts = (0.0, 0.08, 0.42, 0.50, 0.92, 1.0)
    z_values = (z_front, z_front, z_back, z_back, z_front, z_front)
    for frac, z_value in zip(fronts, z_values):
        frame_no = round(_lerp(first, last, frac))
        keyframe(carriage, frame_no, location=bl(axis_x, axis_y, z_value))


def build_airlock_doors(scene, _mats):
    """Three timed sliding bulkhead doors, each opening as a travelling wave after the last.

    Every door is two leaves that meet at the hall centreline and slide sideways into pocket
    housings outside the hall walls. Door k opens 2 s after door 1, so a pilot who threads door 1
    at speed can ride the same wave through doors 2 and 3.
    """
    a = layout.AIRLOCK
    z_min, z_max = a["z_min"], a["z_max"]
    floor_y, ceiling_y = a["floor_y"], a["ceiling_y"]
    doors_x = a["doors_x"]
    slot_half = a["door_slot_half_width"]

    z_center = (z_min + z_max) / 2
    half_width = (z_max - z_min) / 2
    leaf_h = ceiling_y - floor_y - 0.4  # 0.2 clearance from both the floor and roof slabs
    mid_y = (floor_y + ceiling_y) / 2
    leaf_thickness = 1.6

    loop_frames = scene.frame_end - scene.frame_start
    rise_start, rise_len, high_len, fall_len = 0, 30, 150, 30

    static = Canvas()
    span_z = (z_max - z_min) + 4
    for dx in doors_x:
        # Lintel and sill: the visible frame the leaves ride between, held to the door's slot.
        static.box(HULL_DARK, bl(dx, ceiling_y + 0.6, z_center),
                   (slot_half * 2 - 0.2, span_z, 1.2))
        static.box(HULL_DARK, bl(dx, floor_y - 0.6, z_center),
                   (slot_half * 2 - 0.2, span_z, 1.2))
        # Pocket housings the open leaves tuck into, outside the hall on both sides.
        for sign in (-1, 1):
            pocket_z = z_center + sign * (half_width + a["door_pocket_reach"] / 2)
            static.box(HULL_PLATE, bl(dx, mid_y, pocket_z),
                       (slot_half * 2 + 1.0, a["door_pocket_reach"], leaf_h + 2))
        static.box(GLOW_RED, bl(dx, ceiling_y - 0.4, z_center - half_width - 1.0), (0.9, 0.9, 0.9),
                   decorative=True)
        static.box(GLOW_AMBER, bl(dx, ceiling_y - 0.4, z_center + half_width + 1.0),
                   (0.9, 0.9, 0.9), decorative=True)
    static.emit("airlock_frames")

    for door_index, dx in enumerate(doors_x):
        phase = door_index * 60  # each door follows the one before it by 2 s (60 frames @ 30fps)
        times = _pulse_keyframe_times(phase, loop_frames, rise_start, rise_len, high_len, fall_len)
        for side, sign in (("west", -1), ("east", 1)):
            closed_z = z_center + sign * half_width / 2
            open_z = z_center + sign * (half_width + a["door_pocket_reach"] / 2)
            leaf = rig(f"AirlockDoor{door_index}{side.capitalize()}",
                       bl(dx, mid_y, closed_z))
            panel = Canvas()
            panel.box(HAZARD, (0, 0, 0), (leaf_thickness, half_width, leaf_h))
            panel.emit(f"airlock_leaf_{door_index}_{side}", parent=leaf)
            for t in times:
                fraction = _pulse(t, phase, loop_frames, rise_start, rise_len, high_len, fall_len)
                z_value = _lerp(closed_z, open_z, fraction)
                keyframe(leaf, scene.frame_start + t, location=bl(dx, mid_y, z_value))


def build_tower_rotor(scene, _mats):
    """A hub-and-arm rotor spinning flat around the drydock tower's vertical axis.

    It stays inside a thin horizontal band (rotor.y +/- 4) around the tower, so it only ever
    threatens a player mid-climb through that band -- the corridor crossing the design calls for --
    while the checkpoint centres above and below it are never in reach.
    """
    tower_x = layout.TOWER["x"]
    tower_z = layout.TOWER["z"]
    rotor_y = layout.ROTOR["y"]
    inner_r = 15.5
    hub_r = layout.ROTOR["hub_radius"]
    tip_r = layout.ROTOR["tip_radius"]
    arm_count = layout.ROTOR["arms"]
    thickness = layout.ROTOR["arm_thickness"]

    hub = rig("RotorHub", bl(tower_x, rotor_y, tower_z))
    canvas = Canvas()

    hub_mid_r = (inner_r + hub_r) / 2
    hub_band = hub_r - inner_r
    hub_segments = 16
    for index in range(hub_segments):
        theta = 2 * pi * index / hub_segments
        center = (hub_mid_r * cos(theta), hub_mid_r * sin(theta), 0.0)
        tangential_len = (2 * pi * hub_mid_r / hub_segments) * 1.12
        canvas.box(TRUSS, center, (tangential_len, hub_band, thickness),
                   rotation=(0, 0, theta + pi / 2))

    arm_mid_r = (hub_r + tip_r) / 2
    arm_len = tip_r - hub_r
    for index in range(arm_count):
        angle = 2 * pi * index / arm_count
        center = (arm_mid_r * cos(angle), arm_mid_r * sin(angle), 0.0)
        canvas.box(TRUSS, center, (arm_len, thickness, thickness), rotation=(0, 0, angle))
        tip = ((tip_r - 1.6) * cos(angle), (tip_r - 1.6) * sin(angle), 0.0)
        canvas.box(GLOW_RED, tip, (1.6, 1.6, 1.6), decorative=True)
        stripe = ((hub_r + arm_len * 0.5) * cos(angle), (hub_r + arm_len * 0.5) * sin(angle), 0.0)
        canvas.box(HAZARD, stripe, (arm_len * 0.3, thickness + 0.3, thickness * 0.4),
                   rotation=(0, 0, angle), decorative=True)
    canvas.emit("tower_rotor", parent=hub)

    keyframe(hub, scene.frame_start, rotation=(0, 0, 0))
    keyframe(hub, scene.frame_end, rotation=(0, 0, 2 * pi))


def build_fuel_pistons(scene, _mats):
    """Three stations of paired hydraulic rams that push across the fuel canyon and retract.

    Each station has a ram from the north wall in the upper half of the canyon and one from the
    south wall in the lower half; the two are phase-offset so one is retreating while the other
    advances, and no ram ever closes past min_gap, so its own band always has room to fly through.
    """
    p = layout.PISTONS
    c = layout.CANYON
    width_x = p["width_x"]
    min_gap = p["min_gap"]
    z_min, z_max = c["z_min"], c["z_max"]
    canyon_width = z_max - z_min
    max_extend = canyon_width - min_gap
    rod_length = 24.0

    loop_frames = scene.frame_end - scene.frame_start
    rise_start, rise_len, high_len, fall_len = 0, 40, 60, 40

    bands = {
        "north": dict(y=(34.0 + 58.0) / 2, height=14.0, wall_z=z_min, direction=1),
        "south": dict(y=(12.0 + 34.0) / 2, height=14.0, wall_z=z_max, direction=-1),
    }

    static = Canvas()
    for station_x in p["x"]:
        for band in bands.values():
            housing_z = band["wall_z"] - band["direction"] * rod_length / 2
            static.box(HULL_DARK, bl(station_x, band["y"], housing_z),
                       (width_x + 1.5, rod_length, band["height"] + 4.0))
    static.emit("piston_housings")

    for station_index, station_x in enumerate(p["x"]):
        station_phase = station_index * (loop_frames / 3)
        for band_name, band in bands.items():
            phase = station_phase if band_name == "north" else station_phase + loop_frames / 2
            phase = phase % loop_frames
            times = _pulse_keyframe_times(phase, loop_frames, rise_start, rise_len, high_len,
                                           fall_len)
            retracted_z = band["wall_z"] - band["direction"] * rod_length / 2
            ram = rig(f"FuelPiston{station_index}{band_name.capitalize()}",
                      bl(station_x, band["y"], retracted_z))
            rod = Canvas()
            rod.box(HAZARD, (0, 0, 0), (width_x, rod_length, band["height"]))
            tip_local_y = -band["direction"] * rod_length / 2
            rod.box(GLOW_RED, (0, tip_local_y, 0), (width_x - 1.0, 1.0, band["height"] - 2.0),
                    decorative=True)
            rod.emit(f"fuel_piston_rod_{station_index}_{band_name}", parent=ram)
            for t in times:
                fraction = _pulse(t, phase, loop_frames, rise_start, rise_len, high_len, fall_len)
                z_value = band["wall_z"] + band["direction"] * (max_extend * fraction
                                                                  - rod_length / 2)
                keyframe(ram, scene.frame_start + t, location=bl(station_x, band["y"], z_value))
