import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { isCinematicCaptureProfile } from '../shared/contracts/RecordingCaptureContract.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';

// Breites Messfenster (~3s bei 60fps): der Regler soll auf anhaltende Last reagieren,
// nicht auf einzelne Frame-Spikes.
const FPS_TRACKER_WINDOW = 180;
const ADAPTIVE_CHECK_INTERVAL_SECONDS = 3.0;
// Nach jedem Stufenwechsel pausiert der Regler, damit er nicht seine eigene Wirkung misst
// und zwischen zwei Stufen hin- und herpendelt.
const ADAPTIVE_COOLDOWN_SECONDS = 10.0;
// Breite Hysterese: ein Stufenwechsel verschiebt die Framerate selbst um 20-40%.
const ADAPTIVE_FPS_THRESHOLDS = Object.freeze({
    HIGH_TO_MEDIUM: 45,
    MEDIUM_TO_LOW: 25,
    LOW_TO_MEDIUM: 50,
    MEDIUM_TO_HIGH: 58,
});

// Diagnose-Hotkeys hoeren global mit. Wer gerade in ein Eingabefeld tippt, meint den
// Buchstaben und nicht den Schalter - solche Tastendruecke gehoeren dem Feld.
function isTextEntryEventTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.isContentEditable === true) return true;
    const tagName = String(target.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function formatMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '0.0';
    return numeric.toFixed(1);
}

function createFpsTracker(windowSize = FPS_TRACKER_WINDOW) {
    return {
        samples: new Float32Array(windowSize),
        writeIndex: 0,
        count: 0,
        sum: 0,
        avg: 60,
        update(dt) {
            if (!(dt > 0)) return;

            const fps = 1 / dt;
            if (this.count < windowSize) {
                this.samples[this.writeIndex] = fps;
                this.sum += fps;
                this.count++;
            } else {
                const previous = this.samples[this.writeIndex];
                this.samples[this.writeIndex] = fps;
                this.sum += fps - previous;
            }

            this.writeIndex = (this.writeIndex + 1) % windowSize;
            this.avg = this.count > 0 ? this.sum / this.count : 60;
        },
        reset() {
            this.samples.fill(0);
            this.writeIndex = 0;
            this.count = 0;
            this.sum = 0;
            this.avg = 60;
        },
    };
}

function isCinematicRecordingActive(recorder) {
    if (!recorder || recorder.isRecording?.() !== true) return false;
    const profile = recorder.getRecordingCaptureSettings?.()?.profile;
    return isCinematicCaptureProfile(profile);
}

function resolveEffectiveQualityLabel(renderer, isLowQuality = false) {
    const effectiveQuality = renderer?.getQualityState?.()?.effectiveQuality;
    if (effectiveQuality === 'LOW' || effectiveQuality === 'MEDIUM' || effectiveQuality === 'HIGH') {
        return effectiveQuality;
    }
    return isLowQuality ? 'LOW' : 'HIGH';
}

export function createRuntimeDiagnosticsRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const actionShowStatusToast = (message, durationMs, tone) => {
            game?._showStatusToast?.(message, durationMs, tone);
        };
        return {
        getKeyCaptureActive: () => !!game?.keyCapture,
        getRenderer: () => game?.renderer || null,
        getMediaRecorderSystem: () => game?.mediaRecorderSystem || null,
        actionShowStatusToast,
        // Backward-compatible aliases for transitional call sites.
        isKeyCaptureActive: () => !!game?.keyCapture,
        showStatusToast: actionShowStatusToast,
        getRenderDelta: () => Number(game?._renderDelta),
        getEntityManager: () => game?.entityManager || null,
        getRuntimePerfProfiler: () => game?.runtimePerfProfiler || null,
        getState: () => game?.state || null,
    };
    });
}

export class RuntimeDiagnosticsSystem {
    constructor(runtimeAccess = {}) {
        this.runtimeAccess = runtimeAccess && typeof runtimeAccess === 'object'
            ? runtimeAccess
            : {};
        this._onKeyDown = (event) => this._handleKeyDown(event);
        this._adaptiveTimer = 0;
        this._adaptiveCooldown = 0;
        this._statsTimer = 0;
        this._isLowQuality = false;
        this._autoLowActive = false;
        this._quality = 'HIGH';
        this._statsElement = null;
        this._fpsTracker = createFpsTracker();

        window.addEventListener('keydown', this._onKeyDown);
    }

    _handleKeyDown(event) {
        if (this.runtimeAccess.getKeyCaptureActive?.()) return;
        if (isTextEntryEventTarget(event?.target)) return;

        const renderer = this.runtimeAccess.getRenderer?.() || null;
        const recorder = this.runtimeAccess.getMediaRecorderSystem?.() || null;

        if (event.code === 'KeyP') {
            this._isLowQuality = !this._isLowQuality;
            this._autoLowActive = false;
            this._quality = this._isLowQuality ? 'LOW' : 'HIGH';
            const quality = this._isLowQuality ? 'LOW' : 'HIGH';
            renderer?.setQuality?.(quality);
            this._startAdaptiveCooldown();
            if (quality === 'LOW' && isCinematicRecordingActive(recorder)) {
                this.runtimeAccess.actionShowStatusToast?.(
                    'Grafik: Niedrig vorgemerkt (waehrend Cinematic-Aufnahme bleibt Hoch)'
                );
            } else {
                this.runtimeAccess.actionShowStatusToast?.(
                    `Grafik: ${quality === 'LOW' ? 'Niedrig (Schnell)' : 'Hoch (Schoen)'}`
                );
            }
            return;
        }

        if (event.code !== 'KeyO') return;

        if (!this._statsElement) {
            // Intentional runtime-debug adapter: stats overlay stays in core and is not part of gameplay UI.
            this._statsElement = document.createElement('div');
            this._statsElement.style.cssText = 'position:fixed;top:10px;left:10px;color:#0f0;font:13px/1.5 monospace;z-index:1000;pointer-events:none;background:rgba(0,0,0,0.6);padding:8px 12px;border-radius:6px;min-width:200px;white-space:pre-wrap;';
            document.body.appendChild(this._statsElement);
            this._statsTimer = 0;
        } else {
            this._statsElement.remove();
            this._statsElement = null;
        }
    }

    update(dt) {
        const renderer = this.runtimeAccess.getRenderer?.() || null;
        const entityManager = this.runtimeAccess.getEntityManager?.() || null;
        const recorder = this.runtimeAccess.getMediaRecorderSystem?.() || null;
        const renderDt = this.runtimeAccess.getRenderDelta?.();
        this._fpsTracker.update(Number.isFinite(renderDt) && renderDt > 0 ? renderDt : dt);

        if (this._statsElement) {
            this._statsTimer += dt;
            if (this._statsTimer >= 0.25) {
                this._statsTimer = 0;
                const info = renderer.renderer.info;
                const fps = Math.round(this._fpsTracker.avg);
                const draws = info.render.calls || 0;
                const tris = info.render.triangles || 0;
                const geos = info.memory.geometries || 0;
                const texs = info.memory.textures || 0;
                const players = entityManager ? entityManager.players.filter((player) => player.alive).length : 0;
                const quality = resolveEffectiveQualityLabel(renderer, this._isLowQuality);
                const perfSnapshot = this.runtimeAccess.getRuntimePerfProfiler?.()?.getSnapshot?.({
                    windowSize: 240,
                    spikeEventsLimit: 0,
                }) || null;
                const frameAvgMs = perfSnapshot?.frameMs?.avg || 0;
                const frameP95Ms = perfSnapshot?.frameMs?.p95 || 0;
                const frameP99Ms = perfSnapshot?.frameMs?.p99 || 0;
                const spikeRecent = perfSnapshot?.spikes?.recent || 0;
                const spikeThreshold = perfSnapshot?.spikes?.thresholdMs || 0;
                const fpsLine = document.createElement('b');
                fpsLine.style.color = fps < 30 ? '#f44' : fps < 50 ? '#fa0' : '#0f0';
                fpsLine.textContent = `FPS: ${fps}`;
                const detailLines = document.createElement('span');
                detailLines.textContent =
                    `\nDraw Calls: ${draws}\n` +
                    `Dreiecke: ${(tris / 1000).toFixed(1)}k\n` +
                    `Geometrien: ${geos}\n` +
                    `Texturen: ${texs}\n` +
                    `Spieler: ${players}\n` +
                    `Qualitaet: ${quality}\n` +
                    `Frame ms avg/p95/p99: ${formatMs(frameAvgMs)} / ${formatMs(frameP95Ms)} / ${formatMs(frameP99Ms)}\n` +
                    `Spikes>${formatMs(spikeThreshold)}ms: ${spikeRecent}`;
                this._statsElement.replaceChildren(fpsLine, detailLines);
            }
        }

        if (this._adaptiveCooldown > 0) {
            this._adaptiveCooldown = Math.max(0, this._adaptiveCooldown - dt);
        }

        this._adaptiveTimer += dt;
        if (this._adaptiveTimer < ADAPTIVE_CHECK_INTERVAL_SECONDS) return;
        this._adaptiveTimer = 0;
        if (this._adaptiveCooldown > 0) return;

        const avgFps = this._fpsTracker.avg;
        const isPlaying = this.runtimeAccess.getState?.() === GAME_STATE_IDS.PLAYING;
        const isRecording = isCinematicRecordingActive(recorder);
        if (!isPlaying || isRecording) return;

        let nextQuality = this._quality;
        if (this._quality === 'HIGH' && avgFps < ADAPTIVE_FPS_THRESHOLDS.HIGH_TO_MEDIUM) {
            nextQuality = 'MEDIUM';
        } else if (this._quality === 'MEDIUM' && avgFps < ADAPTIVE_FPS_THRESHOLDS.MEDIUM_TO_LOW) {
            nextQuality = 'LOW';
        } else if (this._autoLowActive && this._quality === 'LOW' && avgFps > ADAPTIVE_FPS_THRESHOLDS.LOW_TO_MEDIUM) {
            nextQuality = 'MEDIUM';
        } else if (this._autoLowActive && this._quality === 'MEDIUM' && avgFps > ADAPTIVE_FPS_THRESHOLDS.MEDIUM_TO_HIGH) {
            nextQuality = 'HIGH';
        }

        if (nextQuality === this._quality) return;

        const previousQuality = this._quality;
        this._quality = nextQuality;
        this._isLowQuality = nextQuality === 'LOW';
        this._autoLowActive = nextQuality !== 'HIGH';
        renderer?.setQuality?.(nextQuality);
        this._startAdaptiveCooldown();
        this.runtimeAccess.actionShowStatusToast?.(
            previousQuality === 'HIGH' || nextQuality === 'LOW'
                ? 'Grafik automatisch reduziert'
                : 'Grafik automatisch erhoeht'
        );
    }

    _startAdaptiveCooldown() {
        this._adaptiveCooldown = ADAPTIVE_COOLDOWN_SECONDS;
        this._adaptiveTimer = 0;
        // Alte Samples stammen aus der vorherigen Qualitaetsstufe und wuerden den naechsten
        // Vergleich verfaelschen.
        this._fpsTracker.reset();
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        if (this._statsElement) {
            this._statsElement.remove();
            this._statsElement = null;
        }
    }
}
