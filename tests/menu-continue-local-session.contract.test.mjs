// ============================================
// menu-continue-local-session.contract.test.mjs - Etappe 4, Paket C:
// frisches Profil startet als Einzelspieler; "Weiterspielen" setzt die letzte lokale Sitzung
// fort (auch aus Mehrspieler) und schickt bei fehlenden Gamepads in die Zentrale.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { handleQuickStartLastStartAction } from '../src/core/runtime/MenuRuntimeQuickStartService.js';
import { findFixedMenuPresetSeedById } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import { resolveMapPreview, resolveVehiclePreview } from '../src/ui/menu/MenuPreviewCatalog.js';
import { ensureMenuContractState, resolveContinueSessionType } from '../src/ui/menu/MenuStateContracts.js';
import { renderStartSetupSummaryAndPreview } from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';
import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';
import { MENU_SCREEN_PANEL_IDS } from './support/menu-screens.js';

function createManager() {
    return new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
}

function createGame(manager, localOverrides = {}) {
    const settings = manager.createDefaultSettings();
    Object.assign(settings.localSettings, localOverrides);
    const calls = { panels: [], toasts: [], validation: [], start: 0, changed: 0 };
    const game = {
        settings,
        settingsManager: manager,
        uiManager: {
            _runtimeFeatureFlags: { surfacePolicy: { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP } },
            menuNavigationRuntime: { showPanel: (panel, meta) => calls.panels.push({ panel, meta }) },
            showStartValidationError: (issue) => calls.validation.push(issue),
        },
        _showStatusToast: (message) => calls.toasts.push(message),
    };
    const ctx = {
        game,
        onSettingsChanged: () => { calls.changed += 1; },
        recordMenuTelemetry() {},
        startMatch: () => { calls.start += 1; return true; },
        getMultiplayerSessionState: () => null,
    };
    return { game, ctx, calls };
}

function saveLocalDraft(manager, settings, sessionType) {
    const currentSessionType = settings.localSettings.sessionType;
    settings.localSettings.sessionType = sessionType;
    settings.mode = sessionType === 'splitscreen' ? '2p' : '1p';
    assert.equal(manager.saveSessionDraft(settings, sessionType).success, true);
    settings.localSettings.sessionType = currentSessionType;
    settings.mode = '1p';
}

test('a fresh profile starts as single player', () => {
    const settings = createManager().createDefaultSettings();
    assert.equal(settings.mode, '1p');
    assert.equal(settings.localSettings.sessionType, 'single');
    assert.equal(settings.localSettings.lastLocalSessionType, 'single');
});

test('the competitive preset keeps its locked two-player, zero-bot setup', () => {
    const preset = findFixedMenuPresetSeedById('competitive');
    assert.equal(preset.values.mode, '2p');
    assert.equal(preset.values.numBots, 0);
    assert.ok(preset.lockedFields.includes('mode'));
    assert.ok(preset.lockedFields.includes('numBots'));
});

test('a stored split screen profile keeps its session type', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    const stored = manager.sanitizeSettings({
        ...defaults, mode: '2p', localSettings: { ...defaults.localSettings, sessionType: 'splitscreen' },
    });
    assert.equal(stored.mode, '2p');
    assert.equal(stored.localSettings.sessionType, 'splitscreen');
    assert.equal(stored.localSettings.lastLocalSessionType, 'splitscreen');
});

test('the last local session type is remembered across a multiplayer session and survives the normalizer', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    manager.switchSessionType(settings, 'splitscreen');
    manager.switchSessionType(settings, 'multiplayer');
    assert.equal(settings.localSettings.sessionType, 'multiplayer');
    assert.equal(settings.localSettings.lastLocalSessionType, 'splitscreen');

    ensureMenuContractState(settings);
    assert.equal(settings.localSettings.lastLocalSessionType, 'splitscreen');
    assert.equal(resolveContinueSessionType(settings.localSettings), 'splitscreen');

    const reloaded = manager.sanitizeSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(reloaded.localSettings.lastLocalSessionType, 'splitscreen');

    manager.switchSessionType(settings, 'single');
    assert.equal(settings.localSettings.lastLocalSessionType, 'single');
    assert.equal(resolveContinueSessionType({ sessionType: 'multiplayer', lastLocalSessionType: 'bogus' }), 'single');
});

test('Weiterspielen from multiplayer resumes the last local session and starts it', async () => {
    const manager = createManager();
    const { game, ctx, calls } = createGame(manager, { sessionType: 'multiplayer', lastLocalSessionType: 'single' });
    saveLocalDraft(manager, game.settings, 'single');
    const started = await handleQuickStartLastStartAction(ctx);
    assert.equal(started, true);
    assert.equal(game.settings.localSettings.sessionType, 'single');
    assert.equal(game.settings.mode, '1p');
    assert.equal(calls.start, 1);
    assert.equal(calls.panels.length, 0, 'the lobby is not opened');
});

test('Weiterspielen with no saved local draft opens local setup without starting network choices', async () => {
    const { game, ctx, calls } = createGame(createManager(), { sessionType: 'multiplayer', lastLocalSessionType: 'single' });
    game.settings.mapKey = 'maze';
    game.settings.vehicles.PLAYER_1 = 'ship1';
    const before = JSON.stringify(game.settings);
    const started = await handleQuickStartLastStartAction(ctx);
    assert.equal(started, false);
    assert.equal(calls.start, 0);
    assert.equal(calls.changed, 0);
    assert.equal(JSON.stringify(game.settings), before);
    assert.deepEqual(calls.panels.map((entry) => entry.panel), [MENU_SCREEN_PANEL_IDS.modeChoice]);
    assert.ok(calls.toasts.some((message) => /Lokale Sitzung einrichten/.test(message)));
});

test('stale local draft metadata cannot start or replace the multiplayer setup', async () => {
    const { game, ctx, calls } = createGame(createManager(), { sessionType: 'multiplayer', lastLocalSessionType: 'single' });
    game.settings.localSettings.draftStateBySessionType.single = {
        mapKey: 'standard', vehicleP1: 'ship5',
    };
    game.settings.mapKey = 'maze';
    const before = JSON.stringify(game.settings);
    assert.equal(await handleQuickStartLastStartAction(ctx), false);
    assert.equal(calls.start, 0);
    assert.equal(calls.changed, 0);
    assert.equal(JSON.stringify(game.settings), before);
    assert.deepEqual(calls.panels.map((entry) => entry.panel), [MENU_SCREEN_PANEL_IDS.modeChoice]);
});

test('a failed draft save keeps the multiplayer setup and prevents Continue from starting', async () => {
    let failWrites = false;
    const manager = new SettingsManager({
        storagePlatform: createMemoryStoragePlatform({}, {
            writeJson: (key, value, records) => {
                if (failWrites) return { ok: false, reason: 'quota_exceeded', quotaExceeded: true };
                records.set(key, value);
                return { ok: true, reason: 'ok', quotaExceeded: false };
            },
        }),
    });
    const { game, ctx, calls } = createGame(manager, { sessionType: 'multiplayer', lastLocalSessionType: 'single' });
    saveLocalDraft(manager, game.settings, 'single');
    game.settings.mapKey = 'maze';
    game.settings.vehicles.PLAYER_1 = 'ship1';
    const before = JSON.stringify(game.settings);
    failWrites = true;
    const started = await handleQuickStartLastStartAction(ctx);
    assert.equal(started, false);
    assert.equal(calls.start, 0);
    assert.equal(calls.changed, 0);
    assert.deepEqual(calls.panels, []);
    assert.equal(JSON.stringify(game.settings), before);
    assert.ok(calls.toasts.some((message) => /nicht gespeichert/.test(message)));
    const switchResult = manager.switchSessionType(game.settings, 'single');
    assert.equal(switchResult.success, false);
    assert.equal(switchResult.reason, 'current_draft_save_failed');
    assert.equal(JSON.stringify(game.settings), before);
});

test('Weiterspielen still returns to a lobby the player has already joined', async () => {
    const { game, ctx, calls } = createGame(createManager(), { sessionType: 'multiplayer', lastLocalSessionType: 'single' });
    ctx.getMultiplayerSessionState = () => ({ joined: true });
    const started = await handleQuickStartLastStartAction(ctx);
    assert.equal(started, false);
    assert.equal(game.settings.localSettings.sessionType, 'multiplayer');
    assert.deepEqual(calls.panels.map((entry) => entry.panel), [MENU_SCREEN_PANEL_IDS.lobby]);
    assert.equal(calls.start, 0);
});

test('Weiterspielen on split screen without gamepads opens the hub with a hint instead of failing', async () => {
    const manager = createManager();
    const { game, ctx, calls } = createGame(manager, { sessionType: 'multiplayer', lastLocalSessionType: 'splitscreen' });
    saveLocalDraft(manager, game.settings, 'splitscreen');
    game.settings.controls.SPLITSCREEN.layout = 'controller-keyboard';
    ctx.getGamepad = () => null;
    const started = await handleQuickStartLastStartAction(ctx);
    assert.equal(started, false);
    assert.equal(game.settings.localSettings.sessionType, 'splitscreen');
    assert.equal(calls.start, 0);
    assert.deepEqual(calls.panels.map((entry) => entry.panel), [MENU_SCREEN_PANEL_IDS.modeChoice]);
    assert.match(calls.validation[0]?.fieldMessage || '', /Gamepad/);
    assert.equal(calls.validation[0]?.fieldKey, 'players');
    assert.ok(calls.toasts.some((message) => /Gamepad/.test(message)));
    assert.ok(!calls.toasts.some((message) => /Schnellstart fehlgeschlagen/.test(message)));
});

test('Weiterspielen on split screen starts once the gamepad is connected', async () => {
    const { game, ctx, calls } = createGame(createManager(), { sessionType: 'splitscreen' });
    game.settings.controls.SPLITSCREEN.layout = 'controller-keyboard';
    ctx.getGamepad = () => ({ connected: true });
    assert.equal(await handleQuickStartLastStartAction(ctx), true);
    assert.equal(calls.start, 1);
    assert.equal(calls.panels.length, 0);
});

test('the Weiterspielen button and summary name the local session while multiplayer is selected', () => {
    const previousDocument = globalThis.document;
    const element = () => {
        const node = {
            children: [], textContent: '', dataset: {}, classList: { add() {} }, setAttribute() {},
            appendChild(child) { this.children.push(child); },
            removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
        };
        Object.defineProperty(node, 'firstChild', { get() { return this.children[0] || null; } });
        return node;
    };
    globalThis.document = { createElement: element };
    try {
        const settings = createManager().createDefaultSettings();
        settings.localSettings.sessionType = 'multiplayer';
        settings.localSettings.lastLocalSessionType = 'splitscreen';
        settings.mapKey = 'standard';
        settings.vehicles.PLAYER_1 = 'ship1';
        settings.localSettings.modePath = 'fight';
        settings.gameMode = 'HUNT';
        settings.numBots = 8;
        settings.localSettings.draftStateBySessionType.splitscreen = {
            modePath: 'normal',
            mapKey: 'clockwork_canyon',
            vehicleP1: 'ship5',
        };
        const label = element();
        const render = (hasActiveLobbySession) => {
            const quickStartLastSummary = element();
            renderStartSetupSummaryAndPreview({
                ui: { menuSummary: element(), quickStartLastSummary, quickStartLastButton: { querySelector: () => label } },
                settings, sessionType: 'multiplayer', modePath: 'normal', effectiveMapKey: 'standard',
                surfaceEntryCopy: { sessionSummaryLabels: {} }, sessionContract: { transportAudienceLabel: 'LAN' },
                resolvedMultiplayerSessionState: { lobbyCode: 'ABC', readyCount: 0, memberCount: 1 }, hasActiveLobbySession,
                ghostDuelState: { effectiveMode: 'off', duelSelectable: false, effectiveTrailCollisionEnabled: false, trailCollisionSelectable: false },
            });
            return quickStartLastSummary.textContent;
        };
        const continueSummary = render(false);
        assert.match(continueSummary, /^Geteilter Bildschirm ·/);
        assert.ok(continueSummary.includes(resolveMapPreview('clockwork_canyon').name));
        assert.ok(!continueSummary.includes(resolveMapPreview('standard').name));
        assert.ok(continueSummary.includes(resolveVehiclePreview('ship5', 'normal').label));
        assert.ok(!continueSummary.includes(resolveVehiclePreview('ship1', 'normal').label));
        assert.ok(!continueSummary.includes('Bots'));
        assert.ok(!continueSummary.includes('Kampf'));
        assert.equal(label.textContent, 'Weiterspielen');
        render(true);
        assert.equal(label.textContent, 'Zur Lobby');
    } finally {
        globalThis.document = previousDocument;
    }
});
