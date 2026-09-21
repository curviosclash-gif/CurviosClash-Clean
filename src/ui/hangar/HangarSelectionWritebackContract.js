/**
 * Shared writeback contract for Start-Setup and Hangar selection persistence.
 * V76 76.2.2: use one contract for map/vehicle selection and persisted local state.
 */

import {
    HANGAR_MODES,
    resolveHangarMode,
    resolveHangarUserFlow,
} from '../../shared/contracts/HangarModeContract.js';
import {
    ARCADE_GHOST_DUEL_MODES,
    normalizeArcadeGhostDuelMode,
    normalizeArcadeGhostTrailCollisionEnabled,
} from '../../shared/contracts/ArcadeGhostDuelContract.js';

export const HANGAR_SELECTION_WRITEBACK_VERSION = 'hangar-selection-writeback.v1';

export const HANGAR_SELECTION_PLAYER_SLOTS = Object.freeze({
    PLAYER_1: 'PLAYER_1',
    PLAYER_2: 'PLAYER_2',
});

export const HANGAR_SELECTION_MODES = Object.freeze({
    ARCADE: HANGAR_MODES.ARCADE,
    FIGHT: HANGAR_MODES.FIGHT,
});

/** @type {Set<string>} */
const VALID_PLAYER_SLOT_SET = new Set(Object.values(HANGAR_SELECTION_PLAYER_SLOTS));

export const HANGAR_SELECTION_WRITEBACK_PATHS = Object.freeze({
    MAP_KEY: 'settings.mapKey',
    VEHICLE_PLAYER_1: 'settings.vehicles.PLAYER_1',
    VEHICLE_PLAYER_2: 'settings.vehicles.PLAYER_2',
    START_SETUP_STATE: 'settings.localSettings.startSetup',
    MODE_SELECTIONS: 'settings.localSettings.startSetup.modeSelections',
    MODE_ARCADE_MAP_KEY: 'settings.localSettings.startSetup.modeSelections.arcade.mapKey',
    MODE_FIGHT_MAP_KEY: 'settings.localSettings.startSetup.modeSelections.fight.mapKey',
    MODE_ARCADE_VEHICLE_PLAYER_1: 'settings.localSettings.startSetup.modeSelections.arcade.vehicles.PLAYER_1',
    MODE_ARCADE_VEHICLE_PLAYER_2: 'settings.localSettings.startSetup.modeSelections.arcade.vehicles.PLAYER_2',
    MODE_FIGHT_VEHICLE_PLAYER_1: 'settings.localSettings.startSetup.modeSelections.fight.vehicles.PLAYER_1',
    MODE_FIGHT_VEHICLE_PLAYER_2: 'settings.localSettings.startSetup.modeSelections.fight.vehicles.PLAYER_2',
    START_SETUP_ARCADE_GHOST_DUEL_MODE: 'settings.localSettings.startSetup.arcadeGhostDuelMode',
    START_SETUP_ARCADE_GHOST_TRAIL_COLLISION_ENABLED: 'settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled',
});

export const HANGAR_START_SETUP_PERSISTED_FIELDS = Object.freeze({
    FAVORITE_MAPS: 'favoriteMaps',
    RECENT_MAPS: 'recentMaps',
    FAVORITE_VEHICLES: 'favoriteVehicles',
    RECENT_VEHICLES: 'recentVehicles',
    MAP_SEARCH: 'mapSearch',
    MAP_FILTER: 'mapFilter',
    VEHICLE_SEARCH: 'vehicleSearch',
    VEHICLE_FILTER: 'vehicleFilter',
    ARCADE_GHOST_DUEL_MODE: 'arcadeGhostDuelMode',
    ARCADE_GHOST_TRAIL_COLLISION_ENABLED: 'arcadeGhostTrailCollisionEnabled',
});

/** @type {Set<string>} */
const VALID_HANGAR_SELECTION_MODE_SET = new Set(Object.values(HANGAR_SELECTION_MODES));

function normalizeString(value, fallback = '') {
    const normalized = String(value || '').trim();
    return normalized || String(fallback || '').trim();
}

function ensureVehiclesState(settings) {
    if (!settings.vehicles || typeof settings.vehicles !== 'object') {
        settings.vehicles = {};
    }
    if (typeof settings.vehicles.PLAYER_1 !== 'string') settings.vehicles.PLAYER_1 = 'ship5';
    if (typeof settings.vehicles.PLAYER_2 !== 'string') settings.vehicles.PLAYER_2 = 'ship5';
    return settings.vehicles;
}

function resolveModeSelectionFallbackMapKey(settings, mode, fallbackMapKey = 'standard') {
    const normalizedFallbackMapKey = normalizeString(fallbackMapKey, 'standard') || 'standard';
    if (mode !== resolveActiveSelectionModeFromSettings(settings)) {
        return normalizedFallbackMapKey;
    }
    return normalizeString(settings?.mapKey, normalizedFallbackMapKey) || normalizedFallbackMapKey;
}

function ensureModeSelectionState(settings, mode, fallbackMapKey = 'standard') {
    const startSetup = ensureHangarSelectionWritebackState(settings);
    if (!startSetup) return null;
    if (!startSetup.modeSelections || typeof startSetup.modeSelections !== 'object') {
        startSetup.modeSelections = {};
    }
    if (!startSetup.modeSelections[mode] || typeof startSetup.modeSelections[mode] !== 'object') {
        startSetup.modeSelections[mode] = {};
    }
    const modeSelection = startSetup.modeSelections[mode];
    const resolvedFallbackMapKey = resolveModeSelectionFallbackMapKey(settings, mode, fallbackMapKey);
    if (typeof modeSelection.mapKey !== 'string' || !modeSelection.mapKey.trim()) {
        modeSelection.mapKey = resolvedFallbackMapKey;
    }
    if (!modeSelection.vehicles || typeof modeSelection.vehicles !== 'object') {
        modeSelection.vehicles = {};
    }
    const fallbackVehicleP1 = 'ship5';
    const fallbackVehicleP2 = 'ship5';
    if (typeof modeSelection.vehicles.PLAYER_1 !== 'string') modeSelection.vehicles.PLAYER_1 = fallbackVehicleP1;
    if (typeof modeSelection.vehicles.PLAYER_2 !== 'string') modeSelection.vehicles.PLAYER_2 = fallbackVehicleP2;
    return modeSelection;
}

export function resolveHangarSelectionPlayerSlot(rawSlot) {
    const slot = normalizeString(rawSlot).toUpperCase();
    return VALID_PLAYER_SLOT_SET.has(slot) ? slot : HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1;
}

export function resolveHangarSelectionMode(rawModePath) {
    const normalizedMode = resolveHangarMode(rawModePath);
    if (VALID_HANGAR_SELECTION_MODE_SET.has(normalizedMode)) return normalizedMode;
    return HANGAR_SELECTION_MODES.FIGHT;
}

function resolveSelectionModeFromSettings(settings, options = {}) {
    const optionMode = normalizeString(options.mode || options.modePath);
    if (optionMode) return resolveHangarSelectionMode(optionMode);
    return resolveHangarSelectionMode(settings?.localSettings?.modePath);
}

function resolveActiveSelectionModeFromSettings(settings) {
    return resolveHangarSelectionMode(settings?.localSettings?.modePath);
}

export function ensureHangarSelectionWritebackState(settings) {
    if (!settings || typeof settings !== 'object') {
        return null;
    }
    ensureVehiclesState(settings);
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    if (!settings.localSettings.startSetup || typeof settings.localSettings.startSetup !== 'object') {
        settings.localSettings.startSetup = {};
    }
    const startSetup = settings.localSettings.startSetup;
    if (!Array.isArray(startSetup.favoriteMaps)) startSetup.favoriteMaps = [];
    if (!Array.isArray(startSetup.recentMaps)) startSetup.recentMaps = [];
    if (!Array.isArray(startSetup.favoriteVehicles)) startSetup.favoriteVehicles = [];
    if (!Array.isArray(startSetup.recentVehicles)) startSetup.recentVehicles = [];
    if (typeof startSetup.mapSearch !== 'string') startSetup.mapSearch = '';
    if (typeof startSetup.mapFilter !== 'string') startSetup.mapFilter = 'all';
    if (typeof startSetup.vehicleSearch !== 'string') startSetup.vehicleSearch = '';
    if (typeof startSetup.vehicleFilter !== 'string') startSetup.vehicleFilter = 'all';
    startSetup.arcadeGhostDuelMode = normalizeArcadeGhostDuelMode(
        startSetup.arcadeGhostDuelMode,
        ARCADE_GHOST_DUEL_MODES.OFF
    );
    startSetup.arcadeGhostTrailCollisionEnabled = normalizeArcadeGhostTrailCollisionEnabled(
        startSetup.arcadeGhostTrailCollisionEnabled,
        false
    );
    return startSetup;
}

function resolveVehiclePersistencePath(playerSlot) {
    return playerSlot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2
        ? HANGAR_SELECTION_WRITEBACK_PATHS.VEHICLE_PLAYER_2
        : HANGAR_SELECTION_WRITEBACK_PATHS.VEHICLE_PLAYER_1;
}

function resolveModeMapPersistencePath(mode) {
    return mode === HANGAR_SELECTION_MODES.FIGHT
        ? HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_MAP_KEY
        : HANGAR_SELECTION_WRITEBACK_PATHS.MODE_ARCADE_MAP_KEY;
}

function resolveModeVehiclePersistencePath(mode, playerSlot) {
    if (mode === HANGAR_SELECTION_MODES.FIGHT) {
        return playerSlot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2
            ? HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_VEHICLE_PLAYER_2
            : HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_VEHICLE_PLAYER_1;
    }
    return playerSlot === HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2
        ? HANGAR_SELECTION_WRITEBACK_PATHS.MODE_ARCADE_VEHICLE_PLAYER_2
        : HANGAR_SELECTION_WRITEBACK_PATHS.MODE_ARCADE_VEHICLE_PLAYER_1;
}

export function resolveHangarSelectionDataSpace(rawModePath) {
    const mode = resolveHangarSelectionMode(rawModePath);
    const flow = resolveHangarUserFlow(mode);
    return Object.freeze({
        mode,
        dataSpace: flow.dataSpace,
        persistenceKey: flow.persistenceKey,
        mapPersistencePath: resolveModeMapPersistencePath(mode),
        vehiclePersistencePathMap: Object.freeze({
            PLAYER_1: resolveModeVehiclePersistencePath(mode, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1),
            PLAYER_2: resolveModeVehiclePersistencePath(mode, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2),
        }),
    });
}

export function readHangarMapSelection(settings, fallbackMapKey = 'standard', options = {}) {
    const nextMapKey = normalizeString(fallbackMapKey, 'standard') || 'standard';
    if (!settings || typeof settings !== 'object') {
        const modeInfo = resolveHangarSelectionDataSpace(options.mode || options.modePath);
        return {
            mode: modeInfo.mode,
            dataSpace: modeInfo.dataSpace,
            value: nextMapKey,
            persistencePath: modeInfo.mapPersistencePath,
        };
    }
    ensureHangarSelectionWritebackState(settings);
    const mode = resolveSelectionModeFromSettings(settings, options);
    const modeSelection = ensureModeSelectionState(settings, mode, nextMapKey);
    const modeInfo = resolveHangarSelectionDataSpace(mode);
    const value = normalizeString(modeSelection?.mapKey, nextMapKey) || nextMapKey;
    return {
        mode,
        dataSpace: modeInfo.dataSpace,
        value,
        persistencePath: modeInfo.mapPersistencePath,
    };
}

export function readHangarVehicleSelection(settings, rawPlayerSlot, fallbackVehicleId = 'ship5', options = {}) {
    const playerSlot = resolveHangarSelectionPlayerSlot(rawPlayerSlot);
    const nextVehicleId = normalizeString(fallbackVehicleId, 'ship5').toLowerCase() || 'ship5';
    if (!settings || typeof settings !== 'object') {
        const modeInfo = resolveHangarSelectionDataSpace(options.mode || options.modePath);
        return {
            mode: modeInfo.mode,
            dataSpace: modeInfo.dataSpace,
            playerSlot,
            value: nextVehicleId,
            persistencePath: modeInfo.vehiclePersistencePathMap[playerSlot] || resolveVehiclePersistencePath(playerSlot),
        };
    }
    ensureHangarSelectionWritebackState(settings);
    const mode = resolveSelectionModeFromSettings(settings, options);
    const modeSelection = ensureModeSelectionState(settings, mode);
    const modeInfo = resolveHangarSelectionDataSpace(mode);
    const value = normalizeString(
        modeSelection?.vehicles?.[playerSlot],
        nextVehicleId
    ).toLowerCase() || nextVehicleId;
    return {
        mode,
        dataSpace: modeInfo.dataSpace,
        playerSlot,
        value,
        persistencePath: modeInfo.vehiclePersistencePathMap[playerSlot] || resolveVehiclePersistencePath(playerSlot),
    };
}

export function writeHangarMapSelection(settings, rawMapKey, fallbackMapKey = 'standard', options = {}) {
    if (!settings || typeof settings !== 'object') {
        const modeInfo = resolveHangarSelectionDataSpace(options.mode || options.modePath);
        return {
            changed: false,
            value: normalizeString(rawMapKey, fallbackMapKey) || 'standard',
            mode: modeInfo.mode,
            dataSpace: modeInfo.dataSpace,
            persistencePath: modeInfo.mapPersistencePath,
        };
    }
    ensureHangarSelectionWritebackState(settings);
    const nextMapKey = normalizeString(rawMapKey, fallbackMapKey) || 'standard';
    const mode = resolveSelectionModeFromSettings(settings, options);
    const modeSelection = ensureModeSelectionState(settings, mode, nextMapKey);
    const modeInfo = resolveHangarSelectionDataSpace(mode);
    const previousMapKey = normalizeString(modeSelection?.mapKey, fallbackMapKey) || 'standard';
    if (mode === resolveActiveSelectionModeFromSettings(settings)) {
        settings.mapKey = nextMapKey;
    }
    if (modeSelection) modeSelection.mapKey = nextMapKey;
    return {
        changed: previousMapKey !== nextMapKey,
        mode,
        dataSpace: modeInfo.dataSpace,
        value: nextMapKey,
        persistencePath: modeInfo.mapPersistencePath,
    };
}

export function writeHangarVehicleSelection(settings, rawPlayerSlot, rawVehicleId, fallbackVehicleId = 'ship5', options = {}) {
    if (!settings || typeof settings !== 'object') {
        const resolvedSlot = resolveHangarSelectionPlayerSlot(rawPlayerSlot);
        const modeInfo = resolveHangarSelectionDataSpace(options.mode || options.modePath);
        return {
            changed: false,
            playerSlot: resolvedSlot,
            mode: modeInfo.mode,
            dataSpace: modeInfo.dataSpace,
            value: normalizeString(rawVehicleId, fallbackVehicleId).toLowerCase() || 'ship5',
            persistencePath: modeInfo.vehiclePersistencePathMap[resolvedSlot] || resolveVehiclePersistencePath(resolvedSlot),
        };
    }
    ensureHangarSelectionWritebackState(settings);
    const playerSlot = resolveHangarSelectionPlayerSlot(rawPlayerSlot);
    const mode = resolveSelectionModeFromSettings(settings, options);
    const modeSelection = ensureModeSelectionState(settings, mode);
    const modeInfo = resolveHangarSelectionDataSpace(mode);
    const nextVehicleId = normalizeString(rawVehicleId, fallbackVehicleId).toLowerCase() || 'ship5';
    const previousVehicleId = normalizeString(modeSelection?.vehicles?.[playerSlot], fallbackVehicleId).toLowerCase() || 'ship5';
    if (mode === resolveActiveSelectionModeFromSettings(settings)) {
        settings.vehicles[playerSlot] = nextVehicleId;
    }
    if (modeSelection?.vehicles) {
        modeSelection.vehicles[playerSlot] = nextVehicleId;
    }
    return {
        changed: previousVehicleId !== nextVehicleId,
        playerSlot,
        mode,
        dataSpace: modeInfo.dataSpace,
        value: nextVehicleId,
        persistencePath: modeInfo.vehiclePersistencePathMap[playerSlot] || resolveVehiclePersistencePath(playerSlot),
    };
}

function createModeSelectionSnapshot(modeSelection = {}, fallbackMapKey) {
    return Object.freeze({
        mapKey: normalizeString(modeSelection.mapKey, fallbackMapKey) || 'standard',
        vehicles: Object.freeze({
            PLAYER_1: normalizeString(modeSelection?.vehicles?.PLAYER_1, 'ship5').toLowerCase() || 'ship5',
            PLAYER_2: normalizeString(modeSelection?.vehicles?.PLAYER_2, 'ship5').toLowerCase() || 'ship5',
        }),
    });
}

export function createHangarSelectionWritebackSnapshot(settings, options = {}) {
    ensureHangarSelectionWritebackState(settings);
    const activeMode = resolveSelectionModeFromSettings(settings, options);
    const activeMapSelection = readHangarMapSelection(settings, 'standard', { mode: activeMode });
    const activeVehicleP1Selection = readHangarVehicleSelection(
        settings,
        HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
        'ship5',
        { mode: activeMode }
    );
    const activeVehicleP2Selection = readHangarVehicleSelection(
        settings,
        HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2,
        'ship5',
        { mode: activeMode }
    );
    const arcadeModeSelection = ensureModeSelectionState(settings, HANGAR_SELECTION_MODES.ARCADE);
    const fightModeSelection = ensureModeSelectionState(settings, HANGAR_SELECTION_MODES.FIGHT);
    return Object.freeze({
        contractVersion: HANGAR_SELECTION_WRITEBACK_VERSION,
        mode: activeMode,
        dataSpace: resolveHangarSelectionDataSpace(activeMode).dataSpace,
        mapKey: activeMapSelection.value,
        vehicles: Object.freeze({
            PLAYER_1: activeVehicleP1Selection.value,
            PLAYER_2: activeVehicleP2Selection.value,
        }),
        modeSelections: Object.freeze({
            [HANGAR_SELECTION_MODES.ARCADE]: createModeSelectionSnapshot(
                arcadeModeSelection || {},
                'standard'
            ),
            [HANGAR_SELECTION_MODES.FIGHT]: createModeSelectionSnapshot(
                fightModeSelection || {},
                'standard'
            ),
        }),
        persistencePathMap: HANGAR_SELECTION_WRITEBACK_PATHS,
    });
}
