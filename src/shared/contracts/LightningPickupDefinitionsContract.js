// Lightning (V20, E23-E32, E47, E82): a rare item that calls a strike on the highest flyers.
// Only where hit points exist - HUNT and the arcade combat profile - never in classic (E82).
const COMBAT_MODES = Object.freeze(['ARCADE', 'HUNT']);

// Rare, like the flamethrower and the rocket launcher: the "rare" step below a standard item.
export const LIGHTNING_SPAWN_WEIGHTS = Object.freeze({
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const LIGHTNING_PICKUP_DEFINITIONS = Object.freeze({
    LIGHTNING: {
        name: 'Blitz',
        description: 'Nach 2 Sekunden Vorwarnung trifft ein Blitz die höchsten Gegner (35 Schaden).',
        color: 0xb9d7ff, icon: '⚡', duration: 0,
        selfUsable: true, shootable: false, offensive: true, projectileOnly: false,
        allowedModes: COMBAT_MODES,
        // ponytail: the twenty observation slots are full, so the item shares the catch-all slot
        // like the flamethrower. An own slot would shift the observation vector of trained bots.
        visualKind: 'lightning',
        actionRole: 'global', effectCategory: 'lightning', stackPolicy: 'refresh',
        animationKind: 'pulse',
        aliases: ['ITEM_LIGHTNING', 'BLITZ'],
        spawnWeights: { ...LIGHTNING_SPAWN_WEIGHTS, CLASSIC: 0 },
        // ponytail: bots pick it up but do not use it yet; S6.5 gives them a rule.
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
