import * as THREE from 'three';

import { clamp } from '../../shared/utils/MathOps.js';

const MG_TRACER_UP_AXIS = new THREE.Vector3(0, 1, 0);
const MG_TRACER_WHITE = new THREE.Color(0xffffff);
const MG_TRACER_UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 8);
const MG_TRACER_UNIT_SPHERE = new THREE.SphereGeometry(1, 10, 10);
const MG_TRACER_DEFAULT_BEAM_RADIUS = 0.16;
const MG_TRACER_DEFAULT_BULLET_RADIUS = 0.42;
const MG_TRACER_DEFAULT_DURATION_SECONDS = 0.09;
const MG_TRACER_MAX_SEGMENTS = 3;
const MG_TRACER_MAX_POOL_SIZE = 96;

function normalizeTracerStyle(value) {
    switch (value) {
        case 'pulse-train':
        case 'heavy-slug':
        case 'precision-needle':
            return value;
        default:
            return 'bolt';
    }
}

export class MGTracerFx {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this.tracers = [];
        this._pool = [];
        this._maxPoolSize = MG_TRACER_MAX_POOL_SIZE;
        this._tmpTracerDir = new THREE.Vector3();
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
        const muzzleMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const impactMaterial = muzzleMaterial.clone();

        const mesh = new THREE.Group();
        mesh.renderOrder = 210;
        const beamSegments = [];
        for (let i = 0; i < MG_TRACER_MAX_SEGMENTS; i += 1) {
            const beamSegment = new THREE.Mesh(MG_TRACER_UNIT_CYLINDER, beamMaterial);
            beamSegment.visible = false;
            beamSegments.push(beamSegment);
            mesh.add(beamSegment);
        }
        const bullet = new THREE.Mesh(MG_TRACER_UNIT_SPHERE, bulletMaterial);
        const muzzle = new THREE.Mesh(MG_TRACER_UNIT_SPHERE, muzzleMaterial);
        const impact = new THREE.Mesh(MG_TRACER_UNIT_SPHERE, impactMaterial);
        mesh.add(bullet);
        mesh.add(muzzle);
        mesh.add(impact);

        return {
            mesh,
            beam: beamSegments[0],
            beamSegments,
            bullet,
            muzzle,
            impact,
            beamMaterial,
            bulletMaterial,
            muzzleMaterial,
            impactMaterial,
            materials: [beamMaterial, bulletMaterial, muzzleMaterial, impactMaterial],
            ttl: 0,
            maxTtl: 0,
            elapsed: 0,
            length: 0,
            beamRadius: MG_TRACER_DEFAULT_BEAM_RADIUS,
            bulletRadius: MG_TRACER_DEFAULT_BULLET_RADIUS,
            streakFraction: 0.34,
            segmentCount: 1,
            muzzleScale: 1,
            arrivalFraction: 0.72,
            hit: false,
            style: 'bolt',
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
        entry.elapsed = 0;
        entry.hit = false;
        entry.bullet.visible = false;
        entry.muzzle.visible = false;
        entry.impact.visible = false;
        for (const segment of entry.beamSegments) segment.visible = false;
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

    _placeBeamSegment(segment, from, to, radius) {
        const segmentLength = Math.max(0, to - from);
        segment.visible = segmentLength > 0.001;
        if (!segment.visible) return;
        segment.position.y = from + segmentLength * 0.5;
        segment.scale.set(radius, segmentLength, radius);
    }

    _applyTracerFrame(entry) {
        const progress = clamp(entry.elapsed / Math.max(0.001, entry.maxTtl), 0, 1);
        const fade = 1 - progress;
        const needle = entry.style === 'precision-needle';
        const pulseTrain = entry.style === 'pulse-train';
        const heavy = entry.style === 'heavy-slug';
        const travelProgress = needle
            ? Math.min(1, progress * 4)
            : Math.min(1, 0.08 + progress * 1.28);
        const head = entry.length * travelProgress;
        const streakLength = needle
            ? head
            : Math.min(head, Math.max(0.8, entry.length * entry.streakFraction));
        const tail = Math.max(0, head - streakLength);

        for (const segment of entry.beamSegments) segment.visible = false;
        if (pulseTrain) {
            const dashLength = streakLength / Math.max(1, entry.segmentCount * 1.65);
            const dashStep = dashLength * 1.65;
            for (let i = 0; i < entry.segmentCount; i += 1) {
                const dashEnd = head - i * dashStep;
                const dashStart = Math.max(tail, dashEnd - dashLength);
                if (dashEnd <= tail) break;
                this._placeBeamSegment(entry.beamSegments[i], dashStart, dashEnd, entry.beamRadius);
            }
        } else {
            this._placeBeamSegment(entry.beamSegments[0], tail, head, entry.beamRadius);
        }

        entry.bullet.visible = head > 0.001;
        entry.bullet.position.y = head;
        const bulletPulse = heavy ? 1 + Math.sin(progress * Math.PI * 4) * 0.12 : 1;
        entry.bullet.scale.setScalar(entry.bulletRadius * bulletPulse);
        entry.beamMaterial.opacity = fade * (needle ? 0.82 : 0.92);
        entry.bulletMaterial.opacity = fade * (heavy ? 1 : 0.96);

        const muzzleLifetime = heavy ? 0.52 : (pulseTrain ? 0.32 : 0.24);
        const muzzleProgress = progress / muzzleLifetime;
        entry.muzzle.visible = muzzleProgress < 1;
        if (entry.muzzle.visible) {
            const muzzleRadius = entry.bulletRadius
                * entry.muzzleScale
                * (0.55 + muzzleProgress * (heavy ? 1.75 : 1.1));
            entry.muzzle.scale.setScalar(muzzleRadius);
            entry.muzzleMaterial.opacity = (1 - muzzleProgress) * (heavy ? 0.95 : 0.72);
        }

        const impactProgress = (progress - entry.arrivalFraction) / Math.max(0.001, 1 - entry.arrivalFraction);
        entry.impact.visible = entry.hit && impactProgress >= 0 && impactProgress < 1;
        if (entry.impact.visible) {
            entry.impact.position.y = entry.length;
            entry.impact.scale.setScalar(entry.bulletRadius * (0.7 + impactProgress * (heavy ? 2.8 : 1.8)));
            entry.impactMaterial.opacity = (1 - impactProgress) * (heavy ? 1 : 0.82);
        }
    }

    spawnTracer(start, end, hit = false, mg = null, colorOverride = null) {
        const renderer = this.entityManager?.renderer;
        if (!renderer?.addToScene) return;

        this._tmpTracerDir.subVectors(end, start);
        const length = this._tmpTracerDir.length();
        if (!Number.isFinite(length) || length <= 0.001) return;
        this._tmpTracerDir.divideScalar(length);

        const beamRadius = Math.max(0.02, Number(mg?.TRACER_BEAM_RADIUS) || MG_TRACER_DEFAULT_BEAM_RADIUS);
        const bulletRadius = Math.max(0.04, Number(mg?.TRACER_BULLET_RADIUS) || MG_TRACER_DEFAULT_BULLET_RADIUS);
        const tracerColor = colorOverride !== null && colorOverride !== undefined && Number.isFinite(Number(colorOverride))
            ? Number(colorOverride)
            : (Number(mg?.TRACER_COLOR) || 0x8ad5ff);
        const tracerEntry = this._acquireTracerEntry();
        const tracerRoot = tracerEntry.mesh;
        tracerRoot.quaternion.setFromUnitVectors(MG_TRACER_UP_AXIS, this._tmpTracerDir);
        tracerRoot.position.copy(start);
        tracerEntry.beamMaterial.color.setHex(tracerColor);
        tracerEntry.bulletMaterial.color.setHex(tracerColor);
        tracerEntry.muzzleMaterial.color.setHex(tracerColor);
        tracerEntry.impactMaterial.color.setHex(tracerColor).lerp(MG_TRACER_WHITE, 0.45);

        tracerEntry.style = normalizeTracerStyle(mg?.TRACER_STYLE);
        tracerEntry.length = length;
        tracerEntry.beamRadius = beamRadius;
        tracerEntry.bulletRadius = bulletRadius;
        tracerEntry.streakFraction = clamp(Number(mg?.TRACER_STREAK_FRACTION) || 0.34, 0.05, 1);
        tracerEntry.segmentCount = Math.min(
            MG_TRACER_MAX_SEGMENTS,
            Math.max(1, Math.round(Number(mg?.TRACER_SEGMENT_COUNT) || 1))
        );
        tracerEntry.muzzleScale = Math.max(0.2, Number(mg?.TRACER_MUZZLE_SCALE) || 1);
        tracerEntry.arrivalFraction = tracerEntry.style === 'precision-needle' ? 0.25 : 0.72;
        tracerEntry.hit = hit === true;
        tracerEntry.elapsed = 0;

        renderer.addToScene(tracerRoot);

        const maxTtl = clamp(
            Number(mg?.TRACER_DURATION_SECONDS) || MG_TRACER_DEFAULT_DURATION_SECONDS,
            0.04,
            0.25
        ) + (hit ? 0.02 : 0);
        tracerEntry.ttl = maxTtl;
        tracerEntry.maxTtl = maxTtl;
        this._applyTracerFrame(tracerEntry);
        this.tracers.push(tracerEntry);
    }

    update(dt) {
        if (!Array.isArray(this.tracers) || this.tracers.length === 0) return;
        const renderer = this.entityManager?.renderer;
        let writeIdx = 0;
        for (let i = 0; i < this.tracers.length; i++) {
            const tracer = this.tracers[i];
            if (!tracer?.mesh) continue;
            const frameDt = Math.max(0, dt);
            tracer.elapsed += frameDt;
            tracer.ttl -= frameDt;
            if (tracer.ttl > 0) {
                this._applyTracerFrame(tracer);
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
