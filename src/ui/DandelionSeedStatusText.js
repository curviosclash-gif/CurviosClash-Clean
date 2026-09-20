/**
 * Compact map-objective line for the shootable dandelion crown.
 *
 * @param {{ active?: boolean, total?: number, released?: number, allReleased?: boolean } | null | undefined} state
 * @returns {string}
 */
export function formatDandelionSeedStatus(state) {
    if (state?.active !== true) return '';
    const total = Math.max(0, Math.trunc(Number(state.total) || 0));
    if (total <= 0) return '';
    const released = Math.min(total, Math.max(0, Math.trunc(Number(state.released) || 0)));
    if (state.allReleased === true && released === total) {
        return 'ALLE SAMEN GELÖST · PORTAL OFFEN';
    }
    return `PUSTEBLUME · ${released}/${total} SAMEN`;
}
