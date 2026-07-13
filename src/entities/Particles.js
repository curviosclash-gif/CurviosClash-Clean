// ============================================
// Particles.js - Optimized Particle System (InstancedMesh)
// ============================================

import * as THREE from 'three';
import { disposeObject3DResources } from '../core/three-disposal.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

const MAX_PARTICLES = 1000;
const DUMMY = new THREE.Object3D();

export class ParticleSystem {
    constructor(renderer, configSource = null) {
        this.renderer = renderer;
        this.configSource = configSource || null;
        this.count = 0;
        this._debugEvents = [];
        this._maxDebugEvents = 24;

        // Data arrays (Structure of Arrays for cache locality)
        this.positions = new Float32Array(MAX_PARTICLES * 3);
        this.velocities = new Float32Array(MAX_PARTICLES * 3);
        this.lifetimes = new Float32Array(MAX_PARTICLES);
        this.maxLifetimes = new Float32Array(MAX_PARTICLES);
        this.gravities = new Float32Array(MAX_PARTICLES);
        this.scales = new Float32Array(MAX_PARTICLES);

        // Color tracking (InstanceColor is stored on GPU, but we need CPU copy for compaction)
        this.colors = new Float32Array(MAX_PARTICLES * 3);

        // Geometry & Material
        const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
        });

        this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;

        this.renderer.addToScene(this.mesh);
        this._tmpColor = new THREE.Color();
        this._tmpDirection = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._tmpUp = new THREE.Vector3();
        this._tmpVelocity = new THREE.Vector3();
    }

    _recordDebugEvent(type, count, color) {
        this._debugEvents.push({
            type,
            count,
            color,
            at: typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now(),
        });
        if (this._debugEvents.length > this._maxDebugEvents) {
            this._debugEvents.splice(0, this._debugEvents.length - this._maxDebugEvents);
        }
    }

    getRecentEvents(limit = 10) {
        const size = Math.max(0, Number(limit) || 0);
        return size > 0 ? this._debugEvents.slice(-size) : [];
    }

    clearDebugEvents() {
        this._debugEvents.length = 0;
    }

    spawn(position, count, color, speed = 1.0, size = 0.5, life = 1.0, options = {}) {
        if (!this.mesh) return;
        const gravity = Number.isFinite(Number(options.gravity)) ? Number(options.gravity) : -5.0;
        const debugType = options.type || 'generic-impact';
        this._tmpColor.setHex(color);
        this._recordDebugEvent(debugType, count, color);

        for (let i = 0; i < count; i++) {
            if (this.count >= MAX_PARTICLES) return;

            const idx = this.count;
            this.count++;

            // Position
            this.positions[idx * 3] = position.x;
            this.positions[idx * 3 + 1] = position.y;
            this.positions[idx * 3 + 2] = position.z;

            // Velocity
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = speed * (0.5 + Math.random() * 0.5);

            this.velocities[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
            this.velocities[idx * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            this.velocities[idx * 3 + 2] = r * Math.cos(phi);

            // Properties
            this.lifetimes[idx] = life * (0.8 + Math.random() * 0.4);
            this.maxLifetimes[idx] = this.lifetimes[idx];
            this.gravities[idx] = gravity;
            this.scales[idx] = size * (0.5 + Math.random() * 0.5);

            // Color
            this.colors[idx * 3] = this._tmpColor.r;
            this.colors[idx * 3 + 1] = this._tmpColor.g;
            this.colors[idx * 3 + 2] = this._tmpColor.b;

            // Set initial color
            this.mesh.setColorAt(idx, this._tmpColor);

            // Set initial matrix
            DUMMY.position.set(this.positions[idx * 3], this.positions[idx * 3 + 1], this.positions[idx * 3 + 2]);
            DUMMY.scale.setScalar(this.scales[idx]);
            DUMMY.updateMatrix();
            this.mesh.setMatrixAt(idx, DUMMY.matrix);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    spawnDirectional(position, direction, count, color, speed = 1.0, size = 0.5, life = 1.0, options = {}) {
        if (!this.mesh || !position || !direction) return;
        const gravity = Number.isFinite(Number(options.gravity)) ? Number(options.gravity) : 0;
        const spread = THREE.MathUtils.clamp(
            Number.isFinite(Number(options.spread)) ? Number(options.spread) : 0.25,
            0,
            2
        );
        const drift = Number.isFinite(Number(options.drift)) ? Number(options.drift) : 0.35;
        const debugType = options.type || 'directional-burst';

        this._tmpDirection.copy(direction);
        if (this._tmpDirection.lengthSq() <= 0.000001) {
            this._tmpDirection.set(0, 0, 1);
        } else {
            this._tmpDirection.normalize();
        }

        this._tmpRight.crossVectors(this._tmpDirection, DUMMY.up);
        if (this._tmpRight.lengthSq() <= 0.000001) {
            this._tmpRight.set(1, 0, 0);
        } else {
            this._tmpRight.normalize();
        }
        this._tmpUp.crossVectors(this._tmpRight, this._tmpDirection).normalize();
        this._tmpColor.setHex(color);
        this._recordDebugEvent(debugType, count, color);

        for (let i = 0; i < count; i++) {
            if (this.count >= MAX_PARTICLES) return;

            const idx = this.count;
            this.count++;
            const idx3 = idx * 3;
            const angle = Math.random() * Math.PI * 2;
            const radial = Math.random() * spread;
            const forwardSpeed = speed * (0.65 + Math.random() * 0.6);

            this.positions[idx3] = position.x;
            this.positions[idx3 + 1] = position.y;
            this.positions[idx3 + 2] = position.z;

            this._tmpVelocity.copy(this._tmpDirection).multiplyScalar(forwardSpeed);
            this._tmpVelocity.addScaledVector(this._tmpRight, Math.cos(angle) * radial * speed);
            this._tmpVelocity.addScaledVector(this._tmpUp, Math.sin(angle) * radial * speed);
            this._tmpVelocity.addScaledVector(this._tmpDirection, Math.random() * drift * speed);

            this.velocities[idx3] = this._tmpVelocity.x;
            this.velocities[idx3 + 1] = this._tmpVelocity.y;
            this.velocities[idx3 + 2] = this._tmpVelocity.z;

            this.lifetimes[idx] = life * (0.85 + Math.random() * 0.35);
            this.maxLifetimes[idx] = this.lifetimes[idx];
            this.gravities[idx] = gravity;
            this.scales[idx] = size * (0.6 + Math.random() * 0.45);

            this.colors[idx3] = this._tmpColor.r;
            this.colors[idx3 + 1] = this._tmpColor.g;
            this.colors[idx3 + 2] = this._tmpColor.b;

            this.mesh.setColorAt(idx, this._tmpColor);
            DUMMY.position.set(this.positions[idx3], this.positions[idx3 + 1], this.positions[idx3 + 2]);
            DUMMY.rotation.set(0, 0, 0);
            DUMMY.scale.setScalar(this.scales[idx]);
            DUMMY.updateMatrix();
            this.mesh.setMatrixAt(idx, DUMMY.matrix);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    spawnExplosion(position, color) {
        this.spawn(position, 30, color, 12.0, 0.7, 0.6, {
            gravity: -6.0,
            type: 'explosion',
        });
    }

    spawnHit(position, color) {
        this.spawn(position, 10, color, 6.0, 0.4, 0.3, {
            gravity: -4.8,
            type: 'hit-impact',
        });
    }

    spawnMgImpact(position, color = null) {
        const feedback = resolveGameplayConfig(this.configSource).HUNT?.FEEDBACK?.MG_IMPACT || {};
        this.spawn(
            position,
            Math.max(1, Number(feedback.count) || 16),
            Number.isFinite(Number(color)) ? Number(color) : Number(feedback.color) || 0xffb347,
            Math.max(0.1, Number(feedback.speed) || 8.5),
            Math.max(0.05, Number(feedback.size) || 0.38),
            Math.max(0.05, Number(feedback.life) || 0.24),
            {
                gravity: Number(feedback.gravity) || -4.0,
                type: 'mg-impact',
            }
        );
    }

    spawnTrailImpact(position, color = null, { destroyed = false } = {}) {
        const feedback = resolveGameplayConfig(this.configSource).HUNT?.FEEDBACK?.TRAIL_IMPACT || {};
        const fallbackColor = destroyed ? feedback.destroyedColor : feedback.color;
        this.spawn(
            position,
            Math.max(1, Number(feedback.count) || 20),
            Number.isFinite(Number(color)) ? Number(color) : Number(fallbackColor) || 0x33a8ff,
            Math.max(0.1, Number(feedback.speed) || 7.6),
            Math.max(0.05, Number(feedback.size) || 0.44),
            Math.max(0.05, Number(feedback.life) || 0.32),
            {
                gravity: Number(feedback.gravity) || -4.8,
                type: destroyed ? 'trail-impact-destroyed' : 'trail-impact',
            }
        );
    }

    spawnShieldImpact(position, color = null, { broken = false } = {}) {
        const feedback = resolveGameplayConfig(this.configSource).HUNT?.FEEDBACK?.SHIELD_IMPACT || {};
        const fallbackColor = broken ? feedback.breakColor : feedback.color;
        this.spawn(
            position,
            Math.max(1, Number(feedback.count) || 22),
            Number.isFinite(Number(color)) ? Number(color) : Number(fallbackColor) || 0x66d9ff,
            Math.max(0.1, Number(feedback.speed) || 6.6),
            Math.max(0.05, Number(feedback.size) || 0.52),
            Math.max(0.05, Number(feedback.life) || 0.4),
            {
                gravity: Number(feedback.gravity) || -1.2,
                type: broken ? 'shield-impact-break' : 'shield-impact',
            }
        );
    }

    spawnRocketImpact(position, rocketType = '', color = null) {
        const feedback = resolveGameplayConfig(this.configSource).HUNT?.FEEDBACK?.ROCKET_IMPACT || {};
        const type = String(rocketType || '').toUpperCase();
        let fallbackColor = feedback.mediumColor;
        if (type === 'ROCKET_WEAK') fallbackColor = feedback.weakColor;
        if (type === 'ROCKET_HEAVY') fallbackColor = feedback.heavyColor;
        if (type === 'ROCKET_MEGA') fallbackColor = feedback.megaColor;

        this.spawn(
            position,
            Math.max(1, Number(feedback.count) || 42),
            Number.isFinite(Number(color)) ? Number(color) : Number(fallbackColor) || 0xff8844,
            Math.max(0.1, Number(feedback.speed) || 13.5),
            Math.max(0.05, Number(feedback.size) || 0.92),
            Math.max(0.05, Number(feedback.life) || 0.68),
            {
                gravity: Number(feedback.gravity) || -6.4,
                type: 'rocket-impact',
            }
        );
    }

    spawnTrailExplosion(points, trailColor = null) {
        const feedback = resolveGameplayConfig(this.configSource).HUNT?.FEEDBACK?.TRAIL_EXPLOSION || {};
        const countPerPoint = Math.max(1, Number(feedback.countPerSegment) || 8);
        const color = Number.isFinite(Number(trailColor)) ? Number(trailColor) : Number(feedback.color) || 0x44ccff;

        for (const point of points || []) {
            if (!point) continue;
            this.spawn(
                point,
                countPerPoint,
                color,
                Math.max(0.1, Number(feedback.speed) || 10.0),
                Math.max(0.05, Number(feedback.size) || 0.6),
                Math.max(0.05, Number(feedback.life) || 0.45),
                {
                    gravity: Number(feedback.gravity) || -5.0,
                    type: 'trail-explosion',
                }
            );
        }
    }

    update(dt) {
        if (!this.mesh) return;
        if (this.count === 0) {
            this.mesh.count = 0;
            return;
        }

        let aliveCount = 0;
        let dirtyColor = false;

        for (let i = 0; i < this.count; i++) {
            this.lifetimes[i] -= dt;

            if (this.lifetimes[i] > 0) {
                // Determine source index (i) and target index (aliveCount)
                // If i == aliveCount, just update in place.
                // If i > aliveCount, we move i to aliveCount (compaction).

                const srcIdx3 = i * 3;
                const dstIdx3 = aliveCount * 3;

                // Physics Update
                this.velocities[srcIdx3 + 1] += this.gravities[i] * dt;

                this.positions[srcIdx3] += this.velocities[srcIdx3] * dt;
                this.positions[srcIdx3 + 1] += this.velocities[srcIdx3 + 1] * dt;
                this.positions[srcIdx3 + 2] += this.velocities[srcIdx3 + 2] * dt;

                // Compaction: Move data if needed
                if (i !== aliveCount) {
                    this.positions[dstIdx3] = this.positions[srcIdx3];
                    this.positions[dstIdx3 + 1] = this.positions[srcIdx3 + 1];
                    this.positions[dstIdx3 + 2] = this.positions[srcIdx3 + 2];

                    this.velocities[dstIdx3] = this.velocities[srcIdx3];
                    this.velocities[dstIdx3 + 1] = this.velocities[srcIdx3 + 1];
                    this.velocities[dstIdx3 + 2] = this.velocities[srcIdx3 + 2];

                    this.lifetimes[aliveCount] = this.lifetimes[i];
                    this.maxLifetimes[aliveCount] = this.maxLifetimes[i];
                    this.gravities[aliveCount] = this.gravities[i];
                    this.scales[aliveCount] = this.scales[i];

                    this.colors[dstIdx3] = this.colors[srcIdx3];
                    this.colors[dstIdx3 + 1] = this.colors[srcIdx3 + 1];
                    this.colors[dstIdx3 + 2] = this.colors[srcIdx3 + 2];

                    // Update instance color at new index
                    this._tmpColor.setRGB(this.colors[dstIdx3], this.colors[dstIdx3 + 1], this.colors[dstIdx3 + 2]);
                    this.mesh.setColorAt(aliveCount, this._tmpColor);
                    dirtyColor = true;
                }

                // Render Update
                DUMMY.position.set(this.positions[dstIdx3], this.positions[dstIdx3 + 1], this.positions[dstIdx3 + 2]);

                // Rotate based on velocity direction or just spin
                DUMMY.rotation.x += this.velocities[dstIdx3 + 2] * dt;
                DUMMY.rotation.y += this.velocities[dstIdx3] * dt;

                const scale = this.scales[aliveCount] * (this.lifetimes[aliveCount] / this.maxLifetimes[aliveCount]);
                DUMMY.scale.setScalar(scale);
                DUMMY.updateMatrix();

                this.mesh.setMatrixAt(aliveCount, DUMMY.matrix);

                aliveCount++;
            }
        }

        this.count = aliveCount;
        this.mesh.count = aliveCount;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (dirtyColor && this.mesh.instanceColor) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    clear() {
        this.count = 0;
        if (this.mesh) {
            this.mesh.count = 0;
        }
    }

    dispose() {
        this.clear();
        if (this.mesh) {
            this.renderer?.removeFromScene(this.mesh);
            disposeObject3DResources(this.mesh);
            this.mesh = null;
        }
        this.renderer = null;
        this.positions = null;
        this.velocities = null;
        this.lifetimes = null;
        this.maxLifetimes = null;
        this.gravities = null;
        this.scales = null;
        this.colors = null;
        this._tmpColor = null;
        this._tmpDirection = null;
        this._tmpRight = null;
        this._tmpUp = null;
        this._tmpVelocity = null;
        this._debugEvents = [];
    }
}
