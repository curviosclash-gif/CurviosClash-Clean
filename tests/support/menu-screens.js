// The one place that knows which panel id a menu screen has today. Specs ask for a screen by name
// (openMenuScreen(page, 'freeplay') and menuScreenSelector('freeplay') from tests/helpers.js), so the
// menu rebuild only edits this map instead of every spec. tests/menu-screen-helpers.contract.test.mjs
// checks that each id exists and that direct id references in tests only go down.
export const MENU_SCREEN_PANEL_IDS = Object.freeze({
    modeChoice: 'submenu-custom',
    freeplay: 'submenu-game',
    lobby: 'submenu-multiplayer',
    settings: 'submenu-level4',
    tools: 'submenu-tools',
    info: 'submenu-info',
});

export function menuScreenPanelId(screen) {
    const panelId = MENU_SCREEN_PANEL_IDS[screen];
    if (!panelId) throw new Error(`Unbekannter Menübildschirm: ${screen}`);
    return panelId;
}

export function menuScreenSelector(screen, { visible = true } = {}) {
    const panelId = menuScreenPanelId(screen);
    return visible ? `#${panelId}:not(.hidden)` : `#${panelId}`;
}
