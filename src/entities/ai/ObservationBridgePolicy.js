// ============================================
// ObservationBridgePolicy.js - bridge policy shell with resilient local fallback
// ============================================

import { createLogger } from '../../shared/logging/Logger.js';
import { createNeutralBotAction, sanitizeBotAction } from './actions/BotActionContract.js';

const logger = createLogger('ObservationBridgePolicy');
import { BOT_POLICY_TYPES, normalizeBotPolicyType } from './BotPolicyTypes.js';
import { LocalDqnInference } from './inference/LocalDqnInference.js';
import { createCheckpointActionVocabulary } from './inference/CheckpointActionVocabulary.js';
import { buildRuntimeInferenceObservationPayload } from './inference/RuntimeInferencePayloadAdapter.js';
import { WebSocketInferenceBridge } from './inference/WebSocketInferenceBridge.js';
import { RuntimeNearObservationTracker } from './observation/RuntimeNearObservationAdapter.js';
import {
    createRuntimeContextFromLegacyArgs,
    hasSteeringIntent,
    isRuntimeContextPayload,
    resolveLocalInferenceAction,
    resolveInferenceBridgeOptions,
} from './ObservationBridgePolicyHelpers.js';

const WARNING_COOLDOWN_BASE_MS = 2000;
const WARNING_COOLDOWN_MAX_MS = 30000;

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
        this._inferenceBridge = null;
        this._inferenceBridgeOptions = null;

        const inferenceBridgeOptions = resolveInferenceBridgeOptions(options);
        if (inferenceBridgeOptions.enabled) {
            this._inferenceBridgeOptions = inferenceBridgeOptions;
            this._inferenceBridge = new WebSocketInferenceBridge(inferenceBridgeOptions);
        }

        const autoLoad = options.autoLoadCheckpoint !== false;
        if (autoLoad && !this._localInference && !this._inferenceBridge) {
            this._autoLoadLatestCheckpoint();
        }
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
            `inference bridge ${normalizedReason}; fallback local policy`,
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
                runtimeContext.navigationPlayers || runtimeContext.players,
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

    _buildInferencePayload(runtimeContext, player) {
        return buildRuntimeInferenceObservationPayload(runtimeContext, player);
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

    _resolveInferenceBridgeAction(runtimeContext, player) {
        // Local inference has priority (no latency)
        const localAction = this._resolveLocalInferenceAction(runtimeContext);
        if (localAction) {
            return { action: localAction, failure: null, usedBridge: false };
        }
        if (!this._inferenceBridge) {
            return { action: null, failure: null, usedBridge: false };
        }

        this._inferenceBridge.submitObservation(this._buildInferencePayload(runtimeContext, player));
        const action = this._inferenceBridge.consumeLatestAction();
        const failure = this._inferenceBridge.consumeFailure();
        return { action, failure, usedBridge: true };
    }

    _recordInferenceFallback(reason = 'bridge-fallback') {
        if (this._inferenceBridge && typeof this._inferenceBridge.recordFallback === 'function') {
            this._inferenceBridge.recordFallback(reason);
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

        const inferenceResult = this._resolveInferenceBridgeAction(runtimeContext, player);
        if (inferenceResult.failure) {
            this._recordBridgeFailure(inferenceResult.failure);
        } else {
            this._bridgeFailureState.reason = null;
            this._bridgeFailureState.updatedAt = Date.now();
        }
        if (inferenceResult.action && typeof inferenceResult.action === 'object') {
            let action = this._sanitizeAction(inferenceResult.action, player, {});
            if (!inferenceResult.usedBridge) {
                action = this._injectFallbackSteeringIfNeeded(action, dt, player, runtimeContext);
            }
            return action;
        }
        if (inferenceResult.usedBridge) {
            this._recordInferenceFallback(
                inferenceResult.failure
                    ? `bridge-${inferenceResult.failure}`
                    : 'bridge-no-action'
            );
        }

        if (typeof this._resolveAction === 'function') {
            try {
                const action = this._resolveAction(runtimeContext, player, dt);
                if (action && typeof action === 'object') {
                    const sanitizedAction = this._sanitizeAction(action, player);
                    return this._injectFallbackSteeringIfNeeded(
                        sanitizedAction,
                        dt,
                        player,
                        runtimeContext
                    );
                }
                this._warn('resolveAction returned no action payload, using fallback', null, 'resolve-action-empty');
            } catch (error) {
                this._warn('resolveAction failed, using fallback', error, 'resolve-action-failed');
            }
        }

        const fallbackAction = this._delegateFallbackUpdate(dt, player, runtimeContext);
        return this._sanitizeAction(fallbackAction, player);
    }

    getInferenceBridgeTelemetry() {
        if (!this._inferenceBridge || typeof this._inferenceBridge.getTelemetrySnapshot !== 'function') {
            return null;
        }
        return this._inferenceBridge.getTelemetrySnapshot();
    }

    getInferenceBridgeStatus() {
        return {
            enabled: !!this._inferenceBridge,
            failure: {
                reason: this._bridgeFailureState.reason,
                updatedAt: this._bridgeFailureState.updatedAt,
            },
            telemetry: this.getInferenceBridgeTelemetry(),
        };
    }

    // Compatibility aliases for existing settings/runtime integrations. They expose inference only.
    getTrainerBridgeTelemetry() {
        return this.getInferenceBridgeTelemetry();
    }

    getTrainerBridgeStatus() {
        return this.getInferenceBridgeStatus();
    }

    reset() {
        this._warningStateByKey.clear();
        this._bridgeFailureState.reason = null;
        this._bridgeFailureState.updatedAt = Date.now();
        if (this._inferenceBridge) {
            this._inferenceBridge.close();
            this._inferenceBridge = new WebSocketInferenceBridge(this._inferenceBridgeOptions || {});
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

    setArcadeBotAggressiveness(value) {
        if (typeof this._fallbackPolicy?.setArcadeBotAggressiveness === 'function') {
            this._fallbackPolicy.setArcadeBotAggressiveness(value);
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
