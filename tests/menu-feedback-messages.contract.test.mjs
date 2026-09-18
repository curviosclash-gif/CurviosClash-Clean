import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { bindBuildInfoCopy } from '../src/ui/menu/MenuClipboardCopy.js';
import { importMenuConfigFromInput } from '../src/ui/menu/MenuConfigShareOps.js';
import { PlayerProfileUiController, resolvePlayerProfileReasonMessage } from '../src/ui/PlayerProfileUiController.js';
import { NetworkLobbyService } from '../src/application/session-runtime/NetworkLobbyService.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { beginMultiplayerAction } from '../src/core/runtime/MenuRuntimeMultiplayerUiFeedback.js';

test('importing text without any known setting changes nothing and says so', () => {
    const settings = { mapKey: 'maze', autoRoll: true, numBots: 5, localSettings: { sessionType: 'single' } };
    const before = JSON.stringify(settings);
    const code = Buffer.from(JSON.stringify({ hallo: 'welt' })).toString('base64');
    const result = importMenuConfigFromInput(settings, code);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_known_settings');
    assert.match(result.message, /Nichts wurde übernommen/);
    assert.equal(JSON.stringify(settings), before, 'no value was reset to a default');
});

test('an import file without a profile explains itself instead of showing invalid_root', () => {
    assert.doesNotMatch(resolvePlayerProfileReasonMessage('invalid_root'), /invalid_root/);
    assert.match(resolvePlayerProfileReasonMessage('invalid_root'), /Spielerprofil/);
});

test('typing a player name up to the limit tells the player about the limit', () => {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) {
            const handlers = {};
            elements.set(id, { id, value: '', textContent: '', dataset: {}, addEventListener: (type, fn) => { handlers[type] = fn; }, fire: (type) => handlers[type]?.() });
        }
        return elements.get(id);
    };
    const getElementById = (id) => (['player-profile-name', 'player-profile-status'].includes(id) ? element(id) : null);
    const controller = new PlayerProfileUiController({ document: { getElementById }, playerProfileManager: null });
    controller.init();
    const name = element('player-profile-name');
    name.value = 'x'.repeat(32);
    name.fire('input');
    assert.match(element('player-profile-status').textContent, /32 Zeichen/);
    name.value = 'Kurz';
    name.fire('input');
    assert.equal(element('player-profile-status').textContent, '');
});

test('a lobby join has a time limit and can be cancelled while it runs', async (t) => {
    const originalFetch = globalThis.fetch;
    let release = null;
    let joinSignal = null;
    globalThis.fetch = (url, init = {}) => {
        joinSignal = init.signal || null;
        return new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ playerId: 'peer-b', playerToken: 't', sessionState: { lobbyCode: 'ABCD1234', members: [] } }) }); });
    };
    t.after(() => { globalThis.fetch = originalFetch; });
    let lobby = null;
    const service = new NetworkLobbyService({
        runtime: { global: {} },
        discoveryPort: null,
        resolveJoinSignalingUrl: () => 'http://127.0.0.1:9',
        createLobby: (signalingUrl) => { lobby = new LANMatchLobby({ signalingUrl }); return lobby; },
    });
    const pending = service.join({ actorId: 'profile-b', name: 'Spieler 1', lobbyCode: 'ABCD1234' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(joinSignal instanceof AbortSignal, 'the join request carries a timeout signal');
    service.leave();
    release();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, 'join_cancelled');
    assert.equal(lobby._pollingTimer, null, 'a cancelled join does not start polling afterwards');
});

test('while a join is searching the cancel button is shown, afterwards hidden again', () => {
    const classes = new Set(['hidden']);
    const cancel = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    const game = { ui: { multiplayerCancelJoinButton: cancel, multiplayerStatus: { textContent: '' } } };
    const finish = beginMultiplayerAction(game, 'Lobby wird gesucht …', { cancellable: true });
    assert.equal(classes.has('hidden'), false);
    finish();
    assert.equal(classes.has('hidden'), true);
});

function createButton() {
    const handlers = new Map();
    return { handlers, addEventListener(type, handler) { handlers.set(type, handler); }, click() { return handlers.get('click')?.(); } };
}

test('"Build-Info kopieren" copies the build details and confirms it', async () => {
    const copied = [];
    const emitted = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text) => copied.push(text) } } });
    try {
        const copyBuildButton = createButton();
        bindBuildInfoCopy({
            ui: { copyBuildButton, buildInfoDetail: { textContent: 'Version: v1.2.3\nBuild-ID: abc' } },
            emit: (type, payload) => emitted.push({ type, payload }),
            bind: (el, type, handler) => el.addEventListener(type, handler),
            eventTypes: { SHOW_STATUS_TOAST: 'show_status_toast' },
        });
        await copyBuildButton.click();
        assert.deepEqual(copied, ['Version: v1.2.3\nBuild-ID: abc']);
        assert.equal(emitted.at(-1).payload.message, 'Build-Info kopiert.');
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
    }
    const extras = readFileSync(new URL('../src/ui/menu/MenuExtrasBindings.js', import.meta.url), 'utf8');
    assert.match(extras, /bindBuildInfoCopy\(/, 'the menu wires the copy button');
});
