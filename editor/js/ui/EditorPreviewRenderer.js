import * as THREE from 'three';
import { createEditorMesh } from '../EditorMeshFactory.js';
import { resolveEditorBuildEntryAssetId } from './EditorBuildCatalog.js';

const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 144;
const PREVIEW_FPS = 24;
const PREVIEW_ROTATION_SPEED = 0.28;
const CAMERA_DIRECTION = new THREE.Vector3(1.55, 1.05, 2.35).normalize();

function hasFinitePreviewGeometry(object) {
    let valid = true;
    object?.traverse?.((node) => {
        const transformValues = [
            node.position?.x, node.position?.y, node.position?.z,
            node.quaternion?.x, node.quaternion?.y, node.quaternion?.z, node.quaternion?.w,
            node.scale?.x, node.scale?.y, node.scale?.z,
        ];
        if (transformValues.some((value) => value !== undefined && !Number.isFinite(value))) {
            valid = false;
            return;
        }
        const values = node.geometry?.attributes?.position?.array;
        if (!values || !valid) return;
        for (let index = 0; index < values.length; index += 1) {
            if (!Number.isFinite(values[index])) {
                valid = false;
                break;
            }
        }
    });
    return valid;
}

function getPreviewPlacement(entry) {
    if (entry.tool === 'hard' || entry.tool === 'foam') {
        return {
            sizeInfo: 1,
            extraProps: { sizeX: 1.5, sizeY: 1.05, sizeZ: 1.25 },
        };
    }
    if (entry.tool === 'tunnel') {
        return {
            sizeInfo: 0.55,
            extraProps: {
                radius: 0.55,
                pointA: new THREE.Vector3(-1.25, 0, 0),
                pointB: new THREE.Vector3(1.25, 0, 0),
            },
        };
    }
    if (entry.tool === 'portal') return { sizeInfo: 1, extraProps: { radius: 1 } };
    if (entry.tool === 'checkpoint') return { sizeInfo: 1, extraProps: { cpRadius: 1 } };
    if (entry.tool === 'aircraft') return { sizeInfo: 1, extraProps: { modelScale: 1 } };
    if (entry.tool === 'glb') return { sizeInfo: 1, extraProps: { targetSize: 1 } };
    return { sizeInfo: 1, extraProps: {} };
}

export function createEditorPreviewObject(mapManager, entry) {
    if (!mapManager || !entry) return null;
    const placement = getPreviewPlacement(entry);
    return createEditorMesh(
        mapManager,
        entry.tool,
        entry.subType,
        0,
        0,
        0,
        placement.sizeInfo,
        placement.extraProps,
        { register: false, updateUi: false, attachSelectionOutlines: false },
    );
}

export function fitEditorPreviewObject(object, targetRadius = 1) {
    if (!object || !hasFinitePreviewGeometry(object)) return null;
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return null;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;

    const wrapper = new THREE.Group();
    object.position.sub(sphere.center);
    wrapper.scale.setScalar(targetRadius / sphere.radius);
    wrapper.add(object);
    wrapper.updateWorldMatrix(true, true);
    return wrapper;
}

export function disposeEditorPreviewObject(object, mapManager) {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    object?.traverse?.((node) => {
        if (node.geometry
            && !disposedGeometries.has(node.geometry)
            && mapManager?.shouldDisposeGeometry?.(node)) {
            disposedGeometries.add(node.geometry);
            node.geometry.dispose?.();
        }
        const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
        for (const material of materials) {
            if (!material
                || disposedMaterials.has(material)
                || !mapManager?.shouldDisposeMaterial?.(node, material)) continue;
            disposedMaterials.add(material);
            material.dispose?.();
        }
    });
}

function createUnavailablePreviewRenderer() {
    return {
        available: false,
        attach() { return false; },
        clearTargets() {},
        dispose() {},
        isEntryReady() { return false; },
        async loadEntry() { return false; },
    };
}

export function createEditorBuildPreviewRenderer(mapManager, options = {}) {
    let renderer = null;
    try {
        renderer = options.rendererFactory?.() || new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'low-power',
        });
        renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x06101f, 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
    } catch (error) {
        console.warn('[EditorPreviewRenderer] 3D previews unavailable:', error);
        renderer?.dispose?.();
        return createUnavailablePreviewRenderer();
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 20);
    const cameraDistance = 1.18 / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5));
    camera.position.copy(CAMERA_DIRECTION).multiplyScalar(cameraDistance);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x18233a, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4, 5, 3);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 1.4);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const previews = new Map();
    const targets = new Map();
    const requestFrame = options.requestAnimationFrame
        || globalThis.requestAnimationFrame?.bind(globalThis)
        || ((callback) => globalThis.setTimeout(() => callback(globalThis.performance?.now?.() || Date.now()), 50));
    const cancelFrame = options.cancelAnimationFrame
        || globalThis.cancelAnimationFrame?.bind(globalThis)
        || globalThis.clearTimeout?.bind(globalThis);
    const motionQuery = options.motionQuery
        || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
        || null;
    let reducedMotion = motionQuery?.matches === true;
    let disposed = false;
    let frameId = 0;
    let lastFrameTime = -Infinity;

    const hasVisibleTarget = () => {
        for (const target of targets.values()) {
            if (target.visible && target.canvas.isConnected !== false) return true;
        }
        return false;
    };

    const prepareEntry = (entry) => {
        if (!entry || previews.has(entry.id)) return previews.get(entry?.id) || null;
        const assetId = resolveEditorBuildEntryAssetId(entry);
        if (entry.tool === 'glb' && mapManager?.assetLoader?.getLoadStatus?.(assetId)?.state !== 'loaded') {
            return null;
        }

        let object = null;
        try {
            object = createEditorPreviewObject(mapManager, entry);
            const root = fitEditorPreviewObject(object);
            if (!root) {
                disposeEditorPreviewObject(object, mapManager);
                return null;
            }
            root.visible = false;
            scene.add(root);
            const preview = { root, baseRotation: root.rotation.y };
            previews.set(entry.id, preview);
            return preview;
        } catch (error) {
            disposeEditorPreviewObject(object, mapManager);
            console.warn(`[EditorPreviewRenderer] Preview for "${entry.id}" unavailable:`, error);
            return null;
        }
    };

    const scheduleFrame = () => {
        if (disposed || frameId || !hasVisibleTarget()) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        frameId = requestFrame(renderFrame);
    };

    function renderFrame(timestamp) {
        frameId = 0;
        if (disposed || targets.size === 0) return;
        const now = Number.isFinite(timestamp) ? timestamp : (globalThis.performance?.now?.() || Date.now());
        if (!reducedMotion && now - lastFrameTime < 1000 / PREVIEW_FPS) {
            scheduleFrame();
            return;
        }
        lastFrameTime = now;

        if (typeof document === 'undefined' || !document.hidden) {
            for (const target of targets.values()) {
                if (!target.visible || target.canvas.isConnected === false) continue;
                const preview = prepareEntry(target.entry);
                if (!preview) continue;
                preview.root.rotation.y = preview.baseRotation + now * 0.001 * PREVIEW_ROTATION_SPEED;
                preview.root.visible = true;
                renderer.render(scene, camera);
                target.context.drawImage(renderer.domElement, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
                preview.root.visible = false;
            }
        }
        if (!reducedMotion) scheduleFrame();
    }

    const observerCallback = (records) => {
        for (const record of records) {
            const target = targets.get(record.target);
            if (target) target.visible = record.isIntersecting;
        }
        scheduleFrame();
    };
    const observerFactory = options.intersectionObserverFactory
        || (typeof IntersectionObserver === 'function'
            ? (callback) => new IntersectionObserver(callback, { rootMargin: '80px' })
            : null);
    const observer = observerFactory?.(observerCallback) || null;

    const handleMotionChange = (event) => {
        reducedMotion = event.matches === true;
        scheduleFrame();
    };
    motionQuery?.addEventListener?.('change', handleMotionChange);
    const handleVisibilityChange = () => scheduleFrame();
    globalThis.document?.addEventListener?.('visibilitychange', handleVisibilityChange);

    return {
        available: true,
        attach(canvas, entry) {
            if (disposed || !canvas || !entry) return false;
            const context = canvas.getContext?.('2d', { alpha: false });
            if (!context) return false;
            const target = { canvas, context, entry, visible: !observer };
            targets.set(canvas, target);
            observer?.observe?.(canvas);
            prepareEntry(entry);
            scheduleFrame();
            return true;
        },
        clearTargets() {
            for (const canvas of targets.keys()) observer?.unobserve?.(canvas);
            targets.clear();
            if (frameId) cancelFrame?.(frameId);
            frameId = 0;
        },
        isEntryReady(entry) {
            if (!entry || disposed) return false;
            if (entry.tool !== 'glb') return true;
            const assetId = resolveEditorBuildEntryAssetId(entry);
            return mapManager?.assetLoader?.getLoadStatus?.(assetId)?.state === 'loaded';
        },
        async loadEntry(entry) {
            if (!entry || disposed) return false;
            const assetId = resolveEditorBuildEntryAssetId(entry);
            if (entry.tool === 'glb' && assetId) {
                await mapManager?.assetLoader?.loadAsset?.(assetId);
            }
            const preview = prepareEntry(entry);
            scheduleFrame();
            return !!preview;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (frameId) cancelFrame?.(frameId);
            frameId = 0;
            observer?.disconnect?.();
            motionQuery?.removeEventListener?.('change', handleMotionChange);
            globalThis.document?.removeEventListener?.('visibilitychange', handleVisibilityChange);
            targets.clear();
            for (const preview of previews.values()) {
                scene.remove(preview.root);
                disposeEditorPreviewObject(preview.root, mapManager);
            }
            previews.clear();
            renderer.dispose?.();
            renderer.forceContextLoss?.();
            renderer = null;
        },
    };
}
