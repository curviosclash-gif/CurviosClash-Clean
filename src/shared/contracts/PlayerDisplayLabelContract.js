// One label for a player everywhere in a match: HUD, scoreboard, kill feed and result screen.
// A human with a chosen lobby name shows that name; otherwise the seat label is built.
// Bots always keep "Bot 3", so a bot can never pose as a player.

export const PLAYER_LABEL_STYLES = Object.freeze({
    SHORT: 'short', // "P1"
    LONG: 'long', // "Spieler 1"
});

/**
 * @param {{ name?: unknown, isBot?: unknown, index?: unknown, playerIndex?: unknown } | null | undefined} player
 * @param {{ style?: string }} [options]
 * @returns {string}
 */
export function formatPlayerDisplayLabel(player, options = {}) {
    const rawIndex = Number(player?.index ?? player?.playerIndex);
    const seat = Number.isFinite(rawIndex) && rawIndex >= 0 ? Math.floor(rawIndex) + 1 : 1;
    if (player?.isBot === true) return `Bot ${seat}`;
    const name = typeof player?.name === 'string' ? player.name.trim() : '';
    if (name) return name;
    return options?.style === PLAYER_LABEL_STYLES.LONG ? `Spieler ${seat}` : `P${seat}`;
}
