import { createLandmarkDestructibles } from '../siege_shared/LandmarkSiege.js';

export const STORM_DAM_DESTRUCTIBLES = createLandmarkDestructibles({
    segmentId: 'dam_wall',
    label: 'Staudamm',
    hp: 1400,
    anchor: [0, 92, 82],
    sceneId: 'collapse_dam',
    collapseModelId: 'storm-dam-collapse',
    hideModelIds: ['storm-dam-intact', 'storm-dam-gate'],
    blast: { radius: 48, damage: 50, delaySeconds: 1.4 },
});
