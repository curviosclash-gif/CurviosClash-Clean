import {
    disposeMatchSessionSystems,
    prepareInitializedMatchSession,
    wireInitializedMatchRuntime,
} from './MatchSessionFactory.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../shared/contracts/PlatformCapabilityData.js';
import { recordSessionRuntimeEvent } from '../shared/runtime/SessionRuntimeObservability.js';

function resolveSessionRuntimeState(runtime) {
    if (!runtime || typeof runtime !== 'object') {
        return null;
    }
    return runtime.sessionRuntime || runtime.runtimeBundle?.sessionRuntime || null;
}

export function createMatchSessionPort(runtime) {
    const sessionRuntime = resolveSessionRuntimeState(runtime);
    const runtimeHandles = sessionRuntime?.handles || null;
    const sessionSettings = sessionRuntime?.session?.settings || null;
    const getCurrentMatchSessionRefs = () => runtime?.matchSessionRuntimeBridge?.getCurrentMatchSessionRefs?.() || null;
    const getCurrentMatchKernel = () => runtime?.matchSessionRuntimeBridge?.getCurrentMatchKernel?.() || null;
    const getCurrentMatchKernelConsumers = () => runtime?.matchSessionRuntimeBridge?.getCurrentMatchKernelConsumers?.() || null;
    const getRecorder = () => runtimeHandles?.mediaRecorderSystem || runtime?.mediaRecorderSystem || runtime?.recorder || null;
    const applyPendingArcadeIntermissionEffects = (players) => runtimeHandles?.runtimePorts?.arcadePort?.applyPendingIntermissionEffects?.(players);
    const isDesktopRuntime = () => runtime?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP;
    return {
        getSessionRuntimeState: () => sessionRuntime,
        getLifecycleState: () => ({
            sessionId: sessionRuntime?.session?.activeSessionId || null,
            mapKey: runtime?.settings?.mapKey || sessionSettings?.mapKey || runtime?.mapKey || null,
            numHumans: Number(sessionSettings?.numHumans ?? runtime?.numHumans) || 0,
            numBots: Number(sessionSettings?.numBots ?? runtime?.numBots) || 0,
            winsNeeded: Number(sessionSettings?.winsNeeded ?? runtime?.winsNeeded) || 0,
            activeGameMode: sessionSettings?.activeGameMode || runtime?.activeGameMode || null,
            gameStateId: sessionRuntime?.lifecycle?.gameStateId || runtime?.state || null,
            lifecycleStatus: sessionRuntime?.lifecycle?.status || null,
            finalizeStatus: sessionRuntime?.finalize?.status || null,
        }),
        recordRuntimeEvent: (type, payload = null, source = 'match_session_port', details = null) => recordSessionRuntimeEvent(sessionRuntime, {
            type,
            source,
            payload: payload && typeof payload === 'object' ? payload : {},
            ...(details && typeof details === 'object' ? details : {}),
        }),
        notifyLifecycleEvent: (type, context) => getRecorder()?.notifyLifecycleEvent?.(type, context),
        prepareInitializedMatchSession: (handlers = {}) => prepareInitializedMatchSession({
            renderer: runtimeHandles?.renderer || runtime?.renderer,
            audio: runtimeHandles?.audio || runtime?.audio,
            recorder: runtime?.recorder,
            runtimeProfiler: runtime?.runtimePerfProfiler,
            settings: runtime?.settings,
            runtimeConfig: runtime?.runtimeConfig,
            baseConfig: runtime?.config || null,
            requestedMapKey: runtime?.settings?.mapKey || sessionSettings?.mapKey || runtime?.mapKey,
            currentSession: getCurrentMatchSessionRefs(),
            isDesktopRuntime,
            ...handlers,
        }),
        wireInitializedMatchRuntime: (initializedMatch, handlers = {}) => wireInitializedMatchRuntime({
            renderer: runtimeHandles?.renderer || runtime?.renderer,
            initializedMatch,
            ...handlers,
        }),
        applyInitializedMatchSession: (initializedMatch) => runtime?.matchSessionRuntimeBridge?.applyInitializedMatchSession?.(initializedMatch),
        getCurrentMatchSessionRefs,
        clearMatchSessionRefs: () => runtime?.matchSessionRuntimeBridge?.clearMatchSessionRefs?.(),
        getCurrentMatchKernelConsumers,
        getCurrentMatchKernelConsumer: (consumerId) => getCurrentMatchKernelConsumers()?.getAdapter?.(consumerId) || null,
        disposePreparedMatchSession: (initializedMatch, options = {}) => {
            if (!initializedMatch?.session) return;
            initializedMatch?.kernelAdapter?.dispose?.();
            initializedMatch?.kernel?.dispose?.();
            disposeMatchSessionSystems(runtime?.renderer, initializedMatch.session, options);
        },
        disposeCurrentMatchSession: (options = {}) => {
            const currentSession = getCurrentMatchSessionRefs();
            if (!currentSession) return;
            disposeMatchSessionSystems(runtime?.renderer, currentSession, options);
        },
        settleRecorder: (trigger = null) => {
            const recorder = getRecorder();
            if (recorder?.settleRecording) {
                return recorder.settleRecording(trigger);
            }
            return null;
        },
        resetRoundRuntime: () => {
            const currentSession = getCurrentMatchSessionRefs();
            const entityManager = currentSession?.entityManager || null;
            const powerupManager = currentSession?.powerupManager || null;
            if (!entityManager || !powerupManager) return;

            for (const player of entityManager.players) {
                player?.trail?.clear?.();
            }
            powerupManager.clear();

            runtime?.recorder?.startRound?.(entityManager.players);
            entityManager.spawnAll();
            runtime?.recorder?.captureSnapshotNow?.(entityManager.players);
            applyPendingArcadeIntermissionEffects(entityManager.players);
            for (const player of entityManager.getHumanPlayers()) {
                player.planarAimOffset = 0;
            }
            getCurrentMatchKernel()?.signalRoundRestart?.();
        },
    };
}
