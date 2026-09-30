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
        // The loader stands a model on its bind-pose bottom and centres it there. The train's bind
        // pose is the start of its run (Blender x -72, wheels 1.6 above the deck at z 37.6), so the
        // slot moves it back into the bridge's frame: x -72 m * METRE centres the run on the span,
        // y 36 m * METRE (the deck top) puts the wheels on the deck.
        position: [-72 * METRE, 36 * METRE, 0],
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: Object.freeze({ mode: 'loop', clipName: 'BridgeTrainLoop' }),
    }),
]);
