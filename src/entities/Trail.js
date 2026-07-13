// ============================================
// Trail.js - Optimized 3D trail using InstancedMesh & Spatial Hashing
// ============================================

import * as THREE from 'three';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';

const UNIT_CYLINDER_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 4);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const DUMMY = new THREE.Object3D();

function getTrailSegmentHp(entityManager = null) {
    const configured = Number(resolveEntityRuntimeConfig(entityManager)?.HUNT?.TRAIL_SEGMENT_HP);
    if (!Number.isFinite(configured) || configured <= 0) {
        return 3;
    }
    return Math.max(1, Math.round(configured));
}

export class Trail {
    constructor(renderer, color, playerIndex, entityManager = null) {
        const config = resolveEntityRuntimeConfig(entityManager);
        this.renderer = renderer;
        this.color = color;
        this.playerIndex = playerIndex;
        this.entityManager = entityManager;
        this.trailSpatialIndex = entityManager
            ? (typeof entityManager.getTrailSpatialIndex === 'function' ? entityManager.getTrailSpatialIndex() : entityManager)
            : null;

        // Ring Buffer Logic
        this.maxSegments = config.TRAIL.MAX_SEGMENTS || 1400;
        this.writeIndex = 0;
        this.segmentCount = 0;
        this._dirty = false;

        // State
        this.timeSinceUpdate = 0;
        this.hasLastPosition = false;
        this.lastX = 0;
        this.lastY = 0;
        this.lastZ = 0;
        this.inGap = false;
        this.gapTimer = 0;
        this.width = config.TRAIL.WIDTH;
        this._tmpDir = new THREE.Vector3();

        // Material
        this.material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            roughness: 0.3,
            metalness: 0.6,
        });

        // InstancedMesh
        this.mesh = new THREE.InstancedMesh(UNIT_CYLINDER_GEOMETRY, this.material, this.maxSegments);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.frustumCulled = false;

        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        for (let i = 0; i < this.maxSegments; i++) {
            this.mesh.setMatrixAt(i, DUMMY.matrix);
        }

        this.renderer.addToScene(this.mesh);

        // Data Storage
        this.segmentRefs = new Array(this.maxSegments).fill(null); // Stores refs {key, entry} for global unregistration
    }

    setWidth(width) {
        this.width = width;
    }

    resetWidth() {
        this.width = resolveEntityRuntimeConfig(this.entityManager).TRAIL.WIDTH;
    }

    forceGap(duration = 0.5) {
        this.inGap = true;
        this.gapTimer = duration;
        this.hasLastPosition = false;
    }

    update(dt, position, direction) {
        const config = resolveEntityRuntimeConfig(this.entityManager);
        if (this.inGap) {
            this.gapTimer -= dt;
            if (this.gapTimer <= 0) {
                this.inGap = false;
            }
            this._setLastPosition(position);
            return;
        }

        this.timeSinceUpdate += dt;

        if (this.timeSinceUpdate >= config.TRAIL.UPDATE_INTERVAL) {
            this.timeSinceUpdate -= config.TRAIL.UPDATE_INTERVAL;

            if (Math.random() < config.TRAIL.GAP_CHANCE) {
                this.inGap = true;
                this.gapTimer = config.TRAIL.GAP_DURATION;
                this._setLastPosition(position);
                return;
            }

            if (this.hasLastPosition) {
                this._addSegment(this.lastX, this.lastY, this.lastZ, position.x, position.y, position.z);
            }
            this._setLastPosition(position);
        }

        // needsUpdate nur einmal pro Frame
        if (this._dirty) {
            this.mesh.count = Math.min(this.segmentCount, this.maxSegments);
            this.mesh.instanceMatrix.needsUpdate = true;
            this._dirty = false;
        }
    }

    _setLastPosition(position) {
        this.hasLastPosition = true;
        this.lastX = position.x;
        this.lastY = position.y;
        this.lastZ = position.z;
    }

    _addSegment(fromX, fromY, fromZ, toX, toY, toZ) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dz = toZ - fromZ;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (length < 0.01) return;
        if (typeof this.entityManager?.onArcadeGameplayEvent === 'function') {
            this.entityManager._emitArcadeGameplayEvent?.({
                type: 'trail_extend',
                playerIndex: this.playerIndex,
                delta: length,
            });
        }

        // Unregister old segment from global grid
        let reusableRef = null;
        if (this.segmentCount >= this.maxSegments) {
            const oldRef = this.segmentRefs[this.writeIndex];
            reusableRef = oldRef;
            if (oldRef && this.trailSpatialIndex) {
                this.trailSpatialIndex.unregisterTrailSegment(oldRef.key, oldRef.entry);
            }
        }

        const radius = this.width * 0.5;
        const midX = (fromX + toX) * 0.5;
        const midY = (fromY + toY) * 0.5;
        const midZ = (fromZ + toZ) * 0.5;

        // Visual
        DUMMY.position.set(midX, midY, midZ);
        this._tmpDir.set(dx / length, dy / length, dz / length);
        DUMMY.quaternion.setFromUnitVectors(UP_AXIS, this._tmpDir);
        DUMMY.scale.set(radius, length, radius);
        DUMMY.updateMatrix();
        this.mesh.setMatrixAt(this.writeIndex, DUMMY.matrix);
        this._dirty = true;

        // Register in global grid
        const segmentHp = getTrailSegmentHp(this.entityManager);
        if (this.trailSpatialIndex) {
            this.segmentRefs[this.writeIndex] = this.trailSpatialIndex.registerTrailSegment(this.playerIndex, this.writeIndex, {
                midX,
                midZ,
                fromX,
                fromY,
                fromZ,
                toX,
                toY,
                toZ,
                radius,
                hp: segmentHp,
                maxHp: segmentHp,
                ownerTrail: this,
            }, reusableRef);
        }

        this.writeIndex = (this.writeIndex + 1) % this.maxSegments;
        if (this.segmentCount < this.maxSegments) {
            this.segmentCount++;
        }
    }

    destroySegmentByEntry(entry) {
        if (!entry) return false;

        const segmentIdx = Number(entry.segmentIdx);
        if (!Number.isInteger(segmentIdx) || segmentIdx < 0 || segmentIdx >= this.maxSegments) {
            return false;
        }

        const ref = this.segmentRefs[segmentIdx];
        if (!ref || ref.entry !== entry) {
            return false;
        }

        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        this.mesh.setMatrixAt(segmentIdx, DUMMY.matrix);
        this.segmentRefs[segmentIdx] = null;
        this.mesh.instanceMatrix.needsUpdate = true;
        this._dirty = true;
        return true;
    }

    clear() {
        DUMMY.scale.set(0, 0, 0);
        DUMMY.updateMatrix();
        for (let i = 0; i < this.maxSegments; i++) {
            if (this.segmentRefs[i] && this.trailSpatialIndex) {
                this.trailSpatialIndex.unregisterTrailSegment(this.segmentRefs[i].key, this.segmentRefs[i].entry);
            }
            this.mesh.setMatrixAt(i, DUMMY.matrix);
            this.segmentRefs[i] = null;
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.count = 0;

        this.writeIndex = 0;
        this.segmentCount = 0;
        this.hasLastPosition = false;
        this.timeSinceUpdate = 0;
        this.inGap = false;
    }

    dispose() {
        this.renderer.removeFromScene(this.mesh);
        this.mesh.dispose();
        this.material.dispose();
    }
}
