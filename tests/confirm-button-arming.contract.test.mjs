import assert from 'node:assert/strict';
import test from 'node:test';

import { armConfirmButton } from '../src/ui/ConfirmButtonArming.js';

function createButton(label = 'Löschen') {
    const attributes = new Map();
    const button = new EventTarget();
    button.textContent = label;
    button.setAttribute = (name, value) => attributes.set(name, value);
    button.removeAttribute = (name) => attributes.delete(name);
    button.getAttribute = (name) => attributes.get(name) ?? null;
    return button;
}

test('a destructive button needs a second click, and blur cancels the pending action', () => {
    const button = createButton();
    let confirmed = 0;
    const control = armConfirmButton(button, { label: 'Löschen', confirmLabel: 'Erneut klicken', onConfirm: () => confirmed++ });

    button.dispatchEvent(new Event('click'));
    assert.equal(confirmed, 0);
    assert.equal(button.textContent, 'Erneut klicken');
    assert.equal(button.getAttribute('data-confirm-armed'), 'true');

    button.dispatchEvent(new Event('blur'));
    assert.equal(button.textContent, 'Löschen');
    assert.equal(button.getAttribute('data-confirm-armed'), null);
    button.dispatchEvent(new Event('click'));
    assert.equal(confirmed, 0);
    button.dispatchEvent(new Event('click'));
    assert.equal(confirmed, 1);
    control.dispose();
});

test('confirmation expires and cleanup prevents later activation', async () => {
    const button = createButton();
    let confirmed = 0;
    const control = armConfirmButton(button, { label: 'Löschen', onConfirm: () => confirmed++, timeoutMs: 5 });
    button.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(button.textContent, 'Löschen');
    button.dispatchEvent(new Event('click'));
    assert.equal(confirmed, 0);
    control.dispose();
    button.dispatchEvent(new Event('click'));
    assert.equal(confirmed, 0);
});
