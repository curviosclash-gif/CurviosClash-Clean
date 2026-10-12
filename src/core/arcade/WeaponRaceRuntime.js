import {
    WEAPON_RACE_CHECKPOINT_ORDER,
    WEAPON_RACE_NEW_BEST_XP,
    WEAPON_RACE_RUN_TYPE,
    resolveWeaponRaceStage,
} from '../../shared/contracts/WeaponRaceContract.js';
import {
    createWeaponRaceState,
    finishWeaponRaceRacer,
    rankWeaponRaceRacers,
    recordWeaponRaceCheckpoint,
    shiftWeaponRaceClock,
    updateWeaponRaceProgress,
} from '../../state/arcade/WeaponRaceState.js';
import { XP_REWARD_TABLE } from '../../state/arcade/ArcadeVehicleProfile.js';
import {
    awardBoundArcadeVehicleXpInStore,
    bindArcadeVehicleRewards,
} from '../../state/arcade/ArcadeVehicleRewardBinding.js';
import { applyWeaponRaceStage, clearWeaponRaceLoadout } from '../../entities/arcade/WeaponRaceLoadoutOps.js';
import { WeaponRacePickupPresentation } from '../../entities/arcade/WeaponRacePickupPresentation.js';

function playerId(player) { return String(player?.index ?? ''); }
function monotonicNowMs() {
    return Number(globalThis.performance?.now?.()) || Date.now();
}

export class WeaponRaceRuntime {
    constructor({ now = () => Date.now(), retryNow = monotonicNowMs, getRecordStore = () => null } = {}) {
        this._now = now;
        this._retryNow = retryNow;
        this._getRecordStore = getRecordStore;
        this._nextRewardRetryAtMs = 0;
        this.reset();
    }

    reset() {
        this.entityManager = null;
        this.state = createWeaponRaceState();
        this.phase = 'idle';
        this.rewardBinding = null;
        this.xpEarned = 0;
        this.bestXpAwarded = false;
        this.bestXpPending = false;
        this.pendingCheckpointRewards = [];
        this.pendingGameplayRewards = [];
        this.settlementWaitAttempts = 0;
        this.totalVictoryXpAwarded = 0;
        this.pendingSettlementBatches ||= [];
        this.roundOutcome = null;
        this.presentation = null;
        this.route = null;
        this._clockOwner = null;
        this._lastRaceNowMs = null;
    }

    start({ entityManager = null, vehicleId = 'ship1' } = {}) {
        this._archivePendingRewards();
        this.entityManager = entityManager;
        const players = Array.isArray(entityManager?.players) ? entityManager.players.filter(Boolean) : [];
        const human = (Array.isArray(entityManager?.humanPlayers) ? entityManager.humanPlayers : []).find(Boolean)
            || players.find((entry) => entry?.isBot !== true) || null;
        this.state = createWeaponRaceState({
            startedAtMs: this._raceNow(entityManager),
            humanPlayerId: playerId(human),
            racerIds: players.map(playerId),
        });
        this.phase = 'racing';
        this._clockOwner = entityManager;
        this._lastRaceNowMs = this.state.startedAtMs;
        this.rewardBinding = bindArcadeVehicleRewards({ runType: WEAPON_RACE_RUN_TYPE, vehicleId });
        this.xpEarned = 0;
        this.bestXpAwarded = false;
        this.bestXpPending = false;
        this.pendingCheckpointRewards = [];
        this.pendingGameplayRewards = [];
        this.settlementWaitAttempts = 0;
        this.totalVictoryXpAwarded = 0;
        this.roundOutcome = null;
        for (const player of players) clearWeaponRaceLoadout(player, { projectileSystem: entityManager?._projectileSystem });
        this.route = entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
        this.presentation?.dispose?.();
        this.presentation = new WeaponRacePickupPresentation(entityManager?.renderer || null);
        this.presentation.start(this.route);
        return this.getHudState();
    }

    rebind({ entityManager = null, vehicleId = 'ship1' } = {}) {
        if (this.phase === 'idle' || this.phase === 'finished') return this.start({ entityManager, vehicleId });
        this.rewardBinding = bindArcadeVehicleRewards({ runType: WEAPON_RACE_RUN_TYPE, vehicleId });
        if (this.entityManager === entityManager) return this.getHudState();

        this.presentation?.dispose?.();
        for (const player of this.entityManager?.players || []) {
            clearWeaponRaceLoadout(player, { projectileSystem: this.entityManager?._projectileSystem });
        }
        this._followRaceClock(); // last reading of the old clock, so the switch below is exact
        this.entityManager = entityManager;
        this._followRaceClock();
        const players = Array.isArray(entityManager?.players) ? entityManager.players.filter(Boolean) : [];
        for (const player of players) {
            clearWeaponRaceLoadout(player, { projectileSystem: entityManager?._projectileSystem });
            const racer = this.state?.racers?.[playerId(player)];
            const stage = resolveWeaponRaceStage(racer?.weaponCheckpointId);
            if (stage) applyWeaponRaceStage(player, stage, { projectileSystem: entityManager?._projectileSystem });
        }
        this.route = entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
        this.presentation = new WeaponRacePickupPresentation(entityManager?.renderer || null);
        this.presentation.start(this.route);
        return this.getHudState();
    }

    dispose() {
        this._archivePendingRewards();
        this.presentation?.dispose?.();
        for (const player of this.entityManager?.players || []) {
            clearWeaponRaceLoadout(player, { projectileSystem: this.entityManager?._projectileSystem });
        }
        this.reset();
    }

    _player(playerIndex) {
        return (this.entityManager?.players || []).find((entry) => Number(entry?.index) === Number(playerIndex)) || null;
    }

    _raceNow(entityManager = this.entityManager) {
        const simulationNow = Number(entityManager?._simulationClockMs);
        return Number.isFinite(simulationNow) && simulationNow >= 0 ? simulationNow : this._now();
    }

    // The run is armed before spawnAll restarts the round clock, and a sector rebuild hands the race
    // a new entity manager with its own clock (rebind). Shift the race stamps by the jump so played
    // time carries over instead of every finish being clamped to the start.
    _followRaceClock() {
        if (this.phase !== 'racing' && this.phase !== 'grace') return;
        const nowMs = this._raceNow();
        const switched = this._clockOwner !== this.entityManager || nowMs < this._lastRaceNowMs;
        if (switched && Number.isFinite(this._lastRaceNowMs)) shiftWeaponRaceClock(this.state, nowMs - this._lastRaceNowMs);
        this._clockOwner = this.entityManager;
        this._lastRaceNowMs = nowMs;
    }

    _archivePendingRewards() {
        const items = [
            ...this.pendingCheckpointRewards.map((reward) => ({ ...reward, kind: 'checkpoint' })),
            ...this.pendingGameplayRewards.map((reward) => ({ ...reward, kind: 'gameplay' })),
        ];
        const winner = this.roundOutcome?.winner || null;
        const winnerRacer = winner ? this.state?.racers?.[String(winner.index)] : null;
        if (winnerRacer?.isHuman === true && winnerRacer.finishXp > 0 && winnerRacer.finishXpAwarded !== true) {
            items.push({ kind: 'finish', amount: winnerRacer.finishXp, playerIndex: winner.index, racer: winnerRacer });
        }
        if (winnerRacer?.isHuman === true && this.bestXpPending && !this.bestXpAwarded) {
            items.push({ kind: 'best', amount: WEAPON_RACE_NEW_BEST_XP, playerIndex: winner.index, racer: winnerRacer });
        }
        if (items.length === 0) return false;
        const store = this._getRecordStore();
        const binding = this.rewardBinding;
        // Gameplay events are unbounded during a run; fold them into one durable
        // receipt per store/vehicle/player. That leaves at most 12 receipts per
        // run (9 checkpoints, gameplay total, finish, best). A permanent store
        // outage can still retain one run's receipts/outcome per failed run; a
        // hard cap would discard earned XP or prevent per-outcome acknowledgments.
        // Checkpoints and victory awards stay separate for racer/outcome markers.
        const compactItems = [];
        for (const item of items) {
            const itemStore = item.store || store;
            const itemBinding = item.binding || binding;
            const sameBinding = (candidate) => candidate.kind === 'gameplay'
                && candidate.playerIndex === item.playerIndex
                && (candidate.store || store) === itemStore
                && (candidate.binding || binding)?.runType === itemBinding?.runType
                && (candidate.binding || binding)?.vehicleId === itemBinding?.vehicleId;
            const existingGameplay = item.kind === 'gameplay' ? compactItems.find(sameBinding) : null;
            if (existingGameplay) existingGameplay.amount += item.amount;
            else compactItems.push({ ...item });
        }
        for (const item of compactItems) {
            const itemStore = item.store || store;
            const itemBinding = item.binding || binding;
            let batch = this.pendingSettlementBatches.find((entry) => (
                entry.store === itemStore
                && entry.binding?.runType === itemBinding?.runType
                && entry.binding?.vehicleId === itemBinding?.vehicleId
            ));
            if (!batch) {
                batch = { store: itemStore, binding: itemBinding, items: [] };
                this.pendingSettlementBatches.push(batch);
            }
            batch.items.push({
                ...item,
                racer: item.racer || this.state?.racers?.[String(item.playerIndex)] || null,
                store: itemStore,
                binding: itemBinding,
                outcome: this.roundOutcome,
            });
        }
        this.pendingCheckpointRewards = [];
        this.pendingGameplayRewards = [];
        return true;
    }

    _beginRewardRetryWindow() {
        if (!this.hasPendingSettlement()) return false;
        const retryNow = Number(this._retryNow());
        if (retryNow < this._nextRewardRetryAtMs) return false;
        this._nextRewardRetryAtMs = retryNow + 250;
        return true;
    }

    _settleArchivedRewards(retryAllowed = false) {
        if (!retryAllowed || !this.pendingSettlementBatches.some((batch) => batch.items.length > 0)) return false;
        const outcomes = new Set(this.pendingSettlementBatches.flatMap((batch) => (
            batch.items.map((item) => item.outcome).filter(Boolean)
        )));
        for (const batch of this.pendingSettlementBatches) {
            const reward = batch.items[0];
            if (!reward) continue;
            const result = awardBoundArcadeVehicleXpInStore(
                reward.store, reward.binding, reward.amount, this._now()
            );
            if (result?.persisted !== true) {
                const index = this.pendingSettlementBatches.indexOf(batch);
                if (index >= 0 && index < this.pendingSettlementBatches.length - 1) {
                    this.pendingSettlementBatches.push(this.pendingSettlementBatches.splice(index, 1)[0]);
                }
                break;
            }
            if (reward.kind === 'checkpoint' && reward.racer) {
                if (!reward.racer.awardedCheckpointIds.includes(reward.checkpointId)) {
                    reward.racer.awardedCheckpointIds.push(reward.checkpointId);
                    reward.racer.checkpointXp += reward.amount;
                }
            } else if (reward.kind === 'finish' && reward.racer) {
                reward.racer.finishXpAwarded = true;
                if (reward.outcome) reward.outcome.awardedXp = (reward.outcome.awardedXp || 0) + result.earned;
            } else if (reward.kind === 'best') {
                if (reward.outcome) reward.outcome.awardedXp = (reward.outcome.awardedXp || 0) + result.earned;
            }
            batch.items.shift();
            break;
        }
        for (const outcome of outcomes) {
            const pendingRewardCount = this.pendingSettlementBatches.reduce((count, batch) => (
                count + batch.items.filter((item) => item.outcome === outcome).length
            ), 0);
            outcome.pendingRewardCount = pendingRewardCount;
            outcome.rewardsPersisted = pendingRewardCount === 0;
        }
        this.pendingSettlementBatches = this.pendingSettlementBatches.filter((batch) => batch.items.length > 0);
        return true;
    }

    hasPendingSettlement() {
        if (this.pendingSettlementBatches.some((batch) => batch.items.length > 0)
            || this.pendingCheckpointRewards.length > 0
            || this.pendingGameplayRewards.length > 0) return true;
        const winner = this.roundOutcome?.winner;
        const winnerRacer = winner ? this.state?.racers?.[String(winner.index)] : null;
        return winnerRacer?.isHuman === true
            && ((winnerRacer.finishXp > 0 && winnerRacer.finishXpAwarded !== true)
                || (this.bestXpPending && !this.bestXpAwarded));
    }

    maintainPendingSettlements() {
        if (!this.hasPendingSettlement()) return false;
        this.update(this._now());
        return true;
    }

    _award(amount, playerIndex, store = this._getRecordStore(), binding = this.rewardBinding) {
        if (String(playerIndex) !== this.state.humanPlayerId || !(amount > 0)) return null;
        const result = awardBoundArcadeVehicleXpInStore(store, binding, amount, this._now());
        if (result?.persisted === true) this.xpEarned += result.earned;
        else return null;
        return result;
    }

    handleCheckpoint({ playerIndex, checkpointId } = {}) {
        if (this.phase !== 'racing' && this.phase !== 'grace') return { accepted: false, awardedXp: 0, stage: null };
        const result = recordWeaponRaceCheckpoint(this.state, playerIndex, checkpointId);
        const player = this._player(playerIndex);
        if (result.stage && player) {
            applyWeaponRaceStage(player, result.stage, { projectileSystem: this.entityManager?._projectileSystem });
        }
        const normalizedCheckpointId = String(checkpointId || '').trim().toUpperCase();
        const pendingReward = this.pendingCheckpointRewards.find((entry) => (
            entry.playerIndex === Number(playerIndex) && entry.checkpointId === normalizedCheckpointId
        ));
        if (pendingReward) {
            const racer = this.state?.racers?.[String(playerIndex)];
            if (racer) {
                racer.awardedCheckpointIds = racer.awardedCheckpointIds.filter((id) => id !== normalizedCheckpointId);
                racer.checkpointXp = Math.max(0, racer.checkpointXp - result.awardedXp);
            }
            return { ...result, awardedXp: 0, rewardPending: true };
        }
        if (result.awardedXp > 0 && !this._award(result.awardedXp, playerIndex)) {
            const racer = this.state?.racers?.[String(playerIndex)];
            if (racer) {
                racer.awardedCheckpointIds = racer.awardedCheckpointIds.filter((id) => id !== normalizedCheckpointId);
                racer.checkpointXp = Math.max(0, racer.checkpointXp - result.awardedXp);
            }
            this.pendingCheckpointRewards.push({
                playerIndex: Number(playerIndex),
                checkpointId: normalizedCheckpointId,
                amount: result.awardedXp,
                racer,
                store: this._getRecordStore(),
                binding: this.rewardBinding,
            });
            return { ...result, awardedXp: 0, rewardPending: true };
        }
        return result;
    }

    _settlePendingCheckpointReward() {
        const pending = this.pendingCheckpointRewards[0];
        if (!pending) return true;
        if (!this._award(pending.amount, pending.playerIndex, pending.store, pending.binding)) return false;
        const racer = pending.racer || this.state?.racers?.[String(pending.playerIndex)];
        if (racer && !racer.awardedCheckpointIds.includes(pending.checkpointId)) {
            racer.awardedCheckpointIds.push(pending.checkpointId);
            racer.checkpointXp += pending.amount;
        }
        this.pendingCheckpointRewards.shift();
        return true;
    }

    handleDeath({ playerIndex } = {}) {
        const player = this._player(playerIndex);
        if (!player) return null;
        const racer = this.state?.racers?.[String(playerIndex)];
        clearWeaponRaceLoadout(player, { projectileSystem: this.entityManager?._projectileSystem });
        const stage = resolveWeaponRaceStage(racer?.weaponCheckpointId);
        if (stage) applyWeaponRaceStage(player, stage, { projectileSystem: this.entityManager?._projectileSystem });
        return { checkpointId: racer?.checkpointId || WEAPON_RACE_CHECKPOINT_ORDER[0], weaponId: stage?.weaponId || '' };
    }

    handleFinish({ playerIndex, finishedAtMs = this._raceNow() } = {}) {
        this._followRaceClock(); // a finish can arrive in the simulation tick before update()
        const result = finishWeaponRaceRacer(this.state, playerIndex, finishedAtMs);
        if (result.accepted) {
            this.phase = 'grace';
            return { ...result, awardedXp: 0, pendingXp: result.awardedXp };
        }
        return result;
    }

    handleNewBest(playerIndex) {
        if (this.bestXpAwarded || this.phase === 'finished' || String(playerIndex) !== this.state.humanPlayerId) {
            return { awardedXp: 0, pendingXp: this.bestXpPending ? WEAPON_RACE_NEW_BEST_XP : 0 };
        }
        this.bestXpPending = true;
        return { awardedXp: 0, pendingXp: WEAPON_RACE_NEW_BEST_XP };
    }

    updateProgress(playerIndex, distanceToNext) {
        return updateWeaponRaceProgress(this.state, playerIndex, distanceToNext);
    }

    update(now = this._now()) {
        this._followRaceClock();
        const canRetryRewards = this._beginRewardRetryWindow();
        if (canRetryRewards) {
            this._settleArchivedRewards(true);
            this._settlePendingCheckpointReward();
            this._settlePendingGameplayReward();
        }
        if (this.roundOutcome?.winner?.isBot !== true) {
            const racer = this.state?.racers?.[String(this.roundOutcome?.winner?.index)];
            if (racer?.isHuman === true) {
                if (canRetryRewards) this._settleWinnerRewards(this.roundOutcome.winner, racer);
                this.roundOutcome.awardedXp = this.totalVictoryXpAwarded;
                this._refreshOutcomeRewardStatus(racer);
            }
        } else if (this.roundOutcome) {
            this._refreshOutcomeRewardStatus(this.state?.racers?.[String(this.roundOutcome.winner?.index)]);
        }
        if (!this.route) {
            this.route = this.entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
            if (this.route) this.presentation?.start?.(this.route);
        }
        this.presentation?.update?.(now);
        return this.getHudState();
    }

    handleGameplayEvent(event = null) {
        if (!event || String(event.playerIndex) !== this.state.humanPlayerId) return null;
        const amount = {
            kill: XP_REWARD_TABLE.killBase,
            intercept: XP_REWARD_TABLE.interceptBase,
            unit_destroyed: XP_REWARD_TABLE.unitDestroyedBase,
        }[String(event.type || '')] || 0;
        if (!(amount > 0)) return null;
        const store = this._getRecordStore();
        const binding = this.rewardBinding;
        const pending = this.pendingGameplayRewards.find((entry) => (
            entry.playerIndex === Number(event.playerIndex)
            && entry.store === store
            && entry.binding?.runType === binding?.runType
            && entry.binding?.vehicleId === binding?.vehicleId
        ));
        if (pending) {
            pending.amount += amount;
            return { earned: 0, persisted: false, rewardPending: true };
        }
        const reward = this._award(amount, event.playerIndex, store, binding);
        if (reward) return reward;
        this.pendingGameplayRewards.push({ playerIndex: Number(event.playerIndex), amount, store, binding });
        return { earned: 0, persisted: false, rewardPending: true };
    }

    _settlePendingGameplayReward() {
        const pending = this.pendingGameplayRewards[0];
        if (!pending) return true;
        if (!this._award(pending.amount, pending.playerIndex, pending.store, pending.binding)) return false;
        this.pendingGameplayRewards.shift();
        return true;
    }

    _settleWinnerRewards(winner, winnerRacer) {
        let awardedXp = 0;
        let rewardsPending = false;
        if (winnerRacer?.finishXpAwarded !== true && winnerRacer?.finishXp > 0) {
            const reward = this._award(winnerRacer.finishXp, winner.index);
            if (reward) {
                winnerRacer.finishXpAwarded = true;
                awardedXp += reward.earned;
            } else rewardsPending = true;
        }
        if (!rewardsPending && this.bestXpPending && !this.bestXpAwarded) {
            const reward = this._award(WEAPON_RACE_NEW_BEST_XP, winner.index);
            if (reward) {
                this.bestXpAwarded = true;
                this.bestXpPending = false;
                awardedXp += reward.earned;
            } else rewardsPending = true;
        }
        this.totalVictoryXpAwarded += awardedXp;
        return { awardedXp, rewardsPending };
    }

    _refreshOutcomeRewardStatus(winnerRacer) {
        if (!this.roundOutcome) return;
        const pendingRewardCount = this.pendingCheckpointRewards.length + this.pendingGameplayRewards.length
            + (winnerRacer?.finishXpAwarded !== true && winnerRacer?.finishXp > 0 ? 1 : 0)
            + (this.bestXpPending && !this.bestXpAwarded ? 1 : 0);
        this.roundOutcome.pendingRewardCount = pendingRewardCount;
        this.roundOutcome.rewardsPersisted = pendingRewardCount === 0;
    }

    _syncDistances() {
        for (const racer of Object.values(this.state?.racers || {})) {
            if (racer.finishedAtMs !== null) continue;
            const nextId = WEAPON_RACE_CHECKPOINT_ORDER[racer.checkpointIndex + 1];
            const entry = nextId
                ? this.route?.checkpoints?.find((checkpoint) => checkpoint?.id === nextId)
                : this.route?.finish;
            const player = this._player(Number(racer.playerId));
            if (!entry?.pos || !player?.position) continue;
            const dx = (Number(player.position.x) || 0) - entry.pos[0];
            const dy = (Number(player.position.y) || 0) - entry.pos[1];
            const dz = (Number(player.position.z) || 0) - entry.pos[2];
            updateWeaponRaceProgress(this.state, racer.playerId, Math.hypot(dx, dy, dz));
        }
    }

    getRoundOutcome(now = this._raceNow()) {
        this._followRaceClock();
        if (this.roundOutcome) return this.roundOutcome;
        if (this.state.firstFinishAtMs === null || Number(now) < this.state.graceEndsAtMs) return null;
        let rewardsPending = false;
        if (!this._settlePendingCheckpointReward() || this.pendingCheckpointRewards.length > 0) rewardsPending = true;
        if (!this._settlePendingGameplayReward() || this.pendingGameplayRewards.length > 0) rewardsPending = true;
        this._syncDistances();
        const standings = rankWeaponRaceRacers(this.state);
        const winner = this._player(Number(standings[0]?.playerId));
        if (!winner) return null;
        const winnerRacer = this.state.racers[String(standings[0]?.playerId)];
        if (winnerRacer?.isHuman === true) {
            const winnerRewards = this._settleWinnerRewards(winner, winnerRacer);
            rewardsPending ||= winnerRewards.rewardsPending;
        } else {
            this.bestXpPending = false;
        }
        if (rewardsPending && this.settlementWaitAttempts < 2) {
            this.settlementWaitAttempts += 1;
            return { shouldEnd: false, settling: true, winner: null, reason: 'WEAPON_RACE_SETTLING', parcours: null };
        }
        this.phase = 'finished';
        this.roundOutcome = {
            shouldEnd: true,
            winner,
            reason: 'WEAPON_RACE_COMPLETE',
            standings,
            awardedXp: this.totalVictoryXpAwarded,
            rewardsPersisted: !rewardsPending,
            pendingRewardCount: 0,
            parcours: {
                standings,
                completionTimeMs: winnerRacer?.finishTimeMs ?? null,
                completedAtMs: this.state.firstFinishAtMs,
            },
        };
        if (winnerRacer?.isHuman === true) this._refreshOutcomeRewardStatus(winnerRacer);
        else {
            this.roundOutcome.pendingRewardCount = this.pendingCheckpointRewards.length + this.pendingGameplayRewards.length;
            this.roundOutcome.rewardsPersisted = this.roundOutcome.pendingRewardCount === 0;
        }
        return this.roundOutcome;
    }

    getHudState(now = this._raceNow()) {
        this._followRaceClock();
        const standings = rankWeaponRaceRacers(this.state);
        const human = this.state?.racers?.[this.state.humanPlayerId] || null;
        return {
            runType: WEAPON_RACE_RUN_TYPE,
            vehicleId: this.rewardBinding?.vehicleId || '',
            phase: this.phase,
            checkpoint: human?.checkpointIndex || 0,
            checkpointCount: WEAPON_RACE_CHECKPOINT_ORDER.length,
            weaponId: this._player(Number(this.state.humanPlayerId))?.weaponRaceWeaponId || '',
            place: standings.find((row) => row.playerId === this.state.humanPlayerId)?.place || 0,
            racerCount: standings.length,
            graceRemainingMs: this.state.graceEndsAtMs === null ? 0 : Math.max(0, this.state.graceEndsAtMs - Number(now)),
            standings,
            xpEarned: this.xpEarned,
        };
    }
}
