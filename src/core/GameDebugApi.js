import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';

export function createGameDebugRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const actionShowStatusToast = (message, durationMs, tone) => {
            game?._showStatusToast?.(message, durationMs, tone);
        };
        return {
            getRecorder: () => game?.recorder || null,
            getRuntimePerfProfiler: () => game?.runtimePerfProfiler || null,
            getMediaRecorderSystem: () => game?.mediaRecorderSystem || null,
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
}
