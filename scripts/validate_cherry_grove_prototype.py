import json, math, struct
import os
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
FAMILY = os.environ.get('CHERRY_VALIDATION_FAMILY', 'akebono')
ASSET = ROOT / ('assets/models/sakura_kanzan' if FAMILY == 'kanzan' else 'assets/models/sakura_akebono')
RENDER_FILE = 'sakura_kanzan_grove.glb' if FAMILY == 'kanzan' else 'sakura_akebono_grove.glb'
COLLISION_FILE = 'sakura_kanzan_collision.glb' if FAMILY == 'kanzan' else 'sakura_akebono_collision.glb'
PREVIEWS = ROOT / 'assets/maps/cherry_grove/previews'
PREVIEWS.mkdir(parents=True, exist_ok=True)


def import_and_measure(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if 'FINISHED' not in result:
        raise RuntimeError(f'GLB import failed: {path}')
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not objects:
        raise RuntimeError(f'GLB imported no meshes: {path}')
    bounds = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = [min(v[i] for v in bounds) for i in range(3)]
    hi = [max(v[i] for v in bounds) for i in range(3)]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in objects)
    material_names = sorted({material.name for obj in objects for material in obj.data.materials if material})
    wind_leaf_nodes = [obj for obj in bpy.context.scene.objects if obj.get('role') == 'wind_leaf' or 'windleaf' in obj.name.lower() or 'wind leaf' in obj.name.lower()]
    return {'objects': len(objects), 'triangles': triangles, 'materials': material_names,
            'wind_leaf_nodes': len(wind_leaf_nodes), 'bounds_m': [round(hi[i] - lo[i], 4) for i in range(3)],
            'center': [(lo[i] + hi[i]) / 2 for i in range(3)]}


def render_views(metrics):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 560
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Cherry Prototype QA')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.49, 0.58, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
    scene.world = world
    center = Vector(metrics['center'])
    size = max(metrics['bounds_m'])
    camera_data = bpy.data.cameras.new('QA Camera')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = size * 1.38
    camera = bpy.data.objects.new('QA Camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    key_data = bpy.data.lights.new('QA Key', 'AREA'); key_data.energy = 1400; key_data.shape = 'DISK'; key_data.size = 9
    key = bpy.data.objects.new('QA Key', key_data); scene.collection.objects.link(key); key.location = (8, -9, 13)
    fill_data = bpy.data.lights.new('QA Fill', 'AREA'); fill_data.energy = 900; fill_data.shape = 'DISK'; fill_data.size = 10
    fill = bpy.data.objects.new('QA Fill', fill_data); scene.collection.objects.link(fill); fill.location = (-8, -4, 7)
    for name, azimuth in [('front', -math.pi / 2), ('side', 0), ('rear', math.pi / 2), ('diagonal', -math.pi / 4)]:
        camera.location = center + Vector((math.cos(azimuth) * size * 2.1, math.sin(azimuth) * size * 2.1, size * .32))
        camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PREVIEWS / f'{FAMILY}_prototype_{name}.png')
        bpy.ops.render.render(write_still=True)

render_path = ASSET / RENDER_FILE
render = import_and_measure(render_path)
glb = render_path.read_bytes()
json_length = struct.unpack_from('<I', glb, 12)[0]
gltf_json = json.loads(glb[20:20 + json_length])
wind_leaf_extras = sum(node.get('extras', {}).get('role') == 'wind_leaf' for node in gltf_json.get('nodes', []))
render['wind_leaf_extras'] = wind_leaf_extras
render['bytes'] = render_path.stat().st_size
if render['wind_leaf_nodes'] != 48 or render['wind_leaf_extras'] != 48:
    raise RuntimeError(f"Expected 48 wind leaves and extras after GLB roundtrip, got {render['wind_leaf_nodes']} nodes / {render['wind_leaf_extras']} extras")
render_views(render)
collision_path = ASSET / COLLISION_FILE
collision = import_and_measure(collision_path)
collision['bytes'] = collision_path.stat().st_size
if collision['wind_leaf_nodes'] != 0 or collision['triangles'] > 900:
    raise RuntimeError(f'Collision export is not coarse and leaf-free: {collision}')
qa_path = ASSET / ('sakura_kanzan_grove_qa.json' if FAMILY == 'kanzan' else 'qa_metrics.json')
source = json.loads(qa_path.read_text(encoding='utf-8'))
if FAMILY == 'akebono':
    source['profiles']['grove']['reimport'] = render
    source['profiles']['collision']['reimport'] = collision
    source.setdefault('checkout_availability', {})
    for name in ('sakura_akebono.blend', 'sakura_akebono.glb', 'sakura_akebono_lod1.glb', 'sakura_akebono_lod2.glb', 'sakura_akebono_collision.glb', 'sakura_akebono_grove.glb'):
        path = ASSET / name
        source['checkout_availability'][name] = 'available' if path.is_file() and path.stat().st_size > 256 else 'lfs_pointer_or_missing'
else:
    source['reimport'] = {'render': render, 'collision': collision}
qa_path.write_text(json.dumps(source, indent=2), encoding='utf-8')
print(f'CHERRY_{FAMILY.upper()}_ROUNDTRIP ' + json.dumps({'render': render, 'collision': collision}, separators=(',', ':')))
