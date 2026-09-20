const ROOT = 'assets/maps/storm_lighthouse_siege/glb';
const METRE = 0.2;

export const STORM_LIGHTHOUSE_MODELS = Object.freeze([
    Object.freeze({
        id: 'storm-lighthouse-island',
        url: `${ROOT}/00_lighthouse_island.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    }),
    Object.freeze({
        id: 'storm-lighthouse-intact',
        url: `${ROOT}/01_lighthouse.glb`,
        position: [0, 4, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    }),
    Object.freeze({
        id: 'storm-lighthouse-collapse',
        url: `${ROOT}/20_lighthouse_collapse.glb`,
        position: [0, 4, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: 'LighthouseCollapseOnce' }),
    }),
    Object.freeze({
        id: 'storm-lighthouse-lift',
        url: `${ROOT}/30_lighthouse_lift.glb`,
        position: [4.4, 4, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'LighthouseLiftLoop' }),
    }),
    Object.freeze({
        id: 'storm-lighthouse-beacon',
        url: `${ROOT}/31_lighthouse_beacon.glb`,
        position: [0, 18, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        collision: false,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'LighthouseBeaconLoop' }),
    }),
]);
