import * as THREE from 'three';
import {
    ENDLESS_COURSE_HALF_WIDTH,
    resolveEndlessCourseCenter,
} from './EndlessParcoursConnectors.js';
import { createStaticMeshCollider, createDynamicMeshCollider, refreshDynamicMeshCollider } from '../arena/StaticMeshCollider.js';
import { placeEndlessCourseMesh, resolveEndlessCoursePoint } from './EndlessParcoursCourseSpace.js';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';
import { buildEndlessTube } from './EndlessParcoursTube.js';

/**
 * Korridormitte an einer Weltposition innerhalb des Bausteins.
 *
 * @param {{ originZ: number, length: number, entryDrift: { x: number, y: number }, exitDrift: { x: number, y: number } }} module
 * @param {number} worldZ
 * @returns {{ x: number, y: number }}
 */
export function resolveModuleCenterAtZ(module, worldZ) {
    const progress = (Number(worldZ) - module.originZ) / Math.max(1, module.length);
    return resolveEndlessCourseCenter(module.entryDrift, module.exitDrift, progress);
}

function createMesh(geometry, material, x, y, z, sx, sy, sz, module) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return placeEndlessCourseMesh(mesh, module, x, y, z);
}

function buildObstacles({ module, group, geometry, materials, ownerId }) {
    const statics = [];
    const cycles = [];
    for (let index = 0; index < module.colliders.length; index += 1) {
        const definition = module.colliders[index];
        const x = definition.x;
        const y = definition.y - 8;
        const worldZ = definition.z;
        const mesh = createMesh(
            geometry,
            definition.cycle ? materials.hazard : materials.obstacle,
            x, y, worldZ,
            definition.sx, definition.sy, definition.sz, module
        );
        mesh.name = `${ownerId}:obstacle:${index}`;
        group.add(mesh);
        const collider = {
            id: `${ownerId}:collider:${index}`,
            ownerId,
            kind: 'hard',
            isWall: false,
            box: new THREE.Box3().setFromObject(mesh),
            meshCollider: definition.cycle ? createDynamicMeshCollider(mesh) : createStaticMeshCollider(mesh),
        };
        if (definition.cycle) {
            cycles.push({
                collider,
                mesh,
                cycle: definition.cycle,
                closed: true,
                basePosition: mesh.position.clone(),
                up: new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion),
                baseScaleY: definition.sy,
            });
        } else {
            statics.push(collider);
        }
    }
    return { statics, cycles };
}

function buildGate({ module, group, geometry, materials, ownerId }) {
    const center = resolveEndlessCoursePoint(module, 0, 0, module.localCheckpointZ, createEndlessPathSample()).position;
    const gate = createMesh(
        geometry,
        materials.gate,
        0, 1, module.localCheckpointZ,
        ENDLESS_COURSE_HALF_WIDTH * 1.7, 0.6, 0.8, module
    );
    gate.name = `${ownerId}:checkpoint`;
    group.add(gate);
    const posts = [];
    for (const side of [-1, 1]) {
        const post = createMesh(
            geometry,
            materials.gate,
            side * (ENDLESS_COURSE_HALF_WIDTH - 3), 3, module.localCheckpointZ,
            1.4, 14, 0.8, module
        );
        group.add(post);
        posts.push(post);
    }
    return { gate, posts, center };
}

function buildRecordMarker({ module, group, geometry, materials, recordDistanceMeters, metric }) {
    const record = Number(recordDistanceMeters) || 0;
    if (record <= 0) return null;
    const range = metric?.getStationRange(module.moduleIndex);
    const start = range?.startS ?? module.originZ, end = range?.endS ?? module.originZ + module.length;
    if (record < start || record >= end) return null;
    const localZ = metric ? metric.sampleAtS(record).progress * module.length : record - module.originZ;
    const marker = createMesh(
        geometry,
        materials.record,
        0, 2, localZ,
        ENDLESS_COURSE_HALF_WIDTH * 2, 26, 0.5, module
    );
    marker.name = 'endless:record-marker';
    group.add(marker);
    return marker;
}

function buildAreaCues({ module, group, geometry, materials }) {
    const material = materials[module.area] || materials.gate;
    if (module.area === 'intro') return;
    for (const localZ of [18, 58, 98]) {
        if (module.area === 'industrial') {
            group.add(createMesh(geometry, material, 0, 22, localZ, 34, 2, 2, module));
        } else if (module.area === 'canyon') {
            const side = localZ === 58 ? -1 : 1;
            group.add(createMesh(geometry, material, side * 25, 7, localZ, 4, 30, 5, module));
        } else {
            group.add(createMesh(geometry, material, 0, 22, localZ, 42, 1, 1, module));
            group.add(createMesh(geometry, material, -21, 7, localZ, 1, 30, 1, module));
            group.add(createMesh(geometry, material, 21, 7, localZ, 1, 30, 1, module));
        }
    }
    if (!module.sideRoute) return;
    const route = module.sideRoute;
    const routeX = route.side * 18;
    for (const localZ of [route.entryZ, (route.entryZ + route.exitZ) * 0.5, route.exitZ]) {
        group.add(createMesh(
            geometry, materials.routeRisk,
            routeX, -9.5, localZ,
            12, 0.8, 3, module
        ));
    }
}

/**
 * Baut einen Baustein als eine Szenen-Gruppe samt Kollisionskoerpern. Alles, was
 * spaeter animiert oder umgeschaltet wird, kommt als Referenz zurueck.
 *
 * @param {{ module: any, geometry: THREE.BufferGeometry, materials: Record<string, THREE.Material>, recordDistanceMeters?: number, metric?: any, baseSeed?: number }} options
 */
export function buildEndlessModuleInstance({ module, geometry, materials, recordDistanceMeters = 0, metric = null, baseSeed = 1 }) {
    const ownerId = `endless-module:${module.moduleIndex}`;
    const group = new THREE.Group();
    group.name = ownerId;
    group.userData.endlessModuleIndex = module.moduleIndex;
    const tube = buildEndlessTube({ module, baseSeed, material: materials.wall, ownerId });
    group.add(tube.mesh);
    const obstacles = buildObstacles({ module, group, geometry, materials, ownerId });
    const gate = buildGate({ module, group, geometry, materials, ownerId });
    const recordMarker = buildRecordMarker({ module, group, geometry, materials, recordDistanceMeters, metric });
    buildAreaCues({ module, group, geometry, materials });
    return {
        ownerId,
        module,
        group,
        gateMesh: gate.gate,
        gatePosts: gate.posts,
        gateCenter: gate.center,
        recordMarker,
        staticColliders: [tube.collider, ...obstacles.statics],
        volumeCollider: tube.volumeCollider,
        bounds: tube.box,
        ownedGeometries: tube.geometries,
        cycleColliders: obstacles.cycles,
        cycleSignature: '',
    };
}

/**
 * Eine Schleuse ist im ersten Teil ihres Takts offen, danach geschlossen. Der
 * Zustand haengt nur an der Kampfzeit, ist also reproduzierbar.
 *
 * @param {{ periodSeconds: number, openSeconds: number, phase: number }} cycle
 * @param {number} elapsedSeconds
 * @returns {boolean} true = geschlossen
 */
export function isCycleColliderClosed(cycle, elapsedSeconds) {
    const period = Math.max(0.2, Number(cycle?.periodSeconds) || 1);
    const open = Math.max(0, Math.min(period, Number(cycle?.openSeconds) || 0));
    const phase = Number(cycle?.phase) || 0;
    const position = (((Number(elapsedSeconds) || 0) + phase) % period + period) % period;
    return position >= open;
}

/**
 * Schaltet die Schleusen eines Bausteins auf den Takt und meldet, ob sich dabei
 * etwas geaendert hat. Nur dann muss der Kollisions-Batch neu registriert werden.
 *
 * @param {{ cycleColliders: any[], cycleSignature: string }} instance
 * @param {number} elapsedSeconds
 * @returns {boolean}
 */
export function syncEndlessCycleColliders(instance, elapsedSeconds, materials = null) {
    if (!instance?.cycleColliders?.length) return false;
    let signature = '';
    for (const entry of instance.cycleColliders) {
        const closed = isCycleColliderClosed(entry.cycle, elapsedSeconds);
        entry.closed = closed;
        signature += closed ? '1' : '0';
        if (!entry.mesh) continue;
        // Offene Schleuse: die Sperre klappt flach in den Boden und wechselt auf
        // das ruhige Material, damit der Takt auch optisch lesbar ist.
        entry.mesh.scale.y = closed ? entry.baseScaleY : entry.baseScaleY * 0.12;
        entry.mesh.position.copy(entry.basePosition).addScaledVector(entry.up, closed ? 0 : -entry.baseScaleY * 0.44);
        entry.mesh.updateMatrixWorld(true);
        refreshDynamicMeshCollider(entry.collider.meshCollider, entry.collider.box);
        const nextMaterial = closed
            ? (materials?.hazard || entry.mesh.material)
            : (materials?.hazardOpen || entry.mesh.material);
        if (nextMaterial) entry.mesh.material = nextMaterial;
    }
    if (signature === instance.cycleSignature) return false;
    instance.cycleSignature = signature;
    return true;
}

/**
 * Kollisionskoerper, die aktuell wirklich im Weg stehen.
 *
 * @param {{ staticColliders: any[], cycleColliders: any[] }} instance
 * @returns {any[]}
 */
export function resolveEndlessActiveColliders(instance) {
    const active = instance.staticColliders.slice();
    for (const entry of instance.cycleColliders) {
        if (entry.closed) active.push(entry.collider);
    }
    return active;
}
