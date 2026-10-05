// ============================================
// hangar-part-style-reset-confirm.contract.test.mjs - Hangar-Reiter "Form": "Alles zurücksetzen"
// löschte alle Farbänderungen mit einem einzigen Klick (Menüprüfung 28.09.2026, F5). Der Knopf
// folgt jetzt dem zweistufigen Muster der übrigen zerstörerischen Knöpfe (ConfirmButtonArming):
// erster Klick oder Enter fragt nach, erst der zweite löscht. Läuft das echte Panel mit dem
// schmalen Ersatz-DOM der Hangar-Tests.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bind, find, pressEnter, createEvent } from './helpers/fake-hangar-dom.mjs';

const { createHangarPartStylePanel } = await import('../src/ui/hangar/HangarPartStylePanel.js');

/**
 * The Fight hangar's panel (plain colour input, no unlock list) on a part-built ship with one
 * recoloured part. saveProfile in HangarFormTab re-renders with the stored style; the harness
 * does the same so the panel sees what was saved.
 */
function createPanelWithStyledPart() {
    const harness = { saved: [] };
    harness.panel = createHangarPartStylePanel({
        bind,
        onStyleChange: (style) => { harness.saved.push(style); harness.panel.render({ vehicleId: 'ship5', style }); },
        onSelectPart() {},
    });
    harness.panel.render({ vehicleId: 'ship5', style: {} });
    const color = find(harness.panel.root, 'hangar-part-style-color');
    color.value = '#ff0000';
    color.dispatchEvent(createEvent('input'));
    harness.saved.length = 0;
    harness.resetAll = find(harness.panel.root, 'hangar-part-style-reset-all');
    return harness;
}

test('one click on "Alles zurücksetzen" only asks; the second click clears every part colour', () => {
    const harness = createPanelWithStyledPart();
    assert.equal(harness.resetAll.disabled, false, 'a recoloured part enables the reset');

    harness.resetAll.click();
    assert.deepEqual(harness.saved, [], 'a single click must not wipe the part colours');
    assert.equal(harness.resetAll.getAttribute('data-confirm-armed'), 'true', 'the first click arms the confirmation');
    assert.notEqual(harness.resetAll.textContent, 'Alles zurücksetzen', 'the armed button says what the next click does');

    harness.resetAll.click();
    assert.deepEqual(harness.saved, [{}], 'the confirming click clears every part colour');
    assert.equal(harness.resetAll.textContent, 'Alles zurücksetzen', 'the label returns after the reset');
    assert.equal(harness.resetAll.disabled, true, 'nothing left to reset');
});

test('keyboard users confirm the same way: Enter arms, a second Enter resets', () => {
    const harness = createPanelWithStyledPart();
    pressEnter(harness.resetAll);
    assert.deepEqual(harness.saved, [], 'one Enter must not wipe the part colours');
    pressEnter(harness.resetAll);
    assert.deepEqual(harness.saved, [{}], 'the second Enter confirms');
});
