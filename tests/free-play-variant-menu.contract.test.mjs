import assert from 'node:assert/strict';
import test from 'node:test';

import { handleFreePlayVariantChangeAction } from '../src/core/runtime/MenuRuntimeFreePlayService.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import { syncFreePlayUi } from '../src/ui/menu/MenuFreePlayUiSync.js';
import { bindMenuFreePlayControls } from '../src/ui/menu/MenuFreePlayBindings.js';
import { MENU_CONTROLLER_EVENT_TYPES } from '../src/shared/contracts/MenuControllerContract.js';

function createGame(localSettings = {}) {
    const calls = { settingsChanged: [], panels: [] };
    const game = {
        settings: {
            mode: '1p',
            gameMode: 'CLASSIC',
            mapKey: 'standard',
            numBots: 2,
            botDifficulty: 'NORMAL',
            hunt: { respawnEnabled: false, teamMode: false, teamObjective: 'HUNT' },
            localSettings: { sessionType: 'single', modePath: 'normal', ...localSettings },
        },
        settingsManager: { applyMenuPreset: () => ({ success: true, changedKeys: [] }) },
        uiManager: {
            _runtimeFeatureFlags: { surfacePolicy: { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP } },
            menuNavigationRuntime: { showPanel: (panelId) => calls.panels.push(panelId) },
        },
        _showStatusToast() {},
    };
    return { game, calls };
}

function choose(game, calls, event) {
    handleFreePlayVariantChangeAction({
        game,
        event,
        onSettingsChanged: (payload) => calls.settingsChanged.push(payload),
        resolveMenuAccessContext: () => ({ isOwner: true }),
    });
}

test('the hub card opens free play with the remembered variant, free-for-all at first', () => {
    const { game, calls } = createGame();
    choose(game, calls, {});
    assert.equal(game.settings.localSettings.modePath, 'fight');
    assert.equal(game.settings.gameMode, 'HUNT');
    assert.equal(game.settings.hunt.teamMode, false);
    assert.equal(game.settings.localSettings.freePlayVariant, 'ffa');
    assert.deepEqual(calls.panels, ['submenu-game']);
    assert.equal(calls.settingsChanged.length, 1, 'one settings change per choice');
});

test('a variant switch inside free play writes the team setup and stays on the screen', () => {
    const { game, calls } = createGame({ modePath: 'fight' });
    choose(game, calls, { variant: 'flags', stayOnPanel: true });
    assert.equal(game.settings.hunt.teamMode, true);
    assert.equal(game.settings.hunt.teamObjective, 'FLAGS');
    assert.equal(game.settings.hunt.respawnEnabled, true);
    assert.equal(game.settings.localSettings.freePlayVariant, 'flags');
    assert.deepEqual(calls.panels, []);
    const [{ changedKeys }] = calls.settingsChanged;
    for (const key of [SETTINGS_CHANGE_KEYS.MODE_PATH, SETTINGS_CHANGE_KEYS.HUNT_TEAM_MODE, SETTINGS_CHANGE_KEYS.HUNT_TEAM_OBJECTIVE]) {
        assert.ok(changedKeys.includes(key), `changed keys carry ${key}`);
    }
});

test('classic is the normal mode path and comes back on the next visit', () => {
    const { game, calls } = createGame({ modePath: 'fight' });
    choose(game, calls, { variant: 'classic', stayOnPanel: true });
    assert.equal(game.settings.localSettings.modePath, 'normal');
    assert.equal(game.settings.gameMode, 'CLASSIC');
    assert.equal(game.settings.hunt.teamMode, false);
    choose(game, calls, {});
    assert.equal(game.settings.localSettings.modePath, 'normal');
    assert.equal(game.settings.localSettings.freePlayVariant, 'classic');
});

function fakeElement(attributes = {}, dataset = {}) {
    const attrs = new Map(Object.entries(attributes));
    const classes = new Set();
    return {
        dataset,
        disabled: false,
        hidden: false,
        textContent: '',
        parentElement: null,
        classList: {
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute: (name, value) => attrs.set(name, String(value)),
        getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
        removeAttribute: (name) => attrs.delete(name),
    };
}

function createFreePlayUi() {
    const buttons = ['ffa', 'team', 'flags', 'escort', 'classic'].map((variant) => {
        const key = { team: 'variantTeam', flags: 'variantFlags', escort: 'variantEscort' }[variant];
        return fakeElement(key ? { 'data-menu-visibility-key': key } : {}, { freePlayVariant: variant });
    });
    const group = {
        querySelectorAll: () => buttons.filter((button) => button.getAttribute('data-menu-visibility-key')),
    };
    buttons.forEach((button) => { button.parentElement = group; });
    return {
        freePlayVariantButtons: buttons,
        freePlayVariantHint: fakeElement(),
        freePlayEntryButton: fakeElement(),
        freePlayOnlyElements: [fakeElement()],
        freePlayHiddenElements: [fakeElement()],
        hubTitleSpans: [fakeElement({}, { hubTitleFor: 'single' }), fakeElement({}, { hubTitleFor: 'splitscreen' })],
    };
}

const byVariant = (ui, variant) => ui.freePlayVariantButtons.find((button) => button.dataset.freePlayVariant === variant);

test('the pressed variant, titles and free play elements follow the settings', () => {
    const ui = createFreePlayUi();
    const settings = { localSettings: { sessionType: 'single', modePath: 'fight' }, hunt: { teamMode: true, teamObjective: 'ESCORT' } };
    syncFreePlayUi({ ui, settings, sessionType: 'single' });
    assert.equal(byVariant(ui, 'escort').getAttribute('aria-pressed'), 'true');
    assert.equal(byVariant(ui, 'ffa').getAttribute('aria-pressed'), 'false');
    assert.equal(ui.freePlayOnlyElements[0].classList.contains('hidden'), false);
    assert.equal(ui.freePlayHiddenElements[0].classList.contains('hidden'), true);
    assert.equal(ui.hubTitleSpans[0].classList.contains('hidden'), false);
    assert.equal(ui.hubTitleSpans[1].classList.contains('hidden'), true);
    assert.equal(ui.freePlayVariantHint.classList.contains('hidden'), true);

    syncFreePlayUi({ ui, settings: { localSettings: { modePath: 'arcade' } }, sessionType: 'splitscreen' });
    assert.equal(ui.freePlayOnlyElements[0].classList.contains('hidden'), true, 'arcade is not free play');
    assert.equal(ui.hubTitleSpans[1].classList.contains('hidden'), false);
});

test('three shared-screen players cannot pick team variants and are told why in words', () => {
    const ui = createFreePlayUi();
    const settings = {
        localSettings: { sessionType: 'splitscreen', splitScreenVariant: 'three_player', modePath: 'fight' },
        hunt: { teamMode: false },
    };
    syncFreePlayUi({ ui, settings, sessionType: 'splitscreen' });
    for (const variant of ['team', 'flags', 'escort']) {
        assert.equal(byVariant(ui, variant).disabled, true, `${variant} is disabled`);
        assert.equal(byVariant(ui, variant).getAttribute('data-menu-disabled-reason'), 'three_players_no_teams');
    }
    assert.equal(byVariant(ui, 'ffa').disabled, false);
    assert.equal(ui.freePlayVariantHint.textContent, 'Mit drei Spielern gibt es keine Teams.');
    assert.equal(ui.freePlayVariantHint.classList.contains('hidden'), false);
});

test('a refused fight path disables the fight variants but keeps classic', () => {
    const ui = createFreePlayUi();
    const settings = { localSettings: { sessionType: 'single', modePath: 'normal' } };
    syncFreePlayUi({ ui, settings, sessionType: 'single', huntFeatureEnabled: false });
    for (const variant of ['ffa', 'team', 'flags', 'escort']) {
        assert.equal(byVariant(ui, variant).disabled, true, `${variant} is disabled`);
    }
    assert.equal(byVariant(ui, 'classic').disabled, false);
    assert.equal(ui.freePlayEntryButton.disabled, false);
    syncFreePlayUi({ ui, settings, sessionType: 'single', isModePathAllowed: (modePath) => modePath === 'arcade' });
    assert.equal(ui.freePlayEntryButton.disabled, true, 'no free play without its mode paths');
});

test('variant buttons emit the variant and stay on the screen; the hub card emits none', () => {
    const ui = createFreePlayUi();
    const listeners = new Map();
    const emitted = [];
    bindMenuFreePlayControls({
        ui,
        bind: (target, type, handler) => listeners.set(target, handler),
        emit: (type, payload) => emitted.push({ type, payload }),
        eventTypes: MENU_CONTROLLER_EVENT_TYPES,
    });
    listeners.get(ui.freePlayEntryButton)();
    listeners.get(byVariant(ui, 'team'))();
    byVariant(ui, 'flags').setAttribute('aria-pressed', 'true');
    listeners.get(byVariant(ui, 'flags'))();
    assert.deepEqual(emitted, [
        { type: 'free_play_variant_change', payload: {} },
        { type: 'free_play_variant_change', payload: { variant: 'team', stayOnPanel: true } },
    ]);
});
