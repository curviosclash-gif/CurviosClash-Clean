import assert from 'node:assert/strict';
import test from 'node:test';

import { projectHangarProgression } from '../src/ui/hangar/HangarProgressionProjection.js';
import { createDefaultHangarBuild } from '../src/ui/hangar/HangarBuildDraftState.js';
import { xpToNextLevel } from '../src/state/arcade/ArcadeVehicleProfile.js';

function createProfile(overrides = {}) {
    return {
        vehicleId: 'ship5',
        level: 1,
        xp: 0,
        xpBank: 0,
        upgrades: {},
        masteryMilestones: ['initiate'],
        ...overrides,
    };
}

function project(profile, build = createDefaultHangarBuild('ship5')) {
    return projectHangarProgression(profile, build, xpToNextLevel(profile));
}

test('the projection reports level, collected xp and what is still missing', () => {
    const profile = createProfile({ level: 2, xp: 430, xpBank: 430 });
    const projection = project(profile);
    const xp = xpToNextLevel(profile);

    assert.equal(projection.level, 2);
    assert.equal(projection.xpIntoLevel, xp.current);
    assert.equal(projection.xpForNextLevel, xp.required);
    assert.equal(projection.xpRemaining, xp.required - xp.current);
    assert.ok(projection.xpRemaining > 0, 'a level 2 profile still needs xp for level 3');
    assert.equal(projection.spendableXrp, 430);
    assert.equal(projection.masteryCount, 1);
});

test('a maxed profile reports no remaining requirement instead of a negative one', () => {
    const projection = project(createProfile({ level: 30, xp: 9_999_999, xpBank: 10 }));
    assert.equal(projection.xpRemaining, 0);
    assert.equal(projection.progress, 1);
});

test('a locked slot names the level that unlocks it', () => {
    const projection = project(createProfile({ level: 1 }));
    const utility = projection.slots.find((slot) => slot.id === 'utility');
    assert.ok(utility, 'the utility slot is part of the projection');
    assert.equal(utility.unlocked, false);
    assert.equal(utility.unlockLevel, 5);
    assert.match(utility.lockReason, /Level 5/);
});

test('an unlocked slot carries no lock reason', () => {
    const projection = project(createProfile({ level: 9 }));
    const utility = projection.slots.find((slot) => slot.id === 'utility');
    assert.equal(utility.unlocked, true);
    assert.equal(utility.lockReason, '');

    const core = projection.slots.find((slot) => slot.id === 'core');
    assert.equal(core.unlocked, true);
    assert.equal(core.lockReason, '');
});

test('every hangar slot appears exactly once and keeps its label', () => {
    const projection = project(createProfile({ level: 9 }));
    const ids = projection.slots.map((slot) => slot.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('core') && ids.includes('utility'));
    projection.slots.forEach((slot) => assert.ok(slot.label.length > 0, `${slot.id} has a label`));
});

test('the projection reports whether the next stone tier is affordable and why not', () => {
    const build = createDefaultHangarBuild('ship5');
    const poor = project(createProfile({ level: 12, xpBank: 0 }), build);
    const coreSlotPoor = poor.slots.find((slot) => slot.id === 'core');
    assert.equal(coreSlotPoor.nextTier.purchasable, false);
    assert.match(coreSlotPoor.nextTier.reason, /XRP/);

    const rich = project(createProfile({ level: 12, xpBank: 5000 }), build);
    const coreSlotRich = rich.slots.find((slot) => slot.id === 'core');
    assert.equal(coreSlotRich.nextTier.purchasable, true);
    assert.equal(coreSlotRich.nextTier.priceXrp, 350);
});

test('a slot at the highest stone tier reports no further purchase', () => {
    const build = createDefaultHangarBuild('ship5');
    build.slots.core = 'stone_blue_t3';
    const projection = project(createProfile({ level: 30, xpBank: 5000 }), build);
    const core = projection.slots.find((slot) => slot.id === 'core');
    assert.equal(core.nextTier.purchasable, false);
    assert.equal(core.nextTier.stoneId, '');
});

test('an empty projection input stays a usable shape instead of throwing', () => {
    const projection = projectHangarProgression(null, null, null);
    assert.equal(projection.level, 1);
    assert.equal(projection.xpRemaining, 0);
    assert.ok(Array.isArray(projection.slots));
});
