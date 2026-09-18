// The pause menu borrows the settings drawer of the main menu. While it is open the menu
// root is shown in a settings-only mode (style.css hides everything but the drawer and
// the tabs listed here), so menu and pause share one window instead of two copies.
export const PAUSE_LEVEL4_SECTION_IDS = Object.freeze(['controls', 'audio', 'graphics', 'hud']);
export const PAUSE_LEVEL4_RETURN_TARGET = 'pause';

export function isLevel4PauseHosted(ui) {
    return ui?.mainMenu?.dataset?.pauseSettings === 'true';
}

export function resolvePauseLevel4Section(sectionId) {
    return PAUSE_LEVEL4_SECTION_IDS.includes(sectionId) ? sectionId : PAUSE_LEVEL4_SECTION_IDS[0];
}

export function enterLevel4PauseHost(ui) {
    const menu = ui?.mainMenu;
    const drawer = ui?.level4Drawer;
    if (!menu || !drawer || isLevel4PauseHosted(ui)) return false;
    menu.dataset.pauseSettings = 'true';
    menu.classList.remove('hidden');
    drawer.dataset.level4ReturnTarget = PAUSE_LEVEL4_RETURN_TARGET;
    ui.hud?.classList?.add('pause-settings-open');
    return true;
}

// The drawer keeps the tab the player used last, unless the pause cannot show it.
export function openLevel4InPause(manager) {
    if (!enterLevel4PauseHost(manager?.ui)) return false;
    manager.setLevel4Open(true);
    const activeSection = manager.settings?.localSettings?.toolsState?.activeSection;
    manager.setLevel4Section(resolvePauseLevel4Section(activeSection), { persist: false, focus: false });
    return true;
}

// Closing takes the close button's path so the closed state is stored like in the menu.
export function closeLevel4InPause(manager) {
    const ui = manager?.ui;
    if (!isLevel4PauseHosted(ui)) return false;
    ui.closeLevel4Button?.click?.();
    if (isLevel4PauseHosted(ui)) manager.setLevel4Open(false);
    if (isLevel4PauseHosted(ui)) leaveLevel4PauseHost(ui);
    return true;
}

export function leaveLevel4PauseHost(ui) {
    if (!isLevel4PauseHosted(ui)) return false;
    delete ui.mainMenu.dataset.pauseSettings;
    ui.mainMenu.classList.add('hidden');
    ui.hud?.classList?.remove('pause-settings-open');
    try {
        ui.pauseSettingsButton?.focus?.({ preventScroll: true });
    } catch {
        ui.pauseSettingsButton?.focus?.();
    }
    return true;
}
