// One label for a player everywhere in a match: HUD, scoreboard, kill feed and result screen.
// A human with a chosen lobby name shows that name; otherwise the seat label is built.
// Bots keep "Bot 3" unless a game mode gives them an explicit `botDisplayName` (a rival such as
// "Nemesis"); the lobby `name` field never renames a bot, so a bot cannot pose as a player.

export const PLAYER_LABEL_STYLES = Object.freeze({
    SHORT: 'short', // "P1"
    LONG: 'long', // "Spieler 1"
});

export const BOT_DISPLAY_NAME_MAX_LENGTH = 24;

/**
 * Plain text only: control characters and angle brackets are dropped, whitespace collapses.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBotDisplayName(value) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/[\u0000-\u001f\u007f<>]/g, (match) => (match === '\n' || match === '\t' ? ' ' : ''))
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, BOT_DISPLAY_NAME_MAX_LENGTH).trim();
}

/**
 * @param {{ name?: unknown, isBot?: unknown, botDisplayName?: unknown, index?: unknown, playerIndex?: unknown } | null | undefined} player
 * @param {{ style?: string }} [options]
 * @returns {string}
 */
export function formatPlayerDisplayLabel(player, options = {}) {
    const rawIndex = Number(player?.index ?? player?.playerIndex);
    const seat = Number.isFinite(rawIndex) && rawIndex >= 0 ? Math.floor(rawIndex) + 1 : 1;
    if (player?.isBot === true) return normalizeBotDisplayName(player?.botDisplayName) || `Bot ${seat}`;
    const name = typeof player?.name === 'string' ? player.name.trim() : '';
    if (name) return name;
    return options?.style === PLAYER_LABEL_STYLES.LONG ? `Spieler ${seat}` : `P${seat}`;
}

/**
 * A message about one player for the one shared toast: with several local players on one screen it
 * has to say whose ship it was ("P2: Kollision mit der Wand!"); alone the short text is enough.
 * @param {{ name?: unknown, isBot?: unknown, index?: unknown, playerIndex?: unknown } | null | undefined} player
 * @param {string} message
 * @param {number} localHumanCount
 * @returns {string}
 */
export function formatPlayerScopedMessage(player, message, localHumanCount) {
    const text = String(message || '');
    if (!player || !(Number(localHumanCount) > 1)) return text;
    return `${formatPlayerDisplayLabel(player)}: ${text}`;
}
