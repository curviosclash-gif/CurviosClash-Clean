import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONFIG, CONFIG_BASE } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { normalizeMapExpansion } from '../src/shared/contracts/MapExpansionContract.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { analyzeMapAnchors, violationKey } from './helpers/map-anchor-guard.mjs';

// bloom_core grows during the round: the floor is built at the final size, only the collision
// bounds follow the stages. Spawns and item anchors are authored in world units (the map has no
// scaleAuthoredAnchors) while the stage sizes are in map units, so every number here converts
// the stage with MAP_SCALE first.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const MAP = MAP_PRESET_CATALOG.bloom_core;
const STAGES = normalizeMapExpansion(MAP.expansion).stages;
const HALF = STAGES.map((stage) => (stage.size[0] * MAP_SCALE) / 2);
const MIN_SPAWN_SPACING = 60;
const MIN_ITEMS_PER_STAGE = 3;

const anchorOf = (entry) => {
    const pos = Array.isArray(entry.pos) ? entry.pos : [];
    return [Number(entry.x ?? pos[0]), Number(entry.y ?? pos[1]), Number(entry.z ?? pos[2])];
};
// The square ring a point belongs to: the first stage whose bounds contain it.
const stageOf = (point) => HALF.findIndex((half) => Math.abs(point[0]) <= half && Math.abs(point[2]) <= half);

test('the known anchor list holds nothing for bloom_core any more', () => {
    const known = JSON.parse(readFileSync(new URL('./fixtures/map-anchor-guard-known.json', import.meta.url), 'utf8'));
    assert.deepEqual(known.entries.filter((entry) => entry.map === 'bloom_core').map(violationKey), []);
    assert.equal(analyzeMapAnchors('bloom_core', MAP, MAP_SCALE).length, 0, 'the guard finds nothing on bloom_core');
});

test('the five starts keep their distance and stay inside the core stage', () => {
    const spawns = [MAP.playerSpawn, ...MAP.botSpawns].map(anchorOf);
    assert.equal(spawns.length, 5);
    let closest = Infinity;
    for (let a = 0; a < spawns.length; a += 1) {
        assert.equal(stageOf(spawns[a]), 0, `spawn ${a} lies in the first stage`);
        for (let b = a + 1; b < spawns.length; b += 1) {
            closest = Math.min(closest, Math.hypot(...spawns[a].map((value, axis) => value - spawns[b][axis])));
        }
    }
    assert.ok(closest >= MIN_SPAWN_SPACING, `closest pair of starts is ${closest.toFixed(1)}, needs ${MIN_SPAWN_SPACING}`);
});

test('every growth stage has item anchors of its own ring', () => {
    const perStage = STAGES.map(() => 0);
    for (const entry of MAP.items) {
        const stage = stageOf(anchorOf(entry));
        assert.ok(stage >= 0, 'an item anchor lies outside the final arena');
        perStage[stage] += 1;
    }
    perStage.forEach((count, stage) => {
        assert.ok(count >= MIN_ITEMS_PER_STAGE, `stage ${stage} (${STAGES[stage].id}) has ${count} anchors, needs ${MIN_ITEMS_PER_STAGE}`);
    });
});

test('anchors of a sealed ring are not offered before their stage opens', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const anchors = MAP.items.map((entry) => {
        const [x, y, z] = anchorOf(entry);
        return { ...entry, x, y, z };
    });
    const bounds = (half) => ({ minX: -half, maxX: half, minZ: -half, maxZ: half, minY: 0, maxY: 240 });
    const arena = { currentMapDefinition: MAP, bounds: bounds(HALF[0]), getAuthoredItemAnchors: () => anchors };
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, arena, entityRuntimeConfig);

    HALF.forEach((half, stage) => {
        arena.bounds = bounds(half);
        const offered = manager._getAvailableAuthoredAnchors().map((entry) => entry.anchor);
        assert.ok(offered.every((anchor) => Math.abs(anchor.x) <= half && Math.abs(anchor.z) <= half),
            `stage ${stage} offers an anchor outside its bounds`);
        assert.equal(offered.length, anchors.filter((anchor) => stageOf([anchor.x, anchor.y, anchor.z]) <= stage).length);
    });
    // A map that does not grow keeps offering every anchor, whatever its bounds say.
    arena.currentMapDefinition = { items: anchors };
    arena.bounds = bounds(1);
    assert.equal(manager._getAvailableAuthoredAnchors().length, anchors.length);
    manager.dispose();
});
