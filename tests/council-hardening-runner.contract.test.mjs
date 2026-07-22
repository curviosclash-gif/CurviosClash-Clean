import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import test from 'node:test';

import {
    createRoundFixtures,
    buildResearchPrompt,
    extractFinalText,
    FIXTURE_NAMES,
    runAgent,
    resolveOpenCodeExecutable,
    runResearchScope,
    runResearchRound,
    validateResearchReport,
} from '../scripts/council-hardening-runner.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const reportEvent = (text) => JSON.stringify({ type: 'text', text });

test('Windows resolves the native OpenCode executable instead of spawning a cmd wrapper', () => {
    if (process.platform !== 'win32') return;
    const executable = resolveOpenCodeExecutable();
    assert.match(executable, /opencode\.exe$/i);
});

test('hardening fixtures are isolated below repository tmp and preserve bytes', async () => {
    const prepared = await createRoundFixtures({ repositoryRoot: ROOT, runId: 'contract-fixtures', round: 1 });
    assert.ok(prepared.fixtureRoot.startsWith(path.join(ROOT, 'tmp', 'council-hardening')));
    for (const name of FIXTURE_NAMES) {
        assert.deepEqual(
            await readFile(path.join(prepared.fixtureRoot, name)),
            await readFile(path.join(ROOT, 'tests', 'council-test-loop', name)),
        );
    }
});

test('only the final JSON text event is validated and VERDICT must be first', () => {
    const stdout = `${reportEvent('working')}\n${reportEvent('VERDICT: ISSUES_FOUND\nFinding')}`;
    assert.equal(extractFinalText(stdout), 'VERDICT: ISSUES_FOUND\nFinding');
    assert.equal(validateResearchReport({ stdout }).valid, true);
    assert.equal(validateResearchReport({ stdout: reportEvent('Intro\nVERDICT: CLEAN') }).valid, false);
});

test('finding prose containing fallback stays valid but runtime fallback does not', () => {
    const stdout = reportEvent('VERDICT: ISSUES_FOUND\nOptions fallback is incorrect');
    assert.equal(validateResearchReport({ stdout }).valid, true);
    assert.equal(validateResearchReport({ stdout, stderr: 'Fallback warning: using default agent' }).valid, false);
});

test('research scope runs five siblings in parallel with one provider-only retry', async () => {
    let active = 0;
    let maxActive = 0;
    const attempts = new Map();
    const prompts = [];
    const run = async ({ agent, prompt }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        prompts.push(prompt);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const count = (attempts.get(agent) || 0) + 1;
        attempts.set(agent, count);
        if (agent === 'council-test-fb2' && count === 1) {
            return { agent, stdout: '', stderr: 'Streaming response failed', exitCode: 1, timedOut: false };
        }
        return { agent, stdout: reportEvent('VERDICT: CLEAN'), stderr: '', exitCode: 0, timedOut: false };
    };
    const result = await runResearchScope({ repositoryRoot: ROOT, scope: 'test', prompt: 'same', timeoutMs: 1_000, run });
    assert.equal(maxActive, 5);
    assert.equal(prompts.every((prompt) => prompt === 'same'), true);
    assert.equal(attempts.get('council-test-fb2'), 2);
    assert.equal(result.results.every(({ validation }) => validation.valid), true);
});

test('research round keeps scopes sequential and supplies scope-specific prompts', async () => {
    let active = 0;
    let maxActive = 0;
    const seenPrompts = new Set();
    const run = async ({ prompt }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        seenPrompts.add(prompt);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { stdout: reportEvent('VERDICT: CLEAN'), stderr: '', exitCode: 0, timedOut: false };
    };
    const results = await runResearchRound({
        repositoryRoot: ROOT,
        promptForScope: (scope) => `scope:${scope}`,
        timeoutMs: 1_000,
        run,
    });
    assert.equal(results.length, 4);
    assert.equal(maxActive, 5);
    assert.deepEqual([...seenPrompts], ['scope:review', 'scope:arch', 'scope:test', 'scope:perf']);
    assert.match(buildResearchPrompt('review', 'tmp/fixtures'), /Scope: review/);
});

test('agent timeout drains streams and terminates the process', async () => {
    const child = new EventEmitter();
    child.pid = 123;
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let terminated = false;
    const terminate = async () => {
        terminated = true;
        child.exitCode = 1;
        child.emit('exit', 1);
    };
    const promise = runAgent({
        repositoryRoot: ROOT,
        agent: 'council-test',
        prompt: 'test',
        timeoutMs: 10,
        spawn: () => child,
        terminate,
    });
    child.stdout.write(`${reportEvent('partial')}\n`);
    const result = await promise;
    assert.equal(terminated, true);
    assert.equal(result.timedOut, true);
    assert.match(result.stdout, /partial/);
});
