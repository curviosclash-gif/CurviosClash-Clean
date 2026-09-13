const HUNT_ONLY = Object.freeze(['HUNT']);
// Convert 5/4/3 percent of all Hunt spawns to non-rocket pool weights.
// The remaining 88 percent retains the previous non-fan proportions.
const FAN_WEIGHT_PER_PERCENT = 31.4 / (30 * 0.88);

function createWeaponFanDefinition(projectileCount, color, spawnWeight, botRule) {
    return {
        name: `Fächer ×${projectileCount}`,
        description: `Feuert 40 Sekunden lang ${projectileCount} Geschosse pro Auslösen.`,
        color,
        icon: `×${projectileCount}`,
        duration: 40,
        fanProjectiles: projectileCount,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: HUNT_ONLY,
        observationSlot: 19,
        visualKind: 'weapon-fan',
        effectCategory: 'weapon-fan',
        stackPolicy: 'add-instance',
        aliases: [`WEAPON_FAN_${projectileCount}`, `ITEM_FAN_${projectileCount}`],
        spawnWeights: { CLASSIC: 0, ARCADE: 0, HUNT: spawnWeight },
        botRule,
    };
}

export const WEAPON_FAN_PICKUP_DEFINITIONS = Object.freeze({
    FAN_3: createWeaponFanDefinition(3, 0x35d9ff, 5 * FAN_WEIGHT_PER_PERCENT, {
        self: 0.9, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.5,
    }),
    FAN_4: createWeaponFanDefinition(4, 0xb469ff, 4 * FAN_WEIGHT_PER_PERCENT, {
        self: 0.95, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.55,
    }),
    FAN_5: createWeaponFanDefinition(5, 0xffc447, 3 * FAN_WEIGHT_PER_PERCENT, {
        self: 1, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.6,
    }),
});
