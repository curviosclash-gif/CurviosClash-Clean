import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

import { createLANSignalingServer, resolveLanLobbyPublicHostName } from '../server/lan-signaling.js';
import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { SIGNALING_HTTP_ROUTES } from '../src/shared/contracts/SignalingSessionContract.js';

test('the network search names the host by its lobby name, else "<profile> 1"', () => {
    assert.equal(resolveLanLobbyPublicHostName({ hostLobbyName: 'Kapitän', metadata: { hostName: 'Spieler 1' } }), 'Kapitän');
    assert.equal(resolveLanLobbyPublicHostName({ hostLobbyName: '', metadata: { hostName: 'Spieler 1' } }), 'Spieler 1 1');
    assert.equal(resolveLanLobbyPublicHostName({ hostName: 'Nova' }), 'Nova 1');
    assert.equal(resolveLanLobbyPublicHostName(null), 'Spieler 1');
});

test('the discovery answer and the desktop broadcast both use the public host name', async () => {
    const { server } = createLANSignalingServer(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    const host = new LANMatchLobby({ signalingUrl: url });
    host._startPolling = () => {};
    try {
        await host.create({ actorId: 'profile-host', name: 'Spieler 1', lobbyName: 'Kapitän', metadata: { hostName: 'Spieler 1' } });
        const info = await (await fetch(`${url}${SIGNALING_HTTP_ROUTES.DISCOVERY_INFO}?lobbyCode=${host.lobbyCode}`)).json();
        assert.equal(info.hostName, 'Kapitän');
    } finally {
        host.dispose();
        await new Promise((resolve) => setTimeout(resolve, 100));
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(mainSource, /resolveLanLobbyPublicHostName\(runtime\.lobby\)/);
});
