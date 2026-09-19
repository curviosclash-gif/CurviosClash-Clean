import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';

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
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, ['storm-lighthouse-intact', 'storm-lighthouse-lift']);

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');
    assert.equal(rooms[0].unlock.delaySeconds, 4);
    assert.ok(rooms[0].items.length >= 8);

    for (const model of map.glbModels) {
        assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    }
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/01_lighthouse.blend'));
    assert.ok(existsSync('assets/maps/storm_lighthouse_siege/blender/20_lighthouse_collapse.blend'));
});
