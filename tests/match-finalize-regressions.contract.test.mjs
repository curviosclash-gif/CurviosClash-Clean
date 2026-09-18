import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MatchLifecycleSessionOrchestrator } from '../src/state/MatchLifecycleSessionOrchestrator.js';
import { createFallbackSessionRuntimeState } from '../src/state/MatchLifecycleSessionRuntimeState.js';
import { createRuntimeProjectionPort } from '../src/shared/runtime/GameRuntimePorts.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { SESSION_RUNTIME_STATES } from '../src/shared/contracts/SessionRuntimeStateMachine.js';
import { recordSessionRuntimeEvent } from '../src/shared/runtime/SessionRuntimeObservability.js';
import { finalizeMatchFlow } from '../src/core/runtime/MatchFinalizeFlowService.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): the finalize paths run on
// hand-built dependency objects only. The spec reached the modules via
// `import('/src/...')`, which the built dist-app renderer cannot resolve.

test('V87.2 createMatchSession aborts when a new-match finalize is overtaken by return-to-menu', async () => {
    let resolveFinalize = null;
    let prepareCalls = 0;
    const lifecycleEvents = [];
    let currentSession = {
        arena: { id: 'arena' },
        entityManager: { players: [], getHumanPlayers() { return []; } },
        powerupManager: { clear() { } },
    };
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent(type, context) {
            lifecycleEvents.push({ type, reason: context?.reason || null });
        },
        prepareInitializedMatchSession: () => {
            prepareCalls += 1;
            return Promise.resolve({
                session: { id: 'should-not-start', effectiveMapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3 },
            });
        },
        wireInitializedMatchRuntime: (m) => ({ ...m, runtime: {} }),
        applyInitializedMatchSession() { },
        getCurrentMatchSessionRefs: () => currentSession,
        clearMatchSessionRefs: () => { currentSession = null; },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession: () => { currentSession = null; },
        settleRecorder: () => new Promise((resolve) => {
            resolveFinalize = () => resolve(true);
        }),
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    const startPromise = orchestrator.createMatchSession({});
    const mergedFinalizePromise = orchestrator.finalizeMatchSession({
        reason: 'return_to_menu',
        notifyMenuOpened: true,
    });
    resolveFinalize();

    let startError = null;
    try {
        await startPromise;
    } catch (error) {
        startError = error?.message || null;
    }
    const mergedReason = await mergedFinalizePromise;
    const result = {
        startError,
        mergedReason,
        prepareCalls,
        lifecycleEvents,
        finalizeState: orchestrator._sessionRuntimeState?.finalize?.status || null,
    };

    assert.strictEqual(result.startError, 'match_start_blocked:return_to_menu');
    assert.strictEqual(result.mergedReason, 'return_to_menu');
    assert.strictEqual(result.prepareCalls, 0);
    assert.strictEqual(result.finalizeState, 'finalized');
    assert.strictEqual(result.lifecycleEvents.some((entry) => entry.type === 'menu_opened' && entry.reason === 'return_to_menu'), true);
});

test('V87.2 finalize errors stay latched in runtime snapshots until reset', async () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    sessionRuntime.session.activeSessionId = 'match-1';
    sessionRuntime.lifecycle.status = 'playing';
    sessionRuntime.lifecycle.gameStateId = GAME_STATE_IDS.PAUSED;

    let currentSession = {
        arena: { id: 'arena' },
        entityManager: { players: [], getHumanPlayers() { return []; } },
        powerupManager: { clear() { } },
    };
    const orchestrator = new MatchLifecycleSessionOrchestrator({
        getSessionRuntimeState: () => sessionRuntime,
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession() {
            return Promise.resolve({ session: { id: 'unused' } });
        },
        wireInitializedMatchRuntime: (match) => match,
        applyInitializedMatchSession() { },
        getCurrentMatchSessionRefs: () => currentSession,
        clearMatchSessionRefs: () => {
            currentSession = null;
        },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession() {
            currentSession = null;
        },
        settleRecorder() {
            throw new Error('recorder-boom');
        },
        resetRoundRuntime() { },
    });

    let finalizeError = null;
    try {
        await orchestrator.finalizeMatchSession({
            reason: 'return_to_menu',
            notifyMenuOpened: false,
        });
    } catch (error) {
        finalizeError = error?.message || null;
    }

    const runtimeProjectionPort = createRuntimeProjectionPort({
        sessionRuntime,
        state: GAME_STATE_IDS.PAUSED,
    });

    const result = {
        finalizeError,
        finalizeState: sessionRuntime.finalize.status || null,
        finalizeErrorMessage: sessionRuntime.finalize.errorMessage || null,
        pendingFinalize: !!sessionRuntime.finalize.pendingOperation,
        sessionSnapshot: runtimeProjectionPort.getSessionRuntimeSnapshot(),
        matchFlowSnapshot: runtimeProjectionPort.getMatchFlowSnapshot(),
    };

    assert.strictEqual(result.finalizeError, 'recorder-boom');
    assert.strictEqual(result.finalizeState, 'error');
    assert.strictEqual(result.finalizeErrorMessage, 'recorder-boom');
    assert.strictEqual(result.pendingFinalize, false);
    assert.strictEqual(result.sessionSnapshot.finalizeErrorMessage, 'recorder-boom');
    assert.strictEqual(result.sessionSnapshot.pendingFinalizeTrigger, 'return_to_menu');
    assert.strictEqual(result.matchFlowSnapshot.finalizeErrorMessage, 'recorder-boom');
    assert.strictEqual(result.matchFlowSnapshot.canReturnToMenu, false);
});

test('V87.2 finalizeMatchFlow skips prewarm after a failed session finalize', async () => {
    const callLog = [];
    const finalizeResult = await finalizeMatchFlow({
        ports: {
            sessionPort: {
                finalizeMatchSession() {
                    callLog.push('sessionFinalize');
                    return Promise.reject(new Error('finalize-boom'));
                },
            },
        },
        scheduleMatchPrewarm() {
            callLog.push('schedulePrewarm');
        },
    }, {
        reason: 'return_to_menu',
    }, 'return_to_menu');

    const result = {
        finalizeResult,
        callLog,
    };

    assert.strictEqual(result.finalizeResult, false);
    assert.ok(result.callLog.includes('sessionFinalize'));
    assert.ok(!result.callLog.includes('schedulePrewarm'));
});

test('V87.4 MatchLifecycleSessionOrchestrator keeps cleanup in FINALIZING until match_finalized is recorded', async () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    sessionRuntime.session.sequence = 1;
    sessionRuntime.session.activeSessionId = 'match-1';
    sessionRuntime.lifecycle.status = SESSION_RUNTIME_STATES.PLAYING;
    sessionRuntime.lifecycle.gameStateId = GAME_STATE_IDS.PLAYING;

    const cleanupSnapshots = [];
    const lifecycleEvents = [];
    const orchestrator = new MatchLifecycleSessionOrchestrator({
        getSessionRuntimeState() {
            return sessionRuntime;
        },
        getLifecycleState() {
            return {};
        },
        notifyLifecycleEvent(type, payload = {}) {
            lifecycleEvents.push({
                type,
                reason: payload?.reason || '',
            });
        },
        recordRuntimeEvent(type, payload, source, extra) {
            recordSessionRuntimeEvent(sessionRuntime, {
                type,
                payload,
                source,
                ...extra,
            });
        },
        getCurrentMatchSessionRefs() {
            return null;
        },
        clearMatchSessionRefs() {
            cleanupSnapshots.push({
                phase: 'clear',
                lifecycleState: sessionRuntime.lifecycle.status,
                finalizeState: sessionRuntime.finalize.status,
            });
        },
        disposeCurrentMatchSession() {
            cleanupSnapshots.push({
                phase: 'dispose',
                lifecycleState: sessionRuntime.lifecycle.status,
                finalizeState: sessionRuntime.finalize.status,
            });
        },
        settleRecorder() {
            cleanupSnapshots.push({
                phase: 'settle',
                lifecycleState: sessionRuntime.lifecycle.status,
                finalizeState: sessionRuntime.finalize.status,
            });
        },
        resetRoundRuntime() { },
        prepareInitializedMatchSession() {
            return null;
        },
        wireInitializedMatchRuntime(initializedMatch) {
            return initializedMatch;
        },
        applyInitializedMatchSession() { },
        disposePreparedMatchSession() { },
    });

    await orchestrator.finalizeMatchSession({
        reason: 'return_to_menu',
        notifyMenuOpened: true,
    });

    const eventTypes = Array.isArray(sessionRuntime.observability?.events)
        ? sessionRuntime.observability.events.map((event) => event.type)
        : [];

    const result = {
        cleanupSnapshots,
        eventTypes,
        finalizedIndex: eventTypes.indexOf('match_finalized'),
        menuOpenedIndex: eventTypes.indexOf('menu_opened'),
        finalLifecycleState: sessionRuntime.lifecycle.status || null,
        finalFinalizeState: sessionRuntime.finalize.status || null,
        lifecycleEvents,
    };

    assert.strictEqual(result.cleanupSnapshots.length, 3);
    assert.strictEqual(result.cleanupSnapshots.every((entry) => entry.lifecycleState === 'finalizing'), true);
    assert.strictEqual(result.cleanupSnapshots.every((entry) => entry.finalizeState === 'finalizing'), true);
    assert.ok(result.finalizedIndex >= 0);
    assert.ok(result.menuOpenedIndex > result.finalizedIndex);
    assert.strictEqual(result.finalLifecycleState, 'menu');
    assert.strictEqual(result.finalFinalizeState, 'finalized');
    assert.strictEqual(result.lifecycleEvents.some((entry) => entry.type === 'menu_opened' && entry.reason === 'return_to_menu'), true);
});
