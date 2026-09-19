import * as THREE from 'three';
import {
    WATER_PHASES,
    WATER_WAVE_ORIGINS,
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

function createWaveCrestGeometry(width, height, segments = 48) {
    const positions = [];
    const indices = [];
    for (let index = 0; index < segments; index += 1) {
        const x0 = -width / 2 + ((width * index) / segments);
        const x1 = -width / 2 + ((width * (index + 1)) / segments);
        const y0 = height * (0.78 + (Math.sin(index * 1.71) * 0.09) + (Math.sin(index * 0.37) * 0.08));
        const y1 = height * (0.78 + (Math.sin((index + 1) * 1.71) * 0.09) + (Math.sin((index + 1) * 0.37) * 0.08));
        const vertex = positions.length / 3;
        positions.push(x0, 0, 0, x1, 0, 0, x1, y1, 0, x0, y0, 0);
        indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function deterministicUnit(index, salt) {
    const value = Math.sin((index + 1) * (12.9898 + salt)) * 43758.5453;
    return value - Math.floor(value);
}

function createWaveSprayGeometry(width, height, count = 96) {
    const positions = new Float32Array(count * 3);
    const baseY = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
        const x = (deterministicUnit(index, 0.13) - 0.5) * width;
        const y = (0.15 + deterministicUnit(index, 0.47) * 0.85) * height;
        const z = (deterministicUnit(index, 0.91) - 0.5) * height * 0.5;
        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;
        baseY[index] = y;
        phases[index] = deterministicUnit(index, 1.37) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry, baseY, phases };
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
        this._visualTime = 0;
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
        this._visualTime += Math.max(0, Number(dt) || 0);
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
        const surfaceGeometry = new THREE.PlaneGeometry(width, depth, 20, 20);
        const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
        surface.name = `${group.name}-surface`;
        surface.rotation.x = -Math.PI / 2;
        surface.position.set((min[0] + max[0]) * 0.5, this.zone.startLevel, (min[2] + max[2]) * 0.5);
        surface.renderOrder = 4;
        const surfaceBasePositions = new Float32Array(surfaceGeometry.attributes.position.array);

        const waveGroup = new THREE.Group();
        waveGroup.name = `${group.name}-wave`;
        const crestHeight = 9 * this.scale;
        const wakeSign = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z ? 1 : -1;
        const waveMaterials = [];
        const crestSettings = [
            { height: crestHeight, offset: 0, color: 0x9beeff, opacity: 0.82 },
            { height: crestHeight * 0.62, offset: 3.5 * this.scale, color: 0x4fc6e8, opacity: 0.58 },
            { height: crestHeight * 0.38, offset: 7.5 * this.scale, color: 0x218aad, opacity: 0.42 },
        ];
        for (let index = 0; index < crestSettings.length; index += 1) {
            const settings = crestSettings[index];
            const waveMaterial = new THREE.MeshBasicMaterial({
                color: settings.color,
                transparent: true,
                opacity: settings.opacity,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: index === 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
                toneMapped: false,
            });
            const crest = new THREE.Mesh(createWaveCrestGeometry(width, settings.height), waveMaterial);
            crest.name = `${waveGroup.name}-crest-${index + 1}`;
            crest.position.z = settings.offset * wakeSign;
            crest.renderOrder = 6 + index;
            waveGroup.add(crest);
            waveMaterials.push({ material: waveMaterial, opacity: settings.opacity });
        }

        const foamMaterial = new THREE.MeshBasicMaterial({
            color: 0xd9fbff,
            transparent: true,
            opacity: 0.68,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const foam = new THREE.Mesh(new THREE.PlaneGeometry(width, 10 * this.scale, 24, 1), foamMaterial);
        foam.name = `${waveGroup.name}-foam`;
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(0, 0.35 * this.scale, 4 * this.scale * wakeSign);
        foam.renderOrder = 9;
        waveGroup.add(foam);

        const sprayData = createWaveSprayGeometry(width, crestHeight);
        const sprayMaterial = new THREE.PointsMaterial({
            color: 0xcff8ff,
            size: 1.15 * this.scale,
            transparent: true,
            opacity: 0.76,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const spray = new THREE.Points(sprayData.geometry, sprayMaterial);
        spray.name = `${waveGroup.name}-spray`;
        spray.position.z = 1.5 * this.scale * wakeSign;
        spray.renderOrder = 10;
        waveGroup.add(spray);

        waveGroup.position.set(
            (min[0] + max[0]) * 0.5,
            this.zone.startLevel,
            this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z ? max[2] : min[2],
        );
        group.add(surface, waveGroup);
        renderer.addToScene(group);
        this._visual = {
            group,
            surface,
            surfaceMaterial,
            surfaceBasePositions,
            wave: waveGroup,
            waveGroup,
            waveMaterials,
            foamMaterial,
            spray,
            sprayMaterial,
            sprayBaseY: sprayData.baseY,
            sprayPhases: sprayData.phases,
        };
    }

    _syncVisual() {
        if (!this._visual || !this.zone) return;
        const { min, max } = this.zone.bounds;
        const state = this.state;
        const waveActive = state.phase === WATER_PHASES.WAVE;
        this._visual.waveGroup.visible = waveActive;
        if (waveActive) {
            const progress = Math.min(1, state.phaseElapsedSeconds / this.zone.waveSeconds);
            const startsAtMax = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z;
            this._visual.waveGroup.position.z = startsAtMax
                ? max[2] - ((max[2] - min[2]) * progress)
                : min[2] + ((max[2] - min[2]) * progress);
            this._visual.waveGroup.scale.y = 1 - (progress * 0.34);
            for (const entry of this._visual.waveMaterials) {
                entry.material.opacity = entry.opacity * (1 - progress * 0.38);
            }
            this._visual.foamMaterial.opacity = 0.68 * (1 - progress * 0.32);
            this._visual.sprayMaterial.opacity = 0.76 * (1 - progress * 0.5);
            const sprayPositions = this._visual.spray.geometry.attributes.position;
            for (let index = 0; index < this._visual.sprayBaseY.length; index += 1) {
                sprayPositions.array[index * 3 + 1] = this._visual.sprayBaseY[index]
                    + Math.sin(this._visualTime * 4.2 + this._visual.sprayPhases[index]) * this.scale * 1.6;
            }
            sprayPositions.needsUpdate = true;
        }
        const surfaceActive = state.phase === WATER_PHASES.RISING || state.phase === WATER_PHASES.FLOODED;
        this._visual.surface.visible = surfaceActive;
        this._visual.surface.position.y = state.level;
        this._visual.surfaceMaterial.opacity = state.phase === WATER_PHASES.FLOODED ? 0.68 : 0.56;
        if (surfaceActive) {
            const positions = this._visual.surface.geometry.attributes.position;
            const base = this._visual.surfaceBasePositions;
            const amplitude = this.scale * (state.phase === WATER_PHASES.FLOODED ? 0.42 : 0.7);
            for (let index = 0; index < positions.count; index += 1) {
                const offset = index * 3;
                const x = base[offset];
                const y = base[offset + 1];
                positions.array[offset + 2] = (
                    Math.sin((x * 0.035) + this._visualTime * 1.35)
                    + Math.sin((y * 0.027) - this._visualTime * 1.05)
                ) * amplitude * 0.5;
            }
            positions.needsUpdate = true;
        }
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
        this._visualTime = 0;
    }

    dispose() {
        this.clear();
        this.entityManager = null;
    }
}
