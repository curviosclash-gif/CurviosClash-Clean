import assert from 'node:assert/strict';
import test from 'node:test';
import { DataChannelManager } from '../src/network/DataChannelManager.js';
import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import {
    getRuntimeStateSnapshotMetrics,
    setupRuntimeHostFullStateSyncHandler,
    teardownRuntimeSession,
} from '../src/core/runtime/RuntimeSessionLifecycleService.js';

function channel({ bufferedAmount = 0, fail = false } = {}) {
    return {
        readyState: 'open',
        bufferedAmount,
        sent: [],
        send(value) {
            if (fail) throw new Error('send failed');
            this.sent.push(value);
        },
        close() {},
    };
}

test('data-channel metrics count actual recipients, UTF-8 bytes, drops, errors, and buffers', () => {
    const manager = new DataChannelManager({ backpressureThresholdBytes: 10, backpressureCooldownMs: 0 });
    const first = channel();
    const second = channel();
    const pressured = channel({ bufferedAmount: 20 });
    const failed = channel({ fail: true });
    manager._setupChannel('one', 'snapshots', first);
    manager._channels.set('two:snapshots', second);
    manager._channels.set('three:snapshots', pressured);
    manager._channels.set('four:snapshots', failed);
    manager.sendToAll('snapshots', { type: 'snapshot', label: 'Grüße 🚀' });

    const metrics = manager.getMetrics();
    const expectedBytes = new TextEncoder().encode(first.sent[0]).byteLength;
    assert.equal(first.sent[0], JSON.stringify({ type: 'snapshot', label: 'Grüße 🚀' }));
    assert.equal(metrics.channels.snapshots.txMessages, 2);
    assert.equal(metrics.channels.snapshots.txBytes, expectedBytes * 2);
    assert.equal(metrics.channels.snapshots.backpressureDrops, 1);
    assert.equal(metrics.channels.snapshots.sendErrors, 1);
    assert.equal(metrics.channels.snapshots.bufferedBytes, 20);

    first.onmessage({ data: JSON.stringify({ type: 'pong', label: 'Grüße 🚀' }) });
    const afterReceive = manager.getMetrics();
    assert.equal(afterReceive.channels.snapshots.rxMessages, 1);
    assert.ok(afterReceive.channels.snapshots.rxBytes > 0);
    manager.dispose();
    assert.equal(manager.getMetrics().total.txMessages, 0);
});

test('online diagnostics read ICE stats only on request and expose candidate types without addresses', async () => {
    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://127.0.0.1:1' });
    let getStatsCalls = 0;
    adapter._peerManager._peers.set('peer-client', {
        getStats: async () => {
            getStatsCalls += 1;
            return new Map([
                ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
                ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }],
                ['local', { id: 'local', type: 'local-candidate', candidateType: 'relay', address: '192.0.2.1' }],
                ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'srflx', address: '198.51.100.2' }],
            ]);
        },
        close() {},
    });
    assert.equal(getStatsCalls, 0);
    const diagnostics = await adapter.getDiagnostics();
    assert.equal(getStatsCalls, 1);
    assert.equal(diagnostics.iceCandidateTypes.relay, 1);
    assert.equal(diagnostics.turnInUse, true);
    assert.doesNotMatch(JSON.stringify(diagnostics), /192\.0\.2\.1|198\.51\.100\.2/);
    adapter.dispose();
});

test('runtime snapshot duration metrics are pull-based and cleared during teardown', async () => {
    const sent = [];
    let fullStateSyncHandler = null;
    const session = {
        isHost: true,
        on: (event, handler) => { if (event === 'fullStateSyncNeeded') fullStateSyncHandler = handler; },
        off() {},
        sendStateToPeer: (peerId, snapshot) => sent.push({ peerId, snapshot }),
        dispose() {},
    };
    const facade = {
        session,
        game: {
            entityManager: { players: [], projectiles: [], powerups: [] },
            roundStateController: { frame: 4, round: 2, timeRemaining: 8, scores: [1, 0] },
        },
        _arenaLoadedPeers: new Set(),
    };
    assert.equal(getRuntimeStateSnapshotMetrics(facade).count, 0);
    setupRuntimeHostFullStateSyncHandler(facade);
    fullStateSyncHandler({ peerId: 'peer-client' });
    assert.equal(sent.length, 1);
    const metrics = getRuntimeStateSnapshotMetrics(facade);
    assert.equal(metrics.count, 1);
    assert.ok(metrics.totalDurationMs >= 0);
    assert.ok(metrics.maxDurationMs >= metrics.lastDurationMs);
    await teardownRuntimeSession(facade);
    assert.equal(getRuntimeStateSnapshotMetrics(facade).count, 0);
});
