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
    applyHygiene,
    assertEnoughFreeSpace,
    classifyElectronProcesses,
    classifyRemovalTarget,
    collectHygieneReport,
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

// --- links are never followed ------------------------------------------------
// A junction inside (or in place of) a throwaway root used to be indistinguishable from a
// real directory, because the listing used statSync. Everything below runs in a private
// temp tree; the real repo roots are never touched.

function makeSandbox() {
    const base = fs.mkdtempSync(path.join(tmpdir(), 'curvios-hygiene-links-'));
    const sandbox = {
        base,
        repoRoot: path.join(base, 'repo'),
        fakeTemp: path.join(base, 'temp'),
        outside: path.join(base, 'outside'),
        links: [],
    };
    fs.mkdirSync(sandbox.repoRoot, { recursive: true });
    fs.mkdirSync(sandbox.fakeTemp, { recursive: true });
    fs.mkdirSync(sandbox.outside, { recursive: true });
    return sandbox;
}

function makeDirectoryWithFile(directoryPath, fileName = 'keep.txt') {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.writeFileSync(path.join(directoryPath, fileName), 'survive');
    return path.join(directoryPath, fileName);
}

function ageDirectory(directoryPath, days) {
    const seconds = (Date.now() - days * DAY_MS) / 1000;
    fs.utimesSync(directoryPath, seconds, seconds);
}

function linkDirectory(sandbox, targetPath, linkPath, t) {
    try {
        fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        sandbox.links.push(linkPath);
        return true;
    } catch (error) {
        t.skip(`directory links are not available here: ${error?.code || error}`);
        return false;
    }
}

function dropSandbox(sandbox) {
    // Unhook every link first: cleaning up must never reach into a link target.
    for (const link of sandbox.links) {
        try {
            if (!fs.lstatSync(link).isSymbolicLink()) continue;
            try { fs.unlinkSync(link); } catch { fs.rmdirSync(link); }
        } catch { /* already gone */ }
    }
    fs.rmSync(sandbox.base, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}

function runHygiene(sandbox, { now = Date.now() } = {}) {
    const report = collectHygieneReport({
        repoRoot: sandbox.repoRoot,
        tempRoot: sandbox.fakeTemp,
        now,
        readProcessList: () => [],
        listWorktreePaths: () => [],
    });
    return { report, applied: applyHygiene(report) };
}

test('a stale entry that is a link is skipped, never followed', (t) => {
    const sandbox = makeSandbox();
    try {
        const target = path.join(sandbox.outside, 'target');
        const keptFile = makeDirectoryWithFile(target);
        const linkPath = path.join(sandbox.repoRoot, 'test-results', 'linked-run');
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        if (!linkDirectory(sandbox, target, linkPath, t)) return;
        const plainOld = path.join(sandbox.repoRoot, 'test-results', 'plain-old-run');
        makeDirectoryWithFile(plainOld, 'trace.zip');

        // The listing reads the link's own date (lstat), and a fresh link is never stale. The
        // clock is moved instead, so the link is old enough and only the link filter saves it.
        const { report, applied } = runHygiene(sandbox, { now: Date.now() + 30 * DAY_MS });

        assert.deepEqual(applied.removed.map((entry) => path.basename(entry)), ['plain-old-run'], 'the clock really made things stale');
        assert.equal(fs.existsSync(keptFile), true, 'the link target keeps its content');
        assert.equal(fs.existsSync(linkPath), true, 'a skipped entry is left alone, not unhooked');
        assert.ok(
            report.skippedLinks.some((entry) => path.resolve(entry.path) === path.resolve(linkPath) && entry.reason),
            'the report names the skipped link and why'
        );
        assert.equal(
            report.staleArtifacts.some((entry) => path.resolve(entry.path) === path.resolve(linkPath)),
            false,
            'a link never becomes a removal candidate'
        );
        assert.equal(classifyRemovalTarget(linkPath, report.allowedRoots).ok, false);
        assert.match(classifyRemovalTarget(linkPath, report.allowedRoots).reason, /link/);
    } finally {
        dropSandbox(sandbox);
    }
});

test('a real stale folder is still removed, and a link inside it is only unhooked', (t) => {
    const sandbox = makeSandbox();
    try {
        const target = path.join(sandbox.outside, 'node-modules-target');
        const keptFile = makeDirectoryWithFile(target);
        const holder = path.join(sandbox.repoRoot, 'test-results', 'old-run');
        makeDirectoryWithFile(holder, 'trace.zip');
        if (!linkDirectory(sandbox, target, path.join(holder, 'node_modules'), t)) return;
        const plainOld = path.join(sandbox.repoRoot, 'test-results', 'plain-old-run');
        makeDirectoryWithFile(plainOld, 'trace.zip');
        const fresh = path.join(sandbox.repoRoot, 'test-results', 'fresh-run');
        makeDirectoryWithFile(fresh, 'trace.zip');
        ageDirectory(holder, 30);
        ageDirectory(plainOld, 30);

        const { applied } = runHygiene(sandbox);

        assert.equal(fs.existsSync(keptFile), true, 'the link target keeps its content');
        assert.equal(fs.existsSync(holder), false, 'the stale folder itself is gone');
        assert.equal(fs.existsSync(plainOld), false, 'the tool still does its job');
        assert.equal(fs.existsSync(fresh), true, 'a fresh folder stays');
        assert.equal(applied.removed.length, 2);
    } finally {
        dropSandbox(sandbox);
    }
});

test('a root that is itself a link is left out completely', (t) => {
    const sandbox = makeSandbox();
    try {
        const target = path.join(sandbox.outside, 'reports');
        const staleChild = path.join(target, 'old-report');
        const keptFile = makeDirectoryWithFile(staleChild);
        ageDirectory(staleChild, 30);
        const rootPath = path.join(sandbox.repoRoot, 'playwright-report');
        if (!linkDirectory(sandbox, target, rootPath, t)) return;

        const { report, applied } = runHygiene(sandbox);

        assert.equal(fs.existsSync(keptFile), true, 'nothing under the link target is removed');
        assert.equal(fs.existsSync(staleChild), true);
        assert.deepEqual(applied.removed, []);
        assert.ok(
            report.skippedRoots.some((entry) => path.resolve(entry.path) === path.resolve(rootPath) && entry.reason),
            'the report names the skipped root and why'
        );
        assert.equal(report.staleArtifacts.length, 0, 'children of a linked root are never listed');
        assert.equal(
            classifyRemovalTarget(path.join(rootPath, 'old-report'), report.allowedRoots).ok,
            false,
            'even a hand-made candidate under a linked root is refused'
        );
    } finally {
        dropSandbox(sandbox);
    }
});

// Only direct children reach the tool today, so this guard needs a hand-made deeper path: a
// link BETWEEN root and entry resolves somewhere else and must be refused.
test('a candidate behind a link inside the root resolves outside and is refused', (t) => {
    const sandbox = makeSandbox();
    try {
        const target = path.join(sandbox.outside, 'target');
        const keptFile = makeDirectoryWithFile(path.join(target, 'child'));
        const holder = path.join(sandbox.repoRoot, 'test-results', 'run');
        fs.mkdirSync(holder, { recursive: true });
        if (!linkDirectory(sandbox, target, path.join(holder, 'link'), t)) return;
        const { report } = runHygiene(sandbox);

        const verdict = classifyRemovalTarget(path.join(holder, 'link', 'child'), report.allowedRoots);

        assert.deepEqual(verdict, { ok: false, reason: 'resolves-outside-its-root' });
        assert.equal(fs.existsSync(keptFile), true);
    } finally {
        dropSandbox(sandbox);
    }
});

test('the report line names skipped roots and links only when there are any', () => {
    const base = { freeBytes: 8 * 1024 ** 3, staleArtifacts: [], staleTempDirs: [], processes: { orphaned: [] }, worktrees: [] };

    assert.equal(
        formatHygieneLine({ ...base, skippedRoots: [{ path: 'r' }], skippedLinks: [{ path: 'a' }, { path: 'b' }] }),
        '[test:hygiene] freeGb=8 staleArtifacts=0 staleTempDirs=0 orphanElectron=0 worktrees=0 skippedRoots=1 skippedLinks=2'
    );
    assert.doesNotMatch(formatHygieneLine({ ...base, skippedRoots: [], skippedLinks: [] }), /skipped/);
});

test('a stale temp folder with the curvios prefix is still removed', () => {
    const sandbox = makeSandbox();
    try {
        const stale = path.join(sandbox.fakeTemp, 'curvios-menu-lan-old');
        makeDirectoryWithFile(stale, 'profile.json');
        ageDirectory(stale, 30);
        const foreign = path.join(sandbox.fakeTemp, 'someone-else');
        makeDirectoryWithFile(foreign, 'profile.json');
        ageDirectory(foreign, 30);

        const { applied } = runHygiene(sandbox);

        assert.equal(fs.existsSync(stale), false);
        assert.equal(fs.existsSync(foreign), true, 'foreign temp folders stay untouched');
        assert.deepEqual(applied.removed.map((entry) => path.basename(entry)), ['curvios-menu-lan-old']);
    } finally {
        dropSandbox(sandbox);
    }
});

test('the hygiene report is wired into npm and into the cluster runner', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    assert.equal(packageJson.scripts['test:hygiene'], 'node scripts/test-hygiene.mjs');

    const runnerSource = readRepoFile('scripts/run-playwright-targeted-clusters.mjs');
    assert.ok(runnerSource.includes('test-hygiene.mjs'), 'the cluster runner must report hygiene before it starts');
    assert.ok(runnerSource.includes('assertEnoughFreeSpace'), 'the cluster runner must stop on a full drive');
});
