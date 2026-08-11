import assert from 'node:assert/strict';
import test from 'node:test';

import { createLobbyLifecycleEventEmitter } from '../src/application/session-runtime/LobbyLifecycleEventEmitter.js';
import { resolveDefaultJoinSignalingUrl } from '../src/application/session-runtime/NetworkLobbyServiceDiscovery.js';
import {
    compareDiscoveryHostEntries,
    normalizeDiscoveryHostEntry,
    normalizeLobbyCode,
    normalizeSignalingUrl,
    tryParseManualSignalingUrl,
} from '../src/application/session-runtime/NetworkLobbyServiceSupport.js';

// Klemmt die Wanduhr ab. Wer sie trotzdem anfasst, faellt sofort auf, statt eine
// Zahl zu liefern, die im Test zufaellig plausibel aussieht.
async function withoutWallClock(run) {
    const originalNow = Date.now;
    Date.now = () => {
        throw new Error('the lobby path must not read the wall clock');
    };
    try {
        return await run();
    } finally {
        Date.now = originalNow;
    }
}

test('a discovery host entry keeps the timestamp it was discovered with', async () => {
    await withoutWallClock(() => {
        const entry = normalizeDiscoveryHostEntry({
            ip: '192.168.0.22',
            port: 9090,
            lobbyCode: 'lan-qa',
            lastSeen: 1_700_000_000_000,
        });

        assert.equal(entry.lastSeen, 1_700_000_000_000);
    });
});

test('a host entry without a timestamp reports none instead of claiming it was just seen', async () => {
    await withoutWallClock(() => {
        const entry = normalizeDiscoveryHostEntry({ ip: '10.0.0.5', port: 9090, lobbyCode: 'lan-qa' });

        assert.equal(entry.lastSeen, 0);
    });
});

test('an entry without a timestamp sorts behind a really recent host', async () => {
    await withoutWallClock(() => {
        const withTimestamp = normalizeDiscoveryHostEntry({
            ip: '192.168.0.22',
            port: 9090,
            lobbyCode: 'lan-qa',
            lastSeen: 1_700_000_000_000,
        });
        const withoutTimestamp = normalizeDiscoveryHostEntry({ ip: '10.0.0.5', port: 9090, lobbyCode: 'lan-qa' });

        assert.ok(
            compareDiscoveryHostEntries(withTimestamp, withoutTimestamp) < 0,
            'the host with a real timestamp has to come first'
        );
        assert.deepEqual(
            [withoutTimestamp, withTimestamp].sort(compareDiscoveryHostEntries).map((entry) => entry.ip),
            ['192.168.0.22', '10.0.0.5']
        );
    });
});

function createDiscoveryProbe(hosts = []) {
    const calls = [];
    return {
        calls,
        discoveryPort: {
            isAvailable: () => true,
            start: () => calls.push('start'),
            stop: () => calls.push('stop'),
            getHosts: () => {
                calls.push('getHosts');
                return hosts;
            },
        },
    };
}

test('the discovery deadline is measured against the injected clock', async () => {
    const { calls, discoveryPort } = createDiscoveryProbe([]);
    // Die Uhr springt bei jedem Blick um eine Sekunde. Bei 3 s Wartebudget darf die
    // Schleife deshalb nur wenige Runden laufen und muss dann von selbst aufgeben.
    let clockMs = 10_000;
    const resolved = await withoutWallClock(() => resolveDefaultJoinSignalingUrl({
        lobbyCode: 'lan-qa',
        explicitSignalingUrl: '',
        normalizeSignalingUrl,
        normalizeLobbyCode,
        tryParseManualSignalingUrl,
        discoveryPort,
        clearJoinDiscoveryIssue: () => {},
        setJoinDiscoveryIssue: (code, message, details) => ({ code, message, details }),
        delay: async () => {},
        collectMatchingDiscoveryHosts: () => [],
        selectJoinSignalingUrlFromDiscoveredHosts: async () => ({ signalingUrl: '' }),
        runtimeGlobal: {},
        nowMs: () => {
            clockMs += 1_000;
            return clockMs;
        },
        discoveryMaxWaitMs: 3_000,
    }));

    assert.equal(resolved, '');
    assert.ok(calls.includes('stop'), 'discovery has to be stopped again');
    const polls = calls.filter((call) => call === 'getHosts').length;
    assert.ok(polls > 0 && polls <= 4, `expected the injected clock to end the loop quickly, got ${polls} polls`);
});

test('the lifecycle emitter stamps its events from the injected clock', async () => {
    await withoutWallClock(() => {
        let tick = 0;
        const emitter = createLobbyLifecycleEventEmitter({ now: () => ++tick });

        const first = emitter.emit('lobby_created', {});
        const second = emitter.emit('lobby_joined', {});

        assert.equal(first.timestampMs, 1);
        assert.equal(second.timestampMs, 2);
    });
});
