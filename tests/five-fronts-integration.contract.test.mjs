import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';
import { PlayingStateSystem } from '../src/core/PlayingStateSystem.js';
import { emitArcadeEliminationEvents } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { createEntityRuntimeSystems } from '../src/entities/runtime/EntityRuntimeSystemAssembly.js';
import { createRuntimeProjectionPort } from '../src/shared/runtime/GameRuntimePorts.js';
import { selectArcadeIntermissionChoice } from '../src/ui/MatchFlowTransitionHotspots.js';

test('runtime projection uses the arcade run state only when the builder has no arcade state', () => {
    const arcade = { runType: 'arena_waves', phase: 'upgrade' };
    const facade = { getArcadeRunState: () => arcade };
    const game = {
        state: 'PLAYING',
        runtimeBundle: { state: { entityManager: { players: [] } }, components: { runtimeFacade: facade } },
    };
    const projection = createRuntimeProjectionPort(game).getMatchRuntimeProjection();
    assert.equal(projection.arcade, arcade);
});

test('runtime projection keeps a builder-provided arcade state ahead of the fallback', () => {
    const builtArcade = { runType: 'endless_parcours' };
    let fallbackCalls = 0;
    const game = {
        state: 'PLAYING',
        runtimeBundle: {
            state: { entityManager: { players: [], endlessParcoursRuntime: { getHudState: () => builtArcade } } },
            components: { runtimeFacade: { getArcadeRunState: () => { fallbackCalls += 1; return { runType: 'arena_waves' }; } } },
        },
    };
    assert.equal(createRuntimeProjectionPort(game).getMatchRuntimeProjection().arcade.runType, builtArcade.runType);
    assert.equal(fallbackCalls, 0);
});

test('runtime projection ignores non-arena fallback state', () => {
    const game = {
        state: 'PLAYING',
        runtimeBundle: {
            state: { entityManager: { players: [] } },
            components: { runtimeFacade: { getArcadeRunState: () => ({ runType: 'gauntlet' }) } },
        },
    };
    assert.equal(createRuntimeProjectionPort(game).getMatchRuntimeProjection().arcade, null);
});

test('arena-waves upgrade pauses simulation while keeping HUD and changed overlay state synchronized', () => {
    const calls = [];
    const arenaState = { runType: 'arena_waves', phase: 'upgrade', mapIndex: 2, choices: ['a', 'b', 'c', 'd'] };
    const system = new PlayingStateSystem({
        getEntityManager: () => ({ update() { calls.push('entity'); } }),
        getArcadeMenuSurfaceState: () => arenaState,
        actionSyncArcadeOverlay() { calls.push('overlay'); },
        actionTickSuddenDeath() { calls.push('arcade'); },
        actionUpdatePlayingHudTick() { calls.push('hud'); },
        getRuntimeProjectionPort: () => ({ getMatchRuntimeProjection: () => ({}) }),
        actionApplyPlayingTimeScaleFromEffects() { calls.push('effects'); },
    });
    system.update(1 / 60);
    system.update(1 / 60);
    assert.deepEqual(calls, ['overlay', 'hud', 'hud']);
    arenaState.phase = 'countdown';
    arenaState.choices = [];
    system.update(1 / 60);
    assert.deepEqual(calls.slice(-5), ['overlay', 'entity', 'arcade', 'hud', 'effects']);
});

test('intermission selection immediately synchronizes the overlay', () => {
    let syncs = 0;
    const result = selectArcadeIntermissionChoice({ selectArcadeIntermissionChoice: () => ({ ok: true }) }, {
        matchFlowUiController: { _syncArcadeOverlayPanel() { syncs += 1; } },
    }, 'speed');
    assert.deepEqual(result, { ok: true });
    assert.equal(syncs, 1);
});

test('only arena-waves emits a neutral bot elimination without a human killer', () => {
    const events = [];
    const arenaOwner = {
        runtimeConfig: { arcade: { enabled: true, runType: 'arena_waves' } },
        onArcadeGameplayEvent(event) { events.push(event); },
    };
    emitArcadeEliminationEvents(arenaOwner, { index: 7, isBot: true }, 'TRAIL_SELF');
    assert.deepEqual(events, [{ type: 'kill', victimIndex: 7, count: 0, runId: '', botSlot: null, activationGeneration: null }]);
    emitArcadeEliminationEvents({ ...arenaOwner, runtimeConfig: { arcade: { enabled: true, runType: 'gauntlet' } } }, { index: 8, isBot: true }, 'TRAIL_SELF');
    assert.equal(events.length, 1);
});

test('arena-waves suppresses round elimination between waves but still ends on human death', () => {
    const human = { index: 0, isBot: false, alive: true };
    const bot = { index: 1, isBot: true, alive: false };
    const owner = {
        players: [human, bot], humanPlayers: [human], bots: [{ player: bot }],
        runtimeConfig: { arcade: { enabled: true, runType: 'arena_waves' } },
    };
    const outcome = createEntityRuntimeSystems(owner, {}).roundOutcomeSystem;
    assert.equal(outcome.resolve().shouldEnd, false);
    human.alive = false;
    assert.equal(outcome.resolve().shouldEnd, true);
});

test('arena-waves menu state retains total fields and exposes score aliases', () => {
    const facade = Object.create(GameRuntimeFacade.prototype);
    facade._arcadeSupport = {
        getMenuSurfaceState: () => ({
            runType: 'arena_waves',
            records: { bestTotal: 42, lastTotal: 13 },
            postRunSummary: { total: 13 },
        }),
    };
    const state = facade.getArcadeMenuSurfaceState();
    assert.deepEqual(state.records, { bestTotal: 42, lastTotal: 13, bestScore: 42, lastScore: 13 });
    assert.deepEqual(state.postRunSummary, { total: 13, score: 13 });
});
