// Wording of the HUD line that reports the condition of a destructible map. Kept apart from
// the HUD class so the text can be tested without a DOM.

/**
 * @typedef {object} MapDestructibleStatusSegment
 * @property {string} [id]
 * @property {string} [label]
 * @property {number} [ratio]
 */

/**
 * A fresh break is announced for a few seconds; a tower that went down for good says so. The
 * rest of the time the line shows how much is left of the segment currently under fire.
 * @param {{
 *   active?: boolean,
 *   sealed?: boolean,
 *   focusSegment?: MapDestructibleStatusSegment | null,
 *   breakingSecondsRemaining?: number,
 * } | null | undefined} state
 * @returns {string} empty when there is nothing to report
 */
export function formatMapDestructibleStatus(state) {
    if (state?.active !== true) return '';
    if (Number(state.breakingSecondsRemaining) > 0) {
        return state.sealed === true ? 'TURM STÜRZT' : 'TURM BRICHT';
    }

    const focus = state.focusSegment;
    if (!focus) return '';
    const label = typeof focus.label === 'string' ? focus.label.trim() : '';
    const name = label || (typeof focus.id === 'string' ? focus.id.trim() : '') || 'SEGMENT';
    const ratio = Math.max(0, Math.min(1, Number(focus.ratio) || 0));
    return `TURM · ${name.toUpperCase()} ${Math.round(ratio * 100)} %`;
}
