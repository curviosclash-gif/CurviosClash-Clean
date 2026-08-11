import * as THREE from 'three';
import { sphereIntersectsStaticMeshCollider } from './StaticMeshCollider.js';

// Static normals for arena wall collisions (single allocation).
const NORMAL_PX = Object.freeze(new THREE.Vector3(1, 0, 0));
const NORMAL_NX = Object.freeze(new THREE.Vector3(-1, 0, 0));
const NORMAL_PY = Object.freeze(new THREE.Vector3(0, 1, 0));
const NORMAL_NY = Object.freeze(new THREE.Vector3(0, -1, 0));
const NORMAL_PZ = Object.freeze(new THREE.Vector3(0, 0, 1));
const NORMAL_NZ = Object.freeze(new THREE.Vector3(0, 0, -1));
const OBSTACLE_GRID_SIZE = 16;
const OBSTACLE_GRID_MIN_COUNT = 12;
const OBSTACLE_GRID_MAX_CELLS = 2048;
const OBSTACLE_QUERY_MAX_CELLS = 512;

function getObstacleGridKey(x, y, z) {
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));
}

function normalizeTunnelAxis(axis) {
    if (axis === 'x' || axis === 'y' || axis === 'z') return axis;
    return 'z';
}

function isInsideTunnel(point, tunnel, radius = 0) {
    if (!point || !tunnel || typeof tunnel !== 'object') return false;

    const tunnelRadius = Number(tunnel.radius);
    if (!Number.isFinite(tunnelRadius) || tunnelRadius <= 0) return false;

    const probeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const effectiveRadius = tunnelRadius - probeRadius;
    if (effectiveRadius <= 0) return false;

    const cx = Number.isFinite(tunnel.cx) ? tunnel.cx : 0;
    const cy = Number.isFinite(tunnel.cy) ? tunnel.cy : 0;
    const cz = Number.isFinite(tunnel.cz) ? tunnel.cz : 0;
    const axis = normalizeTunnelAxis(tunnel.axis);

    let d1 = 0;
    let d2 = 0;
    if (axis === 'x') {
        d1 = point.y - cy;
        d2 = point.z - cz;
    } else if (axis === 'y') {
        d1 = point.x - cx;
        d2 = point.z - cz;
    } else {
        d1 = point.x - cx;
        d2 = point.y - cy;
    }

    return (d1 * d1 + d2 * d2) < (effectiveRadius * effectiveRadius);
}

function getTubeCollisionInfo(point, tube, radius = 0, outNormal = null) {
    if (!point || !tube || typeof tube !== 'object') return false;
    const ax = Number(tube.ax);
    const ay = Number(tube.ay);
    const az = Number(tube.az);
    const bx = Number(tube.bx);
    const by = Number(tube.by);
    const bz = Number(tube.bz);
    const lengthSq = Number(tube.lengthSq);
    if (![ax, ay, az, bx, by, bz, lengthSq].every(Number.isFinite) || lengthSq <= 0.0001) {
        return false;
    }

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const apx = point.x - ax;
    const apy = point.y - ay;
    const apz = point.z - az;
    const projection = (apx * abx + apy * aby + apz * abz) / lengthSq;
    if (projection < 0 || projection > 1) {
        return false;
    }

    const cx = ax + abx * projection;
    const cy = ay + aby * projection;
    const cz = az + abz * projection;
    const rx = point.x - cx;
    const ry = point.y - cy;
    const rz = point.z - cz;
    const radialDistanceSq = rx * rx + ry * ry + rz * rz;
    const innerRadius = Number(tube.innerRadius);
    const outerRadius = Number(tube.outerRadius);
    if (!Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) || outerRadius <= 0) {
        return false;
    }

    const probeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
    const collisionRadius = outerRadius + probeRadius;
    if (radialDistanceSq > collisionRadius * collisionRadius) {
        return false;
    }

    const safeInnerRadius = innerRadius - probeRadius;
    if (safeInnerRadius > 0 && radialDistanceSq < safeInnerRadius * safeInnerRadius) {
        return false;
    }

    if (outNormal) {
        outNormal.set(rx, ry, rz);
        if (outNormal.lengthSq() <= 0.000001) {
            outNormal.set(0, 1, 0);
        } else {
            outNormal.normalize();
        }
    }

    return true;
}

export class ArenaCollision {
    constructor(arena) {
        this.arena = arena;
        this._tmpSphere = new THREE.Sphere();
        this._tmpNormal = new THREE.Vector3();
        this._collisionResult = { hit: false, kind: '', isWall: false, normal: new THREE.Vector3() };
        this._obstacleGrid = new Map();
        this._obstacleGridSource = null;
        this._obstacleGridSourceCount = -1;
        this._obstacleGridGlobal = [];
        this._obstacleCandidates = [];
        this._obstacleSeenAt = new WeakMap();
        this._obstacleQueryId = 0;
        this._dynamicGrid = new Map();
        this._dynamicGridGlobal = [];
        this._dynamicObstacles = [];
        this._dynamicGridDirty = true;
    }

    // Called once per frame after the animated GLB colliders moved.
    invalidateDynamicObstacles() {
        this._dynamicGridDirty = true;
    }

    _insertObstacleIntoGrid(obstacle, grid, globalList) {
        const box = obstacle?.box;
        if (!box?.min || !box?.max) {
            globalList.push(obstacle);
            return;
        }
        const minX = Math.floor(box.min.x / OBSTACLE_GRID_SIZE);
        const maxX = Math.floor(box.max.x / OBSTACLE_GRID_SIZE);
        const minY = Math.floor(box.min.y / OBSTACLE_GRID_SIZE);
        const maxY = Math.floor(box.max.y / OBSTACLE_GRID_SIZE);
        const minZ = Math.floor(box.min.z / OBSTACLE_GRID_SIZE);
        const maxZ = Math.floor(box.max.z / OBSTACLE_GRID_SIZE);
        const cellCount = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (!Number.isFinite(cellCount) || cellCount > OBSTACLE_GRID_MAX_CELLS) {
            globalList.push(obstacle);
            return;
        }
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = getObstacleGridKey(x, y, z);
                    let bucket = grid.get(key);
                    if (!bucket) {
                        bucket = [];
                        grid.set(key, bucket);
                    }
                    bucket.push(obstacle);
                }
            }
        }
    }

    _rebuildObstacleGrid(obstacles) {
        this._obstacleGrid.clear();
        this._obstacleGridGlobal.length = 0;
        this._obstacleGridSource = obstacles;
        this._obstacleGridSourceCount = obstacles.length;
        this._dynamicObstacles.length = 0;

        for (const obstacle of obstacles) {
            // Animated colliders change their cells every frame, so they are kept out of
            // this grid — it is only rebuilt when the map itself changes.
            if (obstacle?.dynamic) {
                this._dynamicObstacles.push(obstacle);
                continue;
            }
            this._insertObstacleIntoGrid(obstacle, this._obstacleGrid, this._obstacleGridGlobal);
        }
        this._dynamicGridDirty = true;
    }

    _rebuildDynamicGrid() {
        this._dynamicGridDirty = false;
        this._dynamicGrid.clear();
        this._dynamicGridGlobal.length = 0;
        for (const obstacle of this._dynamicObstacles) {
            this._insertObstacleIntoGrid(obstacle, this._dynamicGrid, this._dynamicGridGlobal);
        }
    }

    _getFastCollisionObstacles(position, radius) {
        const obstacles = Array.isArray(this.arena?.obstacles) ? this.arena.obstacles : [];
        if (obstacles.length < OBSTACLE_GRID_MIN_COUNT) return obstacles;
        if (this._obstacleGridSource !== obstacles || this._obstacleGridSourceCount !== obstacles.length) {
            this._rebuildObstacleGrid(obstacles);
        }
        if (this._dynamicGridDirty) this._rebuildDynamicGrid();

        const minX = Math.floor((position.x - radius) / OBSTACLE_GRID_SIZE);
        const maxX = Math.floor((position.x + radius) / OBSTACLE_GRID_SIZE);
        const minY = Math.floor((position.y - radius) / OBSTACLE_GRID_SIZE);
        const maxY = Math.floor((position.y + radius) / OBSTACLE_GRID_SIZE);
        const minZ = Math.floor((position.z - radius) / OBSTACLE_GRID_SIZE);
        const maxZ = Math.floor((position.z + radius) / OBSTACLE_GRID_SIZE);
        const cellCount = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        if (!Number.isFinite(cellCount) || cellCount > OBSTACLE_QUERY_MAX_CELLS) return obstacles;

        const candidates = this._obstacleCandidates;
        candidates.length = 0;
        const queryId = ++this._obstacleQueryId;
        for (const obstacle of this._obstacleGridGlobal) {
            this._appendObstacleCandidate(obstacle, queryId, candidates);
        }
        for (const obstacle of this._dynamicGridGlobal) {
            this._appendObstacleCandidate(obstacle, queryId, candidates);
        }
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const key = getObstacleGridKey(x, y, z);
                    const bucket = this._obstacleGrid.get(key);
                    const dynamicBucket = this._dynamicGrid.get(key);
                    if (dynamicBucket) {
                        for (const obstacle of dynamicBucket) {
                            this._appendObstacleCandidate(obstacle, queryId, candidates);
                        }
                    }
                    if (!bucket) continue;
                    for (const obstacle of bucket) {
                        this._appendObstacleCandidate(obstacle, queryId, candidates);
                    }
                }
            }
        }
        return candidates;
    }

    _appendObstacleCandidate(obstacle, queryId, candidates) {
        if (!obstacle || this._obstacleSeenAt.get(obstacle) === queryId) return;
        this._obstacleSeenAt.set(obstacle, queryId);
        candidates.push(obstacle);
    }

    _computeBoxCollisionNormal(box, point) {
        const dMinX = Math.abs(point.x - box.min.x);
        const dMaxX = Math.abs(box.max.x - point.x);
        const dMinY = Math.abs(point.y - box.min.y);
        const dMaxY = Math.abs(box.max.y - point.y);
        const dMinZ = Math.abs(point.z - box.min.z);
        const dMaxZ = Math.abs(box.max.z - point.z);

        const normal = this._tmpNormal;
        let minDist = dMinX;
        normal.set(-1, 0, 0);

        if (dMaxX < minDist) { minDist = dMaxX; normal.set(1, 0, 0); }
        if (dMinY < minDist) { minDist = dMinY; normal.set(0, -1, 0); }
        if (dMaxY < minDist) { minDist = dMaxY; normal.set(0, 1, 0); }
        if (dMinZ < minDist) { minDist = dMinZ; normal.set(0, 0, -1); }
        if (dMaxZ < minDist) { normal.set(0, 0, 1); }

        return normal;
    }

    getCollisionInfo(position, radius) {
        const b = this.arena.bounds;
        if (!position) return null;

        if (position.x - radius < b.minX) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_PX);
            return this._collisionResult;
        }
        if (position.x + radius > b.maxX) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_NX);
            return this._collisionResult;
        }
        if (position.y - radius < b.minY) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_PY);
            return this._collisionResult;
        }
        if (position.y + radius > b.maxY) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_NY);
            return this._collisionResult;
        }
        if (position.z - radius < b.minZ) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_PZ);
            return this._collisionResult;
        }
        if (position.z + radius > b.maxZ) {
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_NZ);
            return this._collisionResult;
        }

        this._tmpSphere.center.copy(position);
        this._tmpSphere.radius = radius;
        for (const obs of this._getFastCollisionObstacles(position, radius)) {
            if (!obs.box.intersectsSphere(this._tmpSphere)) continue;
            if (obs.meshCollider && !sphereIntersectsStaticMeshCollider(
                obs.meshCollider,
                position,
                radius,
                this._tmpNormal,
            )) continue;
            if (obs.meshCollider) {
                this._collisionResult.hit = true;
                this._collisionResult.kind = obs.kind || 'hard';
                this._collisionResult.isWall = !!obs.isWall;
                this._collisionResult.normal.copy(this._tmpNormal);
                return this._collisionResult;
            }
            if (obs.tube && !getTubeCollisionInfo(position, obs.tube, radius, this._tmpNormal)) continue;
            if (obs.tube) {
                this._collisionResult.hit = true;
                this._collisionResult.kind = obs.kind || (obs.isWall ? 'wall' : 'hard');
                this._collisionResult.isWall = !!obs.isWall;
                this._collisionResult.normal.copy(this._tmpNormal);
                return this._collisionResult;
            }
            if (obs.tunnel && isInsideTunnel(position, obs.tunnel, radius)) continue;
            this._collisionResult.hit = true;
            this._collisionResult.kind = obs.kind || (obs.isWall ? 'wall' : 'hard');
            this._collisionResult.isWall = !!obs.isWall;
            this._collisionResult.normal.copy(this._computeBoxCollisionNormal(obs.box, position));
            return this._collisionResult;
        }

        return null;
    }

    checkCollisionFast(position, radius = 0) {
        const b = this.arena.bounds;
        if (!position) return false;

        if (position.x - radius < b.minX || position.x + radius > b.maxX ||
            position.y - radius < b.minY || position.y + radius > b.maxY ||
            position.z - radius < b.minZ || position.z + radius > b.maxZ) {
            return true;
        }

        this._tmpSphere.center.copy(position);
        this._tmpSphere.radius = radius;
        for (const obs of this._getFastCollisionObstacles(position, radius)) {
            if (!obs.box.intersectsSphere(this._tmpSphere)) continue;
            if (obs.meshCollider && sphereIntersectsStaticMeshCollider(obs.meshCollider, position, radius)) return true;
            if (obs.meshCollider) continue;
            if (obs.tube && getTubeCollisionInfo(position, obs.tube, radius)) return true;
            if (obs.tube) continue;
            if (obs.tunnel && isInsideTunnel(position, obs.tunnel, radius)) continue;
            return true;
        }
        return false;
    }
}
