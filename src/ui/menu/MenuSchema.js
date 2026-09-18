import { MENU_ACCESS_POLICIES } from './MenuAccessPolicy.js';
import { createMenuFeatureFlags } from './MenuStateContracts.js';

export const MENU_SCHEMA_VERSION = 'menu-schema.v1';

function createPanelSchema(featureFlags) {
    return [
        {
            id: 'main-menu',
            semanticId: 'session_type',
            label: 'Spielart',
            textId: 'menu.level1.help.title',
            icon: 'HOME',
            order: 5,
            level: 'level1',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: ['main'],
            settingsDomain: 'localSettings',
        },
        {
            id: 'submenu-game',
            semanticId: 'start_setup',
            label: 'Match vorbereiten',
            textId: 'menu.level3.title',
            icon: '🎮',
            order: 10,
            level: 'level3',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: featureFlags.menuV26Enabled ? 'visible' : 'hidden',
            legacyIds: ['submenu-game'],
            settingsDomain: 'matchSettings',
        },
        {
            id: 'submenu-custom',
            semanticId: 'path',
            label: 'Spielstil',
            textId: 'menu.level2.title',
            icon: '🧩',
            order: 15,
            level: 'level2',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: featureFlags.menuV26Enabled ? 'visible' : 'hidden',
            legacyIds: [],
            settingsDomain: 'matchSettings',
            stepper: [
                { id: 'path-step-select', label: 'Spielstil', panelId: 'submenu-custom' },
                { id: 'path-step-start', label: 'Match vorbereiten', panelId: 'submenu-game' },
            ],
        },
        {
            id: 'submenu-multiplayer',
            semanticId: 'multiplayer',
            label: 'Multiplayer',
            textId: 'menu.multiplayer.title',
            icon: '🌐',
            order: 20,
            level: 'multiplayer',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: featureFlags.multiplayerStubEnabled ? 'visible' : 'hidden',
            legacyIds: [],
            settingsDomain: 'matchSettings',
            items: [
                {
                    id: 'multiplayer-host',
                    label: 'Spiel erstellen',
                    textId: 'menu.multiplayer.host.label',
                    action: 'multiplayer_host',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                    visibilityCondition: 'canHost',
                },
                {
                    id: 'multiplayer-join',
                    label: 'Spiel beitreten',
                    textId: 'menu.multiplayer.join.label',
                    action: 'multiplayer_join',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                },
                {
                    id: 'multiplayer-back',
                    label: 'Zurück',
                    textId: 'menu.multiplayer.lobby.back',
                    action: 'navigate_back',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                },
            ],
        },
        {
            id: 'submenu-settings',
            semanticId: 'settings',
            label: 'Einstellungen',
            textId: 'menu.panels.settings.title',
            icon: '⚙️',
            order: 30,
            level: 'custom',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: ['submenu-settings'],
            settingsDomain: 'matchSettings',
        },
        {
            id: 'submenu-controls',
            semanticId: 'controls',
            label: 'Steuerung',
            textId: 'menu.panels.controls.title',
            icon: '🎯',
            order: 40,
            level: 'custom',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: ['submenu-controls'],
            settingsDomain: 'localSettings',
        },
        {
            id: 'submenu-profiles',
            semanticId: 'profiles',
            label: 'Profile',
            textId: 'menu.panels.profiles.title',
            icon: '👤',
            order: 50,
            level: 'custom',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: ['submenu-profiles'],
            settingsDomain: 'playerLoadout',
        },
        {
            id: 'submenu-portals',
            semanticId: 'portals',
            label: 'Portale / Map',
            textId: 'menu.panels.portals.title',
            icon: '🌀',
            order: 60,
            level: 'custom',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: ['submenu-portals'],
            settingsDomain: 'matchSettings',
        },
        {
            id: 'submenu-expert',
            semanticId: 'expert',
            label: 'Expertenbereich',
            textId: 'menu.panels.expert.title',
            icon: 'LOCK',
            order: 65,
            level: 'expert',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: [],
            settingsDomain: 'localSettings',
        },
        {
            id: 'submenu-debug',
            semanticId: 'debug',
            label: 'Debug / Info',
            textId: 'menu.debug.title',
            icon: 'ℹ️',
            order: 80,
            level: 'debug',
            accessPolicy: MENU_ACCESS_POLICIES.OWNER_ONLY,
            visibility: featureFlags.developerModeEnabled ? 'visible' : 'hidden',
            legacyIds: ['submenu-debug'],
            settingsDomain: 'localSettings',
        },
    ];
}

function createCompatibilityAliases() {
    return {
        quickstart: 'submenu-game',
        game: 'submenu-game',
        settings: 'submenu-settings',
        controls: 'submenu-controls',
        profiles: 'submenu-profiles',
        portals: 'submenu-portals',
        debug: 'submenu-debug',
        main: 'main-menu',
    };
}

export function createMenuSchema(options = {}) {
    const featureFlags = createMenuFeatureFlags(options.featureFlags);
    const panels = createPanelSchema(featureFlags);
    const navItems = panels
        .filter((panel) => panel.visibility !== 'hidden')
        .map((panel) => ({
            id: panel.id,
            panelId: panel.id,
            label: panel.label,
            textId: panel.textId,
            icon: panel.icon,
            order: panel.order,
            accessPolicy: panel.accessPolicy,
            level: panel.level,
        }))
        .sort((left, right) => left.order - right.order);

    return {
        schemaVersion: MENU_SCHEMA_VERSION,
        featureFlags,
        panels,
        navItems,
        compatibilityAliases: createCompatibilityAliases(),
    };
}
