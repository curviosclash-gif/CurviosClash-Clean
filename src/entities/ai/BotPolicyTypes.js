// ============================================
// BotPolicyTypes.js - shared bot policy contracts and identifiers
// ============================================

export const BOT_POLICY_TYPES = Object.freeze({
    RULE_BASED: 'rule-based',
    HEURISTIC: 'heuristic',
    HUNT: 'hunt',
    CLASSIC_BRIDGE: 'classic-bridge',
    HUNT_BRIDGE: 'hunt-bridge',
    CLASSIC_3D: 'classic-3d',
    CLASSIC_2D: 'classic-2d',
    HUNT_3D: 'hunt-3d',
    HUNT_2D: 'hunt-2d',
});

export const DEFAULT_BOT_POLICY_TYPE = BOT_POLICY_TYPES.RULE_BASED;
const OPTIONAL_BOT_POLICY_METHODS = Object.freeze(['getObservation', 'reset']);
const MATCH_BOT_POLICY_TYPE_SET = new Set([
    BOT_POLICY_TYPES.CLASSIC_3D,
    BOT_POLICY_TYPES.CLASSIC_2D,
    BOT_POLICY_TYPES.HUNT_3D,
    BOT_POLICY_TYPES.HUNT_2D,
]);
const BRIDGE_POLICY_TYPE_SET = new Set([
    BOT_POLICY_TYPES.CLASSIC_BRIDGE,
    BOT_POLICY_TYPES.HUNT_BRIDGE,
    BOT_POLICY_TYPES.CLASSIC_3D,
    BOT_POLICY_TYPES.CLASSIC_2D,
    BOT_POLICY_TYPES.HUNT_3D,
    BOT_POLICY_TYPES.HUNT_2D,
]);
const BOT_POLICY_TYPE_ALIASES = Object.freeze({
    bridge: BOT_POLICY_TYPES.CLASSIC_BRIDGE,
    heuristics: BOT_POLICY_TYPES.HEURISTIC,
    'pure-heuristic': BOT_POLICY_TYPES.HEURISTIC,
    normal: BOT_POLICY_TYPES.CLASSIC_3D,
    classic: BOT_POLICY_TYPES.CLASSIC_3D,
    fight: BOT_POLICY_TYPES.HUNT_3D,
    hunt3d: BOT_POLICY_TYPES.HUNT_3D,
    hunt2d: BOT_POLICY_TYPES.HUNT_2D,
    classic3d: BOT_POLICY_TYPES.CLASSIC_3D,
    classic2d: BOT_POLICY_TYPES.CLASSIC_2D,
});

export function normalizeBotPolicyType(type) {
    const raw = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!raw) return DEFAULT_BOT_POLICY_TYPE;
    return BOT_POLICY_TYPE_ALIASES[raw] || raw;
}

export function resolveMatchBotPolicyType({ huntModeActive = false, planarMode = false } = {}) {
    if (huntModeActive) {
        return planarMode ? BOT_POLICY_TYPES.HUNT_2D : BOT_POLICY_TYPES.HUNT_3D;
    }
    return planarMode ? BOT_POLICY_TYPES.CLASSIC_2D : BOT_POLICY_TYPES.CLASSIC_3D;
}

export function isMatchBotPolicyType(type) {
    const normalized = normalizeBotPolicyType(type);
    return MATCH_BOT_POLICY_TYPE_SET.has(normalized);
}

export function isBridgeBotPolicyType(type) {
    const normalized = normalizeBotPolicyType(type);
    return BRIDGE_POLICY_TYPE_SET.has(normalized);
}

export function assertBotPolicyContract(policy, type = DEFAULT_BOT_POLICY_TYPE) {
    if (!policy || typeof policy.update !== 'function') {
        throw new Error(`[BotPolicyRegistry] Invalid bot policy "${type}": missing update(dt, player, context|arena, allPlayers, projectiles)`);
    }
    for (let i = 0; i < OPTIONAL_BOT_POLICY_METHODS.length; i++) {
        const methodName = OPTIONAL_BOT_POLICY_METHODS[i];
        const member = policy[methodName];
        if (member != null && typeof member !== 'function') {
            throw new Error(`[BotPolicyRegistry] Invalid bot policy "${type}": optional "${methodName}" must be a function`);
        }
    }
    return policy;
}
