import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { emitArcadeGameplayEvent } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { createMissionInstance, updateMissionProgress } from '../src/state/arcade/ArcadeMissionState.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('Arcade health pickups reset Close Call after the player recovers', () => {
    const events = [];
    const entityManager = {
        players: [],
        gameModeStrategy: new ArcadeModeStrategy(),
        onArcadeGameplayEvent: (event) => events.push(event),
        _emitArcadeGameplayEvent(event) {
            emitArcadeGameplayEvent(this, event);
        },
    };
    const player = {
        index: 0,
        isBot: false,
        hp: 15,
        maxHp: 100,
        entityManager,
        entityRuntimeConfig: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG,
            HUNT: {
                ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT,
                ENABLED: false,
                ACTIVE_MODE: 'ARCADE',
            },
        },
    };
    entityManager.players.push(player);

    applyPlayerPowerup(player, 'HEALTH');

    assert.deepEqual(events, [{
        type: 'health_update',
        playerIndex: 0,
        hp: 50,
        maxHp: 100,
    }]);

    let mission = createMissionInstance('CLOSE_CALL', { target: 2 });
    mission = updateMissionProgress(mission, { type: 'damage', hp: 15, maxHp: 100 });
    mission = updateMissionProgress(mission, events[0]);
    mission = updateMissionProgress(mission, { type: 'damage', hp: 10, maxHp: 100 });

    assert.equal(mission.progress.count, 2);
    assert.equal(mission.completed, true);
});

test('Arcade strategy owns passive regeneration: normal runs use the base regen, the daily gauntlet none', () => {
    const player = { alive: true, hp: 20, maxHp: 100, shieldHP: 0, hasShield: false };
    new ArcadeModeStrategy().updateHealthRegen(player, 60 * 60);
    assert.equal(player.hp, 100, 'normal runs heal 2 % max HP per second up to the maximum');

    const dailyPlayer = { alive: true, hp: 20, maxHp: 100, shieldHP: 0, hasShield: false };
    new ArcadeModeStrategy({ isDailyChallenge: true }).updateHealthRegen(dailyPlayer, 60 * 60);
    assert.equal(dailyPlayer.hp, 20, 'the daily challenge keeps regeneration disabled');
});

test('Arcade health pickups do not heal during sudden death', () => {
    const events = [];
    const strategy = new ArcadeModeStrategy();
    strategy.enterSuddenDeath();
    const entityManager = {
        players: [],
        gameModeStrategy: strategy,
        onArcadeGameplayEvent: (event) => events.push(event),
        _emitArcadeGameplayEvent(event) {
            emitArcadeGameplayEvent(this, event);
        },
    };
    const player = {
        index: 0,
        isBot: false,
        hp: 15,
        maxHp: 100,
        entityManager,
        entityRuntimeConfig: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG,
            HUNT: {
                ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT,
                ENABLED: false,
                ACTIVE_MODE: 'ARCADE',
            },
        },
    };
    entityManager.players.push(player);

    applyPlayerPowerup(player, 'HEALTH');

    assert.equal(player.hp, 15);
    assert.deepEqual(events, []);
});
