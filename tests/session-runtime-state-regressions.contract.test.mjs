import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFallbackSessionRuntimeState } from '../src/state/MatchLifecycleSessionRuntimeState.js';
import {
    applySessionRuntimeLifecycleTransition,
    syncSessionRuntimeLifecycleWithGameState,
    SESSION_RUNTIME_STATES,
} from '../src/shared/contracts/SessionRuntimeStateMachine.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../src/shared/contracts/SessionRuntimeEventContract.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import {
    recordSessionRuntimeEvent,
    SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT,
} from '../src/shared/runtime/SessionRuntimeObservability.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): both tests run on a fallback
// session runtime state object only. The spec's `import('/src/...')` cannot resolve
// against the built dist-app renderer.

test('V87.4 SessionRuntimeStateMachine blocks FINALIZING -> MENU until finalize completion is explicit', () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    sessionRuntime.lifecycle.status = SESSION_RUNTIME_STATES.FINALIZING;
    sessionRuntime.lifecycle.gameStateId = GAME_STATE_IDS.PLAYING;
    sessionRuntime.finalize.status = 'finalizing';

    const blockedGameStateSync = syncSessionRuntimeLifecycleWithGameState(sessionRuntime, GAME_STATE_IDS.MENU);
    const blockedExplicitMenu = applySessionRuntimeLifecycleTransition(sessionRuntime, SESSION_RUNTIME_STATES.MENU, {
        gameStateId: GAME_STATE_IDS.MENU,
        completionEventType: SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED,
    });

    sessionRuntime.finalize.status = 'finalized';
    const completedTransition = applySessionRuntimeLifecycleTransition(sessionRuntime, SESSION_RUNTIME_STATES.MENU, {
        gameStateId: GAME_STATE_IDS.MENU,
        completionEventType: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED,
    });

    const result = {
        blockedGameStateChanged: blockedGameStateSync?.changed === true,
        blockedGameStateNextState: blockedGameStateSync?.nextState || null,
        blockedExplicitChanged: blockedExplicitMenu?.changed === true,
        blockedExplicitNextState: blockedExplicitMenu?.nextState || null,
        completedChanged: completedTransition?.changed === true,
        completedNextState: completedTransition?.nextState || null,
        lifecycleState: sessionRuntime.lifecycle.status || null,
        gameStateId: sessionRuntime.lifecycle.gameStateId || null,
    };

    assert.strictEqual(result.blockedGameStateChanged, false);
    assert.strictEqual(result.blockedGameStateNextState, 'finalizing');
    assert.strictEqual(result.blockedExplicitChanged, false);
    assert.strictEqual(result.blockedExplicitNextState, 'finalizing');
    assert.strictEqual(result.completedChanged, true);
    assert.strictEqual(result.completedNextState, 'menu');
    assert.strictEqual(result.lifecycleState, 'menu');
    assert.strictEqual(result.gameStateId, 'MENU');
});

test('V87.4 SessionRuntimeObservability keeps a bounded event history via copy-based trimming', () => {
    const sessionRuntime = createFallbackSessionRuntimeState();
    const totalEvents = SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT + 5;
    const identityChanges = [];
    let previousEvents = sessionRuntime.observability.events;

    for (let index = 1; index <= totalEvents; index += 1) {
        recordSessionRuntimeEvent(sessionRuntime, {
            type: SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED,
            payload: { index },
        });
        identityChanges.push(previousEvents !== sessionRuntime.observability.events);
        previousEvents = sessionRuntime.observability.events;
    }

    const events = sessionRuntime.observability.events;
    const result = {
        limit: SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT,
        totalEvents,
        length: events.length,
        firstSequence: events[0]?.sequence || 0,
        lastSequence: events[events.length - 1]?.sequence || 0,
        firstPayloadIndex: events[0]?.payload?.index || 0,
        lastPayloadIndex: events[events.length - 1]?.payload?.index || 0,
        allNewArrays: identityChanges.every(Boolean),
    };

    assert.strictEqual(result.length, result.limit);
    assert.strictEqual(result.firstSequence, result.totalEvents - result.limit + 1);
    assert.strictEqual(result.lastSequence, result.totalEvents);
    assert.strictEqual(result.firstPayloadIndex, result.totalEvents - result.limit + 1);
    assert.strictEqual(result.lastPayloadIndex, result.totalEvents);
    assert.strictEqual(result.allNewArrays, true);
});
