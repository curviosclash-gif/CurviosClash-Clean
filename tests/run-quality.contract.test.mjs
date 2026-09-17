import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    QUALITY_PHASE1_LIMIT,
    QUALITY_TASKS,
    createTaskRunner,
    formatQualitySummaryLine,
    formatTaskLines,
    isMainModule,
    parseQualityArgs,
    resolveNpmCliPath,
    resolveNpmRunArgs,
    resolveQualityExitCode,
    runQuality,
    runTasksWithLimit,
    selectPhaseTasks,
    shouldRunSecondPhase,
    stopChildTree,
} from '../scripts/run-quality.mjs';

function readPackageJson() {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
}

// Die Kette, die `quality` bis zum 17.09.2026 als eine einzige `&&`-Zeile in package.json
// war. Sie steht hier ausgeschrieben, weil die Zusage genau das ist: keine dieser neun
// Pruefungen faellt beim Umbau auf den Runner still heraus.
const FORMER_QUALITY_CHAIN = [
    'council:check',
    'lint',
    'typecheck:architecture',
    'typecheck:contracts',
    'check:architecture',
    'check:parcours',
    'test:contract:coverage',
    'test:dev:training',
    'test:contract:dist',
];

const SERIAL_TAIL = ['test:contract:coverage', 'test:dev:training', 'test:contract:dist'];

function okResult(name, durationMs = 1000) {
    return { name, status: 'ok', code: 0, durationMs };
}

function failedResult(name, durationMs = 1000) {
    return { name, status: 'failed', code: 1, durationMs };
}

test('the task list carries every command of the former quality chain exactly once', () => {
    const scriptNames = QUALITY_TASKS.map((task) => task.script);

    assert.deepEqual([...scriptNames].sort(), [...FORMER_QUALITY_CHAIN].sort());
    assert.equal(new Set(scriptNames).size, scriptNames.length, 'no npm script runs twice');
});

test('every task in the list is a real npm script', () => {
    const packageScripts = readPackageJson().scripts;

    for (const task of QUALITY_TASKS) {
        assert.ok(packageScripts[task.script], `package.json has no script ${task.script}`);
        assert.ok(task.name, 'every task carries a printable name');
        assert.ok(task.phase === 1 || task.phase === 2, `task ${task.script} has phase 1 or 2`);
    }
});

test('npm run quality delegates to the runner instead of chaining with &&', () => {
    const qualityScript = readPackageJson().scripts.quality;

    assert.match(qualityScript, /scripts\/run-quality\.mjs/);
    assert.doesNotMatch(qualityScript, /&&/);
});

test('phase 1 holds the six independent checks, phase 2 the serial tail in its old order', () => {
    const phaseOne = selectPhaseTasks(1).map((task) => task.script);
    const phaseTwo = selectPhaseTasks(2).map((task) => task.script);

    assert.deepEqual(phaseTwo, SERIAL_TAIL);
    assert.deepEqual(
        [...phaseOne].sort(),
        FORMER_QUALITY_CHAIN.filter((script) => !SERIAL_TAIL.includes(script)).sort()
    );
});

test('the two long checks are scheduled first so they overlap each other', () => {
    const phaseOne = selectPhaseTasks(1).map((task) => task.script);

    assert.deepEqual(phaseOne.slice(0, 2), ['lint', 'typecheck:architecture']);
});

test('the scheduler never runs more than the limit at once and starts in list order', async () => {
    const tasks = selectPhaseTasks(1);
    const started = [];
    let active = 0;
    let peak = 0;

    const results = await runTasksWithLimit(tasks, async (task) => {
        started.push(task.script);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return okResult(task.name);
    }, QUALITY_PHASE1_LIMIT);

    assert.equal(peak, QUALITY_PHASE1_LIMIT);
    assert.deepEqual(started.slice(0, QUALITY_PHASE1_LIMIT), tasks.slice(0, QUALITY_PHASE1_LIMIT).map((task) => task.script));
    assert.deepEqual(results.map((result) => result.name), tasks.map((task) => task.name));
});

test('a red task does not stop the others: every task still runs', async () => {
    const ran = [];

    const exitCode = await runQuality([], {
        env: {},
        log: () => {},
        now: (() => { let clock = 0; return () => { clock += 1000; return clock; }; })(),
        runTask: async (task) => {
            ran.push(task.script);
            return task.script === 'lint' ? failedResult(task.name) : okResult(task.name);
        },
    });

    assert.deepEqual([...ran].sort(), [...FORMER_QUALITY_CHAIN].sort());
    assert.equal(exitCode, 1);
});

test('--fail-fast stops before phase 2 but still reports all of phase 1', async () => {
    const ran = [];
    const lines = [];

    const exitCode = await runQuality(['--fail-fast'], {
        env: {},
        log: (line) => lines.push(String(line)),
        now: (() => { let clock = 0; return () => { clock += 1000; return clock; }; })(),
        runTask: async (task) => {
            ran.push(task.script);
            return task.script === 'lint' ? failedResult(task.name) : okResult(task.name);
        },
    });

    assert.deepEqual([...ran].sort(), selectPhaseTasks(1).map((task) => task.script).sort());
    assert.equal(exitCode, 1);

    const printed = lines.join('\n');
    for (const task of selectPhaseTasks(1)) {
        assert.match(printed, new RegExp(`\\[quality\\] ${task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`));
    }
    assert.match(printed, /skipped/);
    assert.match(lines.at(-1), /^\[quality:summary\] /);
});

test('without --fail-fast phase 2 runs even after a red phase 1', () => {
    const red = [failedResult('lint')];
    const green = [okResult('lint')];

    assert.equal(shouldRunSecondPhase(red, { failFast: false }), true);
    assert.equal(shouldRunSecondPhase(red, { failFast: true }), false);
    assert.equal(shouldRunSecondPhase(green, { failFast: true }), true);
});

test('the argument parser knows only --fail-fast', () => {
    assert.deepEqual(parseQualityArgs([], {}), { failFast: false });
    assert.deepEqual(parseQualityArgs(['--fail-fast'], {}), { failFast: true });
    assert.throws(() => parseQualityArgs(['--turbo'], {}), /--turbo/);
});

// npm 12 bricht `npm run quality -- --fail-fast` mit EUNKNOWNCONFIG ab und reicht nur
// Positionsargumente durch. Beide Ersatzwege muessen deshalb denselben Schalter setzen.
test('fail-fast is also reachable without a leading double dash', () => {
    assert.deepEqual(parseQualityArgs(['fail-fast'], {}), { failFast: true });
    assert.deepEqual(parseQualityArgs([], { CURVIOS_QUALITY_FAIL_FAST: '1' }), { failFast: true });
    assert.deepEqual(parseQualityArgs([], { CURVIOS_QUALITY_FAIL_FAST: '0' }), { failFast: false });
});

test('the exit code is green only when every task was proven green', () => {
    assert.equal(resolveQualityExitCode([okResult('a'), okResult('b')]), 0);
    assert.equal(resolveQualityExitCode([okResult('a'), failedResult('b')]), 1);
    assert.equal(resolveQualityExitCode([okResult('a'), { name: 'b', status: 'skipped', code: null, durationMs: 0 }]), 1);
    assert.equal(resolveQualityExitCode([okResult('a'), { name: 'b', status: 'timeout', code: null, durationMs: 0 }]), 1);
    assert.equal(resolveQualityExitCode([]), 1, 'a run without tasks has proven nothing');
});

test('the summary line is the machine-readable last line', () => {
    const results = [
        okResult('lint', 8800),
        failedResult('check:parcours', 400),
        failedResult('council:check', 400),
        { name: 'test:contract:dist', status: 'skipped', code: null, durationMs: 0 },
    ];

    assert.equal(
        formatQualitySummaryLine(results, 12345),
        '[quality:summary] passed=1 failed=2 skipped=1 durationMs=12345 failedTasks=check:parcours,council:check'
    );
    assert.equal(
        formatQualitySummaryLine([okResult('lint', 100)], 100),
        '[quality:summary] passed=1 failed=0 skipped=0 durationMs=100 failedTasks='
    );
});

test('the task table shows name, result and seconds per task', () => {
    const lines = formatTaskLines([
        okResult('lint', 8800),
        failedResult('check:parcours', 430),
        { name: 'test:contract:dist', status: 'skipped', code: null, durationMs: 0 },
    ]);

    assert.match(lines[0], /^\[quality\] lint\s+ok\s+8\.8s$/);
    assert.match(lines[1], /^\[quality\] check:parcours\s+FAILED\s+0\.4s$/);
    assert.match(lines[2], /^\[quality\] test:contract:dist\s+skipped\s/);
});

// --- npm start on Windows -------------------------------------------------------------

test('npm is started as node + npm-cli.js, never as a shell string', () => {
    const { command, args } = resolveNpmRunArgs('lint', {
        env: { npm_execpath: 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
        execPath: 'C:\\nodejs\\node.exe',
        fileExists: () => false,
    });

    assert.equal(command, 'C:\\nodejs\\node.exe');
    assert.deepEqual(args, ['C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'lint']);
});

test('started with plain node the runner finds npm next to the node binary', () => {
    const windowsCli = 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

    assert.equal(
        resolveNpmCliPath({}, 'C:\\nodejs\\node.exe', (candidate) => candidate === windowsCli),
        windowsCli
    );
    assert.throws(
        () => resolveNpmCliPath({}, 'C:\\nodejs\\node.exe', () => false),
        /npm-cli\.js/
    );
});

test('an npm_execpath that is not a JS file is ignored instead of spawned', () => {
    const windowsCli = 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';

    assert.equal(
        resolveNpmCliPath({ npm_execpath: 'C:\\nodejs\\npm.cmd' }, 'C:\\nodejs\\node.exe', (candidate) => candidate === windowsCli),
        windowsCli
    );
});

// --- spawn failures -------------------------------------------------------------------

function fakeChild({ error = null, code = 0 } = {}) {
    const listeners = new Map();
    const child = {
        stdout: null,
        stderr: null,
        killed: false,
        on(event, listener) {
            listeners.set(event, listener);
            return child;
        },
        kill() {
            child.killed = true;
        },
    };
    queueMicrotask(() => {
        if (error) listeners.get('error')?.(error);
        else listeners.get('close')?.(code, null);
    });
    return child;
}

test('a spawn error counts as red and settles instead of hanging', async () => {
    const runTask = createTaskRunner({
        log: () => {},
        now: (() => { let clock = 0; return () => { clock += 5; return clock; }; })(),
        env: { npm_execpath: 'npm-cli.js' },
        execPath: 'node',
        spawn: () => fakeChild({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }),
    });

    const result = await runTask({ name: 'lint', script: 'lint', phase: 1 });

    assert.equal(result.status, 'failed');
    assert.match(String(result.error), /ENOENT/);
});

test('the exit code of the npm child decides whether the task is green or red', async () => {
    const makeRunner = (code) => createTaskRunner({
        log: () => {},
        now: (() => { let clock = 0; return () => { clock += 5; return clock; }; })(),
        env: { npm_execpath: 'npm-cli.js' },
        execPath: 'node',
        spawn: () => fakeChild({ code }),
    });

    const green = await makeRunner(0)({ name: 'council:check', script: 'council:check', phase: 2 });
    assert.equal(green.status, 'ok');
    assert.equal(green.code, 0);

    const red = await makeRunner(2)({ name: 'lint', script: 'lint', phase: 1 });
    assert.equal(red.status, 'failed');
    assert.equal(red.code, 2);
});

test('a task that throws is reported red instead of stalling the phase', async () => {
    const results = await runTasksWithLimit(
        [{ name: 'lint', script: 'lint', phase: 1 }, { name: 'council:check', script: 'council:check', phase: 1 }],
        async (task) => {
            if (task.script === 'lint') throw new Error('boom');
            return okResult(task.name);
        },
        QUALITY_PHASE1_LIMIT
    );

    assert.equal(results[0].status, 'failed');
    assert.match(String(results[0].error), /boom/);
    assert.equal(results[1].status, 'ok');
});

// A child that was killed closes with code null. Writing `code ?? 0` would turn a shot lint
// run green, so the null case is pinned here.
test('a child that dies from a signal is red, never green', async () => {
    const runTask = createTaskRunner({
        log: () => {},
        now: () => 0,
        env: { npm_execpath: 'npm-cli.js' },
        execPath: 'node',
        spawn: () => fakeChild({ code: null }),
    });

    const result = await runTask({ name: 'lint', script: 'lint', phase: 1 });

    assert.equal(result.status, 'failed');
    assert.equal(result.code, null);
});

test('a spawn that throws and a missing npm-cli.js are red instead of a crash', async () => {
    const thrown = await createTaskRunner({
        log: () => {},
        now: () => 0,
        env: { npm_execpath: 'npm-cli.js' },
        execPath: 'node',
        spawn: () => { throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }); },
    })({ name: 'lint', script: 'lint', phase: 1 });
    assert.equal(thrown.status, 'failed');
    assert.match(String(thrown.error), /EPERM/);

    let spawned = false;
    const missing = await createTaskRunner({
        log: () => {},
        now: () => 0,
        env: {},
        execPath: 'node',
        fileExists: () => false,
        spawn: () => { spawned = true; return fakeChild(); },
    })({ name: 'lint', script: 'lint', phase: 1 });
    assert.equal(missing.status, 'failed');
    assert.match(String(missing.error), /npm-cli\.js/);
    assert.equal(spawned, false, 'nothing is started without a resolved npm');
});

test('the buffered block prints stdout and stderr under one header, umlauts intact', async () => {
    const lines = [];
    const encodings = [];
    const stream = (chunksToSend) => {
        const listeners = new Map();
        return {
            setEncoding: (encoding) => encodings.push(encoding),
            on: (event, listener) => listeners.set(event, listener),
            flush: () => chunksToSend.forEach((chunk) => listeners.get('data')?.(chunk)),
        };
    };
    const stdout = stream(['Pr\u00fcfung l\u00e4uft\n']);
    const stderr = stream(['1 problem\n']);
    const child = {
        stdout,
        stderr,
        on(event, listener) {
            if (event === 'close') queueMicrotask(() => { stdout.flush(); stderr.flush(); listener(1, null); });
            return child;
        },
    };

    await createTaskRunner({
        log: (line) => lines.push(String(line)),
        now: () => 0,
        env: { npm_execpath: 'npm-cli.js' },
        execPath: 'node',
        spawn: () => child,
    })({ name: 'lint', script: 'lint', phase: 1 });

    assert.deepEqual(encodings, ['utf8', 'utf8'], 'both streams decode as utf8, not chunk by chunk');
    assert.equal(lines.length, 1, 'one task, one block');
    assert.match(lines[0], /^\[quality\] lint - FAILED in /);
    assert.match(lines[0], /Pr\u00fcfung l\u00e4uft\n1 problem$/);
});

// The contract runs of phase 2 take nearly every core themselves and the dist build writes
// dist-app: they must never overlap each other or a check of phase 1.
test('phase 2 starts only after phase 1 is done and runs one task at a time', async () => {
    const finished = new Set();
    let active = 0;
    const phaseTwoObservations = [];

    await runQuality([], {
        env: {},
        log: () => {},
        now: () => 0,
        runTask: async (task) => {
            active += 1;
            if (task.phase === 2) {
                phaseTwoObservations.push({
                    active,
                    phaseOneDone: selectPhaseTasks(1).every((entry) => finished.has(entry.script)),
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            finished.add(task.script);
            return okResult(task.name);
        },
    });

    assert.equal(phaseTwoObservations.length, SERIAL_TAIL.length);
    for (const observation of phaseTwoObservations) {
        assert.deepEqual(observation, { active: 1, phaseOneDone: true });
    }
});

// CURVIOS_QUALITY_FAIL_FAST reaches the contract run of phase 2 through the environment. The
// tests above pass env: {} for that reason; this one proves the variable works on purpose.
test('the fail-fast variable is read from the injected environment', async () => {
    const ran = [];

    const exitCode = await runQuality([], {
        env: { CURVIOS_QUALITY_FAIL_FAST: '1' },
        log: () => {},
        now: () => 0,
        runTask: async (task) => {
            ran.push(task.script);
            return task.script === 'lint' ? failedResult(task.name) : okResult(task.name);
        },
    });

    assert.deepEqual([...ran].sort(), selectPhaseTasks(1).map((task) => task.script).sort());
    assert.equal(exitCode, 1);
});

// Drive letters and junctions are a Windows matter; fileURLToPath follows the host platform.
test('the main module check survives a junction and a different drive letter case', { skip: process.platform !== 'win32' }, () => {
    const moduleUrl = 'file:///F:/repo/scripts/run-quality.mjs';
    const viaJunction = (value) => String(value).replace(/^J:\\link/i, 'F:\\repo');

    assert.equal(isMainModule('J:\\link\\scripts\\run-quality.mjs', moduleUrl, { realpath: viaJunction, platform: 'win32' }), true);
    assert.equal(isMainModule('f:\\REPO\\scripts\\run-quality.mjs', moduleUrl, { realpath: viaJunction, platform: 'win32' }), true);
    assert.equal(isMainModule('F:\\repo\\tests\\other.mjs', moduleUrl, { realpath: viaJunction, platform: 'win32' }), false);
    assert.equal(isMainModule(undefined, moduleUrl), false);
});

test('stopping a child takes the whole process tree on Windows', () => {
    const calls = [];
    const child = { pid: 4711, killed: false, kill() { child.killed = true; } };

    stopChildTree(child, {
        platform: 'win32',
        spawnSyncFn: (command, args) => { calls.push([command, ...args]); return { status: 0 }; },
    });
    assert.deepEqual(calls, [['taskkill', '/pid', '4711', '/T', '/F']]);
    assert.equal(child.killed, false, 'taskkill already ended the tree');

    stopChildTree(child, { platform: 'win32', spawnSyncFn: () => ({ status: 128 }) });
    assert.equal(child.killed, true, 'a failing taskkill falls back to kill()');

    const posixChild = { pid: 1, killed: false, kill() { posixChild.killed = true; } };
    stopChildTree(posixChild, { platform: 'linux', spawnSyncFn: () => { throw new Error('must not run'); } });
    assert.equal(posixChild.killed, true);
});
