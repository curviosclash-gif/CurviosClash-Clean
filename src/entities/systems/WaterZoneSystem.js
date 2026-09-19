import * as THREE from 'three';
import {
    WATER_PHASES,
    applyWaterZoneNetworkState,
    createWaterZoneState,
    isPointUnderwater,
    normalizeWaterZone,
    serializeWaterZoneState,
    stepWaterZoneState,
    triggerWaterZone,
} from '../../shared/contracts/WaterZoneContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

function scaledZone(zone, scale) {
    if (!zone) return null;
    return normalizeWaterZone({
        ...zone,
        bounds: {
            min: zone.bounds.min.map((value) => value * scale),
            max: zone.bounds.max.map((value) => value * scale),
        },
        startLevel: zone.startLevel * scale,
        targetLevel: zone.targetLevel * scale,
    });
}

export class WaterZoneSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.zone = null;
        this.state = createWaterZoneState(null);
        this.networkReplica = false;
        this.scale = 1;
        this._seenBreakCount = 0;
        this._visual = null;
    }

    startRound() {
        this.clear();
        const map = this.entityManager?.arena?.currentMapDefinition;
        const authored = normalizeWaterZone(map?.waterZone);
        if (!authored) return false;
        this.scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
            : 1;
        this.zone = scaledZone(authored, this.scale);
        this.state = createWaterZoneState(this.zone);
        this._buildVisual();
        this._syncVisual();
        return true;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    update(dt) {
        if (!this.zone) return;
        if (!this.networkReplica) this._triggerFromBreakEvents();
        stepWaterZoneState(this.state, this.zone, dt);
        this._syncVisual();
    }

    _triggerFromBreakEvents() {
        if (this.state.phase !== WATER_PHASES.DRY) return;
        const destructibles = this.entityManager?._mapDestructibleSystem;
        const events = destructibles?.isActive?.() === true ? destructibles.getState?.()?.events : null;
        if (!Array.isArray(events)) return;
        const from = Math.min(this._seenBreakCount, events.length);
        this._seenBreakCount = events.length;
        for (let index = from; index < events.length; index += 1) {
            if (!this.zone.triggerSegmentId || events[index]?.segmentId === this.zone.triggerSegmentId) {
                triggerWaterZone(this.state);
                break;
            }
        }
    }

    getState() {
        return this.state;
    }

    getZone() {
        return this.zone;
    }

    getEffects() {
        return this.zone?.effects || null;
    }

    isPositionUnderwater(position) {
        return isPointUnderwater(this.zone, this.state, position);
    }

    serializeNetworkState() {
        return this.zone ? serializeWaterZoneState(this.state) : null;
    }

    applyNetworkState(payload) {
        if (!this.zone || !payload) return this.state;
        applyWaterZoneNetworkState(this.state, this.zone, payload);
        this._syncVisual();
        return this.state;
    }

    _buildVisual() {
        const renderer = this.entityManager?.renderer;
        if (!renderer?.addToScene || !this.zone) return;
        const { min, max } = this.zone.bounds;
        const width = Math.max(0.1, max[0] - min[0]);
        const depth = Math.max(0.1, max[2] - min[2]);
        const group = new THREE.Group();
        group.name = `water-zone-${this.zone.id}`;
        const surfaceMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x17668a,
            emissive: 0x082a3b,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.62,
            roughness: 0.18,
            metalness: 0.05,
            transmission: 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1), surfaceMaterial);
        surface.name = `${group.name}-surface`;
        surface.rotation.x = -Math.PI / 2;
        surface.position.set((min[0] + max[0]) * 0.5, this.zone.startLevel, (min[2] + max[2]) * 0.5);
        surface.renderOrder = 4;
        const waveMaterial = new THREE.MeshBasicMaterial({
            color: 0x7de3ff,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const wave = new THREE.Mesh(new THREE.BoxGeometry(width, 1.1 * this.scale, 2.5 * this.scale), waveMaterial);
        wave.name = `${group.name}-wave`;
        wave.position.set((min[0] + max[0]) * 0.5, this.zone.startLevel + 0.8 * this.scale, min[2]);
        wave.renderOrder = 5;
        group.add(surface, wave);
        renderer.addToScene(group);
        this._visual = { group, surface, surfaceMaterial, wave, waveMaterial };
    }

    _syncVisual() {
        if (!this._visual || !this.zone) return;
        const { min, max } = this.zone.bounds;
        const state = this.state;
        const waveActive = state.phase === WATER_PHASES.WAVE;
        this._visual.wave.visible = waveActive;
        if (waveActive) {
            const progress = Math.min(1, state.phaseElapsedSeconds / this.zone.waveSeconds);
            this._visual.wave.position.z = min[2] + ((max[2] - min[2]) * progress);
            this._visual.waveMaterial.opacity = 0.8 - progress * 0.25;
        }
        const surfaceActive = state.phase === WATER_PHASES.RISING || state.phase === WATER_PHASES.FLOODED;
        this._visual.surface.visible = surfaceActive;
        this._visual.surface.position.y = state.level;
        this._visual.surfaceMaterial.opacity = state.phase === WATER_PHASES.FLOODED ? 0.68 : 0.56;
    }

    clear() {
        if (this._visual?.group) {
            this.entityManager?.renderer?.removeFromScene?.(this._visual.group);
            disposeObject3DResources(this._visual.group);
        }
        this._visual = null;
        this.zone = null;
        this.state = createWaterZoneState(null);
        this.scale = 1;
        this._seenBreakCount = 0;
    }

    dispose() {
        this.clear();
        this.entityManager = null;
    }
}
