// Scans every animated GLB setpiece of the map catalog in Node and reports where its moving
// geometry collides with gameplay points, how its static parts are covered in 'dynamic'
// collider mode, whether its loop is on the map beat, whether its clip moves anything, and
// where a break scene comes to rest. Used by tests/animated-setpiece-clearance.contract.test.mjs.
//
// The placement is not rebuilt here: `computeCollectionPlacement` is the function
// `GLBMapLoader.placeCollectionScene` applies, and the node hierarchy below mirrors it
// (slot -> normalizer -> offset -> scene). Poses come from a real THREE.AnimationMixer the way
// GlbAnimationDriver._applyPhase sets them: action.time = phase, mixer.update(0).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../../src/core/config/ConfigSections.js';
import { MAP_PRESET_CATALOG } from '../../src/core/config/maps/MapPresetCatalog.js';
import { computeCollectionPlacement } from '../../src/entities/GLBCollectionPlacement.js';
import { collectAnimatedNodes, normalizeGLBModelCollection } from '../../src/entities/GLBMapLoader.js';
import { resolveGLBColliderMode } from '../../src/entities/mapSchema/MapSchemaGlbOps.js';
import { buildRouteFromParcours } from '../../src/entities/systems/ParcoursProgressUtils.js';
import { isBeatAlignedClipDuration, normalizeMapAnimationClock } from '../../src/shared/contracts/MapAnimationClockContract.js';
import { geometryOnlyGlbLoader } from './glb-geometry-loader.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
// A gameplay point is blocked when colliding geometry comes closer than one ship radius.
export const SHIP_RADIUS = CONFIG_SECTIONS.PLAYER.HITBOX_RADIUS;
// 0.1 s is three exported frames at 30 fps; the fastest authored moves (pistons, gate leaves)
// cross their own thickness in more than that.
export const SAMPLE_SECONDS = 0.1;
// Static visible part of a 'dynamic' setpiece: at least half of its surface has to lie inside
// an authored obstacle box. Box obstacles approximate slanted and round parts, so a well
// covered part measures 60-100 %; a part without any box measures 0-25 %. Parts whose largest
// extent is below two ship diameters (lamps, signal plates) are ignored.
export const MIN_STATIC_COVERAGE = 0.5;
const COVERAGE_MARGIN = 0.5;
const MIN_COVERED_PART_EXTENT = 4 * SHIP_RADIUS;
// Break scene end pose: debris may sink this far below the floor before it counts as buried.
export const GROUND_TOLERANCE = 1;
// A ring counts as closed when at least this share of its disc is blocked at one moment.
const RING_BLOCKED_SHARE = 0.5;

// Copies of the GLBMapLoader name markers (collectSceneColliders): the loader keeps them private.
const lowerName = (object) => String(object?.name || '').toLowerCase();
const isNoCollision = (mesh) => lowerName(mesh).includes('_nocol');
const isCollisionOnly = (mesh) => lowerName(mesh).includes('_colonly');
const isForcedDynamic = (mesh) => lowerName(mesh).includes('_dyn');

// Same choice as GLBMapLoader.selectAnimationClip.
function selectClip(clips, clipName) {
    if (!clips.length) return null;
    return (clipName && clips.find((clip) => clip.name === clipName)) || clips[0];
}

// Reads only the JSON chunk: most catalog models are static and never need decoding.
const clipIndex = new Map();
function fileHasClips(url) {
    if (!clipIndex.has(url)) {
        const bytes = readFileSync(path.join(REPO, url));
        const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
        clipIndex.set(url, (json.animations || []).length > 0);
    }
    return clipIndex.get(url);
}

const glbCache = new Map();
async function loadGlb(url) {
    if (!glbCache.has(url)) {
        glbCache.set(url, geometryOnlyGlbLoader.loadAsync(path.join(REPO, url)).then((gltf) => {
            const scene = gltf.scene || gltf.scenes?.[0];
            scene.updateWorldMatrix(true, true);
            // Same bounds as collectSceneColliders on the unplaced scene: the bind pose.
            const bounds = new THREE.Box3();
            const meshes = [];
            scene.traverse((child) => {
                if (!child.isMesh) return;
                const box = new THREE.Box3().setFromObject(child);
                if (box.isEmpty()) return;
                bounds.union(box);
                child.geometry.computeBoundingBox();
                meshes.push(child);
            });
            const bindPose = [];
            scene.traverse((node) => bindPose.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
            return { scene, clips: gltf.animations || [], bounds, meshes, bindPose, mixer: new THREE.AnimationMixer(scene) };
        }));
    }
    return glbCache.get(url);
}

function resolveAnchor(entry, scale) {
    const source = Array.isArray(entry?.pos) ? entry.pos : [entry?.x, entry?.y, entry?.z];
    const values = source.map(Number);
    return values.every(Number.isFinite) ? values.map((value) => value * scale) : null;
}

function discSamples(center, radius, forward) {
    const normal = new THREE.Vector3(...(forward || [0, 0, 1])).normalize();
    const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().crossVectors(normal, up).normalize();
    const b = new THREE.Vector3().crossVectors(normal, a).normalize();
    const points = [center];
    for (const [share, count] of [[0.45, 8], [0.85, 12]]) {
        for (let index = 0; index < count; index += 1) {
            const angle = (2 * Math.PI * index) / count;
            const r = radius * share;
            points.push([0, 1, 2].map((axis) => center[axis]
                + r * (Math.cos(angle) * a.getComponent(axis) + Math.sin(angle) * b.getComponent(axis))));
        }
    }
    return points;
}

/** Every point a moving part must keep clear of, in world units. */
export function collectGameplayPoints(map) {
    // Spawns, pickups and turrets follow the map scale only with scaleAuthoredAnchors
    // (Arena._cacheAuthoredMapAnchors, StaticTurretSystem); portals, gates and rings always do
    // (PortalLayoutBuilder).
    const anchorScale = map.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    const points = [];
    const add = (id, entry, scale, extra = {}) => {
        const pos = Array.isArray(entry) ? entry.map((value) => Number(value) * scale) : resolveAnchor(entry, scale);
        if (pos && pos.every(Number.isFinite)) points.push({ id, samples: [pos], ...extra });
    };
    add('spawn:player', map.playerSpawn, anchorScale);
    (map.botSpawns || []).forEach((spawn, index) => add(`spawn:bot${index}`, spawn, anchorScale));
    (map.items || []).forEach((item, index) => add(`item:${item?.id || index}`, item, anchorScale));
    (map.staticTurrets || []).forEach((turret, index) => add(`turret:${turret?.id || index}`, turret, anchorScale));
    (map.portals || []).forEach((portal, index) => {
        if (Array.isArray(portal?.a)) add(`portal:P${index}a`, portal.a, MAP_SCALE);
        if (Array.isArray(portal?.b)) add(`portal:P${index}b`, portal.b, MAP_SCALE);
    });
    (map.gates || []).forEach((gate, index) => {
        if (Array.isArray(gate?.pos)) add(`gate:${gate.id || index}`, gate.pos, MAP_SCALE);
    });
    const route = buildRouteFromParcours(map.parcours);
    const rings = route ? [...route.checkpoints, ...(route.finish ? [{ ...route.finish, isFinish: true }] : [])] : [];
    const rawRings = [...(map.parcours?.checkpoints || []), map.parcours?.finish].filter(Boolean);
    for (const ring of rings) {
        const center = ring.pos.map((value) => Number(value) * MAP_SCALE);
        // The ring a ship flies through is the drawn one (PortalLayoutBuilder._buildCheckpointRings).
        const radius = Math.max(ring.isFinish ? 4.2 : 3.2, (Number(ring.radius) || (ring.isFinish ? 5.5 : 4.2)) * 0.75) * MAP_SCALE;
        const raw = rawRings.find((entry) => entry.id === ring.id);
        points.push({
            id: `ring:${ring.id}`,
            samples: discSamples(center, radius, ring.forward),
            ring: true,
            centerAllowed: raw?.centerObstructionAllowed === true,
        });
    }
    return points;
}

function closestDistanceSq(p, a, b, c) {
    // Ericson, Real-Time Collision Detection 5.1.5, on plain arrays.
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const dist = (x, y, z) => (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
    if (d1 <= 0 && d2 <= 0) return dist(a[0], a[1], a[2]);
    const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return dist(b[0], b[1], b[2]);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return dist(a[0] + v * abx, a[1] + v * aby, a[2] + v * abz);
    }
    const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return dist(c[0], c[1], c[2]);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return dist(a[0] + w * acx, a[1] + w * acy, a[2] + w * acz);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return dist(b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]));
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    return dist(a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w);
}

function insideByParity(p, tris) {
    // Skewed +x ray so it never runs exactly along an edge of an axis-aligned model.
    const d = [1, 0.00131, 0.00071];
    let hits = 0;
    for (const [a, b, c] of tris) {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det, s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
        if (u < 0 || u > 1) continue;
        const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
        const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
        if (v < 0 || u + v > 1) continue;
        if (f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) > 1e-9) hits += 1;
    }
    return hits % 2 === 1;
}

function worldTriangles(mesh, matrix = mesh.matrixWorld) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const vertices = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix);
        vertices.push([v.x, v.y, v.z]);
    }
    const tris = [];
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
        const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
        tris.push([vertices[ia], vertices[ib], vertices[ic]]);
    }
    return tris;
}

function pointBlocked(p, box, tris, clearance) {
    if (p[0] < box.min.x - clearance || p[0] > box.max.x + clearance
        || p[1] < box.min.y - clearance || p[1] > box.max.y + clearance
        || p[2] < box.min.z - clearance || p[2] > box.max.z + clearance) return false;
    const limit = clearance * clearance;
    for (const [a, b, c] of tris()) if (closestDistanceSq(p, a, b, c) < limit) return true;
    const inBox = p[0] >= box.min.x && p[0] <= box.max.x && p[1] >= box.min.y && p[1] <= box.max.y
        && p[2] >= box.min.z && p[2] <= box.max.z;
    return inBox && insideByParity(p, tris());
}

function obstacleCovers(obstacle, p, margin) {
    const s = MAP_SCALE;
    if (obstacle.shape === 'tube' && Array.isArray(obstacle.start) && Array.isArray(obstacle.end)) {
        const a = obstacle.start.map((value) => value * s), b = obstacle.end.map((value) => value * s);
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const lengthSq = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / lengthSq));
        return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1], p[2] - a[2] - t * d[2])
            <= (Number(obstacle.radius) || 0) * s + margin;
    }
    if (!Array.isArray(obstacle.pos) || !Array.isArray(obstacle.size)) return false;
    const c = obstacle.pos.map((value) => value * s), size = obstacle.size.map((value) => value * s);
    for (let axis = 0; axis < 3; axis += 1) if (Math.abs(p[axis] - c[axis]) > size[axis] / 2 + margin) return false;
    if (obstacle.tunnel) {
        const axis = obstacle.tunnel.axis || 'x';
        const r = (Number(obstacle.tunnel.radius) || 0) * s;
        const q = axis === 'x' ? Math.hypot(p[1] - c[1], p[2] - c[2])
            : axis === 'y' ? Math.hypot(p[0] - c[0], p[2] - c[2]) : Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (q < r - margin) return false;
    }
    return true;
}

function surfaceCoverage(tris, obstacles) {
    let total = 0, covered = 0;
    for (const [a, b, c] of tris) {
        const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const area = e1.cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).length() / 2;
        if (!(area > 0)) continue;
        const centroid = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
        const probes = [centroid, ...[a, b, c].map((corner) => [0, 1, 2].map((axis) => (centroid[axis] + corner[axis]) / 2))];
        for (const probe of probes) {
            total += area / 4;
            if (obstacles.some((obstacle) => obstacleCovers(obstacle, probe, COVERAGE_MARGIN))) covered += area / 4;
        }
    }
    return total > 0 ? covered / total : 1;
}

function sampleTimes(duration, oneShot) {
    const times = [];
    for (let k = 0; k * SAMPLE_SECONDS < duration - 1e-9; k += 1) times.push(k * SAMPLE_SECONDS);
    if (oneShot) times.push(duration);
    return times;
}

async function placeModel(descriptor) {
    const glb = await loadGlb(descriptor.url);
    for (const [node, p, q, s] of glb.bindPose) {
        node.position.copy(p);
        node.quaternion.copy(q);
        node.scale.copy(s);
    }
    glb.mixer.stopAllAction();
    const placement = computeCollectionPlacement(glb.bounds, descriptor, MAP_SCALE);
    const slot = new THREE.Group();
    slot.position.set(...placement.slotPosition);
    slot.rotation.set(...placement.slotRotation);
    const normalizer = new THREE.Group();
    normalizer.scale.setScalar(placement.fitScale);
    const offset = new THREE.Group();
    offset.position.set(...placement.offset);
    offset.add(glb.scene);
    normalizer.add(offset);
    slot.add(normalizer);
    const clip = selectClip(glb.clips, descriptor.animationClock.clipName);
    const action = glb.mixer.clipAction(clip);
    action.play();
    const pose = (time) => {
        action.time = time;
        glb.mixer.update(0);
        slot.updateMatrixWorld(true);
    };
    pose(0);
    return { glb, clip, pose };
}

function meshBox(mesh) {
    return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
}

// Where every moving collider is at every sample, kept per placed model so the arena and fire
// variants of a map that place the same setpiece at the same spot sample it once.
const frameCache = new Map();
function sampleMovingFrames(cacheKey, model, movingColliders, times) {
    if (!frameCache.has(cacheKey)) {
        frameCache.set(cacheKey, times.map((time) => {
            model.pose(time);
            return movingColliders.map((mesh) => ({ box: meshBox(mesh), matrix: mesh.matrixWorld.clone() }));
        }));
    }
    return frameCache.get(cacheKey);
}

function scanClearance(cacheKey, mapKey, descriptor, model, movingColliders, points, report) {
    const duration = model.clip.duration;
    const times = sampleTimes(duration, descriptor.animationClock.mode === 'once');
    // Pass 1: boxes of every moving collider at every sample.
    const frames = sampleMovingFrames(cacheKey, model, movingColliders, times);
    const swept = new THREE.Box3();
    for (const frame of frames) for (const { box } of frame) swept.union(box);
    const near = points.filter((point) => point.samples.some((p) => swept.distanceToPoint(new THREE.Vector3(...p)) < SHIP_RADIUS));
    if (!near.length) return;
    const stats = new Map(near.map((point) => [point, { blockedFrames: 0, centerFrames: 0, maxShare: 0, meshes: new Set() }]));
    const probe = new THREE.Vector3();
    // Pass 2: triangles only where a point is within a ship radius of a collider box.
    frames.forEach((frame) => {
        const trisCache = new Map();
        for (const point of near) {
            const stat = stats.get(point);
            let blocked = 0, center = false;
            point.samples.forEach((p, sampleIndex) => {
                probe.set(p[0], p[1], p[2]);
                for (let m = 0; m < movingColliders.length; m += 1) {
                    const { box, matrix } = frame[m];
                    if (box.distanceToPoint(probe) >= SHIP_RADIUS) continue;
                    const mesh = movingColliders[m];
                    const tris = () => {
                        if (!trisCache.has(mesh)) trisCache.set(mesh, worldTriangles(mesh, matrix));
                        return trisCache.get(mesh);
                    };
                    if (pointBlocked(p, box, tris, SHIP_RADIUS)) {
                        blocked += 1;
                        if (sampleIndex === 0) center = true;
                        stat.meshes.add(mesh.name);
                        break;
                    }
                }
            });
            const share = blocked / point.samples.length;
            if (blocked) stat.blockedFrames += 1;
            if (center) stat.centerFrames += 1;
            stat.maxShare = Math.max(stat.maxShare, share);
        }
    });
    for (const [point, stat] of stats) {
        const hit = point.ring
            ? (stat.maxShare >= RING_BLOCKED_SHARE || (!point.centerAllowed && stat.centerFrames > 0))
            : stat.blockedFrames > 0;
        if (!hit) continue;
        const pct = (value) => `${Math.round((100 * value) / times.length)}%`;
        report(`${mapKey}|${descriptor.id}|${point.id}|clearance`, point.ring
            ? `ring centre blocked ${pct(stat.centerFrames)} of the loop, up to ${Math.round(100 * stat.maxShare)}% of the disc, by ${[...stat.meshes].slice(0, 3).join(',')}`
            : `blocked ${pct(stat.blockedFrames)} of the clip by ${[...stat.meshes].slice(0, 3).join(',')}`);
    }
}

// A loop whose last frame differs from its first makes every visible part jump once per loop.
const LOOP_SEAM_TOLERANCE = 0.05;
const motionCache = new Map();
function measureMotion(cacheKey, model) {
    if (motionCache.has(cacheKey)) return motionCache.get(cacheKey);
    const nodes = [];
    model.glb.scene.traverse((node) => nodes.push(node));
    model.pose(0);
    const start = nodes.map((node) => node.matrixWorld.clone());
    const startBoxes = model.glb.meshes.map(meshBox);
    const epsilon = 1e-3 * MAP_SCALE;
    let moves = false;
    for (const time of sampleTimes(model.clip.duration, true)) {
        model.pose(time);
        moves = nodes.some((node, i) => node.matrixWorld.elements.some((value, e) => Math.abs(value - start[i].elements[e]) > epsilon));
        if (moves) break;
    }
    model.pose(model.clip.duration);
    let seam = 0;
    model.glb.meshes.forEach((mesh, i) => {
        const box = meshBox(mesh);
        seam = Math.max(seam, box.min.distanceTo(startBoxes[i].min), box.max.distanceTo(startBoxes[i].max));
    });
    const result = { moves, seam };
    motionCache.set(cacheKey, result);
    return result;
}

function scanMotion(cacheKey, model, descriptor, mapKey, report) {
    const { moves, seam } = measureMotion(cacheKey, model);
    // The chosen clip has to change at least one node's world transform.
    if (!moves) report(`${mapKey}|${descriptor.id}|-|clip-static`, `clip "${model.clip.name}" moves no node`);
    if (moves && descriptor.animationClock.mode === 'loop' && !descriptor.hiddenUntilTriggered && seam > LOOP_SEAM_TOLERANCE) {
        report(`${mapKey}|${descriptor.id}|-|loop-seam`, `${model.clip.name}: last frame is ${seam.toFixed(2)} units off the first`);
    }
}

function scanEndPose(map, mapKey, descriptor, model, colliders, report) {
    model.pose(0);
    const rest = new THREE.Box3();
    for (const mesh of colliders) rest.union(meshBox(mesh));
    model.pose(model.clip.duration);
    const floor = Math.min(0, rest.min.y) - GROUND_TOLERANCE;
    const [sx, sy, sz] = (map.size || [0, 0, 0]).map((value) => value * MAP_SCALE / 2);
    let outside = 0, buried = 0;
    for (const mesh of colliders) {
        const box = meshBox(mesh);
        const centre = box.getCenter(new THREE.Vector3());
        if (Math.abs(centre.x) > sx || Math.abs(centre.z) > sz || centre.y > sy * 2) outside += 1;
        if (box.min.y < floor) buried += 1;
    }
    if (outside) report(`${mapKey}|${descriptor.id}|-|end-outside-arena`, `${outside}/${colliders.length} parts end outside ±${sx}/±${sz}`);
    if (buried) report(`${mapKey}|${descriptor.id}|-|end-below-ground`, `${buried}/${colliders.length} parts end below y ${floor.toFixed(1)}`);
}

/**
 * Findings are keyed `map|modelId|pointId|kind` (pointId '-' when the finding is about the model).
 * @returns {Promise<{ findings: Map<string, string>, stats: Record<string, number>, coverage: number[], scannedMaps: string[] }>}
 */
export async function scanAnimatedSetpieces({ catalog = MAP_PRESET_CATALOG, pointsOverride = null } = {}) {
    const findings = new Map();
    const report = (key, detail) => { if (!findings.has(key)) findings.set(key, detail); };
    const stats = { maps: 0, models: 0, movingMeshes: 0, points: 0, loadMs: 0 };
    const coverage = [];
    const scannedMaps = [];
    for (const [mapKey, map] of Object.entries(catalog)) {
        const descriptors = normalizeGLBModelCollection(map?.glbModels, { animationClock: map?.glbAnimationClock });
        const animated = [];
        for (const descriptor of descriptors) {
            if (descriptor.url.startsWith('data:')) continue;
            if (!fileHasClips(descriptor.url)) continue;
            const loadStarted = performance.now();
            await loadGlb(descriptor.url);
            stats.loadMs += performance.now() - loadStarted;
            animated.push(descriptor);
        }
        if (!animated.length) continue;
        stats.maps += 1;
        scannedMaps.push(mapKey);
        const dynamicOnly = resolveGLBColliderMode(map.glbColliderMode) === 'dynamic';
        const points = pointsOverride?.(mapKey, map) ?? collectGameplayPoints(map);
        stats.points += points.length;
        for (const descriptor of animated) {
            stats.models += 1;
            const model = await placeModel(descriptor);
            const clock = descriptor.animationClock;
            if (clock.clipName && model.clip.name !== clock.clipName) {
                report(`${mapKey}|${descriptor.id}|-|clip-missing`, `clip "${clock.clipName}" not in file, plays "${model.clip.name}"`);
            }
            const cacheKey = [descriptor.url, ...descriptor.position, ...descriptor.rotation, descriptor.scale,
                descriptor.targetSize, model.clip.name, descriptor.collision, clock.mode].join('|');
            scanMotion(cacheKey, model, descriptor, mapKey, report);
            if (clock.mode === 'loop' && !descriptor.hiddenUntilTriggered
                && !isBeatAlignedClipDuration(model.clip.duration, normalizeMapAnimationClock(clock))) {
                report(`${mapKey}|${descriptor.id}|-|beat`, `${model.clip.name} ${model.clip.duration.toFixed(3)} s on a ${clock.beatSeconds} s beat`);
            }
            const animatedNodes = collectAnimatedNodes(model.glb.scene, [model.clip]);
            const colliders = model.glb.meshes.filter((mesh) => descriptor.collision && !isNoCollision(mesh) && !mesh.isSkinnedMesh);
            if (descriptor.hiddenUntilTriggered) {
                // A break scene is intangible until its event; only where it comes to rest matters.
                scanEndPose(map, mapKey, descriptor, model, colliders, report);
                continue;
            }
            const moving = colliders.filter((mesh) => animatedNodes.has(mesh));
            stats.movingMeshes += moving.length;
            if (moving.length) scanClearance(cacheKey, mapKey, descriptor, model, moving, points, report);
            if (!dynamicOnly) continue;
            model.pose(0);
            const uncovered = [];
            for (const mesh of colliders) {
                if (animatedNodes.has(mesh) || isForcedDynamic(mesh) || isCollisionOnly(mesh)) continue;
                const size = meshBox(mesh).getSize(new THREE.Vector3());
                if (Math.max(size.x, size.y, size.z) < MIN_COVERED_PART_EXTENT) continue;
                const share = surfaceCoverage(worldTriangles(mesh), map.obstacles || []);
                coverage.push(share);
                if (share < MIN_STATIC_COVERAGE) uncovered.push(`${mesh.name} ${Math.round(100 * share)}%`);
            }
            if (uncovered.length) {
                report(`${mapKey}|${descriptor.id}|-|static-uncovered`, `${uncovered.length} static parts without obstacle box: ${uncovered.slice(0, 4).join(', ')}${uncovered.length > 4 ? ', ...' : ''}`);
            }
        }
    }
    return { findings, stats, coverage, scannedMaps };
}
