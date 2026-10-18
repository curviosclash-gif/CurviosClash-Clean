import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EndlessParcoursPath } from '../src/entities/endless/EndlessParcoursPath.js';
import { buildEndlessTube, ENDLESS_TUBE } from '../src/entities/endless/EndlessParcoursTube.js';
import { resolveEndlessSidePort } from '../src/entities/endless/EndlessParcoursSidePort.js';
import { resolveEndlessCoursePoint } from '../src/entities/endless/EndlessParcoursCourseSpace.js';
import { createEndlessPathSample } from '../src/entities/endless/EndlessParcoursPathMetric.js';
import { sphereIntersectsStaticMeshCollider as intersects } from '../src/entities/arena/StaticMeshCollider.js';
import { EndlessParcoursExclusionZone } from '../src/entities/endless/EndlessParcoursExclusionZone.js';
import { EndlessParcoursWaterSource } from '../src/entities/endless/EndlessParcoursWater.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { telegraphEndlessSpawn } from '../src/entities/endless/EndlessParcoursBotDirectorOps.js';
import { tryActivateEndlessSlot } from '../src/entities/endless/EndlessParcoursSlotOps.js';

function point(module, port, q, v = 0, z = port.localZ) {
    return new THREE.Vector3().copy(resolveEndlessCoursePoint(module,
        q * port.ux - v * port.uy, q * port.uy + v * port.ux, z, createEndlessPathSample()).position);
}

test('side ports have watertight query topology and exact visible collider triangles in all four directions', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 4; seed++) {
        const path = new EndlessParcoursPath({ baseSeed: seed });
        const module = path.getModule(4, 4), material = new THREE.MeshBasicMaterial();
        const tube = buildEndlessTube({ module, baseSeed: seed, material, ownerId: 'test' });
        const port = tube.port; assert.ok(port); seen.add(port.side);
        const geometry = tube.geometries[1], indices = geometry.index.array, edges = new Map();
        for (let i = 0; i < indices.length; i += 3) {
            for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
                const key = a < b ? `${a}:${b}` : `${b}:${a}`;
                edges.set(key, (edges.get(key) || 0) + 1);
            }
        }
        assert.ok([...edges.values()].every(count => count === 2), 'each query edge belongs to exactly two triangles');
        const wall = tube.mesh.geometry, triangles = tube.collider.meshCollider.worldTriangles;
        for (let i = 0; i < wall.index.count; i++) {
            const v = wall.index.getX(i);
            for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(triangles[i * 3 + axis]
                - wall.attributes.position.array[v * 3 + axis] - (axis === 2 ? module.originZ : 0)) < 1e-4);
        }
        assert.ok(wall.index.count / 3 <= 4000);
        const instance = { module, bounds: tube.box, staticColliders: [tube.collider], volumeCollider: tube.volumeCollider, underwater: true };
        const runtime = { activeModules: new Map([[4, instance]]) };
        const zone = new EndlessParcoursExclusionZone(runtime), water = new EndlessParcoursWaterSource(runtime);
        for (let q = 0; q < port.endQ - 3; q += 0.5) {
            const p = point(module, port, q);
            assert.equal(intersects(tube.collider.meshCollider, p, 2.5), false, `clear shaft ${port.side} q=${q}`);
            assert.equal(intersects(tube.volumeCollider, p, 0), true, `inside union ${port.side} q=${q}`);
            assert.equal(zone.isOutside({ position: p, hitboxRadius: 1.2 }), false);
            assert.equal(water.isPositionUnderwater(p), true);
        }
        const outside = point(module, port, port.endQ + 4);
        assert.equal(intersects(tube.volumeCollider, outside, 0), false);
        assert.equal(water.isPositionUnderwater(outside), false);
        assert.equal(zone.isOutside({ position: outside, hitboxRadius: 1.2 }), true);
        const sideWall = point(module, port, port.endQ - 8, 0, module.length * 4 / 32);
        assert.equal(intersects(tube.collider.meshCollider, sideWall, 0.5), true, 'shaft has a physical longitudinal sidewall');
        // The public first and last cabin rings retain the exact old ordering.
        for (const ring of [0, ENDLESS_TUBE.axialSegments]) {
            const frame = path.getMetric().sampleAtProgress(4, ring / ENDLESS_TUBE.axialSegments, createEndlessPathSample());
            for (let side = 0; side < ENDLESS_TUBE.radialSegments; side++) {
                const theta = side * 2 * Math.PI / ENDLESS_TUBE.radialSegments;
                const expected = new THREE.Vector3().copy(frame.position)
                    .addScaledVector(frame.right, 27 * Math.cos(theta)).addScaledVector(frame.up, 27 * Math.sin(theta));
                const actual = new THREE.Vector3().fromBufferAttribute(wall.attributes.position, ring * ENDLESS_TUBE.radialSegments + side);
                actual.z += module.originZ; assert.ok(actual.distanceTo(expected) < 1e-4);
            }
        }
        tube.geometries.forEach(g => g.dispose()); material.dispose();
    }
    assert.equal(seen.size, 4);
});

test('side port selection is deterministic and keeps intro and recovery modules intact', () => {
    const path = new EndlessParcoursPath({ baseSeed: 3 });
    const seen = new Set();
    for (let index = 0; index < 100; index++) {
        const module = path.getModule(index, 4), port = resolveEndlessSidePort(module, 3);
        assert.deepEqual(port, resolveEndlessSidePort(module, 3));
        if (index < 4 || module.recovery) assert.equal(port, null);
        if (port) seen.add(port.side);
    }
    assert.equal(seen.size, 4);
});

test('real reserved slots announce their shaft, face its entrance and receive a collision-free shaft-first route', () => {
    const human = { index: 0, alive: true, position: new THREE.Vector3(), baseSpeed: 25,
        getDirection(out) { return out.set(0, 0, 1); } };
    const player = { index: 1, isBot: true, alive: false, position: new THREE.Vector3() };
    let activation;
    const manager = { humanPlayers: [human], players: [human, player], bots: [{ player }],
        activateBotSlot(options) { activation = { ...options, direction: options.direction.clone() };
            player.position.copy(options.position); player.alive = true; return true; },
        deactivateBotSlot() { player.alive = false; } };
    const arena = { checkCollisionFast(position, radius) {
        for (const instance of runtime.activeModules.values()) {
            if (instance.staticColliders.some(c => intersects(c.meshCollider, position, radius))) return true;
        }
        return false;
    } };
    const runtime = new EndlessParcoursRuntime({ baseSeed: 4242, entityManager: manager, arena });
    runtime._syncModules(4, 4);
    human.position.copy(runtime.getCoursePoint(4, 0, 0, 90).position);
    const slot = runtime._botSlots[0];
    Object.assign(slot, { state: 'reserved', reservedWave: 3, telegraphedAt: -1, plannedElite: false });
    runtime.waveNumber = 3; runtime.wavePhase = 'attack'; runtime.currentModuleIndex = 4;
    runtime.elapsedCombatSeconds = 3; runtime.lastBotActivationAtSeconds = -Infinity;
    assert.equal(telegraphEndlessSpawn(runtime, slot), true);
    assert.ok(slot.plannedAnchor.portId, 'safe shaft is preferred over an ordinary course anchor');
    const instance = [...runtime.activeModules.values()].find(i => i.sidePort?.id === slot.plannedAnchor.portId);
    const port = instance.sidePort;
    assert.equal(runtime.spawnWarning.side, port.side);
    assert.equal(tryActivateEndlessSlot(runtime, slot), false, 'warning interval cannot be skipped');
    runtime.elapsedCombatSeconds += 3;
    assert.equal(tryActivateEndlessSlot(runtime, slot), true);
    assert.ok(activation.direction.distanceTo(new THREE.Vector3().copy(port.axis).negate()) < 1e-6);
    assert.equal(player.endlessPortId, port.id);
    assert.ok(player.position.distanceTo(human.position) >= 18);
    const route = runtime.getBotRouteSnapshot(player.index);
    assert.ok(route, 'spawned shaft bot has an owned route');
    const target = route.checkpoints[0].pos.clone();
    for (let i = 0; i <= 100; i++) {
        const p = player.position.clone().lerp(target, i / 100);
        assert.equal(arena.checkCollisionFast(p, 2.5), false, 'first route segment never cuts the shaft walls');
    }
    assert.ok(target.distanceTo(port.origin) < player.position.distanceTo(port.origin));
    // A streamed-out shaft cannot be used as a stale spawn or route.
    player.position.copy(runtime.getCoursePoint(instance.module.moduleIndex, 0, 0, port.localZ).position);
    assert.equal(runtime.getBotRouteSnapshot(player.index), route);
    assert.ok(route.checkpoints[0].pos.distanceTo(target) > 10, 'main-course guidance resumes after entering');
    runtime.dispose();
    assert.equal(runtime.getBotRouteSnapshot(player.index), null);
});
