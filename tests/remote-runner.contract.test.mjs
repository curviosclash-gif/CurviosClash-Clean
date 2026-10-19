import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
    REMOTE_EXIT_QUEUE_TIMEOUT,
    REMOTE_REPO,
    REMOTE_TARGET_PATTERN,
    decidePush,
    exitCodeForRun,
    extractSummaryLines,
    findRunByLabel,
    parseRemoteArgs,
} from '../scripts/run-remote-tests.mjs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const workflow = readRepoFile('.github/workflows/remote-desktop.yml');
const installer = readRepoFile('scripts/remote-runner/install-remote-runner.ps1');

test('the remote workflow can only be started by hand, never by pushes or foreign pull requests', () => {
    const triggerBlock = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    assert.match(triggerBlock, /workflow_dispatch:/);
    for (const trigger of ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'issue_comment']) {
        assert.doesNotMatch(triggerBlock, new RegExp(`^\\s+${trigger}:`, 'm'), `${trigger} must not reach the machine`);
    }
    assert.match(workflow, /^permissions:\n {2}contents: read$/m);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, new RegExp(`github\\.repository == '${REMOTE_REPO}'`));
    assert.doesNotMatch(workflow, /^concurrency:/m, 'a concurrency group would cancel queued agent runs');
});

test('only the remote workflow targets the self-hosted machine', () => {
    const workflowDir = new URL('../.github/workflows/', import.meta.url);
    const selfHosted = readdirSync(workflowDir)
        .filter((fileName) => /\.ya?ml$/.test(fileName))
        .filter((fileName) => /self-hosted/.test(readFileSync(new URL(fileName, workflowDir), 'utf8')));
    assert.deepEqual(selfHosted, ['remote-desktop.yml']);
});

test('dispatch inputs reach the shell only through validated environment variables', () => {
    const runBlocks = [...workflow.matchAll(/run: \|\n((?: {10}.*\n?)+)/g)].map((match) => match[1]).join('\n');
    assert.doesNotMatch(runBlocks, /\$\{\{/, 'no ${{ }} expansion inside scripts (script injection)');
    assert.match(workflow, /REMOTE_TARGETS: \$\{\{ inputs\.targets \}\}/);
    assert.ok(workflow.includes(REMOTE_TARGET_PATTERN.source.replace(/\\\//g, '/')), 'workflow and CLI share the target pattern');
    assert.match(workflow, /--skip-known/);
    const lockWait = Number(/CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS: '(\d+)'/.exec(workflow)?.[1]);
    assert.ok(lockWait >= 2 * 60 * 60 * 1000, 'stage-3 runs wait at least two hours for the lock');
});

test('the workflow refuses an elevated runner or one running as a Windows service', () => {
    assert.match(workflow, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    assert.match(workflow, /SessionId -eq 0/);
});

test('the installer pins a verified runner, stays unelevated and never installs a service', () => {
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(installer), 'Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI; keep it ASCII');
    const version = /\$RunnerVersion = '(\d+\.\d+\.\d+)'/.exec(installer)?.[1];
    assert.ok(version, 'runner version is pinned');
    assert.match(installer, /\$RunnerSha256 = '[0-9a-f]{64}'/);
    assert.match(installer, /Get-FileHash -LiteralPath \$zipPath -Algorithm SHA256/);
    assert.match(installer, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    assert.match(installer, /\/inheritance:r/);
    assert.doesNotMatch(installer, /--runasservice/);
    assert.match(installer, /Read-Host -Prompt \$Prompt -AsSecureString/);
    const label = /\$RunnerLabel = '([a-z-]+)'/.exec(installer)?.[1];
    assert.match(workflow, new RegExp(`runs-on: \\[self-hosted, Windows, X64, ${label}\\]`));
    assert.match(installer, new RegExp(`\\$RepoUrl = 'https://github\\.com/${REMOTE_REPO}'`));
});

test('the readiness check only reads, stays ASCII and refuses nothing silently', () => {
    const check = readRepoFile('scripts/remote-runner/check-remote-machine.ps1');
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(check), 'Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI; keep it ASCII');
    for (const writer of ['Remove-Item', 'Set-ItemProperty', 'powercfg /change', 'icacls', 'config.cmd', 'Start-Process']) {
        assert.ok(!check.includes(writer), `the check must not change the machine (${writer})`);
    }
    assert.match(check, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    assert.match(check, /SessionId -eq 0/);
    assert.match(check, /exit 1/);
});

test('the CLI accepts cluster ids and spec paths but rejects anything a shell could misread', () => {
    const specExists = (spec) => spec === 'tests/core.spec.js';
    assert.deepEqual(parseRemoteArgs(['core-surface', 'tests\\core.spec.js', '--grep', 'T20kb:|T20kc:'], { specExists }).targets,
        ['core-surface', 'tests/core.spec.js']);
    assert.deepEqual(parseRemoteArgs([], { specExists }).targets, []);
    for (const bad of [['core-surface;calc'], ['no-such-cluster'], ['tests/missing.spec.js'], ['--grep', 'a"b'],
        ['--attach', '12a'], ['--bogus'], ['--queue-timeout-min', '0']]) {
        assert.throws(() => parseRemoteArgs(bad, { specExists }), undefined, bad.join(' '));
    }
});

test('the CLI pushes only fast-forwards of feature branches', () => {
    const base = { branch: 'claude/x', localSha: 'b'.repeat(40), allowPush: true };
    assert.equal(decidePush({ ...base, remoteSha: 'b'.repeat(40) }).action, 'none');
    assert.equal(decidePush({ ...base, remoteSha: '' }).action, 'push');
    assert.equal(decidePush({ ...base, remoteSha: 'a'.repeat(40), remoteIsAncestor: true }).action, 'push');
    assert.equal(decidePush({ ...base, remoteSha: 'a'.repeat(40), remoteIsAncestor: false }).action, 'refuse');
    assert.equal(decidePush({ ...base, remoteSha: '', allowPush: false }).action, 'refuse');
    assert.equal(decidePush({ ...base, branch: 'main', remoteSha: 'a'.repeat(40), remoteIsAncestor: true }).action, 'refuse');
    assert.equal(decidePush({ ...base, branch: 'main', remoteSha: 'b'.repeat(40) }).action, 'none');
});

test('the CLI finds its own run and reports the summary like a local run', () => {
    const runs = [
        { databaseId: 1, displayTitle: 'remote other-1234 core-shell' },
        { databaseId: 2, displayTitle: 'remote claude-x-abcd core-surface' },
    ];
    assert.equal(findRunByLabel(runs, 'claude-x-abcd')?.databaseId, 2);
    assert.equal(findRunByLabel(runs, 'claude-x'), null);
    assert.deepEqual(
        extractSummaryLines('noise\r\n[playwright:summary] passed=3 failed=0\r\nmore'),
        ['[playwright:summary] passed=3 failed=0']
    );
    assert.equal(exitCodeForRun({ conclusion: 'success' }), 0);
    assert.equal(exitCodeForRun({ conclusion: 'failure', log: '[playwright:summary] passed=3 failed=1' }), 1);
    assert.equal(exitCodeForRun({ conclusion: 'timed_out' }), 1);
});

// CLAUDE.md: exit 75 means "machine busy, try again later", never "red".
test('a lock timeout or a cancelled run on the test machine ends with 75, not as a failure', () => {
    const lockTimeout = 'noise\r\n[playwright:lock] LOCK_TIMEOUT holder=x pid=1 waited=7200s\r\n';
    assert.equal(exitCodeForRun({ conclusion: 'failure', log: lockTimeout }), REMOTE_EXIT_QUEUE_TIMEOUT);
    assert.equal(exitCodeForRun({ conclusion: 'cancelled' }), REMOTE_EXIT_QUEUE_TIMEOUT);
    assert.equal(REMOTE_EXIT_QUEUE_TIMEOUT, 75);
});

// The cluster runner hands the lock back between clusters: a red first cluster followed by a lock
// timeout is still red.
test('a lock timeout or cancel after a red cluster stays red', () => {
    const redThenTimeout = '[playwright:summary] passed=3 failed=1 skipped=0 didNotRun=0 flaky=0 known=0 new=1\n'
        + '[playwright:lock] LOCK_TIMEOUT holder=x pid=1 waited=7200s\n';
    assert.equal(exitCodeForRun({ conclusion: 'failure', log: redThenTimeout }), 1);
    assert.equal(exitCodeForRun({ conclusion: 'cancelled', log: redThenTimeout }), 1);
    const greenThenTimeout = '[playwright:summary] passed=3 failed=0 skipped=0 didNotRun=0 flaky=0 known=0 new=0\n'
        + '[playwright:lock] LOCK_TIMEOUT holder=x pid=1 waited=7200s\n';
    assert.equal(exitCodeForRun({ conclusion: 'failure', log: greenThenTimeout }), REMOTE_EXIT_QUEUE_TIMEOUT);
});
