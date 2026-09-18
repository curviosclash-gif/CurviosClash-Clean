// Wording of the HUD line that counts a visitor's remaining seconds in a secret room. Kept apart
// from the HUD class so the text can be tested without a DOM, exactly like the expansion line.

/**
 * @param {{ inside?: boolean, remainingSeconds?: number } | null | undefined} state
 * @returns {string} empty while the player is not in a room
 */
export function formatSecretRoomStatus(state) {
    if (state?.inside !== true) return '';
    // Rounded up: a line reading "0 s" while a second is still left would lie about the eject.
    const seconds = Math.max(0, Math.ceil(Number(state.remainingSeconds) || 0));
    return `GEHEIMRAUM · NOCH ${seconds} s`;
}
