import { resolveHuntParcoursMedal, resolveHuntParcoursVariant } from '../../shared/contracts/HuntParcoursContract.js';
import { isRocketTierType } from '../../hunt/RocketPickupSystem.js';
import { settleArcadeRunRanking } from '../../state/arcade/ArcadeRunRanking.js';
import { trackArcadeColorEvent } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { XP_REWARD_TABLE } from '../../state/arcade/ArcadeVehicleProfile.js';
import { bindArcadeVehicleRewards } from '../../state/arcade/ArcadeVehicleRewardBinding.js';
import { HuntParcoursRewards } from './HuntParcoursRewards.js';
import { HuntParcoursRecords } from './HuntParcoursRecords.js';
import {
    HUNT_PARCOURS_RIVAL_STORAGE_KEY,
    applyHuntParcoursRivalDefeat,
    applyHuntParcoursRivalVictory,
    createHuntParcoursRivalState,
    isWritableHuntParcoursRivalState,
    normalizeHuntParcoursRivalState,
    resolveHuntParcoursRivalModifiers,
    scoreHuntParcoursNemesisMap,
} from '../../shared/contracts/HuntParcoursRivalContract.js';
import {
    HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY,
    isWritableHuntParcoursMedalRecord,
    normalizeHuntParcoursMedalRecord,
    recordHuntParcoursResult,
} from '../../shared/contracts/HuntParcoursMedalRecordContract.js';
import { resolveHuntParcoursStageResult } from './HuntParcoursVariantRules.js';
import { applyHuntParcoursRivalSpawnBonuses } from '../../entities/ai/HeuristicHuntParcoursModifierOps.js';
import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import { ThunderflightRunOps } from './ThunderflightRunOps.js';

function safeCount(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

/** One multi-map Hunt-Parcours run; the object survives the match-session rebuild between maps. */
export class HuntParcoursRuntime {
    constructor({ getRecordStore = () => null, getPlayerRewardTarget = () => null, requestMapTransition = () => {}, requestAdvance = () => {} } = {}) {
        this._getRecordStore = getRecordStore;
        this._getPlayerRewardTarget = getPlayerRewardTarget;
        this._requestMapTransition = requestMapTransition;
        this._requestAdvance = requestAdvance;
        this._rewards = new HuntParcoursRewards();
        this._records = new HuntParcoursRecords();
        this.reset();
    }

    reset(variantId = 'nemesis') {
        this.variant = resolveHuntParcoursVariant(variantId);
        if (!['nemesis', 'thunderflight'].includes(this.variant?.id)) throw new Error('Hunt-Parcours variant is not implemented');
        this.thunderflight = this.variant.id === 'thunderflight' ? new ThunderflightRunOps(this) : null;
        this.entityManager = null;
        this.phase = 'idle';
        this.mapIndex = 0;
        this.mapResults = [];
        this.humanKills = 0;
        this.rocketKills = 0;
        this.rivalKills = 0;
        this.ringClaims = 0;
        this.hitsTaken = 0;
        this.runHitsTaken = 0;
        this.rivalState = null;
        this.rivalPlayerIndex = -1;
        this._recordStore = null;
        this._rivalRecordWritable = false;
        this._medalRecordWritable = false;
        this._rivalRecord = null;
        this._medalRecord = null;
        this._saveFailures = [];
        this._settled = false;
        this._finalSummary = null;
        this.humanMapWins = 0;
        this.rivalMapWins = 0;
        this._finishEvent = null;
        this._transitionRequested = false;
        this._roundOutcome = null;
        this.rewardBinding = null;
        this._rewardTotals = { xpEarned: 0, vehicleXpEarned: 0, summary: null };
        this.elapsedMs = 0;
    }

    start(entityManager = null, { variantId = 'nemesis', vehicleId = 'ship1', recordStore = null, seed = 0 } = {}) {
        if (this.phase === 'idle' || this.phase === 'finished') {
            this.reset(variantId);
            this._recordStore = recordStore || this._getRecordStore() || null;
            this.rewardBinding = bindArcadeVehicleRewards({ runType: 'hunt_parcours', vehicleId });
            this._loadPersistentRecords(seed);
            this.phase = 'hunting';
        } else if (this.phase === 'transition') {
            this.phase = 'hunting';
            this.humanKills = 0;
            this.rivalKills = 0;
            this.ringClaims = 0;
            this._finishEvent = null;
            this._roundOutcome = null;
            this._transitionRequested = false;
            this.elapsedMs = 0;
        }
        this.entityManager = entityManager || null;
        this.thunderflight?.start();
        this._applyNemesisRival();
        return this.getHudState();
    }

    handleXpEvent(eventType, playerIndex = 0) {
        const index = Number(playerIndex);
        const partner = index === 0 ? null : this._getPlayerRewardTarget?.(index);
        if (this.phase !== 'hunting' && this.phase !== 'transition') return null;
        if (!this.rewardBinding || !Number.isInteger(index) || (index !== 0 && !partner)) return null;
        const amount = {
            checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
            finish: XP_REWARD_TABLE.parcoursFinish,
            new_best_time: XP_REWARD_TABLE.parcoursNewBestTime,
        }[String(eventType)] || 0;
        return this._rewards.award(
            partner ? partner.store : (this._recordStore || this._getRecordStore()),
            partner ? { ...this.rewardBinding, vehicleId: partner.vehicleId } : this.rewardBinding,
            amount,
            this._rewardTotals, !partner,
        );
    }

    get xpEarned() { return this._rewardTotals.xpEarned; }
    get vehicleXpEarned() { return this._rewardTotals.vehicleXpEarned; }
    hasPendingSettlement() { return this._rewards.pending.length > 0 || this._records.pending.length > 0; }
    maintainPendingSettlements(nowMs) {
        const rewards = this._rewards.maintain(nowMs);
        return this._records.maintain(nowMs) || rewards;
    }

    _readRecord(key) {
        return this._records.read(this._recordStore, key);
    }

    _loadPersistentRecords(seed) {
        const rivalSeed = Math.max(0, Math.floor(Number(seed) || this.variant.seed || 0));
        if (this.variant.id === 'nemesis') {
            const read = this._readRecord(HUNT_PARCOURS_RIVAL_STORAGE_KEY);
            const raw = read?.status === 'found' ? read.value : null;
            this._rivalRecordWritable = read?.status === 'missing'
                || (read?.status === 'found' && isWritableHuntParcoursRivalState(raw));
            this._rivalRecord = this._rivalRecordWritable
                ? normalizeHuntParcoursRivalState(raw, rivalSeed)
                : createHuntParcoursRivalState(rivalSeed);
            this.rivalState = this._rivalRecord;
        }
        const medalRead = this._readRecord(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY);
        const medalRaw = medalRead?.status === 'found' ? medalRead.value : null;
        this._medalRecordWritable = medalRead?.status === 'missing'
            || (medalRead?.status === 'found' && isWritableHuntParcoursMedalRecord(medalRaw));
        this._medalRecord = this._medalRecordWritable ? normalizeHuntParcoursMedalRecord(medalRaw) : null;
    }

    _applyNemesisRival() {
        if (this.variant.id !== 'nemesis' || !this.rivalState) return;
        const rival = this.entityManager?.players?.find((player) => player?.isBot === true) || null;
        if (!rival) return;
        this.rivalPlayerIndex = Number.isInteger(rival.index) ? rival.index : -1;
        const rivalKey = `${this.rivalState.version}:${this.rivalState.seed}:${this.rivalState.rivalIndex}:${this.rivalState.stage}:${this.rivalState.traits.join(',')}`;
        if (rival._huntParcoursRivalKey === rivalKey) return;
        const modifiers = resolveHuntParcoursRivalModifiers(this.rivalState);
        rival.botDisplayName = this.rivalState.name;
        rival.huntParcoursRival = true;
        rival.huntParcoursRaceWeight = this.variant.raceWeight;
        rival.huntParcoursRivalKey = rivalKey;
        rival._huntParcoursRivalKey = rivalKey;
        rival.huntParcoursRivalModifiers = modifiers;
        applyHuntParcoursRivalSpawnBonuses(rival);
    }

    handleGameplayEvent(event) {
        if (this.phase !== 'hunting' || this._finishEvent) return null;
        if (this.thunderflight && event?.type !== 'damage') return null;
        if (event?.type === 'ring_crossed') {
            const human = this.entityManager?.humanPlayers?.find((player) => Number(player?.index) === Number(event.playerIndex));
            if (!human) return null;
            this.ringClaims += 1;
            return this.getHudState();
        }
        if (event?.type === 'bot_kill') {
            const bot = this.entityManager?.players?.find((player) => Number(player?.index) === Number(event.playerIndex));
            const victim = this.entityManager?.humanPlayers?.find(player => player?.index === event.victimIndex);
            if (!bot?.isBot || !victim || Number(bot.index) !== this.rivalPlayerIndex) return null;
            this.rivalKills += safeCount(event.count);
            if (this.rivalKills >= 3) this._finishEvent = { reason: 'kills', winnerSide: 'rival', totalTimeMs: this.elapsedMs };
            return this.getHudState();
        }
        if (event?.type === 'damage') {
            const human = this.entityManager?.humanPlayers?.find((player) => Number(player?.index) === Number(event.playerIndex));
            if (human) {
                this.hitsTaken += 1;
                this.runHitsTaken += 1;
                trackArcadeColorEvent(this._colorProgress, event);
            }
            return human ? this.getHudState() : null;
        }
        if (event?.type !== 'kill') return null;
        const playerIndex = Number(event.playerIndex);
        const human = this.entityManager?.humanPlayers?.find((player) => Number(player?.index) === playerIndex);
        if (!human || event.companion === true || event.victimIndex !== this.rivalPlayerIndex) return null;
        const count = safeCount(event.count);
        this.humanKills += count;
        if (isRocketTierType(event.projectileType)) this.rocketKills += count;
        trackArcadeColorEvent(this._colorProgress, event);
        if (!this._finishEvent && this.variant.id === 'nemesis' && this.humanKills >= 3) {
            this._finishEvent = { reason: 'kills', winnerSide: 'human', totalTimeMs: this.elapsedMs };
        }
        return this.getHudState();
    }

    handleParcoursEvent(event) {
        if (this.thunderflight) return this.phase === 'hunting' ? this.thunderflight.handleParcoursEvent(event) : null;
        if (this.phase !== 'hunting' || event?.type !== 'finish') return null;
        if (this._finishEvent) return this.getHudState();
        const playerIndex = Number(event?.playerIndex);
        const humanFinished = (this.entityManager?.humanPlayers || []).some(
            (player) => Number(player?.index) === playerIndex
        );
        const rivalFinished = this.variant.id === 'nemesis'
            && playerIndex === this.rivalPlayerIndex
            && (this.entityManager?.players || []).some((player) => player?.isBot === true && Number(player.index) === playerIndex);
        if (!humanFinished && !rivalFinished) return null;
        this._finishEvent = {
            reason: 'finish',
            winnerSide: humanFinished ? 'human' : 'rival',
            totalTimeMs: Math.max(0, Math.round(Number(event.totalTimeMs) || 0)),
        };
        return this.getHudState();
    }

    _completeStage({ reason, winnerSide, totalTimeMs = 0 }) {
        if (this.phase !== 'hunting') return null;
        this.mapResults[this.mapIndex] = {
            ...this.thunderflight?.mapResult(),
            mapKey: this.variant.mapKeys[this.mapIndex],
            won: winnerSide === 'human',
            winnerSide,
            reason,
            kills: this.humanKills,
            ringClaims: this.ringClaims,
            rivalStage: this.rivalState?.stage ?? 0,
            totalTimeMs: Math.max(0, Math.round(Number(totalTimeMs) || 0)),
        };
        if (winnerSide === 'human') this.humanMapWins += 1;
        else if (winnerSide === 'rival') this.rivalMapWins += 1;
        const bestOfThreeDecided = this.variant.id === 'nemesis'
            && (this.humanMapWins >= 2 || this.rivalMapWins >= 2);
        if (bestOfThreeDecided || this.mapIndex >= this.variant.mapKeys.length - 1) {
            this.phase = 'finished';
            this._settleRun(this.thunderflight?.winnerSide() || winnerSide);
            return this.getHudState();
        }
        this.mapIndex += 1;
        this.humanKills = 0;
        this.rivalKills = 0;
        this.ringClaims = 0;
        this.hitsTaken = 0;
        this._finishEvent = null;
        this._roundOutcome = null;
        this.phase = 'transition';
        if (!this._transitionRequested) {
            this._transitionRequested = true;
            this._requestMapTransition({
                mapKey: this.variant.mapKeys[this.mapIndex],
                botCount: this.variant.botCount,
                combatProfile: 'hunt',
                huntParcours: true,
                parcoursRacer: true,
            });
            // The ordinary round-end countdown consumes the queued map transition. Starting
            // a rebuild here would race the outcome still returning through this tick.
        }
        return this.getHudState();
    }

    _scoreRun() {
        if (this.thunderflight) return this.thunderflight.totalPoints.get(this.entityManager?.humanPlayers?.[0]?.index) || 0;
        if (this.variant.id === 'nemesis') {
            return this.mapResults.reduce((score, result) => score + (result
                ? scoreHuntParcoursNemesisMap({
                    won: result.won,
                    stage: result.rivalStage,
                    elapsedMs: result.totalTimeMs,
                    kills: result.kills,
                })
                : 0), 0);
        }
        return this.mapResults.reduce((score, result) => score + (result
            ? (result.won ? 1000 : 0) + (safeCount(result.kills) * 250) + (safeCount(result.ringClaims) * 100)
            : 0), 0);
    }

    _saveRecord(key, value) {
        this._records.queue(this._recordStore, key, value, this._saveFailures);
    }

    _settleRun(winnerSide) {
        if (this._settled) return;
        this._settled = true;
        const score = this._scoreRun();
        const medal = resolveHuntParcoursMedal(this.variant.id, score);
        const facedRival = this.rivalState ? {
            name: this.rivalState.name,
            stage: this.rivalState.stage,
            rivalWins: this.rivalState.rivalWins,
        } : null;
        if (this._medalRecordWritable && this._recordStore && this._medalRecord) {
            const next = recordHuntParcoursResult(this._medalRecord, { variantId: this.variant.id, score });
            this._saveRecord(HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY, next);
            this._medalRecord = next;
        }
        if (this.variant.id === 'nemesis' && this._rivalRecordWritable && this._recordStore && this._rivalRecord) {
            const nextRival = winnerSide === 'human'
                ? applyHuntParcoursRivalDefeat(this._rivalRecord, {
                    mapsWonByFinish: this.mapResults.filter((result) => result?.won && result.reason === 'finish').length,
                    mapsWonByKills: this.mapResults.filter((result) => result?.won && result.reason === 'kills').length,
                    totalKills: this.mapResults.reduce((total, result) => total + safeCount(result?.kills), 0),
                    rocketKills: this.rocketKills,
                    hitsTaken: this.runHitsTaken,
                })
                : applyHuntParcoursRivalVictory(this._rivalRecord);
            this._saveRecord(HUNT_PARCOURS_RIVAL_STORAGE_KEY, nextRival);
            this._rivalRecord = nextRival;
            this.rivalState = nextRival;
        }
        this.ranking = settleArcadeRunRanking(this, {
            succeeded: winnerSide === 'human',
            score,
            completedSectors: this.mapResults.length,
            completedMaps: this.mapResults.length,
            aborted: false,
        });
        trackArcadeColorEvent(this._colorProgress, { type: 'run_complete', succeeded: winnerSide === 'human' });
        this._finalSummary = {
            ...this.thunderflight?.hud(),
            variantId: this.variant.id,
            score,
            medal,
            maps: this.mapResults.map((result) => result ? { ...result } : null),
            rival: facedRival,
            ranking: this.ranking,
            xpEarned: this.xpEarned,
            vehicleXpEarned: this.vehicleXpEarned,
            colorsUnlocked: Object.values(this._colorProgress?.players || {}).flatMap((player) => player.newly || []),
            saveFailures: this._saveFailures,
            pendingRewardCount: this._rewards.pending.filter(reward => reward.owner === this._rewardTotals).length,
        };
        this._rewardTotals.summary = this._finalSummary;
    }

    getRoundOutcome() {
        if (this.thunderflight) return this.thunderflight.getRoundOutcome();
        if (this._roundOutcome) return this._roundOutcome;
        if (this.phase !== 'hunting') return null;
        const result = resolveHuntParcoursStageResult({
            variantId: this.variant.id,
            finished: Boolean(this._finishEvent),
            completionReason: this._finishEvent?.reason,
            finishWinnerSide: this._finishEvent?.winnerSide,
            humanKills: this.humanKills,
            rivalKills: this.rivalKills,
        });
        if (!result.complete) return null;
        const winner = result.winnerSide === 'rival'
            ? this.entityManager?.players?.find((player) => player?.isBot === true
                && Number(player.index) === this.rivalPlayerIndex && player?.alive !== false) || null
            : this.entityManager?.humanPlayers?.find((player) => player?.alive !== false) || null;
        if (!winner) return null;
        const completedMapIndex = this.mapIndex;
        this._completeStage({ reason: result.reason, winnerSide: result.winnerSide, totalTimeMs: this._finishEvent?.totalTimeMs || 0 });
        this._roundOutcome = {
            shouldEnd: true,
            winner,
            reason: result.winnerSide === 'human' ? 'HUNT_PARCOURS_STAGE_COMPLETE' : 'HUNT_PARCOURS_RIVAL_STAGE_WIN',
            parcours: { variantId: this.variant.id, mapIndex: completedMapIndex, result: result.reason, winnerSide: result.winnerSide },
        };
        return this._roundOutcome;
    }

    update(dt) {
        if (this.phase === 'hunting') {
            this.elapsedMs += Math.max(0, Number(dt) || 0) * 1000;
            this.thunderflight?.update();
        }
    }

    // The stage index already advanced when its outcome was consumed; the session rebuild starts it.
    beginNextSector() { return this.getHudState(); }

    isEnabled() { return true; }
    getPhase() { return this.phase; }

    deriveRoundEndPlan({ players, inputs, baseController }) {
        const plan = baseController.deriveOnRoundEndPlan(players, { ...inputs, winsNeeded: this.thunderflight ? this.variant.mapKeys.length + 1 : 2 });
        if (this.phase !== 'finished') return plan;
        const outcome = { ...plan.outcome, state: GAME_STATE_IDS.MATCH_END, matchWinner: inputs.winner,
            messageText: this.thunderflight ? this.thunderflight.resultTitle()
                : this.humanMapWins >= 2 ? 'Nemesis besiegt' : 'Nemesis gewinnt', messageSub: '' };
        if (this.thunderflight) {
            const leaders = this.thunderflight.leaders();
            outcome.matchWinner = leaders.length === 1 ? players.find(player => player.index === leaders[0]) || null : null;
        }
        return { outcome, transition: baseController.deriveRoundEndTransition(outcome) };
    }

    dispose() {
        this.reset();
        this.rankContext = null;
        this._rankingStore = null;
        this._colorProgress = null;
    }

    getHudState() {
        return {
            ...this.thunderflight?.hud(),
            runType: 'hunt_parcours',
            variantId: this.variant.id,
            label: this.variant.label,
            phase: this.phase,
            mapIndex: this.mapIndex,
            mapCount: this.variant.mapKeys.length,
            currentMapKey: this.variant.mapKeys[Math.min(this.mapIndex, this.variant.mapKeys.length - 1)],
            humanKills: this.humanKills,
            rivalKills: this.rivalKills,
            ringClaims: this.ringClaims,
            rival: this.rivalState ? {
                name: this.rivalState.name,
                stage: this.rivalState.stage,
                traits: [...this.rivalState.traits],
                rivalWins: this.rivalState.rivalWins,
            } : null,
            mapWins: { human: this.humanMapWins, rival: this.rivalMapWins },
            killTarget: this.variant.id === 'nemesis' ? 3 : 0,
            mapResults: this.mapResults.map((result) => result ? { ...result } : null),
            postRunSummary: this.phase === 'finished' ? this._finalSummary || { maps: this.mapResults.map((result) => ({ ...result })) } : null,
        };
    }
}
