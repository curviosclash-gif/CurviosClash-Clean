"""Reproducible Notre-Dame collapse clips built from the existing cathedral GLBs.
Blender --background --python-exit-code 1 --python scripts/generate_notre_dame_evolution_assets.py
"""
import bpy
from mathutils import Euler, Vector
from math import cos, sin, pi
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/maps/notre_dame_evolution"
FPS = 24


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / path))
    meshes = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.data.transform(obj.matrix_world)
        obj.matrix_world.identity()
        obj.animation_data_clear()
    return meshes


def fragment(obj, faces, name):
    used = sorted({v for f in faces for v in f.vertices})
    remap = {v: i for i, v in enumerate(used)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([obj.data.vertices[i].co for i in used], [],
                     [[remap[v] for v in f.vertices] for f in faces])
    for mat in obj.data.materials:
        mesh.materials.append(mat)
    for dst, src in zip(mesh.polygons, faces):
        dst.material_index = src.material_index
        dst.use_smooth = src.use_smooth
    result = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(result)
    return result


def closed_box(name, minimum, maximum):
    bounds = [list(minimum), list(maximum)]
    for axis in range(3):
        if bounds[1][axis] - bounds[0][axis] < .18:
            centre = (bounds[0][axis] + bounds[1][axis]) * .5
            bounds[0][axis], bounds[1][axis] = centre - .09, centre + .09
    (x0, y0, z0), (x1, y1, z1) = bounds
    vertices = [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),
                (x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    collider = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(collider)
    return collider


def animate_transforms(objects, poses):
    for obj in objects:
        for frame, location, scale, rotation in poses:
            obj.location = location
            obj.scale = scale
            obj.rotation_euler = rotation
            obj.keyframe_insert('location', frame=frame)
            obj.keyframe_insert('scale', frame=frame)
            obj.keyframe_insert('rotation_euler', frame=frame)
        for curve in obj.animation_data.action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'


def centered_collision_pair(obj, name):
    """Center visible geometry and add its closed, hidden collision envelope."""
    collision_name = name.lower().replace('_nocol', '').replace('_colonly', '')
    original = [vertex.co.copy() for vertex in obj.data.vertices]
    centre = sum(original, Vector()) / len(original)
    for vertex in obj.data.vertices:
        vertex.co -= centre
    obj.location = centre
    obj.name = f'{collision_name}_nocol'
    minimum = [min(v[i] for v in (vertex.co for vertex in obj.data.vertices)) for i in range(3)]
    maximum = [max(v[i] for v in (vertex.co for vertex in obj.data.vertices)) for i in range(3)]
    collider = closed_box(f'{collision_name}_colonly', minimum, maximum)
    collider.location = centre
    return centre, collider


def pose_fall(obj, side, index, animate=True):
    centre, collider = centered_collision_pair(obj, obj.name)
    # Towers fall toward the side they occupy, with their rubble kept inside the footprint.
    destination = Vector((centre.x - 3 - index % 3, side * (12 + index % 5 * 1.5), 0))
    final_scale = (0.7, 0.7, 0.7)
    fall_rotation = Euler((-side * 1.2, 0, 0))
    lowest_local_z = min((fall_rotation.to_matrix() @ vertex.co).z
                         for mesh in (obj.data, collider.data) for vertex in mesh.vertices)
    destination.z = .45 - lowest_local_z * final_scale[2]
    if animate:
        poses = [(1, centre, (1,1,1), (0,0,0)),
                 (13, centre + Vector((0, side * .2, 0)), (1,1,1), (0,0,0)),
                 (121, destination, final_scale, fall_rotation),
                 (145, destination, final_scale, fall_rotation)]
        animate_transforms([obj, collider], poses)
    else:
        obj.location = collider.location = destination
        obj.scale = collider.scale = final_scale
        obj.rotation_euler = collider.rotation_euler = fall_rotation


def build_facade(stage):
    meshes = load('assets/maps/notre_dame/glb/01_west_facade.glb')
    for obj in meshes:
        bins = {}
        for face in obj.data.polygons:
            centre = sum((obj.data.vertices[i].co for i in face.vertices), Vector()) / len(face.vertices)
            part = 'north' if centre.z > 46 and centre.y > 5 else 'south' if centre.z > 46 and centre.y < -5 else 'crown' if centre.z > 42 and abs(centre.y) <= 5 else 'base'
            key = (part, int(centre.z / 7), int(centre.x / 6)) if part != 'base' else ('base', 0, 0)
            bins.setdefault(key, []).append(face)
        for index, ((part, _, _), faces) in enumerate(bins.items()):
            rank = {'base': 0, 'north': 1, 'south': 2, 'crown': 3}[part]
            piece = fragment(obj, faces, f'evolution_{part}_{obj.name}_{index}')
            if rank and rank <= stage:
                pose_fall(piece, 1 if part == 'north' else -1, index, rank == stage)
            elif rank or '_colonly' in piece.name.lower():
                centered_collision_pair(piece, piece.name)
        bpy.data.objects.remove(obj, do_unlink=True)


def build_burn(part):
    replacements = {'roof': ['06_roof_burnt', '20_fleche_debris'], 'nave': ['02_nave_burnt'], 'transept': ['03_transept_burnt']}
    debris = []
    for filename in replacements[part]:
        imported = load(f'assets/maps/notre_dame_fire/glb/{filename}.glb')
        if filename == '20_fleche_debris':
            debris.extend(imported)
    if part == 'roof':
        build_fleche_fall()
        for index, obj in enumerate(debris):
            centre, collider = centered_collision_pair(obj, f'evolution_fleche_debris_{index}')
            # Debris begins beside the falling spire and settles onto the floor as it breaks.
            lift = max(0.0, 18.0 - centre.z)
            start = centre + Vector((0, 0, lift))
            minimum_z = min(vertex.co.z for vertex in obj.data.vertices) + centre.z
            if minimum_z < 0.35:
                centre.z += 0.35 - minimum_z
                obj.location = centre
                collider.location = centre
            offsets = [Vector((-22,-1,0)), Vector((-18,1,0)), Vector((-14,3,0)), Vector((-10,-3,0))]
            landing = centre + offsets[index % len(offsets)]
            poses = [(1, start, (.04,.04,.04), (0,0,0)),
                     (73, start, (.08,.08,.08), (0,0,0)),
                     (121, landing, (1,1,1), (0,0,0)),
                     (145, landing, (1,1,1), (0,0,0))]
            animate_transforms([obj, collider], poses)
    # Falling charred timber fragments, ending outside the fixed checkpoint corridors.
    mat = bpy.data.materials.new('Charred timber')
    mat.diffuse_color = (0.065, 0.035, 0.025, 1)
    mat.use_nodes = True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = mat.diffuse_color
    for i in range(12):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        obj = bpy.context.object
        obj.name = f'evolution_{part}_falling_{i}'
        if part == 'transept':
            x = 5 + (i % 4) * 4
            y = -18 + (i // 4) * 18
        else:
            x = -40 + i * (6 if part == 'roof' else 2)
            y = (-1 if i % 2 else 1) * 8
        obj.data.transform(__import__('mathutils').Matrix.Diagonal(Vector((3, .45, .45, 1))))
        for v in obj.data.vertices:
            v.co += Vector((x, y, 36 + i % 4))
        obj.data.materials.append(mat)
        centre, collider = centered_collision_pair(obj, obj.name)
        if part == 'transept':
            destination = Vector((centre.x + ((i % 3) - 1) * 1.2, centre.y * .35, .62 + (i % 3) * .08))
        else:
            side = 1 if centre.y > 0 else -1
            destination = Vector((centre.x - (i % 3) * .8, side * min(abs(centre.y) * .45, 5.0), .62 + (i % 3) * .08))
        final_scale = (.7,.7,.2)
        poses = [(1, centre, (1,1,1), (0,0,0)),
                 (13, centre, (1,1,1), (0,0,0)),
                 (121, destination, final_scale, (0,0,0)),
                 (145, destination, final_scale, (0,0,0))]
        animate_transforms([obj, collider], poses)


def build_fleche_fall():
    imported = load('assets/maps/notre_dame/glb/06_roof_fleche.glb')
    selected = []
    for obj in imported:
        lower = obj.name.lower()
        if 'lead' in lower:
            faces = []
            for face in obj.data.polygons:
                centre = sum((obj.data.vertices[i].co for i in face.vertices), Vector()) / len(face.vertices)
                if 6 <= centre.x <= 18 and abs(centre.y) <= 5 and centre.z >= 49:
                    faces.append(face)
            if faces:
                selected.append(fragment(obj, faces, f'{obj.name}_falling'))
        elif any(part in lower for part in ('copper', 'gold')):
            points = [Vector(point) for point in obj.bound_box]
            width = max(point.x for point in points) - min(point.x for point in points)
            if width < 24:
                selected.append(obj)
        if obj not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not selected:
        raise ValueError('Could not isolate the Notre-Dame fleche from 06_roof_fleche.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.object.join()
    fleche = bpy.context.object
    fleche.name = 'evolution_fleche_falling_nocol'
    # Joining imported GLTF meshes preserves their quaternion rotation mode.
    # The shared animation helper inserts Euler curves, so select XYZ explicitly
    # before creating the rotation_euler keyframes.
    fleche.rotation_mode = 'XYZ'
    # Pivot the assembled spire at its foot so the collapse reads as a fall, not a teleport.
    pivot = Vector((12, 0, 49))
    bpy.context.scene.cursor.location = pivot
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    fleche.location = pivot
    local_points = [v.co.copy() for v in fleche.data.vertices]
    colliders = []

    def add_envelope(name, points, padding=0.1):
        if not points:
            return
        low = [min(point[axis] for point in points) - padding for axis in range(3)]
        high = [max(point[axis] for point in points) + padding for axis in range(3)]
        collider = closed_box(name, low, high)
        collider.location = pivot
        colliders.append(collider)

    # Keep the closed envelopes on the solid shaft sections, but model the lantern as its
    # actual eight piers and ring beams. One AABB around the complete spire would fill the
    # open lantern and block the route's FINISH while the roof fragment starts to fall.
    add_envelope('evolution_fleche_lower_colonly',
                 [point for point in local_points if point.z <= 20.0])
    add_envelope('evolution_fleche_upper_colonly',
                 [point for point in local_points if point.z >= 28.0])
    lantern_radius = 3.8
    for index in range(8):
        angle = index * (2 * pi / 8)
        x = lantern_radius * cos(angle)
        y = lantern_radius * sin(angle)
        add_envelope(f'evolution_fleche_lantern_pier_{index}_colonly', [
            Vector((x - 0.42, y - 0.42, 20.0)), Vector((x + 0.42, y + 0.42, 28.0)),
        ], 0)
        next_angle = (index + 1) * (2 * pi / 8)
        next_x = lantern_radius * cos(next_angle)
        next_y = lantern_radius * sin(next_angle)
        for ring_z in (20.25, 27.75):
            add_envelope(f'evolution_fleche_lantern_ring_{ring_z}_{index}_colonly', [
                Vector((min(x, next_x) - 0.25, min(y, next_y) - 0.25, ring_z - 0.3)),
                Vector((max(x, next_x) + 0.25, max(y, next_y) + 0.25, ring_z + 0.3)),
            ], 0)
    # Tip the spire westward, away from CP11_CHOIR on the route's east side.
    fall_rotation = (0, -1.15, 0)
    # Rotate about the foot and raise the landing pivot enough to keep all geometry above z=0.
    rotated_z = [(__import__('mathutils').Matrix.Rotation(-1.15, 4, 'Y') @ point).z for point in local_points]
    landing_z = max(.7, -min(rotated_z) + .25)
    # Move the full visible/collision assembly west of CP11. Moving only the
    # origin changes the rotation arc but leaves the bind pose in place.
    fall_pivot = Vector((pivot.x - 1.0, pivot.y, pivot.z))
    start = (1, fall_pivot, (1,1,1), (0,0,0))
    loosen = (13, fall_pivot, (1,1,1), (0,0,0))
    landed = (121, Vector((fall_pivot.x, fall_pivot.y, landing_z)), (1,1,1), fall_rotation)
    finish = (145, Vector((fall_pivot.x, fall_pivot.y, landing_z)), (1,1,1), fall_rotation)
    animate_transforms([fleche, *colliders], [start, loosen, landed, finish])


def export(name, builder):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.name = 'NotreDameCollapse'
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, 145
    builder()
    scene.frame_set(1)
    meshes = [obj for obj in scene.objects if obj.type == 'MESH']
    points = [obj.matrix_world @ Vector(p) for obj in meshes for p in obj.bound_box]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    # The collection loader centres X/Z and grounds Y from this initial-pose box.
    position = [(low[0]+high[0])*.7, 8+low[2]*1.4, -(low[1]+high[1])*.7]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'blender' / (name+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'glb'/(name+'.glb')), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='SCENE', export_anim_scene_split_object=False,
        export_anim_slide_to_zero=True, export_yup=True, export_cameras=False, export_lights=False, export_apply=True)
    return dict(id='notre-dame-evolution-'+name, url=f'assets/maps/notre_dame_evolution/glb/{name}.glb',
        position=position, rotation=[0,0,0], scale=1.4, hiddenUntilTriggered=True,
        fixedTriggeredPlacement=True,
        animationClock=dict(mode='once', clipName='NotreDameCollapse'))


def main(parts=None, output_dir=None):
    global OUT
    destination = Path(output_dir).resolve() if output_dir else ROOT
    OUT = destination / "assets/maps/notre_dame_evolution"
    for directory in ['blender','glb']:
        (OUT/directory).mkdir(parents=True, exist_ok=True)
    selected = set(parts or ['roof','nave','transept','north','south','crown'])
    if selected - {'roof','nave','transept','north','south','crown'}:
        raise ValueError('Unknown Notre-Dame evolution part')
    models = [export(part, lambda part=part: build_burn(part)) for part in ['roof','nave','transept'] if part in selected]
    models += [export(name, lambda stage=stage: build_facade(stage)) for stage,name in enumerate(['north','south','crown'], 1) if name in selected]
    target = destination/'src/core/config/maps/presets/notre_dame/NotreDameEvolutionModels.js'
    target.parent.mkdir(parents=True, exist_ok=True)
    header = '// Generated by generate_notre_dame_evolution_assets.py; initial-pose bounds determine placement.\nexport const NOTRE_DAME_EVOLUTION_MODELS = '
    if parts:
        existing = target.read_text(encoding='utf-8')
        current = json.loads(existing.split(header, 1)[1].rsplit(';', 1)[0])
        replacements = {model['id']: model for model in models}
        current = [replacements.pop(model['id'], model) for model in current]
        current.extend(replacements.values())
        models = current
    target.write_text(header+json.dumps(models, indent=4)+';\n', encoding='utf-8')

if __name__ == '__main__':
    main()
