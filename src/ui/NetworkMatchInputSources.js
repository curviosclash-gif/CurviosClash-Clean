import {
    advanceSteeringAxis,
    applySteeringReleaseDeadzone,
    createSteeringRampState,
    DEFAULT_AXIS_ATTACK_RATE,
    DEFAULT_AXIS_RELEASE_RATE,
    readAnalogAxis,
    resolveSteeringAxisTarget,
    resolveSteeringStepSeconds,
    toPositiveSteeringRate,
} from '../shared/input/SteeringRampOps.js';

const INPUT_DEFAULTS = Object.freeze({
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    boostPressed: false,
    slowMo: false,
    slowMoPressed: false,
    cameraSwitch: false,
    dropItem: false,
    useItem: false,
    shootItem: false,
    shootRocket: false,
    shootMG: false,
    nextItem: false,
});

const ANALOG_AXIS_KEYS = Object.freeze(['pitchAxis', 'yawAxis', 'rollAxis']);
const ONE_SHOT_INPUT_KEYS = Object.freeze([
    'boostPressed',
    'slowMoPressed',
    'cameraSwitch',
    'dropItem',
    'useItem',
    'shootItem',
    'shootRocket',
    'nextItem',
]);

function normalizePeerId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

// Analog axes stay optional on purpose: a missing field lets PlayerController fall
// back to the digital keys, while a hard 0 would mute keyboard players.
function normalizeAnalogAxis(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const clamped = Math.min(1, Math.max(-1, value));
    const rounded = Math.round(clamped * 1000) / 1000;
    return rounded === 0 ? 0 : rounded;
}

export function normalizeNetworkInputState(input = null) {
    const source = input && typeof input === 'object' ? input : {};
    const normalized = {
        pitchUp: source.pitchUp === true,
        pitchDown: source.pitchDown === true,
        yawLeft: source.yawLeft === true,
        yawRight: source.yawRight === true,
        rollLeft: source.rollLeft === true,
        rollRight: source.rollRight === true,
        boost: source.boost === true,
        boostPressed: source.boostPressed === true,
        slowMo: source.slowMo === true,
        slowMoPressed: source.slowMoPressed === true,
        cameraSwitch: source.cameraSwitch === true,
        dropItem: source.dropItem === true,
        useItem: source.useItem === true,
        shootItem: source.shootItem === true,
        shootRocket: source.shootRocket === true,
        shootMG: source.shootMG === true,
        nextItem: source.nextItem === true,
    };
    for (let i = 0; i < ANALOG_AXIS_KEYS.length; i += 1) {
        const key = ANALOG_AXIS_KEYS[i];
        const axis = normalizeAnalogAxis(source[key]);
        if (axis !== undefined) normalized[key] = axis;
    }
    return normalized;
}

export function createPassiveNetworkInputSource() {
    return {
        type: 'network-passive',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
        },
        unbind() {
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            return INPUT_DEFAULTS;
        },
        dispose() {
            this.unbind();
        },
    };
}

const RAMPED_AXES = Object.freeze([
    { stateKey: 'pitch', axisKey: 'pitchAxis', positiveKey: 'pitchUp', negativeKey: 'pitchDown' },
    { stateKey: 'yaw', axisKey: 'yawAxis', positiveKey: 'yawLeft', negativeKey: 'yawRight' },
    { stateKey: 'roll', axisKey: 'rollAxis', positiveKey: 'rollLeft', negativeKey: 'rollRight' },
]);

/**
 * Turns the held keys of a guest into smoothed analog axes.
 *
 * A guest predicts its own plane locally, the host resimulates the same slot, and
 * the host never learns the guest's per machine smooth steering setting. Ramping
 * here and shipping the result means both sides read one number, so the reconciler
 * has nothing left to pull back. The host takes a finite axis as a stick and never
 * ramps it a second time (PlayerController.resolveControlState).
 *
 * @param {{ attackRate?: number, releaseRate?: number }} [rates]
 */
function createGuestSteeringRamp({ attackRate, releaseRate } = {}) {
    const state = createSteeringRampState();
    const rates = {
        attackRate: toPositiveSteeringRate(attackRate, DEFAULT_AXIS_ATTACK_RATE),
        releaseRate: toPositiveSteeringRate(releaseRate, DEFAULT_AXIS_RELEASE_RATE),
    };
    return function rampInput(input, dt) {
        const source = input && typeof input === 'object' ? input : {};
        const ramped = { ...source };
        for (let i = 0; i < RAMPED_AXES.length; i += 1) {
            const axis = RAMPED_AXES[i];
            const analogValue = readAnalogAxis(source, axis.axisKey);
            const target = resolveSteeringAxisTarget(analogValue, source, axis.positiveKey, axis.negativeKey);
            const next = advanceSteeringAxis(state, axis.stateKey, target, analogValue, rates, dt);
            ramped[axis.axisKey] = applySteeringReleaseDeadzone(next);
        }
        return ramped;
    };
}

export function createNetworkLocalInputSource({
    source = null,
    session = null,
    playerId = '',
    sendToSession = false,
    steeringRamp = null,
} = {}) {
    const rampInput = steeringRamp?.enabled === true ? createGuestSteeringRamp(steeringRamp) : null;
    return {
        type: 'network-local',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
            source?.bind?.(playerIndex);
        },
        unbind() {
            source?.unbind?.();
            this.playerIndex = -1;
            this.active = false;
        },
        poll(context = null) {
            const polled = source?.poll?.(context) || null;
            // Normalising once means the prediction below and the payload sent to the
            // host share the very same rounded numbers; rounding twice would leave a
            // permanent offset between the two simulations.
            const ramped = rampInput ? rampInput(polled, resolveSteeringStepSeconds(context?.dt)) : polled;
            const input = normalizeNetworkInputState(ramped);
            if (sendToSession && typeof session?.sendInput === 'function') {
                session.sendInput({
                    ...input,
                    playerId: normalizePeerId(playerId),
                    playerIndex: this.playerIndex,
                });
            }
            return input;
        },
        clearInputState() {
            source?.clearInputState?.();
        },
        dispose() {
            source?.dispose?.();
            this.unbind();
        },
    };
}

export function createNetworkRemoteInputSource({
    session = null,
    peerId = '',
    playerId = '',
} = {}) {
    const expectedPeerId = normalizePeerId(peerId || playerId);
    let latestInput = INPUT_DEFAULTS;
    let bound = false;

    const matchesExpectedPeer = (event = {}) => {
        if (!expectedPeerId) return true;
        const eventPeerId = normalizePeerId(event.peerId);
        const eventPlayerId = normalizePeerId(event.playerId);
        return eventPeerId === expectedPeerId || eventPlayerId === expectedPeerId;
    };
    const clearInputState = () => {
        latestInput = INPUT_DEFAULTS;
    };
    const handler = (event = {}) => {
        if (!matchesExpectedPeer(event)) return;
        const nextInput = normalizeNetworkInputState(event.input);
        for (let i = 0; i < ONE_SHOT_INPUT_KEYS.length; i += 1) {
            const key = ONE_SHOT_INPUT_KEYS[i];
            nextInput[key] = nextInput[key] || latestInput[key] === true;
        }
        latestInput = nextInput;
    };
    const disconnectHandler = (event = {}) => {
        if (matchesExpectedPeer(event)) clearInputState();
    };

    return {
        type: 'network-remote',
        playerIndex: -1,
        active: false,
        bind(playerIndex) {
            this.playerIndex = playerIndex;
            this.active = true;
            if (!bound && typeof session?.on === 'function') {
                session.on('remoteInput', handler);
                session.on('playerDisconnected', disconnectHandler);
                session.on('playerRemoved', disconnectHandler);
                bound = true;
            }
        },
        unbind() {
            if (bound && typeof session?.off === 'function') {
                session.off('remoteInput', handler);
                session.off('playerDisconnected', disconnectHandler);
                session.off('playerRemoved', disconnectHandler);
            }
            bound = false;
            clearInputState();
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            let hasOneShotInput = false;
            for (let i = 0; i < ONE_SHOT_INPUT_KEYS.length; i += 1) {
                if (latestInput[ONE_SHOT_INPUT_KEYS[i]] === true) {
                    hasOneShotInput = true;
                    break;
                }
            }
            if (!hasOneShotInput) return latestInput;

            const consumedInput = { ...latestInput };
            for (let i = 0; i < ONE_SHOT_INPUT_KEYS.length; i += 1) {
                latestInput[ONE_SHOT_INPUT_KEYS[i]] = false;
            }
            return consumedInput;
        },
        clearInputState() {
            clearInputState();
        },
        dispose() {
            this.unbind();
        },
    };
}
