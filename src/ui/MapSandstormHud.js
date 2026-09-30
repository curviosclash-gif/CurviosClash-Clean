import { MAP_SANDSTORM_PHASES } from '../shared/contracts/MapSandstormContract.js';

function createElement(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

const CUE_TOP_IN_VIEW = 0.18;
const WARNING_ANNOUNCE_SECONDS = new Set([20, 10, 5]);

function toPercent(value) {
    return `${Math.round(value * 100) / 100}%`;
}

// Column/row grid of the local player views, matching the renderer viewport layouts.
function resolveCueGrid(viewportLayout, localHumanCount) {
    if (viewportLayout === 'three_columns') return { columns: 3, rows: 1 };
    if (viewportLayout === 'three_rows') return { columns: 1, rows: 3 };
    if (viewportLayout === 'four_grid') return { columns: 2, rows: 2 };
    if (viewportLayout === 'single') return { columns: 1, rows: 1 };
    return localHumanCount >= 2 ? { columns: 2, rows: 1 } : { columns: 1, rows: 1 };
}

export class MapSandstormHud {
    constructor(parent = document.body) {
        this.parent = parent || document.body;
        this.root = createElement('div', 'map-sandstorm-status hidden');
        this.root.id = 'map-sandstorm-status';
        this.root.setAttribute('role', 'status');
        this.root.setAttribute('aria-live', 'polite');
        this.root.setAttribute('aria-atomic', 'true');
        this.parent.appendChild(this.root);
        this.cues = [];
        this.lastStatusKey = '';
    }

    _showStatus(text, live) {
        this.root.textContent = text;
        this.root.setAttribute('aria-live', live);
        this.root.classList.remove('hidden');
    }

    _ensureCue(index) {
        while (this.cues.length <= index) {
            const cueIndex = this.cues.length;
            const cue = createElement('div', `sandstorm-proximity-cue p${cueIndex + 1} hidden`);
            cue.setAttribute('aria-hidden', 'true');
            const arrow = createElement('span', 'sandstorm-proximity-arrow', '▲');
            const label = createElement('span', 'sandstorm-proximity-label', 'BEWEGUNG IN DER NÄHE');
            cue.append(arrow, label);
            this.parent.appendChild(cue);
            this.cues.push({ root: cue, arrow, anchorKey: '', shown: false, angle: null });
        }
        return this.cues[index];
    }

    _placeCue(cue, slot, grid) {
        const key = `${grid.columns}x${grid.rows}:${slot}`;
        if (cue.anchorKey === key) return;
        cue.anchorKey = key;
        const column = slot % grid.columns;
        const row = Math.floor(slot / grid.columns) % grid.rows;
        cue.root.style.left = toPercent(((column + 0.5) / grid.columns) * 100);
        cue.root.style.top = toPercent(((row + CUE_TOP_IN_VIEW) / grid.rows) * 100);
    }

    update(state, entityManager, {
        localHumanCount = 1, localPlayerIndex = 0, network = false, viewportLayout = null,
    } = {}) {
        const enabled = state?.enabled === true;
        const phase = String(state?.phase || MAP_SANDSTORM_PHASES.CALM);
        const seconds = Math.max(0, Math.ceil(Number(state?.remainingSeconds) || 0));
        // Runs every frame on every map: touch the DOM only when the phase or the shown second changes.
        const statusKey = enabled && phase !== MAP_SANDSTORM_PHASES.CALM ? `${phase}:${seconds}` : '';
        if (statusKey !== this.lastStatusKey) {
            this.lastStatusKey = statusKey;
            if (phase === MAP_SANDSTORM_PHASES.WARNING && statusKey) {
                this._showStatus(`Sandsturm in ${seconds} Sekunden`, WARNING_ANNOUNCE_SECONDS.has(seconds) ? 'assertive' : 'off');
            } else if (statusKey) {
                this._showStatus(`Sandsturm · ${seconds} s`, 'off');
            } else {
                this.reset();
            }
        }

        const visibleCueCount = enabled && phase === MAP_SANDSTORM_PHASES.ACTIVE
            ? Math.max(1, Number(localHumanCount) || 1)
            : 0;
        const grid = resolveCueGrid(viewportLayout, visibleCueCount);
        for (let slot = 0; slot < Math.max(this.cues.length, visibleCueCount); slot += 1) {
            const cue = this._ensureCue(slot);
            if (slot < visibleCueCount) this._placeCue(cue, slot, grid);
            const playerIndex = network ? localPlayerIndex : slot;
            const cueState = slot < visibleCueCount
                ? entityManager?.getSandstormProximityCue?.(playerIndex)
                : null;
            const shown = cueState?.active === true;
            if (shown !== cue.shown) {
                cue.shown = shown;
                cue.root.classList.toggle('hidden', !shown);
            }
            const angle = shown ? Math.round(Number(cueState.angleDegrees) || 0) : cue.angle;
            if (angle !== cue.angle) {
                cue.angle = angle;
                cue.arrow.style.transform = `rotate(${angle}deg)`;
            }
        }
    }

    reset() {
        this.root.classList.add('hidden');
        this.root.textContent = '';
        this.root.setAttribute('aria-live', 'polite');
        this.lastStatusKey = '';
        for (let index = 0; index < this.cues.length; index += 1) {
            this.cues[index].root.classList.add('hidden');
            this.cues[index].shown = false;
        }
    }

    dispose() {
        this.root.remove();
        for (let index = 0; index < this.cues.length; index += 1) this.cues[index].root.remove();
        this.cues.length = 0;
    }
}
