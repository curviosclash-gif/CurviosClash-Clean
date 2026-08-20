import assert from 'node:assert/strict';
import test from 'node:test';

import { stoneCountText, stoneInventoryText } from '../src/ui/hangar/HangarWorkshopRenderText.js';

test('unlimited stock reads as German text, not as a JavaScript value', () => {
    // Im Kampf-Hangar sind Steine unbegrenzt; intern ist das Infinity und stand
    // vorher als englischer Programmierwert mitten im deutschen Satz.
    assert.equal(stoneCountText(Number.POSITIVE_INFINITY), 'unbegrenzt');
    assert.equal(
        stoneInventoryText({ available: Number.POSITIVE_INFINITY, equipped: 1, owned: Number.POSITIVE_INFINITY }),
        'Bestand: unbegrenzt frei · 1/unbegrenzt eingesetzt',
    );
});

test('counted stock stays a plain whole number', () => {
    assert.equal(stoneCountText(3), '3');
    assert.equal(stoneCountText(3.7), '3');
    assert.equal(
        stoneInventoryText({ available: 2, equipped: 1, owned: 3 }),
        'Bestand: 2 frei · 1/3 eingesetzt',
    );
});

test('missing or nonsensical counts fall back to zero, never to unbegrenzt', () => {
    for (const value of [undefined, null, Number.NaN, -5, 'zwei']) {
        assert.equal(stoneCountText(value), '0', `${String(value)} sollte 0 ergeben`);
    }
    assert.equal(stoneInventoryText(), 'Bestand: 0 frei · 0/0 eingesetzt');
});
