import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import {
    applyPlayerPowerup,
    recomputePlayerEffectState,
    updatePlayerEffects,
} from '../src/entities/player/PlayerEffectOps.js';
import { ITEM_SLOT_BY_TYPE, ITEM_SLOT_UNKNOWN_INDEX } from '../src/entities/ai/observation/ItemSlotEncoder.js';
import { FLAMETHROWER_TARGET_SPAWN_WEIGHTS } from '../src/shared/contracts/FlamethrowerPickupDefinitionsContract.js';
import {
    getPickupDefinition,
    getPickupSpawnWeight,
    getPickupTypes,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    pickWeightedPickupType,
} from '../src/shared/contracts/PickupRegistryContract.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

// Frozen on 2026-09-18 from the shipped registry. Trained bots read a 20 slot item vector,
// so every existing item has to keep its slot when a new item joins the registry.
const OBSERVATION_SLOTS_BEFORE_FLAMETHROWER = Object.freeze({
    SPEED_UP: 0, SLOW_DOWN: 1, THICK: 2, THIN: 3, SHIELD: 4, SLOW_TIME: 5, GHOST: 6, INVERT: 7,
    ROCKET_WEAK: 8, ROCKET_MEDIUM: 9, ROCKET_HEAVY: 10, ROCKET_MEGA: 11, HEALTH: 12,
    MG_TURRET: 13, ROCKET_TURRET: 13, MINE: 13, TRAIL_GAP: 14, EMP: 15, SWAP: 15,
    MAGNET: 16, DECOY: 17, PURGE: 18, FOG: 19, FAN_3: 19, FAN_4: 19, FAN_5: 19,
});

function createFlamePlayer() {
    const player = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(),
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
        applyPowerup(type, options) { applyPlayerPowerup(this, type, options); },
    };
    return player;
}

test('flamethrower item is registered, self-usable and spawns at its target rarity', () => {
    const definition = getPickupDefinition('FLAMETHROWER');
    assert.ok(definition, 'FLAMETHROWER resolves through the shared pickup registry');
    assert.equal(typeof definition.name, 'string');
    assert.ok(definition.name.length > 0, 'the item has a German display name');
    assert.ok(String(definition.description || '').length > 0, 'the item has a German description');
    assert.equal(definition.duration, 30, 'the item expires 30 seconds after activation');
    assert.equal(definition.selfUsable, true);
    assert.equal(definition.shootable, false);
    assert.equal(definition.offensive, false);
    assert.equal(definition.stackPolicy, 'refresh', 'a second pickup replaces the running tank');
    assert.equal(definition.actionRole, 'buff');
    assert.equal(definition.effectCategory, 'flamethrower');
    assert.deepEqual(
        definition.botRule,
        { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
        'bots ignore the item until S4.7',
    );

    for (const mode of ['CLASSIC', 'ARCADE', 'HUNT']) {
        assert.equal(isPickupTypeAllowedForMode('FLAMETHROWER', mode), true, `usable in ${mode}`);
        assert.equal(isPickupTypeSelfUsable('FLAMETHROWER', mode), true, `self-usable in ${mode}`);
        assert.equal(isPickupTypeShootable('FLAMETHROWER', mode), false, `never a projectile in ${mode}`);
        assert.ok(FLAMETHROWER_TARGET_SPAWN_WEIGHTS[mode] > 0, `target weight for ${mode} is recorded`);
        assert.equal(
            getPickupSpawnWeight('FLAMETHROWER', mode),
            FLAMETHROWER_TARGET_SPAWN_WEIGHTS[mode],
            `spawns at the target rarity in ${mode}`,
        );
    }
    assert.equal(
        HUNT_CONFIG.PICKUP_WEIGHTS.FLAMETHROWER,
        FLAMETHROWER_TARGET_SPAWN_WEIGHTS.HUNT,
        'Hunt spawns use their own weight table, which has to match the definition',
    );

    const everyType = getPickupTypes();
    for (const mode of ['CLASSIC', 'ARCADE', 'HUNT']) {
        let picked = false;
        for (let roll = 0; roll < 2000 && !picked; roll += 1) {
            picked = pickWeightedPickupType(everyType, mode, () => roll / 2000) === 'FLAMETHROWER';
        }
        assert.equal(picked, true, `a weighted spawn can return the item in ${mode}`);
    }
});

test('flamethrower keeps every existing bot observation slot in place', () => {
    for (const [type, slot] of Object.entries(OBSERVATION_SLOTS_BEFORE_FLAMETHROWER)) {
        assert.equal(ITEM_SLOT_BY_TYPE[type], slot, `${type} keeps observation slot ${slot}`);
    }
    // All twenty slots are taken, so the new item shares the catch-all slot instead of shifting others.
    assert.equal(ITEM_SLOT_BY_TYPE.FLAMETHROWER, ITEM_SLOT_UNKNOWN_INDEX);
});

test('using the flamethrower fills a six second tank that expires with the item', () => {
    const player = createFlamePlayer();
    const fuelSeconds = HUNT_CONFIG.FLAMETHROWER.FUEL_SECONDS;
    assert.equal(fuelSeconds, 6);

    player.applyPowerup('FLAMETHROWER');
    const effect = player.activeEffects.find((entry) => entry.type === 'FLAMETHROWER');
    assert.ok(effect, 'activation pushes an active effect');
    assert.equal(effect.remaining, 30);
    assert.equal(player.flameFuelSeconds, fuelSeconds);
    assert.equal(player.hasFlamethrower, true);

    // Burn part of the tank and let the item age, then pick a second one up.
    effect.fuelSeconds = 2;
    updatePlayerEffects(player, 10);
    assert.equal(player.flameFuelSeconds, 2);
    assert.ok(player.activeEffects[0].remaining < 21);

    player.applyPowerup('FLAMETHROWER');
    assert.equal(player.activeEffects.filter((entry) => entry.type === 'FLAMETHROWER').length, 1);
    assert.equal(player.activeEffects[0].remaining, 30);
    assert.equal(player.flameFuelSeconds, fuelSeconds);

    updatePlayerEffects(player, 31);
    assert.equal(player.activeEffects.length, 0, 'the item expires after 30 seconds');
    assert.equal(player.flameFuelSeconds, 0);
    assert.equal(player.hasFlamethrower, false);
});

test('an empty tank and a cleared effect list both take the flamethrower away', () => {
    const player = createFlamePlayer();
    player.applyPowerup('FLAMETHROWER');
    player.activeEffects[0].fuelSeconds = 0;
    recomputePlayerEffectState(player);
    assert.equal(player.hasFlamethrower, false, 'an empty tank ends the flamethrower');
    assert.equal(player.flameFuelSeconds, 0);

    player.applyPowerup('FLAMETHROWER');
    assert.equal(player.flameFuelSeconds, HUNT_CONFIG.FLAMETHROWER.FUEL_SECONDS);
    // Death, respawn and round restart all clear activeEffects; the tank must follow.
    player.activeEffects.length = 0;
    recomputePlayerEffectState(player);
    assert.equal(player.flameFuelSeconds, 0);
    assert.equal(player.hasFlamethrower, false);
});
