import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    SPEED_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';
import { OBSERVATION_LENGTH_V2, OBSERVATION_SCHEMA_VERSION_V2 } from '../src/entities/ai/observation/ObservationSchemaV2.js';
import { DeterministicTrainingStepRunner } from '../src/entities/ai/training/DeterministicTrainingStepRunner.js';
import { WebSocketTrainerBridge } from '../src/entities/ai/training/WebSocketTrainerBridge.js';
import { buildTrainerRuntimeObservationPayload, buildTrainerTransitionPayload } from '../src/entities/ai/training/TrainerPayloadAdapter.js';
import {
    BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
    deriveHeadlessLaneEpisodeStep,
    deriveHeadlessObjectiveReachabilitySignals,
    resolveHeadlessRewardProfile,
} from '../scripts/training-headless-lane-runner.mjs';
import { EpisodeController, TRAINING_TERMINAL_REASONS, TRAINING_TRUNCATION_REASONS } from '../src/state/training/EpisodeController.js';
import { RewardCalculator, sumRewardComponents } from '../src/state/training/RewardCalculator.js';

test('DeterministicTrainingStepRunner keeps additive reset/step contract stable', () => {
    const runner = new DeterministicTrainingStepRunner({
        episode: {
            defaultMaxSteps: 4,
        },
    });
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0.25);
    const reset = runner.reset({
        mode: 'HUNT',
        planarMode: true,
        matchId: 't90',
        observation,
    });
    const step = runner.step({
        observation: observation.map((value, index) => (index === 0 ? 0.5 : value)),
        action: {
            yawLeft: 'yes',
            shootItem: true,
            shootItemIndex: 99,
        },
        inventoryLength: 2,
        rewardSignals: {
            survival: true,
            damageDealt: 3,
        },
    });

    assert.equal(reset.operation, 'reset');
    assert.equal(reset.observation.length, OBSERVATION_LENGTH_V2);
    assert.equal(reset.reward, 0);
    assert.equal(reset.done, false);
    assert.equal(reset.truncated, false);
    assert.equal(reset.info?.domain?.domainId, 'hunt-2d');
    assert.ok(typeof reset.info?.domain?.controlProfileId === 'string' && reset.info.domain.controlProfileId.length > 0);
    assert.equal(step.operation, 'step');
    assert.equal(Boolean(step.action?.shootItem), false);
    assert.equal(Number(step.action?.shootItemIndex), -1);
    assert.ok(Number(step.reward) > 0);
    assert.equal(Boolean(step.done), false);
    assert.equal(Boolean(step.truncated), false);
    assert.equal(step.info?.observationSchemaVersion, OBSERVATION_SCHEMA_VERSION_V2);
    assert.equal(step.info?.metadata?.observationContext?.runtimeNear, true);
    assert.equal(step.info?.metadata?.hybridDecision?.intent?.applied != null, true);
    assert.ok(typeof step.info?.domain?.controlProfileId === 'string' && step.info.domain.controlProfileId.length > 0);
});

test('EpisodeController derives done and truncated state deterministically', () => {
    const controller = new EpisodeController({
        defaultMaxSteps: 2,
    });
    const reset = controller.reset({
        mode: 'classic',
        planarMode: false,
    });
    const step1 = controller.step({});
    const step2 = controller.step({});
    const reset2 = controller.reset({
        episodeId: 'custom-episode',
        mode: 'fight',
        planarMode: true,
    });
    const doneStep = controller.step({
        done: true,
        terminalReason: 'match-ended',
    });

    assert.equal(reset.domain?.domainId, 'classic-3d');
    assert.equal(step1.done, false);
    assert.equal(step1.truncated, false);
    assert.equal(step2.done, false);
    assert.equal(step2.truncated, true);
    assert.equal(step2.truncatedReason, TRAINING_TRUNCATION_REASONS.MAX_STEPS);
    assert.equal(reset2.episodeId, 'custom-episode');
    assert.equal(reset2.domain?.domainId, 'fight-2d');
    assert.equal(doneStep.done, true);
    assert.equal(doneStep.terminalReason, 'match-ended');
});

test('Headless lane derives episode terminal semantics from player and kernel state', () => {
    const dead = deriveHeadlessLaneEpisodeStep({
        player: { alive: false },
        lifecycle: 'running',
    });
    const roundEnded = deriveHeadlessLaneEpisodeStep({
        player: { alive: true },
        lifecycle: 'round_end',
    });
    const matchEnded = deriveHeadlessLaneEpisodeStep({
        player: { alive: true },
        tickLifecycle: 'match_end',
    });
    const timeout = deriveHeadlessLaneEpisodeStep({
        player: { alive: true },
        lifecycle: 'running',
        input: { timeout: true },
    });
    const running = deriveHeadlessLaneEpisodeStep({
        player: { alive: true },
        lifecycle: 'running',
    });

    assert.equal(dead.done, true);
    assert.equal(dead.terminalReason, TRAINING_TERMINAL_REASONS.PLAYER_DEAD);
    assert.equal(roundEnded.done, true);
    assert.equal(roundEnded.terminalReason, TRAINING_TERMINAL_REASONS.MATCH_ENDED);
    assert.equal(matchEnded.done, true);
    assert.equal(matchEnded.terminalReason, TRAINING_TERMINAL_REASONS.MATCH_ENDED);
    assert.equal(timeout.truncated, true);
    assert.equal(timeout.truncatedReason, TRAINING_TRUNCATION_REASONS.TIME_LIMIT);
    assert.equal(running.done, false);
    assert.equal(running.truncated, false);
});

test('Headless lane derives BT93L progress from real observation deltas', () => {
    const previousObservation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    previousObservation[TARGET_DISTANCE_RATIO] = 0.82;
    previousObservation[TARGET_ALIGNMENT] = 0.1;
    previousObservation[LOCAL_OPENNESS_RATIO] = 0.3;

    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[SPEED_RATIO] = 0.2;
    observation[TARGET_DISTANCE_RATIO] = 0.76;
    observation[TARGET_ALIGNMENT] = 0.4;
    observation[TARGET_IN_FRONT] = 1;
    observation[LOCAL_OPENNESS_RATIO] = 0.34;
    observation[WALL_DISTANCE_FRONT] = 0.7;

    const signals = deriveHeadlessObjectiveReachabilitySignals({
        previousObservation,
        observation,
        episode: { done: false, truncated: false },
        action: { boost: true },
        rewardProfileId: BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
    });
    const noopSignals = deriveHeadlessObjectiveReachabilitySignals({
        previousObservation,
        observation: previousObservation,
        episode: { done: false, truncated: false },
        rewardProfileId: BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
    });
    const manualSignals = deriveHeadlessObjectiveReachabilitySignals({
        previousObservation,
        observation,
        input: { progressEvent: true },
        rewardProfileId: BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
    });

    assert.equal(signals.realEnvStepPath, true);
    assert.equal(signals.progressSignalReachable, true);
    assert.equal(signals.objectiveSignalReachable, true);
    assert.equal(signals.source, 'runtime-observation-delta');
    assert.ok(signals.progressEvents.includes('target-distance-improved'));
    assert.equal(noopSignals.progressSignalReachable, false);
    assert.equal(noopSignals.objectiveSignalReachable, false);
    assert.equal(deriveHeadlessObjectiveReachabilitySignals({
        previousObservation,
        observation,
        episode: { done: false, truncated: false },
        action: {
            yawLeft: false,
            yawRight: false,
            pitchUp: false,
            pitchDown: false,
            rollLeft: false,
            rollRight: false,
            boost: false,
            shootMG: false,
            shootItemIndex: -1,
            useItem: -1,
        },
        rewardProfileId: BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID,
    }).progressSignalReachable, false);
    assert.equal(manualSignals.realEnvStepPath, false);
    assert.equal(manualSignals.source, 'manual-injection-counterprobe');
});

test('BT93L reward profile keeps survival-only and noop plateaus non-success', () => {
    const profile = resolveHeadlessRewardProfile(BT93L_OBJECTIVE_REACHABILITY_PROFILE_ID);
    const calculator = new RewardCalculator(profile.rewardCalculatorOptions);
    const survivalOnly = calculator.compute({ survival: true, healthRatio: 1, pressureLevel: 0 });
    const noopHazard = calculator.compute({ survival: true, healthRatio: 1, wallRisk: 1 });
    const progress = calculator.compute({ survival: true, parcoursEnabled: true, checkpointReached: 1 });
    const objectiveComplete = calculator.compute({
        survival: true,
        parcoursEnabled: true,
        checkpointReached: 1,
        parcoursCompleted: true,
        won: true,
    });
    const playerDead = calculator.compute({ survival: false, lost: true });

    assert.equal(profile.rewardCalculatorOptions.weights.baseStep, -0.016);
    assert.equal(profile.rewardCalculatorOptions.weights.survival, 0.012);
    assert.equal(profile.rewardCalculatorOptions.weights.survivalPressureBonus, 0.01);
    assert.equal(profile.rewardCalculatorOptions.weights.checkpointReached, 0.85);
    assert.equal(profile.rewardCalculatorOptions.weights.loss, -4.5);
    assert.ok(survivalOnly.total <= 0);
    assert.ok(noopHazard.total < 0);
    assert.ok(progress.total > 0);
    assert.ok(objectiveComplete.total > progress.total);
    assert.ok(playerDead.total < 0);
});

test('RewardCalculator keeps transparent additive shaping totals', () => {
    const calculator = new RewardCalculator({
        weights: {
            baseStep: -0.01,
            survival: 0.1,
            kill: 2,
            crash: -3,
            stuck: -1,
            itemPickup: 0.5,
            itemUse: 0.25,
            damageDealt: 0.05,
            damageTaken: -0.02,
            win: 4,
            loss: -4,
        },
    });
    const reward = calculator.compute({
        survival: true,
        kills: 2,
        crashed: true,
        stuck: true,
        itemsCollected: 1,
        itemUses: 2,
        damageDealt: 10,
        damageTaken: 5,
        won: true,
        bonusReward: 0.5,
    });

    assert.equal(reward.total.toFixed(2), '5.99');
    assert.equal(sumRewardComponents(reward.components).toFixed(2), reward.total.toFixed(2));
    assert.equal(reward.components.kill.toFixed(2), '4.00');
    assert.equal(reward.components.crash.toFixed(2), '-3.00');
    assert.equal(reward.components.stuck.toFixed(2), '-1.00');
    assert.equal(reward.components.itemPickup.toFixed(2), '0.50');
    assert.equal(reward.components.itemUse.toFixed(2), '0.50');
    assert.equal(reward.components.damageDealt.toFixed(2), '0.50');
    assert.equal(reward.components.damageTaken.toFixed(2), '-0.10');
    assert.equal(reward.components.external.toFixed(2), '0.50');
});

test('Trainer payload adapter and WebSocketTrainerBridge transport additive training frames', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const sent = [];

    class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
            this.readyState = MockWebSocket.OPEN;
            this._listeners = new Map();
            setTimeout(() => this._emit('open', {}), 0);
        }

        addEventListener(type, handler) {
            const list = this._listeners.get(type) || [];
            list.push(handler);
            this._listeners.set(type, list);
        }

        removeEventListener(type, handler) {
            const list = this._listeners.get(type) || [];
            this._listeners.set(type, list.filter((entry) => entry !== handler));
        }

        _emit(type, event) {
            const list = this._listeners.get(type) || [];
            list.forEach((handler) => handler(event));
        }

        send(raw) {
            const envelope = JSON.parse(raw);
            sent.push(envelope);
            if (envelope.type === 'bot-action-request') {
                setTimeout(() => {
                    this._emit('message', {
                        data: JSON.stringify({
                            id: envelope.id,
                            action: { yawLeft: true },
                        }),
                    });
                }, 0);
                return;
            }
            setTimeout(() => {
                this._emit('message', {
                    data: JSON.stringify({
                        id: envelope.id,
                        ok: true,
                    }),
                });
            }, 0);
        }

        close() {
            this.readyState = MockWebSocket.CLOSED;
            this._emit('close', {});
        }
    }

    globalThis.WebSocket = MockWebSocket;
    try {
        const bridge = new WebSocketTrainerBridge({
            enabled: true,
            timeoutMs: 100,
            url: 'ws://127.0.0.1:8765',
        });
        const runtimePayload = buildTrainerRuntimeObservationPayload({
            mode: 'classic',
            planarMode: false,
            dt: 1 / 60,
            observation: new Array(40).fill(0),
        }, {
            index: 1,
            hp: 10,
            maxHp: 10,
            shieldHP: 3,
            maxShieldHp: 5,
            inventory: ['rocket'],
        });
        bridge.submitObservation(runtimePayload);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const action = bridge.consumeLatestAction();

        const transitionPayload = buildTrainerTransitionPayload({
            operation: 'step',
            episodeId: 'episode-1',
            episodeIndex: 1,
            stepIndex: 1,
            observation: new Array(40).fill(0.2),
            action: { yawLeft: true },
            reward: 0.5,
            done: false,
            truncated: false,
            info: {
                domain: {
                    mode: 'classic',
                    planarMode: false,
                    domainId: 'classic-3d',
                },
            },
        });
        bridge.submitTrainingStep(transitionPayload);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = bridge.consumeLatestResponse();
        bridge.close();

        assert.deepEqual(sent.map((entry) => entry.type), ['bot-action-request', 'training-step']);
        assert.equal(Boolean(action?.yawLeft), true);
        assert.equal(response?.ok === true, true);
        assert.ok(typeof runtimePayload?.controlProfileId === 'string' && runtimePayload.controlProfileId.length > 0);
        assert.ok(typeof transitionPayload?.info?.domain?.controlProfileId === 'string' && transitionPayload.info.domain.controlProfileId.length > 0);
        assert.equal(sent[0]?.type, 'bot-action-request');
        assert.equal(Number.isInteger(sent[0]?.id), true);
        assert.equal(Object.prototype.hasOwnProperty.call(sent[0] || {}, 'payload'), true);
        assert.equal(typeof sent[1]?.contractVersion, 'string');
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }
});

test('T97: WebSocketTrainerBridge erfasst Retry/Timeout/Fallback-Telemetrie deterministisch', async () => {
    const originalWebSocket = globalThis.WebSocket;
    let actionRequestCount = 0;

    class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor() {
            this.readyState = MockWebSocket.OPEN;
            this._listeners = new Map();
            setTimeout(() => this._emit('open', {}), 0);
        }

        addEventListener(type, handler) {
            const handlers = this._listeners.get(type) || [];
            handlers.push(handler);
            this._listeners.set(type, handlers);
        }

        removeEventListener(type, handler) {
            const handlers = this._listeners.get(type) || [];
            this._listeners.set(type, handlers.filter((entry) => entry !== handler));
        }

        _emit(type, payload) {
            const handlers = this._listeners.get(type) || [];
            for (const handler of handlers) {
                handler(payload);
            }
        }

        send(raw) {
            const envelope = JSON.parse(raw);
            if (envelope.type !== 'bot-action-request') {
                return;
            }
            actionRequestCount += 1;
            const sequence = actionRequestCount;
            setTimeout(() => {
                this._emit('message', {
                    data: JSON.stringify({
                        id: envelope.id,
                        action: {
                            yawRight: true,
                            requestTick: Number(envelope?.payload?.tick || 0),
                            requestSequence: sequence,
                        },
                    }),
                });
            }, sequence === 1 ? 10 : 2);
        }

        close() {
            this.readyState = MockWebSocket.CLOSED;
            this._emit('close', {});
        }
    }

    globalThis.WebSocket = MockWebSocket;
    try {
        const bridge = new WebSocketTrainerBridge({
            enabled: true,
            timeoutMs: 12,
            maxRetries: 0,
            retryDelayMs: 0,
            url: 'ws://127.0.0.1:8765',
            maxPendingAcks: 4,
            backpressureThreshold: 2,
            dropTrainingPayloadWhenBacklogged: true,
        });
        bridge.submitObservation({ tick: 1 });
        bridge.submitObservation({ tick: 2 });
        bridge.submitObservation({ tick: 3 });
        await new Promise((resolve) => setTimeout(resolve, 20));

        bridge.submitTrainingStep({ frame: 1 });
        bridge.submitTrainingStep({ frame: 2 });
        bridge.submitTrainingStep({ frame: 3 });
        bridge.submitTrainingStep({ frame: 4 });

        const action = bridge.consumeLatestAction();
        if (!action) {
            bridge.recordFallback('test-no-action');
        }
        bridge.recordFallback('test-manual-fallback');
        const failure = bridge.consumeFailure();
        const telemetry = bridge.getTelemetrySnapshot();
        bridge.close();

        assert.equal(Boolean(action?.yawRight), true);
        assert.equal(Number(action?.requestTick || 0), 3);
        assert.equal(failure, null);
        assert.ok(Number(telemetry.requestsSent || 0) >= 2);
        assert.ok(Number(telemetry.responsesReceived || 0) >= 2);
        assert.equal(Number(telemetry.retries || 0), 0);
        assert.equal(Number(telemetry.timeouts || 0), 0);
        assert.ok(Number(telemetry.fallbacks || 0) >= 1);
        assert.ok(Number(telemetry.actionDrops || 0) >= 1);
        assert.ok(Number(telemetry.actionSendSkipped || 0) >= 2);
        assert.ok(Number(telemetry.backpressureDrops || 0) >= 1);
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }
});
