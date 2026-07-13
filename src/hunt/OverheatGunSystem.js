import * as THREE from 'three';
import { MGOverheatState } from './mg/MGOverheatState.js';
import { MGHitResolver } from './mg/MGHitResolver.js';
import { MGTracerFx } from './mg/MGTracerFx.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../shared/contracts/GameplayActionResultContract.js';

function getMgConfig(source = null) {
    return resolveEntityRuntimeConfig(source)?.HUNT?.MG || {};
}

function createLegacyRuntimeContext(entityManager) {
    if (!entityManager) return null;
    return {
        players: entityManager.players || [],
        services: {
            particles: entityManager.particles || null,
            audio: entityManager.audio || null,
            recorder: entityManager.recorder || null,
            runtimeProfiler: entityManager.runtimeProfiler || null,
        },
        trails: {
            spatialIndex: entityManager._trailSpatialIndex || null,
        },
        getTrailSpatialIndex: () => entityManager.getTrailSpatialIndex?.() || entityManager._trailSpatialIndex || null,
        lifecycle: {
            killPlayer: (player, cause = 'UNKNOWN', options = {}) => entityManager._killPlayer?.(player, cause, options),
        },
        events: {
            emitHuntDamageEvent: (event) => entityManager._emitHuntDamageEvent?.(event),
            emitHuntFeed: (message) => {
                if (typeof entityManager.onHuntFeedEvent === 'function') {
                    entityManager.onHuntFeedEvent(message);
                }
            },
        },
    };
}

export class OverheatGunSystem {
    constructor(entityManager, runtimeContext = null) {
        this.entityManager = entityManager;
        this.runtimeContext = runtimeContext
            || entityManager?.getRuntimeContext?.()
            || createLegacyRuntimeContext(entityManager);

        this._state = new MGOverheatState(this.runtimeContext || entityManager);
        this._hitResolver = new MGHitResolver(this.runtimeContext);
        this._tracerFx = new MGTracerFx(entityManager);

        // Compatibility facade for existing call sites and tests.
        this._overheatByPlayer = this._state.overheatByPlayer;
        this._lockoutByPlayer = this._state.lockoutByPlayer;
        this._overheatSnapshot = this._state.overheatSnapshot;
        this._tracers = this._tracerFx.tracers;

        this._tmpAim = new THREE.Vector3();
        this._tmpMuzzle = new THREE.Vector3();
        this._tmpTracerEnd = new THREE.Vector3();
    }

    reset() {
        this._state.reset();
        this._tracerFx.clear();
    }

    update(dt) {
        const mg = getMgConfig(this.runtimeContext || this.entityManager);
        const players = this.entityManager?.players || [];
        this._state.update(players, dt, mg);
        this._tracerFx.update(dt);
    }

    getOverheatValue(playerIndex) {
        return this._state.getOverheatValue(playerIndex);
    }

    resetPlayer(playerIndex) {
        this._state.resetPlayer(playerIndex);
    }

    getOverheatSnapshot() {
        return this._state.overheatSnapshot;
    }

    getOverheatSnapshotVersion() {
        return this._state.overheatSnapshotVersion;
    }

    isOverheatSnapshotDirty() {
        return this._state.overheatSnapshotDirty;
    }

    markOverheatSnapshotClean() {
        this._state.markOverheatSnapshotClean();
    }

    tryFire(player) {
        if (!player || !player.alive) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_INACTIVE,
                message: 'Spieler inaktiv',
                mode: 'mg',
                type: 'MG_BULLET',
            });
        }
        const strategy = this.entityManager?.gameModeStrategy || null;
        if (!strategy?.hasMachineGun()) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_INACTIVE,
                message: 'Hunt-Modus inaktiv',
                mode: 'mg',
                type: 'MG_BULLET',
            });
        }

        const mg = getMgConfig(this.runtimeContext || this.entityManager);
        const shotCooldown = Math.max(0.01, Number(mg.COOLDOWN || 0.08));
        if ((player.shootCooldown || 0) > 0) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_COOLDOWN,
                message: `Schuss bereit in ${player.shootCooldown.toFixed(1)}s`,
                mode: 'mg',
                type: 'MG_BULLET',
            });
        }

        const idx = player.index;
        const lockout = Math.max(0, Number(this._lockoutByPlayer[idx] || 0));
        if (lockout > 0) {
            return buildGameplayActionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_OVERHEATED,
                message: `MG ueberhitzt (${lockout.toFixed(1)}s)`,
                mode: 'mg',
                type: 'MG_BULLET',
            });
        }

        player.shootCooldown = shotCooldown;
        this._state.increaseOverheat(idx, mg);

        const hitResult = this._hitResolver.resolveHit(player, mg, this._tmpMuzzle, this._tmpAim);
        this._tmpTracerEnd.copy(this._tmpMuzzle).addScaledVector(this._tmpAim, Math.max(10, Number(mg.RANGE || 95)));
        if (hitResult.point) {
            this._tmpTracerEnd.set(hitResult.point.x, hitResult.point.y, hitResult.point.z);
        }
        this._tracerFx.spawnTracer(this._tmpMuzzle, this._tmpTracerEnd, !!(hitResult.target || hitResult.trail), mg);
        if (hitResult.target) {
            this._hitResolver.applyHit(player, hitResult.target, hitResult.distance, mg, hitResult.point);
        } else if (hitResult.trail) {
            this._hitResolver.applyTrailHit(player, hitResult.trail, mg);
        }

        if (this.entityManager?.audio && !player?.isBot) {
            this.entityManager.audio.play('MG_SHOOT');
        }

        return {
            ...buildGameplayActionResult({
                ok: true,
                code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_SUCCESS,
                mode: 'mg',
                type: 'MG_BULLET',
                meta: {
                    hit: !!hitResult.target,
                    trailHit: !!hitResult.trail,
                    overheat: this.getOverheatValue(idx),
                },
            }),
            hit: !!hitResult.target,
            trailHit: !!hitResult.trail,
            overheat: this.getOverheatValue(idx),
        };
    }
}
