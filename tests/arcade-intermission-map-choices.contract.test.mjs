// The intermission route choice offered the "custom" slot (no saved map: the sector loaded standard
// while HUD and score still said "custom") and maps the map picker hides on purpose.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

registerMapCatalogConfigSource({
    MAPS: {
        custom: { name: 'Eigene Map', size: [80, 30, 80] },
        standard: { name: 'Standardarena', size: [80, 30, 80] },
        burg: { name: 'Burghof', size: [80, 30, 80] },
        secret_scenario: { name: 'Szenario', size: [80, 30, 80], hiddenFromMapPicker: true },
        canyon: { name: 'Canyon', size: [80, 30, 80] },
    },
});

const { buildArcadeIntermissionChoices } = await import('../src/core/arcade/ArcadeIntermissionPlanOps.js');

test('the Daily offers only the planned route so every player flies the same run', () => {
    // Decision D4 (18.09.2026): the Daily stays comparable, no alternative routes.
    const runtime = {
        _state: { mapSequence: ['standard', 'burg', 'canyon'], isDailyChallenge: true },
        _config: { dailyChallenge: true },
        _activeModifierId: '',
        _getEncounterSectorEntry: () => ({ parcoursEnabled: false, modifierId: 'tight_turns' }),
    };
    const choices = buildArcadeIntermissionChoices(runtime, 2);
    assert.equal(choices.length, 1, choices.map((choice) => choice.id).join(','));
    assert.equal(choices[0].mapKey, 'burg');
    assert.equal(choices[0].source, 'plan');
});

test('the route choice never offers the custom slot or maps hidden from the map picker', () => {
    for (let sector = 2; sector <= 6; sector += 1) {
        const runtime = {
            _state: { mapSequence: ['standard', 'standard', 'standard', 'standard', 'standard', 'standard'] },
            _activeModifierId: '',
            _getEncounterSectorEntry: () => ({ parcoursEnabled: false, modifierId: '' }),
        };
        const offered = buildArcadeIntermissionChoices(runtime, sector).map((choice) => choice.mapKey);
        assert.ok(offered.length >= 2, `sector ${sector}: alternatives remain, got ${offered.join(',')}`);
        assert.ok(!offered.includes('custom'), `sector ${sector}: ${offered.join(',')}`);
        assert.ok(!offered.includes('secret_scenario'), `sector ${sector}: ${offered.join(',')}`);
    }
});
