// ============================================
// LocalDqnInference.js - browser-side DQN forward pass (no WebSocket needed)
// ============================================
//
// Loads a DQN checkpoint and runs inference locally in the game loop.
// Supports both v34 (2-layer) and v35 (multi-layer) checkpoint formats.
// Network: N-layer MLP with ReLU activation (hidden layers), linear output.
// Eliminates the ~80ms WebSocket round-trip latency.
// ============================================

function toFinite(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function argMax(values) {
    if (!values || values.length === 0) return 0;
    let bestIndex = 0;
    let bestValue = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] > bestValue) {
            bestValue = values[i];
            bestIndex = i;
        }
    }
    return bestIndex;
}

export class LocalDqnInference {
    constructor() {
        this._loaded = false;
        this._inputSize = 0;
        this._outputSize = 0;
        this._layers = []; // { inputSize, outputSize, weights: Float64Array, bias: Float64Array }
        this._checkpointMeta = null;
        // Reusable buffers for zero-allocation forward pass
        this._activationBuffers = [];
    }

    get loaded() {
        return this._loaded;
    }

    get inputSize() {
        return this._inputSize;
    }

    get outputSize() {
        return this._outputSize;
    }

    get checkpointMeta() {
        return this._checkpointMeta;
    }

    _loadV35Layers(networkState) {
        if (!Array.isArray(networkState.layers) || networkState.layers.length === 0) {
            return false;
        }
        const layers = [];
        for (let l = 0; l < networkState.layers.length; l++) {
            const src = networkState.layers[l];
            if (!src || typeof src !== 'object') return false;
            const inSize = Number(src.inputSize) || 0;
            const outSize = Number(src.outputSize) || 0;
            if (inSize < 1 || outSize < 1) return false;
            if (!Array.isArray(src.weights) || src.weights.length !== inSize * outSize) return false;
            if (!Array.isArray(src.bias) || src.bias.length !== outSize) return false;
            layers.push({
                inputSize: inSize,
                outputSize: outSize,
                weights: new Float64Array(src.weights.map(v => toFinite(v))),
                bias: new Float64Array(src.bias.map(v => toFinite(v))),
            });
        }
        this._layers = layers;
        this._inputSize = layers[0].inputSize;
        this._outputSize = layers[layers.length - 1].outputSize;
        return true;
    }

    _loadV34Layers(networkState) {
        const inputSize = Number(networkState.inputSize) || 0;
        const hiddenSize = Number(networkState.hiddenSize) || 0;
        const outputSize = Number(networkState.outputSize) || 0;
        if (inputSize < 1 || hiddenSize < 1 || outputSize < 1) return false;
        if (!Array.isArray(networkState.weightsInputHidden)
            || networkState.weightsInputHidden.length !== inputSize * hiddenSize) return false;
        if (!Array.isArray(networkState.biasHidden)
            || networkState.biasHidden.length !== hiddenSize) return false;
        if (!Array.isArray(networkState.weightsHiddenOutput)
            || networkState.weightsHiddenOutput.length !== hiddenSize * outputSize) return false;
        if (!Array.isArray(networkState.biasOutput)
            || networkState.biasOutput.length !== outputSize) return false;

        this._layers = [
            {
                inputSize,
                outputSize: hiddenSize,
                weights: new Float64Array(networkState.weightsInputHidden.map(v => toFinite(v))),
                bias: new Float64Array(networkState.biasHidden.map(v => toFinite(v))),
            },
            {
                inputSize: hiddenSize,
                outputSize,
                weights: new Float64Array(networkState.weightsHiddenOutput.map(v => toFinite(v))),
                bias: new Float64Array(networkState.biasOutput.map(v => toFinite(v))),
            },
        ];
        this._inputSize = inputSize;
        this._outputSize = outputSize;
        return true;
    }

    loadCheckpoint(checkpoint) {
        if (!checkpoint || typeof checkpoint !== 'object') {
            return { ok: false, error: 'checkpoint-missing' };
        }
        const version = checkpoint.contractVersion;
        if (
            version !== 'v36-dqn-checkpoint-v2'
            && version !== 'v35-dqn-checkpoint-v1'
            && version !== 'v34-dqn-checkpoint-v1'
        ) {
            return { ok: false, error: 'contract-version-mismatch' };
        }
        const networkState = checkpoint.online;
        if (!networkState || typeof networkState !== 'object') {
            return { ok: false, error: 'online-network-missing' };
        }

        // Try v35 layers[] format first, then v34 flat format
        let loaded = false;
        if (Array.isArray(networkState.layers) && networkState.layers.length > 0) {
            loaded = this._loadV35Layers(networkState);
        }
        if (!loaded) {
            loaded = this._loadV34Layers(networkState);
        }
        if (!loaded) {
            return { ok: false, error: 'invalid-network-dimensions' };
        }

        // Pre-allocate activation buffers for zero-alloc forward pass
        this._activationBuffers = this._layers.map(layer =>
            new Float64Array(layer.outputSize)
        );

        this._checkpointMeta = {
            envSteps: Number(checkpoint.envSteps) || 0,
            optimizerSteps: Number(checkpoint.optimizerSteps) || 0,
            maxItemIndex: Number(checkpoint.maxItemIndex) || 0,
            planarMode: checkpoint.planarMode === true,
            actionCount: Number(checkpoint.actionCount) || this._outputSize,
            hiddenLayers: this._layers.slice(0, -1).map(l => l.outputSize),
            observationSchemaVersion: checkpoint.observationSchemaVersion || null,
            actionArchitectureVersion: checkpoint.actionArchitectureVersion || null,
        };
        this._loaded = true;
        return { ok: true, error: null };
    }

    predict(observation) {
        if (!this._loaded) return null;
        const input = Array.isArray(observation) ? observation : [];
        const numLayers = this._layers.length;

        // Forward pass through all layers
        for (let l = 0; l < numLayers; l++) {
            const layer = this._layers[l];
            const out = this._activationBuffers[l];
            const isLastLayer = l === numLayers - 1;
            const prevOut = l > 0 ? this._activationBuffers[l - 1] : null;

            for (let j = 0; j < layer.outputSize; j++) {
                let sum = layer.bias[j];
                if (l === 0) {
                    // First layer reads from observation input
                    for (let i = 0; i < layer.inputSize; i++) {
                        sum += toFinite(input[i]) * layer.weights[i * layer.outputSize + j];
                    }
                } else {
                    // Subsequent layers read from previous activation
                    for (let i = 0; i < layer.inputSize; i++) {
                        sum += prevOut[i] * layer.weights[i * layer.outputSize + j];
                    }
                }
                // ReLU for hidden layers, linear for output
                out[j] = isLastLayer ? sum : (sum > 0 ? sum : 0);
            }
        }

        return Array.from(this._activationBuffers[numLayers - 1]);
    }

    selectBestAction(observation) {
        const qValues = this.predict(observation);
        if (!qValues) return { actionIndex: 0, qValue: 0 };
        const actionIndex = argMax(qValues);
        return {
            actionIndex,
            qValue: toFinite(qValues[actionIndex]),
        };
    }
}
