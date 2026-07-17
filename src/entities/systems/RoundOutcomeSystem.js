export class RoundOutcomeSystem {
    constructor({
        getPlayers = () => [],
        getHumanPlayers = () => [],
        getBots = () => [],
        getScoreboard = () => [],
        isRespawnEnabled = () => false,
        getDeathmatchKillLimit = () => 10,
        getObjectiveOutcome = () => null,
    } = {}) {
        this.getPlayers = getPlayers;
        this.getHumanPlayers = getHumanPlayers;
        this.getBots = getBots;
        this.getScoreboard = getScoreboard;
        this.isRespawnEnabled = isRespawnEnabled;
        this.getDeathmatchKillLimit = getDeathmatchKillLimit;
        this.getObjectiveOutcome = getObjectiveOutcome;
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
            const leader = (this.getScoreboard() || []).find((entry) => Number(entry?.kills) >= killLimit);
            if (leader) {
                const winner = combatants.find((player) => player?.index === leader.playerIndex) || null;
                return { shouldEnd: true, winner, reason: 'KILL_LIMIT', parcours: null };
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
