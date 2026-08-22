import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { normalizeMapAnimationClock } from '../shared/contracts/MapAnimationClockContract.js';
import { createGlbAnimationTrack } from './arena/GlbAnimationDriver.js';
import { createDynamicMeshCollider, createStaticMeshCollider } from './arena/StaticMeshCollider.js';
import { normalizeAllowedGLBUrl } from './mapSchema/MapSchemaGlbOps.js';

const SHARED_GLB_LOADER = new GLTFLoader();
const DEFAULT_GLB_SHADOW_CASTER_BUDGET = 24;
// Only transform tracks move a collider. Morph and material tracks deform or restyle a
// mesh without displacing it, so they keep the cheaper static collider.
const TRANSFORM_TRACK_PROPERTIES = new Set(['position', 'quaternion', 'rotation', 'scale']);

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

/**
 * @param {any} glbModels
 * @param {{ animationClock?: unknown }} [options] map level clock every model falls back to
 */
export function normalizeGLBModelCollection(glbModels, options = {}) {
    if (!Array.isArray(glbModels)) return [];
    const mapClock = normalizeMapAnimationClock(options?.animationClock);
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
            animationClock: normalizeMapAnimationClock(source?.animationClock, mapClock),
        });
    }
    return normalized;
}

export function shouldDiscardAuthoredObstacleVisuals({ usedGlbModel, loadWarnings, map } = {}) {
    return usedGlbModel === true
        && Array.isArray(loadWarnings)
        && loadWarnings.length === 0
        && map?.glbAuthoredObstaclesCollisionOnly === true;
}

/**
 * Picks the clip a setpiece should play. A named clip that the file does not contain falls
 * back to the first one, so a renamed export degrades to the old behaviour instead of
 * leaving the setpiece frozen.
 */
function selectAnimationClip(clips, clipName) {
    if (!Array.isArray(clips) || clips.length === 0) return null;
    const wanted = typeof clipName === 'string' ? clipName.trim() : '';
    if (wanted) {
        const match = clips.find((clip) => String(clip?.name || '') === wanted);
        if (match) return match;
    }
    return clips[0] || null;
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

function isMeshColliderForcedDynamic(mesh) {
    const name = String(mesh?.name || '').toLowerCase();
    return name.includes('_dyn');
}

function resolveColliderKind(mesh) {
    const name = String(mesh?.name || '').toLowerCase();
    return name.includes('_foam') ? 'foam' : 'hard';
}

/**
 * Resolves every object whose world transform an animation clip drives, including the
 * descendants of an animated node — a keyframed rig empty moves the meshes below it.
 */
export function collectAnimatedNodes(root, clips) {
    const animated = new Set();
    if (!root || !Array.isArray(clips)) return animated;

    for (const clip of clips) {
        for (const track of clip?.tracks || []) {
            let parsed = null;
            try {
                parsed = THREE.PropertyBinding.parseTrackName(String(track?.name || ''));
            } catch {
                continue;
            }
            if (!TRANSFORM_TRACK_PROPERTIES.has(parsed?.propertyName)) continue;
            const node = parsed.nodeName
                ? THREE.PropertyBinding.findNode(root, parsed.nodeName)
                : root;
            node?.traverse?.((child) => animated.add(child));
        }
    }
    return animated;
}

function collectSceneColliders(root, options = {}) {
    const colliders = [];
    const bounds = new THREE.Box3();
    const shadowCandidates = [];
    const collectColliders = options.collectColliders !== false;
    const animatedNodes = options.animatedNodes instanceof Set ? options.animatedNodes : null;
    // 'dynamic' keeps static set dressing on the map's authored box obstacles and only
    // adds mesh colliders for the moving parts.
    const dynamicOnly = options.colliderMode === 'dynamic';
    const shadowCasterBudget = Math.max(0, Math.trunc(
        Number(options.shadowCasterBudget ?? DEFAULT_GLB_SHADOW_CASTER_BUDGET) || 0
    ));
    root.updateWorldMatrix(true, true);

    root.traverse((child) => {
        if (!child?.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = true;
        const box = new THREE.Box3().setFromObject(child);
        if (box.isEmpty()) return;
        bounds.union(box);

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const transparent = materials.some((material) => material?.transparent === true);
        const noShadow = String(child.name || '').toLowerCase().includes('_noshadow');
        if (!transparent && !noShadow) {
            const width = box.max.x - box.min.x;
            const height = box.max.y - box.min.y;
            const depth = box.max.z - box.min.z;
            shadowCandidates.push({
                mesh: child,
                score: Math.max(width * height, width * depth, height * depth),
            });
        }

        if (!collectColliders) return;
        if (isMeshColliderDisabled(child)) return;

        const isAnimated = isMeshColliderForcedDynamic(child) || !!animatedNodes?.has(child);
        if (dynamicOnly && !isAnimated) return;

        const kind = resolveColliderKind(child);
        const meshCollider = isAnimated
            ? createDynamicMeshCollider(child)
            : createStaticMeshCollider(child);
        // A moving mesh we cannot track (skinned, degenerate) gets no collider at all: its
        // baked box would drift away from the animation and block empty space.
        if (isAnimated && !meshCollider) return;

        colliders.push({
            box,
            isWall: false,
            kind,
            meshCollider,
            dynamic: !!meshCollider?.dynamic,
        });
    });

    shadowCandidates.sort((left, right) => right.score - left.score);
    for (let index = 0; index < Math.min(shadowCasterBudget, shadowCandidates.length); index++) {
        shadowCandidates[index].mesh.castShadow = true;
    }

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
    const clock = normalizeMapAnimationClock(options.animationClock);
    const clips = Array.isArray(gltf.animations) ? gltf.animations : [];
    const clip = selectAnimationClip(clips, clock.clipName);
    const animationMixer = clip ? new THREE.AnimationMixer(scene) : null;
    const animationTracks = [];
    if (animationMixer && clip) {
        const action = animationMixer.clipAction(clip);
        action.play();
        animationTracks.push(createGlbAnimationTrack({ mixer: animationMixer, action, clip, clock }));
    }
    // Only the clip that actually plays moves anything, so only its nodes need to carry a
    // collider that follows the animation.
    const animatedNodes = collectAnimatedNodes(scene, clip ? [clip] : []);
    const { colliders, bounds } = collectSceneColliders(scene, {
        collectColliders: options.collectColliders !== false,
        colliderMode: options.colliderMode,
        animatedNodes,
    });
    return {
        sourceUrl: modelUrl,
        footprint: resolveGLBFootprint(modelUrl, {
            colliderMode: options.collectColliders === false
                ? 'fallbackOnly'
                : (normalizeUrl(options.colliderMode) || 'scene'),
        }),
        scene,
        animationMixers: animationMixer ? [animationMixer] : [],
        animationTracks,
        animatedNodes,
        colliders,
        bounds,
    };
}

export async function loadGLBMapCollection(glbModels, options = {}) {
    const models = normalizeGLBModelCollection(glbModels, { animationClock: options.animationClock });
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
                    animationClock: descriptor.animationClock,
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
    const animationMixers = [];
    const animationTracks = [];
    // Per-model detection runs before placement; the node references stay identical once
    // the scenes are nested into the collection group, so the union stays valid.
    const animatedNodes = new Set();
    let loadedCount = 0;
    for (const loaded of loadedModels) {
        if (!loaded) continue;
        scene.add(placeCollectionScene(
            loaded.result.scene,
            loaded.result.bounds,
            loaded.descriptor,
            placementScale,
        ));
        animationMixers.push(...loaded.result.animationMixers);
        animationTracks.push(...loaded.result.animationTracks);
        for (const node of loaded.result.animatedNodes) animatedNodes.add(node);
        loadedCount += 1;
    }

    const resolvedWarnings = warnings.filter(Boolean);
    if (loadedCount === 0) {
        const firstWarning = resolvedWarnings[0] || 'No model could be loaded.';
        throw new Error(`GLB collection failed (${models.length}/${models.length}): ${firstWarning}`);
    }

    const { colliders, bounds } = collectSceneColliders(scene, {
        collectColliders: options.collectColliders !== false,
        colliderMode: options.colliderMode,
        animatedNodes,
    });
    return {
        sourceUrls: models.map((entry) => entry.url),
        footprint: resolveGLBCollectionFootprint(models, {
            colliderMode: options.collectColliders === false
                ? 'fallbackOnly'
                : (normalizeUrl(options.colliderMode) || 'scene'),
            loadedCount,
        }),
        scene,
        animationMixers,
        animationTracks,
        animatedNodes,
        colliders,
        bounds,
        warnings: resolvedWarnings,
        loadedCount,
        failedCount: models.length - loadedCount,
    };
}
