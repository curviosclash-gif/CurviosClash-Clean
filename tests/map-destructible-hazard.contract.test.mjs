import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAP_DESTRUCTIBLE_BLAST_LIMITS,
    MAP_DESTRUCTIBLE_FIREBALL_LIMITS,
    normalizeMapDestructibleBlast,
    normalizeMapDestructibleFireball,
    resolveMapDestructibleFireballSphere,
    sampleMapDestructibleFireball,
} from '../src/shared/contracts/MapDestructibleHazardContract.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';

// The two dangers a break scene may carry. The blast half is the older one and is only re-checked
// here because it moved house; the fireball half is new, and what it has to get right is that the
// damage volume is a curve with an end rather than a sphere that is simply always there.

/** A short stand-in for the reactor's own table: up, over, gone. */
const CURVE = Object.freeze([
    [0.0, 10, 0],
    [1.0, 20, 40],
    [2.0, 30, 20],
    [3.0, 40, 0],
]);

function fireball(overrides = {}) {
    return normalizeMapDestructibleFireball({
        damage: 50, origin: [0, 8, 0], unitScale: 0.6, samples: CURVE, ...overrides,
    });
}

test('a fireball needs at least two rows and at least one that has a radius', () => {
    assert.equal(normalizeMapDestructibleFireball(null), null);
    assert.equal(normalizeMapDestructibleFireball('fireball'), null);
    assert.equal(normalizeMapDestructibleFireball({}), null);
    assert.equal(fireball({ samples: [[0, 10, 0]] }), null, 'one row cannot be interpolated');
    assert.equal(fireball({ samples: [[0, 10, 0], [3, 40, 0]] }), null,
        'a table that never has a radius describes smoke, not a fireball');
    assert.ok(fireball(), 'the reactor-shaped table is accepted');
});

test('rows read either as triples or as records, and the table has to run forwards', () => {
    const triples = fireball();
    const records = fireball({
        samples: CURVE.map(([atSeconds, heightMetres, radiusMetres]) => ({
            atSeconds, heightMetres, radiusMetres,
        })),
    });
    assert.deepEqual(records?.samples, triples?.samples);

    // A row that does not move the clock forward is dropped rather than sorted into place: a table
    // that does not read forwards is an authoring mistake, and reordering it would hide which row.
    const jumbled = fireball({ samples: [[0, 10, 0], [2, 30, 20], [1, 20, 40], [3, 40, 0]] });
    assert.deepEqual(jumbled?.samples.map((sample) => sample.atSeconds), [0, 2, 3]);
    const repeated = fireball({ samples: [[0, 10, 0], [1, 20, 40], [1, 25, 99], [3, 40, 0]] });
    assert.deepEqual(repeated?.samples.map((sample) => sample.radiusMetres), [0, 40, 0]);
});

test('every authored number is clamped, and the table is capped in length', () => {
    const limits = MAP_DESTRUCTIBLE_FIREBALL_LIMITS;
    const extreme = fireball({
        damage: 1e9,
        origin: [-99999, 'nonsense', 99999],
        unitScale: -4,
        samples: [[-5, -9999, -12], [1e9, 1e9, 1e9]],
    });
    assert.equal(extreme?.damage, limits.damage.max);
    assert.deepEqual([...(extreme?.origin || [])], [limits.origin.min, 0, limits.origin.max]);
    assert.equal(extreme?.unitScale, limits.unitScale.min);
    assert.deepEqual(extreme?.samples[0], {
        atSeconds: limits.atSeconds.min,
        heightMetres: limits.heightMetres.min,
        radiusMetres: limits.radiusMetres.min,
    });
    assert.deepEqual(extreme?.samples[1], {
        atSeconds: limits.atSeconds.max,
        heightMetres: limits.heightMetres.max,
        radiusMetres: limits.radiusMetres.max,
    });
    assert.equal(extreme?.durationSeconds, limits.atSeconds.max);

    const long = fireball({
        samples: Array.from({ length: limits.maxSamples + 20 }, (_, index) => [index * 0.1, index, 5]),
    });
    assert.equal(long?.samples.length, limits.maxSamples);

    // A missing damage falls to the smallest the game allows rather than to zero: an authored
    // fireball that hurts nobody would look like the feature silently failing.
    assert.equal(fireball({ damage: undefined })?.damage, limits.damage.min);
    assert.equal(fireball({ unitScale: undefined })?.unitScale, limits.unitScale.fallback);
    assert.deepEqual([...(fireball({ origin: undefined })?.origin || [])], [0, 0, 0]);
});

test('sampling reads exactly on the rows and linearly between them', () => {
    const curve = fireball();
    for (const [atSeconds, heightMetres, radiusMetres] of CURVE.slice(0, -1)) {
        assert.deepEqual(sampleMapDestructibleFireball(curve, atSeconds), { heightMetres, radiusMetres });
    }
    assert.deepEqual(sampleMapDestructibleFireball(curve, 0.5), { heightMetres: 15, radiusMetres: 20 });
    assert.deepEqual(sampleMapDestructibleFireball(curve, 1.25), { heightMetres: 22.5, radiusMetres: 35 });
    assert.deepEqual(sampleMapDestructibleFireball(curve, 2.5), { heightMetres: 35, radiusMetres: 10 });
});

test('outside its own table a fireball has no radius at all', () => {
    const curve = fireball();
    assert.equal(sampleMapDestructibleFireball(curve, -1).radiusMetres, 0);
    assert.equal(sampleMapDestructibleFireball(curve, 0).radiusMetres, 0, 'the first row is authored at nothing');
    // The last row ends it, and every second after it: the clip draws smoke for another minute.
    assert.equal(sampleMapDestructibleFireball(curve, 3).radiusMetres, 0);
    assert.equal(sampleMapDestructibleFireball(curve, 3.001).radiusMetres, 0);
    assert.equal(sampleMapDestructibleFireball(curve, 4000).radiusMetres, 0);
    assert.equal(sampleMapDestructibleFireball(curve, Number.NaN).radiusMetres, 0);
    assert.deepEqual(sampleMapDestructibleFireball(null, 1), { heightMetres: 0, radiusMetres: 0 });
});

test('the world sphere applies the two scales a map has, and only once each', () => {
    const curve = fireball({ origin: [5, 8, -3] });
    // The axis is an authored position and is scaled by the map alone; the curve is in metres and
    // goes through `unitScale` into authored units first.
    const sphere = resolveMapDestructibleFireballSphere(curve, 1.0, 3);
    assert.deepEqual(sphere, {
        x: 15,
        y: 8 * 3 + 20 * 0.6 * 3,
        z: -9,
        radius: 40 * 0.6 * 3,
    });
    // An unscaled map leaves the authored numbers where they are.
    assert.equal(resolveMapDestructibleFireballSphere(curve, 1.0, 1).radius, 40 * 0.6);
    assert.equal(resolveMapDestructibleFireballSphere(curve, 1.0).radius, 40 * 0.6);
    // A nonsense scale is read as "not scaled" rather than as zero, which would delete the hazard.
    assert.equal(resolveMapDestructibleFireballSphere(curve, 1.0, 0).radius, 40 * 0.6);
    assert.equal(resolveMapDestructibleFireballSphere(curve, 1.0, Number.NaN).radius, 40 * 0.6);
    assert.equal(resolveMapDestructibleFireballSphere(null, 1, 3).radius, 0);
});

test('a break scene carries the fireball through normalization, and a scene without one gets null', () => {
    const definition = normalizeMapDestructibles({
        segments: [{ id: 'dome', kind: 'leg_lower', hp: 500, meshPrefixes: ['dome'], anchor: [0, 0, 0] }],
        pieces: ['reactor'],
        breakScenes: [
            {
                id: 'cloud',
                trigger: { segmentId: 'dome' },
                modelId: 'cloud',
                fireball: { damage: 50, origin: [0, 8, 0], unitScale: 0.6, samples: CURVE },
            },
            { id: 'plain', trigger: { kind: 'leg_mid' }, modelId: 'plain' },
        ],
    });
    const [cloud, plain] = definition?.breakScenes || [];
    assert.equal(cloud?.fireball?.durationSeconds, 3);
    assert.equal(cloud?.blast, null, 'a fireball is not a blast and does not invent one');
    assert.equal(plain?.fireball, null, 'every scene authored before this existed reads as null');
    assert.equal(plain?.blast, null);
});

test('a blast still clamps exactly as it did before it moved into the hazard contract', () => {
    const limits = MAP_DESTRUCTIBLE_BLAST_LIMITS;
    assert.equal(normalizeMapDestructibleBlast(null), null);
    assert.equal(normalizeMapDestructibleBlast([1, 2, 3]), null);
    assert.deepEqual(normalizeMapDestructibleBlast({ radius: 48, damage: 50, delaySeconds: 1.4 }), {
        radius: 48, damage: 50, delaySeconds: 1.4,
    });
    assert.deepEqual(normalizeMapDestructibleBlast({}), {
        radius: limits.radius.min, damage: limits.damage.min, delaySeconds: 0,
    });
    assert.deepEqual(
        normalizeMapDestructibleBlast({ radius: 1e9, damage: -5, delaySeconds: 1e9 }),
        { radius: limits.radius.max, damage: limits.damage.min, delaySeconds: limits.delaySeconds.max },
    );
    assert.deepEqual(normalizeMapDestructibleBlast({ radius: null, damage: '', delaySeconds: 'x' }), {
        radius: limits.radius.min, damage: limits.damage.min, delaySeconds: 0,
    });
});
