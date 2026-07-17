import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import {
    getPickupDefinition,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
} from '../src/entities/PickupRegistry.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('MG turret pickup is a Hunt-only deployable inventory item', () => {
    const definition = getPickupDefinition('ITEM_TURRET');

    assert.equal(definition?.visualKind, 'turret');
    assert.equal(isPickupTypeAllowedForMode('MG_TURRET', 'HUNT'), true);
    assert.equal(isPickupTypeAllowedForMode('MG_TURRET', 'CLASSIC'), false);
    assert.equal(isPickupTypeSelfUsable('MG_TURRET', 'HUNT'), true);
    assert.equal(CONFIG_BASE.POWERUP.TYPES.MG_TURRET?.huntOnly, true);
});

test('using the MG turret pickup deploys and consumes it without adding a timed player effect', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    let deployedFor = null;
    const runtime = {
        services: { entityRuntimeConfig },
        callbacks: {
            getStrategy: () => ({ modeType: 'HUNT', hasMachineGun: () => true }),
            combat: {
                deployMgTurret(player) {
                    deployedFor = player;
                    return {};
                },
            },
        },
        get combat() {
            return this.callbacks.combat;
        },
    };
    const player = {
        inventory: ['MG_TURRET'],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 0,
        applyPowerup() {
            assert.fail('deployable turret must not become a player effect');
        },
    };
    const system = new HuntCombatSystem(runtime);

    const result = system.useInventoryItem(player, 0);

    assert.equal(result.ok, true);
    assert.equal(result.type, 'MG_TURRET');
    assert.equal(deployedFor, player);
    assert.deepEqual(player.inventory, []);
});

test('deployed MG turret prioritizes a nearer enemy trail, then attacks the enemy and expires', () => {
    const ownerPlayer = { index: 0, alive: true, position: new THREE.Vector3(0, 0, 0) };
    const enemy = {
        index: 1,
        alive: true,
        hp: 100,
        position: new THREE.Vector3(18, 0, 0),
        takeDamage(amount) {
            this.hp -= amount;
            return { applied: amount, hpApplied: amount, remainingHp: this.hp, isDead: false };
        },
    };
    const trailEntry = {
        playerIndex: 1,
        segmentIdx: 3,
        fromX: 5,
        fromY: 0,
        fromZ: 0,
        toX: 7,
        toY: 0,
        toZ: 0,
        destroyed: false,
    };
    const trailCell = new Set([trailEntry]);
    const spatialGrid = new Map([[(1000 * 2000) + 1000, trailCell]]);
    const trailHits = [];
    const damageEvents = [];
    const manager = {
        renderer: null,
        gameModeStrategy: { modeType: 'HUNT' },
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        arena: { checkCollisionFast: () => false },
        players: [ownerPlayer, enemy],
        humanPlayers: [ownerPlayer],
        _trailSpatialIndex: {
            gridSize: 10,
            spatialGrid,
            damageTrailSegment(entry, damage) {
                trailHits.push({ entry, damage });
                entry.destroyed = true;
                trailCell.delete(entry);
                return { hit: true, destroyed: true, remainingHp: 0 };
            },
        },
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
    };
    const system = new StaticTurretSystem(manager);

    const turret = system.deployForPlayer(ownerPlayer);
    assert.ok(turret);
    system.update(0.01);
    assert.equal(trailHits.length, 1);
    assert.equal(enemy.hp, 100);

    system.update(0.25);
    assert.equal(enemy.hp, 97);
    assert.equal(damageEvents[0]?.sourcePlayer, ownerPlayer);

    system.update(20);
    assert.equal(system.turrets.length, 0);
    system.dispose();
});
