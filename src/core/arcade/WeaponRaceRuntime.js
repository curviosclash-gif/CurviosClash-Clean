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

export class WeaponRaceRuntime {
    constructor({ now = () => Date.now(), getRecordStore = () => null } = {}) {
        this._now = now;
        this._getRecordStore = getRecordStore;
        this.reset();
    }

    reset() {
        this.entityManager = null;
        this.state = createWeaponRaceState();
        this.phase = 'idle';
        this.rewardBinding = null;
        this.xpEarned = 0;
        this.bestXpAwarded = false;
        this.presentation = null;
        this.route = null;
    }

    start({ entityManager = null, vehicleId = 'ship1' } = {}) {
        this.entityManager = entityManager;
        const players = Array.isArray(entityManager?.players) ? entityManager.players.filter(Boolean) : [];
        const human = (Array.isArray(entityManager?.humanPlayers) ? entityManager.humanPlayers : []).find(Boolean)
            || players.find((entry) => entry?.isBot !== true) || null;
        this.state = createWeaponRaceState({
            startedAtMs: this._now(),
            humanPlayerId: playerId(human),
            racerIds: players.map(playerId),
        });
        this.phase = 'racing';
        this.rewardBinding = bindArcadeVehicleRewards({ runType: WEAPON_RACE_RUN_TYPE, vehicleId });
        this.xpEarned = 0;
        this.bestXpAwarded = false;
        for (const player of players) clearWeaponRaceLoadout(player, { projectileSystem: entityManager?._projectileSystem });
        this.route = entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
        this.presentation?.dispose?.();
        this.presentation = new WeaponRacePickupPresentation(entityManager?.renderer || null);
        this.presentation.start(this.route);
        return this.getHudState();
    }

    dispose() {
        this.presentation?.dispose?.();
        for (const player of this.entityManager?.players || []) {
            clearWeaponRaceLoadout(player, { projectileSystem: this.entityManager?._projectileSystem });
        }
        this.reset();
    }

    _player(playerIndex) {
        return (this.entityManager?.players || []).find((entry) => Number(entry?.index) === Number(playerIndex)) || null;
    }

    _award(amount, playerIndex) {
        if (String(playerIndex) !== this.state.humanPlayerId || !(amount > 0)) return null;
        const result = awardBoundArcadeVehicleXpInStore(this._getRecordStore(), this.rewardBinding, amount, this._now());
        if (result) this.xpEarned += result.earned;
        return result;
    }

    handleCheckpoint({ playerIndex, checkpointId } = {}) {
        if (this.phase !== 'racing' && this.phase !== 'grace') return { accepted: false, awardedXp: 0, stage: null };
        const result = recordWeaponRaceCheckpoint(this.state, playerIndex, checkpointId);
        const player = this._player(playerIndex);
        if (result.stage && player) {
            applyWeaponRaceStage(player, result.stage, { projectileSystem: this.entityManager?._projectileSystem });
        }
        this._award(result.awardedXp, playerIndex);
        return result;
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

    handleFinish({ playerIndex, finishedAtMs = this._now() } = {}) {
        const result = finishWeaponRaceRacer(this.state, playerIndex, finishedAtMs);
        if (result.accepted) {
            this.phase = 'grace';
            this._award(result.awardedXp, playerIndex);
        }
        return result;
    }

    handleNewBest(playerIndex) {
        if (this.bestXpAwarded || String(playerIndex) !== this.state.humanPlayerId) return { awardedXp: 0 };
        this.bestXpAwarded = true;
        this._award(WEAPON_RACE_NEW_BEST_XP, playerIndex);
        return { awardedXp: WEAPON_RACE_NEW_BEST_XP };
    }

    updateProgress(playerIndex, distanceToNext) {
        return updateWeaponRaceProgress(this.state, playerIndex, distanceToNext);
    }

    update(now = this._now()) {
        if (!this.route) {
            this.route = this.entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
            if (this.route) this.presentation?.start?.(this.route);
        }
        this.presentation?.update?.(now);
        return this.getHudState(now);
    }

    handleGameplayEvent(event = null) {
        if (!event || String(event.playerIndex) !== this.state.humanPlayerId) return null;
        const amount = {
            kill: XP_REWARD_TABLE.killBase,
            intercept: XP_REWARD_TABLE.interceptBase,
            unit_destroyed: XP_REWARD_TABLE.unitDestroyedBase,
        }[String(event.type || '')] || 0;
        return this._award(amount, event.playerIndex);
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

    getRoundOutcome(now = this._now()) {
        if (this.state.firstFinishAtMs === null || Number(now) < this.state.graceEndsAtMs) return null;
        this._syncDistances();
        const standings = rankWeaponRaceRacers(this.state);
        const winner = this._player(Number(standings[0]?.playerId));
        if (!winner) return null;
        this.phase = 'finished';
        return {
            shouldEnd: true,
            winner,
            reason: 'WEAPON_RACE_COMPLETE',
            standings,
            parcours: { standings, completedAtMs: this.state.firstFinishAtMs },
        };
    }

    getHudState(now = this._now()) {
        const standings = rankWeaponRaceRacers(this.state);
        const human = this.state?.racers?.[this.state.humanPlayerId] || null;
        return {
            runType: WEAPON_RACE_RUN_TYPE,
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
