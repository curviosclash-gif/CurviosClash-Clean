import { TEAM_IDS } from '../../../src/shared/contracts/TeamCombatContract.js';

function finite(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function mean(values) {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function distance(first, second) {
    if (!first || !second) return Infinity;
    const dx = finite(first.x) - finite(second.x);
    const dy = finite(first.y) - finite(second.y);
    const dz = finite(first.z) - finite(second.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function arenaDiagonal(entityManager) {
    const bounds = entityManager?.arena?.bounds;
    const min = bounds?.min || {};
    const max = bounds?.max || {};
    const width = finite(bounds?.maxX, finite(max.x, 100)) - finite(bounds?.minX, finite(min.x, -100));
    const height = finite(bounds?.maxY, finite(max.y, 80)) - finite(bounds?.minY, finite(min.y, 0));
    const depth = finite(bounds?.maxZ, finite(max.z, 100)) - finite(bounds?.minZ, finite(min.z, -100));
    return Math.max(1, Math.sqrt(width * width + height * height + depth * depth));
}

function sumRows(rows, key) {
    return rows.reduce((sum, row) => sum + Math.max(0, finite(row?.[key])), 0);
}

function flagOriginTeam(flag) {
    const id = String(flag?.id || '').toLowerCase();
    if (id.startsWith('alpha_')) return TEAM_IDS.ALPHA;
    if (id.startsWith('bravo_')) return TEAM_IDS.BRAVO;
    return null;
}

function flagAttackProgress(flags, teamId) {
    const enemyTeam = teamId === TEAM_IDS.ALPHA ? TEAM_IDS.BRAVO : TEAM_IDS.ALPHA;
    const enemyFlags = flags.filter((flag) => flagOriginTeam(flag) === enemyTeam);
    return mean(enemyFlags.map((flag) => {
        if (flag?.teamId === teamId) return 1;
        const maxHp = Math.max(1, finite(flag?.maxHp, 1));
        return Math.max(0, Math.min(1, 1 - finite(flag?.hp, maxHp) / maxHp));
    }));
}

function resolveFlagTarget(player, flags) {
    const targetId = String(player?.flagBotTargetId || '');
    if (targetId) {
        const assigned = flags.find((flag) => String(flag?.id || '') === targetId);
        if (assigned?.position) return assigned.position;
    }
    let best = null;
    let bestDistance = Infinity;
    for (const flag of flags) {
        if (!flag?.position) continue;
        const candidateDistance = distance(player?.position, flag.position);
        if (candidateDistance < bestDistance) {
            best = flag.position;
            bestDistance = candidateDistance;
        }
    }
    return best;
}

export function createTeamObjectiveMatchTracker({ teamId, objective }) {
    const normalizedTeamId = teamId === TEAM_IDS.BRAVO ? TEAM_IDS.BRAVO : TEAM_IDS.ALPHA;
    const normalizedObjective = String(objective || '').trim().toUpperCase();
    let botSamples = 0;
    let assignedSamples = 0;
    let proximityTotal = 0;

    return {
        sample(entityManager) {
            const bots = (entityManager?.bots || [])
                .map((entry) => entry?.player)
                .filter((player) => player?.teamId === normalizedTeamId && player?.alive === true);
            const flags = entityManager?._flagObjectiveSystem?.flags || [];
            const escortTank = entityManager?._mapUnitSystem?.units
                ?.find?.((unit) => unit?.escortTank === true) || null;
            const diagonal = arenaDiagonal(entityManager);
            for (const player of bots) {
                botSamples += 1;
                const role = normalizedObjective === 'FLAGS' ? player.flagBotRole : player.escortBotRole;
                const target = normalizedObjective === 'FLAGS'
                    ? resolveFlagTarget(player, flags)
                    : escortTank?.position;
                if (role && target) assignedSamples += 1;
                if (target) proximityTotal += 1 - Math.min(1, distance(player.position, target) / diagonal);
            }
        },
        summarize(entityManager, durationSeconds) {
            const playerIndices = new Set((entityManager?.players || [])
                .filter((player) => player?.teamId === normalizedTeamId && player?.isBot === true)
                .map((player) => player.index));
            const rows = (entityManager?.getHuntScoreboard?.() || [])
                .filter((row) => playerIndices.has(row?.playerIndex));
            const assignmentRate = botSamples > 0 ? assignedSamples / botSamples : 0;
            const proximityRate = botSamples > 0 ? proximityTotal / botSamples : 0;
            const deaths = sumRows(rows, 'deaths');
            const kills = sumRows(rows, 'kills');
            const commonScore = assignmentRate * 20 + proximityRate * 30 + kills * 2 - deaths * 0.5;

            if (normalizedObjective === 'FLAGS') {
                const flags = entityManager?._flagObjectiveSystem?.flags || [];
                const attackProgress = flagAttackProgress(flags, normalizedTeamId);
                const captures = sumRows(rows, 'flagCaptures');
                return {
                    objective: normalizedObjective,
                    teamId: normalizedTeamId,
                    score: commonScore + attackProgress * 100 + captures * 80,
                    assignmentRate,
                    proximityRate,
                    attackProgress,
                    captures,
                    deaths,
                };
            }

            const state = entityManager?._mapUnitSystem?.getEscortObjectiveState?.() || {};
            const progress = Math.max(0, Math.min(1, finite(state.progress)));
            const maxHp = Math.max(1, finite(state.maxHp, 1));
            const botCount = Math.max(1, playerIndices.size);
            if (normalizedTeamId === TEAM_IDS.ALPHA) {
                const escortShare = Math.min(1, sumRows(rows, 'escortSeconds')
                    / Math.max(1, finite(durationSeconds) * botCount));
                const checkpoints = sumRows(rows, 'escortCheckpointContributions');
                const repairs = sumRows(rows, 'escortRepairHp');
                const guardKills = sumRows(rows, 'escortGuardKills');
                return {
                    objective: normalizedObjective,
                    teamId: normalizedTeamId,
                    score: commonScore + progress * 120 + escortShare * 80
                        + checkpoints * 30 + repairs / 10 + guardKills * 4,
                    assignmentRate,
                    proximityRate,
                    progress,
                    escortShare,
                    checkpoints,
                    deaths,
                };
            }

            const tankDamage = sumRows(rows, 'escortTankDamage');
            const tankDowns = sumRows(rows, 'escortTankDowns');
            const finalDestructions = sumRows(rows, 'escortFinalDestructions');
            const attackKills = sumRows(rows, 'escortAttackKills');
            return {
                objective: normalizedObjective,
                teamId: normalizedTeamId,
                score: commonScore + tankDamage / maxHp * 120 + tankDowns * 60
                    + finalDestructions * 120 + attackKills * 4,
                assignmentRate,
                proximityRate,
                tankDamage,
                tankDowns,
                finalDestructions,
                progress,
                deaths,
            };
        },
    };
}

export function combineTeamObjectiveResults(results = []) {
    const valid = results.filter((result) => Number.isFinite(Number(result?.score)));
    const objectives = {};
    for (const objective of ['FLAGS', 'ESCORT']) {
        const matching = valid.filter((result) => result.objective === objective);
        objectives[objective] = {
            score: mean(matching.map((result) => Number(result.score))),
            assignmentRate: mean(matching.map((result) => Number(result.assignmentRate))),
            proximityRate: mean(matching.map((result) => Number(result.proximityRate))),
        };
    }
    return {
        score: mean(valid.map((result) => Number(result.score))),
        assignmentRate: mean(valid.map((result) => Number(result.assignmentRate))),
        proximityRate: mean(valid.map((result) => Number(result.proximityRate))),
        objectives,
        matches: valid.length,
    };
}

export function isTeamObjectiveCandidateBetter(candidate, current, {
    minimumGain = 0,
    objectiveRetention = 0.98,
    assignmentRetention = 0.95,
} = {}) {
    if (!candidate || !current || candidate.score <= current.score + minimumGain) return false;
    if (candidate.assignmentRate + 1e-9 < current.assignmentRate * assignmentRetention) return false;
    for (const objective of ['FLAGS', 'ESCORT']) {
        const candidateScore = Number(candidate.objectives?.[objective]?.score);
        const currentScore = Number(current.objectives?.[objective]?.score);
        if (!Number.isFinite(candidateScore) || !Number.isFinite(currentScore)) return false;
        if (candidateScore + 1e-9 < currentScore * objectiveRetention) return false;
    }
    return true;
}
