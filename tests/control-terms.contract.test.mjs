import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { KEY_BIND_ACTIONS, resolveKeybindActionLabel } from '../src/ui/KeybindActionCatalog.js';
import { formatKeyCode } from '../src/ui/KeybindLabels.js';

const byKey = (key) => KEY_BIND_ACTIONS.find((action) => action.key === key);

test('the pitch keys say which way the nose goes, following the invert setting', () => {
    // Measured in the desktop app on 18.09.2026: with the factory setting (invert on) W sinks, S climbs.
    assert.equal(resolveKeybindActionLabel(byKey('UP'), { invertPitch: true }), 'Nase senken');
    assert.equal(resolveKeybindActionLabel(byKey('DOWN'), { invertPitch: true }), 'Nase heben');
    assert.equal(resolveKeybindActionLabel(byKey('UP'), { invertPitch: false }), 'Nase heben');
    assert.equal(resolveKeybindActionLabel(byKey('DOWN'), { invertPitch: false }), 'Nase senken');
});

test('control actions use plain German verbs', () => {
    const labels = KEY_BIND_ACTIONS.map((action) => resolveKeybindActionLabel(action, { invertPitch: true }));
    for (const expected of ['Links drehen', 'Rechts drehen', 'Nach links rollen', 'Nach rechts rollen', 'MG feuern', 'Item wechseln']) {
        assert.ok(labels.includes(expected), expected);
    }
    labels.forEach((label) => assert.doesNotMatch(label, /Pitch|Gier|Schiessen|Wechseln/u, label));
});

test('key names are German', () => {
    assert.equal(formatKeyCode('ArrowRight'), 'Pfeil rechts');
    assert.equal(formatKeyCode('ArrowUp'), 'Pfeil hoch');
    assert.equal(formatKeyCode('ShiftLeft'), 'Umschalt links');
    assert.equal(formatKeyCode('ControlRight'), 'Strg rechts');
    assert.equal(formatKeyCode('Space'), 'Leertaste');
    assert.equal(formatKeyCode('NumpadDivide'), 'Num /');
    assert.equal(formatKeyCode('KeyW'), 'W');
    assert.equal(formatKeyCode('Numpad8'), 'Num 8');
});

test('the key editor asks each player for the invert setting before labelling pitch', () => {
    const source = readFileSync(new URL('../src/ui/KeybindEditorController.js', import.meta.url), 'utf8');
    assert.match(source, /resolveKeybindActionLabel\(action, \{ invertPitch: this\.runtimeAccess\.getInvertPitch\?\.\(playerKey\)/u);
});
