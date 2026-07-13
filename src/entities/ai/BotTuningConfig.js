// ============================================
// BotTuningConfig.js - centralized defaults for rule-based bot tuning
// ============================================

import { createPickupBotRuleMap } from '../PickupRegistry.js';

export const BOT_ITEM_RULES = createPickupBotRuleMap();

export const BOT_FALLBACK_DIFFICULTY_PROFILE = Object.freeze({
    reactionTime: 0.15,
    lookAhead: 28,
    aggression: 0.18,
    errorRate: 0,
    probeSpread: 0.9,
    probeStep: 2,
    turnCommitTime: 0.18,
    stuckCheckInterval: 0.4,
    stuckTriggerTime: 1.6,
    minProgressDistance: 0.9,
    minForwardProgress: 0.45,
    recoveryDuration: 1.4,
    recoveryCooldown: 1.0,
    itemUseCooldown: 1.0,
    itemShootCooldown: 0.6,
    targetRefreshInterval: 0.2,
    portalInterest: 0.5,
    portalSeekDistance: 70,
    portalEntryDotMin: 0.3,
    portalIntentThreshold: 0.2,
    portalIntentDuration: 1.0,
    boostChance: 0.001,
    survivalBias: 0.92,
    boostRiskCeiling: 0.2,
    projectileBoostRiskCeiling: 0.28,
    pursuitRiskCeiling: 0.2,
    pursuitSurvivalCeiling: 0.35,
    emergencyForwardRisk: 0.52,
    emergencyPressure: 0.55,
    emergencyBouncePressure: 1.2,
    collisionPressureRecoveryThreshold: 1.5,
    recoveryBoostRiskCeiling: 0.3,
});
