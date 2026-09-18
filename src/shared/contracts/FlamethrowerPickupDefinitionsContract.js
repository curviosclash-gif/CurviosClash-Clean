const ALL_GAME_MODES = Object.freeze(['CLASSIC', 'ARCADE', 'HUNT']);

// Rarity of the item. 0.225 is the rarity the rocket launcher already uses, which is the
// "rare" step below a standard item. HUNT.PICKUP_WEIGHTS repeats the hunt value because
// hunt spawns read that table instead of the registry.
export const FLAMETHROWER_TARGET_SPAWN_WEIGHTS = Object.freeze({
    CLASSIC: 0.225,
    ARCADE: 0.225,
    HUNT: 0.225,
});

export const FLAMETHROWER_PICKUP_DEFINITIONS = Object.freeze({
    FLAMETHROWER: {
        name: 'Flammenwerfer',
        description: 'Rüstet 30 Sekunden lang einen Flammenwerfer mit 6 Sekunden Feuerzeit aus und brennt Lücken in Spuren.',
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
        spawnWeights: FLAMETHROWER_TARGET_SPAWN_WEIGHTS,
        // ponytail: the generic item scorer only knows "enemy closer than 22 units", which is
        // narrower than the two cone lengths the flamethrower wants. The rule therefore stays at
        // zero on purpose and HuntBotFlamethrowerOps.js arms the item from its own range check.
        botRule: { self: 0, offense: 0, defensiveScale: 0, emergencyScale: 0, combatSelf: 0 },
    },
});
