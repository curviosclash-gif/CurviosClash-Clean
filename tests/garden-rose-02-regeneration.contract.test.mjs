import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';

const BLENDER = process.env.BLENDER_EXECUTABLE
    || 'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe';
const BLEND = 'assets/models/garden_rose_02/blender/garden_rose_02.blend';
const SOURCE = 'assets/models/garden_rose_02/blender/build_garden_rose_02.py';

test('Rose 02 regeneration is deterministic and preserves authored organs and unrelated content', {
    skip: !existsSync(BLENDER),
    timeout: 240_000,
}, () => {
    const python = String.raw`
import hashlib, json, math, sys
import bpy
from mathutils import Vector
source = ${JSON.stringify(SOURCE)}
blend = ${JSON.stringify(BLEND)}
bootstrap_source = 'assets/models/garden_rose_02/blender/source_models_garden_rose_02.py'
bpy.ops.wm.open_mainfile(filepath=blend)
scope = {'__name__': 'rose02_test', '__file__': source}
exec(compile(open(source, encoding='utf-8').read(), source, 'exec'), scope)
regen = scope['regenerate_scene']
def gen_signature():
    collection = bpy.data.collections['ROSE02 | Generated structure']
    values = []
    for obj in sorted(collection.objects, key=lambda item: item.get('rose02.role_id', '')):
        values.append((obj.name, obj.get('rose02.role_id'), tuple(tuple(round(v, 8) for v in vertex.co) for vertex in obj.data.vertices)))
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest(), values
def owned_role(role):
    return next(obj for obj in bpy.data.collections['ROSE02 | Generated structure'].objects if obj.get('rose02.role_id') == role)
def connection_metrics(scale):
    regen({'stem_height_scale': scale}, seed=314159)
    bpy.context.view_layer.update()
    stem_obj = owned_role('stem.main')
    points = []
    radii = []
    for ring in range(7):
        vertices = stem_obj.data.vertices[ring*12:(ring+1)*12]
        center = sum((v.co for v in vertices), Vector((0,0,0))) / 12
        points.append(stem_obj.matrix_world @ center)
        radii.append(sum((v.co-center).length for v in vertices) / 12)
    expected = (0.0075, 0.0072, 0.0066, 0.0058, 0.005, 0.0042, 0.0033)
    assert max(abs(a-b) for a,b in zip(radii, expected)) < 1e-6, 'cane radius changed with height parameter'
    flower = bpy.data.objects['Socket | flower.main'].matrix_world.translation.copy()
    bud = bpy.data.objects['Socket | bud.main'].matrix_world.translation.copy()
    flower_tip = points[-1]
    shoot = owned_role('shoot.bud')
    bud_tip = sum((shoot.matrix_world @ v.co for v in shoot.data.vertices[-9:]), Vector((0,0,0))) / 9
    assert (flower_tip-flower).length < 1e-5, 'cane tip misses flower socket'
    assert (bud_tip-bud).length < 1e-5, 'bud shoot tip misses bud socket'
    bud_root = sum((shoot.matrix_world @ v.co for v in shoot.data.vertices[:9]), Vector((0,0,0))) / 9
    root_distances = []
    for a,b in zip(points, points[1:]):
        direction = b-a
        t = min(1.0, max(0.0, (bud_root-a).dot(direction) / direction.length_squared))
        root_distances.append((bud_root-(a+direction*t)).length)
    bud_root_error = min(root_distances)
    assert bud_root_error <= max(radii) + 1e-5, f'bud shoot root misses cane by {bud_root_error}'
    assert any(o.type == 'MESH' and o.parent == bpy.data.objects['Socket | flower.main'] for o in bpy.data.collections['03 Open flower'].objects)
    assert any(o.type == 'MESH' and o.parent == bpy.data.objects['Socket | bud.main'] for o in bpy.data.collections['04 Bud'].objects)
    assert all(any(o.type == 'MESH' and o.parent == bpy.data.objects[f'Socket | leaf.{i:02}'] for o in bpy.data.collections['02 Compound leaves'].objects) for i in range(1,4))
    leaf_errors = []
    for index in range(1,4):
        socket = bpy.data.objects[f'Socket | leaf.{index:02}'].matrix_world.translation.copy()
        distances = []
        for a,b in zip(points, points[1:]):
            direction = b-a
            t = min(1.0, max(0.0, (socket-a).dot(direction) / direction.length_squared))
            distances.append((socket-(a+direction*t)).length)
        error = min(distances)
        leaf_errors.append(error)
        assert error <= radii[min(index+1, 6)] + 1e-5, f'leaf.{index:02} socket misses cane by {error}'
    return {'scale':scale, 'leaf_socket_errors':leaf_errors, 'flower_tip_error':(flower_tip-flower).length, 'bud_tip_error':(bud_tip-bud).length, 'bud_root_error':bud_root_error, 'stem_radii':radii}
before_hash, before_values = gen_signature()
regen(seed=314159)
same_hash, _ = gen_signature()
if before_hash != same_hash:
    after_values = gen_signature()[1]
    diffs = [(a[0], next((i for i, (x, y) in enumerate(zip(a[2], b[2])) if x != y), None),
              a[2][0], b[2][0]) for a, b in zip(before_values, after_values) if a != b]
    raise AssertionError(('same-seed generated structure changed', diffs[:3]))
authored = bpy.data.objects['Open rose | layer 1 petal 01']
assert authored.type == 'MESH'
authored_mesh = authored.data
authored_mesh.vertices[0].co.x += 0.00125
edited_vertex = authored_mesh.vertices[0].co.copy()
authored_world = authored.matrix_world.copy()
custom = bpy.data.meshes.new('User-added preserved mesh data')
custom.from_pydata([(0,0,0), (0.003,0,0), (0,0.003,0)], [], [(0,1,2)])
custom_obj = bpy.data.objects.new('User added flower ornament', custom)
bpy.data.collections['03 Open flower'].objects.link(custom_obj)
custom_obj.location = (0.02, 0.03, 0.7)
unrelated_collection = bpy.data.collections.new('Unrelated QA collection')
bpy.context.scene.collection.children.link(unrelated_collection)
unrelated_mesh = bpy.data.meshes.new('Unrelated mesh')
unrelated_mesh.from_pydata([(0,0,0), (1,0,0), (0,1,0)], [], [(0,1,2)])
unrelated = bpy.data.objects.new('Unrelated user object', unrelated_mesh)
unrelated_collection.objects.link(unrelated)
unrelated.location = (4, 5, 6)
authored_vertex_count = len(authored_mesh.vertices)
authored_vertices = tuple(tuple(v.co) for v in authored_mesh.vertices)
def state():
    return (tuple(sorted(obj.name for obj in bpy.data.objects)),
            authored.parent.name if authored.parent else None,
            tuple(tuple(round(v, 8) for v in row) for row in authored.matrix_world),
            tuple(tuple(round(c, 8) for c in v.co) for v in authored.data.vertices),
            gen_signature()[0], tuple(bpy.context.scene.get(k) for k in ('rose02.seed','rose02.parameters_json')))
invalid_before = state()
try:
    regen({'stem_height_scale': 1.2})
    raise AssertionError('out-of-range parameter accepted')
except ValueError:
    pass
assert state() == invalid_before, 'invalid parameter mutated scene'
regen(seed=314159)
assert authored.data is authored_mesh and authored.data.vertices[0].co == edited_vertex
assert len(authored.data.vertices) == authored_vertex_count
assert tuple(tuple(v.co) for v in authored_mesh.vertices) == authored_vertices
assert custom_obj.name in bpy.data.objects and custom_obj.data is custom
assert unrelated.name in bpy.data.objects and unrelated_collection.name in bpy.data.collections
assert tuple(unrelated.location) == (4.0, 5.0, 6.0)
assert gen_signature()[0] == before_hash
bud_socket = bpy.data.objects['Socket | bud.main']
shoot = bpy.data.objects['Bud lateral shoot']
tail = Vector((0,0,0))
count = 9
for vertex in shoot.data.vertices[-count:]: tail += shoot.matrix_world @ vertex.co
tail /= count
assert (tail - bud_socket.matrix_world.translation).length < 1e-5, 'bud shoot tip misses bud socket'
flower_socket = bpy.data.objects['Socket | flower.main']
stem = bpy.data.objects['Main arching cane']
end = Vector((0,0,0))
for vertex in stem.data.vertices[-12:]: end += stem.matrix_world @ vertex.co
end /= 12
assert (end - flower_socket.matrix_world.translation).length < 1e-5, 'cane tip misses flower socket'
flower_socket = bpy.data.objects['Socket | flower.main']
leaf_before = authored.matrix_world.copy()
authored_basis_before = authored.matrix_basis.copy()
endpoint_09 = connection_metrics(0.9)
regen({'stem_height_scale': 1.1}, seed=314159)
assert authored.parent == flower_socket
assert authored.data is authored_mesh and tuple(tuple(v.co) for v in authored_mesh.vertices) == authored_vertices
assert (authored.matrix_world.translation - leaf_before.translation).length > 0.005, 'authored flower did not follow changed structure'
assert max(abs(authored.matrix_basis[r][c] - authored_basis_before[r][c]) for r in range(4) for c in range(4)) < 1e-6, 'authored local socket frame changed'
assert authored.parent.name == 'Socket | flower.main'
assert custom_obj.parent == bpy.data.objects['Socket | flower.main']
assert unrelated.name in bpy.data.objects and unrelated_collection.name in bpy.data.collections
height_delta = (authored.matrix_world.translation - leaf_before.translation).length
bud_tip_error = (tail - bud_socket.matrix_world.translation).length
flower_tip_error = (end - flower_socket.matrix_world.translation).length
endpoint_11 = connection_metrics(1.1)
rotation_samples = {f'leaf.{i:02}':[] for i in range(1,4)}
for i in range(21):
    scale = 0.9 + i*0.01
    regen({'stem_height_scale':scale}, seed=314159)
    bpy.context.view_layer.update()
    for role in rotation_samples:
        rotation_samples[role].append(bpy.data.objects[f'Socket | {role}'].matrix_world.to_quaternion().copy())
rotation_step_angles = {}
for role, samples in rotation_samples.items():
    deltas = [a.rotation_difference(b).angle for a,b in zip(samples,samples[1:])]
    rotation_step_angles[role] = max(deltas)
    assert rotation_step_angles[role] < 0.35, f'{role} frame rolls discontinuously: {rotation_step_angles[role]} rad'
bpy.ops.wm.read_factory_settings(use_empty=True)
save_version_before = bpy.context.preferences.filepaths.save_version
source_scope = {'__name__': 'rose02_source', '__file__': bootstrap_source}
exec(compile(open(bootstrap_source, encoding='utf-8').read(), bootstrap_source, 'exec'), source_scope)
source_scope['build_original_authored_source'](bpy.context.scene)
assert bpy.context.preferences.filepaths.save_version == save_version_before, ('source bootstrap changed user preference', save_version_before, bpy.context.preferences.filepaths.save_version)
assert bpy.data.objects.get('Open rose | layer 1 petal 01') is not None, 'original petal source missing'
assert bpy.data.objects.get('Leaf 1 rachis') is not None, 'original leaf source missing'
assert len(bpy.data.objects) >= 120, 'original source bootstrap omitted authored object families'
canonical_cane = bpy.data.objects['Main arching cane']
canonical_vertex = canonical_cane.data.vertices[0]
canonical_vertex_before = canonical_vertex.co.copy()
canonical_vertex.co.x += 0.0002
signature_before = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(v.co) for v in canonical_cane.data.vertices), tuple(sorted(c.name for c in bpy.data.collections)))
try:
    regen(seed=314159)
    raise AssertionError('edited legacy signature was accepted')
except RuntimeError as error:
    assert 'signature' in str(error)
signature_after = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(v.co) for v in canonical_cane.data.vertices), tuple(sorted(c.name for c in bpy.data.collections)))
assert signature_before == signature_after, 'legacy signature failure mutated scene before rejection'
canonical_vertex.co = canonical_vertex_before
ambiguous_collection = bpy.data.collections['01 Stems and prickles']
ambiguous_mesh = bpy.data.meshes.new('Ambiguous legacy mesh')
ambiguous_mesh.from_pydata([(0,0,0),(0.001,0,0),(0,0.001,0)], [], [(0,1,2)])
ambiguous = bpy.data.objects.new('Main arching cane', ambiguous_mesh)
ambiguous_collection.objects.link(ambiguous)
ambiguous_before = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(ambiguous.matrix_world[r]) for r in range(4)), tuple(sorted(c.name for c in bpy.data.collections)))
try:
    regen(seed=314159)
    raise AssertionError('ambiguous legacy structure was accepted')
except RuntimeError as error:
    assert 'Ambiguous' in str(error)
ambiguous_after = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(ambiguous.matrix_world[r]) for r in range(4)), tuple(sorted(c.name for c in bpy.data.collections)))
assert ambiguous_before == ambiguous_after, 'ambiguous migration mutated scene before rejection'
bpy.data.objects.remove(ambiguous, do_unlink=True)
bpy.data.meshes.remove(ambiguous_mesh)
gen_scope = {'__name__':'rose02_migration', '__file__':source}
exec(compile(open(source, encoding='utf-8').read(), source, 'exec'), gen_scope)
regen = gen_scope['regenerate_scene']
scene = bpy.context.scene
regen(seed=314159)
assert scene.get('rose02.schema') == gen_scope['SCHEMA']
legacy_collection = bpy.data.collections['01 Stems and prickles']
assert not [o.name for o in legacy_collection.objects if o.name in gen_scope['_LEGACY_GENERATED_NAMES']], 'validated legacy structures were not migrated out'
assert len(bpy.data.collections['ROSE02 | Generated structure'].objects) == 8, [o.name for o in bpy.data.collections['ROSE02 | Generated structure'].objects]
generated_stem = owned_role('stem.main')
generated_stem.name = 'Protected generated stem before repeat'
user_mesh = bpy.data.meshes.new('User exact legacy name mesh')
user_mesh.from_pydata([(0,0,0),(0.001,0,0),(0,0.001,0)], [], [(0,1,2)])
user_named = bpy.data.objects.new('Main arching cane', user_mesh)
legacy_collection.objects.link(user_named)
regen(seed=314159)
assert bpy.data.objects.get('Main arching cane') is user_named and user_named.data is user_mesh
assert len([o for o in bpy.data.collections['ROSE02 | Generated structure'].objects if o.get('rose02.owner') == gen_scope['OWNER']]) == 8
regen(seed=314159)
assert bpy.data.objects.get('Main arching cane') is user_named and user_named.data is user_mesh
socket = bpy.data.objects['Socket | flower.main']
socket.name = 'Rose02 socket with protected name'
unrelated_collection = bpy.data.collections.new('User extension collection')
scene.collection.children.link(unrelated_collection)
collision_mesh = bpy.data.meshes.new('User socket collision mesh')
collision_mesh.from_pydata([(0,0,0),(0.001,0,0),(0,0.001,0)], [], [(0,1,2)])
collision = bpy.data.objects.new('Socket | flower.main', collision_mesh)
unrelated_collection = bpy.data.collections['User extension collection']
unrelated_collection.objects.link(collision)
before_collision = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(collision.matrix_world[r]) for r in range(4)), len(bpy.data.collections['ROSE02 | Generated structure'].objects))
try:
    regen(seed=314159)
    raise AssertionError('unowned socket collision was accepted')
except RuntimeError as error:
    assert 'socket name' in str(error)
after_collision = (tuple(sorted(o.name for o in bpy.data.objects)), tuple(tuple(collision.matrix_world[r]) for r in range(4)), len(bpy.data.collections['ROSE02 | Generated structure'].objects))
assert before_collision == after_collision, 'socket collision changed scene before rejection'
print('ROSE02_CONTRACT_OK', json.dumps({'authored_vertex_count': authored_vertex_count, 'same_seed_sha256': before_hash, 'invalid_unchanged': True, 'ambiguous_migration_rejected_without_mutation':True, 'height_09':endpoint_09, 'height_11':endpoint_11, 'max_rotation_step_radians':rotation_step_angles, 'modified_height_world_delta': height_delta, 'legacy_same_name_preserved':True, 'socket_collision_rejected_without_mutation':True, 'original_source_bootstrap_objects': len(bpy.data.objects)}, sort_keys=True))
`;
    const result = spawnSync(BLENDER, [
        '--background', '--python-exit-code', '1', '--python-expr', python,
    ], { encoding: 'utf8', timeout: 220_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /ROSE02_CONTRACT_OK/);
    console.log((`${result.stdout}\n${result.stderr}`).match(/ROSE02_CONTRACT_OK[^\r\n]*/)?.[0]);
});
