export const STORM_DAM_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([Object.freeze({
        id: 'dam_wall',
        label: 'Staudamm',
        kind: 'landmark',
        hp: 1400,
        meshPrefixes: Object.freeze(['dam_wall']),
        anchor: Object.freeze([0, 92, 82]),
    })]),
    pieces: Object.freeze(['landmark']),
    breakScenes: Object.freeze([Object.freeze({
        id: 'collapse_dam',
        trigger: Object.freeze({ segmentId: 'dam_wall' }),
        modelId: 'storm-dam-collapse',
        pieces: Object.freeze(['landmark']),
        hideModelIds: Object.freeze(['storm-dam-intact']),
        attachedModels: Object.freeze([Object.freeze({
            modelId: 'storm-dam-gate',
            parentNodeName: 'dam_wall_arch_08_tier_2',
        })]),
        yawFromEvent: false,
        blast: Object.freeze({ radius: 48, damage: 50, delaySeconds: 1.4 }),
    })]),
});
