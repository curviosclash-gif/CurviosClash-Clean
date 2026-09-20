import { normalizeMapUnit } from '../../../shared/contracts/MapUnitContract.js';
import {
    ESCORT_DEFAULTS,
    ESCORT_PHASES,
    ESCORT_RECOVERY_DEFAULTS,
    createEscortPathMetrics,
    resolveEscortCheckpointPathIndices,
    resolveEscortOutcome,
    resolveEscortPathProgress,
    resolveEscortTankSpeed,
} from '../../../shared/contracts/EscortObjectiveContract.js';
import { TEAM_IDS } from '../../../shared/contracts/TeamCombatContract.js';

function readBound(bounds, direct, nested, fallback) {
    const value = Number(bounds?.[direct] ?? bounds?.[nested?.[0]]?.[nested?.[1]]);
    return Number.isFinite(value) ? value : fallback;
}

export function createEscortTankDefinition(bounds, authoredDefinition = null) {
    const minX = readBound(bounds, 'minX', ['min', 'x'], -100);
    const maxX = readBound(bounds, 'maxX', ['max', 'x'], 100);
    const minZ = readBound(bounds, 'minZ', ['min', 'z'], -100);
    const maxZ = readBound(bounds, 'maxZ', ['max', 'z'], 100);
    const y = readBound(bounds, 'minY', ['min', 'y'], 0);
    const left = minX + (maxX - minX) * 0.1;
    const right = maxX - (maxX - minX) * 0.1;
    const startZ = minZ + (maxZ - minZ) * 0.1;
    const endZ = maxZ - (maxZ - minZ) * 0.1;
    const width = Math.max(1, right - left);
    const depth = Math.max(1, endZ - startZ);
    let path = authoredDefinition?.escortObjective && Array.isArray(authoredDefinition.path)
        ? authoredDefinition.path.map((point) => [...point])
        : null;
    if (!path) {
        const crossings = Math.max(2, Math.min(12, Math.round((ESCORT_DEFAULTS.baseSpeed * ESCORT_DEFAULTS.pathSeconds - depth) / width)));
        path = [];
        for (let row = 0; row <= crossings; row += 1) {
            const z = startZ + depth * (row / crossings);
            path.push([row % 2 === 0 ? left : right, y, z]);
        }
    }
    return normalizeMapUnit({
        id: 'escort_tank', kind: 'tank', path, loop: false,
        speed: ESCORT_DEFAULTS.baseSpeed, maxHp: ESCORT_DEFAULTS.tankMaxHp,
        respawnSeconds: 0, weapons: { mg: false, rocket: false }, allowedModes: ['ESCORT'],
        escortObjective: {
            checkpointPathIndices: authoredDefinition?.escortObjective?.checkpointPathIndices || [],
        },
    }, 0, undefined, { preserveSpatial: true });
}

export function bindEscortTank(unit) {
    unit.escortTank = true;
    unit.teamId = TEAM_IDS.ALPHA;
    unit.escortReachedGoal = false;
    unit.escortPhase = ESCORT_PHASES.MOVING;
    unit.escortPathMetrics = createEscortPathMetrics(unit.path);
    unit.escortCheckpointPathIndices = resolveEscortCheckpointPathIndices(
        unit.path,
        unit.definition?.escortObjective?.checkpointPathIndices,
    );
    unit.escortCheckpointIndex = -1;
    unit.escortRecoveryCharges = ESCORT_RECOVERY_DEFAULTS.maxRecoveryCharges;
    unit.escortDownedRemaining = 0;
    unit.escortRepairProgress = 0;
    unit.escortProtectionRemaining = 0;
    unit.escortLastDamageSource = null;
    unit.escortDownCredited = false;
    unit.escortObjectiveState = {};
    if (unit.source) unit.source.teamId = TEAM_IDS.ALPHA;
    return unit;
}

export function updateEscortTankSpeed(unit, players = []) {
    const radiusSq = ESCORT_DEFAULTS.escortRadius ** 2;
    let escorted = false;
    for (const player of players) {
        if (player?.alive !== true || player.teamId !== TEAM_IDS.ALPHA || !player.position) continue;
        if (player.position.distanceToSquared(unit.position) <= radiusSq) { escorted = true; break; }
    }
    unit.speed = resolveEscortTankSpeed(escorted) * unit.scale;
    return unit.speed;
}

function isAliveAlphaNear(unit, player) {
    return player?.alive === true
        && player.teamId === TEAM_IDS.ALPHA
        && !!player.position
        && player.position.distanceToSquared(unit.position) <= ESCORT_DEFAULTS.escortRadius ** 2;
}

export function updateEscortRecovery(unit, players = [], dt = 0) {
    const safeDt = Math.max(0, Number(dt) || 0);
    unit.escortProtectionRemaining = Math.max(0, (Number(unit.escortProtectionRemaining) || 0) - safeDt);
    if (unit.escortPhase !== ESCORT_PHASES.DOWNED && unit.escortPhase !== ESCORT_PHASES.RECOVERING) {
        return { recovered: false, destroyed: false, repairingPlayer: null, repairHp: 0 };
    }

    const repairingPlayer = players.find((player) => isAliveAlphaNear(unit, player)) || null;
    unit.escortPhase = repairingPlayer ? ESCORT_PHASES.RECOVERING : ESCORT_PHASES.DOWNED;
    unit.escortDownedRemaining = Math.max(0, (Number(unit.escortDownedRemaining) || 0) - safeDt);
    const previousProgress = Math.max(0, Math.min(1, Number(unit.escortRepairProgress) || 0));
    if (repairingPlayer) {
        unit.escortRepairProgress = Math.min(
            1,
            (Number(unit.escortRepairProgress) || 0) + safeDt / ESCORT_RECOVERY_DEFAULTS.repairSeconds,
        );
    }
    const repairHp = Math.max(0, unit.escortRepairProgress - previousProgress)
        * unit.maxHp * ESCORT_RECOVERY_DEFAULTS.reviveHpRatio;
    if (unit.escortRepairProgress >= 1) {
        unit.hp = Math.max(1, unit.maxHp * ESCORT_RECOVERY_DEFAULTS.reviveHpRatio);
        unit.alive = true;
        unit.escortPhase = ESCORT_PHASES.MOVING;
        unit.escortRepairProgress = 0;
        unit.escortDownedRemaining = 0;
        unit.escortProtectionRemaining = ESCORT_RECOVERY_DEFAULTS.reviveProtectionSeconds;
        unit.escortDownCredited = false;
        return { recovered: true, destroyed: false, repairingPlayer, repairHp };
    }
    return {
        recovered: false,
        destroyed: unit.escortDownedRemaining <= 0,
        repairingPlayer,
        repairHp,
    };
}

export function updateEscortCheckpoints(unit) {
    const indices = unit.escortCheckpointPathIndices || [];
    let reached = null;
    while (
        unit.escortCheckpointIndex + 1 < indices.length
        && unit.fromIndex >= indices[unit.escortCheckpointIndex + 1]
    ) {
        unit.escortCheckpointIndex += 1;
        reached = unit.escortCheckpointIndex;
    }
    if (reached === null) return null;
    unit.hp = Math.min(
        unit.maxHp,
        unit.hp + unit.maxHp * ESCORT_RECOVERY_DEFAULTS.checkpointRepairRatio,
    );
    unit.escortRecoveryCharges = ESCORT_RECOVERY_DEFAULTS.maxRecoveryCharges;
    return reached;
}

export function createEscortObjectiveState(unit, target = null) {
    if (!unit) return null;
    const state = target || {};
    const progress = resolveEscortPathProgress(unit, unit.escortPathMetrics);
    const checkpointCount = unit.escortCheckpointPathIndices?.length || 0;
    state.active = true;
    state.tankId = unit.id;
    state.phase = unit.escortPhase || (unit.alive ? ESCORT_PHASES.MOVING : ESCORT_PHASES.DESTROYED);
    state.hp = Math.max(0, Number(unit.hp) || 0);
    state.maxHp = Math.max(1, Number(unit.maxHp) || 1);
    state.hpRatio = state.hp / state.maxHp;
    state.progress = progress.ratio;
    state.distance = progress.distance;
    state.totalDistance = progress.totalDistance;
    const checkpointIndex = Number(unit.escortCheckpointIndex);
    state.checkpointIndex = Number.isFinite(checkpointIndex) ? Math.max(-1, Math.trunc(checkpointIndex)) : -1;
    state.checkpointsReached = state.checkpointIndex + 1;
    state.checkpointCount = checkpointCount;
    state.recoveryCharges = Math.max(0, Number(unit.escortRecoveryCharges) || 0);
    state.downedRemainingSeconds = Math.max(0, Number(unit.escortDownedRemaining) || 0);
    state.repairProgress = Math.max(0, Math.min(1, Number(unit.escortRepairProgress) || 0));
    state.protectionRemainingSeconds = Math.max(0, Number(unit.escortProtectionRemaining) || 0);
    state.speed = Math.max(0, Number(unit.speed) || 0);
    state.position = unit.position;
    state.reachedGoal = unit.escortReachedGoal === true;
    return state;
}

export function resolveEscortMapUnitOutcome(unit, elapsedSeconds, players = []) {
    if (!unit) return null;
    const result = resolveEscortOutcome({
        tankAlive: unit.alive === true,
        reachedGoal: unit.escortReachedGoal === true,
        elapsedSeconds,
        phase: unit.escortPhase,
    });
    if (!result) return { shouldEnd: false, winner: null, reason: '' };
    return {
        ...result,
        winner: players.find((player) => player?.teamId === result.winnerTeamId) || null,
    };
}
