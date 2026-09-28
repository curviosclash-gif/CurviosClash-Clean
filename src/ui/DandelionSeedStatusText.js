// What each shootable plant is called on the HUD, and the room its parts open.
const PLANT_LABELS = Object.freeze({
    dandelionSeeds: Object.freeze({ plant: 'PUSTEBLUME', parts: 'SAMEN', room: 'WURZELKAMMER' }),
    sunflowerKernels: Object.freeze({ plant: 'SONNENBLUME', parts: 'KERNE', room: 'HONIGKAMMER' }),
});

/**
 * @param {string | undefined} source
 * @returns {{ plant: string, parts: string, room: string }}
 */
export function resolveSeedObjectiveLabels(source) {
    return PLANT_LABELS[source] || PLANT_LABELS.dandelionSeeds;
}

/**
 * Compact map-objective line for a shootable plant whose parts open a secret room.
 *
 * @param {{ active?: boolean, source?: string, total?: number, released?: number,
 *   allReleased?: boolean, portalOpen?: boolean } | null | undefined} state
 * @returns {string}
 */
export function formatDandelionSeedStatus(state) {
    if (state?.active !== true) return '';
    const total = Math.max(0, Math.trunc(Number(state.total) || 0));
    if (total <= 0) return '';
    const labels = resolveSeedObjectiveLabels(state.source);
    if (state.portalOpen === true) return `PORTAL OFFEN · ${labels.room}`;
    const released = Math.min(total, Math.max(0, Math.trunc(Number(state.released) || 0)));
    if (state.allReleased === true && released === total) {
        return `ALLE ${labels.parts} GELÖST · PORTAL ÖFFNET`;
    }
    return `${labels.plant} · ${released}/${total} ${labels.parts} → ${labels.room}`;
}
