import * as THREE from 'three';
import { CONFIG_SECTIONS } from '../../src/core/config/ConfigSections.js';
import { createEditorBuildMapSnapshot } from './EditorBuildMapSnapshot.js';
import { BUILD_SPEED_FACTORS, BUILD_PRECISION_KEYS, nudgeBuildPosition, createBuildPose, stepBuildPose, resolveBuildPosition } from './EditorBuildMotion.js';
import { pickBuildTarget, EditorBuildSelectionVisuals } from './EditorBuildPicking.js';
import { EditorBuildRuntime } from './EditorBuildRuntime.js';
import { EditorBuildPreview } from './EditorBuildPreview.js';
import { createEditorBuildMenu } from './ui/EditorBuildMenuControls.js';
import { shouldIgnoreGlobalShortcut } from './ui/EditorShortcutControls.js';

const MOVEMENT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);

export class EditorBuildModeController {
    constructor(editor) {
        this.editor = editor;
        this.core = editor.core;
        this.mode = 'edit';
        this.paused = false;
        this.firstPerson = false;
        this.speedIndex = 2;
        this.codes = new Set();
        this.pose = createBuildPose();
        this.position = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.offset = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.authoredRaycaster = new THREE.Raycaster();
        this.precisionStep = 1;
        this.selectionVisuals = new EditorBuildSelectionVisuals();
        this.target = null;
        this.pickElapsed = 1;
        this.lookX = 0; this.lookY = 0;
        this.units = 1;
        this.generation = 0;
        this.loading = false;
        this.pending = Promise.resolve();
        this.runtime = null;
        this.tearingDown = false;
        this.startQueued = false;
        this.disposed = false;
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'editor-build-runtime';
        this.canvas.style.cssText = 'position:absolute;inset:0;z-index:30;width:100%;height:100%;display:none';
        this.core.container.append(this.canvas);
        this.ui = createEditorBuildMenu(editor, {
            onMenuChange: (open) => { this.clearInput(); if (open) this.unlock(); else if (this.mode === 'build') this.lock(); },
            onPause: () => this.togglePause(), onTest: () => this.toggleTest(), onExit: () => this.stop(),
            onMove: () => this.moveSelection(), onCatalogChange: () => this.chooseCatalog(),
            getViewportBounds: () => this.canvas.getBoundingClientRect(),
            onPosition: (axis, value) => this.setBuildPosition(axis, value),
            onStep: (value) => { this.precisionStep = value; },
            onSnap: (value) => {
                this.editor.useSnap = value;
                if (this.editor.dom.chkSnap) {
                    this.editor.dom.chkSnap.checked = value;
                    this.editor.dom.chkSnap.dispatchEvent(new Event('change'));
                }
                this.setBuildPosition();
            },
        });
        this.preview = new EditorBuildPreview(editor, this.ui.getPropertiesHost());
        this.abort = new AbortController();
        const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler,
            { ...options, signal: this.abort.signal });
        listen(document, 'keydown', (event) => this.keyDown(event), { capture: true });
        listen(document, 'keyup', (event) => this.codes.delete(event.code));
        listen(window, 'blur', () => { this.clearInput(); this.runtime?.input?.clearInputState(); });
        listen(document, 'visibilitychange', () => {
            if (document.hidden) { this.clearInput(); this.runtime?.input?.clearInputState(); }
        });
        listen(document, 'mousemove', (event) => {
            if (this.mode !== 'build' || document.pointerLockElement !== this.canvas || this.ui.isMenuOpen()) return;
            this.lookX += event.movementX; this.lookY += event.movementY;
        });
        listen(document, 'pointerlockchange', () => { if (document.pointerLockElement !== this.canvas) this.clearInput(); });
        listen(this.canvas, 'pointerdown', (event) => {
            if (this.mode !== 'build' || this.ui.isMenuOpen()) return;
            event.preventDefault();
            if (event.button === 2) this.selectCrosshair();
            else this.lock();
        });
        listen(this.canvas, 'contextmenu', (event) => event.preventDefault());
        listen(this.canvas, 'wheel', (event) => {
            if (this.mode !== 'build' || this.ui.isMenuOpen()) return;
            event.preventDefault();
            this.speedIndex = THREE.MathUtils.clamp(this.speedIndex + (event.deltaY < 0 ? 1 : -1), 0, 4);
            this.syncStatus();
        }, { passive: false });
        listen(window, 'pagehide', () => this.dispose());
        listen(editor.dom.btnShipFlight, 'click', () => this.mode === 'edit' ? this.start() : this.stop());
        this.originalActivate = editor.activateBuildCatalogEntry;
        editor.activateBuildCatalogEntry = (id) => { this.originalActivate?.(id); this.chooseCatalog(); };
        editor.buildFlight = this;
    }

    clearInput() { this.codes.clear(); this.lookX = 0; this.lookY = 0; }
    unlock() { if (document.pointerLockElement === this.canvas) document.exitPointerLock?.(); }
    lock() {
        if (this.mode === 'edit' || this.ui.isMenuOpen()) return;
        document.activeElement?.blur?.();
        try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* Retry on canvas click. */ }
    }
    syncStatus() {
        this.ui.setStatus({ mode: this.mode === 'test' ? 'test' : 'Bauflug', paused: this.paused,
            speed: BUILD_SPEED_FACTORS[this.speedIndex], loading: this.loading && this.mode !== 'edit' });
        this.editor.dom.shipFlightSpeed.textContent = `Tempo ×${BUILD_SPEED_FACTORS[this.speedIndex]}`;
        document.body.dataset.editorMode = this.mode;
    }

    start() {
        if (this.disposed || this.mode !== 'edit' || !this.editor.mapManager) return;
        if (this.tearingDown) {
            if (!this.startQueued) {
                this.startQueued = true;
                this.pending.then(() => { this.startQueued = false; this.start(); });
            }
            return;
        }
        this.viewState = this.core.captureViewState();
        this.gameViewWasActive = this.editor.isGameViewActive?.() === true;
        if (this.gameViewWasActive) this.editor.disableGameView?.();
        if (this.editor.isDrawing) this.editor.cancelActiveDrawing?.();
        this.pose = createBuildPose(this.core.orbit.target, this.core.camera.quaternion);
        resolveBuildPosition(this.pose.position, this.editor.useSnap ? this.editor.snapSize : 0, this.position);
        this.firstPerson = false;
        this.core.shipFlightActive = true;
        this.core.orbit.enabled = false;
        this.core.transformControl.enabled = false;
        this.inertPanels = [...document.querySelectorAll('.wrap > .panel, .editorTopbar, .sceneToolbar')]
            .map((element) => ({ element, inert: element.inert }));
        this.inertPanels.forEach(({ element }) => { element.inert = true; });
        this.canvas.style.display = 'block';
        this.ui.setActive(true);
        this.editor.dom.shipFlightHud.hidden = false;
        this.editor.dom.shipFlightHud.style.zIndex = '40';
        this.editor.dom.btnShipFlight.setAttribute('aria-pressed', 'true');
        this.originalSceneChanged = this.editor.mapManager.callbacks.onSceneChanged;
        this.sceneChanged = (...args) => {
            this.originalSceneChanged?.(...args);
            if (this.mode === 'build') this.requestWorld(false);
        };
        this.editor.mapManager.callbacks.onSceneChanged = this.sceneChanged;
        this.core.externalRenderHook = (dt) => { this.frame(dt); return this.mode !== 'edit'; };
        this.chooseCatalog();
        this.requestWorld(false);
        this.lock();
    }

    requestWorld(test) {
        this.mode = test ? 'test' : 'build';
        this.loading = true;
        this.lastError = null;
        this.clearInput();
        this.preview.root.removeFromParent();
        this.selectionVisuals.clear(); this.target = null; this.ui.setTarget(null);
        const generation = ++this.generation;
        this.syncStatus();
        this.pending = this.pending.then(async () => {
            if (generation !== this.generation || this.mode === 'edit') return;
            const snapshot = createEditorBuildMapSnapshot(this.editor.mapManager.generateJSONExport(this.editor.getArenaSizeForExport()),
                { omitEditorId: test ? null : this.preview.movingId });
            this.units = snapshot.unitsPerWorldUnit;
            this.runtime ||= new EditorBuildRuntime(this.canvas, this.core.container);
            await this.runtime.load(snapshot, test);
            if (generation !== this.generation) return;
            this.selectionVisuals.bindWorld(this.runtime.renderer.matchRoot, this.editor.mapManager);
            this.selectionVisuals.bindRuntime(this.runtime, this.editor.mapManager);
            if (!test) this.runtime.renderer.matchRoot.add(this.preview.root, this.selectionVisuals.root);
            this.loading = false;
            this.syncStatus();
        }).catch((error) => {
            if (generation !== this.generation) return;
            this.lastError = error.message;
            this.editor.notify(`Bauflug konnte nicht geladen werden: ${error.message}`, 'error');
            this.stop();
        });
    }

    chooseCatalog() {
        if (this.mode === 'test') return;
        const wasMoving = !!this.preview.movingId;
        this.preview.chooseCatalog();
        this.ui.refresh();
        if (wasMoving && this.mode === 'build') this.requestWorld(false);
    }
    moveSelection() {
        if (this.mode !== 'build' || !this.preview.beginMove(this.editor.selectedObject)) return;
        this.pose.position.copy(this.editor.selectedObject.position);
        resolveBuildPosition(this.pose.position, this.editor.useSnap ? this.editor.snapSize : 0, this.position);
        this.requestWorld(false);
        this.ui.setMenuOpen(false);
        this.lock();
    }
    selectCrosshair() {
        if (this.loading) return;
        const target = this.pickCrosshair();
        if (target?.object && !target.locked) {
            this.editor.selectObject(target.object);
            this.editor.notify('Objekt ausgewählt. B → Auswahl bewegen.', 'info');
        }
    }
    pickCrosshair() {
        this.selectionVisuals.bindItems(this.runtime.powerups?.items || [], this.editor.mapManager);
        const camera = this.runtime.renderer.cameras[0];
        camera.updateMatrixWorld();
        this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
        return pickBuildTarget(this.raycaster, this.runtime.renderer.matchRoot, this.core.objectsContainer,
            this.editor.mapManager, this.units, this.preview.root, this.authoredRaycaster, this.selectionVisuals);
    }
    setBuildPosition(axis, value) {
        if (this.mode !== 'build' || this.loading) return;
        if (axis && Number.isFinite(value)) this.pose.position[axis] = value;
        resolveBuildPosition(this.pose.position, this.editor.useSnap ? this.editor.snapSize : 0, this.position);
        if (axis && Number.isFinite(value)) this.pose.position.copy(this.position);
        this.clearInput();
        this.preview.update(this.position, this.units);
        this.ui.setPosition(this.position, this.editor.useSnap, this.editor.snapSize, true);
    }
    togglePause() { if (this.mode === 'build') { this.paused = !this.paused; this.syncStatus(); } }
    toggleTest() {
        if (this.mode === 'edit') this.start();
        if (this.loading) return;
        this.ui.setMenuOpen(false);
        this.requestWorld(this.mode !== 'test');
        this.lock();
    }

    keyDown(event) {
        if (shouldIgnoreGlobalShortcut(event.target)) return;
        if (this.mode === 'edit') {
            if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.code === 'KeyG' || event.code === 'F6') {
                event.preventDefault(); this.start();
                if (event.code === 'F6') this.pending.then(() => { if (this.mode === 'build' && !this.loading) this.toggleTest(); });
            }
            return;
        }
        if (event.code === 'F6' && !event.repeat) {
            event.preventDefault(); event.stopImmediatePropagation(); this.toggleTest(); return;
        }
        if (this.mode === 'test') {
            if (event.code === 'Escape') { this.unlock(); this.runtime?.input?.clearInputState(); }
            return;
        }
        const actionCodes = ['KeyB', 'KeyC', 'KeyP', 'Enter', 'Escape', 'Delete', 'KeyZ', 'KeyY'];
        if (!MOVEMENT_CODES.has(event.code) && !BUILD_PRECISION_KEYS[event.code] && !actionCodes.includes(event.code) && !/^Digit[1-9]$/.test(event.code)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat) return;
        if (event.code === 'Escape') { this.chooseCatalog(); this.ui.setMenuOpen(false); this.unlock(); this.clearInput(); return; }
        if (event.code === 'KeyB') { this.ui.setMenuOpen(!this.ui.isMenuOpen()); return; }
        if (this.ui.isMenuOpen()) return;
        if (event.ctrlKey || event.metaKey) {
            if (event.code === 'KeyZ') event.shiftKey ? this.editor.redo() : this.editor.undo();
            if (event.code === 'KeyY') this.editor.redo();
            return;
        }
        if (event.code === 'KeyC') this.firstPerson = !this.firstPerson;
        else if (BUILD_PRECISION_KEYS[event.code]) {
            this.clearInput();
            nudgeBuildPosition(this.pose.position, event.code, this.precisionStep, this.editor.useSnap ? this.editor.snapSize : 0);
            this.setBuildPosition();
        }
        else if (event.code === 'KeyP') this.togglePause();
        else if (event.code === 'Enter' && !this.loading) {
            resolveBuildPosition(this.pose.position, this.editor.useSnap ? this.editor.snapSize : 0, this.position);
            this.preview.confirm(this.position);
        }
        else if (event.code === 'Delete') this.editor.deleteSelectedObject();
        else if (/^Digit[1-9]$/.test(event.code)) { this.ui.selectSlot(Number(event.code.slice(5)) - 1); this.chooseCatalog(); }
        else if (MOVEMENT_CODES.has(event.code)) this.codes.add(event.code);
    }

    frame(dt) {
        if (this.mode === 'edit' || this.loading || !this.runtime?.arena) return;
        this.runtime.tick(dt, this.paused);
        if (this.mode === 'build') {
            const enabled = !document.hidden && !this.ui.isMenuOpen() && document.pointerLockElement === this.canvas;
            const speed = stepBuildPose(this.pose, this.codes, { dt, speed: CONFIG_SECTIONS.PLAYER.SPEED * this.units * BUILD_SPEED_FACTORS[this.speedIndex],
                lookX: this.lookX, lookY: this.lookY, enabled });
            this.lookX = 0; this.lookY = 0;
            resolveBuildPosition(this.pose.position, this.editor.useSnap ? this.editor.snapSize : 0, this.position);
            this.preview.update(this.position, this.units);
            this.ui.setPosition(this.position, this.editor.useSnap, this.editor.snapSize);
            const renderer = this.runtime.renderer;
            renderer.cameraModes[0] = this.firstPerson ? 1 : 0;
            this.direction.set(0, 0, -1).applyQuaternion(this.pose.quaternion);
            this.offset.copy(this.pose.position).multiplyScalar(1 / this.units);
            renderer.updateCamera(0, this.offset, this.direction, dt, this.pose.quaternion, true, false,
                this.runtime.arena, this.offset, { playerState: { speed: speed / this.units } });
            const camera = renderer.cameras[0];
            const underwater = this.runtime.water?.isPositionUnderwater(camera.position) === true;
            renderer.setCameraWaterVisibility(0, underwater ? this.runtime.water.getEffects()?.visibilityMultiplier : 1);
            if (!this.firstPerson && this.preview.mesh) {
                const minimum = this.preview.getRadius() / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
                const distance = camera.position.distanceTo(this.offset);
                if (distance < minimum) {
                    if (distance > 0.001) this.direction.copy(camera.position).sub(this.offset).normalize();
                    else this.direction.set(0, 0, 1).applyQuaternion(this.pose.quaternion);
                    camera.position.copy(this.offset).addScaledVector(this.direction, minimum);
                    renderer.resolveCameraCollision(0, 'THIRD_PERSON', this.offset, camera.position, this.runtime.arena);
                    camera.lookAt(this.offset);
                }
            }
            this.preview.root.visible = !this.firstPerson;
            this.pickElapsed += dt;
            if (this.ui.isMenuOpen()) this.target = null;
            else if (this.pickElapsed >= 1 / 12) { this.target = this.pickCrosshair(); this.pickElapsed = 0; }
            this.ui.setTarget(this.target);
            this.selectionVisuals.show(this.selectionVisuals.hover, this.target, this.units);
            const selected = this.editor.selectedObject;
            this.selectionVisuals.show(this.selectionVisuals.selected,
                selected && selected.userData.id !== this.preview.movingId ? { object: selected,
                    visual: this.selectionVisuals.models.get(selected.userData.id) } : null, this.units);
        }
        this.runtime.renderer.render();
    }

    stop() {
        if (this.mode === 'edit') return;
        this.mode = 'edit'; ++this.generation;
        this.unlock(); this.clearInput();
        this.preview.root.removeFromParent();
        this.selectionVisuals.clear(); this.target = null; this.ui.setTarget(null);
        this.ui.setActive(false);
        this.canvas.style.display = 'none';
        this.editor.dom.shipFlightHud.hidden = true;
        this.editor.dom.btnShipFlight.setAttribute('aria-pressed', 'false');
        this.core.shipFlightActive = false;
        // Pending GLB work can still touch shared fog hooks. Restore before each editor frame
        // until it settles, while allowing the editor's single scheduler to render normally.
        const restorePresentation = () => { this.runtime?.presentationScope.restoreFog(); return false; };
        this.core.externalRenderHook = restorePresentation;
        restorePresentation();
        this.core.orbit.enabled = true;
        this.core.transformControl.enabled = true;
        this.inertPanels?.forEach(({ element, inert }) => { element.inert = inert; });
        this.core.restoreViewState(this.viewState);
        if (this.editor.mapManager.callbacks.onSceneChanged === this.sceneChanged) {
            this.editor.mapManager.callbacks.onSceneChanged = this.originalSceneChanged;
        }
        this.tearingDown = true;
        this.pending = this.pending.then(() => {
            this.runtime?.dispose(); this.runtime = null;
            if (this.core.externalRenderHook === restorePresentation) this.core.externalRenderHook = null;
            this.core.scene.traverse((object) => {
                for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                    if (material) material.needsUpdate = true;
                }
            });
            if (this.mode === 'edit' && this.gameViewWasActive) this.editor.enableGameView?.();
        }).finally(() => { this.tearingDown = false; });
        this.syncStatus();
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.stop(); this.abort.abort(); this.preview.dispose(); this.selectionVisuals.dispose(); this.ui.dispose(); this.canvas.remove();
        this.editor.activateBuildCatalogEntry = this.originalActivate;
    }
}
