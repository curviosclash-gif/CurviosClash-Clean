// ============================================
// Config.js - Zentrale Spielkonfiguration
// ============================================

import { CONFIG_SECTIONS } from './config/ConfigSections.js';
import { MAP_PRESETS } from './config/MapPresets.js';
import {
    createActiveRuntimeConfigReadPort,
} from './runtime/ActiveRuntimeConfigStore.js';
import { registerMapCatalogConfigSource } from '../shared/contracts/RuntimeMapCatalogContract.js';

export const CONFIG_BASE = {
    ...CONFIG_SECTIONS,
    MAPS: MAP_PRESETS,
};

const CONFIG_RUNTIME_CONFIG_PORT = createActiveRuntimeConfigReadPort({ fallback: CONFIG_BASE });

export const CONFIG = new Proxy(CONFIG_BASE, {
    get(target, property, receiver) {
        const activeConfig = CONFIG_RUNTIME_CONFIG_PORT.getConfig(target);
        return Reflect.get(activeConfig || target, property, receiver);
    },
});

export function refreshConfigRuntimeCache(options = undefined) {
    return CONFIG_RUNTIME_CONFIG_PORT.refresh(options);
}

// Register CONFIG as the map-catalog source so that shared-layer consumers
// can resolve MAPS and ARENA without importing from src/core/Config.js.
registerMapCatalogConfigSource(CONFIG);
