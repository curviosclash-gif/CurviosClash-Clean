import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workshop = readFileSync(new URL('../src/ui/hangar/ArcadeHangarWorkshop.js', import.meta.url), 'utf8');
const chips = readFileSync(new URL('../src/ui/hangar/HangarVehicleFilterChips.js', import.meta.url), 'utf8');

test('generated hangar category and filter buttons use the shared dark button style', () => {
    assert.match(workshop, /renderHangarVehicleFilterChips\(\{ rules, mode: hangarMode,/u);
    assert.match(chips, /createButton\('secondary-btn arcade-vehicle-tab', category\.label\)/u);
    assert.match(chips, /createButton\('secondary-btn arcade-vehicle-chip', label\)/u);
});
