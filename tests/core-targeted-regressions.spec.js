import {
    test,
    expect,
    CONFIG,
    collectErrors,
    lockExpertMode,
    loadGame,
    openCustomSubmenu,
    openDebugSubmenu,
    openDeveloperSubmenu,
    openExpertSubmenu,
    openGameSubmenu,
    openStartSetupSection,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    openSubmenu,
    returnToMenu,
    startGame,
    startGameWithBots,
    unlockExpertMode,
    createMapDocument,
    parseMapJSON,
    stringifyMapDocument,
    toArenaMapDefinition,
    generateJSONExport,
    importFromJSON,
    RoundMetricsStore,
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
    applyPlayerPowerup,
    updatePlayerEffects,
    SETTINGS_STORAGE_KEY,
    SETTINGS_PROFILES_STORAGE_KEY,
    LEGACY_SETTINGS_STORAGE_KEY,
    MENU_DRAFTS_STORAGE_KEY,
    MENU_PRESETS_STORAGE_KEY,
    CUSTOM_MAP_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
    ARCADE_LAST_RUN_STORAGE_KEY,
    buildLegacyRuntimeCustomMap,
    createMockEditorManager,
    loadGameWithRetry,
} from './core-targeted.shared.js';

// ---------------------------------------------------------------------------
// V56 Regression Tests — Defensive Improvements & Edge-Case Fixes
// ---------------------------------------------------------------------------
test.describe('V56: Code-Audit Remediation Regressions', () => {
    test.describe.configure({ mode: 'serial' });

    test('V56.1 Session-ID guard rejects stale async createMatchSession result', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const orch = game.matchLifecycleSessionOrchestrator;
            if (!orch) return { skip: true };

            // First call (sync path)
            orch.createMatchSession({});
            const firstId = orch._activeSessionId;

            // Second call supersedes the first
            orch.createMatchSession({});
            const secondId = orch._activeSessionId;

            return {
                skip: false,
                idsAreDifferent: firstId !== secondId,
                secondIdActive: orch._activeSessionId === secondId,
            };
        });
        if (result.skip) { test.skip(); return; }
        expect(result.idsAreDifferent).toBeTruthy();
        expect(result.secondIdActive).toBeTruthy();
    });

    test('V56.3 TouchInputSource double-dispose does not throw', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(() => {
            const { TouchInputSource } = window.__CC_MODULES?.TouchInputSource
                || {};
            if (!TouchInputSource) {
                // Fallback: try to instantiate from game instance input sources
                const game = window.GAME_INSTANCE;
                const touchSrc = game?.inputSources?.find(s => s?._disposed !== undefined);
                if (touchSrc) {
                    touchSrc.dispose();
                    touchSrc.dispose(); // second call must not throw
                    return { ok: true, disposed: touchSrc._disposed };
                }
                return { skip: true };
            }
            const src = new TouchInputSource();
            src.dispose();
            src.dispose();
            return { ok: true, disposed: src._disposed };
        });
        if (result.skip) { test.skip(); return; }
        expect(result.ok).toBeTruthy();
        expect(result.disposed).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// V74 Regression Tests - Runtime-Entkopplung
// ---------------------------------------------------------------------------
test.describe('V74: Runtime-Decoupling Regressions', () => {
    test('V74.3 Stale async session init disposes replaced prepared match before apply', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return {
                prepareCalls,
                wired,
                applied,
                disposed,
                firstResultIsNull: firstResult === null,
                secondResultId: secondResult?.session?.id || null,
                activeSessionId: orchestrator._activeSessionId,
            };
        });

        expect(result.prepareCalls).toBe(2);
        expect(result.wired).toEqual(['second-session']);
        expect(result.applied).toEqual(['second-session']);
        expect(result.disposed).toEqual([{
            id: 'first-session',
            reason: 'stale_session_init',
            clearScene: true,
        }]);
        expect(result.firstResultIsNull).toBeTruthy();
        expect(result.secondResultId).toBe('second-session');
        expect(typeof result.activeSessionId).toBe('string');
    });

    test('V74.3 createMatchSession disposes partial session allocations on async init failure', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { createMatchSession } = await import('/src/state/MatchSessionFactory.js');
            const { Arena } = await import('/src/entities/Arena.js');
            const { ParticleSystem } = await import('/src/entities/Particles.js');

            const callLog = [];
            const originalBuild = Arena.prototype.build;
            const originalArenaDispose = Arena.prototype.dispose;
            const originalParticleDispose = ParticleSystem.prototype.dispose;

            Arena.prototype.build = () => Promise.reject(new Error('arena-build-fail'));
            Arena.prototype.dispose = function disposeArenaForTest() {
                callLog.push('arena.dispose');
            };
            ParticleSystem.prototype.dispose = function disposeParticlesForTest() {
                callLog.push('particles.dispose');
            };

            let errorMessage = null;
            try {
                await createMatchSession({
                    renderer: {
                        addToScene() { },
                        removeFromScene() { },
                        clearMatchScene() {
                            callLog.push('renderer.clearMatchScene');
                        },
                    },
                    audio: {},
                    recorder: {},
                    settings: {
                        mode: '1p',
                        numBots: 0,
                        winsNeeded: 3,
                        gameplay: {},
                        vehicles: {},
                        invertPitch: {},
                        cockpitCamera: {},
                    },
                    runtimeConfig: null,
                    baseConfig: null,
                    requestedMapKey: 'standard',
                    currentSession: null,
                });
            } catch (error) {
                errorMessage = error?.message || null;
            } finally {
                Arena.prototype.build = originalBuild;
                Arena.prototype.dispose = originalArenaDispose;
                ParticleSystem.prototype.dispose = originalParticleDispose;
            }

            return { callLog, errorMessage };
        });

        expect(result.errorMessage).toBe('arena-build-fail');
        expect(result.callLog).toEqual([
            'arena.dispose',
            'particles.dispose',
            'renderer.clearMatchScene',
        ]);
    });

    test('V74.3 current match session refs include arena for replacement disposal', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const {
                applyMatchSessionState,
                createGameRuntimeBundle,
                getCurrentMatchSessionRefs,
            } = await import('/src/core/runtime/GameRuntimeBundle.js');

            const arena = { id: 'arena-ref' };
            const entityManager = { id: 'entity-manager-ref' };
            const powerupManager = { id: 'powerup-manager-ref' };
            const particles = { id: 'particle-ref' };
            const bundle = createGameRuntimeBundle();

            applyMatchSessionState(bundle, {
                arena,
                entityManager,
                powerupManager,
                particles,
            });

            const refs = getCurrentMatchSessionRefs(bundle);
            return {
                arenaMatches: refs?.arena === arena,
                entityMatches: refs?.entityManager === entityManager,
                powerupMatches: refs?.powerupManager === powerupManager,
                particleMatches: refs?.particles === particles,
            };
        });

        expect(result).toEqual({
            arenaMatches: true,
            entityMatches: true,
            powerupMatches: true,
            particleMatches: true,
        });
    });

    test('V74.3 createMatchSession disposes current session before starting new init', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return { callLog };
        });

        expect(result.callLog.indexOf('settle:new_match_session')).toBeLessThan(result.callLog.indexOf('dispose:new_match_session'));
        expect(result.callLog.indexOf('dispose:new_match_session')).toBeLessThan(result.callLog.indexOf('apply'));
        expect(result.callLog.indexOf('clearRefs')).toBeLessThan(result.callLog.indexOf('apply'));
    });

    test('V83.2 particles-only bootstrap refs do not trigger stale session finalization on first start', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return {
                callLog,
                currentSessionId: currentSession?.id || null,
            };
        });

        expect(result.callLog).toEqual(['apply']);
        expect(result.currentSessionId).toBe('fresh-session');
    });

    test('V74.3 finalizeRound settles recorder then resets round', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return { callLog };
        });

        expect(result.callLog).toEqual(['settle:round_finalize', 'resetRound']);
    });

    test('V74.3 apply failure disposes wired match', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return { disposed, errorMessage };
        });

        expect(result.errorMessage).toBe('apply-boom');
        expect(result.disposed).toEqual([{ id: 'fail-sess', reason: 'apply_failed' }]);
    });

    test('V74.3 createMatchSession error path clears session refs', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return { refCleared, errorCaught, activeSessionId: orchestrator._activeSessionId };
        });

        expect(result.refCleared).toBe(true);
        expect(result.errorCaught).toBe(true);
        expect(result.activeSessionId).toBeNull();
    });

    test('V87.2 createMatchSession aborts when a new-match finalize is overtaken by return-to-menu', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');

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
            return {
                startError,
                mergedReason,
                prepareCalls,
                lifecycleEvents,
                finalizeState: orchestrator._sessionRuntimeState?.finalize?.status || null,
            };
        });

        expect(result.startError).toBe('match_start_blocked:return_to_menu');
        expect(result.mergedReason).toBe('return_to_menu');
        expect(result.prepareCalls).toBe(0);
        expect(result.finalizeState).toBe('finalized');
        expect(result.lifecycleEvents.some((entry) => entry.type === 'menu_opened' && entry.reason === 'return_to_menu')).toBe(true);
    });

    test('V87.2 GameRuntimeSessionHandler waits for pending finalize and deduplicates concurrent starts', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');

            let startCalls = 0;
            let resolveFinalize = null;
            let resolveStart = null;
            const callLog = [];
            const facade = {
                game: {
                    state: GAME_STATE_IDS.MENU,
                    settings: {
                        localSettings: {
                            sessionType: 'single',
                            modePath: 'normal',
                        },
                    },
                    uiManager: {
                        showStartValidationError() { },
                        clearStartValidationError() {
                            callLog.push('clearValidation');
                        },
                    },
                },
                _pendingMatchFinalizePlan: {
                    reason: 'return_to_menu',
                },
                _clearMatchPrewarmTimer() {
                    callLog.push('clearPrewarm');
                },
                _recordMenuTelemetry(type, payload = {}) {
                    callLog.push(`${type}:${payload.reason || ''}`);
                },
                _resolveStartValidationIssue() {
                    return null;
                },
                _applyAuthoritativeMultiplayerMatchSettings(snapshot) {
                    callLog.push(`applySnapshot:${snapshot?.lobbyCode || ''}`);
                },
                _applySettingsToRuntimeInternal(options) {
                    callLog.push(`applyRuntime:${options?.schedulePrewarm !== false}`);
                },
                getUiManager() {
                    return this.game.uiManager;
                },
                getPorts() {
                    return {
                        runtimeProjectionPort: {
                            getSessionRuntimeSnapshot: () => ({
                                lifecycleState: 'menu',
                                finalizeState: this._pendingMatchFinalize ? 'finalizing' : 'idle',
                                pendingFinalizeTrigger: this._pendingMatchFinalizePlan?.reason || '',
                            }),
                        },
                        matchUiPort: {
                            applyStartMatchProjection: () => {
                                startCalls += 1;
                                callLog.push('applyStart');
                                return new Promise((resolve) => {
                                    resolveStart = () => resolve(true);
                                });
                            },
                        },
                    };
                },
            };
            facade._pendingMatchFinalize = new Promise((resolve) => {
                resolveFinalize = () => {
                    facade._pendingMatchFinalize = null;
                    facade._pendingMatchFinalizePlan = null;
                    resolve(true);
                };
            });

            const handler = new GameRuntimeSessionHandler({ facade, logger: console });
            const firstPromise = handler.startMatch({ settingsSnapshot: { lobbyCode: 'ABCD' } });
            const secondPromise = handler.startMatch();
            const samePromise = firstPromise === secondPromise;
            const startCallsBeforeFinalize = startCalls;
            resolveFinalize();
            await Promise.resolve();
            const startCallsAfterFinalize = startCalls;
            resolveStart();
            const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

            return {
                samePromise,
                startCallsBeforeFinalize,
                startCallsAfterFinalize,
                startCalls,
                firstResult,
                secondResult,
                callLog,
            };
        });

        expect(result.samePromise).toBe(true);
        expect(result.startCallsBeforeFinalize).toBe(0);
        expect(result.startCallsAfterFinalize).toBe(1);
        expect(result.startCalls).toBe(1);
        expect(result.firstResult).toBe(true);
        expect(result.secondResult).toBe(true);
        expect(result.callLog).toContain('applySnapshot:ABCD');
        expect(result.callLog).toContain('applyRuntime:false');
        expect(result.callLog.filter((entry) => entry === 'applyStart')).toHaveLength(1);
    });

    test('V87.2 finalize errors stay latched in runtime snapshots until reset', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');
            const { createRuntimeProjectionPort } = await import('/src/shared/runtime/GameRuntimePorts.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');

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

            return {
                finalizeError,
                finalizeState: sessionRuntime.finalize.status || null,
                finalizeErrorMessage: sessionRuntime.finalize.errorMessage || null,
                pendingFinalize: !!sessionRuntime.finalize.pendingOperation,
                sessionSnapshot: runtimeProjectionPort.getSessionRuntimeSnapshot(),
                matchFlowSnapshot: runtimeProjectionPort.getMatchFlowSnapshot(),
            };
        });

        expect(result.finalizeError).toBe('recorder-boom');
        expect(result.finalizeState).toBe('error');
        expect(result.finalizeErrorMessage).toBe('recorder-boom');
        expect(result.pendingFinalize).toBe(false);
        expect(result.sessionSnapshot.finalizeErrorMessage).toBe('recorder-boom');
        expect(result.sessionSnapshot.pendingFinalizeTrigger).toBe('return_to_menu');
        expect(result.matchFlowSnapshot.finalizeErrorMessage).toBe('recorder-boom');
        expect(result.matchFlowSnapshot.canReturnToMenu).toBe(false);
    });

    test('V87.2 GameRuntimeSessionHandler dispose waits for finalize before clearing menu refs', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');

            let finalizeState = 'finalizing';
            let resolveFinalize = null;
            const callLog = [];
            const facade = {
                game: {
                    menuController: {
                        dispose() {
                            callLog.push('disposeMenuController');
                        },
                    },
                    menuMultiplayerBridge: {
                        dispose() {
                            callLog.push('disposeMenuBridge');
                        },
                    },
                },
                _clearMatchPrewarmTimer() {
                    callLog.push('clearPrewarm');
                },
                finalizeMatch(options) {
                    callLog.push(`finalize:${options?.reason || 'none'}`);
                    return new Promise((resolve) => {
                        resolveFinalize = (value = false) => {
                            finalizeState = value === false ? 'error' : 'finalized';
                            resolve(value);
                        };
                    });
                },
                getPorts() {
                    return {
                        runtimeProjectionPort: {
                            getSessionRuntimeSnapshot: () => ({
                                lifecycleState: finalizeState === 'finalized' ? 'menu' : 'playing',
                                finalizeState,
                                finalizeErrorMessage: finalizeState === 'error' ? 'dispose-finalize-failed' : '',
                            }),
                        },
                    };
                },
            };

            const handler = new GameRuntimeSessionHandler({ facade, logger: console });
            const firstPromise = handler.dispose();
            const secondPromise = handler.dispose();
            const samePromise = firstPromise === secondPromise;
            const callLogBeforeFinalize = [...callLog];
            resolveFinalize(false);
            const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

            return {
                samePromise,
                callLogBeforeFinalize,
                callLog,
                firstResult,
                secondResult,
                menuControllerCleared: facade.game.menuController === null,
                menuBridgeCleared: facade.game.menuMultiplayerBridge === null,
            };
        });

        expect(result.samePromise).toBe(true);
        expect(result.callLogBeforeFinalize).toEqual([
            'clearPrewarm',
            'finalize:game_dispose',
        ]);
        expect(result.callLogBeforeFinalize).not.toContain('disposeMenuController');
        expect(result.callLogBeforeFinalize).not.toContain('disposeMenuBridge');
        expect(result.callLog.filter((entry) => entry === 'disposeMenuController')).toHaveLength(1);
        expect(result.callLog.filter((entry) => entry === 'disposeMenuBridge')).toHaveLength(1);
        expect(result.firstResult).toBe(false);
        expect(result.secondResult).toBe(false);
        expect(result.menuControllerCleared).toBe(true);
        expect(result.menuBridgeCleared).toBe(true);
    });

    test('V87.2 finalizeMatchFlow skips prewarm after a failed session finalize', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { finalizeMatchFlow } = await import('/src/core/runtime/MatchFinalizeFlowService.js');

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

            return {
                finalizeResult,
                callLog,
            };
        });

        expect(result.finalizeResult).toBe(false);
        expect(result.callLog).toContain('sessionFinalize');
        expect(result.callLog).not.toContain('schedulePrewarm');
    });

    test('V87.3 SessionRuntimeCommandExecutor routes APPLY_SETTINGS and START_MATCH snapshots through one runtime settings apply path', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');
            const { createSessionRuntimeCommandBackends } = await import('/src/core/runtime/SessionRuntimeCommandBackendFactory.js');
            const { SessionRuntimeCommandExecutor } = await import('/src/application/session-runtime/SessionRuntimeCommandExecutor.js');
            const {
                createApplySettingsCommand,
                createStartMatchCommand,
            } = await import('/src/shared/contracts/SessionRuntimeCommandContract.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');

            const callLog = [];
            const facade = {
                game: {
                    state: GAME_STATE_IDS.MENU,
                    settings: {
                        localSettings: {
                            sessionType: 'single',
                            modePath: 'normal',
                        },
                    },
                    uiManager: {
                        showStartValidationError() { },
                        clearStartValidationError() {
                            callLog.push('clearValidation');
                        },
                    },
                },
                _clearMatchPrewarmTimer() {
                    callLog.push('clearPrewarm');
                },
                _recordMenuTelemetry(type, payload = {}) {
                    callLog.push(`${type}:${payload.reason || ''}`);
                },
                _resolveStartValidationIssue() {
                    return null;
                },
                _applyAuthoritativeMultiplayerMatchSettings(snapshot) {
                    callLog.push(`applySnapshot:${snapshot?.mapKey || ''}`);
                },
                _applySettingsToRuntimeInternal(options = {}) {
                    callLog.push(`applyRuntime:${options.schedulePrewarm !== false}`);
                    return {
                        schedulePrewarm: options.schedulePrewarm !== false,
                    };
                },
                getUiManager() {
                    return this.game.uiManager;
                },
                getPorts() {
                    return {
                        runtimeProjectionPort: {
                            getSessionRuntimeSnapshot: () => ({
                                lifecycleState: 'menu',
                                finalizeState: 'idle',
                                pendingFinalizeTrigger: '',
                            }),
                        },
                        matchUiPort: {
                            applyStartMatchProjection: () => {
                                callLog.push('applyStart');
                                return true;
                            },
                        },
                    };
                },
            };
            facade.sessionHandler = new GameRuntimeSessionHandler({ facade, logger: console });

            // Keep this as a productive integration seam: both settings apply and start-match
            // must traverse the same Core-composed backends used by GameRuntimeFacade.
            const executor = new SessionRuntimeCommandExecutor({
                facade,
                backends: createSessionRuntimeCommandBackends({ facade }),
            });
            const applyResult = executor.execute(createApplySettingsCommand({
                schedulePrewarm: false,
                source: 'settings_menu',
            }));
            const rawStartResult = executor.execute(createStartMatchCommand({
                source: 'menu_multiplayer_bridge',
                settingsSnapshot: {
                    mapKey: 'maze',
                },
            }));
            const startResult = rawStartResult && typeof rawStartResult.then === 'function'
                ? await rawStartResult
                : rawStartResult;

            return {
                applyResult,
                startResult,
                startResultIsPromise: !!(rawStartResult && typeof rawStartResult.then === 'function'),
                callLog,
            };
        });

        expect(result.applyResult?.schedulePrewarm).toBe(false);
        expect(result.startResult).toBe(true);
        expect(result.startResultIsPromise).toBe(true);
        expect(result.callLog.filter((entry) => entry === 'applyRuntime:false')).toHaveLength(2);
        expect(result.callLog).toEqual(expect.arrayContaining([
            'applySnapshot:maze',
            'clearPrewarm',
            'clearValidation',
            'applyStart',
        ]));
    });

    test('V87.3 SessionRuntimeCommandExecutor exposes settled async errors without unhandled rejections', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { SessionRuntimeCommandExecutor } = await import('/src/application/session-runtime/SessionRuntimeCommandExecutor.js');
            const { createStartMatchCommand } = await import('/src/shared/contracts/SessionRuntimeCommandContract.js');
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');

            const sessionRuntime = createFallbackSessionRuntimeState();
            const runtimeBundle = { sessionRuntime };
            const unhandled = [];
            const onUnhandled = (event) => {
                unhandled.push(event.reason?.message || String(event.reason || 'unknown'));
                event.preventDefault();
            };
            window.addEventListener('unhandledrejection', onUnhandled);

            const executor = new SessionRuntimeCommandExecutor({
                facade: {
                    game: {},
                    getRuntimeBundle() {
                        return runtimeBundle;
                    },
                },
                backends: {
                    startMatch() {
                        return Promise.reject(new Error('command-boom'));
                    },
                },
            });

            const rawPromise = executor.execute(createStartMatchCommand({ source: 'raw_start' }));
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));

            let rawErrorMessage = null;
            try {
                await rawPromise;
            } catch (error) {
                rawErrorMessage = error?.message || null;
            }

            const settledResult = await executor.executeResult(createStartMatchCommand({ source: 'settled_start' }));
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
            window.removeEventListener('unhandledrejection', onUnhandled);

            const failedEvents = Array.isArray(sessionRuntime.observability?.events)
                ? sessionRuntime.observability.events.filter((event) => (
                    event.type === 'runtime_command_observed'
                    && event.payload?.phase === 'failed'
                ))
                : [];

            return {
                rawErrorMessage,
                settledResult,
                unhandled,
                failedEvents,
            };
        });

        expect(result.rawErrorMessage).toBe('command-boom');
        expect(result.unhandled).toEqual([]);
        expect(result.settledResult.ok).toBe(false);
        expect(result.settledResult.commandType).toBe('start_match');
        expect(result.settledResult.resultStatus).toBe('rejected');
        expect(result.settledResult.errorMessage).toBe('command-boom');
        expect(result.failedEvents.length).toBeGreaterThanOrEqual(2);
        expect(result.failedEvents.every((event) => event.payload?.resultStatus === 'rejected')).toBe(true);
    });

    test('V87.3 SessionRuntimeCommandExecutor returns explicit invalid-command results for settled callers', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { SessionRuntimeCommandExecutor } = await import('/src/application/session-runtime/SessionRuntimeCommandExecutor.js');
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');

            const sessionRuntime = createFallbackSessionRuntimeState();
            const runtimeBundle = { sessionRuntime };
            const executor = new SessionRuntimeCommandExecutor({
                facade: {
                    game: {},
                    getRuntimeBundle() {
                        return runtimeBundle;
                    },
                },
            });

            const rawResult = executor.execute({
                type: 'not_a_real_command',
                payload: { source: 'manual_probe' },
            });
            const settledResult = await executor.executeResult({
                type: 'not_a_real_command',
                payload: { source: 'manual_probe' },
            });

            const failedEvents = Array.isArray(sessionRuntime.observability?.events)
                ? sessionRuntime.observability.events.filter((event) => (
                    event.type === 'runtime_command_observed'
                    && event.payload?.phase === 'failed'
                    && event.payload?.resultStatus === 'invalid_command'
                ))
                : [];

            return {
                rawWasUndefined: rawResult === undefined,
                settledResult,
                failedEvents,
            };
        });

        expect(result.rawWasUndefined).toBe(true);
        expect(result.settledResult.ok).toBe(false);
        expect(result.settledResult.commandType).toBe('not_a_real_command');
        expect(result.settledResult.commandSource).toBe('manual_probe');
        expect(result.settledResult.resultStatus).toBe('invalid_command');
        expect(result.settledResult.errorMessage).toBe('invalid session runtime command');
        expect(result.failedEvents.length).toBeGreaterThanOrEqual(2);
    });

    test('V87.4 MatchFlowUiController assigns the start inflight guard before reentrant start work', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchFlowUiController } = await import('/src/ui/MatchFlowUiController.js');

            const game = {
                state: 'MENU',
                ui: {},
                input: null,
                runtimeConfig: {
                    session: {
                        numHumans: 1,
                    },
                },
            };
            const controller = new MatchFlowUiController({
                game,
                ports: {},
            });

            let startCalls = 0;
            let nestedPromise = null;
            let resolveStart = null;
            controller._handleStartMatchFailure = () => false;
            controller._startMatchInternal = () => {
                startCalls += 1;
                if (!nestedPromise) {
                    nestedPromise = controller.applyStartMatchProjection();
                }
                return new Promise((resolve) => {
                    resolveStart = () => resolve('started');
                });
            };

            const firstPromise = controller.applyStartMatchProjection();
            const samePromise = firstPromise === nestedPromise;
            resolveStart();
            const [firstResult, nestedResult] = await Promise.all([firstPromise, nestedPromise]);

            return {
                samePromise,
                startCalls,
                firstResult,
                nestedResult,
                pendingAfterSettle: controller._startMatchPromise !== null,
            };
        });

        expect(result.samePromise).toBe(true);
        expect(result.startCalls).toBe(1);
        expect(result.firstResult).toBe('started');
        expect(result.nestedResult).toBe('started');
        expect(result.pendingAfterSettle).toBe(false);
    });

    test('V87.4 executeAtomicUiIntent rejects async failures when no error handler is provided', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { executeAtomicUiIntent } = await import('/src/shared/runtime/UiIntentAtomicity.js');

            let pendingPromise = null;
            try {
                await executeAtomicUiIntent({
                    currentPromise: pendingPromise,
                    assignPendingPromise: (promise) => {
                        pendingPromise = promise;
                    },
                    clearPendingPromise: (promise) => {
                        if (pendingPromise === promise) {
                            pendingPromise = null;
                        }
                    },
                    execute: () => Promise.reject(new Error('atomic_rejection')),
                });
                return {
                    resolved: true,
                    pendingAfterSettle: pendingPromise !== null,
                };
            } catch (error) {
                return {
                    resolved: false,
                    errorMessage: error?.message || '',
                    pendingAfterSettle: pendingPromise !== null,
                };
            }
        });

        expect(result.resolved).toBe(false);
        expect(result.errorMessage).toBe('atomic_rejection');
        expect(result.pendingAfterSettle).toBe(false);
    });

    test('V87.4 GameRuntimeSessionHandler returns a fresh promise after a settled synchronous start', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');

            const handler = new GameRuntimeSessionHandler({ facade: {}, logger: console });
            let startCalls = 0;
            handler._startMatchAfterGuards = () => {
                startCalls += 1;
                return true;
            };

            const firstPromise = handler.startMatch();
            let nextPromise = null;
            const secondResultPromise = firstPromise.then(() => {
                nextPromise = handler.startMatch();
                return nextPromise;
            });
            const firstResult = await firstPromise;
            const secondResult = await secondResultPromise;

            return {
                firstIsPromise: !!firstPromise && typeof firstPromise.then === 'function',
                samePromiseAfterSettle: firstPromise === nextPromise,
                firstResult,
                secondResult,
                startCalls,
            };
        });

        expect(result.firstIsPromise).toBe(true);
        expect(result.samePromiseAfterSettle).toBe(false);
        expect(result.firstResult).toBe(true);
        expect(result.secondResult).toBe(true);
        expect(result.startCalls).toBe(2);
    });

    test('V87.4 GameRuntimeSessionHandler allows a retry after a rejected finalize leaves an error snapshot behind', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');

            let currentSnapshot = {
                lifecycleState: 'menu',
                finalizeState: 'idle',
            };
            const rejectedFinalize = Promise.reject(new Error('finalize_barrier_failed'));
            rejectedFinalize.catch(() => {});

            const facade = {
                _pendingMatchFinalize: rejectedFinalize,
                _pendingMatchFinalizePlan: {
                    reason: 'return_to_menu',
                },
                getPorts() {
                    return {
                        runtimeProjectionPort: {
                            getSessionRuntimeSnapshot() {
                                return { ...currentSnapshot };
                            },
                        },
                    };
                },
            };

            const handler = new GameRuntimeSessionHandler({ facade, logger: console });
            const firstResult = await handler._awaitPendingFinalizeForStart({ source: 'test' });
            currentSnapshot = {
                lifecycleState: 'menu',
                finalizeState: 'error',
            };
            const retryResult = handler._awaitPendingFinalizeForStart({ source: 'test' });

            return {
                firstResult,
                retryResult,
                pendingFinalizeCleared: facade._pendingMatchFinalize === null,
                pendingFinalizePlanCleared: facade._pendingMatchFinalizePlan === null,
            };
        });

        expect(result.firstResult).toBe(false);
        expect(result.retryResult).toBe(true);
        expect(result.pendingFinalizeCleared).toBe(true);
        expect(result.pendingFinalizePlanCleared).toBe(true);
    });

    test('V87.4 return-to-menu pause intents stay blocked when canReturnToMenu is missing from snapshots', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { createMatchFlowSnapshot } = await import('/src/shared/contracts/SessionRuntimeSnapshotContract.js');
            const {
                canExecutePauseOverlayIntent,
                createPauseOverlayIntentLease,
                PAUSE_OVERLAY_INTENT_TYPES,
            } = await import('/src/shared/runtime/UiIntentAtomicity.js');

            const snapshot = createMatchFlowSnapshot({
                sessionId: 'session-1',
                isPaused: true,
                lifecycleState: 'playing',
                finalizeState: 'idle',
                updatedAt: 3,
            });
            const lease = createPauseOverlayIntentLease(
                snapshot,
                PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
            );

            return {
                snapshotCanReturnToMenu: snapshot.canReturnToMenu,
                leaseIsNull: lease === null,
                canExecute: canExecutePauseOverlayIntent(
                    snapshot,
                    null,
                    PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
                ),
            };
        });

        expect(result.snapshotCanReturnToMenu).toBe(false);
        expect(result.leaseIsNull).toBe(true);
        expect(result.canExecute).toBe(false);
    });

    test('V87.4 PauseOverlayController and GameRuntimeSessionHandler reject stale pause intent leases for resume and return-to-menu', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { PauseOverlayController } = await import('/src/ui/PauseOverlayController.js');
            const { GameRuntimeSessionHandler } = await import('/src/core/runtime/GameRuntimeSessionHandler.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');

            const game = {
                state: GAME_STATE_IDS.PAUSED,
                ui: {
                    pauseOverlay: document.createElement('div'),
                    pauseResumeButton: document.createElement('button'),
                    pauseSettingsButton: document.createElement('button'),
                    pauseSettingsBackButton: document.createElement('button'),
                    pauseMenuButton: document.createElement('button'),
                    pauseSettingsPanel: document.createElement('div'),
                    pauseKeybindP1: document.createElement('div'),
                    pauseKeybindP2: document.createElement('div'),
                    pauseAutoRollToggle: document.createElement('input'),
                    pauseInvertP1: document.createElement('input'),
                    pauseInvertP2: document.createElement('input'),
                },
                settings: {
                    autoRoll: false,
                    invertPitch: { PLAYER_1: false, PLAYER_2: false },
                },
                gameLoop: {
                    requestDeltaReset() { },
                },
            };

            let currentSnapshot = {
                sessionId: 'session-1',
                isPaused: true,
                canReturnToMenu: true,
                lifecycleState: 'playing',
                finalizeState: 'idle',
                updatedAt: 1,
            };
            const seenResumeLeases = [];
            const seenReturnLeases = [];
            let resumeProjectionCalls = 0;
            let finalizeCalls = 0;

            const facade = {
                finalizeMatch(options = {}) {
                    finalizeCalls += 1;
                    return options;
                },
                getPorts() {
                    return {
                        runtimeProjectionPort: {
                            getMatchFlowSnapshot: () => ({ ...currentSnapshot }),
                        },
                        matchUiPort: {
                            applyResumeMatchProjection() {
                                resumeProjectionCalls += 1;
                                currentSnapshot = {
                                    ...currentSnapshot,
                                    isPaused: false,
                                    lifecycleState: 'playing',
                                    updatedAt: currentSnapshot.updatedAt + 1,
                                };
                                game.state = GAME_STATE_IDS.PLAYING;
                                return true;
                            },
                        },
                    };
                },
            };

            const handler = new GameRuntimeSessionHandler({ facade, logger: console });
            const controller = new PauseOverlayController({
                matchFlowUiController: {
                    game,
                    applyLifecycleTransition() { },
                    applyMatchUiState() { },
                    applyReturnToMenuUi() {
                        throw new Error('fallback return UI should stay behind runtime intent path');
                    },
                },
                game,
                ports: {
                    runtimeProjectionPort: {
                        getMatchFlowSnapshot: () => ({ ...currentSnapshot }),
                        getSessionRuntimeSnapshot: () => ({ isHost: true }),
                    },
                    runtimeIntentPort: {
                        resumeMatch(options = undefined) {
                            seenResumeLeases.push(options?.pauseLease || null);
                            currentSnapshot = {
                                ...currentSnapshot,
                                isPaused: false,
                                lifecycleState: 'playing',
                                updatedAt: currentSnapshot.updatedAt + 1,
                            };
                            game.state = GAME_STATE_IDS.PLAYING;
                            return handler.resumeMatch(options);
                        },
                        returnToMenu(options = undefined) {
                            seenReturnLeases.push(options?.pauseLease || null);
                            currentSnapshot = {
                                ...currentSnapshot,
                                canReturnToMenu: false,
                                finalizeState: 'finalizing',
                                updatedAt: currentSnapshot.updatedAt + 1,
                            };
                            return handler.returnToMenu(options);
                        },
                    },
                },
            });

            const staleResumeResult = controller.resumeFromPause();
            currentSnapshot = {
                sessionId: 'session-1',
                isPaused: true,
                canReturnToMenu: true,
                lifecycleState: 'playing',
                finalizeState: 'idle',
                updatedAt: 10,
            };
            game.state = GAME_STATE_IDS.PAUSED;
            const staleReturnResult = controller.returnToMenuFromPause();

            return {
                staleResumeResult,
                staleReturnResult,
                seenResumeLeaseUpdatedAt: Number(seenResumeLeases[0]?.updatedAt || 0),
                seenReturnLeaseUpdatedAt: Number(seenReturnLeases[0]?.updatedAt || 0),
                seenResumeLeasePaused: seenResumeLeases[0]?.isPaused === true,
                seenReturnLeaseCanReturn: seenReturnLeases[0]?.canReturnToMenu === true,
                resumeProjectionCalls,
                finalizeCalls,
            };
        });

        expect(result.staleResumeResult).toBe(false);
        expect(result.staleReturnResult).toBe(false);
        expect(result.seenResumeLeaseUpdatedAt).toBe(1);
        expect(result.seenReturnLeaseUpdatedAt).toBe(10);
        expect(result.seenResumeLeasePaused).toBe(true);
        expect(result.seenReturnLeaseCanReturn).toBe(true);
        expect(result.resumeProjectionCalls).toBe(0);
        expect(result.finalizeCalls).toBe(0);
    });

    test('V87.4 return-to-menu pause intents avoid UI side effects when the runtime path rejects them', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');
            const { returnToMenuFromPauseIntent } = await import('/src/ui/PauseOverlayIntentActions.js');

            let hideSettingsCalls = 0;
            let hideHostOverlayCalls = 0;
            let restoreLabelsCalls = 0;
            const snapshot = {
                sessionId: 'session-1',
                isPaused: true,
                canReturnToMenu: true,
                lifecycleState: 'playing',
                finalizeState: 'idle',
                updatedAt: 1,
            };

            const resultValue = returnToMenuFromPauseIntent({
                game: { state: GAME_STATE_IDS.PAUSED },
                runtimePort: {
                    returnToMenu() {
                        return false;
                    },
                },
                _getMatchFlowSnapshot() {
                    return { ...snapshot };
                },
                _hideSettings() {
                    hideSettingsCalls += 1;
                },
                hideHostPausedOverlay() {
                    hideHostOverlayCalls += 1;
                },
                _restorePauseButtonLabels() {
                    restoreLabelsCalls += 1;
                },
            });

            return {
                resultValue,
                hideSettingsCalls,
                hideHostOverlayCalls,
                restoreLabelsCalls,
            };
        });

        expect(result.resultValue).toBe(false);
        expect(result.hideSettingsCalls).toBe(0);
        expect(result.hideHostOverlayCalls).toBe(0);
        expect(result.restoreLabelsCalls).toBe(0);
    });

    test('V87.4 authored map presets keep portal, gate and parcours contracts aligned', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MAP_PRESET_CATALOG } = await import('/src/core/config/maps/MapPresetCatalog.js');
            const { toArenaMapDefinition } = await import('/src/entities/mapSchema/MapSchemaRuntimeOps.js');

            const presetKeys = ['abyssal_descent', 'neon_circuit', 'sky_islands'];
            return presetKeys.map((presetKey) => {
                const runtime = toArenaMapDefinition(MAP_PRESET_CATALOG[presetKey], { name: presetKey });
                const checkpoints = runtime.map.parcours?.checkpoints || [];
                const baseCheckpoints = checkpoints.filter((entry) => !entry?.aliasOf);
                const checkpointIdSequence = baseCheckpoints.map((entry) => entry?.id || '');
                const hasSequentialCheckpointIds = checkpointIdSequence.every((id, index) => id === `CP${String(index + 1).padStart(2, '0')}`);
                const invalidAliasCount = checkpoints.filter((entry) => entry?.aliasOf && !checkpointIdSequence.includes(entry.aliasOf)).length;
                const invalidPortalCount = (runtime.map.portals || []).filter((portal) => {
                    const posA = Array.isArray(portal?.a) ? portal.a : [];
                    const posB = Array.isArray(portal?.b) ? portal.b : [];
                    const allFinite = [...posA, ...posB].every((value) => Number.isFinite(value));
                    const distinctEndpoints = posA.length === 3
                        && posB.length === 3
                        && posA.some((value, index) => value !== posB[index]);
                    return !allFinite || !distinctEndpoints;
                }).length;
                const invalidGateCount = (runtime.map.gates || []).filter((gate) => {
                    const forward = Array.isArray(gate?.forward) ? gate.forward : [];
                    const pos = Array.isArray(gate?.pos) ? gate.pos : [];
                    const params = gate?.params && typeof gate.params === 'object' ? Object.values(gate.params) : [];
                    return !gate?.id
                        || pos.length !== 3
                        || !pos.every((value) => Number.isFinite(value))
                        || forward.length !== 3
                        || !forward.every((value) => Number.isFinite(value))
                        || params.length === 0
                        || !params.every((value) => typeof value !== 'number' || Number.isFinite(value));
                }).length;

                return {
                    presetKey,
                    warningCount: runtime.warnings.length,
                    portalCount: runtime.map.portals.length,
                    gateCount: runtime.map.gates.length,
                    hasSequentialCheckpointIds,
                    invalidAliasCount,
                    invalidPortalCount,
                    invalidGateCount,
                    finishId: runtime.map.parcours?.finish?.id || '',
                };
            });
        });

        for (const preset of result) {
            expect(preset.warningCount).toBe(0);
            expect(preset.portalCount).toBeGreaterThan(0);
            expect(preset.gateCount).toBeGreaterThan(0);
            expect(preset.hasSequentialCheckpointIds).toBe(true);
            expect(preset.invalidAliasCount).toBe(0);
            expect(preset.invalidPortalCount).toBe(0);
            expect(preset.invalidGateCount).toBe(0);
            expect(preset.finishId).toBe('FINISH');
        }
    });

    test('V87.4 SessionRuntimeStateMachine blocks FINALIZING -> MENU until finalize completion is explicit', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');
            const {
                applySessionRuntimeLifecycleTransition,
                syncSessionRuntimeLifecycleWithGameState,
                SESSION_RUNTIME_STATES,
            } = await import('/src/shared/contracts/SessionRuntimeStateMachine.js');
            const { SESSION_RUNTIME_EVENT_TYPES } = await import('/src/shared/contracts/SessionRuntimeEventContract.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');

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

            return {
                blockedGameStateChanged: blockedGameStateSync?.changed === true,
                blockedGameStateNextState: blockedGameStateSync?.nextState || null,
                blockedExplicitChanged: blockedExplicitMenu?.changed === true,
                blockedExplicitNextState: blockedExplicitMenu?.nextState || null,
                completedChanged: completedTransition?.changed === true,
                completedNextState: completedTransition?.nextState || null,
                lifecycleState: sessionRuntime.lifecycle.status || null,
                gameStateId: sessionRuntime.lifecycle.gameStateId || null,
            };
        });

        expect(result.blockedGameStateChanged).toBe(false);
        expect(result.blockedGameStateNextState).toBe('finalizing');
        expect(result.blockedExplicitChanged).toBe(false);
        expect(result.blockedExplicitNextState).toBe('finalizing');
        expect(result.completedChanged).toBe(true);
        expect(result.completedNextState).toBe('menu');
        expect(result.lifecycleState).toBe('menu');
        expect(result.gameStateId).toBe('MENU');
    });

    test('V87.4 MatchLifecycleSessionOrchestrator keeps cleanup in FINALIZING until match_finalized is recorded', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MatchLifecycleSessionOrchestrator } = await import('/src/state/MatchLifecycleSessionOrchestrator.js');
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');
            const { GAME_STATE_IDS } = await import('/src/shared/contracts/GameStateIds.js');
            const { SESSION_RUNTIME_STATES } = await import('/src/shared/contracts/SessionRuntimeStateMachine.js');
            const { recordSessionRuntimeEvent } = await import('/src/shared/runtime/SessionRuntimeObservability.js');

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

            return {
                cleanupSnapshots,
                eventTypes,
                finalizedIndex: eventTypes.indexOf('match_finalized'),
                menuOpenedIndex: eventTypes.indexOf('menu_opened'),
                finalLifecycleState: sessionRuntime.lifecycle.status || null,
                finalFinalizeState: sessionRuntime.finalize.status || null,
                lifecycleEvents,
            };
        });

        expect(result.cleanupSnapshots).toHaveLength(3);
        expect(result.cleanupSnapshots.every((entry) => entry.lifecycleState === 'finalizing')).toBe(true);
        expect(result.cleanupSnapshots.every((entry) => entry.finalizeState === 'finalizing')).toBe(true);
        expect(result.finalizedIndex).toBeGreaterThanOrEqual(0);
        expect(result.menuOpenedIndex).toBeGreaterThan(result.finalizedIndex);
        expect(result.finalLifecycleState).toBe('menu');
        expect(result.finalFinalizeState).toBe('finalized');
        expect(result.lifecycleEvents.some((entry) => entry.type === 'menu_opened' && entry.reason === 'return_to_menu')).toBe(true);
    });

    test('V87.4 SessionRuntimeObservability keeps a bounded event history via copy-based trimming', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { createFallbackSessionRuntimeState } = await import('/src/state/MatchLifecycleSessionRuntimeState.js');
            const {
                recordSessionRuntimeEvent,
                SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT,
            } = await import('/src/shared/runtime/SessionRuntimeObservability.js');
            const { SESSION_RUNTIME_EVENT_TYPES } = await import('/src/shared/contracts/SessionRuntimeEventContract.js');

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
            return {
                limit: SESSION_RUNTIME_OBSERVABILITY_HISTORY_LIMIT,
                totalEvents,
                length: events.length,
                firstSequence: events[0]?.sequence || 0,
                lastSequence: events[events.length - 1]?.sequence || 0,
                firstPayloadIndex: events[0]?.payload?.index || 0,
                lastPayloadIndex: events[events.length - 1]?.payload?.index || 0,
                allNewArrays: identityChanges.every(Boolean),
            };
        });

        expect(result.length).toBe(result.limit);
        expect(result.firstSequence).toBe(result.totalEvents - result.limit + 1);
        expect(result.lastSequence).toBe(result.totalEvents);
        expect(result.firstPayloadIndex).toBe(result.totalEvents - result.limit + 1);
        expect(result.lastPayloadIndex).toBe(result.totalEvents);
        expect(result.allNewArrays).toBe(true);
    });

    test('V74.3 GameRuntimeFacade suppresses menu cleanup when shutdown reuses pending finalize flow', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameRuntimeFacade } = await import('/src/core/GameRuntimeFacade.js');

            const callLog = [];
            let resolveFinalize = null;
            const facade = new GameRuntimeFacade({
                game: {
                    hudRuntimeSystem: {
                        clearNetworkScoreboard() {
                            callLog.push('clearScoreboard');
                        },
                    },
                },
                ports: {
                    sessionPort: {
                        clearLastRoundGhost() {
                            callLog.push('clearGhost');
                        },
                        finalizeMatchSession(options) {
                            callLog.push(`finalize:${options?.reason || 'none'}`);
                            return new Promise((resolve) => {
                                resolveFinalize = () => {
                                    callLog.push('finalizeResolved');
                                    resolve(true);
                                };
                            });
                        },
                    },
                    inputPort: {
                        clearPlayerSources() {
                            callLog.push('clearInput');
                        },
                    },
                    matchUiPort: {
                        applyReturnToMenuUi(options) {
                            callLog.push(`applyUi:${options?.reason || 'none'}`);
                        },
                    },
                },
            });

            facade.teardownRuntimeSession = () => {
                callLog.push('teardownRuntime');
            };
            facade.scheduleMatchPrewarm = () => {
                callLog.push('schedulePrewarm');
            };
            facade._resetArcadeRunState = () => {
                callLog.push('resetArcade');
            };

            const returnPromise = facade.returnToMenu({ reason: 'return_to_menu' });
            facade.dispose();
            callLog.push('disposeRequested');
            resolveFinalize?.();
            const returnResult = await returnPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            return {
                callLog,
                returnResult,
            };
        });

        expect(result.returnResult).toBeTruthy();
        expect(result.callLog.filter((entry) => entry === 'finalize:return_to_menu')).toHaveLength(1);
        expect(result.callLog).toEqual(expect.arrayContaining([
            'clearGhost',
            'teardownRuntime',
            'clearInput',
            'clearScoreboard',
            'resetArcade',
            'disposeRequested',
            'finalizeResolved',
        ]));
        expect(result.callLog).not.toContain('applyUi:return_to_menu');
        expect(result.callLog).not.toContain('schedulePrewarm');
    });
});
