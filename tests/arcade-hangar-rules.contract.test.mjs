import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_HANGAR_RULES_CONTRACT_VERSION,
    resolveArcadeHangarRulesForLevel,
    validateArcadeHangarBlueprintForLevel,
} from '../src/shared/contracts/ArcadeHangarRulesContract.js';

const BASE_BLUEPRINT = Object.freeze({
    hitboxClass: 'standard',
    stats: Object.freeze({
        budgetUsed: 45,
        massUsed: 40,
        powerUsed: 42,
        heatUsed: 30,
        partCount: 20,
    }),
    slots: Object.freeze({
        core: 1,
        nose: 1,
        wing_left: 1,
        wing_right: 1,
        engine_left: 1,
        engine_right: 1,
    }),
});

function createBlueprint(overrides = {}) {
    const sourceStats = overrides.stats && typeof overrides.stats === 'object' ? overrides.stats : {};
    const sourceSlots = overrides.slots && typeof overrides.slots === 'object' ? overrides.slots : {};
    return {
        ...BASE_BLUEPRINT,
        ...overrides,
        stats: {
            ...BASE_BLUEPRINT.stats,
            ...sourceStats,
        },
        slots: {
            ...BASE_BLUEPRINT.slots,
            ...sourceSlots,
        },
    };
}

test('V76.3.1 rules resolve deterministic chassis, part-family and tier gates by level', () => {
    const recruit = resolveArcadeHangarRulesForLevel(1);
    const veteran = resolveArcadeHangarRulesForLevel(12);

    assert.equal(recruit.contractVersion, ARCADE_HANGAR_RULES_CONTRACT_VERSION);
    assert.deepEqual(recruit.allowedChassisClasses, ['compact', 'standard']);
    assert.equal(recruit.allowedPartFamilies.includes('utility'), false);
    assert.equal(recruit.allowedTiers.includes('T2'), false);
    assert.equal(recruit.unlockedSlots.includes('utility'), false);

    assert.deepEqual(veteran.allowedChassisClasses, ['compact', 'standard', 'heavy']);
    assert.equal(veteran.allowedPartFamilies.includes('utility'), true);
    assert.equal(veteran.allowedTiers.includes('T2'), true);
    assert.equal(veteran.allowedTiers.includes('T3'), false);
    assert.equal(veteran.unlockedSlots.includes('utility'), true);
});

test('V76.3.1 blueprint validation rejects locked chassis classes at recruit levels', () => {
    const validation = validateArcadeHangarBlueprintForLevel(
        createBlueprint({ hitboxClass: 'heavy' }),
        1
    );

    assert.equal(validation.ok, false);
    assert.equal(
        validation.errors.some((entry) => entry.includes('chassis hitboxClass heavy is locked')),
        true
    );
});

test('V76.3.1 blueprint validation rejects utility slot usage before slot and family unlock', () => {
    const validation = validateArcadeHangarBlueprintForLevel(
        createBlueprint({
            slots: {
                utility: 1,
            },
        }),
        1
    );

    assert.equal(validation.ok, false);
    assert.equal(
        validation.errors.some((entry) => entry.includes('slot utility is not unlocked')),
        true
    );
    assert.equal(
        validation.errors.some((entry) => entry.includes('part family utility is locked')),
        true
    );
});

test('V76.3.1 blueprint validation enforces tier gates for explicit tier slots', () => {
    const validation = validateArcadeHangarBlueprintForLevel(
        createBlueprint({
            slots: {
                core_t3: 1,
            },
        }),
        18
    );

    assert.equal(validation.ok, false);
    assert.equal(
        validation.errors.some((entry) => entry.includes('tier T3 is locked for slot core_t3')),
        true
    );
});

test('V76.3.1 blueprint validation accepts veteran-legal heavy blueprints within limits', () => {
    const validation = validateArcadeHangarBlueprintForLevel(
        createBlueprint({
            hitboxClass: 'heavy',
            stats: {
                budgetUsed: 70,
                massUsed: 65,
                powerUsed: 66,
                heatUsed: 60,
                partCount: 30,
            },
            slots: {
                utility: 1,
                wing_left_t2: 1,
                wing_right_t2: 1,
            },
        }),
        12
    );

    assert.equal(validation.ok, true);
    assert.deepEqual(validation.errors, []);
});
