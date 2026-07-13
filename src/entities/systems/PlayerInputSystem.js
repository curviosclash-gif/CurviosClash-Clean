/* eslint-disable max-lines */
// ============================================
// PlayerInputSystem.js - resolves human and bot player input
// ============================================

import { createLogger } from '../../shared/logging/Logger.js';
import {
    createGameplayCameraState,
    resolveCameraModeIndexFromModes,
} from '../../shared/contracts/CameraModeContract.js';
import { sanitizeBotAction } from '../ai/actions/BotActionContract.js';

const logger = createLogger('PlayerInputSystem');
import { createBotRuntimeContext } from '../ai/BotRuntimeContextFactory.js';
import { buildObservation } from '../ai/observation/ObservationSystem.js';
import { OBSERVATION_LENGTH_V1 } from '../ai/observation/ObservationSchemaV1.js';

// Reused input object to reduce GC
const SHARED_EMPTY_INPUT = {
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    boostPressed: false,
    cameraSwitch: false,
    dropItem: false,
    shootItem: false,
    shootMG: false,
    shootItemIndex: -1,
    nextItem: false,
    useItem: -1,
};

function getEmptyInput() {
    SHARED_EMPTY_INPUT.pitchUp = false;
    SHARED_EMPTY_INPUT.pitchDown = false;
    SHARED_EMPTY_INPUT.yawLeft = false;
    SHARED_EMPTY_INPUT.yawRight = false;
    SHARED_EMPTY_INPUT.rollLeft = false;
    SHARED_EMPTY_INPUT.rollRight = false;
    SHARED_EMPTY_INPUT.boost = false;
    SHARED_EMPTY_INPUT.boostPressed = false;
    SHARED_EMPTY_INPUT.cameraSwitch = false;
    SHARED_EMPTY_INPUT.dropItem = false;
    SHARED_EMPTY_INPUT.shootItem = false;
    SHARED_EMPTY_INPUT.shootMG = false;
    SHARED_EMPTY_INPUT.shootItemIndex = -1;
    SHARED_EMPTY_INPUT.nextItem = false;
    SHARED_EMPTY_INPUT.useItem = -1;
    return SHARED_EMPTY_INPUT;
}

const DYNAMIC_ACTION_RATE_THRESHOLD = 0.18;
const OBSERVATION_PHASE_SLOTS = 4;
const OBSERVATION_MAX_REBUILDS_PER_FRAME = 2;
const OBSERVATION_MAX_REUSE_FRAMES = 4;
const OBSERVATION_SYNTHETIC_FRAME_MIN_INTERVAL_MS = 8;

function readFiniteRate(raw, fallback = NaN) {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function toPositiveInt(value, fallback, min = 1, max = 1024) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function wrapPhase(value, slots) {
    if (!(slots > 0)) return 0;
    const normalized = Math.trunc(Number(value) || 0) % slots;
    return normalized < 0 ? normalized + slots : normalized;
}

export class PlayerInputSystem {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this._botActionWarningCooldownMs = 2000;
        this._botActionWarnings = new Map();
        this._botObservationWarningCooldownMs = 3000;
        this._botObservationWarnings = new Map();
        this._lastBotObservationByIndex = new Map();
        this._observationMetaByIndex = new Map();
        this._observationFrameId = 0;
        this._observationRebuildsThisFrame = 0;
        this._observationPhaseSlots = OBSERVATION_PHASE_SLOTS;
        this._observationMaxRebuildsPerFrame = OBSERVATION_MAX_REBUILDS_PER_FRAME;
        this._observationMaxReuseFrames = OBSERVATION_MAX_REUSE_FRAMES;
        this._observationLastAdvanceAtMs = 0;
        this._managedFrameActive = false;
        // Reusable sanitize options object to avoid per-frame allocation
        this._sharedSanitizeOptions = {
            inventoryLength: 0,
            onInvalid: null,
        };
    }

    beginFrame() {
        this._managedFrameActive = true;
        this._advanceObservationFrame();
    }

    endFrame() {
        this._managedFrameActive = false;
    }

    _advanceObservationFrame() {
        this._observationFrameId += 1;
        this._observationRebuildsThisFrame = 0;
        this._observationLastAdvanceAtMs = nowMs();
        this._syncObservationScheduleConfig();
        // Purge stale warning entries every 256 frames to prevent unbounded Map growth
        if ((this._observationFrameId & 0xFF) === 0) {
            this._purgeStaleWarnings();
        }
    }

    _purgeStaleWarnings() {
        const now = Date.now();
        const actionCutoff = now - this._botActionWarningCooldownMs * 4;
        const obsCutoff = now - this._botObservationWarningCooldownMs * 4;
        for (const [key, ts] of this._botActionWarnings) {
            if (ts < actionCutoff) this._botActionWarnings.delete(key);
        }
        for (const [key, ts] of this._botObservationWarnings) {
            if (ts < obsCutoff) this._botObservationWarnings.delete(key);
        }
    }

    resetBotState() {
        this._botActionWarnings.clear();
        this._botObservationWarnings.clear();
        this._lastBotObservationByIndex.clear();
        this._observationMetaByIndex.clear();
        this._observationFrameId = 0;
        this._observationRebuildsThisFrame = 0;
        this._observationLastAdvanceAtMs = 0;
        this._managedFrameActive = false;
    }

    _syncObservationScheduleConfig() {
        const runtimeBotConfig = this.entityManager?.runtimeConfig?.bot || null;
        this._observationPhaseSlots = toPositiveInt(
            runtimeBotConfig?.observationPhaseSlots,
            OBSERVATION_PHASE_SLOTS,
            1,
            8
        );
        this._observationMaxRebuildsPerFrame = toPositiveInt(
            runtimeBotConfig?.observationMaxRebuildsPerFrame,
            OBSERVATION_MAX_REBUILDS_PER_FRAME,
            1,
            8
        );
        this._observationMaxReuseFrames = toPositiveInt(
            runtimeBotConfig?.observationMaxReuseFrames,
            OBSERVATION_MAX_REUSE_FRAMES,
            1,
            16
        );
    }

    _warnInvalidBotAction(player, reason, error = null) {
        const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
        const now = Date.now();
        const lastWarning = this._botActionWarnings.get(playerIndex) || 0;
        if (now - lastWarning < this._botActionWarningCooldownMs) return;
        this._botActionWarnings.set(playerIndex, now);
        const errorMessage = error ? ` (${error.message || String(error)})` : '';
        logger.warn(`Sanitized invalid action for bot index ${playerIndex}: ${reason}${errorMessage}`);
    }

    _warnInvalidBotObservation(player, reason, error = null) {
        const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
        const now = Date.now();
        const lastWarning = this._botObservationWarnings.get(playerIndex) || 0;
        if (now - lastWarning < this._botObservationWarningCooldownMs) return;
        this._botObservationWarnings.set(playerIndex, now);
        const errorMessage = error ? ` (${error.message || String(error)})` : '';
        logger.warn(`Fallback observation for bot index ${playerIndex}: ${reason}${errorMessage}`);
    }

    _resolveRuntimeContext(player, dt, entityManager, options = {}) {
        if (typeof entityManager?.createBotRuntimeContext === 'function') {
            return entityManager.createBotRuntimeContext(player, dt, options);
        }
        return createBotRuntimeContext(entityManager, player, dt, options);
    }

    _policyNeedsObservation(policy) {
        if (!policy || policy.requiresObservation === false) return false;
        if (policy.requiresObservation === true || policy.usesObservation === true) return true;
        if (policy.usesRuntimeContext === true) return true;
        if (typeof policy.getObservation === 'function') return true;
        const policyType = typeof policy.type === 'string' ? policy.type : '';
        return policyType.includes('bridge');
    }

    _resolveObservationMeta(playerIndex, defaultPhase = 0) {
        const key = Number.isInteger(playerIndex) ? playerIndex : -1;
        let meta = this._observationMetaByIndex.get(key);
        if (!meta) {
            meta = {
                lastRebuildFrame: -1,
                phase: wrapPhase(defaultPhase, this._observationPhaseSlots),
            };
            this._observationMetaByIndex.set(key, meta);
        }
        return meta;
    }

    _resolvePolicySensePhase(player, policy) {
        const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
        const fallbackPhase = wrapPhase(playerIndex, this._observationPhaseSlots);
        const meta = this._resolveObservationMeta(playerIndex, fallbackPhase);
        const policyPhase = Number(policy?.sensePhase);
        if (Number.isFinite(policyPhase)) {
            meta.phase = wrapPhase(policyPhase, this._observationPhaseSlots);
        } else {
            meta.phase = Number.isInteger(meta.phase)
                ? wrapPhase(meta.phase, this._observationPhaseSlots)
                : fallbackPhase;
        }
        return meta.phase;
    }

    _shouldRebuildObservation(player, policy) {
        const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
        const meta = this._resolveObservationMeta(playerIndex, playerIndex);
        const hasCachedObservation = this._lastBotObservationByIndex.has(playerIndex);
        if (this._observationRebuildsThisFrame >= this._observationMaxRebuildsPerFrame) {
            return false;
        }
        if (!hasCachedObservation) {
            return true;
        }

        const lastRebuildFrame = Number.isFinite(meta.lastRebuildFrame)
            ? meta.lastRebuildFrame
            : -1;
        const sinceRebuild = this._observationFrameId - lastRebuildFrame;
        if (sinceRebuild >= this._observationMaxReuseFrames) {
            return true;
        }

        const phase = this._resolvePolicySensePhase(player, policy);
        return wrapPhase(this._observationFrameId, this._observationPhaseSlots) === phase;
    }

    _resolveScheduledObservation(player, policy, runtimeContext) {
        const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
        if (this._shouldRebuildObservation(player, policy)) {
            const observation = this._buildBotObservation(player, policy, runtimeContext);
            const meta = this._resolveObservationMeta(playerIndex, playerIndex);
            meta.lastRebuildFrame = this._observationFrameId;
            this._lastBotObservationByIndex.set(playerIndex, observation);
            this._observationRebuildsThisFrame += 1;
            return observation;
        }

        const cachedObservation = this._lastBotObservationByIndex.get(playerIndex);
        if (cachedObservation) {
            return cachedObservation;
        }
        return this._resolveObservationTarget(runtimeContext);
    }

    _ensureObservationFrameProgress() {
        if (this._managedFrameActive) {
            return;
        }
        const elapsedMs = nowMs() - this._observationLastAdvanceAtMs;
        if (
            this._observationFrameId <= 0
            || !Number.isFinite(elapsedMs)
            || elapsedMs >= OBSERVATION_SYNTHETIC_FRAME_MIN_INTERVAL_MS
        ) {
            this._advanceObservationFrame();
        }
    }

    _recordBotSensingSample(runtimeProfiler, player, policyType, startMs) {
        if (!runtimeProfiler || !Number.isFinite(startMs)) {
            return;
        }
        const durationMs = nowMs() - startMs;
        if (!(durationMs > 0)) {
            return;
        }
        runtimeProfiler.recordSubsystemDuration?.('bot_sensing', durationMs);
        runtimeProfiler.recordBotSensingDetail?.(
            Number.isInteger(player?.index) ? player.index : -1,
            typeof policyType === 'string' ? policyType : '',
            durationMs
        );
    }

    _buildBotObservation(player, policy, runtimeContext) {
        if (typeof policy?.getObservation === 'function') {
            try {
                const customObservation = policy.getObservation(player, runtimeContext);
                if (
                    customObservation
                    && typeof customObservation.length === 'number'
                    && customObservation.length > 0
                ) {
                    return customObservation;
                }
                // null/undefined = policy has no custom observation source (expected for bridge policies)
                // Only warn for non-null invalid returns (e.g. empty array, malformed object)
                if (customObservation != null) {
                    this._warnInvalidBotObservation(player, 'policy.getObservation returned empty payload');
                }
            } catch (error) {
                this._warnInvalidBotObservation(player, 'policy.getObservation threw', error);
            }
        }
        const observationContext = runtimeContext?.observationContext || runtimeContext;
        const observationTarget = this._resolveObservationTarget(runtimeContext);
        return buildObservation(player, observationContext, observationTarget);
    }

    _resolveObservationTarget(runtimeContext) {
        const reusable = runtimeContext?.observationBuffer;
        if (
            reusable
            && typeof reusable.length === 'number'
            && reusable.length === OBSERVATION_LENGTH_V1
            && typeof reusable.fill === 'function'
        ) {
            return reusable;
        }
        const fallback = new Array(OBSERVATION_LENGTH_V1).fill(0);
        if (runtimeContext && typeof runtimeContext === 'object') {
            runtimeContext.observationBuffer = fallback;
        }
        return fallback;
    }

    _invokeBotPolicyUpdate(policy, dt, player, runtimeContext) {
        const update = policy?.update;
        if (typeof update !== 'function') {
            return getEmptyInput();
        }

        const preferRuntimeContext = policy?.usesRuntimeContext === true || update.length <= 3;
        if (preferRuntimeContext) {
            try {
                return update.call(policy, dt, player, runtimeContext);
            } catch (error) {
                this._warnInvalidBotAction(player, 'runtime-context update threw', error);
                return getEmptyInput();
            }
        }

        try {
            return update.call(
                policy,
                dt,
                player,
                runtimeContext?.arena,
                runtimeContext?.players,
                runtimeContext?.projectiles
            );
        } catch (error) {
            this._warnInvalidBotAction(player, 'legacy update threw', error);
            return getEmptyInput();
        }
    }

    _isDynamicActionAdapterEnabled(runtimeContext) {
        if (!runtimeContext || typeof runtimeContext !== 'object') return false;

        const byRules = runtimeContext?.rules?.dynamicActionAdapterEnabled === true;
        const byControl = runtimeContext?.controlDynamics?.dynamicActionAdapterEnabled === true;
        const byRuntime = runtimeContext?.dynamicActionAdapterEnabled === true;
        if (!byRules && !byControl && !byRuntime) {
            return false;
        }

        if (runtimeContext?.controlProfileAllowsRamps === false) {
            return false;
        }
        if (runtimeContext?.rules?.botRampEnabled === false) {
            return false;
        }
        return true;
    }

    _applyDesiredRateAxis(targetInput, rawAction, options = {}) {
        const positiveKey = options.positiveKey;
        const negativeKey = options.negativeKey;
        if (!positiveKey || !negativeKey || !rawAction || typeof rawAction !== 'object') {
            return false;
        }

        const keys = Array.isArray(options.rateKeys) ? options.rateKeys : [];
        let rateValue = NaN;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const candidate = readFiniteRate(rawAction[key], NaN);
            if (Number.isFinite(candidate)) {
                rateValue = candidate;
                break;
            }
        }
        if (!Number.isFinite(rateValue)) {
            return false;
        }

        const threshold = Math.max(0.01, readFiniteRate(options.threshold, DYNAMIC_ACTION_RATE_THRESHOLD));
        if (Math.abs(rateValue) < threshold) {
            targetInput[positiveKey] = false;
            targetInput[negativeKey] = false;
            return true;
        }

        if (rateValue > 0) {
            targetInput[positiveKey] = true;
            targetInput[negativeKey] = false;
        } else {
            targetInput[positiveKey] = false;
            targetInput[negativeKey] = true;
        }
        return true;
    }

    _applyDynamicActionAdapter(targetInput, rawAction, runtimeContext) {
        if (!this._isDynamicActionAdapterEnabled(runtimeContext)) {
            return;
        }
        if (!rawAction || typeof rawAction !== 'object') {
            return;
        }

        const threshold = readFiniteRate(runtimeContext?.controlDynamics?.discreteRateThreshold, DYNAMIC_ACTION_RATE_THRESHOLD);

        this._applyDesiredRateAxis(targetInput, rawAction, {
            positiveKey: 'yawRight',
            negativeKey: 'yawLeft',
            rateKeys: ['desiredYawRate', 'yawRate', 'targetYawRate'],
            threshold,
        });
        this._applyDesiredRateAxis(targetInput, rawAction, {
            positiveKey: 'pitchUp',
            negativeKey: 'pitchDown',
            rateKeys: ['desiredPitchRate', 'pitchRate', 'targetPitchRate'],
            threshold,
        });
        this._applyDesiredRateAxis(targetInput, rawAction, {
            positiveKey: 'rollRight',
            negativeKey: 'rollLeft',
            rateKeys: ['desiredRollRate', 'rollRate', 'targetRollRate'],
            threshold,
        });
    }

    getLastBotObservation(playerIndex) {
        return this._lastBotObservationByIndex.get(playerIndex) || null;
    }

    resolvePlayerInput(player, dt, inputManager) {
        const entityManager = this.entityManager;
        let input = getEmptyInput();

        if (player.isBot) {
            const botAI = entityManager.botByPlayer.get(player);
            if (botAI) {
                const needsObservation = this._policyNeedsObservation(botAI);
                const runtimeProfiler = entityManager?.runtimeProfiler || null;
                const botSensingStart = needsObservation ? runtimeProfiler?.startSample?.() : NaN;
                if (needsObservation) {
                    this._ensureObservationFrameProgress();
                }
                const runtimeContext = this._resolveRuntimeContext(player, dt, entityManager, {
                    includeObservationContext: needsObservation,
                });
                if (needsObservation) {
                    const observation = this._resolveScheduledObservation(player, botAI, runtimeContext);
                    runtimeContext.observation = observation;
                    this._lastBotObservationByIndex.set(player.index, observation);
                    this._recordBotSensingSample(runtimeProfiler, player, botAI?.type, botSensingStart);
                } else {
                    runtimeContext.observation = null;
                    this._lastBotObservationByIndex.delete(player.index);
                }

                this._sharedSanitizeOptions.inventoryLength = Array.isArray(player.inventory) ? player.inventory.length : 0;
                this._sharedSanitizeOptions.onInvalid = (reason) => this._warnInvalidBotAction(player, reason);
                const sanitizeOptions = this._sharedSanitizeOptions;
                try {
                    const output = this._invokeBotPolicyUpdate(botAI, dt, player, runtimeContext);
                    input = sanitizeBotAction(output, sanitizeOptions, input);
                    this._applyDynamicActionAdapter(input, output, runtimeContext);
                } catch (error) {
                    this._warnInvalidBotAction(player, 'policy update threw', error);
                    input = getEmptyInput();
                }
            }
            return input;
        }

        const includeSecondaryBindings = entityManager.humanPlayers.length === 1 && player.index === 0;
        const inputState = inputManager.getPlayerInput(player.index, { includeSecondaryBindings });
        if (inputState) {
            input.pitchUp = inputState.pitchUp;
            input.pitchDown = inputState.pitchDown;
            input.yawLeft = inputState.yawLeft;
            input.yawRight = inputState.yawRight;
            input.rollLeft = inputState.rollLeft;
            input.rollRight = inputState.rollRight;
            input.boost = inputState.boost;
            input.boostPressed = inputState.boostPressed;
            input.cameraSwitch = inputState.cameraSwitch;
            input.shootItem = inputState.shootItem;
            input.shootMG = inputState.shootMG;
            input.nextItem = inputState.nextItem;
            input.dropItem = false;

            const inventoryLength = Array.isArray(player.inventory) ? player.inventory.length : 0;
            const selectedIndex = Number.isInteger(player.selectedItemIndex) ? player.selectedItemIndex : 0;

            const wantsUseItem = !!(inputState.useItem || inputState.dropItem);
            if (wantsUseItem && inventoryLength > 0) {
                input.useItem = Math.max(0, Math.min(selectedIndex, inventoryLength - 1));
            }

            if (input.shootItem && inventoryLength > 0) {
                input.shootItemIndex = Math.max(0, Math.min(selectedIndex, inventoryLength - 1));
            }
        }

        const gameplayCameraState = createGameplayCameraState(player?.gameplayConfig || null);
        const fallbackCameraModeIndex = resolveCameraModeIndexFromModes(
            player?.gameplayConfig?.CAMERA?.MODES,
            'THIRD_PERSON'
        );
        player.cockpitCamera = gameplayCameraState.cockpitCamera;
        if (player.index < entityManager.renderer.cameraModes.length) {
            if (!Number.isFinite(Number(entityManager.renderer.cameraModes[player.index]))) {
                entityManager.renderer.cameraModes[player.index] = fallbackCameraModeIndex;
            }
            player.cameraMode = Number(entityManager.renderer.cameraModes[player.index]) || fallbackCameraModeIndex;
        } else {
            player.cameraMode = fallbackCameraModeIndex;
        }
        if (input.cameraSwitch) {
            entityManager.renderer.cycleCamera(player.index);
            if (player.index < entityManager.renderer.cameraModes.length) {
                player.cameraMode = Number(entityManager.renderer.cameraModes[player.index]) || player.cameraMode;
            }
            input.cameraSwitch = false;
        }
        return input;
    }
}
