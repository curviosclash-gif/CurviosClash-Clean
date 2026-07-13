import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    normalizeEntityKey,
    resolveEntityCooldown,
} from '../src/entities/arena/portal/TraversalCooldownOps.js';

import {
    getRocketPickupTypes,
    isPickupTypeAllowedForMode,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    normalizePickupType,
} from '../src/entities/PickupRegistry.js';
import { createMapDocument } from '../src/entities/MapSchema.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';
import { SpecialGateRuntime } from '../src/entities/arena/portal/SpecialGateRuntime.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
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
    assert.equal(isPickupTypeAllowedForMode('SLOW_TIME', 'CLASSIC'), true);
    assert.equal(isPickupTypeAllowedForMode('SLOW_TIME', 'HUNT'), false);
    assert.equal(isPickupTypeSelfUsable('SHIELD', 'HUNT'), true);
    assert.equal(isPickupTypeShootable('SHIELD', 'HUNT'), true);
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
    const dualAction = resolvePickupActionAvailability({
        type: 'shield',
        modeType: 'hunt',
        useCooldownRemaining: 0.35,
        shootCooldownRemaining: 0.2,
    });
    assert.equal(dualAction.type, 'SHIELD');
    assert.equal(dualAction.canUse, true);
    assert.equal(dualAction.canShoot, true);
    assert.equal(dualAction.canUseNow, false);
    assert.equal(dualAction.canShootNow, false);
    assert.equal(dualAction.useOnCooldown, true);
    assert.equal(dualAction.shootOnCooldown, true);
    assert.equal(dualAction.hasCooldown, true);
    assert.equal(dualAction.actionHintLabel, 'DUAL');

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
    assert.equal(projectedInventoryState.type, 'ROCKET_WEAK');
    assert.equal(projectedInventoryState.hasItem, true);
    assert.equal(projectedInventoryState.canUse, false);
    assert.equal(projectedInventoryState.canShoot, true);
    assert.equal(projectedInventoryState.canShootNow, false);
    assert.equal(projectedInventoryState.canCycle, true);
    assert.equal(projectedInventoryState.showMg, true);
    assert.equal(projectedInventoryState.actionHintLabel, 'SHOT');
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
