import assert from 'node:assert/strict';
import test from 'node:test';

import { applyVehiclePartStyle, measureVehiclePartBounds } from '../src/shared/contracts/VehiclePartStyleContract.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { resolveArcadeSizedPartStyle } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';

const EPS = 1e-9;
const MEASURE = Object.freeze({ includeMirrors: true, ignoreGeos: ['flame', 'forcefield'] });

/**
 * A small ship with explicit mounts. The hull box around its pivot (0, 0, 0.5) reaches
 * x -0.5..0.5, y -0.25..0.25 and z -0.5..1.5. The nose sits in front of it and is mounted on the hull's front
 * face; a sensor tip is mounted on the nose's front end; the right wing's root rests on the hull
 * side; a mirrored wing root stands on the hull, and the left fin hangs on that root's mirrored
 * (left) half. The deco part has no mount and keeps the old behaviour.
 */
const SHIP = Object.freeze({
    id: 'mount_test',
    parts: [
        { name: 'Rumpf', geo: 'box', size: [1, 0.5, 2], pos: [0, 0, 0.5], role: 'core' },
        { name: 'Nase', geo: 'box', size: [0.4, 0.4, 1], pos: [0, 0, -1], role: 'nose', mount: { anchor: [0, 0, -0.5], carrier: 'hull' } },
        { name: 'Sensor', geo: 'box', size: [0.1, 0.1, 0.2], pos: [0, 0, -1.6], mount: { anchor: [0, 0, -1.5], carrier: 'Nase' } },
        { name: 'Rechter Flügel', geo: 'box', size: [2, 0.1, 1], pos: [1.5, 0, 0.5], role: 'wing_right', mount: { anchor: [0.5, 0, 0.5], carrier: 'hull' } },
        { name: 'Flügelwurzel', geo: 'box', size: [0.6, 0.1, 0.6], pos: [0.8, 0.3, 1], mirror: true, mount: { anchor: [0.5, 0.25, 1] } },
        { name: 'Linke Finne', geo: 'box', size: [0.2, 0.6, 0.4], pos: [-1, 0.6, 1], role: 'wing_left', mount: { anchor: [-1, 0.35, 1], carrier: 'Flügelwurzel' } },
        { name: 'Deko', geo: 'box', size: [0.2, 0.2, 0.2], pos: [0, 0.4, 1.4], role: 'engine_left' },
    ],
});

const byName = (parts, name) => parts.find((part) => part.name === name);
const drawn = (sizes) => applyVehiclePartStyle(SHIP, resolveArcadeSizedPartStyle(SHIP.parts, null, sizes)).parts;

function assertClose(actual, expected, message) {
    actual.forEach((value, axis) => {
        assert.ok(Math.abs(value - expected[axis]) < EPS, `${message}: axis ${axis} at ${value}, expected ${expected[axis]}`);
    });
}

test('a mounted part grows away from its anchor instead of around its own middle', () => {
    for (const pct of [80, 125]) {
        const f = pct / 100;
        const parts = drawn({ nose: pct, wings: pct });
        // Nose: anchor (0, 0, -0.5) on the hull front stays; the far end moves to -0.5 - f.
        const nose = measureVehiclePartBounds(byName(parts, 'Nase'));
        assert.ok(Math.abs(nose.max[2] + 0.5) < EPS, `nose ${pct} %: base stays on the hull front (${nose.max[2]})`);
        assert.ok(Math.abs(nose.min[2] - (-0.5 - f)) < EPS, `nose ${pct} %: tip at ${nose.min[2]}`);
        // Wing: root on the hull side stays at x 0.5, the tip reaches 0.5 + 2 f.
        const wing = measureVehiclePartBounds(byName(parts, 'Rechter Flügel'));
        assert.ok(Math.abs(wing.min[0] - 0.5) < EPS && Math.abs(wing.max[0] - (0.5 + 2 * f)) < EPS, `wing ${pct} %: root stays on the hull`);
        // The sensor rides on the nose tip: it keeps its size and moves with that tip.
        const sensor = byName(parts, 'Sensor');
        assertClose(sensor.pos, [0, 0, -0.5 - f - 0.1], `sensor ${pct} %`);
        assert.deepEqual(sensor.scale ?? [1, 1, 1], [1, 1, 1], 'the sensor has no size group and keeps its size');
    }
});

test('a resized carrier takes its mounted parts along, also through a mirrored carrier', () => {
    for (const pct of [80, 125]) {
        const f = pct / 100;
        const parts = drawn({ hull: pct });
        const hull = measureVehiclePartBounds(byName(parts, 'Rumpf'));
        const nose = measureVehiclePartBounds(byName(parts, 'Nase'));
        assert.ok(Math.abs(nose.max[2] - hull.min[2]) < EPS, `hull ${pct} %: nose base ${nose.max[2]} on hull front ${hull.min[2]}`);
        const wing = measureVehiclePartBounds(byName(parts, 'Rechter Flügel'));
        assert.ok(Math.abs(wing.min[0] - hull.max[0]) < EPS, `hull ${pct} %: wing root ${wing.min[0]} on hull side ${hull.max[0]}`);
        // Hull point (0.5, 0.25, 1) moves to (0.5 f, 0.25 f, 0.5 + 0.5 f); the root keeps its size.
        const root = byName(parts, 'Flügelwurzel');
        assertClose(root.pos, [0.5 * f + 0.3, 0.25 * f + 0.05, 0.5 + 0.5 * f], `root ${pct} %`);
        // The left fin hangs on the root's mirrored half: its anchor (-1, 0.35, 1) moves like (1, 0.35, 1) mirrored.
        const fin = byName(parts, 'Linke Finne');
        assertClose(fin.pos, [-(0.5 * f + 0.5), 0.25 * f + 0.35, 0.5 + 0.5 * f], `fin ${pct} %`);
    }
});

test('a part without a usable mount keeps growing around its own pivot', () => {
    const broken = {
        ...SHIP,
        parts: SHIP.parts.map((part) => (part.name === 'Nase' ? { ...part, mount: { anchor: [0, 0, -0.5], carrier: 'Fehlt' } }
            : part.name === 'Rechter Flügel' ? { ...part, mount: { anchor: ['x', 0, 0] } } : part)),
    };
    const parts = applyVehiclePartStyle(broken, resolveArcadeSizedPartStyle(broken.parts, null, { hull: 125, nose: 125, wings: 125, engines: 80 })).parts;
    for (const name of ['Nase', 'Rechter Flügel', 'Deko']) {
        const part = byName(parts, name);
        assert.deepEqual(part.pos, byName(SHIP.parts, name).pos, `${name} keeps its pivot`);
    }
    // Mounts that point at each other carry nothing either.
    const loop = {
        ...SHIP,
        parts: SHIP.parts.map((part) => (part.name === 'Nase' ? { ...part, mount: { anchor: [0, 0, -0.5], carrier: 'Sensor' } } : part)),
    };
    const looped = applyVehiclePartStyle(loop, resolveArcadeSizedPartStyle(loop.parts, null, { hull: 125, nose: 125 })).parts;
    assert.deepEqual(byName(looped, 'Nase').pos, [0, 0, -1], 'a mount loop falls back to the pivot');
    assert.ok(Number.isFinite(byName(looped, 'Sensor').pos[2]), 'the loop still resolves');
});

test('the hit zone places each part box exactly where the part is drawn', () => {
    for (const sizes of [{ hull: 80 }, { hull: 125 }, { nose: 80, wings: 125 }, { hull: 80, nose: 125, wings: 125, engines: 80 }]) {
        const parts = drawn(sizes);
        const shape = buildArcadeHitboxShape(SHIP.parts, sizes);
        shape.names.forEach((name, box) => {
            const part = byName(parts, name);
            if (!part || part.role === 'core') return;
            const halves = part.mirror ? ['own', 'copy'] : [undefined];
            const index = shape.names.indexOf(name);
            const half = halves.length > 1 ? halves[box - index] : undefined;
            const bounds = measureVehiclePartBounds(part, { ...MEASURE, ...(half ? { mirrorHalf: half } : {}) });
            assertClose([0, 1, 2].map((axis) => shape.boxes[box * 6 + axis]), bounds.center, `${JSON.stringify(sizes)} ${name} ${half || ''}`);
        });
    }
});

test('the mount data form is normalized the same way for the lab and the drawn ship', async () => {
    const { normalizeVehiclePartMount, VEHICLE_PART_MOUNT_HULL } = await import('../src/shared/contracts/VehiclePartMountContract.js');
    const { normalizeVehicleLabConfig } = await import('../src/shared/contracts/VehicleLabConfigContract.js');
    for (const raw of [undefined, null, [], 'abc', 5, {}, { anchor: [0, 0] }, { anchor: [0, 0, '1'] }, { anchor: [0, Number.NaN, 0] }, { anchor: [0, 0, 5000] }]) {
        assert.equal(normalizeVehiclePartMount(raw), null, `${JSON.stringify(raw)} is no mount`);
    }
    assert.deepEqual(normalizeVehiclePartMount({ anchor: [1, -2, 0.5] }), { anchor: [1, -2, 0.5], carrier: VEHICLE_PART_MOUNT_HULL }, 'no carrier means the hull');
    assert.deepEqual(normalizeVehiclePartMount({ anchor: [0, 0, 0], carrier: '  Nase  ', extra: true }), { anchor: [0, 0, 0], carrier: 'Nase' });
    assert.deepEqual(normalizeVehiclePartMount({ anchor: [0, 0, 0], carrier: '   ' }), { anchor: [0, 0, 0], carrier: VEHICLE_PART_MOUNT_HULL });
    const lab = normalizeVehicleLabConfig({ parts: [
        { name: 'Rumpf', role: 'core' },
        { name: 'Nase', role: 'nose', mount: { anchor: [0, 0, -1], carrier: 'hull' } },
        { name: 'Deko', mount: { anchor: 'kaputt' } },
    ] }).config;
    assert.deepEqual(lab.parts[1].mount, { anchor: [0, 0, -1], carrier: 'hull' }, 'a valid mount survives the lab round trip');
    assert.equal('mount' in lab.parts[2], false, 'an unusable mount is dropped');
});
