// ============================================
// TrainingTransportFacade.js - orchestrates step-runner and optional trainer transport
// ============================================

import { DeterministicTrainingStepRunner } from './DeterministicTrainingStepRunner.js';
import { buildTrainerTransitionPayload } from './TrainerPayloadAdapter.js';
import { createMatchKernelTrainingPayload } from '../../../state/MatchKernelConsumerAdapters.js';

function canSubmitViaBridge(bridge) {
    if (!bridge || typeof bridge !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(bridge, 'enabled') && bridge.enabled === false) {
        return false;
    }
    return true;
}

export class TrainingTransportFacade {
    constructor(options = {}) {
        this.stepRunner = options.stepRunner || new DeterministicTrainingStepRunner(options);
        this.bridge = options.bridge || null;
        this._latestPacket = null;
        this._kernelProfile = options.kernelProfile && typeof options.kernelProfile === 'object'
            ? { ...options.kernelProfile }
            : null;
    }

    setBridge(bridge) {
        this.bridge = bridge || null;
    }

    getLatestPacket() {
        return this._latestPacket;
    }

    reset(input = {}) {
        const transition = this.stepRunner.reset(input);
        return this._emit('training-reset', transition, input);
    }

    step(input = {}) {
        const transition = this.stepRunner.step(input);
        return this._emit('training-step', transition, input);
    }

    _emit(type, transition, input) {
        const kernelRuntime = createMatchKernelTrainingPayload({
            type,
            transition,
            input,
            profile: this._kernelProfile,
        });
        const payload = buildTrainerTransitionPayload(transition, {
            mode: transition?.info?.domain?.mode || input?.mode,
            planarMode: transition?.info?.domain?.planarMode ?? input?.planarMode,
            controlProfileId: transition?.info?.domain?.controlProfileId ?? input?.controlProfileId,
            kernelRuntime,
        });
        const delivered = this._submit(type, payload);
        const packet = {
            type,
            delivered,
            kernelRuntime,
            payload,
            transition,
        };
        this._latestPacket = packet;
        return packet;
    }

    _submit(type, payload) {
        if (!canSubmitViaBridge(this.bridge)) {
            return false;
        }
        if (typeof this.bridge.submitTrainingPayload === 'function') {
            this.bridge.submitTrainingPayload(type, payload);
            return true;
        }
        if (type === 'training-step' && typeof this.bridge.submitObservation === 'function') {
            this.bridge.submitObservation(payload);
            return true;
        }
        return false;
    }
}
