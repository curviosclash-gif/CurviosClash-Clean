// ─── Arcade Mission HUD: In-Game Mission Display Overlay ───

import { formatMissionProgress, MISSION_TYPES } from '../../shared/contracts/ArcadeMissionContract.js';

const MISSION_ICON_MAP = {
    crosshair: '\u2316',
    gem: '\u2666',
    clock: '\u23F1',
    portal: '\u26CE',
    stopwatch: '\u23F1',
};

function createElement(tag, className, textContent = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
}

export class ArcadeMissionHUD {
    constructor(parentElement) {
        this._parent = parentElement || document.body;
        this._container = null;
        this._missionElements = [];
        this._visible = false;
        this._lastState = null;
        this._build();
    }

    _build() {
        this._container = createElement('div', 'arcade-mission-hud');
        this._container.id = 'arcade-mission-hud';
        this._container.style.cssText = [
            'position: fixed',
            'top: 12px',
            'right: 12px',
            'z-index: 900',
            'display: none',
            'flex-direction: column',
            'gap: 6px',
            'pointer-events: none',
            'font-family: monospace',
            'font-size: 13px',
        ].join(';');
        this._parent.appendChild(this._container);
    }

    show() {
        if (this._container) {
            this._container.style.display = 'flex';
            this._visible = true;
        }
    }

    hide() {
        if (this._container) {
            this._container.style.display = 'none';
            this._visible = false;
        }
    }

    update(missionState) {
        if (!missionState || !Array.isArray(missionState.missions)) {
            this.hide();
            return;
        }
        if (!this._visible) this.show();

        const missions = missionState.missions;

        // Rebuild mission elements if count changed
        if (this._missionElements.length !== missions.length) {
            this._container.innerHTML = '';
            this._missionElements = [];
            for (let i = 0; i < missions.length; i += 1) {
                const card = createElement('div', 'arcade-mission-card');
                card.style.cssText = [
                    'background: rgba(0,0,0,0.7)',
                    'border-left: 3px solid #00ff88',
                    'padding: 4px 10px',
                    'border-radius: 3px',
                    'color: #e0e0e0',
                    'min-width: 160px',
                ].join(';');

                const header = createElement('div', 'arcade-mission-header');
                header.style.cssText = 'display:flex;align-items:center;gap:6px;';
                const icon = createElement('span', 'arcade-mission-icon');
                const label = createElement('span', 'arcade-mission-label');
                header.appendChild(icon);
                header.appendChild(label);

                const progressWrap = createElement('div', 'arcade-mission-progress-wrap');
                progressWrap.style.cssText = 'margin-top:3px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden;';
                const progressBar = createElement('div', 'arcade-mission-progress-bar');
                progressBar.style.cssText = 'height:100%;background:#00ff88;transition:width 0.2s ease;width:0%;';
                progressWrap.appendChild(progressBar);

                const progressText = createElement('span', 'arcade-mission-progress-text');
                progressText.style.cssText = 'font-size:11px;color:#aaa;';

                card.appendChild(header);
                card.appendChild(progressWrap);
                card.appendChild(progressText);
                this._container.appendChild(card);

                this._missionElements.push({ card, icon, label, progressBar, progressText });
            }
        }

        // Update each mission element
        for (let i = 0; i < missions.length; i += 1) {
            const mission = missions[i];
            const el = this._missionElements[i];
            if (!el) continue;

            const typeDef = MISSION_TYPES[mission.type];
            el.icon.textContent = MISSION_ICON_MAP[typeDef?.icon] || '\u2022';
            el.label.textContent = typeDef?.label || mission.type;
            el.progressText.textContent = formatMissionProgress(mission);

            // Progress bar
            const progress = mission.progress || {};
            let fraction = 0;
            if (mission.completed) {
                fraction = 1;
            } else if (mission.type === 'KILL_COUNT') {
                fraction = Math.min(1, (progress.kills || 0) / (progress.target || 1));
            } else if (mission.type === 'COLLECT_ITEMS') {
                fraction = Math.min(1, (progress.collected || 0) / (progress.target || 1));
            } else if (mission.type === 'SURVIVE_DURATION') {
                fraction = Math.min(1, (progress.survived || 0) / (progress.target || 1));
            } else if (mission.type === 'REACH_PORTAL') {
                fraction = progress.reached ? 1 : 0;
            } else if (mission.type === 'TIME_TRIAL') {
                fraction = progress.elapsed > 0 ? Math.min(1, progress.elapsed / (progress.target || 1)) : 0;
            }
            el.progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;

            // Completed styling
            if (mission.completed) {
                el.card.style.borderLeftColor = '#44ff44';
                el.progressBar.style.background = '#44ff44';
                el.label.textContent += ' \u2713';
            } else {
                el.card.style.borderLeftColor = '#00ff88';
                el.progressBar.style.background = '#00ff88';
            }
        }

        this._lastState = missionState;
    }

    dispose() {
        if (this._container?.parentElement) {
            this._container.parentElement.removeChild(this._container);
        }
        this._container = null;
        this._missionElements = [];
    }
}
