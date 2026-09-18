const INTERCEPT_MESSAGE = 'Abgefangen!';

/**
 * E38: the player who shot an incoming rocket out of the sky gets told about it.
 *
 * The announcement is derived from the intercept counter of the scoreboard row instead
 * of a local event, because on a client only the host simulates the hit: the counter
 * arrives with the reconciled scoreboard, a local event never would. Only a *rise*
 * counts - a round restart puts every counter back to zero, and that must stay quiet.
 *
 * Nothing is allocated while watching: the counters live in one map, and a message
 * string is only built in the frame an intercept actually happened.
 */
export class HuntInterceptAnnouncer {
    constructor() {
        this._lastByPlayer = new Map();
    }

    reset() {
        this._lastByPlayer.clear();
    }

    /**
     * @param {Array<{ playerIndex?: number, label?: string, intercepts?: number }>} rows
     *        Scoreboard rows of the match runtime projection.
     * @param {number[]} localPlayerIndices
     *        Indices of the humans sitting at this machine. Bots and remote players are
     *        counted by the scoreboard but never announced here.
     * @returns {string|null} The message to show, or null when nothing happened.
     */
    consume(rows, localPlayerIndices) {
        if (!Array.isArray(rows) || !Array.isArray(localPlayerIndices) || localPlayerIndices.length === 0) {
            return null;
        }
        let message = null;
        for (const row of rows) {
            const playerIndex = Number(row?.playerIndex);
            if (!Number.isInteger(playerIndex) || !localPlayerIndices.includes(playerIndex)) continue;
            const intercepts = Math.max(0, Number(row?.intercepts) || 0);
            const previous = this._lastByPlayer.get(playerIndex);
            this._lastByPlayer.set(playerIndex, intercepts);
            // An unknown player is only recorded: joining mid match must not announce.
            if (previous === undefined || intercepts <= previous || message !== null) continue;
            message = localPlayerIndices.length > 1
                ? `${INTERCEPT_MESSAGE} ${String(row?.label || `P${playerIndex + 1}`)}`
                : INTERCEPT_MESSAGE;
        }
        return message;
    }
}
