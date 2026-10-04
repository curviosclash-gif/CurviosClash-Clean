import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import { FALKENWACHT_MAPS } from '../src/core/config/maps/presets/burg_falkenwacht/index.js';
import { FALKENWACHT_PROP_MODELS } from '../src/core/config/maps/presets/burg_falkenwacht/FalkenwachtProps.js';

const ROOT = path.resolve('assets/maps/burg_falkenwacht/props');
const FAMILIES = ['woodpile', 'stone-well', 'weapon-rack', 'wall-shield', 'wall-ivy'];

function variantPath(family, index, filename) {
    const stem = `falkenwacht-${family}-v${String(index).padStart(2, '0')}`;
    return path.join(ROOT, `falkenwacht-${family}`, stem, filename);
}

function parseGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    const jsonType = bytes.toString('ascii', 16, 20);
    assert.equal(jsonType, 'JSON', `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

function triangleCount(gltf) {
    return (gltf.meshes || []).reduce((total, mesh) => total + mesh.primitives.reduce((meshTotal, primitive) => {
        assert.equal(primitive.mode ?? 4, 4, 'prop primitives use triangle topology');
        return meshTotal + Number(gltf.accessors?.[primitive.indices]?.count || 0) / 3;
    }, 0), 0);
}

test('Falkenwacht keeps ten editable, collision-free variants for every prop family', () => {
    const fingerprints = new Set();
    let sourceCount = 0;
    let runtimeCount = 0;

    for (const family of FAMILIES) {
        for (let index = 1; index <= 10; index += 1) {
            const source = variantPath(family, index, 'source.blend');
            const runtime = variantPath(family, index, 'runtime.glb');
            assert.equal(existsSync(source), true, `${family} v${index} keeps its Blender source`);
            assert.equal(existsSync(runtime), true, `${family} v${index} keeps its GLB`);
            assert.ok(statSync(source).size > 20_000, `${source} is a non-empty editable scene`);
            assert.ok(statSync(runtime).size > 10_000, `${runtime} is a non-empty runtime asset`);

            const gltf = parseGlb(runtime);
            const meshNodes = (gltf.nodes || []).filter((node) => Number.isInteger(node.mesh));
            assert.equal(meshNodes.length, 1, `${runtime} exports one batched mesh node`);
            assert.ok(meshNodes.every((node) => /_nocol$/i.test(node.name || '')),
                `${runtime} cannot contribute scene collision`);
            assert.equal((gltf.animations || []).length, 0, `${runtime} stays static`);
            const fingerprint = JSON.stringify({
                family,
                triangles: triangleCount(gltf),
                materials: (gltf.materials || []).map((material) => material.name),
                bounds: (gltf.accessors || []).filter((entry) => entry.type === 'VEC3')
                    .map((entry) => [entry.min, entry.max]),
            });
            assert.equal(fingerprints.has(fingerprint), false, `${family} v${index} has distinct geometry`);
            fingerprints.add(fingerprint);
            sourceCount += 1;
            runtimeCount += 1;
        }
    }

    assert.equal(sourceCount, 50);
    assert.equal(runtimeCount, 50);
});

test('both Falkenwacht modes share the curated prop selection within its runtime budget', () => {
    assert.equal(FALKENWACHT_PROP_MODELS.length, 16);
    assert.equal(new Set(FALKENWACHT_PROP_MODELS.map((entry) => entry.id)).size, 16);

    const selectedByFamily = new Map(FAMILIES.map((family) => [family, 0]));
    let selectedBytes = 0;
    let selectedTriangles = 0;
    for (const model of FALKENWACHT_PROP_MODELS) {
        const filePath = path.resolve(model.url);
        assert.equal(existsSync(filePath), true, `${model.id} resolves to a packaged asset`);
        assert.ok(model.targetSize > 0);
        selectedBytes += statSync(filePath).size;
        selectedTriangles += triangleCount(parseGlb(filePath));
        const family = FAMILIES.find((candidate) => model.id.startsWith(`falkenwacht-${candidate}-`));
        assert.ok(family, `${model.id} belongs to a contracted family`);
        selectedByFamily.set(family, selectedByFamily.get(family) + 1);
    }
    assert.ok([...selectedByFamily.values()].every((count) => count >= 3),
        'the placed selection represents every family');
    assert.ok(selectedBytes <= 4 * 1024 * 1024, `placed GLBs stay under 4 MiB (got ${selectedBytes})`);
    assert.ok(selectedTriangles <= 120_000, `placed props stay under 120k triangles (got ${selectedTriangles})`);

    for (const key of ['burg_falkenwacht', 'burg_falkenwacht_arena']) {
        const models = FALKENWACHT_MAPS[key].glbModels;
        assert.deepEqual(models.slice(12, 28).map((entry) => entry.id),
            FALKENWACHT_PROP_MODELS.map((entry) => entry.id));
        assert.equal(FALKENWACHT_MAPS[key].glbColliderMode, 'scene');
    }
});

const BLENDER = process.env.BLENDER_EXECUTABLE
    || 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe';

test('wall ivy v01 keeps editable shoot and leaf roles beside its one-mesh runtime export', {
    skip: !existsSync(BLENDER),
}, () => {
    const source = variantPath('wall-ivy', 1, 'source.blend');
    const runtime = variantPath('wall-ivy', 1, 'runtime.glb');
    const inspect = String.raw`
import bpy, json, math, os
from mathutils import Matrix, Vector
root = next(o for o in bpy.context.scene.objects if o.get('ivy_schema_version') == 1)
assert root.get('variant_id') == 'falkenwacht-wall-ivy-v01'
assert root.get('seed') == 297340403 and root.get('height_ratio') == 1.0
asset = bpy.data.collections.get('ASSET | falkenwacht-wall-ivy-v01')
shoots = bpy.data.collections.get('PROCEDURAL | Ivy shoots')
organs = bpy.data.collections.get('ORGANS | Ivy leaves')
sockets = bpy.data.collections.get('SOCKETS | Ivy roles')
additions = bpy.data.collections.get('USER | Ivy additions')
assert all((asset, shoots, organs, sockets, additions))
shoot_meshes = [o for o in shoots.objects if o.type == 'MESH']
leaf_meshes = [o for o in organs.objects if o.type == 'MESH']
socket_objects = [o for o in sockets.objects if o.type == 'EMPTY']
shoot_roles = [o.get('ivy_role_id') for o in shoot_meshes]
leaf_roles = [o.get('ivy_role_id') for o in leaf_meshes]
socket_roles = [o.get('ivy_role_id') for o in socket_objects]
assert len(shoot_meshes) == 30 and len(set(shoot_roles)) == 30
assert len(leaf_meshes) == len(socket_objects) == 50
assert len(set(leaf_roles)) == len(set(socket_roles)) == 50
by_role = {o.get('ivy_role_id'): o for o in socket_objects}
assert all(o.parent == by_role[o.get('ivy_role_id')] for o in leaf_meshes)
assert all(o.get('ivy_socket_name') == by_role[o.get('ivy_role_id')].name for o in leaf_meshes)
assert not any(o.type == 'MESH' and '__export' in o.name for o in bpy.context.scene.objects)
assert bpy.data.collections.get('EXPORT | falkenwacht-wall-ivy-v01') is None

# The role API preserves an attached detail's world placement, then moves it with
# its socket. Mesh edits and unrelated scene objects survive structural changes.
mesh = bpy.data.meshes.new('ContractUserDetailMesh')
mesh.from_pydata([(0, 0, 0), (0.1, 0, 0), (0, 0.1, 0)], [], [(0, 1, 2)])
detail = bpy.data.objects.new('ContractUserDetail', mesh)
additions.objects.link(detail)
detail.matrix_world = Matrix.Translation((6.0, 7.0, 8.0))
root.location = (1.5, -2.0, 3.0)
root.rotation_euler = (0.23, -0.41, 0.17)
root.scale = (1.25, 1.25, 1.25)
bpy.context.view_layer.update()
before_detail_world = detail.matrix_world.copy()
unrelated_collection = bpy.data.collections.new('Contract unrelated content')
bpy.context.scene.collection.children.link(unrelated_collection)
unrelated = bpy.data.objects.new('ContractUnrelated', None)
unrelated_collection.objects.link(unrelated)
unrelated.matrix_world = Matrix.Translation((-4.0, 3.0, 2.0))
before_unrelated = unrelated.matrix_world.copy()
edited_leaf = leaf_meshes[0]
edited_leaf.data.vertices[0].co.x += 0.013
edited_leaf_points = [tuple(v.co) for v in edited_leaf.data.vertices]
import importlib.util
spec = importlib.util.spec_from_file_location(
    'falkenwacht_generator',
    os.environ['IVY_GENERATOR_SOURCE'],
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
generator.attach_ivy_to_role(detail, leaf_roles[0])
bpy.context.view_layer.update()
assert max(abs(before_detail_world[r][c] - detail.matrix_world[r][c]) for r in range(4) for c in range(4)) < 1e-6
assert detail.get('ivy_user_addition') is True and detail.get('ivy_export') is False
assert detail.parent == by_role[leaf_roles[0]]

# A user object may share a display name with a role socket; role IDs stay authoritative.
collision = bpy.data.objects.new(by_role[leaf_roles[0]].name, None)
additions.objects.link(collision)
collision_world = collision.matrix_world.copy()
shoot_before = {o.get('ivy_role_id'): o.matrix_basis.copy() for o in shoot_meshes}
socket_before = {role: socket.matrix_basis.copy() for role, socket in by_role.items()}
organ_points_before = {o.get('ivy_role_id'): [tuple(v.co) for v in o.data.vertices] for o in leaf_meshes}
detail_basis_before = detail.matrix_basis.copy()
unrelated_before = unrelated.matrix_world.copy()
collision_before = collision.matrix_world.copy()
count_before = len(bpy.context.scene.objects)
def scene_snapshot():
    return (float(root['height_ratio']),
        tuple((role, tuple(tuple(row) for row in shoot.matrix_basis)) for role, shoot in sorted(
            ((o.get('ivy_role_id'), o) for o in shoot_meshes))),
        tuple((role, tuple(tuple(row) for row in socket.matrix_basis)) for role, socket in sorted(by_role.items())),
        tuple((role, tuple(tuple(v.co) for v in mesh.data.vertices)) for role, mesh in sorted(
            ((o.get('ivy_role_id'), o) for o in leaf_meshes))),
        tuple(tuple(row) for row in detail.matrix_basis), tuple(tuple(row) for row in unrelated.matrix_world),
        tuple(tuple(row) for row in collision.matrix_world), len(bpy.context.scene.objects))

invalid_before = scene_snapshot()
for invalid in (0.89, 1.11, float('nan'), float('inf'), True, None, 'bad'):
    try:
        generator.regenerate_ivy_structure(root, invalid)
    except (TypeError, ValueError):
        pass
    else:
        raise AssertionError('invalid height ratio was accepted')
    assert scene_snapshot() == invalid_before, 'invalid values mutated the source before rejection'

same = generator.regenerate_ivy_structure(root, 1.0)
assert same['changed'] is False and scene_snapshot() == invalid_before
base = float(root['ground_rebase_z'])
sample_role = leaf_roles[0]
sample_socket = by_role[sample_role]
def shoot_profile(shoot, ratio):
    start = Vector(shoot['ivy_start'])
    end = Vector(shoot['ivy_end'])
    start.z = base + (start.z - base) * ratio
    end.z = base + (end.z - base) * ratio
    direction = (end - start).normalized()
    length = (end - start).length
    points = [shoot.matrix_basis @ v.co for v in shoot.data.vertices]
    projections = [(point - start).dot(direction) for point in points]
    radii = [((point - start) - direction * (point - start).dot(direction)).length for point in points]
    return min(projections), max(projections), max(radii), length
canonical_profiles = {o.get('ivy_role_id'): shoot_profile(o, 1.0) for o in shoot_meshes}
endpoint_sockets = {}
for ratio in (0.9, 1.1, 1.0):
    outcome = generator.regenerate_ivy_structure(root, ratio)
    bpy.context.view_layer.update()
    assert outcome['changed'] is True and root['height_ratio'] == ratio
    expected_z = base + (float(sample_socket['ivy_anchor_local'][2]) - base) * ratio
    assert abs(sample_socket.matrix_basis.translation.z - expected_z) < 1e-6
    for shoot in shoot_meshes:
        min_axis, max_axis, radial_extent, expected_length = shoot_profile(shoot, ratio)
        axis_center = (min_axis + max_axis) * 0.5
        axis_span = max_axis - min_axis
        assert abs(axis_center - expected_length * 0.5) < 2e-5, (
            f'generated shoot axis center missed scaled midpoint: {shoot.get("ivy_role_id")} {axis_center} {expected_length * 0.5}')
        assert abs(axis_span - expected_length) < float(shoot['ivy_radius']) * 0.3, (
            f'generated shoot endcaps missed scaled axis: {shoot.get("ivy_role_id")} {axis_span} {expected_length}')
        assert abs(radial_extent - canonical_profiles[shoot.get('ivy_role_id')][2]) < 2e-5, (
            f'generated shoot radius changed: {shoot.get("ivy_role_id")}')
    connected_gaps = []
    for socket in socket_objects:
        shoot = next(o for o in shoot_meshes if o.get('ivy_role_id') == socket['ivy_parent_shoot_role'])
        def scaled_point(values):
            point = Vector(values)
            point.z = base + (point.z - base) * ratio
            return point
        start = scaled_point(shoot['ivy_start'])
        end = scaled_point(shoot['ivy_end'])
        anchor = socket.matrix_basis.translation.copy()
        direction = end - start
        axis_point = start.lerp(end, float(socket['ivy_shoot_t']))
        expected_offset = Vector(socket['ivy_shoot_offset_local'])
        expected_offset.z *= ratio
        actual_offset = anchor - axis_point
        world_offset_error = (root.matrix_world.to_3x3() @ (actual_offset - expected_offset)).length
        connected_gaps.append(world_offset_error)
        assert (socket.matrix_basis.to_3x3() @ Vector((0, 0, 1))).dot(direction.normalized()) > 0.99999
    print('IVY_SOCKET_GAPS', ratio, max(connected_gaps))
    assert max(connected_gaps) < 1e-5, f'leaf role lost its authored shoot offset: {max(connected_gaps)}'
    assert all([tuple(v.co) for v in obj.data.vertices] == organ_points_before[obj.get('ivy_role_id')]
        for obj in leaf_meshes), 'authored organ mesh edits changed during regeneration'
    assert tuple(tuple(row) for row in detail.matrix_basis) == tuple(tuple(row) for row in detail_basis_before)
    assert detail.parent == sample_socket and collision.parent is None
    assert tuple(tuple(row) for row in unrelated.matrix_world) == tuple(tuple(row) for row in unrelated_before)
    assert tuple(tuple(row) for row in collision.matrix_world) == tuple(tuple(row) for row in collision_before)
    endpoint_sockets[str(ratio)] = [round(float(v), 7) for v in sample_socket.matrix_world.translation]

assert len(bpy.context.scene.objects) == count_before
assert all(o.parent == by_role[o.get('ivy_role_id')] for o in leaf_meshes)
assert edited_leaf.data.vertices[0].co.x != 0, 'edited authored leaf data remains present'
print('IVY_SOURCE_CONTRACT', json.dumps({'shoot_roles': len(shoot_roles), 'leaf_roles': len(leaf_roles),
    'sockets': len(socket_roles), 'ratio_socket_world': endpoint_sockets,
    'root_transform': {'location': list(root.location), 'scale': list(root.scale)}}))
`;
    const result = spawnSync(BLENDER, ['--background', source, '--python-exit-code', '1', '--python-expr', inspect], {
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
        env: { ...process.env, IVY_GENERATOR_SOURCE: path.resolve('scripts/generate_falkenwacht_prop_asset.py') },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /IVY_SOURCE_CONTRACT.*"shoot_roles": 30.*"leaf_roles": 50.*"sockets": 50/s);

    const gltf = parseGlb(runtime);
    assert.equal((gltf.nodes || []).filter((node) => Number.isInteger(node.mesh)).length, 1);
});
