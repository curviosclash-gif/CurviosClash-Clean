import * as THREE from 'three';

/**
 * The railgun beam: a thin bright rod from the muzzle to where the beam ended, fading within
 * FADE_SECONDS. A line would be one pixel wide on most GPUs, so the rod is a stretched cylinder.
 * A small pool is built once and reused; a new shot takes the oldest rod.
 */

const POOL_SIZE = 4;
const FADE_SECONDS = 0.35;
const BEAM_COLOR = 0x7fe7ff;
const BEAM_RADIUS = 0.18;

export class RailgunBeamEffect {
    constructor(renderer) {
        this.renderer = renderer || null;
        this._geometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, 1, 6, 1, true);
        // Lay the cylinder along +Z so lookAt points it at the end of the beam.
        this._geometry.rotateX(Math.PI / 2);
        this._beams = Array.from({ length: POOL_SIZE }, () => {
            const material = new THREE.MeshBasicMaterial({
                color: BEAM_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const mesh = new THREE.Mesh(this._geometry, material);
            mesh.frustumCulled = false;
            mesh.visible = false;
            this.renderer?.addToScene?.(mesh);
            return { mesh, remaining: 0 };
        });
        this._next = 0;
        this._end = new THREE.Vector3();
    }

    show(from, to) {
        if (!Array.isArray(from) || !Array.isArray(to)) return;
        const beam = this._beams[this._next];
        this._next = (this._next + 1) % this._beams.length;
        const [fx, fy, fz] = from;
        this._end.set(to[0], to[1], to[2]);
        const length = Math.hypot(to[0] - fx, to[1] - fy, to[2] - fz);
        if (!(length > 0.001)) return;
        beam.mesh.position.set((fx + to[0]) / 2, (fy + to[1]) / 2, (fz + to[2]) / 2);
        beam.mesh.lookAt(this._end);
        beam.mesh.scale.set(1, 1, length);
        beam.mesh.material.opacity = 1;
        beam.mesh.visible = true;
        beam.remaining = FADE_SECONDS;
    }

    update(dt) {
        const safeDt = Math.max(0, Number(dt) || 0);
        for (const beam of this._beams) {
            if (beam.remaining <= 0) continue;
            beam.remaining = Math.max(0, beam.remaining - safeDt);
            beam.mesh.material.opacity = beam.remaining / FADE_SECONDS;
            if (beam.remaining <= 0) beam.mesh.visible = false;
        }
    }

    dispose() {
        for (const beam of this._beams) {
            this.renderer?.removeFromScene?.(beam.mesh);
            beam.mesh.material.dispose();
        }
        this._geometry.dispose();
    }
}
