import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { nudgeBuildPosition, resolveBuildPosition, createBuildPose, stepBuildPose } from '../editor/js/EditorBuildMotion.js';
import { pickBuildTarget, EditorBuildSelectionVisuals } from '../editor/js/EditorBuildPicking.js';
import { createEditorBuildMapSnapshot } from '../editor/js/EditorBuildMapSnapshot.js';
import { createPortalGateVisualRegistry, createInstancedVisualHandle } from '../src/entities/arena/portal/PortalVisualRegistry.js';

test('precision keys use fixed map axes, selected step or actual grid, without drift', () => {
    const position = new THREE.Vector3(0.4, 0.4, 0.4);
    nudgeBuildPosition(position, 'ArrowRight', 0.1);
    assert.equal(position.x, 0.5);
    nudgeBuildPosition(position, 'ArrowUp', 10);
    nudgeBuildPosition(position, 'PageDown', 1);
    assert.deepEqual(position.toArray(), [0.5, -0.6, -9.6]);
    nudgeBuildPosition(position, 'PageUp', 0.1, 50);
    assert.deepEqual(position.toArray(), [0, 50, 0]);
    const pose = createBuildPose(position);
    stepBuildPose(pose, new Set(), { dt: 10, speed: 1000 });
    assert.deepEqual(pose.position.toArray(), position.toArray());
    resolveBuildPosition(new THREE.Vector3(26, 74, -26), 50, pose.position);
    assert.deepEqual(pose.position.toArray(), [50, 50, -50]);
    assert.equal(nudgeBuildPosition(position, 'KeyW', 1), false);
});

function fixture() {
    const runtime = new THREE.Group(); const authored = new THREE.Group(); const preview = new THREE.Group();
    runtime.add(preview);
    const objects = new Map();
    const manager = { getObjectById: (id) => objects.get(id), resolveManagedObject: (node) => {
        for (let parent = node; parent; parent = parent.parent) if (objects.get(parent.userData.id) === parent) return parent;
        return null;
    } };
    const cube = (root, z, id) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
        mesh.position.z = z; root.add(mesh);
        if (id) { mesh.userData = { id, type: 'hard' }; objects.set(id, mesh); }
        return mesh;
    };
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const pick = () => pickBuildTarget(ray, runtime, authored, manager, 2, preview);
    return { runtime, authored, preview, objects, manager, cube, pick };
}

test('real nearest surface blocks selection through scenery; preview and outlines never intercept', () => {
    const f = fixture();
    const authored = f.cube(f.authored, -12, 'block'); authored.scale.setScalar(2);
    f.cube(f.runtime, -6);
    f.cube(f.preview, -2);
    assert.equal(f.pick().object, authored);
    const wall = f.cube(f.runtime, -3);
    assert.equal(f.pick().object, null);
    assert.equal(f.pick().status, 'Nicht bearbeitbar');
    wall.visible = false;
    authored.userData.editorLocked = true;
    assert.equal(f.pick().locked, true);
    assert.equal(f.pick().status, 'Gesperrt');
    authored.visible = false;
    assert.equal(f.pick().object, null);
    f.runtime.children.filter((child) => child !== f.preview).forEach((child) => { child.visible = false; });
    assert.equal(f.pick(), null);
});

test('animated GLB uses live runtime transform and placement ID, including hidden ancestors', () => {
    const f = fixture(); const authored = f.cube(f.authored, -100, 'glb-7');
    const slot = new THREE.Group(); slot.userData.glbModelId = 'tree#glb-7'; f.runtime.add(slot);
    f.cube(slot, -6);
    assert.equal(f.pick().object, authored);
    slot.position.x = 30;
    assert.equal(f.pick(), null);
    slot.position.x = 0; slot.visible = false;
    assert.equal(f.pick(), null);
    slot.visible = true; authored.userData.editorLayerLocked = true;
    assert.equal(f.pick().locked, true);
    const visuals = new EditorBuildSelectionVisuals(); visuals.bindWorld(f.runtime, f.manager);
    visuals.show(visuals.selected, { object: authored, visual: visuals.models.get('glb-7') }, 2);
    assert.equal(visuals.selected.visible, true);
    assert.equal(visuals.selected.box.min.z, -7);
    slot.position.y = 10; slot.updateMatrixWorld(true);
    visuals.show(visuals.selected, f.pick(), 2);
    let sharedDisposed = false;
    slot.children[0].geometry.addEventListener('dispose', () => { sharedDisposed = true; });
    visuals.dispose(); visuals.dispose();
    assert.equal(sharedDisposed, false);
    assert.equal(visuals.root.parent, null);
    assert.equal(visuals.models.size, 0);
});

test('transparent water/effect surfaces leave visible objects pickable', () => {
    const f = fixture(); const authored = f.cube(f.authored, -12, 'block'); authored.scale.setScalar(2);
    f.cube(f.runtime, -6);
    const water = f.cube(f.runtime, -3); water.material.transparent = true; water.material.depthWrite = false;
    assert.equal(f.pick().object, authored);
});

test('bobbing pickups, turrets and spinning checkpoints keep authored identity via runtime bindings', () => {
    const f = fixture();
    const authored = f.cube(f.authored, -100, 'pickup-1');
    const pickup = f.cube(f.runtime, -6); pickup.position.y = 0.5;
    const visuals = new EditorBuildSelectionVisuals();
    visuals.bindItems([{ mesh: pickup, anchorKey: 'pickup-1' }], f.manager);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0, -1));
    const target = pickBuildTarget(ray, f.runtime, f.authored, f.manager, 2, f.preview, new THREE.Raycaster(), visuals);
    assert.equal(target.object, authored); assert.equal(target.visual, pickup);
    visuals.show(visuals.hover, target, 2);
    assert.equal(visuals.hover.box.min.y, -0.5);
    const turret = f.cube(f.authored, -100, 'turret-1');
    const checkpoint = f.cube(f.authored, -100, 'checkpoint-1');
    const turretRoot = new THREE.Group(); const ringMesh = new THREE.Group();
    const aircraft = f.cube(f.authored, -100, 'aircraft-1'); const aircraftRoot = new THREE.Group();
    visuals.bindRuntime({ staticTurrets: { turrets: [{ root: turretRoot, id: 'turret-1' }] },
        arena: { checkpointRings: [{ mesh: ringMesh, checkpointId: 'checkpoint-1' }],
            _aircraftDecorations: [{ root: aircraftRoot, id: 'aircraft-1' }] } }, f.manager);
    assert.equal(visuals.resolve(turretRoot, f.manager).object, turret);
    assert.equal(visuals.resolve(ringMesh, f.manager).object, checkpoint);
    assert.equal(visuals.resolve(aircraftRoot, f.manager).object, aircraft);
    visuals.dispose();
});

test('instanced portals resolve by instance ID and bound only the selected handle, preserving shared batches', () => {
    const f = fixture(); const authored = f.cube(f.authored, -100, 'portal-1');
    const renderer = { addToScene: (object) => f.runtime.add(object), removeFromScene: (object) => object.removeFromParent() };
    const registry = createPortalGateVisualRegistry(renderer);
    const geo = new THREE.BoxGeometry(2, 2, 2); const material = new THREE.MeshBasicMaterial();
    const handle = createInstancedVisualHandle(registry, new THREE.Vector3(0, 0, -6));
    handle.addComponent('body', { batchKey: 'portals', geometry: geo, material });
    const other = createInstancedVisualHandle(registry, new THREE.Vector3(30, 0, -6));
    other.addComponent('body', { batchKey: 'portals', geometry: geo, material });
    const visuals = new EditorBuildSelectionVisuals();
    visuals.bindRuntime({ arena: { portals: [{ meshA: handle, sourceIdA: 'portal-1' }] } }, f.manager);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const target = pickBuildTarget(ray, f.runtime, f.authored, f.manager, 2, f.preview, new THREE.Raycaster(), visuals);
    assert.equal(target.object, authored); assert.equal(target.visual, handle);
    visuals.show(visuals.hover, target, 2);
    assert.deepEqual(visuals.hover.box.min.toArray(), [-1, -1, -7]);
    assert.deepEqual(visuals.hover.box.max.toArray(), [1, 1, -5]);
    let disposed = false; geo.addEventListener('dispose', () => { disposed = true; });
    visuals.dispose(); assert.equal(disposed, false); registry.dispose();
});

test('portal identity metadata is confined to the temporary runtime definition', () => {
    const input = JSON.stringify({ arenaSize: { width: 2800, height: 950, depth: 2400 },
        portals: [{ id: 'p-a', x: -700, y: 500, z: 0 }, { id: 'p-b', x: 700, y: 500, z: 0 }] });
    const snapshot = createEditorBuildMapSnapshot(input);
    assert.equal(snapshot.mapResolution.mapDefinition.portals[0].sourceIdA, 'p-a');
    assert.equal(snapshot.mapResolution.mapDefinition.portals[0].sourceIdB, 'p-b');
    assert.equal(snapshot.mapDocument.portals[0].sourceIdA, undefined);
});
