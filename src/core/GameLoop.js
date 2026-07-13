// ============================================
// GameLoop.js - fixed-step simulation loop with scaled game time
// ============================================
import { createLogger } from '../shared/logging/Logger.js';
import { showRuntimeErrorOverlay } from './RuntimeErrorOverlay.js';

const logger = createLogger('GameLoop');

export class GameLoop {
    constructor(updateFn, renderFn, options = {}) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        this.running = false;
        this.lastTime = 0;
        this.timeScale = 1.0; // Fuer Zeitlupe-Powerup
        this._boundLoop = this._loop.bind(this);
        this.frameId = null;
        this._errorShown = false;
        this.accumulator = 0;
        this.fixedStep = 1 / 60;
        this.maxSubSteps = 3;
        this.renderAlpha = 1;
        this.renderDelta = this.fixedStep;
        this.runtimePerfProfiler = options?.runtimePerfProfiler || null;
        this.largeDeltaResetSeconds = 0.2;
        this.renderFrameId = 0;
        this._dtBuf = new Float64Array(4);
        this._dtBufIdx = 0;
        this._dtBufSum = 0;
        this._dtBufCount = 0;
        this._renderTiming = {
            frameId: 0,
            rawDt: this.fixedStep,
            stabilizedDt: this.fixedStep,
            reset: false,
            resetReason: '',
            timestampMs: 0,
        };
        this._pendingDeltaReset = false;
        this._pendingDeltaResetReason = '';
        this._focusResetEventsAttached = false;
        this._boundWindowBlur = () => this.requestDeltaReset('window-blur');
        this._boundWindowFocus = () => this.requestDeltaReset('window-focus');
        this._boundVisibilityChange = () => {
            const hidden = typeof document !== 'undefined' && document.hidden === true;
            this.requestDeltaReset(hidden ? 'visibility-hidden' : 'visibility-visible');
        };
        this._resetDtBuffer();
    }

    start() {
        this.running = true;
        this.lastTime = performance.now();
        this._errorShown = false;
        this.accumulator = 0;
        this.renderAlpha = 0;
        this.renderDelta = this.fixedStep;
        this.renderFrameId = 0;
        this._resetDtBuffer();
        this.requestDeltaReset('start');
        this._attachFocusResetEvents();
        this.frameId = requestAnimationFrame(this._boundLoop);
    }

    stop() {
        this.running = false;
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this._detachFocusResetEvents();
    }

    setTimeScale(scale) {
        const numericScale = Number(scale);
        this.timeScale = Number.isFinite(numericScale) ? Math.max(0, numericScale) : 1.0;
    }

    requestDeltaReset(reason = 'manual') {
        this._pendingDeltaReset = true;
        this._pendingDeltaResetReason = String(reason || 'manual');
    }

    getRenderTiming() {
        return this._renderTiming;
    }

    _resetDtBuffer() {
        this._dtBuf.fill(0);
        this._dtBufIdx = 0;
        this._dtBufSum = 0;
        this._dtBufCount = 0;
    }

    _attachFocusResetEvents() {
        if (this._focusResetEventsAttached) return;
        if (typeof window !== 'undefined' && window?.addEventListener) {
            window.addEventListener('blur', this._boundWindowBlur);
            window.addEventListener('focus', this._boundWindowFocus);
        }
        if (typeof document !== 'undefined' && document?.addEventListener) {
            document.addEventListener('visibilitychange', this._boundVisibilityChange);
        }
        this._focusResetEventsAttached = true;
    }

    _detachFocusResetEvents() {
        if (!this._focusResetEventsAttached) return;
        if (typeof window !== 'undefined' && window?.removeEventListener) {
            window.removeEventListener('blur', this._boundWindowBlur);
            window.removeEventListener('focus', this._boundWindowFocus);
        }
        if (typeof document !== 'undefined' && document?.removeEventListener) {
            document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        }
        this._focusResetEventsAttached = false;
    }

    _consumeDeltaReset() {
        const reset = this._pendingDeltaReset === true;
        const reason = reset ? (this._pendingDeltaResetReason || 'manual') : '';
        this._pendingDeltaReset = false;
        this._pendingDeltaResetReason = '';
        return { reset, reason };
    }

    _updateRenderTiming(now, rawDt, stabilizedDt, reset, resetReason = '') {
        const timing = this._renderTiming;
        timing.frameId = this.renderFrameId;
        timing.rawDt = rawDt;
        timing.stabilizedDt = stabilizedDt;
        timing.reset = reset === true;
        timing.resetReason = String(resetReason || '');
        timing.timestampMs = now;
        return timing;
    }

    _loop(now) {
        if (!this.running) return;

        let rawDt = (now - this.lastTime) / 1000;
        if (!Number.isFinite(rawDt) || rawDt < 0) {
            rawDt = 0;
        }
        this.lastTime = now;

        const pendingReset = this._consumeDeltaReset();
        const deltaJump = rawDt > this.largeDeltaResetSeconds;
        const shouldResetDelta = deltaJump || pendingReset.reset;
        const resetReason = deltaJump
            ? (pendingReset.reset ? `${pendingReset.reason}|delta-jump` : 'delta-jump')
            : pendingReset.reason;
        if (shouldResetDelta) {
            // Half-Step Seeding: Sorgt dafuer, dass der erste Frame nach einem Reset
            // (z.B. Rundenstart oder Tab-Wechsel) bei renderAlpha ≈ 0.5 liegt.
            // Verhindert den optischen Rücksprung auf die Vorposition (Alpha=0).
            this.accumulator = 0;
            // Ringpuffer bei Reset zuruecksetzen, damit kein alter Jitter einfliesst
            this._resetDtBuffer();
        }

        // Dt-Smoothing via Ringpuffer (4 Frames):
        // Glaettet Mikro-Jitter (~0.5ms) der Browser-rAF, der sonst Alpha 0<->1 springen laesst.
        const clampedRaw = shouldResetDelta ? this.fixedStep : Math.min(rawDt, 0.25);
        this._dtBufSum += clampedRaw - this._dtBuf[this._dtBufIdx];
        this._dtBuf[this._dtBufIdx] = clampedRaw;
        this._dtBufIdx = (this._dtBufIdx + 1) & 3; // & 3 == % 4
        this._dtBufCount = Math.min(this._dtBufCount + 1, this._dtBuf.length);
        const smoothedDt = this._dtBufCount > 0
            ? (this._dtBufSum / this._dtBufCount)
            : this.fixedStep;

        const stabilizedRawDt = shouldResetDelta ? this.fixedStep : smoothedDt;
        const dt = Math.min(stabilizedRawDt, 0.05);
        const runtimePerfProfiler = this.runtimePerfProfiler;
        this.renderFrameId += 1;
        this._updateRenderTiming(now, rawDt, dt, shouldResetDelta, resetReason);
        runtimePerfProfiler?.beginFrame(rawDt * 1000, now);

        this.renderDelta = dt;
        const scaledDt = dt * this.timeScale;
        this.accumulator += scaledDt;

        const maxAccum = this.fixedStep * this.maxSubSteps;
        if (this.accumulator > maxAccum) {
            this.accumulator = maxAccum;
        }

        try {
            while (this.accumulator >= this.fixedStep) {
                const updateStart = runtimePerfProfiler?.startSample?.();
                this.updateFn(this.fixedStep);
                runtimePerfProfiler?.endSample?.('update', updateStart);
                this.accumulator -= this.fixedStep;
            }
            const rawAlpha = this.fixedStep > 0 ? (this.accumulator / this.fixedStep) : 0;
            this.renderAlpha = Number.isFinite(rawAlpha) ? Math.max(0, Math.min(1, rawAlpha)) : 0;
            this.renderFn(this.renderAlpha, this.renderDelta);
        } catch (err) {
            if (!this._errorShown) {
                this._errorShown = true;
                logger.error('GameLoop error:', err);
                showRuntimeErrorOverlay({
                    title: 'FEHLER',
                    lines: [String(err?.message || err || 'Unbekannter Runtime-Fehler')],
                    stack: err?.stack || 'No stack trace',
                });
            }
        }
        runtimePerfProfiler?.endFrame(rawDt * 1000, now);

        this.frameId = requestAnimationFrame(this._boundLoop);
    }
}
