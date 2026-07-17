import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createPreviewLocalMutationDisabledResponse,
    shouldBlockPreviewLocalMutation,
} from './previewLocalApiGuard.js';
import { parseMapJSON, toArenaMapDefinition } from '../../src/entities/MapSchema.js';
import {
    EDITOR_API_ROUTES,
    EDITOR_DATA_PATHS,
    EDITOR_DISK_IO_CONTRACT_VERSION,
} from '../../src/shared/contracts/EditorPathContract.js';
import { resolveArtifactVersionState } from '../../src/shared/contracts/ArtifactVersionMigrationContract.js';
import {
    estimateVehicleLabHitboxRadius,
    normalizeVehicleLabConfig,
    VEHICLE_LAB_GAME_VEHICLE_IDS,
} from '../../src/shared/contracts/VehicleLabConfigContract.js';
import {
    createEditorAuthoringDocument,
    parseEditorAuthoringDocument,
} from '../../editor/js/EditorAuthoringDocument.js';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const GENERATED_EDITOR_MAP_KEY_PREFIX = 'editor_';
const DEFAULT_EDITOR_DISK_MAP_NAME = 'Editor Map';
const EDITOR_MAP_NAME_MAX_LENGTH = 80;
const EDITOR_MAP_DIR = path.resolve(__dirname, EDITOR_DATA_PATHS.MAPS_DIR);
const GENERATED_LOCAL_MAPS_MODULE_PATH = path.resolve(__dirname, EDITOR_DATA_PATHS.GENERATED_LOCAL_MAPS_MODULE);
const EDITOR_JSON_SUFFIX = '.editor.json';
const RUNTIME_JSON_SUFFIX = '.runtime.json';

const LEGACY_EDITOR_PLAYTEST_SCALE = 35;
const LEGACY_EDITOR_LARGE_DIM_THRESHOLD = 500;
const RUNTIME_MAP_SCALE = 3;

const GENERATED_EDITOR_VEHICLE_KEY_PREFIX = 'editor_vehicle_';
const GAME_VEHICLE_ID_SET = new Set(VEHICLE_LAB_GAME_VEHICLE_IDS);
const DEFAULT_EDITOR_VEHICLE_NAME = 'Custom Vehicle';
const VEHICLE_NAME_MAX_LENGTH = 80;
const VEHICLE_CONFIG_DIR = path.resolve(__dirname, EDITOR_DATA_PATHS.VEHICLES_DIR);
const GENERATED_VEHICLE_CONFIGS_MODULE_PATH = path.resolve(__dirname, EDITOR_DATA_PATHS.GENERATED_VEHICLE_CONFIGS_MODULE);
const VEHICLE_CONFIG_SUFFIX = '.vehicle.json';
const EDITOR_DISK_IO_VERSION_FIELDS = Object.freeze(['contractVersion']);
const EDITOR_DISK_IO_SUPPORTED_VERSIONS = Object.freeze([EDITOR_DISK_IO_CONTRACT_VERSION]);

function hasExplicitContractVersion(payload) {
    return !!payload
        && typeof payload === 'object'
        && Object.prototype.hasOwnProperty.call(payload, 'contractVersion');
}

function resolveEditorDiskIoVersionState(payload, allowMissingVersion = true) {
    return resolveArtifactVersionState(payload && typeof payload === 'object' ? payload : {}, {
        artifactType: 'editor-disk-io',
        versionFields: EDITOR_DISK_IO_VERSION_FIELDS,
        supportedVersions: EDITOR_DISK_IO_SUPPORTED_VERSIONS,
        currentVersion: EDITOR_DISK_IO_CONTRACT_VERSION,
        allowMissingVersion,
    });
}

function withEditorDiskIoContract(payload = {}) {
    return {
        contractVersion: EDITOR_DISK_IO_CONTRACT_VERSION,
        ...payload,
    };
}
function createJsonResponse(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
}

function maybeBlockPreviewLocalMutation({ isPreviewServer = false, reqPath = '', res } = {}) {
    if (!shouldBlockPreviewLocalMutation({ isPreviewServer })) return false;
    const response = createPreviewLocalMutationDisabledResponse({ route: reqPath });
    createJsonResponse(res, response.statusCode, response.payload);
    return true;
}

function readRequestBody(req, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error('Request body too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });

        req.on('error', reject);
    });
}

function readVideoBody(req, maxBytes = 500 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error('Video too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            resolve(Buffer.concat(chunks));
        });

        req.on('error', reject);
    });
}

function getEditorDiskConversionScale(mapDocument) {
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

function sanitizeMapName(value) {
    if (typeof value !== 'string') return DEFAULT_EDITOR_DISK_MAP_NAME;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return DEFAULT_EDITOR_DISK_MAP_NAME;
    return normalized.slice(0, EDITOR_MAP_NAME_MAX_LENGTH);
}

function slugifyForKey(value, fallback = 'item', maxLength = 48) {
    const ascii = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const slug = ascii
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength);

    return slug || fallback;
}

function slugifyMapNameToKeyBase(mapName) {
    const safeSlug = slugifyForKey(mapName, 'map', 48);
    return `${GENERATED_EDITOR_MAP_KEY_PREFIX}${safeSlug}`;
}

function sanitizeVehicleName(value) {
    if (typeof value !== 'string') return DEFAULT_EDITOR_VEHICLE_NAME;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return DEFAULT_EDITOR_VEHICLE_NAME;
    return normalized.slice(0, VEHICLE_NAME_MAX_LENGTH);
}

function slugifyVehicleNameToKeyBase(vehicleName) {
    const safeSlug = slugifyForKey(vehicleName, 'vehicle', 48);
    return `${GENERATED_EDITOR_VEHICLE_KEY_PREFIX}${safeSlug}`;
}

function getEditorSchemaPathForKey(mapKey) {
    return path.resolve(EDITOR_MAP_DIR, `${mapKey}${EDITOR_JSON_SUFFIX}`);
}

function getRuntimeMapPathForKey(mapKey) {
    return path.resolve(EDITOR_MAP_DIR, `${mapKey}${RUNTIME_JSON_SUFFIX}`);
}

function safeReadJson(filePath) {
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function getExistingRuntimeMapByKey(mapKey) {
    const filePath = getRuntimeMapPathForKey(mapKey);
    if (!existsSync(filePath)) return null;
    return safeReadJson(filePath);
}

function resolveGeneratedMapKey(mapName) {
    const sanitizedName = sanitizeMapName(mapName);
    const baseKey = slugifyMapNameToKeyBase(sanitizedName);

    let candidateKey = baseKey;
    let index = 2;

    while (true) {
        const existing = getExistingRuntimeMapByKey(candidateKey);
        if (!existing) {
            return { mapKey: candidateKey, overwritten: false, mapName: sanitizedName };
        }

        const existingName = sanitizeMapName(existing?.name || '');
        if (existingName === sanitizedName) {
            return { mapKey: candidateKey, overwritten: true, mapName: sanitizedName };
        }

        candidateKey = `${baseKey}_${index++}`;
    }
}

function loadGeneratedRuntimeMapsFromDisk() {
    if (!existsSync(EDITOR_MAP_DIR)) {
        return {};
    }

    const files = readdirSync(EDITOR_MAP_DIR)
        .filter((fileName) => fileName.endsWith(RUNTIME_JSON_SUFFIX))
        .sort((a, b) => a.localeCompare(b));

    const maps = {};
    for (const fileName of files) {
        const mapKey = fileName.slice(0, -RUNTIME_JSON_SUFFIX.length);
        if (!mapKey.startsWith(GENERATED_EDITOR_MAP_KEY_PREFIX)) continue;

        const runtimeMap = safeReadJson(path.resolve(EDITOR_MAP_DIR, fileName));
        if (!runtimeMap || typeof runtimeMap !== 'object') continue;
        maps[mapKey] = runtimeMap;
    }

    return maps;
}

function writeGeneratedLocalMapsModule() {
    const payload = loadGeneratedRuntimeMapsFromDisk();

    const fileContent = `// Auto-generated by the editor disk-save API. Do not edit manually.\n` +
        `export const GENERATED_LOCAL_MAPS = ${JSON.stringify(payload, null, 2)};\n\n` +
        `export default GENERATED_LOCAL_MAPS;\n`;

    writeFileSync(GENERATED_LOCAL_MAPS_MODULE_PATH, fileContent, 'utf-8');
}

function saveEditorMapToDisk({ jsonText, mapName, editorDocument = null }) {
    const parsed = parseMapJSON(jsonText);
    const resolved = resolveGeneratedMapKey(mapName);
    const conversionScale = getEditorDiskConversionScale(parsed.map);
    const converted = toArenaMapDefinition(parsed.map, {
        mapScale: conversionScale,
        name: resolved.mapName,
    });

    const editorSchemaPath = getEditorSchemaPathForKey(resolved.mapKey);
    const runtimeMapPath = getRuntimeMapPathForKey(resolved.mapKey);

    mkdirSync(EDITOR_MAP_DIR, { recursive: true });
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
    writeFileSync(editorSchemaPath, JSON.stringify(authoringDocument, null, 2), 'utf-8');
    writeFileSync(runtimeMapPath, JSON.stringify(converted.map, null, 2), 'utf-8');
    writeGeneratedLocalMapsModule();

    return {
        mapKey: resolved.mapKey,
        mapName: converted.map?.name || resolved.mapName,
        overwritten: resolved.overwritten,
        editorSchemaPath: path.relative(__dirname, editorSchemaPath).replace(/\\/g, '/'),
        runtimeMapPath: path.relative(__dirname, runtimeMapPath).replace(/\\/g, '/'),
        generatedModulePath: path.relative(__dirname, GENERATED_LOCAL_MAPS_MODULE_PATH).replace(/\\/g, '/'),
        warnings: [...(parsed.warnings || []), ...(converted.warnings || [])],
    };
}

function getVehicleConfigPathForKey(vehicleId) {
    return path.resolve(VEHICLE_CONFIG_DIR, `${vehicleId}${VEHICLE_CONFIG_SUFFIX}`);
}

function getExistingVehicleConfigByKey(vehicleId) {
    const filePath = getVehicleConfigPathForKey(vehicleId);
    if (!existsSync(filePath)) return null;
    return safeReadJson(filePath);
}

function sanitizeVehicleConfig(raw, fallbackName) {
    const result = normalizeVehicleLabConfig(raw, {
        fallbackLabel: sanitizeVehicleName(fallbackName),
        requireParts: true,
    });
    if (!result.ok) throw new Error(result.errors.join(' '));
    return result.config;
}

function resolveGeneratedVehicleKey(vehicleName) {
    const sanitizedName = sanitizeVehicleName(vehicleName);
    const baseKey = slugifyVehicleNameToKeyBase(sanitizedName);

    let candidateKey = baseKey;
    let index = 2;

    while (true) {
        const existing = getExistingVehicleConfigByKey(candidateKey);
        if (!existing) {
            return { vehicleId: candidateKey, overwritten: false, vehicleName: sanitizedName };
        }

        const existingName = sanitizeVehicleName(existing?.label || existing?.name || '');
        if (existingName === sanitizedName) {
            return { vehicleId: candidateKey, overwritten: true, vehicleName: sanitizedName };
        }

        candidateKey = `${baseKey}_${index++}`;
    }
}

function loadGeneratedVehicleConfigsFromDisk() {
    if (!existsSync(VEHICLE_CONFIG_DIR)) {
        return [];
    }

    const files = readdirSync(VEHICLE_CONFIG_DIR)
        .filter((fileName) => fileName.endsWith(VEHICLE_CONFIG_SUFFIX))
        .sort((a, b) => a.localeCompare(b));

    const vehicles = [];
    for (const fileName of files) {
        const vehicleId = fileName.slice(0, -VEHICLE_CONFIG_SUFFIX.length);
        if (!vehicleId.startsWith(GENERATED_EDITOR_VEHICLE_KEY_PREFIX) && !GAME_VEHICLE_ID_SET.has(vehicleId)) continue;

        const configRaw = safeReadJson(path.resolve(VEHICLE_CONFIG_DIR, fileName));
        if (!configRaw || typeof configRaw !== 'object') continue;

        const config = sanitizeVehicleConfig(configRaw, DEFAULT_EDITOR_VEHICLE_NAME);
        vehicles.push({
            id: vehicleId,
            label: String(config.label || vehicleId),
            hitbox: { radius: estimateVehicleLabHitboxRadius(config) },
            config
        });
    }

    return vehicles;
}

function isGeneratedVehicleId(vehicleId) {
    return typeof vehicleId === 'string' && /^editor_vehicle_[a-z0-9-]+$/.test(vehicleId);
}

function ensureGeneratedVehicleIdEditable(vehicleId) {
    if (!isGeneratedVehicleId(vehicleId)) {
        throw new Error('Standard vehicles are read-only and cannot be modified.');
    }
}

function ensureVehicleIdLoadable(vehicleId) {
    if (!isGeneratedVehicleId(vehicleId) && !GAME_VEHICLE_ID_SET.has(vehicleId)) {
        throw new Error('Vehicle id is not editable.');
    }
}

function listSavedVehicleConfigs() {
    return loadGeneratedVehicleConfigsFromDisk().filter((entry) => isGeneratedVehicleId(entry.id)).map((entry) => ({
        id: entry.id,
        label: entry.label,
        readOnly: false
    }));
}

function getVehicleConfigFromDisk({ vehicleId }) {
    ensureVehicleIdLoadable(vehicleId);

    const sourcePath = getVehicleConfigPathForKey(vehicleId);
    if (!existsSync(sourcePath)) {
        throw new Error(`Vehicle "${vehicleId}" was not found.`);
    }

    const configRaw = safeReadJson(sourcePath);
    if (!configRaw || typeof configRaw !== 'object') {
        throw new Error(`Vehicle "${vehicleId}" config is invalid.`);
    }

    const config = sanitizeVehicleConfig(configRaw, DEFAULT_EDITOR_VEHICLE_NAME);
    return {
        vehicleId,
        vehicleLabel: config.label,
        config
    };
}

function writeGeneratedVehicleConfigsModule() {
    const payload = loadGeneratedVehicleConfigsFromDisk();
    const fileContent = `// Auto-generated by the vehicle editor disk-save API. Do not edit manually.\n` +
        `export const GENERATED_VEHICLE_CONFIGS = ${JSON.stringify(payload, null, 2)};\n\n` +
        `export default GENERATED_VEHICLE_CONFIGS;\n`;

    writeFileSync(GENERATED_VEHICLE_CONFIGS_MODULE_PATH, fileContent, 'utf-8');
}

function saveVehicleConfigToDisk({ jsonText, vehicleName, vehicleId = '' }) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (error) {
        throw new Error(`Invalid vehicle JSON: ${error.message}`);
    }

    const requestedVehicleId = String(vehicleId || '').trim().toLowerCase();
    const isGameVehicle = GAME_VEHICLE_ID_SET.has(requestedVehicleId);
    if (requestedVehicleId && !isGameVehicle && !isGeneratedVehicleId(requestedVehicleId)) {
        throw new Error('Vehicle id is not editable.');
    }
    const resolved = isGameVehicle
        ? {
            vehicleId: requestedVehicleId,
            overwritten: existsSync(getVehicleConfigPathForKey(requestedVehicleId)),
            vehicleName: sanitizeVehicleName(vehicleName),
        }
        : resolveGeneratedVehicleKey(vehicleName);
    const config = sanitizeVehicleConfig(parsed, resolved.vehicleName);
    config.label = resolved.vehicleName;
    if (isGameVehicle) config.baseVehicleId = requestedVehicleId;

    const vehicleConfigPath = getVehicleConfigPathForKey(resolved.vehicleId);
    mkdirSync(VEHICLE_CONFIG_DIR, { recursive: true });
    writeFileSync(vehicleConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    writeGeneratedVehicleConfigsModule();

    return {
        vehicleId: resolved.vehicleId,
        vehicleLabel: config.label,
        overwritten: resolved.overwritten,
        vehicleConfigPath: path.relative(__dirname, vehicleConfigPath).replace(/\\/g, '/'),
        generatedModulePath: path.relative(__dirname, GENERATED_VEHICLE_CONFIGS_MODULE_PATH).replace(/\\/g, '/'),
    };
}

function renameVehicleConfigOnDisk({ vehicleId, vehicleName }) {
    ensureGeneratedVehicleIdEditable(vehicleId);

    const sourcePath = getVehicleConfigPathForKey(vehicleId);
    if (!existsSync(sourcePath)) {
        throw new Error(`Vehicle "${vehicleId}" was not found.`);
    }

    const sourceConfig = safeReadJson(sourcePath);
    if (!sourceConfig || typeof sourceConfig !== 'object') {
        throw new Error(`Vehicle "${vehicleId}" config is invalid.`);
    }

    const saveResult = saveVehicleConfigToDisk({
        jsonText: JSON.stringify(sourceConfig),
        vehicleName
    });

    if (saveResult.vehicleId !== vehicleId) {
        rmSync(sourcePath, { force: true });
        writeGeneratedVehicleConfigsModule();
    }

    return {
        previousVehicleId: vehicleId,
        ...saveResult
    };
}

function deleteVehicleConfigFromDisk({ vehicleId }) {
    ensureGeneratedVehicleIdEditable(vehicleId);

    const sourcePath = getVehicleConfigPathForKey(vehicleId);
    if (!existsSync(sourcePath)) {
        throw new Error(`Vehicle "${vehicleId}" was not found.`);
    }

    rmSync(sourcePath, { force: true });
    writeGeneratedVehicleConfigsModule();

    return {
        vehicleId,
        deleted: true,
        generatedModulePath: path.relative(__dirname, GENERATED_VEHICLE_CONFIGS_MODULE_PATH).replace(/\\/g, '/'),
    };
}

export function editorDiskSaveApiPlugin() {
    const mapRoutePath = EDITOR_API_ROUTES.SAVE_MAP_DISK;
    const vehicleRoutePath = EDITOR_API_ROUTES.SAVE_VEHICLE_DISK;
    const listVehiclesRoutePath = EDITOR_API_ROUTES.LIST_VEHICLES_DISK;
    const getVehicleRoutePath = EDITOR_API_ROUTES.GET_VEHICLE_DISK;
    const renameVehicleRoutePath = EDITOR_API_ROUTES.RENAME_VEHICLE_DISK;
    const deleteVehicleRoutePath = EDITOR_API_ROUTES.DELETE_VEHICLE_DISK;
    const videoRoutePath = EDITOR_API_ROUTES.SAVE_VIDEO_DISK;

    const registerMiddleware = (middlewares, { isPreviewServer = false } = {}) => {
        middlewares.use(async (req, res, next) => {
            const reqPath = String(req.url || '').split('?')[0];
            const isMapSave = req.method === 'POST' && reqPath === mapRoutePath;
            const isVehicleSave = req.method === 'POST' && reqPath === vehicleRoutePath;
            const isVehicleList = req.method === 'GET' && reqPath === listVehiclesRoutePath;
            const isVehicleGet = req.method === 'GET' && reqPath === getVehicleRoutePath;
            const isVehicleRename = req.method === 'POST' && reqPath === renameVehicleRoutePath;
            const isVehicleDelete = req.method === 'POST' && reqPath === deleteVehicleRoutePath;
            const isVideoSave = req.method === 'POST' && reqPath === videoRoutePath;

            if (!isMapSave && !isVehicleSave && !isVehicleList && !isVehicleGet && !isVehicleRename && !isVehicleDelete && !isVideoSave) {
                next();
                return;
            }

            const isLocalMutation = isMapSave || isVehicleSave || isVehicleRename || isVehicleDelete || isVideoSave;
            if (isLocalMutation && maybeBlockPreviewLocalMutation({ isPreviewServer, reqPath, res })) {
                return;
            }

            try {
                if (isVideoSave) {
                    const fileNameHeader = req.headers['x-file-name'];
                    if (!fileNameHeader) {
                        createJsonResponse(res, 400, withEditorDiskIoContract({ ok: false, error: 'x-file-name header required' }));
                        return;
                    }

                    const safeName = String(fileNameHeader).replace(/[^a-zA-Z0-9.\-_/]/g, '');
                    const allowedVideoRoot = path.resolve(__dirname, 'videos');
                    const outPath = path.resolve(allowedVideoRoot, safeName);

                    if (!outPath.startsWith(allowedVideoRoot + path.sep)) {
                        createJsonResponse(res, 403, withEditorDiskIoContract({ ok: false, error: 'Path traversal blocked. Video must be saved inside videos directory.' }));
                        return;
                    }

                    const videoDir = path.dirname(outPath);

                    if (!existsSync(videoDir)) {
                        mkdirSync(videoDir, { recursive: true });
                    }

                    const buffer = await readVideoBody(req);
                    writeFileSync(outPath, buffer);
                    createJsonResponse(res, 200, withEditorDiskIoContract({ ok: true, file: path.relative(__dirname, outPath).replace(/\\/g, '/') }));
                    return;
                }
                if (isVehicleList) {
                    createJsonResponse(res, 200, {
                        ...withEditorDiskIoContract({ ok: true }),
                        vehicles: listSavedVehicleConfigs(),
                    });
                    return;
                }
                if (isVehicleGet) {
                    const urlObj = new URL(req.url || '', 'http://localhost');
                    const vehicleId = String(urlObj.searchParams.get('vehicleId') || '').trim();
                    if (!vehicleId) {
                        createJsonResponse(res, 400, withEditorDiskIoContract({ ok: false, error: 'vehicleId is required.' }));
                        return;
                    }
                    createJsonResponse(res, 200, {
                        ...withEditorDiskIoContract({ ok: true }),
                        ...getVehicleConfigFromDisk({ vehicleId })
                    });
                    return;
                }

                const rawBody = await readRequestBody(req);
                const body = JSON.parse(rawBody || '{}');
                const requestVersionState = resolveEditorDiskIoVersionState(body, true);
                if (hasExplicitContractVersion(body) && (
                    requestVersionState.shouldReject
                    || requestVersionState.resolvedVersion === null
                )) {
                    createJsonResponse(res, 400, withEditorDiskIoContract({
                        ok: false,
                        error: 'Unsupported editor disk contractVersion.',
                    }));
                    return;
                }
                const jsonText = typeof body?.jsonText === 'string' ? body.jsonText : '';
                const editorDocument = body?.editorDocument && typeof body.editorDocument === 'object'
                    ? body.editorDocument
                    : null;
                const mapName = typeof body?.mapName === 'string' ? body.mapName : '';
                const vehicleName = typeof body?.vehicleName === 'string' ? body.vehicleName : '';
                const vehicleId = typeof body?.vehicleId === 'string' ? body.vehicleId.trim() : '';

                if ((isMapSave || isVehicleSave) && !jsonText.trim()) {
                    createJsonResponse(res, 400, withEditorDiskIoContract({ ok: false, error: 'jsonText is required.' }));
                    return;
                }

                const result = isMapSave
                    ? saveEditorMapToDisk({ jsonText, mapName, editorDocument })
                    : isVehicleSave
                        ? saveVehicleConfigToDisk({ jsonText, vehicleName, vehicleId })
                        : isVehicleRename
                            ? renameVehicleConfigOnDisk({ vehicleId, vehicleName })
                            : deleteVehicleConfigFromDisk({ vehicleId });
                createJsonResponse(res, 200, withEditorDiskIoContract({ ok: true, ...result }));
            } catch (error) {
                createJsonResponse(res, 500, {
                    ...withEditorDiskIoContract({ ok: false }),
                    error: error?.message || 'Unknown disk save error.',
                });
            }
        });
    };

    return {
        name: 'editor-disk-save-api',
        configureServer(server) {
            registerMiddleware(server.middlewares);
        },
        configurePreviewServer(server) {
            registerMiddleware(server.middlewares, { isPreviewServer: true });
        },
    };
}
