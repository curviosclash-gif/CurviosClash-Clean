// Railgun (V14, E48, E81): hold the machine gun key to charge, release to fire a beam that passes
// through trails and up to three targets. Only where hit points exist (HUNT and the arcade combat
// profile); in classic a beam would have nothing to take.
const COMBAT_MODES = Object.freeze(['ARCADE', 'HUNT']);

// Rare, the same step as the flamethrower and the lightning.
export const RAILGUN_SPAWN_WEIGHTS = Object.freeze({
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const RAILGUN_PICKUP_DEFINITIONS = Object.freeze({
    RAILGUN: {
        name: 'Railgun',
        description: 'MG-Taste halten lädt, Loslassen feuert: 20 bis 70 Schaden, durch Spuren und bis zu 3 Gegner. 5 Schuss oder 30 Sekunden.',
        color: 0x7fe7ff, icon: '⚡', duration: 30,
        selfUsable: true, shootable: false, offensive: false, projectileOnly: false,
        allowedModes: COMBAT_MODES,
        // ponytail: the twenty observation slots are full, so it shares the catch-all slot like
        // the flamethrower - an own slot would shift the observation vector of trained bots.
        visualKind: 'railgun',
        actionRole: 'buff', effectCategory: 'railgun', stackPolicy: 'refresh',
        animationKind: 'pulse',
        aliases: ['ITEM_RAILGUN', 'SCHIENENKANONE'],
        spawnWeights: { ...RAILGUN_SPAWN_WEIGHTS, CLASSIC: 0 },
        // ponytail: bots pick it up but do not use it yet; S6.10 gives them a rule.
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
