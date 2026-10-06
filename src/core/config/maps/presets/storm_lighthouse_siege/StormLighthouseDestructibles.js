import { createLandmarkDestructibles } from '../siege_shared/LandmarkSiege.js';

// The wreck is a new traversal ramp, so it always lands in its authored clear corridor.
export const STORM_LIGHTHOUSE_DESTRUCTIBLES = createLandmarkDestructibles({
    segmentId: 'lighthouse_tower',
    label: 'Leuchtturm',
    hp: 520,
    anchor: [0, 4, 0],
    sceneId: 'collapse_lighthouse',
    collapseModelId: 'storm-lighthouse-collapse',
    hideModelIds: ['storm-lighthouse-intact', 'storm-lighthouse-lift', 'storm-lighthouse-beacon'],
    blast: { radius: 24, damage: 40, delaySeconds: 4.6 },
});
