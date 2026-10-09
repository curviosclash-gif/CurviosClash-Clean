import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorBuildHotbar, EDITOR_BUILD_HOTBAR_SLOT_COUNT } from '../editor/js/EditorBuildHotbar.js';

test('hotbar initializes favorites before unique recent entries and caps at nine', () => {
    const favorites = Array.from({ length: 7 }, (_, index) => ({ id: `fav-${index}`, label: `Favorit ${index}` }));
    const recent = [
        { id: 'fav-2', label: 'Doppelt' },
        ...Array.from({ length: 8 }, (_, index) => ({ id: `recent-${index}`, label: `Zuletzt ${index}` })),
    ];
    const hotbar = createEditorBuildHotbar({ favoriteEntries: favorites, recentEntries: recent });
    const snapshot = hotbar.getSnapshot();

    assert.equal(snapshot.slots.length, EDITOR_BUILD_HOTBAR_SLOT_COUNT);
    assert.deepEqual(snapshot.slots.map((entry) => entry?.id), [
        'fav-0', 'fav-1', 'fav-2', 'fav-3', 'fav-4', 'fav-5', 'fav-6', 'recent-0', 'recent-1',
    ]);
    assert.equal(snapshot.slots[2].label, 'Favorit 2');
    assert.equal(snapshot.selectedIndex, 0);
});

test('selecting a slot validates its index and preserves empty slots', () => {
    const hotbar = createEditorBuildHotbar({ favoriteEntries: [{ id: 'block', label: 'Block' }] });

    assert.equal(hotbar.selectSlot(4), true);
    assert.equal(hotbar.getSnapshot().selectedIndex, 4);
    assert.equal(hotbar.getSnapshot().slots[4], null);
    for (const invalid of [-1, 9, 1.5, '1', NaN]) assert.equal(hotbar.selectSlot(invalid), false);
    assert.equal(hotbar.getSnapshot().selectedIndex, 4);
});

test('rebinding replaces the slot and removes duplicate ids from other slots', () => {
    const hotbar = createEditorBuildHotbar({
        favoriteEntries: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    });

    assert.equal(hotbar.rebindSlot(5, { id: 'a', label: 'A2' }), true);
    assert.equal(hotbar.getSnapshot().slots[0], null);
    assert.deepEqual(hotbar.getSnapshot().slots[5], { id: 'a', label: 'A2' });
    assert.equal(hotbar.getSnapshot().selectedIndex, 5);
    assert.equal(hotbar.rebindSlot(9, { id: 'c' }), false);
    assert.equal(hotbar.rebindSlot(2, { label: 'Missing id' }), false);
    assert.equal(hotbar.getSnapshot().slots[2], null);
});
