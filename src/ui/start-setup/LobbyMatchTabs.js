import { MENU_VISIBILITY_REASONS, resolveMenuVisibility } from '../../shared/contracts/MenuVisibilityContract.js';
import { applyMenuVisibility } from '../menu/MenuVisibilityApplier.js';

/** @param {boolean} joined @param {boolean} host @returns {'none'|'host'|'guest'} */
export function resolveLobbyRole(joined, host) {
    if (!joined) return 'none';
    return host ? 'host' : 'guest';
}

/**
 * Tab strip above the match card. Fight is the only open tab; arcade is shown but
 * switched off by the visibility contract until it exists.
 * @param {'none'|'host'|'guest'} role
 */
export function resolveLobbyTabs(role) {
    /** @type {{visible: Readonly<Record<string, boolean>>, enabled: Readonly<Record<string, boolean>>, reasons: Readonly<Record<string, string>>}} */
    const visibility = resolveMenuVisibility({ sessionType: 'multiplayer', lobbyRole: role });
    return Object.freeze({
        role,
        visibility,
        activeTab: 'fight',
        tabs: Object.freeze([
            Object.freeze({ id: 'fight', label: 'Kampf', selected: true, visible: role !== 'none', enabled: role !== 'none', reason: null }),
            Object.freeze({
                id: 'arcade',
                label: 'Arcade',
                selected: false,
                visible: visibility.visible.lobbyArcadeTab,
                enabled: visibility.enabled.lobbyArcadeTab,
                reason: visibility.reasons.lobbyArcadeTab ?? null,
            }),
        ]),
        rulesEditable: role === 'host' && visibility.enabled.matchRulesEditable,
        guestHint: visibility.reasons.matchRulesEditable === MENU_VISIBILITY_REASONS.HOST_ONLY,
    });
}

/**
 * Writes the tab state onto the lobby panel: visibility keys through the shared applier,
 * selection and the "kommt bald" note on the tabs themselves.
 * @param {ParentNode|null|undefined} panel
 * @param {ReturnType<typeof resolveLobbyTabs>} tabState
 */
export function syncLobbyTabs(panel, tabState) {
    if (typeof panel?.querySelectorAll !== 'function') return;
    applyMenuVisibility(panel, tabState.visibility);
    for (const node of Array.from(panel.querySelectorAll('[role="tab"][data-lobby-tab]'))) {
        const element = /** @type {HTMLElement} */ (node);
        const tab = tabState.tabs.find((candidate) => candidate.id === element.dataset?.lobbyTab);
        if (!tab) continue;
        element.setAttribute('aria-selected', String(tab.selected));
        element.tabIndex = tab.selected ? 0 : -1;
        const note = /** @type {HTMLElement|null} */ (element.querySelector('.lobby-tab-note'));
        if (note) note.hidden = tab.enabled;
    }
}
