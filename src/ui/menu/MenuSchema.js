import { MENU_ACCESS_POLICIES } from './MenuAccessPolicy.js';
import { createMenuFeatureFlags } from './MenuStateContracts.js';

export const MENU_SCHEMA_VERSION = 'menu-schema.v1';

function createPanelSchema(featureFlags) {
    return [
        {
            id: 'submenu-game',
            semanticId: 'start_setup',
            label: 'Match vorbereiten',
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
                    action: 'multiplayer_host',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                    visibilityCondition: 'canHost',
                },
                {
                    id: 'multiplayer-join',
                    label: 'Spiel beitreten',
                    action: 'multiplayer_join',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                },
                {
                    id: 'multiplayer-back',
                    label: 'Zurueck',
                    action: 'navigate_back',
                    accessPolicy: MENU_ACCESS_POLICIES.OPEN,
                },
            ],
        },
        {
            id: 'submenu-settings',
            semanticId: 'settings',
            label: 'Einstellungen',
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
            label: 'Expert',
            icon: 'LOCK',
            order: 65,
            level: 'expert',
            accessPolicy: MENU_ACCESS_POLICIES.OPEN,
            visibility: 'visible',
            legacyIds: [],
            settingsDomain: 'localSettings',
        },
        {
            id: 'submenu-developer',
            semanticId: 'developer',
            label: 'Developer',
            icon: '🛠️',
            order: 70,
            level: 'developer',
            accessPolicy: MENU_ACCESS_POLICIES.OWNER_ONLY,
            visibility: featureFlags.developerModeEnabled ? 'visible' : 'hidden',
            legacyIds: [],
            settingsDomain: 'localSettings',
        },
        {
            id: 'submenu-debug',
            semanticId: 'debug',
            label: 'Debug / Info',
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
