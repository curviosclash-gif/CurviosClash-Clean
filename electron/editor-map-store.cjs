'use strict';

const path = require('node:path');
const {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} = require('node:fs');
const { randomUUID } = require('node:crypto');

const MAP_EDITOR_SUFFIX = '.editor.json';
const MAP_RUNTIME_SUFFIX = '.runtime.json';
const MAP_KEY_PREFIX = 'editor_';
// Der Stamm entsteht aus dem Kartennamen: 48 Zeichen Slug plus Zaehlersuffix.
const MAP_KEY_PATTERN = /^editor_[a-z0-9][a-z0-9_-]{0,63}$/;
const MAP_NAME_MAX_LENGTH = 80;
const MAP_KEY_SLUG_MAX_LENGTH = 48;
const MAX_FILE_NAME_LENGTH = 120;
const MAX_MAPS = 200;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAP_NAME = 'Editor Map';
// Windows behandelt diese Namen als Geraete, unabhaengig von der Endung. Das
// Praefix editor_ schliesst sie heute schon aus; die Liste bleibt als
// Zweitsicherung, falls das Praefix je faellt.
const RESERVED_DEVICE_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Prueft eine Kartenkennung. Sie ist zugleich der Dateinamens-Stamm, deshalb
 * darf sie keinerlei Pfadbestandteile enthalten.
 * @param {unknown} mapKey
 * @returns {boolean}
 */
function isValidEditorMapKey(mapKey) {
    const candidate = String(mapKey ?? '');
    if (!MAP_KEY_PATTERN.test(candidate)) return false;
    return !RESERVED_DEVICE_NAMES.has(candidate.toLowerCase());
}

/**
 * Zweite, unabhaengige Schranke direkt vor dem Dateisystem: der fertige
 * Dateiname darf nur aus einer erlaubten Kennung plus einer der beiden
 * erwarteten Endungen bestehen.
 * @param {unknown} fileName
 * @returns {boolean}
 */
function isSafeEditorMapFileName(fileName) {
    const candidate = String(fileName ?? '');
    if (!candidate || candidate.length > MAX_FILE_NAME_LENGTH) return false;
    if (candidate !== candidate.trim()) return false;
    if (candidate.endsWith('.') || candidate.endsWith(' ')) return false;
    if (/[\\/:*?"<>|]/.test(candidate)) return false;
    if (candidate.includes('..')) return false;
    if (path.basename(candidate) !== candidate) return false;

    const suffix = [MAP_EDITOR_SUFFIX, MAP_RUNTIME_SUFFIX].find((entry) => candidate.endsWith(entry));
    if (!suffix) return false;
    return isValidEditorMapKey(candidate.slice(0, -suffix.length));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeEditorMapName(value) {
    if (typeof value !== 'string') return DEFAULT_MAP_NAME;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return DEFAULT_MAP_NAME;
    return normalized.slice(0, MAP_NAME_MAX_LENGTH);
}

/**
 * Spiegelt slugifyEditorMapKeyBase aus editor/js/EditorMapDiskFiles.js. Ein
 * Contract-Test haelt beide Seiten auf demselben Ergebnis.
 * @param {unknown} mapName
 * @returns {string}
 */
function toEditorMapKey(mapName) {
    const slug = String(sanitizeEditorMapName(mapName) || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAP_KEY_SLUG_MAX_LENGTH) || 'map';
    return `${MAP_KEY_PREFIX}${slug}`;
}

function parseJsonObject(text) {
    let value = null;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
}

/**
 * Dateispeicher fuer die im Karten-Editor gebauten Karten.
 *
 * Geschrieben wird ausschliesslich in den uebergebenen Ordner (im Desktop:
 * userData/maps). Der Hauptprozess rechnet nichts um - der Editor liefert die
 * beiden fertigen JSON-Dokumente, hier wird nur geprueft und geschrieben.
 *
 * @param {{
 *   getMapsDirectory: () => string,
 *   openFolder: (directory: string) => Promise<unknown>,
 *   renameFile?: (source: string, target: string) => void,
 *   statLink?: (filePath: string) => {isSymbolicLink: () => boolean, size?: number},
 * }} options
 */
function createEditorMapStore({ getMapsDirectory, openFolder, renameFile = renameSync, statLink = lstatSync }) {
    function resolveDirectory() {
        const directory = path.resolve(String(getMapsDirectory()));
        if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
        // Ist der Ordner selbst eine Verknuepfung, gilt sein echtes Ziel als
        // Grenze - sonst wuerde der Praefixvergleich unten ins Leere pruefen.
        return realpathSync(directory);
    }

    /**
     * Setzt einen Dateipfad zusammen und stellt sicher, dass er den Ordner
     * nicht verlaesst und auf keine Verknuepfung zeigt.
     * @param {string} directory
     * @param {string} mapKey
     * @param {string} suffix
     * @returns {{ok: boolean, filePath?: string, error?: string}}
     */
    function resolveMapFile(directory, mapKey, suffix) {
        const fileName = `${mapKey}${suffix}`;
        if (!isSafeEditorMapFileName(fileName)) return { ok: false, error: 'invalid_map_key' };

        const filePath = path.resolve(directory, fileName);
        if (filePath !== path.join(directory, fileName)) return { ok: false, error: 'invalid_map_key' };
        if (!filePath.startsWith(directory + path.sep)) return { ok: false, error: 'invalid_map_key' };

        try {
            if (statLink(filePath).isSymbolicLink()) return { ok: false, error: 'unsafe_target' };
        } catch {
            // Die Datei gibt es noch nicht - das ist der Normalfall beim Anlegen.
        }
        return { ok: true, filePath };
    }

    /**
     * Liest eine Kartendatei. Verknuepfungen werden uebersprungen statt
     * verfolgt, und eine ueberlange Datei wird gar nicht erst eingelesen -
     * sonst koennte ein fremder Eintrag im Ordner den Hauptprozess belasten
     * oder ihn auf eine Datei ausserhalb zeigen lassen.
     */
    function readMapFile(filePath) {
        try {
            const stats = statLink(filePath);
            if (stats.isSymbolicLink()) return null;
            if (Number(stats.size) > MAX_JSON_BYTES) return null;
            return parseJsonObject(readFileSync(filePath, 'utf8'));
        } catch {
            return null;
        }
    }

    /** @returns {Array<{mapKey: string, runtimeMap: object}>} */
    function readRuntimeEntries() {
        const directory = resolveDirectory();
        const entries = [];
        for (const fileName of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
            if (!fileName.endsWith(MAP_RUNTIME_SUFFIX)) continue;
            const mapKey = fileName.slice(0, -MAP_RUNTIME_SUFFIX.length);
            if (!isValidEditorMapKey(mapKey)) continue;
            const runtimeMap = readMapFile(path.join(directory, fileName));
            if (!runtimeMap) continue;
            entries.push({ mapKey, runtimeMap });
            if (entries.length >= MAX_MAPS) break;
        }
        return entries;
    }

    function listMaps() {
        const maps = readRuntimeEntries().map(({ mapKey, runtimeMap }) => ({
            mapKey,
            mapName: sanitizeEditorMapName(runtimeMap.name || mapKey),
        }));
        return { ok: true, maps };
    }

    /**
     * Liefert die fertigen Laufzeitkarten fuer das Spielfenster. Das Spiel
     * kennt eine Karte nur ueber seine Kartenliste; im Desktop gibt es keinen
     * Quellcode, in den der Editor sie eintragen koennte.
     */
    function readRuntimeMaps() {
        const maps = {};
        for (const { mapKey, runtimeMap } of readRuntimeEntries()) maps[mapKey] = runtimeMap;
        return { ok: true, maps };
    }

    /**
     * Sucht die Kennung zum Namen: gleicher Name ueberschreibt, eine Kopie oder
     * ein fremder Name bekommt den naechsten freien Zaehler.
     * @param {string} directory
     * @param {string} mapName
     * @param {boolean} saveAsCopy
     * @returns {{ok: boolean, mapKey?: string, overwritten?: boolean, error?: string}}
     */
    function resolveMapKey(directory, mapName, saveAsCopy) {
        const baseKey = toEditorMapKey(mapName);
        let candidateKey = baseKey;
        let index = 2;
        for (let attempt = 0; attempt <= MAX_MAPS; attempt += 1) {
            const target = resolveMapFile(directory, candidateKey, MAP_RUNTIME_SUFFIX);
            if (!target.ok) return { ok: false, error: target.error };
            const existing = existsSync(target.filePath) ? readMapFile(target.filePath) : null;
            if (!existing) return { ok: true, mapKey: candidateKey, overwritten: false };
            if (!saveAsCopy && sanitizeEditorMapName(existing.name || '') === mapName) {
                return { ok: true, mapKey: candidateKey, overwritten: true };
            }
            candidateKey = `${baseKey}_${index++}`;
        }
        return { ok: false, error: 'too_many_maps' };
    }

    /**
     * Schreibt beide Dateien zusammen: erst Nebendateien anlegen, dann
     * umbenennen. Bricht ein Schritt ab, bleibt der alte Stand stehen.
     */
    function writeBothFiles(entries) {
        const token = `${process.pid}-${randomUUID()}`;
        const staged = entries.map((entry) => ({
            ...entry,
            tempPath: `${entry.filePath}.${token}.tmp`,
            backupPath: `${entry.filePath}.${token}.bak`,
            hadOriginal: false,
            committed: false,
        }));

        try {
            for (const entry of staged) writeFileSync(entry.tempPath, entry.content, 'utf8');
            for (const entry of staged) {
                entry.hadOriginal = existsSync(entry.filePath);
                if (entry.hadOriginal) renameFile(entry.filePath, entry.backupPath);
            }
            for (const entry of staged) {
                renameFile(entry.tempPath, entry.filePath);
                entry.committed = true;
            }
            for (const entry of staged) {
                if (entry.hadOriginal) rmSync(entry.backupPath, { force: true });
            }
            return { ok: true };
        } catch (error) {
            for (const entry of [...staged].reverse()) {
                try {
                    rmSync(entry.tempPath, { force: true });
                    if (existsSync(entry.backupPath)) {
                        rmSync(entry.filePath, { force: true });
                        renameSync(entry.backupPath, entry.filePath);
                    } else if (entry.committed && !entry.hadOriginal) {
                        rmSync(entry.filePath, { force: true });
                    }
                } catch {
                    // Ein misslungenes Aufraeumen darf den Fehlerbericht nicht ersetzen.
                }
            }
            return { ok: false, error: String(error?.message || error) };
        }
    }

    /**
     * Die Kennung kommt immer aus dem Namen. Der Aufrufer kann sie bewusst
     * nicht vorgeben - sonst koennte eine Anfrage jede beliebige vorhandene
     * Karte ueberschreiben, egal wie sie heisst.
     *
     * @param {{mapName?: unknown, runtimeJson?: unknown, editorJson?: unknown, saveAsCopy?: unknown}} [request]
     */
    function saveMap({ mapName, runtimeJson, editorJson, saveAsCopy } = {}) {
        const runtimeText = typeof runtimeJson === 'string' ? runtimeJson : '';
        const editorText = typeof editorJson === 'string' ? editorJson : '';
        if (!runtimeText || !editorText) return { ok: false, error: 'empty_payload' };
        if (Buffer.byteLength(runtimeText, 'utf8') > MAX_JSON_BYTES) return { ok: false, error: 'payload_too_large' };
        if (Buffer.byteLength(editorText, 'utf8') > MAX_JSON_BYTES) return { ok: false, error: 'payload_too_large' };

        const runtimeMap = parseJsonObject(runtimeText);
        const editorDocument = parseJsonObject(editorText);
        if (!runtimeMap || !editorDocument) return { ok: false, error: 'invalid_json' };

        const resolvedName = sanitizeEditorMapName(mapName);
        const directory = resolveDirectory();
        const resolvedKey = resolveMapKey(directory, resolvedName, saveAsCopy === true);
        if (!resolvedKey.ok) return { ok: false, error: resolvedKey.error };

        const runtimeTarget = resolveMapFile(directory, resolvedKey.mapKey, MAP_RUNTIME_SUFFIX);
        if (!runtimeTarget.ok) return { ok: false, error: runtimeTarget.error };
        const editorTarget = resolveMapFile(directory, resolvedKey.mapKey, MAP_EDITOR_SUFFIX);
        if (!editorTarget.ok) return { ok: false, error: editorTarget.error };

        const written = writeBothFiles([
            { filePath: runtimeTarget.filePath, content: `${JSON.stringify(runtimeMap, null, 2)}\n` },
            { filePath: editorTarget.filePath, content: `${JSON.stringify(editorDocument, null, 2)}\n` },
        ]);
        if (!written.ok) return { ok: false, error: written.error };

        return {
            ok: true,
            mapKey: resolvedKey.mapKey,
            mapName: sanitizeEditorMapName(runtimeMap.name || resolvedName),
            overwritten: resolvedKey.overwritten === true,
            editorSchemaPath: editorTarget.filePath,
            runtimeMapPath: runtimeTarget.filePath,
        };
    }

    async function openMapsFolder() {
        const directory = resolveDirectory();
        await openFolder(directory);
        return { ok: true, folderPath: directory };
    }

    return { listMaps, readRuntimeMaps, saveMap, openMapsFolder };
}

module.exports = {
    MAP_EDITOR_SUFFIX,
    MAP_RUNTIME_SUFFIX,
    createEditorMapStore,
    isSafeEditorMapFileName,
    isValidEditorMapKey,
    sanitizeEditorMapName,
    toEditorMapKey,
};
