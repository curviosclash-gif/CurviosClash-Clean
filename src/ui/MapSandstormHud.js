import { MAP_SANDSTORM_PHASES } from '../shared/contracts/MapSandstormContract.js';

function createElement(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

const CUE_TOP_IN_VIEW = 0.18;

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
        this.lastStatusText = '';
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
            this.cues.push({ root: cue, arrow, anchorKey: '' });
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
        const remaining = Math.max(0, Number(state?.remainingSeconds) || 0);
        if (enabled && phase === MAP_SANDSTORM_PHASES.WARNING) {
            const seconds = Math.max(0, Math.ceil(remaining));
            const text = `Sandsturm in ${seconds} Sekunden`;
            if (text !== this.lastStatusText) {
                this.root.textContent = text;
                this.lastStatusText = text;
            }
            this.root.setAttribute('aria-live', [20, 10, 5].includes(seconds) ? 'assertive' : 'off');
            this.root.classList.remove('hidden');
        } else if (enabled && phase === MAP_SANDSTORM_PHASES.ACTIVE) {
            const text = `Sandsturm · ${Math.max(0, Math.ceil(remaining))} s`;
            if (text !== this.lastStatusText) {
                this.root.textContent = text;
                this.lastStatusText = text;
            }
            this.root.setAttribute('aria-live', 'off');
            this.root.classList.remove('hidden');
        } else {
            this.root.classList.add('hidden');
            this.root.textContent = '';
            this.root.setAttribute('aria-live', 'polite');
            this.lastStatusText = '';
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
            cue.root.classList.toggle('hidden', !cueState?.active);
            if (cueState?.active) {
                cue.arrow.style.transform = `rotate(${Number(cueState.angleDegrees) || 0}deg)`;
            }
        }
    }

    reset() {
        this.root.classList.add('hidden');
        this.root.textContent = '';
        this.root.setAttribute('aria-live', 'polite');
        this.lastStatusText = '';
        for (let index = 0; index < this.cues.length; index += 1) {
            this.cues[index].root.classList.add('hidden');
        }
    }

    dispose() {
        this.root.remove();
        for (let index = 0; index < this.cues.length; index += 1) this.cues[index].root.remove();
        this.cues.length = 0;
    }
}
