import { test, expect } from '@playwright/test';
import { CONFIG } from '../src/core/Config.js';
import {
    collectErrors,
    lockExpertMode,
    loadGame,
    openCustomSubmenu,
    openDebugSubmenu,
    openDeveloperSubmenu,
    openExpertSubmenu,
    openGameSubmenu,
    openStartSetupSection,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    openSubmenu,
    returnToMenu,
    startGame,
    startGameWithBots,
    unlockExpertMode,
} from './helpers.js';
import { createMapDocument, parseMapJSON, stringifyMapDocument, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';
import { RoundMetricsStore } from '../src/state/recorder/RoundMetricsStore.js';
import {
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
} from '../src/ui/arcade/VehicleManagerCatalog.js';
import { applyPlayerPowerup, updatePlayerEffects } from '../src/entities/player/PlayerEffectOps.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';

const SETTINGS_STORAGE_KEY = 'cuviosclash.settings.v1';
const SETTINGS_PROFILES_STORAGE_KEY = 'cuviosclash.settings-profiles.v1';
const LEGACY_SETTINGS_STORAGE_KEY = 'aero-arena-3d.settings.v1';
const MENU_DRAFTS_STORAGE_KEY = 'cuviosclash.menu-drafts.v1';
const MENU_PRESETS_STORAGE_KEY = 'cuviosclash.menu-presets.v1';
const CUSTOM_MAP_STORAGE_KEY = 'custom_map_test';
const ARCADE_VEHICLE_PROFILE_STORAGE_KEY = 'cuviosclash.arcade-vehicle-profile.v1';
const ARCADE_VEHICLE_LOADOUT_STORAGE_KEY = 'cuviosclash.arcade-vehicle-loadouts.v1';
const ARCADE_LAST_RUN_STORAGE_KEY = 'cuviosclash.arcade.last_run.v1';

function buildLegacyRuntimeCustomMap(obstacles = [], options = {}) {
    const payload = {
        size: [80, 30, 80],
        obstacles,
        portals: [],
    };
    if (typeof options?.glbModel === 'string' && options.glbModel.trim().length > 0) {
        payload.glbModel = options.glbModel.trim();
    }
    return JSON.stringify(payload);
}

function createMockEditorManager() {
    return {
        mapDocumentMeta: {},
        lastSchemaWarnings: [],
        core: {
            objectsContainer: {
                children: [],
            },
        },
        clearAllObjects() {
            this.core.objectsContainer.children = [];
            this.mapDocumentMeta = {};
            this.lastSchemaWarnings = [];
        },
        withSceneMutation(fn) {
            return fn();
        },
        queueSceneUiRefresh() {},
        syncTunnelEndpointsFromMesh() {},
        createMesh(type, subType, x, y, z, sizeInfo, extraProps = {}) {
            const mesh = {
                position: { x, y, z },
                rotation: { y: Number(extraProps.rotateY) || 0 },
                userData: {
                    type,
                    subType,
                    sizeInfo,
                    ...extraProps,
                },
            };
            this.core.objectsContainer.children.push(mesh);
            return mesh;
        },
    };
}

async function loadGameWithRetry(page, attempts = 4) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            await loadGame(page);
            return;
        } catch (error) {
            lastError = error;
            await page.waitForTimeout(400 * (attempt + 1));
        }
    }
    throw lastError;
}

export {
    // Playwright primitives.
    test,
    expect,
    // Runtime/menu helpers.
    CONFIG,
    collectErrors,
    lockExpertMode,
    loadGame,
    openCustomSubmenu,
    openDebugSubmenu,
    openDeveloperSubmenu,
    openExpertSubmenu,
    openGameSubmenu,
    openStartSetupSection,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    openSubmenu,
    returnToMenu,
    startGame,
    startGameWithBots,
    unlockExpertMode,
    loadGameWithRetry,
    // Map/editor contract helpers.
    createMapDocument,
    parseMapJSON,
    stringifyMapDocument,
    toArenaMapDefinition,
    generateJSONExport,
    importFromJSON,
    createMockEditorManager,
    buildLegacyRuntimeCustomMap,
    // Runtime contract modules.
    RoundMetricsStore,
    createMatchRuntimeProjection,
    // Arcade and player-domain helpers.
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
    applyPlayerPowerup,
    updatePlayerEffects,
    // Storage contract keys.
    SETTINGS_STORAGE_KEY,
    SETTINGS_PROFILES_STORAGE_KEY,
    LEGACY_SETTINGS_STORAGE_KEY,
    MENU_DRAFTS_STORAGE_KEY,
    MENU_PRESETS_STORAGE_KEY,
    CUSTOM_MAP_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
    ARCADE_LAST_RUN_STORAGE_KEY,
};
