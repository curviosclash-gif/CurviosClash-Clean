import assert from 'node:assert/strict';
import test from 'node:test';

import { OnlineSessionAdapter } from '../src/network/OnlineSessionAdapter.js';
import { createSocketLifecycleError } from '../src/network/OnlineSignalingSupport.js';

test('leaving during a connect retry stops the loop instead of opening a new lobby', async () => {
    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://localhost:1' });
    let attempts = 0;
    adapter._connectSingleAttempt = async () => {
        attempts += 1;
        if (attempts === 1) {
            // The player leaves while the loop waits for the next attempt.
            setTimeout(() => adapter.disconnect(), 5);
        }
        throw createSocketLifecycleError('timeout', { signalingUrl: 'ws://localhost:1' });
    };

    await assert.rejects(
        adapter.connect({ connectRetryDelaysMs: [40, 40], maxConnectAttempts: 3 }),
        (error) => error?.code === 'connect_cancelled'
    );
    assert.equal(attempts, 1, 'no further socket may be opened after disconnect()');
    adapter.dispose();
});

test('reconnect does not start after the session was disconnected', async () => {
    const adapter = new OnlineSessionAdapter({ isHost: true, signalingUrl: 'ws://localhost:1' });
    let attempts = 0;
    adapter._reconnectSingleAttempt = async () => { attempts += 1; };
    adapter.disconnect();

    await assert.rejects(adapter.reconnect(), (error) => error?.code === 'connect_cancelled');
    assert.equal(attempts, 0);
    adapter.dispose();
});
