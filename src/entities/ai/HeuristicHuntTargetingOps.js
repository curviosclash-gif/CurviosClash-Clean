import {
    resolveHealthRatio,
    resolveShieldRatio,
} from '../../hunt/HuntBotPolicy.js';
import { clamp } from '../../shared/utils/MathOps.js';

const NEUTRAL_TACTIC_BIAS = 0.5;

export function resolveOpportunisticEnemy(policy, player, players, fallbackEnemy) {
    const enabled = Number(policy?.profile?.opportunistBias) > NEUTRAL_TACTIC_BIAS
        || Number(policy?.profile?.openingFanoutBias) > NEUTRAL_TACTIC_BIAS;
    if (!enabled || !player?.position) return fallbackEnemy;
    let selected = fallbackEnemy;
    let selectedScore = Infinity;
    for (const other of players) {
        if (!other || other === player || other.alive === false || !other.position) continue;
        const health = resolveHealthRatio(other);
        const shield = resolveShieldRatio(other);
        const vitality = clamp(health * 0.72 + shield * 0.28, 0, 1);
        if (vitality > 0.5 && other !== fallbackEnemy) continue;
        const dx = Number(other.position.x) - Number(player.position.x);
        const dy = Number(other.position.y) - Number(player.position.y);
        const dz = Number(other.position.z) - Number(player.position.z);
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (!Number.isFinite(distanceSq) || distanceSq > 100 * 100) continue;
        const score = distanceSq * (0.18 + vitality);
        if (score < selectedScore) {
            selected = other;
            selectedScore = score;
        }
    }
    return selected;
}
