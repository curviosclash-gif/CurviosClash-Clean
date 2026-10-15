import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { DANDELION_SKY_MAP } from '../src/core/config/maps/presets/dandelion_sky.js';
import { DANDELION_STEM_FLIGHT_ROUTE as ROUTE, DANDELION_STEM_GATES as GATES,
    DANDELION_STEM_PICKUPS as PICKUPS } from '../src/core/config/maps/presets/dandelion_sky/DandelionSkyStem.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { DandelionSeedController } from '../src/entities/arena/DandelionSeedController.js';
import { sphereIntersectsStaticMeshCollider, raycastStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { SpecialGateRuntime } from '../src/entities/arena/portal/SpecialGateRuntime.js';
import { MapOwnedPickupSystem } from '../src/entities/systems/MapOwnedPickupSystem.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP = DANDELION_SKY_MAP.dandelion_sky;
const EXPECTED = ['ROCKET_MEDIUM', 'REPAIR_DRONE', 'ROCKET_MEDIUM', 'ROCKET_MEDIUM',
    'FAN_5', 'ROCKET_MEDIUM', 'SHIELD', 'ROCKET_MEDIUM'];
const vector = (p, scale = 3) => new THREE.Vector3(...p).multiplyScalar(scale);

async function loadFlower(scale = 3) {
    return loadGLBMapCollection([MAP.glbModels[0]], {
        loader: geometryOnlyGlbLoader, placementScale: scale, colliderMode: 'scene',
    });
}

test('the exported hollow wall stays one closed primitive with inward and outward faces', async () => {
    const bytes = await readFile('assets/models/giant_dandelion/giant_dandelion_shootable.glb');
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    const stem = doc.nodes.find((n) => n.extras?.hollow_stem);
    assert.ok(stem);
    const primitives = doc.meshes[stem.mesh].primitives;
    assert.equal(primitives.length, 1, 'material splitting would break the solid-wall parity query');
    assert.ok(primitives[0].attributes.COLOR_0 !== undefined, 'fibres use vertex colours');
    const material = doc.materials[primitives[0].material];
    assert.notEqual(material.doubleSided, true);
    assert.ok(material.emissiveFactor.some((v) => v > 0));

    const loaded = await loadFlower();
    const collider = loaded.colliders.find((c) => c.sourceName.startsWith('Scape_')).meshCollider;
    const center = vector(ROUTE[4]);
    for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
        const hit = {};
        assert.ok(raycastStaticMeshCollider(collider, center, direction, 40, hit));
        assert.ok(hit.distance > 12 && hit.distance < 30);
        assert.ok(new THREE.Vector3(hit.nx, hit.ny, hit.nz).dot(direction) < -0.85,
            'the cavity faces inward');
        assert.equal(sphereIntersectsStaticMeshCollider(collider,
            center.clone().addScaledVector(direction, hit.distance + 0.5), 0.8), true);
        const outside = center.clone().addScaledVector(direction, 40);
        const outer = {};
        assert.ok(raycastStaticMeshCollider(collider, outside, direction.clone().negate(), 40, outer));
        assert.ok(new THREE.Vector3(outer.nx, outer.ny, outer.nz).dot(direction) > 0.85,
            'the outer wall faces outward');
    }
});

test('both doors and the full offset flight corridor clear walls and attached seeds', async () => {
    for (const scale of [1, 3]) {
        const loaded = await loadFlower(scale);
        const hard = loaded.colliders.filter((c) => c.meshCollider);
        const seeds = new DandelionSeedController(loaded.scene);
        let entityId = 0;
        // At production scale this reserves 4.8 world units, enough for the largest
        // regular vehicle and its drone (3.26 follow offset + 1.25 collision radius).
        const radius = 1.6 * scale;
        for (const offset of [0, scale, -scale]) {
            for (let segment = 1; segment < ROUTE.length; segment++) {
                const a = vector(ROUTE[segment - 1], scale);
                const b = vector(ROUTE[segment], scale);
                const steps = Math.ceil(a.distanceTo(b) / (radius / 4));
                for (let step = 0; step <= steps; step++) {
                    const point = a.clone().lerp(b, step / steps);
                    point.x += offset;
                    assert.equal(hard.some((c) => sphereIntersectsStaticMeshCollider(c.meshCollider, point, radius)),
                        false, `wall: scale=${scale}, segment=${segment}, step=${step}, offset=${offset}`);
                    assert.equal(seeds.consumeCollision(point, radius, entityId++), null,
                        `attached seed: segment=${segment}, step=${step}`);
                }
            }
        }
        for (const item of PICKUPS) {
            const point = vector([item.x, item.y, item.z], scale);
            assert.equal(hard.some((c) => sphereIntersectsStaticMeshCollider(c.meshCollider, point, radius)), false);
        }
    }
});

test('stem gates help only upward crossings and keep each player cooldown separate', async () => {
    const loaded = await loadFlower();
    assert.equal(GATES.length, 3);
    const specialGates = GATES.map((g) => ({ ...g, pos: vector(g.pos),
        forward: vector(g.forward, 1).normalize(), up: vector(g.up, 1), radius: g.radius * 3,
        cooldowns: new Map() }));
    const runtime = new SpecialGateRuntime({ specialGates });
    for (const gate of specialGates) {
        assert.deepEqual(gate.params, { duration: 0.8, forwardImpulse: 8, liftImpulse: 3, cooldown: 1.5 });
        // Existing gate visuals, including their arrow, fit in a 4-world-unit sphere.
        assert.equal(loaded.colliders.some((c) => sphereIntersectsStaticMeshCollider(c.meshCollider, gate.pos, 4)), false);
        const below = gate.pos.clone().addScaledVector(gate.forward, -0.5);
        const above = gate.pos.clone().addScaledVector(gate.forward, 0.5);
        assert.equal(runtime.checkSpecialGates(below, above, 1.6, 7), null);
        assert.equal(runtime.checkSpecialGates(above, below, 1.6, 7)?.ok, true);
        assert.equal(runtime.checkSpecialGates(above, below, 1.6, 7)?.ok, false);
        assert.equal(runtime.checkSpecialGates(above, below, 1.6, 8)?.ok, true);
    }
    runtime.update(1.6);
    assert.ok(specialGates.every((g) => g.cooldowns.size === 0));
});

function pickupRuntime(mode) {
    const scene = new THREE.Scene();
    const renderer = { addToScene: (m) => scene.add(m), removeFromScene: (m) => scene.remove(m) };
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    const arena = { currentMapDefinition: MAP, entityRuntimeConfig: config };
    const manager = new PowerupManager(renderer, arena, config);
    const strategy = mode === 'HUNT' ? new HuntModeStrategy(config) : new ArcadeModeStrategy();
    manager.getStrategy = () => strategy;
    const owner = { arena, powerupManager: manager, entityRuntimeConfig: config };
    return { manager, system: new MapOwnedPickupSystem(owner) };
}

test('map-owned items have exact mode-safe contents, one collection and a clean round reset', () => {
    assert.deepEqual(MAP.mapOwnedPickups.map((p) => p.pickupType), EXPECTED);
    for (const mode of ['HUNT', 'ARCADE']) {
        const { manager, system } = pickupRuntime(mode);
        try {
            system.startRound();
            const expected = mode === 'HUNT' ? EXPECTED : ['REPAIR_DRONE', 'SHIELD'];
            assert.deepEqual(manager.items.map((p) => p.type), expected);
            for (const item of [...manager.items]) {
                const result = manager.checkPickup(item.mesh.position, 1.6, () => true);
                assert.equal(result?.type, item.type);
                assert.equal(manager.checkPickup(item.mesh.position, 1.6, () => true), null);
            }
            system.update();
            assert.equal(manager.items.length, 0, 'collected map-owned items do not respawn');
            system.startRound();
            assert.deepEqual(manager.items.map((p) => p.type), expected);
            system.startRound();
            assert.equal(manager.items.length, expected.length, 'restart never duplicates pickups');
        } finally {
            system.clear();
            manager.dispose();
        }
    }
});

test('a replica leaves spawning to the host snapshot', () => {
    const host = pickupRuntime('HUNT');
    const replica = pickupRuntime('HUNT');
    try {
        host.system.startRound();
        replica.system.setNetworkReplica(true);
        replica.manager.setNetworkReplica(true);
        replica.system.startRound();
        assert.equal(replica.manager.items.length, 0);
        const snapshot = createGameStateSnapshot({ powerupManager: host.manager }).powerups;
        replica.manager.applyNetworkSnapshot(snapshot);
        assert.deepEqual(replica.manager.items.map((p) => p.type), EXPECTED);
        const item = host.manager.items[0];
        host.manager.checkPickup(item.mesh.position, 1.6, () => true);
        replica.manager.applyNetworkSnapshot(createGameStateSnapshot({ powerupManager: host.manager }).powerups);
        assert.equal(replica.manager.items.length, 7);
    } finally {
        host.system.clear(); host.manager.dispose();
        replica.system.clear(); replica.manager.dispose();
    }
});
