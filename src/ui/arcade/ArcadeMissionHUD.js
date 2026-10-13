// ─── Arcade Mission HUD: In-Game Mission Display Overlay ───

import { formatMissionProgress, MISSION_TYPES } from '../../shared/contracts/ArcadeMissionContract.js';
import { resolveArcadeScenarioObjectiveLabel } from '../../shared/contracts/ArcadeScenarioContract.js';
import { ARCADE_SECTOR_OBJECTIVES } from '../../entities/directors/ArcadeEncounterCatalog.js';

const MISSION_ICON_MAP = {
    crosshair: '\u2316',
    gem: '\u2666',
    clock: '\u23F1',
    portal: '\u26CE',
    stopwatch: '\u23F1',
};

// The two greens alone barely differ, so every state also has a symbol and a word.
const MISSION_STATUS = Object.freeze({
    done: Object.freeze({ symbol: '✓', word: 'erfüllt', color: '#44ff44' }),
    failed: Object.freeze({ symbol: '✗', word: 'gescheitert', color: '#ff445f' }),
    active: Object.freeze({ symbol: '•', word: 'aktiv', color: '#00ff88' }),
});

function setNodeText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
}

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

// Sector objectives outside the scenario catalog still show German names to the player.
const SECTOR_OBJECTIVE_LABELS = Object.freeze({
    bounty_hunt: 'Kopfgeldjagd',
    clean_sector: 'Sektor säubern',
    hazard_lane: 'Gefahrenschneise',
});

export function resolveArcadeMissionObjectiveLabel(objective) {
    const id = String(objective?.objectiveId || '').trim().toLowerCase();
    const label = String(objective?.label || '').trim();
    const catalogLabel = ARCADE_SECTOR_OBJECTIVES.find((entry) => entry.id === id)?.label;
    if (label && label !== catalogLabel) return label;
    return resolveArcadeScenarioObjectiveLabel(id) || SECTOR_OBJECTIVE_LABELS[id] || label || id.replace(/_/g, ' ');
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
                const status = createElement('span', 'arcade-mission-status');
                status.setAttribute('aria-hidden', 'true');
                status.style.cssText = 'margin-left:auto;font-weight:700;';
                header.appendChild(icon);
                header.appendChild(label);
                header.appendChild(status);
                card.setAttribute('role', 'group');

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

                this._missionElements.push({ card, icon, label, status, progressBar, progressText, shownStatus: null, ariaLabel: '' });
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
            const labelText = isObjective ? `Hauptziel: ${resolveArcadeMissionObjectiveLabel(mission)}${objectiveTarget}` : `Optional: ${typeDef?.label || mission.type}`;
            const progressText = String((isObjective ? mission.progressText : formatMissionProgress(mission)) ?? '');
            const status = mission.completed ? MISSION_STATUS.done : (mission.failed ? MISSION_STATUS.failed : MISSION_STATUS.active);
            setNodeText(el.icon, isObjective ? '\u2316' : (MISSION_ICON_MAP[typeDef?.icon] || '\u2022'));
            setNodeText(el.label, labelText);
            setNodeText(el.progressText, progressText);
            setNodeText(el.status, status.symbol);
            const ariaLabel = `${labelText}: ${progressText} \u2013 ${status.word}`;
            if (el.ariaLabel !== ariaLabel) {
                el.ariaLabel = ariaLabel;
                el.card.setAttribute('aria-label', ariaLabel);
            }
            const fraction = resolveProgressFraction(mission, isObjective);
            el.progressBar.style.width = `${(fraction * 100).toFixed(1)}%`;
            if (el.shownStatus !== status) {
                el.shownStatus = status;
                el.card.style.borderLeftColor = status.color;
                el.progressBar.style.background = status.color;
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
