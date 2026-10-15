import { buildArcadeSectorPlan } from '../../entities/directors/ArcadeEncounterCatalog.js';
import { createDefaultArcadeRunSettings } from '../../shared/contracts/ArcadeRunSettingsContract.js';

/** Derive the encounter from the same seed/tier/default sector count as the borrowed journey run. */
export function createArcadeJourneyBriefing(seed, tierId = 'normal') {
    const finale = buildArcadeSectorPlan({ seed, difficulty: tierId,
        sectorCount: createDefaultArcadeRunSettings().sectorCount }).sequence.at(-1);
    if (!finale?.isBoss) return null;
    return { label: finale.scenarioLabel || 'Elitegeschwader',
        text: finale.briefing || 'Behaupte dich gegen das Elitegeschwader im letzten Pflichtsektor.',
        silhouette: finale.scenarioId === 'hydra_finale' ? '♆' : '▲', mapKey: finale.mapKey, scenarioId: finale.scenarioId };
}
