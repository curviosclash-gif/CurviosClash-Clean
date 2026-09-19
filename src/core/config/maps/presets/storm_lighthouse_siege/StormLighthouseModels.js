const ROOT = 'assets/maps/storm_lighthouse_siege/glb';
const METRE = 0.2;

export const STORM_LIGHTHOUSE_MODELS = Object.freeze([
    Object.freeze({
        id: 'storm-lighthouse-intact',
        url: `${ROOT}/01_lighthouse.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    }),
    Object.freeze({
        id: 'storm-lighthouse-collapse',
        url: `${ROOT}/20_lighthouse_collapse.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: 'LighthouseCollapseOnce' }),
    }),
]);
