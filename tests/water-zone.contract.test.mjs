import assert from 'node:assert/strict';
import test from 'node:test';

import {
    WATER_PHASES,
    WATER_WAVE_ORIGINS,
    applyWaterZoneNetworkState,
    createWaterZoneState,
    isPointUnderwater,
    normalizeWaterZone,
    serializeWaterZoneState,
    stepWaterZoneState,
    triggerWaterZone,
} from '../src/shared/contracts/WaterZoneContract.js';

const zone = normalizeWaterZone({
    id: 'dam_basin',
    bounds: { min: [-90, 0, -90], max: [90, 90, 90] },
    startLevel: 0,
    targetLevel: 45,
    waveSeconds: 2,
    riseSeconds: 20,
});

const reservoirZone = normalizeWaterZone({
    ...zone,
    reservoirBounds: { min: [-90, 0, 90], max: [90, 75, 95] },
});

test('dam water runs through wave and twenty-second rise before persisting', () => {
    let state = createWaterZoneState(zone);
    assert.equal(state.phase, WATER_PHASES.DRY);
    state = triggerWaterZone(state);
    assert.equal(state.phase, WATER_PHASES.WAVE);
    state = stepWaterZoneState(state, zone, 2);
    assert.equal(state.phase, WATER_PHASES.RISING);
    state = stepWaterZoneState(state, zone, 10);
    assert.equal(state.level, 22.5);
    state = stepWaterZoneState(state, zone, 10);
    assert.equal(state.phase, WATER_PHASES.FLOODED);
    assert.equal(state.level, 45);
    assert.deepEqual(stepWaterZoneState(state, zone, 60), state);
});

test('wave origins are bounded and default to the legacy minZ direction', () => {
    assert.equal(zone.waveOrigin, WATER_WAVE_ORIGINS.MIN_Z);
    assert.equal(normalizeWaterZone({ ...zone, waveOrigin: 'maxZ' }).waveOrigin, WATER_WAVE_ORIGINS.MAX_Z);
    assert.equal(normalizeWaterZone({ ...zone, waveOrigin: 'sideways' }).waveOrigin, WATER_WAVE_ORIGINS.MIN_Z);
});

test('underwater lookup stays bounded and network roundtrips the authoritative state', () => {
    const flooded = stepWaterZoneState(stepWaterZoneState(triggerWaterZone(createWaterZoneState(zone)), zone, 2), zone, 20);
    assert.equal(isPointUnderwater(zone, flooded, [0, 40, 0]), true);
    assert.equal(isPointUnderwater(zone, flooded, [0, 50, 0]), false);
    assert.equal(isPointUnderwater(zone, flooded, [100, 20, 0]), false);
    const payload = serializeWaterZoneState(flooded);
    assert.deepEqual(applyWaterZoneNetworkState(createWaterZoneState(zone), zone, payload), flooded);
});

test('reservoir bounds are normalized, frozen and optional for legacy water zones', () => {
    assert.deepEqual(reservoirZone.reservoirBounds, {
        min: [-90, 0, 90],
        max: [90, 75, 95],
    });
    assert.equal(Object.isFrozen(reservoirZone.reservoirBounds), true);
    assert.equal(Object.isFrozen(reservoirZone.reservoirBounds.min), true);
    assert.equal(Object.isFrozen(reservoirZone.reservoirBounds.max), true);
    assert.equal(Object.hasOwn(zone, 'reservoirBounds'), false);
});

test('reservoir stays underwater through every phase while the dry basin stays dry', () => {
    const reservoirPoint = [0, 70, 92];
    const basinPoint = [0, 1, 89];
    const state = createWaterZoneState(reservoirZone);

    assert.equal(isPointUnderwater(reservoirZone, state, reservoirPoint), true);
    assert.equal(isPointUnderwater(reservoirZone, state, basinPoint), false);
    triggerWaterZone(state);
    assert.equal(isPointUnderwater(reservoirZone, state, reservoirPoint), true);
    stepWaterZoneState(state, reservoirZone, reservoirZone.waveSeconds);
    assert.equal(isPointUnderwater(reservoirZone, state, reservoirPoint), true);
    stepWaterZoneState(state, reservoirZone, reservoirZone.riseSeconds);
    assert.equal(isPointUnderwater(reservoirZone, state, reservoirPoint), true);
});

test('reservoir definition remains static and does not change the network payload', () => {
    const payload = serializeWaterZoneState(createWaterZoneState(reservoirZone));
    assert.deepEqual(Object.keys(payload), ['phase', 'phaseElapsedSeconds', 'level', 'triggered']);
    assert.equal(Object.hasOwn(payload, 'reservoirBounds'), false);
});

test('water effects encode slower flight, buoyancy, reduced sight and no passive damage', () => {
    assert.ok(zone.effects.speedMultiplier < 1);
    assert.ok(zone.effects.turnMultiplier < 1);
    assert.ok(zone.effects.visibilityMultiplier < 1);
    assert.ok(zone.effects.buoyancy > 0);
    assert.equal(zone.effects.damagePerSecond, 0);
    assert.equal(zone.effects.createTrails, false);
    assert.equal(zone.effects.extinguishesFire, true);
    assert.equal(zone.effects.flamethrowerEnabled, false);
    assert.ok(zone.effects.projectileSpeedMultiplier < 1);
    assert.equal(zone.effects.groundUnitsEnabled, true);
});
