import { getArcadeJourneyStage, normalizeArcadeJourneyStageId } from '../../shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_SCENARIOS, applyArcadeScenarioToSectorEntry } from '../../entities/directors/ArcadeScenarioCatalog.js';

function scenarioStage(config) {
    const id = normalizeArcadeJourneyStageId(config?.journeyStageId, config || {});
    const stage = getArcadeJourneyStage(id);
    return stage?.scenarioId ? stage : null;
}

/** A selected mission is fixed; a free run and the Daily retain their seeded plans. */
export function buildArcadeJourneyEncounterPlan(runtimeConfig, plan) {
    const stage = scenarioStage(runtimeConfig?.arcade);
    if (!stage) return null;
    const scenario = ARCADE_SCENARIOS.find(entry => entry.id === stage.scenarioId);
    if (!scenario || scenario.mapKey !== stage.mapKey || !plan?.sequence?.[0]) {
        throw new Error('Die Reise-Etappe hat keinen gültigen Einsatzplan.');
    }
    const entry = applyArcadeScenarioToSectorEntry({
        ...plan.sequence[0], sectorNumber: 1, isBoss: true, bossMultiplier: 2,
        botCount: stage.botCount, rewardChoices: [], parcoursEnabled: false, parcoursRacer: false,
    }, scenario);
    return { ...plan, sectorCount: stage.sectorCount, sequence: [entry] };
}

/** Only the authored creature objective can settle this stage; score alone cannot. */
export function resolveArcadeJourneyRunResult(runtime, summary) {
    const state = runtime?._state;
    const stage = scenarioStage(state?.config);
    if (!stage) return { succeeded: summary.succeeded, value: summary.score, aborted: summary.aborted };
    const encounter = state.encounterSequence?.[0];
    const completed = encounter?.scenarioId === stage.scenarioId
        && state.objectiveState?.objectiveId === 'destroy_units'
        && state.objectiveState?.status === 'completed';
    return { succeeded: summary.succeeded && completed, value: state.gameplayTimeMs, aborted: summary.aborted };
}
