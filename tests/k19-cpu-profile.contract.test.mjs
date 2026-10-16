import assert from 'node:assert/strict';
import test from 'node:test';

import { runK19TargetWithCpuProfile } from './helpers/k19-cpu-profile.mjs';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

function harness({ session, newSession, captureMs = 100, commandTimeoutMs = 8 } = {}) {
    const reports = [];
    const saved = [];
    const commands = [];
    const activeSession = session || {
        async send(command) {
            commands.push(command);
            if (command === 'Profiler.stop') return { profile: { nodes: [] } };
            return {};
        },
        async detach() { commands.push('detach'); },
    };
    const testInfo = { outputPath: (name) => `/temporary/${name}` };
    const run = (runTarget) => runK19TargetWithCpuProfile({
        page: { context: () => ({ newCDPSession: newSession || (() => activeSession) }) },
        testInfo,
        runTarget,
        captureMs,
        commandTimeoutMs,
        report: (line) => reports.push(JSON.parse(line.slice(line.indexOf('{')))),
        saveProfile: async (path, body) => saved.push({ path, body: JSON.parse(body) }),
    });
    return { run, reports, saved, commands };
}

test('a responsive profile saves once and early target completion detaches', async () => {
    const h = harness();
    assert.equal(await h.run(async () => 'target-result'), 'target-result');
    assert.deepEqual(h.commands, ['Profiler.enable', 'Profiler.start', 'Profiler.stop', 'detach']);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].body.reason, 'target-complete');
    assert.equal(h.reports.at(-1).phase, 'cdp-profile-saved');
});

test('a hanging Profiler.stop cannot hold target teardown past its deadline', async () => {
    const session = {
        async send(command) {
            if (command === 'Profiler.stop') return new Promise(() => {});
            return {};
        },
        async detach() {},
    };
    const h = harness({ session });
    const started = Date.now();
    assert.equal(await h.run(async () => 'done'), 'done');
    assert.ok(Date.now() - started < 250, 'finalizer should remain bounded');
    assert.equal(h.saved.length, 0);
    assert.equal(h.reports.at(-1).phase, 'cdp-profile-unavailable');
});

test('a hanging detach is best-effort and does not extend finalization', async () => {
    const session = {
        async send(command) { return command === 'Profiler.stop' ? { profile: {} } : {}; },
        detach() { return new Promise(() => {}); },
    };
    const h = harness({ session });
    const started = Date.now();
    assert.equal(await h.run(async () => 42), 42);
    assert.ok(Date.now() - started < 250);
    assert.equal(h.saved.length, 1);
});

test('a late session after setup timeout is detached without blocking target work', async () => {
    const pendingSession = deferred();
    let detached = 0;
    const h = harness({ newSession: () => pendingSession.promise, commandTimeoutMs: 8 });
    assert.equal(await h.run(async () => 'ran without CDP'), 'ran without CDP');
    pendingSession.resolve({ detach: async () => { detached += 1; } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(detached, 1);
    assert.equal(h.reports[0].phase, 'cdp-unavailable');
});

test('a timed-out CDP command that later rejects is observed without unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        const session = {
            async send(command) {
                if (command === 'Profiler.start') {
                    return new Promise((_, reject) => setTimeout(() => reject(new Error('late start failure')), 25));
                }
                return {};
            },
            async detach() {},
        };
        const h = harness({ session, commandTimeoutMs: 5 });
        assert.equal(await h.run(async () => 'still runs'), 'still runs');
        await new Promise((resolve) => setTimeout(resolve, 35));
        assert.deepEqual(unhandled, []);
        assert.equal(h.reports[0].phase, 'cdp-unavailable');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('a rejected stop is reported and still attempts bounded detach', async () => {
    let detached = false;
    const session = {
        async send(command) {
            if (command === 'Profiler.stop') throw new Error('renderer closed');
            return {};
        },
        async detach() { detached = true; },
    };
    const h = harness({ session });
    assert.equal(await h.run(async () => 'target'), 'target');
    assert.equal(detached, true);
    assert.equal(h.reports.at(-1).phase, 'cdp-profile-unavailable');
});

test('the capture cap stops profiling once while the target continues', async () => {
    const h = harness({ captureMs: 5, commandTimeoutMs: 20 });
    assert.equal(await h.run(async () => new Promise((resolve) => setTimeout(() => resolve('finished'), 35))), 'finished');
    assert.equal(h.commands.filter((command) => command === 'Profiler.stop').length, 1);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].body.reason, '15-second-cap');
});
