import { CONFIG_BASE, refreshConfigRuntimeCache } from '../Config.js';
import { DESKTOP_LOCAL_MAP_KEYS, mergePlayableLocalMaps } from '../config/maps/MapPresetsGenerated.js';
import { GENERATED_LOCAL_MAPS } from '../../entities/GeneratedLocalMaps.js';
import { refreshElectronLocalMaps } from '../../platform/electron/ElectronPlatformBridge.js';
import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';

const DEFAULT_LOCAL_MAPS = /** @type {Record<string, unknown>} */ (GENERATED_LOCAL_MAPS);

/**
 * Holt im Desktop die gespeicherten Editor-Karten neu, traegt neue oder
 * geaenderte in den Kartenkatalog ein und nimmt geloeschte wieder heraus.
 * Die aktive Laufzeitkonfiguration haelt
 * eine eingefrorene Kopie der Karten; sie wird deshalb verworfen und aus den
 * Einstellungen neu gebaut, damit Menue, Pruefungen und Rundenstart dieselbe
 * Liste sehen. Waehrend einer Runde passiert nichts, damit die laufende
 * Konfiguration nicht mitten im Spiel neu entsteht.
 *
 * @param {{
 *   gameState?: string,
 *   applySettings?: () => unknown,
 *   readLocalMaps?: () => Record<string, unknown>|null,
 *   catalog?: Record<string, unknown>,
 *   refreshRuntimeConfig?: () => unknown,
 *   knownKeys?: Set<string>,
 *   fallbackMaps?: Record<string, unknown>,
 * }} [options]
 * @returns {boolean} true, wenn der Katalog sich geaendert hat
 */
export function refreshLocalMapCatalog({
    gameState,
    applySettings,
    readLocalMaps = refreshElectronLocalMaps,
    catalog = CONFIG_BASE.MAPS,
    refreshRuntimeConfig = refreshConfigRuntimeCache,
    knownKeys = DESKTOP_LOCAL_MAP_KEYS,
    fallbackMaps = DEFAULT_LOCAL_MAPS,
} = {}) {
    if (gameState !== GAME_STATE_IDS.MENU) return false;
    const localMaps = readLocalMaps();
    if (!localMaps) return false;
    if (mergePlayableLocalMaps(catalog, localMaps, { knownKeys, fallbackMaps }).length === 0) return false;
    refreshRuntimeConfig();
    applySettings?.();
    return true;
}
