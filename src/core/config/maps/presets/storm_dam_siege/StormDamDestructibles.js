export const STORM_DAM_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([Object.freeze({
        id: 'dam_wall',
        label: 'Staudamm',
        kind: 'landmark',
        hp: 800,
        meshPrefixes: Object.freeze(['dam_wall']),
        anchor: Object.freeze([0, 23, 24]),
    })]),
    pieces: Object.freeze(['landmark']),
    breakScenes: Object.freeze([Object.freeze({
        id: 'collapse_dam',
        trigger: Object.freeze({ segmentId: 'dam_wall' }),
        modelId: 'storm-dam-collapse',
        pieces: Object.freeze(['landmark']),
        hideModelIds: Object.freeze(['storm-dam-intact', 'storm-dam-gate']),
        yawFromEvent: false,
        blast: Object.freeze({ radius: 32, damage: 50, delaySeconds: 1.4 }),
    })]),
});
