import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStaticMeshCollider } from './arena/StaticMeshCollider.js';
import { normalizeAllowedGLBUrl } from './mapSchema/MapSchemaGlbOps.js';

const SHARED_GLB_LOADER = new GLTFLoader();

function normalizeUrl(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDelay(value) {
    const delay = Number(value);
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

function normalizePositiveNumber(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeVector3(value, fallback = [0, 0, 0]) {
    const source = Array.isArray(value) ? value : fallback;
    return [
        Number.isFinite(Number(source[0])) ? Number(source[0]) : fallback[0],
        Number.isFinite(Number(source[1])) ? Number(source[1]) : fallback[1],
        Number.isFinite(Number(source[2])) ? Number(source[2]) : fallback[2],
    ];
}

export function normalizeGLBModelCollection(glbModels) {
    if (!Array.isArray(glbModels)) return [];
    const normalized = [];
    for (let index = 0; index < glbModels.length; index += 1) {
        const source = glbModels[index];
        const url = normalizeAllowedGLBUrl(typeof source === 'string' ? source : source?.url);
        if (!url) continue;
        normalized.push({
            id: normalizeUrl(source?.id) || `model-${index + 1}`,
            url,
            position: normalizeVector3(source?.position),
            rotation: normalizeVector3(source?.rotation),
            scale: normalizePositiveNumber(source?.scale, 1),
            targetSize: normalizePositiveNumber(source?.targetSize, 0),
        });
    }
    return normalized;
}

export function classifyGLBModelSource(glbModel) {
    const modelUrl = normalizeUrl(glbModel);
    if (!modelUrl) return 'none';
    if (modelUrl.startsWith('data:')) return 'embedded';
    if (/^https?:\/\//i.test(modelUrl)) return 'remote';
    return 'file';
}

export function resolveGLBFootprint(glbModel, options = {}) {
    const colliderMode = normalizeUrl(options.colliderMode) || 'scene';
    return {
        sourceKind: classifyGLBModelSource(glbModel),
        colliderMode,
        fallbackMode: 'box-obstacles-on-load-error',
    };
}

export function resolveGLBCollectionFootprint(glbModels, options = {}) {
    const models = normalizeGLBModelCollection(glbModels);
    const colliderMode = normalizeUrl(options.colliderMode) || 'scene';
    const loadedCount = Number.isFinite(Number(options.loadedCount))
        ? Math.max(0, Math.min(models.length, Math.trunc(Number(options.loadedCount))))
        : undefined;
    return {
        sourceKind: 'collection',
        colliderMode,
        fallbackMode: 'box-obstacles-on-load-error',
        modelCount: models.length,
        ...(loadedCount === undefined ? {} : { loadedCount }),
    };
}

export function hasGLBMapSource(mapDefinition) {
    const singleModel = normalizeUrl(mapDefinition?.glbModel);
    return !!singleModel || normalizeGLBModelCollection(mapDefinition?.glbModels).length > 0;
}

export function resolveGLBMapSourceFootprint(mapDefinition) {
    const models = normalizeGLBModelCollection(mapDefinition?.glbModels);
    const colliderMode = normalizeUrl(mapDefinition?.glbColliderMode) || 'scene';
    if (models.length > 0) {
        return resolveGLBCollectionFootprint(models, { colliderMode });
    }
    return resolveGLBFootprint(mapDefinition?.glbModel, { colliderMode });
}

function isMeshColliderDisabled(mesh) {
    const name = String(mesh?.name || '').toLowerCase();
    return name.includes('_nocol');
}

function resolveColliderKind(mesh) {
    const name = String(mesh?.name || '').toLowerCase();
    return name.includes('_foam') ? 'foam' : 'hard';
}

function collectSceneColliders(root, options = {}) {
    const colliders = [];
    const bounds = new THREE.Box3();
    const collectColliders = options.collectColliders !== false;
    root.updateWorldMatrix(true, true);

    root.traverse((child) => {
        if (!child?.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        bounds.expandByObject(child);

        if (!collectColliders) return;
        if (isMeshColliderDisabled(child)) return;

        const box = new THREE.Box3().setFromObject(child);
        if (box.isEmpty()) return;
        const kind = resolveColliderKind(child);
        colliders.push({
            box,
            isWall: false,
            kind,
            meshCollider: createStaticMeshCollider(child),
        });
    });

    return { colliders, bounds };
}

async function waitForDelay(delayMs = 0) {
    const delay = normalizeDelay(delayMs);
    if (delay <= 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
}

function placeCollectionScene(scene, bounds, descriptor, placementScale) {
    const slot = new THREE.Group();
    slot.name = `glb-slot-${descriptor.id}`;
    slot.userData.glbModelId = descriptor.id;
    slot.userData.glbModelUrl = descriptor.url;

    const [px, py, pz] = descriptor.position;
    const [rx, ry, rz] = descriptor.rotation;
    slot.position.set(px * placementScale, py * placementScale, pz * placementScale);
    slot.rotation.set(rx, ry, rz);

    const modelBounds = bounds?.isBox3 ? bounds : new THREE.Box3().setFromObject(scene);
    const size = modelBounds.getSize(new THREE.Vector3());
    const center = modelBounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
    const fitScale = descriptor.targetSize > 0
        ? (descriptor.targetSize * placementScale) / maxDimension
        : descriptor.scale * placementScale;

    const normalizer = new THREE.Group();
    normalizer.name = `glb-normalizer-${descriptor.id}`;
    normalizer.scale.setScalar(fitScale);

    const offset = new THREE.Group();
    offset.position.set(-center.x, -modelBounds.min.y, -center.z);
    offset.add(scene);
    normalizer.add(offset);
    slot.add(normalizer);
    return slot;
}

export async function loadGLBMap(glbModel, options = {}) {
    const modelUrl = normalizeAllowedGLBUrl(glbModel);
    if (!modelUrl) {
        throw new Error('GLB map URL must be an allowed local asset path or bounded embedded model.');
    }

    const loader = options.loader || SHARED_GLB_LOADER;
    await waitForDelay(options.loadDelayMs);
    const gltf = await loader.loadAsync(modelUrl);
    const scene = gltf?.scene || gltf?.scenes?.[0];
    if (!scene) {
        throw new Error('GLB map did not contain a root scene.');
    }

    scene.name = String(options.sceneName || 'glbMapScene');
    const { colliders, bounds } = collectSceneColliders(scene, {
        collectColliders: options.collectColliders !== false,
    });
    return {
        sourceUrl: modelUrl,
        footprint: resolveGLBFootprint(modelUrl, {
            colliderMode: options.collectColliders === false ? 'fallbackOnly' : 'scene',
        }),
        scene,
        colliders,
        bounds,
    };
}

export async function loadGLBMapCollection(glbModels, options = {}) {
    const models = normalizeGLBModelCollection(glbModels);
    if (models.length === 0) {
        throw new Error('GLB map collection requires at least one model URL.');
    }

    await waitForDelay(options.loadDelayMs);

    const concurrency = Math.max(1, Math.min(
        models.length,
        Math.trunc(normalizePositiveNumber(options.concurrency, 4)),
    ));
    const placementScale = normalizePositiveNumber(options.placementScale, 1);
    const loadedModels = new Array(models.length);
    const warnings = new Array(models.length);
    let nextIndex = 0;

    const loadNext = async () => {
        while (nextIndex < models.length) {
            const modelIndex = nextIndex;
            nextIndex += 1;
            const descriptor = models[modelIndex];
            try {
                const result = await loadGLBMap(descriptor.url, {
                    loader: options.loader,
                    sceneName: `glbModel-${descriptor.id}`,
                    collectColliders: false,
                });
                loadedModels[modelIndex] = { descriptor, result };
            } catch (error) {
                warnings[modelIndex] = `GLB model "${descriptor.id}" failed: ${error?.message || 'Unknown loading error'}`;
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, () => loadNext()));

    const scene = new THREE.Group();
    scene.name = String(options.sceneName || 'glbMapCollection');
    let loadedCount = 0;
    for (const loaded of loadedModels) {
        if (!loaded) continue;
        scene.add(placeCollectionScene(
            loaded.result.scene,
            loaded.result.bounds,
            loaded.descriptor,
            placementScale,
        ));
        loadedCount += 1;
    }

    const resolvedWarnings = warnings.filter(Boolean);
    if (loadedCount === 0) {
        const firstWarning = resolvedWarnings[0] || 'No model could be loaded.';
        throw new Error(`GLB collection failed (${models.length}/${models.length}): ${firstWarning}`);
    }

    const { colliders, bounds } = collectSceneColliders(scene, {
        collectColliders: options.collectColliders !== false,
    });
    return {
        sourceUrls: models.map((entry) => entry.url),
        footprint: resolveGLBCollectionFootprint(models, {
            colliderMode: options.collectColliders === false ? 'fallbackOnly' : 'scene',
            loadedCount,
        }),
        scene,
        colliders,
        bounds,
        warnings: resolvedWarnings,
        loadedCount,
        failedCount: models.length - loadedCount,
    };
}
