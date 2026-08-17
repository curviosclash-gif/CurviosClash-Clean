#!/usr/bin/env python3
"""Generate the animated Verdant Aperture setpieces.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_verdant_aperture_assets.py

Verdant Aperture inverts the Kinetic Tide rule. There the obstacles move and the way through
stays put; here the wall stays put and the *opening travels*. Every setpiece is a barrier with
exactly one hole in it, and that hole walks along a known path once per loop. A player does not
learn *when* to go, but *where* to be.

Collision follows one rule, and the geometry is built around it: with the map running in
glbColliderMode 'dynamic', only meshes an animation moves get a collider. So each moving part is
a coarse, low-poly body that is cheap to collide against, and everything that only has to look
good carries the _nocol suffix, which the loader excludes explicitly.

The map is a greenhouse ruin, so the material set is deliberately soft: verdigris, wet stone,
sun-warmed glass. Nothing here is chrome. Readability is carried by glow buds instead of the
warning chevrons the machine maps use.
"""

from math import cos, pi, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "verdant_aperture" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "verdant_aperture" / "glb"
FPS = 30
BEAT_SECONDS = 6

# Greenhouse ruin: oxidised copper, wet stone, sun through dirty glass.
STONE = (0.24, 0.23, 0.20, 1.0)
VERDIGRIS = (0.13, 0.42, 0.35, 1.0)
BARK = (0.19, 0.12, 0.06, 1.0)
MOSS = (0.16, 0.30, 0.09, 1.0)
GLASS = (0.55, 0.75, 0.72, 1.0)
SUN = (1.0, 0.78, 0.35, 1.0)
PETAL = (1.0, 0.45, 0.55, 1.0)
BUD = (0.85, 1.0, 0.60, 1.0)


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


def material(name, color, emission_strength=0.0, metallic=0.0, roughness=0.62):
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
        "stone": material("VerdantStone", STONE, roughness=0.78),
        "verdigris": material("VerdantCopper", VERDIGRIS, metallic=0.45, roughness=0.55),
        "bark": material("VerdantBark", BARK, roughness=0.85),
        "moss": material("VerdantMoss", MOSS, roughness=0.9),
        "glass": material("VerdantGlass", GLASS, 1.4, 0.0, 0.12),
        "sun": material("VerdantSun", SUN, 3.2, 0.0, 0.2),
        "petal": material("VerdantPetal", PETAL, 2.4, 0.0, 0.3),
        "bud": material("VerdantBud", BUD, 4.0, 0.0, 0.14),
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


def cylinder(name, location, radius, depth, mat, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    return finish_mesh(bpy.context.object, name, mat)


def cone(name, location, radius1, radius2, depth, mat, vertices=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, location, scale, mat, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0), major_segments=20):
    """Tori are by far the most expensive primitive here (major * minor * 2 triangles), so every
    call keeps the segment count low and none of them is ever a collision body."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


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


def glow_buds(prefix, *, center, count, spacing, mat, axis="x", scale=1.0):
    """The readability language of this map. Small emissive buds mark where the opening is about
    to be, so a player reads the position rather than counting out the beat. Decorative by
    contract, therefore always _nocol."""
    result = []
    start = -((count - 1) * spacing) * 0.5
    for index in range(count):
        offset = start + index * spacing
        location = (
            center[0] + (offset if axis == "x" else 0),
            center[1] + (offset if axis == "y" else 0),
            center[2] + (offset if axis == "z" else 0),
        )
        result.append(sphere(
            f"{prefix}_bud_{index}_nocol",
            location,
            (0.22 * scale, 0.22 * scale, 0.22 * scale),
            mat,
            10,
            5,
        ))
    return result


def traveling_opening(rig, scene, total_beats, index, count, *, closed, opened):
    """The one rule this whole map is built on.

    Each element of a barrier owns one slot of the loop. During its slot it steps aside and the
    hole is in front of it; the rest of the loop it stays shut. Because the slots are laid out in
    order, the hole walks along the barrier once per loop instead of blinking on and off. The
    caller decides what "aside" means -- a translation, a rotation, or both -- so the same timing
    drives sliding leaves, tilting louvres and swinging petals alike.

    `closed` and `opened` are keyword dicts for `keyframe`, e.g. {"location": (...)}.
    """
    width = total_beats / count
    slot = index * width

    def key(beats, state):
        keyframe(rig, beat_frame(scene, beats), **state)

    if slot > 0:
        key(0, closed)
    key(slot, closed)
    key(slot + width * 0.3, opened)
    key(slot + width * 0.7, opened)
    key(slot + width, closed)
    if slot + width < total_beats:
        key(total_beats, closed)


def build_leaf_shutter(scene, mats):
    """One beat. Eight overlapping leaves form a ring; one at a time folds outward, so the gap
    circles the ring once per loop. This is the transition from the root floor into the crown
    hall, so the ring frame is heavy stone while the leaves stay light."""
    cylinder("leaf_shutter_collar", (0, 0, 0), 7.2, 1.1, mats["stone"], vertices=16, rotation=(pi / 2, 0, 0))
    cylinder("leaf_shutter_hub_signal", (0, -0.72, 0), 1.5, 0.2, mats["sun"], vertices=14, rotation=(pi / 2, 0, 0))
    torus("leaf_shutter_wreath_nocol", (0, 0, 0), 7.4, 0.28, mats["moss"], (pi / 2, 0, 0), major_segments=22)

    for index in range(8):
        angle = index * (2 * pi / 8)
        # The blade reaches from the centre outward and is wide enough to cover its sector at the
        # outer rim, so the blades overlap like roof tiles near the hub -- the way a real iris
        # shuts. Anything less leaves a permanent hole in the middle and slivers between blades,
        # and the vehicle is small enough (0.8 hitbox radius) to slip through both.
        shut = (2.7 * cos(angle), 0, 2.7 * sin(angle))
        aside = (7.0 * cos(angle), 0, 7.0 * sin(angle))

        leaf = empty(f"LeafBlade{index}", shut)
        blade = cube(
            f"leaf_blade_{index}",
            shut,
            (2.7, 0.34, 2.2),
            mats["verdigris"],
            rotation=(0, -angle, 0),
        )
        vein = cube(
            f"leaf_vein_{index}_nocol",
            shut,
            (2.0, 0.38, 0.12),
            mats["moss"],
            rotation=(0, -angle, 0),
        )
        tip = cone(
            f"leaf_tip_{index}_nocol",
            ((3.3 + 1.9) * cos(angle), 0, (3.3 + 1.9) * sin(angle)),
            0.62,
            0.0,
            1.1,
            mats["moss"],
            vertices=8,
            rotation=(pi / 2, 0, -angle),
        )
        marker = sphere(
            f"leaf_marker_{index}_nocol",
            (4.6 * cos(angle), -0.66, 4.6 * sin(angle)),
            (0.26, 0.26, 0.26),
            mats["bud"],
            10,
            5,
        )
        for obj in (blade, vein, tip, marker):
            parent_keep_world(obj, leaf)

        traveling_opening(
            leaf, scene, 1, index, 8,
            closed={"location": shut},
            opened={"location": aside},
        )


def build_bloom_iris(scene, mats):
    """Two beats. Six petals hinge outward in turn, so the way through swings around the blossom.
    This is the transition from the crown hall up to the glass roof, hence the upward-facing
    calyx: it reads as a hole in the ceiling from below."""
    cylinder("bloom_iris_calyx", (0, 0, -0.9), 6.4, 1.2, mats["stone"], vertices=16)
    cylinder("bloom_iris_calyx_signal", (0, 0, -0.2), 2.4, 0.16, mats["sun"], vertices=14)
    for index in range(6):
        angle = index * (2 * pi / 6)
        cube(
            f"bloom_sepal_{index}",
            (6.0 * cos(angle), 6.0 * sin(angle), -0.4),
            (0.9, 0.42, 0.5),
            mats["bark"],
            rotation=(0, 0, angle),
        )

    for index in range(6):
        angle = index * (2 * pi / 6)
        hinge_at = (4.1 * cos(angle), 4.1 * sin(angle), 0.6)

        petal_rig = empty(f"BloomPetal{index}", hinge_at)
        petal = cube(
            f"bloom_petal_{index}",
            (4.1 * cos(angle), 4.1 * sin(angle), 2.4),
            (1.9, 0.4, 2.0),
            mats["verdigris"],
            rotation=(0, 0, angle),
        )
        blush = cube(
            f"bloom_blush_{index}_nocol",
            (4.1 * cos(angle), 4.1 * sin(angle), 4.3),
            (1.75, 0.44, 0.22),
            mats["petal"],
            rotation=(0, 0, angle),
        )
        stamen = cylinder(
            f"bloom_stamen_{index}_nocol",
            (2.9 * cos(angle), 2.9 * sin(angle), 3.0),
            0.12,
            2.6,
            mats["bud"],
            vertices=6,
        )
        for obj in (petal, blush, stamen):
            parent_keep_world(obj, petal_rig)

        # The hinge tips the petal away from the centre; the opening follows the tip around.
        traveling_opening(
            petal_rig, scene, 2, index, 6,
            closed={"rotation": (0, 0, 0)},
            opened={"rotation": (-0.95 * sin(angle), 0.95 * cos(angle), 0)},
        )

    glow_buds("bloom_rim", center=(0, 0, -0.6), count=5, spacing=1.5, mat=mats["bud"], axis="x", scale=0.9)


def build_root_arch(scene, mats):
    """One beat. Seven root columns rise out of the floor of the root cellar; one sinks at a time,
    so the passable gap slides along the row. The lowest and tightest setpiece of the map."""
    cube("root_arch_lintel", (0, 0, 8.6), (11.0, 1.3, 0.6), mats["stone"])
    cube("root_arch_floor_signal", (0, -1.3, 0.3), (10.6, 0.12, 0.18), mats["sun"])
    for side in (-1, 1):
        cube(f"root_arch_pier_{side}", (side * 10.6, 0, 4.2), (0.7, 1.2, 4.2), mats["stone"])

    for index in range(7):
        offset_x = -8.4 + index * 2.8
        raised = (offset_x, 0, 3.4)
        sunken = (offset_x, 0, -2.9)

        root = empty(f"RootColumn{index}", raised)
        trunk = cylinder(
            f"root_trunk_{index}",
            raised,
            1.05,
            6.6,
            mats["bark"],
            vertices=10,
        )
        collar = cylinder(
            f"root_collar_{index}_nocol",
            (offset_x, 0, 6.5),
            1.3,
            0.5,
            mats["moss"],
            vertices=10,
        )
        eye = sphere(
            f"root_eye_{index}_nocol",
            (offset_x, -1.1, 6.5),
            (0.3, 0.16, 0.3),
            mats["bud"],
            10,
            5,
        )
        for obj in (trunk, collar, eye):
            parent_keep_world(obj, root)

        traveling_opening(
            root, scene, 1, index, 7,
            closed={"location": raised},
            opened={"location": sunken},
        )


def build_canopy_drift(scene, mats):
    """Two beats. Unlike the rest, this barrier does not open a slot at a time -- the whole curtain
    slides sideways and carries its single gap with it. It is the crown hall's long wall, and it
    teaches the map's rule in its purest form: the hole is always there, it just is not always
    here."""
    cube("canopy_drift_rail", (0, 0, 11.2), (13.5, 0.8, 0.55), mats["stone"])
    cube("canopy_drift_rail_signal", (0, -0.9, 10.6), (12.8, 0.12, 0.16), mats["sun"])
    for side in (-1, 1):
        cube(f"canopy_drift_post_{side}", (side * 13.2, 0, 5.6), (0.55, 0.8, 5.6), mats["stone"])

    curtain = empty("CanopyCurtain", (0, 0, 0))
    for index in range(7):
        # The gap is simply a missing panel. Sliding the curtain moves the gap with it.
        if index == 3:
            continue
        offset_x = -9.0 + index * 3.0
        panel = cube(
            f"canopy_panel_{index}",
            (offset_x, 0, 5.4),
            (1.35, 0.42, 5.0),
            mats["verdigris"],
        )
        drape = cube(
            f"canopy_drape_{index}_nocol",
            (offset_x, -0.5, 5.4),
            (1.25, 0.1, 4.8),
            mats["moss"],
        )
        weight = cone(
            f"canopy_weight_{index}_nocol",
            (offset_x, 0, 0.1),
            0.5,
            0.0,
            0.9,
            mats["bark"],
            vertices=8,
            rotation=(pi, 0, 0),
        )
        for obj in (panel, drape, weight):
            parent_keep_world(obj, curtain)

    gap_buds = glow_buds(
        "canopy_gap", center=(0, -0.85, 5.4), count=3, spacing=0.9, mat=mats["bud"], axis="z", scale=1.1
    )
    for bud in gap_buds:
        parent_keep_world(bud, curtain)

    keyframe(curtain, beat_frame(scene, 0), location=(-3.0, 0, 0))
    keyframe(curtain, beat_frame(scene, 1), location=(3.0, 0, 0))
    keyframe(curtain, beat_frame(scene, 2), location=(-3.0, 0, 0))


def build_glass_louvre(scene, mats):
    """Two beats. Nine roof panes tilt open one after another, so the strip of open sky travels
    along the ridge. Sits on the glass roof, the brightest and most exposed level."""
    cube("glass_louvre_ridge", (0, 0, 6.4), (12.0, 0.7, 0.4), mats["stone"])
    cube("glass_louvre_ridge_signal", (0, -0.8, 6.4), (11.2, 0.12, 0.16), mats["sun"])
    for side in (-1, 1):
        cube(f"glass_louvre_gutter_{side}", (side * 11.8, 0, 2.2), (0.5, 5.4, 0.4), mats["verdigris"])

    for index in range(9):
        offset_x = -9.6 + index * 2.4
        hinge_at = (offset_x, 0, 5.9)

        pane_rig = empty(f"GlassPane{index}", hinge_at)
        pane = cube(
            f"glass_pane_{index}",
            (offset_x, 0, 5.6),
            (1.1, 4.6, 0.22),
            mats["glass"],
        )
        frame = cube(
            f"glass_frame_{index}_nocol",
            (offset_x, 0, 5.42),
            (1.15, 4.7, 0.09),
            mats["verdigris"],
        )
        catch = sphere(
            f"glass_catch_{index}_nocol",
            (offset_x, -4.7, 5.6),
            (0.24, 0.24, 0.24),
            mats["bud"],
            10,
            5,
        )
        for obj in (pane, frame, catch):
            parent_keep_world(obj, pane_rig)

        traveling_opening(
            pane_rig, scene, 2, index, 9,
            closed={"rotation": (0, 0, 0)},
            opened={"rotation": (1.25, 0, 0)},
        )


def build_pollen_mill(scene, mats):
    """One beat. The purest case: a wheel of seven vanes with one position left empty. Nothing
    opens or shuts -- the wheel simply turns, and the single gap sweeps a full circle per loop."""
    cylinder("pollen_mill_hub", (0, 0, 0), 1.6, 1.6, mats["bark"], vertices=14, rotation=(pi / 2, 0, 0))
    cylinder("pollen_mill_hub_signal", (0, -0.92, 0), 0.9, 0.16, mats["sun"], vertices=12, rotation=(pi / 2, 0, 0))
    for side in (-1, 1):
        cube(f"pollen_mill_stand_{side}", (side * 8.6, 0.6, 0), (0.45, 0.9, 8.4), mats["stone"])

    rotor = empty("PollenRotor", (0, 0, 0))
    rim = torus("pollen_mill_rim_nocol", (0, 0, 0), 7.8, 0.34, mats["verdigris"], (pi / 2, 0, 0), major_segments=24)
    parent_keep_world(rim, rotor)

    for index in range(8):
        # One empty socket: this is the hole, and it rides around with the rotor.
        if index == 0:
            angle = 0.0
            for bud_index, radius in enumerate((4.0, 5.6, 7.2)):
                bud = sphere(
                    f"pollen_gap_bud_{bud_index}_nocol",
                    (radius * cos(angle), -0.55, radius * sin(angle)),
                    (0.3, 0.3, 0.3),
                    mats["bud"],
                    10,
                    5,
                )
                parent_keep_world(bud, rotor)
            continue

        angle = index * (2 * pi / 8)
        vane = cube(
            f"pollen_vane_{index}",
            (4.5 * cos(angle), 0, 4.5 * sin(angle)),
            (3.2, 0.4, 0.62),
            mats["verdigris"],
            rotation=(0, -angle, 0),
        )
        fuzz = cube(
            f"pollen_fuzz_{index}_nocol",
            (6.9 * cos(angle), 0, 6.9 * sin(angle)),
            (0.55, 0.5, 0.55),
            mats["petal"],
        )
        for obj in (vane, fuzz):
            parent_keep_world(obj, rotor)

    keyframe(rotor, beat_frame(scene, 0), rotation=(0, 0, 0))
    keyframe(rotor, beat_frame(scene, 1), rotation=(0, 2 * pi, 0))


def build_vine_gate(scene, mats):
    """Four beats -- the slowest setpiece on the map, and on purpose. Six stacked rows of vines
    peel aside one at a time, so the opening climbs from the floor to the ceiling over 24 seconds.
    Whoever wants the high route either waits for it or takes the long way."""
    for side in (-1, 1):
        cube(f"vine_gate_post_{side}", (side * 7.6, 0, 7.6), (0.62, 1.0, 7.6), mats["stone"])
    cube("vine_gate_post_signal", (-7.6, -1.05, 7.6), (0.16, 0.1, 7.2), mats["sun"])
    cube("vine_gate_head", (0, 0, 15.0), (7.6, 1.0, 0.55), mats["stone"])

    for index in range(6):
        offset_z = 1.5 + index * 2.5
        shut = (0, 0, offset_z)
        aside = (6.4, 0, offset_z)

        row = empty(f"VineRow{index}", shut)
        mat_row = mats["verdigris"] if index % 2 == 0 else mats["moss"]
        braid = cube(
            f"vine_braid_{index}",
            shut,
            (6.6, 0.4, 1.05),
            mat_row,
        )
        for leaf_index in range(3):
            leaf = cube(
                f"vine_leaf_{index}_{leaf_index}_nocol",
                (-3.6 + leaf_index * 3.6, -0.48, offset_z),
                (0.7, 0.09, 0.5),
                mats["moss"],
                rotation=(0, 0.4 if leaf_index % 2 == 0 else -0.4, 0),
            )
            parent_keep_world(leaf, row)
        tip_bud = sphere(
            f"vine_bud_{index}_nocol",
            (6.2, -0.5, offset_z),
            (0.26, 0.26, 0.26),
            mats["bud"],
            10,
            5,
        )
        for obj in (braid, tip_bud):
            parent_keep_world(obj, row)

        traveling_opening(
            row, scene, 4, index, 6,
            closed={"location": shut},
            opened={"location": aside},
        )


def build_heart_seed(scene, mats):
    """Two beats. The centre of the greenhouse and the reason to cross the map: the husk peels
    back and exposes the seed. Nothing about it blocks a lane -- it is a prize marker, so it stays
    readable from every level."""
    cylinder("heart_seed_plinth", (0, 0, 0.7), 5.2, 1.4, mats["stone"], vertices=20)
    torus("heart_seed_plinth_signal", (0, 0, 1.5), 4.4, 0.16, mats["sun"], major_segments=24)
    for index in range(5):
        angle = index * (2 * pi / 5)
        cube(
            f"heart_root_buttress_{index}",
            (4.7 * cos(angle), 4.7 * sin(angle), 2.6),
            (0.4, 0.6, 2.0),
            mats["bark"],
            rotation=(0, 0, angle),
        )

    seed = sphere("heart_seed_core", (0, 0, 5.2), (2.4, 2.4, 2.9), mats["petal"], 16, 8)
    keyframe(seed, beat_frame(scene, 0), scale=(1, 1, 1))
    keyframe(seed, beat_frame(scene, 1), scale=(1.18, 1.18, 1.12))
    keyframe(seed, beat_frame(scene, 2), scale=(1, 1, 1))

    for index in range(5):
        angle = index * (2 * pi / 5)
        shut = (2.6 * cos(angle), 2.6 * sin(angle), 5.2)
        opened = (4.6 * cos(angle), 4.6 * sin(angle), 4.4)
        husk = cube(
            f"heart_husk_{index}",
            shut,
            (0.75, 0.4, 2.2),
            mats["bark"],
            rotation=(0, 0, angle),
        )
        keyframe(husk, beat_frame(scene, 0), location=shut)
        keyframe(husk, beat_frame(scene, 1), location=opened)
        keyframe(husk, beat_frame(scene, 2), location=shut)

    halo = empty("HeartHalo", (0, 0, 5.2))
    for index in range(6):
        angle = index * (2 * pi / 6)
        mote = sphere(
            f"heart_mote_{index}_nocol",
            (3.6 * cos(angle), 3.6 * sin(angle), 5.2),
            (0.3, 0.3, 0.3),
            mats["bud"],
            10,
            5,
        )
        parent_keep_world(mote, halo)
    keyframe(halo, beat_frame(scene, 0), rotation=(0, 0, 0))
    keyframe(halo, beat_frame(scene, 2), rotation=(0, 0, 2 * pi))


SETPIECES = (
    ("01_leaf_shutter", "LeafShutterLoop", 6, build_leaf_shutter),
    ("02_bloom_iris", "BloomIrisLoop", 12, build_bloom_iris),
    ("03_root_arch", "RootArchLoop", 6, build_root_arch),
    ("04_canopy_drift", "CanopyDriftLoop", 12, build_canopy_drift),
    ("05_glass_louvre", "GlassLouvreLoop", 12, build_glass_louvre),
    ("06_pollen_mill", "PollenMillLoop", 6, build_pollen_mill),
    ("07_vine_gate", "VineGateLoop", 24, build_vine_gate),
    ("08_heart_seed", "HeartSeedLoop", 12, build_heart_seed),
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
