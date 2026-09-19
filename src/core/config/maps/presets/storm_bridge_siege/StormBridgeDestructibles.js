export const STORM_BRIDGE_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([Object.freeze({
        id: 'bridge_span',
        label: 'Bruecke',
        kind: 'landmark',
        hp: 650,
        meshPrefixes: Object.freeze(['bridge_span']),
        anchor: Object.freeze([0, 8, 0]),
    })]),
    pieces: Object.freeze(['landmark']),
    breakScenes: Object.freeze([Object.freeze({
        id: 'collapse_bridge',
        trigger: Object.freeze({ segmentId: 'bridge_span' }),
        modelId: 'storm-bridge-collapse',
        pieces: Object.freeze(['landmark']),
        hideModelIds: Object.freeze(['storm-bridge-intact']),
        yawFromEvent: false,
        blast: Object.freeze({ radius: 28, damage: 45, delaySeconds: 1.2 }),
    })]),
});
