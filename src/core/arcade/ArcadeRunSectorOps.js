// Sector type, modifier, encounter entries and runtime profile of the Arcade run, moved out of
// ArcadeRunRuntime unchanged. `runtime` is the ArcadeRunRuntime.
import { getMapKeyForSector } from '../../state/arcade/ArcadeMapProgression.js';
import {
    resolveArcadeEndlessSectorDescriptor,
    resolveArcadeSectorRuntimeProfile,
} from '../../entities/directors/ArcadeEncounterCatalog.js';
import { toSafeInt } from '../../shared/utils/ArcadeUtils.js';

export function resolveArcadeSectorType(runtime, sectorIndex) {
    const seq = runtime._state?.encounterSequence;
    if (!Array.isArray(seq) || sectorIndex < 1) return null;
    const entry = seq[sectorIndex - 1];
    if (!entry || typeof entry !== 'object') return null;
    return entry.parcoursEnabled === true ? 'sector_parcours' : null;
}

export function applyArcadeSectorType(runtime, sectorIndex) {
    const sectorType = runtime._resolveSectorType(sectorIndex);
    const scenarioId = runtime._getEncounterSectorEntry(sectorIndex)?.scenarioId || null;
    runtime._currentSectorType = sectorType;
    if (runtime._strategy && typeof runtime._strategy.setSectorType === 'function') {
        try { runtime._strategy.setSectorType(sectorType); } catch { /* no-op */ }
    }
    try { runtime._strategy?.setScenarioId?.(scenarioId); } catch { /* no-op */ }
}

export function resolveArcadeModifierForSector(runtime, sectorIndex) {
    const seq = runtime._state?.encounterSequence;
    if (!Array.isArray(seq) || sectorIndex < 1) return null;
    const entry = seq[sectorIndex - 1];
    return (entry && typeof entry.modifierId === 'string') ? entry.modifierId : null;
}

export function getArcadeEncounterSectorEntry(runtime, sectorIndex) {
    const sequence = runtime._state?.encounterSequence;
    if (!Array.isArray(sequence) || sequence.length === 0) return null;
    const idx = Math.max(0, toSafeInt(sectorIndex, 1) - 1);
    const entry = sequence[idx];
    return entry && typeof entry === 'object' ? entry : null;
}

export function ensureArcadeEncounterSectorEntry(runtime, sectorIndex) {
    const normalizedSectorIndex = Math.max(1, toSafeInt(sectorIndex, 1));
    const existing = runtime._getEncounterSectorEntry(normalizedSectorIndex);
    if (existing) return existing;
    if (!runtime._state) return null;

    const descriptor = resolveArcadeEndlessSectorDescriptor({
        seed: runtime._resolveActiveRunSeed(),
        sectorIndex: normalizedSectorIndex,
        difficulty: runtime._state?.encounterDifficulty || 'normal',
    });
    const encounterSequence = Array.isArray(runtime._state.encounterSequence)
        ? [...runtime._state.encounterSequence]
        : [];
    encounterSequence[normalizedSectorIndex - 1] = descriptor;
    runtime._state.encounterSequence = encounterSequence;

    const mapSequence = Array.isArray(runtime._state.mapSequence)
        ? [...runtime._state.mapSequence]
        : [];
    mapSequence[normalizedSectorIndex - 1] = descriptor.mapKey;
    runtime._state.mapSequence = mapSequence;
    return descriptor;
}

export function getArcadeSectorRuntimeProfile(runtime, sectorIndex, options = {}) {
    const normalizedSectorIndex = Math.max(1, toSafeInt(sectorIndex, 1));
    const sequenceIndex = Math.max(0, normalizedSectorIndex - 1);
    const encounterEntry = runtime._ensureEncounterSectorEntry(normalizedSectorIndex);
    const mapKey = getMapKeyForSector(runtime._state?.mapSequence, sequenceIndex);
    return resolveArcadeSectorRuntimeProfile(encounterEntry, {
        sectorIndex: normalizedSectorIndex,
        mapKey,
        fallbackBotCount: options.fallbackBotCount,
        // Ohne Vorgabe gilt die im Menue gewaehlte Stufe des laufenden Runs. Der
        // Sektordruck darf sie anheben, ein fester Ersatzwert darf sie nicht ersetzen.
        fallbackDifficulty: options.fallbackDifficulty
            || runtime.rankContext?.botStrength?.ai
            || (runtime._state?.encounterDifficulty === 'nightmare' ? 'HARD' : runtime._state?.encounterDifficulty),
    });
}
