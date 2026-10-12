import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { EditorBuildPreview } from '../editor/js/EditorBuildPreview.js';
import { createBuildPose, stepBuildPose, resolveBuildPosition, BUILD_SPEED_FACTORS } from '../editor/js/EditorBuildMotion.js';
import { createEditorBuildMapSnapshot } from '../editor/js/EditorBuildMapSnapshot.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { createEditorBuildPresentationScope } from '../editor/js/EditorBuildPresentationScope.js';
import { getAtmosphericFogUniforms, isAtmosphericFogInstalled, installAtmosphericFog } from '../src/core/renderer/AtmosphericFogShaderPatch.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('runtime asset resolution keeps canonical local paths and restores shared loader and fog hooks', () => {
    const manager = new THREE.LoadingManager();
    const previous = manager.resolveURL;
    const uniforms = getAtmosphericFogUniforms();
    const oldDistance = uniforms.fogClipDistance.value;
    const oldInstalled = isAtmosphericFogInstalled();
    const scope = createEditorBuildPresentationScope('https://example.invalid/app/', manager);
    assert.equal(manager.resolveURL('assets/maps/map.glb'), 'https://example.invalid/app/assets/maps/map.glb');
    assert.equal(manager.resolveURL('../assets/models/model.glb'), '../assets/models/model.glb');
    assert.equal(manager.resolveURL('data:model/gltf-binary;base64,AA=='), 'data:model/gltf-binary;base64,AA==');
    installAtmosphericFog();
    uniforms.fogClipDistance.value = 123;
    scope.dispose(); scope.dispose();
    assert.equal(manager.resolveURL, previous);
    assert.equal(uniforms.fogClipDistance.value, oldDistance);
    assert.equal(isAtmosphericFogInstalled(), oldInstalled);
});

test('build flight is stationary, time based, normalized and uses exact speed factors', () => {
    const pose = createBuildPose();
    stepBuildPose(pose, new Set(), { dt: 0.05, speed: 450 });
    assert.equal(pose.position.lengthSq(), 0);
    stepBuildPose(pose, new Set(['KeyW', 'KeyD', 'Space']), { dt: 0.05, speed: 450 });
    near(pose.position.length(), 22.5);
    const before = pose.position.clone();
    stepBuildPose(pose, new Set(['KeyW']), { dt: 3, speed: 450, enabled: false, lookX: 90 });
    assert.deepEqual(pose.position.toArray(), before.toArray());
    assert.deepEqual(BUILD_SPEED_FACTORS, [0.25, 0.5, 1, 2, 4]);
});

test('mouse look never changes the independent authored rotation, and long frames are capped', () => {
    const pose = createBuildPose();
    stepBuildPose(pose, new Set(['KeyW']), { dt: 30, speed: 45, lookX: 40, lookY: 20 });
    near(pose.position.length(), 4.5);
    assert.ok(pose.quaternion.angleTo(new THREE.Quaternion()) > 0.01);
    assert.deepEqual(resolveBuildPosition(new THREE.Vector3(74, 26, -26), 50).toArray(), [50, 50, -50]);
});

test('map snapshot uses the same export and runtime scaling as the normal match', () => {
    const snapshot = createEditorBuildMapSnapshot(JSON.stringify({ arenaSize: { width: 2800, height: 950, depth: 2400 },
        hardBlocks: [{ id: 'block', x: 350, y: 175, z: -350, width: 140, height: 70, depth: 210 }],
        playerSpawn: { x: 0, y: 150, z: 0 } }));
    near(snapshot.unitsPerWorldUnit, 35 / CONFIG_SECTIONS.ARENA.MAP_SCALE);
    const block = snapshot.mapResolution.mapDefinition.obstacles[0];
    near(block.pos[0] * CONFIG_SECTIONS.ARENA.MAP_SCALE, 350 / snapshot.unitsPerWorldUnit);
});

function makeEditor() {
    const manager = new EditorMapManager({ objectsContainer: new THREE.Group(), transformControl: { object: null } }, { getClone: () => null });
    const mutations = [];
    const editor = { mapManager: manager, currentTool: 'hard', dom: {},
        executeHistoryMutation: (label, callback) => { mutations.push(label); return callback(); },
        selectObject: () => {}, isActiveLayerLocked: () => false };
    const preview = new EditorBuildPreview(editor, { replaceChildren() {} });
    preview.renderProperties = () => {};
    return { editor, manager, preview, mutations };
}

test('single preview places a full block and a tunnel with exactly its displayed dimensions', () => {
    const { preview, manager } = makeEditor();
    preview.chooseCatalog();
    preview.mesh.scale.set(100, 200, 300);
    preview.mesh.rotation.y = Math.PI / 4;
    manager.syncObjectScaleMetadata(preview.mesh);
    assert.equal(preview.confirm(new THREE.Vector3(50, 100, 150)), true);
    const block = manager.core.objectsContainer.children[0];
    assert.deepEqual(block.position.toArray(), [50, 100, 150]);
    assert.deepEqual(block.scale.toArray(), [100, 200, 300]);
    near(block.quaternion.angleTo(preview.mesh.quaternion), 0);
    assert.equal(manager.getObjectCount(), 1);
    preview.editor.currentTool = 'tunnel';
    preview.chooseCatalog();
    preview.mesh.scale.set(60, 500, 60);
    preview.mesh.rotation.z = Math.PI / 2;
    assert.equal(preview.confirm(new THREE.Vector3(0, 100, 0)), true);
    const tunnel = manager.core.objectsContainer.children[1];
    near(tunnel.userData.pointA.distanceTo(tunnel.userData.pointB), 500);
    assert.equal(tunnel.userData.radius, 60);
    preview.dispose();
});

test('move is transient until confirmation, keeps identity, and never disposes borrowed geometry', () => {
    const { preview, manager, mutations } = makeEditor();
    const object = manager.createMesh('hard', null, 10, 20, 30, 70, {});
    const id = object.userData.id;
    let geometryDisposals = 0;
    object.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    assert.equal(preview.beginMove(object), true);
    preview.mesh.scale.set(200, 140, 140);
    assert.deepEqual(object.position.toArray(), [10, 20, 30]);
    assert.deepEqual(object.scale.toArray(), [140, 140, 140]);
    preview.clear();
    assert.equal(geometryDisposals, 0);
    preview.beginMove(object);
    assert.equal(preview.confirm(new THREE.Vector3(300, 400, 500)), true);
    assert.equal(manager.getObjectCount(), 1);
    assert.equal(object.userData.id, id);
    assert.deepEqual(object.position.toArray(), [300, 400, 500]);
    assert.deepEqual(mutations, ['Move build object']);
    preview.dispose();
    assert.equal(geometryDisposals, 0);
});

test('water metadata survives editor roundtrip and is converted into the runtime snapshot', () => {
    const { manager } = makeEditor();
    manager.importFromJSON(JSON.stringify({ arenaSize: { width: 2800, height: 950, depth: 2400 },
        waterZone: { enabled: true, min: [-700, 0, -700], max: [700, 350, 700], surfaceY: 350 },
        playerSpawn: { x: 0, y: 400, z: 0 } }));
    const exported = JSON.parse(manager.generateJSONExport({ width: 2800, height: 950, depth: 2400 }));
    assert.ok(exported.waterZone);
    assert.ok(createEditorBuildMapSnapshot(JSON.stringify(exported)).mapResolution.mapDefinition.waterZone);
});

test('existing lighting, fog layer and GLB clock survive history exports and reach the game renderer', () => {
    const { manager } = makeEditor();
    manager.importFromJSON(JSON.stringify({ arenaSize: { width: 2800, height: 950, depth: 2400 },
        lighting: { fog: { color: 0x225577, near: 15, far: 90 } },
        fogLayer: { stages: [{ atSeconds: 0, ceiling: 20 }, { atSeconds: 20, ceiling: 50 }] },
        glbAnimationClock: { mode: 'loop', cycleSeconds: 12 } }));
    const json = manager.generateJSONExport({ width: 2800, height: 950, depth: 2400 });
    const exported = JSON.parse(json);
    const runtime = createEditorBuildMapSnapshot(json).mapResolution.mapDefinition;
    assert.equal(runtime.lighting.fog.color, 0x225577);
    assert.equal(runtime.fogLayer.stages[1].ceiling, 50);
    assert.deepEqual(runtime.glbAnimationClock, exported.glbAnimationClock);
    manager.importFromJSON(json);
    assert.deepEqual(JSON.parse(manager.generateJSONExport({ width: 2800, height: 950, depth: 2400 })).lighting, exported.lighting);
});
