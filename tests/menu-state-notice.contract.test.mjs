import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.type = '';
        this.hidden = false;
        this.attributes = {};
        this.dataset = {};
        this.listeners = new Map();
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    click() { [...(this.listeners.get('click') ?? [])].forEach((handler) => handler({ type: 'click' })); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
    // Only the one selector form the notice uses: [data-part="name"].
    querySelector(selector) {
        const name = /^\[data-part="([^"]+)"\]$/.exec(selector)?.[1];
        for (const child of this.children) {
            if (child.dataset.part === name) return child;
            const hit = child.querySelector(selector);
            if (hit) return hit;
        }
        return null;
    }
}

const doc = { createElement: (tag) => new FakeElement(tag) };
const { createMenuStateNotice, updateMenuStateNotice, MENU_STATE_NOTICE_KINDS } =
    await import('../src/ui/menu/MenuStateNotice.js');
const { MENU_STATE_NOTICE_CATALOG, resolveMenuStateNotice } =
    await import('../src/ui/menu/MenuStateNoticeCatalog.js');

const part = (notice, name) => notice.element.querySelector(`[data-part="${name}"]`);

test('every kind shows a visible text label and a symbol, so it is readable without color', () => {
    const labels = new Set();
    for (const kind of MENU_STATE_NOTICE_KINDS) {
        const notice = createMenuStateNotice(doc, { kind, title: 'Titel', text: 'Text' });
        assert.equal(notice.element.dataset.kind, kind);
        assert.ok(notice.element.className.split(/\s+/).includes('menu-state-notice'));
        const label = part(notice, 'label').textContent;
        assert.ok(label.length > 0, `${kind} has a label`);
        assert.ok(part(notice, 'symbol').textContent.length > 0, `${kind} has a symbol`);
        labels.add(label);
    }
    assert.equal(labels.size, MENU_STATE_NOTICE_KINDS.length, 'labels differ per kind');
});

test('error uses role alert, other kinds use role status', () => {
    assert.equal(createMenuStateNotice(doc, { kind: 'error', title: 'a', text: 'b' }).element.getAttribute('role'), 'alert');
    for (const kind of ['empty', 'loading', 'info']) {
        assert.equal(createMenuStateNotice(doc, { kind, title: 'a', text: 'b' }).element.getAttribute('role'), 'status');
    }
});

test('unknown kind falls back to info', () => {
    const notice = createMenuStateNotice(doc, { kind: 'weird', title: 'a', text: 'b' });
    assert.equal(notice.element.dataset.kind, 'info');
});

test('action button is a real button and calls onAction; dispose removes the listener', () => {
    let calls = 0;
    const notice = createMenuStateNotice(doc, {
        kind: 'empty', title: 'Leer', text: 'Nichts da', actionLabel: 'Neu', onAction: () => { calls += 1; },
    });
    const button = part(notice, 'action');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, 'Neu');
    button.click();
    assert.equal(calls, 1);
    notice.dispose();
    assert.equal(button.listenerCount(), 0);
    button.click();
    assert.equal(calls, 1);
});

test('without actionLabel the action button stays hidden', () => {
    const notice = createMenuStateNotice(doc, { kind: 'info', title: 'a', text: 'b' });
    assert.equal(part(notice, 'action').hidden, true);
});

test('update changes texts, kind and role without rebuilding', () => {
    const notice = createMenuStateNotice(doc, { kind: 'loading', title: 'Lädt', text: 'Moment' });
    const titleNode = part(notice, 'title');
    updateMenuStateNotice(notice.element, { kind: 'error', title: 'Fehler', text: 'Kaputt' });
    assert.equal(part(notice, 'title'), titleNode);
    assert.equal(titleNode.textContent, 'Fehler');
    assert.equal(part(notice, 'text').textContent, 'Kaputt');
    assert.equal(notice.element.dataset.kind, 'error');
    assert.equal(notice.element.getAttribute('role'), 'alert');
    assert.notEqual(part(notice, 'label').textContent, 'Lädt …');
});

test('update can add, relabel and hide the action button', () => {
    let calls = 0;
    const notice = createMenuStateNotice(doc, { kind: 'empty', title: 'a', text: 'b', actionLabel: 'Eins', onAction: () => { calls += 1; } });
    updateMenuStateNotice(notice.element, { actionLabel: 'Zwei' });
    const button = part(notice, 'action');
    assert.equal(button.textContent, 'Zwei');
    assert.equal(button.hidden, false);
    button.click();
    assert.equal(calls, 1);
    updateMenuStateNotice(notice.element, { actionLabel: '' });
    assert.equal(button.hidden, true);
});

test('catalog is complete, frozen and has non-empty title and text per entry', () => {
    const ids = [
        'lobby-list-empty', 'connection-lost', 'map-filter-empty', 'no-recordings',
        'no-ghost-yet', 'no-profiles-for-slot', 'loading-map', 'generic-error',
    ];
    for (const id of ids) {
        const entry = MENU_STATE_NOTICE_CATALOG[id];
        assert.ok(entry, `${id} exists`);
        assert.equal(entry.id, id);
        assert.ok(MENU_STATE_NOTICE_KINDS.includes(entry.kind));
        assert.ok(entry.title.trim().length > 0, `${id} title`);
        assert.ok(entry.text.trim().length > 0, `${id} text`);
        assert.ok(Object.isFrozen(entry), `${id} frozen`);
    }
    assert.ok(Object.isFrozen(MENU_STATE_NOTICE_CATALOG));
    assert.equal(MENU_STATE_NOTICE_CATALOG['lobby-list-empty'].actionLabel, 'Eigene Lobby erstellen');
    assert.equal(MENU_STATE_NOTICE_CATALOG['map-filter-empty'].actionLabel, 'Filter zurücksetzen');
    assert.equal(MENU_STATE_NOTICE_CATALOG['connection-lost'].actionLabel, 'Erneut versuchen');
});

test('resolve fills the reason placeholder and falls back to generic-error for unknown ids', () => {
    const lost = resolveMenuStateNotice('connection-lost', { reason: 'Zeitüberschreitung' });
    assert.ok(lost.text.includes('Zeitüberschreitung'));
    assert.ok(!lost.text.includes('{reason}'));
    const noReason = resolveMenuStateNotice('connection-lost');
    assert.ok(!noReason.text.includes('{reason}'));
    assert.ok(noReason.text.trim().length > 0);
    const unknown = resolveMenuStateNotice('does-not-exist');
    assert.equal(unknown.id, 'generic-error');
    assert.equal(unknown.kind, 'error');
    assert.equal(resolveMenuStateNotice('no-ghost-yet').text,
        'Noch kein Geist für diese Etappe. Flieg sie einmal, dann fliegt deine Bestleistung mit.');
});

test('the symbol is hidden from screen readers because the label already says it', () => {
    const notice = createMenuStateNotice(doc, { kind: 'error', title: 'Titel' });
    assert.equal(part(notice, 'symbol').getAttribute('aria-hidden'), 'true');
    assert.equal(part(notice, 'label').getAttribute('aria-hidden'), null);
});
