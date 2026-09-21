import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workshop = readFileSync(new URL('../src/ui/hangar/ArcadeHangarWorkshop.js', import.meta.url), 'utf8');

test('generated hangar category and filter buttons use the shared dark button style', () => {
    assert.match(workshop, /createButton\('secondary-btn arcade-vehicle-tab', category\.label\)/u);
    assert.match(workshop, /createButton\('secondary-btn arcade-vehicle-chip', HITBOX_LABELS\[value\] \|\| value\)/u);
    assert.match(workshop, /createButton\('secondary-btn arcade-vehicle-chip', LEVEL_LABELS\[value\] \|\| value\)/u);
});
