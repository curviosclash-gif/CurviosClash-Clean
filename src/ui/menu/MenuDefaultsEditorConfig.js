import { HUNT_CONFIG } from '../../hunt/HuntConfig.js';
import { DEFAULT_SHADOW_QUALITY } from '../../shared/contracts/ShadowQualityContract.js';
import { createDefaultRecordingCaptureSettings } from '../../shared/contracts/RecordingCaptureContract.js';
import { createDefaultCameraPerspectiveSettings } from '../../shared/contracts/CameraPerspectiveContract.js';
import { DEFAULT_MOBILE_CLASSIC_CONTROLS } from '../../shared/contracts/MobileClassicControlsContract.js';

export const MENU_DEFAULT_EDITOR_SCHEMA_VERSION = 'menu-default-editor.v1';
export const MENU_DEFAULT_EVENT_PLAYLIST_ID = 'fun_rotation';
export const MENU_FIXED_PRESET_CREATED_AT = '2026-03-05T00:00:00.000Z';
const DEFAULT_MG_TRAIL_AIM_RADIUS = Number(HUNT_CONFIG?.MG?.TRAIL_HIT_RADIUS) || 0.78;
const DEFAULT_FIGHT_MG_DAMAGE = Number(HUNT_CONFIG?.MG?.DAMAGE) || 7.75;
const DEFAULT_NEXT_CHECKPOINT_GLOW_INTENSITY = 1.35;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach((key) => {
        deepFreeze(value[key]);
    });
    return Object.freeze(value);
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

const MENU_DEFAULT_EDITOR_CONFIG_VALUE = {
    schemaVersion: MENU_DEFAULT_EDITOR_SCHEMA_VERSION,
    baseSettings: {
        settingsVersion: 2,
        mode: '2p',
        gameMode: HUNT_CONFIG.DEFAULT_MODE,
        mapKey: 'mega_maze',
        numBots: 5,
        botDifficulty: 'HARD',
        botPolicyStrategy: 'auto',
        winsNeeded: 5,
        autoRoll: true,
        invertPitch: {
            PLAYER_1: true,
            PLAYER_2: true,
        },
        cockpitCamera: {
            PLAYER_1: true,
            PLAYER_2: true,
        },
        vehicles: {
            PLAYER_1: 'ship8',
            PLAYER_2: 'ship5',
        },
        portalsEnabled: true,
        hunt: {
            respawnEnabled: !!HUNT_CONFIG.DEFAULT_RESPAWN_ENABLED,
        },
        gameplay: {
            speed: 18,
            turnSensitivity: 2.2,
            planeScale: 1.0,
            trailWidth: 0.6,
            trailLength: 5000,
            gapSize: 0.3,
            gapFrequency: 0.02,
            itemAmount: 8,
            fireRate: 0.45,
            lockOnAngle: 11,
            nextCheckpointGlowIntensity: DEFAULT_NEXT_CHECKPOINT_GLOW_INTENSITY,
            mgTrailAimRadius: DEFAULT_MG_TRAIL_AIM_RADIUS,
            fightPlayerHp: HUNT_CONFIG.PLAYER_MAX_HP,
            fightMgDamage: DEFAULT_FIGHT_MG_DAMAGE,
            planarMode: false,
            portalCount: 8,
            planarLevelCount: 5,
            portalBeams: false,
        },
        botBridge: {
            enabled: false,
            url: 'ws://127.0.0.1:8765',
            timeoutMs: 80,
            maxRetries: 1,
            retryDelayMs: 0,
            resumeCheckpoint: '',
            resumeStrict: false,
        },
        recording: createDefaultRecordingCaptureSettings(),
        cameraPerspective: createDefaultCameraPerspectiveSettings(),
    },
    localSettings: {
        ownerId: 'owner',
        actorId: 'owner',
        developerModeVisibility: 'owner_only',
        developerModeEnabled: false,
        developerThemeId: 'classic-console',
        releasePreviewEnabled: false,
        fixedPresetId: '',
        fixedPresetLockEnabled: false,
        sessionType: 'splitscreen',
        modePath: 'fight',
        themeMode: 'dunkel',
        shadowQuality: DEFAULT_SHADOW_QUALITY,
        startSetup: {
            mapSearch: '',
            mapFilter: 'all',
            vehicleSearch: '',
            vehicleFilter: 'all',
            arcadeGhostDuelMode: 'off',
            arcadeGhostTrailCollisionEnabled: false,
        },
        toolsState: {
            level4Open: false,
            activeSection: 'controls',
        },
        mobileControls: { ...DEFAULT_MOBILE_CLASSIC_CONTROLS },
        draftStateBySessionType: {},
        telemetryState: {
            abortCount: 0,
            backtrackCount: 0,
            quickStartCount: 0,
            startAttempts: 0,
            lastEvents: [],
        },
        eventPlaylistState: {
            activePlaylistId: MENU_DEFAULT_EVENT_PLAYLIST_ID,
            nextIndex: 0,
            lastPresetId: '',
        },
    },
    level3Reset: {
        mapKey: 'standard',
        themeMode: 'dunkel',
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship5',
        },
    },
    configShare: {
        sessionType: 'single',
        modePath: 'normal',
        themeMode: 'dunkel',
        mode: '1p',
        gameMode: 'CLASSIC',
        mapKey: 'standard',
        numBots: 1,
        botDifficulty: 'NORMAL',
        botPolicyStrategy: 'auto',
        winsNeeded: 5,
        autoRoll: true,
        portalsEnabled: true,
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship5',
        },
        hunt: {
            respawnEnabled: false,
        },
        gameplay: {},
        recording: createDefaultRecordingCaptureSettings(),
        cameraPerspective: createDefaultCameraPerspectiveSettings(),
    },
    fixedPresets: [
        {
            id: 'arcade',
            name: 'Arcade',
            description: 'Schnelles Setup fuer direkten Einstieg.',
            lockedFields: ['mode', 'gameMode', 'numBots', 'winsNeeded'],
            values: {
                mode: '1p',
                gameMode: 'CLASSIC',
                mapKey: 'parcours_rift',
                numBots: 2,
                botDifficulty: 'NORMAL',
                winsNeeded: 5,
                'gameplay.speed': 18,
                'gameplay.turnSensitivity': 2.2,
                'gameplay.trailWidth': 0.6,
                'gameplay.fireRate': 0.45,
                'gameplay.itemAmount': 8,
            },
        },
        {
            id: 'competitive',
            name: 'Competitive',
            description: 'Turniernahes Regelset mit engeren Limits.',
            lockedFields: ['mode', 'numBots', 'winsNeeded', 'gameplay.speed', 'gameplay.turnSensitivity', 'gameplay.itemAmount'],
            values: {
                mode: '2p',
                gameMode: 'CLASSIC',
                mapKey: 'maze',
                numBots: 0,
                winsNeeded: 7,
                botDifficulty: 'HARD',
                'gameplay.speed': 20,
                'gameplay.turnSensitivity': 2.6,
                'gameplay.trailWidth': 0.55,
                'gameplay.fireRate': 0.5,
                'gameplay.itemAmount': 6,
            },
        },
        {
            id: 'chaos',
            name: 'Chaos',
            description: 'Mehr Bots, mehr Items, aggressiveres Tempo.',
            lockedFields: ['numBots', 'gameplay.itemAmount'],
            values: {
                mode: '1p',
                gameMode: 'HUNT',
                mapKey: 'complex',
                numBots: 6,
                botDifficulty: 'HARD',
                winsNeeded: 5,
                'hunt.respawnEnabled': true,
                'gameplay.speed': 24,
                'gameplay.turnSensitivity': 2.8,
                'gameplay.trailWidth': 0.72,
                'gameplay.fireRate': 0.25,
                'gameplay.itemAmount': 14,
                'gameplay.lockOnAngle': 18,
                'gameplay.mgTrailAimRadius': DEFAULT_MG_TRAIL_AIM_RADIUS,
            },
        },
        {
            id: 'fight-standard',
            name: 'Fight Standard',
            description: 'Empfohlene Fight-Kombination fuer den 4-Ebenen-Flow.',
            lockedFields: ['gameMode', 'hunt.respawnEnabled'],
            values: {
                mode: '1p',
                gameMode: 'HUNT',
                mapKey: 'maze',
                numBots: 3,
                botDifficulty: 'NORMAL',
                winsNeeded: 5,
                'hunt.respawnEnabled': true,
                'gameplay.speed': 20,
                'gameplay.turnSensitivity': 2.4,
                'gameplay.fireRate': 0.35,
                'gameplay.itemAmount': 10,
                'gameplay.mgTrailAimRadius': DEFAULT_MG_TRAIL_AIM_RADIUS,
                'gameplay.fightMgDamage': DEFAULT_FIGHT_MG_DAMAGE,
            },
        },
        {
            id: 'normal-standard',
            name: 'Normal Standard',
            description: 'Empfohlene Normal-Kombination fuer Classic-Sessions.',
            lockedFields: ['gameMode'],
            values: {
                mode: '1p',
                gameMode: 'CLASSIC',
                mapKey: 'standard',
                numBots: 2,
                botDifficulty: 'NORMAL',
                winsNeeded: 5,
                'hunt.respawnEnabled': false,
                'gameplay.speed': 18,
                'gameplay.turnSensitivity': 2.2,
                'gameplay.fireRate': 0.45,
                'gameplay.itemAmount': 8,
            },
        },
    ],
};

export const MENU_DEFAULT_EDITOR_CONFIG = deepFreeze(MENU_DEFAULT_EDITOR_CONFIG_VALUE);

export function createMenuDefaultsEditorConfigSnapshot() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG);
}

export function createMenuBaseSettingsDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.baseSettings);
}

export function createMenuLocalSettingsDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.localSettings);
}

export function createMenuStartSetupDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.localSettings.startSetup);
}

export function createMenuToolsStateDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.localSettings.toolsState);
}

export function createMenuTelemetryStateDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.localSettings.telemetryState);
}

export function createMenuEventPlaylistStateDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.localSettings.eventPlaylistState);
}

export function createMenuConfigSharePayloadDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.configShare);
}

export function createMenuLevel3ResetDefaults() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.level3Reset);
}

export function createFixedMenuPresetSeedCatalog() {
    return deepClone(MENU_DEFAULT_EDITOR_CONFIG.fixedPresets);
}

export function findFixedMenuPresetSeedById(presetId) {
    const normalizedPresetId = typeof presetId === 'string' ? presetId.trim() : '';
    if (!normalizedPresetId) return null;
    const preset = MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((entry) => entry.id === normalizedPresetId);
    return preset ? deepClone(preset) : null;
}

export function createMenuSettingsDefaults() {
    return {
        ...createMenuBaseSettingsDefaults(),
        localSettings: createMenuLocalSettingsDefaults(),
    };
}

export function createMenuDefaultsEditorSnapshotFromSettings(settings = {}) {
    const source = /** @type {Record<string, any>} */ (
        settings && typeof settings === 'object' ? settings : {}
    );
    const localSettings = /** @type {Record<string, any>} */ (
        source.localSettings && typeof source.localSettings === 'object'
            ? source.localSettings
            : {}
    );

    return {
        schemaVersion: MENU_DEFAULT_EDITOR_SCHEMA_VERSION,
        baseSettings: {
            settingsVersion: Number.isFinite(Number(source.settingsVersion))
                ? Number(source.settingsVersion)
                : MENU_DEFAULT_EDITOR_CONFIG.baseSettings.settingsVersion,
            mode: source.mode === '2p' ? '2p' : '1p',
            gameMode: String(source.gameMode || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.gameMode),
            mapKey: String(source.mapKey || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.mapKey),
            numBots: Number.isFinite(Number(source.numBots))
                ? Number(source.numBots)
                : MENU_DEFAULT_EDITOR_CONFIG.baseSettings.numBots,
            botDifficulty: String(source.botDifficulty || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.botDifficulty),
            botPolicyStrategy: String(source.botPolicyStrategy || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.botPolicyStrategy),
            winsNeeded: Number.isFinite(Number(source.winsNeeded))
                ? Number(source.winsNeeded)
                : MENU_DEFAULT_EDITOR_CONFIG.baseSettings.winsNeeded,
            autoRoll: source.autoRoll !== false,
            invertPitch: deepClone(source.invertPitch || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.invertPitch),
            cockpitCamera: deepClone(source.cockpitCamera || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.cockpitCamera),
            vehicles: deepClone(source.vehicles || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.vehicles),
            portalsEnabled: source.portalsEnabled !== false,
            hunt: deepClone(source.hunt || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.hunt),
            gameplay: deepClone(source.gameplay || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.gameplay),
            botBridge: deepClone(source.botBridge || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.botBridge),
            recording: deepClone(source.recording || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.recording),
            cameraPerspective: deepClone(
                source.cameraPerspective || MENU_DEFAULT_EDITOR_CONFIG.baseSettings.cameraPerspective
            ),
        },
        localSettings: {
            sessionType: String(localSettings.sessionType || MENU_DEFAULT_EDITOR_CONFIG.localSettings.sessionType),
            modePath: String(localSettings.modePath || MENU_DEFAULT_EDITOR_CONFIG.localSettings.modePath),
            themeMode: String(localSettings.themeMode || MENU_DEFAULT_EDITOR_CONFIG.localSettings.themeMode),
            shadowQuality: String(localSettings.shadowQuality || MENU_DEFAULT_EDITOR_CONFIG.localSettings.shadowQuality),
            startSetup: deepClone(localSettings.startSetup || MENU_DEFAULT_EDITOR_CONFIG.localSettings.startSetup),
            toolsState: deepClone(localSettings.toolsState || MENU_DEFAULT_EDITOR_CONFIG.localSettings.toolsState),
            eventPlaylistState: deepClone(localSettings.eventPlaylistState || MENU_DEFAULT_EDITOR_CONFIG.localSettings.eventPlaylistState),
        },
        level3Reset: createMenuLevel3ResetDefaults(),
        configShare: createMenuConfigSharePayloadDefaults(),
        fixedPresets: createFixedMenuPresetSeedCatalog(),
    };
}
