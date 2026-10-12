// In the hangar window the catalog panel reserves eight auto rows and a last 1fr row for the
// vehicle list. Hidden children (view switch, stone filters, empty favourites) take no grid row,
// so the list was auto-placed into one of the auto rows and the 1fr row stayed empty. Measured on
// 12.10.2026 in the desktop app: the list was 11px tall at the hangar window minimum of 1100x700
// and 20px at 1008x655, so not even one 88px card was visible and the wave-seven click landed on
// the chips above it. The list now always takes the last row, which keeps 200px; a short window
// scrolls the catalog panel (overflow auto from the shared hangar panel rule) instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/ui/hangar/HangarWindow.css', import.meta.url), 'utf8');

function rules(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only rules that start with this selector (after a rule end or a comment), not grouped lists.
    const found = [...css.matchAll(new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
    assert.ok(found.length > 0, `${selector} exists`);
    return found.join(';');
}

test('Die Fahrzeugliste sitzt immer in der letzten Zeile, egal wie viele Filter ausgeblendet sind', () => {
    const list = rules('.hangar-window-mount .hangar-catalog-list');
    assert.match(list, /grid-row:\s*-2\s*\/\s*-1\s*;/);
});

test('Die letzte Katalogzeile behaelt mindestens zwei Karten Hoehe', () => {
    const rows = rules('.hangar-window-mount .hangar-catalog-panel').match(/grid-template-rows:\s*([^;]+);/)?.[1] || '';
    const listMin = Number(rows.match(/minmax\(\s*(\d+)px\s*,\s*1fr\s*\)\s*$/)?.[1]);
    assert.ok(listMin >= 180, `the list track is "${rows}"`);
});

test('Der Katalog scrollt im niedrigen Fenster ueber die gemeinsame Panel-Regel', () => {
    // (0,3,0) beats the catalog rule (0,2,0), so this is the overflow the panel really gets.
    const shared = rules('.hangar-window-mount .hangar-workshop-layout > .arcade-vehicle-panel');
    assert.match(shared, /overflow:\s*auto\s*;/);
});
