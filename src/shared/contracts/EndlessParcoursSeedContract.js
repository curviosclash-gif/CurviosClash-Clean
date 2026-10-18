export const ENDLESS_TRAINING_SEED = 20261013;
const MAX_SEED = 2147483647;

export function normalizeEndlessSeedMode(value) {
    return value === 'training' ? 'training' : 'free';
}

/** Randomness is supplied by the menu; the runtime always receives an explicit seed. */
export function resolveEndlessStartChoice({ seedMode = 'free', trainingSeed = ENDLESS_TRAINING_SEED } = {}, randomSample = 0) {
    const mode = normalizeEndlessSeedMode(seedMode);
    if (mode === 'training') {
        const seed = Number(trainingSeed);
        return Number.isSafeInteger(seed) && seed >= 1 && seed <= MAX_SEED
            ? { ok: true, seedMode: mode, seed }
            : { ok: false, seedMode: mode, seed: 0, reason: 'invalid_training_seed' };
    }
    const roll = Math.max(0, Math.min(1 - Number.EPSILON, Number(randomSample) || 0));
    return { ok: true, seedMode: mode, seed: 1 + Math.floor(roll * MAX_SEED) };
}

/** Missing legacy provenance never becomes a current model record. */
export function resolveEndlessRecordScope(source = null) {
    const vehicleId = typeof source?.vehicleId === 'string' ? source.vehicleId.trim() : '';
    const ruleVersion = typeof source?.ruleVersion === 'string' ? source.ruleVersion.trim() : '';
    const mode = source?.seedMode;
    const seed = Number(source?.seed);
    if (!vehicleId || vehicleId.length > 128 || !ruleVersion || !['free', 'training'].includes(mode)) return '';
    if (mode === 'training' && (!Number.isSafeInteger(seed) || seed < 1 || seed > MAX_SEED)) return '';
    return JSON.stringify([ruleVersion, vehicleId, mode, mode === 'training' ? seed : 0]);
}
