import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeMapProximityDamageSources,
    resolveMapProximityDamage,
} from '../src/shared/contracts/MapProximityDamageContract.js';
import { MapHazardSystem } from '../src/entities/systems/MapHazardSystem.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';

const source = normalizeMapProximityDamageSources([{
    id: 'core', position: [0, 12, 0], radius: 12,
    nearDamagePerSecond: 2, farDamagePerSecond: 0.5,
}])[0];

test('core radiation ramps from 2 HP/s at the rods to 0.5 HP/s at the authored radius', () => {
    assert.equal(resolveMapProximityDamage(source, [0, 12, 0]), 2);
    assert.equal(resolveMapProximityDamage(source, [0, 12, 6]), 1.25);
    assert.ok(resolveMapProximityDamage(source, [0, 12, 11.99]) > 0.5);
    assert.ok(resolveMapProximityDamage(source, [0, 12, 11.99]) < 0.51);
    assert.equal(resolveMapProximityDamage(source, [0, 12, 12]), 0);
    assert.equal(source.radius, 12);
});

test('the host applies time-based mode damage, while spawn protection and replicas remain protected', () => {
    const map = { ...MAP_PRESET_CATALOG.reactor_site, scaleAuthoredAnchors: false,
        mapProximityDamage: [{ ...MAP_PRESET_CATALOG.reactor_site.mapProximityDamage[0], modes: [] }] };
    const [radiation] = map.mapProximityDamage;
    let applied = 0;
    const owner = {
        arena: { currentMapDefinition: map },
        gameModeStrategy: { modeType: 'HUNT' },
        _applyModeDamage(player, damage, cause, options) {
            applied += damage;
            assert.equal(cause, 'MAP_PROXIMITY_HAZARD');
            assert.equal(options.emitDamageEvent, false);
            assert.strictEqual(options.impactPoint, player.position);
        },
    };
    const system = new MapHazardSystem(owner);
    assert.equal(system.startRound(), 0, 'radiation does not become a pulsing warning hazard');
    const player = {
        index: 0,
        alive: true,
        spawnProtectionTimer: 0,
        position: { x: radiation.position[0], y: radiation.position[1], z: radiation.position[2] },
    };
    assert.equal(system.updatePlayer(player, null, 4, 0.5), true);
    assert.equal(applied, 1, 'the source maximum is multiplied by elapsed seconds');

    player.spawnProtectionTimer = 1;
    assert.equal(system.updatePlayer(player, null, 4.5, 1), false);
    assert.equal(applied, 1);
    player.spawnProtectionTimer = 0;
    system.setNetworkReplica(true);
    assert.equal(system.updatePlayer(player, null, 5.5, 1), false);
    assert.equal(applied, 1);
});

test('reactor radiation is authored at the centered fuel-rod height and remains mild', () => {
    const [core] = MAP_PRESET_CATALOG.reactor_site.mapProximityDamage;
    assert.deepEqual(core.position, [0, -48.04, 0]);
    assert.equal(core.radius, 12);
    assert.equal(core.nearDamagePerSecond, 2);
    assert.equal(core.farDamagePerSecond, 0.5);
    assert.deepEqual(core.modes, ['HUNT', 'ARCADE']);
});

test('reactor radiation does not add fatal damage to Classic mode', () => {
    const owner = {
        arena: { currentMapDefinition: MAP_PRESET_CATALOG.reactor_site },
        gameModeStrategy: createGameModeStrategy('CLASSIC'),
    };
    const system = new MapHazardSystem(owner);
    assert.equal(system.startRound(), 0);
    assert.equal(system.proximityDamageSources.length, 0);
});
