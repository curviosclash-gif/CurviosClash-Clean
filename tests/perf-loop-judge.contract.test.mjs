import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { judgePerfLoop } from '../scripts/perf-loop-judge.mjs';
import { summarizeCpuProfile } from '../scripts/perf-loop.mjs';

const sim = (x) => [{ position: [x, 0, 0], quaternion: [0, 0, 0, 1], alive: true, health: 100, score: 0 }];

function report({ cpu = 20, update = 12, render = 4, gpu = 27, p95 = 30, sha = 'a', tiles = null, x = 1, gpuSamples = 100 } = {}) {
    return {
        measureSeconds: 15, warmupSeconds: 5, qualityTicks: [60],
        quality: { frames: [{ tick: 60, sha256: sha, tiles: tiles || Array(144).fill(sha), sim: sim(x) }] },
        timing: { gpuName: 'test-gpu', cpu: { meanMs: cpu, p95Ms: p95 }, update: { p50Ms: update }, render: { p50Ms: render },
            gpu: { samples: gpuSamples, medianMs: gpu }, renderInfo: { meanCalls: 140 },
            checkpoints: [{ tick: 300, players: sim(x) }], final: sim(x) },
    };
}

// Runs in measured order (ABBA ABBA ...), one map; each entry holds the report options.
const measured = (arms, values) => arms.map((arm, index) => ({ arm, maps: { standard: report(values[index]) } }));
const ABBA = ['baseline', 'candidate', 'candidate', 'baseline'];
const abba = (baseline, candidate) => measured(ABBA, [baseline[0], candidate[0], candidate[1], baseline[1]]);

test('an unchanged build is never accepted (A/A)', () => {
    const result = judgePerfLoop(abba([{ cpu: 20 }, { cpu: 20.1 }], [{ cpu: 20.05 }, { cpu: 19.95 }]));
    assert.equal(result.verdict, 'reject-perf');
    assert.equal(result.quality.standard.identical, true);
    assert.deepEqual(result.improved, []);
});

test('a CPU speedup beyond noise with identical pixels and simulation is accepted', () => {
    const result = judgePerfLoop(abba([{ cpu: 20 }, { cpu: 20.2 }], [{ cpu: 18 }, { cpu: 18.1 }]), { target: 'cpu' });
    assert.equal(result.verdict, 'accept', result.reasons.join('; '));
    assert.deepEqual(result.improved, ['cpu']);
});

test('a GPU-only speedup is accepted when the CPU cost stays within noise', () => {
    const result = judgePerfLoop(abba([{ gpu: 27 }, { gpu: 27.1 }], [{ gpu: 24 }, { gpu: 24.2 }]));
    assert.equal(result.verdict, 'accept', result.reasons.join('; '));
    assert.deepEqual(result.improved, ['gpu']);
});

// Positive control measured on 2026-10-12: extra pixel-neutral render work in the baseline only.
// The render median shows it in every pair although the update time drifted by up to 60 %.
test('a render-only speedup is found under its declared target while the update time drifts', () => {
    const render = [4.6, 4.4, 3.1, 3.6, 3.6, 2.9, 3.0, 3.7];
    const update = [14.6, 17.3, 11.3, 10.4, 10.7, 10.6, 11.1, 11.9];
    const runs = measured([...ABBA, ...ABBA], render.map((value, index) => ({ render: value, update: update[index] })));
    const result = judgePerfLoop(runs, { target: 'cpuRender' });
    assert.equal(result.verdict, 'accept', result.reasons.join('; '));
    assert.deepEqual(result.improved, ['cpuRender']);
});

test('only the declared target can carry an acceptance', () => {
    const result = judgePerfLoop(abba([{ gpu: 27 }, { gpu: 27.1 }], [{ gpu: 24 }, { gpu: 24.2 }]), { target: 'cpuRender' });
    assert.equal(result.verdict, 'reject-perf');
    assert.match(result.reasons.join('\n'), /target did not improve/);
});

test('an unknown target makes the measurement invalid', () => {
    const result = judgePerfLoop(abba([{}, {}], [{}, {}]), { target: 'fps' });
    assert.equal(result.verdict, 'invalid');
});

test('changed pixels reject the candidate and name the changed screen tiles', () => {
    const tiles = Array(144).fill('a');
    tiles[3] = 'b';
    const result = judgePerfLoop(abba([{ gpu: 27 }, { gpu: 27 }], [{ gpu: 20, sha: 'b', tiles }, { gpu: 20, sha: 'b', tiles }]));
    assert.equal(result.verdict, 'reject-quality');
    assert.match(result.reasons.join('\n'), /pixels differ in 1\/144 screen tiles/);
});

test('a changed simulation rejects the candidate even with identical pixels', () => {
    const result = judgePerfLoop(abba([{ gpu: 27 }, { gpu: 27 }], [{ gpu: 20, x: 2 }, { gpu: 20, x: 2 }]));
    assert.equal(result.verdict, 'reject-quality');
    assert.match(result.reasons.join('\n'), /simulation/);
});

test('a CPU speedup that costs GPU time is rejected', () => {
    const result = judgePerfLoop(abba([{ cpu: 20, gpu: 27 }, { cpu: 20, gpu: 27 }], [{ cpu: 17, gpu: 30 }, { cpu: 17, gpu: 30 }]), { target: 'cpu' });
    assert.equal(result.verdict, 'reject-perf');
    assert.match(result.reasons.join('\n'), /GPU frame median worse/);
});

test('the required gain grows with the noise between ABBA pairs', () => {
    const result = judgePerfLoop(abba([{ cpu: 18 }, { cpu: 22 }], [{ cpu: 18 }, { cpu: 18.2 }]), { target: 'cpu' });
    assert.equal(result.verdict, 'reject-perf');
    assert.ok(result.metrics.cpu.required > 0.1, `required ${result.metrics.cpu.required}`);
});

// Measured A/A on 2026-10-12: the machine slowed down over the run while other sessions worked.
test('machine drift during an unchanged run is not mistaken for a speedup', () => {
    const result = judgePerfLoop(abba([{ cpu: 46.02 }, { cpu: 41.4 }], [{ cpu: 43.09 }, { cpu: 42.52 }]), { target: 'cpu' });
    assert.equal(result.verdict, 'reject-perf');
});

test('a real speedup is still recognised while the machine drifts', () => {
    const result = judgePerfLoop(abba([{ cpu: 46 }, { cpu: 41.4 }], [{ cpu: 41 }, { cpu: 37.5 }]), { target: 'cpu' });
    assert.equal(result.verdict, 'accept', result.reasons.join('; '));
    assert.ok(result.metrics.cpu.gain > 0.09);
});

test('a slowdown counts only when every ABBA pair shows it', () => {
    const result = judgePerfLoop(abba([{ gpu: 27 }, { gpu: 24 }], [{ gpu: 26 }, { gpu: 28 }]));
    assert.doesNotMatch(result.reasons.join('\n'), /GPU frame median worse/);
});

test('every ABBA pair must agree on the speedup', () => {
    const result = judgePerfLoop(abba([{ cpu: 20 }, { cpu: 17 }], [{ cpu: 16 }, { cpu: 17.5 }]), { target: 'cpu', noiseFactor: 0 });
    assert.equal(result.verdict, 'reject-perf');
    assert.ok(result.metrics.cpu.pairs.some((gain) => gain <= 0));
});

test('a non-deterministic arm makes the measurement invalid instead of judging quality', () => {
    const result = judgePerfLoop(abba([{ sha: 'a' }, { sha: 'z' }], [{}, {}]));
    assert.equal(result.verdict, 'invalid');
    assert.match(result.reasons.join('\n'), /baseline runs are not deterministic/);
});

test('one run per arm cannot estimate noise and is invalid', () => {
    const result = judgePerfLoop(measured(['baseline', 'candidate'], [{}, { gpu: 10 }]));
    assert.equal(result.verdict, 'invalid');
});

test('the CPU profile summary ranks self time and drops idle time', (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'perf-loop-profile-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'standard.cpuprofile');
    const frame = (functionName, line) => ({ functionName, url: 'http://127.0.0.1/assets/game-runtime-x.js', lineNumber: line, columnNumber: 0 });
    writeFileSync(file, JSON.stringify({
        nodes: [{ id: 1, callFrame: frame('(idle)', -1) }, { id: 2, callFrame: frame('checkGlobalCollision', 9) }, { id: 3, callFrame: frame('render', 19) }],
        samples: [1, 2, 2, 3, 1], timeDeltas: [5000, 3000, 3000, 2000, 5000],
    }));
    const rows = summarizeCpuProfile(file);
    assert.deepEqual(rows.map((row) => row.fn), ['checkGlobalCollision game-runtime-x.js:10:1', 'render game-runtime-x.js:20:1']);
    assert.equal(rows[0].selfMs, 6);
    assert.equal(rows[0].share, 0.75);
});
