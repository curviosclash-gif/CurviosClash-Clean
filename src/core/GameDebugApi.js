import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';
import { createMapBalancingLiveApi, registerMapBalancingLiveSource } from './balancing/MapBalancingLive.js';
import { createTelemetryDevApi, registerTelemetryDevSource } from './telemetry/TelemetryDevApi.js';
import { resolveElectronDeveloperEnvironment } from '../platform/electron/ElectronPlatformBridge.js';
import { resolveHuntParcoursVariant } from '../shared/contracts/HuntParcoursContract.js';

export function createGameDebugRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const actionShowStatusToast = (message, durationMs, tone) => {
            game?._showStatusToast?.(message, durationMs, tone);
        };
        return {
            getRecorder: () => game?.recorder || null,
            getRuntimePerfProfiler: () => game?.runtimePerfProfiler || null,
            getMediaRecorderSystem: () => game?.mediaRecorderSystem || null,
            getEntityManager: () => game?.entityManager || null,
            getRuntimeFacade: () => game?.runtimeCoordinator?.getRuntimeFacade?.() || null,
            getSettingsManager: () => game?.settingsManager || null,
            isDevelopmentEnvironment: () => resolveElectronDeveloperEnvironment() || import.meta.env?.DEV === true,
            async startHuntParcours(variantId, { humanCount = 1, profileIds = null } = {}) {
                const variant = resolveHuntParcoursVariant(variantId);
                if (!game || game.state !== 'MENU' || !['nemesis', 'thunderflight', 'fox_hunt'].includes(variant?.id)) return false;
                const profileId = game.playerProfileManager?.getActiveProfile?.()?.id;
                if (typeof profileId !== 'string' || !profileId.trim()) return false;
                const count = Number(humanCount);
                if (![1, 2, 3].includes(count) || (count > 1 && variant.id !== 'fox_hunt')) return false;
                const ids = profileIds || (count === 1 ? [profileId.trim()] : game.settings.arcade?.playerProfileIds);
                const profiles = game.playerProfileManager?.getProfiles?.() || [{ id: profileId.trim() }];
                if (!Array.isArray(ids) || ids.length < count || ids.slice(0, count).some(id => !profiles.some(p => p.id === id))
                    || new Set(ids.slice(0, count)).size !== count) return false;
                Object.assign(game.settings, { mode: count === 1 ? '1p' : '2p', numHumans: count, numBots: variant.botCount, gameMode: 'ARCADE', mapKey: variant.mapKeys[0], winsNeeded: 15 });
                Object.assign(game.settings.arcade, { enabled: true, runType: 'hunt_parcours', huntParcoursVariantId: variant.id,
                    seed: variant.seed, journeyStageId: '', dailyChallenge: false, companionCount: 0,
                    playerProfileIds: Array.from({ length: 3 }, (_, index) => index < count ? ids[index] : '') });
                Object.assign(game.settings.localSettings, { sessionType: count === 1 ? 'single' : 'splitscreen', modePath: 'arcade', multiplayerTransport: '',
                    splitScreenVariant: count === 3 ? 'three_player' : 'standard' });
                game.settings.localSettings.startSetup = { ...game.settings.localSettings.startSetup,
                    arcadePlayerProfileIds: Array.from({ length: 3 }, (_, index) => index < count ? ids[index] : '') };
                await game._onSettingsChanged?.();
                return game.runtimeCoordinator?.getRuntimeFacade?.()?.startMatch?.() ?? false;
            },
            setRecorderFrameCaptureEnabled(enabled) {
                if (!game) return;
                game._recorderFrameCaptureEnabled = !!enabled;
                game.recorder?.setFrameCaptureEnabled?.(game._recorderFrameCaptureEnabled);
            },
            actionShowStatusToast,
            showStatusToast: actionShowStatusToast,
        };
    });
}

export class GameDebugApi {
    constructor(runtimeAccess = {}) {
        this.runtimeAccess = runtimeAccess && typeof runtimeAccess === 'object'
            ? runtimeAccess
            : {};
        registerMapBalancingLiveSource(() => this.runtimeAccess.getRuntimeFacade?.() || null);
        registerTelemetryDevSource(() => this.runtimeAccess.getSettingsManager?.() || null);
    }

    /** Developer tools (F7 console, balancing MCP) read and tune the map balancing here. */
    getMapBalancingLive() {
        return createMapBalancingLiveApi();
    }

    /** Developer tools (F7 console, playtest MCP) read, export and clear round telemetry here. */
    getTelemetry() {
        return createTelemetryDevApi({ getSettingsManager: () => this.runtimeAccess.getSettingsManager?.() || null });
    }

    getRuntimePerformanceSnapshot(options = {}) {
        const profiler = this.runtimeAccess.getRuntimePerfProfiler?.() || null;
        const performance = typeof profiler?.getSnapshot === 'function'
            ? profiler.getSnapshot(options)
            : null;
        const recorder = this.runtimeAccess.getMediaRecorderSystem?.()?.getRecordingDiagnostics?.() || null;
        return { performance, recorder };
    }

    resetRuntimePerformanceSamples() {
        const profiler = this.runtimeAccess.getRuntimePerfProfiler?.() || null;
        if (typeof profiler?.reset !== 'function') return false;
        profiler.reset();
        return true;
    }

    resolveRecorderFrameCaptureEnabledDefault() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = params.get('recordframes') || params.get('recorderFrames');
            if (!raw) return false;
            return ['1', 'true', 'on'].includes(String(raw).trim().toLowerCase());
        } catch {
            return false;
        }
    }

    setRecorderFrameCaptureEnabled(enabled) {
        this.runtimeAccess.setRecorderFrameCaptureEnabled?.(enabled);
    }

    startHuntParcours(variantId = 'nemesis', options = {}) {
        if (this.runtimeAccess.isDevelopmentEnvironment?.() !== true) return false;
        return this.runtimeAccess.startHuntParcours?.(variantId, options) ?? false;
    }

    // ---- Match diagnostics for desktop measurements (bot flight safety) ----

    /** Simulation time of the running match in ms; 0 without a match. */
    getSimulationClockMs() {
        const callbacks = this.runtimeAccess.getEntityManager?.()?.getRuntimeContext?.()?.callbacks;
        return Math.max(0, Number(callbacks?.getSimulationNowMs?.()) || 0);
    }

    /** The shared bot flight-safety filter of the running match, or null. */
    getBotFlightSafety() {
        return this.runtimeAccess.getEntityManager?.()?.runtime?.systems?.playerInputSystem?.flightSafety || null;
    }

    /**
     * Keeps the running round from ending while a measurement needs the bots past the first deaths.
     * @returns {boolean} false without a running match
     */
    setRoundEndHold(active) {
        const roundOutcomeSystem = this.runtimeAccess.getEntityManager?.()?.runtime?.systems?.roundOutcomeSystem;
        if (typeof roundOutcomeSystem?.setRoundEndHold !== 'function') return false;
        roundOutcomeSystem.setRoundEndHold(active);
        return true;
    }
}
