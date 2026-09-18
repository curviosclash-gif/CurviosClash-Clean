import { parseMapJSON, toArenaMapDefinition } from '../../src/entities/MapSchema.js';
import {
    createEditorAuthoringDocument,
    parseEditorAuthoringDocument,
} from './EditorAuthoringDocument.js';

export const GENERATED_EDITOR_MAP_KEY_PREFIX = 'editor_';
export const DEFAULT_EDITOR_DISK_MAP_NAME = 'Editor Map';
export const EDITOR_MAP_NAME_MAX_LENGTH = 80;
export const EDITOR_MAP_KEY_SLUG_MAX_LENGTH = 48;
export const EDITOR_MAP_EDITOR_SUFFIX = '.editor.json';
export const EDITOR_MAP_RUNTIME_SUFFIX = '.runtime.json';

const LEGACY_EDITOR_PLAYTEST_SCALE = 35;
const LEGACY_EDITOR_LARGE_DIM_THRESHOLD = 500;
const RUNTIME_MAP_SCALE = 3;

/**
 * Kuerzt und glaettet den vom Autor eingegebenen Kartennamen.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeEditorMapName(value) {
    if (typeof value !== 'string') return DEFAULT_EDITOR_DISK_MAP_NAME;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return DEFAULT_EDITOR_DISK_MAP_NAME;
    return normalized.slice(0, EDITOR_MAP_NAME_MAX_LENGTH);
}

/**
 * Bildet aus einem Kartennamen den Dateinamens-Stamm. Alles ausserhalb von
 * a-z, 0-9 wird zu Bindestrichen, damit aus dem Namen niemals ein Pfad
 * entstehen kann.
 * @param {unknown} mapName
 * @returns {string}
 */
export function slugifyEditorMapKeyBase(mapName) {
    const slug = String(sanitizeEditorMapName(mapName) || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, EDITOR_MAP_KEY_SLUG_MAX_LENGTH) || 'map';
    return `${GENERATED_EDITOR_MAP_KEY_PREFIX}${slug}`;
}

/**
 * Alte Editor-Entwuerfe wurden in einem anderen Massstab gebaut; sehr grosse
 * Arenen werden deshalb mit dem Playtest-Massstab umgerechnet.
 * @param {{arenaSize?: {width?: number, height?: number, depth?: number}}} mapDocument
 * @returns {number}
 */
export function getEditorDiskConversionScale(mapDocument) {
    const width = Number(mapDocument?.arenaSize?.width);
    const height = Number(mapDocument?.arenaSize?.height);
    const depth = Number(mapDocument?.arenaSize?.depth);
    const maxDim = Math.max(
        Number.isFinite(width) ? width : 0,
        Number.isFinite(height) ? height : 0,
        Number.isFinite(depth) ? depth : 0
    );

    if (maxDim >= LEGACY_EDITOR_LARGE_DIM_THRESHOLD && RUNTIME_MAP_SCALE < LEGACY_EDITOR_PLAYTEST_SCALE) {
        return LEGACY_EDITOR_PLAYTEST_SCALE;
    }

    return RUNTIME_MAP_SCALE;
}

/**
 * Erzeugt aus dem Editor-Export die beiden Dateien, die auf der Platte landen:
 * den bearbeitbaren Arbeitsstand und die fertige Laufzeitkarte. Eine Stelle
 * fuer beide Wege - Entwicklungsserver und Desktop-Hauptprozess.
 *
 * @param {{jsonText: string, mapName?: unknown, editorDocument?: object|null}} options
 * @returns {{mapName: string, runtimeMap: object, authoringDocument: object, warnings: string[]}}
 */
export function buildEditorMapDiskFiles({ jsonText, mapName, editorDocument = null }) {
    const parsed = parseMapJSON(jsonText);
    const resolvedName = sanitizeEditorMapName(mapName);
    const converted = toArenaMapDefinition(parsed.map, {
        mapScale: getEditorDiskConversionScale(parsed.map),
        name: resolvedName,
    });

    let authoringDocument = createEditorAuthoringDocument({ map: parsed.map });
    if (editorDocument && typeof editorDocument === 'object') {
        const authoring = parseEditorAuthoringDocument(editorDocument);
        authoringDocument = createEditorAuthoringDocument({
            map: parsed.map,
            workspaceMetadata: authoring.workspaceMetadata,
            layerState: authoring.layerState,
            viewState: authoring.viewState,
        });
    }

    return {
        mapName: converted.map?.name || resolvedName,
        runtimeMap: converted.map,
        authoringDocument,
        warnings: [...(parsed.warnings || []), ...(converted.warnings || [])],
    };
}
