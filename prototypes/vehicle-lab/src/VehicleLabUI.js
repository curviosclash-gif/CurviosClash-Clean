import { buildVehicleLabSelectionKey } from './VehicleLabSelection.js';
import { describeGeometryDimensions } from './VehicleLabGeometryLabels.js';

export const VEHICLE_LAB_DRAFT_OPTION_VALUE = '__vehicle_lab_draft__';
import { VEHICLE_LAB_PART_ROLES } from '../../../src/shared/contracts/VehicleLabConfigContract.js';
import { VEHICLE_LAB_HANGAR_MIN_PART_SIZE } from '../../../src/shared/contracts/VehicleLabHangarPublishContract.js';

// Kleinste sinnvolle Kantenlaenge. Darunter ist ein Bauteil unsichtbar,
// verbraucht aber weiter Budget - und der Hangar wuerde es ohnehin anheben.
const MIN_PART_DIMENSION = VEHICLE_LAB_HANGAR_MIN_PART_SIZE;

const OPTION_LABELS = Object.freeze({
    auto: 'Automatisch (alter Name)',
    core: 'Rumpf',
    nose: 'Nase',
    wing_left: 'Flügel links',
    wing_right: 'Flügel rechts',
    engine_left: 'Antrieb links',
    engine_right: 'Antrieb rechts',
    utility: 'Zusatzmodul',
    none: 'Keine',
    box: 'Quader',
    sphere: 'Kugel',
    cylinder: 'Zylinder',
    cone: 'Kegel',
    torus: 'Torus',
    capsule: 'Kapsel',
    pylon: 'Pylon',
    engine: 'Antrieb',
    forcefield: 'Kraftfeld',
    flame: 'Flamme',
    primary: 'Primärfarbe',
    secondary: 'Sekundärfarbe',
    glass: 'Glas',
    glow: 'Leuchten',
    rotate: 'Drehen',
    bob: 'Schweben',
    pulse: 'Pulsieren',
});
const TREE_NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export class VehicleLabUI {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.collapsedSelectionKeys = new Set();
        this.partSearch = '';
        this.inputId = 0;
        this.initEventListeners();
        this.initPanelResizers();
    }

    initEventListeners() {
        const presetSelect = document.getElementById('presetSelect');
        presetSelect.onchange = (e) => this.callbacks.onLoadPreset(e.target.value);
        document.getElementById('btnImportJson').onclick = () => this.callbacks.onImportJson();
        document.getElementById('btnExportJson').onclick = () => this.callbacks.onExportJson();
        const btnSaveVehicle = document.getElementById('btnSaveVehicle');
        if (btnSaveVehicle) btnSaveVehicle.onclick = () => this.callbacks.onSaveVehicle?.();
        const btnSaveToGameVehicle = document.getElementById('btnSaveToGameVehicle');
        if (btnSaveToGameVehicle) {
            btnSaveToGameVehicle.onclick = () => this.callbacks.onSaveToGame?.();
        }
        const btnRefreshSavedVehicles = document.getElementById('btnRefreshSavedVehicles');
        if (btnRefreshSavedVehicles) {
            btnRefreshSavedVehicles.onclick = () => this.callbacks.onRefreshSavedVehicles?.();
        }
        const btnRestoreDraft = document.getElementById('btnRestoreDraft');
        if (btnRestoreDraft) btnRestoreDraft.onclick = () => this.callbacks.onRestoreDraft?.();
        document.getElementById('btnUndo').onclick = () => this.callbacks.onUndo();
        document.getElementById('btnRedo').onclick = () => this.callbacks.onRedo();
        document.getElementById('btnAddPart').onclick = () => this.callbacks.onAddPart();
        const btnEditBaseVehicle = document.getElementById('btnEditBaseVehicle');
        if (btnEditBaseVehicle) btnEditBaseVehicle.onclick = () => this.callbacks.onEditBaseVehicle?.();
        document.getElementById('btnAddChild').onclick = () => this.callbacks.onAddChild();
        document.getElementById('btnDuplicatePart').onclick = () => this.callbacks.onDuplicatePart?.();
        document.getElementById('btnMirrorPart').onclick = () => this.callbacks.onMirrorPart?.();
        document.getElementById('btnDeletePart').onclick = () => this.callbacks.onDeletePart();
        document.getElementById('partSearch').oninput = (e) => {
            this.partSearch = String(e.target.value || '').trim().toLowerCase();
            this.callbacks.onPartSearchChange?.();
        };
        const compareSelect = document.getElementById('compareVehicleSelect');
        if (compareSelect) {
            compareSelect.onchange = (e) => this.callbacks.onCompareVehicleChange?.(e.target.value);
        }

        const flyToggle = document.getElementById('chkFlyMode');
        if (flyToggle) {
            flyToggle.onchange = (e) => this.callbacks.onFlyModeChange(e.target.checked);
        }

        const wireToggle = document.getElementById('chkWireframe');
        if (wireToggle) {
            wireToggle.onchange = (e) => this.callbacks.onWireframeChange(e.target.checked);
        }

        const hitboxToggle = document.getElementById('chkHitbox');
        if (hitboxToggle) {
            hitboxToggle.onchange = (e) => this.callbacks.onHitboxChange(e.target.checked);
        }

        const snapControls = ['chkSnap', 'snapTranslate', 'snapRotate', 'snapScale'];
        snapControls.forEach((id) => {
            document.getElementById(id).onchange = () => this.callbacks.onSnapChange?.(this.getSnapSettings());
        });

        document.querySelectorAll('[data-transform-mode]').forEach((button) => {
            button.onclick = () => this.callbacks.onTransformMode?.(button.dataset.transformMode);
        });

        document.querySelectorAll('[data-camera-view]').forEach((button) => {
            button.onclick = () => {
                document.querySelectorAll('[data-camera-view]').forEach((candidate) => {
                    candidate.setAttribute('aria-pressed', String(candidate === button));
                });
                this.callbacks.onCameraView?.(button.dataset.cameraView);
            };
        });

        document.getElementById('shipLabel').oninput = (e) => this.callbacks.onGlobalUpdate('label', e.target.value);
        document.getElementById('shipPrimaryColor').onchange = (e) => this.callbacks.onGlobalUpdate('color', e.target.value);
        document.getElementById('workshopDialogCancel').onclick = () => {
            const dialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('workshopDialog'));
            dialog?.close('cancel');
        };
    }

    getSnapSettings() {
        return {
            enabled: document.getElementById('chkSnap').checked,
            translate: Math.max(0.01, Number(document.getElementById('snapTranslate').value) || 0.25),
            rotate: Math.max(1, Number(document.getElementById('snapRotate').value) || 15),
            scale: Math.max(0.01, Number(document.getElementById('snapScale').value) || 0.1),
        };
    }

    setActiveCameraView(view) {
        document.querySelectorAll('[data-camera-view]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.cameraView === view));
        });
    }

    setActiveTransformMode(mode) {
        document.querySelectorAll('[data-transform-mode]').forEach((button) => {
            const active = button.dataset.transformMode === mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    setTransformControlsEnabled(enabled) {
        document.querySelectorAll('[data-transform-mode]').forEach((button) => {
            button.disabled = enabled !== true;
        });
    }

    /**
     * Waehlt die Vorlage aus, aus der der aktuelle Entwurf stammt.
     * Sobald der Entwurf davon abweicht, wechselt die Auswahl auf den Eintrag
     * "Eigener Entwurf": sonst steht dort weiter die Herkunftsvorlage, und ein
     * erneuter Klick darauf wuerde die eigene Arbeit ueberschreiben.
     * @param {string} vehicleId
     * @param {{modified?: boolean}} [options]
     */
    setPresetSelection(vehicleId, { modified = false } = {}) {
        const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('presetSelect'));
        if (!select) return;
        const requestedId = String(vehicleId || '');
        const hasOption = Array.from(select.options || []).some((option) => option.value === requestedId);
        if (!modified && hasOption) {
            select.value = requestedId;
            return;
        }
        const draftOption = Array.from(select.options || []).find(
            (option) => option.value === VEHICLE_LAB_DRAFT_OPTION_VALUE
        );
        if (draftOption) select.value = VEHICLE_LAB_DRAFT_OPTION_VALUE;
    }

    markDraftModified() {
        this.setPresetSelection('', { modified: true });
    }

    setReferenceMode(active, label = '') {
        const isProductVehicle = active === true;
        const notice = document.getElementById('referenceVehicleNotice');
        if (notice) {
            notice.textContent = isProductVehicle
                ? `${label} ist ein produktives Spielmodell. Das Grundmodell bleibt als Asset erhalten; Transformation und zusätzliche Bauteile sind bearbeitbar.`
                : '';
            notice.classList.toggle('is-hidden', !isProductVehicle);
        }
        document.getElementById('btnEditBaseVehicle')?.classList.toggle('is-hidden', !isProductVehicle);
        const saveButton = document.getElementById('btnSaveVehicle');
        if (saveButton) saveButton.textContent = isProductVehicle ? 'Spiel-Fahrzeug speichern' : 'Fahrzeug speichern';
        const publishButton = document.getElementById('btnSaveToGameVehicle');
        if (publishButton) publishButton.disabled = isProductVehicle;
    }

    setDraftRecoveryAvailable(available) {
        const button = document.getElementById('btnRestoreDraft');
        if (!button) return;
        button.disabled = available !== true;
        button.classList.toggle('is-hidden', available !== true);
    }

    initPanelResizers() {
        document.querySelectorAll('[data-panel-resizer]').forEach((resizer) => {
            const side = resizer.dataset.panelResizer;
            const property = side === 'left' ? '--left-panel-width' : '--right-panel-width';
            const direction = side === 'left' ? 1 : -1;
            const resizeTo = (clientX) => {
                const width = side === 'left' ? clientX : window.innerWidth - clientX;
                document.documentElement.style.setProperty(property, `${Math.max(260, Math.min(520, width))}px`);
            };
            resizer.addEventListener('pointerdown', (event) => {
                resizer.setPointerCapture(event.pointerId);
                const move = (moveEvent) => resizeTo(moveEvent.clientX);
                const stop = () => {
                    resizer.removeEventListener('pointermove', move);
                    resizer.removeEventListener('pointerup', stop);
                };
                resizer.addEventListener('pointermove', move);
                resizer.addEventListener('pointerup', stop);
            });
            resizer.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property)) || 320;
                const delta = (event.key === 'ArrowRight' ? 12 : -12) * direction;
                document.documentElement.style.setProperty(property, `${Math.max(260, Math.min(520, current + delta))}px`);
            });
        });
    }

    updateShipInfo(config) {
        document.getElementById('shipLabel').value = config.label || '';
        document.getElementById('shipPrimaryColor').value = this.colorToHex(config.primaryColor ?? 0x60a5fa);
    }

    colorToHex(color) {
        if (typeof color === 'string') return color;
        return '#' + color.toString(16).padStart(6, '0');
    }

    updatePartsList(parts, selectedIndex, selectedPath = [], onSelect) {
        const list = document.getElementById('partsList');
        list.innerHTML = '';
        let totalCount = 0;
        const activeSelectionKey = buildVehicleLabSelectionKey(selectedIndex, selectedPath);

        const matchesSearch = (part) => {
            if (!this.partSearch) return true;
            if (String(part?.name || '').toLowerCase().includes(this.partSearch)) return true;
            return Array.isArray(part?.children) && part.children.some(matchesSearch);
        };

        const renderItem = (part, index, depth = 0, path = []) => {
            totalCount++;
            if (!matchesSearch(part)) return;
            const itemSelectionKey = buildVehicleLabSelectionKey(index, path);
            const isSelected = itemSelectionKey && itemSelectionKey === activeSelectionKey;
            const row = document.createElement('div');
            row.className = 'part-row';
            row.setAttribute('role', 'presentation');
            row.style.paddingLeft = `${depth * 12}px`;

            const hasChildren = Array.isArray(part?.children) && part.children.length > 0;
            const collapsed = this.collapsedSelectionKeys.has(itemSelectionKey);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'part-toggle';
            toggle.tabIndex = -1;
            toggle.setAttribute('aria-hidden', 'true');
            toggle.textContent = collapsed ? '▸' : '▾';
            toggle.hidden = !hasChildren;
            toggle.setAttribute('aria-label', collapsed ? 'Unterbauteile öffnen' : 'Unterbauteile schließen');
            toggle.onclick = (event) => {
                event.stopPropagation();
                if (collapsed) this.collapsedSelectionKeys.delete(itemSelectionKey);
                else this.collapsedSelectionKeys.add(itemSelectionKey);
                this.callbacks.onPartSearchChange?.();
            };

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'part-item' + (isSelected ? ' is-selected' : '');
            item.textContent = part.name || `Part ${index}`;
            item.setAttribute('role', 'treeitem');
            item.setAttribute('aria-level', String(depth + 1));
            item.setAttribute('aria-selected', String(!!isSelected));
            if (hasChildren) item.setAttribute('aria-expanded', String(!collapsed));
            item.dataset.depth = String(depth);
            item.tabIndex = isSelected || (!activeSelectionKey && list.children.length === 0) ? 0 : -1;
            item.onclick = () => onSelect(index, path);
            item.onkeydown = (event) => {
                if (TREE_NAVIGATION_KEYS.has(event.key)) event.stopPropagation();
                const visibleItems = Array.from(list.querySelectorAll('.part-item'));
                const currentIndex = visibleItems.indexOf(item);
                const focusItem = (target) => {
                    if (!target) return;
                    event.preventDefault();
                    target.focus();
                    target.click();
                };
                if (event.key === 'ArrowDown') focusItem(visibleItems[currentIndex + 1]);
                else if (event.key === 'ArrowUp') focusItem(visibleItems[currentIndex - 1]);
                else if (event.key === 'Home') focusItem(visibleItems[0]);
                else if (event.key === 'End') focusItem(visibleItems[visibleItems.length - 1]);
                else if (event.key === 'ArrowRight' && hasChildren && collapsed) {
                    event.preventDefault();
                    toggle.click();
                } else if (event.key === 'ArrowLeft' && hasChildren && !collapsed) {
                    event.preventDefault();
                    toggle.click();
                } else if (event.key === 'ArrowLeft' && depth > 0) {
                    const parent = visibleItems.slice(0, currentIndex).reverse()
                        .find((candidate) => Number(candidate.dataset.depth) === depth - 1);
                    focusItem(parent);
                }
            };
            row.appendChild(toggle);
            row.appendChild(item);
            list.appendChild(row);

            if (part && part.children && (!collapsed || this.partSearch)) {
                part.children.forEach((child, cIdx) => {
                    renderItem(child, index, depth + 1, [...path, cIdx]);
                });
            }
        };

        const safeParts = Array.isArray(parts) ? parts : [];
        safeParts.forEach((part, index) => renderItem(part, index, 0, []));
        document.getElementById('partCountBadge').textContent = `Bauteile: ${totalCount}`;

        // Update button states
        const hasSelection = activeSelectionKey !== '';
        const btnDelete = document.getElementById('btnDeletePart');
        const btnAddChild = document.getElementById('btnAddChild');
        const btnDuplicate = document.getElementById('btnDuplicatePart');
        const btnMirror = document.getElementById('btnMirrorPart');
        if (btnDelete) btnDelete.disabled = !hasSelection;
        if (btnAddChild) btnAddChild.disabled = !hasSelection;
        if (btnDuplicate) btnDuplicate.disabled = !hasSelection;
        if (btnMirror) btnMirror.disabled = !hasSelection;
    }

    showProperties(part, onUpdate) {
        if (!part) return;
        const panel = document.getElementById('propertyPanel');
        const container = document.getElementById('propertiesContainer');
        panel.classList.remove('is-hidden');
        document.getElementById('btnDeletePart').classList.remove('is-hidden');
        document.getElementById('partTitle').textContent = `Bearbeiten: ${part.name}`;

        container.innerHTML = '';

        this.createInputRow(container, 'Name', part.name, (val) => {
            part.name = val;
            onUpdate('name');
        }, 'text');

        this.createSelectRow(container, 'Geometrie', part.geo, ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pylon', 'engine', 'forcefield', 'flame'], (val) => {
            part.geo = val;
            onUpdate('geo');
        });

        this.createSelectRow(container, 'Spielrolle', part.role || 'auto', VEHICLE_LAB_PART_ROLES, (val) => {
            if (val === 'auto') delete part.role;
            else part.role = val;
            onUpdate('role');
        });

        this.createSelectRow(container, 'Spiegelachse', part.mirrorAxis || 'none', ['none', 'x', 'y', 'z'], (val) => {
            if (val === 'none') delete part.mirrorAxis;
            else part.mirrorAxis = val;
            onUpdate('mirror');
        });

        this.createSelectRow(container, 'Material', part.material, ['primary', 'secondary', 'glass', 'glow'], (val) => {
            part.material = val;
            onUpdate('material');
        });

        this.createInputRow(container, 'Eigene Farbe', this.colorToHex(part.color || '#ffffff'), (val) => {
            part.color = val;
            onUpdate('color');
        }, 'color');

        this.createInputRow(container, 'Leuchtstärke', part.emissiveIntensity !== undefined ? part.emissiveIntensity : 0, (val) => {
            part.emissiveIntensity = val;
            onUpdate('emissive');
        }, 'number');

        this.createVectorRow(container, 'Grundabmessungen', part.size || [1, 1, 1], (i, val) => {
            if (!part.size) part.size = [1, 1, 1];
            part.size[i] = val;
            onUpdate('size');
        }, { min: MIN_PART_DIMENSION, axisLabels: describeGeometryDimensions(part.geo) });

        this.createVectorRow(container, 'Skalierung', part.scale || [1, 1, 1], (i, val) => {
            if (!part.scale) part.scale = [1, 1, 1];
            part.scale[i] = Math.max(MIN_PART_DIMENSION, val);
            onUpdate('scale');
        }, { min: MIN_PART_DIMENSION });
        this.createActionRow(container, 'Skalierung zurücksetzen', () => {
            part.scale = [1, 1, 1];
            onUpdate('scale');
        });

        this.createVectorRow(container, 'Position', part.pos || [0, 0, 0], (i, val) => {
            if (!part.pos) part.pos = [0, 0, 0];
            part.pos[i] = val;
            onUpdate('pos');
        });

        this.createVectorRow(container, 'Rotation', part.rot || [0, 0, 0], (i, val) => {
            if (!part.rot) part.rot = [0, 0, 0];
            part.rot[i] = val;
            onUpdate('rot');
        });

        // Animation Settings
        const anim = part.anim || { type: 'none' };
        this.createSelectRow(container, 'Animation', anim.type, ['none', 'rotate', 'bob', 'pulse'], (val) => {
            if (val === 'none') {
                delete part.anim;
            } else {
                part.anim = { type: val, axis: 'y', speed: 1, amount: 1 };
            }
            onUpdate('anim');
        });

        if (part.anim) {
            if (part.anim.type === 'rotate') {
                this.createSelectRow(container, 'Achse', part.anim.axis || 'y', ['x', 'y', 'z'], (val) => {
                    part.anim.axis = val;
                    onUpdate('anim');
                });
            }
            this.createInputRow(container, 'Animationsgeschwindigkeit', part.anim.speed || 1, (val) => {
                part.anim.speed = val;
                onUpdate('anim');
            });
            if (part.anim.type !== 'rotate') {
                this.createInputRow(container, 'Animationsstärke', part.anim.amount || 1, (val) => {
                    part.anim.amount = val;
                    onUpdate('anim');
                });
            }
        }
    }

    showBaseProperties(config, onUpdate) {
        const panel = document.getElementById('propertyPanel');
        const container = document.getElementById('propertiesContainer');
        const transform = config.baseTransform;
        panel.classList.remove('is-hidden');
        document.getElementById('partTitle').textContent = `Grundmodell: ${config.baseVehicleId}`;
        document.getElementById('btnDeletePart').classList.add('is-hidden');
        container.innerHTML = '';
        this.createVectorRow(container, 'Position', transform.pos, (index, value) => {
            transform.pos[index] = value;
            onUpdate('baseTransform');
        });
        this.createVectorRow(container, 'Rotation', transform.rot, (index, value) => {
            transform.rot[index] = value;
            onUpdate('baseTransform');
        });
        this.createVectorRow(container, 'Skalierung', transform.scale, (index, value) => {
            transform.scale[index] = Math.max(0.01, value);
            onUpdate('baseTransform');
        });
    }

    hideProperties() {
        document.getElementById('propertyPanel').classList.add('is-hidden');
    }

    createInputRow(container, label, value, onChange, type = 'number') {
        const lbl = document.createElement('label');
        lbl.textContent = label;
        const inp = document.createElement('input');
        const inputId = `vehicleLabProperty${++this.inputId}`;
        inp.id = inputId;
        lbl.htmlFor = inputId;
        inp.type = type;
        inp.value = value;
        inp.onchange = (e) => onChange(type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value);
        container.appendChild(lbl);
        container.appendChild(inp);
    }

    createSelectRow(container, label, value, options, onChange) {
        const lbl = document.createElement('label');
        lbl.textContent = label;
        const sel = document.createElement('select');
        const selectId = `vehicleLabProperty${++this.inputId}`;
        sel.id = selectId;
        lbl.htmlFor = selectId;
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = OPTION_LABELS[opt] || opt.toUpperCase();
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = (e) => onChange(e.target.value);
        container.appendChild(lbl);
        container.appendChild(sel);
    }

    createVectorRow(container, label, vector, onChange, { min = null, axisLabels = null } = {}) {
        const lbl = document.createElement('label');
        lbl.textContent = label;
        container.appendChild(lbl);
        const div = document.createElement('div');
        div.className = 'vector-components';
        vector.forEach((val, i) => {
            const component = document.createElement('label');
            component.className = 'vector-component';
            const axis = document.createElement('span');
            axis.textContent = (axisLabels && axisLabels[i]) || ['X', 'Y', 'Z'][i] || String(i + 1);
            const unused = !!axisLabels && i >= axisLabels.length;
            if (unused) {
                axis.textContent = '–';
                component.classList.add('vector-component--unused');
                component.title = 'Diese Form wertet den Wert nicht aus.';
            }
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.1';
            inp.disabled = unused;
            if (min !== null) inp.min = String(min);
            inp.value = val.toFixed(2);
            inp.setAttribute('aria-label', `${label} ${axis.textContent}`);
            inp.onchange = () => {
                const parsed = parseFloat(inp.value);
                if (Number.isNaN(parsed)) {
                    inp.value = vector[i].toFixed(2);
                    onChange(i, vector[i]);
                    return;
                }
                // Null und negative Masse lassen das Bauteil verschwinden,
                // waehrend es weiter Budget verbraucht. Deshalb geklemmt.
                const clamped = min !== null ? Math.max(min, parsed) : parsed;
                if (clamped !== parsed) inp.value = clamped.toFixed(2);
                onChange(i, clamped);
            };
            component.appendChild(axis);
            component.appendChild(inp);
            div.appendChild(component);
        });
        container.appendChild(div);
    }

    createActionRow(container, label, onClick) {
        container.appendChild(document.createElement('span'));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn--small';
        button.textContent = label;
        button.onclick = onClick;
        container.appendChild(button);
    }

    createCheckboxRow(container, label, value, onChange) {
        const lbl = document.createElement('label');
        lbl.textContent = label;
        container.appendChild(lbl);
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = value;
        inp.onchange = (e) => onChange(e.target.checked);
        container.appendChild(inp);
    }

    updateSavedVehicleLists({ standardVehicles = [], customVehicles = [], errorMessage = '' } = {}) {
        const standardList = document.getElementById('standardVehiclesList');
        const savedList = document.getElementById('savedVehiclesList');
        if (!standardList || !savedList) return;

        standardList.innerHTML = '';
        savedList.innerHTML = '';

        const renderEmpty = (container, text) => {
            const row = document.createElement('div');
            row.className = 'saved-vehicle-row';
            const label = document.createElement('div');
            label.className = 'saved-vehicle-meta';
            label.textContent = text;
            row.appendChild(label);
            container.appendChild(row);
        };

        if (Array.isArray(standardVehicles) && standardVehicles.length > 0) {
            standardVehicles.forEach((vehicle) => {
                const row = document.createElement('div');
                row.className = 'saved-vehicle-row';

                const labelWrap = document.createElement('div');
                labelWrap.style.minWidth = '0';
                labelWrap.style.flex = '1';

                const label = document.createElement('div');
                label.className = 'saved-vehicle-label';
                label.textContent = String(vehicle?.label || vehicle?.id || 'Standardfahrzeug');
                labelWrap.appendChild(label);

                const meta = document.createElement('div');
                meta.className = 'saved-vehicle-meta';
                meta.textContent = String(vehicle?.id || '');
                labelWrap.appendChild(meta);

                const badge = document.createElement('span');
                badge.className = 'badge--readonly';
                badge.textContent = vehicle?.editableProduct ? 'Produktiv · bearbeitbar' : 'Vorlage';

                const actions = document.createElement('div');
                actions.className = 'saved-vehicle-actions';

                const btnLoad = document.createElement('button');
                btnLoad.type = 'button';
                btnLoad.textContent = 'Auswählen';
                btnLoad.onclick = () => this.callbacks.onLoadSavedVehicle?.(vehicle);
                actions.appendChild(btnLoad);

                row.appendChild(labelWrap);
                row.appendChild(badge);
                row.appendChild(actions);
                standardList.appendChild(row);
            });
        } else {
            renderEmpty(standardList, 'Keine Standardfahrzeuge gefunden.');
        }

        if (errorMessage) {
            renderEmpty(savedList, `Fehler: ${errorMessage}`);
            return;
        }

        if (Array.isArray(customVehicles) && customVehicles.length > 0) {
            customVehicles.forEach((vehicle) => {
                const row = document.createElement('div');
                row.className = 'saved-vehicle-row';

                const labelWrap = document.createElement('div');
                labelWrap.style.minWidth = '0';
                labelWrap.style.flex = '1';

                const label = document.createElement('div');
                label.className = 'saved-vehicle-label';
                label.textContent = String(vehicle?.label || vehicle?.id || 'Eigenes Fahrzeug');
                labelWrap.appendChild(label);

                const meta = document.createElement('div');
                meta.className = 'saved-vehicle-meta';
                meta.textContent = String(vehicle?.id || '');
                labelWrap.appendChild(meta);

                const actions = document.createElement('div');
                actions.className = 'saved-vehicle-actions';

                const btnLoad = document.createElement('button');
                btnLoad.type = 'button';
                btnLoad.textContent = 'Auswählen';
                btnLoad.onclick = () => this.callbacks.onLoadSavedVehicle?.(vehicle);

                const btnRename = document.createElement('button');
                btnRename.type = 'button';
                btnRename.textContent = 'Umbenennen';
                btnRename.onclick = () => this.callbacks.onRenameSavedVehicle?.(vehicle);

                const btnDelete = document.createElement('button');
                btnDelete.type = 'button';
                btnDelete.textContent = 'Löschen';
                btnDelete.onclick = () => this.callbacks.onDeleteSavedVehicle?.(vehicle);

                actions.appendChild(btnLoad);
                actions.appendChild(btnRename);
                actions.appendChild(btnDelete);

                row.appendChild(labelWrap);
                row.appendChild(actions);
                savedList.appendChild(row);
            });
        } else {
            renderEmpty(savedList, 'Noch keine eigenen Fahrzeuge gespeichert.');
        }
    }

    updateHistoryControls(historyState = {}) {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = historyState.canUndo !== true;
        if (btnRedo) btnRedo.disabled = historyState.canRedo !== true;
    }

    updateSaveState(state = 'saved', text = 'Entwurf automatisch gesichert') {
        const node = document.getElementById('workshopSaveState');
        if (!node) return;
        node.dataset.state = state;
        node.textContent = text;
    }

    showToast(message, tone = 'info') {
        const region = document.getElementById('workshopToastRegion');
        if (!region) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.dataset.tone = tone;
        toast.textContent = String(message || '');
        region.appendChild(toast);
        window.setTimeout(() => toast.remove(), 3600);
    }

    /**
     * @param {{title?: string, message?: string, inputLabel?: string, inputValue?: string, confirmLabel?: string, danger?: boolean}} [options]
     */
    requestDialog({ title, message, inputLabel = '', inputValue = '', confirmLabel = 'Bestätigen', danger = false } = {}) {
        const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('workshopDialog'));
        const input = /** @type {HTMLInputElement} */ (document.getElementById('workshopDialogInput'));
        const label = document.getElementById('workshopDialogInputLabel');
        const confirm = /** @type {HTMLButtonElement} */ (document.getElementById('workshopDialogConfirm'));
        document.getElementById('workshopDialogTitle').textContent = title || 'Vehicle Lab';
        document.getElementById('workshopDialogMessage').textContent = message || '';
        confirm.textContent = confirmLabel;
        confirm.classList.toggle('btn--danger', danger);
        confirm.classList.toggle('btn--primary', !danger);
        const hasInput = !!inputLabel;
        input.classList.toggle('is-hidden', !hasInput);
        label.classList.toggle('is-hidden', !hasInput);
        label.textContent = inputLabel;
        input.value = inputValue;
        dialog.showModal();
        if (hasInput) input.focus();
        return new Promise((resolve) => {
            dialog.addEventListener('close', () => {
                resolve(dialog.returnValue === 'confirm' ? (hasInput ? input.value : true) : null);
            }, { once: true });
        });
    }

    updateComparePanel({ candidates = [], selectedId = '', rows = [] } = {}) {
        const select = document.getElementById('compareVehicleSelect');
        const container = document.getElementById('compareRows');
        if (!select || !container) return;

        const normalizedSelectedId = String(selectedId || '');
        select.innerHTML = '';
        candidates.forEach((candidate) => {
            const option = document.createElement('option');
            option.value = String(candidate.id || '');
            option.textContent = String(candidate.label || candidate.id || 'Fahrzeug');
            if (option.value === normalizedSelectedId) option.selected = true;
            select.appendChild(option);
        });
        select.disabled = candidates.length === 0;

        container.innerHTML = '';
        rows.forEach((metric) => {
            const row = document.createElement('div');
            row.className = 'compare-row';
            row.dataset.metric = metric.key;

            const label = document.createElement('span');
            label.className = 'compare-label';
            label.textContent = metric.label;
            row.appendChild(label);

            const current = document.createElement('strong');
            current.className = 'compare-current';
            current.textContent = String(metric.currentDisplay ?? metric.current);
            row.appendChild(current);

            const baseline = document.createElement('span');
            baseline.className = 'compare-baseline';
            baseline.textContent = String(metric.baselineDisplay ?? metric.baseline);
            row.appendChild(baseline);

            const delta = document.createElement('span');
            delta.className = `compare-delta is-${metric.tone || (metric.delta === 0 ? 'neutral' : 'info')}`;
            delta.textContent = metric.delta === 0 ? '0' : `${metric.delta > 0 ? '+' : ''}${metric.delta}`;
            row.appendChild(delta);

            container.appendChild(row);
        });
    }

    updateStatusBar({ message = 'Bereit', tone = 'info', historyState = {}, blueprintStatus = '', selectedLabel = '' } = {}) {
        const bar = document.getElementById('workshopStatusBar');
        const messageNode = document.getElementById('workshopStatusMessage');
        const historyNode = document.getElementById('workshopHistoryState');
        const blueprintNode = document.getElementById('workshopBlueprintState');
        if (!bar || !messageNode || !historyNode || !blueprintNode) return;

        bar.dataset.tone = tone;
        messageNode.textContent = selectedLabel ? `${message} | ${selectedLabel}` : message;
        const currentIndex = Number.isFinite(historyState.index) ? historyState.index + 1 : 1;
        const historyLength = Number.isFinite(historyState.length) ? historyState.length : 1;
        historyNode.textContent = `Verlauf ${currentIndex}/${historyLength}`;
        blueprintNode.textContent = blueprintStatus || 'Blueprint nicht verfügbar';
    }
}
