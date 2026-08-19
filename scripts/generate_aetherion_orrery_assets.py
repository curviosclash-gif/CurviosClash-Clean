#!/usr/bin/env python3
"""Generate the Aetherion Orrery architecture and animated mechanisms.

Run with Blender 4.2 LTS:

    blender --background --python scripts/generate_aetherion_orrery_assets.py

The map is authored Z-up in Blender and exported Y-up to glTF. Gameplay mechanisms are
vertical barriers in the Blender X/Z plane. Their coarse collision bodies touch Z=0 so the
runtime loader's base alignment places them in the corridor instead of above it. Decorative
detail is marked ``_nocol`` and every material is a flat PBR colour without textures.
"""

from math import cos, pi, sin
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "maps" / "aetherion_orrery" / "blender"
GLB_DIR = ROOT / "assets" / "maps" / "aetherion_orrery" / "glb"
FPS = 30

IVORY = (0.69, 0.63, 0.47, 1.0)       # #D9D0B5 in display space
BRASS = (0.33, 0.17, 0.04, 1.0)       # #9B7139
OBSIDIAN = (0.009, 0.010, 0.017, 1.0) # #171923
CYAN = (0.11, 0.75, 0.79, 1.0)        # #5CE1E6
VIOLET = (0.15, 0.09, 0.57, 1.0)      # #6C55C7
GOLD = (1.0, 0.44, 0.14, 1.0)         # #FFD166


def reset_scene(name, duration_seconds=0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 1 + int(duration_seconds * FPS)
    scene["aetherion_asset"] = name
    scene["duration_seconds"] = duration_seconds
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    bpy.context.preferences.filepaths.save_version = 0
    return scene


def material(name, color, *, emission=0.0, metallic=0.0, roughness=0.62):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    shader = value.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission > 0:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission
    return value


def build_materials():
    return {
        "ivory": material("AOIvory", IVORY, roughness=0.72),
        "brass": material("AOBrass", BRASS, metallic=0.72, roughness=0.34),
        "obsidian": material("AOObsidian", OBSIDIAN, metallic=0.18, roughness=0.38),
        "cyan": material("AOCyan", CYAN, emission=5.0, roughness=0.28),
        "violet": material("AOViolet", VIOLET, emission=2.4, roughness=0.34),
        "gold": material("AOGold", GOLD, emission=4.0, metallic=0.35, roughness=0.3),
    }


def finish_mesh(obj, name, mat):
    obj.name = name
    obj.data.name = f"{name}_mesh"
    obj.data.materials.append(mat)
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    return obj


def cube(name, location, half_size, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = half_size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, name, mat)


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


def sphere(name, location, scale, mat, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, location=location
    )
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, name, mat)


def torus(name, location, major, minor, mat, rotation=(0, 0, 0), segments=24):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=segments,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat)


def empty(name, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def parent_keep_world(child, parent):
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def keyframe(obj, frame, *, location=None, rotation=None, scale=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert(data_path="location", frame=frame)
    if rotation is not None:
        obj.rotation_euler = rotation
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert(data_path="scale", frame=frame)


def animate_open_window(scene, rig, closed, opened, *, rotation=False):
    """Keep every beat fair while longer clips tell a non-repeating macro movement."""
    clip_seconds = (scene.frame_end - scene.frame_start) / FPS
    opened_values = opened if isinstance(opened, list) else [opened]
    for beat_index in range(int(clip_seconds / 12)):
        start = scene.frame_start + beat_index * 12 * FPS
        frames = [start, start + 3 * FPS, start + 4 * FPS,
                  start + 8 * FPS, start + 9 * FPS, start + 12 * FPS]
        beat_opened = opened_values[beat_index % len(opened_values)]
        values = [closed, closed, beat_opened, beat_opened, closed, closed]
        for frame, value in zip(frames, values):
            if rotation:
                keyframe(rig, frame, rotation=value)
            else:
                keyframe(rig, frame, location=value)


def countdown_beacons(scene, prefix, positions, mats):
    """Three collision-free gold lamps count down the final closed seconds of each beat."""
    clip_seconds = (scene.frame_end - scene.frame_start) / FPS
    for index, position in enumerate(positions):
        beacon = sphere(
            f"{prefix}_countdown_{index}_nocol",
            position,
            (0.42, 0.24, 0.42),
            mats["gold"],
            10,
            5,
        )
        for beat_index in range(int(clip_seconds / 12)):
            start = scene.frame_start + beat_index * 12 * FPS
            on = start + index * FPS
            keyframe(beacon, start, scale=(0.34, 0.34, 0.34))
            keyframe(beacon, on, scale=(1.0, 1.0, 1.0))
            keyframe(beacon, start + 3 * FPS, scale=(1.0, 1.0, 1.0))
            keyframe(beacon, start + 4 * FPS, scale=(0.18, 0.18, 0.18))
            keyframe(beacon, start + 8 * FPS, scale=(0.18, 0.18, 0.18))
            keyframe(beacon, start + 9 * FPS, scale=(0.34, 0.34, 0.34))
            keyframe(beacon, start + 12 * FPS, scale=(0.34, 0.34, 0.34))


def radial_teeth(prefix, radius, height, count, mats):
    for index in range(count):
        angle = index * 2 * pi / count
        cube(
            f"{prefix}_tooth_{index}_nocol",
            (radius * cos(angle), radius * sin(angle), height),
            (1.3, 0.55, 0.7),
            mats["brass"],
            rotation=(0, 0, angle),
        )


def orbit_markers(prefix, radius, height, count, mats):
    for index in range(count):
        angle = index * 2 * pi / count
        sphere(
            f"{prefix}_{index}_nocol",
            (radius * cos(angle), radius * sin(angle), height),
            (0.32, 0.32, 0.32),
            mats["cyan" if index % 2 == 0 else "gold"],
            10,
            5,
        )


def build_stellar_foundry(scene, mats):
    cylinder("foundry_floor_nocol", (0, 0, 0.8), 18, 1.6, mats["obsidian"], 32)
    torus("foundry_outer_ring_nocol", (0, 0, 1.8), 16.2, 0.7, mats["brass"], segments=32)
    torus("foundry_inner_ring_nocol", (0, 0, 2.0), 8.2, 0.42, mats["cyan"], segments=28)
    radial_teeth("foundry_drive", 17.4, 2.2, 24, mats)
    cylinder("foundry_furnace_nocol", (0, 0, 6.2), 4.2, 10.5, mats["obsidian"], 20)
    torus("foundry_furnace_glow_nocol", (0, 0, 9.4), 4.35, 0.34, mats["cyan"], segments=28)
    for index in range(8):
        angle = index * pi / 4
        x, y = 13.4 * cos(angle), 13.4 * sin(angle)
        cylinder(f"foundry_pylon_{index}_nocol", (x, y, 6), 0.9, 10, mats["ivory"], 12)
        cone(f"foundry_finial_{index}_nocol", (x, y, 12), 1.3, 0, 3.0, mats["gold"], 10)
        if index % 2 == 0:
            cube(
                f"foundry_counterweight_{index}_nocol",
                (10.4 * cos(angle), 10.4 * sin(angle), 7.5),
                (1.15, 1.15, 3.4),
                mats["brass"],
                rotation=(0, 0, angle),
            )
    orbit_markers("foundry_signal", 10.8, 3.0, 12, mats)


def build_meridian_gallery(scene, mats):
    cylinder("gallery_floor_nocol", (0, 0, 0.7), 18, 1.4, mats["ivory"], 32)
    for radius, height, mat_name in ((16, 8, "brass"), (11, 13, "cyan"), (6, 18, "violet")):
        torus(f"gallery_orbit_{radius}_nocol", (0, 0, height), radius, 0.45,
              mats[mat_name], segments=32)
    for index in range(12):
        angle = index * pi / 6
        x, y = 16 * cos(angle), 16 * sin(angle)
        cube(f"gallery_column_{index}_nocol", (x, y, 7), (0.55, 0.55, 6), mats["ivory"])
        cylinder(
            f"gallery_capital_{index}_nocol",
            (x, y, 13.2),
            1.15,
            0.65,
            mats["brass"],
            12,
        )
    torus("gallery_vertical_orbit_a_nocol", (0, 0, 10), 13.8, 0.36, mats["gold"],
          rotation=(pi / 2, 0, 0), segments=36)
    torus("gallery_vertical_orbit_b_nocol", (0, 0, 10), 10.2, 0.28, mats["cyan"],
          rotation=(pi / 2, pi / 3, 0), segments=32)
    cylinder("gallery_meridian_needle_nocol", (0, 0, 11), 0.7, 22, mats["gold"], 12)
    orbit_markers("gallery_constellation", 13.2, 10.5, 16, mats)


def build_eclipse_crown(scene, mats):
    cylinder("crown_floor_nocol", (0, 0, 0.6), 17.5, 1.2, mats["obsidian"], 32)
    cylinder("crown_eclipse_disc_nocol", (0, 0, 17), 6.8, 1.1, mats["obsidian"], 32,
             rotation=(pi / 2, 0, 0))
    torus("crown_eclipse_corona_nocol", (0, -0.7, 17), 7.4, 0.55, mats["violet"],
          rotation=(pi / 2, 0, 0), segments=36)
    for index in range(10):
        angle = index * pi / 5
        x, y = 14.8 * cos(angle), 14.8 * sin(angle)
        spire_height = 17 if index % 2 == 0 else 12
        cone(f"crown_spire_{index}_nocol", (x, y, spire_height * 0.5), 1.3, 0.12,
             spire_height, mats["ivory"], 12)
        sphere(f"crown_star_{index}_nocol", (x, y, spire_height + 0.8),
               (0.55, 0.55, 0.55), mats["gold"])
    torus("crown_halo_nocol", (0, 0, 14), 12.2, 0.55, mats["brass"], segments=36)
    torus("crown_eclipse_nocol", (0, 0, 14), 7.4, 0.4, mats["violet"], segments=32)
    for index in range(5):
        angle = index * 2 * pi / 5
        cube(
            f"crown_ray_{index}_nocol",
            (9.8 * cos(angle), 9.8 * sin(angle), 15.5),
            (3.8, 0.22, 0.18),
            mats["gold"],
            rotation=(0, 0, angle),
        )


def build_outer_arcades(scene, mats):
    # A broad helical silhouette. Gameplay collision remains in the authored map boxes.
    for index in range(24):
        angle = index * 2 * pi / 24
        radius = 18.0
        height = 1.5 + index * 0.72
        x, y = radius * cos(angle), radius * sin(angle)
        cube(f"arcade_step_{index}_nocol", (x, y, height), (2.6, 1.8, 0.45), mats["ivory"],
             rotation=(0, 0, angle))
        cube(
            f"arcade_safe_ribbon_{index}_nocol",
            (x, y, height + 0.52),
            (2.2, 0.18, 0.12),
            mats["cyan"],
            rotation=(0, 0, angle),
        )
        if index % 3 == 0:
            cylinder(f"arcade_beacon_{index}_nocol", (x, y, height + 3.2), 0.38, 5,
                     mats["brass"], 10)
            sphere(f"arcade_light_{index}_nocol", (x, y, height + 6),
                   (0.48, 0.48, 0.48), mats["cyan"])
            cone(
                f"arcade_direction_{index}_nocol",
                (x, y, height + 1.4),
                0.75,
                0,
                1.8,
                mats["gold"],
                8,
                rotation=(0, pi / 2, angle + pi / 2),
            )
    torus("arcade_lower_rail_nocol", (0, 0, 2), 18, 0.35, mats["brass"], segments=36)
    torus("arcade_upper_rail_nocol", (0, 0, 18), 18, 0.35, mats["gold"], segments=36)


def build_meridian_bridges(scene, mats):
    torus("meridian_bridge_frame_nocol", (0, 0, 9), 8.8, 0.55, mats["brass"],
          rotation=(pi / 2, 0, 0), segments=28)
    rig = empty("MeridianBridgeRig", (0, 0, 0))
    panel = cube("meridian_bridge_collision", (0, 0, 7), (7.8, 0.55, 7), mats["obsidian"])
    rail_a = cube("meridian_bridge_rail_a_nocol", (0, -0.72, 1.2), (7.8, 0.12, 0.28), mats["cyan"])
    rail_b = cube("meridian_bridge_rail_b_nocol", (0, -0.72, 12.8), (7.8, 0.12, 0.28), mats["gold"])
    for obj in (panel, rail_a, rail_b):
        parent_keep_world(obj, rig)
    countdown_beacons(scene, "meridian_bridge", ((-2.2, -0.8, 17.2), (0, -0.8, 17.2), (2.2, -0.8, 17.2)), mats)
    animate_open_window(scene, rig, (0, 0, 0), [(17, 0, 0), (-17, 0, 0)])


def build_astrolabe_gate(scene, mats):
    torus("astrolabe_outer_nocol", (0, 0, 9), 9.0, 0.62, mats["ivory"],
          rotation=(pi / 2, 0, 0), segments=32)
    rig = empty("AstrolabeGateRig", (0, 0, 0))
    for index, z in enumerate((2.0, 6.5, 11.0, 15.5)):
        bar = cube(f"astrolabe_bar_{index}", (0, 0, z), (8.1, 0.5, 1.65), mats["brass"])
        marker = sphere(f"astrolabe_marker_{index}_nocol", (-6.8 + index * 4.5, -0.62, z),
                        (0.35, 0.2, 0.35), mats["cyan"])
        parent_keep_world(bar, rig)
        parent_keep_world(marker, rig)
    countdown_beacons(scene, "astrolabe", ((-2.2, -0.8, 18.2), (0, -0.8, 18.2), (2.2, -0.8, 18.2)), mats)
    animate_open_window(scene, rig, (0, 0, 0), [(-18, 0, 0), (18, 0, 0), (0, 0, 19)])


def build_eclipse_iris(scene, mats):
    torus("eclipse_iris_frame_nocol", (0, 0, 9), 9.2, 0.7, mats["ivory"],
          rotation=(pi / 2, 0, 0), segments=32)
    for index in range(8):
        angle = index * pi / 4
        closed = (3.0 * cos(angle), 0, 9 + 3.0 * sin(angle))
        opened = (11.5 * cos(angle), 0, 9 + 11.5 * sin(angle))
        rig = empty(f"EclipseBlade{index}", closed)
        blade = cube(f"eclipse_blade_{index}", closed, (3.3, 0.48, 2.3), mats["violet"],
                     rotation=(0, -angle, 0))
        signal = cube(f"eclipse_signal_{index}_nocol", closed, (2.4, 0.58, 0.14), mats["gold"],
                      rotation=(0, -angle, 0))
        parent_keep_world(blade, rig)
        parent_keep_world(signal, rig)
        animate_open_window(scene, rig, closed, opened)
    countdown_beacons(scene, "eclipse_iris", ((-2.2, -0.8, 18.2), (0, -0.8, 18.2), (2.2, -0.8, 18.2)), mats)


def build_comet_pendulum(scene, mats):
    cube("pendulum_header_nocol", (0, 0, 17.5), (9.5, 0.8, 0.6), mats["ivory"])
    for index, x in enumerate((-5.5, 0, 5.5)):
        pivot = (x, 0, 17)
        rig = empty(f"CometPendulum{index}", pivot)
        stem = cube(f"comet_stem_{index}", (x, 0, 9), (0.55, 0.55, 8), mats["brass"])
        comet = sphere(f"comet_head_{index}_nocol", (x, -0.2, 1.5),
                       (1.7, 0.9, 1.7), mats["cyan"], 14, 7)
        parent_keep_world(stem, rig)
        parent_keep_world(comet, rig)
        direction = -1 if index % 2 else 1
        start = scene.frame_start
        half = (scene.frame_end - scene.frame_start) / 2
        keyframe(rig, start, rotation=(0, direction * 0.72, 0))
        keyframe(rig, start + half, rotation=(0, -direction * 0.72, 0))
        keyframe(rig, scene.frame_end, rotation=(0, direction * 0.72, 0))
    countdown_beacons(scene, "comet", ((-2.2, -0.9, 18.6), (0, -0.9, 18.6), (2.2, -0.9, 18.6)), mats)


def build_zodiac_louvre(scene, mats):
    cube("zodiac_louvre_frame_top_nocol", (0, 0, 17.5), (9.5, 0.8, 0.6), mats["ivory"])
    cube("zodiac_louvre_frame_bottom_nocol", (0, 0, 0.5), (9.5, 0.8, 0.5), mats["ivory"])
    for index, x in enumerate((-6.4, -3.2, 0, 3.2, 6.4)):
        closed = (x, 0, 9)
        opened = (x + (-12 if x <= 0 else 12), 0, 9)
        rig = empty(f"ZodiacLouvre{index}", closed)
        slat = cube(f"zodiac_slat_{index}", closed, (1.45, 0.48, 8), mats["obsidian"])
        glyph = torus(f"zodiac_glyph_{index}_nocol", (x, -0.58, 9), 0.75, 0.12,
                      mats["gold"], rotation=(pi / 2, 0, 0), segments=14)
        parent_keep_world(slat, rig)
        parent_keep_world(glyph, rig)
        animate_open_window(scene, rig, closed, opened)
    countdown_beacons(scene, "zodiac", ((-2.2, -0.9, 18.6), (0, -0.9, 18.6), (2.2, -0.9, 18.6)), mats)


def build_celestial_core(scene, mats):
    core = empty("CelestialCoreRig", (0, 0, 10))
    sphere("celestial_star_nocol", (0, 0, 10), (4.6, 4.6, 4.6), mats["cyan"], 24, 12)
    sphere("celestial_eclipse_nocol", (0, -4.2, 10), (2.7, 0.7, 2.7), mats["obsidian"], 18, 9)
    for index, (radius, mat_name) in enumerate(((7, "gold"), (11, "brass"), (15, "violet"))):
        ring = torus(f"celestial_orbit_{index}_nocol", (0, 0, 10), radius, 0.28,
                     mats[mat_name], rotation=(pi / 2, index * 0.38, 0), segments=32)
        parent_keep_world(ring, core)
    start = scene.frame_start
    keyframe(core, start, rotation=(0, 0, 0))
    keyframe(core, scene.frame_end, rotation=(0, 0, 2 * pi))


ASSETS = (
    ("01_stellar_foundry", None, 0, build_stellar_foundry),
    ("02_meridian_gallery", None, 0, build_meridian_gallery),
    ("03_eclipse_crown", None, 0, build_eclipse_crown),
    ("04_outer_arcades", None, 0, build_outer_arcades),
    ("05_meridian_bridges", "MeridianBridgeLoop", 24, build_meridian_bridges),
    ("06_astrolabe_gate", "AstrolabeGateLoop", 36, build_astrolabe_gate),
    ("07_eclipse_iris", "EclipseIrisLoop", 12, build_eclipse_iris),
    ("08_comet_pendulum", "CometPendulumLoop", 24, build_comet_pendulum),
    ("09_zodiac_louvre", "ZodiacLouvreLoop", 12, build_zodiac_louvre),
    ("10_celestial_core", "CelestialCoreLoop", 36, build_celestial_core),
)


def export_asset(file_stem, clip_name, duration, builder):
    scene = reset_scene(clip_name or file_stem, duration)
    builder(scene, build_materials())
    scene.frame_set(scene.frame_start)
    blend_path = SOURCE_DIR / f"{file_stem}.blend"
    glb_path = GLB_DIR / f"{file_stem}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)
    export_options = dict(
        filepath=str(glb_path),
        export_format="GLB",
        export_animations=bool(clip_name),
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )
    if clip_name:
        export_options.update(
            export_animation_mode="SCENE",
            export_anim_scene_split_object=False,
            export_anim_slide_to_zero=True,
        )
    bpy.ops.export_scene.gltf(**export_options)
    print(f"generated {blend_path.relative_to(ROOT)} and {glb_path.relative_to(ROOT)}")


def main():
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    GLB_DIR.mkdir(parents=True, exist_ok=True)
    for asset in ASSETS:
        export_asset(*asset)


if __name__ == "__main__":
    main()
