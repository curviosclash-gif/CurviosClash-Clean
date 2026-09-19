const ROOT = 'assets/maps/storm_dam_siege/glb';
const METRE = 0.2;

export const STORM_DAM_MODELS = Object.freeze([
    Object.freeze({
        id: 'storm-dam-intact',
        url: `${ROOT}/01_dam.glb`,
        position: [0, 0, 24],
        rotation: [0, 0, 0],
        scale: METRE,
    }),
    Object.freeze({
        id: 'storm-dam-collapse',
        url: `${ROOT}/20_dam_collapse.glb`,
        position: [0, 0, 24],
        rotation: [0, 0, 0],
        scale: METRE,
        hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: 'DamCollapseOnce' }),
    }),
    Object.freeze({
        id: 'storm-dam-gate',
        url: `${ROOT}/30_dam_gate.glb`,
        position: [0, 0, 24],
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'DamGateLoop' }),
    }),
]);
