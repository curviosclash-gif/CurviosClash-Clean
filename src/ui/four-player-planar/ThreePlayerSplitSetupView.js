import { bindLocalModuleHeaderBack } from './LocalModuleHeaderBack.js';

const DEVICE_LABELS = {
    keyboard: 'Tastatur',
    'gamepad-1': 'Gamepad 1',
    'gamepad-2': 'Gamepad 2',
    'gamepad-3': 'Gamepad 3',
};

function createOption(documentRef, value, label) {
    const option = documentRef.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function createStaticElement(documentRef, markup) {
    const range = documentRef.createRange();
    const fragment = range.createContextualFragment(String(markup || '').trim());
    return fragment.firstElementChild;
}

function colorToCss(color) {
    return `#${Number(color).toString(16).padStart(6, '0')}`;
}

function isMobileProductSurface(documentRef) {
    const appTarget = String(documentRef?.documentElement?.dataset?.appTarget || '').trim().toLowerCase();
    return appTarget === 'mobile-classic' || appTarget === 'mobile-arcade';
}

/**
 * Owns every DOM node of the three player split-screen setup surface. Unlike
 * the four-player-planar setup, there is no roll-key rebinding here - each
 * slot's keyboard zone is fixed and only shown for reference, because the
 * one thing a player actually picks per slot is which physical device
 * drives it (keyboard or one of three gamepads).
 */
export class ThreePlayerSplitSetupView {
    constructor({ documentRef = globalThis.document } = {}) {
        this.document = documentRef || null;
        this._listeners = [];
        this._nodes = null;
    }

    isMounted() {
        return !!this._nodes;
    }

    /**
     * @param {object} [options]
     * @param {ReadonlyArray<{label: string}>} [options.keyBindings]
     * @param {ReadonlyArray<number>} [options.playerColors]
     * @param {Array<{value: string, label: string}>} [options.mapOptions]
     * @param {Array<{value: string, label: string}>} [options.vehicleOptions]
     * @param {object} [options.handlers]
     * @returns {boolean}
     */
    mount({ keyBindings = [], playerColors = [], mapOptions = [], vehicleOptions = [], handlers = {} } = {}) {
        if (!this.document || isMobileProductSurface(this.document) || this._nodes) return false;
        const grid = this.document.querySelector('#submenu-custom .level2-mode-grid');
        const submenuBody = this.document.querySelector('#submenu-custom .submenu-body');
        if (!grid || !submenuBody) return false;

        const card = createStaticElement(this.document, `
            <button type="button" id="btn-three-player-split"
                class="mode-btn menu-choice-card three-player-split-entry hidden">
                <span class="menu-choice-eyebrow">Lokales Modul</span>
                <span class="menu-choice-title">3 Spieler – Splitscreen</span>
                <span class="menu-choice-copy">Tastatur und Gamepads frei pro Spieler, volle 3D-Flugphysik</span>
            </button>`);
        grid.appendChild(card);

        const surface = createStaticElement(this.document, `
            <section id="three-player-split-setup" class="menu-section three-player-split-setup hidden"
                aria-labelledby="three-player-split-setup-title">
              <div class="three-player-split-setup-header">
                <div>
                    <h2 id="three-player-split-setup-title" class="section-title">3 Spieler – Splitscreen</h2>
                    <p class="menu-hint">Drei lokale Spieler · Third Person · volle 3D-Flugphysik</p>
                </div>
            </div>
            <div class="three-player-split-fields">
                <label>Modus<select data-three-player-split-mode>
                    <option value="classic">Klassisch</option>
                    <option value="hunt">Kampf</option>
                </select></label>
                <label>Karte<select data-three-player-split-map></select></label>
                <label>Gemeinsames Fahrzeug<select data-three-player-split-vehicle></select></label>
                <label>Bots <span data-three-player-split-bot-label>0</span>
                    <input data-three-player-split-bots type="range" min="0" max="6" step="1" value="0">
                </label>
            </div>
            <details class="three-player-split-controls" open>
                <summary>Geräte-Zuordnung</summary>
                <div class="three-player-split-devices" aria-label="Geräte-Zuordnung für drei Spieler"></div>
                <p class="menu-hint">Jeder Spieler kann unabhängig Tastatur oder ein eigenes Gamepad nutzen.</p>
            </details>
            <p class="menu-hint three-player-split-device-status" id="three-player-split-device-status"
                data-three-player-split-device-status role="status" aria-live="polite" hidden></p>
            <button type="button" class="start-btn" data-three-player-split-start
                aria-describedby="three-player-split-device-status">3-Spieler-Match starten</button>
            </section>`);
        submenuBody.appendChild(surface);

        const mapSelect = surface.querySelector('[data-three-player-split-map]');
        for (const option of mapOptions) {
            mapSelect.appendChild(createOption(this.document, option.value, option.label));
        }
        const vehicleSelect = surface.querySelector('[data-three-player-split-vehicle]');
        for (const option of vehicleOptions) {
            vehicleSelect.appendChild(createOption(this.document, option.value, option.label));
        }

        const devices = surface.querySelector('.three-player-split-devices');
        const deviceSelects = keyBindings.map((_, index) => {
            const row = createStaticElement(this.document, `
                <div class="three-player-split-device-row">
                    <strong>P${index + 1}</strong>
                    <select data-three-player-split-device data-player-index="${index}">
                        ${Object.entries(DEVICE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
                    </select>
                    <p class="menu-hint" data-three-player-split-keyboard-hint hidden>Tastaturbelegung Spieler ${index + 1}: ${keyBindings[index]?.label || ''}</p>
                </div>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            devices.appendChild(row);
            return row.querySelector('[data-three-player-split-device]');
        });

        this._nodes = {
            card,
            surface,
            standardSections: Array.from(submenuBody.children).filter((node) => node !== surface),
            mode: surface.querySelector('[data-three-player-split-mode]'),
            map: mapSelect,
            vehicle: vehicleSelect,
            bots: surface.querySelector('[data-three-player-split-bots]'),
            botLabel: surface.querySelector('[data-three-player-split-bot-label]'),
            deviceSelects,
            keyboardHints: Array.from(surface.querySelectorAll('[data-three-player-split-keyboard-hint]')),
            deviceStatus: surface.querySelector('[data-three-player-split-device-status]'),
            start: surface.querySelector('[data-three-player-split-start]'),
        };

        this._wireHandlers(handlers);
        return true;
    }

    _wireHandlers(handlers) {
        const nodes = this._nodes;
        this._listen(nodes.card, 'click', () => handlers.onOpenRequested?.());
        this._headerBack = bindLocalModuleHeaderBack({
            documentRef: this.document,
            surface: nodes.surface,
            onClose: () => handlers.onCloseRequested?.(),
            listen: (target, type, handler, options) => this._listen(target, type, handler, options),
        });
        this._listen(nodes.start, 'click', () => handlers.onStartRequested?.());
        for (const control of [nodes.mode, nodes.map, nodes.vehicle, nodes.bots]) {
            this._listen(control, 'input', () => handlers.onControlChanged?.());
            this._listen(control, 'change', () => handlers.onControlChanged?.());
        }
        nodes.deviceSelects.forEach((control, index) => {
            this._listen(control, 'change', () => handlers.onDeviceAssignmentChanged?.(index));
        });
        this._listen(this.document.defaultView, 'gamepadconnected', () => handlers.onDeviceAvailabilityChanged?.());
        this._listen(this.document.defaultView, 'gamepaddisconnected', () => handlers.onDeviceAvailabilityChanged?.());
        for (const sessionButton of Array.from(this.document.querySelectorAll('[data-session-type]'))) {
            this._listen(sessionButton, 'click', () => this._scheduleFrame(() => handlers.onSessionTypeChanged?.()));
        }
        for (const standardModeButton of Array.from(this.document.querySelectorAll('#submenu-custom [data-mode-path]'))) {
            this._listen(standardModeButton, 'click', () => handlers.onStandardModeSelected?.());
        }
    }

    _scheduleFrame(callback) {
        const view = this.document?.defaultView;
        const scheduleFrame = view?.requestAnimationFrame;
        if (typeof scheduleFrame === 'function') {
            scheduleFrame.call(view, callback);
        } else {
            queueMicrotask(callback);
        }
    }

    _listen(target, type, handler, options = undefined) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler, options);
        this._listeners.push(() => target.removeEventListener(type, handler, options));
    }

    // The keyboard note belongs only to the slot that currently has the keyboard.
    _syncKeyboardHints() {
        this._nodes.deviceSelects.forEach((select, index) => {
            const hint = this._nodes.keyboardHints[index];
            if (hint) hint.hidden = select.value !== 'keyboard';
        });
    }

    /**
     * Fills the map list again, e.g. after the desktop editor saved or deleted a
     * map. The current choice stays selected while it is still offered.
     * @param {Array<{value: string, label: string}>} mapOptions
     */
    setMapOptions(mapOptions = []) {
        const select = this._nodes?.map;
        if (!select) return;
        const previous = select.value;
        select.replaceChildren(...mapOptions.map((option) => createOption(this.document, option.value, option.label)));
        if (mapOptions.some((option) => option.value === previous)) select.value = previous;
    }

    setEntryVisible(visible) {
        if (!this._nodes) return;
        this._nodes.card.classList.toggle('hidden', !visible);
        this._nodes.card.setAttribute('aria-hidden', String(!visible));
    }

    /** @returns {{mode: string, mapKey: string, vehicleId: string, botCount: string, deviceAssignment: string[]}|null} */
    readControls() {
        if (!this._nodes) return null;
        return {
            mode: this._nodes.mode.value,
            mapKey: this._nodes.map.value,
            vehicleId: this._nodes.vehicle.value,
            botCount: this._nodes.bots.value,
            deviceAssignment: this._nodes.deviceSelects.map((select) => select.value),
        };
    }

    applySelection(selection) {
        if (!this._nodes) return;
        this._nodes.mode.value = selection.mode;
        this._nodes.map.value = selection.mapKey;
        this._nodes.vehicle.value = selection.vehicleId;
        this._nodes.bots.value = String(selection.botCount);
        this._nodes.botLabel.textContent = String(selection.botCount);
        this._nodes.deviceSelects.forEach((select, index) => {
            select.value = selection.deviceAssignment?.[index] || select.value;
        });
        this._syncKeyboardHints();
    }

    applyNormalizedSelection(selection) {
        if (!this._nodes) return;
        this._nodes.map.value = selection.mapKey;
        this._nodes.botLabel.textContent = String(selection.botCount);
        this._nodes.deviceSelects.forEach((select, index) => {
            select.value = selection.deviceAssignment?.[index] || select.value;
        });
        this._syncKeyboardHints();
    }

    setDeviceStatus(message) {
        if (!this._nodes) return;
        this._nodes.deviceStatus.textContent = message;
        this._nodes.deviceStatus.hidden = !message;
    }

    /** @param {{blocked?: boolean, reason?: string}} [availability] */
    setStartAvailability({ blocked = false, reason = '' } = {}) {
        if (!this._nodes) return;
        this._nodes.start.disabled = blocked === true;
        this._nodes.start.title = blocked ? String(reason || '') : '';
    }

    openSetup() {
        if (!this._nodes) return;
        for (const node of this._nodes.standardSections) node.classList.add('three-player-split-standard-hidden');
        this._nodes.surface.classList.remove('hidden');
        this._headerBack?.syncOpen(true);
        this._nodes.mode.focus?.();
    }

    closeSetup() {
        if (!this._nodes) return;
        for (const node of this._nodes.standardSections) node.classList.remove('three-player-split-standard-hidden');
        this._nodes.surface.classList.add('hidden');
        this._headerBack?.syncOpen(false);
    }

    dispose() {
        for (const disposeListener of this._listeners.splice(0)) disposeListener();
        this._nodes?.surface?.remove?.();
        this._nodes?.card?.remove?.();
        this._nodes = null;
    }
}
