// A catalog map turned into an editor document must come back unchanged through the export path
// (toArenaMapDefinition). Anything the converter cannot carry must be named in `skipped`.

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { getCustomMapConversionScale } from '../src/entities/CustomMapLoader.js';
import {
    fromArenaMapDefinition,
    parseMapJSON,
    toArenaMapDefinition,
} from '../src/entities/MapSchema.js';
import { DEFAULT_PORTAL_COLORS } from '../src/entities/mapSchema/MapSchemaConstants.js';

const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
// The documents hold 1e-6 editor units at best (rounding rule of the converter); that is 3e-8
// map units, so a millionth of a map unit leaves room and still catches any real drift.
const TOLERANCE = 1e-6;
const BOX_MAPS = ['standard', 'maze', 'complex', 'the_pit', 'pillar_hall', 'mega_maze', 'trench', 'crossfire'];

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

function backThroughExport(document) {
    const conversion = getCustomMapConversionScale(document).scale;
    return toArenaMapDefinition(document, { mapScale: conversion }).map;
}

/** Collects |a - b| for every compared number so the test can report the worst case. */
function createMeter() {
    const meter = { count: 0, max: 0, worst: '' };
    meter.num = (label, actual, expected) => {
        assert.ok(Number.isFinite(actual), `${label}: ${actual} is not a number`);
        const delta = Math.abs(actual - expected);
        meter.count += 1;
        if (delta > meter.max) { meter.max = delta; meter.worst = label; }
        assert.ok(delta <= TOLERANCE, `${label}: ${actual} != ${expected}`);
    };
    meter.vec = (label, actual, expected) => {
        assert.equal(actual?.length, expected.length, `${label}: length`);
        expected.forEach((value, index) => meter.num(`${label}[${index}]`, actual[index], value));
    };
    return meter;
}

const asVec = (entry) => (Array.isArray(entry?.pos)
    ? entry.pos.map(Number)
    : [Number(entry?.x) || 0, Number(entry?.y) || 0, Number(entry?.z) || 0]);

/** Compares a preset with its round trip; anchors follow the preset's own unit convention. */
function compareRoundTrip(key, preset, runtime) {
    const meter = createMeter();
    const anchorScale = preset.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    // The export always scales its anchors by MAP_SCALE in the match, so compare in world units.
    const world = (entry, factor) => asVec(entry).map((value) => value * factor);

    meter.vec(`${key}.size`, runtime.size, preset.size);

    const plain = (preset.obstacles || []).filter((entry) => !entry.shape);
    const expectedObstacles = [
        ...plain.filter((entry) => entry.kind !== 'foam'),
        ...plain.filter((entry) => entry.kind === 'foam'),
        ...(preset.obstacles || []).filter((entry) => entry.shape === 'tube'),
    ];
    assert.equal(runtime.obstacles.length, expectedObstacles.length, `${key}: obstacle count`);
    expectedObstacles.forEach((expected, index) => {
        const actual = runtime.obstacles[index];
        const label = `${key}.obstacles[${index}]`;
        if (expected.shape === 'tube') {
            assert.equal(actual.shape, 'tube', `${label}.shape`);
            meter.vec(`${label}.start`, actual.start, expected.start);
            meter.vec(`${label}.end`, actual.end, expected.end);
            meter.num(`${label}.radius`, actual.radius, expected.radius);
            return;
        }
        assert.equal(actual.kind, expected.kind === 'foam' ? 'foam' : 'hard', `${label}.kind`);
        meter.vec(`${label}.pos`, actual.pos, expected.pos);
        meter.vec(`${label}.size`, actual.size, expected.size);
        meter.num(`${label}.rotateY`, actual.rotateY, Number(expected.rotateY) || 0);
        assert.equal(Boolean(actual.tunnel), Boolean(expected.tunnel), `${label}.tunnel`);
        if (expected.tunnel) {
            meter.num(`${label}.tunnel.radius`, actual.tunnel.radius, expected.tunnel.radius);
            assert.equal(actual.tunnel.axis, expected.tunnel.axis || 'z');
        }
    });

    const pairs = preset.portals || [];
    assert.equal(runtime.portals.length, pairs.length, `${key}: portal pairs`);
    pairs.forEach((pair, index) => {
        meter.vec(`${key}.portals[${index}].a`, runtime.portals[index].a, pair.a);
        meter.vec(`${key}.portals[${index}].b`, runtime.portals[index].b, pair.b);
    });

    assert.equal(runtime.items.length, (preset.items || []).length, `${key}: item count`);
    (preset.items || []).forEach((item, index) => {
        const actual = runtime.items[index];
        meter.vec(`${key}.items[${index}]`, [actual.x, actual.y, actual.z].map((value) => value * MAP_SCALE), world(item, anchorScale));
        assert.equal(actual.pickupType, item.pickupType, `${key}.items[${index}].pickupType`);
        assert.equal(actual.id, item.id, `${key}.items[${index}].id`);
        assert.equal(actual.type, item.type || 'item_crystal', `${key}.items[${index}].type`);
        meter.num(`${key}.items[${index}].weight`, actual.weight, item.weight || 1);
    });

    if (preset.playerSpawn) {
        meter.vec(`${key}.playerSpawn`, [runtime.playerSpawn.x, runtime.playerSpawn.y, runtime.playerSpawn.z].map((value) => value * MAP_SCALE), world(preset.playerSpawn, anchorScale));
    }
    assert.equal(runtime.botSpawns.length, (preset.botSpawns || []).length, `${key}: bot spawn count`);
    (preset.botSpawns || []).forEach((spawn, index) => {
        const actual = runtime.botSpawns[index];
        meter.vec(`${key}.botSpawns[${index}]`, [actual.x, actual.y, actual.z].map((value) => value * MAP_SCALE), world(spawn, anchorScale));
    });

    assert.equal(runtime.gates.length, (preset.gates || []).length, `${key}: gate count`);
    (preset.gates || []).forEach((gate, index) => {
        const actual = runtime.gates[index];
        const label = `${key}.gates[${index}]`;
        assert.equal(actual.type, gate.type, `${label}.type`);
        meter.vec(`${label}.pos`, actual.pos, gate.pos);
        meter.num(`${label}.radius`, actual.radius, gate.radius ?? (gate.type === 'boost' ? 3.25 : 2.9));
        assert.deepEqual(actual.forward, gate.forward, `${label}.forward`);
        assert.deepEqual(actual.up, gate.up, `${label}.up`);
        assert.deepEqual(actual.params, gate.params, `${label}.params`);
    });

    assert.deepEqual(
        runtime.portalLevels.map((level) => Math.round(level * 1e6) / 1e6),
        [...(preset.portalLevels || [])].sort((a, b) => a - b),
        `${key}: portal levels`,
    );
    return meter;
}

for (const key of BOX_MAPS) {
    test(`${key} survives the round trip through the editor document`, (t) => {
        const preset = deepFreeze(structuredClone(MAP_PRESET_CATALOG[key]));
        const { document, skipped } = fromArenaMapDefinition(preset, { mapScale: MAP_SCALE });

        assert.equal(getCustomMapConversionScale(document).scale, 35, 'editor export must divide by 35 again');
        const reparsed = parseMapJSON(JSON.stringify(document));
        assert.ok(!reparsed.warnings.some((warning) => /legacy|migrat/i.test(warning)), reparsed.warnings.join(' | '));

        const meter = compareRoundTrip(key, preset, backThroughExport(document));
        assert.ok(meter.count > 10, `${key}: only ${meter.count} values compared`);
        t.diagnostic(`${key}: ${meter.count} values, max deviation ${meter.max.toExponential(2)} at ${meter.worst || '-'}`);

        const hasWorldModel = Array.isArray(preset.glbModels) && preset.glbModels.length > 0;
        const skippedGlb = skipped.find((entry) => entry.key === 'glbModels');
        assert.equal(skippedGlb?.count, hasWorldModel ? preset.glbModels.length : undefined, `${key}: glb models reported`);
    });
}

test('a map that scales its anchors keeps spawns and items in map units, one without converts them', () => {
    const scaled = fromArenaMapDefinition({
        size: [100, 40, 100],
        scaleAuthoredAnchors: true,
        playerSpawn: { x: 1.5, y: 2, z: -3 },
        botSpawns: [{ x: 10, y: 4, z: 5 }],
        items: [{ pos: [2, 3, 4], pickupType: 'SPEED_UP' }],
        obstacles: [{ pos: [1, 2, 3], size: [4, 5, 6] }],
    }, { mapScale: MAP_SCALE }).document;
    assert.deepEqual([scaled.playerSpawn.x, scaled.playerSpawn.y, scaled.playerSpawn.z], [52.5, 70, -105]);
    assert.deepEqual([scaled.items[0].x, scaled.items[0].y, scaled.items[0].z], [70, 105, 140]);
    assert.deepEqual([scaled.hardBlocks[0].x, scaled.hardBlocks[0].width], [35, 140]);

    const worldUnits = fromArenaMapDefinition({
        size: [100, 40, 100],
        playerSpawn: { x: 3, y: 6, z: -9 },
        items: [{ pos: [6, 9, 12] }],
        obstacles: [{ pos: [1, 2, 3], size: [4, 5, 6] }],
    }, { mapScale: 3 }).document;
    assert.deepEqual([worldUnits.playerSpawn.x, worldUnits.playerSpawn.y, worldUnits.playerSpawn.z], [35, 70, -105]);
    assert.deepEqual([worldUnits.items[0].x, worldUnits.items[0].y, worldUnits.items[0].z], [70, 105, 140]);
    assert.deepEqual([worldUnits.hardBlocks[0].x, worldUnits.hardBlocks[0].width], [35, 140], 'obstacles are map units either way');
});

test('a scaled-anchor catalog map with items round-trips (pyramid)', (t) => {
    const preset = MAP_PRESET_CATALOG.pyramid;
    assert.equal(preset.scaleAuthoredAnchors, true);
    const { document } = fromArenaMapDefinition(preset, { mapScale: MAP_SCALE });
    const meter = compareRoundTrip('pyramid', preset, backThroughExport(document));
    assert.ok(meter.count > 40);
    t.diagnostic(`pyramid: ${meter.count} values, max deviation ${meter.max.toExponential(2)} at ${meter.worst || '-'}`);
});

test('an unscaled catalog map with items and world-unit anchors round-trips (bloom_core)', (t) => {
    const preset = MAP_PRESET_CATALOG.bloom_core;
    assert.notEqual(preset.scaleAuthoredAnchors, true);
    const { document, skipped } = fromArenaMapDefinition(preset, { mapScale: MAP_SCALE });
    const meter = compareRoundTrip('bloom_core', preset, backThroughExport(document));
    assert.ok(meter.count > 60);
    t.diagnostic(`bloom_core: ${meter.count} values, max deviation ${meter.max.toExponential(2)} at ${meter.worst || '-'}`);
    assert.ok(skipped.some((entry) => entry.key === 'expansion'), 'growth stages cannot be carried');
});

test('tubes, tunnelled blocks, foam, gates and portal levels round-trip (showcase_nexus)', (t) => {
    const preset = MAP_PRESET_CATALOG.showcase_nexus;
    const { document, skipped } = fromArenaMapDefinition(preset, { mapScale: MAP_SCALE });
    assert.ok(document.tunnels.length > 0);
    const meter = compareRoundTrip('showcase_nexus', preset, backThroughExport(document));
    t.diagnostic(`showcase_nexus: ${meter.count} values, max deviation ${meter.max.toExponential(2)} at ${meter.worst || '-'}`);
    assert.ok(skipped.some((entry) => entry.key === 'aircraft'), 'aircraft are reported, not dropped silently');
});

test('fog height follows the anchor convention of the map', () => {
    const lighting = { fog: { color: 0x112233, near: 100, far: 300, height: 30, heightFalloff: 0.1 }, key: { intensity: 1 } };
    const base = { size: [100, 40, 100], obstacles: [] };

    const unscaled = fromArenaMapDefinition({ ...base, lighting }, { mapScale: MAP_SCALE }).document.lighting;
    assert.equal(unscaled.fog.height, 30 / MAP_SCALE, 'editor maps scale their anchors, so the height is divided');
    assert.ok(Math.abs(unscaled.fog.heightFalloff - 0.1 * MAP_SCALE) < 1e-12);
    assert.equal(unscaled.fog.near, 100, 'fog distances are world units either way');
    assert.equal(unscaled.fog.far, 300);

    const scaled = fromArenaMapDefinition({ ...base, scaleAuthoredAnchors: true, lighting }, { mapScale: MAP_SCALE }).document.lighting;
    assert.deepEqual(scaled, lighting);
    assert.notEqual(scaled, lighting, 'the preset object is cloned, never shared');

    assert.equal(fromArenaMapDefinition(base, { mapScale: MAP_SCALE }).document.lighting, undefined);
});

test('content the editor format cannot carry is listed with counts, never dropped silently', () => {
    const preset = deepFreeze({
        name: 'Mixed',
        size: [60, 30, 60],
        glbModels: [{ id: 'a', url: 'assets/a.glb' }, { id: 'b', url: 'assets/b.glb' }],
        glbColliderMode: 'mesh',
        obstacles: [
            { pos: [0, 5, 0], size: [2, 10, 2] },
            { shape: 'beam', start: [0, 0, 0], end: [0, 9, 0], radius: 2 },
            { pos: [4, 5, 0], size: [2, 10, 2], renderWithGlb: true },
            { pos: [1, 2] },
        ],
        portals: [{ a: [0, 1, 2], b: [3, 4, 5], color: 0x123456 }],
        mapUnits: [{ id: 'worm' }],
        parcours: { checkpoints: [{ pos: [0, 0, 0] }] },
        staticTurrets: [{ pos: [0, 0, 0] }],
        secretRooms: [],
    });
    const { document, skipped } = fromArenaMapDefinition(preset, { mapScale: MAP_SCALE });
    const counts = Object.fromEntries(skipped.map((entry) => [entry.key, entry.count]));
    assert.deepEqual(counts, {
        glbModels: 2,
        mapUnits: 1,
        parcours: 1,
        staticTurrets: 1,
        'obstacles.beam': 1,
        'obstacles.invalid': 1,
        'obstacles.glbFlags': 1,
        'portals.color': 1,
    });
    assert.equal(document.glbModels.length, 0);
    assert.equal(document.hardBlocks.length, 2, 'the plain boxes still convert');
    assert.equal(document.portals.length, 2);
    assert.ok(!('mapUnits' in document) && !('parcours' in document));
    assert.ok(DEFAULT_PORTAL_COLORS[0] !== 0x123456);
});

test('a plain map reports nothing skipped', () => {
    const { skipped } = fromArenaMapDefinition({
        name: 'Plain',
        size: [60, 30, 60],
        obstacles: [{ pos: [0, 5, 0], size: [2, 10, 2] }],
        portals: [{ a: [0, 1, 2], b: [3, 4, 5], color: DEFAULT_PORTAL_COLORS[0] }],
    }, { mapScale: MAP_SCALE });
    assert.deepEqual(skipped, []);
});

test('invalid input is rejected instead of producing an empty map', () => {
    assert.throws(() => fromArenaMapDefinition(null), /object/i);
    assert.throws(() => fromArenaMapDefinition({ obstacles: [] }), /size/i);
});
