import { buildVehicleLabSelectionKey } from './VehicleLabSelection.js';

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
        document.getElementById('btnLoadPreset').onclick = () => this.callbacks.onLoadPreset(presetSelect.value);
        presetSelect.onchange = (e) => this.callbacks.onLoadPreset(e.target.value);
        document.getElementById('btnImportJson').onclick = () => this.callbacks.onImportJson();
        document.getElementById('btnExportJson').onclick = () => this.callbacks.onExportJson();
        const btnSaveToGameVehicle = document.getElementById('btnSaveToGameVehicle');
        if (btnSaveToGameVehicle) {
            btnSaveToGameVehicle.onclick = () => this.callbacks.onSaveToGame?.();
        }
        const btnRefreshSavedVehicles = document.getElementById('btnRefreshSavedVehicles');
        if (btnRefreshSavedVehicles) {
            btnRefreshSavedVehicles.onclick = () => this.callbacks.onRefreshSavedVehicles?.();
        }
        document.getElementById('btnUndo').onclick = () => this.callbacks.onUndo();
        document.getElementById('btnRedo').onclick = () => this.callbacks.onRedo();
        document.getElementById('btnAddPart').onclick = () => this.callbacks.onAddPart();
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
        document.getElementById('workshopDialogCancel').onclick = () => document.getElementById('workshopDialog').close('cancel');
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

    setPresetSelection(vehicleId) {
        const select = document.getElementById('presetSelect');
        if (!select) return;
        const requestedId = String(vehicleId || '');
        const hasOption = Array.from(select.options || []).some((option) => option.value === requestedId);
        if (hasOption) select.value = requestedId;
    }

    setReferenceMode(active, label = '') {
        const isReference = active === true;
        const notice = document.getElementById('referenceVehicleNotice');
        if (notice) {
            notice.textContent = isReference
                ? `${label} ist ein fertiges Spielmodell. Ansicht und Kamera sind verfügbar; Bauteilbearbeitung und Veröffentlichung sind schreibgeschützt.`
                : '';
            notice.classList.toggle('is-hidden', !isReference);
        }

        [
            'btnAddPart', 'btnAddChild', 'btnDuplicatePart', 'btnMirrorPart', 'btnDeletePart',
            'btnExportJson', 'btnSaveToGameVehicle', 'btnUndo', 'btnRedo', 'shipLabel',
            'shipPrimaryColor', 'partSearch', 'chkSnap', 'snapTranslate', 'snapRotate', 'snapScale',
        ].forEach((id) => {
            const element = document.getElementById(id);
            if (!element) return;
            if (isReference) {
                if (element.dataset.disabledBeforeReference === undefined) {
                    element.dataset.disabledBeforeReference = String(element.disabled === true);
                }
                element.disabled = true;
            } else if (element.dataset.disabledBeforeReference !== undefined) {
                element.disabled = element.dataset.disabledBeforeReference === 'true';
                delete element.dataset.disabledBeforeReference;
            }
        });

        if (isReference) this.hideProperties();
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
        document.getElementById('shipPrimaryColor').value = this.colorToHex(config.primaryColor || 0x60a5fa);
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
            row.style.paddingLeft = `${depth * 12}px`;
            row.setAttribute('role', 'treeitem');
            row.setAttribute('aria-level', String(depth + 1));
            row.setAttribute('aria-selected', String(!!isSelected));

            const hasChildren = Array.isArray(part?.children) && part.children.length > 0;
            const collapsed = this.collapsedSelectionKeys.has(itemSelectionKey);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'part-toggle';
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
            item.onclick = () => onSelect(index, path);
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
        document.getElementById('partTitle').textContent = `Edit: ${part.name}`;

        container.innerHTML = '';

        this.createInputRow(container, 'Name', part.name, (val) => {
            part.name = val;
            onUpdate('name');
        }, 'text');

        this.createSelectRow(container, 'Geo', part.geo, ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'pylon', 'engine', 'forcefield', 'flame'], (val) => {
            part.geo = val;
            onUpdate('geo');
        });

        this.createSelectRow(container, 'Mirror Axis', part.mirrorAxis || 'none', ['none', 'x', 'y', 'z'], (val) => {
            part.mirrorAxis = val === 'none' ? null : val;
            onUpdate('mirror');
        });

        this.createSelectRow(container, 'Material', part.material, ['primary', 'secondary', 'glass', 'glow'], (val) => {
            part.material = val;
            onUpdate('material');
        });

        this.createInputRow(container, 'Custom Color', this.colorToHex(part.color || '#ffffff'), (val) => {
            part.color = val;
            onUpdate('color');
        }, 'color');

        this.createInputRow(container, 'Emissive Intensity', part.emissiveIntensity !== undefined ? part.emissiveIntensity : 0, (val) => {
            part.emissiveIntensity = val;
            onUpdate('emissive');
        }, 'number');

        this.createVectorRow(container, 'Size', part.size || [1, 1, 1], (i, val) => {
            if (!part.size) part.size = [1, 1, 1];
            part.size[i] = val;
            onUpdate('size');
        });

        this.createVectorRow(container, 'Pos', part.pos || [0, 0, 0], (i, val) => {
            if (!part.pos) part.pos = [0, 0, 0];
            part.pos[i] = val;
            onUpdate('pos');
        });

        this.createVectorRow(container, 'Rot', part.rot || [0, 0, 0], (i, val) => {
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
                this.createSelectRow(container, 'Axis', part.anim.axis || 'y', ['x', 'y', 'z'], (val) => {
                    part.anim.axis = val;
                    onUpdate('anim');
                });
            }
            this.createInputRow(container, 'Anim Speed', part.anim.speed || 1, (val) => {
                part.anim.speed = val;
                onUpdate('anim');
            });
            if (part.anim.type !== 'rotate') {
                this.createInputRow(container, 'Anim Amount', part.anim.amount || 1, (val) => {
                    part.anim.amount = val;
                    onUpdate('anim');
                });
            }
        }
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
            o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = (e) => onChange(e.target.value);
        container.appendChild(lbl);
        container.appendChild(sel);
    }

    createVectorRow(container, label, vector, onChange) {
        const lbl = document.createElement('label');
        lbl.textContent = label;
        container.appendChild(lbl);
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '4px';
        vector.forEach((val, i) => {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.1';
            inp.value = val.toFixed(2);
            inp.style.width = '30%';
            inp.onchange = (e) => {
                const val = parseFloat(e.target.value);
                onChange(i, Number.isNaN(val) ? vector[i] : val);
            };
            div.appendChild(inp);
        });
        container.appendChild(div);
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
                label.textContent = String(vehicle?.label || vehicle?.id || 'Standard Vehicle');
                labelWrap.appendChild(label);

                const meta = document.createElement('div');
                meta.className = 'saved-vehicle-meta';
                meta.textContent = String(vehicle?.id || '');
                labelWrap.appendChild(meta);

                const badge = document.createElement('span');
                badge.className = 'badge--readonly';
                badge.textContent = 'Read-only';

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
                label.textContent = String(vehicle?.label || vehicle?.id || 'Custom Vehicle');
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
                btnRename.textContent = 'Rename';
                btnRename.onclick = () => this.callbacks.onRenameSavedVehicle?.(vehicle);

                const btnDelete = document.createElement('button');
                btnDelete.type = 'button';
                btnDelete.textContent = 'Delete';
                btnDelete.onclick = () => this.callbacks.onDeleteSavedVehicle?.(vehicle);

                actions.appendChild(btnLoad);
                actions.appendChild(btnRename);
                actions.appendChild(btnDelete);

                row.appendChild(labelWrap);
                row.appendChild(actions);
                savedList.appendChild(row);
            });
        } else {
            renderEmpty(savedList, 'Noch keine gespeicherten Custom-Fahrzeuge.');
        }
    }

    updateHistoryControls(historyState = {}) {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = historyState.canUndo !== true;
        if (btnRedo) btnRedo.disabled = historyState.canRedo !== true;
    }

    updateSaveState(state = 'saved', text = 'Lokal gespeichert') {
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

    requestDialog({ title, message, inputLabel = '', inputValue = '', confirmLabel = 'Bestätigen', danger = false } = {}) {
        const dialog = document.getElementById('workshopDialog');
        const input = document.getElementById('workshopDialogInput');
        const label = document.getElementById('workshopDialogInputLabel');
        const confirm = document.getElementById('workshopDialogConfirm');
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
            option.textContent = String(candidate.label || candidate.id || 'Vehicle');
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
            current.textContent = String(metric.current);
            row.appendChild(current);

            const baseline = document.createElement('span');
            baseline.className = 'compare-baseline';
            baseline.textContent = String(metric.baseline);
            row.appendChild(baseline);

            const delta = document.createElement('span');
            delta.className = `compare-delta ${metric.delta > 0 ? 'is-positive' : metric.delta < 0 ? 'is-negative' : 'is-neutral'}`;
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
