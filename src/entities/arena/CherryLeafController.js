import * as THREE from 'three';

const RELEASE_RADIUS = 4.8;
const RELEASES_PER_PASS = 5;
const FLIGHT_SECONDS = 13;
const AXIS = new THREE.Vector3(0.8, 0.25, 0.4).normalize();
const LEAF_CAPACITY = 768;

function pointSegmentDistanceSq(point, start, end) {
    const dx = end.x - start.x; const dy = end.y - start.y; const dz = end.z - start.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t = lengthSq > 1e-6 ? THREE.MathUtils.clamp(((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSq, 0, 1) : 0;
    const x = start.x + dx * t - point.x; const y = start.y + dy * t - point.y; const z = start.z + dz * t - point.z;
    return x * x + y * y + z * z;
}

function resolveBatchParent(node, scene) {
    let current = node;
    while (current && current !== scene) {
        if (current.parent?.isLOD === true) return current;
        current = current.parent;
    }
    return scene;
}

/** Host-authoritative cherry leaves rendered in bounded, source-matched instanced batches. */
export class CherryLeafController {
    constructor(scene) {
        this.scene = scene;
        this.leaves = [];
        this.batches = [];
        this.events = [];
        this._start = new THREE.Vector3();
        this._end = new THREE.Vector3();
        this._wind = new THREE.Vector3();
        this._position = new THREE.Vector3();
        this._tumble = new THREE.Quaternion();
        this._rotation = new THREE.Quaternion();
        this._matrix = new THREE.Matrix4();
        this._scale = new THREE.Vector3(1, 1, 1);
        this._sourceMatrix = new THREE.Matrix4();
        this._restPosition = new THREE.Vector3();
        this._restQuaternion = new THREE.Quaternion();
        this._restScale = new THREE.Vector3();
        scene?.updateWorldMatrix?.(true, true);
        const parentInverses = new WeakMap();
        scene?.traverse?.((node) => {
            if (node?.userData?.role !== 'wind_leaf' || !node.isMesh || !node.parent || this.leaves.length >= LEAF_CAPACITY) return;
            const batchParent = resolveBatchParent(node, scene);
            let parentInverse = parentInverses.get(batchParent);
            if (!parentInverse) {
                parentInverse = batchParent.matrixWorld.clone().invert();
                parentInverses.set(batchParent, parentInverse);
            }
            const worldPosition = node.getWorldPosition(new THREE.Vector3());
            const releasePosition = worldPosition.clone();
            this._sourceMatrix.multiplyMatrices(parentInverse, node.matrixWorld);
            this._sourceMatrix.decompose(this._restPosition, this._restQuaternion, this._restScale);
            this.leaves.push({
                index: this.leaves.length + 1,
                sourceLeafIndex: Number(node.userData.leaf_index) || 0,
                source: node,
                batchParent,
                restPosition: this._restPosition.clone(),
                releasePosition,
                restQuaternion: this._restQuaternion.clone(),
                restScale: this._restScale.clone(),
                releasedAt: null,
                expired: false,
                launch: new THREE.Vector3(),
            });
        });
        this.leaves.sort((a, b) => a.index - b.index);
        this._leavesById = new Map(this.leaves.map((leaf) => [leaf.index, leaf]));
        this._makeBatch();
    }

    _makeBatch() {
        if (!this.scene || this.leaves.length === 0) return;
        const groupsByParent = new Map();
        for (const leaf of this.leaves) {
            let groupsByGeometry = groupsByParent.get(leaf.batchParent);
            if (!groupsByGeometry) {
                groupsByGeometry = new Map();
                groupsByParent.set(leaf.batchParent, groupsByGeometry);
            }
            let groupsByMaterial = groupsByGeometry.get(leaf.source.geometry);
            if (!groupsByMaterial) {
                groupsByMaterial = new Map();
                groupsByGeometry.set(leaf.source.geometry, groupsByMaterial);
            }
            const materialKey = leaf.source.material;
            let group = groupsByMaterial.get(materialKey);
            if (!group) {
                group = { geometry: leaf.source.geometry, sourceMaterial: materialKey, leaves: [] };
                groupsByMaterial.set(materialKey, group);
            }
            group.leaves.push(leaf);
            leaf.batchGroup = group;
            leaf.source.visible = false;
        }

        const cloneMaterial = (material) => {
            const clone = material?.clone?.() || new THREE.MeshBasicMaterial();
            clone.side = THREE.DoubleSide;
            return clone;
        };
        for (const [batchParent, groupsByGeometry] of groupsByParent) {
            for (const groupsByMaterial of groupsByGeometry.values()) {
                for (const group of groupsByMaterial.values()) {
                    const material = Array.isArray(group.sourceMaterial)
                        ? group.sourceMaterial.map(cloneMaterial)
                        : cloneMaterial(group.sourceMaterial);
                    const batch = new THREE.InstancedMesh(group.geometry, material, group.leaves.length);
                    batch.name = `CherryLeafWindBatch_${this.batches.length + 1}`;
                    batch.frustumCulled = false;
                    batch.count = group.leaves.length;
                    batch.userData.role = 'wind_leaf_batch';
                    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                    group.uploadGeneration = 0;
                    batch.instanceMatrix.onUpload(function () {
                        this.clearUpdateRanges();
                        group.uploadGeneration += 1;
                    });
                    batchParent.add(batch);
                    group.batch = batch;
                    this.batches.push(batch);
                    for (let i = 0; i < group.leaves.length; i += 1) {
                        const leaf = group.leaves[i];
                        leaf.instance = i;
                        leaf.uploadGeneration = -1;
                        leaf.uploadRange = { start: i * 16, count: 16 };
                        this._matrix.compose(leaf.restPosition, leaf.restQuaternion, leaf.restScale);
                        batch.setMatrixAt(i, this._matrix);
                    }
                    batch.instanceMatrix.needsUpdate = true;
                }
            }
        }
        this.batch = this.batches[0] || null;
    }

    get count() { return this.leaves.length; }

    _writeLeafMatrix(leaf) {
        const group = leaf.batchGroup;
        const attribute = group.batch.instanceMatrix;
        group.batch.setMatrixAt(leaf.instance, this._matrix);
        // Keep pending slots until an actual upload, including invisible batches.
        // Reuse each slot's range; Three merges these objects in place on upload.
        if (leaf.uploadGeneration !== group.uploadGeneration) {
            leaf.uploadRange.start = leaf.instance * 16;
            leaf.uploadRange.count = 16;
            attribute.updateRanges.push(leaf.uploadRange);
            leaf.uploadGeneration = group.uploadGeneration;
        }
        attribute.needsUpdate = true;
    }

    /** Called for each authoritative vehicle tick; segment distance prevents tunnelling. */
    releaseNearPass(previousPosition, position, playerRadius = 0, seconds = 0) {
        if (!position || this.leaves.length === 0) return 0;
        const start = previousPosition || position;
        const radius = RELEASE_RADIUS + Math.max(0, Number(playerRadius) || 0);
        const radiusSq = radius * radius;
        this._start.copy(start);
        this._end.copy(position);
        let released = 0;
        for (const leaf of this.leaves) {
            if (leaf.releasedAt !== null || released >= RELEASES_PER_PASS) continue;
            if (pointSegmentDistanceSq(leaf.releasePosition, this._start, this._end) > radiusSq) continue;
            this.release(leaf.index, seconds, this._start, this._end);
            released += 1;
        }
        return released;
    }

    release(index, seconds, start = null, end = null) {
        const leaf = this._leavesById.get(Number(index));
        if (!leaf || leaf.releasedAt !== null) return false;
        const at = Math.round(Math.max(0, Number(seconds) || 0) * 1000) / 1000;
        leaf.releasedAt = at;
        leaf.expired = false;
        const dx = (end?.x ?? 0) - (start?.x ?? 0);
        const dz = (end?.z ?? 0) - (start?.z ?? 0);
        const heading = at * 0.17 + leaf.index * 2.399;
        leaf.launch.set(Math.cos(heading) + dx * 0.035, 0.18 + (leaf.index % 5) * 0.025, Math.sin(heading) + dz * 0.035).normalize();
        this.events.push([leaf.index, at, leaf.launch.x, leaf.launch.y, leaf.launch.z]);
        return true;
    }

    update(seconds) {
        if (!this.batch) return;
        const now = Math.max(0, Number(seconds) || 0);
        const heading = now * 0.027 + Math.sin(now * 0.009) * 0.65;
        this._wind.set(Math.cos(heading), 0, Math.sin(heading));
        for (const leaf of this.leaves) {
            if (leaf.releasedAt === null) continue;
            const age = now - leaf.releasedAt;
            if (age >= FLIGHT_SECONDS) {
                if (leaf.expired) continue;
                leaf.expired = true;
                this._scale.setScalar(0);
                this._matrix.compose(leaf.restPosition, leaf.restQuaternion, this._scale);
            } else {
                leaf.expired = false;
                this._position.copy(leaf.restPosition)
                    .addScaledVector(leaf.launch, age * (0.9 + (leaf.index % 7) * 0.06))
                    .addScaledVector(this._wind, age * 0.62);
                this._position.y += Math.sin(age * 2.8 + leaf.index) * 0.42 + age * 0.11 - age * age * 0.035;
                this._tumble.setFromAxisAngle(AXIS, age * (1.4 + (leaf.index % 9) * 0.16));
                this._scale.copy(leaf.restScale);
                this._rotation.copy(leaf.restQuaternion).multiply(this._tumble);
                this._matrix.compose(this._position, this._rotation, this._scale);
            }
            this._writeLeafMatrix(leaf);
        }
    }

    reset() {
        if (this.batches.length > 0) {
            for (const leaf of this.leaves) {
                leaf.releasedAt = null;
                leaf.expired = false;
                this._matrix.compose(leaf.restPosition, leaf.restQuaternion, leaf.restScale);
                this._writeLeafMatrix(leaf);
                leaf.source.visible = false;
            }
        }
        this.events.length = 0;
    }

    serialize() { return this.events.map((event) => [...event]); }

    applyNetworkState(events) {
        if (!Array.isArray(events)) return;
        const diverged = this.events.length > events.length || this.events.some(
            (event, i) => event.some((value, field) => Number(value) !== Number(events[i]?.[field])),
        );
        if (diverged) this.reset();
        for (let i = this.events.length; i < events.length; i += 1) {
            const event = events[i];
            if (!this.release(event?.[0], event?.[1])) continue;
            const leaf = this._leavesById.get(Number(event[0]));
            if (leaf && event.length >= 5) leaf.launch.set(Number(event[2]), Number(event[3]), Number(event[4]));
            this.events[this.events.length - 1] = [...event];
        }
    }
}
