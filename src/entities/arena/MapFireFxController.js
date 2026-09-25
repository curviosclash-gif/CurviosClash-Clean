import * as THREE from 'three';
import { normalizeMapFireFx } from '../../shared/contracts/MapFireFxContract.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

const TAU = Math.PI * 2;

function fract(value) {
    return value - Math.floor(value);
}

function seeded(index, salt) {
    return fract(Math.sin((index + 1) * (12.9898 + salt * 17.137)) * 43758.5453);
}

function createRadialSprite(size = 16) {
    const data = new Uint8Array(size * size * 4);
    const center = (size - 1) * 0.5;
    const radius = Math.max(1, center);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const offset = (y * size + x) * 4;
            const distance = Math.hypot(x - center, y - center) / radius;
            const alpha = Math.max(0, Math.min(1, 1 - distance));
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
            data[offset + 3] = Math.round(alpha * alpha * 255);
        }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}

function createPointLayer(name, definition, scale, { additive = false } = {}) {
    const count = definition.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: definition.size * scale,
        map: createRadialSprite(),
        transparent: true,
        opacity: definition.opacity,
        vertexColors: true,
        depthWrite: false,
        sizeAttenuation: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: !additive,
    });
    const points = new THREE.Points(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    points.renderOrder = additive ? 6 : 4;
    return {
        definition,
        color: new THREE.Color(definition.color),
        positions,
        colors,
        points,
        seedsA: Float32Array.from({ length: count }, (_, index) => seeded(index, 1)),
        seedsB: Float32Array.from({ length: count }, (_, index) => seeded(index, 2)),
        seedsC: Float32Array.from({ length: count }, (_, index) => seeded(index, 3)),
    };
}

function markLayerDirty(layer) {
    layer.points.geometry.attributes.position.needsUpdate = true;
    layer.points.geometry.attributes.color.needsUpdate = true;
}

export class MapFireFxController {
    constructor(renderer) {
        this.renderer = renderer;
        this.group = null;
        this.profile = null;
        this.scale = 1;
        this.layers = null;
        this.lightTracks = [];
        this.elapsedSeconds = 0;
        this.intensity = 1;
    }

    build(map, mapScale = 1, lights = []) {
        this.clear();
        const profile = normalizeMapFireFx(map?.fireFx);
        if (!profile) return null;

        this.profile = profile;
        this.scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(mapScale) || 1)
            : 1;
        this.group = new THREE.Group();
        this.group.name = 'map-fire-fx';
        this.layers = {
            smoke: createPointLayer('map-fire-smoke', profile.smoke, this.scale),
            embers: createPointLayer('map-fire-embers', profile.embers, this.scale, { additive: true }),
            ash: createPointLayer('map-fire-ash', profile.ash, this.scale),
        };
        this.group.add(this.layers.smoke.points, this.layers.embers.points, this.layers.ash.points);
        this.renderer?.addToScene?.(this.group);

        const lightsById = new Map();
        for (const light of Array.isArray(lights) ? lights : []) {
            const id = String(light?.userData?.authoredLightId || '');
            if (id) lightsById.set(id, light);
        }
        this.lightTracks = profile.flicker.map((entry) => {
            const light = lightsById.get(entry.lightId) || null;
            return light ? { ...entry, light, baseIntensity: light.intensity } : null;
        }).filter(Boolean);

        this.update(0);
        return this.group;
    }

    setIntensity(value) {
        this.intensity = Math.max(0, Math.min(1, Number(value) || 0));
        if (this.group) this.group.visible = this.intensity > 0;
        if (this.layers) for (const key in this.layers) { const layer = this.layers[key]; layer.points.material.opacity = layer.definition.opacity * this.intensity; }
        this._updateLights();
    }

    update(elapsedSeconds) {
        if (!this.profile || !this.layers) return;
        const numeric = Number(elapsedSeconds);
        this.elapsedSeconds = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
        this._updateSmoke();
        this._updateEmbers();
        this._updateAsh();
        this._updateLights();
    }

    _updateSmoke() {
        const layer = this.layers.smoke;
        const emitters = this.profile.emitters;
        const color = layer.color;
        const time = this.elapsedSeconds;
        for (let index = 0; index < layer.definition.count; index += 1) {
            const emitter = emitters[index % emitters.length];
            const age = fract((time / layer.definition.lifetime) + layer.seedsA[index] + emitter.phase);
            const angle = layer.seedsB[index] * TAU + time * (0.08 + layer.seedsC[index] * 0.06);
            const radial = emitter.radius * (0.18 + age * 0.92) * (0.35 + layer.seedsC[index] * 0.65);
            const dst = index * 3;
            layer.positions[dst] = (emitter.position[0] + Math.cos(angle) * radial + this.profile.wind[0] * age) * this.scale;
            layer.positions[dst + 1] = (emitter.position[1] + emitter.smokeHeight * age + this.profile.wind[1] * age) * this.scale;
            layer.positions[dst + 2] = (emitter.position[2] + Math.sin(angle) * radial + this.profile.wind[2] * age) * this.scale;
            const fade = 0.95 - age * 0.68;
            layer.colors[dst] = color.r * fade;
            layer.colors[dst + 1] = color.g * fade;
            layer.colors[dst + 2] = color.b * fade;
        }
        markLayerDirty(layer);
    }

    _updateEmbers() {
        const layer = this.layers.embers;
        const emitters = this.profile.emitters;
        const color = layer.color;
        const time = this.elapsedSeconds;
        for (let index = 0; index < layer.definition.count; index += 1) {
            const emitter = emitters[index % emitters.length];
            const age = fract((time / layer.definition.lifetime) + layer.seedsA[index] + emitter.phase);
            const angle = layer.seedsB[index] * TAU + time * (0.7 + layer.seedsC[index] * 0.6);
            const radial = emitter.radius * (0.08 + layer.seedsC[index] * 0.35) * (1 + age * 0.45);
            const dst = index * 3;
            layer.positions[dst] = (emitter.position[0] + Math.cos(angle) * radial + this.profile.wind[0] * age * 0.45) * this.scale;
            layer.positions[dst + 1] = (emitter.position[1] + emitter.emberHeight * age + this.profile.wind[1] * age) * this.scale;
            layer.positions[dst + 2] = (emitter.position[2] + Math.sin(angle) * radial + this.profile.wind[2] * age * 0.45) * this.scale;
            const pulse = 0.45 + 0.55 * Math.sin(Math.PI * age);
            layer.colors[dst] = color.r * pulse;
            layer.colors[dst + 1] = color.g * pulse;
            layer.colors[dst + 2] = color.b * pulse;
        }
        markLayerDirty(layer);
    }

    _updateAsh() {
        const layer = this.layers.ash;
        const color = layer.color;
        const min = this.profile.ashVolumeMin;
        const max = this.profile.ashVolumeMax;
        const spanX = Math.max(1, max[0] - min[0]);
        const spanY = Math.max(1, max[1] - min[1]);
        const spanZ = Math.max(1, max[2] - min[2]);
        const time = this.elapsedSeconds;
        for (let index = 0; index < layer.definition.count; index += 1) {
            const dst = index * 3;
            const age = fract((time / layer.definition.lifetime) + layer.seedsA[index]);
            layer.positions[dst] = (min[0] + fract(layer.seedsB[index] + time * this.profile.wind[0] / spanX) * spanX) * this.scale;
            layer.positions[dst + 1] = (min[1] + fract(layer.seedsC[index] - time * Math.max(0.6, -this.profile.wind[1] + 0.8) / spanY) * spanY) * this.scale;
            layer.positions[dst + 2] = (min[2] + fract(layer.seedsA[index] + time * this.profile.wind[2] / spanZ) * spanZ) * this.scale;
            const shimmer = 0.45 + 0.45 * Math.sin((age + layer.seedsB[index]) * TAU);
            layer.colors[dst] = color.r * shimmer;
            layer.colors[dst + 1] = color.g * shimmer;
            layer.colors[dst + 2] = color.b * shimmer;
        }
        markLayerDirty(layer);
    }

    _updateLights() {
        const time = this.elapsedSeconds;
        for (const track of this.lightTracks) {
            const primary = Math.sin(time * track.frequency * TAU + track.phase);
            const secondary = Math.sin(time * track.frequency * 2.37 + track.phase * 0.61);
            const wave = primary * 0.68 + secondary * 0.32;
            track.light.intensity = track.baseIntensity * this.intensity * (1 + wave * track.amplitude);
        }
    }

    clear() {
        for (const track of this.lightTracks) {
            if (track?.light) track.light.intensity = track.baseIntensity;
        }
        this.lightTracks = [];
        if (this.group) {
            this.renderer?.removeFromScene?.(this.group);
            disposeObject3DResources(this.group);
        }
        this.group = null;
        this.profile = null;
        this.layers = null;
        this.scale = 1;
        this.elapsedSeconds = 0;
        this.intensity = 1;
    }

    dispose() {
        this.clear();
    }
}
