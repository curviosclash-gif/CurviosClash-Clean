"""Build deterministic, editable Skyline Siege buildings and their fall clips with Blender."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
FPS = 30
PARTS = ('01_spire', '20_spire_collapse', '01_crown', '20_crown_collapse',
         '01_arcology', '20_arcology_collapse', '00_static_backdrop')


def material(name, color, emission=0.0, metallic=0.2):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = 0.34
    shader.inputs['Emission Color'].default_value = (*color, 1)
    shader.inputs['Emission Strength'].default_value = emission
    return mat


def box(name, dims, loc, mat, parent):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj


def reset(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.name = name
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 120
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def build(style, collapse):
    label, prefix = style
    scene = reset(f'Skyline{label}CollapseOnce' if collapse else f'Skyline{label}Intact')
    root = bpy.data.objects.new(f'skyline_{prefix}_root', None)
    scene.collection.objects.link(root)
    shell = material(f'{label} titanium glass', (0.11, 0.19, 0.32), metallic=0.72)
    trim = material(f'{label} alloy', (0.31, 0.41, 0.55), metallic=0.84)
    windows = material(f'{label} neon windows', (0.08, 0.74, 1.0), emission=2.6, metallic=0.1)
    roof = material(f'{label} rooftop signal', (1.0, 0.12, 0.33), emission=3.2, metallic=0.15)

    heights = {'spire': (68, 17, 11), 'crown': (58, 25, 13), 'arcology': (51, 34, 16)}
    height, width, depth = heights[prefix]
    main = box(f'skyline_{prefix}_structure', (width, depth, height), (0, 0, height / 2), shell, root)
    # Distinct stepped silhouettes keep all three landmarks readable from the arena floor.
    if prefix == 'spire':
        for level in range(5):
            z = height * (0.3 + level * 0.13)
            ring = box(f'skyline_{prefix}_spire_belt_{level}',
                       (width + 2.2, depth + 2.2, 1.5), (0, 0, z), trim, root)
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=width * 0.48, radius2=0.15,
                                       depth=height * 0.2, location=(0, 0, height * 1.08))
        obj = bpy.context.object
        obj.name = f'skyline_{prefix}_spire_tip'
        obj.data.materials.append(trim)
        obj.parent = root
    elif prefix == 'crown':
        for level in range(4):
            z = height * (0.35 + level * 0.14)
            factor = 1.0 - level * 0.12
            box(f'skyline_{prefix}_terrace_{level}', (width * factor, depth * factor, 3),
                (0, 0, z), trim, root)
    else:
        for side in (-1, 1):
            box(f'skyline_{prefix}_arc_{side}', (2.4, depth + 7, height * 0.86),
                (side * (width * 0.58), 0, height * 0.5), trim, root)
        box(f'skyline_{prefix}_skybridge', (width * 1.3, 7, 5), (0, 0, height * 0.48), trim, root)

    # Recess-free emissive window ribbons add nighttime scale without a texture dependency.
    floors = int(height // 5)
    for floor in range(2, floors):
        z = floor * 5
        for side in (-1, 1):
            box(f'skyline_{prefix}_window_{floor}_{side}_nocol', (width * 0.76, 0.18, 0.75),
                (0, side * (depth / 2 + 0.11), z), windows if floor % 3 else roof, root)
        if floor % 2 == 0:
            for side in (-1, 1):
                box(f'skyline_{prefix}_sidewindow_{floor}_{side}_nocol', (0.18, depth * 0.72, 0.75),
                    (side * (width / 2 + 0.11), 0, z), windows, root)

    box(f'skyline_{prefix}_roof_signal', (2.5, 2.5, 3), (0, 0, height + 2), roof, root)
    if collapse:
        scene.frame_set(1)
        root.rotation_mode = 'XYZ'
        root.location = (0, 0, 0)
        root.rotation_euler = (0, 0, 0)
        root.keyframe_insert(data_path='location', frame=1)
        root.keyframe_insert(data_path='rotation_euler', frame=1)
        # Keep the footprint at street level; the rotation around the authored foot does the
        # collapse, and a downward root offset would bury the entire wreck below the map floor.
        root.location = (height * 0.1, 0, 0)
        root.rotation_euler = (math.radians(77), 0, 0)
        root.keyframe_insert(data_path='location', frame=scene.frame_end)
        root.keyframe_insert(data_path='rotation_euler', frame=scene.frame_end)
        root.animation_data.action.name = f'Skyline{label}CollapseOnce'
        for curve in root.animation_data.action.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = 'BEZIER'
    return scene


def export(style, collapse):
    label, prefix = style
    stem = f'20_{prefix}_collapse' if collapse else f'01_{prefix}'
    scene = build(style, collapse)
    source = ROOT / 'assets/maps/skyline_siege/blender'
    runtime = ROOT / 'assets/maps/skyline_siege/glb'
    source.mkdir(parents=True, exist_ok=True)
    runtime.mkdir(parents=True, exist_ok=True)
    blend = source / f'{stem}.blend'
    glb = runtime / f'{stem}.glb'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        if obj.type in {'MESH', 'EMPTY'}:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
        export_animations=collapse, export_animation_mode='SCENE', export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True, export_yup=True,
        export_cameras=False, export_lights=False, export_extras=True, export_apply=True)
    tris = sum(len(poly.vertices) - 2 for obj in scene.objects if obj.type == 'MESH' for poly in obj.data.polygons)
    print(f'generated {stem}: objects={len(scene.objects)} triangles~={tris} glb={glb.stat().st_size}')


def build_backdrop():
    """Build low, static perimeter blocks while preserving broad central flight lanes."""
    scene = reset('SkylineStaticBackdrop')
    shell = material('Backdrop midnight concrete', (0.16, 0.24, 0.38), metallic=0.18)
    trim = material('Backdrop roof alloy', (0.34, 0.48, 0.68), metallic=0.3)
    windows = material('Backdrop window bands', (0.025, 0.42, 0.62), emission=2.2, metallic=0.05)
    root = bpy.data.objects.new('skyline_static_backdrop_root_nocol_noshadow', None)
    scene.collection.objects.link(root)

    # Blender-authored dimensions are scaled to 20% at runtime. A 320-unit ring becomes
    # a 64-unit city edge, leaving a wide central arena and clear diagonal flight corridors.
    edges = (
        ('north', [(x, -330) for x in (-330, -210, -90, 90, 210, 330)]),
        ('south', [(x, 330) for x in (-330, -210, -90, 90, 210, 330)]),
        ('west', [(-330, z) for z in (-210, -70, 90, 230)]),
        ('east', [(330, z) for z in (-230, -90, 70, 210)]),
    )
    for edge_index, (edge, locations) in enumerate(edges):
        for index, (x, y) in enumerate(locations):
            seed = edge_index * 7 + index
            width = 62 + (seed % 3) * 12
            depth = 55 + ((seed + 1) % 3) * 12
            height = 22 + (seed * 13 % 23)
            body = box(f'skyline_backdrop_{edge}_{index}_body_nocol_noshadow',
                       (width, depth, height), (x, y, height / 2), shell, root)
            roof_height = 2.4
            roof = box(f'skyline_backdrop_{edge}_{index}_roof_nocol_noshadow',
                       (width + 3, depth + 3, roof_height), (x, y, height + roof_height / 2), trim, root)
            # Two thin, emissive side ribbons suggest windows without adding dense facade meshes.
            for side in (-1, 1):
                strip = box(f'skyline_backdrop_{edge}_{index}_windows_{side}_nocol_noshadow',
                            (width * 0.68, 0.6, 0.9),
                            (x, y + side * (depth / 2 + 0.35), height * 0.58), windows, root)
    return scene


def export_backdrop():
    scene = build_backdrop()
    source = ROOT / 'assets/maps/skyline_siege/blender'
    runtime = ROOT / 'assets/maps/skyline_siege/glb'
    source.mkdir(parents=True, exist_ok=True)
    runtime.mkdir(parents=True, exist_ok=True)
    blend = source / '00_static_backdrop.blend'
    glb = runtime / '00_static_backdrop.glb'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        if obj.type in {'MESH', 'EMPTY'}:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
        export_animations=False, export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True, export_apply=True)
    tris = sum(len(poly.vertices) - 2 for obj in scene.objects if obj.type == 'MESH' for poly in obj.data.polygons)
    print(f'generated static backdrop: objects={len(scene.objects)} triangles~={tris} glb={glb.stat().st_size}')


def validate_backdrop_roundtrip():
    """Import the exported GLB into a clean Blender scene and verify its authored envelope."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    glb = ROOT / 'assets/maps/skyline_siege/glb/00_static_backdrop.glb'
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if len(meshes) < 60 or any('_nocol' not in obj.name for obj in meshes):
        raise RuntimeError(f'backdrop roundtrip lost geometry or no-collision names: meshes={len(meshes)}')
    depsgraph = bpy.context.evaluated_depsgraph_get()
    corners = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    extent = maximum - minimum
    if not (extent.x > 700 and extent.y > 700 and 20 < extent.z < 55):
        raise RuntimeError(f'backdrop roundtrip bounds are unexpected: {tuple(extent)}')
    if any(obj.animation_data for obj in bpy.context.scene.objects):
        raise RuntimeError('the static backdrop unexpectedly contains animation')
    print(f'backdrop GLB roundtrip OK: meshes={len(meshes)} bounds={tuple(extent)}')


def render_composite_preview():
    """Render the actual exported backdrop and three intact towers in their runtime positions."""
    reset('SkylineSiegeCompositePreview')
    assets = ROOT / 'assets/maps/skyline_siege/glb'
    placements = [
        ('00_static_backdrop.glb', (0, 4, 0), 0.2),
        ('01_spire.glb', (-32, 4, 0), 0.2),
        ('01_crown.glb', (0, 4, 18), 0.2),
        ('01_arcology.glb', (32, 4, -16), 0.2),
    ]
    for filename, position, scale in placements:
        bpy.ops.import_scene.gltf(filepath=str(assets / filename))
        imported = list(bpy.context.selected_objects)
        for obj in imported:
            obj.location.x += position[0]
            obj.location.y += position[2]
            obj.location.z += position[1]
            obj.scale *= scale
    scene = bpy.context.scene
    floor = material('Preview arena floor', (0.035, 0.055, 0.09), metallic=0.05)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 3.7))
    ground = bpy.context.object
    ground.name = 'SkylinePreviewArenaFloor'
    ground.dimensions = (180, 180, 0.6)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ground.data.materials.append(floor)
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('SkylineCompositeWorld')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs['Color'].default_value = (0.055, 0.09, 0.16, 1)
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0.8
    center = Vector((0, 6, 0))
    camera_data = bpy.data.cameras.new('SkylineCompositeCameraData')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 188
    camera_data.clip_start = 0.1
    camera_data.clip_end = 2000
    camera = bpy.data.objects.new('SkylineCompositeCamera', camera_data)
    scene.collection.objects.link(camera)
    camera.location = (175, 230, 260)
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    for name, location, energy, size in (
        ('CompositeKey', (100, -80, 180), 180000, 180),
        ('CompositeFill', (-160, 120, 110), 100000, 220),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    sun_data = bpy.data.lights.new('CompositeSunData', 'SUN')
    sun_data.energy = 3.0
    sun = bpy.data.objects.new('CompositeSun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (Vector((0, 0, 0)) - Vector((1, 1, 2))).to_track_quat('-Z', 'Y').to_euler()
    output = ROOT / 'assets/maps/skyline_siege/blender/previews/skyline_siege_composite.png'
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    print(f'rendered composite map preview: {output}')


def generate(parts=None):
    selected = set(parts or PARTS)
    unknown = selected - set(PARTS)
    if unknown:
        raise ValueError(f'Unknown skyline assets: {sorted(unknown)}')
    if '00_static_backdrop' in selected:
        export_backdrop()
    for prefix, label in (('spire', 'Spire'), ('crown', 'Crown'), ('arcology', 'Arcology')):
        for kind in ('intact', 'collapse'):
            part = f'01_{prefix}' if kind == 'intact' else f'20_{prefix}_collapse'
            if part in selected:
                export((label, prefix), kind == 'collapse')


def render_previews():
    """Render four readable orthographic angles for each intact tower source scene."""
    for prefix, label in (('spire', 'Spire'), ('crown', 'Crown'), ('arcology', 'Arcology')):
        scene = build((label, prefix), False)
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        scene.render.resolution_x = 512
        scene.render.resolution_y = 512
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.image_settings.color_depth = '8'
        scene.render.resolution_percentage = 100

        meshes = [obj for obj in scene.objects if obj.type == 'MESH']
        depsgraph = bpy.context.evaluated_depsgraph_get()
        corners = []
        for obj in meshes:
            evaluated = obj.evaluated_get(depsgraph)
            corners.extend(evaluated.matrix_world @ Vector(corner)
                           for corner in evaluated.bound_box)
        minimum = [min(point[axis] for point in corners) for axis in range(3)]
        maximum = [max(point[axis] for point in corners) for axis in range(3)]
        center = Vector(tuple((minimum[axis] + maximum[axis]) * 0.5 for axis in range(3)))
        span = max(maximum[axis] - minimum[axis] for axis in range(3))

        world = scene.world
        if world is None:
            world = bpy.data.worlds.new('SkylinePreviewWorld')
            scene.world = world
        world.use_nodes = True
        background = world.node_tree.nodes.get('Background')
        background.inputs['Color'].default_value = (0.018, 0.026, 0.055, 1)
        background.inputs['Strength'].default_value = 0.35

        camera_data = bpy.data.cameras.new('SkylinePreviewCameraData')
        camera_data.type = 'ORTHO'
        camera_data.ortho_scale = span * 1.55
        camera_data.clip_start = 0.01
        camera_data.clip_end = max(1000.0, span * 8.0)
        camera = bpy.data.objects.new('SkylinePreviewCamera', camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera

        for name, offset, energy, size in (
            ('SkylinePreviewKey', Vector((span * 0.8, -span * 1.4, span * 1.6)), span * span * 4.5, span * 0.85),
            ('SkylinePreviewFill', Vector((-span * 1.1, span * 0.8, span * 0.7)), span * span * 2.0, span * 1.1),
        ):
            data = bpy.data.lights.new(f'{name}Data', 'AREA')
            data.energy = energy
            data.shape = 'DISK'
            data.size = size
            light = bpy.data.objects.new(name, data)
            scene.collection.objects.link(light)
            light.location = center + offset
            light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()

        output = ROOT / 'assets' / 'maps' / 'skyline_siege' / 'blender' / 'previews' / f'01_{prefix}'
        output.mkdir(parents=True, exist_ok=True)
        for index in range(4):
            azimuth = math.tau * index / 4
            camera.location = center + Vector((math.cos(azimuth) * span * 2.1,
                                                math.sin(azimuth) * span * 2.1, span * 0.28))
            camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(output / f'view_{index:02d}_{index * 90:03d}deg.png')
            bpy.ops.render.render(write_still=True)
        print(f'rendered {label} previews: views=4 bounds={minimum}..{maximum} path={output}')


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if args == ['--previews']:
        render_previews()
    elif args == ['--composite-preview']:
        render_composite_preview()
    elif args == ['--validate-backdrop']:
        validate_backdrop_roundtrip()
    else:
        generate(set(args) or None)
