import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createVehicleMesh } from '../../../entities/vehicle-registry.js';

const SLOT_ANCHOR_POINTS = Object.freeze({
    core: Object.freeze([0, 0.1, 0]),
    nose: Object.freeze([0, 0.15, -1.25]),
    wing_left: Object.freeze([-1.05, 0.05, -0.15]),
    wing_right: Object.freeze([1.05, 0.05, -0.15]),
    engine_left: Object.freeze([-0.85, 0.05, 1.05]),
    engine_right: Object.freeze([0.85, 0.05, 1.05]),
    utility: Object.freeze([0, 0.8, 0.4]),
});

const projectedPoint = new THREE.Vector3();
const anchorPoint = new THREE.Vector3();
const vehicleBounds = new THREE.Box3();
const boundsCenter = new THREE.Vector3();
const boundsSize = new THREE.Vector3();

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeColor(value, fallback = 0x66b6ff) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const clamped = Math.max(0, Math.min(0xffffff, Math.floor(value)));
        return clamped;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
            return Number.parseInt(normalized, 16);
        }
    }
    return fallback;
}

function createAnchorVector(slotKey, scaleFactor) {
    const baseAnchor = SLOT_ANCHOR_POINTS[slotKey] || SLOT_ANCHOR_POINTS.core;
    return new THREE.Vector3(
        baseAnchor[0] * scaleFactor,
        baseAnchor[1] * scaleFactor,
        baseAnchor[2] * scaleFactor
    );
}

function removeVehicleNode(parent, node) {
    if (!node || !parent) return;
    parent.remove(node);
    if (typeof node.dispose === 'function') {
        try {
            node.dispose();
        } catch {
            // ignore cleanup issues from external mesh classes
        }
    }
}

function findRenderSize(element) {
    const width = Math.max(1, Math.floor(normalizeNumber(element?.clientWidth, 0)));
    const height = Math.max(1, Math.floor(normalizeNumber(element?.clientHeight, 0)));
    return { width, height };
}

export function createVehicleManagerPreview3d({ mount, overlay }) {
    const slotOverlayRoot = overlay || null;
    const targetMount = mount || null;
    if (!targetMount) {
        return {
            getStatus: () => 'unavailable',
            setVehicle() {},
            setSlotStates() {},
            setActive() {},
            resetView() {},
            dispose() {},
        };
    }

    const previewCanvasHost = document.createElement('div');
    previewCanvasHost.className = 'arcade-vehicle-preview-canvas';
    targetMount.appendChild(previewCanvasHost);

    const statusLabel = document.createElement('p');
    statusLabel.className = 'menu-hint arcade-vehicle-preview-status';
    targetMount.appendChild(statusLabel);

    let status = 'booting';
    let renderer = null;
    let controls = null;
    let rafId = 0;
    let lastFrameMs = 0;
    let vehicleNode = null;
    let activeVehicleId = '';
    let slotStates = [];
    let slotClickHandler = null;
    let anchorScale = 1;
    let renderWidth = 0;
    let renderHeight = 0;
    let active = true;
    let disposed = false;
    let controlsTargetY = 0.3;
    let cameraDistance = 4.6;
    let cameraHeight = 1.8;

    const markManualInteraction = () => {
        targetMount.dataset.previewMotion = 'manual';
    };
    const markIdleRotation = () => {
        targetMount.dataset.previewMotion = 'idle-spin';
    };
    const beginManualRotation = () => {
        if (controls) controls.autoRotate = false;
        markManualInteraction();
    };
    const resumeIdleRotation = () => {
        if (controls) controls.autoRotate = true;
        markIdleRotation();
    };

    targetMount.addEventListener('pointerdown', beginManualRotation, true);
    window.addEventListener('pointerup', resumeIdleRotation);
    window.addEventListener('pointercancel', resumeIdleRotation);
    window.addEventListener('blur', resumeIdleRotation);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1524);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
    camera.position.set(0, 1.8, 4.6);

    const previewRoot = new THREE.Group();
    scene.add(previewRoot);

    const hemisphere = new THREE.HemisphereLight(0xaad4ff, 0x332211, 0.95);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(5, 7, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x77a3ff, 0.5);
    fillLight.position.set(-4, 3, -5);
    scene.add(fillLight);

    const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.85, 2.4, 0.1, 48),
        new THREE.MeshStandardMaterial({
            color: 0x121a2b,
            roughness: 0.82,
            metalness: 0.15,
            emissive: 0x0a1120,
            emissiveIntensity: 0.25,
        })
    );
    platform.position.set(0, -0.78, 0);
    previewRoot.add(platform);

    const floorGrid = new THREE.GridHelper(16, 32, 0x62c7ff, 0x254c6b);
    floorGrid.name = 'preview-floor-grid';
    floorGrid.position.set(0, -0.84, 0);
    floorGrid.material.transparent = true;
    floorGrid.material.opacity = 0.34;
    floorGrid.material.depthWrite = false;
    previewRoot.add(floorGrid);

    const backdropGrid = new THREE.GridHelper(14, 28, 0x4faee0, 0x203d59);
    backdropGrid.name = 'preview-backdrop-grid';
    backdropGrid.position.set(0, 2.15, -5.2);
    backdropGrid.rotation.x = Math.PI * 0.5;
    backdropGrid.material.transparent = true;
    backdropGrid.material.opacity = 0.18;
    backdropGrid.material.depthWrite = false;
    previewRoot.add(backdropGrid);
    targetMount.dataset.previewGrid = 'hangar';

    function setStatus(nextStatus, text) {
        status = String(nextStatus || 'unknown');
        targetMount.dataset.previewStatus = status;
        statusLabel.textContent = String(text || '');
    }

    function syncRendererSize(force = false) {
        if (!renderer) return;
        const { width, height } = findRenderSize(previewCanvasHost);
        if (!force && width === renderWidth && height === renderHeight) return;
        renderWidth = width;
        renderHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function ensureOverlayButtons() {
        if (!slotOverlayRoot) return;
        slotOverlayRoot.replaceChildren();
        for (let index = 0; index < slotStates.length; index += 1) {
            const state = slotStates[index];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'arcade-vehicle-slot-dot';
            button.dataset.slot = String(state.slotKey || '');
            button.title = String(state.tooltip || state.label || state.slotKey || '');
            button.textContent = String(state.badge || '');
            button.disabled = state.disabled === true;
            button.addEventListener('click', () => {
                if (button.disabled) return;
                if (typeof slotClickHandler === 'function') {
                    slotClickHandler(String(state.slotKey || ''));
                }
            });
            slotOverlayRoot.appendChild(button);
        }
    }

    function refreshOverlayProjection() {
        if (!slotOverlayRoot) return;
        const slotButtons = slotOverlayRoot.querySelectorAll('.arcade-vehicle-slot-dot');
        if (!vehicleNode || !slotButtons.length) {
            for (let index = 0; index < slotButtons.length; index += 1) {
                slotButtons[index].classList.add('hidden');
            }
            return;
        }

        const { width, height } = findRenderSize(previewCanvasHost);
        for (let index = 0; index < slotButtons.length; index += 1) {
            const slotState = slotStates[index];
            const button = slotButtons[index];
            if (!slotState || !button) continue;

            anchorPoint.copy(createAnchorVector(slotState.slotKey, anchorScale));
            projectedPoint.copy(anchorPoint);
            vehicleNode.localToWorld(projectedPoint);
            projectedPoint.project(camera);

            const visible = projectedPoint.z > -1 && projectedPoint.z < 1;
            if (!visible) {
                button.classList.add('hidden');
                continue;
            }

            const x = (projectedPoint.x * 0.5 + 0.5) * width;
            const y = (-projectedPoint.y * 0.5 + 0.5) * height;
            button.style.left = `${x.toFixed(1)}px`;
            button.style.top = `${y.toFixed(1)}px`;
            button.disabled = slotState.disabled === true;
            button.textContent = String(slotState.badge || '');
            button.title = String(slotState.tooltip || slotState.label || slotState.slotKey || '');
            button.classList.toggle('is-disabled', slotState.disabled === true);
            button.classList.toggle('hidden', false);
        }
    }

    function scheduleFrame() {
        if (!disposed && active && renderer && !rafId) {
            rafId = window.requestAnimationFrame(stepFrame);
        }
    }

    function stepFrame(nowMs) {
        rafId = 0;
        if (disposed || !active || !renderer) return;
        syncRendererSize(false);
        const dt = lastFrameMs > 0 ? Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = nowMs;

        if (vehicleNode && typeof vehicleNode.tick === 'function') {
            vehicleNode.tick(dt);
        }
        if (controls) controls.update(dt);
        renderer.render(scene, camera);
        refreshOverlayProjection();
        scheduleFrame();
    }

    function initializeRenderer() {
        try {
            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: false,
                powerPreference: 'high-performance',
            });
            renderer.setPixelRatio(Math.min(2, normalizeNumber(window.devicePixelRatio, 1)));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.domElement.className = 'arcade-vehicle-preview-canvas-node';
            renderer.domElement.setAttribute('aria-label', 'Interaktive 3D-Fahrzeugansicht');
            previewCanvasHost.appendChild(renderer.domElement);
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enablePan = false;
            controls.enableDamping = true;
            controls.dampingFactor = 0.075;
            controls.autoRotate = true;
            controls.autoRotateSpeed = 0.55;
            controls.minDistance = 2.35;
            controls.maxDistance = 8.5;
            controls.target.set(0, 0.3, 0);
            controls.addEventListener('start', markManualInteraction);
            controls.addEventListener('end', markIdleRotation);
            controls.update(0);
            markIdleRotation();

            syncRendererSize(true);
            setStatus('ready', '3D-Preview aktiv. Maus: drehen / zoomen.');
            window.addEventListener('resize', syncRendererSize);

            scheduleFrame();
        } catch {
            renderer = null;
            controls = null;
            setStatus('fallback', '3D-Preview aktuell nicht verfügbar.');
        }
    }

    function setVehicle(vehicleId, colorValue = 0x66b6ff) {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase();
        if (!normalizedVehicleId) return;
        activeVehicleId = normalizedVehicleId;

        removeVehicleNode(previewRoot, vehicleNode);
        vehicleNode = null;

        if (!renderer) {
            setStatus('fallback', '3D-Ansicht nicht verfügbar. Auswahl bleibt bedienbar.');
            return;
        }

        try {
            vehicleNode = createVehicleMesh(normalizedVehicleId, normalizeColor(colorValue));
            previewRoot.add(vehicleNode);
            vehicleNode.rotation.y = Math.PI * 1.16;

            vehicleBounds.setFromObject(vehicleNode);
            vehicleBounds.getCenter(boundsCenter);
            vehicleBounds.getSize(boundsSize);
            vehicleNode.position.sub(boundsCenter);
            vehicleNode.position.y -= boundsSize.y * 0.2;
            anchorScale = Math.max(0.7, Math.max(boundsSize.x, boundsSize.y, boundsSize.z) * 0.65);
            const largestDimension = Math.max(boundsSize.x, boundsSize.y, boundsSize.z);
            cameraDistance = Math.max(4.6, largestDimension * 1.55);
            cameraHeight = Math.max(1.8, boundsSize.y * 0.5);
            camera.position.set(0, cameraHeight, cameraDistance);

            if (controls) {
                controlsTargetY = boundsSize.y * 0.1;
                controls.minDistance = Math.max(2.35, cameraDistance * 0.45);
                controls.maxDistance = Math.max(8.5, cameraDistance * 1.8);
                controls.target.set(0, controlsTargetY, 0);
                controls.update(0);
            }
            setStatus('ready', '3D-Ansicht bereit');
        } catch {
            vehicleNode = null;
            setStatus('fallback', '3D-Ansicht nicht verfügbar. Auswahl bleibt bedienbar.');
        }
    }

    function setSlotStates(nextSlotStates, onSlotClick) {
        slotStates = Array.isArray(nextSlotStates) ? nextSlotStates.slice() : [];
        slotClickHandler = typeof onSlotClick === 'function' ? onSlotClick : null;
        ensureOverlayButtons();
        refreshOverlayProjection();
    }

    function setActive(value) {
        if (disposed) return;
        active = value === true;
        targetMount.dataset.previewActive = String(active);
        if (!active && rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
            lastFrameMs = 0;
            return;
        }
        scheduleFrame();
    }

    function resetView() {
        if (disposed) return;
        camera.position.set(0, cameraHeight, cameraDistance);
        if (controls) {
            controls.target.set(0, controlsTargetY, 0);
            controls.update(0);
        }
        syncRendererSize(true);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        active = false;
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        window.removeEventListener('resize', syncRendererSize);
        targetMount.removeEventListener('pointerdown', beginManualRotation, true);
        window.removeEventListener('pointerup', resumeIdleRotation);
        window.removeEventListener('pointercancel', resumeIdleRotation);
        window.removeEventListener('blur', resumeIdleRotation);
        if (slotOverlayRoot) {
            slotOverlayRoot.replaceChildren();
        }
        removeVehicleNode(previewRoot, vehicleNode);
        vehicleNode = null;
        if (controls) {
            controls.removeEventListener('start', markManualInteraction);
            controls.removeEventListener('end', markIdleRotation);
            controls.dispose();
            controls = null;
        }
        if (renderer) {
            renderer.forceContextLoss?.();
            renderer.dispose();
            if (renderer.domElement?.parentElement) {
                renderer.domElement.parentElement.removeChild(renderer.domElement);
            }
            renderer = null;
        }
        platform.geometry.dispose();
        if (Array.isArray(platform.material)) platform.material.forEach((material) => material.dispose());
        else platform.material.dispose();
        [floorGrid, backdropGrid].forEach((grid) => {
            grid.geometry.dispose();
            if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose());
            else grid.material.dispose();
        });
        delete targetMount.dataset.previewGrid;
        delete targetMount.dataset.previewMotion;
        if (previewCanvasHost.parentElement) {
            previewCanvasHost.parentElement.removeChild(previewCanvasHost);
        }
        if (statusLabel.parentElement) {
            statusLabel.parentElement.removeChild(statusLabel);
        }
        setStatus('disposed', `Preview beendet (${activeVehicleId || '-'})`);
    }

    initializeRenderer();

    return {
        getStatus: () => status,
        setVehicle,
        setSlotStates,
        setActive,
        resetView,
        dispose,
    };
}
