function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value, fallback = 0) {
    return Math.trunc(number(value, fallback));
}

export function createEscortObjectiveProjection(value = null) {
    if (!value || typeof value !== 'object' || value.active !== true) return null;
    const phase = ['MOVING', 'DOWNED', 'RECOVERING', 'GOAL', 'DESTROYED'].includes(value.phase)
        ? value.phase : 'MOVING';
    const maxHp = Math.max(1, number(value.maxHp, 1));
    const hp = Math.max(0, Math.min(maxHp, number(value.hp, 0)));
    return {
        active: true,
        tankId: String(value.tankId || 'escort_tank'),
        phase,
        hp,
        maxHp,
        hpRatio: Math.max(0, Math.min(1, number(value.hpRatio, hp / maxHp))),
        progress: Math.max(0, Math.min(1, number(value.progress, 0))),
        distance: Math.max(0, number(value.distance, 0)),
        totalDistance: Math.max(0, number(value.totalDistance, 0)),
        checkpointIndex: Math.max(-1, int(value.checkpointIndex, -1)),
        checkpointsReached: Math.max(0, int(value.checkpointsReached, 0)),
        checkpointCount: Math.max(0, int(value.checkpointCount, 0)),
        recoveryCharges: Math.max(0, int(value.recoveryCharges, 0)),
        downedRemainingSeconds: Math.max(0, number(value.downedRemainingSeconds, 0)),
        repairProgress: Math.max(0, Math.min(1, number(value.repairProgress, 0))),
        protectionRemainingSeconds: Math.max(0, number(value.protectionRemainingSeconds, 0)),
        speed: Math.max(0, number(value.speed, 0)),
        position: {
            x: number(value.position?.x, 0),
            y: number(value.position?.y, 0),
            z: number(value.position?.z, 0),
        },
        reachedGoal: value.reachedGoal === true,
    };
}
