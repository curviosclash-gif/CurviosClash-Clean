import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { HUNT_CONFIG } from './HuntConfig.js';

/**
 * Bots open fire on tanks and destructible turrets (S5.11). A bot does not hunt them: it keeps
 * chasing players, but when no player shot is lined up and a target from the registry sits in front
 * of its nose inside machine gun range, it pulls the trigger. The machine gun aim help already knows
 * the registry, so the burst lands on the target.
 *
 * Its own deployed turrets are never a target. A lit flamethrower owns the fire key (E79), so a bot
 * carrying one leaves this to the flamethrower tactics.
 */
export function applyBotMapUnitFire(policy, input, player, runtimeContext) {
    if (input.shootMG === true || player?.hasFlamethrower === true || !player?.position) return false;
    const targets = runtimeContext?.entityManager?._targetableRegistry?.collect?.();
    if (!Array.isArray(targets) || targets.length === 0) return false;
    const mg = resolveGameplayConfig(player).HUNT?.MG || HUNT_CONFIG.MG;
    const range = Math.max(10, Number(mg?.RANGE) || 95);
    const aimDotMin = Math.max(0, Math.min(1, Number(mg?.AIM_DOT_MIN) || 0.965));
    // The flamethrower scratch vectors: every bot policy has them, and this runs after it.
    const aim = player.getAimDirection?.(policy._tmpFlameAim);
    if (!aim || aim.lengthSq() <= 0.000001) return false;
    aim.normalize();
    const toTarget = policy._tmpFlameOffset;
    for (const target of targets) {
        if (!target?.position || !(Number(target.hp) > 0)) continue;
        if (target.ownerPlayer === player || (Number.isInteger(player.index) && target.ownerIndex === player.index)) continue;
        toTarget.subVectors(target.position, player.position);
        const distance = toTarget.length();
        if (distance <= 0.001 || distance > range) continue;
        if (toTarget.dot(aim) / distance < aimDotMin) continue;
        input.shootMG = true;
        return true;
    }
    return false;
}
