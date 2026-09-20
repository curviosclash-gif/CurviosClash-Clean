import * as THREE from 'three';

import {
    MAP_SANDSTORM_DIRECTIONS,
    MAP_SANDSTORM_PHASES,
    createMapSandstormState,
    isPositionInSandstormShelter,
    isWithinSandstormRange,
    normalizeMapSandstorm,
    resolveMapSandstormIntensity,
} from '../../shared/contracts/MapSandstormContract.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { MapSandstormVisualController } from '../effects/MapSandstormVisualController.js';

const SAND_SEED_SALT = 0x53414e44;

function sampleRange(rng, range) {
    const min = Number(range?.[0]) || 0;
    const max = Math.max(min, Number(range?.[1]) || min);
    return min + (max - min) * rng.next();
}

function createInactiveState() {
    return createMapSandstormState();
}

export class MapSandstormSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.config = null;
        this.state = createInactiveState();
        this.networkReplica = false;
        this.scale = 1;
        this._rng = createRuntimeRng({ seed: 1 });
        this._visiblePlayersByObserver = new WeakMap();
        this._visiblePowerupsByObserver = new WeakMap();
        this._cueByObserver = new WeakMap();
        this._rayDirection = new THREE.Vector3();
        this._localDirection = new THREE.Vector3();
        this._inverseCameraQuaternion = new THREE.Quaternion();
        this._visual = new MapSandstormVisualController(this.entityManager?.renderer);
    }

    startRound() {
        this.reset();
        this.config = normalizeMapSandstorm(
            this.entityManager?.arena?.currentMapDefinition?.sandstorm
        );
        if (!this.config) return false;
        this.scale = this.entityManager?.arena?.currentMapDefinition?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
            : 1;
        if (this.networkReplica) {
            this.state = createInactiveState();
            this._visual.build(this.entityManager?.arena?.currentMapDefinition?.size, this.scale);
            this._publish();
            return true;
        }
        const matchRng = this.entityManager?.runtimeRng;
        const matchSeed = Math.max(1, Number(this.entityManager?.matchSeed) >>> 0);
        this._rng = matchRng && typeof matchRng.next === 'function'
            ? matchRng
            : createRuntimeRng({ seed: (matchSeed ^ SAND_SEED_SALT) >>> 0 || 1 });
        this.state = {
            enabled: true,
            phase: MAP_SANDSTORM_PHASES.CALM,
            remainingSeconds: sampleRange(this._rng, this.config.initialDelaySeconds),
            eventIndex: 0,
            directionIndex: 0,
            intensity: 0,
        };
        this._visual.build(this.entityManager?.arena?.currentMapDefinition?.size, this.scale);
        this._publish();
        return true;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    update(dt) {
        if (!this.config || !this.state.enabled || this.networkReplica) {
            this._syncCameraRanges();
            this._visual.update(dt, this.state, this.getDirection());
            return;
        }
        let remainingDt = Math.max(0, Number(dt) || 0);
        let transitions = 0;
        while (remainingDt > 0 && transitions < 1024) {
            if (remainingDt < this.state.remainingSeconds) {
                this.state.remainingSeconds -= remainingDt;
                remainingDt = 0;
                break;
            }
            remainingDt -= this.state.remainingSeconds;
            this._advancePhase();
            transitions += 1;
        }
        this.state.intensity = this.state.phase === MAP_SANDSTORM_PHASES.ACTIVE
            ? resolveMapSandstormIntensity(this.config, this.state.remainingSeconds)
            : 0;
        this.entityManager?.renderer?.setMapSandstormIntensity?.(this.state.intensity);
        this._syncCameraRanges();
        this._visual.update(dt, this.state, this.getDirection());
        if (transitions > 0) this._publish();
    }

    _advancePhase() {
        if (this.state.phase === MAP_SANDSTORM_PHASES.CALM) {
            this.state.phase = MAP_SANDSTORM_PHASES.WARNING;
            this.state.remainingSeconds = this.config.warningSeconds;
            this.state.eventIndex += 1;
            this.state.directionIndex = this._rng.int(MAP_SANDSTORM_DIRECTIONS.length);
            return;
        }
        if (this.state.phase === MAP_SANDSTORM_PHASES.WARNING) {
            this.state.phase = MAP_SANDSTORM_PHASES.ACTIVE;
            this.state.remainingSeconds = this.config.activeSeconds;
            return;
        }
        this.state.phase = MAP_SANDSTORM_PHASES.CALM;
        this.state.remainingSeconds = sampleRange(this._rng, this.config.repeatDelaySeconds);
        this.state.intensity = 0;
    }

    applyNetworkSnapshot(value = null) {
        if (!this.config) {
            this.config = normalizeMapSandstorm(
                this.entityManager?.arena?.currentMapDefinition?.sandstorm
            );
        }
        const next = createMapSandstormState(value);
        this.state = this.config && next.enabled ? next : createInactiveState();
        if (this.config && !this._visual.group) {
            this.scale = this.entityManager?.arena?.currentMapDefinition?.scaleAuthoredAnchors === true
                ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
                : 1;
            this._visual.build(this.entityManager?.arena?.currentMapDefinition?.size, this.scale);
        }
        this._visual.update(0, this.state, this.getDirection());
        this._publish();
        return this.getState();
    }

    getState() {
        return { ...this.state };
    }

    getRenderState() {
        return {
            visible: this._visual.group?.visible === true,
            particleCount: this._visual.particles?.count || 0,
        };
    }

    getDirection() {
        return MAP_SANDSTORM_DIRECTIONS[this.state.directionIndex]
            || MAP_SANDSTORM_DIRECTIONS[0];
    }

    isActive() {
        return this.state.enabled === true
            && this.state.phase === MAP_SANDSTORM_PHASES.ACTIVE
            && this.state.remainingSeconds > 0;
    }

    isSheltered(position) {
        return isPositionInSandstormShelter(position, this.config, this.scale);
    }

    _getAuthoredVisibilityRange(observerPosition) {
        if (!this.config) return Infinity;
        return this.isSheltered(observerPosition)
            ? this.config.shelterFar
            : this.config.outdoorFar;
    }

    getVisibilityRange(observerPosition) {
        if (!this.isActive() || !this.config) return Infinity;
        const targetRange = this._getAuthoredVisibilityRange(observerPosition);
        const baseRange = Number(this.entityManager?.renderer?.getBaseFogVisibilityRange?.());
        const intensity = Math.max(0, Math.min(1, Number(this.state.intensity) || 0));
        if (!(baseRange > 0) || intensity >= 1) return targetRange;
        return Math.min(baseRange, THREE.MathUtils.lerp(baseRange, targetRange, intensity));
    }

    isPositionVisible(observerPosition, targetPosition) {
        return !this.isActive() || isWithinSandstormRange(
            observerPosition,
            targetPosition,
            this.getVisibilityRange(observerPosition)
        );
    }

    filterVisiblePlayers(observer, players) {
        if (!this.isActive() || !observer || !Array.isArray(players)) return players;
        let visible = this._visiblePlayersByObserver.get(observer);
        if (!visible) {
            visible = [];
            this._visiblePlayersByObserver.set(observer, visible);
        }
        visible.length = 0;
        for (let index = 0; index < players.length; index += 1) {
            const candidate = players[index];
            if (candidate === observer || this.isPositionVisible(observer.position, candidate?.position)) {
                visible.push(candidate);
            }
        }
        return visible;
    }

    filterVisiblePowerups(observer, powerups) {
        if (!this.isActive() || !observer || !Array.isArray(powerups)) return powerups;
        let visible = this._visiblePowerupsByObserver.get(observer);
        if (!visible) {
            visible = [];
            this._visiblePowerupsByObserver.set(observer, visible);
        }
        visible.length = 0;
        for (let index = 0; index < powerups.length; index += 1) {
            const candidate = powerups[index];
            const position = candidate?.position || candidate?.mesh?.position;
            if (this.isPositionVisible(observer.position, position)) visible.push(candidate);
        }
        return visible;
    }

    getProximityCue(observer, players = this.entityManager?.players) {
        if (!this.isActive() || !observer?.alive || !Array.isArray(players) || !this.config) return null;
        const maxRange = this.config.proximityCueRange;
        let nearest = null;
        let nearestDistance = maxRange;
        const observerTeamId = String(observer.teamId || '');
        for (let index = 0; index < players.length; index += 1) {
            const candidate = players[index];
            if (
                !candidate?.alive
                || candidate === observer
                || (observerTeamId && String(candidate.teamId || '') === observerTeamId)
            ) continue;
            this._rayDirection.subVectors(candidate.position, observer.position);
            const distance = this._rayDirection.length();
            if (!(distance > 0) || distance > nearestDistance) continue;
            this._rayDirection.multiplyScalar(1 / distance);
            const blocker = this.entityManager?.arena?.raycast?.(
                observer.position,
                this._rayDirection,
                Math.max(0, distance - (Number(candidate.hitboxRadius) || 0.8))
            );
            if (blocker?.hit === true) continue;
            nearest = candidate;
            nearestDistance = distance;
        }
        if (!nearest) return null;
        let cue = this._cueByObserver.get(observer);
        if (!cue) {
            cue = { active: true, angleDegrees: 0 };
            this._cueByObserver.set(observer, cue);
        }
        const camera = this.entityManager?.renderer?.cameras?.[observer.index];
        this._localDirection.subVectors(nearest.position, observer.position).normalize();
        if (camera?.quaternion) {
            this._inverseCameraQuaternion.copy(camera.quaternion).invert();
            this._localDirection.applyQuaternion(this._inverseCameraQuaternion);
        }
        cue.active = true;
        cue.angleDegrees = Math.atan2(this._localDirection.x, -this._localDirection.z) * 180 / Math.PI;
        return cue;
    }

    _syncCameraRanges() {
        const renderer = this.entityManager?.renderer;
        const cameras = renderer?.cameras;
        if (!Array.isArray(cameras)) return;
        for (let index = 0; index < cameras.length; index += 1) {
            const camera = cameras[index];
            if (!camera?.userData) continue;
            const player = this.entityManager?.players?.[index];
            camera.userData.sandstormVisibilityRange = player
                ? this._getAuthoredVisibilityRange(player.position)
                : Infinity;
        }
    }

    _publish() {
        this._syncCameraRanges();
        this.entityManager?.renderer?.setMapSandstormEffect?.({
            ...this.state,
            direction: this.getDirection(),
            outdoorNear: this.config?.outdoorNear || 0,
            outdoorFar: this.config?.outdoorFar || 0,
            shelterNear: this.config?.shelterNear || 0,
            shelterFar: this.config?.shelterFar || 0,
        });
    }

    reset() {
        this.config = null;
        this.state = createInactiveState();
        this.scale = 1;
        this._visiblePlayersByObserver = new WeakMap();
        this._visiblePowerupsByObserver = new WeakMap();
        this._cueByObserver = new WeakMap();
        const cameras = this.entityManager?.renderer?.cameras || [];
        for (let index = 0; index < cameras.length; index += 1) {
            if (cameras[index]?.userData) cameras[index].userData.sandstormVisibilityRange = Infinity;
        }
        this.entityManager?.renderer?.setMapSandstormEffect?.(null);
        this._visual.reset();
    }

    clear() { this.reset(); }
    dispose() { this.reset(); this._visual.dispose(); }
}
