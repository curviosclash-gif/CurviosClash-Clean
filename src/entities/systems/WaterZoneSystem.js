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
        waveOpeningWidth: zone.waveOpeningWidth * scale,
        waveSourceInset: zone.waveSourceInset * scale,
        waveFloorOffset: zone.waveFloorOffset * scale,
    });
}

function createWaveCrestGeometry(width, height, segments = 48, volumetric = false) {
    const positions = [];
    const indices = [];
    for (let index = 0; index < segments; index += 1) {
        const x0 = -width / 2 + ((width * index) / segments);
        const x1 = -width / 2 + ((width * (index + 1)) / segments);
        const y0 = height * (0.78 + (Math.sin(index * 1.71) * 0.09) + (Math.sin(index * 0.37) * 0.08));
        const y1 = height * (0.78 + (Math.sin((index + 1) * 1.71) * 0.09) + (Math.sin((index + 1) * 0.37) * 0.08));
        const vertex = positions.length / 3;
        if (volumetric) {
            const depth = height * 0.28;
            positions.push(
                x0, 0, -depth, x1, 0, -depth, x1, y1, 0, x0, y0, 0,
                x0, 0, depth, x1, 0, depth,
            );
            indices.push(
                vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3,
                vertex + 3, vertex + 2, vertex + 5, vertex + 3, vertex + 5, vertex + 4,
                vertex + 4, vertex + 5, vertex + 1, vertex + 4, vertex + 1, vertex,
            );
        } else {
            positions.push(x0, 0, 0, x1, 0, 0, x1, y1, 0, x0, y0, 0);
            indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createJetGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    geometry.setIndex([
        0, 1, 3, 1, 2, 3, 4, 7, 5, 5, 7, 6,
        0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
        1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4,
    ]);
    return geometry;
}

function updateJetGeometry(positions, nearWidth, farWidth, farHeight, length, height) {
    const values = positions.array;
    values[0] = -nearWidth; values[1] = 0; values[2] = 0;
    values[3] = nearWidth; values[4] = 0; values[5] = 0;
    values[6] = farWidth; values[7] = farHeight; values[8] = length;
    values[9] = -farWidth; values[10] = farHeight; values[11] = length;
    values[12] = -nearWidth; values[13] = height; values[14] = 0;
    values[15] = nearWidth; values[16] = height; values[17] = 0;
    values[18] = farWidth; values[19] = 0; values[20] = length;
    values[21] = -farWidth; values[22] = 0; values[23] = length;
    positions.needsUpdate = true;
}

function deterministicUnit(index, salt) {
    const value = Math.sin((index + 1) * (12.9898 + salt)) * 43758.5453;
    return value - Math.floor(value);
}

function createSoftSprayTexture() {
    const size = 16;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const distance = Math.hypot((x + 0.5 - size / 2) / (size / 2),
                (y + 0.5 - size / 2) / (size / 2));
            const offset = (y * size + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = Math.round(180 * Math.max(0, 1 - distance) ** 2);
        }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
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
        const surfaceGeometry = new THREE.PlaneGeometry(width, depth, 20, 20);
        const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
        surface.name = `${group.name}-surface`;
        surface.rotation.x = -Math.PI / 2;
        surface.position.set((min[0] + max[0]) * 0.5, this.zone.startLevel, (min[2] + max[2]) * 0.5);
        surface.renderOrder = 4;
        const surfaceBasePositions = new Float32Array(surfaceGeometry.attributes.position.array);

        const waveGroup = new THREE.Group();
        waveGroup.name = `${group.name}-wave`;
        const shapedWave = this.zone.waveOpeningWidth < width - 0.01 || this.zone.waveSourceInset > 0;
        const crestHeight = (shapedWave ? 18 : 9) * this.scale;
        const wakeSign = this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z ? 1 : -1;
        const waveMaterials = [];
        const crestSettings = shapedWave ? [
            { height: crestHeight, offset: 0, color: 0x5dc4da, opacity: 0.84 },
            { height: crestHeight * 0.62, offset: 3.5 * this.scale, color: 0x2992b3, opacity: 0.62 },
            { height: crestHeight * 0.38, offset: 7.5 * this.scale, color: 0x155674, opacity: 0.48 },
        ] : [
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
                blending: shapedWave || index > 0 ? THREE.NormalBlending : THREE.AdditiveBlending,
                toneMapped: false,
            });
            const crest = new THREE.Mesh(
                createWaveCrestGeometry(width, settings.height, 48, shapedWave), waveMaterial,
            );
            crest.frustumCulled = false;
            crest.name = `${waveGroup.name}-crest-${index + 1}`;
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
        const foamGeometry = new THREE.PlaneGeometry(width, 10 * this.scale, 24, 1);
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
        foam.name = `${waveGroup.name}-foam`;
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(0, 0.35 * this.scale, 4 * this.scale * wakeSign);
        foam.renderOrder = 9;
        waveGroup.add(foam);

        const sprayData = createWaveSprayGeometry(width, crestHeight, shapedWave ? 64 : 96);
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
            this.zone.startLevel + this.zone.waveFloorOffset,
            this.zone.waveOrigin === WATER_WAVE_ORIGINS.MAX_Z
                ? max[2] - this.zone.waveSourceInset : min[2] + this.zone.waveSourceInset,
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
        const sourceZ = atMax ? max[2] - this.zone.waveSourceInset : min[2] + this.zone.waveSourceInset;
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
            const frontZ = sourceZ + (finishZ - sourceZ) * progress;
            this._visual.waveGroup.position.z = frontZ;
            this._visual.waveGroup.position.y = floorY;
            this._visual.waveGroup.scale.x = waveWidth / width;
            if (hasBreach) this._visual.foam.scale.y = 0.65 + progress * 0.7;
            const tailFade = hasBreach
                ? Math.max(0, Math.min(1, (this.zone.waveSeconds - elapsed) / 0.8)) : 1;
            this._visual.waveGroup.scale.y = hasBreach
                ? ((0.52 + 0.48 * Math.min(1, elapsed / 0.9)) * (1 - progress * 0.48)
                    * tailFade) + 0.02 * (1 - tailFade)
                : 1 - progress * 0.34;
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
    }

    dispose() {
        this.clear();
        this.entityManager = null;
    }
}
