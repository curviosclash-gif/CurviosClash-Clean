import { buildEditorMapDiskFiles } from '../EditorMapDiskFiles.js';

/**
 * @typedef {object} EditorDiskBridge
 * @property {(payload: object) => Promise<object>} saveMap
 * @property {() => Promise<object>} listMaps
 * @property {() => Promise<object>} openMapsFolder
 */

/**
 * Liefert die Desktop-Bruecke zum Hauptprozess, falls das Fenster sie hat.
 * Im Browser und am Entwicklungsserver gibt es sie nicht; dort bleibt der
 * HTTP-Weg. Fehlt eine der drei Kartenfunktionen, gilt die Bruecke als nicht
 * vorhanden - dann meldet die Oberflaeche einen Fehler statt stillem Erfolg.
 *
 * @param {object} [runtimeGlobal]
 * @returns {EditorDiskBridge|null}
 */
export function resolveEditorDiskBridge(runtimeGlobal = globalThis) {
    const bridge = runtimeGlobal?.__CURVIOS_EDITOR_DISK__;
    if (!bridge) return null;
    const required = ['saveMap', 'listMaps', 'openMapsFolder'];
    if (required.some((name) => typeof bridge[name] !== 'function')) return null;
    return /** @type {EditorDiskBridge} */ (bridge);
}

function unwrap(payload, fallbackError) {
    if (!payload?.ok) throw new Error(String(payload?.error || fallbackError));
    return payload;
}

/**
 * Rechnet den Arbeitsstand im Editor in die beiden Dateien um und schickt nur
 * fertiges JSON an den Hauptprozess. Der Hauptprozess kennt das Kartenformat
 * damit nicht und muss nur pruefen und schreiben.
 *
 * @param {EditorDiskBridge} bridge
 * @param {{jsonText: string, mapName: string, editorDocument?: object|null, saveAsCopy?: boolean}} request
 */
export async function saveMapThroughDesktopBridge(bridge, { jsonText, mapName, editorDocument = null, saveAsCopy = false }) {
    const built = buildEditorMapDiskFiles({ jsonText, mapName, editorDocument });
    const payload = unwrap(
        await bridge.saveMap({
            mapName: built.mapName,
            saveAsCopy: saveAsCopy === true,
            runtimeJson: JSON.stringify(built.runtimeMap),
            editorJson: JSON.stringify(built.authoringDocument),
        }),
        'Karte konnte im Desktop nicht gespeichert werden.'
    );
    return { ...payload, warnings: [...built.warnings, ...(payload.warnings || [])] };
}

/**
 * @param {EditorDiskBridge} bridge
 */
export async function listMapsThroughDesktopBridge(bridge) {
    return unwrap(await bridge.listMaps(), 'Gespeicherte Karten konnten nicht gelesen werden.');
}

/**
 * @param {EditorDiskBridge} bridge
 */
export async function openMapsFolderThroughDesktopBridge(bridge) {
    return unwrap(await bridge.openMapsFolder(), 'Der Kartenordner konnte nicht geoeffnet werden.');
}
