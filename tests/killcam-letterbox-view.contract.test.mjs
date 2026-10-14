// ============================================
// killcam-letterbox-view.contract.test.mjs - the UI draws the killcam bars
// ============================================
//
// The killcam (src/hunt) only reports on/off; the bars and the HUD marker are drawn by
// src/ui/KillcamLetterboxView.js, which the HUD binds to every new entity manager.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindKillcamLetterbox, createKillcamLetterboxView } from '../src/ui/KillcamLetterboxView.js';

function createClassList(initial = []) {
    const classes = new Set(initial);
    return {
        classes,
        add: (...names) => names.forEach((name) => classes.add(name)),
        toggle(name, force) {
            if (force) classes.add(name);
            else classes.delete(name);
        },
    };
}

function createFakeDocument() {
    const byId = new Map();
    const hud = { classList: createClassList() };
    byId.set('hud', hud);
    const createElement = () => {
        const el = {
            id: '',
            children: [],
            attributes: {},
            textContent: '',
            removed: false,
            set className(value) { el.classList = createClassList(String(value).split(' ')); },
            setAttribute(name, value) { el.attributes[name] = value; },
            appendChild(child) { el.children.push(child); if (child.id) byId.set(child.id, child); },
            remove() { el.removed = true; byId.delete(el.id); },
        };
        return el;
    };
    const body = createElement();
    return {
        hud,
        body,
        createElement,
        getElementById: (id) => byId.get(id) || null,
    };
}

test('the view shows and hides the bars and the HUD marker', () => {
    const doc = createFakeDocument();
    const view = createKillcamLetterboxView(doc);

    view.setVisible(true, { reduceMotion: true });
    const bars = doc.getElementById('killcam-letterbox');
    assert.ok(bars, 'the bars are created on first show');
    assert.equal(bars.children.length, 3);
    assert.equal(bars.classList.classes.has('hidden'), false);
    assert.equal(bars.classList.classes.has('reduced-motion'), true);
    assert.equal(bars.attributes['aria-hidden'], 'false');
    assert.equal(doc.hud.classList.classes.has('killcam-active'), true);

    view.setVisible(false, { reduceMotion: true });
    assert.equal(bars.classList.classes.has('hidden'), true);
    assert.equal(bars.classList.classes.has('reduced-motion'), false);
    assert.equal(doc.hud.classList.classes.has('killcam-active'), false);

    view.dispose();
    assert.equal(bars.removed, true, 'the view removes the bars it created');
});

test('hiding before any show creates nothing', () => {
    const doc = createFakeDocument();
    const view = createKillcamLetterboxView(doc);
    view.setVisible(false);
    assert.equal(doc.getElementById('killcam-letterbox'), null);
});

test('dispose hides existing static bars without removing them', () => {
    const doc = createFakeDocument();
    const bars = doc.createElement('div');
    bars.id = 'killcam-letterbox';
    bars.className = 'killcam-letterbox hidden';
    bars.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(bars);

    const view = createKillcamLetterboxView(doc);
    view.setVisible(true);
    assert.equal(bars.classList.classes.has('hidden'), false);
    assert.equal(doc.hud.classList.classes.has('killcam-active'), true);

    view.dispose();

    assert.equal(bars.removed, false, 'static bars remain owned by the page');
    assert.equal(bars.classList.classes.has('hidden'), true);
    assert.equal(bars.attributes['aria-hidden'], 'true');
    assert.equal(doc.hud.classList.classes.has('killcam-active'), false);
});

test('the HUD binding detaches the old manager before binding a new one', () => {
    const listeners = [];
    const managerA = {
        listener: null,
        setKillcamPresentationListener(listener) { this.listener = listener; listeners.push(['a', listener]); },
    };
    const managerB = {
        listener: null,
        setKillcamPresentationListener(listener) { this.listener = listener; listeners.push(['b', listener]); },
    };

    const view = bindKillcamLetterbox(null, managerA);
    assert.equal(typeof managerA.listener, 'function');
    assert.equal(bindKillcamLetterbox(view, managerA), view);
    assert.equal(listeners.length, 1, 'the same manager is bound once');
    bindKillcamLetterbox(view, managerB);
    assert.equal(managerA.listener, null);
    assert.equal(typeof managerB.listener, 'function');
    assert.deepEqual(listeners.map(([name, listener]) => [name, listener === null ? null : typeof listener]), [
        ['a', 'function'],
        ['a', null],
        ['b', 'function'],
    ]);

    view.dispose();
    assert.equal(managerB.listener, null);
    assert.deepEqual(listeners.at(-1), ['b', null]);
});
