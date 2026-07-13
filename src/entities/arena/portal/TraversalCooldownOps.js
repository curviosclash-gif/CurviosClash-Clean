/**
 * TraversalCooldownOps — shared cooldown resolution for Portal and Gate traversal.
 *
 * Extracted from PortalRuntimeSystem and SpecialGateRuntime to eliminate duplication.
 * Both systems use identical entity-key normalization and cooldown lookup logic.
 */

/**
 * Normalizes an entity ID to a consistent string key for cooldown map lookups.
 * Returns '' for null/undefined inputs.
 */
export function normalizeEntityKey(entityId) {
    if (entityId === null || entityId === undefined) return '';
    return String(entityId).trim();
}

/**
 * Resolves the remaining cooldown for an entity from a cooldown Map.
 * Tries direct key, normalized string key, and numeric key in order.
 * Returns 0 if no active cooldown is found.
 */
export function resolveEntityCooldown(cooldownMap, entityId) {
    if (!(cooldownMap instanceof Map)) return 0;

    const directRemaining = Number(cooldownMap.get(entityId) || 0);
    if (directRemaining > 0) return directRemaining;

    const normalizedKey = normalizeEntityKey(entityId);
    if (!normalizedKey) return 0;

    const normalizedRemaining = Number(cooldownMap.get(normalizedKey) || 0);
    if (normalizedRemaining > 0) return normalizedRemaining;

    const numericKey = Number(normalizedKey);
    if (Number.isFinite(numericKey)) {
        const numericRemaining = Number(cooldownMap.get(numericKey) || 0);
        if (numericRemaining > 0) return numericRemaining;
    }

    return 0;
}
