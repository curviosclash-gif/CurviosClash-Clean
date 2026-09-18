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

export const MAP_PRESETS_GENERATED = createGeneratedMapPresets();
