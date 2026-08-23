import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { createSolidProbe } from './helpers/notre-dame-collision-utils.mjs';

// The running map uses exact GLB triangle collision. These authored definitions are its visible
// supplements and its load-failure fallback, so they still need to stay aligned with the model.

const map = NOTRE_DAME_MAPS.notre_dame;
const isSolid = createSolidProbe(map.obstacles);

// Authored units per metre and the height of the church floor, matching NotreDameModels.
const METRE = 1.4;
const GROUND = 8;

/** A point given in the generator's own coordinates: metres, X west to east, Y across, Z up. */
function at(metresX, metresAcross, metresUp) {
    return [metresX * METRE, GROUND + metresUp * METRE, metresAcross * METRE];
}

// Straight from generate_notre_dame_assets.py. The building is set out on one 6 m bay and the
// piers stand on it, so collision has to use the same rule or a player threads gaps where piers
// stand and hits air where the openings are.
const BAY_LENGTH = 6.0;
const NAVE_START_X = -54.75;
const NAVE_BAYS = 10;
const CHOIR_START_X = 19.25;
const CHOIR_BAYS = 5;
const CHOIR_END_X = 49.25;
const NAVE_HALF_WIDTH = 6.25;   // arcade pier line, between vessel and inner aisle
const AISLE_INNER = 12.0;       // aisle pier line
const ARCADE_TOP_Z = 15.0;      // arcade piers run the floor to here
const AISLE_VAULT_Z = 10.0;     // aisle piers run the floor to here

/** Centre of every arcade pier the generator draws, nave then choir. */
function arcadePiers() {
    const piers = [];
    for (const [startX, bays] of [[NAVE_START_X, NAVE_BAYS], [CHOIR_START_X, CHOIR_BAYS]]) {
        for (let bay = 0; bay < bays; bay += 1) {
            const x = startX + BAY_LENGTH * (bay + 0.5);
            for (const side of [-1, 1]) {
                piers.push({
                    id: `${startX < 0 ? 'nave' : 'choir'} bay ${bay} ${side > 0 ? 'north' : 'south'}`,
                    arcade: at(x, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z / 2),
                    aisle: at(x, side * AISLE_INNER, AISLE_VAULT_Z / 2),
                    opening: at(x + BAY_LENGTH / 2, side * NAVE_HALF_WIDTH, ARCADE_TOP_Z / 2),
                });
            }
        }
    }
    return piers;
}

/** The nine hemicycle piers around the apse, on the generator's own -80..+80 degree fan. */
function apsePiers() {
    const piers = [];
    for (let index = 0; index < 9; index += 1) {
        const angle = (-80 + index * 20) * (Math.PI / 180);
        piers.push({
            id: `apse pier ${index}`,
            pos: at(
                CHOIR_END_X + NAVE_HALF_WIDTH * 1.1 * Math.cos(angle),
                NAVE_HALF_WIDTH * 1.15 * Math.sin(angle) * 1.6,
                ARCADE_TOP_Z / 2,
            ),
        });
    }
    return piers;
}

test('the arcade piers a player flies between are solid', () => {
    // The vessel and the aisles are deliberately open to each other below the arcade -- at head
    // height a gothic church is one hall. What is not deliberate is that the piers holding that
    // arcade up were open too: forty of them in the nave and choir, drawn in stone, flown
    // straight through. The interior is the reason this map has an inside at all.
    for (const pier of arcadePiers()) {
        assert.ok(isSolid(pier.arcade), `the arcade pier on ${pier.id} is solid`);
        assert.ok(isSolid(pier.aisle), `the aisle pier on ${pier.id} is solid`);
    }
});

test('the bay between two arcade piers stays flyable', () => {
    // The counterweight to the test above. Piers that block are only right if the openings
    // between them do not: a solid arcade would turn the nave from a hall into a corridor.
    for (const pier of arcadePiers()) {
        assert.ok(!isSolid(pier.opening), `the opening after ${pier.id} is flyable`);
    }
});

test('the apse hemicycle piers are solid', () => {
    for (const pier of apsePiers()) {
        assert.ok(isSolid(pier.pos), `${pier.id} is solid`);
    }
});

// What stands still on the reconstruction site. Measured off the GLB files as placed by
// NotreDameModels, in authored units, so these are the coordinates the runtime uses. They are
// the parts 'dynamic' skips: the loader only collides what an animation moves, which leaves the
// machine that does the moving as scenery -- a 54 m crane mast a player passes through while
// the jib above it blocks normally.
const SITE_FRAMES = [
    { id: 'tower crane mast leg', pos: [14.9, 45.8, -92.1] },
    { id: 'stone hoist west-tower leg', pos: [-30.06, 23.0, -56.26] },
    { id: 'stone hoist east-tower leg', pos: [7.54, 23.0, -53.74] },
    { id: 'stone hoist beam', pos: [-10.0, 38.8, -55.0] },
    { id: 'scaffold lift mast leg', pos: [-41.68, 31.8, 46.12] },
    { id: 'scaffold deck', pos: [-40.0, 28.7, 41.6] },
    { id: 'hoarding south post', pos: [-149.9, 20.6, -21.84] },
    { id: 'hoarding north post', pos: [-149.9, 20.6, 21.84] },
    { id: 'hoarding head rail', pos: [-149.9, 33.76, 0.0] },
    { id: 'fleche hoist cradle', pos: [130.0, 9.68, 0.0] },
    { id: 'fleche hoist head', pos: [130.0, 50.56, 0.0] },
];

test('the standing frames of the reconstruction site are solid', () => {
    for (const frame of SITE_FRAMES) {
        assert.ok(isSolid(frame.pos), `${frame.id} is solid`);
    }
});

test('open lattice centres and stale moving-frame positions stay flyable', () => {
    const openings = [
        ['tower crane centre', [17.0, 45.8, -90.0]],
        ['stone hoist west centre', [-28.8, 23.0, -55.0]],
        ['stone hoist east centre', [8.8, 23.0, -55.0]],
        ['scaffold mast centre', [-40.0, 31.8, 47.8]],
        ['old hoarding west post', [-171.8, 20.6, 0.0]],
        ['old hoarding east post', [-128.2, 20.6, 0.0]],
        ['vault gantry start leg', [-68.6, 16.7, 6.4]],
        ['fleche north-west cell', [120.9, 29.0, 9.1]],
        ['fleche south-east cell', [139.1, 29.0, -9.1]],
    ];
    for (const [id, pos] of openings) {
        assert.ok(!isSolid(pos), `${id} is flyable`);
    }
});

test('all three west portal openings stay flyable', () => {
    for (const z of [-18.9, 0, 18.9]) {
        assert.ok(!isSolid([-83, GROUND + 9, z]), `portal opening at z=${z} is flyable`);
    }
});

test('both Notre-Dame maps carry the same collision', () => {
    // The arena variant reuses the fabric, the site and the collision unchanged. Anything added
    // for one map has to reach the other, or the same building blocks differently per mode.
    assert.equal(NOTRE_DAME_MAPS.notre_dame_arena.obstacles, map.obstacles);
});
