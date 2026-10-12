import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { CHRONO_FORGE_NEXUS_MAP } from '../src/core/config/maps/presets/chrono_forge_nexus.js';
import { ECLIPSE_FOUNDRY_MAP } from '../src/core/config/maps/presets/eclipse_foundry.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

const map = ECLIPSE_FOUNDRY_MAP.eclipse_foundry;
const chrono = CHRONO_FORGE_NEXUS_MAP.chrono_forge_nexus;
const ANIMATED_ASSET_PREFIX = 'assets/maps/chrono_forge/glb/';

test('Eclipse Foundry is registered as a complex desktop parcours map', () => {
    assert.equal(MAP_PRESET_CATALOG.eclipse_foundry, map);
    assert.equal(MAP_PRESETS_BASE.eclipse_foundry, map);
    assert.deepEqual(map.size, [440, 140, 300]);
    assert.equal(map.parcours.enabled, true);
});

test('Eclipse Foundry combines three branches with dense traversal systems', () => {
    const route = buildRouteFromParcours(map.parcours);

    assert.ok(route);
    assert.equal(route.routeId, 'eclipse_foundry_v1');
    assert.equal(route.totalCheckpoints, 16);
    assert.equal(route.branches.length, 3);
    assert.ok(route.branches.every((branch) => branch.validMerge));
    assert.ok(route.branches.every((branch) => branch.nextCheckpointIds.length === 2));
    assert.equal(map.portals.length, 4);
    assert.equal(map.gates.filter((gate) => gate.type === 'boost').length, 6);
    assert.equal(map.gates.filter((gate) => gate.type === 'slingshot').length, 3);
    assert.equal(map.items.length, 12);
    assert.equal(map.aircraft.length, 4);
    assert.ok(map.obstacles.length >= 60);
});

test('Eclipse Foundry places thirteen animated GLBs with authored fallback collision', () => {
    const animatedModels = map.glbModels.filter((model) => model.url.startsWith(ANIMATED_ASSET_PREFIX));

    assert.equal(map.glbModels.length, 27, '26 landmarks plus the Blender world skin');
    assert.equal(animatedModels.length, 13);
    assert.equal(new Set(map.glbModels.map((model) => model.id)).size, map.glbModels.length);
    assert.equal(map.glbColliderMode, 'dynamic');
    assert.equal(map.glbLoadConcurrency, 3);
    for (const model of map.glbModels) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
    }
});

test('Eclipse Foundry route triggers stay within the arena', () => {
    const [width, height, depth] = map.size;
    const entries = [...map.parcours.checkpoints, map.parcours.finish];

    for (const entry of entries) {
        const [x, y, z] = entry.pos;
        assert.ok(Math.abs(x) + entry.radius <= width / 2, `${entry.id} fits in X`);
        assert.ok(y - entry.radius >= 0 && y + entry.radius <= height, `${entry.id} fits in Y`);
        assert.ok(Math.abs(z) + entry.radius <= depth / 2, `${entry.id} fits in Z`);
    }
});

test('Eclipse Foundry sets its own three missions apart from Chrono-Forge', () => {
    assert.equal(map.missions.length, 3);
    const signature = (mission) => JSON.stringify([mission.type, mission.params]);
    const shared = new Set(chrono.missions.map(signature));
    assert.deepEqual(map.missions.map(signature).filter((entry) => shared.has(entry)), []);
    assert.notDeepEqual(map.missions.map((mission) => mission.type).sort(), chrono.missions.map((mission) => mission.type).sort());
});

test('Eclipse Foundry shows a Blender world and keeps its authored boxes as collision only, like Chrono-Forge', () => {
    assert.equal(map.glbAuthoredObstaclesCollisionOnly, chrono.glbAuthoredObstaclesCollisionOnly);
    const world = map.glbModels.find((model) => model.url === 'assets/maps/eclipse_foundry/glb/01_world.glb');
    assert.ok(world, 'the world skin is one of the models');
    assert.ok(existsSync(path.resolve(world.url)), 'the world GLB exists');
    assert.ok(existsSync(path.resolve('assets/maps/eclipse_foundry/blender/01_world.blend')), 'its Blender source exists');
});