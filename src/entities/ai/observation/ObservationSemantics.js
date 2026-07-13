// ============================================
// ObservationSemantics.js - machine-checkable semantics for bridge schema v1
// ============================================

import {
    BOOST_ACTIVE,
    CONTEXT_RESERVED,
    HEALTH_RATIO,
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    MODE_ID,
    OBSERVATION_ITEM_SLOT_INDICES,
    OBSERVATION_LENGTH_V1,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SELECTED_ITEM_SLOT,
    SHIELD_RATIO,
    SPEED_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './ObservationSchemaV1.js';

function createSemanticsEntry(index, key, min, max, description) {
    return Object.freeze({
        index,
        key,
        min,
        max,
        description,
    });
}

const CORE_SEMANTICS = [
    createSemanticsEntry(SPEED_RATIO, 'SPEED_RATIO', 0, 1, 'Current speed divided by baseline speed.'),
    createSemanticsEntry(HEALTH_RATIO, 'HEALTH_RATIO', 0, 1, 'Current health points divided by max health points.'),
    createSemanticsEntry(SHIELD_RATIO, 'SHIELD_RATIO', 0, 1, 'Current shield points divided by max shield points.'),
    createSemanticsEntry(WALL_DISTANCE_FRONT, 'WALL_DISTANCE_FRONT', 0, 1, 'Normalized free distance directly ahead.'),
    createSemanticsEntry(WALL_DISTANCE_LEFT, 'WALL_DISTANCE_LEFT', 0, 1, 'Normalized free distance to the left.'),
    createSemanticsEntry(WALL_DISTANCE_RIGHT, 'WALL_DISTANCE_RIGHT', 0, 1, 'Normalized free distance to the right.'),
    createSemanticsEntry(WALL_DISTANCE_UP, 'WALL_DISTANCE_UP', 0, 1, 'Normalized free distance upward.'),
    createSemanticsEntry(WALL_DISTANCE_DOWN, 'WALL_DISTANCE_DOWN', 0, 1, 'Normalized free distance downward.'),
    createSemanticsEntry(TARGET_DISTANCE_RATIO, 'TARGET_DISTANCE_RATIO', 0, 1, 'Nearest target distance normalized to sensing range.'),
    createSemanticsEntry(TARGET_ALIGNMENT, 'TARGET_ALIGNMENT', -1, 1, 'Dot alignment between forward vector and target direction.'),
    createSemanticsEntry(TARGET_IN_FRONT, 'TARGET_IN_FRONT', 0, 1, 'Binary indicator whether target is in front cone.'),
    createSemanticsEntry(PRESSURE_LEVEL, 'PRESSURE_LEVEL', 0, 1, 'Aggregated local pressure/risk estimate.'),
    createSemanticsEntry(PROJECTILE_THREAT, 'PROJECTILE_THREAT', 0, 1, 'Binary indicator for immediate projectile danger.'),
    createSemanticsEntry(LOCAL_OPENNESS_RATIO, 'LOCAL_OPENNESS_RATIO', 0, 1, 'Normalized local openness score around bot.'),
    createSemanticsEntry(BOOST_ACTIVE, 'BOOST_ACTIVE', 0, 1, 'Binary indicator whether boost is active.'),
    createSemanticsEntry(INVENTORY_COUNT_RATIO, 'INVENTORY_COUNT_RATIO', 0, 1, 'Inventory fill state normalized to max supported slots.'),
    createSemanticsEntry(SELECTED_ITEM_SLOT, 'SELECTED_ITEM_SLOT', -1, 19, 'Selected inventory slot index or -1 when empty.'),
    createSemanticsEntry(PLANAR_MODE_ACTIVE, 'PLANAR_MODE_ACTIVE', 0, 1, 'Binary indicator whether planar mode is active.'),
    createSemanticsEntry(MODE_ID, 'MODE_ID', 0, 1, 'Stable numeric mode id (0=classic, 1=hunt).'),
    createSemanticsEntry(CONTEXT_RESERVED, 'CONTEXT_RESERVED', 0, 1, 'Reserved index for future compatible context flags.'),
];

const ITEM_SLOT_SEMANTICS = OBSERVATION_ITEM_SLOT_INDICES.map((index, offset) => {
    const suffix = String(offset).padStart(2, '0');
    return createSemanticsEntry(
        index,
        `ITEM_SLOT_${suffix}`,
        0,
        1,
        'Item one-hot slot for deterministic inventory encoding.'
    );
});

export const OBSERVATION_SEMANTICS_V1 = Object.freeze([
    ...CORE_SEMANTICS,
    ...ITEM_SLOT_SEMANTICS,
]);

export function getObservationSemanticsByIndex(index) {
    return OBSERVATION_SEMANTICS_V1.find((entry) => entry.index === index) || null;
}

export function hasUniqueObservationSemanticIndices() {
    const used = new Set();
    for (let i = 0; i < OBSERVATION_SEMANTICS_V1.length; i++) {
        const entry = OBSERVATION_SEMANTICS_V1[i];
        if (used.has(entry.index)) return false;
        used.add(entry.index);
    }
    return true;
}

export function hasExpectedObservationSemanticLength(expectedLength = OBSERVATION_LENGTH_V1) {
    return OBSERVATION_SEMANTICS_V1.length === expectedLength;
}
