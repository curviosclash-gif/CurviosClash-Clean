const PORTAL_OPENED_MESSAGE = 'Ein Portal hat sich geöffnet!';

/**
 * E8: everyone at this machine is told once when a hidden room becomes reachable.
 *
 * Like the intercept announcer, the news is derived from a reconciled number instead of a local
 * event: the projection carries how many rooms that had to be unlocked are open, and both host and
 * replica compute that number from the same destructible state. Only a *rise* counts - a round
 * restart puts the number back to zero, and rooms that were open from the first second are never
 * counted at all, so neither of them says anything.
 *
 * Nothing is allocated while watching; the message string is a constant.
 */
export class SecretRoomAnnouncer {
    constructor() {
        this._lastOpenCount = null;
    }

    reset() {
        this._lastOpenCount = null;
    }

    /**
     * @param {unknown} openCount Opened unlockable rooms, from the match runtime projection.
     * @returns {string|null} The message to show, or null when nothing opened.
     */
    consume(openCount) {
        const count = Math.max(0, Math.trunc(Number(openCount) || 0));
        const previous = this._lastOpenCount;
        this._lastOpenCount = count;
        // An unknown state is only recorded: joining a match in progress must not announce.
        if (previous === null || count <= previous) return null;
        return PORTAL_OPENED_MESSAGE;
    }
}
