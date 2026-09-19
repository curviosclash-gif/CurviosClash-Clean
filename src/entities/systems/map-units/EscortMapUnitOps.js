import { normalizeMapUnit } from '../../../shared/contracts/MapUnitContract.js';
import {
    ESCORT_DEFAULTS,
    resolveEscortOutcome,
    resolveEscortTankSpeed,
} from '../../../shared/contracts/EscortObjectiveContract.js';
import { TEAM_IDS } from '../../../shared/contracts/TeamCombatContract.js';

function readBound(bounds, direct, nested, fallback) {
    const value = Number(bounds?.[direct] ?? bounds?.[nested?.[0]]?.[nested?.[1]]);
    return Number.isFinite(value) ? value : fallback;
}

export function createEscortTankDefinition(bounds) {
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
    const crossings = Math.max(2, Math.min(12, Math.round((ESCORT_DEFAULTS.baseSpeed * ESCORT_DEFAULTS.pathSeconds - depth) / width)));
    const path = [];
    for (let row = 0; row <= crossings; row += 1) {
        const z = startZ + depth * (row / crossings);
        path.push([row % 2 === 0 ? left : right, y, z]);
    }
    return normalizeMapUnit({
        id: 'escort_tank', kind: 'tank', path, loop: false,
        speed: ESCORT_DEFAULTS.baseSpeed, maxHp: ESCORT_DEFAULTS.tankMaxHp,
        respawnSeconds: 0, weapons: { mg: false, rocket: false }, allowedModes: ['ESCORT'],
    }, 0, undefined, { preserveSpatial: true });
}

export function bindEscortTank(unit) {
    unit.escortTank = true;
    unit.teamId = TEAM_IDS.ALPHA;
    unit.escortReachedGoal = false;
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

export function resolveEscortMapUnitOutcome(unit, elapsedSeconds, players = []) {
    if (!unit) return null;
    const result = resolveEscortOutcome({
        tankAlive: unit.alive === true,
        reachedGoal: unit.escortReachedGoal === true,
        elapsedSeconds,
    });
    if (!result) return { shouldEnd: false, winner: null, reason: '' };
    return {
        ...result,
        winner: players.find((player) => player?.teamId === result.winnerTeamId) || null,
    };
}
