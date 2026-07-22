import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import test from 'node:test';

import {
    createRoundFixtures,
    buildResearchPrompt,
    buildVerifyPrompt,
    calculateScopeAgreement,
    extractFinalText,
    extractCandidateManifest,
    extractVerifyManifest,
    FIXTURE_NAMES,
    runAgent,
    resolveOpenCodeExecutable,
    runResearchScope,
    runResearchRound,
    validateResearchReport,
    validateVerifyReport,
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
    const stdout = `${reportEvent('working')}\n${reportEvent('VERDICT: ISSUES_FOUND\nFinding')}\n${reportEvent('report complete')}`;
    assert.equal(extractFinalText(stdout), 'VERDICT: ISSUES_FOUND\nFinding');
    assert.deepEqual(validateResearchReport({ stdout }).warnings, ['post-report-summary']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('Intro\nVERDICT: CLEAN') }).reasons, ['verdict-not-first-line']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('```text\nVERDICT: CLEAN\n```') }).reasons, ['verdict-inside-code-fence']);
    assert.deepEqual(validateResearchReport({ stdout: reportEvent('No verdict') }).reasons, ['no-verdict-event']);
});

test('finding prose containing fallback stays valid but runtime fallback does not', () => {
    const stdout = reportEvent('VERDICT: ISSUES_FOUND\nOptions fallback is incorrect');
    assert.equal(validateResearchReport({ stdout }).valid, true);
    assert.equal(validateResearchReport({ stdout, stderr: 'Fallback warning: using default agent' }).valid, false);
});

test('lead candidate manifest is extracted from the final JSON block and validated', () => {
    const report = `VERDICT: ISSUES_FOUND\n\n\`\`\`json\n${JSON.stringify({ candidates: [{
        id: 'AA-01', file: 'fixture.mjs', symbol: 'acquire', claim: 'pending remains poisoned',
        evidence: 'second call returns rejected promise', potentialImpact: 'HIGH',
    }] })}\n\`\`\``;
    const manifest = extractCandidateManifest(report);
    assert.equal(manifest.candidates[0].id, 'AA-01');
    assert.throws(() => extractCandidateManifest('```json\n{"candidates":[{"id":"AA"}]}\n```'), /candidate\.file/);
});

test('verify uses compact candidate context and emits validated classifications', () => {
    const prompt = buildVerifyPrompt({ manifestFile: 'round/candidates.json', fixtureRoot: 'round/fixtures' });
    assert.match(prompt, /candidates\.json/);
    assert.doesNotMatch(prompt, /lead\.report/);
    assert.match(prompt, /Fixture-APIs sind die zu pruefende Contract-Oberflaeche/);
    assert.match(prompt, /nicht allein wegen fehlender Importe/);
    assert.ok(prompt.length < 1_500);
    const report = `VERDICT: VERIFIED\n\n\`\`\`json\n${JSON.stringify({ results: [{
        id: 'AA-01', classification: 'BUG', productPath: 'state -> call -> fault -> impact', counterEvidence: 'none',
    }] })}\n\`\`\``;
    assert.equal(extractVerifyManifest(report).results[0].classification, 'BUG');
    const stdout = `${reportEvent(report)}\n${reportEvent('verification complete')}`;
    assert.equal(validateVerifyReport({ stdout }).valid, true);
    assert.throws(() => extractVerifyManifest('```json\n{"results":[{"id":"AA","classification":"TRUE"}]}\n```'), /classification/);
});

test('scope agreement is deterministic and requires four valid agreeing models', () => {
    const finding = { file: 'fixture.mjs', symbol: 'acquire', category: 'pending-rejection', claim: 'claim', evidence: 'evidence', confidence: 'HIGH', impact: 'HIGH' };
    const result = (agent, valid = true) => ({
        agent,
        validation: { valid, report: `VERDICT: ISSUES_FOUND\n\n\`\`\`json\n${JSON.stringify({ findings: [finding] })}\n\`\`\`` },
    });
    const agreement = calculateScopeAgreement({ scope: 'perf', results: [
        result('council-perf'), result('council-perf-fb'), result('council-perf-fb2'), result('council-perf-fb3'), result('council-perf-fb4', false),
    ] });
    assert.equal(agreement.validRuns, 4);
    assert.equal(agreement.findings[0].agreementCount, 4);
    assert.equal(agreement.findings[0].highConfidence, true);
    const insufficient = calculateScopeAgreement({ scope: 'perf', results: [
        result('council-perf'), result('council-perf-fb'), result('council-perf-fb2'), result('council-perf-fb3', false), result('council-perf-fb4', false),
    ] });
    assert.equal(insufficient.findings[0].highConfidence, false);
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
