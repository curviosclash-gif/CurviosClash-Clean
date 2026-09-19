// Repair drone (V34, E83-E84): a short-lived companion in modes with hit points.
const COMBAT_MODES = Object.freeze(['ARCADE', 'HUNT']);

export const REPAIR_DRONE_SPAWN_WEIGHTS = Object.freeze({
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const REPAIR_DRONE_PICKUP_DEFINITIONS = Object.freeze({
    REPAIR_DRONE: {
        name: 'Reparatur-Drohne',
        description: 'Begleitet dich 20 Sekunden, repariert langsam und kann abgeschossen werden.',
        color: 0x54f0a4, icon: '🔧', duration: 20,
        selfUsable: true, shootable: false, offensive: false, projectileOnly: false,
        allowedModes: COMBAT_MODES,
        visualKind: 'repair-drone',
        actionRole: 'buff', effectCategory: 'repair-drone', stackPolicy: 'refresh',
        animationKind: 'orbit',
        aliases: ['ITEM_REPAIR_DRONE', 'REPARATUR_DROHNE'],
        spawnWeights: { ...REPAIR_DRONE_SPAWN_WEIGHTS, CLASSIC: 0 },
        // S11.2 owns activation; bots keep the pickup without spending it until that behavior exists.
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
