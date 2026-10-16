import { applyCappedHealing } from '../../hunt/HealthSystem.js';

/** Called once after the normal stat reset of each real spawn; a session rebind does not call it. */
export function applyHuntParcoursRivalSpawnBonuses(player) {
    if (player?.huntParcoursRival !== true || !player.huntParcoursRivalModifiers) return;
    const mods = player.huntParcoursRivalModifiers;
    player.maxHp = Math.max(1, Math.round((Number(player.maxHp) || 100) * mods.healthMultiplier));
    applyCappedHealing(player, player.maxHp, player.maxHp);
    // Hunt bots without a loadout retain baseSpeed at spawn; anchor the pre-rival value once.
    if (!Number.isFinite(player.huntParcoursBaseSpeed)) player.huntParcoursBaseSpeed = Number(player.baseSpeed) || 1;
    player.baseSpeed = player.huntParcoursBaseSpeed * mods.speedMultiplier;
    player.speed = player.baseSpeed;
    if (!Number.isFinite(player.huntParcoursBaseTurnSpeed)) player.huntParcoursBaseTurnSpeed = Number(player.turnSpeed) || 1;
    player.turnSpeed = player.huntParcoursBaseTurnSpeed * mods.turnMultiplier;
    player.maxShieldHp = Math.max(0, Number(player.maxShieldHp) || 0) + mods.shieldBonus;
    player.shieldHP = Math.max(0, Number(player.shieldHP) || 0) + mods.shieldBonus;
    player.hasShield = player.shieldHP > 0;
}

/** A Nemesis sharpshooter tightens its fire cone without changing other bot profiles. */
export function shouldHuntParcoursRivalFireAtTarget(player, target, forward, baseAimDot) {
    if (player?.huntParcoursRival !== true || !target?.position || !player?.position || !forward) return true;
    const spread = Number(player.huntParcoursRivalModifiers?.aimSpreadMultiplier);
    if (!Number.isFinite(spread) || spread >= 1) return true;
    const normalizedSpread = Math.max(0, Math.min(1, spread));
    const aimDot = Math.max(0, Math.min(1, Number(baseAimDot) || 0));
    const dx = Number(target.position.x) - Number(player.position.x);
    const dy = Number(target.position.y) - Number(player.position.y);
    const dz = Number(target.position.z) - Number(player.position.z);
    const distance = Math.hypot(dx, dy, dz);
    const forwardLength = Math.hypot(Number(forward.x), Number(forward.y), Number(forward.z));
    if (!(distance > 1e-6) || !(forwardLength > 1e-6)) return true;
    const alignment = (
        (dx / distance) * (Number(forward.x) / forwardLength)
        + (dy / distance) * (Number(forward.y) / forwardLength)
        + (dz / distance) * (Number(forward.z) / forwardLength)
    );
    const requiredAlignment = 1 - ((1 - aimDot) * normalizedSpread);
    return alignment >= requiredAlignment;
}
