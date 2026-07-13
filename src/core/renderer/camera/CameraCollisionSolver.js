import * as THREE from 'three';
import { CONFIG } from '../../Config.js';

function ensureCacheEntry(cache, playerIndex) {
    if (!cache[playerIndex]) {
        cache[playerIndex] = {
            mode: null,
            arena: null,
            origin: new THREE.Vector3(),
            desired: new THREE.Vector3(),
            resolved: new THREE.Vector3(),
        };
    }
    return cache[playerIndex];
}

export class CameraCollisionSolver {
    constructor() {
        this._cacheByPlayer = [];
        this._tmpCamDir = new THREE.Vector3();
        this._tmpCamProbe = new THREE.Vector3();
        this._tmpDesired = new THREE.Vector3();
    }

    resolve(playerIndex, mode, origin, desiredPosition, arena) {
        if (!arena || typeof arena.checkCollision !== 'function') {
            return;
        }

        const entry = ensureCacheEntry(this._cacheByPlayer, playerIndex);
        const recheckEpsilon = Math.max(0.001, Number(CONFIG.CAMERA.COLLISION_RECHECK_EPSILON) || 0.03);
        const recheckEpsilonSq = recheckEpsilon * recheckEpsilon;
        const canReuseLast = entry.mode === mode
            && entry.arena === arena
            && entry.origin.distanceToSquared(origin) <= recheckEpsilonSq
            && entry.desired.distanceToSquared(desiredPosition) <= recheckEpsilonSq;

        if (canReuseLast) {
            desiredPosition.copy(entry.resolved);
            return;
        }

        const radius = Math.max(0.05, CONFIG.CAMERA.COLLISION_RADIUS || 0.45);
        this._tmpDesired.copy(desiredPosition);
        if (!arena.checkCollision(desiredPosition, radius)) {
            this._storeCacheEntry(entry, mode, arena, origin, this._tmpDesired, desiredPosition);
            return;
        }

        this._tmpCamDir.copy(desiredPosition).sub(origin);
        if (this._tmpCamDir.lengthSq() < 0.000001) {
            this._storeCacheEntry(entry, mode, arena, origin, this._tmpDesired, desiredPosition);
            return;
        }

        let min = 0;
        let max = 1;
        let safe = 0;
        const steps = Math.max(4, Math.floor(CONFIG.CAMERA.COLLISION_STEPS || 8));
        for (let i = 0; i < steps; i++) {
            const t = (min + max) * 0.5;
            this._tmpCamProbe.copy(origin).addScaledVector(this._tmpCamDir, t);
            if (arena.checkCollision(this._tmpCamProbe, radius)) {
                max = t;
            } else {
                safe = t;
                min = t;
            }
        }

        const backoff = Math.max(0, CONFIG.CAMERA.COLLISION_BACKOFF || 0.04);
        const finalT = Math.max(0, safe - backoff);
        desiredPosition.copy(origin).addScaledVector(this._tmpCamDir, finalT);
        this._storeCacheEntry(entry, mode, arena, origin, this._tmpDesired, desiredPosition);
    }

    _storeCacheEntry(entry, mode, arena, origin, desired, resolved) {
        entry.mode = mode;
        entry.arena = arena;
        entry.origin.copy(origin);
        entry.desired.copy(desired);
        entry.resolved.copy(resolved);
    }

    reset() {
        this._cacheByPlayer.length = 0;
    }
}
