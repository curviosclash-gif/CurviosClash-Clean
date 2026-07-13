const SLOT_PATTERNS = Object.freeze({
    core: [/core/i, /fuselage/i, /body/i],
    nose: [/nose/i, /cockpit/i, /head/i],
    wing_left: [/l[-_ ]?wing/i, /wing[-_ ]?l/i],
    wing_right: [/r[-_ ]?wing/i, /wing[-_ ]?r/i],
    engine_left: [/l[-_ ]?engine/i, /engine[-_ ]?l/i],
    engine_right: [/r[-_ ]?engine/i, /engine[-_ ]?r/i],
    utility: [/utility/i, /sensor/i, /module/i, /shield/i],
});

const PART_COSTS = Object.freeze({
    box: { mass: 2.2, power: 1.6, heat: 1.1, budget: 3.0 },
    sphere: { mass: 1.5, power: 1.2, heat: 0.9, budget: 2.3 },
    cylinder: { mass: 2.1, power: 1.8, heat: 1.3, budget: 2.8 },
    cone: { mass: 1.8, power: 1.4, heat: 1.1, budget: 2.4 },
    torus: { mass: 1.6, power: 1.9, heat: 1.5, budget: 2.6 },
    capsule: { mass: 2.4, power: 1.8, heat: 1.4, budget: 3.1 },
    engine: { mass: 3.0, power: 3.8, heat: 2.6, budget: 4.6 },
    forcefield: { mass: 1.7, power: 2.9, heat: 2.4, budget: 3.2 },
    flame: { mass: 0.8, power: 1.7, heat: 2.9, budget: 2.0 },
    pylon: { mass: 2.3, power: 1.9, heat: 1.3, budget: 2.8 },
});

const DEFAULT_PART_COST = Object.freeze({ mass: 2.0, power: 1.8, heat: 1.2, budget: 2.7 });

export const ARCADE_BLUEPRINT_SCHEMA_VERSION = 'arcade-blueprint-v1';

export const ARCADE_HITBOX_CLASSES = Object.freeze({
    compact: Object.freeze({
        maxWidth: 4.8,
        maxHeight: 2.4,
        maxLength: 7.2,
        maxRadius: 1.25,
    }),
    standard: Object.freeze({
        maxWidth: 6.0,
        maxHeight: 3.0,
        maxLength: 8.5,
        maxRadius: 1.55,
    }),
    heavy: Object.freeze({
        maxWidth: 7.0,
        maxHeight: 3.8,
        maxLength: 10.0,
        maxRadius: 1.85,
    }),
});

export const ARCADE_REQUIRED_SLOTS = Object.freeze([
    'core',
    'nose',
    'wing_left',
    'wing_right',
    'engine_left',
    'engine_right',
]);

function round3(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
}

function clampPositive(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, n);
}

function flattenParts(parts, result = []) {
    if (!Array.isArray(parts)) return result;
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (!part || typeof part !== 'object') continue;
        result.push(part);
        if (Array.isArray(part.children) && part.children.length > 0) {
            flattenParts(part.children, result);
        }
    }
    return result;
}

function inferPartSizeVector(part) {
    const size = Array.isArray(part?.size) ? part.size : [];
    const x = clampPositive(size[0], 1);
    const y = clampPositive(size[1], x);
    const z = clampPositive(size[2], y);
    if ((part?.geo === 'sphere' || part?.geo === 'torus') && size.length === 1) {
        return { x, y: x, z: x };
    }
    if (part?.geo === 'cone' && size.length >= 2) {
        const radius = clampPositive(size[0], 0.5);
        const height = clampPositive(size[1], radius * 2);
        return { x: radius * 2, y: radius * 2, z: height };
    }
    return { x, y, z };
}

function inferPartPosition(part) {
    const pos = Array.isArray(part?.pos) ? part.pos : [];
    return {
        x: Number(pos[0]) || 0,
        y: Number(pos[1]) || 0,
        z: Number(pos[2]) || 0,
    };
}

function inferPartScale(part) {
    const scale = Array.isArray(part?.scale) ? part.scale : [];
    return {
        x: clampPositive(scale[0], 1) || 1,
        y: clampPositive(scale[1], 1) || 1,
        z: clampPositive(scale[2], 1) || 1,
    };
}

function computeBounds(flatParts) {
    const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
    const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
    for (let i = 0; i < flatParts.length; i += 1) {
        const part = flatParts[i];
        const size = inferPartSizeVector(part);
        const scale = inferPartScale(part);
        const pos = inferPartPosition(part);
        const halfX = (size.x * scale.x) * 0.5;
        const halfY = (size.y * scale.y) * 0.5;
        const halfZ = (size.z * scale.z) * 0.5;
        min.x = Math.min(min.x, pos.x - halfX);
        min.y = Math.min(min.y, pos.y - halfY);
        min.z = Math.min(min.z, pos.z - halfZ);
        max.x = Math.max(max.x, pos.x + halfX);
        max.y = Math.max(max.y, pos.y + halfY);
        max.z = Math.max(max.z, pos.z + halfZ);
    }
    if (!Number.isFinite(min.x)) {
        return {
            min: { x: -1, y: -0.5, z: -1.5 },
            max: { x: 1, y: 0.5, z: 1.5 },
        };
    }
    return { min, max };
}

function classifySlotPart(part) {
    const name = String(part?.name || '').trim().toLowerCase();
    if (!name) return null;
    const keys = Object.keys(SLOT_PATTERNS);
    for (let i = 0; i < keys.length; i += 1) {
        const slot = keys[i];
        const patterns = SLOT_PATTERNS[slot];
        for (let p = 0; p < patterns.length; p += 1) {
            if (patterns[p].test(name)) return slot;
        }
    }
    return null;
}

function deriveSlotCoverage(flatParts) {
    const slots = {};
    for (let i = 0; i < ARCADE_REQUIRED_SLOTS.length; i += 1) {
        slots[ARCADE_REQUIRED_SLOTS[i]] = 0;
    }
    for (let i = 0; i < flatParts.length; i += 1) {
        const slot = classifySlotPart(flatParts[i]);
        if (!slot) continue;
        slots[slot] = (slots[slot] || 0) + 1;
    }
    return slots;
}

function derivePartCosts(flatParts) {
    let budgetUsed = 0;
    let massUsed = 0;
    let powerUsed = 0;
    let heatUsed = 0;
    for (let i = 0; i < flatParts.length; i += 1) {
        const geo = String(flatParts[i]?.geo || '').trim().toLowerCase();
        const costs = PART_COSTS[geo] || DEFAULT_PART_COST;
        const size = inferPartSizeVector(flatParts[i]);
        const volumeFactor = Math.max(0.5, Math.min(2.6, (size.x * size.y * size.z) / 2.8));
        budgetUsed += costs.budget * volumeFactor;
        massUsed += costs.mass * volumeFactor;
        powerUsed += costs.power * volumeFactor;
        heatUsed += costs.heat * volumeFactor;
    }
    return {
        budgetUsed: round3(budgetUsed),
        massUsed: round3(massUsed),
        powerUsed: round3(powerUsed),
        heatUsed: round3(heatUsed),
    };
}

function resolveHitboxLimits(hitboxClass) {
    const key = String(hitboxClass || 'standard').trim().toLowerCase();
    return ARCADE_HITBOX_CLASSES[key] || ARCADE_HITBOX_CLASSES.standard;
}

export function createArcadeBlueprintFromVehicleConfig(vehicleConfig, options = {}) {
    const config = vehicleConfig && typeof vehicleConfig === 'object' ? vehicleConfig : {};
    const flatParts = flattenParts(config.parts, []);
    const bounds = computeBounds(flatParts);
    const extents = {
        width: round3(bounds.max.x - bounds.min.x),
        height: round3(bounds.max.y - bounds.min.y),
        length: round3(bounds.max.z - bounds.min.z),
    };
    const radius = round3(Math.max(extents.width, extents.height, extents.length) * 0.5 * 0.31);
    const slotCoverage = deriveSlotCoverage(flatParts);
    const costs = derivePartCosts(flatParts);

    const blueprintId = String(options.blueprintId || config.id || config.label || 'custom_blueprint')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_ -]/g, '')
        .replace(/\s+/g, '_');

    return {
        schemaVersion: ARCADE_BLUEPRINT_SCHEMA_VERSION,
        blueprintId: blueprintId || 'custom_blueprint',
        label: String(config.label || options.label || 'Custom Blueprint'),
        hitboxClass: String(options.hitboxClass || 'standard').trim().toLowerCase(),
        limits: {
            editorBudget: clampPositive(options.editorBudget, 100),
            massBudget: clampPositive(options.massBudget, 90),
            powerBudget: clampPositive(options.powerBudget, 96),
            heatBudget: clampPositive(options.heatBudget, 88),
        },
        stats: {
            ...costs,
            radius,
            extents,
            partCount: flatParts.length,
        },
        slots: slotCoverage,
        source: String(options.source || 'vehicle-lab'),
    };
}

export function validateArcadeBlueprint(blueprint) {
    const record = blueprint && typeof blueprint === 'object' ? blueprint : {};
    const errors = [];
    const warnings = [];

    if (record.schemaVersion !== ARCADE_BLUEPRINT_SCHEMA_VERSION) {
        errors.push(`schemaVersion mismatch: expected ${ARCADE_BLUEPRINT_SCHEMA_VERSION}`);
    }
    if (!String(record.blueprintId || '').trim()) {
        errors.push('missing blueprintId');
    }

    const limits = record.limits && typeof record.limits === 'object' ? record.limits : {};
    const stats = record.stats && typeof record.stats === 'object' ? record.stats : {};
    const slots = record.slots && typeof record.slots === 'object' ? record.slots : {};
    const hitboxClass = String(record.hitboxClass || 'standard').trim().toLowerCase();
    const hitboxLimits = resolveHitboxLimits(hitboxClass);

    if ((Number(stats.budgetUsed) || 0) > (Number(limits.editorBudget) || 0)) {
        errors.push(`editorBudget exceeded (${stats.budgetUsed}/${limits.editorBudget})`);
    }
    if ((Number(stats.massUsed) || 0) > (Number(limits.massBudget) || 0)) {
        errors.push(`massBudget exceeded (${stats.massUsed}/${limits.massBudget})`);
    }
    if ((Number(stats.powerUsed) || 0) > (Number(limits.powerBudget) || 0)) {
        errors.push(`powerBudget exceeded (${stats.powerUsed}/${limits.powerBudget})`);
    }
    if ((Number(stats.heatUsed) || 0) > (Number(limits.heatBudget) || 0)) {
        errors.push(`heatBudget exceeded (${stats.heatUsed}/${limits.heatBudget})`);
    }

    if ((Number(stats.radius) || 0) > hitboxLimits.maxRadius) {
        errors.push(`hitbox radius exceeds class ${hitboxClass} (${stats.radius}/${hitboxLimits.maxRadius})`);
    }
    const extents = stats.extents && typeof stats.extents === 'object' ? stats.extents : {};
    if ((Number(extents.width) || 0) > hitboxLimits.maxWidth) {
        errors.push(`hitbox width exceeds class ${hitboxClass} (${extents.width}/${hitboxLimits.maxWidth})`);
    }
    if ((Number(extents.height) || 0) > hitboxLimits.maxHeight) {
        errors.push(`hitbox height exceeds class ${hitboxClass} (${extents.height}/${hitboxLimits.maxHeight})`);
    }
    if ((Number(extents.length) || 0) > hitboxLimits.maxLength) {
        errors.push(`hitbox length exceeds class ${hitboxClass} (${extents.length}/${hitboxLimits.maxLength})`);
    }

    for (let i = 0; i < ARCADE_REQUIRED_SLOTS.length; i += 1) {
        const slotKey = ARCADE_REQUIRED_SLOTS[i];
        if ((Number(slots[slotKey]) || 0) <= 0) {
            errors.push(`missing required slot: ${slotKey}`);
        }
    }

    if ((Number(stats.partCount) || 0) > 48) {
        warnings.push(`high part count (${stats.partCount}) may impact runtime perf`);
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
    };
}

export function formatArcadeBlueprintValidation(validation) {
    if (!validation || typeof validation !== 'object') {
        return 'Invalid validation payload.';
    }
    const lines = [];
    if (validation.ok) {
        lines.push('Arcade blueprint validation passed.');
    } else {
        lines.push('Arcade blueprint validation failed:');
        for (let i = 0; i < validation.errors.length; i += 1) {
            lines.push(`- ${validation.errors[i]}`);
        }
    }
    if (Array.isArray(validation.warnings) && validation.warnings.length > 0) {
        lines.push('Warnings:');
        for (let i = 0; i < validation.warnings.length; i += 1) {
            lines.push(`- ${validation.warnings[i]}`);
        }
    }
    return lines.join('\n');
}

// ─── Upgrade Tiers (V57) ───

export const UPGRADE_TIERS = Object.freeze({
    T1: Object.freeze({ label: 'Base', statMultiplier: 1.0, xpCost: 0, levelGate: 1 }),
    T2: Object.freeze({ label: 'Enhanced', statMultiplier: 1.15, xpCost: 200, levelGate: 5 }),
    T3: Object.freeze({ label: 'Superior', statMultiplier: 1.35, xpCost: 500, levelGate: 15 }),
});

export const UPGRADE_BONUSES = Object.freeze({
    engine: Object.freeze({
        T2: Object.freeze({ speed: 0.1, accel: 0.05 }),
        T3: Object.freeze({ speed: 0.25, accel: 0.12 }),
    }),
    core: Object.freeze({
        T2: Object.freeze({ shield: 15, mass: -0.05 }),
        T3: Object.freeze({ shield: 35, mass: -0.1 }),
    }),
    wing: Object.freeze({
        T2: Object.freeze({ turnRate: 0.08 }),
        T3: Object.freeze({ turnRate: 0.18 }),
    }),
    nose: Object.freeze({
        T2: Object.freeze({ damage: 0.1 }),
        T3: Object.freeze({ damage: 0.22 }),
    }),
    utility: Object.freeze({
        T2: Object.freeze({ cooldown: -0.1 }),
        T3: Object.freeze({ cooldown: -0.2 }),
    }),
});

function resolvePartCategory(slotName) {
    const s = String(slotName || '').toLowerCase();
    if (s.includes('engine')) return 'engine';
    if (s.includes('core') || s === 'fuselage') return 'core';
    if (s.includes('wing')) return 'wing';
    if (s.includes('nose') || s === 'cockpit') return 'nose';
    if (s.includes('utility') || s.includes('module') || s.includes('sensor')) return 'utility';
    return null;
}

export function getUpgradeCost(slotName, targetTier) {
    const tier = UPGRADE_TIERS[targetTier];
    if (!tier) return Infinity;
    return tier.xpCost;
}

export function canUpgrade(slotName, targetTier, level) {
    const tier = UPGRADE_TIERS[targetTier];
    if (!tier) return false;
    return level >= tier.levelGate;
}

export function applyUpgradeBonuses(blueprint, upgrades) {
    if (!blueprint || typeof blueprint !== 'object') return blueprint;
    if (!upgrades || typeof upgrades !== 'object') return blueprint;

    const bonusAccum = { speed: 0, accel: 0, shield: 0, mass: 0, turnRate: 0, damage: 0, cooldown: 0 };
    const entries = Object.entries(upgrades);

    for (let i = 0; i < entries.length; i += 1) {
        const [slotName, tier] = entries[i];
        if (tier === 'T1' || !UPGRADE_TIERS[tier]) continue;
        const category = resolvePartCategory(slotName);
        if (!category) continue;
        const bonusDef = UPGRADE_BONUSES[category]?.[tier];
        if (!bonusDef) continue;
        const bonusKeys = Object.keys(bonusDef);
        for (let j = 0; j < bonusKeys.length; j += 1) {
            bonusAccum[bonusKeys[j]] = (bonusAccum[bonusKeys[j]] || 0) + bonusDef[bonusKeys[j]];
        }
    }

    return {
        ...blueprint,
        upgradeBonuses: { ...bonusAccum },
    };
}

export default {
    ARCADE_BLUEPRINT_SCHEMA_VERSION,
    ARCADE_HITBOX_CLASSES,
    ARCADE_REQUIRED_SLOTS,
    UPGRADE_TIERS,
    UPGRADE_BONUSES,
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
    formatArcadeBlueprintValidation,
    getUpgradeCost,
    canUpgrade,
    applyUpgradeBonuses,
};
