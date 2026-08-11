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

function resolveProgressFraction(entry, isObjective = false) {
    if (isObjective) return Math.max(0, Math.min(1, Number(entry?.progressFraction) || 0));
    const progress = entry?.progress || {};
    if (entry?.completed) return 1;
    if (entry?.type === 'KILL_COUNT') return Math.min(1, (progress.kills || 0) / (progress.target || 1));
    if (entry?.type === 'COLLECT_ITEMS') return Math.min(1, (progress.collected || 0) / (progress.target || 1));
    if (entry?.type === 'SURVIVE_DURATION') return Math.min(1, (progress.survived || 0) / (progress.target || 1));
    if (entry?.type === 'REACH_PORTAL') return progress.reached ? 1 : 0;
    if (entry?.type === 'TIME_TRIAL') return progress.elapsed > 0 ? Math.min(1, progress.elapsed / (progress.target || 1)) : 0;
    return 0;
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
            'top: 224px',
            'right: 12px',
            'z-index: 900',
            'display: none',
            'flex-direction: column',
            'gap: 6px',
            'pointer-events: none',
            'font-family: monospace',
            'font-size: 12px',
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

    update(missionState, objectiveState = null) {
        const missions = Array.isArray(missionState?.missions) ? missionState.missions : [];
        const hasObjective = !!objectiveState && typeof objectiveState === 'object';
        const entryCount = missions.length + (hasObjective ? 1 : 0);
        if (entryCount === 0) {
            this.hide();
            return;
        }
        if (!this._visible) this.show();

        // Rebuild mission elements if count changed
        if (this._missionElements.length !== entryCount) {
            this._container.replaceChildren();
            this._missionElements = [];
            for (let i = 0; i < entryCount; i += 1) {
                const card = createElement('div', 'arcade-mission-card');
                card.style.cssText = [
                    'background: rgba(5,12,22,0.68)',
                    'border-left: 3px solid #00ff88',
                    'padding: 4px 8px',
                    'border-radius: 3px',
                    'color: #e0e0e0',
                    'min-width: 150px',
                    'backdrop-filter: blur(6px)',
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
        for (let i = 0; i < entryCount; i += 1) {
            const isObjective = hasObjective && i === 0;
            const mission = isObjective ? objectiveState : missions[i - (hasObjective ? 1 : 0)];
            const el = this._missionElements[i];
            if (!el) continue;

            const typeDef = MISSION_TYPES[mission.type];
            const objectiveTarget = isObjective && mission.targetLabel ? `: ${mission.targetLabel}` : '';
            el.icon.textContent = isObjective ? '\u2316' : (MISSION_ICON_MAP[typeDef?.icon] || '\u2022');
            el.label.textContent = isObjective ? `${mission.label}${objectiveTarget}` : (typeDef?.label || mission.type);
            el.progressText.textContent = isObjective ? mission.progressText : formatMissionProgress(mission);
            const fraction = resolveProgressFraction(mission, isObjective);
            el.progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;

            // Completed styling
            if (mission.completed) {
                el.card.style.borderLeftColor = '#44ff44';
                el.progressBar.style.background = '#44ff44';
                el.label.textContent += ' \u2713';
            } else if (mission.failed) {
                el.card.style.borderLeftColor = '#ff445f';
                el.progressBar.style.background = '#ff445f';
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
