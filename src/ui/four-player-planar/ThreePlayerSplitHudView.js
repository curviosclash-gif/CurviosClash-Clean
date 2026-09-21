import { formatPlayerDisplayLabel } from '../../shared/contracts/PlayerDisplayLabelContract.js';
import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from '../../shared/contracts/HuntWinConditionContract.js';
import { formatDandelionSeedStatus } from '../DandelionSeedStatusText.js';
import {
    formatHuntClock,
    formatHuntScoreboard,
    getHuntScoreValue,
    rankHuntScoreboardRows,
    resolveHuntObjectiveText,
} from '../HuntMatchStatusHelpers.js';
import { HuntInterceptAnnouncer } from '../HuntInterceptAnnouncer.js';
import { HUD_ARC_SEGMENT_COUNT, initializeHudSegmentedArc } from '../HudSegmentedArc.js';
import { updateActiveEffectBar, updateItemBar, updateRocketBar } from '../ItemBarPresenter.js';
import { formatMapDestructibleStatus } from '../MapDestructibleStatusText.js';
import { formatMapExpansionStatus } from '../MapExpansionStatusText.js';
import { MatchHudAnnouncement, rankScoreRows } from '../MatchHudAnnouncement.js';
import { formatSecretRoomStatus } from '../SecretRoomStatusText.js';
import { updateTraversalStatus } from '../TraversalHudPresenter.js';
import { MultiPlayerHudRocketWarnings } from './MultiPlayerHudRocketWarning.js';

function createStaticElement(documentRef, markup) {
    const range = documentRef.createRange();
    const fragment = range.createContextualFragment(String(markup || '').trim());
    return fragment.firstElementChild;
}

function colorToCss(color) {
    return `#${Number(color).toString(16).padStart(6, '0')}`;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function setText(element, value) {
    const text = String(value || '');
    if (element && element.textContent !== text) element.textContent = text;
}

function setHidden(element, hidden) {
    element?.classList?.toggle('hidden', hidden);
    element?.setAttribute?.('aria-hidden', String(hidden));
}

function updateMeter(refs, value, maximum, {
    visible = true,
    inverse = false,
    warning = false,
    danger = false,
    valueText = null,
} = {}) {
    if (!refs?.root) return;
    setHidden(refs.root, !visible);
    if (!visible) return;
    const safeMaximum = Math.max(0.001, Number(maximum) || 1);
    const rawRatio = clamp01((Number(value) || 0) / safeMaximum);
    const ratio = inverse ? 1 - rawRatio : rawRatio;
    const percent = Math.round(ratio * 100);
    if (refs.fill?.style && refs.fill.style.width !== `${percent}%`) refs.fill.style.width = `${percent}%`;
    refs.root.style?.setProperty?.('--tps-meter-fill', `${percent}%`);
    refs.fill?.style?.setProperty?.('--hunt-segments-filled', `${Math.round(ratio * HUD_ARC_SEGMENT_COUNT)}%`);
    refs.root.classList?.toggle('warning', warning);
    refs.root.classList?.toggle('danger', danger);
    setText(refs.value, valueText ?? `${percent}%`);
    refs.root.setAttribute?.('aria-valuenow', String(percent));
}

function resolveExclusionZoneText(state) {
    const phase = String(state?.phase || 'SAFE');
    if (phase === 'GRACE') {
        return `ABSCHUSSZONE · ${Math.max(0, Math.ceil(Number(state?.countdownSeconds) || 0))} s`;
    }
    if (phase === 'SALVO') return `ABSCHUSSZONE · STUFE ${String(state?.stage || 'WEAK')}`;
    return '';
}

function resolveContextText(player) {
    return resolveExclusionZoneText(player?.exclusionZoneState)
        || formatSecretRoomStatus(player?.secretRoom)
        || formatMapExpansionStatus(player?.mapExpansion)
        || formatMapDestructibleStatus(player?.mapDestructible)
        || formatDandelionSeedStatus(player?.dandelionSeeds)
        || '';
}

function resolveTurretText(player) {
    if (Array.isArray(player?.turrets) && player.turrets.length > 0) {
        return player.turrets.map((entry) => (
            `${entry.weapon === 'rocket' ? 'RAK' : 'MG'} ${Math.ceil(Number(entry.remainingSeconds) || 0)}s`
        )).join(' · ');
    }
    const turret = player?.turret;
    return turret ? `GESCHÜTZ ${Math.ceil(Number(turret.remainingSeconds) || 0)}s` : '';
}

function createMeterRefs(row, name, attribute = 'data-tps-meter') {
    const root = row.querySelector(`[${attribute}="${name}"]`);
    return {
        root,
        fill: root?.querySelector?.('[data-tps-meter-fill]') || null,
        value: root?.querySelector?.('[data-tps-meter-value]') || null,
    };
}

function resolveClassicLeadText(rows) {
    const ranked = rankScoreRows(rows);
    if (ranked.length < 2) return '';
    const firstScore = Number(ranked[0]?.score) || 0;
    const secondScore = Number(ranked[1]?.score) || 0;
    if (firstScore <= secondScore) return 'GLEICHSTAND';
    return `${formatPlayerDisplayLabel(ranked[0])} FÜHRT · +${firstScore - secondScore}`;
}

function resolveHuntMatchText(huntProjection, runtimeConfig, localPlayerIndices) {
    const winCondition = normalizeHuntWinCondition(huntProjection?.winCondition);
    const lives = huntProjection?.livesRemainingByPlayer || {};
    const rows = rankHuntScoreboardRows(
        Array.isArray(huntProjection?.scoreboardRows) ? huntProjection.scoreboardRows : [],
        winCondition,
        lives,
    );
    const leader = rows[0] || null;
    const leaderValue = getHuntScoreValue(leader, winCondition, lives);
    const killLimit = Math.max(1, Number(huntProjection?.deathmatchKillLimit) || 10);
    const timeText = huntProjection?.overtime
        ? ' · Golden Kill'
        : (Number(huntProjection?.timeLimitSeconds) > 0
            ? ` · ${formatHuntClock(huntProjection?.timeRemainingSeconds)}`
            : '');
    const matchPointText = winCondition !== HUNT_WIN_CONDITIONS.LAST_ALIVE
        && leader && leaderValue === killLimit - 1 ? ' · Matchball' : '';
    return {
        objective: resolveHuntObjectiveText(huntProjection, runtimeConfig, { killLimit, timeText, matchPointText }),
        scoreboard: formatHuntScoreboard(
            rows,
            localPlayerIndices,
            huntProjection?.scoreboardSummary,
            winCondition,
            lives,
        ),
    };
}

/** Compact full-function HUD for the three narrow local viewports. */
export class ThreePlayerSplitHudView {
    constructor({ documentRef = globalThis.document } = {}) {
        this.document = documentRef || null;
        this._root = null;
        this._rows = [];
        this._matchRefs = null;
        this._announcement = null;
        this._intercepts = new HuntInterceptAnnouncer();
        this._warnings = new MultiPlayerHudRocketWarnings('three-player-split');
        this._localPlayerIndices = [];
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

    ensureRows({ playerCount, playerColors = [] }) {
        if (this._root) return true;
        if (!this.document) return false;
        const hud = this.document.getElementById('hud');
        if (!hud) return false;
        const root = this.document.createElement('div');
        root.id = 'three-player-split-hud';
        root.className = 'three-player-split-hud hidden';
        const matchStatus = createStaticElement(this.document, `
            <section class="three-player-split-match-status hidden" role="status" aria-live="polite">
                <strong data-tps-objective></strong>
                <span data-tps-scoreboard></span>
                <span data-tps-kill-feed></span>
            </section>`);
        root.appendChild(matchStatus);
        this._matchRefs = {
            root: matchStatus,
            objective: matchStatus.querySelector('[data-tps-objective]'),
            scoreboard: matchStatus.querySelector('[data-tps-scoreboard]'),
            killFeed: matchStatus.querySelector('[data-tps-kill-feed]'),
        };

        for (let index = 0; index < playerCount; index += 1) {
            const row = createStaticElement(this.document, `
                <section class="three-player-split-hud-column c${index + 1}" aria-label="HUD Spieler ${index + 1}">
                    <div class="three-player-split-hud-card">
                        <header class="three-player-split-hud-card-header">
                            <strong data-tps-player>P${index + 1}</strong>
                            <span data-tps-stat>–</span>
                            <span data-tps-rank>Rang –</span>
                        </header>
                        <div class="three-player-split-classic-reserves" aria-label="Fahrzeugreserven">
                            <div class="three-player-split-classic-reserve boost" data-tps-classic-meter="boost" role="meter" aria-label="Boost">
                                <i><b data-tps-meter-fill></b></i><span>Boost</span><em data-tps-meter-value>100%</em>
                            </div>
                            <div class="three-player-split-classic-reserve slowmo" data-tps-classic-meter="slowmo" role="meter" aria-label="Zeitlupe">
                                <i><b data-tps-meter-fill></b></i><span>Zeitlupe</span><em data-tps-meter-value>100%</em>
                            </div>
                        </div>
                        <div class="three-player-split-hunt-vitals">
                            <div class="three-player-split-vital hp" data-tps-meter="hp" role="meter" aria-label="Leben">
                                <span>Leben</span><em data-tps-meter-value>0 / 0</em><i><b data-tps-meter-fill></b></i>
                            </div>
                            <div class="three-player-split-vital shield" data-tps-meter="shield" role="meter" aria-label="Schild">
                                <span>Schild</span><em data-tps-meter-value>0 / 0</em><i><b data-tps-meter-fill></b></i>
                            </div>
                        </div>
                        <div class="three-player-split-hunt-reserves" aria-label="Kampfreserven">
                            <div class="three-player-split-hunt-reserve boost" data-tps-meter="boost" role="meter" aria-label="Boost">
                                <i><b data-tps-meter-fill></b></i><em data-tps-meter-value>100%</em>
                            </div>
                            <div class="three-player-split-hunt-reserve slowmo" data-tps-meter="slowmo" role="meter" aria-label="Zeitlupe">
                                <i><b data-tps-meter-fill></b></i><em data-tps-meter-value>100%</em>
                            </div>
                            <div class="three-player-split-hunt-reserve overheat" data-tps-meter="overheat" role="meter" aria-label="MG Hitze">
                                <i><b data-tps-meter-fill></b></i><em data-tps-meter-value>0%</em>
                            </div>
                        </div>
                        <span class="three-player-split-item-name" data-tps-item>Kein Item</span>
                        <div class="three-player-split-inventory" data-tps-inventory>
                            <div class="item-bar rocket-bar" data-tps-rockets></div>
                            <div class="item-bar" data-tps-items></div>
                        </div>
                        <div class="active-effect-bar hidden" data-tps-effects role="status" aria-label="Aktive Effekte"></div>
                        <div class="traversal-status hidden" data-tps-traversal aria-live="polite"></div>
                        <div class="three-player-split-context hidden" data-tps-context></div>
                        <div class="three-player-split-alert hidden" data-tps-respawn></div>
                        <div class="three-player-split-context hidden" data-tps-turret></div>
                    </div>
                    <div class="three-player-split-damage hidden" data-tps-damage aria-hidden="true">▲</div>
                </section>`);
            row.style.setProperty('--player-color', colorToCss(playerColors[index]));
            root.appendChild(row);
            this._warnings.mount(this.document, row, index);
            this._localPlayerIndices.push(index);
            this._rows.push({
                root: row,
                stat: row.querySelector('[data-tps-stat]'),
                rank: row.querySelector('[data-tps-rank]'),
                item: row.querySelector('[data-tps-item]'),
                classicMeters: {
                    boost: createMeterRefs(row, 'boost', 'data-tps-classic-meter'),
                    slowmo: createMeterRefs(row, 'slowmo', 'data-tps-classic-meter'),
                },
                meters: {
                    hp: createMeterRefs(row, 'hp'),
                    shield: createMeterRefs(row, 'shield'),
                    boost: createMeterRefs(row, 'boost'),
                    slowmo: createMeterRefs(row, 'slowmo'),
                    overheat: createMeterRefs(row, 'overheat'),
                },
                items: row.querySelector('[data-tps-items]'),
                rockets: row.querySelector('[data-tps-rockets]'),
                effects: row.querySelector('[data-tps-effects]'),
                traversal: row.querySelector('[data-tps-traversal]'),
                context: row.querySelector('[data-tps-context]'),
                respawn: row.querySelector('[data-tps-respawn]'),
                turret: row.querySelector('[data-tps-turret]'),
                damage: row.querySelector('[data-tps-damage]'),
            });
            initializeHudSegmentedArc(this._rows[index].classicMeters.boost.fill, 'horizontal');
            initializeHudSegmentedArc(this._rows[index].classicMeters.slowmo.fill, 'horizontal');
            initializeHudSegmentedArc(this._rows[index].meters.boost.fill, 'triangle-boost');
            initializeHudSegmentedArc(this._rows[index].meters.slowmo.fill, 'triangle-reserve');
            initializeHudSegmentedArc(this._rows[index].meters.overheat.fill, 'triangle-overheat');
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

    setRowText(playerIndex, field, text) {
        const target = this._rows[playerIndex]?.[field];
        if (target) target.textContent = text;
    }

    hasRow(playerIndex) {
        return !!this._rows[playerIndex];
    }

    updateMatch({ huntActive = false, scoreRows = [], huntProjection = null, runtimeConfig = null } = {}) {
        if (!this._root || !this._matchRefs) return;
        this._root.dataset.mode = huntActive ? 'hunt' : 'classic';
        if (!huntActive) {
            const leadText = resolveClassicLeadText(scoreRows);
            setText(this._matchRefs.objective, leadText);
            setText(this._matchRefs.scoreboard, '');
            setText(this._matchRefs.killFeed, '');
            setHidden(this._matchRefs.root, !leadText);
            return;
        }
        const matchText = resolveHuntMatchText(huntProjection, runtimeConfig, this._localPlayerIndices);
        const killFeed = Array.isArray(huntProjection?.killFeed)
            ? huntProjection.killFeed.slice(-2).join(' · ')
            : '';
        setText(this._matchRefs.objective, matchText.objective);
        setText(this._matchRefs.scoreboard, matchText.scoreboard);
        setText(this._matchRefs.killFeed, killFeed);
        setHidden(this._matchRefs.killFeed, !killFeed);
        setHidden(this._matchRefs.root, false);
    }

    updatePlayer(playerIndex, player, {
        huntActive = false,
        projection = null,
        huntProjection = null,
        globalFog = null,
        gameplayConfig = null,
        keyBindings = null,
    } = {}) {
        const refs = this._rows[playerIndex];
        if (!refs || !player) return;
        refs.root.dataset.mode = huntActive ? 'hunt' : 'classic';
        refs.root.classList.toggle('is-dead', player.alive === false);
        refs.root.classList.toggle('slowmo-active', player.slowMoActive === true || player.manualSlowMoActive === true);

        const hp = Math.max(0, Number(player.hp) || 0);
        const maxHp = Math.max(1, Number(player.maxHp) || 1);
        const shield = Math.max(0, Number(player.shieldHP) || 0);
        const maxShield = Math.max(1, Number(player.maxShieldHp) || 1);
        updateMeter(refs.meters.hp, hp, maxHp, {
            valueText: `${Math.round(hp)} / ${Math.round(maxHp)}`,
        });
        updateMeter(refs.meters.shield, shield, maxShield, {
            valueText: `${Math.round(shield)} / ${Math.round(maxShield)}`,
        });
        updateMeter(refs.classicMeters.boost, player.boostCharge, player.boostCapacity, {
            warning: player.boostRecharging === true,
        });
        updateMeter(refs.classicMeters.slowmo, player.slowMoCharge, player.slowMoCapacity, {
            warning: player.slowMoRecharging === true,
        });
        updateMeter(refs.meters.boost, player.boostCharge, player.boostCapacity, {
            warning: player.boostRecharging === true,
        });
        updateMeter(refs.meters.slowmo, player.slowMoCharge, player.slowMoCapacity, {
            warning: player.slowMoRecharging === true,
        });
        const overheat = Math.max(0, Number(huntProjection?.overheatByPlayer?.[playerIndex]) || 0);
        updateMeter(refs.meters.overheat, overheat, 100, {
            inverse: true,
            warning: overheat >= 60,
            danger: overheat >= 85,
            valueText: `${Math.round(overheat)}%`,
        });

        updateRocketBar(refs.rockets, player, projection, gameplayConfig, keyBindings);
        updateItemBar(refs.items, player, projection, gameplayConfig, keyBindings);
        updateActiveEffectBar(refs.effects, player, globalFog);
        updateTraversalStatus(refs.traversal, player);

        const contextText = resolveContextText(player);
        setText(refs.context, contextText);
        setHidden(refs.context, !contextText);
        const respawnRemaining = huntActive
            ? Math.max(0, Number(huntProjection?.respawnRemainingByPlayer?.[playerIndex]) || 0)
            : 0;
        const respawnText = respawnRemaining > 0 ? `WIEDEREINSTIEG ${respawnRemaining.toFixed(1)}s` : '';
        setText(refs.respawn, respawnText);
        setHidden(refs.respawn, !respawnText);
        const turretText = huntActive ? resolveTurretText(player) : '';
        setText(refs.turret, turretText);
        setHidden(refs.turret, !turretText);

        const damage = huntActive ? huntProjection?.damageIndicatorsByPlayer?.[playerIndex] : null;
        const showDamage = Number(damage?.remainingMs) > 0;
        setHidden(refs.damage, !showDamage);
        if (showDamage && refs.damage?.style) {
            refs.damage.style.opacity = String(Math.max(0.25, clamp01(damage.intensity || 0.6)));
            refs.damage.style.transform = `translate(-50%, -50%) rotate(${(Number(damage.angleDeg) || 0).toFixed(1)}deg) scale(var(--three-player-hud-scale, 0.78))`;
        }
    }

    updateRocketWarning(playerIndex, player, rocketThreat, huntActive, reduceMotion) {
        this._warnings.update(playerIndex, player, rocketThreat, huntActive, reduceMotion);
    }

    observeScores(rows, options) {
        this._announcement?.observe(rows, options);
        const interceptMessage = this._intercepts.consume(rows, this._localPlayerIndices);
        if (interceptMessage) this._announcement?.show(interceptMessage);
    }

    resetScoreEvent() {
        this._announcement?.reset();
        this._intercepts.reset();
        this._warnings.hideAll();
        setHidden(this._matchRefs?.root, true);
        for (const refs of this._rows) setHidden(refs.damage, true);
    }

    dispose() {
        this._announcement?.dispose();
        this._announcement = null;
        this._intercepts.reset();
        this._warnings.dispose();
        this._localPlayerIndices.length = 0;
        this._root?.remove?.();
        this._root = null;
        this._matchRefs = null;
        this._rows.length = 0;
    }
}
