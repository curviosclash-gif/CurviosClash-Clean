import { CONFIG_BASE, refreshConfigRuntimeCache } from '../Config.js';
import { mergePlayableLocalMaps } from '../config/maps/MapPresetsGenerated.js';
import { refreshElectronLocalMaps } from '../../platform/electron/ElectronPlatformBridge.js';
import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';

/**
 * Holt im Desktop die gespeicherten Editor-Karten neu und traegt neue oder
 * geaenderte in den Kartenkatalog ein. Die aktive Laufzeitkonfiguration haelt
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
 * }} [options]
 * @returns {boolean} true, wenn der Katalog gewachsen oder sich geaendert hat
 */
export function refreshLocalMapCatalog({
    gameState,
    applySettings,
    readLocalMaps = refreshElectronLocalMaps,
    catalog = CONFIG_BASE.MAPS,
    refreshRuntimeConfig = refreshConfigRuntimeCache,
} = {}) {
    if (gameState !== GAME_STATE_IDS.MENU) return false;
    const localMaps = readLocalMaps();
    if (!localMaps) return false;
    if (mergePlayableLocalMaps(catalog, localMaps).length === 0) return false;
    refreshRuntimeConfig();
    applySettings?.();
    return true;
}
