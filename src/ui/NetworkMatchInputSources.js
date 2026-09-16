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

export function createNetworkLocalInputSource({
    source = null,
    session = null,
    playerId = '',
    sendToSession = false,
} = {}) {
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
        poll() {
            const input = normalizeNetworkInputState(source?.poll?.() || null);
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

    const handler = (event = {}) => {
        const eventPeerId = normalizePeerId(event.peerId);
        const eventPlayerId = normalizePeerId(event.playerId);
        if (expectedPeerId && eventPeerId !== expectedPeerId && eventPlayerId !== expectedPeerId) {
            return;
        }
        latestInput = normalizeNetworkInputState(event.input);
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
                bound = true;
            }
        },
        unbind() {
            if (bound && typeof session?.off === 'function') {
                session.off('remoteInput', handler);
            }
            bound = false;
            this.playerIndex = -1;
            this.active = false;
        },
        poll() {
            return latestInput;
        },
        dispose() {
            this.unbind();
        },
    };
}
