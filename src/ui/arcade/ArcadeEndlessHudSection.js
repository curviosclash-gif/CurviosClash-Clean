/**
 * Endlosjagd-Teil des Arcade-HUD: Serie mit Verfallsbalken, Rekordwerte, Tore,
 * Rettungsanzeige sowie die Randwarnungen fuer anrueckende Jaeger und fuer den
 * Rueckfall in die Tiefe. Bewusst eine eigene Datei, damit der Gauntlet-HUD
 * unberuehrt bleibt.
 */

const SIDE_LABELS = Object.freeze({
    left: 'Jaeger links',
    right: 'Jaeger rechts',
    ahead: 'Sperre vorn',
    behind: 'Jaeger im Rueckraum',
});

const METRICS = Object.freeze([
    ['distance', 'Distanz'],
    ['time', 'Zeit'],
    ['kills', 'Kills'],
    ['bots', 'Jaeger'],
    ['threat', 'Gefahr'],
    ['gates', 'Tore'],
    ['best', 'Bestwert'],
    ['record', 'Rekord m'],
    ['wave', 'Welle'],
    ['area', 'Gebiet'],
]);

function createElement(tag, className, textContent = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent) el.textContent = textContent;
    return el;
}

function setText(node, value) {
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
}

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatRounded(value) {
    return `${Math.round(Math.max(0, toSafeNumber(value, 0)))}`;
}

function formatTimer(seconds) {
    const total = Math.max(0, Math.floor(toSafeNumber(seconds, 0)));
    const mins = String(Math.floor(total / 60)).padStart(2, '0');
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

export class ArcadeEndlessHudSection {
    constructor() {
        this._values = {};
        this._wrap = null;
        this._streakWrap = null;
        this._streakValue = null;
        this._streakDecay = null;
        this._reviveBadge = null;
        this._overlay = null;
        this._spawnWarning = null;
        this._voidWarning = null;
        this._milestoneBanner = null;
        this._buildPanel();
        this._buildOverlay();
    }

    get element() {
        return this._wrap;
    }

    _buildPanel() {
        this._wrap = createElement('div', 'arcade-score-hud-endless');
        this._wrap.style.cssText = 'display:none;flex-direction:column;gap:5px;font-size:11px;';

        this._streakWrap = createElement('div', 'arcade-endless-streak');
        this._streakWrap.style.cssText = [
            'display:flex', 'flex-direction:column', 'gap:2px',
            'padding:4px 6px', 'border-radius:5px',
            'background:rgba(120,255,190,0.12)',
            'border:1px solid rgba(120,255,190,0.32)',
        ].join(';');
        const streakLine = createElement('div', 'arcade-endless-streak-line');
        streakLine.style.cssText = 'display:flex;justify-content:space-between;gap:6px;';
        streakLine.appendChild(createElement('span', 'arcade-endless-streak-label', 'Serie'));
        this._streakValue = createElement('strong', 'arcade-endless-streak-value', 'x1.0');
        this._streakValue.style.cssText = 'color:#9cf7c8;';
        streakLine.appendChild(this._streakValue);
        this._streakDecay = createElement('span', 'arcade-endless-streak-decay');
        this._streakDecay.style.cssText = [
            'display:block', 'width:100%', 'height:3px', 'border-radius:999px',
            'background:linear-gradient(90deg,#8ff7c1,#3affb0)',
            'transform-origin:left center', 'transform:scaleX(0)',
        ].join(';');
        this._streakWrap.appendChild(streakLine);
        this._streakWrap.appendChild(this._streakDecay);
        this._wrap.appendChild(this._streakWrap);

        const grid = createElement('div', 'arcade-endless-metrics');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;';
        for (const [key, label] of METRICS) {
            const cell = createElement('div', 'arcade-score-hud-metric');
            cell.style.cssText = 'display:flex;flex-direction:column;gap:2px;background:rgba(255,255,255,0.06);border-radius:5px;padding:4px 6px;';
            const caption = createElement('span', 'arcade-score-hud-metric-label', label);
            caption.style.cssText = 'font-size:10px;color:#9eb8cf;';
            const value = createElement('strong', 'arcade-score-hud-metric-value', '-');
            value.style.cssText = 'font-size:12px;color:#ffffff;';
            cell.appendChild(caption);
            cell.appendChild(value);
            grid.appendChild(cell);
            this._values[key] = value;
        }
        this._wrap.appendChild(grid);

        this._reviveBadge = createElement('div', 'arcade-endless-revive', 'Rettung am Tor bereit');
        this._reviveBadge.style.cssText = [
            'display:none', 'padding:4px 6px', 'border-radius:5px',
            'font-size:11px', 'font-weight:700',
            'background:rgba(255,215,120,0.18)',
            'border:1px solid rgba(255,215,120,0.45)',
            'color:#ffdf9a',
        ].join(';');
        this._wrap.appendChild(this._reviveBadge);

        this._milestoneBanner = createElement('div', 'arcade-endless-milestone', '');
        this._milestoneBanner.style.cssText = [
            'display:none', 'padding:4px 6px', 'border-radius:5px',
            'font-size:11px', 'background:rgba(150,200,255,0.16)',
            'border:1px solid rgba(150,200,255,0.4)',
        ].join(';');
        this._wrap.appendChild(this._milestoneBanner);
    }

    _buildOverlay() {
        this._overlay = createElement('div', 'arcade-endless-overlay');
        this._overlay.id = 'arcade-endless-overlay';
        this._overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:905',
            'display:none', 'pointer-events:none',
        ].join(';');

        this._spawnWarning = createElement('div', 'arcade-endless-spawn-warning', '');
        this._spawnWarning.style.cssText = [
            'position:absolute', 'top:50%', 'transform:translateY(-50%)',
            'padding:6px 10px', 'border-radius:6px',
            'font-family:monospace', 'font-size:12px', 'font-weight:700',
            'letter-spacing:0.05em', 'text-transform:uppercase',
            'background:rgba(120,20,20,0.62)', 'border:1px solid rgba(255,140,120,0.6)',
            'color:#ffd9d0', 'display:none',
        ].join(';');
        this._overlay.appendChild(this._spawnWarning);

        this._voidWarning = createElement('div', 'arcade-endless-void-warning', '');
        this._voidWarning.style.cssText = [
            'position:absolute', 'inset:0', 'display:none',
            'align-items:flex-end', 'justify-content:center',
            'padding-bottom:96px',
            'box-shadow:inset 0 0 120px 32px rgba(190,20,30,0.55)',
            'font-family:monospace', 'font-size:15px', 'font-weight:700',
            'color:#ffb9b0', 'text-shadow:0 2px 8px rgba(0,0,0,0.8)',
        ].join(';');
        this._overlay.appendChild(this._voidWarning);
    }

    /**
     * Die Randwarnungen liegen ueber dem ganzen Bild und gehoeren daher nicht in
     * das HUD-Kaertchen. Angehaengt wird erst beim ersten Einsatz - im Konstruktor
     * gibt es je nach Einbettung noch keinen Dokumentkoerper.
     */
    _attachOverlay() {
        if (!this._overlay || this._overlay.parentElement) return;
        const host = typeof document !== 'undefined' ? document.body : null;
        if (!host || typeof host.appendChild !== 'function') return;
        host.appendChild(this._overlay);
    }

    hide() {
        if (this._wrap) this._wrap.style.display = 'none';
        if (this._overlay) this._overlay.style.display = 'none';
    }

    /**
     * @param {Record<string, any>} hudState
     */
    update(hudState) {
        if (!this._wrap) return;
        this._wrap.style.display = 'flex';
        this._attachOverlay();
        if (this._overlay) this._overlay.style.display = 'block';
        this._updateStreak(hudState);
        this._updateMetrics(hudState);
        this._updateBadges(hudState);
        this._updateOverlay(hudState);
    }

    _updateStreak(hudState) {
        const multiplier = Math.max(1, toSafeNumber(hudState.streakMultiplier, 1));
        setText(this._streakValue, `x${multiplier.toFixed(1)}`);
        const remaining = Math.max(0, toSafeNumber(hudState.streakRemainingSeconds, 0));
        const ratio = Math.max(0, Math.min(1, remaining / 6));
        if (this._streakDecay) this._streakDecay.style.transform = `scaleX(${ratio.toFixed(3)})`;
        if (this._streakWrap) {
            this._streakWrap.style.opacity = multiplier > 1 ? '1' : '0.55';
        }
    }

    _updateMetrics(hudState) {
        setText(this._values.distance, `${formatRounded(hudState.maxProgressMeters)} m`);
        setText(this._values.time, formatTimer(hudState.survivalSeconds));
        const elites = Math.max(0, toSafeNumber(hudState.eliteKills, 0));
        setText(
            this._values.kills,
            elites > 0
                ? `${formatRounded(hudState.botKills)} (${formatRounded(elites)}A)`
                : formatRounded(hudState.botKills)
        );
        setText(this._values.bots, `${formatRounded(hudState.activeBots)}/${formatRounded(hudState.botCapacity)}`);
        setText(this._values.threat, String(hudState.threatLevel || 'INTRO'));
        setText(this._values.gates, formatRounded(hudState.checkpointsPassed));
        setText(this._values.best, formatRounded(hudState.recordScore));
        setText(this._values.record, `${formatRounded(hudState.recordDistanceMeters)} m`);
        const wave = hudState.wave || {};
        setText(this._values.wave, `${formatRounded(wave.number)} · ${String(wave.phase || 'intro')} · ${formatRounded(wave.remainingSeconds)}s`);
        const objective = hudState.flightObjective;
        setText(
            this._values.area,
            objective
                ? `${String(hudState.area || '-')} · ${formatRounded(objective.progress)}/${formatRounded(objective.target)}`
                : String(hudState.area || '-')
        );
    }

    _updateBadges(hudState) {
        if (this._reviveBadge) {
            this._reviveBadge.style.display = hudState.reviveArmed === true ? 'block' : 'none';
        }
        if (!this._milestoneBanner) return;
        const fresh = Array.isArray(hudState.newMilestones) ? hudState.newMilestones : [];
        if (fresh.length === 0) {
            this._milestoneBanner.style.display = 'none';
            return;
        }
        setText(this._milestoneBanner, `Meilenstein: ${fresh.length}x neu`);
        this._milestoneBanner.style.display = 'block';
    }

    _updateOverlay(hudState) {
        const warning = hudState.spawnWarning;
        if (this._spawnWarning) {
            if (warning && warning.side) {
                const side = String(warning.side);
                setText(
                    this._spawnWarning,
                    warning.elite === true ? 'Anführer!' : (SIDE_LABELS[side] || SIDE_LABELS.behind)
                );
                this._spawnWarning.style.display = 'block';
                this._spawnWarning.style.left = side === 'right' ? 'auto' : '18px';
                this._spawnWarning.style.right = side === 'right' ? '18px' : 'auto';
                if (side === 'ahead' || side === 'behind') {
                    this._spawnWarning.style.left = '50%';
                    this._spawnWarning.style.right = 'auto';
                    this._spawnWarning.style.transform = 'translate(-50%,-50%)';
                    this._spawnWarning.style.top = side === 'ahead' ? '86px' : 'auto';
                    this._spawnWarning.style.bottom = side === 'behind' ? '86px' : 'auto';
                } else {
                    this._spawnWarning.style.transform = 'translateY(-50%)';
                    this._spawnWarning.style.top = '50%';
                    this._spawnWarning.style.bottom = 'auto';
                }
            } else {
                this._spawnWarning.style.display = 'none';
            }
        }
        if (!this._voidWarning) return;
        const voidState = hudState.voidWarning || null;
        if (voidState?.active === true) {
            setText(this._voidWarning, `Zurückgefallen - ${formatRounded(voidState.remainingMeters)} m bis zum Absturz`);
            this._voidWarning.style.display = 'flex';
        } else {
            this._voidWarning.style.display = 'none';
        }
    }

    dispose() {
        this._overlay?.parentElement?.removeChild(this._overlay);
        this._overlay = null;
    }
}
