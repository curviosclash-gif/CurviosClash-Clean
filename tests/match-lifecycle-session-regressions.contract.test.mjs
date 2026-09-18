import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MatchLifecycleSessionOrchestrator } from '../src/state/MatchLifecycleSessionOrchestrator.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): every dependency of the
// orchestrator is hand-built here, so the tests never needed a browser. In the
// desktop profile the spec loaded them via `import('/src/...')`, which cannot
// resolve against the built dist-app renderer.

test('V74.3 Stale async session init disposes replaced prepared match before apply', async () => {
    let resolveFirstInit = null;
    let prepareCalls = 0;
    let currentSession = null;
    const disposed = [];
    const applied = [];
    const wired = [];
    const firstInit = new Promise((resolve) => {
        resolveFirstInit = resolve;
    });

    const deps = {
        getLifecycleState: () => ({
            mapKey: 'standard',
            numHumans: 1,
            numBots: 0,
            winsNeeded: 3,
            activeGameMode: 'CLASSIC',
        }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => {
            prepareCalls += 1;
            if (prepareCalls === 1) {
                return firstInit;
            }
            return Promise.resolve({
                session: {
                    id: 'second-session',
                    effectiveMapKey: 'standard',
                    numHumans: 1,
                    numBots: 0,
                    winsNeeded: 3,
                },
            });
        },
        wireInitializedMatchRuntime: (initializedMatch) => {
            wired.push(initializedMatch?.session?.id || null);
            return {
                ...initializedMatch,
                runtime: { id: `runtime-${initializedMatch?.session?.id || 'unknown'}` },
            };
        },
        applyInitializedMatchSession: (initializedMatch) => {
            const sessionId = initializedMatch?.session?.id || null;
            applied.push(sessionId);
            currentSession = {
                entityManager: { players: [], getHumanPlayers() { return []; } },
                powerupManager: { clear() { } },
                sessionId,
            };
        },
        getCurrentMatchSessionRefs: () => currentSession,
        clearMatchSessionRefs: () => {
            currentSession = null;
        },
        disposePreparedMatchSession: (initializedMatch, options = {}) => {
            disposed.push({
                id: initializedMatch?.session?.id || null,
                reason: options.reason || null,
                clearScene: options.clearScene === true,
            });
        },
        disposeCurrentMatchSession() { },
        settleRecorder() {
            return null;
        },
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    const firstPromise = orchestrator.createMatchSession({});
    const secondPromise = orchestrator.createMatchSession({});

    resolveFirstInit({
        session: {
            id: 'first-session',
            effectiveMapKey: 'standard',
            numHumans: 1,
            numBots: 0,
            winsNeeded: 3,
        },
    });

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    const result = {
        prepareCalls,
        wired,
        applied,
        disposed,
        firstResultIsNull: firstResult === null,
        secondResultId: secondResult?.session?.id || null,
        activeSessionId: orchestrator._activeSessionId,
    };

    assert.strictEqual(result.prepareCalls, 2);
    assert.deepStrictEqual(result.wired, ['second-session']);
    assert.deepStrictEqual(result.applied, ['second-session']);
    assert.deepStrictEqual(result.disposed, [{
        id: 'first-session',
        reason: 'stale_session_init',
        clearScene: true,
    }]);
    assert.ok(result.firstResultIsNull);
    assert.strictEqual(result.secondResultId, 'second-session');
    assert.strictEqual(typeof result.activeSessionId, 'string');
});

test('V74.3 createMatchSession disposes current session before starting new init', async () => {
    const callLog = [];
    let currentSession = null;
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => Promise.resolve({
            session: { id: 'sess', effectiveMapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3 },
        }),
        wireInitializedMatchRuntime: (m) => ({ ...m, runtime: {} }),
        applyInitializedMatchSession: (m) => {
            callLog.push('apply');
            currentSession = m?.session || null;
        },
        getCurrentMatchSessionRefs: () => currentSession,
        clearMatchSessionRefs: () => { callLog.push('clearRefs'); currentSession = null; },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession: (opts) => { callLog.push(`dispose:${opts?.reason || 'none'}`); },
        settleRecorder: (trigger) => { callLog.push(`settle:${trigger?.type || 'none'}`); },
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    await orchestrator.createMatchSession({});
    callLog.length = 0;
    await orchestrator.createMatchSession({});
    const result = { callLog };

    assert.ok(result.callLog.indexOf('settle:new_match_session') < result.callLog.indexOf('dispose:new_match_session'));
    assert.ok(result.callLog.indexOf('dispose:new_match_session') < result.callLog.indexOf('apply'));
    assert.ok(result.callLog.indexOf('clearRefs') < result.callLog.indexOf('apply'));
});

test('V83.2 particles-only bootstrap refs do not trigger stale session finalization on first start', async () => {
    const callLog = [];
    let currentSession = { particles: { id: 'bootstrap-particles' } };
    const nextSession = {
        id: 'fresh-session',
        effectiveMapKey: 'std',
        numHumans: 1,
        numBots: 0,
        winsNeeded: 3,
        arena: { id: 'arena' },
        entityManager: { id: 'entity-manager' },
        powerupManager: { id: 'powerups' },
        particles: { id: 'match-particles' },
    };
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => Promise.resolve({
            session: nextSession,
        }),
        wireInitializedMatchRuntime: (m) => ({ ...m, runtime: {} }),
        applyInitializedMatchSession: (m) => {
            callLog.push('apply');
            currentSession = m?.session || null;
        },
        getCurrentMatchSessionRefs: () => currentSession,
        clearMatchSessionRefs: () => {
            callLog.push('clearRefs');
            currentSession = null;
        },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession: (opts) => { callLog.push(`dispose:${opts?.reason || 'none'}`); },
        settleRecorder: (trigger) => { callLog.push(`settle:${trigger?.type || 'none'}`); },
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    await orchestrator.createMatchSession({});
    const result = {
        callLog,
        currentSessionId: currentSession?.id || null,
    };

    assert.deepStrictEqual(result.callLog, ['apply']);
    assert.strictEqual(result.currentSessionId, 'fresh-session');
});

test('V74.3 finalizeRound settles recorder then resets round', () => {
    const callLog = [];
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => ({}),
        wireInitializedMatchRuntime: (m) => m,
        applyInitializedMatchSession() { },
        getCurrentMatchSessionRefs: () => null,
        clearMatchSessionRefs() { },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession() { },
        settleRecorder: (trigger) => { callLog.push(`settle:${trigger?.type || 'none'}`); },
        resetRoundRuntime: () => { callLog.push('resetRound'); },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    orchestrator.finalizeRound();
    const result = { callLog };

    assert.deepStrictEqual(result.callLog, ['settle:round_finalize', 'resetRound']);
});

test('V74.3 apply failure disposes wired match', async () => {
    const disposed = [];
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => Promise.resolve({
            session: { id: 'fail-sess', effectiveMapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3 },
        }),
        wireInitializedMatchRuntime: (m) => ({ ...m, runtime: {} }),
        applyInitializedMatchSession: () => { throw new Error('apply-boom'); },
        getCurrentMatchSessionRefs: () => null,
        clearMatchSessionRefs() { },
        disposePreparedMatchSession: (m, opts) => { disposed.push({ id: m?.session?.id, reason: opts?.reason }); },
        disposeCurrentMatchSession() { },
        settleRecorder: () => null,
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    let errorMessage = null;
    try {
        await orchestrator.createMatchSession({});
    } catch (err) {
        errorMessage = err.message;
    }
    const result = { disposed, errorMessage };

    assert.strictEqual(result.errorMessage, 'apply-boom');
    assert.deepStrictEqual(result.disposed, [{ id: 'fail-sess', reason: 'apply_failed' }]);
});

test('V74.3 createMatchSession error path clears session refs', async () => {
    let refCleared = false;
    const deps = {
        getLifecycleState: () => ({ mapKey: 'std', numHumans: 1, numBots: 0, winsNeeded: 3, activeGameMode: 'CLASSIC' }),
        notifyLifecycleEvent() { },
        prepareInitializedMatchSession: () => Promise.reject(new Error('prep-fail')),
        wireInitializedMatchRuntime: (m) => m,
        applyInitializedMatchSession() { },
        getCurrentMatchSessionRefs: () => null,
        clearMatchSessionRefs: () => { refCleared = true; },
        disposePreparedMatchSession() { },
        disposeCurrentMatchSession() { },
        settleRecorder: () => null,
        resetRoundRuntime() { },
    };

    const orchestrator = new MatchLifecycleSessionOrchestrator(deps);
    let errorCaught = false;
    try {
        await orchestrator.createMatchSession({});
    } catch {
        errorCaught = true;
    }
    const result = { refCleared, errorCaught, activeSessionId: orchestrator._activeSessionId };

    assert.strictEqual(result.refCleared, true);
    assert.strictEqual(result.errorCaught, true);
    assert.strictEqual(result.activeSessionId, null);
});
