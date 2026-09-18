// The tuning a player-deployed emplacement is built from, read out of the gameplay config and
// clamped to values the rest of the system can live with. Moved out of StaticTurretSystem.js
// unchanged: the system file sits at its line limit, and this is a pure lookup with a single
// caller, so it costs nothing to read it here.

import { resolveGameplayConfig } from '../../../shared/contracts/GameplayConfigContract.js';

function clampFinite(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {object | null} entityManager
 * @param {'mg' | 'rocket'} weapon
 * @returns {object} Ready-to-use numbers for one deployment.
 */
export function resolveStaticTurretDeployConfig(entityManager, weapon = 'mg') {
    const rocket = weapon === 'rocket';
    const config = resolveGameplayConfig(entityManager).HUNT?.[rocket ? 'ROCKET_TURRET' : 'MG_TURRET'] || {};
    return {
        range: clampFinite(config.RANGE, rocket ? 90 : 58, 8, 120),
        cooldown: clampFinite(config.COOLDOWN, rocket ? 3.4 : 0.24, 0.1, rocket ? 12 : 2),
        damage: clampFinite(config.DAMAGE, 3, 1, 20),
        duration: clampFinite(config.DURATION_SECONDS, 20, 3, 60),
        maxHp: clampFinite(config.MAX_HP, 45, 10, 200),
        hitboxRadius: clampFinite(config.HIT_RADIUS, 2.2, 1, 5),
        maxPerOwner: Math.round(clampFinite(config.MAX_PER_OWNER, 1, 1, 4)),
        deployOffset: clampFinite(config.DEPLOY_OFFSET, 3.2, 0, 8),
        targetHoldSeconds: clampFinite(config.TARGET_HOLD_SECONDS, 0.3, 0, 2),
        targetReacquireSeconds: clampFinite(config.TARGET_REACQUIRE_SECONDS, 0.12, 0.03, 1),
        losSampleStep: clampFinite(config.LOS_SAMPLE_STEP, 0.5, 0.2, 2),
        acquireDelaySeconds: clampFinite(config.ACQUIRE_DELAY_SECONDS, 0.22, 0, 2),
        turnRateRadians: clampFinite(config.TURN_RATE_RADIANS_PER_SECOND, 8, 0.5, 30),
        fireDotMin: clampFinite(config.FIRE_DOT_MIN, 0.985, 0.8, 1),
        audioRange: clampFinite(config.AUDIO_RANGE, 80, 10, 200),
    };
}
