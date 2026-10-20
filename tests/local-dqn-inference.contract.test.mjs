import assert from 'node:assert/strict';
import test from 'node:test';

import { ObservationBridgePolicy } from '../src/entities/ai/ObservationBridgePolicy.js';
import { LocalDqnInference } from '../src/entities/ai/inference/LocalDqnInference.js';

const ACTION_COUNT = 17;
const INPUT = [2, -1];

function checkpoint(version, format) {
    const outputWeights = new Array(2 * ACTION_COUNT).fill(0);
    // Hidden neuron 0 contributes 1.5 to Q(action 2); all other output values are zero.
    outputWeights[2] = 1;
    const v34 = {
        inputSize: 2,
        hiddenSize: 2,
        outputSize: ACTION_COUNT,
        weightsInputHidden: [1, -1, 0.5, 2],
        biasHidden: [0, 2],
        weightsHiddenOutput: outputWeights,
        biasOutput: new Array(ACTION_COUNT).fill(0),
    };
    const online = format === 'flat' ? v34 : {
        layers: [
            { inputSize: 2, outputSize: 2, weights: [1, -1, 0.5, 2], bias: [0, 2] },
            { inputSize: 2, outputSize: ACTION_COUNT, weights: outputWeights, bias: new Array(ACTION_COUNT).fill(0) },
        ],
    };
    return {
        contractVersion: version,
        online,
        actionCount: ACTION_COUNT,
        maxItemIndex: 0,
        planarMode: false,
        envSteps: 7,
        optimizerSteps: 5,
    };
}

const COMPATIBLE_CHECKPOINTS = [
    ['v34 flat checkpoint', 'v34-dqn-checkpoint-v1', 'flat'],
    ['v35 layered checkpoint', 'v35-dqn-checkpoint-v1', 'layers'],
    ['v36 layered checkpoint', 'v36-dqn-checkpoint-v2', 'layers'],
];

for (const [label, version, format] of COMPATIBLE_CHECKPOINTS) {
    test(`${label} produces the hand-calculated ReLU values and best action`, () => {
        const inference = new LocalDqnInference();
        assert.deepEqual(inference.loadCheckpoint(checkpoint(version, format)), { ok: true, error: null });
        const expectedQValues = new Array(ACTION_COUNT).fill(0);
        expectedQValues[2] = 1.5;
        assert.deepEqual(inference.predict(INPUT), expectedQValues,
            'ReLU hidden outputs are [1.5, 0], then the linear output has Q2=1.5');
        assert.deepEqual(inference.selectBestAction(INPUT), { actionIndex: 2, qValue: 1.5 });
    });
}

test('the production observation-bridge caller decodes the winning checkpoint action', () => {
    const policy = new ObservationBridgePolicy({ autoLoadCheckpoint: false });
    assert.deepEqual(policy.loadLocalCheckpoint(checkpoint('v36-dqn-checkpoint-v2', 'layers')), {
        ok: true,
        error: null,
    });

    const action = policy.update(1 / 60, { inventory: [] }, {
        observation: INPUT,
        rules: { planarMode: false, domainId: 'HUNT-3D' },
        players: [],
        projectiles: [],
    });
    assert.equal(policy._localInferenceVocabulary.decode(2).yawRight, true,
        'checkpoint action 2 maps to the right-turn evade template');
    assert.notEqual(action.yawLeft, action.yawRight,
        'the production hybrid resolver returns one sanitized yaw direction');
});

test('missing, incompatible, and malformed checkpoints fail closed with their load errors', () => {
    const inference = new LocalDqnInference();
    assert.deepEqual(inference.loadCheckpoint(null), { ok: false, error: 'checkpoint-missing' });
    assert.deepEqual(inference.loadCheckpoint({
        contractVersion: 'v99-dqn',
        online: {},
    }), { ok: false, error: 'contract-version-mismatch' });
    assert.deepEqual(inference.loadCheckpoint({
        contractVersion: 'v36-dqn-checkpoint-v2',
    }), { ok: false, error: 'online-network-missing' });

    const malformed = checkpoint('v35-dqn-checkpoint-v1', 'layers');
    malformed.online.layers[0].weights.pop();
    assert.deepEqual(inference.loadCheckpoint(malformed), {
        ok: false,
        error: 'invalid-network-dimensions',
    });
    assert.equal(inference.loaded, false);
});

test('an invalid follow-up load leaves the caller’s last valid inference available', () => {
    const policy = new ObservationBridgePolicy({ autoLoadCheckpoint: false });
    const valid = checkpoint('v34-dqn-checkpoint-v1', 'flat');
    assert.equal(policy.loadLocalCheckpoint(valid).ok, true);
    const loadedInference = policy._localInference;
    const loadedVocabulary = policy._localInferenceVocabulary;

    const invalid = checkpoint('v34-dqn-checkpoint-v1', 'flat');
    invalid.online.weightsHiddenOutput.pop();
    assert.deepEqual(policy.loadLocalCheckpoint(invalid), {
        ok: false,
        error: 'invalid-network-dimensions',
    });
    assert.equal(policy._localInference, loadedInference);
    assert.equal(policy._localInferenceVocabulary, loadedVocabulary);

    const action = policy.update(1 / 60, { inventory: [] }, {
        observation: INPUT,
        rules: { planarMode: false },
        players: [],
        projectiles: [],
    });
    assert.notEqual(action.yawLeft, action.yawRight, 'a rejected checkpoint does not disable the last valid action path');
});

test('the production caller rejects both larger and smaller disconnected layers without replacing valid inference', () => {
    const policy = new ObservationBridgePolicy({ autoLoadCheckpoint: false });
    assert.equal(policy.loadLocalCheckpoint(checkpoint('v36-dqn-checkpoint-v2', 'layers')).ok, true);
    const loadedInference = policy._localInference;
    const loadedVocabulary = policy._localInferenceVocabulary;

    for (const inputSize of [3, 1]) {
        const disconnected = checkpoint('v36-dqn-checkpoint-v2', 'layers');
        disconnected.online.layers[1].inputSize = inputSize;
        disconnected.online.layers[1].weights = new Array(inputSize * ACTION_COUNT).fill(0);

        assert.deepEqual(policy.loadLocalCheckpoint(disconnected), {
            ok: false,
            error: 'invalid-network-dimensions',
        }, `the next layer cannot consume the previous layer's two activations when it declares ${inputSize} inputs`);
        assert.equal(policy._localInference, loadedInference);
        assert.equal(policy._localInferenceVocabulary, loadedVocabulary);

        const action = policy.update(1 / 60, { inventory: [] }, {
            observation: INPUT,
            rules: { planarMode: false },
            players: [],
            projectiles: [],
        });
        assert.notEqual(action.yawLeft, action.yawRight,
            'rejecting a disconnected checkpoint preserves the previous valid action path');
    }
});
