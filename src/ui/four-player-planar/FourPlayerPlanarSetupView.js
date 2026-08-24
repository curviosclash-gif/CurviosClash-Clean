const ROLL_KEY_LABELS = { left: 'Rolle links', right: 'Rolle rechts' };

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

export function formatKeyCode(code) {
    const labels = {
        ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
        PageUp: 'Bild ↑', PageDown: 'Bild ↓',
    };
    if (labels[code]) return labels[code];
    if (String(code).startsWith('Key')) return String(code).slice(3);
    if (String(code).startsWith('Numpad')) return `Num ${String(code).slice(6)}`;
    return String(code);
}

function isMobileProductSurface(documentRef) {
    const appTarget = String(documentRef?.documentElement?.dataset?.appTarget || '').trim().toLowerCase();
    return appTarget === 'mobile-classic' || appTarget === 'mobile-arcade';
}

/**
 * Owns every DOM node of the four player planar setup surface. The module keeps
 * the selection logic and only exchanges plain values with this view.
 */
export class FourPlayerPlanarSetupView {
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
            <button type="button" id="btn-four-player-planar"
                class="mode-btn menu-choice-card four-player-planar-entry hidden">
                <span class="menu-choice-eyebrow">Lokales Modul</span>
                <span class="menu-choice-title">4 Spieler – Planar</span>
                <span class="menu-choice-copy">Classic oder Hunt im 2×2-Splitscreen</span>
            </button>`);
        grid.appendChild(card);

        const surface = createStaticElement(this.document, `
            <section id="four-player-planar-setup" class="menu-section four-player-planar-setup hidden"
                aria-labelledby="four-player-planar-setup-title">
              <div class="four-player-planar-setup-header">
                <button type="button" class="back-btn" data-four-player-planar-back aria-label="Zurück zur Spielstilwahl">← Zurück</button>
                <div>
                    <h2 id="four-player-planar-setup-title" class="section-title">4 Spieler – Planar</h2>
                    <p class="menu-hint">Vier lokale Tastaturspieler · Third Person · Pitch gesperrt</p>
                </div>
            </div>
            <div class="four-player-planar-fields">
                <label>Modus<select data-four-player-planar-mode>
                    <option value="classic">Classic</option>
                    <option value="hunt">Hunt</option>
                </select></label>
                <label>Karte<select data-four-player-planar-map></select></label>
                <label>Gemeinsames Fahrzeug<select data-four-player-planar-vehicle></select></label>
                <label>Bots <span data-four-player-planar-bot-label>0</span>
                    <input data-four-player-planar-bots type="range" min="0" max="6" step="1" value="0">
                </label>
            </div>
            <details class="four-player-planar-controls">
                <summary>Tastenbelegung</summary>
                <div class="four-player-planar-keys" aria-label="Tastenbelegung für vier Spieler"></div>
                <p class="menu-hint" data-four-player-planar-key-hint>Roll-Taste anklicken und neue Taste drücken.</p>
            </details>
            <p class="menu-hint">Hinweis: Hardwarebedingtes Keyboard-Ghosting kann bei manchen Tastaturen auftreten.</p>
            <button type="button" class="start-btn" data-four-player-planar-start>4-Spieler-Match starten</button>
            </section>`);
        submenuBody.appendChild(surface);

        const mapSelect = surface.querySelector('[data-four-player-planar-map]');
        for (const option of mapOptions) {
            mapSelect.appendChild(createOption(this.document, option.value, option.label));
        }
        const vehicleSelect = surface.querySelector('[data-four-player-planar-vehicle]');
        for (const option of vehicleOptions) {
            vehicleSelect.appendChild(createOption(this.document, option.value, option.label));
        }
        const keys = surface.querySelector('.four-player-planar-keys');
        keyBindings.forEach((binding, index) => {
            const row = createStaticElement(this.document, `
                <div class="four-player-planar-key-row">
                    <strong>P${index + 1}</strong>
                    <span>Lenken / Aktion: ${binding.label}</span>
                    <button type="button" class="secondary-btn" data-four-player-roll-key="left" data-player-index="${index}"></button>
                    <button type="button" class="secondary-btn" data-four-player-roll-key="right" data-player-index="${index}"></button>
                </div>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            keys.appendChild(row);
        });

        this._nodes = {
            card,
            surface,
            standardSections: Array.from(submenuBody.children).filter((node) => node !== surface),
            mode: surface.querySelector('[data-four-player-planar-mode]'),
            map: mapSelect,
            vehicle: vehicleSelect,
            bots: surface.querySelector('[data-four-player-planar-bots]'),
            botLabel: surface.querySelector('[data-four-player-planar-bot-label]'),
            rollButtons: Array.from(surface.querySelectorAll('[data-four-player-roll-key]')),
            keyHint: surface.querySelector('[data-four-player-planar-key-hint]'),
            back: surface.querySelector('[data-four-player-planar-back]'),
            start: surface.querySelector('[data-four-player-planar-start]'),
        };

        this._wireHandlers(handlers);
        return true;
    }

    _wireHandlers(handlers) {
        const nodes = this._nodes;
        this._listen(nodes.card, 'click', () => handlers.onOpenRequested?.());
        this._listen(nodes.back, 'click', () => handlers.onCloseRequested?.());
        this._listen(nodes.start, 'click', () => handlers.onStartRequested?.());
        for (const button of nodes.rollButtons) {
            this._listen(button, 'click', () => handlers.onRollKeyRequested?.({
                playerIndex: Number(button.dataset.playerIndex),
                direction: button.dataset.fourPlayerRollKey,
            }));
        }
        this._listen(this.document, 'keydown', (event) => handlers.onKeyDown?.(event));
        for (const control of [nodes.mode, nodes.map, nodes.vehicle, nodes.bots]) {
            this._listen(control, 'input', () => handlers.onControlChanged?.());
            this._listen(control, 'change', () => handlers.onControlChanged?.());
        }
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

    _listen(target, type, handler) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler);
        this._listeners.push(() => target.removeEventListener(type, handler));
    }

    setEntryVisible(visible) {
        if (!this._nodes) return;
        this._nodes.card.classList.toggle('hidden', !visible);
        this._nodes.card.setAttribute('aria-hidden', String(!visible));
    }

    /** @returns {{mode: string, mapKey: string, vehicleId: string, botCount: string}|null} */
    readControls() {
        if (!this._nodes) return null;
        return {
            mode: this._nodes.mode.value,
            mapKey: this._nodes.map.value,
            vehicleId: this._nodes.vehicle.value,
            botCount: this._nodes.bots.value,
        };
    }

    applySelection(selection) {
        if (!this._nodes) return;
        this._nodes.mode.value = selection.mode;
        this._nodes.map.value = selection.mapKey;
        this._nodes.vehicle.value = selection.vehicleId;
        this._nodes.bots.value = String(selection.botCount);
        this._nodes.botLabel.textContent = String(selection.botCount);
    }

    applyNormalizedSelection(selection) {
        if (!this._nodes) return;
        this._nodes.map.value = selection.mapKey;
        this._nodes.botLabel.textContent = String(selection.botCount);
    }

    syncRollKeyButtons(rollBindings) {
        for (const button of this._nodes?.rollButtons || []) {
            const playerIndex = Number(button.dataset.playerIndex);
            const direction = button.dataset.fourPlayerRollKey;
            const code = rollBindings?.[playerIndex]?.[direction] || '';
            button.textContent = `${ROLL_KEY_LABELS[direction] || direction}: ${formatKeyCode(code)}`;
        }
    }

    showRollKeyCapture(playerIndex, direction) {
        const button = (this._nodes?.rollButtons || []).find((candidate) => (
            Number(candidate.dataset.playerIndex) === playerIndex
            && candidate.dataset.fourPlayerRollKey === direction
        ));
        if (button) button.textContent = 'Taste drücken …';
        this.setKeyHint(`Neue Taste für P${playerIndex + 1} drücken · Esc bricht ab.`);
    }

    showKeyOccupied(code) {
        this.setKeyHint(`${formatKeyCode(code)} ist bereits belegt.`);
    }

    setKeyHint(text) {
        if (this._nodes?.keyHint) this._nodes.keyHint.textContent = text;
    }

    openSetup() {
        if (!this._nodes) return;
        for (const node of this._nodes.standardSections) node.classList.add('four-player-planar-standard-hidden');
        this._nodes.surface.classList.remove('hidden');
        this._nodes.mode.focus?.();
    }

    closeSetup() {
        if (!this._nodes) return;
        for (const node of this._nodes.standardSections) node.classList.remove('four-player-planar-standard-hidden');
        this._nodes.surface.classList.add('hidden');
    }

    dispose() {
        for (const disposeListener of this._listeners.splice(0)) disposeListener();
        this._nodes?.surface?.remove?.();
        this._nodes?.card?.remove?.();
        this._nodes = null;
    }
}
