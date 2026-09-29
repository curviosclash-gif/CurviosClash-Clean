import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import {
    GRAPHICS_AUTO_PROFILE_STORAGE_KEY,
    GRAPHICS_QUALITY_AUTO,
    GRAPHICS_QUALITY_LEVELS,
    normalizeGraphicsAutoProfile,
    normalizeGraphicsQualitySetting,
} from '../shared/contracts/GraphicsQualityContract.js';
import { isCinematicCaptureProfile } from '../shared/contracts/RecordingCaptureContract.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';
import {
    compareQualityLevels,
    isUltraAllowed,
    recordUltraOutcome,
    resolveAdaptiveQualityStep,
    resolveAutoStartQuality,
    shouldSupersample,
} from './renderer/AdaptiveQualityPolicy.js';

// Breites Messfenster (~3s bei 60fps): der Regler soll auf anhaltende Last reagieren,
// nicht auf einzelne Frame-Spikes.
const FPS_TRACKER_WINDOW = 180;
const ADAPTIVE_CHECK_INTERVAL_SECONDS = 3.0;
// Nach jedem Stufenwechsel pausiert der Regler, damit er nicht seine eigene Wirkung misst
// und zwischen zwei Stufen hin- und herpendelt.
const ADAPTIVE_COOLDOWN_SECONDS = 10.0;
const { LOW, MEDIUM, HIGH, ULTRA } = GRAPHICS_QUALITY_LEVELS;
const NOT_READ = Symbol('not-read');

// A test run must keep its measurements comparable across machines, so the regulator never
// steps up to ULTRA while a tool drives the window. Read at decision time: Playwright attaches
// its API only after boot.
function isAutomationRuntime() {
    const runtimeWindow = typeof window !== 'undefined' ? window : null;
    if (!runtimeWindow) return true;
    return runtimeWindow.navigator?.webdriver === true
        || !!runtimeWindow.CURVIOS_TEST_API
        || !!runtimeWindow.__CURVIOS_AUTOMATION__;
}

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
    if (effectiveQuality === LOW || effectiveQuality === MEDIUM || effectiveQuality === HIGH || effectiveQuality === ULTRA) {
        return effectiveQuality;
    }
    return isLowQuality ? LOW : HIGH;
}

function formatGpuLine(renderer) {
    const stats = renderer?.qualityController?.gpuFrameTimer?.getStats?.();
    return stats && stats.samples > 0 ? `GPU ms (Median): ${formatMs(stats.medianMs)}\n` : '';
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
        getGraphicsQualitySetting: () => game?.settings?.localSettings?.graphicsQuality,
        getBloomQualityUserSet: () => game?.settings?.localSettings?.bloomQualityUserSet === true,
        getSettingsRecordStore: () => game?.settingsManager?.settingsRecordStorePort || null,
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
        this._quality = HIGH;
        this._ultraSupersample = false;
        this._qualitySetting = GRAPHICS_QUALITY_AUTO;
        this._rawQualitySetting = NOT_READ;
        this._bloomUserSet = NOT_READ;
        this._autoProfile = null;
        this._playingSeconds = 0;
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
            const quality = this._isLowQuality ? HIGH : LOW;
            this._autoLowActive = false;
            this._setQuality(renderer, quality, false);
            this._startAdaptiveCooldown(renderer);
            if (quality === 'LOW' && isCinematicRecordingActive(recorder)) {
                this.runtimeAccess.actionShowStatusToast?.(
                    'Grafik: Niedrig vorgemerkt (während Cinematic-Aufnahme bleibt Hoch)'
                );
            } else {
                this.runtimeAccess.actionShowStatusToast?.(
                    `Grafik: ${quality === 'LOW' ? 'Niedrig (Schnell)' : 'Hoch (Schön)'}`
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
        this._syncQualitySettings(renderer);
        const isPlaying = this.runtimeAccess.getState?.() === GAME_STATE_IDS.PLAYING;
        if (!isPlaying) {
            this._playingSeconds = 0;
        } else {
            // GPU samples from the menu or the loading screen say nothing about the round.
            if (this._playingSeconds === 0) renderer?.qualityController?.gpuFrameTimer?.reset?.();
            this._playingSeconds += Math.max(0, Number(dt) || 0);
        }

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
                    `Qualität: ${quality}\n` +
                    formatGpuLine(renderer) +
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

        const isRecording = isCinematicRecordingActive(recorder);
        // A level the player picked in the menu stands; only "Automatisch" is regulated.
        if (!isPlaying || isRecording || this._qualitySetting !== GRAPHICS_QUALITY_AUTO) return;

        const gpu = renderer?.qualityController?.gpuFrameTimer?.getStats?.() || null;
        const nextQuality = resolveAdaptiveQualityStep({
            quality: this._quality,
            autoLowActive: this._autoLowActive,
            avgFps: this._fpsTracker.avg,
            gpu,
            ultraAllowed: this._isUltraAllowed(renderer),
            playingSeconds: this._playingSeconds,
        });
        if (nextQuality === this._quality) return;

        const previousQuality = this._quality;
        const gpuKey = renderer?.qualityController?.gpuCapabilities?.gpuKey || '';
        const supersample = nextQuality === ULTRA && shouldSupersample(gpu);
        if (nextQuality === ULTRA) {
            this._saveAutoProfile(recordUltraOutcome(this._loadAutoProfile(), gpuKey, 'promote', { supersample }));
        } else if (previousQuality === ULTRA) {
            this._saveAutoProfile(recordUltraOutcome(this._loadAutoProfile(), gpuKey, 'demote'));
        }
        this._setQuality(renderer, nextQuality, supersample);
        this._autoLowActive = nextQuality === LOW || nextQuality === MEDIUM;
        this._startAdaptiveCooldown(renderer);
        let toast = 'Grafik automatisch erhöht';
        if (compareQualityLevels(nextQuality, previousQuality) < 0) toast = 'Grafik automatisch reduziert';
        else if (nextQuality === ULTRA) toast = 'Grafik: Sehr hoch';
        this.runtimeAccess.actionShowStatusToast?.(toast);
    }

    _setQuality(renderer, quality, supersample) {
        this._quality = quality;
        this._isLowQuality = quality === LOW;
        this._ultraSupersample = quality === ULTRA && supersample === true;
        renderer?.setQuality?.(quality, { supersample: this._ultraSupersample });
    }

    // Reads the two menu values every frame but only acts when one changes: the reads are plain
    // property lookups, the reaction swaps shaders.
    _syncQualitySettings(renderer) {
        if (!renderer) return;
        const rawSetting = this.runtimeAccess.getGraphicsQualitySetting?.();
        if (rawSetting !== this._rawQualitySetting) {
            this._rawQualitySetting = rawSetting;
            this._applyQualitySetting(renderer, normalizeGraphicsQualitySetting(rawSetting));
        }
        const bloomUserSet = this.runtimeAccess.getBloomQualityUserSet?.() === true;
        if (bloomUserSet !== this._bloomUserSet) {
            this._bloomUserSet = bloomUserSet;
            renderer.qualityController?.setBloomAutoFloor?.(!bloomUserSet);
        }
    }

    _applyQualitySetting(renderer, setting) {
        this._qualitySetting = setting;
        this._autoLowActive = false;
        const capabilities = renderer?.qualityController?.gpuCapabilities;
        const profile = this._loadAutoProfile();
        let target = setting;
        let supersample = false;
        if (setting === GRAPHICS_QUALITY_AUTO) {
            ({ quality: target, supersample } = resolveAutoStartQuality({
                capabilities,
                profile,
                ultraAllowed: this._isUltraAllowed(renderer),
            }));
        } else if (setting === ULTRA) {
            supersample = profile.gpuKey === capabilities?.gpuKey && profile.supersample;
        }
        if (target === this._quality && supersample === this._ultraSupersample) return;
        this._setQuality(renderer, target, supersample);
        this._startAdaptiveCooldown(renderer);
    }

    _isUltraAllowed(renderer) {
        return isUltraAllowed({
            setting: this._qualitySetting,
            capabilities: renderer?.qualityController?.gpuCapabilities,
            profile: this._loadAutoProfile(),
            automation: isAutomationRuntime(),
        });
    }

    _loadAutoProfile() {
        if (!this._autoProfile) {
            let raw = null;
            try {
                raw = this.runtimeAccess.getSettingsRecordStore?.()?.loadJsonRecord?.(GRAPHICS_AUTO_PROFILE_STORAGE_KEY, null);
            } catch {
                raw = null;
            }
            this._autoProfile = normalizeGraphicsAutoProfile(raw);
        }
        return this._autoProfile;
    }

    _saveAutoProfile(profile) {
        this._autoProfile = normalizeGraphicsAutoProfile(profile);
        try {
            this.runtimeAccess.getSettingsRecordStore?.()?.saveJsonRecord?.(GRAPHICS_AUTO_PROFILE_STORAGE_KEY, this._autoProfile);
        } catch {
            // A full or blocked store only costs the next start its shortcut; the level itself holds.
        }
    }

    _startAdaptiveCooldown(renderer = null) {
        this._adaptiveCooldown = ADAPTIVE_COOLDOWN_SECONDS;
        this._adaptiveTimer = 0;
        // Alte Samples stammen aus der vorherigen Qualitaetsstufe und wuerden den naechsten
        // Vergleich verfaelschen.
        this._fpsTracker.reset();
        renderer?.qualityController?.gpuFrameTimer?.reset?.();
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        if (this._statsElement) {
            this._statsElement.remove();
            this._statsElement = null;
        }
    }
}
