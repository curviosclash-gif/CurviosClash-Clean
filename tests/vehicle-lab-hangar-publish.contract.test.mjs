import assert from 'node:assert/strict';
import test from 'node:test';

import {
    VEHICLE_LAB_HANGAR_MAX_PARTS,
    VEHICLE_LAB_HANGAR_MAX_PART_SIZE,
    VEHICLE_LAB_HANGAR_MIN_PART_SIZE,
    createVehicleLabHangarPublication,
    describeVehicleLabHangarPublicationLimits,
    findVehicleLabHangarPublication,
    upsertVehicleLabHangarPublication,
} from '../src/shared/contracts/VehicleLabHangarPublishContract.js';

function buildConfig(label, parts) {
    return { label, primaryColor: 0x60a5fa, parts };
}

test('publishing keeps umlauts readable instead of dropping them', () => {
    const publication = createVehicleLabHangarPublication(
        buildConfig('Prüfschiff Ümläut', [{ name: 'Flügel links', geo: 'box' }]),
        { publishedAtMs: 1 },
    );

    assert.equal(publication.vehicleId, 'prufschiff-umlaut');
    assert.equal(publication.parts[0].id, 'lab-prufschiff-umlaut-flugel-links-1');
});

test('publishing keeps already assigned vehicle ids untouched', () => {
    const publication = createVehicleLabHangarPublication(
        buildConfig('Prüfschiff Ümläut', [{ name: 'Core', geo: 'box' }]),
        { publishedAtMs: 1, vehicleId: 'editor_vehicle_prufschiff-umlaut' },
    );

    assert.equal(publication.vehicleId, 'editor_vehicle_prufschiff-umlaut');
});

test('publication limits are reported before parts are silently dropped', () => {
    const tooMany = Array.from(
        { length: VEHICLE_LAB_HANGAR_MAX_PARTS + 12 },
        (unused, index) => ({ name: `Teil ${index}`, geo: 'box', size: [1, 1, 1] }),
    );

    const limits = describeVehicleLabHangarPublicationLimits(buildConfig('Viele', tooMany));

    assert.equal(limits.totalParts, VEHICLE_LAB_HANGAR_MAX_PARTS + 12);
    assert.equal(limits.droppedParts, 12);
    assert.equal(limits.clampedSizes, 0);
    assert.equal(
        createVehicleLabHangarPublication(buildConfig('Viele', tooMany), { publishedAtMs: 1 }).parts.length,
        VEHICLE_LAB_HANGAR_MAX_PARTS,
    );
});

test('publication limits report sizes the hangar will clamp', () => {
    const config = buildConfig('Gross', [
        { name: 'Core', geo: 'box', size: [10, 0.05, 1] },
        { name: 'Nose', geo: 'cone', size: [1, 1, 1] },
    ]);

    const limits = describeVehicleLabHangarPublicationLimits(config);
    assert.equal(limits.clampedSizes, 1);
    assert.equal(limits.droppedParts, 0);

    const published = createVehicleLabHangarPublication(config, { publishedAtMs: 1 });
    assert.deepEqual(published.parts[0].appearance.size, [
        VEHICLE_LAB_HANGAR_MAX_PART_SIZE,
        VEHICLE_LAB_HANGAR_MIN_PART_SIZE,
        1,
    ]);
});

test('a clean vehicle reports nothing to warn about', () => {
    const limits = describeVehicleLabHangarPublicationLimits(
        buildConfig('Klein', [{ name: 'Core', geo: 'box', size: [1, 1, 1] }]),
    );

    assert.deepEqual(limits, { droppedParts: 0, clampedSizes: 0, totalParts: 1 });
});

test('an existing publication can be found before it is replaced', () => {
    const first = createVehicleLabHangarPublication(
        buildConfig('Mein Schiff!', [{ name: 'Core', geo: 'box' }]),
        { publishedAtMs: 1 },
    );
    const second = createVehicleLabHangarPublication(
        buildConfig('Mein   Schiff?', [{ name: 'Core', geo: 'box' }]),
        { publishedAtMs: 2 },
    );

    // Beide Namen ergeben denselben Schluessel - genau der Fall, in dem die
    // Werkstatt nachfragen muss, statt den ersten Eintrag zu ueberschreiben.
    assert.equal(first.vehicleId, second.vehicleId);

    const record = upsertVehicleLabHangarPublication(null, first);
    const clash = findVehicleLabHangarPublication(record, second.vehicleId);

    assert.ok(clash);
    assert.equal(clash.label, 'Mein Schiff!');
    assert.equal(findVehicleLabHangarPublication(record, 'anderes-schiff'), null);
    assert.equal(findVehicleLabHangarPublication(null, second.vehicleId), null);
});

test('replacing a publication keeps exactly one entry per vehicle', () => {
    const first = createVehicleLabHangarPublication(
        buildConfig('Schiff', [{ name: 'Core', geo: 'box' }]),
        { publishedAtMs: 1 },
    );
    const second = createVehicleLabHangarPublication(
        buildConfig('Schiff', [{ name: 'Core', geo: 'box' }, { name: 'Nose', geo: 'cone' }]),
        { publishedAtMs: 2 },
    );

    const record = upsertVehicleLabHangarPublication(
        upsertVehicleLabHangarPublication(null, first),
        second,
    );

    assert.equal(record.publications.length, 1);
    assert.equal(record.publications[0].parts.length, 2);
});
