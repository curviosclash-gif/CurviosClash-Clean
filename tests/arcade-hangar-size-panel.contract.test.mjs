// ============================================
// arcade-hangar-size-panel.contract.test.mjs - Paket 2a, Hangar-Reiter "Form" / Abschnitt "Größe":
// Kaufbestätigung (gehaltene Enter-Taste, frische XP-Werte), Tastaturfokus, Lager-Tooltip und
// der nicht übernommene Größenentwurf in der 3D-Vorschau.
//
// Node hat keinen Browser: ein kleiner Dokument-Ersatz merkt sich, was das Panel baut. Enter auf
// einem Knopf löst wie in Chromium einen Klick aus, solange kein keydown-Lauscher das verhindert.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    toggle(name, force) {
        const on = force === undefined ? !this.values.has(name) : !!force;
        if (on) this.values.add(name); else this.values.delete(name);
        return on;
    }
    contains(name) { return this.values.has(name); }
}

function matches(node, selector) {
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    const data = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!data) throw new Error(`selector not supported: ${selector}`);
    const key = data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return node.dataset[key] !== undefined;
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.dataset = {};
        this.classList = new FakeClassList();
        this.listeners = {};
        this.textContent = '';
        this.disabled = false;
        this.type = '';
        this.id = '';
        this.value = '';
        this.tabIndex = 0;
    }
    set className(value) {
        this.classList = new FakeClassList();
        String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
    }
    get className() { return [...this.classList.values].join(' '); }
    get title() { return this.attributes.get('title') ?? ''; }
    set title(value) { this.attributes.set('title', String(value)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) {
        for (const node of nodes) {
            if (typeof node === 'string') { this.textContent += node; continue; }
            node.parentElement = this;
            this.children.push(node);
        }
    }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) {
        this.children.forEach((child) => { child.parentElement = null; });
        this.children = [];
        this.append(...nodes);
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    removeEventListener() {}
    dispatchEvent(event) {
        event.target ||= this;
        for (let node = this; node && !event.stopped; node = node.parentElement) {
            (node.listeners[event.type] || []).forEach((handler) => handler(event));
        }
        return !event.defaultPrevented;
    }
    click() { if (!this.disabled) this.dispatchEvent(createEvent('click')); }
    focus() { if (isUsable(this)) fakeDocument.activeElement = this; }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node;
        return null;
    }
    contains(node) {
        for (let current = node; current; current = current.parentElement) if (current === this) return true;
        return false;
    }
    querySelectorAll(selector) {
        const found = [];
        const walk = (node) => node.children.forEach((child) => { if (matches(child, selector)) found.push(child); walk(child); });
        walk(this);
        return found;
    }
}

function createEvent(type, extra = {}) {
    return {
        type, defaultPrevented: false, stopped: false, ...extra,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
    };
}

function isUsable(node) {
    for (let current = node; current; current = current.parentElement) {
        if (current.disabled || current.classList.contains('hidden')) return false;
    }
    return true;
}

const fakeDocument = { activeElement: null, createElement: (tag) => new FakeElement(tag) };
globalThis.document = fakeDocument;

const { createHangarSizePanel } = await import('../src/ui/hangar/HangarSizePanel.js');
const { createHangarFormTab } = await import('../src/ui/hangar/HangarFormTab.js');
const { createArcadeVehicleProfileRecord } = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');

const bind = (node, type, handler) => node.addEventListener(type, handler);

// Enter on a focused button: keydown bubbles, then Chromium clicks unless a listener prevented it.
function pressEnter(node, repeat = false) {
    const event = createEvent('keydown', { key: 'Enter', repeat, target: node });
    node.dispatchEvent(event);
    if (!event.defaultPrevented && node.tagName === 'BUTTON') node.click();
}

function find(root, className) {
    return root.classList.contains(className) ? root : root.querySelectorAll(`.${className}`)[0];
}

function createPanel(extra = {}) {
    const harness = {
        profile: { ...createArcadeVehicleProfileRecord('ship5', 0), xpBank: 1000, ...extra },
        saves: [],
        toasts: [],
    };
    harness.panel = createHangarSizePanel({
        bind,
        getProfile: () => harness.profile,
        saveProfile(next) {
            harness.profile = next;
            harness.saves.push(next);
            harness.panel.render('ship5', next);
        },
        toast: (message) => harness.toasts.push(message),
        onDraftChange() {},
    });
    const root = harness.panel.root;
    Object.assign(harness, {
        root,
        unlockButton: find(root, 'hangar-size-unlock'),
        buyStep: find(root, 'hangar-size-buy-step'),
        buyItems: root.querySelectorAll('[data-storage]').find((node) => node.dataset.storage === 'items'),
        confirmBox: find(root, 'hangar-size-confirm'),
        confirmAccept: find(root, 'hangar-size-confirm-accept'),
        confirmLines: () => find(root, 'hangar-size-confirm-lines').children.map((line) => line.textContent),
        row: (group) => root.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === group),
    });
    harness.panel.render('ship5', harness.profile);
    return harness;
}

function assertFocusUsable(harness, label) {
    const focused = fakeDocument.activeElement;
    assert.ok(harness.root.contains(focused), `${label}: Fokus bleibt im Größen-Panel`);
    assert.ok(isUsable(focused), `${label}: Fokus liegt auf einem sichtbaren, aktiven Element (${focused?.className})`);
}

// --- D: gehaltene Enter-Taste ---

test('D: eine gehaltene Enter-Taste bestätigt keinen XP-Kauf, erst ein neuer Tastendruck', () => {
    const harness = createPanel({ sizeWorkshopUnlocked: true, xpBank: 8500 });
    harness.buyStep.focus();
    pressEnter(harness.buyStep);
    assert.equal(harness.confirmBox.classList.contains('hidden'), false, 'Bestätigung offen');
    for (let repeat = 0; repeat < 6; repeat += 1) pressEnter(fakeDocument.activeElement, true);
    assert.equal(harness.saves.length, 0, 'Tastenwiederholung kauft nichts');
    pressEnter(harness.confirmAccept);
    assert.equal(harness.saves.length, 1, 'ein bewusster Tastendruck kauft genau einen Schritt');
    assert.equal(harness.profile.purchasedSizeSteps, 1);
});

// --- I: offene Bestätigung zeigt aktuelle Werte ---

test('I: eine offene Kaufbestätigung rechnet beim Neu-Rendern mit dem aktuellen Profil', () => {
    const harness = createPanel({ sizeWorkshopUnlocked: true, xpBank: 1000 });
    harness.buyStep.click();
    assert.ok(harness.confirmLines().includes('XP: 1.000 → 900'));
    harness.profile = { ...harness.profile, xpBank: 800 };
    harness.panel.render('ship5', harness.profile);
    assert.ok(harness.confirmLines().includes('XP: 800 → 700'), harness.confirmLines().join(' | '));
    harness.profile = { ...harness.profile, xpBank: 50 };
    harness.panel.render('ship5', harness.profile);
    assert.equal(harness.confirmBox.classList.contains('hidden'), true, 'nicht mehr bezahlbar: Bestätigung schließt');
});

// --- J: Tastaturfokus ---

test('J: nach Freigabe, Kauf und Grenz-Klick bleibt der Tastaturfokus auf einem sinnvollen Element', () => {
    const unlock = createPanel({ xpBank: 100 });
    unlock.unlockButton.focus();
    unlock.unlockButton.click();
    unlock.confirmAccept.click();
    assert.equal(unlock.profile.sizeWorkshopUnlocked, true);
    assertFocusUsable(unlock, 'Freigabe');

    const purchase = createPanel({ sizeWorkshopUnlocked: true, xpBank: 100 });
    purchase.buyStep.focus();
    purchase.buyStep.click();
    purchase.confirmAccept.click();
    assert.equal(purchase.profile.purchasedSizeSteps, 1);
    assert.equal(purchase.buyStep.disabled, true, 'keine XP mehr für den nächsten Schritt');
    assertFocusUsable(purchase, 'Kauf');

    const edge = createPanel({ sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: { hull: 120 } });
    const plus = find(edge.row('hull'), 'hangar-size-plus');
    plus.focus();
    plus.click();
    assert.equal(plus.disabled, true, 'Rumpf steht auf 125 %');
    assertFocusUsable(edge, 'Grenz-Klick');
    assert.equal(fakeDocument.activeElement, find(edge.row('hull'), 'hangar-size-minus'), 'Gegenknopf derselben Zeile');
});

// --- K: Lager-Tooltip ---

test('K: ein voll ausgebautes Lager zeigt keinen veralteten Tooltip „Kaufbar“', () => {
    const harness = createPanel({
        sizeWorkshopUnlocked: true, xpBank: 5000, purchasedSizeSteps: 5,
        partSizes: { hull: 100, nose: 100, wings: 100, engines: 100, utility: 125 }, purchasedItemSlots: 2,
    });
    assert.equal(harness.buyItems.title, 'Kaufbar');
    harness.buyItems.click();
    harness.confirmAccept.click();
    assert.equal(harness.profile.purchasedItemSlots, 3);
    assert.match(harness.buyItems.textContent, /voll ausgebaut/);
    assert.notEqual(harness.buyItems.title, 'Kaufbar');
});

// --- L: Werte-Banner zum Sektorstart ---

test('L: das Werte-Banner zeigt die Größen-Wirkung, auch gesenkte Werte mit Vorzeichen', async () => {
    const { ParcoursOverlayController } = await import('../src/ui/arcade/ParcoursOverlayController.js');
    const overlay = new FakeElement('div');
    fakeDocument.body = new FakeElement('body');
    const hudState = { vehicleStats: { level: 7, speedBonusPct: -8, turningBonusPct: 11.25, maxHpBonus: 30 } };
    ParcoursOverlayController.prototype.tickStatsFlash.call({ _ensureOverlay: () => overlay }, hudState, 0, true);
    assert.equal(overlay.textContent, 'Lv 7  |  Speed -8%  |  Kurve +11%  |  HP +30');
});

// --- H: nicht übernommener Größenentwurf ---

test('H: ein nicht übernommener Größenentwurf gilt nur im Reiter „Form“ und verfällt beim Verlassen', () => {
    const styles = [];
    let profile = {
        ...createArcadeVehicleProfileRecord('ship5', 0),
        sizeWorkshopUnlocked: true, purchasedSizeSteps: 5,
    };
    let active = true;
    const panel = new FakeElement('div');
    const tab = createHangarFormTab({
        bind,
        enabled: true,
        viewport: { setPartStyle: (style) => styles.push(style) },
        panel,
        tabButton: new FakeElement('button'),
        getProfile: () => profile,
        saveProfile: (next) => { profile = next; },
        toast() {},
        onChange: () => tab.sync('ship5', active),
    });
    tab.sync('ship5', true);
    const noseRow = panel.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === 'nose');
    find(noseRow, 'hangar-size-plus').click();
    find(noseRow, 'hangar-size-plus').click();
    assert.equal(styles.at(-1).Bugkeil?.scale, 1.1, 'im Reiter „Form“ zeigt die Vorschau den Entwurf');

    active = false;
    tab.sync('ship5', false);
    assert.equal(styles.at(-1).Bugkeil?.scale, undefined, 'außerhalb zeigt das Schiff die übernommene Größe');
    active = true;
    tab.sync('ship5', true);
    assert.equal(styles.at(-1).Bugkeil?.scale, undefined, 'der verlassene Entwurf ist verworfen');
    assert.equal(profile.partSizes?.nose ?? 100, 100, 'das Profil blieb unverändert');
});
