import { MatchHudAnnouncement } from '../MatchHudAnnouncement.js';

function createStaticElement(documentRef, markup) {
    const range = documentRef.createRange();
    const fragment = range.createContextualFragment(String(markup || '').trim());
    return fragment.firstElementChild;
}

function colorToCss(color) {
    return `#${Number(color).toString(16).padStart(6, '0')}`;
}

/**
 * Owns the three equal-width column HUD nodes of the three player split
 * match. Value diffing stays in the module; this view only writes what it
 * is told to write - mirrors FourPlayerPlanarHudView but with its own root
 * id/class so both HUDs can exist in the DOM without colliding (only one
 * is ever visible at a time, since the two variants are session-exclusive).
 */
export class ThreePlayerSplitHudView {
    constructor({ documentRef = globalThis.document } = {}) {
        this.document = documentRef || null;
        this._root = null;
        this._rows = [];
        this._announcement = null;
    }

    hasRoot() {
        return !!this._root;
    }

    setRuntimeSurfaceActive(active) {
        const classList = this.document?.documentElement?.classList;
        if (!classList) return;
        if (active) classList.add('three-player-split-active');
        else classList.remove('three-player-split-active');
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
        root.id = 'three-player-split-hud';
        root.className = 'three-player-split-hud hidden';
        for (let index = 0; index < playerCount; index += 1) {
            const row = createStaticElement(this.document, `
                <section class="three-player-split-hud-column c${index + 1}" aria-label="HUD Spieler ${index + 1}">
                    <div class="three-player-split-hud-card">
                        <strong data-tps-player>P${index + 1}</strong>
                        <span data-tps-stat>–</span>
                        <span data-tps-rank>Rang –</span>
                        <span data-tps-item>Kein Item</span>
                    </div>
                </section>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            root.appendChild(row);
            this._rows.push({
                stat: row.querySelector('[data-tps-stat]'),
                rank: row.querySelector('[data-tps-rank]'),
                item: row.querySelector('[data-tps-item]'),
            });
        }
        hud.appendChild(root);
        this._root = root;
        this._announcement = new MatchHudAnnouncement(root);
        return true;
    }

    setVisible(visible) {
        if (!this._root) return;
        this._root.classList.toggle('hidden', !visible);
    }

    /**
     * @param {number} playerIndex
     * @param {'stat'|'rank'|'item'} field
     * @param {string} text
     */
    setRowText(playerIndex, field, text) {
        const target = this._rows[playerIndex]?.[field];
        if (target) target.textContent = text;
    }

    hasRow(playerIndex) {
        return !!this._rows[playerIndex];
    }

    observeScores(rows, options) {
        this._announcement?.observe(rows, options);
    }

    resetScoreEvent() {
        this._announcement?.reset();
    }

    dispose() {
        this._announcement?.dispose();
        this._announcement = null;
        this._root?.remove?.();
        this._root = null;
        this._rows.length = 0;
    }
}
