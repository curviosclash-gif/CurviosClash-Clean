const ROOT = 'assets/maps/storm_bridge_siege/glb';
const METRE = 0.2;

export const STORM_BRIDGE_MODELS = Object.freeze([
    Object.freeze({
        id: 'storm-bridge-intact',
        url: `${ROOT}/01_bridge.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    }),
    Object.freeze({
        id: 'storm-bridge-collapse',
        url: `${ROOT}/20_bridge_collapse.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: 'BridgeCollapseOnce' }),
    }),
    Object.freeze({
        id: 'storm-bridge-train',
        url: `${ROOT}/30_bridge_train.glb`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'BridgeTrainLoop' }),
    }),
]);
