import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SHARED_GLB_LOADER = new GLTFLoader();

function normalizeUrl(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDelay(value) {
    const delay = Number(value);
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
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
        });
    });

    return { colliders, bounds };
}

async function waitForDelay(delayMs = 0) {
    const delay = normalizeDelay(delayMs);
    if (delay <= 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
}

export async function loadGLBMap(glbModel, options = {}) {
    const modelUrl = normalizeUrl(glbModel);
    if (!modelUrl) {
        throw new Error('GLB map URL is required.');
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
