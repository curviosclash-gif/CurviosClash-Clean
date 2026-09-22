"""Reproducible Notre-Dame collapse clips built from the existing cathedral GLBs.
Blender --background --python-exit-code 1 --python scripts/generate_notre_dame_evolution_assets.py
"""
import bpy
from mathutils import Vector
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


def pose_fall(obj, side, index, animate=True):
    coords = [v.co for v in obj.data.vertices]
    centre = sum(coords, Vector()) / len(coords)
    for vertex in obj.data.vertices:
        vertex.co -= centre
    obj.location = centre
    # Keep the central west portal and rose flight corridors free of fallen masonry.
    destination = Vector((centre.x - 3 - index % 3, side * (29 + index % 5 * 2), 1.2 + index % 3))
    final_scale = (0.7, 0.7, 0.2)
    if animate:
        for frame, location, scale in [(1, centre, (1, 1, 1)),
                                       (13, centre + Vector((0, side * 0.2, 0)), (1, 1, 1)),
                                       (121, destination, final_scale), (145, destination, final_scale)]:
            obj.location = location
            obj.scale = scale
            obj.keyframe_insert('location', frame=frame)
            obj.keyframe_insert('scale', frame=frame)
        for curve in obj.animation_data.action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
    else:
        obj.location = destination
        obj.scale = final_scale


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
        bpy.data.objects.remove(obj, do_unlink=True)


def build_burn(part):
    replacements = {'roof': ['06_roof_burnt', '20_fleche_debris'], 'nave': ['02_nave_burnt'], 'transept': ['03_transept_burnt']}
    for filename in replacements[part]:
        load(f'assets/maps/notre_dame_fire/glb/{filename}.glb')
    if part == 'roof':
        sites = [
            ('14_tarpaulin_wall', [-150, 8, 0]), ('17_rose_ring', [-93.6, 32.2, 0]),
            ('11_scaffold_lift', [-40, 8, 45]), ('15_vault_gantry', [-35, 8, 0]),
            ('16_bell_swing', [-83, 78, -20.3]), ('12_stone_hoist', [-10, 8, -55]),
            ('10_tower_crane', [32.3, 8, -90]), ('13_fleche_hoist', [130, 8, 0]),
        ]
        for stem, position in sites:
            meshes = load(f'assets/maps/notre_dame/glb/{stem}.glb')
            points = [v.co for obj in meshes for v in obj.data.vertices]
            low = [min(v[i] for v in points) for i in range(3)]
            high = [max(v[i] for v in points) for i in range(3)]
            offset = Vector((position[0]/1.4-(low[0]+high[0])/2,
                             -position[2]/1.4-(low[1]+high[1])/2, (position[1]-8)/1.4-low[2]))
            for index, obj in enumerate(meshes):
                obj.name = 'evolution_site_' + obj.name
                for v in obj.data.vertices:
                    v.co += offset
                pose_fall(obj, 1 if index % 2 else -1, index)
    # Falling charred timber fragments, ending outside the fixed checkpoint corridors.
    mat = bpy.data.materials.new('Charred timber')
    mat.diffuse_color = (0.065, 0.035, 0.025, 1)
    mat.use_nodes = True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = mat.diffuse_color
    for i in range(12):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        obj = bpy.context.object
        obj.name = f'evolution_{part}_falling_{i}'
        x = (-40 + i * 6) if part == 'roof' else (-40 + i * 2 if part == 'nave' else 12)
        obj.data.transform(__import__('mathutils').Matrix.Diagonal(Vector((3, .45, .45, 1))))
        for v in obj.data.vertices:
            v.co += Vector((x, (-1 if i % 2 else 1) * 8, 36 + i % 4))
        obj.data.materials.append(mat)
        pose_fall(obj, -1 if i % 2 else 1, i)


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
    if parts:
        return  # Partial exports never overwrite placement metadata for other parts.
    target = destination/'src/core/config/maps/presets/notre_dame/NotreDameEvolutionModels.js'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('// Generated by generate_notre_dame_evolution_assets.py; initial-pose bounds determine placement.\nexport const NOTRE_DAME_EVOLUTION_MODELS = '+json.dumps(models, indent=4)+';\n', encoding='utf-8')

if __name__ == '__main__':
    main()
