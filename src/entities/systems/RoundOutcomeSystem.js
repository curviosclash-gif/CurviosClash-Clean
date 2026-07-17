export class RoundOutcomeSystem {
    constructor({
        getPlayers = () => [],
        getHumanPlayers = () => [],
        getBots = () => [],
        getScoreboard = () => [],
        isRespawnEnabled = () => false,
        isOutcomeAuthority = () => true,
        getDeathmatchKillLimit = () => 10,
        getDeathmatchTimeLimitSeconds = () => 300,
        getElapsedSeconds = () => 0,
        getObjectiveOutcome = () => null,
    } = {}) {
        this.getPlayers = getPlayers;
        this.getHumanPlayers = getHumanPlayers;
        this.getBots = getBots;
        this.getScoreboard = getScoreboard;
        this.isRespawnEnabled = isRespawnEnabled;
        this.isOutcomeAuthority = isOutcomeAuthority;
        this.getDeathmatchKillLimit = getDeathmatchKillLimit;
        this.getDeathmatchTimeLimitSeconds = getDeathmatchTimeLimitSeconds;
        this.getElapsedSeconds = getElapsedSeconds;
        this.getObjectiveOutcome = getObjectiveOutcome;
        this._overtime = false;
    }

    reset() { this._overtime = false; }

    getDeathmatchState() {
        const timeLimitSeconds = Math.max(0, Number(this.getDeathmatchTimeLimitSeconds()) || 0);
        const elapsedSeconds = Math.max(0, Number(this.getElapsedSeconds()) || 0);
        return {
            elapsedSeconds,
            timeLimitSeconds,
            timeRemainingSeconds: timeLimitSeconds > 0 ? Math.max(0, timeLimitSeconds - elapsedSeconds) : 0,
            overtime: this._overtime,
        };
    }

    _getCombatants() {
        const players = this.getPlayers();
        if (Array.isArray(players) && players.length > 0) return players.filter(Boolean);
        return [
            ...(this.getHumanPlayers() || []),
            ...(this.getBots() || []).map((entry) => entry?.player).filter(Boolean),
        ];
    }

    resolve() {
        if (this.isRespawnEnabled() && !this.isOutcomeAuthority()) {
            return { shouldEnd: false, winner: null, reason: '', parcours: null };
        }
        const objectiveOutcome = this.getObjectiveOutcome?.();
        if (objectiveOutcome?.shouldEnd === true && objectiveOutcome?.winner) {
            return {
                shouldEnd: true,
                winner: objectiveOutcome.winner,
                reason: objectiveOutcome.reason || 'OBJECTIVE',
                parcours: objectiveOutcome.parcours || null,
            };
        }

        const combatants = this._getCombatants();
        if (this.isRespawnEnabled()) {
            const killLimit = Math.max(1, Math.trunc(Number(this.getDeathmatchKillLimit()) || 10));
            const scoreboard = this.getScoreboard() || [];
            const leader = scoreboard[0] || null;
            const runnerUp = scoreboard[1] || null;
            const leaderKills = Math.max(0, Number(leader?.kills) || 0);
            const topTied = !!runnerUp && leaderKills === Math.max(0, Number(runnerUp?.kills) || 0);
            const state = this.getDeathmatchState();
            const timeExpired = state.timeLimitSeconds > 0 && state.timeRemainingSeconds <= 0;

            if (this._overtime && leader && !topTied) {
                const winner = combatants.find((player) => player?.index === leader.playerIndex) || null;
                return { shouldEnd: !!winner, winner, reason: 'OVERTIME', parcours: null };
            }
            if ((leaderKills >= killLimit || timeExpired) && topTied) {
                this._overtime = true;
                return { shouldEnd: false, winner: null, reason: 'OVERTIME', parcours: null };
            }
            if (leader && (leaderKills >= killLimit || timeExpired)) {
                const winner = combatants.find((player) => player?.index === leader.playerIndex) || null;
                return {
                    shouldEnd: !!winner,
                    winner,
                    reason: leaderKills >= killLimit ? 'KILL_LIMIT' : 'TIME_LIMIT',
                    parcours: null,
                };
            }
            return { shouldEnd: false, winner: null, reason: '', parcours: null };
        }

        const alive = combatants.filter((player) => player?.alive);
        const shouldEnd = combatants.length > 1 && alive.length <= 1;
        return {
            shouldEnd,
            winner: shouldEnd ? (alive[0] || null) : null,
            reason: shouldEnd ? 'ELIMINATION' : '',
            parcours: null,
        };
    }
}
