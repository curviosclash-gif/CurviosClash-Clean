import assert from 'node:assert/strict';
import test from 'node:test';

import { createNetworkLobbyDiscoveryPort } from '../src/application/session-runtime/NetworkLobbyDiscoveryPort.js';
import { listDiscoveredNetworkLobbies } from '../src/application/session-runtime/NetworkLobbyExperienceSupport.js';

function createRuntime() {
    const calls = [];
    let hosts = [];
    const discoveryRuntime = {
        isAvailable: () => true,
        startDiscovery: () => { calls.push('start'); },
        // The desktop shell forgets every found host when its listener stops.
        stopDiscovery: () => { calls.push('stop'); hosts = []; },
        getDiscoveredHosts: () => hosts,
        onDiscoveredHosts: () => () => {},
    };
    const port = createNetworkLobbyDiscoveryPort({
        runtime: { global: { CURVIOS_APP: { discovery: true } } },
        discoveryRuntime,
        platformBindings: { runtimeSnapshot: { capabilities: { discovery: { available: true } } } },
    });
    return { port, calls, setHosts: (next) => { hosts = next; } };
}

test('the listener only stops when its last user is done', () => {
    const { port, calls } = createRuntime();
    port.start();
    port.start();
    port.stop();
    assert.deepEqual(calls, ['start'], 'a second user keeps the listener and its found hosts');
    port.stop();
    assert.deepEqual(calls, ['start', 'stop']);
    port.stop();
    assert.deepEqual(calls, ['start', 'stop'], 'an extra stop does nothing');
});

test('a background lobby list does not wipe the hosts a running join is looking for', async () => {
    const { port, setHosts } = createRuntime();
    port.start(); // the join by code is searching
    setHosts([{ ip: '10.0.0.2', port: 9090, lobbyCode: 'AAAA1111', playerCount: 1 }]);
    await listDiscoveredNetworkLobbies({ discoveryPort: port, transport: 'lan', scanTimeoutMs: 5 });
    const hosts = await port.getHosts();
    assert.equal(hosts.length, 1, 'the join still sees the host');
    port.stop();
});
