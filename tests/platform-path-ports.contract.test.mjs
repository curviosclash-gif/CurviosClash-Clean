import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserAndroidBackPort } from '../src/platform/browser/BrowserAndroidBackPort.js';
import { createBrowserHangarPagePort } from '../src/platform/browser/BrowserHangarPagePort.js';
import { createNetworkLobbyDiscoveryPort } from '../src/application/session-runtime/NetworkLobbyDiscoveryPort.js';

test('Android back port composes handlers and restores the previous handler', () => {
    const calls = [];
    const runtime = { __curviosAndroidBackHandler: () => { calls.push('previous'); return true; } };
    const port = createBrowserAndroidBackPort(runtime);
    const first = port.register(() => { calls.push('first'); return false; });
    const second = port.register(() => { calls.push('second'); return true; });
    assert.equal(runtime.__curviosAndroidBackHandler(), true);
    assert.deepEqual(calls, ['second']);
    second();
    assert.equal(runtime.__curviosAndroidBackHandler(), true);
    assert.deepEqual(calls, ['second', 'first', 'previous']);
    first();
    assert.equal(runtime.__curviosAndroidBackHandler(), true);
    assert.deepEqual(calls, ['second', 'first', 'previous', 'previous']);
});

test('hangar page port owns mode and same-page navigation', () => {
    const calls = [];
    const port = createBrowserHangarPagePort({ location: {
        search: '?mode=fight', reload: () => calls.push('reload'), assign: (path) => calls.push(path),
    } });
    assert.equal(port.getMode(), 'fight');
    port.reload();
    port.returnToMenu();
    assert.deepEqual(calls, ['reload', '/']);
});

test('LAN discovery uses injected capability without reading a runtime global', async () => {
    const calls = [];
    const port = createNetworkLobbyDiscoveryPort({
        platformBindings: { discoveryAccess: { available: true } },
        discoveryRuntime: {
            isAvailable: () => true,
            startDiscovery: () => calls.push('start'),
            stopDiscovery: () => calls.push('stop'),
            getDiscoveredHosts: () => [{ address: '192.168.1.2' }],
            onDiscoveredHosts: () => () => {},
        },
    });
    assert.equal(port.isAvailable(), true);
    port.start();
    assert.deepEqual(await port.getHosts(), [{ address: '192.168.1.2' }]);
    port.stop();
    assert.deepEqual(calls, ['start', 'stop']);
});
