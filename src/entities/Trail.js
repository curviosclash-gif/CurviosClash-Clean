// ============================================
// Trail.js - Optimized 3D trail using InstancedMesh & Spatial Hashing
// ============================================

import * as THREE from 'three';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { isModernGraphicsStyle } from '../shared/contracts/GraphicsStyleContract.js';

const TRAIL_SEGMENT_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
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
        this.modernGraphics = isModernGraphicsStyle(renderer?.getGraphicsStyle?.());
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
        this.lastVisualX = 0;
        this.lastVisualY = 0;
        this.lastVisualZ = 0;
        this._sampleVisualX = 0;
        this._sampleVisualY = 0;
        this._sampleVisualZ = 0;
        this._previousStepVisualX = 0;
        this._previousStepVisualY = 0;
        this._previousStepVisualZ = 0;
        this._hasPreviousStepVisual = false;
        this.visualRearOffset = 0;
        this.inGap = false;
        this.gapTimer = 0;
        this.width = config.TRAIL.WIDTH;
        this._tmpDir = new THREE.Vector3();

        // Material
        this.material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: this.modernGraphics ? 1.15 : 0.48,
            roughness: this.modernGraphics ? 0.34 : 0.5,
            metalness: this.modernGraphics ? 0.28 : 0.2,
        });
        this.glowMaterial = this.modernGraphics
            ? new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.16,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide,
            })
            : null;

        // InstancedMesh
        this.mesh = new THREE.InstancedMesh(TRAIL_SEGMENT_GEOMETRY, this.material, this.maxSegments);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.glowMesh = this.glowMaterial
            ? new THREE.InstancedMesh(TRAIL_SEGMENT_GEOMETRY, this.glowMaterial, this.maxSegments)
            : null;
        if (this.glowMesh) {
            this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.glowMesh.castShadow = false;
            this.glowMesh.receiveShadow = false;
            this.glowMesh.frustumCulled = false;
            this.glowMesh.count = 0;
            this.glowMesh.onBeforeRender = (activeRenderer) => {
                this.glowMaterial.colorWrite = activeRenderer.getRenderTarget() === null;
            };
        }

        // Render-only head segment. The collision trail keeps its existing
        // sampling interval while this one mesh follows the interpolated pose.
        this.headMesh = new THREE.Mesh(TRAIL_SEGMENT_GEOMETRY, this.material);
        this.headMesh.castShadow = false;
        this.headMesh.receiveShadow = false;
        this.headMesh.frustumCulled = false;
        this.headMesh.visible = false;
        this.glowHeadMesh = this.glowMaterial
            ? new THREE.Mesh(TRAIL_SEGMENT_GEOMETRY, this.glowMaterial)
            : null;
        if (this.glowHeadMesh) {
            this.glowHeadMesh.castShadow = false;
            this.glowHeadMesh.receiveShadow = false;
            this.glowHeadMesh.frustumCulled = false;
            this.glowHeadMesh.visible = false;
            this.glowHeadMesh.onBeforeRender = this.glowMesh.onBeforeRender;
        }
        this.headMesh.userData = {
            ...(this.headMesh.userData || {}),
            entityViewType: 'trail-visual-head',
            collisionEnabled: false,
        };

        this.renderer.addToScene(this.mesh);
        if (this.glowMesh) this.renderer.addToScene(this.glowMesh);
        this.renderer.addToScene(this.headMesh);
        if (this.glowHeadMesh) this.renderer.addToScene(this.glowHeadMesh);

        // Data Storage
        this.segmentRefs = new Array(this.maxSegments).fill(null); // Stores refs {key, entry} for global unregistration
    }

    setWidth(width) {
        this.width = width;
    }

    setVisualRearOffset(offset) {
        const numericOffset = Number(offset);
        this.visualRearOffset = Number.isFinite(numericOffset) ? Math.max(0, numericOffset) : 0;
    }

    resetWidth() {
        this.width = resolveEntityRuntimeConfig(this.entityManager).TRAIL.WIDTH;
    }

    forceGap(duration = 0.5) {
        this.inGap = true;
        this.gapTimer = duration;
        this.hasLastPosition = false;
        this._hasPreviousStepVisual = false;
        this.hideVisualHead();
    }

    hideVisualHead() {
        if (this.headMesh) {
            this.headMesh.visible = false;
        }
        if (this.glowHeadMesh) {
            this.glowHeadMesh.visible = false;
        }
    }

    updateVisualHead(position, direction = null) {
        if (!this.headMesh || !position || this.inGap || !this.hasLastPosition) {
            this.hideVisualHead();
            return false;
        }

        this._resolveVisualSample(position, direction);
        const dx = this._sampleVisualX - this.lastVisualX;
        const dy = this._sampleVisualY - this.lastVisualY;
        const dz = this._sampleVisualZ - this.lastVisualZ;
        const lengthSq = dx * dx + dy * dy + dz * dz;
        if (!Number.isFinite(lengthSq) || lengthSq < 0.0001) {
            this.hideVisualHead();
            return false;
        }

        const length = Math.sqrt(lengthSq);
        const radius = this.width * 0.5;
        this.headMesh.position.set(
            this.lastVisualX + dx * 0.5,
            this.lastVisualY + dy * 0.5,
            this.lastVisualZ + dz * 0.5
        );
        this._tmpDir.set(dx / length, dy / length, dz / length);
        this.headMesh.quaternion.setFromUnitVectors(UP_AXIS, this._tmpDir);
        this.headMesh.scale.set(radius, length, radius);
        this.headMesh.visible = true;
        if (this.glowHeadMesh) {
            this.glowHeadMesh.position.copy(this.headMesh.position);
            this.glowHeadMesh.quaternion.copy(this.headMesh.quaternion);
            this.glowHeadMesh.scale.set(radius * 1.7, length * 1.01, radius * 1.7);
            this.glowHeadMesh.visible = true;
        }
        return true;
    }

    update(dt, position, direction) {
        const config = resolveEntityRuntimeConfig(this.entityManager);
        if (this.inGap) {
            this.hideVisualHead();
            this.gapTimer -= dt;
            if (this.gapTimer <= 0) {
                this.inGap = false;
            }
            this._setLastPosition(position, direction);
            return;
        }

        this._resolveVisualSample(position, direction);
        this.timeSinceUpdate += dt;

        if (this.timeSinceUpdate >= config.TRAIL.UPDATE_INTERVAL) {
            this.timeSinceUpdate -= config.TRAIL.UPDATE_INTERVAL;

            // Der Wuerfel wird erst hier aufgeloest: runtimeRng entsteht im
            // EntityManager nach der Trail-Erzeugung, ein Cache im Konstruktor
            // wuerde also immer den ungesetzten Fallback festhalten.
            const roll = this.entityManager?.runtimeRng?.next;
            const gapRoll = typeof roll === 'function' ? roll() : Math.random();
            if (gapRoll < config.TRAIL.GAP_CHANCE) {
                this.inGap = true;
                this.gapTimer = config.TRAIL.GAP_DURATION;
                this._setLastPosition(position, direction);
                this.hideVisualHead();
                return;
            }

            const visualToX = this._hasPreviousStepVisual ? this._previousStepVisualX : this._sampleVisualX;
            const visualToY = this._hasPreviousStepVisual ? this._previousStepVisualY : this._sampleVisualY;
            const visualToZ = this._hasPreviousStepVisual ? this._previousStepVisualZ : this._sampleVisualZ;
            if (this.hasLastPosition) {
                this._addSegment(
                    this.lastX,
                    this.lastY,
                    this.lastZ,
                    position.x,
                    position.y,
                    position.z,
                    visualToX,
                    visualToY,
                    visualToZ
                );
            }
            this._storeLastPositionFromSample(position, visualToX, visualToY, visualToZ);
        }

        this._storePreviousStepVisualFromSample();

        this._flushDirtyMatrices();
    }

    updateReplayVisual(dt, position, direction, {
        inGap = false,
        discontinuity = false,
    } = {}) {
        if (!position) return false;
        const config = resolveEntityRuntimeConfig(this.entityManager);
        if (discontinuity) {
            this.hasLastPosition = false;
            this._hasPreviousStepVisual = false;
            this.timeSinceUpdate = 0;
        }

        this.inGap = inGap === true;
        if (this.inGap) {
            this._setLastPosition(position, direction);
            this.hideVisualHead();
            return false;
        }

        this._resolveVisualSample(position, direction);
        this.timeSinceUpdate += Math.max(0, Number(dt) || 0);
        if (this.timeSinceUpdate >= config.TRAIL.UPDATE_INTERVAL) {
            this.timeSinceUpdate -= config.TRAIL.UPDATE_INTERVAL;
            const visualToX = this._hasPreviousStepVisual ? this._previousStepVisualX : this._sampleVisualX;
            const visualToY = this._hasPreviousStepVisual ? this._previousStepVisualY : this._sampleVisualY;
            const visualToZ = this._hasPreviousStepVisual ? this._previousStepVisualZ : this._sampleVisualZ;
            if (this.hasLastPosition) {
                this._addSegment(
                    this.lastX,
                    this.lastY,
                    this.lastZ,
                    position.x,
                    position.y,
                    position.z,
                    visualToX,
                    visualToY,
                    visualToZ,
                    { visualOnly: true }
                );
            }
            this._storeLastPositionFromSample(position, visualToX, visualToY, visualToZ);
        }
        this._storePreviousStepVisualFromSample();
        this._flushDirtyMatrices();
        return this.updateVisualHead(position, direction);
    }

    _flushDirtyMatrices() {
        if (!this._dirty) return;
        this.mesh.count = Math.min(this.segmentCount, this.maxSegments);
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.glowMesh) {
            this.glowMesh.count = this.mesh.count;
            this.glowMesh.instanceMatrix.needsUpdate = true;
        }
        this._dirty = false;
    }

    _resolveVisualSample(position, direction = null) {
        const positionX = Number(position?.x) || 0;
        const positionY = Number(position?.y) || 0;
        const positionZ = Number(position?.z) || 0;
        const directionX = Number(direction?.x) || 0;
        const directionY = Number(direction?.y) || 0;
        const directionZ = Number(direction?.z) || 0;
        const directionLength = Math.hypot(directionX, directionY, directionZ);
        const offsetScale = directionLength > 0.000001
            ? (this.visualRearOffset / directionLength)
            : 0;
        this._sampleVisualX = positionX - directionX * offsetScale;
        this._sampleVisualY = positionY - directionY * offsetScale;
        this._sampleVisualZ = positionZ - directionZ * offsetScale;
    }

    _storeLastPositionFromSample(
        position,
        visualX = this._sampleVisualX,
        visualY = this._sampleVisualY,
        visualZ = this._sampleVisualZ
    ) {
        this.hasLastPosition = true;
        this.lastX = position.x;
        this.lastY = position.y;
        this.lastZ = position.z;
        this.lastVisualX = visualX;
        this.lastVisualY = visualY;
        this.lastVisualZ = visualZ;
    }

    _storePreviousStepVisualFromSample() {
        this._previousStepVisualX = this._sampleVisualX;
        this._previousStepVisualY = this._sampleVisualY;
        this._previousStepVisualZ = this._sampleVisualZ;
        this._hasPreviousStepVisual = true;
    }

    _setLastPosition(position, direction = null) {
        this._resolveVisualSample(position, direction);
        this._storeLastPositionFromSample(position);
        this._storePreviousStepVisualFromSample();
    }

    _addSegment(
        fromX,
        fromY,
        fromZ,
        toX,
        toY,
        toZ,
        visualToX = this._sampleVisualX,
        visualToY = this._sampleVisualY,
        visualToZ = this._sampleVisualZ,
        options = null
    ) {
        const visualOnly = options?.visualOnly === true;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dz = toZ - fromZ;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (length < 0.01) return;
        if (!visualOnly && typeof this.entityManager?.onArcadeGameplayEvent === 'function') {
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
                // The index may have taken the key list back into its pool. Holding on to it
                // here would let the next registration hand the same array out twice.
                oldRef.key = null;
            }
        }

        const radius = this.width * 0.5;
        const midX = (fromX + toX) * 0.5;
        const midZ = (fromZ + toZ) * 0.5;
        const visualFromX = this.hasLastPosition ? this.lastVisualX : fromX;
        const visualFromY = this.hasLastPosition ? this.lastVisualY : fromY;
        const visualFromZ = this.hasLastPosition ? this.lastVisualZ : fromZ;
        const resolvedVisualToX = this.hasLastPosition ? visualToX : toX;
        const resolvedVisualToY = this.hasLastPosition ? visualToY : toY;
        const resolvedVisualToZ = this.hasLastPosition ? visualToZ : toZ;
        const visualDx = resolvedVisualToX - visualFromX;
        const visualDy = resolvedVisualToY - visualFromY;
        const visualDz = resolvedVisualToZ - visualFromZ;
        const visualLength = Math.hypot(visualDx, visualDy, visualDz);
        const resolvedVisualDx = visualLength >= 0.01 ? visualDx : dx;
        const resolvedVisualDy = visualLength >= 0.01 ? visualDy : dy;
        const resolvedVisualDz = visualLength >= 0.01 ? visualDz : dz;
        const resolvedVisualLength = visualLength >= 0.01 ? visualLength : length;

        // Visual
        DUMMY.position.set(
            visualLength >= 0.01 ? visualFromX + visualDx * 0.5 : fromX + dx * 0.5,
            visualLength >= 0.01 ? visualFromY + visualDy * 0.5 : fromY + dy * 0.5,
            visualLength >= 0.01 ? visualFromZ + visualDz * 0.5 : fromZ + dz * 0.5
        );
        this._tmpDir.set(
            resolvedVisualDx / resolvedVisualLength,
            resolvedVisualDy / resolvedVisualLength,
            resolvedVisualDz / resolvedVisualLength
        );
        DUMMY.quaternion.setFromUnitVectors(UP_AXIS, this._tmpDir);
        DUMMY.scale.set(radius, resolvedVisualLength, radius);
        DUMMY.updateMatrix();
        this.mesh.setMatrixAt(this.writeIndex, DUMMY.matrix);
        this.mesh.instanceMatrix.addUpdateRange(this.writeIndex * 16, 16);
        DUMMY.scale.set(radius * 1.7, resolvedVisualLength * 1.01, radius * 1.7);
        DUMMY.updateMatrix();
        if (this.glowMesh) {
            this.glowMesh.setMatrixAt(this.writeIndex, DUMMY.matrix);
            this.glowMesh.instanceMatrix.addUpdateRange(this.writeIndex * 16, 16);
        }
        this._dirty = true;

        // Register in global grid
        const segmentHp = getTrailSegmentHp(this.entityManager);
        if (!visualOnly && this.trailSpatialIndex) {
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
        } else {
            this.segmentRefs[this.writeIndex] = null;
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
        this.mesh.instanceMatrix.addUpdateRange(segmentIdx * 16, 16);
        if (this.glowMesh) {
            this.glowMesh.setMatrixAt(segmentIdx, DUMMY.matrix);
            this.glowMesh.instanceMatrix.addUpdateRange(segmentIdx * 16, 16);
        }
        this.segmentRefs[segmentIdx] = null;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.glowMesh) this.glowMesh.instanceMatrix.needsUpdate = true;
        this._dirty = true;
        return true;
    }

    clear() {
        for (let i = 0; i < this.segmentCount; i++) {
            if (this.segmentRefs[i] && this.trailSpatialIndex) {
                this.trailSpatialIndex.unregisterTrailSegment(this.segmentRefs[i].key, this.segmentRefs[i].entry);
            }
            this.segmentRefs[i] = null;
        }
        this.mesh.count = 0;
        this.mesh.instanceMatrix.clearUpdateRanges();
        if (this.glowMesh) {
            this.glowMesh.count = 0;
            this.glowMesh.instanceMatrix.clearUpdateRanges();
        }

        this.writeIndex = 0;
        this.segmentCount = 0;
        this._dirty = false;
        this.hasLastPosition = false;
        this._hasPreviousStepVisual = false;
        this.timeSinceUpdate = 0;
        this.inGap = false;
        this.hideVisualHead();
    }

    dispose() {
        this.renderer.removeFromScene(this.mesh);
        if (this.glowMesh) this.renderer.removeFromScene(this.glowMesh);
        this.renderer.removeFromScene(this.headMesh);
        if (this.glowHeadMesh) this.renderer.removeFromScene(this.glowHeadMesh);
        this.mesh.dispose();
        this.glowMesh?.dispose();
        this.material.dispose();
        this.glowMaterial?.dispose();
        this.headMesh = null;
        this.glowMesh = null;
        this.glowHeadMesh = null;
        this.glowMaterial = null;
    }
}
