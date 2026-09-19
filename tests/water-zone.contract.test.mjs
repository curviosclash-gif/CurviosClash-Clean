import assert from 'node:assert/strict';
import test from 'node:test';

import {
    WATER_PHASES,
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

test('underwater lookup stays bounded and network roundtrips the authoritative state', () => {
    const flooded = stepWaterZoneState(stepWaterZoneState(triggerWaterZone(createWaterZoneState(zone)), zone, 2), zone, 20);
    assert.equal(isPointUnderwater(zone, flooded, [0, 40, 0]), true);
    assert.equal(isPointUnderwater(zone, flooded, [0, 50, 0]), false);
    assert.equal(isPointUnderwater(zone, flooded, [100, 20, 0]), false);
    const payload = serializeWaterZoneState(flooded);
    assert.deepEqual(applyWaterZoneNetworkState(createWaterZoneState(zone), zone, payload), flooded);
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
