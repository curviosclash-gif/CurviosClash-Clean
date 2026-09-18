const HUNT_ONLY = Object.freeze(['HUNT']);
const HUNT_AND_ARCADE = Object.freeze(['HUNT', 'ARCADE']);

export const ROCKET_PICKUP_DEFINITIONS = Object.freeze({
    ROCKET_WEAK: {
        name: 'Rakete S', color: 0xffcc66, icon: '🚀', duration: 0, damage: 10,
        selfUsable: false, shootable: true, offensive: true, projectileOnly: true,
        allowedModes: HUNT_ONLY, observationSlot: 8, visualKind: 'rocket', visualScale: 0.88,
        rocketTier: 'WEAK', rocketTierLabel: 'S',
        aliases: ['ROCKET', 'ROCKET_BASIC', 'ROCKET_LIGHT', 'ITEM_ROCKET'],
        botRule: { self: 0.06, offense: 0.45, defensiveScale: 0.02, emergencyScale: 0.05, combatSelf: 0 },
    },
    ROCKET_MEDIUM: {
        name: 'Rakete M', color: 0xff8844, icon: '🚀', duration: 0, damage: 20,
        selfUsable: false, shootable: true, offensive: true, projectileOnly: true,
        allowedModes: HUNT_ONLY, observationSlot: 9, visualKind: 'rocket', visualScale: 1,
        rocketTier: 'MEDIUM', rocketTierLabel: 'M',
        botRule: { self: 0.06, offense: 0.5, defensiveScale: 0.02, emergencyScale: 0.05, combatSelf: 0 },
    },
    ROCKET_HEAVY: {
        name: 'Rakete L', color: 0xff3344, icon: '🚀', duration: 0, damage: 40,
        selfUsable: false, shootable: true, offensive: true, projectileOnly: true,
        allowedModes: HUNT_ONLY, observationSlot: 10, visualKind: 'rocket', visualScale: 1.14,
        rocketTier: 'HEAVY', rocketTierLabel: 'L', aliases: ['ROCKET_STRONG', 'ROCKET_POWER'],
        botRule: { self: 0.06, offense: 0.56, defensiveScale: 0.02, emergencyScale: 0.06, combatSelf: 0 },
    },
    ROCKET_MEGA: {
        name: 'Rakete XL', color: 0xcc11ff, icon: '🚀', duration: 0, damage: 70,
        selfUsable: false, shootable: true, offensive: true, projectileOnly: true,
        allowedModes: HUNT_ONLY, observationSlot: 11, visualKind: 'rocket', visualScale: 1.35,
        rocketTier: 'MEGA', rocketTierLabel: 'XL', aliases: ['ROCKET_ULTRA'],
        botRule: { self: 0.06, offense: 0.65, defensiveScale: 0.03, emergencyScale: 0.08, combatSelf: 0 },
    },
    ROCKET_GUIDED: {
        name: 'Steuerbare Rakete', color: 0xa533ff, icon: '🚀', duration: 0, damage: 70,
        selfUsable: false, shootable: true, offensive: true, projectileOnly: true,
        allowedModes: HUNT_AND_ARCADE, observationSlot: 11, visualKind: 'rocket', visualScale: 1.35,
        rocketTier: 'MEGA', rocketTierLabel: 'G',
        spawnWeights: { CLASSIC: 0, ARCADE: 0.06, HUNT: 0.02 },
        botRule: { self: 0, offense: 0.4, defensiveScale: 0.02, emergencyScale: 0.05, combatSelf: 0 },
    },
});
