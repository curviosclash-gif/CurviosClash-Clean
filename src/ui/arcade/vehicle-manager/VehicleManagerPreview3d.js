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
        slotOverlayRoot.innerHTML = '';
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

    function stepFrame(nowMs) {
        if (!renderer) return;
        syncRendererSize(false);
        const dt = lastFrameMs > 0 ? Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = nowMs;

        if (vehicleNode && typeof vehicleNode.tick === 'function') {
            vehicleNode.tick(dt);
        }
        if (controls) controls.update();
        renderer.render(scene, camera);
        refreshOverlayProjection();
        rafId = window.requestAnimationFrame(stepFrame);
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
            previewCanvasHost.appendChild(renderer.domElement);
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enablePan = false;
            controls.enableDamping = true;
            controls.dampingFactor = 0.075;
            controls.minDistance = 2.35;
            controls.maxDistance = 8.5;
            controls.target.set(0, 0.3, 0);
            controls.update();

            syncRendererSize(true);
            setStatus('ready', '3D-Preview aktiv. Maus: drehen / zoomen.');
            window.addEventListener('resize', syncRendererSize);

            rafId = window.requestAnimationFrame(stepFrame);
        } catch {
            renderer = null;
            controls = null;
            setStatus('fallback', '3D-Preview aktuell nicht verfuegbar.');
        }
    }

    function setVehicle(vehicleId, colorValue = 0x66b6ff) {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase();
        if (!normalizedVehicleId) return;
        activeVehicleId = normalizedVehicleId;

        removeVehicleNode(previewRoot, vehicleNode);
        vehicleNode = null;

        if (!renderer) {
            setStatus('fallback', `Preview-Fallback fuer ${normalizedVehicleId}`);
            return;
        }

        try {
            vehicleNode = createVehicleMesh(normalizedVehicleId, normalizeColor(colorValue));
            previewRoot.add(vehicleNode);
            vehicleNode.rotation.y = Math.PI * 0.16;

            vehicleBounds.setFromObject(vehicleNode);
            vehicleBounds.getCenter(boundsCenter);
            vehicleBounds.getSize(boundsSize);
            vehicleNode.position.sub(boundsCenter);
            vehicleNode.position.y -= boundsSize.y * 0.2;
            anchorScale = Math.max(0.7, Math.max(boundsSize.x, boundsSize.y, boundsSize.z) * 0.65);

            if (controls) {
                controls.target.set(0, boundsSize.y * 0.1, 0);
                controls.update();
            }
            setStatus('ready', `3D-Preview: ${normalizedVehicleId}`);
        } catch {
            vehicleNode = null;
            setStatus('fallback', `Preview-Fallback fuer ${normalizedVehicleId}`);
        }
    }

    function setSlotStates(nextSlotStates, onSlotClick) {
        slotStates = Array.isArray(nextSlotStates) ? nextSlotStates.slice() : [];
        slotClickHandler = typeof onSlotClick === 'function' ? onSlotClick : null;
        ensureOverlayButtons();
        refreshOverlayProjection();
    }

    function dispose() {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
        }
        window.removeEventListener('resize', syncRendererSize);
        if (slotOverlayRoot) {
            slotOverlayRoot.innerHTML = '';
        }
        removeVehicleNode(previewRoot, vehicleNode);
        vehicleNode = null;
        if (controls) {
            controls.dispose();
            controls = null;
        }
        if (renderer) {
            renderer.dispose();
            if (renderer.domElement?.parentElement) {
                renderer.domElement.parentElement.removeChild(renderer.domElement);
            }
            renderer = null;
        }
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
        dispose,
    };
}
