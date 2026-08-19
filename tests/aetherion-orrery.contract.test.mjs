import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { AETHERION_ORRERY_MAP } from '../src/core/config/maps/presets/aetherion_orrery.js';
import { resolveMapSinglePlayerScenario } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';

const map = AETHERION_ORRERY_MAP.aetherion_orrery;
const PREFIX = 'assets/maps/aetherion_orrery/glb/';

test('Aetherion Orrery is registered as a hybrid adventure map', () => {
    assert.equal(MAP_PRESET_CATALOG.aetherion_orrery, map);
    assert.equal(MAP_PRESETS_BASE.aetherion_orrery, map);
    assert.equal(resolveMapPickerCollection('aetherion_orrery').id, 'adventure');
    assert.deepEqual(map.size, [320, 210, 320]);
    assert.deepEqual(map.portalLevels, [24, 84, 144]);
    assert.equal(map.parcours.enabled, true);
    assert.equal(map.parcours.routeId, 'aetherion_orrery_v1');
    assert.deepEqual(resolveMapSinglePlayerScenario(map), {
        id: 'aetherion_orrery_hunt',
        modePath: 'fight',
        gameMode: 'HUNT',
        minBots: 5,
        botRoles: ['guard', 'flanker', 'pursuer', 'interceptor', 'flanker'],
    });
});

test('Aetherion places four architecture parts and thirteen beat-synchronised mechanisms', () => {
    assert.equal(map.glbModels.length, 17);
    const local = map.glbModels.filter((model) => model.url.startsWith(PREFIX));
    assert.equal(local.length, 17);
    assert.equal(new Set(local.map((model) => model.url)).size, 10);
    const animated = local.filter((model) => model.animationClock);
    assert.equal(animated.length, 13);
    assert.equal(local.length - animated.length, 4);
    assert.equal(map.glbAnimationClock.beatSeconds, 12);
    assert.equal(map.glbColliderMode, 'dynamic');
    assert.equal(map.glbLoadConcurrency, 3);
    assert.ok(animated.every((model) => Number.isFinite(model.animationClock.phaseOffsetBeats)));
    assert.equal(animated.filter((model) => model.url.endsWith('/05_meridian_bridges.glb')).length, 3);
    assert.equal(animated.filter((model) => model.url.endsWith('/06_astrolabe_gate.glb')).length, 2);
    assert.equal(animated.filter((model) => model.url.endsWith('/07_eclipse_iris.glb')).length, 1);
    assert.equal(animated.filter((model) => model.url.endsWith('/08_comet_pendulum.glb')).length, 3);
    assert.equal(animated.filter((model) => model.url.endsWith('/09_zodiac_louvre.glb')).length, 3);
    assert.equal(animated.filter((model) => model.url.endsWith('/10_celestial_core.glb')).length, 1);
});

test('Aetherion keeps its Hunt inventory and spawns away from turrets', () => {
    assert.equal(map.botSpawns.length, 5);
    assert.equal(map.staticTurrets.length, 2);
    assert.equal(map.items.length, 10);
    assert.equal(map.portals.length, 2);
    assert.equal(map.gates.length, 6);

    const spawns = [map.playerSpawn, ...map.botSpawns];
    for (const spawn of spawns) {
        assert.ok(Math.abs(spawn.x) <= 160 && spawn.y >= 0 && spawn.y <= 210 && Math.abs(spawn.z) <= 160);
        for (const turret of map.staticTurrets) {
            const [tx, ty, tz] = turret.pos;
            const distance = Math.hypot(spawn.x - tx, spawn.y - ty, spawn.z - tz);
            assert.ok(distance > 80, `spawn ${JSON.stringify(spawn)} stays away from ${turret.id}`);
        }
    }
    assert.equal(map.items.filter((item) => item.type === 'item_shield').length, 3);
    assert.equal(map.items.filter((item) => item.type === 'item_rocket').length, 3);
});

test('Aetherion keeps a permanently open outer band around both upper decks', () => {
    const decks = map.obstacles.filter((entry) => entry.kind === 'foam' && entry.size?.[0] === 240);
    assert.equal(decks.length, 2);
    for (const deck of decks) {
        assert.deepEqual(deck.size, [240, 4, 240]);
    }
    const dynamicPositions = map.glbModels
        .filter((model) => model.animationClock && !model.url.endsWith('/10_celestial_core.glb'))
        .map((model) => model.position);
    assert.ok(dynamicPositions.every(([x, , z]) => Math.abs(x) < 100 && Math.abs(z) < 100));
    assert.ok(map.portals.every(({ a, b }) => Math.abs(a[0]) >= 130 && Math.abs(b[0]) >= 130));
});

test('Aetherion defines twelve route stages with three two-lane branches', () => {
    const checkpoints = map.parcours.checkpoints;
    assert.equal(checkpoints.length, 15);
    const branchEntries = checkpoints.filter((checkpoint) => checkpoint.nextIds?.length === 2);
    assert.equal(branchEntries.length, 3);
    const alternatives = checkpoints.filter((checkpoint) => /_(SAFE|FAST)$/.test(checkpoint.id));
    assert.equal(alternatives.length, 6);
    assert.equal(12, checkpoints.length - branchEntries.length);

    const [sx, sy, sz] = map.size;
    for (const trigger of [...checkpoints, map.parcours.finish]) {
        assert.ok(Math.abs(trigger.pos[0]) < sx / 2);
        assert.ok(trigger.pos[1] > 0 && trigger.pos[1] < sy);
        assert.ok(Math.abs(trigger.pos[2]) < sz / 2);
        assert.ok(trigger.radius >= 4.6);
    }
});

test('Aetherion safe branch lanes trade twenty to thirty percent distance for reliability', () => {
    const byId = new Map(map.parcours.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const distance = (left, right) => Math.hypot(...left.pos.map((value, index) => value - right.pos[index]));
    for (const [branchId, safeId, fastId, mergeId] of [
        ['CP02', 'CP03_SAFE', 'CP03_FAST', 'CP04'],
        ['CP05', 'CP06_SAFE', 'CP06_FAST', 'CP07'],
        ['CP08', 'CP09_SAFE', 'CP09_FAST', 'CP10'],
    ]) {
        const branch = byId.get(branchId);
        const safe = byId.get(safeId);
        const fast = byId.get(fastId);
        const merge = byId.get(mergeId);
        const safeLength = distance(branch, safe) + distance(safe, merge);
        const fastLength = distance(branch, fast) + distance(fast, merge);
        const ratio = safeLength / fastLength;
        assert.ok(ratio >= 1.2 && ratio <= 1.3, `${branchId} safe/fast ratio ${ratio.toFixed(3)} stays intentional`);
        assert.ok(Math.abs(safe.pos[0]) >= 120 || Math.abs(safe.pos[2]) >= 120, `${safeId} stays in the outer safety band`);
    }
});
