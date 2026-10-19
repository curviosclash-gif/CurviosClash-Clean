import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayRecorder, REPLAY_EXPORT_CONTRACT_VERSION } from '../src/core/replay/ReplayRecorder.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';

function setup() {
    const clock = { wall: 1700000000000, elapsed: 250 };
    const recorder = new ReplayRecorder({ now: () => clock.wall, monotonicNow: () => clock.elapsed });
    return { clock, recorder, start: () => recorder.startRecording(null, null, 2) };
}

test('a stopped replay keeps its recorded duration when exported later', () => {
    const { clock, recorder, start } = setup(); start();
    clock.elapsed += 1000;
    const stopped = recorder.stopRecording();
    assert.equal(stopped.duration, 1000);
    clock.elapsed += 7000; clock.wall += 7000;
    assert.equal(recorder.getReplay().duration, 1000);
    assert.equal(JSON.parse(recorder.exportReplayJSON()).duration, 1000);
});

test('wall-clock corrections leave action timestamps and duration unchanged', () => {
    const { clock, recorder, start } = setup(); start();
    clock.elapsed += 100; clock.wall -= 60000;
    recorder.recordAction({ player: 0, frame: 1, timestamp: -900 });
    clock.elapsed += 50; clock.wall += 3600000;
    recorder.recordAction({ player: 1, frame: 2 });
    const replay = recorder.stopRecording();
    assert.deepEqual(replay.actions.map(action => action.timestamp), [100, 150]);
    assert.equal(replay.duration, 150);
    assert.equal(replay.startTime, 1700000000000);
    assert.equal(replay.playerCount, 2);
});

test('active export uses elapsed time without stopping the recording', () => {
    const { clock, recorder, start } = setup(); start(); clock.elapsed += 17.9;
    assert.equal(recorder.getReplay().duration, 17);
    assert.equal(recorder.isRecording, true);
    clock.elapsed += 20;
    assert.equal(recorder.stop().duration, 37);
});

test('stop is idempotent and ignores actions after stop', () => {
    const { clock, recorder, start } = setup(); start(); clock.elapsed += 5;
    recorder.recordAction({ frame: 1 });
    const first = recorder.stop(); clock.elapsed += 300;
    recorder.recordAction({ frame: 2 });
    assert.deepEqual(recorder.stopRecording(), first);
    assert.equal(recorder.getReplay().actionCount, 1);
    assert.equal(recorder.isRecording, false);
});

test('backward, negative and invalid clock reads cannot reverse elapsed time', () => {
    const { clock, recorder, start } = setup(); start();
    for (const reading of [240, 300, NaN, Infinity, -20, 290, 330]) {
        clock.elapsed = reading; recorder.recordAction({ frame: 1 });
    }
    const replay = recorder.stop();
    assert.deepEqual(replay.actions.map(action => action.timestamp), [0, 50, 50, 50, 50, 50, 80]);
    assert.equal(replay.duration, 80);
});

test('reset clears duration, metadata and actions until a new recording starts', () => {
    const { clock, recorder, start } = setup(); start(); clock.elapsed += 15;
    recorder.recordAction({ frame: 1 }); recorder.stop(); recorder.reset(); clock.elapsed += 100;
    const reset = recorder.getReplay();
    assert.equal(reset.duration, 0); assert.equal(reset.startTime, 0);
    assert.equal(reset.matchId, null); assert.equal(reset.playerCount, 0);
    assert.equal(reset.actionCount, 0); assert.deepEqual(reset.actions, []);
    assert.equal(reset.initialState, null); assert.equal(recorder.isRecording, false);
});

test('a fresh recording resets elapsed high water and takes new wall metadata', () => {
    const { clock, recorder, start } = setup(); start(); clock.elapsed += 800; recorder.stop();
    clock.wall += 5000; clock.elapsed = 50;
    recorder.start(null, null, 1); clock.elapsed += 10; recorder.recordAction({ frame: 2 });
    const replay = recorder.stop();
    assert.equal(replay.startTime, clock.wall); assert.equal(replay.duration, 10);
    assert.equal(replay.actionCount, 1); assert.equal(replay.actions[0].timestamp, 10);
    assert.equal(replay.playerCount, 1);
});

test('empty recorder and stop before start produce a stable zero-length v1 export', () => {
    const { recorder } = setup();
    assert.equal(recorder.getReplay().duration, 0);
    assert.equal(recorder.stopRecording().duration, 0);
    const replay = JSON.parse(recorder.exportReplayJSON());
    assert.equal(replay.contractVersion, REPLAY_EXPORT_CONTRACT_VERSION);
    assert.equal(replay.version, 'replay.v1');
    assert.equal(replay.actionCount, 0);
});

test('an invalid initial clock read cannot emit a nonfinite recording time', () => {
    const { clock, recorder, start } = setup(); clock.elapsed = NaN; start();
    clock.elapsed = 500; recorder.recordAction({ frame: 1 });
    const replay = recorder.stop();
    assert.equal(replay.actions[0].timestamp, 0); assert.equal(replay.duration, 0);
});

test('the production clock uses performance time while retaining epoch metadata', t => {
    let wall = 1700000000000, elapsed = 100;
    t.mock.method(Date, 'now', () => wall);
    t.mock.method(globalThis.performance, 'now', () => elapsed);
    const recorder = new ReplayRecorder(); recorder.start(null, null, 1);
    wall -= 90000; elapsed += 75;
    recorder.recordAction({ frame: 1 });
    elapsed += 25;
    const replay = recorder.stop();
    assert.equal(replay.startTime, 1700000000000);
    assert.equal(replay.actions[0].timestamp, 75);
    assert.equal(replay.duration, 100);
    elapsed += 500; wall += 500000;
    assert.equal(JSON.parse(recorder.exportReplayJSON()).duration, 100);
});

test('reset during recording freezes a cleared export and ignores further actions', () => {
    const { clock, recorder, start } = setup(); start(); clock.elapsed += 100;
    recorder.recordAction({ frame: 1 }); recorder.reset(); clock.elapsed += 500;
    recorder.recordAction({ frame: 2 });
    assert.equal(recorder.isRecording, false);
    assert.equal(recorder.getReplay().duration, 0);
    assert.equal(recorder.getReplay().actionCount, 0);
});

test('Arcade run reset stops the real recorder and later exports retain that endpoint', () => {
    const { clock, recorder } = setup();
    const runtime = new ArcadeRunRuntime({ replayRecorder: recorder, now: () => clock.wall });
    runtime.configure({ arcade: { enabled: true, replayHooksEnabled: true, sectorCount: 1 } });
    runtime.startRun({ playerCount: 1 });
    assert.equal(recorder.isRecording, true);
    clock.elapsed += 400;
    recorder.recordAction({ player: 0, frame: 1 });
    runtime.resetRunState();
    assert.equal(recorder.isRecording, false);
    clock.elapsed += 8000;
    const replay = JSON.parse(recorder.exportReplayJSON());
    assert.equal(replay.duration, 400);
    assert.equal(replay.actions[0].timestamp, 400);
});
