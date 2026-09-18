import assert from 'node:assert/strict';
import test from 'node:test';

import { projectFightHangarEffect } from '../src/ui/hangar/FightHangarEffectView.js';
import { validateFightHangarBuild } from '../src/ui/hangar/FightHangarValidation.js';
import { evaluateFightHangarParts } from '../src/shared/contracts/FightHangarBalanceContract.js';
import { resolveHangarPart } from '../src/ui/hangar/HangarPartCatalog.js';

// A balanced fight build: blue T2 (speed up) paid for by a gold T2 (more hit points).
const BUILD = {
    vehicleId: 'ship5',
    slots: { core: 'stone_blue_t2', nose: 'stone_gold_t2' },
};

test('the fight hangar shows the fight effect the match applies', () => {
    const rows = projectFightHangarEffect(BUILD, null, validateFightHangarBuild);
    const expected = evaluateFightHangarParts(['stone_blue_t2', 'stone_gold_t2'].map(resolveHangarPart)).bonuses;
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey.speedBonusPct.value, expected.speedBonusPct);
    assert.equal(byKey.turningBonusPct.value, expected.turningBonusPct);
    assert.equal(byKey.maxHpBonus.value, expected.maxHpBonus);
    assert.deepEqual(rows.map((row) => row.label), ['Tempo', 'Wendigkeit', 'Lebenspunkte']);
});

test('the fight effect compares against the standard setup and the saved build', () => {
    const rows = projectFightHangarEffect(BUILD, { vehicleId: 'ship5', slots: {} }, validateFightHangarBuild);
    const speed = rows.find((row) => row.key === 'speedBonusPct');
    assert.equal(speed.deltaToBaseline, speed.value, 'an empty saved build has no bonus');
    assert.equal(speed.unit, '%');
    assert.equal(rows.find((row) => row.key === 'maxHpBonus').unit, '');
});
