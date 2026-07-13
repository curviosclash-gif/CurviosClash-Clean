import * as THREE from 'three';

const MG_TRACER_UP_AXIS = new THREE.Vector3(0, 1, 0);
const MG_TRACER_UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 8);
const MG_TRACER_UNIT_SPHERE = new THREE.SphereGeometry(1, 10, 10);
const MG_TRACER_DEFAULT_BEAM_RADIUS = 0.16;
const MG_TRACER_DEFAULT_BULLET_RADIUS = 0.42;
const MG_TRACER_MAX_POOL_SIZE = 96;

import { clamp } from '../../utils/MathOps.js';

export class MGTracerFx {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this.tracers = [];
        this._pool = [];
        this._maxPoolSize = MG_TRACER_MAX_POOL_SIZE;
        this._tmpTracerDir = new THREE.Vector3();
        this._tmpTracerMid = new THREE.Vector3();
    }

    _createTracerEntry() {
        const beamMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
        });
        const bulletMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.96,
            depthWrite: false,
        });

        const mesh = new THREE.Group();
        mesh.renderOrder = 210;
        const beam = new THREE.Mesh(MG_TRACER_UNIT_CYLINDER, beamMaterial);
        const bullet = new THREE.Mesh(MG_TRACER_UNIT_SPHERE, bulletMaterial);
        mesh.add(beam);
        mesh.add(bullet);

        return {
            mesh,
            beam,
            bullet,
            beamMaterial,
            bulletMaterial,
            materials: [beamMaterial, bulletMaterial],
            ttl: 0,
            maxTtl: 0,
        };
    }

    _acquireTracerEntry() {
        if (this._pool.length > 0) {
            return this._pool.pop();
        }
        return this._createTracerEntry();
    }

    _releaseTracerEntry(entry) {
        if (!entry) return;
        entry.ttl = 0;
        entry.maxTtl = 0;
        if (entry.mesh?.parent) {
            entry.mesh.parent.remove(entry.mesh);
        }
        if (this._pool.length < this._maxPoolSize) {
            this._pool.push(entry);
            return;
        }

        if (Array.isArray(entry.materials)) {
            for (const material of entry.materials) {
                material?.dispose?.();
            }
        }
    }

    spawnTracer(start, end, hit = false, mg = null) {
        const renderer = this.entityManager?.renderer;
        if (!renderer?.addToScene) return;

        this._tmpTracerDir.subVectors(end, start);
        const length = this._tmpTracerDir.length();
        if (!Number.isFinite(length) || length <= 0.001) return;
        this._tmpTracerDir.divideScalar(length);

        const beamRadius = Math.max(0.02, Number(mg?.TRACER_BEAM_RADIUS) || MG_TRACER_DEFAULT_BEAM_RADIUS);
        const bulletRadius = Math.max(0.04, Number(mg?.TRACER_BULLET_RADIUS) || MG_TRACER_DEFAULT_BULLET_RADIUS);
        const tracerColor = hit ? 0xffe38a : 0x8ad5ff;
        const tracerEntry = this._acquireTracerEntry();
        const tracerRoot = tracerEntry.mesh;
        tracerRoot.quaternion.setFromUnitVectors(MG_TRACER_UP_AXIS, this._tmpTracerDir);
        this._tmpTracerMid.addVectors(start, end).multiplyScalar(0.5);
        tracerRoot.position.copy(this._tmpTracerMid);
        tracerEntry.beam.scale.set(beamRadius, length, beamRadius);
        tracerEntry.bullet.position.y = length * 0.5;
        tracerEntry.bullet.scale.setScalar(bulletRadius);
        tracerEntry.beamMaterial.color.setHex(tracerColor);
        tracerEntry.bulletMaterial.color.setHex(tracerColor);
        tracerEntry.beamMaterial.opacity = 0.92;
        tracerEntry.bulletMaterial.opacity = 0.96;

        renderer.addToScene(tracerRoot);

        const maxTtl = hit ? 0.11 : 0.08;
        tracerEntry.ttl = maxTtl;
        tracerEntry.maxTtl = maxTtl;
        this.tracers.push(tracerEntry);
    }

    update(dt) {
        if (!Array.isArray(this.tracers) || this.tracers.length === 0) return;
        const renderer = this.entityManager?.renderer;
        let writeIdx = 0;
        for (let i = 0; i < this.tracers.length; i++) {
            const tracer = this.tracers[i];
            if (!tracer?.mesh) continue;
            tracer.ttl -= Math.max(0, dt);
            const fade = clamp(tracer.ttl / Math.max(0.001, tracer.maxTtl), 0, 1);
            if (Array.isArray(tracer.materials)) {
                if (tracer.beamMaterial) tracer.beamMaterial.opacity = fade * 0.92;
                if (tracer.bulletMaterial) tracer.bulletMaterial.opacity = fade * 0.96;
            } else if (tracer.mesh.material) {
                tracer.mesh.material.opacity = fade * 0.92;
            }
            if (tracer.ttl > 0) {
                this.tracers[writeIdx++] = tracer;
                continue;
            }

            if (renderer?.removeFromScene) {
                renderer.removeFromScene(tracer.mesh);
            } else if (tracer.mesh.parent) {
                tracer.mesh.parent.remove(tracer.mesh);
            }
            this._releaseTracerEntry(tracer);
        }
        this.tracers.length = writeIdx;
    }

    clear() {
        if (!Array.isArray(this.tracers) || this.tracers.length === 0) return;
        const renderer = this.entityManager?.renderer;
        for (const tracer of this.tracers) {
            const mesh = tracer?.mesh;
            if (!mesh) continue;
            if (renderer?.removeFromScene) {
                renderer.removeFromScene(mesh);
            } else if (mesh.parent) {
                mesh.parent.remove(mesh);
            }
            this._releaseTracerEntry(tracer);
        }
        this.tracers.length = 0;
    }
}
