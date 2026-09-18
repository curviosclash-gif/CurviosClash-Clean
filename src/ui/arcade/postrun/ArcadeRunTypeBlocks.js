// Value blocks for the two scripted arcade runs: "Fünf Fronten" (arena waves) and "Fünf Portale".
//
// Both used to render one line per map with "|" between the numbers. As cards they get the same
// treatment as the rest of the board: the map name instead of the key, kills split into regular
// enemies and leaders, and times through the shared German duration format.

import {
    countRow,
    createArcadeBlock,
    durationRow,
    resolveArcadeMapLabel,
} from './ArcadePostRunBlocks.js';

const MILLISECONDS_PER_SECOND = 1000;
const PORTAL_TIME_PRECISION = 2;

/**
 * @param {unknown} milliseconds
 * @returns {number}
 */
function toSeconds(milliseconds) {
    return Math.max(0, Number(milliseconds) || 0) / MILLISECONDS_PER_SECOND;
}

/**
 * One card per map, in run order.
 * @param {object} summary
 * @returns {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock>}
 */
export function createArenaWavesMapBlocks(summary = {}) {
    const maps = Array.isArray(summary.maps) ? summary.maps : [];
    return maps.map((map, index) => {
        const waves = Array.isArray(map?.completedWaves) ? map.completedWaves : [];
        return createArcadeBlock(`arena-map-${index}`, `Karte ${index + 1} — ${resolveArcadeMapLabel(map?.mapKey, map?.mapLabel)}`, [
            durationRow('survival', 'Überlebenszeit', Math.max(0, Number(map?.survivalSeconds) || 0)),
            countRow('wave', 'Welle', waves.length > 0 ? Math.max(...waves) : 0),
            countRow('kills', 'Abschüsse', map?.regularKills),
            countRow('elite-kills', 'Anführer', map?.eliteKills),
            countRow('score', 'Punkte', map?.score),
        ]);
    }).filter(Boolean);
}

/**
 * @param {object} summary
 * @returns {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock>}
 */
export function createFivePortalsBlocks(summary = {}) {
    const maps = Array.isArray(summary.maps) ? summary.maps : [];
    const mapRows = maps.map((map, index) => durationRow(
        `map-${index}`,
        resolveArcadeMapLabel(map?.mapKey, map?.mapLabel),
        toSeconds(map?.timeMs),
        PORTAL_TIME_PRECISION
    ));
    return [
        createArcadeBlock('five-portals-maps', 'Zeiten je Karte', mapRows),
        createArcadeBlock('five-portals-total', 'Gesamt', [
            durationRow('total', 'Gesamtzeit', toSeconds(summary.totalMs), PORTAL_TIME_PRECISION),
            durationRow('record', 'Persönlicher Rekord', toSeconds(summary.bestTotalMs), PORTAL_TIME_PRECISION),
        ]),
    ].filter(Boolean);
}
