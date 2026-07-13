const ALL_GAME_MODES = Object.freeze(['CLASSIC', 'ARCADE', 'HUNT']);
const DEFAULT_BOT_RULE = Object.freeze({
    self: 0,
    offense: 0,
    defensiveScale: 0,
    emergencyScale: 0,
    combatSelf: 0,
});

function createPickupDefinition(definition) {
    return Object.freeze({
        ...definition,
        aliases: Object.freeze([...(definition.aliases || [])]),
        allowedModes: Object.freeze([...(definition.allowedModes || ALL_GAME_MODES)]),
        botRule: Object.freeze({
            ...DEFAULT_BOT_RULE,
            ...(definition.botRule || {}),
        }),
        visualScale: Number.isFinite(Number(definition.visualScale)) ? Number(definition.visualScale) : 1,
    });
}

export const PICKUP_SLOT_COUNT = 20;
export const PICKUP_SLOT_UNKNOWN_INDEX = 19;

export const PICKUP_REGISTRY = Object.freeze({
    SPEED_UP: createPickupDefinition({
        name: 'Schneller',
        color: 0x00ff66,
        icon: '⚡',
        duration: 4,
        multiplier: 1.6,
        selfUsable: true,
        shootable: true,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 0,
        visualKind: 'speed',
        aliases: ['ITEM_BATTERY'],
        botRule: { self: 0.8, offense: 0.2, defensiveScale: 0.5, emergencyScale: 0.1, combatSelf: 0.2 },
    }),
    SLOW_DOWN: createPickupDefinition({
        name: 'Langsamer',
        color: 0xff3333,
        icon: '🐢',
        duration: 4,
        multiplier: 0.5,
        selfUsable: true,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 1,
        visualKind: 'slow',
        botRule: { self: -0.8, offense: 0.9, defensiveScale: 0.1, emergencyScale: 0.0, combatSelf: -0.3 },
    }),
    THICK: createPickupDefinition({
        name: 'Dick',
        color: 0xffcc00,
        icon: '🧱',
        duration: 5,
        trailWidth: 1.8,
        selfUsable: true,
        shootable: true,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 2,
        visualKind: 'thick',
        botRule: { self: 0.9, offense: 0.1, defensiveScale: 0.8, emergencyScale: 0.2, combatSelf: 0.4 },
    }),
    THIN: createPickupDefinition({
        name: 'Dünn',
        color: 0xaa44ff,
        icon: '✂',
        duration: 5,
        trailWidth: 0.2,
        selfUsable: true,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 3,
        visualKind: 'thin',
        botRule: { self: -0.6, offense: 0.7, defensiveScale: 0.2, emergencyScale: 0.0, combatSelf: -0.2 },
    }),
    SHIELD: createPickupDefinition({
        name: 'Schild',
        color: 0x4488ff,
        icon: '🛡',
        duration: 3,
        selfUsable: true,
        shootable: true,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 4,
        visualKind: 'shield',
        aliases: ['ITEM_HEALTH', 'ITEM_SHIELD'],
        botRule: { self: 0.5, offense: 0.0, defensiveScale: 1.2, emergencyScale: 2.5, combatSelf: 0.8 },
    }),
    SLOW_TIME: createPickupDefinition({
        name: 'Zeitlupe',
        color: 0x44ff88,
        icon: '🕙',
        duration: 4,
        timeScale: 0.4,
        selfUsable: true,
        shootable: true,
        offensive: false,
        projectileOnly: false,
        allowedModes: ['CLASSIC', 'ARCADE'],
        observationSlot: 5,
        visualKind: 'slow-time',
        botRule: { self: 0.7, offense: 0.35, defensiveScale: 0.6, emergencyScale: 0.4, combatSelf: 0.3 },
    }),
    GHOST: createPickupDefinition({
        name: 'Geist',
        color: 0xff66cc,
        icon: '👻',
        duration: 3,
        selfUsable: true,
        shootable: true,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 6,
        visualKind: 'ghost',
        botRule: { self: 0.95, offense: 0.1, defensiveScale: 1.0, emergencyScale: 2.0, combatSelf: 0.5 },
    }),
    INVERT: createPickupDefinition({
        name: 'Invertieren',
        color: 0xff00ff,
        icon: '🔀',
        duration: 4,
        selfUsable: true,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 7,
        visualKind: 'invert',
        botRule: { self: -0.7, offense: 0.85, defensiveScale: 0.15, emergencyScale: 0.0, combatSelf: -0.4 },
    }),
    ROCKET_WEAK: createPickupDefinition({
        name: 'Rakete S',
        color: 0xffcc66,
        icon: '🚀',
        duration: 0,
        damage: 10,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: true,
        allowedModes: ['HUNT'],
        observationSlot: 8,
        visualKind: 'rocket',
        visualScale: 0.88,
        rocketTier: 'WEAK',
        aliases: ['ROCKET', 'ROCKET_BASIC', 'ROCKET_LIGHT', 'ITEM_ROCKET'],
        botRule: { self: 0.06, offense: 0.45, defensiveScale: 0.02, emergencyScale: 0.05, combatSelf: 0.0 },
    }),
    ROCKET_MEDIUM: createPickupDefinition({
        name: 'Rakete M',
        color: 0xff8844,
        icon: '🚀',
        duration: 0,
        damage: 20,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: true,
        allowedModes: ['HUNT'],
        observationSlot: 9,
        visualKind: 'rocket',
        visualScale: 1.0,
        rocketTier: 'MEDIUM',
        botRule: { self: 0.06, offense: 0.5, defensiveScale: 0.02, emergencyScale: 0.05, combatSelf: 0.0 },
    }),
    ROCKET_HEAVY: createPickupDefinition({
        name: 'Rakete L',
        color: 0xff3344,
        icon: '🚀',
        duration: 0,
        damage: 40,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: true,
        allowedModes: ['HUNT'],
        observationSlot: 10,
        visualKind: 'rocket',
        visualScale: 1.14,
        rocketTier: 'HEAVY',
        aliases: ['ROCKET_STRONG', 'ROCKET_POWER'],
        botRule: { self: 0.06, offense: 0.56, defensiveScale: 0.02, emergencyScale: 0.06, combatSelf: 0.0 },
    }),
    ROCKET_MEGA: createPickupDefinition({
        name: 'Rakete XL',
        color: 0xcc11ff,
        icon: '🚀',
        duration: 0,
        damage: 70,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: true,
        allowedModes: ['HUNT'],
        observationSlot: 11,
        visualKind: 'rocket',
        visualScale: 1.35,
        rocketTier: 'MEGA',
        aliases: ['ROCKET_ULTRA'],
        botRule: { self: 0.06, offense: 0.65, defensiveScale: 0.03, emergencyScale: 0.08, combatSelf: 0.0 },
    }),
});

export const PICKUP_TYPES = Object.freeze(Object.keys(PICKUP_REGISTRY));

const PICKUP_TYPE_ALIASES = Object.freeze(
    PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = type;
        for (const alias of PICKUP_REGISTRY[type].aliases) {
            acc[String(alias || '').trim().toUpperCase()] = type;
        }
        return acc;
    }, Object.create(null))
);

function normalizeModeType(modeType) {
    const normalized = String(modeType || '').trim().toUpperCase();
    return normalized || null;
}

function resolveNormalizedPickupType(type, fallback = '') {
    const normalized = String(type || '').trim().toUpperCase();
    if (normalized) {
        return PICKUP_TYPE_ALIASES[normalized] || normalized;
    }
    const normalizedFallback = String(fallback || '').trim().toUpperCase();
    if (!normalizedFallback) return '';
    return PICKUP_TYPE_ALIASES[normalizedFallback] || normalizedFallback;
}

export function normalizePickupType(type, { fallback = '' } = {}) {
    return resolveNormalizedPickupType(type, fallback);
}

export function getPickupDefinition(type, { fallback = '' } = {}) {
    const normalizedType = resolveNormalizedPickupType(type, fallback);
    if (!normalizedType) return null;
    return PICKUP_REGISTRY[normalizedType] || null;
}

export function getPickupTypes() {
    return PICKUP_TYPES.slice();
}

export function getRocketPickupTypes() {
    return PICKUP_TYPES.filter((type) => PICKUP_REGISTRY[type]?.projectileOnly);
}

export function isPickupTypeAllowedForMode(type, modeType) {
    const definition = getPickupDefinition(type);
    const normalizedMode = normalizeModeType(modeType);
    if (!definition || !normalizedMode) return false;
    return definition.allowedModes.includes(normalizedMode);
}

export function isPickupTypeSelfUsable(type, modeType = null) {
    const definition = getPickupDefinition(type);
    if (!definition?.selfUsable) return false;
    if (modeType == null) return true;
    return isPickupTypeAllowedForMode(type, modeType);
}

export function isPickupTypeShootable(type, modeType = null) {
    const definition = getPickupDefinition(type);
    if (!definition?.shootable) return false;
    if (modeType == null) return true;
    return isPickupTypeAllowedForMode(type, modeType);
}

export function isPickupTypeOffensive(type) {
    return !!getPickupDefinition(type)?.offensive;
}

export function isRocketPickupType(type) {
    return !!getPickupDefinition(type)?.projectileOnly;
}

export function getPickupObservationSlotIndex(type) {
    const definition = getPickupDefinition(type);
    return Number.isInteger(definition?.observationSlot)
        ? definition.observationSlot
        : PICKUP_SLOT_UNKNOWN_INDEX;
}

export function getPickupVisualDescriptor(type) {
    const definition = getPickupDefinition(type);
    if (!definition) return null;
    return Object.freeze({
        kind: definition.visualKind,
        scale: definition.visualScale,
    });
}

export function createPickupBotRuleMap() {
    const rules = PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = PICKUP_REGISTRY[type].botRule;
        return acc;
    }, {});
    return Object.freeze(rules);
}

function createPickupTypeConfigEntry(definition) {
    const entry = {
        name: definition.name,
        color: definition.color,
        icon: definition.icon,
        duration: Number.isFinite(Number(definition.duration)) ? Number(definition.duration) : 0,
    };
    if (Number.isFinite(Number(definition.multiplier))) {
        entry.multiplier = Number(definition.multiplier);
    }
    if (Number.isFinite(Number(definition.trailWidth))) {
        entry.trailWidth = Number(definition.trailWidth);
    }
    if (Number.isFinite(Number(definition.timeScale))) {
        entry.timeScale = Number(definition.timeScale);
    }
    if (Number.isFinite(Number(definition.damage))) {
        entry.damage = Number(definition.damage);
    }
    if (definition.allowedModes.length === 1 && definition.allowedModes[0] === 'HUNT') {
        entry.huntOnly = true;
    }
    return Object.freeze(entry);
}

export function createPickupTypeConfigMap() {
    const configMap = PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = createPickupTypeConfigEntry(PICKUP_REGISTRY[type]);
        return acc;
    }, {});
    return Object.freeze(configMap);
}
