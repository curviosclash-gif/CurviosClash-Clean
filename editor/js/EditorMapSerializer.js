import * as THREE from 'three';
import { createMapDocument, parseMapJSON } from '../../src/entities/MapSchema.js';

function cloneSerializable(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneSerializable(entry));
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const result = {};
    Object.entries(value).forEach(([key, entry]) => {
        const clonedEntry = cloneSerializable(entry);
        if (clonedEntry !== undefined) {
            result[key] = clonedEntry;
        }
    });
    return result;
}

function readManagerMapMetadata(manager) {
    const source = manager?.mapDocumentMeta && typeof manager.mapDocumentMeta === 'object'
        ? manager.mapDocumentMeta
        : {};
    const metadata = {};

    if (typeof source.glbModel === 'string' && source.glbModel) {
        metadata.glbModel = source.glbModel;
    }
    if (typeof source.glbColliderMode === 'string' && source.glbColliderMode) {
        metadata.glbColliderMode = source.glbColliderMode;
    }
    if (source.preferAuthoredPortals === true) {
        metadata.preferAuthoredPortals = true;
    }
    if (typeof source.portalMode === 'string' && source.portalMode) {
        metadata.portalMode = source.portalMode;
    }
    if (typeof source.itemSpawnMode === 'string' && source.itemSpawnMode) {
        metadata.itemSpawnMode = source.itemSpawnMode;
    }
    if (Array.isArray(source.portalLevels)) {
        metadata.portalLevels = cloneSerializable(source.portalLevels) || [];
    }
    if (Array.isArray(source.gates)) {
        metadata.gates = cloneSerializable(source.gates) || [];
    }
    if (source.parcours && typeof source.parcours === 'object') {
        metadata.parcours = cloneSerializable(source.parcours) || {};
    }

    return metadata;
}

function extractMapMetadata(data) {
    if (!data || typeof data !== 'object') return {};

    const metadata = {};
    if (typeof data.glbModel === 'string' && data.glbModel) {
        metadata.glbModel = data.glbModel;
    }
    if (typeof data.glbColliderMode === 'string' && data.glbColliderMode) {
        metadata.glbColliderMode = data.glbColliderMode;
    }
    if (data.preferAuthoredPortals === true) {
        metadata.preferAuthoredPortals = true;
    }
    if (typeof data.portalMode === 'string' && data.portalMode) {
        metadata.portalMode = data.portalMode;
    }
    if (typeof data.itemSpawnMode === 'string' && data.itemSpawnMode) {
        metadata.itemSpawnMode = data.itemSpawnMode;
    }
    if (Array.isArray(data.portalLevels) && data.portalLevels.length > 0) {
        metadata.portalLevels = cloneSerializable(data.portalLevels) || [];
    }
    if (Array.isArray(data.gates) && data.gates.length > 0) {
        metadata.gates = cloneSerializable(data.gates) || [];
    }
    if (data.parcours && typeof data.parcours === 'object') {
        metadata.parcours = cloneSerializable(data.parcours) || {};
    }
    return metadata;
}

function dedupeWarnings(warnings) {
    const result = [];
    const seen = new Set();
    for (const warning of Array.isArray(warnings) ? warnings : []) {
        if (typeof warning !== 'string') continue;
        const normalized = warning.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function storeSchemaWarnings(manager, warnings) {
    if (!manager || typeof manager !== 'object') return;
    manager.lastSchemaWarnings = dedupeWarnings(warnings);
}

export function generateJSONExport(manager, arenaSize) {
    const payload = {
        ...readManagerMapMetadata(manager),
        arenaSize,
        tunnels: [],
        hardBlocks: [],
        foamBlocks: [],
        botSpawns: [],
        portals: [],
        items: [],
        aircraft: [],
        playerSpawn: { x: -800, y: arenaSize.height * 0.55, z: 0 },
    };

    const editorCheckpoints = [];
    let foundPlayerSpawn = false;

    manager.core.objectsContainer.children.forEach((obj) => {
        const u = obj.userData || {};
        const p = obj.position;
        const ry = obj.rotation.y || 0;

        if (u.type === 'tunnel') {
            manager.syncTunnelEndpointsFromMesh(obj);
        }

        if (u.type === 'hard') {
            payload.hardBlocks.push({
                id: u.id,
                x: p.x, y: p.y, z: p.z,
                width: u.sizeX,
                depth: u.sizeZ,
                height: u.sizeY,
                size: u.sizeInfo,
                rotateY: ry
            });
        }
        else if (u.type === 'foam') {
            payload.foamBlocks.push({
                id: u.id,
                x: p.x, y: p.y, z: p.z,
                width: u.sizeX,
                depth: u.sizeZ,
                height: u.sizeY,
                size: u.sizeInfo,
                rotateY: ry
            });
        }
        else if (u.type === 'portal') {
            const portalEntry = { id: u.id, x: p.x, y: p.y, z: p.z, radius: u.sizeInfo };
            if (typeof u.subType === 'string' && u.subType) {
                portalEntry.model = u.subType;
            }
            payload.portals.push(portalEntry);
        }
        else if (u.type === 'spawn') {
            if (u.subType === 'player') {
                payload.playerSpawn = { id: u.id, x: p.x, y: p.y, z: p.z };
                foundPlayerSpawn = true;
            } else {
                payload.botSpawns.push({ id: u.id, x: p.x, y: p.y, z: p.z });
            }
        }
        else if (u.type === 'item') {
            const itemEntry = { id: u.id, type: u.subType, x: p.x, y: p.y, z: p.z, rotateY: ry };
            if (typeof u.model === 'string' && u.model) {
                itemEntry.model = u.model;
            }
            if (typeof u.pickupType === 'string' && u.pickupType) {
                itemEntry.pickupType = u.pickupType;
            }
            if (Number.isFinite(Number(u.weight))) {
                itemEntry.weight = Number(u.weight);
            }
            payload.items.push(itemEntry);
        }
        else if (u.type === 'aircraft') {
            payload.aircraft.push({
                id: u.id,
                jetId: u.subType,
                x: p.x, y: p.y, z: p.z,
                scale: u.modelScale || 50,
                rotateY: ry
            });
        }
        else if (u.type === 'tunnel') {
            if (u.pointA && u.pointB) {
                const tunnelEntry = {
                    id: u.id,
                    ax: u.pointA.x, ay: u.pointA.y, az: u.pointA.z,
                    bx: u.pointB.x, by: u.pointB.y, bz: u.pointB.z,
                    radius: u.radius
                };
                if (typeof u.subType === 'string' && u.subType) {
                    tunnelEntry.model = u.subType;
                }
                payload.tunnels.push(tunnelEntry);
            }
        }
        else if (u.type === 'checkpoint') {
            editorCheckpoints.push({
                id: u.id,
                type: u.subType || 'gate',
                pos: [p.x, p.y, p.z],
                radius: u.cpRadius || 5.5,
                forward: u.cpForward || [1, 0, 0],
                ...(u.aliasOf ? { aliasOf: u.aliasOf } : {})
            });
        }
    });

    // Build parcours block from placed checkpoints
    if (editorCheckpoints.length > 0) {
        const finishCp = editorCheckpoints.find((cp) => cp.type === 'finish');
        const routeCps = editorCheckpoints.filter((cp) => cp.type !== 'finish');

        payload.parcours = {
            enabled: true,
            routeId: 'editor_route_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 20000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: routeCps,
            ...(finishCp ? { finish: finishCp } : {})
        };
    } else if (payload.parcours) {
        // Preserve existing parcours metadata if no checkpoints were placed
    }

    const warnings = [];
    if (!foundPlayerSpawn) {
        warnings.push('Kein Spieler-Spawn platziert — Standardposition wird verwendet.');
    }
    if (payload.botSpawns.length === 0) {
        warnings.push('Keine Bot-Spawn-Punkte platziert.');
    }
    if (payload.parcours?.enabled && !payload.parcours?.finish) {
        warnings.push('Parcours aktiviert, aber kein Finish-Checkpoint platziert.');
    }
    const normalizedPayload = createMapDocument(payload, { warnings });
    storeSchemaWarnings(manager, warnings);
    return JSON.stringify(normalizedPayload, null, 2);
}

export function resolveMapAuthoringStatus(manager) {
    const empty = { playerSpawnPlaced: false, botSpawnCount: 0, portalCount: 0, parcoursEnabled: false, parcourHasFinish: false, warnings: [] };
    if (!manager?.core?.objectsContainer) return empty;

    let playerSpawnPlaced = false;
    let botSpawnCount = 0;
    let portalCount = 0;
    let parcourHasFinish = false;

    manager.core.objectsContainer.children.forEach((obj) => {
        const u = obj.userData || {};
        if (u.type === 'spawn') {
            if (u.subType === 'player') playerSpawnPlaced = true;
            else botSpawnCount++;
        } else if (u.type === 'portal') {
            portalCount++;
        } else if (u.type === 'checkpoint' && u.subType === 'finish') {
            parcourHasFinish = true;
        }
    });

    const parcoursEnabled = manager.mapDocumentMeta?.parcours?.enabled === true;
    const warnings = [];
    if (!playerSpawnPlaced) warnings.push('Kein Spieler-Spawn platziert.');
    if (botSpawnCount === 0) warnings.push('Keine Bot-Spawn-Punkte platziert.');
    if (parcoursEnabled && !parcourHasFinish) warnings.push('Parcours aktiviert, aber kein Finish-Checkpoint platziert.');
    if (portalCount > 0 && portalCount % 2 !== 0) warnings.push('Ungerade Portal-Anzahl — ein Portal ist ohne Partner.');

    return { playerSpawnPlaced, botSpawnCount, portalCount, parcoursEnabled, parcourHasFinish, warnings };
}

export function importFromJSON(manager, jsonString, options = {}) {
    try {
        const parsed = parseMapJSON(jsonString);
        const data = parsed.map;
        const onArenaSize = typeof options === 'function'
            ? options
            : (typeof options?.onArenaSize === 'function' ? options.onArenaSize : null);

        if (parsed.warnings.length > 0) {
            console.warn('[EditorMapManager] Import migration warnings:', parsed.warnings);
        }

        if (data.arenaSize && onArenaSize) {
            onArenaSize(data.arenaSize);
        }

        manager.clearAllObjects();
        storeSchemaWarnings(manager, parsed.warnings);
        manager.mapDocumentMeta = extractMapMetadata(data);

        manager.withSceneMutation(() => {
            if (data.hardBlocks) {
                data.hardBlocks.forEach((b) => manager.createMesh('hard', null, b.x, b.y, b.z, b.size, {
                    id: b.id,
                    sizeX: b.width || b.size * 2,
                    sizeZ: b.depth || b.size * 2,
                    sizeY: b.height || b.size * 2,
                    rotateY: b.rotateY || 0
                }, { updateUi: false }));
            }

            if (data.foamBlocks) {
                data.foamBlocks.forEach((b) => manager.createMesh('foam', null, b.x, b.y, b.z, b.size, {
                    id: b.id,
                    sizeX: b.width || b.size * 2,
                    sizeZ: b.depth || b.size * 2,
                    sizeY: b.height || b.size * 2,
                    rotateY: b.rotateY || 0
                }, { updateUi: false }));
            }

            if (data.portals) {
                data.portals.forEach((b) => manager.createMesh('portal', b.model || null, b.x, b.y, b.z, b.radius, {
                    id: b.id
                }, { updateUi: false }));
            }

            if (data.items) {
                data.items.forEach((b) => manager.createMesh('item', b.type, b.x, b.y, b.z, 0, {
                    id: b.id,
                    model: b.model,
                    pickupType: b.pickupType,
                    weight: b.weight,
                    rotateY: b.rotateY || 0
                }, { updateUi: false }));
            }

            if (data.aircraft) {
                data.aircraft.forEach((a) => manager.createMesh('aircraft', a.jetId, a.x, a.y, a.z, 0, {
                    id: a.id,
                    modelScale: a.scale || 50,
                    rotateY: a.rotateY || 0
                }, { updateUi: false }));
            }

            if (data.botSpawns) {
                data.botSpawns.forEach((b) => manager.createMesh('spawn', 'bot', b.x, b.y, b.z, 0, {
                    id: b.id
                }, { updateUi: false }));
            }

            if (data.playerSpawn) {
                manager.createMesh('spawn', 'player', data.playerSpawn.x, data.playerSpawn.y, data.playerSpawn.z, 0, {
                    id: data.playerSpawn.id
                }, { updateUi: false });
            }

            if (data.tunnels) {
                data.tunnels.forEach((t) => {
                    const pA = new THREE.Vector3(t.ax, t.ay, t.az);
                    const pB = new THREE.Vector3(t.bx, t.by, t.bz);
                    const center = pA.clone().lerp(pB, 0.5);
                    manager.createMesh('tunnel', t.model || null, center.x, center.y, center.z, t.radius, {
                        id: t.id,
                        pointA: pA,
                        pointB: pB,
                        radius: t.radius
                    }, { updateUi: false });
                });
            }

            // Import parcours checkpoints as editor objects
            if (data.parcours && data.parcours.checkpoints) {
                data.parcours.checkpoints.forEach((cp) => {
                    const [cx, cy, cz] = cp.pos || [0, 0, 0];
                    manager.createMesh('checkpoint', cp.type || 'gate', cx, cy, cz, 0, {
                        id: cp.id,
                        cpRadius: cp.radius || 5.5,
                        cpForward: cp.forward || [1, 0, 0],
                        ...(cp.aliasOf ? { aliasOf: cp.aliasOf } : {})
                    }, { updateUi: false });
                });
                if (data.parcours.finish) {
                    const fin = data.parcours.finish;
                    const [fx, fy, fz] = fin.pos || [0, 0, 0];
                    manager.createMesh('checkpoint', 'finish', fx, fy, fz, 0, {
                        id: fin.id,
                        cpRadius: fin.radius || 7.0,
                        cpForward: fin.forward || [1, 0, 0]
                    }, { updateUi: false });
                }
            }

            manager.queueSceneUiRefresh({ tunnelVisuals: true });
        });
        return {
            map: data,
            warnings: dedupeWarnings(parsed.warnings),
        };
    } catch (e) {
        storeSchemaWarnings(manager, []);
        console.error('[EditorMapManager] Map import failed:', e);
        alert(`Map Import Error: ${e.message}`);
        return null;
    }
}
