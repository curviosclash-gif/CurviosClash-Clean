import * as THREE from 'three';
import { removePlayerEffect } from '../player/PlayerEffectOps.js';
import {
    createRepairDroneAssets,
    createRepairDroneVisual,
    disposeRepairDroneAssets,
    removeRepairDroneVisual,
    updateRepairDroneVisual,
} from './repair-drone/RepairDroneVisualOps.js';

export const REPAIR_DRONE_RULES = Object.freeze({
    maxHp: 20,
    ownerHealingPerSecond: 3,
    tankHealingPerSecond: 5,
    tankRepairRadius: 20,
    hitboxRadius: 1.25,
});

function findRepairEffect(player) {
    const effects = player?.activeEffects;
    if (!Array.isArray(effects)) return null;
    for (let i = effects.length - 1; i >= 0; i -= 1) {
        const effect = effects[i];
        if (effect?.type === 'REPAIR_DRONE' && Number(effect.remaining) > 0) return effect;
    }
    return null;
}

function emptyDamageResult(drone) {
    return {
        applied: 0,
        hpApplied: 0,
        absorbedByShield: 0,
        remainingHp: Math.max(0, Number(drone?.hp) || 0),
        isDead: drone?.alive !== true,
    };
}

export class RepairDroneSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.drones = [];
        this.networkReplica = false;
        this._assets = null;
        this._targets = [];
        this._followOffset = new THREE.Vector3();
    }

    _resolveAssets() {
        if (!this.entityManager?.renderer) return null;
        if (!this._assets) this._assets = createRepairDroneAssets();
        return this._assets;
    }

    _findDrone(ownerIndex) {
        for (let i = 0; i < this.drones.length; i += 1) {
            if (this.drones[i]?.ownerIndex === ownerIndex) return this.drones[i];
        }
        return null;
    }

    _createDrone(owner) {
        const drone = {
            ownerIndex: owner.index,
            ownerPlayer: owner,
            teamId: owner.teamId || null,
            position: new THREE.Vector3(),
            maxHp: REPAIR_DRONE_RULES.maxHp,
            hp: REPAIR_DRONE_RULES.maxHp,
            hitboxRadius: REPAIR_DRONE_RULES.hitboxRadius,
            destructible: true,
            alive: true,
            yaw: 0,
            root: null,
        };
        drone.root = createRepairDroneVisual(this.entityManager?.renderer, this._resolveAssets());
        drone.takeDamage = (amount, options = {}) => this._applyDamage(drone, amount, options);
        this.drones.push(drone);
        this._updatePose(drone, owner, 0);
        return drone;
    }

    _updatePose(drone, owner, dt) {
        const offset = this._followOffset.set(2.2, 2.4, 0);
        if (owner?.quaternion) offset.applyQuaternion(owner.quaternion);
        drone.position.copy(owner.position).add(offset);
        drone.yaw += Math.max(0, Number(dt) || 0) * 2;
        updateRepairDroneVisual(drone);
    }

    _applyDamage(drone, amount, options = {}) {
        if (!drone?.alive || this.networkReplica) return emptyDamageResult(drone);
        const requested = Math.max(0, Number(amount) || 0);
        const before = drone.hp;
        drone.hp = Math.max(0, before - requested);
        const hpApplied = before - drone.hp;
        if (hpApplied > 0) this.entityManager?.particles?.spawnHit?.(drone.position, 0x75ffae);
        if (drone.hp <= 0) this._destroyDrone(drone, options.sourcePlayer || null);
        return {
            applied: requested,
            hpApplied,
            absorbedByShield: 0,
            remainingHp: drone.hp,
            isDead: !drone.alive,
        };
    }

    _destroyDrone(drone, sourcePlayer = null) {
        if (!drone?.alive) return;
        drone.alive = false;
        drone.hp = 0;
        const owner = drone.ownerPlayer;
        const effect = findRepairEffect(owner);
        if (effect) removePlayerEffect(owner, effect);
        removeRepairDroneVisual(this.entityManager?.renderer, drone);
        this.entityManager?.particles?.spawnExplosion?.(drone.position, 0x49d982, {
            cause: 'PROJECTILE',
            projectileType: 'REPAIR_DRONE',
        });
        this.entityManager?.recorder?.logEvent?.(
            'REPAIR_DRONE_DESTROYED',
            Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1,
            `owner=${drone.ownerIndex}`,
        );
    }

    _removeAt(index, consumeEffect = false) {
        const drone = this.drones[index];
        if (consumeEffect) {
            const effect = findRepairEffect(drone?.ownerPlayer);
            if (effect) removePlayerEffect(drone.ownerPlayer, effect);
        }
        removeRepairDroneVisual(this.entityManager?.renderer, drone);
        this.drones.splice(index, 1);
    }

    _healOwner(owner, amount) {
        const strategy = this.entityManager?.gameModeStrategy;
        const result = typeof strategy?.applyHealing === 'function'
            ? strategy.applyHealing(owner, amount, this.entityManager?.entityRuntimeConfig)
            : null;
        if (result?.healed > 0) {
            this.entityManager?._huntScoring?.registerRepairDroneHpRestored?.(owner.index, result.healed);
            this.entityManager?._emitArcadeGameplayEvent?.({
                type: 'health_update', playerIndex: owner.index, hp: owner.hp, maxHp: owner.maxHp,
            });
        }
    }

    _healNearbyTanks(drone, amount) {
        for (const unit of this.entityManager?._mapUnitSystem?.units || []) {
            if (unit?.kind !== 'tank' || !unit.alive || !unit.position) continue;
            if (unit.escortTank === true && drone.ownerPlayer?.teamId !== unit.teamId) continue;
            if (unit.position.distanceTo(drone.position) > REPAIR_DRONE_RULES.tankRepairRadius) continue;
            const before = Math.max(0, Number(unit.hp) || 0);
            unit.hp = Math.min(Math.max(1, Number(unit.maxHp) || 1), before + amount);
            this.entityManager?._huntScoring?.registerRepairDroneHpRestored?.(
                drone.ownerIndex,
                Math.max(0, unit.hp - before),
            );
        }
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        if (this.networkReplica) return;
        for (let i = this.drones.length - 1; i >= 0; i -= 1) {
            const drone = this.drones[i];
            const owner = drone.ownerPlayer;
            if (!drone.alive || owner?.alive !== true || !findRepairEffect(owner)) {
                this._removeAt(i, owner?.alive !== true);
            }
        }
        for (const owner of this.entityManager?.players || []) {
            if (owner?.alive !== true || !owner.position || !findRepairEffect(owner)) continue;
            let drone = this._findDrone(owner.index);
            if (!drone) drone = this._createDrone(owner);
            this._updatePose(drone, owner, safeDt);
            if (this.entityManager?.isFightOutcomeAuthority === false) continue;
            this._healOwner(owner, REPAIR_DRONE_RULES.ownerHealingPerSecond * safeDt);
            this._healNearbyTanks(drone, REPAIR_DRONE_RULES.tankHealingPerSecond * safeDt);
        }
    }

    getTargets() {
        this._targets.length = 0;
        for (const drone of this.drones) if (drone.alive) this._targets.push(drone);
        return this._targets;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    serializeNetworkState() {
        if (this.drones.length === 0) return null;
        const entries = [];
        for (const drone of this.drones) {
            if (!drone?.alive) continue;
            entries.push({
                ownerIndex: drone.ownerIndex,
                pos: [drone.position.x, drone.position.y, drone.position.z],
                hp: drone.hp,
                remaining: Math.max(0, Number(findRepairEffect(drone.ownerPlayer)?.remaining) || 0),
            });
        }
        return entries;
    }

    applyNetworkState(entries) {
        if (entries === undefined) return;
        this.networkReplica = true;
        const states = Array.isArray(entries) ? entries : [];
        for (let index = this.drones.length - 1; index >= 0; index -= 1) {
            let present = false;
            for (const state of states) {
                if (Number(state?.ownerIndex) === this.drones[index].ownerIndex) present = true;
            }
            if (!present) this._removeAt(index);
        }
        for (const state of states) {
            const ownerIndex = Math.trunc(Number(state?.ownerIndex));
            if (!Number.isInteger(ownerIndex) || !Array.isArray(state?.pos) || state.pos.length < 3) continue;
            let owner = null;
            for (const player of this.entityManager?.players || []) {
                if (player?.index === ownerIndex) owner = player;
            }
            if (!owner) continue;
            let drone = this._findDrone(ownerIndex);
            if (!drone) drone = this._createDrone(owner);
            drone.hp = Math.max(0, Math.min(drone.maxHp, Number(state.hp) || 0));
            drone.remaining = Math.max(0, Number(state.remaining) || 0);
            drone.position.set(Number(state.pos[0]) || 0, Number(state.pos[1]) || 0, Number(state.pos[2]) || 0);
            drone.alive = drone.hp > 0 && drone.remaining > 0;
            updateRepairDroneVisual(drone);
            if (!drone.alive) {
                const index = this.drones.indexOf(drone);
                if (index >= 0) this._removeAt(index);
            }
        }
    }

    clear() {
        for (const drone of this.drones) removeRepairDroneVisual(this.entityManager?.renderer, drone);
        this.drones.length = 0;
    }

    dispose() {
        this.clear();
        disposeRepairDroneAssets(this._assets);
        this._assets = null;
    }
}
