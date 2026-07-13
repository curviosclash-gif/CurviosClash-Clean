/**
 * PlatformCapabilityData — pure static data layer for platform capabilities.
 *
 * Contains only constants and the canonical registry object.
 * No resolver functions, no runtime globals, no legacy global reads.
 *
 * New work that only needs registry constants or product data should import
 * directly from this file rather than the full PlatformCapabilityRegistry.
 *
 * Resolver functions live in PlatformCapabilityRegistry.js (which re-exports
 * everything from here for backward compatibility).
 */
import { PLATFORM_CAPABILITY_IDS } from './PlatformCapabilityContract.js';
import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';

export const PLATFORM_CAPABILITY_REGISTRY_CONTRACT_VERSION = 'platform-capability-registry.v1';
export const PLATFORM_SURFACE_POLICY_CONTRACT_VERSION = 'platform-surface-policy.v1';

export const PLATFORM_PRODUCT_SURFACE_IDS = Object.freeze({
    DESKTOP_APP: 'desktop-app',
    BROWSER_DEMO: 'browser-demo',
});

export const PLATFORM_RUNTIME_KINDS = Object.freeze({
    ELECTRON: 'electron',
    WEB: 'web',
});

export const PLATFORM_PROVIDER_KINDS = Object.freeze({
    BROWSER_DEMO: 'browser-demo',
    BROWSER_DOWNLOAD: 'browser-download',
    BROWSER_NATIVE: 'browser-native',
    ELECTRON_IPC: 'electron-ipc',
    ELECTRON_RENDERER: 'electron-renderer',
    MENU_STORAGE_BRIDGE: 'menu-storage-bridge',
    MENU_LAN_LOBBY: 'menu-lan-lobby',
    MENU_ONLINE_LOBBY: 'menu-online-lobby',
    UNAVAILABLE: 'unavailable',
});

export const PLATFORM_TOOLING_IDS = Object.freeze({
    DEFAULT: 'default',
    TRAINING_BENCHMARK: 'training-benchmark',
});

export const PLATFORM_SURFACE_POLICY_MODES = Object.freeze({
    DEFAULT_FULL: 'default-full',
    DEFAULT_DENY: 'default-deny',
});

export const PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES = Object.freeze({
    LOCAL_UNLOCK: 'local-unlock',
    BLOCKED: 'blocked',
});

export const PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS = Object.freeze({
    LOCAL_DEVTOOLS: 'local-devtools',
    DEMO_LOCAL_DEVTOOLS: 'demo-local-devtools',
    UNAVAILABLE: 'unavailable',
});

export const PLATFORM_SURFACE_MULTIPLAYER_ROLES = Object.freeze({ HOST_AND_JOIN: 'host-and-join', JOIN_ONLY: 'join-only' });
export const PLATFORM_SURFACE_SESSION_TYPES = Object.freeze({ SINGLE: 'single', MULTIPLAYER: 'multiplayer', SPLITSCREEN: 'splitscreen' });
export const PLATFORM_SURFACE_MENU_MODE_PATHS = Object.freeze({ QUICK_ACTION: 'quick_action', ARCADE: 'arcade', FIGHT: 'fight', NORMAL: 'normal' });
export const PLATFORM_SURFACE_QUICK_START_ACTION_IDS = Object.freeze({ LAST_SETTINGS: 'last_settings', EVENT_PLAYLIST: 'event_playlist', RANDOM_MAP: 'random_map' });

export const PLATFORM_CAPABILITY_REGISTRY = Object.freeze({
    contractVersion: PLATFORM_CAPABILITY_REGISTRY_CONTRACT_VERSION,
    products: Object.freeze({
        [PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP]: Object.freeze({
            runtimeKind: PLATFORM_RUNTIME_KINDS.ELECTRON,
            defaultLobbyTransport: MULTIPLAYER_TRANSPORTS.LAN,
            toolingSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
            surfacePolicy: Object.freeze({
                defaultAccessMode: PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL,
                multiplayerRole: PLATFORM_SURFACE_MULTIPLAYER_ROLES.HOST_AND_JOIN,
                defaultModePath: PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL,
                allowedSessionTypes: Object.freeze([PLATFORM_SURFACE_SESSION_TYPES.SINGLE, PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER, PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN]),
                defaultMultiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
                allowedMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.LAN, MULTIPLAYER_TRANSPORTS.ONLINE]),
                hostMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.LAN, MULTIPLAYER_TRANSPORTS.ONLINE]),
                joinMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.LAN, MULTIPLAYER_TRANSPORTS.ONLINE]),
                legacyMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE]),
                allowedGameModes: Object.freeze([
                    'Arcade',
                    'Parcours',
                    'Fight',
                    'Normal',
                    'Classic',
                ]),
                allowedModePaths: Object.freeze([
                    PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION,
                    PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE,
                    PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT,
                    PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL,
                ]),
                allowedQuickStartActionIds: Object.freeze([]),
                allowedPresetIds: Object.freeze([]),
                curatedMapKeysByModePath: Object.freeze({}),
                requiresCuratedMaps: false,
                developerAccess: Object.freeze({
                    available: true,
                    accessMode: PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.LOCAL_UNLOCK,
                    reason: PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.LOCAL_DEVTOOLS,
                    message: 'Developer-, Debug- und Training-Schalter bleiben lokale Diagnosepfade und zaehlen nicht zum Produktversprechen der Vollversion.',
                }),
            }),
            capabilities: Object.freeze({
                [PLATFORM_CAPABILITY_IDS.DISCOVERY]: PLATFORM_PROVIDER_KINDS.ELECTRON_IPC,
                [PLATFORM_CAPABILITY_IDS.HOST]: PLATFORM_PROVIDER_KINDS.ELECTRON_IPC,
                [PLATFORM_CAPABILITY_IDS.SAVE]: PLATFORM_PROVIDER_KINDS.ELECTRON_IPC,
                [PLATFORM_CAPABILITY_IDS.RECORDING]: PLATFORM_PROVIDER_KINDS.ELECTRON_RENDERER,
            }),
        }),
        [PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO]: Object.freeze({
            runtimeKind: PLATFORM_RUNTIME_KINDS.WEB,
            defaultLobbyTransport: MULTIPLAYER_TRANSPORTS.LAN,
            toolingSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
            surfacePolicy: Object.freeze({
                defaultAccessMode: PLATFORM_SURFACE_POLICY_MODES.DEFAULT_DENY,
                multiplayerRole: PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY,
                defaultModePath: PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL,
                allowedSessionTypes: Object.freeze([PLATFORM_SURFACE_SESSION_TYPES.SINGLE, PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER]),
                defaultMultiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
                allowedMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.LAN]),
                hostMultiplayerTransports: Object.freeze([]),
                joinMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.LAN]),
                legacyMultiplayerTransports: Object.freeze([MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE]),
                allowedGameModes: Object.freeze([
                    'Arcade',
                    'Parcours',
                    'Fight',
                    'Normal',
                    'Classic',
                ]),
                allowedModePaths: Object.freeze([
                    PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE,
                    PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT,
                    PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL,
                ]),
                allowedQuickStartActionIds: Object.freeze([]),
                allowedPresetIds: Object.freeze([
                    'arcade',
                    'fight-standard',
                    'normal-standard',
                ]),
                curatedMapKeysByModePath: Object.freeze({
                    [PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE]: Object.freeze(['parcours_rift']),
                    [PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT]: Object.freeze(['standard', 'maze']),
                    [PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL]: Object.freeze(['standard', 'maze']),
                }),
                requiresCuratedMaps: true,
                developerAccess: Object.freeze({
                    available: true,
                    accessMode: PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.LOCAL_UNLOCK,
                    reason: PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.DEMO_LOCAL_DEVTOOLS,
                    message: 'Developer-, Debug- und Training-Schalter sind lokale Diagnosepfade und kein Demo-Unlock, keine Lizenzgrenze und keine Sicherheitsbarriere.',
                }),
            }),
            capabilities: Object.freeze({
                [PLATFORM_CAPABILITY_IDS.DISCOVERY]: PLATFORM_PROVIDER_KINDS.BROWSER_DEMO,
                [PLATFORM_CAPABILITY_IDS.HOST]: Object.freeze({
                    enabled: false,
                    available: PLATFORM_PROVIDER_KINDS.BROWSER_DEMO,
                    unavailable: PLATFORM_PROVIDER_KINDS.UNAVAILABLE,
                }),
                [PLATFORM_CAPABILITY_IDS.SAVE]: Object.freeze({
                    available: PLATFORM_PROVIDER_KINDS.BROWSER_DOWNLOAD,
                    unavailable: PLATFORM_PROVIDER_KINDS.BROWSER_DEMO,
                }),
                [PLATFORM_CAPABILITY_IDS.RECORDING]: Object.freeze({
                    available: PLATFORM_PROVIDER_KINDS.BROWSER_NATIVE,
                    unavailable: PLATFORM_PROVIDER_KINDS.BROWSER_DEMO,
                }),
            }),
        }),
    }),
    lobbyProviders: Object.freeze({
        [MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE]: PLATFORM_PROVIDER_KINDS.MENU_STORAGE_BRIDGE,
        [MULTIPLAYER_TRANSPORTS.LAN]: PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY,
        [MULTIPLAYER_TRANSPORTS.ONLINE]: PLATFORM_PROVIDER_KINDS.MENU_ONLINE_LOBBY,
    }),
    tooling: Object.freeze({
        [PLATFORM_TOOLING_IDS.DEFAULT]: Object.freeze({
            surfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
        }),
        [PLATFORM_TOOLING_IDS.TRAINING_BENCHMARK]: Object.freeze({
            surfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
        }),
    }),
});
