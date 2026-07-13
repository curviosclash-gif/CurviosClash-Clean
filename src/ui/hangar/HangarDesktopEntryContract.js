import {
    HANGAR_CAPABILITY_IDS,
    HANGAR_MODES,
    HANGAR_NAV_EVENTS,
    resolveHangarMode,
} from '../../shared/contracts/HangarModeContract.js';

export const HANGAR_DESKTOP_ENTRY_CONTRACT_VERSION = 'hangar-desktop-entry.v1';

export const HANGAR_DESKTOP_ENTRY_IDS = Object.freeze({
    MAIN_MENU_FIGHT_HANGAR: 'main_menu_fight_hangar',
    MAIN_MENU_ARCADE_HANGAR: 'main_menu_arcade_hangar',
});

export const HANGAR_DESKTOP_ENTRY_BINDINGS = Object.freeze({
    [HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_FIGHT_HANGAR]: Object.freeze({
        entryId: HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_FIGHT_HANGAR,
        sourceSurface: 'desktop-main-menu',
        mode: HANGAR_MODES.FIGHT,
        modePath: 'fight',
        navEvent: HANGAR_NAV_EVENTS.OPEN_FIGHT_HANGAR,
        capabilityId: HANGAR_CAPABILITY_IDS.OPEN_HANGAR,
        description: 'Primary desktop entry opens Fight hangar as default hangar flow.',
    }),
    [HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_ARCADE_HANGAR]: Object.freeze({
        entryId: HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_ARCADE_HANGAR,
        sourceSurface: 'desktop-main-menu',
        mode: HANGAR_MODES.ARCADE,
        modePath: 'arcade',
        navEvent: HANGAR_NAV_EVENTS.OPEN_ARCADE_HANGAR,
        capabilityId: HANGAR_CAPABILITY_IDS.OPEN_HANGAR,
        description: 'Secondary desktop entry opens Arcade hangar flow.',
    }),
});

function cloneDesktopEntryBinding(binding) {
    return {
        entryId: binding.entryId,
        sourceSurface: binding.sourceSurface,
        mode: binding.mode,
        modePath: binding.modePath,
        navEvent: binding.navEvent,
        capabilityId: binding.capabilityId,
        description: binding.description,
    };
}

export function resolveHangarDesktopEntry(rawEntryId) {
    const normalizedEntryId = String(rawEntryId || '').trim().toLowerCase();
    const binding = HANGAR_DESKTOP_ENTRY_BINDINGS[normalizedEntryId]
        || HANGAR_DESKTOP_ENTRY_BINDINGS[HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_FIGHT_HANGAR];
    return cloneDesktopEntryBinding(binding);
}

export function resolveDesktopHangarEntryByMode(rawMode) {
    const mode = resolveHangarMode(rawMode);
    if (mode === HANGAR_MODES.ARCADE) {
        return resolveHangarDesktopEntry(HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_ARCADE_HANGAR);
    }
    return resolveHangarDesktopEntry(HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_FIGHT_HANGAR);
}

