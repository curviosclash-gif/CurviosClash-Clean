import assert from 'node:assert/strict';
import test from 'node:test';

import { bindMenuMultiplayerActionButtons } from '../src/ui/menu/MenuMultiplayerActionBindings.js';

function createButton() {
    const handlers = new Map();
    return {
        handlers,
        addEventListener(type, handler) {
            handlers.set(type, handler);
        },
        click() {
            handlers.get('click')?.();
        },
    };
}

test('LAN multiplayer join button forwards lobbyCode plus optional manual signalingUrl', () => {
    const emitted = [];
    const joinButton = createButton();
    bindMenuMultiplayerActionButtons({
        ui: {
            multiplayerJoinButton: joinButton,
            multiplayerLobbyCodeInput: { value: 'LAN-QA' },
            multiplayerHostAddressInput: { value: 'localhost:9090' },
        },
        bind: (el, event, handler) => el.addEventListener(event, handler),
        emit: (eventType, payload) => emitted.push({ eventType, payload }),
        eventTypes: {
            MULTIPLAYER_JOIN: 'multiplayer_join',
        },
        featureFlags: {},
    });

    joinButton.click();

    assert.deepEqual(emitted, [{
        eventType: 'multiplayer_join',
        payload: {
            lobbyCode: 'LAN-QA',
            signalingUrl: 'localhost:9090',
        },
    }]);
});
