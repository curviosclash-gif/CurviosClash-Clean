const COMBAT_MODES = Object.freeze(['ARCADE', 'HUNT']);

export const BOMBER_STRIKE_SPAWN_WEIGHTS = Object.freeze({
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const BOMBER_STRIKE_PICKUP_DEFINITIONS = Object.freeze({
    BOMBER_STRIKE: {
        name: 'Bomber-Angriff',
        description: 'Ruft einen Bomber, der einmal über das Feld fliegt und nur deine Gegner angreift.',
        color: 0xff9b42, icon: '✈', duration: 0,
        selfUsable: true, shootable: false, offensive: true, projectileOnly: false,
        allowedModes: COMBAT_MODES,
        visualKind: 'bomber-strike',
        actionRole: 'global', effectCategory: 'bomber-strike', stackPolicy: 'refresh',
        animationKind: 'pulse',
        aliases: ['ITEM_BOMBER_STRIKE', 'BOMBER_ANGRIFF'],
        spawnWeights: { ...BOMBER_STRIKE_SPAWN_WEIGHTS, CLASSIC: 0 },
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
