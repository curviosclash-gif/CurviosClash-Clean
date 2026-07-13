/**
 * FightHangarBalanceContract - V76 76.4
 *
 * Fight build stats are derived-only: HP, speed, inventory slots and MG count
 * come from hitbox class plus bounded tier inputs. Direct free-value overrides
 * are rejected by contract guards.
 */
import { ARCADE_HITBOX_CLASSES } from '../../entities/arcade/ArcadeBlueprintSchema.js';

export const FIGHT_HANGAR_BALANCE_CONTRACT_VERSION = 'fight-hangar-balance.v2';

export const FIGHT_HITBOX_CLASSES = Object.freeze({
    compact: 'compact',
    standard: 'standard',
    heavy: 'heavy',
});

export const FIGHT_HITBOX_CLASS_LABELS = Object.freeze({
    [FIGHT_HITBOX_CLASSES.compact]: 'kompakt',
    [FIGHT_HITBOX_CLASSES.standard]: 'standard',
    [FIGHT_HITBOX_CLASSES.heavy]: 'schwer',
});

export const FIGHT_HITBOX_CLASS_ALIASES = Object.freeze({
    compact: FIGHT_HITBOX_CLASSES.compact,
    kompakt: FIGHT_HITBOX_CLASSES.compact,
    standard: FIGHT_HITBOX_CLASSES.standard,
    heavy: FIGHT_HITBOX_CLASSES.heavy,
    schwer: FIGHT_HITBOX_CLASSES.heavy,
});

export const FIGHT_DERIVED_STAT_IDS = Object.freeze({
    HP: 'hp',
    SPEED_NORM: 'speedNorm',
    INVENTORY_SLOTS: 'inventorySlots',
    MG_COUNT: 'mgCount',
});

export const FIGHT_BUILD_TIER_IDS = Object.freeze({
    ARMOR: 'armorTier',
    MOBILITY: 'mobilityTier',
    PAYLOAD: 'payloadTier',
});

export const FIGHT_BALANCE_DERIVATION_POLICY = Object.freeze({
    policyVersion: 'fight-derived-only.v1',
    mode: 'derived-only',
    disallowDirectStatPaths: Object.freeze([
        'gameplay.fightPlayerHp',
        'gameplay.fightMgDamage',
        'fight.hp',
        'fight.speedNorm',
        'fight.inventorySlots',
        'fight.mgCount',
        'hp',
        'speedNorm',
        'inventorySlots',
        'mgCount',
    ]),
    tierBounds: Object.freeze({
        min: 0,
        max: 2,
    }),
    inputFields: Object.freeze([
        'hitboxClass',
        FIGHT_BUILD_TIER_IDS.ARMOR,
        FIGHT_BUILD_TIER_IDS.MOBILITY,
        FIGHT_BUILD_TIER_IDS.PAYLOAD,
    ]),
    derivedStatFields: Object.freeze(Object.values(FIGHT_DERIVED_STAT_IDS)),
});

export const FIGHT_EXPLOIT_GUARD_CODES = Object.freeze({
    OK: 'ok',
    UNKNOWN_HITBOX_CLASS: 'unknown_hitbox_class',
    DIRECT_OVERRIDE_BLOCKED: 'direct_override_blocked',
    TIER_OUT_OF_RANGE: 'tier_out_of_range',
});

export const FIGHT_LIVE_RULE_EXPLANATION_VERSION = 'fight-live-rule-explanation.v1';

export const FIGHT_CLASS_STAT_BANDS = Object.freeze({
    [FIGHT_HITBOX_CLASSES.compact]: Object.freeze({
        hitboxClass: FIGHT_HITBOX_CLASSES.compact,
        hitboxLimits: ARCADE_HITBOX_CLASSES.compact,
        baseHp: 90,
        speedNorm: 1.16,
        inventorySlots: 3,
        mgCount: 1,
        safetyEnvelope: Object.freeze({
            hp: Object.freeze({ min: 78, max: 108 }),
            speedNorm: Object.freeze({ min: 1.02, max: 1.28 }),
            inventorySlots: Object.freeze({ min: 2, max: 4 }),
            mgCount: Object.freeze({ min: 1, max: 2 }),
        }),
        description: 'Schnell und wendig; kleines HP-Budget und begrenzte Nutzlast.',
    }),
    [FIGHT_HITBOX_CLASSES.standard]: Object.freeze({
        hitboxClass: FIGHT_HITBOX_CLASSES.standard,
        hitboxLimits: ARCADE_HITBOX_CLASSES.standard,
        baseHp: 124,
        speedNorm: 1.0,
        inventorySlots: 5,
        mgCount: 2,
        safetyEnvelope: Object.freeze({
            hp: Object.freeze({ min: 108, max: 150 }),
            speedNorm: Object.freeze({ min: 0.88, max: 1.12 }),
            inventorySlots: Object.freeze({ min: 4, max: 6 }),
            mgCount: Object.freeze({ min: 1, max: 3 }),
        }),
        description: 'Ausgewogen; mittleres HP-Budget und Standard-Ausstattung.',
    }),
    [FIGHT_HITBOX_CLASSES.heavy]: Object.freeze({
        hitboxClass: FIGHT_HITBOX_CLASSES.heavy,
        hitboxLimits: ARCADE_HITBOX_CLASSES.heavy,
        baseHp: 176,
        speedNorm: 0.84,
        inventorySlots: 7,
        mgCount: 3,
        safetyEnvelope: Object.freeze({
            hp: Object.freeze({ min: 152, max: 208 }),
            speedNorm: Object.freeze({ min: 0.72, max: 0.96 }),
            inventorySlots: Object.freeze({ min: 6, max: 8 }),
            mgCount: Object.freeze({ min: 2, max: 4 }),
        }),
        description: 'Robust und schwer; hohes HP-Budget und hohe Nutzlast.',
    }),
});

export const FIGHT_TIER_STAT_DELTAS = Object.freeze({
    [FIGHT_BUILD_TIER_IDS.ARMOR]: Object.freeze({
        [FIGHT_DERIVED_STAT_IDS.HP]: Object.freeze([0, 10, 20]),
        [FIGHT_DERIVED_STAT_IDS.SPEED_NORM]: Object.freeze([0, -0.03, -0.06]),
    }),
    [FIGHT_BUILD_TIER_IDS.MOBILITY]: Object.freeze({
        [FIGHT_DERIVED_STAT_IDS.HP]: Object.freeze([0, -4, -8]),
        [FIGHT_DERIVED_STAT_IDS.SPEED_NORM]: Object.freeze([0, 0.06, 0.12]),
    }),
    [FIGHT_BUILD_TIER_IDS.PAYLOAD]: Object.freeze({
        [FIGHT_DERIVED_STAT_IDS.SPEED_NORM]: Object.freeze([0, -0.02, -0.04]),
        [FIGHT_DERIVED_STAT_IDS.INVENTORY_SLOTS]: Object.freeze([0, 1, 2]),
        [FIGHT_DERIVED_STAT_IDS.MG_COUNT]: Object.freeze([0, 0, 1]),
    }),
});

const VALID_HITBOX_CLASS_SET = new Set(Object.values(FIGHT_HITBOX_CLASSES));
const VALID_HITBOX_ALIAS_SET = new Set(Object.keys(FIGHT_HITBOX_CLASS_ALIASES));
const BLOCKED_DIRECT_STAT_FIELD_SET = new Set(
    FIGHT_BALANCE_DERIVATION_POLICY.disallowDirectStatPaths.map((entry) => String(entry || '').split('.').pop())
);

function clampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function clampTier(value) {
    const bounds = FIGHT_BALANCE_DERIVATION_POLICY.tierBounds;
    const n = Math.floor(Number(value) || 0);
    return Math.max(bounds.min, Math.min(bounds.max, n));
}

function toTierVector(rawInput) {
    const source = rawInput && typeof rawInput === 'object' ? rawInput : {};
    return Object.freeze({
        [FIGHT_BUILD_TIER_IDS.ARMOR]: clampTier(source[FIGHT_BUILD_TIER_IDS.ARMOR]),
        [FIGHT_BUILD_TIER_IDS.MOBILITY]: clampTier(source[FIGHT_BUILD_TIER_IDS.MOBILITY]),
        [FIGHT_BUILD_TIER_IDS.PAYLOAD]: clampTier(source[FIGHT_BUILD_TIER_IDS.PAYLOAD]),
    });
}

function resolveInputObject(rawInput) {
    if (rawInput && typeof rawInput === 'object') return rawInput;
    return { hitboxClass: rawInput };
}

function applyTierDelta(baseValue, deltaVector, tier) {
    if (!Array.isArray(deltaVector)) return baseValue;
    const delta = Number(deltaVector[tier]) || 0;
    return Number(baseValue) + delta;
}

function collectBlockedDirectStatPaths(node, pathPrefix = '', out = []) {
    if (!node || typeof node !== 'object') return out;
    const entries = Object.entries(node);
    for (const [rawKey, value] of entries) {
        const key = String(rawKey || '').trim();
        if (!key) continue;
        const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        const keyLower = key.toLowerCase();
        const pathLower = nextPath.toLowerCase();
        if (BLOCKED_DIRECT_STAT_FIELD_SET.has(keyLower)) {
            out.push(nextPath);
            continue;
        }
        if (FIGHT_BALANCE_DERIVATION_POLICY.disallowDirectStatPaths.includes(pathLower)) {
            out.push(nextPath);
            continue;
        }
        if (value && typeof value === 'object') {
            collectBlockedDirectStatPaths(value, nextPath, out);
        }
    }
    return out;
}

export function resolveFightHitboxClass(rawClass) {
    const normalized = String(rawClass || '').trim().toLowerCase();
    if (VALID_HITBOX_CLASS_SET.has(normalized)) return normalized;
    if (Object.prototype.hasOwnProperty.call(FIGHT_HITBOX_CLASS_ALIASES, normalized)) {
        return FIGHT_HITBOX_CLASS_ALIASES[normalized];
    }
    return FIGHT_HITBOX_CLASSES.standard;
}

export function resolveFightHitboxBalanceContract() {
    return Object.freeze(
        Object.values(FIGHT_HITBOX_CLASSES).map((hitboxClass) => {
            const band = FIGHT_CLASS_STAT_BANDS[hitboxClass] || null;
            return Object.freeze({
                hitboxClass,
                label: FIGHT_HITBOX_CLASS_LABELS[hitboxClass] || hitboxClass,
                statBand: band
                    ? Object.freeze({
                        hp: Object.freeze({
                            base: band.baseHp,
                            min: band.safetyEnvelope?.hp?.min ?? band.baseHp,
                            max: band.safetyEnvelope?.hp?.max ?? band.baseHp,
                        }),
                        speedNorm: Object.freeze({
                            base: band.speedNorm,
                            min: band.safetyEnvelope?.speedNorm?.min ?? band.speedNorm,
                            max: band.safetyEnvelope?.speedNorm?.max ?? band.speedNorm,
                        }),
                        inventorySlots: Object.freeze({
                            base: band.inventorySlots,
                            min: band.safetyEnvelope?.inventorySlots?.min ?? band.inventorySlots,
                            max: band.safetyEnvelope?.inventorySlots?.max ?? band.inventorySlots,
                        }),
                        mgCount: Object.freeze({
                            base: band.mgCount,
                            min: band.safetyEnvelope?.mgCount?.min ?? band.mgCount,
                            max: band.safetyEnvelope?.mgCount?.max ?? band.mgCount,
                        }),
                    })
                    : null,
                description: band?.description || '',
            });
        })
    );
}

export function resolveFightBuildTierVector(rawInput) {
    return toTierVector(resolveInputObject(rawInput));
}

export function validateFightBuildDerivationInput(rawInput) {
    const input = resolveInputObject(rawInput);
    const hitboxClass = resolveFightHitboxClass(input.hitboxClass);
    const normalizedRawHitbox = String(input.hitboxClass || '').trim().toLowerCase();
    const tiers = toTierVector(input);
    const blockedDirectStatPaths = collectBlockedDirectStatPaths(input);
    const errors = [];

    if (!VALID_HITBOX_CLASS_SET.has(normalizedRawHitbox) && !VALID_HITBOX_ALIAS_SET.has(normalizedRawHitbox)) {
        errors.push(`unknown hitbox class: ${String(input.hitboxClass || '')}`);
    }
    if (blockedDirectStatPaths.length > 0) {
        errors.push(`direct stat override blocked: ${blockedDirectStatPaths.join(', ')}`);
    }

    return Object.freeze({
        ok: errors.length === 0,
        errors: Object.freeze(errors),
        hitboxClass,
        tiers,
        blockedDirectStatPaths: Object.freeze([...new Set(blockedDirectStatPaths)]),
        policyVersion: FIGHT_BALANCE_DERIVATION_POLICY.policyVersion,
    });
}

function collectOutOfRangeTierPaths(rawInput) {
    const input = resolveInputObject(rawInput);
    const bounds = FIGHT_BALANCE_DERIVATION_POLICY.tierBounds;
    const tierKeys = Object.values(FIGHT_BUILD_TIER_IDS);
    return tierKeys
        .map((key) => {
            const raw = Number(input[key]);
            if (!Number.isFinite(raw)) return null;
            if (raw < bounds.min || raw > bounds.max) return key;
            return null;
        })
        .filter(Boolean);
}

export function evaluateFightBuildExploitGuard(rawInput) {
    const validation = validateFightBuildDerivationInput(rawInput);
    const outOfRangeTierPaths = Object.freeze(collectOutOfRangeTierPaths(rawInput));
    const violations = [];
    let primaryCode = FIGHT_EXPLOIT_GUARD_CODES.OK;

    if (validation.errors.some((entry) => String(entry || '').startsWith('unknown hitbox class:'))) {
        primaryCode = FIGHT_EXPLOIT_GUARD_CODES.UNKNOWN_HITBOX_CLASS;
        violations.push('Hitbox-Klasse ist unbekannt.');
    }
    if (validation.blockedDirectStatPaths.length > 0) {
        if (primaryCode === FIGHT_EXPLOIT_GUARD_CODES.OK) primaryCode = FIGHT_EXPLOIT_GUARD_CODES.DIRECT_OVERRIDE_BLOCKED;
        violations.push(`Direktwerte fuer Fight-Stats sind gesperrt (${validation.blockedDirectStatPaths.join(', ')}).`);
    }
    if (outOfRangeTierPaths.length > 0) {
        if (primaryCode === FIGHT_EXPLOIT_GUARD_CODES.OK) primaryCode = FIGHT_EXPLOIT_GUARD_CODES.TIER_OUT_OF_RANGE;
        violations.push(`Tier-Werte ausserhalb der erlaubten Grenzen (${outOfRangeTierPaths.join(', ')}).`);
    }

    return Object.freeze({
        ok: primaryCode === FIGHT_EXPLOIT_GUARD_CODES.OK,
        code: primaryCode,
        violations: Object.freeze(violations),
        blockedDirectStatPaths: validation.blockedDirectStatPaths,
        outOfRangeTierPaths,
    });
}

export function resolveFightLiveRuleExplanation(rawInput) {
    const stats = resolveFightVehicleStats(rawInput);
    const guard = evaluateFightBuildExploitGuard(rawInput);
    const classLabel = FIGHT_HITBOX_CLASS_LABELS[stats.hitboxClass] || stats.hitboxClass;
    const tiers = stats.tiers || {};
    return Object.freeze({
        version: FIGHT_LIVE_RULE_EXPLANATION_VERSION,
        title: `Fight-Regeln: ${classLabel}`,
        summary: Object.freeze([
            'HP, Speed, Inventar-Slots und MG-Anzahl werden nur aus Klasse + Tier abgeleitet.',
            'Freie Direktwerte fuer Kampf-Stats sind blockiert und loesen Exploit-Guards aus.',
            'Alle Werte bleiben innerhalb der Safety-Envelopes pro Hitbox-Klasse.',
        ]),
        tierState: Object.freeze({
            armorTier: tiers.armorTier ?? 0,
            mobilityTier: tiers.mobilityTier ?? 0,
            payloadTier: tiers.payloadTier ?? 0,
        }),
        derivedStats: Object.freeze({
            hp: stats.hp,
            speedNorm: stats.speedNorm,
            inventorySlots: stats.inventorySlots,
            mgCount: stats.mgCount,
        }),
        guard,
    });
}

export function resolveFightVehicleStats(rawInput) {
    const input = resolveInputObject(rawInput);
    const validation = validateFightBuildDerivationInput(input);
    const hitboxClass = validation.hitboxClass;
    const tiers = validation.tiers;
    const band = FIGHT_CLASS_STAT_BANDS[hitboxClass] || FIGHT_CLASS_STAT_BANDS[FIGHT_HITBOX_CLASSES.standard];
    const envelope = band.safetyEnvelope || {};

    let hp = band.baseHp;
    hp = applyTierDelta(hp, FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.ARMOR]?.[FIGHT_DERIVED_STAT_IDS.HP], tiers.armorTier);
    hp = applyTierDelta(hp, FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.MOBILITY]?.[FIGHT_DERIVED_STAT_IDS.HP], tiers.mobilityTier);
    hp = Math.round(clampNumber(hp, envelope.hp?.min ?? band.baseHp, envelope.hp?.max ?? band.baseHp));

    let speedNorm = band.speedNorm;
    speedNorm = applyTierDelta(
        speedNorm,
        FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.ARMOR]?.[FIGHT_DERIVED_STAT_IDS.SPEED_NORM],
        tiers.armorTier
    );
    speedNorm = applyTierDelta(
        speedNorm,
        FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.MOBILITY]?.[FIGHT_DERIVED_STAT_IDS.SPEED_NORM],
        tiers.mobilityTier
    );
    speedNorm = applyTierDelta(
        speedNorm,
        FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.PAYLOAD]?.[FIGHT_DERIVED_STAT_IDS.SPEED_NORM],
        tiers.payloadTier
    );
    speedNorm = Number(clampNumber(speedNorm, envelope.speedNorm?.min ?? band.speedNorm, envelope.speedNorm?.max ?? band.speedNorm).toFixed(2));

    let inventorySlots = band.inventorySlots;
    inventorySlots = applyTierDelta(
        inventorySlots,
        FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.PAYLOAD]?.[FIGHT_DERIVED_STAT_IDS.INVENTORY_SLOTS],
        tiers.payloadTier
    );
    inventorySlots = Math.round(
        clampNumber(inventorySlots, envelope.inventorySlots?.min ?? band.inventorySlots, envelope.inventorySlots?.max ?? band.inventorySlots)
    );

    let mgCount = band.mgCount;
    mgCount = applyTierDelta(
        mgCount,
        FIGHT_TIER_STAT_DELTAS[FIGHT_BUILD_TIER_IDS.PAYLOAD]?.[FIGHT_DERIVED_STAT_IDS.MG_COUNT],
        tiers.payloadTier
    );
    mgCount = Math.round(clampNumber(mgCount, envelope.mgCount?.min ?? band.mgCount, envelope.mgCount?.max ?? band.mgCount));

    return Object.freeze({
        contractVersion: FIGHT_HANGAR_BALANCE_CONTRACT_VERSION,
        policyVersion: FIGHT_BALANCE_DERIVATION_POLICY.policyVersion,
        liveRuleExplanationVersion: FIGHT_LIVE_RULE_EXPLANATION_VERSION,
        derivedOnly: true,
        hitboxClass,
        hitboxLimits: band.hitboxLimits,
        description: band.description,
        tiers,
        hp,
        speedNorm,
        inventorySlots,
        mgCount,
        blockedDirectStatPaths: validation.blockedDirectStatPaths,
    });
}

export function validateFightBlueprintClass(blueprint) {
    if (!blueprint || typeof blueprint !== 'object') {
        return {
            ok: false,
            errors: ['missing blueprint'],
            hitboxClass: FIGHT_HITBOX_CLASSES.standard,
            derivedStats: resolveFightVehicleStats(FIGHT_HITBOX_CLASSES.standard),
        };
    }

    const hitboxClass = resolveFightHitboxClass(blueprint.hitboxClass);
    const band = FIGHT_CLASS_STAT_BANDS[hitboxClass];
    const limits = band.hitboxLimits;
    const stats = blueprint.stats && typeof blueprint.stats === 'object' ? blueprint.stats : {};
    const extents = stats.extents && typeof stats.extents === 'object' ? stats.extents : {};
    const errors = [];

    if ((Number(stats.radius) || 0) > limits.maxRadius) {
        errors.push(`hitbox radius exceeds ${hitboxClass} limit (${stats.radius}/${limits.maxRadius})`);
    }
    if ((Number(extents.width) || 0) > limits.maxWidth) {
        errors.push(`hitbox width exceeds ${hitboxClass} limit (${extents.width}/${limits.maxWidth})`);
    }
    if ((Number(extents.height) || 0) > limits.maxHeight) {
        errors.push(`hitbox height exceeds ${hitboxClass} limit (${extents.height}/${limits.maxHeight})`);
    }
    if ((Number(extents.length) || 0) > limits.maxLength) {
        errors.push(`hitbox length exceeds ${hitboxClass} limit (${extents.length}/${limits.maxLength})`);
    }

    const blockedDirectStatPaths = collectBlockedDirectStatPaths(blueprint);
    if (blockedDirectStatPaths.length > 0) {
        errors.push(`direct stat override blocked: ${blockedDirectStatPaths.join(', ')}`);
    }

    return {
        ok: errors.length === 0,
        errors,
        hitboxClass,
        derivedStats: resolveFightVehicleStats({ hitboxClass }),
    };
}
