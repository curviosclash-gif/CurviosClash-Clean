import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { SKY_LADDER_MAP_KEYS } from '../src/core/config/maps/presets/sky_ladder/index.js';
import { collectLegs, findBlockedLegs } from './helpers/parcours-race-line.mjs';

// Racing-line probe (the ideal straight line ring to ring, ship-sized) for the parcours maps whose
// collision is their authored obstacles. The sky ladder stages have their own strict test
// (sky-ladder-maps.contract.test.mjs: no blocked leg at all). These older maps were authored
// around ring clearance only, so the probe finds legs where a straight line hits foam, a wall or a
// tunnel mouth. They are listed in tests/fixtures/parcours-race-line-known.json, a ratchet and
// the work list: a new blocked leg fails, and so does a listed leg that flies free now.
// PARCOURS_RACE_LINES_IGNORE_KNOWN=1 lists every blocked leg (the red proof);
// PARCOURS_RACE_LINES_PRINT=1 prints them as JSON.
//
// Not probed on purpose: maps whose collision is a GLB scene (glbColliderMode 'mesh'/'scene' with
// models: aether_relay, neon_carnival, notre_dame*, eiffel_tower, orbital_shipyard,
// cloud_harbor, skyscraper_site, burg_falkenwacht); the desktop spec parcours-ring-clearance covers those.

const SCALE = CONFIG.ARENA.MAP_SCALE;
const KNOWN_PATH = new URL('./fixtures/parcours-race-line-known.json', import.meta.url);
const PROBED_MAPS = Object.freeze([
    'tutorial_classic', 'parcours_assault', 'parcours_rift', 'parcours_rift_sprint', 'parcours_rift_precision',
    'micro_maw', 'mirror_docks', 'glass_serpent', 'storm_switchyard', 'wind_cathedral', 'chrono_spillway',
]);
const SCENE_COLLIDER_MAPS = Object.freeze([
    'aether_relay', 'neon_carnival', 'notre_dame', 'notre_dame_fire', 'eiffel_tower', 'orbital_shipyard', 'cloud_harbor', 'skyscraper_site', 'burg_falkenwacht',
]);
// Authored-box maps nobody has probed yet: their blocked legs are the next work package.
const UNPROBED_BOX_MAPS = Object.freeze([
    'vulkan_odyssey', 'frozen_helix', 'neon_circuit', 'sky_islands', 'abyssal_descent', 'magma_maze',
    'chrono_forge_nexus', 'eclipse_foundry', 'kinetic_tide', 'aetherion_orrery',
]);

const keyOf = (entry) => `${entry.map} | ${entry.leg}`;

function probeAll() {
    return PROBED_MAPS.flatMap((mapKey) => findBlockedLegs(MAP_PRESET_CATALOG[mapKey], SCALE)
        .map(({ leg, at }) => ({ map: mapKey, leg, at })));
}

test('every parcours map is probed, in the sky ladder test, or named as not probed', () => {
    const covered = new Set([...PROBED_MAPS, ...SKY_LADDER_MAP_KEYS, ...SCENE_COLLIDER_MAPS, ...UNPROBED_BOX_MAPS]);
    const parcoursMaps = Object.entries(MAP_PRESET_CATALOG).filter(([, map]) => map.parcours?.enabled).map(([key]) => key);
    assert.deepEqual(parcoursMaps.filter((key) => !covered.has(key)), [], 'new parcours map: add it to PROBED_MAPS (or justify the exclusion)');
});

test('known list is well formed and its count matches its entries', () => {
    const known = JSON.parse(readFileSync(KNOWN_PATH, 'utf8'));
    assert.equal(known.count, known.entries.length, 'count equals the number of entries');
    const seen = new Set();
    for (const entry of known.entries) {
        assert.ok(PROBED_MAPS.includes(entry.map), `${entry.map} is a probed map`);
        assert.match(entry.leg, /^\w+->\w+$/, `${entry.leg} names a leg`);
        assert.ok(!seen.has(keyOf(entry)), `${keyOf(entry)} is listed once`);
        seen.add(keyOf(entry));
    }
});

test('no probed parcours map gets a new blocked ring-to-ring leg', () => {
    const found = probeAll();
    if (process.env.PARCOURS_RACE_LINES_PRINT === '1') console.log(JSON.stringify(found));
    const known = process.env.PARCOURS_RACE_LINES_IGNORE_KNOWN === '1'
        ? []
        : JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).entries;
    const knownKeys = new Set(known.map(keyOf));
    const foundKeys = new Set(found.map(keyOf));
    assert.deepEqual(
        found.filter((entry) => !knownKeys.has(keyOf(entry))).map((entry) => `${keyOf(entry)} blocked at [${entry.at.join(', ')}]`),
        [],
        'new blocked leg not in tests/fixtures/parcours-race-line-known.json: move the ring or the obstacle instead of listing it',
    );
    assert.deepEqual(
        known.filter((entry) => !foundKeys.has(keyOf(entry))).map((entry) => `${keyOf(entry)}: stale entry - remove (and lower count)`),
        [],
        'listed leg flies free now',
    );
});

test('the probe can fail: a wall dropped on a ring-to-ring line blocks it', () => {
    const base = MAP_PRESET_CATALOG.parcours_assault;
    assert.deepEqual(findBlockedLegs(base, SCALE), [], 'the base map has no blocked leg');
    const [from, to] = base.parcours.checkpoints.slice(0, 2).map((ring) => ring.pos);
    const middle = from.map((value, axis) => (value + to[axis]) / 2);
    const copy = { ...base, obstacles: [...base.obstacles, { pos: middle, size: [6, 30, 30] }] };
    assert.ok(findBlockedLegs(copy, SCALE).length >= 1);
});

test('legs follow nextIds, so branch rings authored out of stage order connect only to their own way', () => {
    const cp = (id, x, z, nextIds) => ({ id, type: 'gate', pos: [x, 10, z], radius: 4, forward: [1, 0, 0], ...(nextIds ? { nextIds } : {}) });
    const parcours = {
        enabled: true,
        routeId: 'probe',
        checkpoints: [
            cp('START', 0, 0, ['A1', 'B1']),
            cp('A1', 10, -10, ['A2']), cp('A2', 20, -10, ['M']),
            cp('B1', 10, 10, ['B2']), cp('B2', 20, 10, ['M']),
            cp('M', 30, 0),
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [40, 10, 0], radius: 5, forward: [1, 0, 0] },
    };
    const legs = collectLegs({ parcours }, 1).map(([from, to]) => `${from.id}->${to.id}`).sort();
    assert.deepEqual(legs, ['A1->A2', 'A2->M', 'B1->B2', 'B2->M', 'M->FINISH', 'START->A1', 'START->B1']);
});
