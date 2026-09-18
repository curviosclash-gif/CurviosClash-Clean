import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from '../../shared/contracts/HuntWinConditionContract.js';

export class RoundOutcomeSystem {
    constructor({
        getPlayers = () => [],
        getHumanPlayers = () => [],
        getBots = () => [],
        getScoreboard = () => [],
        isRespawnEnabled = () => false,
        isEliminationSuppressed = () => Boolean(false),
        isRespawnPending = (player) => Boolean(player && false),
        isOutcomeAuthority = () => true,
        getDeathmatchKillLimit = () => 10,
        getWinCondition = () => HUNT_WIN_CONDITIONS.KILLS_TIME,
        getDeathmatchTimeLimitSeconds = () => 300,
        getElapsedSeconds = () => 0,
        getObjectiveOutcome = () => null,
    } = {}) {
        this.getPlayers = getPlayers;
        this.getHumanPlayers = getHumanPlayers;
        this.getBots = getBots;
        this.getScoreboard = getScoreboard;
        this.isRespawnEnabled = isRespawnEnabled;
        this.isEliminationSuppressed = isEliminationSuppressed;
        this.isRespawnPending = isRespawnPending;
        this.isOutcomeAuthority = isOutcomeAuthority;
        this.getDeathmatchKillLimit = getDeathmatchKillLimit;
        this.getWinCondition = getWinCondition;
        this.getDeathmatchTimeLimitSeconds = getDeathmatchTimeLimitSeconds;
        this.getElapsedSeconds = getElapsedSeconds;
        this.getObjectiveOutcome = getObjectiveOutcome;
        this._overtime = false;
        this._requestedOutcome = null;
    }

    reset() {
        this._overtime = false;
        this._requestedOutcome = null;
    }

    requestRoundEnd({ winner = null, allowNoWinner = false, reason = 'OBJECTIVE', parcours = null } = {}) {
        if ((!winner && allowNoWinner !== true) || this._requestedOutcome) return false;
        this._requestedOutcome = {
            shouldEnd: true,
            winner,
            reason: String(reason || 'OBJECTIVE'),
            parcours: parcours && typeof parcours === 'object' ? parcours : null,
        };
        return true;
    }

    getDeathmatchState() {
        const timeLimitSeconds = normalizeHuntWinCondition(this.getWinCondition()) === HUNT_WIN_CONDITIONS.KILLS_TIME
            ? Math.max(0, Number(this.getDeathmatchTimeLimitSeconds()) || 0) : 0;
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
        if (Array.isArray(players) && players.length > 0) {
            return players.filter((player) => player && player.entitySlotActive !== false);
        }
        return [
            ...(this.getHumanPlayers() || []),
            ...(this.getBots() || []).map((entry) => entry?.player)
                .filter((player) => player && player.entitySlotActive !== false),
        ];
    }

    resolve() {
        if (this.isRespawnEnabled() && !this.isOutcomeAuthority()) {
            return { shouldEnd: false, winner: null, reason: '', parcours: null };
        }
        if (this._requestedOutcome) return this._requestedOutcome;
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
        if (this.isRespawnEnabled() && normalizeHuntWinCondition(this.getWinCondition()) === HUNT_WIN_CONDITIONS.LAST_ALIVE) {
            const contenders = combatants.filter((player) => player.alive || this.isRespawnPending(player));
            const shouldEnd = combatants.length > 1 && contenders.length <= 1;
            return {
                shouldEnd,
                winner: shouldEnd ? (contenders[0] || null) : null,
                reason: shouldEnd ? 'LAST_ALIVE' : '',
                parcours: null,
            };
        }
        if (this.isRespawnEnabled()) {
            const scoreTarget = normalizeHuntWinCondition(this.getWinCondition()) === HUNT_WIN_CONDITIONS.SCORE_TARGET;
            const killLimit = Math.max(1, Math.trunc(Number(this.getDeathmatchKillLimit()) || 10));
            const scoreboard = this.getScoreboard() || [];
            const leader = scoreboard[0] || null;
            const runnerUp = scoreboard[1] || null;
            const leaderScore = Math.max(0, Number(scoreTarget ? leader?.points : leader?.kills) || 0);
            const topTied = !!runnerUp && leaderScore === Math.max(0, Number(scoreTarget ? runnerUp?.points : runnerUp?.kills) || 0);
            const state = this.getDeathmatchState();
            const timeExpired = state.timeLimitSeconds > 0 && state.timeRemainingSeconds <= 0;

            if (this._overtime && leader && !topTied) {
                const winner = combatants.find((player) => player?.index === leader.playerIndex) || null;
                return { shouldEnd: !!winner, winner, reason: 'OVERTIME', parcours: null };
            }
            if ((leaderScore >= killLimit || timeExpired) && topTied) {
                this._overtime = true;
                return { shouldEnd: false, winner: null, reason: 'OVERTIME', parcours: null };
            }
            if (leader && (leaderScore >= killLimit || timeExpired)) {
                const winner = combatants.find((player) => player?.index === leader.playerIndex) || null;
                return {
                    shouldEnd: !!winner,
                    winner,
                    reason: leaderScore >= killLimit ? (scoreTarget ? 'SCORE_TARGET' : 'KILL_LIMIT') : 'TIME_LIMIT',
                    parcours: null,
                };
            }
            return { shouldEnd: false, winner: null, reason: '', parcours: null };
        }

        // A human without a life and without a respawn on its way can no longer change the
        // round. The last-survivor rule below never fires for a lone player, and parcours
        // suppression used to hold even after the last respawn was spent - both froze the run.
        const humans = combatants.filter((player) => player && player.isBot !== true);
        const humansOut = humans.length > 0
            && humans.every((player) => !player.alive && this.isRespawnPending(player) !== true);
        const eliminationSuppressed = this.isEliminationSuppressed();

        // Parcours respawns suppress elimination without turning the route into a Hunt
        // deathmatch. Completion remains objective-driven, with no kill/time-limit rules.
        if (eliminationSuppressed && !humansOut) {
            return { shouldEnd: false, winner: null, reason: '', parcours: null };
        }

        const alive = combatants.filter((player) => player?.alive);
        const shouldEnd = (combatants.length > 1 && alive.length <= 1)
            || (humansOut && (alive.length === 0 || eliminationSuppressed));
        return {
            shouldEnd,
            winner: shouldEnd ? (alive[0] || null) : null,
            reason: shouldEnd ? 'ELIMINATION' : '',
            parcours: null,
        };
    }
}
