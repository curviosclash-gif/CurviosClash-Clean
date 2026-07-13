// ============================================
// ReplayRecorder.js - records match actions for replay
// ============================================

import { createGameStateSnapshot } from '../GameStateSnapshot.js';
import { createBrowserSaveAdapter } from '../../platform/browser/BrowserPlatformAdapters.js';
import {
    createElectronPreloadSaveAdapter,
    resolveElectronRuntimeSnapshot,
} from '../../platform/electron/ElectronPlatformBridge.js';
import { PLATFORM_CAPABILITY_IDS } from '../../shared/contracts/PlatformCapabilityContract.js';
import { resolveSurfaceCapabilityAccess } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import {
    PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS,
    PLATFORM_SURFACE_FEATURE_IDS,
    resolveSurfaceFeatureClassification,
} from '../../shared/contracts/PlatformSurfacePolicyOps.js';

export const REPLAY_EXPORT_CONTRACT_VERSION = 'replay.v1';

/**
 * Records a match as { initialState, actions[] } for deterministic playback.
 * Actions include all player inputs with frame timestamps.
 *
 * Workstream B can call:
 *   startRecording(entityManager, roundState, playerCount)
 *   stopRecording() → returns replay data
 *   recordAction(action)
 *   exportReplayJSON() → JSON string
 *   downloadReplay() → triggers browser download
 *   saveReplayToFile(filePath) → saves via Electron IPC (C.5)
 */
export class ReplayRecorder {
    constructor() {
        this._recording = false;
        this._initialState = null;
        this._actions = [];
        this._playerCount = 0;
        this._startTime = 0;
        this._matchId = null;
    }

    /**
     * Hook for GameRuntimeFacade: start recording when a match begins (C.5).
     * Workstream B calls this at match start.
     */
    startRecording(entityManager, roundState, playerCount) {
        this._recording = true;
        this._playerCount = playerCount;
        this._startTime = Date.now();
        this._matchId = `match-${Date.now().toString(36)}`;
        this._initialState = createGameStateSnapshot(entityManager, roundState);
        this._actions = [];
    }

    /** Alias for backward-compat */
    start(entityManager, roundState, playerCount) {
        this.startRecording(entityManager, roundState, playerCount);
    }

    recordAction(action) {
        if (!this._recording) return;
        this._actions.push({
            ...action,
            timestamp: Date.now() - this._startTime,
        });
    }

    /**
     * Hook for GameRuntimeFacade: stop recording when a match ends (C.5).
     * Workstream B calls this at match end.
     * @returns {object} replay data
     */
    stopRecording() {
        this._recording = false;
        return this.getReplay();
    }

    /** Alias for backward-compat */
    stop() {
        return this.stopRecording();
    }

    getReplay() {
        return {
            contractVersion: REPLAY_EXPORT_CONTRACT_VERSION,
            version: REPLAY_EXPORT_CONTRACT_VERSION,
            matchId: this._matchId,
            playerCount: this._playerCount,
            startTime: this._startTime,
            duration: Date.now() - this._startTime,
            initialState: this._initialState,
            actions: this._actions,
            actionCount: this._actions.length,
        };
    }

    get isRecording() {
        return this._recording;
    }

    /**
     * Export replay as JSON string (C.5).
     * @returns {string}
     */
    exportReplayJSON() {
        return JSON.stringify(this.getReplay(), null, 2);
    }

    /**
     * Persist replay (C.5).
     * In App mode: saves via Electron IPC file dialog.
     * In Web/Demo mode: triggers browser Blob download.
     *
     * NOTE: DOM download helper lives in src/ui layer.
     * Callers should use the static helper ReplayRecorder.triggerDownload(json, filename)
     * from the UI layer, or pass a custom downloadFn.
     *
     * @param {function} [downloadFn] optional UI-layer download helper
     * @returns {Promise<boolean>}
     */
    async persistReplay(downloadFn) {
        const json = this.exportReplayJSON();
        const filename = `replay-${this._matchId || Date.now()}.json`;
        const runtimeGlobal = typeof window !== 'undefined' ? window : globalThis;
        const platformRuntimeSnapshot = resolveElectronRuntimeSnapshot(runtimeGlobal);
        const saveSurfaceCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.SAVE, {
            runtimeGlobal,
            platformRuntimeSnapshot,
        });
        const replayFeatureClassification = resolveSurfaceFeatureClassification(
            PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT,
            { runtimeGlobal, platformRuntimeSnapshot }
        );
        const desktopSaveAdapter = createElectronPreloadSaveAdapter(runtimeGlobal);

        // App mode: Electron IPC
        if (desktopSaveAdapter.isAvailable() && typeof desktopSaveAdapter.saveReplay === 'function') {
            const result = await desktopSaveAdapter.saveReplay(json, filename);
            return result?.saved === true || result === true;
        }

        // Web mode: use provided download function (from UI layer)
        const browserSaveAdapter = createBrowserSaveAdapter({
            saveReplay: saveSurfaceCapability.available === true
                && replayFeatureClassification.classification === PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DEMO_SAFE
                ? (payload, fileName) => {
                    if (typeof downloadFn !== 'function') {
                        return { saved: false };
                    }
                    downloadFn(payload, fileName);
                    return { saved: true };
                }
                : null,
        });
        if (browserSaveAdapter.isAvailable()) {
            const result = await browserSaveAdapter.saveReplay(json, filename);
            return result?.saved === true;
        }

        return false;
    }

    reset() {
        this._recording = false;
        this._initialState = null;
        this._actions = [];
        this._playerCount = 0;
        this._matchId = null;
    }
}
