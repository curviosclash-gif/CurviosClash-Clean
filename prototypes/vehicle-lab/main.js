import * as THREE from 'three';
import { VehicleLabCore } from './src/VehicleLabCore.js';
import { VehicleLabViewport } from './src/VehicleLabViewport.js';
import { VehicleLabUI } from './src/VehicleLabUI.js';
import { VehicleHistory } from './src/VehicleHistory.js';
import { ModularVehicleMesh } from './src/ModularVehicleMesh.js';
import { VEHICLE_PRESETS } from './src/VehiclePresets.js';
import {
    buildValidatedArcadeBlueprint,
    describeArcadeBlueprintStatus,
    formatArcadeBlueprintValidationMessage,
} from './src/ArcadeBlueprintValidation.js';
import { EDITOR_API_ROUTES } from '../../src/shared/contracts/EditorPathContract.js';

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
    return [
        { key: 'parts', label: 'Parts' },
        { key: 'engines', label: 'Engines' },
        { key: 'wings', label: 'Wings/Fins' },
        { key: 'animated', label: 'Animated' },
    ].map((metric) => ({
        ...metric,
        current: current[metric.key],
        baseline: baseline[metric.key],
        delta: current[metric.key] - baseline[metric.key],
    }));
}

class VehicleLabApp {
    constructor() {
        this.canvas = document.getElementById('vehicleCanvas');
        this.core = new VehicleLabCore(this.canvas);

        const saved = localStorage.getItem('vehicle_lab_config');
        let initialConfig = null;
        try {
            if (saved) initialConfig = JSON.parse(saved);
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
            onLoadPreset: () => this.loadPreset(),
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
            onFlyModeChange: (val) => { this.viewport.isFlyMode = val; },
            onWireframeChange: (val) => { this.vehicle.setWireframe(val); },
            onHitboxChange: (val) => { this.viewport.setHitboxVisible(val); },
            onUndo: () => this.undo(),
            onRedo: () => this.redo(),
            onCompareVehicleChange: (vehicleId) => this.setCompareVehicle(vehicleId),
            onGlobalUpdate: (type, val) => this.onGlobalUpdate(type, val)
        });
        this.vehicle = new ModularVehicleMesh(initialConfig);
        if (this.vehicle.children.length === 0) {
            console.warn('Vehicle Lab: Loaded config generated empty mesh. Forcing default preset.');
            initialConfig = JSON.parse(JSON.stringify(VEHICLE_PRESETS[0]));
            this.vehicle = new ModularVehicleMesh(initialConfig);
            localStorage.setItem('vehicle_lab_config', JSON.stringify(initialConfig));
        }
        this.core.scene.add(this.vehicle);

        this.selectedIndex = null;
        this.selectedPath = [];
        this.savedVehicles = [];
        this.compareVehicleId = VEHICLE_PRESETS[1]?.id || VEHICLE_PRESETS[0]?.id || '';
        this.statusMessage = 'Bereit';
        this.statusTone = 'info';
        this.arcadeBlueprintStatus = 'Blueprint: n/a';
        this.lastArcadeBlueprintResult = null;
        this.updateArcadeBlueprintStatus();
        this.initPresets();
        this.updateUI();
        this.updateSavedVehiclesUi('');
        this.refreshSavedVehiclesList();
        this.animate();

        window.addEventListener('resize', () => this.core.onResize());

        // Global Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    this.undo();
                } else if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    this.redo();
                }
            }
        });

        // Listen for viewport changes (Gizmo)
        this.viewport.onChanged = () => {
            if (this.selectedIndex === null) return;
            this.syncGizmoToConfig();
            this.vehicle.build();
            this.updateArcadeBlueprintStatus();
            this.persistCurrentConfig('Gizmo-Aenderung gespeichert.');
            const part = this.vehicle.config.parts[this.selectedIndex];
            if (part) {
                this.ui.showProperties(part, (type) => this.onPropUpdate(type));
                this.refreshGizmoAttachment();
            }
        };

    }

    initPresets() {
        const select = document.getElementById('presetSelect');
        VEHICLE_PRESETS.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            select.appendChild(opt);
        });
    }

    getStandardReadonlyVehicles() {
        return VEHICLE_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label || preset.id,
            readOnly: true
        }));
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

    persistCurrentConfig(statusMessage = 'Aenderungen lokal gespeichert.') {
        this.history.save(this.vehicle.config);
        localStorage.setItem('vehicle_lab_config', JSON.stringify(this.vehicle.config));
        this.setStatus(statusMessage, 'success');
    }

    flushPendingSave() {
        if (!this._saveTimeout) return;
        clearTimeout(this._saveTimeout);
        this._saveTimeout = null;
        this.persistCurrentConfig('Aenderungen lokal gespeichert.');
    }

    applyVehicleConfigToEditor(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('Invalid vehicle config');
        }
        const cloned = cloneVehicleConfig(config);
        this.vehicle.updateConfig(cloned);
        this.updateArcadeBlueprintStatus();
        this.persistCurrentConfig('Fahrzeug geladen.');
        this.selectPart(null);
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
            alert(`Fahrzeug konnte nicht geladen werden: ${error.message}`);
        }
    }

    loadPreset() {
        const id = document.getElementById('presetSelect').value;
        const preset = VEHICLE_PRESETS.find(p => p.id === id);
        if (preset) {
            this.applyVehicleConfigToEditor(preset);
        }
    }


    selectPart(index, path = []) {
        this.selectedIndex = index;
        this.selectedPath = path;
        this.vehicle.setSelectedIndex(index);
        this.updateUI();

        if (index !== null) {
            this.refreshGizmoAttachment();
        } else {
            this.viewport.attach(null);
            this.ui.hideProperties();
        }
    }

    onPropUpdate(type) {
        this.vehicle.build();
        this.refreshGizmoAttachment();
        this.updateArcadeBlueprintStatus();
        this.setStatus(type === 'add' ? 'Bauteil hinzugefuegt.' : 'Aenderungen ausstehend.', 'warning');
        this.debouncedSave();
        this.updateUI();
    }

    debouncedSave() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            this._saveTimeout = null;
            this.persistCurrentConfig('Aenderungen lokal gespeichert.');
            this.updateUI();
        }, 180);
    }

    onGlobalUpdate(type, val) {
        if (type === 'label') {
            this.vehicle.config.label = val;
        } else if (type === 'color') {
            this.vehicle.config.primaryColor = parseInt(val.replace('#', ''), 16);
            this.vehicle.initMaterials(this.vehicle.config);
            this.vehicle.build();
        }
        this.updateArcadeBlueprintStatus();
        this.persistCurrentConfig('Ship Settings gespeichert.');
        this.updateUI();
    }

    updateArcadeBlueprintStatus(labelOverride = '') {
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

        let targetPart = this.vehicle.config.parts[this.selectedIndex];
        if (this.selectedPath && this.selectedPath.length > 0) {
            this.selectedPath.forEach(pIdx => {
                if (targetPart && targetPart.children) targetPart = targetPart.children[pIdx];
            });
        }

        let foundMesh = null;
        this.vehicle.traverse(node => {
            if (node.userData.config === targetPart && !node.userData.isMirror) {
                foundMesh = node;
            }
        });

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

        let part = this.vehicle.config.parts[this.selectedIndex];
        if (this.selectedPath && this.selectedPath.length > 0) {
            this.selectedPath.forEach(pIdx => {
                if (part.children) part = part.children[pIdx];
            });
        }

        part.pos = [
            Number.isFinite(obj.position.x) ? obj.position.x : part.pos[0],
            Number.isFinite(obj.position.y) ? obj.position.y : part.pos[1],
            Number.isFinite(obj.position.z) ? obj.position.z : part.pos[2]
        ];
        part.rot = [
            Number.isFinite(obj.rotation.x) ? THREE.MathUtils.radToDeg(obj.rotation.x) : part.rot[0],
            Number.isFinite(obj.rotation.y) ? THREE.MathUtils.radToDeg(obj.rotation.y) : part.rot[1],
            Number.isFinite(obj.rotation.z) ? THREE.MathUtils.radToDeg(obj.rotation.z) : part.rot[2]
        ];
        part.scale = [
            Number.isFinite(obj.scale.x) ? obj.scale.x : (part.scale ? part.scale[0] : 1),
            Number.isFinite(obj.scale.y) ? obj.scale.y : (part.scale ? part.scale[1] : 1),
            Number.isFinite(obj.scale.z) ? obj.scale.z : (part.scale ? part.scale[2] : 1)
        ];

    }

    addPart() {
        const newPart = { name: 'New Part', geo: 'box', size: [1, 1, 1], pos: [0, 1, 0], rot: [0, 0, 0], material: 'primary' };
        this.vehicle.config.parts.push(newPart);
        this.vehicle.build();
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
        this.vehicle.build();
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

            this.vehicle.build();
            this.updateArcadeBlueprintStatus();
            this.persistCurrentConfig('Bauteil geloescht.');
            this.updateUI();
        }
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
            const reader = new FileReader();
            reader.onload = (re) => {
                try {
                    const config = JSON.parse(re.target.result);
                    this.applyVehicleConfigToEditor(config);
                } catch (err) {
                    alert('Invalid JSON file');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    exportJson() {
        const data = JSON.stringify(this.vehicle.config, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.vehicle.config.label || 'ship'}.json`;
        a.click();
    }

    async saveToGame() {
        const suggested = String(this.vehicle?.config?.label || 'Custom Vehicle').trim() || 'Custom Vehicle';
        const requestedName = window.prompt(
            'Name fuer das Fahrzeug im Spiel (gleicher Name aktualisiert den bestehenden Eintrag):',
            suggested
        );
        if (requestedName === null) return;

        const vehicleName = requestedName.trim();
        if (!vehicleName) {
            alert('Bitte einen gueltigen Fahrzeugnamen eingeben.');
            return;
        }

        const guardResult = this.updateArcadeBlueprintStatus(vehicleName);
        if (!guardResult.validation.ok) {
            alert(
                'Arcade-Blueprint Guard fehlgeschlagen.\n' +
                `${formatArcadeBlueprintValidationMessage(guardResult)}`
            );
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
            alert(
                `Fahrzeug ${saveMode}.\n` +
                `Fahrzeug-ID: ${payload.vehicleId}\n` +
                `Label: ${payload.vehicleLabel}\n` +
                `Config-Datei: ${payload.vehicleConfigPath}\n` +
                `Registry: ${payload.generatedModulePath}\n` +
                `${this.arcadeBlueprintStatus}\n` +
                `Spielseite neu laden, damit das Fahrzeug in der Auswahl erscheint.`
            );
            this.refreshSavedVehiclesList();
        } catch (error) {
            alert(
                `Fahrzeug konnte nicht gespeichert werden: ${error.message}\n` +
                `Hinweis: Vehicle Lab muss ueber den lokalen Vite-Server laufen (npm run dev).`
            );
        }
    }

    async renameSavedVehicle(vehicle) {
        const vehicleId = String(vehicle?.id || '').trim();
        const currentLabel = String(vehicle?.label || vehicleId || '').trim();
        if (!vehicleId) return;

        const requestedName = window.prompt(
            'Neuer Name fuer das gespeicherte Fahrzeug:',
            currentLabel || 'Custom Vehicle'
        );
        if (requestedName === null) return;

        const vehicleName = requestedName.trim();
        if (!vehicleName) {
            alert('Bitte einen gueltigen Fahrzeugnamen eingeben.');
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

            alert(
                `Fahrzeug umbenannt.\n` +
                `Alt: ${payload.previousVehicleId}\n` +
                `Neu: ${payload.vehicleLabel} (${payload.vehicleId})\n` +
                `Spielseite neu laden, damit die Auswahl aktualisiert wird.`
            );
            this.refreshSavedVehiclesList();
        } catch (error) {
            alert(`Umbenennen fehlgeschlagen: ${error.message}`);
        }
    }

    async deleteSavedVehicle(vehicle) {
        const vehicleId = String(vehicle?.id || '').trim();
        const currentLabel = String(vehicle?.label || vehicleId || '').trim();
        if (!vehicleId) return;

        const confirmed = window.confirm(
            `Custom-Fahrzeug wirklich loeschen?\n${currentLabel} (${vehicleId})`
        );
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

            alert(`Fahrzeug geloescht: ${vehicleId}`);
            this.refreshSavedVehiclesList();
        } catch (error) {
            alert(`Loeschen fehlgeschlagen: ${error.message}`);
        }
    }

    undo() {
        this.flushPendingSave();
        const config = this.history.undo();
        if (config) {
            this.vehicle.updateConfig(config);
            this.updateArcadeBlueprintStatus();
            localStorage.setItem('vehicle_lab_config', JSON.stringify(config));
            this.setStatus('Undo angewendet.', 'info');
            this.selectPart(null);
            this.updateUI();
        } else {
            this.setStatus('Keine Undo-Schritte verfuegbar.', 'warning');
        }
    }

    redo() {
        this.flushPendingSave();
        const config = this.history.redo();
        if (config) {
            this.vehicle.updateConfig(config);
            this.updateArcadeBlueprintStatus();
            localStorage.setItem('vehicle_lab_config', JSON.stringify(config));
            this.setStatus('Redo angewendet.', 'info');
            this.selectPart(null);
            this.updateUI();
        } else {
            this.setStatus('Keine Redo-Schritte verfuegbar.', 'warning');
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = this.core.clock?.getDelta() || 0.016;
        const time = this.core.clock?.getElapsedTime() || performance.now() / 1000;

        if (this.viewport) this.viewport.update(dt);

        if (this.vehicle) {
            this.vehicle.tick(dt, time);
            const autoRotate = document.getElementById('chkAutoRotate');
            if (autoRotate && autoRotate.checked) {
                this.vehicle.rotation.y += 0.5 * dt;
            }
            if (this.viewport) {
                this.viewport.updateHitbox(this.vehicle);
                this.handlePartKeyboardMovement(dt);
            }
        }

        this.updateHud();
        this.core.renderer.render(this.core.scene, this.core.camera);
    }

    updateHud() {
        if (!this.vehicle) return;
        let polyCount = 0;
        this.vehicle.traverse(child => {
            if (child.isMesh && child.geometry) {
                const pos = child.geometry.attributes.position;
                if (pos) {
                    polyCount += pos.count / 3;
                }
            }
        });
        const badge = document.getElementById('polyCountBadge');
        if (badge) badge.textContent = `Polys: ${Math.round(polyCount)} | ${this.arcadeBlueprintStatus}`;
    }

    handlePartKeyboardMovement(dt) {
        if (this.selectedIndex === null || this.viewport.isFlyMode) return;

        const keys = this.core.keys;
        const speed = (keys.shift ? 25 : 5) * dt;

        // Find targeted part by path
        let part = this.vehicle.config.parts[this.selectedIndex];
        if (this.selectedPath && this.selectedPath.length > 0) {
            this.selectedPath.forEach(pIdx => {
                if (part.children) part = part.children[pIdx];
            });
        }

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
            this.vehicle.build();
            this.ui.showProperties(part, (type) => this.onPropUpdate(type));
            this.refreshGizmoAttachment();
            this.debouncedSave();
        }
    }
}

new VehicleLabApp();
