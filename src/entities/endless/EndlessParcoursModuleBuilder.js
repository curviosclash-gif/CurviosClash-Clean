import * as THREE from 'three';
import {
    ENDLESS_COURSE_HALF_WIDTH,
    ENDLESS_COURSE_SEGMENTS,
    resolveEndlessCourseCenter,
} from './EndlessParcoursConnectors.js';

/**
 * Die Wand ist absichtlich dick: der Korridor knickt in Stufen, und eine
 * duenne Wand liesse an jedem Knick eine Luecke, durch die man hindurchfliegen
 * koennte. Die Dicke waechst nur nach aussen, die Fahrbahn bleibt gleich breit.
 */
const WALL_THICKNESS = 8;
const WALL_HEIGHT = 34;
const FLOOR_WIDTH = ENDLESS_COURSE_HALF_WIDTH * 2 + 6;
const SEGMENT_OVERLAP = 1.35;

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

function localCenter(module, localZ) {
    return resolveEndlessCourseCenter(
        module.entryDrift,
        module.exitDrift,
        localZ / Math.max(1, module.length)
    );
}

function createBox(centerX, centerY, centerZ, sx, sy, sz) {
    const halfX = Math.max(0.01, sx) * 0.5;
    const halfY = Math.max(0.01, sy) * 0.5;
    const halfZ = Math.max(0.01, sz) * 0.5;
    return new THREE.Box3(
        new THREE.Vector3(centerX - halfX, centerY - halfY, centerZ - halfZ),
        new THREE.Vector3(centerX + halfX, centerY + halfY, centerZ + halfZ)
    );
}

function createMesh(geometry, material, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
}

function buildCourseShell({ module, group, geometry, materials, ownerId, colliders }) {
    const segmentLength = module.length / ENDLESS_COURSE_SEGMENTS;
    for (let segment = 0; segment < ENDLESS_COURSE_SEGMENTS; segment += 1) {
        const localZ = (segment + 0.5) * segmentLength;
        const center = localCenter(module, localZ);
        const worldZ = module.originZ + localZ;
        const spanZ = segmentLength * SEGMENT_OVERLAP;
        group.add(createMesh(geometry, materials.floor, center.x, center.y - 11, worldZ, FLOOR_WIDTH, 1.2, spanZ));
        for (const side of [-1, 1]) {
            const wallX = center.x + side * ENDLESS_COURSE_HALF_WIDTH;
            const wallY = center.y + WALL_HEIGHT * 0.5 - 10;
            group.add(createMesh(geometry, materials.wall, wallX, wallY, worldZ, WALL_THICKNESS, WALL_HEIGHT, spanZ));
            colliders.push({
                id: `${ownerId}:wall:${segment}:${side}`,
                ownerId,
                kind: 'wall',
                isWall: true,
                box: createBox(wallX, wallY, worldZ, WALL_THICKNESS, WALL_HEIGHT, spanZ),
            });
        }
    }
}

function buildObstacles({ module, group, geometry, materials, ownerId }) {
    const statics = [];
    const cycles = [];
    for (let index = 0; index < module.colliders.length; index += 1) {
        const definition = module.colliders[index];
        const center = localCenter(module, definition.z);
        const x = center.x + definition.x;
        const y = center.y + definition.y - 8;
        const worldZ = module.originZ + definition.z;
        const mesh = createMesh(
            geometry,
            definition.cycle ? materials.hazard : materials.obstacle,
            x, y, worldZ,
            definition.sx, definition.sy, definition.sz
        );
        mesh.name = `${ownerId}:obstacle:${index}`;
        group.add(mesh);
        const collider = {
            id: `${ownerId}:collider:${index}`,
            ownerId,
            kind: 'hard',
            isWall: false,
            box: createBox(x, y, worldZ, definition.sx, definition.sy, definition.sz),
        };
        if (definition.cycle) {
            cycles.push({
                collider,
                mesh,
                cycle: definition.cycle,
                closed: true,
                baseY: y,
                baseScaleY: definition.sy,
            });
        } else {
            statics.push(collider);
        }
    }
    return { statics, cycles };
}

function buildGate({ module, group, geometry, materials, ownerId }) {
    const center = localCenter(module, module.localCheckpointZ);
    const gate = createMesh(
        geometry,
        materials.gate,
        center.x, center.y + 1, module.checkpointZ,
        ENDLESS_COURSE_HALF_WIDTH * 1.7, 0.6, 0.8
    );
    gate.name = `${ownerId}:checkpoint`;
    group.add(gate);
    const posts = [];
    for (const side of [-1, 1]) {
        const post = createMesh(
            geometry,
            materials.gate,
            center.x + side * (ENDLESS_COURSE_HALF_WIDTH - 3), center.y + 3, module.checkpointZ,
            1.4, 14, 0.8
        );
        group.add(post);
        posts.push(post);
    }
    return { gate, posts, center };
}

function buildRecordMarker({ module, group, geometry, materials, recordDistanceMeters }) {
    const record = Number(recordDistanceMeters) || 0;
    if (record <= 0) return null;
    if (record < module.originZ || record >= module.originZ + module.length) return null;
    const center = localCenter(module, record - module.originZ);
    const marker = createMesh(
        geometry,
        materials.record,
        center.x, center.y + 2, record,
        ENDLESS_COURSE_HALF_WIDTH * 2, 26, 0.5
    );
    marker.name = 'endless:record-marker';
    group.add(marker);
    return marker;
}

function buildAreaCues({ module, group, geometry, materials }) {
    const material = materials[module.area] || materials.gate;
    if (module.area === 'intro') return;
    for (const localZ of [18, 58, 98]) {
        const center = localCenter(module, localZ);
        if (module.area === 'industrial') {
            group.add(createMesh(geometry, material, center.x, center.y + 22, module.originZ + localZ, 34, 2, 2));
        } else if (module.area === 'canyon') {
            const side = localZ === 58 ? -1 : 1;
            group.add(createMesh(geometry, material, center.x + side * 25, center.y + 7, module.originZ + localZ, 4, 30, 5));
        } else {
            group.add(createMesh(geometry, material, center.x, center.y + 22, module.originZ + localZ, 42, 1, 1));
            group.add(createMesh(geometry, material, center.x - 21, center.y + 7, module.originZ + localZ, 1, 30, 1));
            group.add(createMesh(geometry, material, center.x + 21, center.y + 7, module.originZ + localZ, 1, 30, 1));
        }
    }
    if (!module.sideRoute) return;
    const route = module.sideRoute;
    const routeX = route.side * 18;
    for (const localZ of [route.entryZ, (route.entryZ + route.exitZ) * 0.5, route.exitZ]) {
        const center = localCenter(module, localZ);
        group.add(createMesh(
            geometry, materials.routeRisk,
            center.x + routeX, center.y - 9.5, module.originZ + localZ,
            12, 0.8, 3
        ));
    }
}

/**
 * Baut einen Baustein als eine Szenen-Gruppe samt Kollisionskoerpern. Alles, was
 * spaeter animiert oder umgeschaltet wird, kommt als Referenz zurueck.
 *
 * @param {{ module: any, geometry: THREE.BufferGeometry, materials: Record<string, THREE.Material>, recordDistanceMeters?: number }} options
 */
export function buildEndlessModuleInstance({ module, geometry, materials, recordDistanceMeters = 0 }) {
    const ownerId = `endless-module:${module.moduleIndex}`;
    const group = new THREE.Group();
    group.name = ownerId;
    group.userData.endlessModuleIndex = module.moduleIndex;
    const shellColliders = [];
    buildCourseShell({ module, group, geometry, materials, ownerId, colliders: shellColliders });
    const obstacles = buildObstacles({ module, group, geometry, materials, ownerId });
    const gate = buildGate({ module, group, geometry, materials, ownerId });
    const recordMarker = buildRecordMarker({ module, group, geometry, materials, recordDistanceMeters });
    buildAreaCues({ module, group, geometry, materials });
    return {
        ownerId,
        module,
        group,
        gateMesh: gate.gate,
        gatePosts: gate.posts,
        gateCenter: gate.center,
        recordMarker,
        staticColliders: [...shellColliders, ...obstacles.statics],
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
        entry.mesh.position.y = closed
            ? entry.baseY
            : entry.baseY - entry.baseScaleY * 0.44;
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

export const ENDLESS_BUILDER_CONSTANTS = Object.freeze({
    FLOOR_WIDTH,
    WALL_HEIGHT,
    WALL_THICKNESS,
});
