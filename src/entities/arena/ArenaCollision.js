import * as THREE from 'three';

// Static normals for arena wall collisions (single allocation).
const NORMAL_PX = Object.freeze(new THREE.Vector3(1, 0, 0));
const NORMAL_NX = Object.freeze(new THREE.Vector3(-1, 0, 0));
const NORMAL_PY = Object.freeze(new THREE.Vector3(0, 1, 0));
const NORMAL_NY = Object.freeze(new THREE.Vector3(0, -1, 0));
const NORMAL_PZ = Object.freeze(new THREE.Vector3(0, 0, 1));

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
            this._collisionResult.hit = true; this._collisionResult.kind = 'wall'; this._collisionResult.isWall = true; this._collisionResult.normal.copy(NORMAL_PZ);
            return this._collisionResult;
        }

        this._tmpSphere.center.copy(position);
        this._tmpSphere.radius = radius;
        for (const obs of this.arena.obstacles) {
            if (!obs.box.intersectsSphere(this._tmpSphere)) continue;
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
        for (const obs of this.arena.obstacles) {
            if (!obs.box.intersectsSphere(this._tmpSphere)) continue;
            if (obs.tube && getTubeCollisionInfo(position, obs.tube, radius)) return true;
            if (obs.tube) continue;
            if (obs.tunnel && isInsideTunnel(position, obs.tunnel, radius)) continue;
            return true;
        }
        return false;
    }
}
