import * as THREE from 'three';
import { CONFIG_SECTIONS } from '../../../src/core/config/ConfigSections.js';
import {
    SHIP_FLIGHT_SPEED_FACTORS,
    createShipFlightParams,
    createShipFlightState,
    resolveEditorUnitsPerWorldUnit,
    resolveShipFlightInput,
    stepShipFlight,
} from '../EditorShipFlight.js';
import { shouldIgnoreGlobalShortcut } from './EditorShortcutControls.js';

const START_FLIGHT_CODE = 'KeyG';
const CHASE_VIEW_CODE = CONFIG_SECTIONS.KEYS.PLAYER_1.CAMERA || 'KeyC';
const DEFAULT_SPEED_INDEX = SHIP_FLIGHT_SPEED_FACTORS.indexOf(1);
// Chase camera offset in hitbox radii: behind and slightly above the ship.
const CHASE_BACK_RADII = 9;
const CHASE_UP_RADII = 2.5;
// After landing the orbit target sits one second of flight ahead of the nose.
const LANDING_TARGET_SECONDS = 1;
const FLIGHT_CODES = new Set([
    ...Object.values(CONFIG_SECTIONS.KEYS.PLAYER_1),
    'ShiftLeft', 'ShiftRight', 'Space',
]);

function createShipMarker() {
    const marker = new THREE.Group();
    marker.name = 'editorShipFlightMarker';
    const hull = new THREE.ConeGeometry(0.55, 2.2, 12);
    hull.rotateX(-Math.PI / 2);
    marker.add(new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: 0x38bdf8 })));
    // The hitbox the match collides with, so a gap can be judged against the real size.
    marker.add(new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0.45 })
    ));
    marker.visible = false;
    return marker;
}

export function bindEditorShipFlightControls(editor) {
    const core = editor?.core;
    if (!core) return;
    const dom = editor.dom || {};
    const canvas = core.renderer.domElement;
    const pressedCodes = new Set();
    const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    const chaseOffset = new THREE.Vector3();
    const landingTarget = new THREE.Vector3();
    const marker = createShipMarker();
    core.scene.add(marker);

    let state = null;
    let params = null;
    let chaseView = false;
    let lockAcquired = false;
    let lookX = 0;
    let lookY = 0;
    let speedIndex = DEFAULT_SPEED_INDEX;

    const isActive = () => core.shipFlightActive === true;

    const syncSpeedLabel = () => {
        if (state) state.speedFactor = SHIP_FLIGHT_SPEED_FACTORS[speedIndex];
        if (dom.shipFlightSpeed) {
            dom.shipFlightSpeed.textContent = `Tempo ×${SHIP_FLIGHT_SPEED_FACTORS[speedIndex]}`;
        }
    };

    const placeCamera = () => {
        const camera = core.camera;
        camera.quaternion.copy(pose.quaternion);
        if (!chaseView) {
            camera.position.copy(pose.position);
            return;
        }
        const radius = params.hitboxRadius;
        chaseOffset.set(0, CHASE_UP_RADII * radius, CHASE_BACK_RADII * radius).applyQuaternion(pose.quaternion);
        camera.position.copy(pose.position).add(chaseOffset);
        marker.position.copy(pose.position);
        marker.quaternion.copy(pose.quaternion);
    };

    const stopShipFlight = () => {
        if (!isActive()) return false;
        core.shipFlightActive = false;
        pressedCodes.clear();
        lookX = 0;
        lookY = 0;
        marker.visible = false;

        // Land where the ship is: the orbit camera continues from the cockpit without the roll.
        const camera = core.camera;
        landingTarget.set(0, 0, -1).applyQuaternion(pose.quaternion)
            .multiplyScalar(Math.max(50, params.speed * LANDING_TARGET_SECONDS))
            .add(pose.position);
        camera.position.copy(pose.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(landingTarget);
        core.orbit.target.copy(landingTarget);
        core.orbit.enabled = true;
        core.transformControl.enabled = true;
        core.orbit.update();

        if (dom.shipFlightHud) dom.shipFlightHud.hidden = true;
        dom.btnShipFlight?.setAttribute('aria-pressed', 'false');
        document.body.dataset.editorShipFlight = '0';
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        lockAcquired = false;
        return true;
    };

    const requestMouseLock = () => {
        try {
            // Newer Chromium returns a promise that rejects when the lock is refused.
            const request = canvas.requestPointerLock?.();
            request?.catch?.(() => {});
        } catch {
            // Without the lock the ship still flies by keyboard; Escape lands it.
        }
    };

    const startShipFlight = () => {
        if (isActive()) return true;
        if (editor.isDrawing) editor.cancelActiveDrawing?.();
        if (core.viewMode !== 'perspective') core.setViewMode('perspective');

        params = createShipFlightParams({
            unitsPerWorldUnit: resolveEditorUnitsPerWorldUnit(editor.getArenaSizeForExport?.()),
        });
        state = createShipFlightState();
        syncSpeedLabel();
        marker.scale.setScalar(params.hitboxRadius);
        pose.position.copy(core.camera.position);
        pose.quaternion.copy(core.camera.quaternion);
        pressedCodes.clear();
        lookX = 0;
        lookY = 0;
        // A focused button would treat the hover key (Space) as a click.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

        core.shipFlightActive = true;
        core.orbit.enabled = false;
        core.transformControl.enabled = false;
        marker.visible = chaseView;
        if (dom.shipFlightHud) dom.shipFlightHud.hidden = false;
        dom.btnShipFlight?.setAttribute('aria-pressed', 'true');
        document.body.dataset.editorShipFlight = '1';
        requestMouseLock();
        return true;
    };

    core.setCameraFrameHook((dt) => {
        if (!isActive()) return false;
        // A view button can switch to an orthographic camera; flying needs the perspective one.
        if (core.viewMode !== 'perspective') {
            stopShipFlight();
            return false;
        }
        const input = resolveShipFlightInput(pressedCodes);
        input.lookX = lookX;
        input.lookY = lookY;
        lookX = 0;
        lookY = 0;
        stepShipFlight(state, pose, input, params, dt);
        placeCamera();
        return true;
    });

    document.addEventListener('keydown', (e) => {
        if (!isActive()) {
            if (e.code !== START_FLIGHT_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            if (shouldIgnoreGlobalShortcut(e.target)) return;
            e.preventDefault();
            startShipFlight();
            return;
        }
        if (e.code === 'Escape') {
            e.preventDefault();
            stopShipFlight();
            return;
        }
        if (e.code === CHASE_VIEW_CODE && !e.repeat) {
            chaseView = !chaseView;
            marker.visible = chaseView;
        }
        if (FLIGHT_CODES.has(e.code)) e.preventDefault();
        pressedCodes.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
        pressedCodes.delete(e.code);
    });
    // Released keys are not reported to a window without focus; drop them rather than keep steering.
    window.addEventListener('blur', () => pressedCodes.clear());

    document.addEventListener('mousemove', (e) => {
        if (!isActive() || document.pointerLockElement !== canvas) return;
        lookX += Number(e.movementX) || 0;
        lookY += Number(e.movementY) || 0;
    });
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            lockAcquired = true;
            return;
        }
        // Chromium handles the Escape that ends the lock itself; the page only sees the lock go.
        if (isActive() && lockAcquired) stopShipFlight();
    });
    document.addEventListener('pointerlockerror', () => {
        if (!isActive()) return;
        editor.notify?.('Maus nicht gefangen: Lenken per Tastatur, Klick ins Bild fängt sie erneut, Esc landet.', 'info');
    });

    core.container.addEventListener('pointerdown', (e) => {
        if (!isActive() || document.pointerLockElement === canvas) return;
        e.preventDefault();
        requestMouseLock();
    });
    core.container.addEventListener('wheel', (e) => {
        if (!isActive()) return;
        e.preventDefault();
        const step = e.deltaY < 0 ? 1 : -1;
        speedIndex = Math.max(0, Math.min(SHIP_FLIGHT_SPEED_FACTORS.length - 1, speedIndex + step));
        syncSpeedLabel();
    }, { passive: false });

    dom.btnShipFlight?.addEventListener('click', () => {
        if (isActive()) stopShipFlight();
        else startShipFlight();
    });

    editor.startShipFlight = startShipFlight;
    editor.stopShipFlight = stopShipFlight;
    editor.isShipFlightActive = isActive;
    editor.getShipFlightPose = () => ({
        position: pose.position.toArray(),
        quaternion: pose.quaternion.toArray(),
        chaseView,
        speedFactor: SHIP_FLIGHT_SPEED_FACTORS[speedIndex],
    });
    syncSpeedLabel();
}
