// @ts-nocheck
import { createElectronPreloadSaveAdapter } from '../../platform/electron/ElectronPlatformBridge.js';
import { updateReplayProjection } from './CinematicReplayProjection.js';

export const CINEMATIC_REPLAY_EXPORT_FPS = 60;
export const CINEMATIC_REPLAY_EXPORT_WIDTH = 1920;
export const CINEMATIC_REPLAY_EXPORT_HEIGHT = 1080;

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, toFiniteNumber(value, 0)));
}

function yieldToRenderer() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function resolveExportErrorMessage(result) {
    const code = String(result?.code || result?.reason || '').trim();
    if (code === 'cancelled' || code === 'RECORDING_SAVE_CANCELLED') {
        return 'Speicherdialog wurde abgebrochen.';
    }
    if (code.includes('encoder') || code.includes('ffmpeg')) {
        return 'H.264-Encoder (FFmpeg/libx264) ist nicht verfuegbar.';
    }
    if (code.includes('validation')) {
        return 'Die erzeugte MP4-Datei hat die Abschlusspruefung nicht bestanden.';
    }
    return result?.message || 'Cinematic Replay Render wurde abgebrochen.';
}

function createReplayValidationFailure(replay) {
    if (!replay || !Array.isArray(replay.snapshots) || replay.snapshots.length === 0) {
        return {
            saved: false,
            reason: 'replay_too_short',
            message: 'Die Aufnahme enthält keine renderbaren Szenenbilder.',
        };
    }
    return null;
}

export class CinematicReplayExportController {
    constructor({
        runtimeGlobal = globalThis,
        renderFrame = null,
        onStatus = null,
        logger = console,
    } = {}) {
        this.runtimeGlobal = runtimeGlobal || globalThis;
        this.renderFrame = typeof renderFrame === 'function' ? renderFrame : null;
        this.onStatus = typeof onStatus === 'function' ? onStatus : null;
        this.logger = logger || console;
        this._activeExport = null;
        this._lastFailedReplay = null;
        this._projection = {
            contractVersion: 'match-render-projection.v1',
            updatedAt: 0,
            gameStateId: 'playing',
            modeId: '',
            isNetworkSession: false,
            localPlayerIndex: 0,
            localHumanCount: 1,
            players: [],
            recordedCamera: null,
        };
    }

    get isExporting() {
        return !!this._activeExport;
    }

    getLastFailedReplay() {
        return this._lastFailedReplay;
    }

    _emitStatus(phase, extra = null) {
        const snapshot = {
            phase,
            ...(extra && typeof extra === 'object' ? extra : {}),
        };
        try {
            this.onStatus?.(snapshot);
        } catch (error) {
            this.logger?.warn?.('[CinematicReplayExport] status callback failed', error);
        }
        return snapshot;
    }

    async export(replay) {
        if (this._activeExport) {
            return { saved: false, reason: 'export_already_running' };
        }
        const validationFailure = createReplayValidationFailure(replay);
        if (validationFailure) {
            this._lastFailedReplay = replay || null;
            this._emitStatus('failed', {
                message: validationFailure.message,
                code: validationFailure.reason,
            });
            return validationFailure;
        }
        if (!this.renderFrame) {
            this._lastFailedReplay = replay;
            return { saved: false, reason: 'offline_renderer_unavailable' };
        }
        const saveAdapter = createElectronPreloadSaveAdapter(this.runtimeGlobal);
        if (typeof saveAdapter.beginCinematicReplayExport !== 'function'
            || typeof saveAdapter.appendCinematicReplayFrame !== 'function'
            || typeof saveAdapter.finishCinematicReplayExport !== 'function') {
            this._lastFailedReplay = replay;
            return { saved: false, reason: 'desktop_streaming_export_unavailable' };
        }

        const abortState = { requested: false, exportId: null };
        const activePromise = this._runExport(replay, saveAdapter, abortState);
        this._activeExport = { promise: activePromise, abortState, replay };
        try {
            const result = await activePromise;
            if (result?.saved === true) {
                this._lastFailedReplay = null;
            } else {
                this._lastFailedReplay = replay;
            }
            return result;
        } finally {
            this._activeExport = null;
        }
    }

    async _runExport(replay, saveAdapter, abortState) {
        this._emitStatus('preparing', { message: 'Replay wird vorbereitet' });
        const audioBytes = replay.audioBlob?.size > 0
            ? new Uint8Array(await replay.audioBlob.arrayBuffer())
            : null;
        const beginResult = await saveAdapter.beginCinematicReplayExport({
            contractVersion: 'cinematic-replay-video-export.v1',
            matchId: replay.matchId,
            fileName: `curvios-cinematic-${replay.matchId || Date.now()}.mp4`,
            width: CINEMATIC_REPLAY_EXPORT_WIDTH,
            height: CINEMATIC_REPLAY_EXPORT_HEIGHT,
            fps: CINEMATIC_REPLAY_EXPORT_FPS,
            expectedDurationMs: replay.durationMs,
            audioBytes,
            audioMimeType: replay.audioMimeType || '',
            audioExpected: replay.audioBlob?.size > 0,
            audioWarning: replay.audioWarning || null,
        });
        if (beginResult?.started !== true) {
            const message = resolveExportErrorMessage(beginResult);
            this._emitStatus(
                beginResult?.cancelled === true ? 'cancelled' : 'failed',
                { message, code: beginResult?.code || beginResult?.reason || null }
            );
            return {
                saved: false,
                cancelled: beginResult?.cancelled === true,
                reason: beginResult?.reason || beginResult?.code || 'export_begin_failed',
                message,
                partial: replay.partial === true,
                partialReason: replay.partialReason || null,
            };
        }
        abortState.exportId = beginResult.exportId;
        const durationMs = Math.max(
            1,
            toFiniteNumber(replay.durationMs, replay.snapshots.at(-1)?.timeMs || 0)
        );
        const totalFrames = Math.max(1, Math.ceil(durationMs * CINEMATIC_REPLAY_EXPORT_FPS / 1000));
        let leftIndex = 0;
        let lastReportedPercent = -1;
        try {
            for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
                if (abortState.requested) throw new Error('export_cancelled');
                const timeMs = frameIndex * 1000 / CINEMATIC_REPLAY_EXPORT_FPS;
                while (
                    leftIndex < replay.snapshots.length - 2
                    && toFiniteNumber(replay.snapshots[leftIndex + 1]?.timeMs, 0) <= timeMs
                ) {
                    leftIndex++;
                }
                const leftSnapshot = replay.snapshots[leftIndex];
                const rightSnapshot = replay.snapshots[Math.min(leftIndex + 1, replay.snapshots.length - 1)];
                const leftTime = toFiniteNumber(leftSnapshot?.timeMs, 0);
                const rightTime = Math.max(leftTime, toFiniteNumber(rightSnapshot?.timeMs, leftTime));
                const alpha = rightTime > leftTime ? clamp01((timeMs - leftTime) / (rightTime - leftTime)) : 0;
                const projection = updateReplayProjection(
                    this._projection,
                    leftSnapshot,
                    rightSnapshot,
                    alpha,
                    replay.metadata
                );
                const canvas = await this.renderFrame({
                    replay,
                    leftSnapshot,
                    rightSnapshot,
                    alpha,
                    projection,
                    frameIndex,
                    timeMs,
                    dt: 1 / CINEMATIC_REPLAY_EXPORT_FPS,
                });
                if (!canvas || Number(canvas.width) !== CINEMATIC_REPLAY_EXPORT_WIDTH
                    || Number(canvas.height) !== CINEMATIC_REPLAY_EXPORT_HEIGHT) {
                    throw new Error('offline_frame_size_invalid');
                }
                const context = canvas.getContext?.('2d', { willReadFrequently: true });
                const frameBytes = context?.getImageData?.(
                    0,
                    0,
                    CINEMATIC_REPLAY_EXPORT_WIDTH,
                    CINEMATIC_REPLAY_EXPORT_HEIGHT
                )?.data;
                if (!frameBytes || frameBytes.byteLength !== CINEMATIC_REPLAY_EXPORT_WIDTH * CINEMATIC_REPLAY_EXPORT_HEIGHT * 4) {
                    throw new Error('offline_frame_read_failed');
                }
                const appendResult = await saveAdapter.appendCinematicReplayFrame({
                    exportId: abortState.exportId,
                    frameIndex,
                    frameBytes,
                });
                if (appendResult?.accepted !== true) {
                    throw new Error(appendResult?.reason || 'offline_frame_rejected');
                }
                const percent = Math.min(99, Math.floor(((frameIndex + 1) / totalFrames) * 100));
                if (percent !== lastReportedPercent) {
                    lastReportedPercent = percent;
                    this._emitStatus('rendering', {
                        message: `Video wird gerendert (${percent} %)`,
                        progress: percent / 100,
                        frameIndex: frameIndex + 1,
                        totalFrames,
                    });
                }
                if ((frameIndex & 3) === 3) await yieldToRenderer();
            }
            this._emitStatus('encoding', { message: 'Video wird encodiert', progress: 1 });
            const finishResult = await saveAdapter.finishCinematicReplayExport({
                exportId: abortState.exportId,
                frameCount: totalFrames,
                expectedDurationMs: durationMs,
            });
            if (finishResult?.saved !== true) {
                throw new Error(finishResult?.reason || finishResult?.code || 'export_validation_failed');
            }
            const warnings = [
                ...(Array.isArray(finishResult.warnings) ? finishResult.warnings : []),
                replay.audioWarning,
            ].filter(Boolean);
            this._emitStatus('saved', {
                message: 'Video wurde gespeichert',
                filePath: finishResult.filePath || null,
                warnings,
            });
            try {
                await this.renderFrame({ reset: true });
            } catch (error) {
                warnings.push('replay_renderer_reset_failed');
                this.logger?.warn?.(
                    '[CinematicReplayExport] saved video renderer cleanup failed',
                    error
                );
            }
            return {
                ...finishResult,
                partial: replay.partial === true,
                partialReason: replay.partialReason || null,
                warnings,
            };
        } catch (error) {
            const cancelled = abortState.requested || error?.message === 'export_cancelled';
            await saveAdapter.cancelCinematicReplayExport?.({
                exportId: abortState.exportId,
                reason: cancelled ? 'user_cancelled' : 'render_failed',
            }).catch?.(() => {});
            const message = cancelled
                ? 'Cinematic Replay Render wurde kontrolliert abgebrochen.'
                : resolveExportErrorMessage({ reason: error?.message, message: error?.message });
            await this.renderFrame({ reset: true }).catch(() => {});
            this._emitStatus(cancelled ? 'cancelled' : 'failed', {
                message,
                code: error?.message || 'render_failed',
            });
            return {
                saved: false,
                cancelled,
                reason: error?.message || 'render_failed',
                message,
                partial: replay.partial === true,
                partialReason: replay.partialReason || null,
            };
        }
    }

    async cancel() {
        const active = this._activeExport;
        if (!active) return { cancelled: false, reason: 'no_export_running' };
        active.abortState.requested = true;
        const adapter = createElectronPreloadSaveAdapter(this.runtimeGlobal);
        if (active.abortState.exportId && typeof adapter.cancelCinematicReplayExport === 'function') {
            await adapter.cancelCinematicReplayExport({
                exportId: active.abortState.exportId,
                reason: 'user_cancelled',
            }).catch(() => {});
        }
        return { cancelled: true };
    }

    async settle() {
        return this._activeExport?.promise || null;
    }
}
