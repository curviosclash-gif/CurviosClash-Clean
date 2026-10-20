// M6 (playtest 17.09.2026): after Escape out of a run the arcade menu still said "Score 0" and
// "noch nicht gespielt", because it re-read the records only on its own buttons.

import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuController } from '../src/ui/MenuController.js';
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
    static instances = [];
    constructor(callback) { this.callback = callback; this.disconnected = false; FakeObserver.instances.push(this); }
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

test('menu-return observers keep independent roots and disconnect only their own observer', () => {
    const firstMenu = fakeMenu(true);
    const secondMenu = fakeMenu(true);
    let firstSyncs = 0;
    let secondSyncs = 0;
    const first = observeMenuReturn(firstMenu, () => { firstSyncs += 1; }, FakeObserver);
    const second = observeMenuReturn(secondMenu, () => { secondSyncs += 1; }, FakeObserver);

    assert.equal(first.disconnected, false);
    assert.equal(second.disconnected, false);
    firstMenu.classList.set(false);
    secondMenu.classList.set(false);
    first.fire();
    second.fire();
    assert.equal(firstSyncs, 1);
    assert.equal(secondSyncs, 1);

    first.disconnect();
    firstMenu.classList.set(true);
    firstMenu.classList.set(false);
    first.fire();
    secondMenu.classList.set(true);
    second.fire();
    secondMenu.classList.set(false);
    second.fire();
    assert.equal(firstSyncs, 1, 'disposing one root leaves its observer detached');
    assert.equal(secondSyncs, 2, 'disposing one root leaves the other observer active');
});

function createMenuDocument() {
    const created = [];
    const element = (tag = 'div') => {
        const classes = new Set();
        const listeners = new Map();
        const node = {
            tagName: String(tag).toUpperCase(), id: '', type: '', value: '', textContent: '', title: '',
            disabled: false, open: false, hidden: false, style: {}, dataset: {}, attributes: {}, children: [],
            parentElement: null, ownerDocument: null,
            get className() { return [...classes].join(' '); },
            set className(value) { classes.clear(); String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
            classList: {
                add: (...names) => names.forEach((name) => classes.add(name)),
                remove: (...names) => names.forEach((name) => classes.delete(name)),
                toggle: (name, force) => {
                    const on = force === undefined ? !classes.has(name) : !!force;
                    if (on) classes.add(name); else classes.delete(name);
                    return on;
                },
                contains: (name) => classes.has(name),
            },
            get options() { return node.children; },
            setAttribute(name, value) { node.attributes[name] = String(value); },
            getAttribute(name) { return node.attributes[name] ?? null; },
            removeAttribute(name) { delete node.attributes[name]; },
            appendChild(child) { child.parentElement = node; node.children.push(child); return child; },
            append(...nodes) { nodes.forEach((child) => node.appendChild(child)); },
            insertBefore(child) { return node.appendChild(child); },
            removeChild(child) { node.children = node.children.filter((entry) => entry !== child); child.parentElement = null; return child; },
            replaceChildren(...nodes) { node.children = []; nodes.forEach((child) => node.appendChild(child)); },
            remove() { node.parentElement?.removeChild(node); },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            closest(selector) { return selector === '#main-menu' ? mainMenu : null; },
            addEventListener(type, handler) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(handler);
            },
            removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
            dispatch(type, event = {}) { for (const handler of [...(listeners.get(type) || [])]) handler({ target: node, ...event }); },
        };
        created.push(node);
        return node;
    };
    const mainMenu = element('main');
    mainMenu.id = 'main-menu';
    mainMenu.classList.add('hidden');
    const level3Body = element('div');
    level3Body.querySelector = () => null;
    level3Body.closest = (selector) => selector === '#main-menu' ? mainMenu : null;
    const document = {
        createElement: element,
        querySelector: (selector) => selector === '#submenu-game .level3-body' ? level3Body : null,
        querySelectorAll: () => [],
        getElementById: (id) => created.find((node) => node.id === id) || null,
    };
    for (const node of created) node.ownerDocument = document;
    return { document, mainMenu, level3Body, createElement: element };
}

test('MenuController disposes only its Arcade observer and queued surface syncs become inert', () => {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousMutationObserver = globalThis.MutationObserver;
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const previousObservers = FakeObserver.instances;
    FakeObserver.instances = [];
    let nextFrameId = 1;
    let nextTimerId = 1;
    const queuedFrames = new Map();
    const queuedTimers = new Map();
    const cancelledFrames = [];
    const cancelledTimers = [];
    globalThis.window = {
        localStorage: { getItem: () => null, setItem() {} },
        requestAnimationFrame(callback) { const id = nextFrameId++; queuedFrames.set(id, callback); return id; },
        cancelAnimationFrame(id) { cancelledFrames.push(id); queuedFrames.delete(id); },
    };
    globalThis.setTimeout = (callback) => { const id = nextTimerId++; queuedTimers.set(id, callback); return id; };
    globalThis.clearTimeout = (id) => { cancelledTimers.push(id); queuedTimers.delete(id); };
    globalThis.MutationObserver = FakeObserver;

    const createController = () => {
        const fake = createMenuDocument();
        globalThis.document = fake.document;
        const sessionButton = fake.createElement('button');
        sessionButton.dataset.sessionType = 'splitscreen';
        let surfaceReads = 0;
        const controller = new MenuController({
            ui: { sessionButtons: [sessionButton] },
            settings: {
                gameMode: 'ARCADE', mode: '2p', numBots: 3,
                localSettings: { modePath: 'arcade', sessionType: 'single' },
                arcade: { runType: 'gauntlet', sectorCount: 5, seed: 1 },
            },
            runtimeAccess: {
                getActivePlayerProfile: () => null,
                getPlayerProfiles: () => [],
                getSettingsStore: () => null,
                getArcadeMenuSurfaceState: () => { surfaceReads += 1; return null; },
            },
            onEvent() {},
        });
        controller.setupListeners();
        return { controller, fake, sessionButton, getSurfaceReads: () => surfaceReads };
    };

    try {
        const first = createController();
        const firstObserver = FakeObserver.instances.at(-1);
        first.sessionButton.dispatch('click');
        const firstQueued = [...queuedFrames.values()];
        assert.equal(queuedFrames.size, 1, 'the actual surface interaction queues one sync');
        first.fake.mainMenu.classList.remove('hidden');
        const queuedObserverDelivery = () => firstObserver.callback([]);

        first.controller.dispose();
        for (const callback of firstQueued) callback();
        queuedObserverDelivery();
        assert.equal(queuedFrames.size, 0, 'a late observer delivery after disposal queues no new sync');
        assert.deepEqual({
            observerDisconnected: firstObserver.disconnected,
            surfaceReadsAfterQueuedSync: first.getSurfaceReads(),
        }, {
            observerDisconnected: true,
            surfaceReadsAfterQueuedSync: 1,
        }, 'MenuController disposal disconnects the observer and makes queued syncs inert');
        assert.equal(cancelledFrames.length, 1, 'disposing the controller cancels its queued frame callback');

        window.requestAnimationFrame = undefined;
        const timerSurface = createController();
        const timerObserver = FakeObserver.instances.at(-1);
        timerSurface.sessionButton.dispatch('click');
        const queuedTimerCallbacks = [...queuedTimers.values()];
        assert.equal(queuedTimers.size, 1, 'the timeout fallback queues one sync when RAF is unavailable');
        timerSurface.controller.dispose();
        for (const callback of queuedTimerCallbacks) callback();
        assert.deepEqual({
            observerDisconnected: timerObserver.disconnected,
            surfaceReadsAfterQueuedSync: timerSurface.getSurfaceReads(),
        }, {
            observerDisconnected: true,
            surfaceReadsAfterQueuedSync: 1,
        }, 'the timeout fallback is also inert after its MenuController is disposed');
        assert.equal(cancelledTimers.length, 1);
    } finally {
        for (const observer of FakeObserver.instances) observer.disconnect();
        FakeObserver.instances = previousObservers;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        if (previousMutationObserver === undefined) delete globalThis.MutationObserver;
        else globalThis.MutationObserver = previousMutationObserver;
        globalThis.setTimeout = previousSetTimeout;
        globalThis.clearTimeout = previousClearTimeout;
    }
});
