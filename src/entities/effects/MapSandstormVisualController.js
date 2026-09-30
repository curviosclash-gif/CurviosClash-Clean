import * as THREE from 'three';

import { MAP_SANDSTORM_PHASES } from '../../shared/contracts/MapSandstormContract.js';

// Dust travels with each camera: a storm view is only a dozen metres deep, so streaks spread over
// the whole arena were statistically never seen. The box is a little larger than that view.
const MAX_VIEWS = 4;
const DUST_PER_VIEW = 128;
const DUST_PER_VIEW_REDUCED = 40;
const DUST_HALF_EXTENTS = Object.freeze([15, 9, 15]);
const DUST_SPEED = Object.freeze([22, 48]);
const DUST_OPACITY = 0.5;
const SHELTERED_DUST_FACTOR = 0.2;
// Three staggered front layers, the first leading, each fainter behind it.
const FRONT_LAYERS = Object.freeze([
    Object.freeze({ lag: 0, opacity: 1 }),
    Object.freeze({ lag: 0.08, opacity: 0.65 }),
    Object.freeze({ lag: 0.16, opacity: 0.4 }),
]);
const FRONT_WARNING_TRAVEL = 0.45;
const FRONT_MAX_OPACITY = 0.46;

function createSeededRandom(seed = 0x51a7d) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export class MapSandstormVisualController {
    constructor(renderer) {
        this.renderer = renderer || null;
        this.group = null;
        this._frontLayers = [];
        this._dust = [];
        this._frontOpacity = 0;
        this._warningSeconds = 20;
        this._outdoorFar = 12;
        this._matrix = new THREE.Matrix4();
        this._position = new THREE.Vector3();
        this._quaternion = new THREE.Quaternion();
        this._unitScale = new THREE.Vector3(1, 1, 1);
        this._up = new THREE.Vector3(0, 1, 0);
        this._yaw = NaN;
        this._bounds = { halfX: 1, halfZ: 1, height: 1 };
    }

    build(mapSize, scale = 1, { warningSeconds = 20, outdoorFar = 12 } = {}) {
        this.dispose();
        const factor = Math.max(0.001, Number(scale) || 1);
        this._bounds.halfX = Math.max(1, Number(mapSize?.[0]) * factor * 0.5 || 1);
        this._bounds.height = Math.max(1, Number(mapSize?.[1]) * factor || 1);
        this._bounds.halfZ = Math.max(1, Number(mapSize?.[2]) * factor * 0.5 || 1);
        this._warningSeconds = Math.max(0.001, Number(warningSeconds) || 20);
        this._outdoorFar = Math.max(0, Number(outdoorFar) || 0);
        this._yaw = NaN;
        this.group = new THREE.Group();
        this.group.name = 'map-sandstorm-visual';
        this.group.visible = false;

        // From below the floor to above the ceiling, so the front is a wall of sand at every height.
        const frontGeometry = new THREE.PlaneGeometry(
            Math.max(this._bounds.halfX, this._bounds.halfZ) * 2.4,
            this._bounds.height * 1.25
        );
        for (let index = 0; index < FRONT_LAYERS.length; index += 1) {
            const layer = new THREE.Mesh(frontGeometry, new THREE.MeshBasicMaterial({
                color: 0xb8682f,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                side: THREE.DoubleSide,
                fog: false,
            }));
            layer.name = `sandstorm-front-${index}-noshadow`;
            layer.frustumCulled = false;
            this._frontLayers.push(layer);
            this.group.add(layer);
        }

        const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        const count = reducedMotion ? DUST_PER_VIEW_REDUCED : DUST_PER_VIEW;
        const streakGeometry = new THREE.BoxGeometry(2.6, 0.07, 0.07);
        const random = createSeededRandom();
        for (let view = 0; view < MAX_VIEWS; view += 1) {
            const mesh = new THREE.InstancedMesh(streakGeometry, new THREE.MeshBasicMaterial({
                color: 0xe1a45f,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                fog: true,
            }), count);
            mesh.name = `sandstorm-dust-${view}-noshadow`;
            mesh.frustumCulled = false;
            mesh.visible = false;
            const offsets = new Float32Array(count * 3);
            const speeds = new Float32Array(count);
            for (let index = 0; index < count; index += 1) {
                for (let axis = 0; axis < 3; axis += 1) {
                    offsets[index * 3 + axis] = (random() * 2 - 1) * DUST_HALF_EXTENTS[axis];
                }
                speeds[index] = DUST_SPEED[0] + random() * (DUST_SPEED[1] - DUST_SPEED[0]);
            }
            this._dust.push({ mesh, offsets, speeds });
            this.group.add(mesh);
        }
        this.renderer?.addToScene?.(this.group);
    }

    update(dt, state, direction) {
        if (!this.group) return;
        const phase = String(state?.phase || MAP_SANDSTORM_PHASES.CALM);
        const active = state?.enabled === true && phase === MAP_SANDSTORM_PHASES.ACTIVE;
        const warning = state?.enabled === true && phase === MAP_SANDSTORM_PHASES.WARNING;
        this.group.visible = active || warning;
        if (!this.group.visible) {
            this._frontOpacity = 0;
            return;
        }
        const dirX = Number(direction?.[0]) || 0;
        const dirZ = Number(direction?.[1]) || 0;
        const intensity = active ? Math.max(0, Math.min(1, Number(state?.intensity) || 0)) : 0;
        this._updateFront(warning, intensity, Number(state?.remainingSeconds) || 0, dirX, dirZ);
        this._updateDust(active ? intensity : 0, Math.max(0, Math.min(0.05, Number(dt) || 0)), dirX, dirZ);
    }

    _updateFront(warning, intensity, remainingSeconds, dirX, dirZ) {
        // The front keeps rolling across the arena after the storm starts and dissolves into it
        // over the first half of the swell; both ends meet at the warning's last value.
        const warningProgress = warning
            ? Math.max(0, Math.min(1, 1 - remainingSeconds / this._warningSeconds))
            : 1;
        const arrival = warning ? 0 : smoothstep(0, 0.5, intensity);
        this._frontOpacity = warning
            ? 0.12 + warningProgress * (FRONT_MAX_OPACITY - 0.12)
            : FRONT_MAX_OPACITY * (1 - arrival);
        const span = Math.max(this._bounds.halfX, this._bounds.halfZ);
        const travel = (warning ? warningProgress * FRONT_WARNING_TRAVEL
            : FRONT_WARNING_TRAVEL + (1 - FRONT_WARNING_TRAVEL) * arrival) * span;
        const startX = -dirX * this._bounds.halfX;
        const startZ = -dirZ * this._bounds.halfZ;
        for (let index = 0; index < this._frontLayers.length; index += 1) {
            const layer = this._frontLayers[index];
            const along = travel - FRONT_LAYERS[index].lag * span;
            layer.position.set(startX + dirX * along, this._bounds.height * 0.5, startZ + dirZ * along);
            layer.rotation.set(0, dirX !== 0 ? Math.PI * 0.5 : 0, 0);
            layer.material.opacity = this._frontOpacity * FRONT_LAYERS[index].opacity;
            layer.visible = layer.material.opacity > 0.001;
        }
    }

    _updateDust(intensity, step, dirX, dirZ) {
        const yaw = Math.atan2(-dirZ, dirX);
        if (yaw !== this._yaw) {
            this._yaw = yaw;
            this._quaternion.setFromAxisAngle(this._up, yaw);
        }
        const cameras = Array.isArray(this.renderer?.cameras) ? this.renderer.cameras : [];
        for (let view = 0; view < this._dust.length; view += 1) {
            const dust = this._dust[view];
            const camera = cameras[view];
            dust.mesh.visible = intensity > 0 && !!camera;
            if (!dust.mesh.visible) continue;
            const sheltered = Number(camera.userData?.sandstormVisibilityRange) > this._outdoorFar;
            dust.mesh.material.opacity = DUST_OPACITY * intensity * (sheltered ? SHELTERED_DUST_FACTOR : 1);
            const count = dust.mesh.count;
            for (let index = 0; index < count; index += 1) {
                const offset = index * 3;
                const advance = dust.speeds[index] * step;
                dust.offsets[offset] = wrap(dust.offsets[offset] + dirX * advance, DUST_HALF_EXTENTS[0]);
                dust.offsets[offset + 2] = wrap(dust.offsets[offset + 2] + dirZ * advance, DUST_HALF_EXTENTS[2]);
                this._position.set(
                    camera.position.x + dust.offsets[offset],
                    camera.position.y + dust.offsets[offset + 1],
                    camera.position.z + dust.offsets[offset + 2]
                );
                this._matrix.compose(this._position, this._quaternion, this._unitScale);
                dust.mesh.setMatrixAt(index, this._matrix);
            }
            dust.mesh.instanceMatrix.needsUpdate = true;
        }
    }

    getDustMeshes() {
        const cameras = Array.isArray(this.renderer?.cameras) ? this.renderer.cameras.length : 0;
        return this._dust.slice(0, Math.min(this._dust.length, cameras)).map((entry) => entry.mesh);
    }

    getDustCount() {
        let count = 0;
        for (const entry of this._dust) if (entry.mesh.visible) count += entry.mesh.count;
        return count;
    }

    getFrontLayers() { return this._frontLayers; }

    getFrontOpacity() { return this._frontOpacity; }

    reset() {
        if (this.group) this.group.visible = false;
        this._frontOpacity = 0;
    }

    dispose() {
        if (!this.group) return;
        this.renderer?.removeFromScene?.(this.group);
        this._frontLayers[0]?.geometry?.dispose?.();
        for (const layer of this._frontLayers) layer.material.dispose();
        this._dust[0]?.mesh?.geometry?.dispose?.();
        for (const entry of this._dust) entry.mesh.material.dispose();
        this.group.clear();
        this.group = null;
        this._frontLayers = [];
        this._dust = [];
    }
}

function wrap(value, half) {
    if (value > half) return value - 2 * half;
    if (value < -half) return value + 2 * half;
    return value;
}
