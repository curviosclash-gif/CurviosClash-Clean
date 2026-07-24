import assert from 'node:assert/strict';
import test from 'node:test';

import {
    handleLevel4ResetAction,
    handleQuickStartLastStartAction,
    handleQuickStartRandomStartAction,
    handleSessionTypeChangeAction,
    resolveProductiveMultiplayerTransport,
} from '../src/core/runtime/MenuRuntimeSessionService.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import { MULTIPLAYER_TRANSPORTS } from '../src/shared/contracts/RuntimeSessionContract.js';

function createGame(multiplayerTransport = '') {
    return {
        settings: {
            localSettings: {
                multiplayerTransport,
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: {
                    productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
                },
            },
        },
    };
}

function createSessionSwitchGame(productSurfaceId = PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP) {
    const calls = {
        switchSessionType: [],
        settingsChanged: [],
        toasts: [],
    };
    const game = {
        settings: {
            mode: '1p',
            localSettings: {
                sessionType: 'single',
                multiplayerTransport: '',
            },
        },
        settingsManager: {
            switchSessionType(settings, sessionType) {
                calls.switchSessionType.push(sessionType);
                settings.localSettings.sessionType = sessionType;
                settings.mode = sessionType === 'splitscreen' ? '2p' : '1p';
                return {
                    success: true,
                    targetSessionType: sessionType,
                    loadedDraft: false,
                    changedKeys: ['localSettings.sessionType', 'mode'],
                };
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: {
                    productSurfaceId,
                },
            },
        },
        _showStatusToast(message, duration, tone) {
            calls.toasts.push({ message, duration, tone });
        },
    };
    return { game, calls };
}

function createQuickStartGame(productSurfaceId = PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP) {
    const calls = {
        settingsChanged: [],
        telemetry: [],
        startMatch: 0,
        toasts: [],
    };
    const game = {
        settings: {
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: {
                    productSurfaceId,
                },
            },
        },
        _showStatusToast(message, duration, tone) {
            calls.toasts.push({ message, duration, tone });
        },
    };
    return { game, calls };
}

test('resolveProductiveMultiplayerTransport falls back to LAN when online is selected without configured signaling', () => {
    const previousSignalingUrl = globalThis.__SIGNALING_URL__;
    const hadOwnSignalingUrl = Object.prototype.hasOwnProperty.call(globalThis, '__SIGNALING_URL__');
    delete globalThis.__SIGNALING_URL__;

    try {
        const resolved = resolveProductiveMultiplayerTransport(
            createGame(MULTIPLAYER_TRANSPORTS.ONLINE),
            MULTIPLAYER_TRANSPORTS.ONLINE
        );
        assert.equal(resolved, MULTIPLAYER_TRANSPORTS.LAN);
    } finally {
        if (hadOwnSignalingUrl) {
            globalThis.__SIGNALING_URL__ = previousSignalingUrl;
        } else {
            delete globalThis.__SIGNALING_URL__;
        }
    }
});

test('resolveProductiveMultiplayerTransport keeps online when signaling is configured', () => {
    const previousSignalingUrl = globalThis.__SIGNALING_URL__;
    const hadOwnSignalingUrl = Object.prototype.hasOwnProperty.call(globalThis, '__SIGNALING_URL__');
    globalThis.__SIGNALING_URL__ = 'wss://signal.example.test';

    try {
        const resolved = resolveProductiveMultiplayerTransport(
            createGame(MULTIPLAYER_TRANSPORTS.ONLINE),
            MULTIPLAYER_TRANSPORTS.ONLINE
        );
        assert.equal(resolved, MULTIPLAYER_TRANSPORTS.ONLINE);
    } finally {
        if (hadOwnSignalingUrl) {
            globalThis.__SIGNALING_URL__ = previousSignalingUrl;
        } else {
            delete globalThis.__SIGNALING_URL__;
        }
    }
});

test('handleSessionTypeChangeAction keeps desktop splitscreen instead of browser-demo fallback', () => {
    const { game, calls } = createSessionSwitchGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    handleSessionTypeChangeAction({
        game,
        event: { sessionType: 'splitscreen' },
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
    });

    assert.deepEqual(calls.switchSessionType, ['splitscreen']);
    assert.equal(game.settings.localSettings.sessionType, 'splitscreen');
    assert.equal(game.settings.mode, '2p');
    assert.equal(calls.settingsChanged.length, 1);
    assert.match(calls.toasts[0]?.message || '', /Geteilter Bildschirm/);
});

test('handleQuickStartLastStartAction preserves the last desktop mode', async () => {
    const { game, calls } = createQuickStartGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);
    game.settings.localSettings.modePath = 'arcade';

    const started = await handleQuickStartLastStartAction({
        game,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        recordMenuTelemetry(type, payload) {
            calls.telemetry.push({ type, payload });
        },
        startMatch() {
            calls.startMatch += 1;
            return true;
        },
    });

    assert.equal(started, true);
    assert.equal(game.settings.localSettings.modePath, 'arcade');
    assert.equal(calls.settingsChanged.length, 0);
    assert.equal(calls.telemetry[0]?.type, 'quickstart');
    assert.equal(calls.startMatch, 1);
    assert.match(calls.toasts[0]?.message || '', /letzte Einstellungen/);
});

test('handleQuickStartLastStartAction reports no success when match start is rejected', async () => {
    const { game, calls } = createQuickStartGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    const started = await handleQuickStartLastStartAction({
        game,
        recordMenuTelemetry(type, payload) {
            calls.telemetry.push({ type, payload });
        },
        startMatch() {
            calls.startMatch += 1;
            return false;
        },
    });

    assert.equal(started, false);
    assert.equal(calls.startMatch, 1);
    assert.deepEqual(calls.telemetry, []);
    assert.equal(calls.toasts.length, 1);
    assert.match(calls.toasts[0]?.message || '', /Schnellstart fehlgeschlagen/);
    assert.equal(calls.toasts[0]?.tone, 'error');
});

test('handleQuickStartRandomStartAction awaits match start before telemetry and success toast', async () => {
    const { game, calls } = createQuickStartGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    const started = await handleQuickStartRandomStartAction({
        game,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        recordMenuTelemetry(type, payload) {
            calls.telemetry.push({ type, payload });
        },
        startMatch() {
            calls.startMatch += 1;
            return true;
        },
    });

    assert.equal(started, true);
    assert.equal(game.settings.localSettings.modePath, 'quick_action');
    assert.equal(calls.settingsChanged.length, 1);
    assert.equal(calls.startMatch, 1);
    assert.equal(calls.telemetry[0]?.type, 'quickstart');
    assert.equal(calls.telemetry[0]?.payload?.variant, 'random_map');
    assert.equal(calls.telemetry[0]?.payload?.mapKey, game.settings.mapKey);
    assert.match(calls.toasts[0]?.message || '', /Random Map/);
});

test('handleQuickStartRandomStartAction reports no success when match start is rejected', async () => {
    const { game, calls } = createQuickStartGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    const started = await handleQuickStartRandomStartAction({
        game,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        recordMenuTelemetry(type, payload) {
            calls.telemetry.push({ type, payload });
        },
        startMatch() {
            calls.startMatch += 1;
            return false;
        },
    });

    assert.equal(started, false);
    assert.equal(calls.startMatch, 1);
    assert.deepEqual(calls.telemetry, []);
    assert.equal(calls.toasts.length, 1);
    assert.match(calls.toasts[0]?.message || '', /Schnellstart fehlgeschlagen/);
    assert.equal(calls.toasts[0]?.tone, 'error');
});

test('handleQuickStartRandomStartAction handles a rejecting match start without unhandled rejection', async () => {
    const { game, calls } = createQuickStartGame(PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);

    const started = await handleQuickStartRandomStartAction({
        game,
        onSettingsChanged(payload) {
            calls.settingsChanged.push(payload);
        },
        recordMenuTelemetry(type, payload) {
            calls.telemetry.push({ type, payload });
        },
        startMatch() {
            calls.startMatch += 1;
            return Promise.reject(new Error('boom'));
        },
    });

    assert.equal(started, false);
    assert.equal(calls.startMatch, 1);
    assert.deepEqual(calls.telemetry, []);
    assert.match(calls.toasts[0]?.message || '', /Interner Fehler/);
    assert.equal(calls.toasts[0]?.tone, 'error');
});

test('handleLevel4ResetAction resets only the options shown in the gameplay panel', () => {
    const defaults = {
        gameplay: { speed: 35, portalCount: 8 },
        controls: { PLAYER_1: { LEFT: 'KeyA' } },
        localSettings: { shadowQuality: 3 },
        portalsEnabled: true,
        autoRoll: true,
        invertPitch: { PLAYER_1: true, PLAYER_2: true },
        cockpitCamera: { PLAYER_1: true, PLAYER_2: true },
        cameraPerspective: { normal: 'classic', reduceMotion: true },
        recording: { profile: 'standard', hudMode: 'clean' },
    };
    const changed = [];
    const toasts = [];
    const game = {
        settings: {
            gameplay: { speed: 12, portalCount: 2 },
            controls: { PLAYER_1: { LEFT: 'ArrowLeft' } },
            localSettings: { shadowQuality: 0 },
            portalsEnabled: false,
            autoRoll: false,
            invertPitch: { PLAYER_1: false, PLAYER_2: false },
            cockpitCamera: { PLAYER_1: false, PLAYER_2: false },
            cameraPerspective: { normal: 'cinematic_action', reduceMotion: false },
            recording: { profile: 'youtube_short', hudMode: 'with_hud' },
        },
        settingsManager: {
            createDefaultSettings: () => structuredClone(defaults),
        },
        _showStatusToast(message, duration, tone) {
            toasts.push({ message, duration, tone });
        },
    };

    handleLevel4ResetAction({
        game,
        onSettingsChanged(payload) {
            changed.push(payload);
        },
    });

    assert.deepEqual(game.settings.gameplay, defaults.gameplay);
    assert.deepEqual(game.settings.cameraPerspective, defaults.cameraPerspective);
    assert.deepEqual(game.settings.recording, defaults.recording);
    assert.deepEqual(game.settings.controls, { PLAYER_1: { LEFT: 'ArrowLeft' } });
    assert.equal(game.settings.portalsEnabled, false);
    assert.equal(changed.length, 1);
    assert.match(toasts[0]?.message || '', /Spieloptionen zurückgesetzt/);
});
