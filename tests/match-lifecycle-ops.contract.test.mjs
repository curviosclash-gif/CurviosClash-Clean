import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasActiveMatchSessionRefs,
    mergeFinalizeRequest,
} from '../src/state/MatchLifecycleFinalizeRequest.js';
import { completeSessionRuntimeMenuLifecycle } from '../src/state/MatchLifecycleSessionTransitionSupport.js';
import {
    deriveMatchEndTickStep,
    deriveRoundEndControllerTransition,
    deriveRoundEndTickStep,
} from '../src/state/RoundStateControllerOps.js';
import {
    buildEntityManagerSetupOptions,
    buildHumanConfigs,
    disposeMatchSessionSystems,
} from '../src/state/match-session/MatchSessionSetupOps.js';
import { SESSION_FINALIZE_TRIGGERS } from '../src/shared/contracts/MatchLifecycleContract.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { SESSION_RUNTIME_STATES } from '../src/shared/contracts/SessionRuntimeStateMachine.js';

function finalizeRequest(reason, extra = {}) {
    return { reason, recorderTrigger: { type: reason, context: {} }, ...extra };
}

test('a finalize request survives when the other side is missing', () => {
    const request = finalizeRequest(SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU);

    assert.equal(mergeFinalizeRequest(null, request), request);
    assert.equal(mergeFinalizeRequest(request, null), request);
});

// Ein Fenster, das zugeht, darf nicht hinter einem laufenden Rundenwechsel anstehen.
test('a shutdown outranks whatever finalize reason is already queued', () => {
    for (const winner of [SESSION_FINALIZE_TRIGGERS.GAME_DISPOSE, SESSION_FINALIZE_TRIGGERS.WINDOW_SHUTDOWN]) {
        const merged = mergeFinalizeRequest(
            finalizeRequest(SESSION_FINALIZE_TRIGGERS.ROUND_FINALIZE),
            finalizeRequest(winner)
        );

        assert.equal(merged.reason, winner);
        assert.equal(merged.recorderTrigger.type, winner);
        assert.equal(merged.recorderTrigger.context.reason, winner);
    }
});

test('a queued new session yields to any more specific reason', () => {
    const merged = mergeFinalizeRequest(
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION),
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.APPLY_FAILED)
    );

    assert.equal(merged.reason, SESSION_FINALIZE_TRIGGERS.APPLY_FAILED);
});

test('two new-session requests keep the first reason', () => {
    const merged = mergeFinalizeRequest(
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION),
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION)
    );

    assert.equal(merged.reason, SESSION_FINALIZE_TRIGGERS.NEW_MATCH_SESSION);
});

test('an ordinary follow-up does not displace the reason already queued', () => {
    const merged = mergeFinalizeRequest(
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU),
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.SESSION_TEARDOWN)
    );

    assert.equal(merged.reason, SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU);
});

// Die Flags sind Pflichten, keine Meinungen: verlangt eine der beiden Seiten das
// Aufraeumen der Szene, muss es passieren.
test('finalize flags are combined rather than overwritten', () => {
    const merged = mergeFinalizeRequest(
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU, { clearScene: true, awaitPendingInit: false }),
        finalizeRequest(SESSION_FINALIZE_TRIGGERS.SESSION_TEARDOWN, { clearScene: false, notifyMenuOpened: true })
    );

    assert.equal(merged.clearScene, true);
    assert.equal(merged.notifyMenuOpened, true);
    // Verlangt keine der beiden Seiten das Warten, bleibt es aus. Der Wert ist bewusst
    // nur auf Wahrheitsgehalt geprueft: das Oder liefert undefined, nicht false.
    assert.ok(!merged.awaitPendingInit);
});

test('recorder context merges with the newer entry winning and the reason rewritten', () => {
    const merged = mergeFinalizeRequest(
        { reason: SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU, recorderTrigger: { type: 'a', context: { keep: 1, shared: 'old' } } },
        { reason: SESSION_FINALIZE_TRIGGERS.SESSION_TEARDOWN, recorderTrigger: { type: 'b', context: { shared: 'new' } } }
    );

    assert.deepEqual(merged.recorderTrigger.context, {
        keep: 1,
        shared: 'new',
        reason: SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU,
    });
});

test('a session counts as live when any of its systems still exists', () => {
    assert.equal(hasActiveMatchSessionRefs(null), false);
    assert.equal(hasActiveMatchSessionRefs({}), false);
    assert.equal(hasActiveMatchSessionRefs({ arena: {} }), true);
    assert.equal(hasActiveMatchSessionRefs({ entityManager: {} }), true);
    assert.equal(hasActiveMatchSessionRefs({ powerupManager: {} }), true);
});

test('escape during the round end leaves for the menu without moving cameras', () => {
    const step = deriveRoundEndTickStep({ escapePressed: true, enterPressed: true, roundPause: 2, dt: 0.5 });

    assert.equal(step.action, 'RETURN_TO_MENU');
    assert.equal(step.shouldUpdateCameras, false);
    assert.equal(step.nextRoundPause, 2, 'the pause is left untouched on the way out');
});

test('enter skips the remaining round pause', () => {
    const step = deriveRoundEndTickStep({ enterPressed: true, roundPause: 9, dt: 0.5 });

    assert.equal(step.action, 'START_ROUND');
    assert.equal(step.nextRoundPause, -0.5);
    assert.equal(step.countdownMessageSub, null);
});

test('the round pause counts down and shows whole seconds', () => {
    const step = deriveRoundEndTickStep({ roundPause: 3, dt: 0.4 });

    assert.equal(step.action, 'WAIT');
    assert.ok(Math.abs(step.nextRoundPause - 2.6) < 1e-9);
    assert.equal(step.countdownMessageSub, 'Naechste Runde in 3...');
});

test('a broken delta cannot rewind the countdown', () => {
    for (const dt of [-5, Number.NaN, 'nonsense', undefined]) {
        const step = deriveRoundEndTickStep({ roundPause: 1, dt });

        assert.equal(step.nextRoundPause, 1, `dt ${String(dt)} must count as zero`);
    }
});

test('escape outranks enter at the match end', () => {
    assert.equal(deriveMatchEndTickStep({ escapePressed: true, enterPressed: true }).action, 'RETURN_TO_MENU');
    assert.equal(deriveMatchEndTickStep({ enterPressed: true }).action, 'RESTART_MATCH');
    assert.equal(deriveMatchEndTickStep({}).action, 'WAIT');
    assert.equal(deriveMatchEndTickStep({ escapePressed: true }).shouldUpdateCameras, false);
});

test('the round end transition falls back to a usable state and pause', () => {
    const transition = deriveRoundEndControllerTransition(null);

    assert.equal(transition.nextState, GAME_STATE_IDS.ROUND_END);
    assert.equal(transition.roundPause, 3);
    assert.equal(transition.overlayMessageText, '');

    const custom = deriveRoundEndControllerTransition(
        { state: GAME_STATE_IDS.MATCH_END, messageText: 'Sieg', messageSub: 'Runde 3' },
        { defaultRoundPause: 1.5 }
    );
    assert.equal(custom.nextState, GAME_STATE_IDS.MATCH_END);
    assert.equal(custom.roundPause, 1.5);
    assert.equal(custom.overlayMessageSub, 'Runde 3');
});

test('a disposed session goes to disposed, a live one back to the menu', () => {
    const seen = [];
    const apply = (target, context) => { seen.push({ target, context }); return { nextState: target }; };

    completeSessionRuntimeMenuLifecycle({ lifecycle: { disposed: false } }, apply, 'done');
    completeSessionRuntimeMenuLifecycle({ lifecycle: { disposed: true } }, apply, 'done');

    assert.equal(seen[0].target, SESSION_RUNTIME_STATES.MENU);
    assert.equal(seen[1].target, SESSION_RUNTIME_STATES.DISPOSED);
    assert.equal(seen[0].context.gameStateId, GAME_STATE_IDS.MENU);
});

// Eine blockierte Transition still zu schlucken hiesse, die Runtime in einem Zustand
// weiterlaufen zu lassen, den niemand erwartet.
test('a blocked menu transition throws with a code instead of passing silently', () => {
    assert.throws(
        () => completeSessionRuntimeMenuLifecycle({ lifecycle: { status: 'playing' } }, () => ({ nextState: 'playing', currentState: 'playing' }), 'done'),
        (error) => error.code === 'SESSION_RUNTIME_MENU_TRANSITION_BLOCKED' && /playing->menu/.test(error.message)
    );
    assert.throws(
        () => completeSessionRuntimeMenuLifecycle({ lifecycle: { status: 'starting' } }, () => null, 'done'),
        /session_runtime_menu_transition_blocked:starting->menu/
    );
});

test('disposing a session tears down every subsystem it owns', () => {
    const disposed = [];
    const renderer = { clearMatchScene: () => disposed.push('scene') };
    const session = {
        entityManager: { dispose: () => disposed.push('entities') },
        powerupManager: { dispose: () => disposed.push('powerups') },
        arena: { dispose: () => disposed.push('arena') },
        particles: { dispose: () => disposed.push('particles') },
    };

    disposeMatchSessionSystems(renderer, session);

    assert.deepEqual(disposed, ['entities', 'powerups', 'arena', 'particles', 'scene']);
});

test('disposing survives a half-built session and can keep the scene', () => {
    let cleared = 0;
    const renderer = { clearMatchScene: () => { cleared += 1; } };

    assert.doesNotThrow(() => disposeMatchSessionSystems(renderer, null));
    assert.doesNotThrow(() => disposeMatchSessionSystems(renderer, { arena: {} }));
    assert.equal(cleared, 2);

    disposeMatchSessionSystems(renderer, null, { clearScene: false });
    assert.equal(cleared, 2, 'clearScene false really keeps the scene');
});

test('the runtime config beats the stored settings for vehicles', () => {
    const settings = { vehicles: { PLAYER_1: 'saved-1', PLAYER_2: 'saved-2' }, invertPitch: { PLAYER_1: true } };
    const configs = buildHumanConfigs(settings, { player: { vehicles: { PLAYER_1: 'live-1' } } });

    assert.equal(configs[0].vehicleId, 'live-1');
    assert.equal(configs[1].vehicleId, 'saved-2', 'a missing live value falls back to the saved one');
    assert.equal(configs[0].invertPitch, true);
    assert.equal(configs[1].invertPitch, false);
});

test('fight loadouts only reach the players in fight mode', () => {
    const loadouts = { PLAYER_1: 'gun', PLAYER_2: 'rocket' };

    const fight = buildHumanConfigs({}, { session: { modePath: 'fight' }, player: { fightLoadouts: loadouts } });
    const normal = buildHumanConfigs({}, { session: { modePath: 'normal' }, player: { fightLoadouts: loadouts } });

    assert.equal(fight[0].fightLoadout, 'gun');
    assert.equal(normal[0].fightLoadout, null);
});

test('setup options prefer the runtime config and keep planar mode a real boolean', () => {
    const settings = { gameplay: { planeScale: 2, planarMode: true }, botDifficulty: 'EASY', gameMode: 'CLASSIC' };
    const options = buildEntityManagerSetupOptions(
        settings,
        { player: { modelScale: 5 }, bot: { activeDifficulty: 'HARD', policyType: 'rule' }, gameplay: { planarMode: false } },
        { marker: 'entity-config' },
        { isDesktopRuntime: true }
    );

    assert.equal(options.modelScale, 5);
    assert.equal(options.botDifficulty, 'HARD');
    assert.equal(options.botPolicyType, 'rule');
    assert.equal(options.planarMode, false, 'an explicit false must not fall through to the saved true');
    assert.equal(options.isDesktopRuntime, true);
    assert.deepEqual(options.entityRuntimeConfig, { marker: 'entity-config' });
    assert.equal(options.humanConfigs.length, 2);
});

test('setup options fall back to the saved settings when nothing is live', () => {
    const options = buildEntityManagerSetupOptions({ gameplay: { planeScale: 3 }, gameMode: 'HUNT' });

    assert.equal(options.modelScale, 3);
    assert.equal(options.botDifficulty, 'NORMAL');
    assert.equal(options.activeGameMode, 'HUNT');
    assert.equal(options.planarMode, undefined, 'an unknown planar mode stays unset instead of guessing false');
});
