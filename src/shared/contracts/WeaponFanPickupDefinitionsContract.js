const HUNT_ONLY = Object.freeze(['HUNT']);

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
    FAN_3: createWeaponFanDefinition(3, 0x35d9ff, 0.6, {
        self: 0.9, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.5,
    }),
    FAN_4: createWeaponFanDefinition(4, 0xb469ff, 0.3, {
        self: 0.95, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.55,
    }),
    FAN_5: createWeaponFanDefinition(5, 0xffc447, 0.1, {
        self: 1, offense: 0, defensiveScale: 0.1, emergencyScale: 0, combatSelf: 0.6,
    }),
});
