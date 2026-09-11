import {
    assignSectorMissions,
    createSectorMissionState,
} from '../../state/arcade/ArcadeMissionState.js';
import {
    createArcadeObjectiveState,
    updateArcadeObjectiveState,
} from '../../state/arcade/ArcadeObjectiveState.js';
import { ARCADE_SECTOR_OBJECTIVES } from '../../entities/directors/ArcadeEncounterCatalog.js';
import { getRuntimeMapCatalog, getRuntimeMapDefinition } from '../../shared/contracts/RuntimeMapCatalogContract.js';

const ARCADE_MISSION_GENERATOR_VERSION = 'arcade-missions.v2';

export function buildArcadeMissionSeed({
    scoreModel = 'arcade-score.v3',
    activeSeed = 0,
    sectorIndex = 1,
    encounterId = '',
    templateId = 'sector_intro',
    mapKey = 'standard',
} = {}) {
    return [
        ARCADE_MISSION_GENERATOR_VERSION,
        String(scoreModel || 'arcade-score.v3'),
        Math.max(0, Number(activeSeed) || 0),
        Math.max(1, Number(sectorIndex) || 1),
        String(encounterId || templateId || 'sector_intro'),
        String(mapKey || 'standard'),
    ].join(':');
}

function resolveObjectiveDefinition(objectiveId) {
    const normalized = String(objectiveId || '').trim().toLowerCase();
    return ARCADE_SECTOR_OBJECTIVES.find((entry) => entry.id === normalized) || null;
}

export function assignArcadeSectorRuntimeState(runtime) {
    if (!runtime?._state) return;
    runtime._state.sectorStartXp = runtime._state.xpEarned || 0;
    if (runtime._state.score) runtime._state.score.lastMissionBonus = 0;
    const sectorIndex = Math.max(1, Number(runtime._state.sectorIndex) || 1);
    const encounterEntry = runtime._getEncounterSectorEntry(sectorIndex);
    const templateId = String(encounterEntry?.templateId || 'sector_intro').trim() || 'sector_intro';
    const mapKey = String(runtime._state.currentMapKey || 'standard').trim() || 'standard';
    const mapDefinition = getRuntimeMapDefinition(mapKey, getRuntimeMapCatalog());
    const mapMissions = Array.isArray(mapDefinition?.missions) && mapDefinition.missions.length > 0
        ? mapDefinition.missions
        : null;
    const objective = resolveObjectiveDefinition(encounterEntry?.objectiveId);
    const profile = runtime.getSectorRuntimeProfile(sectorIndex);
    const capabilities = runtime._getMissionCapabilities?.() || {};
    const context = {
        botCount: profile.botCount, respawnEnabled: false,
        parcoursEnabled: profile.parcoursEnabled,
        hasItems: capabilities.hasItems ?? ((mapDefinition?.items?.length || 0) > 0),
        hasExitPortal: !!mapDefinition?.exitPortal,
        hasHealing: capabilities.hasHealing === true,
        unavoidableDamage: runtime._activeModifierId === 'heat_stress'
            || runtime._strategy?.getSuddenDeathState?.()?.stackedModifiers?.includes('heat_stress') === true,
        maximumDurationSec: objective?.id === 'survive_window' ? objective.durationSec : 0,
        minimumDurationSec: ['survive_window', 'hazard_lane'].includes(objective?.id) ? objective.durationSec : 0,
    };
    const missions = assignSectorMissions(
        { id: templateId },
        mapMissions,
        buildArcadeMissionSeed({
            scoreModel: runtime._state?.config?.scoreModel,
            activeSeed: runtime._resolveActiveRunSeed(),
            sectorIndex,
            encounterId: encounterEntry?.encounterId || encounterEntry?.id,
            templateId,
            mapKey,
        }),
        sectorIndex,
        context
    );
    runtime._missionState = createSectorMissionState(missions);
    runtime._state.objectiveState = createArcadeObjectiveState(
        resolveObjectiveDefinition(encounterEntry?.objectiveId),
        {
            sectorIndex,
            participants: runtime._getObjectiveParticipants?.() || [],
        }
    );
    runtime._state.missions = runtime._missionState;
}

export function updateArcadeObjectiveRuntimeState(runtime, event) {
    if (!runtime?._state?.objectiveState) return null;
    const next = updateArcadeObjectiveState(runtime._state.objectiveState, event);
    runtime._state.objectiveState = next;
    if (!next?.shouldEnd || next.roundEndRequested) return next;
    next.roundEndRequested = true;
    const accepted = runtime._requestRoundEnd?.({
        reason: 'ARCADE_OBJECTIVE',
        objectiveId: next.objectiveId,
        objective: { ...next },
    }) === true;
    if (!accepted) next.roundEndRequested = false;
    return next;
}
