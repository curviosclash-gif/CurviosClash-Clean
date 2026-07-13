import { clamp01 } from '../utils/MathOps.js';
import { createHuntHudDomRefs } from './dom/HuntHudDomRefs.js';

const HOTPATH_INTERVAL_FALLBACKS = Object.freeze({
    playerPanel: 0.12,
    killFeed: 0.12,
    indicator: 0.04,
});
const KILL_FEED_SLOT_COUNT = 5;
const MIN_BOOST_CAPACITY = 0.001;
const OVERHEAT_CAP = 100;
const INDICATOR_DEFAULT_INTENSITY = 0.6;
const INDICATOR_MIN_OPACITY = 0.2;
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
        this.p1ShieldFill = refs.p1ShieldFill ?? null;
        this.p1ShieldText = refs.p1ShieldText ?? null;
        this.p1BoostFill = refs.p1BoostFill ?? null;
        this.p1BoostText = refs.p1BoostText ?? null;
        this.p1OverheatFill = refs.p1OverheatFill ?? null;
        this.p1OverheatText = refs.p1OverheatText ?? null;
        this.p2Panel = refs.p2Panel ?? null;
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
            { shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, overheatW: null, overheatTxt: null },
            { shieldW: null, shieldTxt: null, boostW: null, boostCooldown: null, boostTxt: null, overheatW: null, overheatTxt: null },
        ];
        this._indicatorP2Visible = null;
        this._isHuntActive = typeof options.isHuntActive === 'function'
            ? options.isHuntActive
            : defaultIsHuntActive;
        this._getBoostCapacity = typeof options.getBoostCapacity === 'function'
            ? options.getBoostCapacity
            : () => DEFAULT_BOOST_CAPACITY;
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
        for (const cache of this._panelCache) {
            cache.shieldW = null;
            cache.shieldTxt = null;
            cache.boostW = null;
            cache.boostCooldown = null;
            cache.boostTxt = null;
            cache.overheatW = null;
            cache.overheatTxt = null;
        }
        this._indicatorP2Visible = null;
    }

    update(dt) {
        if (!this.root || !this.runtime) return;

        const projection = this._getMatchRuntimeProjection();
        const huntProjection = projection?.hunt || null;
        const projectedHumans = Array.isArray(projection?.players)
            ? projection.players.filter((player) => player?.isBot !== true)
            : null;
        const humans = projectedHumans
            || (this.runtime.entityManager ? this.runtime.entityManager.getHumanPlayers() : []);
        const huntActive = huntProjection
            ? huntProjection.active === true
            : this._isHuntActive(this.runtime);

        this.root.classList.toggle('hidden', !huntActive);
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
            this._updatePlayerPanel(humans[0], {
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
                if (p2Visible) {
                    this._updatePlayerPanel(humans[1], {
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
        const overheatW = toPercent(overheatRatio);
        const overheatTxt = `${Math.round(overheatValue)}%`;
        if (refs.overheatFill && overheatW !== cache?.overheatW) {
            refs.overheatFill.style.width = overheatW;
            if (cache) cache.overheatW = overheatW;
        }
        if (refs.overheatText && overheatTxt !== cache?.overheatTxt) {
            refs.overheatText.textContent = overheatTxt;
            if (cache) cache.overheatTxt = overheatTxt;
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
        element.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(1)}deg)`;
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
        this.root?.classList.add('hidden');
        this.p2Panel?.classList.add('hidden');
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
