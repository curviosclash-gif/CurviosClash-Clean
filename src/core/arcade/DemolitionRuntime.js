import {
    DEMOLITION_COMBAT_PROFILE,
    DEMOLITION_RUN_TYPE,
    DEMOLITION_WEAPON_RULES,
    DEMOLITION_XP_RULES,
    calculateDemolitionMapScore,
    createDemolitionMapPlan,
    resolveDemolitionMedal,
} from '../../shared/contracts/DemolitionContract.js';
import { MAP_DESTRUCTIBLE_KINDS } from '../../shared/contracts/MapDestructibleContract.js';
import {
    awardBoundArcadeVehicleXpInStore,
    bindArcadeVehicleRewards,
} from '../../state/arcade/ArcadeVehicleRewardBinding.js';

const ROCKET_MEDIUM = 'ROCKET_MEDIUM';
const PRESSURE_WARNING_RATIO = 0.25;

function safeCount(value) {
    return Math.max(0, Math.trunc(Number(value) || 0));
}

function allSegmentsDestroyed(state) {
    const segments = Array.isArray(state?.segments) ? state.segments : [];
    return segments.length > 0
        && segments.every((segment) => segment?.destroyed === true || segment?.collapsed === true);
}

/** A three-map demolition run. The runtime survives the rebuilt match session between maps. */
export class DemolitionRuntime {
    /**
     * @param {{
     * getMultiplier?: () => number,
     * getRecordStoreForPlayerIndex?: (playerIndex: number, profileId: string) => ReturnType<import('../../application/player-profile/PlayerProfileManager.js').PlayerProfileManager['getRecordStorePort']> | null,
     * onComboAction?: (event: {type: 'kill'}) => void,
     * requestMapTransition?: (transition: {mapKey: string, botCount: number, combatProfile: string, demolition: true}) => void,
     * requestAdvance?: () => void,
     * }=} options
     */
    constructor({
        getMultiplier = () => 1,
        getRecordStoreForPlayerIndex = () => null,
        onComboAction = () => {},
        requestMapTransition = () => {},
        requestAdvance = () => {},
    } = {}) {
        this._getMultiplier = getMultiplier;
        this._getRecordStoreForPlayerIndex = getRecordStoreForPlayerIndex;
        this._onComboAction = onComboAction;
        this._requestMapTransition = requestMapTransition;
        this._requestAdvance = requestAdvance;
        this.reset();
    }

    reset() {
        this.entityManager = null;
        this.phase = 'idle';
        this.plan = createDemolitionMapPlan(1);
        this.mapIndex = 0;
        this.remainingSeconds = 0;
        this.mapStats = [];
        this.breakEvents = 0;
        this.unitsDestroyed = 0;
        this.kills = 0;
        this._observedBreakCount = 0;
        this._transitionRequested = false;
        this.rewardBinding = null;
        this.playerBindings = new Map();
        this.xpEarned = 0;
    }

    _human() {
        return this.entityManager?.humanPlayers?.find((player) => player && player.isBot !== true) || null;
    }

    _awardXp(amount, playerIndex = null) {
        const multiplier = Math.min(
            DEMOLITION_XP_RULES.multiplierCap,
            Math.max(1, Number(this._getMultiplier?.()) || 1),
        );
        const targets = playerIndex === null
            ? [...this.playerBindings.values()]
            : [this.playerBindings.get(Number(playerIndex))].filter(Boolean);
        const results = targets.map((target) => awardBoundArcadeVehicleXpInStore(
            target.store,
            target.rewardBinding,
            Math.floor(Math.max(0, Number(amount) || 0) * multiplier),
        )).filter(Boolean);
        for (const result of results) this.xpEarned += result.earned;
        return results[0] || null;
    }

    _equipStartingRockets() {
        for (const player of this.entityManager?.humanPlayers || []) {
            if (!Array.isArray(player.rocketInventory)) player.rocketInventory = [];
            player.rocketInventory.length = 0;
            for (let index = 0; index < DEMOLITION_WEAPON_RULES.startingMediumRockets; index += 1) {
                player.rocketInventory.push(ROCKET_MEDIUM);
            }
        }
    }

    _startCurrentMap() {
        const profile = this.plan.maps[this.mapIndex];
        this.phase = 'active';
        this.remainingSeconds = Math.max(0, Number(profile?.timeLimitSeconds) || 0);
        this.breakEvents = 0;
        this.unitsDestroyed = 0;
        this.kills = 0;
        this._observedBreakCount = 0;
        this._transitionRequested = false;
        this._equipStartingRockets();
    }

    start({ entityManager = null, seed = 1, vehicleId = 'ship1', profileIds = [] } = {}) {
        if (this.phase === 'idle' || this.phase === 'finished') {
            this.reset();
            this.plan = createDemolitionMapPlan(seed);
            this.entityManager = entityManager;
            this.playerBindings.clear();
            for (const player of entityManager?.humanPlayers || []) {
                const playerIndex = Number(player?.index);
                const profileId = String(profileIds?.[playerIndex] || '').trim();
                const playerVehicleId = String(player?.vehicleId || (playerIndex === 0 ? vehicleId : '')).trim();
                if (!Number.isInteger(playerIndex) || !profileId || !playerVehicleId) continue;
                const rewardBinding = bindArcadeVehicleRewards({ runType: DEMOLITION_RUN_TYPE, vehicleId: playerVehicleId });
                const store = this._getRecordStoreForPlayerIndex?.(playerIndex, profileId) || null;
                if (rewardBinding && store) this.playerBindings.set(playerIndex, { playerIndex, profileId, vehicleId: playerVehicleId, store, rewardBinding });
            }
            this.rewardBinding = this.playerBindings.get(0)?.rewardBinding || null;
            this._startCurrentMap();
            return this.getHudState();
        }
        this.entityManager = entityManager || this.entityManager;
        if (this.phase === 'transition') this._startCurrentMap();
        return this.getHudState();
    }

    _isHumanEvent(event) {
        const playerIndex = Number(event?.playerIndex);
        return Number.isInteger(playerIndex)
            && this.entityManager?.humanPlayers?.some((player) => Number(player?.index) === playerIndex);
    }

    handleGameplayEvent(event) {
        if (this.phase !== 'active' || !this._isHumanEvent(event)) return null;
        const count = safeCount(event?.count);
        if (count <= 0) return null;
        if (event?.type === 'unit_destroyed') {
            this.unitsDestroyed += count;
            for (let index = 0; index < count; index += 1) this._onComboAction?.({ type: 'kill' });
            this._awardXp(count * DEMOLITION_XP_RULES.unitDestroyed, Number(event.playerIndex));
        } else if (event?.type === 'kill') {
            this.kills += count;
            for (let index = 0; index < count; index += 1) this._onComboAction?.({ type: 'kill' });
            this._awardXp(count * DEMOLITION_XP_RULES.kill, Number(event.playerIndex));
        } else {
            return null;
        }
        return this.getHudState();
    }

    _processBreakEvents(state) {
        const eventCount = Array.isArray(state?.events) ? state.events.length : 0;
        if (eventCount <= this._observedBreakCount) return;
        const added = eventCount - this._observedBreakCount;
        this._observedBreakCount = eventCount;
        this.breakEvents += added;
        for (let index = 0; index < added; index += 1) this._onComboAction?.({ type: 'kill' });
        this._awardXp(added * DEMOLITION_XP_RULES.breakEvent);
    }

    _finishCurrentMap(state, { timedOut = false } = {}) {
        const profile = this.plan.maps[this.mapIndex];
        const score = calculateDemolitionMapScore({
            mapKey: profile?.mapKey,
            state,
            remainingSeconds: this.remainingSeconds,
        });
        const medal = resolveDemolitionMedal(profile?.mapKey, score.total);
        if (!timedOut) this._awardXp(DEMOLITION_XP_RULES.mapComplete);
        this.mapStats[this.mapIndex] = Object.freeze({
            mapKey: profile?.mapKey || '',
            mapLabel: profile?.label || '',
            remainingSeconds: this.remainingSeconds,
            breakEvents: this.breakEvents,
            unitsDestroyed: this.unitsDestroyed,
            kills: this.kills,
            score,
            medal,
            timedOut,
        });
        if (this.mapIndex >= this.plan.maps.length - 1) {
            this.phase = 'finished';
            return;
        }
        this.mapIndex += 1;
        this.phase = 'transition';
        if (this._transitionRequested) return;
        this._transitionRequested = true;
        const next = this.plan.maps[this.mapIndex];
        this._requestMapTransition({
            mapKey: next.mapKey,
            botCount: next.botCount,
            combatProfile: DEMOLITION_COMBAT_PROFILE,
            demolition: true,
        });
        this._requestAdvance();
    }

    update(dt = 0) {
        if (this.phase !== 'active') return;
        this.remainingSeconds = Math.max(0, this.remainingSeconds - Math.max(0, Number(dt) || 0));
        const state = this.entityManager?._mapDestructibleSystem?.getState?.() || null;
        this._processBreakEvents(state);
        if (state?.sealed === true || allSegmentsDestroyed(state)) {
            this._finishCurrentMap(state);
            return;
        }
        if (this.remainingSeconds <= 0) this._finishCurrentMap(state, { timedOut: true });
    }

    _resolveWarning(state, hud) {
        const profile = this.plan.maps[this.mapIndex];
        if (!profile || !state) return '';
        if (profile.mapKey === 'reactor_site') {
            const reactor = state.segments?.find((segment) => segment?.id === 'reactor_dome');
            const otherStanding = state.segments?.some((segment) => segment?.id !== 'reactor_dome'
                && segment?.destroyed !== true && segment?.collapsed !== true);
            if (reactor?.destroyed !== true && otherStanding) return profile.collapseWarning;
        }
        const focus = hud?.focusSegment;
        if (!focus || Number(focus.ratio) > PRESSURE_WARNING_RATIO) return '';
        const definition = this.entityManager?._mapDestructibleSystem?.getDefinition?.();
        const authored = definition?.segments?.find((segment) => segment?.id === focus.id);
        const rule = MAP_DESTRUCTIBLE_KINDS[String(authored?.kind || '')];
        if (rule?.sealsTower === true || profile.mapKey === 'skyline_siege') return profile.collapseWarning;
        return '';
    }

    dispose() {
        this.reset();
    }

    get totalScore() {
        return this.mapStats.reduce((total, stat) => total + (Number(stat?.score?.total) || 0), 0);
    }

    getHudState() {
        const profile = this.plan.maps[this.mapIndex] || null;
        const destructibles = this.entityManager?._mapDestructibleSystem || null;
        const state = destructibles?.getState?.() || null;
        const destructibleHud = destructibles?.getHudState?.() || null;
        const currentScore = calculateDemolitionMapScore({
            mapKey: profile?.mapKey,
            state,
            remainingSeconds: this.remainingSeconds,
        });
        const activeScore = this.phase === 'active' ? currentScore : null;
        const summary = this.phase === 'finished'
            ? {
                score: this.totalScore,
                total: this.totalScore,
                xpEarned: this.xpEarned,
                maps: this.mapStats.map((stat) => ({ ...stat, score: { ...stat.score } })),
            }
            : null;
        return {
            runType: DEMOLITION_RUN_TYPE,
            vehicleId: this.rewardBinding?.vehicleId || '',
            xpEarned: this.xpEarned,
            phase: this.phase,
            mapIndex: this.mapIndex,
            mapCount: this.plan.maps.length,
            currentMapKey: profile?.mapKey || '',
            currentMapLabel: profile?.label || '',
            briefing: profile?.briefing || '',
            warning: this._resolveWarning(state, destructibleHud),
            remainingSeconds: this.remainingSeconds,
            timeExpired: this.remainingSeconds <= 0,
            breakEvents: this.breakEvents,
            unitsDestroyed: this.unitsDestroyed,
            kills: this.kills,
            destructible: destructibleHud,
            score: { total: this.totalScore + (activeScore?.total || 0), currentMap: activeScore },
            mapStats: this.mapStats.map((stat) => ({ ...stat, score: { ...stat.score } })),
            postRunSummary: summary,
        };
    }
}
