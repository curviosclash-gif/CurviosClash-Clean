import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import {
    LightningStrikeSystem,
    resolveLightningDamage,
    selectLightningTargets,
} from '../src/hunt/LightningStrikeSystem.js';
import { getPickupDefinition, isPickupTypeAllowedForMode } from '../src/entities/PickupRegistry.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};
const CLASSIC_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
};

function createPlayer(index, y, hp = 100) {
    return {
        index,
        alive: true,
        isBot: index > 0,
        hp,
        shieldHP: 0,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(index * 10, y, 0),
        taken: [],
        takeDamage(amount) {
            this.taken.push(amount);
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

function createWorld(players, config = HUNT_MODE_CONFIG) {
    const kills = [];
    const damageEvents = [];
    const manager = {
        players,
        entityRuntimeConfig: config,
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
        _killPlayer: (player, cause, options) => { player.alive = false; kills.push({ player, cause, options }); },
    };
    return { manager, kills, damageEvents, system: new LightningStrikeSystem(manager) };
}

test('the item exists only where hit points exist and is rare there', () => {
    const definition = getPickupDefinition('LIGHTNING');
    assert.equal(definition.name, 'Blitz');
    assert.equal(definition.selfUsable, true);
    assert.equal(isPickupTypeAllowedForMode('LIGHTNING', 'HUNT'), true);
    assert.equal(isPickupTypeAllowedForMode('LIGHTNING', 'ARCADE'), true);
    assert.equal(isPickupTypeAllowedForMode('LIGHTNING', 'CLASSIC'), false, 'E82: never in classic');
    assert.equal(CONFIG_BASE.HUNT.PICKUP_WEIGHTS.LIGHTNING, 0.225);
});

test('the highest fifth of the other players is chosen, at least one, never the caster', () => {
    const caster = createPlayer(0, 500);
    const others = [10, 80, 60, 20, 40, 30, 70, 50, 90, 5].map((y, i) => createPlayer(i + 1, y));
    const chosen = selectLightningTargets([caster, ...others], caster, 0.2);
    assert.deepEqual(chosen.map((p) => p.position.y), [90, 80], '20 % of ten is two');

    const three = [caster, createPlayer(1, 10), createPlayer(2, 30), createPlayer(3, 20)];
    assert.deepEqual(selectLightningTargets(three, caster, 0.2).map((p) => p.index), [2], 'rounded up to one');

    const protectedPlayer = createPlayer(4, 999);
    protectedPlayer.spawnProtectionTimer = 1;
    const dead = createPlayer(5, 998);
    dead.alive = false;
    assert.deepEqual(selectLightningTargets([caster, protectedPlayer, dead, createPlayer(6, 1)], caster, 0.2).map((p) => p.index), [6]);
    assert.deepEqual(selectLightningTargets([caster], caster, 0.2), []);
});

test('the strike takes 35, but at 30 hit points or more the target keeps one', () => {
    assert.equal(resolveLightningDamage({ hp: 100 }, 35, 30), 35);
    assert.equal(resolveLightningDamage({ hp: 30 }, 35, 30), 29, 'exactly 30 survives with 1');
    assert.equal(resolveLightningDamage({ hp: 31, shieldHP: 10 }, 35, 30), 35, 'the shield soaks part of it');
    assert.equal(resolveLightningDamage({ hp: 29 }, 35, 30), 35, 'below 30 the strike kills');
});

test('the targets are chosen when the strike lands, two seconds after the cast', () => {
    const caster = createPlayer(0, 0);
    const high = createPlayer(1, 100);
    const low = createPlayer(2, 10);
    const { system, damageEvents } = createWorld([caster, high, low]);
    assert.equal(system.activate(caster), true);
    system.update(1.5);
    assert.equal(high.taken.length, 0, 'nothing during the warning');
    assert.deepEqual(system.getWarningState(), { remainingSeconds: 0.5, durationSeconds: 2, count: 1 });

    high.position.y = 5; // dives in the warning window (E27)
    system.update(0.6);
    assert.deepEqual(low.taken, [35], 'the diver escaped, the new highest was hit');
    assert.equal(high.taken.length, 0);
    assert.equal(system.getWarningState(), null);
    assert.equal(damageEvents[0].sourcePlayer, caster);
    assert.equal(damageEvents[0].cause, 'LIGHTNING');
    assert.deepEqual(system.lastStrike.targetIndices, [2]);
});

test('a weak target dies and the kill goes to the caster', () => {
    const caster = createPlayer(0, 0);
    const weak = createPlayer(1, 100, 20);
    const { system, kills } = createWorld([caster, weak]);
    system.activate(caster);
    system.update(2);
    assert.equal(kills.length, 1);
    assert.equal(kills[0].options.killer, caster);
    assert.equal(kills[0].options.projectileType, 'LIGHTNING');
});

test('no strike without hit points, on a replica, or after a round reset', () => {
    const caster = createPlayer(0, 0);
    const classic = createWorld([caster, createPlayer(1, 50)], CLASSIC_MODE_CONFIG);
    assert.equal(classic.system.activate(caster), false);

    const replica = createWorld([caster, createPlayer(1, 50)]);
    replica.system.setNetworkReplica(true);
    assert.equal(replica.system.activate(caster), false);

    const target = createPlayer(1, 50);
    const reset = createWorld([caster, target]);
    reset.system.activate(caster);
    reset.system.reset();
    reset.system.update(3);
    assert.equal(target.taken.length, 0);
});

test('using the item calls the strike and keeps the item when the strike is refused', () => {
    const player = { index: 0, alive: true, inventory: ['LIGHTNING'], selectedItemIndex: 0, itemUseCooldownRemaining: 0 };
    let accept = true;
    const casts = [];
    const combat = new HuntCombatSystem({
        services: { entityRuntimeConfig: HUNT_MODE_CONFIG },
        callbacks: {
            getStrategy: () => ({ modeType: 'HUNT', hasMachineGun: () => true }),
            globalEffects: {
                canActivateLightning: () => accept,
                activateLightning: (caster) => { casts.push(caster); return accept; },
            },
        },
    });
    assert.equal(combat.useInventoryItem(player, 0).ok, true);
    assert.deepEqual(casts, [player]);
    assert.deepEqual(player.inventory, []);

    accept = false;
    player.inventory = ['LIGHTNING'];
    player.itemUseCooldownRemaining = 0;
    const refused = combat.useInventoryItem(player, 0);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'Blitz konnte nicht ausgelöst werden');
    assert.deepEqual(player.inventory, ['LIGHTNING'], 'the item stays');
});
