import { getArcadeJourneyStage, normalizeArcadeJourneyStageId } from '../../shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_SCENARIOS, applyArcadeScenarioToSectorEntry } from '../../entities/directors/ArcadeScenarioCatalog.js';

function journeyStage(config) {
    const id = normalizeArcadeJourneyStageId(config?.journeyStageId, config || {});
    const stage = getArcadeJourneyStage(id);
    return stage;
}

/** A selected mission is fixed; a free run and the Daily retain their seeded plans. */
export function buildArcadeJourneyEncounterPlan(runtimeConfig, plan) {
    const stage = journeyStage(runtimeConfig?.arcade);
    if (stage?.id === 'first_run') {
        return { ...plan, sectorCount: stage.sectorCount, sequence: Array.from({ length: stage.sectorCount }, (_, index) => ({
            sectorNumber: index + 1, templateId: 'sector_parcours', squadId: null, objectiveId: 'parcours_run',
            modifierId: null, scoreBonus: 0, rewardChoices: [], pressure: 0, difficultyTierId: plan.difficulty,
            mapKey: stage.mapKey, mapKeyLocked: true, isBoss: false, bossMultiplier: 1,
            parcoursEnabled: true, parcoursRacer: true, combatProfile: index === 1 ? '' : 'hunt', weaponsDisabled: index === 1,
        })) };
    }
    if (!stage?.scenarioId) return null;
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
    const stage = journeyStage(state?.config);
    if (!stage?.scenarioId) return { succeeded: summary.succeeded, value: summary.score, aborted: summary.aborted };
    const encounter = state.encounterSequence?.[0];
    const completed = encounter?.scenarioId === stage.scenarioId
        && state.objectiveState?.objectiveId === 'destroy_units'
        && state.objectiveState?.status === 'completed';
    return { succeeded: summary.succeeded && completed, value: state.gameplayTimeMs, aborted: summary.aborted };
}
