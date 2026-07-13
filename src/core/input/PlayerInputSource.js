// ============================================
// PlayerInputSource.js - interface for player input
// ============================================

/**
 * Abstract interface for player input sources.
 * Implementations: TouchInputSource and resolver-managed keyboard/gamepad adapters
 *
 * Each player in a match has exactly one PlayerInputSource assigned.
 * The poll() method returns the current input state as a normalized object.
 */
export class PlayerInputSource {
    constructor(type = 'unknown') {
        this.type = type;
        this.playerIndex = -1;
        this.active = false;
    }

    /**
     * Returns the current input state.
     * @returns {{ pitchUp: boolean, pitchDown: boolean, yawLeft: boolean, yawRight: boolean,
     *             rollLeft: boolean, rollRight: boolean, boost: boolean, boostPressed: boolean,
     *             cameraSwitch: boolean, dropItem: boolean, useItem: boolean, shootItem: boolean, shootMG: boolean,
     *             nextItem: boolean }}
     */
    poll() {
        throw new Error('PlayerInputSource.poll() not implemented');
    }

    bind(playerIndex) {
        this.playerIndex = playerIndex;
        this.active = true;
    }

    unbind() {
        this.playerIndex = -1;
        this.active = false;
    }

    dispose() {
        this.unbind();
    }
}
