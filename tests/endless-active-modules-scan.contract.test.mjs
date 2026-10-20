import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { EndlessActiveModuleMap } from '../src/entities/endless/EndlessActiveModuleMap.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { handleEndlessCheckpointCrossing } from '../src/entities/endless/EndlessParcoursRunOps.js';

function createRuntime() {
    return new EndlessParcoursRuntime({
        baseSeed: 4242,
        renderer: { addToScene() {}, removeFromScene() {} },
        arena: { enterStaticStreamingMode() {}, exitStaticStreamingMode() {},
            registerStaticColliderBatch() {}, unregisterStaticColliderBatch() {} },
        powerupManager: { spawnAtAnchor() {}, removeByOwnerId() {} },
        entityManager: {
            humanPlayers: [], bots: [],
            deactivateBotSlot() {},
            _projectileSystem: { clearInBounds() {} },
            _lockOnCache: { clear() {} },
        },
        wallClockIso: () => '2026-10-17T00:00:00.000Z',
    });
}

// AGENTS.md rule 7: water, exclusion zone, streaming and checkpoints are asked every tick for
// every vehicle. Counting the iterator entry points of the live module map shows whether a
// scan still creates a Map iterator per call.
function countIterators(map) {
    const counter = { calls: 0 };
    for (const name of ['values', 'keys', 'entries', Symbol.iterator]) {
        const original = map[name].bind(map);
        Object.defineProperty(map, name, {
            configurable: true,
            value: (...args) => { counter.calls += 1; return original(...args); },
        });
    }
    return counter;
}

test('per-tick Endlos scans read the streamed modules without creating Map iterators', () => {
    const runtime = createRuntime();
    runtime._syncModules(3);
    assert.ok(runtime.activeModules.size > 1, 'a window of modules is streamed in');
    const player = { position: new THREE.Vector3(0, 8, 250), hitboxRadius: 1 };
    const counter = countIterators(runtime.activeModules);

    for (let tick = 0; tick < 100; tick += 1) {
        runtime._waterZoneSource.isPositionUnderwater(player.position);
        runtime._exclusionZoneSource.isOutside(player);
        runtime._syncModules(3);
        runtime.updateGeometry(1 / 60);
        handleEndlessCheckpointCrossing(runtime, 250);
    }

    assert.equal(counter.calls, 0, `per-tick scans created ${counter.calls} Map iterators in 100 ticks`);
    runtime.dispose();
});

test('the dense module lists follow replace, delete and clear like the map itself', () => {
    const modules = new EndlessActiveModuleMap();
    modules.set(4, 'a').set(5, 'b').set(6, 'c');

    modules.set(5, 'b2');
    modules.delete(4);

    assert.deepEqual(modules.indices, [...modules.keys()]);
    assert.deepEqual(modules.instances, [...modules.values()]);
    assert.deepEqual(modules.instances, ['b2', 'c'], 'a rebuilt module keeps its place');
    modules.clear();
    assert.deepEqual([modules.indices.length, modules.instances.length, modules.size], [0, 0, 0]);
});

test('the streaming window still drops modules behind and adds modules ahead in order', () => {
    const runtime = createRuntime();
    runtime._syncModules(3);
    const before = [...runtime.activeModules.keys()];

    runtime._syncModules(8);

    const after = [...runtime.activeModules.keys()];
    assert.ok(after.every((index) => index >= Math.min(...after)), 'the window is contiguous');
    assert.ok(Math.min(...after) > Math.min(...before), 'modules behind the window are removed');
    assert.ok(after.includes(8), 'the current module is streamed in');
    for (const index of after) {
        assert.equal(runtime.activeModules.get(index).module.moduleIndex, index, 'every key still maps to its own module');
    }
    runtime.dispose();
});
