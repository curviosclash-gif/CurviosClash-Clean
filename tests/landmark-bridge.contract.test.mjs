import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { placeMapGlbModel, worldMeshBounds } from './helpers/placed-glb-model.mjs';

const MAP_KEY = 'storm_bridge_siege';

test('wave 6 bridge is a playable destructible landmark with a secret portal', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');

    const destructibles = normalizeMapDestructibles(map.destructibles);
    assert.ok(destructibles, 'the bridge must expose destructible geometry');
    assert.deepEqual(destructibles.gameModes, ['HUNT']);
    assert.deepEqual(destructibles.segments.map((segment) => segment.id), ['bridge_span']);
    assert.equal(destructibles.segments[0].kind, 'landmark');
    assert.equal(destructibles.breakScenes.length, 1);
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, ['storm-bridge-intact', 'storm-bridge-train']);

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');
    assert.equal(rooms[0].unlock.delaySeconds, 4);
    assert.ok(rooms[0].items.length >= 8);

    for (const model of map.glbModels) {
        assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    }
    assert.ok(existsSync('assets/maps/storm_bridge_siege/blender/01_bridge.blend'));
    assert.ok(existsSync('assets/maps/storm_bridge_siege/blender/20_bridge_collapse.blend'));
});

// The loader stands every model on its bind-pose bottom and centres it there, so a train placed at
// the origin lands on the street and runs off the east end. The preset has to put it back on the
// deck: wheels on the deck top, inside the deck's width, and a run centred on the span.
test('the bridge train runs on the deck for its whole loop', async () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const bridge = await placeMapGlbModel(map, 'storm-bridge-intact');
    const deck = worldMeshBounds(bridge.scene, (mesh) => mesh.name === 'bridge_span_deck');
    assert.ok(!deck.isEmpty(), 'the intact bridge has a deck mesh');
    const train = await placeMapGlbModel(map, 'storm-bridge-train');
    const steps = 24;
    let runMinX = Infinity;
    let runMaxX = -Infinity;
    for (let step = 0; step <= steps; step += 1) {
        const time = Math.min(train.clip.duration * (step / steps), train.clip.duration - 1e-4);
        train.pose(time);
        const body = worldMeshBounds(train.scene);
        const at = `t=${time.toFixed(2)}`;
        assert.ok(Math.abs(body.min.y - deck.max.y) <= 0.05, `${at}: train bottom ${body.min.y.toFixed(2)} not on deck top ${deck.max.y.toFixed(2)}`);
        assert.ok(body.min.z >= deck.min.z && body.max.z <= deck.max.z, `${at}: train leaves the deck width`);
        runMinX = Math.min(runMinX, body.min.x);
        runMaxX = Math.max(runMaxX, body.max.x);
    }
    const deckCentre = (deck.min.x + deck.max.x) / 2;
    assert.ok(Math.abs((runMinX + runMaxX) / 2 - deckCentre) <= 0.5,
        `train run ${runMinX.toFixed(1)}..${runMaxX.toFixed(1)} is not centred on the deck ${deck.min.x.toFixed(1)}..${deck.max.x.toFixed(1)}`);
});