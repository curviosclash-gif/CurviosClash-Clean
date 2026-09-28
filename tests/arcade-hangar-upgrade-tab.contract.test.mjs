// ============================================
// arcade-hangar-upgrade-tab.contract.test.mjs - Hangar-Reiter "Ausbau" (Nutzerentscheidung
// 28.09.2026): Größenumbau, Lagerkäufe, Wertvorschau und Trefferzone ziehen aus dem Reiter "Form"
// in einen eigenen Reiter "Ausbau"; "Form" behält nur die Farbe; der Fight-Hangar bleibt, wie er war.
// Gesperrte Bereiche sind von Anfang an sichtbar, abgedunkelt, nennen ihre Bedingung und sind
// nicht bedienbar (Plan, Hangar-Bedienung: "Übersicht").
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    FakeElement, bind, find, isShown, isUsable,
} from './helpers/fake-hangar-dom.mjs';

const { createArcadeHangarWorkshopShell } = await import('../src/ui/hangar/ArcadeHangarWorkshopShell.js');
const { createHangarFormTab } = await import('../src/ui/hangar/HangarFormTab.js');
const { createHangarSizePanel } = await import('../src/ui/hangar/HangarSizePanel.js');
const { createArcadeVehicleProfileRecord } = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');

const viewsOf = (shell) => shell.buildViewSwitch.children.map((node) => node.dataset.buildView);
const tabOf = (shell, view) => shell.buildViewSwitch.children.find((node) => node.dataset.buildView === view);
const panelOf = (shell, view) => shell.buildScroll.children.find((node) => node.dataset.buildViewPanel === view);
const has = (root, className) => root.querySelectorAll(`.${className}`).length > 0;

/** Workshop tabs as ArcadeHangarWorkshop wires them: shell panels plus the Form/Ausbau tab module. */
function createWorkshopTabs(mode, profileExtra = {}) {
    const shell = createArcadeHangarWorkshopShell({}, { mode });
    const harness = { shell, styles: [], overlays: [], view: 'workshop' };
    harness.profile = { ...createArcadeVehicleProfileRecord('ship5', 0), xpBank: 1000, ...profileExtra };
    const sync = () => harness.tabs.sync('ship5', harness.view);
    harness.tabs = createHangarFormTab({
        bind,
        enabled: mode === 'arcade',
        viewport: {
            setPartStyle: (style, selected) => harness.styles.push({ style, selected }),
            setHitboxOverlay: (boxes) => harness.overlays.push(boxes),
        },
        panel: shell.formViewPanel,
        tabButton: shell.formViewButton,
        upgradePanel: shell.upgradeViewPanel,
        upgradeTabButton: shell.upgradeViewButton,
        getProfile: () => harness.profile,
        saveProfile: (next) => { harness.profile = next; sync(); },
        toast() {},
        onChange: sync,
    });
    harness.open = (view) => { harness.view = view; sync(); };
    sync();
    return harness;
}

function assertTabState(button, panel, active, label) {
    assert.equal(button.getAttribute('aria-selected'), String(active), `${label}: aria-selected`);
    assert.equal(button.tabIndex, active ? 0 : -1, `${label}: nur der offene Reiter ist per Tab erreichbar`);
    assert.equal(button.classList.contains('is-active'), active, `${label}: is-active`);
    assert.equal(panel.classList.contains('hidden'), !active, `${label}: Panel sichtbar genau wenn offen`);
}

// --- Reiter ---

test('Arcade: der Reiter „Ausbau“ steht als eigener Tab mit eigenem Panel in der Werkstatt', () => {
    const shell = createArcadeHangarWorkshopShell({}, { mode: 'arcade' });
    assert.deepEqual(viewsOf(shell), ['workshop', 'stats', 'presets', 'upgrade', 'form']);
    const tab = tabOf(shell, 'upgrade');
    const panel = panelOf(shell, 'upgrade');
    assert.ok(panel, 'Panel „Ausbau“ hängt in der Werkstatt');
    assert.equal(shell.upgradeViewButton, tab);
    assert.equal(shell.upgradeViewPanel, panel);
    assert.equal(tab.textContent, 'Ausbau');
    assert.equal(tab.classList.contains('hidden'), false, 'im Arcade-Hangar sichtbar');
    assert.equal(shell.buildViewSwitch.getAttribute('role'), 'tablist');
    assert.equal(tab.getAttribute('role'), 'tab');
    assert.equal(tab.getAttribute('aria-selected'), 'false');
    assert.equal(tab.getAttribute('aria-controls'), panel.id);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    assert.equal(panel.classList.contains('hidden'), true, 'startet geschlossen');
});

test('Fight: kein Reiter „Ausbau“, der Reiter „Form“ bleibt wie bisher versteckt', () => {
    const shell = createArcadeHangarWorkshopShell({}, { mode: 'fight' });
    assert.deepEqual(viewsOf(shell), ['workshop', 'stats', 'presets', 'form']);
    assert.equal(panelOf(shell, 'upgrade'), undefined);
    assert.equal(tabOf(shell, 'form').classList.contains('hidden'), true);
});

test('Arcade: „Form“ enthält nur noch die Farbe; Größe, Lager und Trefferzone liegen im Reiter „Ausbau“', () => {
    const { shell } = createWorkshopTabs('arcade');
    const form = shell.formViewPanel;
    const upgrade = shell.upgradeViewPanel;
    assert.ok(has(form, 'hangar-part-style'), 'Farbe bleibt im Reiter „Form“');
    for (const className of ['hangar-size-panel', 'hangar-size-shop', 'hangar-hitbox-toggle', 'hangar-part-style-scale', 'hangar-part-style-variant']) {
        assert.equal(has(form, className), false, `„Form“ ohne ${className}`);
    }
    for (const className of ['hangar-size-panel', 'hangar-size-groups', 'hangar-size-preview', 'hangar-size-undo', 'hangar-size-buy-step', 'hangar-size-buy-storage', 'hangar-size-confirm', 'hangar-hitbox-toggle-input']) {
        assert.ok(has(upgrade, className), `„Ausbau“ mit ${className}`);
    }
    assert.equal(has(upgrade, 'hangar-part-style'), false, 'keine Farbe im Reiter „Ausbau“');
});

test('Reiterwechsel: aria-selected, tabIndex und sichtbares Panel folgen dem offenen Reiter', () => {
    const harness = createWorkshopTabs('arcade');
    const { formViewButton, formViewPanel, upgradeViewButton, upgradeViewPanel } = harness.shell;
    for (const view of ['upgrade', 'form', 'workshop']) {
        harness.open(view);
        assertTabState(upgradeViewButton, upgradeViewPanel, view === 'upgrade', `${view}/Ausbau`);
        assertTabState(formViewButton, formViewPanel, view === 'form', `${view}/Form`);
    }
});

test('Arcade: die Farbe gilt in jedem Reiter, das gewählte Teil leuchtet nur im Reiter „Form“', () => {
    const harness = createWorkshopTabs('arcade', { partStyle: { Bugkeil: { color: 0xff0000 } } });
    harness.open('upgrade');
    assert.equal(harness.styles.at(-1).style.Bugkeil?.color, 0xff0000);
    assert.equal(harness.styles.at(-1).selected, '');
    harness.open('form');
    assert.equal(harness.styles.at(-1).style.Bugkeil?.color, 0xff0000);
    assert.notEqual(harness.styles.at(-1).selected, '', 'im Reiter „Form“ ist ein Teil gewählt');
});

test('Fight: der Reiter „Form“ zeigt wie bisher nur die Teilefarben, ohne Größe und Trefferzone', () => {
    const harness = createWorkshopTabs('fight');
    const form = harness.shell.formViewPanel;
    assert.equal(form.children.length, 1);
    assert.ok(form.children[0].classList.contains('hangar-part-style'));
    harness.open('form');
    assertTabState(harness.shell.formViewButton, form, true, 'Fight/Form');
    assert.deepEqual(harness.styles.at(-1).style, {}, 'Fight malt das Schiff nicht um');
    assert.equal(harness.overlays.at(-1), null, 'keine Trefferzone');
    harness.open('workshop');
    assertTabState(harness.shell.formViewButton, form, false, 'Fight/Umbau');
});

// --- Gesperrte Bereiche ---

function createSizePanel(extra = {}) {
    const harness = { profile: { ...createArcadeVehicleProfileRecord('ship5', 0), xpBank: 1000, ...extra } };
    harness.panel = createHangarSizePanel({
        bind,
        getProfile: () => harness.profile,
        saveProfile(next) {
            harness.profile = next;
            harness.panel.render('ship5', next);
        },
        toast() {},
        onDraftChange() {},
    });
    const root = harness.panel.root;
    harness.root = root;
    harness.row = (group) => root.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === group);
    harness.storage = (kind) => root.querySelectorAll('[data-storage]').find((node) => node.dataset.storage === kind);
    harness.panel.render('ship5', harness.profile);
    return harness;
}

/** The locked area around a node, its fieldset body and the condition line of that area. */
function lockOf(node) {
    const section = node.closest('.hangar-locked-section');
    assert.ok(section, `${node.className} liegt in einem sperrbaren Bereich`);
    return {
        section,
        body: find(section, 'hangar-locked-body'),
        condition: find(section, 'hangar-locked-condition'),
    };
}

test('Gesperrt: vor der Freigabe ist der Größen-Editor sichtbar, abgedunkelt, nennt seine Bedingung und ist nicht bedienbar', () => {
    const harness = createSizePanel();
    const editor = find(harness.root, 'hangar-size-editor');
    assert.equal(isShown(editor), true, 'der Editor ist von Anfang an sichtbar');
    const lock = lockOf(editor);
    assert.equal(lock.section.classList.contains('is-locked'), true, 'abgedunkelt');
    assert.equal(lock.body.tagName, 'FIELDSET');
    assert.equal(lock.body.disabled, true, 'disabled');
    assert.equal(lock.body.getAttribute('aria-disabled'), 'true', 'aria-disabled');
    assert.equal(lock.body.getAttribute('aria-describedby'), lock.condition.id, 'die Bedingung beschreibt den gesperrten Bereich');
    assert.equal(lock.condition.textContent, 'Größenumbau freischalten: 100 XP');
    assert.equal(isShown(lock.condition), true, 'Bedingung sichtbar');

    const minus = find(harness.row('hull'), 'hangar-size-minus');
    for (const control of [minus, find(harness.root, 'hangar-size-buy-step'), harness.storage('items')]) {
        assert.equal(isUsable(control), false, `${control.className} ist nicht bedienbar`);
    }
    minus.click();
    assert.equal(find(harness.row('hull'), 'hangar-size-value').textContent, '100 %', 'ein Klick ändert nichts');

    const unlock = find(harness.root, 'hangar-size-unlock');
    assert.equal(isUsable(unlock), true, 'der Freigabe-Knopf bleibt bedienbar');
    assert.equal(unlock.parentElement, lock.condition.parentElement, 'der Freigabe-Knopf steht neben der Bedingung');
});

test('Gesperrt: der Freigabe-Knopf nennt Bildschirmlesern, was er freischaltet und was es kostet', () => {
    const unlock = find(createSizePanel().root, 'hangar-size-unlock');
    const name = unlock.getAttribute('aria-label');
    assert.equal(name, 'Größenumbau freischalten (100 XP)', 'Bildschirmleser hören Ziel und Kosten, nicht nur „Freischalten“');
    assert.ok(name.toLowerCase().includes(unlock.textContent.toLowerCase()), 'der sichtbare Text steckt im Namen (Sprachsteuerung)');
});

test('Gesperrt: nach der Freigabe ist der Größen-Editor bedienbar, die Bedingung verschwindet', () => {
    const harness = createSizePanel();
    find(harness.root, 'hangar-size-unlock').click();
    find(harness.root, 'hangar-size-confirm-accept').click();
    assert.equal(harness.profile.sizeWorkshopUnlocked, true);
    const lock = lockOf(find(harness.root, 'hangar-size-editor'));
    assert.equal(lock.section.classList.contains('is-locked'), false);
    assert.equal(lock.body.disabled, false);
    assert.equal(lock.body.getAttribute('aria-disabled'), null);
    assert.equal(isShown(lock.condition), false, 'keine Bedingung mehr');
    assert.equal(isShown(find(harness.root, 'hangar-size-unlock')), false, 'Freigabe erledigt');
    const minus = find(harness.row('hull'), 'hangar-size-minus');
    assert.equal(isUsable(minus), true);
    minus.click();
    assert.equal(find(harness.row('hull'), 'hangar-size-value').textContent, '95 %');
});

test('Gesperrt: eine Lagerstufe ohne erreichte Utility-Schwelle ist sichtbar, abgedunkelt und nennt die Utility-Größe', () => {
    const harness = createSizePanel({ sizeWorkshopUnlocked: true, xpBank: 5000, purchasedSizeSteps: 5 });
    const items = harness.storage('items');
    const lock = lockOf(items);
    assert.equal(isShown(items), true, 'die Lagerstufe ist sichtbar');
    assert.equal(lock.section.classList.contains('is-locked'), true);
    assert.equal(lock.condition.textContent, 'Utility auf 105 % bringen');
    assert.equal(lock.body.getAttribute('aria-disabled'), 'true');
    assert.equal(isUsable(items), false, 'nicht bedienbar');
    assert.equal(isUsable(find(harness.row('utility'), 'hangar-size-plus')), true, 'die Utility selbst bleibt verstellbar');

    harness.profile = { ...harness.profile, partSizes: { utility: 105 } };
    harness.panel.render('ship5', harness.profile);
    assert.equal(lock.section.classList.contains('is-locked'), false, 'Schwelle erreicht: frei');
    assert.equal(isUsable(items), true);
    items.click();
    find(harness.root, 'hangar-size-confirm-accept').click();
    assert.equal(harness.profile.purchasedItemSlots, 1);
    assert.equal(lock.condition.textContent, 'Utility auf 115 % bringen', 'die nächste Stufe nennt ihre Schwelle');
    assert.equal(isUsable(items), false);
});

test('HangarLockedSection: wiederverwendbares Muster für gesperrte Bereiche (abdunkeln, Bedingung, aria)', async () => {
    const { createHangarLockedSection } = await import('../src/ui/hangar/HangarLockedSection.js');
    const action = new FakeElement('button');
    const control = new FakeElement('button');
    let clicks = 0;
    bind(control, 'click', () => { clicks += 1; });
    const first = createHangarLockedSection({ className: 'hangar-stone-slot', action });
    const second = createHangarLockedSection();
    first.body.append(control);
    assert.ok(first.root.classList.contains('hangar-stone-slot'));
    assert.notEqual(first.condition.id, second.condition.id, 'eindeutige Bedingungs-IDs');

    first.setLocked(true, 'Ab Level 3: 250 XP');
    assert.ok(first.root.classList.contains('is-locked'));
    assert.equal(first.condition.textContent, 'Ab Level 3: 250 XP');
    assert.equal(isShown(first.condition), true);
    assert.equal(first.body.disabled, true);
    assert.equal(first.body.getAttribute('aria-disabled'), 'true');
    assert.equal(first.body.getAttribute('aria-describedby'), first.condition.id);
    assert.equal(isUsable(control), false);
    assert.equal(isUsable(action), true, 'die Aktion neben der Bedingung bleibt bedienbar');
    control.click();
    assert.equal(clicks, 0, 'gesperrt: kein Klick');

    first.setLocked(false);
    assert.equal(first.root.classList.contains('is-locked'), false);
    assert.equal(isShown(first.condition), false);
    assert.equal(first.body.disabled, false);
    assert.equal(first.body.getAttribute('aria-disabled'), null);
    assert.equal(first.body.getAttribute('aria-describedby'), null);
    control.click();
    assert.equal(clicks, 1);
});

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const rule = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `Regel ${selector} fehlt`);
    return css.slice(start, css.indexOf('}', start));
};

test('Gesperrt: das Stylesheet dunkelt gesperrte Bereiche ab und setzt den Fieldset-Rahmen zurück', () => {
    assert.match(rule('.hangar-locked-section.is-locked > .hangar-locked-body'), /opacity:\s*0\.\d+/);
    assert.match(rule('.hangar-locked-body'), /border:\s*0/);
    assert.match(rule('.hangar-locked-body'), /min-inline-size:\s*0/);
});

test('Gesperrt: Knöpfe im gesperrten Bereich werden nicht ein zweites Mal abgedunkelt', () => {
    // Inside a disabled <fieldset> every button matches :disabled, so ".secondary-btn:disabled"
    // (opacity 0.55) would multiply with the dimmed area (0.45) to about 0.25.
    assert.match(rule('.secondary-btn:disabled'), /opacity:\s*0\.\d+/, 'Ausgangslage: gesperrte Knöpfe dunkeln sich selbst ab');
    assert.match(rule('.hangar-locked-section.is-locked > .hangar-locked-body .secondary-btn:disabled'), /opacity:\s*1\s*;/);
});
