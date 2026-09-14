import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    normalizeEntityKey,
    resolveEntityCooldown,
} from '../src/entities/arena/portal/TraversalCooldownOps.js';

import {
    getRocketPickupTypes,
    getPickupTypes,
    getPickupSpawnWeight,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    normalizePickupType,
} from '../src/entities/PickupRegistry.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { createMapDocument } from '../src/entities/MapSchema.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { SpecialGateRuntime } from '../src/entities/arena/portal/SpecialGateRuntime.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { PlayerInteractionPhase } from '../src/entities/systems/lifecycle/PlayerInteractionPhase.js';
import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import {
    encodeItemSlots,
    ITEM_SLOT_BY_TYPE,
    ITEM_SLOT_COUNT,
    ITEM_SLOT_UNKNOWN_INDEX,
} from '../src/entities/ai/observation/ItemSlotEncoder.js';
import {
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';
import {
    resolveInventoryActionAvailability,
    resolvePickupActionAvailability,
} from '../src/shared/contracts/GameplayActionAvailabilityContract.js';
import { GAMEPLAY_ACTION_RESULT_CODES } from '../src/shared/contracts/GameplayActionResultContract.js';
import { RoundMetricsStore } from '../src/state/recorder/RoundMetricsStore.js';
import { deriveMapResolutionFeedbackPlan } from '../src/state/match-session/MatchSessionFeedbackPlan.js';
import { applyPlayerPowerup, updatePlayerEffects } from '../src/entities/player/PlayerEffectOps.js';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { updateTraversalStatus } from '../src/ui/TraversalHudPresenter.js';

test('Pickup capability matrix keeps rocket and utility contracts mode-safe', () => {
    const rocketTypes = getRocketPickupTypes();
    assert.ok(rocketTypes.length >= 4);

    for (const type of rocketTypes) {
        assert.equal(isPickupTypeAllowedForMode(type, 'HUNT'), true);
        assert.equal(isPickupTypeAllowedForMode(type, 'CLASSIC'), false);
        assert.equal(isPickupTypeSelfUsable(type, 'HUNT'), false);
        assert.equal(isPickupTypeShootable(type, 'HUNT'), true);
    }

    assert.equal(normalizePickupType('item_rocket'), 'ROCKET_WEAK');
    assert.equal(normalizePickupType('item_health'), 'HEALTH');
    assert.equal(isPickupTypeAllowedForMode('SLOW_TIME', 'CLASSIC'), true);
    assert.equal(isPickupTypeAllowedForMode('SLOW_TIME', 'HUNT'), true);
    assert.equal(isPickupTypeSelfUsable('SHIELD', 'HUNT'), true);
    assert.equal(isPickupTypeShootable('SHIELD', 'HUNT'), false);
    assert.equal(isPickupTypeSelfUsable('EMP', 'HUNT'), true);
    assert.equal(isPickupTypeShootable('EMP', 'HUNT'), false);
    assert.equal(isPickupTypeSelfUsable('MINE', 'CLASSIC'), true);
    assert.equal(isPickupTypeAllowedForMode('HEALTH', 'CLASSIC'), false);
    assert.equal(isPickupTypeAllowedForMode('HEALTH', 'ARCADE'), true);
    assert.equal(getPickupSpawnWeight('SLOW_TIME', 'CLASSIC') < getPickupSpawnWeight('SPEED_UP', 'CLASSIC'), true);
    for (const type of getPickupTypes()) {
        assert.notEqual(isPickupTypeSelfUsable(type), isPickupTypeShootable(type), `${type} has one primary action`);
    }
});

test('expanded pickups keep distinct action semantics in the stable bot item encoding', () => {
    assert.equal(ITEM_SLOT_COUNT, 20);
    assert.equal(ITEM_SLOT_BY_TYPE.SWAP, ITEM_SLOT_BY_TYPE.EMP);
    assert.equal(ITEM_SLOT_BY_TYPE.MINE, ITEM_SLOT_BY_TYPE.MG_TURRET);
    assert.notEqual(ITEM_SLOT_BY_TYPE.SWAP, ITEM_SLOT_BY_TYPE.MINE);
    assert.notEqual(ITEM_SLOT_BY_TYPE.SWAP, ITEM_SLOT_UNKNOWN_INDEX);
    assert.notEqual(ITEM_SLOT_BY_TYPE.MINE, ITEM_SLOT_UNKNOWN_INDEX);

    const encoded = encodeItemSlots(['SWAP', 'MINE', 'UNKNOWN_ITEM']);
    assert.equal(encoded[ITEM_SLOT_BY_TYPE.SWAP], 1);
    assert.equal(encoded[ITEM_SLOT_BY_TYPE.MINE], 1);
    assert.equal(encoded[ITEM_SLOT_UNKNOWN_INDEX], 1);
    assert.equal(encoded.reduce((sum, value) => sum + value, 0), 3);
});

test('full inventory rejects a pickup without removing it or emitting collect success', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const removed = [];
    const manager = new PowerupManager({
        addToScene() {},
        removeFromScene(mesh) { removed.push(mesh); },
    }, {}, entityRuntimeConfig);
    const mesh = new THREE.Group();
    manager.items.push({
        mesh,
        type: 'SHIELD',
        box: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(5, 5, 5)),
        anchorKey: null,
    });

    const events = [];
    const logs = [];
    const feedback = [];
    const phase = new PlayerInteractionPhase({
        arena: { checkExitPortal: () => null, checkPortal: () => null },
        powerupManager: manager,
        recorder: { logEvent: (...args) => logs.push(args) },
        _emitArcadeGameplayEvent: (event) => events.push(event),
        _notifyPlayerFeedback: (_player, message) => feedback.push(message),
    });
    const player = {
        index: 0,
        isBot: false,
        position: new THREE.Vector3(),
        hitboxRadius: 1,
        addToInventory: () => false,
    };
    phase.runPortalAndPickup(player);
    phase.runPortalAndPickup(player);

    assert.equal(manager.items.length, 1);
    assert.equal(removed.length, 0);
    assert.equal(events.length, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0][2], /item\.pickup\.inventory-full/);
    assert.deepEqual(feedback, ['Inventar voll']);

    const accepted = manager.checkPickup(new THREE.Vector3(), 1, () => true);
    assert.equal(accepted.ok, true);
    assert.equal(manager.items.length, 0);
    assert.equal(removed.length, 1);
    manager.dispose();
});

test('random pickups avoid unsafe player space and telegraph before collection', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const positions = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(24, 0, 0)];
    let positionIndex = 0;
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {
        checkCollision: () => false,
        getRandomPosition: () => positions[Math.min(positionIndex++, positions.length - 1)].clone(),
        portals: [],
        specialGates: [],
    }, entityRuntimeConfig);
    manager.getStrategy = () => new ClassicModeStrategy({ entityRuntimeConfig, random: () => 0.2 });
    manager.getSafetyContext = () => ({
        players: [{ alive: true, position: new THREE.Vector3(0, 0, 0) }],
        trailSpatialIndex: { checkGlobalCollision: () => false },
    });

    manager._spawnRandom();
    assert.equal(manager.items.length, 1);
    assert.deepEqual(manager.items[0].mesh.position.toArray(), [24, 0, 0]);
    assert.equal(manager.checkPickup(manager.items[0].mesh.position, 1, () => true), null);
    manager.update(0.75);
    assert.equal(manager.checkPickup(manager.items[0].mesh.position, 1, () => true)?.ok, true);
    manager.dispose();
});

test('slow time counts active effect durations in real time', () => {
    const player = {
        entityRuntimeConfig: {
            ...CONFIG_BASE,
            HUNT: { ...CONFIG_BASE.HUNT, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
        },
        activeEffects: [],
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
    };
    player.entityManager = { players: [player] };
    applyPlayerPowerup(player, 'SLOW_TIME');
    applyPlayerPowerup(player, 'SPEED_UP');

    updatePlayerEffects(player, 0.4);

    assert.equal(player.activeEffects.find((effect) => effect.type === 'SLOW_TIME').remaining, 9);
    assert.equal(player.activeEffects.find((effect) => effect.type === 'SPEED_UP').remaining, 7);
});

test('Medipack restores hunt health instead of granting a shield', () => {
    const player = {
        entityRuntimeConfig: {
            ...CONFIG_BASE,
            HUNT: {
                ...CONFIG_BASE.HUNT,
                ENABLED: true,
                ACTIVE_MODE: 'HUNT',
                DEFAULT_MODE: 'HUNT',
            },
        },
        hp: 40,
        maxHp: 100,
        hasShield: false,
        shieldHP: 0,
        activeEffects: [],
    };

    applyPlayerPowerup(player, 'HEALTH');

    assert.equal(player.hp, 75);
    assert.equal(player.hasShield, false);
    assert.equal(player.activeEffects.length, 0);
});

test('expanded effects replace conflicting stacks and support EMP, retired purge and deployments', () => {
    let mines = 0;
    const player = {
        entityRuntimeConfig: { ...CONFIG_BASE, HUNT: { ...CONFIG_BASE.HUNT, ACTIVE_MODE: 'CLASSIC' } },
        entityManager: { _projectileSystem: { deployMine: () => { mines += 1; } } },
        activeEffects: [],
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hasShield: false,
        shieldHP: 0,
    };

    applyPlayerPowerup(player, 'SPEED_UP');
    applyPlayerPowerup(player, 'SLOW_DOWN');
    assert.deepEqual(player.activeEffects.map((effect) => effect.type), ['SLOW_DOWN']);
    applyPlayerPowerup(player, 'TRAIL_GAP');
    applyPlayerPowerup(player, 'MAGNET');
    applyPlayerPowerup(player, 'DECOY');
    assert.equal(player.trailGapActive, true);
    assert.equal(player.pickupRadiusMultiplier, 5);
    assert.equal(player.decoyActive, true);

    // EMP strips positive effects only; the enemy-imposed trail gap stays.
    applyPlayerPowerup(player, 'EMP');
    assert.deepEqual(player.activeEffects.map((effect) => effect.type), ['SLOW_DOWN', 'TRAIL_GAP', 'EMP']);
    assert.equal(player.itemActionsDisabled, true);
    applyPlayerPowerup(player, 'PURGE');
    assert.deepEqual(player.activeEffects.map((effect) => effect.type), ['SLOW_DOWN', 'TRAIL_GAP', 'EMP']);
    assert.equal(player.itemActionsDisabled, true);
    applyPlayerPowerup(player, 'MINE');
    assert.equal(mines, 1);
});

test('one simulation tick consumes at most one inventory item action', () => {
    let uses = 0;
    let shots = 0;
    const phase = new PlayerActionPhase({
        _useInventoryItem: () => { uses += 1; return { ok: true, type: 'SHIELD' }; },
        _shootItemProjectile: () => { shots += 1; return { ok: true, type: 'EMP' }; },
    });
    phase.run({ isBot: true, cycleItem() {}, dropItem() {} }, {
        nextItem: false,
        dropItem: false,
        useItem: 0,
        shootItem: true,
        shootItemIndex: 1,
        shootMG: false,
    }, { requiresShootItemIndex: () => true, hasMachineGun: () => false });
    assert.equal(uses, 1);
    assert.equal(shots, 0);
});

test('EMP-disabled rocket input consumes nothing and never reaches projectile fire', () => {
    let shots = 0;
    const phase = new PlayerActionPhase({
        _shootItemProjectile: () => { shots += 1; return { ok: true, type: 'ROCKET_WEAK' }; },
        _notifyPlayerFeedback() {},
    });
    const player = {
        index: 0,
        isBot: false,
        itemActionsDisabled: true,
        inventory: ['EMP'],
        rocketInventory: ['ROCKET_WEAK'],
        cycleItem() {},
        dropItem() {},
    };
    phase.run(player, {
        nextItem: false,
        dropItem: false,
        useItem: -1,
        shootItem: false,
        shootRocket: true,
        shootMG: false,
    }, { requiresShootItemIndex: () => true, hasMachineGun: () => false });
    assert.equal(shots, 0);
    assert.deepEqual(player.rocketInventory, ['ROCKET_WEAK']);
});

test('Map schema validation keeps portal and gate fallback behavior explicit', () => {
    const warnings = [];
    const map = createMapDocument({
        portalMode: 'scripted',
        portals: [
            { a: [0, 12, 0] },
        ],
        gates: [
            { id: 'gate_legacy', type: 'boost_plus', pos: [0, 12, 0] },
        ],
        items: [
            { id: 'item_anchor', type: 'item_rocket', pickupType: 'LASER_BEAM', x: 4, y: 8, z: -6 },
        ],
    }, { warnings });

    assert.equal(map.portalMode, 'dynamic');
    assert.equal(map.portals.length, 0);
    assert.equal(map.gates.length, 1);
    assert.equal(map.gates[0].type, 'boost');
    assert.equal(map.gates[0].legacyType, 'boost_plus');
    assert.equal(map.gates[0].warningCode, 'map.warning.gate-type');
    assert.equal(map.items[0].pickupType, undefined);
    assert.ok(warnings.includes('Unsupported portalMode "scripted" normalized to "dynamic".'));
    assert.ok(warnings.includes('Portal pair 1 was ignored because both "a" and "b" vectors are required.'));
    assert.ok(warnings.includes('Unknown gate type "boost_plus" normalized to "boost".'));
    assert.ok(warnings.includes('Item anchor item_anchor uses unsupported pickupType "LASER_BEAM"; runtime falls back to item type/model.'));
});

test('Shield semantics stay deterministic across classic and hunt strategies', () => {
    const classic = new ClassicModeStrategy();
    const hunt = new HuntModeStrategy();

    const classicPlayer = { hasShield: false, maxShieldHp: 0, shieldHP: 0, hp: 1, maxHp: 1, lastDamageTimestamp: 0 };
    assert.equal(classic.grantShield(classicPlayer), 1);
    assert.equal(classicPlayer.shieldHP, 1);
    const classicDamage = classic.applyDamage(classicPlayer, 1, { nowSeconds: 12 });
    assert.equal(classicDamage.isDead, true);
    assert.equal(classicPlayer.hp, 0);
    assert.equal(classicPlayer.shieldHP, 0);
    assert.equal(classicPlayer.lastDamageTimestamp, 12);

    const huntPlayer = {
        hasShield: false,
        maxHp: 100,
        hp: 100,
        maxShieldHp: 0,
        shieldHP: 0,
        shieldHitFeedback: 0,
        lastDamageTimestamp: 0,
    };
    assert.equal(hunt.grantShield(huntPlayer), 40);
    assert.equal(huntPlayer.shieldHP, 40);
    const shieldOnlyHit = hunt.applyDamage(huntPlayer, 25, { nowSeconds: 7 });
    assert.equal(shieldOnlyHit.absorbedByShield, 25);
    assert.equal(shieldOnlyHit.remainingHp, 100);
    assert.equal(shieldOnlyHit.isDead, false);
    assert.equal(huntPlayer.shieldHP, 15);
    assert.equal(huntPlayer.hasShield, true);

    const shieldBreakHit = hunt.applyDamage(huntPlayer, 20, { nowSeconds: 9 });
    assert.equal(shieldBreakHit.absorbedByShield, 15);
    assert.equal(shieldBreakHit.remainingHp, 95);
    assert.equal(shieldBreakHit.isDead, false);
    assert.equal(huntPlayer.shieldHP, 0);
    assert.equal(huntPlayer.hasShield, false);
    assert.equal(huntPlayer.lastDamageTimestamp, 9);
});

test('Round recorder diagnostics keep failed item actions analyzable by mode and code', () => {
    const metrics = new RoundMetricsStore({ timeProvider: () => 12 });
    metrics.startRound([]);
    metrics.registerEventType('ITEM_USE', 'mode=use type=SHIELD code=item.use.forbidden ok=0');
    metrics.registerEventType('ITEM_USE', 'mode=shoot type=ROCKET_WEAK code=item.shoot.cooldown ok=0');
    metrics.registerEventType('ITEM_USE', 'mode=shoot type=ROCKET_WEAK code=item.shoot.success ok=1');
    metrics.registerEventType('ITEM_USE', 'mode=mg type=MG_BULLET code=mg.shoot.overheated ok=0');
    metrics.registerEventType('ITEM_USE', 'mode=other type=UNKNOWN code=unknown ok=0');
    metrics.registerEventType('ITEM_SPAWN', 'mode=spawn type=EMP code=item.spawn.success ok=1');
    metrics.registerEventType('ITEM_PICKUP', 'mode=pickup type=EMP code=item.pickup.success ok=1');
    metrics.registerEventType('ITEM_PICKUP', 'mode=pickup type=MINE code=item.pickup.inventory-full ok=0');
    metrics.registerEventType('ITEM_HIT', 'mode=hit type=EMP code=item.hit.success ok=1');
    metrics.registerDamageEvent({ projectileType: 'MINE', damageResult: { applied: 25 } });
    metrics.finalizeRound(null, []);

    const lastRound = metrics.getLastRoundMetrics();
    assert.equal(lastRound.itemUseEvents, 5);
    assert.equal(lastRound.failedItemActions, 3);
    assert.deepEqual(lastRound.failedItemActionModeCounts, {
        use: 1,
        shoot: 1,
        mg: 1,
        other: 0,
    });
    assert.equal(lastRound.failedItemActionCodeCounts['item.use.forbidden'], 1);
    assert.equal(lastRound.failedItemActionCodeCounts['item.shoot.cooldown'], 1);
    assert.equal(lastRound.failedItemActionCodeCounts['mg.shoot.overheated'], 1);
    assert.equal(lastRound.itemSpawnTypeCounts.EMP, 1);
    assert.equal(lastRound.itemPickupTypeCounts.EMP, 1);
    assert.equal(lastRound.itemPickupRejectedTypeCounts.MINE, 1);
    assert.equal(lastRound.itemHitTypeCounts.EMP, 1);
    assert.equal(lastRound.itemDamageByType.MINE, 25);

    const aggregate = metrics.getAggregateMetrics();
    assert.equal(aggregate.failedItemActionsPerRound, 3);
    assert.equal(aggregate.itemUseFailureRate, 0.6);
    assert.equal(aggregate.failedItemActionModePerRound.use, 1);
    assert.equal(aggregate.failedItemActionModePerRound.shoot, 1);
    assert.equal(aggregate.failedItemActionModePerRound.mg, 1);
    assert.equal(aggregate.failedItemActionCodeTotals['item.use.forbidden'], 1);
    assert.equal(aggregate.failedItemActionCodeTotals['item.shoot.cooldown'], 1);
    assert.equal(aggregate.failedItemActionCodeTotals['mg.shoot.overheated'], 1);
});

test('Shared UI action availability keeps cooldown and capability hints aligned', () => {
    const useOnly = resolvePickupActionAvailability({
        type: 'shield',
        modeType: 'hunt',
        useCooldownRemaining: 0.35,
        shootCooldownRemaining: 0.2,
    });
    assert.equal(useOnly.type, 'SHIELD');
    assert.equal(useOnly.canUse, true);
    assert.equal(useOnly.canShoot, false);
    assert.equal(useOnly.canUseNow, false);
    assert.equal(useOnly.canShootNow, false);
    assert.equal(useOnly.useOnCooldown, true);
    assert.equal(useOnly.shootOnCooldown, false);
    assert.equal(useOnly.hasCooldown, true);
    assert.equal(useOnly.actionHintLabel, 'USE');

    const projectedInventoryState = resolveInventoryActionAvailability({
        player: {
            inventory: ['item_rocket', 'shield'],
            selectedItemIndex: 0,
            itemUseCooldownRemaining: 0.5,
            shootCooldown: 0.4,
        },
        modeType: 'HUNT',
        showMg: true,
    });
    // Legacy frames carry the rocket inside inventory: it moves to the rocket action.
    assert.equal(projectedInventoryState.type, 'SHIELD');
    assert.equal(projectedInventoryState.nextRocketType, 'ROCKET_WEAK');
    assert.equal(projectedInventoryState.hasItem, true);
    assert.equal(projectedInventoryState.canUse, true);
    assert.equal(projectedInventoryState.canUseNow, false);
    assert.equal(projectedInventoryState.canShoot, true);
    assert.equal(projectedInventoryState.canShootNow, false);
    assert.equal(projectedInventoryState.canCycle, false);
    assert.equal(projectedInventoryState.showMg, true);
    assert.equal(projectedInventoryState.actionHintLabel, 'USE');
});

test('Portal- und Gate-Runtimes liefern standardisierte Traversal-Result-Codes', () => {
    const portalArena = {
        portalsEnabled: true,
        portals: [{
            posA: new THREE.Vector3(0, 0, 0),
            posB: new THREE.Vector3(12, 0, 0),
            cooldowns: new Map(),
            meshA: null,
            meshB: null,
        }],
        exitPortals: [{
            pos: new THREE.Vector3(4, 0, 0),
            active: true,
            cooldowns: new Map(),
            mesh: null,
        }],
    };
    const portalRuntime = new PortalRuntimeSystem(portalArena);

    const travel = portalRuntime.checkPortal(new THREE.Vector3(0, 0, 0), 0.1, 'qa-portal');
    assert.equal(travel.ok, true);
    assert.equal(travel.code, GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL);
    assert.equal(travel.mode, 'portal');
    assert.equal(travel.type, 'PORTAL');
    assert.ok(travel.cooldownSeconds > 0);

    const travelCooldown = portalRuntime.checkPortal(new THREE.Vector3(0, 0, 0), 0.1, 'qa-portal');
    assert.equal(travelCooldown.ok, false);
    assert.equal(travelCooldown.code, GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL_COOLDOWN);
    assert.equal(travelCooldown.blockedReason, 'cooldown');
    assert.ok(travelCooldown.cooldownRemaining > 0);

    const exitTrigger = portalRuntime.checkExitPortal(new THREE.Vector3(4, 0, 0), 0.1, 'qa-exit');
    assert.equal(exitTrigger.ok, true);
    assert.equal(exitTrigger.code, GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_TRIGGER);
    assert.equal(exitTrigger.type, 'EXIT_PORTAL');
    assert.ok(exitTrigger.cooldownSeconds > 0);

    const exitCooldown = portalRuntime.checkExitPortal(new THREE.Vector3(4, 0, 0), 0.1, 'qa-exit');
    assert.equal(exitCooldown.ok, false);
    assert.equal(exitCooldown.code, GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_COOLDOWN);
    assert.equal(exitCooldown.blockedReason, 'cooldown');

    portalArena.portalsEnabled = false;
    const portalInactive = portalRuntime.checkPortal(new THREE.Vector3(0, 0, 0), 0.1, 'qa-other');
    assert.equal(portalInactive.ok, false);
    assert.equal(portalInactive.code, GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL_INACTIVE);
    assert.equal(portalInactive.inactiveReason, 'portals-disabled');

    const exitInactive = portalRuntime.checkExitPortal(new THREE.Vector3(4, 0, 0), 0.1, 'qa-other');
    assert.equal(exitInactive.ok, false);
    assert.equal(exitInactive.code, GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_INACTIVE);
    assert.equal(exitInactive.inactiveReason, 'portals-disabled');

    const gateArena = {
        specialGates: [{
            pos: new THREE.Vector3(0, 0, 0),
            radius: 1,
            cooldowns: new Map(),
            type: 'boost',
            params: { cooldown: 1.5 },
            forward: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
            mesh: null,
        }, {
            pos: new THREE.Vector3(10, 0, 0),
            radius: 1,
            cooldowns: new Map(),
            type: 'slingshot',
            params: { cooldown: 2 },
            forward: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
            mesh: null,
        }],
    };
    const gateRuntime = new SpecialGateRuntime(gateArena);

    const boostGate = gateRuntime.checkSpecialGates(
        new THREE.Vector3(0.5, 0, 0),
        new THREE.Vector3(-0.5, 0, 0),
        0.6,
        'qa-gate'
    );
    assert.equal(boostGate.ok, true);
    assert.equal(boostGate.code, GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_BOOST);
    assert.equal(boostGate.mode, 'gate');
    assert.equal(boostGate.type, 'BOOST');
    assert.equal(boostGate.cooldownSeconds, 1.5);

    const gateCooldown = gateRuntime.checkSpecialGates(
        new THREE.Vector3(0.5, 0, 0),
        new THREE.Vector3(-0.5, 0, 0),
        0.6,
        'qa-gate'
    );
    assert.equal(gateCooldown.ok, false);
    assert.equal(gateCooldown.code, GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_COOLDOWN);
    assert.equal(gateCooldown.blockedReason, 'cooldown');

    const slingshotGate = gateRuntime.checkSpecialGates(
        new THREE.Vector3(10.5, 0, 0),
        new THREE.Vector3(9.5, 0, 0),
        0.6,
        'qa-gate-2'
    );
    assert.equal(slingshotGate.ok, true);
    assert.equal(slingshotGate.code, GAMEPLAY_ACTION_RESULT_CODES.GATE_TRIGGER_SLINGSHOT);
    assert.equal(slingshotGate.type, 'SLINGSHOT');
});

test('Portal layout counts endpoints, prefers authored pairs, and keeps editor visuals', () => {
    const scene = new THREE.Scene();
    const renderer = {
        addToScene(object) { scene.add(object); },
        removeFromScene(object) { scene.remove(object); },
    };
    const arena = {
        renderer,
        portalsEnabled: true,
        currentMapKey: 'standard',
        bounds: { minX: -100, maxX: 100, minY: -50, maxY: 50, minZ: -100, maxZ: 100 },
        checkCollision: () => false,
        entityRuntimeConfig: createEntityRuntimeConfig({
            gameplay: { portalCount: 8, planarMode: false, planarLevelCount: 5 },
        }, CONFIG_BASE),
    };
    const builder = new PortalLayoutBuilder(arena);

    builder.build({ portals: [] }, 1);
    assert.equal(arena.portals.length, 4);

    arena.entityRuntimeConfig = createEntityRuntimeConfig({
        gameplay: { portalCount: 20, planarMode: false, planarLevelCount: 5 },
    }, CONFIG_BASE);
    builder.build({ portals: [] }, 1);
    assert.equal(arena.portals.length, 10);

    builder.build({
        portals: [{
            a: [-20, 0, 0],
            b: [20, 0, 0],
            modelA: 'portal_triangle',
            modelB: 'portal_star',
            rotationA: [0, Math.PI / 2, 0],
            rotationB: [0, 0, 0],
        }],
    }, 1);
    assert.equal(arena.portals.length, 1);
    assert.equal(arena.portals[0].meshA.userData.visualType, 'portal_triangle');
    assert.equal(arena.portals[0].meshB.userData.visualType, 'portal_star');
    assert.ok(arena.portals[0].forwardA.distanceTo(new THREE.Vector3(1, 0, 0)) < 0.0001);

    arena.checkCollision = () => true;
    builder.build({ portals: [{ a: [-20, 0, 0], b: [20, 0, 0] }] }, 1);
    assert.equal(arena.portals.length, 0);
    assert.ok(arena.portalLayoutWarnings.length > 0);
});

test('Planar portal layout honors menu counts and puts a portal on the spawn level', () => {
    const scene = new THREE.Scene();
    const renderer = {
        addToScene(object) { scene.add(object); },
        removeFromScene(object) { scene.remove(object); },
    };
    const arena = {
        renderer,
        portalsEnabled: true,
        currentMapKey: 'standard',
        bounds: { minX: -100, maxX: 100, minY: 0, maxY: 120, minZ: -100, maxZ: 100 },
        checkCollision: () => false,
        entityRuntimeConfig: createEntityRuntimeConfig({
            gameplay: { portalCount: 2, planarMode: true, planarLevelCount: 6 },
        }, CONFIG_BASE),
    };
    const builder = new PortalLayoutBuilder(arena);
    const authoredMap = {
        preferAuthoredPortals: true,
        portalLevels: [10, 30, 50],
        portals: [{
            a: [-20, 10, 0],
            b: [20, 10, 0],
            modelA: 'portal_triangle',
            modelB: 'portal_star',
        }],
    };

    builder.build(authoredMap, 2);

    const levels = builder.getPortalLevels();
    assert.equal(levels.length, 6);
    assert.deepEqual(levels, [20, 36, 52, 68, 84, 100]);
    assert.equal(arena.portals.length, 1);
    assert.equal(
        arena.portals[0].posA.y === 52 || arena.portals[0].posB.y === 52,
        true,
        'the first dynamic pair must touch the level nearest the arena midpoint'
    );
    assert.notEqual(arena.portals[0].meshA.userData.visualType, 'portal_triangle');

    arena.entityRuntimeConfig = createEntityRuntimeConfig({
        gameplay: { portalCount: 6, planarMode: true, planarLevelCount: 2 },
    }, CONFIG_BASE);
    builder.build(authoredMap, 2);

    assert.deepEqual(builder.getPortalLevels(), [20, 100]);
    assert.equal(arena.portals.length, 3);
    assert.ok(arena.portals.every((portal) => (
        [20, 100].includes(portal.posA.y) && [20, 100].includes(portal.posB.y)
    )));
});

test('Oriented portals rotate traversal direction and require a plane crossing', () => {
    const arena = {
        portalsEnabled: true,
        portals: [{
            posA: new THREE.Vector3(0, 0, 0),
            posB: new THREE.Vector3(20, 0, 0),
            forwardA: new THREE.Vector3(1, 0, 0),
            forwardB: new THREE.Vector3(0, 0, 1),
            cooldowns: new Map(),
            meshA: null,
            meshB: null,
        }],
        exitPortals: [],
    };
    const runtime = new PortalRuntimeSystem(arena);
    const missed = runtime.checkPortal(
        new THREE.Vector3(-0.2, 0, 0),
        0.1,
        'oriented-miss',
        new THREE.Vector3(-0.4, 0, 0)
    );
    assert.equal(missed, null);

    const travel = runtime.checkPortal(
        new THREE.Vector3(0.2, 0, 0),
        0.1,
        'oriented-hit',
        new THREE.Vector3(-0.2, 0, 0)
    );
    assert.equal(travel.ok, true);
    assert.ok(travel.exitForward.distanceTo(new THREE.Vector3(0, 0, 1)) < 0.0001);
    assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(travel.rotation).distanceTo(travel.exitForward) < 0.0001);
});

test('Player interaction applies oriented portal exit position and rotation', () => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const entityManager = {
        arena: {
            checkExitPortal: () => null,
            checkPortal: () => ({
                target: new THREE.Vector3(10, 2, 5),
                exitForward: new THREE.Vector3(1, 0, 0),
                rotation,
            }),
        },
        powerupManager: { checkPickup: () => null },
        _tmpDir: new THREE.Vector3(),
    };
    const player = {
        index: 0,
        hitboxRadius: 0.5,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        trail: { forceGap() {} },
    };
    new PlayerInteractionPhase(entityManager).runPortalAndPickup(player, new THREE.Vector3(-1, 0, 0));
    assert.ok(player.position.distanceTo(new THREE.Vector3(11.8, 2, 5)) < 0.0001);
    assert.ok(player.quaternion.angleTo(rotation) < 0.0001);
});

test('Projectile traversal IDs remain stable across pool reuse', () => {
    const projectiles = new ProjectileSystem({ entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE) });
    const first = projectiles._acquireProjectileState();
    const firstId = first.traversalId;
    projectiles._releaseProjectileState(first);
    const reused = projectiles._acquireProjectileState();
    assert.match(firstId, /^projectile:\d+$/);
    assert.notEqual(reused.traversalId, firstId);
});

test('Traversal HUD reports personal cooldown and exit readiness', () => {
    const classes = new Set(['hidden']);
    const element = {
        textContent: '',
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    };
    updateTraversalStatus(element, { traversal: { portalCooldownRemaining: 1.25 } });
    assert.equal(element.textContent, 'PORTAL 1.3s');
    assert.equal(classes.has('hidden'), false);
    updateTraversalStatus(element, { traversal: { exitPortal: { activeCount: 1 } } });
    assert.equal(element.textContent, 'EXIT BEREIT');
});

test('HuntBotPolicy erweitert Retreat-Fallback auf Portale und defensive Nicht-Raketen-Items', () => {
    const player = {
        id: 'hunt-bot',
        index: 0,
        alive: true,
        hp: 24,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        inventory: ['SHIELD'],
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) {
            return out.set(0, 0, 1);
        },
    };
    const enemy = {
        id: 'enemy',
        index: 1,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        position: new THREE.Vector3(0, 0, 18),
    };
    const policy = new HuntBotPolicy();
    policy._fallbackPolicy.update = () => ({
        yawLeft: false,
        yawRight: false,
        pitchUp: false,
        pitchDown: false,
        boost: false,
        shootMG: true,
        shootItem: false,
        shootItemIndex: -1,
        useItem: -1,
    });
    policy._fallbackPolicy.getSensorSnapshot = () => ({
        targetYaw: 0.75,
        targetPitch: 0,
        pressure: 0.9,
        projectileThreat: true,
        targetPlayer: enemy,
        targetInFront: true,
        targetDistanceSq: player.position.distanceToSquared(enemy.position),
    });

    const action = policy.update(1 / 60, player, {
        arena: {
            portalsEnabled: true,
            portals: [{
                posA: new THREE.Vector3(-12, 0, 8),
                posB: new THREE.Vector3(26, 0, 18),
                cooldowns: new Map(),
            }],
            specialGates: [],
        },
        players: [player, enemy],
        projectiles: [],
        huntTarget: null,
    });

    assert.equal(action.useItem, 0);
    assert.equal(action.boost, true);
    assert.equal(action.shootMG, false);
    assert.equal(action.shootItem, false);
    assert.equal(action.yawRight, true);
    assert.equal(action.yawLeft, false);
});

test('B04 F6 HuntBotPolicy Retreat-Fallback steuert vom Gegner weg statt frontal zu', () => {
    const player = {
        id: 'hunt-retreat-fallback',
        index: 0,
        alive: true,
        hp: 20,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        inventory: [],
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) {
            return out.set(0, 0, 1);
        },
    };
    const enemy = {
        id: 'enemy-front-right',
        index: 1,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        position: new THREE.Vector3(10, 0, 20),
    };
    const policy = new HuntBotPolicy();
    policy._fallbackPolicy.update = () => ({
        yawLeft: false,
        yawRight: false,
        pitchUp: false,
        pitchDown: false,
        boost: false,
        shootMG: true,
        shootItem: false,
        shootItemIndex: -1,
        useItem: -1,
    });
    policy._fallbackPolicy.getSensorSnapshot = () => null;

    const action = policy.update(1 / 60, player, {
        arena: {
            portalsEnabled: false,
            portals: [],
            specialGates: [],
        },
        players: [player, enemy],
        projectiles: [],
        huntTarget: null,
    });

    assert.equal(action.boost, true);
    assert.equal(action.shootMG, false);
    assert.equal(action.yawRight, true);
    assert.equal(action.yawLeft, false);
});

test('HuntBridgePolicy erweitert Retreat-Fallback auf Gates und defensive Nicht-Raketen-Items', () => {
    const player = {
        id: 'hunt-bridge-bot',
        index: 0,
        alive: true,
        hp: 22,
        maxHp: 100,
        shieldHP: 4,
        maxShieldHp: 100,
        inventory: ['GHOST'],
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) {
            return out.set(0, 0, 1);
        },
    };
    const enemy = {
        id: 'enemy',
        index: 1,
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 100,
        position: new THREE.Vector3(0, 0, 20),
    };
    const observation = new Array(40).fill(0);
    observation[TARGET_DISTANCE_RATIO] = 0.18;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0.88;
    observation[PROJECTILE_THREAT] = 0;

    const policy = new HuntBridgePolicy({
        fallbackPolicy: {
            usesRuntimeContext: true,
            update() {
                return {};
            },
        },
    });
    const action = policy.update(1 / 60, player, {
        arena: {
            portalsEnabled: false,
            portals: [],
            specialGates: [{
                pos: new THREE.Vector3(-10, 0, 0),
                radius: 3,
                cooldowns: new Map(),
            }],
        },
        players: [player, enemy],
        projectiles: [],
        observation,
        observationContext: {
            targetDistanceMax: 120,
        },
        huntTarget: null,
    });

    assert.equal(action.useItem, 0);
    assert.equal(action.boost, true);
    assert.equal(action.shootMG, false);
    assert.equal(action.shootItem, false);
    assert.equal(action.yawRight, true);
    assert.equal(action.yawLeft, false);
});

test('TraversalCooldownOps normalisiert Entity-Keys und liest Cooldowns konsistent', () => {
    assert.equal(normalizeEntityKey(null), '');
    assert.equal(normalizeEntityKey(undefined), '');
    assert.equal(normalizeEntityKey('  player-1  '), 'player-1');
    assert.equal(normalizeEntityKey(42), '42');

    const cooldowns = new Map();
    assert.equal(resolveEntityCooldown(cooldowns, 'player-1'), 0);
    assert.equal(resolveEntityCooldown(null, 'player-1'), 0);

    cooldowns.set('player-1', 2.5);
    assert.equal(resolveEntityCooldown(cooldowns, 'player-1'), 2.5);

    const numericCooldowns = new Map();
    numericCooldowns.set(7, 1.8);
    assert.equal(resolveEntityCooldown(numericCooldowns, '7'), 1.8);
    assert.equal(resolveEntityCooldown(numericCooldowns, 7), 1.8);
    assert.equal(resolveEntityCooldown(numericCooldowns, '99'), 0);
});

test('anchor-only Spawn-Modus ohne Item-Anker erzeugt sichtbare Feedback-Warnung', () => {
    const feedbackWithAnchorOnlyNoItems = deriveMapResolutionFeedbackPlan({
        mapResolution: {
            isFallback: false,
            isCustom: true,
            warnings: [],
            message: null,
            migration: null,
            mapDocument: {},
            mapDefinition: {
                itemSpawnAuthoring: { mode: 'anchor-only' },
                items: [],
            },
        },
        portalsEnabled: true,
    });
    const anchorWarn = feedbackWithAnchorOnlyNoItems.toasts.find(
        (t) => t.message.includes('anchor-only')
    );
    assert.ok(anchorWarn, 'erwartet Toast fuer anchor-only ohne Anker');
    assert.equal(anchorWarn.tone, 'warning');

    const feedbackWithAnchorOnlyAndItems = deriveMapResolutionFeedbackPlan({
        mapResolution: {
            isFallback: false,
            isCustom: true,
            warnings: [],
            message: null,
            migration: null,
            mapDocument: {},
            mapDefinition: {
                itemSpawnAuthoring: { mode: 'anchor-only' },
                items: [{ id: 'item-1', x: 0, y: 0, z: 0 }],
            },
        },
        portalsEnabled: true,
    });
    const noWarn = feedbackWithAnchorOnlyAndItems.toasts.find(
        (t) => t.message.includes('anchor-only')
    );
    assert.equal(noWarn, undefined, 'kein Toast wenn Item-Anker vorhanden');

    const feedbackFallbackRandom = deriveMapResolutionFeedbackPlan({
        mapResolution: {
            isFallback: false,
            isCustom: true,
            warnings: [],
            message: null,
            migration: null,
            mapDocument: {},
            mapDefinition: {
                itemSpawnMode: 'fallback-random',
                items: [],
            },
        },
        portalsEnabled: true,
    });
    const noWarnRandom = feedbackFallbackRandom.toasts.find(
        (t) => t.message.includes('anchor-only')
    );
    assert.equal(noWarnRandom, undefined, 'kein Toast fuer fallback-random ohne Anker');
});

test('Custom map warning toast keeps extra warning fan-out visible', () => {
    const feedback = deriveMapResolutionFeedbackPlan({
        mapResolution: {
            isFallback: false,
            isCustom: true,
            warnings: [
                'Unsupported portalMode "scripted" normalized to "dynamic".',
                'Unknown gate type "boost_plus" normalized to "boost".',
            ],
            message: 'Custom-Map geladen, aber mit Hinweisen normalisiert.',
            migration: null,
        },
        portalsEnabled: true,
    });

    assert.equal(feedback.toasts.length, 1);
    assert.equal(feedback.toasts[0].tone, 'info');
    assert.equal(
        feedback.toasts[0].message,
        'Custom-Map geladen, aber mit Hinweisen normalisiert. (+1 Hinweis(e) in Konsole)'
    );
});

test('Portal placement warnings remain visible after arena build', () => {
    const feedback = deriveMapResolutionFeedbackPlan({
        mapResolution: { isFallback: false, isCustom: false },
        portalsEnabled: true,
        arenaBuildResult: { portalLayoutWarnings: ['Portal pair was skipped because an endpoint overlaps another portal.'] },
    });
    assert.equal(feedback.toasts[0].tone, 'warning');
    assert.match(feedback.toasts[0].message, /Portal-Layout angepasst/);
    assert.equal(feedback.consoleEntries[0].level, 'warn');
});
