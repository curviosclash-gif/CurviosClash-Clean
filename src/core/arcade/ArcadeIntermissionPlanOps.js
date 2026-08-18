import { getMapKeyForSector } from '../../state/arcade/ArcadeMapProgression.js';
import {
    ARCADE_RUN_LEVELUP_REWARDS,
    ARCADE_SECTOR_MODIFIERS,
} from '../../entities/directors/ArcadeEncounterCatalog.js';
import {
    getArcadeModifierRegistryDescriptor,
    resolveArcadeModifierMeta,
} from '../../shared/contracts/ArcadeModifierContract.js';
import {
    getArcadeRewardRegistryDescriptor,
    resolveArcadeRewardMeta,
} from '../../shared/contracts/ArcadeRewardContract.js';
import {
    getRuntimeMapCatalog,
    getRuntimeMapDefinition,
    listRuntimeMapPresetKeys,
    resolveRuntimeMapPresetLabel,
} from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { toSafeInt, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

function createModifierScoreBonusMap() {
    const map = new Map();
    for (let i = 0; i < ARCADE_SECTOR_MODIFIERS.length; i += 1) {
        const entry = ARCADE_SECTOR_MODIFIERS[i];
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim();
        if (!id) continue;
        map.set(id, Math.max(0, toSafeNumber(entry.scoreBonus, 0)));
    }
    return map;
}

const MODIFIER_SCORE_BONUS_BY_ID = createModifierScoreBonusMap();

export function resolveArcadeModifierScoreBonus(modifierId) {
    const id = String(modifierId || '').trim();
    return id ? (MODIFIER_SCORE_BONUS_BY_ID.get(id) || 0) : 0;
}

export function formatArcadeMapLabel(mapKey) {
    const raw = String(mapKey || '').trim();
    if (!raw) return 'Unbekannte Map';
    const fromCatalog = resolveRuntimeMapPresetLabel(raw);
    if (typeof fromCatalog === 'string' && fromCatalog.trim().length > 0) {
        return fromCatalog.trim();
    }
    return raw.replace(/_/g, ' ');
}

export function resolveArcadeRewardChoices(runtime, sectorIndex) {
    const sectorEntry = runtime._getEncounterSectorEntry(sectorIndex);
    const rewardRegistryIds = getArcadeRewardRegistryDescriptor().entries
        .map((entry) => String(entry.id || '').trim())
        .filter(Boolean);
    const sourceChoices = Array.isArray(sectorEntry?.rewardChoices) && sectorEntry.rewardChoices.length > 0
        ? sectorEntry.rewardChoices
        : (rewardRegistryIds.length > 0
            ? rewardRegistryIds
            : ARCADE_RUN_LEVELUP_REWARDS.map((entry) => entry.id));
    const deduped = [];
    const used = new Set();
    for (let i = 0; i < sourceChoices.length; i += 1) {
        const rewardId = String(sourceChoices[i] || '').trim();
        if (!rewardId || used.has(rewardId)) continue;
        used.add(rewardId);
        const meta = resolveArcadeRewardMeta(rewardId);
        deduped.push({
            id: rewardId,
            label: meta?.label || rewardId,
            effectText: meta?.effectText || '',
        });
        if (deduped.length >= 3) break;
    }
    if (deduped.length > 0) return deduped;

    const fallback = getArcadeRewardRegistryDescriptor().entries[0] || ARCADE_RUN_LEVELUP_REWARDS[0];
    const fallbackId = String(fallback?.id || 'run_speed_t1');
    const fallbackMeta = resolveArcadeRewardMeta(fallbackId);
    return [{
        id: fallbackId,
        label: fallbackMeta?.label || fallbackId,
        effectText: fallbackMeta?.effectText || '',
    }];
}

export function buildArcadeIntermissionChoices(runtime, nextSectorIndex) {
    const sequence = Array.isArray(runtime._state?.mapSequence) ? runtime._state.mapSequence : [];
    const targetIndex = Math.max(0, toSafeInt(nextSectorIndex, 1) - 1);
    const baseMapKey = getMapKeyForSector(sequence, targetIndex);
    const encounterEntry = runtime._getEncounterSectorEntry(nextSectorIndex);
    const baseModifierId = String(encounterEntry?.modifierId || runtime._activeModifierId || '').trim();

    const runtimeMapCatalog = getRuntimeMapCatalog();
    const mapCatalogKeys = listRuntimeMapPresetKeys(runtimeMapCatalog);
    const choices = [];
    const pushChoice = (mapKey, modifierId, source) => {
        const normalizedMapKey = String(mapKey || '').trim();
        if (!normalizedMapKey) return;
        const normalizedModifierId = String(modifierId || '').trim();
        const id = `${source}-${normalizedMapKey}-${normalizedModifierId || 'none'}`;
        if (choices.some((entry) => entry.id === id)) return;
        const modifierMeta = resolveArcadeModifierMeta(normalizedModifierId);
        choices.push({
            id,
            mapKey: normalizedMapKey,
            mapLabel: formatArcadeMapLabel(normalizedMapKey),
            modifierId: normalizedModifierId || null,
            modifierLabel: modifierMeta?.label || (normalizedModifierId || 'Kein Modifier'),
            modifierEffect: modifierMeta?.effectText || '',
            source,
            objectiveLabel: String(encounterEntry?.objectiveId || '').replace(/_/g, ' '),
            squadLabel: String(encounterEntry?.squadId || '').replace(/_/g, ' '),
        });
    };

    pushChoice(baseMapKey, baseModifierId, 'plan');

    const nextSectorIsParcours = encounterEntry?.parcoursEnabled === true;
    const candidateMaps = mapCatalogKeys.filter((mapKey) => {
        if (mapKey === baseMapKey) return false;
        const definition = getRuntimeMapDefinition(mapKey, runtimeMapCatalog);
        const mapIsParcours = definition?.parcours?.enabled === true;
        return mapIsParcours === nextSectorIsParcours;
    });
    const modifierIds = getArcadeModifierRegistryDescriptor().entries
        .map((entry) => String(entry.id || '').trim())
        .filter(Boolean);
    const altTargetCount = candidateMaps.length > 0 ? 3 : 1;
    for (let i = 0; i < altTargetCount && choices.length < 3; i += 1) {
        const mapIdx = (targetIndex + i) % Math.max(1, candidateMaps.length);
        const modifierIdx = (targetIndex + i + 1) % Math.max(1, modifierIds.length);
        const mapKey = candidateMaps[mapIdx] || baseMapKey;
        const modifierId = modifierIds[modifierIdx] || baseModifierId;
        pushChoice(mapKey, modifierId, 'alt');
    }

    return choices.slice(0, 3);
}

export function prepareArcadeIntermissionState(runtime, nowMs = Date.now()) {
    if (!runtime._state) return null;
    const nextSectorIndex = Math.max(1, toSafeInt(runtime._state.completedSectors, 0) + 1);
    const choices = buildArcadeIntermissionChoices(runtime, nextSectorIndex);
    const rewards = resolveArcadeRewardChoices(runtime, nextSectorIndex);
    const selectedChoiceId = choices[0]?.id || null;
    const selectedRewardId = rewards[0]?.id || null;
    const selectedChoice = choices.find((entry) => entry.id === selectedChoiceId) || null;
    const selectedReward = rewards.find((entry) => entry.id === selectedRewardId) || null;

    const lastSectorSummary = runtime._state.lastSectorSummary || null;
    const missionsCompleted = Math.max(0, toSafeInt(runtime._missionState?.completedCount, 0));
    const missionsTotal = Math.max(0, toSafeInt(runtime._missionState?.missions?.length, 0));
    const nextSectorEntry = runtime._getEncounterSectorEntry(nextSectorIndex);
    const intermissionState = {
        generatedAtMs: Math.max(0, toSafeNumber(nowMs, Date.now())),
        nextSectorIndex,
        selectedChoiceId,
        selectedRewardId,
        choices,
        rewardChoices: rewards,
        missionsCompleted,
        missionsTotal,
        lastSectorPoints: Math.max(0, toSafeNumber(lastSectorSummary?.awardedPoints, 0)),
        lastSectorMultiplier: Math.max(1, toSafeNumber(lastSectorSummary?.multiplierApplied, 1)),
        lastSectorXp: Math.max(0, toSafeNumber(runtime._state?.lastSectorXp?.earned, 0)),
        nextSectorPreview: {
            templateId: String(nextSectorEntry?.templateId || ''),
            objectiveId: String(nextSectorEntry?.objectiveId || ''),
            squadId: String(nextSectorEntry?.squadId || ''),
            mapKey: String(selectedChoice?.mapKey || ''),
            mapLabel: String(selectedChoice?.mapLabel || ''),
            modifierId: String(selectedChoice?.modifierId || ''),
            modifierLabel: String(selectedChoice?.modifierLabel || ''),
            modifierEffect: String(selectedChoice?.modifierEffect || ''),
        },
        selectedRewardLabel: String(selectedReward?.label || ''),
        selectedRewardEffect: String(selectedReward?.effectText || ''),
    };
    runtime._state.intermission = intermissionState;
    return intermissionState;
}
