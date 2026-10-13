// Menü-Umbau Etappe 3, Paket B: reine Logik der Pause, des Ergebnis-Knopfs und des Ladebildschirms.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LOADING_TIPS,
    decideGamepadDisconnectPause,
    pickLoadingTip,
    resolveGamepadOwnerPlayer,
    resolveMenuReturnTarget,
    resolvePauseControlRows,
    resolvePauseLobbyRole,
} from '../src/ui/PauseMenuText.js';
import { resolveMenuVisibility } from '../src/shared/contracts/MenuVisibilityContract.js';

test('result menu button is named after where it leads', () => {
    assert.equal(resolveMenuReturnTarget({ sessionType: 'single' }).resultLabel, 'Zum freien Spiel');
    assert.equal(resolveMenuReturnTarget({ sessionType: 'single', arcade: true }).resultLabel, 'Zur Arcade-Reise');
    assert.equal(resolveMenuReturnTarget({ sessionType: 'multiplayer' }).resultLabel, 'Zur Lobby');
    assert.equal(resolveMenuReturnTarget({ sessionType: 'splitscreen' }).resultLabel, 'Zur Spielauswahl');
    assert.equal(resolveMenuReturnTarget(null).resultLabel, 'Zum freien Spiel');
});

test('pause leave button names its destination', () => {
    assert.equal(resolveMenuReturnTarget({ sessionType: 'multiplayer' }).pauseHint, 'zurück zur Lobby');
    assert.equal(resolveMenuReturnTarget({ sessionType: 'single' }).pauseHint, 'zurück zur Spielauswahl');
    assert.equal(resolveMenuReturnTarget({ sessionType: 'splitscreen' }).pauseHint, 'zurück zur Spielauswahl');
});

test('restart in the pause is hidden for network guests only', () => {
    const visible = (settings, snapshot) => resolveMenuVisibility({
        sessionType: settings.sessionType,
        lobbyRole: resolvePauseLobbyRole(settings.sessionType, snapshot),
    }).visible.pauseRestart;
    assert.equal(visible({ sessionType: 'single' }, null), true);
    assert.equal(visible({ sessionType: 'splitscreen' }, { isHost: false }), true);
    assert.equal(visible({ sessionType: 'multiplayer' }, { isHost: true }), true);
    assert.equal(visible({ sessionType: 'multiplayer' }, { isHost: false }), false);
});

function settingsOf(sessionType, extra = {}) {
    return {
        localSettings: { sessionType, ...(extra.localSettings || {}) },
        controls: { SPLITSCREEN: { layout: extra.layout || 'auto' }, GAMEPAD: { enabled: extra.padsEnabled !== false } },
    };
}

test('a pad belongs to the local player that it steers', () => {
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('single'), 0), 1);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('single'), 1), 0);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('splitscreen', { layout: 'controller-controller' }), 1), 2);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('splitscreen', { layout: 'keyboard-controller' }), 0), 2);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('splitscreen', { layout: 'controller-keyboard' }), 0), 1);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('splitscreen', { layout: 'keyboard-keyboard' }), 0), 0);
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('multiplayer'), 0), 0, 'never in network play');
    assert.equal(resolveGamepadOwnerPlayer(settingsOf('single', { padsEnabled: false }), 0), 0);
});

test('three-player split maps pads through the device assignment', () => {
    const settings = settingsOf('splitscreen', {
        localSettings: {
            splitScreenVariant: 'three_player',
            threePlayerSplit: { deviceAssignment: ['keyboard', 'gamepad-1', 'gamepad-2'] },
        },
    });
    assert.equal(resolveGamepadOwnerPlayer(settings, 0), 2);
    assert.equal(resolveGamepadOwnerPlayer(settings, 1), 3);
    assert.equal(resolveGamepadOwnerPlayer(settings, 2), 0);
});

test('auto-pause only while the match is playing and never for guests', () => {
    const settings = settingsOf('splitscreen', { layout: 'controller-controller' });
    assert.deepEqual(
        decideGamepadDisconnectPause({ settings, padIndex: 1, gameState: 'PLAYING' }),
        { pause: true, playerNumber: 2, notice: 'Controller von Spieler 2 getrennt' }
    );
    assert.equal(decideGamepadDisconnectPause({ settings, padIndex: 1, gameState: 'PAUSED' }).pause, false);
    assert.equal(decideGamepadDisconnectPause({ settings, padIndex: 1, gameState: 'MENU' }).pause, false);
    assert.equal(decideGamepadDisconnectPause({ settings, padIndex: 3, gameState: 'PLAYING' }).pause, false);
    assert.equal(decideGamepadDisconnectPause({
        settings: settingsOf('multiplayer'), padIndex: 0, gameState: 'PLAYING',
    }).pause, false);
});

test('loading tip is deterministic per map key and always from the list', () => {
    assert.ok(LOADING_TIPS.length >= 4);
    assert.equal(pickLoadingTip('standard'), pickLoadingTip('standard'));
    const seen = new Set(['standard', 'mega_maze', 'reactor_site', 'notre_dame', 'sky_ladder_1', 'x'].map(pickLoadingTip));
    assert.ok(seen.size > 1, 'different maps do not all show the same tip');
    for (const tip of seen) assert.ok(LOADING_TIPS.includes(tip));
    assert.ok(LOADING_TIPS.includes(pickLoadingTip(undefined)));
});

test('controls overview lists the keys of every local player', () => {
    const controls = {
        PLAYER_1: { UP: 'KeyW', DOWN: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD', BOOST: 'ShiftLeft', SLOWMO: 'KeyQ',
            SHOOT: 'Space', SHOOT_MG: 'KeyF', USE_ITEM: 'KeyE', NEXT_ITEM: 'KeyR', CAMERA: 'KeyC',
            ROLL_LEFT: 'KeyZ', ROLL_RIGHT: 'KeyX' },
        PLAYER_2: { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' },
    };
    const single = resolvePauseControlRows({ controls, localSettings: { sessionType: 'single' } });
    assert.equal(single.length, 1);
    const steer = single[0].rows.find((row) => row.label === 'Lenken');
    assert.deepEqual(steer.keys, ['A', 'D']);
    assert.deepEqual(single[0].rows.find((row) => row.label === 'Boost').keys, ['Umsch']);
    const split = resolvePauseControlRows({ controls, localSettings: { sessionType: 'splitscreen' } });
    assert.equal(split.length, 2);
    assert.equal(split[1].title, 'Spieler 2');
    assert.deepEqual(split[1].rows.find((row) => row.label === 'Lenken').keys, ['←', '→']);
    assert.equal(single[0].title, '');
});

test('loading screen shows the map name and a tip', async () => {
    const { buildLoadingMessages } = await import('../src/ui/PauseMenuText.js');
    const messages = buildLoadingMessages('mega_maze', 'Mega Maze');
    assert.equal(messages.messageText, 'Lade Mega Maze...');
    assert.equal(messages.messageSub, `Tipp: ${pickLoadingTip('mega_maze')}`);
    assert.deepEqual(buildLoadingMessages('mega_maze', 'Mega Maze'), messages, 'same map, same text');
    assert.equal(buildLoadingMessages('standard', '').messageText, 'Lade standard...', 'falls back to the key');
});
