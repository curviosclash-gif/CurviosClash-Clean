import * as THREE from 'three';
import { VehicleLabCore } from './src/VehicleLabCore.js';
import { VehicleLabViewport } from './src/VehicleLabViewport.js';
import { VehicleLabUI } from './src/VehicleLabUI.js';
import { VehicleHistory } from './src/VehicleHistory.js';
import { ModularVehicleMesh } from './src/ModularVehicleMesh.js';
import { VEHICLE_PRESETS } from './src/VehiclePresets.js';
import { GameVehicleReferenceMesh } from './src/GameVehicleReferenceMesh.js';
import { listVehicleLabGameReferences } from './src/VehicleLabGameVehicleCatalog.js';
import {
    buildValidatedArcadeBlueprint,
    describeArcadeBlueprintStatus,
    formatArcadeBlueprintValidationMessage,
} from './src/ArcadeBlueprintValidation.js';
import { EDITOR_API_ROUTES } from '../../src/shared/contracts/EditorPathContract.js';
import {
    VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY,
    createVehicleLabHangarPublication,
    normalizeVehicleLabHangarPublicationRecord,
    upsertVehicleLabHangarPublication,
} from '../../src/shared/contracts/VehicleLabHangarPublishContract.js';
import {
    formatVehicleLabConfigIssues,
    normalizeVehicleLabConfig,
} from '../../src/shared/contracts/VehicleLabConfigContract.js';

const VEHICLE_LAB_CONFIG_STORAGE_KEY = 'vehicle_lab_config';
const GAME_VEHICLE_REFERENCES = listVehicleLabGameReferences();

function toBlueprintId(value) {
    return String(value || 'custom_blueprint')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_ -]/g, '')
        .replace(/\s+/g, '_') || 'custom_blueprint';
}

function cloneVehicleConfig(config) {
    return JSON.parse(JSON.stringify(config || {}));
}

function walkVehicleParts(parts, visit) {
    if (!Array.isArray(parts)) return;
    parts.forEach((part) => {
        if (!part || typeof part !== 'object') return;
        visit(part);
        walkVehicleParts(part.children, visit);
    });
}

function summarizeVehicleConfig(config = {}) {
    const summary = {
        parts: 0,
        engines: 0,
        wings: 0,
        animated: 0,
    };

    walkVehicleParts(config.parts, (part) => {
        summary.parts += 1;
        const name = String(part.name || '').toLowerCase();
        const geo = String(part.geo || '').toLowerCase();
        if (geo === 'engine' || name.includes('engine')) summary.engines += 1;
        if (name.includes('wing') || name.includes('fin')) summary.wings += 1;
        if (part.anim && part.anim.type && part.anim.type !== 'none') summary.animated += 1;
    });

    return summary;
}

function createCompareRows(currentConfig, baselineConfig) {
    const current = summarizeVehicleConfig(currentConfig);
    const baseline = summarizeVehicleConfig(baselineConfig);
    const currentBlueprint = buildValidatedArcadeBlueprint(currentConfig, { label: currentConfig?.label }).blueprint;
    const baselineBlueprint = buildValidatedArcadeBlueprint(baselineConfig, { label: baselineConfig?.label }).blueprint;
    const countRows = [
        { key: 'parts', label: 'Bauteile' },
        { key: 'engines', label: 'Antriebe' },
        { key: 'wings', label: 'Flügel/Finnen' },
        { key: 'animated', label: 'Animiert' },
    ].map((metric) => ({
        ...metric,
        current: current[metric.key],
        baseline: baseline[metric.key],
        delta: current[metric.key] - baseline[metric.key],
    }));
    const statRows = [
        { key: 'budgetUsed', label: 'Budget' },
        { key: 'massUsed', label: 'Masse' },
        { key: 'powerUsed', label: 'Energie' },
        { key: 'heatUsed', label: 'Hitze' },
    ].map((metric) => {
        const currentValue = Number(currentBlueprint?.stats?.[metric.key]) || 0;
        const baselineValue = Number(baselineBlueprint?.stats?.[metric.key]) || 0;
        return {
            ...metric,
            current: currentValue,
            baseline: baselineValue,
            delta: Number((currentValue - baselineValue).toFixed(3)),
        };
    });
    return [...countRows, ...statRows];
}

class VehicleLabApp {
    constructor() {
        this.canvas = document.getElementById('vehicleCanvas');
        this.core = new VehicleLabCore(this.canvas);

        const saved = localStorage.getItem(VEHICLE_LAB_CONFIG_STORAGE_KEY);
        let initialConfig = null;
        try {
            if (saved) {
                const parsed = JSON.parse(saved);
                const normalized = normalizeVehicleLabConfig(parsed, { requireParts: true });
                if (normalized.ok) initialConfig = normalized.config;
            }
        } catch (e) {
            console.warn('Vehicle Lab: Invalid JSON in local storage, falling back to default.');
        }

        if (!initialConfig || !Array.isArray(initialConfig.parts) || initialConfig.parts.length === 0) {
            initialConfig = JSON.parse(JSON.stringify(VEHICLE_PRESETS[0]));
        }

        this.history = new VehicleHistory(initialConfig);
        this._saveTimeout = null;
        this.viewport = new VehicleLabViewport(this.core, (idx, path) => this.selectPart(idx, path));
        this.ui = new VehicleLabUI({
            onLoadPreset: (vehicleId) => this.loadPreset(vehicleId),
            onImportJson: () => this.importJson(),
            onExportJson: () => this.exportJson(),
            onSaveToGame: () => this.saveToGame(),
            onRefreshSavedVehicles: () => this.refreshSavedVehiclesList(),
            onLoadSavedVehicle: (vehicle) => this.loadSavedVehicle(vehicle),
            onRenameSavedVehicle: (vehicle) => this.renameSavedVehicle(vehicle),
            onDeleteSavedVehicle: (vehicle) => this.deleteSavedVehicle(vehicle),
            onAddPart: () => this.addPart(),
            onAddChild: () => this.addChild(),
            onDeletePart: () => this.deletePart(),
            onDuplicatePart: () => this.duplicatePart(),
            onMirrorPart: () => this.toggleMirrorPart(),
            onPartSearchChange: () => this.updateUI(),
            onSnapChange: (settings) => this.applySnapSettings(settings),
            onCameraView: (view) => this.viewport.setCameraView(view, this.vehicle),
            onFlyModeChange: (val) => { this.viewport.isFlyMode = val; },
            onWireframeChange: (val) => { this.vehicle?.setWireframe?.(val); },
            onHitboxChange: (val) => { this.viewport.setHitboxVisible(val); },
            onUndo: () => this.undo(),
            onRedo: () => this.redo(),
            onCompareVehicleChange: (vehicleId) => this.setCompareVehicle(vehicleId),
            onGlobalUpdate: (type, val) => this.onGlobalUpdate(type, val)
        });
        this.vehicle = new ModularVehicleMesh(initialConfig);
        this.activeReferenceVehicle = null;
        if (this.vehicle.children.length === 0) {
            console.warn('Vehicle Lab: Loaded config generated empty mesh. Forcing default preset.');
            initialConfig = JSON.parse(JSON.stringify(VEHICLE_PRESETS[0]));
            this.vehicle = new ModularVehicleMesh(initialConfig);
            localStorage.setItem(VEHICLE_LAB_CONFIG_STORAGE_KEY, JSON.stringify(initialConfig));
        }
        this.core.scene.add(this.vehicle);
        this.viewport.setCameraView('fit', this.vehicle);

        this.selectedIndex = null;
        this.selectedPath = [];
        this.savedVehicles = [];
        this.compareVehicleId = VEHICLE_PRESETS[1]?.id || VEHICLE_PRESETS[0]?.id || '';
        this.statusMessage = 'Bereit';
        this.statusTone = 'info';
        this.arcadeBlueprintStatus = 'Blueprint: n/a';
        this.lastArcadeBlueprintResult = null;
        this._hudDirty = true;
        this._lastHudText = '';
        this._animationFrameId = null;
        this._disposed = false;
        this.updateArcadeBlueprintStatus();
        this.initPresets();
        this.updateUI();
        this.updateSavedVehiclesUi('');
        this.refreshSavedVehiclesList();
        this.applySnapSettings(this.ui.getSnapSettings());
        this.animate();

        // Global Shortcuts
        this.onGlobalShortcut = (e) => {
            if (this.core.isEditingTarget(e.target)) return;
            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    this.undo();
                } else if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    this.redo();
                }
            }
        };
        window.addEventListener('keydown', this.onGlobalShortcut);
        this.onBeforeUnload = () => this.dispose();
        window.addEventListener('beforeunload', this.onBeforeUnload, { once: true });

        // Listen for viewport changes (Gizmo)
        this.viewport.onChanged = () => {
            if (this.selectedIndex === null) return;
            this.syncGizmoToConfig();
            this.updateArcadeBlueprintStatus();
            this.persistCurrentConfig('Gizmo-Aenderung gespeichert.');
            this.markSceneMetricsDirty();
            const part = this.resolveSelectedPart();
            if (part) {
                this.ui.showProperties(part, (type) => this.onPropUpdate(type));
            }
        };

    }

    initPresets() {
        const select = document.getElementById('presetSelect');
        const labGroup = document.createElement('optgroup');
        labGroup.label = 'Bearbeitbare Lab-Vorlagen';
        VEHICLE_PRESETS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            labGroup.appendChild(opt);
        });
        select.appendChild(labGroup);

        const gameGroup = document.createElement('optgroup');
        gameGroup.label = 'Spiel-Flieger (schreibgeschützt)';
        GAME_VEHICLE_REFERENCES.forEach((vehicle) => {
            const opt = document.createElement('option');
            opt.value = vehicle.id;
            opt.textContent = vehicle.label;
            gameGroup.appendChild(opt);
        });
        select.appendChild(gameGroup);
        this.ui.setPresetSelection(this.vehicle?.config?.id);
    }

    getStandardReadonlyVehicles() {
        return [...VEHICLE_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label || preset.id,
            readOnly: true
        })), ...GAME_VEHICLE_REFERENCES];
    }

    getCompareCandidates() {
        return VEHICLE_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label || preset.id,
        }));
    }

    resolveComparePreset() {
        return VEHICLE_PRESETS.find((preset) => preset.id === this.compareVehicleId) || VEHICLE_PRESETS[0] || {};
    }

    setCompareVehicle(vehicleId) {
        const normalizedVehicleId = String(vehicleId || '').trim();
        const candidate = VEHICLE_PRESETS.find((preset) => preset.id === normalizedVehicleId);
        if (!candidate) return;
        this.compareVehicleId = candidate.id;
        this.setStatus(`Vergleich: ${candidate.label || candidate.id}`, 'info');
        this.updateUI();
    }

    getSelectedPartLabel() {
        if (this.selectedIndex === null) return '';
        let part = this.vehicle?.config?.parts?.[this.selectedIndex] || null;
        if (part && this.selectedPath && this.selectedPath.length > 0) {
            this.selectedPath.forEach((pathIndex) => {
                if (part && Array.isArray(part.children)) part = part.children[pathIndex];
            });
        }
        return part?.name ? `Auswahl: ${part.name}` : '';
    }

    setStatus(message, tone = 'info') {
        this.statusMessage = String(message || 'Bereit');
        this.statusTone = String(tone || 'info');
        this.updateStatusBar();
    }

    updateStatusBar() {
        if (!this.ui || !this.history) return;
        this.ui.updateHistoryControls(this.history.getState());
        this.ui.updateStatusBar({
            message: this.statusMessage,
            tone: this.statusTone,
            historyState: this.history.getState(),
            blueprintStatus: this.arcadeBlueprintStatus,
            selectedLabel: this.getSelectedPartLabel(),
        });
    }

    persistCurrentConfig(statusMessage = 'Änderungen lokal gespeichert.') {
        if (this.activeReferenceVehicle) return;
        try {
            this.history.save(this.vehicle.config);
            localStorage.setItem(VEHICLE_LAB_CONFIG_STORAGE_KEY, JSON.stringify(this.vehicle.config));
            this.ui.updateSaveState('saved', 'Lokal gespeichert');
            this.setStatus(statusMessage, 'success');
        } catch (error) {
            this.ui.updateSaveState('error', 'Speichern fehlgeschlagen');
            this.setStatus(`Lokales Speichern fehlgeschlagen: ${error.message}`, 'error');
        }
    }

    flushPendingSave() {
        if (!this._saveTimeout) return;
        clearTimeout(this._saveTimeout);
        this._saveTimeout = null;
        this.persistCurrentConfig('Änderungen lokal gespeichert.');
    }

    applyVehicleConfigToEditor(config) {
        const normalized = normalizeVehicleLabConfig(config, { requireParts: true });
        if (!normalized.ok) throw new Error(formatVehicleLabConfigIssues(normalized));
        const cloned = cloneVehicleConfig(normalized.config);
        this.replaceVehicle(new ModularVehicleMesh(cloned));
        this.activeReferenceVehicle = null;
        this.viewport.setCameraView('fit', this.vehicle);
        this.ui.setActiveCameraView('fit');
        this.ui.setPresetSelection(cloned.id);
        this.markSceneMetricsDirty();
        this.updateArcadeBlueprintStatus();
        this.persistCurrentConfig('Fahrzeug geladen.');
        this.selectPart(null);
        this.updateUI();
        if (normalized.warnings.length > 0) this.ui.showToast(normalized.warnings.join(' '), 'warning');
    }

    replaceVehicle(nextVehicle) {
        this.viewport.attach(null);
        if (this.vehicle) {
            this.core.scene.remove(this.vehicle);
            this.vehicle.dispose?.();
        }
        this.vehicle = nextVehicle;
        this.core.scene.add(nextVehicle);
        this.markSceneMetricsDirty();
    }

    async loadGameVehicleReference(vehicle) {
        this.flushPendingSave();
        this.selectPart(null);
        const reference = new GameVehicleReferenceMesh(vehicle);
        this.replaceVehicle(reference);
        this.activeReferenceVehicle = vehicle;
        this.ui.setPresetSelection(vehicle.id);
        this.viewport.setCameraView('fit', reference);
        this.ui.setActiveCameraView('fit');
        this.updateArcadeBlueprintStatus();
        this.setStatus(`${vehicle.label} wird geladen …`, 'info');
        this.updateUI();

        await reference.ready;
        if (this.vehicle !== reference || this._disposed) return;
        this.viewport.setCameraView('fit', reference);
        this.markSceneMetricsDirty();
        this.setStatus(`Spielmodell geladen: ${vehicle.label} (schreibgeschützt).`, 'success');
        this.updateUI();
    }

    updateSavedVehiclesUi(errorMessage = '') {
        this.ui.updateSavedVehicleLists({
            standardVehicles: this.getStandardReadonlyVehicles(),
            customVehicles: this.savedVehicles,
            errorMessage
        });
    }

    async refreshSavedVehiclesList() {
        try {
            const response = await fetch(EDITOR_API_ROUTES.LIST_VEHICLES_DISK, { method: 'GET' });
            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            this.savedVehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
            this.updateSavedVehiclesUi('');
        } catch (error) {
            this.savedVehicles = [];
            this.updateSavedVehiclesUi(error.message || 'Liste konnte nicht geladen werden');
        }
    }

    async loadSavedVehicle(vehicle) {
        const vehicleId = String(vehicle?.id || '').trim();
        if (!vehicleId) return;

        if (vehicle.readOnly) {
            const preset = VEHICLE_PRESETS.find(p => p.id === vehicleId);
            if (preset) {
                this.applyVehicleConfigToEditor(preset);
                return;
            }
            const gameReference = GAME_VEHICLE_REFERENCES.find((entry) => entry.id === vehicleId);
            if (gameReference) {
                await this.loadGameVehicleReference(gameReference);
                return;
            }
        }

        try {
            const query = new URLSearchParams({ vehicleId });
            const response = await fetch(`${EDITOR_API_ROUTES.GET_VEHICLE_DISK}?${query.toString()}`, { method: 'GET' });
            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            this.applyVehicleConfigToEditor(payload.config);
        } catch (error) {
            this.ui.showToast(`Fahrzeug konnte nicht geladen werden: ${error.message}`, 'error');
        }
    }

    loadPreset(vehicleId) {
        const id = String(vehicleId || document.getElementById('presetSelect').value || '');
        const preset = VEHICLE_PRESETS.find(p => p.id === id);
        if (preset) {
            this.applyVehicleConfigToEditor(preset);
            return;
        }
        const gameReference = GAME_VEHICLE_REFERENCES.find((vehicle) => vehicle.id === id);
        if (gameReference) this.loadGameVehicleReference(gameReference);
    }


    selectPart(index, path = []) {
        if (this.activeReferenceVehicle && index !== null) return;
        this.selectedIndex = index;
        this.selectedPath = path;
        this.vehicle.setSelectedSelection?.(index, path);
        this.updateUI();

        if (index !== null) {
            this.refreshGizmoAttachment();
        } else {
            this.viewport.attach(null);
            this.ui.hideProperties();
        }
    }

    onPropUpdate(type) {
        const rebuildTypes = new Set(['geo', 'size', 'material', 'color', 'emissive', 'mirror', 'anim']);
        if (rebuildTypes.has(type)) {
            this.rebuildVehicle();
        } else {
            const part = this.resolveSelectedPart();
            const object = this.findSelectedObject();
            if (part && object) this.vehicle.updatePartTransform(object, part);
        }
        this.updateArcadeBlueprintStatus();
        this.markSceneMetricsDirty();
        this.setStatus(type === 'add' ? 'Bauteil hinzugefügt.' : 'Änderungen ausstehend.', 'warning');
        this.ui.updateSaveState('dirty', 'Ungespeicherte Änderungen');
        this.debouncedSave();
        this.updateUI();
    }

    debouncedSave() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            this._saveTimeout = null;
            this.updateArcadeBlueprintStatus();
            this.persistCurrentConfig('Änderungen lokal gespeichert.');
            this.updateUI();
        }, 180);
    }

    onGlobalUpdate(type, val) {
        if (type === 'label') {
            this.vehicle.config.label = val;
        } else if (type === 'color') {
            this.vehicle.config.primaryColor = parseInt(val.replace('#', ''), 16);
            this.vehicle.initMaterials(this.vehicle.config);
            this.rebuildVehicle();
        }
        this.updateArcadeBlueprintStatus();
        this.ui.updateSaveState('dirty', 'Ungespeicherte Änderungen');
        this.debouncedSave();
        this.updateUI();
    }

    resolveSelectedPart() {
        if (this.selectedIndex === null) return null;
        let part = this.vehicle?.config?.parts?.[this.selectedIndex] || null;
        for (const pathIndex of this.selectedPath || []) {
            part = Array.isArray(part?.children) ? part.children[pathIndex] : null;
            if (!part) return null;
        }
        return part;
    }

    findSelectedObject() {
        const targetPart = this.resolveSelectedPart();
        if (!targetPart) return null;
        let foundMesh = null;
        this.vehicle.traverse((node) => {
            if (!foundMesh && node.userData.config === targetPart && !node.userData.isMirror) foundMesh = node;
        });
        return foundMesh;
    }

    rebuildVehicle() {
        this.viewport.attach(null);
        this.vehicle.build();
        this.vehicle.setSelectedSelection(this.selectedIndex, this.selectedPath);
        this.refreshGizmoAttachment();
        this.markSceneMetricsDirty();
    }

    markSceneMetricsDirty() {
        this._hudDirty = true;
        this.viewport?.requestHitboxUpdate();
    }

    applySnapSettings(settings = {}) {
        this.snapSettings = settings;
        this.viewport.setSnapping(settings.enabled, settings.translate, settings.rotate, settings.scale);
    }

    updateArcadeBlueprintStatus(labelOverride = '') {
        if (this.activeReferenceVehicle) {
            this.lastArcadeBlueprintResult = null;
            this.arcadeBlueprintStatus = 'Spielmodell-Referenz · schreibgeschützt · keine modulare Veröffentlichung';
            return null;
        }
        const config = this.vehicle?.config || {};
        const resolvedLabel = String(labelOverride || config.label || 'Custom Vehicle').trim() || 'Custom Vehicle';
        const result = buildValidatedArcadeBlueprint(config, {
            blueprintId: toBlueprintId(resolvedLabel),
            label: resolvedLabel,
            source: 'vehicle-lab',
        });
        this.lastArcadeBlueprintResult = result;
        this.arcadeBlueprintStatus = describeArcadeBlueprintStatus(result);
        return result;
    }

    refreshGizmoAttachment() {
        if (this.selectedIndex === null) return;
        const foundMesh = this.findSelectedObject();
        if (foundMesh) {
            this.viewport.attach(foundMesh);
        } else {
            this.viewport.attach(null);
        }
    }

    syncGizmoToConfig() {
        if (this.selectedIndex === null) return;
        const obj = this.viewport.gizmo.object;
        if (!obj) return;

        const part = this.resolveSelectedPart();
        if (!part) return;
        const currentPos = Array.isArray(part.pos) ? part.pos : [0, 0, 0];
        const currentRot = Array.isArray(part.rot) ? part.rot : [0, 0, 0];
        const currentScale = Array.isArray(part.scale) ? part.scale : [1, 1, 1];

        part.pos = [
            Number.isFinite(obj.position.x) ? obj.position.x : currentPos[0],
            Number.isFinite(obj.position.y) ? obj.position.y : currentPos[1],
            Number.isFinite(obj.position.z) ? obj.position.z : currentPos[2]
        ];
        part.rot = [
            Number.isFinite(obj.rotation.x) ? THREE.MathUtils.radToDeg(obj.rotation.x) : currentRot[0],
            Number.isFinite(obj.rotation.y) ? THREE.MathUtils.radToDeg(obj.rotation.y) : currentRot[1],
            Number.isFinite(obj.rotation.z) ? THREE.MathUtils.radToDeg(obj.rotation.z) : currentRot[2]
        ];
        part.scale = [
            Number.isFinite(obj.scale.x) ? obj.scale.x : currentScale[0],
            Number.isFinite(obj.scale.y) ? obj.scale.y : currentScale[1],
            Number.isFinite(obj.scale.z) ? obj.scale.z : currentScale[2]
        ];

    }

    addPart() {
        if (this.activeReferenceVehicle) return;
        const newPart = { name: 'New Part', geo: 'box', size: [1, 1, 1], pos: [0, 1, 0], rot: [0, 0, 0], material: 'primary' };
        this.vehicle.config.parts.push(newPart);
        this.rebuildVehicle();
        this.selectPart(this.vehicle.config.parts.length - 1, []);
        this.onPropUpdate('add');
    }

    addChild() {
        if (this.selectedIndex === null) return;
        let part = this.vehicle.config.parts[this.selectedIndex];
        if (this.selectedPath && this.selectedPath.length > 0) {
            this.selectedPath.forEach(pIdx => {
                if (part.children) part = part.children[pIdx];
            });
        }
        if (!part.children) part.children = [];
        const newChild = { name: 'Child Part', geo: 'sphere', size: [0.5, 0.5, 0.5], pos: [0, 1, 0], rot: [0, 0, 0], material: 'secondary' };
        part.children.push(newChild);
        this.rebuildVehicle();
        this.selectPart(this.selectedIndex, [...this.selectedPath, part.children.length - 1]);
        this.onPropUpdate('add');
    }

    deletePart() {
        if (this.selectedIndex !== null) {
            if (this.selectedPath && this.selectedPath.length > 0) {
                // Delete nested child
                let parent = this.vehicle.config.parts[this.selectedIndex];
                for (let i = 0; i < this.selectedPath.length - 1; i++) {
                    parent = parent.children[this.selectedPath[i]];
                }
                const leafIndex = this.selectedPath[this.selectedPath.length - 1];
                parent.children.splice(leafIndex, 1);

                // Select the parent of the deleted child
                const newPath = [...this.selectedPath];
                newPath.pop();
                this.selectPart(this.selectedIndex, newPath);
            } else {
                // Delete root part
                this.vehicle.config.parts.splice(this.selectedIndex, 1);
                this.selectPart(null);
            }

            this.rebuildVehicle();
            this.updateArcadeBlueprintStatus();
            this.persistCurrentConfig('Bauteil gelöscht.');
            this.updateUI();
        }
    }

    duplicatePart() {
        const part = this.resolveSelectedPart();
        if (!part) return;
        const copy = cloneVehicleConfig(part);
        copy.name = `${part.name || 'Part'} Kopie`;
        copy.pos = [...(copy.pos || [0, 0, 0])];
        copy.pos[0] += this.snapSettings?.translate || 0.25;

        if (this.selectedPath.length === 0) {
            const insertIndex = this.selectedIndex + 1;
            this.vehicle.config.parts.splice(insertIndex, 0, copy);
            this.rebuildVehicle();
            this.selectPart(insertIndex, []);
        } else {
            let parent = this.vehicle.config.parts[this.selectedIndex];
            for (let index = 0; index < this.selectedPath.length - 1; index++) {
                parent = parent.children[this.selectedPath[index]];
            }
            const leafIndex = this.selectedPath[this.selectedPath.length - 1];
            parent.children.splice(leafIndex + 1, 0, copy);
            const newPath = [...this.selectedPath];
            newPath[newPath.length - 1] = leafIndex + 1;
            this.rebuildVehicle();
            this.selectPart(this.selectedIndex, newPath);
        }
        this.persistCurrentConfig('Bauteil dupliziert.');
        this.updateUI();
    }

    toggleMirrorPart() {
        const part = this.resolveSelectedPart();
        if (!part) return;
        const axes = [null, 'x', 'y', 'z'];
        const currentIndex = axes.indexOf(part.mirrorAxis || null);
        const nextAxis = axes[(currentIndex + 1) % axes.length];
        if (nextAxis) part.mirrorAxis = nextAxis;
        else delete part.mirrorAxis;
        this.rebuildVehicle();
        this.persistCurrentConfig(nextAxis ? `Spiegelung ${nextAxis.toUpperCase()} aktiviert.` : 'Spiegelung deaktiviert.');
        this.updateUI();
    }

    updateUI() {
        this.ui.updatePartsList(
            this.vehicle.config.parts,
            this.selectedIndex,
            this.selectedPath,
            (i, path) => this.selectPart(i, path)
        );
        this.ui.updateShipInfo(this.vehicle.config);
        this.ui.updateComparePanel({
            candidates: this.getCompareCandidates(),
            selectedId: this.compareVehicleId,
            rows: createCompareRows(this.vehicle.config, this.resolveComparePreset()),
        });
        this.updateStatusBar();
        this.ui.setReferenceMode(!!this.activeReferenceVehicle, this.activeReferenceVehicle?.label || '');

        if (this.selectedIndex !== null) {
            let part = this.vehicle.config.parts[this.selectedIndex];
            if (this.selectedPath && this.selectedPath.length > 0) {
                this.selectedPath.forEach(pIdx => {
                    if (part && part.children) part = part.children[pIdx];
                });
            }
            if (part) this.ui.showProperties(part, (type) => this.onPropUpdate(type));
        }
    }

    importJson() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                this.ui.showToast('Import fehlgeschlagen: Die JSON-Datei darf höchstens 2 MB groß sein.', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const config = JSON.parse(re.target.result);
                    this.applyVehicleConfigToEditor(config);
                } catch (err) {
                    this.ui.showToast(`Import fehlgeschlagen: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    exportJson() {
        if (this.activeReferenceVehicle) return;
        const data = JSON.stringify(this.vehicle.config, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.vehicle.config.label || 'ship'}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ui.showToast('JSON exportiert.', 'success');
    }

    async saveToGame() {
        const suggested = String(this.vehicle?.config?.label || 'Custom Vehicle').trim() || 'Custom Vehicle';
        this.flushPendingSave();
        const requestedName = await this.ui.requestDialog({
            title: 'Im Spiel veröffentlichen',
            message: 'Ein identischer Name aktualisiert den bestehenden Eintrag.',
            inputLabel: 'Fahrzeugname',
            inputValue: suggested,
            confirmLabel: 'Veröffentlichen',
        });
        if (requestedName === null) return;

        const vehicleName = requestedName.trim();
        if (!vehicleName) {
            this.ui.showToast('Bitte einen gültigen Fahrzeugnamen eingeben.', 'error');
            return;
        }

        const guardResult = this.updateArcadeBlueprintStatus(vehicleName);
        if (!guardResult.validation.ok) {
            this.ui.showToast(`Blueprint ungültig: ${formatArcadeBlueprintValidationMessage(guardResult)}`, 'error');
            return;
        }

        try {
            const response = await fetch(EDITOR_API_ROUTES.SAVE_VEHICLE_DISK, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonText: JSON.stringify(this.vehicle.config),
                    vehicleName,
                    arcadeBlueprint: guardResult.blueprint,
                })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            const saveMode = payload.overwritten ? 'aktualisiert' : 'neu gespeichert';
            const publication = createVehicleLabHangarPublication(this.vehicle.config, { vehicleId: payload.vehicleId });
            let currentPublicationRecord = null;
            try {
                currentPublicationRecord = JSON.parse(localStorage.getItem(VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY) || 'null');
            } catch { currentPublicationRecord = null; }
            currentPublicationRecord = normalizeVehicleLabHangarPublicationRecord(currentPublicationRecord);
            localStorage.setItem(
                VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY,
                JSON.stringify(upsertVehicleLabHangarPublication(currentPublicationRecord, publication))
            );
            this.ui.showToast(`Fahrzeug ${saveMode}; ${publication.parts.length} Bauteile im Hangar veröffentlicht.`, 'success');
            this.setStatus(`${payload.vehicleLabel} veröffentlicht – Spielseite zum Aktualisieren neu laden.`, 'success');
            this.ui.updateSaveState('saved', 'Im Spiel veröffentlicht');
            this.refreshSavedVehiclesList();
        } catch (error) {
            this.ui.showToast(`Veröffentlichen fehlgeschlagen: ${error.message}`, 'error');
            this.setStatus('Vehicle Lab muss über den lokalen Desktop-Entwicklungsserver laufen.', 'error');
        }
    }

    async renameSavedVehicle(vehicle) {
        const vehicleId = String(vehicle?.id || '').trim();
        const currentLabel = String(vehicle?.label || vehicleId || '').trim();
        if (!vehicleId) return;

        const requestedName = await this.ui.requestDialog({
            title: 'Fahrzeug umbenennen',
            message: `Gespeichertes Fahrzeug: ${currentLabel}`,
            inputLabel: 'Neuer Name',
            inputValue: currentLabel || 'Custom Vehicle',
            confirmLabel: 'Umbenennen',
        });
        if (requestedName === null) return;

        const vehicleName = requestedName.trim();
        if (!vehicleName) {
            this.ui.showToast('Bitte einen gültigen Fahrzeugnamen eingeben.', 'error');
            return;
        }

        try {
            const response = await fetch(EDITOR_API_ROUTES.RENAME_VEHICLE_DISK, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vehicleId,
                    vehicleName
                })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            this.ui.showToast(`${payload.vehicleLabel} wurde umbenannt.`, 'success');
            this.refreshSavedVehiclesList();
        } catch (error) {
            this.ui.showToast(`Umbenennen fehlgeschlagen: ${error.message}`, 'error');
        }
    }

    async deleteSavedVehicle(vehicle) {
        const vehicleId = String(vehicle?.id || '').trim();
        const currentLabel = String(vehicle?.label || vehicleId || '').trim();
        if (!vehicleId) return;

        const confirmed = await this.ui.requestDialog({
            title: 'Fahrzeug löschen',
            message: `${currentLabel} (${vehicleId}) wird dauerhaft entfernt.`,
            confirmLabel: 'Löschen',
            danger: true,
        });
        if (!confirmed) return;

        try {
            const response = await fetch(EDITOR_API_ROUTES.DELETE_VEHICLE_DISK, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vehicleId
                })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }

            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            this.ui.showToast(`Fahrzeug gelöscht: ${currentLabel}`, 'success');
            this.refreshSavedVehiclesList();
        } catch (error) {
            this.ui.showToast(`Löschen fehlgeschlagen: ${error.message}`, 'error');
        }
    }

    undo() {
        if (this.activeReferenceVehicle) return;
        this.flushPendingSave();
        const config = this.history.undo();
        if (config) {
            this.vehicle.updateConfig(config);
            this.markSceneMetricsDirty();
            this.updateArcadeBlueprintStatus();
            localStorage.setItem(VEHICLE_LAB_CONFIG_STORAGE_KEY, JSON.stringify(config));
            this.ui.updateSaveState('saved', 'Lokal gespeichert');
            this.setStatus('Undo angewendet.', 'info');
            this.selectPart(null);
            this.updateUI();
        } else {
            this.setStatus('Keine Undo-Schritte verfuegbar.', 'warning');
        }
    }

    redo() {
        if (this.activeReferenceVehicle) return;
        this.flushPendingSave();
        const config = this.history.redo();
        if (config) {
            this.vehicle.updateConfig(config);
            this.markSceneMetricsDirty();
            this.updateArcadeBlueprintStatus();
            localStorage.setItem(VEHICLE_LAB_CONFIG_STORAGE_KEY, JSON.stringify(config));
            this.ui.updateSaveState('saved', 'Lokal gespeichert');
            this.setStatus('Redo angewendet.', 'info');
            this.selectPart(null);
            this.updateUI();
        } else {
            this.setStatus('Keine Redo-Schritte verfuegbar.', 'warning');
        }
    }

    animate() {
        if (this._disposed) return;
        this._animationFrameId = requestAnimationFrame(() => this.animate());
        const dt = this.core.clock?.getDelta() || 0.016;
        const time = this.core.clock?.getElapsedTime() || performance.now() / 1000;

        if (this.viewport) this.viewport.update(dt);

        if (this.vehicle) {
            this.vehicle.tick?.(dt, time);
            const autoRotate = document.getElementById('chkAutoRotate');
            if (autoRotate && autoRotate.checked) {
                this.vehicle.rotation.y += 0.5 * dt;
            }
            if (this.viewport) {
                this.viewport.updateHitboxIfNeeded(this.vehicle);
                this.handlePartKeyboardMovement(dt);
            }
        }

        this.updateHud();
        this.core.renderer.render(this.core.scene, this.core.camera);
    }

    updateHud() {
        if (!this.vehicle || !this._hudDirty) return;
        this._hudDirty = false;
        let polyCount = 0;
        this.vehicle.traverse(child => {
            if (child.isMesh && child.geometry) {
                const indexCount = child.geometry.index?.count;
                const positionCount = child.geometry.attributes.position?.count;
                polyCount += (indexCount || positionCount || 0) / 3;
            }
        });
        const badge = document.getElementById('polyCountBadge');
        const nextText = `Polygone: ${Math.round(polyCount)}`;
        if (badge && nextText !== this._lastHudText) badge.textContent = nextText;
        this._lastHudText = nextText;
    }

    handlePartKeyboardMovement(dt) {
        if (this.selectedIndex === null || this.viewport.isFlyMode) return;

        const keys = this.core.keys;
        const speed = (keys.shift ? 25 : 5) * dt;

        // Find targeted part by path
        const part = this.resolveSelectedPart();
        if (!part) return;

        let moved = false;

        // X/Z Movement (Arrows or WASD)
        if (keys.arrowup || keys.w) { part.pos[2] -= speed; moved = true; }
        if (keys.arrowdown || keys.s) { part.pos[2] += speed; moved = true; }
        if (keys.arrowleft || keys.a) { part.pos[0] -= speed; moved = true; }
        if (keys.arrowright || keys.d) { part.pos[0] += speed; moved = true; }

        // Y Movement (PageUp/Down or Y/X)
        if (keys.pageup || keys.y) { part.pos[1] += speed; moved = true; }
        if (keys.pagedown || keys.x) { part.pos[1] -= speed; moved = true; }

        // Rotation (I/K, J/L, U/O)
        const rotSpeed = (keys.shift ? 180 : 60) * dt;
        if (!part.rot) part.rot = [0, 0, 0];

        if (keys.i) { part.rot[0] += rotSpeed; moved = true; }
        if (keys.k) { part.rot[0] -= rotSpeed; moved = true; }
        if (keys.j) { part.rot[1] += rotSpeed; moved = true; }
        if (keys.l) { part.rot[1] -= rotSpeed; moved = true; }
        if (keys.u) { part.rot[2] += rotSpeed; moved = true; }
        if (keys.o) { part.rot[2] -= rotSpeed; moved = true; }

        // Scaling (N = shrink, M = grow)
        const scaleSpeed = 2 * dt;
        if (!part.scale) part.scale = [1, 1, 1];
        if (keys.n) {
            const s = Math.max(0.1, part.scale[0] - scaleSpeed);
            part.scale = [s, s, s];
            moved = true;
        }
        if (keys.m) {
            const s = part.scale[0] + scaleSpeed;
            part.scale = [s, s, s];
            moved = true;
        }

        if (moved) {
            const object = this.findSelectedObject();
            if (object) this.vehicle.updatePartTransform(object, part);
            this.markSceneMetricsDirty();
            this.ui.updateSaveState('dirty', 'Ungespeicherte Änderungen');
            this.debouncedSave();
        }
    }

    dispose() {
        if (this._disposed) return;
        this.flushPendingSave();
        this._disposed = true;
        if (this._animationFrameId !== null) cancelAnimationFrame(this._animationFrameId);
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        window.removeEventListener('keydown', this.onGlobalShortcut);
        window.removeEventListener('beforeunload', this.onBeforeUnload);
        this.viewport?.dispose();
        if (this.vehicle) {
            this.core.scene.remove(this.vehicle);
            this.vehicle.dispose();
        }
        this.core?.dispose();
    }
}

new VehicleLabApp();
