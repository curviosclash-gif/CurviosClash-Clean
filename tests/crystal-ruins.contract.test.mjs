import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CRYSTAL_RUINS_MAP } from '../src/core/config/maps/presets/crystal_ruins.js';

const map = CRYSTAL_RUINS_MAP.crystal_ruins;
const COLLIDING_VARIANTS = Object.freeze([
    '/broken-arches/crystal-ruins-broken-arch-v01/',
    '/broken-arches/crystal-ruins-broken-arch-v04/',
    '/damaged-columns/crystal-ruins-damaged-column-v03/',
    '/damaged-columns/crystal-ruins-damaged-column-v07/',
]);

function horizontalDistance(left, right) {
    return Math.hypot(left[0] - right[0], left[2] - right[2]);
}

test('Crystal Ruins curates four coherent six-piece ruin ensembles from the forty-asset library', () => {
    assert.equal(map.glbModels.length, 24);
    assert.equal(map.glbColliderMode, 'scene');
    assert.equal(map.glbLoadConcurrency, 3);
    const families = ['broken-arches', 'damaged-columns', 'rubble-clusters', 'crystal-growths'];
    for (const family of families) {
        assert.equal(map.glbModels.filter((model) => model.url.includes(`/${family}/`)).length, 6, `${family} contributes six curated assets`);
    }
    assert.equal(new Set(map.glbModels.map((model) => model.id)).size, map.glbModels.length, 'all placement IDs are stable and unique');
    for (const model of map.glbModels) {
        assert.ok(model.url.startsWith('assets/maps/crystal_ruins/props/'));
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a shipped GLB`);
        assert.ok(model.targetSize >= 6 && model.targetSize <= 19, `${model.id} stays legible without dominating the arena`);
    }
});

test('new Crystal Ruins collision stays coarse and outside protected routes and anchors', () => {
    const colliding = map.glbModels.filter((model) => COLLIDING_VARIANTS.some((needle) => model.url.includes(needle)));
    assert.equal(colliding.length, 4, 'only two arches and two massive columns add prop collision');
    const protectedAnchors = [
        [map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z],
        ...map.botSpawns.map((spawn) => [spawn.x, spawn.y, spawn.z]),
        ...map.items.map((item) => [item.x, item.y, item.z]),
        ...map.gates.map((gate) => gate.pos),
        ...map.portals.flatMap((portal) => [portal.a, portal.b]),
    ];
    for (const model of colliding) {
        assert.ok(Math.min(Math.abs(model.position[0]), Math.abs(model.position[2])) >= 20, `${model.id} stays off both cardinal boost lanes`);
        assert.ok(model.targetSize <= 16, `${model.id} keeps a conservative collision footprint`);
        assert.ok(protectedAnchors.every((anchor) => horizontalDistance(model.position, anchor) >= 12), `${model.id} clears spawns, items, gates, and portals`);
    }
    const decorative = map.glbModels.filter((model) => !colliding.includes(model));
    assert.ok(decorative.every((model) => !model.url.includes('broken-arch-v08') && !model.url.includes('damaged-column-v05') && !model.url.includes('damaged-column-v10')), 'unused colliding library variants remain out of the curated map');
});

test('existing Crystal Ruins geometry remains compiled alongside the GLB props', () => {
    const map = CRYSTAL_RUINS_MAP.crystal_ruins;
    assert.ok(map.obstacles.length > 0);
    assert.ok(map.obstacles.every((obstacle) => obstacle.compileWithGlb === true));
});
