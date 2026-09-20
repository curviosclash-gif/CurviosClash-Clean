import * as THREE from 'three';

const MIN_BATCHABLE_SEEDS = 32;
const MAX_VARIANTS_PER_COMPONENT = 4;
const HIDDEN_INSTANCE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

function materialKey(material) {
    const materials = Array.isArray(material) ? material : [material];
    return materials.map((entry, index) => String(entry?.uuid || entry?.name || index)).join('|');
}

function collectSeedMeshes(node) {
    const meshes = [];
    node?.traverse?.((child) => {
        if (!child?.isMesh || child.isSkinnedMesh || !child.geometry) return;
        // The shootable GLB exports every primitive as one child mesh. A future multi-material
        // seed needs its own batching policy rather than silently multiplying its draw groups.
        if (Array.isArray(child.material) && child.material.length > 1) return;
        meshes.push(child);
    });
    return meshes;
}

function estimatedDrawCalls(mesh) {
    if (!Array.isArray(mesh?.material)) return 1;
    return Math.max(1, mesh.geometry?.groups?.length || mesh.material.length);
}

/**
 * Replaces hundreds of individually submitted seed meshes with a small, deterministic set of
 * InstancedMeshes. Logical seed nodes stay in the scene graph as transform anchors for gameplay,
 * but remain hidden while their render instances mirror those transforms.
 */
export class DandelionSeedRenderBatch {
    static create(scene, seeds) {
        if (!scene?.isObject3D || !Array.isArray(seeds) || seeds.length < MIN_BATCHABLE_SEEDS) {
            return null;
        }

        const components = new Map();
        for (const seed of seeds) {
            const meshes = collectSeedMeshes(seed.node);
            if (meshes.length === 0) return null;
            for (let componentIndex = 0; componentIndex < meshes.length; componentIndex += 1) {
                const sourceMesh = meshes[componentIndex];
                const key = `${componentIndex}:${materialKey(sourceMesh.material)}`;
                if (!components.has(key)) components.set(key, []);
                components.get(key).push({ seed, sourceMesh });
            }
        }

        return new DandelionSeedRenderBatch(scene, seeds, components);
    }

    constructor(scene, seeds, components) {
        this.scene = scene;
        this.root = new THREE.Group();
        this.root.name = 'DandelionSeedRenderBatches';
        this.root.userData.role = 'dandelion_seed_render_batches';
        this.root.matrixAutoUpdate = false;
        this.root.updateMatrix();
        this._sceneInverse = new THREE.Matrix4();
        this._relativeMatrix = new THREE.Matrix4();
        this._instanceMatrix = new THREE.Matrix4();
        this._heightScale = new THREE.Vector3(1, 1, 1);
        this._entriesBySeed = new Map();
        this._dirtyMeshes = new Set();
        this._meshes = [];

        let componentNumber = 0;
        for (const sources of components.values()) {
            const variantCount = Math.min(MAX_VARIANTS_PER_COMPONENT, sources.length);
            const buckets = Array.from({ length: variantCount }, () => []);
            for (const source of sources) {
                buckets[Math.abs(source.seed.index) % variantCount].push(source);
            }

            for (let variant = 0; variant < buckets.length; variant += 1) {
                const bucket = buckets[variant];
                if (bucket.length === 0) continue;
                const template = bucket[0];
                const mesh = new THREE.InstancedMesh(
                    template.sourceMesh.geometry,
                    template.sourceMesh.material,
                    bucket.length,
                );
                mesh.name = `DandelionSeedBatch_${componentNumber}_${variant}`;
                mesh.userData.role = 'dandelion_seed_render_batch';
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                mesh.castShadow = bucket.some((entry) => entry.sourceMesh.castShadow === true);
                mesh.receiveShadow = bucket.some((entry) => entry.sourceMesh.receiveShadow === true);
                mesh.frustumCulled = false;
                mesh.renderOrder = template.sourceMesh.renderOrder;
                mesh.layers.mask = template.sourceMesh.layers.mask;
                mesh.customDepthMaterial = template.sourceMesh.customDepthMaterial;
                mesh.customDistanceMaterial = template.sourceMesh.customDistanceMaterial;
                this.root.add(mesh);
                this._meshes.push(mesh);

                for (let instanceId = 0; instanceId < bucket.length; instanceId += 1) {
                    const source = bucket[instanceId];
                    const entries = this._entriesBySeed.get(source.seed) || [];
                    entries.push({
                        mesh,
                        instanceId,
                        templateHeight: Math.max(0.0001, Number(template.seed.height) || 1),
                    });
                    this._entriesBySeed.set(source.seed, entries);
                }
            }
            componentNumber += 1;
        }

        scene.add(this.root);
        for (const seed of seeds) seed.node.visible = false;
        this.beginUpdate();
        for (const seed of seeds) this.updateSeed(seed, true);
        this.commit();
    }

    beginUpdate() {
        this.scene.updateWorldMatrix?.(true, false);
        this._sceneInverse.copy(this.scene.matrixWorld).invert();
        this._dirtyMeshes.clear();
    }

    updateSeed(seed, visible, worldMatrixCurrent = false) {
        const entries = this._entriesBySeed.get(seed);
        if (!entries) return;
        if (visible) {
            if (!worldMatrixCurrent) seed.node.updateWorldMatrix?.(true, false);
            this._relativeMatrix.multiplyMatrices(this._sceneInverse, seed.node.matrixWorld);
        }

        for (const entry of entries) {
            if (visible) {
                this._heightScale.set(1, Math.max(0.0001, seed.height / entry.templateHeight), 1);
                this._instanceMatrix.copy(this._relativeMatrix).scale(this._heightScale);
                entry.mesh.setMatrixAt(entry.instanceId, this._instanceMatrix);
            } else {
                entry.mesh.setMatrixAt(entry.instanceId, HIDDEN_INSTANCE_MATRIX);
            }
            this._dirtyMeshes.add(entry.mesh);
        }
    }

    commit() {
        for (const mesh of this._dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
        this._dirtyMeshes.clear();
    }

    getMetrics() {
        return {
            enabled: true,
            batches: this._meshes.length,
            instances: Array.from(this._entriesBySeed.keys()).length,
            estimatedDrawCalls: this._meshes.reduce((total, mesh) => total + estimatedDrawCalls(mesh), 0),
        };
    }
}
