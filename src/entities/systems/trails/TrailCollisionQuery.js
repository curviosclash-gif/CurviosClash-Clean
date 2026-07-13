import * as THREE from 'three';
import { TrailCollisionDebugTelemetry } from './TrailCollisionDebugTelemetry.js';

const GRID_KEY_OFFSET = 1000;
const GRID_KEY_STRIDE = 2000;
const CELL_OFFSETS_3X3 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

export class TrailCollisionQuery {
    constructor(options = {}) {
        this.getPlayers = typeof options.getPlayers === 'function'
            ? options.getPlayers
            : (() => options.players || []);
        this.getRegistry = typeof options.getRegistry === 'function'
            ? options.getRegistry
            : (() => options.registry || null);
        this.debugTelemetry = new TrailCollisionDebugTelemetry(options.debugConfig);
        this._trailCollisionResult = { hit: false, playerIndex: -1 };
        this._projectileTrailCollisionResult = {
            entry: null,
            closestPoint: { closestX: 0, closestY: 0, closestZ: 0 },
            cellKey: 0,
            _bestDistSq: Infinity,
        };
        this._tmpClosestPoint = new THREE.Vector3();
        this._tmpClosestPointData = { closestX: 0, closestY: 0, closestZ: 0 };
        this._projectileQueryStamp = 1;
        this._globalQueryStamp = 1;
    }

    _debugTrailCollision(tag, payload) {
        this.debugTelemetry.log(tag, payload);
    }

    _shouldLogSkipRecentCandidate(dist, skipRecent) {
        return this.debugTelemetry.shouldLogSkipRecentCandidate(dist, skipRecent);
    }

    _segmentIntersectsSphere(seg, position, radius, outClosestPoint = null) {
        const totalRadius = radius + seg.radius;
        const minX = Math.min(seg.fromX, seg.toX) - seg.radius;
        const maxX = Math.max(seg.fromX, seg.toX) + seg.radius;
        if (position.x < minX - radius || position.x > maxX + radius) return false;

        const minY = Math.min(seg.fromY, seg.toY) - seg.radius;
        const maxY = Math.max(seg.fromY, seg.toY) + seg.radius;
        if (position.y < minY - radius || position.y > maxY + radius) return false;

        const minZ = Math.min(seg.fromZ, seg.toZ) - seg.radius;
        const maxZ = Math.max(seg.fromZ, seg.toZ) + seg.radius;
        if (position.z < minZ - radius || position.z > maxZ + radius) return false;

        const vx = seg.toX - seg.fromX;
        const vy = seg.toY - seg.fromY;
        const vz = seg.toZ - seg.fromZ;
        const wx = position.x - seg.fromX;
        const wy = position.y - seg.fromY;
        const wz = position.z - seg.fromZ;

        const lenSq = vx * vx + vy * vy + vz * vz;
        let t = 0;
        if (lenSq > 0.000001) {
            t = Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / lenSq));
        }

        const closestX = seg.fromX + t * vx;
        const closestY = seg.fromY + t * vy;
        const closestZ = seg.fromZ + t * vz;

        const dxp = position.x - closestX;
        const dyp = position.y - closestY;
        const dzp = position.z - closestZ;
        const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
        if (distSq > totalRadius * totalRadius) {
            return false;
        }

        if (outClosestPoint) {
            outClosestPoint.closestX = closestX;
            outClosestPoint.closestY = closestY;
            outClosestPoint.closestZ = closestZ;
        }
        return true;
    }

    _nextProjectileQueryStamp() {
        this._projectileQueryStamp += 1;
        return this._projectileQueryStamp;
    }

    _nextGlobalQueryStamp() {
        this._globalQueryStamp += 1;
        return this._globalQueryStamp;
    }

    checkProjectileTrailCollision(position, radius, options = {}) {
        const registry = this.getRegistry();
        if (!position || !registry) return null;

        const excludePlayerIndex = Number.isInteger(options.excludePlayerIndex) ? options.excludePlayerIndex : -1;
        const skipRecent = Math.max(0, Number(options.skipRecent) || 0);
        const cellX = Math.floor(position.x / registry.gridSize);
        const cellZ = Math.floor(position.z / registry.gridSize);
        const players = this.getPlayers();
        const queryStamp = this._nextProjectileQueryStamp();
        const result = this._projectileTrailCollisionResult;
        result.entry = null;
        result._bestDistSq = Infinity;

        for (let i = 0; i < CELL_OFFSETS_3X3.length; i++) {
            const [dx, dz] = CELL_OFFSETS_3X3[i];
            const key = (cellX + dx + GRID_KEY_OFFSET) * GRID_KEY_STRIDE + (cellZ + dz + GRID_KEY_OFFSET);
                const cell = registry.spatialGrid.get(key);
                if (!cell) continue;

                for (const seg of cell) {
                    if (!seg || seg.destroyed) continue;
                    if (seg._projectileTrailQueryStamp === queryStamp) continue;
                    seg._projectileTrailQueryStamp = queryStamp;

                    if (seg.playerIndex === excludePlayerIndex && skipRecent > 0) {
                        const player = players[seg.playerIndex];
                        const trail = player?.trail;
                        if (trail) {
                            const dist = (trail.writeIndex - 1 - seg.segmentIdx + trail.maxSegments) % trail.maxSegments;
                            if (dist < skipRecent) {
                                continue;
                            }
                        }
                    }

                    if (!this._segmentIntersectsSphere(seg, position, radius, this._tmpClosestPointData)) continue;

                    const hdx = position.x - this._tmpClosestPointData.closestX;
                    const hdy = position.y - this._tmpClosestPointData.closestY;
                    const hdz = position.z - this._tmpClosestPointData.closestZ;
                    const hitDistSq = hdx * hdx + hdy * hdy + hdz * hdz;
                    if (hitDistSq < result._bestDistSq) {
                        result._bestDistSq = hitDistSq;
                        result.entry = seg;
                        result.closestPoint.closestX = this._tmpClosestPointData.closestX;
                        result.closestPoint.closestY = this._tmpClosestPointData.closestY;
                        result.closestPoint.closestZ = this._tmpClosestPointData.closestZ;
                        result.cellKey = key;
                    }
                }
            }

        return result.entry ? result : null;
    }

    checkGlobalCollision(position, radius, excludePlayerIndex = -1, skipRecent = 0, playerRef = null) {
        const registry = this.getRegistry();
        if (!registry) return null;
        const cellX = Math.floor(position.x / registry.gridSize);
        const cellZ = Math.floor(position.z / registry.gridSize);
        const players = this.getPlayers();
        const queryStamp = this._nextGlobalQueryStamp();

        for (let i = 0; i < CELL_OFFSETS_3X3.length; i++) {
            const [dx, dz] = CELL_OFFSETS_3X3[i];
            const key = (cellX + dx + GRID_KEY_OFFSET) * GRID_KEY_STRIDE + (cellZ + dz + GRID_KEY_OFFSET);
                const cell = registry.spatialGrid.get(key);
                if (!cell) continue;

                for (const seg of cell) {
                    if (!seg || seg.destroyed) continue;
                    if (seg._globalTrailQueryStamp === queryStamp) continue;
                    seg._globalTrailQueryStamp = queryStamp;
                    if (seg.playerIndex === excludePlayerIndex) {
                        const player = players[seg.playerIndex];
                        const trail = player?.trail;
                        if (trail) {
                            const dist = (trail.writeIndex - 1 - seg.segmentIdx + trail.maxSegments) % trail.maxSegments;
                            if (dist < skipRecent) {
                                if (this._shouldLogSkipRecentCandidate(dist, skipRecent)) {
                                    this._debugTrailCollision('skip-recent', {
                                        playerIndex: seg.playerIndex,
                                        segmentIdx: seg.segmentIdx,
                                        dist,
                                        skipRecent,
                                        writeIndex: trail.writeIndex,
                                        maxSegments: trail.maxSegments,
                                        queryRadius: radius,
                                        cellX,
                                        cellZ,
                                    });
                                }
                                continue;
                            }
                        }
                    }

                    if (!this._segmentIntersectsSphere(seg, position, radius, this._tmpClosestPointData)) continue;

                    if (playerRef && playerRef.isSphereInOBB) {
                        this._tmpClosestPoint.set(
                            this._tmpClosestPointData.closestX,
                            this._tmpClosestPointData.closestY,
                            this._tmpClosestPointData.closestZ
                        );
                        const queryRadius = Math.max(0, Number(radius) || 0);
                        const effectiveRadius = Math.max(0, Number(seg.radius) || 0) + queryRadius;
                        if (!playerRef.isSphereInOBB(this._tmpClosestPoint, effectiveRadius)) {
                            continue;
                        }
                    }

                    if (seg.playerIndex === excludePlayerIndex) {
                        this._debugTrailCollision('self-hit', {
                            playerIndex: seg.playerIndex,
                            segmentIdx: seg.segmentIdx,
                            skipRecent,
                            queryRadius: radius,
                            segmentRadius: seg.radius,
                            cellX,
                            cellZ,
                        });
                    }

                    this._trailCollisionResult.hit = true;
                    this._trailCollisionResult.playerIndex = seg.playerIndex;
                    return this._trailCollisionResult;
                }
            }
        return null;
    }
}
