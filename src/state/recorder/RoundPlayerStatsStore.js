// ============================================
// RoundPlayerStatsStore.js - per-player tally of one round for balance telemetry
// ============================================
//
// Die Rundensummen sagen, wie oft eine Waffe getroffen hat, aber nicht, wer
// damit gewonnen hat. Erst eine Zeile je Spieler verbindet Fahrzeug, Waffe und
// Ausgang der Runde - ohne sie laesst sich keine Waffe und kein Fahrzeug
// gegeneinander abwaegen.

function normalizeTypeKey(value) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return normalized || 'UNKNOWN';
}

function roundTenth(value) {
    return Math.round(value * 10) / 10;
}

function roundTenthMap(source) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, roundTenth(value)]));
}

// KILL-Ereignisse tragen ihre Angaben als "cause=PROJECTILE killer=2 weapon=ROCKET_STRONG".
function parseKillFields(data) {
    const fields = {};
    for (const part of String(data || '').split(' ')) {
        const separator = part.indexOf('=');
        if (separator > 0) fields[part.slice(0, separator)] = part.slice(separator + 1);
    }
    return fields;
}

function createPlayerStats() {
    return {
        kills: 0,
        deaths: 0,
        damageDealt: 0,
        damageTaken: 0,
        killsByType: {},
        damageByType: {},
    };
}

export class RoundPlayerStatsStore {
    constructor() {
        this._statsByIndex = new Map();
    }

    reset() {
        this._statsByIndex.clear();
    }

    _ensure(playerIndex) {
        let stats = this._statsByIndex.get(playerIndex);
        if (!stats) {
            stats = createPlayerStats();
            this._statsByIndex.set(playerIndex, stats);
        }
        return stats;
    }

    registerDamage(event) {
        const applied = Math.max(0, Number(event?.damageResult?.applied) || 0);
        const absorbed = Math.max(0, Number(event?.damageResult?.absorbedByShield) || 0);
        const hpApplied = Math.max(0, Number(event?.damageResult?.hpApplied) || (applied - absorbed));
        const total = hpApplied + absorbed;
        if (total <= 0) return;
        const sourceIndex = event?.sourcePlayer?.index;
        const targetIndex = event?.target?.index;
        if (Number.isInteger(targetIndex) && targetIndex >= 0) {
            this._ensure(targetIndex).damageTaken += total;
        }
        // Eigenschaden zaehlt nicht als ausgeteilt: er sagt nichts ueber die Waffe.
        if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex === targetIndex) return;
        const stats = this._ensure(sourceIndex);
        const typeKey = normalizeTypeKey(event?.projectileType || event?.cause);
        stats.damageDealt += total;
        stats.damageByType[typeKey] = (stats.damageByType[typeKey] || 0) + total;
    }

    registerKill(victimIndex, data) {
        if (!Number.isInteger(victimIndex) || victimIndex < 0) return;
        this._ensure(victimIndex).deaths += 1;
        const fields = parseKillFields(data);
        const killerIndex = Number(fields.killer);
        if (!Number.isInteger(killerIndex) || killerIndex < 0 || killerIndex === victimIndex) return;
        const stats = this._ensure(killerIndex);
        const typeKey = normalizeTypeKey(fields.weapon || fields.cause);
        stats.kills += 1;
        stats.killsByType[typeKey] = (stats.killsByType[typeKey] || 0) + 1;
    }

    /**
     * @param {Array<any>} players
     * @param {any} winner
     */
    snapshot(players, winner) {
        if (!Array.isArray(players)) return [];
        const winnerIndex = Number.isInteger(winner?.index) ? winner.index : -1;
        return players
            .filter((player) => player && Number.isInteger(player.index) && player.entitySlotActive !== false)
            .map((player) => {
                const stats = this._statsByIndex.get(player.index) || createPlayerStats();
                return {
                    index: player.index,
                    isBot: player.isBot === true,
                    vehicleId: typeof player.vehicleId === 'string' ? player.vehicleId : '',
                    teamId: typeof player.teamId === 'string' ? player.teamId : '',
                    won: player.index === winnerIndex,
                    kills: stats.kills,
                    deaths: stats.deaths,
                    damageDealt: roundTenth(stats.damageDealt),
                    damageTaken: roundTenth(stats.damageTaken),
                    killsByType: { ...stats.killsByType },
                    damageByType: roundTenthMap(stats.damageByType),
                };
            });
    }
}
