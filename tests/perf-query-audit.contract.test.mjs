// Investigative equivalence tests for possible performance changes. These helpers deliberately
// live here rather than changing the production collision or rendering paths.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { createArenaRayResult, raycastArenaObstacles } from '../src/entities/arena/ArenaRayQuery.js';
import { DandelionSeedRenderBatch } from '../src/entities/arena/DandelionSeedRenderBatch.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';

const BOUNDS = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1000 };
const vector = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function box(name, min, max, extra = {}) {
    return {
        box: new THREE.Box3(vector(...min), vector(...max)),
        sourceName: name,
        kind: 'hard',
        ...extra,
    };
}

function raySnapshot(hit) {
    return {
        hit: hit.hit,
        distance: hit.distance,
        point: hit.point.toArray(),
        normal: hit.normal.toArray(),
        kind: hit.kind,
        isWall: hit.isWall,
        sourceName: hit.sourceName,
        obstacle: hit.obstacle,
    };
}

// A sphere enclosing the entire finite ray segment can use the existing grid. Filtering the
// original list with the candidate set retains its first-obstacle-wins tie semantics.
function indexedRaycast(collision, origin, direction, distance) {
    const obstacles = collision.arena.obstacles;
    if (!Number.isFinite(distance) || distance <= 0) {
        return { hit: raySnapshot(raycastArenaObstacles(obstacles, origin, direction, distance, createArenaRayResult())), candidates: 0 };
    }
    const midpoint = origin.clone().addScaledVector(direction, distance / 2);
    const selected = new Set(collision._getFastCollisionObstacles(midpoint, distance / 2 + 1e-6));
    const ordered = obstacles.filter((obstacle) => selected.has(obstacle));
    return {
        hit: raySnapshot(raycastArenaObstacles(ordered, origin, direction, distance, createArenaRayResult())),
        candidates: ordered.length,
    };
}

test('ray grid prototype preserves nearest hit, exact tie order, hollow skips and axis-parallel rays', (t) => {
    const obstacles = Array.from({ length: 48 }, (_, index) =>
        box(`far-${index}`, [80 + index * 20, -1, -1], [81 + index * 20, 1, 1]));
    const first = box('tie-first', [10, -2, -2], [12, 2, 2]);
    const second = box('tie-second', [10, -2, -2], [12, 2, 2]);
    obstacles.unshift(first, second);
    obstacles.push(box('tube', [14, -3, -3], [20, 3, 3], {
        tube: { ax: 14, ay: 0, az: 0, bx: 20, by: 0, bz: 0, innerRadius: 2, outerRadius: 3, lengthSq: 36 },
    }));
    obstacles.push(box('tunnel', [22, -3, -3], [28, 3, 3], {
        tunnel: { cx: 25, cy: 0, cz: 0, radius: 2, axis: 'x' },
    }));
    const collision = new ArenaCollision({ bounds: BOUNDS, obstacles });
    const rays = [
        [vector(), vector(1), 35],
        [vector(11), vector(1), 35], // origin inside both tied boxes
        [vector(0, 5), vector(1), 35], // parallel and outside Y slabs
        [vector(), vector(0, 1), 35],
        [vector(-500), vector(1), 1100], // deliberately exceeds the grid query budget
    ];
    let narrowed = 0;
    const candidateCounts = [];
    for (const [origin, direction, length] of rays) {
        const reference = raySnapshot(collision.raycast(origin, direction, length));
        const selected = indexedRaycast(collision, origin, direction, length);
        assert.deepEqual(selected.hit, reference);
        candidateCounts.push(selected.candidates);
        if (selected.candidates < obstacles.length) narrowed += 1;
    }
    assert.equal(raySnapshot(collision.raycast(vector(), vector(1), 35)).sourceName, 'tie-first');
    assert.ok(narrowed >= 1, 'the prototype should actually narrow at least one ray');
    t.diagnostic(`synthetic ray candidates: ${candidateCounts.join(', ')} / ${obstacles.length} obstacles; ${narrowed}/${rays.length} narrowed`);
});

test('ray grid prototype matches linear oracle over repeatable oblique queries', (t) => {
    const obstacles = Array.from({ length: 72 }, (_, index) => {
        const x = (index % 12) * 18 - 90;
        const y = (Math.floor(index / 12) % 3) * 12 - 12;
        const z = Math.floor(index / 36) * 24 - 12;
        return box(`grid-${index}`, [x, y, z], [x + 3, y + 3, z + 3]);
    });
    const collision = new ArenaCollision({ bounds: BOUNDS, obstacles });
    let seed = 0x9e3779b9;
    const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    let totalCandidates = 0;
    let narrowed = 0;
    for (let index = 0; index < 120; index += 1) {
        const origin = vector(next() * 220 - 110, next() * 60 - 30, next() * 80 - 40);
        const direction = vector(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize();
        const length = 1 + next() * 180;
        const selected = indexedRaycast(collision, origin, direction, length);
        assert.deepEqual(selected.hit, raySnapshot(collision.raycast(origin, direction, length)), `ray ${index}`);
        totalCandidates += selected.candidates;
        if (selected.candidates < obstacles.length) narrowed += 1;
    }
    t.diagnostic(`synthetic oblique rays: ${totalCandidates}/8640 candidate-obstacle pairs; ${narrowed}/120 narrowed`);
});

test('ray grid prototype follows dynamic movement, invalidation and static list changes', () => {
    const obstacles = Array.from({ length: 16 }, (_, index) =>
        box(`static-${index}`, [40 + index * 30, -1, -1], [42 + index * 30, 1, 1]));
    const moving = box('moving', [8, -1, -1], [10, 1, 1], { dynamic: true });
    obstacles.push(moving);
    const arena = { bounds: BOUNDS, obstacles, staticCollisionRevision: 0 };
    const collision = new ArenaCollision(arena);
    const origin = vector();
    const direction = vector(1);
    const check = () => assert.deepEqual(indexedRaycast(collision, origin, direction, 100).hit,
        raySnapshot(collision.raycast(origin, direction, 100)));
    check();
    moving.box.translate(vector(80));
    collision.invalidateDynamicObstacles();
    check();
    arena.obstacles.splice(0, 1);
    arena.staticCollisionRevision += 1;
    check();
    arena.obstacles.unshift(box('new-front', [3, -1, -1], [4, 1, 1]));
    arena.staticCollisionRevision += 1;
    check();
    assert.equal(indexedRaycast(collision, origin, direction, 100).hit.sourceName, 'new-front');
});

function arenaFor(obstacles) {
    const collision = new ArenaCollision({ bounds: BOUNDS, obstacles });
    return {
        getCollisionInfo: (point, radius) => collision.getCollisionInfo(point, radius),
        checkCollisionBroad: (point, radius, bot) => collision.checkCollisionBroad(point, radius, bot),
        raycast: (origin, direction, distance) => collision.raycast(origin, direction, distance),
    };
}

function collisionSnapshot(hit, position) {
    return {
        hit: !!hit?.hit,
        kind: hit?.kind || '',
        isWall: !!hit?.isWall,
        normal: hit?.normal?.toArray?.() || null,
        position: position.toArray(),
    };
}

function comparePlayerSweep(arena, from, to, radius, isBot = false) {
    const baselinePlayer = { position: to.clone(), isBot };
    const baseline = new PlayerCollisionPhase({ arena });
    const reference = collisionSnapshot(baseline._probeSweptArenaCollision(baselinePlayer, from, radius), baselinePlayer.position);
    const guardedPlayer = { position: to.clone(), isBot };
    const guarded = new PlayerCollisionPhase({ arena });
    const center = from.clone().add(to).multiplyScalar(0.5);
    const envelopeRadius = from.distanceTo(to) / 2 + radius;
    const possible = arena.checkCollisionBroad(center, envelopeRadius, isBot);
    const answer = collisionSnapshot(possible
        ? guarded._probeSweptArenaCollision(guardedPlayer, from, radius)
        : null, guardedPlayer.position);
    assert.deepEqual(answer, reference);
    return possible;
}

test('non-Arcade player sweep guard agrees for thin walls, tube ends, tunnel hole and open space', () => {
    const thin = box('thin', [-0.01, -1, -1], [0.01, 1, 1]);
    const tube = box('tube', [-3, -2, -2], [3, 2, 2], {
        tube: { ax: -3, ay: 0, az: 0, bx: 3, by: 0, bz: 0, innerRadius: 1, outerRadius: 2, lengthSq: 36 },
    });
    const tunnel = box('tunnel', [-3, -2, -2], [3, 2, 2], {
        tunnel: { cx: 0, cy: 0, cz: 0, radius: 1.5, axis: 'x' },
    });
    assert.equal(comparePlayerSweep(arenaFor([thin]), vector(-3), vector(3), 0.2), true);
    comparePlayerSweep(arenaFor([tube]), vector(-4, 1.6), vector(4, 1.6), 0.2);
    comparePlayerSweep(arenaFor([tunnel]), vector(-4), vector(4), 0.2);
    assert.equal(comparePlayerSweep(arenaFor([]), vector(-4), vector(4), 0.2), false);
});

function compareProjectile(arena, from, to, radius, seedHit = null) {
    arena.raycastDandelionSeed = () => seedHit;
    const makeProjectile = () => ({ previousPosition: from.clone(), position: to.clone(), radius });
    const baselineProjectile = makeProjectile();
    const referenceHit = new ProjectileSimulationOps({})._resolveArenaCollision(baselineProjectile, arena);
    const reference = collisionSnapshot(referenceHit, baselineProjectile.position);
    const center = from.clone().add(to).multiplyScalar(0.5);
    const possible = arena.checkCollisionBroad(center, from.distanceTo(to) / 2 + radius);
    const guardedArena = {
        ...arena,
        getCollisionInfo: possible ? arena.getCollisionInfo : () => null,
    };
    const guardedProjectile = makeProjectile();
    const guardedHit = new ProjectileSimulationOps({})._resolveArenaCollision(guardedProjectile, guardedArena);
    assert.deepEqual(collisionSnapshot(guardedHit, guardedProjectile.position), reference);
    return { possible, hit: guardedHit };
}

test('projectile sample guard preserves thin-wall and foam contacts', () => {
    const thin = box('thin', [-0.01, -1, -1], [0.01, 1, 1]);
    const foam = box('foam', [1, -1, -1], [1.2, 1, 1], { kind: 'foam' });
    assert.equal(compareProjectile(arenaFor([thin]), vector(-2), vector(2), 0.2).hit?.hit, true);
    assert.equal(compareProjectile(arenaFor([foam]), vector(-2), vector(2), 0.2).hit?.kind, 'foam');
    assert.equal(compareProjectile(arenaFor([]), vector(-2), vector(2), 0.2).possible, false);
});

test('seed raycast remains before projectile arena guard and retains wall-blocker precedence', () => {
    const seedHit = { distance: 3, point: vector(3), sourceName: 'seed-3' };
    const open = compareProjectile(arenaFor([]), vector(), vector(5), 0.2, seedHit);
    assert.equal(open.possible, false);
    assert.equal(open.hit?.sourceName, 'seed-3');
    const blocker = box('blocker', [2, -1, -1], [2.1, 1, 1]);
    const blocked = compareProjectile(arenaFor([blocker]), vector(), vector(5), 0.2, seedHit);
    assert.notEqual(blocked.hit?.sourceName, 'seed-3');
});

function makeSeedBatch() {
    const scene = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const seeds = Array.from({ length: 40 }, (_, index) => {
        const node = new THREE.Group();
        node.position.set(index * 0.4, 0, 0);
        node.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), material));
        scene.add(node);
        return { index, node, height: 2 };
    });
    scene.updateWorldMatrix(true, true);
    return { batch: DandelionSeedRenderBatch.create(scene, seeds), seeds };
}

test('incremental sphere union contains every visible moving instance, including hide and reset', () => {
    const { batch, seeds } = makeSeedBatch();
    const candidates = new Map(batch._meshes.map((mesh) => [mesh, mesh.boundingSphere.clone()]));
    const matrix = new THREE.Matrix4();
    const instanceSphere = new THREE.Sphere();
    const vertex = new THREE.Vector3();
    const assertVisibleContained = (hidden) => {
        for (const seed of seeds) {
            if (hidden.has(seed)) continue;
            for (const entry of batch._entriesBySeed.get(seed)) {
                const mesh = entry.mesh;
                if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
                mesh.getMatrixAt(entry.instanceId, matrix);
                instanceSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
                const candidate = candidates.get(mesh);
                assert.ok(candidate.center.distanceTo(instanceSphere.center) + instanceSphere.radius
                    <= candidate.radius + 1e-7, `instance ${seed.index} escaped conservative bounds`);
                const positions = mesh.geometry.getAttribute('position');
                for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
                    vertex.fromBufferAttribute(positions, vertexIndex).applyMatrix4(matrix);
                    assert.ok(candidate.distanceToPoint(vertex) <= 1e-6,
                        `instance ${seed.index} vertex ${vertexIndex} escaped conservative bounds`);
                }
            }
        }
    };
    const hidden = new Set();
    for (let frame = 1; frame <= 8; frame += 1) {
        batch.beginUpdate();
        for (const seed of seeds) {
            if (seed.index % 9 === 0 && frame >= 4) {
                hidden.add(seed);
                batch.updateSeed(seed, false);
                continue;
            }
            seed.node.position.set(seed.index * 0.4 + frame * 0.3, frame * (seed.index % 5), 0);
            batch.updateSeed(seed, true);
            for (const entry of batch._entriesBySeed.get(seed)) {
                const mesh = entry.mesh;
                if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
                mesh.getMatrixAt(entry.instanceId, matrix);
                instanceSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
                candidates.get(mesh).union(instanceSphere);
            }
        }
        batch.commit(); // production's exact refit provides an independent reference each frame
        assertVisibleContained(hidden);
    }
    // A periodic exact refit can safely discard the accumulated conservative slack.
    for (const mesh of batch._meshes) candidates.set(mesh, mesh.boundingSphere.clone());
    batch.beginUpdate();
    for (const seed of seeds) {
        seed.node.position.set(seed.index * 0.4, 0, 0);
        hidden.delete(seed);
        batch.updateSeed(seed, true);
        for (const entry of batch._entriesBySeed.get(seed)) {
            const mesh = entry.mesh;
            mesh.getMatrixAt(entry.instanceId, matrix);
            instanceSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
            candidates.get(mesh).union(instanceSphere);
        }
    }
    batch.commit();
    assertVisibleContained(hidden);
});

test('real Three LOD changes shadow-caster visibility between split-screen cameras', () => {
    const lod = new THREE.LOD();
    const near = new THREE.Group();
    const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    caster.castShadow = true;
    near.add(caster);
    lod.addLevel(near, 0);
    lod.addLevel(new THREE.Group(), 10);
    const cameraA = new THREE.PerspectiveCamera();
    cameraA.position.set(0, 0, 2);
    cameraA.updateMatrixWorld();
    const cameraB = new THREE.PerspectiveCamera();
    cameraB.position.set(0, 0, 20);
    cameraB.updateMatrixWorld();
    lod.updateMatrixWorld(true);
    lod.update(cameraA);
    assert.equal(near.visible, true);
    lod.update(cameraB);
    assert.equal(near.visible, false, 'a reused first-camera map would retain a shadow caster hidden for camera B');
});
