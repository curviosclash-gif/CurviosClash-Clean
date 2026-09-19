import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getPickupDefinition,
    getPickupVisualDescriptor,
    isPickupTypeAllowedForMode,
    normalizePickupType,
} from '../src/entities/PickupRegistry.js';
import {
    addPlayerInventoryItem,
    usePlayerInventoryItem,
} from '../src/entities/player/PlayerInventoryOps.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

test('the repair drone is a twenty-second combat pickup with its own symbol and model', () => {
    const definition = getPickupDefinition('REPAIR_DRONE');
    assert.ok(definition);
    assert.equal(definition.duration, 20);
    assert.equal(definition.icon, '🔧');
    assert.equal(definition.visualKind, 'repair-drone');
    assert.equal(getPickupVisualDescriptor('REPAIR_DRONE').kind, 'repair-drone');
    assert.equal(isPickupTypeAllowedForMode('REPAIR_DRONE', 'HUNT'), true);
    assert.equal(isPickupTypeAllowedForMode('REPAIR_DRONE', 'ARCADE'), true);
    assert.equal(isPickupTypeAllowedForMode('REPAIR_DRONE', 'CLASSIC'), false);
    assert.equal(normalizePickupType('REPARATUR_DROHNE'), 'REPAIR_DRONE');
    assert.equal(HUNT_CONFIG.PICKUP_WEIGHTS.REPAIR_DRONE, 0.225);
});

test('the repair drone survives inventory handling and is consumed once on use', () => {
    const applied = [];
    const player = {
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        entityRuntimeConfig: { POWERUP: { MAX_INVENTORY: 3 } },
        applyPowerup: (type) => applied.push(type),
    };

    assert.equal(addPlayerInventoryItem(player, 'REPAIR_DRONE'), true);
    assert.deepEqual(player.inventory, ['REPAIR_DRONE']);
    const result = usePlayerInventoryItem(player, 'HUNT');
    assert.equal(result.ok, true);
    assert.deepEqual(applied, ['REPAIR_DRONE']);
    assert.deepEqual(player.inventory, []);
    assert.equal(usePlayerInventoryItem(player, 'HUNT').ok, false, 'a restart or second use finds no stale item');
});
