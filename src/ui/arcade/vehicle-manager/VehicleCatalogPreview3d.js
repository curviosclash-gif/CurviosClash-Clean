import * as THREE from 'three';
import { createVehicleMesh } from '../../../entities/vehicle-registry.js';
import { disposeObject3DResources } from '../../../shared/rendering/ThreeDisposal.js';

const PREVIEW_WIDTH = 192;
const PREVIEW_HEIGHT = 108;
const FRAME_INTERVAL_MS = 50;
const ROTATION_SPEED = 0.24;

const fitBounds = new THREE.Box3();
const fitSphere = new THREE.Sphere();

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

    function prepareEntry(vehicleId) {
        if (entries.has(vehicleId)) return entries.get(vehicleId);
        try {
            const root = new THREE.Group();
            root.name = `VehicleCatalogPreview:${vehicleId}`;
            root.rotation.y = Math.PI * 0.12;
            const vehicleNode = createVehicle(vehicleId, color);
            root.add(vehicleNode);
            scene.add(root);
            const entry = { root, vehicleNode, loadedHandler: null, fitted: false };
            entries.set(vehicleId, entry);
            entry.fitted = fitVehicleCatalogPreviewObject(vehicleNode, root, 1.12);
            if (vehicleNode._loadingPromise && vehicleNode._loaded !== true) {
                entry.loadedHandler = () => {
                    vehicleNode.removeEventListener?.('loaded', entry.loadedHandler);
                    entry.loadedHandler = null;
                    entry.fitted = fitVehicleCatalogPreviewObject(vehicleNode, root, 1.12);
                    scheduleFrame();
                };
                vehicleNode.addEventListener?.('loaded', entry.loadedHandler);
            }
            root.visible = false;
            return entry;
        } catch {
            entries.set(vehicleId, null);
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
            const entry = prepareEntry(target.vehicleId);
            if (!entry) {
                target.canvas.dataset.previewStatus = 'fallback';
                continue;
            }
            entry.root.rotation.y = Math.PI * 0.12 + elapsedSeconds * ROTATION_SPEED;
            entry.root.visible = true;
            entry.vehicleNode.tick?.(dt, elapsedSeconds);
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
                if (target.visible) prepareEntry(target.vehicleId);
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

    function attach(canvas, vehicleId) {
        if (disposed || !canvas) return;
        const context = canvas.getContext?.('2d', { alpha: false });
        if (!context) return;
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase();
        if (!normalizedVehicleId) return;
        canvas.width = PREVIEW_WIDTH;
        canvas.height = PREVIEW_HEIGHT;
        canvas.dataset.previewStatus = 'pending';
        const target = { canvas, context, vehicleId: normalizedVehicleId, visible: !observer };
        targets.set(canvas, target);
        if (observer) observer.observe(canvas);
        else {
            prepareEntry(normalizedVehicleId);
            scheduleFrame();
        }
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
                    entry.vehicleNode.removeEventListener?.('loaded', entry.loadedHandler);
                }
                entry.root.removeFromParent();
                disposeVehicleCatalogPreviewObject(entry.vehicleNode);
            }
            entries.clear();
            renderer.dispose?.();
            renderer.forceContextLoss?.();
            renderer = null;
        },
    });
}
