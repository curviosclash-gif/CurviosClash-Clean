import * as THREE from 'three';
import { resolveArcadeWeaponColor } from '../../../shared/contracts/ArcadeVehicleCosmeticContract.js';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const DEFAULT_MAX_SEGMENTS = 10_000;
const DEFAULT_WIDTH = 0.36;
const DEFAULT_SEGMENT_HP = 3;

function asPositiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function clearUploadedColorRanges() {
    this.clearUpdateRanges();
}

function markColorSlotUpdated(attribute, slot) {
    const start = slot * 3;
    const end = start + 3;
    const range = attribute.updateRanges[0];
    if (!range) {
        attribute.addUpdateRange(start, 3);
    } else {
        const rangeEnd = range.start + range.count;
        range.start = Math.min(range.start, start);
        range.count = Math.max(rangeEnd, end) - range.start;
    }
    attribute.needsUpdate = true;
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
        this.handlesByOwner = new Map();

        this.geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
        this.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            toneMapped: false,
        });
        this.glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
        });
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
        this.glowMesh = new THREE.InstancedMesh(this.geometry, this.glowMaterial, this.capacity);
        const initialColors = new Float32Array(this.capacity * 3).fill(1);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(initialColors, 3);
        this.glowMesh.instanceColor = new THREE.InstancedBufferAttribute(initialColors.slice(), 3);
        this.mesh.instanceColor.onUpload(clearUploadedColorRanges);
        this.glowMesh.instanceColor.onUpload(clearUploadedColorRanges);
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
        const handle = {
            id,
            kind: 'rocket-trail',
            active: true,
            ownerPlayerIndex: Number.isInteger(owner?.index) ? owner.index : -1,
            latestSequence: -1,
            nextSequence: 0,
            maxSegments: 0,
            cosmeticStyleId: 'standard',
            destroySegmentByEntry: (entry) => this.destroySegmentByEntry(entry),
        };
        if (!this.handlesByOwner.has(handle.ownerPlayerIndex)) {
            this.handlesByOwner.set(handle.ownerPlayerIndex, new Set());
        }
        this.handlesByOwner.get(handle.ownerPlayerIndex).add(handle);
        return handle;
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
        projectile.rocketTrailHandle.cosmeticStyleId = projectile.cosmeticStyleId || 'standard';
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
        if (!trailHandle?.active || !from || !to) return null;

        const dx = Number(to.x) - Number(from.x);
        const dy = Number(to.y) - Number(from.y);
        const dz = Number(to.z) - Number(from.z);
        const length = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(length) || length < 0.01) return null;

        const slot = this.writeIndex;
        const oldRef = this.segmentRefs[slot];
        const replacingActiveSegment = !!oldRef;
        if (oldRef) {
            this.getTrailSpatialIndex()?.unregisterTrailSegment?.(oldRef.key, oldRef.entry);
            // The index may have taken the key list back into its pool, and oldRef is handed
            // straight back below as the reusable ref. Dropping the key here keeps the
            // ownership with the pool instead of with a ref that no longer holds the array.
            oldRef.key = null;
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
        const trailSequence = trailHandle.nextSequence++;
        trailHandle.latestSequence = trailSequence;
        if (trailHandle.cosmeticStyleId === 'standard') {
            this._color.setHSL((segmentId * 0.083) % 1, 1, 0.58);
        } else {
            this._color.setHex(resolveArcadeWeaponColor(trailHandle.cosmeticStyleId, trailSequence, 0xffffff));
        }
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
                rocketTrailSequence: trailSequence,
            },
            oldRef
        ) || null;
        this.segmentRefs[slot] = ref;
        if (ref?.entry) {
            ref.entry.rocketTrailId = trailHandle.id;
            ref.entry.rocketTrailSequence = trailSequence;
            this.segmentSlots.set(ref.entry, slot);
        }

        this.writeIndex = (slot + 1) % this.capacity;
        if (!replacingActiveSegment) {
            this.segmentCount = Math.min(this.capacity, this.segmentCount + 1);
        }
        this.mesh.count = Math.max(this.mesh.count, slot + 1);
        this.glowMesh.count = this.mesh.count;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.glowMesh.instanceMatrix.needsUpdate = true;
        markColorSlotUpdated(this.mesh.instanceColor, slot);
        markColorSlotUpdated(this.glowMesh.instanceColor, slot);
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
        this.segmentCount = Math.max(0, this.segmentCount - 1);
        return true;
    }

    clearOwner(owner = null) {
        const ownerPlayerIndex = Number.isInteger(owner?.index) ? owner.index : Number(owner);
        if (!Number.isInteger(ownerPlayerIndex)) return 0;
        const handles = this.handlesByOwner.get(ownerPlayerIndex);
        if (handles) {
            for (const handle of handles) handle.active = false;
            this.handlesByOwner.delete(ownerPlayerIndex);
        }

        const trailSpatialIndex = this.getTrailSpatialIndex();
        let removed = 0;
        for (let slot = 0; slot < this.segmentRefs.length; slot++) {
            const ref = this.segmentRefs[slot];
            if (!ref || ref.entry?.playerIndex !== ownerPlayerIndex) continue;
            trailSpatialIndex?.unregisterTrailSegment?.(ref.key, ref.entry);
            ref.entry.destroyed = true;
            ref.entry.hp = 0;
            this.destroySegmentByEntry(ref.entry);
            removed++;
        }
        return removed;
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
        this.handlesByOwner.clear();
        this.writeIndex = 0;
        this.segmentCount = 0;
        this.mesh.count = 0;
        this.glowMesh.count = 0;
        this.mesh.instanceMatrix.clearUpdateRanges();
        this.glowMesh.instanceMatrix.clearUpdateRanges();
        this.mesh.instanceColor.clearUpdateRanges();
        this.glowMesh.instanceColor.clearUpdateRanges();
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
