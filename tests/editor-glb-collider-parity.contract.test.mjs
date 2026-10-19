// The editor's clearance probe once kept its own copy of the match's collider rules and drifted
// from them. Both sides now read src/entities/arena/GlbColliderRules.js; this test runs the same
// cases through the real match path (GLB collection load plus the hidden-model switch-off) and
// through the editor probe, and requires the same answer in every collider mode.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { createEditorCollisionProbe } from '../editor/js/ui/EditorCollisionValidation.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { collectsGlbColliders, selectAuthoredObstacleDefs } from '../src/entities/arena/GlbColliderRules.js';
import { deactivateHiddenGlbModels } from '../src/entities/arena/GlbModelVisibilityOps.js';

const CASES = Object.freeze([
    { label: 'a plain surface', mesh: 'hull' },
    { label: 'a _nocol surface', mesh: 'decor_nocol' },
    { label: 'a moving _dyn part', mesh: 'gate_dyn' },
    { label: 'a shootable seed', mesh: 'seed_3', partRole: 'shootable_seed' },
    { label: 'a shootable kernel', mesh: 'kernel_1', partRole: 'shootable_kernel' },
    { label: 'a decorative model', mesh: 'hull', model: { collision: false } },
    { label: 'an optional prop', mesh: 'hull', model: { role: 'optionalProp' } },
    { label: 'a model hidden until triggered', mesh: 'hull', model: { hiddenUntilTriggered: true } },
    { label: 'a hidden fixed-placement scene', mesh: 'hull', model: { hiddenUntilTriggered: true, fixedTriggeredPlacement: true } },
]);

function box(name) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.name = name;
    return mesh;
}

/** The case's mesh, inside a role group where the case names one, as a decoded GLB nests it. */
function addCaseMesh(parent, entry) {
    if (!entry.partRole) return parent.add(box(entry.mesh));
    const part = new THREE.Group();
    part.userData.role = entry.partRole;
    part.add(box(entry.mesh));
    return parent.add(part);
}

/** Model IDs the match still collides with, through the loader and the hidden-model switch-off. */
async function matchSolidCases(colliderMode) {
    const loader = {
        async loadAsync(url) {
            const scene = new THREE.Group();
            addCaseMesh(scene, CASES[Number(url.match(/case_(\d+)/)[1])]);
            return { scene, animations: [] };
        },
    };
    const models = CASES.map((entry, index) => ({
        id: `case_${index}`, url: `assets/maps/parity/case_${index}.glb`, position: [index * 10, 0, 0], ...entry.model,
    }));
    const result = await loadGLBMapCollection(models, {
        loader,
        requireComplete: colliderMode !== 'fallbackOnly',
        collectColliders: collectsGlbColliders(colliderMode),
        colliderMode,
    });
    const colliderIndex = new Map();
    for (const collider of result.colliders) {
        if (!colliderIndex.has(collider.modelId)) colliderIndex.set(collider.modelId, []);
        colliderIndex.get(collider.modelId).push(collider);
    }
    const arena = { _glbScene: result.scene, obstacles: [...result.colliders] };
    deactivateHiddenGlbModels(arena, colliderIndex);
    return CASES.map((_entry, index) => arena.obstacles.some((collider) => collider.modelId === `case_${index}`));
}

/** Stands for the editor around the probe: a scene, a map manager and the export arena. */
function createEditor(colliderMode) {
    const core = { scene: new THREE.Scene(), objectsContainer: new THREE.Group(), transformControl: { object: null, detach() {} } };
    core.scene.add(core.objectsContainer);
    const manager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    manager.mapDocumentMeta.glbColliderMode = colliderMode;
    const editor = { core, mapManager: manager, getArenaSizeForExport: () => ({ width: 2800, height: 950, depth: 2400 }) };
    return { manager, probe: () => createEditorCollisionProbe(editor, core.objectsContainer.children) };
}

/** Whether the editor probe reports each case's model as solid, one model per case. */
function editorSolidCases(colliderMode) {
    const { manager, probe } = createEditor(colliderMode);
    const positions = CASES.map((entry, index) => {
        const model = manager.createMesh('glb', 'parity', index * 400, 100, 0, 100,
            { glbUrl: `assets/maps/parity/case_${index}.glb`, ...entry.model });
        // The placeholder's own box stands for nothing here; the case mesh is the model's surface.
        model.geometry = new THREE.BufferGeometry();
        addCaseMesh(model, entry);
        return model.position.clone();
    });
    const blocked = probe();
    return positions.map((position) => blocked(position));
}

const EXPECTED = Object.freeze({
    scene: { 'a plain surface': true, 'a _nocol surface': false, 'a moving _dyn part': true, 'a shootable seed': false },
    dynamic: { 'a plain surface': false, 'a moving _dyn part': true, 'a model hidden until triggered': false },
    fallbackOnly: { 'a plain surface': false, 'a moving _dyn part': false },
});

for (const colliderMode of ['scene', 'dynamic', 'fallbackOnly']) {
    test(`the editor probe collides with the same GLB parts as the match in ${colliderMode}`, async () => {
        const match = await matchSolidCases(colliderMode);
        const editor = editorSolidCases(colliderMode);
        CASES.forEach((entry, index) => {
            assert.equal(editor[index], match[index], `${entry.label}: editor ${editor[index]}, match ${match[index]}`);
            const expected = EXPECTED[colliderMode][entry.label];
            if (expected !== undefined) assert.equal(match[index], expected, `${entry.label} in the match`);
        });
    });
}

test('the editor probe keeps the authored boxes the match keeps next to a loaded world', () => {
    for (const colliderMode of ['scene', 'dynamic', 'fallbackOnly']) {
        for (const compileWithGlb of [false, true]) {
            const kept = selectAuthoredObstacleDefs([{ compileWithGlb }],
                { usedGlbModel: true, requiredWorldComplete: true, colliderMode }).length === 1;
            const { manager, probe } = createEditor(colliderMode);
            const model = manager.createMesh('glb', 'world', -800, 100, 0, 100, { glbUrl: 'assets/maps/parity/world.glb' });
            model.geometry = new THREE.BufferGeometry();
            const block = manager.createMesh('hard', null, 600, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
            block.userData.compileWithGlb = compileWithGlb;
            assert.equal(probe()(block.position), kept, `${colliderMode}, compileWithGlb ${compileWithGlb}`);
        }
    }
    assert.equal(selectAuthoredObstacleDefs([{}], { usedGlbModel: false, colliderMode: 'scene' }).length, 1,
        'without a model every box stays');
    assert.equal(selectAuthoredObstacleDefs([{}], { usedGlbModel: true, requiredWorldComplete: false, colliderMode: 'scene' }).length, 1,
        'an incomplete world falls back to every box');
});
