import { FLAMETHROWER_PICKUP_DEFINITIONS } from './FlamethrowerPickupDefinitionsContract.js';
import { LIGHTNING_PICKUP_DEFINITIONS } from './LightningPickupDefinitionsContract.js';
import { RAILGUN_PICKUP_DEFINITIONS } from './RailgunPickupDefinitionsContract.js';
import { PICKUP_EXPANSION_DEFINITIONS } from './PickupExpansionDefinitionsContract.js';
import { ROCKET_PICKUP_DEFINITIONS } from './RocketPickupDefinitionsContract.js';
import { WEAPON_FAN_PICKUP_DEFINITIONS } from './WeaponFanPickupDefinitionsContract.js';

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
        spawnWeights: Object.freeze({
            CLASSIC: 1,
            ARCADE: 1,
            HUNT: 1,
            ...(definition.spawnWeights || {}),
        }),
        botRule: Object.freeze({
            ...DEFAULT_BOT_RULE,
            ...(definition.botRule || {}),
        }),
        visualScale: Number.isFinite(Number(definition.visualScale)) ? Number(definition.visualScale) : 1,
        actionRole: String(definition.actionRole || (definition.offensive ? 'debuff' : 'buff')),
        stackPolicy: String(definition.stackPolicy || 'refresh'),
        effectCategory: String(definition.effectCategory || definition.visualKind || ''),
        animationKind: String(definition.animationKind || 'float'),
        playable: definition.playable !== false,
    });
}

export const PICKUP_SLOT_COUNT = 20;
export const PICKUP_SLOT_UNKNOWN_INDEX = 19;

export const PICKUP_REGISTRY = Object.freeze({
    SPEED_UP: createPickupDefinition({
        name: 'Schneller',
        color: 0x00ff66,
        icon: '⚡',
        description: 'Beschleunigt den getroffenen Gegner 8 Sekunden lang auf 160 % Grundgeschwindigkeit.',
        duration: 8,
        multiplier: 1.6,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 0,
        visualKind: 'speed',
        effectCategory: 'speed',
        stackPolicy: 'replace-category',
        animationKind: 'surge',
        aliases: ['ITEM_BATTERY'],
        spawnWeights: { CLASSIC: 1.15, ARCADE: 1.1 },
        botRule: {
            self: -0.8,
            offense: 0.85,
            defensiveScale: 0,
            emergencyScale: 0,
            combatSelf: -0.3,
        },
    }),
    SLOW_DOWN: createPickupDefinition({
        name: 'Langsamer',
        description: 'Verlangsamt den getroffenen Gegner 8 Sekunden lang auf halbe Geschwindigkeit.',
        color: 0xff3333,
        icon: '🐢',
        duration: 8,
        multiplier: 0.5,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 1,
        visualKind: 'slow',
        effectCategory: 'speed',
        stackPolicy: 'replace-category',
        animationKind: 'wobble',
        spawnWeights: { CLASSIC: 0.9, ARCADE: 0.85 },
        botRule: {
            self: -0.8,
            offense: 0.9,
            defensiveScale: 0.1,
            emergencyScale: 0.0,
            combatSelf: -0.3,
        },
    }),
    THICK: createPickupDefinition({
        name: 'Dick',
        description: 'Erzeugt 10 Sekunden lang neue Spur mit 3 Einheiten Breite.',
        color: 0xffcc00,
        icon: '🧱',
        duration: 10,
        trailWidth: 3,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 2,
        visualKind: 'thick',
        effectCategory: 'trail-width',
        stackPolicy: 'replace-category',
        spawnWeights: { CLASSIC: 1.0, ARCADE: 0.95 },
        botRule: {
            self: 0.9,
            offense: 0.1,
            defensiveScale: 0.8,
            emergencyScale: 0.2,
            combatSelf: 0.4,
        },
    }),
    THIN: createPickupDefinition({
        name: 'Dünn',
        description: 'Der getroffene Gegner erzeugt 10 Sekunden lang neue Spur mit 0,2 Einheiten Breite.',
        color: 0xaa44ff,
        icon: '✂',
        duration: 10,
        trailWidth: 0.2,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 3,
        visualKind: 'thin',
        effectCategory: 'trail-width',
        stackPolicy: 'replace-category',
        spawnWeights: { CLASSIC: 0.9, ARCADE: 0.85 },
        botRule: {
            self: -0.6,
            offense: 0.7,
            defensiveScale: 0.2,
            emergencyScale: 0.0,
            combatSelf: -0.2,
        },
    }),
    SHIELD: createPickupDefinition({
        name: 'Schild',
        color: 0x4488ff,
        icon: '🛡',
        duration: 3,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 4,
        visualKind: 'shield',
        effectCategory: 'shield',
        animationKind: 'pulse',
        aliases: ['ITEM_SHIELD'],
        spawnWeights: { CLASSIC: 0.7, ARCADE: 0.8 },
        botRule: {
            self: 0.5,
            offense: 0.0,
            defensiveScale: 1.2,
            emergencyScale: 2.5,
            combatSelf: 0.8,
        },
    }),
    HEALTH: createPickupDefinition({
        name: 'Medipack',
        color: 0x44ff88,
        icon: '+',
        duration: 0,
        healing: 35,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ['ARCADE', 'HUNT'],
        observationSlot: 12,
        visualKind: 'health',
        actionRole: 'instant',
        stackPolicy: 'instant',
        aliases: ['ITEM_HEALTH'],
        spawnWeights: { CLASSIC: 0, ARCADE: 1.2, HUNT: 1.0 },
        botRule: {
            self: 0.8,
            offense: -0.2,
            defensiveScale: 1.1,
            emergencyScale: 2.2,
            combatSelf: 0.6,
        },
    }),
    MG_TURRET: createPickupDefinition({
        name: 'MG-Geschuetz',
        color: 0xffb347,
        icon: 'MG',
        duration: 0,
        selfUsable: true,
        shootable: false,
        offensive: true,
        projectileOnly: false,
        allowedModes: ['HUNT'],
        observationSlot: 13,
        visualKind: 'turret',
        actionRole: 'deployment',
        stackPolicy: 'instant',
        aliases: ['TURRET', 'ITEM_TURRET', 'MG_GESCHUETZ'],
        spawnWeights: { CLASSIC: 0, ARCADE: 0, HUNT: 0.45 },
        botRule: {
            self: 0.65,
            offense: 0.75,
            defensiveScale: 0.2,
            emergencyScale: 0.15,
            combatSelf: 0.85,
        },
    }),
    ROCKET_TURRET: createPickupDefinition({
        name: 'Raketenwerfer',
        color: 0xff4d6d,
        icon: 'RW',
        duration: 0,
        selfUsable: true,
        shootable: false,
        offensive: true,
        projectileOnly: false,
        allowedModes: ['HUNT'],
        observationSlot: 13,
        visualKind: 'rocket-turret',
        actionRole: 'deployment',
        stackPolicy: 'instant',
        aliases: ['ITEM_ROCKET_TURRET', 'RAKETENWERFER'],
        spawnWeights: { CLASSIC: 0, ARCADE: 0, HUNT: 0.225 },
        botRule: {
            self: 0.65,
            offense: 0.75,
            defensiveScale: 0.2,
            emergencyScale: 0.15,
            combatSelf: 0.85,
        },
    }),
    SLOW_TIME: createPickupDefinition({
        name: 'Zeitlupe',
        description: 'Verlangsamt das gesamte Spiel 10 Sekunden lang auf 40 % Spielgeschwindigkeit.',
        color: 0x44ff88,
        icon: '🕙',
        duration: 10,
        timeScale: 0.4,
        timeScaleExemptsOwner: true,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 5,
        visualKind: 'slow-time',
        animationKind: 'orbit',
        spawnWeights: { CLASSIC: 0.35, ARCADE: 0.45, HUNT: 1 },
        botRule: {
            self: 0.7,
            offense: 0.35,
            defensiveScale: 0.6,
            emergencyScale: 0.4,
            combatSelf: 0.3,
        },
    }),
    GHOST: createPickupDefinition({
        name: 'Geist',
        description: 'Ignoriert 10 Sekunden lang die bestehende Kollisionswirkung.',
        color: 0xff66cc,
        icon: '👻',
        duration: 10,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 6,
        visualKind: 'ghost',
        animationKind: 'phase',
        spawnWeights: { CLASSIC: 0.55, ARCADE: 0.65 },
        botRule: {
            self: 0.95,
            offense: 0.1,
            defensiveScale: 1.0,
            emergencyScale: 2.0,
            combatSelf: 0.5,
        },
    }),
    INVERT: createPickupDefinition({
        name: 'Invertieren',
        description: 'Kehrt die Steuerung des getroffenen Gegners 8 Sekunden lang um.',
        color: 0xff00ff,
        icon: '🔀',
        duration: 8,
        selfUsable: false,
        shootable: true,
        offensive: true,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 7,
        visualKind: 'invert',
        animationKind: 'counter-spin',
        spawnWeights: { CLASSIC: 0.7, ARCADE: 0.65 },
        botRule: {
            self: -0.7,
            offense: 0.85,
            defensiveScale: 0.15,
            emergencyScale: 0.0,
            combatSelf: -0.4,
        },
    }),
    FOG: createPickupDefinition({
        name: 'Nebel',
        description: 'Reduziert die Sicht aller Spieler 8 Sekunden lang. Weitere Nutzungen verlängern den Nebel.',
        color: 0xd7dce2,
        icon: '☁',
        duration: 8,
        selfUsable: true,
        shootable: false,
        offensive: false,
        projectileOnly: false,
        allowedModes: ALL_GAME_MODES,
        observationSlot: 19,
        visualKind: 'fog',
        actionRole: 'global',
        effectCategory: 'global-fog',
        stackPolicy: 'add-duration',
        aliases: ['ITEM_FOG', 'NEBEL'],
        spawnWeights: { CLASSIC: 0.7, ARCADE: 0.7, HUNT: 0.7 },
        botRule: {
            self: 0.45,
            offense: 0.25,
            defensiveScale: 0.5,
            emergencyScale: 0.15,
            combatSelf: 0.35,
        },
    }),
    ...Object.fromEntries(
        Object.entries(WEAPON_FAN_PICKUP_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])
    ),
    ...Object.fromEntries(Object.entries(PICKUP_EXPANSION_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])),
    ...Object.fromEntries(
        Object.entries(ROCKET_PICKUP_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])
    ),
    ...Object.fromEntries(
        Object.entries(FLAMETHROWER_PICKUP_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])
    ),
    ...Object.fromEntries(
        Object.entries(LIGHTNING_PICKUP_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])
    ),
    ...Object.fromEntries(
        Object.entries(RAILGUN_PICKUP_DEFINITIONS).map(([type, definition]) => [type, createPickupDefinition(definition)])
    ),
});

export const PICKUP_TYPES = Object.freeze(Object.keys(PICKUP_REGISTRY));

const PICKUP_TYPE_ALIASES = Object.freeze(
    PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = type;
        for (const alias of PICKUP_REGISTRY[type].aliases) {
            acc[
                String(alias || '')
                    .trim()
                    .toUpperCase()
            ] = type;
        }
        return acc;
    }, Object.create(null))
);

function normalizeModeType(modeType) {
    const normalized = String(modeType || '')
        .trim()
        .toUpperCase();
    return normalized || null;
}

function resolveNormalizedPickupType(type, fallback = '') {
    const normalized = String(type || '')
        .trim()
        .toUpperCase();
    if (normalized) {
        return PICKUP_TYPE_ALIASES[normalized] || normalized;
    }
    const normalizedFallback = String(fallback || '')
        .trim()
        .toUpperCase();
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
    if (!definition || definition.playable === false || !normalizedMode) return false;
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
    return Number.isInteger(definition?.observationSlot) ? definition.observationSlot : PICKUP_SLOT_UNKNOWN_INDEX;
}

export function getPickupVisualDescriptor(type) {
    const definition = getPickupDefinition(type);
    if (!definition) return null;
    return Object.freeze({
        kind: definition.visualKind,
        scale: definition.visualScale,
        animation: definition.animationKind,
        rocketTier: definition.rocketTier || null,
        tierLabel: definition.rocketTierLabel || '',
        fanProjectiles: Number.isFinite(Number(definition.fanProjectiles)) ? Number(definition.fanProjectiles) : 0,
    });
}

export function getPickupSpawnWeight(type, modeType, configuredTypes = null) {
    const normalizedType = normalizePickupType(type);
    const normalizedMode = normalizeModeType(modeType);
    if (!normalizedType || !normalizedMode) return 0;
    const configuredWeight = Number(configuredTypes?.[normalizedType]?.spawnWeights?.[normalizedMode]);
    if (Number.isFinite(configuredWeight)) return Math.max(0, configuredWeight);
    const definitionWeight = Number(PICKUP_REGISTRY[normalizedType]?.spawnWeights?.[normalizedMode]);
    return Number.isFinite(definitionWeight) ? Math.max(0, definitionWeight) : 1;
}

export function pickWeightedPickupType(types, modeType, random = Math.random, configuredTypes = null) {
    if (!Array.isArray(types) || types.length === 0) return null;
    const weighted = [];
    let totalWeight = 0;
    for (const candidate of types) {
        const type = normalizePickupType(candidate);
        if (!type || !isPickupTypeAllowedForMode(type, modeType)) continue;
        const weight = getPickupSpawnWeight(type, modeType, configuredTypes);
        if (weight <= 0) continue;
        totalWeight += weight;
        weighted.push({ type, totalWeight });
    }
    if (weighted.length === 0 || totalWeight <= 0) return null;
    const sampled = Number(typeof random === 'function' ? random() : 0);
    const roll = Math.max(0, Math.min(0.999999999, Number.isFinite(sampled) ? sampled : 0)) * totalWeight;
    for (const entry of weighted) {
        if (roll < entry.totalWeight) return entry.type;
    }
    return weighted[weighted.length - 1].type;
}

export function createPickupBotRuleMap() {
    const rules = PICKUP_TYPES.reduce((acc, type) => {
        acc[type] = PICKUP_REGISTRY[type].botRule;
        return acc;
    }, {});
    return Object.freeze(rules);
}
