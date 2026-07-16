import assert from 'node:assert/strict';
import test from 'node:test';

import { Arena } from '../src/entities/Arena.js';
import { createMapDocument, toArenaMapDefinition } from '../src/entities/MapSchema.js';

test('editor playtest keeps authored objects aligned with runtime-scaled geometry', () => {
    const source = createMapDocument({
        arenaSize: { width: 2800, height: 950, depth: 2400 },
        hardBlocks: [{ x: 700, y: 140, z: -350, width: 280, height: 280, depth: 280 }],
        playerSpawn: { x: -700, y: 140, z: 350 },
        botSpawns: [{ x: 700, y: 140, z: 350 }],
        items: [{ id: 'pickup', type: 'item_crystal', x: 350, y: 140, z: -700 }],
        aircraft: [{ id: 'ship', jetId: 'aircraft', x: 1050, y: 280, z: 0, scale: 35 }],
        glbModels: [{ id: 'prop', url: 'assets/prop.glb', position: [-1050, 0, 0], targetSize: 70 }],
    });
    const conversionScale = 35;
    const runtimeScale = 3;
    const runtimeMap = toArenaMapDefinition(source, { mapScale: conversionScale }).map;
    const expected = (value) => value * runtimeScale / conversionScale;

    assert.equal(runtimeMap.scaleAuthoredAnchors, true);
    assert.equal(runtimeMap.obstacles[0].pos[0] * runtimeScale, expected(source.hardBlocks[0].x));
    assert.equal(runtimeMap.glbModels[0].position[0] * runtimeScale, expected(source.glbModels[0].position[0]));

    const renderer = { addToScene() {}, removeFromScene() {} };
    const arena = new Arena(renderer);
    arena._cacheAuthoredMapAnchors(runtimeMap, runtimeScale);
    arena._buildAuthoredAircraftDecorations(runtimeMap, runtimeScale);

    assert.equal(arena.getAuthoredPlayerSpawn().x, expected(source.playerSpawn.x));
    assert.equal(arena.getAuthoredBotSpawns()[0].x, expected(source.botSpawns[0].x));
    assert.equal(arena.getAuthoredItemAnchors()[0].z, expected(source.items[0].z));
    assert.equal(arena._aircraftDecorations[0].root.position.x, expected(source.aircraft[0].x));
    assert.equal(arena._aircraftDecorations[0].root.scale.x, expected(source.aircraft[0].scale));

    arena.dispose();
});
