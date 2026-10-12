#!/usr/bin/env node
// Measurement driver of the performance loop (.claude/skills/perf-loop).
//   measure  --baseline <dir> --candidate <dir> --target cpuUpdate|cpuRender|gpu|cpu [--label <slug>] [--maps a,b]
//            [--seconds 20] [--warmup 5] [--rounds 2] [--skip-build]
//   profile  --dir <dir> [--maps a,b] [--seconds 20] [--skip-build]
//   judge    <run-dir> [--target ...]
//   ledger   [--limit 30]
// Evidence and the ledger live outside the repository (AGENTS.md rule 10).
// Exit codes: 0 accept/ok, 3 rejected, 2 invalid measurement, 75 Playwright lock timeout, 1 error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { formatPerfLoopVerdict, judgePerfLoop, PERF_LOOP_TARGETS } from './perf-loop-judge.mjs';

const PROBE_SPEC = 'tests/perf-loop-probe.desktop.spec.js';
// A candidate must not be able to change how it is measured or judged.
const MEASUREMENT_FILES = [PROBE_SPEC, 'tests/helpers.desktop.js', 'tests/helpers.js', 'scripts/perf-loop.mjs', 'scripts/perf-loop-judge.mjs'];
const LOCK_TIMEOUT_EXIT_CODE = 75;
const HOME = process.env.CURVIOS_PERF_LOOP_HOME
    || path.join(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir(), 'curvios-perf-loop');
const LEDGER = path.join(HOME, 'ledger.jsonl');

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = { _: [] };
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index];
        if (!arg.startsWith('--')) { options._.push(arg); continue; }
        const key = arg.slice(2);
        const next = rest[index + 1];
        if (next === undefined || next.startsWith('--')) options[key] = true;
        else { options[key] = next; index++; }
    }
    return { command, options };
}

class ExitError extends Error {
    constructor(message, exitCode) { super(message); this.exitCode = exitCode; }
}

const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();

function describeCheckout(dir) {
    const resolved = path.resolve(dir);
    if (!existsSync(path.join(resolved, PROBE_SPEC))) throw new ExitError(`${resolved} has no ${PROBE_SPEC}`, 1);
    const diff = spawnSync('git', ['diff', 'HEAD'], { cwd: resolved, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }).stdout;
    return { dir: resolved, head: git(resolved, ['rev-parse', 'HEAD']), dirty: diff.length > 0,
        diffSha256: diff.length ? createHash('sha256').update(diff).digest('hex') : null };
}

function assertSameMeasurementFiles(baselineDir, candidateDir) {
    const hash = (dir, file) => createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex');
    const changed = MEASUREMENT_FILES.filter((file) => hash(baselineDir, file) !== hash(candidateDir, file));
    if (changed.length) throw new ExitError(`candidate changes measurement files: ${changed.join(', ')}`, 2);
}

function run(command, args, { cwd, env, logPath }) {
    const fd = openSync(logPath, 'a');
    try {
        // A command without separate arguments is a fixed shell line (npm is a .cmd shim on Windows).
        const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd],
            shell: args.length === 0 });
        return result.status ?? 1;
    } finally { closeSync(fd); }
}

function build(dir, logDir) {
    const logPath = path.join(logDir, `build-${path.basename(dir)}.log`);
    console.log(`[perf-loop] build:app:test in ${dir}`);
    if (run('npm run build:app:test', [], { cwd: dir, logPath }) !== 0) throw new ExitError(`build failed, see ${logPath}`, 1);
}

function runProbe(dir, runDir, options, extraEnv = {}) {
    mkdirSync(runDir, { recursive: true });
    const env = { PW_PERF_PROBE_OUT: runDir, PW_PERF_PROBE_MAPS: options.maps, PW_PERF_PROBE_SECONDS: String(options.seconds),
        PW_PERF_PROBE_WARMUP: String(options.warmup), CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS: process.env.CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS || String(2 * 3600 * 1000),
        ...extraEnv };
    const logPath = path.join(runDir, 'probe.log');
    const status = run(process.execPath, [path.join(dir, 'scripts', 'run-playwright-targeted.mjs'), PROBE_SPEC], { cwd: dir, env, logPath });
    if (status === LOCK_TIMEOUT_EXIT_CODE) throw new ExitError('Playwright lock timeout: another session held the machine, retry later', LOCK_TIMEOUT_EXIT_CODE);
    if (status !== 0) throw new ExitError(`probe failed (exit ${status}), see ${logPath}`, 1);
    if (/\[playwright:lock\] LOST/.test(readFileSync(logPath, 'utf8'))) throw new ExitError(`lost the Playwright lock during ${runDir}, results void`, 2);
    return Object.fromEntries(options.maps.split(',').map((mapKey) => [mapKey, JSON.parse(readFileSync(path.join(runDir, `${mapKey}.json`), 'utf8'))]));
}

const measureOptions = (options) => ({ maps: String(options.maps || 'standard,cherry_grove,dandelion_sky'),
    seconds: Number(options.seconds || 20), warmup: Number(options.warmup || 5) });
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function judgeRunDir(outDir, target = null) {
    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    const runs = manifest.runs.map((entry) => ({ arm: entry.arm,
        maps: Object.fromEntries(manifest.maps.split(',').map((mapKey) => [mapKey, JSON.parse(readFileSync(path.join(outDir, entry.dir, `${mapKey}.json`), 'utf8'))])) }));
    const verdict = judgePerfLoop(runs, { target: target || manifest.target || 'any' });
    writeFileSync(path.join(outDir, 'verdict.json'), JSON.stringify(verdict, null, 2));
    return { manifest, verdict };
}

function measure(options) {
    if (!options.baseline || !options.candidate) throw new ExitError('measure needs --baseline <dir> and --candidate <dir>', 1);
    // The hypothesis names its metric before measuring; judging every metric would let chance pick one.
    const target = String(options.target || 'any');
    if (target !== 'any' && !PERF_LOOP_TARGETS.includes(target)) throw new ExitError(`--target must be any or one of ${PERF_LOOP_TARGETS.join(', ')}`, 1);
    const baseline = describeCheckout(options.baseline), candidate = describeCheckout(options.candidate);
    assertSameMeasurementFiles(baseline.dir, candidate.dir);
    const settings = measureOptions(options);
    const label = String(options.label || 'unnamed');
    const outDir = path.join(HOME, 'runs', `${stamp()}-${label.replace(/[^a-z0-9-]+/gi, '-')}`);
    mkdirSync(outDir, { recursive: true });
    if (!options['skip-build']) {
        build(baseline.dir, outDir);
        if (candidate.dir !== baseline.dir) build(candidate.dir, outDir);
    }
    // Two ABBA rounds give four drift-cancelling pairs; one round (two pairs) is a quick screen only.
    const order = Array.from({ length: Number(options.rounds || 2) }, () => ['baseline', 'candidate', 'candidate', 'baseline']).flat();
    const manifest = { label, target, startedAt: new Date().toISOString(), baseline, candidate, ...settings, runs: [] };
    order.forEach((arm, index) => {
        const dir = `run-${String(index).padStart(2, '0')}-${arm}`;
        console.log(`[perf-loop] run ${index + 1}/${order.length}: ${arm}`);
        runProbe(arm === 'baseline' ? baseline.dir : candidate.dir, path.join(outDir, dir), settings);
        manifest.runs.push({ arm, dir });
        writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    });
    const { verdict } = judgeRunDir(outDir);
    console.log(formatPerfLoopVerdict(verdict));
    console.log(`[perf-loop] evidence: ${outDir}`);
    mkdirSync(HOME, { recursive: true });
    appendFileSync(LEDGER, `${JSON.stringify({ at: new Date().toISOString(), label, target, verdict: verdict.verdict,
        gains: Object.fromEntries(Object.entries(verdict.metrics || {}).map(([key, metric]) => [key, metric.gain])),
        reasons: verdict.reasons, baselineHead: baseline.head,
        candidateHead: candidate.head, candidateDirty: candidate.dirty, outDir })}\n`);
    return verdict.verdict === 'accept' ? 0 : verdict.verdict === 'invalid' ? 2 : 3;
}

function summarizeCpuProfile(file, limit = 20) {
    const profile = JSON.parse(readFileSync(file, 'utf8'));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const selfMs = new Map();
    profile.samples.forEach((id, index) => { selfMs.set(id, (selfMs.get(id) || 0) + (profile.timeDeltas[index] || 0) / 1000); });
    const totals = new Map();
    let total = 0;
    for (const [id, ms] of selfMs) {
        const { functionName, url, lineNumber, columnNumber } = nodes.get(id).callFrame;
        // Idle time is the frame budget left over, not work; garbage collection stays visible.
        if (functionName === '(idle)' || functionName === '(program)') continue;
        const key = `${functionName || '(anonymous)'} ${url ? `${url.replace(/^.*\/assets\//, '')}:${lineNumber + 1}:${columnNumber + 1}` : ''}`.trim();
        totals.set(key, (totals.get(key) || 0) + ms);
        total += ms;
    }
    return [...totals].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, ms]) => ({ fn: key, selfMs: ms, share: total ? ms / total : 0 }));
}

function profile(options) {
    if (!options.dir) throw new ExitError('profile needs --dir <dir>', 1);
    const checkout = describeCheckout(options.dir);
    const settings = measureOptions(options);
    const outDir = path.join(HOME, 'profiles', stamp());
    mkdirSync(outDir, { recursive: true });
    if (!options['skip-build']) build(checkout.dir, outDir);
    const reports = runProbe(checkout.dir, outDir, settings, { PW_PERF_PROBE_CPU_PROFILE: path.join(outDir, 'cpu') });
    for (const [mapKey, report] of Object.entries(reports)) {
        const { timing } = report;
        console.log(`\n[perf-loop] ${mapKey}: cpu mean ${timing.cpu.meanMs.toFixed(3)} ms (update ${timing.update.meanMs.toFixed(3)}, `
            + `render ${timing.render.meanMs.toFixed(3)}), p95 ${timing.cpu.p95Ms.toFixed(3)}, gpu median ${timing.gpu.medianMs}, `
            + `draw calls ${timing.renderInfo.meanCalls.toFixed(1)}, triangles ${Math.round(timing.renderInfo.meanTriangles)}`);
        const subsystems = Object.entries(timing.profiler?.subsystems || {}).filter(([, value]) => value.avg > 0)
            .sort((a, b) => b[1].avg - a[1].avg).map(([id, value]) => `${id}=${value.avg.toFixed(3)}`);
        if (subsystems.length) console.log(`[perf-loop] subsystems (ms/frame): ${subsystems.join(' ')}`);
        const cpuFile = path.join(outDir, 'cpu', `${mapKey}.cpuprofile`);
        if (!existsSync(cpuFile)) { console.log(`[perf-loop] no CPU profile: ${report.cpuProfileError || 'unknown reason'}`); continue; }
        for (const row of summarizeCpuProfile(cpuFile)) console.log(`  ${(row.share * 100).toFixed(1).padStart(5)}%  ${row.selfMs.toFixed(0).padStart(6)} ms  ${row.fn}`);
    }
    console.log(`\n[perf-loop] evidence: ${outDir}`);
    return 0;
}

function ledger(options) {
    if (!existsSync(LEDGER)) { console.log('[perf-loop] ledger is empty'); return 0; }
    const rows = readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    for (const row of rows.slice(-Number(options.limit || 30))) {
        const gains = Object.entries(row.gains || {}).map(([key, gain]) => `${key}=${(gain * 100).toFixed(1)}%`).join(' ') || 'n/a';
        console.log(`${row.at.slice(0, 16)}  ${row.verdict.padEnd(14)} ${String(row.target || 'any').padEnd(10)} ${gains.padEnd(60)} ${row.label}`
            + `${row.reasons.length ? `  (${row.reasons[0]})` : ''}`);
    }
    return 0;
}

export { summarizeCpuProfile };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const { command, options } = parseArgs(process.argv.slice(2));
    try {
        const commands = { measure, profile, ledger,
            judge: () => {
                const { verdict } = judgeRunDir(path.resolve(options._[0] || ''), options.target ? String(options.target) : null);
                console.log(formatPerfLoopVerdict(verdict));
                return verdict.verdict === 'accept' ? 0 : verdict.verdict === 'invalid' ? 2 : 3;
            } };
        if (!commands[command]) throw new ExitError(`unknown command "${command}"; use measure, profile, judge or ledger`, 1);
        process.exitCode = commands[command](options);
    } catch (error) {
        console.error(`[perf-loop] ${error.message}`);
        process.exitCode = error.exitCode ?? 1;
    }
}
