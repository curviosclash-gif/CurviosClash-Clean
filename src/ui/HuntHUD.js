import { clamp01 } from '../utils/MathOps.js';
import { createHuntHudDomRefs } from './dom/HuntHudDomRefs.js';
import {
    HUD_ARC_SEGMENT_COUNT,
    initializeHudSegmentedArc,
} from './HudSegmentedArc.js';

const HOTPATH_INTERVAL_FALLBACKS = Object.freeze({
    playerPanel: 0.12,
    killFeed: 0.12,
    indicator: 0.04,
});
const KILL_FEED_SLOT_COUNT = 3;
const MIN_BOOST_CAPACITY = 0.001;
const OVERHEAT_CAP = 100;
const OVERHEAT_WARNING_RESERVE = 0.6;
const OVERHEAT_DANGER_RESERVE = 0.3;
const INDICATOR_DEFAULT_INTENSITY = 0.6;
const INDICATOR_MIN_OPACITY = 0.2;
const DEFAULT_BOOST_CAPACITY = 1;
function toPercent(value) {
    return `${(clamp01(value) * 100).toFixed(1)}%`;
}

function formatClock(seconds) {
    const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function normalizeConstructorOptions(input) {
    if (!input || typeof input !== 'object') {
        return { runtime: null };
    }
    const optionKeys = ['runtime', 'ports', 'refs', 'isHuntActive', 'getBoostCapacity', 'documentRef', 'game'];
    const isOptionsObject = optionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (isOptionsObject) {
        return input;
    }
    return { runtime: input };
}

function resolveCreateListItem(refs) {
    if (typeof refs?.createKillFeedItem === 'function') {
        return refs.createKillFeedItem;
    }
    return () => globalThis.document?.createElement?.('li') ?? null;
}

function defaultIsHuntActive(runtime) {
    return runtime?.activeGameMode === 'HUNT' && runtime?.state !== 'MENU';
}

export class HuntHUD {
    constructor(input = {}) {
        const options = normalizeConstructorOptions(input);
        const refs = options.refs ?? createHuntHudDomRefs(options.documentRef);

        this.runtime = options.runtime ?? options.game ?? null;
        this.ports = options.ports || null;
        this.root = refs.root ?? null;
        this.objective = refs.objective ?? null;
        this.scoreboard = refs.scoreboard ?? null;
        this.p1HpFill = refs.p1HpFill ?? null;
        this.p1HpText = refs.p1HpText ?? null;
        this.p1Respawn = refs.p1Respawn ?? null;
        this.p1ShieldFill = refs.p1ShieldFill ?? null;
        this.p1ShieldText = refs.p1ShieldText ?? null;
        this.p1BoostFill = refs.p1BoostFill ?? null;
        this.p1BoostText = refs.p1BoostText ?? null;
        this.p1OverheatFill = refs.p1OverheatFill ?? null;
        this.p1OverheatText = refs.p1OverheatText ?? null;
        this.p2Panel = refs.p2Panel ?? null;
        this.p2HpFill = refs.p2HpFill ?? null;
        this.p2HpText = refs.p2HpText ?? null;
        this.p2Respawn = refs.p2Respawn ?? null;
        this.p2ShieldFill = refs.p2ShieldFill ?? null;
        this.p2ShieldText = refs.p2ShieldText ?? null;
        this.p2BoostFill = refs.p2BoostFill ?? null;
        this.p2BoostText = refs.p2BoostText ?? null;
        this.p2OverheatFill = refs.p2OverheatFill ?? null;
        this.p2OverheatText = refs.p2OverheatText ?? null;
        this.killFeedList = refs.killFeedList ?? null;
        this._killFeedSlots = [];
        this._killFeedCachedTexts = new Array(KILL_FEED_SLOT_COUNT).fill('');
        this._createKillFeedItem = resolveCreateListItem(refs);
        this.damageIndicatorP1 = refs.damageIndicatorP1 ?? null;
        this.damageIndicatorP2 = refs.damageIndicatorP2 ?? null;
        this._playerPanelTickTimer = 0;
        this._killFeedTickTimer = 0;
        this._indicatorTickTimer = 0;
        this._wasHuntActive = false;
        this._panelCache = [
            { hpW: null, hpTxt: null, shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, overheatW: null, overheatState: null, overheatTxt: null, respawnTxt: null },
            { hpW: null, hpTxt: null, shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, overheatW: null, overheatState: null, overheatTxt: null, respawnTxt: null },
        ];
        this._objectiveText = null;
        this._scoreboardText = null;
        this._scoreboardDetails = null;
        this._leaderIndex = null;
        this._leaderKills = -1;
        this._localKills = -1;
        this._localAssists = -1;
        this._indicatorP2Visible = null;
        this._isHuntActive = typeof options.isHuntActive === 'function'
            ? options.isHuntActive
            : defaultIsHuntActive;
        this._getBoostCapacity = typeof options.getBoostCapacity === 'function'
            ? options.getBoostCapacity
            : () => DEFAULT_BOOST_CAPACITY;

        initializeHudSegmentedArc(this.p1BoostFill);
        initializeHudSegmentedArc(this.p1OverheatFill);
    }

    _getMatchRuntimeProjection() {
        return this.ports?.runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    }

    _resolveUiHotpathInterval(key, fallback) {
        const configured = Number(this.runtime?.runtimeConfig?.uiHotpath?.[key]);
        if (Number.isFinite(configured) && configured > 0) {
            return configured;
        }
        return fallback;
    }

    _consumeTick(timerKey, dt, interval) {
        const elapsed = this[timerKey] + dt;
        if (elapsed < interval) {
            this[timerKey] = elapsed;
            return 0;
        }
        this[timerKey] = elapsed % interval;
        return elapsed;
    }

    _resetTickState() {
        this._playerPanelTickTimer = 0;
        this._killFeedTickTimer = 0;
        this._indicatorTickTimer = 0;
        this.damageIndicatorP1?.classList.add('hidden');
        this.damageIndicatorP2?.classList.add('hidden');
        this.p1Respawn?.classList.add('hidden');
        this.p2Respawn?.classList.add('hidden');
        this.p1Respawn?.setAttribute?.('aria-hidden', 'true');
        this.p2Respawn?.setAttribute?.('aria-hidden', 'true');
        for (const cache of this._panelCache) {
            cache.hpW = null;
            cache.hpTxt = null;
            cache.shieldW = null;
            cache.shieldTxt = null;
            cache.boostW = null;
            cache.boostCooldown = null;
            cache.boostTxt = null;
            cache.overheatW = null;
            cache.overheatState = null;
            cache.overheatTxt = null;
            cache.respawnTxt = null;
        }
        this._objectiveText = null;
        this._scoreboardText = null;
        this._scoreboardDetails = null;
        this._leaderIndex = null;
        this._leaderKills = -1;
        this._localKills = -1;
        this._localAssists = -1;
        this._indicatorP2Visible = null;
    }

    _setVisible(visible) {
        this.root?.classList.toggle('hidden', !visible);
        this.root?.setAttribute?.('aria-hidden', String(!visible));
    }

    update(dt, runtimeProjection = null) {
        if (!this.root || !this.runtime) return;

        if (!this._isHuntActive(this.runtime)) {
            this._setVisible(false);
            if (this._wasHuntActive) {
                this._resetTickState();
            }
            this._wasHuntActive = false;
            return;
        }

        const projection = runtimeProjection || this._getMatchRuntimeProjection();
        const huntProjection = projection?.hunt || null;
        const projectedHumans = Array.isArray(projection?.players)
            ? projection.players.filter((player) => player?.isBot !== true)
            : null;
        const humans = projectedHumans
            || (this.runtime.entityManager ? this.runtime.entityManager.getHumanPlayers() : []);
        const huntActive = huntProjection
            ? huntProjection.active === true
            : this._isHuntActive(this.runtime);

        this._setVisible(huntActive);
        if (!huntActive) {
            if (this._wasHuntActive) {
                this._resetTickState();
            }
            this._wasHuntActive = false;
            return;
        }

        const playerPanelInterval = this._resolveUiHotpathInterval('huntPlayerPanelInterval', HOTPATH_INTERVAL_FALLBACKS.playerPanel);
        const killFeedInterval = this._resolveUiHotpathInterval('huntKillFeedInterval', HOTPATH_INTERVAL_FALLBACKS.killFeed);
        const indicatorInterval = this._resolveUiHotpathInterval('huntIndicatorInterval', HOTPATH_INTERVAL_FALLBACKS.indicator);
        if (!this._wasHuntActive) {
            this._playerPanelTickTimer = playerPanelInterval;
            this._killFeedTickTimer = killFeedInterval;
            this._indicatorTickTimer = indicatorInterval;
            this._wasHuntActive = true;
        }

        if (this._consumeTick('_playerPanelTickTimer', dt, playerPanelInterval) > 0) {
            this._updateMatchStatus(huntProjection, humans[0]?.playerIndex ?? humans[0]?.index);
            this._updatePlayerPanel(humans[0], {
                hpFill: this.p1HpFill,
                hpText: this.p1HpText,
                respawn: this.p1Respawn,
                shieldFill: this.p1ShieldFill,
                shieldText: this.p1ShieldText,
                boostFill: this.p1BoostFill,
                boostText: this.p1BoostText,
                overheatFill: this.p1OverheatFill,
                overheatText: this.p1OverheatText,
            }, this._panelCache[0], huntProjection);
            if (this.p2Panel) {
                const p2Visible = humans.length > 1;
                this.p2Panel.classList.toggle('hidden', !p2Visible);
                this.p2Panel.setAttribute?.('aria-hidden', String(!p2Visible));
                if (p2Visible) {
                    this._updatePlayerPanel(humans[1], {
                        hpFill: this.p2HpFill,
                        hpText: this.p2HpText,
                        respawn: this.p2Respawn,
                        shieldFill: this.p2ShieldFill,
                        shieldText: this.p2ShieldText,
                        boostFill: this.p2BoostFill,
                        boostText: this.p2BoostText,
                        overheatFill: this.p2OverheatFill,
                        overheatText: this.p2OverheatText,
                    }, this._panelCache[1], huntProjection);
                }
            }
        }

        if (this._consumeTick('_killFeedTickTimer', dt, killFeedInterval) > 0) {
            this._updateKillFeed(huntProjection);
        }

        const indicatorElapsed = this._consumeTick('_indicatorTickTimer', dt, indicatorInterval);
        if (indicatorElapsed > 0) {
            this._updateDamageIndicators(indicatorElapsed, humans, huntProjection);
        }
    }

    _updatePlayerPanel(player, refs, cache = null, huntProjection = null) {
        const hp = Math.max(0, Number(player?.hp) || 0);
        const maxHp = Math.max(1, Number(player?.maxHp) || 1);
        const hpW = toPercent(hp / maxHp);
        const hpTxt = `${Math.round(hp)} / ${Math.round(maxHp)}`;
        if (refs.hpFill && hpW !== cache?.hpW) {
            refs.hpFill.style.width = hpW;
            if (cache) cache.hpW = hpW;
        }
        if (refs.hpText && hpTxt !== cache?.hpTxt) {
            refs.hpText.textContent = hpTxt;
            if (cache) cache.hpTxt = hpTxt;
        }

        const shield = Math.max(0, Number(player?.shieldHP) || 0);
        const maxShield = Math.max(1, Number(player?.maxShieldHp) || 1);
        const shieldRatio = shield / maxShield;
        const shieldW = toPercent(shieldRatio);
        const shieldTxt = `${Math.round(shield)} / ${Math.round(maxShield)}`;
        if (refs.shieldFill && shieldW !== cache?.shieldW) {
            refs.shieldFill.style.width = shieldW;
            if (cache) cache.shieldW = shieldW;
        }
        if (refs.shieldText && shieldTxt !== cache?.shieldTxt) {
            refs.shieldText.textContent = shieldTxt;
            if (cache) cache.shieldTxt = shieldTxt;
        }

        const resolvedBoostCapacity = Number(player?.boostCapacity) || Number(this._getBoostCapacity(player, this.runtime));
        const boostCapacity = Math.max(
            MIN_BOOST_CAPACITY,
            Number.isFinite(resolvedBoostCapacity) ? resolvedBoostCapacity : DEFAULT_BOOST_CAPACITY
        );
        const boostCharge = Math.max(0, Math.min(boostCapacity, Number(player?.boostCharge) || 0));
        const boostRatio = clamp01(boostCharge / boostCapacity);
        const isBoostCooldown = typeof player?.boostRecharging === 'boolean'
            ? player.boostRecharging
            : (!player?.manualBoostActive && boostCharge < (boostCapacity - MIN_BOOST_CAPACITY));
        const boostW = toPercent(boostRatio);
        if (refs.boostFill) {
            if (boostW !== cache?.boostW) {
                refs.boostFill.style.width = boostW;
                refs.boostFill.style.setProperty?.('--hunt-segments-filled', `${Math.round(boostRatio * HUD_ARC_SEGMENT_COUNT)}%`);
                if (cache) cache.boostW = boostW;
            }
            if (isBoostCooldown !== cache?.boostCooldown) {
                refs.boostFill.classList.toggle('cooldown', isBoostCooldown);
                if (cache) cache.boostCooldown = isBoostCooldown;
            }
        }
        const boostTxt = `${Math.round(boostRatio * 100)}%`;
        if (refs.boostText && boostTxt !== cache?.boostTxt) {
            refs.boostText.textContent = boostTxt;
            if (cache) cache.boostTxt = boostTxt;
        }

        const overheatValue = Math.max(
            0,
            Number(huntProjection?.overheatByPlayer?.[player?.playerIndex ?? player?.index] || this.runtime?.huntState?.overheatByPlayer?.[player?.index] || 0)
        );
        const overheatRatio = clamp01(overheatValue / OVERHEAT_CAP);
        const overheatReserve = 1 - overheatRatio;
        const overheatW = toPercent(overheatReserve);
        const overheatState = overheatReserve <= OVERHEAT_DANGER_RESERVE
            ? 'danger'
            : (overheatReserve <= OVERHEAT_WARNING_RESERVE ? 'warning' : 'ready');
        const overheatTxt = `${Math.round(overheatValue)}%`;
        if (refs.overheatFill) {
            if (overheatW !== cache?.overheatW) {
                refs.overheatFill.style.width = overheatW;
                refs.overheatFill.style.setProperty?.('--hunt-segments-filled', `${Math.round(overheatReserve * HUD_ARC_SEGMENT_COUNT)}%`);
                if (cache) cache.overheatW = overheatW;
            }
            if (overheatState !== cache?.overheatState) {
                refs.overheatFill.classList.toggle('warning', overheatState === 'warning');
                refs.overheatFill.classList.toggle('danger', overheatState === 'danger');
                if (cache) cache.overheatState = overheatState;
            }
        }
        if (refs.overheatText && overheatTxt !== cache?.overheatTxt) {
            refs.overheatText.textContent = overheatTxt;
            if (cache) cache.overheatTxt = overheatTxt;
        }

        const playerIndex = player?.playerIndex ?? player?.index;
        const remaining = Math.max(0, Number(huntProjection?.respawnRemainingByPlayer?.[playerIndex]) || 0);
        const respawnTxt = remaining > 0 ? `Wiedereinstieg in ${remaining.toFixed(1)} s` : '';
        if (refs.respawn) {
            if (respawnTxt !== cache?.respawnTxt) {
                refs.respawn.textContent = respawnTxt;
                if (cache) cache.respawnTxt = respawnTxt;
            }
            refs.respawn.classList.toggle('hidden', !respawnTxt);
            refs.respawn.setAttribute?.('aria-hidden', String(!respawnTxt));
        }
    }

    _updateMatchStatus(huntProjection = null, localPlayerIndex = -1) {
        const respawnEnabled = huntProjection?.respawnEnabled === true;
        const killLimit = Math.max(1, Number(huntProjection?.deathmatchKillLimit) || 10);
        const rows = Array.isArray(huntProjection?.scoreboardRows) ? huntProjection.scoreboardRows : [];
        const leader = rows[0] || null;
        const localRow = rows.find((row) => row?.playerIndex === localPlayerIndex) || null;
        const timeText = huntProjection?.overtime
            ? ' · Golden Kill'
            : (Number(huntProjection?.timeLimitSeconds) > 0 ? ` · ${formatClock(huntProjection?.timeRemainingSeconds)}` : '');
        const matchPointText = leader && leader.kills === killLimit - 1 ? ' · Matchball' : '';
        const objectiveText = respawnEnabled
            ? `Deathmatch · zuerst ${killLimit} Abschüsse${timeText}${matchPointText}`
            : 'Elimination · letzter Überlebender gewinnt';
        const visibleRows = rows.slice(0, 3);
        if (localRow && !visibleRows.includes(localRow)) visibleRows.push(localRow);
        const scoreboardText = visibleRows.length > 0
            ? visibleRows.map((row) => `${row.playerIndex === localPlayerIndex ? '▶ ' : ''}${row.label} ${row.kills}`).join('   |   ')
            : String(huntProjection?.scoreboardSummary || 'Noch keine Abschüsse');
        const scoreboardDetails = rows.length > 0
            ? rows.map((row) => `${row.label}: ${row.kills}/${killLimit} Abschüsse, ${row.deaths} Tode, ${row.assists} Assists`).join('. ')
            : scoreboardText;
        if (leader && this._leaderIndex !== null && leader.playerIndex !== this._leaderIndex) {
            this.runtime?.audio?.play?.('FIGHT_LEAD');
        } else if (leader && leader.kills === killLimit - 1 && leader.kills !== this._leaderKills) {
            this.runtime?.audio?.play?.('FIGHT_LEAD');
        }
        if (huntProjection?.authoritativeClient && this._localKills >= 0 && Number(localRow?.kills) > this._localKills) {
            this.runtime?.audio?.play?.('FIGHT_KILL');
        }
        if (huntProjection?.authoritativeClient && this._localAssists >= 0 && Number(localRow?.assists) > this._localAssists) {
            this.runtime?.audio?.play?.('FIGHT_ASSIST');
        }
        this._leaderIndex = leader?.playerIndex ?? null;
        this._leaderKills = Number(leader?.kills) || 0;
        this._localKills = Number(localRow?.kills) || 0;
        this._localAssists = Number(localRow?.assists) || 0;
        if (this.objective && objectiveText !== this._objectiveText) {
            this.objective.textContent = objectiveText;
            this._objectiveText = objectiveText;
        }
        if (this.scoreboard && scoreboardText !== this._scoreboardText) {
            this.scoreboard.textContent = scoreboardText;
            this._scoreboardText = scoreboardText;
        }
        if (this.scoreboard && scoreboardDetails !== this._scoreboardDetails) {
            this.scoreboard.setAttribute?.('aria-label', scoreboardDetails);
            this._scoreboardDetails = scoreboardDetails;
        }
    }

    _ensureKillFeedSlots() {
        if (!this.killFeedList || this._killFeedSlots.length > 0) return;
        this.killFeedList.textContent = '';
        for (let i = 0; i < KILL_FEED_SLOT_COUNT; i += 1) {
            const slot = this._createKillFeedItem();
            if (!slot) break;
            slot.hidden = true;
            this.killFeedList.appendChild(slot);
            this._killFeedSlots.push(slot);
        }
    }

    _updateKillFeed(huntProjection = null) {
        if (!this.killFeedList) return;
        this._ensureKillFeedSlots();

        const entries = Array.isArray(huntProjection?.killFeed)
            ? huntProjection.killFeed
            : (Array.isArray(this.runtime?.huntState?.killFeed) ? this.runtime.huntState.killFeed : []);

        const slotCount = this._killFeedSlots.length;
        for (let i = 0; i < slotCount; i += 1) {
            const slot = this._killFeedSlots[i];
            const nextText = i < entries.length ? String(entries[i]) : '';
            if (this._killFeedCachedTexts[i] !== nextText) {
                slot.textContent = nextText;
                this._killFeedCachedTexts[i] = nextText;
            }

            const shouldHide = nextText === '';
            if (slot.hidden !== shouldHide) {
                slot.hidden = shouldHide;
            }
        }
    }

    _resolveDamageIndicatorState(playerIndex, huntProjection = null, allowLegacyFallback = false) {
        const byPlayer = huntProjection?.damageIndicatorsByPlayer;
        if (Number.isInteger(playerIndex) && byPlayer && typeof byPlayer === 'object') {
            const indicatorByPlayer = byPlayer[playerIndex];
            if (indicatorByPlayer) {
                return indicatorByPlayer;
            }
        }
        if (!allowLegacyFallback) return null;
        return huntProjection?.damageIndicator || this.runtime?.huntState?.damageIndicator || null;
    }

    _updateDamageIndicatorElement(element, indicator, dt) {
        if (!element) return;
        if (!indicator) {
            element.classList.add('hidden');
            return;
        }

        let remainingMs = Number(indicator.remainingMs);
        if (!Number.isFinite(remainingMs)) {
            const legacyTtl = Number(indicator.ttl);
            if (Number.isFinite(legacyTtl)) {
                indicator.ttl = Math.max(0, legacyTtl - dt);
                remainingMs = indicator.ttl * 1000;
            }
        }
        if (!(remainingMs > 0)) {
            element.classList.add('hidden');
            return;
        }

        const angle = Number(indicator.angleDeg) || 0;
        const intensity = clamp01(indicator.intensity || INDICATOR_DEFAULT_INTENSITY);
        element.classList.remove('hidden');
        element.style.opacity = String(Math.max(INDICATOR_MIN_OPACITY, intensity));
        element.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(1)}deg) scale(var(--hud-scale, 1))`;
    }

    _updateDamageIndicators(dt, humans = [], huntProjection = null) {
        const p1 = humans[0] || null;
        const p2Visible = humans.length > 1;
        if (p2Visible !== this._indicatorP2Visible) {
            if (this.damageIndicatorP1) {
                this.damageIndicatorP1.style.left = p2Visible ? '25%' : '50%';
            }
            if (this.damageIndicatorP2) {
                this.damageIndicatorP2.style.left = p2Visible ? '75%' : '50%';
            }
            this._indicatorP2Visible = p2Visible;
        }
        const p1Indicator = this._resolveDamageIndicatorState(p1?.playerIndex ?? p1?.index, huntProjection, true);
        this._updateDamageIndicatorElement(this.damageIndicatorP1, p1Indicator, dt);

        if (!p2Visible) {
            this.damageIndicatorP2?.classList.add('hidden');
            return;
        }
        const p2 = humans[1] || null;
        const p2Indicator = this._resolveDamageIndicatorState(p2?.playerIndex ?? p2?.index, huntProjection, false);
        this._updateDamageIndicatorElement(this.damageIndicatorP2, p2Indicator, dt);
    }

    dispose() {
        this._resetTickState();
        this._setVisible(false);
        this.p2Panel?.classList.add('hidden');
        this.p2Panel?.setAttribute?.('aria-hidden', 'true');
        if (this.killFeedList) {
            this.killFeedList.textContent = '';
        }
        this._killFeedSlots.length = 0;
        this._killFeedCachedTexts.fill('');
        this._wasHuntActive = false;
        this.runtime = null;
        this.ports = null;
    }
}
