import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeMapLightSources } from '../src/shared/contracts/MapLightSourcesContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { loadGLBMap } from '../src/entities/GLBMapLoader.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP_KEY = 'storm_lighthouse_siege';

test('wave 6 lighthouse is a playable destructible landmark with a secret portal', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');

    const destructibles = normalizeMapDestructibles(map.destructibles);
    assert.ok(destructibles, 'the lighthouse must expose destructible geometry');
    assert.deepEqual(destructibles.gameModes, ['HUNT']);
    assert.deepEqual(destructibles.segments.map((segment) => segment.id), ['lighthouse_tower']);
    assert.equal(destructibles.segments[0].kind, 'landmark');
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, [
        'storm-lighthouse-intact',
        'storm-lighthouse-lift',
        'storm-lighthouse-beacon',
    ]);
    assert.equal(destructibles.breakScenes[0].yawFromEvent, false);
    assert.equal(destructibles.breakScenes[0].blast.delaySeconds, 4.6);

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');
    assert.equal(rooms[0].unlock.delaySeconds, 5.5);
    assert.deepEqual(rooms[0].entryPortal.pos, [21, 11, 0]);
    assert.ok(rooms[0].items.length >= 8);

    assert.deepEqual(map.glbModels.map((model) => model.id), [
        'storm-lighthouse-island',
        'storm-lighthouse-intact',
        'storm-lighthouse-collapse',
        'storm-lighthouse-lift',
        'storm-lighthouse-beacon',
    ]);
    for (const model of map.glbModels) {
        assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    }
    assert.equal(map.glbModels.at(-1).collision, false);
    assert.deepEqual(map.glbModels.at(-1).animationClock, {
        mode: 'loop', clipName: 'LighthouseBeaconLoop',
    });
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/01_lighthouse.blend'));
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/20_lighthouse_collapse.blend'));
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/00_lighthouse_island.blend'));
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/31_lighthouse_beacon.blend'));
});

test('storm eye layout creates three populated traversal layers inside the arena', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.equal(map.gates.length, 4);
    assert.equal(map.gates.filter((gate) => gate.type === 'boost').length, 2);
    assert.equal(map.gates.filter((gate) => gate.type === 'slingshot').length, 2);
    assert.equal(new Set(map.gates.map((gate) => gate.id)).size, map.gates.length);

    assert.equal(map.items.length, 6);
    assert.equal(new Set(map.items.map((item) => item.id)).size, map.items.length);
    assert.ok(map.items.some((item) => item.pickupType === 'ROCKET_HEAVY'));
    assert.ok(map.items.some((item) => item.pickupType === 'SPEED_UP'));
    assert.ok(map.items.some((item) => item.pickupType === 'SHIELD'));
    assert.equal(map.botSpawns.length, 6);
    assert.equal(normalizeMapLightSources(map.lights).length, 3);

    const authoredAnchors = [map.playerSpawn, ...map.botSpawns, ...map.items, ...map.gates.map((gate) => ({
        x: gate.pos[0], y: gate.pos[1], z: gate.pos[2],
    }))];
    const [width, height, depth] = map.size;
    for (const anchor of authoredAnchors) {
        assert.ok(Math.abs(anchor.x) < width / 2, `x anchor inside arena: ${anchor.x}`);
        assert.ok(anchor.y > 0 && anchor.y < height, `y anchor inside arena: ${anchor.y}`);
        assert.ok(Math.abs(anchor.z) < depth / 2, `z anchor inside arena: ${anchor.z}`);
    }

    const room = normalizeSecretRooms(map.secretRooms)[0];
    const dx = room.entryPortal.pos[0] - map.playerSpawn.x;
    const dz = room.entryPortal.pos[2] - map.playerSpawn.z;
    assert.ok(Math.hypot(dx, dz) > 60, 'the vault entrance moved away from the player spawn');
});

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDuration(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

test('storm eye GLBs keep the authored rings, low-poly budget and timed beacon', () => {
    const root = 'assets/maps/storm_lighthouse_siege';
    const islandPath = `${root}/glb/00_lighthouse_island.glb`;
    const beaconPath = `${root}/glb/31_lighthouse_beacon.glb`;
    const island = readGlbJson(islandPath);
    const beacon = readGlbJson(beaconPath);
    const islandNames = (island.nodes || []).map((node) => String(node.name || ''));

    assert.ok(islandNames.includes('lighthouse_island_core'));
    assert.ok(islandNames.includes('lighthouse_keeper_house'));
    assert.ok(islandNames.includes('lighthouse_generator_house'));
    assert.equal(islandNames.filter((name) => name.startsWith('lighthouse_spiral_deck_')).length, 5);
    assert.equal(island.animations, undefined);
    assert.ok(statSync(islandPath).size < 750_000, 'static island stays below its runtime budget');

    assert.equal(beacon.animations?.length, 1);
    assert.equal(beacon.animations[0].name, 'LighthouseBeaconLoop');
    assert.ok(Math.abs(animationDuration(beacon, beacon.animations[0]) - 8) <= (1 / 30));
    assert.ok((beacon.materials || []).some((material) => material.alphaMode === 'BLEND'));
    assert.ok((beacon.nodes || []).filter((node) => /beacon_(east|west)/.test(node.name || '')).length === 2);
});

test('storm eye runtime builds static island collision and no beacon collision', async () => {
    const island = await loadGLBMap('assets/maps/storm_lighthouse_siege/glb/00_lighthouse_island.glb', {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
    });
    try {
        assert.ok(island.colliders.length >= 35);
        assert.ok(island.colliders.every((collider) => collider.dynamic !== true));
    } finally {
        disposeObject3DResources(island.scene);
    }

    const beacon = await loadGLBMap('assets/maps/storm_lighthouse_siege/glb/31_lighthouse_beacon.glb', {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        collectColliders: false,
        animationClock: { mode: 'loop', clipName: 'LighthouseBeaconLoop' },
    });
    try {
        assert.equal(beacon.colliders.length, 0);
        assert.equal(beacon.animationTracks.length, 1);
        assert.equal(beacon.animationTracks[0].clipName, 'LighthouseBeaconLoop');
    } finally {
        disposeObject3DResources(beacon.scene);
    }

    const collapse = await loadGLBMap('assets/maps/storm_lighthouse_siege/glb/20_lighthouse_collapse.glb', {
        loader: geometryOnlyGlbLoader,
        colliderMode: 'scene',
        modelId: 'storm-lighthouse-collapse',
        animationClock: { mode: 'once', clipName: 'LighthouseCollapseOnce' },
    });
    try {
        const track = collapse.animationTracks[0];
        assert.equal(track.clipName, 'LighthouseCollapseOnce');
        track.action.time = track.durationSeconds;
        track.mixer.update(0);
        collapse.scene.updateMatrixWorld(true);
        const size = new THREE.Box3().setFromObject(collapse.scene).getSize(new THREE.Vector3());
        assert.ok(size.x > size.y * 1.5, 'settled wreck lies across the fixed positive-X corridor');
        assert.ok(collapse.colliders.filter((collider) => collider.dynamic).length >= 10);
    } finally {
        disposeObject3DResources(collapse.scene);
    }
});
