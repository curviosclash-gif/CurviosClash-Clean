import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';

import {
    ARTIFACT_MAX_AGE_DAYS,
    DAY_MS,
    MIN_FREE_BYTES,
    assertEnoughFreeSpace,
    classifyElectronProcesses,
    detectStaleRunLock,
    formatHygieneLine,
    isDeletablePath,
    listWorktrees,
    minFreeBytes,
    resolveAllowedRoots,
    resolveFreeBytes,
    selectStaleArtifacts,
} from '../scripts/test-hygiene.mjs';

const REPO_ROOT = path.resolve('.');

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('only the known throwaway roots may be deleted', () => {
    const allowedRoots = resolveAllowedRoots(REPO_ROOT, tmpdir());

    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'test-results', 'run-1'), allowedRoots), true);
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'playwright-report', 'run-1'), allowedRoots), true);
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'tmp', 'playwright', 'run-1'), allowedRoots), true);
    assert.equal(isDeletablePath(path.join(tmpdir(), 'curvios-recorder-42'), allowedRoots), true);

    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'src', 'core'), allowedRoots), false);
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'tests', 'core.spec.js'), allowedRoots), false);
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'tmp', 'contract', '2026-09-16T00-00-00-000Z'), allowedRoots), true);

    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'tmp', 'contract'), allowedRoots), false, 'roots themselves stay');
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'test-results'), allowedRoots), false);
    assert.equal(isDeletablePath(path.join(tmpdir(), 'other-session'), allowedRoots), false);
    assert.equal(isDeletablePath('', allowedRoots), false);
    assert.equal(isDeletablePath(path.join(REPO_ROOT, 'test-results', '..', 'src'), allowedRoots), false);
});

// Review finding 16.09.2026: the curvios- restriction used to hinge on a string compare with the
// global tmpdir(); a different tempRoot silently made the whole folder deletable.
test('the temp restriction follows the configured temp root, not the global one', () => {
    const otherTemp = path.join(REPO_ROOT, 'tmp', 'fake-temp');
    const allowedRoots = resolveAllowedRoots(REPO_ROOT, otherTemp);
    assert.equal(isDeletablePath(path.join(otherTemp, 'curvios-menu-lan-x'), allowedRoots), true);
    assert.equal(isDeletablePath(path.join(otherTemp, 'someone-elses-dir'), allowedRoots), false);
});

test('the free space guard looks at the fuller of repo and temp drive', () => {
    assert.equal(minFreeBytes(8 * 1024 ** 3, 1024 ** 3), 1024 ** 3);
    assert.equal(minFreeBytes(null, 5), 5);
    assert.equal(minFreeBytes(null, null), null);
});

test('a lock file whose holder is gone is reported, never deleted', () => {
    const lockPath = path.join(REPO_ROOT, 'tmp', `hygiene-lock-test-${process.pid}.lock`);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, label: 'dead run' }));
        const stale = detectStaleRunLock(lockPath, () => false);
        assert.deepEqual(stale, { path: lockPath, pid: 999999, label: 'dead run' });
        assert.equal(detectStaleRunLock(lockPath, () => true), null, 'a living holder is not stale');
        assert.equal(fs.existsSync(lockPath), true, 'the report never removes the lock');
        assert.equal(detectStaleRunLock(`${lockPath}.missing`, () => false), null);
    } finally {
        fs.rmSync(lockPath, { force: true });
    }
    const source = readRepoFile('scripts/test-hygiene.mjs');
    assert.doesNotMatch(source, /rmSync\([^)]*lock/i, 'the hygiene tool must not delete lock files');
});

test('only artifacts older than the age limit are offered for removal', () => {
    const now = Date.UTC(2026, 8, 15, 12, 0, 0);
    const entries = [
        { path: 'test-results/fresh', mtimeMs: now - DAY_MS },
        { path: 'test-results/old', mtimeMs: now - 9 * DAY_MS },
        { path: 'test-results/exactly-at-limit', mtimeMs: now - ARTIFACT_MAX_AGE_DAYS * DAY_MS },
        { path: 'test-results/broken', mtimeMs: Number.NaN },
    ];

    const stale = selectStaleArtifacts(entries, now, ARTIFACT_MAX_AGE_DAYS);
    assert.deepEqual(stale.map((entry) => entry.path), [
        'test-results/old',
        'test-results/exactly-at-limit',
    ]);
    assert.equal(stale[0].ageDays, 9);
    assert.equal(selectStaleArtifacts(entries, now, 2).length, 2);
    assert.equal(selectStaleArtifacts([], now).length, 0);
});

test('an Electron process counts as orphaned only with a test switch and a dead parent', () => {
    const livingParents = new Set([4242]);
    const classified = classifyElectronProcesses([
        { ProcessId: 11, ParentProcessId: 4242, CommandLine: 'electron.exe . --remote-debugging-port=0' },
        { ProcessId: 12, ParentProcessId: 9999, CommandLine: 'electron.exe . --remote-debugging-port=0' },
        { ProcessId: 13, ParentProcessId: 9999, CommandLine: 'electron.exe . --inspect=0' },
        { ProcessId: 14, ParentProcessId: 9999, CommandLine: 'electron.exe .' },
        { ProcessId: 0, ParentProcessId: 9999, CommandLine: 'electron.exe . --inspect=0' },
    ], {
        ownPid: 777,
        isProcessAlive: (pid) => livingParents.has(pid),
    });

    assert.deepEqual(classified.orphaned.map((entry) => entry.pid), [12, 13]);
    assert.deepEqual(classified.attached.map((entry) => entry.pid), [11]);
    assert.deepEqual(classified.ignored.map((entry) => entry.reason), ['not-a-test-process', 'invalid-pid']);
});

test('the hygiene tool never proposes killing its own process', () => {
    const classified = classifyElectronProcesses([
        { ProcessId: 4711, ParentProcessId: 1, CommandLine: 'electron.exe . --inspect=0' },
    ], {
        ownPid: 4711,
        isProcessAlive: () => false,
    });

    assert.equal(classified.orphaned.length, 0);
    assert.equal(classified.ignored[0].reason, 'invalid-pid');
});

test('the free space guard stops a run before it dies of ENOSPC', () => {
    assert.equal(MIN_FREE_BYTES, 2 * 1024 ** 3);
    assert.equal(assertEnoughFreeSpace(8 * 1024 ** 3).ok, true);
    assert.equal(assertEnoughFreeSpace(MIN_FREE_BYTES).ok, true);
    assert.equal(assertEnoughFreeSpace(null).ok, true, 'an unknown drive must not block the run');

    const tooFull = assertEnoughFreeSpace(1024 ** 3);
    assert.equal(tooFull.ok, false);
    assert.match(tooFull.message, /^\[test:hygiene\] only 1 GB free, need 2 GB/);
});

test('the report line stays a single parseable line', () => {
    const line = formatHygieneLine({
        freeBytes: 8 * 1024 ** 3,
        staleArtifacts: [{ path: 'a' }, { path: 'b' }],
        staleTempDirs: [{ path: 'c' }],
        processes: { orphaned: [{ pid: 1 }] },
        worktrees: ['x', 'y', 'z'],
    });

    assert.equal(
        line,
        '[test:hygiene] freeGb=8 staleArtifacts=2 staleTempDirs=1 orphanElectron=1 worktrees=3'
    );
    assert.equal(line.includes('\n'), false);

    const withTempAndLock = formatHygieneLine({
        freeBytes: 1024 ** 3,
        freeBytesTemp: 1024 ** 3,
        staleLock: { pid: 1, label: 'x', path: 'y' },
        staleArtifacts: [],
        staleTempDirs: [],
        processes: { orphaned: [] },
        worktrees: [],
    });
    assert.equal(
        withTempAndLock,
        '[test:hygiene] freeGb=1 freeGbTemp=1 staleArtifacts=0 staleTempDirs=0 orphanElectron=0 worktrees=0 staleLock=1'
    );
});

test('the free space reader survives an unknown drive', () => {
    assert.equal(resolveFreeBytes('Z:/definitely/not/mounted', () => { throw new Error('ENOENT'); }), null);
    assert.equal(resolveFreeBytes('.', () => ({ bavail: 10, bsize: 1024 })), 10240);
});

test('worktrees are listed, never removed', () => {
    const source = readRepoFile('scripts/test-hygiene.mjs');
    assert.ok(source.includes("'worktree', 'list', '--porcelain'"), 'worktrees come from git, not from the disk');
    assert.doesNotMatch(source, /rmSync\([^)]*worktree/i);

    const worktrees = listWorktrees((command, args) => {
        assert.equal(command, 'git');
        assert.deepEqual(args, ['worktree', 'list', '--porcelain']);
        return {
            status: 0,
            stdout: 'worktree F:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree F:/repo/.claude/worktrees/a\n',
        };
    }, REPO_ROOT);
    assert.deepEqual(worktrees, ['F:/repo', 'F:/repo/.claude/worktrees/a']);
});

test('the hygiene report is wired into npm and into the cluster runner', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    assert.equal(packageJson.scripts['test:hygiene'], 'node scripts/test-hygiene.mjs');

    const runnerSource = readRepoFile('scripts/run-playwright-targeted-clusters.mjs');
    assert.ok(runnerSource.includes('test-hygiene.mjs'), 'the cluster runner must report hygiene before it starts');
    assert.ok(runnerSource.includes('assertEnoughFreeSpace'), 'the cluster runner must stop on a full drive');
});
