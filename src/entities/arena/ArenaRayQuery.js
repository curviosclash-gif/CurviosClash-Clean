// Ray queries against the arena's obstacle list. Kept beside ArenaCollision instead of inside
// it so neither module grows past the size budget.
//
// The hitscan machine gun is the first caller: it needs to know whether map geometry stands
// between the muzzle and its target, and which mesh it is, so a shot can stop at a wall and a
// destructible tower segment can take the damage.

import * as THREE from 'three';

import { raycastStaticMeshCollider } from './StaticMeshCollider.js';

const RAY_EPSILON = 1e-7;
const RAY_SLAB_LIMIT = 1e20;

// Scratch for one query. Ray queries never nest, so module level stays allocation-free.
const BOX_HIT = new Float64Array(4);
const MESH_HIT = { distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

function safeReciprocal(value) {
    if (value > RAY_EPSILON || value < -RAY_EPSILON) return 1 / value;
    return value < 0 ? -RAY_SLAB_LIMIT : RAY_SLAB_LIMIT;
}

/**
 * Entry distance of the ray into an axis aligned box, written to BOX_HIT together with the
 * outward normal of the face it enters through. Returns false when the box is missed or lies
 * beyond maxDistance. An origin already inside the box enters at distance 0 and reports the
 * normal facing back along the ray.
 */
function rayIntersectsBox(box, origin, direction, inverseX, inverseY, inverseZ, maxDistance) {
    let nearest = 0;
    let farthest = maxDistance;
    let axis = -1;

    const tx1 = (box.min.x - origin.x) * inverseX;
    const tx2 = (box.max.x - origin.x) * inverseX;
    let near = Math.min(tx1, tx2);
    let far = Math.max(tx1, tx2);
    if (near > nearest) { nearest = near; axis = 0; }
    if (far < farthest) farthest = far;

    const ty1 = (box.min.y - origin.y) * inverseY;
    const ty2 = (box.max.y - origin.y) * inverseY;
    near = Math.min(ty1, ty2);
    far = Math.max(ty1, ty2);
    if (near > nearest) { nearest = near; axis = 1; }
    if (far < farthest) farthest = far;

    const tz1 = (box.min.z - origin.z) * inverseZ;
    const tz2 = (box.max.z - origin.z) * inverseZ;
    near = Math.min(tz1, tz2);
    far = Math.max(tz1, tz2);
    if (near > nearest) { nearest = near; axis = 2; }
    if (far < farthest) farthest = far;

    if (farthest < nearest) return false;

    BOX_HIT[0] = nearest;
    BOX_HIT[1] = 0; BOX_HIT[2] = 0; BOX_HIT[3] = 0;
    if (axis === 0) BOX_HIT[1] = inverseX >= 0 ? -1 : 1;
    else if (axis === 1) BOX_HIT[2] = inverseY >= 0 ? -1 : 1;
    else if (axis === 2) BOX_HIT[3] = inverseZ >= 0 ? -1 : 1;
    else {
        BOX_HIT[1] = -direction.x;
        BOX_HIT[2] = -direction.y;
        BOX_HIT[3] = -direction.z;
    }
    return true;
}

/** The reusable shape every arena ray query answers with. */
export function createArenaRayResult() {
    return {
        hit: false,
        distance: 0,
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        kind: '',
        isWall: false,
        sourceName: '',
        obstacle: null,
    };
}

/**
 * Nearest obstacle along a ray. `direction` must be normalized. Mesh obstacles are tested
 * triangle exact behind their AABB; plain box obstacles are answered by their AABB entry,
 * which is precise enough for a bullet that only needs to know where the world stops.
 * Arena bounds are not part of this query.
 *
 * Tube and tunnel obstacles are skipped entirely: their solid part is a ring wall inside a box
 * that is mostly hollow. Answering them by that box would block a shot through the opening and,
 * worse, report a hit at distance 0 for a muzzle standing inside the tube - which would swallow
 * every shot fired from inside a tunnel. Until there is a shape exact ray test for them, the
 * machine gun passes through rings and tunnels.
 *
 * Foam keeps blocking the ray. Soft cover is still cover: a projectile bounces off it, so a
 * bullet must not fly through it either.
 */
export function raycastArenaObstacles(obstacles, origin, direction, maxDistance, result) {
    result.hit = false;
    result.distance = 0;
    result.kind = '';
    result.isWall = false;
    result.sourceName = '';
    result.obstacle = null;
    result.point.set(0, 0, 0);
    result.normal.set(0, 1, 0);

    const limit = Number(maxDistance);
    if (!Array.isArray(obstacles) || !origin || !direction || !Number.isFinite(limit) || limit <= 0) {
        return result;
    }

    const inverseX = safeReciprocal(direction.x);
    const inverseY = safeReciprocal(direction.y);
    const inverseZ = safeReciprocal(direction.z);
    let best = limit;

    for (const obstacle of obstacles) {
        const box = obstacle?.box;
        if (!box?.min || !box?.max) continue;
        // A hollow shape cannot be approximated by its box without lying in both directions.
        // These are always authored box obstacles, never mesh colliders.
        if (obstacle.tube || obstacle.tunnel) continue;
        if (!rayIntersectsBox(box, origin, direction, inverseX, inverseY, inverseZ, best)) continue;
        const entryDistance = BOX_HIT[0];
        if (entryDistance >= best) continue;

        if (obstacle.meshCollider) {
            if (!raycastStaticMeshCollider(obstacle.meshCollider, origin, direction, best, MESH_HIT)) continue;
            best = MESH_HIT.distance;
            result.distance = MESH_HIT.distance;
            result.point.set(MESH_HIT.x, MESH_HIT.y, MESH_HIT.z);
            result.normal.set(MESH_HIT.nx, MESH_HIT.ny, MESH_HIT.nz);
            result.kind = obstacle.kind || 'hard';
        } else {
            best = entryDistance;
            result.distance = entryDistance;
            result.point.set(
                origin.x + direction.x * entryDistance,
                origin.y + direction.y * entryDistance,
                origin.z + direction.z * entryDistance,
            );
            result.normal.set(BOX_HIT[1], BOX_HIT[2], BOX_HIT[3]);
            result.kind = obstacle.kind || (obstacle.isWall ? 'wall' : 'hard');
        }
        result.hit = true;
        result.isWall = !!obstacle.isWall;
        result.sourceName = typeof obstacle.sourceName === 'string' ? obstacle.sourceName : '';
        result.obstacle = obstacle;
    }

    return result;
}
