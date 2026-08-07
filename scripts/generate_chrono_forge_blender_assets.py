#!/usr/bin/env python3
"""Generate the animated, collision-free Chrono-Forge Nexus setpieces."""

from math import cos, pi, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "chrono_forge" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "chrono_forge" / "glb"
FPS = 30

METAL = (0.055, 0.075, 0.11, 1.0)
BRASS = (0.62, 0.25, 0.055, 1.0)
BLUE = (0.015, 0.32, 0.9, 1.0)
ORANGE = (1.0, 0.18, 0.015, 1.0)
CYAN = (0.02, 0.8, 1.0, 1.0)
VIOLET = (0.42, 0.06, 1.0, 1.0)
RED = (1.0, 0.025, 0.01, 1.0)


def reset_scene(name, duration_seconds):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1 + round(duration_seconds * FPS)
    scene["setpiece"] = name
    scene["loop_duration_seconds"] = duration_seconds
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, emission_strength=0.0, metallic=0.7):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    metallic_input = shader.inputs.get("Metallic IOR Level") or shader.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    shader.inputs["Roughness"].default_value = 0.28
    if emission_strength > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission_strength
    return value


def finish_mesh(obj, name, mat):
    # No _nocol suffix: the runtime derives collision from the animation clip, and the map
    # runs in glbColliderMode 'dynamic' so only the moving parts get a mesh collider while
    # the static set dressing stays on the map's authored box obstacles. Add _nocol back on
    # a single mesh only to exclude it from collision on purpose.
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.data.materials.append(mat)
    return obj


def cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cylinder(name, location, radius, depth, mat, vertices=20, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    return finish_mesh(bpy.context.object, name, mat)


def sphere(name, location, scale, mat, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def cone(name, location, radius, depth, mat):
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=radius, radius2=0.08, depth=depth, location=location)
    return finish_mesh(bpy.context.object, name, mat)


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
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


def build_hangar_crane(scene, mats):
    cube("crane_base", (0, 0, 0.6), (2.4, 2.4, 0.6), mats["metal"])
    cube("crane_tower", (0, 0, 5), (0.65, 0.65, 4.4), mats["brass"])
    pivot = empty("CranePivot", (0, 0, 9.2))
    beam = cube("crane_beam", (3.4, 0, 9.2), (4.1, 0.42, 0.42), mats["brass"])
    cable = cylinder("crane_cable", (6.2, 0, 6.6), 0.09, 5.2, mats["metal"])
    hook = torus("crane_hook", (6.2, 0, 3.9), 0.55, 0.13, mats["orange"], (pi / 2, 0, 0))
    for obj in (beam, cable, hook):
        parent_keep_world(obj, pivot)
    first, middle, last = scene.frame_start, (scene.frame_start + scene.frame_end) // 2, scene.frame_end
    keyframe(pivot, first, location=(0, 0, 9.2), rotation=(0, 0, -0.45))
    keyframe(pivot, middle, location=(0, 0, 10.5), rotation=(0, 0, 0.55))
    keyframe(pivot, last, location=(0, 0, 9.2), rotation=(0, 0, -0.45))


def build_machine_core(scene, mats):
    cylinder("machine_plinth", (0, 0, 0.6), 5.5, 1.2, mats["metal"], vertices=32)
    for index, (radius, height, direction) in enumerate(((4.0, 2.0, 1), (2.8, 3.3, -1), (1.7, 4.6, 1))):
        gear = torus(f"gear_{index}", (0, 0, height), radius, 0.42, mats["brass"])
        for tooth_index in range(12):
            angle = tooth_index * pi / 6
            tooth = cube(
                f"gear_{index}_tooth_{tooth_index}",
                ((radius + 0.45) * cos(angle), (radius + 0.45) * sin(angle), height),
                (0.42, 0.18, 0.25),
                mats["brass"],
            )
            tooth.rotation_euler[2] = angle
            parent_keep_world(tooth, gear)
        keyframe(gear, scene.frame_start, rotation=(0, 0, 0))
        keyframe(gear, scene.frame_end, rotation=(0, 0, direction * 2 * pi))
    for index in range(4):
        angle = index * pi / 2
        piston = cylinder(
            f"piston_{index}",
            (4.8 * cos(angle), 4.8 * sin(angle), 3.3),
            0.38,
            4.5,
            mats["blue"],
        )
        first = scene.frame_start
        middle = first + ((scene.frame_end - first) // 2)
        offset = 1.0 if index % 2 == 0 else -1.0
        keyframe(piston, first, location=tuple(piston.location))
        keyframe(piston, middle, location=(piston.location.x, piston.location.y, 3.3 + offset))
        keyframe(piston, scene.frame_end, location=(piston.location.x, piston.location.y, 3.3))


def build_crystal_shards(scene, mats):
    cylinder("crystal_pedestal", (0, 0, 0.4), 4.8, 0.8, mats["metal"], vertices=12)
    for index in range(7):
        angle = index * (2 * pi / 7)
        radius = 1.6 + (index % 3) * 0.75
        shard = cone(
            f"crystal_shard_{index}",
            (radius * cos(angle), radius * sin(angle), 2.8 + (index % 2)),
            0.65 + (index % 2) * 0.2,
            3.6 + (index % 3) * 0.7,
            mats["violet"] if index % 2 else mats["cyan"],
        )
        start = tuple(shard.location)
        middle = (start[0], start[1], start[2] + 0.8 + index * 0.08)
        keyframe(shard, scene.frame_start, location=start, rotation=(0.12 * index, 0.08 * index, angle))
        keyframe(shard, (scene.frame_start + scene.frame_end) // 2, location=middle, rotation=(0.12 * index, 0.08 * index, angle + pi))
        keyframe(shard, scene.frame_end, location=start, rotation=(0.12 * index, 0.08 * index, angle + 2 * pi))


def build_chronometer(scene, mats):
    cylinder("chronometer_hub", (0, 0, 0), 1.0, 1.2, mats["orange"], rotation=(pi / 2, 0, 0))
    rings = [
        torus("chronometer_outer", (0, 0, 0), 5.0, 0.28, mats["brass"], (pi / 2, 0, 0)),
        torus("chronometer_middle", (0, 0, 0), 3.7, 0.22, mats["blue"], (pi / 2, 0, 0)),
        torus("chronometer_inner", (0, 0, 0), 2.5, 0.18, mats["cyan"], (pi / 2, 0, 0)),
    ]
    for index, ring in enumerate(rings):
        direction = -1 if index == 1 else 1
        keyframe(ring, scene.frame_start, rotation=(pi / 2, 0, 0))
        keyframe(ring, scene.frame_end, rotation=(pi / 2, direction * (index + 1) * 2 * pi, 0))
    hand_long = cube("chronometer_hand_long", (0, -0.7, 1.9), (0.13, 0.15, 2.3), mats["orange"])
    hand_short = cube("chronometer_hand_short", (1.3, -0.6, 0), (1.65, 0.16, 0.16), mats["cyan"])
    for index, hand in enumerate((hand_long, hand_short)):
        keyframe(hand, scene.frame_start, rotation=(0, 0, 0))
        keyframe(hand, scene.frame_end, rotation=(0, (index + 1) * 2 * pi, 0))


def build_temple_gates(scene, mats):
    cube("temple_arch_top", (0, 0, 6.4), (5.5, 0.8, 0.7), mats["brass"])
    cube("temple_arch_left", (-4.8, 0, 3.0), (0.7, 0.8, 3.4), mats["brass"])
    cube("temple_arch_right", (4.8, 0, 3.0), (0.7, 0.8, 3.4), mats["brass"])
    left = cube("temple_gate_left", (-2.25, 0, 3.0), (2.15, 0.35, 2.8), mats["blue"])
    right = cube("temple_gate_right", (2.25, 0, 3.0), (2.15, 0.35, 2.8), mats["orange"])
    first, quarter, third_quarter, last = scene.frame_start, 1 + 2 * FPS, 1 + 8 * FPS, scene.frame_end
    for obj, closed_x, open_x in ((left, -2.25, -4.0), (right, 2.25, 4.0)):
        keyframe(obj, first, location=(closed_x, 0, 3.0))
        keyframe(obj, quarter, location=(open_x, 0, 3.0))
        keyframe(obj, third_quarter, location=(open_x, 0, 3.0))
        keyframe(obj, last, location=(closed_x, 0, 3.0))


def build_airship(scene, mats):
    rig = empty("AirshipRig", (0, 0, 5.5))
    body = sphere("airship_body", (0, 0, 5.5), (5.6, 2.1, 2.1), mats["brass"])
    cabin = cube("airship_cabin", (0.2, 0, 3.5), (2.1, 1.2, 0.7), mats["metal"])
    fin = cube("airship_fin", (-4.6, 0, 7.0), (1.1, 0.18, 1.5), mats["orange"])
    for obj in (body, cabin, fin):
        parent_keep_world(obj, rig)
    for side in (-1, 1):
        rotor = empty(f"AirshipRotor{side}", (1.0, side * 2.7, 4.1))
        for blade_index in range(3):
            blade = cube(
                f"airship_propeller_{side}_{blade_index}",
                (1.0, side * 2.7, 4.1),
                (0.16, 0.65, 1.0),
                mats["cyan"],
            )
            blade.rotation_euler[1] = blade_index * (2 * pi / 3)
            parent_keep_world(blade, rotor)
        parent_keep_world(rotor, rig)
        keyframe(rotor, scene.frame_start, rotation=(0, 0, 0))
        keyframe(rotor, scene.frame_end, rotation=(0, side * 8 * pi, 0))
    first, middle, last = scene.frame_start, (scene.frame_start + scene.frame_end) // 2, scene.frame_end
    keyframe(rig, first, location=(0, 0, 5.5), rotation=(0, -0.08, 0))
    keyframe(rig, middle, location=(0, 0, 6.4), rotation=(0.08, 0.08, 0.12))
    keyframe(rig, last, location=(0, 0, 5.5), rotation=(0, -0.08, 0))


def build_drone_swarm(scene, mats):
    for index in range(5):
        angle = index * (2 * pi / 5)
        drone = empty(f"DroneRig{index}")
        body = sphere(f"drone_body_{index}", (0, 0, 0), (0.8, 0.55, 0.35), mats["metal"], 16, 8)
        eye = sphere(f"drone_eye_{index}", (0.72, 0, 0), (0.2, 0.24, 0.2), mats["red"], 12, 6)
        parent_keep_world(body, drone)
        parent_keep_world(eye, drone)
        first = scene.frame_start
        quarter = first + ((scene.frame_end - first) // 4)
        half = first + ((scene.frame_end - first) // 2)
        third_quarter = first + (3 * (scene.frame_end - first) // 4)
        radius = 3.0 + (index % 2)
        height = 3.0 + index * 0.45
        keyframe(drone, first, location=(radius * cos(angle), radius * sin(angle), height), rotation=(0, 0, angle))
        keyframe(drone, quarter, location=(radius * cos(angle + pi / 2), radius * sin(angle + pi / 2), height + 0.7), rotation=(0, 0, angle + pi / 2))
        keyframe(drone, half, location=(radius * cos(angle + pi), radius * sin(angle + pi), height), rotation=(0, 0, angle + pi))
        keyframe(drone, third_quarter, location=(radius * cos(angle + 3 * pi / 2), radius * sin(angle + 3 * pi / 2), height - 0.5), rotation=(0, 0, angle + 3 * pi / 2))
        keyframe(drone, scene.frame_end, location=(radius * cos(angle), radius * sin(angle), height), rotation=(0, 0, angle + 2 * pi))


def build_time_core(scene, mats):
    core = sphere("time_core_orb", (0, 0, 3.8), (2.1, 2.1, 2.1), mats["red"])
    keyframe(core, scene.frame_start, scale=(1, 1, 1))
    keyframe(core, (scene.frame_start + scene.frame_end) // 2, scale=(1.28, 1.28, 1.28))
    keyframe(core, scene.frame_end, scale=(1, 1, 1))
    ring = torus("time_core_ring", (0, 0, 3.8), 4.3, 0.28, mats["orange"], (pi / 2, 0, 0))
    keyframe(ring, scene.frame_start, rotation=(pi / 2, 0, 0))
    keyframe(ring, scene.frame_end, rotation=(pi / 2, 4 * pi, 0))
    for index in range(6):
        angle = index * pi / 3
        segment = cube(
            f"time_core_segment_{index}",
            (3.1 * cos(angle), 3.1 * sin(angle), 3.8),
            (0.65, 0.3, 1.5),
            mats["brass"],
        )
        closed = tuple(segment.location)
        opened = (4.5 * cos(angle), 4.5 * sin(angle), 3.8)
        keyframe(segment, scene.frame_start, location=closed, rotation=(0, 0, angle))
        keyframe(segment, (scene.frame_start + scene.frame_end) // 2, location=opened, rotation=(0, 0, angle + pi / 3))
        keyframe(segment, scene.frame_end, location=closed, rotation=(0, 0, angle + 2 * pi))


SETPIECES = (
    ("01_hangar_crane", "HangarCraneLoop", 12, build_hangar_crane),
    ("02_machine_core", "MachineCoreLoop", 8, build_machine_core),
    ("03_crystal_shards", "CrystalShardsLoop", 6, build_crystal_shards),
    ("04_chronometer", "ChronometerLoop", 16, build_chronometer),
    ("05_temple_gates", "TempleGatesLoop", 10, build_temple_gates),
    ("06_airship", "AirshipLoop", 14, build_airship),
    ("07_drone_swarm", "DroneSwarmLoop", 9, build_drone_swarm),
    ("08_time_core", "TimeCoreLoop", 7, build_time_core),
)


def export_setpiece(file_stem, clip_name, duration, builder):
    scene = reset_scene(clip_name, duration)
    mats = {
        "metal": material("ChronoMetal", METAL),
        "brass": material("ChronoBrass", BRASS),
        "blue": material("ChronoBlue", BLUE, 2.2, 0.3),
        "orange": material("ChronoOrange", ORANGE, 2.7, 0.25),
        "cyan": material("ChronoCyan", CYAN, 3.0, 0.15),
        "violet": material("ChronoViolet", VIOLET, 2.8, 0.15),
        "red": material("ChronoRed", RED, 3.5, 0.2),
    }
    builder(scene, mats)
    scene.frame_set(scene.frame_start)
    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="SCENE",
        export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    print(f"generated {blend_path.relative_to(ROOT)} and {glb_path.relative_to(ROOT)}")


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for setpiece in SETPIECES:
        export_setpiece(*setpiece)


if __name__ == "__main__":
    main()
