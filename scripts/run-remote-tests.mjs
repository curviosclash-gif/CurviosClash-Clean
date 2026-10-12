#!/usr/bin/env node
// Runs Playwright desktop clusters on the self-hosted test machine instead of this computer.
// Pushes the current branch (fast-forward only, never main), dispatches
// .github/workflows/remote-desktop.yml, waits and prints the [playwright:summary] lines.
// Setup of the machine: scripts/remote-runner/README.md.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DESKTOP_E2E_CLUSTERS, HEAVY_DIAGNOSTIC_CLUSTERS } from './playwright-test-clusters.mjs';

export const REMOTE_REPO = 'curviosclash-gif/CurviosClash-Clean';
export const REMOTE_WORKFLOW = 'remote-desktop.yml';
// Same pattern as the "Run desktop clusters" step of the workflow.
export const REMOTE_TARGET_PATTERN = /^(?:[a-z0-9-]+|tests\/[A-Za-z0-9._-]+\.spec\.js)$/;
export const REMOTE_EXIT_QUEUE_TIMEOUT = 75;
const PERFORMANCE_CLUSTERS = new Set(['gpu-stress']);
const PREFIX = '[remote-tests]';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const USAGE = `Usage: npm run test:remote -- [cluster-id|tests/<name>.spec.js ...] [options]
  (no target = the standard desktop clusters)
  --grep <expr>            only matching test titles, e.g. "T20kb:|T20kc:"
  --ref <branch>           branch to test (default: current branch)
  --no-push                never push; the branch must already be on GitHub
  --no-wait                dispatch only and print the run id
  --attach <run-id>        wait for an existing run and fetch its results
  --queue-timeout-min <n>  give up waiting for the machine after n minutes (default 120, exit 75)
  --max-wait-min <n>       give up waiting for the result after n minutes (default 420)`;

export function parseRemoteArgs(argv, { specExists = (spec) => existsSync(path.join(REPO_ROOT, spec)) } = {}) {
    const options = {
        targets: [], grep: '', ref: '', push: true, wait: true, attach: '',
        queueTimeoutMin: 120, maxWaitMin: 420, help: false,
    };
    const valueOf = (index, name) => {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
        return value;
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index]);
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--no-push') options.push = false;
        else if (arg === '--no-wait') options.wait = false;
        else if (arg === '--grep') options.grep = valueOf(index++, arg);
        else if (arg === '--ref') options.ref = valueOf(index++, arg);
        else if (arg === '--attach') options.attach = valueOf(index++, arg);
        else if (arg === '--queue-timeout-min') options.queueTimeoutMin = Number(valueOf(index++, arg));
        else if (arg === '--max-wait-min') options.maxWaitMin = Number(valueOf(index++, arg));
        else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        else options.targets.push(arg.replace(/\\/g, '/'));
    }
    const clusterIds = new Set([...DESKTOP_E2E_CLUSTERS, ...HEAVY_DIAGNOSTIC_CLUSTERS].map((cluster) => cluster.id));
    for (const target of options.targets) {
        if (!REMOTE_TARGET_PATTERN.test(target)) throw new Error(`invalid target ${target}`);
        if (target.startsWith('tests/') ? !specExists(target) : !clusterIds.has(target)) {
            throw new Error(`unknown target ${target} (known clusters: ${[...clusterIds].join(', ')})`);
        }
    }
    if (options.grep.includes('"') || options.grep.length > 300) {
        throw new Error('--grep must not contain double quotes and must stay below 300 characters');
    }
    if (options.attach && !/^\d+$/.test(options.attach)) throw new Error('--attach needs a numeric run id');
    for (const [name, value] of [['--queue-timeout-min', options.queueTimeoutMin], ['--max-wait-min', options.maxWaitMin]]) {
        if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} needs a positive number`);
    }
    return options;
}

/** Decides how the branch reaches GitHub. Never pushes main and never rewrites remote history. */
export function decidePush({ branch, localSha, remoteSha, remoteIsAncestor, allowPush }) {
    if (remoteSha === localSha) return { action: 'none' };
    if (branch === 'main') {
        return { action: 'refuse', reason: 'main differs from origin/main; push main by the git rules first' };
    }
    if (!allowPush) return { action: 'refuse', reason: `origin/${branch} is not at ${localSha.slice(0, 8)} and --no-push is set` };
    if (!remoteSha || remoteIsAncestor) return { action: 'push' };
    return { action: 'refuse', reason: `origin/${branch} has diverged; resolve it by hand (no force push)` };
}

export function findRunByLabel(runs, label) {
    const prefix = `remote ${label}`;
    return runs.find((run) => {
        const title = String(run.displayTitle || '').trim();
        return title === prefix || title.startsWith(`${prefix} `);
    }) || null;
}

export function extractSummaryLines(logText) {
    return String(logText || '').split(/\r?\n/).filter((line) => line.startsWith('[playwright:summary]'));
}

export function exitCodeForConclusion(conclusion) {
    return conclusion === 'success' ? 0 : 1;
}

function run(command, args, { allowFailure = false } = {}) {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
    if (result.error) throw new Error(`${command} not available: ${result.error.message}`);
    if (result.status !== 0 && !allowFailure) {
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
    }
    return { status: result.status, stdout: String(result.stdout || '').trim() };
}

const gh = (args, opts) => run('gh', args, opts);
const git = (args, opts) => run('git', args, opts);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function ensureWriteAccess() {
    const permissions = gh(['api', `repos/${REMOTE_REPO}`, '--jq', '.permissions.push'], { allowFailure: true });
    if (permissions.stdout !== 'true') {
        throw new Error('the active gh account cannot start workflows in this repository.\n'
            + '  Fix once: gh auth switch --user <account with write access>  (or: gh auth login)');
    }
}

function publishBranch(options) {
    const branch = options.ref || git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    if (!branch || branch === 'HEAD') throw new Error('detached HEAD; pass --ref <branch>');
    const localSha = git(['rev-parse', `refs/heads/${branch}`]).stdout;
    // GitHub runs the workflow file of the tested commit; older branches do not have it yet.
    if (git(['cat-file', '-e', `${localSha}:.github/workflows/${REMOTE_WORKFLOW}`], { allowFailure: true }).status !== 0) {
        throw new Error(`${branch} has no .github/workflows/${REMOTE_WORKFLOW}; merge main into it first`);
    }
    if (!options.ref && git(['status', '--porcelain', '--untracked-files=no']).stdout) {
        console.log(`${PREFIX} note: uncommitted changes stay local; the machine tests ${localSha.slice(0, 8)}`);
    }
    const remoteLine = git(['ls-remote', 'origin', `refs/heads/${branch}`]).stdout;
    const remoteSha = remoteLine.split(/\s+/)[0] || '';
    let remoteIsAncestor = false;
    if (remoteSha && remoteSha !== localSha) {
        git(['fetch', '--quiet', 'origin', `refs/heads/${branch}`], { allowFailure: true });
        remoteIsAncestor = git(['merge-base', '--is-ancestor', remoteSha, localSha], { allowFailure: true }).status === 0;
    }
    const decision = decidePush({ branch, localSha, remoteSha, remoteIsAncestor, allowPush: options.push });
    if (decision.action === 'refuse') throw new Error(decision.reason);
    if (decision.action === 'push') {
        console.log(`${PREFIX} pushing ${branch} @ ${localSha.slice(0, 8)} (fast-forward)`);
        git(['push', 'origin', `${localSha}:refs/heads/${branch}`]);
        const after = git(['ls-remote', 'origin', `refs/heads/${branch}`]).stdout.split(/\s+/)[0];
        if (after !== localSha) throw new Error(`origin/${branch} is ${after || 'missing'} after the push, expected ${localSha}`);
    }
    return { branch, sha: localSha };
}

async function dispatch(options, branch) {
    const label = `${branch.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40)}-${randomBytes(4).toString('hex')}`;
    gh(['workflow', 'run', REMOTE_WORKFLOW, '--repo', REMOTE_REPO, '--ref', branch,
        '-f', `targets=${options.targets.join(' ')}`, '-f', `grep=${options.grep}`, '-f', `label=${label}`]);
    for (let attempt = 0; attempt < 24; attempt += 1) {
        await sleep(5000);
        const list = gh(['run', 'list', '--repo', REMOTE_REPO, '--workflow', REMOTE_WORKFLOW, '--branch', branch,
            '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,displayTitle,url']);
        const found = findRunByLabel(JSON.parse(list.stdout || '[]'), label);
        if (found) return found;
    }
    throw new Error(`dispatched, but no run with label ${label} appeared within 2 minutes`);
}

async function waitForRun(runId, options) {
    const startedAt = Date.now();
    let lastStatus = '';
    let queuedSince = Date.now();
    for (;;) {
        const view = JSON.parse(gh(['run', 'view', String(runId), '--repo', REMOTE_REPO, '--json', 'status,conclusion']).stdout);
        if (view.status !== lastStatus) {
            console.log(`${PREFIX} run ${runId}: ${view.status}`);
            if (view.status === 'queued') queuedSince = Date.now();
            lastStatus = view.status;
        }
        if (view.status === 'completed') return view.conclusion;
        if (view.status === 'queued' && Date.now() - queuedSince > options.queueTimeoutMin * 60_000) {
            return 'queue-timeout';
        }
        if (Date.now() - startedAt > options.maxWaitMin * 60_000) return 'wait-timeout';
        await sleep(30_000);
    }
}

function fetchResults(runId) {
    const target = path.join('test-results', 'remote-runs', String(runId));
    const download = gh(['run', 'download', String(runId), '--repo', REMOTE_REPO,
        '-n', `remote-desktop-results-${runId}`, '-D', target], { allowFailure: true });
    if (download.status !== 0) {
        console.log(`${PREFIX} no result artifact for run ${runId}`);
        return;
    }
    const logPath = path.join(target, 'remote-run.log');
    const lines = existsSync(logPath) ? extractSummaryLines(readFileSync(logPath, 'utf8')) : [];
    for (const line of lines) console.log(line);
    console.log(`${PREFIX} results: ${target}`);
}

async function main(argv) {
    const options = parseRemoteArgs(argv);
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    if (options.targets.some((target) => PERFORMANCE_CLUSTERS.has(target))) {
        console.log(`${PREFIX} note: performance numbers from the test machine do not hold for the target PC; measure locally`);
    }
    ensureWriteAccess();
    let runId = options.attach;
    if (!runId) {
        const { branch, sha } = publishBranch(options);
        const found = await dispatch(options, branch);
        runId = String(found.databaseId);
        console.log(`${PREFIX} run ${runId} for ${branch} @ ${sha.slice(0, 8)}: ${found.url}`);
        if (!options.wait) {
            console.log(`${PREFIX} later: npm run test:remote -- --attach ${runId}`);
            return 0;
        }
    }
    const conclusion = await waitForRun(runId, options);
    if (conclusion === 'queue-timeout' || conclusion === 'wait-timeout') {
        console.log(`${PREFIX} ${conclusion}: the test machine is offline or busy. The run stays on GitHub; `
            + `resume with: npm run test:remote -- --attach ${runId}`);
        return REMOTE_EXIT_QUEUE_TIMEOUT;
    }
    console.log(`${PREFIX} run ${runId} finished: ${conclusion}`);
    fetchResults(runId);
    return exitCodeForConclusion(conclusion);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
        console.error(`${PREFIX} ${error.message}`);
        process.exitCode = 2;
    });
}
