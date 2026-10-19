import { createFoxHuntStartOrder, FOX_HUNT_DURATION_MS, resolveFoxHuntLeaders } from '../../shared/contracts/FoxHuntContract.js';
import { formatPlayerDisplayLabel } from '../../shared/contracts/PlayerDisplayLabelContract.js';
import { bindFoxHuntProfiles, settleFoxHuntPartners } from './FoxHuntProfileOps.js';

const emptyScore = () => ({ points: 0, rings: 0, kills: 0 });

/** Run-owned roles and scores survive map sessions; positions and checkpoint progress never transfer. */
export class FoxHuntRunOps {
    constructor(runtime) {
        this.runtime = runtime;
        this.totals = new Map();
        this.totalPoints = new Map();
        this.startOrder = null;
        /** @type {Map<number, any> | null} */
        this.targets = null;
        this.rewardTotals = new Map();
    }

    start(seed) {
        const r = this.runtime;
        if (this.manager === r.entityManager) return;
        this.manager = r.entityManager;
        if (!this.manager) return;
        this.mapScores = new Map(); this.claimed = new Map(); this.seenEliminations = new Set();
        this.clockStart = Number(this.manager?._simulationClockMs) || 0;
        const players = (this.manager?.players || []).filter(p => p.entitySlotActive !== false);
        if (!this.targets) bindFoxHuntProfiles(this);
        if (!this.startOrder) this.startOrder = createFoxHuntStartOrder(players.map(p => p.index), seed || r.variant.seed);
        for (const player of players) {
            this.mapScores.set(player.index, emptyScore());
            if (!this.totals.has(player.index)) this.totals.set(player.index, emptyScore());
            this.totalPoints.set(player.index, this.totals.get(player.index).points);
        }
        this.setFox(this.startOrder[r.mapIndex % this.startOrder.length]);
    }

    timeMs() {
        const clock = Number(this.manager?._simulationClockMs);
        return Number.isFinite(clock) ? Math.max(0, clock - this.clockStart) : this.runtime.elapsedMs;
    }

    setFox(index) {
        this.foxIndex = index;
        this.manager.huntParcoursFoxIndex = index;
        this.manager._objectiveTargetMarkerSystem?.setTarget?.(index);
        for (const player of this.manager.players) {
            player.huntParcoursFox = player.index === index;
            player.huntParcoursRaceWeight = player.huntParcoursFox ? 1 : 0;
            player.huntParcoursFoxTargetIndex = player.huntParcoursFox ? undefined : index;
            player.fightTargetPlayerIndex = -1;
            player.fightTargetLockRemaining = 0;
        }
    }

    addScore(index, points, field = '') {
        const map = this.mapScores.get(index), total = this.totals.get(index);
        map.points += points; total.points += points;
        if (field) { map[field]++; total[field]++; }
        this.totalPoints.set(index, total.points);
    }

    handleGameplayEvent(event) {
        const r = this.runtime;
        if (event?.type !== 'fox_hunt_elimination' || r._finishEvent || this.timeMs() > FOX_HUNT_DURATION_MS
            || !Number.isInteger(event.sequence) || this.seenEliminations.has(event.sequence)) return null;
        this.seenEliminations.add(event.sequence);
        const killer = this.manager.players.find(p => p.index === event.playerIndex && p.entitySlotActive !== false);
        if (!killer || killer.index === event.victimIndex || event.victimIndex !== this.foxIndex || !this.mapScores.has(killer.index)) return null;
        this.addScore(killer.index, 250, 'kills');
        this.setFox(killer.index);
        return r.getHudState();
    }

    handleParcoursEvent(event) {
        const r = this.runtime;
        if (r._finishEvent || this.timeMs() > FOX_HUNT_DURATION_MS) return null;
        const player = this.manager.players.find(p => p.index === event?.playerIndex && p.alive === true);
        if (!player || !this.mapScores.has(player.index)) return null;
        if (event.type === 'checkpoint') {
            const index = event.checkpointIndex;
            if (!Number.isInteger(index) || index < 0 || index !== (this.claimed.get(player.index) ?? -1) + 1) return null;
            this.claimed.set(player.index, index);
            if (player.index === this.foxIndex) {
                this.addScore(player.index, 100, 'rings');
                if (!player.isBot) r.ringClaims++;
            }
        } else if (event.type === 'finish' && player.index === this.foxIndex) {
            this.addScore(player.index, 1000);
            r._finishEvent = { reason: 'finish', finisherIndex: player.index, totalTimeMs: this.timeMs(), leaders: [player.index] };
        } else return null;
        return r.getHudState();
    }

    leaders() { return resolveFoxHuntLeaders(this.totals); }
    winnerSide(leaders = this.leaders()) {
        return this.manager?.humanPlayers?.some(player => leaders.includes(player.index)) ? 'human' : 'rival';
    }
    mapResult() {
        return { scoresByPlayer: Object.fromEntries([...this.mapScores].map(([index, score]) => [index, { ...score }])),
            leaders: [...this.runtime._finishEvent.leaders], finisherIndex: this.runtime._finishEvent.finisherIndex,
            startFoxIndex: this.startOrder[this.runtime.mapIndex % this.startOrder.length] };
    }

    getRoundOutcome() {
        const r = this.runtime;
        if (r._roundOutcome || r.phase !== 'hunting') return r._roundOutcome;
        if (!r._finishEvent && this.timeMs() >= FOX_HUNT_DURATION_MS) {
            r._finishEvent = { reason: 'timeout', totalTimeMs: FOX_HUNT_DURATION_MS, leaders: resolveFoxHuntLeaders(this.mapScores) };
        }
        if (!r._finishEvent) return null;
        const result = r._finishEvent, mapIndex = r.mapIndex;
        const winnerSide = this.winnerSide(result.leaders);
        const winner = result.leaders.length === 1 ? this.manager.players.find(p => p.index === result.leaders[0]) || null : null;
        r._completeStage({ ...result, winnerSide });
        r._roundOutcome = { shouldEnd: true, winner, reason: 'HUNT_PARCOURS_STAGE_COMPLETE',
            parcours: { variantId: 'fox_hunt', mapIndex, result: result.reason, winnerSide, leaders: [...result.leaders] } };
        return r._roundOutcome;
    }

    update() { /* The objective seam runs after that tick's checkpoint and kill events. */ }
    settlePartners() { return settleFoxHuntPartners(this); }
    label(index) { return formatPlayerDisplayLabel(this.manager?.players?.find(p => p.index === index)); }
    resultTitle() { return `Fuchsjagd: ${this.leaders().map(index => this.label(index)).join(' & ')} ${this.leaders().length > 1 ? 'teilen den Sieg' : 'gewinnt'}`; }
    hud() {
        return { score: this.totalPoints.get(this.manager?.humanPlayers?.[0]?.index) || 0,
            pointsByPlayer: Object.fromEntries(this.totalPoints), leaders: this.leaders(),
            foxIndex: this.foxIndex, foxLabel: this.label(this.foxIndex), remainingSeconds: Math.max(0, (FOX_HUNT_DURATION_MS - this.timeMs()) / 1000),
            scoresByPlayer: Object.fromEntries([...this.totals].map(([index, score]) => [index, { ...score }])),
            runWinnerSide: this.winnerSide(), resultTitle: this.resultTitle() };
    }
}
