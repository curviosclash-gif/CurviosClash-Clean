import { formatPlayerName, normalizeArray, normalizeNumber } from './PostMatchLabels.js';

const hasOwn = (source, key) => !!source && Object.prototype.hasOwnProperty.call(source, key);

export const PARTICIPANT_COMPARISON_COLUMNS = Object.freeze([
    Object.freeze({ key: 'kills', short: 'A', label: 'Abschüsse', source: 'direct' }),
    Object.freeze({ key: 'deaths', short: 'T', label: 'Tode', source: 'direct' }),
    Object.freeze({ key: 'assists', short: 'As', label: 'Assists', source: 'direct' }),
    Object.freeze({ key: 'healthDamage', short: 'SP', label: 'Gesundheitsschaden' }),
    Object.freeze({ key: 'shieldDamage', short: 'SS', label: 'Schildschaden' }),
    Object.freeze({ key: 'rocketIntercepts', short: 'RI', label: 'Raketen abgefangen' }),
    Object.freeze({ key: 'destroyedMapUnits', short: 'ME', label: 'Karteneinheiten zerstört' }),
    Object.freeze({ key: 'burnedTrailMeters', short: 'SM', label: 'Spur verbrannt (m)' }),
    Object.freeze({ key: 'flagCaptures', short: 'F', label: 'Flaggen erobert' }),
    Object.freeze({ key: 'repairDroneHpRestored', short: 'RP', label: 'Reparaturdrohne HP' }),
    Object.freeze({ key: 'weaponRacePlace', short: 'WP', label: 'Waffenrennen Platz' }),
    Object.freeze({ key: 'weaponRaceResult', short: 'WZ', label: 'Waffenrennen Zeit' }),
    Object.freeze({ key: 'checkpointResets', short: 'CR', label: 'Checkpoint-Resets' }),
]);

function indexRows(rows, key = 'playerIndex') {
    return new Map(normalizeArray(rows).map((row) => [String(row?.[key] ?? ''), row]));
}

function copySupportedExtra(extra, targetKey, source, sourceKey) {
    if (hasOwn(source, sourceKey)) extra[targetKey] = Math.max(0, Number(source[sourceKey]) || 0);
}

function createComparisonEntry(player, hunt, race, checkpointResetsByPlayer) {
    const playerIndex = Math.max(0, Math.trunc(normalizeNumber(player?.index, 0)));
    const extra = {};
    copySupportedExtra(extra, 'healthDamage', hunt, 'damage');
    copySupportedExtra(extra, 'shieldDamage', hunt, 'shieldDamage');
    copySupportedExtra(extra, 'rocketIntercepts', hunt, 'intercepts');
    copySupportedExtra(extra, 'destroyedMapUnits', hunt, 'unitsDestroyed');
    copySupportedExtra(extra, 'burnedTrailMeters', hunt, 'burnedTrailMeters');
    copySupportedExtra(extra, 'flagCaptures', hunt, 'flagCaptures');
    copySupportedExtra(extra, 'repairDroneHpRestored', hunt, 'repairDroneHpRestored');
    if (race) {
        extra.weaponRacePlace = Math.max(0, Number(race.place) || 0);
        if (race.result === 'finished') extra.weaponRaceTimeMs = Math.max(0, Number(race.finishTimeMs) || 0);
        else extra.weaponRaceDnf = 1;
    }
    if (hasOwn(checkpointResetsByPlayer, String(playerIndex)) || hasOwn(checkpointResetsByPlayer, playerIndex)) {
        extra.checkpointResets = Math.max(0, Number(checkpointResetsByPlayer[playerIndex]) || 0);
    }
    return {
        playerIndex,
        label: formatPlayerName(player),
        isBot: player?.isBot === true,
        isLocal: false,
        color: player?.color,
        roundWins: 0,
        requiredWins: 1,
        isRoundWinner: false,
        isMatchPoint: false,
        kills: hasOwn(hunt, 'kills') ? Math.max(0, Number(hunt.kills) || 0) : null,
        deaths: hasOwn(hunt, 'deaths') ? Math.max(0, Number(hunt.deaths) || 0) : null,
        assists: hasOwn(hunt, 'assists') ? Math.max(0, Number(hunt.assists) || 0) : null,
        extra,
    };
}

function columnValue(entry, column) {
    if (column.source === 'direct') return entry?.[column.key];
    if (column.key === 'weaponRaceResult') {
        return entry?.extra?.weaponRaceDnf > 0 ? 1 : entry?.extra?.weaponRaceTimeMs;
    }
    return entry?.extra?.[column.key];
}

export function getComparisonColumns(block) {
    const entries = normalizeArray(block?.entries);
    return PARTICIPANT_COMPARISON_COLUMNS.filter((column) => {
        const values = entries.map((entry) => columnValue(entry, column)).filter((value) => value !== null && value !== undefined);
        return values.length > 0 && values.some((value) => Number(value) > 0);
    });
}

export function buildParticipantComparisonBlock({
    players = [],
    huntScoreboard = null,
    weaponRaceStandings = null,
    checkpointResetsByPlayer = {},
} = {}) {
    const huntByPlayer = indexRows(huntScoreboard);
    const raceByPlayer = indexRows(weaponRaceStandings, 'playerId');
    const entries = normalizeArray(players)
        .filter((player) => player && /** @type {{entitySlotActive?: unknown}} */ (player).entitySlotActive !== false)
        .map((player) => createComparisonEntry(
            /** @type {object} */ (player),
            huntByPlayer.get(String(/** @type {{index?: unknown}} */ (player).index)),
            raceByPlayer.get(String(/** @type {{index?: unknown}} */ (player).index)),
            checkpointResetsByPlayer || {},
        ));
    const block = { id: 'participant-comparison', title: 'Teilnehmervergleich', kind: 'standings', tier: 'detail', entries };
    return entries.length > 0 && getComparisonColumns(block).length > 0 ? block : null;
}
