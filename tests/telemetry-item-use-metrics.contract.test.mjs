// ============================================
// telemetry-item-use-metrics.contract.test.mjs
// ============================================
//
// Zwei getrennte Fragen an dieselbe Kennzahl:
// 1. "Items pro Runde" muss Item-Einsaetze zaehlen. MG-Schuesse liegen drei
//    Groessenordnungen darueber (48040 gegen 574 in einem HUNT-Langlauf) und
//    ueberdecken jede Balancing-Aussage, solange sie mitgezaehlt werden.
// 2. Ein ITEM_USE-Ereignis darf nur dann UNKNOWN melden, wenn wirklich kein
//    Item im Zugriff war. Cooldown- und EMP-Absagen kennen ihr Item.

import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { GAMEPLAY_ACTION_RESULT_CODES, parseGameplayActionResultLog } from '../src/shared/contracts/GameplayActionResultContract.js';
import { RoundMetricsStore } from '../src/state/recorder/RoundMetricsStore.js';
import { computeTelemetryHistorySummary } from '../src/state/telemetry/TelemetryHistorySummary.js';
import { normalizeTelemetrySnapshot } from '../src/core/settings/SettingsTelemetryFacade.js';

function createHuntRuntimeConfig() {
    return createEntityRuntimeConfig(null, {
        POWERUP: { TYPES: { SHIELD: {}, ROCKET_WEAK: {} } },
        HUNT: { ENABLED: true, ACTIVE_MODE: 'HUNT', ITEM_USE_COOLDOWN_SECONDS: 0.15 },
    });
}

function createRecorderSpy() {
    const events = [];
    return {
        events,
        logEvent(type, playerIndex, data) {
            events.push({ type, playerIndex, ...parseGameplayActionResultLog(data) });
        },
    };
}

test('Rundenkennzahl trennt Item-Einsaetze von MG-Schuessen', () => {
    const metrics = new RoundMetricsStore({ timeProvider: () => 60 });
    metrics.startRound([]);
    for (let i = 0; i < 400; i++) {
        metrics.registerEventType('ITEM_USE', 'mode=mg type=MG_BULLET code=mg.shoot.success ok=1');
    }
    metrics.registerEventType('ITEM_USE', 'mode=mg type=MG_BULLET code=mg.shoot.cooldown ok=0');
    metrics.registerEventType('ITEM_USE', 'mode=use type=SHIELD code=item.use.success ok=1');
    metrics.registerEventType('ITEM_USE', 'mode=shoot type=ROCKET_WEAK code=item.shoot.success ok=1');
    metrics.registerEventType('ITEM_USE', 'mode=other type=UNKNOWN code=item.use.empty ok=0');
    metrics.finalizeRound(null, []);

    const aggregate = metrics.getAggregateMetrics();
    assert.equal(aggregate.itemUsePerRound, 404);
    assert.equal(aggregate.itemUseWithoutMgPerRound, 3);
    assert.equal(aggregate.itemUseModePerRound.mg, 401, 'MG attempts stay in the separate MG counter');
});

test('Historien-Zusammenfassung liefert Items pro Runde ohne MG aus bereits gespeicherten Runden', () => {
    const summary = computeTelemetryHistorySummary([
        {
            duration: 120,
            itemUses: 5000,
            itemUseByMode: { use: 4, shoot: 6, mg: 4990, other: 0 },
            itemUseByType: { MG_BULLET: 4990, SHIELD: 4, ROCKET_WEAK: 6 },
        },
        {
            duration: 120,
            itemUses: 3000,
            itemUseByMode: { use: 2, shoot: 8, mg: 2990, other: 0 },
            itemUseByType: { MG_BULLET: 2990, SHIELD: 2, ROCKET_WEAK: 8 },
        },
    ]);

    assert.equal(summary.rounds, 2);
    assert.equal(summary.itemUsesPerRound, 4000);
    assert.equal(summary.itemUsesWithoutMgPerRound, 10);
    assert.equal(computeTelemetryHistorySummary([]).itemUsesWithoutMgPerRound, 0);
});

test('Menue-Telemetrie meldet Items pro Runde ohne MG fuer Gesamtwert und Buckets', () => {
    const snapshot = normalizeTelemetrySnapshot({
        balanceSummary: {
            rounds: 2,
            totalItemUses: 8000,
            totalItemUseModeCounts: { use: 6, shoot: 14, mg: 7980, other: 0 },
            maps: {
                mega_maze: {
                    rounds: 2,
                    totalItemUses: 8000,
                    totalItemUseModeCounts: { use: 6, shoot: 14, mg: 7980, other: 0 },
                },
            },
        },
    });

    assert.equal(snapshot.balance.itemUsesPerRound, 4000);
    assert.equal(snapshot.balance.itemUsesWithoutMgPerRound, 10);
    assert.equal(snapshot.topMaps[0].itemUsesWithoutMgPerRound, 10);
});

test('EMP-Absage protokolliert den blockierten Item-Typ statt UNKNOWN', () => {
    const recorder = createRecorderSpy();
    const huntCombat = new HuntCombatSystem({
        entityRuntimeConfig: createHuntRuntimeConfig(),
        callbacks: { getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig: createHuntRuntimeConfig() }) },
    });
    const entityManager = {
        recorder,
        _peekInventoryItem: (player, preferredIndex, action) => huntCombat.peekInventoryItem(player, preferredIndex, action),
        _useInventoryItem: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootItemProjectile: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const phase = new PlayerActionPhase(entityManager);
    const strategy = { requiresShootItemIndex: () => false, hasMachineGun: () => true };

    const usePlayer = {
        index: 0,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['SHIELD'],
        selectedItemIndex: 0,
        cycleItem() {},
        dropItem() {},
    };
    phase.run(usePlayer, { useItem: 0, shootItem: false, shootMG: false }, strategy);

    const shootPlayer = {
        index: 1,
        isBot: true,
        itemActionsDisabled: true,
        inventory: [],
        rocketInventory: ['ROCKET_WEAK'],
        selectedItemIndex: 0,
        cycleItem() {},
        dropItem() {},
    };
    phase.run(shootPlayer, { useItem: -1, shootItem: false, shootRocket: true, shootMG: false }, strategy);

    assert.equal(recorder.events.length, 2);
    assert.deepEqual(
        recorder.events.map((event) => [event.mode, event.type, event.code]),
        [
            ['use', 'SHIELD', GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_DISABLED],
            ['shoot', 'ROCKET_WEAK', GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_DISABLED],
        ]
    );
});

test('EMP telemetry preview leaves legacy inventory and selection untouched', () => {
    const recorder = createRecorderSpy();
    const entityManager = {
        recorder,
        _useInventoryItem: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootItemProjectile: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const player = {
        index: 0,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['ROCKET_WEAK'],
        selectedItemIndex: 4,
        cycleItem() {},
        dropItem() {},
    };

    new PlayerActionPhase(entityManager).run(player, { useItem: 0, shootItem: false, shootMG: false }, {
        requiresShootItemIndex: () => false,
        hasMachineGun: () => true,
    });

    assert.deepEqual(player.inventory, ['ROCKET_WEAK']);
    assert.equal(Object.hasOwn(player, 'rocketInventory'), false);
    assert.equal(player.selectedItemIndex, 4);
    assert.equal(recorder.events[0].type, 'UNKNOWN', 'a legacy rocket is virtually moved out of selectable items');
});

test('EMP telemetry preview virtually migrates legacy rockets without mutation', () => {
    const recorder = createRecorderSpy();
    const entityManager = {
        recorder,
        _useInventoryItem: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootItemProjectile: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const strategy = { requiresShootItemIndex: () => false, hasMachineGun: () => true };
    const usePlayer = {
        index: 0,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['ROCKET_WEAK', 'SHIELD'],
        selectedItemIndex: 1,
        cycleItem() {},
        dropItem() {},
    };
    const shootPlayer = {
        index: 1,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['ROCKET_WEAK'],
        selectedItemIndex: 0,
        cycleItem() {},
        dropItem() {},
    };
    const selectedPlayer = {
        index: 2,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['ROCKET_WEAK', 'SHIELD', 'EMP'],
        selectedItemIndex: 3,
        cycleItem() {},
        dropItem() {},
    };
    const phase = new PlayerActionPhase(entityManager);

    phase.run(usePlayer, { useItem: 0, shootItem: false, shootMG: false }, strategy);
    phase.run(shootPlayer, { useItem: -1, shootItem: false, shootRocket: true, shootMG: false }, strategy);
    phase.run(selectedPlayer, { useItem: -1, shootItem: true, shootMG: false }, strategy);

    assert.deepEqual(
        recorder.events.map((event) => [event.mode, event.type]),
        [['use', 'SHIELD'], ['shoot', 'ROCKET_WEAK'], ['shoot', 'SHIELD']]
    );
    assert.deepEqual(usePlayer.inventory, ['ROCKET_WEAK', 'SHIELD']);
    assert.deepEqual(shootPlayer.inventory, ['ROCKET_WEAK']);
    assert.equal(Object.hasOwn(shootPlayer, 'rocketInventory'), false);
    assert.equal(selectedPlayer.selectedItemIndex, 3, 'telemetry keeps the legacy selection untouched');
});

// Der Stellvertreter fuer die Slot-Faelle: EMP blockt die Aktion, bevor ein Item
// gelesen wird. Genau dann fuellt die Vorschau den Typ des Ereignisses, und nur
// dann entscheidet der uebergebene Slot, welches Item die Statistik bucht.
function logBlockedShootType(shootInput) {
    const recorder = createRecorderSpy();
    const entityManager = {
        recorder,
        _useInventoryItem: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootItemProjectile: () => { throw new Error('darf bei EMP nicht aufgerufen werden'); },
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const player = {
        index: 0,
        isBot: true,
        itemActionsDisabled: true,
        inventory: ['SHIELD', 'EMP'],
        selectedItemIndex: 1,
        cycleItem() {},
        dropItem() {},
    };

    new PlayerActionPhase(entityManager).run(player, { shootItem: true, shootMG: false, ...shootInput }, {
        requiresShootItemIndex: () => false,
        hasMachineGun: () => true,
    });

    assert.equal(recorder.events.length, 1);
    return recorder.events[0].type;
}

test('Ein unsinniger Item-Slot bucht kein Item statt des gerade gewaehlten', () => {
    for (const brokenIndex of [Number.NaN, 1.5, '2', -2, Number.POSITIVE_INFINITY]) {
        assert.equal(
            logBlockedShootType({ shootItemIndex: brokenIndex }),
            'UNKNOWN',
            `slot ${String(brokenIndex)} is no slot at all and must not book the selected item`
        );
    }
});

test('Ein fehlender Item-Slot bleibt die vereinbarte Bitte um den gewaehlten Platz', () => {
    assert.equal(logBlockedShootType({ shootItemIndex: -1 }), 'EMP', '-1 asks for the selected slot');
    assert.equal(logBlockedShootType({}), 'EMP', 'a missing slot asks for the selected slot');
    assert.equal(logBlockedShootType({ shootItemIndex: 0 }), 'SHIELD', 'a real slot wins over the selection');
    assert.equal(logBlockedShootType({ shootItemIndex: 5 }), 'UNKNOWN', 'a slot beyond the inventory books nothing');
});

test('Leeres Inventar bleibt UNKNOWN, weil dort wirklich kein Item feststeht', () => {
    const recorder = createRecorderSpy();
    const huntCombat = new HuntCombatSystem({
        entityRuntimeConfig: createHuntRuntimeConfig(),
        callbacks: { getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig: createHuntRuntimeConfig() }) },
    });
    const entityManager = {
        recorder,
        _peekInventoryItem: (player, preferredIndex, action) => huntCombat.peekInventoryItem(player, preferredIndex, action),
        _useInventoryItem: (player, preferredIndex) => huntCombat.useInventoryItem(player, preferredIndex),
        _shootItemProjectile: () => null,
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const phase = new PlayerActionPhase(entityManager);
    const player = {
        index: 0,
        isBot: true,
        itemActionsDisabled: false,
        inventory: [],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 0,
        cycleItem() {},
        dropItem() {},
    };

    phase.run(player, { useItem: 0, shootItem: false, shootMG: false }, {
        requiresShootItemIndex: () => false,
        hasMachineGun: () => true,
    });

    assert.equal(recorder.events.length, 1);
    assert.equal(recorder.events[0].type, 'UNKNOWN');
    assert.equal(recorder.events[0].code, GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_EMPTY);
});

test('Item-Cooldown protokolliert den wartenden Item-Typ', () => {
    const entityRuntimeConfig = createHuntRuntimeConfig();
    const recorder = createRecorderSpy();
    const huntCombat = new HuntCombatSystem({
        entityRuntimeConfig,
        callbacks: { getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }) },
    });
    const entityManager = {
        recorder,
        _peekInventoryItem: (player, preferredIndex, action) => huntCombat.peekInventoryItem(player, preferredIndex, action),
        _useInventoryItem: (player, preferredIndex) => huntCombat.useInventoryItem(player, preferredIndex),
        _shootItemProjectile: () => null,
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const player = {
        index: 0,
        isBot: true,
        itemActionsDisabled: false,
        inventory: ['SHIELD'],
        selectedItemIndex: 0,
        itemUseCooldownRemaining: 0.12,
        cycleItem() {},
        dropItem() {},
    };

    new PlayerActionPhase(entityManager).run(player, { useItem: 0, shootItem: false, shootMG: false }, {
        requiresShootItemIndex: () => false,
        hasMachineGun: () => true,
    });

    assert.equal(recorder.events.length, 1);
    assert.equal(recorder.events[0].code, GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_COOLDOWN);
    assert.equal(recorder.events[0].type, 'SHIELD');
    assert.equal(player.inventory.length, 1, 'die Vorschau darf das Inventar nicht anfassen');
});

test('Schuss-Cooldown protokolliert den wartenden Item-Typ', () => {
    const entityRuntimeConfig = createHuntRuntimeConfig();
    const recorder = createRecorderSpy();
    const huntCombat = new HuntCombatSystem({
        entityRuntimeConfig,
        callbacks: { getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }) },
    });
    const projectiles = new ProjectileSystem({
        entityRuntimeConfig,
        players: [],
        arena: { getCollisionInfo: () => null },
        peekInventoryItem: (player, preferredIndex, action) => huntCombat.peekInventoryItem(player, preferredIndex, action),
        takeInventoryItem: () => { throw new Error('darf im Cooldown nicht aufgerufen werden'); },
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });
    const entityManager = {
        recorder,
        _peekInventoryItem: (player, preferredIndex, action) => huntCombat.peekInventoryItem(player, preferredIndex, action),
        _useInventoryItem: () => null,
        _shootItemProjectile: (player, preferredIndex, rocketOnly) => projectiles.shootItemProjectile(player, preferredIndex, rocketOnly),
        _shootHuntGun: () => ({ ok: true, type: 'MG_BULLET' }),
        _notifyPlayerFeedback: () => {},
    };
    const player = {
        index: 0,
        isBot: true,
        itemActionsDisabled: false,
        inventory: [],
        rocketInventory: ['ROCKET_WEAK'],
        selectedItemIndex: 0,
        shootCooldown: 0.4,
        cycleItem() {},
        dropItem() {},
    };

    new PlayerActionPhase(entityManager).run(player, { useItem: -1, shootItem: false, shootRocket: true, shootMG: false }, {
        requiresShootItemIndex: () => true,
        hasMachineGun: () => true,
    });

    assert.equal(recorder.events.length, 1);
    assert.equal(recorder.events[0].code, GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_COOLDOWN);
    assert.equal(recorder.events[0].type, 'ROCKET_WEAK');
});
