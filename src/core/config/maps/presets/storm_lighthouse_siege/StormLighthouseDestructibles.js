export const STORM_LIGHTHOUSE_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([Object.freeze({
        id: 'lighthouse_tower',
        label: 'Leuchtturm',
        kind: 'landmark',
        hp: 520,
        meshPrefixes: Object.freeze(['lighthouse_tower']),
        anchor: Object.freeze([0, 12, 0]),
    })]),
    pieces: Object.freeze(['landmark']),
    breakScenes: Object.freeze([Object.freeze({
        id: 'collapse_lighthouse',
        trigger: Object.freeze({ segmentId: 'lighthouse_tower' }),
        modelId: 'storm-lighthouse-collapse',
        pieces: Object.freeze(['landmark']),
        hideModelIds: Object.freeze(['storm-lighthouse-intact', 'storm-lighthouse-lift']),
        yawFromEvent: true,
        blast: Object.freeze({ radius: 24, damage: 40, delaySeconds: 1 }),
    })]),
});
