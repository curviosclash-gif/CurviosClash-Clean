import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { EndlessParcoursSetpieceBank } from '../src/entities/endless/EndlessParcoursSetpieceBank.js';
import { ENDLESS_SETPIECES } from '../src/entities/endless/EndlessParcoursSetpieceCatalog.js';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { createInteractiveMatchKernel } from '../src/state/MatchKernel.js';

function moduleFor(path, definition, index = 8) {
    return { ...path.getModule(index, 3), templateId: definition.template, recovery: false };
}

test('real GLB setpieces share render resources but keep independent poses and exact collider transforms', async () => {
    const bank = new EndlessParcoursSetpieceBank({ loader: geometryOnlyGlbLoader });
    await bank.prepare();
    assert.equal(bank.templates.size, 5);
    const path = new EndlessParcoursPath({ baseSeed: 4242 });
    for (const definition of ENDLESS_SETPIECES) {
        const module = moduleFor(path, definition), first = bank.create(module, 4242), second = bank.create(module, 4242);
        assert.equal(first.id, definition.id);
        assert.ok(first.colliders.length > 0);
        const original = first.colliders.map(c => Array.from(c.meshCollider.matrixElements));
        let changed = false, openPhases = 0;
        for (let step = 0; step < 24; step++) {
            first.update(step * definition.beatSeconds / 24);
            let hasPassage = false;
            // Ship-sized probe across the occupied longitudinal span; a passage must
            // stay inside the tube, rather than passing behind or over its outer wall.
            for (let x = -16; x <= 16 && !hasPassage; x += 8) for (let y = -16; y <= 16 && !hasPassage; y += 8) {
                if (Math.hypot(x,y) > 18) continue;
                let clear = true;
                for (let localZ = 20; localZ <= 100 && clear; localZ += 5) {
                    const frame = path.getMetric().sampleAtProgress(8, localZ / 120);
                    const point = new THREE.Vector3().copy(frame.position)
                        .addScaledVector(new THREE.Vector3().copy(frame.right),x)
                        .addScaledVector(new THREE.Vector3().copy(frame.up),y);
                    clear = first.colliders.every(c => c.box.distanceToPoint(point) > 8.7
                        || !sphereIntersectsStaticMeshCollider(c.meshCollider,point,8.7));
                }
                if (clear) hasPassage = true;
            }
            if (hasPassage) openPhases++;
            for (let i = 0; i < first.colliders.length; i++) {
                const c = first.colliders[i], mesh = c.meshCollider.mesh;
                const matrix = new THREE.Matrix4().fromArray(c.meshCollider.matrixElements);
                assert.deepEqual(Array.from(c.meshCollider.matrixElements), mesh.matrixWorld.elements);
                const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.matrixWorld);
                assert.ok(c.box.min.distanceTo(box.min) < 1e-5 && c.box.max.distanceTo(box.max) < 1e-5);
                const local = c.meshCollider.worldTriangles;
                const sample = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, mesh.geometry.index?.getX(0) ?? 0).applyMatrix4(mesh.matrixWorld);
                assert.ok(sample.distanceTo(new THREE.Vector3().fromArray(local).applyMatrix4(matrix)) < 1e-4);
                if (original[i].some((value,j) => Math.abs(value-c.meshCollider.matrixElements[j])>0.01)) changed = true;
            }
        }
        assert.ok(changed, definition.id+' really animates');
        assert.ok(openPhases > 0, definition.id+' has a ship-sized interior passage during its cycle');
        const sharedA = first.colliders[0].meshCollider.mesh.geometry, sharedB = second.colliders[0].meshCollider.mesh.geometry;
        assert.equal(sharedA, sharedB);
        first.update(1.234); second.update(1.234);
        assert.deepEqual(Array.from(first.colliders[0].meshCollider.matrixElements),Array.from(second.colliders[0].meshCollider.matrixElements));
        first.dispose(); first.dispose(); second.dispose();
        assert.equal(bank.instanceCount,0);
    }
    bank.dispose(); bank.dispose();
    assert.equal(bank.templates.size,0);
});

test('preparation failure and disposal while a load is pending release every received template', async () => {
    let resolveLoad;
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
    let geometryDisposed = 0, materialDisposed = 0;
    geometry.addEventListener('dispose',()=>geometryDisposed++); material.addEventListener('dispose',()=>materialDisposed++);
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry, material));
    const bank = new EndlessParcoursSetpieceBank({ loader: { loadAsync: () => new Promise(resolve => { resolveLoad = resolve; }) } });
    const pending = bank.prepare(); assert.equal(bank.prepare(),pending);
    await Promise.resolve();
    bank.dispose(); resolveLoad({ scene, animations: [new THREE.AnimationClip('loop', 4, [])] });
    await assert.rejects(pending, /cancelled/);
    assert.equal(bank.templates.size,0);
    assert.equal(geometryDisposed,1); assert.equal(materialDisposed,1);
    await assert.rejects(bank.prepare(),/disposed/);
});

test('a later load failure disposes earlier shared templates instead of publishing a partial bank', async () => {
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry, material));
    let loads = 0, disposals = 0;
    geometry.addEventListener('dispose',()=>disposals++);
    const bank = new EndlessParcoursSetpieceBank({ loader: { async loadAsync() {
        if (loads++ > 0) throw new Error('fixture missing second asset');
        return { scene, animations: [new THREE.AnimationClip('loop', 4, [])] };
    } } });
    await assert.rejects(bank.prepare(), /missing second asset/);
    assert.equal(disposals,1); assert.equal(bank.templates.size,0); assert.equal(bank.ready,false);
    assert.equal(bank.disposed,true);
});

test('one thousand streamed modules and ten run restarts release setpiece instances and shared assets exactly once', async () => {
    for (let run = 0; run < 10; run++) {
        const objects = new Set(), batches = new Map();
        const human = { index: 0, alive: true, position: new THREE.Vector3(0,8,8), baseSpeed: 20 };
        const runtime = new EndlessParcoursRuntime({ baseSeed: 4242 + run,
            renderer: { addToScene(root) { objects.add(root); }, removeFromScene(root) { objects.delete(root); disposeObject3DResources(root); } },
            entityManager: { humanPlayers: [human], players: [human], bots: [] },
            arena: { enterStaticStreamingMode() {}, exitStaticStreamingMode() {},
                registerStaticColliderBatch(id,colliders) { batches.set(id,colliders); }, unregisterStaticColliderBatch(id) { batches.delete(id); } },
        });
        await runtime.prepareSetpieces({ loader: geometryOnlyGlbLoader });
        const bank = runtime._setpieceBank, resources = new Set();
        for (const template of bank.templates.values()) template.scene.traverse(mesh => {
            if (mesh.isMesh) resources.add(mesh.geometry);
        });
        let disposals = 0;
        for (const geometry of resources) geometry.addEventListener('dispose',()=>disposals++);
        for (let index = 1; index <= 100; index++) {
            runtime._syncModules(index,3); runtime.updateGeometry(1/60);
            assert.equal(bank.instanceCount,[...runtime.activeModules.values()].filter(i=>i.setpiece).length);
            assert.ok(objects.size <= 7 && batches.size <= 7 && bank.instanceCount <= 7);
            assert.equal(disposals,0,'streaming cannot dispose shared template geometry');
        }
        runtime.dispose(); runtime.dispose();
        assert.equal(objects.size,0); assert.equal(batches.size,0);
        assert.equal(bank.instanceCount,0); assert.equal(bank.templates.size,0);
        assert.equal(disposals,resources.size);
    }
});

test('the real match kernel updates streamed animation and collision before players and projectiles', () => {
    const calls = [];
    const kernel = createInteractiveMatchKernel({ simPorts: {
        endlessParcoursRuntime: { updateGeometry(dt) { calls.push(['geometry',dt]); }, update(dt) { calls.push(['progress',dt]); } },
        arena: { update(dt) { calls.push(['arena',dt]); } },
        entityManager: { update(dt) { calls.push(['players-projectiles',dt]); } },
    } });
    kernel.boot({ roundIndex: 0 });
    kernel.tick({ fixedStepSeconds: 1/60, frameId: 1 }, { wasPressed:()=>false });
    assert.deepEqual(calls.map(c=>c[0]),['geometry','arena','players-projectiles','progress']);
    assert.ok(calls.every(c=>c[1]===1/60));
});
