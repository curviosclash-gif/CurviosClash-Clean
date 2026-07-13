// ============================================
// ObservationBridgePolicy.js - bridge policy shell with resilient local fallback
// ============================================

import { createLogger } from '../../shared/logging/Logger.js';
import { createNeutralBotAction, sanitizeBotAction } from './actions/BotActionContract.js';

const logger = createLogger('ObservationBridgePolicy');
import { BOT_POLICY_TYPES, normalizeBotPolicyType } from './BotPolicyTypes.js';
import { buildTrainerRuntimeObservationPayload } from './training/TrainerPayloadAdapter.js';
import { WebSocketTrainerBridge } from './training/WebSocketTrainerBridge.js';
import { LocalDqnInference } from './inference/LocalDqnInference.js';
import { createCheckpointActionVocabulary } from './inference/CheckpointActionVocabulary.js';
import { RuntimeNearObservationTracker } from './observation/RuntimeNearObservationAdapter.js';
import {
    createRuntimeContextFromLegacyArgs,
    hasSteeringIntent,
    initializeTrainerCheckpointResume,
    isRuntimeContextPayload,
    resolveLocalInferenceAction,
    resolveTrainerBridgeOptions,
} from './ObservationBridgePolicyHelpers.js';

const WARNING_COOLDOWN_BASE_MS = 2000;
const WARNING_COOLDOWN_MAX_MS = 30000;

/**
 * @typedef {{
 *   status: string,
 *   resumeRequested: boolean,
 *   resumeToken: string | null,
 *   loaded: boolean,
 *   error: string | null,
 *   resumeSource: string | null,
 * }} TrainerBridgeInitState
 */

function resolveDesktopRuntimeProbe(options = {}) {
    if (options.isDesktopRuntime === true) {
        return () => true;
    }
    if (typeof options.isDesktopRuntime === 'function') {
        return () => {
            try {
                return options.isDesktopRuntime() === true;
            } catch {
                return false;
            }
        };
    }
    return () => false;
}

export class ObservationBridgePolicy {
    constructor(options = {}) {
        this.type = normalizeBotPolicyType(options.type || BOT_POLICY_TYPES.CLASSIC_BRIDGE);
        this.sensePhase = 0;
        this.usesRuntimeContext = true;
        this._fallbackPolicy = options.fallbackPolicy || null;
        this._resolveAction = typeof options.resolveAction === 'function' ? options.resolveAction : null;
        this._resolveObservation = typeof options.resolveObservation === 'function' ? options.resolveObservation : null;
        this._warningBaseCooldownMs = WARNING_COOLDOWN_BASE_MS;
        this._warningMaxCooldownMs = WARNING_COOLDOWN_MAX_MS;
        this._warningStateByKey = new Map();
        this._bridgeFailureState = {
            reason: null,
            updatedAt: 0,
        };
        this._isDesktopRuntime = resolveDesktopRuntimeProbe(options);
        this._neutralAction = createNeutralBotAction({});
        this._localInference = null;
        this._localInferenceVocabulary = null;
        this._observationTracker = new RuntimeNearObservationTracker();
        this._trainerBridge = null;
        this._trainerBridgeOptions = null;
        this._trainerBridgeInitPromise = null;
        this._trainerBridgeInitState = /** @type {Readonly<TrainerBridgeInitState>} */ (Object.freeze({
            status: 'disabled',
            resumeRequested: false,
            resumeToken: null,
            loaded: false,
            error: null,
            resumeSource: null,
        }));

        const trainerBridgeOptions = resolveTrainerBridgeOptions(options);
        if (trainerBridgeOptions.enabled) {
            this._trainerBridgeOptions = trainerBridgeOptions;
            this._trainerBridge = new WebSocketTrainerBridge(trainerBridgeOptions);
            this._primeTrainerBridge(trainerBridgeOptions);
        }

        const autoLoad = options.autoLoadCheckpoint !== false;
        if (autoLoad && !this._localInference && !this._trainerBridge) {
            this._autoLoadLatestCheckpoint();
        }
    }

    _setTrainerBridgeInitState(nextState = {}) {
        const source = /** @type {Record<string, any>} */ (
            nextState && typeof nextState === 'object' ? nextState : {}
        );
        this._trainerBridgeInitState = /** @type {Readonly<TrainerBridgeInitState>} */ (Object.freeze({
            status: typeof source.status === 'string' ? source.status : 'disabled',
            resumeRequested: source.resumeRequested === true,
            resumeToken: typeof source.resumeToken === 'string' ? source.resumeToken : null,
            loaded: source.loaded === true,
            error: typeof source.error === 'string' ? source.error : null,
            resumeSource: typeof source.resumeSource === 'string' ? source.resumeSource : null,
        }));
    }

    _primeTrainerBridge(trainerBridgeOptions = {}) {
        const resumeToken = typeof trainerBridgeOptions.resumeCheckpoint === 'string'
            ? trainerBridgeOptions.resumeCheckpoint.trim()
            : '';
        if (!resumeToken) {
            this._setTrainerBridgeInitState({
                status: 'ready',
                resumeRequested: false,
                loaded: true,
            });
            return;
        }
        this._setTrainerBridgeInitState({
            status: 'pending',
            resumeRequested: true,
            resumeToken,
            loaded: false,
            error: null,
            resumeSource: null,
        });

        this._trainerBridgeInitPromise = this._initializeTrainerCheckpointResume(resumeToken, trainerBridgeOptions);
    }

    async _initializeTrainerCheckpointResume(resumeToken, trainerBridgeOptions) {
        return initializeTrainerCheckpointResume(this, resumeToken, trainerBridgeOptions);
    }

    _warn(message, error = null, key = null) {
        const warningKey = typeof key === 'string' && key.trim()
            ? key.trim()
            : String(message || 'warning');
        let warningState = this._warningStateByKey.get(warningKey);
        if (!warningState) {
            warningState = {
                lastWarningAt: 0,
                cooldownMs: this._warningBaseCooldownMs,
                suppressed: 0,
            };
            this._warningStateByKey.set(warningKey, warningState);
        }

        const now = Date.now();
        if (now - warningState.lastWarningAt < warningState.cooldownMs) {
            warningState.suppressed += 1;
            return;
        }

        const suppressedCount = warningState.suppressed;
        warningState.suppressed = 0;
        warningState.lastWarningAt = now;
        warningState.cooldownMs = Math.min(
            this._warningMaxCooldownMs,
            Math.max(this._warningBaseCooldownMs, warningState.cooldownMs * 2)
        );

        const suppressedMessage = suppressedCount > 0
            ? ` (suppressed=${suppressedCount})`
            : '';
        const errorMessage = error ? ` (${error.message || String(error)})` : '';
        logger.warn(`${this.type}: ${message}${suppressedMessage}${errorMessage}`);
    }

    _recordBridgeFailure(reason) {
        const normalizedReason = typeof reason === 'string' && reason.trim()
            ? reason.trim()
            : 'bridge-failure';
        this._bridgeFailureState.reason = normalizedReason;
        this._bridgeFailureState.updatedAt = Date.now();
        this._warn(
            `trainer bridge ${normalizedReason}; fallback local policy`,
            null,
            `bridge-failure:${normalizedReason}`
        );
    }

    _asRuntimeContext(dt, player, runtimeContextOrArena, allPlayers, projectiles) {
        if (isRuntimeContextPayload(runtimeContextOrArena)) {
            const context = runtimeContextOrArena;
            if (!Array.isArray(context.players)) context.players = [];
            if (!Array.isArray(context.projectiles)) context.projectiles = [];
            if (!context.player) context.player = player || null;
            if (!Number.isFinite(context.dt)) context.dt = Number.isFinite(dt) ? dt : 0;
            return context;
        }
        return createRuntimeContextFromLegacyArgs(player, runtimeContextOrArena, allPlayers, projectiles, dt);
    }

    _delegateFallbackUpdate(dt, player, runtimeContext) {
        const fallbackUpdate = this._fallbackPolicy?.update;
        if (typeof fallbackUpdate !== 'function') {
            return this._neutralAction;
        }

        try {
            if (this._fallbackPolicy.usesRuntimeContext === true || fallbackUpdate.length <= 3) {
                return fallbackUpdate.call(this._fallbackPolicy, dt, player, runtimeContext);
            }
            return fallbackUpdate.call(
                this._fallbackPolicy,
                dt,
                player,
                runtimeContext.arena,
                runtimeContext.players,
                runtimeContext.projectiles
            );
        } catch (error) {
            this._warn('fallback policy update failed', error, 'fallback-update-failed');
            return this._neutralAction;
        }
    }

    _sanitizeAction(action, player, target = this._neutralAction) {
        return sanitizeBotAction(action, {
            inventoryLength: Array.isArray(player?.inventory) ? player.inventory.length : 0,
            onInvalid: (reason) => this._warn(
                `sanitized invalid action (${reason})`,
                null,
                `sanitized-action:${reason}`
            ),
        }, target);
    }

    _injectFallbackSteeringIfNeeded(action, dt, player, runtimeContext) {
        if (hasSteeringIntent(action)) {
            return action;
        }

        const fallbackRawAction = this._delegateFallbackUpdate(dt, player, runtimeContext);
        const fallbackAction = this._sanitizeAction(fallbackRawAction, player, {});
        if (!hasSteeringIntent(fallbackAction)) {
            return action;
        }

        action.yawLeft = fallbackAction.yawLeft === true;
        action.yawRight = fallbackAction.yawRight === true;
        action.pitchUp = fallbackAction.pitchUp === true;
        action.pitchDown = fallbackAction.pitchDown === true;
        action.rollLeft = fallbackAction.rollLeft === true;
        action.rollRight = fallbackAction.rollRight === true;
        if (!action.boost && fallbackAction.boost === true) {
            action.boost = true;
        }

        this._warn(
            'local action without steering; injected fallback steering assist',
            null,
            'local-steering-assist',
        );
        return action;
    }

    _buildTrainerPayload(runtimeContext, player) {
        return buildTrainerRuntimeObservationPayload(runtimeContext, player);
    }

    _autoLoadLatestCheckpoint() {
        if (this._isDesktopRuntime()) {
            return;
        }
        const CHECKPOINT_API_URL = '/api/bot/latest-checkpoint';
        fetch(CHECKPOINT_API_URL)
            .then((res) => {
                if (!res.ok) return null;
                return res.json();
            })
            .then((data) => {
                if (!data?.ok || !data?.checkpoint) return;
                const actionVocabulary = createCheckpointActionVocabulary(data.checkpoint);
                const result = this.loadLocalCheckpoint(data.checkpoint, actionVocabulary);
                if (result.ok) {
                    logger.info('Auto-loaded trained bot checkpoint');
                }
            })
            .catch((err) => {
                logger.debug('No checkpoint available, using rule-based fallback:', err);
            });
    }

    loadLocalCheckpoint(checkpoint, actionVocabulary = null) {
        const inference = new LocalDqnInference();
        const result = inference.loadCheckpoint(checkpoint);
        if (!result.ok) {
            this._warn(`local checkpoint load failed: ${result.error}`, null, 'local-checkpoint-load');
            return result;
        }
        const resolvedActionVocabulary = actionVocabulary || createCheckpointActionVocabulary(checkpoint) || null;
        this._localInference = inference;
        this._localInferenceVocabulary = resolvedActionVocabulary;
        if (!resolvedActionVocabulary || typeof resolvedActionVocabulary.decode !== 'function') {
            this._warn(
                'local checkpoint loaded without action vocabulary, using fallback policy actions',
                null,
                'local-checkpoint-vocabulary-missing',
            );
        }
        return result;
    }

    _resolveLocalInferenceAction(runtimeContext) {
        return resolveLocalInferenceAction(this, runtimeContext);
    }

    _resolveTrainerBridgeAction(runtimeContext, player) {
        // Local inference has priority (no latency)
        const localAction = this._resolveLocalInferenceAction(runtimeContext);
        if (localAction) {
            return { action: localAction, failure: null, usedBridge: false };
        }
        if (!this._trainerBridge) {
            return { action: null, failure: null, usedBridge: false };
        }
        const initStatus = this._trainerBridgeInitState?.status;
        if (initStatus === 'pending') {
            return { action: null, failure: 'checkpoint-resume-pending', usedBridge: true };
        }
        if (initStatus === 'failed') {
            return {
                action: null,
                failure: this._trainerBridgeInitState?.error || 'checkpoint-resume-failed',
                usedBridge: true,
            };
        }

        this._trainerBridge.submitObservation(this._buildTrainerPayload(runtimeContext, player));
        const action = this._trainerBridge.consumeLatestAction();
        const failure = this._trainerBridge.consumeFailure();
        return { action, failure, usedBridge: true };
    }

    _recordTrainerFallback(reason = 'bridge-fallback') {
        if (this._trainerBridge && typeof this._trainerBridge.recordFallback === 'function') {
            this._trainerBridge.recordFallback(reason);
        }
    }

    getObservation(player, runtimeContext) {
        if (typeof this._resolveObservation === 'function') {
            try {
                return this._resolveObservation(player, runtimeContext);
            } catch (error) {
                this._warn('resolveObservation failed', error, 'resolve-observation-failed');
            }
        }
        if (typeof this._fallbackPolicy?.getObservation === 'function') {
            try {
                return this._fallbackPolicy.getObservation(player, runtimeContext);
            } catch (error) {
                this._warn('fallback getObservation failed', error, 'fallback-observation-failed');
            }
        }
        return runtimeContext?.observation || null;
    }

    update(dt, player, runtimeContextOrArena, allPlayers = null, projectiles = null) {
        const runtimeContext = this._asRuntimeContext(dt, player, runtimeContextOrArena, allPlayers, projectiles);
        if (runtimeContext.observation == null) {
            runtimeContext.observation = this.getObservation(player, runtimeContext);
        }

        const trainerResult = this._resolveTrainerBridgeAction(runtimeContext, player);
        if (trainerResult.failure) {
            this._recordBridgeFailure(trainerResult.failure);
        } else {
            this._bridgeFailureState.reason = null;
            this._bridgeFailureState.updatedAt = Date.now();
        }
        if (trainerResult.action && typeof trainerResult.action === 'object') {
            let action = this._sanitizeAction(trainerResult.action, player, {});
            if (!trainerResult.usedBridge) {
                action = this._injectFallbackSteeringIfNeeded(action, dt, player, runtimeContext);
            }
            return action;
        }
        if (trainerResult.usedBridge) {
            this._recordTrainerFallback(
                trainerResult.failure
                    ? `bridge-${trainerResult.failure}`
                    : 'bridge-no-action'
            );
        }

        if (typeof this._resolveAction === 'function') {
            try {
                const action = this._resolveAction(runtimeContext, player, dt);
                if (action && typeof action === 'object') {
                    return this._sanitizeAction(action, player);
                }
                this._warn('resolveAction returned no action payload, using fallback', null, 'resolve-action-empty');
            } catch (error) {
                this._warn('resolveAction failed, using fallback', error, 'resolve-action-failed');
            }
        }

        const fallbackAction = this._delegateFallbackUpdate(dt, player, runtimeContext);
        return this._sanitizeAction(fallbackAction, player);
    }

    getTrainerBridgeTelemetry() {
        if (!this._trainerBridge || typeof this._trainerBridge.getTelemetrySnapshot !== 'function') {
            return null;
        }
        return this._trainerBridge.getTelemetrySnapshot();
    }

    getTrainerBridgeStatus() {
        return {
            enabled: !!this._trainerBridge,
            resume: {
                ...this._trainerBridgeInitState,
            },
            failure: {
                reason: this._bridgeFailureState.reason,
                updatedAt: this._bridgeFailureState.updatedAt,
            },
            telemetry: this.getTrainerBridgeTelemetry(),
        };
    }

    reset() {
        this._warningStateByKey.clear();
        this._bridgeFailureState.reason = null;
        this._bridgeFailureState.updatedAt = Date.now();
        if (this._trainerBridge) {
            this._trainerBridge.close();
        }
        this._trainerBridgeInitPromise = null;
        if (this._trainerBridge && this._trainerBridgeOptions) {
            this._primeTrainerBridge(this._trainerBridgeOptions);
        } else {
            this._setTrainerBridgeInitState({
                status: this._trainerBridge ? 'ready' : 'disabled',
                resumeRequested: false,
                loaded: true,
                error: null,
                resumeSource: null,
            });
        }
        if (typeof this._fallbackPolicy?.reset === 'function') {
            this._fallbackPolicy.reset();
        }
    }

    setDifficulty(profileName) {
        if (typeof this._fallbackPolicy?.setDifficulty === 'function') {
            this._fallbackPolicy.setDifficulty(profileName);
        }
    }

    onBounce(type, normal = null) {
        if (typeof this._fallbackPolicy?.onBounce === 'function') {
            this._fallbackPolicy.onBounce(type, normal);
        }
    }

    setSensePhase(phase) {
        const normalizedPhase = Number.isFinite(Number(phase)) ? Math.max(0, Math.trunc(Number(phase))) : 0;
        this.sensePhase = normalizedPhase;
        if (typeof this._fallbackPolicy?.setSensePhase === 'function') {
            this._fallbackPolicy.setSensePhase(normalizedPhase);
        }
    }
}
