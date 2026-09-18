import { GENERATED_LOCAL_MAPS } from '../../../entities/GeneratedLocalMaps.js';
import { readElectronLocalMaps } from '../../../platform/electron/ElectronPlatformBridge.js';

// Gleiche Schranke wie im Kartenspeicher des Hauptprozesses.
const LOCAL_MAP_KEY_PATTERN = /^editor_[a-z0-9][a-z0-9_-]{0,63}$/;

function isPlayableLocalMap(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
    const size = map.size;
    if (!Array.isArray(size) || size.length < 3) return false;
    if (!size.slice(0, 3).every((value) => Number.isFinite(value) && value > 0)) return false;
    return map.obstacles === undefined || Array.isArray(map.obstacles);
}

/**
 * Nimmt nur Karten mit Editor-Kennung und brauchbarer Arenagroesse auf. Eine
 * kaputte Datei im Nutzerordner soll das Menue nicht mitreissen, und keine
 * Datei darf eine eingebaute Karte ueberschreiben.
 *
 * @param {Record<string, unknown>} localMaps
 */
export function selectPlayableLocalMaps(localMaps) {
    const selected = {};
    if (!localMaps || typeof localMaps !== 'object') return selected;
    for (const [mapKey, map] of Object.entries(localMaps)) {
        if (!LOCAL_MAP_KEY_PATTERN.test(mapKey) || !isPlayableLocalMap(map)) continue;
        selected[mapKey] = map;
    }
    return selected;
}

/**
 * Gleicht einen bestehenden Katalog mit dem Nutzerordner ab. Gepruefte
 * Editor-Karten kommen hinzu oder werden aktualisiert. Mit `knownKeys` (den
 * Kennungen, die bisher aus dem Nutzerordner stammten) verschwinden auch
 * geloeschte Dateien wieder; hatte eine solche Karte eine Quellbaum-Karte
 * verdeckt, kommt diese aus `fallbackMaps` zurueck. Alle anderen Kennungen
 * bleiben unberuehrt.
 *
 * @param {Record<string, unknown>} catalog
 * @param {Record<string, unknown>} localMaps
 * @param {{knownKeys?: Set<string>, fallbackMaps?: Record<string, unknown>}} [options]
 * @returns {string[]} die neuen, geaenderten oder entfernten Kennungen
 */
export function mergePlayableLocalMaps(catalog, localMaps, { knownKeys, fallbackMaps = {} } = {}) {
    const changed = [];
    const playable = selectPlayableLocalMaps(localMaps);
    for (const mapKey of knownKeys ? [...knownKeys] : []) {
        if (Object.prototype.hasOwnProperty.call(playable, mapKey)) continue;
        if (Object.prototype.hasOwnProperty.call(fallbackMaps, mapKey)) catalog[mapKey] = fallbackMaps[mapKey];
        else delete catalog[mapKey];
        knownKeys.delete(mapKey);
        changed.push(mapKey);
    }
    for (const [mapKey, map] of Object.entries(playable)) {
        knownKeys?.add(mapKey);
        if (JSON.stringify(catalog[mapKey]) === JSON.stringify(map)) continue;
        catalog[mapKey] = map;
        changed.push(mapKey);
    }
    return changed;
}

/**
 * Karten aus dem Quellbaum (Entwicklungsserver) und aus dem Nutzerordner
 * (Desktop). Bei gleicher Kennung gewinnt der Nutzerordner, weil er den
 * zuletzt gespeicherten Stand haelt.
 */
export function createGeneratedMapPresets(
    generatedLocalMaps = GENERATED_LOCAL_MAPS,
    desktopLocalMaps = readElectronLocalMaps(),
) {
    return Object.freeze({ ...generatedLocalMaps, ...selectPlayableLocalMaps(desktopLocalMaps) });
}

const STARTUP_DESKTOP_LOCAL_MAPS = readElectronLocalMaps();

export const MAP_PRESETS_GENERATED = createGeneratedMapPresets(GENERATED_LOCAL_MAPS, STARTUP_DESKTOP_LOCAL_MAPS);

/**
 * Kennungen, die gerade aus dem Nutzerordner stammen. Das Nachladen pflegt
 * die Menge, damit es geloeschte Dateien erkennt.
 */
export const DESKTOP_LOCAL_MAP_KEYS = new Set(Object.keys(selectPlayableLocalMaps(STARTUP_DESKTOP_LOCAL_MAPS)));
