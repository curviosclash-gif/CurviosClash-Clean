// File side of per-map balancing: reads and writes data/balancing in the repository.
// Settings Studio, the F7 console (main process) and the balancing MCP share this store, and
// every write goes through MapBalancingContract validation, a backup copy and an atomic rename.
// The packaged app has no repository, so it never writes: values ship inside the game bundle.

const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const CONTRACT_RELATIVE_PATH = ['src', 'shared', 'contracts', 'MapBalancingContract.js'];
const MAP_PRESETS_RELATIVE_PATH = ['src', 'core', 'config', 'MapPresets.js'];
const BALANCING_RELATIVE_DIR = ['data', 'balancing'];

/**
 * Decides whether this process may write balancing files.
 * @param {{ isPackaged?: boolean, projectRoot?: string, env?: Record<string, string | undefined> }} [options]
 */
function resolveMapBalancingStoreRoot({ isPackaged = false, projectRoot = '', env = process.env } = {}) {
    if (isPackaged) {
        return { writable: false, root: '', reason: 'packaged', message: 'Kartenwerte sind nur in der Entwicklungsumgebung bearbeitbar.' };
    }
    const root = path.resolve(projectRoot || env.CURVIOS_MAP_BALANCING_ROOT || path.join(__dirname, '..'));
    const hasData = existsSync(path.join(root, ...BALANCING_RELATIVE_DIR, 'modes.json'));
    const hasContract = existsSync(path.join(root, ...CONTRACT_RELATIVE_PATH));
    if (!hasData || !hasContract) {
        return { writable: false, root, reason: 'no_repository', message: `Kein Repository mit data/balancing unter ${root}.` };
    }
    return { writable: true, root, reason: 'ok', message: '' };
}

async function writeFileAtomic(filePath, text) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tempPath, text, 'utf-8');
    try {
        await fs.rename(tempPath, filePath);
    } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}

async function readJsonOrNull(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
    }
}

function storeError(reason, message) {
    const error = new Error(message);
    error.reason = reason;
    return error;
}

/**
 * `root` holds the code (contract, map presets), `dataRoot` the data/balancing folder. Both are
 * the repository in practice; tests point `dataRoot` at a scratch copy.
 * @param {{ root: string, writable: boolean, dataRoot?: string, reason?: string, message?: string,
 *   backupDir?: string, now?: () => number }} options
 */
function createMapBalancingStore({ root, writable, dataRoot = process.env.CURVIOS_MAP_BALANCING_DATA_ROOT || '', reason = '', message = '', backupDir = '', now = () => Date.now() }) {
    const balancingDir = path.join(dataRoot || root || '', ...BALANCING_RELATIVE_DIR);
    const mapsDir = path.join(balancingDir, 'maps');
    const backupRoot = backupDir || path.join(dataRoot || root || '', 'tmp', 'balancing-backups');
    let contractPromise = null;
    let mapPresetsPromise = null;

    function assertAvailable() {
        if (!writable) throw storeError(reason || 'unavailable', message || 'Kartenwerte sind hier nicht bearbeitbar.');
    }

    function loadContract() {
        assertAvailable();
        contractPromise ||= import(pathToFileURL(path.join(root, ...CONTRACT_RELATIVE_PATH)).href);
        return contractPromise;
    }

    async function getMapFilePath(mapKey) {
        const contract = await loadContract();
        if (!contract.isValidMapBalancingMapKey(mapKey)) throw storeError('invalid_map_key', `Ungültiger Kartenschlüssel: ${mapKey}`);
        return path.join(mapsDir, `${mapKey}.json`);
    }

    async function listMaps() {
        assertAvailable();
        mapPresetsPromise ||= import(pathToFileURL(path.join(root, ...MAP_PRESETS_RELATIVE_PATH)).href);
        const { MAP_PRESETS } = await mapPresetsPromise;
        const files = existsSync(mapsDir) ? await fs.readdir(mapsDir) : [];
        const withFile = new Set(files.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)));
        return Object.entries(MAP_PRESETS || {})
            .filter(([key]) => !key.startsWith('editor_'))
            .map(([key, preset]) => ({ mapKey: key, name: String(preset?.name || key), hasMapFile: withFile.has(key) }));
    }

    async function readCatalog() {
        const contract = await loadContract();
        const modesDocument = await readJsonOrNull(path.join(balancingDir, 'modes.json'));
        const files = existsSync(mapsDir) ? (await fs.readdir(mapsDir)).filter((name) => name.endsWith('.json')) : [];
        const mapDocuments = await Promise.all(files.map((name) => readJsonOrNull(path.join(mapsDir, name))));
        return { contract, catalog: contract.createMapBalancingCatalog({ modesDocument, mapDocuments }) };
    }

    async function fileRevision(filePath) {
        try { return createHash('sha256').update(await fs.readFile(filePath)).digest('hex'); }
        catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
    }

    /**
     * `layer` previews an unsaved draft for this map instead of the file.
     * @param {{mapKey?: string, modePath?: string, layer?: unknown}} [options]
     */
    async function describe({ mapKey, modePath, layer = null } = {}) {
        const filePath = await getMapFilePath(String(mapKey || ''));
        const revision = await fileRevision(filePath);
        const { contract, catalog } = await readCatalog();
        if (layer) catalog.maps[mapKey] = contract.normalizeMapBalancingLayer(layer);
        return { ...contract.describeMapBalancing(catalog, { mapKey, modePath }), path: filePath, hasMapFile: existsSync(filePath), revision };
    }

    async function validateMapLayer(mapKey, layer) {
        const contract = await loadContract();
        return contract.validateMapBalancingMapDocument({ version: contract.MAP_BALANCING_CONTRACT_VERSION, mapKey, values: layer?.values });
    }

    async function backupFile(filePath, mapKey) {
        if (!existsSync(filePath)) return '';
        const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupRoot, `${mapKey}.${stamp}.json`);
        await fs.mkdir(backupRoot, { recursive: true });
        await fs.copyFile(filePath, backupPath);
        return backupPath;
    }

    /** Validates first; an invalid layer never reaches the disk. An empty layer removes the file. */
    async function saveMapLayer(mapKey, layer, expectedRevision = undefined) {
        const contract = await loadContract();
        const filePath = await getMapFilePath(String(mapKey || ''));
        const known = await listMaps();
        if (!known.some((entry) => entry.mapKey === mapKey)) throw storeError('unknown_map', `Unbekannte Karte: ${mapKey}`);
        const raw = { version: contract.MAP_BALANCING_CONTRACT_VERSION, mapKey, values: layer?.values };
        const validation = await validateMapLayer(mapKey, layer);
        if (!validation.ok) throw storeError('invalid_layer', validation.errors.join('; '));
        if (expectedRevision !== undefined && await fileRevision(filePath) !== expectedRevision) throw storeError('external_change', 'Kartendatei wurde inzwischen geändert. Vor dem Speichern neu laden und Änderungen vergleichen.');
        const backupPath = await backupFile(filePath, mapKey);
        const normalized = contract.normalizeMapBalancingLayer(raw);
        if (expectedRevision !== undefined && await fileRevision(filePath) !== expectedRevision) throw storeError('external_change', 'Kartendatei wurde während der Vorbereitung geändert. Neu laden und vergleichen.');
        if (Object.keys(normalized.values).length === 0) {
            await fs.rm(filePath, { force: true });
            return { path: filePath, backupPath, removed: true, layer: normalized, revision: 'missing' };
        }
        const content = contract.serializeMapBalancingMapDocument(mapKey, normalized);
        await writeFileAtomic(filePath, content);
        return { path: filePath, backupPath, removed: false, layer: normalized, revision: createHash('sha256').update(content).digest('hex') };
    }

    async function readMapLayer(mapKey) {
        const contract = await loadContract();
        const document = await readJsonOrNull(await getMapFilePath(String(mapKey || '')));
        return { values: contract.normalizeMapBalancingMapDocument(document).values };
    }

    async function setValue(mapKey, key, value) {
        const contract = await loadContract();
        return saveMapLayer(mapKey, contract.setMapBalancingLayerValue(await readMapLayer(mapKey), String(key), value));
    }

    async function resetValue(mapKey, key) {
        const contract = await loadContract();
        return saveMapLayer(mapKey, contract.resetMapBalancingLayerValue(await readMapLayer(mapKey), String(key)));
    }

    return Object.freeze({
        writable,
        root,
        dataRoot: dataRoot || root,
        reason,
        message,
        listMaps,
        describe,
        validateMapLayer,
        readMapLayer,
        saveMapLayer,
        setValue,
        resetValue,
    });
}

module.exports = {
    createMapBalancingStore,
    resolveMapBalancingStoreRoot,
};
