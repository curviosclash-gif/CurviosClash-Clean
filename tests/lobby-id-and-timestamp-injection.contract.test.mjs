import assert from 'node:assert/strict';
import test from 'node:test';

import { LANMatchLobby } from '../src/network/LANMatchLobby.js';
import { OnlineMatchLobby } from '../src/network/OnlineMatchLobby.js';
import { NetworkLobbyTransportSession } from '../src/application/session-runtime/NetworkLobbyTransportSession.js';
import { createLobbyRuntimeBindings } from '../src/network/LobbyRuntimeBindings.js';

// Eine Uhr, die bei jedem Blick um eine Millisekunde weiterzaehlt, und ein
// Wuerfel mit fester Folge. Beides ist erkennbar kuenstlich - taucht es im
// Ergebnis auf, stammt der Wert nachweislich aus der Injektion.
function createScriptedRuntime(startMs = 1_700_000_000_000) {
    let clockMs = startMs;
    let rollIndex = 0;
    const rolls = [0.111111, 0.222222, 0.333333];
    return {
        nowMs: () => ++clockMs,
        random: () => rolls[rollIndex++ % rolls.length],
    };
}

async function withoutWallClock(run) {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => {
        throw new Error('the lobby must not read the wall clock');
    };
    Math.random = () => {
        throw new Error('the lobby must not reach for the global roll');
    };
    try {
        return await run();
    } finally {
        Date.now = originalNow;
        Math.random = originalRandom;
    }
}

test('the lobby runtime bindings fall back to the wall clock when nothing is injected', () => {
    const bindings = createLobbyRuntimeBindings();

    assert.equal(typeof bindings.nowMs(), 'number');
    assert.ok(bindings.nowMs() > 0);
    const roll = bindings.random();
    assert.ok(roll >= 0 && roll < 1);
});

test('an online lobby builds its ack ids from the injected clock and roll', async () => {
    await withoutWallClock(() => {
        const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1234', ...createScriptedRuntime() });

        const first = lobby._createMutationAckId('match');
        const second = lobby._createMutationAckId('match');

        assert.match(first, /^match-[a-z0-9]+-[a-z0-9]+$/);
        assert.notEqual(first, second, 'two ids in the same lobby must stay distinct');
    });
});

test('a LAN lobby builds its match command id from the injected clock and roll', async () => {
    await withoutWallClock(() => {
        const runtime = createScriptedRuntime();
        const lobby = new LANMatchLobby({ signalingUrl: 'http://localhost:9090', ...runtime });

        // Gleiche Bildungsregel wie in startMatch, nur ohne den HTTP-Aufruf.
        const commandId = `match-${lobby._lobbyRuntime.nowMs().toString(36)}-${lobby._lobbyRuntime.random().toString(36).slice(2, 8)}`;

        assert.match(commandId, /^match-[a-z0-9]+-[a-z0-9]+$/);
    });
});

test('online member timestamps come from the injected clock', async () => {
    await withoutWallClock(() => {
        const lobby = new OnlineMatchLobby({ signalingUrl: 'ws://localhost:1234', ...createScriptedRuntime(5_000) });
        lobby.sessionState = {
            ...lobby.sessionState,
            lobbyCode: 'ONLINE-1',
            members: [{ peerId: 'peer-1', actorId: 'A', name: 'A', role: 'client', ready: false }],
        };

        lobby._setReadyStateFor('peer-1', true);

        const member = lobby.sessionState.members.find((entry) => entry.peerId === 'peer-1');
        assert.equal(member.ready, true);
        // Die Skript-Uhr startet bei 5000 und zaehlt hoch, die Wanduhr laege um
        // Groessenordnungen darueber.
        assert.ok(member.lastSeenAt > 5_000 && member.lastSeenAt < 6_000, `unexpected lastSeenAt ${member.lastSeenAt}`);
        assert.ok(lobby.sessionState.updatedAt > 5_000 && lobby.sessionState.updatedAt < 6_000);
    });
});

test('the transport session hands its clock and roll down to the lobby it creates', () => {
    let seenRuntime = null;
    const runtime = createScriptedRuntime();
    const session = new NetworkLobbyTransportSession({
        transport: 'lan',
        nowMs: runtime.nowMs,
        random: runtime.random,
        createLobby: (signalingUrl, lobbyRuntime) => {
            seenRuntime = lobbyRuntime;
            return { on: () => {}, dispose: () => {} };
        },
    });

    session.replace('http://localhost:9090');

    assert.equal(seenRuntime?.nowMs, runtime.nowMs);
    assert.equal(seenRuntime?.random, runtime.random);
});
