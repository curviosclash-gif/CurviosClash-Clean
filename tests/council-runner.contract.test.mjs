import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_REPAIR_ROUNDS,
    classifyLoopState,
    detectFindingOscillation,
    diffSnapshotFiles,
    evaluateRepairBudget,
    parseFindingsJson,
    selectGateCommands,
    selectRepairScopes,
    validateFinding,
} from '../scripts/council-loop-policy.mjs';
import { captureWorkingTreeSnapshot, createCouncilRunner } from '../scripts/council-runner.mjs';

const ROOT = process.cwd();

function finding(overrides = {}) {
    return {
        severity: '🟠',
        scope: 'review',
        file: 'src/runtime/example.js',
        line: 12,
        endLine: 15,
        category: 'null-guard',
        symbol: 'resolveExample',
        problem: 'A missing null guard crashes the runtime.',
        verifyRun1: 'TRUE',
        verifyRun2: 'TRUE',
        evidence: { type: 'test', detail: 'runtime-null-guard test fails before the fix' },
        ...overrides,
    };
}

function entry(findings, overrides = {}) {
    return {
        buildPassed: true,
        testsPassed: true,
        openFindings: findings,
        budget: { passed: true },
        ...overrides,
    };
}

test('finding schema generates deterministic IDs and accepts matching explicit IDs', () => {
    const first = validateFinding(finding(), { repositoryRoot: ROOT });
    const second = validateFinding({ ...finding(), id: first.id }, { repositoryRoot: ROOT });
    assert.equal(first.id, second.id);
    assert.match(first.id, /^review:null-guard:[a-f0-9]{12}$/);
    const shifted = validateFinding(finding({ line: 120, endLine: 125 }), { repositoryRoot: ROOT });
    assert.equal(first.id, shifted.id);
});

test('finding schema rejects traversal, invalid enums, duplicate IDs, and missing evidence', () => {
    assert.throws(() => validateFinding(finding({ file: '../secret.txt' }), { repositoryRoot: ROOT }), /nicht verlassen/);
    assert.throws(() => validateFinding(finding({ scope: 'unknown' }), { repositoryRoot: ROOT }), /Scope/);
    assert.throws(() => validateFinding(finding({ symbol: '' }), { repositoryRoot: ROOT }), /symbol/);
    assert.throws(() => validateFinding(finding({ evidence: undefined }), { repositoryRoot: ROOT }), /Evidence/);
    assert.throws(() => parseFindingsJson(JSON.stringify([finding(), finding()]), { repositoryRoot: ROOT }), /Doppelte Finding-ID/);
});

test('unconfirmed and minor findings never activate repair scopes', () => {
    const unconfirmed = validateFinding(finding({ verifyRun2: 'UNCERTAIN', evidence: undefined }), { repositoryRoot: ROOT });
    const minor = validateFinding(finding({ severity: '🟡', evidence: undefined }), { repositoryRoot: ROOT });
    assert.deepEqual(selectRepairScopes([unconfirmed, minor]), []);
});

test('confirmed critical and major findings activate only their responsible scopes', () => {
    const review = validateFinding(finding(), { repositoryRoot: ROOT });
    const security = validateFinding(finding({ severity: '🔴', scope: 'sec', category: 'trust-boundary' }), { repositoryRoot: ROOT });
    assert.deepEqual(selectRepairScopes([review, security]), ['review', 'sec']);
});

test('loop exits with specific build, test, verification, regression, budget, and pass reasons', () => {
    const confirmed = validateFinding(finding(), { repositoryRoot: ROOT });
    assert.equal(classifyLoopState([entry([confirmed], { buildPassed: false })]).reason, 'build_failed');
    assert.equal(classifyLoopState([entry([confirmed], { testsPassed: false })]).reason, 'tests_failed');
    assert.equal(classifyLoopState([entry([confirmed], { verificationDisagreed: true })]).reason, 'verification_disagreed');
    assert.equal(classifyLoopState([entry([confirmed], { regressionIntroduced: true })]).reason, 'regression_introduced');
    assert.equal(classifyLoopState([entry([confirmed], { budget: { passed: false } })]).reason, 'repair_budget_exceeded');
    assert.equal(classifyLoopState([entry([])]).reason, 'passed');
});

test('persistent IDs and finding reappearance stop repair churn', () => {
    const confirmed = validateFinding(finding(), { repositoryRoot: ROOT });
    assert.equal(classifyLoopState([entry([confirmed]), entry([confirmed])]).reason, 'finding_persisted');
    assert.equal(detectFindingOscillation([entry([confirmed]), entry([]), entry([confirmed])]), true);
    assert.equal(classifyLoopState([entry([confirmed]), entry([]), entry([confirmed])]).reason, 'oscillation_detected');
});

test('baseline snapshot isolates unchanged pre-existing worktree files', () => {
    assert.deepEqual(diffSnapshotFiles({ 'user.js': 'same' }, { 'user.js': 'same', 'council.js': 'new' }), ['council.js']);
    assert.deepEqual(diffSnapshotFiles({ 'created-then-deleted.js': 'old' }, {}), ['created-then-deleted.js']);
    const deleted = captureWorkingTreeSnapshot(ROOT, (args) => args[0] === 'ls-files' ? 'missing-file.js\n' : 'unexpected');
    assert.deepEqual(deleted, { 'missing-file.js': '__deleted__' });
});

test('repair budget rejects dependency, contract, delete/rename, and excessive file expansion', () => {
    const confirmed = validateFinding(finding(), { repositoryRoot: ROOT });
    const result = evaluateRepairBudget({
        iteration: 2,
        findings: [confirmed],
        changedFiles: ['src/runtime/example.js', 'package.json', 'src/shared/contracts/Foo.js', 'a.js', 'b.js', 'c.js', 'd.js', 'e.js'],
        nameStatuses: [{ status: 'D', file: 'a.js' }],
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.violations.sort(), ['additional_files:7', 'delete_or_rename', 'dependency_change', 'public_contract_change']);
});

test('gate selection is path-aware and final verification remains desktop-first', () => {
    assert.deepEqual(selectGateCommands(['scripts/council-runner.mjs']), [
        { kind: 'test', command: 'npm run council:check' },
        { kind: 'test', command: 'npm run council:test' },
    ]);
    const finalCommands = selectGateCommands(['electron/main.cjs'], { final: true }).map((item) => item.command);
    assert.deepEqual(finalCommands, ['npm run build:app', 'npm run test:contract:fast']);
    assert.deepEqual(selectGateCommands(['server/session.mjs']).map((item) => item.command), ['npm run test:contract:fast']);
    assert.deepEqual(selectGateCommands(['editor/map.js']).map((item) => item.command), ['npm run build:app', 'npm run test:editor-ui']);
    assert.deepEqual(selectGateCommands(['src/physics/collision.js']).map((item) => item.command), ['npm run test:physics']);
});

function memoryStorage() {
    let value = null;
    return {
        load: () => value && structuredClone(value),
        save: (state) => { value = structuredClone(state); },
        reset: () => { value = null; },
        read: () => value,
    };
}

function fakeGit(snapshotRef) {
    return (args) => {
        if (args[0] === 'ls-files') return `${Object.keys(snapshotRef.current).join('\n')}\n`;
        if (args[0] === 'hash-object') return `${snapshotRef.current[args.at(-1)]}\n`;
        if (args[0] === 'diff' && args[1] === '--name-status') return '';
        if (args[0] === 'diff' && args[1] === '--numstat') return '4\t1\tscripts/council-runner.mjs\n';
        throw new Error(`Unexpected git call: ${args.join(' ')}`);
    };
}

test('runner performs initial pass, focused repair, and hard two-round cap without filesystem artifacts', () => {
    assert.equal(MAX_REPAIR_ROUNDS, 2);
    const snapshots = { current: {} };
    const storage = memoryStorage();
    const commands = [];
    const output = [];
    const run = createCouncilRunner({
        repositoryRoot: ROOT,
        storage,
        git: fakeGit(snapshots),
        execute: (command) => { commands.push(command); return ''; },
        write: (text) => output.push(text),
        maxIterations: 3,
    });

    assert.equal(run(['init', 'repair task']), 0);
    assert.equal(run(['next']), 0);
    snapshots.current = { 'scripts/council-runner.mjs': 'v1' };
    assert.equal(run(['record', '0', '0', '0', '[]']), 0);
    assert.equal(storage.read().exitReason, 'passed');
    assert.deepEqual(commands, ['npm run council:check', 'npm run council:test', 'npm run build:app', 'npm run test:contract:fast']);
    assert.match(output.join(''), /Vollständiger Plan/);

    const repairStorage = memoryStorage();
    const repairSnapshots = { current: {} };
    const repairOutput = [];
    const repairRun = createCouncilRunner({
        repositoryRoot: ROOT,
        storage: repairStorage,
        git: fakeGit(repairSnapshots),
        execute: () => '',
        write: (text) => repairOutput.push(text),
        maxIterations: 3,
    });
    repairRun(['init', 'focused']);
    repairRun(['next']);
    repairSnapshots.current = { 'scripts/council-runner.mjs': 'repair-v1' };
    const confirmed = JSON.stringify([finding()]);
    assert.throws(() => repairRun(['record', '0', '0', '0', confirmed]), /Zähler/);
    assert.equal(repairRun(['record', '0', '1', '0', confirmed]), 0);
    assert.equal(repairStorage.read().converged, false);
    repairRun(['next']);
    assert.deepEqual(repairStorage.read().activeScopes, ['review']);
    assert.match(repairOutput.join(''), /Nur die gelisteten/);
    assert.match(repairOutput.join(''), /Evidence \(test\)/);
    repairSnapshots.current = { 'scripts/council-runner.mjs': 'repair-v2' };
    assert.equal(repairRun(['record', '0', '0', '0', '[]']), 0);
    assert.equal(repairStorage.read().exitReason, 'passed');

    const cappedStorage = memoryStorage();
    const cappedRun = createCouncilRunner({ repositoryRoot: ROOT, storage: cappedStorage, git: fakeGit({ current: {} }), execute: () => '', write: () => {}, maxIterations: 3 });
    cappedRun(['init', 'cap']);
    cappedRun(['next']);
    cappedStorage.read().converged = false;
    cappedRun(['next']);
    cappedRun(['next']);
    cappedRun(['next']);
    assert.equal(cappedStorage.read().exitReason, 'max_iterations');
});
