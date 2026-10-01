'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
    existsSync,
    renameSync,
    rmSync,
    writeFileSync,
} = require('node:fs');
const {
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rm,
} = require('node:fs/promises');

const VEHICLE_FILE_SUFFIX = '.vehicle.json';
// Vehicle Lab ids can reach 66 characters: 15 for "editor_vehicle_",
// a 48-character slug and a collision suffix through "-24".
const VEHICLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,65}$/;
const RESERVED_DEVICE_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
const MAX_VEHICLES = 200;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {object} EditorVehicleRequest
 * @property {string} [vehicleId]
 * @property {string} [vehicleName]
 * @property {string} [jsonText]
 */

function isValidVehicleId(vehicleId) {
    const candidate = String(vehicleId || '');
    return VEHICLE_ID_PATTERN.test(candidate) && !RESERVED_DEVICE_NAMES.has(candidate.toLowerCase());
}

/**
 * Bildet aus einem Fahrzeugnamen eine Kennung nach derselben Regel wie der
 * Katalog im Renderer: Umlaute werden in ihre Grundbuchstaben zerlegt, alles
 * Uebrige wird zu Bindestrichen.
 * @param {string} label
 * @returns {string}
 */
function toVehicleId(label) {
    const slug = String(label || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'vehicle';
    return `editor_vehicle_${slug}`;
}

/**
 * Erzeugt den Dateispeicher fuer im Vehicle Lab gebaute Fahrzeuge.
 *
 * Abgelegt wird im Nutzerdatenordner der Anwendung, nicht im Quellbaum: die
 * installierte App hat kein data/vehicles, und ein Werkzeug darf nicht in sein
 * eigenes Projektverzeichnis schreiben.
 *
 * @param {{getVehiclesDirectory: () => string}} options
 */
function createEditorVehicleStore({ getVehiclesDirectory, renameFile = renameSync }) {
    let mutationQueue = Promise.resolve();

    function enqueueMutation(operation) {
        const result = mutationQueue.then(operation);
        mutationQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    async function resolveDirectory() {
        const directory = path.resolve(String(getVehiclesDirectory()));
        await mkdir(directory, { recursive: true });
        return realpath(directory);
    }

    /**
     * Setzt einen Dateipfad zusammen und stellt sicher, dass er den
     * Fahrzeugordner nicht verlaesst.
     */
    async function resolveVehicleFile(vehicleId) {
        if (!isValidVehicleId(vehicleId)) return { ok: false, error: 'invalid_vehicle_id' };
        const directory = await resolveDirectory();
        const fileName = `${vehicleId}${VEHICLE_FILE_SUFFIX}`;
        const filePath = path.resolve(directory, fileName);
        if (filePath !== path.join(directory, fileName) || !filePath.startsWith(`${directory}${path.sep}`)) {
            return { ok: false, error: 'invalid_vehicle_id' };
        }
        try {
            const stats = await lstat(filePath);
            if (stats.isSymbolicLink()) return { ok: false, error: 'unsafe_target' };
            return { ok: true, filePath, exists: true };
        } catch (error) {
            if (error?.code !== 'ENOENT') return { ok: false, error: 'unsafe_target' };
        }
        return { ok: true, filePath, exists: false };
    }

    async function readVehicleFile(filePath) {
        try {
            const stats = await lstat(filePath);
            if (stats.isSymbolicLink() || Number(stats.size) > MAX_JSON_BYTES) return null;
            return JSON.parse(await readFile(filePath, 'utf8'));
        } catch {
            return null;
        }
    }

    function writeVehicleFile(filePath, content) {
        const token = `${process.pid}-${randomUUID()}`;
        const tempPath = `${filePath}.${token}.tmp`;
        const backupPath = `${filePath}.${token}.bak`;
        const hadOriginal = existsSync(filePath);
        try {
            writeFileSync(tempPath, content, 'utf8');
            if (hadOriginal) renameFile(filePath, backupPath);
            renameFile(tempPath, filePath);
            if (hadOriginal) rmSync(backupPath, { force: true });
            return { ok: true };
        } catch (error) {
            try { rmSync(tempPath, { force: true }); } catch { /* preserve the original failure */ }
            try {
                if (existsSync(backupPath)) {
                    rmSync(filePath, { force: true });
                    renameSync(backupPath, filePath);
                }
            } catch { /* preserve the original failure */ }
            return { ok: false, error: String(error?.message || error) };
        }
    }

    async function listVehicles() {
        const directory = await resolveDirectory();
        const vehicles = [];
        for (const fileName of await readdir(directory)) {
            if (!fileName.endsWith(VEHICLE_FILE_SUFFIX)) continue;
            const vehicleId = fileName.slice(0, -VEHICLE_FILE_SUFFIX.length);
            if (!isValidVehicleId(vehicleId)) continue;
            const config = await readVehicleFile(path.join(directory, fileName));
            if (!config) continue;
            vehicles.push({ id: vehicleId, label: String(config.label || vehicleId) });
            if (vehicles.length >= MAX_VEHICLES) break;
        }
        return { ok: true, vehicles };
    }

    /** @param {EditorVehicleRequest} [request] */
    async function getVehicle({ vehicleId } = {}) {
        const target = await resolveVehicleFile(vehicleId);
        if (!target.ok) return { ok: false, error: target.error };
        const { filePath } = target;
        if (!target.exists) return { ok: false, error: 'unknown_vehicle' };
        const config = await readVehicleFile(filePath);
        if (!config) return { ok: false, error: 'unreadable_vehicle' };
        return { ok: true, vehicleId, config };
    }

    /** @param {EditorVehicleRequest} [request] */
    function saveVehicle({ jsonText, vehicleName, vehicleId } = {}) {
        return enqueueMutation(async () => {
            const payload = String(jsonText || '');
            if (!payload) return { ok: false, error: 'empty_payload' };
            if (Buffer.byteLength(payload, 'utf8') > MAX_JSON_BYTES) return { ok: false, error: 'payload_too_large' };
            let config = null;
            try {
                config = JSON.parse(payload);
            } catch {
                return { ok: false, error: 'invalid_json' };
            }
            const requestedId = String(vehicleId ?? '');
            const resolvedId = requestedId || toVehicleId(vehicleName || config?.label);
            const target = await resolveVehicleFile(resolvedId);
            if (!target.ok) return { ok: false, error: target.error };
            const { filePath } = target;
            const written = writeVehicleFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
            if (!written.ok) return written;
            return { ok: true, vehicleId: resolvedId, filePath };
        });
    }

    /** @param {EditorVehicleRequest} [request] */
    function renameVehicle({ vehicleId, vehicleName } = {}) {
        return enqueueMutation(async () => {
            const source = await resolveVehicleFile(vehicleId);
            if (!source.ok) return { ok: false, error: source.error };
            const { filePath: sourcePath } = source;
            if (!source.exists) return { ok: false, error: 'unknown_vehicle' };
            const config = await readVehicleFile(sourcePath);
            if (!config) return { ok: false, error: 'unreadable_vehicle' };
            const nextId = toVehicleId(vehicleName);
            const target = await resolveVehicleFile(nextId);
            if (!target.ok) return { ok: false, error: target.error };
            const { filePath: targetPath } = target;
            if (targetPath !== sourcePath && target.exists) return { ok: false, error: 'name_taken' };
            config.label = String(vehicleName || config.label || nextId);
            const written = writeVehicleFile(sourcePath, `${JSON.stringify(config, null, 2)}\n`);
            if (!written.ok) return written;
            if (targetPath !== sourcePath) renameSync(sourcePath, targetPath);
            return { ok: true, vehicleId: nextId };
        });
    }

    /** @param {EditorVehicleRequest} [request] */
    function deleteVehicle({ vehicleId } = {}) {
        return enqueueMutation(async () => {
            const target = await resolveVehicleFile(vehicleId);
            if (!target.ok) return { ok: false, error: target.error };
            const { filePath } = target;
            if (!target.exists) return { ok: false, error: 'unknown_vehicle' };
            await rm(filePath, { force: true });
            return { ok: true, vehicleId };
        });
    }

    return { listVehicles, getVehicle, saveVehicle, renameVehicle, deleteVehicle };
}

module.exports = {
    VEHICLE_FILE_SUFFIX,
    createEditorVehicleStore,
    isValidVehicleId,
    toVehicleId,
};
