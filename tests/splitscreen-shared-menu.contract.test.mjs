import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { CONFIG } from '../src/core/Config.js';
import { resolveMatchStartValidationIssue } from '../src/core/runtime/MatchStartValidationService.js';
import { buildHumanConfigs } from '../src/state/match-session/MatchSessionSetupOps.js';
import { VIEWPORT_LAYOUTS } from '../src/shared/contracts/ViewportLayoutContract.js';
import { ARCADE_FACTORY_VEHICLE_IDS } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    SPLIT_SCREEN_VARIANTS,
    resolveSplitScreenDeviceIssue,
} from '../src/four-player-planar/FourPlayerPlanarContract.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { START_VALIDATION_RELEVANT_KEY_SET } from '../src/core/runtime/GameRuntimeSettingsKeySets.js';
import {
    assignThreePlayerSplitDevice,
    bindSplitPlayersSection,
    createLocalPilotSummaryBlocks,
    resolveMenuBotCount,
    resolveMenuBotLimits,
    syncSplitPlayersSection,
} from '../src/ui/start-setup/StartSetupSplitPlayersSection.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

register('./helpers/style-import-hooks.mjs', import.meta.url);
const { FourPlayerPlanarModule } = await import('../src/four-player-planar/FourPlayerPlanarModule.js');

const CONNECTED = () => ({ connected: true });
const NO_PADS = () => null;

function createSplitSettings({ players = 3, modePath = 'fight' } = {}) {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.localSettings.sessionType = 'splitscreen';
    settings.localSettings.splitScreenVariant = players === 3
        ? SPLIT_SCREEN_VARIANTS.THREE_PLAYER
        : SPLIT_SCREEN_VARIANTS.STANDARD;
    settings.localSettings.modePath = modePath;
    settings.gameMode = { fight: 'HUNT', arcade: 'ARCADE' }[modePath] || 'CLASSIC';
    settings.mode = '2p';
    return { manager, settings };
}

test('a three-player match uses the map, planes and bots of the shared match menu', () => {
    const { manager, settings } = createSplitSettings();
    settings.mapKey = 'maze';
    settings.numBots = 8;
    settings.vehicles = { PLAYER_1: 'ship5', PLAYER_2: 'arrow', PLAYER_3: 'drone' };
    // Leftovers of the former three-player setup block must not win any more.
    settings.localSettings.threePlayerSplit = { mapKey: 'standard', vehicleId: 'ship5', botCount: 1, mode: 'classic' };

    const runtime = manager.createRuntimeConfig(settings);

    assert.equal(runtime.session.numHumans, 3);
    assert.equal(runtime.session.mapKey, 'maze');
    assert.equal(runtime.session.numBots, 6);
    assert.equal(runtime.session.activeGameMode, 'HUNT');
    assert.equal(runtime.session.threePlayerSplit.mode, 'hunt');
    assert.deepEqual(runtime.player.vehicles, { PLAYER_1: 'ship5', PLAYER_2: 'arrow', PLAYER_3: 'drone' });
    assert.deepEqual(buildHumanConfigs(settings, runtime).map((entry) => entry.vehicleId), ['ship5', 'arrow', 'drone']);
});

test('a save from the former three-player form loads cleanly and keeps its devices, layout and plane', () => {
    const { manager, settings } = createSplitSettings();
    settings.vehicles = { PLAYER_1: 'ship5', PLAYER_2: 'arrow' };
    settings.localSettings.threePlayerSplit = {
        mode: 'hunt',
        mapKey: 'maze',
        vehicleId: 'drone',
        botCount: 4,
        viewportLayout: 'three_rows',
        deviceAssignment: ['keyboard', 'gamepad-2', 'gamepad-1'],
    };
    manager.saveSettings(manager.sanitizeSettings(settings));

    const loaded = manager.loadSettings();

    assert.deepEqual(loaded.localSettings.threePlayerSplit, {
        viewportLayout: 'three_rows',
        deviceAssignment: ['keyboard', 'gamepad-2', 'gamepad-1'],
    });
    assert.equal(loaded.vehicles.PLAYER_3, 'drone', 'the former shared plane becomes pilot three\'s plane');
    assert.equal(loaded.vehicles.PLAYER_2, 'arrow');
    assert.equal(manager.createRuntimeConfig(loaded).session.numHumans, 3);
});

test('team and escort rules of the shared menu never reach the three-player HUD', () => {
    const { manager, settings } = createSplitSettings();
    settings.hunt = { ...settings.hunt, teamMode: true, teamObjective: 'ESCORT' };

    const runtime = manager.createRuntimeConfig(settings);

    assert.equal(runtime.session.activeGameMode, 'HUNT');
    assert.equal(runtime.hunt.teamMode, false);
    assert.equal(runtime.hunt.teamObjective, 'HUNT');
});

test('the shared flight style applies to three players because it is visible in the same menu', () => {
    const { manager, settings } = createSplitSettings({ modePath: 'normal' });
    settings.gameplay.planarMode = true;
    assert.equal(manager.createRuntimeConfig(settings).gameplay.planarMode, true);
    settings.gameplay.planarMode = false;
    assert.equal(manager.createRuntimeConfig(settings).gameplay.planarMode, false);
});

test('Arcade starts three independent pilots in the chosen split layout', () => {
    const { manager, settings } = createSplitSettings({ modePath: 'arcade' });
    settings.localSettings.threePlayerSplit = {
        deviceAssignment: ['keyboard', 'keyboard', 'keyboard'],
        viewportLayout: 'three_rows',
    };
    settings.vehicles = { PLAYER_1: 'ship5', PLAYER_2: 'arrow', PLAYER_3: 'manta' };
    const runtime = manager.createRuntimeConfig(settings);
    assert.equal(runtime.session.numHumans, 3);
    assert.equal(runtime.session.viewportLayout, VIEWPORT_LAYOUTS.THREE_ROWS);
    assert.equal(runtime.arcade.enabled, true);
    assert.deepEqual(runtime.player.vehicles, settings.vehicles);
    assert.deepEqual(buildHumanConfigs(settings, runtime).map((entry) => entry.vehicleId), ['ship5', 'arrow', 'manta']);

    const issue = resolveMatchStartValidationIssue({ settings, maps: CONFIG.MAPS, getGamepad: CONNECTED });
    assert.equal(issue, null);
});

test('Arcade three-player runtime replaces non-factory selections with an offered factory ship', () => {
    const { manager, settings } = createSplitSettings({ modePath: 'arcade' });
    settings.vehicles = { PLAYER_1: 'custom_lab_1', PLAYER_2: 'custom_lab_2', PLAYER_3: 'custom_lab_3' };
    const runtime = manager.createRuntimeConfig(settings);
    assert.deepEqual(runtime.player.vehicles, {
        PLAYER_1: 'ship5',
        PLAYER_2: 'ship5',
        PLAYER_3: 'ship5',
    });
    assert.ok(ARCADE_FACTORY_VEHICLE_IDS.includes(runtime.player.vehicles.PLAYER_3));
});

test('the start check blocks a missing controller for two and three players', () => {
    const two = createSplitSettings({ players: 2 }).settings;
    two.controls.SPLITSCREEN = { layout: 'controller-controller' };
    const twoIssue = resolveMatchStartValidationIssue({ settings: two, maps: CONFIG.MAPS, getGamepad: (index) => (index === 0 ? {} : null) });
    assert.equal(twoIssue?.fieldKey, 'players');
    assert.match(twoIssue.message, /Gamepad 2 fehlt/);

    two.controls.SPLITSCREEN = { layout: 'auto' };
    assert.equal(resolveMatchStartValidationIssue({ settings: two, maps: CONFIG.MAPS, getGamepad: NO_PADS }), null);

    const three = createSplitSettings().settings;
    three.localSettings.threePlayerSplit = { deviceAssignment: ['gamepad-1', 'gamepad-2', 'keyboard'] };
    assert.match(resolveMatchStartValidationIssue({ settings: three, maps: CONFIG.MAPS, getGamepad: NO_PADS })?.message || '', /Gamepad 1 fehlt/);
    assert.equal(resolveMatchStartValidationIssue({ settings: three, maps: CONFIG.MAPS, getGamepad: CONNECTED }), null);
});

test('device issues respect disabled controllers and keyboard-only setups', () => {
    const { settings } = createSplitSettings();
    settings.controls.GAMEPAD = { enabled: false };
    settings.localSettings.threePlayerSplit = { deviceAssignment: ['keyboard', 'keyboard', 'keyboard'] };
    assert.equal(resolveSplitScreenDeviceIssue(settings, NO_PADS), '');
    settings.localSettings.threePlayerSplit = { deviceAssignment: ['keyboard', 'keyboard', 'gamepad-3'] };
    assert.match(resolveSplitScreenDeviceIssue(settings, CONNECTED), /Gamepads sind deaktiviert/);
    settings.localSettings.sessionType = 'single';
    assert.equal(resolveSplitScreenDeviceIssue(settings, NO_PADS), '');
});

test('a picked gamepad moves away from its previous owner, the keyboard can be shared', () => {
    assert.deepEqual(assignThreePlayerSplitDevice(['gamepad-1', 'gamepad-2', 'keyboard'], 2, 'gamepad-1'), ['keyboard', 'gamepad-2', 'gamepad-1']);
    assert.deepEqual(assignThreePlayerSplitDevice(['gamepad-1', 'gamepad-2', 'keyboard'], 1, 'keyboard'), ['gamepad-1', 'keyboard', 'keyboard']);
    assert.deepEqual(assignThreePlayerSplitDevice(['keyboard', 'keyboard', 'keyboard'], 0, 'gamepad-3'), ['gamepad-3', 'keyboard', 'keyboard']);
    assert.deepEqual(assignThreePlayerSplitDevice(['gamepad-2', 'joystick-9', 'keyboard'], 1, 'gamepad-2'), ['gamepad-1', 'gamepad-2', 'keyboard']);
});

test('summary and bot slider show what a three-player match really starts with', () => {
    const { settings } = createSplitSettings();
    settings.numBots = 8;
    settings.vehicles.PLAYER_3 = 'drone';
    assert.equal(resolveMenuBotCount(settings), 6);
    assert.equal(resolveMenuBotLimits(settings, { min: 0, max: 8, step: 1 }).max, 6);
    const labels = createLocalPilotSummaryBlocks(settings, 'splitscreen', { label: 'P2' }).map((block) => block.label);
    assert.deepEqual(labels, ['Spieler', 'Flugzeug P2', 'Flugzeug P3']);

    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.STANDARD;
    assert.equal(resolveMenuBotCount(settings), 8, 'two players keep the stored count');
    assert.deepEqual(createLocalPilotSummaryBlocks(settings, 'splitscreen', { label: 'P2' }).map((block) => block.label), ['Flugzeug P2']);
    assert.deepEqual(createLocalPilotSummaryBlocks(settings, 'single', { label: 'P2' }), []);
});

test('the planar module only resets its own variant when a mode card is picked', () => {
    const settings = { localSettings: { splitScreenVariant: SPLIT_SCREEN_VARIANTS.THREE_PLAYER } };
    const module = new FourPlayerPlanarModule({
        runtimePort: { ensureLocalSettings: () => settings.localSettings },
        setupView: { isMounted: () => false },
        hudView: {},
    });
    module._selectStandardSplitScreen();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    settings.localSettings.splitScreenVariant = SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
    module._selectStandardSplitScreen();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.STANDARD);
});

test('split setup changes and plugged pads report a start-relevant change, so a stale start block clears', () => {
    const listeners = new Map();
    const view = {};
    const section = { classList: { contains: () => false }, closest: () => null, ownerDocument: { defaultView: view } };
    const countButton = { dataset: { splitPlayerCount: '3' }, disabled: false };
    const emitted = [];
    const { settings } = createSplitSettings({ players: 2 });
    bindSplitPlayersSection({
        ui: { splitPlayersSection: section, splitPlayerCountButtons: [countButton] },
        settings,
        settingsChangeKeys: SETTINGS_CHANGE_KEYS,
        bind: (target, type, handler) => listeners.set(`${target === view ? 'view' : 'button'}:${type}`, handler),
        emitSettingsChangedImmediate: (keys) => emitted.push(keys),
        getGamepad: CONNECTED,
    });

    listeners.get('button:click')();
    assert.equal(settings.localSettings.splitScreenVariant, SPLIT_SCREEN_VARIANTS.THREE_PLAYER);
    listeners.get('view:gamepadconnected')();
    assert.equal(emitted.length, 2);
    for (const keys of emitted) assert.ok(START_VALIDATION_RELEVANT_KEY_SET.has(keys[0]), `got ${keys}`);

    // During a match the pad events must not touch the settings.
    settings.localSettings.sessionType = 'single';
    listeners.get('view:gamepaddisconnected')();
    assert.equal(emitted.length, 2);
});

function createNode(dataset = {}) {
    const classes = new Set(['hidden']);
    const node = {
        dataset,
        attributes: {},
        options: [],
        value: '',
        hidden: false,
        disabled: false,
        title: '',
        textContent: '',
        classList: {
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
        setAttribute(name, value) { node.attributes[name] = value; },
        replaceChildren(...options) { node.options = options; node.value = options[0]?.value || ''; },
        ownerDocument: { createElement: () => ({ value: '', textContent: '' }) },
    };
    return node;
}

test('the section shows the right controls for two and three players in Arcade', () => {
    const ui = {
        splitPlayersSection: createNode(),
        splitPlayersStepTab: createNode(),
        mapPickerSection: { open: false },
        splitPlayerCountButtons: [createNode({ splitPlayerCount: '2' }), createNode({ splitPlayerCount: '3' })],
        splitPlayerCountHint: createNode(),
        splitPlayersForNodes: [createNode({ splitPlayersFor: '2' }), createNode({ splitPlayersFor: '3' })],
        splitInputLayoutSelect: createNode(),
        splitDeviceSelects: [createNode(), createNode(), createNode()],
        splitKeyboardHints: [createNode(), createNode(), createNode()],
        splitViewportLayoutSelect: createNode(),
        splitDeviceStatus: createNode(),
    };
    const { settings } = createSplitSettings();
    settings.localSettings.threePlayerSplit = { deviceAssignment: ['keyboard', 'gamepad-1', 'gamepad-2'] };

    syncSplitPlayersSection({ ui, settings, sessionType: 'splitscreen', getGamepad: CONNECTED });
    assert.equal(ui.splitPlayersSection.classList.contains('hidden'), false);
    assert.equal(ui.splitPlayerCountButtons[1].attributes['aria-pressed'], 'true');
    assert.equal(ui.splitPlayersForNodes[0].classList.contains('hidden'), true);
    assert.equal(ui.splitPlayersForNodes[1].classList.contains('hidden'), false);
    assert.deepEqual(ui.splitDeviceSelects.map((select) => select.value), ['keyboard', 'gamepad-1', 'gamepad-2']);
    assert.deepEqual(ui.splitKeyboardHints.map((hint) => hint.hidden), [false, true, true]);

    settings.localSettings.modePath = 'arcade';
    syncSplitPlayersSection({ ui, settings, sessionType: 'splitscreen', getGamepad: CONNECTED });
    assert.equal(ui.splitPlayerCountButtons[1].disabled, false);
    assert.equal(ui.splitPlayerCountButtons[1].attributes['aria-pressed'], 'true');
    assert.equal(ui.splitPlayersForNodes[1].classList.contains('hidden'), false);
    assert.match(ui.splitPlayerCountHint.textContent, /höchstens 6 Bots/);

    assert.equal(ui.splitPlayersStepTab.classList.contains('hidden'), false, 'the wide layout reaches the section by its rail tab');

    ui.splitPlayersSection.open = true;
    ui.mapPickerSection.open = false;
    syncSplitPlayersSection({ ui, settings, sessionType: 'single' });
    assert.equal(ui.splitPlayersSection.classList.contains('hidden'), true);
    assert.equal(ui.splitPlayersStepTab.classList.contains('hidden'), true);
    assert.equal(ui.splitPlayersSection.open, false);
    assert.equal(ui.mapPickerSection.open, true, 'an open hidden section falls back to the map step');
});
