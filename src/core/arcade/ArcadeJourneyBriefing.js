import { getArcadeJourneyStage } from '../../shared/contracts/ArcadeJourneyContract.js';

/** The briefing describes the fixed route, independent of seed and difficulty. */
export function createArcadeJourneyBriefing(seed, tierId = 'normal') {
    void seed; void tierId;
    const stage = getArcadeJourneyStage('first_run');
    return { label: 'Parcours Rift', text: stage.goal, silhouette: '◎', mapKey: stage.mapKey };
}
