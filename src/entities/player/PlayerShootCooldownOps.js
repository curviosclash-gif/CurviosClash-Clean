/** Preserve the part of the tick after an Arcade MG becomes ready. */
export function advanceShootCooldown(player, ownerDt) {
    const previous = Math.max(0, Number(player?.shootCooldown) || 0);
    const dt = Math.max(0, Number(ownerDt) || 0);
    player.shootCooldown = Math.max(0, previous - dt);
    player.shootCooldownCarry = previous > 0 ? Math.max(0, dt - previous) : 0;
    // A ready tick without firing breaks a burst. This method runs before the
    // action phase, so a cooldown that only just expired keeps its shot count.
    if (previous <= 0 && player.arcadeBurstShots) player.arcadeBurstShots = 0;
}
