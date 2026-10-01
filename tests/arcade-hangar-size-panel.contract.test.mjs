// ============================================
// arcade-hangar-size-panel.contract.test.mjs - Paket 2a, Hangar-Reiter "Ausbau" / Abschnitt "Größe":
// Kaufbestätigung (gehaltene Enter-Taste, frische XP-Werte), Tastaturfokus, Lager-Tooltip und
// der nicht übernommene Größenentwurf in der 3D-Vorschau.
//
// Node hat keinen Browser: der Dokument-Ersatz aus tests/helpers/fake-hangar-dom.mjs merkt sich,
// was das Panel baut.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FakeElement, bind, createEvent, fakeDocument, find, isUsable, pressEnter,
} from './helpers/fake-hangar-dom.mjs';

const { createHangarSizePanel } = await import('../src/ui/hangar/HangarSizePanel.js');
const { createHangarFormTab } = await import('../src/ui/hangar/HangarFormTab.js');
const { createArcadeVehicleProfileRecord } = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');
const hitboxContract = await import('../src/shared/contracts/ArcadeVehicleHitboxContract.js');
const { PLAYER_SHIP_PART_CONFIGS } = await import('../src/shared/vehicle-lab/player-ships/index.js');

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

test('H: ein nicht übernommener Größenentwurf gilt nur im Reiter „Ausbau“ und verfällt beim Verlassen', () => {
    const styles = [];
    let profile = {
        ...createArcadeVehicleProfileRecord('ship5', 0),
        sizeWorkshopUnlocked: true, purchasedSizeSteps: 5,
    };
    let view = 'upgrade';
    const upgradePanel = new FakeElement('div');
    const tab = createHangarFormTab({
        bind,
        enabled: true,
        viewport: { setPartStyle: (style) => styles.push(style), setHitboxOverlay() {} },
        panel: new FakeElement('div'),
        tabButton: new FakeElement('button'),
        upgradePanel,
        upgradeTabButton: new FakeElement('button'),
        getProfile: () => profile,
        saveProfile: (next) => { profile = next; },
        toast() {},
        onChange: () => tab.sync('ship5', view),
    });
    tab.sync('ship5', view);
    const noseRow = upgradePanel.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === 'nose');
    find(noseRow, 'hangar-size-plus').click();
    find(noseRow, 'hangar-size-plus').click();
    assert.equal(styles.at(-1).Bugkeil?.scale, 1.1, 'im Reiter „Ausbau“ zeigt die Vorschau den Entwurf');

    view = 'form';
    tab.sync('ship5', view);
    assert.equal(styles.at(-1).Bugkeil?.scale, undefined, 'außerhalb, auch im Reiter „Form“, zeigt das Schiff die übernommene Größe');
    view = 'upgrade';
    tab.sync('ship5', view);
    assert.equal(styles.at(-1).Bugkeil?.scale, undefined, 'der verlassene Entwurf ist verworfen');
    assert.equal(profile.partSizes?.nose ?? 100, 100, 'das Profil blieb unverändert');
});

// --- Trefferzone: Anzeige als Boxen und Zeile in der Wertvorschau ---

const SHIP5 = PLAYER_SHIP_PART_CONFIGS.find((config) => config.id === 'ship5');

function createUpgradeTab() {
    const harness = { overlays: [], view: 'upgrade' };
    harness.profile = { ...createArcadeVehicleProfileRecord('ship5', 0), sizeWorkshopUnlocked: true, purchasedSizeSteps: 5 };
    harness.panel = new FakeElement('div');
    const sync = () => harness.tab.sync('ship5', harness.view);
    harness.tab = createHangarFormTab({
        bind,
        enabled: true,
        viewport: { setPartStyle() {}, setHitboxOverlay: (boxes) => harness.overlays.push(boxes) },
        panel: new FakeElement('div'),
        tabButton: new FakeElement('button'),
        upgradePanel: harness.panel,
        upgradeTabButton: new FakeElement('button'),
        getProfile: () => harness.profile,
        saveProfile: (next) => { harness.profile = next; sync(); },
        toast() {},
        onChange: sync,
    });
    sync();
    harness.click = (group, className) => find(panelRow(harness.panel, group), className).click();
    harness.preview = () => find(harness.panel, 'hangar-size-preview').children.map((line) => line.textContent);
    harness.toggle = find(harness.panel, 'hangar-hitbox-toggle-input');
    return harness;
}

function panelRow(panel, group) {
    return panel.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === group);
}

test('Trefferzone: der Schalter legt die Boxen des Entwurfs über das Schiff, nur im Reiter „Ausbau“', () => {
    const harness = createUpgradeTab();
    assert.ok(harness.toggle, 'Schalter „Trefferzone zeigen“ vorhanden');
    assert.equal(harness.overlays.at(-1), null, 'aus: keine Boxen');
    harness.toggle.checked = true;
    harness.toggle.dispatchEvent(createEvent('change'));
    assert.deepEqual(harness.overlays.at(-1), hitboxContract.listArcadeHitboxBoxes(SHIP5, null), 'an: volle Trefferzone in Werksgröße');
    harness.click('wings', 'hangar-size-plus');
    assert.deepEqual(harness.overlays.at(-1), hitboxContract.listArcadeHitboxBoxes(SHIP5, { wings: 105 }), 'folgt dem nicht übernommenen Entwurf');
    harness.view = 'form';
    harness.tab.sync('ship5', harness.view);
    assert.equal(harness.overlays.at(-1), null, 'außerhalb des Reiters, auch im Reiter „Form“, keine Boxen');
    harness.toggle.checked = false;
    harness.view = 'upgrade';
    harness.tab.sync('ship5', harness.view);
    assert.equal(harness.overlays.at(-1), null, 'ausgeschaltet: keine Boxen');
});

test('Trefferzone: die Wertvorschau nennt ihre Veränderung (alt → neu, Prozent der Werksgröße)', () => {
    const harness = createUpgradeTab();
    assert.deepEqual(harness.preview(), ['Keine Änderung']);
    const factory = hitboxContract.measureArcadeHitboxSurface(SHIP5.parts, null);
    const expectLine = (sizes) => {
        const line = harness.preview().find((text) => text.startsWith('Trefferzone'));
        const match = /^Trefferzone: 100 % → (\d+(?:,\d)?) %$/.exec(line || '');
        assert.ok(match, harness.preview().join(' | '));
        const expected = hitboxContract.measureArcadeHitboxSurface(SHIP5.parts, sizes) / factory * 100;
        assert.ok(Math.abs(Number(match[1].replace(',', '.')) - expected) <= 0.05, `${match[1]} vs ${expected}`);
        return expected;
    };
    harness.click('wings', 'hangar-size-plus');
    assert.ok(expectLine({ wings: 105 }) > 100, 'größere Flügel: größere Trefferzone');
    harness.click('wings', 'hangar-size-minus');
    assert.deepEqual(harness.preview(), ['Keine Änderung']);
    harness.click('hull', 'hangar-size-minus');
    assert.ok(expectLine({ hull: 95 }) < 100, 'kleinerer Rumpf: kleinere Trefferzone');
});
