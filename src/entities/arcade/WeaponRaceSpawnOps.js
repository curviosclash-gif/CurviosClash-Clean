const LANE_ORDER = Object.freeze([0, -1, 1, -2, 2]);

export function resolveWeaponRaceGridSpawn(route, player, racerIndex = 0) {
    const start = route?.checkpoints?.find?.((entry) => entry?.routeIndex === 0) || route?.checkpoints?.[0];
    const position = player?.position?.clone?.();
    const direction = player?.position?.clone?.();
    if (!start?.pos || !position?.set || !direction?.set) return null;
    const forward = Array.isArray(start.forward) ? start.forward : [1, 0, 0];
    const lane = LANE_ORDER[Math.max(0, Math.trunc(Number(racerIndex) || 0)) % LANE_ORDER.length] * 4;
    position.set(
        start.pos[0] - forward[0] * 11 - forward[2] * lane,
        start.pos[1],
        start.pos[2] - forward[2] * 11 + forward[0] * lane
    );
    direction.set(forward[0], forward[1], forward[2]);
    return { position, direction };
}
