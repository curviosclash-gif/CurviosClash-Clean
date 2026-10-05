// Wording of the HUD line that reports the condition of a destructible map. Kept apart from
// the HUD class so the text can be tested without a DOM.

/**
 * @typedef {object} MapDestructibleStatusSegment
 * @property {string} [id]
 * @property {string} [label]
 * @property {number} [ratio]
 */

/**
 * A fresh break names the segment that caused it, or - when no segment is known - the structure
 * the map calls itself by. The rest of the time the line shows how much is left of the segment
 * currently under fire.
 * @param {{
 *   active?: boolean,
 *   sealed?: boolean,
 *   hudNoun?: string,
 *   focusSegment?: MapDestructibleStatusSegment | null,
 *   breakingSecondsRemaining?: number,
 * } | null | undefined} state
 * @returns {string} empty when there is nothing to report
 */
export function formatMapDestructibleStatus(state) {
    if (state?.active !== true) return '';
    const focus = state.focusSegment;
    const label = typeof focus?.label === 'string' ? focus.label.trim() : '';
    const name = label || (typeof focus?.id === 'string' ? focus.id.trim() : '') || 'SEGMENT';
    if (Number(state.breakingSecondsRemaining) > 0) {
        if (!focus) {
            const noun = (typeof state.hudNoun === 'string' ? state.hudNoun.trim() : '') || 'BAUWERK';
            return `${noun.toUpperCase()} ${state.sealed === true ? 'STÜRZT' : 'BRICHT'}`;
        }
        return `${name.toUpperCase()} ${state.sealed === true ? 'ZERSTÖRT' : 'BRICHT'}`;
    }

    if (!focus) return '';
    const ratio = Math.max(0, Math.min(1, Number(focus.ratio) || 0));
    return `STRUKTUR · ${name.toUpperCase()} ${Math.round(ratio * 100)} %`;
}
