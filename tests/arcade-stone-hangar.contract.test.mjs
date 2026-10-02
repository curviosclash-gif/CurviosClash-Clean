// ============================================
// arcade-stone-hangar.contract.test.mjs - Paket 3, Schritt 2: die Hangar-Oberfläche der Steine.
// Entwurf mit stoneSlots (Rückgängig, Vergleich, Speichern), gemeinsame Kaufbestätigung, das
// Steinpanel im Reiter „Ausbau“ (Plätze, gesperrte Pakete, Vorrat, Käufe, Warnsymbol, fremde und
// fehlende Steine, Wechsel zwischen Fahrzeugen, gesperrter Speicher), die Wertvorschau mit Steinen
// und die Arcade-Werkstatt ohne Starter, Budget und Paar-Schalter. Fight bleibt unverändert.
// Node hat keinen Browser: tests/helpers/fake-hangar-dom.mjs merkt sich, was die Panels bauen.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    bind, createEvent, fakeDocument, find, isShown, isUsable, pressEnter,
} from './helpers/fake-hangar-dom.mjs';

const {
    HangarBuildHistory, areHangarBuildsEqual, cloneHangarBuild, createDefaultHangarBuild, normalizeHangarBuild,
} = await import('../src/ui/hangar/HangarBuildDraftState.js');
const { createHangarBuildPersistenceAdapter } = await import('../src/ui/hangar/HangarBuildPersistence.js');
const { createHangarPurchaseConfirm } = await import('../src/ui/hangar/HangarPurchaseConfirm.js');
const { createArcadeStonePanel } = await import('../src/ui/hangar/ArcadeStonePanel.js');
const { createArcadeHangarWorkshopShell } = await import('../src/ui/hangar/ArcadeHangarWorkshopShell.js');
const { createHangarSizePanel } = await import('../src/ui/hangar/HangarSizePanel.js');
const { createArcadeVehicleProfileRecord } = await import('../src/shared/contracts/ArcadeVehicleProfileContract.js');
const {
    ARCADE_STONE_WORKSHOP_STORAGE_KEY, createArcadeStoneWorkshopRecord,
} = await import('../src/shared/contracts/ArcadeStoneWorkshopContract.js');
const { resolveArcadeStoneExtraSteps } = await import('../src/shared/contracts/ArcadeStonePlacementContract.js');
const { resolveArcadeVehicleActiveStats } = await import('../src/shared/contracts/ArcadeVehicleActiveStatsContract.js');
const { ARCADE_BUILD_STAT_KEYS } = await import('../src/shared/contracts/ArcadeVehicleBuildContract.js');

const SLOT_IDS = ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility'];
const EMPTY_STONE_SLOTS = Object.fromEntries(SLOT_IDS.map((slotId) => [slotId, null]));
const LABELS = { ship5: 'Star-Cruiser', manta: 'Manta-Gleiter', arrow: 'Pfeil' };

function poolWith(stones) {
    return { ...createArcadeStoneWorkshopRecord(0), stones, nextSerial: 30 };
}

function stone(serial, level = 1, placement = null) {
    return { stoneId: `stone-${String(serial).padStart(4, '0')}`, level, placement };
}

/** Player record store with the read port of the settings manager (found/missing/read_failed). */
function createStore(pool, readStatus = '') {
    const records = new Map(pool ? [[ARCADE_STONE_WORKSHOP_STORAGE_KEY, structuredClone(pool)]] : []);
    const writes = [];
    return {
        records,
        writes,
        readJsonRecordResult(key) {
            if (readStatus) return { status: readStatus, value: null };
            return records.has(key) ? { status: 'found', value: structuredClone(records.get(key)) } : { status: 'missing', value: null };
        },
        saveJsonRecord(key, value) {
            writes.push(key);
            records.set(key, structuredClone(value));
            return { success: true };
        },
        loadJsonRecord(key, fallback) { return records.has(key) ? structuredClone(records.get(key)) : fallback; },
    };
}

/** The stone panel as the workshop wires it: shell nodes, profiles, a draft and a render call. */
function createStonePanel({ profile = {}, pool, readStatus = '', draftSlots = {}, vehicleId = 'ship5', profiles = {} } = {}) {
    const store = createStore(pool, readStatus);
    const shell = createArcadeHangarWorkshopShell({}, { mode: 'arcade' });
    const h = { store, shell, toasts: [], selectedPartId: '', profileSaveResult: true };
    h.profiles = {
        ...profiles,
        [vehicleId]: { ...createArcadeVehicleProfileRecord(vehicleId, 0), ...profile },
    };
    h.draft = normalizeHangarBuild({ vehicleId, stoneSlots: draftSlots });
    h.panel = createArcadeStonePanel({
        bind,
        store,
        shell,
        toast: (message) => h.toasts.push(message),
        getProfile: () => h.profiles[h.draft.vehicleId],
        profileFor: (id) => h.profiles[id] || createArcadeVehicleProfileRecord(id, 0),
        saveProfile(next) {
            store.writes.push('profile');
            if (h.profileSaveResult === false) return false;
            h.profiles[h.draft.vehicleId] = next;
            h.render();
            return true;
        },
        getDraft: () => h.draft,
        vehicleLabel: (id) => LABELS[id] || id,
        onSelectStone(stoneId) {
            h.selectedPartId = h.selectedPartId === stoneId ? '' : stoneId;
            h.render();
        },
        onChange: () => h.render(),
        nowMs: () => 1000,
    });
    h.root = h.panel.root;
    h.render = () => h.panel.arcadeView.renderSlots(
        { draft: h.draft, selectedSlotId: 'core', selectedPartId: h.selectedPartId },
        h.selectedPartId,
    );
    h.row = (slotId) => h.root.querySelectorAll('[data-hangar-slot-row]').find((node) => node.dataset.hangarSlotRow === slotId);
    h.item = (stoneId) => h.root.querySelectorAll('[data-stone-id]').find((node) => node.dataset.stoneId === stoneId);
    h.items = () => h.root.querySelectorAll('[data-stone-id]').map((node) => node.dataset.stoneId);
    h.pkg = (packageId) => h.root.querySelectorAll('[data-stone-package]').find((node) => node.dataset.stonePackage === packageId);
    h.confirm = () => find(h.root, 'hangar-stone-confirm');
    h.confirmLines = () => find(h.root, 'hangar-stone-confirm-lines').children.map((line) => line.textContent);
    h.accept = () => find(h.root, 'hangar-stone-confirm-accept').click();
    h.storedPool = () => store.records.get(ARCADE_STONE_WORKSHOP_STORAGE_KEY);
    h.render();
    return h;
}

// --- Entwurf: stoneSlots nur im Arcade-Build ---

test('Entwurf: Arcade-Builds tragen sieben Steinplätze, Fight-Builds bleiben unverändert', () => {
    const arcade = createDefaultHangarBuild('ship5', { nowMs: 1 });
    assert.deepEqual(arcade.stoneSlots, EMPTY_STONE_SLOTS);
    const fight = normalizeHangarBuild({
        mode: 'fight', vehicleId: 'ship5', buildId: 'fight-a', name: 'F', createdAtMs: 5, updatedAtMs: 6,
        machineGunId: 'raptor_r9', slots: { utility: 'stone_violet_t1' }, stoneSlots: { core: 'stone-0001' },
    });
    // Ergebnis vor Paket 3, Schritt 2 (28.09.2026): ein Fight-Build kennt keine Steinplätze.
    assert.deepEqual(fight, {
        schemaVersion: 'arcade-hangar-build.v4', buildId: 'fight-a', mode: 'fight', vehicleId: 'ship5', name: 'F',
        favorite: false, tags: [], hitboxClass: 'standard',
        slots: {
            core: 'stone_gold_t1', nose: 'stone_blue_t1', wing_left: 'stone_green_t1', wing_right: 'stone_green_t1',
            engine_left: 'stone_cyan_t1', engine_right: 'stone_cyan_t1', utility: 'stone_violet_t1',
        },
        machineGunId: 'raptor_r9', createdAtMs: 5, updatedAtMs: 6,
    });
    assert.equal('stoneSlots' in createDefaultHangarBuild('ship5', { mode: 'fight' }), false);
});

test('Entwurf: stoneSlots werden normalisiert, kopiert, verglichen und laufen durch Rückgängig/Wiederholen', () => {
    const build = normalizeHangarBuild({
        vehicleId: 'ship5',
        stoneSlots: { core: 'stone-0001', nose: 'stone-0001', wing_left: 'kaputt', utility: 'stone-0007' },
    });
    assert.deepEqual(build.stoneSlots, { ...EMPTY_STONE_SLOTS, core: 'stone-0001', utility: 'stone-0007' });

    const copy = cloneHangarBuild(build);
    copy.stoneSlots.core = 'stone-0002';
    assert.equal(build.stoneSlots.core, 'stone-0001', 'die Kopie teilt stoneSlots nicht');
    assert.equal(areHangarBuildsEqual(build, copy), false, 'ein anderer Stein ist eine Änderung');
    assert.equal(areHangarBuildsEqual(build, cloneHangarBuild(build)), true);

    const history = new HangarBuildHistory(build);
    history.push(copy);
    assert.equal(history.undo().stoneSlots.core, 'stone-0001');
    assert.equal(history.redo().stoneSlots.core, 'stone-0002');
});

test('Entwurf: ein Arcade-Build mit stoneSlots übersteht Speichern und Wiederladen', async () => {
    const store = createStore(null);
    const adapter = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    const build = normalizeHangarBuild({ vehicleId: 'ship5', buildId: 'stones', stoneSlots: { nose: 'stone-0002' } });
    const saved = await adapter.saveBuild(build, { asNew: true, activate: true, name: 'Nase' });
    assert.equal(saved.ok, true);
    assert.equal(adapter.getActiveBuild('ship5').stoneSlots.nose, 'stone-0002');
    const reloaded = createHangarBuildPersistenceAdapter({ store, mode: 'arcade' });
    await reloaded.hydrate();
    assert.deepEqual(reloaded.getActiveBuild('ship5').stoneSlots, { ...EMPTY_STONE_SLOTS, nose: 'stone-0002' });
});

// --- Gemeinsame Kaufbestätigung (aus dem Größen-Panel herausgelöst) ---

test('Kaufbestätigung: prüft beim Annehmen neu, ignoriert gehaltenes Enter, Escape schließt mit Fokus zurück', () => {
    const toasts = [];
    const confirm = createHangarPurchaseConfirm({ bind, toast: (message) => toasts.push(message), className: 'test-confirm' });
    const trigger = fakeDocument.createElement('button');
    let xp = 500;
    const commits = [];
    const ask = () => confirm.ask({
        trigger,
        heading: 'Test kaufen?',
        evaluate: () => (xp >= 200 ? { ok: true, cost: 200, next: { xpBank: xp - 200 } } : { ok: false, reason: 'insufficient_xp' }),
        lines: (result) => [`Rest ${result.next.xpBank}`],
        commit: (result) => { commits.push(result.next.xpBank); },
        successText: 'gekauft',
    });
    assert.equal(ask(), true);
    assert.equal(confirm.root.getAttribute('role'), 'alertdialog');
    assert.equal(isShown(confirm.root), true);
    assert.equal(find(confirm.root, 'test-confirm-title').textContent, 'Test kaufen?');
    assert.deepEqual(find(confirm.root, 'test-confirm-lines').children.map((line) => line.textContent), ['Rest 300']);
    const accept = find(confirm.root, 'test-confirm-accept');
    pressEnter(accept, true);
    assert.deepEqual(commits, [], 'Tastenwiederholung kauft nichts');
    xp = 400;
    confirm.refresh();
    assert.deepEqual(find(confirm.root, 'test-confirm-lines').children.map((line) => line.textContent), ['Rest 200']);
    accept.click();
    assert.deepEqual(commits, [200], 'genau ein Kauf mit dem Stand beim Annehmen');
    assert.equal(isShown(confirm.root), false);
    assert.deepEqual(toasts, ['gekauft']);

    trigger.focus();
    ask();
    confirm.root.dispatchEvent(createEvent('keydown', { key: 'Escape' }));
    assert.equal(isShown(confirm.root), false);
    assert.equal(fakeDocument.activeElement, trigger, 'Fokus zurück auf den Auslöser');
    xp = 100;
    assert.equal(ask(), false, 'nicht bezahlbar: keine Bestätigung');
    assert.equal(isShown(confirm.root), false);
});

// --- Steinpanel: Plätze und gesperrte Pakete ---

test('Steinpanel: sieben Plätze; Flügel, Antriebe und Utility sind sichtbar gesperrt und nennen ihre Bedingung', () => {
    const h = createStonePanel({ profile: { level: 1, xpBank: 1000 } });
    assert.deepEqual(h.root.querySelectorAll('[data-hangar-slot-row]').map((node) => node.dataset.hangarSlotRow), SLOT_IDS);
    for (const slotId of ['core', 'nose']) {
        assert.equal(isUsable(find(h.row(slotId), 'hangar-slot-select')), true, `${slotId} ist sofort nutzbar`);
    }
    const expected = {
        wings: 'Flügelpaar: ab Level 3 kaufbar (250 XP)',
        engines: 'Antriebspaar: ab Level 6 kaufbar (500 XP)',
        utility: 'Utility: ab Level 10 kaufbar (900 XP)',
    };
    for (const [packageId, condition] of Object.entries(expected)) {
        const section = h.pkg(packageId);
        assert.ok(section.classList.contains('is-locked'), `${packageId} abgedunkelt`);
        assert.equal(find(section, 'hangar-locked-condition').textContent, condition);
        assert.equal(find(section, 'hangar-locked-body').getAttribute('aria-disabled'), 'true');
        const buy = find(section, 'hangar-stone-package-buy');
        assert.equal(isShown(buy), true, 'Kaufknopf sichtbar');
        assert.equal(buy.disabled, true, 'vor dem Level nicht kaufbar');
    }
    assert.equal(isUsable(find(h.row('wing_left'), 'hangar-slot-select')), false);
    assert.equal(find(h.row('wing_left'), 'hangar-slot-select').closest('[data-stone-package]').dataset.stonePackage, 'wings');
});

test('Steinpanel: Platzpaket kaufen nur mit Bestätigung, danach sind die Plätze frei', () => {
    const h = createStonePanel({ profile: { level: 3, xpBank: 250 } });
    const section = h.pkg('wings');
    assert.equal(find(section, 'hangar-locked-condition').textContent, 'Flügelpaar: Steinplätze für 250 XP freischalten');
    const buy = find(section, 'hangar-stone-package-buy');
    assert.equal(buy.disabled, false);
    assert.equal(buy.getAttribute('aria-label'), 'Steinplätze Flügelpaar freischalten (250 XP)');
    buy.click();
    assert.equal(isShown(h.confirm()), true);
    assert.deepEqual(h.confirmLines().slice(0, 3), ['Kosten: 250 XP', 'XP: 250 → 0', 'Steinplätze Flügelpaar: gesperrt → frei']);
    assert.equal(h.confirmLines().at(-1), 'XP-Käufe sind endgültig.');
    assert.deepEqual(h.profiles.ship5.stoneSlotPackages, [], 'vor dem Annehmen nichts gekauft');
    h.accept();
    assert.deepEqual(h.profiles.ship5.stoneSlotPackages, ['wings']);
    assert.equal(h.profiles.ship5.xpBank, 0);
    assert.equal(h.pkg('wings').classList.contains('is-locked'), false);
    assert.equal(isUsable(find(h.row('wing_left'), 'hangar-slot-select')), true);
});

// --- Steinpanel: Vorrat, neuer Stein, Aufwerten ---

test('Steinpanel: Vorrat mit drei Gratis-Steinen; ein neuer Stein kostet 200 XP nach Bestätigung, Pool vor Profil', () => {
    const h = createStonePanel({ profile: { level: 1, xpBank: 250 } });
    assert.deepEqual(h.items(), ['stone-0001', 'stone-0002', 'stone-0003']);
    assert.equal(find(h.item('stone-0001'), 'hangar-stone-select').textContent, 'Stein 1 · T1');
    assert.equal(find(h.item('stone-0001'), 'hangar-stone-location').textContent, 'frei');
    assert.equal(find(h.root, 'hangar-stone-count').textContent, 'Steine: 3 / 21');
    const buy = find(h.root, 'hangar-stone-buy');
    assert.equal(buy.textContent, 'Neuer Stein (200 XP)');
    buy.click();
    assert.deepEqual(h.confirmLines().slice(0, 3), ['Kosten: 200 XP', 'XP: 250 → 50', 'Steine: 3 → 4 von 21']);
    assert.deepEqual(h.store.writes, [], 'erst nach der Bestätigung wird gespeichert');
    h.accept();
    assert.deepEqual(h.store.writes, [ARCADE_STONE_WORKSHOP_STORAGE_KEY, 'profile'], 'erst der Pool, dann das Profil');
    assert.deepEqual(h.items(), ['stone-0001', 'stone-0002', 'stone-0003', 'stone-0004']);
    assert.equal(h.storedPool().stones.length, 4);
    assert.equal(h.profiles.ship5.xpBank, 50);
    assert.equal(find(h.root, 'hangar-stone-count').textContent, 'Steine: 4 / 21');
    assert.equal(buy.disabled, true, '50 XP reichen nicht für den nächsten');
});

test('Steinpanel: am Limit von 21 Steinen ist „Neuer Stein“ gesperrt und nennt den Grund', () => {
    const stones = Array.from({ length: 21 }, (_, index) => stone(index + 1));
    const h = createStonePanel({ profile: { xpBank: 5000 }, pool: poolWith(stones) });
    const buy = find(h.root, 'hangar-stone-buy');
    assert.equal(buy.disabled, true);
    assert.equal(buy.getAttribute('aria-description'), 'Höchstens 21 Steine');
});

test('Steinpanel: Aufwerten ist vor dem Level sichtbar gesperrt, danach nur mit Bestätigung', () => {
    const locked = createStonePanel({ profile: { level: 1, xpBank: 5000 } });
    const lockedUpgrade = find(locked.item('stone-0001'), 'hangar-stone-upgrade');
    assert.ok(lockedUpgrade.closest('.hangar-locked-section').classList.contains('is-locked'));
    assert.equal(find(lockedUpgrade.closest('.hangar-locked-section'), 'hangar-locked-condition').textContent, 'T2 ab Level 10');
    assert.equal(isUsable(lockedUpgrade), false);

    const h = createStonePanel({ profile: { level: 10, xpBank: 400 } });
    const upgrade = find(h.item('stone-0001'), 'hangar-stone-upgrade');
    assert.equal(upgrade.textContent, 'Auf T2 aufwerten (400 XP)');
    upgrade.click();
    assert.deepEqual(h.confirmLines().slice(0, 3), ['Kosten: 400 XP', 'XP: 400 → 0', 'Stein 1: T1 → T2']);
    h.accept();
    assert.equal(h.storedPool().stones[0].level, 2);
    assert.equal(find(h.item('stone-0001'), 'hangar-stone-select').textContent, 'Stein 1 · T2');
    assert.equal(h.profiles.ship5.xpBank, 0);
});

test('Steinpanel: fehlgeschlagener XP-Save rollt einen Pool-Upgrade zurück und meldet Rollbackfehler', () => {
    const initialPool = poolWith([stone(1, 1, { vehicleId: 'ship5', slotId: 'core' })]);
    const restored = createStonePanel({ profile: { level: 10, xpBank: 500 }, pool: initialPool });
    restored.profileSaveResult = false;
    find(restored.item('stone-0001'), 'hangar-stone-upgrade').click();
    restored.accept();
    assert.deepEqual(restored.storedPool(), initialPool, 'bei erfolgreichem Rollback bleibt der Pool unverändert');
    assert.deepEqual(restored.panel.getPool(), initialPool, 'Panelzustand folgt dem zurückgerollten Speicher');
    assert.equal(restored.profiles.ship5.xpBank, 500, 'Profil-XP bleiben unverändert');
    assert.match(restored.toasts.at(-1), /zurückgenommen/u);

    const partial = createStonePanel({ profile: { level: 10, xpBank: 500 }, pool: initialPool });
    partial.profileSaveResult = false;
    const originalSave = partial.store.saveJsonRecord;
    let poolWrites = 0;
    partial.store.saveJsonRecord = (key, value) => {
        if (key === ARCADE_STONE_WORKSHOP_STORAGE_KEY && ++poolWrites === 2) return { success: false, reason: 'quota_exceeded' };
        return originalSave(key, value);
    };
    find(partial.item('stone-0001'), 'hangar-stone-upgrade').click();
    partial.accept();
    assert.equal(partial.storedPool().stones[0].level, 2, 'der fehlgeschlagene Rollback bleibt als Teilstatus sichtbar');
    assert.equal(partial.panel.getPool().stones[0].level, 2);
    assert.equal(partial.profiles.ship5.xpBank, 500, 'auch beim Rollbackfehler gehen keine XP verloren');
    assert.match(partial.toasts.at(-1), /Zurückrollen fehlgeschlagen/u);
});

test('Steinpanel: ein Fahrzeugwechsel schließt die offene Kaufbestätigung; das neue Fahrzeug zahlt nie ungefragt', () => {
    const manta = { ...createArcadeVehicleProfileRecord('manta', 0), level: 10, xpBank: 2000 };
    const h = createStonePanel({ profile: { level: 10, xpBank: 1000 }, profiles: { manta } });
    const offers = {
        Paket: () => find(h.pkg('wings'), 'hangar-stone-package-buy'),
        'Neuer Stein': () => find(h.root, 'hangar-stone-buy'),
        Aufwerten: () => find(h.item('stone-0001'), 'hangar-stone-upgrade'),
    };
    for (const [name, trigger] of Object.entries(offers)) {
        h.draft = normalizeHangarBuild({ vehicleId: 'ship5' });
        h.render();
        trigger().click();
        assert.equal(isShown(h.confirm()), true, `${name}: Bestätigung für den Star-Cruiser offen`);
        // Katalog: Manta wählen (selectVehicle → setDraft → syncDisplay → renderSlots).
        h.draft = normalizeHangarBuild({ vehicleId: 'manta' });
        h.render();
        assert.equal(isShown(h.confirm()), false, `${name}: der Fahrzeugwechsel schließt die Bestätigung`);
        h.accept();
        assert.deepEqual(h.store.writes, [], `${name}: weder Pool noch Profil geschrieben`);
    }
    assert.equal(h.profiles.manta.xpBank, 2000, 'die Manta zahlt nichts');
    assert.deepEqual(h.profiles.manta.stoneSlotPackages, []);
    assert.equal(h.profiles.ship5.xpBank, 1000, 'der Star-Cruiser hat nichts bestätigt');
});

test('Steinpanel: ein Kauf, der seinen eigenen Knopf verbirgt oder sperrt, lässt den Tastaturfokus im Panel', () => {
    const cases = {
        'Paket (Kopf der Sektion verschwindet)': [
            { level: 3, xpBank: 250 }, undefined, (h) => find(h.pkg('wings'), 'hangar-stone-package-buy'),
        ],
        'Aufwerten (nächste Stufe braucht Level 20)': [
            { level: 10, xpBank: 400 }, undefined, (h) => find(h.item('stone-0001'), 'hangar-stone-upgrade'),
        ],
        '21. Stein (Neuer Stein gesperrt)': [
            { xpBank: 200 }, poolWith(Array.from({ length: 20 }, (_, index) => stone(index + 1))), (h) => find(h.root, 'hangar-stone-buy'),
        ],
    };
    for (const [name, [profile, pool, trigger]] of Object.entries(cases)) {
        const h = createStonePanel({ profile, pool });
        trigger(h).focus();
        pressEnter(trigger(h));
        assert.equal(isShown(h.confirm()), true, `${name}: Bestätigung offen`);
        h.accept();
        assert.equal(isUsable(trigger(h)), false, `${name}: der Auslöser ist danach nicht mehr bedienbar`);
        const focused = fakeDocument.activeElement;
        assert.ok(h.root.contains(focused), `${name}: Fokus bleibt im Steinpanel`);
        assert.equal(isUsable(focused), true, `${name}: Fokus liegt auf einem bedienbaren Ziel, nicht auf <body>`);
    }
});

// --- Steinpanel: Einsetzen, Umstecken, Entfernen ---

test('Steinpanel: Einsetzen und Umstecken im Entwurf sind kostenlos; gesperrte Plätze lehnen ab', () => {
    const h = createStonePanel({ profile: { level: 1 } });
    const core = h.panel.evaluateInstall(h.draft, 'stone-0001', 'core');
    assert.equal(core.ok, true);
    assert.equal(core.build.stoneSlots.core, 'stone-0001');
    assert.deepEqual(core.changedSlots, ['core']);
    assert.deepEqual(h.store.writes, [], 'Umstecken schreibt nichts in den Pool');

    const moved = h.panel.evaluateInstall(core.build, 'stone-0001', 'nose');
    assert.equal(moved.build.stoneSlots.nose, 'stone-0001');
    assert.equal(moved.build.stoneSlots.core, null, 'ein Stein steckt höchstens einmal');
    const swapped = h.panel.evaluateInstall({ ...moved.build, stoneSlots: { ...moved.build.stoneSlots, core: 'stone-0002' } }, 'stone-0001', 'core');
    assert.equal(swapped.build.stoneSlots.core, 'stone-0001');
    assert.equal(swapped.build.stoneSlots.nose, 'stone-0002', 'Tausch zwischen zwei Plätzen');

    const wing = h.panel.evaluateInstall(h.draft, 'stone-0001', 'wing_left');
    assert.equal(wing.ok, false);
    assert.equal(wing.code, 'slot_locked');
    assert.match(wing.message, /Flügelpaar/);
    assert.equal(h.panel.evaluateInstall(h.draft, 'stone-0099', 'core').code, 'unknown_stone');

    const removed = h.panel.evaluateRemoval(core.build, 'core');
    assert.equal(removed.ok, true);
    assert.equal(removed.build.stoneSlots.core, null);
    assert.equal(h.panel.evaluateRemoval(h.draft, 'core').ok, false);
    assert.equal(h.panel.resolveStone('stone-0002').label, 'Stein 2 · T1');
    assert.equal(h.panel.resolveStone('stone-0099'), null);
});

test('Steinpanel: die Platzzeile zeigt den Stein, seine wirksame Stufe und markiert die Auswahl', () => {
    const h = createStonePanel({ profile: { level: 1 }, draftSlots: { core: 'stone-0002' } });
    const installed = find(h.row('core'), 'hangar-installed-part');
    assert.equal(installed.textContent, 'Stein 2 · T1');
    assert.equal(installed.dataset.partId, 'stone-0002');
    assert.equal(installed.dataset.installedSlot, 'core');
    assert.equal(find(h.row('core'), 'arcade-vehicle-slot-tier').textContent, 'T1');
    assert.equal(find(h.row('nose'), 'hangar-installed-part').textContent, 'Leer');
    assert.equal(find(h.row('nose'), 'hangar-installed-part').dataset.partId, undefined);
    assert.equal(find(h.row('core'), 'hangar-slot-remove').getAttribute('aria-label'), 'Rumpf: Stein entfernen');
    const select = find(h.item('stone-0001'), 'hangar-stone-select');
    select.click();
    assert.equal(h.selectedPartId, 'stone-0001');
    assert.equal(select.getAttribute('aria-pressed'), 'true');
    assert.equal(find(h.item('stone-0002'), 'hangar-stone-location').textContent, 'im Entwurf: Rumpf');
});

test('Steinpanel: ein schwächer wirkender Stein trägt ein Warnsymbol mit dem Grund; Antippen blendet ihn ein', () => {
    const h = createStonePanel({
        profile: {
            level: 20, sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: { wings: 110 }, stoneSlotPackages: ['wings'],
        },
        pool: poolWith([stone(1, 3)]),
        draftSlots: { wing_left: 'stone-0001' },
    });
    const row = h.row('wing_left');
    const warning = find(row, 'hangar-stone-warning');
    const text = find(row, 'hangar-stone-warning-text');
    assert.equal(isShown(warning), true);
    assert.equal(text.textContent, 'Wirkt als T1 – Flügel auf 125 % bringen (jetzt 110 %)');
    assert.equal(warning.title, text.textContent);
    assert.equal(warning.tabIndex, 0);
    assert.equal(warning.getAttribute('aria-describedby'), text.id);
    assert.equal(find(row, 'arcade-vehicle-slot-tier').textContent, 'T1');
    assert.equal(text.classList.contains('is-open'), false);
    warning.dispatchEvent(createEvent('click'));
    assert.equal(text.classList.contains('is-open'), true, 'Antippen zeigt den Text');
    warning.dispatchEvent(createEvent('keydown', { key: 'Enter' }));
    assert.equal(text.classList.contains('is-open'), false, 'Enter schaltet ihn wieder aus');
    assert.equal(isShown(find(h.row('core'), 'hangar-stone-warning')), false, 'leerer Platz ohne Warnung');
});

test('Steinpanel: fremde und fehlende Steine erscheinen grau mit dem Fahrzeug; der Entwurf weicht vom Pool ab', () => {
    const h = createStonePanel({
        profile: { level: 1 },
        pool: poolWith([stone(1), stone(2, 1, { vehicleId: 'manta', slotId: 'core' })]),
        draftSlots: { nose: 'stone-0002', core: 'stone-0009' },
    });
    const nose = h.row('nose');
    assert.ok(nose.classList.contains('is-foreign'));
    assert.equal(find(nose, 'hangar-stone-slot-note').textContent, 'steckt in Manta-Gleiter · Rumpf – wird beim Aktivieren umgesteckt');
    const core = h.row('core');
    assert.ok(core.classList.contains('is-missing'));
    assert.equal(find(core, 'hangar-installed-part').textContent, 'Stein 9');
    assert.equal(find(core, 'hangar-stone-slot-note').textContent, 'Stein 9 fehlt im Vorrat – der Platz bleibt beim Aktivieren leer');
    const status = find(h.root, 'hangar-stone-status');
    assert.equal(isShown(status), true);
    assert.match(status.textContent, /Entwurf weicht vom aktiven Build ab/);
    assert.equal(find(h.item('stone-0002'), 'hangar-stone-location').textContent, 'im Entwurf: Nase · aktiv: Manta-Gleiter · Rumpf');
});

// --- Aktivieren: Wechsel zwischen Fahrzeugen nur mit Bestätigung ---

test('Aktivieren: ein Stein aus einem anderen Fahrzeug braucht eine Bestätigung, die den alten Build nennt', () => {
    const h = createStonePanel({
        profile: { level: 1 },
        pool: poolWith([stone(1), stone(2, 1, { vehicleId: 'manta', slotId: 'core' })]),
        draftSlots: { core: 'stone-0002' },
    });
    let accepted = 0;
    const result = h.panel.confirmTransfers(h.draft, () => { accepted += 1; return { ok: true }; });
    assert.equal(result.ok, false);
    assert.equal(accepted, 0, 'ohne Bestätigung passiert nichts');
    const dialog = find(h.shell.activationDock, 'hangar-stone-transfer-confirm');
    assert.equal(isShown(dialog), true, 'die Bestätigung erscheint neben „Aktivieren“, in jedem Reiter');
    const lines = find(dialog, 'hangar-stone-transfer-confirm-lines').children.map((line) => line.textContent);
    assert.ok(lines.includes('Stein 2 wird aus Manta-Gleiter · Rumpf entfernt'), lines.join(' | '));
    assert.equal(h.panel.commit(h.draft, { confirmed: false }), false, 'ohne Bestätigung lehnt der Commit ab');
    assert.deepEqual(h.store.writes, []);
    find(dialog, 'hangar-stone-transfer-confirm-accept').click();
    assert.equal(accepted, 1);
    assert.equal(h.panel.commit(h.draft, { confirmed: true }), true);
    const moved = h.storedPool().stones.find((entry) => entry.stoneId === 'stone-0002');
    assert.deepEqual(moved.placement, { vehicleId: 'ship5', slotId: 'core' });
    assert.deepEqual(h.panel.withActivePlacement(normalizeHangarBuild({ vehicleId: 'ship5' })).stoneSlots, { ...EMPTY_STONE_SLOTS, core: 'stone-0002' });
});

test('Aktivieren: ändert sich der Entwurf bei offener Bestätigung, gilt sie nicht für ungelistete Wechsel', () => {
    const h = createStonePanel({
        profile: { level: 1 },
        pool: poolWith([stone(1, 1, { vehicleId: 'manta', slotId: 'core' }), stone(2, 1, { vehicleId: 'manta', slotId: 'nose' })]),
        draftSlots: { core: 'stone-0001' },
    });
    let accepted = 0;
    h.panel.confirmTransfers(h.draft, () => { accepted += 1; });
    const dialog = find(h.shell.activationDock, 'hangar-stone-transfer-confirm');
    assert.equal(isShown(dialog), true);
    h.draft = normalizeHangarBuild({ vehicleId: 'ship5', stoneSlots: { core: 'stone-0001', nose: 'stone-0002' } });
    find(dialog, 'hangar-stone-transfer-confirm-accept').click();
    assert.equal(accepted, 0, 'der zweite, nicht gelistete Wechsel ist nicht bestätigt');
    assert.equal(isShown(dialog), false);
    assert.ok(h.toasts.includes('Den Wechsel zwischen Fahrzeugen erst bestätigen'), h.toasts.join(' | '));
});

test('Aktivieren: ohne Wechsel geht es sofort weiter; ein gesperrter Platz verhindert es', () => {
    const h = createStonePanel({ profile: { level: 1 }, draftSlots: { core: 'stone-0001' } });
    let accepted = 0;
    h.panel.confirmTransfers(h.draft, () => { accepted += 1; });
    assert.equal(accepted, 1);
    const locked = normalizeHangarBuild({ vehicleId: 'ship5', stoneSlots: { wing_left: 'stone-0001' } });
    assert.equal(h.panel.validate(locked).ok, false);
    assert.equal(h.panel.validate(locked).errors[0].code, 'slot_locked');
    assert.equal(h.panel.validate(h.draft).ok, true);
    h.panel.confirmTransfers(locked, () => { accepted += 1; });
    assert.equal(accepted, 1, 'gesperrter Platz: kein Aktivieren');
});

// --- Gesperrter Speicher ---

test('Gesperrter Speicher: ohne lesbaren Pool keine Käufe, kein Umstecken, kein Aktivieren, nichts wird geschrieben', () => {
    const h = createStonePanel({ profile: { level: 20, xpBank: 5000, stoneSlotPackages: ['wings'] }, readStatus: 'read_failed' });
    const status = find(h.root, 'hangar-stone-status');
    assert.equal(isShown(status), true);
    assert.match(status.textContent, /Steinspeicher nicht lesbar/);
    assert.equal(find(h.root, 'hangar-stone-buy').disabled, true);
    assert.deepEqual(h.items(), []);
    assert.equal(h.panel.evaluateInstall(h.draft, 'stone-0001', 'core').code, 'storage_unavailable');
    let accepted = 0;
    h.panel.confirmTransfers(h.draft, () => { accepted += 1; });
    assert.equal(accepted, 0);
    assert.equal(h.panel.commit(h.draft, { confirmed: true }), false);
    assert.equal(find(h.pkg('engines'), 'hangar-stone-package-buy').disabled, true);
    assert.deepEqual(h.store.writes, []);
});

// --- Anzeige: 3D-Vorschau und Build-Statistik ---

test('3D-Vorschau: Steine erscheinen auf ihren Plätzen in der wirksamen Stufe', () => {
    const h = createStonePanel({
        profile: { level: 10, sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: { hull: 125 } },
        pool: poolWith([stone(1, 2), stone(2, 2)]),
        draftSlots: { core: 'stone-0001', nose: 'stone-0002' },
    });
    const visual = h.panel.arcadeView.visualBuild(h.draft);
    assert.equal(visual.slots.core, 'stone_violet_t2', 'Rumpf auf 125 %: volle Stufe');
    assert.equal(visual.slots.nose, 'stone_violet_t1', 'Nase unter 125 %: nur T1');
    assert.equal(visual.slots.wing_left, null);
    assert.equal(h.panel.arcadeView.visualBuild(null), null);
});

test('Build-Statistik: rechnet über die eine Rechenstelle mit den Steinen des Entwurfs', () => {
    const h = createStonePanel({ profile: { level: 1 }, draftSlots: { nose: 'stone-0001' } });
    const withStone = h.panel.arcadeView.projectStats(h.draft);
    const without = h.panel.arcadeView.projectStats(normalizeHangarBuild({ vehicleId: 'ship5' }));
    assert.equal(withStone.damagePct, 103, 'Nasen-Stein T1');
    assert.equal(without.damagePct, 100);
    const metrics = h.panel.arcadeView.compareStats(withStone, without);
    assert.deepEqual(metrics.map((metric) => metric.key), ARCADE_BUILD_STAT_KEYS);
    const damage = metrics.find((metric) => metric.key === 'damagePct');
    assert.equal(damage.value, 103);
    assert.equal(damage.delta, 3);
    assert.equal(damage.tone, 'positive');
    const regen = h.panel.arcadeView.compareStats({ ...without, regenDelay: 4 }, without).find((metric) => metric.key === 'regenDelay');
    assert.equal(regen.tone, 'negative', 'längere Wartezeit ist schlechter');
});

// --- Größen-Panel: Wertvorschau mit Steinen und Rückfall ---

test('Größen-Panel: die Vorschau rechnet mit den aktiven Steinen und nennt, welche beim Verkleinern zurückfallen', () => {
    const pool = poolWith([stone(1, 3, { vehicleId: 'ship5', slotId: 'wing_left' })]);
    let profile = {
        ...createArcadeVehicleProfileRecord('ship5', 0),
        level: 20, sizeWorkshopUnlocked: true, purchasedSizeSteps: 5, partSizes: { wings: 125 }, stoneSlotPackages: ['wings'],
    };
    const panel = createHangarSizePanel({
        bind, getProfile: () => profile, saveProfile: (next) => { profile = next; }, toast() {}, onDraftChange() {}, getPool: () => pool,
    });
    panel.render('ship5', profile);
    const row = panel.root.querySelectorAll('[data-size-group]').find((node) => node.dataset.sizeGroup === 'wings');
    find(row, 'hangar-size-minus').click();
    const lines = find(panel.root, 'hangar-size-preview').children.map((line) => line.textContent);
    assert.ok(lines.includes('Stein 1 (Flügel L): T3 → T1'), lines.join(' | '));
    const before = resolveArcadeVehicleActiveStats('ship5', profile, resolveArcadeStoneExtraSteps(pool, 'ship5', profile));
    const afterProfile = { ...profile, partSizes: { ...profile.partSizes, wings: 120 } };
    const after = resolveArcadeVehicleActiveStats('ship5', afterProfile, resolveArcadeStoneExtraSteps(pool, 'ship5', afterProfile));
    const pct = (value) => `${Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
    assert.notEqual(before.turnPct, after.turnPct);
    assert.ok(lines.includes(`Wendigkeit: ${pct(before.turnPct)} → ${pct(after.turnPct)}`), lines.join(' | '));
});

// --- Arcade-Werkstatt: keine Starter, kein Budget, kein Paar-Schalter; Steine im Reiter „Ausbau“ ---

test('Arcade-Werkstatt: Starter-Builds, Budgetzeilen, Paar-Schalter, „Umbau“ und Steinkatalog sind ausgeblendet; Fight behält sie', () => {
    // The nodes the arcade workshop hides itself (tab panels around them open and close on their own).
    const ownNodes = (shell) => ({
        pair: shell.pairToggle.parentElement,
        budget: shell.budgetRows,
        starter: shell.starterBuilds.parentElement,
        workshopTab: shell.workshopViewButton,
        catalogSwitch: shell.viewSwitch,
    });
    const arcade = createArcadeHangarWorkshopShell({}, { mode: 'arcade' });
    for (const [name, node] of Object.entries(ownNodes(arcade))) {
        assert.equal(node.classList.contains('hidden'), true, `Arcade ohne ${name}`);
    }
    assert.equal(arcade.workshopViewPanel.contains(arcade.slotGrid), false, 'die Steinplätze leben im Reiter „Ausbau“');
    assert.ok(arcade.slotsPanel.contains(arcade.slotGrid));
    assert.ok(arcade.historyBar.contains(arcade.undoButton));

    const fight = createArcadeHangarWorkshopShell({}, { mode: 'fight' });
    for (const [name, node] of Object.entries(ownNodes(fight))) {
        assert.equal(node.classList.contains('hidden'), false, `Fight behält ${name}`);
    }
    assert.ok(fight.workshopViewPanel.contains(fight.slotGrid), 'Fight: Fassungen bleiben im Reiter „Umbau“');
});

test('Steinpanel: im Panel stehen Plätze, Verlauf und Vorrat; die Plätze liegen im Reiter „Ausbau“', () => {
    const h = createStonePanel();
    assert.ok(h.root.contains(h.shell.slotGrid));
    assert.ok(h.root.contains(h.shell.historyBar));
    assert.ok(h.root.contains(h.shell.validationBox));
    assert.equal(find(h.shell.slotsPanel, 'arcade-vehicle-subtitle').textContent, 'Steinplätze');
    assert.equal(h.root.getAttribute('aria-labelledby'), find(h.root, 'hangar-stone-title').id);
});
