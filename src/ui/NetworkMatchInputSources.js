const INPUT_DEFAULTS = Object.freeze({
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
    useItem: false,
    shootItem: false,
    shootMG: false,
    nextItem: false,
});

function normalizePeerId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNetworkInputState(input = null) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        pitchUp: source.pitchUp === true,
        pitchDown: source.pitchDown === true,
        yawLeft: source.yawLeft === true,
        yawRight: source.yawRight === true,
        rollLeft: source.rollLeft === true,
        rollRight: source.rollRight === true,
        boost: source.boost === true,
        boostPressed: source.boostPressed === true,
        cameraSwitch: source.cameraSwitch === true,
        dropItem: source.dropItem === true,
        useItem: source.useItem === true,
        shootItem: source.shootItem === true,
        shootMG: source.shootMG === true,
        nextItem: source.nextItem === true,
    };
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
