import * as THREE from 'three';
import { createVehicleMesh } from '../../../entities/vehicle-registry.js';
import { disposeObject3DResources } from '../../../shared/rendering/ThreeDisposal.js';
import { HangarVehicleAssembly } from '../../hangar/HangarVehicleAssembly.js';

const PREVIEW_WIDTH = 192;
const PREVIEW_HEIGHT = 108;
const FRAME_INTERVAL_MS = 50;
const ROTATION_SPEED = 0.24;

const fitBounds = new THREE.Box3();
const fitSphere = new THREE.Sphere();

export function resolveHangarPartPreviewRadius(part) {
    const sizeScale = Number(part?.appearance?.sizeScale) || 1;
    return Math.max(0.84, Math.min(1.14, 0.52 + sizeScale * 0.45));
}

export function fitVehicleCatalogPreviewObject(vehicleNode, root, targetRadius = 1) {
    if (!vehicleNode || !root) return false;
    const preservedRotationY = root.rotation.y;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    vehicleNode.position.set(0, 0, 0);
    vehicleNode.updateWorldMatrix(true, true);
    fitBounds.setFromObject(vehicleNode);
    fitBounds.getBoundingSphere(fitSphere);
    if (!Number.isFinite(fitSphere.radius) || fitSphere.radius <= 0.0001) {
        root.rotation.y = preservedRotationY;
        return false;
    }
    vehicleNode.position.sub(fitSphere.center);
    root.scale.setScalar(Math.max(0.01, Number(targetRadius) || 1) / fitSphere.radius);
    root.rotation.y = preservedRotationY;
    root.updateWorldMatrix(true, true);
    return true;
}

export function disposeVehicleCatalogPreviewObject(vehicleNode) {
    if (!vehicleNode) return;
    vehicleNode.cancelPendingLoad?.();
    if (typeof vehicleNode.dispose === 'function') {
        try {
            vehicleNode.dispose();
            return;
        } catch {
            // Fall through to generic Three.js resource cleanup.
        }
    }
    disposeObject3DResources(vehicleNode);
}

function createUnavailablePreview() {
    return Object.freeze({
        available: false,
        attach() {},
        attachCard() {},
        attachPartCard() {},
        clearTargets() {},
        dispose() {},
    });
}

export function createVehicleCatalogPreview3d(options = {}) {
    const windowRef = options.windowRef || globalThis.window;
    const documentRef = options.documentRef || globalThis.document;
    const requestFrame = options.requestAnimationFrame
        || windowRef?.requestAnimationFrame?.bind(windowRef);
    const cancelFrame = options.cancelAnimationFrame
        || windowRef?.cancelAnimationFrame?.bind(windowRef);
    if (!requestFrame || !cancelFrame) return createUnavailablePreview();

    let renderer;
    try {
        const rendererFactory = options.rendererFactory || (() => new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'low-power',
        }));
        renderer = rendererFactory();
        renderer.setPixelRatio?.(1);
        renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
    } catch {
        return createUnavailablePreview();
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07111e);
    const camera = new THREE.PerspectiveCamera(34, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 40);
    camera.position.set(3.35, 2.2, 4.65);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xcbe7ff, 0x182236, 1.65));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x55aaff, 1.25);
    rimLight.position.set(-4, 2, -5);
    scene.add(rimLight);
    const partAssembly = options.partAssembly || new HangarVehicleAssembly(scene);

    const createVehicle = options.createVehicle || createVehicleMesh;
    const rawColor = options.color;
    const color = typeof rawColor === 'string' && /^#[0-9a-f]{6}$/i.test(rawColor)
        ? Number.parseInt(rawColor.slice(1), 16)
        : (Number.isFinite(Number(rawColor)) ? Number(rawColor) : 0x66b6ff);
    const targets = new Map();
    const entries = new Map();
    let observer = null;
    let rafId = 0;
    let lastFrameMs = 0;
    let elapsedSeconds = 0;
    let disposed = false;

    const motionQuery = options.motionQuery
        || windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')
        || null;
    let reduceMotion = motionQuery?.matches === true;

    function hasVisibleTargets() {
        for (const target of targets.values()) {
            if (target.visible) return true;
        }
        return false;
    }

    function scheduleFrame() {
        if (
            disposed
            || rafId
            || documentRef?.visibilityState === 'hidden'
            || !hasVisibleTargets()
        ) return;
        rafId = requestFrame(renderFrame);
    }

    function prepareEntry(target) {
        if (entries.has(target.previewKey)) return entries.get(target.previewKey);
        try {
            const root = new THREE.Group();
            root.name = target.kind === 'part'
                ? `HangarPartCatalogPreview:${target.id}`
                : `VehicleCatalogPreview:${target.id}`;
            root.rotation.y = Math.PI * 0.12;
            const objectNode = target.kind === 'part'
                ? partAssembly.createPreviewPartNode(target.part)
                : createVehicle(target.id, color);
            root.add(objectNode);
            scene.add(root);
            const entry = { root, objectNode, kind: target.kind, loadedHandler: null, fitted: false };
            entries.set(target.previewKey, entry);
            const targetRadius = target.kind === 'part' ? resolveHangarPartPreviewRadius(target.part) : 1.12;
            entry.fitted = fitVehicleCatalogPreviewObject(objectNode, root, targetRadius);
            if (objectNode._loadingPromise && objectNode._loaded !== true) {
                entry.loadedHandler = () => {
                    objectNode.removeEventListener?.('loaded', entry.loadedHandler);
                    entry.loadedHandler = null;
                    entry.fitted = fitVehicleCatalogPreviewObject(objectNode, root, targetRadius);
                    scheduleFrame();
                };
                objectNode.addEventListener?.('loaded', entry.loadedHandler);
            }
            root.visible = false;
            return entry;
        } catch {
            entries.set(target.previewKey, null);
            return null;
        }
    }

    function renderFrame(nowMs = 0) {
        rafId = 0;
        if (disposed || documentRef?.visibilityState === 'hidden') return;
        if (lastFrameMs && nowMs - lastFrameMs < FRAME_INTERVAL_MS) {
            scheduleFrame();
            return;
        }
        const dt = lastFrameMs ? Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = nowMs;
        elapsedSeconds += dt;

        for (const target of targets.values()) {
            if (!target.visible) continue;
            const entry = prepareEntry(target);
            if (!entry) {
                target.canvas.dataset.previewStatus = 'fallback';
                continue;
            }
            entry.root.rotation.y = Math.PI * 0.12 + elapsedSeconds * ROTATION_SPEED;
            entry.root.visible = true;
            entry.objectNode.tick?.(dt, elapsedSeconds);
            renderer.render(scene, camera);
            target.context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
            target.context.drawImage(renderer.domElement, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
            target.canvas.dataset.previewStatus = entry.fitted ? 'ready' : 'loading';
            entry.root.visible = false;
        }
        if (!reduceMotion) scheduleFrame();
    }

    const observerFactory = options.intersectionObserverFactory
        || (typeof globalThis.IntersectionObserver === 'function'
            ? (callback) => new globalThis.IntersectionObserver(callback, { rootMargin: '80px 0px' })
            : null);
    if (observerFactory) {
        observer = observerFactory((records) => {
            for (const record of records) {
                const target = targets.get(record.target);
                if (!target) continue;
                target.visible = record.isIntersecting === true;
                if (target.visible) prepareEntry(target);
            }
            if (!hasVisibleTargets() && rafId) {
                cancelFrame(rafId);
                rafId = 0;
                lastFrameMs = 0;
            } else {
                scheduleFrame();
            }
        });
    }

    function clearTargets() {
        for (const canvas of targets.keys()) observer?.unobserve?.(canvas);
        targets.clear();
        if (rafId) cancelFrame(rafId);
        rafId = 0;
        lastFrameMs = 0;
    }

    function attachTarget(canvas, target) {
        if (disposed || !canvas) return;
        const context = canvas.getContext?.('2d', { alpha: false });
        if (!context) return;
        canvas.width = PREVIEW_WIDTH;
        canvas.height = PREVIEW_HEIGHT;
        canvas.dataset.previewStatus = 'pending';
        const previewTarget = { canvas, context, visible: !observer, ...target };
        targets.set(canvas, previewTarget);
        if (observer) observer.observe(canvas);
        else {
            prepareEntry(previewTarget);
            scheduleFrame();
        }
    }

    function attach(canvas, vehicleId) {
        const id = String(vehicleId || '').trim().toLowerCase();
        if (id) attachTarget(canvas, { id, kind: 'vehicle', previewKey: `vehicle:${id}` });
    }

    function attachCard(card, vehicleId) {
        if (disposed || !card || !documentRef?.createElement) return;
        const canvas = documentRef.createElement('canvas');
        canvas.className = 'hangar-vehicle-card-preview';
        canvas.setAttribute('aria-hidden', 'true');
        card.classList.add('has-preview');
        card.appendChild(canvas);
        attach(canvas, vehicleId);
    }

    function attachPartCard(card, part) {
        const id = String(part?.id || '').trim().toLowerCase();
        if (disposed || !id || !card || !documentRef?.createElement) return;
        const canvas = documentRef.createElement('canvas');
        canvas.className = 'hangar-part-card-preview';
        canvas.setAttribute('aria-hidden', 'true');
        card.classList.add('has-preview');
        card.appendChild(canvas);
        attachTarget(canvas, { id, kind: 'part', part, previewKey: `part:${id}` });
    }

    function handleVisibilityChange() {
        if (documentRef?.visibilityState === 'hidden') {
            if (rafId) cancelFrame(rafId);
            rafId = 0;
            lastFrameMs = 0;
        } else {
            scheduleFrame();
        }
    }

    function handleMotionChange(event) {
        reduceMotion = event.matches === true;
        scheduleFrame();
    }

    documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
    motionQuery?.addEventListener?.('change', handleMotionChange);

    return Object.freeze({
        available: true,
        attach,
        attachCard,
        attachPartCard,
        clearTargets,
        dispose() {
            if (disposed) return;
            disposed = true;
            clearTargets();
            observer?.disconnect?.();
            observer = null;
            documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
            motionQuery?.removeEventListener?.('change', handleMotionChange);
            for (const entry of entries.values()) {
                if (!entry) continue;
                if (entry.loadedHandler) {
                    entry.objectNode.removeEventListener?.('loaded', entry.loadedHandler);
                }
                entry.root.removeFromParent();
                if (entry.kind === 'vehicle') disposeVehicleCatalogPreviewObject(entry.objectNode);
            }
            entries.clear();
            partAssembly.dispose?.();
            renderer.dispose?.();
            renderer.forceContextLoss?.();
            renderer = null;
        },
    });
}
