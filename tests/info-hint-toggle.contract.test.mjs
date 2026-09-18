import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { bindInfoHintToggle, createInfoHintButton } from '../src/ui/menu/InfoHintToggle.js';

function createDoc() {
    let counter = 0;
    const doc = {
        createElement(tag) {
            const listeners = {};
            const node = {
                tagName: tag.toUpperCase(), ownerDocument: doc, attributes: new Map(), dataset: {}, hidden: false,
                className: '', textContent: '', title: '', type: '', id: '', parentNode: null, nextSibling: null,
                setAttribute(name, value) { this.attributes.set(name, String(value)); },
                getAttribute(name) { return this.attributes.get(name) ?? null; },
                removeAttribute(name) { this.attributes.delete(name); },
                addEventListener(type, handler) { listeners[type] = handler; },
                fire(type, event = {}) { listeners[type]?.({ preventDefault() {}, ...event }); },
                after(sibling) { this.nextSibling = sibling; sibling.parentNode = this.parentNode; },
            };
            return node;
        },
        nextId: () => `info-hint-${++counter}`,
    };
    return doc;
}

test('an info "i" is a real button that shows its text on click and hides it again', () => {
    const doc = createDoc();
    const button = createInfoHintButton(doc, 'Ziehen: drehen · Mausrad: zoomen', 'start-map-preview-hint');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, 'i');
    assert.equal(button.title, 'Ziehen: drehen · Mausrad: zoomen');
    assert.match(button.getAttribute('aria-label'), /Hinweis/);
    assert.equal(button.getAttribute('aria-expanded'), 'false');

    button.fire('click');
    const note = button.nextSibling;
    assert.ok(note, 'the note is inserted next to the button');
    assert.equal(note.textContent, 'Ziehen: drehen · Mausrad: zoomen');
    assert.equal(note.hidden, false);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.getAttribute('aria-controls'), note.id);

    button.fire('keydown', { key: 'Escape' });
    assert.equal(note.hidden, true);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    button.fire('click');
    button.fire('click');
    assert.equal(note.hidden, true, 'a second click closes it again');
});

test('binding an existing hint twice does not stack handlers', () => {
    const doc = createDoc();
    const button = createInfoHintButton(doc, 'Text');
    bindInfoHintToggle(button);
    button.fire('click');
    assert.equal(button.nextSibling.hidden, false);
});

test('no info "i" is a mouse-only span anymore', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /<span[^>]*class="menu-info-hint/u);
    for (const file of ['hangar/HangarWindowMenuBridge.js', 'hangar/ArcadeHangarWorkshopShell.js']) {
        const source = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
        assert.match(source, /createInfoHintButton\(/, file);
    }
});
