import { resolveThunderflightMultiplier, THUNDERFLIGHT_STRIKE_INTERVAL_SECONDS } from '../../shared/contracts/ThunderflightContract.js';

/** Per-run scoring; entity managers and their lightning systems belong to one map session. */
export class ThunderflightRunOps {
    constructor(runtime) {
        this.runtime = runtime;
        this.totalPoints = new Map();
        this.mapPoints = new Map();
        this.claimed = new Map();
        this.nextStrikeSeconds = THUNDERFLIGHT_STRIKE_INTERVAL_SECONDS;
    }

    start() {
        if (this.manager === this.runtime.entityManager) return;
        this.manager = this.runtime.entityManager;
        this.mapPoints.clear(); this.claimed.clear();
        this.nextStrikeSeconds = THUNDERFLIGHT_STRIKE_INTERVAL_SECONDS;
        for (const player of this.runtime.entityManager?.players || []) {
            if (!this.totalPoints.has(player.index)) this.totalPoints.set(player.index, 0);
            this.mapPoints.set(player.index, 0);
            if (player.isBot) player.huntParcoursRaceWeight = 1;
        }
    }

    handleParcoursEvent(event) {
        const r = this.runtime;
        if (r._finishEvent) return null;
        const player = r.entityManager?.players?.find(p => p.index === event?.playerIndex && p.alive === true);
        if (!player || !this.mapPoints.has(player.index)) return null;
        if (event.type === 'checkpoint') {
            const index = Number(event.checkpointIndex);
            if (!Number.isInteger(index) || index < 0 || index !== (this.claimed.get(player.index) ?? -1) + 1) return null;
            const multiplier = resolveThunderflightMultiplier(player.position?.y, r.entityManager?.arena?.bounds);
            this.claimed.set(player.index, index);
            this.mapPoints.set(player.index, this.mapPoints.get(player.index) + 100 * multiplier);
            this.totalPoints.set(player.index, this.totalPoints.get(player.index) + 100 * multiplier);
            if (!player.isBot) r.ringClaims += 1;
        } else if (event.type === 'finish') {
            r._finishEvent = { reason: 'finish', finisherIndex: player.index,
                totalTimeMs: Math.max(0, Math.round(Number(event.totalTimeMs) || r.elapsedMs)) };
        } else return null;
        return r.getHudState();
    }

    leaders(points = this.totalPoints) {
        let best = -1;
        const leaders = [];
        for (const [index, score] of points) {
            if (score > best) { best = score; leaders.length = 0; }
            if (score === best) leaders.push(index);
        }
        return leaders;
    }

    winnerSide(points = this.totalPoints) {
        const leaders = this.leaders(points);
        if (leaders.length !== 1) return 'draw';
        return this.runtime.entityManager?.humanPlayers?.some(p => p.index === leaders[0]) ? 'human' : 'rival';
    }

    mapResult() {
        return { pointsByPlayer: Object.fromEntries(this.mapPoints), finisherIndex: this.runtime._finishEvent?.finisherIndex,
            leaders: this.leaders(this.mapPoints) };
    }

    getRoundOutcome() {
        const r = this.runtime;
        if (r._roundOutcome || !r._finishEvent || r.phase !== 'hunting') return r._roundOutcome;
        // A validated finish is terminal even if combat kills its owner later in the same tick.
        // Result ownership still comes from points, including draws.
        const winner = r.entityManager.players.find(p => p.index === r._finishEvent.finisherIndex);
        if (!winner) return null;
        const mapIndex = r.mapIndex, winnerSide = this.winnerSide(this.mapPoints);
        r._completeStage({ ...r._finishEvent, winnerSide });
        r._roundOutcome = { shouldEnd: true, winner, reason: 'HUNT_PARCOURS_STAGE_COMPLETE',
            parcours: { variantId: 'thunderflight', mapIndex, result: 'finish', winnerSide } };
        return r._roundOutcome;
    }

    update() {
        const seconds = this.runtime.elapsedMs / 1000;
        if (seconds < this.nextStrikeSeconds || this.runtime._finishEvent) return;
        // A delayed frame casts at most once, with no burst of overdue hazards.
        this.nextStrikeSeconds = seconds + THUNDERFLIGHT_STRIKE_INTERVAL_SECONDS;
        this.runtime.entityManager?._lightningStrikeSystem?.activateEnvironment?.();
    }

    hud() {
        const r = this.runtime, human = r.entityManager?.humanPlayers?.[0];
        return { score: this.totalPoints.get(human?.index) || 0, pointsByPlayer: Object.fromEntries(this.totalPoints),
            heightMultiplier: resolveThunderflightMultiplier(human?.position?.y, r.entityManager?.arena?.bounds),
            lightningWarning: r.entityManager?._lightningStrikeSystem?.getWarningState?.() || null,
            runWinnerSide: this.winnerSide(), leaders: this.leaders() };
    }

    resultTitle() {
        return this.winnerSide() === 'human' ? 'Gewitterflug gewonnen'
            : this.winnerSide() === 'draw' ? 'Gewitterflug unentschieden' : 'Gewitterflug: Rennbot gewinnt';
    }
}
