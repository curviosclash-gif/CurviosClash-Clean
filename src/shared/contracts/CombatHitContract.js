/**
 * @typedef {object} CombatHitInput
 * @property {object} target
 * @property {number} amount
 * @property {string} [cause]
 * @property {string | null} [weaponKind]
 * @property {object | null} [sourcePlayer]
 * @property {object | null} [impactPoint]
 * @property {object | null} [hitNormal]
 * @property {string | null} [projectileType]
 * @property {'ALLOW_WITHOUT_KILL_CREDIT' | null} [selfDamagePolicy]
 * @property {string | null} [deathCause]
 * @property {boolean} [emitDamageEvent]
 * @property {boolean} [killOnDeath]
 * @property {boolean} [ignoreShield]
 * @property {unknown} [nowSeconds]
 * @property {boolean} [shieldContact] the hit uses up one whole shield instead of dealing damage
 */

/**
 * Normalize the stable data shared by damage callers. Mode-specific damage rules stay in the
 * active strategy; this contract only rejects inputs that cannot identify a finite hit.
 * Per-frame callers pass `out` to normalize into an object they own instead of a new one;
 * every field is written, so nothing from a previous hit survives.
 *
 * @param {unknown} input
 * @param {Record<string, unknown>} [out]
 * @returns {CombatHitInput | null}
 */
export function normalizeCombatHitInput(input, out = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const hit = /** @type {Record<string, unknown>} */ (input);
    if (!hit.target || typeof hit.target !== 'object' || Array.isArray(hit.target)) return null;
    const amount = Number(hit.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (hit.cause != null && typeof hit.cause !== 'string') return null;
    if (hit.weaponKind != null && typeof hit.weaponKind !== 'string') return null;
    if (hit.sourcePlayer != null && typeof hit.sourcePlayer !== 'object') return null;
    if (hit.emitDamageEvent != null && typeof hit.emitDamageEvent !== 'boolean') return null;
    if (hit.killOnDeath !== undefined && typeof hit.killOnDeath !== 'boolean') return null;
    if (hit.selfDamagePolicy != null && hit.selfDamagePolicy !== 'ALLOW_WITHOUT_KILL_CREDIT') return null;
    if (hit.deathCause != null && (typeof hit.deathCause !== 'string' || !hit.deathCause.trim())) return null;

    out.target = /** @type {object} */ (hit.target);
    out.amount = amount;
    out.cause = typeof hit.cause === 'string' && hit.cause.trim() ? hit.cause : 'UNKNOWN';
    out.weaponKind = typeof hit.weaponKind === 'string' ? hit.weaponKind : null;
    out.sourcePlayer = hit.sourcePlayer && typeof hit.sourcePlayer === 'object' ? hit.sourcePlayer : null;
    out.impactPoint = hit.impactPoint && typeof hit.impactPoint === 'object' ? hit.impactPoint : null;
    out.hitNormal = hit.hitNormal && typeof hit.hitNormal === 'object' ? hit.hitNormal : null;
    out.projectileType = typeof hit.projectileType === 'string' ? hit.projectileType : null;
    out.selfDamagePolicy = hit.selfDamagePolicy === 'ALLOW_WITHOUT_KILL_CREDIT' ? hit.selfDamagePolicy : null;
    out.deathCause = typeof hit.deathCause === 'string' ? hit.deathCause.trim() : null;
    out.emitDamageEvent = hit.emitDamageEvent !== false;
    out.killOnDeath = hit.killOnDeath !== false;
    // Mode rules read these two as given: a missing clock must stay missing, not become 0.
    out.ignoreShield = hit.ignoreShield === true;
    out.nowSeconds = hit.nowSeconds;
    out.shieldContact = hit.shieldContact === true;
    return /** @type {CombatHitInput} */ (out);
}

/**
 * @typedef {object} CombatHealInput
 * @property {object} target
 * @property {number} amount
 * @property {string} [cause]
 * @property {object | null} [sourcePlayer]
 */

/**
 * @param {unknown} input
 * @param {Record<string, unknown>} [out] caller-owned target object, as for hits
 * @returns {CombatHealInput | null}
 */
export function normalizeCombatHealInput(input, out = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const heal = /** @type {Record<string, unknown>} */ (input);
    if (!heal.target || typeof heal.target !== 'object' || Array.isArray(heal.target)) return null;
    const amount = Number(heal.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (heal.cause != null && typeof heal.cause !== 'string') return null;
    if (heal.sourcePlayer != null && typeof heal.sourcePlayer !== 'object') return null;
    out.target = /** @type {object} */ (heal.target);
    out.amount = amount;
    out.cause = typeof heal.cause === 'string' && heal.cause.trim() ? heal.cause : 'UNKNOWN';
    out.sourcePlayer = heal.sourcePlayer && typeof heal.sourcePlayer === 'object' ? heal.sourcePlayer : null;
    return /** @type {CombatHealInput} */ (out);
}
