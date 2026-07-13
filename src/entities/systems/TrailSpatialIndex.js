// ============================================
// TrailSpatialIndex.js - trail facade for registry + collision query
// ============================================

import { TrailCollisionQuery } from './trails/TrailCollisionQuery.js';
import { TrailSegmentRegistry } from './trails/TrailSegmentRegistry.js';

function asPositiveNumber(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return num;
}

export class TrailSpatialIndex {
    constructor(options = {}) {
        this.getPlayers = typeof options.getPlayers === 'function'
            ? options.getPlayers
            : (() => options.players || []);

        this._segmentRegistry = new TrailSegmentRegistry({
            gridSize: options.gridSize,
        });
        this._collisionQuery = new TrailCollisionQuery({
            getPlayers: this.getPlayers,
            getRegistry: () => this._segmentRegistry,
            debugConfig: options.debugConfig,
        });

        Object.defineProperties(this, {
            gridSize: {
                configurable: true,
                enumerable: true,
                get: () => this._segmentRegistry.gridSize,
                set: (value) => { this._segmentRegistry.gridSize = asPositiveNumber(value, this._segmentRegistry.gridSize); },
            },
            spatialGrid: {
                configurable: true,
                enumerable: true,
                get: () => this._segmentRegistry.spatialGrid,
                set: (value) => {
                    this._segmentRegistry.spatialGrid = value instanceof Map ? value : new Map();
                },
            },
            _trailCollisionDebugEnabled: {
                configurable: true,
                enumerable: true,
                get: () => this._collisionQuery.debugTelemetry.enabled,
                set: (value) => { this._collisionQuery.debugTelemetry.enabled = !!value; },
            },
            _trailCollisionDebugLogCount: {
                configurable: true,
                enumerable: true,
                get: () => this._collisionQuery.debugTelemetry.logCount,
                set: (value) => { this._collisionQuery.debugTelemetry.logCount = Math.max(0, Number(value) || 0); },
            },
            _trailCollisionDebugMaxLogs: {
                configurable: true,
                enumerable: true,
                get: () => this._collisionQuery.debugTelemetry.maxLogs,
                set: (value) => {
                    const fallback = this._collisionQuery.debugTelemetry.maxLogs;
                    this._collisionQuery.debugTelemetry.maxLogs = asPositiveNumber(value, fallback);
                },
            },
            _trailCollisionDebugSkipRecentSeen: {
                configurable: true,
                enumerable: true,
                get: () => this._collisionQuery.debugTelemetry.skipRecentSeen,
                set: (value) => { this._collisionQuery.debugTelemetry.skipRecentSeen = Math.max(0, Number(value) || 0); },
            },
        });
    }

    registerTrailSegment(playerIndex, segmentIdx, data, reusableRef = null) {
        const trailRef = this._segmentRegistry.registerTrailSegment(playerIndex, segmentIdx, data, reusableRef);
        this._collisionQuery.debugTelemetry.log('register-segment', {
            playerIndex,
            segmentIdx,
            keyCount: Array.isArray(trailRef?.key) ? trailRef.key.length : 1,
            radius: Number(data?.radius) || 0,
        });
        return trailRef;
    }

    unregisterTrailSegment(key, entry) {
        this._segmentRegistry.unregisterTrailSegment(key, entry);
    }

    checkProjectileTrailCollision(position, radius, options = {}) {
        return this._collisionQuery.checkProjectileTrailCollision(position, radius, options);
    }

    damageTrailSegment(entry, damage = 1) {
        return this._segmentRegistry.damageTrailSegment(entry, damage);
    }

    resolveTrailEntry(playerIndex, segmentIdx) {
        return this._segmentRegistry.resolveTrailEntry(playerIndex, segmentIdx);
    }

    destroySegment(entry) {
        return this._segmentRegistry.destroySegment(entry);
    }

    checkGlobalCollision(position, radius, excludePlayerIndex = -1, skipRecent = 0, playerRef = null) {
        return this._collisionQuery.checkGlobalCollision(position, radius, excludePlayerIndex, skipRecent, playerRef);
    }

    clear() {
        this._segmentRegistry.clear();
    }
}
