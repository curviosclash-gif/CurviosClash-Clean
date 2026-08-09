import { Arena } from '../entities/Arena.js';
import { EntityManager } from '../entities/EntityManager.js';
import { PowerupManager } from '../entities/Powerup.js';
import { ParticleSystem } from '../entities/Particles.js';
import { createEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { createInteractiveMatchKernelRunProfile } from '../shared/contracts/MatchKernelRuntimeContract.js';
import {
    buildArenaSessionKey,
    resolveMatchMap,
    toSafeInt,
} from './match-session/MatchSessionMapOps.js';
import { createInteractiveMatchKernel } from './MatchKernel.js';
import {
    buildEntityManagerSetupOptions,
    disposeMatchSessionSystems,
} from './match-session/MatchSessionSetupOps.js';
import { deriveMapResolutionFeedbackPlan } from './match-session/MatchSessionFeedbackPlan.js';
import {
    awaitActivePrewarmForRenderer,
    clearPrewarmedArenaSession,
    consumePrewarmedArenaSessionIfMatch,
    getActivePrewarmPromiseForRenderer,
    storePrewarmedArenaSession,
    trackPrewarmPromise,
} from './match-session/MatchSessionPrewarmStore.js';

export { disposeMatchSessionSystems } from './match-session/MatchSessionSetupOps.js';

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

function waitForPlayerViewsReady(entityManager) {
    let pending = null;
    for (const player of entityManager?.players || []) {
        const view = player?.view;
        if (!view?.whenReady || view.isReady?.() !== false) continue;
        if (!pending) pending = [];
        pending.push(view.whenReady());
    }
    return pending ? Promise.all(pending) : null;
}

function bindArenaRuntimeMap(arena, mapResolution, effectiveMapKey) {
    if (!arena) return;
    const useRuntimeMap = !!mapResolution?.isCustom
        && !!mapResolution?.mapDefinition
        && typeof mapResolution.mapDefinition === 'object';
    arena.runtimeMapKey = useRuntimeMap ? effectiveMapKey : null;
    arena.runtimeMapDefinition = useRuntimeMap ? mapResolution.mapDefinition : null;
}

export async function prewarmMatchArenaSession({
    renderer,
    settings,
    runtimeConfig = null,
    baseConfig = null,
    requestedMapKey,
} = {}) {
    if (!renderer) return null;

    const portalsEnabled = runtimeConfig?.session?.portalsEnabled ?? !!settings?.portalsEnabled;
    const mapResolution = resolveMatchMap(runtimeConfig, requestedMapKey);
    const effectiveMapKey = mapResolution.effectiveMapKey;
    const sessionKey = buildArenaSessionKey(
        mapResolution,
        runtimeConfig,
        portalsEnabled,
        renderer.getGraphicsStyle?.()
    );

    const existingPrewarmedSession = consumePrewarmedArenaSessionIfMatch(renderer, sessionKey);
    if (existingPrewarmedSession) {
        storePrewarmedArenaSession(existingPrewarmedSession);
        return {
            prewarmed: true,
            reusedExisting: true,
            effectiveMapKey,
            sessionKey,
            arenaBuildResult: existingPrewarmedSession.arenaBuildResult || null,
        };
    }
    const activePrewarmPromise = getActivePrewarmPromiseForRenderer(renderer);
    if (activePrewarmPromise) {
        return activePrewarmPromise;
    }

    await awaitActivePrewarmForRenderer(renderer);

    const awaitedPrewarmedSession = consumePrewarmedArenaSessionIfMatch(renderer, sessionKey);
    if (awaitedPrewarmedSession) {
        storePrewarmedArenaSession(awaitedPrewarmedSession);
        return {
            prewarmed: true,
            reusedExisting: true,
            effectiveMapKey,
            sessionKey,
            arenaBuildResult: awaitedPrewarmedSession.arenaBuildResult || null,
        };
    }

    clearPrewarmedArenaSession();

    const prewarmPromise = (async () => {
        renderer.clearMatchScene();

        const arena = new Arena(renderer);
        arena.portalsEnabled = !!portalsEnabled;
        arena.runtimeConfig = runtimeConfig;
        arena.entityRuntimeConfig = createEntityRuntimeConfig(runtimeConfig, baseConfig);
        bindArenaRuntimeMap(arena, mapResolution, effectiveMapKey);
        const arenaBuildResult = await arena.build(effectiveMapKey, {
            includeAuthoredAircraft: false,
        });

        storePrewarmedArenaSession({
            renderer,
            sessionKey,
            mapResolution,
            effectiveMapKey,
            portalsEnabled: !!portalsEnabled,
            arena,
            arenaBuildResult,
        });

        return {
            prewarmed: true,
            reusedExisting: false,
            effectiveMapKey,
            sessionKey,
            arenaBuildResult,
        };
    })();

    return trackPrewarmPromise(renderer, sessionKey, prewarmPromise);
}

export function createMatchSession({
    renderer,
    audio,
    recorder,
    runtimeProfiler = null,
    settings,
    runtimeConfig = null,
    baseConfig = null,
    requestedMapKey,
    currentSession = null,
    isDesktopRuntime = null,
}) {
    const portalsEnabled = runtimeConfig?.session?.portalsEnabled ?? !!settings?.portalsEnabled;
    const mapResolution = resolveMatchMap(runtimeConfig, requestedMapKey);
    const effectiveMapKey = mapResolution.effectiveMapKey;
    const sessionKey = buildArenaSessionKey(
        mapResolution,
        runtimeConfig,
        portalsEnabled,
        renderer.getGraphicsStyle?.()
    );
    const fallbackHumans = settings?.mode === '2p' ? 2 : 1;
    const fallbackBots = Number(settings?.numBots) || 0;
    const fallbackWinsNeeded = Number(settings?.winsNeeded) || 5;

    const localHumanCount = Math.max(1, toSafeInt(
        runtimeConfig?.session?.localHumanCount,
        toSafeInt(runtimeConfig?.session?.numHumans, fallbackHumans)
    ));
    const numHumans = Math.max(localHumanCount, toSafeInt(
        runtimeConfig?.session?.humanEntityCount,
        localHumanCount
    ));
    const localPlayerIndex = Math.max(0, toSafeInt(runtimeConfig?.session?.localPlayerIndex, 0));
    const numBots = Math.max(0, toSafeInt(runtimeConfig?.session?.numBots, fallbackBots));
    const winsNeeded = Math.max(1, toSafeInt(runtimeConfig?.session?.winsNeeded, fallbackWinsNeeded));
    const entityRuntimeConfig = createEntityRuntimeConfig(runtimeConfig, baseConfig);

    const finalizeSession = (prewarmedArenaSession = null) => {
        const canPreservePrewarmedScene = !!prewarmedArenaSession
            && !currentSession?.entityManager
            && !currentSession?.powerupManager
            && !currentSession?.particles;
        const reusablePrewarmedArenaSession = canPreservePrewarmedScene ? prewarmedArenaSession : null;
        const disposeFailedSession = (session) => {
            if (!session) return;
            try {
                disposeMatchSessionSystems(renderer, session, { clearScene: true });
            } catch {
                // Keep the original session creation error as the primary failure.
            }
        };

        if (currentSession) {
            disposeMatchSessionSystems(renderer, currentSession, {
                clearScene: !canPreservePrewarmedScene,
            });
        }

        const particles = new ParticleSystem(renderer, entityRuntimeConfig);
        const arena = reusablePrewarmedArenaSession?.arena || new Arena(renderer);
        arena.portalsEnabled = !!portalsEnabled;
        arena.runtimeConfig = runtimeConfig;
        arena.entityRuntimeConfig = entityRuntimeConfig;
        bindArenaRuntimeMap(arena, mapResolution, effectiveMapKey);
        const createdSession = {
            particles,
            arena,
            powerupManager: null,
            entityManager: null,
            mapResolution,
            arenaBuildResult: reusablePrewarmedArenaSession?.arenaBuildResult || null,
            effectiveMapKey,
            numHumans,
            localHumanCount,
            localPlayerIndex,
            networkEnabled: runtimeConfig?.session?.networkEnabled === true,
            numBots,
            winsNeeded,
        };

        const buildSessionPayload = (arenaBuildResult = reusablePrewarmedArenaSession?.arenaBuildResult || null) => {
            createdSession.arenaBuildResult = arenaBuildResult;
            createdSession.powerupManager = new PowerupManager(renderer, arena, entityRuntimeConfig);
            createdSession.entityManager = new EntityManager(
                renderer,
                arena,
                createdSession.powerupManager,
                particles,
                audio,
                recorder,
                runtimeProfiler,
                { entityRuntimeConfig }
            );

            createdSession.entityManager.setup(
                numHumans,
                numBots,
                buildEntityManagerSetupOptions(settings, runtimeConfig, entityRuntimeConfig, {
                    isDesktopRuntime,
                })
            );

            const playerViewsReady = waitForPlayerViewsReady(createdSession.entityManager);
            if (isPromiseLike(playerViewsReady)) {
                return Promise.resolve(playerViewsReady).then(() => createdSession);
            }
            return createdSession;
        };

        try {
            if (reusablePrewarmedArenaSession) {
                arena.syncAuthoredAircraftDecorations?.();
                const builtSession = buildSessionPayload();
                return isPromiseLike(builtSession)
                    ? Promise.resolve(builtSession).catch((error) => {
                        disposeFailedSession(createdSession);
                        throw error;
                    })
                    : builtSession;
            }

            const arenaBuildResult = arena.build(effectiveMapKey);
            if (isPromiseLike(arenaBuildResult)) {
                return Promise.resolve(arenaBuildResult)
                    .then((resolvedArenaBuildResult) => buildSessionPayload(resolvedArenaBuildResult))
                    .catch((error) => {
                        disposeFailedSession(createdSession);
                        throw error;
                    });
            }
            const builtSession = buildSessionPayload(arenaBuildResult);
            return isPromiseLike(builtSession)
                ? Promise.resolve(builtSession).catch((error) => {
                    disposeFailedSession(createdSession);
                    throw error;
                })
                : builtSession;
        } catch (error) {
            disposeFailedSession(createdSession);
            throw error;
        }
    };

    const activePrewarmPromise = getActivePrewarmPromiseForRenderer(renderer);
    if (activePrewarmPromise) {
        return Promise.resolve(activePrewarmPromise)
            .catch(() => null)
            .then(() => finalizeSession(consumePrewarmedArenaSessionIfMatch(renderer, sessionKey)));
    }

    return finalizeSession(consumePrewarmedArenaSessionIfMatch(renderer, sessionKey));
}

export function wireMatchSessionRuntime({
    renderer,
    entityManager,
    numHumans,
    onPlayerFeedback = null,
    onPlayerDied = null,
    onRoundEnd = null,
    resetScores = true,
}) {
    if (!renderer || !entityManager) {
        throw new Error('wireMatchSessionRuntime requires renderer and entityManager');
    }

    entityManager.onPlayerFeedback = typeof onPlayerFeedback === 'function' ? onPlayerFeedback : null;
    entityManager.onPlayerDied = typeof onPlayerDied === 'function' ? onPlayerDied : null;
    entityManager.onRoundEnd = typeof onRoundEnd === 'function' ? onRoundEnd : null;

    const cameraCount = Math.max(0, Number(numHumans) || 0);
    for (let i = 0; i < cameraCount; i++) {
        renderer.createCamera(i);
    }

    if (resetScores) {
        for (const player of entityManager.players) {
            player.score = 0;
        }
        // Match aggregates share the scoreboard's lifetime; the recorder outlives a single match.
        entityManager.recorder?.startMatch?.();
    }

    return {
        cameraCount,
        playerCount: Array.isArray(entityManager.players) ? entityManager.players.length : 0,
    };
}

export function initializeMatchSession({
    renderer,
    audio,
    recorder,
    runtimeProfiler = null,
    settings,
    runtimeConfig = null,
    baseConfig = null,
    requestedMapKey,
    currentSession = null,
    isDesktopRuntime = null,
    onPlayerFeedback = null,
    onPlayerDied = null,
    onRoundEnd = null,
    resetScores = true,
}) {
    const preparedMatch = prepareInitializedMatchSession({
        renderer,
        audio,
        recorder,
        runtimeProfiler,
        settings,
        runtimeConfig,
        baseConfig,
        requestedMapKey,
        currentSession,
        isDesktopRuntime,
    });
    const finalizeInitializedMatch = (initializedMatch) => wireInitializedMatchRuntime({
        renderer,
        initializedMatch,
        onPlayerFeedback,
        onPlayerDied,
        onRoundEnd,
        resetScores,
    });
    if (isPromiseLike(preparedMatch)) {
        return Promise.resolve(preparedMatch).then(finalizeInitializedMatch);
    }
    return finalizeInitializedMatch(preparedMatch);
}

export function prepareInitializedMatchSession({
    renderer,
    audio,
    recorder,
    runtimeProfiler = null,
    settings,
    runtimeConfig = null,
    baseConfig = null,
    requestedMapKey,
    currentSession = null,
    isDesktopRuntime = null,
}) {
    const finalizePreparedMatch = (session) => {
        const feedbackPlan = deriveMapResolutionFeedbackPlan({
            mapResolution: session.mapResolution,
            portalsEnabled: runtimeConfig?.session?.portalsEnabled ?? !!settings?.portalsEnabled,
            arenaBuildResult: session.arenaBuildResult,
        });
        return {
            session,
            feedbackPlan,
        };
    };

    const session = createMatchSession({
        renderer,
        audio,
        recorder,
        runtimeProfiler,
        settings,
        runtimeConfig,
        baseConfig,
        requestedMapKey,
        currentSession,
        isDesktopRuntime,
    });
    if (isPromiseLike(session)) {
        return Promise.resolve(session).then(finalizePreparedMatch);
    }
    return finalizePreparedMatch(session);
}

export function wireInitializedMatchRuntime({
    renderer,
    initializedMatch,
    onPlayerFeedback = null,
    onPlayerDied = null,
    onRoundEnd = null,
    resetScores = true,
}) {
    const session = initializedMatch?.session;
    if (!renderer || !session?.entityManager) {
        throw new Error('wireInitializedMatchRuntime requires renderer and initialized match session');
    }
    const kernel = createInteractiveMatchKernel({
        profile: createInteractiveMatchKernelRunProfile({
            matchId: session.effectiveMapKey || null,
            modeId: session.entityManager?.activeGameMode || null,
        }),
        simPorts: {
            entityManager: session.entityManager,
            powerupManager: session.powerupManager,
            particles: session.particles,
            arena: session.arena,
        },
    });
    try {
        kernel.boot({ roundIndex: 0 });
        const runtime = wireMatchSessionRuntime({
            renderer,
            entityManager: session.entityManager,
            numHumans: session.numHumans,
            onPlayerFeedback,
            onPlayerDied,
            onRoundEnd: (winner, outcome = null) => {
                if (outcome?.state === GAME_STATE_IDS.MATCH_END) {
                    kernel.signalMatchEnd();
                } else {
                    kernel.signalRoundEnd({ roundPause: 3 });
                }
                if (typeof onRoundEnd === 'function') {
                    onRoundEnd(winner, outcome);
                }
            },
            resetScores,
        });
        renderer?.viewportSystem?.setNetworkMode?.(
            session.networkEnabled === true,
            Number.isInteger(session.localPlayerIndex) ? session.localPlayerIndex : 0,
            renderer.cameras
        );
        return {
            ...initializedMatch,
            runtime,
            kernel,
        };
    } catch (error) {
        kernel.dispose();
        throw error;
    }
}
