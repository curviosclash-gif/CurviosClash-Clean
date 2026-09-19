import { formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';
import { areTeammates } from '../shared/contracts/TeamCombatContract.js';

const ASSIST_WINDOW_SECONDS = 8;
const ASSIST_MIN_DAMAGE = 10;
const ASSIST_MIN_EFFECTIVE_HP_RATIO = 0.1;
const SPAWN_DEATH_WINDOW_SECONDS = 5;

function getNowSeconds() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now() * 0.001;
    }
    return Date.now() * 0.001;
}

function getPlayerLabel(player) {
    if (!player) return 'Unknown';
    return formatPlayerDisplayLabel(player);
}

export class HuntScoring {
    constructor(nowSeconds = getNowSeconds) {
        this._statsByPlayer = new Map();
        this._damageHistoryByTarget = new Map();
        this._nowSeconds = nowSeconds;
    }

    reset() {
        this._statsByPlayer.clear();
        this._damageHistoryByTarget.clear();
    }

    _ensureStats(playerIndex) {
        if (!this._statsByPlayer.has(playerIndex)) {
            this._statsByPlayer.set(playerIndex, {
                kills: 0,
                assists: 0,
                deaths: 0,
                damage: 0,
                shieldDamage: 0,
                spawnDeaths: 0,
                intercepts: 0,
                unitsDestroyed: 0,
                unitDestroyedXp: 0,
                points: 0,
            });
        }
        return this._statsByPlayer.get(playerIndex);
    }

    registerDamage(sourcePlayer, targetPlayer, damageResult, nowSeconds = this._nowSeconds()) {
        const sourceIndex = sourcePlayer?.index;
        const targetIndex = targetPlayer?.index;
        if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) || sourceIndex === targetIndex) {
            return;
        }

        const applied = Math.max(0, Number(damageResult?.applied) || 0);
        const absorbedByShield = Math.max(0, Number(damageResult?.absorbedByShield) || 0);
        const hpApplied = Math.max(0, Number(damageResult?.hpApplied) || (applied - absorbedByShield));
        if (hpApplied <= 0 && absorbedByShield <= 0) return;

        const sourceStats = this._ensureStats(sourceIndex);
        sourceStats.damage += hpApplied;
        sourceStats.shieldDamage += absorbedByShield;

        if (!this._damageHistoryByTarget.has(targetIndex)) {
            this._damageHistoryByTarget.set(targetIndex, new Map());
        }
        const byAttacker = this._damageHistoryByTarget.get(targetIndex);
        const existing = byAttacker.get(sourceIndex) || {
            damage: 0,
            shieldDamage: 0,
            lastHitAt: nowSeconds,
        };
        existing.damage += hpApplied;
        existing.shieldDamage += absorbedByShield;
        existing.lastHitAt = nowSeconds;
        byAttacker.set(sourceIndex, existing);
    }

    // Read-only view on the damage history: how long ago each attacker last hit the target.
    // Ages are measured on the same clock that stamped the hits, so callers on a different
    // clock (the simulation clock) can still use them without converting timestamps.
    getDamageHistoryAges(targetIndex, nowSeconds = this._nowSeconds()) {
        const byAttacker = this._damageHistoryByTarget.get(targetIndex);
        if (!byAttacker) return [];
        const now = Number(nowSeconds) || 0;
        const entries = [];
        for (const [attackerIndex, entry] of byAttacker.entries()) {
            entries.push({ attackerIndex, ageSeconds: now - (Number(entry?.lastHitAt) || 0) });
        }
        return entries;
    }

    // E75: shooting down an incoming rocket is counted, but it is not a kill - it stays
    // out of the kill tally, out of the sorting and out of the round decision.
    registerIntercept(playerIndex) {
        if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
        const stats = this._ensureStats(playerIndex);
        stats.intercepts += 1;
        stats.points += 1;
    }

    // E19: a destroyed tank is counted for its destroyer, but like an intercept it is no kill.
    registerUnitDestroyed(playerIndex, kind = 'tank') {
        if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
        const stats = this._ensureStats(playerIndex);
        stats.unitsDestroyed += 1;
        stats.points += kind === 'boss' ? 3 : (kind === 'swarm' || kind === 'creature' ? 0 : 1);
        stats.unitDestroyedXp += kind === 'swarm' ? 5 : (kind === 'bomber' ? 40 : (kind === 'creature' ? 100 : 30));
    }

    registerElimination(targetPlayer, options = {}) {
        const targetIndex = targetPlayer?.index;
        if (!Number.isInteger(targetIndex)) return { killerIndex: -1, assistIndices: [] };

        const nowSeconds = Number.isFinite(options.nowSeconds) ? options.nowSeconds : this._nowSeconds();
        const killerIndex = Number.isInteger(options?.killer?.index) ? options.killer.index : -1;

        const targetStats = this._ensureStats(targetIndex);
        targetStats.deaths += 1;
        if (Number(options.spawnAgeSeconds) <= SPAWN_DEATH_WINDOW_SECONDS) targetStats.spawnDeaths += 1;

        if (killerIndex >= 0 && killerIndex !== targetIndex && !areTeammates(options?.killer, targetPlayer)) {
            const killerStats = this._ensureStats(killerIndex);
            killerStats.kills += 1;
            killerStats.points += 2;
        }

        const assistIndices = [];
        const damageHistory = this._damageHistoryByTarget.get(targetIndex);
        if (damageHistory) {
            for (const [attackerIndex, entry] of damageHistory.entries()) {
                if (!Number.isInteger(attackerIndex) || attackerIndex === killerIndex || attackerIndex === targetIndex) {
                    continue;
                }
                const lastHitAt = Number(entry?.lastHitAt) || 0;
                if ((nowSeconds - lastHitAt) > ASSIST_WINDOW_SECONDS) {
                    continue;
                }
                const contribution = Math.max(0, Number(entry?.damage) || 0) + Math.max(0, Number(entry?.shieldDamage) || 0);
                const effectiveHp = Math.max(1, Number(targetPlayer?.maxHp) || 1) + Math.max(0, Number(targetPlayer?.maxShieldHp) || 0);
                if (contribution < Math.max(ASSIST_MIN_DAMAGE, effectiveHp * ASSIST_MIN_EFFECTIVE_HP_RATIO)) continue;
                const assistStats = this._ensureStats(attackerIndex);
                assistStats.assists += 1;
                assistIndices.push(attackerIndex);
            }
        }

        this._damageHistoryByTarget.delete(targetIndex);
        return { killerIndex, assistIndices };
    }

    getScoreboard(players = [], { winCondition = 'kills_time' } = {}) {
        const rows = [];
        for (const player of players) {
            if (!player || player.entitySlotActive === false || !Number.isInteger(player.index)) continue;
            const stats = this._ensureStats(player.index);
            rows.push({
                playerIndex: player.index,
                label: getPlayerLabel(player),
                kills: stats.kills,
                assists: stats.assists,
                deaths: stats.deaths,
                damage: Math.round(stats.damage),
                shieldDamage: Math.round(stats.shieldDamage || 0),
                spawnDeaths: stats.spawnDeaths,
                intercepts: stats.intercepts,
                unitsDestroyed: stats.unitsDestroyed,
                unitDestroyedXp: stats.unitDestroyedXp,
                points: stats.points,
            });
        }

        rows.sort((a, b) => (
            (winCondition === 'score_target' ? b.points - a.points : b.kills - a.kills) ||
            b.kills - a.kills ||
            b.assists - a.assists ||
            b.damage - a.damage ||
            a.playerIndex - b.playerIndex
        ));
        return rows;
    }

    applyScoreboard(rows = []) {
        this._statsByPlayer.clear();
        for (const row of rows) {
            const playerIndex = Number(row?.playerIndex);
            if (!Number.isInteger(playerIndex) || playerIndex < 0) continue;
            this._statsByPlayer.set(playerIndex, {
                kills: Math.max(0, Number(row?.kills) || 0),
                assists: Math.max(0, Number(row?.assists) || 0),
                deaths: Math.max(0, Number(row?.deaths) || 0),
                damage: Math.max(0, Number(row?.damage) || 0),
                shieldDamage: Math.max(0, Number(row?.shieldDamage) || 0),
                spawnDeaths: Math.max(0, Number(row?.spawnDeaths) || 0),
                // A snapshot from a host that predates S2.3 has no field here and reads as 0.
                intercepts: Math.max(0, Number(row?.intercepts) || 0),
                unitsDestroyed: Math.max(0, Number(row?.unitsDestroyed) || 0),
                unitDestroyedXp: Math.max(0, Number(row?.unitDestroyedXp) || 0),
                points: Math.max(0, Number(row?.points) || 0),
            });
        }
    }

    formatSummary(players = [], options = {}) {
        const maxEntries = Math.max(1, Number(options.maxEntries) || 3);
        const scoreboard = Array.isArray(options.rows)
            ? options.rows
            : this.getScoreboard(players);
        const rows = scoreboard.slice(0, maxEntries);
        if (rows.length === 0) return '';
        return rows
            .map((entry) => `${entry.label} K${entry.kills}/T${entry.deaths}/A${entry.assists}`)
            .join(' | ');
    }
}
