import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GUEST_LOCKED_LEVEL4_SECTIONS,
    LOBBY_GUEST_LOCK_HINT,
    applyLobbyGuestMatchLock,
    isLobbyGuestMatchLocked,
} from '../src/ui/start-setup/LobbyGuestMatchLock.js';

test('only a guest in a joined lobby gets the match settings locked', () => {
    assert.equal(isLobbyGuestMatchLocked({ joined: true, isHost: false }, true), true);
    assert.equal(isLobbyGuestMatchLocked({ joined: true, isHost: true }, true), false);
    assert.equal(isLobbyGuestMatchLocked({ joined: false, isHost: false }, true), false);
    assert.equal(isLobbyGuestMatchLocked({ joined: true, isHost: false }, false), false);
});

function createSection(id) {
    const body = { inert: false };
    const section = {
        dataset: { level4Section: id },
        children: [body],
        body,
        prepend(node) { this.children.unshift(node); node.parent = this; },
        querySelector(selector) {
            if (selector === '.lobby-guest-lock-hint') return this.children.find((node) => node.isHint) || null;
            return null;
        },
        querySelectorAll(selector) { return selector === '.menu-section' ? [body] : []; },
    };
    return section;
}

function createDocument() {
    const sections = ['controls', 'gameplay', 'audio', 'advanced_map', 'presets', 'hud'].map(createSection);
    return {
        sections,
        querySelectorAll: (selector) => (selector === '[data-level4-section]' ? sections : []),
        createElement: () => ({ isHint: true, className: '', textContent: '', remove() { const list = this.parent.children; list.splice(list.indexOf(this), 1); } }),
    };
}

test('a guest cannot change match rules, only local options', () => {
    const doc = createDocument();
    applyLobbyGuestMatchLock(doc, true);
    for (const section of doc.sections) {
        const locked = GUEST_LOCKED_LEVEL4_SECTIONS.includes(section.dataset.level4Section);
        assert.equal(section.body.inert, locked, `${section.dataset.level4Section} inert`);
        assert.equal(!!section.querySelector('.lobby-guest-lock-hint'), locked, `${section.dataset.level4Section} hint`);
    }
    assert.equal(doc.sections[1].querySelector('.lobby-guest-lock-hint').textContent, LOBBY_GUEST_LOCK_HINT);
    assert.deepEqual([...GUEST_LOCKED_LEVEL4_SECTIONS].sort(), ['advanced_map', 'gameplay', 'presets']);
});

test('leaving the guest role unlocks the rules again and drops the hint', () => {
    const doc = createDocument();
    applyLobbyGuestMatchLock(doc, true);
    applyLobbyGuestMatchLock(doc, true);
    assert.equal(doc.sections[1].children.filter((node) => node.isHint).length, 1, 'no duplicate hint');
    applyLobbyGuestMatchLock(doc, false);
    assert.ok(doc.sections.every((section) => section.body.inert === false));
    assert.ok(doc.sections.every((section) => !section.querySelector('.lobby-guest-lock-hint')));
});
