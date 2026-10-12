import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';
import { createMapBalancingLiveApi, registerMapBalancingLiveSource } from './balancing/MapBalancingLive.js';

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
    }

    /** Developer tools (F7 console, balancing MCP) read and tune the map balancing here. */
    getMapBalancingLive() {
        return createMapBalancingLiveApi();
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
