"""Reimport all Kirschhain GLBs and record bounded asset and variant QA."""
import json
import struct
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / 'assets/maps/cherry_grove/glb'
QA_DIR = ROOT / 'assets/maps/cherry_grove'


def glb_extras(path):
    data = path.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 4)[0] != 2:
        raise RuntimeError(f'Not a glTF 2.0 GLB: {path}')
    json_length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_length])
    extras = [node.get('extras', {}) for node in gltf.get('nodes', [])]
    return sum(item.get('role') == 'wind_leaf' for item in extras), extras


def roundtrip(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if 'FINISHED' not in result:
        raise RuntimeError(f'GLB reimport failed: {path}')
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not objects:
        raise RuntimeError(f'No mesh objects after GLB reimport: {path}')
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = [min(point[i] for point in points) for i in range(3)]
    hi = [max(point[i] for point in points) for i in range(3)]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in objects)
    materials = sorted({material.name for obj in objects for material in obj.data.materials if material})
    leaf_nodes = sum(obj.get('role') == 'wind_leaf' or 'windleaf' in obj.name.lower() or 'wind leaf' in obj.name.lower() for obj in objects)
    leaf_extras, extras = glb_extras(path)
    return {
        'file': path.name,
        'file_bytes': path.stat().st_size,
        'objects': len(objects),
        'triangles': triangles,
        'materials': materials,
        'bounds_m': [round(hi[i] - lo[i], 4) for i in range(3)],
        'reimported_wind_leaf_nodes': leaf_nodes,
        'wind_leaf_extras': leaf_extras,
        'wind_leaf_indices': sorted(item.get('leaf_index') for item in extras if item.get('role') == 'wind_leaf'),
    }


def generated_variant_metadata(family, number):
    if family == 'akebono':
        qa = json.loads((ASSET_DIR / 'qa_metrics.json').read_text(encoding='utf-8'))
        metadata = qa['variant_profiles'][f'akebono_{number:02d}.glb']
    else:
        metadata = json.loads((ASSET_DIR / f'kanzan_{number:02d}_qa.json').read_text(encoding='utf-8'))
    return {
        'seed': metadata['seed'],
        'branch_counts_by_order': metadata['branch_counts_by_order'],
        'flower_count': metadata['flower_count'],
    }


families = {}
for family in ('akebono', 'kanzan'):
    variants = []
    for number in range(1, 6):
        asset = roundtrip(ASSET_DIR / f'{family}_{number:02d}.glb')
        source = generated_variant_metadata(family, number)
        if asset['wind_leaf_extras'] != 48 or asset['reimported_wind_leaf_nodes'] != 48:
            raise RuntimeError(f'Expected 48 leaf anchors after {family} variant {number} roundtrip, got {asset["wind_leaf_extras"]}/{asset["reimported_wind_leaf_nodes"]}')
        if asset['triangles'] <= 0 or min(asset['bounds_m']) <= 0:
            raise RuntimeError(f'Invalid render tree measurements: {asset}')
        variants.append({**source, **asset})
    if len({item['seed'] for item in variants}) != 5:
        raise RuntimeError(f'{family} needs five unique deterministic seeds')
    if len({json.dumps(item['branch_counts_by_order'], sort_keys=True) for item in variants}) < 4:
        raise RuntimeError(f'{family} seed profiles do not produce distinct branch silhouettes')
    families[family] = {'variants': variants}

collisions = {}
for family in ('akebono', 'kanzan'):
    asset = roundtrip(ASSET_DIR / f'{family}_collision.glb')
    if asset['triangles'] >= 100 or asset['wind_leaf_extras'] != 0 or asset['reimported_wind_leaf_nodes'] != 0:
        raise RuntimeError(f'{family} collision is not a coarse leaf-free trunk: {asset}')
    collisions[family] = asset

all_variants = [variant for family in families.values() for variant in family['variants']]
full_near = [family['variants'][0] for family in families.values()]
distance_lod = [variant for family in families.values() for variant in family['variants'][1:]]
qa = {
    'families': families,
    'collisions': collisions,
    'lod_placement': {
        'near_variants': [item['file'] for item in full_near],
        'distance_variants': [item['file'] for item in distance_lod],
        'near_triangles': sum(item['triangles'] for item in full_near),
        'distance_triangles': sum(item['triangles'] for item in distance_lod),
        'all_visible_triangles': sum(item['triangles'] for item in all_variants),
        'total_render_bytes': sum(item['file_bytes'] for item in all_variants),
        'total_collision_bytes': sum(item['file_bytes'] for item in collisions.values()),
    },
}
(QA_DIR / 'cherry_grove_asset_qa.json').write_text(json.dumps(qa, indent=2), encoding='utf-8')
print('CHERRY_GROVE_ASSET_QA ' + json.dumps(qa, separators=(',', ':')))
