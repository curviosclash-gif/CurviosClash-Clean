const CAPTURE_RENDERER_IDLE_DISPOSE_MS = 60_000;
const MAX_CINEMATIC_RENDERER_FAILURES_PER_RECORDING = 3;

export class CinematicRendererRetryBudget {
    constructor() {
        this.failureCount = 0;
    }

    reset() {
        this.failureCount = 0;
    }

    recordFailure() {
        this.failureCount = Math.min(
            MAX_CINEMATIC_RENDERER_FAILURES_PER_RECORDING,
            this.failureCount + 1
        );
    }

    isExhausted() {
        return this.failureCount >= MAX_CINEMATIC_RENDERER_FAILURES_PER_RECORDING;
    }
}

function defaultScheduler() {
    return {
        now: () => globalThis.performance?.now?.() ?? Date.now(),
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (timer) => globalThis.clearTimeout(timer),
    };
}

export function disposeCaptureRenderer(renderer) {
    if (!renderer) return;
    try { renderer.dispose?.(); } catch { /* Still try to release the context. */ }
    try { renderer.forceContextLoss?.(); } catch { /* The context may already be gone. */ }
}

export function releaseShortsRenderer(pipeline) {
    disposeCaptureRenderer(pipeline._shortsRenderer);
    pipeline._shortsRenderer = null;
    pipeline._shortsCanvas = null;
    pipeline._shortsRendererUnavailable = false;
}

export function releaseCinematicRenderer(pipeline) {
    try { pipeline._cinematicPostProcessingPipeline?.dispose?.(); } catch { /* Still release the renderer. */ }
    pipeline._cinematicPostProcessingPipeline = null;
    disposeCaptureRenderer(pipeline._cinematicRenderer);
    pipeline._cinematicRenderer = null;
    pipeline._cinematicCanvas = null;
    pipeline._cinematicRendererUnavailable = false;
}

export function shouldAttemptCinematicRenderer(pipeline) {
    if (pipeline._cinematicRendererRetryBudget.isExhausted()) {
        pipeline._cinematicRendererUnavailable = true;
        return false;
    }
    if (pipeline._cinematicRendererUnavailable) {
        pipeline._cinematicRendererUnavailable = false;
        return false;
    }
    return true;
}

export function recordCinematicRendererFailure(pipeline) {
    releaseCinematicRenderer(pipeline);
    pipeline._cinematicRendererRetryBudget.recordFailure();
    pipeline._cinematicRendererUnavailable = true;
}

export function releaseCaptureRenderers(pipeline) {
    releaseShortsRenderer(pipeline);
    releaseCinematicRenderer(pipeline);
}

/** Owns only the capture pipeline's idle timer; renderer release stays with its owner. */
export class RecordingCaptureRendererLifecycle {
    constructor({ scheduler = null, isActive, hasRenderers, releaseRenderers }) {
        const defaults = defaultScheduler();
        this.scheduler = {
            now: typeof scheduler?.now === 'function' ? scheduler.now : defaults.now,
            setTimeout: typeof scheduler?.setTimeout === 'function' ? scheduler.setTimeout : defaults.setTimeout,
            clearTimeout: typeof scheduler?.clearTimeout === 'function' ? scheduler.clearTimeout : defaults.clearTimeout,
        };
        this.isActive = isActive;
        this.hasRenderers = hasRenderers;
        this.releaseRenderers = releaseRenderers;
        this.timer = null;
        this.deadline = null;
    }

    cancel() {
        if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
        this.timer = null;
        this.deadline = null;
    }

    schedule() {
        this.cancel();
        if (this.isActive() || !this.hasRenderers()) return;
        const deadline = this.scheduler.now() + CAPTURE_RENDERER_IDLE_DISPOSE_MS;
        this.deadline = deadline;
        const armTimer = () => {
            const remaining = Math.max(0, deadline - this.scheduler.now());
            this.timer = this.scheduler.setTimeout(() => {
                this.timer = null;
                if (this.isActive() || this.deadline !== deadline) return;
                if (this.scheduler.now() < deadline) {
                    armTimer();
                    return;
                }
                this.deadline = null;
                this.releaseRenderers();
            }, remaining);
        };
        armTimer();
    }
}
