// Wording of the HUD line that announces the next stage of a growing map. Kept apart from the
// HUD class so the text can be tested without a DOM.

/**
 * @param {{ active?: boolean, phase?: string, secondsUntilOpen?: number, label?: string } | null | undefined} state
 * @returns {string} empty when nothing is announced
 */
export function formatMapExpansionStatus(state) {
    if (state?.active !== true) return '';
    const label = typeof state.label === 'string' ? state.label.trim() : '';
    const name = label ? `SEKTOR ${label.toUpperCase()}` : 'NEUER SEKTOR';
    if (state.phase === 'OPENING') return `${name} · ÖFFNET`;
    const seconds = Math.max(0, Math.ceil(Number(state.secondsUntilOpen) || 0));
    return `${name} · ÖFFNET IN ${seconds} s`;
}
