// ============================================
// PlayerInputSource.js - UI-local input source base class
// ============================================

/**
 * Minimal PlayerInputSource base used by UI-only sources (for example touch UI).
 * The interface intentionally mirrors core/input/PlayerInputSource.js.
 */
export class PlayerInputSource {
    constructor(type = 'unknown') {
        this.type = type;
        this.playerIndex = -1;
        this.active = false;
    }

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
