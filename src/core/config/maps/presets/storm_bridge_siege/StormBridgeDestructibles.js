import { createLandmarkDestructibles } from '../siege_shared/LandmarkSiege.js';

export const STORM_BRIDGE_DESTRUCTIBLES = createLandmarkDestructibles({
    segmentId: 'bridge_span',
    label: 'Brücke',
    hp: 650,
    anchor: [0, 8, 0],
    sceneId: 'collapse_bridge',
    collapseModelId: 'storm-bridge-collapse',
    hideModelIds: ['storm-bridge-intact', 'storm-bridge-train'],
    blast: { radius: 28, damage: 45, delaySeconds: 1.2 },
});
