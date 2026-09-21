// Which human players this screen's HUD shows. Network guests own one slot, while a
// hybrid LAN host may own two adjacent split-screen slots.

import { PLAYER_LABEL_STYLES, formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';

export function resolveLocalHudPlayerIndex(projection = null) {
    if (Number.isInteger(projection?.localPlayerIndex)) return projection.localPlayerIndex;
    const local = Array.isArray(projection?.sessionPlayers)
        ? projection.sessionPlayers.find((player) => player?.isLocal === true)
        : null;
    return Number.isInteger(local?.playerIndex) && local.playerIndex >= 0 ? local.playerIndex : 0;
}

export function resolveLocalHudHumans(projection = null, fallbackHumans = []) {
    const humans = Array.isArray(projection?.players)
        ? projection.players.filter((player) => player?.isBot !== true)
        : (Array.isArray(fallbackHumans) ? fallbackHumans : []);
    if (projection?.isNetworkSession !== true) return humans;
    const localIndex = resolveLocalHudPlayerIndex(projection);
    const localHumanCount = Math.max(1, Math.floor(Number(projection?.localHumanCount) || 1));
    return humans.filter((player) => {
        const playerIndex = player?.playerIndex ?? player?.index;
        return playerIndex >= localIndex && playerIndex < localIndex + localHumanCount;
    });
}

/** Name and score for the top-left tile, counted the same way as the scoreboard. */
export function resolveLocalHudTile(projection = null) {
    const [player] = resolveLocalHudHumans({ ...projection, isNetworkSession: true });
    if (!player) return null;
    const playerIndex = player.playerIndex ?? player.index;
    const huntRow = projection?.hunt?.active === true && Array.isArray(projection.hunt.scoreboardRows)
        ? projection.hunt.scoreboardRows.find((row) => row?.playerIndex === playerIndex)
        : null;
    return {
        name: formatPlayerDisplayLabel(player, { style: PLAYER_LABEL_STYLES.LONG }),
        score: String(huntRow ? Number(huntRow.kills) || 0 : Number(player.score) || 0),
    };
}
