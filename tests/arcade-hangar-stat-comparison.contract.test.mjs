import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './helpers/fake-hangar-dom.mjs';
import { resolveArcadeHangarStatReferences, renderArcadeHangarStatComparison } from '../src/ui/hangar/ArcadeHangarStatComparison.js';

test('Arcade comparison uses factory ship values and all eight factory ships for the fleet average', () => {
    const { factory, average } = resolveArcadeHangarStatReferences('manta');
    assert.equal(factory.maxHpPct, 150);
    assert.equal(factory.itemCapacity, 7);
    assert.equal(factory.rocketCapacity, 8);
    assert.equal(average.maxHpPct, 96.88);
    assert.equal(average.itemCapacity, 4.5);
    assert.equal(average.rocketCapacity, 4.25);
    assert.equal(average.regenDelay, 3);
});

test('Arcade comparison shows readable factory references and equally scaled native meters', () => {
    const root = fakeDocument.createElement('div');
    renderArcadeHangarStatComparison(root, {
        vehicleId: 'manta', current: { maxHpPct: 180 }, saved: { maxHpPct: 156 }, reference: { maxHpPct: 75 },
        baselineLabel: 'Preset', comparisonLabel: 'Pfeil',
        compare: (a, b) => [{ key: 'maxHpPct', label: 'Leben', value: a.maxHpPct, delta: a.maxHpPct - b.maxHpPct, tone: 'positive' }],
    });
    const meters = root.querySelectorAll('.hangar-stat-meter');
    assert.deepEqual(meters.map((meter) => meter.getAttribute('value')), ['180', '150', '96.88']);
    assert.ok(meters.every((meter) => meter.getAttribute('max') === '180'));
    assert.ok(meters.every((meter) => meter.getAttribute('aria-label').startsWith('Leben')));
    assert.deepEqual(root.querySelectorAll('.hangar-stat-reference').map((node) => node.textContent), [
        'Eigener Build: 180', 'Werkszustand: 150', 'Flottendurchschnitt: 96.88',
    ]);
    assert.deepEqual(root.querySelectorAll('.hangar-stat-delta').map((node) => node.textContent), ['Seit Preset: ↑ +24', 'Gegen Pfeil: ↑ +105']);
});
