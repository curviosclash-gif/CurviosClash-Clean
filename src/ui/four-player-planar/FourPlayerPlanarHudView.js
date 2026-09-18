import { HuntInterceptAnnouncer } from '../HuntInterceptAnnouncer.js';
import { MatchHudAnnouncement } from '../MatchHudAnnouncement.js';
import { MultiPlayerHudRocketWarnings } from './MultiPlayerHudRocketWarning.js';

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
        this._announcement = null;
        this._intercepts = new HuntInterceptAnnouncer();
        this._warnings = new MultiPlayerHudRocketWarnings('four-player-planar');
        this._localPlayerIndices = [];
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
                        <span data-fpp-rank>Rang –</span>
                        <span data-fpp-item>Kein Item</span>
                    </div>
                </section>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            root.appendChild(row);
            this._warnings.mount(this.document, row, index);
            this._localPlayerIndices.push(index);
            this._rows.push({
                stat: row.querySelector('[data-fpp-stat]'),
                rank: row.querySelector('[data-fpp-rank]'),
                item: row.querySelector('[data-fpp-item]'),
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

    /**
     * Writes the inbound rocket banner of one quadrant.
     *
     * @param {number} playerIndex
     * @param {any} player live player of that quadrant, or null
     * @param {any} rocketThreat threat of that player, or null
     * @param {boolean} huntActive
     * @param {boolean} reduceMotion
     */
    updateRocketWarning(playerIndex, player, rocketThreat, huntActive, reduceMotion) {
        this._warnings.update(playerIndex, player, rocketThreat, huntActive, reduceMotion);
    }

    observeScores(rows, options) {
        this._announcement?.observe(rows, options);
        // Every human here shares one screen, so one announcement area serves all of
        // them - the message therefore names the player who intercepted.
        const interceptMessage = this._intercepts.consume(rows, this._localPlayerIndices);
        if (interceptMessage) this._announcement?.show(interceptMessage);
    }

    resetScoreEvent() {
        this._announcement?.reset();
        this._intercepts.reset();
        this._warnings.hideAll();
    }

    dispose() {
        this._announcement?.dispose();
        this._announcement = null;
        this._intercepts.reset();
        this._warnings.dispose();
        this._localPlayerIndices.length = 0;
        this._root?.remove?.();
        this._root = null;
        this._rows.length = 0;
    }
}
