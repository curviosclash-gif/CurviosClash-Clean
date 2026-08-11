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

function resolveObjectiveDefinition(objectiveId) {
    const normalized = String(objectiveId || '').trim().toLowerCase();
    return ARCADE_SECTOR_OBJECTIVES.find((entry) => entry.id === normalized) || null;
}

export function assignArcadeSectorRuntimeState(runtime) {
    if (!runtime?._state) return;
    const sectorIndex = Math.max(1, Number(runtime._state.sectorIndex) || 1);
    const sectorOffset = sectorIndex - 1;
    const encounterEntry = runtime._getEncounterSectorEntry(sectorIndex);
    const templateId = String(encounterEntry?.templateId || 'sector_intro').trim() || 'sector_intro';
    const mapKey = String(runtime._state.currentMapKey || 'standard').trim() || 'standard';
    const mapDefinition = getRuntimeMapDefinition(mapKey, getRuntimeMapCatalog());
    const mapMissions = Array.isArray(mapDefinition?.missions) && mapDefinition.missions.length > 0
        ? mapDefinition.missions
        : null;
    const missions = assignSectorMissions(
        { id: templateId },
        mapMissions,
        `${runtime._resolveActiveRunSeed()}-${runtime._state.runId}`,
        sectorOffset
    );
    runtime._missionState = createSectorMissionState(missions);
    runtime._objectiveState = createArcadeObjectiveState(
        resolveObjectiveDefinition(encounterEntry?.objectiveId),
        {
            sectorIndex,
            participants: runtime._getObjectiveParticipants?.() || [],
        }
    );
    runtime._state.missions = runtime._missionState;
    runtime._state.objectiveState = runtime._objectiveState;
}

export function updateArcadeObjectiveRuntimeState(runtime, event) {
    if (!runtime?._objectiveState) return null;
    const next = updateArcadeObjectiveState(runtime._objectiveState, event);
    runtime._objectiveState = next;
    if (runtime._state) runtime._state.objectiveState = next;
    if (!next?.shouldEnd || next.roundEndRequested) return next;
    const accepted = runtime._requestRoundEnd?.({
        reason: 'ARCADE_OBJECTIVE',
        objectiveId: next.objectiveId,
        objective: { ...next },
    }) === true;
    if (accepted) {
        next.roundEndRequested = true;
        runtime._state.objectiveState = next;
    }
    return next;
}
