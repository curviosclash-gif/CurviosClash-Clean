#!/usr/bin/env python3
"""Generate the animated Kinetic Tide setpieces.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_kinetic_tide_assets.py

Every setpiece loops on a whole multiple of BEAT_SECONDS. The map places them on offset
phases of that beat, so a player who learns the rhythm can read the whole course.

Collision follows one rule, and the geometry is built around it: with the map running in
glbColliderMode 'dynamic', only meshes an animation moves get a collider. So each moving
part is a coarse, low-poly body that is cheap to collide against, and everything that only
has to look good is either a separate static mesh (no collider in dynamic mode) or carries
the _nocol suffix, which the loader excludes explicitly.
"""

from math import cos, pi, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "kinetic_tide" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "kinetic_tide" / "glb"
FPS = 30
BEAT_SECONDS = 4

# Deep machine hall: cold steel, turquoise energy, amber warnings.
STEEL = (0.035, 0.045, 0.062, 1.0)
PLATE = (0.085, 0.105, 0.125, 1.0)
BRONZE = (0.34, 0.19, 0.075, 1.0)
TEAL = (0.02, 0.62, 0.68, 1.0)
AMBER = (1.0, 0.42, 0.03, 1.0)
ICE = (0.35, 0.85, 1.0, 1.0)
DEEP = (0.06, 0.02, 0.42, 1.0)
SIGNAL = (0.72, 0.94, 1.0, 1.0)


def reset_scene(name, duration_seconds):
    if duration_seconds % BEAT_SECONDS != 0:
        raise ValueError(f"{name}: {duration_seconds}s is not a whole multiple of the beat")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1 + round(duration_seconds * FPS)
    scene["setpiece"] = name
    scene["loop_duration_seconds"] = duration_seconds
    scene["beat_seconds"] = BEAT_SECONDS
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, emission_strength=0.0, metallic=0.85, roughness=0.34):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    metallic_input = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission_strength > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission_strength
    return value


def build_materials():
    return {
        "steel": material("TideSteel", STEEL),
        "plate": material("TidePlate", PLATE, metallic=0.72, roughness=0.46),
        "bronze": material("TideBronze", BRONZE, metallic=0.9, roughness=0.28),
        "teal": material("TideTeal", TEAL, 3.0, 0.2, 0.18),
        "amber": material("TideAmber", AMBER, 3.4, 0.2, 0.2),
        "ice": material("TideIce", ICE, 2.6, 0.15, 0.14),
        "deep": material("TideDeep", DEEP, 2.2, 0.25, 0.22),
        "signal": material("TideSignal", SIGNAL, 4.2, 0.12, 0.12),
    }


def finish_mesh(obj, name, mat):
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.data.materials.append(mat)
    return obj


def cube(name, location, scale, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cylinder(name, location, radius, depth, mat, vertices=16, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return finish_mesh(bpy.context.object, name, mat)


def cone(name, location, radius1, radius2, depth, mat, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, location, scale, mat, segments=20, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0), major_segments=28):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def bevel(obj, width=0.05, segments=2):
    """Softens the silhouette of a decorative mesh. Never used on a collision body: every
    extra face there is paid for on each collision query."""
    modifier = obj.modifiers.new(name="Bevel", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    return obj


def warning_chevrons(prefix, *, center, count, spacing, mat, rotation=(0, 0, 0), scale=1.0):
    """Small emissive arrowheads used as a common motion language on every machine.
    They are decorative by contract and therefore always carry the _nocol suffix."""
    result = []
    start = -((count - 1) * spacing) * 0.5
    for index in range(count):
        x = center[0] + start + index * spacing
        upper = cube(
            f"{prefix}_chevron_{index}_upper_nocol",
            (x, center[1], center[2] + 0.18 * scale),
            (0.34 * scale, 0.08 * scale, 0.08 * scale),
            mat,
            rotation=(rotation[0], rotation[1] - 0.55, rotation[2]),
        )
        lower = cube(
            f"{prefix}_chevron_{index}_lower_nocol",
            (x, center[1], center[2] - 0.18 * scale),
            (0.34 * scale, 0.08 * scale, 0.08 * scale),
            mat,
            rotation=(rotation[0], rotation[1] + 0.55, rotation[2]),
        )
        result.extend((upper, lower))
    return result


def empty(name, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def parent_keep_world(child, parent):
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def keyframe(obj, frame, *, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)


def beat_frame(scene, beats):
    """Frame at a given number of beats after the loop start."""
    return scene.frame_start + round(beats * BEAT_SECONDS * FPS)


def build_breath_gate(scene, mats):
    """One beat: two seconds open, two seconds shut. The lintel and posts are static, so
    they carry no collider in dynamic mode and can afford the detail. A cyan-to-amber
    signal bar makes the opening direction readable before the player enters the chain."""
    bevel(cube("gate_lintel", (0, 0, 7.4), (6.5, 1.0, 0.62), mats["plate"]), 0.12)
    bevel(cube("gate_post_left", (-5.9, 0, 3.7), (0.72, 1.0, 3.7), mats["plate"]), 0.1)
    bevel(cube("gate_post_right", (5.9, 0, 3.7), (0.72, 1.0, 3.7), mats["plate"]), 0.1)
    cube("gate_sill", (0, 0, 0.3), (6.5, 1.15, 0.3), mats["steel"])
    cube("gate_header_signal", (0, -1.02, 7.42), (3.3, 0.09, 0.16), mats["signal"])
    warning_chevrons(
        "gate_header",
        center=(0, -1.13, 7.42),
        count=5,
        spacing=1.0,
        mat=mats["teal"],
        scale=0.72,
    )
    for side in (-1, 1):
        cylinder(
            f"gate_hydraulic_housing_{side}",
            (side * 5.92, 0, 6.4),
            0.34,
            1.8,
            mats["bronze"],
            vertices=12,
            rotation=(0, pi / 2, 0),
        )
        sphere(
            f"gate_beacon_{side}",
            (side * 5.75, -1.08, 8.15),
            (0.24, 0.24, 0.24),
            mats["amber"],
            12,
            6,
        )

    for side, closed_x, open_x, tone in ((-1, -2.6, -5.4, "teal"), (1, 2.6, 5.4, "amber")):
        leaf = empty(f"GateLeaf{'L' if side < 0 else 'R'}", (closed_x, 0, 3.7))
        # Coarse body: this is what the player collides with.
        cube(f"gate_leaf_body_{side}", (closed_x, 0, 3.7), (2.6, 0.4, 3.3), mats["steel"])
        body = bpy.context.object
        # Detail that must not cost collision work.
        trim = cube(f"gate_leaf_trim_{side}_nocol", (closed_x, 0, 6.6), (2.5, 0.5, 0.22), mats[tone])
        bevel(trim, 0.04)
        spine = cube(
            f"gate_leaf_spine_{side}_nocol",
            (closed_x, -0.48, 3.7),
            (0.16, 0.08, 2.5),
            mats[tone],
        )
        leaf_signals = warning_chevrons(
            f"gate_leaf_{side}",
            center=(closed_x, -0.58, 3.7),
            count=3,
            spacing=0.72,
            mat=mats[tone],
            scale=0.6,
        )
        for obj in (body, trim, spine, *leaf_signals):
            parent_keep_world(obj, leaf)

        keyframe(leaf, beat_frame(scene, 0), location=(closed_x, 0, 3.7))
        keyframe(leaf, beat_frame(scene, 0.5), location=(open_x, 0, 3.7))
        keyframe(leaf, beat_frame(scene, 1), location=(closed_x, 0, 3.7))


def build_piston_tunnel(scene, mats):
    """Four rams narrow the corridor in pairs, so a straight line through the middle is
    only free on the off beat. The outer rails and amber sleeves expose the mechanism,
    while cyan face lights announce the clear half of the cycle."""
    for index in range(4):
        ring = torus(
            f"tunnel_ring_{index}",
            (0, 0, 2.4 + index * 2.6),
            4.6,
            0.3,
            mats["plate"],
            (0, 0, 0),
        )
        ring.hide_render = False

    for side in (-1, 1):
        for axis in (-1, 1):
            bevel(cube(
                f"tunnel_longitudinal_rail_{side}_{axis}",
                (side * 4.15, axis * 4.15, 6.3),
                (0.2, 0.2, 5.3),
                mats["bronze"],
            ), 0.06)
    for level in range(5):
        cube(
            f"tunnel_pulse_marker_{level}",
            (0, -4.72, 1.2 + level * 2.5),
            (0.55, 0.12, 0.09),
            mats["teal"] if level % 2 == 0 else mats["amber"],
        )

    for index in range(4):
        angle = index * pi / 2
        retracted = (4.6 * cos(angle), 4.6 * sin(angle), 5.0)
        extended = (1.5 * cos(angle), 1.5 * sin(angle), 5.0)
        ram = empty(f"PistonRam{index}", retracted)
        cylinder(
            f"piston_sleeve_{index}",
            (5.1 * cos(angle), 5.1 * sin(angle), 5.0),
            1.22,
            1.8,
            mats["bronze"],
            vertices=14,
            rotation=(0, pi / 2, angle),
        )
        head = cylinder(
            f"piston_head_{index}",
            retracted,
            0.95,
            2.6,
            mats["steel"],
            vertices=12,
            rotation=(0, pi / 2, angle),
        )
        face = cylinder(
            f"piston_face_{index}_nocol",
            retracted,
            0.78,
            0.12,
            mats["signal"],
            vertices=12,
            rotation=(0, pi / 2, angle),
        )
        glow = cylinder(
            f"piston_glow_{index}_nocol",
            retracted,
            0.55,
            2.75,
            mats["ice"],
            vertices=12,
            rotation=(0, pi / 2, angle),
        )
        for obj in (head, glow, face):
            parent_keep_world(obj, ram)

        # Opposing pairs alternate: even rams push on the first half beat, odd on the second.
        lead = 0 if index % 2 == 0 else 0.5
        keyframe(ram, beat_frame(scene, 0), location=retracted)
        keyframe(ram, beat_frame(scene, lead + 0.2), location=extended)
        keyframe(ram, beat_frame(scene, lead + 0.4), location=retracted)
        keyframe(ram, beat_frame(scene, 1), location=retracted)


def build_iris_shutter(scene, mats):
    """Two beats. Eight blades close to the centre and leave a short window open. A
    bright aperture ring and radial warning fins make that window legible on approach."""
    torus("iris_frame", (0, 0, 0), 6.4, 0.45, mats["plate"], (pi / 2, 0, 0), major_segments=40)
    torus("iris_aperture_signal", (0, -0.34, 0), 2.05, 0.10, mats["signal"], (pi / 2, 0, 0), major_segments=32)
    for index in range(12):
        angle = index * (2 * pi / 12)
        cube(
            f"iris_housing_fin_{index}",
            (7.05 * cos(angle), 0, 7.05 * sin(angle)),
            (0.68, 0.32, 0.18),
            mats["bronze"] if index % 3 == 0 else mats["plate"],
            rotation=(0, -angle, 0),
        )
    for index in range(8):
        angle = index * (pi / 4)
        open_radius = 6.0
        shut_radius = 1.5
        blade_pivot = empty(f"IrisBlade{index}", (open_radius * cos(angle), 0, open_radius * sin(angle)))
        blade = cube(
            f"iris_blade_{index}",
            (open_radius * cos(angle), 0, open_radius * sin(angle)),
            (1.5, 0.28, 0.65),
            mats["steel"],
            rotation=(0, -angle, 0),
        )
        edge = cube(
            f"iris_edge_{index}_nocol",
            (open_radius * cos(angle), 0, open_radius * sin(angle)),
            (1.45, 0.32, 0.12),
            mats["teal"],
            rotation=(0, -angle, 0),
        )
        pulse = cube(
            f"iris_pulse_{index}_nocol",
            ((open_radius - 0.65) * cos(angle), -0.34, (open_radius - 0.65) * sin(angle)),
            (0.44, 0.10, 0.16),
            mats["amber"],
            rotation=(0, -angle, 0),
        )
        for obj in (blade, edge, pulse):
            parent_keep_world(obj, blade_pivot)

        shut = (shut_radius * cos(angle), 0, shut_radius * sin(angle))
        open_at = (open_radius * cos(angle), 0, open_radius * sin(angle))
        keyframe(blade_pivot, beat_frame(scene, 0), location=open_at, rotation=(0, 0, 0))
        keyframe(blade_pivot, beat_frame(scene, 0.75), location=shut, rotation=(0, pi / 8, 0))
        keyframe(blade_pivot, beat_frame(scene, 1.25), location=shut, rotation=(0, pi / 8, 0))
        keyframe(blade_pivot, beat_frame(scene, 2), location=open_at, rotation=(0, 0, 0))


def build_carousel_ring(scene, mats):
    """Two beats per turn. Nine spokes with three wide gaps: the way through moves.
    Cyan gap beacons travel with the rotor so the next opening can be tracked at speed."""
    cylinder("carousel_hub", (0, 0, 0), 1.5, 1.8, mats["bronze"], vertices=20, rotation=(pi / 2, 0, 0))
    cylinder("carousel_hub_signal", (0, -0.96, 0), 0.82, 0.12, mats["signal"], vertices=18, rotation=(pi / 2, 0, 0))
    for side in (-1, 1):
        bevel(cube(
            f"carousel_support_{side}",
            (side * 8.8, 0.5, 0),
            (0.42, 1.0, 9.0),
            mats["plate"],
        ), 0.1)
    rotor = empty("CarouselRotor", (0, 0, 0))
    # The rim only frames the wheel; the spokes are what a player has to avoid. Keeping it
    # out of collision lets it stay round without paying 700 triangles per query.
    torus("carousel_rim_nocol", (0, 0, 0), 8.0, 0.42, mats["plate"], (pi / 2, 0, 0), major_segments=44)
    parent_keep_world(bpy.context.object, rotor)

    for index in range(9):
        # Three evenly spread gaps: skip every third spoke.
        if index % 3 == 0:
            angle = index * (2 * pi / 9)
            beacon = torus(
                f"carousel_gap_beacon_{index}_nocol",
                (6.3 * cos(angle), -0.48, 6.3 * sin(angle)),
                0.42,
                0.10,
                mats["signal"],
                (pi / 2, 0, 0),
                major_segments=16,
            )
            parent_keep_world(beacon, rotor)
            continue
        angle = index * (2 * pi / 9)
        spoke = cube(
            f"carousel_spoke_{index}",
            (4.6 * cos(angle), 0, 4.6 * sin(angle)),
            (3.4, 0.35, 0.5),
            mats["steel"],
            rotation=(0, -angle, 0),
        )
        light = cube(
            f"carousel_light_{index}_nocol",
            (7.2 * cos(angle), 0, 7.2 * sin(angle)),
            (0.5, 0.4, 0.5),
            mats["amber"],
        )
        for obj in (spoke, light):
            parent_keep_world(obj, rotor)

    for index in range(12):
        angle = index * (2 * pi / 12)
        tick = cube(
            f"carousel_tick_{index}_nocol",
            (7.95 * cos(angle), -0.45, 7.95 * sin(angle)),
            (0.12, 0.08, 0.42),
            mats["teal"] if index % 3 == 0 else mats["amber"],
            rotation=(0, -angle, 0),
        )
        parent_keep_world(tick, rotor)

    keyframe(rotor, beat_frame(scene, 0), rotation=(0, 0, 0))
    keyframe(rotor, beat_frame(scene, 2), rotation=(0, 2 * pi, 0))


def build_pendulum_field(scene, mats):
    """One beat. Five pendulums swing in alternating directions across the lane. Their
    rail lights alternate cyan and amber to reveal the phase order before the first bob."""
    bevel(cube("pendulum_rail", (0, 0, 9.4), (9.8, 0.8, 0.5), mats["plate"]), 0.12)
    for side in (-1, 1):
        bevel(cube(
            f"pendulum_arch_{side}",
            (side * 9.3, 0, 4.8),
            (0.5, 0.85, 4.8),
            mats["plate"],
        ), 0.1)
    for index in range(5):
        offset_x = -7.6 + index * 3.8
        direction = 1 if index % 2 == 0 else -1
        cube(
            f"pendulum_phase_lamp_{index}",
            (offset_x, -0.82, 9.45),
            (1.2, 0.10, 0.14),
            mats["teal"] if direction > 0 else mats["amber"],
        )
        pivot = empty(f"PendulumPivot{index}", (offset_x, 0, 9.0))
        rod = cylinder(f"pendulum_rod_{index}_nocol", (offset_x, 0, 6.4), 0.12, 5.2, mats["bronze"], vertices=8)
        bob = sphere(f"pendulum_bob_{index}", (offset_x, 0, 3.6), (1.15, 1.15, 1.15), mats["steel"], 16, 8)
        halo = torus(
            f"pendulum_halo_{index}_nocol",
            (offset_x, 0, 3.6),
            1.45,
            0.12,
            mats["ice"],
            (pi / 2, 0, 0),
        )
        bob_eye = sphere(
            f"pendulum_eye_{index}_nocol",
            (offset_x, -1.08, 3.6),
            (0.34, 0.12, 0.34),
            mats["signal"],
            12,
            6,
        )
        counterweight = cone(
            f"pendulum_counterweight_{index}_nocol",
            (offset_x, 0, 8.1),
            0.42,
            0.18,
            0.8,
            mats["bronze"],
            vertices=10,
        )
        for obj in (rod, bob, halo, bob_eye, counterweight):
            parent_keep_world(obj, pivot)

        swing = direction * 0.85
        keyframe(pivot, beat_frame(scene, 0), rotation=(swing, 0, 0))
        keyframe(pivot, beat_frame(scene, 0.5), rotation=(-swing, 0, 0))
        keyframe(pivot, beat_frame(scene, 1), rotation=(swing, 0, 0))


def build_lift_rings(scene, mats):
    """Four beats. Two ring platforms travel in opposite directions, so the pair opens a
    high route and a low route in turn. Column arrows and under-deck light identify the
    direction of each carrier without relying on the player watching a whole cycle."""
    cylinder("lift_column", (0, 0, 8.0), 1.1, 16.0, mats["plate"], vertices=14)
    for level in range(6):
        tone = "teal" if level % 2 == 0 else "amber"
        cube(
            f"lift_column_step_{level}",
            (0, -1.08, 2.0 + level * 2.4),
            (0.32, 0.10, 0.12),
            mats[tone],
        )
    for side in (-1, 1):
        cube(
            f"lift_guide_{side}",
            (side * 5.2, 0.75, 8.0),
            (0.18, 0.18, 7.5),
            mats["bronze"],
        )
    for side, low, high, tone in ((-1, 2.0, 13.0, "teal"), (1, 13.0, 2.0, "amber")):
        carrier = empty(f"LiftCarrier{'A' if side < 0 else 'B'}", (side * 5.2, 0, low))
        deck = cylinder(f"lift_deck_{side}", (side * 5.2, 0, low), 3.6, 0.55, mats["steel"], vertices=16)
        rim = torus(
            f"lift_rim_{side}_nocol",
            (side * 5.2, 0, low + 0.4),
            3.7,
            0.16,
            mats[tone],
            (0, 0, 0),
            major_segments=32,
        )
        underglow = cylinder(
            f"lift_underglow_{side}_nocol",
            (side * 5.2, 0, low - 0.32),
            2.75,
            0.10,
            mats[tone],
            vertices=18,
        )
        direction_marker = cone(
            f"lift_direction_{side}_nocol",
            (side * 5.2, -3.0, low + 0.55),
            0.48,
            0.0,
            0.9,
            mats["signal"],
            vertices=10,
            rotation=(0 if high > low else pi, 0, 0),
        )
        for obj in (deck, rim, underglow, direction_marker):
            parent_keep_world(obj, carrier)

        keyframe(carrier, beat_frame(scene, 0), location=(side * 5.2, 0, low))
        keyframe(carrier, beat_frame(scene, 1.75), location=(side * 5.2, 0, high))
        keyframe(carrier, beat_frame(scene, 2.25), location=(side * 5.2, 0, high))
        keyframe(carrier, beat_frame(scene, 4), location=(side * 5.2, 0, low))


def build_tide_wall(scene, mats):
    """Four beats. A wall of segments sweeps down the hall and back; the gap in its middle
    is the only way past it. Layered crests and alternating signal ribs turn the very
    simple collision wall into a readable mechanical wave without adding collider detail."""
    for index in range(6):
        if index == 2 or index == 3:
            continue
        column = cube(
            f"tide_pillar_{index}",
            (-11.0 + index * 4.4, 0, 5.0),
            (1.6, 1.4, 5.0),
            mats["plate"],
        )
        bevel(column, 0.08)

    bevel(cube("tide_arch_top", (0, 0, 10.5), (13.0, 1.6, 0.55), mats["plate"]), 0.12)
    for index in range(9):
        cube(
            f"tide_arch_meter_{index}",
            (-8.0 + index * 2.0, -1.62, 10.5),
            (0.55, 0.10, 0.14),
            mats["teal"] if index < 4 else mats["amber"],
        )
    for side in (-1, 1):
        cylinder(
            f"tide_drive_drum_{side}",
            (side * 11.4, 0, 8.6),
            1.25,
            1.4,
            mats["bronze"],
            vertices=16,
            rotation=(pi / 2, 0, 0),
        )

    sweep = empty("TideSweep", (0, -14.0, 0))
    for index in range(5):
        height = 3.6 + (abs(2 - index) * 0.45)
        panel = cube(
            f"tide_panel_{index}",
            (-9.6 + index * 4.8, -14.0, height),
            (2.2, 0.6, height),
            mats["steel"],
        )
        crest = cube(
            f"tide_crest_{index}_nocol",
            (-9.6 + index * 4.8, -14.0, height * 2 + 0.38),
            (2.1, 0.7, 0.3),
            mats["deep"] if index % 2 == 0 else mats["teal"],
        )
        face = cube(
            f"tide_face_rib_{index}_nocol",
            (-9.6 + index * 4.8, -14.64, height),
            (0.20, 0.08, max(1.6, height - 0.7)),
            mats["signal"] if index == 2 else mats["amber"],
        )
        crown = cone(
            f"tide_crown_{index}_nocol",
            (-9.6 + index * 4.8, -14.0, height * 2 + 0.9),
            0.72,
            0.0,
            1.0,
            mats["signal"] if index == 2 else mats["bronze"],
            vertices=8,
        )
        for obj in (panel, crest, face, crown):
            parent_keep_world(obj, sweep)

    sweep_signals = warning_chevrons(
        "tide_sweep",
        center=(0, -14.7, 5.1),
        count=5,
        spacing=2.1,
        mat=mats["signal"],
        scale=0.78,
    )
    for signal in sweep_signals:
        parent_keep_world(signal, sweep)

    keyframe(sweep, beat_frame(scene, 0), location=(0, -14.0, 0))
    keyframe(sweep, beat_frame(scene, 2), location=(0, 14.0, 0))
    keyframe(sweep, beat_frame(scene, 4), location=(0, -14.0, 0))


def build_reactor_heart(scene, mats):
    """Two beats. The goal marker: it pulses and its shell opens, but nothing about it
    blocks the lane, so the finish stays readable. A static crown and six energy vanes
    give the map a proper final silhouette while the animated core remains the focus."""
    cylinder("reactor_plinth", (0, 0, 0.65), 5.8, 1.3, mats["plate"], vertices=24)
    torus("reactor_plinth_signal", (0, 0, 1.32), 5.0, 0.13, mats["teal"], major_segments=36)
    for index in range(6):
        angle = index * pi / 3
        cube(
            f"reactor_crown_pylon_{index}",
            (5.5 * cos(angle), 5.5 * sin(angle), 3.0),
            (0.34, 0.55, 2.2),
            mats["bronze"],
            rotation=(0, 0, angle),
        )
        cone(
            f"reactor_crown_tip_{index}",
            (5.5 * cos(angle), 5.5 * sin(angle), 5.5),
            0.55,
            0.08,
            1.2,
            mats["signal"] if index % 2 == 0 else mats["amber"],
            vertices=10,
        )
    core = sphere("reactor_core", (0, 0, 5.0), (2.6, 2.6, 2.6), mats["deep"], 24, 12)
    keyframe(core, beat_frame(scene, 0), scale=(1, 1, 1))
    keyframe(core, beat_frame(scene, 1), scale=(1.22, 1.22, 1.22))
    keyframe(core, beat_frame(scene, 2), scale=(1, 1, 1))

    for index in range(3):
        tilt = index * (pi / 3)
        ring = torus(
            f"reactor_ring_{index}_nocol",
            (0, 0, 5.0),
            4.0 + index * 0.5,
            0.16,
            mats["ice"] if index % 2 == 0 else mats["teal"],
            (pi / 2, tilt, 0),
            major_segments=36,
        )
        keyframe(ring, beat_frame(scene, 0), rotation=(pi / 2, tilt, 0))
        keyframe(ring, beat_frame(scene, 2), rotation=(pi / 2, tilt + (2 * pi if index % 2 == 0 else -2 * pi), 0))

    vane_rig = empty("ReactorEnergyVanes", (0, 0, 5.0))
    for index in range(6):
        angle = index * pi / 3
        vane = cube(
            f"reactor_energy_vane_{index}_nocol",
            (3.7 * cos(angle), 3.7 * sin(angle), 5.0),
            (1.2, 0.10, 0.16),
            mats["teal"] if index % 2 == 0 else mats["deep"],
            rotation=(0, 0, angle),
        )
        parent_keep_world(vane, vane_rig)
    keyframe(vane_rig, beat_frame(scene, 0), rotation=(0, 0, 0))
    keyframe(vane_rig, beat_frame(scene, 2), rotation=(0, 0, -2 * pi))

    for index in range(6):
        angle = index * pi / 3
        shut = (3.1 * cos(angle), 3.1 * sin(angle), 5.0)
        opened = (4.6 * cos(angle), 4.6 * sin(angle), 5.0)
        petal = cube(f"reactor_petal_{index}", shut, (0.7, 0.35, 1.7), mats["bronze"], rotation=(0, 0, angle))
        keyframe(petal, beat_frame(scene, 0), location=shut)
        keyframe(petal, beat_frame(scene, 1), location=opened)
        keyframe(petal, beat_frame(scene, 2), location=shut)


SETPIECES = (
    ("01_breath_gate", "BreathGateLoop", 4, build_breath_gate),
    ("02_piston_tunnel", "PistonTunnelLoop", 4, build_piston_tunnel),
    ("03_iris_shutter", "IrisShutterLoop", 8, build_iris_shutter),
    ("04_carousel_ring", "CarouselRingLoop", 8, build_carousel_ring),
    ("05_pendulum_field", "PendulumFieldLoop", 4, build_pendulum_field),
    ("06_lift_rings", "LiftRingsLoop", 16, build_lift_rings),
    ("07_tide_wall", "TideWallLoop", 16, build_tide_wall),
    ("08_reactor_heart", "ReactorHeartLoop", 8, build_reactor_heart),
)


def export_setpiece(file_stem, clip_name, duration, builder):
    scene = reset_scene(clip_name, duration)
    builder(scene, build_materials())
    scene.frame_set(scene.frame_start)
    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        # SCENE mode exports exactly one clip named after the scene, which is what the
        # runtime clock addresses by name.
        export_animation_mode="SCENE",
        export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    print(f"generated {blend_path.relative_to(ROOT)} and {glb_path.relative_to(ROOT)}")


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for setpiece in SETPIECES:
        export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
