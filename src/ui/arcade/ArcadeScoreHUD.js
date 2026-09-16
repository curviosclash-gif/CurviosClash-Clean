import { ARCADE_SCORE_LABELS } from '../../shared/contracts/ArcadeScorePresentationContract.js';
import { resolveArcadeModifierMeta } from '../../shared/contracts/ArcadeModifierContract.js';
import { ArcadeEndlessHudSection } from './ArcadeEndlessHudSection.js';

const BREAKDOWN_ENTRIES = Object.freeze(Object.entries(ARCADE_SCORE_LABELS)
    .map(([key, label]) => Object.freeze({ key, label, sign: key === 'penalty' ? '-' : '+' })));

function createElement(tag, className, textContent = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
}

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatRounded(value) {
    return `${Math.round(Math.max(0, toSafeNumber(value, 0)))}`;
}

function formatMultiplier(value) {
    return `x${Math.max(1, toSafeNumber(value, 1)).toFixed(1)}`;
}

function formatBreakdownValue(value, sign = '+') {
    const numeric = Math.round(Math.max(0, toSafeNumber(value, 0)));
    if (numeric <= 0) {
        return `${sign}0`;
    }
    return `${sign}${numeric}`;
}

function setNodeText(node, text) {
    if (!node) return;
    if (node.textContent !== text) {
        node.textContent = text;
    }
}

function formatTimerMs(value) {
    const totalSec = Math.max(0, Math.floor(toSafeNumber(value, 0) / 1000));
    const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

export class ArcadeScoreHUD {
    constructor(parentElement = null) {
        this._parent = parentElement || document.body;
        this._container = null;
        this._visible = false;
        this._breakdownValueByKey = new Map();
        this._breakdownWrap = null;
        this._scoreValue = null;
        this._comboValue = null;
        this._metricLine = null;
        this._endlessSection = null;
        this._arenaWavesSection = null;
        this._comboMetricWrap = null;
        this._comboDecayValue = null;
        this._multiplierValue = null;
        this._sectorValue = null;
        this._modifierWrap = null;
        this._modifierIcon = null;
        this._modifierLabel = null;
        this._modifierEffect = null;
        this._suddenDeathBanner = null;
        this._transitionBanner = null;
        this._transitionVisibleUntilMs = 0;
        this._comboPopUntilMs = 0;
        this._lastSectorIndex = 0;
        this._lastCombo = 0;
        this._build();
        this._ghostStatus = createElement('div', 'arcade-ghost-status');
        this._container.appendChild(this._ghostStatus);
    }

    _build() {
        this._container = createElement('section', 'arcade-score-hud');
        this._container.id = 'arcade-score-hud';
        this._container.style.cssText = [
            'position:fixed',
            'top:12px',
            'left:12px',
            'z-index:910',
            'display:none',
            'flex-direction:column',
            'gap:6px',
            'min-width:208px',
            'max-width:244px',
            'padding:8px 10px',
            'border-radius:8px',
            'background:rgba(8,12,20,0.76)',
            'border:1px solid rgba(120,190,255,0.35)',
            'color:#e8f4ff',
            'pointer-events:none',
            'font-family:monospace',
            'box-shadow:0 8px 22px rgba(0,0,0,0.32)',
            'backdrop-filter:blur(7px)',
        ].join(';');

        const scoreLine = createElement('div', 'arcade-score-hud-scoreline');
        scoreLine.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:8px;';
        scoreLine.appendChild(createElement('span', 'arcade-score-hud-label', 'Score'));
        this._scoreValue = createElement('strong', 'arcade-score-hud-score', '0');
        this._scoreValue.style.cssText = 'font-size:16px;color:#9cf7a8;';
        scoreLine.appendChild(this._scoreValue);

        const metricLine = createElement('div', 'arcade-score-hud-metrics');
        this._metricLine = metricLine;
        metricLine.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;font-size:11px;';
        const comboMetric = this._createMetric(metricLine, 'Combo', '0');
        this._comboMetricWrap = comboMetric.wrap;
        this._comboValue = comboMetric.value;
        this._comboDecayValue = createElement('span', 'arcade-score-hud-combo-decay');
        this._comboDecayValue.style.cssText = 'display:block;width:100%;height:3px;border-radius:999px;background:linear-gradient(90deg,#8ff7ff,#3ad1ff);opacity:0.88;margin-top:2px;transform-origin:left center;';
        this._comboMetricWrap.appendChild(this._comboDecayValue);
        this._multiplierValue = this._createMetric(metricLine, 'Multi', 'x1.0').value;
        this._sectorValue = this._createMetric(metricLine, 'Sektor', '0').value;

        this._endlessSection = new ArcadeEndlessHudSection();
        this._arenaWavesSection = createElement('div', 'arcade-waves-hud-section');
        this._arenaWavesSection.style.cssText = 'display:none;font-size:11px;line-height:1.5;color:#d9efff;white-space:pre-line;';

        const breakdown = createElement('div', 'arcade-score-hud-breakdown');
        breakdown.style.cssText = 'display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px;font-size:11px;';
        this._breakdownWrap = breakdown;
        for (let i = 0; i < BREAKDOWN_ENTRIES.length; i += 1) {
            const entry = BREAKDOWN_ENTRIES[i];
            const row = createElement('div', 'arcade-score-hud-breakdown-row');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:6px;';
            const label = createElement('span', 'arcade-score-hud-breakdown-label', entry.label);
            label.style.cssText = 'color:#9eb8cf;';
            const value = createElement('strong', 'arcade-score-hud-breakdown-value', `${entry.sign}0`);
            value.style.cssText = entry.sign === '-' ? 'color:#ff9aa8;' : 'color:#b9f4ff;';
            row.appendChild(label);
            row.appendChild(value);
            breakdown.appendChild(row);
            this._breakdownValueByKey.set(entry.key, value);
        }

        this._modifierWrap = createElement('div', 'arcade-score-hud-modifier');
        this._modifierWrap.style.cssText = [
            'display:none',
            'align-items:flex-start',
            'gap:8px',
            'padding-top:6px',
            'border-top:1px solid rgba(255,255,255,0.14)',
        ].join(';');
        this._modifierIcon = createElement('span', 'arcade-score-hud-modifier-icon', '--');
        this._modifierIcon.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'min-width:26px',
            'height:20px',
            'padding:0 4px',
            'border-radius:4px',
            'background:rgba(120,190,255,0.25)',
            'font-size:11px',
            'font-weight:700',
        ].join(';');
        const modifierText = createElement('div', 'arcade-score-hud-modifier-text');
        modifierText.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        this._modifierLabel = createElement('strong', 'arcade-score-hud-modifier-label', 'Kein Modifier aktiv');
        this._modifierLabel.style.cssText = 'font-size:12px;';
        this._modifierEffect = createElement('span', 'arcade-score-hud-modifier-effect', 'Standard-Sektor ohne Zusatz-Effekt');
        this._modifierEffect.style.cssText = 'font-size:11px;color:#9eb8cf;';
        modifierText.appendChild(this._modifierLabel);
        modifierText.appendChild(this._modifierEffect);
        this._modifierWrap.appendChild(this._modifierIcon);
        this._modifierWrap.appendChild(modifierText);

        this._suddenDeathBanner = createElement('div', 'arcade-score-hud-sd hidden', 'Sudden Death 00:00');
        this._suddenDeathBanner.style.cssText = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(255,120,120,0.45);background:rgba(80,0,0,0.42);font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;';

        this._transitionBanner = createElement('div', 'arcade-score-hud-transition hidden', '');
        this._transitionBanner.style.cssText = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(140,220,255,0.4);background:rgba(18,44,62,0.55);font-size:11px;font-weight:600;';

        this._container.appendChild(scoreLine);
        this._container.appendChild(metricLine);
        this._container.appendChild(this._endlessSection.element);
        this._container.appendChild(this._arenaWavesSection);
        this._container.appendChild(breakdown);
        this._container.appendChild(this._modifierWrap);
        this._container.appendChild(this._suddenDeathBanner);
        this._container.appendChild(this._transitionBanner);
        this._parent.appendChild(this._container);
    }

    _createMetric(parent, labelText, valueText) {
        const wrap = createElement('div', 'arcade-score-hud-metric');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;background:rgba(255,255,255,0.06);border-radius:5px;padding:4px 6px;';
        const label = createElement('span', 'arcade-score-hud-metric-label', labelText);
        label.style.cssText = 'font-size:10px;color:#9eb8cf;';
        const value = createElement('strong', 'arcade-score-hud-metric-value', valueText);
        value.style.cssText = 'font-size:12px;color:#ffffff;';
        wrap.appendChild(label);
        wrap.appendChild(value);
        parent.appendChild(wrap);
        return { wrap, value };
    }

    show() {
        if (!this._container) return;
        this._container.style.display = 'flex';
        this._visible = true;
    }

    hide() {
        if (!this._container) return;
        this._container.style.display = 'none';
        this._container.classList.remove('is-edge-glow', 'is-sudden-death');
        this._endlessSection?.hide();
        this._visible = false;
    }

    update(hudState = null) {
        setNodeText(this._ghostStatus, hudState?.ghostStatus || '');
        if (!hudState || typeof hudState !== 'object') {
            this.hide();
            return;
        }
        if (!this._visible) {
            this.show();
        }

        const score = hudState.score && typeof hudState.score === 'object' ? hudState.score : {};
        const isEndless = String(hudState.runType || '') === 'endless_parcours';
        const isArenaWaves = String(hudState.runType || '') === 'arena_waves';
        if (isArenaWaves) {
            if (this._metricLine) this._metricLine.style.display = 'none';
            this._endlessSection?.hide();
            if (this._breakdownWrap) this._breakdownWrap.style.display = 'none';
            if (this._modifierWrap) this._modifierWrap.style.display = 'none';
            this._suddenDeathBanner?.classList?.add('hidden');
            this._transitionBanner?.classList?.add('hidden');
            this._arenaWavesSection.style.display = 'block';
            setNodeText(this._scoreValue, formatRounded(score.total));
            const kills = hudState.kills || {};
            const upgrades = hudState.upgrades || {};
            const telegraph = hudState.spawnWarning ? `\nAnkommend: ${hudState.plannedSpawnCount || 0} Gegner in ${Math.max(0, Math.ceil(hudState.spawnWarning.remaining || 0))} s` : (hudState.nextWaveInSeconds == null ? '' : `\nNächste Welle in ${Math.max(0, Math.ceil(hudState.nextWaveInSeconds))} s`);
            this._arenaWavesSection.textContent = `Karte ${Number(hudState.mapIndex || 0) + 1}/${hudState.mapCount || 5}: ${hudState.currentMapKey || '-'}\nWelle ${hudState.wave || 1} | Gegner ${hudState.alive || 0} | Aggro ${Math.round((Number(hudState.aggression) || 0) * 100)}%\nKills ${kills.regular || 0} + Elite ${kills.elite || 0} | Zeit ${Math.floor(Number(hudState.survivalSeconds) || 0)} s\nMG ${upgrades.machineGunId || '-'} | Speed +${upgrades.speed || 0}% | HP +${upgrades.maxHp || 0}${telegraph}`;
            return;
        }
        if (this._arenaWavesSection) this._arenaWavesSection.style.display = 'none';
        if (this._metricLine) this._metricLine.style.display = isEndless ? 'none' : 'grid';
        if (isEndless) {
            setNodeText(this._scoreValue, formatRounded(score.total));
            this._endlessSection?.update(hudState);
            if (this._breakdownWrap) this._breakdownWrap.style.display = 'none';
            if (this._modifierWrap) this._modifierWrap.style.display = 'none';
            this._suddenDeathBanner?.classList?.add('hidden');
            this._transitionBanner?.classList?.add('hidden');
            return;
        }
        this._endlessSection?.hide();
        const breakdown = score.breakdown && typeof score.breakdown === 'object' ? score.breakdown : {};
        const nowMs = Math.max(0, toSafeNumber(hudState.nowMs, Date.now()));
        const comboWindowMs = Math.max(800, toSafeNumber(hudState.comboWindowMs, 5000));
        const combo = Math.max(0, Math.round(toSafeNumber(score.combo, 0)));
        const lastComboAtMs = Math.max(0, toSafeNumber(score.lastComboAtMs, 0));
        const elapsedComboMs = Math.max(0, nowMs - lastComboAtMs);
        const decayRatio = combo <= 0 ? 0 : Math.max(0, Math.min(1, (comboWindowMs - elapsedComboMs) / comboWindowMs));
        const phase = String(hudState.phase || '');
        const sectorIndex = Math.max(0, Math.floor(toSafeNumber(hudState.sectorIndex, 0)));
        const totalScore = Math.max(0, Math.round(toSafeNumber(score.total, 0)));
        setNodeText(this._scoreValue, `${totalScore}`);
        setNodeText(this._comboValue, formatRounded(combo));
        setNodeText(this._multiplierValue, formatMultiplier(score.multiplier));
        setNodeText(this._sectorValue, `${sectorIndex}`);

        for (let i = 0; i < BREAKDOWN_ENTRIES.length; i += 1) {
            const entry = BREAKDOWN_ENTRIES[i];
            const valueNode = this._breakdownValueByKey.get(entry.key);
            setNodeText(valueNode, formatBreakdownValue(breakdown[entry.key], entry.sign));
        }

        if (this._comboDecayValue) {
            this._comboDecayValue.style.transform = `scaleX(${decayRatio.toFixed(3)})`;
            this._comboDecayValue.style.opacity = combo > 0 ? '0.9' : '0.2';
        }
        if (combo > this._lastCombo) {
            this._comboPopUntilMs = nowMs + 220;
        }
        this._lastCombo = combo;
        this._comboMetricWrap?.classList?.toggle('is-pop', nowMs < this._comboPopUntilMs);
        const decaying = combo > 0 && decayRatio < 0.35;
        this._comboMetricWrap?.classList?.toggle('is-decaying', decaying);
        this._container?.classList?.toggle('is-edge-glow', decaying);

        const modifierMeta = resolveArcadeModifierMeta(hudState.activeModifierId);
        if (modifierMeta) {
            setNodeText(this._modifierIcon, modifierMeta.icon);
            setNodeText(this._modifierLabel, modifierMeta.label);
            setNodeText(this._modifierEffect, modifierMeta.effectText);
            this._modifierWrap.style.borderTopColor = 'rgba(120,190,255,0.24)';
        } else {
            setNodeText(this._modifierIcon, '--');
            setNodeText(this._modifierLabel, 'Kein Modifier aktiv');
            setNodeText(this._modifierEffect, 'Standard-Sektor ohne Zusatz-Effekt');
            this._modifierWrap.style.borderTopColor = 'rgba(255,255,255,0.14)';
        }

        const isSuddenDeath = phase === 'sudden_death';
        if (this._suddenDeathBanner) {
            this._suddenDeathBanner.classList.toggle('hidden', !isSuddenDeath);
            if (isSuddenDeath) {
                setNodeText(this._suddenDeathBanner, `Sudden Death ${formatTimerMs(hudState.suddenDeathElapsedMs)}`);
            }
        }
        this._container?.classList?.toggle('is-sudden-death', isSuddenDeath);

        if (sectorIndex > 0 && sectorIndex !== this._lastSectorIndex) {
            this._transitionVisibleUntilMs = nowMs + 1400;
            const mapKey = String(hudState.currentMapKey || '').trim() || 'unknown';
            setNodeText(this._transitionBanner, `Sektor ${sectorIndex} | ${mapKey}`);
        }
        this._lastSectorIndex = sectorIndex;
        const transitionVisible = nowMs < this._transitionVisibleUntilMs;
        this._transitionBanner?.classList?.toggle('hidden', !transitionVisible);
        const showDetails = phase === 'paused' || phase === 'round_end';
        if (this._breakdownWrap) {
            this._breakdownWrap.style.display = showDetails ? 'grid' : 'none';
        }
        if (this._modifierWrap) {
            this._modifierWrap.style.display = modifierMeta ? 'flex' : 'none';
        }
    }

    dispose() {
        if (this._container?.parentElement) {
            this._container.parentElement.removeChild(this._container);
        }
        this._breakdownValueByKey.clear();
        this._breakdownWrap = null;
        this._container = null;
        this._scoreValue = null;
        this._comboValue = null;
        this._comboMetricWrap = null;
        this._comboDecayValue = null;
        this._multiplierValue = null;
        this._sectorValue = null;
        this._modifierWrap = null;
        this._modifierIcon = null;
        this._modifierLabel = null;
        this._modifierEffect = null;
        this._suddenDeathBanner = null;
        this._transitionBanner = null;
        this._transitionVisibleUntilMs = 0;
        this._comboPopUntilMs = 0;
        this._lastSectorIndex = 0;
        this._lastCombo = 0;
        this._visible = false;
    }
}
