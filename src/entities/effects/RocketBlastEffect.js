import * as THREE from 'three';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

const MAX_ROCKET_BLASTS = 32;
const DUMMY = new THREE.Object3D();

export class RocketBlastEffect {
    constructor(renderer, { modernGraphics = true } = {}) {
        this.renderer = renderer;
        this.count = 0;
        this.positions = new Float32Array(MAX_ROCKET_BLASTS * 3);
        this.lifetimes = new Float32Array(MAX_ROCKET_BLASTS);
        this.maxLifetimes = new Float32Array(MAX_ROCKET_BLASTS);
        this.radii = new Float32Array(MAX_ROCKET_BLASTS);
        this.colors = new Float32Array(MAX_ROCKET_BLASTS * 3);
        this._tmpColor = new THREE.Color();
        this._coreTint = new THREE.Color(0xffffcc);

        this.coreMesh = this._createMesh(
            new THREE.IcosahedronGeometry(1, 2),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: modernGraphics ? 0.82 : 0.72,
                blending: modernGraphics ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: false,
                toneMapped: false,
            })
        );
        this.waveMesh = this._createMesh(
            new THREE.IcosahedronGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: modernGraphics ? 0.34 : 0.28,
                blending: modernGraphics ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: false,
                toneMapped: false,
                wireframe: true,
            })
        );
    }

    _createMesh(geometry, material) {
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_ROCKET_BLASTS);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        this.renderer?.addToScene?.(mesh);
        return mesh;
    }

    spawn(position, rocketType, color) {
        if (!position || !this.coreMesh || !this.waveMesh) return;

        let radius = 3.1;
        let lifetime = 0.56;
        if (rocketType === 'ROCKET_WEAK') {
            radius = 2.6;
            lifetime = 0.48;
        } else if (rocketType === 'ROCKET_HEAVY') {
            radius = 3.8;
            lifetime = 0.64;
        } else if (rocketType === 'ROCKET_MEGA') {
            radius = 4.8;
            lifetime = 0.72;
        }

        let index = this.count;
        if (this.count < MAX_ROCKET_BLASTS) {
            this.count++;
        } else {
            index = 0;
            for (let i = 1; i < this.count; i++) {
                if (this.lifetimes[i] < this.lifetimes[index]) index = i;
            }
        }
        const index3 = index * 3;
        this.positions[index3] = position.x;
        this.positions[index3 + 1] = position.y;
        this.positions[index3 + 2] = position.z;
        this.lifetimes[index] = lifetime;
        this.maxLifetimes[index] = lifetime;
        this.radii[index] = radius;

        this._tmpColor.setHex(color);
        this.colors[index3] = this._tmpColor.r;
        this.colors[index3 + 1] = this._tmpColor.g;
        this.colors[index3 + 2] = this._tmpColor.b;
        this.waveMesh.setColorAt(index, this._tmpColor);
        this._tmpColor.lerp(this._coreTint, 0.72);
        this.coreMesh.setColorAt(index, this._tmpColor);

        this._writeMatrices(index, 0);
        this.coreMesh.count = this.count;
        this.waveMesh.count = this.count;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.waveMesh.instanceMatrix.needsUpdate = true;
        if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
        if (this.waveMesh.instanceColor) this.waveMesh.instanceColor.needsUpdate = true;
    }

    _writeMatrices(index, progress) {
        const index3 = index * 3;
        const radius = this.radii[index];
        const easedProgress = 1 - ((1 - progress) ** 3);
        const corePulse = Math.sin(Math.PI * progress);
        const coreScale = radius * (0.12 + corePulse * 0.88) * (1 - progress * 0.35);
        const waveScale = radius * (0.2 + easedProgress * 1.35);

        DUMMY.position.set(this.positions[index3], this.positions[index3 + 1], this.positions[index3 + 2]);
        DUMMY.rotation.set(0, 0, 0);
        DUMMY.scale.setScalar(coreScale);
        DUMMY.updateMatrix();
        this.coreMesh.setMatrixAt(index, DUMMY.matrix);

        DUMMY.scale.setScalar(waveScale);
        DUMMY.updateMatrix();
        this.waveMesh.setMatrixAt(index, DUMMY.matrix);
    }

    update(dt) {
        if (!this.coreMesh || !this.waveMesh) return;
        let aliveCount = 0;
        let dirtyColor = false;
        for (let i = 0; i < this.count; i++) {
            const remaining = this.lifetimes[i] - dt;
            if (remaining <= 0) continue;

            if (i !== aliveCount) {
                this._compact(i, aliveCount, remaining);
                dirtyColor = true;
            } else {
                this.lifetimes[aliveCount] = remaining;
            }

            const progress = 1 - (this.lifetimes[aliveCount] / this.maxLifetimes[aliveCount]);
            this._writeMatrices(aliveCount, progress);
            aliveCount++;
        }

        this.count = aliveCount;
        this.coreMesh.count = aliveCount;
        this.waveMesh.count = aliveCount;
        this.coreMesh.instanceMatrix.needsUpdate = true;
        this.waveMesh.instanceMatrix.needsUpdate = true;
        if (dirtyColor) {
            if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
            if (this.waveMesh.instanceColor) this.waveMesh.instanceColor.needsUpdate = true;
        }
    }

    _compact(source, target, remaining) {
        const source3 = source * 3;
        const target3 = target * 3;
        this.positions[target3] = this.positions[source3];
        this.positions[target3 + 1] = this.positions[source3 + 1];
        this.positions[target3 + 2] = this.positions[source3 + 2];
        this.lifetimes[target] = remaining;
        this.maxLifetimes[target] = this.maxLifetimes[source];
        this.radii[target] = this.radii[source];
        this.colors[target3] = this.colors[source3];
        this.colors[target3 + 1] = this.colors[source3 + 1];
        this.colors[target3 + 2] = this.colors[source3 + 2];

        this._tmpColor.setRGB(this.colors[target3], this.colors[target3 + 1], this.colors[target3 + 2]);
        this.waveMesh.setColorAt(target, this._tmpColor);
        this._tmpColor.lerp(this._coreTint, 0.72);
        this.coreMesh.setColorAt(target, this._tmpColor);
    }

    clear() {
        this.count = 0;
        if (this.coreMesh) this.coreMesh.count = 0;
        if (this.waveMesh) this.waveMesh.count = 0;
    }

    dispose() {
        this.clear();
        if (this.coreMesh) {
            this.renderer?.removeFromScene?.(this.coreMesh);
            disposeObject3DResources(this.coreMesh);
            this.coreMesh = null;
        }
        if (this.waveMesh) {
            this.renderer?.removeFromScene?.(this.waveMesh);
            disposeObject3DResources(this.waveMesh);
            this.waveMesh = null;
        }
        this.renderer = null;
    }
}
