export function resolveWorldAudioOptions(players, position, options = {}) {
    if (!position) return options;

    let nearestDistance = Infinity;
    for (const player of players || []) {
        if (!player || player.isBot === true || !player.position) continue;
        const dx = (Number(position.x) || 0) - (Number(player.position.x) || 0);
        const dy = (Number(position.y) || 0) - (Number(player.position.y) || 0);
        const dz = (Number(position.z) || 0) - (Number(player.position.z) || 0);
        nearestDistance = Math.min(nearestDistance, Math.hypot(dx, dy, dz));
    }

    return Number.isFinite(nearestDistance)
        ? { ...options, distance: nearestDistance }
        : options;
}
