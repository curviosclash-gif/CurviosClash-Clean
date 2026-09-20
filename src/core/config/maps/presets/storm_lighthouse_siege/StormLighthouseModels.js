const ROOT = 'assets/maps/storm_lighthouse_siege/glb';
const ISLAND_METRE = 0.2;
const LIGHTHOUSE_SCALE_MULTIPLIER = 10;
const LIGHTHOUSE_METRE = ISLAND_METRE * LIGHTHOUSE_SCALE_MULTIPLIER;
const LIGHTHOUSE_BASE_Y = 4;

function scaleLighthouseOffset(value) {
    return LIGHTHOUSE_BASE_Y + (value - LIGHTHOUSE_BASE_Y) * LIGHTHOUSE_SCALE_MULTIPLIER;
}

export const STORM_LIGHTHOUSE_MODELS = Object.freeze([
    Object.freeze({
        id: 'storm-lighthouse-island',
        url: `${ROOT}/00_lighthouse_island.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: ISLAND_METRE,
    }),
    Object.freeze({
        id: 'storm-lighthouse-intact',
        url: `${ROOT}/01_lighthouse.glb`,
        position: [0, 4, 0],
        rotation: [0, 0, 0],
        scale: LIGHTHOUSE_METRE,
    }),
    Object.freeze({
        id: 'storm-lighthouse-collapse',
        url: `${ROOT}/20_lighthouse_collapse.glb`,
        position: [0, 4, 0],
        rotation: [0, 0, 0],
        scale: LIGHTHOUSE_METRE,
        hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: 'LighthouseCollapseOnce' }),
    }),
    Object.freeze({
        id: 'storm-lighthouse-lift',
        url: `${ROOT}/30_lighthouse_lift.glb`,
        position: [44, LIGHTHOUSE_BASE_Y, 0],
        rotation: [0, 0, 0],
        scale: LIGHTHOUSE_METRE,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'LighthouseLiftLoop' }),
    }),
    Object.freeze({
        id: 'storm-lighthouse-beacon',
        url: `${ROOT}/31_lighthouse_beacon.glb`,
        position: [0, scaleLighthouseOffset(18), 0],
        rotation: [0, 0, 0],
        scale: LIGHTHOUSE_METRE,
        collision: false,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'LighthouseBeaconLoop' }),
    }),
]);
