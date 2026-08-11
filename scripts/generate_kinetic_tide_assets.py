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
    they carry no collider in dynamic mode and can afford the detail."""
    bevel(cube("gate_lintel", (0, 0, 7.4), (6.2, 0.9, 0.55), mats["plate"]))
    bevel(cube("gate_post_left", (-5.7, 0, 3.7), (0.6, 0.9, 3.7), mats["plate"]))
    bevel(cube("gate_post_right", (5.7, 0, 3.7), (0.6, 0.9, 3.7), mats["plate"]))
    cube("gate_sill", (0, 0, 0.3), (6.2, 1.1, 0.3), mats["steel"])

    for side, closed_x, open_x, tone in ((-1, -2.6, -5.4, "teal"), (1, 2.6, 5.4, "amber")):
        leaf = empty(f"GateLeaf{'L' if side < 0 else 'R'}", (closed_x, 0, 3.7))
        # Coarse body: this is what the player collides with.
        cube(f"gate_leaf_body_{side}", (closed_x, 0, 3.7), (2.6, 0.4, 3.3), mats["steel"])
        body = bpy.context.object
        # Detail that must not cost collision work.
        trim = cube(f"gate_leaf_trim_{side}_nocol", (closed_x, 0, 6.6), (2.5, 0.5, 0.22), mats[tone])
        bevel(trim, 0.04)
        for obj in (body, trim):
            parent_keep_world(obj, leaf)

        keyframe(leaf, beat_frame(scene, 0), location=(closed_x, 0, 3.7))
        keyframe(leaf, beat_frame(scene, 0.5), location=(open_x, 0, 3.7))
        keyframe(leaf, beat_frame(scene, 1), location=(closed_x, 0, 3.7))


def build_piston_tunnel(scene, mats):
    """Four rams narrow the corridor in pairs, so a straight line through the middle is
    only free on the off beat."""
    for index in range(4):
        angle = index * pi / 2
        ring = torus(
            f"tunnel_ring_{index}",
            (0, 0, 2.4 + index * 2.6),
            4.6,
            0.3,
            mats["plate"],
            (0, 0, 0),
        )
        ring.hide_render = False

    for index in range(4):
        angle = index * pi / 2
        retracted = (4.6 * cos(angle), 4.6 * sin(angle), 5.0)
        extended = (1.5 * cos(angle), 1.5 * sin(angle), 5.0)
        ram = empty(f"PistonRam{index}", retracted)
        head = cylinder(
            f"piston_head_{index}",
            retracted,
            0.95,
            2.6,
            mats["steel"],
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
        for obj in (head, glow):
            parent_keep_world(obj, ram)

        # Opposing pairs alternate: even rams push on the first half beat, odd on the second.
        lead = 0 if index % 2 == 0 else 0.5
        keyframe(ram, beat_frame(scene, 0), location=retracted)
        keyframe(ram, beat_frame(scene, lead + 0.2), location=extended)
        keyframe(ram, beat_frame(scene, lead + 0.4), location=retracted)
        keyframe(ram, beat_frame(scene, 1), location=retracted)


def build_iris_shutter(scene, mats):
    """Two beats. Eight blades close to the centre and leave a short window open."""
    torus("iris_frame", (0, 0, 0), 6.4, 0.45, mats["plate"], (pi / 2, 0, 0), major_segments=40)
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
        for obj in (blade, edge):
            parent_keep_world(obj, blade_pivot)

        shut = (shut_radius * cos(angle), 0, shut_radius * sin(angle))
        open_at = (open_radius * cos(angle), 0, open_radius * sin(angle))
        keyframe(blade_pivot, beat_frame(scene, 0), location=open_at, rotation=(0, 0, 0))
        keyframe(blade_pivot, beat_frame(scene, 0.75), location=shut, rotation=(0, pi / 8, 0))
        keyframe(blade_pivot, beat_frame(scene, 1.25), location=shut, rotation=(0, pi / 8, 0))
        keyframe(blade_pivot, beat_frame(scene, 2), location=open_at, rotation=(0, 0, 0))


def build_carousel_ring(scene, mats):
    """Two beats per turn. Nine spokes with three wide gaps: the way through moves."""
    cylinder("carousel_hub", (0, 0, 0), 1.5, 1.8, mats["bronze"], vertices=20, rotation=(pi / 2, 0, 0))
    rotor = empty("CarouselRotor", (0, 0, 0))
    # The rim only frames the wheel; the spokes are what a player has to avoid. Keeping it
    # out of collision lets it stay round without paying 700 triangles per query.
    torus("carousel_rim_nocol", (0, 0, 0), 8.0, 0.42, mats["plate"], (pi / 2, 0, 0), major_segments=44)
    parent_keep_world(bpy.context.object, rotor)

    for index in range(9):
        # Three evenly spread gaps: skip every third spoke.
        if index % 3 == 0:
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

    keyframe(rotor, beat_frame(scene, 0), rotation=(0, 0, 0))
    keyframe(rotor, beat_frame(scene, 2), rotation=(0, 2 * pi, 0))


def build_pendulum_field(scene, mats):
    """One beat. Five pendulums swing in alternating directions across the lane."""
    bevel(cube("pendulum_rail", (0, 0, 9.4), (9.5, 0.7, 0.45), mats["plate"]))
    for index in range(5):
        offset_x = -7.6 + index * 3.8
        direction = 1 if index % 2 == 0 else -1
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
        for obj in (rod, bob, halo):
            parent_keep_world(obj, pivot)

        swing = direction * 0.85
        keyframe(pivot, beat_frame(scene, 0), rotation=(swing, 0, 0))
        keyframe(pivot, beat_frame(scene, 0.5), rotation=(-swing, 0, 0))
        keyframe(pivot, beat_frame(scene, 1), rotation=(swing, 0, 0))


def build_lift_rings(scene, mats):
    """Four beats. Two ring platforms travel in opposite directions, so the pair opens a
    high route and a low route in turn."""
    cylinder("lift_column", (0, 0, 8.0), 1.1, 16.0, mats["plate"], vertices=14)
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
        for obj in (deck, rim):
            parent_keep_world(obj, carrier)

        keyframe(carrier, beat_frame(scene, 0), location=(side * 5.2, 0, low))
        keyframe(carrier, beat_frame(scene, 1.75), location=(side * 5.2, 0, high))
        keyframe(carrier, beat_frame(scene, 2.25), location=(side * 5.2, 0, high))
        keyframe(carrier, beat_frame(scene, 4), location=(side * 5.2, 0, low))


def build_tide_wall(scene, mats):
    """Four beats. A wall of segments sweeps down the hall and back; the gap in its middle
    is the only way past it."""
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

    sweep = empty("TideSweep", (0, -14.0, 0))
    for index in range(5):
        panel = cube(
            f"tide_panel_{index}",
            (-9.6 + index * 4.8, -14.0, 4.2),
            (2.2, 0.6, 4.2),
            mats["steel"],
        )
        crest = cube(
            f"tide_crest_{index}_nocol",
            (-9.6 + index * 4.8, -14.0, 8.6),
            (2.1, 0.7, 0.3),
            mats["deep"],
        )
        for obj in (panel, crest):
            parent_keep_world(obj, sweep)

    keyframe(sweep, beat_frame(scene, 0), location=(0, -14.0, 0))
    keyframe(sweep, beat_frame(scene, 2), location=(0, 14.0, 0))
    keyframe(sweep, beat_frame(scene, 4), location=(0, -14.0, 0))


def build_reactor_heart(scene, mats):
    """Two beats. The goal marker: it pulses and its shell opens, but nothing about it
    blocks the lane, so the finish stays readable."""
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
