import * as THREE from 'three';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_MAX_SEGMENTS = 2048;
const DEFAULT_WIDTH = 0.36;
const DEFAULT_SEGMENT_HP = 3;

function asPositiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export class RocketTrailSystem {
    static forProjectileSystem(system) {
        return new RocketTrailSystem({
            renderer: system.renderer,
            getTrailSpatialIndex: system.getTrailSpatialIndex,
            width: Math.max(0.2, Number(system.entityRuntimeConfig?.TRAIL?.WIDTH) || 0.6) * 0.7,
            segmentHp: system.entityRuntimeConfig?.HUNT?.TRAIL_SEGMENT_HP,
        });
    }

    constructor(options = {}) {
        this.renderer = options.renderer || null;
        this.getTrailSpatialIndex = typeof options.getTrailSpatialIndex === 'function'
            ? options.getTrailSpatialIndex
            : (() => options.trailSpatialIndex || null);
        this.capacity = Math.max(1, Math.floor(asPositiveNumber(options.maxSegments, DEFAULT_MAX_SEGMENTS)));
        this.width = asPositiveNumber(options.width, DEFAULT_WIDTH);
        this.segmentHp = Math.max(1, Math.round(asPositiveNumber(options.segmentHp, DEFAULT_SEGMENT_HP)));
        this.writeIndex = 0;
        this.segmentCount = 0;
        this.nextSegmentId = 1_000_000;
        this.nextTrailId = 1;
        this.segmentRefs = new Array(this.capacity).fill(null);
        this.segmentSlots = new Map();

        this.geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
        this.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            toneMapped: false,
        });
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
        });
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
        this.glowMesh = new THREE.InstancedMesh(this.geometry, this.glowMaterial, this.capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.glowMesh.frustumCulled = false;
        this.mesh.count = 0;
        this.glowMesh.count = 0;
        this.mesh.userData = {
            ...(this.mesh.userData || {}),
            entityViewType: 'rocket-rainbow-trail',
            collisionEnabled: true,
        };
        this.glowMesh.userData = {
            ...(this.glowMesh.userData || {}),
            entityViewType: 'rocket-rainbow-trail-glow',
            collisionEnabled: false,
        };

        this._dummy = new THREE.Object3D();
        this._direction = new THREE.Vector3();
        this._color = new THREE.Color();
        this._attached = false;
    }

    createTrailHandle(owner = null) {
        this._attach();
        const id = `rocket-trail:${this.nextTrailId++}`;
        return {
            id,
            ownerPlayerIndex: Number.isInteger(owner?.index) ? owner.index : -1,
            maxSegments: 0,
            destroySegmentByEntry: (entry) => this.destroySegmentByEntry(entry),
        };
    }

    _attach() {
        if (this._attached) return;
        this.renderer?.addToScene?.(this.mesh);
        this.renderer?.addToScene?.(this.glowMesh);
        this._attached = true;
    }

    initializeProjectile(projectile) {
        if (!projectile?.huntRocket) return;
        projectile.rocketTrailHandle = this.createTrailHandle(projectile.owner);
        this.resetProjectileSample(projectile);
    }

    resetProjectileSample(projectile) {
        if (!projectile?.rocketTrailHandle) return;
        projectile.rocketTrailAccumulator = 0;
        projectile.rocketTrailLastPosition.copy(projectile.position);
    }

    updateProjectile(projectile, dt, updateInterval, force = false) {
        if (!projectile?.huntRocket || !projectile.rocketTrailHandle) return;
        const interval = Math.max(0.02, Number(updateInterval) || 0.07);
        projectile.rocketTrailAccumulator += Math.max(0, Number(dt) || 0);
        if (!force && projectile.rocketTrailAccumulator < interval) return;
        this.appendSegment(
            projectile.rocketTrailHandle,
            projectile.rocketTrailLastPosition,
            projectile.position
        );
        projectile.rocketTrailLastPosition.copy(projectile.position);
        projectile.rocketTrailAccumulator = force ? 0 : projectile.rocketTrailAccumulator % interval;
    }

    appendSegment(trailHandle, from, to) {
        if (!trailHandle || !from || !to) return null;

        const dx = Number(to.x) - Number(from.x);
        const dy = Number(to.y) - Number(from.y);
        const dz = Number(to.z) - Number(from.z);
        const length = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(length) || length < 0.01) return null;

        const slot = this.writeIndex;
        const oldRef = this.segmentRefs[slot];
        if (oldRef) {
            this.getTrailSpatialIndex()?.unregisterTrailSegment?.(oldRef.key, oldRef.entry);
            this.segmentSlots.delete(oldRef.entry);
        }

        const radius = this.width * 0.5;
        this._dummy.position.set(
            Number(from.x) + dx * 0.5,
            Number(from.y) + dy * 0.5,
            Number(from.z) + dz * 0.5
        );
        this._direction.set(dx / length, dy / length, dz / length);
        this._dummy.quaternion.setFromUnitVectors(UP_AXIS, this._direction);
        this._dummy.scale.set(radius, length, radius);
        this._dummy.updateMatrix();
        this.mesh.setMatrixAt(slot, this._dummy.matrix);
        this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);

        this._dummy.scale.set(radius * 2.2, length * 1.01, radius * 2.2);
        this._dummy.updateMatrix();
        this.glowMesh.setMatrixAt(slot, this._dummy.matrix);
        this.glowMesh.instanceMatrix.addUpdateRange(slot * 16, 16);

        const segmentId = this.nextSegmentId++;
        this._color.setHSL((segmentId * 0.083) % 1, 1, 0.58);
        this.mesh.setColorAt(slot, this._color);
        this.glowMesh.setColorAt(slot, this._color);

        const trailSpatialIndex = this.getTrailSpatialIndex();
        const ref = trailSpatialIndex?.registerTrailSegment?.(
            trailHandle.ownerPlayerIndex,
            segmentId,
            {
                midX: Number(from.x) + dx * 0.5,
                midZ: Number(from.z) + dz * 0.5,
                fromX: Number(from.x),
                fromY: Number(from.y),
                fromZ: Number(from.z),
                toX: Number(to.x),
                toY: Number(to.y),
                toZ: Number(to.z),
                radius,
                hp: this.segmentHp,
                maxHp: this.segmentHp,
                ownerTrail: trailHandle,
                rocketTrailId: trailHandle.id,
            },
            oldRef
        ) || null;
        this.segmentRefs[slot] = ref;
        if (ref?.entry) {
            ref.entry.rocketTrailId = trailHandle.id;
            this.segmentSlots.set(ref.entry, slot);
        }

        this.writeIndex = (slot + 1) % this.capacity;
        this.segmentCount = Math.min(this.capacity, this.segmentCount + 1);
        this.mesh.count = Math.max(this.mesh.count, slot + 1);
        this.glowMesh.count = this.mesh.count;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.glowMesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
        return ref?.entry || null;
    }

    destroySegmentByEntry(entry) {
        const slot = this.segmentSlots.get(entry);
        if (!Number.isInteger(slot)) return false;

        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.mesh.setMatrixAt(slot, this._dummy.matrix);
        this.glowMesh.setMatrixAt(slot, this._dummy.matrix);
        this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
        this.glowMesh.instanceMatrix.addUpdateRange(slot * 16, 16);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.glowMesh.instanceMatrix.needsUpdate = true;
        this.segmentRefs[slot] = null;
        this.segmentSlots.delete(entry);
        return true;
    }

    clear() {
        const trailSpatialIndex = this.getTrailSpatialIndex();
        for (let i = 0; i < this.segmentRefs.length; i++) {
            const ref = this.segmentRefs[i];
            if (ref) {
                trailSpatialIndex?.unregisterTrailSegment?.(ref.key, ref.entry);
                this.segmentRefs[i] = null;
            }
        }
        this.segmentSlots.clear();
        this.writeIndex = 0;
        this.segmentCount = 0;
        this.mesh.count = 0;
        this.glowMesh.count = 0;
        this.mesh.instanceMatrix.clearUpdateRanges();
        this.glowMesh.instanceMatrix.clearUpdateRanges();
    }

    dispose() {
        this.clear();
        if (this._attached) {
            this.renderer?.removeFromScene?.(this.mesh);
            this.renderer?.removeFromScene?.(this.glowMesh);
            this._attached = false;
        }
        this.mesh.dispose();
        this.glowMesh.dispose();
        this.geometry.dispose();
        this.material.dispose();
        this.glowMaterial.dispose();
    }
}
