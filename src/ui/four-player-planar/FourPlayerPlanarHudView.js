function createStaticElement(documentRef, markup) {
    const range = documentRef.createRange();
    const fragment = range.createContextualFragment(String(markup || '').trim());
    return fragment.firstElementChild;
}

function colorToCss(color) {
    return `#${Number(color).toString(16).padStart(6, '0')}`;
}

/**
 * Owns the quadrant HUD nodes of the four player planar match. Value diffing
 * stays in the module; this view only writes what it is told to write.
 */
export class FourPlayerPlanarHudView {
    constructor({ documentRef = globalThis.document } = {}) {
        this.document = documentRef || null;
        this._root = null;
        this._rows = [];
    }

    hasRoot() {
        return !!this._root;
    }

    setRuntimeSurfaceActive(active) {
        const classList = this.document?.documentElement?.classList;
        if (!classList) return;
        if (active) classList.add('four-player-planar-active');
        else classList.remove('four-player-planar-active');
    }

    /**
     * @param {object} options
     * @param {number} options.playerCount
     * @param {ReadonlyArray<number>} options.playerColors
     * @returns {boolean}
     */
    ensureRows({ playerCount, playerColors = [] }) {
        if (this._root) return true;
        if (!this.document) return false;
        const hud = this.document.getElementById('hud');
        if (!hud) return false;
        const root = this.document.createElement('div');
        root.id = 'four-player-planar-hud';
        root.className = 'four-player-planar-hud hidden';
        for (let index = 0; index < playerCount; index += 1) {
            const row = createStaticElement(this.document, `
                <section class="four-player-planar-hud-quadrant q${index + 1}" aria-label="HUD Spieler ${index + 1}">
                    <div class="four-player-planar-hud-card">
                        <strong data-fpp-player>P${index + 1}</strong>
                        <span data-fpp-stat>–</span>
                        <span data-fpp-item>Kein Item</span>
                    </div>
                </section>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            root.appendChild(row);
            this._rows.push({
                stat: row.querySelector('[data-fpp-stat]'),
                item: row.querySelector('[data-fpp-item]'),
            });
        }
        hud.appendChild(root);
        this._root = root;
        return true;
    }

    setVisible(visible) {
        if (!this._root) return;
        this._root.classList.toggle('hidden', !visible);
    }

    /**
     * @param {number} playerIndex
     * @param {'stat'|'item'} field
     * @param {string} text
     */
    setRowText(playerIndex, field, text) {
        const target = this._rows[playerIndex]?.[field];
        if (target) target.textContent = text;
    }

    hasRow(playerIndex) {
        return !!this._rows[playerIndex];
    }

    dispose() {
        this._root?.remove?.();
        this._root = null;
        this._rows.length = 0;
    }
}
