import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { listCompiledBoxObstacles } from '../scripts/parcours-ring-clearance.mjs';
import { analyzeMapAnchors, CHECKS, violationKey } from './helpers/map-anchor-guard.mjs';

// Every catalog map, every placed point: spawns, items, portals, gates and lights must lie inside
// the arena, outside solid boxes, with room to fly, and make sense (known pickup type, no stacked
// items, lights that reach something). The geometry rules live in helpers/map-anchor-guard.mjs.
//
// The known list is a ratchet and the work list for the map packages: a new violation fails, and so
// does an entry that no longer applies ("stale entry - remove"), so the list can only shrink.
// MAP_ANCHOR_GUARD_IGNORE_KNOWN=1 lists every violation without the list (the red proof);
// MAP_ANCHOR_GUARD_PRINT=1 prints them as JSON.

const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const KNOWN_PATH = new URL('./fixtures/map-anchor-guard-known.json', import.meta.url);

function analyzeCatalog() {
    return Object.entries(MAP_PRESET_CATALOG)
        .flatMap(([mapKey, map]) => analyzeMapAnchors(mapKey, map, MAP_SCALE));
}

test('known list is well formed and its count matches its entries', () => {
    const known = JSON.parse(readFileSync(KNOWN_PATH, 'utf8'));
    assert.ok(Array.isArray(known.entries), 'entries is a list');
    assert.equal(known.count, known.entries.length, 'count equals the number of entries');
    const seen = new Set();
    for (const entry of known.entries) {
        assert.ok(MAP_PRESET_CATALOG[entry.map], `${entry.map} is a catalog map`);
        assert.ok(CHECKS.includes(entry.check), `${entry.check} is a known check`);
        assert.ok(entry.point && entry.reason, `${violationKey(entry)} states a point and a reason`);
        assert.ok(!seen.has(violationKey(entry)), `${violationKey(entry)} is listed once`);
        seen.add(violationKey(entry));
    }
});

test('every catalog map keeps its placed points sane, apart from the known list', () => {
    const found = analyzeCatalog();
    if (process.env.MAP_ANCHOR_GUARD_PRINT === '1') console.log(JSON.stringify(found));
    const known = process.env.MAP_ANCHOR_GUARD_IGNORE_KNOWN === '1'
        ? []
        : JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).entries;
    const knownKeys = new Set(known.map(violationKey));
    const foundKeys = new Set(found.map(violationKey));

    const added = found.filter((violation) => !knownKeys.has(violationKey(violation)));
    const stale = known.filter((entry) => !foundKeys.has(violationKey(entry)));
    assert.deepEqual(
        added.map((violation) => `${violationKey(violation)}: ${violation.reason}`),
        [],
        'new violation not in tests/fixtures/map-anchor-guard-known.json: fix the map instead of listing it',
    );
    assert.deepEqual(
        stale.map((entry) => `${violationKey(entry)}: stale entry - remove (and lower count)`),
        [],
        'known entry is no longer violated',
    );
});

// The guard is new, so its only proof of being able to fail is to make it fail: a catalog preset
// moved into trouble on purpose, plus hand-built maps for the cases the catalog may never hit.
test('a displaced copy of a real preset is caught on every check', () => {
    const base = MAP_PRESET_CATALOG.wind_cathedral;
    const before = new Set(analyzeMapAnchors('wind_cathedral', base, MAP_SCALE).map(violationKey));
    const copy = structuredClone(base);
    const box = listCompiledBoxObstacles(copy)[0];
    assert.ok(box, 'the base preset has a compiled box to push things into');

    // Anchors of this map are authored in scaled units; boxes and portals are authored in map units.
    const inAnchorUnits = (mapUnits) => mapUnits.map((value) => (copy.scaleAuthoredAnchors ? value : value * MAP_SCALE));
    const [x, y, z] = inAnchorUnits(box.pos);
    copy.playerSpawn = { ...copy.playerSpawn, x, y, z };
    const twin = copy.items[0];
    copy.items.push({ ...twin, id: 'moved_twin' });
    copy.items.push({ ...copy.items[1], id: 'moved_out', x: copy.size[0] * 40 });
    copy.items.push({ id: 'moved_badtype', type: 'NOT_A_PICKUP', x: twin.x + 9, y: twin.y, z: twin.z });
    copy.items.push({ id: 'moved_no_coords', pos: [0, 10] });
    copy.portals = [{ a: [...box.pos], b: [0, copy.size[1] * 5, 0] }];
    copy.lights = [{ id: 'moved_light', x: 0, y: copy.size[1] * 20, z: 0, distance: 10 }];

    const added = analyzeMapAnchors('wind_cathedral', copy, MAP_SCALE)
        .filter((violation) => !before.has(violationKey(violation)));
    const byCheck = (check) => added.filter((violation) => violation.check === check).map((violation) => violation.point);
    assert.deepEqual(byCheck('in-solid').sort(), ['playerSpawn', 'portals[0].a'].sort());
    assert.deepEqual(byCheck('bounds').sort(), ['items[moved_out]', 'lights[moved_light]', 'portals[0].b'].sort());
    assert.deepEqual(byCheck('item-duplicate'), ['items[moved_twin]']);
    assert.deepEqual(byCheck('item-type'), ['items[moved_badtype]']);
    assert.deepEqual(byCheck('anchor-format'), ['items[moved_no_coords]']);
    assert.deepEqual(byCheck('light-reach'), ['lights[moved_light]']);
    assert.ok(byCheck('free-directions').length <= 1, 'a spawn inside a box is reported once as in-solid');
});

test('free directions: three closed sides still leave three, four closed sides do not', () => {
    const room = (obstacles) => ({
        size: [60, 40, 60], scaleAuthoredAnchors: true, obstacles, playerSpawn: { x: 0, y: 20, z: 0 },
    });
    // Walls 1.5 map units (4.5 world units) from the spawn, well inside the 8 unit reach.
    const wall = {
        posX: { pos: [1.5, 20, 0], size: [1, 10, 10] },
        negX: { pos: [-1.5, 20, 0], size: [1, 10, 10] },
        posZ: { pos: [0, 20, 1.5], size: [10, 10, 1] },
        negZ: { pos: [0, 20, -1.5], size: [10, 10, 1] },
    };
    const checksOf = (map) => analyzeMapAnchors('probe', map, MAP_SCALE).map((violation) => violation.check);
    assert.deepEqual(checksOf(room([wall.posX, wall.negX, wall.posZ, wall.negZ])), ['free-directions']);
    assert.deepEqual(checksOf(room([wall.posX, wall.negX, wall.posZ])), []);
    assert.deepEqual(checksOf(room([])), []);
});

test('tunnel walls are solid outside their bore and rotated boxes are rotated', () => {
    const wallWithBore = {
        size: [60, 40, 60],
        obstacles: [{ pos: [0, 10, 0], size: [20, 20, 2], tunnel: { radius: 3, axis: 'z' } }],
        portals: [{ a: [0, 10, 0], b: [8, 10, 0] }],
    };
    const keys = analyzeMapAnchors('probe', wallWithBore, MAP_SCALE).map(violationKey);
    assert.deepEqual(keys, ['probe | in-solid | portals[0].b'], 'the bore is open, the wall beside it is not');

    // A 40 x 2 map-unit slab turned a quarter turn covers z, not x.
    const turned = {
        size: [100, 40, 100],
        obstacles: [{ pos: [0, 10, 0], size: [40, 20, 2], rotateY: Math.PI / 2 }],
        portals: [{ a: [0, 10, 10], b: [10, 10, 0] }],
    };
    assert.deepEqual(
        analyzeMapAnchors('probe', turned, MAP_SCALE).map(violationKey),
        ['probe | in-solid | portals[0].a'],
    );
});

test('the map scale applies to anchors only when the map says so', () => {
    const base = { size: [20, 20, 20], obstacles: [], playerSpawn: { x: 12, y: 10, z: 0 } };
    // 12 map units half-width is 10: scaled to 36 world units it is outside a 60-unit arena,
    // unscaled it is still inside.
    assert.deepEqual(analyzeMapAnchors('probe', { ...base, scaleAuthoredAnchors: true }, MAP_SCALE).map((v) => v.check), ['bounds']);
    assert.deepEqual(analyzeMapAnchors('probe', base, MAP_SCALE).map((v) => v.check), []);
});
