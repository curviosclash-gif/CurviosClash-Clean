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
import {
    createBreachCrestGeometry, createJetGeometry, createSoftSprayTexture,
    createWaveFoamGeometry, createWaveFrontGeometry, createWaveSprayGeometry,
    updateJetGeometry,
} from './WaterZoneVisualGeometry.js';

function scaleBounds(bounds, scale) {
    if (!bounds) return undefined;
    return {
        min: bounds.min.map((value) => value * scale),
        max: bounds.max.map((value) => value * scale),
    };
}

function scaledZone(zone, scale) {
    if (!zone) return null;
    return normalizeWaterZone({
        ...zone,
        bounds: scaleBounds(zone.bounds, scale),
        ...(zone.reservoirBounds ? { reservoirBounds: scaleBounds(zone.reservoirBounds, scale) } : {}),
        startLevel: zone.startLevel * scale,
        targetLevel: zone.targetLevel * scale,
        waveOpeningWidth: zone.waveOpeningWidth * scale,
        waveSourceInset: zone.waveSourceInset * scale,
        waveFloorOffset: zone.waveFloorOffset * scale,
    });
}

function waveStartZ(zone) {
    if (zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z) {
        if (zone.waveSourceInset > 0) return zone.bounds.max[2] - zone.waveSourceInset;
        return zone.reservoirBounds?.min[2] ?? zone.bounds.max[2];
    }
    if (zone.waveSourceInset > 0) return zone.bounds.min[2] + zone.waveSourceInset;
    return zone.reservoirBounds?.max[2] ?? zone.bounds.min[2];
}

function smoothStep(progress) {
    return progress * progress * (3 - (2 * progress));
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

        let reservoirSurface = null;
        let reservoirMaterial = null;
        let reservoirBasePositions = null;
        const reservoir = this.zone.reservoirBounds;
        if (reservoir) {
            const reservoirWidth = Math.max(0.1, reservoir.max[0] - reservoir.min[0]);
            const reservoirDepth = Math.max(0.1, reservoir.max[2] - reservoir.min[2]);
            const reservoirGeometry = new THREE.PlaneGeometry(reservoirWidth, reservoirDepth, 20, 3);
            reservoirMaterial = surfaceMaterial.clone();
            reservoirMaterial.opacity = 0.7;
            reservoirSurface = new THREE.Mesh(reservoirGeometry, reservoirMaterial);
            reservoirSurface.name = `${group.name}-reservoir-surface`;
            reservoirSurface.rotation.x = -Math.PI / 2;
            reservoirSurface.position.set(
                (reservoir.min[0] + reservoir.max[0]) * 0.5,
                reservoir.max[1],
                (reservoir.min[2] + reservoir.max[2]) * 0.5,
            );
            reservoirSurface.renderOrder = 5;
            reservoirBasePositions = new Float32Array(reservoirGeometry.attributes.position.array);
        }

        const waveGroup = new THREE.Group();
        waveGroup.name = `${group.name}-wave`;
        const shapedWave = this.zone.waveOpeningWidth < width - 0.01 || this.zone.waveSourceInset > 0;
        const crestHeight = (shapedWave ? 18 : 9) * this.scale;
        const crestDepth = 5.5 * this.scale;
        const baseWaveWidth = shapedWave ? width : Math.min(width, 54 * this.scale);
        const travelSign = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z ? -1 : 1;
        const wakeSign = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z ? 1 : -1;
        const waveMaterials = [];
        const crestSettings = shapedWave ? [
            { height: crestHeight, offset: 0, color: 0x5dc4da, opacity: 0.84 },
            { height: crestHeight * 0.62, offset: 3.5 * this.scale, color: 0x2992b3, opacity: 0.62 },
            { height: crestHeight * 0.38, offset: 7.5 * this.scale, color: 0x155674, opacity: 0.48 },
        ] : [
            { height: crestHeight, depth: crestDepth, offset: 0, color: 0x9beeff, opacity: 0.82 },
            { height: crestHeight * 0.62, depth: crestDepth * 0.72, offset: 3.5 * this.scale, color: 0x4fc6e8, opacity: 0.58 },
            { height: crestHeight * 0.38, depth: crestDepth * 0.48, offset: 7.5 * this.scale, color: 0x218aad, opacity: 0.42 },
        ];
        for (let index = 0; index < crestSettings.length; index += 1) {
            const settings = crestSettings[index];
            const waveMaterial = new THREE.MeshBasicMaterial({
                color: settings.color,
                transparent: true,
                opacity: settings.opacity,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: shapedWave || index > 0 ? THREE.NormalBlending : THREE.AdditiveBlending,
                toneMapped: false,
            });
            const crest = new THREE.Mesh(
                shapedWave ? createBreachCrestGeometry(baseWaveWidth, settings.height)
                    : createWaveFrontGeometry(baseWaveWidth, settings.height, settings.depth, travelSign),
                waveMaterial,
            );
            crest.frustumCulled = !shapedWave;
            crest.name = index === 0 ? `${waveGroup.name}-front` : `${waveGroup.name}-wake-${index}`;
            crest.position.z = settings.offset * wakeSign;
            crest.renderOrder = 6 + index;
            waveGroup.add(crest);
            waveMaterials.push({
                material: waveMaterial, opacity: settings.opacity, crest,
                basePositions: shapedWave ? new Float32Array(crest.geometry.attributes.position.array) : null,
                baseColor: shapedWave ? waveMaterial.color.clone() : null,
            });
        }

        const foamMaterial = new THREE.MeshBasicMaterial({
            color: shapedWave ? 0x79bcc9 : 0xd9fbff,
            transparent: true,
            opacity: shapedWave ? 0.4 : 0.68,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: shapedWave ? THREE.NormalBlending : THREE.AdditiveBlending,
            toneMapped: false,
        });
        const foamGeometry = shapedWave
            ? new THREE.PlaneGeometry(width, 10 * this.scale, 24, 1)
            : createWaveFoamGeometry(baseWaveWidth, crestHeight, crestDepth, travelSign);
        if (shapedWave) {
            const positions = foamGeometry.attributes.position;
            for (let index = 0; index < positions.count; index += 1) {
                const x = positions.getX(index);
                const taper = Math.max(0, 1 - Math.abs(x / (width / 2)) ** 1.4);
                const halfDepth = (0.8 + 4.2 * taper) * this.scale;
                const ripple = Math.sin(x * 0.045) * 1.2 * this.scale;
                positions.setY(index, ripple + Math.sign(positions.getY(index)) * halfDepth);
            }
            positions.needsUpdate = true;
        }
        const foam = new THREE.Mesh(foamGeometry, foamMaterial);
        foam.name = shapedWave ? `${waveGroup.name}-foam` : `${waveGroup.name}-foam-edge`;
        if (shapedWave) {
            foam.rotation.x = -Math.PI / 2;
            foam.position.set(0, 0.35 * this.scale, 4 * this.scale * wakeSign);
        } else {
            foam.position.z = 0.35 * this.scale * wakeSign;
        }
        foam.renderOrder = 9;
        waveGroup.add(foam);

        const sprayData = createWaveSprayGeometry(baseWaveWidth, crestHeight, crestDepth,
            travelSign, shapedWave ? 64 : 96);
        const sprayMaterial = new THREE.PointsMaterial({
            color: 0xcff8ff,
            size: (shapedWave ? 0.65 : 1.15) * this.scale,
            transparent: true,
            opacity: shapedWave ? 0.58 : 0.76,
            depthWrite: false,
            blending: shapedWave ? THREE.NormalBlending : THREE.AdditiveBlending,
            map: shapedWave ? createSoftSprayTexture() : null,
            toneMapped: false,
        });
        const spray = new THREE.Points(sprayData.geometry, sprayMaterial);
        spray.name = `${waveGroup.name}-spray`;
        spray.position.z = 1.5 * this.scale * wakeSign;
        spray.renderOrder = 10;
        waveGroup.add(spray);

        const jetMaterial = new THREE.MeshBasicMaterial({
            color: 0x1d86a8, transparent: true, opacity: 0.42,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const jet = new THREE.Mesh(createJetGeometry(), jetMaterial);
        jet.frustumCulled = false;
        jet.name = `${group.name}-jet`;
        jet.renderOrder = 5;
        group.add(jet);

        const fallMaterial = new THREE.MeshBasicMaterial({
            color: 0x4fbed5, transparent: true, opacity: 0.6,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const fall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fallMaterial);
        fall.name = `${group.name}-breach-fall`;
        fall.renderOrder = 7;
        group.add(fall);

        waveGroup.position.set(
            (min[0] + max[0]) * 0.5,
            this.zone.startLevel + (shapedWave ? this.zone.waveFloorOffset : 0),
            waveStartZ(this.zone),
        );
        group.add(surface);
        if (reservoirSurface) group.add(reservoirSurface);
        group.add(waveGroup);
        renderer.addToScene(group);
        this._visual = {
            group,
            surface,
            surfaceMaterial,
            surfaceBasePositions,
            reservoirSurface,
            reservoirMaterial,
            reservoirBasePositions,
            wave: waveGroup,
            waveGroup,
            waveMaterials,
            foamMaterial,
            foam,
            spray,
            sprayMaterial,
            sprayBaseY: sprayData.baseY,
            sprayPhases: sprayData.phases,
            jet,
            jetMaterial,
            fall,
            fallMaterial,
        };
    }

    _syncVisual() {
        if (!this._visual || !this.zone) return;
        const { min, max } = this.zone.bounds;
        const state = this.state;
        const waveActive = state.phase === WATER_PHASES.WAVE;
        const rising = state.phase === WATER_PHASES.RISING;
        const floorY = this.zone.startLevel + this.zone.waveFloorOffset;
        const atMax = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z;
        const sourceZ = waveStartZ(this.zone);
        const finishZ = atMax ? min[2] : max[2];
        const width = Math.max(0.1, max[0] - min[0]);
        const hasBreach = this.zone.waveOpeningWidth < width - 0.01 || this.zone.waveSourceInset > 0;
        const delay = hasBreach ? Math.min(0.3, this.zone.waveSeconds * 0.15) : 0;
        const elapsed = waveActive ? state.phaseElapsedSeconds : this.zone.waveSeconds;
        const progress = Math.max(0, Math.min(1,
            (elapsed - delay) / Math.max(0.1, this.zone.waveSeconds - delay),
        ));
        const sourceWidth = this.zone.waveOpeningWidth;
        const spread = Math.max(0, Math.min(1, (elapsed - 0.65) / Math.max(0.1, this.zone.waveSeconds - 0.95)));
        const waveWidth = sourceWidth + (width - sourceWidth) * spread * spread * (3 - 2 * spread);
        const visualTime = state.phase === WATER_PHASES.WAVE ? state.phaseElapsedSeconds
            : state.phase === WATER_PHASES.RISING ? this.zone.waveSeconds + state.phaseElapsedSeconds
                : state.phase === WATER_PHASES.FLOODED ? this.zone.waveSeconds + this.zone.riseSeconds : 0;
        const foamFade = waveActive ? 1 : rising && hasBreach
            ? Math.max(0, 1 - state.phaseElapsedSeconds / 2) : 0;
        this._visual.waveGroup.visible = waveActive || foamFade > 0;
        if (this._visual.waveGroup.visible) {
            const frontZ = sourceZ + (finishZ - sourceZ) * (hasBreach ? progress : smoothStep(progress));
            this._visual.waveGroup.position.z = frontZ;
            this._visual.waveGroup.position.y = hasBreach ? floorY : this.zone.startLevel;
            this._visual.waveGroup.scale.x = hasBreach ? waveWidth / width : 1 + progress * 0.35;
            if (hasBreach) this._visual.foam.scale.y = 0.65 + progress * 0.7;
            const tailFade = hasBreach
                ? Math.max(0, Math.min(1, (this.zone.waveSeconds - elapsed) / 0.8)) : 1;
            this._visual.waveGroup.scale.y = hasBreach
                ? ((0.52 + 0.48 * Math.min(1, elapsed / 0.9)) * (1 - progress * 0.48)
                    * tailFade) + 0.02 * (1 - tailFade)
                : 1 - progress * 0.42;
            for (const entry of this._visual.waveMaterials) {
                entry.material.opacity = hasBreach
                    ? (waveActive ? entry.opacity * Math.min(1, Math.max(0, (elapsed - 0.27) / 0.55))
                        * (1 - progress * 0.3) * tailFade : 0)
                    : entry.opacity * (1 - progress * 0.38);
                if (entry.basePositions) {
                    const positions = entry.crest.geometry.attributes.position;
                    for (let index = 0; index < positions.count; index += 1) {
                        const offset = index * 3;
                        const y = entry.basePositions[offset + 1];
                        positions.array[offset + 1] = y > 0
                            ? y * (1 + 0.065 * Math.sin(visualTime * 5.3 + index * 0.53)) : 0;
                    }
                    positions.needsUpdate = true;
                    const glint = 0.92 + 0.08 * Math.sin(visualTime * 4.1 + progress * 7);
                    entry.material.color.setRGB(entry.baseColor.r * glint,
                        entry.baseColor.g * glint, entry.baseColor.b * glint);
                }
            }
            this._visual.foamMaterial.opacity = hasBreach
                ? 0.4 * foamFade * (1 - progress * 0.25)
                : 0.68 * (1 - progress * 0.32);
            this._visual.sprayMaterial.opacity = hasBreach
                ? (waveActive ? 0.76 * (1 - progress * 0.5) * tailFade : 0)
                : 0.76 * (1 - progress * 0.5);
            const sprayPositions = this._visual.spray.geometry.attributes.position;
            for (let index = 0; index < this._visual.sprayBaseY.length; index += 1) {
                sprayPositions.array[index * 3 + 1] = this._visual.sprayBaseY[index]
                    + Math.sin(visualTime * 4.2 + this._visual.sprayPhases[index]) * this.scale * 1.6;
            }
            sprayPositions.needsUpdate = true;

            const jetLength = Math.abs(frontZ - sourceZ);
            this._visual.jet.visible = waveActive && hasBreach && elapsed > 0.18 && jetLength > 0.1;
            this._visual.jet.position.set((min[0] + max[0]) * 0.5, floorY, sourceZ);
            const jetPositions = this._visual.jet.geometry.attributes.position;
            const nearWidth = sourceWidth * 0.5;
            const farWidth = (sourceWidth + (waveWidth - sourceWidth) * 0.55) * 0.5;
            const direction = atMax ? -1 : 1;
            const farHeight = (1.4 + 0.2 * Math.sin(visualTime * 7.2)) * this.scale;
            updateJetGeometry(jetPositions, nearWidth, farWidth, farHeight,
                direction * jetLength, 1.3 * this.scale);
            this._visual.jetMaterial.opacity = 0.42 * (1 - progress * 0.36) * tailFade;

            const fallHeight = Math.min(8 * this.scale, max[1] - floorY);
            const leak = Math.max(0.08, Math.min(1, elapsed / 0.9));
            this._visual.fall.visible = waveActive && hasBreach;
            this._visual.fall.position.set((min[0] + max[0]) * 0.5,
                floorY + fallHeight * 0.5, sourceZ);
            this._visual.fall.scale.set(sourceWidth * leak, fallHeight, 2.8 * this.scale);
            this._visual.fallMaterial.opacity = 0.45 * tailFade;
        } else {
            this._visual.jet.visible = false;
            this._visual.fall.visible = false;
        }
        const reservoirSurface = this._visual.reservoirSurface;
        if (reservoirSurface) {
            const positions = reservoirSurface.geometry.attributes.position;
            const base = this._visual.reservoirBasePositions;
            const amplitude = this.scale * 0.32;
            for (let index = 0; index < positions.count; index += 1) {
                const offset = index * 3;
                const x = base[offset];
                const y = base[offset + 1];
                positions.array[offset + 2] = (
                    Math.sin((x * 0.038) + this._visualTime * 1.1)
                    + Math.sin((y * 0.16) - this._visualTime * 0.82)
                ) * amplitude * 0.5;
            }
            positions.needsUpdate = true;
        }
        const surfaceActive = state.phase === WATER_PHASES.RISING || state.phase === WATER_PHASES.FLOODED;
        const visibleDepth = state.level - floorY;
        this._visual.surface.visible = surfaceActive && (this.zone.waveFloorOffset === 0 || visibleDepth > 0);
        this._visual.surface.position.y = state.level;
        const surfaceFade = this.zone.waveFloorOffset === 0 ? 1
            : Math.max(0, Math.min(1, visibleDepth / Math.max(0.1, this.scale * 2)));
        this._visual.surfaceMaterial.opacity = (state.phase === WATER_PHASES.FLOODED ? 0.68 : 0.56)
            * surfaceFade;
        if (this._visual.surface.visible) {
            const positions = this._visual.surface.geometry.attributes.position;
            const base = this._visual.surfaceBasePositions;
            const amplitude = this.scale * (state.phase === WATER_PHASES.FLOODED ? 0.42 : 0.7);
            for (let index = 0; index < positions.count; index += 1) {
                const offset = index * 3;
                const x = base[offset];
                const y = base[offset + 1];
                positions.array[offset + 2] = (
                    Math.sin((x * 0.035) + visualTime * 1.35)
                    + Math.sin((y * 0.027) - visualTime * 1.05)
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
