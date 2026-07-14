import * as THREE from 'three';
import { HANGAR_SLOT_DEFINITIONS } from './HangarPartCatalog.js';
import { HangarVehicleAssembly } from './HangarVehicleAssembly.js';
import { HangarCameraController } from './HangarCameraController.js';

const _projected = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();

function renderSize(element) {
    return {
        width: Math.max(1, Math.floor(Number(element?.clientWidth) || 1)),
        height: Math.max(1, Math.floor(Number(element?.clientHeight) || 1)),
    };
}

export function createHangarViewport3d({ mount, overlay, color = '#66b6ff' } = {}) {
    if (!mount) {
        return Object.freeze({
            getStatus: () => 'unavailable', setBuild() {}, setSlotStates() {}, setDragPreview() {},
            clearDragPreview() {}, setSelectedSlot() {}, setCameraPreset() {}, resetCamera() {}, dispose() {},
        });
    }

    const canvasHost = document.createElement('div');
    canvasHost.className = 'arcade-vehicle-preview-canvas hangar-viewport-canvas';
    mount.appendChild(canvasHost);
    const statusLabel = document.createElement('p');
    statusLabel.className = 'menu-hint arcade-vehicle-preview-status hangar-viewport-status';
    mount.appendChild(statusLabel);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080d18);
    scene.fog = new THREE.Fog(0x080d18, 10, 22);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const root = new THREE.Group();
    root.position.y = 0.35;
    scene.add(root);

    const hemisphere = new THREE.HemisphereLight(0xb8d7ff, 0x16100d, 1.45);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
    keyLight.position.set(4.5, 7, 3.5);
    const rimLight = new THREE.DirectionalLight(0x4b8dff, 1.5);
    rimLight.position.set(-5, 2.5, -4);
    scene.add(hemisphere, keyLight, rimLight);

    const platformGeometry = new THREE.CylinderGeometry(2.25, 2.65, 0.16, 64);
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x10192a, roughness: 0.72, metalness: 0.48, emissive: 0x071322, emissiveIntensity: 0.5 });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = -0.86;
    root.add(platform);
    const grid = new THREE.GridHelper(9, 18, 0x27466c, 0x13243b);
    grid.position.y = -0.77;
    scene.add(grid);

    const assembly = new HangarVehicleAssembly(root);
    const markerGeometry = new THREE.SphereGeometry(0.075, 12, 8);
    const markers = new Map();
    const markerRoot = new THREE.Group();
    root.add(markerRoot);
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const material = new THREE.MeshBasicMaterial({ color: 0x6ab8ff, transparent: true, opacity: 0.78 });
        const marker = new THREE.Mesh(markerGeometry, material);
        marker.userData.hangarSlotId = slot.id;
        markerRoot.add(marker);
        markers.set(slot.id, marker);
    }

    let renderer = null;
    let cameraController = null;
    let rafId = 0;
    let status = 'booting';
    let disposed = false;
    let lastFrameMs = 0;
    let renderWidth = 0;
    let renderHeight = 0;
    let activeBuild = null;
    let activeVehicleId = '';
    let activeBuildSignature = '';
    let slotStates = [];
    let onSlotClick = null;
    let selectedSlotId = '';
    let hoveredSlotId = '';
    let cameraRevision = 0;

    function setStatus(nextStatus, message) {
        status = nextStatus;
        mount.dataset.previewStatus = nextStatus;
        mount.dataset.hangarRenderLoop = nextStatus === 'ready' ? 'active' : nextStatus;
        statusLabel.textContent = message;
    }

    function syncSize(force = false) {
        if (!renderer) return;
        const size = renderSize(canvasHost);
        if (!force && size.width === renderWidth && size.height === renderHeight) return;
        renderWidth = size.width;
        renderHeight = size.height;
        renderer.setSize(renderWidth, renderHeight, false);
        camera.aspect = renderWidth / renderHeight;
        camera.updateProjectionMatrix();
    }

    function markerTone(slotId) {
        const state = slotStates.find((entry) => entry.slotKey === slotId) || {};
        if (state.dropState === 'valid') return 0x35d07f;
        if (state.dropState === 'invalid') return 0xff4d63;
        if (slotId === selectedSlotId) return 0xf8c25e;
        if (slotId === hoveredSlotId) return 0xa8dbff;
        if (state.disabled) return 0x576070;
        return 0x55aef4;
    }

    function syncMarkerVisuals() {
        for (const [slotId, marker] of markers.entries()) {
            if (!assembly.copyHardpointPosition(slotId, marker.position)) {
                marker.visible = false;
                continue;
            }
            marker.visible = true;
            marker.material.color.setHex(markerTone(slotId));
            const emphasized = slotId === selectedSlotId || slotId === hoveredSlotId;
            marker.scale.setScalar(emphasized ? 1.55 : 1);
        }
    }

    function setHoveredSlot(slotId) {
        hoveredSlotId = String(slotId || '');
        syncMarkerVisuals();
    }

    function buildOverlay() {
        if (!overlay) return;
        overlay.replaceChildren();
        for (const slot of HANGAR_SLOT_DEFINITIONS) {
            const state = slotStates.find((entry) => entry.slotKey === slot.id) || {};
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'arcade-vehicle-slot-dot hangar-slot-hardpoint';
            button.dataset.slot = slot.id;
            button.dataset.hangarSlot = slot.id;
            button.textContent = String(state.badge || slot.label.slice(0, 1));
            button.title = String(state.tooltip || slot.label);
            button.disabled = state.disabled === true;
            button.classList.toggle('is-disabled', state.disabled === true);
            button.addEventListener('pointerenter', () => setHoveredSlot(slot.id));
            button.addEventListener('pointerleave', () => setHoveredSlot(''));
            button.addEventListener('click', () => {
                if (!button.disabled) onSlotClick?.(slot.id);
            });
            overlay.appendChild(button);
        }
    }

    function projectOverlay() {
        if (!overlay || !renderer) return;
        const buttons = overlay.children;
        for (let index = 0; index < buttons.length; index += 1) {
            const button = buttons[index];
            const slotId = String(button.dataset.hangarSlot || '');
            if (!assembly.copyHardpointPosition(slotId, _worldPoint)) {
                button.classList.add('hidden');
                continue;
            }
            _projected.copy(_worldPoint);
            root.localToWorld(_projected);
            _projected.project(camera);
            const visible = _projected.z > -1 && _projected.z < 1
                && _projected.x >= -1 && _projected.x <= 1
                && _projected.y >= -1 && _projected.y <= 1;
            button.classList.toggle('hidden', !visible);
            if (!visible) continue;
            button.style.left = `${((_projected.x * 0.5 + 0.5) * renderWidth).toFixed(1)}px`;
            button.style.top = `${((-_projected.y * 0.5 + 0.5) * renderHeight).toFixed(1)}px`;
        }
    }

    function frame(nowMs) {
        if (disposed || !renderer) return;
        if (!mount.isConnected || mount.getClientRects().length === 0) {
            lastFrameMs = nowMs;
            rafId = window.requestAnimationFrame(frame);
            return;
        }
        syncSize();
        const dt = lastFrameMs ? Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = nowMs;
        assembly.vehicleNode?.tick?.(dt, nowMs / 1000);
        cameraController?.update();
        renderer.render(scene, camera);
        projectOverlay();
        rafId = window.requestAnimationFrame(frame);
    }

    function initialize() {
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
            renderer.setPixelRatio(Math.min(2, Number(window.devicePixelRatio) || 1));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.domElement.className = 'arcade-vehicle-preview-canvas-node hangar-viewport-canvas-node';
            renderer.domElement.setAttribute('aria-label', 'Interaktive 3D-Fahrzeugansicht');
            canvasHost.appendChild(renderer.domElement);
            cameraController = new HangarCameraController(camera, renderer.domElement);
            const cameraChange = () => {
                cameraRevision += 1;
                mount.dataset.cameraRevision = String(cameraRevision);
            };
            cameraController.controls.addEventListener('change', cameraChange);
            cameraController._cameraChange = cameraChange;
            syncSize(true);
            setStatus('ready', '3D-Workshop bereit');
            rafId = window.requestAnimationFrame(frame);
        } catch {
            setStatus('fallback', '3D-Ansicht konnte nicht initialisiert werden');
        }
    }

    function setBuild(build, options = {}) {
        activeBuild = build;
        const vehicleId = String(build?.vehicleId || 'ship5');
        if (vehicleId !== activeVehicleId) {
            activeVehicleId = vehicleId;
            assembly.clearGhost();
            assembly.setVehicle(vehicleId, options.color || color);
        }
        const slots = build?.slots || {};
        const signature = `${vehicleId}|${HANGAR_SLOT_DEFINITIONS.map((slot) => slots[slot.id] || '').join('|')}`;
        if (signature !== activeBuildSignature) {
            activeBuildSignature = signature;
            assembly.setBuild(build);
        }
        syncMarkerVisuals();
        setStatus(renderer ? 'ready' : 'fallback', renderer ? `3D-Workshop: ${vehicleId}` : `Preview-Fallback: ${vehicleId}`);
    }

    function setSlotStates(states, clickHandler) {
        slotStates = Array.isArray(states) ? states.map((state) => ({ ...state })) : [];
        onSlotClick = typeof clickHandler === 'function' ? clickHandler : null;
        buildOverlay();
        syncMarkerVisuals();
        projectOverlay();
    }

    function setDragPreview(partId, slotId, valid) {
        slotStates.forEach((state) => { state.dropState = state.slotKey === slotId ? (valid ? 'valid' : 'invalid') : ''; });
        assembly.showGhost(partId, slotId, valid);
        const button = overlay?.querySelector?.(`[data-hangar-slot="${slotId}"]`);
        button?.classList.toggle('is-drop-target', valid);
        button?.classList.toggle('is-drop-invalid', !valid);
        syncMarkerVisuals();
    }

    function clearDragPreview() {
        slotStates.forEach((state) => { state.dropState = ''; });
        assembly.clearGhost();
        overlay?.querySelectorAll?.('.is-drop-target, .is-drop-invalid').forEach((node) => node.classList.remove('is-drop-target', 'is-drop-invalid'));
        syncMarkerVisuals();
    }

    initialize();

    return Object.freeze({
        getStatus: () => status,
        getBuild: () => activeBuild,
        setBuild,
        setSlotStates,
        setDragPreview,
        clearDragPreview,
        setSelectedSlot(slotId) {
            selectedSlotId = String(slotId || '');
            assembly.setSelectedSlot(selectedSlotId);
            syncMarkerVisuals();
        },
        setCameraPreset: (presetId) => cameraController?.setPreset(presetId),
        resetCamera: () => cameraController?.reset(),
        dispose() {
            if (disposed) return;
            disposed = true;
            if (rafId) window.cancelAnimationFrame(rafId);
            rafId = 0;
            if (cameraController?._cameraChange) cameraController.controls.removeEventListener('change', cameraController._cameraChange);
            cameraController?.dispose();
            cameraController = null;
            assembly.dispose();
            markerGeometry.dispose();
            markers.forEach((marker) => marker.material.dispose());
            platformGeometry.dispose();
            platformMaterial.dispose();
            grid.geometry.dispose();
            if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose());
            else grid.material.dispose();
            renderer?.dispose();
            renderer?.domElement?.remove();
            renderer = null;
            overlay?.replaceChildren();
            canvasHost.remove();
            statusLabel.remove();
            setStatus('disposed', '3D-Workshop beendet');
        },
    });
}
