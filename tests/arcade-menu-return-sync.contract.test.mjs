// M6 (playtest 17.09.2026): after Escape out of a run the arcade menu still said "Score 0" and
// "noch nicht gespielt", because it re-read the records only on its own buttons.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { observeMenuReturn } from '../src/ui/arcade/MenuReturnObserver.js';

function fakeMenu(hidden) {
    const classes = new Set(hidden ? ['hidden'] : []);
    return {
        classList: {
            contains: (name) => classes.has(name),
            set(hiddenNow) { if (hiddenNow) classes.add('hidden'); else classes.delete('hidden'); },
        },
    };
}

class FakeObserver {
    static last = null;
    constructor(callback) { this.callback = callback; this.disconnected = false; FakeObserver.last = this; }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    fire() { if (!this.disconnected) this.callback([]); }
}

test('the menu surface refreshes once each time the menu comes back', () => {
    const menu = fakeMenu(false);
    let syncs = 0;
    const observer = observeMenuReturn(menu, () => { syncs += 1; }, FakeObserver);
    assert.deepEqual(observer.options, { attributes: true, attributeFilter: ['class'] });

    menu.classList.set(true); observer.fire();
    assert.equal(syncs, 0, 'hiding the menu for a run does not refresh');
    menu.classList.set(false); observer.fire();
    assert.equal(syncs, 1, 'returning to the menu refreshes');
    observer.fire();
    assert.equal(syncs, 1, 'unrelated class changes on a visible menu do not refresh again');
});

test('setting the surface up again replaces the old observer', () => {
    const first = observeMenuReturn(fakeMenu(true), () => {}, FakeObserver);
    observeMenuReturn(fakeMenu(true), () => {}, FakeObserver);
    assert.equal(first.disconnected, true);
});

test('the arcade menu surface wires its sync to the menu return', () => {
    const source = readFileSync(new URL('../src/ui/arcade/ArcadeMenuSurface.js', import.meta.url), 'utf8');
    assert.match(source, /observeMenuReturn\([^)]*#main-menu[^)]*\)?[^;]*sync/);
});
