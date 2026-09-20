import * as THREE from 'three';

import { MAP_SANDSTORM_PHASES } from '../../shared/contracts/MapSandstormContract.js';

const PARTICLE_COUNT = 256;

function createSeededRandom(seed = 0x51a7d) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

export class MapSandstormVisualController {
    constructor(renderer) {
        this.renderer = renderer || null;
        this.group = null;
        this.front = null;
        this.particles = null;
        this.positions = new Float32Array(PARTICLE_COUNT * 3);
        this.speeds = new Float32Array(PARTICLE_COUNT);
        this.particleCount = PARTICLE_COUNT;
        this._matrix = new THREE.Matrix4();
        this._bounds = { halfX: 1, halfZ: 1, height: 1 };
    }

    build(mapSize, scale = 1) {
        this.dispose();
        const factor = Math.max(0.001, Number(scale) || 1);
        this._bounds.halfX = Math.max(1, Number(mapSize?.[0]) * factor * 0.5 || 1);
        this._bounds.height = Math.max(1, Number(mapSize?.[1]) * factor || 1);
        this._bounds.halfZ = Math.max(1, Number(mapSize?.[2]) * factor * 0.5 || 1);
        this.group = new THREE.Group();
        this.group.name = 'map-sandstorm-visual';
        this.group.visible = false;

        const frontGeometry = new THREE.PlaneGeometry(
            Math.max(this._bounds.halfX, this._bounds.halfZ) * 2.4,
            this._bounds.height * 1.25
        );
        const frontMaterial = new THREE.MeshBasicMaterial({
            color: 0xb8682f,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
        });
        this.front = new THREE.Mesh(frontGeometry, frontMaterial);
        this.front.name = 'sandstorm-front-noshadow';
        this.group.add(this.front);

        const particleGeometry = new THREE.BoxGeometry(5, 0.2, 0.35);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: 0xe1a45f,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: true,
        });
        this.particles = new THREE.InstancedMesh(particleGeometry, particleMaterial, PARTICLE_COUNT);
        const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        this.particleCount = reducedMotion ? 64 : PARTICLE_COUNT;
        this.particles.count = this.particleCount;
        this.particles.name = 'sandstorm-streaks-noshadow';
        this.particles.frustumCulled = false;
        this.group.add(this.particles);

        const random = createSeededRandom();
        for (let index = 0; index < this.particleCount; index += 1) {
            const offset = index * 3;
            this.positions[offset] = (random() * 2 - 1) * this._bounds.halfX;
            this.positions[offset + 1] = random() * this._bounds.height;
            this.positions[offset + 2] = (random() * 2 - 1) * this._bounds.halfZ;
            this.speeds[index] = 38 + random() * 72;
            this._matrix.makeTranslation(
                this.positions[offset], this.positions[offset + 1], this.positions[offset + 2]
            );
            this.particles.setMatrixAt(index, this._matrix);
        }
        this.particles.instanceMatrix.needsUpdate = true;
        this.renderer?.addToScene?.(this.group);
    }

    update(dt, state, direction) {
        if (!this.group || !this.front || !this.particles) return;
        const phase = String(state?.phase || MAP_SANDSTORM_PHASES.CALM);
        const active = state?.enabled === true && phase === MAP_SANDSTORM_PHASES.ACTIVE;
        const warning = state?.enabled === true && phase === MAP_SANDSTORM_PHASES.WARNING;
        this.group.visible = active || warning;
        if (!this.group.visible) return;
        const dirX = Number(direction?.[0]) || 0;
        const dirZ = Number(direction?.[1]) || 0;
        const warningProgress = warning
            ? Math.max(0, Math.min(1, 1 - (Number(state?.remainingSeconds) || 0) / 20))
            : 1;
        const intensity = active ? Math.max(0.05, Number(state?.intensity) || 0) : warningProgress * 0.32;
        this.front.material.opacity = warning ? 0.12 + warningProgress * 0.34 : 0.08 * intensity;
        this.particles.material.opacity = active ? 0.42 * intensity : 0.08 * warningProgress;

        const startX = dirX === 0 ? 0 : -dirX * this._bounds.halfX;
        const startZ = dirZ === 0 ? 0 : -dirZ * this._bounds.halfZ;
        const travel = warningProgress * Math.max(this._bounds.halfX, this._bounds.halfZ) * 0.45;
        this.front.position.set(
            startX + dirX * travel,
            this._bounds.height * 0.48,
            startZ + dirZ * travel
        );
        this.front.rotation.set(0, dirX !== 0 ? Math.PI * 0.5 : 0, 0);

        if (!active) return;
        const step = Math.max(0, Math.min(0.05, Number(dt) || 0));
        for (let index = 0; index < this.particleCount; index += 1) {
            const offset = index * 3;
            this.positions[offset] += dirX * this.speeds[index] * step;
            this.positions[offset + 2] += dirZ * this.speeds[index] * step;
            if (this.positions[offset] > this._bounds.halfX) this.positions[offset] = -this._bounds.halfX;
            else if (this.positions[offset] < -this._bounds.halfX) this.positions[offset] = this._bounds.halfX;
            if (this.positions[offset + 2] > this._bounds.halfZ) this.positions[offset + 2] = -this._bounds.halfZ;
            else if (this.positions[offset + 2] < -this._bounds.halfZ) this.positions[offset + 2] = this._bounds.halfZ;
            this._matrix.makeTranslation(
                this.positions[offset], this.positions[offset + 1], this.positions[offset + 2]
            );
            this.particles.setMatrixAt(index, this._matrix);
        }
        this.particles.instanceMatrix.needsUpdate = true;
    }

    reset() {
        if (this.group) this.group.visible = false;
    }

    dispose() {
        if (!this.group) return;
        this.renderer?.removeFromScene?.(this.group);
        this.front?.geometry?.dispose?.();
        this.front?.material?.dispose?.();
        this.particles?.geometry?.dispose?.();
        this.particles?.material?.dispose?.();
        this.group.clear();
        this.group = null;
        this.front = null;
        this.particles = null;
    }
}
