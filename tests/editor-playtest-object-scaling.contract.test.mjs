import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { Arena } from '../src/entities/Arena.js';
import { createMapDocument, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

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

// Der Prewarm baut die Arena ohne Deko-Flugzeuge; erst der Matchstart holt sie per
// syncAuthoredAircraftDecorations() nach. Beide Wege muessen denselben Kartenmassstab sehen.
const AIRCRAFT_MAP_KEY = 'prewarm-aircraft-probe';
const AIRCRAFT_MAP_DEFINITION = Object.freeze({
    size: [100, 40, 100],
    obstacles: [],
    portals: [],
    gates: [],
    scaleAuthoredAnchors: true,
    aircraft: [{ id: 'ship', jetId: 'aircraft', x: 12, y: 6, z: -9, scale: 2 }],
});

function createHeadlessArena() {
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {},
        setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    arena.runtimeMapKey = AIRCRAFT_MAP_KEY;
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.runtimeMapDefinition = { ...AIRCRAFT_MAP_DEFINITION };
    return arena;
}

function describeAircraftDecorations(arena) {
    return arena._aircraftDecorations.map((entry) => ({
        id: entry.id,
        x: entry.root.position.x,
        y: entry.root.position.y,
        z: entry.root.position.z,
        scale: entry.root.scale.x,
    }));
}

test('a prewarmed arena places its synced aircraft at the map scale', async () => {
    const authored = AIRCRAFT_MAP_DEFINITION.aircraft[0];
    const direct = createHeadlessArena();
    const { scale } = await direct.build(AIRCRAFT_MAP_KEY);
    const expected = describeAircraftDecorations(direct);
    direct.dispose();

    assert.ok(scale > 1, 'the probe map has to run at a scale other than 1');
    assert.deepEqual(expected, [{
        id: authored.id,
        x: authored.x * scale,
        y: authored.y * scale,
        z: authored.z * scale,
        scale: authored.scale * scale,
    }]);

    const prewarmed = createHeadlessArena();
    await prewarmed.build(AIRCRAFT_MAP_KEY, { includeAuthoredAircraft: false });
    assert.deepEqual(describeAircraftDecorations(prewarmed), [], 'the prewarm skips the decorations');

    prewarmed.syncAuthoredAircraftDecorations();
    assert.deepEqual(
        describeAircraftDecorations(prewarmed),
        expected,
        'the synced decorations must match the ones the normal build path places',
    );
    prewarmed.dispose();
});
