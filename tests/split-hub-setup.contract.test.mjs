import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPLIT_SCREEN_VARIANTS } from '../src/four-player-planar/FourPlayerPlanarContract.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { applyMenuVisibility } from '../src/ui/menu/MenuVisibilityApplier.js';
import { resolveMenuVisibility } from '../src/shared/contracts/MenuVisibilityContract.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import {
    bindSplitPlayersSection,
    resolveSplitPlayerCount,
    syncSplitPlayersSection,
} from '../src/ui/start-setup/StartSetupSplitPlayersSection.js';
import {
    NEW_PROFILE_VALUE,
    bindSplitProfileSeats,
    planSeatProfilePick,
    renderSplitProfileSeats,
    resolveSeatProfiles,
    writeSeatProfileIds,
} from '../src/ui/start-setup/StartSetupSplitSeatProfiles.js';
import { createPlayerProfileMenuRuntimeAccess } from '../src/core/runtime/PlayerProfileRuntimeAccess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const PROFILES = [
    { id: 'p-a', displayName: 'Anna' },
    { id: 'p-b', displayName: 'Ben' },
    { id: 'p-c', displayName: 'Cleo' },
];

function createNode(dataset = {}, attributes = {}) {
    const classes = new Set();
    const attrs = new Map(Object.entries(attributes));
    const node = {
        dataset,
        options: [],
        children: [],
        value: '',
        hidden: false,
        disabled: false,
        title: '',
        textContent: '',
        attributes: {},
        classList: {
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute(name, value) { attrs.set(name, String(value)); node.attributes[name] = String(value); },
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        removeAttribute(name) { attrs.delete(name); delete node.attributes[name]; },
        replaceChildren(...options) {
            node.options = options;
            node.value = options.find((option) => option.selected)?.value ?? options[0]?.value ?? '';
        },
        ownerDocument: { createElement: () => ({ value: '', textContent: '', disabled: false, selected: false }) },
    };
    return node;
}

function createHubRoot(entries) {
    const nodes = entries.map(([key]) => createNode({}, { 'data-menu-visibility-key': key }));
    return { nodes, root: { querySelectorAll: () => nodes } };
}

function createSettings({ variant = SPLIT_SCREEN_VARIANTS.STANDARD, modePath = 'normal' } = {}) {
    const settings = { localSettings: { sessionType: 'splitscreen', splitScreenVariant: variant, modePath, startSetup: {} } };
    return settings;
}

function createSplitUi() {
    const hub = createHubRoot([
        ['arcadeJourney'], ['freePlay'], ['planarEntry'], ['deviceAssignment'], ['profileSlots'],
    ]);
    const ui = {
        splitPlayersSection: createNode(),
        hubPanel: hub.root,
        splitPlayerCountButtons: ['2', '3', '4'].map((count) => createNode({ splitPlayerCount: count })),
        splitPlayerCountHint: createNode(),
        splitPlayersForNodes: [createNode({ splitPlayersFor: '2' }), createNode({ splitPlayersFor: '3' })],
        splitInputLayoutSelect: createNode(),
        splitDeviceSelects: [createNode(), createNode(), createNode()],
        splitKeyboardHints: [],
        splitViewportLayoutSelect: createNode(),
        splitDeviceStatus: createNode(),
    };
    const byKey = Object.fromEntries(hub.nodes.map((node) => [node.getAttribute('data-menu-visibility-key'), node]));
    return { ui, byKey };
}

test('the player count of the shared screen is 2, 3 or 4 from the stored variant', () => {
    assert.equal(resolveSplitPlayerCount(createSettings()), 2);
    assert.equal(resolveSplitPlayerCount(createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER })), 3);
    assert.equal(resolveSplitPlayerCount(createSettings({ variant: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR })), 4);
    assert.equal(resolveSplitPlayerCount(createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER, modePath: 'arcade' })), 3);
});

test('the hub shows only what fits the player count of the shared screen', () => {
    const { ui, byKey } = createSplitUi();
    const settings = createSettings();

    syncSplitPlayersSection({ ui, settings, sessionType: 'splitscreen' });
    assert.equal(ui.splitPlayersSection.classList.contains('hidden'), false);
    assert.equal(ui.splitPlayerCountButtons[0].attributes['aria-pressed'], 'true');
    assert.deepEqual(
        ['arcadeJourney', 'freePlay', 'planarEntry', 'deviceAssignment', 'profileSlots'].map((key) => byKey[key].hidden),
        [false, false, true, false, false],
        'two players: both entry cards, no planar card'
    );

    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
    syncSplitPlayersSection({ ui, settings, sessionType: 'splitscreen' });
    assert.equal(ui.splitPlayerCountButtons[1].attributes['aria-pressed'], 'true');
    assert.equal(byKey.planarEntry.hidden, true);
    assert.equal(byKey.deviceAssignment.hidden, false);
    assert.equal(ui.splitPlayersForNodes[1].classList.contains('hidden'), false);

    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
    syncSplitPlayersSection({ ui, settings, sessionType: 'splitscreen' });
    assert.equal(ui.splitPlayerCountButtons[2].attributes['aria-pressed'], 'true');
    assert.deepEqual(
        ['arcadeJourney', 'freePlay', 'planarEntry', 'deviceAssignment', 'profileSlots'].map((key) => byKey[key].hidden),
        [true, true, false, true, true],
        'four players: only the planar card'
    );
    assert.match(ui.splitPlayerCountHint.textContent, /Ebenenflug/);

    syncSplitPlayersSection({ ui, settings, sessionType: 'single' });
    assert.equal(ui.splitPlayersSection.classList.contains('hidden'), true);
    assert.deepEqual(
        ['arcadeJourney', 'freePlay', 'planarEntry'].map((key) => byKey[key].hidden),
        [false, false, true],
        'a single session keeps both entry cards and never shows the planar card'
    );
});

test('the visibility applier can leave the disabled state of a button to its owner', () => {
    const button = createNode({}, { 'data-menu-visibility-key': 'freePlay' });
    button.disabled = true;
    applyMenuVisibility({ querySelectorAll: () => [button] }, resolveMenuVisibility({ sessionType: 'splitscreen', playerCount: 2 }), { touchDisabled: false });
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, true, 'the surface policy keeps its own lock');
});

test('seat 1 reflects the explicit Arcade profile and falls back to the active profile only when empty', () => {
    const state = resolveSeatProfiles({
        startSetup: { arcadePlayerProfileIds: ['p-c', 'p-b', 'p-gone'] },
        profiles: PROFILES,
        activeId: 'p-a',
        seatCount: 3,
    });
    assert.deepEqual(state.ids, ['p-c', 'p-b', '']);
    assert.deepEqual(state.missingSeats, [2]);
    assert.deepEqual(state.duplicateSeats, []);

    const legacy = resolveSeatProfiles({
        startSetup: { demolitionProfileIds: ['x', 'p-c', ''] },
        profiles: PROFILES,
        activeId: 'p-a',
        seatCount: 2,
    });
    assert.deepEqual(legacy.ids, ['', 'p-c', ''], 'a stale explicit primary is not silently replaced');
    assert.deepEqual(legacy.missingSeats, [0]);
    assert.deepEqual(resolveSeatProfiles({ startSetup: {}, profiles: PROFILES, activeId: 'p-a' }).ids,
        ['p-a', '', '']);
    assert.deepEqual(planSeatProfilePick({ startSetup: { arcadePlayerProfileIds: ['p-c', 'p-b', ''] },
        profiles: PROFILES, activeId: 'p-a', seatCount: 3, seatIndex: 2, profileId: 'p-a' }),
    { ok: true, ids: ['p-c', 'p-b', 'p-a'] }, 'picking a partner retains the explicit primary');
});

test('a profile can sit at only one seat of a match', () => {
    const startSetup = { arcadePlayerProfileIds: ['p-a', 'p-b', ''] };
    const base = { startSetup, profiles: PROFILES, activeId: 'p-a', seatCount: 3 };

    assert.deepEqual(planSeatProfilePick({ ...base, seatIndex: 2, profileId: 'p-c' }), { ok: true, ids: ['p-a', 'p-b', 'p-c'] });
    assert.deepEqual(planSeatProfilePick({ ...base, seatIndex: 2, profileId: 'p-b' }), { ok: false, reason: 'duplicate' });
    assert.deepEqual(planSeatProfilePick({ ...base, seatIndex: 1, profileId: 'p-a' }), { ok: false, reason: 'duplicate' },
        'the active profile already plays at seat 1');
    assert.deepEqual(planSeatProfilePick({ ...base, seatIndex: 1, profileId: 'p-zzz' }), { ok: false, reason: 'unknown_profile' });
    assert.deepEqual(planSeatProfilePick({ ...base, seatIndex: 0, profileId: 'p-c' }), { ok: false, reason: 'active_seat' });
    // Seat 3 is not part of a two-player match, so its profile does not block seat 2.
    startSetup.arcadePlayerProfileIds = ['p-a', '', 'p-c'];
    assert.equal(planSeatProfilePick({ ...base, seatCount: 2, seatIndex: 1, profileId: 'p-c' }).ok, true);

    const twice = resolveSeatProfiles({ startSetup: { arcadePlayerProfileIds: ['p-a', 'p-b', 'p-b'] }, profiles: PROFILES, activeId: 'p-a', seatCount: 3 });
    assert.deepEqual(twice.duplicateSeats, [1, 2], 'a stored duplicate is reported for both seats');
});

test('the seat profiles share the arcade field, so there is one truth', () => {
    const startSetup = {};
    writeSeatProfileIds(startSetup, ['p-a', 'p-b', 'p-c']);
    assert.deepEqual(startSetup.arcadePlayerProfileIds, ['p-a', 'p-b', 'p-c']);
    assert.deepEqual(startSetup.demolitionProfileIds, ['p-a', 'p-b', 'p-c']);
    writeSeatProfileIds(startSetup, ['p-a', 7, null, 'extra']);
    assert.deepEqual(startSetup.arcadePlayerProfileIds, ['p-a', '', '']);
});

test('player count, devices and profiles survive the settings normalizer', () => {
    const settings = {
        localSettings: {
            sessionType: 'splitscreen',
            splitScreenVariant: SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR,
            threePlayerSplit: { deviceAssignment: ['keyboard', 'gamepad-1', 'gamepad-2'], viewportLayout: 'three_rows' },
            startSetup: { arcadePlayerProfileIds: ['p-a', 'p-b', 'p-c'] },
        },
        controls: { SPLITSCREEN: { layout: 'keyboard_gamepad' } },
    };
    ensureMenuContractState(settings);
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR);
    assert.deepEqual(settings.localSettings.threePlayerSplit.deviceAssignment, ['keyboard', 'gamepad-1', 'gamepad-2']);
    assert.equal(settings.localSettings.threePlayerSplit.viewportLayout, 'three_rows');
    assert.deepEqual(settings.localSettings.startSetup.arcadePlayerProfileIds, ['p-a', 'p-b', 'p-c']);
});

test('picking 4 stores the planar variant, 2 and 3 the older ones', () => {
    const listeners = new Map();
    const emitted = [];
    const settings = createSettings();
    const buttons = ['2', '3', '4'].map((count) => createNode({ splitPlayerCount: count }));
    bindSplitPlayersSection({
        ui: { splitPlayersSection: createNode(), splitPlayerCountButtons: buttons },
        settings,
        settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        bind: (target, type, handler) => listeners.set(`${target?.dataset?.splitPlayerCount}:${type}`, handler),
        emitSettingsChangedImmediate: (keys) => emitted.push(keys),
    });
    listeners.get('4:click')();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR);
    listeners.get('3:click')();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    listeners.get('2:click')();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.STANDARD);
    assert.equal(emitted.length, 3);
});

function createProfileUi() {
    return {
        splitProfileActiveName: createNode(),
        splitProfileSelects: [createNode({ playerIndex: '1' }), createNode({ playerIndex: '2' })],
        splitProfileHint: createNode(),
    };
}

function createProfileAccess({ profiles = PROFILES.slice(), activeId = 'p-a', limit = 99 } = {}) {
    const created = [];
    return {
        created,
        getPlayerProfiles: () => profiles,
        getActivePlayerProfile: () => profiles.find((profile) => profile.id === activeId) || null,
        createPlayerProfile: (name) => {
            if (profiles.length >= limit) return { ok: false, reason: 'profile_limit' };
            const profile = { id: `p-new-${created.length}`, displayName: name };
            profiles.push(profile);
            created.push(name);
            return { ok: true, profile };
        },
    };
}

test('the profile seats list every profile, name seat 1 and block profiles taken elsewhere', () => {
    const ui = createProfileUi();
    const settings = createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER });
    settings.localSettings.startSetup.arcadePlayerProfileIds = ['', 'p-b', ''];
    renderSplitProfileSeats({ ui, settings, runtimeAccess: createProfileAccess() });

    assert.match(ui.splitProfileActiveName.textContent, /Anna/);
    const seat2 = ui.splitProfileSelects[0];
    const seat3 = ui.splitProfileSelects[1];
    assert.equal(seat2.value, 'p-b');
    assert.equal(seat3.value, '');
    const values = (select) => select.options.map((option) => option.value);
    assert.deepEqual(values(seat2), ['p-a', 'p-b', 'p-c', NEW_PROFILE_VALUE]);
    assert.deepEqual(values(seat3), ['', 'p-a', 'p-b', 'p-c', NEW_PROFILE_VALUE]);
    const disabled = (select) => select.options.filter((option) => option.disabled).map((option) => option.value);
    assert.deepEqual(disabled(seat2), ['p-a'], 'seat 2 cannot take the profile of seat 1');
    assert.deepEqual(disabled(seat3), ['p-a', 'p-b']);
    assert.equal(ui.splitProfileHint.classList.contains('hidden'), true);
});

test('a stored duplicate gets a text hint', () => {
    const ui = createProfileUi();
    const settings = createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER });
    settings.localSettings.startSetup.arcadePlayerProfileIds = ['p-a', 'p-b', 'p-b'];
    renderSplitProfileSeats({ ui, settings, runtimeAccess: createProfileAccess() });
    assert.equal(ui.splitProfileHint.classList.contains('hidden'), false);
    assert.match(ui.splitProfileHint.textContent, /nur einmal/);
});

test('"Neues Profil…" creates "Spieler N" through the port and picks it', () => {
    const listeners = new Map();
    const emitted = [];
    const ui = createProfileUi();
    const settings = createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER });
    const access = createProfileAccess();
    bindSplitProfileSeats({
        ui,
        settings,
        runtimeAccess: access,
        bind: (target, type, handler) => listeners.set(`${target.dataset?.playerIndex}:${type}`, handler),
        changed: () => emitted.push('changed'),
    });

    ui.splitProfileSelects[0].value = NEW_PROFILE_VALUE;
    listeners.get('1:change')();
    assert.deepEqual(access.created, ['Spieler 2']);
    assert.deepEqual(settings.localSettings.startSetup.arcadePlayerProfileIds, ['p-a', 'p-new-0', '']);
    assert.equal(ui.splitProfileSelects[0].value, 'p-new-0');

    ui.splitProfileSelects[1].value = 'p-new-0';
    listeners.get('2:change')();
    assert.deepEqual(settings.localSettings.startSetup.arcadePlayerProfileIds, ['p-a', 'p-new-0', ''], 'a duplicate pick is refused');
    assert.match(ui.splitProfileHint.textContent, /nur einmal/);
    assert.equal(ui.splitProfileSelects[1].value, '');

    ui.splitProfileSelects[1].value = 'p-c';
    listeners.get('2:change')();
    assert.deepEqual(settings.localSettings.startSetup.arcadePlayerProfileIds, ['p-a', 'p-new-0', 'p-c']);
    assert.equal(emitted.length, 2, 'only real changes are announced');
});

test('a full profile list refuses a new profile with a text hint', () => {
    const listeners = new Map();
    const ui = createProfileUi();
    const settings = createSettings({ variant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER });
    const access = createProfileAccess({ limit: 3 });
    bindSplitProfileSeats({
        ui, settings, runtimeAccess: access,
        bind: (target, type, handler) => listeners.set(`${target.dataset?.playerIndex}:${type}`, handler),
        changed: () => {},
    });
    ui.splitProfileSelects[0].value = NEW_PROFILE_VALUE;
    listeners.get('1:change')();
    assert.deepEqual(access.created, []);
    assert.match(ui.splitProfileHint.textContent, /Grenze|Limit|nicht mehr/);
    assert.equal(ui.splitProfileSelects[0].value, '');
});

test('the menu runtime access creates profiles through the profile manager', () => {
    const calls = [];
    const game = {
        playerProfileManager: {
            getProfiles: () => PROFILES,
            getActiveProfile: () => PROFILES[0],
            createProfile: (name) => { calls.push(name); return { ok: true, profile: { id: 'n', displayName: name } }; },
        },
    };
    const access = createPlayerProfileMenuRuntimeAccess(game);
    assert.deepEqual(access.createPlayerProfile('Spieler 2'), { ok: true, profile: { id: 'n', displayName: 'Spieler 2' } });
    assert.deepEqual(calls, ['Spieler 2']);
    assert.deepEqual(createPlayerProfileMenuRuntimeAccess({}).createPlayerProfile('x'), { ok: false, reason: 'profile_manager_unavailable' });
});

test('the page offers players and devices in the hub and no longer in the start screen', () => {
    assert.doesNotMatch(html, /id="start-players-section"/);
    assert.doesNotMatch(html, /id="btn-start-step-players"/);
    const hubStart = html.indexOf('data-menu-panel="custom"');
    const hubEnd = html.indexOf('data-menu-panel="multiplayer"');
    const hub = html.slice(hubStart, hubEnd);
    for (const count of ['2', '3', '4']) assert.match(hub, new RegExp(`data-split-player-count="${count}"`));
    for (const id of ['split-input-layout', 'split-device-p1', 'split-device-p2', 'split-device-p3', 'split-viewport-layout', 'split-profile-p2', 'split-profile-p3']) {
        assert.match(hub, new RegExp(`id="${id}"`), `${id} lives in the hub`);
    }
    for (const key of ['arcadeJourney', 'freePlay', 'deviceAssignment', 'profileSlots']) {
        assert.match(hub, new RegExp(`data-menu-visibility-key="${key}"`), `${key} is bound to the visibility contract`);
    }
    assert.ok(hub.indexOf('id="hub-split-players"') < hub.indexOf('id="journey-hub-mount"'), 'player assignment sits above the journey map');
});
