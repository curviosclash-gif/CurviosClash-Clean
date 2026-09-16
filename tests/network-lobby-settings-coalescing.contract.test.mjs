import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkLobbySettingsPublisher } from '../src/application/session-runtime/NetworkLobbySettingsPublisher.js';

const settings = (mapKey) => ({
    mapKey,
    gameMode: 'CLASSIC',
    winsNeeded: 5,
    localSettings: { modePath: 'normal' },
});

function createHarness() {
    const requests = [];
    const stateChanges = [];
    const service = {
        _hostSettingsSnapshot: settings('standard'),
        _name: 'Host',
        getSessionState: () => ({ isHost: true, settingsRevision: 1 }),
        getSnapshot: () => ({ hostSettingsSnapshot: service._hostSettingsSnapshot }),
        onStateChanged: () => stateChanges.push(publisher.getState()),
        _fail: (message, code) => ({ ok: false, message, code }),
        _transportSession: {
            updateSettings: (snapshot) => new Promise((resolve, reject) => {
                requests.push({ snapshot, resolve, reject });
            }),
        },
    };
    const publisher = createNetworkLobbySettingsPublisher(service);
    return { publisher, requests, service, stateChanges };
}

test('rapid A/B/C edits publish A then C and settle superseded callers with C', async () => {
    const { publisher, requests, service } = createHarness();
    const first = publisher.publish(settings('maze'));
    const second = publisher.publish(settings('pyramid'));
    const third = publisher.publish(settings('vertical'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].snapshot.mapKey, 'maze');
    assert.equal(publisher.getState().settingsSyncPending, true);

    requests[0].resolve();
    const firstResult = await first;
    await Promise.resolve();
    assert.equal(firstResult.ok, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].snapshot.mapKey, 'vertical');
    assert.equal(publisher.getState().settingsSyncPending, true);

    requests[1].resolve();
    const [secondResult, thirdResult] = await Promise.all([second, third]);
    assert.equal(secondResult.ok, true);
    assert.strictEqual(secondResult, thirdResult);
    assert.equal(service._hostSettingsSnapshot.mapKey, 'vertical');
    assert.equal(publisher.getState().settingsSyncPending, false);
});

test('A/B/A edits keep A active, cancel queued B, and settle every caller with A', async () => {
    const { publisher, requests, service } = createHarness();
    const firstA = publisher.publish(settings('maze'));
    const queuedB = publisher.publish(settings('pyramid'));
    const latestA = publisher.publish(settings('maze'));
    assert.equal(requests.length, 1);
    requests[0].resolve();
    const [firstResult, queuedResult, latestResult] = await Promise.all([firstA, queuedB, latestA]);
    assert.equal(requests.length, 1);
    assert.equal(firstResult.ok, true);
    assert.strictEqual(firstResult, queuedResult);
    assert.strictEqual(queuedResult, latestResult);
    assert.equal(service._hostSettingsSnapshot.mapKey, 'maze');
    assert.equal(publisher.getState().settingsSyncPending, false);
});

test('A/B/A edits expose an active A failure to every superseded caller without sending B', async () => {
    const { publisher, requests, service } = createHarness();
    const firstA = publisher.publish(settings('maze'));
    const queuedB = publisher.publish(settings('pyramid'));
    const latestA = publisher.publish(settings('maze'));
    requests[0].reject(new Error('offline'));
    const [firstResult, queuedResult, latestResult] = await Promise.all([firstA, queuedB, latestA]);
    assert.equal(requests.length, 1);
    assert.equal(firstResult.ok, false);
    assert.strictEqual(firstResult, queuedResult);
    assert.strictEqual(queuedResult, latestResult);
    assert.equal(service._hostSettingsSnapshot.mapKey, 'standard');
    assert.equal(publisher.getState().settingsSyncError, 'offline');
});

test('identical active and queued edits deduplicate without hiding failures or retries', async () => {
    const { publisher, requests } = createHarness();
    const first = publisher.publish(settings('maze'));
    const sameActive = publisher.publish(settings('maze'));
    const queued = publisher.publish(settings('vertical'));
    const sameQueued = publisher.publish(settings('vertical'));
    assert.equal(requests.length, 1);
    requests[0].reject(new Error('offline'));
    assert.equal((await first).ok, false);
    assert.equal((await sameActive).ok, false);
    await Promise.resolve();
    assert.equal(requests.length, 2);
    requests[1].reject(new Error('still offline'));
    assert.equal((await queued).ok, false);
    assert.equal((await sameQueued).ok, false);
    assert.equal(publisher.getState().settingsSyncError, 'still offline');

    const retry = publisher.publish(settings('vertical'));
    assert.equal(requests.length, 3);
    requests[2].resolve();
    assert.equal((await retry).ok, true);
    assert.equal(publisher.getState().settingsSyncError, '');
});

test('reset settles active and queued edits and isolates a new lobby from late acknowledgments', async () => {
    const { publisher, requests, service } = createHarness();
    const active = publisher.publish(settings('maze'));
    const queued = publisher.publish(settings('pyramid'));
    publisher.reset();
    assert.deepEqual(await active, { ok: false, code: 'lobby_left' });
    assert.deepEqual(await queued, { ok: false, code: 'lobby_left' });
    assert.equal(publisher.getState().settingsSyncPending, false);

    const nextLobby = publisher.publish(settings('vertical'));
    assert.equal(requests.length, 2);
    requests[0].resolve();
    await Promise.resolve();
    assert.equal(service._hostSettingsSnapshot.mapKey, 'standard');
    requests[1].resolve();
    assert.equal((await nextLobby).ok, true);
    assert.equal(service._hostSettingsSnapshot.mapKey, 'vertical');
});

test('a synchronous lobby reset during state notification prevents the obsolete transport send', async () => {
    const { publisher, requests, service } = createHarness();
    let resetOnce = true;
    service.onStateChanged = () => {
        if (!resetOnce) return;
        resetOnce = false;
        publisher.reset();
    };
    const result = await publisher.publish(settings('maze'));
    assert.deepEqual(result, { ok: false, code: 'lobby_left' });
    assert.equal(requests.length, 0);
    assert.equal(publisher.getState().settingsSyncPending, false);
});

test('confirmed equal settings skip only after the final acknowledgment', async () => {
    const { publisher, requests } = createHarness();
    const active = publisher.publish(settings('maze'));
    const queued = publisher.publish(settings('vertical'));
    assert.equal(publisher.getState().settingsSyncPending, true);
    requests[0].resolve();
    await active;
    await Promise.resolve();
    assert.equal(publisher.getState().settingsSyncPending, true);
    requests[1].resolve();
    await queued;
    assert.equal(publisher.getState().settingsSyncPending, false);
    assert.deepEqual(await publisher.publish(settings('vertical')), { ok: true, skipped: true });
    assert.equal(requests.length, 2);
});
