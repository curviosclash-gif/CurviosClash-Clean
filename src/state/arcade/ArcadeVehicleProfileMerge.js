// Three-way merge for vehicle profiles saved from a stale copy (hangar window, running arcade run).
// Every writer keeps the state it last loaded or saved as its base. On save, only the fields the
// writer changed since that base are applied to the freshly loaded record; XP counters are applied
// as deltas, so concurrent run XP and hangar spending add up instead of overwriting each other.

import {
    arcadeVehicleLevelForXp,
    clampArcadeProfileCount,
    createArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';

const COUNTER_FIELDS = new Set(['xp', 'xpBank', 'totalXpEarned', 'spentUpgradeXp', 'upgradesApplied']);
const SKIPPED_FIELDS = new Set(['createdAt', 'updatedAt', 'level']);const PROFILE_BASES = new WeakMap();

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Remembers what `owner` (a profile map) looked like when it was last loaded or saved. */
export function rememberArcadeVehicleProfileBase(owner, profiles) {
    if (!owner || typeof owner !== 'object') return;
    const base = JSON.parse(JSON.stringify(profiles || {}));
    const holder = PROFILE_BASES.get(owner);
    if (holder) holder.base = base;
    else PROFILE_BASES.set(owner, { base });
}

export function getArcadeVehicleProfileBase(owner) {
    return owner && typeof owner === 'object' ? PROFILE_BASES.get(owner)?.base || null : null;
}

/** A copy of a profile map (e.g. a deferred save snapshot) shares and advances the original's base. */
export function shareArcadeVehicleProfileBase(copy, original) {
    const holder = original && typeof original === 'object' ? PROFILE_BASES.get(original) : null;
    if (holder && copy && typeof copy === 'object') PROFILE_BASES.set(copy, holder);
}

/**
 * @param {Record<string, any>} fresh profile as stored right now
 * @param {Record<string, any>} ours profile of the writer
 * @param {Record<string, any>} base profile of the writer at its last load or save
 * @returns {Record<string, any>|null} null when both sides spent more bank XP than there is
 */
export function mergeArcadeVehicleProfileChanges(fresh, ours, base) {
    const merged = { ...fresh };
    let changed = false;
    for (const key of new Set([...Object.keys(ours), ...Object.keys(base)])) {
        if (SKIPPED_FIELDS.has(key) || same(ours[key], base[key])) continue;
        changed = true;
        if (!Object.prototype.hasOwnProperty.call(ours, key)) {
            delete merged[key];
        } else if (COUNTER_FIELDS.has(key) && [fresh[key], ours[key], base[key]].every(Number.isFinite)) {
            const value = fresh[key] + ours[key] - base[key];
            // Two writers spent the same bank XP: clamping to 0 would hand out uncovered upgrades.
            if (key === 'xpBank' && value < 0) return null;
            merged[key] = clampArcadeProfileCount(value);
        } else {
            merged[key] = ours[key];
        }
    }
    if (!same(ours.level, base.level) || !same(ours.xp, base.xp)) {
        changed = true;
        merged.level = Math.max(
            Number(fresh.level) || 1,
            same(ours.level, base.level) ? 1 : Number(ours.level) || 1,
            arcadeVehicleLevelForXp(merged.xp),
        );
    }
    if (changed && ours.updatedAt) merged.updatedAt = ours.updatedAt;
    return merged;
}

/** The save result for vehicles whose bank XP both sides spent; null when there is no conflict. */
export function refuseArcadeBankConflict(conflicts) {
    return Array.isArray(conflicts) && conflicts.length > 0
        ? { success: false, reason: 'bank_conflict', metadata: { vehicleIds: conflicts.slice() } }
        : null;
}

/**
 * Applies a writer's profile map onto the stored profiles. Vehicles the writer does not carry stay
 * as stored. Without a base (a map that was never loaded or saved) the writer's profiles win.
 * @param {Record<string, any>} storedProfiles
 * @param {unknown} sourceProfiles
 * @param {Record<string, any>|null} base
 * @param {(profile: any) => any} normalize
 */
export function mergeArcadeVehicleProfileMaps(storedProfiles, sourceProfiles, base, normalize) {
    const merged = {};
    const own = {};
    const conflicts = [];
    Object.entries(storedProfiles || {}).forEach(([vehicleId, profile]) => { merged[vehicleId] = normalize(profile); });
    const source = sourceProfiles && typeof sourceProfiles === 'object' ? sourceProfiles : {};
    Object.entries(source).forEach(([vehicleId, profile]) => {
        const ours = normalize(profile);
        own[vehicleId] = ours;
        const fresh = merged[vehicleId];
        if (!fresh || !base) {
            merged[vehicleId] = ours;
            return;
        }
        const ownBase = normalize(base[vehicleId] || createArcadeVehicleProfileRecord(vehicleId, 0));
        const result = mergeArcadeVehicleProfileChanges(fresh, ours, ownBase);
        if (!result) conflicts.push(vehicleId);
        else merged[vehicleId] = normalize(result);
    });
    return { merged, own, conflicts };
}
