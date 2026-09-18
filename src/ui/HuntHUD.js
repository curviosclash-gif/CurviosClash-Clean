import { clamp01 } from '../shared/utils/MathOps.js';
import { createHuntHudDomRefs } from './dom/HuntHudDomRefs.js';
import {
    createDamageIndicatorCache,
    resolveOverlayLeft,
    updateHuntDamageIndicators,
} from './HuntHudDamageIndicators.js';
import { updateHuntReserveArcs } from './HuntHudReserveArcs.js';
import { createRocketWarningCache, hideRocketWarning, updateRocketWarning } from './HuntHudRocketWarning.js';
import { MatchHudAnnouncement } from './MatchHudAnnouncement.js';
import { HuntInterceptAnnouncer } from './HuntInterceptAnnouncer.js';
import { SecretRoomAnnouncer } from './SecretRoomAnnouncer.js';
import { formatHuntClock, formatHuntScoreboard, resolveHuntObjectiveText, updateHuntTargetProgress } from './HuntMatchStatusHelpers.js';
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
const OVERHEAT_CAP = 100;
const OVERHEAT_WARNING_RESERVE = 0.6;
const OVERHEAT_DANGER_RESERVE = 0.3;
const DEFAULT_BOOST_CAPACITY = 1;
function toPercent(value) {
    return `${(clamp01(value) * 100).toFixed(1)}%`;
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
        this.targetProgress = refs.targetProgress ?? null;
        this._progressState = { target: 0, filled: -1 };
        this._matchAnnouncement = this.root?.ownerDocument
            ? new MatchHudAnnouncement(this.root) : null;
        this._interceptAnnouncer = new HuntInterceptAnnouncer();
        this._secretRoomAnnouncer = new SecretRoomAnnouncer();
        this.p1HpFill = refs.p1HpFill ?? null;
        this.p1HpText = refs.p1HpText ?? null;
        this.p1Respawn = refs.p1Respawn ?? null;
        this.p1ShieldFill = refs.p1ShieldFill ?? null;
        this.p1ShieldText = refs.p1ShieldText ?? null;
        this.p1BoostFill = refs.p1BoostFill ?? null;
        this.p1BoostText = refs.p1BoostText ?? null;
        this.p1SlowMoFill = refs.p1SlowMoFill ?? null;
        this.p1SlowMoText = refs.p1SlowMoText ?? null;
        this.p1OverheatFill = refs.p1OverheatFill ?? null;
        this.p1OverheatText = refs.p1OverheatText ?? null;
        this.p1Turret = refs.p1Turret ?? null;
        this.p2Panel = refs.p2Panel ?? null;
        this.p2HpFill = refs.p2HpFill ?? null;
        this.p2HpText = refs.p2HpText ?? null;
        this.p2Respawn = refs.p2Respawn ?? null;
        this.p2ShieldFill = refs.p2ShieldFill ?? null;
        this.p2ShieldText = refs.p2ShieldText ?? null;
        this.p2BoostFill = refs.p2BoostFill ?? null;
        this.p2BoostText = refs.p2BoostText ?? null;
        this.p2SlowMoFill = refs.p2SlowMoFill ?? null;
        this.p2SlowMoText = refs.p2SlowMoText ?? null;
        this.p2OverheatFill = refs.p2OverheatFill ?? null;
        this.p2OverheatText = refs.p2OverheatText ?? null;
        this.p2Turret = refs.p2Turret ?? null;
        this.killFeedList = refs.killFeedList ?? null;
        this._killFeedSlots = [];
        this._killFeedCachedTexts = new Array(KILL_FEED_SLOT_COUNT).fill('');
        this._createKillFeedItem = resolveCreateListItem(refs);
        this.damageIndicatorP1 = refs.damageIndicatorP1 ?? null;
        this.damageIndicatorP2 = refs.damageIndicatorP2 ?? null;
        this._damageIndicatorElements = { p1: this.damageIndicatorP1, p2: this.damageIndicatorP2 };
        this._damageIndicatorCache = createDamageIndicatorCache();
        this._rocketWarningRefs = [
            { root: refs.rocketWarningP1 ?? null, arrow: refs.rocketWarningArrowP1 ?? null, text: refs.rocketWarningTextP1 ?? null },
            { root: refs.rocketWarningP2 ?? null, arrow: refs.rocketWarningArrowP2 ?? null, text: refs.rocketWarningTextP2 ?? null },
        ];
        this._rocketWarningCaches = [createRocketWarningCache(), createRocketWarningCache()];
        // Reused per tick so the indicator hot path allocates nothing.
        this._rocketWarningOptions = { huntActive: true, reduceMotion: true, leftPercent: '50%' };
        this._playerPanelTickTimer = 0;
        this._killFeedTickTimer = 0;
        this._indicatorTickTimer = 0;
        this._wasHuntActive = false;
        this._panelCache = [
            { hpW: null, hpTxt: null, shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, slowMoW: null, slowMoCooldownState: null, slowMoTxt: null, overheatW: null, overheatState: null, overheatTxt: null, respawnTxt: null, turretTxt: null },
            { hpW: null, hpTxt: null, shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, slowMoW: null, slowMoCooldownState: null, slowMoTxt: null, overheatW: null, overheatState: null, overheatTxt: null, respawnTxt: null, turretTxt: null },
        ];
        this._objectiveText = null;
        this._scoreboardText = null;
        this._scoreboardDetails = null;
        this._leaderIndex = null;
        this._leaderKills = -1;
        this._isHuntActive = typeof options.isHuntActive === 'function'
            ? options.isHuntActive
            : defaultIsHuntActive;
        this._getBoostCapacity = typeof options.getBoostCapacity === 'function'
            ? options.getBoostCapacity
            : () => DEFAULT_BOOST_CAPACITY;
        this._getSlowMoCapacity = typeof options.getSlowMoCapacity === 'function'
            ? options.getSlowMoCapacity
            : () => DEFAULT_BOOST_CAPACITY;

        for (const arcFill of [
            this.p1BoostFill, this.p1SlowMoFill, this.p1OverheatFill,
            this.p2BoostFill, this.p2SlowMoFill, this.p2OverheatFill,
        ]) {
            initializeHudSegmentedArc(arcFill);
        }
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
        for (let i = 0; i < this._rocketWarningRefs.length; i += 1) {
            hideRocketWarning(this._rocketWarningRefs[i], this._rocketWarningCaches[i]);
        }
        this.p1Respawn?.classList.add('hidden');
        this.p2Respawn?.classList.add('hidden');
        this.p1Turret?.classList.add('hidden');
        this.p2Turret?.classList.add('hidden');
        this.p1Respawn?.setAttribute?.('aria-hidden', 'true');
        this.p2Respawn?.setAttribute?.('aria-hidden', 'true');
        this.p1Turret?.setAttribute?.('aria-hidden', 'true');
        this.p2Turret?.setAttribute?.('aria-hidden', 'true');
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
            cache.turretTxt = null;
        }
        this._objectiveText = null;
        this._scoreboardText = null;
        this._scoreboardDetails = null;
        this._leaderIndex = null;
        this._leaderKills = -1;
        this._matchAnnouncement?.reset();
        this._interceptAnnouncer.reset();
        this._secretRoomAnnouncer.reset();
        this._progressState.filled = -1;
        this.targetProgress?.classList.add('hidden');
        this._damageIndicatorCache.p2Visible = null;
    }

    resetMatchScoreEvents() {
        this._matchAnnouncement?.reset();
        this._interceptAnnouncer.reset();
        this._leaderIndex = null;
        this._leaderKills = -1;
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
            this._updateMatchStatus(huntProjection, humans.map((human) => human?.playerIndex ?? human?.index));
            // E8: the opened room count is match wide, so any projected player carries it.
            const secretRoomMessage = this._secretRoomAnnouncer.consume(humans[0]?.secretRoomsOpen);
            if (secretRoomMessage) this._matchAnnouncement?.show(secretRoomMessage);
            this._updatePlayerPanel(humans[0], {
                hpFill: this.p1HpFill,
                hpText: this.p1HpText,
                respawn: this.p1Respawn,
                shieldFill: this.p1ShieldFill,
                shieldText: this.p1ShieldText,
                boostFill: this.p1BoostFill,
                boostText: this.p1BoostText,
                slowMoFill: this.p1SlowMoFill,
                slowMoText: this.p1SlowMoText,
                overheatFill: this.p1OverheatFill,
                overheatText: this.p1OverheatText,
                turret: this.p1Turret,
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
                        slowMoFill: this.p2SlowMoFill,
                        slowMoText: this.p2SlowMoText,
                        overheatFill: this.p2OverheatFill,
                        overheatText: this.p2OverheatText,
                        turret: this.p2Turret,
                    }, this._panelCache[1], huntProjection);
                }
            }
        }

        if (this._consumeTick('_killFeedTickTimer', dt, killFeedInterval) > 0) {
            this._updateKillFeed(huntProjection);
        }

        const indicatorElapsed = this._consumeTick('_indicatorTickTimer', dt, indicatorInterval);
        if (indicatorElapsed > 0) {
            this._updateThreatOverlays(indicatorElapsed, humans, huntProjection);
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

        updateHuntReserveArcs(
            player,
            refs,
            cache,
            Number(this._getBoostCapacity(player, this.runtime)),
            Number(this._getSlowMoCapacity(player, this.runtime))
        );

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
        const turretState = player?.turret || null;
        const turretTxt = player?.turrets?.length
            ? player.turrets.map((entry) => `${entry.weapon === 'rocket' ? 'Raketenwerfer' : 'MG'} ${Math.ceil(entry.remainingSeconds)} s · ${Math.ceil(entry.hp)}/${Math.ceil(entry.maxHp)} HP`).join(' | ')
            : turretState
            ? `Geschütz ${Math.ceil(turretState.remainingSeconds)} s · ${Math.ceil(turretState.hp)}/${Math.ceil(turretState.maxHp)} HP`
            : '';
        if (refs.turret) {
            if (turretTxt !== cache?.turretTxt) {
                refs.turret.textContent = turretTxt;
                if (cache) cache.turretTxt = turretTxt;
            }
            refs.turret.classList.toggle('hidden', !turretTxt);
            refs.turret.setAttribute?.('aria-hidden', String(!turretTxt));
        }
    }

    _updateMatchStatus(huntProjection = null, localPlayerIndices = []) {
        const respawnEnabled = huntProjection?.respawnEnabled === true;
        const killLimit = Math.max(1, Number(huntProjection?.deathmatchKillLimit) || 10);
        const rows = Array.isArray(huntProjection?.scoreboardRows) ? huntProjection.scoreboardRows : [];
        const leader = rows[0] || null;
        const timeText = huntProjection?.overtime
            ? ' · Golden Kill'
            : (Number(huntProjection?.timeLimitSeconds) > 0 ? ` · ${formatHuntClock(huntProjection?.timeRemainingSeconds)}` : '');
        const matchPointText = leader && leader.kills === killLimit - 1 ? ' · Matchball' : '';
        const objectiveText = resolveHuntObjectiveText(huntProjection, this.runtime?.runtimeConfig, { killLimit, timeText, matchPointText });
        const scoreboardText = formatHuntScoreboard(rows, localPlayerIndices, huntProjection?.scoreboardSummary);
        const scoreboardDetails = rows.length > 0
            ? rows.map((row) => `${row.label}: ${row.kills}/${killLimit} Abschüsse, ${row.deaths} Tode, ${row.assists} Assists`).join('. ')
            : scoreboardText;
        updateHuntTargetProgress(this.targetProgress, this._progressState,
            respawnEnabled ? killLimit : 0, leader?.kills || 0);
        if (leader && this._leaderIndex !== null && leader.playerIndex !== this._leaderIndex) {
            this.runtime?.audio?.play?.('FIGHT_LEAD');
        } else if (leader && leader.kills === killLimit - 1 && leader.kills !== this._leaderKills) {
            this.runtime?.audio?.play?.('FIGHT_LEAD');
        }
        this._leaderIndex = leader?.playerIndex ?? null;
        this._leaderKills = Number(leader?.kills) || 0;
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
        this._matchAnnouncement?.observe(rows, {
            scoreKey: 'kills',
            target: respawnEnabled ? killLimit : 0,
        });
        const interceptMessage = this._interceptAnnouncer.consume(rows, localPlayerIndices);
        if (interceptMessage) this._matchAnnouncement?.show(interceptMessage);
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

    _updateThreatOverlays(dt, humans = [], huntProjection = null) {
        const p2Visible = updateHuntDamageIndicators(
            this._damageIndicatorElements,
            this._damageIndicatorCache,
            humans,
            huntProjection,
            this.runtime?.huntState?.damageIndicator || null,
            dt
        );
        const options = this._rocketWarningOptions;
        options.reduceMotion = this.runtime?.runtimeConfig?.cameraPerspective?.reduceMotion !== false;
        for (let i = 0; i < this._rocketWarningRefs.length; i += 1) {
            options.leftPercent = resolveOverlayLeft(p2Visible, i === 1);
            updateRocketWarning(
                this._rocketWarningRefs[i],
                this._rocketWarningCaches[i],
                i === 0 || p2Visible ? humans[i] : null,
                options
            );
        }
    }

    dispose() {
        this._resetTickState();
        this._matchAnnouncement?.dispose();
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
