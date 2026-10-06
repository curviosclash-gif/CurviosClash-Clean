import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellableSleep, createJobRegistry, throwIfCancelled } from '../scripts/playtest/playtest-jobs.mjs';

test('a job returns an id at once and its result once it has finished', async () => {
    const jobs = createJobRegistry();
    const started = jobs.start('flight', async ({ progress, log }) => {
        progress({ checkpoint: 1 });
        log('first checkpoint');
        await new Promise((resolve) => setTimeout(resolve, 10));
        progress({ checkpoint: 2 });
        return { completed: true };
    });
    assert.equal(started.state, 'running');
    assert.match(started.id, /^job-\d+$/);
    const finished = await jobs.wait(started.id);
    assert.equal(finished.state, 'done');
    assert.deepEqual(finished.result, { completed: true });
    assert.deepEqual(finished.progress, { checkpoint: 2 }, 'progress updates merge');
    assert.equal(finished.log[0].message, 'first checkpoint');
    assert.equal(jobs.active(), null);
});

test('only one job drives the game at a time', async () => {
    const jobs = createJobRegistry();
    const first = jobs.start('a', ({ signal }) => cancellableSleep(1000, signal));
    assert.throws(() => jobs.start('b', async () => {}), (error) => error.code === 'PLAYTEST_JOB_BUSY' && error.activeJobId === first.id);
    await jobs.cancelAll();
    const second = jobs.start('b', async () => 'ok');
    assert.equal((await jobs.wait(second.id)).result, 'ok');
});

test('cancel stops a job between steps and marks it cancelled, not failed', async () => {
    const jobs = createJobRegistry();
    let steps = 0;
    const job = jobs.start('scenario', async ({ signal }) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            throwIfCancelled(signal);
            steps += 1;
            await cancellableSleep(5, signal);
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(jobs.cancel(job.id, 'Test beenden').state, 'cancelling');
    const finished = await jobs.wait(job.id);
    assert.equal(finished.state, 'cancelled');
    assert.ok(steps < 100, 'the loop stopped early');
    assert.ok(finished.log.some((entry) => entry.message === 'Test beenden'));
});

test('a throwing job is failed with its message; waiting with a limit returns a running snapshot', async () => {
    const jobs = createJobRegistry();
    const failing = jobs.start('x', async () => { throw new Error('map did not load'); });
    const failed = await jobs.wait(failing.id);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.error, 'map did not load');
    const slow = jobs.start('slow', ({ signal }) => cancellableSleep(500, signal));
    assert.equal((await jobs.wait(slow.id, 10)).state, 'running');
    await jobs.cancelAll();
    assert.equal(jobs.get('job-999'), null);
});

test('finished jobs are pruned beyond the keep limit', async () => {
    const jobs = createJobRegistry({ keepFinished: 2 });
    for (let index = 0; index < 5; index += 1) await jobs.wait(jobs.start('n', async () => index).id);
    assert.equal(jobs.list().length, 2);
});
