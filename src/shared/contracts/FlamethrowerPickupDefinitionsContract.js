const ALL_GAME_MODES = Object.freeze(['CLASSIC', 'ARCADE', 'HUNT']);

// Target rarity once the flame actually does something. 0.225 is the rarity the rocket
// launcher already uses, which is the "rare" step below a standard item.
export const FLAMETHROWER_TARGET_SPAWN_WEIGHTS = Object.freeze({
    CLASSIC: 0.225,
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const FLAMETHROWER_PICKUP_DEFINITIONS = Object.freeze({
    FLAMETHROWER: {
        name: 'Flammenwerfer',
        description: 'Rüstet 30 Sekunden lang einen Flammenwerfer mit 6 Sekunden Feuerzeit aus.',
        color: 0xff7a1a, icon: '🔥', duration: 30,
        selfUsable: true, shootable: false, offensive: false, projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        // ponytail: all twenty observation slots are taken, so the item shares the catch-all
        // slot 19. Giving it an own slot would shift the observation vector of trained bots.
        // ponytail: no own pickup mesh yet - the model factory falls back to a coloured cube.
        // S4.6 adds the authored model together with the tank HUD.
        visualKind: 'flamethrower',
        actionRole: 'buff', effectCategory: 'flamethrower', stackPolicy: 'refresh',
        animationKind: 'pulse',
        aliases: ['ITEM_FLAMETHROWER', 'FLAMMENWERFER'],
        // ponytail: parked at zero in every mode until S4.2/S4.3 deliver cone damage and
        // trail burning. Raise these to FLAMETHROWER_TARGET_SPAWN_WEIGHTS then - and the
        // matching HUNT.PICKUP_WEIGHTS entry, because Hunt spawns read that table instead.
        spawnWeights: { CLASSIC: 0, ARCADE: 0, HUNT: 0 },
        // ponytail: bots pick the item up but never use it; S4.7 gives it real bot weights.
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
