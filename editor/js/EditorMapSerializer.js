import * as THREE from 'three';
import { createMapDocument, parseMapJSON } from '../../src/entities/MapSchema.js';
import {
    deriveItemSpawnModeDefault,
    derivePortalModeDefault,
} from '../../src/entities/mapSchema/MapSchemaAuthoringModeDefaults.js';

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

function isEscortMapUnit(value) {
    return value?.escortObjective && typeof value.escortObjective === 'object';
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
    if (Array.isArray(source.secretRooms)) {
        metadata.secretRooms = cloneSerializable(source.secretRooms) || [];
    }
    if (Array.isArray(source.mapUnits)) {
        metadata.mapUnits = cloneSerializable(source.mapUnits.filter((unit) => !isEscortMapUnit(unit))) || [];
    }
    if (Array.isArray(source.flagObjectives)) {
        metadata.flagObjectives = cloneSerializable(source.flagObjectives) || [];
    }

    return metadata;
}

// The schema normalizer always writes a portalMode/itemSpawnMode, even when the document
// never carried one. Freezing such a guessed mode in mapDocumentMeta would survive every
// later export (an undo snapshot of an empty map would pin portalMode=dynamic and make the
// runtime ignore portals the author places afterwards). Only a mode that deviates from the
// value derived from this document's own content can come from the author, so only that one
// is kept; everything else is re-derived from the scene on the next export.
function isAuthorSetPortalMode(data, portalMode) {
    const portalCount = Array.isArray(data.portals) ? data.portals.length : 0;
    return portalMode !== derivePortalModeDefault({
        hasAuthoredPortalPairs: Math.floor(portalCount / 2) > 0,
        legacyPreferAuthored: data.preferAuthoredPortals === true,
    });
}

function isAuthorSetItemSpawnMode(data, itemSpawnMode) {
    const itemCount = Array.isArray(data.items) ? data.items.length : 0;
    return itemSpawnMode !== deriveItemSpawnModeDefault({ hasAuthoredItems: itemCount > 0 });
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
    if (typeof data.portalMode === 'string' && data.portalMode && isAuthorSetPortalMode(data, data.portalMode)) {
        metadata.portalMode = data.portalMode;
    }
    if (typeof data.itemSpawnMode === 'string' && data.itemSpawnMode && isAuthorSetItemSpawnMode(data, data.itemSpawnMode)) {
        metadata.itemSpawnMode = data.itemSpawnMode;
    }
    if (Array.isArray(data.portalLevels) && data.portalLevels.length > 0) {
        metadata.portalLevels = cloneSerializable(data.portalLevels) || [];
    }
    if (Array.isArray(data.gates) && data.gates.length > 0) {
        metadata.gates = cloneSerializable(data.gates) || [];
    }
    // The editor has no authoring surface for secret rooms, so the block is only carried through:
    // it is remembered as it arrives and written back unchanged. Its numbers are map units like
    // every other authored position, and nothing here scales or validates them - the schema and
    // the secret room contract already did that on the way in.
    if (Array.isArray(data.secretRooms) && data.secretRooms.length > 0) {
        metadata.secretRooms = cloneSerializable(data.secretRooms) || [];
    }
    // Non-escort units still round-trip unchanged. Escort routes have their own visual authoring surface.
    if (Array.isArray(data.mapUnits) && data.mapUnits.length > 0) {
        metadata.mapUnits = cloneSerializable(data.mapUnits.filter((unit) => !isEscortMapUnit(unit))) || [];
    }
    // Flag anchors are carried through until the editor gets a dedicated placement surface.
    if (Array.isArray(data.flagObjectives) && data.flagObjectives.length > 0) {
        metadata.flagObjectives = cloneSerializable(data.flagObjectives) || [];
    }
    if (data.parcours && typeof data.parcours === 'object') {
        const parcoursMetadata = cloneSerializable(data.parcours) || {};
        delete parcoursMetadata.checkpoints;
        delete parcoursMetadata.finish;
        metadata.parcours = parcoursMetadata;
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
        staticTurrets: [],
        aircraft: [],
        glbModels: [],
        playerSpawn: { x: -800, y: arenaSize.height * 0.55, z: 0 },
    };

    const editorCheckpoints = [];
    const escortPoints = [];
    let foundPlayerSpawn = false;

    manager.core.objectsContainer.children.forEach((obj) => {
        const u = obj.userData || {};
        const p = obj.position;
        const ry = obj.rotation.y || 0;

        if (u.type === 'tunnel') {
            manager.syncTunnelEndpointsFromMesh(obj);
        }

        if (u.type === 'hard') {
            const blockEntry = {
                id: u.id,
                x: p.x, y: p.y, z: p.z,
                width: u.sizeX,
                depth: u.sizeZ,
                height: u.sizeY,
                size: u.sizeInfo,
                rotateY: ry
            };
            if (u.tunnel && typeof u.tunnel === 'object') blockEntry.tunnel = cloneSerializable(u.tunnel);
            payload.hardBlocks.push(blockEntry);
        }
        else if (u.type === 'foam') {
            const blockEntry = {
                id: u.id,
                x: p.x, y: p.y, z: p.z,
                width: u.sizeX,
                depth: u.sizeZ,
                height: u.sizeY,
                size: u.sizeInfo,
                rotateY: ry
            };
            if (u.tunnel && typeof u.tunnel === 'object') blockEntry.tunnel = cloneSerializable(u.tunnel);
            payload.foamBlocks.push(blockEntry);
        }
        else if (u.type === 'portal') {
            const portalEntry = {
                id: u.id,
                x: p.x,
                y: p.y,
                z: p.z,
                radius: u.sizeInfo,
                rotateX: obj.rotation.x || 0,
                rotateY: obj.rotation.y || 0,
                rotateZ: obj.rotation.z || 0,
            };
            if (typeof u.subType === 'string' && u.subType) {
                portalEntry.model = u.subType;
            }
            if (Array.isArray(u.forward)) {
                portalEntry.forward = cloneSerializable(u.forward);
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
        else if (u.type === 'turret') {
            payload.staticTurrets.push({
                id: u.id, weapon: u.weapon, pos: [p.x, p.y, p.z],
                range: u.range, cooldown: u.cooldown, rocketType: u.rocketType,
                damage: u.damage, phase: u.phase, destructible: u.destructible,
                maxHp: u.maxHp, targetPlayers: u.targetPlayers,
                targetTrails: u.targetTrails, allowedModes: u.allowedModes,
            });
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
        else if (u.type === 'glb') {
            const glbEntry = {
                id: `${u.subType}#${u.id}`,
                url: u.glbUrl,
                position: [p.x, p.y, p.z],
                rotation: [obj.rotation.x || 0, ry, obj.rotation.z || 0],
            };
            if (Number.isFinite(Number(u.targetSize)) && Number(u.targetSize) > 0) {
                glbEntry.targetSize = Number(u.targetSize);
            } else {
                glbEntry.scale = Number.isFinite(Number(u.glbScale)) ? Number(u.glbScale) : obj.scale.x;
            }
            payload.glbModels.push(glbEntry);
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
                editorOrder: Number.isFinite(Number(u.checkpointOrder)) ? Number(u.checkpointOrder) : editorCheckpoints.length,
                type: u.subType || 'gate',
                pos: [p.x, p.y, p.z],
                radius: u.cpRadius || 5.5,
                forward: u.cpForward || [1, 0, 0],
                ...(u.aliasOf ? { aliasOf: u.aliasOf } : {}),
                ...(Array.isArray(u.nextIds) ? { nextIds: cloneSerializable(u.nextIds) } : {}),
                ...(u.params && typeof u.params === 'object' ? { params: cloneSerializable(u.params) } : {})
            });
        }
        else if (u.type === 'escort_waypoint') {
            escortPoints.push({
                order: Number.isFinite(Number(u.escortOrder)) ? Number(u.escortOrder) : escortPoints.length,
                routeType: String(u.subType || 'waypoint'),
                pos: [p.x, p.y, p.z],
            });
        }
    });

    if (payload.glbModels.length > 0 && !payload.glbColliderMode) {
        payload.glbColliderMode = 'fallbackOnly';
    }

    if (escortPoints.length >= 2) {
        escortPoints.sort((left, right) => left.order - right.order);
        const path = escortPoints.map((point) => point.pos);
        const checkpointPathIndices = [];
        escortPoints.forEach((point, index) => {
            if (point.routeType === 'checkpoint' && index > 0 && index < escortPoints.length - 1) {
                checkpointPathIndices.push(index);
            }
        });
        payload.mapUnits = (payload.mapUnits || []).filter((unit) => !isEscortMapUnit(unit));
        payload.mapUnits.push({
            id: 'escort_tank',
            kind: 'tank',
            path,
            loop: false,
            speed: 6,
            maxHp: 600,
            respawnSeconds: 0,
            weapons: { mg: false, rocket: false },
            allowedModes: ['ESCORT'],
            escortObjective: { checkpointPathIndices },
        });
    }

    // Runtime portals are paired sequentially. Authoring links decide that order,
    // without leaking editor-only partner ids into the runtime schema.
    if (payload.portals.length > 1) {
        const portalById = new Map(payload.portals.map((entry) => [entry.id, entry]));
        const linkedPortals = [];
        const unlinkedPortals = [];
        const emitted = new Set();
        for (const portal of payload.portals) {
            if (emitted.has(portal.id)) continue;
            const source = manager.getObjectById?.(portal.id);
            const partner = portalById.get(String(source?.userData?.portalPartnerId || ''));
            if (partner && partner.id !== portal.id && !emitted.has(partner.id)) {
                linkedPortals.push(portal, partner);
                emitted.add(portal.id);
                emitted.add(partner.id);
                continue;
            }
            // A portal without a usable partner must not sit between two linked portals:
            // sequential runtime pairing would otherwise marry it to the next pair's entry
            // and drop that pair's real exit. Unlinked portals keep their relative order.
            unlinkedPortals.push(portal);
            emitted.add(portal.id);
        }
        payload.portals = [...linkedPortals, ...unlinkedPortals];
    }

    // Build parcours block from placed checkpoints
    if (editorCheckpoints.length > 0) {
        editorCheckpoints.sort((left, right) => left.editorOrder - right.editorOrder);
        const finishCp = editorCheckpoints.find((cp) => cp.type === 'finish');
        const routeCps = editorCheckpoints.filter((cp) => cp.type !== 'finish');
        editorCheckpoints.forEach((checkpoint) => delete checkpoint.editorOrder);

        payload.parcours = {
            enabled: true,
            routeId: payload.parcours?.routeId || 'editor_route_v1',
            rules: payload.parcours?.rules || {
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
        delete payload.parcours.checkpoints;
        delete payload.parcours.finish;
        payload.parcours.enabled = false;
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
    if (escortPoints.length === 1) {
        warnings.push('Escort-Route benötigt mindestens Start und Ziel.');
    }
    if (escortPoints.length >= 2 && !escortPoints.some((point) => point.routeType === 'checkpoint')) {
        warnings.push('Escort-Route hat keinen Reparatur-Checkpoint.');
    }
    const normalizedPayload = createMapDocument(payload, { warnings });
    storeSchemaWarnings(manager, [...(manager.lastImportWarnings || []), ...warnings]);
    return JSON.stringify(normalizedPayload, null, 2);
}

export function resolveMapAuthoringStatus(manager) {
    const empty = { playerSpawnPlaced: false, botSpawnCount: 0, portalCount: 0, parcoursEnabled: false, parcourHasFinish: false, warnings: [] };
    if (!manager?.core?.objectsContainer) return empty;

    let playerSpawnPlaced = false;
    let botSpawnCount = 0;
    let portalCount = 0;
    let parcourHasFinish = false;
    let checkpointCount = 0;

    manager.core.objectsContainer.children.forEach((obj) => {
        const u = obj.userData || {};
        if (u.type === 'spawn') {
            if (u.subType === 'player') playerSpawnPlaced = true;
            else botSpawnCount++;
        } else if (u.type === 'portal') {
            portalCount++;
        } else if (u.type === 'checkpoint') {
            checkpointCount++;
            if (u.subType === 'finish') parcourHasFinish = true;
        }
    });

    const parcoursEnabled = manager.mapDocumentMeta?.parcours?.enabled === true || checkpointCount > 0;
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
        manager.lastImportWarnings = dedupeWarnings(parsed.warnings);
        storeSchemaWarnings(manager, parsed.warnings);
        manager.mapDocumentMeta = extractMapMetadata(data);

        manager.withSceneMutation(() => {
            if (data.hardBlocks) {
                data.hardBlocks.forEach((b) => manager.createMesh('hard', null, b.x, b.y, b.z, b.size, {
                    id: b.id,
                    sizeX: b.width || b.size * 2,
                    sizeZ: b.depth || b.size * 2,
                    sizeY: b.height || b.size * 2,
                    rotateY: b.rotateY || 0,
                    ...(b.tunnel && typeof b.tunnel === 'object' ? { tunnel: cloneSerializable(b.tunnel) } : {})
                }, { updateUi: false }));
            }

            if (data.foamBlocks) {
                data.foamBlocks.forEach((b) => manager.createMesh('foam', null, b.x, b.y, b.z, b.size, {
                    id: b.id,
                    sizeX: b.width || b.size * 2,
                    sizeZ: b.depth || b.size * 2,
                    sizeY: b.height || b.size * 2,
                    rotateY: b.rotateY || 0,
                    ...(b.tunnel && typeof b.tunnel === 'object' ? { tunnel: cloneSerializable(b.tunnel) } : {})
                }, { updateUi: false }));
            }

            if (data.portals) {
                data.portals.forEach((b) => manager.createMesh('portal', b.model || null, b.x, b.y, b.z, b.radius, {
                    id: b.id,
                    rotateX: b.rotateX,
                    rotateY: b.rotateY,
                    rotateZ: b.rotateZ,
                    ...(Array.isArray(b.forward) ? { forward: cloneSerializable(b.forward) } : {}),
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

            for (const turret of data.staticTurrets || []) {
                manager.createMesh('turret', turret.weapon, ...turret.pos, 0, turret, { updateUi: false });
            }

            const escortUnit = (data.mapUnits || []).find((unit) => isEscortMapUnit(unit));
            if (escortUnit?.path?.length >= 2) {
                const checkpointIndices = new Set(escortUnit.escortObjective?.checkpointPathIndices || []);
                escortUnit.path.forEach((point, index) => {
                    const [x, y, z] = point || [0, 0, 0];
                    const routeType = index === 0
                        ? 'start'
                        : (index === escortUnit.path.length - 1 ? 'goal' : (checkpointIndices.has(index) ? 'checkpoint' : 'waypoint'));
                    manager.createMesh('escort_waypoint', routeType, x, y, z, 4.5, {
                        id: `escort_route_${index + 1}`,
                        escortOrder: index,
                    }, { updateUi: false });
                });
            }

            if (data.aircraft) {
                data.aircraft.forEach((a) => manager.createMesh('aircraft', a.jetId, a.x, a.y, a.z, 0, {
                    id: a.id,
                    modelScale: a.scale || 50,
                    rotateY: a.rotateY || 0
                }, { updateUi: false }));
            }

            if (data.glbModels) {
                data.glbModels.forEach((model) => {
                    const [assetId, placementId] = String(model.id || '').split('#');
                    const targetSize = Number(model.targetSize) > 0 ? Number(model.targetSize) : null;
                    const scale = Number.isFinite(Number(model.scale)) ? Number(model.scale) : 1;
                    manager.createMesh('glb', assetId, ...model.position, targetSize || scale, {
                        id: placementId || model.id,
                        glbUrl: model.url,
                        ...(targetSize ? { targetSize } : { glbScale: scale }),
                        rotateX: model.rotation?.[0] || 0,
                        rotateY: model.rotation?.[1] || 0,
                        rotateZ: model.rotation?.[2] || 0,
                    }, { updateUi: false });
                });
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
                        ...(cp.aliasOf ? { aliasOf: cp.aliasOf } : {}),
                        ...(Array.isArray(cp.nextIds) ? { nextIds: cloneSerializable(cp.nextIds) } : {}),
                        ...(cp.params && typeof cp.params === 'object' ? { params: cloneSerializable(cp.params) } : {})
                    }, { updateUi: false });
                });
                if (data.parcours.finish) {
                    const fin = data.parcours.finish;
                    const [fx, fy, fz] = fin.pos || [0, 0, 0];
                    manager.createMesh('checkpoint', 'finish', fx, fy, fz, 0, {
                        id: fin.id,
                        cpRadius: fin.radius || 7.0,
                        cpForward: fin.forward || [1, 0, 0],
                        ...(fin.aliasOf ? { aliasOf: fin.aliasOf } : {}),
                        ...(Array.isArray(fin.nextIds) ? { nextIds: cloneSerializable(fin.nextIds) } : {}),
                        ...(fin.params && typeof fin.params === 'object' ? { params: cloneSerializable(fin.params) } : {})
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
        manager.lastImportWarnings = [];
        storeSchemaWarnings(manager, []);
        console.error('[EditorMapManager] Map import failed:', e);
        throw e;
    }
}
