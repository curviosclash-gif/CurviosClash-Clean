import { getPickupDefinition } from '../PickupRegistry.js';

export const EMP_PULSE_DEFAULT_RADIUS = 20;
const EMP_PULSE_DISTANCE_EPSILON = 0.000001;

export function resolveEmpPulseRadius() {
    const radius = Number(getPickupDefinition('EMP')?.pulseRadius);
    return Number.isFinite(radius) && radius > 0 ? radius : EMP_PULSE_DEFAULT_RADIUS;
}

// One-shot area pulse evaluated at activation: every other living player inside the
// radius (inclusive) receives the EMP effect. It is spherical in 3D and circular in the
// planar mode, ignores obstacles and never touches the activating player.
export function applyEmpPulse({
    owner = null,
    players = [],
    planar = false,
    radius = resolveEmpPulseRadius(),
} = {}) {
    if (!owner?.position || !Array.isArray(players)) return 0;
    const radiusSq = radius * radius + EMP_PULSE_DISTANCE_EPSILON;
    const sourcePlayerIndex = Number.isInteger(owner.index) ? owner.index : null;
    let hits = 0;
    for (let i = 0; i < players.length; i += 1) {
        const target = players[i];
        if (!target || target === owner || target.alive === false || !target.position) continue;
        const dx = target.position.x - owner.position.x;
        const dy = planar ? 0 : target.position.y - owner.position.y;
        const dz = target.position.z - owner.position.z;
        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
        target.applyPowerup?.('EMP', { sourcePlayerIndex });
        hits += 1;
    }
    return hits;
}
