import assert from 'node:assert/strict';
import test from 'node:test';

import { handleMultiplayerJoinAction } from '../src/core/runtime/MenuRuntimeMultiplayerService.js';
import { LOBBY_SERVICE_TRANSPORTS } from '../src/shared/contracts/LobbyServiceContract.js';
import { MULTIPLAYER_TRANSPORTS } from '../src/shared/contracts/RuntimeSessionContract.js';

test('LAN join action forwards manual signalingUrl and writes failed joins into UI status', async () => {
    const calls = [];
    const game = {
        settings: {
            localSettings: {
                multiplayerTransport: MULTIPLAYER_TRANSPORTS.LAN,
            },
        },
        ui: {
            multiplayerStatus: { textContent: '' },
        },
        _showStatusToast(message, duration, tone) {
            calls.push(['toast', message, duration, tone]);
        },
    };
    const menuMultiplayerBridge = {
        transport: LOBBY_SERVICE_TRANSPORTS.LAN,
        join(options) {
            calls.push(['join', options]);
            return {
                ok: false,
                code: 'manual_signaling_url_invalid',
                message: 'Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.',
            };
        },
    };

    const result = await handleMultiplayerJoinAction({
        game,
        event: {
            lobbyCode: 'LAN-QA',
            signalingUrl: 'localhost:9090',
        },
        resolveMenuAccessContext: () => ({ actorId: 'Client' }),
        menuMultiplayerBridge,
        syncUiState: () => calls.push(['sync']),
        runtimeSource: null,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(calls[0], ['join', {
        actorId: 'Client',
        lobbyCode: 'LAN-QA',
        signalingUrl: 'localhost:9090',
    }]);
    assert.equal(game.ui.multiplayerStatus.textContent, 'Join fehlgeschlagen: Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.');
    assert.deepEqual(calls[1], ['toast', 'Host-Adresse ungueltig. Bitte Host:Port verwenden, z. B. localhost:9090.', 1800, 'error']);
    assert.equal(calls.some(([type]) => type === 'sync'), false);
});
